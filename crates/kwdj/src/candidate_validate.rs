// SPDX-License-Identifier: MIT OR Apache-2.0
//! Bounded borrowed admission for transaction candidates. Only shallow metadata
//! is decoded; text and child trees remain borrowed throughout validation.

use std::collections::{BTreeMap, BTreeSet};
use std::io::{self, Write};

use editor_core::admission::{PreflightBudget, PreflightUsage, preflight_node_fields};
use editor_core::candidate::{BorrowedNode, CandidateRead};
use editor_core::document::TreeNode;
use editor_core::transaction::{Operation, ValidationStats, WorkMeter};
use serde_json::{Map, Value};

use crate::core_bridge::{encode_attributes, local_name};
use crate::model::Node;
use crate::wire_view::{CandidateView, DocumentWire};
use crate::{
    AdmissionBudget, IdentityResolver, KwdjError, KwdjErrorCode, Limits, Profile, index_path,
    key_path,
};

pub(crate) fn precharge<I>(
    node: BorrowedNode<'_, I>,
    budget: PreflightBudget,
    work: &mut WorkMeter,
) -> Result<PreflightUsage, KwdjError> {
    let budget = budget.effective();
    let available = work.limits();
    let spent = work.usage();
    // Tighten the borrowed scan itself before visiting metadata. Charging only
    // after the scan would let a tiny host work budget traverse a wide field.
    let remaining_units = available.units.saturating_sub(spent.units);
    let remaining_bytes = available.bytes.saturating_sub(spent.bytes);
    let bounded = PreflightBudget {
        values: budget.values.min(remaining_units),
        payload_bytes: budget.payload_bytes.min(remaining_bytes),
        depth: budget.depth,
    };
    let usage = preflight_node_fields(
        node.type_id,
        node.text,
        node.attributes,
        node.marks,
        node.children.len(),
        bounded,
    )
    .map_err(|mut error| {
        if error.name == "preflight_values" && bounded.values < budget.values {
            error.name = "transaction_work";
            error.maximum = available.units;
            error.observed = spent.units.saturating_add(error.observed);
        } else if error.name == "preflight_payload_bytes"
            && bounded.payload_bytes < budget.payload_bytes
        {
            error.name = "transaction_bytes";
            error.maximum = available.bytes;
            error.observed = spent.bytes.saturating_add(error.observed);
        }
        KwdjError::operational(error)
    })?;
    work.note_phase(
        editor_core::transaction::WorkPhase::Preflight,
        1,
        usage.payload_bytes,
    );
    work.charge_units(usage.values)
        .map_err(KwdjError::operational)?;
    // Metadata is copied by Value/Serde and normalization. The actual text is
    // only scanned/serialized by reference, so it has no metadata-copy factor.
    let text_bytes = node.text.map_or(0, |text| text.len() as u64);
    let bytes = (usage.payload_bytes - text_bytes)
        .checked_mul(8)
        .and_then(|n| n.checked_add(usage.values.saturating_mul(128)))
        .and_then(|n| n.checked_add(text_bytes))
        .ok_or_else(|| KwdjError::new(KwdjErrorCode::OperationalBudgetExceeded, ""))?;
    work.charge_bytes(bytes).map_err(KwdjError::operational)?;
    Ok(usage)
}

pub(crate) fn raw_header<I>(node: BorrowedNode<'_, I>, path: &str) -> Result<Value, KwdjError> {
    let kind = local_name(
        node.type_id,
        &key_path(path, "type"),
        KwdjErrorCode::UnknownNode,
    )?;
    let mut object = Map::new();
    object.insert("type".into(), Value::String(kind.into()));
    if node.text.is_some() {
        // Presence is significant to closed Serde; actual text stays borrowed.
        object.insert("text".into(), Value::String(String::new()));
    }
    if !node.attributes.is_empty() {
        object.insert(
            "attrs".into(),
            encode_attributes(node.attributes, &key_path(path, "attrs"))?,
        );
    }
    if !node.marks.is_empty() {
        let mut marks = Vec::with_capacity(node.marks.len());
        for (index, mark) in node.marks.iter().enumerate() {
            let mark_path = index_path(&key_path(path, "marks"), index);
            let kind = local_name(
                &mark.type_id,
                &key_path(&mark_path, "type"),
                KwdjErrorCode::UnknownMark,
            )?;
            let mut object = Map::new();
            object.insert("type".into(), Value::String(kind.into()));
            if !mark.attributes.is_empty() {
                object.insert(
                    "attrs".into(),
                    encode_attributes(&mark.attributes, &key_path(&mark_path, "attrs"))?,
                );
            }
            marks.push(Value::Object(object));
        }
        object.insert("marks".into(), Value::Array(marks));
    }
    if (!node.children.is_empty() && kind != "media_image")
        || !matches!(
            kind,
            "text" | "hard_break" | "scene_break" | "stanza_break" | "media_image"
        )
    {
        object.insert("content".into(), Value::Array(Vec::new()));
    }
    Ok(Value::Object(object))
}

