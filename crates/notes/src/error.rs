// SPDX-License-Identifier: MIT OR Apache-2.0
use std::fmt;

use editor_core::limits::LimitExceeded;
use editor_core::profile::BindingError;
use editor_registry::{RegistryDiagnostic, RegistryErrorCode};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotesErrorCode {
    InvalidJson,
    DuplicateKey,
    UnknownField,
    MissingField,
    InvalidStructure,
    UnsupportedVersion,
    UnknownNode,
    UnknownMark,
    InvalidChild,
    InvalidAttribute,
    DuplicateMark,
    NotNormal,
    ResourceLimitExceeded,
    InvalidRegistry,
    BindingMismatch,
    CommandSelectionRequired,
    CommandUnsupportedContext,
}

impl NotesErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidJson => "notes.invalid_json",
            Self::DuplicateKey => "notes.duplicate_key",
            Self::UnknownField => "notes.unknown_field",
            Self::MissingField => "notes.missing_field",
            Self::InvalidStructure => "notes.invalid_structure",
            Self::UnsupportedVersion => "notes.unsupported_version",
            Self::UnknownNode => "notes.unknown_node",
            Self::UnknownMark => "notes.unknown_mark",
            Self::InvalidChild => "notes.invalid_child",
            Self::InvalidAttribute => "notes.invalid_attribute",
            Self::DuplicateMark => "notes.duplicate_mark",
            Self::NotNormal => "notes.not_normal",
            Self::ResourceLimitExceeded => "resource_limit_exceeded",
            Self::InvalidRegistry => "notes.invalid_registry",
            Self::BindingMismatch => "notes.binding_mismatch",
            Self::CommandSelectionRequired => "notes.command_selection_required",
            Self::CommandUnsupportedContext => "notes.command_unsupported_context",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotesError {
    pub code: NotesErrorCode,
    pub path: String,
    pub limit: Option<LimitExceeded>,
    /// Compiler diagnostics retain their public registry taxonomy. Runtime
    /// notes codec/schema diagnostics use the independently frozen notes codes.
    pub registry_code: Option<RegistryErrorCode>,
}

impl NotesError {
    pub(crate) fn new(code: NotesErrorCode, path: &str) -> Self {
        Self {
            code,
            path: path.into(),
            limit: None,
            registry_code: None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        self.registry_code
            .map_or_else(|| self.code.as_str(), RegistryErrorCode::as_str)
    }

    pub(crate) fn compiler(error: RegistryDiagnostic) -> Self {
        Self {
            code: NotesErrorCode::InvalidRegistry,
            path: error.path,
            limit: None,
            registry_code: Some(error.code),
        }
    }

    pub(crate) fn typing(error: RegistryDiagnostic) -> Self {
        let mut mapped = Self::schema(error);
        mapped.path = mapped.path.replacen("/root/marks", "/stored_marks", 1);
        mapped
    }

    pub(crate) fn schema(error: RegistryDiagnostic) -> Self {
        use RegistryErrorCode as R;
        let code = match error.code {
            R::UnknownNode | R::UnknownType => NotesErrorCode::UnknownNode,
            R::UnknownMark => NotesErrorCode::UnknownMark,
            R::RequiredAttributeMissing
            | R::UnknownAttribute
            | R::AttributeTypeMismatch
            | R::AttributeOutOfRange
            | R::AttributeLimitExceeded => NotesErrorCode::InvalidAttribute,
            R::DuplicateMark => NotesErrorCode::DuplicateMark,
            R::GrammarMismatch => NotesErrorCode::InvalidChild,
            R::ResourceLimitExceeded => NotesErrorCode::ResourceLimitExceeded,
            _ => NotesErrorCode::InvalidStructure,
        };
        let mut path = schema_path(&error.path);
        if code == NotesErrorCode::DuplicateMark && !path.ends_with("/type") {
            path.push_str("/type");
        }
        Self::new(code, &path)
    }

    pub(crate) fn json(error: RegistryDiagnostic) -> Self {
        let code = match error.code {
            RegistryErrorCode::DuplicateJsonKey => NotesErrorCode::DuplicateKey,
            RegistryErrorCode::ResourceLimitExceeded => NotesErrorCode::ResourceLimitExceeded,
            _ => NotesErrorCode::InvalidJson,
        };
        Self::new(
            code,
            if code == NotesErrorCode::InvalidJson {
                ""
            } else {
                &error.path
            },
        )
    }
}

// Registry paths describe the engine's synthetic root and core field names.
// Convert only structural attributes tokens; authored nested keys remain exact.
fn schema_path(path: &str) -> String {
    let suffix = path.strip_prefix("/children/0").unwrap_or(path);
    let mut tokens: Vec<_> = suffix.split('/').map(str::to_owned).collect();
    for token in &mut tokens {
        if token == "attributes" {
            *token = "attrs".into();
            break;
        }
    }
    format!("/root{}", tokens.join("/"))
}

impl From<LimitExceeded> for NotesError {
    fn from(limit: LimitExceeded) -> Self {
        Self {
            code: NotesErrorCode::ResourceLimitExceeded,
            path: String::new(),
            limit: Some(limit),
            registry_code: None,
        }
    }
}
impl From<BindingError> for NotesError {
    fn from(_: BindingError) -> Self {
        Self::new(NotesErrorCode::BindingMismatch, "")
    }
}
impl fmt::Display for NotesError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} at {}", self.as_str(), self.path)
    }
}
impl std::error::Error for NotesError {}
