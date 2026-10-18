// SPDX-License-Identifier: MIT OR Apache-2.0
//! Test-only actual KWDJ Session witnesses. Independent input/expectations are
//! fixed in delta_literals.json; no production SDK/callback implementation.
// Native/test/probe entry points intentionally use different exported subsets.
#![allow(dead_code)]

use std::{cell::Cell, collections::BTreeMap, rc::Rc, sync::Arc};

use editor_core::cache::{CacheUpdate, PreparedValidation};
use editor_core::candidate::{CandidateChanges, CandidateRead};
use editor_core::commands::{
    CommandDescriptor, CommandPresentation, CommandProvider, CommandState, PlanBuilder,
};
use editor_core::document::{Document, Mark};
use editor_core::positions::{Affinity, Position, PositionError, Selection, Utf16Offset};
use editor_core::profile::{AdmissionMode, FrozenProfile, ProfileBinding};
use editor_core::transaction::{
    Operation, TransactionProfile, ValidationStats, WorkLimits, WorkMeter, WorkPhase,
};
use editor_engine::events::{
    EventError, EventKind, EventLimits, EventReadLimits, EventStatus, ProtectionStart,
    SessionEvent, SessionStamp, TerminalKind,
};
use editor_engine::mapping::MapResult;
use editor_engine::tree::{TreeError, TreeNode};
use editor_engine::{
    AccessMode, CommandAvailability, CommandOutcome, CommandRequest, CommitEvent, DispatchOutcome,
    HistoryAvailability, HistoryDirection, HistoryHint, HistoryOutcome, HistoryRequest,
    JournalEntrySummary, JournalSummary, NodeId, SaveAcknowledgement, Session, SessionError,
    StateError, Transaction, TransactionError, TypingClass,
};
use editor_kwdj::commands::KwdjIntent;
use editor_kwdj::{
    AdmissionBudget, IdentityResolver, IdentityResolverError, IdentityStatus, KwdjProfile,
    KwdjProfileError, Limits,
};
use serde_json::{Value, json};
use uuid::Uuid;

#[cfg(not(target_arch = "wasm32"))]
#[path = "delta_benchmark.rs"]
mod benchmark;
#[path = "delta_series.rs"]
mod series;

pub const LITERALS: &str = include_str!("delta_literals.json");
pub const PREFIX: &str = "org.klenwriter.kwdj/";
pub type Real = Session<Counted>;

struct Identities;
impl IdentityResolver for Identities {
    fn resolve_media(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(IdentityStatus::Exists)
    }
    fn resolve_reference(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(IdentityStatus::Exists)
    }
}
static IDENTITIES: Identities = Identities;

