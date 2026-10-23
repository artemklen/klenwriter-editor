// SPDX-License-Identifier: MIT OR Apache-2.0
//! Small synthetic native/compiled-WASM cases; no large allocation experiments.
use std::cell::Cell;

use super::profile;
use editor_core::admission::{PreflightBudget, preflight_json, preflight_snapshot};
use editor_core::document::{Attribute, Document, Mark, Node, Primitive};
use profile::{AdmissionBudget, IdentityResolver, IdentityResolverError, IdentityStatus, Limits};
use serde_json::{Value, json};
use uuid::Uuid;

#[derive(Default)]
struct Identities {
    media: Cell<usize>,
    references: Cell<usize>,
}
impl IdentityResolver for Identities {
    fn resolve_media(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        self.media.set(self.media.get() + 1);
        Ok(IdentityStatus::Exists)
    }
    fn resolve_reference(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        self.references.set(self.references.get() + 1);
        Ok(IdentityStatus::Exists)
    }
}

fn document() -> Value {
    json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[
        {"type":"paragraph","content":[{"type":"text","text":"Яe\u{301}😀"}]}
    ]})
}
fn bytes(value: &Value) -> Vec<u8> {
    serde_json::to_vec(value).unwrap()
}
fn refusal(error: profile::KwdjError, limit: &str) {
    assert_eq!(
        error.code,
        profile::KwdjErrorCode::OperationalBudgetExceeded
    );
    assert_eq!(error.code.as_str(), "kwdj.admission_budget_exceeded");
    assert_eq!(error.path, "");
    assert_eq!(error.context.category, Some("operational_admission"));
    assert_eq!(error.context.limit, Some(limit));
}

pub fn raw_failure_precedes_parser() {
    let resolver = Identities::default();
    for maximum in [0, 1] {
        let budget = AdmissionBudget {
            raw_input_bytes: maximum,
            ..AdmissionBudget::default()
        };
        refusal(
            profile::decode_candidate_with_limits_and_budget(b"[x", Limits::default(), budget)
                .unwrap_err(),
            "raw_input_bytes",
        );
        refusal(
            profile::validate_normalized_json_with_limits_and_budget(
                b"[x",
                &resolver,
                Limits::default(),
                budget,
            )
            .unwrap_err(),
            "raw_input_bytes",
        );
        refusal(
            profile::decode_normalize_validate_with_limits_and_budget(
                b"[x",
                &resolver,
                Limits::default(),
                budget,
            )
            .unwrap_err(),
            "raw_input_bytes",
        );
    }
    let exact = AdmissionBudget {
        raw_input_bytes: 2,
        ..AdmissionBudget::default()
    };
    assert_eq!(
        profile::decode_candidate_with_limits_and_budget(b"[x", Limits::default(), exact)
            .unwrap_err()
            .code,
        profile::KwdjErrorCode::InvalidJson
    );
    assert_eq!(
        profile::decode_candidate_with_limits_and_budget(b"{}", Limits::default(), exact)
            .unwrap_err()
            .code,
        profile::KwdjErrorCode::InvalidEnvelope
    );
    let zero = AdmissionBudget {
        raw_input_bytes: 0,
        ..exact
    };
    assert_eq!(
        profile::decode_candidate_with_limits_and_budget(b"", Limits::default(), zero)
            .unwrap_err()
            .code,
        profile::KwdjErrorCode::InvalidJson
    );
    assert_eq!((resolver.media.get(), resolver.references.get()), (0, 0));
}

pub fn raw_and_canonical_limits_are_distinct() {
    let resolver = Identities::default();
    let expected = profile::validate_normalized_json(&bytes(&document()), &resolver).unwrap();
    let canonical = std::str::from_utf8(expected.canonical_json()).unwrap();
    let padded = format!(" \n{}\t ", canonical.replace('Я', "\\u042f"));
    assert!(padded.len() > expected.canonical_json().len());
    let limits = Limits {
        document_bytes: expected.canonical_json().len() as u64,
        ..Limits::default()
    };
    let exact = AdmissionBudget {
        raw_input_bytes: padded.len() as u64,
        ..AdmissionBudget::default()
    };
    let result = profile::validate_normalized_json_with_limits_and_budget(
        padded.as_bytes(),
        &resolver,
        limits,
        exact,
    )
    .unwrap();
    assert_eq!(result, expected);
    let tighter = AdmissionBudget {
        raw_input_bytes: exact.raw_input_bytes - 1,
        ..exact
    };
    refusal(
        profile::validate_normalized_json_with_limits_and_budget(
            padded.as_bytes(),
            &resolver,
            limits,
            tighter,
        )
        .unwrap_err(),
        "raw_input_bytes",
    );
    assert_eq!(expected.canonical_json(), result.canonical_json());
}

