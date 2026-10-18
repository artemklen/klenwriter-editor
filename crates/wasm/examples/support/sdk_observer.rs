// SPDX-License-Identifier: MIT OR Apache-2.0
//! Real public bridge witnesses shared byte-for-byte by native and WASM lanes.
//! Expected documents/codes are independent literals, never profile-generated.

use klenwriter_editor_wasm::sdk::{BridgeSession, manifest, resource_counts};
use serde_json::{Value, json};

const VECTORS: &str = include_str!("../../../../contracts/sdk/v1/vectors.json");
const PREFIX: &str = "org.klenwriter.kwdj/command/";
const REFERENCE: &str = "550e8400-e29b-41d4-a716-446655440006";

fn vectors() -> Value {
    serde_json::from_str(VECTORS).unwrap()
}
fn profile() -> Value {
    json!({"profile_id":"org.klenwriter.kwdj","profile_version":"1.0.0",
        "codec_id":"org.klenwriter.kwdj/json","wire_version":1,
        "extensions":[{"id":"org.klenwriter.kwdj/base","version":"1.0.0"}]})
}
fn options(access: &str, admission: &str, identities: Value) -> Value {
    let actual = manifest();
    assert_eq!(actual.abi, "editor-sdk/1");
    assert_eq!(
        serde_json::to_value(&actual.profiles).unwrap(),
        json!([profile()])
    );
    json!({"abi":"editor-sdk/1","build_id":actual.build_id,"profile":profile(),
        "admission":admission,"access":access,"identities":identities,"limits":null})
}
fn empty_facts() -> Value {
    json!({"media":[],"references":[]})
}
fn facts(status: &str) -> Value {
    json!({"media":[],"references":[{"id":REFERENCE,"status":status}]})
}
fn response(bridge: &mut BridgeSession, request: Value) -> Value {
    serde_json::from_str(&bridge.call_json(&request.to_string())).unwrap()
}
fn ok(reply: Value) -> Value {
    assert_eq!(reply["status"], "ok", "{reply:#}");
    reply["value"].clone()
}
fn call(bridge: &mut BridgeSession, request: Value) -> Value {
    ok(response(bridge, request))
}
fn state(bridge: &mut BridgeSession) -> Value {
    call(bridge, json!({"kind":"state"}))["state"].clone()
}
fn stamp(bridge: &mut BridgeSession) -> Value {
    state(bridge)["stamp"].clone()
}
fn open_with(input: &Value, access: &str, identities: Value) -> BridgeSession {
    let bridge = BridgeSession::new(
        input.to_string().as_bytes(),
        &options(access, "validate", identities).to_string(),
    );
    let initial = ok(serde_json::to_value(bridge.initialization()).unwrap());
    assert_eq!(initial["kind"], "state");
    assert_eq!(initial["state"]["stamp"]["generation"], "1");
    assert_eq!(initial["state"]["stamp"]["revision"], "0");
    assert_eq!(initial["state"]["selection"], Value::Null);
    assert_eq!(initial["state"]["stored_marks"], Value::Null);
    assert_eq!(initial["state"]["dirty"], false);
    assert_eq!(initial["state"]["saved_revision"], "0");
    bridge
}
fn open(input: &Value) -> BridgeSession {
    open_with(input, "editable", empty_facts())
}
fn node(bridge: &mut BridgeSession, token: &str) -> Value {
    let stamp = stamp(bridge);
    call(bridge, json!({"kind":"node","stamp":stamp,"node":token}))["node"].clone()
}
fn at_path(bridge: &mut BridgeSession, path: &[Value]) -> String {
    let mut token = state(bridge)["root"].as_str().unwrap().to_owned();
    for part in path {
        token = node(bridge, &token)["children"][part.as_u64().unwrap() as usize]
            .as_str()
            .unwrap()
            .to_owned();
    }
    token
}
fn position(bridge: &mut BridgeSession, literal: &Value) -> Value {
    let token = at_path(bridge, literal["path"].as_array().unwrap());
    match literal["kind"].as_str().unwrap() {
        "text" => {
            json!({"kind":"text","node":token,"offset":literal["offset"],"affinity":literal["affinity"]})
        }
        "child" => {
            json!({"kind":"child","parent":token,"index":literal["index"],"affinity":literal["affinity"]})
        }
        "edge" => json!({"kind":"edge","node":token,"side":literal["side"]}),
        kind => panic!("unknown literal position {kind}"),
    }
}
fn selection(bridge: &mut BridgeSession, literal: &Value) -> Value {
    json!({"anchor":position(bridge,&literal["anchor"]),"focus":position(bridge,&literal["focus"])})
}
fn select(bridge: &mut BridgeSession, literal: &Value) {
    let selection = selection(bridge, literal);
    let stamp = stamp(bridge);
    call(
        bridge,
        json!({"kind":"set_selection","stamp":stamp,"selection":selection}),
    );
}
fn text_selection(path: &[usize], anchor: usize, focus: usize) -> Value {
    json!({"anchor":{"kind":"text","path":path,"offset":anchor,"affinity":"after"},
        "focus":{"kind":"text","path":path,"offset":focus,"affinity":"after"}})
}
fn pending(bridge: &mut BridgeSession) -> Value {
    call(bridge, json!({"kind":"events"}))
}
fn drain(bridge: &mut BridgeSession) -> Vec<Value> {
    let read = pending(bridge);
    assert_eq!(read["gap"], false);
    assert_eq!(
        pending(bridge),
        read,
        "reading must not consume notifications"
    );
    let events = read["events"].as_array().unwrap().clone();
    if !events.is_empty() {
        let acknowledged = call(
            bridge,
            json!({"kind":"acknowledge_events","cursor":read["cursor"]}),
        );
        assert_eq!(acknowledged["kind"], "released");
        assert!(pending(bridge)["events"].as_array().unwrap().is_empty());
    }
    events
}
fn snapshot(bridge: &mut BridgeSession) -> Value {
    let stamp = stamp(bridge);
    call(
        bridge,
        json!({"kind":"snapshot","stamp":stamp,"max_bytes":16777216}),
    )
}
fn checkpoint(bridge: &mut BridgeSession, expected: &Value) -> String {
    let exported = snapshot(bridge);
    let actual = exported["canonical_json"].as_str().unwrap().to_owned();
    // Plain JSON serialization of an authored Value is independent of KWDJ
    // admission, normalization and bridge export implementations.
    assert_eq!(
        actual,
        expected.to_string(),
        "canonical bytes must match the independent literal"
    );
    assert_eq!(exported["profile"], profile());
    call(
        bridge,
        json!({"kind":"release_snapshot","handle":exported["handle"]}),
    );
    actual
}
fn unchanged_refusal(bridge: &mut BridgeSession, request: Value, code: &str) -> Value {
    let before = state(bridge);
    let events = pending(bridge);
    let resources = serde_json::to_value(bridge.own_resource_counts()).unwrap();
    let reply = response(bridge, request);
    assert_eq!(reply["status"], "refused", "{reply:#}");
    assert_eq!(reply["diagnostic"]["code"], code, "{reply:#}");
    assert_eq!(reply["diagnostic"]["may_have_committed"], false);
    assert_eq!(state(bridge), before, "refusal changed state");
    assert_eq!(pending(bridge), events, "refusal emitted an event");
    assert_eq!(
        serde_json::to_value(bridge.own_resource_counts()).unwrap(),
        resources
    );
    reply["diagnostic"].clone()
}
fn destroy(bridge: &mut BridgeSession) {
    assert_eq!(call(bridge, json!({"kind":"destroy"}))["kind"], "destroyed");
    assert_eq!(call(bridge, json!({"kind":"destroy"}))["kind"], "destroyed");
    assert_eq!(
        serde_json::to_value(bridge.own_resource_counts()).unwrap(),
        vectors()["resource_expectations"]["after_destroy"]
    );
    let disposed = response(bridge, json!({"kind":"state"}));
    assert_eq!(disposed["diagnostic"]["code"], "sdk.disposed");
}
fn authored_intent(bridge: &mut BridgeSession, source: &Value) -> Value {
    let mut intent = source.clone();
    let object = intent.as_object_mut().unwrap();
    for (path_key, token_key) in [("node_path", "node"), ("parent_path", "parent")] {
        if let Some(path) = object.remove(path_key) {
            object.insert(
                token_key.into(),
                Value::String(at_path(bridge, path.as_array().unwrap())),
            );
        }
    }
    if source["kind"] == "accept_slash" {
        object.insert("range".into(), selection(bridge, &source["range"]));
    }
    intent
}
fn command(bridge: &mut BridgeSession, suffix: &str, intent: Value) -> Value {
    let stamp = stamp(bridge);
    call(
        bridge,
        json!({"kind":"command","stamp":stamp,"command":{"id":format!("{PREFIX}{suffix}"),"payload_json":intent.to_string()},"history_hint":{"kind":"isolated"}}),
    )
}
fn handles(bridge: &mut BridgeSession) -> Vec<(Vec<usize>, String)> {
    fn visit(
        bridge: &mut BridgeSession,
        path: Vec<usize>,
        token: String,
        out: &mut Vec<(Vec<usize>, String)>,
    ) {
        let read = node(bridge, &token);
        out.push((path.clone(), token));
        for (index, child) in read["children"].as_array().unwrap().iter().enumerate() {
            let mut nested = path.clone();
            nested.push(index);
            visit(bridge, nested, child.as_str().unwrap().into(), out);
        }
    }
    let root = state(bridge)["root"].as_str().unwrap().to_owned();
    let mut out = vec![];
    visit(bridge, vec![], root, &mut out);
    out
}

