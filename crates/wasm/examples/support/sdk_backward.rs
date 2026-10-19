// SPDX-License-Identifier: MIT OR Apache-2.0
//! Additive OSR-39 command ABI witnesses over the actual SDK1 and SDK2 bridges.
use klenwriter_editor_wasm::{sdk, sdk_v2};
use serde_json::{Value, json};

const COMMAND: &str = "org.klenwriter.kwdj/command/delete-backward";
const PAYLOAD: &str = r#"{"kind":"delete_backward"}"#;
const D0: &[u8] = include_bytes!("../../../../contracts/dom/v1/inputs/D0.json");
const C0: &str = include_str!("../../../../contracts/dom/v1/expected/D0.canonical.json");
const C1: &str =
    include_str!("../../../../contracts/dom/v1/expected/D1-after-end-split.canonical.json");

enum Api {
    V1(Box<sdk::BridgeSession>),
    V2(Box<sdk_v2::BridgeSession>),
}
impl Api {
    fn open(v2: bool, input: &[u8], access: &str) -> Self {
        let options = super::options(access, "validate", super::empty_facts());
        let api = if v2 {
            let options = json!({"abi":"editor-sdk/2","build_id":sdk_v2::manifest().build_id,
                "profile":options["profile"],"admission":"validate","access":access,
                "registry_json":serde_json::to_string(&editor_kwdj::registry::registry_descriptor()).unwrap(),
                "profile_options_json":json!({"identities":super::empty_facts(),"limits":null}).to_string()});
            Self::V2(Box::new(sdk_v2::BridgeSession::new(
                input,
                &options.to_string(),
            )))
        } else {
            Self::V1(Box::new(sdk::BridgeSession::new(
                input,
                &options.to_string(),
            )))
        };
        let response = match &api {
            Self::V1(s) => serde_json::to_value(s.initialization()).unwrap(),
            Self::V2(s) => serde_json::to_value(s.initialization()).unwrap(),
        };
        assert_eq!(response["status"], "ok", "{response}");
        api
    }
    fn response(&mut self, request: Value) -> Value {
        let request = request.to_string();
        let response = match self {
            Self::V1(s) => s.call_json(&request),
            Self::V2(s) => s.call_json(&request),
        };
        serde_json::from_str(&response).unwrap()
    }
    fn call(&mut self, request: Value) -> Value {
        let response = self.response(request);
        assert_eq!(response["status"], "ok", "{response}");
        response["value"].clone()
    }
    fn state(&mut self) -> Value {
        self.call(json!({"kind":"state"}))["state"].clone()
    }
    fn node(&mut self, id: &Value) -> Value {
        let stamp = self.state()["stamp"].clone();
        self.call(json!({"kind":"node","stamp":stamp,"node":id}))["node"].clone()
    }
    fn at(&mut self, path: &[usize]) -> Value {
        let mut node = self.state()["root"].clone();
        for index in path {
            node = self.node(&node)["children"][*index].clone();
        }
        node
    }
    fn select(&mut self, selection: Value) {
        let stamp = self.state()["stamp"].clone();
        self.call(json!({"kind":"set_selection","stamp":stamp,"selection":selection}));
    }
    fn drain(&mut self) -> Vec<Value> {
        let events = self.call(json!({"kind":"events"}));
        assert_eq!(events["gap"], false);
        let rows = events["events"].as_array().unwrap().clone();
        if !rows.is_empty() {
            self.call(json!({"kind":"acknowledge_events","cursor":events["cursor"]}));
        }
        rows
    }
    fn snapshot(&mut self) -> String {
        let stamp = self.state()["stamp"].clone();
        let result = self.call(json!({"kind":"snapshot","stamp":stamp,"max_bytes":16777216}));
        let bytes = result["canonical_json"].as_str().unwrap().to_owned();
        self.call(json!({"kind":"release_snapshot","handle":result["handle"]}));
        bytes
    }
    fn command(&mut self, id: &str, payload: &str, effect: &str) {
        let before = self.state();
        let events = self.call(json!({"kind":"events"}));
        let command = json!({"id":id,"payload_json":payload});
        let query =
            self.call(json!({"kind":"query_command","stamp":before["stamp"],"command":command}));
        assert_eq!(query["available"], true, "{query}");
        assert_eq!(query["effect"], effect);
        assert_eq!(self.state(), before);
        assert_eq!(self.call(json!({"kind":"events"})), events);
        let result=self.call(json!({"kind":"command","stamp":before["stamp"],"command":command,"history_hint":{"kind":"isolated"}}));
        assert_eq!(result["effect"], effect);
        assert_eq!(self.drain().len(), usize::from(effect == "changed"));
    }
    fn history(&mut self, direction: &str) {
        let before = self.state();
        self.call(json!({"kind":"history","stamp":before["stamp"],"direction":direction}));
        assert_eq!(self.drain().len(), 1);
    }
    fn refuse(&mut self, payload: &str, code: &str) {
        let before = self.state();
        let events = self.call(json!({"kind":"events"}));
        let command = json!({"id":COMMAND,"payload_json":payload});
        let query = self
            .response(json!({"kind":"query_command","stamp":before["stamp"],"command":command}));
        let diagnostic = if query["status"] == "ok" {
            assert_eq!(query["value"]["available"], false);
            query["value"]["diagnostic"].clone()
        } else {
            assert_eq!(query["status"], "refused");
            query["diagnostic"].clone()
        };
        assert_eq!(diagnostic["code"], code);
        assert_eq!(diagnostic["path"], "");
        assert_eq!(diagnostic["may_have_committed"], false);
        let execution=self.response(json!({"kind":"command","stamp":before["stamp"],"command":command,"history_hint":{"kind":"isolated"}}));
        assert_eq!(execution["status"], "refused");
        assert_eq!(execution["diagnostic"]["code"], code);
        assert_eq!(execution["diagnostic"]["path"], "");
        assert_eq!(self.state(), before);
        assert_eq!(self.call(json!({"kind":"events"})), events);
    }
    fn destroy(mut self) {
        let resources = match &mut self {
            Self::V1(s) => {
                s.destroy();
                s.own_resource_counts()
            }
            Self::V2(s) => {
                s.destroy();
                s.own_resource_counts()
            }
        };
        assert_eq!(resources.sessions, 0);
        assert_eq!(resources.protected_cursors, 0);
        assert_eq!(resources.snapshot_handles, 0);
    }
}
fn point(node: &Value, offset: u32) -> Value {
    json!({"kind":"text","node":node,"offset":offset,"affinity":"after"})
}
fn caret(position: Value) -> Value {
    json!({"anchor":position,"focus":position})
}
fn split_join(v2: bool) {
    let mut s = Api::open(v2, D0, "editable");
    let p1 = s.at(&[0]);
    let p2 = s.at(&[1]);
    let tc = s.at(&[0, 2]);
    let t2 = s.at(&[1, 0]);
    let original = caret(point(&tc, 2));
    s.select(original.clone());
    s.drain();
    let catalog = s.call(json!({"kind":"catalog"}));
    assert_eq!(catalog["commands"].as_array().unwrap().len(), 16);
    assert!(
        catalog["commands"]
            .as_array()
            .unwrap()
            .iter()
            .any(|id| id == COMMAND)
    );
    s.command(
        "org.klenwriter.kwdj/command/enter",
        r#"{"kind":"enter"}"#,
        "changed",
    );
    assert_eq!(s.snapshot(), C1);
    let empty = s.at(&[1]);
    let split = caret(json!({"kind":"child","parent":empty,"index":0,"affinity":"after"}));
    assert_eq!(s.state()["selection"], split);
    s.command(COMMAND, PAYLOAD, "changed");
    assert_eq!(s.snapshot(), C0);
    assert_eq!(s.state()["selection"], original);
    assert_eq!(s.state()["history"]["undo_entries"], "2");
    assert_eq!(
        [s.at(&[0]), s.at(&[1]), s.at(&[0, 2]), s.at(&[1, 0])],
        [p1, p2, tc, t2]
    );
    s.history("undo");
    assert_eq!(s.snapshot(), C1);
    assert_eq!(s.at(&[1]), empty);
    assert_eq!(s.state()["selection"], split);
    s.history("undo");
    assert_eq!(s.snapshot(), C0);
    assert_eq!(s.state()["selection"], original);
    s.history("redo");
    assert_eq!(s.snapshot(), C1);
    assert_eq!(s.at(&[1]), empty);
    s.history("redo");
    assert_eq!(s.snapshot(), C0);
    assert_eq!(s.state()["selection"], original);
    assert_eq!(s.state()["stamp"]["revision"], "6");
    s.refuse(
        r#"{"kind":"delete_backward","extra":true}"#,
        "sdk.invalid_dto",
    );
    s.destroy();
    let mut s = Api::open(
        v2,
        include_bytes!("../../../../contracts/dom/v1/inputs/T03-initial.json"),
        "editable",
    );
    let t = s.at(&[0, 0]);
    s.select(caret(point(&t, 1)));
    s.drain();
    s.command(
        "org.klenwriter.kwdj/command/enter",
        r#"{"kind":"enter"}"#,
        "changed",
    );
    assert_eq!(
        s.snapshot(),
        include_str!("../../../../contracts/dom/v1/expected/T03-split.canonical.json")
    );
    let e = s.at(&[1]);
    let tr = s.at(&[1, 0]);
    let split = caret(point(&tr, 0));
    assert_eq!(s.state()["selection"], split);
    s.command(COMMAND, PAYLOAD, "changed");
    assert_eq!(s.at(&[0, 0]), t);
    assert_eq!(s.state()["selection"], caret(point(&t, 1)));
    assert_eq!(
        s.snapshot(),
        include_str!("../../../../contracts/dom/v1/expected/T03-initial.canonical.json")
    );
    s.history("undo");
    assert_eq!(s.at(&[1]), e);
    assert_eq!(s.at(&[1, 0]), tr);
    assert_eq!(s.state()["selection"], split);
    s.history("redo");
    assert_eq!(s.at(&[0, 0]), t);
    assert_eq!(s.state()["selection"], caret(point(&t, 1)));
    s.destroy();
}
fn boundaries(v2: bool) {
    let mut s = Api::open(v2, D0, "editable");
    let ta = s.at(&[0, 0]);
    let tb = s.at(&[0, 1]);
    let before = s.state();
    let scalar = s.response(
        json!({"kind":"set_selection","stamp":before["stamp"],"selection":caret(point(&ta,2))}),
    );
    assert_eq!(scalar["status"], "refused");
    assert_eq!(scalar["diagnostic"]["code"], "position.invalid");
    assert_eq!(scalar["diagnostic"]["path"], "");
    assert_eq!(scalar["diagnostic"]["category"], "sdk");
    assert_eq!(scalar["diagnostic"]["details"], json!({}));
    assert_eq!(scalar["diagnostic"]["may_have_committed"], false);
    assert_eq!(s.state(), before);
    s.select(caret(point(&tb, 1)));
    s.drain();
    s.refuse(PAYLOAD, "position.invalid");
    s.destroy();
    let mut s = Api::open(
        v2,
        include_bytes!("../../../../contracts/dom/v1/inputs/T05-backward-EGC.json"),
        "editable",
    );
    let left = s.at(&[0, 0]);
    let accent = s.at(&[0, 1]);
    s.select(caret(point(&accent, 1)));
    s.drain();
    s.command(COMMAND, PAYLOAD, "changed");
    assert_eq!(s.state()["selection"], caret(point(&left, 1)));
    assert_eq!(
        s.snapshot(),
        include_str!("../../../../contracts/dom/v1/expected/T05-backward-EGC-after.canonical.json")
    );
    s.destroy();
    let mut s = Api::open(v2, D0, "read_only");
    let ta = s.at(&[0, 0]);
    s.select(caret(point(&ta, 1)));
    s.drain();
    s.refuse(PAYLOAD, "session.read_only");
    s.destroy();
}
pub fn observe() -> Value {
    for v2 in [false, true] {
        split_join(v2);
        boundaries(v2);
    }
    json!({"status":"passed","abis":["editor-sdk/1","editor-sdk/2"],"payload_json":PAYLOAD,
        "closed_empty_dto":true,"frozen_t02_t03_exact_ids_caret_history":true,
        "native_position_diagnostics":true,"cross_style_egc":true,"one_publication_per_action":true})
}
