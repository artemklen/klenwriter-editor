// SPDX-License-Identifier: MIT OR Apache-2.0
//! Pure borrowed lexical windows. Budgets include lookup and repeated copying
//! visits; no full-leaf validation, index construction or semantic command runs.
use crate::{
    NodeId,
    tree::{AddressTree, TreeError, TreeNode},
};
use editor_core::{
    document::Primitive,
    positions::{Position, PositionError, Selection},
};

pub const TEXT_WINDOW_UNITS: usize = 256;
const SOURCE_SCALARS: usize = 32768;
const NODE_VISITS: usize = 1024;
const PATH_NODES: usize = 128;
const REPLY_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TextWindowError {
    SelectionRequired,
    UnsupportedContext,
    WindowLimit,
    SourceScanLimit,
    NodeLimit,
    DepthLimit,
    ReplyLimit,
    Tree(TreeError),
}
impl From<TreeError> for TextWindowError {
    fn from(value: TreeError) -> Self {
        Self::Tree(value)
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextWindowBoundary {
    Block,
    InlineAtom,
    HardBreak,
    WindowLimit,
}
#[derive(Debug)]
pub struct TextWindowSpan<'a> {
    pub node: NodeId,
    pub from_utf16: usize,
    pub to_utf16: usize,
    pub text: &'a str,
}
#[derive(Debug)]
pub struct TextWindow<'a> {
    pub selection: Selection<NodeId>,
    pub block: &'a TreeNode,
    pub ancestors: Vec<&'a TreeNode>,
    pub before: Vec<TextWindowSpan<'a>>,
    pub after: Vec<TextWindowSpan<'a>>,
    pub before_stop: TextWindowBoundary,
    pub after_stop: TextWindowBoundary,
}
struct Budget {
    scalars: usize,
    nodes: usize,
    reply: usize,
}
impl Budget {
    fn new() -> Self {
        Self {
            scalars: 0,
            nodes: 0,
            reply: 8192,
        }
    }
    fn nodes(&mut self, count: usize) -> Result<(), TextWindowError> {
        self.nodes += count;
        if self.nodes > NODE_VISITS {
            Err(TextWindowError::NodeLimit)
        } else {
            Ok(())
        }
    }
    fn scalar(&mut self) -> Result<(), TextWindowError> {
        self.scalars += 1;
        if self.scalars > SOURCE_SCALARS {
            Err(TextWindowError::SourceScanLimit)
        } else {
            Ok(())
        }
    }
    fn bytes(&mut self, bytes: usize) -> Result<(), TextWindowError> {
        self.reply = bytes
            .checked_mul(6)
            .and_then(|n| n.checked_add(256))
            .and_then(|n| n.checked_add(self.reply))
            .ok_or(TextWindowError::ReplyLimit)?;
        if self.reply > REPLY_BYTES {
            Err(TextWindowError::ReplyLimit)
        } else {
            Ok(())
        }
    }
    fn node<'a>(
        &mut self,
        tree: &'a AddressTree,
        id: NodeId,
    ) -> Result<&'a TreeNode, TextWindowError> {
        self.nodes(1)?;
        Ok(tree.node(id)?)
    }
}
fn invalid() -> TextWindowError {
    TreeError::InvalidStructure.into()
}
fn position_error(value: PositionError) -> TextWindowError {
    TreeError::Position(value).into()
}

/// Uses the cached UTF-16 length and walks only the nearer end. Rust str's
/// double-ended chars iterator decodes one bounded UTF-8 scalar per next call.
fn byte_at(
    text: &str,
    length: usize,
    offset: usize,
    work: &mut Budget,
) -> Result<usize, TextWindowError> {
    if offset > length {
        return Err(position_error(PositionError::OutOfBounds));
    }
    if offset == 0 {
        return Ok(0);
    }
    if offset == length {
        return Ok(text.len());
    }
    let reverse = length - offset < offset;
    let mut units = if reverse { length } else { 0 };
    let mut bytes = if reverse { text.len() } else { 0 };
    while units != offset {
        work.scalar()?;
        let c = if reverse {
            text[..bytes].chars().next_back()
        } else {
            text[bytes..].chars().next()
        }
        .ok_or_else(invalid)?;
        if reverse {
            units -= c.len_utf16();
            bytes -= c.len_utf8();
        } else {
            units += c.len_utf16();
            bytes += c.len_utf8();
        }
        if (reverse && units < offset) || (!reverse && units > offset) {
            return Err(position_error(PositionError::NotScalarBoundary));
        }
    }
    Ok(bytes)
}

