// SPDX-License-Identifier: MIT OR Apache-2.0
//! Sparse topology proofs. Semantic records and retained history never contain
//! revision stamps or cached aggregates.
use super::*;
use editor_core::candidate::{CandidateChanges, DirtyNode};
use editor_core::transaction::WorkPhase;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct NodeMetrics {
    pub authored_nodes: usize,
    pub text_utf8: usize,
    pub text_utf16: usize,
    pub height: usize,
}
#[derive(Debug, Clone, Copy)]
pub(super) struct NodeMeta {
    ordinal: Option<usize>,
    metrics: NodeMetrics,
    changed_revision: u64,
}
#[derive(Debug, Default)]
pub(super) struct PreparedTopology {
    pub(super) stamp: u64,
    direct: Vec<NodeId>,
    forest: Vec<DirtyNode<NodeId>>,
    roots_changed: bool,
    metadata: BTreeMap<NodeId, NodeMeta>,
    removed: Vec<NodeId>,
    height_remove: Vec<(NodeId, usize, NodeId)>,
    height_add: Vec<(NodeId, usize, NodeId)>,
    allocated_bytes: usize,
}
impl PreparedTopology {
    pub(super) fn copy_bound(&self) -> usize {
        // Reversing a deletion additionally creates final metadata/height
        // entries. Each identity already paid for direct/forest/old-side maps;
        // three envelopes cover those reverse-only entries and vector slack.
        self.allocated_bytes.saturating_mul(3)
    }
}

/// Every temporary/staged allocation is charged before insertion. BTree node
/// bookkeeping is conservatively included, including temporary forest edges.
fn reserve(
    work: &mut WorkMeter,
    bytes: &mut usize,
    room: usize,
    amount: usize,
) -> Result<(), TreeError> {
    let next = bytes.checked_add(amount).ok_or(TreeError::ResourceLimit)?;
    if next > room {
        return Err(TreeError::ResourceLimit);
    }
    work.charge_bytes(amount as u64)
        .map_err(|_| TreeError::ResourceLimit)?;
    work.note_phase(WorkPhase::Impact, 0, amount as u64);
    *bytes = next;
    Ok(())
}
fn visit(work: &mut WorkMeter, count: usize, phase: WorkPhase) -> Result<(), TreeError> {
    work.charge_units(count as u64)
        .map_err(|_| TreeError::ResourceLimit)?;
    work.note_phase(phase, count as u64, 0);
    Ok(())
}
fn own_metrics(node: &TreeNode, work: &mut WorkMeter) -> Result<NodeMetrics, TreeError> {
    let text = node.text().unwrap_or("");
    work.charge_bytes(text.len() as u64)
        .map_err(|_| TreeError::ResourceLimit)?;
    work.note_phase(WorkPhase::Structure, 0, text.len() as u64);
    Ok(NodeMetrics {
        authored_nodes: usize::from(node.data.is_some()),
        text_utf8: text.len(),
        text_utf16: text.encode_utf16().count(),
        height: usize::from(node.data.is_some()),
    })
}
fn add_count(value: usize, minus: usize, plus: usize) -> Result<usize, TreeError> {
    value
        .checked_sub(minus)
        .and_then(|n| n.checked_add(plus))
        .ok_or(TreeError::InvalidStructure)
}

