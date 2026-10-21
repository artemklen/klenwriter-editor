// SPDX-License-Identifier: MIT OR Apache-2.0
//! Additive ABI2 profile command; legacy KwdjIntentDto stays closed.
use serde::{Deserialize, Serialize};
#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum KwdjClipboardIntentV2 {
    InsertFragment { fragment_json: String },
}
