// SPDX-License-Identifier: MIT OR Apache-2.0
//! Additive ABI2 input transport. Legacy mutation replies remain closed.
use crate::{Bridge, BridgeAdapter, convert::*};
use editor_core::commands::{CommandProvider, InputOrigin, InputTextRun};
use editor_engine::commands::{CommandAvailability, CommandEffect, CommandRequest};
use editor_engine::transaction::DispatchOutcome;
use editor_engine::{InputCommandOutcome, InputFinalRegion, TextReplacementResult};
use editor_protocol::{CommandDto, DiagnosticDto, SdkReply, StampDto, v2::*};

fn run(value: InputTextRun) -> InputTextRunV2 {
    InputTextRunV2 {
        type_id: value.type_id,
        attributes: attrs_out(&value.attributes),
        marks: marks_out(&value.marks),
        text: value.text,
    }
}
fn region(value: InputFinalRegion) -> InputFinalRegionV2 {
    InputFinalRegionV2 {
        block: value.block.to_token(),
        range: selection_out(value.range),
        spans: value
            .spans
            .into_iter()
            .map(|span| InputTextSpanV2 {
                node: span.node.to_token(),
                from_utf16: span.from_utf16 as u32,
                to_utf16: span.to_utf16 as u32,
                type_id: span.type_id,
                attributes: attrs_out(&span.attributes),
                marks: marks_out(&span.marks),
                text: span.text,
            })
            .collect(),
    }
}
fn replacement(value: TextReplacementResult) -> TextReplacementResultV2 {
    TextReplacementResultV2::TextReplacement {
        before_stamp: stamp_out(value.before_stamp),
        after_stamp: stamp_out(value.after_stamp),
        original: InputOriginalV2 {
            origin: match value.original.origin {
                InputOrigin::OrdinaryInsertText => InputOriginV2::OrdinaryInsertText,
                InputOrigin::CompositionCommit => InputOriginV2::CompositionCommit,
            },
            selection: selection_out(value.original.selection),
            text: value.original.text,
        },
        before: InputSourceRegionV2 {
            block: value.before.block.to_token(),
            range: selection_out(value.before.range),
        },
        after: region(value.after),
        after_selection: selection_out(value.after_selection),
        after_stored_marks: value.after_stored_marks.as_deref().map(marks_out),
        raw_restore: value.raw_restore.map(|raw| RawInputRestoreV2 {
            format_id: RawInputRestoreFormatV2::V1,
            stamp: stamp_out(raw.stamp),
            selection: selection_out(raw.selection),
            stored_marks: raw.stored_marks.as_deref().map(marks_out),
            cooked: region(raw.cooked),
            raw: raw.raw.into_iter().map(run).collect(),
            raw_caret_utf16: raw.raw_caret_utf16.get() as u32,
            raw_stored_marks: raw.raw_stored_marks.as_deref().map(marks_out),
        }),
    }
}
impl<P: CommandProvider, A: BridgeAdapter<P>> Bridge<P, A> {
    fn input_request(
        &self,
        stamp: &StampDto,
        command: CommandDto,
    ) -> Result<CommandRequest<P::Intent<editor_engine::NodeId>>, DiagnosticDto> {
        self.check(stamp)?;
        let session = self.session()?;
        let intent = self
            .adapter
            .decode_input_command(session.key(), stamp, &command)?;
        if P::command_id(&intent) != command.id {
            return Err(diagnostic("command.unknown", "command.id"));
        }
        let mut request = CommandRequest::new(
            session.key(),
            session.revision(),
            session.selection_epoch(),
            intent,
        );
        request.history_epoch = Some(session.history_summary().epoch);
        Ok(request)
    }
    fn execute_input(
        &mut self,
        stamp: StampDto,
        command: CommandDto,
        query: bool,
    ) -> Result<SdkReplyV2, DiagnosticDto> {
        let request = self.input_request(&stamp, command)?;
        if query {
            return Ok(SdkReplyV2::Common(
                match self.session()?.query_input_command(&request) {
                    CommandAvailability::Available {
                        presentation,
                        effect,
                        ..
                    } => SdkReply::Availability {
                        available: true,
                        effect: Some(
                            match effect {
                                CommandEffect::Changed => "changed",
                                CommandEffect::Unchanged => "unchanged",
                            }
                            .into(),
                        ),
                        presentation: Some(presentation_out(presentation)),
                        diagnostic: None,
                    },
                    CommandAvailability::Unavailable { error, .. } => SdkReply::Availability {
                        available: false,
                        effect: None,
                        presentation: None,
                        diagnostic: Some(Self::command_error(&error)),
                    },
                },
            ));
        }
        let outcome = self.session_mut()?.execute_input_command(&request);
        match outcome {
            InputCommandOutcome::Completed {
                presentation,
                outcome,
                result,
            } => {
                let effect = match outcome {
                    DispatchOutcome::Changed(_) => InputMutationEffectV2::Changed,
                    DispatchOutcome::Unchanged {
                        selection_changed,
                        stored_marks_changed,
                        ..
                    } => {
                        if selection_changed || stored_marks_changed {
                            InputMutationEffectV2::StateChanged
                        } else {
                            InputMutationEffectV2::Unchanged
                        }
                    }
                    DispatchOutcome::Refused { error, .. } => {
                        return Err(Self::transaction_error(&error));
                    }
                };
                Ok(SdkReplyV2::InputMutation(Box::new(
                    InputMutationReplyV2::InputMutation {
                        effect,
                        state: self.state()?,
                        presentation: Some(presentation_out(presentation)),
                        result: result.map(replacement),
                    },
                )))
            }
            InputCommandOutcome::Refused { error, .. } => Err(Self::command_error(&error)),
        }
    }
    pub(crate) fn input_command(
        &mut self,
        stamp: StampDto,
        command: CommandDto,
        query: bool,
    ) -> SdkResponseV2 {
        if let Some(fatal) = self.retained_fatal_response() {
            return fatal.into();
        }
        let fingerprint = |s: &editor_engine::Session<P>| {
            (
                s.stamp(),
                s.dirty(),
                s.saved_revision(),
                s.event_status(s.key()).ok().map(|v| v.head.sequence()),
            )
        };
        let before = self.session.as_ref().map(fingerprint);
        match self.execute_input(stamp, command, query) {
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
                if self.session.as_ref().map(fingerprint) != before {
                    diagnostic.may_have_committed = true;
                    diagnostic.category = "post_commit_boundary".into();
                    self.destroy();
                    self.fatal = Some(diagnostic.clone());
                    SdkResponseV2::Fatal { diagnostic }
                } else {
                    SdkResponseV2::Refused { diagnostic }
                }
            }
        }
    }
}