pub(crate) fn decode_header(value: Value, path: &str) -> Result<Node, KwdjError> {
    // Explicit guards retain their exact source paths. Serde's internally
    // tagged Node enum reports decoding failures at the enclosing root node;
    // retain that native diagnostic behavior for the shallow adapter too.
    crate::scan_known_types(&value, path)?;
    let native_root = path.strip_prefix("/content/").map_or(path, |suffix| {
        &path[.."/content/".len() + suffix.split('/').next().unwrap_or("").len()]
    });
    // Reuse the unchanged native closed decoder and unit-variant guard. This
    // envelope contains one shallow header, no actual child/text payload.
    let mut envelope = Map::new();
    envelope.insert("schema".into(), Value::String("klenwriter.document".into()));
    envelope.insert("schema_version".into(), Value::Number(1.into()));
    envelope.insert("profile".into(), Value::String("prose".into()));
    envelope.insert("content".into(), Value::Array(vec![value]));
    let mut document = crate::decode_document(Value::Object(envelope)).map_err(|mut error| {
        if let Some(suffix) = error.path.strip_prefix("/content/0") {
            error.path = format!("{native_root}{suffix}");
        }
        error
    })?;
    Ok(document.content.pop().expect("one typed metadata header"))
}

fn same_primitive<I>(
    node: BorrowedNode<'_, I>,
    header: &Node,
    path: &str,
) -> Result<(), KwdjError> {
    if header.primitive() != node.primitive {
        return Err(KwdjError::new(KwdjErrorCode::InvalidStructure, path));
    }
    Ok(())
}

/// Destructive normalization may not hide unknown fields or malformed metadata.
/// Known absent-token markers are shape-checked without making them active or
/// applying duplicate/incompatibility checks to markers that normalize away.
pub(crate) fn check_normalizable_header<I: Copy>(
    node: BorrowedNode<'_, I>,
    path: &str,
    work: &mut WorkMeter,
) -> Result<(), KwdjError> {
    let usage = precharge(node, PreflightBudget::default(), work)?;
    work.charge_bytes(
        usage
            .values
            .saturating_mul((path.len() as u64).saturating_mul(2).saturating_add(128)),
    )
    .map_err(KwdjError::operational)?;
    work.note_phase(editor_core::transaction::WorkPhase::Header, 1, 0);
    let mut value = raw_header(node, path)?;
    crate::scan_known_types(&value, path)?;
    let mut marks = value
        .as_object_mut()
        .expect("header object")
        .remove("marks");
    crate::normalize::normalize_value(&mut value, path, &mut Vec::new())?;
    if let Some(Value::Array(marks)) = &mut marks {
        for (index, mark) in marks.iter_mut().enumerate() {
            let kind = mark.get("type").and_then(Value::as_str);
            let replacement = match kind {
                Some("text_color") => Some("muted"),
                Some("highlight") => Some("accent"),
                _ => None,
            };
            if let Some(replacement) = replacement
                && let Some(token) = mark
                    .get_mut("attrs")
                    .and_then(|attrs| attrs.get_mut("token"))
                && token.as_str().is_some_and(|token| {
                    token.eq_ignore_ascii_case("default") || token.eq_ignore_ascii_case("none")
                })
            {
                *token = Value::String(replacement.into());
            }
            crate::normalize::normalize_value(
                mark,
                &index_path(&key_path(path, "marks"), index),
                &mut Vec::new(),
            )?;
        }
    }
    if let Some(marks) = marks {
        value
            .as_object_mut()
            .expect("header object")
            .insert("marks".into(), marks);
    }
    let header = decode_header(value, path)?;
    same_primitive(node, &header, path)
}

