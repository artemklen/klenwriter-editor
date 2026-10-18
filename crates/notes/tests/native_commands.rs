// SPDX-License-Identifier: MIT OR Apache-2.0
mod support;

use editor_core::document::{Attribute, Attributes, Mark};
use editor_core::positions::{Affinity, Edge, Position, Selection, Utf16Offset};
use editor_core::profile::{AdmissionMode, FrozenProfile};
use editor_engine::{
    AccessMode, CommandAvailability, CommandEffect, CommandError, CommandOutcome, CommandRequest,
    DispatchOutcome, HistoryAvailability, HistoryDirection, HistoryOutcome, HistoryRequest, NodeId,
    Session, TransactionError,
};
use klenwriter_editor_notes::{NativeNotesIntent, NotesProfile};
use serde_json::{Value, json};

fn node_path(session: &Session<NotesProfile>, indices: &[Value]) -> NodeId {
    let key = session.key();
    let mut id = session
        .node(key, session.root(key).unwrap())
        .unwrap()
        .children()[0];
    for index in indices {
        id = session.node(key, id).unwrap().children()[index.as_u64().unwrap() as usize];
    }
    id
}
fn position(session: &Session<NotesProfile>, value: &Value) -> Position<NodeId> {
    let node = node_path(session, value["path"].as_array().unwrap());
    match value["kind"].as_str().unwrap() {
        "text" => Position::Text {
            leaf: node,
            utf16: Utf16Offset::new(value["offset"].as_u64().unwrap() as usize),
            affinity: if value["affinity"] == "before" {
                Affinity::Before
            } else {
                Affinity::After
            },
        },
        "child" => Position::Child {
            parent: node,
            index: value["index"].as_u64().unwrap() as usize,
            affinity: if value["affinity"] == "before" {
                Affinity::Before
            } else {
                Affinity::After
            },
        },
        "edge" => Position::Edge {
            node,
            side: if value["side"] == "before" {
                Edge::Before
            } else {
                Edge::After
            },
        },
        _ => panic!("invalid authored point"),
    }
}
fn selection(session: &Session<NotesProfile>, value: &Value) -> Option<Selection<NodeId>> {
    (!value.is_null()).then(|| Selection {
        anchor: position(session, &value["anchor"]),
        focus: position(session, &value["focus"]),
    })
}
fn marks(value: &Value) -> Option<Vec<Mark>> {
    value.as_array().map(|marks| {
        marks
            .iter()
            .map(|mark| Mark {
                type_id: mark["type"].as_str().unwrap().into(),
                attributes: mark["attrs"]
                    .as_object()
                    .unwrap()
                    .iter()
                    .map(|(key, value)| {
                        (
                            key.clone(),
                            Attribute::String(value.as_str().unwrap().into()),
                        )
                    })
                    .collect::<Attributes>(),
            })
            .collect()
    })
}
fn ids(session: &Session<NotesProfile>) -> Vec<NodeId> {
    let key = session.key();
    let mut pending = vec![session.root(key).unwrap()];
    let mut output = vec![];
    while let Some(id) = pending.pop() {
        output.push(id);
        pending.extend(session.node(key, id).unwrap().children().iter().rev());
    }
    output
}
fn facts(session: &Session<NotesProfile>) -> impl PartialEq + std::fmt::Debug + use<> {
    let key = session.key();
    (
        session.stamp(),
        session.dirty(),
        session.selection(key).unwrap(),
        session.stored_marks(key).unwrap().map(<[_]>::to_vec),
        session.journal_summary(),
        session.history_summary(),
        session.event_status(key).unwrap(),
        ids(session),
        session.export_snapshot(key, session.revision()).unwrap(),
    )
}
fn request(
    session: &Session<NotesProfile>,
    intent: NativeNotesIntent,
) -> CommandRequest<NativeNotesIntent> {
    CommandRequest::new(
        session.key(),
        session.revision(),
        session.selection_epoch(),
        intent,
    )
}
fn replay(session: &mut Session<NotesProfile>, direction: HistoryDirection) {
    let req = HistoryRequest::new(
        session.key(),
        session.revision(),
        session.selection_epoch(),
        session.history_summary().epoch,
        direction,
    );
    let before = facts(session);
    let query = session.query_history(&req);
    assert_eq!(facts(session), before, "history query pure");
    let query_work = match query {
        HistoryAvailability::Available { work, .. } => work,
        other => panic!("history unavailable: {other:?}"),
    };
    match session.execute_history(&req) {
        HistoryOutcome::Completed(event) => assert_eq!(event.work, query_work),
        other => panic!("history refused: {other:?}"),
    }
}

