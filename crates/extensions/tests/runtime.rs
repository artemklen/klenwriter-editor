// SPDX-License-Identifier: MIT OR Apache-2.0
//! Independent recipe literals executed through the production generic Session.
//! This trusted synthetic profile uses the public registry schema authority;
//! it is neither the Notes codec nor a private-engine allocator/cache witness.
use editor_core::cache::{CacheUpdate, PreparedValidation};
use editor_core::candidate::{CandidateChanges, CandidateRead};
use editor_core::commands::{
    CommandDescriptor, CommandPresentation, CommandProvider, CommandState, PlanBuilder,
};
use editor_core::document::{Attribute, Attributes, Document, Mark, Node, Primitive};
use editor_core::positions::{Affinity, Edge, Position, Selection, Utf16Offset};
use editor_core::profile::{AdmissionMode, FrozenProfile, ProfileBinding};
use editor_core::transaction::{
    Operation, TransactionProfile, ValidationStats, WorkLimits, WorkMeter,
};
use editor_engine::{
    AccessMode, CommandAvailability, CommandEffect, CommandOutcome, CommandRequest,
    DispatchOutcome, HistoryAvailability, HistoryDirection, HistoryOutcome, HistoryRequest, NodeId,
    Session,
};
use editor_registry::{
    CompilerLimits, FrozenRegistry, RegistryDiagnostic, RegistryProfile, SchemaCache, compile_json,
};
use klenwriter_editor_extensions::{Intent, RecipeIntent, Recipes};
use serde_json::Value;
use std::cell::Cell;
use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;

