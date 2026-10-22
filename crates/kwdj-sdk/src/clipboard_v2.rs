// SPDX-License-Identifier: MIT OR Apache-2.0
use crate::{
    KwdjAdapter,
    convert::{diagnostic, profile_error},
    wire_v2::KwdjClipboardIntentV2,
};
use editor_bridge::{BridgeAdapter, ClipboardContextData, SelectionFragmentData};
use editor_core::{candidate::CandidateRead, positions::Selection, transaction::WorkMeter};
use editor_engine::{NodeId, SessionKey};
use editor_kwdj::{
    KwdjProfile, KwdjProfileError, Profile,
    commands::{CLIPBOARD_COMMAND_ID, KwdjIntent, clipboard},
};
use editor_protocol::{CommandDto, DiagnosticDto};

pub(crate) struct ClipboardAdapterV2(pub(crate) KwdjAdapter);
fn native(error: editor_kwdj::KwdjError) -> DiagnosticDto {
    profile_error(&KwdjProfileError::Document(error))
}
impl BridgeAdapter<KwdjProfile<'static>> for ClipboardAdapterV2 {
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
        if command.id == CLIPBOARD_COMMAND_ID {
            let KwdjClipboardIntentV2::InsertFragment { fragment_json } =
                editor_bridge::decode(&command.payload_json)?;
            Ok(KwdjIntent::InsertFragment {
                fragment: clipboard::decode_fragment(&fragment_json).map_err(native)?,
            })
        } else {
            self.0.decode_command(key, command)
        }
    }
    fn profile_error(error: &KwdjProfileError) -> DiagnosticDto {
        profile_error(error)
    }
}
