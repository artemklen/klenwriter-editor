// SPDX-License-Identifier: MIT OR Apache-2.0
//! Frozen compiled KWDJ command policies. No engine import or publication authority.

mod block;
mod inline;

use editor_core::candidate::CandidateRead;
use editor_core::commands::{
    CommandDescriptor, CommandPresentation, CommandProvider, CommandState, PlanBuilder,
};
use editor_core::document::Mark;
use editor_core::positions::Selection;
use editor_core::transaction::WorkMeter;

use crate::{KwdjError, KwdjErrorCode, KwdjProfile, KwdjProfileError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlockTarget {
    Paragraph,
    Heading { level: u8 },
    CodeBlock { language: Option<String> },
    Blockquote,
    BulletList,
    OrderedList { start: u64 },
    TaskList,
    SceneBreak,
    Table,
    Poetry,
    Media,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ListKind {
    Bullet,
    Ordered { start: u64 },
    Task,
}

/// Native bootstrap intents; public transport/descriptor compatibility is63/64.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KwdjIntent<I> {
    Enter,
    ShiftEnter,
    ToggleMark {
        mark: Mark,
    },
    SetLink {
        href: String,
        title: Option<String>,
    },
    UnsetLink,
    InsertText {
        text: String,
    },
    TransformBlock {
        target: BlockTarget,
    },
    ToggleQuote,
    ToggleList {
        kind: ListKind,
    },
    InsertBlock {
        target: BlockTarget,
    },
    Move {
        node: I,
        parent: I,
        before_index: usize,
    },
    Duplicate {
        node: I,
        parent: I,
        index: usize,
    },
    Remove {
        node: I,
    },
    AcceptSlash {
        target: BlockTarget,
        range: Selection<I>,
        literal: String,
    },
    DismissSlash,
}

pub const KWDJ_COMMANDS: &[CommandDescriptor] = &[
    CommandDescriptor {
        id: "org.klenwriter.kwdj/command/enter",
    },
    CommandDescriptor {
        id: "org.klenwriter.kwdj/command/shift-enter",
    },
    CommandDescriptor {
        id: "org.klenwriter.kwdj/command/toggle-mark",
    },
    CommandDescriptor {
        id: "org.klenwriter.kwdj/command/set-link",
    },
    CommandDescriptor {
        id: "org.klenwriter.kwdj/command/unset-link",
    },
    CommandDescriptor {
        id: "org.klenwriter.kwdj/command/insert-text",
    },
    CommandDescriptor {
        id: "org.klenwriter.kwdj/command/transform-block",
    },
    CommandDescriptor {
        id: "org.klenwriter.kwdj/command/toggle-quote",
    },
    CommandDescriptor {
        id: "org.klenwriter.kwdj/command/toggle-list",
    },
    CommandDescriptor {
        id: "org.klenwriter.kwdj/command/insert-block",
    },
    CommandDescriptor {
        id: "org.klenwriter.kwdj/command/move",
    },
    CommandDescriptor {
        id: "org.klenwriter.kwdj/command/duplicate",
    },
    CommandDescriptor {
        id: "org.klenwriter.kwdj/command/remove",
    },
    CommandDescriptor {
        id: "org.klenwriter.kwdj/command/accept-slash",
    },
    CommandDescriptor {
        id: "org.klenwriter.kwdj/command/dismiss-slash",
    },
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlashCandidate {
    pub id: &'static str,
    pub target: BlockTarget,
}

/// Discovery is immutable; exact execution availability is queried separately.
pub const KWDJ_SLASH_CANDIDATES: &[SlashCandidate] = &[
    SlashCandidate {
        id: "org.klenwriter.kwdj/slash/paragraph",
        target: BlockTarget::Paragraph,
    },
    SlashCandidate {
        id: "org.klenwriter.kwdj/slash/heading2",
        target: BlockTarget::Heading { level: 2 },
    },
    SlashCandidate {
        id: "org.klenwriter.kwdj/slash/heading3",
        target: BlockTarget::Heading { level: 3 },
    },
    SlashCandidate {
        id: "org.klenwriter.kwdj/slash/blockquote",
        target: BlockTarget::Blockquote,
    },
    SlashCandidate {
        id: "org.klenwriter.kwdj/slash/bullet-list",
        target: BlockTarget::BulletList,
    },
    SlashCandidate {
        id: "org.klenwriter.kwdj/slash/ordered-list",
        target: BlockTarget::OrderedList { start: 1 },
    },
    SlashCandidate {
        id: "org.klenwriter.kwdj/slash/task-list",
        target: BlockTarget::TaskList,
    },
    SlashCandidate {
        id: "org.klenwriter.kwdj/slash/code-block",
        target: BlockTarget::CodeBlock { language: None },
    },
    SlashCandidate {
        id: "org.klenwriter.kwdj/slash/scene-break",
        target: BlockTarget::SceneBreak,
    },
];

pub(super) fn refusal(code: KwdjErrorCode) -> KwdjError {
    KwdjError::categorized(code, "", "command")
}

impl CommandProvider for KwdjProfile<'_> {
    type Intent<I: Copy + Eq + Ord> = KwdjIntent<I>;
    const COMMANDS: &'static [CommandDescriptor] = KWDJ_COMMANDS;

    fn command_id<I: Copy + Eq + Ord>(intent: &KwdjIntent<I>) -> &'static str {
        match intent {
            KwdjIntent::Enter => KWDJ_COMMANDS[0].id,
            KwdjIntent::ShiftEnter => KWDJ_COMMANDS[1].id,
            KwdjIntent::ToggleMark { .. } => KWDJ_COMMANDS[2].id,
            KwdjIntent::SetLink { .. } => KWDJ_COMMANDS[3].id,
            KwdjIntent::UnsetLink => KWDJ_COMMANDS[4].id,
            KwdjIntent::InsertText { .. } => KWDJ_COMMANDS[5].id,
            KwdjIntent::TransformBlock { .. } => KWDJ_COMMANDS[6].id,
            KwdjIntent::ToggleQuote => KWDJ_COMMANDS[7].id,
            KwdjIntent::ToggleList { .. } => KWDJ_COMMANDS[8].id,
            KwdjIntent::InsertBlock { .. } => KWDJ_COMMANDS[9].id,
            KwdjIntent::Move { .. } => KWDJ_COMMANDS[10].id,
            KwdjIntent::Duplicate { .. } => KWDJ_COMMANDS[11].id,
            KwdjIntent::Remove { .. } => KWDJ_COMMANDS[12].id,
            KwdjIntent::AcceptSlash { .. } => KWDJ_COMMANDS[13].id,
            KwdjIntent::DismissSlash => KWDJ_COMMANDS[14].id,
        }
    }

    fn prepare_command<V: CandidateRead>(
        &self,
        context: &Self::Context,
        view: &V,
        state: CommandState<'_, V::Id>,
        intent: &KwdjIntent<V::Id>,
        plan: &mut PlanBuilder<'_, V::Id>,
    ) -> Result<CommandPresentation, Self::Error> {
        Ok(match intent {
            KwdjIntent::ToggleMark { mark } => inline::toggle_mark(view, state, mark, plan)?,
            KwdjIntent::SetLink { href, title } => {
                inline::set_link(view, state, href, title.as_deref(), plan)?
            }
            KwdjIntent::UnsetLink => inline::unset_link(view, state, plan)?,
            KwdjIntent::InsertText { text } => inline::insert_text(view, state, text, plan)?,
            KwdjIntent::DismissSlash => CommandPresentation { active: None },
            _ => block::prepare(*context, view, state, intent, plan)?,
        })
    }

    fn finalize_typing_override<V: CandidateRead>(
        &self,
        context: &Self::Context,
        final_candidate: &V,
        final_selection: Option<Selection<V::Id>>,
        proposed: Option<&[Mark]>,
        work: &mut WorkMeter,
    ) -> Result<Option<Vec<Mark>>, Self::Error> {
        Ok(inline::finalize_typing_override(
            self,
            *context,
            final_candidate,
            final_selection,
            proposed,
            work,
        )?)
    }

    fn error_code(error: &Self::Error) -> &'static str {
        match error {
            KwdjProfileError::Document(error) => error.code.as_str(),
            KwdjProfileError::Binding(_) => "kwdj.command_binding_mismatch",
            KwdjProfileError::Registry(error) => error.code.as_str(),
        }
    }
}
