// SPDX-License-Identifier: MIT OR Apache-2.0
use crate::{
    KwdjAdapter,
    convert::{diagnostic, profile_error},
    wire_v2::{
        KwdjClipboardIntentV2, KwdjDeleteSelectionScopeV2, KwdjForwardDeleteIntentV2,
        KwdjLabeledContainerIntentV2, KwdjLiteraryIntentV2, KwdjMediaAlignV2, KwdjMediaIntentV2,
        KwdjMediaPlacementV2, KwdjScopedSelectionIntentV2, KwdjTableCellAlignIntentV2,
        KwdjTableCellIntentV2, KwdjTableColumnIntentV2, KwdjTableRowIntentV2, KwdjWarningIntentV2,
        LabeledContainerBlockTargetV2, LabeledContainerKindV2, LiteraryBlockTargetV2,
        TableCellAlignV2, WarningBlockTargetV2, WarningKindV2,
    },
};
use editor_bridge::{BridgeAdapter, ClipboardContextData, SelectionFragmentData};
use editor_core::{candidate::CandidateRead, positions::Selection, transaction::WorkMeter};
use editor_engine::{NodeId, SessionKey};
use editor_kwdj::{
    KwdjProfile, KwdjProfileError, Profile,
    commands::{
        CLIPBOARD_COMMAND_ID, DELETE_COLUMN_COMMAND_ID, DELETE_FORWARD_COMMAND_ID,
        DELETE_ROW_COMMAND_ID, INSERT_COLUMN_LEFT_COMMAND_ID, INSERT_COLUMN_RIGHT_COMMAND_ID,
        INSERT_ROW_ABOVE_COMMAND_ID, INSERT_ROW_BELOW_COMMAND_ID, KWDJ_COMMANDS, KwdjIntent,
        LabeledContainerKind, MEDIA_COMMAND_ID, MERGE_CELLS_COMMAND_ID, MOVE_CELL_COMMAND_ID,
        MediaUsage, SET_CONTAINER_LABEL_COMMAND_ID, SET_LITERARY_KIND_COMMAND_ID,
        SET_TABLE_CELL_ALIGN_COMMAND_ID, SET_WARNING_KIND_COMMAND_ID, SPLIT_CELL_COMMAND_ID,
        UNWRAP_LABELED_CONTAINER_COMMAND_ID, UNWRAP_LITERARY_BLOCK_COMMAND_ID,
        UNWRAP_WARNING_COMMAND_ID, WRAP_LABELED_CONTAINER_COMMAND_ID,
        WRAP_LITERARY_BLOCK_COMMAND_ID, WRAP_WARNING_COMMAND_ID, clipboard,
    },
    model::{CellAlign, MediaAlign, WarningKind},
};
use editor_protocol::{CommandDto, DiagnosticDto};

#[derive(serde::Deserialize)]
#[serde(untagged)]
enum AdditionalBlockTargetV2 {
    Literary(LiteraryBlockTargetV2),
    Warning(WarningBlockTargetV2),
    LabeledContainer(LabeledContainerBlockTargetV2),
}

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum AdditionalInsertV2 {
    InsertBlock { target: AdditionalBlockTargetV2 },
}

impl From<WarningKindV2> for WarningKind {
    fn from(value: WarningKindV2) -> Self {
        match value {
            WarningKindV2::General => Self::General,
            WarningKindV2::Content => Self::Content,
        }
    }
}

impl From<KwdjMediaAlignV2> for MediaAlign {
    fn from(value: KwdjMediaAlignV2) -> Self {
        match value {
            KwdjMediaAlignV2::None => Self::None,
            KwdjMediaAlignV2::Center => Self::Center,
            KwdjMediaAlignV2::Wide => Self::Wide,
        }
    }
}

impl From<LabeledContainerKindV2> for LabeledContainerKind {
    fn from(value: LabeledContainerKindV2) -> Self {
        match value {
            LabeledContainerKindV2::Spoiler => Self::Spoiler,
            LabeledContainerKindV2::Disclosure => Self::Disclosure,
        }
    }
}

