// SPDX-License-Identifier: MIT OR Apache-2.0
//! Frozen KWDJ adapter for explicit session admission and snapshot export.
//!
//! Profile compatibility version `1.0.0` is a new, explicit bootstrap binding
//! choice for this compiled adapter's semantics. It is independent of the Cargo
//! package `0.0.0`, persisted KWDJ schema version 1, and codec WASM ABI. It does
//! not announce a registry release or a stable public session SDK.

use std::rc::Rc;
use std::sync::Arc;

use editor_core::candidate::CandidateRead;
use editor_core::document::Document;
use editor_core::profile::{AdmissionMode, BindingError, FrozenProfile, ProfileBinding};
use editor_core::transaction::{Operation, TransactionProfile, ValidationStats, WorkMeter};
use editor_registry::{CompilerLimits, FrozenRegistry, RegistryDescriptor, RegistryDiagnostic};
use thiserror::Error;

use crate::{
    AdmissionBudget, IdentityResolver, KwdjError, Limits, PROFILE_ID, Profile, ValidatedDocument,
    admit_core_document_with_budget, validate_normalized_json_with_limits_and_budget,
};

pub const KWDJ_PROFILE_VERSION: &str = "1.0.0";
pub const KWDJ_CODEC_ID: &str = "org.klenwriter.kwdj/json";
pub const KWDJ_BASE_EXTENSION_ID: &str = "org.klenwriter.kwdj/base";
pub const KWDJ_BASE_EXTENSION_VERSION: &str = "1.0.0";

enum ResolverBacking<'a> {
    Borrowed(&'a dyn IdentityResolver),
    OwnedRc(Rc<dyn IdentityResolver>),
}

/// Trusted compiled KWDJ semantics with borrowed or owned synchronous services.
///
/// Its public frozen schema is compiled through the same registration API used
/// by external profiles. The normative codec still owns all KWDJ domain rules.
pub struct KwdjProfile<'a> {
    binding: ProfileBinding,
    registry: Arc<FrozenRegistry>,
    identities: ResolverBacking<'a>,
    limits: Limits,
    budget: AdmissionBudget,
    clipboard_v2: bool,
}

impl<'a> KwdjProfile<'a> {
    pub fn new(
        identities: &'a dyn IdentityResolver,
        limits: Limits,
        budget: AdmissionBudget,
    ) -> Self {
        Self::with_resolver(ResolverBacking::Borrowed(identities), limits, budget)
    }

    fn with_resolver(
        identities: ResolverBacking<'a>,
        limits: Limits,
        budget: AdmissionBudget,
    ) -> Self {
        let registry = crate::registry::default_registry();
        let binding = registry.binding().clone();
        Self {
            binding,
            registry,
            identities,
            limits: limits.effective(),
            budget: budget.effective(),
            clipboard_v2: false,
        }
    }

    pub(crate) fn identities(&self) -> &dyn IdentityResolver {
        match &self.identities {
            ResolverBacking::Borrowed(identities) => *identities,
            ResolverBacking::OwnedRc(identities) => identities.as_ref(),
        }
    }

    pub fn limits(&self) -> Limits {
        self.limits
    }

    pub fn budget(&self) -> AdmissionBudget {
        self.budget
    }

    pub fn registry(&self) -> &FrozenRegistry {
        &self.registry
    }
    pub fn registry_handle(&self) -> Arc<FrozenRegistry> {
        Arc::clone(&self.registry)
    }
    pub(crate) fn clipboard_v2(&self) -> bool {
        self.clipboard_v2
    }

    pub fn with_clipboard_registry_json(
        self,
        input: &[u8],
        limits: CompilerLimits,
        work: &mut WorkMeter,
    ) -> Result<Self, KwdjProfileError> {
        let registry = editor_registry::compile_json(
            input,
            &[crate::registry::base_registration_v2()],
            limits,
            work,
        )?;
        let mut profile = self.with_compiled_registry(registry)?;
        profile.clipboard_v2 = true;
        Ok(profile)
    }

    /// Consumes an unmounted profile. Mandatory KWDJ definitions always come
    /// from this compiled module; host JSON cannot replace them. No Session
    /// exposes its owned profile for reconfiguration.
    pub fn with_registry_json(
        self,
        input: &[u8],
        limits: CompilerLimits,
        work: &mut WorkMeter,
    ) -> Result<Self, KwdjProfileError> {
        let registry = editor_registry::compile_json(
            input,
            &[crate::registry::base_registration()],
            limits,
            work,
        )?;
        self.with_compiled_registry(registry)
    }

