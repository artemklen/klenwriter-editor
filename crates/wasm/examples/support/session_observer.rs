// SPDX-License-Identifier: MIT OR Apache-2.0
//! Bounded composition witness for the real Rust Session<KwdjProfile>.
//! Shared by native tests and a separate compiled-WASM test artifact. This is
//! trusted fixture code, never an installed session ABI or transaction engine.

use editor_core::positions::{Affinity, Edge, Position, PositionError, Selection, Utf16Offset};
use editor_core::profile::{AdmissionMode, ExtensionBinding, FrozenProfile, ProfileBinding};
use editor_engine::mapping::{MapLog, MapResult, PositionMap};
use editor_engine::tree::TreeError;
use editor_engine::{AccessMode, NodeId, Session, SessionError, StateError};
use editor_kwdj::{
    AdmissionBudget, IdentityResolver, IdentityResolverError, IdentityStatus, KwdjProfile,
    KwdjProfileError, Limits,
};
use serde_json::{Value, json};
use uuid::Uuid;

const MEDIA: &str = "11111111-1111-4111-8111-111111111111";

struct FixtureIdentities;
impl IdentityResolver for FixtureIdentities {
    fn resolve_media(&self, id: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(if id.to_string() == MEDIA {
            IdentityStatus::Exists
        } else {
            IdentityStatus::Missing
        })
    }
    fn resolve_reference(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(IdentityStatus::Missing)
    }
}
static IDENTITIES: FixtureIdentities = FixtureIdentities;

fn profile() -> KwdjProfile<'static> {
    KwdjProfile::new(&IDENTITIES, Limits::default(), AdmissionBudget::default())
}
fn document(profile: &str, content: Value) -> Value {
    json!({"schema":"klenwriter.document","schema_version":1,"profile":profile,"content":content})
}
fn paragraph(text: &str) -> Value {
    json!({"type":"paragraph","content":[{"type":"text","text":text}]})
}
fn simple() -> Value {
    document("prose", json!([paragraph("abЯz")]))
}
fn open(value: &Value, access: AccessMode) -> Session<KwdjProfile<'static>> {
    let p = profile();
    let binding = p.binding().clone();
    Session::open(
        p,
        &binding,
        &serde_json::to_vec(value).unwrap(),
        AdmissionMode::Strict,
        access,
    )
    .expect("bounded literal fixture must admit")
}
fn text(leaf: NodeId, offset: usize, affinity: Affinity) -> Position<NodeId> {
    Position::Text {
        leaf,
        utf16: Utf16Offset::new(offset),
        affinity,
    }
}
fn gap(parent: NodeId, index: usize, affinity: Affinity) -> Position<NodeId> {
    Position::Child {
        parent,
        index,
        affinity,
    }
}
fn first_leaf(s: &Session<KwdjProfile<'_>>) -> NodeId {
    let k = s.key();
    let p = s.node(k, s.root(k).unwrap()).unwrap().children()[0];
    s.node(k, p).unwrap().children()[0]
}
fn export(s: &Session<KwdjProfile<'_>>) -> Vec<u8> {
    s.export_snapshot(s.key(), s.revision()).unwrap()
}
fn no_runtime_keys(value: &Value) {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                assert!(
                    ![
                        "session",
                        "sessionId",
                        "nodeId",
                        "generation",
                        "revision",
                        "selection",
                        "history",
                        "selectionEpoch"
                    ]
                    .contains(&key.as_str())
                );
                no_runtime_keys(value);
            }
        }
        Value::Array(values) => values.iter().for_each(no_runtime_keys),
        _ => {}
    }
}

