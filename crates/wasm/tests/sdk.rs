// SPDX-License-Identifier: MIT OR Apache-2.0
#[path = "../examples/support/sdk_observer.rs"]
mod observer;
#[test]
fn actual_public_sdk_bridge_matches_independent_native_wasm_literals() {
    let report = observer::observe();
    assert_eq!(report["status"], "passed", "{report:#}");
    assert_eq!(report["commands"]["literal_total"], 16);
    assert_eq!(report["commands"]["catalog_total"], 15);
    assert_eq!(report["commands"]["history_replays"], 30);
    assert_eq!(report["snapshots_resources"]["snapshot_cap"], 32);
    assert_eq!(report["snapshots_resources"]["repeated_cycles"], 48);
}