#[derive(Clone, Default)]
pub struct Calls(Rc<Cell<[u64; 4]>>);
impl Calls {
    pub fn get(&self) -> [u64; 4] {
        self.0.get()
    }
    fn bump(&self, index: usize) {
        let mut calls = self.get();
        calls[index] += 1;
        self.0.set(calls);
    }
}
/// The full cohort delegates to the existing authoritative full profile hooks;
/// it does not duplicate their validator or rewrite their decisions.
pub struct Counted {
    inner: KwdjProfile<'static>,
    calls: Calls,
    pub full: bool,
}
impl FrozenProfile for Counted {
    type Context = <KwdjProfile<'static> as FrozenProfile>::Context;
    type Admitted = <KwdjProfile<'static> as FrozenProfile>::Admitted;
    type Error = KwdjProfileError;
    type Cache<I: Copy + Eq + Ord> = <KwdjProfile<'static> as FrozenProfile>::Cache<I>;
    fn binding(&self) -> &ProfileBinding {
        self.inner.binding()
    }
    fn seed_cache<V: CandidateRead>(
        &self,
        admitted: &Self::Admitted,
        view: &V,
        work: &mut WorkMeter,
    ) -> Result<Self::Cache<V::Id>, Self::Error> {
        if self.full {
            Ok(Self::Cache::<V::Id>::default())
        } else {
            self.inner.seed_cache(admitted, view, work)
        }
    }
    fn admit_bytes(
        &self,
        b: &ProfileBinding,
        input: &[u8],
        m: AdmissionMode,
    ) -> Result<Self::Admitted, Self::Error> {
        self.calls.bump(0);
        self.inner.admit_bytes(b, input, m)
    }
    fn context(&self, a: &Self::Admitted) -> Self::Context {
        self.inner.context(a)
    }
    fn to_document(&self, a: &Self::Admitted) -> Document {
        self.calls.bump(1);
        self.inner.to_document(a)
    }
    fn admit_snapshot(
        &self,
        c: &Self::Context,
        d: &Document,
    ) -> Result<Self::Admitted, Self::Error> {
        self.calls.bump(2);
        self.inner.admit_snapshot(c, d)
    }
    fn canonical<'a>(&self, a: &'a Self::Admitted) -> &'a [u8] {
        self.calls.bump(3);
        self.inner.canonical(a)
    }
}
impl TransactionProfile for Counted {
    fn normalize_candidate<V: CandidateRead>(
        &self,
        c: &Self::Context,
        v: &V,
        w: &mut WorkMeter,
    ) -> Result<Vec<Operation<V::Id>>, Self::Error> {
        self.inner.normalize_candidate(c, v, w)
    }
    fn validate_candidate<V: CandidateRead>(
        &self,
        c: &Self::Context,
        v: &V,
        w: &mut WorkMeter,
    ) -> Result<ValidationStats, Self::Error> {
        self.inner.validate_candidate(c, v, w)
    }
    fn normalize_scoped<V: CandidateChanges>(
        &self,
        c: &Self::Context,
        v: &V,
        cache: &Self::Cache<V::Id>,
        w: &mut WorkMeter,
    ) -> Result<Vec<Operation<V::Id>>, Self::Error> {
        if self.full {
            w.note_phase(WorkPhase::FullFallback, 1, 0);
            self.inner.normalize_candidate(c, v, w)
        } else {
            self.inner.normalize_scoped(c, v, cache, w)
        }
    }
    fn validate_scoped<V: CandidateChanges>(
        &self,
        c: &Self::Context,
        v: &V,
        cache: &Self::Cache<V::Id>,
        w: &mut WorkMeter,
    ) -> Result<PreparedValidation<Self::Cache<V::Id>>, Self::Error> {
        if self.full {
            w.note_phase(WorkPhase::FullFallback, 1, 0);
            Ok(PreparedValidation {
                stats: self.inner.validate_candidate(c, v, w)?,
                cache: CacheUpdate::Replace(Self::Cache::<V::Id>::default()),
            })
        } else {
            self.inner.validate_scoped(c, v, cache, w)
        }
    }
}
impl CommandProvider for Counted {
    type Intent<I: Copy + Eq + Ord> = KwdjIntent<I>;
    const COMMANDS: &'static [CommandDescriptor] =
        <KwdjProfile<'static> as CommandProvider>::COMMANDS;
    fn command_id<I: Copy + Eq + Ord>(intent: &Self::Intent<I>) -> &str {
        <KwdjProfile<'static> as CommandProvider>::command_id(intent)
    }
    fn prepare_command<V: CandidateRead>(
        &self,
        c: &Self::Context,
        v: &V,
        s: CommandState<'_, V::Id>,
        i: &Self::Intent<V::Id>,
        b: &mut PlanBuilder<'_, V::Id>,
    ) -> Result<CommandPresentation, Self::Error> {
        self.inner.prepare_command(c, v, s, i, b)
    }
    fn finalize_typing_override<V: CandidateRead>(
        &self,
        c: &Self::Context,
        v: &V,
        s: Option<Selection<V::Id>>,
        m: Option<&[Mark]>,
        w: &mut WorkMeter,
    ) -> Result<Option<Vec<Mark>>, Self::Error> {
        self.inner.finalize_typing_override(c, v, s, m, w)
    }
    fn error_code(e: &Self::Error) -> &'static str {
        <KwdjProfile<'static> as CommandProvider>::error_code(e)
    }
}