fn snapshots() -> Value {
    let fixtures = [
        (
            "prose-unicode",
            document("prose", json!([paragraph("Яe\u{301}👩🏽‍💻 שלום")])),
        ),
        (
            "poetry-root-context",
            document(
                "poetry",
                json!([{"type":"verse","content":[
                    {"type":"verse_line","content":[{"type":"text","text":"Строка","marks":[{"type":"emphasis"}]}]},
                    {"type":"stanza_break","attrs":{"blank_lines":2}},
                    {"type":"verse_line","content":[{"type":"text","text":"次"}]}
                ]}]),
            ),
        ),
        (
            "nested-marks-atoms",
            document(
                "prose",
                json!([
                    {"type":"blockquote","content":[{"type":"paragraph","content":[
                        {"type":"text","text":"e"},
                        {"type":"text","text":"\u{301}","marks":[{"type":"strong"}]},
                        {"type":"hard_break"},
                        {"type":"text","text":"tail","marks":[{"type":"emphasis"}]}
                    ]}]},
                    {"type":"media_image","attrs":{"media_asset_id":MEDIA,"alt":"fixture","align":"center"}},
                    paragraph("end")
                ]),
            ),
        ),
    ];
    let mut rows = Vec::new();
    for (name, fixture) in fixtures {
        let mut s = open(&fixture, AccessMode::Editable);
        let key = s.key();
        let root = s.root(key).unwrap();
        let bytes = export(&s);
        let actual: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            actual, fixture,
            "literal wire content/profile must survive Session export"
        );
        no_runtime_keys(&actual);
        assert_eq!(actual.as_object().unwrap().len(), 4);
        let next = s
            .remount(
                key,
                &s.binding().clone(),
                &bytes,
                AdmissionMode::Strict,
                AccessMode::Editable,
            )
            .unwrap();
        assert_eq!(next.generation(), key.generation() + 1);
        assert_ne!(next, key);
        assert_ne!(s.root(next).unwrap(), root);
        assert_eq!(
            s.root(key),
            Err(SessionError::State(StateError::StaleSession))
        );
        assert_eq!(
            s.node(next, root),
            Err(SessionError::Tree(TreeError::ForeignSession))
        );
        assert_eq!(export(&s), bytes);
        rows.push(json!({"case":name,"canonical":String::from_utf8(bytes).unwrap(),"generation_advanced":true,"runtime_metadata_exported":false}));
    }
    json!({"status":"passed","cases":rows})
}

fn binding_refusals() -> Value {
    let p = profile();
    let b = p.binding();
    let base = b.extensions().to_vec();
    let changed = vec![ExtensionBinding::new(base[0].id(), "2.0.0").unwrap()];
    let mut extra = base.clone();
    extra.push(ExtensionBinding::new("org.z.example/uninstalled", "1.0.0").unwrap());
    let cases = [
        (
            "profile",
            ProfileBinding::new(
                "org.example.notes",
                b.profile_version(),
                b.codec_id(),
                1,
                &base,
            )
            .unwrap(),
            "profile.unsupported_profile",
        ),
        (
            "profile-version",
            ProfileBinding::new(b.profile_id(), "2.0.0", b.codec_id(), 1, &base).unwrap(),
            "profile.unsupported_profile_version",
        ),
        (
            "codec",
            ProfileBinding::new(
                b.profile_id(),
                b.profile_version(),
                "org.example/other",
                1,
                &base,
            )
            .unwrap(),
            "profile.unsupported_codec",
        ),
        (
            "wire-version",
            ProfileBinding::new(b.profile_id(), b.profile_version(), b.codec_id(), 2, &base)
                .unwrap(),
            "profile.unsupported_wire_version",
        ),
        (
            "missing-extension",
            ProfileBinding::new(b.profile_id(), b.profile_version(), b.codec_id(), 1, &[]).unwrap(),
            "profile.missing_extension",
        ),
        (
            "unknown-extension",
            ProfileBinding::new(b.profile_id(), b.profile_version(), b.codec_id(), 1, &extra)
                .unwrap(),
            "profile.unknown_extension",
        ),
        (
            "extension-version",
            ProfileBinding::new(
                b.profile_id(),
                b.profile_version(),
                b.codec_id(),
                1,
                &changed,
            )
            .unwrap(),
            "profile.unsupported_extension_version",
        ),
    ];
    let mut rows = Vec::new();
    for (name, binding, expected) in cases {
        // Invalid JSON proves that exact binding is checked before decoding.
        let result = Session::open(
            profile(),
            &binding,
            b"not json",
            AdmissionMode::Strict,
            AccessMode::Editable,
        );
        let Err(SessionError::Binding(error)) = result else {
            panic!("binding did not refuse first: {name}")
        };
        assert_eq!(error.as_str(), expected);
        rows.push(json!({"case":name,"code":error.as_str()}));
    }
    for (name, input, expected) in [
        (
            "persisted-version",
            json!({"schema":"klenwriter.document","schema_version":2,"profile":"prose","content":[]}),
            "kwdj.unsupported_schema_version",
        ),
        (
            "uninstalled-node",
            document("prose", json!([{"type":"uninstalled"}])),
            "kwdj.unknown_node",
        ),
        (
            "session-metadata-input",
            json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[],"session":"forged"}),
            "kwdj.unknown_attribute",
        ),
    ] {
        let result = Session::open(
            profile(),
            b,
            &serde_json::to_vec(&input).unwrap(),
            AdmissionMode::Strict,
            AccessMode::Editable,
        );
        let Err(SessionError::Profile(KwdjProfileError::Document(error))) = result else {
            panic!("expected typed codec refusal: {name}")
        };
        assert_eq!(error.code.as_str(), expected);
        rows.push(json!({"case":name,"code":error.code.as_str()}));
    }
    json!({"status":"passed","cases":rows})
}

