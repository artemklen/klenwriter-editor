//! Test-only compiled-WASM runner, outside the distributed npm module.
use editor_kwdj as profile;
#[path = "../../kwdj/tests/support/admission_budget_cases.rs"]
mod cases;

#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen(js_name = runAdmissionBudgetCases))]
pub fn run_admission_budget_cases() -> u32 {
    cases::run_all()
}