    pub fn with_registry_descriptor(
        self,
        descriptor: &RegistryDescriptor,
        limits: CompilerLimits,
        work: &mut WorkMeter,
    ) -> Result<Self, KwdjProfileError> {
        let registry = editor_registry::compile_descriptor(
            descriptor,
            &[crate::registry::base_registration()],
            limits,
            work,
        )?;
        self.with_compiled_registry(registry)
    }

    fn with_compiled_registry(
        mut self,
        registry: FrozenRegistry,
    ) -> Result<Self, KwdjProfileError> {
        let expected = ProfileBinding::new(
            PROFILE_ID,
            KWDJ_PROFILE_VERSION,
            KWDJ_CODEC_ID,
            1,
            registry.binding().extensions(),
        )?;
        expected.ensure_matches(registry.binding())?;
        self.binding = registry.binding().clone();
        self.registry = Arc::new(registry);
        Ok(self)
    }
}

impl KwdjProfile<'static> {
    /// Own the shared resolver without a self-reference or leaked lifetime.
    /// The resolver must not call host JavaScript during native preparation; its
    /// current facts may be updated by its owner outside active Session calls.
    pub fn new_owned(
        identities: Rc<dyn IdentityResolver>,
        limits: Limits,
        budget: AdmissionBudget,
    ) -> Self {
        Self::with_resolver(ResolverBacking::OwnedRc(identities), limits, budget)
    }
}

impl std::fmt::Debug for KwdjProfile<'_> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("KwdjProfile")
            .field("binding", &self.binding)
            .field("limits", &self.limits)
            .field("budget", &self.budget)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum KwdjProfileError {
    #[error("{0}")]
    Binding(#[from] BindingError),
    #[error("{0}")]
    Document(#[from] KwdjError),
    #[error("{0}")]
    Registry(#[from] RegistryDiagnostic),
}

impl FrozenProfile for KwdjProfile<'_> {
    type Context = Profile;
    type Admitted = ValidatedDocument;
    type Error = KwdjProfileError;
    type Cache<I: Copy + Eq + Ord> = crate::registry::KwdjProfileCache<I>;

    fn admission_cache_work_limits(&self) -> editor_core::transaction::WorkLimits {
        editor_core::transaction::ADMISSION_CACHE_WORK_LIMITS
    }

    fn seed_cache<V: CandidateRead>(
        &self,
        admitted: &Self::Admitted,
        view: &V,
        work: &mut WorkMeter,
    ) -> Result<Self::Cache<V::Id>, Self::Error> {
        let domain = crate::candidate_cache::seed(
            admitted.document().profile(),
            view,
            self.limits,
            self.budget,
            work,
        )?;
        let prepared = self.registry.validate_full(view, work)?;
        let mut schema = Default::default();
        prepared.cache.publish(&mut schema);
        Ok(crate::registry::KwdjProfileCache { domain, schema })
    }

    fn binding(&self) -> &ProfileBinding {
        &self.binding
    }

    fn admit_bytes(
        &self,
        requested: &ProfileBinding,
        input: &[u8],
        mode: AdmissionMode,
    ) -> Result<Self::Admitted, Self::Error> {
        self.binding.ensure_matches(requested)?;
        Ok(match mode {
            AdmissionMode::Strict => validate_normalized_json_with_limits_and_budget(
                input,
                self.identities(),
                self.limits,
                self.budget,
            )?,
            AdmissionMode::Import => {
                let candidate = crate::decode_candidate_with_limits_and_budget(
                    input,
                    self.limits,
                    self.budget,
                )?;
                let mut work = WorkMeter::new(editor_core::transaction::WorkLimits::default());
                crate::registry_guards::imported(
                    &self.registry,
                    &candidate.value,
                    self.budget,
                    &mut work,
                )?;
                crate::normalize_and_validate(candidate, self.identities())?
            }
        })
    }

    fn context(&self, admitted: &Self::Admitted) -> Self::Context {
        admitted.document().profile()
    }

    fn to_document(&self, admitted: &Self::Admitted) -> Document {
        admitted.document().to_core_document()
    }

    fn admit_snapshot(
        &self,
        context: &Self::Context,
        document: &Document,
    ) -> Result<Self::Admitted, Self::Error> {
        Ok(admit_core_document_with_budget(
            document,
            *context,
            self.identities(),
            self.limits,
            self.budget,
        )?)
    }

    fn canonical<'a>(&self, admitted: &'a Self::Admitted) -> &'a [u8] {
        admitted.canonical_json()
    }
}

