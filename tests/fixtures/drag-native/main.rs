// SPDX-License-Identifier: MIT OR Apache-2.0
//! Test-only bounded observer. Public SDK2 requests only; literals live in versioned data.
use klenwriter_editor_wasm::sdk_v2;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{self, Read};
use std::panic::{AssertUnwindSafe, catch_unwind};

struct Harness {
    bridge: sdk_v2::BridgeSession,
    calls: Vec<Value>,
    observation: Value,
}
impl Harness {
    fn call(&mut self, request: Value) -> Value {
        let response: Value =
            serde_json::from_str(&self.bridge.call_json(&request.to_string())).unwrap();
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
    fn drain(&mut self) -> Value {
        let events = self.ok(json!({"kind":"events"}));
        assert_eq!(events["gap"], false);
        if !events["events"].as_array().unwrap().is_empty() {
            self.ok(json!({"kind":"acknowledge_events","cursor":events["cursor"]}));
        }
        events["events"].clone()
    }
    fn checkpoint(&mut self) -> Value {
        let state = self.state();
        let snapshot =
            self.ok(json!({"kind":"snapshot","stamp":state["stamp"],"max_bytes":2097152}));
        self.ok(json!({"kind":"release_snapshot","handle":snapshot["handle"]}));
        let mut pending = vec![(
            state["root"].as_str().unwrap().to_owned(),
            Vec::<usize>::new(),
        )];
        let mut seen = BTreeSet::new();
        let mut nodes = Vec::new();
        let mut index = 0;
        while index < pending.len() {
            assert!(index < 4096, "finite authored fixture");
            let (id, path) = pending[index].clone();
            index += 1;
            assert!(seen.insert(id.clone()), "tree roles are unique");
            let row =
                self.ok(json!({"kind":"node","stamp":state["stamp"],"node":id}))["node"].clone();
            for (ordinal, child) in row["children"].as_array().unwrap().iter().enumerate() {
                let mut child_path = path.clone();
                child_path.push(ordinal);
                pending.push((child.as_str().unwrap().to_owned(), child_path));
            }
            nodes.push(json!({"path":path,"node":row}));
        }
        let resources = self.ok(json!({"kind":"resources"}))["resources"].clone();
        json!({"state":state,"canonical":snapshot["canonical_json"],"nodes":nodes,"resources":resources})
    }
}
type Roles = BTreeMap<String, Value>;
fn bind(table: &Value, checkpoint: &Value) -> Roles {
    table
        .as_object()
        .unwrap()
        .iter()
        .map(|(role, path)| {
            let found = checkpoint["nodes"]
                .as_array()
                .unwrap()
                .iter()
                .find(|row| row["path"] == *path)
                .expect("literal authored role path");
            (role.clone(), found["node"]["id"].clone())
        })
        .collect()
}
fn resolve(value: &Value, roles: &Roles) -> Value {
    if let Some(text) = value.as_str()
        && let Some(role) = text.strip_prefix('@')
    {
        return roles.get(role).expect("declared role token").clone();
    }
    match value {
        Value::Array(values) => Value::Array(values.iter().map(|v| resolve(v, roles)).collect()),
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .map(|(k, v)| (k.clone(), resolve(v, roles)))
                .collect(),
        ),
        _ => value.clone(),
    }
}
fn run(h: &mut Harness, case: &Value) {
    let initial = serde_json::to_value(h.bridge.initialization()).unwrap();
    assert_eq!(initial["status"], "ok", "{initial}");
    let admitted = h.checkpoint();
    let roles = bind(&case["roles_before"], &admitted);
    let selection = resolve(&case["selection"], &roles);
    h.ok(json!({"kind":"set_selection","stamp":admitted["state"]["stamp"],"selection":selection}));
    let setup_events = h.drain();
    let baseline = h.checkpoint();
    h.observation = json!({"initial":initial,"context":h.bridge.context(),"admitted":admitted,
        "roles":roles,"setupEvents":setup_events,"baseline":baseline,"operations":[]});
    let operations = case["operations"].as_array().unwrap();
    assert!(operations.len() <= 24, "finite authored operations");
    for source in operations {
        let before = h.checkpoint();
        let kind = source["kind"].as_str().unwrap();
        let row = match kind {
            "command" => {
                assert_eq!(source["command"]["id"], "org.klenwriter.kwdj/command/move");
                let payload = resolve(&source["command"]["payload"], &roles);
                assert_eq!(payload["kind"], "move");
                let command =
                    json!({"id":source["command"]["id"],"payload_json":payload.to_string()});
                let query = h.call(json!({"kind":"query_command","stamp":before["state"]["stamp"],"command":command}));
                let after_query = h.checkpoint();
                let response = h.call(json!({"kind":"command","stamp":before["state"]["stamp"],"command":command,"history_hint":{"kind":"isolated"}}));
                let events = h.drain();
                let after = h.checkpoint();
                json!({"kind":kind,"before":before,"command":command,"query":query,
                    "afterQuery":after_query,"response":response,"events":events,"after":after})
            }
            "history" => {
                let direction = source["direction"].as_str().unwrap();
                assert!(["undo", "redo"].contains(&direction));
                let query = h.call(json!({"kind":"query_history","stamp":before["state"]["stamp"],"direction":direction}));
                let after_query = h.checkpoint();
                let response = h.call(json!({"kind":"history","stamp":before["state"]["stamp"],"direction":direction}));
                let events = h.drain();
                let after = h.checkpoint();
                json!({"kind":kind,"direction":direction,"before":before,"query":query,
                    "afterQuery":after_query,"response":response,"events":events,"after":after})
            }
            "map" => {
                let request = json!({"kind":"map_position","stamp":before["state"]["stamp"],
                    "from_revision":source["from_revision"],"position":resolve(&source["position"],&roles)});
                let response = h.call(request.clone());
                let events = h.drain();
                let after = h.checkpoint();
                json!({"kind":kind,"before":before,"request":request,"response":response,"events":events,"after":after})
            }
            _ => panic!("unknown closed fixture operation"),
        };
        h.observation["operations"]
            .as_array_mut()
            .unwrap()
            .push(row);
    }
    let after = h.checkpoint();
    h.observation["after"] = after;
}
fn main() {
    let mut bytes = Vec::new();
    io::stdin().take(2097153).read_to_end(&mut bytes).unwrap();
    assert!(bytes.len() <= 2097152);
    let job: Value = serde_json::from_slice(&bytes).unwrap();
    let cases = job["cases"].as_array().unwrap();
    assert!(cases.len() <= 64);
    let mut records = Vec::new();
    for case in cases {
        let options = json!({"abi":"editor-sdk/2","build_id":sdk_v2::manifest().build_id,
            "profile":case["profile"],"admission":"validate","access":"editable",
            "registry_json":case["registry_json"],"profile_options_json":case["profile_options_json"]});
        let bridge = sdk_v2::BridgeSession::new(
            case["input"].as_str().unwrap().as_bytes(),
            &options.to_string(),
        );
        let mut harness = Harness {
            bridge,
            calls: Vec::new(),
            observation: Value::Null,
        };
        let result = catch_unwind(AssertUnwindSafe(|| run(&mut harness, case)));
        let failure = result.err().map(|error| {
            error
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| error.downcast_ref::<&str>().map(|s| s.to_string()))
                .unwrap_or_else(|| "non-string fixture panic".into())
        });
        let mut cleanup_failures = Vec::new();
        if catch_unwind(AssertUnwindSafe(|| harness.bridge.destroy())).is_err() {
            cleanup_failures.push(json!({"phase":"destroy","message":"original destroy panicked"}));
        }
        let status = if failure.is_some() || !cleanup_failures.is_empty() {
            "failed"
        } else {
            "recorded"
        };
        records.push(json!({"id":case["id"],"status":status,"options":options,
            "observation":harness.observation,"calls":harness.calls,"failure":failure,
            "cleanupFailures":cleanup_failures,"released":sdk_v2::resource_counts()}));
    }
    let failed = records.iter().any(|row| row["status"] == "failed");
    println!(
        "{}",
        json!({"format":"editor-drag-native-raw/1","status":if failed {"failed"}else{"recorded"},
        "manifest":sdk_v2::manifest(),"records":records,"resources":sdk_v2::resource_counts()})
    );
    if failed {
        std::process::exit(1);
    }
}