/// Before automatic removal/overwrite, inspect the original semantic payload.
/// Shape checks happen before canonicalization so unsupported authored fields
/// cannot disappear; business checks are delegated to the shared validator.
pub(crate) fn check_discarded_metadata<V: CandidateRead>(
    candidate: &V,
    operations: &[Operation<V::Id>],
    identities: &dyn IdentityResolver,
    limits: Limits,
    budget: AdmissionBudget,
    work: &mut WorkMeter,
) -> Result<(), KwdjError> {
    let mut selected = BTreeSet::new();
    for operation in operations {
        work.charge_units(1).map_err(KwdjError::operational)?;
        let id = match operation {
            Operation::Remove { node } => Some(*node),
            Operation::SetAttribute { node, key, .. } if key == "blank_lines" => Some(*node),
            _ => None,
        };
        if let Some(id) = id {
            work.charge_bytes((std::mem::size_of::<V::Id>() * 4) as u64)
                .map_err(KwdjError::operational)?;
            selected.insert(id);
        }
    }
    if selected.is_empty() {
        return Ok(());
    }
    struct DiscardState<'a, I> {
        selected: BTreeSet<I>,
        seen: BTreeSet<I>,
        headers: Vec<(Node, String)>,
        budget: PreflightBudget,
        work: &'a mut WorkMeter,
    }
    let mut state = DiscardState {
        selected,
        seen: BTreeSet::new(),
        headers: Vec::new(),
        budget: budget.effective().preflight,
        work,
    };
    fn walk<V: CandidateRead>(
        candidate: &V,
        id: V::Id,
        path: &str,
        depth: u64,
        state: &mut DiscardState<'_, V::Id>,
    ) -> Result<(), KwdjError> {
        let DiscardState {
            selected,
            seen,
            headers,
            budget,
            work,
        } = state;
        limit("preflight_depth", budget.depth, depth)?;
        work.charge_units(1).map_err(KwdjError::operational)?;
        work.charge_bytes((std::mem::size_of::<V::Id>() * 4) as u64)
            .map_err(KwdjError::operational)?;
        if id == candidate.root() || !seen.insert(id) {
            return Err(KwdjError::new(KwdjErrorCode::InvalidStructure, path));
        }
        let node = candidate
            .node(id)
            .ok_or_else(|| KwdjError::new(KwdjErrorCode::InvalidStructure, path))?;
        if selected.remove(&id) {
            precharge(node, *budget, work)?;
            check_normalizable_header(node, path, work)?;
            let mut value = raw_header(node, path)?;
            crate::normalize::normalize_value(&mut value, path, &mut Vec::new())?;
            work.note_phase(editor_core::transaction::WorkPhase::Header, 1, 0);
            let header = decode_header(value, path)?;
            work.charge_bytes((path.len() + std::mem::size_of::<(Node, String)>()) as u64)
                .map_err(KwdjError::operational)?;
            headers.push((header, path.to_owned()));
        }
        for (index, child) in node.children.iter().enumerate() {
            state
                .work
                .charge_bytes((path.len() + 32) as u64)
                .map_err(KwdjError::operational)?;
            walk(
                candidate,
                *child,
                &index_path(&key_path(path, "content"), index),
                depth + 1,
                state,
            )?;
        }
        Ok(())
    }
    for (index, id) in candidate.roots().iter().enumerate() {
        state
            .work
            .charge_bytes(32)
            .map_err(KwdjError::operational)?;
        walk(
            candidate,
            *id,
            &index_path("/content", index),
            1,
            &mut state,
        )?;
    }
    if !state.selected.is_empty() {
        return Err(KwdjError::new(KwdjErrorCode::InvalidStructure, ""));
    }
    crate::validate::validate_discarded_metadata(
        state
            .headers
            .iter()
            .map(|(header, path)| (header, path.as_str())),
        identities,
        limits.effective(),
        state.work,
    )
}

pub(crate) fn strict_header<I: Copy>(
    node: BorrowedNode<'_, I>,
    path: &str,
) -> Result<Node, KwdjError> {
    let value = raw_header(node, path)?;
    crate::normalize::ensure_normalized(&value, path).map_err(|mut error| {
        // Native strict admission checks the whole document at the root.
        if error.code == KwdjErrorCode::NonNormalized {
            error.path.clear();
        }
        error
    })?;
    let header = decode_header(value, path)?;
    same_primitive(node, &header, path)?;
    Ok(header)
}