pub fn json_preflight_precedes_shape_and_copy() {
    let value = json!({"PRIVATE_KEY":[["PRIVATE_VALUE"]]});
    let original = value.clone();
    let encoded = bytes(&value);
    let budget = AdmissionBudget {
        preflight: PreflightBudget {
            payload_bytes: 2,
            ..PreflightBudget::default()
        },
        ..AdmissionBudget::default()
    };
    let error =
        profile::decode_candidate_value_with_limits_and_budget(&value, Limits::default(), budget)
            .unwrap_err();
    assert!(!format!("{error:?}").contains("PRIVATE_"));
    refusal(error, "preflight_payload_bytes");
    refusal(
        profile::decode_candidate_with_limits_and_budget(&encoded, Limits::default(), budget)
            .unwrap_err(),
        "preflight_payload_bytes",
    );
    let shallow = AdmissionBudget {
        preflight: PreflightBudget {
            depth: 2,
            ..PreflightBudget::default()
        },
        ..AdmissionBudget::default()
    };
    refusal(
        profile::decode_candidate_value_with_limits_and_budget(&value, Limits::default(), shallow)
            .unwrap_err(),
        "preflight_depth",
    );
    let no_work = AdmissionBudget {
        preflight: PreflightBudget {
            values: 0,
            ..PreflightBudget::default()
        },
        ..AdmissionBudget::default()
    };
    refusal(
        profile::decode_candidate_value_with_limits_and_budget(&value, Limits::default(), no_work)
            .unwrap_err(),
        "preflight_values",
    );
    assert_eq!(value, original);
    assert_eq!(
        profile::decode_candidate_value(&value).unwrap_err().code,
        profile::KwdjErrorCode::InvalidEnvelope
    );
}

fn generic() -> Document {
    Document {
        children: vec![Node {
            type_id: "x/text".into(),
            primitive: Primitive::Text,
            attributes: [("k".into(), Attribute::String("ё".into()))].into(),
            marks: vec![Mark {
                type_id: "x/tag".into(),
                attributes: [("t".into(), Attribute::String("x".into()))].into(),
            }],
            text: Some("Я😀".into()),
            children: vec![],
        }],
    }
}

