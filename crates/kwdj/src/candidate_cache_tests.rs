// SPDX-License-Identifier: MIT OR Apache-2.0
//! Independent native checkpoint and sparse-proof tests. Fixture diffing is a
//! test oracle, deliberately separate from the production engine impact code.
use super::*;
use editor_core::candidate::BorrowedNode;
use editor_core::document::{Document, Node as CoreNode};
use editor_core::transaction::{WorkLimits, WorkTrace};
use serde_json::{Value, json};

#[derive(Clone, PartialEq, Eq)]
struct Record {
    node: CoreNode,
    parent: usize,
    children: Vec<usize>,
}
#[derive(Clone, Default)]
struct View {
    roots: Vec<usize>,
    nodes: BTreeMap<usize, Record>,
}
impl View {
    fn from_document(document: Document) -> Self {
        fn add(
            mut node: CoreNode,
            parent: usize,
            next: &mut usize,
            nodes: &mut BTreeMap<usize, Record>,
        ) -> usize {
            let id = *next;
            *next += 1;
            let children = std::mem::take(&mut node.children)
                .into_iter()
                .map(|n| add(n, id, next, nodes))
                .collect();
            nodes.insert(
                id,
                Record {
                    node,
                    parent,
                    children,
                },
            );
            id
        }
        let mut view = Self::default();
        let mut next = 1;
        view.roots = document
            .children
            .into_iter()
            .map(|n| add(n, 0, &mut next, &mut view.nodes))
            .collect();
        view
    }
    fn snapshot(&self) -> Document {
        fn node(view: &View, id: usize) -> CoreNode {
            let r = &view.nodes[&id];
            let mut n = r.node.clone();
            n.children = r.children.iter().map(|id| node(view, *id)).collect();
            n
        }
        Document {
            children: self.roots.iter().map(|id| node(self, *id)).collect(),
        }
    }
    fn ordinal(&self, id: usize) -> Option<usize> {
        let r = self.nodes.get(&id)?;
        let children = if r.parent == 0 {
            &self.roots
        } else {
            &self.nodes[&r.parent].children
        };
        children.iter().position(|n| *n == id)
    }
    fn first_text(&self) -> usize {
        *self
            .nodes
            .iter()
            .find(|(_, r)| r.node.text.is_some())
            .unwrap()
            .0
    }
}
impl CandidateRead for View {
    type Id = usize;
    fn root(&self) -> usize {
        0
    }
    fn roots(&self) -> &[usize] {
        &self.roots
    }
    fn node(&self, id: usize) -> Option<BorrowedNode<'_, usize>> {
        let r = self.nodes.get(&id)?;
        Some(BorrowedNode {
            type_id: &r.node.type_id,
            primitive: r.node.primitive,
            attributes: &r.node.attributes,
            marks: &r.node.marks,
            text: r.node.text.as_deref(),
            children: &r.children,
            parent: r.parent,
        })
    }
}
struct Changes {
    before: View,
    after: View,
    direct: Vec<usize>,
    forest: Vec<DirtyNode<usize>>,
}
impl Changes {
    fn new(before: View, after: View) -> Self {
        let all: BTreeSet<_> = before
            .nodes
            .keys()
            .chain(after.nodes.keys())
            .copied()
            .collect();
        let direct: Vec<_> = all
            .into_iter()
            .filter(|id| before.nodes.get(id) != after.nodes.get(id))
            .collect();
        let mut closure = BTreeSet::from([0]);
        for id in &direct {
            for view in [&before, &after] {
                let mut cursor = *id;
                while cursor != 0 {
                    closure.insert(cursor);
                    let Some(record) = view.nodes.get(&cursor) else {
                        break;
                    };
                    cursor = record.parent;
                }
            }
        }
        let forest = closure
            .iter()
            .map(|id| {
                let old = before.nodes.get(id);
                let new = after.nodes.get(id);
                let dirty_children = closure
                    .iter()
                    .copied()
                    .filter(|child| {
                        *child != 0
                            && (before.nodes.get(child).is_some_and(|r| r.parent == *id)
                                || after.nodes.get(child).is_some_and(|r| r.parent == *id))
                    })
                    .collect();
                DirtyNode {
                    id: *id,
                    direct: direct.contains(id),
                    payload_changed: old.map(|r| &r.node) != new.map(|r| &r.node),
                    children_changed: if *id == 0 {
                        before.roots != after.roots
                    } else {
                        old.map(|r| &r.children) != new.map(|r| &r.children)
                    },
                    before_parent: old.map(|r| r.parent),
                    after_parent: new.map(|r| r.parent),
                    before_ordinal: before.ordinal(*id),
                    after_ordinal: after.ordinal(*id),
                    dirty_children,
                }
            })
            .collect();
        Self {
            before,
            after,
            direct,
            forest,
        }
    }
}
impl CandidateRead for Changes {
    type Id = usize;
    fn root(&self) -> usize {
        0
    }
    fn roots(&self) -> &[usize] {
        self.after.roots()
    }
    fn node(&self, id: usize) -> Option<BorrowedNode<'_, usize>> {
        self.after.node(id)
    }
}
impl CandidateChanges for Changes {
    fn before_node(&self, id: usize) -> Option<BorrowedNode<'_, usize>> {
        self.before.node(id)
    }
    fn before_roots(&self) -> &[usize] {
        self.before.roots()
    }
    fn direct_changes(&self) -> &[usize] {
        &self.direct
    }
    fn dirty_forest(&self) -> &[DirtyNode<usize>] {
        &self.forest
    }
    fn roots_changed(&self) -> bool {
        self.before.roots != self.after.roots
    }
    fn mutation_stamp(&self) -> u64 {
        1
    }
}

