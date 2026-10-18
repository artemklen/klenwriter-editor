// SPDX-License-Identifier: MIT OR Apache-2.0
//! Independent regressions frozen before the raw import header repair. The
//! public profile factory may normalize documented defaults, never malformed
//! metadata hidden in a retired text leaf or an absent-token mark.
use editor_bridge::{Distribution, DistributionSession, Endpoint};
use editor_protocol::SdkResponse;
use klenwriter_editor_kwdj_sdk::KwdjFactory;
use serde_json::{Value, json};

const BUILD: &str = "kwdj-import-closed-metadata-regression";
const EMPTY: &str = r#"{"content":[{"content":[],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}"#;
const PLAIN: &str = r#"{"content":[{"content":[{"text":"a","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}"#;

fn options(narrowed: bool) -> Value {
    let mut descriptor = editor_kwdj::registry::registry_descriptor();
    if narrowed {
        descriptor
            .mark_policy
            .insert("org.klenwriter.kwdj/text".into(), vec![]);
    }
    json!({"abi":"editor-sdk/2","build_id":BUILD,
        "profile":klenwriter_editor_kwdj_sdk::manifest().profiles.remove(0),
        "admission":"normalize","access":"editable","registry_json":serde_json::to_string(&descriptor).unwrap(),
        "profile_options_json":json!({"identities":{"media":[],"references":[]},"limits":null}).to_string()})
}
fn input(text: Value) -> Vec<u8> {
    serde_json::to_vec(
        &json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose",
        "content":[{"type":"paragraph","content":[text]}]}),
    )
    .unwrap()
}
fn call(session: &mut DistributionSession, request: Value) -> Value {
    serde_json::from_str(&session.call_json(&request.to_string())).unwrap()
}
fn canonical(session: &mut DistributionSession) -> String {
    let state = call(session, json!({"kind":"state"}));
    let snapshot = call(
        session,
        json!({"kind":"snapshot","stamp":state["value"]["state"]["stamp"],"max_bytes":4096}),
    );
    assert_eq!(snapshot["status"], "ok", "{snapshot}");
    let result = snapshot["value"]["canonical_json"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        call(
            session,
            json!({"kind":"release_snapshot","handle":snapshot["value"]["handle"]})
        )["status"],
        "ok"
    );
    result
}

#[test]
fn default_and_narrowed_import_refuse_original_malformed_metadata_before_normalization() {
    let distribution = Distribution::new(BUILD, vec![Box::new(KwdjFactory)]).unwrap();
    let malformed = [
        (
            "empty_text_unknown_attr",
            json!({"type":"text","text":"","attrs":{"extra":1}}),
        ),
        (
            "empty_text_unknown_field",
            json!({"type":"text","text":"","extra":true}),
        ),
        // Text has no attrs field at all in the closed wire model. Even the
        // malformed boolean must diagnose that unknown field, not disappear.
        (
            "empty_text_wrong_attrs_shape",
            json!({"type":"text","text":"","attrs":true}),
        ),
        (
            "absent_color_unknown_attr",
            json!({"type":"text","text":"a","marks":[{"type":"text_color","attrs":{"token":"none","extra":1}}]}),
        ),
        (
            "absent_color_unknown_field",
            json!({"type":"text","text":"a","marks":[{"type":"text_color","attrs":{"token":"default"},"extra":true}]}),
        ),
        (
            "absent_highlight_unknown_attr",
            json!({"type":"text","text":"a","marks":[{"type":"highlight","attrs":{"token":"NONE","extra":1}}]}),
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
            "duplicate_absent_tokens_are_not_active_duplicates",
            json!({"type":"text","text":"a","marks":[{"type":"text_color","attrs":{"token":"none"}},{"type":"text_color","attrs":{"token":"default"}}]}),
            PLAIN,
        ),
    ];
    let mut unexpected = vec![];
    for narrowed in [false, true] {
        let options = options(narrowed).to_string();
        for (name, text) in &malformed {
            let input = input(text.clone());
            let original = input.clone();
            let mut session = distribution.open(&input, &options);
            match session.initialization() {
                SdkResponse::Refused { diagnostic } => {
                    assert_eq!(
                        diagnostic.code, "kwdj.unknown_attribute",
                        "{name}, narrowed={narrowed}: {diagnostic:?}"
                    );
                    // The shared native internally-tagged decoder reports
                    // nested shape failures at its enclosing root node.
                    assert!(
                        diagnostic.path.starts_with("/content/0"),
                        "{name}: {}",
                        diagnostic.path
                    );
                    assert!(!diagnostic.may_have_committed);
                    assert!(session.context().is_none());
                }
                actual => unexpected.push(format!(
                    "{name}, narrowed={narrowed}: {actual:?}; canonical={}",
                    canonical(&mut session)
                )),
            }
            assert_eq!(input, original);
            session.destroy();
            let resources = session.own_resource_counts();
            assert_eq!(resources.sessions, 0);
            assert_eq!(resources.snapshot_handles, 0);
            assert_eq!(resources.snapshot_bytes, "0");
            assert_eq!(resources.protected_cursors, 0);
        }
        for (name, text, expected) in &controls {
            let input = input(text.clone());
            let original = input.clone();
            let mut session = distribution.open(&input, &options);
            assert!(
                matches!(session.initialization(), SdkResponse::Ok { .. }),
                "control {name}, narrowed={narrowed}: {:?}",
                session.initialization()
            );
            assert_eq!(
                canonical(&mut session),
                *expected,
                "control {name}, narrowed={narrowed}"
            );
            assert_eq!(input, original);
            session.destroy();
            let resources = session.own_resource_counts();
            assert_eq!(resources.sessions, 0);
            assert_eq!(resources.snapshot_handles, 0);
            assert_eq!(resources.protected_cursors, 0);
        }
    }
    assert!(
        unexpected.is_empty(),
        "Original malformed metadata was discarded:\n{}",
        unexpected.join("\n")
    );
}
