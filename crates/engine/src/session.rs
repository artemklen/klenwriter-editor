// SPDX-License-Identifier: MIT OR Apache-2.0
//! Admission, immutable profile context, lifecycle and guarded read/preparation.

use editor_core::document::Mark;
use editor_core::positions::{Position, Selection};
use editor_core::profile::{AdmissionMode, BindingError, FrozenProfile, ProfileBinding};
use editor_core::transaction::{WorkLimits, WorkMeter, WorkPhase, WorkTrace};

use crate::events::{
    EventBatch, EventCursor, EventError, EventKind, EventLimits, EventOutbox, EventPayload,
    EventReadLimits, EventStatus, ProtectedCursor, ProtectionStart, SessionStamp, StateChange,
    TerminalKind,
};
use crate::history::{HistoryError, HistoryStore, HistorySummary};
use crate::identity::{NodeId, SessionKey};
use crate::mapping::{MapError, MapResult};
use crate::snapshot::{
    MAX_SNAPSHOT_BYTES, SaveAcknowledgement, SavedBaseline, Snapshot, SnapshotError,
};
use crate::transaction::{CommitJournal, JournalEntrySummary, JournalSummary};
use crate::tree::{AddressTree, TreeDraft, TreeError, TreeNode};

#[path = "commands.rs"]
pub mod commands;
#[path = "dispatch.rs"]
pub(crate) mod dispatch;
#[path = "history_dispatch.rs"]
pub mod history_dispatch;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccessMode {
    Editable,
    ReadOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionState {
    Open(AccessMode),
    Closed,
    Poisoned,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StateError {
    StaleSession,
    StaleRevision,
    StaleSelectionEpoch,
    StaleHistoryEpoch,
    Closed,
    Poisoned,
    ReadOnly,
    CounterExhausted,
}

/// A shallow borrowed render read. Children remain IDs; no persisted document
/// or descendant payload is constructed merely to inspect this block.
#[derive(Debug)]
pub struct NodeRead<'a> {
    pub stamp: SessionStamp,
    pub changed_revision: u64,
    pub stats: NodeStats,
    pub node: &'a TreeNode,
}

/// Generic exact subtree totals; no profile-specific words or grapheme sum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NodeStats {
    pub authored_nodes: usize,
    pub text_utf8: usize,
    pub text_utf16: usize,
    pub height: usize,
}

struct StateProjection<'a> {
    stamp: SessionStamp,
    selection: Option<Selection<NodeId>>,
    stored_marks: Option<&'a [Mark]>,
    history: HistorySummary,
    dirty: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionError<E> {
    Binding(BindingError),
    Profile(E),
    State(StateError),
    Tree(TreeError),
    History(HistoryError),
    Events(EventError),
    Snapshot(SnapshotError),
}

impl<E> From<EventError> for SessionError<E> {
    fn from(error: EventError) -> Self {
        Self::Events(error)
    }
}

impl<E> From<SnapshotError> for SessionError<E> {
    fn from(error: SnapshotError) -> Self {
        Self::Snapshot(error)
    }
}

impl<E> From<StateError> for SessionError<E> {
    fn from(error: StateError) -> Self {
        Self::State(error)
    }
}

impl<E> From<TreeError> for SessionError<E> {
    fn from(error: TreeError) -> Self {
        Self::Tree(error)
    }
}

/// Fields are private; neither drafts nor unchecked Documents can publish state.
/// Only validated dispatch owns document publication; drafts remain unadmitted.
pub struct Session<P: FrozenProfile> {
    profile: P,
    binding: ProfileBinding,
    context: P::Context,
    key: SessionKey,
    tree: AddressTree,
    state: SessionState,
    revision: u64,
    selection: Option<Selection<NodeId>>,
    stored_marks: Option<Vec<Mark>>,
    selection_epoch: u64,
    journal: CommitJournal,
    history: HistoryStore,
    dirty: bool,
    cache: P::Cache<NodeId>,
    events: EventOutbox,
    event_limits: EventLimits,
    baseline: SavedBaseline,
}

