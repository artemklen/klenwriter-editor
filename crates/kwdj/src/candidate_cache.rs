// SPDX-License-Identifier: MIT OR Apache-2.0
//! Owned static proofs and sparse preparation. External identity answers are
//! deliberately absent from retained state.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use editor_core::admission::PreflightUsage;
use editor_core::cache::{CacheUpdate, CandidateCache, PreparedValidation};
use editor_core::candidate::{CandidateChanges, CandidateRead, DirtyNode};
use editor_core::transaction::{ValidationStats, WorkMeter, WorkPhase};
use uuid::Uuid;

use crate::model::{Mark, Node, Profile};
use crate::validate::{IdentityKind, validate_identity};
use crate::wire_view::ValidationView;
use crate::{
    AdmissionBudget, IdentityResolver, IdentityResolverError, IdentityStatus, KwdjError,
    KwdjErrorCode, Limits, index_path, key_path,
};

fn invalid() -> KwdjError {
    KwdjError::new(KwdjErrorCode::InvalidStructure, "")
}
fn is_budget(error: &KwdjError) -> bool {
    error.code == KwdjErrorCode::OperationalBudgetExceeded
}
fn plus(a: u64, b: u64) -> Result<u64, KwdjError> {
    a.checked_add(b).ok_or_else(invalid)
}
fn minus(a: u64, b: u64) -> Result<u64, KwdjError> {
    a.checked_sub(b).ok_or_else(invalid)
}
fn charge(work: &mut WorkMeter, units: usize, bytes: usize) -> Result<(), KwdjError> {
    work.charge_units(units as u64)
        .map_err(KwdjError::operational)?;
    work.charge_bytes(bytes as u64)
        .map_err(KwdjError::operational)
}

fn sorting(work: &mut WorkMeter, length: usize, width: usize) -> Result<(), KwdjError> {
    let comparisons = length
        .saturating_mul((length.saturating_add(1).ilog2() as usize).saturating_add(1))
        .saturating_mul(width);
    charge(work, comparisons, 0)
}
fn child_path(path: &str, index: usize, work: &mut WorkMeter) -> Result<String, KwdjError> {
    charge(work, 1, path.len().saturating_mul(2).saturating_add(128))?;
    Ok(index_path(&key_path(path, "content"), index))
}

#[derive(Clone, Copy, Default)]
struct Sum {
    nodes: u64,
    wire: u64,
    payload: u64,
    values: u64,
}
impl Sum {
    fn add(&mut self, other: Self) -> Result<(), KwdjError> {
        self.nodes = plus(self.nodes, other.nodes)?;
        self.wire = plus(self.wire, other.wire)?;
        self.payload = plus(self.payload, other.payload)?;
        self.values = plus(self.values, other.values)?;
        Ok(())
    }
    fn sub(&mut self, other: Self) -> Result<(), KwdjError> {
        self.nodes = minus(self.nodes, other.nodes)?;
        self.wire = minus(self.wire, other.wire)?;
        self.payload = minus(self.payload, other.payload)?;
        self.values = minus(self.values, other.values)?;
        Ok(())
    }
}
#[derive(Clone, Copy, Default)]
struct Aggregate {
    sum: Sum,
    height: u64,
    metadata_height: u64,
}
#[derive(Clone)]
struct Memo<I> {
    header: Option<Arc<Node>>,
    parent: Option<I>,
    ordinal: usize,
    own: PreflightUsage,
    own_wire: u64,
    children: usize,
    child_sum: Sum,
    heights: BTreeMap<u64, u64>,
    metadata_heights: BTreeMap<u64, u64>,
    aggregate: Aggregate,
}
impl<I> Memo<I> {
    fn refresh(&mut self) -> Result<(), KwdjError> {
        let root = self.header.is_none();
        let offset = u64::from(!root);
        self.aggregate = Aggregate {
            sum: Sum {
                nodes: plus(self.child_sum.nodes, offset)?,
                wire: plus(
                    plus(self.own_wire, self.child_sum.wire)?,
                    self.children.saturating_sub(1) as u64,
                )?,
                payload: plus(self.own.payload_bytes, self.child_sum.payload)?,
                values: plus(self.own.values, self.child_sum.values)?,
            },
            height: plus(self.heights.last_key_value().map_or(0, |(n, _)| *n), offset)?,
            metadata_height: self.own.depth.max(plus(
                self.metadata_heights
                    .last_key_value()
                    .map_or(0, |(n, _)| *n),
                offset,
            )?),
        };
        Ok(())
    }
}

