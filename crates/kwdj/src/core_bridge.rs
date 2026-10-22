//! Full snapshot import/export between a profile codec and the generic document.
//! Used at admission/snapshot boundaries, not as a per-keystroke transaction path.

use editor_core::admission::preflight_snapshot;
use editor_core::document::{Attribute, Attributes, Document, Mark, Node, TreeNode};
use serde::Serialize;

use crate::{AdmissionBudget, Limits, NormalizedDocument, model};

impl NormalizedDocument {
    pub fn to_core_document(&self) -> Document {
        Document {
            children: self.model().content.iter().map(convert_node).collect(),
        }
    }
}

pub(crate) fn convert_node(node: &model::Node) -> Node {
    use model::Node as N;
    let attributes = match node {
        N::Paragraph { attrs, .. } => attrs.as_ref().map(attributes).unwrap_or_default(),
        N::Heading { attrs, .. } => attributes(attrs),
        N::CodeBlock { attrs, .. } => attrs.as_ref().map(attributes).unwrap_or_default(),
        N::TaskItem { attrs, .. } => attributes(attrs),
        N::OrderedList { attrs, .. } => attrs.as_ref().map(attributes).unwrap_or_default(),
        N::TableCell { attrs, .. } | N::TableHeader { attrs, .. } => {
            attrs.as_ref().map(attributes).unwrap_or_default()
        }
        N::MediaImage { attrs, .. } => attributes(attrs),
        N::LiteraryBlock { attrs, .. } => attributes(attrs),
        N::Warning { attrs, .. } => attributes(attrs),
        N::Spoiler { attrs, .. } | N::Disclosure { attrs, .. } => attributes(attrs),
        N::StanzaBreak { attrs } => attributes(attrs),
        _ => Attributes::new(),
    };
    let marks = match node {
        N::Text { marks, .. } => marks
            .as_deref()
            .unwrap_or_default()
            .iter()
            .map(|mark| {
                let value = serde_json::to_value(mark).expect("closed profile mark serializes");
                Mark {
                    type_id: qualified(mark.kind()),
                    attributes: value
                        .get("attrs")
                        .map(convert_attributes)
                        .unwrap_or_default(),
                }
            })
            .collect(),
        _ => Vec::new(),
    };
    Node {
        type_id: qualified(node.kind()),
        primitive: node.primitive(),
        attributes,
        marks,
        text: node.text().map(str::to_owned),
        children: node.children().iter().map(convert_node).collect(),
    }
}

fn qualified(name: &str) -> String {
    format!("{}/{name}", crate::PROFILE_ID)
}

fn attributes(value: &impl Serialize) -> Attributes {
    convert_attributes(&serde_json::to_value(value).expect("closed profile attrs serialize"))
}

fn convert_attributes(value: &serde_json::Value) -> Attributes {
    value
        .as_object()
        .expect("profile attrs are objects")
        .iter()
        .map(|(key, value)| {
            (
                key.clone(),
                match value {
                    serde_json::Value::Bool(value) => Attribute::Boolean(*value),
                    serde_json::Value::Number(value) => Attribute::Number(value.clone()),
                    serde_json::Value::String(value) => Attribute::String(value.clone()),
                    _ => unreachable!("validated v1 attributes are non-null scalars"),
                },
            )
        })
        .collect()
}

/// Admit a full generic snapshot through the exact same closed v1 codec. This
/// cannot bypass validators or silently drop generic data/primitive mismatches.
pub fn admit_core_document(
    document: &Document,
    profile: model::Profile,
    identities: &dyn crate::IdentityResolver,
    limits: Limits,
) -> Result<crate::ValidatedDocument, crate::KwdjError> {
    admit_core_document_with_budget(
        document,
        profile,
        identities,
        limits,
        AdmissionBudget::default(),
    )
}

