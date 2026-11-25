// SPDX-License-Identifier: MIT OR Apache-2.0
//! Independent original-header copy-budget regression, authored before repair.
use klenwriter_editor_kwdj::{
    AdmissionBudget, IdentityResolver, IdentityResolverError, IdentityStatus, KwdjErrorCode,
    Limits, decode_candidate_value_with_limits_and_budget,
    decode_normalize_validate_with_limits_and_budget, normalize_and_validate,
};
use serde_json::{Map, Value, json};
use uuid::Uuid;

struct NoIdentities;
impl IdentityResolver for NoIdentities {
    fn resolve_media(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        panic!("a metadata refusal must precede any identity lookup");
    }
    fn resolve_reference(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        panic!("a metadata refusal must precede any identity lookup");
    }
}

fn input(key: String) -> Vec<u8> {
    let mut text = Map::new();
    text.insert("type".into(), Value::String("text".into()));
    text.insert("text".into(), Value::String(String::new()));
    text.insert(key, Value::Bool(false));
    serde_json::to_vec(&json!({
        "schema":"klenwriter.document", "schema_version":1, "profile":"prose",
        "content":[{"type":"paragraph", "content":[Value::Object(text)]}]
    }))
    .unwrap()
}

#[test]
fn original_unknown_header_key_is_charged_before_copying_or_escaping() {
    // The input is below the existing16MiB raw/payload caps. A4MiB key alone
    // needs64MiB under the original-header16x copy policy, before any header,
    // path, scalar or container overhead. It must refuse before key.clone().
    let large = input("~".repeat(4 * 1024 * 1024));
    assert!(large.len() < 16 * 1024 * 1024);
    let error = decode_normalize_validate_with_limits_and_budget(
        &large,
        &NoIdentities,
        Limits::default(),
        AdmissionBudget::default(),
    )
    .expect_err("large original key must refuse");
    // Print only the compact enum on failure, never the enormous escaped path.
    assert_eq!(error.code, KwdjErrorCode::OperationalBudgetExceeded);

    let small = input("small~key".into());
    let error = decode_normalize_validate_with_limits_and_budget(
        &small,
        &NoIdentities,
        Limits::default(),
        AdmissionBudget::default(),
    )
    .expect_err("small unknown field must remain a closed-shape refusal");
    assert_eq!(error.code, KwdjErrorCode::UnknownAttribute);
    assert!(error.path.ends_with("/small~0key"));
}

#[test]
fn large_rich_document_preserves_candidate_admission() {
    let paragraph = json!({
        "type": "paragraph",
        "content": [{"type": "text", "text": "x", "marks": [{"type": "strong"}]}],
    });
    let document = json!({
        "schema": "klenwriter.document",
        "schema_version": 1,
        "profile": "prose",
        "content": vec![paragraph; 23_500],
    });
    let raw = serde_json::to_vec(&document).unwrap();
    let budget = AdmissionBudget::default();
    let candidate =
        decode_candidate_value_with_limits_and_budget(&document, Limits::default(), budget)
            .expect("large valid rich prose must stay admissible as a borrowed document");
    let borrowed = normalize_and_validate(candidate, &NoIdentities).unwrap();
    let decoded = decode_normalize_validate_with_limits_and_budget(
        &raw,
        &NoIdentities,
        Limits::default(),
        budget,
    )
    .expect("large valid rich prose must stay admissible at the raw codec boundary");
    assert_eq!(borrowed.canonical_json(), decoded.canonical_json());
    assert_eq!(
        serde_json::from_slice::<Value>(decoded.canonical_json()).unwrap(),
        document
    );
}

#[test]
fn independently_checked_headers_can_collapse_into_one_canonical_text_leaf() {
    let nested_list = |content: Vec<Value>| {
        let mut block = json!({"type": "paragraph", "content": content});
        for _ in 0..14 {
            block = json!({"type": "bullet_list", "content": [
                {"type": "list_item", "content": [block]},
            ]});
        }
        json!({
            "schema": "klenwriter.document",
            "schema_version": 1,
            "profile": "prose",
            "content": [block],
        })
    };
    let document = nested_list(vec![json!({"type": "text", "text": "x"}); 110_000]);
    let expected = nested_list(vec![json!({"type": "text", "text": "x".repeat(110_000)})]);
    let raw = serde_json::to_vec(&document).unwrap();
    // Leave room in the 3 MiB CMS save request for its surrounding envelope.
    assert!(raw.len() < 3_000_000);
    let budget = AdmissionBudget::default();
    let candidate =
        decode_candidate_value_with_limits_and_budget(&document, Limits::default(), budget)
            .expect("each original header is small and the whole input is within preflight limits");
    let borrowed = normalize_and_validate(candidate, &NoIdentities).unwrap();
    let decoded = decode_normalize_validate_with_limits_and_budget(
        &raw,
        &NoIdentities,
        Limits::default(),
        budget,
    )
    .expect("the raw boundary must normalize the same admitted candidate");
    assert_eq!(borrowed.canonical_json(), decoded.canonical_json());
    assert_eq!(
        serde_json::from_slice::<Value>(decoded.canonical_json()).unwrap(),
        expected
    );
}
