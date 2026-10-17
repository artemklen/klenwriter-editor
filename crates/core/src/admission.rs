// SPDX-License-Identifier: MIT OR Apache-2.0
//! Borrowed operational accounting before copying an untrusted snapshot.
//! No schema validity, Unicode scans, identity resolution or document mutation.

use std::fmt::{self, Write};

use serde_json::{Number, Value};

use crate::document::{Attribute, Attributes, Document, Mark, Node};
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

    // The caller visits the node itself, then shares exactly this metadata
    // accounting between a full walk and an individual record-copy guard.
    fn node_metadata(&mut self, node: &Node, depth: u64) -> Result<(), LimitExceeded> {
        self.node_fields(
            &node.type_id,
            node.text.as_deref(),
            &node.attributes,
            &node.marks,
            node.children.len(),
            depth,
        )
    }

    fn node_fields(
        &mut self,
        type_id: &str,
        text: Option<&str>,
        attributes: &Attributes,
        marks: &[Mark],
        child_count: usize,
        depth: u64,
    ) -> Result<(), LimitExceeded> {
        self.string(type_id)?;
        if let Some(text) = text {
            self.string(text)?;
        }
        self.attributes(attributes, depth + 1)?;
        self.collection(marks.len())?;
        for mark in marks {
            self.visit(depth + 1)?;
            self.string(&mark.type_id)?;
            self.attributes(&mark.attributes, depth + 2)?;
        }
        self.collection(child_count)
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
            self.node_metadata(node, depth)?;
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

/// Accounts for one borrowed node record without visiting its children.
///
/// Type ID, text, attribute keys/values and mark metadata use the same accounting
/// as [`preflight_snapshot`], with this node at depth 1. Text is measured by byte
/// length, never copied or scanned for Unicode. Child collection width is checked
/// before a caller could copy child references; child records and their payloads
/// are excluded. Width checks reserve no work units: `values` counts only the
/// visited node, marks and attribute values. Structural storage overhead belongs
/// to the caller's separate copy policy. This does not confer schema validity.
pub fn preflight_node_metadata(
    node: &Node,
    budget: PreflightBudget,
) -> Result<PreflightUsage, LimitExceeded> {
    let mut account = Account::new(budget);
    account.visit(1)?;
    account.node_metadata(node, 1)?;
    Ok(account.usage)
}

/// The same single-record preflight for a borrowed view that has no owned Node.
/// No field, text, mark, attribute or child ID is cloned to perform this check.
pub fn preflight_node_fields(
    type_id: &str,
    text: Option<&str>,
    attributes: &Attributes,
    marks: &[Mark],
    child_count: usize,
    budget: PreflightBudget,
) -> Result<PreflightUsage, LimitExceeded> {
    let mut account = Account::new(budget);
    account.visit(1)?;
    account.node_fields(type_id, text, attributes, marks, child_count, 1)?;
    Ok(account.usage)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::{Mark, Primitive};

    fn node() -> Node {
        Node {
            type_id: "note".into(),
            primitive: Primitive::Text,
            attributes: Attributes::new(),
            marks: vec![],
            text: None,
            children: vec![],
        }
    }

    #[test]
    fn node_metadata_counts_nested_attributes_and_marks_like_the_full_walk() {
        let mut source = node();
        source.text = Some("Я".into());
        source
            .attributes
            .insert("title".into(), Attribute::String("hi".into()));
        source.attributes.insert(
            "meta".into(),
            Attribute::Object(Attributes::from([
                ("flag".into(), Attribute::Boolean(true)),
                (
                    "nums".into(),
                    Attribute::List(vec![Attribute::Null, Attribute::Number(7.into())]),
                ),
            ])),
        );
        source.marks.push(Mark {
            type_id: "m".into(),
            attributes: Attributes::from([("tone".into(), Attribute::String("x".into()))]),
        });
        let usage = preflight_node_metadata(&source, PreflightBudget::default()).unwrap();
        assert_eq!(
            preflight_node_fields(
                &source.type_id,
                source.text.as_deref(),
                &source.attributes,
                &source.marks,
                source.children.len(),
                PreflightBudget::default()
            )
            .unwrap(),
            usage
        );
        assert_eq!(
            usage,
            PreflightUsage {
                payload_bytes: 40,
                values: 9,
                depth: 4
            }
        );
        let document = Document {
            children: vec![source],
        };
        assert_eq!(
            preflight_snapshot(&document, PreflightBudget::default())
                .unwrap()
                .usage,
            usage
        );
    }

    #[test]
    fn borrowed_text_is_counted_at_its_exact_byte_limit() {
        let mut source = node();
        source.text = Some("😀".repeat(16_384));
        let expected = (source.type_id.len() + source.text.as_ref().unwrap().len()) as u64;
        let exact = PreflightBudget {
            payload_bytes: expected,
            ..PreflightBudget::default()
        };
        let usage = preflight_node_metadata(&source, exact).unwrap();
        assert_eq!(usage.payload_bytes, expected);
        assert_eq!(usage.values, 1);
        assert_eq!(usage.depth, 1);
        let error = preflight_node_metadata(
            &source,
            PreflightBudget {
                payload_bytes: expected - 1,
                ..exact
            },
        )
        .unwrap_err();
        assert_eq!(
            error,
            LimitExceeded {
                name: "preflight_payload_bytes",
                maximum: expected - 1,
                observed: expected
            }
        );
    }

    #[test]
    fn children_are_not_visited_but_their_collection_width_is_guarded() {
        let mut source = node();
        let mut child = node();
        child.text = Some("x".repeat(65_536));
        let mut nested = Attribute::Null;
        for _ in 0..16 {
            nested = Attribute::List(vec![nested]);
        }
        child.attributes.insert("deep".into(), nested);
        source.children.push(child);
        let budget = PreflightBudget {
            payload_bytes: 4,
            values: 2,
            depth: 1,
        };
        assert_eq!(
            preflight_node_metadata(&source, budget).unwrap(),
            PreflightUsage {
                payload_bytes: 4,
                values: 1,
                depth: 1
            }
        );
        let error = preflight_node_metadata(
            &source,
            PreflightBudget {
                values: 1,
                ..budget
            },
        )
        .unwrap_err();
        assert_eq!(
            error,
            LimitExceeded {
                name: "preflight_values",
                maximum: 1,
                observed: 2
            }
        );
        assert!(
            preflight_snapshot(
                &Document {
                    children: vec![source]
                },
                budget
            )
            .is_err()
        );
    }

    #[test]
    fn metadata_budget_refuses_before_deep_attribute_contents() {
        let mut source = node();
        let mut nested = Attribute::Null;
        for _ in 0..16 {
            nested = Attribute::List(vec![nested]);
        }
        source.attributes.insert("key".into(), nested);
        let budget = PreflightBudget {
            payload_bytes: 4,
            values: 1,
            depth: 1,
        };
        // Attribute collection width refuses before reading its key or nested
        // values, which would fail other budgets if they were reached.
        assert_eq!(
            preflight_node_metadata(&source, budget).unwrap_err(),
            LimitExceeded {
                name: "preflight_values",
                maximum: 1,
                observed: 2
            }
        );
        let error = preflight_node_metadata(
            &source,
            PreflightBudget {
                values: 64,
                ..budget
            },
        )
        .unwrap_err();
        assert_eq!(
            error,
            LimitExceeded {
                name: "preflight_payload_bytes",
                maximum: 4,
                observed: 7
            }
        );
    }
}
