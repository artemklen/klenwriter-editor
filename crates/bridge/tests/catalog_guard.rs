// SPDX-License-Identifier: MIT OR Apache-2.0
mod support;
use editor_protocol::{BridgeRequest, SdkReply, SdkResponse};

#[test]
fn public_bridge_bounds_and_validates_runtime_catalog_before_serializing() {
    for (ids, code) in [
        (
            (0..257)
                .map(|i| format!("org.example.transport/{i}"))
                .collect(),
            "command_catalog_limit",
        ),
        (
            vec!["org.example.transport/x".into(); 2],
            "command_id_duplicate",
        ),
        (vec!["unqualified".into()], "command_id_invalid"),
        (
            vec![format!("org.example.transport/{}", "a".repeat(129))],
            "command_id_invalid",
        ),
    ] {
        let mut bridge = support::bridge(ids);
        assert!(matches!(bridge.initialization(), SdkResponse::Ok { .. }));
        let before = serde_json::to_value(bridge.call(BridgeRequest::State {})).unwrap();
        let SdkResponse::Refused { diagnostic } = bridge.call(BridgeRequest::Catalog {}) else {
            panic!("invalid catalog escaped transport guard: {code}");
        };
        assert_eq!(diagnostic.code, code);
        assert!(!diagnostic.may_have_committed);
        assert_eq!(
            before,
            serde_json::to_value(bridge.call(BridgeRequest::State {})).unwrap()
        );
        bridge.destroy();
    }
    let ids = vec![
        "org.example.transport/Z".into(),
        "org.example.transport/a".into(),
    ];
    let mut bridge = support::bridge(ids.clone());
    let SdkResponse::Ok { value } = bridge.call(BridgeRequest::Catalog {}) else {
        panic!("valid catalog refused");
    };
    let SdkReply::Catalog { commands } = *value else {
        panic!("catalog reply missing");
    };
    assert_eq!(commands, ids);
}
