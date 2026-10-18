// SPDX-License-Identifier: MIT OR Apache-2.0
//! Executes independently authored preimplementation literals unchanged.
use editor_core::document::{Attribute, Attributes};
use editor_core::transaction::{WorkLimits, WorkMeter};
use klenwriter_editor_registry::{
    AttributeField, CompiledAttributes, CompiledGrammar, CompilerLimits, Grammar,
    RegistryDiagnostic, compile_json,
};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
fn meter(units: Option<u64>) -> WorkMeter {
    WorkMeter::new(WorkLimits {
        units: units.unwrap_or(1_000_000),
        ..WorkLimits::default()
    })
}
fn limits(value: Option<&Value>) -> CompilerLimits {
    let mut l = CompilerLimits::default();
    if let Some(v) = value {
        for (k, n) in v.as_object().unwrap() {
            let n = n.as_u64().unwrap();
            match k.as_str() {
                "descriptor_bytes" => l.descriptor_bytes = n,
                "work_units" => l.work_units = n,
                "owned_bytes" => l.owned_bytes = n,
                "states" => l.states = n,
                "transitions" => l.transitions = n,
                _ => panic!("unknown literal host reduction {k}"),
            }
        }
    }
    l
}
fn expected<T>(id: &str, result: Result<T, RegistryDiagnostic>, e: &Value) -> Option<T> {
    match (e["outcome"].as_str().unwrap(), result) {
        ("accepted", Ok(v)) => Some(v),
        ("refused", Err(error)) => {
            assert_eq!(
                error.code.as_str(),
                e["code"].as_str().unwrap(),
                "{id}: {error:?}"
            );
            None
        }
        (expected, Err(error)) => panic!("{id}: expected {expected}, got {error:?}"),
        (expected, Ok(_)) => panic!("{id}: expected {expected}, got accepted"),
    }
}
#[test]
fn independent_compiler_literals_58() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../contracts/extensions/v1/compiler-vectors.json"
    ))
    .unwrap();
    let mut digests = BTreeMap::new();
    for c in corpus["cases"].as_array().unwrap() {
        let id = c["id"].as_str().unwrap();
        let result = compile_json(
            c["input_json"].as_str().unwrap().as_bytes(),
            &[],
            limits(c.get("compile_budget")),
            &mut meter(None),
        );
        if let Some(registry) = expected(id, result, &c["expected"]) {
            let e = &c["expected"];
            if let Some(order) = e.get("extension_order") {
                let actual: Vec<_> = registry.extension_order().iter().map(|e| e.id()).collect();
                let want: Vec<_> = order
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|e| e.as_str().unwrap())
                    .collect();
                assert_eq!(actual, want, "{id}");
            }
            if let Some(other) = e.get("digest_same_as") {
                assert_eq!(
                    &registry.digest(),
                    digests.get(other.as_str().unwrap()).unwrap(),
                    "{id}"
                );
            }
            if let Some(other) = e.get("digest_differs_from") {
                assert_ne!(
                    &registry.digest(),
                    digests.get(other.as_str().unwrap()).unwrap(),
                    "{id}"
                );
            }
            digests.insert(id.to_owned(), registry.digest());
        }
    }
    assert_eq!(corpus["cases"].as_array().unwrap().len(), 58);
    println!("REGISTRY literal compiler PASS: 58");
}
fn attr(v: &Value) -> Attribute {
    match v {
        Value::Null => Attribute::Null,
        Value::Bool(v) => Attribute::Boolean(*v),
        Value::Number(v) => Attribute::Number(v.clone()),
        Value::String(v) => Attribute::String(v.clone()),
        Value::Array(v) => Attribute::List(v.iter().map(attr).collect()),
        Value::Object(v) => {
            Attribute::Object(v.iter().map(|(k, v)| (k.clone(), attr(v))).collect())
        }
    }
}
#[test]
fn independent_attribute_literals_60() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../contracts/extensions/v1/attribute-vectors.json"
    ))
    .unwrap();
    for c in corpus["cases"].as_array().unwrap() {
        let id = c["id"].as_str().unwrap();
        let fields: BTreeMap<String, AttributeField> =
            serde_json::from_value(c["fields"].clone()).unwrap();
        let rule =
            CompiledAttributes::compile(&fields, CompilerLimits::default(), &mut meter(None))
                .unwrap();
        let value: Value = serde_json::from_str(c["attrs_json"].as_str().unwrap()).unwrap();
        let attrs: Attributes = value
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.clone(), attr(v)))
            .collect();
        if expected(
            id,
            rule.validate(&attrs, "", &mut meter(None)),
            &c["expected"],
        )
        .is_some()
        {
            assert_eq!(
                serde_json::to_string(&value).unwrap(),
                c["expected"]["canonical_json"].as_str().unwrap(),
                "{id}"
            );
        }
    }
    assert_eq!(corpus["cases"].as_array().unwrap().len(), 60);
    println!("REGISTRY literal attrs PASS: 60");
}
#[test]
fn independent_grammar_literals_40() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../contracts/extensions/v1/grammar-vectors.json"
    ))
    .unwrap();
    let known: BTreeSet<String> = serde_json::from_value(corpus["known_type_ids"].clone()).unwrap();
    let mut matched = 0;
    for c in corpus["cases"].as_array().unwrap() {
        let id = c["id"].as_str().unwrap();
        let g: Grammar = serde_json::from_value(c["grammar"].clone()).unwrap();
        if let Some(compiled) = expected(
            id,
            CompiledGrammar::compile(
                &g,
                &known,
                limits(c.get("compile_budget")),
                &mut meter(None),
            ),
            &c["expected"]["compile"],
        ) {
            assert!(!c["expected"]["match"].is_null(), "{id}");
            let labels: Vec<_> = c["labels"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap())
                .collect();
            let units = c
                .get("match_budget")
                .and_then(|v| v.get("work_units"))
                .and_then(Value::as_u64);
            expected(
                id,
                compiled.validate_labels(labels, "", &mut meter(units)),
                &c["expected"]["match"],
            );
            matched += 1;
        } else {
            assert!(
                c["expected"]["match"].is_null(),
                "{id}: refused compile is not a match"
            );
        }
    }
    assert_eq!(corpus["cases"].as_array().unwrap().len(), 40);
    println!("REGISTRY literal grammar PASS: 40 compile, {matched} match attempts");
}