const PREFIX: &str = "org.example.recipes";
struct Fixture {
    binding: ProfileBinding,
    registry: FrozenRegistry,
    initial: Document,
    join: bool,
    work_cap: Rc<Cell<Option<WorkLimits>>>,
    codec_calls: Rc<Cell<usize>>,
    finalizer_calls: Rc<Cell<usize>>,
    compiled_calls: Rc<Cell<usize>>,
    catalog: Vec<String>,
}
impl RegistryProfile for Fixture {
    fn registry(&self) -> &FrozenRegistry {
        &self.registry
    }
}
impl FrozenProfile for Fixture {
    type Context = ();
    type Admitted = Document;
    type Error = RegistryDiagnostic;
    type Cache<I: Copy + Eq + Ord> = SchemaCache<I>;
    fn binding(&self) -> &ProfileBinding {
        &self.binding
    }
    fn transaction_work_limits(&self) -> Option<WorkLimits> {
        self.work_cap.get()
    }
    fn admit_bytes(
        &self,
        binding: &ProfileBinding,
        _: &[u8],
        _: AdmissionMode,
    ) -> Result<Document, Self::Error> {
        self.binding.ensure_matches(binding).unwrap();
        Ok(self.initial.clone())
    }
    fn context(&self, _: &Document) {}
    fn to_document(&self, document: &Document) -> Document {
        document.clone()
    }
    fn admit_snapshot(&self, _: &(), document: &Document) -> Result<Document, Self::Error> {
        self.codec_calls.set(self.codec_calls.get() + 1);
        Ok(document.clone())
    }
    fn canonical<'a>(&self, _: &'a Document) -> &'a [u8] {
        b"explicit synthetic snapshot boundary"
    }
    fn seed_cache<V: CandidateRead>(
        &self,
        _: &Document,
        view: &V,
        work: &mut WorkMeter,
    ) -> Result<SchemaCache<V::Id>, Self::Error> {
        match self.registry.validate_full(view, work)?.cache {
            CacheUpdate::Replace(cache) => Ok(cache),
            CacheUpdate::Patch(_) => unreachable!(),
        }
    }
}
impl TransactionProfile for Fixture {
    fn normalize_candidate<V: CandidateRead>(
        &self,
        _: &(),
        view: &V,
        work: &mut WorkMeter,
    ) -> Result<Vec<Operation<V::Id>>, Self::Error> {
        fn visit<V: CandidateRead>(
            view: &V,
            id: V::Id,
            work: &mut WorkMeter,
        ) -> Result<Vec<Operation<V::Id>>, RegistryDiagnostic> {
            work.charge_units(1).unwrap();
            let node = view.node(id).unwrap();
            if node.primitive == Primitive::TextBlock {
                for pair in node.children.windows(2) {
                    work.charge_units(1).unwrap();
                    let a = view.node(pair[0]).unwrap();
                    let b = view.node(pair[1]).unwrap();
                    if a.primitive == Primitive::Text
                        && b.primitive == Primitive::Text
                        && a.type_id == b.type_id
                        && a.attributes == b.attributes
                        && a.marks == b.marks
                    {
                        work.charge_bytes(std::mem::size_of::<Operation<V::Id>>() as u64)
                            .unwrap();
                        return Ok(vec![Operation::JoinText {
                            left: pair[0],
                            right: pair[1],
                        }]);
                    }
                }
            }
            for child in node.children {
                let result = visit(view, *child, work)?;
                if !result.is_empty() {
                    return Ok(result);
                }
            }
            Ok(vec![])
        }
        if self.join {
            for id in view.roots() {
                let result = visit(view, *id, work)?;
                if !result.is_empty() {
                    return Ok(result);
                }
            }
        }
        Ok(vec![])
    }
    fn validate_candidate<V: CandidateRead>(
        &self,
        _: &(),
        view: &V,
        work: &mut WorkMeter,
    ) -> Result<ValidationStats, Self::Error> {
        let proof = self.registry.validate_full(view, work)?;
        Ok(ValidationStats {
            nodes: proof.usage.metadata_visits,
            canonical_bytes: 0,
        })
    }
    fn validate_scoped<V: CandidateChanges>(
        &self,
        _: &(),
        view: &V,
        cache: &SchemaCache<V::Id>,
        work: &mut WorkMeter,
    ) -> Result<PreparedValidation<SchemaCache<V::Id>>, Self::Error> {
        let proof = self.registry.validate_scoped(view, cache, work)?;
        Ok(PreparedValidation {
            stats: ValidationStats {
                nodes: proof.usage.metadata_visits,
                canonical_bytes: 0,
            },
            cache: proof.cache,
        })
    }
}
impl CommandProvider for Fixture {
    type Intent<I: Copy + Eq + Ord> = String;
    const COMMANDS: &'static [CommandDescriptor] = &[];
    fn command_id<I: Copy + Eq + Ord>(id: &String) -> &str {
        id
    }
    fn command_catalog(&self) -> editor_core::commands::CommandCatalog<'_> {
        editor_core::commands::CommandCatalog::Runtime(&self.catalog)
    }
    fn prepare_command<V: CandidateRead>(
        &self,
        _: &(),
        _: &V,
        _: CommandState<'_, V::Id>,
        _: &String,
        _: &mut PlanBuilder<'_, V::Id>,
    ) -> Result<CommandPresentation, Self::Error> {
        self.compiled_calls.set(self.compiled_calls.get() + 1);
        Ok(CommandPresentation::default())
    }
    fn finalize_typing_override<V: CandidateRead>(
        &self,
        _: &(),
        view: &V,
        selection: Option<Selection<V::Id>>,
        marks: Option<&[Mark]>,
        work: &mut WorkMeter,
    ) -> Result<Option<Vec<Mark>>, Self::Error> {
        self.finalizer_calls.set(self.finalizer_calls.get() + 1);
        if let Some(marks) = marks {
            let leaf = match selection.unwrap().focus {
                Position::Text { leaf, .. } => leaf,
                _ => panic!("literal requires text caret"),
            };
            self.registry
                .validate_marks(view.node(leaf).unwrap().type_id, marks, work)?;
            work.charge_bytes(std::mem::size_of_val(marks) as u64 + 128)
                .unwrap();
        }
        Ok(marks.map(<[Mark]>::to_vec))
    }
    fn error_code(error: &Self::Error) -> &'static str {
        error.code.as_str()
    }
}
fn attr(v: &Value) -> Attribute {
    match v["kind"].as_str().unwrap() {
        "null" => Attribute::Null,
        "boolean" => Attribute::Boolean(v["value"].as_bool().unwrap()),
        "number" => Attribute::Number(serde_json::from_str(v["value"].as_str().unwrap()).unwrap()),
        "string" => Attribute::String(v["value"].as_str().unwrap().into()),
        "list" => Attribute::List(v["value"].as_array().unwrap().iter().map(attr).collect()),
        "object" => Attribute::Object(attrs(&v["value"])),
        kind => panic!("unknown literal AttributeDto {kind}"),
    }
}
fn attrs(v: &Value) -> Attributes {
    v.as_object()
        .unwrap()
        .iter()
        .map(|(key, value)| (key.clone(), attr(value)))
        .collect()
}
fn marks(v: &Value) -> Vec<Mark> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|m| Mark {
            type_id: m["type_id"].as_str().unwrap().into(),
            attributes: attrs(&m["attributes"]),
        })
        .collect()
}
fn node(v: &Value) -> Node {
    Node {
        type_id: v["type_id"].as_str().unwrap().into(),
        primitive: match v["primitive"].as_str().unwrap() {
            "container" => Primitive::Container,
            "text_block" => Primitive::TextBlock,
            "text" => Primitive::Text,
            x => panic!("unexpected primitive {x}"),
        },
        attributes: attrs(&v["attributes"]),
        marks: marks(&v["marks"]),
        text: v["text"].as_str().map(str::to_owned),
        children: v["children"].as_array().unwrap().iter().map(node).collect(),
    }
}
type TestSession = Session<Recipes<Fixture>>;
fn position(v: &Value, ids: &BTreeMap<String, NodeId>) -> Position<NodeId> {
    let affinity = if v["affinity"] == "before" {
        Affinity::Before
    } else {
        Affinity::After
    };
    match v["kind"].as_str().unwrap() {
        "text" => Position::Text {
            leaf: ids[v["node"].as_str().unwrap()],
            utf16: Utf16Offset::new(v["offset"].as_u64().unwrap() as usize),
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
        _ => panic!("invalid literal position"),
    }
}
fn selection(v: &Value, ids: &BTreeMap<String, NodeId>) -> Option<Selection<NodeId>> {
    if v.is_null() {
        None
    } else {
        Some(Selection {
            anchor: position(&v["anchor"], ids),
            focus: position(&v["focus"], ids),
        })
    }
}
// The authored expected graph supplies shape, fields and logical ID positions.
// IDs are captured once at their first actual publication, then must be exact
// on redo. No actual content is ever used to generate an expected document.
fn assert_graph(
    s: &TestSession,
    actual: NodeId,
    expected: &Value,
    ids: &mut BTreeMap<String, NodeId>,
) {
    let logical = expected["id"].as_str().unwrap();
    if let Some(old) = ids.get(logical) {
        assert_eq!(actual, *old, "identity {logical}");
    } else {
        assert!(!ids.values().any(|old| *old == actual));
        ids.insert(logical.into(), actual);
    }
    let n = s.node(s.key(), actual).unwrap();
    let want = node(expected);
    assert_eq!(
        (
            n.type_id().unwrap(),
            n.primitive().unwrap(),
            n.attributes().unwrap(),
            n.marks(),
            n.text()
        ),
        (
            want.type_id.as_str(),
            want.primitive,
            &want.attributes,
            want.marks.as_slice(),
            want.text.as_deref()
        ),
        "node {logical}"
    );
    assert_eq!(
        n.children().len(),
        expected["children"].as_array().unwrap().len(),
        "children {logical}"
    );
    for (child, expected) in n
        .children()
        .iter()
        .zip(expected["children"].as_array().unwrap())
    {
        assert_graph(s, *child, expected, ids);
    }
}
fn graph(s: &TestSession) -> Vec<(NodeId, String)> {
    fn visit(s: &TestSession, id: NodeId, out: &mut Vec<(NodeId, String)>) {
        let n = s.node(s.key(), id).unwrap();
        out.push((id, format!("{n:?}")));
        for child in n.children() {
            visit(s, *child, out);
        }
    }
    let mut out = vec![];
    visit(s, s.root(s.key()).unwrap(), &mut out);
    out
}
fn facets(s: &TestSession) -> String {
    format!(
        "{:?}",
        (
            graph(s),
            s.state(),
            s.stamp(),
            s.selection(s.key()).unwrap(),
            s.stored_marks(s.key()).unwrap(),
            s.dirty(),
            s.saved_revision(),
            s.journal_summary(),
            s.journal_entries(),
            s.history_summary(),
            s.event_status(s.key()).unwrap()
        )
    )
}
fn assert_frame(
    s: &TestSession,
    frame: &Value,
    documents: &Value,
    ids: &mut BTreeMap<String, NodeId>,
) {
    assert_eq!(
        s.revision().to_string(),
        frame["revision"].as_str().unwrap()
    );
    let root = s.node(s.key(), s.root(s.key()).unwrap()).unwrap();
    assert_eq!(root.children().len(), 1);
    assert_graph(
        s,
        root.children()[0],
        &documents[frame["document"].as_str().unwrap()],
        ids,
    );
    assert_eq!(
        s.selection(s.key()).unwrap(),
        selection(&frame["selection"], ids)
    );
    let expected_marks = (!frame["stored_marks"].is_null()).then(|| marks(&frame["stored_marks"]));
    assert_eq!(s.stored_marks(s.key()).unwrap(), expected_marks.as_deref());
    if let Some(n) = frame["undo_units"].as_u64() {
        assert_eq!(s.history_summary().undo_units, n as usize);
    }
    if let Some(n) = frame["redo_units"].as_u64() {
        assert_eq!(s.history_summary().redo_units, n as usize);
    }
}
#[test]
fn independent_runtime_recipes_24() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../contracts/extensions/v1/recipe-vectors.json"
    ))
    .unwrap();
    let documents = &corpus["documents"];
    let compiler = &corpus["compiler_cases"][0];
    let mut failures = vec![];
    for case in corpus["runtime_cases"].as_array().unwrap() {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let id = case["id"].as_str().unwrap();
            println!("executing {id}");
            let registry = compile_json(
                compiler["input_json"].as_str().unwrap().as_bytes(),
                &[],
                CompilerLimits::default(),
                &mut WorkMeter::new(WorkLimits::default()),
            )
            .unwrap();
            let initial = &documents[case["initial_document"].as_str().unwrap()];
            let binding =
                ProfileBinding::new(PREFIX, "1.0.0", "org.example.recipes/json", 1, &[]).unwrap();
            let work_cap = Rc::new(Cell::new(None));
            let codec_calls = Rc::new(Cell::new(0));
            let finalizer_calls = Rc::new(Cell::new(0));
            let fixture = Fixture {
                binding: binding.clone(),
                registry,
                initial: Document {
                    children: vec![node(initial)],
                },
                join: id.starts_with("RR017") || id.starts_with("RR018"),
                work_cap: work_cap.clone(),
                codec_calls: codec_calls.clone(),
                finalizer_calls: finalizer_calls.clone(),
                compiled_calls: Rc::new(Cell::new(0)),
                catalog: vec![],
            };
            let provider =
                Recipes::new(fixture, &mut WorkMeter::new(WorkLimits::default())).unwrap();
            let mut s = Session::open(
                provider,
                &binding,
                b"bounded trusted literal",
                AdmissionMode::Strict,
                AccessMode::Editable,
            )
            .unwrap();
            let mut ids = BTreeMap::new();
            let root = s
                .node(s.key(), s.root(s.key()).unwrap())
                .unwrap()
                .children()[0];
            assert_graph(&s, root, initial, &mut ids);
            s.set_selection(
                s.key(),
                0,
                selection(&case["initial_selection"], &ids).unwrap(),
            )
            .unwrap();
            if !case["initial_stored_marks"].is_null() {
                panic!("initial stored marks fixture needs explicit setter");
            }
            if case.get("profile_work_limits").is_some() {
                work_cap.set(Some(WorkLimits { units: 0, bytes: 0 }));
            }
            let payload: Value =
                serde_json::from_str(case["payload_json"].as_str().unwrap()).unwrap();
            let intent = RecipeIntent {
                id: case["command_id"].as_str().unwrap().into(),
                nodes: payload["arguments"]["nodes"]
                    .as_object()
                    .unwrap()
                    .iter()
                    .map(|(name, value)| {
                        (
                            name.clone(),
                            ids[value.as_str().unwrap().strip_prefix("$node.").unwrap()],
                        )
                    })
                    .collect(),
                values: attrs(&payload["arguments"]["values"]),
            };
            let mut request =
                CommandRequest::new(s.key(), 0, s.selection_epoch(), Intent::Recipe(intent));
            if case.get("request_work_limits").is_some() {
                request.limits.work = WorkLimits { units: 0, bytes: 0 };
            }
            let before = facets(&s);
            let query = s.query_command(&request);
            for _ in 0..3 {
                assert_eq!(
                    s.query_command(&request),
                    query,
                    "{id}: repeated actual query"
                );
            }
            assert_eq!(
                facets(&s),
                before,
                "{id}: queries preserve every public committed facet"
            );
            let qwork = match &query {
                CommandAvailability::Available { effect, work, .. } => {
                    assert_eq!(case["expected_query"]["available"], true, "{id}: {query:?}");
                    assert_eq!(
                        *effect,
                        if case["expected"]["outcome"] == "changed" {
                            CommandEffect::Changed
                        } else {
                            CommandEffect::Unchanged
                        }
                    );
                    *work
                }
                CommandAvailability::Unavailable { work, .. } => {
                    assert_eq!(case["expected_query"]["available"], false);
                    *work
                }
            };
            let outcome = s.execute_command(&request);
            match outcome {
                CommandOutcome::Refused { reason, work, .. } => {
                    assert_eq!(qwork, work);
                    assert_eq!(facets(&s), before, "{id}: late refusal atomicity");
                    let CommandAvailability::Unavailable {
                        reason: query_reason,
                        ..
                    } = &query
                    else {
                        panic!("query/execute disagree")
                    };
                    assert_eq!(reason, *query_reason, "{id}: same actual refusal code");
                    println!(
                        "{id}: actual query/execute refusal {reason}, same work, public facets unchanged"
                    );
                    assert_eq!(reason, case["expected"]["code"].as_str().unwrap(), "{id}");
                }
                CommandOutcome::Completed {
                    outcome: DispatchOutcome::Changed(event),
                    ..
                } => {
                    assert_eq!(case["expected"]["outcome"], "changed", "{id}");
                    assert_eq!(qwork, event.work);
                    let frames = case["expected"]["frames"].as_array().unwrap();
                    assert_eq!(frames.len(), 3);
                    assert_frame(&s, &frames[0], documents, &mut ids);
                    let retired_right = if id.starts_with("RR017") {
                        assert_eq!(event.normalization_operations, 1);
                        let joined: Vec<_> = event
                            .map
                            .steps()
                            .iter()
                            .filter_map(|step| match step {
                                editor_engine::mapping::StepMap::JoinText {
                                    left,
                                    right,
                                    left_len,
                                    right_len,
                                } => Some((*left, *right, *left_len, *right_len)),
                                _ => None,
                            })
                            .collect();
                        assert_eq!(joined.len(), 1);
                        let (left, right, left_len, right_len) = joined[0];
                        assert_eq!(left, ids["new-left"]);
                        assert_eq!((left_len, right_len), (1, 1));
                        assert!(s.node(s.key(), right).is_err());
                        assert_eq!(
                            event
                                .map
                                .map(Position::Text {
                                    leaf: right,
                                    utf16: Utf16Offset::new(1),
                                    affinity: Affinity::After
                                })
                                .position(),
                            Some(Position::Text {
                                leaf: left,
                                utf16: Utf16Offset::new(2),
                                affinity: Affinity::After
                            })
                        );
                        Some(right)
                    } else {
                        None
                    };
                    let applied_ids: BTreeSet<_> = graph(&s).iter().map(|(id, _)| *id).collect();
                    for (direction, frame) in [HistoryDirection::Undo, HistoryDirection::Redo]
                        .into_iter()
                        .zip(&frames[1..])
                    {
                        let r = HistoryRequest::new(
                            s.key(),
                            s.revision(),
                            s.selection_epoch(),
                            s.history_summary().epoch,
                            direction,
                        );
                        let before = facets(&s);
                        let query = s.query_history(&r);
                        assert_eq!(facets(&s), before);
                        let HistoryAvailability::Available { work, .. } = query else {
                            panic!("{id}: {query:?}")
                        };
                        let result = s.execute_history(&r);
                        let HistoryOutcome::Completed(event) = result else {
                            panic!("{id}: {result:?}")
                        };
                        assert_eq!(work, event.work);
                        assert_frame(&s, frame, documents, &mut ids);
                        if let Some(right) = retired_right {
                            assert!(
                                s.node(s.key(), right).is_err(),
                                "normalized-away identity must remain retired"
                            );
                        }
                    }
                    assert_eq!(
                        graph(&s).iter().map(|(id, _)| *id).collect::<BTreeSet<_>>(),
                        applied_ids,
                        "{id}: redo exactly restores live IDs"
                    );
                }
                CommandOutcome::Completed {
                    outcome: DispatchOutcome::Unchanged { work, .. },
                    ..
                } => {
                    assert_eq!(case["expected"]["outcome"], "unchanged");
                    assert_eq!(qwork, work);
                    assert_frame(&s, &case["expected"], documents, &mut ids);
                    if case["expected"]["effect"] == "unchanged" {
                        assert_eq!(facets(&s), before);
                    }
                    if id.starts_with("RR023") {
                        assert!(finalizer_calls.get() >= 5);
                    }
                }
                other => panic!("{id}: unexpected {other:?}"),
            }
            if let CommandAvailability::Unavailable { reason, .. } = &query {
                assert_eq!(
                    *reason,
                    case["expected_query"]["code"].as_str().unwrap(),
                    "{id}"
                );
            }
            assert_eq!(
                codec_calls.get(),
                0,
                "{id}: ordinary planning/replay never crosses snapshot codec"
            );
        }));
        if result.is_err() {
            failures.push(case["id"].as_str().unwrap());
        }
    }
    assert!(
        failures.is_empty(),
        "failed independent runtime cases: {failures:?}"
    );
    assert_eq!(corpus["runtime_cases"].as_array().unwrap().len(), 24);
}

