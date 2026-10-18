// SPDX-License-Identifier: MIT OR Apache-2.0
//! Full command availability and execution share one publication-free prepare.

use editor_core::commands::{
    CatalogError, CommandCatalog, CommandPresentation, CommandProvider, CommandState, MAX_COMMANDS,
    PlanBuilder, StoredMarksUpdate,
};
use editor_core::document::Mark;
use editor_core::transaction::{WorkMeter, WorkUsage};

use super::dispatch::{PreparedFor, TypingPolicy};
use super::{AccessMode, Session, SessionError, SessionState, StateError};
use crate::history::HistoryHint;
use crate::identity::{NodeId, SessionKey};
use crate::mapping::PositionMap;
use crate::transaction::{DispatchOutcome, Transaction, TransactionError, TransactionLimits};
use crate::tree::{Allocation, TreeDraft};

#[cfg(test)]
#[path = "command_tests.rs"]
mod tests;

/// Captures the typing/selection context as well as document identity. Querying
/// does not grant authority: execute always rechecks these tokens and prepares.
pub struct CommandRequest<I> {
    pub session: SessionKey,
    pub revision: u64,
    pub selection_epoch: u64,
    pub history_epoch: Option<u64>,
    pub history_hint: HistoryHint,
    pub intent: I,
    pub limits: TransactionLimits,
}
impl<I> CommandRequest<I> {
    pub fn new(session: SessionKey, revision: u64, selection_epoch: u64, intent: I) -> Self {
        Self {
            session,
            revision,
            selection_epoch,
            history_epoch: None,
            history_hint: HistoryHint::Isolated,
            intent,
            limits: TransactionLimits::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandEffect {
    Changed,
    Unchanged,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandError<E> {
    Catalog(CatalogError),
    UnknownCommand,
    Transaction(TransactionError<E>),
}
impl<E> From<TransactionError<E>> for CommandError<E> {
    fn from(error: TransactionError<E>) -> Self {
        Self::Transaction(error)
    }
}

type CommandPreparation<P, A> = Result<
    (PreparedFor<P, A>, CommandPresentation),
    CommandError<<P as editor_core::profile::FrozenProfile>::Error>,
>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandAvailability<E> {
    Available {
        presentation: CommandPresentation,
        effect: CommandEffect,
        selection_changed: bool,
        stored_marks_changed: bool,
        work: WorkUsage,
    },
    Unavailable {
        reason: &'static str,
        error: CommandError<E>,
        work: WorkUsage,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[expect(
    clippy::large_enum_variant,
    reason = "Bounded inline outcomes avoid an allocation after publication"
)]
pub enum CommandOutcome<E> {
    Completed {
        presentation: CommandPresentation,
        outcome: DispatchOutcome<E>,
    },
    Refused {
        reason: &'static str,
        error: CommandError<E>,
        work: WorkUsage,
    },
}

fn reason<P: CommandProvider>(error: &CommandError<P::Error>) -> &'static str {
    match error {
        CommandError::Catalog(error) => error.as_str(),
        CommandError::UnknownCommand => "command.unknown",
        CommandError::Transaction(error) => crate::transaction::error_code(error, P::error_code),
    }
}

impl<P: CommandProvider> Session<P> {
    /// Borrow the current frozen provider's IDs after the ordinary read guard.
    /// Consumers meter enumeration/serialization; this view grants no command
    /// availability, and query/execute still validate the catalog and stamps.
    pub fn command_catalog(
        &self,
        key: SessionKey,
    ) -> Result<CommandCatalog<'_>, SessionError<P::Error>> {
        self.guard(key, None)?;
        Ok(self.profile.command_catalog())
    }

    /// Set the explicit future-typing marks (`Some`, including an empty list),
    /// or restore context inheritance (`None`). The final profile hook validates
    /// the marks against the current selection before one atomic publication.
    /// An actual state change advances the selection epoch, not the revision.
    pub fn set_typing_marks(
        &mut self,
        key: SessionKey,
        revision: u64,
        selection_epoch: u64,
        history_epoch: u64,
        marks: Option<Vec<Mark>>,
    ) -> DispatchOutcome<P::Error> {
        let mut transaction = Transaction::new(key, revision, vec![]);
        transaction.selection_epoch = Some(selection_epoch);
        transaction.history_epoch = Some(history_epoch);
        let typing = match marks {
            Some(marks) => StoredMarksUpdate::Set(marks),
            None => StoredMarksUpdate::Inherit,
        };
        let mut work = self.preparation_work(transaction.limits.work);
        let prepared = self.prepare_transaction(
            transaction,
            self.tree.prepare(),
            TypingPolicy::Command(typing),
            &mut work,
            |view, selection, proposed, work| {
                if self.state == SessionState::Open(AccessMode::ReadOnly) {
                    return Err(StateError::ReadOnly.into());
                }
                self.profile
                    .finalize_typing_override(&self.context, view, selection, proposed, work)
                    .map_err(TransactionError::Profile)
            },
        );
        match prepared {
            Ok(prepared) => self.publish_prepared(prepared),
            Err(error) => DispatchOutcome::Refused {
                error,
                map: PositionMap::identity(self.revision),
                work: work.usage(),
            },
        }
    }

    fn prepare_command_request<A: Allocation>(
        &self,
        request: &CommandRequest<P::Intent<NodeId>>,
        draft: TreeDraft<'_, A>,
        work: &mut WorkMeter,
    ) -> CommandPreparation<P, A> {
        self.guard(request.session, Some(request.revision))
            .map_err(|error| CommandError::Transaction(TransactionError::State(error)))?;
        if request.selection_epoch != self.selection_epoch {
            return Err(CommandError::Transaction(TransactionError::State(
                StateError::StaleSelectionEpoch,
            )));
        }
        if request
            .history_epoch
            .is_some_and(|epoch| epoch != self.history.summary().epoch)
        {
            return Err(CommandError::Transaction(TransactionError::State(
                StateError::StaleHistoryEpoch,
            )));
        }
        // Both static and instance catalogs are immutable profile-owned views.
        // Meter the bounded duplicate comparison before inspecting their IDs.
        let catalog = self.profile.command_catalog();
        let count = catalog.len();
        if count > MAX_COMMANDS {
            return Err(CommandError::Catalog(CatalogError::TooManyCommands));
        }
        work.charge_units((count as u64).saturating_mul(count as u64 + 1))
            .map_err(|error| CommandError::Transaction(TransactionError::Limit(error)))?;
        work.charge_bytes(catalog.ids().map(|id| id.len().min(129) as u64).sum())
            .map_err(|error| CommandError::Transaction(TransactionError::Limit(error)))?;
        catalog.validate().map_err(CommandError::Catalog)?;
        let id = P::command_id(&request.intent);
        if !catalog.ids().any(|entry| entry == id) {
            return Err(CommandError::UnknownCommand);
        }
        let mut builder = PlanBuilder::new(work, request.limits.operations);
        let presentation = self
            .profile
            .prepare_command(
                &self.context,
                &self.tree,
                CommandState {
                    selection: self.selection.as_ref(),
                    stored_marks: self.stored_marks.as_deref(),
                },
                &request.intent,
                &mut builder,
            )
            .map_err(|error| CommandError::Transaction(TransactionError::Profile(error)))?;
        let plan = builder.finish();
        let transaction = Transaction {
            session: request.session,
            revision: request.revision,
            selection_epoch: Some(request.selection_epoch),
            history_epoch: request.history_epoch,
            history_hint: request.history_hint,
            operations: plan.operations,
            selection: plan.selection,
            limits: request.limits,
        };
        let prepared = self.prepare_transaction(
            transaction,
            draft,
            TypingPolicy::Command(plan.stored_marks),
            work,
            |view, selection, proposed, work| {
                self.profile
                    .finalize_typing_override(&self.context, view, selection, proposed, work)
                    .map_err(TransactionError::Profile)
            },
        )?;
        Ok((prepared, presentation))
    }

    /// Full actual-payload availability, including final profile validation,
    /// normalization, selection/typing context, journal and counter bounds.
    /// No preview identities, patches, maps or history material escape.
    pub fn query_command(
        &self,
        request: &CommandRequest<P::Intent<NodeId>>,
    ) -> CommandAvailability<P::Error> {
        let mut work = self.preparation_work(request.limits.work);
        match self.prepare_command_request(request, self.tree.prepare_preview(), &mut work) {
            Ok((prepared, presentation)) => CommandAvailability::Available {
                presentation,
                effect: if prepared.changed() {
                    CommandEffect::Changed
                } else {
                    CommandEffect::Unchanged
                },
                selection_changed: prepared.selection_changed,
                stored_marks_changed: prepared.stored_marks_changed,
                work: work.usage(),
            },
            Err(error) => CommandAvailability::Unavailable {
                reason: reason::<P>(&error),
                error,
                work: work.usage(),
            },
        }
    }

    pub fn execute_command(
        &mut self,
        request: &CommandRequest<P::Intent<NodeId>>,
    ) -> CommandOutcome<P::Error> {
        let mut work = self.preparation_work(request.limits.work);
        let prepared = self.prepare_command_request(request, self.tree.prepare(), &mut work);
        match prepared {
            Ok((prepared, presentation)) => CommandOutcome::Completed {
                presentation,
                outcome: self.publish_prepared(prepared),
            },
            Err(error) => CommandOutcome::Refused {
                reason: reason::<P>(&error),
                error,
                work: work.usage(),
            },
        }
    }
}
