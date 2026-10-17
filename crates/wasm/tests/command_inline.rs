// SPDX-License-Identifier: MIT OR Apache-2.0
#[path = "../examples/support/command_inline.rs"]
mod command_inline;

#[test]
fn actual_kwdj_inline_command_outputs_and_refusals_match_literal_expectations() {
    let result = command_inline::observe();
    assert_eq!(result["status"], "passed");
    assert_eq!(result["groups"].as_object().unwrap().len(), 8);
    assert_eq!(
        result["groups"]["atomic_link_refusals"]["typed_refusals"]
            .as_array()
            .unwrap()
            .len(),
        8
    );
    assert_eq!(
        result["groups"]["mark_policy"]["formatting_kinds"]
            .as_array()
            .unwrap()
            .len(),
        8
    );
}