fn catalog_fixture(registry: FrozenRegistry, catalog: Vec<String>) -> Fixture {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../contracts/extensions/v1/recipe-vectors.json"
    ))
    .unwrap();
    Fixture {
        binding: ProfileBinding::new(PREFIX, "1.0.0", "org.example.recipes/json", 1, &[]).unwrap(),
        registry,
        initial: Document {
            children: vec![node(&corpus["documents"]["initial"])],
        },
        join: false,
        work_cap: Rc::new(Cell::new(None)),
        codec_calls: Rc::new(Cell::new(0)),
        finalizer_calls: Rc::new(Cell::new(0)),
        compiled_calls: Rc::new(Cell::new(0)),
        catalog,
    }
}
#[test]
fn constructor_requires_the_exact_valid_mandatory_compiled_catalog() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../contracts/extensions/v1/recipe-vectors.json"
    ))
    .unwrap();
    let c = &corpus["compiler_cases"][2];
    let mandatory = serde_json::from_value::<Vec<editor_registry::ExtensionDescriptor>>(
        c["mandatory_registrations"].clone(),
    )
    .unwrap();
    let compile = || {
        compile_json(
            c["input_json"].as_str().unwrap().as_bytes(),
            &mandatory,
            CompilerLimits::default(),
            &mut WorkMeter::new(WorkLimits::default()),
        )
        .unwrap()
    };
    let expected = compile().compiled_catalog_ids().to_vec();
    assert!(!expected.is_empty());
    for catalog in [
        vec![],
        vec!["org.example.recipes/unregistered".into()],
        vec![expected[0].clone(), expected[0].clone()],
        vec!["invalid".into()],
    ] {
        let result = Recipes::new(
            catalog_fixture(compile(), catalog),
            &mut WorkMeter::new(WorkLimits::default()),
        );
        assert!(matches!(result,Err(e) if e.code.as_str()=="registry.invalid_recipe"));
    }
    let provider = Recipes::new(
        catalog_fixture(compile(), expected.clone()),
        &mut WorkMeter::new(WorkLimits::default()),
    )
    .unwrap();
    let binding = provider.binding().clone();
    let calls = provider.profile().compiled_calls.clone();
    let mut session = Session::open(
        provider,
        &binding,
        b"trusted",
        AdmissionMode::Strict,
        AccessMode::Editable,
    )
    .unwrap();
    let id = expected[0].clone();
    let request = CommandRequest::new(session.key(), 0, 0, Intent::Compiled(id));
    assert!(matches!(
        session.query_command(&request),
        CommandAvailability::Available { .. }
    ));
    assert!(matches!(
        session.execute_command(&request),
        CommandOutcome::Completed {
            outcome: DispatchOutcome::Unchanged { .. },
            ..
        }
    ));
    assert_eq!(calls.get(), 2);
    let before = facets(&session);
    let request = CommandRequest::new(
        session.key(),
        0,
        0,
        Intent::Compiled("org.example.recipes/noop".into()),
    );
    assert!(matches!(
        session.query_command(&request),
        CommandAvailability::Unavailable {
            reason: "registry.invalid_recipe",
            ..
        }
    ));
    assert!(matches!(
        session.execute_command(&request),
        CommandOutcome::Refused {
            reason: "registry.invalid_recipe",
            ..
        }
    ));
    assert_eq!(calls.get(), 2);
    assert_eq!(facets(&session), before);
}

