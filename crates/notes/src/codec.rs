// SPDX-License-Identifier: MIT OR Apache-2.0
use editor_core::document::{Attribute, Attributes, Document, Mark, Node, Primitive};
use editor_core::json::key_path;
use editor_core::transaction::{WorkMeter, WorkPhase};
use editor_registry::{FrozenRegistry, JsonLimits, preflight_json};
use serde_json::{Map, Value};

use crate::{DOCUMENT, NotesError, NotesErrorCode as E, NotesLimits};

fn object(value: Value, path: &str) -> Result<Map<String, Value>, NotesError> {
    match value {
        Value::Object(object) => Ok(object),
        _ => Err(NotesError::new(E::InvalidStructure, path)),
    }
}
fn fields(value: &Map<String, Value>, names: &[&str], path: &str) -> Result<(), NotesError> {
    for key in value.keys() {
        if !names.contains(&key.as_str()) {
            return Err(NotesError::new(E::UnknownField, &key_path(path, key)));
        }
    }
    for name in names {
        if !value.contains_key(*name) {
            return Err(NotesError::new(E::MissingField, &key_path(path, name)));
        }
    }
    Ok(())
}
fn string(value: Value, path: &str) -> Result<String, NotesError> {
    match value {
        Value::String(value) => Ok(value),
        _ => Err(NotesError::new(E::InvalidStructure, path)),
    }
}
fn array(value: Value, path: &str) -> Result<Vec<Value>, NotesError> {
    match value {
        Value::Array(value) => Ok(value),
        _ => Err(NotesError::new(E::InvalidStructure, path)),
    }
}

fn attribute(value: Value, work: &mut WorkMeter) -> Result<Attribute, NotesError> {
    work.charge_units(1)?;
    Ok(match value {
        Value::Null => Attribute::Null,
        Value::Bool(value) => Attribute::Boolean(value),
        Value::Number(value) => Attribute::Number(value),
        Value::String(value) => Attribute::String(value),
        Value::Array(values) => {
            work.charge_bytes((values.len() * std::mem::size_of::<Attribute>()) as u64)?;
            Attribute::List(
                values
                    .into_iter()
                    .map(|value| attribute(value, work))
                    .collect::<Result<_, _>>()?,
            )
        }
        Value::Object(values) => {
            work.charge_bytes((values.len() * 128) as u64)?;
            Attribute::Object(
                values
                    .into_iter()
                    .map(|(key, value)| Ok((key, attribute(value, work)?)))
                    .collect::<Result<_, NotesError>>()?,
            )
        }
    })
}
fn attrs(value: Value, path: &str, work: &mut WorkMeter) -> Result<Attributes, NotesError> {
    let values = object(value, path)?;
    work.charge_bytes((values.len() * 128) as u64)?;
    values
        .into_iter()
        .map(|(key, value)| Ok((key, attribute(value, work)?)))
        .collect()
}

fn node(
    value: Value,
    path: &str,
    depth: u64,
    count: &mut u64,
    registry: &FrozenRegistry,
    limits: NotesLimits,
    work: &mut WorkMeter,
) -> Result<Node, NotesError> {
    work.charge_units(1)?;
    *count += 1;
    if depth > limits.tree_depth || *count > limits.node_count {
        return Err(NotesError::new(E::ResourceLimitExceeded, path));
    }
    let mut raw = object(value, path)?;
    fields(&raw, &["type", "attrs", "marks", "text", "children"], path)?;
    let type_id = string(
        raw.remove("type").expect("checked"),
        &key_path(path, "type"),
    )?;
    if path == "/root" && type_id != DOCUMENT {
        return Err(NotesError::new(E::InvalidStructure, "/root/type"));
    }
    let declaration = registry
        .node(&type_id)
        .ok_or_else(|| NotesError::new(E::UnknownNode, &key_path(path, "type")))?;
    let primitive = declaration.descriptor.primitive.core();
    let attributes = attrs(
        raw.remove("attrs").expect("checked"),
        &key_path(path, "attrs"),
        work,
    )?;
    let raw_marks = array(
        raw.remove("marks").expect("checked"),
        &key_path(path, "marks"),
    )?;
    if primitive != Primitive::Text && !raw_marks.is_empty() {
        return Err(NotesError::new(
            E::InvalidStructure,
            &key_path(path, "marks"),
        ));
    }
    work.charge_bytes((raw_marks.len() * std::mem::size_of::<Mark>()) as u64)?;
    let mut marks = Vec::with_capacity(raw_marks.len());
    for (index, value) in raw_marks.into_iter().enumerate() {
        let mark_path = format!("{path}/marks/{index}");
        let mut raw = object(value, &mark_path)?;
        fields(&raw, &["type", "attrs"], &mark_path)?;
        let type_id = string(
            raw.remove("type").expect("checked"),
            &key_path(&mark_path, "type"),
        )?;
        if registry.mark(&type_id).is_none() {
            return Err(NotesError::new(
                E::UnknownMark,
                &key_path(&mark_path, "type"),
            ));
        }
        let attributes = attrs(
            raw.remove("attrs").expect("checked"),
            &key_path(&mark_path, "attrs"),
            work,
        )?;
        marks.push(Mark {
            type_id,
            attributes,
        });
    }
    let text_value = raw.remove("text").expect("checked");
    let text = if primitive == Primitive::Text {
        let value = string(text_value, &key_path(path, "text"))?;
        if value.len() as u64 > limits.text_leaf_bytes {
            return Err(NotesError::new(
                E::ResourceLimitExceeded,
                &key_path(path, "text"),
            ));
        }
        Some(value)
    } else if text_value.is_null() {
        None
    } else {
        return Err(NotesError::new(
            E::InvalidStructure,
            &key_path(path, "text"),
        ));
    };
    let raw_children = array(
        raw.remove("children").expect("checked"),
        &key_path(path, "children"),
    )?;
    if matches!(
        primitive,
        Primitive::Text | Primitive::HardBreak | Primitive::InlineAtom | Primitive::BlockAtom
    ) && !raw_children.is_empty()
    {
        return Err(NotesError::new(
            E::InvalidStructure,
            &key_path(path, "children"),
        ));
    }
    work.charge_bytes((raw_children.len() * std::mem::size_of::<Node>()) as u64)?;
    let children = raw_children
        .into_iter()
        .enumerate()
        .map(|(index, value)| {
            let child_path = format!("{path}/children/{index}");
            work.charge_bytes(child_path.len() as u64)?;
            node(value, &child_path, depth + 1, count, registry, limits, work)
        })
        .collect::<Result<_, _>>()?;
    Ok(Node {
        type_id,
        primitive,
        attributes,
        marks,
        text,
        children,
    })
}