/// Session-owned KWDJ proof state. Fields and sparse restoration authority stay private.
pub struct KwdjCache<I: Copy + Eq + Ord> {
    root: Option<I>,
    context: Profile,
    nodes: BTreeMap<I, Memo<I>>,
    root_memo: Option<Memo<I>>,
    facts: BTreeSet<I>,
    limits: Limits,
    budget: AdmissionBudget,
}
impl<I: Copy + Eq + Ord> Default for KwdjCache<I> {
    fn default() -> Self {
        Self {
            root: None,
            context: Profile::Prose,
            nodes: BTreeMap::new(),
            root_memo: None,
            facts: BTreeSet::new(),
            limits: Limits::default(),
            budget: AdmissionBudget::default(),
        }
    }
}
pub struct KwdjCachePatch<I: Copy + Eq + Ord> {
    nodes: BTreeMap<I, Option<Memo<I>>>,
    root: Memo<I>,
}
impl<I: Copy + Eq + Ord> CandidateCache for KwdjCache<I> {
    type Patch = KwdjCachePatch<I>;
    fn publish(&mut self, patch: Self::Patch) {
        for (id, memo) in patch.nodes {
            match memo {
                Some(memo) => {
                    if has_facts(&memo) {
                        self.facts.insert(id);
                    } else {
                        self.facts.remove(&id);
                    }
                    self.nodes.insert(id, memo);
                }
                None => {
                    self.facts.remove(&id);
                    self.nodes.remove(&id);
                }
            }
        }
        self.root_memo = Some(patch.root);
    }
}
fn has_facts<I>(memo: &Memo<I>) -> bool {
    match memo.header.as_deref() {
        Some(Node::MediaImage { .. }) => true,
        Some(Node::Text {
            marks: Some(marks), ..
        }) => marks
            .iter()
            .any(|m| matches!(m, Mark::ReferenceLink { .. })),
        _ => false,
    }
}
fn hist(map: &mut BTreeMap<u64, u64>, value: u64, add: bool) -> Result<(), KwdjError> {
    if add {
        *map.entry(value).or_default() = plus(map.get(&value).copied().unwrap_or(0), 1)?;
    } else {
        let count = minus(*map.get(&value).ok_or_else(invalid)?, 1)?;
        if count == 0 {
            map.remove(&value);
        } else {
            map.insert(value, count);
        }
    }
    Ok(())
}
fn child(memo: &mut Memo<impl Copy>, value: Aggregate, add: bool) -> Result<(), KwdjError> {
    if add {
        memo.child_sum.add(value.sum)?;
    } else {
        memo.child_sum.sub(value.sum)?;
    }
    hist(&mut memo.heights, value.height, add)?;
    hist(&mut memo.metadata_heights, value.metadata_height, add)
}
fn blank<I>(
    header: Option<Arc<Node>>,
    parent: Option<I>,
    ordinal: usize,
    own: PreflightUsage,
    own_wire: u64,
    children: usize,
) -> Memo<I> {
    Memo {
        header,
        parent,
        ordinal,
        own,
        own_wire,
        children,
        child_sum: Sum::default(),
        heights: BTreeMap::new(),
        metadata_heights: BTreeMap::new(),
        aggregate: Aggregate::default(),
    }
}
fn clone_memo<I: Copy>(memo: &Memo<I>, work: &mut WorkMeter) -> Result<Memo<I>, KwdjError> {
    let entries = memo.heights.len() + memo.metadata_heights.len();
    charge(
        work,
        entries + 1,
        std::mem::size_of::<Memo<I>>() + entries * 128,
    )?;
    Ok(memo.clone())
}
fn read_memo<'a, I: Copy + Eq + Ord>(
    cache: &'a KwdjCache<I>,
    patch: &'a KwdjCachePatch<I>,
    id: I,
) -> Option<&'a Memo<I>> {
    patch
        .nodes
        .get(&id)
        .map_or_else(|| cache.nodes.get(&id), Option::as_ref)
}
fn header<V: CandidateRead>(
    view: &V,
    id: V::Id,
    path: &str,
    work: &mut WorkMeter,
    budget: AdmissionBudget,
) -> Result<(Arc<Node>, PreflightUsage, u64), KwdjError> {
    let node = view.node(id).ok_or_else(invalid)?;
    let own = crate::candidate_validate::precharge(node, budget.preflight, work)?;
    charge(
        work,
        1,
        (own.values as usize).saturating_mul(path.len().saturating_mul(2).saturating_add(128)),
    )?;
    work.note_phase(WorkPhase::Header, 1, 0);
    let header = Arc::new(crate::candidate_validate::strict_header(node, path)?);
    let wire = crate::wire_view::local_wire_length(&header, node.text, node.children.len(), work)?;
    Ok((header, own, wire))
}

