// SPDX-License-Identifier: MIT OR Apache-2.0
//! The composition root exercises the actual Session<KwdjProfile>, not a mock
//! profile or the independent M0 JavaScript operation interpreter.
#[path = "../examples/support/session_observer.rs"]
mod session_observer;

#[test]
fn real_profile_session_witness_checks_literal_coordinates_and_lifecycle() {
    let report: serde_json::Value = serde_json::from_str(&session_observer::observe()).unwrap();
    assert_eq!(report["task"], "OSR-33");
    let groups = &report["groups"];
    assert_eq!(groups.as_object().unwrap().len(), 7);
    assert!(
        groups
            .as_object()
            .unwrap()
            .values()
            .all(|group| group["status"] == "passed")
    );
    assert_eq!(groups["snapshots"]["cases"].as_array().unwrap().len(), 3);
    assert_eq!(
        groups["binding_refusals"]["cases"]
            .as_array()
            .unwrap()
            .len(),
        10
    );
    assert_eq!(
        groups["text_drafts"]["split_text"],
        serde_json::json!(["ab", "Яz"])
    );
    assert_eq!(groups["lifecycle_selection"]["readonly_scalar_focus"], 6);
    assert_eq!(groups["structural_drafts"]["gap_before"], 2);
    assert_eq!(groups["retained_maps"]["composed_offset"], 3);
    assert_eq!(groups["retained_maps"]["evicted_chain"], "stale");
    assert_eq!(report["deferred"]["user_history"], "OSR-36");
}
