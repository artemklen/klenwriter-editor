// SPDX-License-Identifier: MIT OR Apache-2.0
//! Shared test-only envelope decoding for the four coverage-guided families.
#![forbid(unsafe_code)]

use editor_reliability_native::model::Context;

pub const FAMILY_ADMISSION_OPTIONS: &str = "admission_options";
pub const FAMILY_REGISTRY_GRAMMAR_ATTRS_RECIPES: &str = "registry_grammar_attrs_recipes";
pub const FAMILY_POSITIONS_MAPS_STATE_HISTORY_EVENTS: &str = "positions_maps_state_history_events";
pub const FAMILY_BRIDGE_LIFECYCLE_FACTS_STALE_TOKENS: &str = "bridge_lifecycle_facts_stale_tokens";

/// First envelope byte selects the profile context; every remaining byte is the
/// untouched family payload. This framing is test-only exactly like the bridge
/// JSON envelope: production admission/options/request paths always receive the
/// payload bytes verbatim, and a malformed envelope is a harness non-admission,
/// never a production typed refusal.
pub fn family_input(raw: &[u8]) -> Option<(Context, &[u8])> {
    let (&selector, payload) = raw.split_first()?;
    let context = match selector % 4 {
        0 => Context::KwdjProse,
        1 => Context::KwdjPoetry,
        2 => Context::NotesD0,
        _ => Context::NotesD1,
    };
    Some((context, payload))
}