impl AddressTree {
    pub(crate) fn text_window(
        &self,
        selection: Option<Selection<NodeId>>,
        before: usize,
        after: usize,
    ) -> Result<TextWindow<'_>, TextWindowError> {
        if before
            .checked_add(after)
            .is_none_or(|n| n > TEXT_WINDOW_UNITS)
        {
            return Err(TextWindowError::WindowLimit);
        }
        let selection = selection.ok_or(TextWindowError::SelectionRequired)?;
        let mut work = Budget::new();
        let (block, leaf) = match (selection.anchor, selection.focus) {
            (
                Position::Text {
                    leaf: a, utf16: x, ..
                },
                Position::Text {
                    leaf: b, utf16: y, ..
                },
            ) if a == b && x == y => {
                let node = work.node(self, a)?;
                if node.primitive() != Some(Primitive::Text) {
                    return Err(TextWindowError::UnsupportedContext);
                }
                let block = work.node(self, node.parent().ok_or_else(invalid)?)?;
                if block.primitive() != Some(Primitive::TextBlock) {
                    return Err(TextWindowError::UnsupportedContext);
                }
                (block, Some((node, x.get())))
            }
            (
                Position::Child {
                    parent: a,
                    index: x,
                    ..
                },
                Position::Child {
                    parent: b,
                    index: y,
                    ..
                },
            ) if a == b && x == y => {
                let block = work.node(self, a)?;
                if x != 0
                    || !block.children().is_empty()
                    || block.primitive() != Some(Primitive::TextBlock)
                {
                    return Err(TextWindowError::UnsupportedContext);
                }
                (block, None)
            }
            _ => return Err(TextWindowError::UnsupportedContext),
        };
        work.bytes(block.type_id().ok_or_else(invalid)?.len())?;
        // Count the root-inclusive path, including the Text leaf when present.
        let mut depth = if leaf.is_some() { 2 } else { 1 };
        let mut ancestors = Vec::new();
        let mut cursor = block;
        loop {
            depth += 1;
            if depth > PATH_NODES {
                return Err(TextWindowError::DepthLimit);
            }
            work.nodes(2)?;
            let (parent, _) = self.checked_ordinal(cursor.id())?;
            let parent = work.node(self, parent)?;
            if parent.id() == self.root() {
                break;
            }
            if parent.primitive() != Some(Primitive::Container) {
                return Err(invalid());
            }
            work.bytes(parent.type_id().ok_or_else(invalid)?.len())?;
            ancestors.push(parent);
            cursor = parent;
        }
        if let Some((node, offset)) = leaf {
            work.nodes(2)?;
            let (parent, index) = self.checked_ordinal(node.id())?;
            if parent != block.id() {
                return Err(invalid());
            }
            let length = self.cached_text_utf16(node.id())?;
            let byte = byte_at(node.text().ok_or_else(invalid)?, length, offset, &mut work)?;
            let (before, before_stop) =
                self.window_side(block, node, index, offset, byte, before, true, &mut work)?;
            let (after, after_stop) =
                self.window_side(block, node, index, offset, byte, after, false, &mut work)?;
            Ok(TextWindow {
                selection,
                block,
                ancestors,
                before,
                after,
                before_stop,
                after_stop,
            })
        } else {
            Ok(TextWindow {
                selection,
                block,
                ancestors,
                before: Vec::new(),
                after: Vec::new(),
                before_stop: TextWindowBoundary::Block,
                after_stop: TextWindowBoundary::Block,
            })
        }
    }
    #[allow(clippy::too_many_arguments)]
    fn window_side<'a>(
        &'a self,
        block: &'a TreeNode,
        mut node: &'a TreeNode,
        mut index: usize,
        mut offset: usize,
        mut byte: usize,
        mut remaining: usize,
        reverse: bool,
        work: &mut Budget,
    ) -> Result<(Vec<TextWindowSpan<'a>>, TextWindowBoundary), TextWindowError> {
        let mut spans = Vec::new();
        loop {
            let text = node.text().ok_or_else(invalid)?;
            let start_units = offset;
            let start_byte = byte;
            while if reverse { byte > 0 } else { byte < text.len() } {
                if remaining == 0 {
                    break;
                }
                work.scalar()?;
                let c = if reverse {
                    text[..byte].chars().next_back()
                } else {
                    text[byte..].chars().next()
                }
                .ok_or_else(invalid)?;
                if c.len_utf16() > remaining {
                    break;
                }
                remaining -= c.len_utf16();
                if reverse {
                    byte -= c.len_utf8();
                    offset -= c.len_utf16();
                } else {
                    byte += c.len_utf8();
                    offset += c.len_utf16();
                }
            }
            if byte != start_byte {
                let (from_utf16, to_utf16, bytes) = if reverse {
                    (offset, start_units, byte..start_byte)
                } else {
                    (start_units, offset, start_byte..byte)
                };
                let text = &text[bytes];
                work.bytes(text.len())?;
                spans.push(TextWindowSpan {
                    node: node.id(),
                    from_utf16,
                    to_utf16,
                    text,
                });
            }
            if if reverse {
                byte != 0
            } else {
                byte != text.len()
            } {
                if reverse {
                    spans.reverse();
                }
                return Ok((spans, TextWindowBoundary::WindowLimit));
            }
            let next = if reverse {
                index.checked_sub(1)
            } else {
                index.checked_add(1).filter(|n| *n < block.children().len())
            };
            let Some(next) = next else {
                if reverse {
                    spans.reverse();
                }
                return Ok((spans, TextWindowBoundary::Block));
            };
            node = work.node(self, block.children()[next])?;
            if node.parent() != Some(block.id()) {
                return Err(invalid());
            }
            let boundary = match node.primitive() {
                Some(Primitive::Text) => None,
                Some(Primitive::HardBreak) => Some(TextWindowBoundary::HardBreak),
                Some(Primitive::InlineAtom) => Some(TextWindowBoundary::InlineAtom),
                _ => return Err(invalid()),
            };
            if let Some(boundary) = boundary {
                if reverse {
                    spans.reverse();
                }
                return Ok((spans, boundary));
            }
            index = next;
            byte = if reverse {
                node.text().ok_or_else(invalid)?.len()
            } else {
                0
            };
            offset = if reverse {
                self.cached_text_utf16(node.id())?
            } else {
                0
            };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SessionKey;
    use editor_core::{
        document::{Attributes, Document, Node},
        positions::{Affinity, Utf16Offset},
    };
    fn node(primitive: Primitive, text: Option<&str>, children: Vec<Node>) -> Node {
        Node {
            type_id: format!("org.example/{primitive:?}"),
            primitive,
            attributes: Attributes::new(),
            marks: vec![],
            text: text.map(str::to_owned),
            children,
        }
    }
    fn text(value: &str) -> Node {
        node(Primitive::Text, Some(value), vec![])
    }
    fn tree(children: Vec<Node>) -> AddressTree {
        AddressTree::from_document(
            SessionKey::allocate().unwrap(),
            Document {
                children: vec![node(Primitive::TextBlock, None, children)],
            },
        )
        .unwrap()
    }
    fn ids(t: &AddressTree) -> (NodeId, &[NodeId]) {
        let block = t.node(t.root()).unwrap().children()[0];
        (block, t.node(block).unwrap().children())
    }
    fn selection(id: NodeId, offset: usize) -> Option<Selection<NodeId>> {
        let p = Position::Text {
            leaf: id,
            utf16: Utf16Offset::new(offset),
            affinity: Affinity::After,
        };
        Some(Selection {
            anchor: p,
            focus: p,
        })
    }
    #[test]
    fn scalar_window_and_rounding_preserve_original_tree_and_offsets() {
        let t = tree(vec![text("a😀b")]);
        let leaf = ids(&t).1[0];
        let before = t.document();
        let w = t.text_window(selection(leaf, 3), 3, 1).unwrap();
        assert_eq!(
            (
                w.before[0].text,
                w.before[0].from_utf16,
                w.before[0].to_utf16
            ),
            ("a😀", 0, 3)
        );
        assert_eq!(w.after[0].text, "b");
        assert_eq!(
            (w.before_stop, w.after_stop),
            (TextWindowBoundary::Block, TextWindowBoundary::Block)
        );
        let rounded = t.text_window(selection(leaf, 3), 1, 0).unwrap();
        assert!(rounded.before.is_empty());
        assert_eq!(rounded.before_stop, TextWindowBoundary::WindowLimit);
        assert_eq!(
            t.text_window(selection(leaf, 2), 1, 0).unwrap_err(),
            position_error(PositionError::NotScalarBoundary)
        );
        assert_eq!(t.document(), before);
    }
    #[test]
    fn marked_leaf_topology_joins_but_hard_break_and_atom_are_barriers() {
        for barrier in [
            None,
            Some(Primitive::HardBreak),
            Some(Primitive::InlineAtom),
        ] {
            let mut a = text("/he");
            a.marks.push(editor_core::document::Mark {
                type_id: "org.example/strong".into(),
                attributes: Attributes::new(),
            });
            let mut children = vec![a];
            if let Some(p) = barrier {
                children.push(node(p, None, vec![]));
            }
            children.push(text("ad"));
            let t = tree(children);
            let leaves = ids(&t).1;
            let w = t
                .text_window(selection(*leaves.last().unwrap(), 2), 256, 0)
                .unwrap();
            let actual: String = w.before.iter().map(|s| s.text).collect();
            assert_eq!(actual, if barrier.is_none() { "/head" } else { "ad" });
            assert_eq!(
                w.before_stop,
                match barrier {
                    None => TextWindowBoundary::Block,
                    Some(Primitive::HardBreak) => TextWindowBoundary::HardBreak,
                    _ => TextWindowBoundary::InlineAtom,
                }
            );
        }
    }
    #[test]
    fn lookup_and_output_share_exact_scalar_budget_and_long_tail_uses_cached_end() {
        let t = tree(vec![text(&"a".repeat(65538))]);
        let leaf = ids(&t).1[0];
        assert!(t.text_window(selection(leaf, 32768), 0, 0).is_ok());
        assert_eq!(
            t.text_window(selection(leaf, 32769), 0, 0).unwrap_err(),
            TextWindowError::SourceScanLimit
        );
        assert_eq!(
            t.text_window(selection(leaf, 32768), 1, 0).unwrap_err(),
            TextWindowError::SourceScanLimit
        );
        let tail = t.text_window(selection(leaf, 65538), 256, 0).unwrap();
        assert_eq!(
            (tail.before[0].from_utf16, tail.before[0].to_utf16),
            (65282, 65538)
        );
        assert_eq!(tail.before[0].text, "a".repeat(256));
    }
    #[test]
    fn empty_child_is_real_and_other_ranges_and_request_overflow_refuse() {
        let t = tree(vec![]);
        let p = Position::Child {
            parent: ids(&t).0,
            index: 0,
            affinity: Affinity::Before,
        };
        let w = t
            .text_window(
                Some(Selection {
                    anchor: p,
                    focus: p,
                }),
                256,
                0,
            )
            .unwrap();
        assert!(w.before.is_empty() && w.after.is_empty());
        assert_eq!(w.selection.focus, p);
        assert_eq!(
            t.text_window(None, 1, 0).unwrap_err(),
            TextWindowError::SelectionRequired
        );
        let root = Position::Child {
            parent: t.root(),
            index: 0,
            affinity: Affinity::After,
        };
        assert_eq!(
            t.text_window(
                Some(Selection {
                    anchor: root,
                    focus: root
                }),
                1,
                0
            )
            .unwrap_err(),
            TextWindowError::UnsupportedContext
        );
        assert_eq!(
            t.text_window(None, 128, 129).unwrap_err(),
            TextWindowError::WindowLimit
        );
    }
    #[test]
    fn empty_siblings_consume_node_budget_without_unbounded_scan() {
        // Seven loaded path/edge records plus 1017 preceding empty leaves.
        let t = tree((0..1018).map(|_| text("")).collect());
        let leaf = *ids(&t).1.last().unwrap();
        assert_eq!(
            t.text_window(selection(leaf, 0), 256, 0)
                .unwrap()
                .before_stop,
            TextWindowBoundary::Block
        );
        let over = tree((0..1019).map(|_| text("")).collect());
        let leaf = *ids(&over).1.last().unwrap();
        assert_eq!(
            over.text_window(selection(leaf, 0), 256, 0).unwrap_err(),
            TextWindowError::NodeLimit
        );
    }
    #[test]
    fn root_inclusive_depth_is_checked_on_admitted_topology() {
        for (containers, accepted) in [(125, true), (126, false)] {
            let mut n = node(Primitive::TextBlock, None, vec![text("/")]);
            for _ in 0..containers {
                n = node(Primitive::Container, None, vec![n]);
            }
            let t = AddressTree::from_document(
                SessionKey::allocate().unwrap(),
                Document { children: vec![n] },
            )
            .unwrap();
            let mut leaf = t.root();
            while let Some(child) = t.node(leaf).unwrap().children().first() {
                leaf = *child;
            }
            let result = t.text_window(selection(leaf, 1), 1, 0);
            if accepted {
                assert!(result.is_ok());
            } else {
                assert_eq!(result.unwrap_err(), TextWindowError::DepthLimit);
            }
        }
    }
    #[test]
    fn oversized_header_refuses_before_copy() {
        let mut n = node(Primitive::TextBlock, None, vec![text("/")]);
        n.type_id = "t".repeat(50000);
        let t = AddressTree::from_document(
            SessionKey::allocate().unwrap(),
            Document { children: vec![n] },
        )
        .unwrap();
        let leaf = ids(&t).1[0];
        assert_eq!(
            t.text_window(selection(leaf, 1), 1, 0).unwrap_err(),
            TextWindowError::ReplyLimit
        );
    }
}
