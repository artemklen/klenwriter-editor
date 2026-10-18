// SPDX-License-Identifier: MIT OR Apache-2.0
//! Independent original-header copy-budget regression, authored before repair.
use klenwriter_editor_kwdj::{
    AdmissionBudget, IdentityResolver, IdentityResolverError, IdentityStatus, KwdjErrorCode,
    Limits, decode_normalize_validate_with_limits_and_budget,
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