#[derive(Default)]
struct Facts {
    mode: Cell<u8>,
    calls: RefCell<Vec<Uuid>>,
}
impl IdentityResolver for Facts {
    fn resolve_media(&self, id: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        self.resolve_reference(id)
    }
    fn resolve_reference(&self, id: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        self.calls.borrow_mut().push(*id);
        match self.mode.get() {
            0 => Ok(IdentityStatus::Exists),
            1 => Ok(IdentityStatus::Missing),
            _ => Err(IdentityResolverError::Unavailable),
        }
    }
}
fn source(profile: Profile, content: Value) -> View {
    let admitted=crate::validate_normalized_json(&serde_json::to_vec(&json!({"schema":"klenwriter.document","schema_version":1,"profile":profile,"content":content})).unwrap(),&Facts::default()).unwrap();
    View::from_document(admitted.document().to_core_document())
}
fn paragraph(text: &str) -> Value {
    json!({"type":"paragraph","content":[{"type":"text","text":text}]})
}
fn seed_view(profile: Profile, view: &View) -> KwdjCache<usize> {
    seed(
        profile,
        view,
        Limits::default(),
        AdmissionBudget::default(),
        &mut WorkMeter::new(WorkLimits::default()),
    )
    .unwrap()
}
fn check(
    profile: Profile,
    changes: &Changes,
    cache: &KwdjCache<usize>,
    facts: &Facts,
) -> (PreparedValidation<KwdjCache<usize>>, WorkTrace) {
    let mut work = WorkMeter::new(WorkLimits::default());
    assert!(
        normalize(
            profile,
            changes,
            cache,
            facts,
            Limits::default(),
            AdmissionBudget::default(),
            &mut work
        )
        .unwrap()
        .is_empty()
    );
    let checked = validate(
        profile,
        changes,
        cache,
        facts,
        Limits::default(),
        AdmissionBudget::default(),
        &mut work,
    )
    .unwrap();
    let native = crate::admit_core_document(
        &changes.after.snapshot(),
        profile,
        &Facts::default(),
        Limits::default(),
    )
    .unwrap();
    assert_eq!(
        checked.stats.canonical_bytes,
        native.canonical_json().len() as u64
    );
    assert_eq!(checked.stats.nodes, changes.after.nodes.len() as u64);
    assert_eq!(work.trace().phase(WorkPhase::FullFallback).visits, 0);
    (checked, work.trace())
}

