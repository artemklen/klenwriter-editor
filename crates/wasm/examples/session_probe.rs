// SPDX-License-Identifier: MIT OR Apache-2.0
//! Test-only WASM composition witness; excluded from the distributable SDK ABI.
#[path = "support/session_observer.rs"]
mod session_observer;

#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen(js_name = observeSessionFoundation))]
pub fn observe_session_foundation() -> String {
    session_observer::observe()
}
