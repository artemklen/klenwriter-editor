// SPDX-License-Identifier: MIT OR Apache-2.0
//! Actual replay availability and execution share one publication-free prepare.

use editor_core::history::HistoryProfile;
use editor_core::transaction::{WorkMeter, WorkUsage};

use super::dispatch::{Prepared, PreparedFor, copy_marks, map_bytes, validate_selection};
use super::{AccessMode, Session, SessionState, StateError};
use crate::history::{HistoryDirection, HistoryError, HistorySummary};
use crate::identity::SessionKey;
use crate::mapping::PositionMap;
use crate::transaction::{
    CommitEvent, DispatchOutcome, JournalEntry, TransactionError, TransactionLimits,
};
use crate::tree::{Allocation, ReplayDirection, TreeDraft, TreeError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HistoryRequest {
    pub session: SessionKey,
    pub revision: u64,
    pub selection_epoch: u64,
    pub history_epoch: u64,
    pub direction: HistoryDirection,
    pub limits: TransactionLimits,
}
impl HistoryRequest {
    pub fn new(
        session: SessionKey,
        revision: u64,
        selection_epoch: u64,
        history_epoch: u64,
        direction: HistoryDirection,
    ) -> Self {
        Self {
            session,
            revision,
            selection_epoch,
            history_epoch,
            direction,
            limits: TransactionLimits::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HistoryAvailability<E> {
    Available {
        selection_changed: bool,
        stored_marks_changed: bool,
        work: WorkUsage,
    },
    Unavailable {
        reason: &'static str,
        error: TransactionError<E>,
        work: WorkUsage,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[expect(
    clippy::large_enum_variant,
    reason = "Bounded inline event avoids allocation after publication"
)]
pub enum HistoryOutcome<E> {
    Completed(CommitEvent),
    Refused {
        reason: &'static str,
        error: TransactionError<E>,
        work: WorkUsage,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HistoryBoundaryEvent {
    pub changed: bool,
    pub history: HistorySummary,
    pub work: WorkUsage,
}

impl<P: HistoryProfile> Session<P> {
    fn prepare_history<A: Allocation>(
        &self,
        request: &HistoryRequest,
        mut draft: TreeDraft<'_, A>,
        work: &mut WorkMeter,
    ) -> Result<PreparedFor<P, A>, TransactionError<P::Error>> {
        self.guard(request.session, Some(request.revision))?;
        if request.selection_epoch != self.selection_epoch {
            return Err(StateError::StaleSelectionEpoch.into());
        }
        if request.history_epoch != self.history.summary().epoch {
            return Err(StateError::StaleHistoryEpoch.into());
        }
        if self.state == SessionState::Open(AccessMode::ReadOnly) {
            return Err(StateError::ReadOnly.into());
        }
        let limits = request.limits.effective();
        let unit = self
            .history
            .replay_unit(request.direction)
            .ok_or(HistoryError::Empty)?;
        let direction = match request.direction {
            HistoryDirection::Undo => ReplayDirection::Undo,
            HistoryDirection::Redo => ReplayDirection::Redo,
        };
        match request.direction {
            HistoryDirection::Undo => {
                for material in unit.members().iter().rev() {
                    draft.stage_replay(material, direction, work)?;
                }
            }
            HistoryDirection::Redo => {
                for material in unit.members().iter() {
                    draft.stage_replay(material, direction, work)?;
                }
            }
        }
        // Replay restores the exact historical normal form. Proposed repairs
        // would change that payload, so they refuse rather than normalize it.
        draft.prepare_changes(work)?;
        let normalization = self
            .profile
            .normalize_scoped(&self.context, &draft.changes()?, &self.cache, work)
            .map_err(TransactionError::Profile)?;
        if !normalization.is_empty() {
            return Err(HistoryError::NotNormal.into());
        }
        draft.validate_structure(work)?;
        let validated = self
            .profile
            .validate_scoped(&self.context, &draft.changes()?, &self.cache, work)
            .map_err(TransactionError::Profile)?;
        let validation = validated.stats;
        let target = match request.direction {
            HistoryDirection::Undo => unit.before(),
            HistoryDirection::Redo => unit.after(),
        };
        let selection = target.selection;
        validate_selection(&draft, selection, work)?;
        let stored_marks = self
            .profile
            .finalize_history_typing(
                &self.context,
                &draft,
                selection,
                target.stored_marks.as_deref(),
                work,
            )
            .map_err(TransactionError::Profile)?;
        if stored_marks != target.stored_marks {
            return Err(HistoryError::TypingMismatch.into());
        }
        let selection_changed = selection != self.selection;
        let stored_marks_changed = stored_marks != self.stored_marks;
        let epoch = if selection_changed || stored_marks_changed {
            self.selection_epoch
                .checked_add(1)
                .ok_or(StateError::CounterExhausted)?
        } else {
            self.selection_epoch
        };
        let revision = self
            .revision
            .checked_add(1)
            .ok_or(StateError::CounterExhausted)?;
        let mapping_bytes = map_bytes(draft.steps())?;
        work.charge_bytes((mapping_bytes as u64).saturating_mul(2))?;
        let map = PositionMap::new(self.revision, revision, draft.steps().to_vec())?;
        let before_copy = draft.prepared_copy_bytes();
        let remaining = work.limits().bytes.saturating_sub(work.usage().bytes);
        draft.tighten_copy_budget(
            before_copy.saturating_add(usize::try_from(remaining).unwrap_or(usize::MAX)),
        );
        let impact = Some(draft.prepare_impact(work)?);
        let patch = draft.prepare_patch()?;
        work.charge_bytes((patch.prepared_copy_bytes() - before_copy) as u64)?;
        if !patch.changed() {
            return Err(TreeError::ReplayMismatch.into());
        }
        let (journal_marks_before, before_bytes) = copy_marks(self.stored_marks.as_deref(), work)?;
        let (journal_marks_after, after_bytes) = copy_marks(stored_marks.as_deref(), work)?;
        let event_marks_after = copy_marks(stored_marks.as_deref(), work)?.0;
        let journal_bytes = patch
            .material_bytes()
            .checked_add(mapping_bytes)
            .and_then(|n| n.checked_add(std::mem::size_of::<JournalEntry>()))
            .and_then(|n| n.checked_add(before_bytes))
            .and_then(|n| n.checked_add(after_bytes))
            .ok_or(TreeError::ResourceLimit)?;
        let initial = self.journal.plan(journal_bytes, limits)?;
        let count = self.journal.summary(self.revision).entries + 1;
        work.charge_units(count as u64)?;
        work.charge_bytes(
            (count * std::mem::size_of::<crate::history::ProjectedMap<'_>>()) as u64,
        )?;
        let projected = self
            .journal
            .projected_maps(patch.material(), journal_bytes, &initial);
        let history_plan =
            self.history
                .plan_replay(request.direction, &projected, limits.history, work)?;
        let journal_plan = self.journal.plan_at_least(
            journal_bytes,
            limits,
            initial.evict + history_plan.chronological_evictions(),
        )?;
        work.charge_bytes(std::mem::size_of_val(patch.changed_ids()) as u64)?;
        let changed_nodes = patch.changed_ids().to_vec();
        let retained_map = Some(map.clone());
        let mut prepared = Prepared {
            patch,
            map,
            retained_map,
            journal_plan: Some(journal_plan),
            history_plan: Some(history_plan),
            journal_bytes,
            selection,
            stored_marks,
            journal_marks_before,
            journal_marks_after,
            event_marks_after,
            epoch,
            revision,
            selection_changed,
            stored_marks_changed,
            changed_nodes,
            normalization_operations: 0,
            validation,
            cache_update: Some(validated.cache),
            impact,
            notification: None,
            input_result: None,
            work: work.usage(),
            trace: work.trace(),
        };
        self.prepare_notification(&mut prepared, work)?;
        Ok(prepared)
    }

    pub fn query_history(&self, request: &HistoryRequest) -> HistoryAvailability<P::Error> {
        let mut work = self.preparation_work(request.limits.work);
        match self.prepare_history(request, self.tree.prepare_preview(), &mut work) {
            Ok(prepared) => HistoryAvailability::Available {
                selection_changed: prepared.selection_changed,
                stored_marks_changed: prepared.stored_marks_changed,
                work: work.usage(),
            },
            Err(error) => HistoryAvailability::Unavailable {
                reason: crate::transaction::error_code(&error, P::history_error_code),
                error,
                work: work.usage(),
            },
        }
    }

    pub fn execute_history(&mut self, request: &HistoryRequest) -> HistoryOutcome<P::Error> {
        let mut work = self.preparation_work(request.limits.work);
        match self.prepare_history(request, self.tree.prepare(), &mut work) {
            Ok(prepared) => match self.publish_prepared(prepared) {
                DispatchOutcome::Changed(event) => HistoryOutcome::Completed(event),
                _ => unreachable!("prepared history replay always changes the document"),
            },
            Err(error) => HistoryOutcome::Refused {
                reason: crate::transaction::error_code(&error, P::history_error_code),
                error,
                work: work.usage(),
            },
        }
    }
}
