// SPDX-License-Identifier: MIT OR Apache-2.0
// Derived from owner-controlled KlenWriter CMS source; see provenance/source-files.json.
//! Checked table dimensions for the full and indexed KWDJ validation lanes.

use editor_core::limits::{LimitExceeded, check};
use editor_core::transaction::{WorkMeter, WorkPhase};

use crate::model::Node;
use crate::wire_view::ValidationView;
use crate::{KwdjError, KwdjErrorCode, Limits, index_path, key_path};

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct TableGeometry {
    pub rows: usize,
    pub columns: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Slot {
    pub row: usize,
    pub column: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CellOrigin {
    pub at: Slot,
    pub index: usize,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum GeometryError {
    Empty,
    InvalidRow {
        row: usize,
    },
    InvalidCell(CellOrigin),
    ZeroSpan {
        origin: CellOrigin,
        attribute: &'static str,
    },
    SpanPastBottom {
        at: Slot,
        origin: Option<CellOrigin>,
    },
    Overlap {
        at: Slot,
        origin: CellOrigin,
    },
    ExtraCell(Slot),
    MissingCell(Slot),
    RowLimit(LimitExceeded),
    ColumnLimit {
        origin: CellOrigin,
        at_colspan: bool,
        limit: LimitExceeded,
    },
    Work(LimitExceeded),
}

impl GeometryError {
    /// Preserve the public KWDJ paths while the geometry caller can inspect slots.
    pub(crate) fn diagnostic(self, path: &str) -> KwdjError {
        use KwdjErrorCode::{InvalidStructure, TableNotRectangular};
        let span_path =
            |origin, attribute| key_path(&key_path(&cell_path(path, origin), "attrs"), attribute);
        match self {
            Self::Empty | Self::InvalidRow { .. } => {
                KwdjError::new(InvalidStructure, key_path(path, "content"))
            }
            Self::InvalidCell(origin) => KwdjError::new(
                InvalidStructure,
                key_path(&row_path(path, origin.at.row), "content"),
            ),
            Self::ZeroSpan { origin, attribute } => {
                KwdjError::new(InvalidStructure, span_path(origin, attribute))
            }
            Self::SpanPastBottom {
                origin: Some(origin),
                ..
            } => KwdjError::new(TableNotRectangular, span_path(origin, "rowspan")),
            Self::SpanPastBottom { origin: None, .. }
            | Self::Overlap { .. }
            | Self::ExtraCell(_)
            | Self::MissingCell(_) => KwdjError::new(TableNotRectangular, path),
            Self::RowLimit(limit) => {
                KwdjError::limit(path, limit.name, limit.maximum, limit.observed)
            }
            Self::ColumnLimit {
                origin,
                at_colspan,
                limit,
            } => KwdjError::limit(
                if at_colspan {
                    span_path(origin, "colspan")
                } else {
                    cell_path(path, origin)
                },
                limit.name,
                limit.maximum,
                limit.observed,
            ),
            Self::Work(limit) => KwdjError::operational(limit),
        }
    }
}

fn row_path(table: &str, row: usize) -> String {
    index_path(&key_path(table, "content"), row)
}

fn cell_path(table: &str, origin: CellOrigin) -> String {
    index_path(
        &key_path(&row_path(table, origin.at.row), "content"),
        origin.index,
    )
}

fn units(work: &mut Option<&mut WorkMeter>, amount: u64) -> Result<(), GeometryError> {
    if let Some(work) = work {
        work.charge_units(amount).map_err(GeometryError::Work)?;
    }
    Ok(())
}

/// Check rectangular coverage without validating authored row content or normalizing spans.
/// The rolling occupancy stores one remaining-row count per effective column.
pub(crate) fn check_table<V: ValidationView>(
    view: &V,
    table: V::Handle,
    limits: Limits,
    mut work: Option<&mut WorkMeter>,
) -> Result<TableGeometry, GeometryError> {
    let limits = limits.effective();
    let rows = view.children_len(table);
    let row_count = u64::try_from(rows).map_err(|_| {
        GeometryError::RowLimit(LimitExceeded {
            name: "table_rows",
            maximum: limits.table_rows,
            observed: u64::MAX,
        })
    })?;
    check("table_rows", limits.table_rows, row_count).map_err(GeometryError::RowLimit)?;
    if rows == 0 {
        return Err(GeometryError::Empty);
    }

    let mut occupancy: Vec<u64> = Vec::new();
    let mut width = None;
    for row_index in 0..rows {
        units(&mut work, 1)?;
        let row = view.child(table, row_index);
        while occupancy.last() == Some(&0) {
            occupancy.pop();
        }
        if let Some(work) = &mut work {
            work.note_phase(WorkPhase::StaticValidation, 1, 0);
        }
        let Node::TableRow { .. } = view.header(row) else {
            return Err(GeometryError::InvalidRow { row: row_index });
        };
        let mut column = 0;
        for cell_index in 0..view.children_len(row) {
            units(&mut work, 1)?;
            if let Some(work) = &mut work {
                work.note_phase(WorkPhase::StaticValidation, 1, 0);
            }
            let cell = view.header(view.child(row, cell_index));
            while occupancy.get(column).copied().unwrap_or(0) > 0 {
                column += 1;
            }
            let origin = CellOrigin {
                at: Slot {
                    row: row_index,
                    column,
                },
                index: cell_index,
            };
            let attrs = match cell {
                Node::TableHeader { attrs, .. } | Node::TableCell { attrs, .. } => attrs.as_ref(),
                _ => return Err(GeometryError::InvalidCell(origin)),
            };
            let colspan = attrs.and_then(|value| value.colspan).unwrap_or(1);
            let rowspan = attrs.and_then(|value| value.rowspan).unwrap_or(1);
            if colspan == 0 {
                return Err(GeometryError::ZeroSpan {
                    origin,
                    attribute: "colspan",
                });
            }
            if rowspan == 0 {
                return Err(GeometryError::ZeroSpan {
                    origin,
                    attribute: "rowspan",
                });
            }

            let column_limit = |observed, at_colspan| GeometryError::ColumnLimit {
                origin,
                at_colspan,
                limit: LimitExceeded {
                    name: "table_effective_columns",
                    maximum: limits.table_effective_columns,
                    observed,
                },
            };
            let column_value = u64::try_from(column).map_err(|_| column_limit(u64::MAX, false))?;
            let effective_end = column_value.saturating_add(colspan);
            check(
                "table_effective_columns",
                limits.table_effective_columns,
                effective_end,
            )
            .map_err(|limit| column_limit(limit.observed, true))?;
            let end =
                usize::try_from(effective_end).map_err(|_| column_limit(effective_end, false))?;

            // The checked row count and row_index < rows bound this conversion.
            let remaining_rows = row_count - row_index as u64;
            if rowspan > remaining_rows {
                return Err(GeometryError::SpanPastBottom {
                    at: Slot { row: rows, column },
                    origin: Some(origin),
                });
            }

            if occupancy.len() < end {
                if let Some(work) = &mut work {
                    let bytes = (end - occupancy.len()) * std::mem::size_of::<u64>();
                    work.charge_bytes(bytes as u64)
                        .map_err(GeometryError::Work)?;
                }
                occupancy.resize(end, 0);
            }
            units(&mut work, (end - column) as u64)?;
            if let Some(offset) = occupancy[column..end].iter().position(|value| *value > 0) {
                return Err(GeometryError::Overlap {
                    at: Slot {
                        row: row_index,
                        column: column + offset,
                    },
                    origin,
                });
            }
            occupancy[column..end].fill(rowspan);
            column = end;
        }
        let row_width = occupancy.len();
        if let Some(column) = occupancy.iter().position(|value| *value == 0) {
            return Err(GeometryError::MissingCell(Slot {
                row: row_index,
                column,
            }));
        }
        if let Some(expected) = width {
            if row_width > expected {
                return Err(GeometryError::ExtraCell(Slot {
                    row: row_index,
                    column: expected,
                }));
            }
            if row_width < expected {
                return Err(GeometryError::MissingCell(Slot {
                    row: row_index,
                    column: row_width,
                }));
            }
        } else {
            width = Some(row_width);
        }
        for value in &mut occupancy {
            *value = value.saturating_sub(1);
        }
    }
    if let Some(column) = occupancy.iter().position(|value| *value > 0) {
        return Err(GeometryError::SpanPastBottom {
            at: Slot { row: rows, column },
            origin: None,
        });
    }
    Ok(TableGeometry {
        rows,
        columns: width.unwrap_or(0),
    })
}

#[cfg(test)]
mod tests;
