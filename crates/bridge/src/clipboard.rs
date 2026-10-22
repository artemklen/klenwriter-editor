// SPDX-License-Identifier: MIT OR Apache-2.0
//! ABI2 profile-owned clipboard reads over the original guarded session view.
use crate::{
    Bridge, BridgeAdapter,
    convert::{diagnostic, selection_out, stamp_out},
    selection::Read,
};
use editor_core::{
    commands::CommandProvider,
    transaction::{WorkLimits, WorkMeter},
};
use editor_protocol::{DiagnosticDto, StampDto, v2::*};

pub struct ClipboardContextData {
    pub format_id: String,
    pub context_json: String,
}
pub struct SelectionFragmentData {
    pub format_id: String,
    pub fragment_json: String,
    pub empty: bool,
}

impl<P: CommandProvider, A: BridgeAdapter<P>> Bridge<P, A> {
    fn clipboard_read(
        &self,
        stamp: &StampDto,
        max_bytes: Option<u32>,
    ) -> Result<SdkReplyV2, DiagnosticDto> {
        self.check(stamp)?;
        if max_bytes.is_some_and(|n| n > 2 * 1024 * 1024) {
            return Err(diagnostic("clipboard.fragment_limit", ""));
        }
        let session = self.session()?;
        let key = session.key();
        let selection = session
            .selection(key)
            .map_err(|e| Self::session_error(&e))?
            .ok_or_else(|| diagnostic("selection.required", ""))?;
        let root = session.root(key).map_err(|e| Self::session_error(&e))?;
        let roots = session
            .node(key, root)
            .map_err(|e| Self::session_error(&e))?
            .children();
        let view = Read {
            session,
            root,
            roots,
        };
        let mut work = WorkMeter::new(WorkLimits::default());
        let value = session
            .with_profile_context(key, |context| match max_bytes {
                Some(maximum) => self
                    .adapter
                    .selection_fragment(context, &view, selection, maximum, &mut work)
                    .map(|data| {
                        SdkReplyV2::SelectionFragment(SelectionFragmentReplyV2::SelectionFragment {
                            stamp: stamp_out(session.stamp()),
                            selection: selection_out(selection),
                            format_id: data.format_id,
                            fragment_json: data.fragment_json,
                            empty: data.empty,
                        })
                    }),
                None => self
                    .adapter
                    .clipboard_context(context, &view, selection, &mut work)
                    .map(|data| {
                        SdkReplyV2::ClipboardContext(ClipboardContextReplyV2::ClipboardContext {
                            stamp: stamp_out(session.stamp()),
                            selection: selection_out(selection),
                            format_id: data.format_id,
                            context_json: data.context_json,
                        })
                    }),
            })
            .map_err(|e| Self::session_error(&e))??;
        let (format, payload, maximum) = match &value {
            SdkReplyV2::ClipboardContext(ClipboardContextReplyV2::ClipboardContext {
                format_id,
                context_json,
                ..
            }) => (format_id, context_json, 4096),
            SdkReplyV2::SelectionFragment(SelectionFragmentReplyV2::SelectionFragment {
                format_id,
                fragment_json,
                ..
            }) => (
                format_id,
                fragment_json,
                max_bytes.expect("fragment maximum") as usize,
            ),
            _ => unreachable!("closed clipboard reply"),
        };
        if format.len() > 256 || payload.len() > maximum {
            return Err(diagnostic("clipboard.fragment_limit", ""));
        }
        let bound = payload
            .len()
            .checked_mul(6)
            .and_then(|n| n.checked_add(8192));
        if bound.is_none_or(|n| n > 16 * 1024 * 1024) {
            return Err(diagnostic("clipboard.reply_limit", ""));
        }
        work.charge_bytes(bound.expect("checked") as u64)
            .map_err(|_| diagnostic("clipboard.reply_limit", ""))?;
        Ok(value)
    }
    pub(crate) fn clipboard_context(&self, stamp: &StampDto) -> SdkResponseV2 {
        self.clipboard_read_reply(stamp, None)
    }
    pub(crate) fn selection_fragment(&self, stamp: &StampDto, max_bytes: u32) -> SdkResponseV2 {
        self.clipboard_read_reply(stamp, Some(max_bytes))
    }
    fn clipboard_read_reply(&self, stamp: &StampDto, max_bytes: Option<u32>) -> SdkResponseV2 {
        match self.clipboard_read(stamp, max_bytes) {
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
        }
    }
}
