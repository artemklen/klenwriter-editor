// SPDX-License-Identifier: MIT OR Apache-2.0
#[path = "support/history_observer.rs"]
mod observer;
#[cfg_attr(target_arch="wasm32",wasm_bindgen::prelude::wasm_bindgen(js_name=observeHistory))]
pub fn observe_history() -> String {
    observer::observe().to_string()
}
