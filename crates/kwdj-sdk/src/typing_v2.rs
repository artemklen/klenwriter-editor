// SPDX-License-Identifier: MIT OR Apache-2.0
//! Profile-only input decoding; no lexical policy or DOM callbacks here.
use crate::convert::{attrs_in, diagnostic, marks_in, selection_in};
use crate::wire_v2::KwdjTypingIntentV2;
use editor_core::commands::{InputOrigin, InputTextRun};
use editor_core::positions::Utf16Offset;
use editor_core::transaction::{WorkLimits, WorkMeter};
use editor_engine::{NodeId, SessionKey};
use editor_kwdj::commands::{KwdjIntent, RESTORE_INPUT_COMMAND_ID, TYPED_INPUT_COMMAND_ID};
use editor_kwdj::typing::{Restore, RestoreSpan};
use editor_protocol::{CommandDto, DiagnosticDto, StampDto, v2::InputOriginV2};

pub(crate) fn decode_input(
    key: SessionKey,
    stamp: &StampDto,
    command: &CommandDto,
) -> Result<KwdjIntent<NodeId>, DiagnosticDto> {
    if command.id != TYPED_INPUT_COMMAND_ID && command.id != RESTORE_INPUT_COMMAND_ID {
        return Err(diagnostic("input.unsupported", "command.id"));
    }
    if command.id == RESTORE_INPUT_COMMAND_ID {
        editor_registry::preflight_json(
            command.payload_json.as_bytes(),
            editor_registry::JsonLimits {
                bytes: 32768,
                depth: 64,
                values: 4096,
            },
            &mut WorkMeter::new(WorkLimits::default()),
        )
        .map_err(|_| diagnostic("input.restore_limit", "command.payload_json"))?;
    }
    let value: KwdjTypingIntentV2 = editor_bridge::decode(&command.payload_json)?;
    match value {
        KwdjTypingIntentV2::InsertTypedText { text, origin }
            if command.id == TYPED_INPUT_COMMAND_ID =>
        {
            Ok(KwdjIntent::InsertTypedText {
                text,
                origin: match origin {
                    InputOriginV2::OrdinaryInsertText => InputOrigin::OrdinaryInsertText,
                    InputOriginV2::CompositionCommit => InputOrigin::CompositionCommit,
                },
            })
        }
        KwdjTypingIntentV2::RestoreTypedText { restore }
            if command.id == RESTORE_INPUT_COMMAND_ID =>
        {
            if &restore.stamp != stamp {
                return Err(diagnostic("input.restore_stale", "restore.stamp"));
            }
            let encoded = serde_json::to_string(&restore)
                .map_err(|_| diagnostic("sdk.invalid_dto", "restore"))?;
            // Wire envelopes and tagged AttributeDto values add container
            // levels. Native metadata admission independently enforces8/512;
            // this early transport walk must not reject a published receipt.
            editor_registry::preflight_json(
                encoded.as_bytes(),
                editor_registry::JsonLimits {
                    bytes: 4096,
                    depth: 64,
                    values: 4096,
                },
                &mut WorkMeter::new(WorkLimits::default()),
            )
            .map_err(|_| diagnostic("input.restore_limit", "restore"))?;
            let node = |token: &str| {
                key.parse_node_token(token)
                    .map_err(|_| diagnostic("position.invalid", "restore.node"))
            };
            if restore.raw.len() > 12 || restore.cooked.spans.len() > 12 {
                return Err(diagnostic("input.restore_limit", "restore"));
            }
            let cooked = restore
                .cooked
                .spans
                .into_iter()
                .map(|span| {
                    Ok(RestoreSpan {
                        node: node(&span.node)?,
                        from_utf16: Utf16Offset::new(span.from_utf16 as usize),
                        to_utf16: Utf16Offset::new(span.to_utf16 as usize),
                        type_id: span.type_id,
                        attributes: attrs_in(&span.attributes)?,
                        marks: marks_in(&span.marks)?,
                        text: span.text,
                    })
                })
                .collect::<Result<Vec<_>, DiagnosticDto>>()?;
            let raw = restore
                .raw
                .into_iter()
                .map(|run| {
                    Ok(InputTextRun {
                        type_id: run.type_id,
                        attributes: attrs_in(&run.attributes)?,
                        marks: marks_in(&run.marks)?,
                        text: run.text,
                    })
                })
                .collect::<Result<Vec<_>, DiagnosticDto>>()?;
            Ok(KwdjIntent::RestoreTypedText {
                restore: Restore {
                    selection: selection_in(&restore.selection, key)?,
                    stored_marks: restore.stored_marks.as_deref().map(marks_in).transpose()?,
                    block: node(&restore.cooked.block)?,
                    range: selection_in(&restore.cooked.range, key)?,
                    cooked,
                    raw,
                    raw_caret_utf16: Utf16Offset::new(restore.raw_caret_utf16 as usize),
                    raw_stored_marks: restore
                        .raw_stored_marks
                        .as_deref()
                        .map(marks_in)
                        .transpose()?,
                    serialized_bytes: encoded.len(),
                },
            })
        }
        _ => Err(diagnostic("command.unknown", "command.id")),
    }
}
