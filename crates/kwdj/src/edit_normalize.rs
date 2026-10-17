// SPDX-License-Identifier: MIT OR Apache-2.0
//! Metered editing normalization proposes operations; it never writes a tree.
//!
//! One deterministic local batch is returned per pass. Children reach a fixed
//! point before sibling cleanup, so a join never targets an already retired ID.
//! Import normalization and its full canonical checkpoint remain separate.
//! The profile checks original semantic payloads that a proposed batch would
//! automatically discard before applying it (for example reference marks on an
//! empty text or the original counts of merged stanza breaks). The shape guard
//! here deliberately has no identity resolver or duplicated semantic rules.

use std::collections::BTreeSet;
use std::mem::size_of;

use editor_core::candidate::{BorrowedNode, CandidateRead};
use editor_core::document::{Attribute, Mark};
use editor_core::positions::Utf16Offset;
use editor_core::transaction::{Operation, WorkMeter};

use crate::candidate_validate::check_normalizable_header;
use crate::model::Profile;
use crate::normalize::{
    absent_token_mark, canonical_uuid, incompatible_mark_kinds, mark_kind_precedence,
    normalize_newlines,
};
use crate::{KwdjError, KwdjErrorCode, index_path, key_path};

fn units(work: &mut WorkMeter, amount: usize) -> Result<(), KwdjError> {
    work.charge_units(amount as u64)
        .map_err(KwdjError::operational)
}

fn bytes(work: &mut WorkMeter, amount: usize) -> Result<(), KwdjError> {
    work.charge_bytes(amount as u64)
        .map_err(KwdjError::operational)
}

fn kind(type_id: &str) -> &str {
    type_id.strip_prefix("org.klenwriter.kwdj/").unwrap_or("")
}

fn push<I>(
    work: &mut WorkMeter,
    operations: &mut Vec<Operation<I>>,
    operation: Operation<I>,
) -> Result<(), KwdjError> {
    units(work, 1)?;
    // Conservative vector storage/growth accounting, independent of allocator RSS.
    bytes(work, size_of::<Operation<I>>().saturating_mul(2))?;
    operations.push(operation);
    Ok(())
}

fn set_attribute<I: Copy>(
    work: &mut WorkMeter,
    operations: &mut Vec<Operation<I>>,
    node: I,
    key: &str,
    value: Option<Attribute>,
) -> Result<(), KwdjError> {
    bytes(work, key.len())?;
    let key = key.to_owned();
    push(
        work,
        operations,
        Operation::SetAttribute { node, key, value },
    )
}

/// Only metadata values have spelling normalization. Registry IDs remain exact.
fn normalized_string(
    key: &str,
    value: &str,
    work: &mut WorkMeter,
) -> Result<Option<String>, KwdjError> {
    match key {
        "align" | "kind" | "token" => lowercase(value, false, work),
        "media_asset_id" | "reference_entity_id" => {
            bytes(work, value.len())?;
            if let Ok(uuid) = uuid::Uuid::parse_str(value) {
                let mut buffer = [0u8; 36];
                if uuid.hyphenated().encode_lower(&mut buffer) == value {
                    return Ok(None);
                }
                bytes(work, 36)?;
                Ok(Some(canonical_uuid(value)))
            } else {
                lowercase(value, true, work)
            }
        }
        "alt" | "label" | "title" | "language" => {
            bytes(work, value.len())?;
            let count = value
                .as_bytes()
                .windows(2)
                .filter(|pair| *pair == b"\r\n")
                .count();
            if count == 0 {
                return Ok(None);
            }
            let length = value.len() - count;
            bytes(work, value.len().saturating_add(length))?;
            Ok(Some(normalize_newlines(value)))
        }
        _ => Ok(None),
    }
}

fn lowercase(
    value: &str,
    uuid_fallback: bool,
    work: &mut WorkMeter,
) -> Result<Option<String>, KwdjError> {
    bytes(work, value.len())?;
    let mut changed = false;
    let mut length = 0usize;
    for scalar in value.chars() {
        let lowered = scalar.to_lowercase();
        changed |= !lowered.clone().eq(std::iter::once(scalar));
        for lower in lowered {
            length = length.saturating_add(lower.len_utf8());
        }
    }
    if !changed {
        return Ok(None);
    }
    // The second scan and exact output allocation are charged before copying.
    bytes(work, value.len().saturating_add(length))?;
    Ok(Some(if uuid_fallback {
        canonical_uuid(value)
    } else {
        value.to_lowercase()
    }))
}

