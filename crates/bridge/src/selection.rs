// SPDX-License-Identifier: MIT OR Apache-2.0
//! Pure ABI2 selected-text dispatch over a borrowed, nonallocating Session view.
use crate::{
    Bridge, BridgeAdapter,
    convert::{diagnostic, selection_out, stamp_out},
};
use editor_core::{
    candidate::{BorrowedNode, CandidateRead},
    commands::CommandProvider,
    transaction::{WorkLimits, WorkMeter},
};
use editor_engine::{NodeId, Session};
use editor_protocol::{DiagnosticDto, v2::*};

pub struct SelectionTextData {
    pub projection_id: String,
    pub text: String,
    pub empty: bool,
    pub selected_atoms: Vec<NodeId>,
}
pub(crate) struct Read<'a, P: CommandProvider> {
    pub(crate) session: &'a Session<P>,
    pub(crate) root: NodeId,
    pub(crate) roots: &'a [NodeId],
}
impl<P: CommandProvider> CandidateRead for Read<'_, P> {
    type Id = NodeId;
    fn root(&self) -> NodeId {
        self.root
    }
    fn roots(&self) -> &[NodeId] {
        self.roots
    }
    fn node(&self, id: NodeId) -> Option<BorrowedNode<'_, NodeId>> {
        let n = self.session.node(self.session.key(), id).ok()?;
        Some(BorrowedNode {
            type_id: n.type_id()?,
            primitive: n.primitive()?,
            attributes: n.attributes()?,
            marks: n.marks(),
            text: n.text(),
            children: n.children(),
            parent: n.parent()?,
        })
    }
}
impl<P: CommandProvider, A: BridgeAdapter<P>> Bridge<P, A> {
    fn selection_text(
        &self,
        stamp: &editor_protocol::StampDto,
        max_bytes: u32,
    ) -> Result<SdkReplyV2, DiagnosticDto> {
        self.check(stamp)?;
        if max_bytes > 1_048_576 {
            return Err(diagnostic("selection_text.output_limit", ""));
        }
        let s = self.session()?;
        let selection = s
            .selection(s.key())
            .map_err(|e| Self::session_error(&e))?
            .ok_or_else(|| diagnostic("selection.required", ""))?;
        let root = s.root(s.key()).map_err(|e| Self::session_error(&e))?;
        let mut work = WorkMeter::new(WorkLimits::default());
        let roots = s
            .node(s.key(), root)
            .map_err(|e| Self::session_error(&e))?
            .children();
        let data = self.adapter.selection_text(
            &Read {
                session: s,
                root,
                roots,
            },
            selection,
            max_bytes,
            &mut work,
        )?;
        // Conservative JSON escape bound is checked before token/string copies.
        // Node tokens contain only ASCII n1 and three u64 decimal fields (<=66 bytes).
        let bound = data
            .text
            .len()
            .checked_mul(6)
            .and_then(|n| n.checked_add(data.selected_atoms.len().saturating_mul(80)))
            .and_then(|n| n.checked_add(data.projection_id.len().saturating_mul(6) + 4096));
        if data.text.len() > max_bytes as usize {
            return Err(diagnostic("selection_text.output_limit", ""));
        }
        if data.selected_atoms.len() > 4096 {
            return Err(diagnostic("selection_text.atom_limit", ""));
        }
        if bound.is_none_or(|n| n > 8 * 1024 * 1024) {
            return Err(diagnostic("selection_text.reply_limit", ""));
        }
        work.charge_bytes(bound.expect("checked") as u64)
            .map_err(|e| {
                let mut d = diagnostic("resource_limit_exceeded", "");
                d.details.insert("limit".into(), e.name.into());
                d.details.insert("maximum".into(), e.maximum.to_string());
                d.details.insert("observed".into(), e.observed.to_string());
                d
            })?;
        Ok(SdkReplyV2::SelectionText(
            SelectionTextReplyV2::SelectionText {
                stamp: stamp_out(s.stamp()),
                selection: selection_out(selection),
                projection_id: data.projection_id,
                text: data.text,
                empty: data.empty,
                selected_atoms: data.selected_atoms.iter().map(|id| id.to_token()).collect(),
            },
        ))
    }
    pub fn call_v2(&mut self, request: BridgeRequestV2) -> SdkResponseV2 {
        if let Some(fatal) = self.retained_fatal_response() {
            return fatal.into();
        }
        match request {
            BridgeRequestV2::ClipboardContext(ClipboardContextRequestV2::ClipboardContext {
                stamp,
            }) => self.clipboard_context(&stamp),
            BridgeRequestV2::SelectionFragment(SelectionFragmentRequestV2::SelectionFragment {
                stamp,
                max_bytes,
            }) => self.selection_fragment(&stamp, max_bytes),
            BridgeRequestV2::Common(request) => self.call(request).into(),
            BridgeRequestV2::TextWindow(TextWindowRequestV2::TextWindow {
                stamp,
                before_utf16,
                after_utf16,
            }) => match self.text_window(&stamp, before_utf16, after_utf16) {
                Ok(value) => SdkResponseV2::Ok {
                    value: Box::new(value),
                },
                Err(mut diagnostic) => {
                    if diagnostic.stamp.is_none() {
                        diagnostic.stamp = self
                            .session
                            .as_ref()
                            .map(|s| Box::new(stamp_out(s.stamp())));
                    }
                    SdkResponseV2::Refused { diagnostic }
                }
            },
            BridgeRequestV2::SelectionText(SelectionTextRequestV2::SelectionText {
                stamp,
                max_bytes,
            }) => match self.selection_text(&stamp, max_bytes) {
                Ok(value) => SdkResponseV2::Ok {
                    value: Box::new(value),
                },
                Err(mut diagnostic) => {
                    if diagnostic.stamp.is_none() {
                        diagnostic.stamp = self
                            .session
                            .as_ref()
                            .map(|s| Box::new(stamp_out(s.stamp())));
                    }
                    SdkResponseV2::Refused { diagnostic }
                }
            },
        }
    }
    pub fn call_json_v2(&mut self, json: &str) -> String {
        if let Some(fatal) = self.retained_fatal_response() {
            return self.encode_response(fatal);
        }
        let result = match crate::decode::<BridgeRequestV2>(json) {
            Ok(request) => self.call_v2(request),
            Err(diagnostic) => SdkResponseV2::Refused { diagnostic },
        };
        serde_json::to_string(&result).unwrap_or_else(|_| self.transport_failure())
    }
}
