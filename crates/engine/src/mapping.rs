// SPDX-License-Identifier: MIT OR Apache-2.0
//! Ordered local position maps. These do not mutate a document or implement undo.
//!
//! The tree owner supplies admitted before/after dimensions and complete retired
//! subtree IDs, then validates resulting positions against the committed tree.
//! Coordinates in these records are UTF-16 units; scalar/grapheme validation is
//! a separate admission step. IDs are opaque; their session namespace is owned
//! by the session, not inferred from a numeric value by this module.

use std::collections::VecDeque;

use editor_core::positions::{Affinity, Edge, Position, Utf16Offset};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MapError {
    InvalidRange,
    OffsetOutOfBounds,
    ArithmeticOverflow,
    SameNode,
    InvalidRevision,
    NonContiguousRevision,
    ZeroCapacity,
    RetiredFallback,
    UnresolvedRetiredNode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MapResult<N> {
    Mapped(Position<N>),
    Deleted(Position<N>),
    Stale,
    Invalid(MapError),
}

impl<N: Copy> MapResult<N> {
    pub fn position(self) -> Option<Position<N>> {
        match self {
            Self::Mapped(position) | Self::Deleted(position) => Some(position),
            Self::Stale | Self::Invalid(_) => None,
        }
    }

    pub fn is_deleted(&self) -> bool {
        matches!(self, Self::Deleted(_))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StepMap<N> {
    ReplaceText {
        leaf: N,
        from: Utf16Offset,
        to: Utf16Offset,
        inserted: usize,
        old_len: usize,
    },
    SplitText {
        left: N,
        right: N,
        at: Utf16Offset,
        old_len: usize,
    },
    JoinText {
        left: N,
        right: N,
        left_len: usize,
        right_len: usize,
    },
    ChildInsert {
        parent: N,
        index: usize,
        count: usize,
        old_len: usize,
    },
    /// Maps gaps only. Emit Retire separately for removed descendant anchors.
    ChildDelete {
        parent: N,
        index: usize,
        count: usize,
        old_len: usize,
    },
    /// Destination is a gap in the pre-operation tree, adjusted exactly once.
    /// Descendant text/edge positions retain their identities and offsets.
    ChildMove {
        from_parent: N,
        from_index: usize,
        to_parent: N,
        to_index: usize,
        count: usize,
        from_len: usize,
        to_len: usize,
    },
    /// All deleted subtree identities, plus its former surviving parent gap.
    /// The owner emits this after ChildDelete. Later Retire steps can delete
    /// this parent again; Deleted provenance then follows the whole chain.
    Retire {
        nodes: Vec<N>,
        parent: N,
        index: usize,
    },
    /// Identity metadata emitted only from an owned subtree/join restoration.
    /// This neither restores a selection nor reattaches deleted anchors. The
    /// tree owner proves that these historical identities are live again; map
    /// metadata alone never authorizes mutation of a Session. Repeated IDs are
    /// harmless, idempotent liveness declarations, not additional allocations.
    Revive { nodes: Vec<N> },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IdentityLiveness {
    Live,
    Retired,
}

fn range_end(start: usize, count: usize, length: usize) -> Result<usize, MapError> {
    let end = start
        .checked_add(count)
        .ok_or(MapError::ArithmeticOverflow)?;
    if end > length {
        Err(MapError::InvalidRange)
    } else {
        Ok(end)
    }
}

/// Mapping a replacement is shared by text and child gaps, with exact endpoint
/// rules. Strictly interior points lose their old attachment; endpoints do not.
fn replace_offset(
    offset: usize,
    affinity: Affinity,
    from: usize,
    to: usize,
    inserted: usize,
) -> Result<(usize, bool), MapError> {
    if offset < from {
        return Ok((offset, false));
    }
    let replacement_end = from
        .checked_add(inserted)
        .ok_or(MapError::ArithmeticOverflow)?;
    if from == to {
        if offset == from && affinity == Affinity::Before {
            return Ok((from, false));
        }
        return Ok((
            offset
                .checked_add(inserted)
                .ok_or(MapError::ArithmeticOverflow)?,
            false,
        ));
    }
    if offset > to {
        return Ok((
            replacement_end
                .checked_add(offset - to)
                .ok_or(MapError::ArithmeticOverflow)?,
            false,
        ));
    }
    if offset == to {
        return Ok((replacement_end, false));
    }
    Ok((
        if affinity == Affinity::Before {
            from
        } else {
            replacement_end
        },
        offset != from,
    ))
}

impl<N: Copy + Eq> StepMap<N> {
    pub fn validate(&self) -> Result<(), MapError> {
        match self {
            Self::ReplaceText {
                from,
                to,
                inserted,
                old_len,
                ..
            } => {
                if from > to || to.get() > *old_len {
                    return Err(MapError::InvalidRange);
                }
                (old_len - (to.get() - from.get()))
                    .checked_add(*inserted)
                    .ok_or(MapError::ArithmeticOverflow)?;
            }
            Self::SplitText {
                left,
                right,
                at,
                old_len,
            } => {
                if left == right {
                    return Err(MapError::SameNode);
                }
                if at.get() > *old_len {
                    return Err(MapError::InvalidRange);
                }
            }
            Self::JoinText {
                left,
                right,
                left_len,
                right_len,
            } => {
                if left == right {
                    return Err(MapError::SameNode);
                }
                left_len
                    .checked_add(*right_len)
                    .ok_or(MapError::ArithmeticOverflow)?;
            }
            Self::ChildInsert {
                index,
                count,
                old_len,
                ..
            } => {
                if index > old_len {
                    return Err(MapError::InvalidRange);
                }
                old_len
                    .checked_add(*count)
                    .ok_or(MapError::ArithmeticOverflow)?;
            }
            Self::ChildDelete {
                index,
                count,
                old_len,
                ..
            } => {
                range_end(*index, *count, *old_len)?;
            }
            Self::ChildMove {
                from_parent,
                from_index,
                to_parent,
                to_index,
                count,
                from_len,
                to_len,
            } => {
                range_end(*from_index, *count, *from_len)?;
                if to_index > to_len || (from_parent == to_parent && from_len != to_len) {
                    return Err(MapError::InvalidRange);
                }
                if from_parent != to_parent {
                    to_len
                        .checked_add(*count)
                        .ok_or(MapError::ArithmeticOverflow)?;
                }
            }
            Self::Retire { nodes, parent, .. } => {
                if nodes.contains(parent) {
                    return Err(MapError::RetiredFallback);
                }
            }
            Self::Revive { .. } => {}
        }
        Ok(())
    }

    pub fn map(&self, position: Position<N>) -> MapResult<N> {
        if let Err(error) = self.validate() {
            return MapResult::Invalid(error);
        }
        match self.map_valid(position) {
            Ok((position, false)) => MapResult::Mapped(position),
            Ok((position, true)) => MapResult::Deleted(position),
            Err(error) => MapResult::Invalid(error),
        }
    }

    fn map_valid(&self, position: Position<N>) -> Result<(Position<N>, bool), MapError> {
        match (self, position) {
            (
                Self::ReplaceText {
                    leaf,
                    from,
                    to,
                    inserted,
                    old_len,
                },
                Position::Text {
                    leaf: target,
                    utf16,
                    affinity,
                },
            ) if *leaf == target => {
                if utf16.get() > *old_len {
                    return Err(MapError::OffsetOutOfBounds);
                }
                let (offset, deleted) =
                    replace_offset(utf16.get(), affinity, from.get(), to.get(), *inserted)?;
                Ok((
                    Position::Text {
                        leaf: target,
                        utf16: Utf16Offset::new(offset),
                        affinity,
                    },
                    deleted,
                ))
            }
            (
                Self::SplitText {
                    left,
                    right,
                    at,
                    old_len,
                },
                Position::Text {
                    leaf,
                    utf16,
                    affinity,
                },
            ) if *left == leaf => {
                if utf16.get() > *old_len {
                    return Err(MapError::OffsetOutOfBounds);
                }
                if utf16 > *at || (utf16 == *at && affinity == Affinity::After) {
                    Ok((
                        Position::Text {
                            leaf: *right,
                            utf16: Utf16Offset::new(utf16.get() - at.get()),
                            affinity,
                        },
                        false,
                    ))
                } else {
                    Ok((position, false))
                }
            }
            (
                Self::SplitText { left, right, .. },
                Position::Edge {
                    node,
                    side: Edge::After,
                },
            ) if *left == node => Ok((
                Position::Edge {
                    node: *right,
                    side: Edge::After,
                },
                false,
            )),
            (
                Self::JoinText {
                    left,
                    right,
                    left_len,
                    right_len,
                },
                Position::Text {
                    leaf,
                    utf16,
                    affinity,
                },
            ) if *left == leaf || *right == leaf => {
                let old_len = if *left == leaf { *left_len } else { *right_len };
                if utf16.get() > old_len {
                    return Err(MapError::OffsetOutOfBounds);
                }
                let offset = if *right == leaf {
                    left_len
                        .checked_add(utf16.get())
                        .ok_or(MapError::ArithmeticOverflow)?
                } else {
                    utf16.get()
                };
                Ok((
                    Position::Text {
                        leaf: *left,
                        utf16: Utf16Offset::new(offset),
                        affinity,
                    },
                    false,
                ))
            }
            (
                Self::JoinText { left, left_len, .. },
                Position::Edge {
                    node,
                    side: Edge::After,
                },
            ) if *left == node => Ok((
                Position::Text {
                    leaf: *left,
                    utf16: Utf16Offset::new(*left_len),
                    affinity: Affinity::After,
                },
                false,
            )),
            (
                Self::JoinText {
                    left,
                    right,
                    left_len,
                    ..
                },
                Position::Edge { node, side },
            ) if *right == node => Ok((
                match side {
                    Edge::Before => Position::Text {
                        leaf: *left,
                        utf16: Utf16Offset::new(*left_len),
                        affinity: Affinity::Before,
                    },
                    Edge::After => Position::Edge {
                        node: *left,
                        side: Edge::After,
                    },
                },
                false,
            )),
            (
                Self::ChildInsert {
                    parent,
                    index: at,
                    count,
                    old_len,
                },
                Position::Child {
                    parent: target,
                    index,
                    affinity,
                },
            ) if *parent == target => {
                if index > *old_len {
                    return Err(MapError::OffsetOutOfBounds);
                }
                let (index, deleted) = replace_offset(index, affinity, *at, *at, *count)?;
                Ok((
                    Position::Child {
                        parent: target,
                        index,
                        affinity,
                    },
                    deleted,
                ))
            }
            (
                Self::ChildDelete {
                    parent,
                    index: at,
                    count,
                    old_len,
                },
                Position::Child {
                    parent: target,
                    index,
                    affinity,
                },
            ) if *parent == target => {
                if index > *old_len {
                    return Err(MapError::OffsetOutOfBounds);
                }
                let end = range_end(*at, *count, *old_len)?;
                let (index, deleted) = replace_offset(index, affinity, *at, end, 0)?;
                Ok((
                    Position::Child {
                        parent: target,
                        index,
                        affinity,
                    },
                    deleted,
                ))
            }
            (
                Self::ChildMove {
                    from_parent,
                    from_index,
                    to_parent,
                    to_index,
                    count,
                    from_len,
                    to_len,
                },
                Position::Child {
                    parent,
                    index,
                    affinity,
                },
            ) if parent == *from_parent || parent == *to_parent => {
                let old_len = if parent == *from_parent {
                    *from_len
                } else {
                    *to_len
                };
                if index > old_len {
                    return Err(MapError::OffsetOutOfBounds);
                }
                let end = range_end(*from_index, *count, *from_len)?;
                if *count == 0
                    || (from_parent == to_parent && (*from_index..=end).contains(to_index))
                {
                    return Ok((position, false));
                }
                let destination = if from_parent == to_parent && *to_index > end {
                    to_index - count
                } else {
                    *to_index
                };
                let removed = if parent == *from_parent {
                    replace_offset(index, affinity, *from_index, end, 0)?.0
                } else {
                    index
                };
                let inserted = if parent == *to_parent {
                    replace_offset(removed, affinity, destination, destination, *count)?.0
                } else {
                    removed
                };
                // Moving children does not retire descendant IDs. Parent gaps
                // use remove+insert semantics; deletion provenance is reserved
                // for actual text/child deletion or an explicit Retire step.
                Ok((
                    Position::Child {
                        parent,
                        index: inserted,
                        affinity,
                    },
                    false,
                ))
            }
            (
                Self::Retire {
                    nodes,
                    parent,
                    index,
                },
                _,
            ) if nodes.contains(&position.node()) => Ok((
                Position::Child {
                    parent: *parent,
                    index: *index,
                    affinity: position.affinity(),
                },
                true,
            )),
            _ => Ok((position, false)),
        }
    }

    fn identity_liveness(&self, node: N) -> Option<IdentityLiveness> {
        match self {
            Self::Retire { nodes, .. } if nodes.contains(&node) => Some(IdentityLiveness::Retired),
            Self::JoinText { right, .. } if *right == node => Some(IdentityLiveness::Retired),
            Self::Revive { nodes } if nodes.contains(&node) => Some(IdentityLiveness::Live),
            _ => None,
        }
    }
}

/// A later owned revival supersedes retirement metadata for that identity.
/// This never rewinds the ordered position transforms or Deleted provenance.
fn is_retired<N: Copy + Eq>(steps: &[StepMap<N>], node: N) -> bool {
    steps
        .iter()
        .rev()
        .find_map(|step| step.identity_liveness(node))
        == Some(IdentityLiveness::Retired)
}

/// One committed revision with ordered structural/normalization steps.
/// Refusals use identity(revision), which does not enter retained committed logs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PositionMap<N> {
    before: u64,
    after: u64,
    steps: Vec<StepMap<N>>,
}

impl<N: Copy + Eq> PositionMap<N> {
    pub fn new(before: u64, after: u64, steps: Vec<StepMap<N>>) -> Result<Self, MapError> {
        if before.checked_add(1) != Some(after) {
            return Err(MapError::InvalidRevision);
        }
        for (index, step) in steps.iter().enumerate() {
            step.validate()?;
            if let StepMap::Retire { parent, .. } = step
                && is_retired(&steps[..index], *parent)
            {
                return Err(MapError::RetiredFallback);
            }
        }
        Ok(Self {
            before,
            after,
            steps,
        })
    }

    pub fn identity(revision: u64) -> Self {
        Self {
            before: revision,
            after: revision,
            steps: Vec::new(),
        }
    }

    pub fn before(&self) -> u64 {
        self.before
    }

    pub fn after(&self) -> u64 {
        self.after
    }

    pub fn steps(&self) -> &[StepMap<N>] {
        &self.steps
    }

    pub fn map_from(&self, revision: u64, position: Position<N>) -> MapResult<N> {
        if revision != self.before {
            MapResult::Stale
        } else {
            self.map(position)
        }
    }

    pub fn map(&self, mut position: Position<N>) -> MapResult<N> {
        let mut deleted = false;
        for step in &self.steps {
            match step.map_valid(position) {
                Ok((next, was_deleted)) => {
                    position = next;
                    deleted |= was_deleted;
                }
                Err(error) => return MapResult::Invalid(error),
            }
        }
        if is_retired(&self.steps, position.node()) {
            return MapResult::Invalid(MapError::UnresolvedRetiredNode);
        }
        if deleted {
            MapResult::Deleted(position)
        } else {
            MapResult::Mapped(position)
        }
    }
}

/// Count-bounded contiguous local rebase maps. The session's admitted operation
/// budget additionally bounds each map payload; this is not a history store.
#[derive(Debug, Clone)]
pub struct MapLog<N> {
    capacity: usize,
    current: u64,
    entries: VecDeque<PositionMap<N>>,
}

impl<N: Copy + Eq> MapLog<N> {
    pub fn new(revision: u64, capacity: usize) -> Result<Self, MapError> {
        if capacity == 0 {
            return Err(MapError::ZeroCapacity);
        }
        Ok(Self {
            capacity,
            current: revision,
            entries: VecDeque::new(),
        })
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }

    pub fn current_revision(&self) -> u64 {
        self.current
    }

    pub fn oldest_revision(&self) -> u64 {
        self.entries.front().map_or(self.current, |map| map.before)
    }

    /// Returns any evicted map explicitly. An invalid push leaves the log intact.
    pub fn push(&mut self, map: PositionMap<N>) -> Result<Option<PositionMap<N>>, MapError> {
        if map.before != self.current {
            return Err(MapError::NonContiguousRevision);
        }
        if map.before.checked_add(1) != Some(map.after) {
            return Err(MapError::InvalidRevision);
        }
        self.current = map.after;
        self.entries.push_back(map);
        Ok(if self.entries.len() > self.capacity {
            self.entries.pop_front()
        } else {
            None
        })
    }

    pub fn map(&self, from: u64, to: u64, mut position: Position<N>) -> MapResult<N> {
        if from > to {
            return MapResult::Invalid(MapError::InvalidRevision);
        }
        if from < self.oldest_revision() || to > self.current {
            return MapResult::Stale;
        }
        let mut revision = from;
        let mut deleted = false;
        for map in &self.entries {
            if revision == to {
                break;
            }
            if map.after <= revision {
                continue;
            }
            if map.before != revision || map.after > to {
                return MapResult::Stale;
            }
            match map.map(position) {
                MapResult::Mapped(next) => position = next,
                MapResult::Deleted(next) => {
                    position = next;
                    deleted = true;
                }
                other => return other,
            }
            revision = map.after;
        }
        if revision != to {
            return MapResult::Stale;
        }
        if deleted {
            MapResult::Deleted(position)
        } else {
            MapResult::Mapped(position)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use editor_core::positions::Selection;

    fn text(leaf: &'static str, at: usize, affinity: Affinity) -> Position<&'static str> {
        Position::Text {
            leaf,
            utf16: Utf16Offset::new(at),
            affinity,
        }
    }

    fn child(parent: &'static str, index: usize, affinity: Affinity) -> Position<&'static str> {
        Position::Child {
            parent,
            index,
            affinity,
        }
    }

    #[test]
    fn adr003_literal_replacement_boundaries_and_reverse_selection() {
        use Affinity::{After, Before};
        // Hand-authored ADR-003 endpoints, including both affinities at a/b.
        for (from, to, inserted, at, affinity, expected, deleted) in [
            (2, 2, 3, 2, Before, 2, false),
            (2, 2, 3, 2, After, 5, false),
            (2, 2, 3, 5, Before, 8, false),
            (2, 5, 0, 3, After, 2, true),
            (2, 5, 1, 5, Before, 3, false),
            (2, 5, 4, 3, Before, 2, true),
            (2, 5, 4, 4, After, 6, true),
            (2, 5, 4, 2, Before, 2, false),
            (2, 5, 4, 2, After, 6, false),
            (2, 5, 4, 5, After, 6, false),
            (2, 5, 0, 2, After, 2, false),
            (2, 5, 0, 5, Before, 2, false),
            (0, 0, 0, 0, After, 0, false),
        ] {
            let step = StepMap::ReplaceText {
                leaf: "t",
                from: Utf16Offset::new(from),
                to: Utf16Offset::new(to),
                inserted,
                old_len: 6,
            };
            let result = step.map(text("t", at, affinity));
            assert_eq!(result.position(), Some(text("t", expected, affinity)));
            assert_eq!(result.is_deleted(), deleted);
        }
        let selection = Selection {
            anchor: text("t", 6, After),
            focus: text("t", 2, Before),
        };
        let map = PositionMap::new(
            7,
            8,
            vec![StepMap::ReplaceText {
                leaf: "t",
                from: Utf16Offset::new(0),
                to: Utf16Offset::new(0),
                inserted: 2,
                old_len: 6,
            }],
        )
        .unwrap();
        assert_eq!(
            map.map(selection.anchor),
            MapResult::Mapped(text("t", 8, After))
        );
        assert_eq!(
            map.map(selection.focus),
            MapResult::Mapped(text("t", 4, Before))
        );
    }

    #[test]
    fn join_preserves_left_end_edge_at_the_original_utf16_boundary() {
        use Affinity::{After, Before};
        // Literal text dimensions: left "Я😀" is 3 UTF-16 units and right
        // "e\u{301}💻" is 4. The old left end is offset 3, not joined end 7.
        let joined = PositionMap::new(
            7,
            8,
            vec![
                StepMap::JoinText {
                    left: "left",
                    right: "right",
                    left_len: 3,
                    right_len: 4,
                },
                StepMap::ChildDelete {
                    parent: "p",
                    index: 1,
                    count: 1,
                    old_len: 2,
                },
                StepMap::Retire {
                    nodes: vec!["right"],
                    parent: "p",
                    index: 1,
                },
            ],
        )
        .unwrap();
        let edge = |node, side| Position::Edge { node, side };
        for (before, after) in [
            (edge("left", Edge::After), text("left", 3, After)),
            (text("left", 3, After), text("left", 3, After)),
            (edge("left", Edge::Before), edge("left", Edge::Before)),
            (text("left", 0, Before), text("left", 0, Before)),
            (edge("right", Edge::Before), text("left", 3, Before)),
            (text("right", 0, Before), text("left", 3, Before)),
            (edge("right", Edge::After), edge("left", Edge::After)),
            (text("right", 4, After), text("left", 7, After)),
        ] {
            assert_eq!(joined.map(before), MapResult::Mapped(after), "{before:?}");
        }
    }

    #[test]
    fn split_affinity_edges_and_join_retired_identity_have_explicit_successors() {
        use Affinity::{After, Before};
        let split = StepMap::SplitText {
            left: "t",
            right: "u",
            at: Utf16Offset::new(2),
            old_len: 5,
        };
        assert_eq!(
            split.map(text("t", 2, Before)),
            MapResult::Mapped(text("t", 2, Before))
        );
        assert_eq!(
            split.map(text("t", 2, After)),
            MapResult::Mapped(text("u", 0, After))
        );
        assert_eq!(
            split.map(text("t", 5, Before)),
            MapResult::Mapped(text("u", 3, Before))
        );
        assert_eq!(
            split.map(Position::Edge {
                node: "t",
                side: Edge::After
            }),
            MapResult::Mapped(Position::Edge {
                node: "u",
                side: Edge::After
            })
        );
        let joined = PositionMap::new(
            7,
            8,
            vec![
                StepMap::JoinText {
                    left: "t",
                    right: "u",
                    left_len: 4,
                    right_len: 3,
                },
                StepMap::ChildDelete {
                    parent: "p",
                    index: 1,
                    count: 1,
                    old_len: 2,
                },
                StepMap::Retire {
                    nodes: vec!["u"],
                    parent: "p",
                    index: 1,
                },
            ],
        )
        .unwrap();
        assert_eq!(
            joined.map(text("u", 3, After)),
            MapResult::Mapped(text("t", 7, After))
        );
        assert_eq!(
            joined.map(Position::Edge {
                node: "u",
                side: Edge::Before
            }),
            MapResult::Mapped(text("t", 4, Before))
        );
        assert_eq!(
            joined.map(Position::Edge {
                node: "u",
                side: Edge::After
            }),
            MapResult::Mapped(Position::Edge {
                node: "t",
                side: Edge::After
            })
        );
    }

    #[test]
    fn child_insert_delete_and_empty_parent_zero_do_not_invent_text_offsets() {
        use Affinity::{After, Before};
        let insertion = StepMap::ChildInsert {
            parent: "root",
            index: 0,
            count: 1,
            old_len: 0,
        };
        assert_eq!(
            insertion.map(child("root", 0, Before)),
            MapResult::Mapped(child("root", 0, Before))
        );
        assert_eq!(
            insertion.map(child("root", 0, After)),
            MapResult::Mapped(child("root", 1, After))
        );
        let deletion = StepMap::ChildDelete {
            parent: "root",
            index: 1,
            count: 2,
            old_len: 4,
        };
        assert_eq!(
            deletion.map(child("root", 1, After)),
            MapResult::Mapped(child("root", 1, After))
        );
        assert_eq!(
            deletion.map(child("root", 2, Before)),
            MapResult::Deleted(child("root", 1, Before))
        );
        assert_eq!(
            deletion.map(child("root", 3, Before)),
            MapResult::Mapped(child("root", 1, Before))
        );
        assert_eq!(
            deletion.map(child("root", 4, After)),
            MapResult::Mapped(child("root", 2, After))
        );
    }

    #[test]
    fn move_uses_pre_operation_destination_once_and_preserves_descendants() {
        use Affinity::{After, Before};
        let forward = StepMap::ChildMove {
            from_parent: "root",
            from_index: 1,
            to_parent: "root",
            to_index: 3,
            count: 1,
            from_len: 3,
            to_len: 3,
        };
        assert_eq!(
            forward.map(child("root", 3, Before)),
            MapResult::Mapped(child("root", 2, Before))
        );
        assert_eq!(
            forward.map(text("descendant", 2, After)),
            MapResult::Mapped(text("descendant", 2, After))
        );
        let backward = StepMap::ChildMove {
            from_parent: "root",
            from_index: 2,
            to_parent: "root",
            to_index: 0,
            count: 1,
            from_len: 3,
            to_len: 3,
        };
        assert_eq!(
            backward.map(child("root", 0, Before)),
            MapResult::Mapped(child("root", 0, Before))
        );
        assert_eq!(
            backward.map(child("root", 0, After)),
            MapResult::Mapped(child("root", 1, After))
        );
        let cross = StepMap::ChildMove {
            from_parent: "a",
            from_index: 1,
            to_parent: "b",
            to_index: 0,
            count: 1,
            from_len: 3,
            to_len: 0,
        };
        assert_eq!(
            cross.map(child("a", 3, Before)),
            MapResult::Mapped(child("a", 2, Before))
        );
        assert_eq!(
            cross.map(child("b", 0, After)),
            MapResult::Mapped(child("b", 1, After))
        );
        for destination in 1..=3 {
            let noop = StepMap::ChildMove {
                from_parent: "root",
                from_index: 1,
                to_parent: "root",
                to_index: destination,
                count: 2,
                from_len: 4,
                to_len: 4,
            };
            for index in 0..=4 {
                assert_eq!(
                    noop.map(child("root", index, After)),
                    MapResult::Mapped(child("root", index, After))
                );
            }
        }
    }

    #[test]
    fn deleting_nested_then_parent_then_grandparent_retains_deleted_provenance() {
        use Affinity::{After, Before};
        let map = PositionMap::new(
            7,
            8,
            vec![
                StepMap::ChildDelete {
                    parent: "inner",
                    index: 0,
                    count: 1,
                    old_len: 1,
                },
                StepMap::Retire {
                    nodes: vec!["n", "t"],
                    parent: "inner",
                    index: 0,
                },
                StepMap::ChildDelete {
                    parent: "outer",
                    index: 0,
                    count: 1,
                    old_len: 1,
                },
                StepMap::Retire {
                    nodes: vec!["inner"],
                    parent: "outer",
                    index: 0,
                },
                StepMap::ChildDelete {
                    parent: "root",
                    index: 1,
                    count: 1,
                    old_len: 3,
                },
                StepMap::Retire {
                    nodes: vec!["outer"],
                    parent: "root",
                    index: 1,
                },
            ],
        )
        .unwrap();
        assert_eq!(
            map.map(text("t", 2, After)),
            MapResult::Deleted(child("root", 1, After))
        );
        assert_eq!(
            map.map(child("inner", 0, Before)),
            MapResult::Deleted(child("root", 1, Before))
        );
        assert_eq!(
            map.map(text("survivor", 1, Before)),
            MapResult::Mapped(text("survivor", 1, Before))
        );
        let atom = StepMap::Retire {
            nodes: vec!["image"],
            parent: "root",
            index: 1,
        };
        assert_eq!(
            atom.map(Position::Edge {
                node: "image",
                side: Edge::After
            }),
            MapResult::Deleted(child("root", 1, After))
        );
    }

    #[test]
    fn mark_splits_compose_in_order_without_reordering_reverse_selection() {
        use Affinity::{After, Before};
        let map = PositionMap::new(
            7,
            8,
            vec![
                StepMap::SplitText {
                    left: "t",
                    right: "m",
                    at: Utf16Offset::new(2),
                    old_len: 6,
                },
                StepMap::SplitText {
                    left: "m",
                    right: "s",
                    at: Utf16Offset::new(2),
                    old_len: 4,
                },
            ],
        )
        .unwrap();
        assert_eq!(
            map.map(text("t", 6, After)),
            MapResult::Mapped(text("s", 2, After))
        );
        assert_eq!(
            map.map(text("t", 2, After)),
            MapResult::Mapped(text("m", 0, After))
        );
        assert_eq!(
            map.map(text("t", 2, Before)),
            MapResult::Mapped(text("t", 2, Before))
        );
    }

    #[test]
    fn owned_join_revival_permits_the_historical_successor_without_false_retirement() {
        use Affinity::{After, Before};
        let map = PositionMap::new(
            7,
            8,
            vec![
                StepMap::JoinText {
                    left: "t",
                    right: "u",
                    left_len: 4,
                    right_len: 3,
                },
                StepMap::ChildDelete {
                    parent: "p",
                    index: 1,
                    count: 1,
                    old_len: 2,
                },
                StepMap::Retire {
                    nodes: vec!["u"],
                    parent: "p",
                    index: 1,
                },
                StepMap::Revive { nodes: vec!["u"] },
                StepMap::SplitText {
                    left: "t",
                    right: "u",
                    at: Utf16Offset::new(4),
                    old_len: 7,
                },
                StepMap::ChildInsert {
                    parent: "p",
                    index: 1,
                    count: 1,
                    old_len: 1,
                },
            ],
        )
        .unwrap();
        assert_eq!(
            map.map(text("u", 3, After)),
            MapResult::Mapped(text("u", 3, After))
        );
        assert_eq!(
            map.map(text("t", 4, After)),
            MapResult::Mapped(text("u", 0, After))
        );
        assert_eq!(
            map.map(Position::Edge {
                node: "u",
                side: Edge::After,
            }),
            MapResult::Mapped(Position::Edge {
                node: "u",
                side: Edge::After,
            })
        );
        assert_eq!(
            map.map(Position::Edge {
                node: "u",
                side: Edge::Before,
            }),
            MapResult::Mapped(text("t", 4, Before))
        );
        let without_owned_revival = PositionMap::new(
            7,
            8,
            map.steps()
                .iter()
                .filter(|step| !matches!(step, StepMap::Revive { .. }))
                .cloned()
                .collect(),
        )
        .unwrap();
        assert_eq!(
            without_owned_revival.map(text("u", 3, After)),
            MapResult::Invalid(MapError::UnresolvedRetiredNode)
        );
    }

    #[test]
    fn revival_never_reattaches_an_old_deleted_anchor_or_clears_its_provenance() {
        use Affinity::{After, Before};
        let deletion = vec![
            StepMap::ChildDelete {
                parent: "root",
                index: 1,
                count: 1,
                old_len: 3,
            },
            StepMap::Retire {
                nodes: vec!["p", "t"],
                parent: "root",
                index: 1,
            },
        ];
        let revival = vec![
            StepMap::Revive {
                nodes: vec!["p", "t"],
            },
            StepMap::ChildInsert {
                parent: "root",
                index: 1,
                count: 1,
                old_len: 2,
            },
        ];
        let mut ordered = deletion.clone();
        ordered.extend(revival.clone());
        let map = PositionMap::new(7, 8, ordered).unwrap();
        assert_eq!(
            map.map(text("t", 2, After)),
            MapResult::Deleted(child("root", 2, After))
        );
        assert_eq!(
            map.map(text("t", 2, Before)),
            MapResult::Deleted(child("root", 1, Before))
        );
        let mut log = MapLog::new(7, 2).unwrap();
        log.push(PositionMap::new(7, 8, deletion).unwrap()).unwrap();
        log.push(PositionMap::new(8, 9, revival).unwrap()).unwrap();
        assert_eq!(
            log.map(7, 9, text("t", 2, After)),
            MapResult::Deleted(child("root", 2, After))
        );
    }

    #[test]
    fn fallback_parent_uses_latest_liveness_and_repeated_retirement_still_cascades() {
        use Affinity::After;
        let prefix = vec![
            StepMap::Retire {
                nodes: vec!["p"],
                parent: "root",
                index: 0,
            },
            StepMap::Revive { nodes: vec!["p"] },
            StepMap::Retire {
                nodes: vec!["t"],
                parent: "p",
                index: 0,
            },
        ];
        let map = PositionMap::new(7, 8, prefix.clone()).unwrap();
        assert_eq!(
            map.map(text("t", 2, After)),
            MapResult::Deleted(child("p", 0, After))
        );
        // Old anchors already fell back to root before p was revived.
        assert_eq!(
            map.map(child("p", 0, After)),
            MapResult::Deleted(child("root", 0, After))
        );
        let mut cascade = prefix;
        cascade.push(StepMap::Retire {
            nodes: vec!["p"],
            parent: "root",
            index: 0,
        });
        let map = PositionMap::new(7, 8, cascade).unwrap();
        assert_eq!(
            map.map(text("t", 2, After)),
            MapResult::Deleted(child("root", 0, After))
        );
        assert_eq!(
            PositionMap::new(
                7,
                8,
                vec![
                    StepMap::Retire {
                        nodes: vec!["p"],
                        parent: "root",
                        index: 0,
                    },
                    StepMap::Revive { nodes: vec!["p"] },
                    StepMap::Retire {
                        nodes: vec!["p"],
                        parent: "root",
                        index: 0,
                    },
                    StepMap::Retire {
                        nodes: vec!["t"],
                        parent: "p",
                        index: 0,
                    },
                ],
            ),
            Err(MapError::RetiredFallback)
        );
    }

    #[test]
    fn invalid_offsets_arithmetic_revisions_and_retirement_cycles_are_explicit() {
        let replace = StepMap::ReplaceText {
            leaf: 1,
            from: Utf16Offset::new(0),
            to: Utf16Offset::new(1),
            inserted: 0,
            old_len: 1,
        };
        assert_eq!(
            replace.map(Position::Text {
                leaf: 1,
                utf16: Utf16Offset::new(2),
                affinity: Affinity::After
            }),
            MapResult::Invalid(MapError::OffsetOutOfBounds)
        );
        assert_eq!(
            StepMap::ChildInsert {
                parent: 1,
                index: 0,
                count: 1,
                old_len: usize::MAX
            }
            .validate(),
            Err(MapError::ArithmeticOverflow)
        );
        assert_eq!(
            StepMap::ReplaceText {
                leaf: 1,
                from: Utf16Offset::new(2),
                to: Utf16Offset::new(1),
                inserted: 0,
                old_len: 2
            }
            .validate(),
            Err(MapError::InvalidRange)
        );
        assert_eq!(
            PositionMap::<i32>::new(u64::MAX, 0, vec![]),
            Err(MapError::InvalidRevision)
        );
        assert_eq!(
            PositionMap::<i32>::new(7, 9, vec![]),
            Err(MapError::InvalidRevision)
        );
        assert_eq!(
            PositionMap::new(
                7,
                8,
                vec![StepMap::Retire {
                    nodes: vec![1],
                    parent: 1,
                    index: 0
                }]
            ),
            Err(MapError::RetiredFallback)
        );
        assert_eq!(
            PositionMap::new(
                7,
                8,
                vec![
                    StepMap::Retire {
                        nodes: vec![1],
                        parent: 0,
                        index: 0
                    },
                    StepMap::Retire {
                        nodes: vec![2],
                        parent: 1,
                        index: 0
                    }
                ]
            ),
            Err(MapError::RetiredFallback)
        );
        let map = PositionMap::<i32>::identity(u64::MAX);
        let position = Position::Child {
            parent: 0,
            index: 0,
            affinity: Affinity::Before,
        };
        assert_eq!(
            map.map_from(u64::MAX, position),
            MapResult::Mapped(position)
        );
        assert_eq!(map.map_from(0, position), MapResult::Stale);
    }

    #[test]
    fn bounded_log_requires_every_revision_and_observes_eviction_and_deleted_state() {
        use Affinity::After;
        assert!(matches!(
            MapLog::<&str>::new(7, 0),
            Err(MapError::ZeroCapacity)
        ));
        let mut log = MapLog::new(7, 2).unwrap();
        let first = PositionMap::new(
            7,
            8,
            vec![StepMap::ReplaceText {
                leaf: "t",
                from: Utf16Offset::new(1),
                to: Utf16Offset::new(3),
                inserted: 0,
                old_len: 4,
            }],
        )
        .unwrap();
        assert!(log.push(first).unwrap().is_none());
        let second = PositionMap::new(
            8,
            9,
            vec![StepMap::ReplaceText {
                leaf: "t",
                from: Utf16Offset::new(0),
                to: Utf16Offset::new(0),
                inserted: 1,
                old_len: 2,
            }],
        )
        .unwrap();
        assert!(log.push(second).unwrap().is_none());
        assert_eq!(
            log.map(7, 9, text("t", 2, After)),
            MapResult::Deleted(text("t", 2, After))
        );
        assert_eq!(
            log.map(7, 8, text("t", 2, After)),
            MapResult::Deleted(text("t", 1, After))
        );
        assert_eq!(log.map(6, 9, text("t", 0, After)), MapResult::Stale);
        assert_eq!(log.map(7, 10, text("t", 0, After)), MapResult::Stale);
        assert_eq!(
            log.map(9, 8, text("t", 0, After)),
            MapResult::Invalid(MapError::InvalidRevision)
        );
        let failed = PositionMap::new(10, 11, vec![]).unwrap();
        assert_eq!(log.push(failed), Err(MapError::NonContiguousRevision));
        assert_eq!(log.current_revision(), 9);
        let evicted = log
            .push(PositionMap::new(9, 10, vec![]).unwrap())
            .unwrap()
            .unwrap();
        assert_eq!((evicted.before(), evicted.after()), (7, 8));
        assert_eq!(log.len(), 2);
        assert_eq!(log.oldest_revision(), 8);
        assert_eq!(log.map(7, 10, text("t", 2, After)), MapResult::Stale);
        assert_eq!(
            log.map(8, 10, text("t", 1, After)),
            MapResult::Mapped(text("t", 2, After))
        );
        assert_eq!(
            log.push(PositionMap::identity(10)),
            Err(MapError::InvalidRevision)
        );
        assert_eq!(log.current_revision(), 10);
    }
}