pub fn generic_counts_each_payload() {
    // Independent expectation: type6 + text6 + key1/value2 + mark5 + key1/value1.
    let budget = PreflightBudget {
        payload_bytes: 22,
        values: 4,
        depth: 3,
    };
    let metrics = preflight_snapshot(&generic(), budget).unwrap();
    assert_eq!((metrics.nodes, metrics.tree_depth), (1, 1));
    assert_eq!(
        (
            metrics.usage.payload_bytes,
            metrics.usage.values,
            metrics.usage.depth
        ),
        (22, 4, 3)
    );
    for (policy, name) in [
        (
            PreflightBudget {
                payload_bytes: 21,
                ..budget
            },
            "preflight_payload_bytes",
        ),
        (
            PreflightBudget {
                values: 3,
                ..budget
            },
            "preflight_values",
        ),
        (PreflightBudget { depth: 2, ..budget }, "preflight_depth"),
    ] {
        assert_eq!(
            preflight_snapshot(&generic(), policy).unwrap_err().name,
            name
        );
    }
    for field in 0..7 {
        let mut input = generic();
        let n = &mut input.children[0];
        match field {
            0 => n.type_id.push('a'),
            1 => n.text.as_mut().unwrap().push('a'),
            2 => {
                let v = n.attributes.remove("k").unwrap();
                n.attributes.insert("kk".into(), v);
            }
            3 => {
                if let Attribute::String(v) = n.attributes.get_mut("k").unwrap() {
                    v.push('a');
                }
            }
            4 => n.marks[0].type_id.push('a'),
            5 => {
                let v = n.marks[0].attributes.remove("t").unwrap();
                n.marks[0].attributes.insert("tt".into(), v);
            }
            6 => {
                if let Attribute::String(v) = n.marks[0].attributes.get_mut("t").unwrap() {
                    v.push('a');
                }
            }
            _ => unreachable!(),
        }
        let error = preflight_snapshot(&input, budget).unwrap_err();
        assert_eq!(error.name, "preflight_payload_bytes");
        assert_eq!(error.observed, 23);
    }
    assert_eq!(
        preflight_snapshot(
            &Document { children: vec![] },
            PreflightBudget {
                payload_bytes: 0,
                values: 0,
                depth: 0
            }
        )
        .unwrap()
        .nodes,
        0
    );
    // OSR-67 independently frozen tiny exact/+1 count and depth constructions.
    // Keep the original payload/host-tightening assertions above unchanged.
    let count_budget = PreflightBudget {
        payload_bytes: 64,
        values: 4,
        depth: 8,
    };
    assert_eq!(
        preflight_snapshot(&generic(), count_budget)
            .unwrap()
            .usage
            .values,
        4
    );
    let mut count_over = generic();
    count_over.children[0]
        .attributes
        .insert("z".into(), Attribute::Null);
    let error = preflight_snapshot(&count_over, count_budget).unwrap_err();
    assert_eq!(
        (error.name, error.maximum, error.observed),
        ("preflight_values", 4, 5)
    );
    let depth_budget = PreflightBudget {
        payload_bytes: 64,
        values: 8,
        depth: 3,
    };
    assert_eq!(
        preflight_snapshot(&generic(), depth_budget)
            .unwrap()
            .usage
            .depth,
        3
    );
    let mut depth_over = generic();
    depth_over.children[0].marks[0].attributes.insert(
        "t".into(),
        Attribute::List(vec![Attribute::String("x".into())]),
    );
    let error = preflight_snapshot(&depth_over, depth_budget).unwrap_err();
    assert_eq!(
        (error.name, error.maximum, error.observed),
        ("preflight_depth", 3, 4)
    );
}

pub fn nested_metadata_and_numbers_are_bounded() {
    let mut n = generic().children.remove(0);
    n.type_id = "x".into();
    n.text = None;
    n.marks.clear();
    n.attributes = [(
        "m".into(),
        Attribute::List(vec![
            Attribute::Null,
            Attribute::Boolean(true),
            Attribute::Number(12.into()),
            Attribute::Object([("n".into(), Attribute::String("Я".into()))].into()),
        ]),
    )]
    .into();
    let input = Document { children: vec![n] };
    // x1 + m1 + null4 + true4 + number2 + n1 + text2 =15;7 values, depth4.
    let exact = PreflightBudget {
        payload_bytes: 15,
        values: 7,
        depth: 4,
    };
    let m = preflight_snapshot(&input, exact).unwrap();
    assert_eq!(
        (m.usage.payload_bytes, m.usage.values, m.usage.depth),
        (15, 7, 4)
    );
    assert_eq!(
        preflight_snapshot(&input, PreflightBudget { depth: 3, ..exact })
            .unwrap_err()
            .name,
        "preflight_depth"
    );
    assert_eq!(
        preflight_snapshot(&input, PreflightBudget { values: 3, ..exact })
            .unwrap_err()
            .name,
        "preflight_values"
    );
    let numeric = Value::Number(u64::MAX.into());
    let b = PreflightBudget {
        payload_bytes: 20,
        values: 1,
        depth: 1,
    };
    assert_eq!(preflight_json(&numeric, b).unwrap().payload_bytes, 20);
    assert_eq!(
        preflight_json(
            &numeric,
            PreflightBudget {
                payload_bytes: 19,
                ..b
            }
        )
        .unwrap_err()
        .name,
        "preflight_payload_bytes"
    );
    let mut wide = generic();
    wide.children = vec![wide.children[0].clone(); 3];
    assert_eq!(
        preflight_snapshot(
            &wide,
            PreflightBudget {
                values: 2,
                ..PreflightBudget::default()
            }
        )
        .unwrap_err()
        .observed,
        3
    );
    let mut deep = generic().children.remove(0);
    deep.attributes.clear();
    deep.marks.clear();
    for _ in 0..4 {
        let mut outer = deep.clone();
        outer.children = vec![deep];
        deep = outer;
    }
    assert_eq!(
        preflight_snapshot(
            &Document {
                children: vec![deep]
            },
            PreflightBudget {
                depth: 3,
                ..PreflightBudget::default()
            }
        )
        .unwrap_err()
        .name,
        "preflight_depth"
    );
}