pub fn profile() -> KwdjProfile<'static> {
    KwdjProfile::new(&IDENTITIES, Limits::default(), AdmissionBudget::default())
}
pub fn open(value: &Value, full: bool, limits: EventLimits, access: AccessMode) -> (Real, Calls) {
    let calls = Calls::default();
    let counted = Counted {
        inner: profile(),
        calls: calls.clone(),
        full,
    };
    let binding = counted.binding().clone();
    (
        Session::open_with_event_limits(
            counted,
            &binding,
            &serde_json::to_vec(value).unwrap(),
            AdmissionMode::Strict,
            access,
            limits,
        )
        .unwrap(),
        calls,
    )
}
pub fn ordinary<T>(s: &mut Real, calls: &Calls, action: impl FnOnce(&mut Real) -> T) -> T {
    let before = calls.get();
    let result = action(s);
    assert_eq!(
        calls.get(),
        before,
        "ordinary operation invoked a full admission/Document/snapshot/canonical hook"
    );
    result
}
pub fn at(s: &Real, path: &[usize]) -> NodeId {
    let mut id = s.root(s.key()).unwrap();
    for index in path {
        id = s.node(s.key(), id).unwrap().children()[*index];
    }
    id
}
pub fn point(id: NodeId, utf16: usize) -> Position<NodeId> {
    Position::Text {
        leaf: id,
        utf16: Utf16Offset::new(utf16),
        affinity: Affinity::After,
    }
}
pub fn caret(point: Position<NodeId>) -> Selection<NodeId> {
    Selection {
        anchor: point,
        focus: point,
    }
}
pub fn replace(s: &Real, leaf: NodeId, from: usize, to: usize, inserted: &str) -> Transaction {
    Transaction::new(
        s.key(),
        s.revision(),
        vec![Operation::ReplaceText {
            leaf: leaf.into(),
            from: Utf16Offset::new(from),
            to: Utf16Offset::new(to),
            inserted: inserted.into(),
        }],
    )
}
pub fn raw(s: &mut Real, calls: &Calls, transaction: Transaction) -> CommitEvent {
    match ordinary(s, calls, |s| s.dispatch(transaction)) {
        DispatchOutcome::Changed(event) => event,
        other => panic!("expected Changed: {other:?}"),
    }
}
pub fn command(
    s: &mut Real,
    calls: &Calls,
    intent: KwdjIntent<NodeId>,
) -> CommandOutcome<KwdjProfileError> {
    let request = CommandRequest::new(s.key(), s.revision(), s.selection_epoch(), intent);
    let before = facets(s);
    let query = ordinary(s, calls, |s| s.query_command(&request));
    assert_eq!(facets(s), before, "query changed committed facets");
    assert_eq!(ordinary(s, calls, |s| s.query_command(&request)), query);
    let actual = ordinary(s, calls, |s| s.execute_command(&request));
    match (&query, &actual) {
        (
            CommandAvailability::Available { work, .. },
            CommandOutcome::Completed {
                outcome: DispatchOutcome::Changed(event),
                ..
            },
        ) => assert_eq!(*work, event.work),
        (
            CommandAvailability::Available { work, .. },
            CommandOutcome::Completed {
                outcome: DispatchOutcome::Unchanged { work: actual, .. },
                ..
            },
        ) => assert_eq!(work, actual),
        (
            CommandAvailability::Unavailable { reason, work, .. },
            CommandOutcome::Refused {
                reason: actual,
                work: actual_work,
                ..
            },
        ) => {
            assert_eq!(reason, actual);
            assert_eq!(work, actual_work);
            assert_eq!(facets(s), before);
        }
        _ => panic!("query/execute disagree: {query:?} {actual:?}"),
    }
    actual
}
pub fn replay(s: &mut Real, calls: &Calls, direction: HistoryDirection) -> CommitEvent {
    let request = HistoryRequest::new(
        s.key(),
        s.revision(),
        s.selection_epoch(),
        s.history_summary().epoch,
        direction,
    );
    let before = facets(s);
    let query = ordinary(s, calls, |s| s.query_history(&request));
    assert_eq!(facets(s), before);
    let HistoryAvailability::Available { work, .. } = query else {
        panic!("history unavailable: {query:?}")
    };
    let HistoryOutcome::Completed(event) = ordinary(s, calls, |s| s.execute_history(&request))
    else {
        panic!("history execution refused")
    };
    assert_eq!(work, event.work);
    event
}

