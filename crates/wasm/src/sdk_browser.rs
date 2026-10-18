// SPDX-License-Identifier: MIT OR Apache-2.0
//! Packaged WASM exports, with explicit class ownership and no JS callbacks.

use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = sdkManifestV1)]
pub fn manifest() -> String {
    serde_json::to_string(&crate::sdk::manifest()).expect("scalar manifest serializes")
}

#[wasm_bindgen(js_name = sdkResourceCountsV1)]
pub fn resource_counts() -> String {
    serde_json::to_string(&crate::sdk::resource_counts()).expect("scalar resource counts serialize")
}

#[wasm_bindgen]
pub struct SdkSessionV1 {
    inner: crate::sdk::BridgeSession,
}

#[wasm_bindgen]
impl SdkSessionV1 {
    #[wasm_bindgen(constructor)]
    pub fn new(input: &[u8], options_json: &str) -> Self {
        Self {
            inner: crate::sdk::BridgeSession::new(input, options_json),
        }
    }

    pub fn initialization(&self) -> String {
        serde_json::to_string(&self.inner.initialization())
            .expect("typed initial result serializes")
    }

    pub fn call(&mut self, request_json: &str) -> String {
        self.inner.call_json(request_json)
    }

    pub fn destroy(&mut self) {
        self.inner.destroy();
    }
}