fn opening(v: &Value) -> Value {
    let baseline = resource_counts();
    let mut refusal_codes = vec![];
    for row in v["opening_refusals"].as_array().unwrap() {
        let mut options = options("editable", "validate", empty_facts());
        let pointer = format!("/{}", row["field"].as_str().unwrap().replace('.', "/"));
        *options.pointer_mut(&pointer).unwrap() = row["value"].clone();
        let mut bridge = BridgeSession::new(b"{", &options.to_string());
        let response = serde_json::to_value(bridge.initialization()).unwrap();
        assert_eq!(response["status"], "refused");
        assert_eq!(
            response["diagnostic"]["code"], row["code"],
            "manifest refusal must precede malformed-document decode"
        );
        assert_eq!(bridge.own_resource_counts().sessions, 0);
        bridge.destroy();
        refusal_codes.push(row["code"].clone());
    }
    let mut bounded_options = options("editable", "validate", empty_facts());
    bounded_options["limits"] = json!({"document_bytes":null,"tree_depth":null,"node_count":"1","text_leaf_bytes":null,"table_rows":null,"table_effective_columns":null,"authored_attribute_bytes":null});
    let mut bounded = BridgeSession::new(
        v["fixtures"]["plain"].to_string().as_bytes(),
        &bounded_options.to_string(),
    );
    let bounded_result = serde_json::to_value(bounded.initialization()).unwrap();
    assert_eq!(
        bounded_result["diagnostic"]["code"],
        "kwdj.resource_limit_exceeded"
    );
    assert_eq!(
        bounded_result["diagnostic"]["details"]["limit"],
        "node_count"
    );
    assert_eq!(bounded_result["diagnostic"]["details"]["maximum"], "1");
    assert_eq!(bounded.own_resource_counts().sessions, 0);
    bounded.destroy();
    let mut ceiling_options = options("editable", "validate", empty_facts());
    ceiling_options["limits"] = json!({"document_bytes":null,"tree_depth":null,"node_count":null,"text_leaf_bytes":v["profile_ceiling_probe"]["requested_text_leaf_bytes"],"table_rows":null,"table_effective_columns":null,"authored_attribute_bytes":null});
    let mut oversized = v["fixtures"]["plain"].clone();
    oversized["content"][0]["content"][0]["text"] = json!(
        "a".repeat(
            v["profile_ceiling_probe"]["attempted_text_utf8_bytes"]
                .as_u64()
                .unwrap() as usize
        )
    );
    let mut ceiling = BridgeSession::new(
        oversized.to_string().as_bytes(),
        &ceiling_options.to_string(),
    );
    let ceiling_result = serde_json::to_value(ceiling.initialization()).unwrap();
    assert_eq!(
        ceiling_result["diagnostic"]["code"],
        v["profile_ceiling_probe"]["expected_code"]
    );
    assert_eq!(
        ceiling_result["diagnostic"]["details"]["limit"],
        "text_length"
    );
    assert_eq!(ceiling_result["diagnostic"]["details"]["maximum"], "262144");
    assert_eq!(
        ceiling_result["diagnostic"]["details"]["observed"],
        "262145"
    );
    assert_eq!(ceiling.own_resource_counts().sessions, 0);
    ceiling.destroy();
    let source = &v["fixtures"]["normalize_empty_marks"];
    let mut strict = BridgeSession::new(
        source.to_string().as_bytes(),
        &options("editable", "validate", empty_facts()).to_string(),
    );
    let response = serde_json::to_value(strict.initialization()).unwrap();
    assert_eq!(
        response["diagnostic"]["code"],
        "kwdj.non_normalized_empty_marks"
    );
    strict.destroy();
    let mut normalized = BridgeSession::new(
        source.to_string().as_bytes(),
        &options("editable", "normalize", empty_facts()).to_string(),
    );
    ok(serde_json::to_value(normalized.initialization()).unwrap());
    checkpoint(&mut normalized, &v["fixtures"]["plain"]);
    destroy(&mut normalized);
    let mut valid = open(&v["fixtures"]["plain"]);
    assert_eq!(valid.own_resource_counts().sessions, 1);
    assert_eq!(valid.own_resource_counts().protected_cursors, 1);
    assert_eq!(valid.own_resource_counts().snapshot_handles, 0);
    destroy(&mut valid);
    assert_eq!(resource_counts(), baseline);
    json!({"status":"passed","manifest_refusals":refusal_codes,"mismatch_before_document_decode":true,"tightened_profile_limits_preserved":true,"max_u64_request_cannot_raise_leaf_ceiling":true,"strict_normalize_distinct":true,"double_destroy_and_disposed":true})
}

