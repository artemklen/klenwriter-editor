// SPDX-License-Identifier: MIT OR Apache-2.0
//! Additive source-first controls; no old oracle/assertion is rewritten here.
use editor_bridge::{Distribution, DistributionSession, Endpoint};
use serde_json::{Value, json};
use std::collections::BTreeMap;

const INSERT: &str = "org.klenwriter.kwdj/command/insert-typed-text";
const RESTORE: &str = "org.klenwriter.kwdj/command/restore-typed-text";
const DATA: &str = include_str!("support/typography_protected_edge_oracles.json");
fn data() -> Value {
    serde_json::from_str(DATA).unwrap()
}
fn call(s: &mut DistributionSession, request: Value) -> Value {
    serde_json::from_str(&s.call_json(&request.to_string())).unwrap()
}
fn ok(reply: Value) -> Value {
    assert_eq!(reply["status"], "ok", "{reply}");
    reply["value"].clone()
}
fn state(s: &mut DistributionSession) -> Value {
    ok(call(s, json!({"kind":"state"})))["state"].clone()
}
fn open(c: &Value) -> DistributionSession {
    let registry = editor_kwdj::registry::typing_registry_descriptor();
    let mut profile =
        serde_json::to_value(&klenwriter_editor_kwdj_sdk::manifest().profiles[0]).unwrap();
    profile["extensions"] = serde_json::to_value(&registry.selected_extensions).unwrap();
    let options = json!({"abi":"editor-sdk/2","build_id":"typography-protected-source-controls-v1","profile":profile,"admission":"validate","access":"editable","registry_json":serde_json::to_string(&registry).unwrap(),"profile_options_json":json!({"identities":c["identities"],"limits":null,"typing_rules":{"version":1,"locale":"ru","rules":null,"limits":null}}).to_string()});
    let distribution = Distribution::new(
        "typography-protected-source-controls-v1",
        vec![Box::new(klenwriter_editor_kwdj_sdk::KwdjFactory)],
    )
    .unwrap();
    let s = distribution.open(
        c["beforeCanonical"].as_str().unwrap().as_bytes(),
        &options.to_string(),
    );
    assert!(
        matches!(s.initialization(), editor_protocol::SdkResponse::Ok { .. }),
        "{:?}",
        s.initialization()
    );
    s
}
fn node(s: &mut DistributionSession, id: &Value) -> Value {
    let stamp = state(s)["stamp"].clone();
    ok(call(s, json!({"kind":"node","stamp":stamp,"node":id})))["node"].clone()
}
fn block(s: &mut DistributionSession) -> Value {
    let root = state(s)["root"].clone();
    node(s, &root)["children"][0].clone()
}
fn leaf(s: &mut DistributionSession, b: &Value, index: usize) -> Value {
    node(s, b)["children"][index].clone()
}
fn at(id: &Value, offset: usize) -> Value {
    json!({"kind":"text","node":id,"offset":offset,"affinity":"after"})
}
fn select(s: &mut DistributionSession, point: Value) {
    let stamp = state(s)["stamp"].clone();
    ok(call(
        s,
        json!({"kind":"set_selection","stamp":stamp,"selection":{"anchor":point,"focus":point}}),
    ));
}
fn wire_mark(mark: &Value) -> Value {
    let attributes = mark
        .get("attrs")
        .and_then(Value::as_object)
        .map(|a| {
            a.iter()
                .map(|(k, v)| {
                    (
                        k.clone(),
                        json!({"kind":"string","value":v.as_str().unwrap()}),
                    )
                })
                .collect::<BTreeMap<_, _>>()
        })
        .unwrap_or_default();
    json!({"type_id":format!("org.klenwriter.kwdj/{}",mark["type"].as_str().unwrap()),"attributes":attributes})
}
fn stored(s: &mut DistributionSession, marks: Value) {
    let stamp = state(s)["stamp"].clone();
    ok(call(
        s,
        json!({"kind":"set_stored_marks","stamp":stamp,"marks":marks}),
    ));
}
fn command(s: &mut DistributionSession, id: &str, payload: Value) -> Value {
    let stamp = state(s)["stamp"].clone();
    call(
        s,
        json!({"kind":"input_command","stamp":stamp,"command":{"id":id,"payload_json":payload.to_string()}}),
    )
}
fn quote(s: &mut DistributionSession) -> Value {
    ok(command(
        s,
        INSERT,
        json!({"kind":"insert_typed_text","text":"\"","origin":"ordinary_insert_text"}),
    ))
}
fn restore(s: &mut DistributionSession, descriptor: Value) -> Value {
    command(
        s,
        RESTORE,
        json!({"kind":"restore_typed_text","restore":descriptor}),
    )
}
fn snapshot(s: &mut DistributionSession) -> String {
    let stamp = state(s)["stamp"].clone();
    let v = ok(call(
        s,
        json!({"kind":"snapshot","stamp":stamp,"max_bytes":16384}),
    ));
    let result = v["canonical_json"].as_str().unwrap().to_owned();
    ok(call(
        s,
        json!({"kind":"release_snapshot","handle":v["handle"]}),
    ));
    result
}
fn history(s: &mut DistributionSession, direction: &str) {
    let stamp = state(s)["stamp"].clone();
    ok(call(
        s,
        json!({"kind":"history","stamp":stamp,"direction":direction}),
    ));
}
fn increment(before: &Value, after: &Value, name: &str) {
    assert_eq!(
        after["stamp"][name]
            .as_str()
            .unwrap()
            .parse::<u64>()
            .unwrap(),
        before["stamp"][name]
            .as_str()
            .unwrap()
            .parse::<u64>()
            .unwrap()
            + 1
    );
}
fn clean(s: &mut DistributionSession) {
    let own = s.own_resource_counts();
    assert_eq!(
        (
            own.sessions,
            own.snapshot_handles,
            own.snapshot_bytes.as_str(),
            own.protected_cursors
        ),
        (1, 0, "0", 1)
    );
    s.destroy();
    assert_eq!(
        s.own_resource_counts(),
        editor_protocol::ResourceCountsDto {
            sessions: 0,
            snapshot_handles: 0,
            snapshot_bytes: "0".into(),
            protected_cursors: 0
        }
    );
}

