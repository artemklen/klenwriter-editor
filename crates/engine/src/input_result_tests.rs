// SPDX-License-Identifier: MIT OR Apache-2.0
use super::point;
use crate::identity::SessionKey;
use crate::tree::AddressTree;
use editor_core::document::{Attributes, Document, Node, Primitive};
use editor_core::positions::{Edge, Position};
use editor_core::transaction::{WorkLimits, WorkMeter};

fn block(content: Vec<Node>) -> Node {
    Node {
        type_id: "org.example/paragraph".into(),
        primitive: Primitive::TextBlock,
        attributes: Attributes::new(),
        marks: vec![],
        text: None,
        children: content,
    }
}

#[test]
fn input_correspondence_rejects_non_text_atoms_root_and_foreign_break_edges() {
    let atom = |primitive| Node {
        type_id: format!("org.example/{primitive:?}"),
        primitive,
        attributes: Attributes::new(),
        marks: vec![],
        text: None,
        children: vec![],
    };
    let base = AddressTree::from_document(
        SessionKey::allocate().unwrap(),
        Document {
            children: vec![
                block(vec![atom(Primitive::InlineAtom)]),
                atom(Primitive::BlockAtom),
                block(vec![atom(Primitive::HardBreak)]),
            ],
        },
    )
    .unwrap();
    let root = base.root();
    let [paragraph, block_atom, other_block] = base.node(root).unwrap().children() else {
        panic!("fixture blocks")
    };
    let inline_atom = base.node(*paragraph).unwrap().children()[0];
    let other_break = base.node(*other_block).unwrap().children()[0];
    let draft = base.prepare();
    for id in [root, *block_atom, inline_atom, other_break] {
        for side in [Edge::Before, Edge::After] {
            assert!(
                point(
                    &draft,
                    Position::Edge { node: id, side },
                    *paragraph,
                    &mut WorkMeter::new(WorkLimits::default())
                )
                .is_err()
            );
        }
    }
}
