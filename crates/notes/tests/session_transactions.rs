// SPDX-License-Identifier: MIT OR Apache-2.0
mod support;

use editor_core::commands::SelectionIntent;
use editor_core::document::{Attribute, Attributes, Document, Node, Primitive};
use editor_core::positions::{Affinity, Position, Selection, Utf16Offset};
use editor_core::profile::{AdmissionMode, FrozenProfile};
use editor_core::transaction::{Operation, WorkLimits, WorkPhase};
use editor_engine::{
    AccessMode, DispatchOutcome, NodeId, NodeRef, Session, Transaction, TransactionError,
};
use klenwriter_editor_notes::{NotesError, NotesProfile, TEXT};

fn open() -> Session<NotesProfile> {
    let profile = support::profile(true);
    let binding = profile.binding().clone();
    Session::open(
        profile,
        &binding,
        include_bytes!("../../../contracts/notes/v1/inputs/N005-highlight-only.json"),
        AdmissionMode::Strict,
        AccessMode::Editable,
    )
    .unwrap()
}
fn path(session: &Session<NotesProfile>, indices: &[usize]) -> NodeId {
    let key = session.key();
    let mut node = session.root(key).unwrap();
    for index in indices {
        node = session.node(key, node).unwrap().children()[*index];
    }
    node
}
fn changed(result: DispatchOutcome<NotesError>) -> editor_engine::CommitEvent {
    match result {
        DispatchOutcome::Changed(event) => event,
        other => panic!("Expected actual commit: {other:?}"),
    }
}

#[test]
fn real_session_normalization_maps_created_caret_and_preserves_marked_unicode() {
    let mut session = open();
    let key = session.key();
    let paragraph = path(&session, &[0, 0]);
    let original_leaf = path(&session, &[0, 0, 0]);
    let inserted = Node {
        type_id: TEXT.into(),
        primitive: Primitive::Text,
        attributes: Attributes::new(),
        marks: session.node(key, original_leaf).unwrap().marks().to_vec(),
        text: Some(" y".into()),
        children: vec![],
    };
    let mut transaction = Transaction::new(
        key,
        0,
        vec![Operation::InsertFragment {
            parent: paragraph.into(),
            index: 1,
            fragment: Document {
                children: vec![inserted],
            },
        }],
    );
    let caret = Position::Text {
        leaf: NodeRef::Created {
            operation: 0,
            path: vec![0],
        },
        utf16: Utf16Offset::new(2),
        affinity: Affinity::After,
    };
    transaction.selection = SelectionIntent::MapFromUserResult(Some(Selection {
        anchor: caret.clone(),
        focus: caret,
    }));
    let event = changed(session.dispatch(transaction));
    assert_eq!(event.revision, 1);
    assert_eq!(event.normalization_operations, 1);
    assert_eq!(
        session.node(key, paragraph).unwrap().children(),
        &[original_leaf]
    );
    assert_eq!(
        session.node(key, original_leaf).unwrap().text(),
        Some("x y")
    );
    let final_caret = Position::Text {
        leaf: original_leaf,
        utf16: Utf16Offset::new(3),
        affinity: Affinity::After,
    };
    assert_eq!(
        session.selection(key).unwrap(),
        Some(Selection {
            anchor: final_caret,
            focus: final_caret
        })
    );
    let expected =
        include_str!("../../../contracts/notes/v1/expected/N005-highlight-only.canonical.json")
            .replace("\"text\":\"x\"", "\"text\":\"x y\"");
    assert_eq!(
        session.export_snapshot(key, 1).unwrap(),
        expected.as_bytes()
    );
    assert_eq!(event.validation.canonical_bytes, expected.len() as u64);
    assert_eq!(session.journal_summary().entries, 1);
    assert_eq!(session.history_summary().undo_units, 1);
    assert!(event.trace.phase(WorkPhase::FullFallback).visits > 0);
}

