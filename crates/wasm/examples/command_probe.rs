// SPDX-License-Identifier: MIT OR Apache-2.0
#[path = "support/command_observer.rs"]
mod observer;
#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen(js_name = observeCommands))]
pub fn observe_commands() -> String {
    observer::observe().to_string()
}
