// SPDX-License-Identifier: MIT OR Apache-2.0
#[path = "../examples/support/command_structural.rs"]
mod observer;

#[test]
fn actual_kwdj_structural_commands_preserve_payload_and_atomicity() {
    let report = observer::observe();
    assert_eq!(report["status"], "passed", "{report:#}");
    assert_eq!(report["group_total"], 8);
}
