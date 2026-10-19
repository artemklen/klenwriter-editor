// SPDX-License-Identifier: MIT OR Apache-2.0
#[path = "../examples/support/composition_observer.rs"]
mod observer;
#[test]
fn frozen_composition_literals_through_public_native_sdk2() {
    let report = observer::observe();
    assert_eq!(report["cases"].as_array().unwrap().len(), 30);
    assert_eq!(report["status"], "passed", "{report}");
}
