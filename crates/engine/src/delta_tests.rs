// SPDX-License-Identifier: MIT OR Apache-2.0
//! Cross-facet publication and export tests with an explicitly full-fallback
//! generic profile. Actual KWDJ incremental equivalence lives in its own lane.

use std::cell::Cell;
use std::rc::Rc;

use editor_core::candidate::CandidateRead;
use editor_core::document::{Attributes, Document, Mark, Node, Primitive};
use editor_core::history::HistoryProfile;
use editor_core::positions::{Affinity, Position, Selection, Utf16Offset};
use editor_core::profile::{AdmissionMode, FrozenProfile, ProfileBinding};
use editor_core::transaction::{
    Operation, TransactionProfile, ValidationStats, WorkLimits, WorkMeter,
};

use super::*;
use crate::events::{EventError, EventKind, EventLimits, EventReadLimits, ProtectionStart};
use crate::{
    DispatchOutcome, HistoryDirection, HistoryOutcome, HistoryRequest, Transaction,
    TransactionError,
};

struct Profile {
    binding: ProfileBinding,
    reject_export: Rc<Cell<bool>>,
}
struct Admitted {
    document: Document,
    canonical: Vec<u8>,
}
fn text(value: &str) -> Node {
    Node {
        type_id: "org.example.delta/text".into(),
        primitive: Primitive::Text,
        attributes: Attributes::new(),
        marks: vec![],
        text: Some(value.into()),
        children: vec![],
    }
}
fn paragraph(value: &str) -> Node {
    Node {
        type_id: "org.example.delta/paragraph".into(),
        primitive: Primitive::TextBlock,
        attributes: Attributes::new(),
        marks: vec![],
        text: None,
        children: vec![text(value)],
    }
}
fn initial() -> Document {
    Document {
        children: vec![
            paragraph("a"),
            Node {
                type_id: "org.example.delta/quote".into(),
                primitive: Primitive::Container,
                attributes: Attributes::new(),
                marks: vec![],
                text: None,
                children: vec![paragraph("b")],
            },
        ],
    }
}
fn admitted(document: Document) -> Admitted {
    // Fixture codec, deliberately explicit and independent of tree/session IDs.
    Admitted {
        canonical: format!("{document:?}").into_bytes(),
        document,
    }
}
impl FrozenProfile for Profile {
    type Context = ();
    type Admitted = Admitted;
    type Error = &'static str;
    type Cache<I: Copy + Eq + Ord> = ();
    fn binding(&self) -> &ProfileBinding {
        &self.binding
    }
    fn admit_bytes(
        &self,
        binding: &ProfileBinding,
        input: &[u8],
        _: AdmissionMode,
    ) -> Result<Admitted, Self::Error> {
        self.binding
            .ensure_matches(binding)
            .map_err(|_| "binding")?;
        if input != b"base" {
            return Err("input");
        }
        Ok(admitted(initial()))
    }
    fn context(&self, _: &Admitted) {}
    fn to_document(&self, value: &Admitted) -> Document {
        value.document.clone()
    }
    fn admit_snapshot(&self, _: &(), document: &Document) -> Result<Admitted, Self::Error> {
        if self.reject_export.get() {
            return Err("export-facts");
        }
        Ok(admitted(document.clone()))
    }
    fn canonical<'a>(&self, value: &'a Admitted) -> &'a [u8] {
        &value.canonical
    }
}
impl TransactionProfile for Profile {
    fn normalize_candidate<V: CandidateRead>(
        &self,
        _: &(),
        _: &V,
        _: &mut WorkMeter,
    ) -> Result<Vec<Operation<V::Id>>, Self::Error> {
        Ok(vec![])
    }
    fn validate_candidate<V: CandidateRead>(
        &self,
        _: &(),
        view: &V,
        work: &mut WorkMeter,
    ) -> Result<ValidationStats, Self::Error> {
        let mut stack = view.roots().to_vec();
        let mut nodes = 0;
        while let Some(id) = stack.pop() {
            work.charge_units(1).map_err(|_| "work")?;
            let node = view.node(id).ok_or("missing")?;
            nodes += 1;
            stack.extend_from_slice(node.children);
        }
        Ok(ValidationStats {
            canonical_bytes: 0,
            nodes,
        })
    }
}
impl HistoryProfile for Profile {
    fn finalize_history_typing<V: CandidateRead>(
        &self,
        _: &(),
        _: &V,
        _: Option<Selection<V::Id>>,
        saved: Option<&[Mark]>,
        _: &mut WorkMeter,
    ) -> Result<Option<Vec<Mark>>, Self::Error> {
        Ok(saved.map(<[Mark]>::to_vec))
    }
    fn history_error_code(error: &Self::Error) -> &'static str {
        error
    }
}
fn open(limits: EventLimits) -> (Session<Profile>, Rc<Cell<bool>>) {
    let reject_export = Rc::new(Cell::new(false));
    let profile = Profile {
        binding: ProfileBinding::new(
            "org.example.delta",
            "0.0.0",
            "org.example.delta/json",
            1,
            &[],
        )
        .unwrap(),
        reject_export: reject_export.clone(),
    };
    let binding = profile.binding.clone();
    (
        Session::open_with_event_limits(
            profile,
            &binding,
            b"base",
            AdmissionMode::Strict,
            AccessMode::Editable,
            limits,
        )
        .unwrap(),
        reject_export,
    )
}
fn ids(s: &Session<Profile>) -> [NodeId; 6] {
    let root = s.root(s.key()).unwrap();
    let roots = s.node(s.key(), root).unwrap().children();
    let p = roots[0];
    let q = roots[1];
    let qp = s.node(s.key(), q).unwrap().children()[0];
    [
        root,
        p,
        s.node(s.key(), p).unwrap().children()[0],
        q,
        qp,
        s.node(s.key(), qp).unwrap().children()[0],
    ]
}
fn edit(s: &Session<Profile>, inserted: &str) -> Transaction {
    Transaction::new(
        s.key(),
        s.revision(),
        vec![Operation::ReplaceText {
            leaf: ids(s)[2].into(),
            from: Utf16Offset::new(1),
            to: Utf16Offset::new(1),
            inserted: inserted.into(),
        }],
    )
}
fn changed(s: &mut Session<Profile>, transaction: Transaction) -> crate::CommitEvent {
    match s.dispatch(transaction) {
        DispatchOutcome::Changed(event) => event,
        other => panic!("expected change {other:?}"),
    }
}
fn point(id: NodeId) -> Position<NodeId> {
    Position::Text {
        leaf: id,
        utf16: Utf16Offset::new(0),
        affinity: Affinity::After,
    }
}
fn history(s: &Session<Profile>, direction: HistoryDirection) -> HistoryRequest {
    HistoryRequest::new(
        s.key(),
        s.revision(),
        s.selection_epoch(),
        s.history_summary().epoch,
        direction,
    )
}
fn facets(
    s: &Session<Profile>,
) -> (
    SessionStamp,
    bool,
    u64,
    Vec<u8>,
    EventStatus,
    HistorySummary,
    crate::JournalSummary,
) {
    (
        s.stamp(),
        s.dirty(),
        s.saved_revision(),
        s.export_snapshot(s.key(), s.revision()).unwrap(),
        s.event_status(s.key()).unwrap(),
        s.history_summary(),
        s.journal_summary(),
    )
}