fn command_literals(v: &Value) -> Value {
    let mut rows = vec![];
    let mut catalog_expected = vec![];
    let mut replay_total = 0;
    for row in v["command_vectors"].as_array().unwrap() {
        let mut bridge = open(&row["before"]);
        select(&mut bridge, &row["selection"]);
        drain(&mut bridge);
        let before_handles = handles(&mut bridge);
        let command = json!({"id":row["command_id"],"payload_json":authored_intent(&mut bridge,&row["intent"]).to_string()});
        if !catalog_expected.contains(&row["command_id"]) {
            catalog_expected.push(row["command_id"].clone());
        }
        let captured = stamp(&mut bridge);
        let before_state = state(&mut bridge);
        let before_events = pending(&mut bridge);
        let query = call(
            &mut bridge,
            json!({"kind":"query_command","stamp":captured,"command":command}),
        );
        assert_eq!(query["available"], true, "{}: {query:#}", row["id"]);
        assert_eq!(query["effect"], row["expected_effect"]);
        assert_eq!(state(&mut bridge), before_state);
        assert_eq!(pending(&mut bridge), before_events);
        let applied = call(
            &mut bridge,
            json!({"kind":"command","stamp":captured,"command":command,"history_hint":{"kind":"isolated"}}),
        );
        assert_eq!(applied["effect"], row["expected_effect"], "{}", row["id"]);
        let canonical = checkpoint(&mut bridge, &row["expected_document"]);
        if let Some(expected) = row.get("expected_selection") {
            let expected = selection(&mut bridge, expected);
            assert_eq!(state(&mut bridge)["selection"], expected, "{}", row["id"]);
        }
        let after_state = state(&mut bridge);
        let events = drain(&mut bridge);
        if row["expected_effect"] == "changed" {
            assert_eq!(state(&mut bridge)["stamp"]["revision"], "1");
            assert_eq!(events.len(), 1);
            assert_eq!(events[0]["change"]["kind"], "document");
            assert_eq!(events[0]["change"]["from_revision"], "0");
            assert_eq!(events[0]["change"]["to_revision"], "1");
            assert_eq!(state(&mut bridge)["history"]["undo_entries"], "1");
            let after_handles = handles(&mut bridge);
            for (direction, expected, expected_handles, boundary, revision) in [
                ("undo", &row["before"], &before_handles, &before_state, "2"),
                (
                    "redo",
                    &row["expected_document"],
                    &after_handles,
                    &after_state,
                    "3",
                ),
            ] {
                let captured = stamp(&mut bridge);
                let before = state(&mut bridge);
                let events = pending(&mut bridge);
                let query = call(
                    &mut bridge,
                    json!({"kind":"query_history","stamp":captured,"direction":direction}),
                );
                assert_eq!(query["available"], true);
                assert_eq!(state(&mut bridge), before);
                assert_eq!(pending(&mut bridge), events);
                let replay = call(
                    &mut bridge,
                    json!({"kind":"history","stamp":captured,"direction":direction}),
                );
                assert_eq!(replay["effect"], "changed");
                checkpoint(&mut bridge, expected);
                assert_eq!(state(&mut bridge)["stamp"]["revision"], revision);
                assert_eq!(
                    &handles(&mut bridge),
                    expected_handles,
                    "replay must restore exact opaque identities"
                );
                let restored = state(&mut bridge);
                assert_eq!(restored["selection"], boundary["selection"]);
                assert_eq!(restored["stored_marks"], boundary["stored_marks"]);
                assert_eq!(drain(&mut bridge).len(), 1);
                replay_total += 1;
            }
        } else {
            assert!(events.is_empty());
            assert_eq!(state(&mut bridge), before_state);
        }
        rows.push(json!({"id":row["id"],"effect":applied["effect"],"canonical_json":canonical,"query_pure":true,"exact_historical_ids":true}));
        let catalog = call(&mut bridge, json!({"kind":"catalog"}));
        if rows.len() == v["literal_total"].as_u64().unwrap() as usize {
            assert_eq!(catalog["commands"], Value::Array(catalog_expected.clone()));
        }
        destroy(&mut bridge);
    }
    json!({"status":"passed","literal_total":rows.len(),"catalog_total":catalog_expected.len(),"history_replays":replay_total,"rows":rows})
}