fn text_newlines<I: Copy>(
    id: I,
    text: &str,
    work: &mut WorkMeter,
) -> Result<Vec<Operation<I>>, KwdjError> {
    bytes(work, text.len())?;
    let count = text
        .as_bytes()
        .windows(2)
        .filter(|pair| *pair == b"\r\n")
        .count();
    if count == 0 {
        return Ok(Vec::new());
    }
    units(work, count)?;
    bytes(work, count.saturating_mul(size_of::<Operation<I>>()))?;
    bytes(work, text.len())?;
    let mut operations = Vec::with_capacity(count);
    let mut offset = 0usize;
    for (byte, scalar) in text.char_indices() {
        if scalar == '\r' && text.as_bytes().get(byte + 1) == Some(&b'\n') {
            operations.push(Operation::ReplaceText {
                leaf: id,
                from: Utf16Offset::new(offset),
                to: Utf16Offset::new(offset + 1),
                inserted: String::new(),
            });
        }
        // UTF-16 units never exceed the admitted UTF-8 byte length.
        offset += scalar.len_utf16();
    }
    // Each exact deletion range refers to the same pre-operation leaf. Applying
    // from right to left preserves all later ranges and unrelated anchors.
    operations.reverse();
    Ok(operations)
}

fn mark_copy_cost(mark: &Mark) -> usize {
    size_of::<Mark>()
        .saturating_add(mark.type_id.len())
        .saturating_add(mark.attributes.iter().fold(0usize, |cost, (key, value)| {
            cost.saturating_add(size_of::<Attribute>())
                .saturating_add(key.len())
                .saturating_add(if let Attribute::String(value) = value {
                    value.len()
                } else {
                    0
                })
        }))
}

fn normalized_marks(
    marks: &[Mark],
    path: &str,
    work: &mut WorkMeter,
) -> Result<Option<Vec<Mark>>, KwdjError> {
    if marks.is_empty() {
        return Ok(None);
    }
    units(work, marks.len())?;
    bytes(
        work,
        marks
            .len()
            .saturating_mul(size_of::<(usize, Vec<(&str, String)>)>()),
    )?;
    let mut retained = Vec::with_capacity(marks.len());
    let mut kinds = Vec::new();
    let mut changed = false;
    let mut previous = None;
    for (index, mark) in marks.iter().enumerate() {
        bytes(work, mark.type_id.len())?;
        let mut changes = Vec::new();
        for (key, value) in &mark.attributes {
            units(work, 1)?;
            bytes(work, key.len())?;
            if let Attribute::String(value) = value
                && let Some(value) = normalized_string(key, value, work)?
            {
                bytes(work, size_of::<(&str, String)>())?;
                changes.push((key.as_str(), value));
            }
        }
        let kind = kind(&mark.type_id);
        let token = changes
            .iter()
            .find(|(key, _)| *key == "token")
            .map(|(_, value)| value.as_str())
            .or_else(|| match mark.attributes.get("token") {
                Some(Attribute::String(value)) => Some(value.as_str()),
                _ => None,
            });
        if absent_token_mark(kind, token) {
            changed = true;
            continue;
        }
        // At most the closed profile's mark kinds are active. Charge their
        // comparisons before duplicate/incompatibility and sorting scans.
        units(work, kinds.len().saturating_add(1))?;
        if kinds.contains(&kind) {
            return Err(KwdjError::categorized(
                KwdjErrorCode::DuplicateMarkType,
                index_path(path, index),
                "mark",
            ));
        }
        bytes(work, size_of::<&str>())?;
        kinds.push(kind);
        let precedence = mark_kind_precedence(kind);
        changed |= !changes.is_empty() || previous.is_some_and(|previous| previous >= precedence);
        previous = Some(precedence);
        retained.push((index, changes));
    }
    units(work, kinds.len().saturating_mul(12))?;
    if incompatible_mark_kinds(&kinds) {
        return Err(KwdjError::categorized(
            KwdjErrorCode::IncompatibleMarks,
            path,
            "mark",
        ));
    }
    if !changed {
        return Ok(None);
    }
    bytes(work, retained.len().saturating_mul(size_of::<Mark>()))?;
    let mut normalized = Vec::with_capacity(retained.len());
    for (index, changes) in retained {
        let mark = &marks[index];
        // The closed normalizable-header guard has excluded nested/unknown
        // metadata before this bounded shallow mark copy.
        bytes(work, mark_copy_cost(mark))?;
        let mut mark = mark.clone();
        for (key, value) in changes {
            *mark
                .attributes
                .get_mut(key)
                .expect("existing authored attribute") = Attribute::String(value);
        }
        normalized.push(mark);
    }
    units(work, normalized.len().saturating_mul(normalized.len()))?;
    normalized.sort_by_key(|mark| mark_kind_precedence(kind(&mark.type_id)));
    Ok(Some(normalized))
}

