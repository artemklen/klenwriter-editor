// SPDX-License-Identifier: MIT OR Apache-2.0
//! Versioned public data boundary. TS declarations are generated from these DTOs.

use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeMap;

pub const SDK_ABI: &str = "editor-sdk/1";

// A present null is distinct from a missing field at this closed wire boundary.
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
pub struct IdentityFactDto {
    pub id: String,
    pub status: IdentityFactStatusDto,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IdentityFactStatusDto {
    Exists,
    Missing,
    Unavailable,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(deny_unknown_fields)]
pub struct IdentityFactsDto {
    pub media: Vec<IdentityFactDto>,
    pub references: Vec<IdentityFactDto>,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProfileLimitsDto {
    #[serde(deserialize_with = "required_option")]
    pub document_bytes: Option<String>,
    #[serde(deserialize_with = "required_option")]
    pub tree_depth: Option<String>,
    #[serde(deserialize_with = "required_option")]
    pub node_count: Option<String>,
    #[serde(deserialize_with = "required_option")]
    pub text_leaf_bytes: Option<String>,
    #[serde(deserialize_with = "required_option")]
    pub table_rows: Option<String>,
    #[serde(deserialize_with = "required_option")]
    pub table_effective_columns: Option<String>,
    #[serde(deserialize_with = "required_option")]
    pub authored_attribute_bytes: Option<String>,
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct OpenOptions {
    pub abi: String,
    pub build_id: String,
    pub profile: ProfileDto,
    pub admission: AdmissionDto,
    pub access: AccessDto,
    pub identities: IdentityFactsDto,
    #[serde(deserialize_with = "required_option")]
    pub limits: Option<ProfileLimitsDto>,
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
pub enum BlockTargetDto {
    Paragraph {},
    Heading {
        level: u8,
    },
    CodeBlock {
        #[serde(deserialize_with = "required_option")]
        language: Option<String>,
    },
    Blockquote {},
    BulletList {},
    OrderedList {
        start: String,
    },
    TaskList {},
    SceneBreak {},
    Table {},
    Poetry {},
    Media {},
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ListKindDto {
    Bullet {},
    Ordered { start: String },
    Task {},
}

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum KwdjIntentDto {
    Enter {},
    ShiftEnter {},
    ToggleMark {
        mark: MarkDto,
    },
    SetLink {
        href: String,
        #[serde(deserialize_with = "required_option")]
        title: Option<String>,
    },
    UnsetLink {},
    InsertText {
        text: String,
    },
    TransformBlock {
        target: BlockTargetDto,
    },
    ToggleQuote {},
    ToggleList {
        list: ListKindDto,
    },
    InsertBlock {
        target: BlockTargetDto,
    },
    Move {
        node: String,
        parent: String,
        before_index: u32,
    },
    Duplicate {
        node: String,
        parent: String,
        index: u32,
    },
    Remove {
        node: String,
    },
    AcceptSlash {
        target: BlockTargetDto,
        range: SelectionDto,
        literal: String,
    },
    DismissSlash {},
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
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SdkRequest {
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
    UpdateFacts {
        stamp: StampDto,
        identities: IdentityFactsDto,
    },
    Resources {},
    Destroy {},
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn stamp() -> serde_json::Value {
        json!({"session":"token", "generation":"1", "revision":"0", "selection_epoch":"0", "history_epoch":"0"})
    }

    #[test]
    fn limits_and_open_options_distinguish_required_null_from_absent_and_numeric_values() {
        let fields = [
            "document_bytes",
            "tree_depth",
            "node_count",
            "text_leaf_bytes",
            "table_rows",
            "table_effective_columns",
            "authored_attribute_bytes",
        ];
        let mut limits = serde_json::Map::new();
        for field in fields {
            limits.insert(field.into(), serde_json::Value::Null);
        }
        assert!(serde_json::from_value::<ProfileLimitsDto>(limits.clone().into()).is_ok());
        for field in fields {
            let mut missing = limits.clone();
            missing.remove(field);
            assert!(serde_json::from_value::<ProfileLimitsDto>(missing.into()).is_err());
            let mut number = limits.clone();
            number.insert(field.into(), json!(1));
            assert!(serde_json::from_value::<ProfileLimitsDto>(number.into()).is_err());
        }
        let mut options = json!({"abi":SDK_ABI,"build_id":"unbuilt-editor-sdk", "profile":{
            "profile_id":"org.klenwriter.kwdj", "profile_version":"1.0.0", "codec_id":"org.klenwriter.kwdj/json", "wire_version":1, "extensions":[]},
            "admission":"validate", "access":"editable", "identities":{"media":[],"references":[]},"limits":null});
        assert!(serde_json::from_value::<OpenOptions>(options.clone()).is_ok());
        options.as_object_mut().unwrap().remove("limits");
        assert!(serde_json::from_value::<OpenOptions>(options).is_err());
    }

    #[test]
    fn nullable_enum_fields_preserve_presence_and_explicit_null() {
        for (kind, field) in [
            ("set_selection", "selection"),
            ("set_stored_marks", "marks"),
        ] {
            let mut request = json!({"kind":kind,"stamp":stamp(),(field):null});
            assert!(serde_json::from_value::<SdkRequest>(request.clone()).is_ok());
            request.as_object_mut().unwrap().remove(field);
            assert!(serde_json::from_value::<SdkRequest>(request).is_err());
        }
        assert!(
            serde_json::from_value::<BlockTargetDto>(json!({"kind":"code_block","language":null}))
                .is_ok()
        );
        assert!(serde_json::from_value::<BlockTargetDto>(json!({"kind":"code_block"})).is_err());
        assert!(
            serde_json::from_value::<KwdjIntentDto>(
                json!({"kind":"set_link","href":"https://example.com","title":null})
            )
            .is_ok()
        );
        assert!(
            serde_json::from_value::<KwdjIntentDto>(
                json!({"kind":"set_link","href":"https://example.com"})
            )
            .is_err()
        );
        let mut availability = json!({"kind":"availability","available":false,"effect":null,"presentation":null,"diagnostic":null});
        assert!(serde_json::from_value::<SdkReply>(availability.clone()).is_ok());
        availability.as_object_mut().unwrap().remove("diagnostic");
        assert!(serde_json::from_value::<SdkReply>(availability).is_err());
    }

    #[test]
    fn every_empty_tagged_variant_rejects_unknown_fields_and_preserves_literal_json() {
        macro_rules! check_units {
            ($ty:ty, [$($kind:literal),* $(,)?]) => { $(
                let expected = json!({"kind":$kind});
                let typed = serde_json::from_value::<$ty>(expected.clone()).unwrap();
                assert_eq!(serde_json::to_value(typed).unwrap(), expected);
                assert!(serde_json::from_value::<$ty>(json!({"kind":$kind,"extra":true})).is_err(), $kind);
            )* };
        }
        check_units!(
            SdkRequest,
            ["state", "catalog", "events", "resources", "destroy"]
        );
        check_units!(SdkReply, ["released", "destroyed"]);
        check_units!(
            KwdjIntentDto,
            [
                "enter",
                "shift_enter",
                "unset_link",
                "toggle_quote",
                "dismiss_slash"
            ]
        );
        check_units!(
            BlockTargetDto,
            [
                "paragraph",
                "blockquote",
                "bullet_list",
                "task_list",
                "scene_break",
                "table",
                "poetry",
                "media"
            ]
        );
        check_units!(ListKindDto, ["bullet", "task"]);
        check_units!(HistoryHintDto, ["isolated"]);
        assert!(
            serde_json::from_value::<AttributeDto>(json!({"kind":"null","extra":true})).is_err()
        );
        assert!(
            serde_json::from_value::<AttributeDto>(json!({"kind":"null","value":null})).is_err()
        );
        for expected in [
            json!({"kind":"null"}),
            json!({"kind":"boolean","value":true}),
            json!({"kind":"number","value":"18446744073709551615"}),
            json!({"kind":"string","value":"e\u{301} \u{a0}"}),
            json!({"kind":"list","value":[{"kind":"null"}]}),
            json!({"kind":"object","value":{"key":{"kind":"number","value":"-1.25e+3"}}}),
        ] {
            let typed: AttributeDto = serde_json::from_value(expected.clone()).unwrap();
            assert_eq!(serde_json::to_value(typed).unwrap(), expected);
        }
    }

    #[test]
    fn boxed_reply_and_diagnostic_keep_literal_wire_values_and_typing_hint_context() {
        let response = json!({"status":"ok","value":{"kind":"released"}});
        let typed: SdkResponse = serde_json::from_value(response.clone()).unwrap();
        assert_eq!(serde_json::to_value(typed).unwrap(), response);
        let diagnostic = json!({"code":"sdk.example","path":"/","category":"request","details":{},"stamp":stamp(),"may_have_committed":false});
        let typed: DiagnosticDto = serde_json::from_value(diagnostic.clone()).unwrap();
        assert_eq!(serde_json::to_value(typed).unwrap(), diagnostic);
        let hint =
            json!({"kind":"typing","token":"18446744073709551615","class":"delete_backward"});
        assert_eq!(
            serde_json::to_value(serde_json::from_value::<HistoryHintDto>(hint.clone()).unwrap())
                .unwrap(),
            hint
        );
        assert!(serde_json::from_value::<HistoryHintDto>(json!({"kind":"typing"})).is_err());
    }
}