pub(crate) fn seed<V: CandidateRead>(
    context: Profile,
    view: &V,
    limits: Limits,
    budget: AdmissionBudget,
    work: &mut WorkMeter,
) -> Result<KwdjCache<V::Id>, KwdjError> {
    let mut cache = KwdjCache {
        root: Some(view.root()),
        context,
        limits,
        budget,
        ..KwdjCache::default()
    };
    fn visit<V: CandidateRead>(
        context: &mut KwdjCache<V::Id>,
        view: &V,
        id: V::Id,
        location: (V::Id, usize),
        path: &str,
        depth: u64,
        work: &mut WorkMeter,
    ) -> Result<(), KwdjError> {
        if depth > 128 || id == view.root() || context.nodes.contains_key(&id) {
            return Err(invalid());
        }
        charge(work, 1, std::mem::size_of::<Memo<V::Id>>() + 128)?;
        let (typed, own, wire) = header(view, id, path, work, context.budget)?;
        let node = view.node(id).ok_or_else(invalid)?;
        let mut memo = blank(
            Some(typed),
            Some(location.0),
            location.1,
            own,
            wire,
            node.children.len(),
        );
        for (index, child_id) in node.children.iter().enumerate() {
            visit(
                context,
                view,
                *child_id,
                (id, index),
                &child_path(path, index, work)?,
                depth + 1,
                work,
            )?;
            charge(work, 1, 256)?;
            child(&mut memo, context.nodes[child_id].aggregate, true)?;
        }
        memo.refresh()?;
        if has_facts(&memo) {
            context.facts.insert(id);
        }
        context.nodes.insert(id, memo);
        work.note_phase(WorkPhase::CacheUpdate, 1, 0);
        Ok(())
    }
    let mut root = blank(
        None,
        None,
        0,
        PreflightUsage::default(),
        crate::wire_view::document_envelope_length(context, work)?,
        view.roots().len(),
    );
    for (index, id) in view.roots().iter().enumerate() {
        visit(
            &mut cache,
            view,
            *id,
            (view.root(), index),
            &child_path("", index, work)?,
            1,
            work,
        )?;
        charge(work, 1, 256)?;
        child(&mut root, cache.nodes[id].aggregate, true)?;
    }
    root.refresh()?;
    cache.root_memo = Some(root);
    Ok(cache)
}

impl<I: Copy + Eq + Ord> KwdjCache<I> {
    pub(crate) fn matches<V: CandidateRead<Id = I>>(
        &self,
        context: Profile,
        view: &V,
        limits: Limits,
        budget: AdmissionBudget,
    ) -> bool {
        self.root == Some(view.root())
            && self.context == context
            && self.limits == limits
            && self.budget == budget
            && self.root_memo.is_some()
    }
    fn path(
        &self,
        patch: Option<&KwdjCachePatch<I>>,
        id: I,
        work: &mut WorkMeter,
    ) -> Result<(Vec<usize>, String), KwdjError> {
        let root = self.root.ok_or_else(invalid)?;
        let mut cursor = id;
        let mut order = Vec::new();
        while cursor != root {
            charge(work, 1, std::mem::size_of::<usize>() * 2)?;
            if order.len() >= 128 {
                return Err(invalid());
            }
            let memo = match patch {
                Some(p) => read_memo(self, p, cursor),
                None => self.nodes.get(&cursor),
            }
            .ok_or_else(invalid)?;
            order.push(memo.ordinal);
            cursor = memo.parent.ok_or_else(invalid)?;
        }
        order.reverse();
        let mut path = String::new();
        for index in &order {
            path = child_path(&path, *index, work)?;
        }
        Ok((order, path))
    }
}