#[derive(Debug, PartialEq, Eq)]
pub struct Facets {
    stamp: SessionStamp,
    dirty: bool,
    saved_revision: u64,
    selection: Option<Selection<NodeId>>,
    marks: Option<Vec<Mark>>,
    history: editor_engine::history::HistorySummary,
    journal: JournalSummary,
    entries: Vec<JournalEntrySummary>,
    status: EventStatus,
    records: Vec<(NodeId, TreeNode)>,
    events: Vec<Arc<SessionEvent>>,
}
pub fn facets(s: &Real) -> Facets {
    fn walk(s: &Real, id: NodeId, out: &mut Vec<(NodeId, TreeNode)>) {
        let node = s.node(s.key(), id).unwrap();
        out.push((id, node.clone()));
        for child in node.children() {
            walk(s, *child, out);
        }
    }
    let mut records = vec![];
    walk(s, at(s, &[]), &mut records);
    let status = s.event_status(s.key()).unwrap();
    let events = s
        .events_after(
            s.key(),
            status.oldest_after,
            EventReadLimits::default(),
            WorkLimits::default(),
        )
        .unwrap()
        .iter()
        .cloned()
        .collect();
    Facets {
        stamp: s.stamp(),
        dirty: s.dirty(),
        saved_revision: s.saved_revision(),
        selection: s.selection(s.key()).unwrap(),
        marks: s.stored_marks(s.key()).unwrap().map(<[Mark]>::to_vec),
        history: s.history_summary(),
        journal: s.journal_summary(),
        entries: s.journal_entries(),
        status,
        records,
        events,
    }
}
fn canonical_expected(value: &Value) -> Vec<u8> {
    let p = profile();
    let a = p
        .admit_bytes(
            p.binding(),
            &serde_json::to_vec(value).unwrap(),
            AdmissionMode::Import,
        )
        .unwrap();
    p.canonical(&a).to_vec()
}
fn assert_document(s: &Real, expected: &Value) -> Value {
    let actual = s.export_snapshot(s.key(), s.revision()).unwrap();
    assert_eq!(
        actual,
        canonical_expected(expected),
        "literal canonical document differs"
    );
    serde_json::from_slice(&actual).unwrap()
}
fn labels(s: &Real, fixture: &str) -> BTreeMap<NodeId, String> {
    let mut result = BTreeMap::from([
        (at(s, &[]), "root".into()),
        (at(s, &[0]), "a".into()),
        (at(s, &[0, 0]), "ta".into()),
    ]);
    if fixture == "nested" {
        for (path, name) in [
            (vec![1], "q"),
            (vec![1, 0], "pb"),
            (vec![1, 0, 0], "tb"),
            (vec![2], "c"),
            (vec![2, 0], "tc"),
        ] {
            result.insert(at(s, &path), name.into());
        }
    }
    if fixture == "styled" {
        result.insert(at(s, &[0, 1]), "tb".into());
        result.insert(at(s, &[0, 2]), "tc".into());
    }
    result
}
fn role_ids(roles: &BTreeMap<NodeId, String>, values: &[NodeId]) -> Value {
    assert!(
        values.windows(2).all(|pair| pair[0] < pair[1]),
        "event IDs are not sorted unique"
    );
    let mut out = values
        .iter()
        .map(|id| {
            roles
                .get(id)
                .unwrap_or_else(|| panic!("unbound event identity {id:?}"))
                .clone()
        })
        .collect::<Vec<_>>();
    out.sort();
    json!(out)
}
fn impact(event: &CommitEvent, roles: &BTreeMap<NodeId, String>, expected: &Value) -> Value {
    let EventKind::Document { impact, map } = event.notification.kind() else {
        panic!("missing Document event")
    };
    assert_eq!(map, &event.map);
    let actual = json!({"upserted":role_ids(roles,&impact.upserted),"removed":role_ids(roles,&impact.removed),"before":role_ids(roles,&impact.ancestors_before),"after":role_ids(roles,&impact.ancestors_after),"root_order_changed":impact.root_order_changed});
    for field in [
        "upserted",
        "removed",
        "before",
        "after",
        "root_order_changed",
    ] {
        assert_eq!(actual[field], expected[field], "literal {field} mismatch");
    }
    actual
}
fn kinds(s: &Real) -> Value {
    let status = s.event_status(s.key()).unwrap();
    json!(
        s.events_after(
            s.key(),
            status.oldest_after,
            EventReadLimits::default(),
            WorkLimits::default()
        )
        .unwrap()
        .iter()
        .map(|e| match e.kind() {
            EventKind::Document { .. } => "document",
            EventKind::State(_) => "state",
        })
        .collect::<Vec<_>>()
    )
}

