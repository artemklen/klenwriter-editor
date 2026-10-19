// SPDX-License-Identifier: MIT OR Apache-2.0
extern crate editor_notes as klenwriter_editor_notes;

#[allow(dead_code)]
#[path = "../../notes/tests/support/mod.rs"]
mod support;

use editor_bridge::{Distribution, DistributionSession, Endpoint};
use editor_notes::{
    BASE_EXTENSION, CODEC_ID, INSERT_TEXT, PARAGRAPH, PROFILE_ID, SET_TAGS, SET_TITLE, VERSION,
};
use editor_protocol::{SdkReply, SdkResponse};
use klenwriter_editor_notes_sdk::NotesFactory;
use serde_json::{Value, json};
use std::path::Path;

const BUILD: &str = "notes-factory-native-fixture";

#[test]
fn abi2_selected_text_is_explicitly_unsupported_by_notes_without_state_change() {
    let input = include_bytes!("../../../contracts/dom/v1/inputs/Notes-D0.json");
    let mut session = distribution().open(input, &options(false).to_string());
    let id = path(&mut session, &[json!(0), json!(0)]);
    let st = state(&mut session);
    let selected = call(
        &mut session,
        json!({"kind":"set_selection","stamp":st["stamp"],"selection":{"anchor":{"kind":"text","node":id,"offset":0,"affinity":"after"},"focus":{"kind":"text","node":id,"offset":1,"affinity":"after"}}}),
    );
    assert_eq!(selected["status"], "ok", "{selected}");
    let before = state(&mut session);
    let resources = session.own_resource_counts();
    let result = call(
        &mut session,
        json!({"kind":"selection_text","stamp":before["stamp"],"max_bytes":1024}),
    );
    assert_eq!(
        result,
        json!({"status":"refused","diagnostic":{"code":"profile.selection_text_unsupported","path":"","category":"sdk","details":{},"stamp":before["stamp"],"may_have_committed":false}})
    );
    assert_eq!(state(&mut session), before);
    assert_eq!(session.own_resource_counts(), resources);
    session.destroy();
}

fn distribution() -> Distribution {
    Distribution::new(BUILD, vec![Box::new(NotesFactory)]).unwrap()
}
fn options(d1: bool) -> Value {
    let descriptor = support::descriptor(d1);
    let mut extensions = vec![json!({"id":BASE_EXTENSION,"version":VERSION})];
    let mut blocks = vec![PARAGRAPH];
    if d1 {
        extensions.extend([
            json!({"id":"org.example.notes/callout","version":VERSION}),
            json!({"id":"org.example.notes/highlight","version":VERSION}),
        ]);
        blocks.push("org.example.notes/callout");
    }
    json!({"abi":"editor-sdk/2","build_id":BUILD,
        "profile":{"profile_id":PROFILE_ID,"profile_version":VERSION,"codec_id":CODEC_ID,
            "wire_version":1,"extensions":extensions},"admission":"validate","access":"editable",
        "registry_json":serde_json::to_string(&descriptor).unwrap(),
        "profile_options_json":json!({"root_blocks":blocks,"limits":null}).to_string()})
}
fn call(session: &mut DistributionSession, request: Value) -> Value {
    serde_json::from_str(&session.call_json(&request.to_string())).unwrap()
}
fn state(session: &mut DistributionSession) -> Value {
    let response = call(session, json!({"kind":"state"}));
    assert_eq!(response["status"], "ok", "{response}");
    response["value"]["state"].clone()
}
fn snapshot(session: &mut DistributionSession) -> String {
    let stamp = state(session)["stamp"].clone();
    let response = call(
        session,
        json!({"kind":"snapshot","stamp":stamp,"max_bytes":16777216}),
    );
    assert_eq!(response["status"], "ok", "{response}");
    let result = response["value"]["canonical_json"]
        .as_str()
        .unwrap()
        .to_owned();
    let release = call(
        session,
        json!({"kind":"release_snapshot","handle":response["value"]["handle"]}),
    );
    assert_eq!(release["status"], "ok", "{release}");
    result
}
fn path(session: &mut DistributionSession, indices: &[Value]) -> String {
    let current = state(session);
    let mut id = current["root"].as_str().unwrap().to_owned();
    // Literal paths start at the authored semantic document, beneath synthetic root.
    for index in std::iter::once(0).chain(indices.iter().map(|v| v.as_u64().unwrap() as usize)) {
        let response = call(
            session,
            json!({"kind":"node","stamp":current["stamp"],"node":id}),
        );
        assert_eq!(response["status"], "ok", "{response}");
        id = response["value"]["node"]["children"][index]
            .as_str()
            .unwrap()
            .into();
    }
    id
}
fn point(session: &mut DistributionSession, literal: &Value) -> Value {
    let id = path(session, literal["path"].as_array().unwrap());
    match literal["kind"].as_str().unwrap() {
        "text" => {
            json!({"kind":"text","node":id,"offset":literal["offset"],"affinity":literal["affinity"]})
        }
        "child" => {
            json!({"kind":"child","parent":id,"index":literal["index"],"affinity":literal["affinity"]})
        }
        "edge" => json!({"kind":"edge","node":id,"side":literal["side"]}),
        _ => panic!("invalid independent point"),
    }
}
fn selection(session: &mut DistributionSession, literal: &Value) -> Value {
    if literal.is_null() {
        return Value::Null;
    }
    json!({"anchor":point(session,&literal["anchor"]),"focus":point(session,&literal["focus"])})
}
fn marks(literal: &Value) -> Value {
    if literal.is_null() {
        return Value::Null;
    }
    Value::Array(
        literal
            .as_array()
            .unwrap()
            .iter()
            .map(|mark| {
                let attrs: serde_json::Map<String, Value> = mark["attrs"]
                    .as_object()
                    .unwrap()
                    .iter()
                    .map(|(name, value)| (name.clone(), json!({"kind":"string","value":value})))
                    .collect();
                json!({"type_id":mark["type"],"attributes":attrs})
            })
            .collect(),
    )
}