#[test]
fn all_eighteen_frozen_native_command_literals_query_execute_and_history() {
    let fixture: Value = serde_json::from_slice(include_bytes!(
        "../../../contracts/notes/v1/commands/vectors.json"
    ))
    .unwrap();
    let mut count = 0;
    for case in fixture["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let profile = support::profile(true);
        let binding = profile.binding().clone();
        let mut session = Session::open(
            profile,
            &binding,
            case["input"].as_str().unwrap().as_bytes(),
            AdmissionMode::Strict,
            AccessMode::Editable,
        )
        .unwrap();
        let key = session.key();
        if let Some(sel) = selection(&session, &case["selection"]) {
            session.set_selection(key, 0, sel).unwrap();
        }
        if let Some(marks) = marks(&case["storedMarks"]) {
            match session.set_typing_marks(
                key,
                0,
                session.selection_epoch(),
                session.history_summary().epoch,
                Some(marks),
            ) {
                DispatchOutcome::Unchanged { .. } => {}
                other => panic!("{id}: typing setup refused: {other:?}"),
            }
        }
        let before = facts(&session);
        let before_selection = session.selection(key).unwrap();
        let before_marks = session.stored_marks(key).unwrap().map(<[_]>::to_vec);
        let before_ids = ids(&session);
        let before_events = session.event_status(key).unwrap().head.sequence();
        let body = &case["command"]["payload"];
        let intent = match case["command"]["id"].as_str().unwrap() {
            "org.example.notes/command/insert-text" => NativeNotesIntent::InsertText {
                text: body["text"].as_str().unwrap().into(),
            },
            "org.example.notes/command/set-title" => NativeNotesIntent::SetTitle {
                title: body["title"].as_str().unwrap().into(),
            },
            "org.example.notes/command/set-tags" => NativeNotesIntent::SetTags {
                tags: body["tags"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|s| s.as_str().unwrap().into())
                    .collect(),
            },
            _ => panic!("unknown authored command"),
        };
        let req = request(&session, intent);
        let query = session.query_command(&req);
        for _ in 0..4 {
            assert_eq!(session.query_command(&req), query, "{id}: repeat query");
            assert_eq!(facts(&session), before, "{id}: query all facets pure");
        }
        let outcome = session.execute_command(&req);
        let expected = &case["expected"];
        match (expected["kind"].as_str().unwrap(), query, outcome) {
            (
                "changed",
                CommandAvailability::Available {
                    work,
                    effect: CommandEffect::Changed,
                    ..
                },
                CommandOutcome::Completed {
                    outcome: DispatchOutcome::Changed(event),
                    ..
                },
            ) => {
                assert_eq!(event.work, work, "{id}: query/execution work");
                assert_eq!(event.revision, 1, "{id}");
            }
            (
                "unchanged",
                CommandAvailability::Available {
                    work,
                    effect: CommandEffect::Unchanged,
                    ..
                },
                CommandOutcome::Completed {
                    outcome: DispatchOutcome::Unchanged { work: actual, .. },
                    ..
                },
            ) => {
                assert_eq!(actual, work, "{id}");
                assert_eq!(facts(&session), before, "{id}: true no-op");
            }
            (
                "refused",
                CommandAvailability::Unavailable {
                    reason,
                    error,
                    work,
                },
                CommandOutcome::Refused {
                    reason: actual,
                    error: actual_error,
                    work: actual_work,
                },
            ) => {
                assert_eq!(reason, expected["code"].as_str().unwrap(), "{id}");
                assert_eq!(actual, reason, "{id}");
                assert_eq!(actual_error, error, "{id}: same typed refusal");
                assert_eq!(actual_work, work, "{id}");
                if let Some(path) = expected["path"].as_str() {
                    match error {
                        CommandError::Transaction(TransactionError::Profile(error)) => {
                            assert_eq!(error.path, path, "{id}")
                        }
                        other => panic!("{id}: expected profile pointer: {other:?}"),
                    }
                }
                assert_eq!(facts(&session), before, "{id}: refusal all facets");
            }
            (_, query, outcome) => panic!("{id}: mismatch query={query:?},actual={outcome:?}"),
        }
        assert_eq!(
            session.export_snapshot(key, session.revision()).unwrap(),
            expected["canonical"].as_str().unwrap().as_bytes(),
            "{id}: literal bytes"
        );
        let expected_selection = if expected["selection"] == "same_as_before" {
            before_selection
        } else {
            selection(&session, &expected["selection"])
        };
        assert_eq!(
            session.selection(key).unwrap(),
            expected_selection,
            "{id}: literal caret"
        );
        assert_eq!(
            session.stored_marks(key).unwrap().map(<[_]>::to_vec),
            marks(&expected["storedMarks"]),
            "{id}: exact typing state"
        );
        assert_eq!(
            session.revision(),
            expected["documentRevisionDelta"].as_u64().unwrap(),
            "{id}"
        );
        assert_eq!(
            session.history_summary().undo_units as u64,
            expected["historyUnitDelta"].as_u64().unwrap(),
            "{id}"
        );
        assert_eq!(
            session.event_status(key).unwrap().head.sequence() - before_events,
            expected["events"].as_u64().unwrap(),
            "{id}"
        );
        if expected["kind"] == "changed" {
            replay(&mut session, HistoryDirection::Undo);
            assert_eq!(
                session.export_snapshot(key, session.revision()).unwrap(),
                case["input"].as_str().unwrap().as_bytes(),
                "{id}: literal undo"
            );
            assert_eq!(
                ids(&session),
                before_ids,
                "{id}: exact original IDs revived"
            );
            assert_eq!(
                session.selection(key).unwrap(),
                before_selection,
                "{id}: undo selection"
            );
            assert_eq!(
                session.stored_marks(key).unwrap().map(<[_]>::to_vec),
                before_marks,
                "{id}: undo marks"
            );
            replay(&mut session, HistoryDirection::Redo);
            assert_eq!(
                session.export_snapshot(key, session.revision()).unwrap(),
                expected["canonical"].as_str().unwrap().as_bytes(),
                "{id}: literal redo"
            );
            assert_eq!(
                session.selection(key).unwrap(),
                expected_selection,
                "{id}: redo caret"
            );
        }
        count += 1;
    }
    assert_eq!(count, 18);
}