fn forest<I: Copy + Ord>(changes: &impl CandidateChanges<Id = I>, id: I) -> Option<&DirtyNode<I>> {
    changes
        .dirty_forest()
        .binary_search_by_key(&id, |n| n.id)
        .ok()
        .map(|n| &changes.dirty_forest()[n])
}
type Positions<I> = BTreeMap<I, (I, usize)>;
fn current_indices<V: CandidateChanges>(
    view: &V,
    cache: &KwdjCache<V::Id>,
    positions: Option<&Positions<V::Id>>,
    id: V::Id,
    work: &mut WorkMeter,
) -> Result<Vec<usize>, KwdjError> {
    let mut cursor = id;
    let mut indices = Vec::new();
    while cursor != view.root() {
        charge(work, 1, 16)?;
        if indices.len() >= 128 {
            return Err(invalid());
        }
        if let Some((parent, ordinal)) = positions.and_then(|p| p.get(&cursor)) {
            indices.push(*ordinal);
            cursor = *parent;
        } else if let Some(dirty) = forest(view, cursor) {
            indices.push(dirty.after_ordinal.ok_or_else(invalid)?);
            cursor = dirty.after_parent.ok_or_else(invalid)?;
        } else {
            let memo = cache.nodes.get(&cursor).ok_or_else(invalid)?;
            let parent = view
                .node(cursor)
                .map(|n| n.parent)
                .or(memo.parent)
                .ok_or_else(invalid)?;
            let ordinal = if forest(view, parent).is_some_and(|d| d.children_changed) {
                let children = if parent == view.root() {
                    view.roots()
                } else {
                    view.node(parent).ok_or_else(invalid)?.children
                };
                charge(work, children.len(), 0)?;
                children
                    .iter()
                    .position(|child| *child == cursor)
                    .ok_or_else(invalid)?
            } else {
                memo.ordinal
            };
            indices.push(ordinal);
            cursor = parent;
        }
    }
    indices.reverse();
    Ok(indices)
}
fn indices_path(indices: &[usize], work: &mut WorkMeter) -> Result<String, KwdjError> {
    let mut path = String::new();
    for index in indices {
        path = child_path(&path, *index, work)?;
    }
    Ok(path)
}
fn current_path<V: CandidateChanges>(
    view: &V,
    cache: &KwdjCache<V::Id>,
    id: V::Id,
    work: &mut WorkMeter,
) -> Result<String, KwdjError> {
    indices_path(&current_indices(view, cache, None, id, work)?, work)
}

