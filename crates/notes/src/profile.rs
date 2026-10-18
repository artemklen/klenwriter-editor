// SPDX-License-Identifier: MIT OR Apache-2.0
use std::sync::Arc;

use editor_core::admission::{PreflightBudget, preflight_snapshot};
use editor_core::candidate::CandidateRead;
use editor_core::document::{Attribute, Attributes, Document, Node, Primitive};
use editor_core::profile::{AdmissionMode, FrozenProfile, ProfileBinding};
use editor_core::transaction::{
    Operation, TransactionProfile, ValidationStats, WorkLimits, WorkMeter,
};
use editor_registry::{
    CompilerLimits, FrozenRegistry, RegistryDescriptor, RegistryDigest, compile_descriptor,
};

use crate::{
    BASE_EXTENSION, CODEC_ID, DOCUMENT, NotesError, NotesErrorCode as E, PROFILE_ID, VERSION,
    base_registration, borrowed::DocumentView,
};

/// Independent notes operational ceilings. Host reductions cannot raise them.
/// These do not alter any KWDJ normative maximum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NotesLimits {
    pub document_bytes: u64,
    pub node_count: u64,
    pub tree_depth: u64,
    pub text_leaf_bytes: u64,
    pub work: WorkLimits,
}
impl Default for NotesLimits {
    fn default() -> Self {
        Self {
            document_bytes: 16 * 1024 * 1024,
            node_count: 65_536,
            tree_depth: 48,
            text_leaf_bytes: 1024 * 1024,
            work: WorkLimits::default(),
        }
    }
}
impl NotesLimits {
    pub fn effective(self) -> Self {
        let hard = Self::default();
        Self {
            document_bytes: self.document_bytes.min(hard.document_bytes),
            node_count: self.node_count.min(hard.node_count),
            tree_depth: self.tree_depth.min(hard.tree_depth),
            text_leaf_bytes: self.text_leaf_bytes.min(hard.text_leaf_bytes),
            work: WorkLimits {
                units: self.work.units.min(hard.work.units),
                bytes: self.work.bytes.min(hard.work.bytes),
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotesContext {
    registry: RegistryDigest,
}

/// Only profile admission can construct this semantic/canonical pair.
pub struct AdmittedNotes {
    document: Document,
    canonical: Vec<u8>,
    context: NotesContext,
}
impl AdmittedNotes {
    pub fn document(&self) -> &Document {
        &self.document
    }
    pub fn canonical_json(&self) -> &[u8] {
        &self.canonical
    }
}

#[derive(Clone)]
pub struct NotesProfile {
    registry: Arc<FrozenRegistry>,
    limits: NotesLimits,
}
impl NotesProfile {
    /// The trusted composer supplies the mandatory base. Raw descriptors cannot
    /// replace/weaken that owner. `root_blocks` is explicit initial policy,
    /// supports arbitrary admitted block IDs and is included in the digest.
    pub fn compile(
        descriptor: &RegistryDescriptor,
        root_blocks: &[String],
        limits: NotesLimits,
        compiler_limits: CompilerLimits,
        work: &mut WorkMeter,
    ) -> Result<Self, NotesError> {
        if descriptor.profile.id != PROFILE_ID
            || descriptor.profile.version != VERSION
            || descriptor.profile.codec_id != CODEC_ID
            || descriptor.profile.wire_version != 1
        {
            return Err(NotesError::new(E::InvalidRegistry, ""));
        }
        let base = Self::mandatory_base(root_blocks, work)?;
        let registry = compile_descriptor(descriptor, &[base], compiler_limits, work)
            .map_err(NotesError::compiler)?;
        Self::from_registry(registry, root_blocks, limits, work)
    }

    /// Preserve original descriptor bytes for duplicate-key/numeric-bound
    /// preflight. The caller never parses/re-serializes the raw registry first.
    pub fn compile_json(
        descriptor: &[u8],
        root_blocks: &[String],
        limits: NotesLimits,
        compiler_limits: CompilerLimits,
        work: &mut WorkMeter,
    ) -> Result<Self, NotesError> {
        let base = Self::mandatory_base(root_blocks, work)?;
        let registry = editor_registry::compile_json(descriptor, &[base], compiler_limits, work)
            .map_err(NotesError::compiler)?;
        Self::from_registry(registry, root_blocks, limits, work)
    }

    fn mandatory_base(
        root_blocks: &[String],
        work: &mut WorkMeter,
    ) -> Result<editor_registry::ExtensionDescriptor, NotesError> {
        if root_blocks.is_empty() || root_blocks.len() > 1024 {
            return Err(NotesError::new(E::InvalidRegistry, "/root_blocks"));
        }
        work.charge_units(root_blocks.len() as u64)?;
        for id in root_blocks {
            if id.len() > 128 {
                return Err(NotesError::new(E::InvalidRegistry, "/root_blocks"));
            }
            work.charge_bytes((id.len() * 4 + 128) as u64)?;
        }
        work.charge_units(64)?;
        work.charge_bytes(4096)?;
        Ok(base_registration(root_blocks))
    }

    fn from_registry(
        registry: FrozenRegistry,
        root_blocks: &[String],
        limits: NotesLimits,
        work: &mut WorkMeter,
    ) -> Result<Self, NotesError> {
        let binding = registry.binding();
        if binding.profile_id() != PROFILE_ID
            || binding.profile_version() != VERSION
            || binding.codec_id() != CODEC_ID
            || binding.wire_version() != 1
        {
            return Err(NotesError::new(E::InvalidRegistry, "/profile"));
        }
        for id in root_blocks {
            let node = registry
                .node(id)
                .ok_or_else(|| NotesError::new(E::InvalidRegistry, "/root_blocks"))?;
            if !matches!(
                node.descriptor.primitive.core(),
                Primitive::Container | Primitive::TextBlock | Primitive::BlockAtom
            ) {
                return Err(NotesError::new(E::InvalidRegistry, "/root_blocks"));
            }
        }
        // Mandatory registration and exact binding are independently checked by
        // the public compiler; no public from-unchecked-registry constructor.
        if !registry
            .binding()
            .extensions()
            .iter()
            .any(|e| e.id() == BASE_EXTENSION && e.version() == VERSION)
        {
            return Err(NotesError::new(E::InvalidRegistry, ""));
        }
        // The compiled base always allows empty semantic document content.
        // Probe the compiled root grammar itself without reparsing JSON or
        // duplicating the registry matcher; incompatible root policy refuses
        // before any authored document is decoded.
        work.charge_bytes(
            2048 + std::mem::size_of::<FrozenRegistry>() as u64
                + 2 * std::mem::size_of::<usize>() as u64,
        )?;
        let probe = Document {
            children: vec![Node {
                type_id: DOCUMENT.into(),
                primitive: Primitive::Container,
                attributes: Attributes::from([
                    ("title".into(), Attribute::String(String::new())),
                    ("tags".into(), Attribute::List(vec![])),
                ]),
                marks: vec![],
                text: None,
                children: vec![],
            }],
        };
        registry
            .validate_full(&DocumentView::new(&probe, work)?, work)
            .map_err(NotesError::compiler)?;
        Ok(Self {
            registry: Arc::new(registry),
            limits: limits.effective(),
        })
    }
    pub fn registry(&self) -> &FrozenRegistry {
        &self.registry
    }
    /// Share the exact compiled registry owned by this frozen profile.
    pub fn registry_handle(&self) -> Arc<FrozenRegistry> {
        Arc::clone(&self.registry)
    }
    pub fn limits(&self) -> NotesLimits {
        self.limits
    }
    fn context_value(&self) -> NotesContext {
        NotesContext {
            registry: self.registry.digest(),
        }
    }
    pub(crate) fn check_context(&self, context: &NotesContext) -> Result<(), NotesError> {
        if *context == self.context_value() {
            Ok(())
        } else {
            Err(NotesError::new(E::InvalidRegistry, ""))
        }
    }
    fn check_root<V: CandidateRead>(&self, view: &V) -> Result<(), NotesError> {
        if view.roots().len() != 1
            || view
                .node(view.roots()[0])
                .is_none_or(|node| node.type_id != DOCUMENT)
        {
            return Err(NotesError::new(E::InvalidStructure, "/root/type"));
        }
        Ok(())
    }
    fn schema<V: CandidateRead>(&self, view: &V, work: &mut WorkMeter) -> Result<u64, NotesError> {
        self.check_root(view)?;
        let count = crate::borrowed::walk(view, self.limits, work, |_, _, _, _| Ok(()))?;
        self.registry
            .validate_full(view, work)
            .map_err(NotesError::schema)?;
        Ok(count)
    }
    fn preflight(&self, document: &Document, work: &mut WorkMeter) -> Result<(), NotesError> {
        let left = work.limits();
        let spent = work.usage();
        let metrics = preflight_snapshot(
            document,
            PreflightBudget {
                payload_bytes: self
                    .limits
                    .document_bytes
                    .min(left.bytes.saturating_sub(spent.bytes)),
                values: left.units.saturating_sub(spent.units),
                depth: 128,
            },
        )?;
        work.charge_units(metrics.usage.values)?;
        work.charge_bytes(metrics.usage.payload_bytes)?;
        if metrics.nodes > self.limits.node_count || metrics.tree_depth > self.limits.tree_depth {
            return Err(NotesError::new(E::ResourceLimitExceeded, ""));
        }
        Ok(())
    }
    fn finish_document(
        &self,
        document: Document,
        work: &mut WorkMeter,
    ) -> Result<AdmittedNotes, NotesError> {
        self.preflight(&document, work)?;
        let view = DocumentView::new(&document, work)?;
        self.validate_candidate(&self.context_value(), &view, work)?;
        let (_, canonical) = crate::wire::encode(&view, self.limits, work, true)?;
        Ok(AdmittedNotes {
            document,
            canonical: canonical.expect("explicit owned encoding"),
            context: self.context_value(),
        })
    }
}

impl FrozenProfile for NotesProfile {
    type Context = NotesContext;
    type Admitted = AdmittedNotes;
    type Error = NotesError;
    type Cache<I: Copy + Eq + Ord> = ();
    fn transaction_work_limits(&self) -> Option<WorkLimits> {
        Some(self.limits.work)
    }
    fn binding(&self) -> &ProfileBinding {
        self.registry.binding()
    }
    fn admit_bytes(
        &self,
        requested: &ProfileBinding,
        input: &[u8],
        mode: AdmissionMode,
    ) -> Result<AdmittedNotes, NotesError> {
        self.binding().ensure_matches(requested)?;
        let mut work = WorkMeter::new(self.limits.work);
        let mut document = crate::codec::decode(input, &self.registry, self.limits, &mut work)?;
        if mode == AdmissionMode::Import {
            // Validate all authored data before any join can discard a record.
            self.preflight(&document, &mut work)?;
            self.schema(&DocumentView::new(&document, &mut work)?, &mut work)?;
            crate::codec::import_join(&mut document, self.limits, &mut work)?;
        }
        self.finish_document(document, &mut work)
    }
    fn context(&self, admitted: &AdmittedNotes) -> NotesContext {
        admitted.context.clone()
    }
    fn to_document(&self, admitted: &AdmittedNotes) -> Document {
        admitted.document.clone()
    }
    fn admit_snapshot(
        &self,
        context: &NotesContext,
        document: &Document,
    ) -> Result<AdmittedNotes, NotesError> {
        self.check_context(context)?;
        let mut work = WorkMeter::new(self.limits.work);
        self.preflight(document, &mut work)?;
        let view = DocumentView::new(document, &mut work)?;
        self.validate_candidate(context, &view, &mut work)?;
        let (_, canonical) = crate::wire::encode(&view, self.limits, &mut work, true)?;
        // Explicit snapshot boundary, after borrowed preflight/validation.
        let remaining = work.limits();
        let spent = work.usage();
        let copy = preflight_snapshot(
            document,
            PreflightBudget {
                payload_bytes: remaining.bytes.saturating_sub(spent.bytes),
                values: remaining.units.saturating_sub(spent.units),
                depth: 128,
            },
        )?;
        work.charge_units(copy.usage.values)?;
        work.charge_bytes(
            copy.usage
                .payload_bytes
                .saturating_add(copy.usage.values.saturating_mul(128))
                .saturating_add(
                    copy.nodes
                        .saturating_mul(std::mem::size_of::<Node>() as u64),
                ),
        )?;
        Ok(AdmittedNotes {
            document: document.clone(),
            canonical: canonical.expect("owned encoding"),
            context: context.clone(),
        })
    }
    fn canonical<'a>(&self, admitted: &'a AdmittedNotes) -> &'a [u8] {
        &admitted.canonical
    }
}

impl editor_registry::RegistryProfile for NotesProfile {
    fn registry(&self) -> &FrozenRegistry {
        &self.registry
    }
}

impl TransactionProfile for NotesProfile {
    fn normalize_candidate<V: CandidateRead>(
        &self,
        context: &NotesContext,
        view: &V,
        work: &mut WorkMeter,
    ) -> Result<Vec<Operation<V::Id>>, NotesError> {
        self.check_context(context)?;
        self.check_root(view)?;
        // Edits can temporarily split a single schema text child into several
        // identical runs. Preserve every authored metadata error before joining,
        // then let final validation enforce the complete children grammar.
        // Import and strict codec admission retain their grammar-first pass.
        crate::borrowed::walk(view, self.limits, work, |_, node, path, work| {
            let suffix = path.strip_prefix("/root").unwrap_or(path);
            work.charge_bytes((suffix.len() + "/children/0".len()) as u64)?;
            let schema_path = format!("/children/0{suffix}");
            self.registry
                .validate_node_metadata(&node, &schema_path, work)
                .map_err(NotesError::schema)
        })?;
        let result = crate::borrowed::first_join(view, self.limits, work)?;
        match result {
            None => Ok(vec![]),
            Some(proposal) => {
                work.charge_bytes(std::mem::size_of::<Operation<V::Id>>() as u64)?;
                Ok(vec![proposal.operation])
            }
        }
    }
    fn validate_candidate<V: CandidateRead>(
        &self,
        context: &NotesContext,
        view: &V,
        work: &mut WorkMeter,
    ) -> Result<ValidationStats, NotesError> {
        self.check_context(context)?;
        let nodes = self.schema(view, work)?;
        if let Some(proposal) = crate::borrowed::first_join(view, self.limits, work)? {
            return Err(NotesError::new(E::NotNormal, &proposal.path));
        }
        let (canonical_bytes, _) = crate::wire::encode(view, self.limits, work, false)?;
        Ok(ValidationStats {
            canonical_bytes,
            nodes,
        })
    }
}
