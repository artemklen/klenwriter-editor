// SPDX-License-Identifier: MIT OR Apache-2.0
//! Shared closed wire values; no engine or concrete-profile dependency.

use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeMap;
pub mod v2;

pub const SDK_ABI: &str = "editor-sdk/1";

fn required_option<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(deserializer)
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProfileDto {
    pub profile_id: String,
    pub profile_version: String,
    pub codec_id: String,
    pub wire_version: u32,
    pub extensions: Vec<ExtensionDto>,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExtensionDto {
    pub id: String,
    pub version: String,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SdkManifest {
    pub abi: String,
    pub build_id: String,
    pub profiles: Vec<ProfileDto>,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AdmissionDto {
    Validate,
    Normalize,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AccessDto {
    Editable,
    ReadOnly,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct StampDto {
    pub session: String,
    pub generation: String,
    pub revision: String,
    pub selection_epoch: String,
    pub history_epoch: String,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AffinityDto {
    Before,
    After,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum PositionDto {
    Text {
        node: String,
        offset: u32,
        affinity: AffinityDto,
    },
    Child {
        parent: String,
        index: u32,
        affinity: AffinityDto,
    },
    Edge {
        node: String,
        side: AffinityDto,
    },
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SelectionDto {
    pub anchor: PositionDto,
    pub focus: PositionDto,
}

/// JSON numeric lexemes stay strings, preserving authored u64/i64/f64 values.
#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum AttributeDto {
    Null {},
    Boolean {
        value: bool,
    },
    Number {
        value: String,
    },
    String {
        value: String,
    },
    List {
        value: Vec<AttributeDto>,
    },
    Object {
        value: BTreeMap<String, AttributeDto>,
    },
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct MarkDto {
    pub type_id: String,
    pub attributes: BTreeMap<String, AttributeDto>,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CommandDto {
    pub id: String,
    /// Profile-specific typed payload, serialized as JSON without numeric loss.
    pub payload_json: String,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum HistoryHintDto {
    Isolated {},
    Typing {
        token: String,
        class: TypingClassDto,
    },
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TypingClassDto {
    Insert,
    DeleteBackward,
    DeleteForward,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HistoryDirectionDto {
    Undo,
    Redo,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct DiagnosticDto {
    pub code: String,
    pub path: String,
    pub category: String,
    pub details: BTreeMap<String, String>,
    #[serde(deserialize_with = "required_option")]
    pub stamp: Option<Box<StampDto>>,
    pub may_have_committed: bool,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HistoryViewDto {
    pub undo_entries: String,
    pub redo_entries: String,
    pub retained_bytes: String,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ResourceCountsDto {
    pub sessions: u32,
    pub snapshot_handles: u32,
    pub snapshot_bytes: String,
    pub protected_cursors: u32,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct StateDto {
    pub stamp: StampDto,
    pub root: String,
    #[serde(deserialize_with = "required_option")]
    pub selection: Option<SelectionDto>,
    #[serde(deserialize_with = "required_option")]
    pub stored_marks: Option<Vec<MarkDto>>,
    pub dirty: bool,
    pub saved_revision: String,
    pub history: HistoryViewDto,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NodeStatsDto {
    pub authored_nodes: String,
    pub text_utf8: String,
    pub text_utf16: String,
    pub height: String,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NodeViewDto {
    pub stamp: StampDto,
    pub id: String,
    #[serde(deserialize_with = "required_option")]
    pub parent: Option<String>,
    pub type_id: String,
    pub primitive: String,
    pub attributes: BTreeMap<String, AttributeDto>,
    pub marks: Vec<MarkDto>,
    #[serde(deserialize_with = "required_option")]
    pub text: Option<String>,
    pub children: Vec<String>,
    pub changed_revision: String,
    pub stats: NodeStatsDto,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PresentationDto {
    pub active: String,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ImpactDto {
    pub upserted: Vec<String>,
    pub removed: Vec<String>,
    pub ancestors_before: Vec<String>,
    pub ancestors_after: Vec<String>,
    pub root_order_changed: bool,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum EventKindDto {
    Document {
        impact: ImpactDto,
        from_revision: String,
        to_revision: String,
    },
    State {
        selection_changed: bool,
        stored_marks_changed: bool,
        history_changed: bool,
        baseline_changed: bool,
    },
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EventDto {
    pub sequence: String,
    pub before: StampDto,
    pub after: StampDto,
    #[serde(deserialize_with = "required_option")]
    pub selection_before: Option<SelectionDto>,
    #[serde(deserialize_with = "required_option")]
    pub selection_after: Option<SelectionDto>,
    #[serde(deserialize_with = "required_option")]
    pub stored_marks_before: Option<Vec<MarkDto>>,
    #[serde(deserialize_with = "required_option")]
    pub stored_marks_after: Option<Vec<MarkDto>>,
    pub dirty_before: bool,
    pub dirty_after: bool,
    pub history: HistoryViewDto,
    pub change: EventKindDto,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SdkReply {
    State {
        state: StateDto,
    },
    Catalog {
        commands: Vec<String>,
    },
    Node {
        node: NodeViewDto,
    },
    Availability {
        available: bool,
        #[serde(deserialize_with = "required_option")]
        effect: Option<String>,
        #[serde(deserialize_with = "required_option")]
        presentation: Option<PresentationDto>,
        #[serde(deserialize_with = "required_option")]
        diagnostic: Option<DiagnosticDto>,
    },
    Mutation {
        effect: String,
        state: StateDto,
        #[serde(deserialize_with = "required_option")]
        presentation: Option<PresentationDto>,
    },
    Snapshot {
        handle: String,
        canonical_json: String,
        stamp: StampDto,
        profile: ProfileDto,
        event_sequence: String,
    },
    Released {},
    Mapped {
        status: String,
        #[serde(deserialize_with = "required_option")]
        position: Option<PositionDto>,
        deleted: bool,
        stamp: StampDto,
    },
    Events {
        events: Vec<EventDto>,
        cursor: String,
        gap: bool,
    },
    Resources {
        resources: ResourceCountsDto,
    },
    Destroyed {},
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum SdkResponse {
    Ok { value: Box<SdkReply> },
    Refused { diagnostic: DiagnosticDto },
    Fatal { diagnostic: DiagnosticDto },
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum BridgeRequest {
    State {},
    Catalog {},
    Node {
        stamp: StampDto,
        node: String,
    },
    QueryCommand {
        stamp: StampDto,
        command: CommandDto,
    },
    Command {
        stamp: StampDto,
        command: CommandDto,
        history_hint: HistoryHintDto,
    },
    QueryHistory {
        stamp: StampDto,
        direction: HistoryDirectionDto,
    },
    History {
        stamp: StampDto,
        direction: HistoryDirectionDto,
    },
    SetSelection {
        stamp: StampDto,
        #[serde(deserialize_with = "required_option")]
        selection: Option<SelectionDto>,
    },
    SetStoredMarks {
        stamp: StampDto,
        #[serde(deserialize_with = "required_option")]
        marks: Option<Vec<MarkDto>>,
    },
    Barrier {
        stamp: StampDto,
    },
    Snapshot {
        stamp: StampDto,
        max_bytes: u32,
    },
    AcknowledgeSnapshot {
        stamp: StampDto,
        handle: String,
    },
    ReconcileSnapshot {
        stamp: StampDto,
        handle: String,
    },
    ReleaseSnapshot {
        handle: String,
    },
    MapPosition {
        stamp: StampDto,
        from_revision: String,
        position: PositionDto,
    },
    Events {},
    AcknowledgeEvents {
        cursor: String,
    },
    Remount {
        stamp: StampDto,
        input_json: String,
        admission: AdmissionDto,
    },
    Resources {},
    Destroy {},
}