pub(crate) struct ClipboardAdapterV2(pub(crate) KwdjAdapter);
fn native(error: editor_kwdj::KwdjError) -> DiagnosticDto {
    profile_error(&KwdjProfileError::Document(error))
}
impl BridgeAdapter<KwdjProfile<'static>> for ClipboardAdapterV2 {
    fn decode_input_command(
        &self,
        key: SessionKey,
        stamp: &editor_protocol::StampDto,
        command: &CommandDto,
    ) -> Result<KwdjIntent<NodeId>, DiagnosticDto> {
        crate::typing_v2::decode_input(key, stamp, command)
    }
    fn clipboard_context<V: CandidateRead<Id = NodeId>>(
        &self,
        context: &Profile,
        view: &V,
        selection: Selection<NodeId>,
        work: &mut WorkMeter,
    ) -> Result<ClipboardContextData, DiagnosticDto> {
        let value = clipboard::context(*context, view, selection, work).map_err(native)?;
        Ok(ClipboardContextData {
            format_id: clipboard::CONTEXT_FORMAT.into(),
            context_json: serde_json::to_string(&value)
                .map_err(|_| diagnostic("sdk.transport_failed", ""))?,
        })
    }
    fn selection_fragment<V: CandidateRead<Id = NodeId>>(
        &self,
        context: &Profile,
        view: &V,
        selection: Selection<NodeId>,
        max_bytes: u32,
        work: &mut WorkMeter,
    ) -> Result<SelectionFragmentData, DiagnosticDto> {
        let (fragment_json, empty) =
            clipboard::extract(*context, view, selection, max_bytes, work).map_err(native)?;
        Ok(SelectionFragmentData {
            format_id: clipboard::FRAGMENT_FORMAT.into(),
            fragment_json,
            empty,
        })
    }
    fn selection_text<V: CandidateRead<Id = NodeId>>(
        &self,
        view: &V,
        selection: Selection<NodeId>,
        max_bytes: u32,
        work: &mut WorkMeter,
    ) -> Result<editor_bridge::SelectionTextData, DiagnosticDto> {
        self.0.selection_text(view, selection, max_bytes, work)
    }
    fn decode_command(
        &self,
        key: SessionKey,
        command: &CommandDto,
    ) -> Result<KwdjIntent<NodeId>, DiagnosticDto> {
        let parse_node = |node: &str| {
            key.parse_node_token(node)
                .map_err(|error| diagnostic(error.as_str(), "command.node"))
        };
        if command.id == MEDIA_COMMAND_ID {
            Ok(match editor_bridge::decode(&command.payload_json)? {
                KwdjMediaIntentV2::InsertMedia {
                    media_asset_id,
                    accessibility,
                    placement: None,
                    align: None,
                    caption: None,
                } => KwdjIntent::InsertMedia {
                    asset_id: media_asset_id,
                    alt: accessibility.into_alt(),
                },
                KwdjMediaIntentV2::InsertMedia {
                    media_asset_id,
                    accessibility,
                    placement,
                    align,
                    caption,
                } => KwdjIntent::InsertMediaWithUsage {
                    asset_id: media_asset_id,
                    alt: accessibility.into_alt(),
                    usage: MediaUsage {
                        after_root_block: placement
                            .map(|KwdjMediaPlacementV2::AfterRootBlock { node }| parse_node(&node))
                            .transpose()?,
                        align: align.map(MediaAlign::from).unwrap_or(MediaAlign::None),
                        caption,
                    },
                },
                KwdjMediaIntentV2::ReplaceMedia {
                    node,
                    current_asset_id,
                    media_asset_id,
                    accessibility,
                } => KwdjIntent::ReplaceMedia {
                    node: parse_node(&node)?,
                    current_asset_id,
                    asset_id: media_asset_id,
                    alt: accessibility.into_alt(),
                },
            })
        } else if command.id == CLIPBOARD_COMMAND_ID {
            let KwdjClipboardIntentV2::InsertFragment { fragment_json } =
                editor_bridge::decode(&command.payload_json)?;
            Ok(KwdjIntent::InsertFragment {
                fragment: clipboard::decode_fragment(&fragment_json).map_err(native)?,
            })
        } else if matches!(
            command.id.as_str(),
            SET_LITERARY_KIND_COMMAND_ID
                | WRAP_LITERARY_BLOCK_COMMAND_ID
                | UNWRAP_LITERARY_BLOCK_COMMAND_ID
        ) {
            let intent = editor_bridge::decode(&command.payload_json)?;
            match (command.id.as_str(), intent) {
                (
                    SET_LITERARY_KIND_COMMAND_ID,
                    KwdjLiteraryIntentV2::SetLiteraryKind { node, .. },
                ) => Ok(KwdjIntent::SetLiteraryKind {
                    node: parse_node(&node)?,
                }),
                (
                    WRAP_LITERARY_BLOCK_COMMAND_ID,
                    KwdjLiteraryIntentV2::WrapLiteraryBlock { .. },
                ) => Ok(KwdjIntent::WrapLiteraryBlock),
                (
                    UNWRAP_LITERARY_BLOCK_COMMAND_ID,
                    KwdjLiteraryIntentV2::UnwrapLiteraryBlock { node },
                ) => Ok(KwdjIntent::UnwrapLiteraryBlock {
                    node: parse_node(&node)?,
                }),
                _ => Err(diagnostic("sdk.invalid_dto", "command")),
            }
        } else if matches!(
            command.id.as_str(),
            SET_WARNING_KIND_COMMAND_ID | WRAP_WARNING_COMMAND_ID | UNWRAP_WARNING_COMMAND_ID
        ) {
            let intent = editor_bridge::decode(&command.payload_json)?;
            match (command.id.as_str(), intent) {
                (
                    SET_WARNING_KIND_COMMAND_ID,
                    KwdjWarningIntentV2::SetWarningKind { node, warning_kind },
                ) => Ok(KwdjIntent::SetWarningKind {
                    node: parse_node(&node)?,
                    warning_kind: warning_kind.into(),
                }),
                (WRAP_WARNING_COMMAND_ID, KwdjWarningIntentV2::WrapWarning { warning_kind }) => {
                    Ok(KwdjIntent::WrapWarning {
                        warning_kind: warning_kind.into(),
                    })
                }
                (UNWRAP_WARNING_COMMAND_ID, KwdjWarningIntentV2::UnwrapWarning { node }) => {
                    Ok(KwdjIntent::UnwrapWarning {
                        node: parse_node(&node)?,
                    })
                }
                _ => Err(diagnostic("sdk.invalid_dto", "command")),
            }
        } else if matches!(
            command.id.as_str(),
            SET_CONTAINER_LABEL_COMMAND_ID
                | WRAP_LABELED_CONTAINER_COMMAND_ID
                | UNWRAP_LABELED_CONTAINER_COMMAND_ID
        ) {
            let intent = editor_bridge::decode(&command.payload_json)?;
            match (command.id.as_str(), intent) {
                (
                    SET_CONTAINER_LABEL_COMMAND_ID,
                    KwdjLabeledContainerIntentV2::SetContainerLabel { node, label },
                ) => Ok(KwdjIntent::SetContainerLabel {
                    node: parse_node(&node)?,
                    label,
                }),
                (
                    WRAP_LABELED_CONTAINER_COMMAND_ID,
                    KwdjLabeledContainerIntentV2::WrapLabeledContainer {
                        container_kind,
                        label,
                    },
                ) => Ok(KwdjIntent::WrapLabeledContainer {
                    container_kind: container_kind.into(),
                    label,
                }),
                (
                    UNWRAP_LABELED_CONTAINER_COMMAND_ID,
                    KwdjLabeledContainerIntentV2::UnwrapLabeledContainer { node },
                ) => Ok(KwdjIntent::UnwrapLabeledContainer {
                    node: parse_node(&node)?,
                }),
                _ => Err(diagnostic("sdk.invalid_dto", "command")),
            }
        } else if matches!(
            command.id.as_str(),
            INSERT_ROW_ABOVE_COMMAND_ID | INSERT_ROW_BELOW_COMMAND_ID | DELETE_ROW_COMMAND_ID
        ) {
            let parse_row = |row: &str| {
                key.parse_node_token(row)
                    .map_err(|error| diagnostic(error.as_str(), "command.row"))
            };
            match (
                command.id.as_str(),
                editor_bridge::decode(&command.payload_json)?,
            ) {
                (INSERT_ROW_ABOVE_COMMAND_ID, KwdjTableRowIntentV2::InsertRowAbove { row }) => {
                    Ok(KwdjIntent::InsertRowAbove {
                        row: parse_row(&row)?,
                    })
                }
                (INSERT_ROW_BELOW_COMMAND_ID, KwdjTableRowIntentV2::InsertRowBelow { row }) => {
                    Ok(KwdjIntent::InsertRowBelow {
                        row: parse_row(&row)?,
                    })
                }
                (DELETE_ROW_COMMAND_ID, KwdjTableRowIntentV2::DeleteRow { row }) => {
                    Ok(KwdjIntent::DeleteRow {
                        row: parse_row(&row)?,
                    })
                }
                _ => Err(diagnostic("sdk.invalid_dto", "command")),
            }
        } else if command.id == SET_TABLE_CELL_ALIGN_COMMAND_ID {
            let KwdjTableCellAlignIntentV2::SetTableCellAlign { align } =
                editor_bridge::decode(&command.payload_json)?;
            Ok(KwdjIntent::SetTableCellAlign {
                align: match align {
                    TableCellAlignV2::Left => CellAlign::Left,
                    TableCellAlignV2::Center => CellAlign::Center,
                    TableCellAlignV2::Right => CellAlign::Right,
                },
            })
        } else if matches!(
            command.id.as_str(),
            INSERT_COLUMN_LEFT_COMMAND_ID
                | INSERT_COLUMN_RIGHT_COMMAND_ID
                | DELETE_COLUMN_COMMAND_ID
        ) {
            let parse_table = |table: &str| {
                key.parse_node_token(table)
                    .map_err(|error| diagnostic(error.as_str(), "command.table"))
            };
            match (
                command.id.as_str(),
                editor_bridge::decode(&command.payload_json)?,
            ) {
                (
                    INSERT_COLUMN_LEFT_COMMAND_ID,
                    KwdjTableColumnIntentV2::InsertColumnLeft { table, column },
                ) => Ok(KwdjIntent::InsertColumnLeft {
                    table: parse_table(&table)?,
                    column: column as usize,
                }),
                (
                    INSERT_COLUMN_RIGHT_COMMAND_ID,
                    KwdjTableColumnIntentV2::InsertColumnRight { table, column },
                ) => Ok(KwdjIntent::InsertColumnRight {
                    table: parse_table(&table)?,
                    column: column as usize,
                }),
                (
                    DELETE_COLUMN_COMMAND_ID,
                    KwdjTableColumnIntentV2::DeleteColumn { table, column },
                ) => Ok(KwdjIntent::DeleteColumn {
                    table: parse_table(&table)?,
                    column: column as usize,
                }),
                _ => Err(diagnostic("sdk.invalid_dto", "command")),
            }
        } else if matches!(
            command.id.as_str(),
            MERGE_CELLS_COMMAND_ID | SPLIT_CELL_COMMAND_ID | MOVE_CELL_COMMAND_ID
        ) {
            let parse_cell = |token: &str, path| {
                key.parse_node_token(token)
                    .map_err(|error| diagnostic(error.as_str(), path))
            };
            match (
                command.id.as_str(),
                editor_bridge::decode(&command.payload_json)?,
            ) {
                (MERGE_CELLS_COMMAND_ID, KwdjTableCellIntentV2::MergeCells { anchor, focus }) => {
                    Ok(KwdjIntent::MergeCells {
                        anchor: parse_cell(&anchor, "command.anchor")?,
                        focus: parse_cell(&focus, "command.focus")?,
                    })
                }
                (SPLIT_CELL_COMMAND_ID, KwdjTableCellIntentV2::SplitCell { cell }) => {
                    Ok(KwdjIntent::SplitCell {
                        cell: parse_cell(&cell, "command.cell")?,
                    })
                }
                (MOVE_CELL_COMMAND_ID, KwdjTableCellIntentV2::MoveCell { cell, target }) => {
                    Ok(KwdjIntent::MoveCell {
                        cell: parse_cell(&cell, "command.cell")?,
                        target: parse_cell(&target, "command.target")?,
                    })
                }
                _ => Err(diagnostic("sdk.invalid_dto", "command")),
            }
        } else if command.id == DELETE_FORWARD_COMMAND_ID {
            let KwdjForwardDeleteIntentV2::DeleteForward {} =
                editor_bridge::decode(&command.payload_json)?;
            Ok(KwdjIntent::DeleteForward)
        } else {
            match self.0.decode_command(key, command) {
                Err(legacy) if command.id == KWDJ_COMMANDS[16].id => {
                    let KwdjScopedSelectionIntentV2::DeleteSelection { scope } =
                        editor_bridge::decode(&command.payload_json).map_err(|_| legacy)?;
                    Ok(match scope {
                        KwdjDeleteSelectionScopeV2::ProfileBody => {
                            KwdjIntent::DeleteSelectionInProfileBody
                        }
                        KwdjDeleteSelectionScopeV2::PoetryBoundary => {
                            KwdjIntent::DeleteSelectionAtPoetryBoundary
                        }
                    })
                }
                Err(legacy) if command.id == KWDJ_COMMANDS[9].id => {
                    match editor_bridge::decode(&command.payload_json) {
                        Ok(AdditionalInsertV2::InsertBlock { target }) => Ok(match target {
                            AdditionalBlockTargetV2::Literary(
                                LiteraryBlockTargetV2::LiteraryBlock { .. },
                            ) => KwdjIntent::InsertAuthorNote,
                            AdditionalBlockTargetV2::Warning(WarningBlockTargetV2::Warning {
                                warning_kind,
                            }) => KwdjIntent::InsertWarning {
                                warning_kind: warning_kind.into(),
                            },
                            AdditionalBlockTargetV2::LabeledContainer(target) => {
                                KwdjIntent::InsertLabeledContainer {
                                    container_kind: match target {
                                        LabeledContainerBlockTargetV2::Spoiler {} => {
                                            LabeledContainerKind::Spoiler
                                        }
                                        LabeledContainerBlockTargetV2::Disclosure {} => {
                                            LabeledContainerKind::Disclosure
                                        }
                                    },
                                }
                            }
                        }),
                        Err(_) => Err(legacy),
                    }
                }
                result => result,
            }
        }
    }
    fn profile_error(error: &KwdjProfileError) -> DiagnosticDto {
        profile_error(error)
    }
}
