// SPDX-License-Identifier: MIT OR Apache-2.0
// Derived from owner-controlled KlenWriter CMS source; see provenance/source-files.json.
//! KlenWriter Document JSON (KWDJ) v1 domain validator and normalizer.
//!
//! This module owns the closed canonical document contract. It intentionally has
//! no dependency on HTTP, persistence, the editor, or public rendering.

mod admission;
mod core_bridge;
pub mod model;
pub use admission::{AdmissionBudget, RAW_INPUT_BYTE_CEILING};
pub use core_bridge::{admit_core_document, admit_core_document_with_budget};
mod normalize;
mod project;
mod session_profile;
mod validate;

pub use session_profile::{
    KWDJ_BASE_EXTENSION_ID, KWDJ_BASE_EXTENSION_VERSION, KWDJ_CODEC_ID, KWDJ_PROFILE_VERSION,
    KwdjProfile, KwdjProfileError,
};

use serde_json::Value;
use thiserror::Error;
use uuid::Uuid;

use model::Document;
pub use model::Profile;
pub use project::{ProjectionBudget, ProjectionBudgetKind, ProjectionError, ProjectionResult};

pub const MAX_CANONICAL_DOCUMENT_BYTES: u64 = 2_097_152;
pub const MAX_TREE_DEPTH: u64 = 32;
pub const MAX_NODE_COUNT: u64 = 50_000;
pub const MAX_TEXT_LEAF_BYTES: u64 = 262_144;
pub const MAX_TABLE_ROWS: u64 = 500;
pub const MAX_TABLE_EFFECTIVE_COLUMNS: u64 = 50;
pub const MAX_AUTHORED_ATTRIBUTE_BYTES: u64 = 8_192;

/// Host reductions of the seven normative v1 domain ceilings. Values above the
/// profile ceiling are clamped; they can never weaken the v1 contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub document_bytes: u64,
    pub tree_depth: u64,
    pub node_count: u64,
    pub text_leaf_bytes: u64,
    pub table_rows: u64,
    pub table_effective_columns: u64,
    pub authored_attribute_bytes: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            document_bytes: MAX_CANONICAL_DOCUMENT_BYTES,
            tree_depth: MAX_TREE_DEPTH,
            node_count: MAX_NODE_COUNT,
            text_leaf_bytes: MAX_TEXT_LEAF_BYTES,
            table_rows: MAX_TABLE_ROWS,
            table_effective_columns: MAX_TABLE_EFFECTIVE_COLUMNS,
            authored_attribute_bytes: MAX_AUTHORED_ATTRIBUTE_BYTES,
        }
    }
}

impl Limits {
    pub fn effective(self) -> Self {
        use editor_core::limits::effective;
        let ceiling = Self::default();
        Self {
            document_bytes: effective(ceiling.document_bytes, self.document_bytes),
            tree_depth: effective(ceiling.tree_depth, self.tree_depth),
            node_count: effective(ceiling.node_count, self.node_count),
            text_leaf_bytes: effective(ceiling.text_leaf_bytes, self.text_leaf_bytes),
            table_rows: effective(ceiling.table_rows, self.table_rows),
            table_effective_columns: effective(
                ceiling.table_effective_columns,
                self.table_effective_columns,
            ),
            authored_attribute_bytes: effective(
                ceiling.authored_attribute_bytes,
                self.authored_attribute_bytes,
            ),
        }
    }
}

/// Opaque, structurally closed input that may still contain canonical defaults.
#[derive(Debug, Clone)]
pub struct CandidateDocument {
    value: Value,
    limits: Limits,
}

/// Opaque normalized and semantically valid KWDJ value.
///
/// Construction is crate-private. External callers obtain instances only through
/// the validate/normalize entry points (`decode_normalize_validate`,
/// `normalize_and_validate`, `validate_normalized_json`) via
/// [`ValidatedDocument`]. There is no public constructor, `Default`, or
/// `serde::Deserialize` implementation.
///
/// ```compile_fail,E0424,E0451
/// use klenwriter_editor_kwdj::NormalizedDocument;
/// // Private field: external crates cannot assemble an unchecked document.
/// let _ = NormalizedDocument { inner: unimplemented!() };
/// ```
///
/// ```compile_fail
/// use klenwriter_editor_kwdj::NormalizedDocument;
/// // No Deserialize: unchecked JSON cannot become NormalizedDocument.
/// fn _parse(s: &str) -> NormalizedDocument {
///     serde_json::from_str(s).unwrap()
/// }
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedDocument {
    inner: Document,
}

