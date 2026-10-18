// SPDX-License-Identifier: MIT OR Apache-2.0
mod support;

use std::path::Path;

use editor_core::profile::{AdmissionMode, FrozenProfile, ProfileBinding};
use editor_core::transaction::{WorkLimits, WorkMeter};
use editor_registry::CompilerLimits;
use klenwriter_editor_notes::{NotesLimits, NotesProfile, PARAGRAPH};
use serde_json::{Value, json};

#[test]
fn all_frozen_notes_codec_literals() {
    let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../contracts/notes/v1");
    let vectors: Value =
        serde_json::from_slice(&std::fs::read(directory.join("vectors.json")).unwrap()).unwrap();
    let d0 = support::profile(false);
    let d1 = support::profile(true);
    let mut count = 0;
    for case in vectors["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let profile = if case["registry"] == "D0" { &d0 } else { &d1 };
        let mode = if case["mode"] == "strict" {
            AdmissionMode::Strict
        } else {
            AdmissionMode::Import
        };
        let input = std::fs::read(directory.join(case["input"].as_str().unwrap())).unwrap();
        let original = input.clone();
        let result = profile.admit_bytes(profile.binding(), &input, mode);
        if case["expected"]["kind"] == "accepted" {
            let admitted = result.unwrap_or_else(|error| panic!("{id}: {error}"));
            let expected =
                std::fs::read(directory.join(case["expected"]["canonical"].as_str().unwrap()))
                    .unwrap();
            assert_eq!(
                profile.canonical(&admitted),
                expected,
                "{id}: exact canonical literal"
            );
            let exported = profile
                .admit_snapshot(&profile.context(&admitted), admitted.document())
                .unwrap();
            assert_eq!(
                profile.canonical(&exported),
                expected,
                "{id}: explicit snapshot fixed point"
            );
            let strict = profile
                .admit_bytes(profile.binding(), &expected, AdmissionMode::Strict)
                .unwrap();
            assert_eq!(
                strict.document(),
                admitted.document(),
                "{id}: complete semantic tree"
            );
        } else {
            let error = match result {
                Err(error) => error,
                Ok(_) => panic!("{id}: unexpectedly admitted"),
            };
            assert_eq!(
                error.as_str(),
                case["expected"]["code"].as_str().unwrap(),
                "{id}: code"
            );
            assert_eq!(
                error.path,
                case["expected"]["path"].as_str().unwrap(),
                "{id}: exact pointer"
            );
        }
        assert_eq!(input, original, "{id}: caller's original bytes retained");
        count += 1;
    }
    assert_eq!(count, 53);
}

#[test]
fn unknown_binding_refuses_before_invalid_document_decode() {
    let profile = support::profile(false);
    let unknown = ProfileBinding::new(
        "org.example.other",
        "1.0.0",
        "org.example.other/json",
        1,
        &[],
    )
    .unwrap();
    let error = match profile.admit_bytes(&unknown, b"not JSON", AdmissionMode::Import) {
        Err(error) => error,
        Ok(_) => panic!("mismatched binding admitted"),
    };
    assert_eq!(error.as_str(), "notes.binding_mismatch");
}

#[test]
fn raw_registry_constructor_preserves_duplicate_key_refusal() {
    let descriptor = serde_json::to_string(&support::descriptor(false)).unwrap();
    let duplicate = descriptor.replacen('{', "{\"format\":\"editor-registry/1\",", 1);
    let result = NotesProfile::compile_json(
        duplicate.as_bytes(),
        &[PARAGRAPH.into()],
        NotesLimits::default(),
        CompilerLimits::default(),
        &mut WorkMeter::new(WorkLimits::default()),
    );
    let error = match result {
        Err(error) => error,
        Ok(_) => panic!("duplicate registry key admitted"),
    };
    assert_eq!(error.as_str(), "registry.duplicate_json_key");
}

