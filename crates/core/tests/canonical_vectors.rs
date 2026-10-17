// SPDX-License-Identifier: MIT OR Apache-2.0
use klenwriter_editor_core::json::canonical_value;
use serde_json::Value;

#[test]
fn fixed_canonical_vectors_preserve_scalar_order_and_number_representation() {
    let vectors: Value = serde_json::from_str(include_str!("canonical-v1.json")).unwrap();
    for case in vectors["cases"].as_array().unwrap() {
        let parsed = serde_json::from_str::<Value>(case["input"].as_str().unwrap());
        if case["refuse"].as_bool() == Some(true) {
            assert!(parsed.is_err(), "{}", case["id"]);
        } else {
            assert_eq!(
                canonical_value(&parsed.unwrap()),
                case["expected"].as_str().unwrap(),
                "{}",
                case["id"]
            );
        }
    }
}
