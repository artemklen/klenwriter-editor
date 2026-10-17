//! Generic semantic tree. No codec, persisted format, session identity or host services.
//!
//! These are untrusted draft values. A profile/schema must admit them before use
//! as an editable document. Public construction never confers profile validity.

use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Primitive {
    Text,
    TextBlock,
    Container,
    InlineAtom,
    BlockAtom,
    HardBreak,
}

/// Closed data algebra; descriptors and budgets constrain instances at admission.
/// JSON numbers retain exact u64/i64 representation and cannot contain NaN/Infinity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Attribute {
    Null,
    Boolean(bool),
    Number(serde_json::Number),
    String(String),
    List(Vec<Attribute>),
    Object(BTreeMap<String, Attribute>),
}

pub type Attributes = BTreeMap<String, Attribute>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mark {
    pub type_id: String,
    pub attributes: Attributes,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Node {
    pub type_id: String,
    pub primitive: Primitive,
    pub attributes: Attributes,
    pub marks: Vec<Mark>,
    pub text: Option<String>,
    pub children: Vec<Node>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Document {
    pub children: Vec<Node>,
}

/// Borrowing traversal works on either a profile's wire model or a generic tree.
/// It never clones the document and cannot modify a committed profile handle.
pub trait TreeNode: Sized {
    fn type_name(&self) -> &str;
    fn primitive(&self) -> Primitive;
    fn children(&self) -> &[Self];
    fn text(&self) -> Option<&str>;
}

impl TreeNode for Node {
    fn type_name(&self) -> &str {
        &self.type_id
    }
    fn primitive(&self) -> Primitive {
        self.primitive
    }
    fn children(&self) -> &[Self] {
        &self.children
    }
    fn text(&self) -> Option<&str> {
        self.text.as_deref()
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TreeMetrics {
    pub nodes: u64,
    pub depth: u64,
    pub text_bytes: u64,
    pub text_scalars: u64,
    pub text_utf16_units: u64,
}

/// Iterative, borrowed walk; the profile decides which nodes count toward its limits.
pub fn measure<N: TreeNode>(roots: &[N]) -> TreeMetrics {
    let mut metrics = TreeMetrics::default();
    let mut pending: Vec<(&N, u64)> = roots.iter().rev().map(|node| (node, 1)).collect();
    while let Some((node, depth)) = pending.pop() {
        metrics.nodes = metrics.nodes.saturating_add(1);
        metrics.depth = metrics.depth.max(depth);
        if let Some(text) = node.text() {
            metrics.text_bytes = metrics.text_bytes.saturating_add(text.len() as u64);
            metrics.text_scalars = metrics
                .text_scalars
                .saturating_add(text.chars().count() as u64);
            metrics.text_utf16_units = metrics
                .text_utf16_units
                .saturating_add(text.encode_utf16().count() as u64);
        }
        pending.extend(
            node.children()
                .iter()
                .rev()
                .map(|child| (child, depth.saturating_add(1))),
        );
    }
    metrics
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn independent_schema_preserves_unicode_and_structure_without_a_codec() {
        let text = Node {
            type_id: "org.example.notes/text".into(),
            primitive: Primitive::Text,
            attributes: Attributes::new(),
            marks: vec![],
            text: Some("Яe\u{301}😀".into()),
            children: vec![],
        };
        let doc = Document {
            children: vec![Node {
                type_id: "org.example.notes/callout".into(),
                primitive: Primitive::Container,
                attributes: Attributes::new(),
                marks: vec![],
                text: None,
                children: vec![text],
            }],
        };
        let metrics = measure(&doc.children);
        assert_eq!(metrics.nodes, 2);
        assert_eq!(metrics.depth, 2);
        assert_eq!(metrics.text_bytes, 9);
        assert_eq!(metrics.text_scalars, 4);
        assert_eq!(metrics.text_utf16_units, 5);
        assert_eq!(
            doc.children[0].children[0].text.as_deref(),
            Some("Яe\u{301}😀")
        );
    }
}