fn stale_and_remount(v: &Value) -> Value {
    let mut bridge = open(&v["fixtures"]["unicode"]);
    select(&mut bridge, &text_selection(&[0, 0], 1, 1));
    drain(&mut bridge);
    let mut codes = vec![];
    for (field, value, expected) in [
        ("generation", "2", "session.stale_session"),
        ("revision", "18446744073709551615", "session.stale_revision"),
        (
            "selection_epoch",
            "18446744073709551615",
            "session.stale_selection_epoch",
        ),
        (
            "history_epoch",
            "18446744073709551615",
            "session.stale_history_epoch",
        ),
        ("revision", "18446744073709551616", "sdk.invalid_u64"),
        ("revision", "00", "sdk.invalid_u64"),
        ("revision", "+1", "sdk.invalid_u64"),
        ("revision", "-1", "sdk.invalid_u64"),
    ] {
        let mut captured = stamp(&mut bridge);
        captured[field] = json!(value);
        unchanged_refusal(
            &mut bridge,
            json!({"kind":"barrier","stamp":captured}),
            expected,
        );
        codes.push(expected);
    }
    let leaf = at_path(&mut bridge, &[json!(0), json!(0)]);
    let mut foreign = open(&v["fixtures"]["plain"]);
    let foreign_leaf = at_path(&mut foreign, &[json!(0), json!(0)]);
    for (token, code) in [
        (foreign_leaf, "session.stale_session"),
        ("n1:0:1:2".into(), "identity.invalid_token_number"),
        ("x".repeat(129), "identity.token_too_long"),
    ] {
        let stamp = stamp(&mut bridge);
        unchanged_refusal(
            &mut bridge,
            json!({"kind":"node","stamp":stamp,"node":token}),
            code,
        );
        codes.push(code);
    }
    destroy(&mut foreign);
    let captured = stamp(&mut bridge);
    let split_surrogate = json!({"anchor":{"kind":"text","node":leaf,"offset":2,"affinity":"after"},"focus":{"kind":"text","node":leaf,"offset":2,"affinity":"after"}});
    unchanged_refusal(
        &mut bridge,
        json!({"kind":"set_selection","stamp":captured,"selection":split_surrogate}),
        "position.invalid",
    );
    let before = state(&mut bridge);
    let old_snapshot = snapshot(&mut bridge);
    let old_stamp = stamp(&mut bridge);
    unchanged_refusal(
        &mut bridge,
        json!({"kind":"remount","stamp":old_stamp,"input_json":"{","admission":"validate"}),
        "kwdj.invalid_json",
    );
    assert_eq!(state(&mut bridge), before);
    let mounted = call(
        &mut bridge,
        json!({"kind":"remount","stamp":old_stamp,"input_json":v["fixtures"]["plain"].to_string(),"admission":"validate"}),
    );
    assert_eq!(mounted["effect"], "remounted");
    assert_eq!(mounted["state"]["stamp"]["generation"], "2");
    assert_ne!(mounted["state"]["stamp"]["session"], old_stamp["session"]);
    assert_eq!(bridge.own_resource_counts().snapshot_handles, 0);
    unchanged_refusal(
        &mut bridge,
        json!({"kind":"barrier","stamp":old_stamp}),
        "session.stale_session",
    );
    let current = stamp(&mut bridge);
    unchanged_refusal(
        &mut bridge,
        json!({"kind":"node","stamp":current,"node":leaf}),
        "session.stale_session",
    );
    unchanged_refusal(
        &mut bridge,
        json!({"kind":"acknowledge_snapshot","stamp":current,"handle":old_snapshot["handle"]}),
        "sdk.stale_snapshot",
    );
    checkpoint(&mut bridge, &v["fixtures"]["plain"]);
    destroy(&mut bridge);
    json!({"status":"passed","stale_and_malformed_codes":codes,"max_u64_parsed_without_rounding":true,"split_surrogate_refused":true,"failed_remount_atomic":true,"successful_remount_invalidates_generation_nodes_snapshots":true})
}

