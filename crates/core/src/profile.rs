// SPDX-License-Identifier: MIT OR Apache-2.0
//! Trusted profile admission at explicit import/export boundaries.
//!
//! A profile supplies its semantic validator and codec. This interface does not
//! compile extension descriptors, expose committed session mutation, or require
//! a full snapshot on each edit. Implementations are trusted compiled code, not
//! a sandbox for untrusted validators.

use std::fmt;

use crate::cache::CandidateCache;
use crate::candidate::CandidateRead;
use crate::document::Document;
use crate::transaction::{WorkLimits, WorkMeter};

pub const MAX_PROFILE_IDENTIFIER_BYTES: usize = 128;
pub const MAX_PROFILE_VERSION_BYTES: usize = 64;
pub const MAX_PROFILE_EXTENSIONS: usize = 64;
pub const MAX_PROFILE_BINDING_BYTES: usize = 16 * 1024;

/// An exact compatibility version, not a package-manager range.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtensionBinding {
    id: String,
    version: String,
}

impl ExtensionBinding {
    pub fn new(id: &str, version: &str) -> Result<Self, BindingError> {
        identifier(id, "extension_id")?;
        version_string(version, "extension_version")?;
        Ok(Self {
            id: id.to_owned(),
            version: version.to_owned(),
        })
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn version(&self) -> &str {
        &self.version
    }
}

/// Bounded exact identities for one immutable compiled profile configuration.
///
/// IDs use case-sensitive ASCII letters/digits and `._-/`, beginning and ending
/// with a letter/digit. Versions use exact SemVer syntax. Extensions are sorted
/// by their exact ID; duplicate IDs are refused, even with different versions.
/// This is an identity manifest, not a declaration that a grammar was compiled.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileBinding {
    profile_id: String,
    profile_version: String,
    codec_id: String,
    wire_version: u64,
    extensions: Vec<ExtensionBinding>,
}

impl ProfileBinding {
    pub fn new(
        profile_id: &str,
        profile_version: &str,
        codec_id: &str,
        wire_version: u64,
        extensions: &[ExtensionBinding],
    ) -> Result<Self, BindingError> {
        // Check borrowed lengths before copying or sorting any caller data.
        if extensions.len() > MAX_PROFILE_EXTENSIONS {
            return Err(BindingError::TooManyExtensions {
                maximum: MAX_PROFILE_EXTENSIONS,
                observed: extensions.len(),
            });
        }
        identifier(profile_id, "profile_id")?;
        version_string(profile_version, "profile_version")?;
        identifier(codec_id, "codec_id")?;
        let bytes = profile_id.len()
            + profile_version.len()
            + codec_id.len()
            + extensions
                .iter()
                .map(|entry| entry.id.len() + entry.version.len())
                .sum::<usize>();
        if bytes > MAX_PROFILE_BINDING_BYTES {
            return Err(BindingError::ManifestTooLarge {
                maximum: MAX_PROFILE_BINDING_BYTES,
                observed: bytes,
            });
        }
        let mut extensions = extensions.to_vec();
        extensions.sort_by(|left, right| left.id.cmp(&right.id));
        for pair in extensions.windows(2) {
            if pair[0].id == pair[1].id {
                return Err(BindingError::DuplicateExtension {
                    id: pair[0].id.clone(),
                });
            }
        }
        Ok(Self {
            profile_id: profile_id.to_owned(),
            profile_version: profile_version.to_owned(),
            codec_id: codec_id.to_owned(),
            wire_version,
            extensions,
        })
    }

    pub fn profile_id(&self) -> &str {
        &self.profile_id
    }

    pub fn profile_version(&self) -> &str {
        &self.profile_version
    }

    pub fn codec_id(&self) -> &str {
        &self.codec_id
    }

    pub fn wire_version(&self) -> u64 {
        self.wire_version
    }