impl NormalizedDocument {
    /// Read-only wire-model view; constructing this DTO does not grant admission.
    pub fn model(&self) -> &model::Document {
        &self.inner
    }

    /// Generic structural metrics; not CMS word count or reading-time policy.
    pub fn structural_metrics(&self) -> editor_core::document::TreeMetrics {
        editor_core::document::measure(&self.inner.content)
    }

    pub fn profile(&self) -> Profile {
        self.inner.profile
    }

    pub fn to_json_value(&self) -> Value {
        serde_json::to_value(&self.inner).expect("KWDJ typed model must serialize")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdentityReference {
    pub id: Uuid,
    pub path: String,
}

/// Successful outcome of resolving an authored identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityStatus {
    Exists,
    Missing,
}

/// Closed domain-safe failure returned when an identity backend cannot answer.
/// Backend-specific details must remain outside the KWDJ error boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum IdentityResolverError {
    #[error("identity resolution unavailable")]
    Unavailable,
}

/// Domain-only identity lookup boundary. Implementations may query any store,
/// while this crate remains independent of DB and web layers.
pub trait IdentityResolver {
    fn resolve_media(&self, id: &Uuid) -> Result<IdentityStatus, IdentityResolverError>;
    fn resolve_reference(&self, id: &Uuid) -> Result<IdentityStatus, IdentityResolverError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedDocument {
    document: NormalizedDocument,
    canonical_json: Vec<u8>,
    media_manifest: Vec<IdentityReference>,
    reference_manifest: Vec<IdentityReference>,
    normalization_events: Vec<NormalizationEvent>,
}

impl ValidatedDocument {
    pub fn document(&self) -> &NormalizedDocument {
        &self.document
    }

    pub fn canonical_json(&self) -> &[u8] {
        &self.canonical_json
    }

    pub fn media_manifest(&self) -> &[IdentityReference] {
        &self.media_manifest
    }

    pub fn reference_manifest(&self) -> &[IdentityReference] {
        &self.reference_manifest
    }

    pub fn normalization_events(&self) -> &[NormalizationEvent] {
        &self.normalization_events
    }

    /// Deterministic plain-text projections (`full_text`, `search_index_text`,
    /// `public_snippet_text`) derived only from the validated normalized document.
    ///
    /// This is the primary projection entry point for production callers.
    pub fn project_text(&self) -> Result<ProjectionResult, ProjectionError> {
        self.project_text_with_budget(ProjectionBudget::default())
    }

    /// Apply tighter operational limits without changing document admission.
    pub fn project_text_with_budget(
        &self,
        budget: ProjectionBudget,
    ) -> Result<ProjectionResult, ProjectionError> {
        project::project_document(&self.document.inner, budget)
    }
}

impl NormalizedDocument {
    /// Project plain text from an already-validated opaque handle.
    ///
    /// Prefer [`ValidatedDocument::project_text`] when the full validated result
    /// is in hand. This method exists so callers that already hold
    /// `&NormalizedDocument` from [`ValidatedDocument::document`] need not keep
    /// the outer wrapper. It is still capability-safe: unchecked KWDJ cannot
    /// construct `NormalizedDocument`.
    pub fn project_text(&self) -> Result<ProjectionResult, ProjectionError> {
        self.project_text_with_budget(ProjectionBudget::default())
    }