impl TransactionProfile for KwdjProfile<'_> {
    fn normalize_scoped<V: editor_core::candidate::CandidateChanges>(
        &self,
        context: &Self::Context,
        view: &V,
        cache: &Self::Cache<V::Id>,
        work: &mut WorkMeter,
    ) -> Result<Vec<Operation<V::Id>>, Self::Error> {
        let ops = crate::candidate_cache::normalize(
            *context,
            view,
            &cache.domain,
            self.identities(),
            self.limits,
            self.budget,
            work,
        )?;
        let cached = cache
            .domain
            .matches(*context, view, self.limits, self.budget);
        crate::registry_guards::discarded(
            &self.registry,
            view,
            &ops,
            self.budget,
            work,
            |id, work| {
                if cached {
                    crate::candidate_cache::current_path(view, &cache.domain, id, work)
                } else {
                    crate::registry_guards::uncached_path(view, id, work)
                }
            },
        )?;
        Ok(ops)
    }
    fn validate_scoped<V: editor_core::candidate::CandidateChanges>(
        &self,
        context: &Self::Context,
        view: &V,
        cache: &Self::Cache<V::Id>,
        work: &mut WorkMeter,
    ) -> Result<editor_core::cache::PreparedValidation<Self::Cache<V::Id>>, Self::Error> {
        let domain = crate::candidate_cache::validate(
            *context,
            view,
            &cache.domain,
            self.identities(),
            self.limits,
            self.budget,
            work,
        )?;
        let schema = self.registry.validate_scoped(view, &cache.schema, work)?;
        Ok(editor_core::cache::PreparedValidation {
            stats: domain.stats,
            cache: editor_core::cache::CacheUpdate::Patch(crate::registry::KwdjProfileCachePatch {
                domain: domain.cache,
                schema: schema.cache,
            }),
        })
    }
    fn normalize_candidate<V: CandidateRead>(
        &self,
        context: &Self::Context,
        candidate: &V,
        work: &mut WorkMeter,
    ) -> Result<Vec<Operation<V::Id>>, Self::Error> {
        let operations = crate::edit_normalize::normalize_candidate(*context, candidate, work)?;
        crate::candidate_validate::check_discarded_metadata(
            candidate,
            &operations,
            self.identities(),
            self.limits,
            self.budget,
            work,
        )?;
        crate::registry_guards::discarded(
            &self.registry,
            candidate,
            &operations,
            self.budget,
            work,
            |id, work| crate::registry_guards::uncached_path(candidate, id, work),
        )?;
        Ok(operations)
    }

    fn validate_candidate<V: CandidateRead>(
        &self,
        context: &Self::Context,
        candidate: &V,
        work: &mut WorkMeter,
    ) -> Result<ValidationStats, Self::Error> {
        let stats = crate::candidate_validate::validate_candidate(
            *context,
            candidate,
            self.identities(),
            self.limits,
            self.budget,
            work,
        )?;
        self.registry.validate_full(candidate, work)?;
        Ok(stats)
    }
}

#[cfg(test)]
mod owned_tests {
    use super::*;
    use crate::{IdentityResolverError, IdentityStatus, KwdjErrorCode};
    use std::cell::Cell;
    use uuid::Uuid;

    struct Facts {
        current: Cell<Result<IdentityStatus, IdentityResolverError>>,
        calls: Cell<usize>,
        drops: Rc<Cell<usize>>,
    }
    impl Facts {
        fn new(drops: Rc<Cell<usize>>) -> Self {
            Self {
                current: Cell::new(Ok(IdentityStatus::Exists)),
                calls: Cell::new(0),
                drops,
            }
        }
    }
    impl IdentityResolver for Facts {
        fn resolve_media(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
            panic!("reference-only fixture must not consult media")
        }
        fn resolve_reference(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
            self.calls.set(self.calls.get() + 1);
            self.current.get()
        }
    }
    impl Drop for Facts {
        fn drop(&mut self) {
            self.drops.set(self.drops.get() + 1);
        }
    }
    fn reference() -> Vec<u8> {
        br#"{"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[{"type":"text","text":"reference","marks":[{"type":"reference_link","attrs":{"reference_entity_id":"00000000-0000-4000-8000-000000000001"}}]}]}]}"#.to_vec()
    }