#[test]
fn protected_delivery_refusal_preserves_all_facets_and_retry_emits_once() {
    let (mut s, _) = open(EventLimits {
        records: 1,
        ..EventLimits::default()
    });
    let key = s.key();
    let [root, p, leaf, _, _, _] = ids(&s);
    let cursor = s.event_status(key).unwrap().head;
    let protection = s.protect_events(key, ProtectionStart::Now).unwrap();
    s.set_selection(
        key,
        0,
        Selection {
            anchor: point(leaf),
            focus: point(leaf),
        },
    )
    .unwrap();
    let before = facets(&s);
    let request = edit(&s, "X");
    assert!(matches!(
        s.dispatch(request.clone()),
        DispatchOutcome::Refused {
            error: TransactionError::Events(EventError::Backpressure),
            ..
        }
    ));
    assert_eq!(facets(&s), before);
    let batch = s
        .events_after(
            key,
            cursor,
            EventReadLimits::default(),
            WorkLimits::default(),
        )
        .unwrap();
    assert_eq!(batch.len(), 1);
    let consumed = batch.through();
    assert!(matches!(
        batch.iter().next().unwrap().kind(),
        EventKind::State(_)
    ));
    assert!(s.acknowledge_events(key, protection, consumed).unwrap());
    assert!(!s.acknowledge_events(key, protection, consumed).unwrap());
    let event = changed(&mut s, request);
    assert_eq!(event.revision, 1);
    assert_eq!(event.notification.cursor().sequence(), 2);
    let EventKind::Document { impact, map } = event.notification.kind() else {
        panic!("document event")
    };
    assert_eq!(impact.upserted, vec![leaf]);
    assert!(impact.removed.is_empty());
    assert_eq!(impact.ancestors_before, vec![root, p]);
    assert_eq!(impact.ancestors_after, vec![root, p]);
    assert_eq!(map, &event.map);
    assert_eq!(event.notification.payload().history, s.history_summary());
    assert_eq!(event.notification.payload().journal, s.journal_summary());
    assert_eq!(s.node_at(key, 1, root).unwrap().changed_revision, 1);
    assert_eq!(s.node_at(key, 1, p).unwrap().changed_revision, 1);
    assert_eq!(s.node_at(key, 1, ids(&s)[3]).unwrap().changed_revision, 0);
    assert!(matches!(
        s.node_at(key, 0, leaf),
        Err(SessionError::State(StateError::StaleRevision))
    ));
    let before = facets(&s);
    let undo = history(&s, HistoryDirection::Undo);
    let query = s.query_history(&undo);
    let crate::HistoryAvailability::Unavailable { error, work, .. } = query else {
        panic!("protected history must backpressure")
    };
    let HistoryOutcome::Refused {
        error: actual,
        work: actual_work,
        ..
    } = s.execute_history(&undo)
    else {
        panic!("history mutated")
    };
    assert_eq!(error, actual);
    assert_eq!(work, actual_work);
    assert_eq!(facets(&s), before);
    s.release_events(key, protection).unwrap();
    assert!(matches!(
        s.execute_history(&undo),
        HistoryOutcome::Completed(_)
    ));
    assert_eq!(s.revision(), 2);
    assert_eq!(s.node_at(key, 2, leaf).unwrap().node.text(), Some("a"));
    assert!(matches!(
        s.events_after(
            key,
            cursor,
            EventReadLimits::default(),
            WorkLimits::default()
        ),
        Err(SessionError::Events(EventError::Gap { .. }))
    ));
}

