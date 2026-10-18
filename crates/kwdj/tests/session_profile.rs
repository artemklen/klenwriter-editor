// SPDX-License-Identifier: MIT OR Apache-2.0
use std::sync::atomic::{AtomicUsize, Ordering};

use editor_core::admission::PreflightBudget;
use editor_core::profile::{
    AdmissionMode, BindingError, ExtensionBinding, FrozenProfile, ProfileBinding,
};
use klenwriter_editor_kwdj::{
    AdmissionBudget, IdentityResolver, IdentityResolverError, IdentityStatus,
    KWDJ_BASE_EXTENSION_ID, KWDJ_CODEC_ID, KwdjErrorCode, KwdjProfile, KwdjProfileError, Limits,
    Profile,
};
use serde_json::{Value, json};
use uuid::Uuid;

#[derive(Default)]
struct Identities(AtomicUsize);

impl IdentityResolver for Identities {
    fn resolve_media(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        self.0.fetch_add(1, Ordering::Relaxed);
        Ok(IdentityStatus::Exists)
    }

    fn resolve_reference(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        self.0.fetch_add(1, Ordering::Relaxed);
        Ok(IdentityStatus::Exists)
    }
}

fn envelope(profile: &str, content: Value) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "schema":"klenwriter.document", "schema_version":1, "profile":profile, "content":content,
    }))
    .unwrap()
}

fn requested(
    profile: &str,
    version: &str,
    codec: &str,
    wire: u64,
    extensions: &[ExtensionBinding],
) -> ProfileBinding {
    ProfileBinding::new(profile, version, codec, wire, extensions).unwrap()
}

#[test]
fn exact_binding_refuses_before_json_or_identity_work_in_both_modes() {
    let identities = Identities::default();
    let profile = KwdjProfile::new(
        &identities,
        Limits::default(),
        AdmissionBudget {
            raw_input_bytes: 0,
            ..AdmissionBudget::default()
        },
    );
    let expected = profile.binding();
    let base = expected.extensions().to_vec();
    let missing = Vec::new();
    let unknown = [
        base[0].clone(),
        ExtensionBinding::new("org.other/extra", "1.0.0").unwrap(),
    ];
    let versioned = [ExtensionBinding::new(KWDJ_BASE_EXTENSION_ID, "2.0.0").unwrap()];
    let cases = [
        (
            requested("org.klenwriter.KWDJ", "1.0.0", KWDJ_CODEC_ID, 1, &base),
            BindingError::ProfileMismatch,
        ),
        (
            requested(expected.profile_id(), "2.0.0", KWDJ_CODEC_ID, 1, &base),
            BindingError::ProfileVersionMismatch,
        ),
        (
            requested(expected.profile_id(), "1.0.0", "org.other/json", 1, &base),
            BindingError::CodecMismatch,
        ),
        (
            requested(
                expected.profile_id(),
                "1.0.0",
                KWDJ_CODEC_ID,
                u64::MAX,
                &base,
            ),
            BindingError::WireVersionMismatch,
        ),
        (
            requested(expected.profile_id(), "1.0.0", KWDJ_CODEC_ID, 1, &missing),
            BindingError::MissingExtension {
                id: KWDJ_BASE_EXTENSION_ID.into(),
            },
        ),
        (
            requested(expected.profile_id(), "1.0.0", KWDJ_CODEC_ID, 1, &unknown),
            BindingError::UnknownExtension {
                id: "org.other/extra".into(),
            },
        ),
        (
            requested(expected.profile_id(), "1.0.0", KWDJ_CODEC_ID, 1, &versioned),
            BindingError::ExtensionVersionMismatch {
                id: KWDJ_BASE_EXTENSION_ID.into(),
            },
        ),
    ];
    for (binding, expected_error) in cases {
        for mode in [AdmissionMode::Strict, AdmissionMode::Import] {
            assert_eq!(
                profile
                    .admit_bytes(&binding, b"invalid JSON that exceeds the zero budget", mode)
                    .unwrap_err(),
                KwdjProfileError::Binding(expected_error.clone()),
            );
        }
    }
    assert_eq!(identities.0.load(Ordering::Relaxed), 0);
    let KwdjProfileError::Document(error) = profile
        .admit_bytes(expected, b"x", AdmissionMode::Strict)
        .unwrap_err()
    else {
        panic!("A matched binding must proceed to the existing raw admission guard");
    };
    assert_eq!(error.code, KwdjErrorCode::OperationalBudgetExceeded);
    assert_eq!(error.context.limit, Some("raw_input_bytes"));
    assert_eq!(error.context.maximum, Some(0));
}

