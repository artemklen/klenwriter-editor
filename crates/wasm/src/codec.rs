// SPDX-License-Identifier: MIT OR Apache-2.0
//! Temporary, versioned codec transport. No editing/session or host I/O.
use std::{cell::Cell, collections::BTreeMap};

use editor_kwdj::{
    AdmissionBudget, IdentityResolver, IdentityResolverError, IdentityStatus, Limits,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const ABI: &str = "kwdj-codec/1";
pub const MAX_OPTIONS_UTF16: usize = 65_536;
const MAX_IDENTITIES: usize = 256;
type Refusal = Box<Diagnostic>;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Operation {
    Validate,
    Normalize,
    Canonical,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Diagnostic {
    pub code: String,
    pub path: String,
    pub category: Option<String>,
    pub limit: Option<String>,
    // Decimal strings: never serde-wasm-bindgen/JS Number.
    pub maximum: Option<String>,
    pub observed: Option<String>,
}

pub fn transport(code: &str, path: &str) -> Refusal {
    Box::new(Diagnostic {
        code: code.into(),
        path: path.into(),
        category: None,
        limit: None,
        maximum: None,
        observed: None,
    })
}

fn budget_error(name: &str, maximum: u64, observed: u64) -> Refusal {
    let mut error = transport("kwdj.admission_budget_exceeded", "");
    error.category = Some("operational_admission".into());
    error.limit = Some(name.into());
    error.maximum = Some(maximum.to_string());
    error.observed = Some(observed.to_string());
    error
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Response {
    Accepted {
        abi: &'static str,
        operation: Operation,
        canonical_json: String,
        normalization_events: Vec<&'static str>,
        media_manifest: Vec<ManifestEntry>,
        reference_manifest: Vec<ManifestEntry>,
    },
    Refused {
        abi: &'static str,
        operation: Operation,
        diagnostic: Refusal,
    },
}

#[derive(Debug, Serialize)]
pub struct ManifestEntry {
    pub id: String,
    pub path: String,
}

impl Response {
    pub fn refused(operation: Operation, diagnostic: Refusal) -> Self {
        Self::Refused {
            abi: ABI,
            operation,
            diagnostic,
        }
    }
    pub fn json(&self) -> String {
        serde_json::to_string(self).expect("codec transport contains only serializable DTOs")
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Options {
    abi: String,
    identities: Catalog,
    #[serde(default)]
    limits: BTreeMap<String, String>,
    #[serde(default)]
    budget: BTreeMap<String, String>,
}

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct Catalog {
    media: Vec<Fact>,
    references: Vec<Fact>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Fact {
    id: String,
    status: Status,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Status {
    Exists,
    Missing,
    Unavailable,
}

pub struct Context {
    limits: Limits,
    budget: AdmissionBudget,
    media: BTreeMap<Uuid, Status>,
    references: BTreeMap<Uuid, Status>,
    identity_calls: Cell<u64>,
}

fn decimal(value: &str) -> Result<u64, Refusal> {
    if value.is_empty()
        || !value.bytes().all(|b| b.is_ascii_digit())
        || (value.len() > 1 && value.starts_with('0'))
    {
        return Err(transport("codec.invalid_options", "/options"));
    }
    value
        .parse()
        .map_err(|_| transport("codec.invalid_options", "/options"))
}

fn facts(values: Vec<Fact>) -> Result<BTreeMap<Uuid, Status>, Refusal> {
    if values.len() > MAX_IDENTITIES {
        return Err(transport("codec.identity_catalog_limit", "/identities"));
    }
    let mut result = BTreeMap::new();
    for fact in values {
        let id = Uuid::parse_str(&fact.id)
            .map_err(|_| transport("codec.invalid_options", "/identities"))?;
        if result.insert(id, fact.status).is_some() {
            return Err(transport("codec.duplicate_identity", "/identities"));
        }
    }
    Ok(result)
}

impl Context {
    pub fn parse(options: &str) -> Result<Self, Refusal> {
        // The browser checks borrowed JS string length before marshalling it.
        // Native callers have the same UTF-16 bound and a cheap byte bound first.
        if options.len() > MAX_OPTIONS_UTF16 * 3
            || options.encode_utf16().count() > MAX_OPTIONS_UTF16
        {
            return Err(transport("codec.options_too_large", "/options"));
        }
        let options: Options = serde_json::from_str(options)
            .map_err(|_| transport("codec.invalid_options", "/options"))?;
        if options.abi != ABI {
            return Err(transport("codec.unsupported_abi", "/abi"));
        }
        let mut limits = Limits::default();
        for (name, value) in options.limits {
            let value = decimal(&value)?;
            match name.as_str() {
                "document_bytes" => limits.document_bytes = value,
                "tree_depth" => limits.tree_depth = value,
                "node_count" => limits.node_count = value,
                "text_leaf_bytes" => limits.text_leaf_bytes = value,
                "table_rows" => limits.table_rows = value,
                "table_effective_columns" => limits.table_effective_columns = value,
                "authored_attribute_bytes" => limits.authored_attribute_bytes = value,
                _ => return Err(transport("codec.invalid_options", "/limits")),
            }
        }
        let mut budget = AdmissionBudget::default();
        for (name, value) in options.budget {
            let value = decimal(&value)?;
            match name.as_str() {
                "raw_input_bytes" => budget.raw_input_bytes = value,
                "preflight_payload_bytes" => budget.preflight.payload_bytes = value,
                "preflight_values" => budget.preflight.values = value,
                "preflight_depth" => budget.preflight.depth = value,
                _ => return Err(transport("codec.invalid_options", "/budget")),
            }
        }
        Ok(Self {
            limits: limits.effective(),
            budget: budget.effective(),
            media: facts(options.identities.media)?,
            references: facts(options.identities.references)?,
            identity_calls: Cell::new(0),
        })
    }

    pub fn admit_length(&self, length: u64) -> Result<(), Refusal> {
        if length > self.budget.raw_input_bytes {
            return Err(budget_error(
                "raw_input_bytes",
                self.budget.raw_input_bytes,
                length,
            ));
        }
        Ok(())
    }

    /// The actual WASM boundary uses this seam: copying is unreachable on refusal.
    pub fn copy_admitted<T>(
        &self,
        length: u64,
        copy: impl FnOnce() -> Result<T, Refusal>,
    ) -> Result<T, Refusal> {
        self.admit_length(length)?;
        copy()
    }

    pub fn run(&self, operation: Operation, input: &[u8]) -> Response {
        if let Err(error) = self.admit_length(input.len() as u64) {
            return Response::refused(operation, error);
        }
        let result = match operation {
            Operation::Normalize => editor_kwdj::decode_normalize_validate_with_limits_and_budget(
                input,
                self,
                self.limits,
                self.budget,
            ),
            Operation::Validate | Operation::Canonical => {
                editor_kwdj::validate_normalized_json_with_limits_and_budget(
                    input,
                    self,
                    self.limits,
                    self.budget,
                )
            }
        };
        match result {
            Ok(value) => Response::Accepted {
                abi: ABI,
                operation,
                canonical_json: String::from_utf8(value.canonical_json().to_vec())
                    .expect("canonical KWDJ is UTF-8"),
                normalization_events: value
                    .normalization_events()
                    .iter()
                    .map(|e| e.code())
                    .collect(),
                media_manifest: value
                    .media_manifest()
                    .iter()
                    .map(|r| ManifestEntry {
                        id: r.id.to_string(),
                        path: r.path.clone(),
                    })
                    .collect(),
                reference_manifest: value
                    .reference_manifest()
                    .iter()
                    .map(|r| ManifestEntry {
                        id: r.id.to_string(),
                        path: r.path.clone(),
                    })
                    .collect(),
            },
            Err(error) => Response::refused(
                operation,
                Box::new(Diagnostic {
                    code: error.code.as_str().into(),
                    path: error.path,
                    category: error.context.category.map(str::to_owned),
                    limit: error.context.limit.map(str::to_owned),
                    maximum: error.context.maximum.map(|x| x.to_string()),
                    observed: error.context.observed.map(|x| x.to_string()),
                }),
            ),
        }
    }
}

impl IdentityResolver for Context {
    fn resolve_media(&self, id: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        self.lookup(&self.media, id)
    }
    fn resolve_reference(&self, id: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        self.lookup(&self.references, id)
    }
}
impl Context {
    fn lookup(
        &self,
        catalog: &BTreeMap<Uuid, Status>,
        id: &Uuid,
    ) -> Result<IdentityStatus, IdentityResolverError> {
        self.identity_calls.set(self.identity_calls.get() + 1);
        match catalog.get(id) {
            Some(Status::Exists) => Ok(IdentityStatus::Exists),
            Some(Status::Missing) => Ok(IdentityStatus::Missing),
            Some(Status::Unavailable) | None => Err(IdentityResolverError::Unavailable),
        }
    }
}

pub fn execute(operation: Operation, input: &[u8], options: &str) -> Response {
    match Context::parse(options) {
        Ok(context) => context.run(operation, input),
        Err(error) => Response::refused(operation, error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn raw_admission_precedes_copy_and_resolution_and_cannot_be_raised() {
        for maximum in [0, 1] {
            let options = format!(
                r#"{{"abi":"{ABI}","identities":{{"media":[],"references":[]}},"budget":{{"raw_input_bytes":"{maximum}"}}}}"#
            );
            let context = Context::parse(&options).unwrap();
            let copies = Cell::new(0);
            let error = context
                .copy_admitted(2, || {
                    copies.set(copies.get() + 1);
                    Ok(())
                })
                .unwrap_err();
            assert_eq!(error.limit.as_deref(), Some("raw_input_bytes"));
            assert_eq!(error.maximum.as_deref(), Some(maximum.to_string().as_str()));
            assert_eq!(copies.get(), 0);
            assert_eq!(context.identity_calls.get(), 0);
            for op in [
                Operation::Validate,
                Operation::Normalize,
                Operation::Canonical,
            ] {
                assert!(
                    matches!(context.run(op, b"[x"), Response::Refused { diagnostic, .. } if diagnostic.code == "kwdj.admission_budget_exceeded")
                );
            }
            assert_eq!(context.identity_calls.get(), 0);
        }
        let context = Context::parse(&format!(r#"{{"abi":"{ABI}","identities":{{"media":[],"references":[]}},"budget":{{"raw_input_bytes":"18446744073709551615"}}}}"#)).unwrap();
        let error = context
            .admit_length(editor_kwdj::RAW_INPUT_BYTE_CEILING + 1)
            .unwrap_err();
        assert_eq!(error.maximum.as_deref(), Some("16777216"));
        let error = context.admit_length(u64::MAX).unwrap_err();
        assert_eq!(error.observed.as_deref(), Some("18446744073709551615"));
        let exact = Context::parse(&format!(r#"{{"abi":"{ABI}","identities":{{"media":[],"references":[]}},"budget":{{"raw_input_bytes":"2"}}}}"#)).unwrap();
        let copies = Cell::new(0);
        assert!(
            exact
                .copy_admitted(2, || {
                    copies.set(copies.get() + 1);
                    Ok(())
                })
                .is_ok()
        );
        assert_eq!(copies.get(), 1);
        assert!(
            matches!(exact.run(Operation::Validate, b"[x"), Response::Refused { diagnostic, .. } if diagnostic.code == "kwdj.invalid_json")
        );
        let media = br#"{"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"media_image","attrs":{"media_asset_id":"550e8400-e29b-41d4-a716-446655440013","alt":"synthetic","align":"center"},"content":[{"type":"paragraph","content":[]}]}]}"#;
        assert!(
            matches!(exact.run(Operation::Normalize, media), Response::Refused { diagnostic, .. } if diagnostic.limit.as_deref() == Some("raw_input_bytes"))
        );
        assert_eq!(exact.identity_calls.get(), 0);
        assert!(
            matches!(context.run(Operation::Normalize, media), Response::Refused { diagnostic, .. } if diagnostic.code == "kwdj.identity_resolution_failed")
        );
        assert_eq!(context.identity_calls.get(), 1);
        let zero = Context::parse(&format!(r#"{{"abi":"{ABI}","identities":{{"media":[],"references":[]}},"budget":{{"raw_input_bytes":"0"}}}}"#)).unwrap();
        assert!(zero.copy_admitted(0, || Ok(())).is_ok());
        assert!(
            matches!(zero.run(Operation::Validate, b""), Response::Refused { diagnostic, .. } if diagnostic.code == "kwdj.invalid_json")
        );
    }
}
