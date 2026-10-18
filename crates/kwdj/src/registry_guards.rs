// SPDX-License-Identifier: MIT OR Apache-2.0
//! Profile-owned guards for metadata that normalization can retire. The
//! mandatory KWDJ registration is immutable; only the composer's text mark set
//! can introduce a stricter metadata rule. Existing domain guards still run first.
use crate::{AdmissionBudget, KwdjError, KwdjErrorCode, KwdjProfileError};
use editor_core::candidate::{BorrowedNode, CandidateRead};
use editor_core::document::Node as CoreNode;
use editor_core::transaction::{Operation, WorkMeter};
use editor_registry::FrozenRegistry;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

const TEXT: &str = "org.klenwriter.kwdj/text";
fn charge(work: &mut WorkMeter, units: u64, bytes: u64) -> Result<(), KwdjProfileError> {
    work.charge_units(units)
        .and_then(|()| work.charge_bytes(bytes))
        .map_err(KwdjError::operational)?;
    Ok(())
}
fn invalid(path: &str) -> KwdjProfileError {
    KwdjError::new(KwdjErrorCode::InvalidStructure, path).into()
}
/// Base attrs/types/grammar cannot be replaced by a descriptor. A composer that
/// preserves every mandatory text mark adds no rule that these lossless KWDJ
/// metadata normalizations can hide. This fixed-size check skips redundant
/// schema checks for the ordinary profile and additive extensions. Original
/// imported headers are already proven closed by the opaque candidate decoder.
fn tightened(registry: &FrozenRegistry, work: &mut WorkMeter) -> Result<bool, KwdjProfileError> {
    let base = crate::registry::default_registry();
    let baseline = base.node(TEXT).ok_or_else(|| invalid(""))?;
    let current = registry.node(TEXT).ok_or_else(|| invalid(""))?;
    charge(work, 1 + baseline.allowed_marks().len() as u64 * 16, 0)?;
    Ok(baseline
        .allowed_marks()
        .iter()
        .any(|mark| current.allowed_marks().binary_search(mark).is_err()))
}
fn validate_header<I: Copy>(
    registry: &FrozenRegistry,
    core: &CoreNode,
    parent: I,
    children: &[I],
    text: Option<&str>,
    path: &str,
    work: &mut WorkMeter,
) -> Result<(), KwdjProfileError> {
    registry.validate_node_metadata(
        &BorrowedNode {
            type_id: &core.type_id,
            primitive: core.primitive,
            attributes: &core.attributes,
            marks: &core.marks,
            text,
            children,
            parent,
        },
        path,
        work,
    )?;
    Ok(())
}
fn canonical_core(
    header: Value,
    path: &str,
    work: &mut WorkMeter,
) -> Result<CoreNode, KwdjProfileError> {
    let typed = crate::candidate_validate::decode_header(header, path)?;
    // Header cloning/normalization/model conversion ownership was precharged by
    // the caller. Its child payload is empty; no subtree is projected here.
    charge(work, 1, std::mem::size_of::<CoreNode>() as u64)?;
    Ok(crate::core_bridge::convert_node(&typed))
}

