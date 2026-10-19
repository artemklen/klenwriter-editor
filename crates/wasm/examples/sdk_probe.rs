// SPDX-License-Identifier: MIT OR Apache-2.0
#[path = "support/sdk_observer.rs"]
mod observer;
#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen(js_name = observeSdk))]
pub fn observe_sdk() -> String {
    observer::observe().to_string()
}
#[path = "support/selection_observer.rs"]
mod selection;
#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen(js_name = observeSelection))]
pub fn observe_selection() -> String {
    selection::observe().to_string()
}