pub fn generic_admission_is_atomic() {
    let resolver = Identities::default();
    let original = profile::validate_normalized_json(&bytes(&document()), &resolver).unwrap();
    let before = original.clone();
    let mut input = original.document().to_core_document();
    input.children[0].type_id = "org.example/unknown".into();
    input.children[0].text = Some("PRIVATE_VALUE".into());
    let untouched = input.clone();
    let budget = AdmissionBudget {
        preflight: PreflightBudget {
            payload_bytes: 0,
            ..PreflightBudget::default()
        },
        ..AdmissionBudget::default()
    };
    let error = profile::admit_core_document_with_budget(
        &input,
        profile::Profile::Prose,
        &resolver,
        Limits::default(),
        budget,
    )
    .unwrap_err();
    assert!(!format!("{error:?}").contains("PRIVATE_VALUE"));
    refusal(error, "preflight_payload_bytes");
    assert_eq!(
        profile::admit_core_document(
            &input,
            profile::Profile::Prose,
            &resolver,
            Limits::default()
        )
        .unwrap_err()
        .code,
        profile::KwdjErrorCode::UnknownNode
    );
    assert_eq!(input, untouched);
    assert_eq!(original, before);
    let core = original.document().to_core_document();
    let limits = Limits {
        tree_depth: 1,
        ..Limits::default()
    };
    let error = profile::admit_core_document(&core, profile::Profile::Prose, &resolver, limits)
        .unwrap_err();
    assert_eq!(
        (error.context.limit, error.context.observed),
        (Some("tree_depth"), Some(2))
    );
    let limits = Limits {
        document_bytes: 0,
        text_leaf_bytes: 0,
        ..Limits::default()
    };
    assert_eq!(
        profile::admit_core_document(&core, profile::Profile::Prose, &resolver, limits)
            .unwrap_err(),
        profile::validate_normalized_json_with_limits(original.canonical_json(), &resolver, limits)
            .unwrap_err()
    );
}

pub fn identity_resolution_waits_for_admission() {
    let value = json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"media_image","attrs":{"media_asset_id":"11111111-1111-4111-8111-111111111111","alt":"a","align":"none"},"content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"reference_link","attrs":{"reference_entity_id":"22222222-2222-4222-8222-222222222222"}}]}]}]}]});
    let resolver = Identities::default();
    let input = bytes(&value);
    let prior = profile::validate_normalized_json(&input, &resolver).unwrap();
    assert_eq!((resolver.media.get(), resolver.references.get()), (1, 1));
    resolver.media.set(0);
    resolver.references.set(0);
    let saved = prior.clone();
    let no_raw = AdmissionBudget {
        raw_input_bytes: 0,
        ..AdmissionBudget::default()
    };
    refusal(
        profile::decode_normalize_validate_with_limits_and_budget(
            &input,
            &resolver,
            Limits::default(),
            no_raw,
        )
        .unwrap_err(),
        "raw_input_bytes",
    );
    let no_work = AdmissionBudget {
        preflight: PreflightBudget {
            values: 0,
            ..PreflightBudget::default()
        },
        ..AdmissionBudget::default()
    };
    refusal(
        profile::validate_normalized_json_with_limits_and_budget(
            &input,
            &resolver,
            Limits::default(),
            no_work,
        )
        .unwrap_err(),
        "preflight_values",
    );
    refusal(
        profile::decode_candidate_value_with_limits_and_budget(&value, Limits::default(), no_work)
            .and_then(|c| profile::normalize_and_validate(c, &resolver))
            .unwrap_err(),
        "preflight_values",
    );
    refusal(
        profile::admit_core_document_with_budget(
            &prior.document().to_core_document(),
            profile::Profile::Prose,
            &resolver,
            Limits::default(),
            no_work,
        )
        .unwrap_err(),
        "preflight_values",
    );
    assert_eq!((resolver.media.get(), resolver.references.get()), (0, 0));
    assert_eq!(prior, saved);
}