impl AddressTree {
    pub(super) fn initialize_topology(&mut self) -> Result<(), TreeError> {
        fn walk(
            tree: &mut AddressTree,
            id: NodeId,
            ordinal: Option<usize>,
        ) -> Result<NodeMetrics, TreeError> {
            let node = &tree.nodes[&id];
            let text = node.text().unwrap_or("");
            let mut metrics = NodeMetrics {
                authored_nodes: usize::from(node.data.is_some()),
                text_utf8: text.len(),
                text_utf16: text.encode_utf16().count(),
                height: usize::from(node.data.is_some()),
            };
            // Admission is the sole full topology build; its input was preflighted.
            let children = node.children.clone();
            let mut heights = BTreeSet::new();
            let mut tallest = 0;
            for (index, child) in children.into_iter().enumerate() {
                let child_metrics = walk(tree, child, Some(index))?;
                metrics.authored_nodes = metrics
                    .authored_nodes
                    .checked_add(child_metrics.authored_nodes)
                    .ok_or(TreeError::ResourceLimit)?;
                metrics.text_utf8 = metrics
                    .text_utf8
                    .checked_add(child_metrics.text_utf8)
                    .ok_or(TreeError::ResourceLimit)?;
                metrics.text_utf16 = metrics
                    .text_utf16
                    .checked_add(child_metrics.text_utf16)
                    .ok_or(TreeError::ResourceLimit)?;
                tallest = tallest.max(child_metrics.height);
                heights.insert((child_metrics.height, child));
            }
            metrics.height += tallest;
            tree.metadata.insert(
                id,
                NodeMeta {
                    ordinal,
                    metrics,
                    changed_revision: 0,
                },
            );
            if !heights.is_empty() {
                tree.child_heights.insert(id, heights);
            }
            Ok(metrics)
        }
        // Admission may scan the complete tree once, but sidecar storage is
        // bounded independently of tiny authored node payloads.
        let storage = self
            .nodes
            .len()
            .checked_mul(std::mem::size_of::<NodeMeta>() + 384)
            .ok_or(TreeError::ResourceLimit)?;
        if storage > editor_core::transaction::WorkLimits::default().bytes as usize {
            return Err(TreeError::ResourceLimit);
        }
        walk(self, self.root, None)?;
        Ok(())
    }
    pub(super) fn publish_topology(&mut self, mut plan: PreparedTopology, revision: u64) {
        for (parent, height, child) in plan.height_remove {
            if let Some(index) = self.child_heights.get_mut(&parent) {
                index.remove(&(height, child));
            }
        }
        for id in plan.removed {
            self.metadata.remove(&id);
            self.child_heights.remove(&id);
        }
        for (parent, height, child) in plan.height_add {
            self.child_heights
                .entry(parent)
                .or_default()
                .insert((height, child));
        }
        for dirty in &plan.forest {
            if let Some(meta) = plan.metadata.get_mut(&dirty.id) {
                meta.changed_revision = revision;
            }
        }
        self.metadata.extend(plan.metadata);
    }
    pub(crate) fn changed_revision(&self, id: NodeId) -> Result<u64, TreeError> {
        self.node(id)?;
        self.metadata
            .get(&id)
            .map(|meta| meta.changed_revision)
            .ok_or(TreeError::InvalidStructure)
    }
    /// Cached scalar-coordinate total for an already borrowed Text leaf.
    pub(crate) fn cached_text_utf16(&self, id: NodeId) -> Result<usize, TreeError> {
        self.metadata
            .get(&id)
            .map(|m| m.metrics.text_utf16)
            .ok_or(TreeError::InvalidStructure)
    }
    /// Constant-width cached edge proof; never searches a sibling sequence.
    pub(crate) fn checked_ordinal(&self, id: NodeId) -> Result<(NodeId, usize), TreeError> {
        let parent = self.node(id)?.parent().ok_or(TreeError::RootMutation)?;
        let ordinal = self
            .metadata
            .get(&id)
            .and_then(|m| m.ordinal)
            .ok_or(TreeError::InvalidStructure)?;
        if self.node(parent)?.children().get(ordinal) != Some(&id) {
            return Err(TreeError::InvalidStructure);
        }
        Ok((parent, ordinal))
    }
    pub(crate) fn metrics(&self, id: NodeId) -> Result<NodeMetrics, TreeError> {
        self.node(id)?;
        self.metadata
            .get(&id)
            .map(|meta| meta.metrics)
            .ok_or(TreeError::InvalidStructure)
    }
    pub(crate) fn document_with_work(&self, work: &mut WorkMeter) -> Result<Document, TreeError> {
        fn walk(tree: &AddressTree, id: NodeId, work: &mut WorkMeter) -> Result<Node, TreeError> {
            let node = tree.node(id)?;
            visit(work, 1, WorkPhase::Export)?;
            let bytes = node
                .copy_cost
                .checked_add(
                    node.children
                        .len()
                        .checked_mul(std::mem::size_of::<Node>())
                        .ok_or(TreeError::ResourceLimit)?,
                )
                .ok_or(TreeError::ResourceLimit)?;
            work.charge_bytes(bytes as u64)
                .map_err(|_| TreeError::ResourceLimit)?;
            work.note_phase(WorkPhase::Export, 0, bytes as u64);
            let data = node.data.as_ref().ok_or(TreeError::RootMutation)?;
            let mut children = Vec::with_capacity(node.children.len());
            for child in &node.children {
                children.push(walk(tree, *child, work)?);
            }
            Ok(Node {
                type_id: data.type_id.clone(),
                primitive: data.primitive,
                attributes: data.attributes.clone(),
                marks: data.marks.clone(),
                text: data.text.as_ref().map(|text| text.0.clone()),
                children,
            })
        }
        let root_bytes =
            (self.nodes[&self.root].children.len() * std::mem::size_of::<Node>()) as u64;
        work.charge_bytes(root_bytes)
            .map_err(|_| TreeError::ResourceLimit)?;
        work.note_phase(WorkPhase::Export, 0, root_bytes);
        let mut children = Vec::with_capacity(self.nodes[&self.root].children.len());
        for id in &self.nodes[&self.root].children {
            children.push(walk(self, *id, work)?);
        }
        Ok(Document { children })
    }
}