fn build_view<'a, V: CandidateRead>(
    candidate: &'a V,
    budget: PreflightBudget,
    limits: Limits,
    work: &mut WorkMeter,
) -> Result<CandidateView<'a, V>, KwdjError> {
    let budget = budget.effective();
    let mut headers = BTreeMap::new();
    limit(
        "preflight_values",
        budget.values,
        candidate.roots().len() as u64,
    )?;
    struct BuildState<'a, I> {
        budget: PreflightBudget,
        usage: PreflightUsage,
        seen: BTreeSet<I>,
        pending: Vec<(I, String)>,
        tree_depth: u64,
        work: &'a mut WorkMeter,
    }
    let mut state = BuildState {
        budget,
        usage: PreflightUsage::default(),
        seen: BTreeSet::new(),
        pending: Vec::new(),
        tree_depth: 0,
        work,
    };
    fn walk<V: CandidateRead>(
        candidate: &V,
        id: V::Id,
        parent: V::Id,
        path: &str,
        depth: u64,
        state: &mut BuildState<'_, V::Id>,
    ) -> Result<(), KwdjError> {
        let BuildState {
            budget,
            usage,
            seen,
            pending,
            tree_depth,
            work,
        } = state;
        limit("preflight_depth", budget.depth, depth)?;
        work.charge_units(1).map_err(KwdjError::operational)?;
        work.charge_bytes((std::mem::size_of::<V::Id>() * 3 + std::mem::size_of::<Node>()) as u64)
            .map_err(KwdjError::operational)?;
        if id == candidate.root() || !seen.insert(id) {
            return Err(KwdjError::new(KwdjErrorCode::InvalidStructure, path));
        }
        let node = candidate
            .node(id)
            .ok_or_else(|| KwdjError::new(KwdjErrorCode::InvalidStructure, path))?;
        if node.parent != parent {
            return Err(KwdjError::new(KwdjErrorCode::InvalidStructure, path));
        }
        let local = precharge(node, *budget, work)?;
        usage.payload_bytes = usage.payload_bytes.saturating_add(local.payload_bytes);
        usage.values = usage.values.saturating_add(local.values);
        usage.depth = usage.depth.max(depth.saturating_add(local.depth - 1));
        limit(
            "preflight_payload_bytes",
            budget.payload_bytes,
            usage.payload_bytes,
        )?;
        limit(
            "preflight_values",
            budget.values,
            usage.values.saturating_add(node.children.len() as u64),
        )?;
        limit("preflight_depth", budget.depth, usage.depth)?;
        *tree_depth = (*tree_depth).max(depth);
        work.charge_bytes(path.len() as u64)
            .map_err(KwdjError::operational)?;
        pending.push((id, path.to_owned()));
        for (index, child) in node.children.iter().enumerate() {
            walk(
                candidate,
                *child,
                id,
                &index_path(&key_path(path, "content"), index),
                depth + 1,
                state,
            )?;
        }
        Ok(())
    }
    for (index, id) in candidate.roots().iter().enumerate() {
        walk(
            candidate,
            *id,
            candidate.root(),
            &index_path("/content", index),
            1,
            &mut state,
        )?;
    }
    // Match the native snapshot bridge's pre-decode metrics checkpoint,
    // including its document-root diagnostic paths and complete observations.
    for (name, maximum, observed) in [
        ("tree_depth", limits.tree_depth, state.tree_depth),
        ("node_count", limits.node_count, state.seen.len() as u64),
    ] {
        editor_core::limits::check(name, maximum, observed)
            .map_err(|error| KwdjError::limit("", error.name, error.maximum, error.observed))?;
    }
    for (id, path) in state.pending {
        let node = candidate.node(id).expect("checked stable candidate");
        state
            .work
            .note_phase(editor_core::transaction::WorkPhase::Header, 1, 0);
        headers.insert(id, strict_header(node, &path)?);
    }
    Ok(CandidateView {
        source: candidate,
        headers,
    })
}

fn limit(name: &'static str, maximum: u64, observed: u64) -> Result<(), KwdjError> {
    editor_core::limits::check(name, maximum, observed).map_err(KwdjError::operational)
}

struct CountWriter<'a> {
    bytes: u64,
    work: &'a mut WorkMeter,
    refusal: Option<KwdjError>,
}

impl Write for CountWriter<'_> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if let Err(error) = self.work.charge_bytes(bytes.len() as u64) {
            self.refusal = Some(KwdjError::operational(error));
            return Err(io::Error::other("transaction byte budget"));
        }
        self.work.note_phase(
            editor_core::transaction::WorkPhase::Serialization,
            0,
            bytes.len() as u64,
        );
        self.bytes = self
            .bytes
            .checked_add(bytes.len() as u64)
            .ok_or_else(|| io::Error::other("encoded length overflow"))?;
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

pub(crate) fn count_json<T: serde::Serialize>(
    value: &T,
    work: &mut WorkMeter,
) -> Result<u64, KwdjError> {
    let mut writer = CountWriter {
        bytes: 0,
        work,
        refusal: None,
    };
    let result = serde_json::to_writer(&mut writer, value);
    if let Some(error) = writer.refusal {
        return Err(error);
    }
    result.map_err(|_| KwdjError::new(KwdjErrorCode::InvalidStructure, ""))?;
    Ok(writer.bytes)
}

pub(crate) fn validate_candidate<V: CandidateRead>(
    context: Profile,
    candidate: &V,
    identities: &dyn IdentityResolver,
    limits: Limits,
    budget: AdmissionBudget,
    work: &mut WorkMeter,
) -> Result<ValidationStats, KwdjError> {
    validate_outcome(context, candidate, identities, limits, budget, work).map(|(stats, _)| stats)
}

