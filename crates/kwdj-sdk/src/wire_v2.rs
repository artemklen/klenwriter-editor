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

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum KwdjTypingIntentV2 {
    InsertTypedText {
        text: String,
        origin: editor_protocol::v2::InputOriginV2,
    },
    RestoreTypedText {
        restore: Box<editor_protocol::v2::RawInputRestoreV2>,
    },
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KwdjTypingLocaleV2 {
    Ru,
    En,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KwdjTypingFeatureV2 {
    SpacedEmDash,
    DoubleQuotes,
    CyrillicNbsp,
}

fn required_typing_option<'de, T: Deserialize<'de>, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(d)
}
fn present_u32<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<u32>, D::Error> {
    u32::deserialize(d).map(Some)
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct KwdjTypingRulesV2 {
    pub version: u32,
    pub locale: KwdjTypingLocaleV2,
    #[serde(deserialize_with = "required_typing_option")]
    pub rules: Option<Vec<KwdjTypingFeatureV2>>,
    #[serde(deserialize_with = "required_typing_option")]
    pub limits: Option<KwdjTypingLimitsV2>,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct KwdjTypingLimitsV2 {
    #[serde(
        default,
        deserialize_with = "present_u32",
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(all(feature = "sdk-types", not(target_arch = "wasm32")), ts(optional))]
    pub lookbehind_scalars: Option<u32>,
    #[serde(
        default,
        deserialize_with = "present_u32",
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(all(feature = "sdk-types", not(target_arch = "wasm32")), ts(optional))]
    pub inline_slots: Option<u32>,
    #[serde(
        default,
        deserialize_with = "present_u32",
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(all(feature = "sdk-types", not(target_arch = "wasm32")), ts(optional))]
    pub ancestor_depth: Option<u32>,
    #[serde(
        default,
        deserialize_with = "present_u32",
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(all(feature = "sdk-types", not(target_arch = "wasm32")), ts(optional))]
    pub selected_scalars: Option<u32>,
    #[serde(
        default,
        deserialize_with = "present_u32",
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(all(feature = "sdk-types", not(target_arch = "wasm32")), ts(optional))]
    pub selected_utf8: Option<u32>,
    #[serde(
        default,
        deserialize_with = "present_u32",
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(all(feature = "sdk-types", not(target_arch = "wasm32")), ts(optional))]
    pub selected_nodes: Option<u32>,
    #[serde(
        default,
        deserialize_with = "present_u32",
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(all(feature = "sdk-types", not(target_arch = "wasm32")), ts(optional))]
    pub mark_records: Option<u32>,
    #[serde(
        default,
        deserialize_with = "present_u32",
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(all(feature = "sdk-types", not(target_arch = "wasm32")), ts(optional))]
    pub work_units: Option<u32>,
    #[serde(
        default,
        deserialize_with = "present_u32",
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(all(feature = "sdk-types", not(target_arch = "wasm32")), ts(optional))]
    pub work_bytes: Option<u32>,
    #[serde(
        default,
        deserialize_with = "present_u32",
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(all(feature = "sdk-types", not(target_arch = "wasm32")), ts(optional))]
    pub restoration_bytes: Option<u32>,
}
