// SPDX-License-Identifier: MIT OR Apache-2.0
//! Synthetic regression cases shared by native tests and a test-only WASM example.
use super::profile;
use profile::{
    IdentityResolver, IdentityResolverError, IdentityStatus, ProjectionBudget,
    ProjectionBudgetKind, ProjectionError,
};
use serde_json::json;
use uuid::Uuid;

struct NoIdentities;
impl IdentityResolver for NoIdentities {
    fn resolve_media(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        panic!("no identities in synthetic fixture")
    }
    fn resolve_reference(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        panic!("no identities in synthetic fixture")
    }
}

fn verse(blank_lines: u64) -> profile::ValidatedDocument {
    profile::validate_normalized_json(
        &serde_json::to_vec(&json!({
            "schema":"klenwriter.document","schema_version":1,"profile":"poetry",
            "content":[{"type":"verse","content":[
                {"type":"verse_line","content":[{"type":"text","text":"a"}]},
                {"type":"stanza_break","attrs":{"blank_lines":blank_lines}},
                {"type":"verse_line","content":[{"type":"text","text":"b"}]}
            ]}]
        }))
        .unwrap(),
        &NoIdentities,
    )
    .unwrap()
}

pub fn pathological_expansion_is_refused() {
    for blank_lines in [u64::MAX, u64::MAX - 1] {
        assert_eq!(
            verse(blank_lines).project_text(),
            Err(ProjectionError::ArithmeticOverflow)
        );
    }
    for blank_lines in [u32::MAX as u64, 4 * 1024 * 1024] {
        assert_eq!(
            verse(blank_lines).project_text(),
            Err(ProjectionError::BudgetExceeded {
                budget: ProjectionBudgetKind::OutputBytes,
                limit: ProjectionBudget::default().output_bytes,
            })
        );
    }
}

pub fn tight_budgets_are_atomic() {
    let doc = verse(1);
    let expected = "a\n\nb";
    assert_eq!(doc.project_text().unwrap().full_text, expected);
    let tight = ProjectionBudget {
        output_bytes: 4,
        ..ProjectionBudget::default()
    };
    let trio = doc
        .project_text_with_budget(ProjectionBudget {
            work_bytes: 24,
            node_visits: 12,
            ..tight
        })
        .unwrap();
    assert_eq!(
        (
            &trio.full_text,
            &trio.search_index_text,
            &trio.public_snippet_text
        ),
        (
            &expected.to_string(),
            &expected.to_string(),
            &expected.to_string()
        )
    );
    for (budget, kind, limit) in [
        (
            ProjectionBudget {
                output_bytes: 3,
                ..tight
            },
            ProjectionBudgetKind::OutputBytes,
            3,
        ),
        (
            ProjectionBudget {
                output_bytes: 0,
                ..tight
            },
            ProjectionBudgetKind::OutputBytes,
            0,
        ),
        (
            ProjectionBudget {
                work_bytes: 0,
                ..tight
            },
            ProjectionBudgetKind::WorkBytes,
            0,
        ),
        (
            ProjectionBudget {
                work_bytes: 23,
                ..tight
            },
            ProjectionBudgetKind::WorkBytes,
            23,
        ),
        (
            ProjectionBudget {
                node_visits: 0,
                ..tight
            },
            ProjectionBudgetKind::NodeVisits,
            0,
        ),
        (
            ProjectionBudget {
                node_visits: 11,
                ..tight
            },
            ProjectionBudgetKind::NodeVisits,
            11,
        ),
    ] {
        assert_eq!(
            doc.project_text_with_budget(budget),
            Err(ProjectionError::BudgetExceeded {
                budget: kind,
                limit
            })
        );
    }
}

pub fn storage_survives_refusal() {
    let doc = verse(u64::MAX);
    let before = doc.canonical_json().to_vec();
    assert!(doc.project_text().is_err());
    assert_eq!(doc.canonical_json(), before);
    let readmitted = profile::validate_normalized_json(&before, &NoIdentities).unwrap();
    assert_eq!(readmitted.canonical_json(), before);
    assert_eq!(doc.document().project_text(), doc.project_text());
    // The authored number remains intact; no storage/schema limit was tightened.
    assert_eq!(
        doc.document().to_json_value()["content"][0]["content"][1]["attrs"]["blank_lines"],
        u64::MAX
    );
}

pub fn host_cannot_raise_ceilings() {
    let unlimited = ProjectionBudget {
        output_bytes: u64::MAX,
        work_bytes: u64::MAX,
        node_visits: u64::MAX,
    };
    assert_eq!(
        verse(4 * 1024 * 1024).project_text_with_budget(unlimited),
        Err(ProjectionError::BudgetExceeded {
            budget: ProjectionBudgetKind::OutputBytes,
            limit: 4 * 1024 * 1024
        })
    );
}

pub fn ordinary_bytes_and_empty_lines() {
    for blank_lines in [1, 2, 8] {
        let projected = verse(blank_lines).project_text().unwrap();
        let expected = format!("a{}b", "\n".repeat(blank_lines as usize + 1));
        assert_eq!(projected.full_text, expected);
        assert_eq!(projected.search_index_text, expected);
        assert_eq!(projected.public_snippet_text, expected);
    }
    let empty = profile::validate_normalized_json(br#"{"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[]}]}"#, &NoIdentities).unwrap();
    assert_eq!(
        empty
            .project_text_with_budget(ProjectionBudget {
                output_bytes: 0,
                work_bytes: 0,
                node_visits: 2
            })
            .unwrap()
            .full_text,
        ""
    );
}

pub fn spoilers_captions_and_tables_retain_bytes() {
    struct Media;
    impl IdentityResolver for Media {
        fn resolve_media(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
            Ok(IdentityStatus::Exists)
        }
        fn resolve_reference(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
            panic!("no references")
        }
    }
    let para = |text: &str| json!({"type":"paragraph","content":[{"type":"text","text":text}]});
    let doc = profile::validate_normalized_json(&serde_json::to_vec(&json!({
        "schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[
            {"type":"spoiler","attrs":{"label":"Финал"},"content":[para("Тайна")]},
            {"type":"media_image","attrs":{"media_asset_id":"00000000-0000-4000-8000-0000000000cc","alt":"Alt","align":"none"},"content":[para("Cap")]},
            {"type":"table","content":[{"type":"table_row","content":[
                {"type":"table_cell","content":[para("A")]}, {"type":"table_cell","content":[para("B")]}
            ]}]}
        ]
    })).unwrap(), &Media).unwrap();
    let trio = doc.project_text().unwrap();
    assert_eq!(trio.full_text, "Финал\nТайна\nAlt\nCap\nA\tB");
    assert_eq!(trio.search_index_text, trio.full_text);
    assert_eq!(trio.public_snippet_text, "Финал\nAlt\nCap\nA\tB");
    // UTF-8 bytes, rather than scalar counts, consume the output budget.
    assert!(matches!(
        doc.project_text_with_budget(ProjectionBudget {
            output_bytes: 5,
            ..ProjectionBudget::default()
        }),
        Err(ProjectionError::BudgetExceeded {
            budget: ProjectionBudgetKind::OutputBytes,
            limit: 5
        })
    ));
}

#[allow(dead_code)]
pub fn run_all() -> u32 {
    pathological_expansion_is_refused();
    tight_budgets_are_atomic();
    storage_survives_refusal();
    host_cannot_raise_ceilings();
    ordinary_bytes_and_empty_lines();
    spoilers_captions_and_tables_retain_bytes();
    6
}
