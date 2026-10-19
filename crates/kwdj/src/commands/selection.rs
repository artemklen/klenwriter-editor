// SPDX-License-Identifier: MIT OR Apache-2.0
//! Native selected-range order, bounded text projection and context-preserving erase.
use super::inline;
use crate::{KwdjError, KwdjErrorCode};
use editor_core::{
    candidate::CandidateRead,
    commands::{CommandPresentation, CommandState, LocalRef, PlanBuilder, SelectionIntent},
    document::{Attribute, Attributes, Document, Node, Primitive},
    positions::{Affinity, Edge, Position, Selection, Utf16Offset, utf16_to_utf8},
    transaction::{Operation, WorkMeter},
};
use std::collections::BTreeMap;

#[derive(Debug)]
pub enum SelectionTextError {
    Limit(&'static str),
    Work(editor_core::limits::LimitExceeded),
    Invalid,
}
pub struct SelectionText<I> {
    pub text: String,
    pub empty: bool,
    pub selected_atoms: Vec<I>,
}
#[derive(Clone, Copy)]
struct Row<I> {
    id: I,
    start: usize,
    end: usize,
    content_start: usize,
    content_end: usize,
}
struct Range<I> {
    rows: Vec<Row<I>>,
    index: BTreeMap<I, usize>,
    points: [Option<usize>; 2],
    cursor: usize,
    lo: usize,
    hi: usize,
    start: Position<I>,
    end: Position<I>,
}
fn unit(w: &mut WorkMeter, n: usize) -> Result<(), SelectionTextError> {
    w.charge_units(n as u64).map_err(SelectionTextError::Work)
}
fn bytes(w: &mut WorkMeter, n: usize) -> Result<(), SelectionTextError> {
    w.charge_bytes(n as u64).map_err(SelectionTextError::Work)
}
fn local(s: &str) -> &str {
    s.strip_prefix("org.klenwriter.kwdj/").unwrap_or(s)
}
fn basic(s: &str) -> bool {
    matches!(
        local(s),
        "text"
            | "hard_break"
            | "paragraph"
            | "heading"
            | "code_block"
            | "blockquote"
            | "bullet_list"
            | "ordered_list"
            | "list_item"
            | "task_list"
            | "task_item"
            | "scene_break"
    )
}
impl<I: Copy + Eq + Ord> Range<I> {
    fn point(
        &mut self,
        selection: Selection<I>,
        rank: usize,
        predicate: impl Fn(Position<I>) -> bool,
    ) {
        for (i, p) in [selection.anchor, selection.focus].into_iter().enumerate() {
            if predicate(p) {
                self.points[i] = Some(rank);
            }
        }
    }
    fn advance(&mut self, n: usize) -> Result<(), SelectionTextError> {
        self.cursor = self
            .cursor
            .checked_add(n)
            .ok_or(SelectionTextError::Invalid)?;
        Ok(())
    }
    fn children<V: CandidateRead<Id = I>>(
        &mut self,
        v: &V,
        parent: I,
        children: &[I],
        selection: Selection<I>,
        depth: usize,
        w: &mut WorkMeter,
    ) -> Result<(), SelectionTextError> {
        unit(w, children.len())?;
        for (index, id) in children.iter().enumerate() {
            self.point(
                selection,
                self.cursor,
                |p| matches!(p,Position::Child{parent:p,index:i,..} if p==parent&&i==index),
            );
            self.node(v, *id, parent, selection, depth, w)?;
        }
        self.point(
            selection,
            self.cursor,
            |p| matches!(p,Position::Child{parent:p,index:i,..} if p==parent&&i==children.len()),
        );
        Ok(())
    }
    fn node<V: CandidateRead<Id = I>>(
        &mut self,
        v: &V,
        id: I,
        parent: I,
        selection: Selection<I>,
        depth: usize,
        w: &mut WorkMeter,
    ) -> Result<(), SelectionTextError> {
        if depth > 128 {
            return Err(SelectionTextError::Limit("selection_text.depth_limit"));
        }
        if self.rows.len() >= 200_000 {
            return Err(SelectionTextError::Limit("selection_text.node_limit"));
        }
        unit(w, 1)?;
        let n = v.node(id).ok_or(SelectionTextError::Invalid)?;
        if n.parent != parent {
            return Err(SelectionTextError::Invalid);
        }
        bytes(w, n.type_id.len() + 4 * std::mem::size_of::<Row<I>>() + 128)?;
        let start = self.cursor;
        let at = self.rows.len();
        self.index.insert(id, at);
        self.rows.push(Row {
            id,
            start,
            end: 0,
            content_start: start,
            content_end: start,
        });
        let before = if n.primitive == Primitive::TextBlock {
            start.checked_add(1).ok_or(SelectionTextError::Invalid)?
        } else {
            start
        };
        self.point(
            selection,
            before,
            |p| matches!(p,Position::Edge{node,side:Edge::Before} if node==id),
        );
        let content_start;
        let content_end;
        if n.primitive == Primitive::Text {
            let text = n.text.ok_or(SelectionTextError::Invalid)?;
            bytes(w, text.len())?;
            let length = text.encode_utf16().count();
            for (i, p) in [selection.anchor, selection.focus].into_iter().enumerate() {
                if let Position::Text { leaf, utf16, .. } = p
                    && leaf == id
                {
                    utf16_to_utf8(text, utf16).map_err(|_| SelectionTextError::Invalid)?;
                    self.points[i] = Some(
                        start
                            .checked_add(utf16.get())
                            .ok_or(SelectionTextError::Invalid)?,
                    );
                }
            }
            content_start = start;
            self.advance(length)?;
            content_end = self.cursor;
        } else if n.children.is_empty()
            && !matches!(n.primitive, Primitive::TextBlock | Primitive::Container)
        {
            content_start = start;
            self.advance(1)?;
            content_end = self.cursor;
        } else {
            self.advance(1)?;
            content_start = self.cursor;
            self.children(v, id, n.children, selection, depth + 1, w)?;
            content_end = self.cursor;
            self.advance(1)?;
        }
        let after = if n.primitive == Primitive::TextBlock {
            self.cursor - 1
        } else {
            self.cursor
        };
        self.point(
            selection,
            after,
            |p| matches!(p,Position::Edge{node,side:Edge::After} if node==id),
        );
        self.rows[at] = Row {
            id,
            start,
            end: self.cursor,
            content_start,
            content_end,
        };
        Ok(())
    }
    fn build<V: CandidateRead<Id = I>>(
        v: &V,
        selection: Selection<I>,
        w: &mut WorkMeter,
    ) -> Result<Self, SelectionTextError> {
        let mut r = Self {
            rows: Vec::new(),
            index: BTreeMap::new(),
            points: [None, None],
            cursor: 0,
            lo: 0,
            hi: 0,
            start: selection.anchor,
            end: selection.focus,
        };
        r.children(v, v.root(), v.roots(), selection, 1, w)?;
        let a = r.points[0].ok_or(SelectionTextError::Invalid)?;
        let b = r.points[1].ok_or(SelectionTextError::Invalid)?;
        r.lo = a.min(b);
        r.hi = a.max(b);
        if a > b {
            r.start = selection.focus;
            r.end = selection.anchor;
        }
        Ok(r)
    }
    fn row(&self, id: I) -> Result<&Row<I>, SelectionTextError> {
        self.index
            .get(&id)
            .map(|i| &self.rows[*i])
            .ok_or(SelectionTextError::Invalid)
    }
    fn whole(&self, r: &Row<I>) -> bool {
        self.lo <= r.start && r.end <= self.hi
    }
    fn overlaps(&self, r: &Row<I>) -> bool {
        r.start < self.hi && r.end > self.lo
    }
    fn guard<V: CandidateRead<Id = I>>(
        &self,
        v: &V,
        w: &mut WorkMeter,
        editing: bool,
    ) -> Result<(), SelectionTextError> {
        let mut code = None;
        for r in &self.rows {
            unit(w, 1)?;
            if !self.overlaps(r) {
                continue;
            }
            let n = v.node(r.id).ok_or(SelectionTextError::Invalid)?;
            if !basic(n.type_id) {
                return Err(SelectionTextError::Limit(
                    "selection_text.unsupported_context",
                ));
            }
            unit(w, n.marks.len())?;
            bytes(w, n.marks.iter().map(|m| m.type_id.len()).sum())?;
            if n.marks.iter().any(|m| {
                !matches!(
                    m.type_id.as_str(),
                    "org.klenwriter.kwdj/strong"
                        | "org.klenwriter.kwdj/emphasis"
                        | "org.klenwriter.kwdj/strike"
                        | "org.klenwriter.kwdj/code"
                        | "org.klenwriter.kwdj/subscript"
                        | "org.klenwriter.kwdj/superscript"
                        | "org.klenwriter.kwdj/text_color"
                        | "org.klenwriter.kwdj/highlight"
                        | "org.klenwriter.kwdj/link"
                )
            }) {
                return Err(SelectionTextError::Limit(
                    "selection_text.unsupported_context",
                ));
            }
            if editing && local(n.type_id) == "code_block" {
                code = Some(r.id);
            }
        }
        if let Some(id) = code {
            let a =
                inline::text_point(v, self.start, w).map_err(|_| SelectionTextError::Invalid)?;
            let b = inline::text_point(v, self.end, w).map_err(|_| SelectionTextError::Invalid)?;
            if a.block != id || b.block != id {
                return Err(SelectionTextError::Limit(
                    "selection_text.unsupported_context",
                ));
            }
        }
        Ok(())
    }
}
fn append(
    out: &mut String,
    s: &str,
    max: usize,
    w: &mut WorkMeter,
) -> Result<(), SelectionTextError> {
    if out.len().checked_add(s.len()).is_none_or(|n| n > max) {
        return Err(SelectionTextError::Limit("selection_text.output_limit"));
    }
    bytes(w, s.len())?;
    out.try_reserve(s.len())
        .map_err(|_| SelectionTextError::Limit("selection_text.output_limit"))?;
    out.push_str(s);
    Ok(())
}
fn project_node<V: CandidateRead>(
    v: &V,
    r: &Range<V::Id>,
    id: V::Id,
    max: usize,
    atoms: &mut Vec<V::Id>,
    w: &mut WorkMeter,
) -> Result<Option<String>, SelectionTextError> {
    unit(w, 1)?;
    let row = r.row(id)?;
    let n = v.node(id).ok_or(SelectionTextError::Invalid)?;
    if !r.overlaps(row) {
        return Ok(None);
    }
    match n.primitive {
        Primitive::Text => {
            let from = r.lo.max(row.start).min(row.end) - row.start;
            let to = r.hi.min(row.end).max(row.start) - row.start;
            if from >= to {
                return Ok(None);
            }
            let s = n.text.ok_or(SelectionTextError::Invalid)?;
            let a = utf16_to_utf8(s, Utf16Offset::new(from))
                .map_err(|_| SelectionTextError::Invalid)?
                .get();
            let b = utf16_to_utf8(s, Utf16Offset::new(to))
                .map_err(|_| SelectionTextError::Invalid)?
                .get();
            let mut out = String::new();
            append(&mut out, &s[a..b], max, w)?;
            Ok(Some(out))
        }
        Primitive::HardBreak => {
            if r.whole(row) {
                bytes(w, 1)?;
                Ok(Some("\n".to_owned()))
            } else {
                Ok(None)
            }
        }
        Primitive::BlockAtom => {
            if r.whole(row) {
                if atoms.len() >= 4096 {
                    return Err(SelectionTextError::Limit("selection_text.atom_limit"));
                }
                bytes(w, 4 * std::mem::size_of::<V::Id>())?;
                atoms.push(id);
                Ok(Some(String::new()))
            } else {
                Ok(None)
            }
        }
        Primitive::TextBlock => {
            if row.content_end < r.lo || row.content_start > r.hi {
                return Ok(None);
            }
            let mut out = String::new();
            for child in n.children {
                if let Some(s) = project_node(v, r, *child, max, atoms, w)? {
                    append(&mut out, &s, max, w)?;
                }
            }
            Ok(Some(out))
        }
        Primitive::Container => project_children(v, r, n.children, max, atoms, w),
        _ => Err(SelectionTextError::Limit(
            "selection_text.unsupported_context",
        )),
    }
}
fn project_children<V: CandidateRead>(
    v: &V,
    r: &Range<V::Id>,
    children: &[V::Id],
    max: usize,
    atoms: &mut Vec<V::Id>,
    w: &mut WorkMeter,
) -> Result<Option<String>, SelectionTextError> {
    let mut out = None;
    for child in children {
        if let Some(s) = project_node(v, r, *child, max, atoms, w)? {
            if let Some(out) = &mut out {
                append(out, "\n", max, w)?;
            } else {
                out = Some(String::new());
            }
            append(out.as_mut().expect("initialized"), &s, max, w)?;
        }
    }
    Ok(out)
}
pub fn selected_text<V: CandidateRead>(
    v: &V,
    selection: Selection<V::Id>,
    max_bytes: u32,
    w: &mut WorkMeter,
) -> Result<SelectionText<V::Id>, SelectionTextError> {
    if max_bytes > 1_048_576 {
        return Err(SelectionTextError::Limit("selection_text.output_limit"));
    }
    let r = Range::build(v, selection, w)?;
    if r.lo == r.hi {
        return Ok(SelectionText {
            text: String::new(),
            empty: true,
            selected_atoms: Vec::new(),
        });
    }
    r.guard(v, w, false)?;
    let mut atoms = Vec::new();
    let text =
        project_children(v, &r, v.roots(), max_bytes as usize, &mut atoms, w)?.unwrap_or_default();
    Ok(SelectionText {
        text,
        empty: false,
        selected_atoms: atoms,
    })
}

fn command_error(e: SelectionTextError) -> KwdjError {
    match e {
        SelectionTextError::Work(e) => KwdjError::operational(e),
        _ => KwdjError::new(KwdjErrorCode::CommandUnsupportedContext, "/command"),
    }
}
fn map<I>(p: Position<I>) -> Position<LocalRef<I>> {
    match p {
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
fn gap<I>(parent: I, index: usize) -> Position<I> {
    Position::Child {
        parent,
        index,
        affinity: Affinity::After,
    }
}
fn empty<I>(
    name: &str,
    primitive: Primitive,
    children: Vec<Node>,
    attrs: Attributes,
    plan: &mut PlanBuilder<'_, I>,
) -> Result<Node, KwdjError> {
    bytes(plan.work(), 128).map_err(command_error)?;
    let type_id = plan
        .charged_copy_text(&format!("org.klenwriter.kwdj/{name}"))
        .map_err(KwdjError::operational)?;
    bytes(
        plan.work(),
        std::mem::size_of::<Node>() + std::mem::size_of_val(children.as_slice()),
    )
    .map_err(command_error)?;
    Ok(Node {
        type_id,
        primitive,
        attributes: attrs,
        marks: Vec::new(),
        text: None,
        children,
    })
}
pub(super) fn prepare<V: CandidateRead>(
    v: &V,
    state: CommandState<'_, V::Id>,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<CommandPresentation, KwdjError> {
    let selection = state
        .selection
        .copied()
        .ok_or_else(|| KwdjError::new(KwdjErrorCode::CommandSelectionRequired, "/command"))?;
    let r = Range::build(v, selection, plan.work()).map_err(command_error)?;
    if r.lo == r.hi {
        return Ok(CommandPresentation::default());
    }
    r.guard(v, plan.work(), true).map_err(command_error)?;
    let a = inline::text_point(v, r.start, plan.work()).ok();
    let b = inline::text_point(v, r.end, plan.work()).ok();
    if let (Some(a), Some(b)) = (&a, &b) {
        let l = v.node(a.block).expect("resolved");
        let rr = v.node(b.block).expect("resolved");
        let _ = plan
            .charged_copy_attrs(l.attributes)
            .map_err(KwdjError::operational)?;
        let _ = plan
            .charged_copy_attrs(rr.attributes)
            .map_err(KwdjError::operational)?;
        if a.block == b.block
            || (l.parent == rr.parent && l.type_id == rr.type_id && l.attributes == rr.attributes)
        {
            return inline::insert_text(v, state, "", plan);
        }
    }
    let mut forest = Vec::new();
    for row in &r.rows {
        unit(plan.work(), 1).map_err(command_error)?;
        unit(plan.work(), forest.len()).map_err(command_error)?;
        let n = v
            .node(row.id)
            .ok_or_else(|| command_error(SelectionTextError::Invalid))?;
        if !matches!(
            n.primitive,
            Primitive::Container | Primitive::TextBlock | Primitive::BlockAtom
        ) || !r.whole(row)
        {
            continue;
        }
        if forest.iter().any(|id| {
            r.row(*id)
                .is_ok_and(|p| p.start <= row.start && row.end <= p.end)
        }) {
            continue;
        }
        bytes(plan.work(), std::mem::size_of::<V::Id>()).map_err(command_error)?;
        forest.push(row.id);
    }
    let mut partial = Vec::new();
    for row in &r.rows {
        unit(plan.work(), 1 + forest.len()).map_err(command_error)?;
        let n = v
            .node(row.id)
            .ok_or_else(|| command_error(SelectionTextError::Invalid))?;
        if n.primitive != Primitive::TextBlock
            || forest.iter().any(|id| {
                r.row(*id)
                    .is_ok_and(|p| p.start <= row.start && row.end <= p.end)
            })
        {
            continue;
        }
        if r.lo.max(row.content_start) >= r.hi.min(row.content_end) {
            continue;
        }
        let start = if a.is_some_and(|p| p.block == row.id) {
            r.start
        } else {
            gap(row.id, 0)
        };
        let end = if b.is_some_and(|p| p.block == row.id) {
            r.end
        } else {
            gap(row.id, n.children.len())
        };
        bytes(plan.work(), std::mem::size_of::<Selection<V::Id>>()).map_err(command_error)?;
        partial.push(Selection {
            anchor: start,
            focus: end,
        });
    }
    if forest.is_empty() && partial.is_empty() {
        return Err(command_error(SelectionTextError::Invalid));
    }
    let mut caret = if let Some(a) = a {
        if let Some(leaf) = a.leaf
            && a.utf16.get() > 0
        {
            map(Position::Text {
                leaf,
                utf16: a.utf16,
                affinity: Affinity::After,
            })
        } else {
            map(gap(a.block, a.index))
        }
    } else {
        match r.start {
            Position::Child { parent, index, .. } => map(gap(parent, index)),
            Position::Edge { node, side } => {
                let n = v
                    .node(node)
                    .ok_or_else(|| command_error(SelectionTextError::Invalid))?;
                let index = v
                    .children(n.parent)
                    .and_then(|c| c.iter().position(|id| *id == node))
                    .ok_or_else(|| command_error(SelectionTextError::Invalid))?;
                map(gap(n.parent, index + usize::from(side == Edge::After)))
            }
            _ => return Err(command_error(SelectionTextError::Invalid)),
        }
    };
    for range in partial.into_iter().rev() {
        plan.push(Operation::ReplaceInlineRange {
            range: Selection {
                anchor: map(range.anchor),
                focus: map(range.focus),
            },
            inserted: None,
        })
        .map_err(KwdjError::operational)?;
    }
    for id in &forest {
        plan.push(Operation::Remove {
            node: LocalRef::Existing(*id),
        })
        .map_err(KwdjError::operational)?;
    }
    let owners = std::iter::once(v.root()).chain(r.rows.iter().map(|r| r.id));
    for owner in owners {
        unit(plan.work(), 1 + forest.len()).map_err(command_error)?;
        if forest.iter().any(|id| {
            r.row(*id).is_ok_and(|p| {
                owner == *id
                    || r.row(owner)
                        .is_ok_and(|r| p.start <= r.start && r.end <= p.end)
            })
        }) {
            continue;
        }
        let children = v
            .children(owner)
            .ok_or_else(|| command_error(SelectionTextError::Invalid))?;
        unit(plan.work(), children.len().saturating_mul(forest.len() + 1))
            .map_err(command_error)?;
        if children.is_empty() || !children.iter().all(|id| forest.contains(id)) {
            continue;
        }
        let name = if owner == v.root() {
            ""
        } else {
            local(v.node(owner).expect("row").type_id)
        };
        if !matches!(
            name,
            "" | "blockquote"
                | "list_item"
                | "task_item"
                | "bullet_list"
                | "ordered_list"
                | "task_list"
        ) {
            continue;
        }
        let paragraph = empty(
            "paragraph",
            Primitive::TextBlock,
            Vec::new(),
            Attributes::new(),
            plan,
        )?;
        let (node, path) = if matches!(name, "bullet_list" | "ordered_list" | "task_list") {
            let mut attrs = Attributes::new();
            if name == "task_list" {
                attrs.insert("checked".into(), Attribute::Boolean(false));
            }
            (
                empty(
                    if name == "task_list" {
                        "task_item"
                    } else {
                        "list_item"
                    },
                    Primitive::Container,
                    vec![paragraph],
                    attrs,
                    plan,
                )?,
                vec![0, 0],
            )
        } else {
            (paragraph, vec![0])
        };
        let operation = plan
            .push(Operation::InsertFragment {
                parent: LocalRef::Existing(owner),
                index: 0,
                fragment: Document {
                    children: vec![node],
                },
            })
            .map_err(KwdjError::operational)?;
        if matches!(caret,Position::Child{parent:LocalRef::Existing(p),..} if p==owner) {
            bytes(plan.work(), path.len() * std::mem::size_of::<usize>()).map_err(command_error)?;
            caret = Position::Child {
                parent: LocalRef::Created { operation, path },
                index: 0,
                affinity: Affinity::After,
            };
        }
    }
    plan.set_selection(SelectionIntent::MapFromUserResult(Some(Selection {
        anchor: caret.clone(),
        focus: caret,
    })))
    .map_err(KwdjError::operational)?;
    Ok(CommandPresentation::default())
}
