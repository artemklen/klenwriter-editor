use std::collections::BTreeSet;

use editor_core::document::{Attribute, Primitive};
use klenwriter_editor_kwdj::{
    IdentityResolver, IdentityResolverError, IdentityStatus, KwdjErrorCode, Limits, Profile,
    admit_core_document, decode_candidate_with_limits, decode_normalize_validate,
    normalize_and_validate, validate_normalized_json_with_limits,
};
use serde_json::{Value, json};
use uuid::Uuid;

struct Identities;
impl IdentityResolver for Identities {
    fn resolve_media(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(IdentityStatus::Exists)
    }
    fn resolve_reference(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(IdentityStatus::Exists)
    }
}
fn paragraph() -> Value {
    json!({"type":"paragraph","content":[{"type":"text","text":"Яe\u{301}😀"},{"type":"hard_break"}]})
}
fn envelope(profile: &str, content: Vec<Value>) -> Vec<u8> {
    serde_json::to_vec(&json!({"schema":"klenwriter.document","schema_version":1,"profile":profile,"content":content})).unwrap()
}

// OSR-77: every object across all 24 node / 10 mark kinds is closed. An
// unknown supplementary key must be rejected, rather than dropped by a decoder.
fn assert_closed_ascii_keys(document: Value) {
    fn objects(value: &Value, path: &str, paths: &mut Vec<String>) {
        match value {
            Value::Object(fields) => {
                paths.push(path.to_owned());
                for (key, child) in fields {
                    assert!(key.is_ascii(), "non-ASCII persisted key at {path}");
                    objects(child, &editor_core::json::key_path(path, key), paths);
                }
            }
            Value::Array(values) => {
                for (index, child) in values.iter().enumerate() {
                    objects(child, &editor_core::json::index_path(path, index), paths);
                }
            }
            _ => {}
        }
    }
    let mut paths = Vec::new();
    objects(&document, "", &mut paths);
    assert!(!paths.is_empty());
    for path in paths {
        for extra in ["unexpected_ascii", "😀"] {
            let mut changed = document.clone();
            changed
                .pointer_mut(&path)
                .unwrap()
                .as_object_mut()
                .unwrap()
                .insert(extra.to_owned(), json!(false));
            let raw = serde_json::to_vec(&changed).unwrap();
            let refusal = decode_candidate_with_limits(&raw, Limits::default()).unwrap_err();
            assert_eq!(
                refusal.code,
                KwdjErrorCode::UnknownAttribute,
                "{path}: {extra}"
            );
        }
    }
}

#[test]
fn every_profile_node_and_mark_round_trips_through_generic_snapshot() {
    let p = paragraph();
    let mut nodes = vec![
        p.clone(),
        json!({"type":"heading","attrs":{"level":2},"content":[]}),
        json!({"type":"scene_break"}),
        json!({"type":"code_block","attrs":{"language":"rust"},"content":[{"type":"text","text":"let x = 1;"}]}),
        json!({"type":"blockquote","content":[p.clone()]}),
        json!({"type":"bullet_list","content":[{"type":"list_item","content":[p.clone()]}]}),
        json!({"type":"ordered_list","attrs":{"start":2},"content":[{"type":"list_item","content":[p.clone()]}]}),
        json!({"type":"task_list","content":[{"type":"task_item","attrs":{"checked":true},"content":[p.clone()]}]}),
        json!({"type":"table","content":[{"type":"table_row","content":[{"type":"table_header","content":[p.clone()]},{"type":"table_cell","attrs":{"align":"center"},"content":[p.clone()]}]}]}),
        json!({"type":"media_image","attrs":{"media_asset_id":"00000000-0000-4000-8000-000000000001","alt":"alt","align":"wide"},"content":[p.clone()]}),
        json!({"type":"literary_block","attrs":{"kind":"author_note"},"content":[p.clone()]}),
        json!({"type":"warning","attrs":{"kind":"general","label":"Attention"},"content":[p.clone()]}),
        json!({"type":"spoiler","attrs":{"label":"Secret"},"content":[p.clone()]}),
        json!({"type":"disclosure","attrs":{"label":"Open"},"content":[p]}),
    ];
    let mut marks: Vec<Value> = [
        "strong",
        "emphasis",
        "strike",
        "code",
        "subscript",
        "superscript",
    ]
    .map(|t| json!({"type":t}))
    .into();
    marks.extend([json!({"type":"text_color","attrs":{"token":"accent"}}),json!({"type":"highlight","attrs":{"token":"warning"}}),
        json!({"type":"link","attrs":{"href":"https://example.test/","title":"Title"}}),
        json!({"type":"reference_link","attrs":{"reference_entity_id":"00000000-0000-4000-8000-000000000002"}})]);
    nodes.extend(marks.into_iter().map(
        |m| json!({"type":"paragraph","content":[{"type":"text","text":"marked","marks":[m]}]}),
    ));
    let poetry = vec![
        json!({"type":"verse","content":[{"type":"verse_line","attrs":{"indent":3},"content":[{"type":"text","text":"first"}]},{"type":"stanza_break","attrs":{"blank_lines":2}},{"type":"verse_line","content":[]} ]}),
    ];
    let mut kinds = BTreeSet::new();
    let mut mark_kinds = BTreeSet::new();
    for (profile, content) in [(Profile::Prose, nodes), (Profile::Poetry, poetry)] {
        let bytes = envelope(
            if profile == Profile::Prose {
                "prose"
            } else {
                "poetry"
            },
            content,
        );
        let source = decode_normalize_validate(&bytes, &Identities).unwrap();
        assert_closed_ascii_keys(source.document().to_json_value());
        let generic = source.document().to_core_document();
        let mut pending: Vec<_> = generic.children.iter().collect();
        while let Some(n) = pending.pop() {
            kinds.insert(n.type_id.clone());
            mark_kinds.extend(n.marks.iter().map(|m| m.type_id.clone()));
            pending.extend(&n.children);
        }
        let restored =
            admit_core_document(&generic, profile, &Identities, Limits::default()).unwrap();
        assert_eq!(source.document(), restored.document());
        assert_eq!(source.canonical_json(), restored.canonical_json());
        assert_eq!(source.media_manifest(), restored.media_manifest());
        assert_eq!(source.reference_manifest(), restored.reference_manifest());
        assert_eq!(
            source.project_text().unwrap(),
            restored.project_text().unwrap()
        );
        assert_eq!(
            source.document().structural_metrics(),
            editor_core::document::measure(&generic.children)
        );
    }
    assert_eq!(kinds.len(), 24);
    assert_eq!(mark_kinds.len(), 10);
}