/// Only actual discarded/overwritten targets, with current source paths. The
/// resolver is cached in scoped preparation; full fallback is explicit.
pub(crate) fn discarded<V: CandidateRead, F>(
    registry: &FrozenRegistry,
    view: &V,
    ops: &[Operation<V::Id>],
    budget: AdmissionBudget,
    work: &mut WorkMeter,
    mut path: F,
) -> Result<(), KwdjProfileError>
where
    F: FnMut(V::Id, &mut WorkMeter) -> Result<String, KwdjError>,
{
    if ops.is_empty() || !tightened(registry, work)? {
        return Ok(());
    }
    let mut targets = BTreeMap::new();
    for op in ops {
        charge(work, 1, 0)?;
        let selected = match op {
            Operation::Remove { node } => Some((*node, true)),
            Operation::SetAttribute { node, key, .. } if key == "blank_lines" => {
                Some((*node, false))
            }
            _ => None,
        };
        if let Some((id, subtree)) = selected {
            charge(work, 1, (std::mem::size_of::<V::Id>() + 80) as u64)?;
            targets
                .entry(id)
                .and_modify(|old| *old |= subtree)
                .or_insert(subtree);
        }
    }
    let mut ordered = Vec::new();
    let mut max_depth = 0usize;
    for (id, subtree) in targets {
        let path = path(id, work)?;
        charge(
            work,
            path.len() as u64,
            (path.len() * std::mem::size_of::<usize>()
                + std::mem::size_of::<(Vec<usize>, String, V::Id, bool)>()) as u64,
        )?;
        let indices: Vec<usize> = path
            .split('/')
            .filter(|part| !part.is_empty() && *part != "content")
            .map(|part| part.parse().map_err(|_| invalid(&path)))
            .collect::<Result<_, _>>()?;
        max_depth = max_depth.max(indices.len());
        ordered.push((indices, path, id, subtree));
    }
    let n = ordered.len() as u64;
    charge(
        work,
        n.saturating_mul(n.max(1).ilog2() as u64 + 1)
            .saturating_mul(max_depth as u64 + 1)
            .saturating_mul(2),
        0,
    )?;
    ordered.sort_unstable_by(|a, b| a.0.cmp(&b.0));
    let mut state = DiscardState {
        registry,
        view,
        budget,
        work,
        seen: BTreeSet::new(),
    };
    for (_, path, id, subtree) in ordered {
        state.walk(id, &path, 1, subtree)?;
    }
    Ok(())
}
struct DiscardState<'a, V: CandidateRead> {
    registry: &'a FrozenRegistry,
    view: &'a V,
    budget: AdmissionBudget,
    work: &'a mut WorkMeter,
    seen: BTreeSet<V::Id>,
}
impl<V: CandidateRead> DiscardState<'_, V> {
    fn walk(
        &mut self,
        id: V::Id,
        path: &str,
        depth: u64,
        subtree: bool,
    ) -> Result<(), KwdjProfileError> {
        charge(self.work, 1, (std::mem::size_of::<V::Id>() * 4 + 64) as u64)?;
        if depth > 128 || id == self.view.root() {
            return Err(invalid(path));
        }
        if !self.seen.insert(id) {
            return Ok(());
        }
        let node = self.view.node(id).ok_or_else(|| invalid(path))?;
        crate::candidate_validate::precharge(node, self.budget.preflight, self.work)?;
        crate::candidate_validate::check_normalizable_header(node, path, self.work)?;
        let mut header = crate::candidate_validate::raw_header(node, path)?;
        crate::normalize::normalize_value(&mut header, path, &mut Vec::new())?;
        let core = canonical_core(header, path, self.work)?;
        validate_header(
            self.registry,
            &core,
            node.parent,
            node.children,
            node.text,
            path,
            self.work,
        )?;
        if subtree {
            charge(self.work, node.children.len() as u64, 0)?;
            for (index, child) in node.children.iter().enumerate() {
                charge(self.work, 1, (path.len() + 48) as u64)?;
                self.walk(*child, &format!("{path}/content/{index}"), depth + 1, true)?;
            }
        }
        Ok(())
    }
}
/// Explicit full CandidateRead fallback. Ordinary scoped preparation uses the
/// admitted cache + dirty ordinal forest instead of scanning root siblings.
pub(crate) fn uncached_path<V: CandidateRead>(
    view: &V,
    mut id: V::Id,
    work: &mut WorkMeter,
) -> Result<String, KwdjError> {
    let mut indices = Vec::new();
    while id != view.root() {
        work.charge_units(1).map_err(KwdjError::operational)?;
        if indices.len() >= 128 {
            return Err(KwdjError::new(KwdjErrorCode::InvalidStructure, ""));
        }
        let node = view
            .node(id)
            .ok_or_else(|| KwdjError::new(KwdjErrorCode::InvalidStructure, ""))?;
        let children = view
            .children(node.parent)
            .ok_or_else(|| KwdjError::new(KwdjErrorCode::InvalidStructure, ""))?;
        work.charge_units(children.len() as u64)
            .map_err(KwdjError::operational)?;
        work.charge_bytes(64).map_err(KwdjError::operational)?;
        indices.push(
            children
                .iter()
                .position(|child| *child == id)
                .ok_or_else(|| KwdjError::new(KwdjErrorCode::InvalidStructure, ""))?,
        );
        id = node.parent;
    }
    let mut path = String::new();
    for index in indices.into_iter().rev() {
        work.charge_bytes(40).map_err(KwdjError::operational)?;
        use std::fmt::Write;
        write!(&mut path, "/content/{index}").expect("String writes are infallible");
    }
    Ok(path)
}

/// Inspect the original imported headers before normalization can remove text
/// or merge records. No grammar pass and no parse/stringify roundtrip occurs.
pub(crate) fn imported(
    registry: &FrozenRegistry,
    value: &Value,
    budget: AdmissionBudget,
    work: &mut WorkMeter,
) -> Result<(), KwdjProfileError> {
    if !tightened(registry, work)? {
        return Ok(());
    }
    struct ImportState<'a> {
        registry: &'a FrozenRegistry,
        budget: AdmissionBudget,
        work: &'a mut WorkMeter,
    }
    impl ImportState<'_> {
        fn walk(&mut self, value: &Value, path: &str, depth: u64) -> Result<(), KwdjProfileError> {
            charge(self.work, 1, 0)?;
            if depth > self.budget.preflight.depth.min(128) {
                return Err(invalid(path));
            }
            let object = value.as_object().ok_or_else(|| invalid(path))?;
            // CandidateDocument already proves every original header closed.
            // Only the additional frozen schema policy needs this pass.
            let mut header = crate::candidate_validate::original_header(
                value,
                path,
                self.budget.preflight,
                self.work,
            )?;
            crate::normalize::normalize_value(&mut header, path, &mut Vec::new())?;
            let core = canonical_core(header, path, self.work)?;
            validate_header(
                self.registry,
                &core,
                (),
                &[],
                core.text.as_deref(),
                path,
                self.work,
            )?;
            if let Some(children) = object.get("content").and_then(Value::as_array) {
                charge(self.work, children.len() as u64, 0)?;
                for (index, child) in children.iter().enumerate() {
                    charge(self.work, 1, (path.len() + 48) as u64)?;
                    self.walk(child, &format!("{path}/content/{index}"), depth + 1)?;
                }
            }
            Ok(())
        }
    }
    if let Some(roots) = value.get("content").and_then(Value::as_array) {
        let mut state = ImportState {
            registry,
            budget,
            work,
        };
        for (index, node) in roots.iter().enumerate() {
            charge(state.work, 1, 48)?;
            state.walk(node, &format!("/content/{index}"), 1)?;
        }
    }
    Ok(())
}
