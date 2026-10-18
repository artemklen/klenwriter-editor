// SPDX-License-Identifier: MIT OR Apache-2.0
//! Existing DOC-026 normative node-count inputs, not an output-derived oracle.
use editor_bridge::{Distribution, Endpoint};
use editor_protocol::{SdkReply, SdkResponse};
use klenwriter_editor_kwdj_sdk::KwdjFactory;
use serde_json::{Value, json};

#[test]
fn normative_node_ceiling_survives_both_admitted_proofs_and_exact_export() {
    const BUILD: &str = "admission-cache-independent-boundary";
    for nodes in [49_999usize, 50_000] {
        let mut children = Vec::new();
        if nodes % 2 == 1 { children.push(json!({"type":"scene_break"})); }
        children.extend((0..nodes/2).map(|_| json!({"type":"paragraph","content":[{"type":"text","text":"x"}]})));
        let document = json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":children});
        let input = document.to_string();
        let profile = klenwriter_editor_kwdj_sdk::manifest().profiles.remove(0);
        let options = json!({"abi":"editor-sdk/2","build_id":BUILD,"profile":profile,"admission":"validate","access":"editable",
            "registry_json":serde_json::to_string(&editor_kwdj::registry::registry_descriptor()).unwrap(),
            "profile_options_json":json!({"identities":{"media":[],"references":[]},"limits":null}).to_string()});
        let distribution = Distribution::new(BUILD, vec![Box::new(KwdjFactory)]).unwrap();
        let mut session = distribution.open(input.as_bytes(), &options.to_string());
        let SdkResponse::Ok { value } = session.initialization() else { panic!("normative {nodes}-node document refused: {:?}", session.initialization()); };
        let SdkReply::State { state } = *value else { panic!("initial state missing"); };
        let snapshot: Value = serde_json::from_str(&session.call_json(&json!({"kind":"snapshot","stamp":state.stamp,"max_bytes":16777216}).to_string())).unwrap();
        assert_eq!(snapshot["status"], "ok", "{snapshot}");
        assert_eq!(serde_json::from_str::<Value>(snapshot["value"]["canonical_json"].as_str().unwrap()).unwrap(), document);
        session.destroy();
        assert_eq!(session.own_resource_counts().sessions, 0);
        assert_eq!(session.own_resource_counts().snapshot_handles, 0);
    }
}
