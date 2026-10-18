// SPDX-License-Identifier: MIT OR Apache-2.0
//! Small compiled notes commands. Runtime recipes use a separate generic
//! provider wrapper; every plan still uses the engine's one preparation path.
use editor_core::candidate::{BorrowedNode, CandidateRead};
use editor_core::commands::{
    CommandDescriptor, CommandPresentation, CommandProvider, CommandState, LocalRef, PlanBuilder,
    SelectionIntent,
};
use editor_core::document::{Attribute, Attributes, Mark, Node, Primitive};
use editor_core::positions::{Affinity, Edge, Position, Selection, Utf16Offset, utf16_to_utf8};
use editor_core::transaction::{Operation, WorkMeter};

use crate::{NotesContext, NotesError, NotesErrorCode as E, NotesProfile, TEXT};

pub const INSERT_TEXT: &str = "org.example.notes/command/insert-text";
pub const SET_TITLE: &str = "org.example.notes/command/set-title";
pub const SET_TAGS: &str = "org.example.notes/command/set-tags";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NativeNotesIntent {
    InsertText { text: String },
    SetTitle { title: String },
    SetTags { tags: Vec<String> },
}

#[derive(Clone, Copy)]
struct Point<I> {
    parent: I,
    index: usize,
    inside: Option<(I, usize)>,
}
impl<I: Copy> Point<I> {
    fn order(self) -> (usize, usize) {
        (self.index, self.inside.map_or(0, |(_, n)| n))
    }
}
fn unsupported() -> NotesError {
    NotesError::new(E::CommandUnsupportedContext, "/selection")
}
fn node<'a, V: CandidateRead>(
    view: &'a V,
    id: V::Id,
    work: &mut WorkMeter,
) -> Result<BorrowedNode<'a, V::Id>, NotesError> {
    work.charge_units(1)?;
    view.node(id).ok_or_else(unsupported)
}
fn child_index<V: CandidateRead>(
    view: &V,
    id: V::Id,
    parent: V::Id,
    work: &mut WorkMeter,
) -> Result<usize, NotesError> {
    let parent = node(view, parent, work)?;
    if parent.primitive != Primitive::TextBlock {
        return Err(unsupported());
    }
    work.charge_units(parent.children.len() as u64)?;
    parent
        .children
        .iter()
        .position(|child| *child == id)
        .ok_or_else(unsupported)
}
fn text_point<V: CandidateRead>(
    view: &V,
    leaf: V::Id,
    offset: Utf16Offset,
    work: &mut WorkMeter,
) -> Result<Point<V::Id>, NotesError> {
    let source = node(view, leaf, work)?;
    if source.primitive != Primitive::Text {
        return Err(unsupported());
    }
    let text = source.text.ok_or_else(unsupported)?;
    let index = child_index(view, leaf, source.parent, work)?;
    work.charge_units(text.len() as u64)?;
    let bytes = utf16_to_utf8(text, offset)
        .map_err(|_| unsupported())?
        .get();
    if bytes == 0 {
        Ok(Point {
            parent: source.parent,
            index,
            inside: None,
        })
    } else if bytes == text.len() {
        Ok(Point {
            parent: source.parent,
            index: index + 1,
            inside: None,
        })
    } else {
        Ok(Point {
            parent: source.parent,
            index,
            inside: Some((leaf, offset.get())),
        })
    }
}
fn point<V: CandidateRead>(
    view: &V,
    position: Position<V::Id>,
    work: &mut WorkMeter,
) -> Result<Point<V::Id>, NotesError> {
    match position {
        Position::Text { leaf, utf16, .. } => text_point(view, leaf, utf16, work),
        Position::Child { parent, index, .. } => {
            let source = node(view, parent, work)?;
            if source.primitive != Primitive::TextBlock || index > source.children.len() {
                return Err(unsupported());
            }
            Ok(Point {
                parent,
                index,
                inside: None,
            })
        }
        Position::Edge { node: id, side } => {
            let source = node(view, id, work)?;
            match source.primitive {
                Primitive::Text => {
                    let text = source.text.ok_or_else(unsupported)?;
                    work.charge_units(text.len() as u64)?;
                    let offset = if side == Edge::Before {
                        0
                    } else {
                        text.encode_utf16().count()
                    };
                    text_point(view, id, Utf16Offset::new(offset), work)
                }
                Primitive::TextBlock => Ok(Point {
                    parent: id,
                    index: if side == Edge::Before {
                        0
                    } else {
                        source.children.len()
                    },
                    inside: None,
                }),
                Primitive::HardBreak | Primitive::InlineAtom => {
                    let index = child_index(view, id, source.parent, work)?;
                    Ok(Point {
                        parent: source.parent,
                        index: index + usize::from(side == Edge::After),
                        inside: None,
                    })
                }
                _ => Err(unsupported()),
            }
        }
    }
}
fn mapped<I: Copy>(position: Position<I>) -> Position<LocalRef<I>> {
    match position {
        Position::Text {
            leaf,
            utf16,
            affinity,
        } => Position::Text {
            leaf: leaf.into(),
            utf16,
            affinity,
        },
        Position::Child {
            parent,
            index,
            affinity,
        } => Position::Child {
            parent: parent.into(),
            index,
            affinity,
        },
        Position::Edge { node, side } => Position::Edge {
            node: node.into(),
            side,
        },
    }
}