pub(crate) fn decode(
    input: &[u8],
    registry: &FrozenRegistry,
    limits: NotesLimits,
    work: &mut WorkMeter,
) -> Result<Document, NotesError> {
    let usage = preflight_json(
        input,
        JsonLimits {
            bytes: limits.document_bytes,
            depth: 128,
            values: 1_000_000,
        },
        work,
    )
    .map_err(NotesError::json)?;
    // Ownership of the generic JSON parse is bounded before serde can allocate.
    work.charge_bytes(usage.bytes.saturating_add(usage.values.saturating_mul(128)))?;
    let value = serde_json::from_slice(input).map_err(|_| NotesError::new(E::InvalidJson, ""))?;
    let mut raw = object(value, "")?;
    fields(&raw, &["schema_version", "root"], "")?;
    let version = raw.remove("schema_version").expect("checked");
    match version {
        Value::Number(ref number) if number.is_i64() || number.is_u64() => {
            if number.as_u64() != Some(1) {
                return Err(NotesError::new(E::UnsupportedVersion, "/schema_version"));
            }
        }
        _ => return Err(NotesError::new(E::InvalidStructure, "/schema_version")),
    }
    let root = node(
        raw.remove("root").expect("checked"),
        "/root",
        1,
        &mut 0,
        registry,
        limits,
        work,
    )?;
    Ok(Document {
        children: vec![root],
    })
}

fn equal_text(left: &Node, right: &Node, work: &mut WorkMeter) -> Result<bool, NotesError> {
    if left.primitive != Primitive::Text || right.primitive != Primitive::Text {
        return Ok(false);
    }
    fn borrowed(node: &Node) -> editor_core::candidate::BorrowedNode<'_, usize> {
        editor_core::candidate::BorrowedNode {
            type_id: node.type_id.as_str(),
            primitive: node.primitive,
            attributes: &node.attributes,
            marks: node.marks.as_slice(),
            text: node.text.as_deref(),
            children: &[],
            parent: 0usize,
        }
    }
    crate::borrowed::same_text(borrowed(left), borrowed(right), work)
}

pub(crate) fn import_join(
    document: &mut Document,
    limits: NotesLimits,
    work: &mut WorkMeter,
) -> Result<(), NotesError> {
    fn children(
        nodes: &mut Vec<Node>,
        limits: NotesLimits,
        work: &mut WorkMeter,
    ) -> Result<(), NotesError> {
        work.charge_bytes((nodes.len() * std::mem::size_of::<Node>()) as u64)?;
        let mut output: Vec<Node> = Vec::with_capacity(nodes.len());
        for mut node in std::mem::take(nodes) {
            work.charge_units(1)?;
            work.note_phase(WorkPhase::Normalization, 1, 0);
            children(&mut node.children, limits, work)?;
            if let Some(previous) = output.last_mut()
                && equal_text(previous, &node, work)?
            {
                let right = node.text.as_deref().expect("schema-validated text");
                let left = previous.text.as_mut().expect("schema-validated text");
                if (left.len() as u64).saturating_add(right.len() as u64) > limits.text_leaf_bytes {
                    return Err(NotesError::new(E::ResourceLimitExceeded, ""));
                }
                work.charge_units(right.len() as u64)?;
                work.charge_bytes((left.len() as u64).saturating_add(right.len() as u64))?;
                left.push_str(right);
                continue;
            }
            output.push(node);
        }
        *nodes = output;
        Ok(())
    }
    children(&mut document.children, limits, work)
}
