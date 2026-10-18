// SPDX-License-Identifier: MIT OR Apache-2.0
//! Frozen transport literals only; validity of command schemas is tested separately.
mod support;
use klenwriter_editor_bridge::recipes::decode_recipe_payload;

#[test]
fn eleven_independent_recipe_wire_literals_preserve_exact_numbers_and_bounds() {
    let bridge = support::bridge(vec![]);
    let session = bridge.session().unwrap();
    let key = session.key();
    let token = session.root(key).unwrap().to_token();
    let packet: serde_json::Value = serde_json::from_str(include_str!(
        "../../../contracts/extensions/v1/recipe-vectors.json"
    ))
    .unwrap();
    let cases = packet["wire_cases"].as_array().unwrap();
    assert_eq!(cases.len(), 11);
    for case in cases {
        let id = case["id"].as_str().unwrap();
        let mut payload = case["payload_json"]
            .as_str()
            .unwrap()
            .replace("$node.doc", &token);
        if let Some(count) = case["append_ascii_spaces"].as_u64() {
            payload.push_str(&" ".repeat(count as usize));
        }
        if let Some(bytes) = case["expected_total_utf8_bytes"].as_u64() {
            assert_eq!(payload.len() as u64, bytes, "{id}");
        }
        let decoded = decode_recipe_payload("org.example.transport/recipe", &payload, key);
        match (case["expected"]["outcome"].as_str().unwrap(), decoded) {
            ("accepted", Ok(intent)) => {
                if id.starts_with("RW001") {
                    let editor_core::document::Attribute::Number(number) = &intent.values["score"]
                    else {
                        panic!("number representation changed");
                    };
                    assert_eq!(number.as_u64(), Some(u64::MAX));
                }
                if id.starts_with("RW003") {
                    let editor_core::document::Attribute::Number(number) = &intent.values["score"]
                    else {
                        panic!("number representation changed");
                    };
                    assert!(!number.is_i64() && !number.is_u64());
                    assert_eq!(number.to_string(), "1.0");
                }
            }
            ("refused", Err(error)) => assert_eq!(
                error.code,
                case["expected"]["code"].as_str().unwrap(),
                "{id}"
            ),
            (_, actual) => panic!("{id}: {actual:?}"),
        }
    }
}
