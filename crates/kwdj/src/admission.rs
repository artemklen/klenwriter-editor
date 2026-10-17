// SPDX-License-Identifier: MIT OR Apache-2.0
//! Operational admission policy, separate from persisted KWDJ v1 validity.

use editor_core::admission::{PreflightBudget, preflight_json};
use serde_json::Value;

use crate::{KwdjError, KwdjErrorCode};

pub const RAW_INPUT_BYTE_CEILING: u64 = 16 * 1024 * 1024;

/// Per-input operational ceilings. Raw bytes are checked before parsing; the
/// borrowed preflight bounds payload/metadata traversal before later copies.
/// Hosts may tighten these ceilings without changing storage validity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AdmissionBudget {
    pub raw_input_bytes: u64,
    pub preflight: PreflightBudget,
}

impl Default for AdmissionBudget {
    fn default() -> Self {
        Self {
            raw_input_bytes: RAW_INPUT_BYTE_CEILING,
            preflight: PreflightBudget::default(),
        }
    }
}

impl AdmissionBudget {
    pub fn effective(self) -> Self {
        Self {
            raw_input_bytes: self.raw_input_bytes.min(RAW_INPUT_BYTE_CEILING),
            preflight: self.preflight.effective(),
        }
    }
}

pub(crate) fn parse_raw(input: &[u8], budget: AdmissionBudget) -> Result<Value, KwdjError> {
    editor_core::limits::check(
        "raw_input_bytes",
        budget.effective().raw_input_bytes,
        input.len() as u64,
    )
    .map_err(KwdjError::operational)?;
    serde_json::from_slice(input).map_err(|_| KwdjError::new(KwdjErrorCode::InvalidJson, ""))
}

pub(crate) fn check_value(value: &Value, budget: AdmissionBudget) -> Result<(), KwdjError> {
    preflight_json(value, budget.preflight)
        .map(|_| ())
        .map_err(KwdjError::operational)
}
