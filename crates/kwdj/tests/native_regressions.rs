// SPDX-License-Identifier: MIT OR Apache-2.0
// Synthetic source cases; provenance/source-files.json.
use std::cell::Cell;

use klenwriter_editor_kwdj::{
    IdentityResolver, IdentityResolverError, IdentityStatus, KwdjErrorCode,
    MAX_TABLE_EFFECTIVE_COLUMNS, decode_normalize_validate, validate_normalized_json,
};
use serde_json::{Value, json};
use uuid::Uuid;

struct AllowIdentities;

impl IdentityResolver for AllowIdentities {
    fn resolve_media(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(IdentityStatus::Exists)
    }

    fn resolve_reference(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(IdentityStatus::Exists)
    }
}

#[derive(Clone, Copy)]
enum Resolution {
    Exists,
    Missing,
    Unavailable,
}

struct ControlledIdentities {
    media: Resolution,
    reference: Resolution,
    media_calls: Cell<u8>,
    reference_calls: Cell<u8>,
}

impl ControlledIdentities {
    fn new(media: Resolution, reference: Resolution) -> Self {
        Self {
            media,
            reference,
            media_calls: Cell::new(0),
            reference_calls: Cell::new(0),
        }
    }
}

impl IdentityResolver for ControlledIdentities {
    fn resolve_media(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        self.media_calls.set(self.media_calls.get() + 1);
        resolve(self.media)
    }

    fn resolve_reference(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        self.reference_calls.set(self.reference_calls.get() + 1);
        resolve(self.reference)
    }
}

fn resolve(outcome: Resolution) -> Result<IdentityStatus, IdentityResolverError> {
    match outcome {
        Resolution::Exists => Ok(IdentityStatus::Exists),
        Resolution::Missing => Ok(IdentityStatus::Missing),
        Resolution::Unavailable => Err(IdentityResolverError::Unavailable),
    }
}

#[test]
fn canonical_uuid_versions_one_through_eight_are_accepted() {
    for version in 1..=8 {
        let id = format!("00000000-0000-{version}000-8000-000000000001");
        validate_normalized_json(&encoded(reference_document(&id)), &AllowIdentities).unwrap();
    }
    for version in [0, 9] {
        let id = format!("00000000-0000-{version}000-8000-000000000001");
        let error = validate_normalized_json(&encoded(reference_document(&id)), &AllowIdentities)
            .expect_err("unsupported UUID version nibble must fail");
        assert_eq!(error.code, KwdjErrorCode::InvalidUuid);
    }
    let wrong_variant = "00000000-0000-1000-7000-000000000001";
    let error = validate_normalized_json(
        &encoded(reference_document(wrong_variant)),
        &AllowIdentities,
    )
    .expect_err("non-RFC variant must fail");
    assert_eq!(error.code, KwdjErrorCode::InvalidUuid);

    let uppercase = reference_document("00000000-0000-1000-8000-00000000ABCD");
    let normalized =
        decode_normalize_validate(&encoded(uppercase.clone()), &AllowIdentities).unwrap();
    assert!(
        normalized
            .document()
            .to_json_value()
            .to_string()
            .contains("00000000-0000-1000-8000-00000000abcd")
    );
    assert_eq!(
        validate_normalized_json(&encoded(uppercase), &AllowIdentities)
            .unwrap_err()
            .code,
        KwdjErrorCode::NonNormalized
    );

    let compact = reference_document("00000000000010008000000000000001");
    assert_eq!(
        validate_normalized_json(&encoded(compact), &AllowIdentities)
            .unwrap_err()
            .code,
        KwdjErrorCode::NonNormalized
    );
}