#[test]
fn local_text_counts_match_full_codec_across_unicode_escapes_and_repeated_sparse_publications() {
    let mut before = source(
        Profile::Prose,
        json!([paragraph("initial"), paragraph("untouched")]),
    );
    let mut cache = seed_view(Profile::Prose, &before);
    let leaf = before.first_text();
    for text in ["Я😀", "\"\\\t", "e\u{301}", "a long replacement", "x"] {
        let mut after = before.clone();
        after.nodes.get_mut(&leaf).unwrap().node.text = Some(text.into());
        let changes = Changes::new(before, after.clone());
        let (checked, trace) = check(Profile::Prose, &changes, &cache, &Facts::default());
        assert_eq!(trace.phase(WorkPhase::Header).visits, 3);
        checked.cache.publish(&mut cache);
        let reseeded = seed_view(Profile::Prose, &after);
        assert_eq!(
            cache.root_memo.as_ref().unwrap().aggregate.sum.wire,
            reseeded.root_memo.as_ref().unwrap().aggregate.sum.wire
        );
        before = after;
    }
}

#[test]
fn wide_roots_quote_and_verse_do_not_scan_unchanged_siblings() {
    for kind in ["roots", "quote", "verse"] {
        let mut baseline = None;
        for width in [1, 16, 128, 1024] {
            let content = match kind {
                "roots" => Value::Array((0..width).map(|_| paragraph("a")).collect()),
                "quote" => {
                    json!([{"type":"blockquote","content":(0..width).map(|_|paragraph("a")).collect::<Vec<_>>() }])
                }
                _ => {
                    json!([{"type":"verse","content":(0..width).map(|_|json!({"type":"verse_line","content":[{"type":"text","text":"a"}]})).collect::<Vec<_>>() }])
                }
            };
            let profile = if kind == "verse" {
                Profile::Poetry
            } else {
                Profile::Prose
            };
            let before = source(profile, content);
            let cache = seed_view(profile, &before);
            let mut after = before.clone();
            let leaf = after.first_text();
            after.nodes.get_mut(&leaf).unwrap().node.text = Some("b".into());
            let changes = Changes::new(before, after);
            let (_, trace) = check(profile, &changes, &cache, &Facts::default());
            let counts = [
                WorkPhase::Header,
                WorkPhase::StaticValidation,
                WorkPhase::Normalization,
                WorkPhase::Serialization,
            ]
            .map(|phase| trace.phase(phase));
            if let Some(first) = baseline {
                assert_eq!(counts, first, "{kind} width {width}");
            } else {
                baseline = Some(counts);
            }
        }
    }
}

#[test]
fn unchanged_styled_neighbors_do_not_trigger_full_inline_group_normalization() {
    let mut baseline = None;
    for width in [1, 16, 128, 1024] {
        let leaves: Vec<_> = (0..width)
            .map(|i| {
                if i % 2 == 0 {
                    json!({"type":"text","text":"a","marks":[{"type":"strong"}]})
                } else {
                    json!({"type":"text","text":"a"})
                }
            })
            .collect();
        let before = source(
            Profile::Prose,
            json!([{"type":"paragraph","content":leaves}]),
        );
        let cache = seed_view(Profile::Prose, &before);
        let mut after = before.clone();
        let leaf = after.first_text();
        after.nodes.get_mut(&leaf).unwrap().node.text = Some("b".into());
        let changes = Changes::new(before, after);
        let (_, trace) = check(Profile::Prose, &changes, &cache, &Facts::default());
        let counts = [
            WorkPhase::Header,
            WorkPhase::StaticValidation,
            WorkPhase::Normalization,
            WorkPhase::Serialization,
        ]
        .map(|p| trace.phase(p));
        if let Some(first) = baseline {
            assert_eq!(counts, first);
        } else {
            baseline = Some(counts);
        }
    }
}