pub fn observe_one(id: &str, full: bool) -> Value {
    let literals: Value = serde_json::from_str(LITERALS).unwrap();
    let expected = literals["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .unwrap();
    let fixture = expected["fixture"].as_str().unwrap();
    let value = &literals["fixtures"][fixture];
    let limits = EventLimits {
        records: if id == "D11" {
            2
        } else if id == "D12" {
            1
        } else {
            64
        },
        ..EventLimits::default()
    };
    let (mut s, calls) = open(
        value,
        full,
        limits,
        if id == "D13" {
            AccessMode::ReadOnly
        } else {
            AccessMode::Editable
        },
    );
    let mut roles = labels(&s, fixture);
    let root = at(&s, &[]);
    let a = at(&s, &[0]);
    let ta = at(&s, &[0, 0]);
    let start = s.event_status(s.key()).unwrap().head;
    let mut observed_impact = Value::Null;
    match id {
        "D01" | "D04" => {
            let tb = at(&s, &[1, 0, 0]);
            let p = at(&s, &[1, 0]);
            let quote = at(&s, &[1]);
            let untouched = at(&s, &[2]);
            let tx = replace(&s, tb, 0, 1, if id == "D04" { "B\r\n" } else { "B" });
            let event = raw(&mut s, &calls, tx);
            observed_impact = impact(&event, &roles, expected);
            assert_eq!(event.notification.payload().history, s.history_summary());
            assert_eq!(event.notification.payload().journal, s.journal_summary());
            for node in [root, quote, p, tb] {
                assert_eq!(s.node_at(s.key(), 1, node).unwrap().changed_revision, 1);
            }
            assert_eq!(
                s.node_at(s.key(), 1, untouched).unwrap().changed_revision,
                0
            );
            assert!(matches!(
                s.node_at(s.key(), 0, tb),
                Err(SessionError::State(StateError::StaleRevision))
            ));
            assert_eq!(s.node_at(s.key(), 1, root).unwrap().stats.authored_nodes, 7);
            if id == "D04" {
                assert_eq!(event.map.map(point(tb, 1)), MapResult::Mapped(point(tb, 2)));
                assert!(event.normalization_operations > 0);
            }
        }
        "D02" => {
            let q = at(&s, &[1]);
            let tx = Transaction::new(
                s.key(),
                0,
                vec![Operation::Move {
                    node: a.into(),
                    parent: q.into(),
                    before_index: 1,
                }],
            );
            let event = raw(&mut s, &calls, tx);
            observed_impact = impact(&event, &roles, expected);
            assert_eq!(s.node(s.key(), a).unwrap().parent(), Some(q));
            assert_eq!(s.node(s.key(), ta).unwrap().parent(), Some(a));
        }
        "D03" => {
            let q = at(&s, &[1]);
            let tx = Transaction::new(s.key(), 0, vec![Operation::Remove { node: q.into() }]);
            let event = raw(&mut s, &calls, tx);
            observed_impact = impact(&event, &roles, expected);
            for label in ["q", "pb", "tb"] {
                let id = *roles.iter().find(|(_, v)| v.as_str() == label).unwrap().0;
                assert!(matches!(
                    s.node_at(s.key(), 1, id),
                    Err(SessionError::Tree(TreeError::MissingNode))
                ));
            }
            assert_eq!(s.node_at(s.key(), 1, root).unwrap().stats.authored_nodes, 4);
        }
        "D05" => {
            let tb = at(&s, &[0, 1]);
            let tc = at(&s, &[0, 2]);
            let tx = Transaction::new(
                s.key(),
                0,
                vec![Operation::SetMarks {
                    leaf: tb.into(),
                    marks: vec![],
                }],
            );
            let event = raw(&mut s, &calls, tx);
            observed_impact = impact(&event, &roles, expected);
            assert_eq!(event.map.map(point(tc, 1)), MapResult::Mapped(point(ta, 3)));
            assert!(event.normalization_operations >= 2);
        }
        "D06" => {
            let q = at(&s, &[1]);
            let old = facets(&s).records;
            let CommandOutcome::Completed {
                outcome: DispatchOutcome::Changed(event),
                ..
            } = command(
                &mut s,
                &calls,
                KwdjIntent::Duplicate {
                    node: q,
                    parent: root,
                    index: 3,
                },
            )
            else {
                panic!("duplicate refused")
            };
            for (path, name) in [
                (vec![3], "copy_q"),
                (vec![3, 0], "copy_p"),
                (vec![3, 0, 0], "copy_t"),
            ] {
                let id = at(&s, &path);
                assert!(!old.iter().any(|(before, _)| *before == id));
                roles.insert(id, name.into());
            }
            observed_impact = impact(&event, &roles, expected);
            for (id, node) in old.into_iter().filter(|(id, _)| *id != root) {
                assert_eq!(*s.node(s.key(), id).unwrap(), node);
            }
        }
        "D07" => {
            let before = facets(&s);
            assert!(matches!(
                command(&mut s, &calls, KwdjIntent::DismissSlash),
                CommandOutcome::Completed {
                    outcome: DispatchOutcome::Unchanged { .. },
                    ..
                }
            ));
            assert!(matches!(
                ordinary(&mut s, &calls, |s| s.dispatch(Transaction::new(
                    s.key(),
                    s.revision(),
                    vec![]
                ))),
                DispatchOutcome::Unchanged { .. }
            ));
            let bad = replace(&s, ta, 0, 99, "x");
            assert!(matches!(
                ordinary(&mut s, &calls, |s| s.dispatch(bad)),
                DispatchOutcome::Refused {
                    error: TransactionError::Tree(TreeError::Position(PositionError::OutOfBounds)),
                    ..
                }
            ));
            assert_eq!(facets(&s), before);
        }
        "D08" => {
            let key = s.key();
            ordinary(&mut s, &calls, |s| {
                s.set_selection(key, 0, caret(point(ta, 1))).unwrap()
            });
            let head = s.event_status(key).unwrap().head;
            ordinary(&mut s, &calls, |s| {
                s.set_selection(key, 0, caret(point(ta, 1))).unwrap()
            });
            assert_eq!(s.event_status(key).unwrap().head, head);
            let mark = Mark {
                type_id: format!("{PREFIX}strong"),
                attributes: Default::default(),
            };
            assert!(matches!(
                command(
                    &mut s,
                    &calls,
                    KwdjIntent::ToggleMark { mark: mark.clone() }
                ),
                CommandOutcome::Completed {
                    outcome: DispatchOutcome::Unchanged { .. },
                    ..
                }
            ));
            assert_eq!(s.stored_marks(key).unwrap(), Some([mark].as_slice()));
            assert_eq!(s.history_summary().undo_units, 0);
        }
        "D09" => {
            let key = s.key();
            ordinary(&mut s, &calls, |s| {
                s.set_selection(key, 0, caret(point(ta, 1))).unwrap()
            });
            let mut tx = replace(&s, ta, 1, 1, "x");
            tx.history_hint = HistoryHint::Typing {
                token: 7,
                class: TypingClass::Insert,
            };
            raw(&mut s, &calls, tx);
            let before = s.stamp();
            let barrier = ordinary(&mut s, &calls, |s| {
                s.seal_history(
                    key,
                    before.revision,
                    before.selection_epoch,
                    before.history_epoch,
                    WorkLimits::default(),
                )
                .unwrap()
            });
            assert!(barrier.changed);
            let stamp = s.stamp();
            assert!(
                !ordinary(&mut s, &calls, |s| s
                    .seal_history(
                        key,
                        stamp.revision,
                        stamp.selection_epoch,
                        stamp.history_epoch,
                        WorkLimits::default()
                    )
                    .unwrap())
                .changed
            );
            replay(&mut s, &calls, HistoryDirection::Undo);
            assert_document(&s, value);
            replay(&mut s, &calls, HistoryDirection::Redo);
        }
        "D10" => {
            let initial = s.export_snapshot_receipt(s.key(), 0).unwrap();
            let tx = replace(&s, ta, 1, 1, "x");
            raw(&mut s, &calls, tx);
            let saved = s.export_snapshot_receipt(s.key(), 1).unwrap();
            let tx = replace(&s, ta, 2, 2, "y");
            raw(&mut s, &calls, tx);
            assert_eq!(
                ordinary(&mut s, &calls, |s| s.acknowledge_snapshot(&saved).unwrap()),
                SaveAcknowledgement::Updated {
                    saved_revision: 1,
                    dirty: true
                }
            );
            let before = facets(&s);
            assert!(matches!(
                ordinary(&mut s, &calls, |s| s
                    .acknowledge_snapshot(&initial)
                    .unwrap()),
                SaveAcknowledgement::IgnoredOlder {
                    saved_revision: 1,
                    dirty: true
                }
            ));
            assert_eq!(facets(&s), before);
            replay(&mut s, &calls, HistoryDirection::Undo);
            assert!(s.dirty());
            let current = s.export_snapshot_receipt(s.key(), 3).unwrap();
            assert_eq!(current.document(), saved.document());
            assert!(current.matches_saved_baseline());
            assert_eq!(current.stamp().revision, 3);
            assert_eq!(
                current.event_cursor(),
                s.event_status(s.key()).unwrap().head
            );
            assert!(ordinary(&mut s, &calls, |s| s
                .reconcile_saved_snapshot(&current)
                .unwrap()));
            let head = s.event_status(s.key()).unwrap().head;
            assert!(!ordinary(&mut s, &calls, |s| s
                .reconcile_saved_snapshot(&current)
                .unwrap()));
            assert_eq!(s.event_status(s.key()).unwrap().head, head);
            assert!(matches!(
                s.export_snapshot_receipt(s.key(), 2),
                Err(SessionError::State(StateError::StaleRevision))
            ));
        }
        "D11" => {
            let key = s.key();
            let token = s.protect_events(key, ProtectionStart::Now).unwrap();
            ordinary(&mut s, &calls, |s| {
                s.set_selection(key, 0, caret(point(ta, 1))).unwrap()
            });
            let first = s.event_status(key).unwrap().head;
            let tx = replace(&s, ta, 1, 1, "x");
            raw(&mut s, &calls, tx);
            let request = CommandRequest::new(
                key,
                s.revision(),
                s.selection_epoch(),
                KwdjIntent::InsertText { text: "y".into() },
            );
            let before = facets(&s);
            let query = ordinary(&mut s, &calls, |s| s.query_command(&request));
            let CommandAvailability::Unavailable { reason, work, .. } = query else {
                panic!("protected query escaped backpressure")
            };
            assert_eq!(reason, "events.backpressure");
            let CommandOutcome::Refused {
                reason: actual,
                work: actual_work,
                ..
            } = ordinary(&mut s, &calls, |s| s.execute_command(&request))
            else {
                panic!("protected command committed")
            };
            assert_eq!(reason, actual);
            assert_eq!(work, actual_work);
            assert_eq!(facets(&s), before);
            assert!(s.acknowledge_events(key, token, first).unwrap());
            assert!(!s.acknowledge_events(key, token, first).unwrap());
            let outcome = ordinary(&mut s, &calls, |s| s.execute_command(&request));
            assert!(matches!(
                outcome,
                CommandOutcome::Completed {
                    outcome: DispatchOutcome::Changed(_),
                    ..
                }
            ));
            let after = facets(&s);
            assert!(matches!(
                ordinary(&mut s, &calls, |s| s.execute_command(&request)),
                CommandOutcome::Refused {
                    reason: "session.stale_revision",
                    ..
                }
            ));
            assert_eq!(facets(&s), after);
            let b1 = s
                .events_after(
                    key,
                    first,
                    EventReadLimits::default(),
                    WorkLimits::default(),
                )
                .unwrap();
            assert_eq!(
                b1.iter().map(|e| e.cursor().sequence()).collect::<Vec<_>>(),
                vec![2, 3]
            );
            let consumed = b1.through();
            assert!(s.acknowledge_events(key, token, consumed).unwrap());
            s.release_events(key, token).unwrap();
        }
        "D12" => {
            let key = s.key();
            let token = s.protect_events(key, ProtectionStart::Now).unwrap();
            let tx = replace(&s, ta, 0, 1, "b");
            raw(&mut s, &calls, tx);
            let old_snapshot = s.export_snapshot_receipt(key, 1).unwrap();
            let before = facets(&s);
            let binding = s.binding().clone();
            assert!(
                s.remount(
                    key,
                    &binding,
                    b"{",
                    AdmissionMode::Strict,
                    AccessMode::Editable
                )
                .is_err()
            );
            assert_eq!(facets(&s), before);
            let next = s
                .remount(
                    key,
                    &binding,
                    &serde_json::to_vec(value).unwrap(),
                    AdmissionMode::Strict,
                    AccessMode::Editable,
                )
                .unwrap();
            assert_ne!(key, next);
            assert_eq!(s.revision(), 0);
            assert!(!s.dirty());
            assert_eq!(s.event_status(next).unwrap().records, 0);
            assert!(matches!(
                s.acknowledge_snapshot(&old_snapshot),
                Err(SessionError::State(StateError::StaleSession))
            ));
            assert!(s.acknowledge_events(next, token, start).is_err());
            let fresh = s.export_snapshot_receipt(next, 0).unwrap();
            assert_eq!(fresh.document(), canonical_expected(value));
            let leaf = at(&s, &[0, 0]);
            ordinary(&mut s, &calls, |s| {
                s.set_selection(next, 0, caret(point(leaf, 0))).unwrap()
            });
            s.close(next).unwrap();
            assert_eq!(
                s.event_status(next).unwrap().terminal.unwrap().kind,
                TerminalKind::Closed
            );
            assert!(matches!(
                s.node_at(next, 0, leaf),
                Err(SessionError::State(StateError::Closed))
            ));
            let (mut poisoned, pcalls) = open(value, full, limits, AccessMode::Editable);
            let pk = poisoned.key();
            let leaf = at(&poisoned, &[0, 0]);
            ordinary(&mut poisoned, &pcalls, |s| {
                s.set_selection(pk, 0, caret(point(leaf, 0))).unwrap()
            });
            poisoned.poison(pk).unwrap();
            assert_eq!(
                poisoned.event_status(pk).unwrap().terminal.unwrap().kind,
                TerminalKind::Poisoned
            );
            return json!({"id":id,"status":"passed","fresh_revision":"0","fresh_events":0,"terminal_closed_and_poisoned":true,"failed_remount_preserves_all_facets":true,"stale_generation_refused":true,"document":serde_json::from_slice::<Value>(fresh.document()).unwrap()});
        }
        "D13" => {
            let key = s.key();
            ordinary(&mut s, &calls, |s| {
                s.set_selection(key, 0, caret(point(ta, 1))).unwrap()
            });
            let before = facets(&s);
            assert!(matches!(
                command(&mut s, &calls, KwdjIntent::InsertText { text: "x".into() }),
                CommandOutcome::Refused {
                    reason: "session.read_only",
                    ..
                }
            ));
            assert_eq!(facets(&s), before);
        }
        _ => panic!("unknown literal {id}"),
    }
    let document = assert_document(&s, &expected["expected_document"]);
    if let Some(revision) = expected["revision"].as_u64() {
        assert_eq!(s.revision(), revision);
    }
    if let Some(events) = expected["events"].as_u64() {
        assert_eq!(s.event_status(s.key()).unwrap().head.sequence(), events);
    }
    if let Some(dirty) = expected["dirty"].as_bool() {
        assert_eq!(s.dirty(), dirty);
    }
    if let Some(saved) = expected["saved_revision"].as_u64() {
        assert_eq!(s.saved_revision(), saved);
    }
    let kinds = kinds(&s);
    if !expected["event_kinds"].is_null() {
        assert_eq!(kinds, expected["event_kinds"]);
    }
    json!({"id":id,"status":"passed","revision":s.revision().to_string(),"events":s.event_status(s.key()).unwrap().head.sequence().to_string(),"event_kinds":kinds,"dirty":s.dirty(),"saved_revision":s.saved_revision().to_string(),"impact":observed_impact,"document":document,"ordinary_codec_hooks":0})
}

pub fn observe_literals() -> Value {
    let ids = (1..=13).map(|i| format!("D{i:02}")).collect::<Vec<_>>();
    let optimized = ids
        .iter()
        .map(|id| observe_one(id, false))
        .collect::<Vec<_>>();
    let full = ids
        .iter()
        .map(|id| observe_one(id, true))
        .collect::<Vec<_>>();
    assert_eq!(
        optimized, full,
        "incremental/full authoritative profile paths differ"
    );
    json!({"status":"passed","literal_total":13,"equivalence_cohorts":2,"same_literal_and_full_authoritative_results":true,"cases":optimized})
}
pub fn observe_series() -> Value {
    series::observe()
}
pub fn observe() -> Value {
    let literals = observe_literals();
    let measured = observe_series();
    json!({"format":"klenwriter-editor-delta-observations/1","portable":{"status":"passed","literals":literals,"series":measured["portable"],"scope":"Actual native/compiled-WASM Session/KWDJ delta/read/snapshot/baseline/protected delivery primitives; no mounted SDK callbacks, server save or durability claim."},"diagnostics":measured["diagnostics"]})
}
#[cfg(not(target_arch = "wasm32"))]
pub fn observe_benchmark() -> Value {
    benchmark::observe()
}
#[cfg(not(target_arch = "wasm32"))]
pub fn observe_benchmark_round(round: usize) -> Value {
    benchmark::observe_round(round)
}
