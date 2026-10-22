// SPDX-License-Identifier: MIT OR Apache-2.0
//! Native stage ownership for unchanged clipboard corpus literals. TS conversion
//! and browser presentation have separate evidence; no generated native goldens.
use editor_bridge::{Distribution, DistributionSession, Endpoint};
use klenwriter_editor_kwdj_sdk::{KwdjFactory, manifest};
use serde_json::{Value, json};
fn call(session: &mut DistributionSession, request: Value) -> Value {
    serde_json::from_str(&session.call_json(&request.to_string())).unwrap()
}
#[test]
fn accepted_clipboard_corpus_fragments_admit_and_insert_as_one_native_history_unit() {
    let positive: Value = serde_json::from_str(include_str!(
        "../../../contracts/kwdj/v1/fixtures/positive.json"
    ))
    .unwrap();
    let negative: Value = serde_json::from_str(include_str!(
        "../../../contracts/kwdj/v1/fixtures/negative.json"
    ))
    .unwrap();
    let fixtures: Vec<&Value> = positive["fixtures"]
        .as_array()
        .unwrap()
        .iter()
        .chain(negative["fixtures"].as_array().unwrap())
        .filter(|f| {
            matches!(
                f["id"].as_str(),
                Some(
                    "DOC-028"
                        | "DOC-029"
                        | "DOC-030"
                        | "DOC-031"
                        | "DOC-032"
                        | "DOC-033"
                        | "DOC-034"
                )
            )
        })
        .collect();
    assert_eq!(fixtures.len(), 7);
    let mut admitted = 0;
    for fixture in fixtures {
        let case = &fixture["cases"][0];
        if case["expected"]["outcome"] == "rejected" {
            assert!(matches!(
                fixture["id"].as_str(),
                Some("DOC-031" | "DOC-033")
            ));
            continue; // Decoder refusal has no native insertion candidate; not a native rejection PASS.
        }
        let expected = &case["kwdj"];
        let mode = &expected["profile"];
        let source = json!({"schema":"klenwriter.document","schema_version":1,"profile":mode,"content":[{"type":"paragraph","content":[{"type":"text","text":"original"}]}]});
        let options = json!({"abi":"editor-sdk/2","build_id":"clipboard-corpus-native-v1","profile":manifest().profiles[0],"admission":"validate","access":"editable","registry_json":serde_json::to_string(&editor_kwdj::registry::registry_descriptor()).unwrap(),"profile_options_json":json!({"identities":{"media":[],"references":[]},"limits":null}).to_string()});
        let distribution =
            Distribution::new("clipboard-corpus-native-v1", vec![Box::new(KwdjFactory)]).unwrap();
        let mut session = distribution.open(source.to_string().as_bytes(), &options.to_string());
        assert!(
            matches!(
                session.initialization(),
                editor_protocol::SdkResponse::Ok { .. }
            ),
            "{}: open",
            fixture["id"]
        );
        let before = call(&mut session, json!({"kind":"state"}))["value"]["state"].clone();
        let gap = json!({"kind":"child","parent":before["root"],"index":0,"affinity":"after"});
        let end = json!({"kind":"child","parent":before["root"],"index":1,"affinity":"after"});
        let selected = call(
            &mut session,
            json!({"kind":"set_selection","stamp":before["stamp"],"selection":{"anchor":gap,"focus":end}}),
        );
        assert_eq!(selected["status"], "ok");
        let stamp = selected["value"]["state"]["stamp"].clone();
        let fragment = json!({"format_id":"org.klenwriter.kwdj/clipboard-fragment/1","source_profile":{"profile_id":"org.klenwriter.kwdj","profile_version":"1.0.0","codec_id":"org.klenwriter.kwdj/json","wire_version":1},"mode":mode,"kind":"blocks","content":expected["content"],"open_start":false,"open_end":false});
        let inserted = call(
            &mut session,
            json!({"kind":"command","stamp":stamp,"command":{"id":"org.klenwriter.kwdj/command/insert-fragment","payload_json":json!({"kind":"insert_fragment","fragment_json":fragment.to_string()}).to_string()},"history_hint":{"kind":"isolated"}}),
        );
        assert_eq!(inserted["status"], "ok", "{}: {inserted}", fixture["id"]);
        assert_eq!(inserted["value"]["state"]["history"]["undo_entries"], "1");
        let snap = call(
            &mut session,
            json!({"kind":"snapshot","stamp":inserted["value"]["state"]["stamp"],"max_bytes":2097152}),
        );
        assert_eq!(snap["status"], "ok");
        let actual: Value =
            serde_json::from_str(snap["value"]["canonical_json"].as_str().unwrap()).unwrap();
        assert_eq!(&actual, expected, "{}: canonical literal", fixture["id"]);
        assert_eq!(
            call(
                &mut session,
                json!({"kind":"release_snapshot","handle":snap["value"]["handle"]})
            )["status"],
            "ok"
        );
        let undo = call(
            &mut session,
            json!({"kind":"history","stamp":inserted["value"]["state"]["stamp"],"direction":"undo"}),
        );
        assert_eq!(undo["status"], "ok");
        let restored = call(
            &mut session,
            json!({"kind":"snapshot","stamp":undo["value"]["state"]["stamp"],"max_bytes":2097152}),
        );
        assert_eq!(restored["status"], "ok");
        let actual: Value =
            serde_json::from_str(restored["value"]["canonical_json"].as_str().unwrap()).unwrap();
        assert_eq!(actual, source);
        assert_eq!(
            call(
                &mut session,
                json!({"kind":"release_snapshot","handle":restored["value"]["handle"]})
            )["status"],
            "ok"
        );
        admitted += 1;
    }
    assert_eq!(admitted, 5);
}
