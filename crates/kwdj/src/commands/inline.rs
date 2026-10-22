// SPDX-License-Identifier: MIT OR Apache-2.0
//! KWDJ inline command policy. Plans borrow the candidate and never publish.

use editor_core::candidate::CandidateRead;
use editor_core::commands::{
    ActiveState, CommandPresentation, CommandState, LocalRef, PlanBuilder, SelectionIntent,
    StoredMarksUpdate,
};
use editor_core::document::{Attribute, Attributes, Mark, Node, Primitive};
use editor_core::positions::{Affinity, Edge, Position, Selection, Utf16Offset, utf16_to_utf8};
use editor_core::transaction::{MarkEdit, Operation, WorkMeter};

use crate::{KwdjError, KwdjErrorCode, KwdjProfile, Profile};

fn error(code: KwdjErrorCode) -> KwdjError {
    KwdjError::new(code, "/command")
}
fn invalid() -> KwdjError {
    error(KwdjErrorCode::CommandInvalidTarget)
}
fn unsupported() -> KwdjError {
    error(KwdjErrorCode::CommandUnsupportedContext)
}
fn units(work: &mut WorkMeter, n: usize) -> Result<(), KwdjError> {
    work.charge_units(n as u64).map_err(KwdjError::operational)
}
fn bytes(work: &mut WorkMeter, n: usize) -> Result<(), KwdjError> {
    work.charge_bytes(n as u64).map_err(KwdjError::operational)
}
fn push<T>(values: &mut Vec<T>, value: T, work: &mut WorkMeter) -> Result<(), KwdjError> {
    units(work, 1)?;
    bytes(work, std::mem::size_of::<T>())?;
    values.push(value);
    Ok(())
}
fn local(kind: &str) -> &str {
    kind.strip_prefix("org.klenwriter.kwdj/").unwrap_or(kind)
}
fn required_selection<I: Copy>(state: CommandState<'_, I>) -> Result<Selection<I>, KwdjError> {
    state
        .selection
        .copied()
        .ok_or_else(|| error(KwdjErrorCode::CommandSelectionRequired))
}

#[derive(Debug, Clone, Copy)]
pub(super) struct TextPoint<I> {
    pub block: I,
    /// Original child index. For a text leaf this is its own child index.
    pub index: usize,
    pub leaf: Option<I>,
    pub utf16: Utf16Offset,
}

