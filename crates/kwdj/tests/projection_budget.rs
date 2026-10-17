// SPDX-License-Identifier: MIT OR Apache-2.0
use klenwriter_editor_kwdj as profile;
#[path = "support/projection_budget_cases.rs"]
mod cases;
#[test]
fn pathological_expansion_is_refused() {
    cases::pathological_expansion_is_refused();
}
#[test]
fn tight_budgets_are_atomic() {
    cases::tight_budgets_are_atomic();
}
#[test]
fn storage_survives_refusal() {
    cases::storage_survives_refusal();
}
#[test]
fn host_cannot_raise_ceilings() {
    cases::host_cannot_raise_ceilings();
}
#[test]
fn ordinary_bytes_and_empty_lines() {
    cases::ordinary_bytes_and_empty_lines();
}

#[test]
fn spoilers_captions_and_tables_retain_bytes() {
    cases::spoilers_captions_and_tables_retain_bytes();
}
