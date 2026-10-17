//! Test-only compiled-WASM regression runner; never part of a distributed package.
use editor_kwdj as profile;
#[path = "../../kwdj/tests/support/projection_budget_cases.rs"]
mod cases;

#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen(js_name = runProjectionBudgetCases))]
pub fn run_projection_budget_cases() -> u32 {
    cases::run_all()
}
