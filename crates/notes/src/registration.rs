// SPDX-License-Identifier: MIT OR Apache-2.0
//! Trusted initial composition; no existing registry or owner is patched.
use std::collections::BTreeMap;

use editor_registry::{
    AttributeField, AttributeSchema as A, CommandDescriptor, ExtensionDescriptor, Grammar as G,
    NodeDescriptor, PrimitiveDescriptor as P,
};

use crate::{BASE_EXTENSION, DOCUMENT, HARD_BREAK, PARAGRAPH, TEXT, VERSION};

fn required(value: A) -> AttributeField {
    AttributeField {
        required: true,
        value,
    }
}
fn labels(ids: &[String]) -> G {
    G::Repeat {
        item: Box::new(G::Choice {
            items: ids.iter().map(|id| G::Type { id: id.clone() }).collect(),
        }),
        min: 0,
        max: 65_535,
    }
}

/// Build the mandatory compiled base from the explicitly selected block policy.
/// This authoring DTO alone conveys no validity; the shared compiler must admit
/// all references, bounds and ownership before a NotesProfile can exist.
pub fn base_registration(block_types: &[String]) -> ExtensionDescriptor {
    let empty = || BTreeMap::new();
    ExtensionDescriptor {
        id: BASE_EXTENSION.into(),
        version: VERSION.into(),
        dependencies: vec![],
        commands: [
            crate::commands::INSERT_TEXT,
            crate::commands::SET_TITLE,
            crate::commands::SET_TAGS,
        ]
        .into_iter()
        .map(|id| CommandDescriptor::Compiled { id: id.into() })
        .collect(),
        marks: vec![],
        nodes: vec![
            NodeDescriptor {
                id: DOCUMENT.into(),
                primitive: P::Container,
                attrs: BTreeMap::from([
                    ("title".into(), required(A::String { max_bytes: 256 })),
                    (
                        "tags".into(),
                        required(A::List {
                            item: Box::new(A::String { max_bytes: 64 }),
                            max_items: 16,
                        }),
                    ),
                ]),
                children: labels(block_types),
                marks: vec![],
            },
            NodeDescriptor {
                id: PARAGRAPH.into(),
                primitive: P::TextBlock,
                attrs: empty(),
                children: labels(&[TEXT.into(), HARD_BREAK.into()]),
                marks: vec![],
            },
            NodeDescriptor {
                id: TEXT.into(),
                primitive: P::Text,
                attrs: empty(),
                children: G::Empty {},
                marks: vec![],
            },
            NodeDescriptor {
                id: HARD_BREAK.into(),
                primitive: P::HardBreak,
                attrs: empty(),
                children: G::Empty {},
                marks: vec![],
            },
        ],
    }
}
