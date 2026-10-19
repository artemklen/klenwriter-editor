// SPDX-License-Identifier: MIT OR Apache-2.0
#[path = "../examples/support/command_observer.rs"]
mod observer;
#[test]
fn actual_kwdj_commands_match_independent_literal_contract() {
    let report = observer::observe();
    assert_eq!(report["status"], "passed", "{report:#}");
    assert_eq!(report["literal_passed"], 24);
    assert_eq!(report["generated"]["status"], "passed");
    assert_eq!(report["future_typing"]["status"], "passed");
    assert_eq!(report["structural"]["status"], "passed");
    assert_eq!(report["structural"]["group_total"], 8);
    assert_eq!(report["inline"]["status"], "passed");
    assert_eq!(report["backward"]["status"], "passed");
    assert_eq!(report["inline"]["groups"].as_object().unwrap().len(), 8);
}
