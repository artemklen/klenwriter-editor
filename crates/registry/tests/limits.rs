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

#[test]
fn compiler_relative_nonzero_caps_cover_all_direct_shared_charges() {
    let cases: serde_json::Value = serde_json::from_str(include_str!(
        "../../../contracts/extensions/v1/compiler-vectors.json"
    ))
    .unwrap();
    let input = cases["cases"][0]["input_json"].as_str().unwrap();
    let dto: RegistryDescriptor = serde_json::from_str(input).unwrap();
    for typed in [false, true] {
        let mut baseline = meter();
        baseline.charge_units(101).unwrap();
        baseline.charge_bytes(203).unwrap();
        let start = baseline.usage();
        let registry = if typed {
            compile_descriptor(&dto, &[], CompilerLimits::default(), &mut baseline)
        } else {
            klenwriter_editor_registry::compile_json(
                input.as_bytes(),
                &[],
                CompilerLimits::default(),
                &mut baseline,
            )
        }
        .unwrap();
        let exact = registry.usage().work;
        assert_eq!(exact.units, baseline.usage().units - start.units);
        assert_eq!(exact.bytes, baseline.usage().bytes - start.bytes);
        for (units, bytes, accepted) in [
            (exact.units, exact.bytes, true),
            (exact.units - 1, exact.bytes, false),
            (exact.units, exact.bytes - 1, false),
            (100, exact.bytes, false),
        ] {
            let mut work = meter();
            work.charge_units(101).unwrap();
            work.charge_bytes(203).unwrap();
            let start = work.usage();
            let outer = work.limits();
            let limits = CompilerLimits {
                work_units: units,
                owned_bytes: bytes,
                ..CompilerLimits::default()
            };
            let result = if typed {
                compile_descriptor(&dto, &[], limits, &mut work)
            } else {
                klenwriter_editor_registry::compile_json(input.as_bytes(), &[], limits, &mut work)
            };
            assert_eq!(
                result.is_ok(),
                accepted,
                "typed={typed},units={units},bytes={bytes}"
            );
            let spent = work.usage();
            assert!(spent.units - start.units <= units);
            assert!(spent.bytes - start.bytes <= bytes);
            assert_eq!(work.limits(), outer);
            if let Err(e) = result {
                assert_eq!(e.code, RegistryErrorCode::ResourceLimitExceeded);
                assert_eq!(e.usage.work.units, spent.units - start.units);
                assert_eq!(e.usage.work.bytes, spent.bytes - start.bytes);
            }
        }
    }
}
#[test]
fn unordered_enum_reorder_has_identical_digest_without_rewriting_values() {
    let cases: serde_json::Value = serde_json::from_str(include_str!(
        "../../../contracts/extensions/v1/compiler-vectors.json"
    ))
    .unwrap();
    let mut dto: RegistryDescriptor =
        serde_json::from_str(cases["cases"][0]["input_json"].as_str().unwrap()).unwrap();
    dto.extensions[0].nodes[0].attrs.insert(
        "color".into(),
        klenwriter_editor_registry::AttributeField {
            required: false,
            value: klenwriter_editor_registry::AttributeSchema::Enum {
                values: vec!["blue".into(), "amber".into()],
            },
        },
    );
    let one = compile_descriptor(&dto, &[], CompilerLimits::default(), &mut meter()).unwrap();
    if let klenwriter_editor_registry::AttributeSchema::Enum { values } = &mut dto.extensions[0]
        .nodes[0]
        .attrs
        .get_mut("color")
        .unwrap()
        .value
    {
        values.reverse();
    }
    let two = compile_descriptor(&dto, &[], CompilerLimits::default(), &mut meter()).unwrap();
    assert_eq!(one.digest(), two.digest());
}

#[test]
fn native_attribute_values_are_preflighted_before_unknown_key_diagnostic_copy() {
    let policy = klenwriter_editor_registry::CompiledAttributes::compile(
        &std::collections::BTreeMap::new(),
        CompilerLimits::default(),
        &mut meter(),
    )
    .unwrap();
    let mut attrs = editor_core::document::Attributes::new();
    attrs.insert("x".repeat(100_000), editor_core::document::Attribute::Null);
    let mut work = WorkMeter::new(WorkLimits {
        units: 100,
        bytes: 0,
    });
    let error = policy
        .validate(&attrs, "/arguments/values", &mut work)
        .unwrap_err();
    assert_eq!(error.code, RegistryErrorCode::ResourceLimitExceeded);
    assert_eq!(error.path, "/arguments/values");
    assert_eq!(work.usage().bytes, 0);
    assert_eq!(attrs.len(), 1);
}
