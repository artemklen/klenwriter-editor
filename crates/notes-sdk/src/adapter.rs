// SPDX-License-Identifier: MIT OR Apache-2.0
use editor_bridge::convert::diagnostic;
use editor_bridge::{BridgeAdapter, decode};
use editor_engine::SessionKey;
use editor_notes::{INSERT_TEXT, NativeNotesIntent, NotesError, NotesProfile, SET_TAGS, SET_TITLE};
use editor_protocol::{CommandDto, DiagnosticDto};
use serde::Deserialize;

#[derive(Debug, Clone, Copy, Default)]
pub struct NotesAdapter;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct InsertText {
    text: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SetTitle {
    title: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SetTags {
    tags: Vec<String>,
}

pub(crate) fn profile_error(error: &NotesError) -> DiagnosticDto {
    let mut result = diagnostic(error.as_str(), &error.path);
    result.category = if error.registry_code.is_some() {
        "registry"
    } else {
        "profile"
    }
    .into();
    if let Some(limit) = error.limit {
        result.details.insert("limit".into(), limit.name.into());
        result
            .details
            .insert("maximum".into(), limit.maximum.to_string());
        result
            .details
            .insert("observed".into(), limit.observed.to_string());
    }
    result
}

impl BridgeAdapter<NotesProfile> for NotesAdapter {
    fn decode_command(
        &self,
        _key: SessionKey,
        command: &CommandDto,
    ) -> Result<NativeNotesIntent, DiagnosticDto> {
        match command.id.as_str() {
            INSERT_TEXT => Ok(NativeNotesIntent::InsertText {
                text: decode::<InsertText>(&command.payload_json)?.text,
            }),
            SET_TITLE => Ok(NativeNotesIntent::SetTitle {
                title: decode::<SetTitle>(&command.payload_json)?.title,
            }),
            SET_TAGS => Ok(NativeNotesIntent::SetTags {
                tags: decode::<SetTags>(&command.payload_json)?.tags,
            }),
            _ => Err(diagnostic("command.unknown", "command.id")),
        }
    }

    fn profile_error(error: &NotesError) -> DiagnosticDto {
        profile_error(error)
    }
}
