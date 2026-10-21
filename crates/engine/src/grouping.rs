// SPDX-License-Identifier: MIT OR Apache-2.0
//! Conservative proof for explicit adjacent typing hints. A failed proof only
//! isolates the successful edit. It never grants mutation or profile authority.

use editor_core::admission::{PreflightBudget, preflight_node_fields};
use editor_core::candidate::{BorrowedNode, CandidateRead};
use editor_core::document::{Mark, Primitive};
use editor_core::positions::{Edge, Position, Selection, Utf16Offset, utf16_to_utf8};
use editor_core::transaction::{Operation, WorkMeter};

use crate::history::{GroupingFootprint, HistoryHint, TypingClass, TypingContext};
use crate::identity::NodeId;
use crate::transaction::TransactionError;
use crate::tree::TreeError;

pub(crate) struct TypingCandidate {
    block: NodeId,
    before_caret: usize,
    after_caret: usize,
    context: TypingContext,
    expected: String,
}

fn position<V: CandidateRead<Id = NodeId>, E>(
    view: &V,
    point: Position<NodeId>,
    work: &mut WorkMeter,
) -> Result<Option<(NodeId, usize)>, TransactionError<E>> {
    let Some(node) = view.node(point.node()) else {
        return Ok(None);
    };
    let (parent, target, local) = match point {
        Position::Child { parent, index, .. } => (parent, None, index),
        Position::Text { leaf, utf16, .. } => (node.parent, Some(leaf), utf16.get()),
        Position::Edge { node: id, side } => {
            let Some(text) = node.text else {
                return Ok(None);
            };
            work.charge_bytes(text.len() as u64)?;
            (
                node.parent,
                Some(id),
                if side == Edge::Before {
                    0
                } else {
                    text.encode_utf16().count()
                },
            )
        }
    };
    let Some(block) = view.node(parent) else {
        return Ok(None);
    };
    if block.primitive != Primitive::TextBlock {
        return Ok(None);
    }
    work.charge_units(block.children.len() as u64)?;
    let mut total = 0usize;
    for (index, id) in block.children.iter().enumerate() {
        if target.is_none() && index == local {
            return Ok(Some((parent, total)));
        }
        let Some(child) = view.node(*id) else {
            return Ok(None);
        };
        let Some(text) = child.text else {
            return Ok(None);
        };
        if child.primitive != Primitive::Text {
            return Ok(None);
        }
        work.charge_bytes(text.len() as u64)?;
        let length = text.encode_utf16().count();
        if Some(*id) == target {
            if local > length {
                return Ok(None);
            }
            return Ok(Some((
                parent,
                total.checked_add(local).ok_or(TreeError::ResourceLimit)?,
            )));
        }
        total = total.checked_add(length).ok_or(TreeError::ResourceLimit)?;
    }
    Ok((target.is_none() && local == block.children.len()).then_some((parent, total)))
}

fn collapsed<V: CandidateRead<Id = NodeId>, E>(
    view: &V,
    selection: Option<Selection<NodeId>>,
    work: &mut WorkMeter,
) -> Result<Option<(NodeId, usize)>, TransactionError<E>> {
    let Some(selection) = selection else {
        return Ok(None);
    };
    let a = position(view, selection.anchor, work)?;
    let b = position(view, selection.focus, work)?;
    Ok(if a == b { a } else { None })
}

fn same_leaf(a: &BorrowedNode<'_, NodeId>, b: &BorrowedNode<'_, NodeId>) -> bool {
    a.primitive == Primitive::Text
        && b.primitive == Primitive::Text
        && a.type_id == b.type_id
        && a.attributes == b.attributes
        && a.marks == b.marks
}

fn preflight<E>(
    node: &BorrowedNode<'_, NodeId>,
    work: &mut WorkMeter,
) -> Result<(), TransactionError<E>> {
    let used = work.usage();
    let limits = work.limits();
    let measured = preflight_node_fields(
        node.type_id,
        None,
        node.attributes,
        node.marks,
        0,
        PreflightBudget {
            payload_bytes: limits.bytes.saturating_sub(used.bytes),
            values: limits.units.saturating_sub(used.units),
            depth: 128,
        },
    )?;
    work.charge_units(measured.values)?;
    // Includes owned map/value containers, in addition to their string payload.
    work.charge_bytes(
        measured
            .payload_bytes
            .saturating_add(measured.values.saturating_mul(128)),
    )?;
    Ok(())
}

