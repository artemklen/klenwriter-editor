// SPDX-License-Identifier: MIT OR Apache-2.0
//! Test-only module; never installed as a public transaction ABI.
#[path = "support/transaction_observer.rs"]
mod transaction_observer;
#[cfg_attr(target_arch="wasm32",wasm_bindgen::prelude::wasm_bindgen(js_name=observeTransactions))]
pub fn observe_transactions() -> String {
    transaction_observer::observe()
}
