// SPDX-License-Identifier: MIT OR Apache-2.0
//! Addressable admitted storage and sparse, explicitly unadmitted preparation.
//!
//! A TreeDraft cannot publish a Session. OSR-34 supplies the validation/commit
//! gate. Its primitives are also the identity substrate for history in OSR-36.

use std::cell::Cell;
use std::collections::{BTreeMap, BTreeSet};
use std::marker::PhantomData;

use editor_core::admission::{PreflightBudget, preflight_node_fields, preflight_snapshot};
use editor_core::candidate::{BorrowedNode, CandidateRead};
use editor_core::document::{Attribute, Attributes, Document, Mark, Node, Primitive};
use editor_core::positions::{
    Affinity, BoundaryPolicy, Edge, InlineSpan, Position, PositionError, Selection, Utf16Offset,
    utf16_to_utf8, validate_inline_boundary,
};
use editor_core::transaction::{MarkEdit, Operation, WorkMeter};

use crate::identity::{NodeId, SessionKey};
use crate::mapping::StepMap;

const MAX_DEPTH: usize = 128;
const MAX_STEPS: usize = 4096;
const MAX_TEXT_BYTES: usize = 16 * 1024 * 1024;
const MAX_PREPARED_COPY_BYTES: usize = 16 * 1024 * 1024;

mod allocation_sealed {
    pub trait Sealed {}
}

/// Closed allocation policies. Preview cursors cannot publish their patches.
#[doc(hidden)]
pub trait Allocation: allocation_sealed::Sealed {
    fn reserve(&self, real: &Cell<u64>, count: u64) -> Result<u64, TreeError>;
}
#[derive(Debug, Clone, Copy, Default)]
pub struct RealAllocation;
#[derive(Debug)]
pub(crate) struct PreviewAllocation {
    next: Cell<u64>,
}
impl allocation_sealed::Sealed for RealAllocation {}
impl allocation_sealed::Sealed for PreviewAllocation {}
fn reserve_ids(cursor: &Cell<u64>, count: u64) -> Result<u64, TreeError> {
    let start = cursor.get();
    let end = start
        .checked_add(count)
        .ok_or(TreeError::CounterExhausted)?;
    cursor.set(end);
    Ok(start)
}
impl Allocation for RealAllocation {
    fn reserve(&self, real: &Cell<u64>, count: u64) -> Result<u64, TreeError> {
        reserve_ids(real, count)
    }
}
impl Allocation for PreviewAllocation {
    fn reserve(&self, _: &Cell<u64>, count: u64) -> Result<u64, TreeError> {
        reserve_ids(&self.next, count)
    }
}

/// Only trusted profile normalization may address scalar interiors. This token
/// is crate-private and cannot be supplied by an SDK operation payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EditOrigin {
    User,
    Normalization,
}

impl EditOrigin {
    fn boundary(self) -> BoundaryPolicy {
        match self {
            Self::User => BoundaryPolicy::Grapheme,
            Self::Normalization => BoundaryPolicy::Scalar,
        }
    }
}

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

/// Current record size under the shared logical copy policy. Only borrowed
/// metadata and child-reference width are measured; child records and text
/// contents are never cloned or scanned for Unicode to refresh this cache.
fn record_copy_cost(
    type_id: &str,
    text: Option<&str>,
    attributes: &Attributes,
    marks: &[Mark],
    child_count: usize,
) -> Result<usize, TreeError> {
    let usage = preflight_node_fields(
        type_id,
        text,
        attributes,
        marks,
        child_count,
        PreflightBudget::default(),
    )
    .map_err(|_| TreeError::ResourceLimit)?;
    let payload = usize::try_from(usage.payload_bytes).map_err(|_| TreeError::ResourceLimit)?;
    let values = usize::try_from(usage.values).map_err(|_| TreeError::ResourceLimit)?;
    std::mem::size_of::<TreeNode>()
        .checked_add(payload)
        .and_then(|cost| cost.checked_add(values.checked_mul(std::mem::size_of::<Attribute>())?))
        .and_then(|cost| cost.checked_add(child_count.checked_mul(std::mem::size_of::<NodeId>())?))
        .ok_or(TreeError::ResourceLimit)
}

fn range_marks(marks: &[Mark], work: &mut WorkMeter) -> Result<(), TreeError> {
    let left = work.limits();
    let spent = work.usage();
    let usage = preflight_node_fields(
        "",
        None,
        &Attributes::new(),
        marks,
        0,
        PreflightBudget {
            payload_bytes: left.bytes.saturating_sub(spent.bytes),
            values: left.units.saturating_sub(spent.units),
            depth: MAX_DEPTH as u64,
        },
    )
    .map_err(|_| TreeError::ResourceLimit)?;
    work.charge_units(usage.values)
        .map_err(|_| TreeError::ResourceLimit)?;
    work.charge_bytes(
        usage
            .payload_bytes
            .saturating_mul(8)
            .saturating_add(usage.values.saturating_mul(128)),
    )
    .map_err(|_| TreeError::ResourceLimit)
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

fn borrowed(node: &TreeNode) -> Option<BorrowedNode<'_, NodeId>> {
    let data = node.data.as_ref()?;
    Some(BorrowedNode {
        type_id: &data.type_id,
        primitive: data.primitive,
        attributes: &data.attributes,
        marks: &data.marks,
        text: node.text(),
        children: &node.children,
        parent: node.parent?,
    })
}

impl CandidateRead for AddressTree {
    type Id = NodeId;
    fn root(&self) -> NodeId {
        self.root
    }
    fn roots(&self) -> &[NodeId] {
        &self.nodes[&self.root].children
    }
    fn node(&self, id: NodeId) -> Option<BorrowedNode<'_, NodeId>> {
        borrowed(AddressTree::node(self, id).ok()?)
    }
}

impl<A: Allocation> CandidateRead for TreeDraft<'_, A> {
    type Id = NodeId;
    fn root(&self) -> NodeId {
        self.root()
    }
    fn roots(&self) -> &[NodeId] {
        &self.node(self.root()).expect("synthetic root").children
    }
    fn node(&self, id: NodeId) -> Option<BorrowedNode<'_, NodeId>> {
        borrowed(TreeDraft::node(self, id).ok()?)
    }
}

fn same_record(a: &TreeNode, b: &TreeNode) -> bool {
    a.id == b.id && a.parent == b.parent && a.data == b.data && a.children == b.children
}

#[derive(Debug)]
struct ChangedRecord {
    id: NodeId,
    before: Option<TreeNode>,
    after: Option<TreeNode>,
}

/// Owned sparse journal substrate. It carries no public restore authority.
#[derive(Debug)]
pub(crate) struct CommitMaterial {
    records: Vec<ChangedRecord>,
    estimated_bytes: usize,
}
impl CommitMaterial {
    pub(crate) fn estimated_bytes(&self) -> usize {
        self.estimated_bytes
    }
    pub(crate) fn changed_count(&self) -> usize {
        debug_assert!(self.records.iter().all(|record| {
            [&record.before, &record.after]
                .into_iter()
                .flatten()
                .all(|node| node.id == record.id)
        }));
        self.records.len()
    }
    pub(crate) fn before_count(&self) -> usize {
        self.records.iter().filter(|r| r.before.is_some()).count()
    }
    pub(crate) fn after_count(&self) -> usize {
        self.records.iter().filter(|r| r.after.is_some()).count()
    }
}

/// Fully prepared memory, with no externally writable fields. Only the Session
/// owner may publish after final candidate/profile/map validation.
#[derive(Debug)]
pub(crate) struct PreparedTreePatch<A = RealAllocation> {
    key: SessionKey,
    writes: BTreeMap<NodeId, TreeNode>,
    removed: BTreeSet<NodeId>,
    steps: Vec<StepMap<NodeId>>,
    changed_ids: Vec<NodeId>,
    material: CommitMaterial,
    prepared_copy_bytes: usize,
    allocation: PhantomData<A>,
}
impl<A> PreparedTreePatch<A> {
    pub(crate) fn changed(&self) -> bool {
        !self.changed_ids.is_empty()
    }
    pub(crate) fn steps(&self) -> &[StepMap<NodeId>] {
        &self.steps
    }
    pub(crate) fn changed_ids(&self) -> &[NodeId] {
        &self.changed_ids
    }
    pub(crate) fn material_bytes(&self) -> usize {
        self.material.estimated_bytes()
    }
    pub(crate) fn prepared_copy_bytes(&self) -> usize {
        self.prepared_copy_bytes
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
    /// Infallible expected-error phase. The exclusive Session owner validates a
    /// patch against this tree immediately before publication; no callbacks run.
    pub(crate) fn publish(&mut self, patch: PreparedTreePatch) -> CommitMaterial {
        assert_eq!(
            patch.key, self.key,
            "Session owner published a foreign patch"
        );
        for id in patch.removed {
            self.nodes.remove(&id);
        }
        self.nodes.extend(patch.writes);
        patch.material
    }

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
        let serial = RealAllocation.reserve(&self.next_id, 1)?;
        Ok(NodeId::new(self.key, serial))
    }

    fn adopt(&mut self, node: Node, parent: NodeId) -> Result<NodeId, TreeError> {
        let copy_cost = record_copy_cost(
            &node.type_id,
            node.text.as_deref(),
            &node.attributes,
            &node.marks,
            node.children.len(),
        )?;
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
        self.prepare_with(RealAllocation)
    }