fn prepare<V: CandidateChanges>(
    view: &V,
    cache: &KwdjCache<V::Id>,
    work: &mut WorkMeter,
) -> Result<KwdjCachePatch<V::Id>, KwdjError> {
    let mut ids = BTreeSet::new();
    let mut positions = BTreeMap::new();
    for dirty in view.dirty_forest() {
        charge(work, 1, std::mem::size_of::<Memo<V::Id>>() + 128)?;
        if dirty.id != view.root() {
            ids.insert(dirty.id);
        }
        if dirty.children_changed {
            let children = if dirty.id == view.root() {
                view.roots()
            } else {
                view.node(dirty.id).map_or(&[] as &[V::Id], |n| n.children)
            };
            for (ordinal, id) in children.iter().enumerate() {
                charge(work, 1, std::mem::size_of::<Memo<V::Id>>() + 128)?;
                ids.insert(*id);
                positions.insert(*id, (dirty.id, ordinal));
            }
        }
    }
    let mut ordered = Vec::new();
    for id in ids {
        if view.node(id).is_some() {
            let depth = current_indices(view, cache, Some(&positions), id, work)?.len();
            charge(work, 1, std::mem::size_of::<(usize, V::Id)>() * 2)?;
            ordered.push((depth, id));
        }
    }
    sorting(work, ordered.len(), 1)?;
    ordered.sort_unstable_by(|a, b| b.cmp(a));
    let mut patch = KwdjCachePatch {
        nodes: BTreeMap::new(),
        root: clone_memo(cache.root_memo.as_ref().ok_or_else(invalid)?, work)?,
    };
    for id in view.direct_changes() {
        if view.node(*id).is_none() {
            patch.nodes.insert(*id, None);
        }
    }
    for (_, id) in ordered {
        let node = view.node(id).ok_or_else(invalid)?;
        let dirty = forest(view, id);
        let old = cache.nodes.get(&id);
        let parent = positions
            .get(&id)
            .map(|p| p.0)
            .or_else(|| dirty.and_then(|d| d.after_parent))
            .or_else(|| old.and_then(|n| n.parent))
            .ok_or_else(invalid)?;
        let ordinal = positions
            .get(&id)
            .map(|p| p.1)
            .or_else(|| dirty.and_then(|d| d.after_ordinal))
            .or_else(|| old.map(|m| m.ordinal))
            .ok_or_else(invalid)?;
        let payload = old.is_none() || dirty.is_some_and(|d| d.payload_changed);
        let mut memo = if let Some(old) = old {
            clone_memo(old, work)?
        } else {
            blank(
                None,
                Some(parent),
                ordinal,
                PreflightUsage::default(),
                0,
                node.children.len(),
            )
        };
        memo.parent = Some(parent);
        memo.ordinal = ordinal;
        memo.children = node.children.len();
        if payload {
            let (h, p, w) = header(
                view,
                id,
                &indices_path(
                    &current_indices(view, cache, Some(&positions), id, work)?,
                    work,
                )?,
                work,
                cache.budget,
            )?;
            memo.header = Some(h);
            memo.own = p;
            memo.own_wire = w;
        } else {
            work.note_phase(WorkPhase::CacheReuse, 1, 0);
            if dirty.is_some_and(|d| d.children_changed) {
                memo.own_wire = crate::wire_view::local_wire_length(
                    memo.header.as_deref().ok_or_else(invalid)?,
                    node.text,
                    node.children.len(),
                    work,
                )?;
            }
        }
        if old.is_none() || dirty.is_some_and(|d| d.children_changed) {
            memo.child_sum = Sum::default();
            memo.heights.clear();
            memo.metadata_heights.clear();
            for id in node.children {
                charge(work, 1, 128)?;
                child(
                    &mut memo,
                    read_memo(cache, &patch, *id).ok_or_else(invalid)?.aggregate,
                    true,
                )?;
            }
        } else if let Some(dirty) = dirty {
            charge(
                work,
                dirty.dirty_children.len(),
                dirty.dirty_children.len() * 256,
            )?;
            for id in &dirty.dirty_children {
                let edge = forest(view, *id).ok_or_else(invalid)?;
                if edge.before_parent == Some(dirty.id) {
                    child(
                        &mut memo,
                        cache.nodes.get(id).ok_or_else(invalid)?.aggregate,
                        false,
                    )?;
                }
                if edge.after_parent == Some(dirty.id) {
                    child(
                        &mut memo,
                        read_memo(cache, &patch, *id).ok_or_else(invalid)?.aggregate,
                        true,
                    )?;
                }
            }
        }
        memo.refresh()?;
        patch.nodes.insert(id, Some(memo));
        work.note_phase(WorkPhase::CacheUpdate, 1, 0);
    }
    let root = &mut patch.root;
    root.children = view.roots().len();
    if view.roots_changed() {
        root.child_sum = Sum::default();
        root.heights.clear();
        root.metadata_heights.clear();
        for id in view.roots() {
            charge(work, 1, 128)?;
            let value = patch
                .nodes
                .get(id)
                .and_then(Option::as_ref)
                .or_else(|| cache.nodes.get(id))
                .ok_or_else(invalid)?
                .aggregate;
            child(root, value, true)?;
        }
    } else if let Some(dirty) = forest(view, view.root()) {
        charge(
            work,
            dirty.dirty_children.len(),
            dirty.dirty_children.len() * 256,
        )?;
        for id in &dirty.dirty_children {
            let edge = forest(view, *id).ok_or_else(invalid)?;
            if edge.before_parent == Some(view.root()) {
                child(
                    root,
                    cache.nodes.get(id).ok_or_else(invalid)?.aggregate,
                    false,
                )?;
            }
            if edge.after_parent == Some(view.root()) {
                let value = patch
                    .nodes
                    .get(id)
                    .and_then(Option::as_ref)
                    .or_else(|| cache.nodes.get(id))
                    .ok_or_else(invalid)?
                    .aggregate;
                child(root, value, true)?;
            }
        }
    }
    root.refresh()?;
    Ok(patch)
}