fn state_events_and_mapping(v: &Value) -> Value {
    let mut bridge = open(&v["fixtures"]["plain"]);
    let initial_stamp = stamp(&mut bridge);
    let initial_state = state(&mut bridge);
    assert_eq!(
        call(&mut bridge, json!({"kind":"barrier","stamp":initial_stamp}))["effect"],
        "unchanged"
    );
    assert_eq!(state(&mut bridge), initial_state);
    assert!(drain(&mut bridge).is_empty());
    let leaf = at_path(&mut bridge, &[json!(0), json!(0)]);
    let reverse = text_selection(&[0, 0], 2, 0);
    select(&mut bridge, &reverse);
    let initial = pending(&mut bridge);
    assert_eq!(initial["events"].as_array().unwrap().len(), 1);
    let captured = stamp(&mut bridge);
    unchanged_refusal(
        &mut bridge,
        json!({"kind":"acknowledge_events","cursor":"999"}),
        "events.stale_acknowledgement",
    );
    let events = drain(&mut bridge);
    assert_eq!(events[0]["change"]["kind"], "state");
    assert_eq!(events[0]["change"]["selection_changed"], true);
    assert_eq!(events[0]["before"]["revision"], "0");
    assert_eq!(events[0]["after"]["revision"], "0");
    unchanged_refusal(
        &mut bridge,
        json!({"kind":"acknowledge_events","cursor":initial["cursor"]}),
        "events.stale_acknowledgement",
    );
    let marks = call(
        &mut bridge,
        json!({"kind":"set_stored_marks","stamp":captured,"marks":[]}),
    );
    assert_eq!(marks["effect"], "state_changed");
    assert_eq!(marks["state"]["stored_marks"], json!([]));
    assert_eq!(marks["state"]["stamp"]["revision"], "0");
    let event = drain(&mut bridge);
    assert_eq!(event.len(), 1);
    assert_eq!(event[0]["change"]["stored_marks_changed"], true);
    assert_eq!(event[0]["stored_marks_before"], Value::Null);
    assert_eq!(event[0]["stored_marks_after"], json!([]));
    let captured = stamp(&mut bridge);
    let before = state(&mut bridge);
    assert_eq!(
        call(
            &mut bridge,
            json!({"kind":"set_stored_marks","stamp":captured,"marks":[]})
        )["effect"],
        "unchanged"
    );
    assert_eq!(state(&mut bridge), before);
    assert!(drain(&mut bridge).is_empty());
    let captured = stamp(&mut bridge);
    call(
        &mut bridge,
        json!({"kind":"set_stored_marks","stamp":captured,"marks":null}),
    );
    assert_eq!(state(&mut bridge)["stored_marks"], Value::Null);
    assert_eq!(drain(&mut bridge).len(), 1);
    // Text, Child and Edge are all real native coordinates, including affinity.
    let block = at_path(&mut bridge, &[json!(0)]);
    for selected in [
        json!({"anchor":{"kind":"child","parent":block,"index":0,"affinity":"before"},"focus":{"kind":"child","parent":block,"index":1,"affinity":"after"}}),
        json!({"anchor":{"kind":"edge","node":leaf,"side":"before"},"focus":{"kind":"edge","node":leaf,"side":"after"}}),
    ] {
        let captured = stamp(&mut bridge);
        call(
            &mut bridge,
            json!({"kind":"set_selection","stamp":captured,"selection":selected}),
        );
        assert_eq!(state(&mut bridge)["selection"], selected);
        drain(&mut bridge);
    }
    select(&mut bridge, &text_selection(&[0, 0], 1, 1));
    drain(&mut bridge);
    let original = json!({"kind":"text","node":leaf,"offset":1,"affinity":"after"});
    command(
        &mut bridge,
        "insert-text",
        json!({"kind":"insert_text","text":"X"}),
    );
    let captured = stamp(&mut bridge);
    let mapped = call(
        &mut bridge,
        json!({"kind":"map_position","stamp":captured,"from_revision":"0","position":original}),
    );
    assert_eq!(mapped["status"], "mapped");
    assert_eq!(mapped["deleted"], false);
    assert_eq!(mapped["position"]["offset"], 2);
    let expected = json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[{"type":"text","text":"aXb"}]}]});
    checkpoint(&mut bridge, &expected);
    drain(&mut bridge);
    let current = stamp(&mut bridge);
    call(
        &mut bridge,
        json!({"kind":"set_selection","stamp":current,"selection":null}),
    );
    assert_eq!(state(&mut bridge)["selection"], Value::Null);
    assert_eq!(drain(&mut bridge).len(), 1);
    let current = stamp(&mut bridge);
    unchanged_refusal(
        &mut bridge,
        json!({"kind":"command","stamp":current,"command":{"id":format!("{PREFIX}insert-text"),"payload_json":"{\"kind\":\"insert_text\",\"text\":\"Z\"}"},"history_hint":{"kind":"isolated"}}),
        "kwdj.command_selection_required",
    );
    destroy(&mut bridge);
    json!({"status":"passed","reverse_text_child_edge_and_clear":true,"null_and_empty_marks_distinct":true,"state_events_preserve_revision":true,"events_peek_ack_exact":true,"mapped_insertion_offset":2,"no_events_for_noop_or_refusal":true})
}

