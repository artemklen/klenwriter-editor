// SPDX-License-Identifier: MIT OR Apache-2.0
use editor_kwdj_sdk as kwdj_sdk;
#[path = "../../kwdj-sdk/tests/support/typography_witness.rs"]
mod witness;
#[cfg_attr(target_arch="wasm32",wasm_bindgen::prelude::wasm_bindgen(js_name=observeTypography))]
pub fn observe_typography() -> String {
    witness::run().to_string()
}
