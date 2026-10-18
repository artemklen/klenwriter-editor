// SPDX-License-Identifier: MIT OR Apache-2.0
//! Full command availability and execution share one publication-free prepare.

use editor_core::commands::{
    CatalogError, CommandPresentation, CommandProvider, CommandState, MAX_COMMANDS, PlanBuilder,
    validate_catalog,
};
use editor_core::transaction::{WorkMeter, WorkUsage};

use super::dispatch::{Prepared, TypingPolicy};
use super::{Session, StateError};
use crate::history::HistoryHint;
use crate::identity::{NodeId, SessionKey};
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
    fn prepare_command_request<A: Allocation>(
        &self,
        request: &CommandRequest<P::Intent<NodeId>>,
        draft: TreeDraft<'_, A>,
        work: &mut WorkMeter,
    ) -> Result<(Prepared<A>, CommandPresentation), CommandError<P::Error>> {
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
        // Catalog is a compiled associated constant. Meter the bounded duplicate
        // comparison before inspecting it; there is no mutable registry/cache.
        let count = P::COMMANDS.len();
        if count > MAX_COMMANDS {
            return Err(CommandError::Catalog(CatalogError::TooManyCommands));
        }
        work.charge_units((count as u64).saturating_mul(count as u64 + 1))
            .map_err(|error| CommandError::Transaction(TransactionError::Limit(error)))?;
        work.charge_bytes(P::COMMANDS.iter().map(|d| d.id.len().min(129) as u64).sum())
            .map_err(|error| CommandError::Transaction(TransactionError::Limit(error)))?;
        validate_catalog(P::COMMANDS).map_err(CommandError::Catalog)?;
        let id = P::command_id(&request.intent);
        if !P::COMMANDS.iter().any(|entry| entry.id == id) {
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
        let mut work = WorkMeter::new(request.limits.work);
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
        let mut work = WorkMeter::new(request.limits.work);
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