fn lifecycle_and_selection() -> Value {
    let value = document("prose", json!([paragraph("ab👩🏽‍💻cd")]));
    let mut s = open(&value, AccessMode::ReadOnly);
    let k = s.key();
    let leaf = first_leaf(&s);
    let before = export(&s);
    let reverse = Selection {
        anchor: text(leaf, 10, Affinity::After),
        focus: text(leaf, 6, Affinity::Before),
    };
    // focus=6 lies inside the family cluster but is a valid scalar read position.
    s.set_selection(k, 0, reverse).unwrap();
    assert_eq!(s.selection(k).unwrap(), Some(reverse));
    assert_eq!((s.revision(), s.selection_epoch()), (0, 1));
    s.set_selection(k, 0, reverse).unwrap();
    assert_eq!(s.selection_epoch(), 1);
    assert!(matches!(
        s.prepare_tree(k, 0),
        Err(SessionError::State(StateError::ReadOnly))
    ));
    assert_eq!(
        s.validate_position(k, 1, reverse.focus),
        Err(SessionError::State(StateError::StaleRevision))
    );
    let invalid = Selection {
        anchor: text(leaf, 3, Affinity::After),
        focus: reverse.focus,
    };
    assert_eq!(
        s.set_selection(k, 0, invalid),
        Err(SessionError::Tree(TreeError::Position(
            PositionError::NotScalarBoundary
        )))
    );
    assert_eq!(s.selection(k).unwrap(), Some(reverse));
    assert_eq!((s.revision(), s.selection_epoch()), (0, 1));
    // A failed remount cannot clear the current selection or generation.
    assert!(
        s.remount(
            k,
            &s.binding().clone(),
            b"not json",
            AdmissionMode::Strict,
            AccessMode::Editable
        )
        .is_err()
    );
    assert_eq!(s.key(), k);
    assert_eq!(s.selection(k).unwrap(), Some(reverse));
    assert_eq!(export(&s), before);
    let next = s
        .remount(
            k,
            &s.binding().clone(),
            &before,
            AdmissionMode::Strict,
            AccessMode::Editable,
        )
        .unwrap();
    assert_eq!(s.selection(next).unwrap(), None);
    assert_eq!((s.revision(), s.selection_epoch()), (0, 0));
    assert_eq!(
        s.export_snapshot(k, 0),
        Err(SessionError::State(StateError::StaleSession))
    );
    s.close(next).unwrap();
    assert_eq!(
        s.export_snapshot(next, 0),
        Err(SessionError::State(StateError::Closed))
    );
    assert!(matches!(
        s.prepare_tree(next, 0),
        Err(SessionError::State(StateError::Closed))
    ));
    assert_eq!(
        s.export_snapshot(k, 0),
        Err(SessionError::State(StateError::StaleSession))
    );
    let mut poisoned = open(&simple(), AccessMode::Editable);
    let pk = poisoned.key();
    poisoned.poison(pk).unwrap();
    assert_eq!(
        poisoned.root(pk),
        Err(SessionError::State(StateError::Poisoned))
    );
    assert_eq!(
        poisoned.export_snapshot(pk, 0),
        Err(SessionError::State(StateError::Poisoned))
    );
    assert!(matches!(
        poisoned.prepare_tree(pk, 0),
        Err(SessionError::State(StateError::Poisoned))
    ));
    json!({"status":"passed","readonly_scalar_focus":6,"reverse_anchor":10,"selection_epoch":1,
        "document_revision":0,"failed_remount_preserved_state":true,"remount_reset_selection":true,
        "guards":["read-only","stale-revision","stale-session","closed","poisoned"]})
}