struct ScopedView<'a, V: CandidateChanges> {
    view: &'a V,
    cache: &'a KwdjCache<V::Id>,
    patch: &'a KwdjCachePatch<V::Id>,
    roots: Vec<usize>,
    children: BTreeMap<V::Id, Vec<usize>>,
    full: BTreeSet<V::Id>,
    tables: BTreeSet<V::Id>,
    verses: BTreeSet<V::Id>,
}
impl<'a, V: CandidateChanges> ScopedView<'a, V> {
    fn new(
        view: &'a V,
        cache: &'a KwdjCache<V::Id>,
        patch: &'a KwdjCachePatch<V::Id>,
        work: &mut WorkMeter,
    ) -> Result<Self, KwdjError> {
        charge(
            work,
            view.dirty_forest().len(),
            view.dirty_forest().len() * (std::mem::size_of::<V::Id>() * 16 + 256),
        )?;
        let mut result = Self {
            view,
            cache,
            patch,
            roots: Vec::new(),
            children: BTreeMap::new(),
            full: BTreeSet::new(),
            tables: BTreeSet::new(),
            verses: BTreeSet::new(),
        };
        for dirty in view.dirty_forest() {
            if dirty.id != view.root() && view.node(dirty.id).is_none() {
                continue;
            }
            let mut indices = Vec::new();
            for id in &dirty.dirty_children {
                charge(work, 1, std::mem::size_of::<usize>() * 2)?;
                let edge = forest(view, *id).ok_or_else(invalid)?;
                if edge.after_parent == Some(dirty.id) {
                    indices.push(edge.after_ordinal.ok_or_else(invalid)?);
                }
            }
            sorting(work, indices.len(), 1)?;
            indices.sort_unstable();
            if dirty.id == view.root() {
                result.roots = indices;
            } else {
                result.children.insert(dirty.id, indices);
            }
            if dirty.direct && dirty.id != view.root() {
                let before = view.before_node(dirty.id);
                let after = view.node(dirty.id);
                if before.map(|n| (n.type_id, n.parent)) != after.map(|n| (n.type_id, n.parent)) {
                    result.full.insert(dirty.id);
                }
                if dirty.children_changed
                    && after.is_some_and(|n| n.type_id == "org.klenwriter.kwdj/verse")
                {
                    result.verses.insert(dirty.id);
                }
                if before.map(|n| n.type_id) != after.map(|n| n.type_id)
                    && let Some(parent) = after.map(|n| n.parent)
                    && view
                        .node(parent)
                        .is_some_and(|n| n.type_id == "org.klenwriter.kwdj/verse")
                {
                    result.verses.insert(parent);
                }
                let geometry = |node: Option<editor_core::candidate::BorrowedNode<'_, V::Id>>| {
                    node.is_some_and(|n| {
                        matches!(n.type_id.rsplit('/').next(), Some("table" | "table_row"))
                            && dirty.children_changed
                            || matches!(
                                n.type_id.rsplit('/').next(),
                                Some("table_cell" | "table_header")
                            ) && dirty.payload_changed
                    })
                };
                if geometry(before) || geometry(after) {
                    let mut id = dirty.id;
                    for _ in 0..128 {
                        charge(work, 1, 0)?;
                        if let Some(m) = read_memo(cache, patch, id) {
                            if matches!(m.header.as_deref(), Some(Node::Table { .. })) {
                                result.tables.insert(id);
                                break;
                            }
                            if let Some(parent) = m.parent {
                                id = parent;
                                continue;
                            }
                        }
                        break;
                    }
                }
            }
        }
        let mut pending = Vec::new();
        for id in &result.full {
            charge(work, 1, std::mem::size_of::<V::Id>() * 2)?;
            pending.push(*id);
        }
        while let Some(id) = pending.pop() {
            let node = view.node(id).ok_or_else(invalid)?;
            for child in node.children {
                charge(work, 1, std::mem::size_of::<V::Id>() * 8 + 64)?;
                if result.full.insert(*child) {
                    pending.push(*child);
                }
            }
        }
        Ok(result)
    }
    fn full(&self, id: V::Id) -> bool {
        self.full.contains(&id)
    }
}
impl<V: CandidateChanges> ValidationView for ScopedView<'_, V> {
    type Handle = V::Id;
    fn roots_len(&self) -> usize {
        self.view.roots().len()
    }
    fn root(&self, index: usize) -> V::Id {
        self.view.roots()[index]
    }
    fn header(&self, id: V::Id) -> &Node {
        read_memo(self.cache, self.patch, id)
            .and_then(|m| m.header.as_deref())
            .expect("prepared memo")
    }
    fn text(&self, id: V::Id) -> Option<&str> {
        self.view.node(id).expect("stable candidate").text
    }
    fn children_len(&self, id: V::Id) -> usize {
        self.view.node(id).expect("stable candidate").children.len()
    }
    fn child(&self, id: V::Id, index: usize) -> V::Id {
        self.view.node(id).expect("stable candidate").children[index]
    }
    fn root_indices(&self) -> Option<&[usize]> {
        Some(&self.roots)
    }
    fn child_indices(&self, id: V::Id) -> Option<&[usize]> {
        if self.full(id) {
            None
        } else {
            Some(self.children.get(&id).map_or(&[], Vec::as_slice))
        }
    }
    fn known_nodes(&self) -> Option<u64> {
        Some(self.patch.root.aggregate.sum.nodes)
    }
    fn check_table(&self, id: V::Id) -> bool {
        self.full(id) || self.tables.contains(&id)
    }
    fn check_verse_structure(&self, id: V::Id) -> bool {
        self.full(id) || self.verses.contains(&id)
    }
    fn resolve_identities(&self) -> bool {
        false
    }
}

