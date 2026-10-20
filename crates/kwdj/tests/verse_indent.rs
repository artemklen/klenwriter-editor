// SPDX-License-Identifier: MIT OR Apache-2.0
use klenwriter_editor_kwdj::{
    IdentityResolver, IdentityResolverError, IdentityStatus, KwdjErrorCode, NormalizationEvent,
    decode_normalize_validate, validate_normalized_json,
};
use uuid::Uuid;

struct Allow;

impl IdentityResolver for Allow {
    fn resolve_media(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(IdentityStatus::Exists)
    }
    fn resolve_reference(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(IdentityStatus::Exists)
    }
}

fn poem(line: &str) -> String {
    format!(
        r#"{{"schema":"klenwriter.document","schema_version":1,"profile":"poetry","content":[{{"type":"verse","content":[{line}]}}]}}"#
    )
}

fn line(indent: &str, text: &str) -> String {
    format!(
        r#"{{"type":"verse_line","attrs":{{"indent":{indent}}},"content":[{{"type":"text","text":"{text}"}}]}}"#
    )
}

#[test]
fn indent_one_through_eight_round_trips_and_zero_is_omitted() {
    for indent in 1..=8 {
        let raw = poem(&line(&indent.to_string(), "step"));
        let admitted = decode_normalize_validate(raw.as_bytes(), &Allow).unwrap();
        let canonical = std::str::from_utf8(admitted.canonical_json()).unwrap();
        assert!(canonical.contains(&format!("\"indent\":{indent}")));
        let again = validate_normalized_json(admitted.canonical_json(), &Allow).unwrap();
        assert_eq!(again.canonical_json(), admitted.canonical_json());
    }

    let zero = poem(&line("0", "flat"));
    let admitted = decode_normalize_validate(zero.as_bytes(), &Allow).unwrap();
    let canonical = std::str::from_utf8(admitted.canonical_json()).unwrap();
    assert!(!canonical.contains("indent"));
    assert!(
        admitted
            .normalization_events()
            .contains(&NormalizationEvent::VerseIndentDefaultRemoved)
    );
    let bare = poem(r#"{"type":"verse_line","content":[{"type":"text","text":"  leading"}]}"#);
    let plain = decode_normalize_validate(bare.as_bytes(), &Allow).unwrap();
    let plain_json = std::str::from_utf8(plain.canonical_json()).unwrap();
    assert!(plain_json.contains("  leading"));
    assert!(!plain_json.contains("indent"));
}

#[test]
fn bad_indent_is_a_typed_structure_error() {
    for indent in ["-1", "1.5", "\"3\"", "9", "true"] {
        let raw = poem(&line(indent, "nope"));
        let error = decode_normalize_validate(raw.as_bytes(), &Allow).unwrap_err();
        assert_eq!(error.code, KwdjErrorCode::InvalidStructure);
        assert!(error.path.contains("indent"), "{}", error.path);
    }
}