fn focus_leaf<V: CandidateRead>(
    view: &V,
    position: Position<V::Id>,
    work: &mut WorkMeter,
) -> Result<Option<V::Id>, NotesError> {
    match position {
        Position::Text { leaf, .. } => Ok(Some(leaf)),
        Position::Edge { node: id, .. } if node(view, id, work)?.primitive == Primitive::Text => {
            Ok(Some(id))
        }
        Position::Edge { node: id, .. }
            if matches!(
                node(view, id, work)?.primitive,
                Primitive::HardBreak | Primitive::InlineAtom
            ) =>
        {
            Ok(None)
        }
        _ => {
            let at = point(view, position, work)?;
            let source = node(view, at.parent, work)?;
            let selected = match position.affinity() {
                Affinity::Before => at
                    .index
                    .checked_sub(1)
                    .and_then(|n| source.children.get(n))
                    .or_else(|| (at.index == 0).then(|| source.children.first()).flatten()),
                Affinity::After => source.children.get(at.index).or_else(|| {
                    (at.index == source.children.len())
                        .then(|| source.children.last())
                        .flatten()
                }),
            };
            match selected {
                Some(id) if node(view, *id, work)?.primitive == Primitive::Text => Ok(Some(*id)),
                _ => Ok(None),
            }
        }
    }
}

fn deletion_caret<V: CandidateRead>(
    view: &V,
    start: Point<V::Id>,
    work: &mut WorkMeter,
) -> Result<Position<LocalRef<V::Id>>, NotesError> {
    if let Some((leaf, offset)) = start.inside {
        return Ok(Position::Text {
            leaf: leaf.into(),
            utf16: Utf16Offset::new(offset),
            affinity: Affinity::After,
        });
    }
    let source = node(view, start.parent, work)?;
    if let Some(previous) = start
        .index
        .checked_sub(1)
        .and_then(|index| source.children.get(index))
    {
        let previous_node = node(view, *previous, work)?;
        if previous_node.primitive == Primitive::Text {
            let text = previous_node.text.ok_or_else(unsupported)?;
            work.charge_units(text.len() as u64)?;
            return Ok(Position::Text {
                leaf: (*previous).into(),
                utf16: Utf16Offset::new(text.encode_utf16().count()),
                affinity: Affinity::After,
            });
        }
    }
    Ok(Position::Child {
        parent: start.parent.into(),
        index: start.index,
        affinity: Affinity::After,
    })
}

