// SPDX-License-Identifier: MIT OR Apache-2.0
//! Bounded KWDJ backward deletion. Core operations retain boundary authority.

use std::mem::size_of;

use editor_core::candidate::{BorrowedNode, CandidateRead};
use editor_core::commands::{
    CommandPresentation, CommandState, LocalRef, PlanBuilder, SelectionIntent,
};
use editor_core::document::Primitive;
use editor_core::positions::{Affinity, Position, Selection, Utf16Offset, grapheme_boundaries};
use editor_core::transaction::Operation;

use super::inline::{self, TextPoint};
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
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<CommandPresentation, KwdjError> {
    let selection = state
        .selection
        .copied()
        .ok_or_else(|| error(KwdjErrorCode::CommandSelectionRequired))?;
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
    if !eligible(block.type_id) {
        return Err(unsupported());
    }
    let at_start = point_key(view, &focus, plan)? == PointKey::Gap(0);
    if at_start {
        return join(view, focus.block, plan);
    }
    delete_egc(view, focus, selection.focus, plan)?;
    Ok(CommandPresentation::default())
}

#[derive(Clone, Copy)]
struct RunLeaf<I> {
    id: I,
    index: usize,
    start: usize,
    length: usize,
}

fn delete_egc<V: CandidateRead>(
    view: &V,
    point: TextPoint<V::Id>,
    original_end: Position<V::Id>,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<(), KwdjError> {
    let block = get(view, point.block, plan)?;
    units(plan, block.children.len())?;
    let target = if point.leaf.is_some() {
        point.index
    } else {
        point.index.checked_sub(1).ok_or_else(unsupported)?
    };
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
                    .checked_add(if point.leaf.is_some() {
                        point.utf16.get()
                    } else {
                        len
                    })
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
    if end == 0 {
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
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<CommandPresentation, KwdjError> {
    let right = get(view, right_id, plan)?;
    if right.type_id == "org.klenwriter.kwdj/code_block" {
        return Err(unsupported());
    }
    let top_level = right.parent == view.root();
    if !top_level {
        let parent = get(view, right.parent, plan)?;
        if parent.type_id != "org.klenwriter.kwdj/blockquote" || parent.parent != view.root() {
            return Err(unsupported());
        }
    }
    units(plan, right.children.len())?;
    for child in right.children {
        if get(view, *child, plan)?.primitive != Primitive::Text {
            return Err(unsupported());
        }
    }
    let siblings = view.children(right.parent).ok_or_else(invalid)?;
    units(plan, siblings.len())?;
    let index = siblings
        .iter()
        .position(|id| *id == right_id)
        .ok_or_else(invalid)?;
    if index == 0 {
        return if top_level {
            Ok(CommandPresentation::default())
        } else {
            Err(unsupported())
        };
    }
    let left_id = siblings[index - 1];
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
