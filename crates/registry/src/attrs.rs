// SPDX-License-Identifier: MIT OR Apache-2.0
use crate::decimal::Decimal;
use crate::{
    AttributeField, AttributeSchema, Budget, CompilerLimits, RegistryDiagnostic,
    RegistryErrorCode as E, charge, error, identifier, pointer,
};
use editor_core::document::{Attribute, Attributes};
use editor_core::transaction::{WorkMeter, WorkPhase};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone)]
pub struct CompiledAttributes {
    fields: BTreeMap<String, Field>,
}
#[derive(Debug, Clone)]
struct Field {
    required: bool,
    value: Rule,
}
#[derive(Debug, Clone)]
enum Rule {
    String(u64),
    Boolean,
    Number {
        integer: bool,
        min: Option<Decimal>,
        max: Option<Decimal>,
    },
    Enum(BTreeSet<String>),
    Id,
    Nullable(Box<Rule>),
    List(Box<Rule>, u64),
    Object(CompiledAttributes),
}
impl CompiledAttributes {
    pub fn compile(
        fields: &BTreeMap<String, AttributeField>,
        limits: CompilerLimits,
        work: &mut WorkMeter,
    ) -> Result<Self, RegistryDiagnostic> {
        let start = work.usage();
        let mut b = Budget::new(limits, work);
        let result = Self::build(fields, &mut b, 1, "").map_err(|mut e| {
            e.usage = Box::new(b.usage);
            e
        });
        crate::with_work_usage(result, start, b.work)
    }
    pub(crate) fn build(
        fields: &BTreeMap<String, AttributeField>,
        b: &mut Budget<'_>,
        depth: u64,
        path: &str,
    ) -> Result<Self, RegistryDiagnostic> {
        b.cap(fields.len() as u64, b.limits.attr_rules, "attribute fields")?;
        b.alloc(fields.len() as u64 * 96 + 32)?;
        let mut output = BTreeMap::new();
        for (key, field) in fields {
            b.units(key.len() as u64 + 1)?;
            b.alloc(key.len() as u64)?;
            if key.is_empty() {
                return Err(error(E::InvalidAttributeSchema, path, "empty field name"));
            }
            let p = pointer(path, key);
            output.insert(
                key.clone(),
                Field {
                    required: field.required,
                    value: Rule::build(&field.value, b, depth, &p)?,
                },
            );
        }
        Ok(Self { fields: output })
    }
    pub fn validate(
        &self,
        attrs: &Attributes,
        path: &str,
        work: &mut WorkMeter,
    ) -> Result<(), RegistryDiagnostic> {
        let start = work.usage();
        let result = (|| {
            // This public entry also accepts caller-built native values. Bound
            // them before an unknown key can allocate a diagnostic path, rather
            // than relying on an outer codec/profile to have preflighted them.
            let limits = work.limits();
            let used = work.usage();
            let usage = editor_core::admission::preflight_node_fields(
                "registry/attributes",
                None,
                attrs,
                &[],
                0,
                editor_core::admission::PreflightBudget {
                    payload_bytes: limits.bytes.saturating_sub(used.bytes),
                    values: limits.units.saturating_sub(used.units),
                    depth: 128,
                },
            )
            .map_err(|_| error(E::ResourceLimitExceeded, path, "attribute preflight"))?;
            charge(work, usage.values, usage.payload_bytes)?;
            self.validate_inner(attrs, path, work)
        })();
        crate::with_work_usage(result, start, work)
    }
    fn validate_inner(
        &self,
        attrs: &Attributes,
        path: &str,
        work: &mut WorkMeter,
    ) -> Result<(), RegistryDiagnostic> {
        charge(work, 1, 0)?;
        work.note_phase(WorkPhase::StaticValidation, 1, 0);
        for (key, field) in &self.fields {
            charge(work, 1, 0)?;
            if !attrs.contains_key(key) && field.required {
                return Err(error(
                    E::RequiredAttributeMissing,
                    &pointer(path, key),
                    "required attribute",
                ));
            }
        }
        for (key, value) in attrs {
            charge(work, 1, 0)?;
            let p = pointer(path, key);
            let field = self
                .fields
                .get(key)
                .ok_or_else(|| error(E::UnknownAttribute, &p, "closed attribute object"))?;
            field.value.validate(value, &p, work)?;
        }
        Ok(())
    }
}
impl Rule {
    fn build(
        rule: &AttributeSchema,
        b: &mut Budget<'_>,
        depth: u64,
        path: &str,
    ) -> Result<Self, RegistryDiagnostic> {
        b.units(1)?;
        b.cap(depth, b.limits.attr_depth, "attribute depth")?;
        b.usage.attr_rules = b
            .usage
            .attr_rules
            .checked_add(1)
            .ok_or_else(|| b.resource("attribute rules"))?;
        b.cap(b.usage.attr_rules, b.limits.attr_rules, "attribute rules")?;
        b.alloc(80)?;
        Ok(match rule {
            AttributeSchema::String { max_bytes } => Self::String(*max_bytes),
            AttributeSchema::Boolean {} => Self::Boolean,
            AttributeSchema::Number { min, max } | AttributeSchema::Integer { min, max } => {
                let low = min
                    .as_deref()
                    .map(|s| Decimal::parse(s, b, path))
                    .transpose()?;
                let high = max
                    .as_deref()
                    .map(|s| Decimal::parse(s, b, path))
                    .transpose()?;
                if matches!((&low,&high),(Some(l),Some(h))if l.cmp(h)==Ordering::Greater) {
                    return Err(error(
                        E::InvalidAttributeSchema,
                        path,
                        "reversed numeric range",
                    ));
                }
                Self::Number {
                    integer: matches!(rule, AttributeSchema::Integer { .. }),
                    min: low,
                    max: high,
                }
            }
            AttributeSchema::Enum { values } => {
                if values.is_empty() {
                    return Err(error(E::InvalidAttributeSchema, path, "empty enum"));
                }
                b.cap(values.len() as u64, b.limits.json_values, "enum values")?;
                let mut set = BTreeSet::new();
                for value in values {
                    b.units(value.len() as u64 + 1)?;
                    b.alloc(value.len() as u64 + 64)?;
                    if !set.insert(value.clone()) {
                        return Err(error(E::InvalidAttributeSchema, path, "duplicate enum"));
                    }
                }
                Self::Enum(set)
            }
            AttributeSchema::Id {} => Self::Id,
            AttributeSchema::Nullable { inner } => {
                Self::Nullable(Box::new(Self::build(inner, b, depth + 1, path)?))
            }
            AttributeSchema::List { item, max_items } => {
                Self::List(Box::new(Self::build(item, b, depth + 1, path)?), *max_items)
            }
            AttributeSchema::Object { fields } => {
                Self::Object(CompiledAttributes::build(fields, b, depth + 1, path)?)
            }
        })
    }
    fn validate(
        &self,
        value: &Attribute,
        path: &str,
        work: &mut WorkMeter,
    ) -> Result<(), RegistryDiagnostic> {
        charge(work, 1, 0)?;
        let wrong = || error(E::AttributeTypeMismatch, path, "attribute type");
        let range = || error(E::AttributeOutOfRange, path, "attribute range");
        match (self, value) {
            (Self::String(max), Attribute::String(s)) => {
                if s.len() as u64 > *max {
                    return Err(error(E::AttributeLimitExceeded, path, "UTF8 string bytes"));
                }
            }
            (Self::Boolean, Attribute::Boolean(_)) => {}
            (Self::Number { integer, min, max }, Attribute::Number(n)) => {
                if *integer && !n.is_i64() && !n.is_u64() {
                    return Err(wrong());
                }
                // Default Number is fixed-size; upstream arbitrary_precision must
                // still be preflighted before this bounded textual conversion.
                let mut sink = NumberSink {
                    work,
                    text: String::new(),
                    refused: false,
                };
                use std::fmt::Write;
                let result = write!(&mut sink, "{n}");
                if result.is_err() || sink.refused {
                    return Err(error(
                        E::ResourceLimitExceeded,
                        path,
                        "represented number bytes",
                    ));
                }
                let mut b = Budget::new(CompilerLimits::default(), sink.work);
                let dec = Decimal::parse(&sink.text, &mut b, path)?;
                if min.as_ref().is_some_and(|m| dec.cmp(m) == Ordering::Less)
                    || max
                        .as_ref()
                        .is_some_and(|m| dec.cmp(m) == Ordering::Greater)
                {
                    return Err(range());
                }
            }
            (Self::Enum(values), Attribute::String(s)) => {
                charge(work, s.len() as u64, 0)?;
                if !values.contains(s) {
                    return Err(range());
                }
            }
            (Self::Id, Attribute::String(s)) => {
                charge(work, s.len() as u64, 0)?;
                if !identifier(s) {
                    return Err(range());
                }
            }
            (Self::Nullable(_), Attribute::Null) => {}
            (Self::Nullable(inner), v) => inner.validate(v, path, work)?,
            (Self::List(item, max), Attribute::List(values)) => {
                if values.len() as u64 > *max {
                    return Err(error(E::AttributeLimitExceeded, path, "list items"));
                }
                for (i, v) in values.iter().enumerate() {
                    item.validate(v, &format!("{path}/{i}"), work)?;
                }
            }
            (Self::Object(fields), Attribute::Object(values)) => {
                fields.validate(values, path, work)?
            }
            _ => return Err(wrong()),
        }
        Ok(())
    }
}
struct NumberSink<'a> {
    work: &'a mut WorkMeter,
    text: String,
    refused: bool,
}
impl std::fmt::Write for NumberSink<'_> {
    fn write_str(&mut self, s: &str) -> std::fmt::Result {
        if self.text.len() + s.len() > 512
            || charge(self.work, s.len() as u64, s.len() as u64).is_err()
        {
            self.refused = true;
            return Err(std::fmt::Error);
        }
        self.text.push_str(s);
        Ok(())
    }
}