impl CommandProvider for NotesProfile {
    type Intent<I: Copy + Eq + Ord> = NativeNotesIntent;
    const COMMANDS: &'static [CommandDescriptor] = &[
        CommandDescriptor { id: INSERT_TEXT },
        CommandDescriptor { id: SET_TITLE },
        CommandDescriptor { id: SET_TAGS },
    ];
    fn command_id<I: Copy + Eq + Ord>(intent: &NativeNotesIntent) -> &str {
        match intent {
            NativeNotesIntent::InsertText { .. } => INSERT_TEXT,
            NativeNotesIntent::SetTitle { .. } => SET_TITLE,
            NativeNotesIntent::SetTags { .. } => SET_TAGS,
        }
    }
    fn prepare_command<V: CandidateRead>(
        &self,
        context: &NotesContext,
        view: &V,
        state: CommandState<'_, V::Id>,
        intent: &NativeNotesIntent,
        plan: &mut PlanBuilder<'_, V::Id>,
    ) -> Result<CommandPresentation, NotesError> {
        self.check_context(context)?;
        let document = *view.roots().first().ok_or_else(unsupported)?;
        match intent {
            NativeNotesIntent::SetTitle { title } => {
                let title = plan.charged_copy_text(title)?;
                plan.work().charge_bytes(5)?;
                plan.push(Operation::SetAttribute {
                    node: document.into(),
                    key: "title".into(),
                    value: Some(Attribute::String(title)),
                })?;
            }
            NativeNotesIntent::SetTags { tags } => {
                plan.work().charge_units(tags.len() as u64)?;
                plan.work()
                    .charge_bytes((tags.len() * std::mem::size_of::<Attribute>()) as u64 + 4)?;
                let mut copied = Vec::with_capacity(tags.len());
                for tag in tags {
                    copied.push(Attribute::String(plan.charged_copy_text(tag)?));
                }
                plan.push(Operation::SetAttribute {
                    node: document.into(),
                    key: "tags".into(),
                    value: Some(Attribute::List(copied)),
                })?;
            }
            NativeNotesIntent::InsertText { text } => {
                let selection = state
                    .selection
                    .copied()
                    .ok_or_else(|| NotesError::new(E::CommandSelectionRequired, "/selection"))?;
                let anchor = point(view, selection.anchor, plan.work())?;
                let focus = point(view, selection.focus, plan.work())?;
                if anchor.parent != focus.parent {
                    return Err(unsupported());
                }
                if text.is_empty() && anchor.order() == focus.order() {
                    return Ok(CommandPresentation::default());
                }
                if text.len() as u64 > self.limits().text_leaf_bytes {
                    return Err(NotesError::new(E::ResourceLimitExceeded, "/text"));
                }
                let inserted = if text.is_empty() {
                    None
                } else {
                    let marks = match state.stored_marks {
                        Some(marks) => plan.charged_copy_marks(marks)?,
                        None => match focus_leaf(view, selection.focus, plan.work())? {
                            Some(id) => {
                                let source = node(view, id, plan.work())?;
                                plan.charged_copy_marks(source.marks)?
                            }
                            None => vec![],
                        },
                    };
                    let value = plan.charged_copy_text(text)?;
                    let type_id = plan.charged_copy_text(TEXT)?;
                    plan.work()
                        .charge_bytes(std::mem::size_of::<Node>() as u64)?;
                    Some(Node {
                        type_id,
                        primitive: Primitive::Text,
                        attributes: Attributes::new(),
                        marks,
                        text: Some(value),
                        children: vec![],
                    })
                };
                let caret = if inserted.is_none() {
                    Some(deletion_caret(
                        view,
                        if anchor.order() <= focus.order() {
                            anchor
                        } else {
                            focus
                        },
                        plan.work(),
                    )?)
                } else {
                    None
                };
                let operation = plan.push(Operation::ReplaceInlineRange {
                    range: Selection {
                        anchor: mapped(selection.anchor),
                        focus: mapped(selection.focus),
                    },
                    inserted,
                })?;
                plan.work().charge_bytes(
                    (2 * std::mem::size_of::<Position<LocalRef<V::Id>>>()
                        + 2 * std::mem::size_of::<usize>()) as u64,
                )?;
                let caret = match caret {
                    Some(caret) => caret,
                    None => {
                        plan.work().charge_units(text.len() as u64)?;
                        Position::Text {
                            leaf: LocalRef::Created {
                                operation,
                                path: vec![0],
                            },
                            utf16: Utf16Offset::new(text.encode_utf16().count()),
                            affinity: Affinity::After,
                        }
                    }
                };
                plan.set_selection(SelectionIntent::MapFromUserResult(Some(Selection {
                    anchor: caret.clone(),
                    focus: caret,
                })))?;
            }
        }
        Ok(CommandPresentation::default())
    }
    fn finalize_typing_override<V: CandidateRead>(
        &self,
        context: &NotesContext,
        view: &V,
        selection: Option<Selection<V::Id>>,
        proposed: Option<&[Mark]>,
        work: &mut WorkMeter,
    ) -> Result<Option<Vec<Mark>>, NotesError> {
        self.check_context(context)?;
        let Some(marks) = proposed else {
            return Ok(None);
        };
        let selection = selection.ok_or_else(unsupported)?;
        let anchor = point(view, selection.anchor, work)?;
        let focus = point(view, selection.focus, work)?;
        if anchor.parent != focus.parent {
            return Err(unsupported());
        }
        let type_id = match focus_leaf(view, selection.focus, work)? {
            Some(id) => node(view, id, work)?.type_id,
            None => TEXT,
        };
        self.registry()
            .validate_marks(type_id, marks, work)
            .map_err(NotesError::typing)?;
        Ok(Some(
            PlanBuilder::<V::Id>::new(work, 0).charged_copy_marks(marks)?,
        ))
    }
    fn error_code(error: &NotesError) -> &'static str {
        error.as_str()
    }
}