fn uniform_text<V: CandidateRead<Id = NodeId>, E>(
    view: &V,
    block: NodeId,
    work: &mut WorkMeter,
) -> Result<Option<String>, TransactionError<E>> {
    let Some(parent) = view.node(block) else {
        return Ok(None);
    };
    if parent.children.is_empty() {
        return Ok(Some(String::new()));
    }
    let Some(first) = parent.children.first().and_then(|id| view.node(*id)) else {
        return Ok(None);
    };
    preflight(&first, work)?;
    work.charge_units(parent.children.len() as u64)?;
    let mut size = 0usize;
    for id in parent.children {
        let Some(node) = view.node(*id) else {
            return Ok(None);
        };
        preflight(&node, work)?;
        if !same_leaf(&first, &node) {
            return Ok(None);
        }
        let Some(text) = node.text else {
            return Ok(None);
        };
        size = size
            .checked_add(text.len())
            .ok_or(TreeError::ResourceLimit)?;
    }
    work.charge_bytes(size as u64)?;
    let mut text = String::with_capacity(size);
    for id in parent.children {
        text.push_str(
            view.node(*id)
                .expect("verified stable candidate")
                .text
                .expect("text leaf"),
        );
    }
    Ok(Some(text))
}

pub(crate) fn prepare<V: CandidateRead<Id = NodeId>, E>(
    view: &V,
    operation: &Operation<NodeId>,
    hint: HistoryHint,
    selection: Option<Selection<NodeId>>,
    stored_marks: Option<&[Mark]>,
    work: &mut WorkMeter,
) -> Result<Option<TypingCandidate>, TransactionError<E>> {
    let HistoryHint::Typing { class, .. } = hint else {
        return Ok(None);
    };
    let Some((block, before_caret)) = collapsed(view, selection, work)? else {
        return Ok(None);
    };
    let (start, end, inserted, prototype) = match operation {
        Operation::ReplaceText {
            leaf,
            from,
            to,
            inserted,
        } => {
            let a = position(
                view,
                Position::Text {
                    leaf: *leaf,
                    utf16: *from,
                    affinity: editor_core::positions::Affinity::Before,
                },
                work,
            )?;
            let b = position(
                view,
                Position::Text {
                    leaf: *leaf,
                    utf16: *to,
                    affinity: editor_core::positions::Affinity::After,
                },
                work,
            )?;
            (a, b, inserted.as_str(), None)
        }
        Operation::ReplaceInlineRange { range, inserted } => {
            let a = position(view, range.anchor, work)?;
            let b = position(view, range.focus, work)?;
            if let Some(node) = inserted
                && (node.primitive != Primitive::Text || !node.children.is_empty())
            {
                return Ok(None);
            }
            (
                a,
                b,
                inserted
                    .as_ref()
                    .and_then(|n| n.text.as_deref())
                    .unwrap_or(""),
                inserted.as_ref(),
            )
        }
        _ => return Ok(None),
    };
    let (Some((a, x)), Some((b, y))) = (start, end) else {
        return Ok(None);
    };
    if a != block || b != block {
        return Ok(None);
    }
    let (from, to) = (x.min(y), x.max(y));
    let valid = match class {
        TypingClass::Insert => from == to && from == before_caret && !inserted.is_empty(),
        TypingClass::DeleteBackward => from < to && to == before_caret && inserted.is_empty(),
        TypingClass::DeleteForward => from < to && from == before_caret && inserted.is_empty(),
    };
    if !valid {
        return Ok(None);
    }
    let Some(text) = uniform_text(view, block, work)? else {
        return Ok(None);
    };
    let parent = view.node(block).expect("verified block");
    let leaf = if let Some(id) = parent.children.first() {
        view.node(*id).expect("verified uniform leaf")
    } else if let Some(node) = prototype {
        // First insertion supplies the actual profile-planned text context.
        // The final candidate must prove that this context stayed exact.
        BorrowedNode {
            type_id: &node.type_id,
            primitive: node.primitive,
            attributes: &node.attributes,
            marks: &node.marks,
            text: node.text.as_deref(),
            children: &[],
            parent: block,
        }
    } else {
        return Ok(None);
    };
    if prototype.is_some_and(|node| {
        node.type_id != leaf.type_id
            || &node.attributes != leaf.attributes
            || node.marks != leaf.marks
    }) {
        return Ok(None);
    }
    preflight(&parent, work)?;
    preflight(&leaf, work)?;
    let (marks, _) = super::session::dispatch::copy_marks(stored_marks, work)?;
    let context = TypingContext {
        block_type: parent.type_id.to_owned(),
        block_attributes: parent.attributes.clone(),
        leaf_type: leaf.type_id.to_owned(),
        leaf_attributes: leaf.attributes.clone(),
        marks: leaf.marks.to_vec(),
        stored_marks: marks,
    };
    work.charge_bytes(
        (text.len() as u64)
            .saturating_mul(2)
            .saturating_add(inserted.len() as u64),
    )?;
    let left = utf16_to_utf8(&text, Utf16Offset::new(from))
        .map_err(TreeError::Position)?
        .get();
    let right = utf16_to_utf8(&text, Utf16Offset::new(to))
        .map_err(TreeError::Position)?
        .get();
    let size = left
        .checked_add(inserted.len())
        .and_then(|n| n.checked_add(text.len() - right))
        .ok_or(TreeError::ResourceLimit)?;
    let mut expected = String::with_capacity(size);
    expected.push_str(&text[..left]);
    expected.push_str(inserted);
    expected.push_str(&text[right..]);
    let after_caret = from
        .checked_add(inserted.encode_utf16().count())
        .ok_or(TreeError::ResourceLimit)?;
    Ok(Some(TypingCandidate {
        block,
        before_caret,
        after_caret,
        context,
        expected,
    }))
}

