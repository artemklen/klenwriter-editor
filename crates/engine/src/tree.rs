// SPDX-License-Identifier: MIT OR Apache-2.0
//! Addressable admitted storage and sparse, explicitly unadmitted preparation.
//!
//! A TreeDraft cannot publish a Session. OSR-34 supplies the validation/commit
//! gate. Its primitives are also the identity substrate for history in OSR-36.

use std::cell::Cell;
use std::collections::{BTreeMap, BTreeSet};

use editor_core::admission::{PreflightBudget, preflight_node_metadata, preflight_snapshot};
use editor_core::document::{Attributes, Document, Mark, Node, Primitive};
use editor_core::positions::{
    BoundaryPolicy, InlineSpan, Position, PositionError, Utf16Offset, utf16_to_utf8,
    validate_inline_boundary,
};

use crate::identity::{NodeId, SessionKey};
use crate::mapping::StepMap;

const MAX_DEPTH: usize = 128;
const MAX_STEPS: usize = 4096;
const MAX_TEXT_BYTES: usize = 16 * 1024 * 1024;
const MAX_PREPARED_COPY_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TreeError {
    MissingNode,
    ForeignSession,
    InvalidStructure,
    InvalidIndex,
    InvalidRange,
    RootMutation,
    Cycle,
    IncompatibleText,
    ResourceLimit,
    CounterExhausted,
    Position(PositionError),
}

impl From<PositionError> for TreeError {
    fn from(value: PositionError) -> Self {
        Self::Position(value)
    }
}

/// Replaceable text storage; no public API exposes String mutation.
#[derive(Debug, Clone, PartialEq, Eq)]
struct TextStore(String);

#[derive(Debug, Clone, PartialEq, Eq)]
struct Data {
    type_id: String,
    primitive: Primitive,
    attributes: Attributes,
    marks: Vec<Mark>,
    text: Option<TextStore>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TreeNode {
    id: NodeId,
    parent: Option<NodeId>,
    data: Option<Data>, // None is the synthetic session root, never encoded.
    children: Vec<NodeId>,
    copy_cost: usize,
}

impl TreeNode {
    pub fn id(&self) -> NodeId {
        self.id
    }
    pub fn parent(&self) -> Option<NodeId> {
        self.parent
    }
    pub fn children(&self) -> &[NodeId] {
        &self.children
    }
    pub fn primitive(&self) -> Option<Primitive> {
        self.data.as_ref().map(|d| d.primitive)
    }
    pub fn type_id(&self) -> Option<&str> {
        self.data.as_ref().map(|d| d.type_id.as_str())
    }
    pub fn attributes(&self) -> Option<&Attributes> {
        self.data.as_ref().map(|d| &d.attributes)
    }
    pub fn marks(&self) -> &[Mark] {
        self.data.as_ref().map_or(&[], |d| d.marks.as_slice())
    }
    pub fn text(&self) -> Option<&str> {
        self.data.as_ref()?.text.as_ref().map(|t| t.0.as_str())
    }
}

pub(crate) struct AddressTree {
    key: SessionKey,
    root: NodeId,
    nodes: BTreeMap<NodeId, TreeNode>,
    next_id: Cell<u64>,
}

fn allowed_child(parent: Option<Primitive>, child: Primitive) -> bool {
    match parent {
        Some(Primitive::TextBlock) => matches!(
            child,
            Primitive::Text | Primitive::InlineAtom | Primitive::HardBreak
        ),
        None | Some(Primitive::Container) => matches!(
            child,
            Primitive::TextBlock | Primitive::Container | Primitive::BlockAtom
        ),
        _ => false,
    }
}

fn check_shape(node: &Node, parent: Option<Primitive>, depth: usize) -> Result<(), TreeError> {
    if depth > MAX_DEPTH || !allowed_child(parent, node.primitive) {
        return Err(TreeError::InvalidStructure);
    }
    if node.type_id.is_empty()
        || (node.primitive == Primitive::Text) != node.text.is_some()
        || (!matches!(node.primitive, Primitive::Container | Primitive::TextBlock)
            && !node.children.is_empty())
    {
        return Err(TreeError::InvalidStructure);
    }
    for child in &node.children {
        check_shape(child, Some(node.primitive), depth + 1)?;
    }
    Ok(())
}

impl AddressTree {
    pub(crate) fn from_document(key: SessionKey, document: Document) -> Result<Self, TreeError> {
        preflight_snapshot(&document, PreflightBudget::default())
            .map_err(|_| TreeError::ResourceLimit)?;
        for node in &document.children {
            check_shape(node, None, 1)?;
        }
        let root = NodeId::new(key, 1);
        let mut tree = Self {
            key,
            root,
            nodes: BTreeMap::new(),
            next_id: Cell::new(2),
        };
        let children = document
            .children
            .into_iter()
            .map(|node| tree.adopt(node, root))
            .collect::<Result<Vec<_>, _>>()?;
        let copy_cost =
            std::mem::size_of::<TreeNode>() + children.len() * std::mem::size_of::<NodeId>();
        tree.nodes.insert(
            root,
            TreeNode {
                id: root,
                parent: None,
                data: None,
                children,
                copy_cost,
            },
        );
        Ok(tree)
    }

    fn allocate(&self) -> Result<NodeId, TreeError> {
        let serial = self.next_id.get();
        self.next_id
            .set(serial.checked_add(1).ok_or(TreeError::CounterExhausted)?);
        Ok(NodeId::new(self.key, serial))
    }