fn snapshots_and_resources(v: &Value) -> Value {
    let baseline = resource_counts();
    let mut bridge = open(&v["fixtures"]["plain"]);
    select(&mut bridge, &text_selection(&[0, 0], 2, 2));
    drain(&mut bridge);
    let initial = snapshot(&mut bridge);
    assert_eq!(
        initial["canonical_json"],
        v["fixtures"]["plain"].to_string()
    );
    command(
        &mut bridge,
        "insert-text",
        json!({"kind":"insert_text","text":"X"}),
    );
    drain(&mut bridge);
    let revision_one = snapshot(&mut bridge);
    command(
        &mut bridge,
        "insert-text",
        json!({"kind":"insert_text","text":"Y"}),
    );
    drain(&mut bridge);
    let current = stamp(&mut bridge);
    let old_ack = call(
        &mut bridge,
        json!({"kind":"acknowledge_snapshot","stamp":current,"handle":revision_one["handle"]}),
    );
    assert_eq!(old_ack["state"]["saved_revision"], "1");
    assert_eq!(old_ack["state"]["dirty"], true);
    assert_eq!(old_ack["state"]["stamp"]["revision"], "2");
    assert_eq!(drain(&mut bridge).len(), 1);
    let current_snapshot = snapshot(&mut bridge);
    let current = stamp(&mut bridge);
    let ack = call(
        &mut bridge,
        json!({"kind":"acknowledge_snapshot","stamp":current,"handle":current_snapshot["handle"]}),
    );
    assert_eq!(ack["state"]["saved_revision"], "2");
    assert_eq!(ack["state"]["dirty"], false);
    assert_eq!(drain(&mut bridge).len(), 1);
    let current = stamp(&mut bridge);
    assert_eq!(
        call(
            &mut bridge,
            json!({"kind":"acknowledge_snapshot","stamp":current,"handle":revision_one["handle"]})
        )["effect"],
        "unchanged"
    );
    assert_eq!(state(&mut bridge)["saved_revision"], "2");
    assert!(!state(&mut bridge)["dirty"].as_bool().unwrap());
    assert!(drain(&mut bridge).is_empty());
    for direction in ["undo", "redo"] {
        let current = stamp(&mut bridge);
        call(
            &mut bridge,
            json!({"kind":"history","stamp":current,"direction":direction}),
        );
        drain(&mut bridge);
    }
    assert_eq!(state(&mut bridge)["stamp"]["revision"], "4");
    assert_eq!(state(&mut bridge)["dirty"], true);
    let equal_saved = snapshot(&mut bridge);
    assert_eq!(
        equal_saved["canonical_json"],
        current_snapshot["canonical_json"]
    );
    let current = stamp(&mut bridge);
    let reconciled = call(
        &mut bridge,
        json!({"kind":"reconcile_snapshot","stamp":current,"handle":equal_saved["handle"]}),
    );
    assert_eq!(reconciled["effect"], "state_changed");
    assert_eq!(reconciled["state"]["dirty"], false);
    assert_eq!(reconciled["state"]["saved_revision"], "2");
    assert_eq!(reconciled["state"]["stamp"]["revision"], "4");
    assert_eq!(drain(&mut bridge).len(), 1);
    call(
        &mut bridge,
        json!({"kind":"release_snapshot","handle":equal_saved["handle"]}),
    );
    for item in [&initial, &revision_one, &current_snapshot] {
        call(
            &mut bridge,
            json!({"kind":"release_snapshot","handle":item["handle"]}),
        );
    }
    let mut retained = vec![];
    for index in 0..32 {
        let exported = snapshot(&mut bridge);
        retained.push(exported["handle"].clone());
        assert_eq!(bridge.own_resource_counts().snapshot_handles, index + 1);
    }
    let current = stamp(&mut bridge);
    unchanged_refusal(
        &mut bridge,
        json!({"kind":"snapshot","stamp":current,"max_bytes":16777216}),
        "sdk.snapshot_limit",
    );
    for handle in &retained {
        call(
            &mut bridge,
            json!({"kind":"release_snapshot","handle":handle}),
        );
    }
    assert_eq!(bridge.own_resource_counts().snapshot_handles, 0);
    assert_eq!(bridge.own_resource_counts().snapshot_bytes, "0");
    unchanged_refusal(
        &mut bridge,
        json!({"kind":"release_snapshot","handle":retained[0]}),
        "sdk.stale_snapshot",
    );
    let current = stamp(&mut bridge);
    unchanged_refusal(
        &mut bridge,
        json!({"kind":"snapshot","stamp":current,"max_bytes":1}),
        "sdk.snapshot_limit",
    );
    destroy(&mut bridge);
    assert_eq!(resource_counts(), baseline);
    for _ in 0..48 {
        let mut cycle = open(&v["fixtures"]["plain"]);
        snapshot(&mut cycle);
        destroy(&mut cycle);
        assert_eq!(resource_counts(), baseline);
    }
    json!({"status":"passed","old_revision_ack_keeps_current_dirty":true,"current_ack_clears_dirty":true,"older_ack_cannot_rewind_saved_revision":true,"explicit_equal_saved_reconcile":true,"snapshot_cap":32,"repeated_cycles":48,"released_all_native_resources":true})
}