#[test]
fn all_53_codec_literals_through_compiled_factory_and_real_bridge() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../contracts/notes/v1");
    let corpus: Value =
        serde_json::from_slice(&std::fs::read(root.join("vectors.json")).unwrap()).unwrap();
    let distribution = distribution();
    for case in corpus["cases"].as_array().unwrap() {
        let mut options = options(case["registry"] == "D1");
        options["admission"] = json!(if case["mode"] == "import" {
            "normalize"
        } else {
            "validate"
        });
        let input = std::fs::read(root.join(case["input"].as_str().unwrap())).unwrap();
        let original = input.clone();
        let mut session = distribution.open(&input, &options.to_string());
        match (
            case["expected"]["kind"].as_str().unwrap(),
            session.initialization(),
        ) {
            ("accepted", SdkResponse::Ok { value }) => {
                assert!(matches!(*value, SdkReply::State { .. }));
                assert!(session.context().is_some());
                let expected =
                    std::fs::read(root.join(case["expected"]["canonical"].as_str().unwrap()))
                        .unwrap();
                assert_eq!(
                    snapshot(&mut session).as_bytes(),
                    expected,
                    "{}",
                    case["id"]
                );
            }
            ("refused", SdkResponse::Refused { diagnostic }) => {
                assert_eq!(
                    diagnostic.code,
                    case["expected"]["code"].as_str().unwrap(),
                    "{}",
                    case["id"]
                );
                assert_eq!(
                    diagnostic.path,
                    case["expected"]["path"].as_str().unwrap(),
                    "{}",
                    case["id"]
                );
                assert!(!diagnostic.may_have_committed);
                assert!(session.context().is_none());
            }
            (_, actual) => panic!("{}: {actual:?}", case["id"]),
        }
        assert_eq!(input, original);
        session.destroy();
        let resources = session.own_resource_counts();
        assert_eq!(resources.sessions, 0);
        assert_eq!(resources.snapshot_handles, 0);
        assert_eq!(resources.protected_cursors, 0);
    }
}

