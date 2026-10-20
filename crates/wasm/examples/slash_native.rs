// SPDX-License-Identifier: MIT OR Apache-2.0
//! Finite test-only slash observer over the public SDK2 bridge.
//! Existing ui_native scaffolding plus publication-free text_window calls;
//! independent frozen slash literals are asserted by a separate Node consumer.
use klenwriter_editor_wasm::sdk_v2;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{self, Read};
use std::panic::{AssertUnwindSafe, catch_unwind};

struct Harness {
    bridge: sdk_v2::BridgeSession,
    calls: Vec<Value>,
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
fn run(h: &mut Harness, case: &Value, foreign_stamp: Option<&Value>) -> Value {
    let initial = serde_json::to_value(h.bridge.initialization()).unwrap();
    assert_eq!(initial["status"], "ok", "{initial}");
    let admitted = h.checkpoint();
    let roles = bind(&case["roles_before"], &admitted);
    let selection = resolve(&case["selection"], &roles);
    h.ok(json!({"kind":"set_selection","stamp":admitted["state"]["stamp"],"selection":selection}));
    let setup_events = h.drain();
    let baseline = h.checkpoint();
    let mut steps = Vec::new();
    let commands = case["commands"].as_array().unwrap();
    assert!(commands.len() <= 8);
    for source in commands {
        let before = h.checkpoint();
        let command = json!({"id":source["id"],"payload_json":resolve(&source["payload"],&roles).to_string()});
        let query = h.call(
            json!({"kind":"query_command","stamp":before["state"]["stamp"],"command":command}),
        );
        let after_query = h.checkpoint();
        let response = h.call(json!({"kind":"command","stamp":before["state"]["stamp"],"command":command,"history_hint":{"kind":"isolated"}}));
        let events = h.drain();
        let after = h.checkpoint();
        steps.push(json!({"before":before,"command":command,"query":query,"afterQuery":after_query,"response":response,"events":events,"after":after}));
    }
    let mut reads = Vec::new();
    if let Some(requests) = case["reads"].as_array() {
        assert!(requests.len() <= 16, "finite authored read list");
        for source in requests {
            let before = h.checkpoint();
            let mut request = resolve(source, &roles);
            request["stamp"] = before["state"]["stamp"].clone();
            let foreign = request.as_object_mut().unwrap().remove("use_foreign_stamp");
            if foreign == Some(Value::Bool(true)) {
                request["stamp"] = foreign_stamp.expect("genuine auxiliary session").clone();
            }
            if let Some(overrides) = request.as_object_mut().unwrap().remove("stamp_overrides") {
                for (key, value) in overrides.as_object().unwrap() {
                    assert!(
                        ["generation", "revision", "selection_epoch", "history_epoch"]
                            .contains(&key.as_str())
                    );
                    request["stamp"][key] = value.clone();
                }
            }
            let response = h.call(request.clone());
            let events = h.drain();
            let after = h.checkpoint();
            reads.push(json!({"before":before,"request":request,"response":response,"events":events,"after":after}));
        }
    }
    let after = h.checkpoint();
    let mut history = Vec::new();
    if case["history"] == true {
        for direction in ["undo", "redo"] {
            let before = h.checkpoint();
            let query = h.call(json!({"kind":"query_history","stamp":before["state"]["stamp"],"direction":direction}));
            let response = h.call(
                json!({"kind":"history","stamp":before["state"]["stamp"],"direction":direction}),
            );
            let events = h.drain();
            let checkpoint = h.checkpoint();
            history.push(json!({"direction":direction,"query":query,"response":response,"events":events,"after":checkpoint}));
        }
    }
    json!({"initial":initial,"context":h.bridge.context(),"admitted":admitted,"roles":roles,"setupEvents":setup_events,"baseline":baseline,"steps":steps,"reads":reads,"after":after,"history":history})
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
        let mut foreign = if case["foreign"] == true {
            Some(sdk_v2::BridgeSession::new(
                case["input"].as_str().unwrap().as_bytes(),
                &options.to_string(),
            ))
        } else {
            None
        };
        let foreign_stamp = foreign.as_ref().map(|bridge| {
            let initial = serde_json::to_value(bridge.initialization()).unwrap();
            assert_eq!(initial["status"], "ok");
            initial["value"]["state"]["stamp"].clone()
        });
        let mut harness = Harness {
            bridge,
            calls: Vec::new(),
        };
        let result = catch_unwind(AssertUnwindSafe(|| {
            run(&mut harness, case, foreign_stamp.as_ref())
        }));
        let (status, observation) = match result {
            Ok(observation) => ("recorded", observation),
            Err(error) => ("failed", json!({"panic":format!("{error:?}")})),
        };
        harness.bridge.destroy();
        if let Some(bridge) = foreign.as_mut() {
            bridge.destroy();
        }
        records.push(json!({"id":case["id"],"status":status,"options":options,"observation":observation,"calls":harness.calls,"released":sdk_v2::resource_counts()}));
    }
    let failed = records.iter().any(|record| record["status"] == "failed");
    println!(
        "{}",
        json!({"format":"editor-slash-native-raw/1","status":if failed {"failed"} else {"recorded"},"manifest":sdk_v2::manifest(),"records":records,"resources":sdk_v2::resource_counts()})
    );
    if failed {
        std::process::exit(1);
    }
}