fn text_drafts() -> Value {
    let s = open(&simple(), AccessMode::Editable);
    let k = s.key();
    let leaf = first_leaf(&s);
    let committed = export(&s);
    let mut draft = s.prepare_tree(k, 0).unwrap();
    assert_eq!(draft.written_nodes(), 0);
    let right = draft.split_text(leaf, Utf16Offset::new(2)).unwrap();
    assert_eq!(draft.node(leaf).unwrap().text(), Some("ab"));
    assert_eq!(draft.node(right).unwrap().text(), Some("Яz"));
    assert_eq!(draft.written_nodes(), 3);
    let split = PositionMap::new(0, 1, draft.steps().to_vec()).unwrap();
    assert_eq!(
        split.map(text(leaf, 2, Affinity::Before)),
        MapResult::Mapped(text(leaf, 2, Affinity::Before))
    );
    assert_eq!(
        split.map(text(leaf, 2, Affinity::After)),
        MapResult::Mapped(text(right, 0, Affinity::After))
    );
    assert_eq!(
        split.map(text(leaf, 4, Affinity::After)),
        MapResult::Mapped(text(right, 2, Affinity::After))
    );
    let joined = draft.join_text(leaf, right).unwrap();
    assert_eq!(draft.node(leaf).unwrap().text(), Some("abЯz"));
    assert_eq!(draft.node(right), Err(TreeError::MissingNode));
    let composed = PositionMap::new(0, 1, draft.steps().to_vec()).unwrap();
    assert_eq!(
        composed.map(text(leaf, 4, Affinity::After)),
        MapResult::Mapped(text(leaf, 4, Affinity::After))
    );
    // Primitive replay consumes an owned join receipt and restores the exact
    // historical right identity; allocating a fresh split ID would be incorrect.
    let restored_right = draft.restore_join(joined).unwrap();
    assert_eq!(restored_right, right);
    assert_eq!(draft.node(leaf).unwrap().text(), Some("ab"));
    assert_eq!(draft.node(restored_right).unwrap().text(), Some("Яz"));
    assert_eq!(draft.node(restored_right).unwrap().id(), right);
    // Return to the original literal snapshot for the explicit profile boundary.
    draft.join_text(leaf, restored_right).unwrap();
    assert_eq!(draft.node(right), Err(TreeError::MissingNode));
    let p = profile();
    let candidate = draft.candidate_document();
    let readmitted = p
        .admit_snapshot(&editor_kwdj::Profile::Prose, &candidate)
        .unwrap();
    assert_eq!(p.canonical(&readmitted), committed);
    // Changes remain unadmitted candidate work; no Session commit is available.
    draft
        .replace_text(leaf, Utf16Offset::new(2), Utf16Offset::new(3), "X")
        .unwrap();
    assert_eq!(draft.node(leaf).unwrap().text(), Some("abXz"));
    assert_eq!(s.node(k, leaf).unwrap().text(), Some("abЯz"));
    assert_eq!(export(&s), committed);
    assert_eq!((s.revision(), s.selection_epoch()), (0, 0));
    drop(draft);
    let mut other = s.prepare_tree(k, 0).unwrap();
    let fresh = other.split_text(leaf, Utf16Offset::new(2)).unwrap();
    assert_ne!(
        fresh, right,
        "abandoned draft identities must never be recycled"
    );
    json!({"status":"passed","split_text":["ab","Яz"],"boundary_before":["left",2],"boundary_after":["right",0],
        "joined":"abЯz","candidate":"abXz","committed":"abЯz","split_written_nodes":3,
        "retired_right_missing":true,"restored_join_right_identity":true,
        "restored_join_text":["ab","Яz"],"abandoned_id_reused":false})
}

