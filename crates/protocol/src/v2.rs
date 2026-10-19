// SPDX-License-Identifier: MIT OR Apache-2.0
//! Explicit extension negotiation; legacy SDK1 declarations remain unchanged.
use crate::{AccessDto, AdmissionDto, ExtensionDto, ProfileDto};
use serde::{Deserialize, Serialize};

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SelectionTextRequestV2 {
    SelectionText {
        stamp: crate::StampDto,
        max_bytes: u32,
    },
}
#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SelectionTextReplyV2 {
    SelectionText {
        stamp: crate::StampDto,
        selection: crate::SelectionDto,
        projection_id: String,
        text: String,
        empty: bool,
        selected_atoms: Vec<String>,
    },
}
#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum BridgeRequestV2 {
    SelectionText(SelectionTextRequestV2),
    Common(crate::BridgeRequest),
}
#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum SdkReplyV2 {
    SelectionText(SelectionTextReplyV2),
    Common(crate::SdkReply),
}
#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum SdkResponseV2 {
    Ok { value: Box<SdkReplyV2> },
    Refused { diagnostic: crate::DiagnosticDto },
    Fatal { diagnostic: crate::DiagnosticDto },
}
impl From<crate::SdkResponse> for SdkResponseV2 {
    fn from(value: crate::SdkResponse) -> Self {
        match value {
            crate::SdkResponse::Ok { value } => Self::Ok {
                value: Box::new(SdkReplyV2::Common(*value)),
            },
            crate::SdkResponse::Refused { diagnostic } => Self::Refused { diagnostic },
            crate::SdkResponse::Fatal { diagnostic } => Self::Fatal { diagnostic },
        }
    }
}

pub const SDK_ABI_V2: &str = "editor-sdk/2";
pub const REGISTRY_FORMAT: &str = "editor-registry/1";

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CompiledProfileV2 {
    pub profile_id: String,
    pub profile_version: String,
    pub codec_id: String,
    pub wire_version: u32,
    pub compiled_extensions: Vec<ExtensionDto>,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SdkManifestV2 {
    pub abi: String,
    pub build_id: String,
    pub registry_format: String,
    pub profiles: Vec<CompiledProfileV2>,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct OpenOptionsV2 {
    pub abi: String,
    pub build_id: String,
    pub profile: ProfileDto,
    pub admission: AdmissionDto,
    pub access: AccessDto,
    pub registry_json: String,
    pub profile_options_json: String,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SessionContextV2 {
    pub build_id: String,
    pub profile: ProfileDto,
    pub registry_digest: String,
    pub capability_digest: String,
}
