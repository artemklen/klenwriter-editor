// SPDX-License-Identifier: MIT OR Apache-2.0
//! Unstable native transaction DTOs, bounded commit journal and typed outcomes.
//! No SDK/serde contract and no unchecked history restoration authority.

use std::collections::VecDeque;

use editor_core::commands::{LocalRef, SelectionIntent};
use editor_core::document::Mark;
use editor_core::limits::LimitExceeded;
use editor_core::positions::{Position, Selection};
use editor_core::transaction::{Operation, ValidationStats, WorkLimits, WorkUsage};

use crate::identity::{NodeId, SessionKey};
use crate::mapping::{MapError, MapResult, PositionMap};
use crate::session::StateError;
use crate::tree::{CommitMaterial, TreeError};

/// A path begins with a root returned by an earlier operation, then child
/// indices. It cannot supply fabricated session IDs or refer forward in a batch.
pub type NodeRef = LocalRef<NodeId>;
pub type SelectionUpdate = SelectionIntent<NodeId>;

/// Every host setting tightens a distribution ceiling. The journal's actual
/// retained bound also applies when an individual transaction requests more.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TransactionLimits {
    pub operations: usize,
    pub normalization_passes: usize,
    pub work: WorkLimits,
    pub journal_entries: usize,
    pub journal_bytes: usize,
}
impl Default for TransactionLimits {
    fn default() -> Self {
        Self {
            operations: 256,
            normalization_passes: 512,
            work: WorkLimits::default(),
            journal_entries: 64,
            journal_bytes: 32 * 1024 * 1024,
        }
    }
}
impl TransactionLimits {
    pub(crate) fn effective(self) -> Self {
        let hard = Self::default();
        Self {
            operations: self.operations.min(hard.operations),
            normalization_passes: self.normalization_passes.min(hard.normalization_passes),
            work: WorkLimits {
                units: self.work.units.min(hard.work.units),
                bytes: self.work.bytes.min(hard.work.bytes),
            },
            journal_entries: self.journal_entries.min(hard.journal_entries),
            journal_bytes: self.journal_bytes.min(hard.journal_bytes),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Transaction {
    pub session: SessionKey,
    pub revision: u64,
    pub selection_epoch: Option<u64>,
    pub operations: Vec<Operation<NodeRef>>,
    pub selection: SelectionUpdate,
    pub limits: TransactionLimits,
}
impl Transaction {
    pub fn new(session: SessionKey, revision: u64, operations: Vec<Operation<NodeRef>>) -> Self {
        Self {
            session,
            revision,
            selection_epoch: None,
            operations,
            selection: SelectionUpdate::MapCurrent,
            limits: TransactionLimits::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransactionError<E> {
    State(StateError),
    Tree(TreeError),
    Profile(E),
    Limit(LimitExceeded),
    Mapping(MapError),
    InvalidLocalReference,
    NormalizationLimit,
    JournalLimit,
}
impl<E> From<TreeError> for TransactionError<E> {
    fn from(error: TreeError) -> Self {
        Self::Tree(error)
    }
}
impl<E> From<LimitExceeded> for TransactionError<E> {
    fn from(error: LimitExceeded) -> Self {
        Self::Limit(error)
    }
}
impl<E> From<StateError> for TransactionError<E> {
    fn from(error: StateError) -> Self {
        Self::State(error)
    }
}
impl<E> From<MapError> for TransactionError<E> {
    fn from(error: MapError) -> Self {
        Self::Mapping(error)
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct JournalSummary {
    pub entries: usize,
    pub bytes: usize,
    pub evicted: u64,
    pub oldest_revision: u64,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JournalEntrySummary {
    pub before_revision: u64,
    pub after_revision: u64,
    pub before_records: usize,
    pub after_records: usize,
    pub changed_records: usize,
    pub bytes: usize,
    pub selection_before: Option<Selection<NodeId>>,
    pub selection_after: Option<Selection<NodeId>>,
    pub stored_marks_before: Option<Vec<Mark>>,
    pub stored_marks_after: Option<Vec<Mark>>,
}

/// Returned after coherent publication. There are no callbacks inside dispatch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitEvent {
    pub revision: u64,
    pub selection_epoch: u64,
    pub selection_before: Option<Selection<NodeId>>,
    pub selection_after: Option<Selection<NodeId>>,
    pub stored_marks_before: Option<Vec<Mark>>,
    pub stored_marks_after: Option<Vec<Mark>>,
    pub map: PositionMap<NodeId>,
    pub changed_nodes: Vec<NodeId>,
    pub journal: JournalSummary,
    pub normalization_operations: usize,
    pub validation: ValidationStats,
    pub work: WorkUsage,
    pub dirty: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[expect(
    clippy::large_enum_variant,
    reason = "Bounded inline event avoids a new allocation at the commit boundary"
)]
pub enum DispatchOutcome<E> {
    Changed(CommitEvent),
    /// The document is unchanged; a requested selection-only update is explicit.
    Unchanged {
        revision: u64,
        selection_epoch: u64,
        selection_changed: bool,
        stored_marks_changed: bool,
        map: PositionMap<NodeId>,
        work: WorkUsage,
    },
    Refused {
        error: TransactionError<E>,
        map: PositionMap<NodeId>,
        work: WorkUsage,
    },
}

pub(crate) struct JournalEntry {
    pub(crate) material: CommitMaterial,
    pub(crate) map: PositionMap<NodeId>,
    pub(crate) before: Option<Selection<NodeId>>,
    pub(crate) after: Option<Selection<NodeId>>,
    pub(crate) marks_before: Option<Vec<Mark>>,
    pub(crate) marks_after: Option<Vec<Mark>>,
    pub(crate) bytes: usize,
}
impl JournalEntry {
    fn summary(&self) -> JournalEntrySummary {
        JournalEntrySummary {
            before_revision: self.map.before(),
            after_revision: self.map.after(),
            before_records: self.material.before_count(),
            after_records: self.material.after_count(),
            changed_records: self.material.changed_count(),
            bytes: self.bytes,
            selection_before: self.before,
            selection_after: self.after,
            stored_marks_before: self.marks_before.clone(),
            stored_marks_after: self.marks_after.clone(),
        }
    }
}

#[derive(Default)]
pub(crate) struct CommitJournal {
    entries: VecDeque<JournalEntry>,
    bytes: usize,
    evicted: u64,
}
pub(crate) struct JournalPlan {
    evict: usize,
    bytes: usize,
    evicted: u64,
}
impl CommitJournal {
    pub(crate) fn summary(&self, revision: u64) -> JournalSummary {
        JournalSummary {
            entries: self.entries.len(),
            bytes: self.bytes,
            evicted: self.evicted,
            oldest_revision: self
                .entries
                .front()
                .map_or(revision, |entry| entry.map.before()),
        }
    }
    pub(crate) fn entry_summaries(&self) -> Vec<JournalEntrySummary> {
        self.entries.iter().map(JournalEntry::summary).collect()
    }
    pub(crate) fn plan<E>(
        &self,
        new_bytes: usize,
        limits: TransactionLimits,
    ) -> Result<JournalPlan, TransactionError<E>> {
        if limits.journal_entries == 0 || new_bytes > limits.journal_bytes {
            return Err(TransactionError::JournalLimit);
        }
        let mut bytes = self
            .bytes
            .checked_add(new_bytes)
            .ok_or(StateError::CounterExhausted)?;
        let mut evict = 0;
        for entry in &self.entries {
            if self.entries.len() + 1 - evict <= limits.journal_entries
                && bytes <= limits.journal_bytes
            {
                break;
            }
            bytes -= entry.bytes;
            evict += 1;
        }
        let evicted = self
            .evicted
            .checked_add(evict as u64)
            .ok_or(StateError::CounterExhausted)?;
        Ok(JournalPlan {
            evict,
            bytes,
            evicted,
        })
    }
    /// All fallible arithmetic and retention decisions were prepared earlier.
    pub(crate) fn publish(&mut self, entry: JournalEntry, plan: JournalPlan) {
        for _ in 0..plan.evict {
            self.entries.pop_front();
        }
        self.entries.push_back(entry);
        self.bytes = plan.bytes;
        self.evicted = plan.evicted;
    }
    pub(crate) fn map(
        &self,
        from: u64,
        current: u64,
        mut position: Position<NodeId>,
    ) -> MapResult<NodeId> {
        if from > current {
            return MapResult::Invalid(MapError::InvalidRevision);
        }
        if from < self.summary(current).oldest_revision {
            return MapResult::Stale;
        }
        let mut revision = from;
        let mut deleted = false;
        for entry in &self.entries {
            if entry.map.after() <= revision {
                continue;
            }
            if entry.map.before() != revision {
                return MapResult::Stale;
            }
            match entry.map.map(position) {
                MapResult::Mapped(next) => position = next,
                MapResult::Deleted(next) => {
                    position = next;
                    deleted = true;
                }
                other => return other,
            }
            revision = entry.map.after();
        }
        if revision != current {
            MapResult::Stale
        } else if deleted {
            MapResult::Deleted(position)
        } else {
            MapResult::Mapped(position)
        }
    }
}
