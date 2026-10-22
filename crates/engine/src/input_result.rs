// SPDX-License-Identifier: MIT OR Apache-2.0
//! Bounded, publication-prepared input correspondence. No retained Session slot,
//! profile matching, SDK metadata, callback or authentication lives here.
use crate::events::SessionStamp;
use crate::identity::NodeId;
use crate::mapping::MapError;
use crate::transaction::NodeRef;
use crate::tree::{Allocation, TreeDraft, TreeError};
use editor_core::commands::{InputOriginal, InputSourceRegion, InputTextRun, TextReplacementPlan};
use editor_core::document::{Attribute, Attributes, Mark, Primitive};
use editor_core::input::{
    INPUT_RESTORE_BYTES, INPUT_RESULT_BYTES, INPUT_TEXT_BYTES, INPUT_TEXT_RUNS,
};
use editor_core::limits::LimitExceeded;
use editor_core::positions::{Edge, Position, Selection, Utf16Offset};
use editor_core::transaction::{Operation, WorkMeter};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InputResultError {
    Invalid,
    LocalLimit,
    Work(LimitExceeded),
    Tree(TreeError),
    Mapping(MapError),
}
impl InputResultError {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Invalid => "input.result_invalid",
            Self::LocalLimit => "input.result_limit",
            Self::Work(_) | Self::Tree(TreeError::ResourceLimit) => "resource_limit_exceeded",
            Self::Tree(_) => "position.invalid",
            Self::Mapping(_) => "mapping.invalid",
        }
    }
}
impl From<LimitExceeded> for InputResultError {
    fn from(e: LimitExceeded) -> Self {
        Self::Work(e)
    }
}
impl From<TreeError> for InputResultError {
    fn from(e: TreeError) -> Self {
        Self::Tree(e)
    }
}
impl From<MapError> for InputResultError {
    fn from(e: MapError) -> Self {
        Self::Mapping(e)
    }
}
type Result<T> = std::result::Result<T, InputResultError>;
fn need(v: bool) -> Result<()> {
    if v {
        Ok(())
    } else {
        Err(InputResultError::Invalid)
    }
}
fn bound(v: bool) -> Result<()> {
    if v {
        Ok(())
    } else {
        Err(InputResultError::LocalLimit)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InputTextSpan {
    pub node: NodeId,
    pub from_utf16: usize,
    pub to_utf16: usize,
    pub type_id: String,
    pub attributes: Attributes,
    pub marks: Vec<Mark>,
    pub text: String,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InputFinalRegion {
    pub block: NodeId,
    pub range: Selection<NodeId>,
    pub spans: Vec<InputTextSpan>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawInputRestore {
    pub stamp: SessionStamp,
    pub selection: Selection<NodeId>,
    pub stored_marks: Option<Vec<Mark>>,
    pub cooked: InputFinalRegion,
    pub raw: Vec<InputTextRun>,
    pub raw_caret_utf16: Utf16Offset,
    pub raw_stored_marks: Option<Vec<Mark>>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextReplacementResult {
    pub before_stamp: SessionStamp,
    pub after_stamp: SessionStamp,
    pub original: InputOriginal<NodeId>,
    pub before: InputSourceRegion<NodeId>,
    pub after: InputFinalRegion,
    pub after_selection: Selection<NodeId>,
    pub after_stored_marks: Option<Vec<Mark>>,
    pub raw_restore: Option<RawInputRestore>,
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct PointKey(usize, usize);
pub(crate) fn point<A: Allocation>(
    draft: &TreeDraft<'_, A>,
    p: Position<NodeId>,
    block: NodeId,
    work: &mut WorkMeter,
) -> Result<PointKey> {
    work.charge_units(1)?;
    match p {
        Position::Child { parent, index, .. } => {
            need(parent == block && index <= draft.node(block)?.children().len())?;
            Ok(PointKey(index, 0))
        }
        Position::Text { leaf, utf16, .. } => {
            let (parent, index) = draft.input_ordinal(leaf)?;
            need(parent == block && draft.node(leaf)?.text().is_some())?;
            let length = draft.input_text_utf16(leaf)?;
            need(utf16.get() <= length)?;
            Ok(if utf16.get() == length {
                PointKey(index + 1, 0)
            } else {
                PointKey(index, utf16.get())
            })
        }
        Position::Edge { node, side } if node == block => Ok(PointKey(
            if side == Edge::Before {
                0
            } else {
                draft.node(block)?.children().len()
            },
            0,
        )),
        Position::Edge { node, side } => {
            let (parent, index) = draft.input_ordinal(node)?;
            need(parent == block && draft.node(node)?.text().is_some())?;
            Ok(PointKey(index + usize::from(side == Edge::After), 0))
        }
    }
}
fn ordered<A: Allocation>(
    draft: &TreeDraft<'_, A>,
    range: Selection<NodeId>,
    block: NodeId,
    work: &mut WorkMeter,
) -> Result<(PointKey, PointKey)> {
    let a = point(draft, range.anchor, block, work)?;
    let b = point(draft, range.focus, block, work)?;
    Ok(if a <= b { (a, b) } else { (b, a) })
}
fn existing(p: &Position<NodeRef>) -> Result<Position<NodeId>> {
    let id = |r: &NodeRef| match r {
        NodeRef::Existing(id) => Ok(*id),
        _ => Err(InputResultError::Invalid),
    };
    Ok(match p {
        Position::Text {
            leaf,
            utf16,
            affinity,
        } => Position::Text {
            leaf: id(leaf)?,
            utf16: *utf16,
            affinity: *affinity,
        },
        Position::Child {
            parent,
            index,
            affinity,
        } => Position::Child {
            parent: id(parent)?,
            index: *index,
            affinity: *affinity,
        },
        Position::Edge { node, side } => Position::Edge {
            node: id(node)?,
            side: *side,
        },
    })
}

pub(crate) fn validate_plan<A: Allocation>(
    draft: &TreeDraft<'_, A>,
    plan: &TextReplacementPlan<NodeId>,
    selected: Option<Selection<NodeId>>,
    operations: &[Operation<NodeRef>],
    work: &mut WorkMeter,
) -> Result<()> {
    need(selected == Some(plan.original.selection))?;
    need(plan.original.text.chars().take(2).count() == 1)?;
    let block = plan.before.block;
    need(draft.node(block)?.primitive() == Some(Primitive::TextBlock))?;
    // This is the actual original user admission, not the widened endpoints.
    draft.validate_user_range(plan.original.selection, work)?;
    let source = ordered(draft, plan.before.range, block, work)?;
    need(
        point(draft, plan.before.range.anchor, block, work)?
            <= point(draft, plan.before.range.focus, block, work)?,
    )?;
    let original = ordered(draft, plan.original.selection, block, work)?;
    need(source.0 <= original.0 && source.1 >= original.1)?;
    need(operations.len() == 1)?;
    let (range, texts) = match &operations[0] {
        Operation::ReplaceInlineRange {
            range,
            inserted: Some(node),
        } => (range, std::slice::from_ref(node)),
        Operation::ReplaceInlineFragment { range, fragment } => {
            (range, fragment.children.as_slice())
        }
        _ => return Err(InputResultError::Invalid),
    };
    // Bound caller-owned collections before iteration or any scratch allocation.
    bound(texts.len() <= INPUT_TEXT_RUNS)?;
    let op = Selection {
        anchor: existing(&range.anchor)?,
        focus: existing(&range.focus)?,
    };
    need(ordered(draft, op, block, work)? == source)?;
    let mut bytes = 0usize;
    for node in texts {
        work.charge_units(1)?;
        need(node.primitive == Primitive::Text && node.children.is_empty())?;
        let text = node.text.as_deref().ok_or(InputResultError::Invalid)?;
        need(!text.is_empty())?;
        bytes = bytes.saturating_add(text.len());
    }
    bound(bytes <= INPUT_TEXT_BYTES)?;
    if let Some(raw) = &plan.raw_restore {
        bound(raw.raw.len() <= INPUT_TEXT_RUNS)?;
        let mut bytes = 0usize;
        let mut units = 0usize;
        for run in &raw.raw {
            work.charge_units(1)?;
            need(!run.text.is_empty() && !run.type_id.is_empty())?;
            bytes = bytes.saturating_add(run.text.len());
            bound(bytes <= INPUT_TEXT_BYTES)?;
            work.charge_bytes(run.text.len() as u64)?;
            units = units.saturating_add(run.text.encode_utf16().count());
        }
        bound(bytes <= INPUT_TEXT_BYTES)?;
        need(raw.raw_caret_utf16.get() <= units)?;
        // A relative caret must also be on a scalar boundary; final EGC/profile
        // admission is performed again by the restoration command.
        let mut at = 0;
        let mut scalar = false;
        for run in &raw.raw {
            for c in run.text.chars() {
                if at == raw.raw_caret_utf16.get() {
                    scalar = true;
                }
                at += c.len_utf16();
            }
        }
        need(scalar || at == raw.raw_caret_utf16.get())?;
    }
    Ok(())
}

pub(crate) fn validate_user_result<A: Allocation>(
    draft: &TreeDraft<'_, A>,
    range: Selection<NodeId>,
    created: &[Vec<NodeId>],
    work: &mut WorkMeter,
) -> Result<()> {
    let ids = created.first().ok_or(InputResultError::Invalid)?;
    need(!ids.is_empty() && ids.len() <= INPUT_TEXT_RUNS)?;
    let first = *ids.first().ok_or(InputResultError::Invalid)?;
    let last = *ids.last().ok_or(InputResultError::Invalid)?;
    let start = match range.anchor {
        Position::Text { leaf, utf16, .. } => leaf == first && utf16.get() == 0,
        _ => false,
    };
    work.charge_units(2)?;
    let end = match range.focus {
        Position::Text { leaf, utf16, .. } => {
            leaf == last
                && utf16.get()
                    == draft
                        .node(last)?
                        .text()
                        .ok_or(InputResultError::Invalid)?
                        .encode_utf16()
                        .count()
        }
        _ => false,
    };
    need(start && end)
}

pub(crate) fn validate_normalization<A: Allocation>(
    draft: &TreeDraft<'_, A>,
    operation: &Operation<NodeId>,
    block: NodeId,
    range: Selection<NodeId>,
    work: &mut WorkMeter,
) -> Result<()> {
    work.charge_units(1)?;
    match operation {
        Operation::JoinText { left, right } => {
            need(
                draft.node(*left)?.parent() == Some(block)
                    && draft.node(*right)?.parent() == Some(block),
            )?;
            need(
                [range.anchor.node(), range.focus.node()]
                    .iter()
                    .any(|id| id == left || id == right),
            )
        }
        Operation::Remove { node } => {
            need(
                draft.node(*node)?.parent() == Some(block) && draft.node(*node)?.text() == Some(""),
            )?;
            let (a, b) = ordered(draft, range, block, work)?;
            let (_, index) = draft.input_ordinal(*node)?;
            need(PointKey(index, 0) >= a && PointKey(index, 0) <= b)
        }
        _ => Err(InputResultError::Invalid),
    }
}

// Conservative wire/owned accounting. Attribute wire spellings use the closed
// AttributeDto grammar, not raw JSON. Every bound is checked before copying.
struct Cost<'a> {
    wire: usize,
    owned: usize,
    values: usize,
    depth: usize,
    failure: Option<InputResultError>,
    work: &'a mut WorkMeter,
}
impl<'a> Cost<'a> {
    fn new(base: usize, work: &'a mut WorkMeter) -> Result<Self> {
        bound(base <= INPUT_RESULT_BYTES)?;
        work.charge_bytes(base as u64)?;
        Ok(Self {
            wire: base,
            owned: base,
            values: 0,
            depth: 0,
            failure: None,
            work,
        })
    }
    fn finish(self) -> (usize, usize, usize, usize) {
        (self.wire, self.owned, self.values, self.depth)
    }
    fn add(&mut self, n: usize) -> Result<()> {
        self.wire = self.wire.saturating_add(n);
        bound(self.wire <= INPUT_RESULT_BYTES)
    }
    fn owned(&mut self, n: usize) -> Result<()> {
        let next = self.owned.saturating_add(n);
        bound(next <= INPUT_RESULT_BYTES)?;
        self.work.charge_bytes(n as u64)?;
        self.owned = next;
        Ok(())
    }
    fn string(&mut self, s: &str) -> Result<()> {
        self.owned(s.len())?;
        self.work.charge_bytes(s.len() as u64)?;
        self.add(2)?;
        for c in s.chars() {
            self.work.charge_units(1)?;
            self.add(match c {
                '"' | '\\' | '\n' | '\r' | '\t' | '\u{8}' | '\u{c}' => 2,
                c if c < ' ' => 6,
                c => c.len_utf8(),
            })?;
        }
        Ok(())
    }
    fn string_capacity(&mut self, s: &String) -> Result<()> {
        self.owned(s.capacity().saturating_sub(s.len()))?;
        self.string(s)
    }
    fn attrs(&mut self, attrs: &Attributes, depth: usize) -> Result<()> {
        bound(depth <= 16 && attrs.len() <= 2048 - self.values)?;
        self.depth = self.depth.max(depth);
        self.add(2)?;
        for (k, v) in attrs {
            self.work.charge_units(1)?;
            self.values += 1;
            self.owned(512)?;
            self.string_capacity(k)?;
            self.add(2)?;
            self.attr(v, depth + 1)?;
        }
        Ok(())
    }
    fn attr(&mut self, v: &Attribute, depth: usize) -> Result<()> {
        self.work.charge_units(1)?;
        self.values += 1;
        bound(self.values <= 2048 && depth <= 16)?;
        self.depth = self.depth.max(depth);
        self.add(32)?;
        match v {
            Attribute::Null | Attribute::Boolean(_) => Ok(()),
            Attribute::String(s) => self.string_capacity(s),
            Attribute::Number(n) => {
                use std::fmt::Write;
                write!(self, "{n}")
                    .map_err(|_| self.failure.take().unwrap_or(InputResultError::LocalLimit))
            }
            Attribute::List(v) => {
                bound(v.len() <= 2048 - self.values)?;
                self.owned(v.capacity() * std::mem::size_of::<Attribute>())?;
                for x in v {
                    self.attr(x, depth + 1)?;
                }
                Ok(())
            }
            Attribute::Object(v) => self.attrs(v, depth + 1),
        }
    }
    fn marks(&mut self, marks: Option<&[Mark]>) -> Result<()> {
        self.add(4)?;
        if let Some(marks) = marks {
            bound(marks.len() <= 2048 - self.values)?;
            self.owned(std::mem::size_of_val(marks))?;
            for m in marks {
                self.work.charge_units(1)?;
                self.values += 1;
                self.add(40)?;
                self.string_capacity(&m.type_id)?;
                self.attrs(&m.attributes, 1)?;
            }
        }
        Ok(())
    }
    fn run(&mut self, type_id: &str, attrs: &Attributes, marks: &[Mark], text: &str) -> Result<()> {
        self.work.charge_units(1)?;
        self.add(120)?;
        self.string(type_id)?;
        self.attrs(attrs, 1)?;
        self.marks(Some(marks))?;
        self.string(text)
    }
}
impl std::fmt::Write for Cost<'_> {
    fn write_str(&mut self, s: &str) -> std::fmt::Result {
        let result = self
            .work
            .charge_bytes(s.len() as u64)
            .map_err(InputResultError::from)
            .and_then(|_| self.owned(s.len()))
            .and_then(|_| self.add(s.len()));
        result.map_err(|e| {
            self.failure = Some(e);
            std::fmt::Error
        })
    }
}

#[derive(Clone, Copy)]
struct Span<'a> {
    node: NodeId,
    from: usize,
    to: usize,
    type_id: &'a str,
    attrs: &'a Attributes,
    marks: &'a [Mark],
    text: &'a str,
}
fn byte_at(text: &str, offset: usize, work: &mut WorkMeter) -> Result<usize> {
    let mut units = 0;
    for (byte, c) in text.char_indices() {
        work.charge_units(1)?;
        work.charge_bytes(c.len_utf8() as u64)?;
        if units == offset {
            return Ok(byte);
        }
        units += c.len_utf16();
        if units > offset {
            return Err(InputResultError::Invalid);
        }
    }
    need(units == offset)?;
    Ok(text.len())
}
fn span_copy(s: Span<'_>) -> InputTextSpan {
    InputTextSpan {
        node: s.node,
        from_utf16: s.from,
        to_utf16: s.to,
        type_id: s.type_id.into(),
        attributes: s.attrs.clone(),
        marks: s.marks.to_vec(),
        text: s.text.into(),
    }
}

#[expect(
    clippy::too_many_arguments,
    reason = "Borrowed source/final frames and the one shared meter stay explicit during prepublication preparation"
)]
pub(crate) fn prepare_result<A: Allocation>(
    draft: &TreeDraft<'_, A>,
    plan: TextReplacementPlan<NodeId>,
    range: Selection<NodeId>,
    selection: Option<Selection<NodeId>>,
    marks: Option<&[Mark]>,
    before_stamp: SessionStamp,
    after_stamp: SessionStamp,
    work: &mut WorkMeter,
) -> Result<TextReplacementResult> {
    let selected = selection.ok_or(InputResultError::Invalid)?;
    need(selected.anchor == selected.focus)?;
    let block = plan.before.block;
    need(draft.node(block)?.primitive() == Some(Primitive::TextBlock))?;
    let a = point(draft, range.anchor, block, work)?;
    let b = point(draft, range.focus, block, work)?;
    need(a <= b)?;
    if plan.raw_restore.is_some() {
        // A scalar correspondence region is not necessarily an admissible
        // future user splice: inserted text can join a following combining
        // scalar into a new EGC. Only this optional representation failure may
        // select LiteralOnly, and the work already spent remains charged.
        match draft.validate_user_range(range, work) {
            Err(TreeError::Position(
                editor_core::positions::PositionError::NotGraphemeBoundary,
            )) => {
                return Err(InputResultError::LocalLimit);
            }
            other => other?,
        }
    }
    let mut spans: [Option<Span<'_>>; INPUT_TEXT_RUNS] = [None; INPUT_TEXT_RUNS];
    let mut count = 0;
    let mut total = 0usize;
    let children = draft.node(block)?.children();
    bound(b.0.saturating_sub(a.0) <= 32)?;
    for index in a.0..=b.0.min(children.len().saturating_sub(1)) {
        if index == b.0 && b.1 == 0 {
            break;
        }
        work.charge_units(1)?;
        let id = *children.get(index).ok_or(InputResultError::Invalid)?;
        let node = draft.node(id)?;
        let text = node.text().ok_or(InputResultError::Invalid)?;
        let length = draft.input_text_utf16(id)?;
        let from = if index == a.0 { a.1 } else { 0 };
        let to = if index == b.0 { b.1 } else { length };
        need(from <= to && to <= length)?;
        if from == to {
            continue;
        }
        let lo = byte_at(text, from, work)?;
        let hi = byte_at(text, to, work)?;
        let part = &text[lo..hi];
        total = total.saturating_add(part.len());
        bound(total <= INPUT_TEXT_BYTES && count < INPUT_TEXT_RUNS)?;
        spans[count] = Some(Span {
            node: id,
            from,
            to,
            type_id: node.type_id().ok_or(InputResultError::Invalid)?,
            attrs: node.attributes().ok_or(InputResultError::Invalid)?,
            marks: node.marks(),
            text: part,
        });
        count += 1;
    }
    need(count > 0)?;
    let mut cost = Cost::new(std::mem::size_of::<TextReplacementResult>() + 2048, work)?;
    cost.string_capacity(&plan.original.text)?;
    cost.marks(marks)?;
    cost.owned(count * std::mem::size_of::<InputTextSpan>())?;
    for s in spans[..count].iter().flatten() {
        cost.add(256)?;
        cost.run(s.type_id, s.attrs, s.marks, s.text)?;
    }
    let (mut wire, mut owned, _, _) = cost.finish();
    if let Some(raw) = &plan.raw_restore {
        let mut r = Cost::new(std::mem::size_of::<RawInputRestore>() + 1024, work)?;
        r.marks(marks)?;
        r.marks(raw.raw_stored_marks.as_deref())?;
        r.owned(
            count * std::mem::size_of::<InputTextSpan>()
                + raw.raw.capacity() * std::mem::size_of::<InputTextRun>(),
        )?;
        for s in spans[..count].iter().flatten() {
            r.add(256)?;
            r.run(s.type_id, s.attrs, s.marks, s.text)?;
        }
        for run in &raw.raw {
            r.owned(
                run.type_id.capacity().saturating_sub(run.type_id.len())
                    + run.text.capacity().saturating_sub(run.text.len())
                    + (run.marks.capacity().saturating_sub(run.marks.len()))
                        * std::mem::size_of::<Mark>(),
            )?;
            r.run(&run.type_id, &run.attributes, &run.marks, &run.text)?;
        }
        if let Some(m) = &raw.raw_stored_marks {
            r.owned(m.capacity().saturating_sub(m.len()) * std::mem::size_of::<Mark>())?;
        }
        bound(r.wire <= INPUT_RESTORE_BYTES && r.values <= 512 && r.depth <= 8)?;
        let (rw, ro, _, _) = r.finish();
        wire = wire.saturating_add(rw);
        owned = owned.saturating_add(ro);
        bound(wire <= INPUT_RESULT_BYTES && owned <= INPUT_RESULT_BYTES)?;
    }
    // The original owned plan itself transfers into this result. Charge all
    // additional copies now; no copying/representation refusal after publish.
    work.charge_units(count as u64)?;
    let after = InputFinalRegion {
        block,
        range,
        spans: spans[..count]
            .iter()
            .flatten()
            .map(|s| span_copy(*s))
            .collect(),
    };
    let raw_restore = plan.raw_restore.map(|raw| RawInputRestore {
        stamp: after_stamp,
        selection: selected,
        stored_marks: marks.map(<[Mark]>::to_vec),
        cooked: after.clone(),
        raw: raw.raw,
        raw_caret_utf16: raw.raw_caret_utf16,
        raw_stored_marks: raw.raw_stored_marks,
    });
    Ok(TextReplacementResult {
        before_stamp,
        after_stamp,
        original: plan.original,
        before: plan.before,
        after,
        after_selection: selected,
        after_stored_marks: marks.map(<[Mark]>::to_vec),
        raw_restore,
    })
}
