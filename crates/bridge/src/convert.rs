// SPDX-License-Identifier: MIT OR Apache-2.0
//! Lossless typed wire conversion, never Debug-string parsing.

use std::collections::BTreeMap;

use editor_core::commands::{ActiveState, CommandPresentation};
use editor_core::document::{Attribute, Attributes, Mark, Primitive};
use editor_core::positions::{Affinity, Edge, Position, Selection, Utf16Offset};
use editor_core::profile::{ExtensionBinding, ProfileBinding};
use editor_engine::events::{EventKind, SessionEvent, SessionStamp};
use editor_engine::history::{HistoryHint, HistorySummary, TypingClass};
use editor_engine::{NodeId, SessionKey};

use editor_protocol::*;

pub fn diagnostic(code: &str, path: &str) -> DiagnosticDto {
    DiagnosticDto {
        code: code.into(),
        path: path.into(),
        category: "sdk".into(),
        details: BTreeMap::new(),
        stamp: None,
        may_have_committed: false,
    }
}

pub fn decimal(value: &str, path: &str) -> Result<u64, DiagnosticDto> {
    if value.is_empty()
        || value.len() > 20
        || !value.bytes().all(|b| b.is_ascii_digit())
        || value.len() > 1 && value.starts_with('0')
    {
        return Err(diagnostic("sdk.invalid_u64", path));
    }
    value
        .parse()
        .map_err(|_| diagnostic("sdk.invalid_u64", path))
}

pub fn profile_out(binding: &ProfileBinding) -> ProfileDto {
    ProfileDto {
        profile_id: binding.profile_id().into(),
        profile_version: binding.profile_version().into(),
        codec_id: binding.codec_id().into(),
        wire_version: binding.wire_version() as u32,
        extensions: binding
            .extensions()
            .iter()
            .map(|e| ExtensionDto {
                id: e.id().into(),
                version: e.version().into(),
            })
            .collect(),
    }
}

pub fn profile_in(value: &ProfileDto) -> Result<ProfileBinding, DiagnosticDto> {
    if value.extensions.len() > 64 {
        return Err(diagnostic(
            "profile.too_many_extensions",
            "profile.extensions",
        ));
    }
    let extensions = value
        .extensions
        .iter()
        .map(|e| ExtensionBinding::new(&e.id, &e.version))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| diagnostic(e.as_str(), "profile.extensions"))?;
    ProfileBinding::new(
        &value.profile_id,
        &value.profile_version,
        &value.codec_id,
        value.wire_version as u64,
        &extensions,
    )
    .map_err(|e| diagnostic(e.as_str(), "profile"))
}

pub fn stamp_out(value: SessionStamp) -> StampDto {
    StampDto {
        session: value.session.to_token(),
        generation: value.session.generation().to_string(),
        revision: value.revision.to_string(),
        selection_epoch: value.selection_epoch.to_string(),
        history_epoch: value.history_epoch.to_string(),
    }
}

pub fn stamp_check(expected: &StampDto, actual: SessionStamp) -> Result<(), DiagnosticDto> {
    if !actual.session.matches_token(&expected.session)
        || decimal(&expected.generation, "stamp.generation")? != actual.session.generation()
    {
        return Err(diagnostic("session.stale_session", "stamp.session"));
    }
    for (value, target, path, code) in [
        (
            &expected.revision,
            actual.revision,
            "stamp.revision",
            "session.stale_revision",
        ),
        (
            &expected.selection_epoch,
            actual.selection_epoch,
            "stamp.selection_epoch",
            "session.stale_selection_epoch",
        ),
        (
            &expected.history_epoch,
            actual.history_epoch,
            "stamp.history_epoch",
            "session.stale_history_epoch",
        ),
    ] {
        if decimal(value, path)? != target {
            return Err(diagnostic(code, path));
        }
    }
    Ok(())
}

fn affinity(value: &AffinityDto) -> Affinity {
    match value {
        AffinityDto::Before => Affinity::Before,
        AffinityDto::After => Affinity::After,
    }
}
fn affinity_out(value: Affinity) -> AffinityDto {
    match value {
        Affinity::Before => AffinityDto::Before,
        Affinity::After => AffinityDto::After,
    }
}