#[test]
fn structural_reorder_and_removal_keep_exact_compositional_counts_and_paths() {
    let before = source(
        Profile::Prose,
        json!([paragraph("a"), paragraph("bb"), paragraph("ccc")]),
    );
    let mut cache = seed_view(Profile::Prose, &before);
    let mut after = before.clone();
    after.roots.swap(0, 2);
    let changes = Changes::new(before, after.clone());
    let (checked, _) = check(Profile::Prose, &changes, &cache, &Facts::default());
    checked.cache.publish(&mut cache);
    let mut next = after.clone();
    let root = next.roots.remove(1);
    let child = next.nodes[&root].children[0];
    next.nodes.remove(&root);
    next.nodes.remove(&child);
    let changes = Changes::new(after, next);
    check(Profile::Prose, &changes, &cache, &Facts::default());
}

#[test]
fn untouched_reference_facts_are_fresh_deduplicated_and_retry_without_cache_mutation() {
    let id = "123e4567-e89b-42d3-a456-426614174000";
    let before = source(
        Profile::Prose,
        json!([paragraph("edited"),{"type":"paragraph","content":[{"type":"text","text":"ref","marks":[{"type":"reference_link","attrs":{"reference_entity_id":id}}]}]}, {"type":"paragraph","content":[{"type":"text","text":"same","marks":[{"type":"reference_link","attrs":{"reference_entity_id":id}}]}]}]),
    );
    let cache = seed_view(Profile::Prose, &before);
    let mut after = before.clone();
    let leaf = after.first_text();
    after.nodes.get_mut(&leaf).unwrap().node.text = Some("changed".into());
    let changes = Changes::new(before, after);
    let facts = Facts::default();
    let (_, trace) = check(Profile::Prose, &changes, &cache, &facts);
    assert_eq!(facts.calls.borrow().len(), 1);
    assert_eq!(trace.phase(WorkPhase::Identity).visits, 1);
    for mode in [1, 2] {
        facts.calls.borrow_mut().clear();
        facts.mode.set(mode);
        let error = match validate(
            Profile::Prose,
            &changes,
            &cache,
            &facts,
            Limits::default(),
            AdmissionBudget::default(),
            &mut WorkMeter::new(WorkLimits::default()),
        ) {
            Err(e) => e,
            Ok(_) => panic!("changed fact must refuse"),
        };
        let native = crate::admit_core_document(
            &changes.after.snapshot(),
            Profile::Prose,
            &facts,
            Limits::default(),
        )
        .unwrap_err();
        assert_eq!(error, native);
        assert_eq!(cache.nodes.len(), changes.before.nodes.len());
    }
    facts.mode.set(0);
    facts.calls.borrow_mut().clear();
    check(Profile::Prose, &changes, &cache, &facts);
    assert_eq!(facts.calls.borrow().len(), 1);
}

#[test]
fn operational_refusal_propagates_without_global_fallback_or_identity_calls() {
    let before = source(Profile::Prose, json!([paragraph("a")]));
    let cache = seed_view(Profile::Prose, &before);
    let mut after = before.clone();
    let leaf = after.first_text();
    after.nodes.get_mut(&leaf).unwrap().node.text = Some("b".into());
    let changes = Changes::new(before, after);
    let facts = Facts::default();
    let mut work = WorkMeter::new(WorkLimits {
        units: 1,
        bytes: 1024,
    });
    let result = validate(
        Profile::Prose,
        &changes,
        &cache,
        &facts,
        Limits::default(),
        AdmissionBudget::default(),
        &mut work,
    );
    assert!(matches!(
        result,
        Err(KwdjError {
            code: KwdjErrorCode::OperationalBudgetExceeded,
            ..
        })
    ));
    assert_eq!(work.trace().phase(WorkPhase::FullFallback).visits, 0);
    assert!(facts.calls.borrow().is_empty());
}