impl<P: FrozenProfile> Session<P> {
    pub fn open(
        profile: P,
        requested: &ProfileBinding,
        input: &[u8],
        mode: AdmissionMode,
        access: AccessMode,
    ) -> Result<Self, SessionError<P::Error>> {
        Self::open_with_event_limits(
            profile,
            requested,
            input,
            mode,
            access,
            EventLimits::default(),
        )
    }

    pub fn open_with_event_limits(
        profile: P,
        requested: &ProfileBinding,
        input: &[u8],
        mode: AdmissionMode,
        access: AccessMode,
        event_limits: EventLimits,
    ) -> Result<Self, SessionError<P::Error>> {
        profile
            .binding()
            .ensure_matches(requested)
            .map_err(SessionError::Binding)?;
        let admitted = profile
            .admit_bytes(requested, input, mode)
            .map_err(SessionError::Profile)?;
        let context = profile.context(&admitted);
        let key = SessionKey::allocate().ok_or(StateError::CounterExhausted)?;
        let tree = AddressTree::from_document(key, profile.to_document(&admitted))?;
        let baseline = SavedBaseline::admitted(profile.canonical(&admitted))?;
        let cache = profile
            .seed_cache(&admitted, &tree, &mut WorkMeter::new(WorkLimits::default()))
            .map_err(SessionError::Profile)?;
        Ok(Self {
            binding: requested.clone(),
            profile,
            context,
            key,
            tree,
            state: SessionState::Open(access),
            revision: 0,
            selection: None,
            stored_marks: None,
            selection_epoch: 0,
            journal: CommitJournal::default(),
            history: HistoryStore::default(),
            dirty: false,
            cache,
            events: EventOutbox::new(key),
            event_limits: event_limits.effective(),
            baseline,
        })
    }

    pub fn key(&self) -> SessionKey {
        self.key
    }
    pub fn state(&self) -> SessionState {
        self.state
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }
    pub fn selection_epoch(&self) -> u64 {
        self.selection_epoch
    }

    fn preparation_work(&self, requested: WorkLimits) -> WorkMeter {
        let limits = self
            .profile
            .transaction_work_limits()
            .map_or(requested, |profile| WorkLimits {
                units: requested.units.min(profile.units),
                bytes: requested.bytes.min(profile.bytes),
            });
        WorkMeter::new(limits)
    }

    /// Future typing override; None inherits the profile's caret policy, while
    /// Some(empty) explicitly requests plain text. This is session-local state.
    pub fn stored_marks(&self, key: SessionKey) -> Result<Option<&[Mark]>, SessionError<P::Error>> {
        self.guard(key, None)?;
        Ok(self.stored_marks.as_deref())
    }
    pub fn binding(&self) -> &ProfileBinding {
        &self.binding
    }

    pub fn stamp(&self) -> SessionStamp {
        SessionStamp {
            session: self.key,
            revision: self.revision,
            selection_epoch: self.selection_epoch,
            history_epoch: self.history.summary().epoch,
        }
    }

    /// Delivery/lifecycle metadata remains inspectable after close/poison.
    pub fn event_status(&self, key: SessionKey) -> Result<EventStatus, SessionError<P::Error>> {
        if key != self.key {
            return Err(StateError::StaleSession.into());
        }
        Ok(self.events.status())
    }