#[test]
fn generic_draft_cannot_bypass_profile_or_silently_lose_data() {
    let source =
        decode_normalize_validate(&envelope("prose", vec![paragraph()]), &Identities).unwrap();
    let original = source.document().to_core_document();
    let mut changed = original.clone();
    changed.children[0].primitive = Primitive::InlineAtom;
    assert_eq!(
        admit_core_document(&changed, Profile::Prose, &Identities, Limits::default())
            .unwrap_err()
            .code,
        KwdjErrorCode::InvalidStructure
    );
    changed = original.clone();
    changed.children[0].type_id = "org.example.notes/callout".into();
    assert_eq!(
        admit_core_document(&changed, Profile::Prose, &Identities, Limits::default())
            .unwrap_err()
            .code,
        KwdjErrorCode::UnknownNode
    );
    changed = original;
    changed.children[0]
        .attributes
        .insert("opaque".into(), Attribute::Object(Default::default()));
    let error =
        admit_core_document(&changed, Profile::Prose, &Identities, Limits::default()).unwrap_err();
    assert_eq!(error.code, KwdjErrorCode::InvalidStructure);
    assert_eq!(error.path, "/content/0/attrs/opaque");
}

#[test]
fn host_can_tighten_but_cannot_raise_profile_limits() {
    let defaults = Limits::default();
    let raised = Limits {
        document_bytes: u64::MAX,
        tree_depth: u64::MAX,
        node_count: u64::MAX,
        text_leaf_bytes: u64::MAX,
        table_rows: u64::MAX,
        table_effective_columns: u64::MAX,
        authored_attribute_bytes: u64::MAX,
    };
    assert_eq!(raised.effective(), defaults);
    let bytes = envelope("prose", vec![paragraph()]);
    let tighter = Limits {
        text_leaf_bytes: 8,
        ..defaults
    };
    let error = validate_normalized_json_with_limits(&bytes, &Identities, tighter).unwrap_err();
    assert_eq!(error.code, KwdjErrorCode::ResourceLimitExceeded);
    assert_eq!(error.context.limit, Some("text_length"));
    assert_eq!(error.context.maximum, Some(8));
    assert_eq!(error.context.observed, Some(9));
    let candidate = decode_candidate_with_limits(&bytes, tighter).unwrap();
    assert_eq!(
        normalize_and_validate(candidate, &Identities)
            .unwrap_err()
            .context,
        error.context
    );
    validate_normalized_json_with_limits(&bytes, &Identities, raised).unwrap();
    let zero = Limits {
        node_count: 0,
        ..defaults
    };
    assert_eq!(
        validate_normalized_json_with_limits(&bytes, &Identities, zero)
            .unwrap_err()
            .context
            .limit,
        Some("node_count")
    );
}
