// SPDX-License-Identifier: MIT OR Apache-2.0
use editor_core::transaction::{WorkLimits, WorkMeter};
use klenwriter_editor_registry::{
    CompiledGrammar, CompilerLimits, Grammar, JsonLimits, RegistryDescriptor, RegistryErrorCode,
    compile_descriptor, preflight_json,
};
use std::collections::BTreeSet;
fn meter() -> WorkMeter {
    WorkMeter::new(WorkLimits::default())
}
#[test]
fn duplicate_escaped_keys_refuse_before_owned_parse() {
    let input = br#"{"a":0,"\u0061":1}"#;
    let mut work = meter();
    let error = preflight_json(
        input,
        JsonLimits {
            bytes: 1024,
            depth: 128,
            values: 1024,
        },
        &mut work,
    )
    .unwrap_err();
    assert_eq!(error.code, RegistryErrorCode::DuplicateJsonKey);
    assert_eq!(error.path, "/a");
    assert_eq!(error.usage.work, work.usage());
}
#[test]
fn public_json_depth_cannot_be_raised_to_overflow_rust_stack() {
    let input = format!("{}0{}", "[".repeat(1000), "]".repeat(1000));
    let mut work = meter();
    let error = preflight_json(
        input.as_bytes(),
        JsonLimits {
            bytes: u64::MAX,
            depth: u64::MAX,
            values: u64::MAX,
        },
        &mut work,
    )
    .unwrap_err();
    assert_eq!(error.code, RegistryErrorCode::ResourceLimitExceeded);
    assert_eq!(error.usage.work, work.usage());
}
#[test]
fn compact_projection_refuses_before_copying_label_set() {
    let known: BTreeSet<_> = ["org.test/text".to_owned()].into_iter().collect();
    let rule = Grammar::Repeat {
        item: Box::new(Grammar::Type {
            id: "org.test/text".into(),
        }),
        min: 0,
        max: 1_000_000,
    };
    let mut work = meter();
    let error = CompiledGrammar::compile(
        &rule,
        &known,
        CompilerLimits {
            states: 0,
            ..CompilerLimits::default()
        },
        &mut work,
    )
    .unwrap_err();
    assert_eq!(error.code, RegistryErrorCode::ResourceLimitExceeded);
    assert_eq!(work.usage().bytes, 0);
}
#[test]
fn projected_nested_repeat_overflow_refuses_without_allocation() {
    let known: BTreeSet<_> = ["org.test/text".to_owned()].into_iter().collect();
    let mut rule = Grammar::Type {
        id: "org.test/text".into(),
    };
    for _ in 0..4 {
        rule = Grammar::Repeat {
            item: Box::new(Grammar::Sequence { items: vec![rule] }),
            min: 0,
            max: u64::MAX,
        };
    }
    let mut work = meter();
    let error =
        CompiledGrammar::compile(&rule, &known, CompilerLimits::default(), &mut work).unwrap_err();
    assert_eq!(error.code, RegistryErrorCode::ResourceLimitExceeded);
    assert_eq!(work.usage().bytes, 0);
}
#[test]
fn typed_descriptor_huge_string_refuses_before_serde_scan_or_copy() {
    let cases: serde_json::Value = serde_json::from_str(include_str!(
        "../../../contracts/extensions/v1/compiler-vectors.json"
    ))
    .unwrap();
    let mut dto: RegistryDescriptor =
        serde_json::from_str(cases["cases"][0]["input_json"].as_str().unwrap()).unwrap();
    dto.profile.id = "x".repeat(100_000);
    let mut work = meter();
    let error = compile_descriptor(
        &dto,
        &[],
        CompilerLimits {
            descriptor_bytes: 4096,
            ..CompilerLimits::default()
        },
        &mut work,
    )
    .unwrap_err();
    assert_eq!(error.code, RegistryErrorCode::ResourceLimitExceeded);
    assert!(work.usage().units < 100);
    assert_eq!(work.usage().bytes, 0);
    assert_eq!(error.usage.work, work.usage());
}