fn mapping_provenance(v: &Value) -> Value {
    let mut document = v["fixtures"]["plain"].clone();
    document["content"]
        .as_array_mut()
        .unwrap()
        .push(json!({"type":"paragraph","content":[{"type":"text","text":"cd"}]}));
    let mut bridge = open(&document);
    let old_leaf = at_path(&mut bridge, &[json!(0), json!(0)]);
    let removed = at_path(&mut bridge, &[json!(0)]);
    command(
        &mut bridge,
        "remove",
        json!({"kind":"remove","node":removed}),
    );
    drain(&mut bridge);
    let current = stamp(&mut bridge);
    let position = json!({"kind":"text","node":old_leaf,"offset":1,"affinity":"after"});
    let deleted = call(
        &mut bridge,
        json!({"kind":"map_position","stamp":current,"from_revision":"0","position":position}),
    );
    assert_eq!(deleted["status"], "deleted");
    assert_eq!(deleted["deleted"], true);
    assert_eq!(deleted["position"]["kind"], "child");
    assert_eq!(deleted["position"]["index"], 0);
    unchanged_refusal(
        &mut bridge,
        json!({"kind":"node","stamp":current,"node":old_leaf}),
        "tree.missing_node",
    );
    let invalid = call(
        &mut bridge,
        json!({"kind":"map_position","stamp":current,"from_revision":"18446744073709551615","position":position}),
    );
    assert_eq!(invalid["status"], "invalid");
    assert_eq!(invalid["position"], Value::Null);
    destroy(&mut bridge);

    let mut bridge = open(&v["fixtures"]["plain"]);
    let old_leaf = at_path(&mut bridge, &[json!(0), json!(0)]);
    select(&mut bridge, &text_selection(&[0, 0], 2, 2));
    drain(&mut bridge);
    for _ in 0..65 {
        command(
            &mut bridge,
            "insert-text",
            json!({"kind":"insert_text","text":"X"}),
        );
        drain(&mut bridge);
    }
    let current = stamp(&mut bridge);
    let before = state(&mut bridge);
    let stale = call(
        &mut bridge,
        json!({"kind":"map_position","stamp":current,"from_revision":"0","position":{"kind":"text","node":old_leaf,"offset":1,"affinity":"after"}}),
    );
    assert_eq!(stale["status"], "stale");
    assert_eq!(stale["position"], Value::Null);
    assert_eq!(state(&mut bridge), before);
    assert!(drain(&mut bridge).is_empty());
    destroy(&mut bridge);
    json!({"status":"passed","deleted_retired_node_is_not_live":true,"future_revision_is_invalid":true,"retained_prefix_is_stale_after_commits":65})
}

fn identity_facts(v: &Value) -> Value {
    let mut bridge = open_with(&v["fixtures"]["reference"], "editable", facts("exists"));
    select(&mut bridge, &text_selection(&[0, 0], 3, 3));
    drain(&mut bridge);
    let current = stamp(&mut bridge);
    call(
        &mut bridge,
        json!({"kind":"set_stored_marks","stamp":current,"marks":[]}),
    );
    drain(&mut bridge);
    let saved_selection = state(&mut bridge)["selection"].clone();
    let before_handles = handles(&mut bridge);
    command(
        &mut bridge,
        "insert-text",
        json!({"kind":"insert_text","text":"X"}),
    );
    drain(&mut bridge);
    let edited_selection = state(&mut bridge)["selection"].clone();
    let after_handles = handles(&mut bridge);
    assert_eq!(state(&mut bridge)["stored_marks"], json!([]));
    let mut codes = vec![];
    for (status, code) in [
        ("missing", "kwdj.reference_identity_unresolved"),
        ("unavailable", "kwdj.identity_resolution_failed"),
    ] {
        let current = stamp(&mut bridge);
        call(
            &mut bridge,
            json!({"kind":"update_facts","stamp":current,"identities":facts(status)}),
        );
        let captured = stamp(&mut bridge);
        let before = state(&mut bridge);
        let events = pending(&mut bridge);
        let query = call(
            &mut bridge,
            json!({"kind":"query_history","stamp":captured,"direction":"undo"}),
        );
        assert_eq!(query["available"], false);
        assert_eq!(query["diagnostic"]["code"], code);
        assert_eq!(state(&mut bridge), before);
        assert_eq!(pending(&mut bridge), events);
        unchanged_refusal(
            &mut bridge,
            json!({"kind":"history","stamp":captured,"direction":"undo"}),
            code,
        );
        let current = stamp(&mut bridge);
        call(
            &mut bridge,
            json!({"kind":"update_facts","stamp":current,"identities":facts("exists")}),
        );
        // Same captured request remains valid after the facts recover.
        call(
            &mut bridge,
            json!({"kind":"history","stamp":captured,"direction":"undo"}),
        );
        checkpoint(&mut bridge, &v["fixtures"]["reference"]);
        assert_eq!(state(&mut bridge)["selection"], saved_selection);
        assert_eq!(state(&mut bridge)["stored_marks"], json!([]));
        assert_eq!(handles(&mut bridge), before_handles);
        drain(&mut bridge);
        let current = stamp(&mut bridge);
        call(
            &mut bridge,
            json!({"kind":"history","stamp":current,"direction":"redo"}),
        );
        assert_eq!(state(&mut bridge)["selection"], edited_selection);
        assert_eq!(state(&mut bridge)["stored_marks"], json!([]));
        assert_eq!(handles(&mut bridge), after_handles);
        drain(&mut bridge);
        codes.push(code);
    }
    destroy(&mut bridge);
    json!({"status":"passed","current_reference_codes":codes,"query_execute_refuse_without_event_or_stack_change":true,"same_captured_request_retries_after_facts_recover":true,"saved_marks_selection_and_ids_restore_exactly":true})
}

