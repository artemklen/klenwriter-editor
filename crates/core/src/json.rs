// SPDX-License-Identifier: MIT OR Apache-2.0
//! Deterministic JSON and JSON-Pointer primitives, without a document schema.
use serde_json::Value;

pub fn key_path(parent: &str, key: &str) -> String {
    format!("{parent}/{}", pointer_escape(key))
}

pub fn index_path(parent: &str, index: usize) -> String {
    format!("{parent}/{index}")
}

pub fn pointer_escape(value: &str) -> String {
    value.replace('~', "~0").replace('/', "~1")
}

pub fn canonical_value(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => serde_json::to_string(value).expect("string serialization"),
        Value::Array(values) => {
            let body = values
                .iter()
                .map(canonical_value)
                .collect::<Vec<_>>()
                .join(",");
            format!("[{body}]")
        }
        Value::Object(values) => {
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort_by(|left, right| left.chars().cmp(right.chars()));
            let body = keys
                .into_iter()
                .map(|key| {
                    let encoded_key = serde_json::to_string(key).expect("key serialization");
                    format!("{encoded_key}:{}", canonical_value(&values[key]))
                })
                .collect::<Vec<_>>()
                .join(",");
            format!("{{{body}}}")
        }
    }
}