fn local_fixes<I: Copy>(
    node: BorrowedNode<'_, I>,
    id: I,
    path: &str,
    work: &mut WorkMeter,
) -> Result<Vec<Operation<I>>, KwdjError> {
    let mut operations = Vec::new();
    if let Some(text) = node.text {
        operations = text_newlines(id, text, work)?;
        if !operations.is_empty() {
            return Ok(operations);
        }
    }
    for (key, value) in node.attributes {
        units(work, 1)?;
        bytes(work, key.len())?;
        if let Attribute::String(value) = value
            && let Some(value) = normalized_string(key, value, work)?
        {
            set_attribute(
                work,
                &mut operations,
                id,
                key,
                Some(Attribute::String(value)),
            )?;
            return Ok(operations);
        }
    }
    bytes(work, node.type_id.len())?;
    match kind(node.type_id) {
        "ordered_list" if matches!(node.attributes.get("start"), Some(Attribute::Number(value)) if value.as_u64() == Some(1)) =>
        {
            set_attribute(work, &mut operations, id, "start", None)?;
        }
        "table_cell" | "table_header" => {
            for key in ["rowspan", "colspan"] {
                if matches!(node.attributes.get(key), Some(Attribute::Number(value)) if value.as_u64() == Some(1))
                {
                    set_attribute(work, &mut operations, id, key, None)?;
                }
            }
        }
        _ => {}
    }
    if !operations.is_empty() {
        return Ok(operations);
    }
    bytes(work, path.len().saturating_add(7))?;
    if let Some(marks) = normalized_marks(node.marks, &key_path(path, "marks"), work)? {
        push(
            work,
            &mut operations,
            Operation::SetMarks { leaf: id, marks },
        )?;
    }
    Ok(operations)
}