#[test]
fn strict_and_import_use_existing_distinct_normalization_contracts() {
    let identities = Identities::default();
    let profile = KwdjProfile::new(&identities, Limits::default(), AdmissionBudget::default());
    let source = envelope(
        "prose",
        json!([{"type":"paragraph", "content":[{"type":"text", "text":"Яe\u{0301}😀", "marks":[]}]}]),
    );
    let original = source.clone();
    let KwdjProfileError::Document(refusal) = profile
        .admit_bytes(profile.binding(), &source, AdmissionMode::Strict)
        .unwrap_err()
    else {
        panic!("Strict admission must preserve the codec diagnostic");
    };
    assert_eq!(refusal.code, KwdjErrorCode::NonNormalizedEmptyMarks);
    let imported = profile
        .admit_bytes(profile.binding(), &source, AdmissionMode::Import)
        .unwrap();
    assert!(!imported.normalization_events().is_empty());
    let strict = profile
        .admit_bytes(
            profile.binding(),
            profile.canonical(&imported),
            AdmissionMode::Strict,
        )
        .unwrap();
    assert_eq!(profile.canonical(&strict), profile.canonical(&imported));
    assert!(strict.normalization_events().is_empty());
    assert_eq!(source, original);
}

#[test]
fn admitted_root_context_and_all_semantic_payload_survive_snapshot_roundtrip() {
    let identities = Identities::default();
    let profile = KwdjProfile::new(&identities, Limits::default(), AdmissionBudget::default());
    let cases = [
        (
            Profile::Prose,
            "prose",
            json!([{"type":"paragraph", "attrs":{"align":"center"}, "content":[{"type":"text", "text":"Яe\u{0301}😀", "marks":[{"type":"strong"}, {"type":"link", "attrs":{"href":"https://example.com/"}}]}]}]),
        ),
        (
            Profile::Poetry,
            "poetry",
            json!([{"type":"verse", "content":[{"type":"verse_line", "content":[{"type":"text", "text":"Строка"}]}, {"type":"stanza_break", "attrs":{"blank_lines":2}}, {"type":"verse_line", "content":[]}]}]),
        ),
        // Identical children can belong to either root profile. Context cannot
        // be inferred from node kinds or replaced with a default on export.
        (
            Profile::Prose,
            "prose",
            json!([{"type":"paragraph", "content":[]}]),
        ),
        (
            Profile::Poetry,
            "poetry",
            json!([{"type":"paragraph", "content":[]}]),
        ),
    ];
    for (context, name, content) in cases {
        let source = envelope(name, content);
        let admitted = profile
            .admit_bytes(profile.binding(), &source, AdmissionMode::Import)
            .unwrap();
        assert_eq!(profile.context(&admitted), context);
        let document = profile.to_document(&admitted);
        let restored = profile
            .admit_snapshot(&profile.context(&admitted), &document)
            .unwrap();
        assert_eq!(profile.context(&restored), context);
        assert_eq!(profile.canonical(&restored), profile.canonical(&admitted));
        assert_eq!(profile.to_document(&restored), document);
        let wire: Value = serde_json::from_slice(profile.canonical(&restored)).unwrap();
        let keys = wire
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>();
        assert_eq!(keys, ["content", "profile", "schema", "schema_version"]);
        assert_eq!(wire["profile"], name);
    }
}

