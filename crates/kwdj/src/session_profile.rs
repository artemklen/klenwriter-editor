// SPDX-License-Identifier: MIT OR Apache-2.0
//! Frozen KWDJ adapter for explicit session admission and snapshot export.
//!
//! Profile compatibility version `1.0.0` is a new, explicit bootstrap binding
//! choice for this compiled adapter's semantics. It is independent of the Cargo
//! package `0.0.0`, persisted KWDJ schema version 1, and codec WASM ABI. It does
//! not announce a registry release or a stable public session SDK.

use std::rc::Rc;

use editor_core::candidate::CandidateRead;
use editor_core::document::Document;
use editor_core::profile::{
    AdmissionMode, BindingError, ExtensionBinding, FrozenProfile, ProfileBinding,
};
use editor_core::transaction::{Operation, TransactionProfile, ValidationStats, WorkMeter};
use thiserror::Error;

use crate::{
    AdmissionBudget, IdentityResolver, KwdjError, Limits, PROFILE_ID, Profile, ValidatedDocument,
    admit_core_document_with_budget, decode_normalize_validate_with_limits_and_budget,
    validate_normalized_json_with_limits_and_budget,
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
/// The base extension identifies this compiled codec/profile capability; no
/// runtime descriptor compiler or alternate production profile is implemented.
pub struct KwdjProfile<'a> {
    binding: ProfileBinding,
    identities: ResolverBacking<'a>,
    limits: Limits,
    budget: AdmissionBudget,
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
        let extension = ExtensionBinding::new(KWDJ_BASE_EXTENSION_ID, KWDJ_BASE_EXTENSION_VERSION)
            .expect("compiled KWDJ extension identity is valid");
        let binding = ProfileBinding::new(
            PROFILE_ID,
            KWDJ_PROFILE_VERSION,
            KWDJ_CODEC_ID,
            1,
            &[extension],
        )
        .expect("compiled KWDJ profile identity is valid");
        Self {
            binding,
            identities,
            limits: limits.effective(),
            budget: budget.effective(),
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
}

impl FrozenProfile for KwdjProfile<'_> {
    type Context = Profile;
    type Admitted = ValidatedDocument;
    type Error = KwdjProfileError;
    type Cache<I: Copy + Eq + Ord> = crate::KwdjCache<I>;

    fn seed_cache<V: CandidateRead>(
        &self,
        admitted: &Self::Admitted,
        view: &V,
        work: &mut WorkMeter,
    ) -> Result<Self::Cache<V::Id>, Self::Error> {
        Ok(crate::candidate_cache::seed(
            admitted.document().profile(),
            view,
            self.limits,
            self.budget,
            work,
        )?)
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
            AdmissionMode::Import => decode_normalize_validate_with_limits_and_budget(
                input,
                self.identities(),
                self.limits,
                self.budget,
            )?,
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
        Ok(crate::candidate_cache::normalize(
            *context,
            view,
            cache,
            self.identities(),
            self.limits,
            self.budget,
            work,
        )?)
    }
    fn validate_scoped<V: editor_core::candidate::CandidateChanges>(
        &self,
        context: &Self::Context,
        view: &V,
        cache: &Self::Cache<V::Id>,
        work: &mut WorkMeter,
    ) -> Result<editor_core::cache::PreparedValidation<Self::Cache<V::Id>>, Self::Error> {
        Ok(crate::candidate_cache::validate(
            *context,
            view,
            cache,
            self.identities(),
            self.limits,
            self.budget,
            work,
        )?)
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
        Ok(operations)
    }

    fn validate_candidate<V: CandidateRead>(
        &self,
        context: &Self::Context,
        candidate: &V,
        work: &mut WorkMeter,
    ) -> Result<ValidationStats, Self::Error> {
        Ok(crate::candidate_validate::validate_candidate(
            *context,
            candidate,
            self.identities(),
            self.limits,
            self.budget,
            work,
        )?)
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
