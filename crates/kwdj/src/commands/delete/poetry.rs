// SPDX-License-Identifier: MIT OR Apache-2.0
//! SDK2 poetry deletion at authored line, stanza, and verse boundaries.

use editor_core::candidate::{BorrowedNode, CandidateRead};
use editor_core::commands::{LocalRef, PlanBuilder, SelectionIntent};
use editor_core::document::Primitive;
use editor_core::positions::{Affinity, Edge, Position, Selection};
use editor_core::transaction::Operation;

use super::{
    block, bytes, caret, get, inline, invalid, length, map_position, text_position, units,
    unsupported,
};
use crate::KwdjError;

pub(super) const VERSE_LINE: &str = "org.klenwriter.kwdj/verse_line";
const VERSE: &str = "org.klenwriter.kwdj/verse";
const STANZA: &str = "org.klenwriter.kwdj/stanza_break";
const PARAGRAPH: &str = "org.klenwriter.kwdj/paragraph";
const HEADING: &str = "org.klenwriter.kwdj/heading";

pub(super) fn is_prose_block(type_id: &str) -> bool {
    matches!(type_id, PARAGRAPH | HEADING)
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Direction {
    Backward,
    Forward,
}

impl Direction {
    fn neighbor(self, index: usize) -> Option<usize> {
        match self {
            Self::Backward => index.checked_sub(1),
            Self::Forward => Some(index + 1),
        }
    }

    fn edge(self) -> Edge {
        match self {
            Self::Backward => Edge::Before,
            Self::Forward => Edge::After,
        }
    }
}

fn index<I: Copy + Eq>(
    siblings: &[I],
    id: I,
    plan: &mut PlanBuilder<'_, I>,
) -> Result<usize, KwdjError> {
    units(plan, siblings.len())?;
    siblings
        .iter()
        .position(|child| *child == id)
        .ok_or_else(invalid)
}

fn sibling<V: CandidateRead>(
    view: &V,
    parent: V::Id,
    id: V::Id,
    direction: Direction,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<Option<(usize, V::Id)>, KwdjError> {
    let siblings = view.children(parent).ok_or_else(invalid)?;
    let at = index(siblings, id, plan)?;
    Ok(direction
        .neighbor(at)
        .and_then(|i| siblings.get(i).map(|neighbor| (i, *neighbor))))
}

fn gap<I>(parent: I, index: usize, affinity: Affinity) -> Position<I> {
    Position::Child {
        parent,
        index,
        affinity,
    }
}

fn boundary<I>(id: I, len: usize, side: Edge) -> Position<I> {
    match side {
        Edge::Before => gap(id, 0, Affinity::After),
        Edge::After => gap(id, len, Affinity::Before),
    }
}

fn anchor<V: CandidateRead>(
    view: &V,
    id: V::Id,
    children: &[V::Id],
    side: Edge,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<Position<LocalRef<V::Id>>, KwdjError> {
    let leaf = match side {
        Edge::Before => children.first(),
        Edge::After => children.last(),
    };
    if let Some(&leaf) = leaf {
        let node = get(view, leaf, plan)?;
        if node.primitive == Primitive::Text {
            let at = if side == Edge::Before {
                0
            } else {
                length(node.text.ok_or_else(invalid)?, plan)?
            };
            return Ok(text_position(leaf.into(), at));
        }
    }
    Ok(boundary(id.into(), children.len(), side))
}

fn select_sibling<I: Copy>(
    plan: &mut PlanBuilder<'_, I>,
    parent: I,
    index: usize,
) -> Result<(), KwdjError> {
    plan.set_selection(SelectionIntent::MapFromUserResult(Some(Selection {
        anchor: gap(parent.into(), index, Affinity::After),
        focus: gap(parent.into(), index + 1, Affinity::Before),
    })))
    .map_err(KwdjError::operational)
}

fn remove<I: Copy>(plan: &mut PlanBuilder<'_, I>, id: I) -> Result<(), KwdjError> {
    plan.push(Operation::Remove { node: id.into() })
        .map_err(KwdjError::operational)?;
    Ok(())
}

fn append_inline<I: Copy>(
    plan: &mut PlanBuilder<'_, I>,
    target: I,
    before_index: usize,
    nodes: Vec<LocalRef<I>>,
) -> Result<(), KwdjError> {
    if !nodes.is_empty() {
        plan.push(Operation::MoveInlineGroup {
            nodes,
            parent: target.into(),
            before_index,
        })
        .map_err(KwdjError::operational)?;
    }
    Ok(())
}

fn join_inline<V: CandidateRead>(
    view: &V,
    left: V::Id,
    left_children: &[V::Id],
    right: V::Id,
    right_children: &[V::Id],
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<(), KwdjError> {
    let position = anchor(view, left, left_children, Edge::After, plan)?;
    units(plan, right_children.len())?;
    bytes(
        plan,
        right_children
            .len()
            .saturating_mul(std::mem::size_of::<LocalRef<V::Id>>()),
    )?;
    append_inline(
        plan,
        left,
        left_children.len(),
        right_children
            .iter()
            .copied()
            .map(LocalRef::Existing)
            .collect(),
    )?;
    remove(plan, right)?;
    caret(plan, position)
}

pub(super) fn collapsed<V: CandidateRead>(
    view: &V,
    id: V::Id,
    node: BorrowedNode<'_, V::Id>,
    direction: Direction,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<bool, KwdjError> {
    match node.type_id {
        VERSE_LINE => {
            let verse = get(view, node.parent, plan)?;
            let at = index(verse.children, id, plan)?;
            if let Some(other) = direction.neighbor(at).and_then(|i| verse.children.get(i)) {
                let neighbor = get(view, *other, plan)?;
                if neighbor.type_id == STANZA {
                    stanza(view, id, node, verse.children, at, direction, plan)?;
                } else {
                    let (left, left_node, right, right_node) = match direction {
                        Direction::Backward => (*other, neighbor, id, node),
                        Direction::Forward => (id, node, *other, neighbor),
                    };
                    if left_node.children.is_empty() {
                        remove(plan, left)?;
                        caret(
                            plan,
                            boundary(right.into(), right_node.children.len(), Edge::Before),
                        )?;
                    } else {
                        join_inline(
                            view,
                            left,
                            left_node.children,
                            right,
                            right_node.children,
                            plan,
                        )?;
                    }
                }
                return Ok(true);
            }
            verse_edge(view, id, node, verse, direction, plan)
        }
        PARAGRAPH | HEADING if direction == Direction::Forward => {
            forward_from_prose(view, id, node, plan)
        }
        _ => Ok(false),
    }
}

fn stanza<V: CandidateRead>(
    view: &V,
    id: V::Id,
    line: BorrowedNode<'_, V::Id>,
    siblings: &[V::Id],
    at: usize,
    direction: Direction,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<(), KwdjError> {
    let neighbor = direction.neighbor(at).ok_or_else(invalid)?;
    if line.children.is_empty() {
        remove(plan, id)?;
        let outside = match direction {
            Direction::Backward if at + 1 == siblings.len() => neighbor.checked_sub(1),
            Direction::Forward if at == 0 => Some(neighbor + 1),
            _ => None,
        };
        if let Some(next) = outside {
            let next_id = *siblings.get(next).ok_or_else(invalid)?;
            let next = get(view, next_id, plan)?;
            remove(plan, siblings[neighbor])?;
            let edge = if direction == Direction::Backward {
                Edge::After
            } else {
                Edge::Before
            };
            let position = anchor(view, next_id, next.children, edge, plan)?;
            return caret(plan, position);
        }
        // If two stanza markers become adjacent the normalizer keeps the first
        // marker. Select it in the post-delete sibling list.
        let selected = match at.checked_sub(1) {
            Some(before) if get(view, siblings[before], plan)?.type_id == STANZA => before,
            _ => at,
        };
        return select_sibling(plan, line.parent, selected);
    }
    remove(plan, siblings[neighbor])?;
    caret(
        plan,
        boundary(id.into(), line.children.len(), direction.edge()),
    )
}

fn verse_edge<V: CandidateRead>(
    view: &V,
    line_id: V::Id,
    line: BorrowedNode<'_, V::Id>,
    verse: BorrowedNode<'_, V::Id>,
    direction: Direction,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<bool, KwdjError> {
    let Some((other, other_id)) = sibling(view, verse.parent, line.parent, direction, plan)? else {
        // At a real document edge the caret stays put. A neighboring block
        // outside the authored body would require rewriting its wrapper.
        let mut owner = verse.parent;
        while owner != view.root() {
            let parent = get(view, owner, plan)?.parent;
            if sibling(view, parent, owner, direction, plan)?.is_some() {
                return Err(unsupported());
            }
            owner = parent;
        }
        return Ok(true);
    };
    let other_node = get(view, other_id, plan)?;
    match (other_node.type_id, direction) {
        (VERSE, _) => {
            let (left, left_node, right, right_node) = match direction {
                Direction::Backward => (other_id, other_node, line.parent, verse),
                Direction::Forward => (line.parent, verse, other_id, other_node),
            };
            units(plan, right_node.children.len())?;
            for (offset, child) in right_node.children.iter().enumerate() {
                plan.push(Operation::Move {
                    node: (*child).into(),
                    parent: left.into(),
                    before_index: left_node.children.len() + offset,
                })
                .map_err(KwdjError::operational)?;
            }
            remove(plan, right)?;
            caret(
                plan,
                boundary(line_id.into(), line.children.len(), direction.edge()),
            )?;
        }
        (PARAGRAPH | HEADING, Direction::Backward) if verse.children.len() == 1 => {
            join_inline(
                view,
                other_id,
                other_node.children,
                line.parent,
                line.children,
                plan,
            )?;
        }
        (PARAGRAPH | HEADING, Direction::Backward) => select_sibling(plan, verse.parent, other)?,
        (PARAGRAPH | HEADING, Direction::Forward) => {
            join_inline(
                view,
                line_id,
                line.children,
                other_id,
                other_node.children,
                plan,
            )?;
        }
        _ => return Ok(false),
    }
    Ok(true)
}

pub(super) fn join_after_verse<V: CandidateRead>(
    view: &V,
    verse: BorrowedNode<'_, V::Id>,
    id: V::Id,
    prose: BorrowedNode<'_, V::Id>,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<bool, KwdjError> {
    if verse.type_id != VERSE {
        return Ok(false);
    }
    let last = *verse.children.last().ok_or_else(invalid)?;
    let line = get(view, last, plan)?;
    join_inline(view, last, line.children, id, prose.children, plan)?;
    Ok(true)
}

fn forward_from_prose<V: CandidateRead>(
    view: &V,
    id: V::Id,
    prose: BorrowedNode<'_, V::Id>,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<bool, KwdjError> {
    let Some((other, verse_id)) = sibling(view, prose.parent, id, Direction::Forward, plan)? else {
        return Ok(false);
    };
    let verse = get(view, verse_id, plan)?;
    if verse.type_id != VERSE {
        return Ok(false);
    }
    if let [first] = verse.children {
        let line = get(view, *first, plan)?;
        join_inline(view, id, prose.children, verse_id, line.children, plan)?;
    } else if prose.children.is_empty() {
        let first = *verse.children.first().ok_or_else(invalid)?;
        remove(plan, id)?;
        caret(plan, boundary(first.into(), 0, Edge::Before))?;
    } else {
        select_sibling(plan, prose.parent, other)?;
    }
    Ok(true)
}

pub(super) fn selected<V: CandidateRead>(
    view: &V,
    selection: Selection<V::Id>,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<(), KwdjError> {
    let ordered = inline::ordered_range(view, selection, plan.work())?;
    let from = inline::text_point(view, ordered.start, plan.work())?;
    let to = inline::text_point(view, ordered.end, plan.work())?;
    let left = get(view, from.block, plan)?;
    let right = get(view, to.block, plan)?;
    if ordered.is_empty || from.block == to.block || right.type_id != VERSE_LINE {
        return Err(unsupported());
    }
    let verse = get(view, right.parent, plan)?;
    let right_index = index(verse.children, to.block, plan)?;
    // These two ranges either span stanza markers or enter a neighboring verse.
    let (consumed_stanzas, consumed) = match left.type_id {
        VERSE_LINE if left.parent == right.parent => {
            let left_index = index(verse.children, from.block, plan)?;
            (
                verse
                    .children
                    .get(left_index + 1..right_index)
                    .ok_or_else(unsupported)?,
                to.block,
            )
        }
        PARAGRAPH if left.parent == verse.parent && right_index == 0 => {
            let siblings = view.children(left.parent).ok_or_else(invalid)?;
            let left_index = index(siblings, from.block, plan)?;
            if siblings.get(left_index + 1) != Some(&right.parent) {
                return Err(unsupported());
            }
            let mut end = 1;
            while let Some(id) = verse.children.get(end)
                && get(view, *id, plan)?.type_id == STANZA
            {
                end += 1;
            }
            let consumed = if end == verse.children.len() {
                right.parent
            } else {
                to.block
            };
            (&verse.children[1..end], consumed)
        }
        _ => return Err(unsupported()),
    };
    for id in consumed_stanzas {
        if get(view, *id, plan)?.type_id != STANZA {
            return Err(unsupported());
        }
    }
    let cut = block::cut_inline_range(
        view,
        Selection {
            anchor: boundary(to.block, 0, Edge::Before),
            focus: ordered.end,
        },
        plan,
    )?;
    let before_index = from.index + usize::from(from.leaf.is_some() && from.utf16.get() > 0);
    let position = match from.leaf {
        Some(leaf) if from.utf16.get() > 0 => text_position(leaf.into(), from.utf16.get()),
        _ => anchor(
            view,
            from.block,
            &left.children[..before_index],
            Edge::After,
            plan,
        )?,
    };
    plan.push(Operation::ReplaceInlineRange {
        range: Selection {
            anchor: map_position(ordered.start),
            focus: boundary(from.block.into(), left.children.len(), Edge::After),
        },
        inserted: None,
    })
    .map_err(KwdjError::operational)?;
    append_inline(plan, from.block, before_index, cut.tail)?;
    for id in consumed_stanzas {
        remove(plan, *id)?;
    }
    remove(plan, consumed)?;
    caret(plan, position)
}