    pub fn events_after(
        &self,
        key: SessionKey,
        cursor: EventCursor,
        limits: EventReadLimits,
        work_limits: WorkLimits,
    ) -> Result<EventBatch<'_>, SessionError<P::Error>> {
        self.guard(key, None)?;
        Ok(self
            .events
            .read_after(cursor, limits, &mut WorkMeter::new(work_limits))?)
    }

    pub fn protect_events(
        &mut self,
        key: SessionKey,
        start: ProtectionStart,
    ) -> Result<ProtectedCursor, SessionError<P::Error>> {
        self.guard(key, None)?;
        Ok(self.events.protect(start)?)
    }

    pub fn acknowledge_events(
        &mut self,
        key: SessionKey,
        protection: ProtectedCursor,
        cursor: EventCursor,
    ) -> Result<bool, SessionError<P::Error>> {
        self.guard(key, None)?;
        Ok(self.events.acknowledge(protection, cursor)?)
    }

    pub fn release_events(
        &mut self,
        key: SessionKey,
        protection: ProtectedCursor,
    ) -> Result<bool, SessionError<P::Error>> {
        self.guard(key, None)?;
        Ok(self.events.release(protection)?)
    }

    pub fn saved_revision(&self) -> u64 {
        self.baseline.revision
    }

    fn state_event(
        &self,
        after: StateProjection<'_>,
        change: StateChange,
        work: &mut WorkMeter,
    ) -> Result<Option<crate::events::EventPlan>, EventError> {
        let stored_marks_before =
            crate::events::copy_event_marks(self.stored_marks.as_deref(), work)?;
        let stored_marks_after = crate::events::copy_event_marks(after.stored_marks, work)?;
        self.events.prepare_append(
            Some(EventPayload {
                before: self.stamp(),
                after: after.stamp,
                selection_before: self.selection,
                selection_after: after.selection,
                stored_marks_before,
                stored_marks_after,
                dirty_before: self.dirty,
                dirty_after: after.dirty,
                history: after.history,
                journal: self.journal.summary(self.revision),
                kind: EventKind::State(change),
            }),
            self.event_limits,
            work,
        )
    }

    /// Conservative local dirty state. Exact equality is checked only at an
    /// explicit export/save boundary, never inferred from undo depth.
    pub fn dirty(&self) -> bool {
        self.dirty
    }
    pub fn journal_summary(&self) -> JournalSummary {
        self.journal.summary(self.revision)
    }
    pub fn history_summary(&self) -> HistorySummary {
        self.history.summary()
    }
    /// An explicit host boundary seals a live typing group. Repeating an
    /// already sealed boundary is a true no-op, including at a counter limit.
    pub fn seal_history(
        &mut self,
        key: SessionKey,
        revision: u64,
        selection_epoch: u64,
        history_epoch: u64,
        limits: WorkLimits,
    ) -> Result<
        history_dispatch::HistoryBoundaryEvent,
        crate::transaction::TransactionError<P::Error>,
    > {
        self.guard(key, Some(revision))?;
        if selection_epoch != self.selection_epoch {
            return Err(StateError::StaleSelectionEpoch.into());
        }
        if history_epoch != self.history.summary().epoch {
            return Err(StateError::StaleHistoryEpoch.into());
        }
        let mut work = self.preparation_work(limits);
        let plan = self.history.plan_barrier(&mut work)?;
        let changed = plan.is_some();
        let next_history = plan
            .as_ref()
            .map_or_else(|| self.history.summary(), |plan| plan.summary());
        let event = if changed {
            self.state_event(
                StateProjection {
                    stamp: SessionStamp {
                        history_epoch: next_history.epoch,
                        ..self.stamp()
                    },
                    selection: self.selection,
                    stored_marks: self.stored_marks.as_deref(),
                    history: next_history,
                    dirty: self.dirty,
                },
                StateChange {
                    selection_changed: false,
                    stored_marks_changed: false,
                    history_changed: true,
                    baseline_changed: false,
                },
                &mut work,
            )?
        } else {
            None
        };
        if let Some(plan) = plan {
            self.history.publish(plan);
        }
        if let Some(event) = event {
            self.events.publish(event);
        }
        Ok(history_dispatch::HistoryBoundaryEvent {
            changed,
            history: self.history.summary(),
            work: work.usage(),
        })
    }
    pub fn journal_entries(&self) -> Vec<JournalEntrySummary> {
        self.journal.entry_summaries()
    }
    pub fn map_position(
        &self,
        key: SessionKey,
        from: u64,
        position: Position<NodeId>,
    ) -> Result<MapResult<NodeId>, SessionError<P::Error>> {
        self.guard(key, None)?;
        let result = self.journal.map(from, self.revision, position);
        if let Some(mapped) = result.position()
            && self.tree.prepare().validate_position(mapped).is_err()
        {
            return Ok(MapResult::Invalid(MapError::OffsetOutOfBounds));
        }
        Ok(result)
    }

    fn guard(&self, key: SessionKey, revision: Option<u64>) -> Result<(), StateError> {
        if key != self.key {
            return Err(StateError::StaleSession);
        }
        match self.state {
            SessionState::Closed => return Err(StateError::Closed),
            SessionState::Poisoned => return Err(StateError::Poisoned),
            SessionState::Open(_) => {}
        }
        if revision.is_some_and(|revision| revision != self.revision) {
            return Err(StateError::StaleRevision);
        }
        Ok(())
    }

    pub fn root(&self, key: SessionKey) -> Result<NodeId, SessionError<P::Error>> {
        self.guard(key, None)?;
        Ok(self.tree.root())
    }

    pub fn node(&self, key: SessionKey, id: NodeId) -> Result<&TreeNode, SessionError<P::Error>> {
        self.guard(key, None)?;
        Ok(self.tree.node(id)?)
    }

    pub fn node_at(
        &self,
        key: SessionKey,
        revision: u64,
        id: NodeId,
    ) -> Result<NodeRead<'_>, SessionError<P::Error>> {
        self.guard(key, Some(revision))?;
        let metrics = self.tree.metrics(id)?;
        Ok(NodeRead {
            stamp: self.stamp(),
            changed_revision: self.tree.changed_revision(id)?,
            stats: NodeStats {
                authored_nodes: metrics.authored_nodes,
                text_utf8: metrics.text_utf8,
                text_utf16: metrics.text_utf16,
                height: metrics.height,
            },
            node: self.tree.node(id)?,
        })
    }

    pub fn validate_position(
        &self,
        key: SessionKey,
        revision: u64,
        position: Position<NodeId>,
    ) -> Result<(), SessionError<P::Error>> {
        self.guard(key, Some(revision))?;
        Ok(self.tree.prepare().validate_position(position)?)
    }

    pub fn selection(
        &self,
        key: SessionKey,
    ) -> Result<Option<Selection<NodeId>>, SessionError<P::Error>> {
        self.guard(key, None)?;
        Ok(self.selection)
    }

    /// Selection-only changes preserve document revision and anchor/focus order.
    /// Read-only sessions may inspect/select admitted content.
    pub fn set_selection(
        &mut self,
        key: SessionKey,
        revision: u64,
        selection: Selection<NodeId>,
    ) -> Result<(), SessionError<P::Error>> {
        self.validate_position(key, revision, selection.anchor)?;
        self.validate_position(key, revision, selection.focus)?;
        if self.selection == Some(selection) {
            return Ok(());
        }
        let epoch = self
            .selection_epoch
            .checked_add(1)
            .ok_or(StateError::CounterExhausted)?;
        let mut work = self.preparation_work(WorkLimits::default());
        let history = self
            .history
            .plan_barrier(&mut work)
            .map_err(SessionError::History)?;
        let summary = history
            .as_ref()
            .map_or_else(|| self.history.summary(), |plan| plan.summary());
        let event = self.state_event(
            StateProjection {
                stamp: SessionStamp {
                    selection_epoch: epoch,
                    history_epoch: summary.epoch,
                    ..self.stamp()
                },
                selection: Some(selection),
                stored_marks: None,
                history: summary,
                dirty: self.dirty,
            },
            StateChange {
                selection_changed: true,
                stored_marks_changed: self.stored_marks.is_some(),
                history_changed: history.is_some(),
                baseline_changed: false,
            },
            &mut work,
        )?;
        self.selection = Some(selection);
        self.stored_marks = None;
        self.selection_epoch = epoch;
        if let Some(plan) = history {
            self.history.publish(plan);
        }
        if let Some(event) = event {
            self.events.publish(event);
        }
        Ok(())
    }

    /// Starts unadmitted sparse preparation. Allocated draft IDs are never
    /// recycled even if the candidate is abandoned. Committed content, selection
    /// and revisions stay intact; profile/transaction publication is OSR-34.
    pub fn prepare_tree(
        &self,
        key: SessionKey,
        revision: u64,
    ) -> Result<TreeDraft<'_>, SessionError<P::Error>> {
        self.guard(key, Some(revision))?;
        if self.state == SessionState::Open(AccessMode::ReadOnly) {
            return Err(StateError::ReadOnly.into());
        }
        Ok(self.tree.prepare())
    }

    /// Explicit snapshot work may traverse/clone the full tree. No primitive
    /// invokes this path. The profile alone constructs canonical persisted data.
    pub fn export_snapshot(
        &self,
        key: SessionKey,
        revision: u64,
    ) -> Result<Vec<u8>, SessionError<P::Error>> {
        self.export_with(key, revision, |bytes, _| bytes.to_vec())
    }

    fn export_with<R>(
        &self,
        key: SessionKey,
        revision: u64,
        output: impl FnOnce(&[u8], WorkTrace) -> R,
    ) -> Result<R, SessionError<P::Error>> {
        self.guard(key, Some(revision))?;
        let mut work = self.preparation_work(WorkLimits::default());
        let document = self.tree.document_with_work(&mut work)?;
        let admitted = self
            .profile
            .admit_snapshot(&self.context, &document)
            .map_err(SessionError::Profile)?;
        let bytes = self.profile.canonical(&admitted);
        editor_core::limits::check(
            "snapshot_bytes",
            MAX_SNAPSHOT_BYTES as u64,
            bytes.len() as u64,
        )
        .map_err(|error| SessionError::Snapshot(SnapshotError::Limit(error)))?;
        work.charge_bytes(bytes.len() as u64)
            .map_err(|error| SessionError::Snapshot(SnapshotError::Limit(error)))?;
        work.note_phase(WorkPhase::Export, 0, bytes.len() as u64);
        Ok(output(bytes, work.trace()))
    }

    pub fn export_snapshot_receipt(
        &self,
        key: SessionKey,
        revision: u64,
    ) -> Result<Snapshot, SessionError<P::Error>> {
        self.export_with(key, revision, |bytes, trace| {
            Snapshot::new(
                self.stamp(),
                self.events.status().head,
                self.binding.clone(),
                std::sync::Arc::from(bytes),
                self.baseline.equals(bytes),
                trace,
            )
        })
    }

    /// The host reports that these exact exported bytes were saved. A response
    /// for r never clears dirty r+1, even when that later revision is an undo.
    pub fn acknowledge_snapshot(
        &mut self,
        snapshot: &Snapshot,
    ) -> Result<SaveAcknowledgement, SessionError<P::Error>> {
        self.guard(snapshot.stamp().session, None)?;
        if snapshot.binding() != &self.binding {
            return Err(SnapshotError::BindingMismatch.into());
        }
        let revision = snapshot.stamp().revision;
        if revision > self.revision {
            return Err(SnapshotError::FutureRevision.into());
        }
        if revision < self.baseline.revision {
            return Ok(SaveAcknowledgement::IgnoredOlder {
                saved_revision: self.baseline.revision,
                dirty: self.dirty,
            });
        }
        if revision == self.baseline.revision {
            if !self.baseline.equals(snapshot.document()) {
                return Err(SnapshotError::InconsistentReceipt.into());
            }
            return Ok(SaveAcknowledgement::Unchanged {
                saved_revision: revision,
                dirty: self.dirty,
            });
        }
        let dirty = revision != self.revision;
        let mut work = self.preparation_work(WorkLimits::default());
        let event = self.state_event(
            StateProjection {
                stamp: self.stamp(),
                selection: self.selection,
                stored_marks: self.stored_marks.as_deref(),
                history: self.history.summary(),
                dirty,
            },
            StateChange {
                selection_changed: false,
                stored_marks_changed: false,
                history_changed: false,
                baseline_changed: true,
            },
            &mut work,
        )?;
        let baseline = SavedBaseline {
            revision,
            document: snapshot.shared_document(),
        };
        self.baseline = baseline;
        self.dirty = dirty;
        if let Some(event) = event {
            self.events.publish(event);
        }
        Ok(SaveAcknowledgement::Updated {
            saved_revision: revision,
            dirty,
        })
    }

    /// Explicit current-snapshot equality can recognize returning to saved
    /// content. The document revision and known saved revision stay monotonic.
    pub fn reconcile_saved_snapshot(
        &mut self,
        snapshot: &Snapshot,
    ) -> Result<bool, SessionError<P::Error>> {
        self.guard(snapshot.stamp().session, Some(snapshot.stamp().revision))?;
        if snapshot.binding() != &self.binding {
            return Err(SnapshotError::BindingMismatch.into());
        }
        if !self.dirty || !self.baseline.equals(snapshot.document()) {
            return Ok(false);
        }
        let mut work = self.preparation_work(WorkLimits::default());
        let event = self.state_event(
            StateProjection {
                stamp: self.stamp(),
                selection: self.selection,
                stored_marks: self.stored_marks.as_deref(),
                history: self.history.summary(),
                dirty: false,
            },
            StateChange {
                selection_changed: false,
                stored_marks_changed: false,
                history_changed: false,
                baseline_changed: true,
            },
            &mut work,
        )?;
        self.dirty = false;
        if let Some(event) = event {
            self.events.publish(event);
        }
        Ok(true)
    }

    /// Complete new admission is prepared before replacing any current state.
    /// Failure preserves the current generation/tree/selection/revisions.
    pub fn remount(
        &mut self,
        key: SessionKey,
        requested: &ProfileBinding,
        input: &[u8],
        mode: AdmissionMode,
        access: AccessMode,
    ) -> Result<SessionKey, SessionError<P::Error>> {
        self.guard(key, None)?;
        self.binding
            .ensure_matches(requested)
            .map_err(SessionError::Binding)?;
        let next_key = self
            .key
            .next_generation()
            .ok_or(StateError::CounterExhausted)?;
        let admitted = self
            .profile
            .admit_bytes(requested, input, mode)
            .map_err(SessionError::Profile)?;
        let context = self.profile.context(&admitted);
        let tree = AddressTree::from_document(next_key, self.profile.to_document(&admitted))?;
        let baseline = SavedBaseline::admitted(self.profile.canonical(&admitted))?;
        let cache = self
            .profile
            .seed_cache(&admitted, &tree, &mut WorkMeter::new(WorkLimits::default()))
            .map_err(SessionError::Profile)?;
        let events = EventOutbox::new(next_key);
        self.context = context;
        self.key = next_key;
        self.tree = tree;
        self.state = SessionState::Open(access);
        self.revision = 0;
        self.selection = None;
        self.stored_marks = None;
        self.selection_epoch = 0;
        self.journal = CommitJournal::default();
        self.history = HistoryStore::default();
        self.dirty = false;
        self.baseline = baseline;
        self.cache = cache;
        self.events = events;
        Ok(next_key)
    }

    pub fn close(&mut self, key: SessionKey) -> Result<(), SessionError<P::Error>> {
        self.guard(key, None)?;
        self.state = SessionState::Closed;
        self.stored_marks = None;
        self.events.terminate(TerminalKind::Closed);
        Ok(())
    }

    /// Used by a host boundary after a fatal trap/panic, never for ordinary
    /// validation refusal. Recovery requires a newly opened Session.
    pub fn poison(&mut self, key: SessionKey) -> Result<(), SessionError<P::Error>> {
        self.guard(key, None)?;
        self.state = SessionState::Poisoned;
        self.events.terminate(TerminalKind::Poisoned);
        Ok(())
    }
}