pub fn host_settings_only_tighten() {
    let raised = AdmissionBudget {
        raw_input_bytes: u64::MAX,
        preflight: PreflightBudget {
            payload_bytes: u64::MAX,
            values: u64::MAX,
            depth: u64::MAX,
        },
    };
    assert_eq!(raised.effective(), AdmissionBudget::default());
    let mixed = AdmissionBudget {
        raw_input_bytes: 1,
        ..raised
    };
    refusal(
        profile::decode_candidate_with_limits_and_budget(b"xx", Limits::default(), mixed)
            .unwrap_err(),
        "raw_input_bytes",
    );
    let mixed = AdmissionBudget {
        preflight: PreflightBudget {
            payload_bytes: 0,
            ..raised.preflight
        },
        ..raised
    };
    refusal(
        profile::decode_candidate_value_with_limits_and_budget(
            &document(),
            Limits::default(),
            mixed,
        )
        .unwrap_err(),
        "preflight_payload_bytes",
    );
}

pub fn within_budget_codec_results_are_equal() {
    let resolver = Identities::default();
    let value = document();
    let input = bytes(&value);
    let default = profile::decode_normalize_validate(&input, &resolver).unwrap();
    let exact = AdmissionBudget {
        raw_input_bytes: input.len() as u64,
        ..AdmissionBudget::default()
    };
    assert_eq!(
        default,
        profile::decode_normalize_validate_with_limits_and_budget(
            &input,
            &resolver,
            Limits::default(),
            exact
        )
        .unwrap()
    );
    assert_eq!(
        default,
        profile::normalize_and_validate(profile::decode_candidate(&input).unwrap(), &resolver)
            .unwrap()
    );
    assert_eq!(
        default,
        profile::validate_normalized_json_with_limits_and_budget(
            &input,
            &resolver,
            Limits::default(),
            exact
        )
        .unwrap()
    );
    let core = default.document().to_core_document();
    assert_eq!(
        default,
        profile::admit_core_document_with_budget(
            &core,
            profile::Profile::Prose,
            &resolver,
            Limits::default(),
            AdmissionBudget {
                raw_input_bytes: 0,
                ..exact
            }
        )
        .unwrap()
    );
    assert_eq!(
        default,
        profile::normalize_and_validate(
            profile::decode_candidate_value_with_limits_and_budget(
                &value,
                Limits::default(),
                AdmissionBudget {
                    raw_input_bytes: 0,
                    ..exact
                }
            )
            .unwrap(),
            &resolver
        )
        .unwrap()
    );
    let mut candidate = value.clone();
    candidate["content"][0]["content"][0]["marks"] = json!([]);
    let source = bytes(&candidate);
    let a = profile::decode_normalize_validate(&source, &resolver).unwrap();
    let b = profile::decode_normalize_validate_with_limits_and_budget(
        &source,
        &resolver,
        Limits::default(),
        AdmissionBudget {
            raw_input_bytes: source.len() as u64,
            ..exact
        },
    )
    .unwrap();
    assert!(!a.normalization_events().is_empty());
    assert_eq!(a, b);
    assert_eq!(a.canonical_json(), default.canonical_json());
    assert_eq!(a.project_text(), default.project_text());
    assert_eq!(
        profile::validate_normalized_json(&source, &resolver).unwrap_err(),
        profile::validate_normalized_json_with_limits_and_budget(
            &source,
            &resolver,
            Limits::default(),
            AdmissionBudget::default()
        )
        .unwrap_err()
    );
}

#[allow(dead_code)] // Native reports each case separately; WASM calls this runner.
pub fn run_all() -> u32 {
    raw_failure_precedes_parser();
    raw_and_canonical_limits_are_distinct();
    json_preflight_precedes_shape_and_copy();
    generic_counts_each_payload();
    nested_metadata_and_numbers_are_bounded();
    generic_admission_is_atomic();
    identity_resolution_waits_for_admission();
    host_settings_only_tighten();
    within_budget_codec_results_are_equal();
    9
}