pub fn position_in(
    value: &PositionDto,
    key: SessionKey,
) -> Result<Position<NodeId>, DiagnosticDto> {
    let node = |token: &str| {
        key.parse_node_token(token)
            .map_err(|e| diagnostic(e.as_str(), "position.node"))
    };
    Ok(match value {
        PositionDto::Text {
            node: id,
            offset,
            affinity: a,
        } => Position::Text {
            leaf: node(id)?,
            utf16: Utf16Offset::new(*offset as usize),
            affinity: affinity(a),
        },
        PositionDto::Child {
            parent,
            index,
            affinity: a,
        } => Position::Child {
            parent: node(parent)?,
            index: *index as usize,
            affinity: affinity(a),
        },
        PositionDto::Edge { node: id, side } => Position::Edge {
            node: node(id)?,
            side: match side {
                AffinityDto::Before => Edge::Before,
                AffinityDto::After => Edge::After,
            },
        },
    })
}

pub fn position_out(value: Position<NodeId>) -> PositionDto {
    match value {
        Position::Text {
            leaf,
            utf16,
            affinity,
        } => PositionDto::Text {
            node: leaf.to_token(),
            offset: u32::try_from(utf16.get()).expect("admitted WASM32 position"),
            affinity: affinity_out(affinity),
        },
        Position::Child {
            parent,
            index,
            affinity,
        } => PositionDto::Child {
            parent: parent.to_token(),
            index: u32::try_from(index).expect("admitted bounded child index"),
            affinity: affinity_out(affinity),
        },
        Position::Edge { node, side } => PositionDto::Edge {
            node: node.to_token(),
            side: match side {
                Edge::Before => AffinityDto::Before,
                Edge::After => AffinityDto::After,
            },
        },
    }
}

pub fn selection_in(
    value: &SelectionDto,
    key: SessionKey,
) -> Result<Selection<NodeId>, DiagnosticDto> {
    Ok(Selection {
        anchor: position_in(&value.anchor, key)?,
        focus: position_in(&value.focus, key)?,
    })
}
pub fn selection_out(value: Selection<NodeId>) -> SelectionDto {
    SelectionDto {
        anchor: position_out(value.anchor),
        focus: position_out(value.focus),
    }
}

pub fn attribute_out(value: &Attribute) -> AttributeDto {
    match value {
        Attribute::Null => AttributeDto::Null {},
        Attribute::Boolean(v) => AttributeDto::Boolean { value: *v },
        Attribute::Number(v) => AttributeDto::Number {
            value: v.to_string(),
        },
        Attribute::String(v) => AttributeDto::String { value: v.clone() },
        Attribute::List(v) => AttributeDto::List {
            value: v.iter().map(attribute_out).collect(),
        },
        Attribute::Object(v) => AttributeDto::Object {
            value: attrs_out(v),
        },
    }
}
pub fn attrs_out(value: &Attributes) -> BTreeMap<String, AttributeDto> {
    value
        .iter()
        .map(|(k, v)| (k.clone(), attribute_out(v)))
        .collect()
}
pub fn marks_out(value: &[Mark]) -> Vec<MarkDto> {
    value
        .iter()
        .map(|v| MarkDto {
            type_id: v.type_id.clone(),
            attributes: attrs_out(&v.attributes),
        })
        .collect()
}

fn attribute_in(
    value: &AttributeDto,
    depth: usize,
    count: &mut usize,
) -> Result<Attribute, DiagnosticDto> {
    *count += 1;
    if depth > 64 || *count > 65_536 {
        return Err(diagnostic("sdk.payload_limit", "attributes"));
    }
    Ok(match value {
        AttributeDto::Null {} => Attribute::Null,
        AttributeDto::Boolean { value: v } => Attribute::Boolean(*v),
        AttributeDto::String { value: v } => Attribute::String(v.clone()),
        AttributeDto::Number { value: v } => {
            if v.len() > 64 {
                return Err(diagnostic("sdk.invalid_number", "attributes.number"));
            }
            let parsed: serde_json::Number = serde_json::from_str(v)
                .map_err(|_| diagnostic("sdk.invalid_number", "attributes.number"))?;
            if parsed.to_string() != *v {
                return Err(diagnostic("sdk.noncanonical_number", "attributes.number"));
            }
            Attribute::Number(parsed)
        }
        AttributeDto::List { value: v } => Attribute::List(
            v.iter()
                .map(|v| attribute_in(v, depth + 1, count))
                .collect::<Result<_, _>>()?,
        ),
        AttributeDto::Object { value: v } => Attribute::Object(
            v.iter()
                .map(|(k, v)| Ok((k.clone(), attribute_in(v, depth + 1, count)?)))
                .collect::<Result<_, DiagnosticDto>>()?,
        ),
    })
}
pub fn attrs_in(value: &BTreeMap<String, AttributeDto>) -> Result<Attributes, DiagnosticDto> {
    let mut count = 0;
    value
        .iter()
        .map(|(key, value)| Ok((key.clone(), attribute_in(value, 0, &mut count)?)))
        .collect()
}
pub fn marks_in(value: &[MarkDto]) -> Result<Vec<Mark>, DiagnosticDto> {
    if value.len() > 128 {
        return Err(diagnostic("sdk.payload_limit", "marks"));
    }
    let mut count = 0;
    value
        .iter()
        .map(|v| {
            Ok(Mark {
                type_id: v.type_id.clone(),
                attributes: v
                    .attributes
                    .iter()
                    .map(|(k, v)| Ok((k.clone(), attribute_in(v, 0, &mut count)?)))
                    .collect::<Result<_, DiagnosticDto>>()?,
            })
        })
        .collect()
}