#[test]
fn adapter_preserves_effective_limits_and_borrowed_snapshot_guard() {
    let identities = Identities::default();
    let raised = KwdjProfile::new(
        &identities,
        Limits {
            document_bytes: u64::MAX,
            ..Limits::default()
        },
        AdmissionBudget {
            raw_input_bytes: u64::MAX,
            preflight: PreflightBudget {
                payload_bytes: u64::MAX,
                values: u64::MAX,
                depth: u64::MAX,
            },
        },
    );
    assert_eq!(raised.limits(), Limits::default());
    assert_eq!(raised.budget(), AdmissionBudget::default());
    let source = envelope(
        "prose",
        json!([{"type":"paragraph", "content":[{"type":"text", "text":"text"}]}]),
    );
    let admitted = raised
        .admit_bytes(raised.binding(), &source, AdmissionMode::Strict)
        .unwrap();
    let mut document = raised.to_document(&admitted);
    let original = document.clone();
    let tight = KwdjProfile::new(
        &identities,
        Limits::default(),
        AdmissionBudget {
            preflight: PreflightBudget {
                payload_bytes: 1,
                ..PreflightBudget::default()
            },
            ..AdmissionBudget::default()
        },
    );
    let KwdjProfileError::Document(refusal) = tight
        .admit_snapshot(&Profile::Prose, &document)
        .unwrap_err()
    else {
        panic!("Snapshot preflight must return its existing typed codec error");
    };
    assert_eq!(refusal.code, KwdjErrorCode::OperationalBudgetExceeded);
    assert_eq!(refusal.context.limit, Some("preflight_payload_bytes"));
    assert_eq!(document, original);
    assert_eq!(identities.0.load(Ordering::Relaxed), 0);
    document.children[0].type_id = "org.other/unknown".into();
    let KwdjProfileError::Document(refusal) = raised
        .admit_snapshot(&Profile::Prose, &document)
        .unwrap_err()
    else {
        panic!("A generic draft cannot confer admission");
    };
    assert_eq!(refusal.code, KwdjErrorCode::UnknownNode);
}

#[test]
fn missing_or_unavailable_references_do_not_produce_an_admitted_handle() {
    struct References(Result<IdentityStatus, IdentityResolverError>);
    impl IdentityResolver for References {
        fn resolve_media(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
            panic!("The reference-only fixture must not consult media services");
        }

        fn resolve_reference(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
            self.0
        }
    }
    let source = envelope(
        "prose",
        json!([{"type":"paragraph", "content":[{"type":"text", "text":"reference", "marks":[{"type":"reference_link", "attrs":{"reference_entity_id":"00000000-0000-4000-8000-000000000001"}}]}]}]),
    );
    let original = source.clone();
    for (status, code) in [
        (
            Ok(IdentityStatus::Missing),
            KwdjErrorCode::MissingReferenceIdentity,
        ),
        (
            Err(IdentityResolverError::Unavailable),
            KwdjErrorCode::IdentityResolutionFailed,
        ),
    ] {
        let resolver = References(status);
        let profile = KwdjProfile::new(&resolver, Limits::default(), AdmissionBudget::default());
        for mode in [AdmissionMode::Strict, AdmissionMode::Import] {
            let KwdjProfileError::Document(error) = profile
                .admit_bytes(profile.binding(), &source, mode)
                .unwrap_err()
            else {
                panic!("Reference admission must preserve the domain-safe codec error");
            };
            assert_eq!(error.code, code);
            assert!(error.path.ends_with("/attrs/reference_entity_id"));
            assert_eq!(source, original);
        }
    }
}

// OSR-64 literal public registration expectations precede the implementation.
#[test]
fn public_registry_preserves_exact_kwdj_base_ownership_and_codec_binding() {
    let identities = Identities::default();
    let profile = KwdjProfile::new(&identities, Limits::default(), AdmissionBudget::default());
    let registry = profile.registry();
    assert_eq!(registry.binding(), profile.binding());
    assert_eq!(
        registry.extension_order()[0].id(),
        "org.klenwriter.kwdj/base"
    );
    for name in [
        "text",
        "paragraph",
        "heading",
        "hard_break",
        "scene_break",
        "code_block",
        "blockquote",
        "list_item",
        "task_item",
        "bullet_list",
        "ordered_list",
        "task_list",
        "table_header",
        "table_cell",
        "table_row",
        "table",
        "media_image",
        "literary_block",
        "warning",
        "spoiler",
        "disclosure",
        "verse_line",
        "stanza_break",
        "verse",
    ] {
        let id = format!("org.klenwriter.kwdj/{name}");
        let definition = registry.node(&id).expect("normative KWDJ node registered");
        assert_eq!(definition.owner, "org.klenwriter.kwdj/base");
        assert_eq!(
            registry
                .extension_order()
                .iter()
                .find(|owner| owner.id() == definition.owner)
                .unwrap()
                .version(),
            "1.0.0"
        );
    }
    for name in [
        "strong",
        "emphasis",
        "strike",
        "code",
        "subscript",
        "superscript",
        "text_color",
        "highlight",
        "link",
        "reference_link",
    ] {
        let id = format!("org.klenwriter.kwdj/{name}");
        assert_eq!(
            registry.mark(&id).unwrap().owner,
            "org.klenwriter.kwdj/base"
        );
    }
    assert!(registry.node("org.klenwriter.kwdj/unknown").is_none());
}