    fn adopt(&mut self, node: Node, parent: NodeId) -> Result<NodeId, TreeError> {
        let usage = preflight_node_metadata(&node, PreflightBudget::default())
            .map_err(|_| TreeError::ResourceLimit)?;
        // Logical copy accounting, not an exact allocator/RSS measurement.
        // Includes scalar payload plus conservative closed-value/child overhead.
        let copy_cost = std::mem::size_of::<TreeNode>()
            + usage.payload_bytes as usize
            + usage.values as usize * std::mem::size_of::<editor_core::document::Attribute>()
            + node.children.len() * std::mem::size_of::<NodeId>();
        let id = self.allocate()?;
        let children = node
            .children
            .into_iter()
            .map(|node| self.adopt(node, id))
            .collect::<Result<Vec<_>, _>>()?;
        let data = Data {
            type_id: node.type_id,
            primitive: node.primitive,
            attributes: node.attributes,
            marks: node.marks,
            text: node.text.map(TextStore),
        };
        self.nodes.insert(
            id,
            TreeNode {
                id,
                parent: Some(parent),
                data: Some(data),
                children,
                copy_cost,
            },
        );
        Ok(id)
    }

    pub(crate) fn root(&self) -> NodeId {
        self.root
    }
    pub(crate) fn node(&self, id: NodeId) -> Result<&TreeNode, TreeError> {
        if id.session() != self.key {
            return Err(TreeError::ForeignSession);
        }
        self.nodes.get(&id).ok_or(TreeError::MissingNode)
    }

    pub(crate) fn prepare(&self) -> TreeDraft<'_> {
        TreeDraft {
            base: self,
            writes: BTreeMap::new(),
            removed: BTreeSet::new(),
            steps: Vec::new(),
            prepared_copy_bytes: 0,
            copy_budget: MAX_PREPARED_COPY_BYTES,
        }
    }

    pub(crate) fn document(&self) -> Document {
        Document {
            children: self.nodes[&self.root]
                .children
                .iter()
                .map(|id| self.encode(*id))
                .collect(),
        }
    }

    fn encode(&self, id: NodeId) -> Node {
        let node = &self.nodes[&id];
        let d = node.data.as_ref().expect("semantic node");
        Node {
            type_id: d.type_id.clone(),
            primitive: d.primitive,
            attributes: d.attributes.clone(),
            marks: d.marks.clone(),
            text: d.text.as_ref().map(|t| t.0.clone()),
            children: node.children.iter().map(|id| self.encode(*id)).collect(),
        }
    }
}

/// Owned historical material, neither Clone nor constructible from external IDs.
/// A successful revival consumes it. Failed revival returns ownership intact.
///
/// ```compile_fail
/// use klenwriter_editor_engine::tree::RetiredSubtree;
/// fn duplicate(retired: &RetiredSubtree) -> RetiredSubtree { retired.clone() }
/// ```
#[derive(Debug)]
pub struct RetiredSubtree {
    key: SessionKey,
    root: NodeId,
    nodes: Vec<TreeNode>,
}

#[derive(Debug)]
pub struct RevivalError {
    pub cause: TreeError,
    pub retired: RetiredSubtree,
}

/// Nonforgeable inverse material for a join. History may restore the original
/// right ID; calling split_text again would intentionally allocate a fresh ID.
#[derive(Debug)]
pub struct JoinedText {
    key: SessionKey,
    left_before: TreeNode,
    right: TreeNode,
}

#[derive(Debug)]
pub struct RestoreJoinError {
    pub cause: TreeError,
    pub joined: Box<JoinedText>,
}

/// A sparse candidate. Reads borrow untouched nodes; writes copy affected nodes.
/// Draft data has no admission proof and cannot replace a committed Session.
pub struct TreeDraft<'a> {
    base: &'a AddressTree,
    writes: BTreeMap<NodeId, TreeNode>,
    removed: BTreeSet<NodeId>,
    steps: Vec<StepMap<NodeId>>,
    prepared_copy_bytes: usize,
    copy_budget: usize,
}