#[test]
fn snapshot_acknowledgement_and_exact_comparison_respect_revision_order() {
    let (mut s, _) = open(EventLimits::default());
    let key = s.key();
    let initial = s.export_snapshot_receipt(key, 0).unwrap();
    let first_tx = edit(&s, "X");
    changed(&mut s, first_tx);
    let saved = s.export_snapshot_receipt(key, 1).unwrap();
    let second_tx = edit(&s, "Y");
    changed(&mut s, second_tx);
    let before_revision = s.revision();
    assert_eq!(
        s.acknowledge_snapshot(&saved).unwrap(),
        SaveAcknowledgement::Updated {
            saved_revision: 1,
            dirty: true
        }
    );
    assert_eq!(s.revision(), before_revision);
    assert!(s.dirty());
    assert_eq!(
        s.acknowledge_snapshot(&initial).unwrap(),
        SaveAcknowledgement::IgnoredOlder {
            saved_revision: 1,
            dirty: true
        }
    );
    let undo = history(&s, HistoryDirection::Undo);
    assert!(matches!(
        s.execute_history(&undo),
        HistoryOutcome::Completed(_)
    ));
    assert_eq!(s.revision(), 3);
    assert!(s.dirty());
    let same = s.export_snapshot_receipt(key, 3).unwrap();
    assert_eq!(same.document(), saved.document());
    assert!(same.matches_saved_baseline());
    assert!(s.dirty(), "export alone has no state authority");
    assert!(s.reconcile_saved_snapshot(&same).unwrap());
    assert!(!s.dirty());
    assert_eq!(s.revision(), 3);
    assert_eq!(s.saved_revision(), 1);
    let head = s.event_status(key).unwrap().head;
    assert!(!s.reconcile_saved_snapshot(&same).unwrap());
    assert_eq!(s.event_status(key).unwrap().head, head);
    assert!(matches!(
        s.reconcile_saved_snapshot(&saved),
        Err(SessionError::State(StateError::StaleRevision))
    ));
}