    /// Apply tighter operational limits without changing document admission.
    pub fn project_text_with_budget(
        &self,
        budget: ProjectionBudget,
    ) -> Result<ProjectionResult, ProjectionError> {
        project::project_document(&self.inner, budget)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NormalizationEvent {
    EmptyMarksRemoved,
    OrderedStartDefaultRemoved,
    UnitSpanRemoved,
}

impl NormalizationEvent {
    pub fn code(self) -> &'static str {
        match self {
            Self::EmptyMarksRemoved => "kwdj.normalized_empty_marks_removed",
            Self::OrderedStartDefaultRemoved => "kwdj.normalized_ordered_start_default_removed",
            Self::UnitSpanRemoved => "kwdj.normalized_unit_spans_removed",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KwdjErrorCode {
    InvalidJson,
    InvalidEnvelope,
    UnsupportedSchema,
    UnsupportedSchemaVersion,
    InvalidStructure,
    UnknownNode,
    UnknownMark,
    UnknownAttribute,
    NonNormalized,
    NonNormalizedEmptyMarks,
    NonNormalizedOrderedStartDefault,
    NonNormalizedUnitSpan,
    DuplicateMarkType,
    IncompatibleMarks,
    InvalidProfileContent,
    InvalidVerse,
    RecursiveSpoiler,
    RecursiveWarning,
    RecursiveDisclosure,
    NestedTable,
    TableNotRectangular,
    InvalidUuid,
    UnsafeUrl,
    InvalidMediaAccessibility,
    MissingMediaIdentity,
    MissingReferenceIdentity,
    IdentityResolutionFailed,
    ResourceLimitExceeded,
    OperationalBudgetExceeded,
}

impl KwdjErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidJson => "kwdj.invalid_json",
            Self::InvalidEnvelope => "kwdj.invalid_envelope",
            Self::UnsupportedSchema => "kwdj.unsupported_schema",
            Self::UnsupportedSchemaVersion => "kwdj.unsupported_schema_version",
            Self::InvalidStructure => "kwdj.invalid_structure",
            Self::UnknownNode => "kwdj.unknown_node",
            Self::UnknownMark => "kwdj.unknown_mark",
            Self::UnknownAttribute => "kwdj.unknown_attribute",
            Self::NonNormalized => "kwdj.non_normalized",
            Self::NonNormalizedEmptyMarks => "kwdj.non_normalized_empty_marks",
            Self::NonNormalizedOrderedStartDefault => "kwdj.non_normalized_ordered_start_default",
            Self::NonNormalizedUnitSpan => "kwdj.non_normalized_unit_span",
            Self::DuplicateMarkType => "kwdj.duplicate_mark_type",
            Self::IncompatibleMarks => "kwdj.incompatible_marks",
            Self::InvalidProfileContent => "kwdj.invalid_profile_content",
            Self::InvalidVerse => "kwdj.invalid_verse",
            Self::RecursiveSpoiler => "kwdj.recursive_spoiler",
            Self::RecursiveWarning => "kwdj.recursive_warning",
            Self::RecursiveDisclosure => "kwdj.recursive_disclosure",
            Self::NestedTable => "kwdj.nested_table",
            Self::TableNotRectangular => "kwdj.table_not_rectangular",
            Self::InvalidUuid => "kwdj.invalid_uuid",
            Self::UnsafeUrl => "kwdj.unsafe_url",
            Self::InvalidMediaAccessibility => "kwdj.invalid_media_accessibility",
            Self::MissingMediaIdentity => "kwdj.media_identity_unresolved",
            Self::MissingReferenceIdentity => "kwdj.reference_identity_unresolved",
            Self::IdentityResolutionFailed => "kwdj.identity_resolution_failed",
            Self::ResourceLimitExceeded => "kwdj.resource_limit_exceeded",
            Self::OperationalBudgetExceeded => "kwdj.admission_budget_exceeded",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ErrorContext {
    pub category: Option<&'static str>,
    pub limit: Option<&'static str>,
    pub maximum: Option<u64>,
    pub observed: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("{code} at {path}", code = .code.as_str())]
pub struct KwdjError {
    pub code: KwdjErrorCode,
    pub path: String,
    pub context: ErrorContext,
}

impl KwdjError {
    pub(crate) fn operational(error: editor_core::limits::LimitExceeded) -> Self {
        Self {
            code: KwdjErrorCode::OperationalBudgetExceeded,
            path: String::new(),
            context: ErrorContext {
                category: Some("operational_admission"),
                limit: Some(error.name),
                maximum: Some(error.maximum),
                observed: Some(error.observed),
            },
        }
    }

    pub(crate) fn new(code: KwdjErrorCode, path: impl Into<String>) -> Self {
        Self {
            code,
            path: path.into(),
            context: ErrorContext::default(),
        }
    }

    pub(crate) fn categorized(
        code: KwdjErrorCode,
        path: impl Into<String>,
        category: &'static str,
    ) -> Self {
        Self {
            code,
            path: path.into(),
            context: ErrorContext {
                category: Some(category),
                ..ErrorContext::default()
            },
        }
    }

    pub(crate) fn limit(
        path: impl Into<String>,
        limit: &'static str,
        maximum: u64,
        observed: u64,
    ) -> Self {
        Self {
            code: KwdjErrorCode::ResourceLimitExceeded,
            path: path.into(),
            context: ErrorContext {
                limit: Some(limit),
                maximum: Some(maximum),
                observed: Some(observed),
                ..ErrorContext::default()
            },
        }
    }
}

/// Parse, preflight, and prove that an input uses only KWDJ v1 closed shapes.
/// Canonical defaults may still be present and are preserved in the opaque input.
pub fn decode_candidate(input: &[u8]) -> Result<CandidateDocument, KwdjError> {
    decode_candidate_with_limits(input, Limits::default())
}

pub fn decode_candidate_with_limits(
    input: &[u8],
    limits: Limits,
) -> Result<CandidateDocument, KwdjError> {
    decode_candidate_with_limits_and_budget(input, limits, AdmissionBudget::default())
}

pub fn decode_candidate_with_limits_and_budget(
    input: &[u8],
    limits: Limits,
    budget: AdmissionBudget,
) -> Result<CandidateDocument, KwdjError> {
    let value = admission::parse_raw(input, budget)?;
    admission::check_value(&value, budget)?;
    decode_checked_value(value, limits)
}

/// Admit an already-parsed borrowed value without serializing and parsing it
/// again. Operational accounting precedes every snapshot copy. Raw-byte policy
/// belongs to the caller's transport; this route has no raw input bytes.
pub fn decode_candidate_value(input: &Value) -> Result<CandidateDocument, KwdjError> {
    decode_candidate_value_with_limits_and_budget(
        input,
        Limits::default(),
        AdmissionBudget::default(),
    )
}

pub fn decode_candidate_value_with_limits_and_budget(
    input: &Value,
    limits: Limits,
    budget: AdmissionBudget,
) -> Result<CandidateDocument, KwdjError> {
    admission::check_value(input, budget)?;
    preflight(input)?;
    decode_checked_value(input.clone(), limits)
}

// Value is owned and has already passed the borrowed operational preflight.
// Opaque candidates cannot be constructed or mutated outside this module.
fn decode_checked_value(value: Value, limits: Limits) -> Result<CandidateDocument, KwdjError> {
    preflight(&value)?;
    let mut probe = value.clone();
    let mut ignored = Vec::new();
    normalize::normalize_value(&mut probe, "", &mut ignored)?;
    decode_document(probe)?;
    Ok(CandidateDocument {
        value,
        limits: limits.effective(),
    })
}

/// Normalize and validate a previously decoded candidate atomically.
pub fn normalize_and_validate(
    candidate: CandidateDocument,
    identities: &dyn IdentityResolver,
) -> Result<ValidatedDocument, KwdjError> {
    let mut value = candidate.value;
    let mut events = Vec::new();
    normalize::normalize_value(&mut value, "", &mut events)?;
    let document = decode_document(value)?;
    finish_validation(document, events, identities, candidate.limits)
}

/// Convenience entry point for untrusted pre-normalized input.
pub fn decode_normalize_validate(
    input: &[u8],
    identities: &dyn IdentityResolver,
) -> Result<ValidatedDocument, KwdjError> {
    decode_normalize_validate_with_limits_and_budget(
        input,
        identities,
        Limits::default(),
        AdmissionBudget::default(),
    )
}

pub fn decode_normalize_validate_with_limits_and_budget(
    input: &[u8],
    identities: &dyn IdentityResolver,
    limits: Limits,
    budget: AdmissionBudget,
) -> Result<ValidatedDocument, KwdjError> {
    normalize_and_validate(
        decode_candidate_with_limits_and_budget(input, limits, budget)?,
        identities,
    )
}

/// Decode a value that already claims to be normalized canonical KWDJ.
/// Canonical defaults or other normalizable spellings are rejected, not repaired.
pub fn validate_normalized_json(
    input: &[u8],
    identities: &dyn IdentityResolver,
) -> Result<ValidatedDocument, KwdjError> {
    validate_normalized_json_with_limits(input, identities, Limits::default())
}

pub fn validate_normalized_json_with_limits(
    input: &[u8],
    identities: &dyn IdentityResolver,
    limits: Limits,
) -> Result<ValidatedDocument, KwdjError> {
    validate_normalized_json_with_limits_and_budget(
        input,
        identities,
        limits,
        AdmissionBudget::default(),
    )
}

pub fn validate_normalized_json_with_limits_and_budget(
    input: &[u8],
    identities: &dyn IdentityResolver,
    limits: Limits,
    budget: AdmissionBudget,
) -> Result<ValidatedDocument, KwdjError> {
    let value = admission::parse_raw(input, budget)?;
    validate_normalized_value(value, identities, limits, budget)
}

pub(crate) fn validate_normalized_value(
    value: Value,
    identities: &dyn IdentityResolver,
    limits: Limits,
    budget: AdmissionBudget,
) -> Result<ValidatedDocument, KwdjError> {
    admission::check_value(&value, budget)?;
    preflight(&value)?;
    normalize::ensure_normalized(&value, "")?;
    let document = decode_document(value)?;
    finish_validation(document, Vec::new(), identities, limits.effective())
}

pub fn canonical_json(document: &NormalizedDocument) -> Vec<u8> {
    canonical_value(&document.to_json_value()).into_bytes()
}

fn finish_validation(
    document: Document,
    events: Vec<NormalizationEvent>,
    identities: &dyn IdentityResolver,
    limits: Limits,
) -> Result<ValidatedDocument, KwdjError> {
    let normalized = NormalizedDocument { inner: document };
    let canonical_json = canonical_json(&normalized);
    let manifests = validate::validate(
        &normalized.inner,
        canonical_json.len() as u64,
        identities,
        limits,
    )?;
    Ok(ValidatedDocument {
        document: normalized,
        canonical_json,
        media_manifest: manifests.media,
        reference_manifest: manifests.references,
        normalization_events: events,
    })
}

fn preflight(value: &Value) -> Result<(), KwdjError> {
    let root = value
        .as_object()
        .ok_or_else(|| KwdjError::new(KwdjErrorCode::InvalidEnvelope, ""))?;
    match root.get("schema").and_then(Value::as_str) {
        Some("klenwriter.document") => {}
        Some(_) => return Err(KwdjError::new(KwdjErrorCode::UnsupportedSchema, "/schema")),
        None => return Err(KwdjError::new(KwdjErrorCode::InvalidEnvelope, "/schema")),
    }
    match root.get("schema_version").and_then(Value::as_u64) {
        Some(1) => Ok(()),
        Some(_) => Err(KwdjError::new(
            KwdjErrorCode::UnsupportedSchemaVersion,
            "/schema_version",
        )),
        None => Err(KwdjError::new(
            KwdjErrorCode::InvalidEnvelope,
            "/schema_version",
        )),
    }
}

fn decode_document(value: Value) -> Result<Document, KwdjError> {
    scan_known_types(&value, "")?;
    let bytes = serde_json::to_vec(&value)
        .map_err(|_| KwdjError::new(KwdjErrorCode::InvalidStructure, ""))?;
    let mut deserializer = serde_json::Deserializer::from_slice(&bytes);
    serde_path_to_error::deserialize(&mut deserializer).map_err(|error| {
        let path = serde_path_to_pointer(error.path());
        let message = error.inner().to_string();
        let code = if message.contains("unknown variant") {
            if path.contains("/marks/") {
                KwdjErrorCode::UnknownMark
            } else {
                KwdjErrorCode::UnknownNode
            }
        } else if message.contains("unknown field") {
            KwdjErrorCode::UnknownAttribute
        } else {
            KwdjErrorCode::InvalidStructure
        };
        let path = if code == KwdjErrorCode::UnknownAttribute {
            unknown_field_name(&message)
                .map(|field| key_path(&path, field))
                .unwrap_or(path)
        } else {
            path
        };
        KwdjError::new(code, path)
    })
}

fn unknown_field_name(message: &str) -> Option<&str> {
    let tail = message.strip_prefix("unknown field `")?;
    tail.split('`').next()
}

// Serde's internally tagged unit variants ignore extra fields even with
// deny_unknown_fields on the enum. Preserve the public model's unit variants,
// but close their wire objects before typed decoding can discard authored data.
fn check_empty_variant_fields(
    object: &serde_json::Map<String, Value>,
    path: &str,
) -> Result<(), KwdjError> {
    if let Some(key) = object.keys().find(|key| key.as_str() != "type") {
        return Err(KwdjError::new(
            KwdjErrorCode::UnknownAttribute,
            key_path(path, key),
        ));
    }
    Ok(())
}

fn scan_known_types(value: &Value, path: &str) -> Result<(), KwdjError> {
    match value {
        Value::Array(values) => {
            for (index, value) in values.iter().enumerate() {
                scan_known_types(value, &index_path(path, index))?;
            }
        }
        Value::Object(object) => {
            if let Some(marks) = object.get("marks").and_then(Value::as_array) {
                for (index, mark) in marks.iter().enumerate() {
                    if let Some(kind) = mark.get("type").and_then(Value::as_str)
                        && !matches!(
                            kind,
                            "strong"
                                | "emphasis"
                                | "strike"
                                | "code"
                                | "subscript"
                                | "superscript"
                                | "text_color"
                                | "highlight"
                                | "link"
                                | "reference_link"
                        )
                    {
                        return Err(KwdjError::new(
                            KwdjErrorCode::UnknownMark,
                            key_path(&index_path(&key_path(path, "marks"), index), "type"),
                        ));
                    }
                    if matches!(
                        mark.get("type").and_then(Value::as_str),
                        Some(
                            "strong" | "emphasis" | "strike" | "code" | "subscript" | "superscript"
                        )
                    ) && let Some(fields) = mark.as_object()
                    {
                        check_empty_variant_fields(
                            fields,
                            &index_path(&key_path(path, "marks"), index),
                        )?;
                    }
                }
            }
            if let Some(kind) = object.get("type").and_then(Value::as_str)
                && !matches!(
                    kind,
                    "text"
                        | "paragraph"
                        | "heading"
                        | "hard_break"
                        | "scene_break"
                        | "code_block"
                        | "blockquote"
                        | "list_item"
                        | "task_item"
                        | "bullet_list"
                        | "ordered_list"
                        | "task_list"
                        | "table_header"
                        | "table_cell"
                        | "table_row"
                        | "table"
                        | "media_image"
                        | "literary_block"
                        | "warning"
                        | "spoiler"
                        | "disclosure"
                        | "verse_line"
                        | "stanza_break"
                        | "verse"
                )
            {
                return Err(KwdjError::new(
                    KwdjErrorCode::UnknownNode,
                    key_path(path, "type"),
                ));
            }
            if matches!(
                object.get("type").and_then(Value::as_str),
                Some("hard_break" | "scene_break")
            ) {
                check_empty_variant_fields(object, path)?;
            }
            for (key, value) in object {
                if key != "marks" {
                    scan_known_types(value, &key_path(path, key))?;
                }
            }
        }
        _ => {}
    }
    Ok(())
}

fn serde_path_to_pointer(path: &serde_path_to_error::Path) -> String {
    use serde_path_to_error::Segment;
    let mut out = String::new();
    for segment in path {
        out.push('/');
        match segment {
            Segment::Seq { index } => out.push_str(&index.to_string()),
            Segment::Map { key } | Segment::Enum { variant: key } => {
                out.push_str(&pointer_escape(key));
            }
            Segment::Unknown => out.push('?'),
        }
    }
    out
}

pub(crate) use editor_core::json::{canonical_value, index_path, key_path, pointer_escape};

pub const PROFILE_ID: &str = "org.klenwriter.kwdj";
pub const PACKAGE_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const CORE_PACKAGE_VERSION: &str = editor_core::PACKAGE_VERSION;
