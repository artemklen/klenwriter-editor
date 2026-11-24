// SPDX-License-Identifier: MIT OR Apache-2.0
//! Bounded KWDJ deletion. Core operations retain boundary authority.

mod poetry;

use std::mem::size_of;

use editor_core::candidate::{BorrowedNode, CandidateRead};
use editor_core::commands::{
    CommandPresentation, CommandState, LocalRef, PlanBuilder, SelectionIntent,
};
use editor_core::document::Primitive;
use editor_core::positions::{
    Affinity, Edge, Position, Selection, Utf16Offset, grapheme_boundaries,
};
use editor_core::transaction::Operation;

use super::{
    block::{self, RemovalCaret},
    inline::{self, TextPoint},
};
use crate::{KwdjError, KwdjErrorCode};

fn error(code: KwdjErrorCode) -> KwdjError {
    KwdjError::new(code, "/command")
}
fn invalid() -> KwdjError {
    error(KwdjErrorCode::CommandInvalidTarget)
}
fn unsupported() -> KwdjError {
    error(KwdjErrorCode::CommandUnsupportedContext)
}
fn units<I>(plan: &mut PlanBuilder<'_, I>, amount: usize) -> Result<(), KwdjError> {
    plan.work()
        .charge_units(amount as u64)
        .map_err(KwdjError::operational)
}
fn bytes<I>(plan: &mut PlanBuilder<'_, I>, amount: usize) -> Result<(), KwdjError> {
    plan.work()
        .charge_bytes(amount as u64)
        .map_err(KwdjError::operational)
}
fn get<'a, V: CandidateRead>(
    view: &'a V,
    id: V::Id,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<BorrowedNode<'a, V::Id>, KwdjError> {
    units(plan, 1)?;
    let node = view.node(id).ok_or_else(invalid)?;
    bytes(plan, node.type_id.len())?;
    Ok(node)
}
fn length<I>(text: &str, plan: &mut PlanBuilder<'_, I>) -> Result<usize, KwdjError> {
    bytes(plan, text.len())?;
    units(plan, text.len())?;
    Ok(text.encode_utf16().count())
}
fn text_position<I>(leaf: I, offset: usize) -> Position<I> {
    Position::Text {
        leaf,
        utf16: Utf16Offset::new(offset),
        affinity: Affinity::After,
    }
}
fn map_position<I>(position: Position<I>) -> Position<LocalRef<I>> {
    match position {
        Position::Text {
            leaf,
            utf16,
            affinity,
        } => Position::Text {
            leaf: LocalRef::Existing(leaf),
            utf16,
            affinity,
        },
        Position::Child {
            parent,
            index,
            affinity,
        } => Position::Child {
            parent: LocalRef::Existing(parent),
            index,
            affinity,
        },
        Position::Edge { node, side } => Position::Edge {
            node: LocalRef::Existing(node),
            side,
        },
    }
}
fn caret<I: Clone>(
    plan: &mut PlanBuilder<'_, I>,
    position: Position<LocalRef<I>>,
) -> Result<(), KwdjError> {
    // A Created path is owned by each endpoint, including its charged clone.
    if let Position::Text {
        leaf: LocalRef::Created { path, .. },
        ..
    } = &position
    {
        bytes(plan, std::mem::size_of_val(path.as_slice()))?;
        units(plan, path.len())?;
    }
    plan.set_selection(SelectionIntent::MapFromUserResult(Some(Selection {
        anchor: position.clone(),
        focus: position,
    })))
    .map_err(KwdjError::operational)
}