#[test]
fn runtime_single_text_grammar_accepts_edit_after_lossless_join_normalization() {
    use editor_core::transaction::{WorkLimits, WorkMeter};
    use editor_registry::{CompilerLimits, ExtensionIdentity};
    let mut descriptor = support::descriptor(false);
    descriptor.extensions.push(serde_json::from_value(json!({
        "id":"org.example.widgets/lines","version":"1.0.0",
        "dependencies":[{"id":"org.example.notes/base","version":"1.0.0"}],
        "nodes":[{"id":"org.example.widgets/line","primitive":"text_block","attrs":{},
            "children":{"op":"type","id":"org.example.notes/text"},"marks":[]}],"marks":[],"commands":[]
    })).unwrap());
    descriptor.selected_extensions.push(ExtensionIdentity {
        id: "org.example.widgets/lines".into(),
        version: "1.0.0".into(),
    });
    let profile = NotesProfile::compile(
        &descriptor,
        &[
            "org.example.notes/paragraph".into(),
            "org.example.widgets/line".into(),
        ],
        klenwriter_editor_notes::NotesLimits::default(),
        CompilerLimits::default(),
        &mut WorkMeter::new(WorkLimits::default()),
    )
    .unwrap();
    let binding = profile.binding().clone();
    let input=br#"{"root":{"attrs":{"tags":[],"title":"typed"},"children":[{"attrs":{},"children":[{"attrs":{},"children":[],"marks":[],"text":"ab","type":"org.example.notes/text"}],"marks":[],"text":null,"type":"org.example.widgets/line"}],"marks":[],"text":null,"type":"org.example.notes/document"},"schema_version":1}"#;
    let expected=br#"{"root":{"attrs":{"tags":[],"title":"typed"},"children":[{"attrs":{},"children":[{"attrs":{},"children":[],"marks":[],"text":"axb","type":"org.example.notes/text"}],"marks":[],"text":null,"type":"org.example.widgets/line"}],"marks":[],"text":null,"type":"org.example.notes/document"},"schema_version":1}"#;
    let mut session = Session::open(
        profile,
        &binding,
        input,
        AdmissionMode::Strict,
        AccessMode::Editable,
    )
    .unwrap();
    let key = session.key();
    let leaf = node_path(&session, &[json!(0), json!(0)]);
    let caret = Position::Text {
        leaf,
        utf16: Utf16Offset::new(1),
        affinity: Affinity::After,
    };
    session
        .set_selection(
            key,
            0,
            Selection {
                anchor: caret,
                focus: caret,
            },
        )
        .unwrap();
    let request = request(&session, NativeNotesIntent::InsertText { text: "x".into() });
    let query = session.query_command(&request);
    let outcome = session.execute_command(&request);
    assert!(
        matches!(
            query,
            CommandAvailability::Available {
                effect: CommandEffect::Changed,
                ..
            }
        ),
        "query:{query:?}; outcome:{outcome:?}"
    );
    assert!(
        matches!(
            outcome,
            CommandOutcome::Completed {
                outcome: DispatchOutcome::Changed(_),
                ..
            }
        ),
        "{outcome:?}"
    );
    assert_eq!(session.export_snapshot(key, 1).unwrap(), expected);
    replay(&mut session, HistoryDirection::Undo);
    assert_eq!(
        session.export_snapshot(key, session.revision()).unwrap(),
        input
    );
    replay(&mut session, HistoryDirection::Redo);
    assert_eq!(
        session.export_snapshot(key, session.revision()).unwrap(),
        expected
    );
}