#[cfg(test)]
#[path = "history_profile_tests.rs"]
mod history_profile_tests;

#[cfg(test)]
#[path = "delta_tests.rs"]
mod delta_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use editor_core::document::{Attributes, Document, Node, Primitive};
    use editor_core::positions::{Affinity, Utf16Offset};
    use std::cell::Cell;
    use std::rc::Rc;

    // A trusted fixture adapter, not the production alternate profile of OSR-64.
    struct FixtureProfile {
        binding: ProfileBinding,
        calls: Rc<Cell<usize>>,
    }
    struct AdmittedFixture(Document);
    impl FixtureProfile {
        fn new(calls: Rc<Cell<usize>>) -> Self {
            Self {
                binding: ProfileBinding::new(
                    "org.example.fixture",
                    "0.0.0",
                    "org.example.fixture/json",
                    1,
                    &[],
                )
                .unwrap(),
                calls,
            }
        }
    }
    impl FrozenProfile for FixtureProfile {
        type Context = ();
        type Admitted = AdmittedFixture;
        type Error = &'static str;
        type Cache<I: Copy + Eq + Ord> = ();
        fn binding(&self) -> &ProfileBinding {
            &self.binding
        }
        fn admit_bytes(
            &self,
            requested: &ProfileBinding,
            input: &[u8],
            _: AdmissionMode,
        ) -> Result<AdmittedFixture, Self::Error> {
            self.calls.set(self.calls.get() + 1);
            self.binding
                .ensure_matches(requested)
                .map_err(|_| "binding")?;
            if input == b"reject" {
                return Err("invalid document");
            }
            let leaf = Node {
                type_id: "org.example.fixture/text".into(),
                primitive: Primitive::Text,
                attributes: Attributes::new(),
                marks: vec![],
                text: Some("e\u{301}😀".into()),
                children: vec![],
            };
            let children = if input == b"badshape" {
                vec![leaf]
            } else {
                vec![Node {
                    type_id: "org.example.fixture/paragraph".into(),
                    primitive: Primitive::TextBlock,
                    attributes: Attributes::new(),
                    marks: vec![],
                    text: None,
                    children: vec![leaf],
                }]
            };
            Ok(AdmittedFixture(Document { children }))
        }
        fn context(&self, _: &AdmittedFixture) {}
        fn to_document(&self, admitted: &AdmittedFixture) -> Document {
            admitted.0.clone()
        }
        fn admit_snapshot(
            &self,
            _: &(),
            document: &Document,
        ) -> Result<AdmittedFixture, Self::Error> {
            self.calls.set(self.calls.get() + 1);
            Ok(AdmittedFixture(document.clone()))
        }
        fn canonical<'a>(&self, _: &'a AdmittedFixture) -> &'a [u8] {
            b"fixture canonical"
        }
    }
    fn open(access: AccessMode) -> (Session<FixtureProfile>, Rc<Cell<usize>>) {
        let calls = Rc::new(Cell::new(0));
        let profile = FixtureProfile::new(calls.clone());
        let binding = profile.binding.clone();
        (
            Session::open(profile, &binding, b"valid", AdmissionMode::Strict, access).unwrap(),
            calls,
        )
    }
    fn leaf(s: &Session<FixtureProfile>) -> NodeId {
        let key = s.key();
        let root = s.root(key).unwrap();
        let p = s.node(key, root).unwrap().children()[0];
        s.node(key, p).unwrap().children()[0]
    }
    fn text(leaf: NodeId, offset: usize) -> Position<NodeId> {
        Position::Text {
            leaf,
            utf16: Utf16Offset::new(offset),
            affinity: Affinity::After,
        }
    }

    #[test]
    fn scalar_selection_keeps_direction_revision_and_readonly_grapheme_interior() {
        let (mut s, _) = open(AccessMode::ReadOnly);
        let key = s.key();
        let leaf = leaf(&s);
        let reverse = Selection {
            anchor: text(leaf, 4),
            focus: text(leaf, 1),
        };
        s.set_selection(key, 0, reverse).unwrap();
        assert_eq!(s.selection(key).unwrap(), Some(reverse));
        assert_eq!(s.revision(), 0);
        assert_eq!(s.selection_epoch(), 1);
        s.set_selection(key, 0, reverse).unwrap();
        assert_eq!(s.selection_epoch(), 1);
        assert!(s.validate_position(key, 0, text(leaf, 3)).is_err());
        assert!(matches!(
            s.prepare_tree(key, 0),
            Err(SessionError::State(StateError::ReadOnly))
        ));
        let before = s.selection(key).unwrap();
        assert!(
            s.set_selection(
                key,
                0,
                Selection {
                    anchor: text(leaf, 0),
                    focus: text(leaf, 3)
                }
            )
            .is_err()
        );
        assert_eq!(s.selection(key).unwrap(), before);
        assert_eq!(s.selection_epoch(), 1);
        s.selection_epoch = u64::MAX;
        assert_eq!(
            s.set_selection(
                key,
                0,
                Selection {
                    anchor: text(leaf, 0),
                    focus: text(leaf, 2)
                }
            ),
            Err(SessionError::State(StateError::CounterExhausted))
        );
        assert_eq!(s.selection(key).unwrap(), before);
    }

    #[test]
    fn preparation_never_calls_full_profile_snapshot_or_changes_committed_state() {
        let (s, calls) = open(AccessMode::Editable);
        let key = s.key();
        let leaf = leaf(&s);
        assert_eq!(calls.get(), 1);
        let mut draft = s.prepare_tree(key, 0).unwrap();
        assert!(
            draft
                .replace_text(leaf, Utf16Offset::new(1), Utf16Offset::new(1), "x")
                .is_err()
        );
        draft
            .replace_text(leaf, Utf16Offset::new(0), Utf16Offset::new(2), "a")
            .unwrap();
        assert_eq!(draft.node(leaf).unwrap().text(), Some("a😀"));
        assert_eq!(s.node(key, leaf).unwrap().text(), Some("e\u{301}😀"));
        assert_eq!(calls.get(), 1);
        assert_eq!(s.revision(), 0);
        assert_eq!(s.selection_epoch(), 0);
        assert_eq!(s.export_snapshot(key, 0).unwrap(), b"fixture canonical");
        assert_eq!(calls.get(), 2);
        assert!(matches!(
            s.prepare_tree(key, 1),
            Err(SessionError::State(StateError::StaleRevision))
        ));
    }

    #[test]
    fn failed_remount_preserves_state_success_retires_every_old_handle() {
        let (mut s, _) = open(AccessMode::Editable);
        let key = s.key();
        let old = leaf(&s);
        let binding = s.binding().clone();
        let selection = Selection {
            anchor: text(old, 4),
            focus: text(old, 1),
        };
        s.set_selection(key, 0, selection).unwrap();
        for bad in [b"reject".as_slice(), b"badshape".as_slice()] {
            assert!(
                s.remount(
                    key,
                    &binding,
                    bad,
                    AdmissionMode::Strict,
                    AccessMode::ReadOnly
                )
                .is_err()
            );
            assert_eq!(s.key(), key);
            assert_eq!(s.state(), SessionState::Open(AccessMode::Editable));
            assert_eq!(s.selection(key).unwrap(), Some(selection));
            assert_eq!(s.selection_epoch(), 1);
            assert_eq!(s.node(key, old).unwrap().text(), Some("e\u{301}😀"));
        }
        let next = s
            .remount(
                key,
                &binding,
                b"valid",
                AdmissionMode::Strict,
                AccessMode::ReadOnly,
            )
            .unwrap();
        assert_ne!(next, key);
        assert_eq!(next.generation(), key.generation() + 1);
        assert_ne!(leaf(&s), old);
        assert_eq!(
            s.node(key, old),
            Err(SessionError::State(StateError::StaleSession))
        );
        assert_eq!(
            s.node(next, old),
            Err(SessionError::Tree(TreeError::ForeignSession))
        );
        assert_eq!(s.selection(next).unwrap(), None);
        assert_eq!(s.selection_epoch(), 0);
    }

    #[test]
    fn separate_sessions_close_and_poison_refuse_stale_reads() {
        let (mut a, _) = open(AccessMode::Editable);
        let (mut b, _) = open(AccessMode::Editable);
        let (ka, kb) = (a.key(), b.key());
        assert_ne!(leaf(&a), leaf(&b));
        assert_eq!(
            a.root(kb),
            Err(SessionError::State(StateError::StaleSession))
        );
        a.close(ka).unwrap();
        assert_eq!(a.root(ka), Err(SessionError::State(StateError::Closed)));
        b.poison(kb).unwrap();
        assert_eq!(
            b.export_snapshot(kb, 0),
            Err(SessionError::State(StateError::Poisoned))
        );
    }

    #[test]
    fn unknown_binding_refuses_before_document_decoder() {
        let calls = Rc::new(Cell::new(0));
        let profile = FixtureProfile::new(calls.clone());
        let unknown = ProfileBinding::new(
            "org.example.fixture",
            "2.0.0",
            "org.example.fixture/json",
            1,
            &[],
        )
        .unwrap();
        assert!(matches!(
            Session::open(
                profile,
                &unknown,
                b"reject",
                AdmissionMode::Strict,
                AccessMode::Editable
            ),
            Err(SessionError::Binding(BindingError::ProfileVersionMismatch))
        ));
        assert_eq!(calls.get(), 0);
    }

    include!("transaction_tests.rs");
    include!("history_tests.rs");
}
