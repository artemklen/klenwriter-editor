// SPDX-License-Identifier: MIT OR Apache-2.0
use editor_core::{
    candidate::{BorrowedNode, CandidateChanges, CandidateRead, DirtyNode},
    document::{Attribute, Attributes, Mark, Primitive},
    transaction::{WorkLimits, WorkMeter, WorkPhase},
};
use klenwriter_editor_registry::{CompilerLimits, RegistryErrorCode, SchemaCache, compile_json};
use std::collections::BTreeMap;
const P: &str = "org.test/p";
const T: &str = "org.test/text";
const B: &str = "org.test/br";
const M: &str = "org.test/mark";
#[derive(Clone)]
struct Record {
    ty: String,
    primitive: Primitive,
    attrs: Attributes,
    marks: Vec<Mark>,
    text: Option<String>,
    children: Vec<usize>,
    parent: usize,
}
#[derive(Clone)]
struct View {
    roots: Vec<usize>,
    nodes: BTreeMap<usize, Record>,
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
        self.nodes.get(&id).map(|n| BorrowedNode {
            type_id: &n.ty,
            primitive: n.primitive,
            attributes: &n.attrs,
            marks: &n.marks,
            text: n.text.as_deref(),
            children: &n.children,
            parent: n.parent,
        })
    }
}
struct Delta {
    before: View,
    after: View,
    direct: Vec<usize>,
    forest: Vec<DirtyNode<usize>>,
    root_changed: bool,
}
impl CandidateRead for Delta {
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
impl CandidateChanges for Delta {
    fn before_node(&self, id: usize) -> Option<BorrowedNode<'_, usize>> {
        self.before.node(id)
    }
    fn before_roots(&self) -> &[usize] {
        &self.before.roots
    }
    fn direct_changes(&self) -> &[usize] {
        &self.direct
    }
    fn dirty_forest(&self) -> &[DirtyNode<usize>] {
        &self.forest
    }
    fn roots_changed(&self) -> bool {
        self.root_changed
    }
    fn mutation_stamp(&self) -> u64 {
        1
    }
}
fn registry() -> klenwriter_editor_registry::FrozenRegistry {
    registry_root_bounds(1, 1_000_000)
}
fn registry_root_bounds(min: u64, max: u64) -> klenwriter_editor_registry::FrozenRegistry {
    let descriptor = serde_json::json!({"format":"editor-registry/1","profile":{"id":"org.test","version":"1.0.0","codec_id":"org.test/json","wire_version":1},"selected_extensions":[{"id":"org.owner/base","version":"1.0.0"}],"root":{"op":"repeat","item":{"op":"type","id":P},"min":min,"max":max},"mark_policy":{},"extensions":[{"id":"org.owner/base","version":"1.0.0","dependencies":[],"commands":[],"marks":[{"id":M,"attrs":{},"excludes":[]}],"nodes":[{"id":P,"primitive":"text_block","attrs":{},"children":{"op":"repeat","item":{"op":"type","id":T},"min":0,"max":1000000},"marks":[]},{"id":T,"primitive":"text","attrs":{"level":{"required":false,"value":{"kind":"integer","min":"1","max":"2"}}},"children":{"op":"empty"},"marks":[M]},{"id":B,"primitive":"hard_break","attrs":{},"children":{"op":"empty"},"marks":[]}]}]});
    compile_json(
        &serde_json::to_vec(&descriptor).unwrap(),
        &[],
        CompilerLimits::default(),
        &mut WorkMeter::new(WorkLimits::default()),
    )
    .unwrap()
}
fn view(width: usize) -> View {
    let mut nodes = BTreeMap::new();
    for i in 0..width {
        let p = i + 1;
        let t = 100000 + i;
        nodes.insert(
            p,
            Record {
                ty: P.into(),
                primitive: Primitive::TextBlock,
                attrs: Attributes::new(),
                marks: vec![],
                text: None,
                children: vec![t],
                parent: 0,
            },
        );
        nodes.insert(
            t,
            Record {
                ty: T.into(),
                primitive: Primitive::Text,
                attrs: Attributes::new(),
                marks: vec![],
                text: Some("Яe\u{301}😀".into()),
                children: vec![],
                parent: p,
            },
        );
    }
    View {
        roots: (1..=width).collect(),
        nodes,
    }
}
fn dirty(
    id: usize,
    parent: Option<usize>,
    ordinal: Option<usize>,
    payload: bool,
    children: bool,
    edges: Vec<usize>,
) -> DirtyNode<usize> {
    DirtyNode {
        id,
        direct: payload || children,
        payload_changed: payload,
        children_changed: children,
        before_parent: parent,
        after_parent: parent,
        before_ordinal: ordinal,
        after_ordinal: ordinal,
        dirty_children: edges,
    }
}
fn change(before: View) -> Delta {
    let after = before.clone();
    Delta {
        before,
        after,
        direct: vec![100000],
        forest: vec![
            dirty(0, None, None, false, false, vec![1]),
            dirty(1, Some(0), Some(0), false, false, vec![100000]),
            dirty(100000, Some(1), Some(0), true, false, vec![]),
        ],
        root_changed: false,
    }
}
fn seed(r: &klenwriter_editor_registry::FrozenRegistry, v: &View) -> SchemaCache<usize> {
    let mut c = SchemaCache::default();
    r.validate_full(v, &mut WorkMeter::new(WorkLimits::default()))
        .unwrap()
        .cache
        .publish(&mut c);
    c
}
#[test]
fn local_payload_has_flat_work_across_1024_unrelated_roots() {
    let r = registry();
    let mut usages = vec![];
    for width in [1, 1024] {
        let before = view(width);
        let cache = seed(&r, &before);
        let mut d = change(before);
        d.after
            .nodes
            .get_mut(&100000)
            .unwrap()
            .attrs
            .insert("level".into(), Attribute::Number(2.into()));
        let mut work = WorkMeter::new(WorkLimits::default());
        let result = r.validate_scoped(&d, &cache, &mut work).unwrap();
        assert_eq!(result.usage.metadata_visits, 1);
        assert_eq!(result.usage.grammar_visits, 0);
        assert_eq!(work.trace().phase(WorkPhase::FullFallback).visits, 0);
        usages.push(work.usage());
        r.validate_full(&d, &mut WorkMeter::new(WorkLimits::default()))
            .unwrap();
    }
    assert_eq!(usages[0], usages[1]);
}
#[test]
fn type_change_rechecks_parent_and_matches_full_error() {
    let r = registry();
    let before = view(32);
    let cache = seed(&r, &before);
    let mut d = change(before);
    let leaf = d.after.nodes.get_mut(&100000).unwrap();
    leaf.ty = B.into();
    leaf.primitive = Primitive::HardBreak;
    leaf.text = None;
    let a = r
        .validate_scoped(&d, &cache, &mut WorkMeter::new(WorkLimits::default()))
        .err()
        .unwrap();
    let b = r
        .validate_full(&d, &mut WorkMeter::new(WorkLimits::default()))
        .err()
        .unwrap();
    assert_eq!(a.code, RegistryErrorCode::GrammarMismatch);
    assert_eq!(a.code, b.code);
    assert_eq!(a.path, b.path);
    assert_eq!(a.child_index, Some(0));
}
#[test]
fn refused_prepare_leaves_cache_retryable_and_publishes_only_explicitly() {
    let r = registry();
    let before = view(4);
    let mut cache = seed(&r, &before);
    let mut d = change(before);
    d.after
        .nodes
        .get_mut(&100000)
        .unwrap()
        .attrs
        .insert("bad".into(), Attribute::Null);
    assert_eq!(
        r.validate_scoped(&d, &cache, &mut WorkMeter::new(WorkLimits::default()))
            .err()
            .unwrap()
            .code,
        RegistryErrorCode::UnknownAttribute
    );
    d.after.nodes.get_mut(&100000).unwrap().attrs.clear();
    d.after.nodes.get_mut(&100000).unwrap().marks.push(Mark {
        type_id: M.into(),
        attributes: Attributes::new(),
    });
    let prepared = r
        .validate_scoped(&d, &cache, &mut WorkMeter::new(WorkLimits::default()))
        .unwrap();
    r.validate_scoped(&d, &cache, &mut WorkMeter::new(WorkLimits::default()))
        .unwrap();
    prepared.cache.publish(&mut cache);
    let next = change(d.after);
    r.validate_scoped(&next, &cache, &mut WorkMeter::new(WorkLimits::default()))
        .unwrap();
}
#[test]
fn empty_cache_full_fallback_and_tiny_meter_refuse_before_metadata() {
    let r = registry();
    let d = change(view(4));
    let mut meter = WorkMeter::new(WorkLimits::default());
    r.validate_scoped(&d, &SchemaCache::default(), &mut meter)
        .unwrap();
    assert_eq!(meter.trace().phase(WorkPhase::FullFallback).visits, 1);
    let cache = seed(&r, &d.before);
    let mut tiny = WorkMeter::new(WorkLimits { units: 1, bytes: 1 });
    assert_eq!(
        r.validate_scoped(&d, &cache, &mut tiny).err().unwrap().code,
        RegistryErrorCode::ResourceLimitExceeded
    );
    assert_eq!(tiny.trace().phase(WorkPhase::Header).visits, 0);
}
#[test]
fn errors_follow_current_tree_order_instead_of_id_order() {
    let r = registry();
    let before = view(2);
    let cache = seed(&r, &before);
    let mut after = before.clone();
    after.roots.swap(0, 1);
    after
        .nodes
        .get_mut(&100000)
        .unwrap()
        .attrs
        .insert("z_last".into(), Attribute::Null);
    after
        .nodes
        .get_mut(&100001)
        .unwrap()
        .attrs
        .insert("a_first".into(), Attribute::Null);
    let d = Delta {
        before,
        after,
        direct: vec![100000, 100001],
        root_changed: true,
        forest: vec![
            dirty(0, None, None, false, true, vec![1, 2]),
            {
                let mut r = dirty(1, Some(0), Some(0), false, false, vec![100000]);
                r.after_ordinal = Some(1);
                r
            },
            {
                let mut r = dirty(2, Some(0), Some(1), false, false, vec![100001]);
                r.after_ordinal = Some(0);
                r
            },
            dirty(100000, Some(1), Some(0), true, false, vec![]),
            dirty(100001, Some(2), Some(0), true, false, vec![]),
        ],
    };
    let a = r
        .validate_scoped(&d, &cache, &mut WorkMeter::new(WorkLimits::default()))
        .err()
        .unwrap();
    let b = r
        .validate_full(&d, &mut WorkMeter::new(WorkLimits::default()))
        .err()
        .unwrap();
    assert_eq!(a.path, b.path);
    assert_eq!(a.path, "/children/0/children/0/attributes/a_first");
}