struct MemoResolver<'a> {
    inner: &'a dyn IdentityResolver,
    enabled: Cell<bool>,
    answers: RefCell<BTreeMap<(IdentityKind, Uuid), Result<IdentityStatus, IdentityResolverError>>>,
}
impl MemoResolver<'_> {
    fn lookup(
        &self,
        kind: IdentityKind,
        id: &Uuid,
    ) -> Result<IdentityStatus, IdentityResolverError> {
        let key = (kind, *id);
        if let Some(result) = self.answers.borrow().get(&key) {
            return *result;
        }
        let result = match kind {
            IdentityKind::Media => self.inner.resolve_media(id),
            IdentityKind::Reference => self.inner.resolve_reference(id),
        };
        if self.enabled.get() {
            self.answers.borrow_mut().insert(key, result);
        }
        result
    }
}
impl IdentityResolver for MemoResolver<'_> {
    fn resolve_media(&self, id: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        self.lookup(IdentityKind::Media, id)
    }
    fn resolve_reference(&self, id: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        self.lookup(IdentityKind::Reference, id)
    }
}

fn facts<I: Copy + Eq + Ord>(
    cache: &KwdjCache<I>,
    patch: &KwdjCachePatch<I>,
    resolver: &MemoResolver<'_>,
    work: &mut WorkMeter,
) -> Result<(), KwdjError> {
    let mut owners = BTreeSet::new();
    for id in &cache.facts {
        charge(work, 1, std::mem::size_of::<I>() * 4)?;
        if read_memo(cache, patch, *id).is_some_and(has_facts) {
            owners.insert(*id);
        }
    }
    for (id, memo) in &patch.nodes {
        if memo.as_ref().is_some_and(has_facts) {
            charge(work, 1, std::mem::size_of::<I>() * 4)?;
            owners.insert(*id);
        }
    }
    let mut ordered = Vec::new();
    for id in owners {
        let (order, path) = cache.path(Some(patch), id, work)?;
        charge(work, 1, std::mem::size_of::<I>() + path.len() + 64)?;
        ordered.push((order, id, path));
    }
    let comparisons = ordered
        .len()
        .saturating_mul((ordered.len().saturating_add(1).ilog2() as usize).saturating_add(1))
        .saturating_mul(ordered.iter().map(|x| x.0.len()).max().unwrap_or(0));
    charge(work, comparisons, 0)?;
    ordered.sort_by(|a, b| a.0.cmp(&b.0));
    resolver.enabled.set(true);
    let mut seen = BTreeSet::new();
    for (_, id, path) in ordered {
        match read_memo(cache, patch, id)
            .and_then(|m| m.header.as_deref())
            .ok_or_else(invalid)?
        {
            Node::MediaImage { attrs, .. } => {
                charge(work, 1, path.len().saturating_mul(4).saturating_add(512))?;
                if seen.insert((IdentityKind::Media, attrs.media_asset_id)) {
                    validate_identity(
                        resolver,
                        IdentityKind::Media,
                        &attrs.media_asset_id,
                        &key_path(&key_path(&path, "attrs"), "media_asset_id"),
                        Some(work),
                    )?;
                }
            }
            Node::Text {
                marks: Some(marks), ..
            } => {
                for (index, mark) in marks.iter().enumerate() {
                    if let Mark::ReferenceLink { attrs } = mark {
                        charge(work, 1, path.len().saturating_mul(4).saturating_add(512))?;
                        if seen.insert((IdentityKind::Reference, attrs.reference_entity_id)) {
                            validate_identity(
                                resolver,
                                IdentityKind::Reference,
                                &attrs.reference_entity_id,
                                &key_path(
                                    &key_path(
                                        &index_path(&key_path(&path, "marks"), index),
                                        "attrs",
                                    ),
                                    "reference_entity_id",
                                ),
                                Some(work),
                            )?;
                        }
                    }
                }
            }
            _ => {}
        }
    }
    Ok(())
}

