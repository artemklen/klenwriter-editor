// SPDX-License-Identifier: MIT OR Apache-2.0
//! Borrowed views for the shared KWDJ validator and count-only wire encoding.
//! Cached candidate headers contain bounded metadata, never actual text/trees.

use std::collections::BTreeMap;

use editor_core::candidate::CandidateRead;
use editor_core::document::TreeNode;
use serde::ser::{Serialize, SerializeMap, SerializeSeq, Serializer};

use crate::model::{Node, Profile};

pub(crate) trait ValidationView {
    type Handle: Copy;
    fn roots_len(&self) -> usize;
    fn root(&self, index: usize) -> Self::Handle;
    fn header(&self, node: Self::Handle) -> &Node;
    fn text(&self, node: Self::Handle) -> Option<&str>;
    fn children_len(&self, node: Self::Handle) -> usize;
    fn child(&self, node: Self::Handle, index: usize) -> Self::Handle;
}

pub(crate) struct WireView<'a> {
    pub roots: &'a [Node],
}

impl<'a> ValidationView for WireView<'a> {
    type Handle = &'a Node;

    fn roots_len(&self) -> usize {
        self.roots.len()
    }
    fn root(&self, index: usize) -> Self::Handle {
        &self.roots[index]
    }
    fn header(&self, node: Self::Handle) -> &Node {
        node
    }
    fn text(&self, node: Self::Handle) -> Option<&str> {
        node.text()
    }
    fn children_len(&self, node: Self::Handle) -> usize {
        node.children().len()
    }
    fn child(&self, node: Self::Handle, index: usize) -> Self::Handle {
        &node.children()[index]
    }
}

pub(crate) struct CandidateView<'a, V: CandidateRead> {
    pub source: &'a V,
    pub headers: BTreeMap<V::Id, Node>,
}

impl<V: CandidateRead> ValidationView for CandidateView<'_, V> {
    type Handle = V::Id;

    fn roots_len(&self) -> usize {
        self.source.roots().len()
    }
    fn root(&self, index: usize) -> Self::Handle {
        self.source.roots()[index]
    }
    fn header(&self, node: Self::Handle) -> &Node {
        &self.headers[&node]
    }
    fn text(&self, node: Self::Handle) -> Option<&str> {
        self.source
            .node(node)
            .expect("checked stable candidate")
            .text
    }
    fn children_len(&self, node: Self::Handle) -> usize {
        self.source
            .node(node)
            .expect("checked stable candidate")
            .children
            .len()
    }
    fn child(&self, node: Self::Handle, index: usize) -> Self::Handle {
        self.source
            .node(node)
            .expect("checked stable candidate")
            .children[index]
    }
}

/// Object key order does not affect encoded length. The same serde_json string,
/// integer and enum encoding as the native wire model is used for every value.
pub(crate) struct DocumentWire<'a, V: ValidationView> {
    pub view: &'a V,
    pub profile: Profile,
}

impl<V: ValidationView> Serialize for DocumentWire<'_, V> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut object = serializer.serialize_map(Some(4))?;
        object.serialize_entry("schema", "klenwriter.document")?;
        object.serialize_entry("schema_version", &1u64)?;
        object.serialize_entry("profile", &self.profile)?;
        object.serialize_entry(
            "content",
            &Content {
                view: self.view,
                parent: None,
            },
        )?;
        object.end()
    }
}

struct Content<'a, V: ValidationView> {
    view: &'a V,
    parent: Option<V::Handle>,
}

impl<V: ValidationView> Serialize for Content<'_, V> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let length = self.parent.map_or_else(
            || self.view.roots_len(),
            |node| self.view.children_len(node),
        );
        let mut sequence = serializer.serialize_seq(Some(length))?;
        for index in 0..length {
            let node = self.parent.map_or_else(
                || self.view.root(index),
                |parent| self.view.child(parent, index),
            );
            sequence.serialize_element(&NodeWire {
                view: self.view,
                node,
            })?;
        }
        sequence.end()
    }
}

struct NodeWire<'a, V: ValidationView> {
    view: &'a V,
    node: V::Handle,
}

impl<V: ValidationView> Serialize for NodeWire<'_, V> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let header = self.view.header(self.node);
        let mut object = serializer.serialize_map(None)?;
        object.serialize_entry("type", header.kind())?;
        match header {
            Node::Text { marks, .. } => {
                object.serialize_entry(
                    "text",
                    self.view.text(self.node).expect("checked text node"),
                )?;
                if let Some(marks) = marks {
                    object.serialize_entry("marks", marks)?;
                }
            }
            Node::Paragraph {
                attrs: Some(attrs), ..
            } => object.serialize_entry("attrs", attrs)?,
            Node::Heading { attrs, .. } => object.serialize_entry("attrs", attrs)?,
            Node::CodeBlock {
                attrs: Some(attrs), ..
            } => object.serialize_entry("attrs", attrs)?,
            Node::TaskItem { attrs, .. } => object.serialize_entry("attrs", attrs)?,
            Node::OrderedList {
                attrs: Some(attrs), ..
            } => object.serialize_entry("attrs", attrs)?,
            Node::TableHeader { attrs, .. } | Node::TableCell { attrs, .. } => {
                if let Some(attrs) = attrs {
                    object.serialize_entry("attrs", attrs)?;
                }
            }
            Node::MediaImage { attrs, .. } => object.serialize_entry("attrs", attrs)?,
            Node::LiteraryBlock { attrs, .. } => object.serialize_entry("attrs", attrs)?,
            Node::Warning { attrs, .. } => object.serialize_entry("attrs", attrs)?,
            Node::Spoiler { attrs, .. } | Node::Disclosure { attrs, .. } => {
                object.serialize_entry("attrs", attrs)?
            }
            Node::StanzaBreak { attrs } => object.serialize_entry("attrs", attrs)?,
            _ => {}
        }
        if !matches!(
            header,
            Node::Text { .. } | Node::HardBreak | Node::SceneBreak | Node::StanzaBreak { .. }
        ) && (!matches!(header, Node::MediaImage { .. })
            || self.view.children_len(self.node) != 0)
        {
            object.serialize_entry(
                "content",
                &Content {
                    view: self.view,
                    parent: Some(self.node),
                },
            )?;
        }
        object.end()
    }
}
