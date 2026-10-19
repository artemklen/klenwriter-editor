// SPDX-License-Identifier: MIT OR Apache-2.0
#[path = "../examples/support/selection_observer.rs"]
mod observer;
#[test]
fn frozen_selection_literals_through_real_native_sdk2() {
    let report = observer::observe();
    assert_eq!(report["cases"].as_array().unwrap().len(), 24);
}