#[test]
fn all_18_native_command_literals_through_real_bridge_query_and_history() {
    let corpus: Value = serde_json::from_slice(include_bytes!(
        "../../../contracts/notes/v1/commands/vectors.json"
    ))
    .unwrap();
    let distribution = distribution();
    for case in corpus["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let mut session = distribution.open(
            case["input"].as_str().unwrap().as_bytes(),
            &options(true).to_string(),
        );
        assert!(
            session.context().is_some(),
            "{id}: {:?}",
            session.initialization()
        );
        if !case["selection"].is_null() {
            let selection = selection(&mut session, &case["selection"]);
            let stamp = state(&mut session)["stamp"].clone();
            assert_eq!(
                call(
                    &mut session,
                    json!({"kind":"set_selection","stamp":stamp,"selection":selection})
                )["status"],
                "ok",
                "{id}"
            );
        }
        if !case["storedMarks"].is_null() {
            let stamp = state(&mut session)["stamp"].clone();
            assert_eq!(
                call(
                    &mut session,
                    json!({"kind":"set_stored_marks","stamp":stamp,"marks":marks(&case["storedMarks"])})
                )["status"],
                "ok",
                "{id}"
            );
        }
        let before = state(&mut session);
        let command = json!({"id":case["command"]["id"],"payload_json":case["command"]["payload"].to_string()});
        let query = call(
            &mut session,
            json!({"kind":"query_command","stamp":before["stamp"],"command":command}),
        );
        for _ in 0..3 {
            assert_eq!(
                call(
                    &mut session,
                    json!({"kind":"query_command","stamp":before["stamp"],"command":command})
                ),
                query,
                "{id}"
            );
            assert_eq!(state(&mut session), before, "{id}: pure query");
        }
        let result = call(
            &mut session,
            json!({"kind":"command","stamp":before["stamp"],"command":command,"history_hint":{"kind":"isolated"}}),
        );
        let expected = &case["expected"];
        match expected["kind"].as_str().unwrap() {
            "changed" | "unchanged" => {
                assert_eq!(query["value"]["available"], true, "{id}: {query}");
                assert_eq!(query["value"]["effect"], expected["kind"], "{id}");
                assert_eq!(result["status"], "ok", "{id}: {result}");
                assert_eq!(result["value"]["effect"], expected["kind"], "{id}");
            }
            "refused" => {
                assert_eq!(query["value"]["available"], false, "{id}: {query}");
                assert_eq!(
                    query["value"]["diagnostic"]["code"], expected["code"],
                    "{id}"
                );
                assert_eq!(result["status"], "refused", "{id}: {result}");
                assert_eq!(result["diagnostic"]["code"], expected["code"], "{id}");
                assert_eq!(state(&mut session), before, "{id}: refusal retains state");
            }
            _ => panic!("invalid independent expected kind"),
        }
        assert_eq!(
            snapshot(&mut session),
            expected["canonical"].as_str().unwrap(),
            "{id}: literal canonical"
        );
        let expected_selection = if expected["selection"] == "same_as_before" {
            before["selection"].clone()
        } else {
            selection(&mut session, &expected["selection"])
        };
        assert_eq!(
            state(&mut session)["selection"],
            expected_selection,
            "{id}: literal caret"
        );
        assert_eq!(
            state(&mut session)["stored_marks"],
            marks(&expected["storedMarks"]),
            "{id}: marks"
        );
        if expected["kind"] == "changed" {
            for (direction, canonical) in [
                ("undo", case["input"].as_str().unwrap()),
                ("redo", expected["canonical"].as_str().unwrap()),
            ] {
                let stamp = state(&mut session)["stamp"].clone();
                let query = call(
                    &mut session,
                    json!({"kind":"query_history","stamp":stamp,"direction":direction}),
                );
                assert_eq!(query["value"]["available"], true, "{id}: {query}");
                let outcome = call(
                    &mut session,
                    json!({"kind":"history","stamp":stamp,"direction":direction}),
                );
                assert_eq!(outcome["status"], "ok", "{id}: {outcome}");
                assert_eq!(
                    snapshot(&mut session),
                    canonical,
                    "{id}: literal {direction}"
                );
            }
        }
        session.destroy();
        assert_eq!(session.own_resource_counts().sessions, 0);
    }
}