#[test]
fn raw_and_typed_registry_paths_have_identical_binding_and_digest() {
    let descriptor = support::descriptor(true);
    let bytes = serde_json::to_vec(&descriptor).unwrap();
    let raw = NotesProfile::compile_json(
        &bytes,
        &[PARAGRAPH.into(), "org.example.notes/callout".into()],
        NotesLimits::default(),
        CompilerLimits::default(),
        &mut WorkMeter::new(WorkLimits::default()),
    )
    .unwrap();
    let typed = support::profile(true);
    assert_eq!(raw.binding(), typed.binding());
    assert_eq!(raw.registry().digest(), typed.registry().digest());
}

#[test]
fn arbitrary_runtime_block_uses_registry_authority_without_notes_allowlist() {
    let mut descriptor = support::descriptor(false);
    let extra = serde_json::from_value(json!({
        "id":"org.example.widgets/panels","version":"1.0.0","dependencies":[],
        "nodes":[{"id":"org.example.widgets/panel","primitive":"container",
            "attrs":{"status":{"required":true,"value":{"kind":"enum","values":["open","closed"]}}},
            "children":{"op":"empty"},"marks":[]}],"marks":[],"commands":[]
    }))
    .unwrap();
    descriptor.extensions.push(extra);
    descriptor
        .selected_extensions
        .push(editor_registry::ExtensionIdentity {
            id: "org.example.widgets/panels".into(),
            version: "1.0.0".into(),
        });
    let profile = NotesProfile::compile(
        &descriptor,
        &[PARAGRAPH.into(), "org.example.widgets/panel".into()],
        NotesLimits::default(),
        CompilerLimits::default(),
        &mut WorkMeter::new(WorkLimits::default()),
    )
    .unwrap();
    let input = br#"{"schema_version":1,"root":{"type":"org.example.notes/document","attrs":{"title":"external","tags":[]},"marks":[],"text":null,"children":[{"type":"org.example.widgets/panel","attrs":{"status":"open"},"marks":[],"text":null,"children":[]}]}}"#;
    let expected = br#"{"root":{"attrs":{"tags":[],"title":"external"},"children":[{"attrs":{"status":"open"},"children":[],"marks":[],"text":null,"type":"org.example.widgets/panel"}],"marks":[],"text":null,"type":"org.example.notes/document"},"schema_version":1}"#;
    let admitted = profile
        .admit_bytes(profile.binding(), input, AdmissionMode::Strict)
        .unwrap();
    assert_eq!(profile.canonical(&admitted), expected);
}

#[test]
fn host_limits_refuse_before_unbounded_admission_and_join_growth() {
    let input =
        include_bytes!("../../../contracts/notes/v1/inputs/N011-import-lossless-text-join.json");
    for limits in [
        NotesLimits {
            document_bytes: 1,
            ..NotesLimits::default()
        },
        NotesLimits {
            tree_depth: 1,
            ..NotesLimits::default()
        },
        NotesLimits {
            node_count: 1,
            ..NotesLimits::default()
        },
        NotesLimits {
            work: WorkLimits { units: 0, bytes: 0 },
            ..NotesLimits::default()
        },
        NotesLimits {
            text_leaf_bytes: 16,
            ..NotesLimits::default()
        },
    ] {
        let profile = support::profile_with_limits(false, limits);
        let error = match profile.admit_bytes(profile.binding(), input, AdmissionMode::Import) {
            Err(error) => error,
            Ok(_) => panic!("tightened limit admitted input"),
        };
        assert_eq!(error.as_str(), "resource_limit_exceeded");
    }
    let excessive = NotesLimits {
        document_bytes: u64::MAX,
        node_count: u64::MAX,
        tree_depth: u64::MAX,
        text_leaf_bytes: u64::MAX,
        work: WorkLimits {
            units: u64::MAX,
            bytes: u64::MAX,
        },
    };
    assert_eq!(excessive.effective(), NotesLimits::default());
}
