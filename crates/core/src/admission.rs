// SPDX-License-Identifier: MIT OR Apache-2.0
//! Borrowed operational accounting before copying an untrusted snapshot.
//! No schema validity, Unicode scans, identity resolution or document mutation.

use std::fmt::{self, Write};

use serde_json::{Number, Value};

use crate::document::{Attribute, Attributes, Document, Node};
use crate::limits::{LimitExceeded, check, effective};

/// Distribution ceilings for one borrowed preflight. These are operational
/// work units, not normative document limits or an exact allocation/RSS bound.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PreflightBudget {
    pub payload_bytes: u64,
    pub values: u64,
    pub depth: u64,
}

impl Default for PreflightBudget {
    fn default() -> Self {
        Self {
            payload_bytes: 16 * 1024 * 1024,
            values: 1_000_000,
            depth: 128,
        }
    }
}

impl PreflightBudget {
    pub fn effective(self) -> Self {
        let ceiling = Self::default();
        Self {
            payload_bytes: effective(ceiling.payload_bytes, self.payload_bytes),
            values: effective(ceiling.values, self.values),
            depth: effective(ceiling.depth, self.depth),
        }
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct PreflightUsage {
    pub payload_bytes: u64,
    pub values: u64,
    pub depth: u64,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SnapshotMetrics {
    pub nodes: u64,
    pub tree_depth: u64,
    pub usage: PreflightUsage,
}

struct Account {
    budget: PreflightBudget,
    usage: PreflightUsage,
}

impl Account {
    fn new(budget: PreflightBudget) -> Self {
        Self {
            budget: budget.effective(),
            usage: PreflightUsage::default(),
        }
    }

    fn add_bytes(&mut self, bytes: u64) -> Result<(), LimitExceeded> {
        let observed = self.usage.payload_bytes.saturating_add(bytes);
        check(
            "preflight_payload_bytes",
            self.budget.payload_bytes,
            observed,
        )?;
        self.usage.payload_bytes = observed;
        Ok(())
    }

    fn string(&mut self, value: &str) -> Result<(), LimitExceeded> {
        self.add_bytes(value.len() as u64)
    }

    fn visit(&mut self, depth: u64) -> Result<(), LimitExceeded> {
        check("preflight_depth", self.budget.depth, depth)?;
        self.collection(1)?;
        self.usage.values += 1;
        self.usage.depth = self.usage.depth.max(depth);
        Ok(())
    }

    // Reject a wide collection before iterating it or allocating a pending stack.
    fn collection(&self, length: usize) -> Result<(), LimitExceeded> {
        check(
            "preflight_values",
            self.budget.values,
            self.usage.values.saturating_add(length as u64),
        )
    }

    fn number(&mut self, value: &Number) -> Result<(), LimitExceeded> {
        // Display streams into a counting sink, including when a downstream
        // crate enables serde_json/arbitrary_precision. Never clone/to_string
        // an untrusted number before its budget has been checked.
        struct Sink<'a> {
            account: &'a mut Account,
            refusal: Option<LimitExceeded>,
        }
        impl Write for Sink<'_> {
            fn write_str(&mut self, value: &str) -> fmt::Result {
                self.account.string(value).map_err(|error| {
                    self.refusal = Some(error);
                    fmt::Error
                })
            }
        }
        let mut sink = Sink {
            account: self,
            refusal: None,
        };
        let result = write!(&mut sink, "{value}");
        match sink.refusal {
            Some(error) => Err(error),
            None => {
                // Number's Display only fails when the sink refuses a write.
                debug_assert!(result.is_ok());
                Ok(())
            }
        }
    }

    fn attributes(&mut self, attrs: &Attributes, depth: u64) -> Result<(), LimitExceeded> {
        self.collection(attrs.len())?;
        for (key, value) in attrs {
            self.string(key)?;
            self.attribute(value, depth)?;
        }
        Ok(())
    }

    fn attribute(&mut self, value: &Attribute, depth: u64) -> Result<(), LimitExceeded> {
        self.visit(depth)?;
        match value {
            Attribute::Null => self.add_bytes(4),
            Attribute::Boolean(value) => self.add_bytes(if *value { 4 } else { 5 }),
            Attribute::Number(value) => self.number(value),
            Attribute::String(value) => self.string(value),
            Attribute::List(values) => {
                self.collection(values.len())?;
                for value in values {
                    self.attribute(value, depth + 1)?;
                }
                Ok(())
            }
            Attribute::Object(values) => self.attributes(values, depth + 1),
        }
    }

    fn json(&mut self, value: &Value, depth: u64) -> Result<(), LimitExceeded> {
        self.visit(depth)?;
        match value {
            Value::Null => self.add_bytes(4),
            Value::Bool(value) => self.add_bytes(if *value { 4 } else { 5 }),
            Value::Number(value) => self.number(value),
            Value::String(value) => self.string(value),
            Value::Array(values) => {
                self.collection(values.len())?;
                for value in values {
                    self.json(value, depth + 1)?;
                }
                Ok(())
            }
            Value::Object(values) => {
                self.collection(values.len())?;
                for (key, value) in values {
                    self.string(key)?;
                    self.json(value, depth + 1)?;
                }
                Ok(())
            }
        }
    }

    fn nodes(
        &mut self,
        nodes: &[Node],
        depth: u64,
        metrics: &mut SnapshotMetrics,
    ) -> Result<(), LimitExceeded> {
        self.collection(nodes.len())?;
        for node in nodes {
            self.visit(depth)?;
            metrics.nodes += 1;
            metrics.tree_depth = metrics.tree_depth.max(depth);
            self.string(&node.type_id)?;
            if let Some(text) = &node.text {
                self.string(text)?;
            }
            self.attributes(&node.attributes, depth + 1)?;
            self.collection(node.marks.len())?;
            for mark in &node.marks {
                self.visit(depth + 1)?;
                self.string(&mark.type_id)?;
                self.attributes(&mark.attributes, depth + 2)?;
            }
            self.nodes(&node.children, depth + 1, metrics)?;
        }
        Ok(())
    }
}

/// Counts type IDs, text, keys and scalar payload bytes without cloning/scanning
/// their characters. One work unit per node, mark and attribute value. Collection
/// width and combined node/metadata depth are bounded before recursion.
pub fn preflight_snapshot(
    document: &Document,
    budget: PreflightBudget,
) -> Result<SnapshotMetrics, LimitExceeded> {
    let mut account = Account::new(budget);
    let mut metrics = SnapshotMetrics::default();
    account.nodes(&document.children, 1, &mut metrics)?;
    metrics.usage = account.usage;
    Ok(metrics)
}

/// Bounds a parsed JSON value before normalizers/codec passes copy or traverse
/// it. Parsing itself needs a separate raw-byte check before it starts.
pub fn preflight_json(
    value: &Value,
    budget: PreflightBudget,
) -> Result<PreflightUsage, LimitExceeded> {
    let mut account = Account::new(budget);
    account.json(value, 1)?;
    Ok(account.usage)
}