fn cross_mark_graphemes() -> Value {
    let fixture = document(
        "prose",
        json!([{"type":"paragraph","content":[
            {"type":"text","text":"e"}, {"type":"text","text":"\u{301}","marks":[{"type":"strong"}]},
            {"type":"hard_break"}, {"type":"text","text":"\u{301}","marks":[{"type":"emphasis"}]}
        ]}]),
    );
    let s = open(&fixture, AccessMode::Editable);
    let k = s.key();
    let parent = s.node(k, s.root(k).unwrap()).unwrap().children()[0];
    let leaves = s.node(k, parent).unwrap().children();
    let mut draft = s.prepare_tree(k, 0).unwrap();
    let scalar = text(leaves[1], 0, Affinity::Before);
    draft.validate_position(scalar).unwrap();
    assert_eq!(
        draft.split_text(leaves[1], Utf16Offset::new(0)),
        Err(TreeError::Position(PositionError::NotGraphemeBoundary))
    );
    assert_eq!(
        draft.replace_text(leaves[1], Utf16Offset::new(0), Utf16Offset::new(1), ""),
        Err(TreeError::Position(PositionError::NotGraphemeBoundary))
    );
    assert_eq!(draft.written_nodes(), 0);
    assert!(draft.steps().is_empty());
    // The same scalar after a hard break starts a distinct inline sequence.
    draft.split_text(leaves[3], Utf16Offset::new(0)).unwrap();
    assert_eq!(s.node(k, leaves[1]).unwrap().text(), Some("\u{301}"));
    json!({"status":"passed","cross_mark_boundary":"refused","scalar_read":"accepted","hard_break_boundary":"accepted","failed_operations_writes":0})
}

fn retained_maps() -> Value {
    let s = open(
        &document("prose", json!([paragraph("abcdef")])),
        AccessMode::Editable,
    );
    let leaf = first_leaf(&s);
    let mut draft = s.prepare_tree(s.key(), 0).unwrap();
    draft
        .replace_text(leaf, Utf16Offset::new(2), Utf16Offset::new(5), "")
        .unwrap();
    assert_eq!(draft.node(leaf).unwrap().text(), Some("abf"));
    let first = PositionMap::new(0, 1, draft.steps().to_vec()).unwrap();
    for affinity in [Affinity::Before, Affinity::After] {
        for endpoint in [2, 5] {
            assert_eq!(
                first.map(text(leaf, endpoint, affinity)),
                MapResult::Mapped(text(leaf, 2, affinity))
            );
        }
        assert_eq!(
            first.map(text(leaf, 3, affinity)),
            MapResult::Deleted(text(leaf, 2, affinity))
        );
    }
    let first_steps = draft.steps().len();
    draft
        .replace_text(leaf, Utf16Offset::new(1), Utf16Offset::new(1), "Ж")
        .unwrap();
    assert_eq!(draft.node(leaf).unwrap().text(), Some("aЖbf"));
    let second = PositionMap::new(1, 2, draft.steps()[first_steps..].to_vec()).unwrap();
    let mut retained = MapLog::new(0, 2).unwrap();
    assert_eq!(retained.push(first.clone()).unwrap(), None);
    assert_eq!(retained.push(second.clone()).unwrap(), None);
    assert_eq!(
        retained.map(0, 2, text(leaf, 5, Affinity::After)),
        MapResult::Mapped(text(leaf, 3, Affinity::After))
    );
    assert_eq!(
        retained.map(0, 2, text(leaf, 3, Affinity::After)),
        MapResult::Deleted(text(leaf, 3, Affinity::After))
    );
    let mut limited = MapLog::new(0, 1).unwrap();
    limited.push(first.clone()).unwrap();
    assert_eq!(limited.push(second).unwrap(), Some(first));
    assert_eq!(limited.oldest_revision(), 1);
    assert_eq!(
        limited.map(0, 2, text(leaf, 5, Affinity::After)),
        MapResult::Stale
    );
    assert_eq!(s.node(s.key(), leaf).unwrap().text(), Some("abcdef"));
    json!({"status":"passed","after_delete":"abf","after_insert":"aЖbf","endpoint_offset":2,
        "endpoint_deleted":false,"interior_deleted":true,"composed_offset":3,"evicted_chain":"stale",
        "session_revision":s.revision()})
}

