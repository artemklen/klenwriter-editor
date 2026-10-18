// SPDX-License-Identifier: MIT OR Apache-2.0
//! Test-only scenario DTOs. Expected bytes are consumed verbatim, never rebuilt
//! from production exports. This module has no engine dependency.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Context {
    KwdjProse,
    KwdjPoetry,
    NotesD0,
    NotesD1,
}
impl Context {
    pub fn name(self) -> &'static str {
        match self {
            Self::KwdjProse => "kwdj-prose",
            Self::KwdjPoetry => "kwdj-poetry",
            Self::NotesD0 => "notes-d0",
            Self::NotesD1 => "notes-d1",
        }
    }
    pub fn is_kwdj(self) -> bool {
        matches!(self, Self::KwdjProse | Self::KwdjPoetry)
    }
}
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Scenario {
    pub format: String,
    pub model: String,
    pub id: String,
    pub seed: u64,
    pub context: Context,
    pub input_json: String,
    pub registry_json: String,
    pub profile_options_json: String,
    pub profile: editor_protocol::ProfileDto,
    pub admission: String,
    #[serde(rename = "initialLabels")]
    pub initial_labels: InitialLabels,
    #[serde(rename = "initialExpected")]
    pub initial_expected: Expected,
    pub actions: Vec<Action>,
    pub limits: ScenarioLimits,
    pub oracle: String,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InitialLabels {
    pub block: Vec<usize>,
    pub primary_leaf: Vec<usize>,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioLimits {
    pub actions: usize,
    pub nodes: usize,
    pub source_utf8_bytes: usize,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Expected {
    pub effect: String,
    pub canonical_json: String,
    pub selection: Option<LogicalSelection>,
    pub history: ExpectedHistory,
    pub dirty: bool,
    pub document_revision: String,
}
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct LogicalSelection {
    pub anchor_utf16: usize,
    pub focus_utf16: usize,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExpectedHistory {
    pub undo_units: usize,
    pub redo_units: usize,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    Select {
        from: usize,
        to: usize,
        expected: Expected,
    },
    InsertText {
        text: String,
        isolated: bool,
        expected: Expected,
    },
    Undo {
        expected: Expected,
    },
    Redo {
        expected: Expected,
    },
}
impl Action {
    pub fn expected(&self) -> &Expected {
        match self {
            Self::Select { expected, .. }
            | Self::InsertText { expected, .. }
            | Self::Undo { expected }
            | Self::Redo { expected } => expected,
        }
    }
}
#[derive(Debug, Clone, Serialize)]
pub struct HarnessFailure {
    pub scenario: String,
    pub action: Option<usize>,
    pub phase: String,
    pub invariant: String,
    pub detail: String,
}
impl std::fmt::Display for HarnessFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{} {:?} {} {}: {}",
            self.scenario, self.action, self.phase, self.invariant, self.detail
        )
    }
}
impl std::error::Error for HarnessFailure {}
impl HarnessFailure {
    pub fn at(
        scenario: &str,
        action: Option<usize>,
        phase: &str,
        invariant: &str,
        detail: impl std::fmt::Debug,
    ) -> Self {
        Self {
            scenario: scenario.into(),
            action,
            phase: phase.into(),
            invariant: invariant.into(),
            detail: format!("{detail:?}"),
        }
    }
}
#[derive(Debug, Clone, Default, Serialize)]
pub struct Reachability {
    pub admission_attempts: u64,
    pub admitted: u64,
    pub compiler_attempts: u64,
    pub compiled: u64,
    pub command_queries: u64,
    pub command_publications: u64,
    pub history_queries: u64,
    pub history_publications: u64,
    pub normalization_operations: u64,
    pub late_refusals: u64,
    pub event_reads: u64,
    pub snapshot_exports: u64,
    pub closed: u64,
    pub work_units: u64,
    pub work_bytes: u64,
    pub phase_visits: [u64; 13],
    pub phase_bytes: [u64; 13],
}
#[derive(Debug, Clone, Serialize)]
pub struct ReplayReport {
    pub id: String,
    pub context: Context,
    pub seed: u64,
    pub actions: usize,
    pub checkpoints: usize,
    pub exact_canonical_selection_history: bool,
    pub all_query_facets_pure: bool,
    pub query_execute_work_equal: bool,
    pub all_original_identity_restoration: bool,
    pub reachability: Reachability,
}
