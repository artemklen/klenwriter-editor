// SPDX-License-Identifier: MIT OR Apache-2.0
//! Trusted fixture observer, shared by native and a test-only WASM module.
//! It is never included in the distributed WASM artifact or SDK.
use editor_kwdj as profile;
use klenwriter_editor_wasm::codec::{Context, Operation, Response};
use serde::Deserialize;
use serde_json::{Value, json};

#[path = "../../../kwdj/tests/support/admission_budget_cases.rs"]
mod admission_cases;
#[path = "../../../kwdj/tests/support/projection_budget_cases.rs"]
mod projection_cases;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    operation: Operation,
    input: String,
    options: String,
    #[serde(default)]
    projection: bool,
    #[serde(default)]
    hardening: bool,
}

pub fn observe(request: &str) -> String {
    let request: Request = serde_json::from_str(request).expect("trusted corpus request");
    if request.hardening {
        let projection = projection_cases::run_all();
        let admission = admission_cases::run_all();
        assert_eq!((projection, admission), (6, 9));
        return json!({"hardening": {
            "OSR-74": {"assertion_groups":projection,"status":"passed"},
            "OSR-75": {"assertion_groups":admission,"status":"passed"}
        }})
        .to_string();
    }
    let context = match Context::parse(&request.options) {
        Ok(context) => context,
        Err(error) => {
            return json!({"codec":Response::refused(request.operation,error),
                "projection":{"status":"not_executed","reason":"options_refused"}})
            .to_string();
        }
    };
    let response = context.run(request.operation, request.input.as_bytes());
    let projection = if request.projection {
        match &response {
            Response::Accepted { canonical_json, .. } => {
                // Reopen admitted canonical bytes using the same explicit catalog.
                // Corpus effective ceilings are defaults (attempted increases clamp).
                // No host callbacks, network, CMS or editing state enter this probe.
                let admitted =
                    profile::validate_normalized_json(canonical_json.as_bytes(), &context)
                        .expect("accepted canonical must reopen for projection");
                match admitted.project_text() {
                    Ok(value) => json!({"status":"accepted", "full_text":value.full_text,
                        "search_index_text":value.search_index_text,
                        "public_snippet_text":value.public_snippet_text}),
                    Err(error) => {
                        let (budget, maximum) = match error {
                            profile::ProjectionError::BudgetExceeded { budget, limit } => (
                                Some(match budget {
                                    profile::ProjectionBudgetKind::OutputBytes => "output_bytes",
                                    profile::ProjectionBudgetKind::WorkBytes => "work_bytes",
                                    profile::ProjectionBudgetKind::NodeVisits => "node_visits",
                                }),
                                Some(limit.to_string()),
                            ),
                            _ => (None, None),
                        };
                        json!({"status":"refused","code":error.code(),"budget":budget,"maximum":maximum})
                    }
                }
            }
            Response::Refused { .. } => json!({"status":"not_executed","reason":"codec_refused"}),
        }
    } else {
        json!({"status":"not_executed","reason":"not_requested"})
    };
    let codec: Value = serde_json::to_value(response).expect("codec DTO");
    json!({"codec":codec,"projection":projection}).to_string()
}