pub(crate) fn validate<V: CandidateChanges>(
    context: Profile,
    view: &V,
    cache: &KwdjCache<V::Id>,
    identities: &dyn IdentityResolver,
    limits: Limits,
    budget: AdmissionBudget,
    work: &mut WorkMeter,
) -> Result<PreparedValidation<KwdjCache<V::Id>>, KwdjError> {
    let resolver = MemoResolver {
        inner: identities,
        enabled: Cell::new(false),
        answers: RefCell::new(BTreeMap::new()),
    };
    let fallback =
        |work: &mut WorkMeter| -> Result<PreparedValidation<KwdjCache<V::Id>>, KwdjError> {
            work.note_phase(WorkPhase::FullFallback, 1, 0);
            let (stats, _) = crate::candidate_validate::validate_outcome(
                context, view, &resolver, limits, budget, work,
            )?;
            let next = seed(context, view, limits, budget, work)?;
            Ok(PreparedValidation {
                stats,
                cache: CacheUpdate::Replace(next),
            })
        };
    if !cache.matches(context, view, limits, budget) {
        return fallback(work);
    }
    match crate::edit_normalize::normalize_scoped(context, view, work, |id, work| {
        current_path(view, cache, id, work)
    }) {
        Ok(ops) if ops.is_empty() => {}
        Err(error) if is_budget(&error) => return Err(error),
        _ => return fallback(work),
    }
    let patch = match prepare(view, cache, work) {
        Ok(p) => p,
        Err(error) if is_budget(&error) => return Err(error),
        Err(_) => return fallback(work),
    };
    let a = patch.root.aggregate;
    let operational = budget.preflight.effective();
    if a.height > limits.tree_depth
        || a.sum.nodes > limits.node_count
        || a.sum.wire > limits.document_bytes
        || a.sum.payload > operational.payload_bytes
        || a.sum.values > operational.values
        || a.metadata_height > operational.depth
    {
        return fallback(work);
    }
    let scoped = ScopedView::new(view, cache, &patch, work)?;
    if let Err(error) =
        crate::validate::validate_view(&scoped, context, a.sum.wire, &resolver, limits, Some(work))
    {
        if is_budget(&error) {
            return Err(error);
        }
        return fallback(work);
    }
    if let Err(error) = facts(cache, &patch, &resolver, work) {
        if is_budget(&error) {
            return Err(error);
        }
        return fallback(work);
    }
    Ok(PreparedValidation {
        stats: ValidationStats {
            canonical_bytes: a.sum.wire,
            nodes: a.sum.nodes,
        },
        cache: CacheUpdate::Patch(patch),
    })
}

pub(crate) fn normalize<V: CandidateChanges>(
    context: Profile,
    view: &V,
    cache: &KwdjCache<V::Id>,
    identities: &dyn IdentityResolver,
    limits: Limits,
    budget: AdmissionBudget,
    work: &mut WorkMeter,
) -> Result<Vec<editor_core::transaction::Operation<V::Id>>, KwdjError> {
    if !cache.matches(context, view, limits, budget) {
        work.note_phase(WorkPhase::FullFallback, 1, 0);
        let ops = crate::edit_normalize::normalize_candidate(context, view, work)?;
        crate::candidate_validate::check_discarded_metadata(
            view, &ops, identities, limits, budget, work,
        )?;
        return Ok(ops);
    }
    let ops = crate::edit_normalize::normalize_scoped(context, view, work, |id, work| {
        current_path(view, cache, id, work)
    })?;
    charge(
        work,
        ops.len(),
        ops.len() * (std::mem::size_of::<V::Id>() * 4 + 64),
    )?;
    let mut selected = BTreeSet::new();
    for op in &ops {
        match op {
            editor_core::transaction::Operation::Remove { node } => {
                selected.insert(*node);
            }
            editor_core::transaction::Operation::SetAttribute { node, key, .. }
                if key == "blank_lines" =>
            {
                selected.insert(*node);
            }
            _ => {}
        }
    }
    let mut ordered = Vec::new();
    for id in selected {
        let indices = current_indices(view, cache, None, id, work)?;
        let path = indices_path(&indices, work)?;
        charge(work, 1, path.len() + std::mem::size_of::<V::Id>() + 64)?;
        ordered.push((indices, id, path));
    }
    charge(
        work,
        ordered
            .len()
            .saturating_mul((ordered.len() + 1).ilog2() as usize + 1)
            .saturating_mul(128),
        0,
    )?;
    ordered.sort_by(|a, b| a.0.cmp(&b.0));
    let mut headers = Vec::new();
    for (_, id, path) in ordered {
        let node = view.node(id).ok_or_else(invalid)?;
        crate::candidate_validate::precharge(node, budget.preflight, work)?;
        crate::candidate_validate::check_normalizable_header(node, &path, work)?;
        let mut value = crate::candidate_validate::raw_header(node, &path)?;
        crate::normalize::normalize_value(&mut value, &path, &mut Vec::new())?;
        work.note_phase(WorkPhase::Header, 1, 0);
        let header = crate::candidate_validate::decode_header(value, &path)?;
        charge(work, 1, path.len() + std::mem::size_of::<(Node, String)>())?;
        headers.push((header, path));
    }
    crate::validate::validate_discarded_metadata(
        headers.iter().map(|(h, p)| (h, p.as_str())),
        identities,
        limits,
        work,
    )?;
    Ok(ops)
}

#[cfg(test)]
#[path = "candidate_cache_tests.rs"]
mod tests;