#[test]
fn url_policy_accepts_only_contract_targets() {
    for href in [
        "https://example.test/a?b=1#c",
        "http://example.test",
        "https://example.test?next=/../x",
        "https://example.test/#anchor/../x",
        "/works/example?view=full#part",
        "/works?next=/../x#part/../anchor",
    ] {
        validate_normalized_json(&encoded(link_document(href)), &AllowIdentities).unwrap();
    }
    for href in [
        "ftp://example.test/a",
        "https://user:pass@example.test/a",
        "//example.test/a",
        "/a/../b",
        "/a/%2E%2e/b",
        "https://example.test/a/../b",
        "https://example.test/a/%2E%2e/b",
        "/a\\b",
        "javascript:alert(1)",
        "https://example.test/a\nb",
    ] {
        let error = validate_normalized_json(&encoded(link_document(href)), &AllowIdentities)
            .expect_err("unsafe URL must fail");
        assert_eq!(error.code, KwdjErrorCode::UnsafeUrl, "{href}");
        assert!(error.path.contains("marks"));
    }
}

#[test]
fn table_effective_width_is_checked_before_allocation() {
    for colspan in [51, u64::MAX] {
        let error = validate_normalized_json(
            &encoded(table_with_span("colspan", colspan)),
            &AllowIdentities,
        )
        .expect_err("oversized colspan must fail without allocation");
        assert_eq!(error.code, KwdjErrorCode::ResourceLimitExceeded);
        assert_eq!(error.context.limit, Some("table_effective_columns"));
        assert_eq!(error.context.maximum, Some(MAX_TABLE_EFFECTIVE_COLUMNS));
        assert_eq!(error.context.observed, Some(colspan));
        assert_eq!(error.path, "/content/0/content/0/content/0/attrs/colspan");
    }

    let error = validate_normalized_json(
        &encoded(table_with_span("rowspan", u64::MAX)),
        &AllowIdentities,
    )
    .expect_err("oversized rowspan must fail deterministically");
    assert_eq!(error.code, KwdjErrorCode::TableNotRectangular);
    assert_eq!(error.path, "/content/0/content/0/content/0/attrs/rowspan");
}

#[test]
fn identity_resolution_is_fallible_and_cached_per_document() {
    for (outcome, expected_code) in [
        (Resolution::Exists, None),
        (
            Resolution::Missing,
            Some(KwdjErrorCode::MissingMediaIdentity),
        ),
        (
            Resolution::Unavailable,
            Some(KwdjErrorCode::IdentityResolutionFailed),
        ),
    ] {
        let resolver = ControlledIdentities::new(outcome, Resolution::Exists);
        let result = validate_normalized_json(&encoded(media_document()), &resolver);
        assert_resolution(result, expected_code, "media");
        assert_eq!(resolver.media_calls.get(), 1);
    }

    for (outcome, expected_code) in [
        (Resolution::Exists, None),
        (
            Resolution::Missing,
            Some(KwdjErrorCode::MissingReferenceIdentity),
        ),
        (
            Resolution::Unavailable,
            Some(KwdjErrorCode::IdentityResolutionFailed),
        ),
    ] {
        let resolver = ControlledIdentities::new(Resolution::Exists, outcome);
        let result = validate_normalized_json(
            &encoded(reference_document("00000000-0000-1000-8000-000000000001")),
            &resolver,
        );
        assert_resolution(result, expected_code, "reference");
        assert_eq!(resolver.reference_calls.get(), 1);
    }

    let resolver = ControlledIdentities::new(Resolution::Exists, Resolution::Exists);
    validate_normalized_json(&encoded(duplicate_identity_document()), &resolver).unwrap();
    assert_eq!(resolver.media_calls.get(), 1);
    assert_eq!(resolver.reference_calls.get(), 1);
}

