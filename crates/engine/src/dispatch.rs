// SPDX-License-Identifier: MIT OR Apache-2.0
//! The only document publication path: prepare, normalize, validate, publish.

use editor_core::admission::{PreflightBudget, preflight_snapshot};
use editor_core::document::{Attribute, Attributes, Mark};
use editor_core::limits::{LimitExceeded, check};
use editor_core::positions::{Position, Selection};
use editor_core::transaction::{Operation, TransactionProfile, WorkMeter};

use super::{AccessMode, Session, SessionState, StateError};
use crate::identity::NodeId;
use crate::mapping::{MapError, PositionMap, StepMap};
use crate::transaction::{
    CommitEvent, DispatchOutcome, JournalEntry, NodeRef, SelectionUpdate, Transaction,
    TransactionError,
};
use crate::tree::{EditOrigin, TreeDraft, TreeError};

fn string(work: &mut WorkMeter, value: &str) -> Result<(), LimitExceeded> {
    work.charge_bytes(value.len() as u64)
}
fn attributes(work: &mut WorkMeter, values: &Attributes, depth: u64) -> Result<(), LimitExceeded> {
    check("transaction_metadata_depth", 128, depth)?;
    work.charge_units(values.len() as u64)?;
    for (key, value) in values {
        string(work, key)?;
        attribute(work, value, depth + 1)?;
    }
    Ok(())
}
fn attribute(work: &mut WorkMeter, value: &Attribute, depth: u64) -> Result<(), LimitExceeded> {
    check("transaction_metadata_depth", 128, depth)?;
    work.charge_units(1)?;
    match value {
        Attribute::Null | Attribute::Boolean(_) => work.charge_bytes(5),
        Attribute::String(value) => string(work, value),
        Attribute::Number(value) => {
            // Count streamed spelling, also safe if arbitrary_precision is
            // enabled by a downstream dependency. No temporary number string.
            struct Sink<'a> {
                work: &'a mut WorkMeter,
                error: Option<LimitExceeded>,
            }
            impl std::fmt::Write for Sink<'_> {
                fn write_str(&mut self, value: &str) -> std::fmt::Result {
                    self.work.charge_bytes(value.len() as u64).map_err(|error| {
                        self.error = Some(error);
                        std::fmt::Error
                    })
                }
            }
            use std::fmt::Write;
            let mut sink = Sink { work, error: None };
            write!(sink, "{value}").map_err(|_| sink.error.expect("counting sink refusal"))
        }
        Attribute::List(values) => {
            work.charge_units(values.len() as u64)?;
            for value in values {
                attribute(work, value, depth + 1)?;
            }
            Ok(())
        }
        Attribute::Object(values) => attributes(work, values, depth + 1),
    }
}
fn marks(work: &mut WorkMeter, values: &[Mark]) -> Result<(), LimitExceeded> {
    work.charge_units(values.len() as u64)?;
    for mark in values {
        string(work, &mark.type_id)?;
        attributes(work, &mark.attributes, 1)?;
    }
    Ok(())
}
fn reference<E>(value: &NodeRef, work: &mut WorkMeter) -> Result<(), TransactionError<E>> {
    if let NodeRef::Created { path, .. } = value {
        if path.is_empty() || path.len() > 128 {
            return Err(TransactionError::InvalidLocalReference);
        }
        work.charge_units(path.len() as u64)?;
    }
    Ok(())
}
fn payload<E>(
    operation: &Operation<NodeRef>,
    work: &mut WorkMeter,
) -> Result<(), TransactionError<E>> {
    work.charge_units(1)?;
    match operation {
        Operation::ReplaceText { leaf, inserted, .. } => {
            reference(leaf, work)?;
            string(work, inserted)?;
        }
        Operation::SplitText { leaf, .. } | Operation::Remove { node: leaf } => {
            reference(leaf, work)?
        }
        Operation::JoinText { left, right } => {
            reference(left, work)?;
            reference(right, work)?;
        }
        Operation::SetAttribute { node, key, value } => {
            reference(node, work)?;
            string(work, key)?;
            if let Some(value) = value {
                attribute(work, value, 1)?;
            }
        }
        Operation::SetMarks {
            leaf,
            marks: values,
        } => {
            reference(leaf, work)?;
            marks(work, values)?;
        }
        Operation::Transform { node, type_id, .. } => {
            reference(node, work)?;
            string(work, type_id)?;
        }
        Operation::InsertFragment {
            parent, fragment, ..
        } => {
            reference(parent, work)?;
            let limits = work.limits();
            let used = work.usage();
            let measured = preflight_snapshot(
                fragment,
                PreflightBudget {
                    payload_bytes: limits.bytes - used.bytes,
                    values: limits.units - used.units,
                    depth: 128,
                },
            )?;
            work.charge_units(measured.usage.values)?;
            work.charge_bytes(measured.usage.payload_bytes)?;
        }
        Operation::Move { node, parent, .. } | Operation::Duplicate { node, parent, .. } => {
            reference(node, work)?;
            reference(parent, work)?;
        }
    }
    Ok(())
}
fn resolve<E>(
    reference: NodeRef,
    created: &[Vec<NodeId>],
    draft: &TreeDraft<'_>,
) -> Result<NodeId, TransactionError<E>> {
    match reference {
        NodeRef::Existing(id) => Ok(id),
        NodeRef::Created { operation, path } => {
            let (first, rest) = path
                .split_first()
                .ok_or(TransactionError::InvalidLocalReference)?;
            let mut id = *created
                .get(operation)
                .and_then(|roots| roots.get(*first))
                .ok_or(TransactionError::InvalidLocalReference)?;
            for index in rest {
                id = *draft
                    .node(id)?
                    .children()
                    .get(*index)
                    .ok_or(TransactionError::InvalidLocalReference)?;
            }
            draft.node(id)?;
            Ok(id)
        }
    }
}
fn resolve_position<E>(
    position: Position<NodeRef>,
    created: &[Vec<NodeId>],
    draft: &TreeDraft<'_>,
    work: &mut WorkMeter,
) -> Result<Position<NodeId>, TransactionError<E>> {
    Ok(match position {
        Position::Text {
            leaf,
            utf16,
            affinity,
        } => {
            reference(&leaf, work)?;
            Position::Text {
                leaf: resolve(leaf, created, draft)?,
                utf16,
                affinity,
            }
        }
        Position::Child {
            parent,
            index,
            affinity,
        } => {
            reference(&parent, work)?;
            Position::Child {
                parent: resolve(parent, created, draft)?,
                index,
                affinity,
            }
        }
        Position::Edge { node, side } => {
            reference(&node, work)?;
            Position::Edge {
                node: resolve(node, created, draft)?,
                side,
            }
        }
    })
}
fn inline_work<E>(
    draft: &TreeDraft<'_>,
    parent: NodeId,
    work: &mut WorkMeter,
) -> Result<(), TransactionError<E>> {
    let node = draft.node(parent)?;
    work.charge_units(node.children().len() as u64 + 1)?;
    for id in node.children() {
        if let Some(text) = draft.node(*id)?.text() {
            work.charge_bytes((text.len() as u64).saturating_mul(3))?;
        }
    }
    Ok(())
}
fn subtree_work<E>(
    draft: &TreeDraft<'_>,
    id: NodeId,
    depth: usize,
    work: &mut WorkMeter,
) -> Result<(), TransactionError<E>> {
    if depth > 128 {
        return Err(TreeError::ResourceLimit.into());
    }
    work.charge_units(1)?;
    let node = draft.node(id)?;
    work.charge_units(node.children().len() as u64)?;
    for child in node.children() {
        subtree_work(draft, *child, depth + 1, work)?;
    }
    Ok(())
}
fn apply<E>(
    draft: &mut TreeDraft<'_>,
    operation: &Operation<NodeId>,
    origin: EditOrigin,
    work: &mut WorkMeter,
) -> Result<Vec<NodeId>, TransactionError<E>> {
    work.charge_units(1)?;
    match operation {
        Operation::ReplaceText { leaf, .. }
        | Operation::SplitText { leaf, .. }
        | Operation::SetMarks { leaf, .. } => {
            if let Some(parent) = draft.node(*leaf)?.parent() {
                inline_work(draft, parent, work)?;
            }
        }
        Operation::JoinText { left, right } => {
            for id in [left, right] {
                if let Some(parent) = draft.node(*id)?.parent() {
                    inline_work(draft, parent, work)?;
                }
            }
        }
        Operation::InsertFragment { parent, .. } => inline_work(draft, *parent, work)?,
        Operation::Move { node, parent, .. } | Operation::Duplicate { node, parent, .. } => {
            inline_work(draft, *parent, work)?;
            subtree_work(draft, *node, 1, work)?;
        }
        Operation::Remove { node } => {
            if let Some(parent) = draft.node(*node)?.parent() {
                inline_work(draft, parent, work)?;
            }
            subtree_work(draft, *node, 1, work)?;
        }
        Operation::SetAttribute { .. } | Operation::Transform { .. } => {}
    }
    let before = draft.prepared_copy_bytes();
    let remaining = work.limits().bytes - work.usage().bytes;
    draft.tighten_copy_budget(
        before.saturating_add(usize::try_from(remaining).unwrap_or(usize::MAX)),
    );
    let result = draft.apply_operation(operation, origin)?;
    work.charge_bytes((draft.prepared_copy_bytes() - before) as u64)?;
    Ok(result)
}
fn map_bytes(steps: &[StepMap<NodeId>]) -> Result<usize, TreeError> {
    let mut bytes = steps
        .len()
        .checked_mul(std::mem::size_of::<StepMap<NodeId>>())
        .ok_or(TreeError::ResourceLimit)?;
    for step in steps {
        if let StepMap::Retire { nodes, .. } | StepMap::Revive { nodes } = step {
            bytes = bytes
                .checked_add(
                    nodes
                        .len()
                        .checked_mul(std::mem::size_of::<NodeId>())
                        .ok_or(TreeError::ResourceLimit)?,
                )
                .ok_or(TreeError::ResourceLimit)?;
        }
    }
    Ok(bytes)
}

