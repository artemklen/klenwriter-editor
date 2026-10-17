// SPDX-License-Identifier: MIT OR Apache-2.0
#[path = "../examples/support/transaction_observer.rs"]
mod transaction_observer;
#[test]
fn real_kwdj_dispatch_preserves_literal_outputs_and_refusal_state() {
    let report: serde_json::Value = serde_json::from_str(&transaction_observer::observe()).unwrap();
    assert_eq!(report["task"], "OSR-34");
    let groups = report["groups"].as_object().unwrap();
    assert_eq!(groups.len(), 5);
    assert!(groups.values().all(|g| g["status"] == "passed"));
    assert_eq!(
        groups["atomic_refusals"]["cases"].as_array().unwrap().len(),
        11
    );
    assert_eq!(groups["normalization_noops"]["crlf_mapping_after"], 2);
    assert_eq!(
        groups["fragments_local_references"]["local_reference_text"],
        "Z"
    );
}