    pub fn extensions(&self) -> &[ExtensionBinding] {
        &self.extensions
    }

    /// Check the complete requested binding before calling any document decoder.
    /// No ranges, case folding, subset negotiation or network resolution occur.
    pub fn ensure_matches(&self, requested: &Self) -> Result<(), BindingError> {
        if self.profile_id != requested.profile_id {
            return Err(BindingError::ProfileMismatch);
        }
        if self.profile_version != requested.profile_version {
            return Err(BindingError::ProfileVersionMismatch);
        }
        if self.codec_id != requested.codec_id {
            return Err(BindingError::CodecMismatch);
        }
        if self.wire_version != requested.wire_version {
            return Err(BindingError::WireVersionMismatch);
        }
        let mut expected = self.extensions.iter().peekable();
        let mut observed = requested.extensions.iter().peekable();
        loop {
            match (expected.peek(), observed.peek()) {
                (None, None) => return Ok(()),
                (Some(entry), None) => {
                    return Err(BindingError::MissingExtension {
                        id: entry.id.clone(),
                    });
                }
                (None, Some(entry)) => {
                    return Err(BindingError::UnknownExtension {
                        id: entry.id.clone(),
                    });
                }
                (Some(left), Some(right)) => match left.id.cmp(&right.id) {
                    std::cmp::Ordering::Less => {
                        return Err(BindingError::MissingExtension {
                            id: left.id.clone(),
                        });
                    }
                    std::cmp::Ordering::Greater => {
                        return Err(BindingError::UnknownExtension {
                            id: right.id.clone(),
                        });
                    }
                    std::cmp::Ordering::Equal => {
                        if left.version != right.version {
                            return Err(BindingError::ExtensionVersionMismatch {
                                id: left.id.clone(),
                            });
                        }
                        expected.next();
                        observed.next();
                    }
                },
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BindingError {
    InvalidIdentifier { field: &'static str },
    InvalidVersion { field: &'static str },
    TooManyExtensions { maximum: usize, observed: usize },
    ManifestTooLarge { maximum: usize, observed: usize },
    DuplicateExtension { id: String },
    ProfileMismatch,
    ProfileVersionMismatch,
    CodecMismatch,
    WireVersionMismatch,
    MissingExtension { id: String },
    UnknownExtension { id: String },
    ExtensionVersionMismatch { id: String },
}

impl BindingError {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::InvalidIdentifier { .. } => "profile.invalid_identifier",
            Self::InvalidVersion { .. } => "profile.invalid_version",
            Self::TooManyExtensions { .. } => "profile.too_many_extensions",
            Self::ManifestTooLarge { .. } => "profile.manifest_too_large",
            Self::DuplicateExtension { .. } => "profile.duplicate_extension",
            Self::ProfileMismatch => "profile.unsupported_profile",
            Self::ProfileVersionMismatch => "profile.unsupported_profile_version",
            Self::CodecMismatch => "profile.unsupported_codec",
            Self::WireVersionMismatch => "profile.unsupported_wire_version",
            Self::MissingExtension { .. } => "profile.missing_extension",
            Self::UnknownExtension { .. } => "profile.unknown_extension",
            Self::ExtensionVersionMismatch { .. } => "profile.unsupported_extension_version",
        }
    }
}

impl fmt::Display for BindingError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl std::error::Error for BindingError {}

fn identifier(value: &str, field: &'static str) -> Result<(), BindingError> {
    let bytes = value.as_bytes();
    if bytes.is_empty()
        || bytes.len() > MAX_PROFILE_IDENTIFIER_BYTES
        || !bytes[0].is_ascii_alphanumeric()
        || !bytes[bytes.len() - 1].is_ascii_alphanumeric()
        || !bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-/".contains(byte))
    {
        return Err(BindingError::InvalidIdentifier { field });
    }
    Ok(())
}

fn numeric_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().all(|byte| byte.is_ascii_digit())
        && (value.len() == 1 || !value.starts_with('0'))
}

fn version_string(value: &str, field: &'static str) -> Result<(), BindingError> {
    let invalid = || BindingError::InvalidVersion { field };
    if value.is_empty() || value.len() > MAX_PROFILE_VERSION_BYTES || !value.is_ascii() {
        return Err(invalid());
    }
    let mut build_parts = value.split('+');
    let version = build_parts.next().ok_or_else(invalid)?;
    if let Some(build) = build_parts.next()
        && (!version_identifiers(build, false) || build_parts.next().is_some())
    {
        return Err(invalid());
    }
    let (core, prerelease) = match version.split_once('-') {
        Some((core, prerelease)) => (core, Some(prerelease)),
        None => (version, None),
    };
    let mut numbers = core.split('.');
    for _ in 0..3 {
        if !numbers.next().is_some_and(numeric_identifier) {
            return Err(invalid());
        }
    }
    if numbers.next().is_some() || prerelease.is_some_and(|value| !version_identifiers(value, true))
    {
        return Err(invalid());
    }
    Ok(())
}

fn version_identifiers(value: &str, prerelease: bool) -> bool {
    value.split('.').all(|part| {
        !part.is_empty()
            && part
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            && (!prerelease
                || !part.bytes().all(|byte| byte.is_ascii_digit())
                || numeric_identifier(part))
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdmissionMode {
    /// The input claims to be normalized; non-normalized data is refused.
    Strict,
    /// Apply only the selected codec's documented import normalization.
    Import,
}

/// Trusted codec/profile adapter, frozen for the lifetime of its session.
///
/// `Admitted` should be an opaque handle obtained from the profile's real
/// validators. Ordinary callers cannot turn an arbitrary `Document` into one.
/// `Context` preserves semantic root data omitted from generic child nodes.
/// Implementations must reject a mismatched binding before decoding input,
/// enforce operational bounds before copying, and retain typed diagnostics.
/// These methods belong to explicit import/export, not a per-keystroke path.
pub trait FrozenProfile {
    type Context: Clone + Eq;
    type Admitted;
    type Error;
    type Cache<I: Copy + Eq + Ord>: CandidateCache;

    /// Optional immutable profile/host reductions for shared engine preparation.
    /// The engine takes the componentwise minimum before any catalog, operation
    /// or history planning. Codec admission retains its own bounded preflight.
    /// None preserves the existing distribution/request work contract.
    fn transaction_work_limits(&self) -> Option<WorkLimits> {
        None
    }

    fn binding(&self) -> &ProfileBinding;
    fn admit_bytes(
        &self,
        requested: &ProfileBinding,
        input: &[u8],
        mode: AdmissionMode,
    ) -> Result<Self::Admitted, Self::Error>;
    fn context(&self, admitted: &Self::Admitted) -> Self::Context;
    fn to_document(&self, admitted: &Self::Admitted) -> Document;
    fn admit_snapshot(
        &self,
        context: &Self::Context,
        document: &Document,
    ) -> Result<Self::Admitted, Self::Error>;
    fn canonical<'a>(&self, admitted: &'a Self::Admitted) -> &'a [u8];

    /// Admission/remount may construct bounded profile proof state once.
    /// Opaque profiles use the unit cache and retain the full validation path.
    fn seed_cache<V: CandidateRead>(
        &self,
        _admitted: &Self::Admitted,
        _view: &V,
        _work: &mut WorkMeter,
    ) -> Result<Self::Cache<V::Id>, Self::Error> {
        Ok(Self::Cache::<V::Id>::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn binding(extensions: &[ExtensionBinding]) -> ProfileBinding {
        ProfileBinding::new(
            "org.example.notes",
            "1.0.0",
            "org.example.notes/json",
            1,
            extensions,
        )
        .unwrap()
    }

    #[test]
    fn extension_order_is_canonical_but_case_and_versions_are_exact() {
        let a = ExtensionBinding::new("org.example/A", "1.0.0").unwrap();
        let b = ExtensionBinding::new("org.example/b", "1.0.0").unwrap();
        let left = binding(&[b.clone(), a.clone()]);
        let right = binding(&[a, b]);
        assert_eq!(left, right);
        left.ensure_matches(&right).unwrap();
        assert_eq!(left.extensions()[0].id(), "org.example/A");
        let altered = binding(&[
            ExtensionBinding::new("org.example/A", "1.0.0+different").unwrap(),
            ExtensionBinding::new("org.example/b", "1.0.0").unwrap(),
        ]);
        assert!(matches!(
            left.ensure_matches(&altered),
            Err(BindingError::ExtensionVersionMismatch { .. })
        ));
        assert!(matches!(
            binding(&[ExtensionBinding::new("org.example/a", "1.0.0").unwrap()]).ensure_matches(
                &binding(&[ExtensionBinding::new("org.example/A", "1.0.0").unwrap()])
            ),
            Err(BindingError::UnknownExtension { .. })
        ));
    }

    #[test]
    fn duplicate_extension_ids_never_select_a_winning_version() {
        for version in ["1.0.0", "2.0.0"] {
            let entries = [
                ExtensionBinding::new("org.example/base", "1.0.0").unwrap(),
                ExtensionBinding::new("org.example/base", version).unwrap(),
            ];
            assert!(matches!(
                ProfileBinding::new(
                    "org.example.notes",
                    "1.0.0",
                    "org.example/json",
                    1,
                    &entries
                ),
                Err(BindingError::DuplicateExtension { .. })
            ));
        }
    }

    #[test]
    fn bounded_ascii_ids_and_exact_semver_refuse_ranges_and_ambiguous_tokens() {
        for invalid in ["", "é", "org.example/😀", "org example", "x\n", "/x", "x/"] {
            assert!(ExtensionBinding::new(invalid, "1.0.0").is_err());
        }
        assert!(ExtensionBinding::new(&"a".repeat(MAX_PROFILE_IDENTIFIER_BYTES), "1.0.0").is_ok());
        assert!(
            ExtensionBinding::new(&"a".repeat(MAX_PROFILE_IDENTIFIER_BYTES + 1), "1.0.0").is_err()
        );
        for valid in ["0.0.0", "1.2.3", "1.2.3-rc.1+build.001", "1.0.0-X-y"] {
            assert!(
                ExtensionBinding::new("org.example/base", valid).is_ok(),
                "{valid}"
            );
        }
        for invalid in [
            "",
            "1",
            "1.0",
            "01.0.0",
            "1.0.0-01",
            "1.0.0-",
            "1.0.0+",
            "^1.0.0",
            "1.*.*",
            "v1.0.0",
            "1.0.0+a+b",
            "1.0.0+é",
        ] {
            assert!(
                ExtensionBinding::new("org.example/base", invalid).is_err(),
                "{invalid}"
            );
        }
        assert!(
            ExtensionBinding::new(
                "org.example/base",
                &format!("1.0.0+{}", "a".repeat(MAX_PROFILE_VERSION_BYTES))
            )
            .is_err()
        );
        let entries = (0..MAX_PROFILE_EXTENSIONS + 1)
            .map(|index| ExtensionBinding::new(&format!("org.example/e{index}"), "1.0.0").unwrap())
            .collect::<Vec<_>>();
        assert!(
            ProfileBinding::new(
                "org.example.notes",
                "1.0.0",
                "org.example/json",
                1,
                &entries[..MAX_PROFILE_EXTENSIONS]
            )
            .is_ok()
        );
        assert!(matches!(
            ProfileBinding::new(
                "org.example.notes",
                "1.0.0",
                "org.example/json",
                1,
                &entries
            ),
            Err(BindingError::TooManyExtensions { .. })
        ));
    }
}
