// SPDX-License-Identifier: MIT OR Apache-2.0
//! Test-only native oracle transport. Never imported by a runtime package.
use klenwriter_editor_core::json::canonical_value;
use serde_json::{Value, json};

fn main() {
    let vectors: Value = serde_json::from_str(include_str!("../tests/canonical-v1.json")).unwrap();
    let results: Vec<_> = vectors["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(
            |case| match serde_json::from_str::<Value>(case["input"].as_str().unwrap()) {
                Ok(value) => json!({"id":case["id"], "canonical":canonical_value(&value)}),
                Err(_) => json!({"id":case["id"], "refused":true}),
            },
        )
        .collect();
    println!("{}", json!({"rule":vectors["rule"], "cases":results}));
}
