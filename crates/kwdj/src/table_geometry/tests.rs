// SPDX-License-Identifier: MIT OR Apache-2.0
use super::*;
use crate::model::TableCellAttrs;
use crate::wire_view::WireView;
use editor_core::transaction::{WorkLimits, WorkUsage};
use serde_json::Value;

struct NoIdentities;
impl crate::IdentityResolver for NoIdentities {
    fn resolve_media(
        &self,
        _: &uuid::Uuid,
    ) -> Result<crate::IdentityStatus, crate::IdentityResolverError> {
        panic!("table fixture has no media identity")
    }
    fn resolve_reference(
        &self,
        _: &uuid::Uuid,
    ) -> Result<crate::IdentityStatus, crate::IdentityResolverError> {
        panic!("table fixture has no reference identity")
    }
}

fn geometry(
    node: &Node,
    limits: Limits,
    work: Option<&mut WorkMeter>,
) -> Result<TableGeometry, GeometryError> {
    check_table(
        &WireView {
            roots: std::slice::from_ref(node),
        },
        node,
        limits,
        work,
    )
}

fn corpus_case(raw: &str, id: &str, name: &str) -> Node {
    let corpus: Value = serde_json::from_str(raw).unwrap();
    let fixture = corpus["fixtures"]
        .as_array()
        .unwrap()
        .iter()
        .find(|fixture| fixture["id"] == id)
        .unwrap();
    let case = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["name"] == name)
        .unwrap();
    serde_json::from_value(case["kwdj"]["content"][0].clone()).unwrap()
}

const POSITIVE: &str = include_str!("../../../../contracts/kwdj/v1/fixtures/positive.json");
const MIXED: &str = include_str!("../../../../contracts/kwdj/v1/fixtures/mixed.json");

#[test]
fn declared_corpus_table_geometries() {
    for (raw, id, name, rows, columns) in [
        (POSITIVE, "DOC-010", "rectangular_table", 2, 2),
        (POSITIVE, "DOC-011", "table_spans_alignment", 3, 2),
        (MIXED, "DOC-012", "valid_effective_grid", 2, 2),
    ] {
        let document = corpus_case(raw, id, name);
        assert_eq!(
            geometry(&document, Limits::default(), None),
            Ok(TableGeometry { rows, columns }),
            "{id}/{name}"
        );
    }
    let malformed = corpus_case(MIXED, "DOC-012", "malformed_effective_grid");
    let error = geometry(&malformed, Limits::default(), None).unwrap_err();
    assert_eq!(error, GeometryError::ExtraCell(Slot { row: 1, column: 2 }));
    assert_eq!(
        error.diagnostic("/content/0"),
        KwdjError::new(KwdjErrorCode::TableNotRectangular, "/content/0")
    );
}

// Cell tuples hold authored (rowspan, colspan). Unit attrs are omitted.
fn table(rows: &[&[(u64, u64)]]) -> Node {
    Node::Table {
        content: rows
            .iter()
            .map(|cells| Node::TableRow {
                content: cells
                    .iter()
                    .map(|&(rows, columns)| Node::TableCell {
                        attrs: (rows != 1 || columns != 1).then_some(TableCellAttrs {
                            rowspan: (rows != 1).then_some(rows),
                            colspan: (columns != 1).then_some(columns),
                            align: None,
                        }),
                        content: vec![Node::Paragraph {
                            attrs: None,
                            content: Vec::new(),
                        }],
                    })
                    .collect(),
            })
            .collect(),
    }
}

#[test]
fn violations_identify_first_effective_slot() {
    let u = (1, 1);
    let r2 = (2, 1);
    let c2 = (1, 2);
    let origin = |row, column, index| CellOrigin {
        at: Slot { row, column },
        index,
    };
    for (node, expected, code, path) in [
        (
            table(&[&[u, u], &[u, u, u]]),
            GeometryError::ExtraCell(Slot { row: 1, column: 2 }),
            KwdjErrorCode::TableNotRectangular,
            "/content/0",
        ),
        (
            table(&[&[u, u], &[u]]),
            GeometryError::MissingCell(Slot { row: 1, column: 1 }),
            KwdjErrorCode::TableNotRectangular,
            "/content/0",
        ),
        (
            table(&[&[r2]]),
            GeometryError::SpanPastBottom {
                at: Slot { row: 1, column: 0 },
                origin: Some(origin(0, 0, 0)),
            },
            KwdjErrorCode::TableNotRectangular,
            "/content/0/content/0/content/0/attrs/rowspan",
        ),
        (
            table(&[&[u, r2, u], &[c2]]),
            GeometryError::Overlap {
                at: Slot { row: 1, column: 1 },
                origin: origin(1, 0, 0),
            },
            KwdjErrorCode::TableNotRectangular,
            "/content/0",
        ),
        (
            table(&[&[u, u, r2], &[u]]),
            GeometryError::MissingCell(Slot { row: 1, column: 1 }),
            KwdjErrorCode::TableNotRectangular,
            "/content/0",
        ),
        (
            table(&[&[(1, 0)]]),
            GeometryError::ZeroSpan {
                origin: origin(0, 0, 0),
                attribute: "colspan",
            },
            KwdjErrorCode::InvalidStructure,
            "/content/0/content/0/content/0/attrs/colspan",
        ),
        (
            table(&[]),
            GeometryError::Empty,
            KwdjErrorCode::InvalidStructure,
            "/content/0/content",
        ),
    ] {
        let error = geometry(&node, Limits::default(), None).unwrap_err();
        assert_eq!(error, expected, "{node:?}");
        assert_eq!(error.diagnostic("/content/0"), KwdjError::new(code, path));
    }
}

