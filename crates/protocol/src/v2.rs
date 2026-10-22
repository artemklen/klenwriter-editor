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
pub enum TextWindowRequestV2 {
    TextWindow {
        stamp: crate::StampDto,
        before_utf16: u32,
        after_utf16: u32,
    },
}
#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TextWindowSpanV2 {
    pub node: String,
    pub from_utf16: u32,
    pub to_utf16: u32,
    pub text: String,
}
#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TextWindowNodeV2 {
    pub node: String,
    pub type_id: String,
    pub primitive: String,
}
#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TextWindowBoundaryV2 {
    Block,
    InlineAtom,
    HardBreak,
    WindowLimit,
}
#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum TextWindowReplyV2 {
    TextWindow {
        stamp: crate::StampDto,
        selection: crate::SelectionDto,
        block: TextWindowNodeV2,
        caret: crate::PositionDto,
        ancestors: Vec<TextWindowNodeV2>,
        before: Vec<TextWindowSpanV2>,
        after: Vec<TextWindowSpanV2>,
        before_stop: TextWindowBoundaryV2,
        after_stop: TextWindowBoundaryV2,
    },
}

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
    InputCommand(InputCommandRequestV2),
    QueryInputCommand(QueryInputCommandRequestV2),
    ClipboardContext(ClipboardContextRequestV2),
    SelectionFragment(SelectionFragmentRequestV2),
    TextWindow(TextWindowRequestV2),
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
    InputMutation(Box<InputMutationReplyV2>),
    ClipboardContext(ClipboardContextReplyV2),
    SelectionFragment(SelectionFragmentReplyV2),
    TextWindow(TextWindowReplyV2),
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

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ClipboardContextRequestV2 {
    ClipboardContext { stamp: crate::StampDto },
}
#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ClipboardContextReplyV2 {
    ClipboardContext {
        stamp: crate::StampDto,
        selection: crate::SelectionDto,
        format_id: String,
        context_json: String,
    },
}
#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SelectionFragmentRequestV2 {
    SelectionFragment {
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
pub enum SelectionFragmentReplyV2 {
    SelectionFragment {
        stamp: crate::StampDto,
        selection: crate::SelectionDto,
        format_id: String,
        fragment_json: String,
        empty: bool,
    },
}
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

// Closed generic input result transport; SDK1 DTOs remain unchanged.
#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InputOriginV2 {
    OrdinaryInsertText,
    CompositionCommit,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RawInputRestoreFormatV2 {
    #[serde(rename = "org.klenwriter.editor/raw-input-restore/1")]
    V1,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InputMutationEffectV2 {
    Changed,
    StateChanged,
    Unchanged,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum InputCommandRequestV2 {
    InputCommand {
        stamp: crate::StampDto,
        command: crate::CommandDto,
    },
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum QueryInputCommandRequestV2 {
    QueryInputCommand {
        stamp: crate::StampDto,
        command: crate::CommandDto,
    },
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum TextReplacementResultV2 {
    TextReplacement {
        before_stamp: crate::StampDto,
        after_stamp: crate::StampDto,
        original: InputOriginalV2,
        before: InputSourceRegionV2,
        after: InputFinalRegionV2,
        after_selection: crate::SelectionDto,
        #[serde(deserialize_with = "crate::required_option")]
        after_stored_marks: Option<Vec<crate::MarkDto>>,
        #[serde(deserialize_with = "crate::required_option")]
        raw_restore: Option<RawInputRestoreV2>,
    },
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum InputMutationReplyV2 {
    InputMutation {
        effect: InputMutationEffectV2,
        state: crate::StateDto,
        #[serde(deserialize_with = "crate::required_option")]
        presentation: Option<crate::PresentationDto>,
        #[serde(deserialize_with = "crate::required_option")]
        result: Option<TextReplacementResultV2>,
    },
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct InputOriginalV2 {
    pub origin: InputOriginV2,
    pub selection: crate::SelectionDto,
    pub text: String,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct InputSourceRegionV2 {
    pub block: String,
    pub range: crate::SelectionDto,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct InputTextRunV2 {
    pub type_id: String,
    pub attributes: std::collections::BTreeMap<String, crate::AttributeDto>,
    pub marks: Vec<crate::MarkDto>,
    pub text: String,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct InputTextSpanV2 {
    pub node: String,
    pub from_utf16: u32,
    pub to_utf16: u32,
    pub type_id: String,
    pub attributes: std::collections::BTreeMap<String, crate::AttributeDto>,
    pub marks: Vec<crate::MarkDto>,
    pub text: String,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct InputFinalRegionV2 {
    pub block: String,
    pub range: crate::SelectionDto,
    pub spans: Vec<InputTextSpanV2>,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RawInputRestoreV2 {
    pub format_id: RawInputRestoreFormatV2,
    pub stamp: crate::StampDto,
    pub selection: crate::SelectionDto,
    #[serde(deserialize_with = "crate::required_option")]
    pub stored_marks: Option<Vec<crate::MarkDto>>,
    pub cooked: InputFinalRegionV2,
    pub raw: Vec<InputTextRunV2>,
    pub raw_caret_utf16: u32,
    #[serde(deserialize_with = "crate::required_option")]
    pub raw_stored_marks: Option<Vec<crate::MarkDto>>,
}

#[cfg(test)]
mod input_transport_tests {
    use super::*;
    use serde_json::json;
    fn stamp() -> serde_json::Value {
        json!({"session":"s1:1:1","generation":"1","revision":"0","selection_epoch":"0","history_epoch":"0"})
    }
    #[test]
    fn input_requests_are_closed_and_legacy_request_cannot_accept_them() {
        for kind in ["input_command", "query_input_command"] {
            let good = json!({"kind":kind,"stamp":stamp(),"command":{"id":"org.example/input","payload_json":"{}"}});
            assert!(serde_json::from_value::<BridgeRequestV2>(good.clone()).is_ok());
            assert!(serde_json::from_value::<crate::BridgeRequest>(good.clone()).is_err());
            let mut extra = good;
            extra["history_hint"] = json!({"kind":"typing","token":"1","class":"insert"});
            assert!(serde_json::from_value::<BridgeRequestV2>(extra).is_err());
        }
    }
    #[test]
    fn input_reply_required_nulls_and_legacy_mutation_are_separate() {
        let state = json!({"stamp":stamp(),"root":"n1:1:1:1","selection":null,"stored_marks":null,"dirty":false,"saved_revision":"0","history":{"undo_entries":"0","redo_entries":"0","retained_bytes":"0"}});
        let good = json!({"kind":"input_mutation","effect":"unchanged","state":state,"presentation":null,"result":null});
        assert!(serde_json::from_value::<SdkReplyV2>(good.clone()).is_ok());
        assert!(serde_json::from_value::<crate::SdkReply>(good.clone()).is_err());
        for field in ["result", "presentation"] {
            let mut missing = good.clone();
            missing.as_object_mut().unwrap().remove(field);
            assert!(serde_json::from_value::<SdkReplyV2>(missing).is_err());
        }
        let mut effect = good.clone();
        effect["effect"] = json!("pretend");
        assert!(serde_json::from_value::<SdkReplyV2>(effect).is_err());
        let mut legacy = good;
        legacy["kind"] = json!("mutation");
        assert!(serde_json::from_value::<crate::SdkReply>(legacy).is_err());
    }
    #[test]
    fn origin_and_restore_format_have_no_unknown_variants() {
        assert!(serde_json::from_value::<InputOriginV2>(json!("composition_commit")).is_ok());
        assert!(serde_json::from_value::<InputOriginV2>(json!("trusted_browser")).is_err());
        assert!(
            serde_json::from_value::<RawInputRestoreFormatV2>(json!(
                "org.klenwriter.editor/raw-input-restore/1"
            ))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<RawInputRestoreFormatV2>(json!(
                "org.klenwriter.editor/raw-input-restore/2"
            ))
            .is_err()
        );
    }
}
