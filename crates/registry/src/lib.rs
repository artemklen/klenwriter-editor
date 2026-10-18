// SPDX-License-Identifier: MIT OR Apache-2.0
//! Bounded public schema registration. A registry proves schema constraints,
//! never codec validity, host facts, or permission to publish a transaction.

mod attrs;
mod compile;
mod decimal;
mod grammar;
mod json;
mod schema;

pub use attrs::CompiledAttributes;
pub use compile::{
    FrozenRegistry, MarkDescriptorRef, NodeDescriptorRef, RegistryDigest, compile_descriptor,
    compile_json,
};
pub use grammar::CompiledGrammar;
pub use json::{JsonLimits, JsonUsage, preflight_json};
pub use schema::{PreparedSchema, SchemaCache, SchemaUsage};

use editor_core::document::Primitive;
use editor_core::transaction::{WorkMeter, WorkUsage};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeMap;
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegistryDescriptor {
    pub format: String,
    pub profile: ProfileDescriptor,
    pub selected_extensions: Vec<ExtensionIdentity>,
    pub root: Grammar,
    pub mark_policy: BTreeMap<String, Vec<String>>,
    pub extensions: Vec<ExtensionDescriptor>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileDescriptor {
    pub id: String,
    pub version: String,
    pub codec_id: String,
    pub wire_version: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExtensionIdentity {
    pub id: String,
    pub version: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExtensionDescriptor {
    pub id: String,
    pub version: String,
    pub dependencies: Vec<ExtensionIdentity>,
    pub nodes: Vec<NodeDescriptor>,
    pub marks: Vec<MarkDescriptor>,
    pub commands: Vec<CommandDescriptor>,
}
/// No recipe declarations are accepted until their separate language is frozen.
/// An empty enum makes nonempty command arrays refuse, never advertise a stub.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CommandDescriptor {}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NodeDescriptor {
    pub id: String,
    pub primitive: PrimitiveDescriptor,
    pub attrs: BTreeMap<String, AttributeField>,
    pub children: Grammar,
    pub marks: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MarkDescriptor {
    pub id: String,
    pub attrs: BTreeMap<String, AttributeField>,
    pub excludes: Vec<String>,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PrimitiveDescriptor {
    Text,
    TextBlock,
    Container,
    InlineAtom,
    BlockAtom,
    HardBreak,
}
impl PrimitiveDescriptor {
    pub fn core(self) -> Primitive {
        match self {
            Self::Text => Primitive::Text,
            Self::TextBlock => Primitive::TextBlock,
            Self::Container => Primitive::Container,
            Self::InlineAtom => Primitive::InlineAtom,
            Self::BlockAtom => Primitive::BlockAtom,
            Self::HardBreak => Primitive::HardBreak,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AttributeField {
    pub required: bool,
    pub value: AttributeSchema,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum Grammar {
    Empty {},
    Type {
        id: String,
    },
    Sequence {
        items: Vec<Grammar>,
    },
    Choice {
        items: Vec<Grammar>,
    },
    Repeat {
        item: Box<Grammar>,
        min: u64,
        max: u64,
    },
}
fn required_option<'de, D: Deserializer<'de>>(de: D) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(de)
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum AttributeSchema {
    String {
        max_bytes: u64,
    },
    Boolean {},
    Number {
        #[serde(deserialize_with = "required_option")]
        min: Option<String>,
        #[serde(deserialize_with = "required_option")]
        max: Option<String>,
    },
    Integer {
        #[serde(deserialize_with = "required_option")]
        min: Option<String>,
        #[serde(deserialize_with = "required_option")]
        max: Option<String>,
    },
    Enum {
        values: Vec<String>,
    },
    Id {},
    Nullable {
        inner: Box<AttributeSchema>,
    },
    List {
        item: Box<AttributeSchema>,
        max_items: u64,
    },
    Object {
        fields: BTreeMap<String, AttributeField>,
    },
}

macro_rules! errors {
    ($($variant:ident => $name:literal),+ $(,)?) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub enum RegistryErrorCode { $($variant),+ }
        impl RegistryErrorCode { pub fn as_str(self) -> &'static str { match self { $(Self::$variant => concat!("registry.", $name)),+ } } }
    }
}
errors! {
    InvalidJson=>"invalid_json", DuplicateJsonKey=>"duplicate_json_key", UnsupportedFormat=>"unsupported_format",
    InvalidDescriptor=>"invalid_descriptor", InvalidIdentifier=>"invalid_identifier", InvalidVersion=>"invalid_version",
    DuplicateExtension=>"duplicate_extension", ExtensionMissing=>"extension_missing", ExtensionVersionMismatch=>"extension_version_mismatch",
    DependencyMissing=>"dependency_missing", DependencyVersionMismatch=>"dependency_version_mismatch", DependencyCycle=>"dependency_cycle",
    DuplicateNode=>"duplicate_node", DuplicateMark=>"duplicate_mark", DuplicateCommand=>"duplicate_command",
    UnknownType=>"unknown_type", UnknownMark=>"unknown_mark", InvalidGrammar=>"invalid_grammar",
    InvalidAttributeSchema=>"invalid_attribute_schema", InvalidNumericBound=>"invalid_numeric_bound", ResourceLimitExceeded=>"resource_limit_exceeded",
    UnknownNode=>"unknown_node", PrimitiveMismatch=>"primitive_mismatch", InvalidNodeShape=>"invalid_node_shape",
    RequiredAttributeMissing=>"required_attribute_missing", UnknownAttribute=>"unknown_attribute",
    AttributeTypeMismatch=>"attribute_type_mismatch", AttributeOutOfRange=>"attribute_out_of_range", AttributeLimitExceeded=>"attribute_limit_exceeded",
    MarkNotAllowed=>"mark_not_allowed", MarkExcluded=>"mark_excluded", GrammarMismatch=>"grammar_mismatch"
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegistryDiagnostic {
    pub code: RegistryErrorCode,
    pub path: String,
    pub detail: &'static str,
    pub child_index: Option<usize>,
    pub usage: Box<RegistryUsage>,
}
impl fmt::Display for RegistryDiagnostic {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} at {}", self.code.as_str(), self.path)
    }
}
impl std::error::Error for RegistryDiagnostic {}
pub(crate) fn error(
    code: RegistryErrorCode,
    path: &str,
    detail: &'static str,
) -> RegistryDiagnostic {
    RegistryDiagnostic {
        code,
        path: path.into(),
        detail,
        child_index: None,
        usage: Box::default(),
    }
}
pub(crate) fn pointer(base: &str, field: &str) -> String {
    format!("{base}/{}", field.replace('~', "~0").replace('/', "~1"))
}
pub(crate) fn identifier(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty()
        && b.len() <= 128
        && b[0].is_ascii_alphanumeric()
        && b[b.len() - 1].is_ascii_alphanumeric()
        && b.iter()
            .all(|b| b.is_ascii_alphanumeric() || b"._-/".contains(b))
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RegistryUsage {
    pub descriptor_bytes: u64,
    pub json_values: u64,
    pub attr_rules: u64,
    pub grammar_operators: u64,
    pub states: u64,
    pub transitions: u64,
    pub owned_bytes: u64,
    pub work: WorkUsage,
}
#[derive(Debug, Clone, Copy)]
pub struct CompilerLimits {
    pub descriptor_bytes: u64,
    pub json_depth: u64,
    pub json_values: u64,
    pub extensions: u64,
    pub node_mark_declarations: u64,
    pub attr_rules: u64,
    pub attr_depth: u64,
    pub grammar_operators: u64,
    pub grammar_depth: u64,
    pub states: u64,
    pub transitions: u64,
    pub work_units: u64,
    pub owned_bytes: u64,
    pub decimal_bytes: u64,
    pub decimal_digits: u64,
    pub decimal_abs_exponent: u64,
}
impl Default for CompilerLimits {
    fn default() -> Self {
        Self {
            descriptor_bytes: 256 * 1024,
            json_depth: 128,
            json_values: 131072,
            extensions: 64,
            node_mark_declarations: 1024,
            attr_rules: 4096,
            attr_depth: 16,
            grammar_operators: 8192,
            grammar_depth: 32,
            states: 16384,
            transitions: 65536,
            work_units: 1_000_000,
            owned_bytes: 16 * 1024 * 1024,
            decimal_bytes: 512,
            decimal_digits: 256,
            decimal_abs_exponent: 4096,
        }
    }
}
impl CompilerLimits {
    pub fn effective(self) -> Self {
        let h = Self::default();
        Self {
            descriptor_bytes: self.descriptor_bytes.min(h.descriptor_bytes),
            json_depth: self.json_depth.min(h.json_depth),
            json_values: self.json_values.min(h.json_values),
            extensions: self.extensions.min(h.extensions),
            node_mark_declarations: self.node_mark_declarations.min(h.node_mark_declarations),
            attr_rules: self.attr_rules.min(h.attr_rules),
            attr_depth: self.attr_depth.min(h.attr_depth),
            grammar_operators: self.grammar_operators.min(h.grammar_operators),
            grammar_depth: self.grammar_depth.min(h.grammar_depth),
            states: self.states.min(h.states),
            transitions: self.transitions.min(h.transitions),
            work_units: self.work_units.min(h.work_units),
            owned_bytes: self.owned_bytes.min(h.owned_bytes),
            decimal_bytes: self.decimal_bytes.min(h.decimal_bytes),
            decimal_digits: self.decimal_digits.min(h.decimal_digits),
            decimal_abs_exponent: self.decimal_abs_exponent.min(h.decimal_abs_exponent),
        }
    }
}
pub(crate) struct Budget<'a> {
    pub limits: CompilerLimits,
    pub usage: RegistryUsage,
    pub work: &'a mut WorkMeter,
}
impl<'a> Budget<'a> {
    pub fn new(limits: CompilerLimits, work: &'a mut WorkMeter) -> Self {
        Self {
            limits: limits.effective(),
            usage: RegistryUsage::default(),
            work,
        }
    }
    pub fn units(&mut self, n: u64) -> Result<(), RegistryDiagnostic> {
        let next = self
            .usage
            .work
            .units
            .checked_add(n)
            .ok_or_else(|| self.resource("work overflow"))?;
        if next > self.limits.work_units {
            return Err(self.resource("compiler work"));
        }
        self.work
            .charge_units(n)
            .map_err(|_| self.resource("shared work"))?;
        self.usage.work.units = next;
        Ok(())
    }
    pub fn alloc(&mut self, n: u64) -> Result<(), RegistryDiagnostic> {
        let next = self
            .usage
            .owned_bytes
            .checked_add(n)
            .ok_or_else(|| self.resource("ownership overflow"))?;
        if next > self.limits.owned_bytes {
            return Err(self.resource("compiler ownership"));
        }
        self.work
            .charge_bytes(n)
            .map_err(|_| self.resource("shared bytes"))?;
        self.usage.owned_bytes = next;
        self.usage.work.bytes = next;
        Ok(())
    }
    pub fn resource(&self, detail: &'static str) -> RegistryDiagnostic {
        let mut e = error(RegistryErrorCode::ResourceLimitExceeded, "", detail);
        e.usage = Box::new(self.usage);
        e
    }
    pub fn cap(&self, n: u64, max: u64, detail: &'static str) -> Result<(), RegistryDiagnostic> {
        if n > max {
            Err(self.resource(detail))
        } else {
            Ok(())
        }
    }
}
pub(crate) fn charge(
    work: &mut WorkMeter,
    units: u64,
    bytes: u64,
) -> Result<(), RegistryDiagnostic> {
    work.charge_units(units)
        .and_then(|()| work.charge_bytes(bytes))
        .map_err(|_| error(RegistryErrorCode::ResourceLimitExceeded, "", "schema work"))
}

/// Attach the actual shared-meter delta to a public refusal, including failed
/// attempts. No counter is reset or synthesized from a declared input size.
pub(crate) fn with_work_usage<T>(
    result: Result<T, RegistryDiagnostic>,
    start: WorkUsage,
    work: &WorkMeter,
) -> Result<T, RegistryDiagnostic> {
    result.map_err(|mut e| {
        let end = work.usage();
        e.usage.work = WorkUsage {
            units: end.units.saturating_sub(start.units),
            bytes: end.bytes.saturating_sub(start.bytes),
        };
        e
    })
}

/// A compiled profile exposes its immutable admitted schema to a generic
/// extension command adapter. Codec and semantic authority remain with P.
pub trait RegistryProfile: editor_core::profile::FrozenProfile {
    fn registry(&self) -> &FrozenRegistry;
}
