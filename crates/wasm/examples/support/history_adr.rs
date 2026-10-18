// SPDX-License-Identifier: MIT OR Apache-2.0
//! Actual generic Session history against unchanged ADR literals. No KWDJ policy.
//! Fifteen contracts embed directly; one declared wrapper has a full physical oracle.
use editor_core::candidate::CandidateRead;
use editor_core::document::{Attributes, Document, Mark, Node, Primitive};
use editor_core::history::HistoryProfile;
use editor_core::positions::{Affinity, Edge, Position, Selection, Utf16Offset};
use editor_core::profile::{AdmissionMode, FrozenProfile, ProfileBinding};
use editor_core::transaction::TransactionProfile;
use editor_core::transaction::{Operation, ValidationStats, WorkMeter};
use editor_engine::history::HistoryDirection;
use editor_engine::{
    AccessMode, DispatchOutcome, HistoryAvailability, HistoryOutcome, HistoryRequest, NodeId,
    Session, Transaction,
};
use serde_json::{Value, json};
use std::{cell::Cell, collections::BTreeMap, rc::Rc};

const SEEDS: &str = include_str!("../../../../evidence/osr-59/operation-vectors.json");
const EMBEDDING: &str = include_str!("../../../../contracts/history/v1/adr-embedding.json");
const PREFIX: &str = "org.example.history/";
#[derive(Clone, Default)]
struct Calls(Rc<Cell<[usize; 4]>>);
impl Calls {
    fn bump(&self, i: usize) {
        let mut v = self.0.get();
        v[i] += 1;
        self.0.set(v);
    }
}
struct Admitted {
    document: Document,
    canonical: Vec<u8>,
}
struct SeedProfile {
    binding: ProfileBinding,
    initial: Document,
    calls: Calls,
    rewrite_on_ab: bool,
}
impl FrozenProfile for SeedProfile {
    type Context = ();
    type Admitted = Admitted;
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
    ) -> Result<Admitted, Self::Error> {
        self.calls.bump(0);
        self.binding
            .ensure_matches(requested)
            .map_err(|_| "fixture.binding")?;
        if input != b"bounded independent ADR fixture" {
            return Err("fixture.input");
        }
        Ok(Admitted {
            document: self.initial.clone(),
            canonical: encode(&self.initial),
        })
    }
    fn context(&self, _: &Admitted) {}
    fn to_document(&self, value: &Admitted) -> Document {
        self.calls.bump(1);
        value.document.clone()
    }
    fn admit_snapshot(&self, _: &(), value: &Document) -> Result<Admitted, Self::Error> {
        self.calls.bump(2);
        Ok(Admitted {
            document: value.clone(),
            canonical: encode(value),
        })
    }
    fn canonical<'a>(&self, value: &'a Admitted) -> &'a [u8] {
        self.calls.bump(3);
        &value.canonical
    }
}
impl TransactionProfile for SeedProfile {
    fn normalize_candidate<V: CandidateRead>(
        &self,
        _: &(),
        _: &V,
        work: &mut WorkMeter,
    ) -> Result<Vec<Operation<V::Id>>, Self::Error> {
        work.charge_units(1).map_err(|_| "fixture.work")?;
        Ok(vec![])
    }
    fn validate_candidate<V: CandidateRead>(
        &self,
        _: &(),
        view: &V,
        work: &mut WorkMeter,
    ) -> Result<ValidationStats, Self::Error> {
        fn walk<V: CandidateRead>(
            v: &V,
            id: V::Id,
            depth: usize,
            count: &mut u64,
            w: &mut WorkMeter,
        ) -> Result<(), &'static str> {
            w.charge_units(1).map_err(|_| "fixture.work")?;
            if depth > 32 || *count >= 128 {
                return Err("fixture.limit");
            }
            *count += 1;
            let n = v.node(id).ok_or("fixture.missing")?;
            w.charge_bytes(n.type_id.len() as u64 + n.text.map_or(0, str::len) as u64)
                .map_err(|_| "fixture.work")?;
            if !n.type_id.starts_with(PREFIX) {
                return Err("fixture.type");
            }
            for m in n.marks {
                w.charge_units(1).map_err(|_| "fixture.work")?;
                if !m.type_id.starts_with(PREFIX) || !m.attributes.is_empty() {
                    return Err("fixture.mark");
                }
            }
            for child in n.children {
                walk(v, *child, depth + 1, count, w)?;
            }
            Ok(())
        }
        let mut nodes = 0;
        for root in view.roots() {
            walk(view, *root, 0, &mut nodes, work)?;
        }
        Ok(ValidationStats {
            nodes,
            canonical_bytes: 0,
        })
    }
}
impl HistoryProfile for SeedProfile {
    fn finalize_history_typing<V: CandidateRead>(
        &self,
        _: &(),
        view: &V,
        _: Option<Selection<V::Id>>,
        saved: Option<&[Mark]>,
        work: &mut WorkMeter,
    ) -> Result<Option<Vec<Mark>>, Self::Error> {
        work.charge_units(1).map_err(|_| "fixture.work")?;
        work.charge_bytes(saved.map_or(0, std::mem::size_of_val) as u64)
            .map_err(|_| "fixture.work")?;
        if self.rewrite_on_ab {
            work.charge_units(2).map_err(|_| "fixture.work")?;
            if let Some(root) = view.roots().first().and_then(|id| view.node(*id))
                && root
                    .children
                    .first()
                    .and_then(|id| view.node(*id))
                    .is_some_and(|n| n.text == Some("ab"))
            {
                return Ok(Some(vec![]));
            }
        }
        Ok(saved.map(<[Mark]>::to_vec))
    }
    fn history_error_code(error: &Self::Error) -> &'static str {
        error
    }
}
fn node_value(n: &Node) -> Value {
    json!({"type":n.type_id,"primitive":format!("{:?}",n.primitive),"text":n.text,
        "marks":n.marks.iter().map(|m|m.type_id.clone()).collect::<Vec<_>>(),
        "children":n.children.iter().map(node_value).collect::<Vec<_>>()})
}
fn encode(d: &Document) -> Vec<u8> {
    serde_json::to_vec(&d.children.iter().map(node_value).collect::<Vec<_>>()).unwrap()
}
fn marks(v: &Value) -> Vec<Mark> {
    v.as_array()
        .into_iter()
        .flatten()
        .map(|m| Mark {
            type_id: format!("{PREFIX}{}", m.as_str().unwrap()),
            attributes: Attributes::new(),
        })
        .collect()
}
fn model_node(label: &str, graph: &Value, embedded: bool) -> Node {
    let n = &graph["nodes"][label];
    let (primitive, suffix) = match n["kind"].as_str().unwrap() {
        "text" => (Primitive::Text, "text".to_string()),
        "atom" if n["type"] == "hard-break" => (Primitive::HardBreak, "hard-break".into()),
        "atom" => (Primitive::BlockAtom, n["type"].as_str().unwrap().into()),
        "container"
            if label == "section"
                || label == "outer"
                || label == "inner"
                || (embedded && label == "q") =>
        {
            (Primitive::Container, "container".into())
        }
        "container" => (Primitive::TextBlock, "textblock".into()),
        _ => panic!("unknown independent fixture kind"),
    };
    let children = n["children"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|id| {
            let name = id.as_str().unwrap();
            if embedded && label == "q" && name == "z" {
                Node {
                    type_id: format!("{PREFIX}textblock"),
                    primitive: Primitive::TextBlock,
                    attributes: Attributes::new(),
                    marks: vec![],
                    text: None,
                    children: vec![model_node(name, graph, false)],
                }
            } else {
                model_node(name, graph, embedded)
            }
        })
        .collect();
    Node {
        type_id: format!("{PREFIX}{suffix}"),
        primitive,
        attributes: Attributes::new(),
        marks: marks(&n["marks"]),
        text: n["text"].as_str().map(str::to_owned),
        children,
    }
}
fn document(graph: &Value, embedded: bool) -> Document {
    Document {
        children: graph["nodes"]["root"]["children"]
            .as_array()
            .unwrap()
            .iter()
            .map(|name| model_node(name.as_str().unwrap(), graph, embedded))
            .collect(),
    }
}
fn point(v: &Value, ids: &BTreeMap<String, NodeId>) -> Position<NodeId> {
    let affinity = if v["affinity"] == "before" {
        Affinity::Before
    } else {
        Affinity::After
    };
    match v["kind"].as_str().unwrap() {
        "text" => Position::Text {
            leaf: ids[v["leaf"].as_str().unwrap()],
            utf16: Utf16Offset::new(v["utf16"].as_u64().unwrap() as usize),
            affinity,
        },
        "child" => Position::Child {
            parent: ids[v["parent"].as_str().unwrap()],
            index: v["index"].as_u64().unwrap() as usize,
            affinity,
        },
        "edge" => Position::Edge {
            node: ids[v["node"].as_str().unwrap()],
            side: if v["side"] == "before" {
                Edge::Before
            } else {
                Edge::After
            },
        },
        _ => panic!("unknown point"),
    }
}
fn selection(v: &Value, ids: &BTreeMap<String, NodeId>) -> Selection<NodeId> {
    Selection {
        anchor: point(&v["anchor"], ids),
        focus: point(&v["focus"], ids),
    }
}
fn physical(graph: &Value, embedded: bool) -> Value {
    let mut g = graph.clone();
    if embedded {
        let q = g["nodes"]["q"]["children"].as_array_mut().unwrap();
        for id in q {
            if id == "z" {
                *id = json!("__adr36_q_text");
            }
        }
        g["nodes"]["__adr36_q_text"] = json!({"kind":"container","children":["z"]});
    }
    g
}
fn bind_walk(
    s: &Session<SeedProfile>,
    id: NodeId,
    label: &str,
    expected: &Value,
    ids: &mut BTreeMap<String, NodeId>,
) {
    if let Some(old) = ids.insert(label.into(), id) {
        assert_eq!(old, id, "historical ID changed: {label}");
    }
    let children = s.node(s.key(), id).unwrap().children();
    let expected_children = expected["nodes"][label]["children"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert_eq!(children.len(), expected_children.len(), "children {label}");
    for (child, name) in children.iter().zip(expected_children) {
        bind_walk(s, *child, name.as_str().unwrap(), expected, ids);
    }
}
fn graph(s: &Session<SeedProfile>, ids: &BTreeMap<String, NodeId>, embedded: bool) -> Value {
    let mut records = serde_json::Map::new();
    for (name, id) in ids {
        if let Ok(n) = s.node(s.key(), *id) {
            let names = |children: &[NodeId]| {
                children
                    .iter()
                    .map(|id| json!(ids.iter().find(|(_, bound)| *bound == id).unwrap().0))
                    .collect::<Vec<_>>()
            };
            let value = match n.primitive() {
                Some(Primitive::Text) => {
                    json!({"kind":"text","text":n.text().unwrap(),"marks":n.marks().iter().map(|m|m.type_id.strip_prefix(PREFIX).unwrap()).collect::<Vec<_>>()})
                }
                Some(Primitive::HardBreak) => json!({"kind":"atom","type":"hard-break"}),
                Some(Primitive::BlockAtom) => {
                    json!({"kind":"atom","type":n.type_id().unwrap().strip_prefix(PREFIX).unwrap()})
                }
                _ => json!({"kind":"container","children":names(n.children())}),
            };
            records.insert(name.clone(), value);
        }
    }
    if embedded {
        records.remove("__adr36_q_text");
        for id in records.get_mut("q").unwrap()["children"]
            .as_array_mut()
            .unwrap()
        {
            if id == "__adr36_q_text" {
                *id = json!("z");
            }
        }
    }
    json!({"root":"root","nodes":records})
}
fn assert_physical(s: &Session<SeedProfile>, ids: &BTreeMap<String, NodeId>, literal: &Value) {
    let mut records = serde_json::Map::new();
    for (label, id) in ids {
        if let Ok(n) = s.node(s.key(), *id) {
            let name = |node: NodeId| {
                ids.iter()
                    .find(|(_, bound)| **bound == node)
                    .unwrap()
                    .0
                    .clone()
            };
            records.insert(label.clone(),json!({"type_id":n.type_id(),"primitive":n.primitive().map(|p|format!("{p:?}")),"attrs":{},"marks":[],"text":n.text(),"children":n.children().iter().map(|n|name(*n)).collect::<Vec<_>>(),"parent":n.parent().map(name)}));
            assert!(n.attributes().is_none_or(BTreeMap::is_empty) && n.marks().is_empty());
        }
    }
    assert_eq!(json!({"root":"root","nodes":records}), *literal);
}
fn request(s: &Session<SeedProfile>, d: HistoryDirection) -> HistoryRequest {
    HistoryRequest::new(
        s.key(),
        s.revision(),
        s.selection_epoch(),
        s.history_summary().epoch,
        d,
    )
}
fn replay(s: &mut Session<SeedProfile>, calls: &Calls, d: HistoryDirection) {
    let req = request(s, d);
    let before = (
        s.revision(),
        s.selection_epoch(),
        s.selection(s.key()).unwrap(),
        s.history_summary(),
        s.journal_summary(),
    );
    let count = calls.0.get();
    let available = s.query_history(&req);
    assert_eq!(count, calls.0.get(), "ordinary history query used codec");
    assert_eq!(
        before,
        (
            s.revision(),
            s.selection_epoch(),
            s.selection(s.key()).unwrap(),
            s.history_summary(),
            s.journal_summary()
        )
    );
    let work = match available {
        HistoryAvailability::Available { work, .. } => work,
        other => panic!("ADR replay unavailable: {other:?}"),
    };
    let count = calls.0.get();
    match s.execute_history(&req) {
        HistoryOutcome::Completed(e) => assert_eq!(e.work, work),
        other => panic!("ADR replay refused: {other:?}"),
    }
    assert_eq!(count, calls.0.get(), "ordinary history used codec");
}
fn operations(v: &Value, ids: &BTreeMap<String, NodeId>) -> Vec<Operation<editor_engine::NodeRef>> {
    let mut out = vec![];
    for op in v.as_array().unwrap() {
        let get = |key: &str| editor_engine::NodeRef::Existing(ids[op[key].as_str().unwrap()]);
        let at = |key: &str| Utf16Offset::new(op[key].as_u64().unwrap() as usize);
        match op["kind"].as_str().unwrap() {
            "replaceText" => out.push(Operation::ReplaceText {
                leaf: get("leaf"),
                from: at("from"),
                to: at("to"),
                inserted: op["insert"].as_str().unwrap().into(),
            }),
            "splitText" => out.push(Operation::SplitText {
                leaf: get("leaf"),
                at: at("at"),
            }),
            "joinText" => out.push(Operation::JoinText {
                left: get("left"),
                right: get("right"),
            }),
            "moveSubtree" => out.push(Operation::Move {
                node: get("node"),
                parent: get("parent"),
                before_index: op["beforeIndex"].as_u64().unwrap() as usize,
            }),
            "deleteSubtree" => out.push(Operation::Remove { node: get("node") }),
            "markText" => {
                let leaf = get("leaf");
                out.push(Operation::SplitText {
                    leaf: leaf.clone(),
                    at: at("to"),
                });
                let middle = out.len();
                out.push(Operation::SplitText {
                    leaf,
                    at: at("from"),
                });
                out.push(Operation::SetMarks {
                    leaf: editor_engine::NodeRef::Created {
                        operation: middle,
                        path: vec![0],
                    },
                    marks: vec![Mark {
                        type_id: format!("{PREFIX}{}", op["mark"].as_str().unwrap()),
                        attributes: Attributes::new(),
                    }],
                });
            }
            "insertAtom" => {
                let hard = op["type"] == "hard-break";
                out.push(Operation::InsertFragment {
                    parent: get("parent"),
                    index: op["beforeIndex"].as_u64().unwrap() as usize,
                    fragment: Document {
                        children: vec![Node {
                            type_id: format!("{PREFIX}{}", op["type"].as_str().unwrap()),
                            primitive: if hard {
                                Primitive::HardBreak
                            } else {
                                Primitive::BlockAtom
                            },
                            attributes: Attributes::new(),
                            marks: vec![],
                            text: None,
                            children: vec![],
                        }],
                    },
                });
            }
            _ => panic!("unhandled unchanged ADR operation"),
        }
    }
    out
}
pub fn observe() -> Value {
    let seeds: Value = serde_json::from_str(SEEDS).unwrap();
    let embedding: Value = serde_json::from_str(EMBEDDING).unwrap();
    let mut reports = vec![];
    for seed in seeds["transactions"].as_array().unwrap() {
        let id = seed["id"].as_str().unwrap();
        let embedded = id == "move-cross-parent-gaps";
        let calls = Calls::default();
        let initial = document(&seed["before"]["document"], embedded);
        let profile = SeedProfile {
            binding: ProfileBinding::new(
                "org.example.history",
                "1.0.0",
                "org.example.history/json",
                1,
                &[],
            )
            .unwrap(),
            initial,
            calls: calls.clone(),
            rewrite_on_ab: false,
        };
        let binding = profile.binding().clone();
        let mut s = Session::open(
            profile,
            &binding,
            b"bounded independent ADR fixture",
            AdmissionMode::Strict,
            AccessMode::Editable,
        )
        .unwrap();
        let mut ids = BTreeMap::new();
        bind_walk(
            &s,
            s.root(s.key()).unwrap(),
            "root",
            &physical(&seed["before"]["document"], embedded),
            &mut ids,
        );
        s.set_selection(
            s.key(),
            s.revision(),
            selection(&seed["before"]["selection"], &ids),
        )
        .unwrap();
        let original_selection = s.selection(s.key()).unwrap().unwrap();
        assert_eq!(graph(&s, &ids, embedded), seed["before"]["document"]);
        if embedded {
            assert_physical(
                &s,
                &ids,
                &embedding["checkpoints"]["before"]["physical_document"],
            );
        }
        let mut tx = Transaction::new(s.key(), s.revision(), operations(&seed["operations"], &ids));
        tx.selection_epoch = Some(s.selection_epoch());
        let count = calls.0.get();
        let event = match s.dispatch(tx) {
            DispatchOutcome::Changed(e) => e,
            other => panic!("seed {id} apply failed: {other:?}"),
        };
        assert_eq!(count, calls.0.get());
        bind_walk(
            &s,
            s.root(s.key()).unwrap(),
            "root",
            &physical(&seed["expected"]["after"]["document"], embedded),
            &mut ids,
        );
        for (position, key) in [
            (original_selection.anchor, "anchor"),
            (original_selection.focus, "focus"),
        ] {
            assert_eq!(
                event.map.map(position).is_deleted(),
                seed["expected"]["provenance"][key] == "deleted",
                "seed provenance {id}/{key}"
            );
        }
        for (phase, expected, revision) in [
            ("apply", &seed["expected"]["after"], 1),
            ("undo", &seed["expected"]["undo"], 2),
            ("redo", &seed["expected"]["redo"], 3),
        ] {
            if phase == "undo" {
                replay(&mut s, &calls, HistoryDirection::Undo);
            }
            if phase == "redo" {
                replay(&mut s, &calls, HistoryDirection::Redo);
            }
            bind_walk(
                &s,
                s.root(s.key()).unwrap(),
                "root",
                &physical(&expected["document"], embedded),
                &mut ids,
            );
            assert_eq!(
                graph(&s, &ids, embedded),
                expected["document"],
                "ADR document {id}/{phase}"
            );
            assert_eq!(
                s.selection(s.key()).unwrap(),
                Some(selection(&expected["selection"], &ids)),
                "ADR selection {id}/{phase}"
            );
            assert_eq!(s.revision(), revision);
            assert_eq!(
                expected["revision"]
                    .as_str()
                    .unwrap()
                    .parse::<u64>()
                    .unwrap(),
                revision + 7
            );
            assert!(s.dirty());
            if embedded {
                assert_physical(
                    &s,
                    &ids,
                    &embedding["checkpoints"][phase]["physical_document"],
                );
            }
            // Explicit codec checkpoint, outside the ordinary-operation counters.
            let canonical = s.export_snapshot(s.key(), s.revision()).unwrap();
            assert_eq!(
                canonical,
                encode(&document(&expected["document"], embedded))
            );
        }
        reports.push(json!({"id":id,"status":"passed","physical_embedding":embedded,"exact_document_selection_marks_ids":true,"actual_revisions":[0,1,2,3],"seed_revision_labels":["7","8","9","10"],"query_execute_work_equal":true,"ordinary_snapshot_codec_calls":0}));
    }
    assert_eq!(reports.len(), 16);
    json!({"status":"passed","seed_total":16,"seed_passed":16,"direct":15,"declared_structural_embeddings":1,"cases":reports,"scope":"Actual generic production Session;15 direct unchanged ADR contracts,1 declared structural embedding checked against full physical literals AND original graph projection. No KWDJ grammar or public extension API claim."})
}

pub fn observe_hp_only() -> Value {
    let mut reports = vec![];
    for rewrite in [false, true] {
        let literal = json!({"root":"root","nodes":{"root":{"kind":"container","children":["p"]},"p":{"kind":"container","children":["t"]},"t":{"kind":"text","text":"a","marks":[]}}});
        let calls = Calls::default();
        let profile = SeedProfile {
            binding: ProfileBinding::new(
                if rewrite {
                    "org.example.history.rewrite"
                } else {
                    "org.example.history.honest"
                },
                "1.0.0",
                "org.example.history/json",
                1,
                &[],
            )
            .unwrap(),
            initial: document(&literal, false),
            calls: calls.clone(),
            rewrite_on_ab: rewrite,
        };
        let binding = profile.binding().clone();
        let mut s = Session::open(
            profile,
            &binding,
            b"bounded independent ADR fixture",
            AdmissionMode::Strict,
            AccessMode::Editable,
        )
        .unwrap();
        let mut ids = BTreeMap::new();
        bind_walk(&s, s.root(s.key()).unwrap(), "root", &literal, &mut ids);
        s.set_selection(
            s.key(),
            0,
            Selection {
                anchor: text_point(ids["t"], 1),
                focus: text_point(ids["t"], 1),
            },
        )
        .unwrap();
        let tx = Transaction::new(
            s.key(),
            0,
            vec![Operation::ReplaceText {
                leaf: ids["t"].into(),
                from: Utf16Offset::new(1),
                to: Utf16Offset::new(1),
                inserted: "b".into(),
            }],
        );
        let before = calls.0.get();
        assert!(matches!(s.dispatch(tx), DispatchOutcome::Changed(_)));
        assert_eq!(before, calls.0.get());
        replay(&mut s, &calls, HistoryDirection::Undo);
        assert_eq!(s.revision(), 2);
        assert_eq!(graph(&s, &ids, false), literal);
        assert_eq!(s.history_summary().redo_units, 1);
        if rewrite {
            let req = request(&s, HistoryDirection::Redo);
            let before = (
                s.revision(),
                s.selection_epoch(),
                s.history_summary(),
                s.journal_summary(),
                s.journal_entries(),
                s.dirty(),
                s.stored_marks(s.key()).unwrap().map(<[Mark]>::to_vec),
                s.selection(s.key()).unwrap(),
                graph(&s, &ids, false),
            );
            let count = calls.0.get();
            let query = s.query_history(&req);
            let (reason, work) = match query {
                HistoryAvailability::Unavailable { reason, work, .. } => (reason, work),
                v => panic!("rewritten marks were available {v:?}"),
            };
            for _ in 0..2 {
                match s.execute_history(&req) {
                    HistoryOutcome::Refused {
                        reason: r, work: w, ..
                    } => {
                        assert_eq!(reason, r);
                        assert_eq!(work, w);
                    }
                    v => panic!("rewritten marks published {v:?}"),
                }
            }
            assert_eq!(count, calls.0.get());
            assert_eq!(
                before,
                (
                    s.revision(),
                    s.selection_epoch(),
                    s.history_summary(),
                    s.journal_summary(),
                    s.journal_entries(),
                    s.dirty(),
                    s.stored_marks(s.key()).unwrap().map(<[Mark]>::to_vec),
                    s.selection(s.key()).unwrap(),
                    graph(&s, &ids, false)
                )
            );
            assert_eq!(s.stored_marks(s.key()).unwrap(), None);
        } else {
            replay(&mut s, &calls, HistoryDirection::Redo);
            assert_eq!(s.revision(), 3);
            assert_eq!(s.node(s.key(), ids["t"]).unwrap().text(), Some("ab"));
        }
        reports.push(json!({"binding":if rewrite{"immutable-rewriting-finalizer"}else{"honest-finalizer"},"status":"passed","implements_command_provider":false,"rewritten_saved_none_to_empty_refused":rewrite,"ordinary_snapshot_codec_calls":0}));
    }
    json!({"status":"passed","variants":reports,"scope":"Actual production generic Session with explicitly implemented HistoryProfile, no CommandProvider/catalog; separate immutable bindings, never swapped during a live session."})
}
fn text_point(leaf: NodeId, n: usize) -> Position<NodeId> {
    Position::Text {
        leaf,
        utf16: Utf16Offset::new(n),
        affinity: Affinity::After,
    }
}