fn sibling_fixes<V: CandidateRead>(
    candidate: &V,
    parent: V::Id,
    path: &str,
    work: &mut WorkMeter,
) -> Result<Vec<Operation<V::Id>>, KwdjError> {
    let Some(node) = candidate.node(parent) else {
        return Ok(Vec::new());
    };
    bytes(work, node.type_id.len())?;
    let parent_kind = kind(node.type_id);
    let text_sequence = matches!(
        parent_kind,
        "paragraph" | "heading" | "code_block" | "verse_line"
    );
    if !text_sequence && parent_kind != "verse" {
        return Ok(Vec::new());
    }
    units(work, node.children.len())?;
    bytes(work, node.children.len().saturating_mul(size_of::<V::Id>()))?;
    let mut operations = Vec::new();
    let mut previous: Option<(V::Id, BorrowedNode<'_, V::Id>, u64)> = None;
    for id in node.children {
        let child = candidate
            .node(*id)
            .ok_or_else(|| KwdjError::new(KwdjErrorCode::InvalidStructure, path))?;
        bytes(work, child.type_id.len())?;
        if text_sequence && kind(child.type_id) == "text" {
            if child.text == Some("") && (parent_kind != "code_block" || child.marks.is_empty()) {
                push(work, &mut operations, Operation::Remove { node: *id })?;
                continue;
            }
            if let Some((left, before, _)) = previous {
                bytes(work, before.type_id.len())?;
                units(
                    work,
                    before.attributes.len().saturating_add(before.marks.len()),
                )?;
                for mark in before.marks {
                    units(work, mark.attributes.len())?;
                    bytes(work, mark_copy_cost(mark))?;
                }
                if kind(before.type_id) == "text"
                    && before.attributes == child.attributes
                    && before.marks == child.marks
                {
                    push(
                        work,
                        &mut operations,
                        Operation::JoinText { left, right: *id },
                    )?;
                    continue;
                }
            }
            previous = Some((*id, child, 0));
        } else if parent_kind == "verse" && kind(child.type_id) == "stanza_break" {
            let Some(count) = child.attributes.get("blank_lines").and_then(|v| match v {
                Attribute::Number(v) => v.as_u64(),
                _ => None,
            }) else {
                previous = None;
                continue;
            };
            if let Some((left, before, left_count)) = previous
                && kind(before.type_id) == "stanza_break"
            {
                let sum = left_count.checked_add(count).ok_or_else(|| {
                    KwdjError::new(KwdjErrorCode::InvalidVerse, key_path(path, "content"))
                })?;
                set_attribute(
                    work,
                    &mut operations,
                    left,
                    "blank_lines",
                    Some(Attribute::Number(sum.into())),
                )?;
                push(work, &mut operations, Operation::Remove { node: *id })?;
                previous = Some((left, before, sum));
            } else {
                previous = Some((*id, child, count));
            }
        } else {
            previous = None;
        }
    }
    Ok(operations)
}

struct Frame<I> {
    id: I,
    path: String,
    exit: bool,
}

fn schedule<I: Copy>(
    children: &[I],
    path: &str,
    stack: &mut Vec<Frame<I>>,
    work: &mut WorkMeter,
) -> Result<(), KwdjError> {
    units(work, children.len())?;
    bytes(
        work,
        children
            .len()
            .saturating_mul(size_of::<Frame<I>>().saturating_mul(2)),
    )?;
    for (index, id) in children.iter().enumerate().rev() {
        bytes(work, path.len().saturating_add(32))?;
        stack.push(Frame {
            id: *id,
            path: format!("{path}/content/{index}"),
            exit: false,
        });
    }
    Ok(())
}

pub(crate) fn normalize_candidate<V: CandidateRead>(
    _context: Profile,
    candidate: &V,
    work: &mut WorkMeter,
) -> Result<Vec<Operation<V::Id>>, KwdjError> {
    let mut stack = Vec::new();
    schedule(candidate.roots(), "", &mut stack, work)?;
    let mut seen = BTreeSet::new();
    while let Some(frame) = stack.pop() {
        if frame.exit {
            let operations = sibling_fixes(candidate, frame.id, &frame.path, work)?;
            if !operations.is_empty() {
                return Ok(operations);
            }
            continue;
        }
        units(work, 1)?;
        bytes(
            work,
            size_of::<V::Id>().saturating_add(size_of::<usize>() * 4),
        )?;
        if !seen.insert(frame.id) {
            return Err(KwdjError::new(KwdjErrorCode::InvalidStructure, frame.path));
        }
        let node = candidate
            .node(frame.id)
            .ok_or_else(|| KwdjError::new(KwdjErrorCode::InvalidStructure, &frame.path))?;
        // Closed syntax/metadata is proved before any operation can remove it.
        check_normalizable_header(node, &frame.path, work)?;
        let operations = local_fixes(node, frame.id, &frame.path, work)?;
        if !operations.is_empty() {
            return Ok(operations);
        }
        bytes(
            work,
            size_of::<Frame<V::Id>>()
                .saturating_mul(2)
                .saturating_add(frame.path.len()),
        )?;
        let id = frame.id;
        let path = frame.path;
        // Stack order supplies postorder cleanup without shifting an unbounded
        // pending sibling list. The bounded path copy is charged above.
        stack.push(Frame {
            id,
            path: path.clone(),
            exit: true,
        });
        schedule(node.children, &path, &mut stack, work)?;
    }
    Ok(Vec::new())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use editor_core::document::{Attributes, Primitive};
    use editor_core::transaction::WorkLimits;

    use super::*;

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct Node {
        type_id: String,
        primitive: Primitive,
        attributes: Attributes,
        marks: Vec<Mark>,
        text: Option<String>,
        children: Vec<u32>,
        parent: u32,
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct View {
        roots: Vec<u32>,
        nodes: BTreeMap<u32, Node>,
    }

    impl CandidateRead for View {
        type Id = u32;

        fn root(&self) -> u32 {
            0
        }
        fn roots(&self) -> &[u32] {
            &self.roots
        }
        fn node(&self, id: u32) -> Option<BorrowedNode<'_, u32>> {
            self.nodes.get(&id).map(|node| BorrowedNode {
                type_id: &node.type_id,
                primitive: node.primitive,
                attributes: &node.attributes,
                marks: &node.marks,
                text: node.text.as_deref(),
                children: &node.children,
                parent: node.parent,
            })
        }
    }

    fn node(kind: &str, primitive: Primitive, children: &[u32]) -> Node {
        Node {
            type_id: format!("org.klenwriter.kwdj/{kind}"),
            primitive,
            attributes: Attributes::new(),
            marks: Vec::new(),
            text: None,
            children: children.to_vec(),
            parent: 0,
        }
    }

    fn text(value: &str) -> Node {
        Node {
            text: Some(value.into()),
            ..node("text", Primitive::Text, &[])
        }
    }

    fn mark(kind: &str, attributes: &[(&str, Attribute)]) -> Mark {
        Mark {
            type_id: format!("org.klenwriter.kwdj/{kind}"),
            attributes: attributes
                .iter()
                .map(|(key, value)| ((*key).into(), value.clone()))
                .collect(),
        }
    }

    fn view(roots: &[u32], records: Vec<(u32, Node)>) -> View {
        let mut nodes: BTreeMap<_, _> = records.into_iter().collect();
        let edges: Vec<_> = nodes
            .iter()
            .flat_map(|(parent, node)| node.children.iter().map(|child| (*child, *parent)))
            .collect();
        for (child, parent) in edges {
            nodes.get_mut(&child).expect("fixture child").parent = parent;
        }
        View {
            roots: roots.to_vec(),
            nodes,
        }
    }

    fn plan(candidate: &View) -> Result<Vec<Operation<u32>>, KwdjError> {
        normalize_candidate(
            Profile::Prose,
            candidate,
            &mut WorkMeter::new(WorkLimits::default()),
        )
    }

    #[test]
    fn crlf_removes_only_cr_at_literal_utf16_ranges_from_right_to_left() {
        let candidate = view(
            &[1],
            vec![
                (1, node("paragraph", Primitive::TextBlock, &[2])),
                (2, text("Я\r\n😀\r\nx")),
            ],
        );
        let original = candidate.clone();
        assert_eq!(
            plan(&candidate).unwrap(),
            vec![
                Operation::ReplaceText {
                    leaf: 2,
                    from: Utf16Offset::new(5),
                    to: Utf16Offset::new(6),
                    inserted: String::new()
                },
                Operation::ReplaceText {
                    leaf: 2,
                    from: Utf16Offset::new(1),
                    to: Utf16Offset::new(2),
                    inserted: String::new()
                },
            ]
        );
        assert_eq!(candidate, original);
    }

    #[test]
    fn metadata_is_canonicalized_without_case_folding_registry_ids() {
        let mut paragraph = node("paragraph", Primitive::TextBlock, &[]);
        paragraph
            .attributes
            .insert("align".into(), Attribute::String("RIGHT".into()));
        let candidate = view(&[1], vec![(1, paragraph)]);
        assert_eq!(
            plan(&candidate).unwrap(),
            vec![Operation::SetAttribute {
                node: 1,
                key: "align".into(),
                value: Some(Attribute::String("right".into())),
            }]
        );
        for unknown in [
            "Org.klenwriter.kwdj/paragraph",
            "org.klenwriter.kwdj/PARAGRAPH",
        ] {
            let mut candidate = candidate.clone();
            candidate.nodes.get_mut(&1).unwrap().type_id = unknown.into();
            assert_eq!(
                plan(&candidate).unwrap_err().code,
                KwdjErrorCode::UnknownNode
            );
        }
    }

    #[test]
    fn uuid_normalization_uses_the_same_hyphenated_spelling_as_import() {
        let mut image = node("media_image", Primitive::Container, &[]);
        image.attributes.insert(
            "media_asset_id".into(),
            Attribute::String("550E8400E29B41D4A716446655440000".into()),
        );
        image
            .attributes
            .insert("align".into(), Attribute::String("none".into()));
        let candidate = view(&[1], vec![(1, image)]);
        assert_eq!(
            plan(&candidate).unwrap(),
            vec![Operation::SetAttribute {
                node: 1,
                key: "media_asset_id".into(),
                value: Some(Attribute::String(
                    "550e8400-e29b-41d4-a716-446655440000".into()
                )),
            }]
        );
    }

    #[test]
    fn marks_drop_absent_tokens_before_compatibility_and_share_canonical_order() {
        let mut leaf = text("x");
        leaf.marks = vec![
            mark(
                "link",
                &[
                    ("href", Attribute::String("https://example.test".into())),
                    ("title", Attribute::String("a\r\nb".into())),
                ],
            ),
            mark(
                "text_color",
                &[("token", Attribute::String("DEFAULT".into()))],
            ),
            mark("strong", &[]),
        ];
        let candidate = view(
            &[1],
            vec![
                (1, node("paragraph", Primitive::TextBlock, &[2])),
                (2, leaf),
            ],
        );
        assert_eq!(
            plan(&candidate).unwrap(),
            vec![Operation::SetMarks {
                leaf: 2,
                marks: vec![
                    mark("strong", &[]),
                    mark(
                        "link",
                        &[
                            ("href", Attribute::String("https://example.test".into())),
                            ("title", Attribute::String("a\nb".into()))
                        ]
                    ),
                ]
            }]
        );
        let mut candidate = candidate;
        candidate.nodes.get_mut(&2).unwrap().marks = vec![
            mark("code", &[]),
            mark(
                "text_color",
                &[("token", Attribute::String("default".into()))],
            ),
            mark("text_color", &[("token", Attribute::String("NONE".into()))]),
        ];
        assert_eq!(
            plan(&candidate).unwrap(),
            vec![Operation::SetMarks {
                leaf: 2,
                marks: vec![mark("code", &[])]
            }]
        );
        candidate.nodes.get_mut(&2).unwrap().marks = vec![mark("strong", &[]), mark("strong", &[])];
        assert_eq!(
            plan(&candidate).unwrap_err().code,
            KwdjErrorCode::DuplicateMarkType
        );
    }

    #[test]
    fn unknown_data_is_refused_before_empty_text_or_absent_mark_can_hide_it() {
        let mut leaf = text("");
        leaf.attributes
            .insert("authored".into(), Attribute::String("preserve".into()));
        let mut candidate = view(
            &[1],
            vec![
                (1, node("paragraph", Primitive::TextBlock, &[2])),
                (2, leaf),
            ],
        );
        let original = candidate.clone();
        assert_eq!(
            plan(&candidate).unwrap_err().code,
            KwdjErrorCode::UnknownAttribute
        );
        assert_eq!(candidate, original);
        let leaf = candidate.nodes.get_mut(&2).unwrap();
        leaf.attributes.clear();
        leaf.marks = vec![mark(
            "text_color",
            &[
                ("token", Attribute::String("none".into())),
                ("authored", Attribute::Boolean(true)),
            ],
        )];
        assert_eq!(
            plan(&candidate).unwrap_err().code,
            KwdjErrorCode::UnknownAttribute
        );
        candidate.nodes.get_mut(&2).unwrap().marks = vec![mark("STRONG", &[])];
        assert_eq!(
            plan(&candidate).unwrap_err().code,
            KwdjErrorCode::UnknownMark
        );
    }

    #[test]
    fn empty_text_and_compatible_runs_preserve_hard_break_barriers_and_survivor() {
        let candidate = view(
            &[1],
            vec![
                (
                    1,
                    node("paragraph", Primitive::TextBlock, &[2, 3, 4, 5, 6, 7]),
                ),
                (2, text("a")),
                (3, text("")),
                (4, text("b")),
                (5, node("hard_break", Primitive::HardBreak, &[])),
                (6, text("c")),
                (7, text("d")),
            ],
        );
        assert_eq!(
            plan(&candidate).unwrap(),
            vec![
                Operation::Remove { node: 3 },
                Operation::JoinText { left: 2, right: 4 },
                Operation::JoinText { left: 6, right: 7 },
            ]
        );
    }

    #[test]
    fn ordered_and_table_defaults_are_explicit_attribute_removals() {
        let mut ordered = node("ordered_list", Primitive::Container, &[]);
        ordered
            .attributes
            .insert("start".into(), Attribute::Number(1.into()));
        assert_eq!(
            plan(&view(&[1], vec![(1, ordered)])).unwrap(),
            vec![Operation::SetAttribute {
                node: 1,
                key: "start".into(),
                value: None
            }]
        );
        let mut cell = node("table_cell", Primitive::Container, &[]);
        cell.attributes
            .insert("rowspan".into(), Attribute::Number(1.into()));
        cell.attributes
            .insert("colspan".into(), Attribute::Number(1.into()));
        assert_eq!(
            plan(&view(&[1], vec![(1, cell)])).unwrap(),
            vec![
                Operation::SetAttribute {
                    node: 1,
                    key: "rowspan".into(),
                    value: None
                },
                Operation::SetAttribute {
                    node: 1,
                    key: "colspan".into(),
                    value: None
                },
            ]
        );
    }

    fn stanza(count: u64) -> Node {
        let mut stanza = node("stanza_break", Primitive::BlockAtom, &[]);
        stanza
            .attributes
            .insert("blank_lines".into(), Attribute::Number(count.into()));
        stanza
    }

    #[test]
    fn stanza_sums_are_exact_and_overflow_refuses_without_saturation_or_data_loss() {
        let candidate = view(
            &[1],
            vec![
                (1, node("verse", Primitive::Container, &[2, 3, 4])),
                (2, stanza(2)),
                (3, stanza(3)),
                (4, stanza(4)),
            ],
        );
        assert_eq!(
            plan(&candidate).unwrap(),
            vec![
                Operation::SetAttribute {
                    node: 2,
                    key: "blank_lines".into(),
                    value: Some(Attribute::Number(5.into()))
                },
                Operation::Remove { node: 3 },
                Operation::SetAttribute {
                    node: 2,
                    key: "blank_lines".into(),
                    value: Some(Attribute::Number(9.into()))
                },
                Operation::Remove { node: 4 },
            ]
        );
        let mut candidate = candidate;
        candidate
            .nodes
            .get_mut(&2)
            .unwrap()
            .attributes
            .insert("blank_lines".into(), Attribute::Number(u64::MAX.into()));
        let original = candidate.clone();
        let error = plan(&candidate).unwrap_err();
        assert_eq!(error.code, KwdjErrorCode::InvalidVerse);
        assert_eq!(error.path, "/content/0/content");
        assert_eq!(candidate, original);
        candidate
            .nodes
            .get_mut(&3)
            .unwrap()
            .attributes
            .insert("authored".into(), Attribute::Boolean(true));
        assert_eq!(
            plan(&candidate).unwrap_err().code,
            KwdjErrorCode::UnknownAttribute
        );
    }

    #[test]
    fn canonical_unicode_and_marks_are_a_fixed_point_in_both_contexts() {
        let mut leaf = text("Яe\u{301}😀\n");
        leaf.marks = vec![
            mark("strong", &[]),
            mark(
                "highlight",
                &[("token", Attribute::String("accent".into()))],
            ),
        ];
        let candidate = view(
            &[1],
            vec![
                (1, node("paragraph", Primitive::TextBlock, &[2])),
                (2, leaf),
            ],
        );
        for context in [Profile::Prose, Profile::Poetry] {
            assert!(
                normalize_candidate(
                    context,
                    &candidate,
                    &mut WorkMeter::new(WorkLimits::default())
                )
                .unwrap()
                .is_empty()
            );
        }
    }

    #[test]
    fn exhausted_work_refuses_before_candidate_lookup_or_payload_copy() {
        struct Unreachable;
        impl CandidateRead for Unreachable {
            type Id = u32;
            fn root(&self) -> u32 {
                0
            }
            fn roots(&self) -> &[u32] {
                &[1]
            }
            fn node(&self, _: u32) -> Option<BorrowedNode<'_, u32>> {
                panic!("budget must refuse before lookup")
            }
        }
        for limits in [
            WorkLimits {
                units: 0,
                bytes: u64::MAX,
            },
            WorkLimits {
                units: u64::MAX,
                bytes: 0,
            },
        ] {
            let error =
                normalize_candidate(Profile::Prose, &Unreachable, &mut WorkMeter::new(limits))
                    .unwrap_err();
            assert_eq!(error.code, KwdjErrorCode::OperationalBudgetExceeded);
        }
    }
}
