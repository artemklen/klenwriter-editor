// SPDX-License-Identifier: MIT OR Apache-2.0
//! The only document publication path: prepare, normalize, validate, publish.

use editor_core::admission::{PreflightBudget, preflight_snapshot};
use editor_core::commands::StoredMarksUpdate;
use editor_core::document::{Attribute, Attributes, Mark, Primitive};
use editor_core::limits::{LimitExceeded, check};
use editor_core::positions::{Position, Selection};
use editor_core::transaction::{
    MarkEdit, Operation, TransactionProfile, ValidationStats, WorkMeter, WorkUsage,
};

use super::{AccessMode, Session, SessionState, StateError};
use crate::history::{HistoryBoundary, HistoryPlan, PreparedHistoryChange};
use crate::identity::NodeId;
use crate::mapping::{MapError, PositionMap, StepMap};
use crate::transaction::{
    CommitEvent, DispatchOutcome, JournalEntry, JournalPlan, NodeRef, SelectionUpdate, Transaction,
    TransactionError,
};
use crate::tree::{
    Allocation, EditOrigin, PreparedTreePatch, RealAllocation, TreeDraft, TreeError,
};

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
fn input_position<E>(
    position: &Position<NodeRef>,
    work: &mut WorkMeter,
) -> Result<(), TransactionError<E>> {
    match position {
        Position::Text { leaf, .. } => reference(leaf, work),
        Position::Child { parent, .. } => reference(parent, work),
        Position::Edge { node, .. } => reference(node, work),
    }
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
        Operation::PatchMarkRange { range, edits } => {
            input_position(&range.anchor, work)?;
            input_position(&range.focus, work)?;
            work.charge_units(edits.len() as u64)?;
            for edit in edits {
                match edit {
                    MarkEdit::Upsert(value) => marks(work, std::slice::from_ref(value))?,
                    MarkEdit::Remove { type_id } => string(work, type_id)?,
                }
            }
        }
        Operation::ReplaceInlineRange { range, inserted } => {
            input_position(&range.anchor, work)?;
            input_position(&range.focus, work)?;
            if let Some(node) = inserted {
                let inline_shape = match node.primitive {
                    Primitive::Text => node.text.is_some(),
                    Primitive::HardBreak | Primitive::InlineAtom => node.text.is_none(),
                    _ => false,
                };
                if !inline_shape || !node.children.is_empty() {
                    return Err(TreeError::InvalidStructure.into());
                }
                string(work, &node.type_id)?;
                attributes(work, &node.attributes, 1)?;
                marks(work, &node.marks)?;
                if let Some(text) = node.text.as_deref() {
                    string(work, text)?;
                }
            }
        }
        Operation::MoveInlineGroup { nodes, parent, .. } => {
            work.charge_units(nodes.len() as u64)?;
            work.charge_bytes(std::mem::size_of_val(nodes.as_slice()) as u64)?;
            reference(parent, work)?;
            for node in nodes {
                reference(node, work)?;
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
fn resolve<E, A: Allocation>(
    reference: NodeRef,
    created: &[Vec<NodeId>],
    draft: &TreeDraft<'_, A>,
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
fn resolve_position<E, A: Allocation>(
    position: Position<NodeRef>,
    created: &[Vec<NodeId>],
    draft: &TreeDraft<'_, A>,
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
fn inline_work<E, A: Allocation>(
    draft: &TreeDraft<'_, A>,
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
fn subtree_work<E, A: Allocation>(
    draft: &TreeDraft<'_, A>,
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
fn apply<E, A: Allocation>(
    draft: &mut TreeDraft<'_, A>,
    operation: &Operation<NodeId>,
    origin: EditOrigin,
    work: &mut WorkMeter,
) -> Result<Vec<NodeId>, TransactionError<E>> {
    work.charge_units(1)?;
    // Closed range methods own their scan/copy accounting on this SAME meter.
    // Their legacy, unmetered primitive entry points reject these variants.
    match operation {
        Operation::PatchMarkRange { range, edits } => {
            draft.patch_mark_range(*range, edits, work)?;
            return Ok(Vec::new());
        }
        Operation::ReplaceInlineRange { range, inserted } => {
            return Ok(draft.replace_inline_range(*range, inserted.as_ref(), work)?);
        }
        Operation::MoveInlineGroup {
            nodes,
            parent,
            before_index,
        } => {
            draft.move_inline_group(nodes, *parent, *before_index, work)?;
            return Ok(Vec::new());
        }
        _ => {}
    }
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
        Operation::PatchMarkRange { .. }
        | Operation::ReplaceInlineRange { .. }
        | Operation::MoveInlineGroup { .. } => unreachable!("metered ranges returned above"),
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
pub(super) fn map_bytes(steps: &[StepMap<NodeId>]) -> Result<usize, TreeError> {
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

/// Raw transactions clear typing overrides on real doc/selection changes;
/// command plans explicitly select an override and validate its FINAL context.
pub(super) enum TypingPolicy {
    Raw,
    Command(StoredMarksUpdate),
}

pub(super) struct Prepared<A: Allocation> {
    pub(super) patch: PreparedTreePatch<A>,
    pub(super) map: PositionMap<NodeId>,
    pub(super) retained_map: Option<PositionMap<NodeId>>,
    pub(super) journal_plan: Option<JournalPlan>,
    pub(super) history_plan: Option<HistoryPlan>,
    pub(super) journal_bytes: usize,
    pub(super) selection: Option<Selection<NodeId>>,
    pub(super) stored_marks: Option<Vec<Mark>>,
    pub(super) journal_marks_before: Option<Vec<Mark>>,
    pub(super) journal_marks_after: Option<Vec<Mark>>,
    pub(super) event_marks_after: Option<Vec<Mark>>,
    pub(super) epoch: u64,
    pub(super) revision: u64,
    pub(super) selection_changed: bool,
    pub(super) stored_marks_changed: bool,
    pub(super) changed_nodes: Vec<NodeId>,
    pub(super) normalization_operations: usize,
    pub(super) validation: ValidationStats,
    pub(super) work: WorkUsage,
}
impl<A: Allocation> Prepared<A> {
    pub(super) fn changed(&self) -> bool {
        self.patch.changed()
    }
}

/// Charge the owned metadata material before cloning it. This logical bound
/// includes container/value overhead and is independent of historic edits.
pub(crate) fn copy_marks<E>(
    source: Option<&[Mark]>,
    work: &mut WorkMeter,
) -> Result<(Option<Vec<Mark>>, usize), TransactionError<E>> {
    let Some(source) = source else {
        return Ok((None, 0));
    };
    let left = work.limits();
    let spent = work.usage();
    let usage = editor_core::admission::preflight_node_fields(
        "",
        None,
        &Attributes::new(),
        source,
        0,
        PreflightBudget {
            payload_bytes: left.bytes.saturating_sub(spent.bytes),
            values: left.units.saturating_sub(spent.units),
            depth: 128,
        },
    )?;
    let bytes = source
        .len()
        .checked_mul(std::mem::size_of::<Mark>())
        .and_then(|n| n.checked_add(usize::try_from(usage.payload_bytes).ok()?))
        .and_then(|n| {
            n.checked_add(
                usize::try_from(usage.values)
                    .ok()?
                    .checked_mul(std::mem::size_of::<Attribute>())?,
            )
        })
        .ok_or(TreeError::ResourceLimit)?;
    work.charge_units(usage.values)?;
    work.charge_bytes(bytes as u64)?;
    Ok((Some(source.to_vec()), bytes))
}
fn map_selection<E>(
    map: &PositionMap<NodeId>,
    selection: Option<Selection<NodeId>>,
) -> Result<Option<Selection<NodeId>>, TransactionError<E>> {
    selection
        .map(|selection| {
            Ok(Selection {
                anchor: map
                    .map(selection.anchor)
                    .position()
                    .ok_or(MapError::UnresolvedRetiredNode)?,
                focus: map
                    .map(selection.focus)
                    .position()
                    .ok_or(MapError::UnresolvedRetiredNode)?,
            })
        })
        .transpose()
}
fn resolve_selection<E, A: Allocation>(
    selection: Option<Selection<NodeRef>>,
    created: &[Vec<NodeId>],
    draft: &TreeDraft<'_, A>,
    work: &mut WorkMeter,
) -> Result<Option<Selection<NodeId>>, TransactionError<E>> {
    selection
        .map(|selection| {
            Ok(Selection {
                anchor: resolve_position(selection.anchor, created, draft, work)?,
                focus: resolve_position(selection.focus, created, draft, work)?,
            })
        })
        .transpose()
}

impl<P: TransactionProfile> Session<P> {
    pub fn dispatch(&mut self, transaction: Transaction) -> DispatchOutcome<P::Error> {
        let mut work = WorkMeter::new(transaction.limits.work);
        let prepared = self.prepare_transaction(
            transaction,
            self.tree.prepare(),
            TypingPolicy::Raw,
            &mut work,
            |_, _, proposed, work| copy_marks(proposed, work).map(|(marks, _)| marks),
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

    /// One publication-free preparer for raw dispatch, full capability preview
    /// and command execution. Preview's mode makes its patch unpublishable.
    pub(super) fn prepare_transaction<A: Allocation>(
        &self,
        transaction: Transaction,
        mut draft: TreeDraft<'_, A>,
        typing: TypingPolicy,
        work: &mut WorkMeter,
        finalize_marks: impl FnOnce(
            &TreeDraft<'_, A>,
            Option<Selection<NodeId>>,
            Option<&[Mark]>,
            &mut WorkMeter,
        ) -> Result<Option<Vec<Mark>>, TransactionError<P::Error>>,
    ) -> Result<Prepared<A>, TransactionError<P::Error>> {
        self.guard(transaction.session, Some(transaction.revision))?;
        if transaction
            .selection_epoch
            .is_some_and(|epoch| epoch != self.selection_epoch)
        {
            return Err(StateError::StaleSelectionEpoch.into());
        }
        if transaction
            .history_epoch
            .is_some_and(|epoch| epoch != self.history.summary().epoch)
        {
            return Err(StateError::StaleHistoryEpoch.into());
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
        for operation in &transaction.operations {
            payload(operation, work)?;
        }
        work.charge_bytes(
            (transaction.operations.len() as u64)
                .saturating_mul(std::mem::size_of::<Vec<NodeId>>() as u64),
        )?;
        let mut created = Vec::with_capacity(transaction.operations.len());
        let has_user_operations = !transaction.operations.is_empty();
        let simple = transaction.operations.len() == 1;
        let hint = transaction.history_hint;
        let mut grouping = None;
        for operation in transaction.operations {
            let operation = operation.try_map_ids(|id| resolve(id, &created, &draft))?;
            if simple {
                grouping = crate::grouping::prepare(
                    &draft,
                    &operation,
                    hint,
                    self.selection,
                    self.stored_marks.as_deref(),
                    work,
                )?;
            }
            created.push(apply(&mut draft, &operation, EditOrigin::User, work)?);
        }
        let (selection_after_user, selection_intent) = match transaction.selection {
            SelectionUpdate::MapFromUserResult(selection) => {
                let resolved = resolve_selection(selection, &created, &draft, work)?;
                // Normalization may retire a created leaf and map every address
                // on it to a parent gap. Validate its user-frame coordinates
                // first, so that mapping cannot launder an invalid offset/kind.
                validate_selection(&draft, resolved, work)?;
                (Some(resolved), SelectionUpdate::MapCurrent)
            }
            other => (None, other),
        };
        let normalization_start = draft.steps().len();
        let mut normalization_operations = 0usize;
        let mut validation = ValidationStats::default();
        if has_user_operations {
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
                    if grouping
                        .as_ref()
                        .is_some_and(|proof| !proof.permits_normalization(&draft, &operation))
                    {
                        grouping = None;
                    }
                    apply(&mut draft, &operation, EditOrigin::Normalization, work)?;
                    normalization_operations += 1;
                }
            }
            draft.validate_structure(work)?;
            validation = self
                .profile
                .validate_candidate(&self.context, &draft, work)
                .map_err(TransactionError::Profile)?;
        }
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
        let selection = if let Some(selection) = selection_after_user {
            let suffix = &draft.steps()[normalization_start..];
            work.charge_bytes(map_bytes(suffix)? as u64)?;
            // These are private frame coordinates, not a document revision.
            let suffix_map = if suffix.is_empty() {
                PositionMap::identity(0)
            } else {
                PositionMap::new(0, 1, suffix.to_vec())?
            };
            map_selection(&suffix_map, selection)?
        } else {
            match selection_intent {
                SelectionUpdate::MapCurrent => map_selection(&map, self.selection)?,
                SelectionUpdate::Set(selection) => {
                    resolve_selection(selection, &created, &draft, work)?
                }
                SelectionUpdate::MapFromUserResult(_) => unreachable!("resolved in the user frame"),
            }
        };
        validate_selection(&draft, selection, work)?;
        let selection_changed = selection != self.selection;
        let proposed = match &typing {
            TypingPolicy::Raw if changed || selection_changed => None,
            TypingPolicy::Raw | TypingPolicy::Command(StoredMarksUpdate::Keep) => {
                self.stored_marks.as_deref()
            }
            TypingPolicy::Command(StoredMarksUpdate::Inherit) => None,
            TypingPolicy::Command(StoredMarksUpdate::Set(marks)) => Some(marks.as_slice()),
        };
        let stored_marks = finalize_marks(&draft, selection, proposed, work)?;
        let stored_marks_changed = stored_marks != self.stored_marks;
        let footprint = grouping
            .map(|proof| proof.finish(&draft, selection, stored_marks.as_deref(), work))
            .transpose()?
            .flatten();
        if self.state == SessionState::Open(AccessMode::ReadOnly) && stored_marks_changed {
            return Err(StateError::ReadOnly.into());
        }
        let epoch = if selection_changed || stored_marks_changed {
            self.selection_epoch
                .checked_add(1)
                .ok_or(StateError::CounterExhausted)?
        } else {
            self.selection_epoch
        };
        let before_copy = draft.prepared_copy_bytes();
        let remaining = work.limits().bytes.saturating_sub(work.usage().bytes);
        draft.tighten_copy_budget(
            before_copy.saturating_add(usize::try_from(remaining).unwrap_or(usize::MAX)),
        );
        let patch = draft.prepare_patch()?;
        work.charge_bytes((patch.prepared_copy_bytes() - before_copy) as u64)?;
        debug_assert_eq!(changed, patch.changed());
        debug_assert_eq!(map.steps(), if changed { patch.steps() } else { &[] });
        let mut journal_plan = None;
        let mut history_plan = None;
        let mut journal_bytes = 0;
        let mut journal_marks_before = None;
        let mut journal_marks_after = None;
        let mut event_marks_after = None;
        let mut changed_nodes = Vec::new();
        let mut retained_map = None;
        if changed {
            let (before, before_bytes) = copy_marks(self.stored_marks.as_deref(), work)?;
            let (after, after_bytes) = copy_marks(stored_marks.as_deref(), work)?;
            event_marks_after = copy_marks(stored_marks.as_deref(), work)?.0;
            journal_marks_before = before;
            journal_marks_after = after;
            journal_bytes = patch
                .material_bytes()
                .checked_add(mapping_bytes)
                .and_then(|n| n.checked_add(std::mem::size_of::<JournalEntry>()))
                .and_then(|n| n.checked_add(before_bytes))
                .and_then(|n| n.checked_add(after_bytes))
                .ok_or(TreeError::ResourceLimit)?;
            let initial = self.journal.plan(journal_bytes, limits)?;
            work.charge_units((self.journal.summary(self.revision).entries + 1) as u64)?;
            work.charge_bytes(
                ((self.journal.summary(self.revision).entries + 1)
                    * std::mem::size_of::<crate::history::ProjectedMap<'_>>())
                    as u64,
            )?;
            let projected = self
                .journal
                .projected_maps(patch.material(), journal_bytes, &initial);
            let change = PreparedHistoryChange {
                material: std::sync::Arc::clone(patch.material()),
                before: HistoryBoundary {
                    selection: self.selection,
                    stored_marks: copy_marks(self.stored_marks.as_deref(), work)?.0,
                },
                after: HistoryBoundary {
                    selection,
                    stored_marks: copy_marks(stored_marks.as_deref(), work)?.0,
                },
                footprint,
            };
            let plan = self
                .history
                .plan_record(change, hint, &projected, limits.history, work)?;
            journal_plan = Some(self.journal.plan_at_least(
                journal_bytes,
                limits,
                initial.evict + plan.chronological_evictions(),
            )?);
            history_plan = Some(plan);
            work.charge_bytes(std::mem::size_of_val(patch.changed_ids()) as u64)?;
            changed_nodes = patch.changed_ids().to_vec();
            retained_map = Some(map.clone());
        } else if selection_changed || stored_marks_changed {
            history_plan = self.history.plan_barrier(work)?;
        }
        Ok(Prepared {
            patch,
            map,
            retained_map,
            journal_plan,
            history_plan,
            journal_bytes,
            selection,
            stored_marks,
            journal_marks_before,
            journal_marks_after,
            event_marks_after,
            epoch,
            revision: next_revision,
            selection_changed,
            stored_marks_changed,
            changed_nodes,
            normalization_operations,
            validation,
            work: work.usage(),
        })
    }

    /// Only a real prepared patch can reach this publication method.
    pub(super) fn publish_prepared(
        &mut self,
        prepared: Prepared<RealAllocation>,
    ) -> DispatchOutcome<P::Error> {
        let changed = prepared.changed();
        if !changed {
            self.selection = prepared.selection;
            self.stored_marks = prepared.stored_marks;
            self.selection_epoch = prepared.epoch;
            if let Some(plan) = prepared.history_plan {
                self.history.publish(plan);
            }
            return DispatchOutcome::Unchanged {
                revision: self.revision,
                selection_epoch: self.selection_epoch,
                selection_changed: prepared.selection_changed,
                stored_marks_changed: prepared.stored_marks_changed,
                map: prepared.map,
                work: prepared.work,
            };
        }
        let before = self.selection;
        let marks_before = std::mem::replace(&mut self.stored_marks, prepared.stored_marks);
        let material = self.tree.publish(prepared.patch);
        self.journal.publish(
            JournalEntry {
                material,
                map: prepared.retained_map.expect("prepared retained map"),
                before,
                after: prepared.selection,
                marks_before: prepared.journal_marks_before,
                marks_after: prepared.journal_marks_after,
                bytes: prepared.journal_bytes,
            },
            prepared.journal_plan.expect("prepared retention plan"),
        );
        self.history
            .publish(prepared.history_plan.expect("prepared history record"));
        self.revision = prepared.revision;
        self.selection = prepared.selection;
        self.selection_epoch = prepared.epoch;
        self.dirty = true;
        DispatchOutcome::Changed(CommitEvent {
            revision: self.revision,
            selection_epoch: self.selection_epoch,
            selection_before: before,
            selection_after: self.selection,
            stored_marks_before: marks_before,
            stored_marks_after: prepared.event_marks_after,
            map: prepared.map,
            changed_nodes: prepared.changed_nodes,
            journal: self.journal.summary(self.revision),
            normalization_operations: prepared.normalization_operations,
            validation: prepared.validation,
            work: prepared.work,
            dirty: self.dirty,
        })
    }
}

pub(super) fn validate_selection<E, A: Allocation>(
    draft: &TreeDraft<'_, A>,
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