fn metadata_and_closed_dtos(v: &Value) -> Value {
    let mut bridge = open(&v["fixtures"]["ordered_max"]);
    let ordered = at_path(&mut bridge, &[json!(0)]);
    let read = node(&mut bridge, &ordered);
    assert_eq!(
        read["attributes"]["start"],
        json!({"kind":"number","value":"18446744073709551615"})
    );
    let canonical = checkpoint(&mut bridge, &v["fixtures"]["ordered_max"]);
    let state_before = state(&mut bridge);
    let events_before = pending(&mut bridge);
    for raw in [
        "{\"kind\":\"state\",\"extra\":true}",
        "{\"kind\":\"catalog\",\"extra\":true}",
        "{\"kind\":\"events\",\"extra\":true}",
        "{\"kind\":\"resources\",\"extra\":true}",
        "{\"kind\":\"destroy\",\"extra\":true}",
        "{\"kind\":\"snapshot\"}",
        "{\"kind\":\"not_a_request\"}",
    ] {
        let decoded: Value = serde_json::from_str(&bridge.call_json(raw)).unwrap();
        assert_eq!(
            decoded["diagnostic"]["code"], "sdk.invalid_dto",
            "request={raw}; response={decoded:#}"
        );
        assert_eq!(state(&mut bridge), state_before);
        assert_eq!(pending(&mut bridge), events_before);
    }
    destroy(&mut bridge);
    let mut editable = open(&v["fixtures"]["plain"]);
    select(&mut editable, &text_selection(&[0, 0], 1, 1));
    drain(&mut editable);
    let current = stamp(&mut editable);
    for (id, payload) in [
        ("enter", json!({"kind":"enter","extra":true})),
        (
            "transform-block",
            json!({"kind":"transform_block","target":{"kind":"paragraph","extra":true}}),
        ),
        (
            "toggle-list",
            json!({"kind":"toggle_list","list":{"kind":"bullet","extra":true}}),
        ),
    ] {
        unchanged_refusal(
            &mut editable,
            json!({"kind":"command","stamp":current,"command":{"id":format!("{PREFIX}{id}"),"payload_json":payload.to_string()},"history_hint":{"kind":"isolated"}}),
            "sdk.invalid_dto",
        );
    }
    unchanged_refusal(
        &mut editable,
        json!({"kind":"command","stamp":current,"command":{"id":format!("{PREFIX}insert-text"),"payload_json":"{\"kind\":\"insert_text\",\"text\":\"X\"}"},"history_hint":{"kind":"isolated","extra":true}}),
        "sdk.invalid_dto",
    );
    let null_metadata = json!({"kind":"null"});
    let typed: klenwriter_editor_wasm::sdk_wire::AttributeDto =
        serde_json::from_value(null_metadata.clone()).unwrap();
    assert_eq!(serde_json::to_value(typed).unwrap(), null_metadata);
    unchanged_refusal(
        &mut editable,
        json!({"kind":"set_stored_marks","stamp":current,"marks":[{"type_id":"org.klenwriter.kwdj/strong","attributes":{"unknown":null_metadata}}]}),
        "kwdj.invalid_structure",
    );
    destroy(&mut editable);
    let mut readonly = open_with(&v["fixtures"]["plain"], "read_only", empty_facts());
    select(&mut readonly, &text_selection(&[0, 0], 1, 1));
    drain(&mut readonly);
    let captured = stamp(&mut readonly);
    unchanged_refusal(
        &mut readonly,
        json!({"kind":"set_stored_marks","stamp":captured,"marks":[]}),
        "session.read_only",
    );
    unchanged_refusal(
        &mut readonly,
        json!({"kind":"command","stamp":captured,"command":{"id":format!("{PREFIX}insert-text"),"payload_json":"{\"kind\":\"insert_text\",\"text\":\"X\"}"},"history_hint":{"kind":"isolated"}}),
        "session.read_only",
    );
    checkpoint(&mut readonly, &v["fixtures"]["plain"]);
    destroy(&mut readonly);
    json!({"status":"passed","exact_u64_attribute":"18446744073709551615","canonical_json":canonical,"closed_dto_refusals":11,"null_attribute_transport_preserved_before_profile_refusal":true,"readonly_marks_and_document_refuse":true})
}

pub fn observe() -> Value {
    let v = vectors();
    let baseline = resource_counts();
    assert_eq!(v["command_vectors"].as_array().unwrap().len(), 16);
    let report = json!({"format":"klenwriter-sdk-observer/1","status":"passed","abi":"editor-sdk/1",
        "opening":opening(&v),"commands":command_literals(&v),"stale":stale_and_remount(&v),
        "state_events":state_events_and_mapping(&v),"snapshots_resources":snapshots_and_resources(&v),
        "identity_facts":identity_facts(&v),"metadata_dtos":metadata_and_closed_dtos(&v),"mapping_provenance":mapping_provenance(&v)});
    assert_eq!(
        resource_counts(),
        baseline,
        "observer leaked native bridge resources"
    );
    report
}