/// Resolve a text position or textblock gap without copying its text/metadata.
pub(super) fn text_point<V: CandidateRead>(
    view: &V,
    position: Position<V::Id>,
    work: &mut WorkMeter,
) -> Result<TextPoint<V::Id>, KwdjError> {
    units(work, 1)?;
    match position {
        Position::Text { leaf, utf16, .. } => {
            let node = view.node(leaf).ok_or_else(invalid)?;
            if node.primitive != Primitive::Text {
                return Err(unsupported());
            }
            let text = node.text.ok_or_else(invalid)?;
            bytes(work, text.len())?;
            utf16_to_utf8(text, utf16).map_err(|_| invalid())?;
            let parent = view.node(node.parent).ok_or_else(unsupported)?;
            if parent.primitive != Primitive::TextBlock {
                return Err(unsupported());
            }
            units(work, parent.children.len())?;
            let index = parent
                .children
                .iter()
                .position(|id| *id == leaf)
                .ok_or_else(invalid)?;
            Ok(TextPoint {
                block: node.parent,
                index,
                leaf: Some(leaf),
                utf16,
            })
        }
        Position::Child { parent, index, .. } => {
            let node = view.node(parent).ok_or_else(unsupported)?;
            if node.primitive != Primitive::TextBlock || index > node.children.len() {
                return Err(unsupported());
            }
            Ok(TextPoint {
                block: parent,
                index,
                leaf: None,
                utf16: Utf16Offset::new(0),
            })
        }
        Position::Edge { node, side } => {
            let header = view.node(node).ok_or_else(invalid)?;
            match header.primitive {
                Primitive::Text => {
                    let text = header.text.ok_or_else(invalid)?;
                    bytes(work, text.len())?;
                    let at = if side == Edge::Before {
                        0
                    } else {
                        text.encode_utf16().count()
                    };
                    text_point(
                        view,
                        Position::Text {
                            leaf: node,
                            utf16: Utf16Offset::new(at),
                            affinity: position.affinity(),
                        },
                        work,
                    )
                }
                Primitive::HardBreak | Primitive::InlineAtom => {
                    let parent = view.node(header.parent).ok_or_else(unsupported)?;
                    if parent.primitive != Primitive::TextBlock {
                        return Err(unsupported());
                    }
                    units(work, parent.children.len())?;
                    let index = parent
                        .children
                        .iter()
                        .position(|child| *child == node)
                        .ok_or_else(invalid)?;
                    Ok(TextPoint {
                        block: header.parent,
                        index: index + usize::from(side == Edge::After),
                        leaf: None,
                        utf16: Utf16Offset::new(0),
                    })
                }
                Primitive::TextBlock => Ok(TextPoint {
                    block: node,
                    index: if side == Edge::Before {
                        0
                    } else {
                        header.children.len()
                    },
                    leaf: None,
                    utf16: Utf16Offset::new(0),
                }),
                _ => Err(unsupported()),
            }
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub(super) struct TextSpan<I> {
    pub leaf: I,
    pub parent: I,
    pub index: usize,
    pub from: Utf16Offset,
    pub to: Utf16Offset,
    pub length: usize,
}
#[derive(Debug)]
pub(super) struct OrderedRange<I> {
    pub start: Position<I>,
    pub end: Position<I>,
    pub reversed: bool,
    pub is_empty: bool,
    pub spans: Vec<TextSpan<I>>,
    pub blocks: Vec<I>,
}

struct RangeScan<I> {
    selection: Selection<I>,
    points: [Option<usize>; 2],
    cursor: usize,
    covered: Option<(usize, usize)>,
    spans: Vec<TextSpan<I>>,
    blocks: Vec<I>,
}
impl<I: Copy + Eq> RangeScan<I> {
    fn point(&mut self, predicate: impl Fn(Position<I>) -> bool, rank: usize) {
        for (index, position) in [self.selection.anchor, self.selection.focus]
            .into_iter()
            .enumerate()
        {
            if predicate(position) {
                self.points[index] = Some(rank);
            }
        }
    }
    fn advance(&mut self, n: usize) -> Result<(), KwdjError> {
        self.cursor = self.cursor.checked_add(n).ok_or_else(invalid)?;
        Ok(())
    }
    fn children<V: CandidateRead<Id = I>>(
        &mut self,
        view: &V,
        parent: I,
        children: &[I],
        depth: usize,
        work: &mut WorkMeter,
    ) -> Result<(), KwdjError> {
        units(work, children.len())?;
        for (index, child) in children.iter().enumerate() {
            self.point(|p| matches!(p, Position::Child { parent: id, index: gap, .. } if id == parent && gap == index), self.cursor);
            self.node(view, *child, parent, index, depth, work)?;
        }
        self.point(|p| matches!(p, Position::Child { parent: id, index: gap, .. } if id == parent && gap == children.len()), self.cursor);
        Ok(())
    }
    fn node<V: CandidateRead<Id = I>>(
        &mut self,
        view: &V,
        id: I,
        parent: I,
        index: usize,
        depth: usize,
        work: &mut WorkMeter,
    ) -> Result<(), KwdjError> {
        units(work, 1)?;
        if depth > 128 {
            return Err(unsupported());
        }
        let node = view.node(id).ok_or_else(invalid)?;
        if node.parent != parent {
            return Err(invalid());
        }
        let before = self.cursor;
        // Textblock edges are its first/last inline gap, as in the core range
        // endpoint resolver; structural container edges remain outside.
        let edge_before = if node.primitive == Primitive::TextBlock {
            before.checked_add(1).ok_or_else(invalid)?
        } else {
            before
        };
        self.point(
            |p| matches!(p, Position::Edge { node, side: Edge::Before } if node == id),
            edge_before,
        );
        if node.primitive == Primitive::Text {
            let text = node.text.ok_or_else(invalid)?;
            bytes(work, text.len())?;
            let length = text.encode_utf16().count();
            for (point_index, position) in [self.selection.anchor, self.selection.focus]
                .into_iter()
                .enumerate()
            {
                if let Position::Text { leaf, utf16, .. } = position
                    && leaf == id
                {
                    bytes(work, text.len())?;
                    utf16_to_utf8(text, utf16).map_err(|_| invalid())?;
                    self.points[point_index] =
                        Some(before.checked_add(utf16.get()).ok_or_else(invalid)?);
                }
            }
            self.advance(length)?;
            if let Some((start, end)) = self.covered {
                let from = start.saturating_sub(before).min(length);
                let to = end.saturating_sub(before).min(length);
                if from < to {
                    push(
                        &mut self.spans,
                        TextSpan {
                            leaf: id,
                            parent,
                            index,
                            from: Utf16Offset::new(from),
                            to: Utf16Offset::new(to),
                            length,
                        },
                        work,
                    )?;
                }
            }
        } else if node.children.is_empty()
            && node.primitive != Primitive::TextBlock
            && node.primitive != Primitive::Container
        {
            // A barrier participates in ordering but is never assigned text offsets.
            self.advance(1)?;
        } else {
            self.advance(1)?;
            self.children(view, id, node.children, depth + 1, work)?;
            self.advance(1)?;
        }
        if node.primitive == Primitive::TextBlock
            && let Some((start, end)) = self.covered
            && before < end
            && self.cursor > start
        {
            push(&mut self.blocks, id, work)?;
        }
        let edge_after = if node.primitive == Primitive::TextBlock {
            self.cursor - 1
        } else {
            self.cursor
        };
        self.point(
            |p| matches!(p, Position::Edge { node, side: Edge::After } if node == id),
            edge_after,
        );
        Ok(())
    }
}

/// Stable document order for Text/Child/Edge coordinates, with bounded borrowed
/// traversal. Scalar validity is checked here; user EGC admission belongs to the
/// one core range operation, preserving clusters across old style boundaries.
pub(super) fn ordered_range<V: CandidateRead>(
    view: &V,
    selection: Selection<V::Id>,
    work: &mut WorkMeter,
) -> Result<OrderedRange<V::Id>, KwdjError> {
    let mut scan = RangeScan {
        selection,
        points: [None, None],
        cursor: 0,
        covered: None,
        spans: Vec::new(),
        blocks: Vec::new(),
    };
    scan.children(view, view.root(), view.roots(), 1, work)?;
    let a = scan.points[0].ok_or_else(invalid)?;
    let b = scan.points[1].ok_or_else(invalid)?;
    let reversed = a > b;
    let (start, end) = if reversed {
        (selection.focus, selection.anchor)
    } else {
        (selection.anchor, selection.focus)
    };
    scan.cursor = 0;
    scan.covered = Some((a.min(b), a.max(b)));
    scan.children(view, view.root(), view.roots(), 1, work)?;
    Ok(OrderedRange {
        start,
        end,
        reversed,
        is_empty: a == b,
        spans: scan.spans,
        blocks: scan.blocks,
    })
}

fn ensure_format_block<V: CandidateRead>(
    view: &V,
    block: V::Id,
    work: &mut WorkMeter,
) -> Result<(), KwdjError> {
    units(work, 1)?;
    let node = view.node(block).ok_or_else(invalid)?;
    if !matches!(local(node.type_id), "paragraph" | "heading" | "verse_line") {
        return Err(unsupported());
    }
    Ok(())
}

pub(super) fn caret_marks<'a, V: CandidateRead>(
    view: &'a V,
    state: CommandState<'a, V::Id>,
    position: Position<V::Id>,
    work: &mut WorkMeter,
) -> Result<&'a [Mark], KwdjError> {
    let point = text_point(view, position, work)?;
    if let Some(marks) = state.stored_marks {
        return Ok(marks);
    }
    if let Position::Edge { node, .. } = position
        && let Some(header) = view.node(node)
        && matches!(
            header.primitive,
            Primitive::HardBreak | Primitive::InlineAtom
        )
    {
        return Ok(&[]);
    }
    if let Some(leaf) = point.leaf {
        return Ok(view.node(leaf).ok_or_else(invalid)?.marks);
    }
    let block = view.node(point.block).ok_or_else(invalid)?;
    let side = position.affinity();
    let neighbor = match side {
        Affinity::Before if point.index > 0 => block.children.get(point.index - 1),
        Affinity::After if point.index < block.children.len() => block.children.get(point.index),
        Affinity::Before => block.children.first(),
        Affinity::After => block.children.last(),
    };
    let Some(id) = neighbor else {
        return Ok(&[]);
    };
    units(work, 1)?;
    let node = view.node(*id).ok_or_else(invalid)?;
    Ok(if node.primitive == Primitive::Text {
        node.marks
    } else {
        &[]
    })
}

fn map_position<I>(position: Position<I>) -> Position<LocalRef<I>> {
    match position {
        Position::Text {
            leaf,
            utf16,
            affinity,
        } => Position::Text {
            leaf: LocalRef::Existing(leaf),
            utf16,
            affinity,
        },
        Position::Child {
            parent,
            index,
            affinity,
        } => Position::Child {
            parent: LocalRef::Existing(parent),
            index,
            affinity,
        },
        Position::Edge { node, side } => Position::Edge {
            node: LocalRef::Existing(node),
            side,
        },
    }
}
pub(super) fn map_selection<I>(selection: Selection<I>) -> Selection<LocalRef<I>> {
    Selection {
        anchor: map_position(selection.anchor),
        focus: map_position(selection.focus),
    }
}
fn scan_metadata(
    attrs: &Attributes,
    marks: &[Mark],
    work: &mut WorkMeter,
) -> Result<(), KwdjError> {
    use editor_core::admission::{PreflightBudget, preflight_node_fields};
    let limits = work.limits();
    let spent = work.usage();
    let usage = preflight_node_fields(
        "",
        None,
        attrs,
        marks,
        0,
        PreflightBudget {
            values: limits.units.saturating_sub(spent.units),
            payload_bytes: limits.bytes.saturating_sub(spent.bytes),
            depth: PreflightBudget::default().depth,
        },
    )
    .map_err(KwdjError::operational)?;
    work.charge_units(usage.values)
        .map_err(KwdjError::operational)?;
    work.charge_bytes(usage.payload_bytes.saturating_mul(2))
        .map_err(KwdjError::operational)
}
fn active(total: usize, matching: usize) -> ActiveState {
    if matching == 0 {
        ActiveState::Off
    } else if matching == total {
        ActiveState::On
    } else {
        ActiveState::Mixed
    }
}
fn has_reference(marks: &[Mark], work: &mut WorkMeter) -> Result<bool, KwdjError> {
    units(work, marks.len())?;
    Ok(marks
        .iter()
        .any(|mark| mark.type_id == "org.klenwriter.kwdj/reference_link"))
}
fn range_active<V: CandidateRead>(
    view: &V,
    range: &OrderedRange<V::Id>,
    mark: &str,
    exact: Option<&Mark>,
    protect_reference: bool,
    work: &mut WorkMeter,
) -> Result<ActiveState, KwdjError> {
    for block in &range.blocks {
        ensure_format_block(view, *block, work)?;
    }
    let mut matching = 0;
    for span in &range.spans {
        units(work, 1)?;
        let node = view.node(span.leaf).ok_or_else(invalid)?;
        if node.parent != span.parent
            || view
                .children(span.parent)
                .and_then(|children| children.get(span.index))
                != Some(&span.leaf)
            || span.from.get() >= span.to.get()
            || span.to.get() > span.length
        {
            return Err(invalid());
        }
        if protect_reference && has_reference(node.marks, work)? {
            return Err(error(KwdjErrorCode::CommandReferenceProtected));
        }
        scan_metadata(&Attributes::new(), node.marks, work)?;
        units(work, node.marks.len())?;
        if node
            .marks
            .iter()
            .any(|m| m.type_id == mark && exact.is_none_or(|wanted| m == wanted))
        {
            matching += 1;
        }
    }
    Ok(active(range.spans.len(), matching))
}
fn patch<I: Copy>(
    selection: Selection<I>,
    edit: MarkEdit,
    builder: &mut PlanBuilder<'_, I>,
) -> Result<(), KwdjError> {
    bytes(builder.work(), std::mem::size_of::<MarkEdit>())?;
    builder
        .push(Operation::PatchMarkRange {
            range: map_selection(selection),
            edits: vec![edit],
        })
        .map_err(KwdjError::operational)?;
    Ok(())
}
fn changed_marks<I>(
    source: &[Mark],
    edit: MarkEdit,
    builder: &mut PlanBuilder<'_, I>,
) -> Result<(), KwdjError> {
    let mut marks = builder
        .charged_copy_marks(source)
        .map_err(KwdjError::operational)?;
    match edit {
        MarkEdit::Remove { type_id } => marks.retain(|mark| mark.type_id != type_id),
        MarkEdit::Upsert(mark) => {
            marks.retain(|old| old.type_id != mark.type_id);
            push(&mut marks, mark, builder.work())?;
        }
    }
    if marks == source {
        return Ok(());
    }
    builder
        .set_stored_marks(StoredMarksUpdate::Set(marks))
        .map_err(KwdjError::operational)
}

pub(super) fn toggle_mark<V: CandidateRead>(
    view: &V,
    state: CommandState<'_, V::Id>,
    mark: &Mark,
    builder: &mut PlanBuilder<'_, V::Id>,
) -> Result<CommandPresentation, KwdjError> {
    if !matches!(
        mark.type_id.as_str(),
        "org.klenwriter.kwdj/strong"
            | "org.klenwriter.kwdj/emphasis"
            | "org.klenwriter.kwdj/strike"
            | "org.klenwriter.kwdj/code"
            | "org.klenwriter.kwdj/subscript"
            | "org.klenwriter.kwdj/superscript"
            | "org.klenwriter.kwdj/text_color"
            | "org.klenwriter.kwdj/highlight"
    ) {
        return Err(invalid());
    }
    scan_metadata(
        &Attributes::new(),
        std::slice::from_ref(mark),
        builder.work(),
    )?;
    let selection = required_selection(state)?;
    let range = if selection.anchor == selection.focus {
        None
    } else {
        Some(ordered_range(view, selection, builder.work())?)
    };
    let state_before;
    if range.as_ref().is_none_or(|range| range.is_empty) {
        let point = text_point(view, selection.focus, builder.work())?;
        ensure_format_block(view, point.block, builder.work())?;
        let marks = caret_marks(view, state, selection.focus, builder.work())?;
        scan_metadata(&Attributes::new(), marks, builder.work())?;
        units(builder.work(), marks.len())?;
        state_before = if marks.iter().any(|old| old == mark) {
            ActiveState::On
        } else {
            ActiveState::Off
        };
        let edit = if state_before == ActiveState::On {
            MarkEdit::Remove {
                type_id: builder
                    .charged_copy_text(&mark.type_id)
                    .map_err(KwdjError::operational)?,
            }
        } else {
            let owned = builder
                .charged_copy_marks(std::slice::from_ref(mark))
                .map_err(KwdjError::operational)?
                .pop()
                .expect("one charged mark");
            MarkEdit::Upsert(owned)
        };
        changed_marks(marks, edit, builder)?;
    } else {
        let range = range.expect("nonempty semantic range was prepared");
        state_before = range_active(
            view,
            &range,
            &mark.type_id,
            Some(mark),
            false,
            builder.work(),
        )?;
        if !range.spans.is_empty() {
            let edit = if state_before == ActiveState::On {
                MarkEdit::Remove {
                    type_id: builder
                        .charged_copy_text(&mark.type_id)
                        .map_err(KwdjError::operational)?,
                }
            } else {
                MarkEdit::Upsert(
                    builder
                        .charged_copy_marks(std::slice::from_ref(mark))
                        .map_err(KwdjError::operational)?
                        .pop()
                        .expect("one charged mark"),
                )
            };
            let directed = if range.reversed {
                Selection {
                    anchor: range.end,
                    focus: range.start,
                }
            } else {
                Selection {
                    anchor: range.start,
                    focus: range.end,
                }
            };
            patch(directed, edit, builder)?;
        }
    }
    Ok(CommandPresentation {
        active: Some(state_before),
    })
}

fn ordinary_link<V: CandidateRead>(
    view: &V,
    state: CommandState<'_, V::Id>,
    mark: Option<Mark>,
    builder: &mut PlanBuilder<'_, V::Id>,
) -> Result<CommandPresentation, KwdjError> {
    let selection = required_selection(state)?;
    let type_id = "org.klenwriter.kwdj/link";
    let range = if selection.anchor == selection.focus {
        None
    } else {
        Some(ordered_range(view, selection, builder.work())?)
    };
    let state_before;
    if range.as_ref().is_none_or(|range| range.is_empty) {
        let point = text_point(view, selection.focus, builder.work())?;
        ensure_format_block(view, point.block, builder.work())?;
        let marks = caret_marks(view, state, selection.focus, builder.work())?;
        if has_reference(marks, builder.work())? {
            return Err(error(KwdjErrorCode::CommandReferenceProtected));
        }
        scan_metadata(&Attributes::new(), marks, builder.work())?;
        units(builder.work(), marks.len())?;
        state_before = if marks
            .iter()
            .any(|old| old.type_id == type_id && mark.as_ref().is_none_or(|m| old == m))
        {
            ActiveState::On
        } else {
            ActiveState::Off
        };
        let edit = match mark {
            Some(mark) => MarkEdit::Upsert(mark),
            None => MarkEdit::Remove {
                type_id: builder
                    .charged_copy_text(type_id)
                    .map_err(KwdjError::operational)?,
            },
        };
        changed_marks(marks, edit, builder)?;
    } else {
        let range = range.expect("nonempty semantic range was prepared");
        state_before = range_active(view, &range, type_id, mark.as_ref(), true, builder.work())?;
        if !range.spans.is_empty() {
            let edit = match mark {
                Some(mark) => MarkEdit::Upsert(mark),
                None => MarkEdit::Remove {
                    type_id: builder
                        .charged_copy_text(type_id)
                        .map_err(KwdjError::operational)?,
                },
            };
            let directed = if range.reversed {
                Selection {
                    anchor: range.end,
                    focus: range.start,
                }
            } else {
                Selection {
                    anchor: range.start,
                    focus: range.end,
                }
            };
            patch(directed, edit, builder)?;
        }
    }
    Ok(CommandPresentation {
        active: Some(state_before),
    })
}

pub(super) fn set_link<V: CandidateRead>(
    view: &V,
    state: CommandState<'_, V::Id>,
    href: &str,
    title: Option<&str>,
    builder: &mut PlanBuilder<'_, V::Id>,
) -> Result<CommandPresentation, KwdjError> {
    // Owned payload copies are charged before constructing any new metadata.
    let href = builder
        .charged_copy_text(href)
        .map_err(KwdjError::operational)?;
    let title = title
        .map(|text| {
            units(builder.work(), 1)?;
            bytes(builder.work(), text.len())?;
            Ok::<_, KwdjError>(crate::normalize::normalize_newlines(text))
        })
        .transpose()?;
    bytes(builder.work(), 256)?;
    let mut attributes = Attributes::new();
    attributes.insert("href".into(), Attribute::String(href));
    if let Some(title) = title {
        attributes.insert("title".into(), Attribute::String(title));
    }
    let type_id = builder
        .charged_copy_text("org.klenwriter.kwdj/link")
        .map_err(KwdjError::operational)?;
    ordinary_link(
        view,
        state,
        Some(Mark {
            type_id,
            attributes,
        }),
        builder,
    )
}

pub(super) fn unset_link<V: CandidateRead>(
    view: &V,
    state: CommandState<'_, V::Id>,
    builder: &mut PlanBuilder<'_, V::Id>,
) -> Result<CommandPresentation, KwdjError> {
    ordinary_link(view, state, None, builder)
}

pub(super) fn finalize_typing_override<V: CandidateRead>(
    profile: &KwdjProfile<'_>,
    _context: Profile,
    view: &V,
    selection: Option<Selection<V::Id>>,
    proposed: Option<&[Mark]>,
    work: &mut WorkMeter,
) -> Result<Option<Vec<Mark>>, KwdjError> {
    let Some(marks) = proposed else {
        return Ok(None);
    };
    let selection = selection.ok_or_else(|| error(KwdjErrorCode::CommandSelectionRequired))?;
    let point = text_point(view, selection.focus, work)?;
    let canonical = crate::validate::canonical_command_marks(
        marks,
        profile.identities(),
        profile.limits(),
        work,
    )?;
    let block = view.node(point.block).ok_or_else(invalid)?;
    if local(block.type_id) == "code_block" {
        if !canonical.is_empty() {
            return Err(unsupported());
        }
    } else {
        ensure_format_block(view, point.block, work)?;
    }
    if !canonical.is_empty() && selection.anchor != selection.focus {
        let range = ordered_range(view, selection, work)?;
        if !range.is_empty {
            for block in range.blocks {
                ensure_format_block(view, block, work)?;
            }
        }
    }
    Ok(Some(canonical))
}

/// Bounded typing companion: the prototype is actual authored inline payload;
/// the core range operation admits both outer EGC boundaries as one edit.
pub(super) fn insert_text<V: CandidateRead>(
    view: &V,
    state: CommandState<'_, V::Id>,
    text: &str,
    builder: &mut PlanBuilder<'_, V::Id>,
) -> Result<CommandPresentation, KwdjError> {
    let selection = required_selection(state)?;
    let range = ordered_range(view, selection, builder.work())?;
    if text.is_empty() && range.is_empty {
        return Ok(CommandPresentation::default());
    }
    let start = text_point(view, range.start, builder.work())?;
    let end = text_point(view, range.end, builder.work())?;
    if start.block != end.block {
        return insert_across_blocks(view, state, text, range, builder);
    }
    let block = view.node(start.block).ok_or_else(invalid)?;
    if !matches!(
        local(block.type_id),
        "paragraph" | "heading" | "verse_line" | "code_block"
    ) {
        return Err(unsupported());
    }
    let typing_point = if range.is_empty {
        selection.focus
    } else {
        range.start
    };
    let marks = caret_marks(view, state, typing_point, builder.work())?;
    let inserted = if text.is_empty() {
        None
    } else {
        let marks = builder
            .charged_copy_marks(marks)
            .map_err(KwdjError::operational)?;
        let owned = builder
            .charged_copy_text(text)
            .map_err(KwdjError::operational)?;
        let type_id = builder
            .charged_copy_text("org.klenwriter.kwdj/text")
            .map_err(KwdjError::operational)?;
        bytes(builder.work(), std::mem::size_of::<Node>())?;
        Some(Node {
            type_id,
            primitive: Primitive::Text,
            attributes: Attributes::new(),
            marks,
            text: Some(owned),
            children: Vec::new(),
        })
    };
    let inserted_units = if inserted.is_some() {
        bytes(builder.work(), text.len())?;
        text.encode_utf16().count()
    } else {
        0
    };
    let operation = builder
        .push(Operation::ReplaceInlineRange {
            range: map_selection(selection),
            inserted,
        })
        .map_err(KwdjError::operational)?;
    if !text.is_empty() {
        bytes(builder.work(), std::mem::size_of::<usize>() * 2)?;
        let caret = Position::Text {
            leaf: LocalRef::Created {
                operation,
                path: vec![0],
            },
            utf16: Utf16Offset::new(inserted_units),
            affinity: Affinity::After,
        };
        let focus = Position::Text {
            leaf: LocalRef::Created {
                operation,
                path: vec![0],
            },
            utf16: Utf16Offset::new(inserted_units),
            affinity: Affinity::After,
        };
        builder
            .set_selection(SelectionIntent::MapFromUserResult(Some(Selection {
                anchor: caret,
                focus,
            })))
            .map_err(KwdjError::operational)?;
    } else {
        let prefix = start.index + usize::from(start.leaf.is_some() && start.utf16.get() > 0);
        let caret = Position::Child {
            parent: LocalRef::Existing(start.block),
            index: prefix,
            affinity: Affinity::After,
        };
        let focus = Position::Child {
            parent: LocalRef::Existing(start.block),
            index: prefix,
            affinity: Affinity::After,
        };
        builder
            .set_selection(SelectionIntent::MapFromUserResult(Some(Selection {
                anchor: caret,
                focus,
            })))
            .map_err(KwdjError::operational)?;
    }
    Ok(CommandPresentation::default())
}

fn insert_across_blocks<V: CandidateRead>(
    view: &V,
    state: CommandState<'_, V::Id>,
    text: &str,
    range: OrderedRange<V::Id>,
    builder: &mut PlanBuilder<'_, V::Id>,
) -> Result<CommandPresentation, KwdjError> {
    let start = text_point(view, range.start, builder.work())?;
    let end = text_point(view, range.end, builder.work())?;
    let left = view.node(start.block).ok_or_else(invalid)?;
    let right = view.node(end.block).ok_or_else(invalid)?;
    ensure_format_block(view, start.block, builder.work())?;
    ensure_format_block(view, end.block, builder.work())?;
    if left.parent != right.parent {
        return Err(unsupported());
    }
    scan_metadata(left.attributes, &[], builder.work())?;
    scan_metadata(right.attributes, &[], builder.work())?;
    if left.type_id != right.type_id || left.attributes != right.attributes {
        return Err(error(KwdjErrorCode::CommandLossyTransform));
    }
    let siblings = view.children(left.parent).ok_or_else(invalid)?;
    units(builder.work(), siblings.len())?;
    let left_index = siblings
        .iter()
        .position(|id| *id == start.block)
        .ok_or_else(invalid)?;
    let right_index = siblings
        .iter()
        .position(|id| *id == end.block)
        .ok_or_else(invalid)?;
    if left_index >= right_index {
        return Err(invalid());
    }
    // Keep explicit end-tail identities. Only a user-safe outer endpoint is
    // split; old style seams inside a complete EGC are never split or moved
    // individually.
    let mut tail = Vec::new();
    let tail_index = if let Some(leaf) = end.leaf {
        let node = view.node(leaf).ok_or_else(invalid)?;
        let source = node.text.ok_or_else(invalid)?;
        bytes(builder.work(), source.len())?;
        let length = source.encode_utf16().count();
        if end.utf16.get() > 0 && end.utf16.get() < length {
            let operation = builder
                .push(Operation::SplitText {
                    leaf: LocalRef::Existing(leaf),
                    at: end.utf16,
                })
                .map_err(KwdjError::operational)?;
            bytes(builder.work(), std::mem::size_of::<usize>())?;
            push(
                &mut tail,
                LocalRef::Created {
                    operation,
                    path: vec![0],
                },
                builder.work(),
            )?;
            end.index + 1
        } else if end.utf16.get() == 0 {
            end.index
        } else {
            end.index + 1
        }
    } else {
        end.index
    };
    units(
        builder.work(),
        right.children.len().saturating_sub(tail_index),
    )?;
    for child in &right.children[tail_index..] {
        push(&mut tail, LocalRef::Existing(*child), builder.work())?;
    }
    let end_range = Selection {
        anchor: Position::Child {
            parent: LocalRef::Existing(end.block),
            index: 0,
            affinity: Affinity::After,
        },
        focus: map_position(range.end),
    };
    builder
        .push(Operation::ReplaceInlineRange {
            range: end_range,
            inserted: None,
        })
        .map_err(KwdjError::operational)?;
    let source_marks = caret_marks(view, state, range.start, builder.work())?;
    let inserted = if text.is_empty() {
        None
    } else {
        let marks = builder
            .charged_copy_marks(source_marks)
            .map_err(KwdjError::operational)?;
        let owned = builder
            .charged_copy_text(text)
            .map_err(KwdjError::operational)?;
        let type_id = builder
            .charged_copy_text("org.klenwriter.kwdj/text")
            .map_err(KwdjError::operational)?;
        bytes(builder.work(), std::mem::size_of::<Node>())?;
        Some(Node {
            type_id,
            primitive: Primitive::Text,
            attributes: Attributes::new(),
            marks,
            text: Some(owned),
            children: Vec::new(),
        })
    };
    let start_range = Selection {
        anchor: map_position(range.start),
        focus: Position::Child {
            parent: LocalRef::Existing(start.block),
            index: left.children.len(),
            affinity: Affinity::Before,
        },
    };
    let inserted_operation = builder
        .push(Operation::ReplaceInlineRange {
            range: start_range,
            inserted,
        })
        .map_err(KwdjError::operational)?;
    let prefix = start.index + usize::from(start.leaf.is_some() && start.utf16.get() > 0);
    if !tail.is_empty() {
        builder
            .push(Operation::MoveInlineGroup {
                nodes: tail,
                parent: LocalRef::Existing(start.block),
                before_index: prefix + usize::from(!text.is_empty()),
            })
            .map_err(KwdjError::operational)?;
    }
    units(builder.work(), right_index - left_index)?;
    for block in &siblings[left_index + 1..=right_index] {
        builder
            .push(Operation::Remove {
                node: LocalRef::Existing(*block),
            })
            .map_err(KwdjError::operational)?;
    }
    let (anchor, focus) = if !text.is_empty() {
        bytes(builder.work(), text.len())?;
        let utf16 = Utf16Offset::new(text.encode_utf16().count());
        bytes(builder.work(), std::mem::size_of::<usize>() * 2)?;
        (
            Position::Text {
                leaf: LocalRef::Created {
                    operation: inserted_operation,
                    path: vec![0],
                },
                utf16,
                affinity: Affinity::After,
            },
            Position::Text {
                leaf: LocalRef::Created {
                    operation: inserted_operation,
                    path: vec![0],
                },
                utf16,
                affinity: Affinity::After,
            },
        )
    } else {
        (
            Position::Child {
                parent: LocalRef::Existing(start.block),
                index: prefix,
                affinity: Affinity::After,
            },
            Position::Child {
                parent: LocalRef::Existing(start.block),
                index: prefix,
                affinity: Affinity::After,
            },
        )
    };
    builder
        .set_selection(SelectionIntent::MapFromUserResult(Some(Selection {
            anchor,
            focus,
        })))
        .map_err(KwdjError::operational)?;
    Ok(CommandPresentation::default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AdmissionBudget, IdentityResolver, IdentityResolverError, IdentityStatus, Limits};
    use editor_core::candidate::BorrowedNode;
    use editor_core::commands::CommandPlan;
    use editor_core::transaction::WorkLimits;
    use uuid::Uuid;

    struct Record {
        parent: usize,
        node: Node,
        children: Vec<usize>,
    }
    struct Fixture {
        roots: Vec<usize>,
        nodes: Vec<Record>,
    }
    impl CandidateRead for Fixture {
        type Id = usize;
        fn root(&self) -> usize {
            usize::MAX
        }
        fn roots(&self) -> &[usize] {
            &self.roots
        }
        fn node(&self, id: usize) -> Option<BorrowedNode<'_, usize>> {
            self.nodes.get(id).map(|r| BorrowedNode {
                type_id: &r.node.type_id,
                primitive: r.node.primitive,
                attributes: &r.node.attributes,
                marks: &r.node.marks,
                text: r.node.text.as_deref(),
                children: &r.children,
                parent: r.parent,
            })
        }
    }
    fn mark(kind: &str) -> Mark {
        Mark {
            type_id: format!("org.klenwriter.kwdj/{kind}"),
            attributes: Attributes::new(),
        }
    }
    type RunFixture<'a> = (&'a str, Vec<Mark>);
    type BlockFixture<'a> = (&'a str, Vec<RunFixture<'a>>);
    fn fixture(blocks: Vec<BlockFixture<'_>>) -> Fixture {
        let mut fixture = Fixture {
            roots: Vec::new(),
            nodes: Vec::new(),
        };
        for (kind, runs) in blocks {
            let block = fixture.nodes.len();
            fixture.roots.push(block);
            fixture.nodes.push(Record {
                parent: usize::MAX,
                node: Node {
                    type_id: format!("org.klenwriter.kwdj/{kind}"),
                    primitive: Primitive::TextBlock,
                    attributes: Attributes::new(),
                    marks: Vec::new(),
                    text: None,
                    children: Vec::new(),
                },
                children: Vec::new(),
            });
            for (text, marks) in runs {
                let id = fixture.nodes.len();
                fixture.nodes[block].children.push(id);
                fixture.nodes.push(Record {
                    parent: block,
                    node: Node {
                        type_id: "org.klenwriter.kwdj/text".into(),
                        primitive: Primitive::Text,
                        attributes: Attributes::new(),
                        marks,
                        text: Some(text.into()),
                        children: Vec::new(),
                    },
                    children: Vec::new(),
                });
            }
        }
        fixture
    }
    fn text(leaf: usize, at: usize) -> Position<usize> {
        Position::Text {
            leaf,
            utf16: Utf16Offset::new(at),
            affinity: Affinity::After,
        }
    }
    fn selection(anchor: Position<usize>, focus: Position<usize>) -> Selection<usize> {
        Selection { anchor, focus }
    }
    fn state(selection: &Selection<usize>) -> CommandState<'_, usize> {
        CommandState {
            selection: Some(selection),
            stored_marks: None,
        }
    }
    fn plan(
        f: impl FnOnce(&mut PlanBuilder<'_, usize>) -> Result<CommandPresentation, KwdjError>,
    ) -> (CommandPresentation, CommandPlan<usize>) {
        let mut work = WorkMeter::new(WorkLimits::default());
        let mut builder = PlanBuilder::new(&mut work, 256);
        let result = f(&mut builder).unwrap();
        (result, builder.finish())
    }
    struct Missing;
    impl IdentityResolver for Missing {
        fn resolve_media(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
            Ok(IdentityStatus::Missing)
        }
        fn resolve_reference(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
            Ok(IdentityStatus::Missing)
        }
    }
    fn profile() -> KwdjProfile<'static> {
        KwdjProfile::new(&Missing, Limits::default(), AdmissionBudget::default())
    }

    #[test]
    fn reverse_partial_cross_block_formatting_is_one_uniform_delta_with_mixed_state() {
        let view = fixture(vec![
            (
                "paragraph",
                vec![("ab", vec![]), ("cd", vec![mark("strong")])],
            ),
            ("paragraph", vec![("ef", vec![])]),
        ]);
        let selected = selection(text(4, 1), text(1, 1));
        let (presentation, plan) =
            plan(|b| toggle_mark(&view, state(&selected), &mark("strong"), b));
        assert_eq!(presentation.active, Some(ActiveState::Mixed));
        assert_eq!(plan.operations.len(), 1);
        assert_eq!(plan.selection, SelectionIntent::MapCurrent);
        assert_eq!(plan.stored_marks, StoredMarksUpdate::Keep);
        assert_eq!(
            plan.operations[0],
            Operation::PatchMarkRange {
                range: map_selection(selected),
                edits: vec![MarkEdit::Upsert(mark("strong"))]
            }
        );
        assert_eq!(view.nodes[1].node.text.as_deref(), Some("ab"));
        let mut work = WorkMeter::new(WorkLimits::default());
        let ordered = ordered_range(&view, selected, &mut work).unwrap();
        assert!(ordered.reversed);
        assert_eq!(
            ordered
                .spans
                .iter()
                .map(|s| (s.leaf, s.from.get(), s.to.get()))
                .collect::<Vec<_>>(),
            vec![(1, 1, 2), (2, 0, 2), (4, 0, 1)]
        );
    }

    #[test]
    fn whole_combining_cluster_across_existing_styles_plans_one_atomic_range() {
        let view = fixture(vec![(
            "paragraph",
            vec![
                ("e", vec![]),
                ("\u{301}", vec![mark("strong")]),
                ("!", vec![]),
            ],
        )]);
        let selected = selection(text(1, 0), text(2, 1));
        let (_, plan) = plan(|b| toggle_mark(&view, state(&selected), &mark("emphasis"), b));
        assert_eq!(
            plan.operations,
            vec![Operation::PatchMarkRange {
                range: map_selection(selected),
                edits: vec![MarkEdit::Upsert(mark("emphasis"))]
            }]
        );
        assert_eq!(view.nodes[2].node.marks, vec![mark("strong")]);
    }

    #[test]
    fn collapsed_toggle_uses_explicit_plain_typing_override_without_leaf_edits() {
        let view = fixture(vec![("paragraph", vec![("word", vec![mark("strong")])])]);
        let selected = selection(text(1, 2), text(1, 2));
        let (presentation, plan) =
            plan(|b| toggle_mark(&view, state(&selected), &mark("strong"), b));
        assert_eq!(presentation.active, Some(ActiveState::On));
        assert!(plan.operations.is_empty());
        assert_eq!(plan.stored_marks, StoredMarksUpdate::Set(vec![]));
        assert_eq!(view.nodes[1].node.marks, vec![mark("strong")]);
        let mut work = WorkMeter::new(WorkLimits::default());
        assert_eq!(
            finalize_typing_override(
                &profile(),
                Profile::Prose,
                &view,
                Some(selected),
                Some(&[]),
                &mut work
            )
            .unwrap(),
            Some(vec![])
        );
    }

    #[test]
    fn ordinary_link_commands_protect_intersecting_reference_marks_in_both_modes() {
        let reference = Mark {
            type_id: "org.klenwriter.kwdj/reference_link".into(),
            attributes: Attributes::from([(
                "reference_entity_id".into(),
                Attribute::String("b754cd80-67ef-487d-a07c-a3cf0640b0b5".into()),
            )]),
        };
        let view = fixture(vec![("paragraph", vec![("ref", vec![reference])])]);
        for selected in [
            selection(text(1, 0), text(1, 3)),
            selection(text(1, 1), text(1, 1)),
        ] {
            let mut work = WorkMeter::new(WorkLimits::default());
            let mut builder = PlanBuilder::new(&mut work, 256);
            assert_eq!(
                set_link(&view, state(&selected), "/safe", None, &mut builder)
                    .unwrap_err()
                    .code,
                KwdjErrorCode::CommandReferenceProtected
            );
            assert!(builder.is_empty());
            assert_eq!(
                unset_link(&view, state(&selected), &mut builder)
                    .unwrap_err()
                    .code,
                KwdjErrorCode::CommandReferenceProtected
            );
            assert!(builder.is_empty());
        }
    }

    #[test]
    fn final_typing_marks_share_url_identity_closed_shape_and_code_context_rules() {
        let view = fixture(vec![("paragraph", vec![("x", vec![])])]);
        let code = fixture(vec![("code_block", vec![("x", vec![])])]);
        let selected = selection(text(1, 0), text(1, 0));
        let cases = [
            (
                Mark {
                    type_id: "org.klenwriter.kwdj/link".into(),
                    attributes: Attributes::from([(
                        "href".into(),
                        Attribute::String("javascript:alert(1)".into()),
                    )]),
                },
                KwdjErrorCode::UnsafeUrl,
            ),
            (
                Mark {
                    type_id: "org.klenwriter.kwdj/reference_link".into(),
                    attributes: Attributes::from([(
                        "reference_entity_id".into(),
                        Attribute::String("b754cd80-67ef-487d-a07c-a3cf0640b0b5".into()),
                    )]),
                },
                KwdjErrorCode::MissingReferenceIdentity,
            ),
            (
                Mark {
                    type_id: "org.klenwriter.kwdj/strong".into(),
                    attributes: Attributes::from([("hidden".into(), Attribute::Boolean(true))]),
                },
                KwdjErrorCode::UnknownAttribute,
            ),
        ];
        for (mark, expected) in cases {
            let mut work = WorkMeter::new(WorkLimits::default());
            assert_eq!(
                finalize_typing_override(
                    &profile(),
                    Profile::Prose,
                    &view,
                    Some(selected),
                    Some(&[mark]),
                    &mut work
                )
                .unwrap_err()
                .code,
                expected
            );
        }
        let mut work = WorkMeter::new(WorkLimits::default());
        assert_eq!(
            finalize_typing_override(
                &profile(),
                Profile::Prose,
                &code,
                Some(selected),
                Some(&[mark("strong")]),
                &mut work
            )
            .unwrap_err()
            .code,
            KwdjErrorCode::CommandUnsupportedContext
        );
        let mut work = WorkMeter::new(WorkLimits::default());
        assert_eq!(
            finalize_typing_override(
                &profile(),
                Profile::Prose,
                &code,
                Some(selected),
                Some(&[]),
                &mut work
            )
            .unwrap(),
            Some(vec![])
        );
    }

    #[test]
    fn absent_token_cannot_erase_unknown_attributes_and_link_title_uses_shared_newlines() {
        let view = fixture(vec![("paragraph", vec![("x", vec![])])]);
        let selected = selection(text(1, 0), text(1, 0));
        let color = Mark {
            type_id: "org.klenwriter.kwdj/text_color".into(),
            attributes: Attributes::from([
                ("token".into(), Attribute::String("default".into())),
                ("hidden".into(), Attribute::Boolean(true)),
            ]),
        };
        let mut work = WorkMeter::new(WorkLimits::default());
        assert!(
            finalize_typing_override(
                &profile(),
                Profile::Prose,
                &view,
                Some(selected),
                Some(&[color]),
                &mut work
            )
            .is_err()
        );
        let link = Mark {
            type_id: "org.klenwriter.kwdj/link".into(),
            attributes: Attributes::from([
                ("href".into(), Attribute::String("/safe".into())),
                ("title".into(), Attribute::String("a\r\nb".into())),
            ]),
        };
        let mut work = WorkMeter::new(WorkLimits::default());
        let normalized = finalize_typing_override(
            &profile(),
            Profile::Prose,
            &view,
            Some(selected),
            Some(&[link]),
            &mut work,
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            normalized[0].attributes.get("title"),
            Some(&Attribute::String("a\nb".into()))
        );
    }

    #[test]
    fn typing_replaces_range_using_override_and_phase_aware_created_caret() {
        let view = fixture(vec![("paragraph", vec![("bold", vec![mark("strong")])])]);
        let selected = selection(text(1, 1), text(1, 3));
        let (_, plan) = plan(|b| {
            insert_text(
                &view,
                CommandState {
                    selection: Some(&selected),
                    stored_marks: Some(&[]),
                },
                "X",
                b,
            )
        });
        match &plan.operations[0] {
            Operation::ReplaceInlineRange {
                range,
                inserted: Some(node),
            } => {
                assert_eq!(*range, map_selection(selected));
                assert_eq!(node.text.as_deref(), Some("X"));
                assert!(node.marks.is_empty());
            }
            other => panic!("unexpected operation {other:?}"),
        }
        assert_eq!(
            plan.selection,
            SelectionIntent::MapFromUserResult(Some(Selection {
                anchor: Position::Text {
                    leaf: LocalRef::Created {
                        operation: 0,
                        path: vec![0]
                    },
                    utf16: Utf16Offset::new(1),
                    affinity: Affinity::After
                },
                focus: Position::Text {
                    leaf: LocalRef::Created {
                        operation: 0,
                        path: vec![0]
                    },
                    utf16: Utf16Offset::new(1),
                    affinity: Affinity::After
                },
            }))
        );
        assert_eq!(view.nodes[1].node.text.as_deref(), Some("bold"));
    }

    #[test]
    fn cross_block_typing_keeps_whole_styled_cluster_tail_in_one_identity_preserving_move() {
        let view = fixture(vec![
            ("paragraph", vec![("pre DEL", vec![])]),
            (
                "paragraph",
                vec![
                    ("DEL", vec![]),
                    ("e", vec![]),
                    ("\u{301}", vec![mark("strong")]),
                    (" tail", vec![]),
                ],
            ),
        ]);
        let selected = selection(text(1, 4), text(3, 3));
        let (_, planned) = plan(|b| insert_text(&view, state(&selected), "X", b));
        assert_eq!(planned.operations.len(), 4);
        assert_eq!(
            planned.operations[2],
            Operation::MoveInlineGroup {
                nodes: vec![
                    LocalRef::Existing(4),
                    LocalRef::Existing(5),
                    LocalRef::Existing(6)
                ],
                parent: LocalRef::Existing(0),
                before_index: 2,
            }
        );
        assert_eq!(
            planned.operations[3],
            Operation::Remove {
                node: LocalRef::Existing(2)
            }
        );
        assert_eq!(view.nodes[4].node.text.as_deref(), Some("e"));
        assert_eq!(view.nodes[5].node.text.as_deref(), Some("\u{301}"));
        assert_eq!(view.nodes[5].node.marks, vec![mark("strong")]);
        match planned.selection {
            SelectionIntent::MapFromUserResult(Some(Selection {
                focus:
                    Position::Text {
                        leaf: LocalRef::Created { operation, path },
                        utf16,
                        ..
                    },
                ..
            })) => {
                assert_eq!(operation, 1);
                assert_eq!(path, vec![0]);
                assert_eq!(utf16.get(), 1);
            }
            other => panic!("unexpected caret {other:?}"),
        }
    }

    #[test]
    fn hard_break_edge_is_an_addressable_typing_gap_and_resets_inherited_marks() {
        let mut view = fixture(vec![(
            "paragraph",
            vec![("placeholder", vec![]), ("bold", vec![mark("strong")])],
        )]);
        view.nodes[1].node.type_id = "org.klenwriter.kwdj/hard_break".into();
        view.nodes[1].node.primitive = Primitive::HardBreak;
        view.nodes[1].node.text = None;
        let caret = Position::Edge {
            node: 1,
            side: Edge::After,
        };
        let selected = selection(caret, caret);
        let mut work = WorkMeter::new(WorkLimits::default());
        let point = text_point(&view, caret, &mut work).unwrap();
        assert_eq!(point.block, 0);
        assert_eq!(point.index, 1);
        assert_eq!(point.leaf, None);
        let (_, planned) = plan(|builder| insert_text(&view, state(&selected), "X", builder));
        match &planned.operations[0] {
            Operation::ReplaceInlineRange {
                inserted: Some(node),
                ..
            } => assert!(node.marks.is_empty()),
            other => panic!("unexpected typing plan {other:?}"),
        }
    }

    #[test]
    fn range_all_removes_the_uniform_mark_and_plain_unlink_preserves_inheritance() {
        let view = fixture(vec![(
            "paragraph",
            vec![
                ("ab", vec![mark("strong")]),
                ("cd", vec![mark("strong"), mark("emphasis")]),
            ],
        )]);
        let selected = selection(text(1, 0), text(2, 2));
        let (presentation, planned) =
            plan(|b| toggle_mark(&view, state(&selected), &mark("strong"), b));
        assert_eq!(presentation.active, Some(ActiveState::On));
        assert_eq!(
            planned.operations,
            vec![Operation::PatchMarkRange {
                range: map_selection(selected),
                edits: vec![MarkEdit::Remove {
                    type_id: "org.klenwriter.kwdj/strong".into()
                }],
            }]
        );
        let plain = fixture(vec![("paragraph", vec![("plain", vec![])])]);
        let caret = selection(text(1, 1), text(1, 1));
        let (presentation, planned) = plan(|b| unset_link(&plain, state(&caret), b));
        assert_eq!(presentation.active, Some(ActiveState::Off));
        assert!(planned.operations.is_empty());
        assert_eq!(planned.stored_marks, StoredMarksUpdate::Keep);
    }

    #[test]
    fn final_keep_cannot_hide_a_code_block_behind_a_prose_focus() {
        let view = fixture(vec![
            ("code_block", vec![("literal", vec![])]),
            ("paragraph", vec![("prose", vec![])]),
        ]);
        let selected = selection(text(1, 0), text(3, 1));
        let mut work = WorkMeter::new(WorkLimits::default());
        let result = finalize_typing_override(
            &profile(),
            Profile::Prose,
            &view,
            Some(selected),
            Some(&[mark("strong")]),
            &mut work,
        );
        assert_eq!(
            result.unwrap_err().code,
            KwdjErrorCode::CommandUnsupportedContext
        );
    }

    #[test]
    fn incompatible_code_range_and_work_exhaustion_leave_plan_empty() {
        let view = fixture(vec![
            ("paragraph", vec![("a", vec![])]),
            ("code_block", vec![("b", vec![])]),
        ]);
        let selected = selection(text(1, 0), text(3, 1));
        let mut work = WorkMeter::new(WorkLimits::default());
        let mut builder = PlanBuilder::new(&mut work, 256);
        assert_eq!(
            toggle_mark(&view, state(&selected), &mark("strong"), &mut builder)
                .unwrap_err()
                .code,
            KwdjErrorCode::CommandUnsupportedContext
        );
        assert!(builder.is_empty());
        let mut work = WorkMeter::new(WorkLimits { units: 0, bytes: 0 });
        let mut builder = PlanBuilder::new(&mut work, 256);
        assert_eq!(
            toggle_mark(&view, state(&selected), &mark("strong"), &mut builder)
                .unwrap_err()
                .code,
            KwdjErrorCode::OperationalBudgetExceeded
        );
        assert!(builder.is_empty());
    }
}
