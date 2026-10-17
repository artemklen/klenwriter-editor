// SPDX-License-Identifier: MIT OR Apache-2.0
//! Test-only target parity on trusted bounded fixture strings.
//! This module is excluded from distribution; the actual byte admission ABI is
//! tested separately through the production kwdj*V1 exports.
#[path = "support/corpus_observer.rs"]
mod corpus_observer;
#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen(js_name = observeCorpusCase))]
pub fn observe_corpus_case(request: &str) -> String {
    corpus_observer::observe(request)
}