#[test]
fn covered_row_is_rectangular_but_full_admission_requires_an_authored_cell() {
    let node = table(&[&[(2, 2)], &[]]);
    assert_eq!(
        geometry(&node, Limits::default(), None),
        Ok(TableGeometry {
            rows: 2,
            columns: 2
        })
    );
    let document = crate::model::Document {
        schema: "klenwriter.document".into(),
        schema_version: 1,
        profile: crate::Profile::Prose,
        content: vec![node],
    };
    let bytes = serde_json::to_vec(&document).unwrap();
    let admitted = crate::validate_normalized_json(&bytes, &NoIdentities);
    assert_eq!(
        admitted.unwrap_err(),
        KwdjError::new(
            KwdjErrorCode::InvalidStructure,
            "/content/0/content/1/content"
        )
    );
}

#[test]
fn work_accounting_charges_before_span_growth_and_slot_scan() {
    let node = table(&[&[(1, 2)]]);
    let mut exact = WorkMeter::new(WorkLimits {
        units: 4,
        bytes: 16,
    });
    assert_eq!(
        geometry(&node, Limits::default(), Some(&mut exact)),
        Ok(TableGeometry {
            rows: 1,
            columns: 2
        })
    );
    assert_eq!(
        exact.usage(),
        WorkUsage {
            units: 4,
            bytes: 16
        }
    );
    assert_eq!(exact.trace().phase(WorkPhase::StaticValidation).visits, 2);

    for (limits, limit, spent) in [
        (
            WorkLimits {
                units: 3,
                bytes: 16,
            },
            LimitExceeded {
                name: "transaction_work",
                maximum: 3,
                observed: 4,
            },
            WorkUsage {
                units: 2,
                bytes: 16,
            },
        ),
        (
            WorkLimits {
                units: 4,
                bytes: 15,
            },
            LimitExceeded {
                name: "transaction_bytes",
                maximum: 15,
                observed: 16,
            },
            WorkUsage { units: 2, bytes: 0 },
        ),
    ] {
        let mut meter = WorkMeter::new(limits);
        let error = geometry(&node, Limits::default(), Some(&mut meter)).unwrap_err();
        assert_eq!(error, GeometryError::Work(limit));
        assert_eq!(
            error.diagnostic("/content/0"),
            KwdjError::operational(limit)
        );
        assert_eq!(meter.usage(), spent);
        assert_eq!(meter.trace().phase(WorkPhase::StaticValidation).visits, 2);
    }
}

#[test]
fn hard_row_and_column_limits_precede_geometry_allocation() {
    let wide: &[(u64, u64)] = &[(1, 50)];
    let unit: &[(u64, u64)] = &[(1, 1)];
    let requested = Limits {
        table_rows: u64::MAX,
        table_effective_columns: u64::MAX,
        ..Limits::default()
    };
    assert_eq!(
        geometry(&table(&[wide; 500]), requested, None),
        Ok(TableGeometry {
            rows: 500,
            columns: 50
        })
    );
    let mut row_meter = WorkMeter::new(WorkLimits::default());
    let error = geometry(&table(&[unit; 501]), requested, Some(&mut row_meter)).unwrap_err();
    assert_eq!(
        error,
        GeometryError::RowLimit(LimitExceeded {
            name: "table_rows",
            maximum: 500,
            observed: 501
        })
    );
    assert_eq!(
        error.diagnostic("/content/0"),
        KwdjError::limit("/content/0", "table_rows", 500, 501)
    );
    assert_eq!(row_meter.usage(), WorkUsage { units: 0, bytes: 0 });
    assert_eq!(
        row_meter.trace().phase(WorkPhase::StaticValidation).visits,
        0
    );
    for width in [51, u64::MAX] {
        let mut col_meter = WorkMeter::new(WorkLimits::default());
        // Both axes are invalid. The column limit must win before the rowspan check.
        let error =
            geometry(&table(&[&[(2, width)]]), requested, Some(&mut col_meter)).unwrap_err();
        assert_eq!(
            error.diagnostic("/content/0"),
            KwdjError::limit(
                "/content/0/content/0/content/0/attrs/colspan",
                "table_effective_columns",
                50,
                width
            )
        );
        assert_eq!(col_meter.usage(), WorkUsage { units: 2, bytes: 0 });
    }
}