#[test]
fn authored_root_metadata_is_ordinary_transactional_state_and_invalid_tail_rolls_back() {
    let mut session = open();
    let key = session.key();
    let document = path(&session, &[0]);
    let leaf = path(&session, &[0, 0, 0]);
    let before_bytes = session.export_snapshot(key, 0).unwrap();
    let before = (
        session.stamp(),
        session.dirty(),
        session.history_summary(),
        session.journal_summary(),
        session.event_status(key).unwrap(),
        session.selection(key).unwrap(),
        session.stored_marks(key).unwrap().map(<[_]>::to_vec),
    );
    let transaction = Transaction::new(
        key,
        0,
        vec![
            Operation::SetAttribute {
                node: document.into(),
                key: "title".into(),
                value: Some(Attribute::String("new".into())),
            },
            Operation::SetAttribute {
                node: leaf.into(),
                key: "extra".into(),
                value: Some(Attribute::Boolean(true)),
            },
        ],
    );
    let error = match session.dispatch(transaction) {
        DispatchOutcome::Refused {
            error: TransactionError::Profile(error),
            ..
        } => error,
        other => panic!("Expected actual profile refusal: {other:?}"),
    };
    assert_eq!(error.as_str(), "notes.invalid_attribute");
    assert_eq!(error.path, "/root/children/0/children/0/attrs/extra");
    assert_eq!(session.export_snapshot(key, 0).unwrap(), before_bytes);
    assert_eq!(
        (
            session.stamp(),
            session.dirty(),
            session.history_summary(),
            session.journal_summary(),
            session.event_status(key).unwrap(),
            session.selection(key).unwrap(),
            session.stored_marks(key).unwrap().map(<[_]>::to_vec)
        ),
        before
    );
    let event = changed(session.dispatch(Transaction::new(
        key,
        0,
        vec![Operation::SetAttribute {
            node: document.into(),
            key: "title".into(),
            value: Some(Attribute::String("new".into())),
        }],
    )));
    assert_eq!(event.revision, 1);
    assert!(session.dirty());
    assert_eq!(path(&session, &[0]), document);
    assert_eq!(path(&session, &[0, 0, 0]), leaf);
    let expected =
        include_str!("../../../contracts/notes/v1/expected/N005-highlight-only.canonical.json")
            .replace("\"title\":\"\"", "\"title\":\"new\"");
    assert_eq!(
        session.export_snapshot(key, 1).unwrap(),
        expected.as_bytes()
    );
}

#[test]
fn work_or_normalization_exhaustion_preserves_current_state_and_retry() {
    for exhaust_normalization in [false, true] {
        let mut session = open();
        let key = session.key();
        let paragraph = path(&session, &[0, 0]);
        let leaf = path(&session, &[0, 0, 0]);
        let initial = session.export_snapshot(key, 0).unwrap();
        let before = (
            session.stamp(),
            session.history_summary(),
            session.journal_summary(),
            session.event_status(key).unwrap(),
        );
        let mut transaction = Transaction::new(
            key,
            0,
            vec![Operation::InsertFragment {
                parent: paragraph.into(),
                index: 1,
                fragment: Document {
                    children: vec![Node {
                        type_id: TEXT.into(),
                        primitive: Primitive::Text,
                        attributes: Attributes::new(),
                        marks: session.node(key, leaf).unwrap().marks().to_vec(),
                        text: Some("y".into()),
                        children: vec![],
                    }],
                },
            }],
        );
        if exhaust_normalization {
            transaction.limits.normalization_passes = 0;
        } else {
            transaction.limits.work = WorkLimits { units: 0, bytes: 0 };
        }
        assert!(matches!(
            session.dispatch(transaction),
            DispatchOutcome::Refused { .. }
        ));
        assert_eq!(session.export_snapshot(key, 0).unwrap(), initial);
        assert_eq!(
            (
                session.stamp(),
                session.history_summary(),
                session.journal_summary(),
                session.event_status(key).unwrap()
            ),
            before
        );
        changed(session.dispatch(Transaction::new(
            key,
            0,
            vec![Operation::SetAttribute {
                node: path(&session, &[0]).into(),
                key: "title".into(),
                value: Some(Attribute::String("retry".into())),
            }],
        )));
    }
}