#[test]
fn current_protected_leaf_at_zero_overrides_explicit_empty_stored_marks() {
    for c in data()["currentLeafCases"].as_array().unwrap() {
        let mut s = open(c);
        let root = state(&mut s)["root"].clone();
        let b = block(&mut s);
        let t = leaf(&mut s, &b, 0);
        select(&mut s, at(&t, 0));
        stored(&mut s, json!([]));
        let before = state(&mut s);
        let result = quote(&mut s);
        assert_eq!(result["effect"], "changed");
        assert!(result["result"].is_null(), "{}: {result}", c["id"]);
        assert_eq!(snapshot(&mut s), c["afterCanonical"].as_str().unwrap());
        let after = state(&mut s);
        for field in ["revision", "selection_epoch", "history_epoch"] {
            increment(&before, &after, field);
        }
        assert_eq!(after["history"]["undo_entries"], "1");
        assert_eq!(after["history"]["redo_entries"], "0");
        assert_eq!(after["stored_marks"], json!([]));
        assert_eq!(after["root"], root);
        assert_eq!(block(&mut s), b);
        assert_eq!(leaf(&mut s, &b, 1), t);
        let q = leaf(&mut s, &b, 0);
        assert_ne!(q, t);
        assert_eq!(
            after["selection"],
            json!({"anchor":at(&q,1),"focus":at(&q,1)})
        );
        history(&mut s, "undo");
        assert_eq!(snapshot(&mut s), c["beforeCanonical"].as_str().unwrap());
        assert_eq!(state(&mut s)["selection"], before["selection"]);
        history(&mut s, "redo");
        assert_eq!(snapshot(&mut s), c["afterCanonical"].as_str().unwrap());
        assert_eq!(leaf(&mut s, &b, 0), q);
        assert_eq!(leaf(&mut s, &b, 1), t);
        clean(&mut s);
    }
}

#[test]
fn explicit_restore_with_current_protected_stored_marks_refuses_atomically() {
    for c in data()["protectedRestoreCases"].as_array().unwrap() {
        let mut s = open(c);
        let b = block(&mut s);
        select(
            &mut s,
            json!({"kind":"child","parent":b,"index":0,"affinity":"after"}),
        );
        let result = quote(&mut s);
        let mut descriptor = result["result"]["raw_restore"].clone();
        assert!(descriptor.is_object());
        assert_eq!(snapshot(&mut s), c["cookedCanonical"].as_str().unwrap());
        stored(&mut s, json!([wire_mark(&c["mark"])]));
        let before = state(&mut s);
        let canonical = snapshot(&mut s);
        // Explicit host edit intent, not a claim that a historical receipt is
        // authentic or automatic. Native protection must still admit/refuse it.
        descriptor["stamp"] = before["stamp"].clone();
        descriptor["stored_marks"] = before["stored_marks"].clone();
        descriptor["raw_stored_marks"] = before["stored_marks"].clone();
        let response = restore(&mut s, descriptor);
        assert_eq!(response["status"], "refused", "{}: {response}", c["id"]);
        assert_eq!(state(&mut s), before);
        assert_eq!(snapshot(&mut s), canonical);
        clean(&mut s);
    }
}

#[test]
fn highlighted_published_restore_round_trips_through_public_wire() {
    let c = &data()["highlightRestore"];
    let mut s = open(c);
    let root = state(&mut s)["root"].clone();
    let b = block(&mut s);
    select(
        &mut s,
        json!({"kind":"child","parent":b,"index":0,"affinity":"after"}),
    );
    stored(&mut s, json!([wire_mark(&c["mark"])]));
    let before = state(&mut s);
    let result = quote(&mut s);
    let descriptor = result["result"]["raw_restore"].clone();
    assert!(descriptor.is_object());
    assert_eq!(snapshot(&mut s), c["cookedCanonical"].as_str().unwrap());
    let cooked = state(&mut s);
    let q = leaf(&mut s, &b, 0);
    let restored = ok(restore(&mut s, descriptor));
    assert_eq!(restored["effect"], "changed");
    assert!(restored["result"].is_null());
    assert_eq!(snapshot(&mut s), c["rawCanonical"].as_str().unwrap());
    let raw = state(&mut s);
    let r = leaf(&mut s, &b, 0);
    assert_ne!(q, r);
    increment(&before, &cooked, "revision");
    increment(&cooked, &raw, "revision");
    assert_eq!(cooked["history"]["undo_entries"], "1");
    assert_eq!(raw["history"]["undo_entries"], "2");
    assert_eq!(raw["stored_marks"], before["stored_marks"]);
    for (direction, key, id) in [
        ("undo", "cookedCanonical", Some(&q)),
        ("undo", "beforeCanonical", None),
        ("redo", "cookedCanonical", Some(&q)),
        ("redo", "rawCanonical", Some(&r)),
    ] {
        history(&mut s, direction);
        assert_eq!(snapshot(&mut s), c[key].as_str().unwrap());
        assert_eq!(state(&mut s)["root"], root);
        assert_eq!(block(&mut s), b);
        if let Some(id) = id {
            assert_eq!(leaf(&mut s, &b, 0), *id);
        }
    }
    clean(&mut s);
}