impl TreeDraft<'_> {
    pub fn root(&self) -> NodeId {
        self.base.root
    }
    pub fn steps(&self) -> &[StepMap<NodeId>] {
        &self.steps
    }
    pub fn written_nodes(&self) -> usize {
        self.writes.len()
    }
    pub fn prepared_copy_bytes(&self) -> usize {
        self.prepared_copy_bytes
    }
    pub fn node(&self, id: NodeId) -> Result<&TreeNode, TreeError> {
        if id.session() != self.base.key {
            return Err(TreeError::ForeignSession);
        }
        if self.removed.contains(&id) {
            return Err(TreeError::MissingNode);
        }
        self.writes
            .get(&id)
            .or_else(|| self.base.nodes.get(&id))
            .ok_or(TreeError::MissingNode)
    }

    fn room(&self, steps: usize) -> Result<(), TreeError> {
        if self
            .steps
            .len()
            .checked_add(steps)
            .is_none_or(|n| n > MAX_STEPS)
        {
            Err(TreeError::ResourceLimit)
        } else {
            Ok(())
        }
    }

    fn copy_room(&self, cost: usize) -> Result<(), TreeError> {
        if self
            .prepared_copy_bytes
            .checked_add(cost)
            .is_none_or(|n| n > self.copy_budget)
        {
            Err(TreeError::ResourceLimit)
        } else {
            Ok(())
        }
    }

    fn parent_index(&self, id: NodeId) -> Result<(NodeId, usize), TreeError> {
        let parent = self.node(id)?.parent.ok_or(TreeError::RootMutation)?;
        let index = self
            .node(parent)?
            .children
            .iter()
            .position(|child| *child == id)
            .ok_or(TreeError::InvalidStructure)?;
        Ok((parent, index))
    }

    fn boundary(
        &self,
        leaf: NodeId,
        offset: Utf16Offset,
        policy: BoundaryPolicy,
    ) -> Result<usize, TreeError> {
        let text = self.node(leaf)?.text().ok_or(TreeError::InvalidStructure)?;
        if policy == BoundaryPolicy::Scalar {
            return Ok(utf16_to_utf8(text, offset)?.get());
        }
        let (parent, index) = self.parent_index(leaf)?;
        let siblings = &self.node(parent)?.children;
        let mut start = index;
        let mut end = index + 1;
        while start > 0 && self.node(siblings[start - 1])?.text().is_some() {
            start -= 1;
        }
        while end < siblings.len() && self.node(siblings[end])?.text().is_some() {
            end += 1;
        }
        // Bound temporary span/chunk metadata before allocation. Each grapheme
        // operation examines only this contiguous run; atoms/breaks are barriers.
        if end - start
            > MAX_PREPARED_COPY_BYTES / (std::mem::size_of::<InlineSpan<'_, NodeId>>() * 2)
        {
            return Err(TreeError::ResourceLimit);
        }
        let spans = siblings[start..end]
            .iter()
            .map(|id| {
                let node = self.node(*id)?;
                Ok(match node.text() {
                    Some(text) => InlineSpan::Text { leaf: *id, text },
                    None => InlineSpan::Barrier,
                })
            })
            .collect::<Result<Vec<_>, TreeError>>()?;
        Ok(validate_inline_boundary(&spans, leaf, offset, policy)?.get())
    }

    pub fn validate_position(&self, position: Position<NodeId>) -> Result<(), TreeError> {
        match position {
            Position::Text { leaf, utf16, .. } => {
                if self.node(leaf)?.primitive() != Some(Primitive::Text) {
                    return Err(TreeError::InvalidStructure);
                }
                self.boundary(leaf, utf16, BoundaryPolicy::Scalar)
                    .map(|_| ())
            }
            Position::Child { parent, index, .. } => {
                let node = self.node(parent)?;
                if !matches!(
                    node.primitive(),
                    None | Some(Primitive::Container | Primitive::TextBlock)
                ) {
                    return Err(TreeError::InvalidStructure);
                }
                if index > node.children.len() {
                    Err(TreeError::InvalidIndex)
                } else {
                    Ok(())
                }
            }
            Position::Edge { node, .. } => self.node(node).map(|_| ()),
        }
    }

    pub fn replace_text(
        &mut self,
        leaf: NodeId,
        from: Utf16Offset,
        to: Utf16Offset,
        inserted: &str,
    ) -> Result<(), TreeError> {
        self.room(1)?;
        if from.get() > to.get() {
            return Err(TreeError::InvalidRange);
        }
        let a = self.boundary(leaf, from, BoundaryPolicy::Grapheme)?;
        let b = self.boundary(leaf, to, BoundaryPolicy::Grapheme)?;
        let text = self.node(leaf)?.text().ok_or(TreeError::InvalidStructure)?;
        let len = text
            .len()
            .checked_sub(b - a)
            .and_then(|n| n.checked_add(inserted.len()))
            .ok_or(TreeError::ResourceLimit)?;
        if len > MAX_TEXT_BYTES {
            return Err(TreeError::ResourceLimit);
        }
        if &text[a..b] == inserted {
            return Ok(());
        }
        let old_len = text.encode_utf16().count();
        let old_cost = self.node(leaf)?.copy_cost;
        let new_cost = old_cost - text.len() + len;
        let cost = old_cost
            .checked_add(new_cost)
            .ok_or(TreeError::ResourceLimit)?;
        self.copy_room(cost)?;
        let mut changed = self.node(leaf)?.clone();
        changed
            .data
            .as_mut()
            .expect("text data")
            .text
            .as_mut()
            .expect("text storage")
            .0
            .replace_range(a..b, inserted);
        changed.copy_cost = new_cost;
        self.writes.insert(leaf, changed);
        self.steps.push(StepMap::ReplaceText {
            leaf,
            from,
            to,
            inserted: inserted.encode_utf16().count(),
            old_len,
        });
        self.prepared_copy_bytes += cost;
        Ok(())
    }

    pub fn split_text(&mut self, left: NodeId, at: Utf16Offset) -> Result<NodeId, TreeError> {
        self.room(2)?;
        let byte = self.boundary(left, at, BoundaryPolicy::Grapheme)?;
        let (parent, index) = self.parent_index(left)?;
        let node = self.node(left)?;
        let cost =
            node.copy_cost * 3 + self.node(parent)?.copy_cost + std::mem::size_of::<NodeId>() * 2;
        self.copy_room(cost)?;
        let mut l = node.clone();
        let old_len = l
            .text()
            .ok_or(TreeError::InvalidStructure)?
            .encode_utf16()
            .count();
        let old_bytes = l.text().expect("checked text").len();
        let mut r = l.clone();
        let right_text = l
            .data
            .as_mut()
            .expect("text data")
            .text
            .as_mut()
            .ok_or(TreeError::InvalidStructure)?
            .0
            .split_off(byte);
        r.data.as_mut().expect("text data").text = Some(TextStore(right_text));
        l.copy_cost -= old_bytes - byte;
        r.copy_cost -= byte;
        let mut p = self.node(parent)?.clone();
        let right = self.base.allocate()?; // Last fallible step; abandoned IDs are never recycled.
        r.id = right;
        p.children.insert(index + 1, right);
        p.copy_cost += std::mem::size_of::<NodeId>();
        let parent_old_len = p.children.len() - 1;
        self.writes.insert(left, l);
        self.writes.insert(right, r);
        self.writes.insert(parent, p);
        self.steps.push(StepMap::SplitText {
            left,
            right,
            at,
            old_len,
        });
        self.steps.push(StepMap::ChildInsert {
            parent,
            index: index + 1,
            count: 1,
            old_len: parent_old_len,
        });
        self.prepared_copy_bytes += cost;
        Ok(right)
    }

    pub fn join_text(&mut self, left: NodeId, right: NodeId) -> Result<JoinedText, TreeError> {
        self.room(3)?;
        let (parent, index) = self.parent_index(left)?;
        if self.parent_index(right)? != (parent, index + 1) {
            return Err(TreeError::IncompatibleText);
        }
        let ln = self.node(left)?;
        let r = self.node(right)?;
        let ld = ln.data.as_ref().ok_or(TreeError::IncompatibleText)?;
        let rd = r.data.as_ref().ok_or(TreeError::IncompatibleText)?;
        if ld.primitive != Primitive::Text
            || rd.primitive != Primitive::Text
            || ld.type_id != rd.type_id
            || ld.attributes != rd.attributes
            || ld.marks != rd.marks
        {
            return Err(TreeError::IncompatibleText);
        }
        let a = ln.text().ok_or(TreeError::IncompatibleText)?;
        let b = r.text().ok_or(TreeError::IncompatibleText)?;
        if a.len()
            .checked_add(b.len())
            .is_none_or(|n| n > MAX_TEXT_BYTES)
        {
            return Err(TreeError::ResourceLimit);
        }
        let cost = (ln.copy_cost + r.copy_cost) * 3 + self.node(parent)?.copy_cost;
        self.copy_room(cost)?;
        let receipt = JoinedText {
            key: self.base.key,
            left_before: ln.clone(),
            right: r.clone(),
        };
        let (left_len, right_len) = (a.encode_utf16().count(), b.encode_utf16().count());
        let mut l = ln.clone();
        let mut p = self.node(parent)?.clone();
        let old_len = p.children.len();
        l.data
            .as_mut()
            .expect("text data")
            .text
            .as_mut()
            .expect("text storage")
            .0
            .push_str(b);
        l.copy_cost += b.len();
        p.children.remove(index + 1);
        p.copy_cost -= std::mem::size_of::<NodeId>();
        self.writes.insert(left, l);
        self.writes.insert(parent, p);
        self.writes.remove(&right);
        self.removed.insert(right);
        self.steps.push(StepMap::JoinText {
            left,
            right,
            left_len,
            right_len,
        });
        self.steps.push(StepMap::ChildDelete {
            parent,
            index: index + 1,
            count: 1,
            old_len,
        });
        self.steps.push(StepMap::Retire {
            nodes: vec![right],
            parent,
            index: index + 1,
        });
        self.prepared_copy_bytes += cost;
        Ok(receipt)
    }

    /// Checked primitive replay, not a public undo journal. Restoring a join
    /// requires its owned receipt and the exact joined content, in this session.
    pub fn restore_join(&mut self, joined: JoinedText) -> Result<NodeId, RestoreJoinError> {
        let check = (|| {
            self.room(3)?;
            if joined.key != self.base.key {
                return Err(TreeError::ForeignSession);
            }
            let left = self.node(joined.left_before.id)?;
            let (parent, index) = self.parent_index(left.id)?;
            if left.parent != joined.left_before.parent
                || joined.right.parent != Some(parent)
                || self.node(joined.right.id).is_ok()
            {
                return Err(TreeError::IncompatibleText);
            }
            let now = left.data.as_ref().ok_or(TreeError::IncompatibleText)?;
            let before = joined
                .left_before
                .data
                .as_ref()
                .ok_or(TreeError::IncompatibleText)?;
            if now.type_id != before.type_id
                || now.primitive != before.primitive
                || now.attributes != before.attributes
                || now.marks != before.marks
            {
                return Err(TreeError::IncompatibleText);
            }
            let a = joined
                .left_before
                .text()
                .ok_or(TreeError::IncompatibleText)?;
            let b = joined.right.text().ok_or(TreeError::IncompatibleText)?;
            if left.text().and_then(|text| text.strip_prefix(a)) != Some(b) {
                return Err(TreeError::IncompatibleText);
            }
            let cost = joined.left_before.copy_cost
                + joined.right.copy_cost
                + self.node(parent)?.copy_cost
                + std::mem::size_of::<NodeId>();
            self.copy_room(cost)?;
            Ok((
                parent,
                index,
                a.encode_utf16().count(),
                a.encode_utf16().count() + b.encode_utf16().count(),
                cost,
            ))
        })();
        let (parent, index, at, old_len, cost) = match check {
            Ok(values) => values,
            Err(cause) => {
                return Err(RestoreJoinError {
                    cause,
                    joined: Box::new(joined),
                });
            }
        };
        let (left, right) = (joined.left_before.id, joined.right.id);
        let mut p = self.node(parent).expect("checked parent").clone();
        let parent_old_len = p.children.len();
        p.children.insert(index + 1, right);
        p.copy_cost += std::mem::size_of::<NodeId>();
        self.writes.insert(left, joined.left_before);
        self.writes.insert(right, joined.right);
        self.removed.remove(&right);
        self.writes.insert(parent, p);
        self.steps.push(StepMap::Revive { nodes: vec![right] });
        self.steps.push(StepMap::SplitText {
            left,
            right,
            at: Utf16Offset::new(at),
            old_len,
        });
        self.steps.push(StepMap::ChildInsert {
            parent,
            index: index + 1,
            count: 1,
            old_len: parent_old_len,
        });
        self.prepared_copy_bytes += cost;
        Ok(right)
    }

    fn walk_subtree(
        &self,
        root: NodeId,
        depth: usize,
        visit: &mut impl FnMut(&TreeNode, usize) -> Result<(), TreeError>,
    ) -> Result<(), TreeError> {
        if depth > MAX_DEPTH {
            return Err(TreeError::ResourceLimit);
        }
        let node = self.node(root)?;
        visit(node, depth)?;
        for child in &node.children {
            self.walk_subtree(*child, depth + 1, visit)?;
        }
        Ok(())
    }

    pub fn detach(&mut self, root: NodeId) -> Result<RetiredSubtree, TreeError> {
        self.room(2)?;
        let (parent, index) = self.parent_index(root)?;
        let mut cost = self.node(parent)?.copy_cost;
        self.walk_subtree(root, 1, &mut |node, _| {
            cost = cost
                .checked_add(node.copy_cost + std::mem::size_of::<NodeId>() * 2)
                .ok_or(TreeError::ResourceLimit)?;
            self.copy_room(cost)
        })?;
        self.copy_room(cost)?;
        let mut nodes = Vec::new();
        self.walk_subtree(root, 1, &mut |node, _| {
            nodes.push(node.clone());
            Ok(())
        })?;
        let mut p = self.node(parent)?.clone();
        let old_len = p.children.len();
        p.children.remove(index);
        p.copy_cost -= std::mem::size_of::<NodeId>();
        let ids = nodes.iter().map(|n| n.id).collect::<Vec<_>>();
        self.writes.insert(parent, p);
        for id in &ids {
            self.writes.remove(id);
            self.removed.insert(*id);
        }
        self.steps.push(StepMap::ChildDelete {
            parent,
            index,
            count: 1,
            old_len,
        });
        self.steps.push(StepMap::Retire {
            nodes: ids,
            parent,
            index,
        });
        self.prepared_copy_bytes += cost;
        Ok(RetiredSubtree {
            key: self.base.key,
            root,
            nodes,
        })
    }

    pub fn revive(
        &mut self,
        parent: NodeId,
        index: usize,
        mut retired: RetiredSubtree,
    ) -> Result<NodeId, RevivalError> {
        let mut cost = 0;
        let check = (|| {
            self.room(2)?;
            if retired.key != self.base.key {
                return Err(TreeError::ForeignSession);
            }
            let p = self.node(parent)?;
            if index > p.children.len() {
                return Err(TreeError::InvalidIndex);
            }
            let root = retired
                .nodes
                .iter()
                .find(|n| n.id == retired.root)
                .ok_or(TreeError::InvalidStructure)?;
            if !allowed_child(
                p.primitive(),
                root.primitive().ok_or(TreeError::RootMutation)?,
            ) {
                return Err(TreeError::InvalidStructure);
            }
            if retired.nodes.iter().any(|n| self.node(n.id).is_ok()) {
                return Err(TreeError::InvalidStructure);
            }
            cost = retired.nodes.iter().try_fold(
                p.copy_cost + std::mem::size_of::<NodeId>(),
                |n, node| {
                    n.checked_add(node.copy_cost)
                        .ok_or(TreeError::ResourceLimit)
                },
            )?;
            self.copy_room(cost)?;
            self.check_depth(parent, &retired.nodes, retired.root)?;
            Ok(())
        })();
        if let Err(cause) = check {
            return Err(RevivalError { cause, retired });
        }
        let mut p = self.node(parent).expect("checked parent").clone();
        let old_len = p.children.len();
        let root = retired.root;
        p.children.insert(index, root);
        p.copy_cost += std::mem::size_of::<NodeId>();
        let revived = retired.nodes.iter().map(|node| node.id).collect();
        for mut node in retired.nodes.drain(..) {
            if node.id == root {
                node.parent = Some(parent);
            }
            self.removed.remove(&node.id);
            self.writes.insert(node.id, node);
        }
        self.writes.insert(parent, p);
        self.steps.push(StepMap::Revive { nodes: revived });
        self.steps.push(StepMap::ChildInsert {
            parent,
            index,
            count: 1,
            old_len,
        });
        self.prepared_copy_bytes += cost;
        Ok(root)
    }

    fn check_depth(
        &self,
        destination: NodeId,
        nodes: &[TreeNode],
        root: NodeId,
    ) -> Result<(), TreeError> {
        let mut ancestor = Some(destination);
        let mut depth = 0;
        while let Some(id) = ancestor {
            if id == root {
                return Err(TreeError::Cycle);
            }
            ancestor = self.node(id)?.parent;
            depth += 1;
            if depth > MAX_DEPTH {
                return Err(TreeError::ResourceLimit);
            }
        }
        let by_id: BTreeMap<_, _> = nodes.iter().map(|n| (n.id, n)).collect();
        let mut pending = vec![(root, depth)];
        while let Some((id, depth)) = pending.pop() {
            if depth > MAX_DEPTH {
                return Err(TreeError::ResourceLimit);
            }
            pending.extend(by_id[&id].children.iter().map(|id| (*id, depth + 1)));
        }
        Ok(())
    }

    /// Destination index is measured before removing the source (ADR-003).
    pub fn move_node(
        &mut self,
        root: NodeId,
        destination: NodeId,
        before_index: usize,
    ) -> Result<(), TreeError> {
        self.room(1)?;
        let (source, index) = self.parent_index(root)?;
        let d = self.node(destination)?;
        if before_index > d.children.len() {
            return Err(TreeError::InvalidIndex);
        }
        if !allowed_child(
            d.primitive(),
            self.node(root)?
                .primitive()
                .ok_or(TreeError::RootMutation)?,
        ) {
            return Err(TreeError::InvalidStructure);
        }
        // A semantic no-op does not create an operation or a new revision.
        if source == destination && (before_index == index || before_index == index + 1) {
            return Ok(());
        }
        let mut ancestor = Some(destination);
        let mut depth = 0;
        while let Some(id) = ancestor {
            if id == root {
                return Err(TreeError::Cycle);
            }
            ancestor = self.node(id)?.parent;
            depth += 1;
            if depth > MAX_DEPTH {
                return Err(TreeError::ResourceLimit);
            }
        }
        self.walk_subtree(root, depth, &mut |_, _| Ok(()))?;
        let cost = self.node(source)?.copy_cost
            + if source == destination {
                0
            } else {
                d.copy_cost + self.node(root)?.copy_cost + std::mem::size_of::<NodeId>()
            };
        self.copy_room(cost)?;
        let mut s = self.node(source)?.clone();
        let from_len = s.children.len();
        let to_len = d.children.len();
        s.children.remove(index);
        if source == destination {
            let adjusted = before_index - usize::from(before_index > index);
            s.children.insert(adjusted, root);
            self.writes.insert(source, s);
        } else {
            let mut d = d.clone();
            let mut moved = self.node(root)?.clone();
            d.children.insert(before_index, root);
            d.copy_cost += std::mem::size_of::<NodeId>();
            s.copy_cost -= std::mem::size_of::<NodeId>();
            moved.parent = Some(destination);
            self.writes.insert(source, s);
            self.writes.insert(destination, d);
            self.writes.insert(root, moved);
        }
        self.steps.push(StepMap::ChildMove {
            from_parent: source,
            from_index: index,
            to_parent: destination,
            to_index: before_index,
            count: 1,
            from_len,
            to_len,
        });
        self.prepared_copy_bytes += cost;
        Ok(())
    }

    /// Explicit full candidate boundary; the result is untrusted profile input.
    pub fn candidate_document(&self) -> Document {
        Document {
            children: self
                .node(self.root())
                .expect("root")
                .children
                .iter()
                .map(|id| self.encode(*id))
                .collect(),
        }
    }

    fn encode(&self, id: NodeId) -> Node {
        let node = self.node(id).expect("reachable candidate node");
        let d = node.data.as_ref().expect("semantic data");
        Node {
            type_id: d.type_id.clone(),
            primitive: d.primitive,
            attributes: d.attributes.clone(),
            marks: d.marks.clone(),
            text: d.text.as_ref().map(|t| t.0.clone()),
            children: node.children.iter().map(|id| self.encode(*id)).collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mapping::{MapResult, PositionMap};
    use editor_core::positions::{Affinity, Edge};

    fn text(value: &str) -> Node {
        Node {
            type_id: "org.example.fixture/text".into(),
            primitive: Primitive::Text,
            attributes: Attributes::new(),
            marks: vec![],
            text: Some(value.into()),
            children: vec![],
        }
    }
    fn paragraph(value: &str) -> Node {
        Node {
            type_id: "org.example.fixture/paragraph".into(),
            primitive: Primitive::TextBlock,
            attributes: Attributes::new(),
            marks: vec![],
            text: None,
            children: vec![text(value)],
        }
    }
    fn tree(count: usize) -> AddressTree {
        AddressTree::from_document(
            SessionKey::allocate().unwrap(),
            Document {
                children: (0..count).map(|_| paragraph("abcdef")).collect(),
            },
        )
        .unwrap()
    }
    fn first_leaf(d: &TreeDraft<'_>) -> NodeId {
        let p = d.node(d.root()).unwrap().children[0];
        d.node(p).unwrap().children[0]
    }
    fn invariant(d: &TreeDraft<'_>) {
        let mut seen = BTreeSet::new();
        let mut pending = vec![(d.root(), None)];
        while let Some((id, parent)) = pending.pop() {
            assert!(seen.insert(id), "no cycle or duplicate child reference");
            let node = d.node(id).unwrap();
            assert_eq!(node.parent, parent);
            assert_eq!(node.id.session(), d.base.key);
            pending.extend(node.children.iter().map(|child| (*child, Some(id))));
        }
        assert!(d.removed.iter().all(|id| !seen.contains(id)));
        let all = d
            .base
            .nodes
            .keys()
            .chain(d.writes.keys())
            .copied()
            .collect::<BTreeSet<_>>();
        assert_eq!(seen, all.difference(&d.removed).copied().collect());
    }
    fn tp(leaf: NodeId, n: usize, affinity: Affinity) -> Position<NodeId> {
        Position::Text {
            leaf,
            utf16: Utf16Offset::new(n),
            affinity,
        }
    }

    #[test]
    fn replacement_copies_one_node_and_refusals_preserve_candidate_and_maps() {
        let base = tree(128);
        let mut d = base.prepare();
        let leaf = first_leaf(&d);
        d.replace_text(leaf, Utf16Offset::new(2), Utf16Offset::new(5), "")
            .unwrap();
        assert_eq!(d.node(leaf).unwrap().text(), Some("abf"));
        assert_eq!(d.written_nodes(), 1);
        assert_eq!(base.node(leaf).unwrap().text(), Some("abcdef"));
        let before = d.candidate_document();
        assert!(
            d.replace_text(leaf, Utf16Offset::new(8), Utf16Offset::new(9), "x")
                .is_err()
        );
        assert_eq!(d.candidate_document(), before);
        assert_eq!(d.steps.len(), 1);
        let map = PositionMap::new(0, 1, d.steps.clone()).unwrap();
        for affinity in [Affinity::Before, Affinity::After] {
            assert_eq!(
                map.map(tp(leaf, 2, affinity)),
                MapResult::Mapped(tp(leaf, 2, affinity))
            );
            assert_eq!(
                map.map(tp(leaf, 5, affinity)),
                MapResult::Mapped(tp(leaf, 2, affinity))
            );
            assert_eq!(
                map.map(tp(leaf, 3, affinity)),
                MapResult::Deleted(tp(leaf, 2, affinity))
            );
        }
        invariant(&d);
    }

    #[test]
    fn split_join_uses_real_tree_ids_and_maps_original_content_end() {
        let base = tree(1);
        let mut d = base.prepare();
        let left = first_leaf(&d);
        let right = d.split_text(left, Utf16Offset::new(2)).unwrap();
        assert_ne!(left, right);
        assert_eq!(d.node(left).unwrap().text(), Some("ab"));
        assert_eq!(d.node(right).unwrap().text(), Some("cdef"));
        let split = PositionMap::new(7, 8, d.steps.clone()).unwrap();
        assert_eq!(
            split.map(tp(left, 2, Affinity::Before)),
            MapResult::Mapped(tp(left, 2, Affinity::Before))
        );
        assert_eq!(
            split.map(tp(left, 2, Affinity::After)),
            MapResult::Mapped(tp(right, 0, Affinity::After))
        );
        assert_eq!(
            split.map(Position::Edge {
                node: left,
                side: Edge::After
            }),
            MapResult::Mapped(Position::Edge {
                node: right,
                side: Edge::After
            })
        );
        let start = d.steps.len();
        d.join_text(left, right).unwrap();
        assert_eq!(d.node(left).unwrap().text(), Some("abcdef"));
        assert_eq!(d.node(right), Err(TreeError::MissingNode));
        let join = PositionMap::new(8, 9, d.steps[start..].to_vec()).unwrap();
        assert_eq!(
            join.map(tp(right, 3, Affinity::After)),
            MapResult::Mapped(tp(left, 5, Affinity::After))
        );
        assert_eq!(d.candidate_document(), base.document());
        invariant(&d);
    }

    #[test]
    fn move_forward_backward_and_cycles_preserve_identity() {
        let base = tree(3);
        let mut d = base.prepare();
        let root = d.root();
        let original = d.node(root).unwrap().children.clone();
        let leaf = d.node(original[1]).unwrap().children[0];
        d.move_node(original[1], root, 3).unwrap();
        assert_eq!(
            d.node(root).unwrap().children,
            vec![original[0], original[2], original[1]]
        );
        assert!(d.node(leaf).is_ok());
        let map = PositionMap::new(0, 1, d.steps.clone()).unwrap();
        assert_eq!(
            map.map(Position::Child {
                parent: root,
                index: 3,
                affinity: Affinity::Before
            }),
            MapResult::Mapped(Position::Child {
                parent: root,
                index: 2,
                affinity: Affinity::Before
            })
        );
        assert_eq!(
            map.map(tp(leaf, 3, Affinity::After)),
            MapResult::Mapped(tp(leaf, 3, Affinity::After))
        );
        d.move_node(original[1], root, 1).unwrap();
        assert_eq!(d.node(root).unwrap().children, original);
        let before = d.candidate_document();
        assert!(d.move_node(original[1], leaf, 0).is_err());
        assert_eq!(d.candidate_document(), before);
        invariant(&d);
    }

    #[test]
    fn owned_retirement_revival_preserves_historical_ids_and_never_reuses_new_ids() {
        let base = tree(2);
        let mut d = base.prepare();
        let root = d.root();
        let p = d.node(root).unwrap().children[0];
        let old_leaf = d.node(p).unwrap().children[0];
        let retired = d.detach(p).unwrap();
        let survivor = first_leaf(&d);
        let fresh = d.split_text(survivor, Utf16Offset::new(2)).unwrap();
        assert_ne!(fresh, old_leaf);
        assert_ne!(fresh, p);
        let map = PositionMap::new(0, 1, d.steps.clone()).unwrap();
        assert_eq!(
            map.map(tp(old_leaf, 2, Affinity::After)),
            MapResult::Deleted(Position::Child {
                parent: root,
                index: 0,
                affinity: Affinity::After
            })
        );
        assert_eq!(d.revive(root, 0, retired).unwrap(), p);
        assert_eq!(d.node(p).unwrap().children, vec![old_leaf]);
        assert_eq!(d.node(old_leaf).unwrap().text(), Some("abcdef"));
        invariant(&d);
        let other = tree(1);
        let foreign = other
            .prepare()
            .detach(other.nodes[&other.root].children[0])
            .unwrap();
        let before = d.candidate_document();
        let error = d.revive(root, 0, foreign).unwrap_err();
        assert_eq!(error.cause, TreeError::ForeignSession);
        assert_eq!(d.candidate_document(), before);
        // Failed revival returned the owned material so the caller can recover.
        assert_eq!(error.retired.key, other.key);
    }

    #[test]
    fn abandoned_draft_handles_do_not_alias_and_counter_exhaustion_is_atomic() {
        let base = tree(1);
        let mut a = base.prepare();
        let leaf = first_leaf(&a);
        let abandoned = a.split_text(leaf, Utf16Offset::new(2)).unwrap();
        drop(a);
        let mut b = base.prepare();
        let fresh = b.split_text(leaf, Utf16Offset::new(2)).unwrap();
        assert_ne!(fresh, abandoned);
        assert_eq!(b.node(abandoned), Err(TreeError::MissingNode));
        base.next_id.set(u64::MAX);
        let before = b.candidate_document();
        let steps = b.steps.len();
        assert_eq!(
            b.split_text(leaf, Utf16Offset::new(1)),
            Err(TreeError::CounterExhausted)
        );
        assert_eq!(b.candidate_document(), before);
        assert_eq!(b.steps.len(), steps);
        invariant(&b);
    }

    #[test]
    fn empty_parent_and_cascaded_retirement_have_surviving_structural_gap() {
        let base = tree(1);
        let mut d = base.prepare();
        let root = d.root();
        let p = d.node(root).unwrap().children[0];
        let leaf = d.node(p).unwrap().children[0];
        d.detach(leaf).unwrap();
        d.validate_position(Position::Child {
            parent: p,
            index: 0,
            affinity: Affinity::Before,
        })
        .unwrap();
        d.detach(p).unwrap();
        let map = PositionMap::new(0, 1, d.steps.clone()).unwrap();
        assert_eq!(
            map.map(tp(leaf, 2, Affinity::After)),
            MapResult::Deleted(Position::Child {
                parent: root,
                index: 0,
                affinity: Affinity::After
            })
        );
        d.validate_position(Position::Child {
            parent: root,
            index: 0,
            affinity: Affinity::Before,
        })
        .unwrap();
        invariant(&d);
    }

    #[test]
    fn generated_ascii_split_join_sequences_keep_ids_structure_and_content() {
        for seed in 0..128 {
            let base = tree(3);
            let mut d = base.prepare();
            let leaf = first_leaf(&d);
            let mut state = seed as u64 + 1;
            for _ in 0..16 {
                state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
                let at = (state % 7) as usize;
                let right = d.split_text(leaf, Utf16Offset::new(at)).unwrap();
                invariant(&d);
                d.join_text(leaf, right).unwrap();
                assert_eq!(d.node(leaf).unwrap().text(), Some("abcdef"));
                assert_eq!(d.candidate_document(), base.document());
                invariant(&d);
            }
        }
    }

    #[test]
    fn aggregate_preparation_budget_refuses_before_second_copy_and_preserves_first_edit() {
        let base = tree(3);
        let mut d = base.prepare();
        let first = first_leaf(&d);
        let p = d.node(d.root()).unwrap().children[1];
        let second = d.node(p).unwrap().children[0];
        d.copy_budget = d.node(first).unwrap().copy_cost * 2;
        d.replace_text(first, Utf16Offset::new(0), Utf16Offset::new(1), "A")
            .unwrap();
        assert_eq!(d.prepared_copy_bytes(), d.copy_budget);
        let before = d.candidate_document();
        assert_eq!(
            d.replace_text(second, Utf16Offset::new(0), Utf16Offset::new(1), "B"),
            Err(TreeError::ResourceLimit)
        );
        assert_eq!(d.candidate_document(), before);
        assert_eq!(d.written_nodes(), 1);
        assert_eq!(d.steps.len(), 1);
        invariant(&d);
    }

    #[test]
    fn checked_join_replay_restores_original_right_id_and_refuses_changed_content() {
        let base = tree(1);
        let mut d = base.prepare();
        let left = first_leaf(&d);
        let right = d.split_text(left, Utf16Offset::new(2)).unwrap();
        let joined = d.join_text(left, right).unwrap();
        let start = d.steps.len();
        assert_eq!(d.restore_join(joined).unwrap(), right);
        assert_eq!(d.node(right).unwrap().text(), Some("cdef"));
        let inverse = PositionMap::new(1, 2, d.steps[start..].to_vec()).unwrap();
        assert_eq!(
            inverse.map(tp(left, 4, Affinity::After)),
            MapResult::Mapped(tp(right, 2, Affinity::After))
        );
        let composed = PositionMap::new(0, 1, d.steps.clone()).unwrap();
        assert_eq!(
            composed.map(tp(left, 4, Affinity::After)),
            MapResult::Mapped(tp(right, 2, Affinity::After))
        );
        let joined = d.join_text(left, right).unwrap();
        d.replace_text(left, Utf16Offset::new(0), Utf16Offset::new(1), "A")
            .unwrap();
        let before = d.candidate_document();
        let error = d.restore_join(joined).unwrap_err();
        assert_eq!(error.cause, TreeError::IncompatibleText);
        assert_eq!(d.candidate_document(), before);
        assert_eq!(error.joined.right.id, right);
        invariant(&d);
    }
}