    pub(crate) fn prepare_preview(&self) -> TreeDraft<'_, PreviewAllocation> {
        self.prepare_with(PreviewAllocation {
            next: Cell::new(self.next_id.get()),
        })
    }

    fn prepare_with<A: Allocation>(&self, allocation: A) -> TreeDraft<'_, A> {
        TreeDraft {
            base: self,
            allocation,
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

/// Borrowed metadata accounting before equality walks or cloning operation
/// payloads. Logical overhead is conservative, not an allocator measurement.
#[derive(Default)]
struct MetadataCost {
    bytes: usize,
    values: usize,
}
impl MetadataCost {
    fn add(&mut self, bytes: usize) -> Result<(), TreeError> {
        self.bytes = self
            .bytes
            .checked_add(bytes)
            .ok_or(TreeError::ResourceLimit)?;
        if self.bytes > MAX_PREPARED_COPY_BYTES {
            return Err(TreeError::ResourceLimit);
        }
        Ok(())
    }
    fn visit(&mut self, depth: usize) -> Result<(), TreeError> {
        self.values += 1;
        if depth > MAX_DEPTH || self.values > 1_000_000 {
            return Err(TreeError::ResourceLimit);
        }
        self.add(std::mem::size_of::<Attribute>())
    }
    fn attrs(&mut self, attrs: &Attributes, depth: usize) -> Result<(), TreeError> {
        if attrs.len() > 1_000_000usize.saturating_sub(self.values) {
            return Err(TreeError::ResourceLimit);
        }
        for (key, value) in attrs {
            self.add(key.len())?;
            self.attribute(value, depth)?;
        }
        Ok(())
    }
    fn attribute(&mut self, value: &Attribute, depth: usize) -> Result<(), TreeError> {
        self.visit(depth)?;
        match value {
            Attribute::Null => self.add(4),
            Attribute::Boolean(_) => self.add(5),
            Attribute::String(s) => self.add(s.len()),
            Attribute::Number(n) => {
                // Display streams into this bounded sink even if another
                // dependency enables serde_json/arbitrary_precision.
                use std::fmt::Write;
                write!(self, "{n}").map_err(|_| TreeError::ResourceLimit)
            }
            Attribute::List(values) => {
                if values.len() > 1_000_000usize.saturating_sub(self.values) {
                    return Err(TreeError::ResourceLimit);
                }
                for value in values {
                    self.attribute(value, depth + 1)?;
                }
                Ok(())
            }
            Attribute::Object(values) => self.attrs(values, depth + 1),
        }
    }
    fn marks(&mut self, marks: &[Mark]) -> Result<(), TreeError> {
        if marks.len() > 1_000_000 {
            return Err(TreeError::ResourceLimit);
        }
        for mark in marks {
            self.visit(1)?;
            self.add(mark.type_id.len() + std::mem::size_of::<Mark>())?;
            self.attrs(&mark.attributes, 2)?;
        }
        Ok(())
    }
}
impl std::fmt::Write for MetadataCost {
    fn write_str(&mut self, s: &str) -> std::fmt::Result {
        self.add(s.len()).map_err(|_| std::fmt::Error)
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
pub struct TreeDraft<'a, A = RealAllocation> {
    base: &'a AddressTree,
    allocation: A,
    writes: BTreeMap<NodeId, TreeNode>,
    removed: BTreeSet<NodeId>,
    steps: Vec<StepMap<NodeId>>,
    prepared_copy_bytes: usize,
    copy_budget: usize,
}

impl<A: Allocation> TreeDraft<'_, A> {
    fn range_boundary(
        &self,
        leaf: NodeId,
        offset: Utf16Offset,
        work: &mut WorkMeter,
    ) -> Result<(), TreeError> {
        let parent = self.node(leaf)?.parent.ok_or(TreeError::RootMutation)?;
        let children = &self.node(parent)?.children;
        work.charge_units(children.len() as u64)
            .map_err(|_| TreeError::ResourceLimit)?;
        work.charge_bytes(
            (children.len() * std::mem::size_of::<InlineSpan<'_, NodeId>>() * 2) as u64,
        )
        .map_err(|_| TreeError::ResourceLimit)?;
        for id in children {
            work.charge_bytes(self.node(*id)?.text().map_or(0, |text| text.len()) as u64)
                .map_err(|_| TreeError::ResourceLimit)?;
        }
        self.boundary(leaf, offset, BoundaryPolicy::Grapheme)?;
        Ok(())
    }

    fn range_endpoint(
        &self,
        point: Position<NodeId>,
        work: &mut WorkMeter,
    ) -> Result<(), TreeError> {
        work.charge_units(1).map_err(|_| TreeError::ResourceLimit)?;
        match point {
            Position::Text { leaf, utf16, .. } => self.range_boundary(leaf, utf16, work),
            Position::Child { parent, index, .. } => {
                self.validate_position(point)?;
                let node = self.node(parent)?;
                if node.primitive() == Some(Primitive::TextBlock) {
                    if index > 0
                        && let Some(text) = self.node(node.children[index - 1])?.text()
                    {
                        work.charge_bytes(text.len() as u64)
                            .map_err(|_| TreeError::ResourceLimit)?;
                        self.range_boundary(
                            node.children[index - 1],
                            Utf16Offset::new(text.encode_utf16().count()),
                            work,
                        )?;
                    } else if index < node.children.len()
                        && self.node(node.children[index])?.text().is_some()
                    {
                        self.range_boundary(node.children[index], Utf16Offset::new(0), work)?;
                    }
                }
                Ok(())
            }
            Position::Edge { node, side } => {
                if let Some(text) = self.node(node)?.text() {
                    work.charge_bytes(text.len() as u64)
                        .map_err(|_| TreeError::ResourceLimit)?;
                    let offset = if side == Edge::Before {
                        0
                    } else {
                        text.encode_utf16().count()
                    };
                    self.range_boundary(node, Utf16Offset::new(offset), work)?;
                }
                Ok(())
            }
        }
    }

    fn selected_text(
        &self,
        range: Selection<NodeId>,
        work: &mut WorkMeter,
    ) -> Result<Vec<(NodeId, usize, usize)>, TreeError> {
        self.range_endpoint(range.anchor, work)?;
        self.range_endpoint(range.focus, work)?;
        struct Scan<'a> {
            points: [(Position<NodeId>, Option<u64>); 2],
            leaves: Vec<(NodeId, u64, usize)>,
            cursor: u64,
            work: &'a mut WorkMeter,
        }
        fn walk<A: Allocation>(
            draft: &TreeDraft<'_, A>,
            id: NodeId,
            depth: usize,
            state: &mut Scan<'_>,
        ) -> Result<(), TreeError> {
            if depth > MAX_DEPTH {
                return Err(TreeError::ResourceLimit);
            }
            state
                .work
                .charge_units(1)
                .map_err(|_| TreeError::ResourceLimit)?;
            let node = draft.node(id)?;
            for (point, cut) in &mut state.points {
                if matches!(point,Position::Edge{node,side:Edge::Before} if *node==id) {
                    *cut = Some(state.cursor);
                }
            }
            state.cursor = state
                .cursor
                .checked_add(1)
                .ok_or(TreeError::ResourceLimit)?;
            if let Some(text) = node.text() {
                state
                    .work
                    .charge_bytes(text.len() as u64)
                    .map_err(|_| TreeError::ResourceLimit)?;
                let length = text.encode_utf16().count();
                for (point, cut) in &mut state.points {
                    if let Position::Text { leaf, utf16, .. } = point
                        && *leaf == id
                    {
                        *cut = Some(state.cursor + utf16.get() as u64);
                    }
                }
                state
                    .work
                    .charge_bytes((std::mem::size_of::<(NodeId, u64, usize)>() * 2) as u64)
                    .map_err(|_| TreeError::ResourceLimit)?;
                state.leaves.push((id, state.cursor, length));
                state.cursor = state
                    .cursor
                    .checked_add(length as u64)
                    .ok_or(TreeError::ResourceLimit)?;
            }
            for index in 0..=node.children.len() {
                for (point, cut) in &mut state.points {
                    if matches!(point,Position::Child{parent,index:i,..} if *parent==id && *i==index)
                    {
                        *cut = Some(state.cursor);
                    }
                }
                if index < node.children.len() {
                    walk(draft, node.children[index], depth + 1, state)?;
                }
            }
            state.cursor = state
                .cursor
                .checked_add(1)
                .ok_or(TreeError::ResourceLimit)?;
            for (point, cut) in &mut state.points {
                if matches!(point,Position::Edge{node,side:Edge::After} if *node==id) {
                    *cut = Some(state.cursor);
                }
            }
            Ok(())
        }
        let mut state = Scan {
            points: [(range.anchor, None), (range.focus, None)],
            leaves: Vec::new(),
            cursor: 0,
            work,
        };
        walk(self, self.root(), 0, &mut state)?;
        let a = state.points[0].1.ok_or(TreeError::MissingNode)?;
        let b = state.points[1].1.ok_or(TreeError::MissingNode)?;
        let (left, right) = (a.min(b), a.max(b));
        let mut selected = Vec::new();
        for (id, start, length) in state.leaves {
            let from = left.saturating_sub(start).min(length as u64) as usize;
            let to = right.saturating_sub(start).min(length as u64) as usize;
            if from < to {
                state
                    .work
                    .charge_bytes((std::mem::size_of::<(NodeId, usize, usize)>() * 2) as u64)
                    .map_err(|_| TreeError::ResourceLimit)?;
                selected.push((id, from, to));
            }
        }
        Ok(selected)
    }

    fn range_step<R>(
        &mut self,
        work: &mut WorkMeter,
        action: impl FnOnce(&mut Self) -> Result<R, TreeError>,
    ) -> Result<R, TreeError> {
        let before = self.prepared_copy_bytes;
        let remaining = work.limits().bytes.saturating_sub(work.usage().bytes);
        self.tighten_copy_budget(
            before.saturating_add(usize::try_from(remaining).unwrap_or(usize::MAX)),
        );
        let result = action(self)?;
        work.charge_bytes((self.prepared_copy_bytes - before) as u64)
            .map_err(|_| TreeError::ResourceLimit)?;
        Ok(result)
    }

    fn atomic_range<R>(
        &mut self,
        affected: &[NodeId],
        work: &mut WorkMeter,
        action: impl FnOnce(&mut Self, &mut Vec<NodeId>, &mut WorkMeter) -> Result<R, TreeError>,
    ) -> Result<R, TreeError> {
        work.charge_units(affected.len() as u64)
            .map_err(|_| TreeError::ResourceLimit)?;
        work.charge_bytes(
            (affected.len() * std::mem::size_of::<(NodeId, Option<TreeNode>)>() * 2) as u64,
        )
        .map_err(|_| TreeError::ResourceLimit)?;
        let mut unique = BTreeSet::new();
        let mut backup = Vec::new();
        let mut backup_cost = 0usize;
        for id in affected {
            work.charge_bytes((std::mem::size_of::<NodeId>() * 4) as u64)
                .map_err(|_| TreeError::ResourceLimit)?;
            if unique.insert(*id)
                && let Some(node) = self.writes.get(id)
            {
                backup_cost = backup_cost
                    .checked_add(node.copy_cost)
                    .ok_or(TreeError::ResourceLimit)?;
            }
        }
        self.copy_room(backup_cost)?;
        work.charge_bytes(backup_cost as u64)
            .map_err(|_| TreeError::ResourceLimit)?;
        for id in unique {
            backup.push((id, self.writes.get(&id).cloned()));
        }
        let before_copy = self.prepared_copy_bytes;
        let before_steps = self.steps.len();
        let before_budget = self.copy_budget;
        self.prepared_copy_bytes += backup_cost;
        let mut created = Vec::new();
        let result = action(self, &mut created, work);
        if result.is_err() {
            for id in created {
                self.writes.remove(&id);
                self.removed.remove(&id);
            }
            for (id, node) in backup {
                self.removed.remove(&id);
                if let Some(node) = node {
                    self.writes.insert(id, node);
                } else {
                    self.writes.remove(&id);
                }
            }
            self.steps.truncate(before_steps);
            self.prepared_copy_bytes = before_copy;
            self.copy_budget = before_budget;
        }
        result
    }

    fn range_split(
        &mut self,
        id: NodeId,
        at: usize,
        created: &mut Vec<NodeId>,
        work: &mut WorkMeter,
    ) -> Result<NodeId, TreeError> {
        work.charge_units(1).map_err(|_| TreeError::ResourceLimit)?;
        work.charge_bytes((std::mem::size_of::<NodeId>() * 2) as u64)
            .map_err(|_| TreeError::ResourceLimit)?;
        let right = self.range_step(work, |draft| {
            draft.split_text_policy(id, Utf16Offset::new(at), BoundaryPolicy::Scalar)
        })?;
        created.push(right);
        Ok(right)
    }

    /// The only authorization is the original outer EGC-safe range. The same
    /// exact-key delta applies uniformly to every covered text run.
    pub(crate) fn patch_mark_range(
        &mut self,
        range: Selection<NodeId>,
        edits: &[MarkEdit],
        work: &mut WorkMeter,
    ) -> Result<(), TreeError> {
        work.charge_units(edits.len() as u64)
            .map_err(|_| TreeError::ResourceLimit)?;
        let mut keys = BTreeSet::new();
        for edit in edits {
            let key = match edit {
                MarkEdit::Upsert(mark) => &mark.type_id,
                MarkEdit::Remove { type_id } => type_id,
            };
            work.charge_bytes((key.len() + std::mem::size_of::<&str>() * 4) as u64)
                .map_err(|_| TreeError::ResourceLimit)?;
            if key.is_empty() || !keys.insert(key.as_str()) {
                return Err(TreeError::InvalidStructure);
            }
            if let MarkEdit::Upsert(mark) = edit {
                range_marks(std::slice::from_ref(mark), work)?;
            }
        }
        let selected = self.selected_text(range, work)?;
        if edits.is_empty() || selected.is_empty() {
            return Ok(());
        }
        work.charge_bytes((selected.len() * std::mem::size_of::<NodeId>() * 4) as u64)
            .map_err(|_| TreeError::ResourceLimit)?;
        let mut affected = Vec::new();
        for (id, _, _) in &selected {
            affected.push(*id);
            affected.push(self.node(*id)?.parent.ok_or(TreeError::RootMutation)?);
        }
        self.atomic_range(&affected, work, |draft, created, work| {
            for (id, from, to) in selected {
                let text = draft.node(id)?.text().ok_or(TreeError::InvalidStructure)?;
                work.charge_bytes(text.len() as u64)
                    .map_err(|_| TreeError::ResourceLimit)?;
                let length = text.encode_utf16().count();
                let old = draft.node(id)?.marks();
                range_marks(old, work)?;
                work.charge_units((old.len() as u64).saturating_mul(edits.len() as u64))
                    .map_err(|_| TreeError::ResourceLimit)?;
                let compared = old
                    .iter()
                    .fold(0u64, |sum, mark| {
                        sum.saturating_add(mark.type_id.len() as u64)
                    })
                    .saturating_mul(edits.len() as u64);
                work.charge_bytes(compared)
                    .map_err(|_| TreeError::ResourceLimit)?;
                let mut marks = old.to_vec();
                for edit in edits {
                    let key = match edit {
                        MarkEdit::Upsert(mark) => &mark.type_id,
                        MarkEdit::Remove { type_id } => type_id,
                    };
                    marks.retain(|mark| mark.type_id != *key);
                    if let MarkEdit::Upsert(mark) = edit {
                        range_marks(std::slice::from_ref(mark), work)?;
                        marks.push(mark.clone());
                    }
                }
                if draft.node(id)?.marks() != marks {
                    if to < length {
                        draft.range_split(id, to, created, work)?;
                    }
                    let target = if from > 0 {
                        draft.range_split(id, from, created, work)?
                    } else {
                        id
                    };
                    let mut cost = MetadataCost::default();
                    cost.marks(&marks)?;
                    draft.range_step(work, |draft| {
                        draft.update_data(target, cost.bytes, |data| data.marks = marks)
                    })?;
                }
            }
            Ok(())
        })
    }

    fn inline_point(
        &self,
        point: Position<NodeId>,
        work: &mut WorkMeter,
    ) -> Result<(NodeId, Position<NodeId>), TreeError> {
        match point {
            Position::Text { leaf, .. } => Ok((
                self.node(leaf)?.parent.ok_or(TreeError::RootMutation)?,
                point,
            )),
            Position::Child { parent, .. }
                if self.node(parent)?.primitive() == Some(Primitive::TextBlock) =>
            {
                Ok((parent, point))
            }
            Position::Edge { node, side } => {
                let record = self.node(node)?;
                if record.primitive() == Some(Primitive::TextBlock) {
                    return Ok((
                        node,
                        Position::Child {
                            parent: node,
                            index: if side == Edge::Before {
                                0
                            } else {
                                record.children.len()
                            },
                            affinity: Affinity::After,
                        },
                    ));
                }
                let parent = self.node(node)?.parent.ok_or(TreeError::RootMutation)?;
                work.charge_units(self.node(parent)?.children.len() as u64)
                    .map_err(|_| TreeError::ResourceLimit)?;
                let (parent, index) = self.parent_index(node)?;
                if let Some(text) = record.text() {
                    work.charge_bytes(text.len() as u64)
                        .map_err(|_| TreeError::ResourceLimit)?;
                    Ok((
                        parent,
                        Position::Text {
                            leaf: node,
                            utf16: Utf16Offset::new(if side == Edge::Before {
                                0
                            } else {
                                text.encode_utf16().count()
                            }),
                            affinity: Affinity::After,
                        },
                    ))
                } else {
                    Ok((
                        parent,
                        Position::Child {
                            parent,
                            index: index + usize::from(side == Edge::After),
                            affinity: Affinity::After,
                        },
                    ))
                }
            }
            _ => Err(TreeError::InvalidStructure),
        }
    }

    fn inline_order(
        &self,
        point: Position<NodeId>,
        work: &mut WorkMeter,
    ) -> Result<(usize, usize), TreeError> {
        match point {
            Position::Text { leaf, utf16, .. } => {
                let parent = self.node(leaf)?.parent.ok_or(TreeError::RootMutation)?;
                work.charge_units(self.node(parent)?.children.len() as u64)
                    .map_err(|_| TreeError::ResourceLimit)?;
                Ok((self.parent_index(leaf)?.1, utf16.get()))
            }
            Position::Child { index, .. } => Ok((index, 0)),
            _ => Err(TreeError::InvalidStructure),
        }
    }
    fn inline_gap(
        &self,
        point: Position<NodeId>,
        work: &mut WorkMeter,
    ) -> Result<usize, TreeError> {
        match point {
            Position::Child { index, .. } => Ok(index),
            Position::Text { leaf, utf16, .. } => {
                let parent = self.node(leaf)?.parent.ok_or(TreeError::RootMutation)?;
                work.charge_units(self.node(parent)?.children.len() as u64)
                    .map_err(|_| TreeError::ResourceLimit)?;
                work.charge_bytes(self.node(leaf)?.text().map_or(0, |text| text.len()) as u64)
                    .map_err(|_| TreeError::ResourceLimit)?;
                let index = self.parent_index(leaf)?.1;
                if utf16.get() == 0 {
                    Ok(index)
                } else if self
                    .node(leaf)?
                    .text()
                    .ok_or(TreeError::InvalidStructure)?
                    .encode_utf16()
                    .count()
                    == utf16.get()
                {
                    Ok(index + 1)
                } else {
                    Err(TreeError::InvalidRange)
                }
            }
            _ => Err(TreeError::InvalidStructure),
        }
    }

    /// Same-inline-parent replacement, with one optional profile-supplied inline
    /// leaf. Only the original outer range grants internal splice authority;
    /// deleting a barrier may temporarily join a new grapheme before insertion.
    pub(crate) fn replace_inline_range(
        &mut self,
        range: Selection<NodeId>,
        inserted: Option<&Node>,
        work: &mut WorkMeter,
    ) -> Result<Vec<NodeId>, TreeError> {
        self.range_endpoint(range.anchor, work)?;
        self.range_endpoint(range.focus, work)?;
        if let Some(node) = inserted {
            let left = work.limits();
            let spent = work.usage();
            let usage = preflight_node_fields(
                &node.type_id,
                node.text.as_deref(),
                &node.attributes,
                &node.marks,
                node.children.len(),
                PreflightBudget {
                    payload_bytes: left.bytes.saturating_sub(spent.bytes),
                    values: left.units.saturating_sub(spent.units),
                    depth: MAX_DEPTH as u64,
                },
            )
            .map_err(|_| TreeError::ResourceLimit)?;
            work.charge_units(usage.values)
                .map_err(|_| TreeError::ResourceLimit)?;
            work.charge_bytes(
                usage
                    .payload_bytes
                    .saturating_mul(8)
                    .saturating_add(usage.values.saturating_mul(128)),
            )
            .map_err(|_| TreeError::ResourceLimit)?;
            if !matches!(
                node.primitive,
                Primitive::Text | Primitive::HardBreak | Primitive::InlineAtom
            ) || (node.primitive == Primitive::Text) != node.text.is_some()
                || !node.children.is_empty()
                || node.type_id.is_empty()
            {
                return Err(TreeError::InvalidStructure);
            }
        }
        let (parent, mut a) = self.inline_point(range.anchor, work)?;
        let (other, mut b) = self.inline_point(range.focus, work)?;
        if parent != other || self.node(parent)?.primitive() != Some(Primitive::TextBlock) {
            return Err(TreeError::InvalidStructure);
        }
        let children = &self.node(parent)?.children;
        work.charge_units(children.len() as u64)
            .map_err(|_| TreeError::ResourceLimit)?;
        work.charge_bytes((children.len() * std::mem::size_of::<NodeId>() * 4) as u64)
            .map_err(|_| TreeError::ResourceLimit)?;
        let a_order = self.inline_order(a, work)?;
        let b_order = self.inline_order(b, work)?;
        if a_order == b_order && inserted.is_none() {
            return Ok(Vec::new());
        }
        if a_order > b_order {
            std::mem::swap(&mut a, &mut b);
        }
        if let Position::Text { affinity, .. } = &mut a {
            *affinity = Affinity::After;
        }
        if let Position::Text { affinity, .. } = &mut b {
            *affinity = Affinity::Before;
        }
        if let Position::Child { affinity, .. } = &mut b {
            *affinity = Affinity::After;
        }
        let mut affected = children.to_vec();
        affected.push(parent);
        self.atomic_range(&affected, work, |draft, created, work| {
            for end in [true, false] {
                let point = if end { b } else { a };
                if let Position::Text { leaf, utf16, .. } = point {
                    let text = draft
                        .node(leaf)?
                        .text()
                        .ok_or(TreeError::InvalidStructure)?;
                    work.charge_bytes(text.len() as u64)
                        .map_err(|_| TreeError::ResourceLimit)?;
                    if utf16.get() > 0 && utf16.get() < text.encode_utf16().count() {
                        let start = draft.steps.len();
                        draft.range_split(leaf, utf16.get(), created, work)?;
                        for step in &draft.steps[start..] {
                            a = step.map(a).position().ok_or(TreeError::InvalidRange)?;
                            b = step.map(b).position().ok_or(TreeError::InvalidRange)?;
                        }
                    }
                }
            }
            let from = draft.inline_gap(a, work)?;
            let to = draft.inline_gap(b, work)?;
            if from > to {
                return Err(TreeError::InvalidRange);
            }
            let remove = &draft.node(parent)?.children[from..to];
            work.charge_units(remove.len() as u64)
                .map_err(|_| TreeError::ResourceLimit)?;
            work.charge_bytes(std::mem::size_of_val(remove) as u64)
                .map_err(|_| TreeError::ResourceLimit)?;
            let remove = remove.to_vec();
            for id in remove {
                draft.range_step(work, |draft| draft.detach(id).map(|_| ()))?;
            }
            let Some(node) = inserted else {
                return Ok(Vec::new());
            };
            work.charge_bytes((std::mem::size_of::<NodeId>() * 2) as u64)
                .map_err(|_| TreeError::ResourceLimit)?;
            let fragment = Document {
                children: vec![node.clone()],
            };
            let roots = draft.range_step(work, |draft| {
                draft.insert_fragment(parent, from, &fragment, EditOrigin::Normalization)
            })?;
            created.extend(roots.iter().copied());
            Ok(roots)
        })
    }

    /// Move one contiguous inline group with only its original outer gaps
    /// admitted as user boundaries; all node IDs and payload remain intact.
    pub(crate) fn move_inline_group(
        &mut self,
        nodes: &[NodeId],
        parent: NodeId,
        before_index: usize,
        work: &mut WorkMeter,
    ) -> Result<(), TreeError> {
        work.charge_units(nodes.len() as u64)
            .map_err(|_| TreeError::ResourceLimit)?;
        work.charge_bytes((std::mem::size_of_val(nodes) * 4) as u64)
            .map_err(|_| TreeError::ResourceLimit)?;
        let first = *nodes.first().ok_or(TreeError::InvalidRange)?;
        let source = self.node(first)?.parent.ok_or(TreeError::RootMutation)?;
        let from = self.node(source)?;
        let destination = self.node(parent)?;
        if from.primitive() != Some(Primitive::TextBlock)
            || destination.primitive() != Some(Primitive::TextBlock)
        {
            return Err(TreeError::InvalidStructure);
        }
        work.charge_units((from.children.len() + destination.children.len()) as u64)
            .map_err(|_| TreeError::ResourceLimit)?;
        let index = from
            .children
            .iter()
            .position(|id| *id == first)
            .ok_or(TreeError::InvalidStructure)?;
        let end = index
            .checked_add(nodes.len())
            .ok_or(TreeError::InvalidRange)?;
        if end > from.children.len()
            || &from.children[index..end] != nodes
            || before_index > destination.children.len()
        {
            return Err(TreeError::InvalidRange);
        }
        for id in nodes {
            let record = self.node(*id)?;
            if record.parent != Some(source)
                || !matches!(
                    record.primitive(),
                    Some(Primitive::Text | Primitive::HardBreak | Primitive::InlineAtom)
                )
                || !record.children.is_empty()
            {
                return Err(TreeError::InvalidStructure);
            }
        }
        for (parent, index) in [(source, index), (source, end)] {
            self.range_endpoint(
                Position::Child {
                    parent,
                    index,
                    affinity: Affinity::After,
                },
                work,
            )?;
        }
        if source == parent && (index..=end).contains(&before_index) {
            return Ok(());
        }
        self.range_endpoint(
            Position::Child {
                parent,
                index: before_index,
                affinity: Affinity::After,
            },
            work,
        )?;
        let to_index = if source == parent && before_index > end {
            before_index - nodes.len()
        } else {
            before_index
        };
        let (from_len, to_len) = (from.children.len(), destination.children.len());
        let mut affected = nodes.to_vec();
        affected.push(source);
        affected.push(parent);
        self.atomic_range(&affected, work, |draft, _, work| {
            draft.range_step(work, |draft| {
                draft.room(1)?;
                let mut cost = draft.node(source)?.copy_cost;
                if source != parent {
                    cost = cost
                        .checked_add(draft.node(parent)?.copy_cost)
                        .ok_or(TreeError::ResourceLimit)?;
                }
                for id in nodes {
                    cost = cost
                        .checked_add(draft.node(*id)?.copy_cost)
                        .ok_or(TreeError::ResourceLimit)?;
                }
                draft.copy_room(cost)?;
                let mut changed_source = draft.node(source)?.clone();
                changed_source.children.drain(index..end);
                if source == parent {
                    changed_source
                        .children
                        .splice(to_index..to_index, nodes.iter().copied());
                    draft.writes.insert(source, changed_source);
                } else {
                    let mut changed_destination = draft.node(parent)?.clone();
                    changed_destination
                        .children
                        .splice(to_index..to_index, nodes.iter().copied());
                    changed_source.copy_cost -= std::mem::size_of_val(nodes);
                    changed_destination.copy_cost += std::mem::size_of_val(nodes);
                    draft.writes.insert(source, changed_source);
                    draft.writes.insert(parent, changed_destination);
                }
                for id in nodes {
                    let mut changed = draft.node(*id)?.clone();
                    changed.parent = Some(parent);
                    draft.writes.insert(*id, changed);
                }
                draft.steps.push(StepMap::ChildMove {
                    from_parent: source,
                    from_index: index,
                    to_parent: parent,
                    to_index: before_index,
                    count: nodes.len(),
                    from_len,
                    to_len,
                });
                draft.prepared_copy_bytes += cost;
                Ok(())
            })
        })
    }

    pub fn root(&self) -> NodeId {
        self.base.root
    }
    pub fn steps(&self) -> &[StepMap<NodeId>] {
        &self.steps
    }
    pub fn written_nodes(&self) -> usize {
        self.writes.len()
    }
    /// Borrowed net semantic/identity comparison. Cache estimates, transient
    /// identities and speculative maps alone do not require a new revision.
    pub(crate) fn has_changes(&self) -> bool {
        self.removed
            .iter()
            .any(|id| self.base.nodes.contains_key(id))
            || self.writes.iter().any(|(id, changed)| {
                self.base
                    .nodes
                    .get(id)
                    .is_none_or(|old| !same_record(old, changed))
            })
    }
    /// Final borrowed generic-shape gate after all operations/normalization.
    /// Closed primitives preserve reachability; depth and parent checks also
    /// prevent a malformed internal link from causing unbounded recursion.
    pub(crate) fn validate_structure(&self, work: &mut WorkMeter) -> Result<(), TreeError> {
        fn visit<A: Allocation>(
            draft: &TreeDraft<'_, A>,
            id: NodeId,
            parent: Option<NodeId>,
            family: Option<Primitive>,
            depth: usize,
            work: &mut WorkMeter,
        ) -> Result<(), TreeError> {
            if depth > MAX_DEPTH {
                return Err(TreeError::ResourceLimit);
            }
            work.charge_units(1).map_err(|_| TreeError::ResourceLimit)?;
            let node = draft.node(id)?;
            if node.id != id || node.parent != parent {
                return Err(TreeError::InvalidStructure);
            }
            if let Some(data) = &node.data {
                if parent.is_none()
                    || data.type_id.is_empty()
                    || !allowed_child(family, data.primitive)
                    || (data.primitive == Primitive::Text) != data.text.is_some()
                    || (data.primitive != Primitive::Text && !data.marks.is_empty())
                    || (!matches!(data.primitive, Primitive::Container | Primitive::TextBlock)
                        && !node.children.is_empty())
                {
                    return Err(TreeError::InvalidStructure);
                }
            } else if id != draft.root() || parent.is_some() {
                return Err(TreeError::InvalidStructure);
            }
            work.charge_units(node.children.len() as u64)
                .map_err(|_| TreeError::ResourceLimit)?;
            for child in &node.children {
                visit(draft, *child, Some(id), node.primitive(), depth + 1, work)?;
            }
            Ok(())
        }
        visit(self, self.root(), None, None, 0, work)
    }
    pub fn prepared_copy_bytes(&self) -> usize {
        self.prepared_copy_bytes
    }
    /// Host work limits can only tighten the absolute cumulative allowance.
    pub(crate) fn tighten_copy_budget(&mut self, total: usize) {
        self.copy_budget = self.copy_budget.min(total);
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
        self.replace_text_policy(leaf, from, to, inserted, BoundaryPolicy::Grapheme)
    }

    fn replace_text_policy(
        &mut self,
        leaf: NodeId,
        from: Utf16Offset,
        to: Utf16Offset,
        inserted: &str,
        policy: BoundaryPolicy,
    ) -> Result<(), TreeError> {
        self.room(1)?;
        if from.get() > to.get() {
            return Err(TreeError::InvalidRange);
        }
        let a = self.boundary(leaf, from, policy)?;
        let b = self.boundary(leaf, to, policy)?;
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
        self.split_text_policy(left, at, BoundaryPolicy::Grapheme)
    }

    fn split_text_policy(
        &mut self,
        left: NodeId,
        at: Utf16Offset,
        policy: BoundaryPolicy,
    ) -> Result<NodeId, TreeError> {
        self.room(2)?;
        let byte = self.boundary(left, at, policy)?;
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
        let right = NodeId::new(
            self.base.key,
            self.allocation.reserve(&self.base.next_id, 1)?,
        );
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
mod command_range_tests {
    use super::*;
    use crate::mapping::{MapResult, PositionMap};
    use editor_core::transaction::WorkLimits;

    fn marks(name: &str) -> Vec<Mark> {
        vec![Mark {
            type_id: format!("org.example/{name}"),
            attributes: Attributes::new(),
        }]
    }
    fn text(value: &str, marks: Vec<Mark>) -> Node {
        Node {
            type_id: "org.example/text".into(),
            primitive: Primitive::Text,
            attributes: Attributes::new(),
            marks,
            text: Some(value.into()),
            children: vec![],
        }
    }
    fn block(content: Vec<Node>) -> Node {
        Node {
            type_id: "org.example/paragraph".into(),
            primitive: Primitive::TextBlock,
            attributes: Attributes::new(),
            marks: vec![],
            text: None,
            children: content,
        }
    }
    fn tree(content: Vec<Node>) -> AddressTree {
        AddressTree::from_document(
            SessionKey::allocate().unwrap(),
            Document {
                children: vec![block(content), block(vec![])],
            },
        )
        .unwrap()
    }
    fn point(leaf: NodeId, offset: usize) -> Position<NodeId> {
        Position::Text {
            leaf,
            utf16: Utf16Offset::new(offset),
            affinity: Affinity::After,
        }
    }
    fn gap(parent: NodeId, index: usize) -> Position<NodeId> {
        Position::Child {
            parent,
            index,
            affinity: Affinity::After,
        }
    }
    fn edge(node: NodeId, side: Edge) -> Position<NodeId> {
        Position::Edge { node, side }
    }
    fn selection(anchor: Position<NodeId>, focus: Position<NodeId>) -> Selection<NodeId> {
        Selection { anchor, focus }
    }
    fn meter() -> WorkMeter {
        WorkMeter::new(WorkLimits::default())
    }
    fn parents(base: &AddressTree) -> (NodeId, NodeId) {
        let children = base.node(base.root()).unwrap().children();
        (children[0], children[1])
    }

    #[test]
    fn preview_allocation_is_pure_for_split_fragment_duplicate_and_exhaustion() {
        let base = tree(vec![text("abcd", vec![])]);
        let (parent, _) = parents(&base);
        let leaf = base.node(parent).unwrap().children[0];
        let high = base.next_id.get();
        let original = base.document();
        let run = |draft: &mut TreeDraft<'_, PreviewAllocation>| {
            let right = draft.split_text(leaf, Utf16Offset::new(2)).unwrap();
            let fragment = draft
                .insert_fragment(
                    draft.root(),
                    1,
                    &Document {
                        children: vec![block(vec![text("new", vec![])])],
                    },
                    EditOrigin::User,
                )
                .unwrap();
            let duplicate = draft
                .duplicate(parent, draft.root(), 2, EditOrigin::User)
                .unwrap();
            (right, fragment, duplicate, draft.candidate_document())
        };
        let first = run(&mut base.prepare_preview());
        let second = run(&mut base.prepare_preview());
        assert_eq!(first, second);
        assert_eq!(base.next_id.get(), high);
        assert_eq!(base.document(), original);
        let mut real = base.prepare();
        assert_eq!(real.split_text(leaf, Utf16Offset::new(2)).unwrap(), first.0);
        assert_eq!(
            real.insert_fragment(
                real.root(),
                1,
                &Document {
                    children: vec![block(vec![text("new", vec![])])]
                },
                EditOrigin::User
            )
            .unwrap(),
            first.1
        );
        assert_eq!(
            real.duplicate(parent, real.root(), 2, EditOrigin::User)
                .unwrap(),
            first.2
        );
        assert_eq!(real.candidate_document(), first.3);
        assert!(base.next_id.get() > high);
        drop(real);
        base.next_id.set(u64::MAX - 1);
        let mut preview = base.prepare_preview();
        preview.split_text(leaf, Utf16Offset::new(1)).unwrap();
        assert_eq!(
            preview.split_text(leaf, Utf16Offset::new(0)),
            Err(TreeError::CounterExhausted)
        );
        assert_eq!(base.next_id.get(), u64::MAX - 1);
        let mut preview = base.prepare_preview();
        assert_eq!(
            preview.insert_fragment(
                preview.root(),
                0,
                &Document {
                    children: vec![block(vec![text("new", vec![])])]
                },
                EditOrigin::User
            ),
            Err(TreeError::CounterExhausted)
        );
        assert_eq!(preview.written_nodes(), 0);
        assert_eq!(base.next_id.get(), u64::MAX - 1);
    }

    #[test]
    fn uniform_mark_delta_admits_whole_styled_grapheme_for_all_outer_endpoint_forms() {
        let base = tree(vec![
            text("e", vec![]),
            text("\u{301}", marks("strong")),
            text("!", vec![]),
        ]);
        let (parent, _) = parents(&base);
        let ids = base.node(parent).unwrap().children();
        for range in [
            selection(point(ids[0], 0), point(ids[1], 1)),
            selection(gap(parent, 0), gap(parent, 2)),
            selection(edge(ids[0], Edge::Before), edge(ids[1], Edge::After)),
        ] {
            let mut draft = base.prepare();
            draft
                .patch_mark_range(
                    range,
                    &[MarkEdit::Upsert(marks("emphasis").remove(0))],
                    &mut meter(),
                )
                .unwrap();
            assert_eq!(draft.node(ids[0]).unwrap().marks(), marks("emphasis"));
            assert_eq!(
                draft.node(ids[1]).unwrap().marks(),
                [marks("strong").remove(0), marks("emphasis").remove(0)]
            );
            assert!(draft.node(ids[2]).unwrap().marks().is_empty());
            assert_eq!(draft.node(parent).unwrap().children(), ids);
            assert!(draft.steps().is_empty());
        }
        for start in [
            point(ids[0], 1),
            gap(parent, 1),
            edge(ids[0], Edge::After),
            edge(ids[1], Edge::Before),
        ] {
            let mut draft = base.prepare();
            let original = draft.candidate_document();
            assert_eq!(
                draft.patch_mark_range(
                    selection(start, point(ids[1], 1)),
                    &[MarkEdit::Upsert(marks("emphasis").remove(0))],
                    &mut meter()
                ),
                Err(TreeError::Position(PositionError::NotGraphemeBoundary))
            );
            assert_eq!(draft.candidate_document(), original);
            assert_eq!(draft.written_nodes(), 0);
        }
    }

    #[test]
    fn reverse_partial_unicode_marks_preserve_text_and_map_direction() {
        let base = tree(vec![text("A😀e\u{301}Z", vec![])]);
        let (parent, _) = parents(&base);
        let leaf = base.node(parent).unwrap().children[0];
        let range = selection(
            Position::Text {
                leaf,
                utf16: Utf16Offset::new(5),
                affinity: Affinity::Before,
            },
            point(leaf, 1),
        );
        let mut draft = base.prepare();
        draft
            .patch_mark_range(
                range,
                &[MarkEdit::Upsert(marks("strong").remove(0))],
                &mut meter(),
            )
            .unwrap();
        let ids = draft.node(parent).unwrap().children();
        assert_eq!(ids.len(), 3);
        assert_eq!(draft.node(ids[0]).unwrap().text(), Some("A"));
        assert_eq!(draft.node(ids[1]).unwrap().text(), Some("😀e\u{301}"));
        assert_eq!(draft.node(ids[2]).unwrap().text(), Some("Z"));
        assert_eq!(draft.node(ids[1]).unwrap().marks(), marks("strong"));
        let map = PositionMap::new(0, 1, draft.steps().to_vec()).unwrap();
        assert_eq!(
            map.map(range.anchor).position(),
            Some(Position::Text {
                leaf: ids[1],
                utf16: Utf16Offset::new(4),
                affinity: Affinity::Before
            })
        );
        assert_eq!(map.map(range.focus).position(), Some(point(ids[1], 0)));
    }

    #[test]
    fn late_range_budget_failure_restores_prior_draft_and_maps_after_private_splits() {
        let mut large = marks("strong");
        large[0]
            .attributes
            .insert("payload".into(), Attribute::String("x".repeat(2048)));
        let base = tree(vec![text("ab", vec![]), text("cd", large)]);
        let (parent, _) = parents(&base);
        let ids = base.node(parent).unwrap().children();
        let mut draft = base.prepare();
        draft
            .apply_operation(
                &Operation::SetAttribute {
                    node: parent,
                    key: "old".into(),
                    value: Some(Attribute::Boolean(true)),
                },
                EditOrigin::User,
            )
            .unwrap();
        let original = draft.candidate_document();
        let writes = draft.written_nodes();
        let copied = draft.prepared_copy_bytes();
        let high = base.next_id.get();
        let mut work = WorkMeter::new(WorkLimits {
            units: 1_000_000,
            bytes: 16000,
        });
        assert_eq!(
            draft.patch_mark_range(
                selection(point(ids[0], 1), point(ids[1], 1)),
                &[MarkEdit::Upsert(marks("emphasis").remove(0))],
                &mut work
            ),
            Err(TreeError::ResourceLimit)
        );
        assert!(
            base.next_id.get() > high,
            "first affected leaf was split before later refusal"
        );
        assert_eq!(draft.candidate_document(), original);
        assert_eq!(draft.written_nodes(), writes);
        assert_eq!(draft.prepared_copy_bytes(), copied);
        assert!(draft.steps().is_empty());
    }

    #[test]
    fn inline_replacement_removes_exact_styles_and_barriers_with_bounded_fresh_root() {
        let atom = Node {
            type_id: "org.example/atom".into(),
            primitive: Primitive::InlineAtom,
            attributes: Attributes::from([(
                "payload".into(),
                Attribute::String("preserved unless selected".into()),
            )]),
            marks: vec![],
            text: None,
            children: vec![],
        };
        let hard = Node {
            type_id: "org.example/break".into(),
            primitive: Primitive::HardBreak,
            attributes: Attributes::new(),
            marks: vec![],
            text: None,
            children: vec![],
        };
        let base = tree(vec![
            text("ab", vec![]),
            hard,
            atom,
            text("cd", marks("strong")),
        ]);
        let (parent, other) = parents(&base);
        let ids = base.node(parent).unwrap().children();
        let mut draft = base.prepare();
        let inserted = text("Q", marks("emphasis"));
        let roots = draft
            .replace_inline_range(
                selection(point(ids[0], 1), point(ids[3], 1)),
                Some(&inserted),
                &mut meter(),
            )
            .unwrap();
        assert_eq!(roots.len(), 1);
        let after = draft.node(parent).unwrap().children();
        assert_eq!(after.len(), 3);
        assert_eq!(after[0], ids[0]);
        assert_eq!(after[1], roots[0]);
        assert_eq!(draft.node(after[0]).unwrap().text(), Some("a"));
        assert_eq!(draft.node(after[1]).unwrap().text(), Some("Q"));
        assert_eq!(draft.node(after[2]).unwrap().text(), Some("d"));
        assert_eq!(draft.node(after[2]).unwrap().marks(), marks("strong"));
        assert_eq!(draft.node(ids[1]), Err(TreeError::MissingNode));
        assert_eq!(draft.node(ids[2]), Err(TreeError::MissingNode));
        let mut refused = base.prepare();
        let original = refused.candidate_document();
        let high = base.next_id.get();
        assert_eq!(
            refused.replace_inline_range(
                selection(point(ids[0], 1), gap(other, 0)),
                None,
                &mut meter()
            ),
            Err(TreeError::InvalidStructure)
        );
        assert_eq!(refused.candidate_document(), original);
        assert_eq!(base.next_id.get(), high);
        let mut malformed = inserted;
        malformed.children.push(text("hidden", vec![]));
        assert_eq!(
            refused.replace_inline_range(
                selection(point(ids[0], 0), point(ids[0], 1)),
                Some(&malformed),
                &mut meter()
            ),
            Err(TreeError::InvalidStructure)
        );
        assert_eq!(refused.candidate_document(), original);
    }

    #[test]
    fn inline_replacement_admits_whole_grapheme_and_refuses_hidden_child_gap_cut() {
        let base = tree(vec![
            text("e", vec![]),
            text("\u{301}", marks("strong")),
            text("!", vec![]),
        ]);
        let (parent, _) = parents(&base);
        let ids = base.node(parent).unwrap().children();
        let mut draft = base.prepare();
        let prototype = text("X", vec![]);
        let roots = draft
            .replace_inline_range(
                selection(edge(ids[0], Edge::Before), edge(ids[1], Edge::After)),
                Some(&prototype),
                &mut meter(),
            )
            .unwrap();
        assert_eq!(draft.node(parent).unwrap().children(), &[roots[0], ids[2]]);
        assert_eq!(draft.node(ids[2]).unwrap().text(), Some("!"));
        let mut refused = base.prepare();
        assert_eq!(
            refused.replace_inline_range(
                selection(gap(parent, 1), gap(parent, 2)),
                None,
                &mut meter()
            ),
            Err(TreeError::Position(PositionError::NotGraphemeBoundary))
        );
        assert_eq!(refused.written_nodes(), 0);
    }

    #[test]
    fn inline_leaf_replacement_uses_original_barrier_proof_and_preserves_failure_counters() {
        let hard = Node {
            type_id: "org.example/break".into(),
            primitive: Primitive::HardBreak,
            attributes: Attributes::new(),
            marks: vec![],
            text: None,
            children: vec![],
        };
        let atom = Node {
            type_id: "org.example/atom".into(),
            primitive: Primitive::InlineAtom,
            attributes: Attributes::from([("label".into(), Attribute::String("object".into()))]),
            marks: vec![],
            text: None,
            children: vec![],
        };
        let base = tree(vec![
            text("e", vec![]),
            hard.clone(),
            text("\u{301}", marks("strong")),
        ]);
        let (parent, _) = parents(&base);
        let ids = base.node(parent).unwrap().children();
        let range = selection(gap(parent, 1), gap(parent, 2));
        for prototype in [&hard, &atom] {
            let mut draft = base.prepare();
            let roots = draft
                .replace_inline_range(range, Some(prototype), &mut meter())
                .unwrap();
            assert_eq!(roots.len(), 1);
            assert_ne!(roots[0], ids[1]);
            assert_eq!(
                draft.node(parent).unwrap().children(),
                &[ids[0], roots[0], ids[2]]
            );
            assert_eq!(draft.node(ids[0]).unwrap().text(), Some("e"));
            assert_eq!(draft.node(ids[2]).unwrap().text(), Some("\u{301}"));
            assert_eq!(
                draft.node(roots[0]).unwrap().primitive(),
                Some(prototype.primitive)
            );
            assert_eq!(
                draft.node(roots[0]).unwrap().attributes(),
                Some(&prototype.attributes)
            );
            draft.validate_structure(&mut meter()).unwrap();
        }
        base.next_id.set(u64::MAX);
        let mut draft = base.prepare();
        let original = draft.candidate_document();
        let copied = draft.prepared_copy_bytes();
        let high = base.next_id.get();
        assert_eq!(
            draft.replace_inline_range(range, Some(&hard), &mut meter()),
            Err(TreeError::CounterExhausted)
        );
        assert_eq!(draft.candidate_document(), original);
        assert_eq!(draft.prepared_copy_bytes(), copied);
        assert_eq!(base.next_id.get(), high);
        assert!(draft.steps().is_empty());
        assert_eq!(draft.written_nodes(), 0);
        let mut budget = WorkMeter::new(WorkLimits {
            units: 1_000_000,
            bytes: 1,
        });
        assert_eq!(
            draft.replace_inline_range(range, Some(&atom), &mut budget),
            Err(TreeError::ResourceLimit)
        );
        assert_eq!(draft.candidate_document(), original);
        assert_eq!(draft.prepared_copy_bytes(), copied);
        assert_eq!(base.next_id.get(), high);
        assert!(draft.steps().is_empty());
    }

    #[test]
    fn inline_group_move_preserves_ids_and_one_counted_map_with_outer_gap_guards() {
        let base = tree(vec![
            text("A", vec![]),
            text("e", marks("emphasis")),
            text("\u{301}", marks("strong")),
            text("B", vec![]),
        ]);
        let (parent, other) = parents(&base);
        let ids = base.node(parent).unwrap().children();
        let mut draft = base.prepare();
        draft
            .move_inline_group(&ids[1..3], other, 0, &mut meter())
            .unwrap();
        assert_eq!(draft.node(parent).unwrap().children(), &[ids[0], ids[3]]);
        assert_eq!(draft.node(other).unwrap().children(), &ids[1..3]);
        assert_eq!(draft.node(ids[1]).unwrap().parent(), Some(other));
        assert_eq!(draft.node(ids[2]).unwrap().marks(), marks("strong"));
        assert!(matches!(
            draft.steps(),
            [StepMap::ChildMove {
                count: 2,
                from_index: 1,
                to_index: 0,
                ..
            }]
        ));
        let mut same = base.prepare();
        same.move_inline_group(&ids[1..3], parent, 4, &mut meter())
            .unwrap();
        assert_eq!(
            same.node(parent).unwrap().children(),
            &[ids[0], ids[3], ids[1], ids[2]]
        );
        let parent_gap = |index, affinity| Position::Child {
            parent,
            index,
            affinity,
        };
        let forward = PositionMap::new(0, 1, same.steps().to_vec()).unwrap();
        assert_eq!(
            forward.map(parent_gap(4, Affinity::Before)),
            MapResult::Mapped(parent_gap(2, Affinity::Before)),
            "the original destination gap must be adjusted exactly once"
        );
        // Parent gaps use the established remove+insert mapping. Source
        // interiors collapse at the removed range; they do not follow IDs.
        for (affinity, expected) in [
            (Affinity::Before, [0, 1, 1, 1, 2]),
            (Affinity::After, [0, 1, 1, 1, 4]),
        ] {
            for (index, expected) in expected.into_iter().enumerate() {
                assert_eq!(
                    forward.map(parent_gap(index, affinity)),
                    MapResult::Mapped(parent_gap(expected, affinity)),
                    "forward gap {index} {affinity:?}"
                );
            }
        }
        assert!(matches!(
            same.steps(),
            [StepMap::ChildMove {
                count: 2,
                to_index: 4,
                ..
            }]
        ));
        let mut backward = base.prepare();
        backward
            .move_inline_group(&ids[1..3], parent, 0, &mut meter())
            .unwrap();
        assert_eq!(
            backward.node(parent).unwrap().children(),
            &[ids[1], ids[2], ids[0], ids[3]]
        );
        assert!(matches!(
            backward.steps(),
            [StepMap::ChildMove {
                count: 2,
                to_index: 0,
                ..
            }]
        ));
        let backward_map = PositionMap::new(0, 1, backward.steps().to_vec()).unwrap();
        for (affinity, expected) in [
            (Affinity::Before, [0, 3, 3, 3, 4]),
            (Affinity::After, [2, 3, 3, 3, 4]),
        ] {
            for (index, expected) in expected.into_iter().enumerate() {
                assert_eq!(
                    backward_map.map(parent_gap(index, affinity)),
                    MapResult::Mapped(parent_gap(expected, affinity)),
                    "backward gap {index} {affinity:?}"
                );
            }
        }
        for (candidate, map) in [(&same, &forward), (&backward, &backward_map)] {
            for id in &ids[1..3] {
                assert_eq!(candidate.node(*id).unwrap().parent(), Some(parent));
                assert_eq!(
                    candidate.node(*id).unwrap().text(),
                    base.node(*id).unwrap().text()
                );
                assert_eq!(
                    candidate.node(*id).unwrap().marks(),
                    base.node(*id).unwrap().marks()
                );
                for affinity in [Affinity::Before, Affinity::After] {
                    for utf16 in 0..=1 {
                        let position = Position::Text {
                            leaf: *id,
                            utf16: Utf16Offset::new(utf16),
                            affinity,
                        };
                        assert_eq!(map.map(position), MapResult::Mapped(position));
                    }
                }
            }
        }
        for before_index in 1..=3 {
            let mut no_op = base.prepare();
            no_op
                .move_inline_group(&ids[1..3], parent, before_index, &mut meter())
                .unwrap();
            assert_eq!(no_op.written_nodes(), 0);
            assert_eq!(no_op.prepared_copy_bytes(), 0);
            assert!(no_op.steps().is_empty());
            assert_eq!(no_op.node(parent).unwrap().children(), ids);
            let identity = PositionMap::identity(0);
            for affinity in [Affinity::Before, Affinity::After] {
                for index in 0..=4 {
                    let position = parent_gap(index, affinity);
                    assert_eq!(identity.map(position), MapResult::Mapped(position));
                }
            }
        }
        let mut refused = base.prepare();
        assert_eq!(
            refused.move_inline_group(&ids[1..2], other, 0, &mut meter()),
            Err(TreeError::Position(PositionError::NotGraphemeBoundary))
        );
        assert_eq!(refused.written_nodes(), 0);
        assert_eq!(
            refused.move_inline_group(&[ids[2], ids[1]], other, 0, &mut meter()),
            Err(TreeError::InvalidRange)
        );
        assert_eq!(refused.written_nodes(), 0);
    }
}

impl<A: Allocation> TreeDraft<'_, A> {
    fn user_leaf_boundary(&self, id: NodeId, origin: EditOrigin) -> Result<(), TreeError> {
        if origin == EditOrigin::User
            && let Some(text) = self.node(id)?.text()
        {
            self.boundary(id, Utf16Offset::new(0), BoundaryPolicy::Grapheme)?;
            self.boundary(
                id,
                Utf16Offset::new(text.encode_utf16().count()),
                BoundaryPolicy::Grapheme,
            )?;
        }
        Ok(())
    }

    fn insertion_boundary(
        &self,
        parent: NodeId,
        index: usize,
        origin: EditOrigin,
    ) -> Result<(), TreeError> {
        let children = &self.node(parent)?.children;
        if index > children.len() {
            return Err(TreeError::InvalidIndex);
        }
        if origin == EditOrigin::User {
            if index > 0
                && let Some(text) = self.node(children[index - 1])?.text()
            {
                self.boundary(
                    children[index - 1],
                    Utf16Offset::new(text.encode_utf16().count()),
                    BoundaryPolicy::Grapheme,
                )?;
            }
            if index < children.len() && self.node(children[index])?.text().is_some() {
                self.boundary(
                    children[index],
                    Utf16Offset::new(0),
                    BoundaryPolicy::Grapheme,
                )?;
            }
        }
        Ok(())
    }

    fn update_data(
        &mut self,
        id: NodeId,
        added_cost: usize,
        update: impl FnOnce(&mut Data),
    ) -> Result<(), TreeError> {
        self.room(1)?;
        let node = self.node(id)?;
        if node.data.is_none() {
            return Err(TreeError::RootMutation);
        }
        let upper_cost = node
            .copy_cost
            .checked_add(added_cost)
            .ok_or(TreeError::ResourceLimit)?;
        let cost = node
            .copy_cost
            .checked_add(upper_cost)
            .ok_or(TreeError::ResourceLimit)?;
        self.copy_room(cost)?;
        let mut changed = node.clone();
        let data = changed.data.as_mut().expect("semantic data");
        update(data);
        // The preparation charge retains its conservative upper bound, while
        // the persisted cache describes only the resulting live record. Old
        // replaced/removed metadata must not accumulate across future commits.
        changed.copy_cost = record_copy_cost(
            &data.type_id,
            data.text.as_ref().map(|text| text.0.as_str()),
            &data.attributes,
            &data.marks,
            changed.children.len(),
        )?;
        self.writes.insert(id, changed);
        self.prepared_copy_bytes += cost;
        Ok(())
    }

    /// Full fragment preflight precedes all copies and one atomic ID-range
    /// reservation. The caller's Document remains borrowed and unchanged.
    fn insert_fragment(
        &mut self,
        parent: NodeId,
        index: usize,
        fragment: &Document,
        origin: EditOrigin,
    ) -> Result<Vec<NodeId>, TreeError> {
        self.room(1)?;
        let metrics = preflight_snapshot(fragment, PreflightBudget::default())
            .map_err(|_| TreeError::ResourceLimit)?;
        let parent_node = self.node(parent)?;
        if !matches!(
            parent_node.primitive(),
            None | Some(Primitive::Container | Primitive::TextBlock)
        ) {
            return Err(TreeError::InvalidStructure);
        }
        self.insertion_boundary(parent, index, origin)?;
        let mut depth = 0;
        let mut ancestor = Some(parent);
        while let Some(id) = ancestor {
            depth += 1;
            if depth > MAX_DEPTH {
                return Err(TreeError::ResourceLimit);
            }
            ancestor = self.node(id)?.parent;
        }
        for node in &fragment.children {
            check_shape(node, parent_node.primitive(), depth)?;
        }
        if fragment.children.is_empty() {
            return Ok(Vec::new());
        }
        let count = usize::try_from(metrics.nodes).map_err(|_| TreeError::ResourceLimit)?;
        let overhead = std::mem::size_of::<TreeNode>() + std::mem::size_of::<NodeId>() * 3;
        let cost = count
            .checked_mul(overhead)
            .and_then(|n| n.checked_add(metrics.usage.payload_bytes as usize))
            .and_then(|n| {
                n.checked_add(
                    (metrics.usage.values as usize).checked_mul(std::mem::size_of::<Attribute>())?,
                )
            })
            .and_then(|n| n.checked_add(parent_node.copy_cost))
            .ok_or(TreeError::ResourceLimit)?;
        self.copy_room(cost)?;
        // All expected failures are now resolved. IDs are consumed once for the
        // entire insertion and never recycled if its enclosing batch is refused.
        let start = self.allocation.reserve(&self.base.next_id, metrics.nodes)?;
        let mut serial = start;
        let mut records = BTreeMap::new();
        fn build(
            node: &Node,
            parent: NodeId,
            key: SessionKey,
            serial: &mut u64,
            records: &mut BTreeMap<NodeId, TreeNode>,
        ) -> NodeId {
            let id = NodeId::new(key, *serial);
            *serial += 1;
            let children = node
                .children
                .iter()
                .map(|child| build(child, id, key, serial, records))
                .collect::<Vec<_>>();
            let copy_cost = record_copy_cost(
                &node.type_id,
                node.text.as_deref(),
                &node.attributes,
                &node.marks,
                children.len(),
            )
            .expect("whole fragment preflight and copy budget");
            records.insert(
                id,
                TreeNode {
                    id,
                    parent: Some(parent),
                    children,
                    copy_cost,
                    data: Some(Data {
                        type_id: node.type_id.clone(),
                        primitive: node.primitive,
                        attributes: node.attributes.clone(),
                        marks: node.marks.clone(),
                        text: node.text.as_ref().map(|s| TextStore(s.clone())),
                    }),
                },
            );
            id
        }
        let roots = fragment
            .children
            .iter()
            .map(|node| build(node, parent, self.base.key, &mut serial, &mut records))
            .collect::<Vec<_>>();
        debug_assert_eq!(serial, start + metrics.nodes);
        let mut changed_parent = parent_node.clone();
        let old_len = changed_parent.children.len();
        changed_parent
            .children
            .splice(index..index, roots.iter().copied());
        changed_parent.copy_cost += roots.len() * std::mem::size_of::<NodeId>();
        self.writes.extend(records);
        self.writes.insert(parent, changed_parent);
        self.steps.push(StepMap::ChildInsert {
            parent,
            index,
            count: roots.len(),
            old_len,
        });
        self.prepared_copy_bytes += cost;
        Ok(roots)
    }

    fn duplicate(
        &mut self,
        id: NodeId,
        parent: NodeId,
        index: usize,
        origin: EditOrigin,
    ) -> Result<Vec<NodeId>, TreeError> {
        self.room(1)?;
        let source = self.node(id)?;
        let primitive = source.primitive().ok_or(TreeError::RootMutation)?;
        let destination = self.node(parent)?;
        if !allowed_child(destination.primitive(), primitive) {
            return Err(TreeError::InvalidStructure);
        }
        self.user_leaf_boundary(id, origin)?;
        self.insertion_boundary(parent, index, origin)?;
        let mut depth = 0;
        let mut ancestor = Some(parent);
        while let Some(current) = ancestor {
            depth += 1;
            if depth > MAX_DEPTH {
                return Err(TreeError::ResourceLimit);
            }
            ancestor = self.node(current)?.parent;
        }
        let mut cost = destination.copy_cost + std::mem::size_of::<NodeId>() * 2;
        let mut count = 0u64;
        self.walk_subtree(id, depth, &mut |node, _| {
            count = count.checked_add(1).ok_or(TreeError::ResourceLimit)?;
            cost = cost
                .checked_add(node.copy_cost + std::mem::size_of::<NodeId>())
                .ok_or(TreeError::ResourceLimit)?;
            self.copy_room(cost)
        })?;
        let start = self.allocation.reserve(&self.base.next_id, count)?;
        let mut serial = start;
        let mut records = BTreeMap::new();
        fn build<A: Allocation>(
            draft: &TreeDraft<'_, A>,
            source: NodeId,
            parent: NodeId,
            serial: &mut u64,
            records: &mut BTreeMap<NodeId, TreeNode>,
        ) -> NodeId {
            let old = draft.node(source).expect("borrowed preflight");
            let id = NodeId::new(draft.base.key, *serial);
            *serial += 1;
            let children = old
                .children
                .iter()
                .map(|child| build(draft, *child, id, serial, records))
                .collect();
            records.insert(
                id,
                TreeNode {
                    id,
                    parent: Some(parent),
                    data: old.data.clone(),
                    children,
                    copy_cost: old.copy_cost,
                },
            );
            id
        }
        let fresh = build(self, id, parent, &mut serial, &mut records);
        debug_assert_eq!(serial, start + count);
        let mut changed_parent = destination.clone();
        let old_len = changed_parent.children.len();
        changed_parent.children.insert(index, fresh);
        changed_parent.copy_cost += std::mem::size_of::<NodeId>();
        self.writes.extend(records);
        self.writes.insert(parent, changed_parent);
        self.steps.push(StepMap::ChildInsert {
            parent,
            index,
            count: 1,
            old_len,
        });
        self.prepared_copy_bytes += cost;
        Ok(vec![fresh])
    }

    /// User payloads cannot obtain Normalization origin. Profile operations are
    /// still validated before publication and cannot bypass scalar boundaries.
    pub(crate) fn apply_operation(
        &mut self,
        operation: &Operation<NodeId>,
        origin: EditOrigin,
    ) -> Result<Vec<NodeId>, TreeError> {
        match operation {
            Operation::PatchMarkRange { .. }
            | Operation::ReplaceInlineRange { .. }
            | Operation::MoveInlineGroup { .. } => return Err(TreeError::InvalidStructure),
            Operation::ReplaceText {
                leaf,
                from,
                to,
                inserted,
            } => self.replace_text_policy(*leaf, *from, *to, inserted, origin.boundary())?,
            Operation::SplitText { leaf, at } => {
                return self
                    .split_text_policy(*leaf, *at, origin.boundary())
                    .map(|right| vec![right]);
            }
            Operation::JoinText { left, right } => {
                self.join_text(*left, *right)?;
            }
            Operation::SetAttribute { node, key, value } => {
                let current = self
                    .node(*node)?
                    .data
                    .as_ref()
                    .ok_or(TreeError::RootMutation)?;
                let mut account = MetadataCost::default();
                account.add(key.len())?;
                if let Some(value) = value {
                    account.attribute(value, 1)?;
                }
                if current.attributes.get(key) == value.as_ref() {
                    return Ok(Vec::new());
                }
                self.update_data(*node, account.bytes, |data| {
                    if let Some(value) = value {
                        data.attributes.insert(key.clone(), value.clone());
                    } else {
                        data.attributes.remove(key);
                    }
                })?;
            }
            Operation::SetMarks { leaf, marks } => {
                let node = self.node(*leaf)?;
                if node.primitive() != Some(Primitive::Text) {
                    return Err(TreeError::InvalidStructure);
                }
                self.user_leaf_boundary(*leaf, origin)?;
                let mut account = MetadataCost::default();
                account.marks(marks)?;
                if node.marks() == marks {
                    return Ok(Vec::new());
                }
                self.update_data(*leaf, account.bytes, |data| data.marks = marks.clone())?;
            }
            Operation::Transform {
                node,
                type_id,
                primitive,
            } => {
                if type_id.is_empty() {
                    return Err(TreeError::InvalidStructure);
                }
                let old = self
                    .node(*node)?
                    .data
                    .as_ref()
                    .ok_or(TreeError::RootMutation)?;
                if type_id.len() > MAX_PREPARED_COPY_BYTES {
                    return Err(TreeError::ResourceLimit);
                }
                if old.type_id == *type_id && old.primitive == *primitive {
                    return Ok(Vec::new());
                }
                // Payload/children deliberately remain intact. The final
                // profile phase rejects any incompatible resulting shape.
                self.update_data(*node, type_id.len(), |data| {
                    data.type_id = type_id.clone();
                    data.primitive = *primitive;
                })?;
            }
            Operation::InsertFragment {
                parent,
                index,
                fragment,
            } => return self.insert_fragment(*parent, *index, fragment, origin),
            Operation::Move {
                node,
                parent,
                before_index,
            } => {
                self.user_leaf_boundary(*node, origin)?;
                self.insertion_boundary(*parent, *before_index, origin)?;
                self.move_node(*node, *parent, *before_index)?;
            }
            Operation::Duplicate {
                node,
                parent,
                index,
            } => return self.duplicate(*node, *parent, *index, origin),
            Operation::Remove { node } => {
                self.user_leaf_boundary(*node, origin)?;
                self.detach(*node)?;
            }
        }
        Ok(Vec::new())
    }

    /// Full-snapshot normalization is never used here. Only sparse affected
    /// records are compared and copied; cache estimates do not create commits.
    pub(crate) fn prepare_patch(mut self) -> Result<PreparedTreePatch<A>, TreeError> {
        self.writes.retain(|id, changed| {
            self.base
                .nodes
                .get(id)
                .is_none_or(|old| !same_record(old, changed))
        });
        self.removed.retain(|id| self.base.nodes.contains_key(id));
        let count = self
            .writes
            .len()
            .checked_add(self.removed.len())
            .ok_or(TreeError::ResourceLimit)?;
        let id_bytes = count
            .checked_mul(std::mem::size_of::<NodeId>())
            .ok_or(TreeError::ResourceLimit)?;
        // Preflight temporary changed-ID storage as well as owned records.
        self.copy_room(id_bytes)?;
        let mut changed_ids = self
            .writes
            .keys()
            .chain(self.removed.iter())
            .copied()
            .collect::<Vec<_>>();
        changed_ids.sort_unstable();
        debug_assert!(changed_ids.windows(2).all(|pair| pair[0] != pair[1]));
        let mut material_bytes = 0usize;
        for id in &changed_ids {
            material_bytes = material_bytes
                .checked_add(std::mem::size_of::<ChangedRecord>())
                .ok_or(TreeError::ResourceLimit)?;
            for node in [self.base.nodes.get(id), self.writes.get(id)]
                .into_iter()
                .flatten()
            {
                material_bytes = material_bytes
                    .checked_add(node.copy_cost)
                    .ok_or(TreeError::ResourceLimit)?;
            }
            self.copy_room(
                material_bytes
                    .checked_add(id_bytes)
                    .ok_or(TreeError::ResourceLimit)?,
            )?;
        }
        let records = changed_ids
            .iter()
            .map(|id| ChangedRecord {
                id: *id,
                before: self.base.nodes.get(id).cloned(),
                after: self.writes.get(id).cloned(),
            })
            .collect();
        if changed_ids.is_empty() {
            self.steps.clear();
        }
        Ok(PreparedTreePatch {
            allocation: PhantomData,
            key: self.base.key,
            writes: self.writes,
            removed: self.removed,
            steps: self.steps,
            changed_ids,
            material: CommitMaterial {
                records,
                estimated_bytes: material_bytes,
            },
            prepared_copy_bytes: self.prepared_copy_bytes + material_bytes + id_bytes,
        })
    }
}

#[cfg(test)]
mod transaction_kernel_tests {
    use super::*;
    fn leaf(value: &str) -> Node {
        Node {
            type_id: "org.example/text".into(),
            primitive: Primitive::Text,
            attributes: Attributes::new(),
            marks: vec![],
            text: Some(value.into()),
            children: vec![],
        }
    }
    fn paragraph(value: &str) -> Node {
        Node {
            type_id: "org.example/paragraph".into(),
            primitive: Primitive::TextBlock,
            attributes: Attributes::new(),
            marks: vec![],
            text: None,
            children: vec![leaf(value)],
        }
    }
    fn tree() -> AddressTree {
        AddressTree::from_document(
            SessionKey::allocate().unwrap(),
            Document {
                children: vec![paragraph("abcdef"), paragraph("last")],
            },
        )
        .unwrap()
    }
    fn ids(tree: &AddressTree) -> (NodeId, NodeId, NodeId) {
        let root = tree.root();
        let parent = tree.node(root).unwrap().children[0];
        (root, parent, tree.node(parent).unwrap().children[0])
    }
    fn strong() -> Vec<Mark> {
        vec![Mark {
            type_id: "org.example/strong".into(),
            attributes: Attributes::new(),
        }]
    }

    #[test]
    fn borrowed_change_detection_agrees_with_prepared_patch_for_each_net_noop() {
        for case in ["replace", "move", "split-join"] {
            let base = tree();
            let (root, parent, leaf) = ids(&base);
            let mut draft = base.prepare();
            assert!(!draft.has_changes());
            match case {
                "replace" => {
                    draft
                        .replace_text(leaf, Utf16Offset::new(0), Utf16Offset::new(1), "A")
                        .unwrap();
                    assert!(draft.has_changes());
                    draft
                        .replace_text(leaf, Utf16Offset::new(0), Utf16Offset::new(1), "a")
                        .unwrap();
                }
                "move" => {
                    draft.move_node(parent, root, 2).unwrap();
                    assert!(draft.has_changes());
                    draft.move_node(parent, root, 0).unwrap();
                }
                "split-join" => {
                    let right = draft.split_text(leaf, Utf16Offset::new(2)).unwrap();
                    assert!(draft.has_changes());
                    draft.join_text(leaf, right).unwrap();
                }
                _ => unreachable!(),
            }
            assert!(!draft.has_changes(), "net-noop {case}");
            assert!(!draft.prepare_patch().unwrap().changed());
            let mut changed = base.prepare();
            changed
                .replace_text(leaf, Utf16Offset::new(0), Utf16Offset::new(1), "A")
                .unwrap();
            assert!(changed.has_changes());
            assert!(changed.prepare_patch().unwrap().changed());
            let mut removed = base.prepare();
            removed.detach(parent).unwrap();
            assert!(removed.has_changes());
            assert!(removed.prepare_patch().unwrap().changed());
        }
    }

    #[test]
    fn final_structure_gate_checks_transforms_parent_links_and_scan_budget() {
        use editor_core::transaction::WorkLimits;
        let base = tree();
        let (_, parent, leaf) = ids(&base);
        let mut draft = base.prepare();
        let meter = || WorkMeter::new(WorkLimits::default());
        draft.validate_structure(&mut meter()).unwrap();
        apply(
            &mut draft,
            Operation::Transform {
                node: parent,
                type_id: "org.example/container".into(),
                primitive: Primitive::Container,
            },
        );
        assert_eq!(
            draft.validate_structure(&mut meter()),
            Err(TreeError::InvalidStructure)
        );
        apply(
            &mut draft,
            Operation::Transform {
                node: parent,
                type_id: "org.example/paragraph".into(),
                primitive: Primitive::TextBlock,
            },
        );
        draft.validate_structure(&mut meter()).unwrap();
        apply(
            &mut draft,
            Operation::SetMarks {
                leaf,
                marks: strong(),
            },
        );
        apply(
            &mut draft,
            Operation::Transform {
                node: leaf,
                type_id: "org.example/atom".into(),
                primitive: Primitive::InlineAtom,
            },
        );
        assert_eq!(
            draft.validate_structure(&mut meter()),
            Err(TreeError::InvalidStructure)
        );
        let mut malformed = base.prepare();
        let mut changed = malformed.node(leaf).unwrap().clone();
        changed.parent = Some(malformed.root());
        malformed.writes.insert(leaf, changed);
        assert_eq!(
            malformed.validate_structure(&mut meter()),
            Err(TreeError::InvalidStructure)
        );
        let pristine = base.prepare();
        let mut zero = WorkMeter::new(WorkLimits { units: 0, bytes: 0 });
        assert_eq!(
            pristine.validate_structure(&mut zero),
            Err(TreeError::ResourceLimit)
        );
        assert_eq!(zero.usage().units, 0);
        let mut wide = WorkMeter::new(WorkLimits { units: 1, bytes: 0 });
        assert_eq!(
            pristine.validate_structure(&mut wide),
            Err(TreeError::ResourceLimit)
        );
        assert_eq!(
            wide.usage().units,
            1,
            "child width refused before descending"
        );
    }
    fn apply(d: &mut TreeDraft<'_>, op: Operation<NodeId>) -> Vec<NodeId> {
        d.apply_operation(&op, EditOrigin::User).unwrap()
    }

    #[test]
    fn borrowed_candidate_view_excludes_synthetic_root_and_keeps_parent_identity() {
        let base = tree();
        let (root, parent, text) = ids(&base);
        assert!(CandidateRead::node(&base, root).is_none());
        assert_eq!(
            CandidateRead::roots(&base),
            base.node(root).unwrap().children()
        );
        let mut d = base.prepare();
        apply(
            &mut d,
            Operation::SetAttribute {
                node: parent,
                key: "level".into(),
                value: Some(Attribute::Number(2.into())),
            },
        );
        let borrowed = CandidateRead::node(&d, parent).unwrap();
        assert_eq!(borrowed.parent, root);
        assert_eq!(borrowed.children, &[text]);
        assert_eq!(borrowed.attributes["level"], Attribute::Number(2.into()));
        assert!(CandidateRead::node(&d, root).is_none());
        let foreign = tree();
        assert!(CandidateRead::node(&d, foreign.root()).is_none());
        assert!(base.node(parent).unwrap().attributes().unwrap().is_empty());
    }

    #[test]
    fn full_operation_algebra_builds_sparse_patch_and_owned_before_after_material() {
        let mut base = tree();
        let (root, parent, text) = ids(&base);
        let untouched = base.node(root).unwrap().children[1];
        let mut d = base.prepare();
        apply(
            &mut d,
            Operation::SetAttribute {
                node: parent,
                key: "level".into(),
                value: Some(Attribute::Number(2.into())),
            },
        );
        apply(
            &mut d,
            Operation::Transform {
                node: parent,
                type_id: "org.example/heading".into(),
                primitive: Primitive::TextBlock,
            },
        );
        apply(
            &mut d,
            Operation::SetMarks {
                leaf: text,
                marks: strong(),
            },
        );
        apply(
            &mut d,
            Operation::ReplaceText {
                leaf: text,
                from: Utf16Offset::new(0),
                to: Utf16Offset::new(1),
                inserted: "A".into(),
            },
        );
        let split = apply(
            &mut d,
            Operation::SplitText {
                leaf: text,
                at: Utf16Offset::new(3),
            },
        );
        assert_eq!(split.len(), 1);
        apply(
            &mut d,
            Operation::JoinText {
                left: text,
                right: split[0],
            },
        );
        let duplicate = apply(
            &mut d,
            Operation::Duplicate {
                node: parent,
                parent: root,
                index: 1,
            },
        )[0];
        let duplicate_text = d.node(duplicate).unwrap().children[0];
        assert_ne!(duplicate_text, text);
        assert_eq!(d.node(duplicate_text).unwrap().text(), Some("Abcdef"));
        assert_eq!(d.node(duplicate_text).unwrap().marks(), strong());
        let fragment = Document {
            children: vec![paragraph("one"), paragraph("two")],
        };
        let created = apply(
            &mut d,
            Operation::InsertFragment {
                parent: root,
                index: 2,
                fragment,
            },
        );
        assert_eq!(created.len(), 2);
        apply(
            &mut d,
            Operation::Move {
                node: duplicate,
                parent: root,
                before_index: 5,
            },
        );
        apply(&mut d, Operation::Remove { node: created[0] });
        assert_eq!(
            d.node(root).unwrap().children(),
            &[parent, created[1], untouched, duplicate]
        );
        let expected = d.candidate_document();
        let patch = d.prepare_patch().unwrap();
        assert!(patch.changed());
        assert!(!patch.steps().is_empty());
        assert!(!patch.changed_ids().contains(&untouched));
        assert!(patch.material_bytes() > 0);
        assert!(patch.prepared_copy_bytes() > patch.material_bytes());
        assert_eq!(base.node(text).unwrap().text(), Some("abcdef"));
        let bytes = patch.material_bytes();
        let count = patch.changed_ids().len();
        let material = base.publish(patch);
        assert_eq!(base.document(), expected);
        assert_eq!(material.estimated_bytes(), bytes);
        assert_eq!(material.changed_count(), count);
        assert!(material.before_count() < material.after_count());
        let record = material.records.iter().find(|r| r.id == text).unwrap();
        assert_eq!(record.before.as_ref().unwrap().text(), Some("abcdef"));
        assert_eq!(record.after.as_ref().unwrap().text(), Some("Abcdef"));
        assert!(material.records.iter().all(|r| r.id != split[0]));
    }

    #[test]
    fn net_noop_restores_cache_and_ignores_retired_transient_ids_and_all_maps() {
        let mut base = tree();
        let original = base.document();
        let (root, parent, text) = ids(&base);
        let mut d = base.prepare();
        apply(
            &mut d,
            Operation::SetAttribute {
                node: parent,
                key: "x".into(),
                value: Some(Attribute::Null),
            },
        );
        apply(
            &mut d,
            Operation::SetAttribute {
                node: parent,
                key: "x".into(),
                value: None,
            },
        );
        apply(
            &mut d,
            Operation::SetMarks {
                leaf: text,
                marks: strong(),
            },
        );
        apply(
            &mut d,
            Operation::SetMarks {
                leaf: text,
                marks: vec![],
            },
        );
        apply(
            &mut d,
            Operation::Transform {
                node: parent,
                type_id: "org.example/heading".into(),
                primitive: Primitive::TextBlock,
            },
        );
        apply(
            &mut d,
            Operation::Transform {
                node: parent,
                type_id: "org.example/paragraph".into(),
                primitive: Primitive::TextBlock,
            },
        );
        let right = apply(
            &mut d,
            Operation::SplitText {
                leaf: text,
                at: Utf16Offset::new(2),
            },
        )[0];
        apply(&mut d, Operation::JoinText { left: text, right });
        apply(
            &mut d,
            Operation::Move {
                node: parent,
                parent: root,
                before_index: 2,
            },
        );
        apply(
            &mut d,
            Operation::Move {
                node: parent,
                parent: root,
                before_index: 0,
            },
        );
        assert_eq!(
            d.node(parent).unwrap().copy_cost,
            base.node(parent).unwrap().copy_cost
        );
        let patch = d.prepare_patch().unwrap();
        assert!(!patch.changed());
        assert!(patch.steps().is_empty());
        assert!(patch.changed_ids().is_empty());
        assert_eq!(patch.material_bytes(), 0);
        assert_eq!(base.publish(patch).changed_count(), 0);
        assert_eq!(base.document(), original);
        assert!(!base.nodes.contains_key(&right));
    }

    #[test]
    fn repeated_metadata_commits_keep_copy_work_bounded_by_current_payload() {
        for case in ["attributes", "marks", "type"] {
            let mut base = tree();
            let original = base.document();
            let (_, parent, text) = ids(&base);
            let mut phase_costs = BTreeMap::new();
            for iteration in 0..600 {
                let phase = iteration % if case == "attributes" { 3 } else { 2 };
                let operation = match case {
                    "attributes" => Operation::SetAttribute {
                        node: parent,
                        key: "level".into(),
                        value: match phase {
                            0 => Some(Attribute::Number(1.into())),
                            1 => Some(Attribute::Number(2.into())),
                            _ => None,
                        },
                    },
                    "marks" => Operation::SetMarks {
                        leaf: text,
                        marks: if phase == 0 { strong() } else { Vec::new() },
                    },
                    "type" => Operation::Transform {
                        node: parent,
                        type_id: if phase == 0 {
                            "org.example/longer_heading"
                        } else {
                            "org.example/paragraph"
                        }
                        .into(),
                        primitive: Primitive::TextBlock,
                    },
                    _ => unreachable!(),
                };
                let mut draft = base.prepare();
                draft.tighten_copy_budget(32 * 1024);
                apply(&mut draft, operation);
                let patch = draft.prepare_patch().unwrap();
                assert!(patch.changed());
                let cost = patch.prepared_copy_bytes();
                assert!(cost <= 32 * 1024);
                if let Some(expected) = phase_costs.insert(phase, cost) {
                    assert_eq!(cost, expected, "{case} phase {phase}, commit {iteration}");
                }
                base.publish(patch);

                // The same semantic document admitted afresh has the same
                // record size, independently of how many edits produced it.
                let fresh =
                    AddressTree::from_document(SessionKey::allocate().unwrap(), base.document())
                        .unwrap();
                let (_, fresh_parent, fresh_text) = ids(&fresh);
                for (actual, expected) in [(parent, fresh_parent), (text, fresh_text)] {
                    assert_eq!(
                        base.node(actual).unwrap().copy_cost,
                        fresh.node(expected).unwrap().copy_cost,
                        "{case} commit {iteration}"
                    );
                }
            }
            assert_eq!(
                base.document(),
                original,
                "{case} returns to original payload"
            );
        }
    }

    #[test]
    fn whole_fragment_counter_reservation_and_preflight_fail_without_partial_write() {
        let base = tree();
        let (root, _, _) = ids(&base);
        let mut d = base.prepare();
        let snapshot = d.candidate_document();
        let next = base.next_id.get();
        let fragment = Document {
            children: vec![paragraph("new"), leaf("invalid-root-text")],
        };
        assert_eq!(
            d.apply_operation(
                &Operation::InsertFragment {
                    parent: root,
                    index: 0,
                    fragment
                },
                EditOrigin::User
            ),
            Err(TreeError::InvalidStructure)
        );
        assert_eq!(base.next_id.get(), next);
        assert_eq!(d.candidate_document(), snapshot);
        base.next_id.set(u64::MAX - 2);
        let fragment = Document {
            children: vec![paragraph("new"), paragraph("second")],
        };
        assert_eq!(
            d.apply_operation(
                &Operation::InsertFragment {
                    parent: root,
                    index: 0,
                    fragment
                },
                EditOrigin::User
            ),
            Err(TreeError::CounterExhausted)
        );
        assert_eq!(base.next_id.get(), u64::MAX - 2);
        assert_eq!(d.written_nodes(), 0);
        assert!(d.steps().is_empty());
        assert_eq!(d.candidate_document(), snapshot);
    }

    #[test]
    fn user_cluster_guards_and_trusted_normalization_scalar_interior_are_distinct() {
        let mut run = paragraph("e");
        let mut accent = leaf("\u{301}");
        accent.marks = strong();
        run.children.push(accent);
        let base = AddressTree::from_document(
            SessionKey::allocate().unwrap(),
            Document {
                children: vec![run],
            },
        )
        .unwrap();
        let (root, parent, first) = ids(&base);
        let second = base.node(parent).unwrap().children[1];
        let mut d = base.prepare();
        for op in [
            Operation::SetMarks {
                leaf: second,
                marks: vec![],
            },
            Operation::Remove { node: second },
            Operation::Move {
                node: first,
                parent,
                before_index: 2,
            },
            Operation::InsertFragment {
                parent,
                index: 1,
                fragment: Document {
                    children: vec![leaf("x")],
                },
            },
        ] {
            assert_eq!(
                d.apply_operation(&op, EditOrigin::User),
                Err(TreeError::Position(PositionError::NotGraphemeBoundary))
            );
        }
        assert_eq!(d.written_nodes(), 0);
        assert!(d.steps().is_empty());
        d.apply_operation(
            &Operation::ReplaceText {
                leaf: second,
                from: Utf16Offset::new(0),
                to: Utf16Offset::new(1),
                inserted: "".into(),
            },
            EditOrigin::Normalization,
        )
        .unwrap();
        assert_eq!(d.node(second).unwrap().text(), Some(""));
        assert_eq!(d.node(root).unwrap().children(), &[parent]);
        assert_eq!(base.node(second).unwrap().text(), Some("\u{301}"));
    }

    #[test]
    fn metadata_and_material_copy_budgets_refuse_before_mutation_or_publication() {
        let base = tree();
        let (_, parent, text) = ids(&base);
        let mut d = base.prepare();
        d.tighten_copy_budget(1);
        d.tighten_copy_budget(MAX_PREPARED_COPY_BYTES);
        assert_eq!(
            d.copy_budget, 1,
            "a host cannot loosen an earlier copy limit"
        );
        for op in [
            Operation::SetAttribute {
                node: parent,
                key: "x".into(),
                value: Some(Attribute::Null),
            },
            Operation::SetMarks {
                leaf: text,
                marks: strong(),
            },
            Operation::Duplicate {
                node: parent,
                parent: d.root(),
                index: 0,
            },
        ] {
            assert_eq!(
                d.apply_operation(&op, EditOrigin::User),
                Err(TreeError::ResourceLimit)
            );
        }
        assert_eq!(d.written_nodes(), 0);
        assert_eq!(d.prepared_copy_bytes(), 0);
        drop(d);
        let mut d = base.prepare();
        apply(
            &mut d,
            Operation::ReplaceText {
                leaf: text,
                from: Utf16Offset::new(0),
                to: Utf16Offset::new(1),
                inserted: "A".into(),
            },
        );
        d.tighten_copy_budget(d.prepared_copy_bytes());
        assert!(matches!(d.prepare_patch(), Err(TreeError::ResourceLimit)));
        assert_eq!(base.node(text).unwrap().text(), Some("abcdef"));
    }

    #[test]
    fn borrowed_payload_depth_refuses_and_transform_preserves_data_for_final_validation() {
        let base = tree();
        let (_, parent, text) = ids(&base);
        let mut d = base.prepare();
        let mut deep = Attribute::Null;
        for _ in 0..MAX_DEPTH + 1 {
            deep = Attribute::List(vec![deep]);
        }
        assert_eq!(
            d.apply_operation(
                &Operation::SetAttribute {
                    node: parent,
                    key: "x".into(),
                    value: Some(deep)
                },
                EditOrigin::User
            ),
            Err(TreeError::ResourceLimit)
        );
        assert_eq!(d.written_nodes(), 0);
        apply(
            &mut d,
            Operation::Transform {
                node: parent,
                type_id: "org.example/container".into(),
                primitive: Primitive::Container,
            },
        );
        assert_eq!(d.node(parent).unwrap().children(), &[text]);
        assert_eq!(d.node(text).unwrap().text(), Some("abcdef"));
        assert_eq!(
            d.node(parent).unwrap().primitive(),
            Some(Primitive::Container)
        );
        // This deliberately invalid profile shape has no publication authority;
        // Session's final profile validation must refuse it.
        assert_eq!(
            base.node(parent).unwrap().primitive(),
            Some(Primitive::TextBlock)
        );
        assert!(matches!(
            d.apply_operation(
                &Operation::Duplicate {
                    node: d.root(),
                    parent: d.root(),
                    index: 0
                },
                EditOrigin::User
            ),
            Err(TreeError::RootMutation)
        ));
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
