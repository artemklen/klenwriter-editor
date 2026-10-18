// SPDX-License-Identifier: MIT OR Apache-2.0
//! Actual composition metadata/resource authority, independent of JS fixtures.
use klenwriter_editor_wasm::{sdk, sdk_v2};
use serde_json::{Value, json};
const INPUT:&[u8]=br#"{"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[{"type":"text","text":"a"}]}]}"#;
#[test]
fn selected_compiled_modules_and_legacy_share_one_native_resource_authority() {
    let manifest = sdk_v2::manifest();
    assert_eq!(manifest.abi, "editor-sdk/2");
    assert_eq!(manifest.registry_format, "editor-registry/1");
    assert_eq!(manifest.build_id, sdk::manifest().build_id);
    let ids: Vec<_> = manifest
        .profiles
        .iter()
        .map(|p| p.profile_id.as_str())
        .collect();
    #[cfg(feature = "notes")]
    assert_eq!(ids, vec!["org.example.notes", "org.klenwriter.kwdj"]);
    #[cfg(not(feature = "notes"))]
    assert_eq!(ids, vec!["org.klenwriter.kwdj"]);
    let legacy = sdk::manifest();
    assert_eq!(legacy.abi, "editor-sdk/1");
    assert_eq!(legacy.profiles.len(), 1);
    let profile = serde_json::to_value(&legacy.profiles[0]).unwrap();
    let options = json!({"abi":"editor-sdk/2","build_id":manifest.build_id,"profile":profile,"admission":"validate","access":"editable","registry_json":serde_json::to_string(&editor_kwdj::registry::registry_descriptor()).unwrap(),"profile_options_json":json!({"identities":{"media":[],"references":[]},"limits":null}).to_string()});
    let baseline = sdk::resource_counts();
    let mut old=sdk::BridgeSession::new(INPUT,&json!({"abi":legacy.abi,"build_id":legacy.build_id,"profile":profile,"admission":"validate","access":"editable","identities":{"media":[],"references":[]},"limits":null}).to_string());
    let mut new = sdk_v2::BridgeSession::new(INPUT, &options.to_string());
    assert!(matches!(
        old.initialization(),
        klenwriter_editor_wasm::sdk_wire::SdkResponse::Ok { .. }
    ));
    assert!(matches!(
        new.initialization(),
        klenwriter_editor_wasm::sdk_wire::SdkResponse::Ok { .. }
    ));
    assert!(new.context().is_some());
    assert_eq!(sdk::resource_counts(), sdk_v2::resource_counts());
    assert_eq!(sdk::resource_counts().sessions, baseline.sessions + 2);
    assert_eq!(old.own_resource_counts().sessions, 1);
    assert_eq!(new.own_resource_counts().sessions, 1);
    let mut wrong = options.clone();
    wrong["profile"]["wire_version"] = 2.into();
    let refused = sdk_v2::BridgeSession::new(b"invalid document", &wrong.to_string());
    assert!(
        matches!(refused.initialization(),klenwriter_editor_wasm::sdk_wire::SdkResponse::Refused{diagnostic} if diagnostic.code=="profile.unsupported_wire_version")
    );
    assert!(refused.context().is_none());
    assert_eq!(refused.own_resource_counts().sessions, 0);
    let response: Value = serde_json::from_str(&new.call_json(r#"{"kind":"state"}"#)).unwrap();
    assert_eq!(response["status"], "ok");
    old.destroy();
    new.destroy();
    new.destroy();
    assert_eq!(sdk::resource_counts(), baseline);
}