#[test]
fn full_event_store_cannot_prevent_terminal_state_or_successful_generation_switch() {
    let (mut s, _) = open(EventLimits {
        records: 1,
        ..EventLimits::default()
    });
    let key = s.key();
    let protection = s.protect_events(key, ProtectionStart::Now).unwrap();
    let snapshot = s.export_snapshot_receipt(key, 0).unwrap();
    let first_tx = edit(&s, "X");
    changed(&mut s, first_tx);
    let before = facets(&s);
    let binding = s.binding().clone();
    assert!(
        s.remount(
            key,
            &binding,
            b"reject",
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
            b"base",
            AdmissionMode::Strict,
            AccessMode::Editable,
        )
        .unwrap();
    assert_ne!(next, key);
    assert_eq!(s.revision(), 0);
    assert!(!s.dirty());
    assert_eq!(s.event_status(next).unwrap().records, 0);
    assert!(matches!(
        s.acknowledge_snapshot(&snapshot),
        Err(SessionError::State(StateError::StaleSession))
    ));
    assert!(
        s.acknowledge_events(next, protection, before.4.head)
            .is_err()
    );
    s.events.set_sequence_for_test(u64::MAX);
    s.close(next).unwrap();
    assert_eq!(
        s.event_status(next).unwrap().terminal.unwrap().kind,
        TerminalKind::Closed
    );
    assert!(matches!(
        s.node_at(next, 0, ids_unchecked_not_used()),
        Err(SessionError::State(StateError::Closed))
    ));
}
// An already-minted ID suffices: closed guard must run before node lookup.
fn ids_unchecked_not_used() -> NodeId {
    NodeId::new(SessionKey::allocate().unwrap(), 1)
}

#[test]
fn event_counter_exhaustion_keeps_noops_and_all_failed_preparations_atomic() {
    let (mut s, _) = open(EventLimits::default());
    let key = s.key();
    s.events.set_sequence_for_test(u64::MAX);
    let before = facets(&s);
    assert!(matches!(
        s.dispatch(Transaction::new(key, 0, vec![])),
        DispatchOutcome::Unchanged { .. }
    ));
    let tx = edit(&s, "X");
    assert!(matches!(
        s.dispatch(tx),
        DispatchOutcome::Refused {
            error: TransactionError::Events(EventError::CounterExhausted),
            ..
        }
    ));
    assert_eq!(facets(&s), before);
    let point = point(ids(&s)[2]);
    assert!(matches!(
        s.set_selection(
            key,
            0,
            Selection {
                anchor: point,
                focus: point
            }
        ),
        Err(SessionError::Events(EventError::CounterExhausted))
    ));
    assert_eq!(facets(&s), before);
    s.poison(key).unwrap();
    assert_eq!(
        s.event_status(key).unwrap().terminal.unwrap().kind,
        TerminalKind::Poisoned
    );
}

#[test]
fn failed_export_and_late_save_event_refusal_preserve_baseline_and_dirty() {
    let (mut s, reject) = open(EventLimits {
        records: 1,
        ..EventLimits::default()
    });
    let key = s.key();
    let protection = s.protect_events(key, ProtectionStart::Now).unwrap();
    let tx = edit(&s, "X");
    changed(&mut s, tx);
    let snapshot = s.export_snapshot_receipt(key, 1).unwrap();
    let before = facets(&s);
    reject.set(true);
    assert!(matches!(
        s.export_snapshot_receipt(key, 1),
        Err(SessionError::Profile("export-facts"))
    ));
    reject.set(false);
    assert_eq!(facets(&s), before);
    assert!(matches!(
        s.acknowledge_snapshot(&snapshot),
        Err(SessionError::Events(EventError::Backpressure))
    ));
    assert_eq!(facets(&s), before);
    s.acknowledge_events(key, protection, before.4.head)
        .unwrap();
    assert_eq!(
        s.acknowledge_snapshot(&snapshot).unwrap(),
        SaveAcknowledgement::Updated {
            saved_revision: 1,
            dirty: false
        }
    );
    assert!(!s.dirty());
}