pub(crate) struct DraftChanges<'a, 'b, A> {
    draft: &'a TreeDraft<'b, A>,
    plan: &'a PreparedTopology,
}
impl<A: Allocation> CandidateRead for DraftChanges<'_, '_, A> {
    type Id = NodeId;
    fn root(&self) -> NodeId {
        self.draft.base.root
    }
    fn roots(&self) -> &[NodeId] {
        CandidateRead::roots(self.draft)
    }
    fn node(&self, id: NodeId) -> Option<BorrowedNode<'_, NodeId>> {
        CandidateRead::node(self.draft, id)
    }
}
impl<A: Allocation> CandidateChanges for DraftChanges<'_, '_, A> {
    fn before_node(&self, id: NodeId) -> Option<BorrowedNode<'_, NodeId>> {
        self.draft.base.nodes.get(&id).and_then(borrowed)
    }
    fn before_roots(&self) -> &[NodeId] {
        &self.draft.base.nodes[&self.draft.base.root].children
    }
    fn direct_changes(&self) -> &[NodeId] {
        &self.plan.direct
    }
    fn dirty_forest(&self) -> &[DirtyNode<NodeId>] {
        &self.plan.forest
    }
    fn roots_changed(&self) -> bool {
        self.plan.roots_changed
    }
    fn mutation_stamp(&self) -> u64 {
        self.plan.stamp
    }
}

