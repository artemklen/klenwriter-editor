// SPDX-License-Identifier: MIT OR Apache-2.0
//! KWDJ command decoding and exact diagnostic projection.
use crate::wire::*;
pub use editor_bridge::convert::*;
use editor_engine::{NodeId, SessionKey};
use editor_kwdj::KwdjProfileError;
use editor_kwdj::commands::{BlockTarget, KwdjIntent, ListKind};

pub fn target_in(v: &BlockTargetDto) -> Result<BlockTarget, DiagnosticDto> {
    Ok(match v {
        BlockTargetDto::Paragraph {} => BlockTarget::Paragraph,
        BlockTargetDto::Heading { level } => BlockTarget::Heading { level: *level },
        BlockTargetDto::CodeBlock { language } => BlockTarget::CodeBlock {
            language: language.clone(),
        },
        BlockTargetDto::Blockquote {} => BlockTarget::Blockquote,
        BlockTargetDto::BulletList {} => BlockTarget::BulletList,
        BlockTargetDto::OrderedList { start } => BlockTarget::OrderedList {
            start: decimal(start, "command.start")?,
        },
        BlockTargetDto::TaskList {} => BlockTarget::TaskList,
        BlockTargetDto::SceneBreak {} => BlockTarget::SceneBreak,
        BlockTargetDto::Table {} => BlockTarget::Table,
        BlockTargetDto::Poetry {} => BlockTarget::Poetry,
        BlockTargetDto::Media {} => BlockTarget::Media,
    })
}

pub fn intent_in(
    value: KwdjIntentDto,
    key: SessionKey,
) -> Result<KwdjIntent<NodeId>, DiagnosticDto> {
    let node = |v: &str| {
        key.parse_node_token(v)
            .map_err(|e| diagnostic(e.as_str(), "command.node"))
    };
    Ok(match value {
        KwdjIntentDto::Enter {} => KwdjIntent::Enter,
        KwdjIntentDto::ShiftEnter {} => KwdjIntent::ShiftEnter,
        KwdjIntentDto::ToggleMark { mark } => KwdjIntent::ToggleMark {
            mark: marks_in(&[mark])?.remove(0),
        },
        KwdjIntentDto::SetLink { href, title } => KwdjIntent::SetLink { href, title },
        KwdjIntentDto::UnsetLink {} => KwdjIntent::UnsetLink,
        KwdjIntentDto::InsertText { text } => KwdjIntent::InsertText { text },
        KwdjIntentDto::TransformBlock { target } => KwdjIntent::TransformBlock {
            target: target_in(&target)?,
        },
        KwdjIntentDto::ToggleQuote {} => KwdjIntent::ToggleQuote,
        KwdjIntentDto::ToggleList { list } => KwdjIntent::ToggleList {
            kind: match list {
                ListKindDto::Bullet {} => ListKind::Bullet,
                ListKindDto::Ordered { start } => ListKind::Ordered {
                    start: decimal(&start, "command.start")?,
                },
                ListKindDto::Task {} => ListKind::Task,
            },
        },
        KwdjIntentDto::InsertBlock { target } => KwdjIntent::InsertBlock {
            target: target_in(&target)?,
        },
        KwdjIntentDto::Move {
            node: id,
            parent,
            before_index,
        } => KwdjIntent::Move {
            node: node(&id)?,
            parent: node(&parent)?,
            before_index: before_index as usize,
        },
        KwdjIntentDto::Duplicate {
            node: id,
            parent,
            index,
        } => KwdjIntent::Duplicate {
            node: node(&id)?,
            parent: node(&parent)?,
            index: index as usize,
        },
        KwdjIntentDto::Remove { node: id } => KwdjIntent::Remove { node: node(&id)? },
        KwdjIntentDto::AcceptSlash {
            target,
            range,
            literal,
        } => KwdjIntent::AcceptSlash {
            target: target_in(&target)?,
            range: selection_in(&range, key)?,
            literal,
        },
        KwdjIntentDto::DismissSlash {} => KwdjIntent::DismissSlash,
        KwdjIntentDto::DeleteBackward {} => KwdjIntent::DeleteBackward,
        KwdjIntentDto::DeleteSelection {} => KwdjIntent::DeleteSelection,
    })
}

pub fn profile_error(e: &KwdjProfileError) -> DiagnosticDto {
    match e {
        KwdjProfileError::Binding(e) => diagnostic(e.as_str(), "profile"),
        KwdjProfileError::Registry(e) => {
            let mut d = diagnostic(e.code.as_str(), &e.path);
            d.category = "registry".into();
            d.details.insert("reason".into(), e.detail.into());
            if let Some(index) = e.child_index {
                d.details.insert("child_index".into(), index.to_string());
            }
            d
        }
        KwdjProfileError::Document(e) => {
            let mut d = diagnostic(e.code.as_str(), &e.path);
            d.category = e.context.category.unwrap_or("profile").into();
            if let Some(v) = e.context.limit {
                d.details.insert("limit".into(), v.into());
            }
            if let Some(v) = e.context.maximum {
                d.details.insert("maximum".into(), v.to_string());
            }
            if let Some(v) = e.context.observed {
                d.details.insert("observed".into(), v.to_string());
            }
            d
        }
    }
}
