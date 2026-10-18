// SPDX-License-Identifier: MIT OR Apache-2.0
#[path = "support/delta_observer.rs"]
mod observer;
#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen(js_name = observeDeltas))]
pub fn observe_deltas() -> String {
    observer::observe().to_string()
}