#[test]
fn invalid_verse_structure_falls_back_to_exact_native_error() {
    let before = source(
        Profile::Poetry,
        json!([{"type":"verse","content":[{"type":"verse_line","content":[{"type":"text","text":"a"}]},{"type":"stanza_break","attrs":{"blank_lines":1}},{"type":"verse_line","content":[{"type":"text","text":"b"}]}]}]),
    );
    let cache = seed_view(Profile::Poetry, &before);
    let mut after = before.clone();
    let verse = after.roots[0];
    after.nodes.get_mut(&verse).unwrap().children.swap(0, 1);
    let changes = Changes::new(before, after);
    let actual = match validate(
        Profile::Poetry,
        &changes,
        &cache,
        &Facts::default(),
        Limits::default(),
        AdmissionBudget::default(),
        &mut WorkMeter::new(WorkLimits::default()),
    ) {
        Err(e) => e,
        Ok(_) => panic!("boundary stanza must refuse"),
    };
    let native = crate::admit_core_document(
        &changes.after.snapshot(),
        Profile::Poetry,
        &Facts::default(),
        Limits::default(),
    )
    .unwrap_err();
    assert_eq!(actual, native);
}

#[test]
fn all_29_accepted_corpus_documents_have_exact_cached_wire_counts() {
    let root =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../contracts/kwdj/v1/fixtures");
    let mut count = 0;
    for name in ["positive", "negative", "mixed"] {
        let fixture: Value =
            serde_json::from_slice(&std::fs::read(root.join(format!("{name}.json"))).unwrap())
                .unwrap();
        for group in fixture["fixtures"].as_array().unwrap() {
            for case in group["cases"].as_array().unwrap() {
                if case["expected"]["outcome"] != "accepted" || !case["kwdj"].is_object() {
                    continue;
                }
                let admitted = crate::decode_normalize_validate(
                    &serde_json::to_vec(&case["kwdj"]).unwrap(),
                    &Facts::default(),
                )
                .unwrap();
                let profile = admitted.document().profile();
                let view = View::from_document(admitted.document().to_core_document());
                let cache = seed_view(profile, &view);
                let changes = Changes::new(view.clone(), view);
                let (checked, _) = check(profile, &changes, &cache, &Facts::default());
                assert_eq!(
                    checked.stats.canonical_bytes,
                    admitted.canonical_json().len() as u64,
                    "{} / {}",
                    group["id"],
                    case["name"]
                );
                count += 1;
            }
        }
    }
    assert_eq!(count, 29);
}