#[test]
fn mark_error_paths_and_unknown_keys_use_exact_rfc6901_pointers() {
    let unsafe_href = validate_normalized_json(
        &encoded(link_document("https://example.test/a/../b")),
        &AllowIdentities,
    )
    .unwrap_err();
    assert_eq!(unsafe_href.path, "/content/0/content/0/marks/0/attrs/href");

    let title_too_long = validate_normalized_json(
        &encoded(json!({
            "schema":"klenwriter.document","schema_version":1,"profile":"prose",
            "content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{
                "type":"link","attrs":{"href":"/x","title":"a".repeat(8193)}
            }]}]}]
        })),
        &AllowIdentities,
    )
    .unwrap_err();
    assert_eq!(
        title_too_long.path,
        "/content/0/content/0/marks/0/attrs/title"
    );

    let missing_reference = validate_normalized_json(
        &encoded(reference_document("00000000-0000-1000-8000-000000000001")),
        &ControlledIdentities::new(Resolution::Exists, Resolution::Missing),
    )
    .unwrap_err();
    assert_eq!(
        missing_reference.path,
        "/content/0/content/0/marks/0/attrs/reference_entity_id"
    );

    let unknown_key = validate_normalized_json(
        &encoded(json!({
            "schema":"klenwriter.document","schema_version":1,"profile":"prose",
            "content":[{"type":"paragraph","a/~b":true,"content":[]}]
        })),
        &AllowIdentities,
    )
    .unwrap_err();
    assert_eq!(unknown_key.code, KwdjErrorCode::UnknownAttribute);
    assert_eq!(unknown_key.path, "/content/0/a~1~0b");
}

#[test]
fn candidate_normalization_is_deterministic_and_idempotent() {
    let candidate = json!({
        "schema":"klenwriter.document",
        "schema_version":1,
        "profile":"PROSE",
        "content":[
            {"type":"PARAGRAPH","content":[
                {"type":"text","text":"","marks":[]},
                {"type":"text","text":"a\r\nb","marks":[{"type":"EMPHASIS"},{"type":"STRONG"}]},
                {"type":"text","text":"c","marks":[{"type":"emphasis"},{"type":"strong"}]}
            ]},
            {"type":"ordered_list","attrs":{"start":1},"content":[{"type":"list_item","content":[{"type":"paragraph","content":[]}]}]},
            {"type":"table","content":[{"type":"table_row","content":[{"type":"table_cell","attrs":{"rowspan":1,"colspan":1},"content":[{"type":"paragraph","content":[]}]}]}]}
        ]
    });
    let result = decode_normalize_validate(&encoded(candidate), &AllowIdentities).unwrap();
    let value = result.document().to_json_value();
    assert_eq!(value["profile"], "prose");
    assert_eq!(value["content"][0]["content"].as_array().unwrap().len(), 1);
    assert_eq!(value["content"][0]["content"][0]["text"], "a\nbc");
    assert_eq!(
        value["content"][0]["content"][0]["marks"][0]["type"],
        "strong"
    );
    assert_eq!(
        value["content"][0]["content"][0]["marks"][1]["type"],
        "emphasis"
    );
    assert!(value["content"][1].get("attrs").is_none());
    assert!(
        value["content"][2]["content"][0]["content"][0]
            .get("attrs")
            .is_none()
    );
    let repeated = validate_normalized_json(result.canonical_json(), &AllowIdentities).unwrap();
    assert_eq!(repeated.canonical_json(), result.canonical_json());
}

#[test]
fn stanza_breaks_merge_without_changing_lines() {
    let candidate = json!({
        "schema":"klenwriter.document","schema_version":1,"profile":"poetry",
        "content":[{"type":"verse","content":[
            {"type":"verse_line","content":[{"type":"text","text":"one"}]},
            {"type":"stanza_break","attrs":{"blank_lines":1}},
            {"type":"stanza_break","attrs":{"blank_lines":2}},
            {"type":"verse_line","content":[]}
        ]}]
    });
    let result = decode_normalize_validate(&encoded(candidate), &AllowIdentities).unwrap();
    assert_eq!(
        result.document().to_json_value()["content"][0]["content"][1]["attrs"]["blank_lines"],
        3
    );
}