pub(crate) fn normalize_bounds(
    schema: &mut AttributeSchema,
    b: &mut Budget<'_>,
) -> Result<(), RegistryDiagnostic> {
    match schema {
        AttributeSchema::Number { min, max } | AttributeSchema::Integer { min, max } => {
            for value in [min, max].into_iter().flatten() {
                *value = Decimal::parse(value, b, "")?.canonical();
            }
        }
        AttributeSchema::Nullable { inner } | AttributeSchema::List { item: inner, .. } => {
            normalize_bounds(inner, b)?
        }
        AttributeSchema::Object { fields } => {
            for field in fields.values_mut() {
                normalize_bounds(&mut field.value, b)?;
            }
        }
        AttributeSchema::Enum { values } => values.sort(),
        _ => {}
    }
    Ok(())
}

impl CompiledAttributes {
    pub(crate) fn validate_literals(
        &self,
        present: &BTreeSet<&str>,
        literals: &Attributes,
        path: &str,
        work: &mut WorkMeter,
    ) -> Result<(), RegistryDiagnostic> {
        for (key, field) in &self.fields {
            charge(work, 1, 0)?;
            if field.required && !present.contains(key.as_str()) {
                return Err(error(
                    E::RequiredAttributeMissing,
                    &pointer(path, key),
                    "required static field",
                ));
            }
        }
        for key in present {
            charge(work, 1, 0)?;
            if !self.fields.contains_key(*key) {
                return Err(error(
                    E::UnknownAttribute,
                    &pointer(path, key),
                    "unknown static field",
                ));
            }
        }
        for (key, value) in literals {
            self.fields[key]
                .value
                .validate(value, &pointer(path, key), work)?;
        }
        Ok(())
    }
    pub(crate) fn validate_literal_field(
        &self,
        key: &str,
        value: &Attribute,
        path: &str,
        work: &mut WorkMeter,
    ) -> Result<(), RegistryDiagnostic> {
        let field = self
            .fields
            .get(key)
            .ok_or_else(|| error(E::UnknownAttribute, path, "unknown static field"))?;
        field.value.validate(value, path, work)
    }
}
/// Copy a bounded descriptor literal to the generic data algebra. This is not
/// a semantic codec and preserves the represented serde_json Number exactly.
pub fn copy_literal(
    value: &serde_json::Value,
    work: &mut WorkMeter,
) -> Result<Attribute, RegistryDiagnostic> {
    let start = work.usage();
    let result = (|| {
        let limits = work.limits();
        let used = work.usage();
        let usage = editor_core::admission::preflight_json(
            value,
            editor_core::admission::PreflightBudget {
                payload_bytes: limits.bytes.saturating_sub(used.bytes),
                values: limits.units.saturating_sub(used.units),
                depth: 128,
            },
        )
        .map_err(|_| error(E::ResourceLimitExceeded, "", "literal preflight"))?;
        charge(
            work,
            usage.values,
            usage
                .payload_bytes
                .checked_mul(2)
                .and_then(|n| n.checked_add(usage.values * 64))
                .ok_or_else(|| error(E::ResourceLimitExceeded, "", "literal ownership"))?,
        )?;
        fn copy(v: &serde_json::Value) -> Attribute {
            match v {
                serde_json::Value::Null => Attribute::Null,
                serde_json::Value::Bool(v) => Attribute::Boolean(*v),
                serde_json::Value::Number(v) => Attribute::Number(v.clone()),
                serde_json::Value::String(v) => Attribute::String(v.clone()),
                serde_json::Value::Array(v) => Attribute::List(v.iter().map(copy).collect()),
                serde_json::Value::Object(v) => {
                    Attribute::Object(v.iter().map(|(k, v)| (k.clone(), copy(v))).collect())
                }
            }
        }
        Ok(copy(value))
    })();
    crate::with_work_usage(result, start, work)
}