#[test]
fn closed_options_payloads_and_raw_registry_refuse_without_publication() {
    let distribution = distribution();
    let input = include_bytes!("../../../contracts/notes/v1/inputs/N001-empty-document.json");
    let mut normal = options(false);
    for raw in [
        r#"{"root_blocks":["org.example.notes/paragraph"]}"#,
        r#"{"root_blocks":["org.example.notes/paragraph"],"limits":null,"extra":true}"#,
        r#"{"root_blocks":["org.example.notes/paragraph"],"limits":null,"limits":null}"#,
    ] {
        normal["profile_options_json"] = json!(raw);
        let session = distribution.open(b"invalid authored JSON", &normal.to_string());
        assert!(
            matches!(session.initialization(),SdkResponse::Refused{diagnostic}if diagnostic.code=="sdk.invalid_dto")
        );
        assert!(session.context().is_none());
    }
    let mut raw = options(false);
    let descriptor = raw["registry_json"].as_str().unwrap().replacen(
        '{',
        "{\"format\":\"editor-registry/1\",",
        1,
    );
    raw["registry_json"] = json!(descriptor);
    assert!(
        matches!(distribution.open(b"invalid authored JSON",&raw.to_string()).initialization(),SdkResponse::Refused{diagnostic}if diagnostic.code=="registry.duplicate_json_key")
    );
    let mut session = distribution.open(input, &options(false).to_string());
    let before = state(&mut session);
    for payload in [
        r#"{"title":"x","extra":true}"#,
        r#"{"title":null}"#,
        r#"{"title":"x","title":"y"}"#,
        r#"{"title":"\uD800"}"#,
    ] {
        let result = call(
            &mut session,
            json!({"kind":"command","stamp":before["stamp"],"command":{"id":SET_TITLE,"payload_json":payload},"history_hint":{"kind":"isolated"}}),
        );
        assert_eq!(result["status"], "refused", "{result}");
        assert_eq!(result["diagnostic"]["code"], "sdk.invalid_dto", "{result}");
        assert_eq!(state(&mut session), before);
    }
    let catalog = call(&mut session, json!({"kind":"catalog"}));
    assert_eq!(
        catalog["value"]["commands"],
        json!([INSERT_TEXT, SET_TAGS, SET_TITLE])
    );
}

#[test]
fn effective_limits_context_and_existing_d0_session_are_frozen() {
    let distribution = distribution();
    let input = include_bytes!("../../../contracts/notes/v1/inputs/N001-empty-document.json");
    let default = distribution.open(input, &options(false).to_string());
    let base = default.context().unwrap().clone();
    let mut raised = options(false);
    raised["profile_options_json"]=json!({"root_blocks":[PARAGRAPH],"limits":{
        "document_bytes":"18446744073709551615","node_count":"18446744073709551615","tree_depth":"18446744073709551615",
        "text_leaf_bytes":"18446744073709551615","work_units":"18446744073709551615","work_bytes":"18446744073709551615"}}).to_string().into();
    let raised = distribution.open(input, &raised.to_string());
    assert_eq!(
        raised.context(),
        Some(&base),
        "raw raised limits clamp to identical effective context"
    );
    let mut lower = options(false);
    lower["profile_options_json"]=json!({"root_blocks":[PARAGRAPH],"limits":{
        "document_bytes":"8192","node_count":null,"tree_depth":null,"text_leaf_bytes":null,"work_units":null,"work_bytes":null}}).to_string().into();
    let lower = distribution.open(input, &lower.to_string());
    let lower = lower.context().unwrap();
    assert_eq!(lower.registry_digest, base.registry_digest);
    assert_ne!(lower.capability_digest, base.capability_digest);
    let mut d0 = distribution.open(input, &options(false).to_string());
    let before = state(&mut d0);
    let d1input = include_bytes!("../../../contracts/notes/v1/inputs/N005-highlight-only.json");
    let d1 = distribution.open(d1input, &options(true).to_string());
    assert!(d1.context().is_some());
    assert_ne!(d1.context().unwrap().registry_digest, base.registry_digest);
    let refused = call(
        &mut d0,
        json!({"kind":"remount","stamp":before["stamp"],"input_json":std::str::from_utf8(d1input).unwrap(),"admission":"validate"}),
    );
    assert_eq!(refused["status"], "refused");
    assert_eq!(refused["diagnostic"]["code"], "notes.unknown_mark");
    assert_eq!(state(&mut d0), before);
    assert_eq!(
        snapshot(&mut d0).as_bytes(),
        include_bytes!("../../../contracts/notes/v1/expected/N001-empty-document.canonical.json")
    );
}
