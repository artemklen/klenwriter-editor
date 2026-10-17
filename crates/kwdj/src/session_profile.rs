// SPDX-License-Identifier: MIT OR Apache-2.0
//! Frozen KWDJ adapter for explicit session admission and snapshot export.
//!
//! Profile compatibility version `1.0.0` is a new, explicit bootstrap binding
//! choice for this compiled adapter's semantics. It is independent of the Cargo
//! package `0.0.0`, persisted KWDJ schema version 1, and codec WASM ABI. It does
//! not announce a registry release or a stable public session SDK.

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

/// Trusted compiled KWDJ semantics, with immutable borrowed identity services.
///
/// The base extension identifies this compiled codec/profile capability; no
/// runtime descriptor compiler or alternate production profile is implemented.
pub struct KwdjProfile<'a> {
    binding: ProfileBinding,
    identities: &'a dyn IdentityResolver,
    limits: Limits,
    budget: AdmissionBudget,
}

impl<'a> KwdjProfile<'a> {
    pub fn new(
        identities: &'a dyn IdentityResolver,
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
        self.identities
    }

    pub fn limits(&self) -> Limits {
        self.limits
    }

    pub fn budget(&self) -> AdmissionBudget {
        self.budget
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
                self.identities,
                self.limits,
                self.budget,
            )?,
            AdmissionMode::Import => decode_normalize_validate_with_limits_and_budget(
                input,
                self.identities,
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
            self.identities,
            self.limits,
            self.budget,
        )?)
    }

    fn canonical<'a>(&self, admitted: &'a Self::Admitted) -> &'a [u8] {
        admitted.canonical_json()
    }
}

impl TransactionProfile for KwdjProfile<'_> {
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
            self.identities,
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
            self.identities,
            self.limits,
            self.budget,
            work,
        )?)
    }
}
