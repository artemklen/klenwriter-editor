// SPDX-License-Identifier: MIT OR Apache-2.0
//! Exact ABI1 KWDJ adapter values; common types have one defining crate.

pub use editor_protocol::*;
use serde::{Deserialize, Deserializer, Serialize};

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
    DeleteBackward {},
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
                "dismiss_slash",
                "delete_backward"
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