#[derive(PartialEq, Eq)]
enum PointKey<I> {
    Gap(usize),
    Text(I, usize),
}
fn point_key<V: CandidateRead>(
    view: &V,
    point: &TextPoint<V::Id>,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<PointKey<V::Id>, KwdjError> {
    let Some(leaf) = point.leaf else {
        return Ok(PointKey::Gap(point.index));
    };
    if point.utf16.get() == 0 {
        return Ok(PointKey::Gap(point.index));
    }
    let node = get(view, leaf, plan)?;
    let count = length(node.text.ok_or_else(invalid)?, plan)?;
    Ok(if point.utf16.get() == count {
        PointKey::Gap(point.index + 1)
    } else {
        PointKey::Text(leaf, point.utf16.get())
    })
}

fn eligible(kind: &str) -> bool {
    matches!(
        kind,
        "org.klenwriter.kwdj/paragraph"
            | "org.klenwriter.kwdj/heading"
            | "org.klenwriter.kwdj/code_block"
    )
}

pub(super) fn prepare<V: CandidateRead>(
    view: &V,
    state: CommandState<'_, V::Id>,
    poetry: bool,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<CommandPresentation, KwdjError> {
    let selection = state
        .selection
        .copied()
        .ok_or_else(|| error(KwdjErrorCode::CommandSelectionRequired))?;
    if selection.anchor == selection.focus
        && let Position::Edge {
            node,
            side: Edge::After,
        } = selection.focus
        && get(view, node, plan)?.type_id == "org.klenwriter.kwdj/scene_break"
    {
        block::remove(view, node, RemovalCaret::AdjacentText, plan)?;
        return Ok(CommandPresentation::default());
    }
    let focus = inline::text_point(view, selection.focus, plan.work())?;
    if selection.anchor != selection.focus {
        let anchor = inline::text_point(view, selection.anchor, plan.work())?;
        if anchor.block != focus.block
            || point_key(view, &anchor, plan)? != point_key(view, &focus, plan)?
        {
            return inline::insert_text(view, state, "", plan);
        }
    }
    let block = get(view, focus.block, plan)?;
    let verse_line = poetry && block.type_id == poetry::VERSE_LINE;
    if !verse_line && !eligible(block.type_id) {
        return Err(unsupported());
    }
    let at_start = point_key(view, &focus, plan)? == PointKey::Gap(0);
    if at_start {
        if verse_line {
            if poetry::collapsed(view, focus.block, block, poetry::Direction::Backward, plan)? {
                return Ok(CommandPresentation::default());
            }
            return Err(unsupported());
        }
        return join(view, focus.block, poetry, plan);
    }
    delete_egc(view, focus, selection.focus, plan)?;
    Ok(CommandPresentation::default())
}

pub(super) fn in_table_cell<V: CandidateRead>(
    view: &V,
    mut parent: V::Id,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<bool, KwdjError> {
    for _ in 0..crate::MAX_TREE_DEPTH {
        if parent == view.root() {
            return Ok(false);
        }
        let ancestor = get(view, parent, plan)?;
        if matches!(
            ancestor.type_id,
            "org.klenwriter.kwdj/table_cell" | "org.klenwriter.kwdj/table_header"
        ) {
            return Ok(true);
        }
        parent = ancestor.parent;
    }
    Err(invalid())
}

pub(super) fn prepare_forward<V: CandidateRead>(
    view: &V,
    state: CommandState<'_, V::Id>,
    poetry: bool,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<CommandPresentation, KwdjError> {
    let outside_profile = || super::refusal(KwdjErrorCode::CommandUnsupportedContext);
    let selection = state.selection.copied().ok_or_else(|| {
        if poetry {
            error(KwdjErrorCode::CommandSelectionRequired)
        } else {
            outside_profile()
        }
    })?;
    let focus = match inline::text_point(view, selection.focus, plan.work()) {
        Ok(point) => point,
        Err(error) if !poetry && error.code != KwdjErrorCode::OperationalBudgetExceeded => {
            return Err(outside_profile());
        }
        Err(error) => return Err(error),
    };
    let block = get(view, focus.block, plan)?;
    let table_cell = eligible(block.type_id) && in_table_cell(view, block.parent, plan)?;
    if !poetry && !table_cell {
        return Err(outside_profile());
    }
    let point = point_key(view, &focus, plan)?;
    if selection.anchor != selection.focus {
        let anchor = inline::text_point(view, selection.anchor, plan.work())?;
        if anchor.block != focus.block || point_key(view, &anchor, plan)? != point {
            return Err(unsupported());
        }
    }
    if table_cell {
        return delete_next_egc(view, focus, point, selection.focus, plan);
    }
    if point != PointKey::Gap(block.children.len())
        || !poetry::collapsed(view, focus.block, block, poetry::Direction::Forward, plan)?
    {
        return Err(unsupported());
    }
    Ok(CommandPresentation::default())
}

pub(super) fn prepare_poetry_selection<V: CandidateRead>(
    view: &V,
    state: CommandState<'_, V::Id>,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<CommandPresentation, KwdjError> {
    let selection = state
        .selection
        .copied()
        .ok_or_else(|| error(KwdjErrorCode::CommandSelectionRequired))?;
    poetry::selected(view, selection, plan)?;
    Ok(CommandPresentation::default())
}

#[derive(Clone, Copy)]
struct RunLeaf<I> {
    id: I,
    index: usize,
    start: usize,
    length: usize,
}

struct TextRun<I> {
    leaves: Vec<RunLeaf<I>>,
    offset: usize,
    boundaries: Vec<Utf16Offset>,
}

fn text_run<V: CandidateRead>(
    view: &V,
    block: V::Id,
    target: usize,
    target_offset: Option<usize>,
    previous: bool,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<TextRun<V::Id>, KwdjError> {
    let block = get(view, block, plan)?;
    units(plan, block.children.len())?;
    if target >= block.children.len() {
        return Err(unsupported());
    }
    let mut first = target;
    let mut last = target + 1;
    if get(view, block.children[target], plan)?.primitive != Primitive::Text {
        return Err(unsupported());
    }
    while first > 0 && get(view, block.children[first - 1], plan)?.primitive == Primitive::Text {
        first -= 1;
    }
    while last < block.children.len()
        && get(view, block.children[last], plan)?.primitive == Primitive::Text
    {
        last += 1;
    }
    let count = last - first;
    bytes(
        plan,
        count
            .checked_mul(size_of::<RunLeaf<V::Id>>())
            .ok_or_else(invalid)?,
    )?;
    let mut leaves = Vec::with_capacity(count);
    let mut text_bytes = 0usize;
    let mut total = 0usize;
    let mut end = None;
    for index in first..last {
        let id = block.children[index];
        let node = get(view, id, plan)?;
        let source = node.text.ok_or_else(invalid)?;
        let len = length(source, plan)?;
        text_bytes = text_bytes.checked_add(source.len()).ok_or_else(invalid)?;
        if index == target {
            end = Some(
                total
                    .checked_add(target_offset.unwrap_or(len))
                    .ok_or_else(invalid)?,
            );
        }
        leaves.push(RunLeaf {
            id,
            index,
            start: total,
            length: len,
        });
        total = total.checked_add(len).ok_or_else(invalid)?;
    }
    let end = end.ok_or_else(invalid)?;
    if previous && end == 0 {
        // The prior sibling is a hard break/atom, rather than a preceding EGC.
        return Err(unsupported());
    }
    bytes(plan, text_bytes)?;
    let mut text = String::with_capacity(text_bytes);
    for leaf in &leaves {
        let source = get(view, leaf.id, plan)?.text.ok_or_else(invalid)?;
        units(plan, source.len())?;
        text.push_str(source);
    }
    // Core's pinned segmenter owns Unicode semantics. Bound its worst-case
    // result allocation BEFORE calling it; no document-wide buffer is built.
    bytes(
        plan,
        total
            .checked_add(1)
            // Vec growth may reserve below twice its requested entry count.
            .and_then(|n| n.max(4).checked_mul(size_of::<Utf16Offset>() * 2))
            .ok_or_else(invalid)?,
    )?;
    units(plan, text.len())?;
    let boundaries = grapheme_boundaries(&text).map_err(|_| invalid())?;
    units(plan, boundaries.len())?;
    Ok(TextRun {
        leaves,
        offset: end,
        boundaries,
    })
}

fn delete_next_egc<V: CandidateRead>(
    view: &V,
    point: TextPoint<V::Id>,
    offset: PointKey<V::Id>,
    original_start: Position<V::Id>,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<CommandPresentation, KwdjError> {
    let (target, local_offset) = match offset {
        PointKey::Gap(index) => (index, 0),
        PointKey::Text(_, offset) => (point.index, offset),
    };
    let run = text_run(view, point.block, target, Some(local_offset), false, plan)?;
    let next = run
        .boundaries
        .iter()
        .find(|offset| offset.get() > run.offset)
        .ok_or_else(unsupported)?
        .get();
    units(plan, run.leaves.len())?;
    let end = run
        .leaves
        .iter()
        .find(|leaf| next <= leaf.start + leaf.length)
        .ok_or_else(invalid)?;
    let selection = Selection {
        anchor: original_start,
        focus: text_position(end.id, next - end.start),
    };
    erase_cell_inline_range(view, selection, point, plan)
}

pub(super) fn erase_cell_inline_range<V: CandidateRead>(
    view: &V,
    selection: Selection<V::Id>,
    start: TextPoint<V::Id>,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<CommandPresentation, KwdjError> {
    let block = get(view, start.block, plan)?;
    if !eligible(block.type_id) {
        return Err(unsupported());
    }
    // Keep a caret on the retained prefix when normalization rejoins the suffix.
    // A child gap on its own could map to the end of that joined text.
    let position = if let Some(leaf) = start.leaf
        && start.utf16.get() > 0
    {
        text_position(leaf.into(), start.utf16.get())
    } else if let Some(previous) = start.index.checked_sub(1)
        && let Some(text) = get(view, block.children[previous], plan)?.text
    {
        text_position(block.children[previous].into(), length(text, plan)?)
    } else {
        Position::Child {
            parent: start.block.into(),
            index: start.index,
            affinity: Affinity::After,
        }
    };
    plan.push(Operation::ReplaceInlineRange {
        range: inline::map_selection(selection),
        inserted: None,
    })
    .map_err(KwdjError::operational)?;
    caret(plan, position)?;
    Ok(CommandPresentation::default())
}

fn delete_egc<V: CandidateRead>(
    view: &V,
    point: TextPoint<V::Id>,
    original_end: Position<V::Id>,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<(), KwdjError> {
    let (target, target_offset) = if point.leaf.is_some() {
        (point.index, Some(point.utf16.get()))
    } else {
        (point.index.checked_sub(1).ok_or_else(unsupported)?, None)
    };
    let TextRun {
        leaves,
        offset: end,
        boundaries,
    } = text_run(view, point.block, target, target_offset, true, plan)?;
    let first = leaves.first().ok_or_else(invalid)?.index;
    let previous = boundaries
        .iter()
        .rfind(|offset| offset.get() < end)
        .ok_or_else(invalid)?
        .get();
    units(plan, leaves.len())?;
    let start = leaves
        .iter()
        .find(|leaf| previous < leaf.start + leaf.length)
        .ok_or_else(invalid)?;
    let start_offset = previous - start.start;
    let range_start = text_position(LocalRef::Existing(start.id), start_offset);

    let position = if start_offset > 0 {
        text_position(LocalRef::Existing(start.id), start_offset)
    } else if start.index > first {
        let left = &leaves[start.index - first - 1];
        text_position(LocalRef::Existing(left.id), left.length)
    } else {
        let end_leaf = &leaves[target - first];
        let offset = end - end_leaf.start;
        if offset == 0 {
            text_position(LocalRef::Existing(end_leaf.id), 0)
        } else if offset < end_leaf.length {
            // The range operation does not expose its internal split IDs.
            // Split only the original outer endpoint, which core validates.
            let operation = plan
                .push(Operation::SplitText {
                    leaf: LocalRef::Existing(end_leaf.id),
                    at: Utf16Offset::new(offset),
                })
                .map_err(KwdjError::operational)?;
            bytes(plan, size_of::<usize>())?;
            text_position(
                LocalRef::Created {
                    operation,
                    path: vec![0],
                },
                0,
            )
        } else if let Some(right) = leaves.get(target - first + 1) {
            text_position(LocalRef::Existing(right.id), 0)
        } else {
            Position::Child {
                parent: LocalRef::Existing(point.block),
                index: start.index,
                affinity: Affinity::After,
            }
        }
    };
    plan.push(Operation::ReplaceInlineRange {
        range: Selection {
            anchor: range_start,
            focus: map_position(original_end),
        },
        inserted: None,
    })
    .map_err(KwdjError::operational)?;
    caret(plan, position)
}

fn join<V: CandidateRead>(
    view: &V,
    right_id: V::Id,
    poetry: bool,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<CommandPresentation, KwdjError> {
    let right = get(view, right_id, plan)?;
    if right.type_id == "org.klenwriter.kwdj/code_block" {
        return Err(unsupported());
    }
    let top_level = right.parent == view.root();
    let ordinary_body = if top_level {
        true
    } else {
        let parent = get(view, right.parent, plan)?;
        parent.type_id == "org.klenwriter.kwdj/blockquote" && parent.parent == view.root()
    };
    let poetry_prose = poetry && poetry::is_prose_block(right.type_id);
    let previous = if poetry_prose {
        let previous = previous_sibling(view, right.parent, right_id, plan)?;
        if let Some(left) = previous
            && poetry::join_after_verse(view, get(view, left, plan)?, right_id, right, plan)?
        {
            return Ok(CommandPresentation::default());
        }
        previous
    } else {
        None
    };
    if !ordinary_body {
        return Err(unsupported());
    }
    units(plan, right.children.len())?;
    for child in right.children {
        if get(view, *child, plan)?.primitive != Primitive::Text {
            return Err(unsupported());
        }
    }
    let previous = if poetry_prose {
        previous
    } else {
        previous_sibling(view, right.parent, right_id, plan)?
    };
    let Some(left_id) = previous else {
        return if top_level {
            Ok(CommandPresentation::default())
        } else {
            Err(unsupported())
        };
    };
    let left = get(view, left_id, plan)?;
    if left.primitive != Primitive::TextBlock
        || !eligible(left.type_id)
        || left.type_id == "org.klenwriter.kwdj/code_block"
    {
        return Err(unsupported());
    }
    units(plan, left.children.len())?;
    for child in left.children {
        if get(view, *child, plan)?.primitive != Primitive::Text {
            return Err(unsupported());
        }
    }
    // Charge metadata before a potentially deep equality comparison.
    let _ = plan
        .charged_copy_attrs(left.attributes)
        .map_err(KwdjError::operational)?;
    let _ = plan
        .charged_copy_attrs(right.attributes)
        .map_err(KwdjError::operational)?;
    if left.type_id != right.type_id || left.attributes != right.attributes {
        return Err(error(KwdjErrorCode::CommandLossyTransform));
    }
    let position = if let Some(last) = left.children.last() {
        let node = get(view, *last, plan)?;
        text_position(
            LocalRef::Existing(*last),
            length(node.text.ok_or_else(invalid)?, plan)?,
        )
    } else {
        Position::Child {
            parent: LocalRef::Existing(left_id),
            index: 0,
            affinity: Affinity::After,
        }
    };
    if !right.children.is_empty() {
        bytes(
            plan,
            right
                .children
                .len()
                .checked_mul(size_of::<LocalRef<V::Id>>())
                .ok_or_else(invalid)?,
        )?;
        let nodes = right
            .children
            .iter()
            .copied()
            .map(LocalRef::Existing)
            .collect();
        plan.push(Operation::MoveInlineGroup {
            nodes,
            parent: LocalRef::Existing(left_id),
            before_index: left.children.len(),
        })
        .map_err(KwdjError::operational)?;
    }
    plan.push(Operation::Remove {
        node: LocalRef::Existing(right_id),
    })
    .map_err(KwdjError::operational)?;
    caret(plan, position)?;
    Ok(CommandPresentation::default())
}

fn previous_sibling<V: CandidateRead>(
    view: &V,
    parent: V::Id,
    id: V::Id,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<Option<V::Id>, KwdjError> {
    let siblings = view.children(parent).ok_or_else(invalid)?;
    units(plan, siblings.len())?;
    let at = siblings
        .iter()
        .position(|node| *node == id)
        .ok_or_else(invalid)?;
    Ok(at.checked_sub(1).map(|index| siblings[index]))
}
