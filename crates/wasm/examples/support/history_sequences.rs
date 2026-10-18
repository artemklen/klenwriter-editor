// SPDX-License-Identifier: MIT OR Apache-2.0
//! Real KWDJ sequences driven by independently authored checkpoints, not replay output.
use super::*;
use editor_core::document::{Attribute, Node, Primitive};
use editor_core::positions::{Affinity, Edge, Utf16Offset};
use editor_engine::history::{HistoryDirection, HistoryHint, TypingClass};
use editor_engine::{
    CommandAvailability, CommandOutcome, CommandRequest, DispatchOutcome, HistoryAvailability,
    HistoryOutcome, HistoryRequest, NodeRef, SelectionUpdate, SessionKey, Transaction,
    TransactionLimits,
};
use editor_kwdj::commands::BlockTarget;
use std::collections::BTreeMap;

struct Run {
    s: Session<Counted>,
    calls: Calls,
    names: BTreeMap<String, NodeId>,
    seen: BTreeMap<String, Vec<Record>>,
    limits: TransactionLimits,
    old_key: Option<SessionKey>,
}
fn text(id: NodeId, n: usize, a: Affinity) -> Position<NodeId> {
    Position::Text {
        leaf: id,
        utf16: Utf16Offset::new(n),
        affinity: a,
    }
}
fn local(p: Position<NodeId>) -> Position<NodeRef> {
    match p {
        Position::Text {
            leaf,
            utf16,
            affinity,
        } => Position::Text {
            leaf: leaf.into(),
            utf16,
            affinity,
        },
        Position::Child {
            parent,
            index,
            affinity,
        } => Position::Child {
            parent: parent.into(),
            index,
            affinity,
        },
        Position::Edge { node, side } => Position::Edge {
            node: node.into(),
            side,
        },
    }
}
fn local_selection(s: Selection<NodeId>) -> Selection<NodeRef> {
    Selection {
        anchor: local(s.anchor),
        focus: local(s.focus),
    }
}
fn caret(p: Position<NodeRef>) -> SelectionUpdate {
    SelectionUpdate::Set(Some(Selection {
        anchor: p.clone(),
        focus: p,
    }))
}
fn created(operation: usize, path: &[usize]) -> NodeRef {
    NodeRef::Created {
        operation,
        path: path.to_vec(),
    }
}
fn wire(content: Value) -> Value {
    json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":content})
}
impl Run {
    fn bind(&mut self, name: &str, path: &[usize]) {
        let id = at(&self.s, path);
        if let Some(old) = self.names.insert(name.into(), id) {
            assert_eq!(old, id, "historical binding {name}");
        }
    }
    fn name(&self, name: &str) -> NodeId {
        self.names[name]
    }
    fn point(&self, raw: &str) -> Position<NodeId> {
        let parts = raw[2..raw.len() - 1].split(',').collect::<Vec<_>>();
        let id = self.name(parts[0]);
        match &raw[..1] {
            "T" => text(
                id,
                parts[1].parse().unwrap(),
                if parts[2] == "A" {
                    Affinity::After
                } else {
                    Affinity::Before
                },
            ),
            "C" => Position::Child {
                parent: id,
                index: parts[1].parse().unwrap(),
                affinity: if parts[2] == "A" {
                    Affinity::After
                } else {
                    Affinity::Before
                },
            },
            "E" => Position::Edge {
                node: id,
                side: if parts[1] == "After" {
                    Edge::After
                } else {
                    Edge::Before
                },
            },
            _ => panic!("bad literal point {raw}"),
        }
    }
    fn selection(&self, raw: &str) -> Option<Selection<NodeId>> {
        if raw == "none" {
            return None;
        }
        if raw.starts_with("R(") {
            let inside = &raw[2..raw.len() - 1];
            let split = inside.find("),").unwrap() + 1;
            Some(Selection {
                anchor: self.point(&inside[..split]),
                focus: self.point(&inside[split + 1..]),
            })
        } else {
            let p = self.point(raw);
            Some(Selection {
                anchor: p,
                focus: p,
            })
        }
    }
    fn navigate(&mut self, selection: Option<Selection<NodeId>>) {
        self.s
            .set_selection(
                self.s.key(),
                self.s.revision(),
                selection.expect("fixture navigation has a selection"),
            )
            .unwrap();
    }
    fn command(
        &mut self,
        intent: KwdjIntent<NodeId>,
        hint: HistoryHint,
        query_only: bool,
    ) -> &'static str {
        let mut request = CommandRequest::new(
            self.s.key(),
            self.s.revision(),
            self.s.selection_epoch(),
            intent,
        );
        request.history_epoch = Some(self.s.history_summary().epoch);
        request.history_hint = hint;
        request.limits = self.limits;
        let before = facets(&self.s);
        let calls = self.calls.0.get();
        let q = self.s.query_command(&request);
        assert_eq!(calls, self.calls.0.get());
        assert_eq!(before, facets(&self.s));
        if query_only {
            return "QueryOnly";
        }
        let calls = self.calls.0.get();
        let outcome = self.s.execute_command(&request);
        assert_eq!(calls, self.calls.0.get());
        match (q, outcome) {
            (
                CommandAvailability::Available {
                    work,
                    selection_changed,
                    stored_marks_changed,
                    ..
                },
                CommandOutcome::Completed { outcome, .. },
            ) => {
                let changed_selection = before.selection != self.s.selection(self.s.key()).unwrap();
                let changed_marks = before.marks
                    != self
                        .s
                        .stored_marks(self.s.key())
                        .unwrap()
                        .map(<[Mark]>::to_vec);
                assert_eq!(selection_changed, changed_selection);
                assert_eq!(stored_marks_changed, changed_marks);
                match outcome {
                    DispatchOutcome::Changed(e) => {
                        assert_eq!(e.work, work);
                        "Changed"
                    }
                    DispatchOutcome::Unchanged { work: w, .. } => {
                        assert_eq!(work, w);
                        if changed_selection || changed_marks {
                            "StateOnly"
                        } else {
                            "Unchanged"
                        }
                    }
                    other => panic!("available command refused: {other:?}"),
                }
            }
            (
                CommandAvailability::Unavailable {
                    reason,
                    work,
                    error,
                },
                CommandOutcome::Refused {
                    reason: r, work: w, ..
                },
            ) => {
                eprintln!("command refused {reason}: {error:?}");
                assert_eq!(reason, r);
                assert_eq!(work, w);
                assert_eq!(before, facets(&self.s));
                "Refused"
            }
            other => panic!("query/execution differ: {other:?}"),
        }
    }
    fn raw(
        &mut self,
        operations: Vec<Operation<NodeRef>>,
        selection: SelectionUpdate,
        hint: HistoryHint,
    ) -> &'static str {
        let mut tx = Transaction::new(self.s.key(), self.s.revision(), operations);
        tx.selection_epoch = Some(self.s.selection_epoch());
        tx.history_epoch = Some(self.s.history_summary().epoch);
        tx.history_hint = hint;
        tx.selection = selection;
        tx.limits = self.limits;
        let before = facets(&self.s);
        let calls = self.calls.0.get();
        let result = self.s.dispatch(tx);
        assert_eq!(calls, self.calls.0.get(), "ordinary dispatch codec");
        match result {
            DispatchOutcome::Changed(_) => "Changed",
            DispatchOutcome::Unchanged {
                selection_changed,
                stored_marks_changed,
                ..
            } => {
                if selection_changed || stored_marks_changed {
                    "StateOnly"
                } else {
                    "Unchanged"
                }
            }
            DispatchOutcome::Refused { .. } => {
                assert_eq!(before, facets(&self.s));
                "Refused"
            }
        }
    }
    fn history(&mut self, direction: HistoryDirection) -> &'static str {
        let mut request = HistoryRequest::new(
            self.s.key(),
            self.s.revision(),
            self.s.selection_epoch(),
            self.s.history_summary().epoch,
            direction,
        );
        request.limits = self.limits;
        let before = facets(&self.s);
        let calls = self.calls.0.get();
        let q = self.s.query_history(&request);
        assert_eq!(calls, self.calls.0.get());
        assert_eq!(before, facets(&self.s));
        let calls = self.calls.0.get();
        let out = self.s.execute_history(&request);
        assert_eq!(calls, self.calls.0.get());
        match (q, out) {
            (
                HistoryAvailability::Available {
                    work,
                    selection_changed,
                    stored_marks_changed,
                },
                HistoryOutcome::Completed(e),
            ) => {
                assert_eq!(work, e.work);
                assert_eq!(
                    selection_changed,
                    before.selection != self.s.selection(self.s.key()).unwrap()
                );
                assert_eq!(
                    stored_marks_changed,
                    before.marks
                        != self
                            .s
                            .stored_marks(self.s.key())
                            .unwrap()
                            .map(<[Mark]>::to_vec)
                );
                "Changed"
            }
            (
                HistoryAvailability::Unavailable { reason, work, .. },
                HistoryOutcome::Refused {
                    reason: r, work: w, ..
                },
            ) => {
                assert_eq!(reason, r);
                assert_eq!(work, w);
                assert_eq!(before, facets(&self.s));
                "Refused"
            }
            other => panic!("history query/replay differ {other:?}"),
        }
    }
    fn typed(&mut self, text: &str, grouped: bool) -> &'static str {
        self.command(
            KwdjIntent::InsertText { text: text.into() },
            if grouped {
                HistoryHint::Typing {
                    token: 17,
                    class: TypingClass::Insert,
                }
            } else {
                HistoryHint::Isolated
            },
            false,
        )
    }
    fn replace(
        &mut self,
        from: usize,
        to: usize,
        inserted: &str,
        hint: HistoryHint,
    ) -> &'static str {
        self.raw(
            vec![Operation::ReplaceText {
                leaf: self.name("t").into(),
                from: Utf16Offset::new(from),
                to: Utf16Offset::new(to),
                inserted: inserted.into(),
            }],
            SelectionUpdate::MapCurrent,
            hint,
        )
    }
    fn check(&mut self, row: &Value, documents: &Value, id: &str, step: usize) {
        let reference = row[1].as_str().unwrap();
        assert_eq!(
            canonical(&self.s),
            expected(&documents[reference]),
            "literal doc {id}/{step}"
        );
        assert_eq!(
            self.s.selection(self.s.key()).unwrap(),
            self.selection(row[2].as_str().unwrap()),
            "literal selection {id}/{step}"
        );
        let marks = match row[3].as_str().unwrap() {
            "inherit" => None,
            "plain" => Some(vec![]),
            "strong" => Some(vec![mark("strong")]),
            _ => panic!("unknown marks"),
        };
        assert_eq!(
            self.s
                .stored_marks(self.s.key())
                .unwrap()
                .map(<[Mark]>::to_vec),
            marks,
            "literal marks {id}/{step}"
        );
        assert_eq!(
            self.s.revision(),
            row[4].as_str().unwrap().parse::<u64>().unwrap(),
            "revision {id}/{step}"
        );
        let summary = self.s.history_summary();
        assert_eq!(
            summary.undo_units,
            row[6].as_u64().unwrap() as usize,
            "undo units {id}/{step}"
        );
        assert_eq!(
            summary.redo_units,
            row[7].as_u64().unwrap() as usize,
            "redo units {id}/{step}"
        );
        let current_ids = facets(&self.s).records;
        if let Some(before) = self.seen.get(reference) {
            assert_eq!(
                *before, current_ids,
                "exact historical identities {id}/{step}"
            );
        } else {
            self.seen.insert(reference.into(), current_ids);
        }
    }
}
fn bind_initial(r: &mut Run, id: &str) {
    match id {
        "H03" => {
            r.bind("p", &[0]);
            for (name, index) in [("w", 0), ("m", 1), ("j", 2), ("bang", 3)] {
                r.bind(name, &[0, index]);
            }
        }
        "H13" => {
            r.bind("p", &[0]);
            r.bind("a", &[0, 0]);
        }
        "H17" => {
            r.bind("p", &[0]);
            r.bind("t", &[0, 0]);
            r.bind("r", &[0, 1]);
        }
        "H18" => {
            r.bind("o", &[0]);
            r.bind("t", &[0, 0, 0, 0]);
        }
        "H19" => {
            r.bind("p", &[0, 0, 0]);
            r.bind("t", &[0, 0, 0, 0]);
        }
        "H25" => {
            r.bind("q", &[0]);
            r.bind("p", &[0, 0]);
            r.bind("t", &[0, 0, 0]);
        }
        "H28" => {
            r.bind("p", &[0]);
            r.bind("e", &[0, 0]);
            r.bind("ac", &[0, 1]);
            r.bind("bang", &[0, 2]);
        }
        "H29" => {
            r.bind("p", &[0]);
            r.bind("a", &[0, 0]);
            r.bind("b", &[0, 1]);
            r.bind("bang", &[0, 2]);
        }
        "H30" => {
            r.bind("p", &[0]);
            for (name, index) in [("a", 0), ("e", 1), ("ac", 2), ("b", 3)] {
                r.bind(name, &[0, index]);
            }
        }
        _ => {
            r.bind("p", &[0]);
            if !r
                .s
                .node(r.s.key(), r.name("p"))
                .unwrap()
                .children()
                .is_empty()
            {
                r.bind("t", &[0, 0]);
            }
        }
    }
}
fn bind_results(r: &mut Run, id: &str, step: usize) {
    match id {
        "H04" | "H05" | "H06" | "H20" if step == 0 => r.bind("t", &[0, 0]),
        "H05" if step == 2 => r.bind("v", &[0, 0]),
        "H06" if step == 2 || step == 6 => r.bind("u", &[0, 1]),
        "H07" if step == 1 || step == 3 => r.bind("u", &[0, 1]),
        "H12" if step == 0 || step == 2 => r.bind("y", &[1, 0]),
        "H15" if step == 0 || step == 2 => r.bind("suffix", &[2, 0]),
        "H19" if step == 0 || step == 2 => r.bind("right", &[0, 1, 0, 0]),
        "H25" if step == 0 || step == 2 => r.bind("t2", &[1, 0, 0]),
        "H27" if step == 0 || step == 2 => r.bind("u", &[1, 0, 0]),
        "H29" if step == 0 || step == 2 => r.bind("br", &[0, 0]),
        _ => {}
    }
}
fn apply(r: &mut Run, id: &str, step: usize, intent: &str) -> &'static str {
    if intent == "undo" || intent == "history undo" {
        return r.history(HistoryDirection::Undo);
    }
    if intent == "redo"
        || intent == "history redo"
        || intent == "redo unavailable"
        || intent == "undo unavailable"
    {
        return r.history(if intent.starts_with("undo") {
            HistoryDirection::Undo
        } else {
            HistoryDirection::Redo
        });
    }
    match id {
        "H01" => r.typed("\u{301}", false),
        "H02" => r.typed(" test", false),
        "H03" => r.command(
            KwdjIntent::ToggleMark {
                mark: mark("strike"),
            },
            HistoryHint::Isolated,
            false,
        ),
        "H04" => r.typed(["a", "b", "c"][step], true),
        "H05" => match step {
            0 => r.typed("a", true),
            1 => {
                r.navigate(Some(Selection {
                    anchor: text(r.name("t"), 0, Affinity::After),
                    focus: text(r.name("t"), 0, Affinity::After),
                }));
                "StateOnly"
            }
            2 => r.typed("b", true),
            _ => panic!(),
        },
        "H06" => match step {
            0 => r.typed("a", true),
            1 => r.command(
                KwdjIntent::ToggleMark {
                    mark: mark("strong"),
                },
                HistoryHint::Isolated,
                false,
            ),
            2 => r.typed("b", true),
            _ => panic!(),
        },
        "H07" => {
            if step == 0 {
                r.command(
                    KwdjIntent::ToggleMark {
                        mark: mark("strong"),
                    },
                    HistoryHint::Isolated,
                    false,
                )
            } else {
                r.typed("b", false)
            }
        }
        "H08" => {
            if step == 0 {
                let p = text(r.name("t"), 0, Affinity::After);
                r.navigate(Some(Selection {
                    anchor: p,
                    focus: p,
                }));
                "StateOnly"
            } else {
                r.command(
                    KwdjIntent::ToggleMark {
                        mark: mark("strong"),
                    },
                    HistoryHint::Isolated,
                    false,
                )
            }
        }
        "H09" => match step {
            0 => r.typed("", false),
            1 => r.raw(
                vec![
                    Operation::ReplaceText {
                        leaf: r.name("t").into(),
                        from: Utf16Offset::new(1),
                        to: Utf16Offset::new(1),
                        inserted: "X".into(),
                    },
                    Operation::SetAttribute {
                        node: r.name("p").into(),
                        key: "unregistered_field".into(),
                        value: Some(Attribute::Boolean(true)),
                    },
                ],
                SelectionUpdate::MapCurrent,
                HistoryHint::Isolated,
            ),
            2 => r.command(
                KwdjIntent::InsertText { text: "X".into() },
                HistoryHint::Isolated,
                true,
            ),
            _ => panic!(),
        },
        "H10" => r.typed("X", false),
        "H11" => r.typed("日本語", false),
        "H12" => {
            let f = fragment(&wire(
                json!([{"type":"paragraph","content":[{"type":"text","text":"X"}]},{"type":"paragraph","content":[{"type":"text","text":"Y"}]}]),
            ));
            r.raw(
                vec![
                    Operation::Remove {
                        node: r.name("p").into(),
                    },
                    Operation::InsertFragment {
                        parent: r.s.root(r.s.key()).unwrap().into(),
                        index: 0,
                        fragment: f,
                    },
                ],
                caret(Position::Text {
                    leaf: created(1, &[1, 0]),
                    utf16: Utf16Offset::new(1),
                    affinity: Affinity::After,
                }),
                HistoryHint::Isolated,
            )
        }
        "H13" => r.raw(
            vec![Operation::Move {
                node: r.name("p").into(),
                parent: r.s.root(r.s.key()).unwrap().into(),
                before_index: 3,
            }],
            SelectionUpdate::MapCurrent,
            HistoryHint::Isolated,
        ),
        "H14" => r.raw(
            vec![
                Operation::ReplaceText {
                    leaf: r.name("t").into(),
                    from: Utf16Offset::new(2),
                    to: Utf16Offset::new(2),
                    inserted: ".".into(),
                },
                Operation::ReplaceText {
                    leaf: r.name("t").into(),
                    from: Utf16Offset::new(0),
                    to: Utf16Offset::new(3),
                    inserted: "…".into(),
                },
            ],
            SelectionUpdate::MapCurrent,
            HistoryHint::Isolated,
        ),
        "H15" => {
            let t = r.name("t");
            r.command(
                KwdjIntent::AcceptSlash {
                    target: BlockTarget::SceneBreak,
                    range: Selection {
                        anchor: text(t, 4, Affinity::After),
                        focus: text(t, 10, Affinity::Before),
                    },
                    literal: "/scene".into(),
                },
                HistoryHint::Isolated,
                false,
            )
        }
        "H16" => r.replace(1, 1, "\r\n", HistoryHint::Isolated),
        "H17" => r.raw(
            vec![Operation::SetMarks {
                leaf: r.name("r").into(),
                marks: vec![],
            }],
            SelectionUpdate::MapCurrent,
            HistoryHint::Isolated,
        ),
        "H18" => r.raw(
            vec![Operation::SetAttribute {
                node: r.name("o").into(),
                key: "start".into(),
                value: Some(Attribute::Number(1.into())),
            }],
            SelectionUpdate::MapCurrent,
            HistoryHint::Isolated,
        ),
        "H19" => r.command(KwdjIntent::Enter, HistoryHint::Isolated, false),
        "H20" => r.typed(["a", "b", "c"][step], false),
        "H21" => {
            r.limits = TransactionLimits::default();
            if step == 0 {
                r.limits.work.units = 0;
            } else if step == 1 {
                r.limits.history.chronological_entries = 0;
            } else {
                r.limits.history.chronological_entries = 1;
            }
            r.history(if step == 3 {
                HistoryDirection::Undo
            } else {
                HistoryDirection::Redo
            })
        }
        "H22" => match step {
            0 => {
                let before = facets(&r.s);
                assert!(
                    r.s.remount(
                        r.s.key(),
                        &r.s.binding().clone(),
                        b"{}",
                        AdmissionMode::Strict,
                        AccessMode::Editable
                    )
                    .is_err()
                );
                assert_eq!(before, facets(&r.s));
                "Refused"
            }
            1 => {
                let old = r.s.key();
                let bytes = serde_json::to_vec(&wire(
                    json!([{"type":"paragraph","content":[{"type":"text","text":"a"}]}]),
                ))
                .unwrap();
                r.s.remount(
                    old,
                    &r.s.binding().clone(),
                    &bytes,
                    AdmissionMode::Strict,
                    AccessMode::Editable,
                )
                .unwrap();
                assert_ne!(old, r.s.key());
                r.old_key = Some(old);
                r.names.clear();
                r.seen.clear();
                bind_initial(r, id);
                "Remounted"
            }
            2 => {
                let q = HistoryRequest::new(
                    r.old_key.unwrap(),
                    2,
                    r.s.selection_epoch(),
                    r.s.history_summary().epoch,
                    HistoryDirection::Redo,
                );
                let before = facets(&r.s);
                assert!(matches!(
                    r.s.execute_history(&q),
                    HistoryOutcome::Refused { .. }
                ));
                assert_eq!(before, facets(&r.s));
                "Refused"
            }
            _ => panic!(),
        },
        "H24" => r.replace(
            1,
            2,
            if step == 0 { "X" } else { "b" },
            HistoryHint::Typing {
                token: 17,
                class: TypingClass::Insert,
            },
        ),
        "H25" => r.raw(
            vec![Operation::Duplicate {
                node: r.name("q").into(),
                parent: r.s.root(r.s.key()).unwrap().into(),
                index: 1,
            }],
            caret(Position::Text {
                leaf: created(0, &[0, 0, 0]),
                utf16: Utf16Offset::new(1),
                affinity: Affinity::After,
            }),
            HistoryHint::Isolated,
        ),
        "H26" => r.raw(
            vec![
                Operation::Transform {
                    node: r.name("p").into(),
                    type_id: format!("{PREFIX}heading"),
                    primitive: Primitive::TextBlock,
                },
                Operation::SetAttribute {
                    node: r.name("p").into(),
                    key: "level".into(),
                    value: Some(Attribute::Number(2.into())),
                },
            ],
            SelectionUpdate::MapCurrent,
            HistoryHint::Isolated,
        ),
        "H27" => {
            let f = fragment(&wire(
                json!([{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"B","marks":[{"type":"emphasis"}]}]}]}]),
            ));
            r.raw(
                vec![Operation::InsertFragment {
                    parent: r.s.root(r.s.key()).unwrap().into(),
                    index: 1,
                    fragment: f,
                }],
                caret(Position::Text {
                    leaf: created(0, &[0, 0, 0]),
                    utf16: Utf16Offset::new(0),
                    affinity: Affinity::After,
                }),
                HistoryHint::Isolated,
            )
        }
        "H28" => r.raw(
            vec![Operation::PatchMarkRange {
                range: local_selection(r.s.selection(r.s.key()).unwrap().unwrap()),
                edits: vec![editor_core::transaction::MarkEdit::Upsert(mark("emphasis"))],
            }],
            SelectionUpdate::MapCurrent,
            HistoryHint::Isolated,
        ),
        "H29" => r.raw(
            vec![Operation::ReplaceInlineRange {
                range: local_selection(r.s.selection(r.s.key()).unwrap().unwrap()),
                inserted: Some(Node {
                    type_id: format!("{PREFIX}hard_break"),
                    primitive: Primitive::HardBreak,
                    attributes: Attributes::new(),
                    marks: vec![],
                    text: None,
                    children: vec![],
                }),
            }],
            caret(Position::Edge {
                node: created(0, &[0]),
                side: Edge::After,
            }),
            HistoryHint::Isolated,
        ),
        "H30" => r.raw(
            vec![Operation::MoveInlineGroup {
                nodes: vec![r.name("e").into(), r.name("ac").into()],
                parent: r.name("p").into(),
                before_index: 4,
            }],
            SelectionUpdate::MapCurrent,
            HistoryHint::Isolated,
        ),
        _ => panic!("unhandled independent case {id}/{step}: {intent}"),
    }
}
fn run(case: &Value, docs: &Value) -> Value {
    let id = case["id"].as_str().unwrap();
    let before = &case["before"];
    let reference = before[0].as_str().unwrap();
    let (s, calls) = open(&docs[reference]);
    let mut r = Run {
        s,
        calls,
        names: BTreeMap::new(),
        seen: BTreeMap::new(),
        limits: TransactionLimits::default(),
        old_key: None,
    };
    bind_initial(&mut r, id);
    let initial_selection = r.selection(before[1].as_str().unwrap());
    r.navigate(initial_selection);
    if matches!(id, "H08" | "H09" | "H10" | "H21" | "H22") {
        assert_eq!(r.typed("b", false), "Changed");
        assert_eq!(r.history(HistoryDirection::Undo), "Changed");
    }
    if id == "H22" {
        for _ in 0..2 {
            assert_eq!(
                r.command(
                    KwdjIntent::ToggleMark {
                        mark: mark("strong")
                    },
                    HistoryHint::Isolated,
                    false
                ),
                "StateOnly"
            );
        }
    }
    if id == "H20" {
        r.limits.history.actions = 2;
    }
    assert_eq!(canonical(&r.s), expected(&docs[reference]));
    assert_eq!(
        r.s.revision(),
        before[3].as_str().unwrap().parse::<u64>().unwrap()
    );
    r.seen.insert(reference.into(), facets(&r.s).records);
    let mut checkpoints = vec![];
    for (step, row) in case["steps"].as_array().unwrap().iter().enumerate() {
        let actual = apply(&mut r, id, step, row[0].as_str().unwrap());
        let want = row[5].as_str().unwrap();
        assert!(
            actual == want || (actual == "Refused" && want == "Unavailable"),
            "outcome {id}/{step}: {actual} != {want}"
        );
        bind_results(&mut r, id, step);
        r.check(row, docs, id, step);
        if want == "Changed" {
            assert!(r.s.dirty());
        }
        if id == "H21" && step >= 2 {
            assert!(matches!(
                r.s.map_position(r.s.key(), 0, text(r.name("t"), 1, Affinity::After))
                    .unwrap(),
                editor_engine::mapping::MapResult::Stale
            ));
        }
        checkpoints.push(json!({"document":canonical(&r.s),"selection_literal":row[2],"stored_marks_literal":row[3],"revision":r.s.revision().to_string(),"undo_units":r.s.history_summary().undo_units,"redo_units":r.s.history_summary().redo_units}));
    }
    json!({"id":id,"status":"passed","checkpoints":checkpoints,"query_execute_work_equal":true,"query_preserves_all_facets":true,"exact_historical_id_sets":true,"ordinary_snapshot_codec_calls":0})
}
pub fn observe_one(id: &str) -> Value {
    let spec: Value = serde_json::from_str(LITERALS).unwrap();
    let case = spec["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .unwrap();
    run(case, &spec["documents"])
}
#[allow(dead_code)]
pub fn observe() -> Value {
    let spec: Value = serde_json::from_str(LITERALS).unwrap();
    let rows = spec["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["id"] != "H23")
        .map(|case| run(case, &spec["documents"]))
        .collect::<Vec<_>>();
    assert_eq!(rows.len(), 29);
    json!({"status":"passed","literal_total":29,"literal_passed":29,"cases":rows,"scope":"Actual real-profile KWDJ main literal checkpoints; private counters reported by separate engine gate. Supplemental grouping/epoch/HP-only/aggregate witnesses are separate groups."})
}

fn empty_run() -> Run {
    let (s, calls) = open(&wire(json!([{"type":"paragraph","content":[]}])));
    let mut r = Run {
        s,
        calls,
        names: BTreeMap::new(),
        seen: BTreeMap::new(),
        limits: TransactionLimits::default(),
        old_key: None,
    };
    r.bind("p", &[0]);
    let p = Position::Child {
        parent: r.name("p"),
        index: 0,
        affinity: Affinity::After,
    };
    r.navigate(Some(Selection {
        anchor: p,
        focus: p,
    }));
    r
}
fn assert_checkpoint(r: &Run, contents: &str, revision: u64, undo: usize, redo: usize) {
    let content = if contents.is_empty() {
        json!([{"type":"paragraph","content":[]}])
    } else {
        json!([{"type":"paragraph","content":[{"type":"text","text":contents}]}])
    };
    assert_eq!(canonical(&r.s), expected(&wire(content)));
    assert_eq!(r.s.revision(), revision);
    assert_eq!(
        (
            r.s.history_summary().undo_units,
            r.s.history_summary().redo_units
        ),
        (undo, redo)
    );
    let p = if contents.is_empty() {
        Position::Child {
            parent: r.name("p"),
            index: 0,
            affinity: Affinity::After,
        }
    } else {
        text(
            r.name("t"),
            contents.encode_utf16().count(),
            Affinity::After,
        )
    };
    assert_eq!(
        r.s.selection(r.s.key()).unwrap(),
        Some(Selection {
            anchor: p,
            focus: p
        })
    );
    assert_eq!(r.s.stored_marks(r.s.key()).unwrap(), None);
}
pub fn observe_supplements() -> Value {
    let mut capped = empty_run();
    let original = ids(&capped.s);
    capped.limits.history.members_per_unit = 2;
    for (i, chunk) in ["a", "b", "c"].iter().enumerate() {
        if i == 1 {
            let before = facets(&capped.s);
            let selection = capped.s.selection(capped.s.key()).unwrap().unwrap();
            capped
                .s
                .set_selection(capped.s.key(), capped.s.revision(), selection)
                .unwrap();
            assert_eq!(
                facets(&capped.s),
                before,
                "identical typed Selection must preserve open group and every facet"
            );
        }
        assert_eq!(capped.typed(chunk, true), "Changed");
        if i == 0 {
            capped.bind("t", &[0, 0]);
        }
        assert_checkpoint(
            &capped,
            ["a", "ab", "abc"][i],
            i as u64 + 1,
            if i == 2 { 2 } else { 1 },
            0,
        );
    }
    let final_ids = ids(&capped.s);
    for (direction, doc, rev, u, r) in [
        (HistoryDirection::Undo, "ab", 4, 1, 1),
        (HistoryDirection::Undo, "", 5, 0, 2),
        (HistoryDirection::Redo, "ab", 6, 1, 1),
        (HistoryDirection::Redo, "abc", 7, 2, 0),
    ] {
        assert_eq!(capped.history(direction), "Changed");
        assert_checkpoint(&capped, doc, rev, u, r);
        if doc.is_empty() {
            assert_eq!(ids(&capped.s), original);
        } else {
            assert_eq!(ids(&capped.s), final_ids);
        }
    }
    let mut epoch = empty_run();
    assert_eq!(epoch.s.selection_epoch(), 1);
    assert_eq!(epoch.s.history_summary().epoch, 0);
    assert_eq!(epoch.typed("a", true), "Changed");
    epoch.bind("t", &[0, 0]);
    assert_checkpoint(&epoch, "a", 1, 1, 0);
    assert_eq!(epoch.s.selection_epoch(), 2);
    assert_eq!(epoch.s.history_summary().epoch, 1);
    let stale = HistoryRequest::new(epoch.s.key(), 1, 2, 1, HistoryDirection::Undo);
    let before = facets(&epoch.s);
    let calls = epoch.calls.0.get();
    let sealed = epoch
        .s
        .seal_history(
            epoch.s.key(),
            1,
            2,
            1,
            editor_core::transaction::WorkLimits::default(),
        )
        .unwrap();
    assert!(sealed.changed);
    assert_eq!(sealed.history.epoch, 2);
    let mut expected_before = before;
    expected_before.history = epoch.s.history_summary();
    assert_eq!(facets(&epoch.s), expected_before);
    assert_eq!(epoch.calls.0.get(), calls);
    let stable = facets(&epoch.s);
    let q = epoch.s.query_history(&stale);
    assert_eq!(stable, facets(&epoch.s));
    let out = epoch.s.execute_history(&stale);
    match (q, out) {
        (
            HistoryAvailability::Unavailable { reason, work, .. },
            HistoryOutcome::Refused {
                reason: r, work: w, ..
            },
        ) => {
            assert_eq!(reason, "session.stale_history_epoch");
            assert_eq!(reason, r);
            assert_eq!(work, w);
        }
        other => panic!("stale history guard {other:?}"),
    }
    assert_eq!(stable, facets(&epoch.s));
    let sealed_again = epoch
        .s
        .seal_history(
            epoch.s.key(),
            1,
            2,
            2,
            editor_core::transaction::WorkLimits::default(),
        )
        .unwrap();
    assert!(!sealed_again.changed);
    assert_eq!(stable, facets(&epoch.s));
    assert_eq!(epoch.typed("", true), "Unchanged");
    assert_eq!(stable, facets(&epoch.s));
    assert_eq!(epoch.history(HistoryDirection::Undo), "Changed");
    assert_checkpoint(&epoch, "", 2, 0, 1);
    assert_eq!(epoch.s.history_summary().epoch, 3);
    assert_eq!(epoch.s.selection_epoch(), 3);
    assert_eq!(epoch.history(HistoryDirection::Redo), "Changed");
    assert_checkpoint(&epoch, "a", 3, 1, 0);
    assert_eq!(epoch.s.history_summary().epoch, 4);
    assert_eq!(epoch.s.selection_epoch(), 4);
    // A genuine whole-group late budget refusal and retry. The numeric limit is
    // deliberately zero: this does not claim the separate generic cost-Q proof.
    let mut budget = empty_run();
    for c in ["a", "b", "c"] {
        assert_eq!(budget.typed(c, true), "Changed");
    }
    budget.bind("t", &[0, 0]);
    let before = facets(&budget.s);
    budget.limits.work.bytes = 0;
    assert_eq!(budget.history(HistoryDirection::Undo), "Refused");
    assert_eq!(before, facets(&budget.s));
    budget.limits = TransactionLimits::default();
    assert_eq!(budget.history(HistoryDirection::Undo), "Changed");
    assert_checkpoint(&budget, "", 4, 0, 1);
    json!({"status":"passed","groups":[{"id":"member_cap_seal_start","status":"passed","host_member_cap":2,"identical_typed_selection_navigation_is_noop":true,"commits":3,"replays":4,"historical_ids_restored":true},{"id":"history_epoch_boundary","status":"passed","history_epochs":["0","1","2","2","2","2","3","4"],"stale_history_only_reason":"session.stale_history_epoch","setup_context_epoch":"1","query_execute_work_equal":true,"all_facets_preserved_on_refusal":true},{"id":"whole_group_low_budget_retry","status":"passed","members":3,"work_bytes":0,"atomic_refusal":true,"sufficient_budget_retry":true,"scope":"Zero-byte bound; generic known-cost per-member-fit aggregate proof is separate engine evidence."}]})
}
pub fn observe_lifecycle() -> Value {
    let mut cases = vec![];
    for (label, reason) in [
        ("closed", "session.closed"),
        ("poisoned", "session.poisoned"),
    ] {
        let mut r = empty_run();
        assert_eq!(r.typed("a", false), "Changed");
        r.bind("t", &[0, 0]);
        let request = HistoryRequest::new(
            r.s.key(),
            1,
            r.s.selection_epoch(),
            r.s.history_summary().epoch,
            HistoryDirection::Undo,
        );
        let before = facets(&r.s);
        if label == "closed" {
            r.s.close(r.s.key()).unwrap();
        } else {
            r.s.poison(r.s.key()).unwrap();
        }
        let state = r.s.state();
        let calls = r.calls.0.get();
        let q = r.s.query_history(&request);
        let out = r.s.execute_history(&request);
        match (q, out) {
            (
                HistoryAvailability::Unavailable {
                    reason: a, work, ..
                },
                HistoryOutcome::Refused {
                    reason: b, work: w, ..
                },
            ) => {
                assert_eq!(a, reason);
                assert_eq!(b, reason);
                assert_eq!(work, w);
            }
            other => panic!("lifecycle refusal {other:?}"),
        }
        assert_eq!(r.s.state(), state);
        assert_eq!(r.s.revision(), before.revision);
        assert_eq!(r.s.selection_epoch(), before.context);
        assert_eq!(r.s.history_summary(), before.history);
        assert_eq!(r.s.journal_summary(), before.journal);
        assert_eq!(r.s.journal_entries(), before.entries);
        assert_eq!(r.s.dirty(), before.dirty);
        assert_eq!(r.calls.0.get(), calls);
        cases.push(json!({"id":label,"status":"passed","reason":reason,"query_execute_work_equal":true,"public_retention_counters_unchanged":true,"scope":"Post-close/poison graph and selection reads are guarded; private all-field lifecycle checks are separate engine evidence."}));
    }
    let v = wire(json!([{"type":"paragraph","content":[{"type":"text","text":"a"}]}]));
    let calls = Calls::default();
    let p = Counted {
        inner: profile(),
        calls: calls.clone(),
    };
    let b = p.binding().clone();
    let mut s = Session::open(
        p,
        &b,
        &serde_json::to_vec(&v).unwrap(),
        AdmissionMode::Strict,
        AccessMode::ReadOnly,
    )
    .unwrap();
    let before = facets(&s);
    let counters = calls.0.get();
    let q = HistoryRequest::new(s.key(), 0, 0, 0, HistoryDirection::Undo);
    match (s.query_history(&q), s.execute_history(&q)) {
        (
            HistoryAvailability::Unavailable { reason, work, .. },
            HistoryOutcome::Refused {
                reason: r, work: w, ..
            },
        ) => {
            assert_eq!(reason, "session.read_only");
            assert_eq!(reason, r);
            assert_eq!(work, w);
        }
        other => panic!("read-only refusal {other:?}"),
    };
    assert_eq!(before, facets(&s));
    assert_eq!(calls.0.get(), counters);
    cases.push(json!({"id":"read_only","status":"passed","reason":"session.read_only","all_facets_preserved":true}));
    json!({"status":"passed","case_total":3,"cases":cases,"ordinary_snapshot_codec_calls":0})
}
pub fn observe_generated() -> Value {
    // Independent literal string pairs include exact SPACE/NBSP, combining marks,
    // Cyrillic, surrogate pairs and ZWJ. Each insertion is one isolated public command.
    let pairs = [
        ("a", "b"),
        (" ", "\u{a0}"),
        ("e\u{301}", "!"),
        ("Я", "ё"),
        ("👩‍💻", "🙂"),
        ("\u{a0}", " "),
        ("𐐀", "z"),
        ("..", "…"),
    ];
    let mut cases = vec![];
    for (first, second) in pairs {
        let mut r = empty_run();
        let original = ids(&r.s);
        assert_eq!(r.typed(first, false), "Changed");
        r.bind("t", &[0, 0]);
        let first_ids = ids(&r.s);
        assert_checkpoint(&r, first, 1, 1, 0);
        assert_eq!(r.typed(second, false), "Changed");
        let combined = format!("{first}{second}");
        assert_checkpoint(&r, &combined, 2, 2, 0);
        assert_eq!(ids(&r.s), first_ids);
        assert_eq!(r.history(HistoryDirection::Undo), "Changed");
        assert_checkpoint(&r, first, 3, 1, 1);
        assert_eq!(ids(&r.s), first_ids);
        assert_eq!(r.history(HistoryDirection::Undo), "Changed");
        assert_checkpoint(&r, "", 4, 0, 2);
        assert_eq!(ids(&r.s), original);
        assert_eq!(r.history(HistoryDirection::Redo), "Changed");
        assert_checkpoint(&r, first, 5, 1, 1);
        assert_eq!(ids(&r.s), first_ids);
        assert_eq!(r.history(HistoryDirection::Redo), "Changed");
        assert_checkpoint(&r, &combined, 6, 2, 0);
        assert_eq!(ids(&r.s), first_ids);
        cases.push(json!({"first":first,"second":second,"final_text":combined,"final_revision":"6","status":"passed"}));
    }
    json!({"status":"passed","case_total":8,"cases":cases,"replays":32,"oracle":"Independent literal Unicode/SPACE/NBSP pairs, exact caret UTF16 length and revisions; no replay-derived snapshot oracle.","query_execute_work_equal":true,"historical_ids_restored":true,"ordinary_snapshot_codec_calls":0})
}

pub fn observe_recurrence() -> Value {
    // Independent literal mutable KWDJ attribute fixture; generic note=A/B from
    // the preliminary plan is concretized as the admitted heading.level1/2.
    let heading = |level: u64| {
        wire(
            json!([{"type":"heading","attrs":{"level":level},"content":[{"type":"text","text":"a"}]}]),
        )
    };
    // This history steady-state witness bounds every retained stream to one
    // record. Default outbox warmup/eviction is covered by the delta/event lane.
    let (s, calls) = open_with_event_limits(
        &heading(1),
        EventLimits {
            records: 1,
            ..EventLimits::default()
        },
    );
    let mut r = Run {
        s,
        calls,
        names: BTreeMap::new(),
        seen: BTreeMap::new(),
        limits: TransactionLimits::default(),
        old_key: None,
    };
    r.bind("p", &[0]);
    r.bind("t", &[0, 0]);
    let p = text(r.name("t"), 1, Affinity::After);
    r.navigate(Some(Selection {
        anchor: p,
        focus: p,
    }));
    r.limits.history.actions = 1;
    r.limits.history.chronological_entries = 1;
    r.limits.work.bytes = 32 * 1024;
    let original = ids(&r.s);
    let expected_one = expected(&heading(1));
    let expected_two = expected(&heading(2));
    let mut last_level = 1;
    let mut steady = [None; 3];
    fn phase(
        r: &Run,
        cycle: u64,
        index: usize,
        work: editor_core::transaction::WorkUsage,
        steady: &mut [Option<(editor_core::transaction::WorkUsage, usize, usize)>; 3],
    ) {
        assert!(work.units <= r.limits.work.units && work.bytes <= r.limits.work.bytes);
        let history = r.s.history_summary();
        let journal = r.s.journal_summary();
        assert!(history.undo_units + history.redo_units <= 1);
        assert!(history.retained_bytes <= r.limits.history.aggregate_bytes);
        assert!(journal.entries <= 1);
        assert!(journal.bytes <= r.limits.journal_bytes);
        let cost = (work, history.retained_bytes, journal.bytes);
        if cycle >= 2 {
            if let Some(expected) = steady[index] {
                assert_eq!(cost, expected, "steady phase {index} cycle {cycle}");
            } else {
                steady[index] = Some(cost);
            }
        }
    }
    fn queried_work(r: &Run, direction: HistoryDirection) -> editor_core::transaction::WorkUsage {
        let mut request = HistoryRequest::new(
            r.s.key(),
            r.s.revision(),
            r.s.selection_epoch(),
            r.s.history_summary().epoch,
            direction,
        );
        request.limits = r.limits;
        let before = facets(&r.s);
        let count = r.calls.0.get();
        let work = match r.s.query_history(&request) {
            HistoryAvailability::Available { work, .. } => work,
            other => panic!("recurrence query {other:?}"),
        };
        assert_eq!(facets(&r.s), before);
        assert_eq!(r.calls.0.get(), count);
        work
    }
    for cycle in 0..512 {
        let next = if cycle % 2 == 0 { 2 } else { 1 };
        let previous = if last_level == 1 {
            &expected_one
        } else {
            &expected_two
        };
        let target = if next == 1 {
            &expected_one
        } else {
            &expected_two
        };
        let mut tx = Transaction::new(
            r.s.key(),
            r.s.revision(),
            vec![Operation::SetAttribute {
                node: r.name("p").into(),
                key: "level".into(),
                value: Some(Attribute::Number(next.into())),
            }],
        );
        tx.selection_epoch = Some(r.s.selection_epoch());
        tx.history_epoch = Some(r.s.history_summary().epoch);
        tx.limits = r.limits;
        let count = r.calls.0.get();
        let work = match r.s.dispatch(tx) {
            DispatchOutcome::Changed(event) => event.work,
            other => panic!("recurrence commit {other:?}"),
        };
        assert_eq!(r.calls.0.get(), count);
        phase(&r, cycle, 0, work, &mut steady);
        assert_eq!(canonical(&r.s), *target);
        assert_eq!(r.s.revision(), cycle * 3 + 1);
        assert_eq!(r.s.history_summary().undo_units, 1);
        assert_eq!(r.s.history_summary().redo_units, 0);
        assert_eq!(ids(&r.s), original);
        let work = queried_work(&r, HistoryDirection::Undo);
        assert_eq!(r.history(HistoryDirection::Undo), "Changed");
        phase(&r, cycle, 1, work, &mut steady);
        assert_eq!(canonical(&r.s), *previous);
        assert_eq!(r.s.revision(), cycle * 3 + 2);
        assert_eq!(r.s.history_summary().undo_units, 0);
        assert_eq!(r.s.history_summary().redo_units, 1);
        assert_eq!(ids(&r.s), original);
        let work = queried_work(&r, HistoryDirection::Redo);
        assert_eq!(r.history(HistoryDirection::Redo), "Changed");
        phase(&r, cycle, 2, work, &mut steady);
        assert_eq!(canonical(&r.s), *target);
        assert_eq!(r.s.revision(), cycle * 3 + 3);
        assert_eq!(r.s.history_summary().undo_units, 1);
        assert_eq!(r.s.history_summary().redo_units, 0);
        assert_eq!(ids(&r.s), original);
        assert_eq!(
            r.s.selection(r.s.key()).unwrap(),
            Some(Selection {
                anchor: p,
                focus: p
            })
        );
        assert_eq!(r.s.stored_marks(r.s.key()).unwrap(), None);
        assert!(r.s.journal_summary().entries <= 1);
        last_level = next;
    }
    assert_eq!(canonical(&r.s), expected_one);
    assert_eq!(r.s.revision(), 1536);
    json!({"status":"passed","cycles":512,"document_publications":1536,"final_revision":"1536","final_heading_level":1,"action_cap":1,"chronological_map_cap":1,"event_record_cap":1,"work_byte_cap":32768,"all_historical_ids_stable":true,"warmup_cycles":2,"steady_cycles":510,"steady_phase_work_and_retention_equal":true,"query_execute_work_equal":true,"ordinary_snapshot_codec_calls":0,"scope":"Bounded history recurrence with real KWDJ heading attributes; one retained event isolates history steady state, default outbox covered separately; per-target32KiB work bound, no OSR38 performance claim."})
}
