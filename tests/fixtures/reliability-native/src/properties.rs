// SPDX-License-Identifier: MIT OR Apache-2.0
//! Public native algebra witnesses against pre-execution frozen literals.
use super::*;
use editor_core::commands::LocalRef;
use editor_core::document::{Attribute, Document, Node};
use editor_core::transaction::Operation;
use editor_engine::{NodeRef, Transaction};
use serde_json::{Value, json};

type Labels = BTreeMap<String, NodeId>;
fn reference(v: &Value, labels: &Labels) -> NodeRef {
    if let Some(n) = v.get("existing") {
        LocalRef::Existing(labels[n.as_str().unwrap()])
    } else {
        let c = &v["created"];
        LocalRef::Created {
            operation: c["operation"].as_u64().unwrap() as usize,
            path: c["path"]
                .as_array()
                .unwrap()
                .iter()
                .map(|i| i.as_u64().unwrap() as usize)
                .collect(),
        }
    }
}
fn attribute(v: &Value) -> Attribute {
    match v["kind"].as_str().unwrap() {
        "string" => Attribute::String(v["value"].as_str().unwrap().into()),
        "boolean" => Attribute::Boolean(v["value"].as_bool().unwrap()),
        "number" => Attribute::Number(v["value"].as_number().unwrap().clone()),
        "null" => Attribute::Null,
        _ => panic!("invalid authored Attribute fixture"),
    }
}
fn attrs(v: &Value) -> Attributes {
    v.as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| {
            (
                k.clone(),
                match v {
                    Value::String(s) => Attribute::String(s.clone()),
                    Value::Bool(b) => Attribute::Boolean(*b),
                    Value::Number(n) => Attribute::Number(n.clone()),
                    Value::Null => Attribute::Null,
                    _ => panic!("unsupported authored attrs"),
                },
            )
        })
        .collect()
}
fn mark(v: &Value) -> Mark {
    Mark {
        type_id: v["type"].as_str().unwrap().into(),
        attributes: attrs(&v["attrs"]),
    }
}
fn primitive(v: &Value) -> Primitive {
    match v.as_str().unwrap() {
        "text" => Primitive::Text,
        "text_block" => Primitive::TextBlock,
        "container" => Primitive::Container,
        "inline_atom" => Primitive::InlineAtom,
        "block_atom" => Primitive::BlockAtom,
        "hard_break" => Primitive::HardBreak,
        _ => panic!("unknown authored primitive"),
    }
}
fn node(v: &Value) -> Node {
    Node {
        type_id: v["type"].as_str().unwrap().into(),
        primitive: primitive(&v["primitive"]),
        attributes: attrs(&v["attrs"]),
        marks: v["marks"].as_array().unwrap().iter().map(mark).collect(),
        text: v["text"].as_str().map(str::to_owned),
        children: v["children"].as_array().unwrap().iter().map(node).collect(),
    }
}
fn affinity(v: &Value) -> Affinity {
    match v.as_str().unwrap() {
        "before" => Affinity::Before,
        "after" => Affinity::After,
        _ => panic!("invalid authored affinity"),
    }
}
fn position(v: &Value, labels: &Labels) -> Position<NodeId> {
    let id = labels[v["label"].as_str().unwrap()];
    match v["kind"].as_str().unwrap() {
        "text" => Position::Text {
            leaf: id,
            utf16: Utf16Offset::new(v["utf16"].as_u64().unwrap() as usize),
            affinity: affinity(&v["affinity"]),
        },
        "child" => Position::Child {
            parent: id,
            index: v["index"].as_u64().unwrap() as usize,
            affinity: affinity(&v["affinity"]),
        },
        "edge" => Position::Edge {
            node: id,
            side: if v["side"] == "before" {
                Edge::Before
            } else {
                Edge::After
            },
        },
        _ => panic!("unknown authored position"),
    }
}
fn local_position(v: &Value, labels: &Labels) -> Position<NodeRef> {
    match position(v, labels) {
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
fn operation(v: &Value, labels: &Labels) -> Operation<NodeRef> {
    let n = |key: &str| reference(&v[key], labels);
    let u = |key: &str| v[key].as_u64().unwrap() as usize;
    let range = || Selection {
        anchor: local_position(&v["range"]["anchor"], labels),
        focus: local_position(&v["range"]["focus"], labels),
    };
    match v["kind"].as_str().unwrap() {
        "replace_text" => Operation::ReplaceText {
            leaf: n("leaf"),
            from: Utf16Offset::new(u("from")),
            to: Utf16Offset::new(u("to")),
            inserted: v["inserted"].as_str().unwrap().into(),
        },
        "split_text" => Operation::SplitText {
            leaf: n("leaf"),
            at: Utf16Offset::new(u("at")),
        },
        "join_text" => Operation::JoinText {
            left: n("left"),
            right: n("right"),
        },
        "set_attribute" => Operation::SetAttribute {
            node: n("node"),
            key: v["key"].as_str().unwrap().into(),
            value: (!v["value"].is_null()).then(|| attribute(&v["value"])),
        },
        "set_marks" => Operation::SetMarks {
            leaf: n("leaf"),
            marks: v["marks"].as_array().unwrap().iter().map(mark).collect(),
        },
        "patch_mark_range" => Operation::PatchMarkRange {
            range: range(),
            edits: v["edits"]
                .as_array()
                .unwrap()
                .iter()
                .map(|e| match e["kind"].as_str().unwrap() {
                    "upsert" => editor_core::transaction::MarkEdit::Upsert(mark(&e["mark"])),
                    _ => panic!("unsupported authored MarkEdit"),
                })
                .collect(),
        },
        "replace_inline_range" => Operation::ReplaceInlineRange {
            range: range(),
            inserted: (!v["inserted"].is_null()).then(|| node(&v["inserted"])),
        },
        "move_inline_group" => Operation::MoveInlineGroup {
            nodes: v["nodes"]
                .as_array()
                .unwrap()
                .iter()
                .map(|r| reference(r, labels))
                .collect(),
            parent: n("parent"),
            before_index: u("before_index"),
        },
        "transform" => Operation::Transform {
            node: n("node"),
            type_id: v["type"].as_str().unwrap().into(),
            primitive: primitive(&v["primitive"]),
        },
        "insert_fragment" => Operation::InsertFragment {
            parent: n("parent"),
            index: u("index"),
            fragment: Document {
                children: v["fragment"]["children"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(node)
                    .collect(),
            },
        },
        "move" => Operation::Move {
            node: n("node"),
            parent: n("parent"),
            before_index: u("before_index"),
        },
        "duplicate" => Operation::Duplicate {
            node: n("node"),
            parent: n("parent"),
            index: u("index"),
        },
        "remove" => Operation::Remove { node: n("node") },
        _ => panic!("unknown authored operation"),
    }
}
fn semantic(mut records: Vec<Record>) -> Vec<Record> {
    for r in &mut records {
        r.changed_revision = 0;
    }
    records
}
fn tx<P: CommandProvider>(s: &Session<P>, ops: Vec<Operation<NodeRef>>) -> Transaction {
    let st = s.stamp();
    let mut tx = Transaction::new(st.session, st.revision, ops);
    tx.selection_epoch = Some(st.selection_epoch);
    tx.history_epoch = Some(st.history_epoch);
    tx
}
fn raw_fail(id: &str, phase: &str, invariant: &str, detail: impl Debug) -> HarnessFailure {
    HarnessFailure::at(id, None, phase, invariant, detail)
}
fn late(
    s: &mut Session<KwdjProfile<'static>>,
    case: &Value,
    labels: &Labels,
) -> Result<(), HarnessFailure> {
    let id = case["id"].as_str().unwrap();
    let before = capture(s);
    let mut ops = case["operations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| operation(v, labels))
        .collect::<Vec<_>>();
    ops.push(operation(&case["late_refusal"]["append_operation"], labels));
    match s.dispatch(tx(s, ops)) {
        DispatchOutcome::Refused { error, map, .. } => {
            let code = editor_engine::transaction::error_code(
                &error,
                <KwdjProfile<'static> as CommandProvider>::error_code,
            );
            if code != case["late_refusal"]["expected_code"].as_str().unwrap() {
                return Err(raw_fail(id, "late_refusal", "typed_code", code));
            }
            let p = Position::Text {
                leaf: labels["g"],
                utf16: Utf16Offset::new(0),
                affinity: Affinity::After,
            };
            if map.map(p) != editor_engine::mapping::MapResult::Mapped(p) {
                return Err(raw_fail(id, "late_refusal", "identity_map", map));
            }
        }
        other => return Err(raw_fail(id, "late_refusal", "expected_refused", other)),
    };
    if capture(s) != before {
        return Err(raw_fail(
            id,
            "late_refusal",
            "all_committed_facets_preserved",
            "state mutated",
        ));
    }
    Ok(())
}
/// All13 variants execute against real KWDJ Session, including normalization,
/// rollback with redo retained, exact saved IDs and explicit committed maps.
pub fn operation_literals() -> Result<Value, HarnessFailure> {
    let source: Value =
        serde_json::from_str(include_str!("../fixtures/operation-literals.json")).unwrap();
    let mut results = vec![];
    for case in source["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let p = KwdjProfile::new_owned(
            Rc::new(ExistingFacts),
            Limits::default(),
            AdmissionBudget::default(),
        );
        let binding = p.binding().clone();
        let mut s = Session::open(
            p,
            &binding,
            case["input_json"].as_str().unwrap().as_bytes(),
            AdmissionMode::Strict,
            AccessMode::Editable,
        )
        .map_err(|e| raw_fail(id, "admission", "strict", e))?;
        let labels: Labels = case["initial_labels"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(name, p)| {
                (
                    name.clone(),
                    path(
                        &s,
                        &p.as_array()
                            .unwrap()
                            .iter()
                            .map(|i| i.as_u64().unwrap() as usize)
                            .collect::<Vec<_>>(),
                    )
                    .unwrap(),
                )
            })
            .collect();
        let initial_selection = Selection {
            anchor: position(&case["initial_selection"]["anchor"], &labels),
            focus: position(&case["initial_selection"]["focus"], &labels),
        };
        s.set_selection(s.key(), 0, initial_selection)
            .map_err(|e| raw_fail(id, "selection", "setup", e))?;
        let initial = capture(&s);
        late(&mut s, case, &labels)?;
        let ops = case["operations"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| operation(v, &labels))
            .collect();
        let event = match s.dispatch(tx(&s, ops)) {
            DispatchOutcome::Changed(event) => event,
            other => return Err(raw_fail(id, "dispatch", "nontrivial_changed", other)),
        };
        let bytes = s
            .export_snapshot(s.key(), s.revision())
            .map_err(|e| raw_fail(id, "checkpoint", "export", e))?;
        if bytes != case["expected"]["canonical"].as_str().unwrap().as_bytes() {
            return Err(raw_fail(
                id,
                "checkpoint",
                "literal_complete_document",
                String::from_utf8_lossy(&bytes),
            ));
        }
        let mut final_labels = labels.clone();
        for (name, p) in case["expected"]["retained_ids_at_paths"]
            .as_object()
            .unwrap()
        {
            let actual = path(
                &s,
                &p.as_array()
                    .unwrap()
                    .iter()
                    .map(|i| i.as_u64().unwrap() as usize)
                    .collect::<Vec<_>>(),
            );
            if actual != Some(labels[name]) {
                return Err(raw_fail(id, "identity", "retained_id_path", name));
            }
        }
        let before_ids = initial.records.iter().map(|r| r.id).collect::<Vec<_>>();
        for (name, p) in case["expected"]["new_ids_at_paths"].as_object().unwrap() {
            let actual = path(
                &s,
                &p.as_array()
                    .unwrap()
                    .iter()
                    .map(|i| i.as_u64().unwrap() as usize)
                    .collect::<Vec<_>>(),
            )
            .unwrap();
            if before_ids.contains(&actual) || !event.changed_nodes.contains(&actual) {
                return Err(raw_fail(id, "identity", "new_returned_id", name));
            }
            final_labels.insert(name.clone(), actual);
        }
        for n in case["expected"]["retired_labels"].as_array().unwrap() {
            if s.node(s.key(), labels[n.as_str().unwrap()]).is_ok() {
                return Err(raw_fail(id, "identity", "retired_not_readable", n));
            }
        }
        for probe in case["expected"]["map_probes"].as_array().unwrap() {
            let from = position(&probe["before"], &labels);
            let to = position(&probe["after"], &final_labels);
            let actual = event.map.map(from);
            if actual.position() != Some(to)
                || actual.is_deleted() != probe["deleted"].as_bool().unwrap()
            {
                return Err(raw_fail(id, "mapping", "literal_map", (actual, to)));
            }
        }
        let success = capture(&s);
        if s.history_summary().undo_units != 1
            || s.history_summary().redo_units != 0
            || s.selection(s.key()).unwrap() != Some(initial_selection)
        {
            return Err(raw_fail(
                id,
                "checkpoint",
                "one_unit_selection",
                s.history_summary(),
            ));
        }
        let st = s.stamp();
        let undo = HistoryRequest::new(
            st.session,
            st.revision,
            st.selection_epoch,
            st.history_epoch,
            HistoryDirection::Undo,
        );
        let before_query = capture(&s);
        let q = s.query_history(&undo);
        if capture(&s) != before_query {
            return Err(raw_fail(id, "history_query", "pure", q));
        }
        let qwork = match q {
            HistoryAvailability::Available { work, .. } => work,
            other => return Err(raw_fail(id, "history_query", "available", other)),
        };
        let undo_event = match s.execute_history(&undo) {
            HistoryOutcome::Completed(e) => e,
            other => return Err(raw_fail(id, "undo", "completed", other)),
        };
        if undo_event.work != qwork {
            return Err(raw_fail(id, "undo", "query_work", (undo_event.work, qwork)));
        }
        if s.export_snapshot(s.key(), s.revision()).unwrap()
            != case["history"]["undo"]["canonical"]
                .as_str()
                .unwrap()
                .as_bytes()
            || semantic(capture(&s).records) != semantic(initial.records.clone())
        {
            return Err(raw_fail(
                id,
                "undo",
                "exact_original_document_ids",
                "mismatch",
            ));
        }
        late(&mut s, case, &labels)?;
        let st = s.stamp();
        let redo = HistoryRequest::new(
            st.session,
            st.revision,
            st.selection_epoch,
            st.history_epoch,
            HistoryDirection::Redo,
        );
        let before_query = capture(&s);
        let q = s.query_history(&redo);
        if capture(&s) != before_query {
            return Err(raw_fail(id, "history_query", "pure", q));
        }
        let qwork = match q {
            HistoryAvailability::Available { work, .. } => work,
            other => return Err(raw_fail(id, "history_query", "available", other)),
        };
        let redo_event = match s.execute_history(&redo) {
            HistoryOutcome::Completed(e) => e,
            other => return Err(raw_fail(id, "redo", "completed", other)),
        };
        if qwork != redo_event.work {
            return Err(raw_fail(id, "redo", "query_work", (qwork, redo_event.work)));
        }
        if s.export_snapshot(s.key(), s.revision()).unwrap()
            != case["history"]["redo"]["canonical"]
                .as_str()
                .unwrap()
                .as_bytes()
            || semantic(capture(&s).records) != semantic(success.records)
        {
            return Err(raw_fail(id, "redo", "exact_saved_document_ids", "mismatch"));
        }
        if s.revision() != 3 || !s.dirty() {
            return Err(raw_fail(
                id,
                "history",
                "revision_dirty",
                (s.revision(), s.dirty()),
            ));
        }
        s.close(s.key()).unwrap();
        results.push(json!({"id":id,"variant":case["operation_variant"],"status":"passed","late_refusals":2,"history_query_purity":true,"history_query_work_equal":true,"exact_documents_maps_and_saved_ids":true,"normalization_operations":event.normalization_operations}));
    }
    Ok(
        json!({"format":"editor-reliability-native-algebra/1","status":"passed","cases":results,"variant_total":13,"scope":"Real KWDJ prose public native raw dispatch; not SDK raw13 reachability and not all-profile grammar proof"}),
    )
}

/// Reuses the unchanged pre-implementation OSR64 extension-command golden.
/// D1 executes the real finite recipe; D0 refuses the absent command atomically.
pub fn notes_recipe_and_d0_refusal() -> Value {
    let initial =
        include_bytes!("../../../../contracts/notes/v1/extension-command/initial.canonical.json");
    let after =
        include_bytes!("../../../../contracts/notes/v1/extension-command/after.canonical.json");
    let mut reports = vec![];
    for context in [model::Context::NotesD0, model::Context::NotesD1] {
        let profile = editor_extensions::Recipes::new(
            default_notes(context),
            &mut WorkMeter::new(WorkLimits::default()),
        )
        .unwrap();
        let binding = profile.binding().clone();
        let mut session = Session::open(
            profile,
            &binding,
            initial,
            AdmissionMode::Strict,
            AccessMode::Editable,
        )
        .unwrap();
        let doc = path(&session, &[0]).unwrap();
        let intent = editor_extensions::Intent::Recipe(editor_extensions::RecipeIntent {
            id: "org.example.notes/insert-callout".into(),
            nodes: BTreeMap::from([("doc".into(), doc)]),
            values: Attributes::from([
                ("text".into(), Attribute::String("A😀B".into())),
                ("title".into(), Attribute::String("Подсказка".into())),
            ]),
        });
        let st = session.stamp();
        let mut request = CommandRequest::new(st.session, st.revision, st.selection_epoch, intent);
        request.history_epoch = Some(st.history_epoch);
        let before = capture(&session);
        let query = session.query_command(&request);
        assert_eq!(capture(&session), before);
        if context == model::Context::NotesD0 {
            assert!(matches!(
                query,
                CommandAvailability::Unavailable {
                    reason: "command.unknown",
                    ..
                }
            ));
            assert!(matches!(
                session.execute_command(&request),
                CommandOutcome::Refused {
                    reason: "command.unknown",
                    ..
                }
            ));
            assert_eq!(capture(&session), before);
        } else {
            let work = match query {
                CommandAvailability::Available { work, .. } => work,
                other => panic!("frozen D1 recipe query: {other:?}"),
            };
            let event = match session.execute_command(&request) {
                CommandOutcome::Completed {
                    outcome: DispatchOutcome::Changed(e),
                    ..
                } => e,
                other => panic!("frozen recipe execution: {other:?}"),
            };
            assert_eq!(work, event.work);
            assert_eq!(session.export_snapshot(session.key(), 1).unwrap(), after);
            let after_records = semantic(capture(&session).records);
            let leaf = path(&session, &[0, 1, 0, 0]).unwrap();
            assert_eq!(
                session.selection(session.key()).unwrap(),
                Some(Selection {
                    anchor: Position::Text {
                        leaf,
                        utf16: Utf16Offset::new(3),
                        affinity: Affinity::After
                    },
                    focus: Position::Text {
                        leaf,
                        utf16: Utf16Offset::new(3),
                        affinity: Affinity::After
                    }
                })
            );
            for direction in [HistoryDirection::Undo, HistoryDirection::Redo] {
                let st = session.stamp();
                let request = HistoryRequest::new(
                    st.session,
                    st.revision,
                    st.selection_epoch,
                    st.history_epoch,
                    direction,
                );
                let before_query = capture(&session);
                let query = session.query_history(&request);
                assert_eq!(capture(&session), before_query);
                let qwork = match query {
                    HistoryAvailability::Available { work, .. } => work,
                    other => panic!("recipe history query {other:?}"),
                };
                let e = match session.execute_history(&request) {
                    HistoryOutcome::Completed(e) => e,
                    other => panic!("recipe history {other:?}"),
                };
                assert_eq!(qwork, e.work);
            }
            assert_eq!(session.export_snapshot(session.key(), 3).unwrap(), after);
            assert_eq!(semantic(capture(&session).records), after_records);
        }
        session.close(session.key()).unwrap();
        reports.push(json!({"context":context,"recipe":if context==model::Context::NotesD1{"changed+undo+redo+exactIDs"}else{"command.unknown atomic refusal"}}));
    }
    json!({"format":"editor-reliability-native-notes-recipe/1","status":"passed","cases":reports,"oracle":"unchanged contracts/notes/v1/extension-command"})
}

#[cfg(test)]
mod supplements {
    use super::*;
    use std::cell::Cell;
    struct Facts(Cell<u8>);
    impl IdentityResolver for Facts {
        fn resolve_media(&self, _: &uuid::Uuid) -> Result<IdentityStatus, IdentityResolverError> {
            Ok(IdentityStatus::Exists)
        }
        fn resolve_reference(
            &self,
            _: &uuid::Uuid,
        ) -> Result<IdentityStatus, IdentityResolverError> {
            match self.0.get() {
                0 => Ok(IdentityStatus::Exists),
                1 => Ok(IdentityStatus::Missing),
                _ => Err(IdentityResolverError::Unavailable),
            }
        }
    }
    #[test]
    fn synchronous_facts_invalidate_old_availability_and_same_captured_history_retries() {
        const INPUT:&[u8]=br#"{"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[{"type":"text","text":"ref","marks":[{"type":"reference_link","attrs":{"reference_entity_id":"550e8400-e29b-41d4-a716-446655440006"}}]}]},{"type":"paragraph","content":[{"type":"text","text":"ab"}]}]}"#;
        for (status, code) in [
            (1, "kwdj.reference_identity_unresolved"),
            (2, "kwdj.identity_resolution_failed"),
        ] {
            let facts = Rc::new(Facts(Cell::new(0)));
            let profile = KwdjProfile::new_owned(
                facts.clone(),
                Limits::default(),
                AdmissionBudget::default(),
            );
            let binding = profile.binding().clone();
            let mut s = Session::open(
                profile,
                &binding,
                INPUT,
                AdmissionMode::Strict,
                AccessMode::Editable,
            )
            .unwrap();
            let leaf = path(&s, &[1, 0]).unwrap();
            let pos = Position::Text {
                leaf,
                utf16: Utf16Offset::new(2),
                affinity: Affinity::After,
            };
            s.set_selection(
                s.key(),
                0,
                Selection {
                    anchor: pos,
                    focus: pos,
                },
            )
            .unwrap();
            let st = s.stamp();
            let mut request = CommandRequest::new(
                st.session,
                st.revision,
                st.selection_epoch,
                editor_kwdj::commands::KwdjIntent::InsertText { text: "X".into() },
            );
            request.history_epoch = Some(st.history_epoch);
            assert!(matches!(
                s.query_command(&request),
                CommandAvailability::Available { .. }
            ));
            let before = capture(&s);
            facts.0.set(status);
            assert!(
                matches!(s.query_command(&request),CommandAvailability::Unavailable{reason,..} if reason==code)
            );
            assert!(
                matches!(s.execute_command(&request),CommandOutcome::Refused{reason,..} if reason==code)
            );
            assert_eq!(capture(&s), before);
            facts.0.set(0);
            assert!(matches!(
                s.execute_command(&request),
                CommandOutcome::Completed {
                    outcome: DispatchOutcome::Changed(_),
                    ..
                }
            ));
            let published = semantic(capture(&s).records);
            for direction in [HistoryDirection::Undo, HistoryDirection::Redo] {
                let st = s.stamp();
                let request = HistoryRequest::new(
                    st.session,
                    st.revision,
                    st.selection_epoch,
                    st.history_epoch,
                    direction,
                );
                let before = capture(&s);
                facts.0.set(status);
                let query = s.query_history(&request);
                assert_eq!(capture(&s), before);
                let work = match query {
                    HistoryAvailability::Unavailable { reason, work, .. } if reason == code => work,
                    other => panic!("fresh facts query {other:?}"),
                };
                match s.execute_history(&request) {
                    HistoryOutcome::Refused {
                        reason,
                        work: actual,
                        ..
                    } => assert_eq!((reason, actual), (code, work)),
                    other => panic!("fresh facts execute {other:?}"),
                };
                assert_eq!(capture(&s), before);
                facts.0.set(0);
                assert!(matches!(
                    s.execute_history(&request),
                    HistoryOutcome::Completed(_)
                ));
            }
            assert_eq!(semantic(capture(&s).records), published);
            s.close(s.key()).unwrap();
        }
    }
    #[test]
    fn native_typing_group_identical_navigation_manual_boundary_and_redo_branch() {
        let input = fuzz_wire(model::Context::KwdjProse);
        let p = KwdjProfile::new_owned(
            Rc::new(ExistingFacts),
            Limits::default(),
            AdmissionBudget::default(),
        );
        let binding = p.binding().clone();
        let mut s = Session::open(
            p,
            &binding,
            &input,
            AdmissionMode::Strict,
            AccessMode::Editable,
        )
        .unwrap();
        let block = path(&s, &[0]).unwrap();
        let p = physical(&s, block, 2).unwrap();
        s.set_selection(
            s.key(),
            0,
            Selection {
                anchor: p,
                focus: p,
            },
        )
        .unwrap();
        for text in ["X", "Y"] {
            let st = s.stamp();
            let before = capture(&s);
            s.set_selection(st.session, st.revision, before.selection.unwrap())
                .unwrap();
            assert_eq!(capture(&s), before);
            let mut request = CommandRequest::new(
                st.session,
                st.revision,
                st.selection_epoch,
                editor_kwdj::commands::KwdjIntent::InsertText { text: text.into() },
            );
            request.history_epoch = Some(st.history_epoch);
            request.history_hint = editor_engine::HistoryHint::Typing {
                token: 7,
                class: editor_engine::TypingClass::Insert,
            };
            let q = s.query_command(&request);
            assert_eq!(capture(&s), before);
            let work = match q {
                CommandAvailability::Available { work, .. } => work,
                other => panic!("typing query {other:?}"),
            };
            match s.execute_command(&request) {
                CommandOutcome::Completed {
                    outcome: DispatchOutcome::Changed(e),
                    ..
                } => assert_eq!(e.work, work),
                other => panic!("typing execute {other:?}"),
            };
        }
        assert_eq!(
            (
                s.history_summary().undo_units,
                s.history_summary().undo_members
            ),
            (1, 2)
        );
        assert_eq!(
            s.node(s.key(), path(&s, &[0, 0]).unwrap()).unwrap().text(),
            Some("abXY")
        );
        let st = s.stamp();
        assert!(
            s.seal_history(
                st.session,
                st.revision,
                st.selection_epoch,
                st.history_epoch,
                WorkLimits::default()
            )
            .unwrap()
            .changed
        );
        let before = capture(&s);
        let st = s.stamp();
        assert!(
            !s.seal_history(
                st.session,
                st.revision,
                st.selection_epoch,
                st.history_epoch,
                WorkLimits::default()
            )
            .unwrap()
            .changed
        );
        assert_eq!(capture(&s), before);
        let st = s.stamp();
        let undo = HistoryRequest::new(
            st.session,
            st.revision,
            st.selection_epoch,
            st.history_epoch,
            HistoryDirection::Undo,
        );
        assert!(matches!(
            s.execute_history(&undo),
            HistoryOutcome::Completed(_)
        ));
        assert_eq!(
            s.node(s.key(), path(&s, &[0, 0]).unwrap()).unwrap().text(),
            Some("ab")
        );
        assert_eq!(s.history_summary().redo_units, 1);
        let before = capture(&s);
        let leaf = path(&s, &[0, 0]).unwrap();
        let noop = Transaction::new(
            s.key(),
            s.revision(),
            vec![Operation::ReplaceText {
                leaf: leaf.into(),
                from: Utf16Offset::new(0),
                to: Utf16Offset::new(0),
                inserted: String::new(),
            }],
        );
        assert!(matches!(
            s.dispatch(noop),
            DispatchOutcome::Unchanged { .. }
        ));
        assert_eq!(capture(&s), before);
        let st = s.stamp();
        let req = CommandRequest::new(
            st.session,
            st.revision,
            st.selection_epoch,
            editor_kwdj::commands::KwdjIntent::InsertText { text: "Z".into() },
        );
        assert!(matches!(
            s.execute_command(&req),
            CommandOutcome::Completed {
                outcome: DispatchOutcome::Changed(_),
                ..
            }
        ));
        assert_eq!(s.history_summary().redo_units, 0);
        s.close(s.key()).unwrap();
    }
}

#[cfg(test)]
mod delivery_limits {
    use super::*;
    use editor_engine::events::{EventLimits, ProtectionStart};
    #[test]
    fn protected_outbox_refusal_ack_retry_gap_snapshot_and_lifecycle() {
        let profile = default_notes(model::Context::NotesD0);
        let binding = profile.binding().clone();
        let mut s = Session::open_with_event_limits(
            profile,
            &binding,
            &fuzz_wire(model::Context::NotesD0),
            AdmissionMode::Strict,
            AccessMode::Editable,
            EventLimits {
                records: 1,
                ..EventLimits::default()
            },
        )
        .unwrap();
        let block = path(&s, &[0, 0]).unwrap();
        let pos = physical(&s, block, 2).unwrap();
        s.set_selection(
            s.key(),
            0,
            Selection {
                anchor: pos,
                focus: pos,
            },
        )
        .unwrap();
        let initial_cursor = s.event_status(s.key()).unwrap().head;
        let protected = s.protect_events(s.key(), ProtectionStart::Now).unwrap();
        let st = s.stamp();
        let mut request = CommandRequest::new(
            st.session,
            st.revision,
            st.selection_epoch,
            NativeNotesIntent::InsertText { text: "X".into() },
        );
        request.history_epoch = Some(st.history_epoch);
        assert!(matches!(
            s.execute_command(&request),
            CommandOutcome::Completed {
                outcome: DispatchOutcome::Changed(_),
                ..
            }
        ));
        let st = s.stamp();
        let mut request = CommandRequest::new(
            st.session,
            st.revision,
            st.selection_epoch,
            NativeNotesIntent::InsertText { text: "Y".into() },
        );
        request.history_epoch = Some(st.history_epoch);
        let before = capture(&s);
        let query = s.query_command(&request);
        assert_eq!(capture(&s), before);
        let work = match query {
            CommandAvailability::Unavailable {
                reason: "events.backpressure",
                work,
                ..
            } => work,
            other => panic!("protected query {other:?}"),
        };
        match s.execute_command(&request) {
            CommandOutcome::Refused {
                reason: "events.backpressure",
                work: actual,
                ..
            } => assert_eq!(work, actual),
            other => panic!("protected execute {other:?}"),
        };
        assert_eq!(capture(&s), before);
        let through = s
            .events_after(
                s.key(),
                initial_cursor,
                Default::default(),
                WorkLimits::default(),
            )
            .unwrap()
            .through();
        s.acknowledge_events(s.key(), protected, through).unwrap();
        assert!(matches!(
            s.execute_command(&request),
            CommandOutcome::Completed {
                outcome: DispatchOutcome::Changed(_),
                ..
            }
        ));
        assert_eq!(
            s.node(s.key(), path(&s, &[0, 0, 0]).unwrap())
                .unwrap()
                .text(),
            Some("abXY")
        );
        assert!(
            s.events_after(
                s.key(),
                initial_cursor,
                Default::default(),
                WorkLimits::default()
            )
            .is_err()
        );
        s.release_events(s.key(), protected).unwrap();
        let snapshot = s.export_snapshot_receipt(s.key(), s.revision()).unwrap();
        s.acknowledge_snapshot(&snapshot).unwrap();
        assert!(!s.dirty());
        let st = s.stamp();
        let request = CommandRequest::new(
            st.session,
            st.revision,
            st.selection_epoch,
            NativeNotesIntent::InsertText { text: "Z".into() },
        );
        assert!(matches!(
            s.execute_command(&request),
            CommandOutcome::Completed {
                outcome: DispatchOutcome::Changed(_),
                ..
            }
        ));
        assert!(s.dirty());
        s.acknowledge_snapshot(&snapshot).unwrap();
        assert!(s.dirty());
        let before_stale_reconcile = capture(&s);
        assert!(matches!(
            s.reconcile_saved_snapshot(&snapshot),
            Err(editor_engine::SessionError::State(
                editor_engine::StateError::StaleRevision
            ))
        ));
        assert_eq!(capture(&s), before_stale_reconcile);
        let current_snapshot = s.export_snapshot_receipt(s.key(), s.revision()).unwrap();
        assert!(!s.reconcile_saved_snapshot(&current_snapshot).unwrap());
        assert_eq!(capture(&s), before_stale_reconcile);
        let canonical = s.export_snapshot(s.key(), s.revision()).unwrap();
        let old = s.key();
        let next = s
            .remount(
                old,
                &binding,
                &canonical,
                AdmissionMode::Strict,
                AccessMode::Editable,
            )
            .unwrap();
        assert_ne!(next, old);
        assert!(s.root(old).is_err());
        assert_eq!(s.revision(), 0);
        assert_eq!(s.history_summary().undo_units, 0);
        assert!(!s.dirty());
        s.close(next).unwrap();
        let status = s.event_status(next).unwrap();
        assert!(status.terminal.is_some());
        assert!(s.root(next).is_err());
        let mut s = Session::open(
            default_notes(model::Context::NotesD0),
            &binding,
            &canonical,
            AdmissionMode::Strict,
            AccessMode::Editable,
        )
        .unwrap();
        let st = s.stamp();
        let request = HistoryRequest::new(
            st.session,
            st.revision,
            st.selection_epoch,
            st.history_epoch,
            HistoryDirection::Undo,
        );
        s.poison(st.session).unwrap();
        assert!(matches!(
            s.query_history(&request),
            HistoryAvailability::Unavailable {
                reason: "session.poisoned",
                ..
            }
        ));
        assert!(matches!(
            s.execute_history(&request),
            HistoryOutcome::Refused {
                reason: "session.poisoned",
                ..
            }
        ));
    }
    #[test]
    fn host_action_cap_eviction_preserves_latest_undo_and_refused_redo() {
        let p = default_notes(model::Context::NotesD0);
        let binding = p.binding().clone();
        let mut s = Session::open(
            p,
            &binding,
            &fuzz_wire(model::Context::NotesD0),
            AdmissionMode::Strict,
            AccessMode::Editable,
        )
        .unwrap();
        let block = path(&s, &[0, 0]).unwrap();
        let p = physical(&s, block, 2).unwrap();
        s.set_selection(
            s.key(),
            0,
            Selection {
                anchor: p,
                focus: p,
            },
        )
        .unwrap();
        for text in ["X", "Y"] {
            let st = s.stamp();
            let mut request = CommandRequest::new(
                st.session,
                st.revision,
                st.selection_epoch,
                NativeNotesIntent::InsertText { text: text.into() },
            );
            request.limits.history.actions = 1;
            request.limits.history.chronological_entries = 1;
            request.limits.journal_entries = 1;
            assert!(matches!(
                s.execute_command(&request),
                CommandOutcome::Completed {
                    outcome: DispatchOutcome::Changed(_),
                    ..
                }
            ));
            assert_eq!(s.history_summary().undo_units, 1);
            assert!(s.journal_summary().entries <= 1);
        }
        assert!(s.history_summary().evicted_undo_units >= 1);
        let st = s.stamp();
        let request = HistoryRequest::new(
            st.session,
            st.revision,
            st.selection_epoch,
            st.history_epoch,
            HistoryDirection::Undo,
        );
        assert!(matches!(
            s.execute_history(&request),
            HistoryOutcome::Completed(_)
        ));
        assert_eq!(
            s.node(s.key(), path(&s, &[0, 0, 0]).unwrap())
                .unwrap()
                .text(),
            Some("abX")
        );
        let before = capture(&s);
        let st = s.stamp();
        let request = HistoryRequest::new(
            st.session,
            st.revision,
            st.selection_epoch,
            st.history_epoch,
            HistoryDirection::Undo,
        );
        assert!(matches!(
            s.query_history(&request),
            HistoryAvailability::Unavailable {
                reason: "history.empty",
                ..
            }
        ));
        assert!(matches!(
            s.execute_history(&request),
            HistoryOutcome::Refused {
                reason: "history.empty",
                ..
            }
        ));
        assert_eq!(capture(&s), before);
        assert_eq!(s.history_summary().redo_units, 1);
        s.close(s.key()).unwrap();
    }
}