fn copy_subtree(view: &mut View, id: usize, parent: usize, next: &mut usize) -> usize {
    let mut record = view.nodes[&id].clone();
    let new = *next;
    *next += 1;
    record.parent = parent;
    record.children = record
        .children
        .iter()
        .map(|child| copy_subtree(view, *child, new, next))
        .collect();
    view.nodes.insert(new, record);
    new
}
#[test]
fn each_seven_reduced_limit_crossings_matches_full_authoritative_diagnostic() {
    let table = json!([{"type":"table","content":[{"type":"table_row","content":[{"type":"table_cell","content":[{"type":"paragraph","content":[]}]}]}]}]);
    for name in [
        "document_bytes",
        "tree_depth",
        "node_count",
        "text_length",
        "table_rows",
        "table_effective_columns",
        "attribute_length",
    ] {
        let before = source(
            Profile::Prose,
            match name {
                "table_rows" | "table_effective_columns" => table.clone(),
                "attribute_length" => {
                    json!([{"type":"code_block","attrs":{"language":"a"},"content":[]}])
                }
                _ => json!([paragraph("a")]),
            },
        );
        let mut after = before.clone();
        let mut limits = Limits::default();
        let root = after.roots[0];
        match name {
            "document_bytes" => {
                let native = crate::admit_core_document(
                    &before.snapshot(),
                    Profile::Prose,
                    &Facts::default(),
                    limits,
                )
                .unwrap();
                limits.document_bytes = native.canonical_json().len() as u64;
                let text = after.first_text();
                after.nodes.get_mut(&text).unwrap().node.text = Some("aa".into());
            }
            "tree_depth" => {
                limits.tree_depth = 2;
                let mut paragraph = after.nodes[&root].clone();
                paragraph.parent = root;
                let text = paragraph.children[0];
                after.nodes.get_mut(&text).unwrap().parent = 100;
                let node = &mut after.nodes.get_mut(&root).unwrap().node;
                node.type_id = "org.klenwriter.kwdj/blockquote".into();
                node.primitive = editor_core::document::Primitive::Container;
                after.nodes.get_mut(&root).unwrap().children = vec![100];
                after.nodes.insert(100, paragraph);
            }
            "node_count" => {
                limits.node_count = 2;
                let mut record = after.nodes[&root].clone();
                record.children.clear();
                after.nodes.insert(100, record);
                after.roots.push(100);
            }
            "text_length" => {
                limits.text_leaf_bytes = 1;
                let text = after.first_text();
                after.nodes.get_mut(&text).unwrap().node.text = Some("aa".into());
            }
            "table_rows" => {
                limits.table_rows = 1;
                let row = after.nodes[&root].children[0];
                let added = copy_subtree(&mut after, row, root, &mut 100);
                after.nodes.get_mut(&root).unwrap().children.push(added);
            }
            "table_effective_columns" => {
                limits.table_effective_columns = 1;
                let row = after.nodes[&root].children[0];
                let cell = after.nodes[&row].children[0];
                after.nodes.get_mut(&cell).unwrap().node.attributes.insert(
                    "colspan".into(),
                    editor_core::document::Attribute::Number(2.into()),
                );
            }
            _ => {
                limits.authored_attribute_bytes = 1;
                after.nodes.get_mut(&root).unwrap().node.attributes.insert(
                    "language".into(),
                    editor_core::document::Attribute::String("aa".into()),
                );
            }
        }
        crate::admit_core_document(
            &before.snapshot(),
            Profile::Prose,
            &Facts::default(),
            limits,
        )
        .unwrap();
        let cache = seed(
            Profile::Prose,
            &before,
            limits,
            AdmissionBudget::default(),
            &mut WorkMeter::new(WorkLimits::default()),
        )
        .unwrap();
        let changes = Changes::new(before, after);
        let native = crate::admit_core_document(
            &changes.after.snapshot(),
            Profile::Prose,
            &Facts::default(),
            limits,
        )
        .unwrap_err();
        assert_eq!(native.context.limit, Some(name));
        let actual = match validate(
            Profile::Prose,
            &changes,
            &cache,
            &Facts::default(),
            limits,
            AdmissionBudget::default(),
            &mut WorkMeter::new(WorkLimits::default()),
        ) {
            Err(e) => e,
            Ok(_) => panic!("{name} must refuse"),
        };
        assert_eq!(actual, native, "{name}");
    }
}

#[test]
fn structural_root_insertion_has_linear_not_quadratic_path_work() {
    let mut baseline = 0;
    for width in [128, 1024] {
        let before = source(
            Profile::Prose,
            Value::Array((0..width).map(|_| paragraph("a")).collect()),
        );
        let cache = seed_view(Profile::Prose, &before);
        let mut after = before.clone();
        let original = after.roots[0];
        let inserted = copy_subtree(&mut after, original, 0, &mut 10000);
        after.roots.insert(0, inserted);
        let changes = Changes::new(before, after);
        let mut work = WorkMeter::new(WorkLimits::default());
        let checked = validate(
            Profile::Prose,
            &changes,
            &cache,
            &Facts::default(),
            Limits::default(),
            AdmissionBudget::default(),
            &mut work,
        )
        .unwrap();
        let native = crate::admit_core_document(
            &changes.after.snapshot(),
            Profile::Prose,
            &Facts::default(),
            Limits::default(),
        )
        .unwrap();
        assert_eq!(
            checked.stats.canonical_bytes,
            native.canonical_json().len() as u64
        );
        assert_eq!(work.trace().phase(WorkPhase::FullFallback).visits, 0);
        if baseline > 0 {
            assert!(
                work.usage().units < baseline * 12,
                "path work grew quadratically: {} vs {baseline}",
                work.usage().units
            );
        } else {
            baseline = work.usage().units;
        }
    }
}