fn structural_drafts() -> Value {
    let fixture = document(
        "prose",
        json!([
            paragraph("P"),
            {"type":"blockquote","content":[{"type":"blockquote","content":[paragraph("Привет")]}]},
            paragraph("Q"),
            {"type":"media_image","attrs":{"media_asset_id":MEDIA,"alt":"fixture","align":"center"}}
        ]),
    );
    let s = open(&fixture, AccessMode::Editable);
    let k = s.key();
    let root = s.root(k).unwrap();
    let children = s.node(k, root).unwrap().children();
    let (p, section, q, image) = (children[0], children[1], children[2], children[3]);
    let nested = s.node(k, section).unwrap().children()[0];
    let nested_paragraph = s.node(k, nested).unwrap().children()[0];
    let leaf = s.node(k, nested_paragraph).unwrap().children()[0];
    let mut draft = s.prepare_tree(k, 0).unwrap();
    draft.move_node(section, root, 3).unwrap();
    assert_eq!(
        draft.node(root).unwrap().children(),
        &[p, q, section, image]
    );
    assert_eq!(draft.written_nodes(), 1);
    let moved = PositionMap::new(0, 1, draft.steps().to_vec()).unwrap();
    assert_eq!(
        moved.map(text(leaf, 3, Affinity::After)),
        MapResult::Mapped(text(leaf, 3, Affinity::After))
    );
    assert_eq!(
        moved.map(gap(root, 3, Affinity::Before)),
        MapResult::Mapped(gap(root, 2, Affinity::Before))
    );
    let before_refusal = draft.steps().len();
    assert_eq!(draft.move_node(section, nested, 0), Err(TreeError::Cycle));
    assert_eq!(draft.steps().len(), before_refusal);
    let retired = draft.detach(section).unwrap();
    assert_eq!(draft.node(leaf), Err(TreeError::MissingNode));
    let deleted = PositionMap::new(0, 1, draft.steps().to_vec()).unwrap();
    assert_eq!(
        deleted.map(text(leaf, 3, Affinity::After)),
        MapResult::Deleted(gap(root, 2, Affinity::After))
    );
    let failed = draft.revive(root, 99, retired).unwrap_err();
    assert_eq!(failed.cause, TreeError::InvalidIndex);
    assert_eq!(draft.revive(root, 1, failed.retired).unwrap(), section);
    assert_eq!(
        draft.node(root).unwrap().children(),
        &[p, section, q, image]
    );
    assert_eq!(draft.node(leaf).unwrap().text(), Some("Привет"));
    assert_eq!(draft.node(leaf).unwrap().id(), leaf);
    let image_retired = draft.detach(image).unwrap();
    let map = PositionMap::new(0, 1, draft.steps().to_vec()).unwrap();
    assert_eq!(
        map.map(Position::Edge {
            node: image,
            side: Edge::After
        }),
        MapResult::Deleted(gap(root, 3, Affinity::After))
    );
    assert_eq!(
        map.map(gap(root, 4, Affinity::Before)),
        MapResult::Mapped(gap(root, 3, Affinity::Before))
    );
    let other_session = open(&simple(), AccessMode::Editable);
    let mut other_draft = other_session.prepare_tree(other_session.key(), 0).unwrap();
    let foreign = other_draft
        .revive(other_draft.root(), 1, image_retired)
        .unwrap_err();
    assert_eq!(foreign.cause, TreeError::ForeignSession);
    assert_eq!(draft.revive(root, 3, foreign.retired).unwrap(), image);
    let p = profile();
    let admitted = p
        .admit_snapshot(&editor_kwdj::Profile::Prose, &draft.candidate_document())
        .unwrap();
    assert_eq!(p.canonical(&admitted), export(&s));
    assert_eq!(s.node(k, root).unwrap().children(), children);
    json!({"status":"passed","move_order":["P","Q","section","image"],"gap_before":2,
        "delete_fallback":2,"atom_deleted_fallback":3,"cycle":"refused","revival":"same-owned-identities",
        "invalid_revival_retains_ownership":true,"foreign_revival":"refused","session_changed":false})
}

/// Panics on a violated literal contract: a WASM trap/native nonzero exit is a
/// failed witness, never an accepted report with synthesized success rows.
pub fn observe() -> String {
    json!({"schema":1,"task":"OSR-33","scope":"Rust foundation composition; no public session ABI, commit, dispatch or user history",
        "production_profile":"org.klenwriter.kwdj","groups":{
            "snapshots":snapshots(),"binding_refusals":binding_refusals(),
            "lifecycle_selection":lifecycle_and_selection(),"text_drafts":text_drafts(),
            "cross_mark_graphemes":cross_mark_graphemes(),"structural_drafts":structural_drafts(),
            "retained_maps":retained_maps()
        },"deferred":{"transactions":"OSR-34","user_history":"OSR-36","second_production_profile":"OSR-64"}}).to_string()
}