pub(crate) fn validate_outcome<V: CandidateRead>(
    context: Profile,
    candidate: &V,
    identities: &dyn IdentityResolver,
    limits: Limits,
    budget: AdmissionBudget,
    work: &mut WorkMeter,
) -> Result<(ValidationStats, crate::validate::Manifests), KwdjError> {
    let view = build_view(
        candidate,
        budget.effective().preflight,
        limits.effective(),
        work,
    )?;
    if !crate::edit_normalize::normalize_candidate(context, candidate, work)?.is_empty() {
        return Err(KwdjError::new(KwdjErrorCode::NonNormalized, ""));
    }
    let mut writer = CountWriter {
        bytes: 0,
        work,
        refusal: None,
    };
    let result = serde_json::to_writer(
        &mut writer,
        &DocumentWire {
            view: &view,
            profile: context,
        },
    );
    if let Some(error) = writer.refusal {
        return Err(error);
    }
    result.map_err(|_| KwdjError::new(KwdjErrorCode::InvalidStructure, ""))?;
    let canonical_bytes = writer.bytes;
    let validated = crate::validate::validate_view(
        &view,
        context,
        canonical_bytes,
        identities,
        limits.effective(),
        Some(work),
    )?;
    Ok((
        ValidationStats {
            canonical_bytes,
            nodes: validated.nodes,
        },
        validated,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        IdentityResolverError, IdentityStatus, admit_core_document_with_budget,
        decode_normalize_validate,
    };
    use editor_core::document::{Attribute, Attributes, Document, Mark, Primitive};
    use editor_core::transaction::WorkLimits;
    use serde_json::json;
    use std::cell::RefCell;
    use uuid::Uuid;

    struct Record {
        node: editor_core::document::Node,
        parent: usize,
        children: Vec<usize>,
    }
    struct FakeCandidate {
        roots: Vec<usize>,
        nodes: BTreeMap<usize, Record>,
    }
    impl FakeCandidate {
        fn new(document: Document) -> Self {
            fn add(
                node: editor_core::document::Node,
                parent: usize,
                nodes: &mut BTreeMap<usize, Record>,
                next: &mut usize,
            ) -> usize {
                let id = *next;
                *next += 1;
                let mut node = node;
                let children = std::mem::take(&mut node.children)
                    .into_iter()
                    .map(|child| add(child, id, nodes, next))
                    .collect();
                nodes.insert(
                    id,
                    Record {
                        node,
                        parent,
                        children,
                    },
                );
                id
            }
            let mut nodes = BTreeMap::new();
            let mut next = 1;
            let roots = document
                .children
                .into_iter()
                .map(|node| add(node, 0, &mut nodes, &mut next))
                .collect();
            Self { roots, nodes }
        }
    }
    impl CandidateRead for FakeCandidate {
        type Id = usize;
        fn root(&self) -> usize {
            0
        }
        fn roots(&self) -> &[usize] {
            &self.roots
        }
        fn node(&self, id: usize) -> Option<BorrowedNode<'_, usize>> {
            let record = self.nodes.get(&id)?;
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
    #[derive(Default)]
    struct Identities {
        calls: RefCell<Vec<(&'static str, Uuid)>>,
        missing: bool,
    }
    impl IdentityResolver for Identities {
        fn resolve_media(&self, id: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
            self.calls.borrow_mut().push(("media", *id));
            Ok(if self.missing {
                IdentityStatus::Missing
            } else {
                IdentityStatus::Exists
            })
        }
        fn resolve_reference(&self, id: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
            self.calls.borrow_mut().push(("reference", *id));
            Ok(if self.missing {
                IdentityStatus::Missing
            } else {
                IdentityStatus::Exists
            })
        }
    }
    fn source(profile: &str, content: Value) -> (Profile, Document, Vec<u8>) {
        let bytes = serde_json::to_vec(&json!({"schema":"klenwriter.document", "schema_version":1, "profile":profile, "content":content})).unwrap();
        let admitted = decode_normalize_validate(&bytes, &Identities::default()).unwrap();
        (
            admitted.document().profile(),
            admitted.document().to_core_document(),
            admitted.canonical_json().to_vec(),
        )
    }
    fn checkpoint(
        context: Profile,
        document: &Document,
        limits: Limits,
        missing: bool,
    ) -> Result<ValidationStats, KwdjError> {
        let native_identities = Identities {
            missing,
            ..Identities::default()
        };
        let borrowed_identities = Identities {
            missing,
            ..Identities::default()
        };
        let native = admit_core_document_with_budget(
            document,
            context,
            &native_identities,
            limits,
            AdmissionBudget::default(),
        );
        let candidate = FakeCandidate::new(document.clone());
        let borrowed = validate_outcome(
            context,
            &candidate,
            &borrowed_identities,
            limits,
            AdmissionBudget::default(),
            &mut WorkMeter::new(WorkLimits::default()),
        );
        assert_eq!(
            *native_identities.calls.borrow(),
            *borrowed_identities.calls.borrow(),
            "identity calls must match in order and deduplication: native={:?}, borrowed={:?}",
            native.as_ref().map(|value| value.canonical_json().len()),
            borrowed.as_ref().map(|value| value.0),
        );
        match (native, borrowed) {
            (Ok(native), Ok((stats, manifests))) => {
                assert_eq!(stats.canonical_bytes, native.canonical_json().len() as u64);
                assert_eq!(stats.nodes, native.document().structural_metrics().nodes);
                assert_eq!(manifests.media, native.media_manifest());
                assert_eq!(manifests.references, native.reference_manifest());
                Ok(stats)
            }
            (Err(native), Err(borrowed)) => {
                assert_eq!(native, borrowed);
                Err(borrowed)
            }
            (native, borrowed) => panic!(
                "native/borrowed checkpoint drift: native={native:?}, borrowed={:?}",
                borrowed.map(|value| value.0)
            ),
        }
    }

    #[test]
    fn accepted_corpus_has_exact_native_counts_manifests_and_identity_calls() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../contracts/kwdj/v1/fixtures");
        let mut checked = 0;
        for name in ["positive", "negative", "mixed"] {
            let fixture: Value =
                serde_json::from_slice(&std::fs::read(root.join(format!("{name}.json"))).unwrap())
                    .unwrap();
            for group in fixture["fixtures"].as_array().unwrap() {
                for case in group["cases"].as_array().unwrap() {
                    if case["expected"]["outcome"] != "accepted" || !case["kwdj"].is_object() {
                        continue;
                    }
                    let original = decode_normalize_validate(
                        &serde_json::to_vec(&case["kwdj"]).unwrap(),
                        &Identities::default(),
                    )
                    .unwrap();
                    checkpoint(
                        original.document().profile(),
                        &original.document().to_core_document(),
                        Limits::default(),
                        false,
                    )
                    .unwrap_or_else(|error| {
                        panic!("{} / {}: {error:?}", group["id"], case["name"])
                    });
                    checked += 1;
                }
            }
        }
        assert_eq!(
            checked, 29,
            "every accepted corpus document is checkpointed"
        );
    }

    #[test]
    fn all_seven_host_reduced_limits_share_exact_native_diagnostics() {
        let (context, prose, canonical) = source(
            "prose",
            json!([{"type":"paragraph", "content":[{"type":"text", "text":"four"}]}]),
        );
        let (table_context, table, _) = source(
            "prose",
            json!([{"type":"table", "content":[
                {"type":"table_row", "content":[{"type":"table_cell", "content":[{"type":"paragraph", "content":[]}]}, {"type":"table_cell", "content":[{"type":"paragraph", "content":[]}]}]},
                {"type":"table_row", "content":[{"type":"table_cell", "content":[{"type":"paragraph", "content":[]}]}, {"type":"table_cell", "content":[{"type":"paragraph", "content":[]}]}]}
            ]}]),
        );
        let (code_context, code, _) = source(
            "prose",
            json!([{"type":"code_block", "attrs":{"language":"rust"}, "content":[]} ]),
        );
        for (name, value, document, ctx, maximum) in [
            (
                "document_bytes",
                Limits {
                    document_bytes: canonical.len() as u64 - 1,
                    ..Limits::default()
                },
                &prose,
                context,
                canonical.len() as u64 - 1,
            ),
            (
                "tree_depth",
                Limits {
                    tree_depth: 1,
                    ..Limits::default()
                },
                &prose,
                context,
                1,
            ),
            (
                "node_count",
                Limits {
                    node_count: 1,
                    ..Limits::default()
                },
                &prose,
                context,
                1,
            ),
            (
                "text_length",
                Limits {
                    text_leaf_bytes: 3,
                    ..Limits::default()
                },
                &prose,
                context,
                3,
            ),
            (
                "table_rows",
                Limits {
                    table_rows: 1,
                    ..Limits::default()
                },
                &table,
                table_context,
                1,
            ),
            (
                "table_effective_columns",
                Limits {
                    table_effective_columns: 1,
                    ..Limits::default()
                },
                &table,
                table_context,
                1,
            ),
            (
                "attribute_length",
                Limits {
                    authored_attribute_bytes: 3,
                    ..Limits::default()
                },
                &code,
                code_context,
                3,
            ),
        ] {
            let error = checkpoint(ctx, document, value, false).unwrap_err();
            assert_eq!(error.code, KwdjErrorCode::ResourceLimitExceeded);
            assert_eq!(error.context.limit, Some(name));
            assert_eq!(error.context.maximum, Some(maximum));
            assert!(error.context.observed.unwrap() > maximum);
        }
    }

    #[test]
    fn typed_business_refusals_and_identity_failures_match_native() {
        let (context, mut links, _) = source(
            "prose",
            json!([{"type":"paragraph", "content":[{"type":"text", "text":"reference", "marks":[{"type":"reference_link", "attrs":{"reference_entity_id":"00000000-0000-4000-8000-000000000001"}}]}]}]),
        );
        assert_eq!(
            checkpoint(context, &links, Limits::default(), true)
                .unwrap_err()
                .code,
            KwdjErrorCode::MissingReferenceIdentity
        );
        links.children[0].children[0].marks = vec![Mark {
            type_id: "org.klenwriter.kwdj/link".into(),
            attributes: Attributes::from([(
                "href".into(),
                Attribute::String("javascript:alert(1)".into()),
            )]),
        }];
        assert_eq!(
            checkpoint(context, &links, Limits::default(), false)
                .unwrap_err()
                .code,
            KwdjErrorCode::UnsafeUrl
        );
        let (context, mut warning, _) = source(
            "prose",
            json!([{"type":"warning", "attrs":{"kind":"general"}, "content":[{"type":"paragraph", "content":[]}]}]),
        );
        warning.children[0].children = vec![warning.children[0].clone()];
        assert_eq!(
            checkpoint(context, &warning, Limits::default(), false)
                .unwrap_err()
                .code,
            KwdjErrorCode::RecursiveWarning
        );
        let (context, mut prose, _) = source("prose", json!([{"type":"paragraph", "content":[]} ]));
        prose.children[0].children = vec![editor_core::document::Node {
            type_id: "org.klenwriter.kwdj/hard_break".into(),
            primitive: Primitive::HardBreak,
            attributes: Attributes::from([("unexpected".into(), Attribute::Boolean(true))]),
            marks: vec![],
            text: None,
            children: vec![],
        }];
        assert_eq!(
            checkpoint(context, &prose, Limits::default(), false)
                .unwrap_err()
                .code,
            KwdjErrorCode::UnknownAttribute
        );
    }

    #[test]
    fn u64_max_metadata_and_borrowed_text_are_counted_without_snapshot_copies() {
        let (context, document, canonical) = source(
            "poetry",
            json!([{"type":"verse", "content":[{"type":"verse_line", "content":[{"type":"text", "text":"a\"\\\n😀e\u{0301}"}]}, {"type":"stanza_break", "attrs":{"blank_lines":u64::MAX}}, {"type":"verse_line", "content":[]}]}]),
        );
        let stats = checkpoint(context, &document, Limits::default(), false).unwrap();
        assert_eq!(stats.canonical_bytes, canonical.len() as u64);
        let candidate = FakeCandidate::new(document);
        let mut work = WorkMeter::new(WorkLimits::default());
        let view = build_view(
            &candidate,
            PreflightBudget::default(),
            Limits::default(),
            &mut work,
        )
        .unwrap();
        for (id, record) in &candidate.nodes {
            if let Some(actual) = &record.node.text {
                assert!(
                    view.headers[id].text().unwrap().is_empty(),
                    "headers hold a presence marker, not copied text"
                );
                assert_eq!(
                    view.source.node(*id).unwrap().text.unwrap().as_ptr(),
                    actual.as_ptr()
                );
            }
            assert!(
                view.headers[id].children().is_empty(),
                "typed headers never own actual child subtrees"
            );
        }
        let mut no_work = WorkMeter::new(WorkLimits {
            units: 0,
            bytes: 64 * 1024 * 1024,
        });
        let identities = Identities::default();
        let error = validate_candidate(
            context,
            &candidate,
            &identities,
            Limits::default(),
            AdmissionBudget::default(),
            &mut no_work,
        )
        .unwrap_err();
        assert_eq!(error.code, KwdjErrorCode::OperationalBudgetExceeded);
        assert_eq!(error.context.limit, Some("transaction_work"));
        assert!(identities.calls.borrow().is_empty());
    }

    #[test]
    fn unstable_shape_graphs_and_unknown_authored_data_refuse_before_publication() {
        let (context, document, _) = source(
            "prose",
            json!([{"type":"paragraph", "content":[{"type":"text", "text":"text"}]}]),
        );
        let mut candidate = FakeCandidate::new(document);
        let first = candidate.roots[0];
        candidate
            .nodes
            .get_mut(&first)
            .unwrap()
            .children
            .push(first);
        let error = validate_candidate(
            context,
            &candidate,
            &Identities::default(),
            Limits::default(),
            AdmissionBudget::default(),
            &mut WorkMeter::new(WorkLimits::default()),
        )
        .unwrap_err();
        assert_eq!(error.code, KwdjErrorCode::InvalidStructure);

        // A leaf's child collection must remain visible to closed decoding;
        // shallow metadata headers must never hide an authored child subtree.
        let (context, mut document, _) = source(
            "prose",
            json!([{"type":"paragraph", "content":[{"type":"text", "text":"text"}]}]),
        );
        document.children[0].children[0]
            .children
            .push(editor_core::document::Node {
                type_id: "org.klenwriter.kwdj/hard_break".into(),
                primitive: Primitive::HardBreak,
                attributes: Attributes::new(),
                marks: Vec::new(),
                text: None,
                children: Vec::new(),
            });
        assert_eq!(
            checkpoint(context, &document, Limits::default(), false)
                .unwrap_err()
                .code,
            KwdjErrorCode::UnknownAttribute
        );
    }

    #[test]
    fn remaining_work_caps_metadata_before_shallow_copy_or_unbounded_scan() {
        let (_, mut document, _) = source("prose", json!([{"type":"paragraph", "content":[]}]));
        document.children[0].attributes = (0..10_000)
            .map(|index| (format!("key{index}"), Attribute::String("value".into())))
            .collect();
        let candidate = FakeCandidate::new(document);
        let mut work = WorkMeter::new(WorkLimits {
            units: 1,
            bytes: 64 * 1024 * 1024,
        });
        let error = precharge(
            candidate.node(candidate.roots[0]).unwrap(),
            PreflightBudget::default(),
            &mut work,
        )
        .unwrap_err();
        assert_eq!(error.code, KwdjErrorCode::OperationalBudgetExceeded);
        assert_eq!(error.context.limit, Some("transaction_work"));
        assert_eq!(error.context.maximum, Some(1));
        assert_eq!(
            work.usage().units,
            0,
            "scan refuses before committing a work charge or copying metadata"
        );
        let mut work = WorkMeter::new(WorkLimits {
            units: 1_000_000,
            bytes: 1,
        });
        let error = precharge(
            candidate.node(candidate.roots[0]).unwrap(),
            PreflightBudget::default(),
            &mut work,
        )
        .unwrap_err();
        assert_eq!(error.context.limit, Some("transaction_bytes"));
        assert_eq!(error.context.maximum, Some(1));
    }

    #[test]
    fn automatic_cleanup_cannot_erase_invalid_reference_url_or_stanza_payload() {
        use editor_core::transaction::TransactionProfile;
        let (context, mut document, _) = source(
            "prose",
            json!([{"type":"paragraph", "content":[{"type":"text", "text":"link", "marks":[{"type":"reference_link", "attrs":{"reference_entity_id":"00000000-0000-4000-8000-000000000001"}}]}]}]),
        );
        document.children[0].children[0].text = Some(String::new());
        let missing = Identities {
            missing: true,
            ..Identities::default()
        };
        let profile =
            crate::KwdjProfile::new(&missing, Limits::default(), AdmissionBudget::default());
        let error = profile
            .normalize_candidate(
                &context,
                &FakeCandidate::new(document.clone()),
                &mut WorkMeter::new(WorkLimits::default()),
            )
            .unwrap_err();
        let crate::KwdjProfileError::Document(error) = error else {
            panic!("document refusal expected")
        };
        assert_eq!(error.code, KwdjErrorCode::MissingReferenceIdentity);
        assert_eq!(
            error.path,
            "/content/0/content/0/marks/0/attrs/reference_entity_id"
        );

        document.children[0].children[0].marks = vec![Mark {
            type_id: "org.klenwriter.kwdj/link".into(),
            attributes: Attributes::from([(
                "href".into(),
                Attribute::String("javascript:alert(1)".into()),
            )]),
        }];
        let error = profile
            .normalize_candidate(
                &context,
                &FakeCandidate::new(document.clone()),
                &mut WorkMeter::new(WorkLimits::default()),
            )
            .unwrap_err();
        let crate::KwdjProfileError::Document(error) = error else {
            panic!("document refusal expected")
        };
        assert_eq!(error.code, KwdjErrorCode::UnsafeUrl);

        document.children[0].children[0].marks.clear();
        assert!(matches!(
            profile
                .normalize_candidate(
                    &context,
                    &FakeCandidate::new(document),
                    &mut WorkMeter::new(WorkLimits::default())
                )
                .unwrap()
                .as_slice(),
            [Operation::Remove { .. }]
        ));
        let (context, document, _) = source(
            "poetry",
            json!([{"type":"verse", "content":[{"type":"verse_line", "content":[]}, {"type":"stanza_break", "attrs":{"blank_lines":1}}, {"type":"verse_line", "content":[]}]}]),
        );
        for index in [1, 2] {
            let mut document = document.clone();
            let mut zero = document.children[0].children[1].clone();
            zero.attributes
                .insert("blank_lines".into(), Attribute::Number(0.into()));
            document.children[0].children.insert(index, zero);
            let error = profile
                .normalize_candidate(
                    &context,
                    &FakeCandidate::new(document),
                    &mut WorkMeter::new(WorkLimits::default()),
                )
                .unwrap_err();
            let crate::KwdjProfileError::Document(error) = error else {
                panic!("document refusal expected")
            };
            assert_eq!(error.code, KwdjErrorCode::InvalidVerse);
            assert_eq!(error.path, format!("/content/0/content/{index}"));
        }
    }
}