#[test]
fn local_mark_changes_recheck_only_adjacent_inline_windows() {
    let mut baseline = None;
    for width in [16, 128, 1024] {
        let leaves: Vec<_> = (0..width)
            .map(|i| {
                if i % 2 == 0 {
                    json!({"type":"text","text":"a","marks":[{"type":"strong"}]})
                } else {
                    json!({"type":"text","text":"a"})
                }
            })
            .collect();
        let before = source(
            Profile::Prose,
            json!([{"type":"paragraph","content":leaves}]),
        );
        let cache = seed_view(Profile::Prose, &before);
        let leaf = before.first_text();
        let mut after = before.clone();
        after.nodes.get_mut(&leaf).unwrap().node.marks[0].type_id =
            "org.klenwriter.kwdj/emphasis".into();
        let changes = Changes::new(before.clone(), after);
        let (_, trace) = check(Profile::Prose, &changes, &cache, &Facts::default());
        let counts = [
            WorkPhase::Header,
            WorkPhase::StaticValidation,
            WorkPhase::Normalization,
            WorkPhase::Serialization,
        ]
        .map(|phase| trace.phase(phase));
        if let Some(first) = baseline {
            assert_eq!(counts, first);
        } else {
            baseline = Some(counts);
        }
        let mut merge = before.clone();
        merge.nodes.get_mut(&leaf).unwrap().node.marks.clear();
        let next = Changes::new(before, merge);
        let mut meter = WorkMeter::new(WorkLimits::default());
        let scoped = normalize(
            Profile::Prose,
            &next,
            &cache,
            &Facts::default(),
            Limits::default(),
            AdmissionBudget::default(),
            &mut meter,
        )
        .unwrap();
        let full = crate::edit_normalize::normalize_candidate(
            Profile::Prose,
            &next,
            &mut WorkMeter::new(WorkLimits::default()),
        )
        .unwrap();
        assert_eq!(scoped, full);
        assert_eq!(scoped.len(), 1);
        assert!(meter.trace().phase(WorkPhase::Normalization).visits < 12);
    }
}

#[test]
fn u64_max_geometry_and_unknown_payload_preserve_exact_full_diagnostics() {
    let before = source(
        Profile::Prose,
        json!([{"type":"table","content":[{"type":"table_row","content":[{"type":"table_cell","content":[{"type":"paragraph","content":[{"type":"text","text":"a"}]}]}]}]}]),
    );
    let cache = seed_view(Profile::Prose, &before);
    for mode in [0, 1, 2] {
        let mut after = before.clone();
        let root = after.roots[0];
        let row = after.nodes[&root].children[0];
        let cell = after.nodes[&row].children[0];
        let text = after.first_text();
        match mode {
            0 => {
                after.nodes.get_mut(&cell).unwrap().node.attributes.insert(
                    "colspan".into(),
                    editor_core::document::Attribute::Number(u64::MAX.into()),
                );
            }
            1 => {
                after.nodes.get_mut(&text).unwrap().node.attributes.insert(
                    "unknown".into(),
                    editor_core::document::Attribute::Boolean(true),
                );
            }
            _ => {
                after.nodes.get_mut(&text).unwrap().node.primitive =
                    editor_core::document::Primitive::HardBreak;
            }
        }
        let changes = Changes::new(before.clone(), after);
        let native = crate::admit_core_document(
            &changes.after.snapshot(),
            Profile::Prose,
            &Facts::default(),
            Limits::default(),
        )
        .unwrap_err();
        let actual = match validate(
            Profile::Prose,
            &changes,
            &cache,
            &Facts::default(),
            Limits::default(),
            AdmissionBudget::default(),
            &mut WorkMeter::new(WorkLimits::default()),
        ) {
            Err(e) => e,
            Ok(_) => panic!("unsafe geometry/header must refuse"),
        };
        if mode == 2 {
            // The generic snapshot bridge detects primitive drift at its final
            // root roundtrip; the established borrowed guard localizes it.
            let full = crate::candidate_validate::validate_outcome(
                Profile::Prose,
                &changes,
                &Facts::default(),
                Limits::default(),
                AdmissionBudget::default(),
                &mut WorkMeter::new(WorkLimits::default()),
            )
            .err()
            .unwrap();
            assert_eq!(actual, full);
            assert_eq!(actual.code, native.code);
            assert_eq!(
                actual.path,
                "/content/0/content/0/content/0/content/0/content/0"
            );
            assert_eq!(native.path, "");
        } else {
            assert_eq!(actual, native);
        }
    }
}
