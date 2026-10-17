// SPDX-License-Identifier: MIT OR Apache-2.0
//! Admission, immutable profile context, lifecycle and guarded read/preparation.

use editor_core::positions::{Position, Selection};
use editor_core::profile::{AdmissionMode, BindingError, FrozenProfile, ProfileBinding};

use crate::identity::{NodeId, SessionKey};
use crate::tree::{AddressTree, TreeDraft, TreeError, TreeNode};

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
    Closed,
    Poisoned,
    ReadOnly,
    CounterExhausted,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionError<E> {
    Binding(BindingError),
    Profile(E),
    State(StateError),
    Tree(TreeError),
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
/// OSR-33 intentionally exposes no dispatch/commit/history API.
pub struct Session<P: FrozenProfile> {
    profile: P,
    binding: ProfileBinding,
    context: P::Context,
    key: SessionKey,
    tree: AddressTree,
    state: SessionState,
    revision: u64,
    selection: Option<Selection<NodeId>>,
    selection_epoch: u64,
}

impl<P: FrozenProfile> Session<P> {
    pub fn open(
        profile: P,
        requested: &ProfileBinding,
        input: &[u8],
        mode: AdmissionMode,
        access: AccessMode,
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
        Ok(Self {
            binding: requested.clone(),
            profile,
            context,
            key,
            tree,
            state: SessionState::Open(access),
            revision: 0,
            selection: None,
            selection_epoch: 0,
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
    pub fn binding(&self) -> &ProfileBinding {
        &self.binding
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
        self.selection = Some(selection);
        self.selection_epoch = epoch;
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
        self.guard(key, Some(revision))?;
        let admitted = self
            .profile
            .admit_snapshot(&self.context, &self.tree.document())
            .map_err(SessionError::Profile)?;
        Ok(self.profile.canonical(&admitted).to_vec())
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
        self.context = context;
        self.key = next_key;
        self.tree = tree;
        self.state = SessionState::Open(access);
        self.revision = 0;
        self.selection = None;
        self.selection_epoch = 0;
        Ok(next_key)
    }

    pub fn close(&mut self, key: SessionKey) -> Result<(), SessionError<P::Error>> {
        self.guard(key, None)?;
        self.state = SessionState::Closed;
        Ok(())
    }

    /// Used by a host boundary after a fatal trap/panic, never for ordinary
    /// validation refusal. Recovery requires a newly opened Session.
    pub fn poison(&mut self, key: SessionKey) -> Result<(), SessionError<P::Error>> {
        self.guard(key, None)?;
        self.state = SessionState::Poisoned;
        Ok(())
    }
}

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
}
