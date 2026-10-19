// SPDX-License-Identifier: MIT OR Apache-2.0
//! Source-authored frozen composition semantics through the public SDK2 bridge.
//! Complete raw calls survive a literal failure; no expected document is generated.
use klenwriter_editor_wasm::{sdk, sdk_v2};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::panic::{AssertUnwindSafe, catch_unwind};

const ORACLES: &str = include_str!("../../../../contracts/composition/v1/native-oracles.json");
type Roles = BTreeMap<String, String>;
struct Harness {
    session: sdk_v2::BridgeSession,
    calls: Vec<Value>,
    initial: Value,
    context: Value,
    options: Value,
}
impl Harness {
    fn open(c: &Value) -> Self {
        let manifest = sdk::manifest();
        let profile = serde_json::to_value(&manifest.profiles[0]).unwrap();
        let options = json!({"abi":"editor-sdk/2","build_id":manifest.build_id,"profile":profile,
            "admission":"validate","access":"editable",
            "registry_json":serde_json::to_string(&editor_kwdj::registry::registry_descriptor()).unwrap(),
            "profile_options_json":json!({"identities":{"media":[],"references":[]},"limits":null}).to_string()});
        let session = sdk_v2::BridgeSession::new(
            c["input"]["canonical_json"].as_str().unwrap().as_bytes(),
            &options.to_string(),
        );
        let initial = serde_json::to_value(session.initialization()).unwrap();
        let context = serde_json::to_value(session.context()).unwrap();
        Self {
            session,
            calls: Vec::new(),
            initial,
            context,
            options,
        }
    }
    fn call(&mut self, request: Value) -> Value {
        let response: Value =
            serde_json::from_str(&self.session.call_json(&request.to_string())).unwrap();
        self.calls
            .push(json!({"request":request,"response":response}));
        response
    }
    fn ok(&mut self, request: Value) -> Value {
        let response = self.call(request);
        assert_eq!(response["status"], "ok", "{response}");
        response["value"].clone()
    }
    fn state(&mut self) -> Value {
        self.ok(json!({"kind":"state"}))["state"].clone()
    }
    fn canonical(&mut self, st: &Value) -> String {
        let snapshot = self.ok(json!({"kind":"snapshot","stamp":st["stamp"],"max_bytes":2097152}));
        assert_eq!(snapshot["stamp"], st["stamp"]);
        let text = snapshot["canonical_json"].as_str().unwrap().to_owned();
        let result = self.ok(json!({"kind":"release_snapshot","handle":snapshot["handle"]}));
        assert_eq!(result, json!({"kind":"released"}));
        text
    }
    fn roles(&mut self, table: &Value, st: &Value) -> Roles {
        let root = st["root"].as_str().unwrap().to_owned();
        let mut roles = Roles::new();
        roles.insert("ROOT".into(), root.clone());
        for (role, path) in table.as_object().unwrap() {
            if role == "ROOT" {
                continue;
            }
            let mut id = root.clone();
            for index in path.as_array().unwrap() {
                let node = self.ok(json!({"kind":"node","stamp":st["stamp"],"node":id}));
                id = node["node"]["children"][index.as_u64().unwrap() as usize]
                    .as_str()
                    .expect("authored role path")
                    .to_owned();
            }
            assert!(
                !roles.values().any(|old| old == &id),
                "distinct roles alias"
            );
            roles.insert(role.clone(), id);
        }
        roles
    }
    fn pending(&mut self) -> Value {
        let result = self.ok(json!({"kind":"events"}));
        assert_eq!(result["gap"], false);
        result
    }
    fn drain(&mut self) -> Vec<Value> {
        let pending = self.pending();
        let events = pending["events"].as_array().unwrap().clone();
        assert_eq!(self.pending(), pending, "read does not consume events");
        if !events.is_empty() {
            assert_eq!(
                self.ok(json!({"kind":"acknowledge_events","cursor":pending["cursor"]})),
                json!({"kind":"released"})
            );
        }
        assert!(self.pending()["events"].as_array().unwrap().is_empty());
        events
    }
    fn resources(&mut self) -> Value {
        self.ok(json!({"kind":"resources"}))["resources"].clone()
    }
}
impl Drop for Harness {
    fn drop(&mut self) {
        self.session.destroy();
    }
}
fn position(p: &Value, roles: &Roles) -> Value {
    let mut out = p.clone();
    let field = if p["kind"] == "child" {
        "parent"
    } else {
        "node"
    };
    out[field] = json!(roles[p[field].as_str().unwrap()]);
    out
}
fn bind(value: &Value, roles: &Roles, stamp: &Value, retained: &Value) -> Value {
    if value == "$EXACT_CURRENT_STAMP" {
        return stamp.clone();
    }
    if value == "$CAPTURE_TARGET_LOCAL_RETAINED_BYTES" {
        return retained.clone();
    }
    if value == "$SESSION" {
        return stamp["session"].clone();
    }
    if value == "$GENERATION" {
        return stamp["generation"].clone();
    }
    if let Some(fields) = value.as_object() {
        if matches!(value["kind"].as_str(), Some("text" | "child" | "edge"))
            && (fields.contains_key("node") || fields.contains_key("parent"))
        {
            return position(value, roles);
        }
        return Value::Object(
            fields
                .iter()
                .map(|(k, v)| {
                    (
                        k.clone(),
                        if k == "root" && v == "ROOT" {
                            json!(roles["ROOT"])
                        } else {
                            bind(v, roles, stamp, retained)
                        },
                    )
                })
                .collect(),
        );
    }
    if let Some(values) = value.as_array() {
        return Value::Array(
            values
                .iter()
                .map(|v| bind(v, roles, stamp, retained))
                .collect(),
        );
    }
    value.clone()
}
fn assert_state(actual: &Value, literal: &Value, roles: &Roles) {
    let retained = &actual["history"]["retained_bytes"];
    let bytes: u64 = retained.as_str().unwrap().parse().unwrap();
    assert!(bytes <= 32 * 1024 * 1024, "history ownership ceiling");
    assert_eq!(
        actual,
        &bind(literal, roles, &actual["stamp"], retained),
        "full native state"
    );
}
fn check_maps(h: &mut Harness, c: &Value, revision: &str, roles: &Roles) {
    let st = h.state();
    for row in c["maps"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["to_revision"] == revision)
    {
        let actual = h.call(json!({"kind":"map_position","stamp":st["stamp"],"from_revision":row["from_revision"],"position":position(&row["input"], roles)}));
        let e = &row["expected"];
        assert_eq!(
            actual,
            json!({"status":"ok","value":{"kind":"mapped","status":e["status"],"position":position(&e["position"],roles),"deleted":e["deleted"],"stamp":st["stamp"]}}),
            "exact frozen map {row}"
        );
        assert_eq!(h.state(), st, "map purity");
    }
}
fn checkpoint(h: &mut Harness, c: &Value, label: &str, roles: &Roles) -> Value {
    let (expected_state, canonical, table) = match label {
        "before" => (
            &c["before_state"],
            &c["input"]["canonical_json"],
            &c["input"]["identity_roles"],
        ),
        "after" => (
            &c["after_state"],
            &c["after_canonical_json"],
            &c["after_identity_roles"],
        ),
        _ => (
            &c[label]["state"],
            &c[label]["canonical_json"],
            &c[label]["identity_roles"],
        ),
    };
    let st = h.state();
    assert_state(&st, expected_state, roles);
    assert_eq!(
        h.canonical(&st),
        canonical.as_str().unwrap(),
        "literal canonical {label}"
    );
    let live = h.roles(table, &st);
    for (role, id) in &live {
        assert_eq!(&roles[role], id, "exact historical role {label}/{role}");
    }
    assert_eq!(
        serde_json::to_value(h.session.context()).unwrap(),
        h.context,
        "full context stays exact"
    );
    let resources = h.resources();
    assert_eq!(
        resources,
        json!({"sessions":1,"snapshot_handles":0,"snapshot_bytes":"0","protected_cursors":1})
    );
    json!({"label":label,"state":st,"canonical_json":canonical,"roles":live,"context":h.context,"resources":resources})
}
fn check_event(event: &Value, before: &Value, after: &Value) {
    assert_eq!(event["before"], before["stamp"]);
    assert_eq!(event["after"], after["stamp"]);
    for key in ["selection", "stored_marks", "dirty"] {
        assert_eq!(event[format!("{key}_before")], before[key]);
        assert_eq!(event[format!("{key}_after")], after[key]);
    }
    assert_eq!(event["history"], after["history"]);
    assert_eq!(event["change"]["kind"], "document");
    assert_eq!(
        event["change"]["from_revision"],
        before["stamp"]["revision"]
    );
    assert_eq!(event["change"]["to_revision"], after["stamp"]["revision"]);
}
fn verify(h: &mut Harness, c: &Value) -> Value {
    assert_eq!(h.initial["status"], "ok", "initialization");
    let fresh = h.state();
    let roles = h.roles(&c["input"]["identity_roles"], &fresh);
    let setup = h.call(json!({"kind":"set_selection","stamp":fresh["stamp"],"selection":bind(&c["input"]["selection"],&roles,&fresh["stamp"],&Value::Null)}));
    assert_eq!(setup["value"]["effect"], "state_changed");
    let setup_events = h.drain();
    assert_eq!(setup_events.len(), 1);
    assert_eq!(
        setup_events[0]["change"],
        json!({"kind":"state","selection_changed":true,"stored_marks_changed":false,"history_changed":false,"baseline_changed":false})
    );
    let mut checkpoints = vec![checkpoint(h, c, "before", &roles)];
    let before = h.state();
    if c["family"] != "P05" {
        let query = h.call(bind(
            &c["query_request"],
            &roles,
            &before["stamp"],
            &Value::Null,
        ));
        assert_eq!(
            query,
            bind(
                &c["query_expected"],
                &roles,
                &before["stamp"],
                &before["history"]["retained_bytes"]
            ),
            "full query response"
        );
        assert_eq!(h.state(), before, "query purity");
        assert_eq!(checkpoint(h, c, "before", &roles), checkpoints[0]);
        assert!(h.pending()["events"].as_array().unwrap().is_empty());
        let response = h.call(bind(
            &c["execute_request"],
            &roles,
            &before["stamp"],
            &Value::Null,
        ));
        let after = h.state();
        assert_eq!(
            response,
            bind(
                &c["execute_expected"],
                &roles,
                if response["status"] == "ok" {
                    &after["stamp"]
                } else {
                    &before["stamp"]
                },
                &after["history"]["retained_bytes"]
            ),
            "full command response"
        );
    }
    let after = h.state();
    checkpoints.push(checkpoint(h, c, "after", &roles));
    let events = h.drain();
    let changed = c.get("undo").is_some();
    assert_eq!(events.len(), usize::from(changed));
    if changed {
        check_event(&events[0], &before, &after);
    } else {
        assert_eq!(after, before, "cancel/refusal native state is exact");
    }
    for role in c["identity"]["retired_old"].as_array().unwrap() {
        let response = h.call(
            json!({"kind":"node","stamp":after["stamp"],"node":roles[role.as_str().unwrap()]}),
        );
        assert_eq!(
            response,
            json!({"status":"refused","diagnostic":{"code":"tree.missing_node","path":"","category":"sdk","details":{},"stamp":after["stamp"],"may_have_committed":false}})
        );
    }
    check_maps(h, c, after["stamp"]["revision"].as_str().unwrap(), &roles);
    if changed {
        let mut prior = after;
        for direction in ["undo", "redo"] {
            let expected = &c[direction];
            let query = h
                .call(json!({"kind":"query_history","stamp":prior["stamp"],"direction":direction}));
            assert_eq!(query, expected["query_expected"]);
            assert_eq!(h.state(), prior);
            let response = h.call(bind(
                &expected["request"],
                &roles,
                &prior["stamp"],
                &Value::Null,
            ));
            let current = h.state();
            assert_eq!(
                response,
                bind(
                    &expected["execute_expected"],
                    &roles,
                    &current["stamp"],
                    &current["history"]["retained_bytes"]
                )
            );
            checkpoints.push(checkpoint(h, c, direction, &roles));
            let events = h.drain();
            assert_eq!(events.len(), 1);
            check_event(&events[0], &prior, &current);
            check_maps(h, c, current["stamp"]["revision"].as_str().unwrap(), &roles);
            prior = current;
        }
    } else {
        for direction in ["undo", "redo"] {
            let expected = &c["history_probes"][direction];
            let query = h.call(
                json!({"kind":"query_history","stamp":before["stamp"],"direction":direction}),
            );
            assert_eq!(
                query,
                bind(
                    &expected["query"],
                    &roles,
                    &before["stamp"],
                    &before["history"]["retained_bytes"]
                )
            );
            let response =
                h.call(json!({"kind":"history","stamp":before["stamp"],"direction":direction}));
            assert_eq!(
                response,
                bind(
                    &expected["execute"],
                    &roles,
                    &before["stamp"],
                    &before["history"]["retained_bytes"]
                )
            );
            assert_eq!(h.state(), before);
            assert!(h.drain().is_empty());
        }
    }
    json!({"checkpoints":checkpoints,"input_roles":roles,"setup_events":setup_events})
}
pub fn observe() -> Value {
    let golden: Value = serde_json::from_str(ORACLES).unwrap();
    let resources_before = serde_json::to_value(sdk_v2::resource_counts()).unwrap();
    let mut rows = Vec::new();
    for c in golden["cases"].as_array().unwrap() {
        let mut h = Harness::open(c);
        let result = catch_unwind(AssertUnwindSafe(|| verify(&mut h, c)));
        h.session.destroy();
        let released = serde_json::to_value(h.session.own_resource_counts()).unwrap();
        let clean = released
            == json!({"sessions":0,"snapshot_handles":0,"snapshot_bytes":"0","protected_cursors":0});
        let (details, error) = match result {
            Ok(details) => (details, Value::Null),
            Err(error) => (
                Value::Null,
                json!(
                    error
                        .downcast_ref::<String>()
                        .cloned()
                        .or_else(|| error.downcast_ref::<&str>().map(|s| (*s).to_owned()))
                        .unwrap_or_else(|| "native assertion panic".into())
                ),
            ),
        };
        rows.push(json!({"id":c["id"],"status":if error.is_null() && clean {"passed"}else{"failed"},"error":error,"options":h.options,"initialization":h.initial,"context":h.context,"details":details,"calls":h.calls,"released":released}));
    }
    let resources_after = serde_json::to_value(sdk_v2::resource_counts()).unwrap();
    let zero =
        json!({"sessions":0,"snapshot_handles":0,"snapshot_bytes":"0","protected_cursors":0});
    let passed = rows.iter().all(|r| r["status"] == "passed")
        && resources_before == zero
        && resources_after == zero;
    json!({"format":"osr41-native-composition-observer/1","status":if passed {"passed"}else{"failed"},"scope":"Actual public native SDK2; frozen literal assertions precede semantic transcript replay on separately sealed WASM.","resources_before":resources_before,"resources_after":resources_after,"work_usage":"Not exposed by these public SDK DTOs; no invented raw work counters.","cases":rows})
}
