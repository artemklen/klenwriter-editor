// SPDX-License-Identifier: MIT OR Apache-2.0
//! Frozen independent phase5 compiler literals; no execution oracle is inferred.
use editor_core::transaction::{WorkLimits, WorkMeter};
use klenwriter_editor_registry::{CompilerLimits, ExtensionDescriptor, compile_json};
use std::collections::BTreeMap;
#[test]
fn independent_recipe_compiler_literals_28() {
    let corpus: serde_json::Value = serde_json::from_str(include_str!(
        "../../../contracts/extensions/v1/recipe-vectors.json"
    ))
    .unwrap();
    let mut digests = BTreeMap::new();
    for case in corpus["compiler_cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let mandatory: Vec<ExtensionDescriptor> =
            serde_json::from_value(case["mandatory_registrations"].clone()).unwrap();
        let mut limits = CompilerLimits::default();
        if let Some(units) = case
            .get("compile_budget")
            .and_then(|v| v.get("work_units"))
            .and_then(serde_json::Value::as_u64)
        {
            limits.work_units = units;
        }
        let result = compile_json(
            case["input_json"].as_str().unwrap().as_bytes(),
            &mandatory,
            limits,
            &mut WorkMeter::new(WorkLimits::default()),
        );
        let expected = &case["expected"];
        match (expected["outcome"].as_str().unwrap(), result) {
            ("accepted", Ok(registry)) => {
                if let Some(catalog) = expected.get("catalog") {
                    let actual: Vec<_> =
                        registry.catalog_ids().iter().map(String::as_str).collect();
                    let literal: Vec<_> = catalog
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|s| s.as_str().unwrap())
                        .collect();
                    assert_eq!(actual, literal, "{id}");
                }
                if let Some(other) = expected.get("digest_same_as") {
                    assert_eq!(
                        &registry.digest(),
                        digests.get(other.as_str().unwrap()).unwrap(),
                        "{id}"
                    );
                }
                if let Some(other) = expected.get("digest_differs_from") {
                    assert_ne!(
                        &registry.digest(),
                        digests.get(other.as_str().unwrap()).unwrap(),
                        "{id}"
                    );
                }
                digests.insert(id.to_owned(), registry.digest());
            }
            ("refused", Err(error)) => assert_eq!(
                error.code.as_str(),
                expected["code"].as_str().unwrap(),
                "{id}: {error:?}"
            ),
            (want, Err(error)) => panic!("{id}: expected {want}, got {error:?}"),
            (want, Ok(_)) => panic!("{id}: expected {want}, got accepted"),
        }
    }
    assert_eq!(corpus["compiler_cases"].as_array().unwrap().len(), 28);
    println!("REGISTRY recipe compiler literals PASS: 28");
}