impl<A: Allocation> TreeDraft<'_, A> {
    pub(super) fn touch(&mut self) {
        // A frame consumes positive copy budget or a bounded map slot. No
        // request can approach u64::MAX successful frames.
        self.mutation_stamp = self
            .mutation_stamp
            .checked_add(1)
            .expect("bounded primitive frames");
    }
    pub(crate) fn changes(&self) -> Result<DraftChanges<'_, '_, A>, TreeError> {
        static EMPTY: PreparedTopology = PreparedTopology {
            stamp: 0,
            direct: Vec::new(),
            forest: Vec::new(),
            roots_changed: false,
            metadata: BTreeMap::new(),
            removed: Vec::new(),
            height_remove: Vec::new(),
            height_add: Vec::new(),
            allocated_bytes: 0,
        };
        let plan = if self.mutation_stamp == 0 && self.topology.is_none() {
            &EMPTY
        } else {
            self.topology
                .as_ref()
                .filter(|plan| plan.stamp == self.mutation_stamp)
                .ok_or(TreeError::InvalidStructure)?
        };
        Ok(DraftChanges { draft: self, plan })
    }
    pub(crate) fn prepare_changes(&mut self, work: &mut WorkMeter) -> Result<(), TreeError> {
        if self
            .topology
            .as_ref()
            .is_some_and(|plan| plan.stamp == self.mutation_stamp)
        {
            return Ok(());
        }
        let room = self.copy_budget.saturating_sub(self.prepared_copy_bytes);
        let mut bytes = 0;
        let mut direct = BTreeSet::new();
        let mut forest: BTreeMap<NodeId, DirtyNode<NodeId>> = BTreeMap::new();
        let mut ordinals = BTreeMap::new();
        // Comparing only sparse records includes their actual variable payload.
        for (id, new) in &self.writes {
            visit(work, 1, WorkPhase::Impact)?;
            let old = self.base.nodes.get(id);
            work.charge_bytes((new.copy_cost + old.map_or(0, |n| n.copy_cost)) as u64)
                .map_err(|_| TreeError::ResourceLimit)?;
            if old.is_some_and(|old| same_record(old, new)) {
                continue;
            }
            reserve(work, &mut bytes, room, 128)?;
            direct.insert(*id);
        }
        for id in &self.removed {
            visit(work, 1, WorkPhase::Impact)?;
            if self.base.nodes.contains_key(id) {
                reserve(work, &mut bytes, room, 128)?;
                direct.insert(*id);
            }
        }
        let roots_changed = direct.contains(&self.base.root);
        // Only directly changed child sequences need ordinal work. Ancestor-only
        // nodes retain their cached ordinal, regardless of sibling fanout.
        for id in &direct {
            if let Ok(node) = self.node(*id) {
                let old = self.base.nodes.get(id);
                if old.is_none_or(|old| old.children != node.children) {
                    visit(work, node.children.len(), WorkPhase::Structure)?;
                    for (ordinal, child) in node.children.iter().enumerate() {
                        if self
                            .base
                            .metadata
                            .get(child)
                            .is_none_or(|meta| meta.ordinal != Some(ordinal))
                            || self
                                .base
                                .nodes
                                .get(child)
                                .is_none_or(|old| old.parent != Some(*id))
                        {
                            reserve(work, &mut bytes, room, 128)?;
                            ordinals.insert(*child, ordinal);
                        }
                    }
                }
            }
        }
        let mut seen = BTreeSet::new();
        for id in &direct {
            for before in [true, false] {
                let mut cursor = *id;
                let mut depth = 0;
                loop {
                    visit(work, 1, WorkPhase::Impact)?;
                    if depth > MAX_DEPTH {
                        return Err(TreeError::Cycle);
                    }
                    reserve(work, &mut bytes, room, 128)?;
                    if !seen.insert((before, cursor)) {
                        break;
                    }
                    let old = self.base.nodes.get(&cursor);
                    let new = self.node(cursor).ok();
                    let parent = if before {
                        old.and_then(|n| n.parent)
                    } else {
                        new.and_then(|n| n.parent)
                    };
                    if let std::collections::btree_map::Entry::Vacant(entry) = forest.entry(cursor)
                    {
                        reserve(
                            work,
                            &mut bytes,
                            room,
                            std::mem::size_of::<DirtyNode<NodeId>>() + 128,
                        )?;
                        entry.insert(DirtyNode {
                            id: cursor,
                            direct: direct.contains(&cursor),
                            payload_changed: direct.contains(&cursor)
                                && old.map(|n| &n.data) != new.map(|n| &n.data),
                            children_changed: direct.contains(&cursor)
                                && old.map(|n| &n.children) != new.map(|n| &n.children),
                            before_parent: old.and_then(|n| n.parent),
                            after_parent: new.and_then(|n| n.parent),
                            before_ordinal: self.base.metadata.get(&cursor).and_then(|m| m.ordinal),
                            after_ordinal: if new.is_some() {
                                ordinals.get(&cursor).copied().or_else(|| {
                                    self.base.metadata.get(&cursor).and_then(|m| m.ordinal)
                                })
                            } else {
                                None
                            },
                            dirty_children: Vec::new(),
                        });
                    }
                    let Some(parent) = parent else {
                        break;
                    };
                    if let std::collections::btree_map::Entry::Vacant(entry) = forest.entry(parent)
                    {
                        let old = self.base.nodes.get(&parent);
                        let new = self.node(parent).ok();
                        reserve(
                            work,
                            &mut bytes,
                            room,
                            std::mem::size_of::<DirtyNode<NodeId>>() + 128,
                        )?;
                        entry.insert(DirtyNode {
                            id: parent,
                            direct: direct.contains(&parent),
                            payload_changed: direct.contains(&parent)
                                && old.map(|n| &n.data) != new.map(|n| &n.data),
                            children_changed: direct.contains(&parent)
                                && old.map(|n| &n.children) != new.map(|n| &n.children),
                            before_parent: old.and_then(|n| n.parent),
                            after_parent: new.and_then(|n| n.parent),
                            before_ordinal: self.base.metadata.get(&parent).and_then(|m| m.ordinal),
                            after_ordinal: if new.is_some() {
                                ordinals.get(&parent).copied().or_else(|| {
                                    self.base.metadata.get(&parent).and_then(|m| m.ordinal)
                                })
                            } else {
                                None
                            },
                            dirty_children: Vec::new(),
                        });
                    }
                    let edges = &mut forest
                        .get_mut(&parent)
                        .expect("inserted parent")
                        .dirty_children;
                    // Each side contributes at most one edge. Collect both
                    // without a growing linear contains scan; sort once below.
                    reserve(work, &mut bytes, room, 2 * std::mem::size_of::<NodeId>())?;
                    edges.push(cursor);
                    cursor = parent;
                    depth += 1;
                }
            }
        }
        for dirty in forest.values_mut() {
            let count = dirty.dirty_children.len();
            let comparisons = count
                .checked_mul((usize::BITS - count.max(1).leading_zeros()) as usize)
                .ok_or(TreeError::ResourceLimit)?;
            visit(work, comparisons, WorkPhase::Impact)?;
            dirty.dirty_children.sort_unstable();
            dirty.dirty_children.dedup();
        }
        let mut plan = PreparedTopology {
            stamp: self.mutation_stamp,
            roots_changed,
            ..PreparedTopology::default()
        };
        // Compute each final dirty node once from cached baseline child totals.
        // The recursive helper shares both the closed candidate and one
        // request's preallocation ledger; neither is reset per subtree.
        #[allow(clippy::too_many_arguments)]
        fn metrics<A: Allocation>(
            draft: &TreeDraft<'_, A>,
            id: NodeId,
            forest: &BTreeMap<NodeId, DirtyNode<NodeId>>,
            plan: &mut PreparedTopology,
            active: &mut BTreeSet<NodeId>,
            work: &mut WorkMeter,
            bytes: &mut usize,
            room: usize,
        ) -> Result<NodeMetrics, TreeError> {
            if let Some(meta) = plan.metadata.get(&id) {
                return Ok(meta.metrics);
            }
            reserve(work, bytes, room, 128)?;
            if !active.insert(id) {
                return Err(TreeError::Cycle);
            }
            visit(work, 1, WorkPhase::Structure)?;
            let node = draft.node(id)?;
            let dirty = forest.get(&id).ok_or(TreeError::InvalidStructure)?;
            let old = draft.base.nodes.get(&id);
            let oldmeta = draft.base.metadata.get(&id);
            let mut result = if let Some(meta) = oldmeta {
                meta.metrics
            } else {
                NodeMetrics::default()
            };
            if dirty.payload_changed || old.is_none() {
                let own = own_metrics(node, work)?;
                let oldown = if let Some(old) = old {
                    own_metrics(old, work)?
                } else {
                    NodeMetrics::default()
                };
                result.authored_nodes = add_count(
                    result.authored_nodes,
                    oldown.authored_nodes,
                    own.authored_nodes,
                )?;
                result.text_utf8 = add_count(result.text_utf8, oldown.text_utf8, own.text_utf8)?;
                result.text_utf16 =
                    add_count(result.text_utf16, oldown.text_utf16, own.text_utf16)?;
            }
            let mut tallest = 0;
            for child in &dirty.dirty_children {
                visit(work, 1, WorkPhase::Structure)?;
                let before = draft
                    .base
                    .nodes
                    .get(child)
                    .filter(|child| child.parent == Some(id))
                    .and_then(|child| draft.base.metadata.get(&child.id));
                let after = if draft
                    .node(*child)
                    .is_ok_and(|child| child.parent == Some(id))
                {
                    Some(metrics(
                        draft, *child, forest, plan, active, work, bytes, room,
                    )?)
                } else {
                    None
                };
                let a = before.map_or(NodeMetrics::default(), |m| m.metrics);
                let b = after.unwrap_or_default();
                result.authored_nodes =
                    add_count(result.authored_nodes, a.authored_nodes, b.authored_nodes)?;
                result.text_utf8 = add_count(result.text_utf8, a.text_utf8, b.text_utf8)?;
                result.text_utf16 = add_count(result.text_utf16, a.text_utf16, b.text_utf16)?;
                if before.map(|m| m.metrics.height) != after.map(|m| m.height) {
                    if before.is_some() {
                        reserve(
                            work,
                            bytes,
                            room,
                            2 * std::mem::size_of::<(NodeId, usize, NodeId)>(),
                        )?;
                        plan.height_remove.push((id, a.height, *child));
                    }
                    if after.is_some() {
                        reserve(
                            work,
                            bytes,
                            room,
                            2 * std::mem::size_of::<(NodeId, usize, NodeId)>(),
                        )?;
                        plan.height_add.push((id, b.height, *child));
                    }
                }
                if let Some(after) = after {
                    tallest = tallest.max(after.height);
                }
            }
            if let Some(index) = draft.base.child_heights.get(&id) {
                for (height, child) in index.iter().rev() {
                    visit(work, 1, WorkPhase::Structure)?;
                    if dirty.dirty_children.binary_search(child).is_err() {
                        tallest = tallest.max(*height);
                        break;
                    }
                }
            }
            result.height = usize::from(node.data.is_some())
                .checked_add(tallest)
                .ok_or(TreeError::ResourceLimit)?;
            if result.height > MAX_DEPTH {
                return Err(TreeError::InvalidStructure);
            }
            reserve(work, bytes, room, std::mem::size_of::<NodeMeta>() + 128)?;
            plan.metadata.insert(
                id,
                NodeMeta {
                    ordinal: dirty.after_ordinal,
                    metrics: result,
                    changed_revision: oldmeta.map_or(0, |m| m.changed_revision),
                },
            );
            active.remove(&id);
            Ok(result)
        }
        if forest.contains_key(&self.base.root) {
            metrics(
                self,
                self.base.root,
                &forest,
                &mut plan,
                &mut BTreeSet::new(),
                work,
                &mut bytes,
                room,
            )?;
        }
        // A current dirty record must be reachable from the synthetic root.
        // This also rejects an internally malformed disconnected parent cycle.
        for id in forest.keys() {
            if self.node(*id).is_ok() && !plan.metadata.contains_key(id) {
                return Err(TreeError::InvalidStructure);
            }
        }
        // Old-only nodes have no final metrics. Ordinal-only siblings are not
        // semantic upserts and retain their last changed revision.
        for (id, ordinal) in ordinals {
            if let Some(meta) = plan.metadata.get_mut(&id) {
                meta.ordinal = Some(ordinal);
            } else if let Some(meta) = self.base.metadata.get(&id) {
                reserve(
                    work,
                    &mut bytes,
                    room,
                    std::mem::size_of::<NodeMeta>() + 128,
                )?;
                plan.metadata.insert(
                    id,
                    NodeMeta {
                        ordinal: Some(ordinal),
                        ..*meta
                    },
                );
            }
        }
        for id in &direct {
            if self.node(*id).is_err() {
                reserve(work, &mut bytes, room, std::mem::size_of::<NodeId>())?;
                plan.removed.push(*id);
            }
        }
        reserve(
            work,
            &mut bytes,
            room,
            direct.len() * std::mem::size_of::<NodeId>()
                + forest.len() * std::mem::size_of::<DirtyNode<NodeId>>(),
        )?;
        plan.direct = direct
            .into_iter()
            .filter(|id| *id != self.base.root)
            .collect();
        plan.forest = forest.into_values().collect();
        self.prepared_copy_bytes += bytes;
        plan.allocated_bytes = bytes;
        self.topology = Some(plan);
        Ok(())
    }
    pub(super) fn validate_sparse_structure(&self, work: &mut WorkMeter) -> Result<(), TreeError> {
        visit(work, 1, WorkPhase::Structure)?;
        let plan = self
            .topology
            .as_ref()
            .filter(|plan| plan.stamp == self.mutation_stamp)
            .ok_or(TreeError::InvalidStructure)?;
        if plan
            .metadata
            .get(&self.base.root)
            .is_some_and(|meta| meta.metrics.height > MAX_DEPTH)
        {
            return Err(TreeError::InvalidStructure);
        }
        self.validate_sparse_records(work)
    }
    fn validate_sparse_records(&self, work: &mut WorkMeter) -> Result<(), TreeError> {
        for (id, node) in &self.writes {
            visit(work, 1, WorkPhase::Structure)?;
            if *id == self.base.root {
                if node.parent.is_some() || node.data.is_some() {
                    return Err(TreeError::InvalidStructure);
                }
            } else {
                let data = node.data.as_ref().ok_or(TreeError::InvalidStructure)?;
                if data.type_id.is_empty()
                    || (data.primitive == Primitive::Text) != data.text.is_some()
                    || (!matches!(data.primitive, Primitive::Container | Primitive::TextBlock)
                        && !node.children.is_empty())
                    || (data.primitive != Primitive::Text && !data.marks.is_empty())
                {
                    return Err(TreeError::InvalidStructure);
                }
                let parent = self.node(node.parent.ok_or(TreeError::InvalidStructure)?)?;
                if !allowed_child(parent.primitive(), data.primitive) {
                    return Err(TreeError::InvalidStructure);
                }
                // Parent sequence is scanned only when structurally changed;
                // otherwise ordinal is an admitted, unchanged edge proof.
                let old = self.base.nodes.get(id);
                if old.is_none_or(|old| old.parent != node.parent) {
                    visit(work, 1, WorkPhase::Structure)?;
                    let ordinal = self
                        .topology
                        .as_ref()
                        .and_then(|plan| plan.metadata.get(id))
                        .and_then(|meta| meta.ordinal)
                        .ok_or(TreeError::InvalidStructure)?;
                    if parent.children.get(ordinal) != Some(id) {
                        return Err(TreeError::InvalidStructure);
                    }
                }
            }
            let old = self.base.nodes.get(id);
            if old.is_none_or(|old| {
                old.children != node.children || old.primitive() != node.primitive()
            }) {
                visit(work, node.children.len(), WorkPhase::Structure)?;
                let mut seen = BTreeSet::new();
                work.charge_bytes((node.children.len() * 128) as u64)
                    .map_err(|_| TreeError::ResourceLimit)?;
                for child in &node.children {
                    let childnode = self.node(*child)?;
                    if !seen.insert(*child)
                        || childnode.parent != Some(*id)
                        || !allowed_child(
                            node.primitive(),
                            childnode.primitive().ok_or(TreeError::InvalidStructure)?,
                        )
                    {
                        return Err(TreeError::InvalidStructure);
                    }
                }
            }
        }
        Ok(())
    }
    pub(crate) fn prepare_impact(
        &mut self,
        work: &mut WorkMeter,
    ) -> Result<crate::events::ChangeImpact, TreeError> {
        self.prepare_changes(work)?;
        let plan = self.topology.as_ref().expect("prepared impact");
        let mut before = BTreeSet::new();
        let mut after = BTreeSet::new();
        let count = plan
            .forest
            .len()
            .checked_mul(2)
            .and_then(|n| n.checked_add(plan.direct.len()))
            .ok_or(TreeError::ResourceLimit)?;
        work.charge_bytes((count * 128) as u64)
            .map_err(|_| TreeError::ResourceLimit)?;
        let mut impact = crate::events::ChangeImpact {
            root_order_changed: plan.roots_changed,
            ..Default::default()
        };
        for id in &plan.direct {
            visit(work, 1, WorkPhase::Impact)?;
            if self.node(*id).is_ok() {
                impact.upserted.push(*id);
            } else {
                impact.removed.push(*id);
            }
        }
        for dirty in &plan.forest {
            visit(work, 1, WorkPhase::Impact)?;
            if let Some(parent) = dirty.before_parent {
                before.insert(parent);
            }
            if let Some(parent) = dirty.after_parent {
                after.insert(parent);
            }
        }
        if plan.roots_changed || !plan.direct.is_empty() {
            before.insert(self.base.root);
            after.insert(self.base.root);
        }
        impact.ancestors_before = before.into_iter().collect();
        impact.ancestors_after = after.into_iter().collect();
        Ok(impact)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn leaf(text: &str) -> Node {
        Node {
            type_id: "example.text".into(),
            primitive: Primitive::Text,
            attributes: Attributes::new(),
            marks: vec![],
            text: Some(text.into()),
            children: vec![],
        }
    }
    fn block(text: &str) -> Node {
        Node {
            type_id: "example.paragraph".into(),
            primitive: Primitive::TextBlock,
            attributes: Attributes::new(),
            marks: vec![],
            text: None,
            children: vec![leaf(text)],
        }
    }
    fn container(children: Vec<Node>) -> Node {
        Node {
            type_id: "example.container".into(),
            primitive: Primitive::Container,
            attributes: Attributes::new(),
            marks: vec![],
            text: None,
            children,
        }
    }
    fn tree(children: Vec<Node>) -> AddressTree {
        AddressTree::from_document(SessionKey::allocate().unwrap(), Document { children }).unwrap()
    }
    fn meter() -> WorkMeter {
        WorkMeter::new(editor_core::transaction::WorkLimits::default())
    }
    fn prepared<A: Allocation>(draft: &mut TreeDraft<'_, A>) -> WorkMeter {
        let mut work = meter();
        draft.prepare_changes(&mut work).unwrap();
        draft.validate_structure(&mut work).unwrap();
        work
    }
    #[test]
    fn text_edit_work_is_independent_of_unchanged_wide_ancestor_and_stamps_are_sparse() {
        let mut usages = vec![];
        for width in [2, 2048] {
            let mut base = tree(vec![container((0..width).map(|_| block("a")).collect())]);
            let root = base.root;
            let quote = base.nodes[&root].children[0];
            let paragraph = base.nodes[&quote].children[0];
            let sibling = base.nodes[&quote].children[1];
            let text = base.nodes[&paragraph].children[0];
            let before = base.metrics(root).unwrap();
            let mut draft = base.prepare();
            assert!(draft.changes().unwrap().dirty_forest().is_empty());
            draft
                .replace_text(text, Utf16Offset::new(0), Utf16Offset::new(1), "😀e\u{301}")
                .unwrap();
            assert!(
                draft.changes().is_err(),
                "a primitive invalidates borrowed proof"
            );
            let mut work = prepared(&mut draft);
            let changes = draft.changes().unwrap();
            assert_eq!(changes.direct_changes(), &[text]);
            assert_eq!(changes.dirty_forest().len(), 4);
            let ancestor = changes
                .dirty_forest()
                .iter()
                .find(|n| n.id == quote)
                .unwrap();
            assert!(!ancestor.direct);
            assert_eq!(ancestor.dirty_children, vec![paragraph]);
            assert_eq!(ancestor.after_ordinal, Some(0));
            let impact = draft.prepare_impact(&mut work).unwrap();
            assert_eq!(impact.upserted, vec![text]);
            assert!(impact.removed.is_empty());
            let mut ancestors = vec![root, quote, paragraph];
            ancestors.sort();
            assert_eq!(impact.ancestors_before, ancestors);
            assert_eq!(impact.ancestors_after, ancestors);
            let costs = work.usage();
            draft.prepare_changes(&mut work).unwrap();
            assert_eq!(work.usage(), costs, "prepared view reuses proof");
            let patch = draft.prepare_patch().unwrap();
            base.publish(patch, 7);
            let after = base.metrics(root).unwrap();
            assert_eq!(after.authored_nodes, before.authored_nodes);
            assert_eq!(after.text_utf8, before.text_utf8 + 6);
            assert_eq!(after.text_utf16, before.text_utf16 + 3);
            assert_eq!(after.height, 3);
            for id in [root, quote, paragraph, text] {
                assert_eq!(base.changed_revision(id).unwrap(), 7);
            }
            assert_eq!(base.changed_revision(sibling).unwrap(), 0);
            usages.push(costs);
        }
        assert_eq!(
            usages[0], usages[1],
            "no sibling sequence scan/copy for a local text payload"
        );
    }
    #[test]
    fn unique_tallest_removal_move_and_root_order_keep_exact_metrics_and_ordinals() {
        let mut base = tree(vec![
            container(vec![container(vec![block("😀")]), block("a")]),
            container(vec![block("z")]),
        ]);
        let root = base.root;
        let left = base.nodes[&root].children[0];
        let right = base.nodes[&root].children[1];
        let tall = base.nodes[&left].children[0];
        let short = base.nodes[&left].children[1];
        assert_eq!(
            base.metrics(root).unwrap(),
            NodeMetrics {
                authored_nodes: 9,
                text_utf8: 6,
                text_utf16: 4,
                height: 4
            }
        );
        let mut draft = base.prepare();
        draft.move_node(tall, right, 1).unwrap();
        prepared(&mut draft);
        let impact = draft.prepare_impact(&mut meter()).unwrap();
        assert_eq!(
            impact.upserted.iter().copied().collect::<BTreeSet<_>>(),
            [left, right, tall].into_iter().collect()
        );
        assert_eq!(
            draft
                .changes()
                .unwrap()
                .dirty_forest()
                .iter()
                .find(|d| d.id == tall)
                .unwrap()
                .after_ordinal,
            Some(1)
        );
        base.publish(draft.prepare_patch().unwrap(), 1);
        assert_eq!(base.metrics(left).unwrap().height, 3);
        assert_eq!(base.metrics(right).unwrap().height, 4);
        assert_eq!(base.metrics(root).unwrap().height, 4);
        assert_eq!(base.metadata[&short].ordinal, Some(0));
        assert_eq!(base.changed_revision(short).unwrap(), 0);
        let mut draft = base.prepare();
        draft.detach(tall).unwrap();
        prepared(&mut draft);
        let impact = draft.prepare_impact(&mut meter()).unwrap();
        assert_eq!(impact.removed.len(), 3);
        assert!(!impact.root_order_changed);
        base.publish(draft.prepare_patch().unwrap(), 2);
        assert_eq!(
            base.metrics(root).unwrap(),
            NodeMetrics {
                authored_nodes: 6,
                text_utf8: 2,
                text_utf16: 2,
                height: 3
            }
        );
        assert!(base.changed_revision(tall).is_err());
        let mut draft = base.prepare();
        draft.move_node(left, root, 2).unwrap();
        prepared(&mut draft);
        let changes = draft.changes().unwrap();
        assert!(changes.roots_changed());
        assert!(!changes.direct_changes().contains(&root));
        let dirtyroot = changes
            .dirty_forest()
            .iter()
            .find(|d| d.id == root)
            .unwrap();
        assert!(dirtyroot.direct && dirtyroot.children_changed);
        assert!(!dirtyroot.payload_changed);
        base.publish(draft.prepare_patch().unwrap(), 3);
        assert_eq!(base.metadata[&left].ordinal, Some(1));
        assert_eq!(base.metadata[&right].ordinal, Some(0));
    }
    #[test]
    fn depth_guard_uses_reused_subtree_height_and_failed_preparation_does_not_publish() {
        let mut nested = block("x");
        for _ in 0..125 {
            nested = container(vec![nested]);
        }
        let base = tree(vec![nested, container(vec![block("y")])]);
        let root = base.root;
        let tall = base.nodes[&root].children[0];
        let destination = base.nodes[&base.nodes[&root].children[1]].children[0];
        // A new container chain of depth 127 is valid at root, but not below
        // another authored container. Move an admitted subtree without scanning it.
        let mut draft = base.prepare();
        draft
            .move_node(tall, base.nodes[&root].children[1], 1)
            .unwrap();
        prepared(&mut draft);
        assert_eq!(
            draft.topology.as_ref().unwrap().metadata[&root]
                .metrics
                .height,
            128
        );
        let mut draft = base.prepare();
        // Transform the destination paragraph into a container temporarily,
        // empty it, then move the tall subtree one level deeper.
        let text = base.nodes[&destination].children[0];
        draft.detach(text).unwrap();
        draft
            .apply_operation(
                &Operation::Transform {
                    node: destination,
                    type_id: "example.container".into(),
                    primitive: Primitive::Container,
                },
                EditOrigin::Normalization,
            )
            .unwrap();
        assert_eq!(
            draft.move_node(tall, destination, 0),
            Err(TreeError::ResourceLimit)
        );
        // The closed primitive rejects depth before any parent mutation.
        prepared(&mut draft);
        assert_eq!(base.metrics(root).unwrap().height, 127);
        assert_eq!(base.changed_revision(root).unwrap(), 0);
    }
    #[test]
    fn whole_document_removal_retains_root_in_both_ancestry_closures() {
        let mut base = tree(vec![container(vec![block("x")])]);
        let root = base.root;
        let q = base.nodes[&root].children[0];
        let p = base.nodes[&q].children[0];
        let t = base.nodes[&p].children[0];
        let mut draft = base.prepare();
        draft.detach(q).unwrap();
        prepared(&mut draft);
        let impact = draft.prepare_impact(&mut meter()).unwrap();
        assert_eq!(impact.upserted, vec![]);
        assert_eq!(impact.removed, vec![q, p, t]);
        assert_eq!(impact.ancestors_before, vec![root, q, p]);
        assert_eq!(impact.ancestors_after, vec![root]);
        assert!(impact.root_order_changed);
        base.publish(draft.prepare_patch().unwrap(), 1);
        assert_eq!(base.metrics(root).unwrap(), NodeMetrics::default());
        assert_eq!(base.changed_revision(root).unwrap(), 1);
    }
    #[test]
    fn net_noop_has_empty_forest_and_export_counts_actual_authored_nodes() {
        let base = tree(vec![block("a\u{a0}e\u{301}")]);
        let root = base.root;
        let block = base.nodes[&root].children[0];
        let leaf = base.nodes[&block].children[0];
        let mut draft = base.prepare();
        draft
            .replace_text(leaf, Utf16Offset::new(0), Utf16Offset::new(1), "b")
            .unwrap();
        draft
            .replace_text(leaf, Utf16Offset::new(0), Utf16Offset::new(1), "a")
            .unwrap();
        prepared(&mut draft);
        assert!(draft.changes().unwrap().dirty_forest().is_empty());
        assert_eq!(
            draft.prepare_impact(&mut meter()).unwrap(),
            crate::events::ChangeImpact::default()
        );
        assert!(!draft.prepare_patch().unwrap().changed());
        let mut work = meter();
        assert_eq!(base.document_with_work(&mut work).unwrap(), base.document());
        assert_eq!(work.trace().phase(WorkPhase::Export).visits, 2);
        let mut zero = WorkMeter::new(editor_core::transaction::WorkLimits { units: 0, bytes: 0 });
        assert_eq!(
            base.document_with_work(&mut zero),
            Err(TreeError::ResourceLimit)
        );
    }
}
