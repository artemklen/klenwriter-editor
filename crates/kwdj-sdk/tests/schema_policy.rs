// SPDX-License-Identifier: MIT OR Apache-2.0
//! Regressions from the accepted schema/finalizer/discard contract. These public
//! boundary expectations were authored before the corresponding repair.
use editor_bridge::{Distribution, DistributionSession, Endpoint};
use klenwriter_editor_kwdj_sdk::KwdjFactory;
use serde_json::{Value, json};
const INPUT:&[u8]=br#"{"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[{"type":"text","text":"a"}]}]}"#;
const BUILD: &str = "kwdj-narrowed-policy-regression";
const TEXT: &str = "org.klenwriter.kwdj/text";
const STRONG: &str = "org.klenwriter.kwdj/strong";
fn options() -> Value {
    let mut descriptor =
        serde_json::to_value(editor_kwdj::registry::registry_descriptor()).unwrap();
    descriptor["mark_policy"] = json!({TEXT:[]});
    descriptor["selected_extensions"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"org.example.policy/recipes","version":"1.0.0"}));
    descriptor["extensions"] = json!([{"id":"org.example.policy/recipes","version":"1.0.0","dependencies":[],"nodes":[],"marks":[],"commands":[{
        "kind":"recipe","id":"org.example.policy/command/replace-with-discarded-mark",
        "parameters":{"leaf":{"kind":"node"},"parent":{"kind":"node"}},
        "operations":[
            {"op":"replace_text","leaf":{"kind":"argument","name":"leaf"},"from":{"kind":"literal","value":0},"to":{"kind":"literal","value":1},"text":{"kind":"literal","value":""}},
            {"op":"set_marks","leaf":{"kind":"argument","name":"leaf"},"marks":[{"type_id":STRONG,"attributes":{}}]},
            {"op":"insert_fragment","parent":{"kind":"argument","name":"parent"},"index":{"kind":"literal","value":1},"fragment":[{"type_id":TEXT,"attributes":{},"marks":[],"text":{"kind":"literal","value":"b"},"children":[]}]}
        ],"selection":{"kind":"map_current"},"stored_marks":{"kind":"keep"}
    }]}]);
    let mut profile =
        serde_json::to_value(klenwriter_editor_kwdj_sdk::manifest().profiles.remove(0)).unwrap();
    profile["extensions"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"org.example.policy/recipes","version":"1.0.0"}));
    json!({"abi":"editor-sdk/2","build_id":BUILD,"profile":profile,"admission":"validate","access":"editable","registry_json":descriptor.to_string(),"profile_options_json":json!({"identities":{"media":[],"references":[]},"limits":null}).to_string()})
}
fn call(session: &mut DistributionSession, request: Value) -> Value {
    serde_json::from_str(&session.call_json(&request.to_string())).unwrap()
}
fn state(session: &mut DistributionSession) -> Value {
    let r = call(session, json!({"kind":"state"}));
    assert_eq!(r["status"], "ok", "{r}");
    r["value"]["state"].clone()
}
fn open() -> DistributionSession {
    let d = Distribution::new(BUILD, vec![Box::new(KwdjFactory)]).unwrap();
    let mut session = d.open(INPUT, &options().to_string());
    assert_eq!(state(&mut session)["stamp"]["revision"], "0");
    session
}
fn nodes(session: &mut DistributionSession) -> (Value, Value) {
    let s = state(session);
    let root = call(
        session,
        json!({"kind":"node","stamp":s["stamp"],"node":s["root"]}),
    );
    let paragraph = root["value"]["node"]["children"][0].clone();
    let p = call(
        session,
        json!({"kind":"node","stamp":s["stamp"],"node":paragraph}),
    );
    (paragraph, p["value"]["node"]["children"][0].clone())
}
fn canonical(session: &mut DistributionSession) -> Value {
    let stamp = state(session)["stamp"].clone();
    let r = call(
        session,
        json!({"kind":"snapshot","stamp":stamp,"max_bytes":16777216}),
    );
    assert_eq!(r["status"], "ok");
    let doc = serde_json::from_str(r["value"]["canonical_json"].as_str().unwrap()).unwrap();
    assert_eq!(
        call(
            session,
            json!({"kind":"release_snapshot","handle":r["value"]["handle"]})
        )["status"],
        "ok"
    );
    doc
}
#[test]
fn final_typing_override_obeys_the_frozen_text_mark_policy() {
    let mut s = open();
    let (_, leaf) = nodes(&mut s);
    let at = json!({"kind":"text","node":leaf,"offset":1,"affinity":"after"});
    let stamp = state(&mut s)["stamp"].clone();
    assert_eq!(
        call(
            &mut s,
            json!({"kind":"set_selection","stamp":stamp,"selection":{"anchor":at,"focus":at}})
        )["status"],
        "ok"
    );
    let before = state(&mut s);
    let before_doc = canonical(&mut s);
    let resources = s.own_resource_counts();
    let query = call(
        &mut s,
        json!({"kind":"query_command","stamp":before["stamp"],"command":{"id":"org.klenwriter.kwdj/command/toggle-mark","payload_json":json!({"kind":"toggle_mark","mark":{"type_id":STRONG,"attributes":{}}}).to_string()}}),
    );
    let set = call(
        &mut s,
        json!({"kind":"set_stored_marks","stamp":before["stamp"],"marks":[{"type_id":STRONG,"attributes":{}}]}),
    );
    let after = state(&mut s);
    eprintln!("narrowed future marks query={query}, set={set}, after={after}");
    assert_eq!(
        query["value"]["available"], false,
        "profile schema must constrain future marks during query"
    );
    assert_eq!(
        query["value"]["diagnostic"]["code"],
        "registry.mark_not_allowed"
    );
    assert_eq!(set["status"], "refused");
    assert_eq!(set["diagnostic"]["code"], "registry.mark_not_allowed");
    assert_eq!(after, before);
    assert_eq!(canonical(&mut s), before_doc);
    assert_eq!(s.own_resource_counts(), resources);
    s.destroy();
}
#[test]
fn normalization_cannot_launder_a_schema_forbidden_mark_on_discarded_text() {
    let mut s = open();
    let (parent, leaf) = nodes(&mut s);
    let before = state(&mut s);
    let before_doc = canonical(&mut s);
    let resources = s.own_resource_counts();
    let command = json!({"id":"org.example.policy/command/replace-with-discarded-mark","payload_json":json!({"kind":"recipe","arguments":{"nodes":{"leaf":leaf,"parent":parent},"values":{}}}).to_string()});
    let query = call(
        &mut s,
        json!({"kind":"query_command","stamp":before["stamp"],"command":command}),
    );
    let execute = call(
        &mut s,
        json!({"kind":"command","stamp":before["stamp"],"command":command,"history_hint":{"kind":"isolated"}}),
    );
    let after = state(&mut s);
    let after_doc = canonical(&mut s);
    eprintln!("narrowed discard query={query}, execute={execute}, canonical={after_doc}");
    assert_eq!(
        query["value"]["available"], false,
        "schema-invalid original metadata must refuse before normalization discards it"
    );
    assert_eq!(
        query["value"]["diagnostic"]["code"],
        "registry.mark_not_allowed"
    );
    assert_eq!(execute["status"], "refused");
    assert_eq!(execute["diagnostic"]["code"], "registry.mark_not_allowed");
    assert_eq!(after, before);
    assert_eq!(after_doc, before_doc);
    assert_eq!(s.own_resource_counts(), resources);
    s.destroy();
}

#[test]
fn import_cannot_discard_schema_forbidden_original_mark_metadata() {
    let d = Distribution::new(BUILD, vec![Box::new(KwdjFactory)]).unwrap();
    let mut options = options();
    options["admission"] = "normalize".into();
    let input=json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[{"type":"text","text":"","marks":[{"type":"strong"}]}]}]}).to_string();
    let original = input.clone();
    let mut session = d.open(input.as_bytes(), &options.to_string());
    let initial = serde_json::to_value(session.initialization()).unwrap();
    eprintln!("narrowed import initialization={initial}");
    if initial["status"] == "ok" {
        eprintln!(
            "narrowed import silently normalized canonical={}",
            canonical(&mut session)
        );
    }
    assert_eq!(
        initial["status"], "refused",
        "schema metadata must be guarded before import removes empty Text"
    );
    assert_eq!(initial["diagnostic"]["code"], "registry.mark_not_allowed");
    assert_eq!(session.own_resource_counts().sessions, 0);
    assert!(session.context().is_none());
    assert_eq!(input, original);
    session.destroy();
}