impl<P: TransactionProfile> Session<P> {
    pub fn dispatch(&mut self, transaction: Transaction) -> DispatchOutcome<P::Error> {
        let mut work = WorkMeter::new(transaction.limits.work);
        match self.dispatch_inner(transaction, &mut work) {
            Ok(result) => result,
            Err(error) => DispatchOutcome::Refused {
                error,
                map: PositionMap::identity(self.revision),
                work: work.usage(),
            },
        }
    }

    fn dispatch_inner(
        &mut self,
        transaction: Transaction,
        work: &mut WorkMeter,
    ) -> Result<DispatchOutcome<P::Error>, TransactionError<P::Error>> {
        self.guard(transaction.session, Some(transaction.revision))?;
        if transaction
            .selection_epoch
            .is_some_and(|epoch| epoch != self.selection_epoch)
        {
            return Err(StateError::StaleSelectionEpoch.into());
        }
        if self.state == SessionState::Open(AccessMode::ReadOnly)
            && !transaction.operations.is_empty()
        {
            return Err(StateError::ReadOnly.into());
        }
        let limits = transaction.limits.effective();
        check(
            "transaction_operations",
            limits.operations as u64,
            transaction.operations.len() as u64,
        )?;
        work.charge_units(transaction.operations.len() as u64)?;
        // Borrow every untrusted payload before copying any of it into a draft.
        for operation in &transaction.operations {
            payload(operation, work)?;
        }
        let mut draft = self.tree.prepare();
        if transaction.operations.is_empty() {
            // An admitted, unchanged document needs no domain/identity lookup
            // just to select it. This path also serves read-only sessions.
            let selection = match transaction.selection {
                SelectionUpdate::MapCurrent => self.selection,
                SelectionUpdate::Set(None) => None,
                SelectionUpdate::Set(Some(selection)) => Some(Selection {
                    anchor: resolve_position(selection.anchor, &[], &draft, work)?,
                    focus: resolve_position(selection.focus, &[], &draft, work)?,
                }),
            };
            validate_selection(&draft, selection, work)?;
            let selection_changed = selection != self.selection;
            let selection_epoch = if selection_changed {
                self.selection_epoch
                    .checked_add(1)
                    .ok_or(StateError::CounterExhausted)?
            } else {
                self.selection_epoch
            };
            self.selection = selection;
            self.selection_epoch = selection_epoch;
            return Ok(DispatchOutcome::Unchanged {
                revision: self.revision,
                selection_epoch,
                selection_changed,
                map: PositionMap::identity(self.revision),
                work: work.usage(),
            });
        }
        let mut created = Vec::with_capacity(transaction.operations.len());
        for operation in transaction.operations {
            let operation = operation.try_map_ids(|id| resolve(id, &created, &draft))?;
            created.push(apply(&mut draft, &operation, EditOrigin::User, work)?);
        }
        let mut normalization_operations = 0usize;
        let mut passes = 0usize;
        loop {
            let operations = self
                .profile
                .normalize_candidate(&self.context, &draft, work)
                .map_err(TransactionError::Profile)?;
            if operations.is_empty() {
                break;
            }
            if passes >= limits.normalization_passes {
                return Err(TransactionError::NormalizationLimit);
            }
            passes += 1;
            check(
                "normalization_operations",
                4096,
                (normalization_operations as u64).saturating_add(operations.len() as u64),
            )?;
            for operation in operations {
                apply(&mut draft, &operation, EditOrigin::Normalization, work)?;
                normalization_operations += 1;
            }
        }
        draft.validate_structure(work)?;
        let validation = self
            .profile
            .validate_candidate(&self.context, &draft, work)
            .map_err(TransactionError::Profile)?;
        // Net equality is borrowed and sparse. A no-op never increments a
        // counter or exposes the speculative maps used while preparing it.
        let changed = draft.has_changes();
        let next_revision = if changed {
            self.revision
                .checked_add(1)
                .ok_or(StateError::CounterExhausted)?
        } else {
            self.revision
        };
        let mapping_bytes = if changed {
            map_bytes(draft.steps())?
        } else {
            0
        };
        work.charge_bytes((mapping_bytes as u64).saturating_mul(2))?;
        let map = if changed {
            PositionMap::new(self.revision, next_revision, draft.steps().to_vec())?
        } else {
            PositionMap::identity(self.revision)
        };
        let requested_selection = match transaction.selection {
            SelectionUpdate::MapCurrent => match self.selection {
                Some(selection) => Some(Selection {
                    anchor: map
                        .map(selection.anchor)
                        .position()
                        .ok_or(MapError::UnresolvedRetiredNode)?,
                    focus: map
                        .map(selection.focus)
                        .position()
                        .ok_or(MapError::UnresolvedRetiredNode)?,
                }),
                None => None,
            },
            SelectionUpdate::Set(selection) => match selection {
                Some(selection) => Some(Selection {
                    anchor: resolve_position(selection.anchor, &created, &draft, work)?,
                    focus: resolve_position(selection.focus, &created, &draft, work)?,
                }),
                None => None,
            },
        };
        validate_selection(&draft, requested_selection, work)?;
        let before_copy = draft.prepared_copy_bytes();
        let remaining = work.limits().bytes - work.usage().bytes;
        draft.tighten_copy_budget(
            before_copy.saturating_add(usize::try_from(remaining).unwrap_or(usize::MAX)),
        );
        let patch = draft.prepare_patch()?;
        work.charge_bytes((patch.prepared_copy_bytes() - before_copy) as u64)?;
        debug_assert_eq!(changed, patch.changed());
        debug_assert_eq!(map.steps(), patch.steps());
        let selection = requested_selection;
        let selection_changed = selection != self.selection;
        let selection_epoch = if selection_changed {
            self.selection_epoch
                .checked_add(1)
                .ok_or(StateError::CounterExhausted)?
        } else {
            self.selection_epoch
        };
        if !changed {
            self.selection = selection;
            self.selection_epoch = selection_epoch;
            return Ok(DispatchOutcome::Unchanged {
                revision: self.revision,
                selection_epoch,
                selection_changed,
                map: PositionMap::identity(self.revision),
                work: work.usage(),
            });
        }
        if self.state == SessionState::Open(AccessMode::ReadOnly) {
            return Err(StateError::ReadOnly.into());
        }
        let bytes = patch
            .material_bytes()
            .checked_add(mapping_bytes)
            .and_then(|value| value.checked_add(std::mem::size_of::<JournalEntry>()))
            .ok_or(TreeError::ResourceLimit)?;
        let journal_plan = self.journal.plan(bytes, limits)?;
        work.charge_bytes(std::mem::size_of_val(patch.changed_ids()) as u64)?;
        let changed_nodes = patch.changed_ids().to_vec();
        let retained_map = map.clone();
        let before = self.selection;
        // Commit boundary: all expected errors and all expensive preparation
        // have completed. An allocator panic/trap is fatal, never Refused.
        let material = self.tree.publish(patch);
        self.journal.publish(
            JournalEntry {
                material,
                map: retained_map,
                before,
                after: selection,
                bytes,
            },
            journal_plan,
        );
        self.revision = next_revision;
        self.selection = selection;
        self.selection_epoch = selection_epoch;
        self.dirty = true;
        Ok(DispatchOutcome::Changed(CommitEvent {
            revision: self.revision,
            selection_epoch,
            selection_before: before,
            selection_after: selection,
            map,
            changed_nodes,
            journal: self.journal.summary(self.revision),
            normalization_operations,
            validation,
            work: work.usage(),
            dirty: self.dirty,
        }))
    }
}

fn validate_selection<E>(
    draft: &TreeDraft<'_>,
    selection: Option<Selection<NodeId>>,
    work: &mut WorkMeter,
) -> Result<(), TransactionError<E>> {
    if let Some(selection) = selection {
        // Scalar read positions may lie inside an EGC; this grants no mutation
        // privilege to future user operations.
        for position in [selection.anchor, selection.focus] {
            if let Position::Text { leaf, .. } = position {
                work.charge_bytes(draft.node(leaf)?.text().map_or(0, |text| text.len()) as u64)?;
            }
            draft.validate_position(position)?;
        }
    }
    Ok(())
}
