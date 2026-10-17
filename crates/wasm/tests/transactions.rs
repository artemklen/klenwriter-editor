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
    let repeated = &groups["attributes_marks_spans"]["repeated_metadata"];
    assert_eq!(repeated["commits"], 512);
    assert_eq!(repeated["canonical_bytes"], 159);
    assert_eq!(repeated["work_cap_bytes"], 32768);
    assert_eq!(repeated["journal_entry_limit"], 1);
    for property in [
        "canonical_restored",
        "all_changed",
        "work_and_retained_bytes_stable",
        "identities_preserved",
    ] {
        assert_eq!(repeated[property], true);
    }
    assert_eq!(
        groups["fragments_local_references"]["local_reference_text"],
        "Z"
    );
}
