// SPDX-License-Identifier: MIT OR Apache-2.0
//! Bounded seeded restoration with a prebuilt paragraph-string oracle.
//! This shared native/WASM lane is not the broad fuzz/performance gate OSR-38.

use super::{Calls, Counted, canonical, expected, facets, ids, open};
use editor_core::positions::{Affinity, Edge, Position, Selection};
use editor_engine::{
    CommandAvailability, CommandOutcome, CommandRequest, DispatchOutcome, HistoryAvailability,
    HistoryDirection, HistoryOutcome, HistoryRequest, NodeId, Session,
};
use editor_kwdj::commands::KwdjIntent;
use serde_json::{Value, json};

const SEQUENCES: u64 = 32;
const TOKENS: [&str; 10] = [
    "a",
    "Ж",
    "e\u{301}",
    "👩\u{200d}💻",
    " ",
    "\u{a0}",
    "日本",
    "🙂",
    "é",
    "x",
];

#[derive(Clone, Copy)]
enum Action {
    Insert(&'static str),
    Enter,
}
struct State {
    paragraphs: Vec<String>,
    canonical: String,
    paragraph: usize,
    utf16: usize,
}
struct Sequence {
    seed: u64,
    actions: Vec<Action>,
    states: Vec<State>,
}
fn wire(paragraphs: &[String]) -> Value {
    let content = paragraphs
        .iter()
        .map(|text| {
            if text.is_empty() {
                json!({"type":"paragraph","content":[]})
            } else {
                json!({"type":"paragraph","content":[{"type":"text","text":text}]})
            }
        })
        .collect::<Vec<_>>();
    json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":content})
}
fn state(paragraphs: &[String]) -> State {
    let canonical = expected(&wire(paragraphs));
    let decoded: Value = serde_json::from_str(&canonical).unwrap();
    let literal_text = decoded["content"]
        .as_array()
        .unwrap()
        .iter()
        .map(|paragraph| {
            assert_eq!(paragraph["type"], "paragraph");
            paragraph["content"]
                .as_array()
                .map(|nodes| {
                    nodes
                        .iter()
                        .map(|node| {
                            assert_eq!(node["type"], "text");
                            node["text"].as_str().unwrap()
                        })
                        .collect::<String>()
                })
                .unwrap_or_default()
        })
        .collect::<Vec<_>>();
    assert_eq!(
        literal_text, paragraphs,
        "fixture codec must preserve literal SPACE/NBSP/decomposed/non-BMP strings"
    );
    State {
        paragraphs: paragraphs.to_vec(),
        canonical,
        paragraph: paragraphs.len() - 1,
        utf16: paragraphs.last().unwrap().encode_utf16().count(),
    }
}
fn next(seed: &mut u64) -> u64 {
    *seed = seed
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    *seed
}
fn generate(seed: u64) -> Sequence {
    let mut random = seed;
    let length = 6 + (seed % 5) as usize;
    let mut actions = Vec::with_capacity(length);
    let mut paragraphs = vec![String::new()];
    let mut states = vec![state(&paragraphs)];
    for index in 0..length {
        let value = next(&mut random);
        // Every sequence has typing and at least one Enter. Enter never acts
        // on an empty last block. Seeded tokens cover exact SPACE/NBSP/Unicode.
        let enter = index == 2 || (index > 2 && value.is_multiple_of(4));
        let action = if enter && !paragraphs.last().unwrap().is_empty() {
            Action::Enter
        } else {
            let token = if index == 0 {
                TOKENS[(seed as usize - 1) % TOKENS.len()]
            } else {
                TOKENS[((value >> 11) % TOKENS.len() as u64) as usize]
            };
            Action::Insert(token)
        };
        // This pure model interpreter runs before any Session is opened. Its
        // expected documents never use observed export or replay output.
        match action {
            Action::Insert(token) => paragraphs.last_mut().unwrap().push_str(token),
            Action::Enter => paragraphs.push(String::new()),
        }
        actions.push(action);
        states.push(state(&paragraphs));
    }
    assert!(actions.iter().any(|action| matches!(action, Action::Enter)));
    Sequence {
        seed,
        actions,
        states,
    }
}

fn point(session: &Session<Counted>, position: Position<NodeId>) -> (usize, usize, Affinity) {
    let root = session.root(session.key()).unwrap();
    let roots = session.node(session.key(), root).unwrap().children();
    let node = session.node(session.key(), position.node()).unwrap();
    let (parent, child, local, affinity) = match position {
        Position::Text {
            leaf,
            utf16,
            affinity,
        } => (node.parent().unwrap(), Some(leaf), utf16.get(), affinity),
        Position::Child {
            parent,
            index,
            affinity,
        } => (parent, None, index, affinity),
        Position::Edge { node: id, side } => {
            if let Some(text) = node.text() {
                (
                    node.parent().unwrap(),
                    Some(id),
                    if side == Edge::Before {
                        0
                    } else {
                        text.encode_utf16().count()
                    },
                    position.affinity(),
                )
            } else {
                let children = node.children();
                assert!(
                    roots.contains(&id),
                    "generated selection edge must address a paragraph"
                );
                (
                    id,
                    None,
                    if side == Edge::Before {
                        0
                    } else {
                        children.len()
                    },
                    position.affinity(),
                )
            }
        }
    };
    let paragraph = roots.iter().position(|id| *id == parent).unwrap();
    let children = session.node(session.key(), parent).unwrap().children();
    let mut total = 0usize;
    for (index, id) in children.iter().enumerate() {
        if child.is_none() && local == index {
            return (paragraph, total, affinity);
        }
        let text = session.node(session.key(), *id).unwrap().text().unwrap();
        let length = text.encode_utf16().count();
        if child == Some(*id) {
            assert!(local <= length);
            return (paragraph, total + local, affinity);
        }
        total += length;
    }
    assert!(child.is_none() && local == children.len());
    (paragraph, total, affinity)
}
fn check(
    session: &Session<Counted>,
    calls: &Calls,
    oracle: &State,
    revision: u64,
    undo: usize,
    redo: usize,
    dirty: bool,
) {
    let before = calls.0.get();
    assert_eq!(
        canonical(session),
        oracle.canonical,
        "independent seeded document oracle"
    );
    let mut expected_calls = before;
    expected_calls[2] += 1;
    expected_calls[3] += 1;
    assert_eq!(
        calls.0.get(),
        expected_calls,
        "only explicit checkpoint hooks may run"
    );
    let selection = session.selection(session.key()).unwrap().unwrap();
    let expected_point = (oracle.paragraph, oracle.utf16, Affinity::After);
    assert_eq!(point(session, selection.anchor), expected_point);
    assert_eq!(point(session, selection.focus), expected_point);
    assert_eq!(session.stored_marks(session.key()).unwrap(), None);
    assert_eq!(session.revision(), revision);
    assert_eq!(session.dirty(), dirty);
    let history = session.history_summary();
    assert_eq!((history.undo_units, history.redo_units), (undo, redo));
    assert_eq!((history.undo_members, history.redo_members), (undo, redo));
    assert_eq!(
        (history.evicted_undo_units, history.evicted_redo_units),
        (0, 0)
    );
    assert_eq!(session.journal_summary().entries, revision as usize);
    assert_eq!(session.journal_summary().evicted, 0);
}
fn command(session: &mut Session<Counted>, calls: &Calls, action: &Action) {
    let intent = match action {
        Action::Insert(token) => KwdjIntent::InsertText {
            text: (*token).into(),
        },
        Action::Enter => KwdjIntent::Enter,
    };
    let mut request = CommandRequest::new(
        session.key(),
        session.revision(),
        session.selection_epoch(),
        intent,
    );
    request.history_epoch = Some(session.history_summary().epoch);
    let before = facets(session);
    let count = calls.0.get();
    let query = session.query_command(&request);
    assert_eq!(
        before,
        facets(session),
        "generated command query changed facets"
    );
    assert_eq!(query, session.query_command(&request));
    assert_eq!(before, facets(session));
    let outcome = session.execute_command(&request);
    assert_eq!(
        calls.0.get(),
        count,
        "generated ordinary command used codec"
    );
    match (query, outcome) {
        (
            CommandAvailability::Available {
                presentation,
                effect,
                selection_changed,
                stored_marks_changed,
                work,
            },
            CommandOutcome::Completed {
                presentation: actual,
                outcome: DispatchOutcome::Changed(event),
            },
        ) => {
            assert_eq!(presentation, actual);
            assert_eq!(effect, editor_engine::commands::CommandEffect::Changed);
            assert_eq!(work, event.work);
            assert_eq!(
                selection_changed,
                before.selection != session.selection(session.key()).unwrap()
            );
            assert_eq!(
                stored_marks_changed,
                before.marks
                    != session
                        .stored_marks(session.key())
                        .unwrap()
                        .map(<[_]>::to_vec)
            );
            assert_eq!(event.revision, before.revision + 1);
            assert!(
                event.work.units <= request.limits.work.units
                    && event.work.bytes <= request.limits.work.bytes
            );
        }
        other => panic!("generated actual document action refused or became noop: {other:?}"),
    }
}
fn replay(session: &mut Session<Counted>, calls: &Calls, direction: HistoryDirection) {
    let request = HistoryRequest::new(
        session.key(),
        session.revision(),
        session.selection_epoch(),
        session.history_summary().epoch,
        direction,
    );
    let before = facets(session);
    let count = calls.0.get();
    let query = session.query_history(&request);
    assert_eq!(
        before,
        facets(session),
        "generated history query changed facets"
    );
    assert_eq!(query, session.query_history(&request));
    assert_eq!(before, facets(session));
    let outcome = session.execute_history(&request);
    assert_eq!(calls.0.get(), count, "generated ordinary replay used codec");
    match (query, outcome) {
        (
            HistoryAvailability::Available {
                selection_changed,
                stored_marks_changed,
                work,
            },
            HistoryOutcome::Completed(event),
        ) => {
            assert_eq!(work, event.work);
            assert_eq!(
                selection_changed,
                before.selection != session.selection(session.key()).unwrap()
            );
            assert_eq!(
                stored_marks_changed,
                before.marks
                    != session
                        .stored_marks(session.key())
                        .unwrap()
                        .map(<[_]>::to_vec)
            );
            assert_eq!(event.revision, before.revision + 1);
            assert!(
                event.work.units <= request.limits.work.units
                    && event.work.bytes <= request.limits.work.bytes
            );
        }
        other => panic!("generated restoration diverged: {other:?}"),
    }
}
fn run(sequence: Sequence) -> Value {
    let length = sequence.actions.len();
    let (mut session, calls) = open(&wire(&sequence.states[0].paragraphs));
    let admission_calls = calls.0.get();
    let first = session
        .node(session.key(), session.root(session.key()).unwrap())
        .unwrap()
        .children()[0];
    let initial = Position::Child {
        parent: first,
        index: 0,
        affinity: Affinity::After,
    };
    session
        .set_selection(
            session.key(),
            0,
            Selection {
                anchor: initial,
                focus: initial,
            },
        )
        .unwrap();
    let mut identities = vec![ids(&session)];
    let mut selections = vec![session.selection(session.key()).unwrap()];
    let mut records = vec![facets(&session).records];
    check(&session, &calls, &sequence.states[0], 0, 0, 0, false);
    for (index, action) in sequence.actions.iter().enumerate() {
        command(&mut session, &calls, action);
        let state = index + 1;
        check(
            &session,
            &calls,
            &sequence.states[state],
            state as u64,
            state,
            0,
            true,
        );
        identities.push(ids(&session));
        selections.push(session.selection(session.key()).unwrap());
        records.push(facets(&session).records);
    }
    for count in 1..=length {
        replay(&mut session, &calls, HistoryDirection::Undo);
        let state = length - count;
        check(
            &session,
            &calls,
            &sequence.states[state],
            (length + count) as u64,
            state,
            count,
            true,
        );
        assert_eq!(
            ids(&session),
            identities[state],
            "undo must restore original opaque ID set"
        );
        assert_eq!(session.selection(session.key()).unwrap(), selections[state]);
        assert_eq!(facets(&session).records, records[state]);
    }
    for count in 1..=length {
        replay(&mut session, &calls, HistoryDirection::Redo);
        check(
            &session,
            &calls,
            &sequence.states[count],
            (2 * length + count) as u64,
            count,
            length - count,
            true,
        );
        assert_eq!(
            ids(&session),
            identities[count],
            "redo must revive exact original commit identities"
        );
        assert_eq!(session.selection(session.key()).unwrap(), selections[count]);
        assert_eq!(facets(&session).records, records[count]);
    }
    let checkpoints = 1 + 3 * length;
    let mut expected_calls = admission_calls;
    expected_calls[2] += checkpoints as u64;
    expected_calls[3] += checkpoints as u64;
    assert_eq!(
        calls.0.get(),
        expected_calls,
        "ordinary paths used snapshot/admission/canonical hooks"
    );
    let inserts = sequence
        .actions
        .iter()
        .filter(|action| matches!(action, Action::Insert(_)))
        .count();
    let enters = length - inserts;
    json!({"seed":sequence.seed,"status":"passed","steps":length,"insert_actions":inserts,"enter_actions":enters,"undo_actions":length,"redo_actions":length,"independent_checkpoint_total":checkpoints,"final_paragraphs":sequence.states.last().unwrap().paragraphs,"query_execute_equal":true,"query_preserves_all_facets":true,"exact_historical_records_ids_selection":true,"ordinary_snapshot_codec_calls":0})
}

pub(super) fn observe() -> Value {
    // Build ALL expected states before executing ANY Session sequence.
    let sequences = (1..=SEQUENCES).map(generate).collect::<Vec<_>>();
    for token in TOKENS {
        assert!(
            sequences.iter().any(|sequence| sequence
                .actions
                .iter()
                .any(|action| matches!(action, Action::Insert(actual) if *actual == token))),
            "every literal token must occur in an actual generated action"
        );
    }
    let rows = sequences.into_iter().map(run).collect::<Vec<_>>();
    let actions = rows
        .iter()
        .map(|row| row["steps"].as_u64().unwrap())
        .sum::<u64>();
    let checkpoints = rows
        .iter()
        .map(|row| row["independent_checkpoint_total"].as_u64().unwrap())
        .sum::<u64>();
    assert_eq!(actions, 255);
    assert_eq!(checkpoints, 797);
    json!({"status":"passed","sequence_total":SEQUENCES,"minimum_steps":6,"maximum_steps":10,"apply_actions":actions,"undo_actions":actions,"redo_actions":actions,"independent_checkpoint_total":checkpoints,"ordinary_snapshot_codec_calls":0,"oracle":"Prebuilt seeded pure Vec<String> paragraph interpreter; exact literal Unicode/SPACE/NBSP and UTF16 end caret. Captured opaque identities are restoration invariants, never document oracles.","scope":"Bounded generated restoration; broader fuzz/performance OSR-38 remains separate.","cases":rows})
}

#[cfg(test)]
mod tests {
    #[test]
    fn seeded_generated_history_restores_all_independent_checkpoints() {
        let value = super::observe();
        assert_eq!(value["sequence_total"], 32);
        assert_eq!(value["apply_actions"], 255);
        assert_eq!(value["independent_checkpoint_total"], 797);
    }
}