#[test]
fn index_capability_refuses_above_u32_before_host_width_conversion() {
    // This is a declared bridge/provider index capability, not a restriction on
    // Attribute numbers. The literals separately exercise full u64 attributes.
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../contracts/extensions/v1/recipe-vectors.json"
    ))
    .unwrap();
    let mut descriptor: Value =
        serde_json::from_str(corpus["compiler_cases"][0]["input_json"].as_str().unwrap()).unwrap();
    for extension in descriptor["extensions"].as_array_mut().unwrap() {
        for command in extension["commands"].as_array_mut().unwrap() {
            if command["id"] == "org.example.recipes/replace-text" {
                command["parameters"]["from"]["schema"]["max"] =
                    Value::String("18446744073709551615".into());
                command["parameters"]["to"]["schema"]["max"] =
                    Value::String("18446744073709551615".into());
            }
        }
    }
    for offset in [4_294_967_296_u64, u64::MAX] {
        let registry = compile_json(
            serde_json::to_string(&descriptor).unwrap().as_bytes(),
            &[],
            CompilerLimits::default(),
            &mut WorkMeter::new(WorkLimits::default()),
        )
        .unwrap();
        let provider = Recipes::new(
            catalog_fixture(registry, vec![]),
            &mut WorkMeter::new(WorkLimits::default()),
        )
        .unwrap();
        let binding = provider.binding().clone();
        let mut s = Session::open(
            provider,
            &binding,
            b"trusted",
            AdmissionMode::Strict,
            AccessMode::Editable,
        )
        .unwrap();
        let doc = s
            .node(s.key(), s.root(s.key()).unwrap())
            .unwrap()
            .children()[0];
        let paragraph = s.node(s.key(), doc).unwrap().children()[0];
        let leaf = s.node(s.key(), paragraph).unwrap().children()[0];
        let request = CommandRequest::new(
            s.key(),
            0,
            0,
            Intent::Recipe(RecipeIntent {
                id: "org.example.recipes/replace-text".into(),
                nodes: BTreeMap::from([("leaf".into(), leaf)]),
                values: BTreeMap::from([
                    ("from".into(), Attribute::Number(offset.into())),
                    ("to".into(), Attribute::Number(offset.into())),
                    ("text".into(), Attribute::String("X".into())),
                ]),
            }),
        );
        let before = facets(&s);
        let query = s.query_command(&request);
        let CommandAvailability::Unavailable { reason, work, .. } = query else {
            panic!("{query:?}")
        };
        assert_eq!(reason, "registry.resource_limit_exceeded");
        let outcome = s.execute_command(&request);
        let CommandOutcome::Refused {
            reason,
            work: actual,
            ..
        } = outcome
        else {
            panic!("{outcome:?}")
        };
        assert_eq!(reason, "registry.resource_limit_exceeded");
        assert_eq!(work, actual);
        assert_eq!(facets(&s), before);
    }
}
