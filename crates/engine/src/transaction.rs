// SPDX-License-Identifier: MIT OR Apache-2.0
//! Unstable native transaction DTOs, bounded commit journal and typed outcomes.
//! No SDK/serde contract and no unchecked history restoration authority.

use std::collections::VecDeque;
use std::sync::Arc;

use editor_core::commands::{LocalRef, SelectionIntent};
use editor_core::document::Mark;
use editor_core::limits::LimitExceeded;
use editor_core::positions::{Position, Selection};
use editor_core::transaction::{Operation, ValidationStats, WorkLimits, WorkTrace, WorkUsage};

use crate::events::EventError;
use crate::history::{HistoryError, HistoryHint, HistoryLimits, ProjectedMap};
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
    pub history: HistoryLimits,
}
impl Default for TransactionLimits {
    fn default() -> Self {
        Self {
            operations: 256,
            normalization_passes: 512,
            work: WorkLimits::default(),
            journal_entries: 64,
            journal_bytes: 32 * 1024 * 1024,
            history: HistoryLimits::default(),
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
            journal_entries: self
                .journal_entries
                .min(hard.journal_entries)
                .min(self.history.effective().chronological_entries),
            journal_bytes: self
                .journal_bytes
                .min(hard.journal_bytes)
                .min(self.history.effective().aggregate_bytes),
            history: self.history.effective(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Transaction {
    pub session: SessionKey,
    pub revision: u64,
    pub selection_epoch: Option<u64>,
    pub history_epoch: Option<u64>,
    pub history_hint: HistoryHint,
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
            history_epoch: None,
            history_hint: HistoryHint::Isolated,
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
    History(HistoryError),
    Events(EventError),
}
impl<E> From<EventError> for TransactionError<E> {
    fn from(error: EventError) -> Self {
        Self::Events(error)
    }
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
impl<E> From<HistoryError> for TransactionError<E> {
    fn from(error: HistoryError) -> Self {
        Self::History(error)
    }
}

pub(crate) fn error_code<E>(
    error: &TransactionError<E>,
    profile: impl FnOnce(&E) -> &'static str,
) -> &'static str {
    match error {
        TransactionError::State(error) => match error {
            StateError::StaleSession => "session.stale_session",
            StateError::StaleRevision => "session.stale_revision",
            StateError::StaleSelectionEpoch => "session.stale_selection_epoch",
            StateError::StaleHistoryEpoch => "session.stale_history_epoch",
            StateError::Closed => "session.closed",
            StateError::Poisoned => "session.poisoned",
            StateError::ReadOnly => "session.read_only",
            StateError::CounterExhausted => "session.counter_exhausted",
        },
        TransactionError::Tree(error) => match error {
            TreeError::MissingNode => "tree.missing_node",
            TreeError::ForeignSession => "tree.foreign_session",
            TreeError::InvalidStructure => "tree.invalid_structure",
            TreeError::InvalidIndex => "tree.invalid_index",
            TreeError::InvalidRange => "tree.invalid_range",
            TreeError::RootMutation => "tree.root_mutation",
            TreeError::Cycle => "tree.cycle",
            TreeError::IncompatibleText => "tree.incompatible_text",
            TreeError::ResourceLimit => "resource_limit_exceeded",
            TreeError::CounterExhausted => "session.counter_exhausted",
            TreeError::Position(_) => "position.invalid",
            TreeError::ReplayMismatch => "history.expected_side_mismatch",
        },
        TransactionError::Profile(error) => profile(error),
        TransactionError::Limit(_) => "resource_limit_exceeded",
        TransactionError::Mapping(_) => "mapping.invalid",
        TransactionError::InvalidLocalReference => "transaction.invalid_local_reference",
        TransactionError::NormalizationLimit => "transaction.normalization_limit",
        TransactionError::JournalLimit => "transaction.journal_limit",
        TransactionError::History(error) => error.as_str(),
        TransactionError::Events(error) => error.as_str(),
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
    pub trace: WorkTrace,
    pub notification: Arc<crate::events::SessionEvent>,
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
    pub(crate) material: Arc<CommitMaterial>,
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

pub(crate) struct CommitJournal {
    entries: VecDeque<JournalEntry>,
    bytes: usize,
    evicted: u64,
}
impl Default for CommitJournal {
    fn default() -> Self {
        // The bounded chronological ring is allocated at admission/remount.
        // Publication pops its projected prefix before pushing into this fixed
        // capacity, so no expected allocation gate remains after tree publish.
        Self {
            entries: VecDeque::with_capacity(TransactionLimits::default().journal_entries),
            bytes: 0,
            evicted: 0,
        }
    }
}
pub(crate) struct JournalPlan {
    pub(crate) evict: usize,
    bytes: usize,
    evicted: u64,
}
impl CommitJournal {
    pub(crate) fn projected_summary(&self, plan: &JournalPlan, before: u64) -> JournalSummary {
        JournalSummary {
            entries: self.entries.len() + 1 - plan.evict,
            bytes: plan.bytes,
            evicted: plan.evicted,
            oldest_revision: self
                .entries
                .get(plan.evict)
                .map_or(before, |entry| entry.map.before()),
        }
    }

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
        self.plan_at_least(new_bytes, limits, 0)
    }
    pub(crate) fn plan_at_least<E>(
        &self,
        new_bytes: usize,
        limits: TransactionLimits,
        minimum_evictions: usize,
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
                && evict >= minimum_evictions
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
    /// The oldest prefix was already projected by the chronological cap. The
    /// history planner may release a further prefix for the shared byte bound.
    pub(crate) fn projected_maps<'a>(
        &'a self,
        new_material: &'a Arc<CommitMaterial>,
        new_bytes: usize,
        plan: &JournalPlan,
    ) -> Vec<ProjectedMap<'a>> {
        self.entries
            .iter()
            .skip(plan.evict)
            .map(|entry| ProjectedMap {
                material: &entry.material,
                metadata_bytes: entry.bytes
                    - entry.material.estimated_bytes()
                    - std::mem::size_of::<JournalEntry>(),
            })
            .chain(std::iter::once(ProjectedMap {
                material: new_material,
                // Charge the real ring allocation exactly once on the protected
                // newest map. Eviction frees payload, never the ring's slots.
                metadata_bytes: new_bytes
                    - new_material.estimated_bytes()
                    - std::mem::size_of::<JournalEntry>()
                    + self.entries.capacity() * std::mem::size_of::<JournalEntry>()
                    + std::mem::size_of::<CommitJournal>(),
            }))
            .collect()
    }
    /// All fallible arithmetic and retention decisions were prepared earlier.
    pub(crate) fn publish(&mut self, entry: JournalEntry, plan: JournalPlan) {
        for _ in 0..plan.evict {
            self.entries.pop_front();
        }
        debug_assert!(self.entries.len() < self.entries.capacity());
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