impl TypingCandidate {
    /// Only local joins and empty-leaf normalization can preserve this proof.
    pub(crate) fn permits_normalization<V: CandidateRead<Id = NodeId>>(
        &self,
        view: &V,
        operation: &Operation<NodeId>,
    ) -> bool {
        let local = |id| {
            view.node(id)
                .is_some_and(|n| n.parent == self.block && n.primitive == Primitive::Text)
        };
        match operation {
            Operation::JoinText { left, right } => local(*left) && local(*right),
            Operation::Remove { node } => {
                local(*node) && view.node(*node).is_some_and(|n| n.text == Some(""))
            }
            _ => false,
        }
    }
    pub(crate) fn finish<V: CandidateRead<Id = NodeId>, E>(
        self,
        view: &V,
        selection: Option<Selection<NodeId>>,
        stored_marks: Option<&[Mark]>,
        work: &mut WorkMeter,
    ) -> Result<Option<GroupingFootprint>, TransactionError<E>> {
        if collapsed(view, selection, work)? != Some((self.block, self.after_caret))
            || stored_marks != self.context.stored_marks.as_deref()
        {
            return Ok(None);
        }
        let Some(text) = uniform_text(view, self.block, work)? else {
            return Ok(None);
        };
        if text != self.expected {
            return Ok(None);
        }
        let parent = view.node(self.block).expect("verified block");
        preflight(&parent, work)?;
        if parent.type_id != self.context.block_type
            || parent.attributes != &self.context.block_attributes
        {
            return Ok(None);
        }
        if let Some(id) = parent.children.first() {
            let leaf = view.node(*id).expect("verified leaf");
            preflight(&leaf, work)?;
            if leaf.type_id != self.context.leaf_type
                || leaf.attributes != &self.context.leaf_attributes
                || leaf.marks != self.context.marks
            {
                return Ok(None);
            }
        }
        Ok(Some(GroupingFootprint {
            block: self.block,
            before_caret: self.before_caret,
            after_caret: self.after_caret,
            context: self.context,
        }))
    }
}
