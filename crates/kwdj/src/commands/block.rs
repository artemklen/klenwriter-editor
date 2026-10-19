// SPDX-License-Identifier: MIT OR Apache-2.0
//! KWDJ structural recipes preserve borrowed subtrees and propose bounded ops.

use std::mem::{size_of, size_of_val};

use editor_core::candidate::{BorrowedNode, CandidateRead};
use editor_core::commands::{
    ActiveState, CommandPresentation, CommandState, LocalRef, PlanBuilder, SelectionIntent,
    StoredMarksUpdate,
};
use editor_core::document::{Attribute, Attributes, Document, Node, Primitive};
use editor_core::positions::{Affinity, Edge, Position, Selection, Utf16Offset, utf16_to_utf8};
use editor_core::transaction::Operation;

use super::{BlockTarget, KWDJ_SLASH_CANDIDATES, KwdjIntent, ListKind, inline, refusal};
use crate::{KwdjError, KwdjErrorCode, Profile};

const PREFIX: &str = "org.klenwriter.kwdj/";
fn invalid() -> KwdjError {
    refusal(KwdjErrorCode::CommandInvalidTarget)
}
fn unsupported() -> KwdjError {
    refusal(KwdjErrorCode::CommandUnsupportedContext)
}
fn lossy() -> KwdjError {
    refusal(KwdjErrorCode::CommandLossyTransform)
}
fn kind(value: &str) -> &str {
    value.strip_prefix(PREFIX).unwrap_or("")
}
fn unit<I>(plan: &mut PlanBuilder<'_, I>, amount: usize) -> Result<(), KwdjError> {
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
    unit(plan, 1)?;
    let node = view.node(id).ok_or_else(invalid)?;
    bytes(plan, node.type_id.len())?;
    Ok(node)
}
fn index<V: CandidateRead>(
    view: &V,
    parent: V::Id,
    id: V::Id,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<usize, KwdjError> {
    let children = view.children(parent).ok_or_else(invalid)?;
    unit(plan, children.len())?;
    children
        .iter()
        .position(|child| *child == id)
        .ok_or_else(invalid)
}
fn push<I>(plan: &mut PlanBuilder<'_, I>, op: Operation<LocalRef<I>>) -> Result<usize, KwdjError> {
    plan.push(op).map_err(KwdjError::operational)
}
fn copy_ref<I: Copy>(
    value: &LocalRef<I>,
    plan: &mut PlanBuilder<'_, I>,
) -> Result<LocalRef<I>, KwdjError> {
    if let LocalRef::Created { path, .. } = value {
        unit(plan, path.len())?;
        bytes(plan, size_of_val(path.as_slice()))?;
    }
    Ok(value.clone())
}
fn created<I>(
    operation: usize,
    path: &[usize],
    plan: &mut PlanBuilder<'_, I>,
) -> Result<LocalRef<I>, KwdjError> {
    unit(plan, path.len())?;
    bytes(plan, size_of_val(path))?;
    Ok(LocalRef::Created {
        operation,
        path: path.to_vec(),
    })
}
fn qualified<I>(name: &str, plan: &mut PlanBuilder<'_, I>) -> Result<String, KwdjError> {
    bytes(plan, PREFIX.len().saturating_add(name.len()))?;
    Ok(format!("{PREFIX}{name}"))
}
fn key<I>(value: &str, plan: &mut PlanBuilder<'_, I>) -> Result<String, KwdjError> {
    plan.charged_copy_text(value)
        .map_err(KwdjError::operational)
}
fn attr<I>(
    plan: &mut PlanBuilder<'_, I>,
    node: LocalRef<I>,
    name: &str,
    value: Option<Attribute>,
) -> Result<(), KwdjError> {
    let key = key(name, plan)?;
    push(plan, Operation::SetAttribute { node, key, value })?;
    Ok(())
}
fn empty_node<I>(
    name: &str,
    primitive: Primitive,
    attributes: Attributes,
    plan: &mut PlanBuilder<'_, I>,
) -> Result<Node, KwdjError> {
    unit(plan, 1)?;
    bytes(plan, size_of::<Node>())?;
    Ok(Node {
        type_id: qualified(name, plan)?,
        primitive,
        attributes,
        marks: Vec::new(),
        text: None,
        children: Vec::new(),
    })
}
fn fragment<I>(
    plan: &mut PlanBuilder<'_, I>,
    parent: LocalRef<I>,
    index: usize,
    node: Node,
) -> Result<usize, KwdjError> {
    unit(plan, 1)?;
    bytes(plan, size_of::<Node>())?;
    push(
        plan,
        Operation::InsertFragment {
            parent,
            index,
            fragment: Document {
                children: vec![node],
            },
        },
    )
}
fn copy_header<I>(
    node: BorrowedNode<'_, I>,
    as_paragraph: bool,
    plan: &mut PlanBuilder<'_, I>,
) -> Result<Node, KwdjError> {
    let mut attributes = plan
        .charged_copy_attrs(node.attributes)
        .map_err(KwdjError::operational)?;
    if as_paragraph {
        attributes.remove("level");
    }
    empty_node(
        if as_paragraph {
            "paragraph"
        } else {
            kind(node.type_id)
        },
        node.primitive,
        attributes,
        plan,
    )
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
fn set_caret<I: Copy>(
    plan: &mut PlanBuilder<'_, I>,
    position: Position<LocalRef<I>>,
) -> Result<(), KwdjError> {
    let focus = match &position {
        Position::Text {
            leaf,
            utf16,
            affinity,
        } => Position::Text {
            leaf: copy_ref(leaf, plan)?,
            utf16: *utf16,
            affinity: *affinity,
        },
        Position::Child {
            parent,
            index,
            affinity,
        } => Position::Child {
            parent: copy_ref(parent, plan)?,
            index: *index,
            affinity: *affinity,
        },
        Position::Edge { node, side } => Position::Edge {
            node: copy_ref(node, plan)?,
            side: *side,
        },
    };
    plan.set_selection(SelectionIntent::MapFromUserResult(Some(Selection {
        anchor: position,
        focus,
    })))
    .map_err(KwdjError::operational)
}
fn selection<I: Copy>(state: CommandState<'_, I>) -> Result<Selection<I>, KwdjError> {
    state
        .selection
        .copied()
        .ok_or_else(|| refusal(KwdjErrorCode::CommandSelectionRequired))
}
fn caret_start<V: CandidateRead>(
    view: &V,
    block: LocalRef<V::Id>,
    tail: &[LocalRef<V::Id>],
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<(), KwdjError> {
    if let Some(first) = tail.first() {
        let text = match first {
            LocalRef::Created { .. } => true,
            LocalRef::Existing(id) => get(view, *id, plan)?.primitive == Primitive::Text,
        };
        if text {
            let leaf = copy_ref(first, plan)?;
            return set_caret(
                plan,
                Position::Text {
                    leaf,
                    utf16: Utf16Offset::new(0),
                    affinity: Affinity::After,
                },
            );
        }
    }
    set_caret(
        plan,
        Position::Child {
            parent: block,
            index: 0,
            affinity: Affinity::After,
        },
    )
}

pub(super) struct CutInline<I> {
    pub block: I,
    pub tail: Vec<LocalRef<I>>,
    pub at_start: bool,
    pub at_end: bool,
    deletion: Option<Selection<LocalRef<I>>>,
}

/// Make the surviving suffix addressable before one sealed range deletion.
/// Only the outside end is split; all selected old style boundaries are handled
/// atomically by ReplaceInlineRange, never by per-leaf scalar privileges.
pub(super) fn cut_inline_range<V: CandidateRead>(
    view: &V,
    range: Selection<V::Id>,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<CutInline<V::Id>, KwdjError> {
    let mut cut = prepare_inline_cut(view, range, plan)?;
    finish_inline_cut(&mut cut, plan)?;
    Ok(cut)
}

/// Address the suffix while the selected separator still protects its original
/// grapheme boundary. Recipes moving that suffix must finish deletion afterwards.
fn prepare_inline_cut<V: CandidateRead>(
    view: &V,
    range: Selection<V::Id>,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<CutInline<V::Id>, KwdjError> {
    let ordered = inline::ordered_range(view, range, plan.work())?;
    let start = inline::text_point(view, ordered.start, plan.work())?;
    let end = inline::text_point(view, ordered.end, plan.work())?;
    if start.block != end.block {
        return Err(unsupported());
    }
    let block = get(view, start.block, plan)?;
    let mut tail = Vec::new();
    let mut following = end.index;
    if let Some(leaf) = end.leaf {
        let text = get(view, leaf, plan)?.text.ok_or_else(invalid)?;
        bytes(plan, text.len())?;
        let length = text.encode_utf16().count();
        if end.utf16.get() > 0 && end.utf16.get() < length {
            let split = push(
                plan,
                Operation::SplitText {
                    leaf: leaf.into(),
                    at: end.utf16,
                },
            )?;
            let right = created(split, &[0], plan)?;
            bytes(plan, size_of::<LocalRef<V::Id>>())?;
            tail.push(right);
            following = end.index + 1;
        } else if end.utf16.get() == length {
            following = end.index + 1;
        }
    }
    unit(plan, block.children.len().saturating_sub(following))?;
    bytes(
        plan,
        block
            .children
            .len()
            .saturating_sub(following)
            .saturating_mul(size_of::<LocalRef<V::Id>>()),
    )?;
    tail.extend(
        block.children[following..]
            .iter()
            .copied()
            .map(LocalRef::Existing),
    );
    let deletion = (!ordered.is_empty).then(|| Selection {
        anchor: map_position(ordered.start),
        focus: Position::Child {
            parent: start.block.into(),
            index: following,
            affinity: Affinity::Before,
        },
    });
    let at_start = start.index == 0 && start.utf16.get() == 0;
    Ok(CutInline {
        block: start.block,
        at_start,
        at_end: tail.is_empty(),
        tail,
        deletion,
    })
}

fn finish_inline_cut<I>(
    cut: &mut CutInline<I>,
    plan: &mut PlanBuilder<'_, I>,
) -> Result<(), KwdjError> {
    if let Some(range) = cut.deletion.take() {
        push(
            plan,
            Operation::ReplaceInlineRange {
                range,
                inserted: None,
            },
        )?;
    }
    Ok(())
}

fn move_tail<I: Copy>(
    plan: &mut PlanBuilder<'_, I>,
    tail: Vec<LocalRef<I>>,
    parent: LocalRef<I>,
) -> Result<(), KwdjError> {
    if !tail.is_empty() {
        push(
            plan,
            Operation::MoveInlineGroup {
                nodes: tail,
                parent,
                before_index: 0,
            },
        )?;
    }
    Ok(())
}
fn paragraph_attrs<I>(
    node: BorrowedNode<'_, I>,
    plan: &mut PlanBuilder<'_, I>,
) -> Result<Attributes, KwdjError> {
    let mut attrs = plan
        .charged_copy_attrs(node.attributes)
        .map_err(KwdjError::operational)?;
    attrs.remove("level");
    Ok(attrs)
}
fn to_paragraph<I: Copy>(
    node: I,
    header: BorrowedNode<'_, I>,
    plan: &mut PlanBuilder<'_, I>,
) -> Result<(), KwdjError> {
    if header.attributes.contains_key("level") {
        attr(plan, node.into(), "level", None)?;
    }
    let type_id = qualified("paragraph", plan)?;
    push(
        plan,
        Operation::Transform {
            node: node.into(),
            type_id,
            primitive: Primitive::TextBlock,
        },
    )?;
    Ok(())
}
fn list_kind(name: &str) -> bool {
    matches!(name, "bullet_list" | "ordered_list" | "task_list")
}
fn item_kind(name: &str) -> bool {
    matches!(name, "list_item" | "task_item")
}
fn new_item_attrs<I>(
    old: BorrowedNode<'_, I>,
    plan: &mut PlanBuilder<'_, I>,
) -> Result<Attributes, KwdjError> {
    let mut attrs = plan
        .charged_copy_attrs(old.attributes)
        .map_err(KwdjError::operational)?;
    if kind(old.type_id) == "task_item" {
        let key = key("checked", plan)?;
        attrs.insert(key, Attribute::Boolean(false));
    }
    Ok(attrs)
}

fn outside_gap<V: CandidateRead>(
    view: &V,
    position: Position<V::Id>,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<Option<(V::Id, usize)>, KwdjError> {
    match position {
        Position::Child { parent, index, .. } => {
            let children = view.children(parent).ok_or_else(invalid)?;
            if index > children.len() {
                return Err(invalid());
            }
            if parent != view.root() && get(view, parent, plan)?.primitive != Primitive::Container {
                return Ok(None);
            }
            Ok(Some((parent, index)))
        }
        Position::Edge { node, side } => {
            let header = get(view, node, plan)?;
            if !matches!(
                header.primitive,
                Primitive::Container | Primitive::BlockAtom
            ) {
                return Ok(None);
            }
            Ok(Some((
                header.parent,
                index(view, header.parent, node, plan)? + usize::from(side == Edge::After),
            )))
        }
        Position::Text { .. } => Ok(None),
    }
}
fn enter_gap<V: CandidateRead>(
    view: &V,
    parent: V::Id,
    index: usize,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<CommandPresentation, KwdjError> {
    let parent_kind = if parent == view.root() {
        ""
    } else {
        kind(get(view, parent, plan)?.type_id)
    };
    if matches!(parent_kind, "table" | "table_row") {
        return Err(refusal(KwdjErrorCode::CommandTableUnavailable));
    }
    if parent_kind == "verse" {
        return Err(refusal(KwdjErrorCode::CommandPoetryUnavailable));
    }
    let paragraph = empty_node("paragraph", Primitive::TextBlock, Attributes::new(), plan)?;
    let (node, path) = if list_kind(parent_kind) {
        let mut attrs = Attributes::new();
        let item = if parent_kind == "task_list" {
            let key = key("checked", plan)?;
            attrs.insert(key, Attribute::Boolean(false));
            "task_item"
        } else {
            "list_item"
        };
        let mut node = empty_node(item, Primitive::Container, attrs, plan)?;
        bytes(plan, size_of::<Node>())?;
        node.children.push(paragraph);
        (node, &[0usize, 0][..])
    } else {
        (paragraph, &[0usize][..])
    };
    let operation = fragment(plan, parent.into(), index, node)?;
    let parent = created(operation, path, plan)?;
    set_caret(
        plan,
        Position::Child {
            parent,
            index: 0,
            affinity: Affinity::After,
        },
    )?;
    plan.set_stored_marks(StoredMarksUpdate::Inherit)
        .map_err(KwdjError::operational)?;
    Ok(CommandPresentation::default())
}

fn enter<V: CandidateRead>(
    view: &V,
    state: CommandState<'_, V::Id>,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<CommandPresentation, KwdjError> {
    let selected = selection(state)?;
    let ordered = inline::ordered_range(view, selected, plan.work())?;
    if ordered.is_empty
        && let Some((parent, index)) = outside_gap(view, selected.focus, plan)?
    {
        return enter_gap(view, parent, index, plan);
    }
    let start = inline::text_point(view, ordered.start, plan.work())?;
    let end = inline::text_point(view, ordered.end, plan.work())?;
    let header = get(view, start.block, plan)?;
    if kind(header.type_id) == "code_block" {
        if start.block != end.block {
            return cross_break(view, ordered.start, ordered.end, true, plan);
        }
        return inline::insert_text(view, state, "\n", plan);
    }
    if kind(header.type_id) == "verse_line" {
        return Err(refusal(KwdjErrorCode::CommandPoetryUnavailable));
    }
    if !matches!(kind(header.type_id), "paragraph" | "heading") {
        return Err(unsupported());
    }
    if start.block != end.block {
        return enter_cross_blocks(view, ordered.start, ordered.end, plan);
    }
    let mut cut = prepare_inline_cut(view, selected, plan)?;
    if kind(header.type_id) == "heading" && cut.at_start && cut.at_end {
        finish_inline_cut(&mut cut, plan)?;
        to_paragraph(cut.block, header, plan)?;
        set_caret(
            plan,
            Position::Child {
                parent: cut.block.into(),
                index: 0,
                affinity: Affinity::After,
            },
        )?;
        plan.set_stored_marks(StoredMarksUpdate::Inherit)
            .map_err(KwdjError::operational)?;
        return Ok(CommandPresentation::default());
    }
    let parent = header.parent;
    let parent_header = if parent == view.root() {
        None
    } else {
        Some(get(view, parent, plan)?)
    };
    if let Some(item) = parent_header
        && item_kind(kind(item.type_id))
    {
        let block_index = index(view, parent, cut.block, plan)?;
        if item.children.len() == 1 && cut.at_start && cut.at_end {
            finish_inline_cut(&mut cut, plan)?;
            exit_empty_item(view, parent, cut.block, plan)?;
        } else {
            split_item(view, parent, item, block_index, header, cut, plan)?;
        }
    } else if kind(header.type_id) == "heading" && cut.at_start {
        finish_inline_cut(&mut cut, plan)?;
        let at = index(view, parent, cut.block, plan)?;
        let attributes = paragraph_attrs(header, plan)?;
        let paragraph = empty_node("paragraph", Primitive::TextBlock, attributes, plan)?;
        fragment(plan, parent.into(), at, paragraph)?;
        caret_start(view, cut.block.into(), &cut.tail, plan)?;
    } else {
        let at = index(view, parent, cut.block, plan)? + 1;
        let target = copy_header(
            header,
            kind(header.type_id) == "heading" && cut.at_end,
            plan,
        )?;
        let inserted = fragment(plan, parent.into(), at, target)?;
        let next = created(inserted, &[0], plan)?;
        caret_start(view, copy_ref(&next, plan)?, &cut.tail, plan)?;
        move_tail(plan, std::mem::take(&mut cut.tail), next)?;
        finish_inline_cut(&mut cut, plan)?;
    }
    plan.set_stored_marks(StoredMarksUpdate::Inherit)
        .map_err(KwdjError::operational)?;
    Ok(CommandPresentation::default())
}

fn split_item<V: CandidateRead>(
    view: &V,
    item_id: V::Id,
    item: BorrowedNode<'_, V::Id>,
    block_index: usize,
    header: BorrowedNode<'_, V::Id>,
    mut cut: CutInline<V::Id>,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<(), KwdjError> {
    let list = get(view, item.parent, plan)?;
    if !list_kind(kind(list.type_id)) {
        return Err(unsupported());
    }
    let at = index(view, item.parent, item_id, plan)? + 1;
    let attributes = new_item_attrs(item, plan)?;
    let mut next_item = empty_node(kind(item.type_id), Primitive::Container, attributes, plan)?;
    let next_block = copy_header(
        header,
        kind(header.type_id) == "heading" && cut.at_end,
        plan,
    )?;
    bytes(plan, size_of::<Node>())?;
    next_item.children.push(next_block);
    let inserted = fragment(plan, item.parent.into(), at, next_item)?;
    let next_block = created(inserted, &[0, 0], plan)?;
    caret_start(view, copy_ref(&next_block, plan)?, &cut.tail, plan)?;
    move_tail(plan, std::mem::take(&mut cut.tail), next_block)?;
    finish_inline_cut(&mut cut, plan)?;
    if kind(header.type_id) == "heading" && cut.at_start {
        to_paragraph(cut.block, header, plan)?;
    }
    unit(plan, item.children.len().saturating_sub(block_index + 1))?;
    for (offset, child) in item.children[block_index + 1..].iter().enumerate() {
        let parent = created(inserted, &[0], plan)?;
        push(
            plan,
            Operation::Move {
                node: (*child).into(),
                parent,
                before_index: offset + 1,
            },
        )?;
    }
    Ok(())
}

fn trailing_list<V: CandidateRead>(
    view: &V,
    list_id: V::Id,
    list: BorrowedNode<'_, V::Id>,
    from: usize,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<Node, KwdjError> {
    let mut attrs = plan
        .charged_copy_attrs(list.attributes)
        .map_err(KwdjError::operational)?;
    if kind(list.type_id) == "ordered_list" {
        let start = match attrs.get("start") {
            Some(Attribute::Number(value)) => value.as_u64().ok_or_else(invalid)?,
            None => 1,
            _ => return Err(invalid()),
        };
        let next = start
            .checked_add(
                u64::try_from(from).map_err(|_| refusal(KwdjErrorCode::CommandOrderedOverflow))?,
            )
            .ok_or_else(|| refusal(KwdjErrorCode::CommandOrderedOverflow))?;
        let key = key("start", plan)?;
        attrs.insert(key, Attribute::Number(next.into()));
    }
    // The metadata-only list receives its original owned item subtrees by moves.
    let _ = (view, list_id);
    empty_node(kind(list.type_id), Primitive::Container, attrs, plan)
}

fn exit_empty_item<V: CandidateRead>(
    view: &V,
    item_id: V::Id,
    paragraph: V::Id,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<(), KwdjError> {
    let item = get(view, item_id, plan)?;
    let list_id = item.parent;
    let list = get(view, list_id, plan)?;
    let item_index = index(view, list_id, item_id, plan)?;
    let outer = if list.parent == view.root() {
        None
    } else {
        Some(get(view, list.parent, plan)?)
    };
    if let Some(outer_item) = outer
        && item_kind(kind(outer_item.type_id))
    {
        lift_empty_item(
            view, item_id, paragraph, item, list_id, list, item_index, outer_item, plan,
        )?;
    } else {
        let parent = list.parent;
        let at = index(view, parent, list_id, plan)?;
        let place = at + usize::from(item_index > 0);
        push(
            plan,
            Operation::Move {
                node: paragraph.into(),
                parent: parent.into(),
                before_index: place,
            },
        )?;
        let trailing = item_index + 1;
        if trailing < list.children.len() {
            let tail = trailing_list(view, list_id, list, trailing, plan)?;
            let operation = fragment(plan, parent.into(), place + 1, tail)?;
            unit(plan, list.children.len() - trailing)?;
            for (offset, child) in list.children[trailing..].iter().enumerate() {
                let parent = created(operation, &[0], plan)?;
                push(
                    plan,
                    Operation::Move {
                        node: (*child).into(),
                        parent,
                        before_index: offset,
                    },
                )?;
            }
        }
        push(
            plan,
            Operation::Remove {
                node: item_id.into(),
            },
        )?;
        if item_index == 0 {
            push(
                plan,
                Operation::Remove {
                    node: list_id.into(),
                },
            )?;
        }
        set_caret(
            plan,
            Position::Child {
                parent: paragraph.into(),
                index: 0,
                affinity: Affinity::After,
            },
        )?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn lift_empty_item<V: CandidateRead>(
    view: &V,
    item_id: V::Id,
    paragraph: V::Id,
    item: BorrowedNode<'_, V::Id>,
    list_id: V::Id,
    list: BorrowedNode<'_, V::Id>,
    item_index: usize,
    outer_item: BorrowedNode<'_, V::Id>,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<(), KwdjError> {
    let outer_item_id = list.parent;
    let outer_list = get(view, outer_item.parent, plan)?;
    if !list_kind(kind(outer_list.type_id)) {
        return Err(unsupported());
    }
    let desired = if kind(outer_list.type_id) == "task_list" {
        "task_item"
    } else {
        "list_item"
    };
    if kind(item.type_id) != desired {
        if !item.attributes.is_empty() {
            return Err(lossy());
        }
        let type_id = qualified(desired, plan)?;
        push(
            plan,
            Operation::Transform {
                node: item_id.into(),
                type_id,
                primitive: Primitive::Container,
            },
        )?;
        if desired == "task_item" {
            attr(
                plan,
                item_id.into(),
                "checked",
                Some(Attribute::Boolean(false)),
            )?;
        }
    }
    let inner_index = index(view, outer_item_id, list_id, plan)?;
    let mut next_child = 1;
    if item_index + 1 < list.children.len() {
        let tail = trailing_list(view, list_id, list, item_index + 1, plan)?;
        let operation = fragment(plan, item_id.into(), 1, tail)?;
        unit(plan, list.children.len() - item_index - 1)?;
        for (offset, child) in list.children[item_index + 1..].iter().enumerate() {
            let parent = created(operation, &[0], plan)?;
            push(
                plan,
                Operation::Move {
                    node: (*child).into(),
                    parent,
                    before_index: offset,
                },
            )?;
        }
        next_child += 1;
    }
    unit(
        plan,
        outer_item.children.len().saturating_sub(inner_index + 1),
    )?;
    for child in &outer_item.children[inner_index + 1..] {
        push(
            plan,
            Operation::Move {
                node: (*child).into(),
                parent: item_id.into(),
                before_index: next_child,
            },
        )?;
        next_child += 1;
    }
    let at = index(view, outer_item.parent, outer_item_id, plan)? + 1;
    push(
        plan,
        Operation::Move {
            node: item_id.into(),
            parent: outer_item.parent.into(),
            before_index: at,
        },
    )?;
    if item_index == 0 {
        push(
            plan,
            Operation::Remove {
                node: list_id.into(),
            },
        )?;
        if inner_index == 0 {
            let paragraph = empty_node("paragraph", Primitive::TextBlock, Attributes::new(), plan)?;
            fragment(plan, outer_item_id.into(), 0, paragraph)?;
        }
    }
    set_caret(
        plan,
        Position::Child {
            parent: paragraph.into(),
            index: 0,
            affinity: Affinity::After,
        },
    )
}

fn enter_cross_blocks<V: CandidateRead>(
    view: &V,
    start: Position<V::Id>,
    end: Position<V::Id>,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<CommandPresentation, KwdjError> {
    let a = inline::text_point(view, start, plan.work())?;
    let b = inline::text_point(view, end, plan.work())?;
    let left = get(view, a.block, plan)?;
    let right = get(view, b.block, plan)?;
    if left.parent != right.parent || !matches!(kind(right.type_id), "paragraph" | "heading") {
        return Err(unsupported());
    }
    let siblings = view.children(left.parent).ok_or_else(invalid)?;
    let from = index(view, left.parent, a.block, plan)?;
    let to = index(view, left.parent, b.block, plan)?;
    if from >= to {
        return Err(invalid());
    }
    push(
        plan,
        Operation::ReplaceInlineRange {
            range: Selection {
                anchor: map_position(start),
                focus: Position::Child {
                    parent: a.block.into(),
                    index: left.children.len(),
                    affinity: Affinity::Before,
                },
            },
            inserted: None,
        },
    )?;
    // A safe public split makes a surviving right suffix targetable after the
    // sealed prefix deletion; the whole original right block identity remains.
    let cut = cut_inline_range(
        view,
        Selection {
            anchor: Position::Child {
                parent: b.block,
                index: 0,
                affinity: Affinity::After,
            },
            focus: end,
        },
        plan,
    )?;
    unit(plan, to - from - 1)?;
    for child in &siblings[from + 1..to] {
        push(
            plan,
            Operation::Remove {
                node: (*child).into(),
            },
        )?;
    }
    caret_start(view, b.block.into(), &cut.tail, plan)?;
    plan.set_stored_marks(StoredMarksUpdate::Inherit)
        .map_err(KwdjError::operational)?;
    Ok(CommandPresentation::default())
}

/// Replace a compatible cross-block range with one line boundary. The sealed
/// left splice owns insertion admission against original endpoints; a group
/// move preserves the complete right suffix across its old style seams.
fn cross_break<V: CandidateRead>(
    view: &V,
    start: Position<V::Id>,
    end: Position<V::Id>,
    literal_lf: bool,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<CommandPresentation, KwdjError> {
    let a = inline::text_point(view, start, plan.work())?;
    let b = inline::text_point(view, end, plan.work())?;
    let left = get(view, a.block, plan)?;
    let right = get(view, b.block, plan)?;
    let left_attrs = plan
        .charged_copy_attrs(left.attributes)
        .map_err(KwdjError::operational)?;
    let right_attrs = plan
        .charged_copy_attrs(right.attributes)
        .map_err(KwdjError::operational)?;
    if left.parent != right.parent {
        return Err(unsupported());
    }
    if left.type_id != right.type_id || left_attrs != right_attrs {
        return Err(lossy());
    }
    let from = index(view, left.parent, a.block, plan)?;
    let to = index(view, left.parent, b.block, plan)?;
    if from >= to {
        return Err(invalid());
    }
    let right_cut = cut_inline_range(
        view,
        Selection {
            anchor: Position::Child {
                parent: b.block,
                index: 0,
                affinity: Affinity::After,
            },
            focus: end,
        },
        plan,
    )?;
    let mut node = empty_node(
        if literal_lf { "text" } else { "hard_break" },
        if literal_lf {
            Primitive::Text
        } else {
            Primitive::HardBreak
        },
        Attributes::new(),
        plan,
    )?;
    if literal_lf {
        node.text = Some(key("\n", plan)?);
    }
    let inserted = push(
        plan,
        Operation::ReplaceInlineRange {
            range: Selection {
                anchor: map_position(start),
                focus: Position::Child {
                    parent: a.block.into(),
                    index: left.children.len(),
                    affinity: Affinity::Before,
                },
            },
            inserted: Some(node),
        },
    )?;
    let before_index = a.index + usize::from(a.leaf.is_some() && a.utf16.get() > 0) + 1;
    if !right_cut.tail.is_empty() {
        push(
            plan,
            Operation::MoveInlineGroup {
                nodes: right_cut.tail,
                parent: a.block.into(),
                before_index,
            },
        )?;
    }
    let siblings = view.children(left.parent).ok_or_else(invalid)?;
    unit(plan, to - from)?;
    for id in &siblings[from + 1..=to] {
        push(plan, Operation::Remove { node: (*id).into() })?;
    }
    let node = created(inserted, &[0], plan)?;
    if literal_lf {
        set_caret(
            plan,
            Position::Text {
                leaf: node,
                utf16: Utf16Offset::new(1),
                affinity: Affinity::After,
            },
        )?;
    } else {
        set_caret(
            plan,
            Position::Edge {
                node,
                side: Edge::After,
            },
        )?;
    }
    plan.set_stored_marks(StoredMarksUpdate::Inherit)
        .map_err(KwdjError::operational)?;
    Ok(CommandPresentation::default())
}

fn target_node<I>(target: &BlockTarget, plan: &mut PlanBuilder<'_, I>) -> Result<Node, KwdjError> {
    let mut attrs = Attributes::new();
    let (name, primitive) = match target {
        BlockTarget::Paragraph => ("paragraph", Primitive::TextBlock),
        BlockTarget::Heading { level } if (1..=6).contains(level) => {
            let key = key("level", plan)?;
            attrs.insert(key, Attribute::Number((*level).into()));
            ("heading", Primitive::TextBlock)
        }
        BlockTarget::Heading { .. } => return Err(invalid()),
        BlockTarget::CodeBlock { language } => {
            if let Some(language) = language {
                let value = plan
                    .charged_copy_text(language)
                    .map_err(KwdjError::operational)?;
                let key = key("language", plan)?;
                attrs.insert(key, Attribute::String(value));
            }
            ("code_block", Primitive::TextBlock)
        }
        BlockTarget::Blockquote => ("blockquote", Primitive::Container),
        BlockTarget::BulletList => ("bullet_list", Primitive::Container),
        BlockTarget::OrderedList { start } if *start > 0 => {
            if *start != 1 {
                let key = key("start", plan)?;
                attrs.insert(key, Attribute::Number((*start).into()));
            }
            ("ordered_list", Primitive::Container)
        }
        BlockTarget::OrderedList { .. } => return Err(invalid()),
        BlockTarget::TaskList => ("task_list", Primitive::Container),
        BlockTarget::SceneBreak => ("scene_break", Primitive::BlockAtom),
        BlockTarget::Table => return Err(refusal(KwdjErrorCode::CommandTableUnavailable)),
        BlockTarget::Poetry => return Err(refusal(KwdjErrorCode::CommandPoetryUnavailable)),
        BlockTarget::Media => return Err(refusal(KwdjErrorCode::CommandHostRequired)),
    };
    let mut node = empty_node(name, primitive, attrs, plan)?;
    if name == "blockquote" {
        let child = empty_node("paragraph", Primitive::TextBlock, Attributes::new(), plan)?;
        bytes(plan, size_of::<Node>())?;
        node.children.push(child);
    } else if list_kind(name) {
        let item_name = if name == "task_list" {
            "task_item"
        } else {
            "list_item"
        };
        let mut attrs = Attributes::new();
        if item_name == "task_item" {
            let key = key("checked", plan)?;
            attrs.insert(key, Attribute::Boolean(false));
        }
        let mut item = empty_node(item_name, Primitive::Container, attrs, plan)?;
        let paragraph = empty_node("paragraph", Primitive::TextBlock, Attributes::new(), plan)?;
        bytes(plan, size_of::<Node>().saturating_mul(2))?;
        item.children.push(paragraph);
        node.children.push(item);
    }
    Ok(node)
}

fn selected_blocks<V: CandidateRead>(
    view: &V,
    state: CommandState<'_, V::Id>,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<Vec<V::Id>, KwdjError> {
    let selected = selection(state)?;
    let range = inline::ordered_range(view, selected, plan.work())?;
    if range.blocks.is_empty() {
        let id = inline::text_point(view, selected.focus, plan.work())?.block;
        bytes(plan, size_of::<V::Id>())?;
        return Ok(vec![id]);
    }
    Ok(range.blocks)
}

fn transform<V: CandidateRead>(
    view: &V,
    state: CommandState<'_, V::Id>,
    target: &BlockTarget,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<CommandPresentation, KwdjError> {
    if matches!(target, BlockTarget::Blockquote) {
        return toggle_quote(view, state, plan);
    }
    let list = match target {
        BlockTarget::BulletList => Some(ListKind::Bullet),
        BlockTarget::OrderedList { start } => Some(ListKind::Ordered { start: *start }),
        BlockTarget::TaskList => Some(ListKind::Task),
        _ => None,
    };
    if let Some(kind) = list {
        return toggle_list(view, state, kind, plan);
    }
    if matches!(
        target,
        BlockTarget::Table | BlockTarget::Poetry | BlockTarget::Media
    ) {
        target_node(target, plan)?;
        unreachable!();
    }
    let blocks = selected_blocks(view, state, plan)?;
    let mut matching = 0;
    let mut reset_typing = false;
    for id in &blocks {
        let node = get(view, *id, plan)?;
        let source = kind(node.type_id);
        match target {
            BlockTarget::Paragraph | BlockTarget::Heading { .. } => {
                if !matches!(source, "paragraph" | "heading" | "code_block") {
                    return Err(unsupported());
                }
                if source == "code_block" && !node.attributes.is_empty() {
                    return Err(lossy());
                }
                match target {
                    BlockTarget::Paragraph => {
                        matching += usize::from(source == "paragraph");
                        if source != "paragraph" {
                            to_paragraph(*id, node, plan)?;
                        }
                    }
                    BlockTarget::Heading { level } => {
                        if !(1..=6).contains(level) {
                            return Err(invalid());
                        }
                        matching += usize::from(
                            source == "heading"
                                && matches!(node.attributes.get("level"),Some(Attribute::Number(value)) if value.as_u64()==Some(u64::from(*level))),
                        );
                        attr(
                            plan,
                            (*id).into(),
                            "level",
                            Some(Attribute::Number((*level).into())),
                        )?;
                        let type_id = qualified("heading", plan)?;
                        push(
                            plan,
                            Operation::Transform {
                                node: (*id).into(),
                                type_id,
                                primitive: Primitive::TextBlock,
                            },
                        )?;
                    }
                    _ => unreachable!(),
                }
            }
            BlockTarget::CodeBlock { language } => {
                if !matches!(source, "paragraph" | "heading" | "code_block") {
                    return Err(unsupported());
                }
                unit(plan, node.attributes.len())?;
                if source != "code_block" && node.attributes.keys().any(|key| key != "level") {
                    return Err(lossy());
                }
                unit(plan, node.children.len())?;
                for (position, child) in node.children.iter().enumerate() {
                    let inline = get(view, *child, plan)?;
                    if !inline.marks.is_empty() {
                        return Err(lossy());
                    }
                    if inline.primitive == Primitive::HardBreak {
                        let mut text =
                            empty_node("text", Primitive::Text, Attributes::new(), plan)?;
                        text.text = Some(key("\n", plan)?);
                        fragment(plan, (*id).into(), position, text)?;
                        push(
                            plan,
                            Operation::Remove {
                                node: (*child).into(),
                            },
                        )?;
                    } else if inline.primitive != Primitive::Text {
                        return Err(lossy());
                    }
                }
                if source == "heading" {
                    attr(plan, (*id).into(), "level", None)?;
                }
                if let Some(language) = language {
                    reset_typing |= !matches!(node.attributes.get("language"),Some(Attribute::String(current)) if current==language);
                    let value = plan
                        .charged_copy_text(language)
                        .map_err(KwdjError::operational)?;
                    attr(
                        plan,
                        (*id).into(),
                        "language",
                        Some(Attribute::String(value)),
                    )?;
                }
                matching += usize::from(source == "code_block");
                reset_typing |= source != "code_block";
                let type_id = qualified("code_block", plan)?;
                push(
                    plan,
                    Operation::Transform {
                        node: (*id).into(),
                        type_id,
                        primitive: Primitive::TextBlock,
                    },
                )?;
            }
            BlockTarget::SceneBreak => {
                reset_typing = true;
                if !matches!(source, "paragraph" | "heading")
                    || !node.children.is_empty()
                    || !node.attributes.is_empty()
                {
                    return Err(lossy());
                }
                let type_id = qualified("scene_break", plan)?;
                push(
                    plan,
                    Operation::Transform {
                        node: (*id).into(),
                        type_id,
                        primitive: Primitive::BlockAtom,
                    },
                )?;
                set_caret(
                    plan,
                    Position::Edge {
                        node: (*id).into(),
                        side: Edge::After,
                    },
                )?;
            }
            _ => return Err(unsupported()),
        }
    }
    if reset_typing {
        plan.set_stored_marks(StoredMarksUpdate::Inherit)
            .map_err(KwdjError::operational)?;
    }
    let active = if matching == 0 {
        ActiveState::Off
    } else if matching == blocks.len() {
        ActiveState::On
    } else {
        ActiveState::Mixed
    };
    Ok(CommandPresentation {
        active: Some(active),
    })
}

fn unwrap_container<V: CandidateRead>(
    view: &V,
    container: V::Id,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<(), KwdjError> {
    let node = get(view, container, plan)?;
    let at = index(view, node.parent, container, plan)?;
    unit(plan, node.children.len())?;
    for (offset, child) in node.children.iter().enumerate() {
        push(
            plan,
            Operation::Move {
                node: (*child).into(),
                parent: node.parent.into(),
                before_index: at + offset,
            },
        )?;
    }
    push(
        plan,
        Operation::Remove {
            node: container.into(),
        },
    )?;
    Ok(())
}
fn toggle_quote<V: CandidateRead>(
    view: &V,
    state: CommandState<'_, V::Id>,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<CommandPresentation, KwdjError> {
    let blocks = selected_blocks(view, state, plan)?;
    let first = *blocks.first().ok_or_else(unsupported)?;
    let node = get(view, first, plan)?;
    let parent = node.parent;
    let at = require_contiguous_blocks(view, &blocks, parent, plan)?;
    if node.parent != view.root() && kind(get(view, node.parent, plan)?.type_id) == "blockquote" {
        unwrap_container(view, node.parent, plan)?;
        return Ok(CommandPresentation {
            active: Some(ActiveState::On),
        });
    }
    let quote = empty_node("blockquote", Primitive::Container, Attributes::new(), plan)?;
    let operation = fragment(plan, parent.into(), at, quote)?;
    for (offset, block) in blocks.iter().enumerate() {
        let parent = created(operation, &[0], plan)?;
        push(
            plan,
            Operation::Move {
                node: (*block).into(),
                parent,
                before_index: offset,
            },
        )?;
    }
    Ok(CommandPresentation {
        active: Some(ActiveState::Off),
    })
}

fn require_contiguous_blocks<V: CandidateRead>(
    view: &V,
    blocks: &[V::Id],
    parent: V::Id,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<usize, KwdjError> {
    let first = *blocks.first().ok_or_else(unsupported)?;
    let at = index(view, parent, first, plan)?;
    unit(plan, blocks.len())?;
    for (offset, block) in blocks.iter().enumerate() {
        let header = get(view, *block, plan)?;
        if header.parent != parent || index(view, parent, *block, plan)? != at + offset {
            return Err(unsupported());
        }
    }
    Ok(at)
}

/// Unwrap/convert may affect the whole containing list, but every selected block
/// must belong to that same list and form one contiguous direct-item span.
fn require_same_list<V: CandidateRead>(
    view: &V,
    blocks: &[V::Id],
    list: V::Id,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<(), KwdjError> {
    unit(plan, blocks.len())?;
    let mut previous = None;
    for block in blocks {
        let header = get(view, *block, plan)?;
        if header.parent == view.root() {
            return Err(unsupported());
        }
        let item = get(view, header.parent, plan)?;
        if !item_kind(kind(item.type_id)) || item.parent != list {
            return Err(unsupported());
        }
        let item_index = index(view, list, header.parent, plan)?;
        let block_index = index(view, header.parent, *block, plan)?;
        if let Some((old_item, old_block, old_length)) = previous {
            let adjacent = if item_index == old_item {
                block_index == old_block + 1
            } else {
                item_index == old_item + 1 && old_block + 1 == old_length && block_index == 0
            };
            if !adjacent {
                return Err(unsupported());
            }
        }
        previous = Some((item_index, block_index, item.children.len()));
    }
    Ok(())
}

fn list_target(kind: ListKind) -> BlockTarget {
    match kind {
        ListKind::Bullet => BlockTarget::BulletList,
        ListKind::Ordered { start } => BlockTarget::OrderedList { start },
        ListKind::Task => BlockTarget::TaskList,
    }
}
fn list_matches(name: &str, wanted: ListKind) -> bool {
    matches!(
        (name, wanted),
        ("bullet_list", ListKind::Bullet)
            | ("ordered_list", ListKind::Ordered { .. })
            | ("task_list", ListKind::Task)
    )
}
fn unwrap_list<V: CandidateRead>(
    view: &V,
    list_id: V::Id,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<(), KwdjError> {
    let list = get(view, list_id, plan)?;
    let mut at = index(view, list.parent, list_id, plan)?;
    unit(plan, list.children.len())?;
    for item in list.children {
        let item = get(view, *item, plan)?;
        unit(plan, item.children.len())?;
        for child in item.children {
            push(
                plan,
                Operation::Move {
                    node: (*child).into(),
                    parent: list.parent.into(),
                    before_index: at,
                },
            )?;
            at += 1;
        }
    }
    push(
        plan,
        Operation::Remove {
            node: list_id.into(),
        },
    )?;
    Ok(())
}
fn toggle_list<V: CandidateRead>(
    view: &V,
    state: CommandState<'_, V::Id>,
    wanted: ListKind,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<CommandPresentation, KwdjError> {
    if matches!(wanted, ListKind::Ordered { start: 0 }) {
        return Err(invalid());
    }
    let blocks = selected_blocks(view, state, plan)?;
    let first = *blocks.first().ok_or_else(unsupported)?;
    let header = get(view, first, plan)?;
    if header.parent != view.root() {
        let item = get(view, header.parent, plan)?;
        if item_kind(kind(item.type_id)) {
            let list = get(view, item.parent, plan)?;
            require_same_list(view, &blocks, item.parent, plan)?;
            if list_matches(kind(list.type_id), wanted) {
                unwrap_list(view, item.parent, plan)?;
                return Ok(CommandPresentation {
                    active: Some(ActiveState::On),
                });
            }
            if !list_kind(kind(list.type_id)) {
                return Err(unsupported());
            }
            // Existing authored start/checked metadata cannot disappear merely
            // to make a different list kind admissible.
            if !list.attributes.is_empty() || kind(list.type_id) == "task_list" {
                return Err(lossy());
            }
            let target = list_target(wanted);
            let target_node = target_node(&target, plan)?;
            let type_id = target_node.type_id;
            for (key, value) in target_node.attributes {
                attr(plan, item.parent.into(), &key, Some(value))?;
            }
            if matches!(wanted, ListKind::Task) {
                unit(plan, list.children.len())?;
                for item in list.children {
                    let type_id = qualified("task_item", plan)?;
                    push(
                        plan,
                        Operation::Transform {
                            node: (*item).into(),
                            type_id,
                            primitive: Primitive::Container,
                        },
                    )?;
                    attr(
                        plan,
                        (*item).into(),
                        "checked",
                        Some(Attribute::Boolean(false)),
                    )?;
                }
            }
            push(
                plan,
                Operation::Transform {
                    node: item.parent.into(),
                    type_id,
                    primitive: Primitive::Container,
                },
            )?;
            return Ok(CommandPresentation {
                active: Some(ActiveState::Off),
            });
        }
    }
    let parent = header.parent;
    let at = require_contiguous_blocks(view, &blocks, parent, plan)?;
    let mut list = target_node(&list_target(wanted), plan)?;
    // Existing blocks, rather than cloned text, fill these new item shells.
    list.children.clear();
    for _ in &blocks {
        let mut attrs = Attributes::new();
        let name = if matches!(wanted, ListKind::Task) {
            let key = key("checked", plan)?;
            attrs.insert(key, Attribute::Boolean(false));
            "task_item"
        } else {
            "list_item"
        };
        let item = empty_node(name, Primitive::Container, attrs, plan)?;
        bytes(plan, size_of::<Node>())?;
        list.children.push(item);
    }
    let operation = fragment(plan, parent.into(), at, list)?;
    for (offset, block) in blocks.iter().enumerate() {
        let parent = created(operation, &[0, offset], plan)?;
        push(
            plan,
            Operation::Move {
                node: (*block).into(),
                parent,
                before_index: 0,
            },
        )?;
    }
    Ok(CommandPresentation {
        active: Some(ActiveState::Off),
    })
}

fn verify_query<V: CandidateRead>(
    view: &V,
    state: CommandState<'_, V::Id>,
    range: Selection<V::Id>,
    literal: &str,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<(), KwdjError> {
    bytes(plan, literal.len())?;
    if !literal.starts_with('/') {
        return Err(refusal(KwdjErrorCode::CommandQueryMismatch));
    }
    let ordered = inline::ordered_range(view, range, plan.work())?;
    let a = inline::text_point(view, ordered.start, plan.work())?;
    let b = inline::text_point(view, ordered.end, plan.work())?;
    if a.block != b.block {
        return Err(refusal(KwdjErrorCode::CommandQueryMismatch));
    }
    let current = selection(state)?;
    if !inline::ordered_range(view, current, plan.work())?.is_empty {
        return Err(refusal(KwdjErrorCode::CommandQueryMismatch));
    }
    if !inline::ordered_range(
        view,
        Selection {
            anchor: current.focus,
            focus: ordered.end,
        },
        plan.work(),
    )?
    .is_empty
    {
        return Err(refusal(KwdjErrorCode::CommandQueryMismatch));
    }
    let mut offset = 0usize;
    for span in &ordered.spans {
        let text = get(view, span.leaf, plan)?.text.ok_or_else(invalid)?;
        bytes(plan, text.len().saturating_mul(2))?;
        let from = utf16_to_utf8(text, span.from).map_err(|_| invalid())?.get();
        let to = utf16_to_utf8(text, span.to).map_err(|_| invalid())?.get();
        let part = &text[from..to];
        bytes(plan, part.len())?;
        if literal
            .as_bytes()
            .get(offset..offset.saturating_add(part.len()))
            != Some(part.as_bytes())
        {
            return Err(refusal(KwdjErrorCode::CommandQueryMismatch));
        }
        offset += part.len();
    }
    if offset != literal.len() {
        return Err(refusal(KwdjErrorCode::CommandQueryMismatch));
    }
    // A query cannot cross an atom/hard break merely because their text was
    // absent from the borrowed span list.
    let block = get(view, a.block, plan)?;
    let last = b.index + usize::from(b.leaf.is_some() && b.utf16.get() > 0);
    unit(plan, last.saturating_sub(a.index))?;
    for id in &block.children[a.index..last.min(block.children.len())] {
        if get(view, *id, plan)?.primitive != Primitive::Text {
            return Err(refusal(KwdjErrorCode::CommandQueryMismatch));
        }
    }
    Ok(())
}

fn insert_block<V: CandidateRead>(
    view: &V,
    state: CommandState<'_, V::Id>,
    target: &BlockTarget,
    query: Option<(Selection<V::Id>, &str)>,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<CommandPresentation, KwdjError> {
    if query.is_some()
        && !KWDJ_SLASH_CANDIDATES
            .iter()
            .any(|entry| entry.target == *target)
    {
        return Err(invalid());
    }
    // Reject missing future providers before producing a partial plan.
    let node = target_node(target, plan)?;
    let selected = if let Some((range, literal)) = query {
        verify_query(view, state, range, literal, plan)?;
        range
    } else {
        selection(state)?
    };
    if query.is_none()
        && inline::ordered_range(view, selected, plan.work())?.is_empty
        && let Some((parent, index)) = outside_gap(view, selected.focus, plan)?
    {
        let is_atom = matches!(target, BlockTarget::SceneBreak);
        let caret_path = match target {
            BlockTarget::Blockquote => &[0usize, 0][..],
            BlockTarget::BulletList | BlockTarget::OrderedList { .. } | BlockTarget::TaskList => {
                &[0usize, 0, 0][..]
            }
            _ => &[0usize][..],
        };
        let operation = fragment(plan, parent.into(), index, node)?;
        let caret_node = created(operation, caret_path, plan)?;
        if is_atom {
            set_caret(
                plan,
                Position::Edge {
                    node: caret_node,
                    side: Edge::After,
                },
            )?;
        } else {
            set_caret(
                plan,
                Position::Child {
                    parent: caret_node,
                    index: 0,
                    affinity: Affinity::After,
                },
            )?;
        }
        plan.set_stored_marks(StoredMarksUpdate::Inherit)
            .map_err(KwdjError::operational)?;
        return Ok(CommandPresentation::default());
    }
    let mut cut = prepare_inline_cut(view, selected, plan)?;
    let header = get(view, cut.block, plan)?;
    if !matches!(kind(header.type_id), "paragraph" | "heading") {
        return Err(unsupported());
    }
    let at = index(view, header.parent, cut.block, plan)?;
    fragment(plan, header.parent.into(), at + 1, node)?;
    let trailing = copy_header(header, false, plan)?;
    let operation = fragment(plan, header.parent.into(), at + 2, trailing)?;
    let parent = created(operation, &[0], plan)?;
    caret_start(view, copy_ref(&parent, plan)?, &cut.tail, plan)?;
    move_tail(plan, std::mem::take(&mut cut.tail), parent)?;
    finish_inline_cut(&mut cut, plan)?;
    plan.set_stored_marks(StoredMarksUpdate::Inherit)
        .map_err(KwdjError::operational)?;
    Ok(CommandPresentation::default())
}

fn structural<'a, V: CandidateRead>(
    view: &'a V,
    id: V::Id,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<BorrowedNode<'a, V::Id>, KwdjError> {
    let node = get(view, id, plan)?;
    if !matches!(
        node.primitive,
        Primitive::TextBlock | Primitive::Container | Primitive::BlockAtom
    ) {
        return Err(invalid());
    }
    Ok(node)
}
fn needs_child(name: &str) -> bool {
    matches!(
        name,
        "blockquote"
            | "list_item"
            | "task_item"
            | "table_cell"
            | "table_header"
            | "literary_block"
            | "warning"
            | "spoiler"
            | "disclosure"
    )
}
fn remove<V: CandidateRead>(
    view: &V,
    id: V::Id,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<(), KwdjError> {
    let mut target = id;
    let mut node = structural(view, id, plan)?;
    while node.parent != view.root() {
        let parent = get(view, node.parent, plan)?;
        if list_kind(kind(parent.type_id)) && parent.children.len() == 1 {
            target = node.parent;
            node = parent;
        } else {
            break;
        }
    }
    let parent = node.parent;
    let siblings = view.children(parent).ok_or_else(invalid)?;
    let at = index(view, parent, target, plan)?;
    let must_replace = siblings.len() == 1
        && (parent == view.root() || needs_child(kind(get(view, parent, plan)?.type_id)));
    if must_replace {
        let paragraph = empty_node("paragraph", Primitive::TextBlock, Attributes::new(), plan)?;
        let operation = fragment(plan, parent.into(), at, paragraph)?;
        let parent = created(operation, &[0], plan)?;
        set_caret(
            plan,
            Position::Child {
                parent,
                index: 0,
                affinity: Affinity::After,
            },
        )?;
    } else {
        set_caret(
            plan,
            Position::Child {
                parent: parent.into(),
                index: at.min(siblings.len() - 1),
                affinity: Affinity::After,
            },
        )?;
    }
    push(
        plan,
        Operation::Remove {
            node: target.into(),
        },
    )?;
    plan.set_stored_marks(StoredMarksUpdate::Inherit)
        .map_err(KwdjError::operational)?;
    Ok(())
}

pub(super) fn prepare<V: CandidateRead>(
    _context: Profile,
    view: &V,
    state: CommandState<'_, V::Id>,
    intent: &KwdjIntent<V::Id>,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<CommandPresentation, KwdjError> {
    match intent {
        KwdjIntent::Enter => enter(view, state, plan),
        KwdjIntent::ShiftEnter => {
            let selected = selection(state)?;
            let ordered = inline::ordered_range(view, selected, plan.work())?;
            let start = inline::text_point(view, ordered.start, plan.work())?;
            let end = inline::text_point(view, ordered.end, plan.work())?;
            let literal_lf = kind(get(view, start.block, plan)?.type_id) == "code_block";
            if start.block != end.block {
                return cross_break(view, ordered.start, ordered.end, literal_lf, plan);
            }
            if literal_lf {
                return inline::insert_text(view, state, "\n", plan);
            }
            let hard_break =
                empty_node("hard_break", Primitive::HardBreak, Attributes::new(), plan)?;
            let operation = push(
                plan,
                Operation::ReplaceInlineRange {
                    range: Selection {
                        anchor: map_position(selected.anchor),
                        focus: map_position(selected.focus),
                    },
                    inserted: Some(hard_break),
                },
            )?;
            let node = created(operation, &[0], plan)?;
            set_caret(
                plan,
                Position::Edge {
                    node,
                    side: Edge::After,
                },
            )?;
            Ok(CommandPresentation::default())
        }
        KwdjIntent::TransformBlock { target } => transform(view, state, target, plan),
        KwdjIntent::ToggleQuote => toggle_quote(view, state, plan),
        KwdjIntent::ToggleList { kind } => toggle_list(view, state, *kind, plan),
        KwdjIntent::InsertBlock { target } => insert_block(view, state, target, None, plan),
        KwdjIntent::AcceptSlash {
            target,
            range,
            literal,
        } => insert_block(view, state, target, Some((*range, literal)), plan),
        KwdjIntent::Move {
            node,
            parent,
            before_index,
        } => {
            structural(view, *node, plan)?;
            push(
                plan,
                Operation::Move {
                    node: (*node).into(),
                    parent: (*parent).into(),
                    before_index: *before_index,
                },
            )?;
            Ok(CommandPresentation::default())
        }
        KwdjIntent::Duplicate {
            node,
            parent,
            index,
        } => {
            structural(view, *node, plan)?;
            push(
                plan,
                Operation::Duplicate {
                    node: (*node).into(),
                    parent: (*parent).into(),
                    index: *index,
                },
            )?;
            Ok(CommandPresentation::default())
        }
        KwdjIntent::Remove { node } => {
            remove(view, *node, plan)?;
            Ok(CommandPresentation::default())
        }
        _ => Err(refusal(KwdjErrorCode::CommandUnknown)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{IdentityResolver, IdentityResolverError, IdentityStatus};
    use editor_core::commands::{CommandPlan, validate_catalog};
    use editor_core::transaction::{WorkLimits, WorkMeter};
    use serde_json::{Value, json};
    use std::collections::BTreeMap;

    struct Identities;
    impl IdentityResolver for Identities {
        fn resolve_media(&self, _: &uuid::Uuid) -> Result<IdentityStatus, IdentityResolverError> {
            Ok(IdentityStatus::Exists)
        }
        fn resolve_reference(
            &self,
            _: &uuid::Uuid,
        ) -> Result<IdentityStatus, IdentityResolverError> {
            Ok(IdentityStatus::Exists)
        }
    }
    #[derive(Debug, Clone, PartialEq, Eq)]
    struct Record {
        node: Node,
        parent: u32,
        children: Vec<u32>,
    }
    #[derive(Debug, Clone, PartialEq, Eq)]
    struct View {
        roots: Vec<u32>,
        nodes: BTreeMap<u32, Record>,
    }
    impl CandidateRead for View {
        type Id = u32;
        fn root(&self) -> u32 {
            0
        }
        fn roots(&self) -> &[u32] {
            &self.roots
        }
        fn node(&self, id: u32) -> Option<BorrowedNode<'_, u32>> {
            self.nodes.get(&id).map(|r| BorrowedNode {
                type_id: &r.node.type_id,
                primitive: r.node.primitive,
                attributes: &r.node.attributes,
                marks: &r.node.marks,
                text: r.node.text.as_deref(),
                children: &r.children,
                parent: r.parent,
            })
        }
    }
    fn view(content: Value) -> View {
        let wire = json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":content});
        let document =
            crate::validate_normalized_json(&serde_json::to_vec(&wire).unwrap(), &Identities)
                .unwrap()
                .document()
                .to_core_document();
        fn add(
            mut node: Node,
            parent: u32,
            next: &mut u32,
            nodes: &mut BTreeMap<u32, Record>,
        ) -> u32 {
            let id = *next;
            *next += 1;
            let children = node
                .children
                .drain(..)
                .map(|node| add(node, id, next, nodes))
                .collect();
            nodes.insert(
                id,
                Record {
                    node,
                    parent,
                    children,
                },
            );
            id
        }
        let mut nodes = BTreeMap::new();
        let mut next = 1;
        let roots = document
            .children
            .into_iter()
            .map(|node| add(node, 0, &mut next, &mut nodes))
            .collect();
        View { roots, nodes }
    }
    fn p(text: &str) -> Value {
        if text.is_empty() {
            json!({"type":"paragraph","content":[]})
        } else {
            json!({"type":"paragraph","content":[{"type":"text","text":text}]})
        }
    }
    fn point(leaf: u32, offset: usize) -> Position<u32> {
        Position::Text {
            leaf,
            utf16: Utf16Offset::new(offset),
            affinity: Affinity::After,
        }
    }
    fn caret(position: Position<u32>) -> Selection<u32> {
        Selection {
            anchor: position,
            focus: position,
        }
    }
    fn run(
        view: &View,
        selection: Selection<u32>,
        intent: KwdjIntent<u32>,
    ) -> Result<CommandPlan<u32>, KwdjError> {
        let mut meter = WorkMeter::new(WorkLimits::default());
        let mut plan = PlanBuilder::new(&mut meter, 256);
        prepare(
            Profile::Prose,
            view,
            CommandState {
                selection: Some(&selection),
                stored_marks: None,
            },
            &intent,
            &mut plan,
        )?;
        Ok(plan.finish())
    }
    fn fragments(plan: &CommandPlan<u32>) -> Vec<&Node> {
        plan.operations
            .iter()
            .filter_map(|op| match op {
                Operation::InsertFragment { fragment, .. } => Some(&fragment.children[0]),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn enter_midparagraph_copies_only_layout_header_and_moves_known_suffix_identity_group() {
        let v = view(
            json!([{"type":"paragraph","attrs":{"align":"right","first_line_indent":true},"content":[{"type":"text","text":"a😀b","marks":[{"type":"strong"}]}]}]),
        );
        let before = v.clone();
        let plan = run(&v, caret(point(2, 1)), KwdjIntent::Enter).unwrap();
        assert_eq!(plan.operations.len(), 3);
        assert!(
            matches!(plan.operations[0],Operation::SplitText{leaf:LocalRef::Existing(2),at} if at==Utf16Offset::new(1))
        );
        let nodes = fragments(&plan);
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].type_id, "org.klenwriter.kwdj/paragraph");
        assert_eq!(
            nodes[0].attributes.get("align"),
            Some(&Attribute::String("right".into()))
        );
        assert_eq!(
            nodes[0].attributes.get("first_line_indent"),
            Some(&Attribute::Boolean(true))
        );
        assert!(nodes[0].children.is_empty());
        assert!(
            matches!(&plan.operations[2],Operation::MoveInlineGroup{nodes,parent:LocalRef::Created{operation:1,path},before_index:0} if nodes==&[LocalRef::Created{operation:0,path:vec![0]}]&&path==&[0])
        );
        assert_eq!(plan.stored_marks, StoredMarksUpdate::Inherit);
        assert_eq!(v, before);
    }
    #[test]
    fn enter_empty_paragraph_uses_new_empty_gap_without_persisted_empty_text() {
        let v = view(json!([p("")]));
        let plan = run(
            &v,
            caret(Position::Child {
                parent: 1,
                index: 0,
                affinity: Affinity::After,
            }),
            KwdjIntent::Enter,
        )
        .unwrap();
        assert_eq!(plan.operations.len(), 1);
        assert!(fragments(&plan)[0].children.is_empty());
        assert!(
            matches!(&plan.selection,SelectionIntent::MapFromUserResult(Some(Selection{anchor:Position::Child{parent:LocalRef::Created{operation:0,path},index:0,..},..})) if path==&[0])
        );
    }
    #[test]
    fn selected_enter_uses_one_outer_range_deletion_instead_of_leafwise_unicode_cuts() {
        let v = view(json!([p("abcd")]));
        let plan = run(
            &v,
            Selection {
                anchor: point(2, 1),
                focus: point(2, 3),
            },
            KwdjIntent::Enter,
        )
        .unwrap();
        assert!(
            matches!(plan.operations[0],Operation::SplitText{at,..} if at==Utf16Offset::new(3))
        );
        assert!(matches!(
            plan.operations.last(),
            Some(Operation::ReplaceInlineRange { inserted: None, .. })
        ));
        assert_eq!(
            plan.operations
                .iter()
                .filter(|op| matches!(op, Operation::MoveInlineGroup { .. }))
                .count(),
            1
        );
        assert!(
            !plan
                .operations
                .iter()
                .any(|op| matches!(op, Operation::ReplaceText { .. }))
        );
    }
    #[test]
    fn heading_start_preserves_original_heading_and_inserts_only_compatible_layout_header() {
        let v = view(
            json!([{"type":"heading","attrs":{"level":2,"align":"center","first_line_indent":true},"content":[{"type":"text","text":"Title"}]}]),
        );
        let plan = run(&v, caret(point(2, 0)), KwdjIntent::Enter).unwrap();
        assert_eq!(plan.operations.len(), 1);
        assert!(matches!(
            plan.operations[0],
            Operation::InsertFragment { index: 0, .. }
        ));
        let node = fragments(&plan)[0];
        assert_eq!(kind(&node.type_id), "paragraph");
        assert!(!node.attributes.contains_key("level"));
        assert_eq!(node.attributes.len(), 2);
        assert!(
            matches!(&plan.selection,SelectionIntent::MapFromUserResult(Some(Selection{anchor:Position::Text{leaf:LocalRef::Existing(2),utf16,..},..})) if *utf16==Utf16Offset::new(0))
        );
    }
    #[test]
    fn heading_end_and_empty_heading_have_distinct_lossless_recipes() {
        let v = view(
            json!([{"type":"heading","attrs":{"level":2,"align":"center"},"content":[{"type":"text","text":"Title"}]}]),
        );
        let plan = run(&v, caret(point(2, 5)), KwdjIntent::Enter).unwrap();
        assert_eq!(kind(&fragments(&plan)[0].type_id), "paragraph");
        assert!(!fragments(&plan)[0].attributes.contains_key("level"));
        let v = view(json!([{"type":"heading","attrs":{"level":2,"align":"center"},"content":[]}]));
        let plan = run(
            &v,
            caret(Position::Child {
                parent: 1,
                index: 0,
                affinity: Affinity::After,
            }),
            KwdjIntent::Enter,
        )
        .unwrap();
        assert!(
            matches!(&plan.operations[0],Operation::SetAttribute{key,value:None,..} if key=="level")
        );
        assert!(
            matches!(&plan.operations[1],Operation::Transform{type_id,..} if type_id=="org.klenwriter.kwdj/paragraph")
        );
        assert!(fragments(&plan).is_empty());
    }
    #[test]
    fn task_split_keeps_original_checked_and_initializes_new_task_unchecked() {
        let v = view(
            json!([{"type":"task_list","content":[{"type":"task_item","attrs":{"checked":true},"content":[p("ab")]},{"type":"task_item","attrs":{"checked":false},"content":[p("next")]}]}]),
        );
        let before = v.clone();
        let plan = run(&v, caret(point(4, 1)), KwdjIntent::Enter).unwrap();
        let item = fragments(&plan)[0];
        assert_eq!(kind(&item.type_id), "task_item");
        assert_eq!(
            item.attributes.get("checked"),
            Some(&Attribute::Boolean(false))
        );
        assert_eq!(
            v.nodes[&2].node.attributes.get("checked"),
            Some(&Attribute::Boolean(true))
        );
        assert!(!plan.operations.iter().any(|op| matches!(
            op,
            Operation::SetAttribute {
                node: LocalRef::Existing(2),
                ..
            }
        )));
        assert_eq!(v, before);
    }
    #[test]
    fn nested_item_split_moves_existing_trailing_quote_and_task_subtrees_in_order() {
        let v = view(
            json!([{"type":"bullet_list","content":[{"type":"list_item","content":[
                p("ab"), {"type":"blockquote","content":[p("tail")]},
                {"type":"task_list","content":[{"type":"task_item","attrs":{"checked":true},"content":[p("done")]}]}
            ]}]}]),
        );
        let quote = v
            .nodes
            .iter()
            .find(|(_, r)| kind(&r.node.type_id) == "blockquote")
            .unwrap()
            .0;
        let tasks = v
            .nodes
            .iter()
            .find(|(_, r)| kind(&r.node.type_id) == "task_list")
            .unwrap()
            .0;
        let plan = run(&v, caret(point(4, 1)), KwdjIntent::Enter).unwrap();
        let moves: Vec<_> = plan
            .operations
            .iter()
            .filter_map(|op| match op {
                Operation::Move {
                    node: LocalRef::Existing(node),
                    before_index,
                    ..
                } => Some((*node, *before_index)),
                _ => None,
            })
            .collect();
        assert_eq!(moves, vec![(*quote, 1), (*tasks, 2)]);
        assert!(fragments(&plan)[0].children[0].children.is_empty());
    }
    #[test]
    fn ordered_middle_exit_preserves_original_trailing_number_and_overflow_is_typed() {
        let content = |start: u64| json!([{"type":"ordered_list","attrs":{"start":start},"content":[{"type":"list_item","content":[p("A")]},{"type":"list_item","content":[p("")]},{"type":"list_item","content":[p("C")]}]}]);
        let v = view(content(7));
        let empty = v
            .nodes
            .iter()
            .find(|(_, r)| kind(&r.node.type_id) == "paragraph" && r.children.is_empty())
            .unwrap()
            .0;
        let selection = caret(Position::Child {
            parent: *empty,
            index: 0,
            affinity: Affinity::After,
        });
        let plan = run(&v, selection, KwdjIntent::Enter).unwrap();
        assert_eq!(
            fragments(&plan)[0].attributes.get("start"),
            Some(&Attribute::Number(9.into()))
        );
        let v = view(content(u64::MAX));
        let before = v.clone();
        assert_eq!(
            run(&v, selection, KwdjIntent::Enter).unwrap_err().code,
            KwdjErrorCode::CommandOrderedOverflow
        );
        assert_eq!(v, before);
    }
    #[test]
    fn empty_nested_lift_places_inner_tail_before_outer_parent_tail() {
        let v = view(
            json!([{"type":"bullet_list","content":[{"type":"list_item","content":[p("Parent"),{"type":"bullet_list","content":[{"type":"list_item","content":[p("before")]},{"type":"list_item","content":[p("")]},{"type":"list_item","content":[p("after")]}]},p("Parent tail")]},{"type":"list_item","content":[p("Next")]}]}]),
        );
        let empty = *v
            .nodes
            .iter()
            .find(|(_, r)| kind(&r.node.type_id) == "paragraph" && r.children.is_empty())
            .unwrap()
            .0;
        let parent_tail = *v
            .nodes
            .iter()
            .find(|(_, r)| r.node.text.as_deref() == Some("Parent tail"))
            .map(|(_, r)| &r.parent)
            .unwrap();
        let plan = run(
            &v,
            caret(Position::Child {
                parent: empty,
                index: 0,
                affinity: Affinity::After,
            }),
            KwdjIntent::Enter,
        )
        .unwrap();
        assert_eq!(kind(&fragments(&plan)[0].type_id), "bullet_list");
        assert!(plan.operations.iter().any(|op|matches!(op,Operation::Move{node:LocalRef::Existing(node),before_index:2,..} if *node==parent_tail)));
        assert!(plan.operations.iter().any(|op| matches!(
            op,
            Operation::Move {
                parent: LocalRef::Existing(1),
                before_index: 1,
                ..
            }
        )));
    }
    #[test]
    fn slash_literal_is_checked_and_prefix_suffix_use_preserved_header_and_group_move() {
        let v = view(
            json!([{"type":"paragraph","attrs":{"align":"center","first_line_indent":true},"content":[{"type":"text","text":"pre /scene tail"}]}]),
        );
        let range = Selection {
            anchor: point(2, 4),
            focus: point(2, 10),
        };
        let plan = run(
            &v,
            caret(point(2, 10)),
            KwdjIntent::AcceptSlash {
                target: BlockTarget::SceneBreak,
                range,
                literal: "/scene".into(),
            },
        )
        .unwrap();
        assert!(
            matches!(plan.operations[0],Operation::SplitText{at,..} if at==Utf16Offset::new(10))
        );
        assert!(matches!(
            plan.operations.last(),
            Some(Operation::ReplaceInlineRange { inserted: None, .. })
        ));
        let nodes = fragments(&plan);
        assert_eq!(nodes.len(), 2);
        assert_eq!(kind(&nodes[0].type_id), "scene_break");
        assert_eq!(kind(&nodes[1].type_id), "paragraph");
        assert_eq!(nodes[1].attributes.len(), 2);
        assert!(matches!(
            plan.operations.get(plan.operations.len() - 2),
            Some(Operation::MoveInlineGroup { .. })
        ));
        assert_eq!(
            run(
                &v,
                caret(point(2, 10)),
                KwdjIntent::AcceptSlash {
                    target: BlockTarget::SceneBreak,
                    range,
                    literal: "/other".into()
                }
            )
            .unwrap_err()
            .code,
            KwdjErrorCode::CommandQueryMismatch
        );
    }
    #[test]
    fn slash_rejects_supported_targets_outside_the_exact_frozen_catalog() {
        let v = view(json!([p("/x")]));
        let range = Selection {
            anchor: point(2, 0),
            focus: point(2, 2),
        };
        for target in [
            BlockTarget::Heading { level: 1 },
            BlockTarget::OrderedList { start: 9 },
        ] {
            let mut work = WorkMeter::new(WorkLimits::default());
            let mut plan = PlanBuilder::new(&mut work, 256);
            let error = prepare(
                Profile::Prose,
                &v,
                CommandState {
                    selection: Some(&caret(point(2, 2))),
                    stored_marks: None,
                },
                &KwdjIntent::AcceptSlash {
                    target,
                    range,
                    literal: "/x".into(),
                },
                &mut plan,
            )
            .unwrap_err();
            assert_eq!(error.code, KwdjErrorCode::CommandInvalidTarget);
            assert!(plan.is_empty());
        }
    }
    #[test]
    fn selected_barrier_is_deleted_after_original_suffix_group_boundary_was_used() {
        let v = view(
            json!([{"type":"paragraph","content":[{"type":"text","text":"e"},{"type":"hard_break"},{"type":"text","text":"\u{301}","marks":[{"type":"strong"}]}]}]),
        );
        let selection = Selection {
            anchor: Position::Child {
                parent: 1,
                index: 1,
                affinity: Affinity::After,
            },
            focus: Position::Child {
                parent: 1,
                index: 2,
                affinity: Affinity::Before,
            },
        };
        for intent in [
            KwdjIntent::Enter,
            KwdjIntent::InsertBlock {
                target: BlockTarget::SceneBreak,
            },
        ] {
            let plan = run(&v, selection, intent).unwrap();
            let moved = plan
                .operations
                .iter()
                .position(|op| matches!(op, Operation::MoveInlineGroup { .. }))
                .unwrap();
            let deleted = plan
                .operations
                .iter()
                .position(|op| matches!(op, Operation::ReplaceInlineRange { inserted: None, .. }))
                .unwrap();
            assert!(moved < deleted);
        }
    }
    #[test]
    fn mixed_quote_or_list_context_is_refused_before_any_unwrap_or_conversion() {
        for (content, intent) in [
            (
                json!([{"type":"blockquote","content":[p("a")]},p("outside")]),
                KwdjIntent::ToggleQuote,
            ),
            (
                json!([{"type":"bullet_list","content":[{"type":"list_item","content":[p("a")]}]},p("outside")]),
                KwdjIntent::ToggleList {
                    kind: ListKind::Bullet,
                },
            ),
            (
                json!([{"type":"bullet_list","content":[{"type":"list_item","content":[p("a")]}]},p("outside")]),
                KwdjIntent::ToggleList {
                    kind: ListKind::Task,
                },
            ),
        ] {
            let v = view(content);
            let leaf = |value| {
                *v.nodes
                    .iter()
                    .find(|(_, node)| node.node.text.as_deref() == Some(value))
                    .unwrap()
                    .0
            };
            let selected = Selection {
                anchor: point(leaf("a"), 0),
                focus: point(leaf("outside"), 7),
            };
            let mut work = WorkMeter::new(WorkLimits::default());
            let mut plan = PlanBuilder::new(&mut work, 256);
            let error = prepare(
                Profile::Prose,
                &v,
                CommandState {
                    selection: Some(&selected),
                    stored_marks: None,
                },
                &intent,
                &mut plan,
            )
            .unwrap_err();
            assert_eq!(error.code, KwdjErrorCode::CommandUnsupportedContext);
            assert!(plan.is_empty());
        }
    }
    #[test]
    fn equivalent_zero_range_coordinates_do_not_delete_a_relocated_suffix_anchor() {
        let v = view(json!([p("ab")]));
        for (anchor, focus) in [
            (
                point(2, 0),
                Position::Child {
                    parent: 1,
                    index: 0,
                    affinity: Affinity::After,
                },
            ),
            (
                Position::Edge {
                    node: 2,
                    side: Edge::Before,
                },
                point(2, 0),
            ),
            (
                point(2, 2),
                Position::Child {
                    parent: 1,
                    index: 1,
                    affinity: Affinity::Before,
                },
            ),
        ] {
            let plan = run(&v, Selection { anchor, focus }, KwdjIntent::Enter).unwrap();
            assert!(
                !plan
                    .operations
                    .iter()
                    .any(|op| matches!(op, Operation::ReplaceInlineRange { .. }))
            );
        }
    }
    #[test]
    fn transform_preserves_link_and_layout_by_never_reconstructing_children_or_marks() {
        let v = view(
            json!([{"type":"paragraph","attrs":{"align":"right","first_line_indent":true},"content":[{"type":"text","text":"Link","marks":[{"type":"link","attrs":{"href":"https://example.org/a","title":"Title"}}]}]}]),
        );
        let plan = run(
            &v,
            caret(point(2, 2)),
            KwdjIntent::TransformBlock {
                target: BlockTarget::Heading { level: 2 },
            },
        )
        .unwrap();
        assert_eq!(plan.operations.len(), 2);
        assert!(matches!(&plan.operations[0],Operation::SetAttribute{key,..} if key=="level"));
        assert!(matches!(&plan.operations[1], Operation::Transform { .. }));
        assert_eq!(
            run(
                &v,
                caret(point(2, 2)),
                KwdjIntent::TransformBlock {
                    target: BlockTarget::CodeBlock { language: None }
                }
            )
            .unwrap_err()
            .code,
            KwdjErrorCode::CommandLossyTransform
        );
    }
    #[test]
    fn replacing_selected_prefix_with_shift_enter_inserts_break_before_surviving_suffix() {
        let v = view(json!([p("abcd")]));
        let plan = run(
            &v,
            Selection {
                anchor: point(2, 0),
                focus: point(2, 2),
            },
            KwdjIntent::ShiftEnter,
        )
        .unwrap();
        assert_eq!(plan.operations.len(), 1);
        assert!(
            matches!(&plan.operations[0],Operation::ReplaceInlineRange{inserted:Some(node),..} if node.primitive==Primitive::HardBreak && node.text.is_none())
        );
    }
    #[test]
    fn shift_enter_replaces_a_barrier_in_one_outer_proved_operation() {
        let v = view(
            json!([{"type":"paragraph","content":[{"type":"text","text":"e"},{"type":"hard_break"},{"type":"text","text":"\u{301}"}]}]),
        );
        let range = Selection {
            anchor: Position::Child {
                parent: 1,
                index: 1,
                affinity: Affinity::After,
            },
            focus: Position::Child {
                parent: 1,
                index: 2,
                affinity: Affinity::Before,
            },
        };
        let plan = run(&v, range, KwdjIntent::ShiftEnter).unwrap();
        assert_eq!(plan.operations.len(), 1);
        assert!(
            matches!(&plan.operations[0],Operation::ReplaceInlineRange{inserted:Some(node),..} if node.primitive==Primitive::HardBreak)
        );
        assert!(
            matches!(&plan.selection,SelectionIntent::MapFromUserResult(Some(Selection{anchor:Position::Edge{node:LocalRef::Created{operation:0,path},side:Edge::After},..})) if path==&[0])
        );
    }
    #[test]
    fn cross_block_shift_enter_preserves_tail_group_and_inserts_before_it() {
        let v = view(json!([p("ab"), p("cd")]));
        let plan = run(
            &v,
            Selection {
                anchor: point(2, 1),
                focus: point(4, 1),
            },
            KwdjIntent::ShiftEnter,
        )
        .unwrap();
        assert!(plan.operations.iter().any(|op|matches!(op,Operation::ReplaceInlineRange{inserted:Some(node),..} if node.primitive==Primitive::HardBreak)));
        assert!(plan.operations.iter().any(|op| matches!(
            op,
            Operation::MoveInlineGroup {
                parent: LocalRef::Existing(1),
                before_index: 2,
                ..
            }
        )));
        assert!(matches!(
            plan.operations.last(),
            Some(Operation::Remove {
                node: LocalRef::Existing(3)
            })
        ));
    }
    #[test]
    fn removing_only_root_block_prepares_valid_paragraph_before_removal() {
        let v = view(json!([p("x")]));
        let plan = run(&v, caret(point(2, 0)), KwdjIntent::Remove { node: 1 }).unwrap();
        assert!(matches!(
            plan.operations[0],
            Operation::InsertFragment {
                parent: LocalRef::Existing(0),
                index: 0,
                ..
            }
        ));
        assert!(matches!(
            plan.operations[1],
            Operation::Remove {
                node: LocalRef::Existing(1)
            }
        ));
        assert!(fragments(&plan)[0].children.is_empty());
    }
    #[test]
    fn enter_after_atomic_scene_has_a_valid_new_paragraph_target() {
        let v = view(json!([{"type":"scene_break"}]));
        let plan = run(
            &v,
            caret(Position::Edge {
                node: 1,
                side: Edge::After,
            }),
            KwdjIntent::Enter,
        )
        .unwrap();
        assert_eq!(plan.operations.len(), 1);
        assert!(matches!(
            plan.operations[0],
            Operation::InsertFragment {
                parent: LocalRef::Existing(0),
                index: 1,
                ..
            }
        ));
        assert_eq!(kind(&fragments(&plan)[0].type_id), "paragraph");
    }
    #[test]
    fn catalogue_and_future_provider_reasons_are_exact_and_finite() {
        validate_catalog(super::super::KWDJ_COMMANDS).unwrap();
        assert_eq!(super::super::KWDJ_COMMANDS.len(), 17);
        assert_eq!(
            super::super::KWDJ_COMMANDS[16].id,
            "org.klenwriter.kwdj/command/delete-selection"
        );
        assert!(
            super::super::KWDJ_SLASH_CANDIDATES
                .iter()
                .all(|entry| entry.id.starts_with("org.klenwriter.kwdj/slash/"))
        );
        let v = view(json!([p("x")]));
        for (target, code) in [
            (BlockTarget::Table, KwdjErrorCode::CommandTableUnavailable),
            (BlockTarget::Poetry, KwdjErrorCode::CommandPoetryUnavailable),
            (BlockTarget::Media, KwdjErrorCode::CommandHostRequired),
        ] {
            assert_eq!(
                run(&v, caret(point(2, 0)), KwdjIntent::InsertBlock { target })
                    .unwrap_err()
                    .code,
                code
            );
        }
    }
    #[test]
    fn block_planning_refuses_exhausted_work_before_copying_headers_or_text() {
        let v = view(json!([p("payload")]));
        let sel = caret(point(2, 0));
        let mut work = WorkMeter::new(WorkLimits { units: 0, bytes: 0 });
        let mut plan = PlanBuilder::new(&mut work, 256);
        let error = prepare(
            Profile::Prose,
            &v,
            CommandState {
                selection: Some(&sel),
                stored_marks: None,
            },
            &KwdjIntent::Enter,
            &mut plan,
        )
        .unwrap_err();
        assert_eq!(error.code, KwdjErrorCode::OperationalBudgetExceeded);
        assert!(plan.is_empty());
    }
}
