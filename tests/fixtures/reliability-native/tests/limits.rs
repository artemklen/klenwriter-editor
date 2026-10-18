// SPDX-License-Identifier: MIT OR Apache-2.0
//! Deterministic functional boundaries outside the random/scenario hot loops.
use editor_core::positions::Utf16Offset;
use editor_core::profile::{AdmissionMode, FrozenProfile};
use editor_core::transaction::{Operation, WorkLimits, WorkMeter};
use editor_engine::{AccessMode, DispatchOutcome, Session, SessionError, Transaction};
use editor_kwdj::{AdmissionBudget, KwdjErrorCode, KwdjProfile, KwdjProfileError, Limits};
use editor_reliability_native::ExistingFacts;
use serde_json::json;
use std::rc::Rc;

fn wire(text: &str) -> Vec<u8> {
    serde_json::to_vec(&json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[{"type":"text","text":text}]}]})).unwrap()
}
fn open(
    input: &[u8],
    limits: Limits,
    budget: AdmissionBudget,
) -> Result<Session<KwdjProfile<'static>>, SessionError<KwdjProfileError>> {
    let p = KwdjProfile::new_owned(Rc::new(ExistingFacts), limits, budget);
    let binding = p.binding().clone();
    Session::open(
        p,
        &binding,
        input,
        AdmissionMode::Strict,
        AccessMode::Editable,
    )
}
fn code<T>(result: Result<T, SessionError<KwdjProfileError>>, expected: KwdjErrorCode) {
    match result {
        Err(SessionError::Profile(KwdjProfileError::Document(e))) => assert_eq!(e.code, expected),
        Err(other) => panic!("expected typed profile boundary, got {other:?}"),
        Ok(_) => panic!("expected typed profile refusal, got an admitted Session"),
    }
}
#[test]
fn utf8_leaf_host_reduction_below_equal_above_and_ceiling_cannot_increase() {
    for (text, accepted) in [("é", true), ("éA", true), ("éé", false)] {
        let result = open(
            &wire(text),
            Limits {
                text_leaf_bytes: 3,
                ..Limits::default()
            },
            AdmissionBudget::default(),
        );
        if accepted {
            let mut s = result.unwrap();
            s.close(s.key()).unwrap();
        } else {
            code(result, KwdjErrorCode::ResourceLimitExceeded);
        }
    }
    code(
        open(
            &wire(&"x".repeat(editor_kwdj::MAX_TEXT_LEAF_BYTES as usize + 1)),
            Limits {
                text_leaf_bytes: u64::MAX,
                ..Limits::default()
            },
            AdmissionBudget::default(),
        ),
        KwdjErrorCode::ResourceLimitExceeded,
    );
}
#[test]
fn raw_admission_byte_reduction_below_equal_above() {
    let input = wire("ab");
    for (delta, accepted) in [(-1i64, false), (0, true), (1, true)] {
        let budget = AdmissionBudget {
            raw_input_bytes: (input.len() as i64 + delta) as u64,
            ..AdmissionBudget::default()
        };
        let result = open(&input, Limits::default(), budget);
        if accepted {
            let mut s = result.unwrap();
            s.close(s.key()).unwrap();
        } else {
            code(result, KwdjErrorCode::OperationalBudgetExceeded);
        }
    }
}
#[test]
fn compiler_descriptor_raw_byte_reduction_below_equal_above() {
    const RAW:&[u8]=br#"{"format":"editor-registry/1","profile":{"id":"org.example.reliability","version":"1.0.0","codec_id":"org.example.reliability/json","wire_version":1},"selected_extensions":[{"id":"org.example.reliability/base","version":"1.0.0"}],"root":{"op":"repeat","item":{"op":"type","id":"org.example.reliability/block"},"min":0,"max":1},"mark_policy":{},"extensions":[{"id":"org.example.reliability/base","version":"1.0.0","dependencies":[],"nodes":[{"id":"org.example.reliability/block","primitive":"block_atom","attrs":{},"children":{"op":"empty"},"marks":[]}],"marks":[],"commands":[]}]}"#;
    for (delta, accepted) in [(-1i64, false), (0, true), (1, true)] {
        let limits = editor_registry::CompilerLimits {
            descriptor_bytes: (RAW.len() as i64 + delta) as u64,
            ..editor_registry::CompilerLimits::default()
        };
        let result = editor_registry::compile_json(
            RAW,
            &[],
            limits,
            &mut WorkMeter::new(WorkLimits::default()),
        );
        if accepted {
            assert!(result.is_ok());
        } else {
            assert_eq!(
                result.err().unwrap().code,
                editor_registry::RegistryErrorCode::ResourceLimitExceeded
            );
        }
    }
}
#[test]
fn ordinary_operation_limit_below_equal_above_is_atomic() {
    for cap in [1, 2, 3] {
        let mut s = open(&wire("ab"), Limits::default(), AdmissionBudget::default()).unwrap();
        let root = s.root(s.key()).unwrap();
        let block = s.node(s.key(), root).unwrap().children()[0];
        let leaf = s.node(s.key(), block).unwrap().children()[0];
        let before = (
            s.export_snapshot(s.key(), 0).unwrap(),
            s.stamp(),
            s.history_summary(),
            s.journal_summary(),
            s.event_status(s.key()).unwrap(),
        );
        let mut tx = Transaction::new(
            s.key(),
            0,
            vec![
                Operation::ReplaceText {
                    leaf: leaf.into(),
                    from: Utf16Offset::new(0),
                    to: Utf16Offset::new(1),
                    inserted: "X".into(),
                },
                Operation::ReplaceText {
                    leaf: leaf.into(),
                    from: Utf16Offset::new(1),
                    to: Utf16Offset::new(1),
                    inserted: "Y".into(),
                },
            ],
        );
        tx.limits.operations = cap;
        if cap == 1 {
            assert!(matches!(s.dispatch(tx), DispatchOutcome::Refused { .. }));
            assert_eq!(
                (
                    s.export_snapshot(s.key(), 0).unwrap(),
                    s.stamp(),
                    s.history_summary(),
                    s.journal_summary(),
                    s.event_status(s.key()).unwrap()
                ),
                before
            );
        } else {
            assert!(matches!(s.dispatch(tx), DispatchOutcome::Changed(_)));
            assert_eq!(s.export_snapshot(s.key(),1).unwrap(),br#"{"content":[{"content":[{"text":"XYb","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}"#);
            assert_eq!(s.node(s.key(), block).unwrap().children()[0], leaf);
        }
        s.close(s.key()).unwrap();
    }
}
#[test]
fn normative_fifty_thousand_node_boundary_retains_distinct_admission_cache_cap() {
    for count in [49_999usize, 50_000, 50_001] {
        let mut children = Vec::new();
        if count % 2 == 1 {
            children.push(json!({"type":"scene_break"}));
        }
        children.extend(
            (0..count / 2)
                .map(|_| json!({"type":"paragraph","content":[{"type":"text","text":"x"}]})),
        );
        let input=serde_json::to_vec(&json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":children})).unwrap();
        let result = open(&input, Limits::default(), AdmissionBudget::default());
        if count <= 50_000 {
            let mut s = result.unwrap();
            let root = s.root(s.key()).unwrap();
            assert_eq!(
                s.node_at(s.key(), 0, root).unwrap().stats.authored_nodes,
                count
            );
            s.close(s.key()).unwrap();
        } else {
            code(result, KwdjErrorCode::ResourceLimitExceeded);
        }
    }
}
