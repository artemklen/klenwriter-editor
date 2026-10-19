// SPDX-License-Identifier: MIT OR Apache-2.0
//! Frozen literals through the actual public SDK2 endpoint, on native and WASM.
use klenwriter_editor_wasm::{sdk, sdk_v2::BridgeSession};
use serde_json::{Value, json};
use std::collections::BTreeMap;
const GOLDEN: &str = include_str!("../../../../contracts/selection/v1/native-oracles.json");
type Roles = BTreeMap<String, String>;
fn call(s: &mut BridgeSession, r: Value) -> Value {
    serde_json::from_str(&s.call_json(&r.to_string())).expect("SDK JSON")
}
fn state(s: &mut BridgeSession) -> Value {
    let r = call(s, json!({"kind":"state"}));
    assert_eq!(r["status"], "ok", "{r}");
    r["value"]["state"].clone()
}
fn open(input: &Value) -> BridgeSession {
    let profile = serde_json::to_value(sdk::manifest().profiles.remove(0)).unwrap();
    let options = json!({"abi":"editor-sdk/2","build_id":sdk::manifest().build_id,"profile":profile,
        "admission":"validate","access":input.get("access").and_then(Value::as_str).unwrap_or("editable"),
        "registry_json":serde_json::to_string(&editor_kwdj::registry::registry_descriptor()).unwrap(),
        "profile_options_json":json!({"identities":input.get("identities").cloned().unwrap_or(json!({"media":[],"references":[]})),"limits":null}).to_string()});
    let mut s = BridgeSession::new(
        input["canonical_json"]
            .as_str()
            .expect("input canonical")
            .as_bytes(),
        &options.to_string(),
    );
    assert_eq!(
        serde_json::to_value(s.initialization()).unwrap()["status"],
        "ok"
    );
    assert!(!state(&mut s).is_null());
    s
}
fn roles(s: &mut BridgeSession, table: &Value) -> Roles {
    let st = state(s);
    let root = st["root"].as_str().unwrap().to_owned();
    let mut out = Roles::new();
    out.insert("ROOT".into(), root.clone());
    for (role, path) in table.as_object().expect("roles") {
        if role == "ROOT" {
            continue;
        }
        let mut id = root.clone();
        for i in path.as_array().expect("literal path") {
            let r = call(s, json!({"kind":"node","stamp":st["stamp"],"node":id}));
            assert_eq!(r["status"], "ok", "{r}");
            id = r["value"]["node"]["children"][i.as_u64().unwrap() as usize]
                .as_str()
                .expect("literal child")
                .into();
        }
        out.insert(role.clone(), id);
    }
    out
}
fn position(p: &Value, r: &Roles) -> Value {
    let mut p = p.clone();
    let key = if p["kind"] == "child" {
        "parent"
    } else {
        "node"
    };
    let name = p[key].as_str().unwrap();
    p[key] = json!(r.get(name).expect("role"));
    p
}
fn selection(p: &Value, r: &Roles) -> Value {
    if p.is_null() {
        Value::Null
    } else {
        json!({"anchor":position(&p["anchor"],r),"focus":position(&p["focus"],r)})
    }
}
fn install(s: &mut BridgeSession, p: &Value, r: &Roles) {
    if !p.is_null() {
        let st = state(s);
        let result = call(
            s,
            json!({"kind":"set_selection","stamp":st["stamp"],"selection":selection(p,r)}),
        );
        assert_eq!(result["status"], "ok", "{result}");
    }
}
fn canonical(s: &mut BridgeSession) -> String {
    let st = state(s);
    let r = call(
        s,
        json!({"kind":"snapshot","stamp":st["stamp"],"max_bytes":2097152}),
    );
    assert_eq!(r["status"], "ok", "{r}");
    let text = r["value"]["canonical_json"].as_str().unwrap().to_owned();
    let done = call(
        s,
        json!({"kind":"release_snapshot","handle":r["value"]["handle"]}),
    );
    assert_eq!(done["status"], "ok");
    text
}
fn diag(actual: &Value, expected: &Value, stamp: &Value) {
    let mut expected = expected.clone();
    if expected["stamp"] == "exact_current_stamp" {
        expected["stamp"] = stamp.clone();
    }
    assert_eq!(actual, &expected, "diagnostic");
}
fn projection(s: &mut BridgeSession, expected: &Value, r: &Roles, max: u32) -> Value {
    let st = state(s);
    let resources = serde_json::to_value(s.own_resource_counts()).unwrap();
    let result = call(
        s,
        json!({"kind":"selection_text","stamp":st["stamp"],"max_bytes":max}),
    );
    assert_eq!(state(s), st, "projection changed native state");
    assert_eq!(
        serde_json::to_value(s.own_resource_counts()).unwrap(),
        resources,
        "projection resources"
    );
    assert_eq!(result["status"], expected["status"], "projection {result}");
    if expected["status"] == "refused" {
        diag(&result["diagnostic"], &expected["diagnostic"], &st["stamp"]);
    } else {
        let mut expected = expected["value"].clone();
        expected["stamp"] = st["stamp"].clone();
        expected["selection"] = selection(&expected["selection"], r);
        expected["selected_atoms"] = json!(
            expected["selected_atoms"]
                .as_array()
                .unwrap()
                .iter()
                .map(|id| r[id.as_str().unwrap()].clone())
                .collect::<Vec<_>>()
        );
        assert_eq!(result["value"], expected, "projection payload");
    }
    result
}
fn maps(s: &mut BridgeSession, rows: &Value, from: &str, before: &Roles, after: &Roles) {
    if let Some(rows) = rows.as_array() {
        for row in rows {
            let st = state(s);
            let r = call(
                s,
                json!({"kind":"map_position","stamp":st["stamp"],"from_revision":from,"position":position(&row["input"],before)}),
            );
            assert_eq!(r["status"], "ok", "{r}");
            assert_eq!(r["value"]["status"], row["status"]);
            assert_eq!(r["value"]["deleted"], row["deleted"]);
            assert_eq!(
                r["value"]["position"],
                position(&row["position"], after),
                "mapping {row}"
            );
            assert_eq!(state(s), st);
        }
    }
}
fn observe_case(c: &Value) -> Value {
    let mut s = open(&c["input"]);
    let before_roles = roles(&mut s, &c["input"]["identity_roles"]);
    install(&mut s, &c["input"]["selection"], &before_roles);
    let initial = state(&mut s);
    assert_eq!(
        canonical(&mut s),
        c["input"]["canonical_json"].as_str().unwrap()
    );
    if let Some(action) = c.get("before_projection_action") {
        let r = call(
            &mut s,
            json!({"kind":"set_selection","stamp":initial["stamp"],"selection":selection(&action["request"]["selection"],&before_roles)}),
        );
        assert_eq!(r["status"], "refused");
        diag(
            &r["diagnostic"],
            &action["expected"]["diagnostic"],
            &initial["stamp"],
        );
        assert_eq!(state(&mut s), initial);
    }
    let projected = projection(&mut s, &c["projection"]["expected"], &before_roles, 1048576);
    let q = call(
        &mut s,
        json!({"kind":"query_command","stamp":initial["stamp"],"command":c["delete_selection"]["command"]}),
    );
    assert_eq!(q, c["delete_selection"]["query"], "query {}", c["id"]);
    assert_eq!(state(&mut s), initial);
    let result = call(
        &mut s,
        json!({"kind":"command","stamp":initial["stamp"],"command":c["delete_selection"]["command"],"history_hint":{"kind":"isolated"}}),
    );
    assert_eq!(
        result["status"], c["delete_selection"]["execute"]["status"],
        "execute {}: {result}",
        c["id"]
    );
    if result["status"] == "refused" {
        diag(
            &result["diagnostic"],
            &c["delete_selection"]["execute"]["diagnostic"],
            &initial["stamp"],
        );
        assert_eq!(state(&mut s), initial);
    } else {
        assert_eq!(
            result["value"]["effect"],
            c["delete_selection"]["execute"]["value"]["effect"]
        );
        assert_eq!(result["value"]["presentation"], json!({"active":"none"}));
    }
    assert_eq!(
        canonical(&mut s),
        c["after"]["canonical_json"].as_str().unwrap(),
        "canonical {}",
        c["id"]
    );
    let after_roles = roles(&mut s, &c["after"]["identity_roles"]);
    let after = state(&mut s);
    assert_eq!(
        after["selection"],
        selection(&c["after"]["selection"], &after_roles),
        "caret {}",
        c["id"]
    );
    if let Some(identity) = c.get("identity") {
        for id in identity["retained_live"].as_array().unwrap() {
            let id = id.as_str().unwrap();
            assert_eq!(after_roles[id], before_roles[id]);
        }
        for id in identity["created_live"].as_array().unwrap() {
            assert!(
                !before_roles
                    .values()
                    .any(|old| old == &after_roles[id.as_str().unwrap()])
            );
        }
        for id in identity["retired_old"].as_array().unwrap() {
            let r = call(
                &mut s,
                json!({"kind":"node","stamp":after["stamp"],"node":before_roles[id.as_str().unwrap()]}),
            );
            assert_eq!(r["diagnostic"]["code"], "tree.missing_node");
        }
    }
    maps(&mut s, &c["maps"], "0", &before_roles, &after_roles);
    if c.get("history").and_then(|h| h.get("undo")).is_some() {
        assert_eq!(after["stamp"]["revision"], "1");
        assert_eq!(after["history"]["undo_entries"], "1");
        assert_eq!(after["history"]["redo_entries"], "0");
        for (direction, revision, table, expected_roles) in [
            ("undo", "2", &c["input"]["identity_roles"], &before_roles),
            ("redo", "3", &c["after"]["identity_roles"], &after_roles),
        ] {
            let st = state(&mut s);
            let r = call(
                &mut s,
                json!({"kind":"history","stamp":st["stamp"],"direction":direction}),
            );
            assert_eq!(r["status"], "ok", "history {} {r}", c["id"]);
            let actual = state(&mut s);
            assert_eq!(actual["stamp"]["revision"], revision);
            let expected = &c["history"][direction];
            assert_eq!(
                canonical(&mut s),
                expected["canonical_json"].as_str().unwrap()
            );
            assert_eq!(roles(&mut s, table), *expected_roles, "history identity");
            assert_eq!(
                actual["selection"],
                selection(&expected["selection"], expected_roles)
            );
            maps(
                &mut s,
                &expected[if direction == "undo" {
                    "maps_from_revision1"
                } else {
                    "maps_from_revision2"
                }],
                if direction == "undo" { "1" } else { "2" },
                if direction == "undo" {
                    &after_roles
                } else {
                    &before_roles
                },
                expected_roles,
            );
            if let Some(row) = expected.get("map_from_initial_revision0") {
                maps(&mut s, &json!([row]), "0", &before_roles, expected_roles);
            }
        }
    } else if result["status"] == "ok" {
        assert_eq!(state(&mut s), initial, "true no-op");
    }
    s.destroy();
    assert_eq!(s.own_resource_counts().sessions, 0);
    assert_eq!(s.own_resource_counts().snapshot_handles, 0);
    assert_eq!(s.own_resource_counts().protected_cursors, 0);
    json!({"id":c["id"],"status":"passed","projection":projected,"execute":result,"after":after})
}
pub fn observe() -> Value {
    let golden: Value = serde_json::from_str(GOLDEN).unwrap();
    let mut rows = Vec::new();
    for c in golden["cases"].as_array().unwrap() {
        rows.push(observe_case(c));
    }
    for c in golden["projection_separator_literals"].as_array().unwrap() {
        let input = json!({"canonical_json":c["canonical_json"]});
        let mut s = open(&input);
        let r = roles(&mut s, &c["roles"]);
        install(&mut s, &c["selection"], &r);
        projection(
            &mut s,
            &json!({"status":"ok","value":{"kind":"selection_text","stamp":"exact_current_stamp","selection":c["selection"],"projection_id":"org.klenwriter.kwdj/selection-text/1","text":c["text"],"empty":c["empty"],"selected_atoms":c["selected_atoms"]}}),
            &r,
            1048576,
        );
        s.destroy();
    }
    for c in golden["output_budget_literals"].as_array().unwrap() {
        let input = json!({"canonical_json":c["canonical_json"]});
        let mut s = open(&input);
        let r = roles(&mut s, &c["roles"]);
        install(&mut s, &c["selection"], &r);
        let expected = if c["expected"]["status"] == "refused" {
            c["expected"].clone()
        } else {
            json!({"status":"ok","value":{"kind":"selection_text","stamp":"exact_current_stamp","selection":c["selection"],"projection_id":"org.klenwriter.kwdj/selection-text/1","text":"ab","empty":false,"selected_atoms":[]}})
        };
        projection(
            &mut s,
            &expected,
            &r,
            c["request"]["max_bytes"].as_u64().unwrap() as u32,
        );
        s.destroy();
    }
    let format = &golden["format_positive_literal"];
    for direction in ["forward", "reverse"] {
        let mut s = open(&json!({"canonical_json":format["canonical_json"]}));
        let before = roles(&mut s, &format["roles"]);
        install(&mut s, &format[format!("{direction}_selection")], &before);
        let st = state(&mut s);
        let query = call(
            &mut s,
            json!({"kind":"query_command","stamp":st["stamp"],"command":format["command"]}),
        );
        assert_eq!(query["value"]["available"], true);
        assert_eq!(query["value"]["presentation"]["active"], "off");
        assert_eq!(state(&mut s), st);
        let result = call(
            &mut s,
            json!({"kind":"command","stamp":st["stamp"],"command":format["command"],"history_hint":{"kind":"isolated"}}),
        );
        assert_eq!(result["status"], "ok");
        assert_eq!(
            canonical(&mut s),
            format["after_canonical_json"].as_str().unwrap()
        );
        let after = roles(&mut s, &format["after_roles"]);
        assert_eq!(
            state(&mut s)["selection"],
            selection(&format[format!("{direction}_selection_after")], &after)
        );
        for key in ["P", "L", "R"] {
            assert_eq!(after[key], before[key]);
        }
        maps(&mut s, &format["maps"], "0", &before, &after);
        for (step, table, expected) in [
            ("undo", &format["roles"], &before),
            ("redo", &format["after_roles"], &after),
        ] {
            let stamp = state(&mut s)["stamp"].clone();
            let result = call(
                &mut s,
                json!({"kind":"history","stamp":stamp,"direction":step}),
            );
            assert_eq!(result["status"], "ok");
            assert_eq!(roles(&mut s, table), *expected);
        }
        s.destroy();
    }
    // The public text ceiling is actually reachable: four authored maximum-size
    // leaves have distinct adjacent marks, so normalization does not merge them.
    let leaf = |c: char, mark: &str| json!({"type":"text","text":c.to_string().repeat(262144),"marks":[{"type":mark}]});
    let document = json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[leaf('a',"strong"),leaf('b',"emphasis"),leaf('c',"strong"),leaf('d',"emphasis")]}]});
    let mut s = open(&json!({"canonical_json":document.to_string()}));
    let r = roles(&mut s, &json!({"P":[0]}));
    install(
        &mut s,
        &json!({"anchor":{"kind":"edge","node":"P","side":"before"},"focus":{"kind":"edge","node":"P","side":"after"}}),
        &r,
    );
    let st = state(&mut s);
    let result = call(
        &mut s,
        json!({"kind":"selection_text","stamp":st["stamp"],"max_bytes":1048576}),
    );
    assert_eq!(result["status"], "ok", "1MiB read {result}");
    let copied = result["value"]["text"].as_str().unwrap();
    assert_eq!(copied.len(), 1048576);
    assert_eq!(&copied[..262144], "a".repeat(262144));
    assert_eq!(&copied[786432..], "d".repeat(262144));
    assert_eq!(state(&mut s), st);
    for (field, code, path) in [
        ("generation", "session.stale_session", "stamp.session"),
        ("revision", "session.stale_revision", "stamp.revision"),
        (
            "selection_epoch",
            "session.stale_selection_epoch",
            "stamp.selection_epoch",
        ),
        (
            "history_epoch",
            "session.stale_history_epoch",
            "stamp.history_epoch",
        ),
    ] {
        let mut stamp = st["stamp"].clone();
        stamp[field] =
            json!((stamp[field].as_str().unwrap().parse::<u64>().unwrap() + 1).to_string());
        let result = call(
            &mut s,
            json!({"kind":"selection_text","stamp":stamp,"max_bytes":1048576}),
        );
        assert_eq!(result["diagnostic"]["code"], code);
        assert_eq!(result["diagnostic"]["path"], path);
        assert_eq!(result["diagnostic"]["stamp"], st["stamp"]);
        assert_eq!(state(&mut s), st);
    }
    let result = call(
        &mut s,
        json!({"kind":"selection_text","stamp":st["stamp"],"max_bytes":1048576,"extra":true}),
    );
    assert_eq!(result["diagnostic"]["code"], "sdk.invalid_dto");
    s.destroy();
    let options = json!({"abi":"editor-sdk/1","build_id":sdk::manifest().build_id,"profile":sdk::manifest().profiles.remove(0),"admission":"validate","access":"editable","identities":{"media":[],"references":[]},"limits":null});
    let mut legacy=sdk::BridgeSession::new(br#"{"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[]}]}"#,&options.to_string());
    let result: Value = serde_json::from_str(&legacy.call_json(
        &json!({"kind":"selection_text","stamp":st["stamp"],"max_bytes":1}).to_string(),
    ))
    .unwrap();
    assert_eq!(result["diagnostic"]["code"], "sdk.invalid_dto");
    legacy.destroy();
    json!({"format":"osr40-native-selection-observer/1","status":"passed","cases":rows,"separator_cases":8,"output_budget_cases":5,"format_cases":2,"exact_one_mib_read":true,"stale_guards":4,"abi1_new_read_refused":true})
}
