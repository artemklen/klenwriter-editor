// SPDX-License-Identifier: MIT OR Apache-2.0
//! ABI2 projection copies only the engine's already bounded borrowed window.
use crate::{
    Bridge, BridgeAdapter,
    convert::{diagnostic, position_out, primitive_out, selection_out, stamp_out},
};
use editor_core::commands::CommandProvider;
use editor_engine::{
    text_window::{TextWindowBoundary, TextWindowError, TextWindowSpan},
    tree::TreeNode,
};
use editor_protocol::{DiagnosticDto, v2::*};

impl<P: CommandProvider, A: BridgeAdapter<P>> Bridge<P, A> {
    pub(super) fn text_window(
        &self,
        stamp: &editor_protocol::StampDto,
        before: u32,
        after: u32,
    ) -> Result<SdkReplyV2, DiagnosticDto> {
        self.check(stamp)?;
        let session = self.session()?;
        let window = session
            .text_window(session.key(), before as usize, after as usize)
            .map_err(|e| Self::session_error(&e))?
            .map_err(|e| match e {
                TextWindowError::Tree(tree) => {
                    Self::session_error(&editor_engine::SessionError::Tree(tree))
                }
                other => diagnostic(
                    match other {
                        TextWindowError::SelectionRequired => "selection.required",
                        TextWindowError::UnsupportedContext => "text_window.unsupported_context",
                        TextWindowError::WindowLimit => "text_window.window_limit",
                        TextWindowError::SourceScanLimit => "text_window.source_scan_limit",
                        TextWindowError::NodeLimit => "text_window.node_limit",
                        TextWindowError::DepthLimit => "text_window.depth_limit",
                        TextWindowError::ReplyLimit => "text_window.reply_limit",
                        TextWindowError::Tree(_) => unreachable!(),
                    },
                    "",
                ),
            })?;
        let node = |n: &TreeNode| TextWindowNodeV2 {
            node: n.id().to_token(),
            type_id: n.type_id().expect("checked header").into(),
            primitive: primitive_out(n.primitive()).into(),
        };
        let span = |s: TextWindowSpan<'_>| -> Result<TextWindowSpanV2, DiagnosticDto> {
            Ok(TextWindowSpanV2 {
                node: s.node.to_token(),
                from_utf16: u32::try_from(s.from_utf16)
                    .map_err(|_| diagnostic("text_window.reply_limit", ""))?,
                to_utf16: u32::try_from(s.to_utf16)
                    .map_err(|_| diagnostic("text_window.reply_limit", ""))?,
                text: s.text.into(),
            })
        };
        let boundary = |b| match b {
            TextWindowBoundary::Block => TextWindowBoundaryV2::Block,
            TextWindowBoundary::InlineAtom => TextWindowBoundaryV2::InlineAtom,
            TextWindowBoundary::HardBreak => TextWindowBoundaryV2::HardBreak,
            TextWindowBoundary::WindowLimit => TextWindowBoundaryV2::WindowLimit,
        };
        Ok(SdkReplyV2::TextWindow(TextWindowReplyV2::TextWindow {
            stamp: stamp_out(session.stamp()),
            selection: selection_out(window.selection),
            caret: position_out(window.selection.focus),
            block: node(window.block),
            ancestors: window.ancestors.into_iter().map(node).collect(),
            before: window
                .before
                .into_iter()
                .map(span)
                .collect::<Result<_, _>>()?,
            after: window
                .after
                .into_iter()
                .map(span)
                .collect::<Result<_, _>>()?,
            before_stop: boundary(window.before_stop),
            after_stop: boundary(window.after_stop),
        }))
    }
}

#[cfg(test)]
mod text_window_tests {
    use super::*;
    const STAMP: &str = r#"{"session":"s","generation":"1","revision":"0","selection_epoch":"0","history_epoch":"0"}"#;
    #[test]
    fn text_window_is_additive_and_legacy_dispatch_stays_closed() {
        let json = format!(
            r#"{{"kind":"text_window","stamp":{STAMP},"before_utf16":256,"after_utf16":0}}"#
        );
        assert!(matches!(
            serde_json::from_str::<BridgeRequestV2>(&json).unwrap(),
            BridgeRequestV2::TextWindow(_)
        ));
        assert!(serde_json::from_str::<crate::BridgeRequest>(&json).is_err());
    }
    #[test]
    fn text_window_rejects_unknown_and_noninteger_request_data() {
        for before in ["-1", "1.5", "true", "null", "4294967296"] {
            let json = format!(
                r#"{{"kind":"text_window","stamp":{STAMP},"before_utf16":{before},"after_utf16":0}}"#
            );
            assert!(
                serde_json::from_str::<BridgeRequestV2>(&json).is_err(),
                "{before}"
            );
        }
        let json = format!(
            r#"{{"kind":"text_window","stamp":{STAMP},"before_utf16":1,"after_utf16":0,"node":"foreign"}}"#
        );
        assert!(serde_json::from_str::<BridgeRequestV2>(&json).is_err());
        assert!(
            serde_json::from_str::<TextWindowSpanV2>(
                r#"{"node":"n","from_utf16":0,"to_utf16":1,"text":"a","children":[]}"#
            )
            .is_err()
        );
    }
}