pub fn primitive_out(value: Option<Primitive>) -> &'static str {
    match value {
        None => "root",
        Some(Primitive::Text) => "text",
        Some(Primitive::TextBlock) => "text_block",
        Some(Primitive::Container) => "container",
        Some(Primitive::InlineAtom) => "inline_atom",
        Some(Primitive::BlockAtom) => "block_atom",
        Some(Primitive::HardBreak) => "hard_break",
    }
}

pub fn history_hint(v: HistoryHintDto) -> Result<HistoryHint, DiagnosticDto> {
    Ok(match v {
        HistoryHintDto::Isolated {} => HistoryHint::Isolated,
        HistoryHintDto::Typing { token, class } => HistoryHint::Typing {
            token: decimal(&token, "history_hint.token")?,
            class: match class {
                TypingClassDto::Insert => TypingClass::Insert,
                TypingClassDto::DeleteBackward => TypingClass::DeleteBackward,
                TypingClassDto::DeleteForward => TypingClass::DeleteForward,
            },
        },
    })
}

pub fn history_out(v: HistorySummary) -> HistoryViewDto {
    HistoryViewDto {
        undo_entries: v.undo_units.to_string(),
        redo_entries: v.redo_units.to_string(),
        retained_bytes: v.retained_bytes.to_string(),
    }
}
pub fn presentation_out(v: CommandPresentation) -> PresentationDto {
    PresentationDto {
        active: match v.active {
            Some(ActiveState::On) => "on",
            Some(ActiveState::Off) => "off",
            Some(ActiveState::Mixed) => "mixed",
            None => "none",
        }
        .into(),
    }
}

pub fn event_out(v: &SessionEvent) -> EventDto {
    let p = v.payload();
    EventDto {
        sequence: v.cursor().sequence().to_string(),
        before: stamp_out(p.before),
        after: stamp_out(p.after),
        selection_before: p.selection_before.map(selection_out),
        selection_after: p.selection_after.map(selection_out),
        stored_marks_before: p.stored_marks_before.as_deref().map(marks_out),
        stored_marks_after: p.stored_marks_after.as_deref().map(marks_out),
        dirty_before: p.dirty_before,
        dirty_after: p.dirty_after,
        history: history_out(p.history),
        change: match &p.kind {
            EventKind::Document { impact, .. } => EventKindDto::Document {
                impact: ImpactDto {
                    upserted: impact.upserted.iter().map(|v| v.to_token()).collect(),
                    removed: impact.removed.iter().map(|v| v.to_token()).collect(),
                    ancestors_before: impact
                        .ancestors_before
                        .iter()
                        .map(|v| v.to_token())
                        .collect(),
                    ancestors_after: impact
                        .ancestors_after
                        .iter()
                        .map(|v| v.to_token())
                        .collect(),
                    root_order_changed: impact.root_order_changed,
                },
                from_revision: p.before.revision.to_string(),
                to_revision: p.after.revision.to_string(),
            },
            EventKind::State(v) => EventKindDto::State {
                selection_changed: v.selection_changed,
                stored_marks_changed: v.stored_marks_changed,
                history_changed: v.history_changed,
                baseline_changed: v.baseline_changed,
            },
        },
    }
}