#[test]
fn move_remove_and_exact_id_restore_match_full_and_publish_sparse_proofs() {
    let r = registry();
    let before = view(2);
    let mut cache = seed(&r, &before);
    let mut after = before.clone();
    after.nodes.get_mut(&1).unwrap().children.clear();
    after.nodes.get_mut(&2).unwrap().children.push(100000);
    after.nodes.get_mut(&100000).unwrap().parent = 2;
    let mut moved = dirty(100000, Some(1), Some(0), false, false, vec![]);
    moved.direct = true;
    moved.after_parent = Some(2);
    moved.after_ordinal = Some(1);
    let d = Delta {
        before,
        after,
        direct: vec![1, 2, 100000],
        root_changed: false,
        forest: vec![
            dirty(0, None, None, false, false, vec![1, 2]),
            dirty(1, Some(0), Some(0), false, true, vec![100000]),
            dirty(2, Some(0), Some(1), false, true, vec![100000]),
            moved,
        ],
    };
    r.validate_full(&d, &mut WorkMeter::new(WorkLimits::default()))
        .unwrap();
    r.validate_scoped(&d, &cache, &mut WorkMeter::new(WorkLimits::default()))
        .unwrap()
        .cache
        .publish(&mut cache);
    let before = d.after;
    let mut after = before.clone();
    after.nodes.get_mut(&2).unwrap().children.pop();
    let saved = after.nodes.remove(&100000).unwrap();
    let mut gone = dirty(100000, Some(2), Some(1), false, false, vec![]);
    gone.after_parent = None;
    gone.after_ordinal = None;
    let d = Delta {
        before,
        after,
        direct: vec![2, 100000],
        root_changed: false,
        forest: vec![
            dirty(0, None, None, false, false, vec![2]),
            dirty(2, Some(0), Some(1), false, true, vec![100000]),
            gone,
        ],
    };
    r.validate_full(&d, &mut WorkMeter::new(WorkLimits::default()))
        .unwrap();
    r.validate_scoped(&d, &cache, &mut WorkMeter::new(WorkLimits::default()))
        .unwrap()
        .cache
        .publish(&mut cache);
    let before = d.after;
    let mut after = before.clone();
    after.nodes.get_mut(&2).unwrap().children.push(100000);
    after.nodes.insert(100000, saved);
    let mut revived = dirty(100000, None, None, true, false, vec![]);
    revived.after_parent = Some(2);
    revived.after_ordinal = Some(1);
    let d = Delta {
        before,
        after,
        direct: vec![2, 100000],
        root_changed: false,
        forest: vec![
            dirty(0, None, None, false, false, vec![2]),
            dirty(2, Some(0), Some(1), false, true, vec![100000]),
            revived,
        ],
    };
    r.validate_full(&d, &mut WorkMeter::new(WorkLimits::default()))
        .unwrap();
    r.validate_scoped(&d, &cache, &mut WorkMeter::new(WorkLimits::default()))
        .unwrap()
        .cache
        .publish(&mut cache);
}
#[test]
fn typing_marks_use_identical_frozen_mark_rules_and_refuse_atomically() {
    let r = registry();
    let mut work = WorkMeter::new(WorkLimits::default());
    r.validate_marks(
        T,
        &[Mark {
            type_id: M.into(),
            attributes: Attributes::new(),
        }],
        &mut work,
    )
    .unwrap();
    let mut attrs = Attributes::new();
    attrs.insert("unknown".into(), Attribute::Null);
    let marks = vec![Mark {
        type_id: M.into(),
        attributes: attrs,
    }];
    let mut work = WorkMeter::new(WorkLimits::default());
    let err = r.validate_marks(T, &marks, &mut work).unwrap_err();
    assert_eq!(err.code, RegistryErrorCode::UnknownAttribute);
    assert_eq!(err.path, "/marks/0/attributes/unknown");
    assert_eq!(err.usage.work, work.usage());
    assert_eq!(marks.len(), 1);
    assert_eq!(
        r.validate_marks(
            P,
            &[Mark {
                type_id: M.into(),
                attributes: Attributes::new()
            }],
            &mut WorkMeter::new(WorkLimits::default())
        )
        .unwrap_err()
        .code,
        RegistryErrorCode::MarkNotAllowed
    );
}