    #[test]
    fn owned_profile_retains_resolver_after_external_owner_drops_then_releases_it() {
        let drops = Rc::new(Cell::new(0));
        let resolver = Rc::new(Facts::new(drops.clone()));
        let weak = Rc::downgrade(&resolver);
        let profile: KwdjProfile<'static> = KwdjProfile::new_owned(
            resolver.clone(),
            Limits::default(),
            AdmissionBudget::default(),
        );
        drop(resolver);
        assert!(weak.upgrade().is_some());
        let admitted = profile
            .admit_bytes(profile.binding(), &reference(), AdmissionMode::Strict)
            .unwrap();
        let canonical = profile.canonical(&admitted).to_vec();
        assert_eq!(weak.upgrade().unwrap().calls.get(), 1);
        drop(profile);
        assert!(weak.upgrade().is_none());
        assert_eq!(drops.get(), 1);
        assert_eq!(admitted.canonical_json(), canonical);
    }

    #[test]
    fn owned_profile_rechecks_current_facts_for_snapshot_and_retries_without_answer_cache() {
        let resolver = Rc::new(Facts::new(Rc::new(Cell::new(0))));
        let profile = KwdjProfile::new_owned(
            resolver.clone(),
            Limits::default(),
            AdmissionBudget::default(),
        );
        let admitted = profile
            .admit_bytes(profile.binding(), &reference(), AdmissionMode::Strict)
            .unwrap();
        let document = profile.to_document(&admitted);
        for (fact, code) in [
            (
                Ok(IdentityStatus::Missing),
                KwdjErrorCode::MissingReferenceIdentity,
            ),
            (
                Err(IdentityResolverError::Unavailable),
                KwdjErrorCode::IdentityResolutionFailed,
            ),
        ] {
            resolver.current.set(fact);
            let KwdjProfileError::Document(error) = profile
                .admit_snapshot(&Profile::Prose, &document)
                .unwrap_err()
            else {
                panic!("existing typed domain error must survive owned resolver")
            };
            assert_eq!(error.code, code);
            assert!(error.path.ends_with("/attrs/reference_entity_id"));
        }
        resolver.current.set(Ok(IdentityStatus::Exists));
        let retried = profile.admit_snapshot(&Profile::Prose, &document).unwrap();
        assert_eq!(retried.canonical_json(), admitted.canonical_json());
        assert_eq!(resolver.calls.get(), 4);
    }

    #[test]
    fn owned_and_borrowed_admission_share_binding_limits_and_strict_import_semantics() {
        let resolver = Rc::new(Facts::new(Rc::new(Cell::new(0))));
        let owned = KwdjProfile::new_owned(
            resolver.clone(),
            Limits {
                node_count: u64::MAX,
                ..Limits::default()
            },
            AdmissionBudget::default(),
        );
        let borrowed = KwdjProfile::new(
            resolver.as_ref(),
            Limits::default(),
            AdmissionBudget::default(),
        );
        assert_eq!(owned.binding(), borrowed.binding());
        assert_eq!(owned.limits(), borrowed.limits());
        assert_eq!(owned.budget(), borrowed.budget());
        let plain=br#"{"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[]}]}]}"#;
        for input in [reference(), plain.to_vec()] {
            for mode in [AdmissionMode::Strict, AdmissionMode::Import] {
                let actual = owned.admit_bytes(owned.binding(), &input, mode);
                let expected = borrowed.admit_bytes(borrowed.binding(), &input, mode);
                match (actual, expected) {
                    (Ok(a), Ok(b)) => {
                        assert_eq!(a.canonical_json(), b.canonical_json());
                        assert_eq!(a.reference_manifest(), b.reference_manifest());
                        assert_eq!(a.normalization_events(), b.normalization_events());
                    }
                    (Err(a), Err(b)) => assert_eq!(a, b),
                    _ => panic!("owned resolver must not alter codec semantics"),
                }
            }
        }
        resolver.calls.set(0);
        let mismatch = ProfileBinding::new(
            "org.other/profile",
            "1.0.0",
            KWDJ_CODEC_ID,
            1,
            owned.binding().extensions(),
        )
        .unwrap();
        assert_eq!(
            owned
                .admit_bytes(&mismatch, b"malformed document", AdmissionMode::Strict)
                .unwrap_err(),
            KwdjProfileError::Binding(BindingError::ProfileMismatch)
        );
        assert_eq!(resolver.calls.get(), 0);
    }
}
