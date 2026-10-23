// SPDX-License-Identifier: MIT OR Apache-2.0
//! Test-only composition with a real bridge/profile and explicit compiled traps.
//! Its own identity and fixture-local JS binding never replace production bytes.

use editor_bridge::{Distribution, SessionFactory};
use editor_protocol::v2::SdkManifestV2;

pub const BUILD_ID: &str = env!("KLENWRITER_EDITOR_SDK_BUILD_ID");

fn distribution() -> Distribution {
    assert_eq!(BUILD_ID, editor_bridge::BUILD_ID);
    let factories: Vec<Box<dyn SessionFactory>> = vec![Box::new(editor_kwdj_sdk::KwdjFactory)];
    Distribution::new(BUILD_ID, factories).expect("one explicit valid compiled factory")
}

pub fn manifest() -> SdkManifestV2 {
    distribution().manifest()
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use editor_bridge::{DistributionSession, Endpoint};
    use serde_json::{Value, json};
    use std::sync::atomic::{AtomicU8, Ordering};
    use wasm_bindgen::prelude::*;

    static ARMED: AtomicU8 = AtomicU8::new(0);

    // Only this test composition imports the bounded observer. The immutable
    // witness is copied outside WASM before the trap, after bridge calls return.
    #[wasm_bindgen(
        inline_js = "export function recordFailureWitness(json) { Object.defineProperty(globalThis, '__failureRuntimeWitness', { value: json, writable: false, configurable: true }); }"
    )]
    extern "C" {
        fn recordFailureWitness(json: &str);
    }

    #[wasm_bindgen(js_name = failureArmTrap)]
    pub fn arm_trap(phase: &str) -> bool {
        let value = match phase {
            "before_dispatch" => 1,
            "after_publication" => 2,
            _ => return false,
        };
        ARMED
            .compare_exchange(0, value, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    #[wasm_bindgen(js_name = sdkManifestV2)]
    pub fn manifest() -> String {
        serde_json::to_string(&super::manifest()).expect("manifest serializes")
    }

    #[wasm_bindgen(js_name = sdkResourceCountsV2)]
    pub fn resource_counts() -> String {
        serde_json::to_string(&editor_bridge::resource_counts()).expect("counts serialize")
    }

    #[wasm_bindgen]
    pub struct SdkSessionV2 {
        inner: DistributionSession,
    }

    #[wasm_bindgen]
    impl SdkSessionV2 {
        #[wasm_bindgen(constructor)]
        pub fn new(input: &[u8], options_json: &str) -> Self {
            Self {
                inner: super::distribution().open(input, options_json),
            }
        }

        pub fn initialization(&self) -> String {
            serde_json::to_string(&self.inner.initialization()).expect("initialization serializes")
        }

        pub fn context(&self) -> String {
            serde_json::to_string(&self.inner.context()).expect("context serializes")
        }

        pub fn call(&mut self, request_json: &str) -> String {
            let command = serde_json::from_str::<Value>(request_json)
                .ok()
                .is_some_and(|value| value.get("kind").and_then(Value::as_str) == Some("command"));
            let phase = if command {
                ARMED.swap(0, Ordering::SeqCst)
            } else {
                0
            };
            if phase == 1 {
                self.observe_before_trap("before_dispatch", None);
                core::arch::wasm32::unreachable();
            }
            let response = self.inner.call_json(request_json);
            if phase == 2 {
                self.observe_before_trap("after_publication", Some(&response));
                core::arch::wasm32::unreachable();
            }
            response
        }

        pub fn destroy(&mut self) {
            self.inner.destroy();
        }
    }

    impl SdkSessionV2 {
        fn observe_before_trap(&mut self, phase: &str, response: Option<&str>) {
            let state: Value = serde_json::from_str(&self.inner.call_json("{\"kind\":\"state\"}"))
                .expect("state witness JSON");
            let stamp = state["value"]["state"]["stamp"].clone();
            assert!(
                stamp.is_object(),
                "fixture must have an admitted real Session"
            );
            let request = json!({ "kind": "snapshot", "stamp": stamp, "max_bytes": 65536 });
            let snapshot: Value = serde_json::from_str(&self.inner.call_json(&request.to_string()))
                .expect("snapshot witness JSON");
            assert_eq!(snapshot["status"], "ok");
            let release =
                json!({ "kind": "release_snapshot", "handle": snapshot["value"]["handle"] });
            let released: Value = serde_json::from_str(&self.inner.call_json(&release.to_string()))
                .expect("release witness JSON");
            assert_eq!(released["status"], "ok");
            let events: Value =
                serde_json::from_str(&self.inner.call_json("{\"kind\":\"events\"}"))
                    .expect("event witness JSON");
            let witness = json!({ "phase": phase, "state": state, "snapshot": snapshot,
                "events": events, "completed_response": response, "native_resources_before_trap": self.inner.own_resource_counts() });
            let text = witness.to_string();
            assert!(text.len() <= 131072, "bounded fixed fixture witness");
            recordFailureWitness(&text);
        }
    }
}
