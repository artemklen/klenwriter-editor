// SPDX-License-Identifier: MIT OR Apache-2.0
//! Independently authored Document-envelope closure cases. Root-level node
//! metadata remains unknown even when node normalization would remove it.
use std::cell::Cell;

use klenwriter_editor_kwdj::{
    AdmissionBudget, IdentityResolver, IdentityResolverError, IdentityStatus, KwdjErrorCode,
    Limits, decode_normalize_validate_with_limits_and_budget,
};
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

#[test]
fn direct_import_refuses_unknown_original_document_fields_before_normalization() {
    let identities = Identities(Cell::new(0));
    // Document has only schema/schema_version/profile/content. Its unknown
    // marks and attrs do not acquire node semantics through normalization.
    // Keep the existing native decoder's enclosing-root field suffix paths.
    let malformed = [
        (
            "empty_marks",
            r#"{"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[]}],"marks":[]}"#,
            "/marks/marks",
        ),
        (
            "absent_color_mark",
            r#"{"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[]}],"marks":[{"type":"text_color","attrs":{"token":"none"}}]}"#,
            "/marks/marks",
        ),
        (
            "absent_highlight_mark",
            r#"{"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[]}],"marks":[{"type":"HIGHLIGHT","attrs":{"token":"DeFaUlT"}}]}"#,
            "/marks/marks",
        ),
        (
            "active_mark",
            r#"{"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[]}],"marks":[{"type":"strong"}]}"#,
            "/marks/marks",
        ),
        (
            "empty_attrs",
            r#"{"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[]}],"attrs":{}}"#,
            "/attrs/attrs",
        ),
        (
            "authored_attrs",
            r#"{"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[]}],"attrs":{"title":"keep authored data"}}"#,
            "/attrs/attrs",
        ),
    ];
    let mut accepted = vec![];
    for (name, input, path) in malformed {
        let bytes = input.as_bytes().to_vec();
        let original = bytes.clone();
        match decode_normalize_validate_with_limits_and_budget(
            &bytes,
            &identities,
            Limits::default(),
            AdmissionBudget::default(),
        ) {
            Ok(value) => {
                let lost = format!(
                    "{name}: {}",
                    String::from_utf8_lossy(value.canonical_json())
                );
                eprintln!("UNEXPECTED ACCEPTANCE {lost}");
                accepted.push(lost);
            }
            Err(error) => {
                assert_eq!(
                    error.code,
                    KwdjErrorCode::UnknownAttribute,
                    "{name}: {error:?}"
                );
                assert_eq!(error.path, path, "{name}");
            }
        }
        assert_eq!(
            bytes, original,
            "{name}: caller bytes remain owned unchanged"
        );
    }
    let admitted = decode_normalize_validate_with_limits_and_budget(
        br#"{"schema":"klenwriter.document","schema_version":1,"profile":"PrOsE","content":[{"type":"PARAGRAPH","content":[{"type":"TEXT","text":"","marks":[]}],"attrs":{}}]}"#,
        &identities, Limits::default(), AdmissionBudget::default(),
    ).expect("known child-node defaults and profile casing remain normalizable");
    assert_eq!(admitted.canonical_json(), EMPTY.as_bytes());
    assert_eq!(identities.0.get(), 0);
    assert!(
        accepted.is_empty(),
        "Direct codec discarded unknown Document fields:\n{}",
        accepted.join("\n")
    );
}
