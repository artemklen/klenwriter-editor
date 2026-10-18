// SPDX-License-Identifier: MIT OR Apache-2.0
use std::collections::BTreeSet;

use editor_core::admission::{PreflightBudget, preflight_node_fields};
use editor_core::candidate::{BorrowedNode, CandidateRead};
use editor_core::document::{Document, Node, Primitive};
use editor_core::transaction::{Operation, WorkMeter, WorkPhase};

use crate::{NotesError, NotesErrorCode as E, NotesLimits};

struct Record<'a> {
    node: &'a Node,
    parent: usize,
    children: Vec<usize>,
}

pub(crate) struct DocumentView<'a> {
    records: Vec<Record<'a>>,
    roots: Vec<usize>,
}
impl<'a> DocumentView<'a> {
    pub fn new(document: &'a Document, work: &mut WorkMeter) -> Result<Self, NotesError> {
        let mut view = Self {
            records: vec![],
            roots: vec![],
        };
        work.charge_bytes(std::mem::size_of_val(document.children.as_slice()) as u64)?;
        for node in &document.children {
            let id = view.append(node, 0, work)?;
            view.roots.push(id);
        }
        Ok(view)
    }
    fn append(
        &mut self,
        node: &'a Node,
        parent: usize,
        work: &mut WorkMeter,
    ) -> Result<usize, NotesError> {
        work.charge_units(1)?;
        work.charge_bytes(
            (std::mem::size_of::<Record<'_>>() + node.children.len() * std::mem::size_of::<usize>())
                as u64,
        )?;
        let id = self.records.len() + 1;
        self.records.push(Record {
            node,
            parent,
            children: Vec::with_capacity(node.children.len()),
        });
        for child in &node.children {
            let child_id = self.append(child, id, work)?;
            self.records[id - 1].children.push(child_id);
        }
        Ok(id)
    }
}
impl CandidateRead for DocumentView<'_> {
    type Id = usize;
    fn root(&self) -> usize {
        0
    }
    fn roots(&self) -> &[usize] {
        &self.roots
    }
    fn node(&self, id: usize) -> Option<BorrowedNode<'_, usize>> {
        let record = self.records.get(id.checked_sub(1)?)?;
        Some(BorrowedNode {
            type_id: &record.node.type_id,
            primitive: record.node.primitive,
            attributes: &record.node.attributes,
            marks: &record.node.marks,
            text: record.node.text.as_deref(),
            children: &record.children,
            parent: record.parent,
        })
    }
}

pub(crate) fn metadata<I>(
    node: BorrowedNode<'_, I>,
    work: &mut WorkMeter,
) -> Result<(), NotesError> {
    let limits = work.limits();
    let spent = work.usage();
    let usage = preflight_node_fields(
        node.type_id,
        None,
        node.attributes,
        node.marks,
        0,
        PreflightBudget {
            payload_bytes: limits.bytes.saturating_sub(spent.bytes),
            values: limits.units.saturating_sub(spent.units),
            depth: 128,
        },
    )?;
    work.charge_units(usage.values.saturating_add(usage.payload_bytes))?;
    work.charge_bytes(usage.payload_bytes)?;
    Ok(())
}

pub(crate) fn same_text<I: Copy>(
    left: BorrowedNode<'_, I>,
    right: BorrowedNode<'_, I>,
    work: &mut WorkMeter,
) -> Result<bool, NotesError> {
    if left.primitive != Primitive::Text || right.primitive != Primitive::Text {
        return Ok(false);
    }
    metadata(left, work)?;
    metadata(right, work)?;
    Ok(left.type_id == right.type_id
        && left.attributes == right.attributes
        && left.marks == right.marks)
}

/// Borrowed full pass, honestly metered. Paths are bounded before copying and
/// cycles/shared children in a caller-created view never recurse indefinitely.
pub(crate) fn walk<V: CandidateRead>(
    view: &V,
    limits: NotesLimits,
    work: &mut WorkMeter,
    mut visit: impl FnMut(
        V::Id,
        BorrowedNode<'_, V::Id>,
        &str,
        &mut WorkMeter,
    ) -> Result<(), NotesError>,
) -> Result<u64, NotesError> {
    let mut pending = Vec::new();
    let mut seen = BTreeSet::new();
    let mut count = 0u64;
    for (index, id) in view.roots().iter().copied().enumerate().rev() {
        work.charge_units(1)?;
        work.charge_bytes(64)?;
        pending.push((
            id,
            if index == 0 {
                "/root".into()
            } else {
                format!("/roots/{index}")
            },
            1u64,
        ));
    }
    while let Some((id, path, depth)) = pending.pop() {
        work.charge_units(1)?;
        work.charge_bytes(std::mem::size_of::<V::Id>() as u64 * 4)?;
        count = count
            .checked_add(1)
            .ok_or_else(|| NotesError::new(E::ResourceLimitExceeded, &path))?;
        if count > limits.node_count
            || depth > limits.tree_depth
            || id == view.root()
            || !seen.insert(id)
        {
            return Err(NotesError::new(
                if count > limits.node_count || depth > limits.tree_depth {
                    E::ResourceLimitExceeded
                } else {
                    E::InvalidStructure
                },
                &path,
            ));
        }
        let node = view
            .node(id)
            .ok_or_else(|| NotesError::new(E::InvalidStructure, &path))?;
        if node
            .text
            .is_some_and(|text| text.len() as u64 > limits.text_leaf_bytes)
        {
            return Err(NotesError::new(
                E::ResourceLimitExceeded,
                &format!("{path}/text"),
            ));
        }
        visit(id, node, &path, work)?;
        work.charge_units(node.children.len() as u64)?;
        work.charge_bytes((node.children.len() as u64).saturating_mul(path.len() as u64 + 96))?;
        for (index, child) in node.children.iter().copied().enumerate().rev() {
            pending.push((child, format!("{path}/children/{index}"), depth + 1));
        }
    }
    Ok(count)
}

pub(crate) struct JoinProposal<I> {
    pub operation: Operation<I>,
    pub path: String,
}

pub(crate) fn first_join<V: CandidateRead>(
    view: &V,
    limits: NotesLimits,
    work: &mut WorkMeter,
) -> Result<Option<JoinProposal<V::Id>>, NotesError> {
    let mut found = None;
    walk(view, limits, work, |_, node, path, work| {
        work.note_phase(WorkPhase::Normalization, 1, 0);
        for (index, pair) in node.children.windows(2).enumerate() {
            work.charge_units(1)?;
            let left = view
                .node(pair[0])
                .ok_or_else(|| NotesError::new(E::InvalidStructure, path))?;
            let right = view
                .node(pair[1])
                .ok_or_else(|| NotesError::new(E::InvalidStructure, path))?;
            if found.is_none() && same_text(left, right, work)? {
                work.charge_bytes((path.len() + 96) as u64)?;
                found = Some(JoinProposal {
                    operation: Operation::JoinText {
                        left: pair[0],
                        right: pair[1],
                    },
                    path: format!("{path}/children/{}", index + 1),
                });
            }
        }
        Ok(())
    })?;
    Ok(found)
}