#[test]
fn ancestry_and_mark_failures_are_typed() {
    let prose_verse = json!({
        "schema":"klenwriter.document","schema_version":1,"profile":"prose",
        "content":[{"type":"verse","content":[{"type":"verse_line","content":[]}]}]
    });
    assert_eq!(
        validate_normalized_json(&encoded(prose_verse), &AllowIdentities)
            .unwrap_err()
            .code,
        KwdjErrorCode::InvalidProfileContent
    );

    let nested_spoiler = json!({
        "schema":"klenwriter.document","schema_version":1,"profile":"prose",
        "content":[{"type":"spoiler","attrs":{"label":"outer"},"content":[
            {"type":"spoiler","attrs":{"label":"inner"},"content":[{"type":"paragraph","content":[]}]}
        ]}]
    });
    assert_eq!(
        validate_normalized_json(&encoded(nested_spoiler), &AllowIdentities)
            .unwrap_err()
            .code,
        KwdjErrorCode::RecursiveSpoiler
    );

    let duplicate_marks = json!({
        "schema":"klenwriter.document","schema_version":1,"profile":"prose",
        "content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"strong"},{"type":"strong"}]}]}]
    });
    assert_eq!(
        decode_normalize_validate(&encoded(duplicate_marks), &AllowIdentities)
            .unwrap_err()
            .code,
        KwdjErrorCode::DuplicateMarkType
    );
}

#[test]
fn canonical_serialization_sorts_keys_and_has_no_whitespace() {
    let document = json!({
        "schema_version":1,"profile":"prose","content":[{"content":[],"type":"paragraph"}],"schema":"klenwriter.document"
    });
    let result = validate_normalized_json(&encoded(document), &AllowIdentities).unwrap();
    assert_eq!(
        result.canonical_json(),
        br#"{"content":[{"content":[],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}"#
    );
}

fn assert_resolution(
    result: Result<klenwriter_editor_kwdj::ValidatedDocument, klenwriter_editor_kwdj::KwdjError>,
    expected_code: Option<KwdjErrorCode>,
    category: &str,
) {
    match expected_code {
        Some(expected_code) => {
            let error = result.expect_err("identity result must be rejected");
            assert_eq!(error.code, expected_code);
            if expected_code == KwdjErrorCode::IdentityResolutionFailed {
                assert_eq!(error.context.category, Some(category));
                assert!(error.context.limit.is_none());
                assert!(error.context.maximum.is_none());
                assert!(error.context.observed.is_none());
            }
        }
        None => assert!(result.is_ok(), "existing identity must be accepted"),
    }
}

fn table_with_span(attribute: &str, value: u64) -> Value {
    let mut attrs = serde_json::Map::new();
    attrs.insert(attribute.to_owned(), Value::from(value));
    json!({
        "schema":"klenwriter.document","schema_version":1,"profile":"prose",
        "content":[{"type":"table","content":[{"type":"table_row","content":[{
            "type":"table_cell","attrs":attrs,"content":[{"type":"paragraph","content":[]}]
        }]}]}]
    })
}

fn media_document() -> Value {
    json!({
        "schema":"klenwriter.document","schema_version":1,"profile":"prose",
        "content":[{"type":"media_image","attrs":{
            "media_asset_id":"00000000-0000-1000-8000-000000000001",
            "alt":"image","align":"none"
        }}]
    })
}

fn duplicate_identity_document() -> Value {
    let media = media_document()["content"][0].clone();
    let reference =
        reference_document("00000000-0000-1000-8000-000000000002")["content"][0].clone();
    json!({
        "schema":"klenwriter.document","schema_version":1,"profile":"prose",
        "content":[media.clone(), media, reference.clone(), reference]
    })
}

fn reference_document(id: &str) -> Value {
    json!({
        "schema":"klenwriter.document","schema_version":1,"profile":"prose",
        "content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"reference_link","attrs":{"reference_entity_id":id}}]}]}]
    })
}

fn link_document(href: &str) -> Value {
    json!({
        "schema":"klenwriter.document","schema_version":1,"profile":"prose",
        "content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"link","attrs":{"href":href}}]}]}]
    })
}

fn encoded(value: Value) -> Vec<u8> {
    serde_json::to_vec(&value).unwrap()
}
