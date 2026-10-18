// SPDX-License-Identifier: MIT OR Apache-2.0
//! Closed-field expectations authored before centralizing the direct import
//! shape guard. Unknown authored metadata must survive until typed refusal.
use std::cell::Cell;

use klenwriter_editor_kwdj::{
    AdmissionBudget, IdentityResolver, IdentityResolverError, IdentityStatus, KwdjErrorCode,
    Limits, decode_normalize_validate_with_limits_and_budget,
};
use serde_json::{Value, json};
use uuid::Uuid;

struct Identities(Cell<usize>);
impl IdentityResolver for Identities {
    fn resolve_media(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        self.0.set(self.0.get() + 1);
        Err(IdentityResolverError::Unavailable)
    }
    fn resolve_reference(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        self.0.set(self.0.get() + 1);
        Err(IdentityResolverError::Unavailable)
    }
}
const EMPTY: &str = r#"{"content":[{"content":[],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}"#;
const PLAIN: &str = r#"{"content":[{"content":[{"text":"a","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}"#;
const LINES: &str = r#"{"content":[{"content":[{"text":"a\nb","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}"#;
const SPACES: &str = r#"{"content":[{"content":[{"text":"a  b","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}"#;

fn input(text: Value) -> Vec<u8> {
    serde_json::to_vec(
        &json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose",
        "content":[{"type":"paragraph","content":[text]}]}),
    )
    .unwrap()
}

#[test]
fn direct_import_refuses_six_malformed_headers_without_changing_eight_valid_controls() {
    let identities = Identities(Cell::new(0));
    // The existing internally-tagged native decoder reports nested malformed
    // fields at the enclosing root; preserve its precise root diagnostic paths.
    let malformed = [
        (
            "empty_text_unknown_attr",
            json!({"type":"text","text":"","attrs":{"extra":1}}),
            "/content/0/attrs",
        ),
        (
            "empty_text_unknown_field",
            json!({"type":"text","text":"","extra":true}),
            "/content/0/extra",
        ),
        (
            "empty_text_wrong_attrs_shape",
            json!({"type":"text","text":"","attrs":true}),
            "/content/0/attrs",
        ),
        (
            "absent_color_unknown_attr",
            json!({"type":"text","text":"a","marks":[{"type":"text_color","attrs":{"token":"none","extra":1}}]}),
            "/content/0/extra",
        ),
        (
            "absent_color_unknown_field",
            json!({"type":"text","text":"a","marks":[{"type":"text_color","attrs":{"token":"default"},"extra":true}]}),
            "/content/0/extra",
        ),
        (
            "absent_highlight_unknown_attr",
            json!({"type":"text","text":"a","marks":[{"type":"highlight","attrs":{"token":"NONE","extra":1}}]}),
            "/content/0/extra",
        ),
    ];
    let controls = [
        ("empty", json!({"type":"text","text":""}), EMPTY),
        ("plain", json!({"type":"text","text":"a"}), PLAIN),
        (
            "known_casing_and_absent_tokens",
            json!({"type":"TeXt","text":"a","marks":[{"type":"TEXT_COLOR","attrs":{"token":"NoNe"}},{"type":"HIGHLIGHT","attrs":{"token":"DeFaUlT"}}]}),
            PLAIN,
        ),
        (
            "duplicate_absent_color_tokens",
            json!({"type":"text","text":"a","marks":[{"type":"text_color","attrs":{"token":"none"}},{"type":"text_color","attrs":{"token":"default"}}]}),
            PLAIN,
        ),
        (
            "duplicate_absent_highlight_tokens",
            json!({"type":"text","text":"a","marks":[{"type":"highlight","attrs":{"token":"none"}},{"type":"highlight","attrs":{"token":"default"}}]}),
            PLAIN,
        ),
        (
            "documented_newlines",
            json!({"type":"text","text":"a\r\nb"}),
            LINES,
        ),
        (
            "space_nbsp_exact",
            json!({"type":"text","text":"a  b"}),
            SPACES,
        ),
        (
            "valid_active_mark_on_empty_text",
            json!({"type":"text","text":"","marks":[{"type":"strong"}]}),
            EMPTY,
        ),
    ];
    let mut unexpected = vec![];
    for (name, text, path) in malformed {
        let input = input(text);
        let original = input.clone();
        match decode_normalize_validate_with_limits_and_budget(
            &input,
            &identities,
            Limits::default(),
            AdmissionBudget::default(),
        ) {
            Ok(value) => unexpected.push(format!(
                "{name}: {}",
                String::from_utf8_lossy(value.canonical_json())
            )),
            Err(error) => {
                assert_eq!(
                    error.code,
                    KwdjErrorCode::UnknownAttribute,
                    "{name}: {error:?}"
                );
                assert_eq!(error.path, path, "{name}");
            }
        }
        assert_eq!(input, original);
    }
    for (name, text, canonical) in controls {
        let input = input(text);
        let original = input.clone();
        let admitted = decode_normalize_validate_with_limits_and_budget(
            &input,
            &identities,
            Limits::default(),
            AdmissionBudget::default(),
        )
        .unwrap_or_else(|error| panic!("valid control {name}: {error:?}"));
        assert_eq!(
            admitted.canonical_json(),
            canonical.as_bytes(),
            "{name}: independent canonical literal"
        );
        assert_eq!(input, original);
    }
    assert_eq!(identities.0.get(), 0, "no identities in any authored input");
    assert!(
        unexpected.is_empty(),
        "Direct codec discarded original malformed metadata:\n{}",
        unexpected.join("\n")
    );
}