#[test]
fn counted_root_overflow_reports_same_first_extra_child_as_full() {
    let r = registry_root_bounds(1, 1);
    let before = view(1);
    let cache = seed(&r, &before);
    let after = view(2);
    let mut p = dirty(2, None, None, true, true, vec![100001]);
    p.after_parent = Some(0);
    p.after_ordinal = Some(1);
    let mut t = dirty(100001, None, None, true, false, vec![]);
    t.after_parent = Some(2);
    t.after_ordinal = Some(0);
    let d = Delta {
        before,
        after,
        direct: vec![2, 100001],
        root_changed: true,
        forest: vec![dirty(0, None, None, false, true, vec![2]), p, t],
    };
    let a = r
        .validate_scoped(&d, &cache, &mut WorkMeter::new(WorkLimits::default()))
        .err()
        .unwrap();
    let b = r
        .validate_full(&d, &mut WorkMeter::new(WorkLimits::default()))
        .err()
        .unwrap();
    assert_eq!(
        (a.code, a.path, a.child_index),
        (b.code, b.path, b.child_index)
    );
}
#[test]
fn counted_bad_label_precedes_missing_suffix_in_both_paths() {
    let r = registry_root_bounds(2, 4);
    let before = view(2);
    let cache = seed(&r, &before);
    let mut after = before.clone();
    after.roots = vec![2];
    after.nodes.retain(|id, _| *id == 2);
    let p = after.nodes.get_mut(&2).unwrap();
    p.ty = B.into();
    p.primitive = Primitive::HardBreak;
    p.children.clear();
    let mut records = vec![
        dirty(0, None, None, false, true, vec![1, 2]),
        dirty(1, Some(0), Some(0), false, true, vec![100000]),
        dirty(2, Some(0), Some(1), true, true, vec![100001]),
        dirty(100000, Some(1), Some(0), false, false, vec![]),
        dirty(100001, Some(2), Some(0), false, false, vec![]),
    ];
    for r in &mut records {
        if r.id != 0 && r.id != 2 {
            r.after_parent = None;
            r.after_ordinal = None;
        }
        if r.id == 2 {
            r.after_ordinal = Some(0);
        }
    }
    let d = Delta {
        before,
        after,
        direct: vec![1, 2, 100000, 100001],
        root_changed: true,
        forest: records,
    };
    let a = r
        .validate_scoped(&d, &cache, &mut WorkMeter::new(WorkLimits::default()))
        .err()
        .unwrap();
    let b = r
        .validate_full(&d, &mut WorkMeter::new(WorkLimits::default()))
        .err()
        .unwrap();
    assert_eq!(
        (a.code, a.path, a.child_index),
        (b.code, b.path, b.child_index)
    );
}
