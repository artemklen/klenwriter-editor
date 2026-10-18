// SPDX-License-Identifier: MIT OR Apache-2.0
//! Schema proof reuse follows only an engine-prepared exact invalidation forest.
use crate::{
    CompiledGrammar, FrozenRegistry, RegistryDiagnostic, RegistryDigest, RegistryErrorCode as E,
    charge, error, pointer,
};
use editor_core::admission::{PreflightBudget, preflight_node_fields};
use editor_core::document::Primitive;
use editor_core::{
    cache::{CacheUpdate, CandidateCache},
    candidate::{BorrowedNode, CandidateChanges, CandidateRead, DirtyNode},
    transaction::{WorkMeter, WorkPhase},
};
use std::collections::{BTreeMap, BTreeSet};
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SchemaUsage {
    pub metadata_visits: u64,
    pub grammar_visits: u64,
    pub reused_nodes: u64,
}
#[derive(Debug)]
pub struct SchemaCache<I> {
    digest: Option<RegistryDigest>,
    root: Option<I>,
    proofs: BTreeMap<I, Proof>,
}
#[derive(Debug, Clone)]
struct Proof {
    type_id: String,
    children: usize,
}
pub struct SchemaCachePatch<I> {
    writes: Vec<(I, Proof)>,
    removes: Vec<I>,
}
impl<I> Default for SchemaCache<I> {
    fn default() -> Self {
        Self {
            digest: None,
            root: None,
            proofs: BTreeMap::new(),
        }
    }
}
impl<I: Copy + Eq + Ord> CandidateCache for SchemaCache<I> {
    type Patch = SchemaCachePatch<I>;
    fn publish(&mut self, patch: Self::Patch) {
        for id in patch.removes {
            self.proofs.remove(&id);
        }
        for (id, proof) in patch.writes {
            self.proofs.insert(id, proof);
        }
    }
}
pub struct PreparedSchema<I: Copy + Eq + Ord> {
    pub cache: CacheUpdate<SchemaCache<I>>,
    pub usage: SchemaUsage,
}
impl FrozenRegistry {
    pub fn validate_full<V: CandidateRead>(
        &self,
        view: &V,
        work: &mut WorkMeter,
    ) -> Result<PreparedSchema<V::Id>, RegistryDiagnostic> {
        let start = work.usage();
        let result = self.validate_full_inner(view, work);
        crate::with_work_usage(result, start, work)
    }
    pub fn validate_scoped<V: CandidateChanges>(
        &self,
        view: &V,
        cache: &SchemaCache<V::Id>,
        work: &mut WorkMeter,
    ) -> Result<PreparedSchema<V::Id>, RegistryDiagnostic> {
        let start = work.usage();
        let result = self.validate_scoped_inner(view, cache, work);
        crate::with_work_usage(result, start, work)
    }
    fn validate_full_inner<V: CandidateRead>(
        &self,
        view: &V,
        work: &mut WorkMeter,
    ) -> Result<PreparedSchema<V::Id>, RegistryDiagnostic> {
        charge(work, 1, 128)?;
        let mut cache = SchemaCache {
            digest: Some(self.digest()),
            root: Some(view.root()),
            proofs: BTreeMap::new(),
        };
        let mut usage = SchemaUsage::default();
        grammar(&self.root, view, view.root(), "", work)?;
        usage.grammar_visits += 1;
        cache.proofs.insert(
            view.root(),
            Proof {
                type_id: String::new(),
                children: view.roots().len(),
            },
        );
        charge(
            work,
            view.roots().len() as u64,
            view.roots().len() as u64 * 96,
        )?;
        let mut pending: Vec<_> = view
            .roots()
            .iter()
            .enumerate()
            .rev()
            .map(|(i, id)| (*id, format!("/children/{i}"), 1u64))
            .collect();
        let mut seen = BTreeSet::new();
        while let Some((id, path, depth)) = pending.pop() {
            charge(work, 1, 96)?;
            if depth > 128 || !seen.insert(id) || id == view.root() {
                return Err(error(E::InvalidNodeShape, &path, "tree identity/depth"));
            }
            let node = view
                .node(id)
                .ok_or_else(|| error(E::UnknownNode, &path, "missing semantic node"))?;
            self.metadata(&node, &path, work)?;
            usage.metadata_visits += 1;
            let spec = &self.nodes[node.type_id];
            grammar(&spec.grammar, view, id, &path, work)?;
            usage.grammar_visits += 1;
            charge(work, 1, node.type_id.len() as u64 + 128)?;
            cache.proofs.insert(
                id,
                Proof {
                    type_id: node.type_id.to_owned(),
                    children: node.children.len(),
                },
            );
            charge(
                work,
                node.children.len() as u64,
                node.children.len() as u64 * (path.len() as u64 + 96),
            )?;
            for (i, child) in node.children.iter().enumerate().rev() {
                pending.push((*child, format!("{path}/children/{i}"), depth + 1));
            }
        }
        Ok(PreparedSchema {
            cache: CacheUpdate::Replace(cache),
            usage,
        })
    }
    fn validate_scoped_inner<V: CandidateChanges>(
        &self,
        view: &V,
        cache: &SchemaCache<V::Id>,
        work: &mut WorkMeter,
    ) -> Result<PreparedSchema<V::Id>, RegistryDiagnostic> {
        if cache.digest != Some(self.digest())
            || cache.root != Some(view.root())
            || !cache.proofs.contains_key(&view.root())
        {
            work.note_phase(WorkPhase::FullFallback, 1, 0);
            return self.validate_full(view, work);
        }
        let forest = view.dirty_forest();
        charge(work, forest.len() as u64, forest.len() as u64 * 256)?;
        let index: BTreeMap<_, _> = forest.iter().map(|n| (n.id, n)).collect();
        let mut ordered = Vec::new();
        let mut removes = Vec::new();
        for record in forest {
            if record.id == view.root() {
                continue;
            }
            if record.after_parent.is_none() {
                if cache.proofs.contains_key(&record.id) {
                    removes.push(record.id);
                }
                continue;
            }
            let path = ordinals(view.root(), record.id, &index, work)?;
            charge(work, 1, path.len() as u64 * 24 + 96)?;
            ordered.push((path, record));
        }
        charge(work, ordered.len() as u64 * 16, 0)?;
        ordered.sort_by(|a, b| a.0.cmp(&b.0));
        let mut usage = SchemaUsage::default();
        let mut writes = Vec::new();
        let root_record = index.get(&view.root()).copied();
        if match root_record {
            Some(r) => needs_grammar(view, r, work)?,
            None => false,
        } {
            Self::scoped_grammar(view, view.root(), &self.root, cache, root_record, "", work)?;
            usage.grammar_visits += 1;
            charge(work, 1, 128)?;
            writes.push((
                view.root(),
                Proof {
                    type_id: String::new(),
                    children: view.roots().len(),
                },
            ));
        }
        for (path, record) in ordered {
            let logical = logical_path(&path, work)?;
            let node = view
                .node(record.id)
                .ok_or_else(|| error(E::UnknownNode, &logical, "missing final node"))?;
            let previous = cache.proofs.get(&record.id);
            if record.payload_changed || previous.is_none() {
                self.metadata(&node, &logical, work)?;
                usage.metadata_visits += 1;
            } else {
                usage.reused_nodes += 1;
                work.note_phase(WorkPhase::CacheReuse, 1, 0);
            }
            let spec = self
                .nodes
                .get(node.type_id)
                .ok_or_else(|| error(E::UnknownNode, &logical, "unregistered final type"))?;
            let type_changed = previous.is_none_or(|proof| proof.type_id != node.type_id);
            if type_changed || needs_grammar(view, record, work)? {
                if type_changed {
                    grammar(&spec.grammar, view, record.id, &logical, work)?;
                } else {
                    Self::scoped_grammar(
                        view,
                        record.id,
                        &spec.grammar,
                        cache,
                        Some(record),
                        &logical,
                        work,
                    )?;
                }
                usage.grammar_visits += 1;
            }
            charge(work, 1, node.type_id.len() as u64 + 160)?;
            writes.push((
                record.id,
                Proof {
                    type_id: node.type_id.to_owned(),
                    children: node.children.len(),
                },
            ));
        }
        work.note_phase(WorkPhase::CacheUpdate, writes.len() as u64, 0);
        Ok(PreparedSchema {
            cache: CacheUpdate::Patch(SchemaCachePatch { writes, removes }),
            usage,
        })
    }
    fn metadata<I>(
        &self,
        node: &BorrowedNode<'_, I>,
        path: &str,
        work: &mut WorkMeter,
    ) -> Result<(), RegistryDiagnostic> {
        let remaining = work.limits();
        let used = work.usage();
        let usage = preflight_node_fields(
            node.type_id,
            node.text,
            node.attributes,
            node.marks,
            node.children.len(),
            PreflightBudget {
                payload_bytes: remaining.bytes.saturating_sub(used.bytes),
                values: remaining.units.saturating_sub(used.units),
                depth: 128,
            },
        )
        .map_err(|_| error(E::ResourceLimitExceeded, path, "metadata preflight"))?;
        charge(work, usage.values, usage.payload_bytes)?;
        work.note_phase(WorkPhase::Header, 1, usage.payload_bytes);
        let spec = self
            .nodes
            .get(node.type_id)
            .ok_or_else(|| error(E::UnknownNode, &pointer(path, "type"), "unregistered node"))?;
        if spec.descriptor.primitive.core() != node.primitive {
            return Err(error(
                E::PrimitiveMismatch,
                &pointer(path, "primitive"),
                "schema primitive",
            ));
        }
        let shape = match node.primitive {
            Primitive::Text => node.text.is_some() && node.children.is_empty(),
            Primitive::InlineAtom | Primitive::BlockAtom | Primitive::HardBreak => {
                node.text.is_none() && node.children.is_empty()
            }
            Primitive::TextBlock | Primitive::Container => node.text.is_none(),
        };
        if !shape {
            return Err(error(E::InvalidNodeShape, path, "primitive payload shape"));
        }
        spec.attrs
            .validate(node.attributes, &pointer(path, "attributes"), work)?;
        self.marks_inner(spec, node.marks, path, work)
    }
    /// Validate a proposed future-typing mark set with the same frozen schema
    /// authority used for authored node marks; this never mutates a Session.
    pub fn validate_marks(
        &self,
        node_type_id: &str,
        marks: &[editor_core::document::Mark],
        work: &mut WorkMeter,
    ) -> Result<(), RegistryDiagnostic> {
        let start = work.usage();
        let result = (|| {
            let empty = editor_core::document::Attributes::new();
            let limits = work.limits();
            let used = work.usage();
            let usage = preflight_node_fields(
                node_type_id,
                None,
                &empty,
                marks,
                0,
                PreflightBudget {
                    payload_bytes: limits.bytes.saturating_sub(used.bytes),
                    values: limits.units.saturating_sub(used.units),
                    depth: 128,
                },
            )
            .map_err(|_| error(E::ResourceLimitExceeded, "/marks", "mark preflight"))?;
            charge(work, usage.values, usage.payload_bytes)?;
            let spec = self
                .nodes
                .get(node_type_id)
                .ok_or_else(|| error(E::UnknownNode, "/type", "unknown typing node type"))?;
            self.marks_inner(spec, marks, "", work)
        })();
        crate::with_work_usage(result, start, work)
    }
    fn marks_inner(
        &self,
        spec: &crate::compile::CompiledNode,
        marks: &[editor_core::document::Mark],
        path: &str,
        work: &mut WorkMeter,
    ) -> Result<(), RegistryDiagnostic> {
        let mut seen = BTreeSet::new();
        charge(work, marks.len() as u64, marks.len() as u64 * 48)?;
        for (i, mark) in marks.iter().enumerate() {
            let p = format!("{path}/marks/{i}");
            if !seen.insert(mark.type_id.as_str()) {
                return Err(error(E::DuplicateMark, &p, "duplicate active mark"));
            }
            let mark_spec = self
                .marks
                .get(&mark.type_id)
                .ok_or_else(|| error(E::UnknownMark, &p, "unregistered mark"))?;
            if spec.allowed.binary_search(&mark.type_id).is_err() {
                return Err(error(E::MarkNotAllowed, &p, "mark not selected for node"));
            }
            mark_spec
                .attrs
                .validate(&mark.attributes, &pointer(&p, "attributes"), work)?;
        }
        for (i, mark) in marks.iter().enumerate() {
            for excluded in &self.marks[&mark.type_id].descriptor.excludes {
                charge(work, 1, 0)?;
                if seen.contains(excluded.as_str()) {
                    return Err(error(
                        E::MarkExcluded,
                        &format!("{path}/marks/{i}"),
                        "incompatible active marks",
                    ));
                }
            }
        }
        Ok(())
    }
    fn scoped_grammar<V: CandidateChanges>(
        view: &V,
        id: V::Id,
        rule: &CompiledGrammar,
        cache: &SchemaCache<V::Id>,
        record: Option<&DirtyNode<V::Id>>,
        path: &str,
        work: &mut WorkMeter,
    ) -> Result<(), RegistryDiagnostic> {
        if let (Some((allowed, min, max)), Some(record), Some(old)) =
            (rule.counted(), record, cache.proofs.get(&id))
        {
            charge(work, record.dirty_children.len() as u64 + 1, 0)?;
            let length = view
                .children(id)
                .ok_or_else(|| error(E::InvalidNodeShape, path, "missing child collection"))?
                .len();
            // Full matching reports the first invalid label (including the
            // first extra child) before a missing suffix. Preserve that order.
            let mut earliest = if length as u64 > max {
                Some(max as usize)
            } else {
                None
            };
            for child in &record.dirty_children {
                if let Some(node) = view.node(*child)
                    && node.parent == id
                {
                    charge(work, node.type_id.len() as u64 + 1, 0)?;
                    work.note_phase(WorkPhase::StaticValidation, 1, node.type_id.len() as u64);
                    if !allowed.contains(node.type_id) {
                        let ordinal = view
                            .dirty_forest()
                            .binary_search_by_key(child, |r| r.id)
                            .ok()
                            .and_then(|i| view.dirty_forest()[i].after_ordinal)
                            .ok_or_else(|| {
                                error(E::InvalidNodeShape, path, "missing dirty ordinal")
                            })?;
                        earliest = Some(earliest.map_or(ordinal, |old: usize| old.min(ordinal)));
                    }
                }
            }
            if let Some(i) = earliest {
                let mut e = error(
                    E::GrammarMismatch,
                    &format!("{path}/children/{i}/type"),
                    "counted child label",
                );
                e.child_index = Some(i);
                return Err(e);
            }
            if (length as u64) < min {
                let mut e = error(
                    E::GrammarMismatch,
                    &pointer(path, "children"),
                    "counted missing suffix",
                );
                e.child_index = Some(length);
                return Err(e);
            }
            let _ = old.children;
            work.note_phase(WorkPhase::CacheReuse, 1, 0);
            Ok(())
        } else {
            grammar(rule, view, id, path, work)
        }
    }
}
fn needs_grammar<V: CandidateChanges>(
    view: &V,
    r: &DirtyNode<V::Id>,
    work: &mut WorkMeter,
) -> Result<bool, RegistryDiagnostic> {
    if r.children_changed {
        return Ok(true);
    }
    for id in &r.dirty_children {
        charge(work, 1, 0)?;
        let before = view.before_node(*id);
        let after = view.node(*id);
        match (before, after) {
            (Some(a), Some(b)) => {
                charge(work, (a.type_id.len() + b.type_id.len()) as u64, 0)?;
                if a.type_id != b.type_id || a.parent != b.parent {
                    return Ok(true);
                }
            }
            _ => return Ok(true),
        }
    }
    Ok(false)
}
fn grammar<V: CandidateRead>(
    rule: &CompiledGrammar,
    view: &V,
    id: V::Id,
    path: &str,
    work: &mut WorkMeter,
) -> Result<(), RegistryDiagnostic> {
    let children = view
        .children(id)
        .ok_or_else(|| error(E::InvalidNodeShape, path, "missing children"))?;
    rule.validate_labels(
        children
            .iter()
            .map(|child| view.node(*child).map_or("", |n| n.type_id)),
        &pointer(path, "children"),
        work,
    )
    .map_err(|mut e| {
        if e.code == E::GrammarMismatch
            && let Some(i) = e.child_index
            && i < children.len()
        {
            e.path = format!("{path}/children/{i}/type");
        }
        e
    })
}
fn ordinals<I: Copy + Eq + Ord>(
    root: I,
    mut id: I,
    index: &BTreeMap<I, &DirtyNode<I>>,
    work: &mut WorkMeter,
) -> Result<Vec<usize>, RegistryDiagnostic> {
    let mut out = Vec::new();
    while id != root {
        charge(work, 1, 16)?;
        if out.len() >= 128 {
            return Err(error(E::InvalidNodeShape, "", "dirty ancestor depth"));
        }
        let r = index
            .get(&id)
            .ok_or_else(|| error(E::InvalidNodeShape, "", "incomplete dirty ancestor forest"))?;
        out.push(
            r.after_ordinal
                .ok_or_else(|| error(E::InvalidNodeShape, "", "missing final ordinal"))?,
        );
        id = r
            .after_parent
            .ok_or_else(|| error(E::InvalidNodeShape, "", "missing final parent"))?;
    }
    out.reverse();
    Ok(out)
}
fn logical_path(path: &[usize], work: &mut WorkMeter) -> Result<String, RegistryDiagnostic> {
    charge(work, path.len() as u64, path.len() as u64 * 32)?;
    let mut s = String::new();
    for i in path {
        s.push_str(&format!("/children/{i}"));
    }
    Ok(s)
}