pub fn admit_core_document_with_budget(
    document: &Document,
    profile: model::Profile,
    identities: &dyn crate::IdentityResolver,
    limits: Limits,
    budget: AdmissionBudget,
) -> Result<crate::ValidatedDocument, crate::KwdjError> {
    use crate::{KwdjError, KwdjErrorCode};
    let limits = limits.effective();
    // No full UTF-8 scalar / UTF-16 metric scan, frontier allocation or snapshot
    // clone before this bounded borrowed pass. Only node/depth metrics are needed.
    let metrics = preflight_snapshot(document, budget.preflight).map_err(KwdjError::operational)?;
    for (name, maximum, observed) in [
        ("tree_depth", limits.tree_depth, metrics.tree_depth),
        ("node_count", limits.node_count, metrics.nodes),
    ] {
        editor_core::limits::check(name, maximum, observed)
            .map_err(|e| KwdjError::limit("", e.name, e.maximum, e.observed))?;
    }
    let content = document
        .children
        .iter()
        .enumerate()
        .map(|(i, n)| encode_node(n, &format!("/content/{i}")))
        .collect::<Result<Vec<_>, _>>()?;
    let value = serde_json::json!({"schema":"klenwriter.document","schema_version":1,"profile":profile,"content":content});
    // This is a borrowed-snapshot route, not a raw-byte input. Avoid a redundant
    // generated JSON serialization/parse roundtrip; use the same closed codec.
    let admitted = crate::validate_normalized_value(value, identities, limits, budget)?;
    if admitted.document().to_core_document() != *document {
        return Err(KwdjError::new(KwdjErrorCode::InvalidStructure, ""));
    }
    Ok(admitted)
}

pub(crate) fn local_name<'a>(
    value: &'a str,
    path: &str,
    code: crate::KwdjErrorCode,
) -> Result<&'a str, crate::KwdjError> {
    value
        .strip_prefix("org.klenwriter.kwdj/")
        .ok_or_else(|| crate::KwdjError::new(code, path))
}

pub(crate) fn encode_attributes(
    attrs: &Attributes,
    path: &str,
) -> Result<serde_json::Value, crate::KwdjError> {
    let mut object = serde_json::Map::new();
    for (key, value) in attrs {
        let value = match value {
            Attribute::Boolean(value) => serde_json::Value::Bool(*value),
            Attribute::Number(value) => serde_json::Value::Number(value.clone()),
            Attribute::String(value) => serde_json::Value::String(value.clone()),
            _ => {
                return Err(crate::KwdjError::new(
                    crate::KwdjErrorCode::InvalidStructure,
                    crate::key_path(path, key),
                ));
            }
        };
        object.insert(key.clone(), value);
    }
    Ok(serde_json::Value::Object(object))
}

pub(crate) fn encode_node(node: &Node, path: &str) -> Result<serde_json::Value, crate::KwdjError> {
    use crate::KwdjErrorCode;
    let kind = local_name(
        &node.type_id,
        &crate::key_path(path, "type"),
        KwdjErrorCode::UnknownNode,
    )?;
    let mut value = serde_json::json!({"type":kind});
    if let Some(text) = &node.text {
        value["text"] = text.clone().into();
    }
    if !node.attributes.is_empty() {
        value["attrs"] = encode_attributes(&node.attributes, &crate::key_path(path, "attrs"))?;
    }
    if !node.marks.is_empty() {
        let mut marks = Vec::new();
        for (i, mark) in node.marks.iter().enumerate() {
            let p = crate::index_path(&crate::key_path(path, "marks"), i);
            let mut value = serde_json::json!({"type":local_name(&mark.type_id,&crate::key_path(&p,"type"),KwdjErrorCode::UnknownMark)?});
            if !mark.attributes.is_empty() {
                value["attrs"] =
                    encode_attributes(&mark.attributes, &crate::key_path(&p, "attrs"))?;
            }
            marks.push(value);
        }
        value["marks"] = marks.into();
    }
    if !node.children.is_empty()
        || !matches!(
            kind,
            "text" | "hard_break" | "scene_break" | "stanza_break" | "media_image"
        )
    {
        value["content"] = node
            .children
            .iter()
            .enumerate()
            .map(|(i, n)| encode_node(n, &crate::index_path(&crate::key_path(path, "content"), i)))
            .collect::<Result<Vec<_>, _>>()?
            .into();
    }
    Ok(value)
}
