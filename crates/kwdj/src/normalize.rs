// SPDX-License-Identifier: MIT OR Apache-2.0
// Derived from owner-controlled KlenWriter CMS source; see provenance/source-files.json.
use serde_json::{Map, Value};

use super::{KwdjError, KwdjErrorCode, NormalizationEvent, index_path, key_path};

pub(crate) fn normalize_value(
    value: &mut Value,
    path: &str,
    events: &mut Vec<NormalizationEvent>,
) -> Result<(), KwdjError> {
    match value {
        Value::Object(object) => normalize_object(object, path, events),
        Value::Array(values) => {
            for (index, value) in values.iter_mut().enumerate() {
                normalize_value(value, &index_path(path, index), events)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

pub(crate) fn ensure_normalized(value: &Value, path: &str) -> Result<(), KwdjError> {
    scan_canonical_defaults(value, path)?;
    let mut normalized = value.clone();
    let mut ignored = Vec::new();
    normalize_value(&mut normalized, path, &mut ignored)?;
    if &normalized != value {
        return Err(KwdjError::new(KwdjErrorCode::NonNormalized, path));
    }
    Ok(())
}

fn normalize_object(
    object: &mut Map<String, Value>,
    path: &str,
    events: &mut Vec<NormalizationEvent>,
) -> Result<(), KwdjError> {
    lowercase_string(object, "profile");
    lowercase_string(object, "type");

    if let Some(Value::String(text)) = object.get_mut("text") {
        *text = text.replace("\r\n", "\n");
    }

    if let Some(Value::Object(attrs)) = object.get_mut("attrs") {
        for key in ["align", "kind", "token"] {
            lowercase_string(attrs, key);
        }
        for key in ["media_asset_id", "reference_entity_id"] {
            canonicalize_uuid_string(attrs, key);
        }
        for key in ["alt", "label", "title", "language"] {
            if let Some(Value::String(value)) = attrs.get_mut(key) {
                *value = value.replace("\r\n", "\n");
            }
        }
    }

    if let Some(Value::Array(marks)) = object.get_mut("marks") {
        for (index, mark) in marks.iter_mut().enumerate() {
            normalize_value(mark, &index_path(&key_path(path, "marks"), index), events)?;
        }
        marks.retain(|mark| !is_absent_token_mark(mark));
        validate_and_sort_marks(marks, &key_path(path, "marks"))?;
    }
    if object
        .get("marks")
        .and_then(Value::as_array)
        .is_some_and(Vec::is_empty)
    {
        object.remove("marks");
        push_event(events, NormalizationEvent::EmptyMarksRemoved);
    }

    let node_type = object
        .get("type")
        .and_then(Value::as_str)
        .map(str::to_owned);
    if let Some(Value::Array(content)) = object.get_mut("content") {
        for (index, node) in content.iter_mut().enumerate() {
            normalize_value(node, &index_path(&key_path(path, "content"), index), events)?;
        }
        content.retain(|node| !is_empty_text(node));
        merge_adjacent_text(content);
        if node_type.as_deref() == Some("verse") {
            merge_stanza_breaks(content);
        }
    }

    if let Some(Value::Object(attrs)) = object.get_mut("attrs") {
        match node_type.as_deref() {
            Some("ordered_list") if attrs.get("start").and_then(Value::as_u64) == Some(1) => {
                attrs.remove("start");
                push_event(events, NormalizationEvent::OrderedStartDefaultRemoved);
            }
            Some("table_cell" | "table_header") => {
                let mut removed = false;
                for key in ["rowspan", "colspan"] {
                    if attrs.get(key).and_then(Value::as_u64) == Some(1) {
                        attrs.remove(key);
                        removed = true;
                    }
                }
                if removed {
                    push_event(events, NormalizationEvent::UnitSpanRemoved);
                }
            }
            _ => {}
        }
    }

    let optional_attrs = matches!(
        node_type.as_deref(),
        Some("paragraph" | "code_block" | "ordered_list" | "table_cell" | "table_header")
    );
    if optional_attrs
        && object
            .get("attrs")
            .and_then(Value::as_object)
            .is_some_and(Map::is_empty)
    {
        object.remove("attrs");
    }
    if node_type.as_deref() == Some("media_image")
        && object
            .get("content")
            .and_then(Value::as_array)
            .is_some_and(Vec::is_empty)
    {
        object.remove("content");
    }

    Ok(())
}

fn lowercase_string(object: &mut Map<String, Value>, key: &str) {
    if let Some(Value::String(value)) = object.get_mut(key) {
        *value = value.to_lowercase();
    }
}

fn canonicalize_uuid_string(object: &mut Map<String, Value>, key: &str) {
    if let Some(Value::String(value)) = object.get_mut(key) {
        *value = uuid::Uuid::parse_str(value)
            .map(|uuid| uuid.to_string())
            .unwrap_or_else(|_| value.to_lowercase());
    }
}

fn is_empty_text(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.get("type").and_then(Value::as_str) == Some("text")
        && object.get("text").and_then(Value::as_str) == Some("")
}

fn is_absent_token_mark(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    if !matches!(
        object.get("type").and_then(Value::as_str),
        Some("text_color" | "highlight")
    ) {
        return false;
    }
    matches!(
        object
            .get("attrs")
            .and_then(Value::as_object)
            .and_then(|attrs| attrs.get("token"))
            .and_then(Value::as_str),
        Some("default" | "none")
    )
}

fn validate_and_sort_marks(marks: &mut [Value], path: &str) -> Result<(), KwdjError> {
    let mut kinds = Vec::with_capacity(marks.len());
    for (index, mark) in marks.iter().enumerate() {
        let Some(kind) = mark
            .as_object()
            .and_then(|object| object.get("type"))
            .and_then(Value::as_str)
        else {
            continue;
        };
        if kinds.contains(&kind) {
            return Err(KwdjError::categorized(
                KwdjErrorCode::DuplicateMarkType,
                index_path(path, index),
                "mark",
            ));
        }
        kinds.push(kind);
    }
    if (kinds.contains(&"subscript") && kinds.contains(&"superscript"))
        || (kinds.contains(&"link") && kinds.contains(&"reference_link"))
        || (kinds.contains(&"code")
            && kinds.iter().any(|kind| {
                matches!(
                    *kind,
                    "strong"
                        | "emphasis"
                        | "strike"
                        | "subscript"
                        | "superscript"
                        | "text_color"
                        | "highlight"
                )
            }))
    {
        return Err(KwdjError::categorized(
            KwdjErrorCode::IncompatibleMarks,
            path,
            "mark",
        ));
    }
    marks.sort_by_key(mark_precedence);
    Ok(())
}

fn mark_precedence(mark: &Value) -> u8 {
    match mark
        .as_object()
        .and_then(|object| object.get("type"))
        .and_then(Value::as_str)
    {
        Some("code") => 0,
        Some("strong") => 1,
        Some("emphasis") => 2,
        Some("strike") => 3,
        Some("subscript") => 4,
        Some("superscript") => 5,
        Some("text_color") => 6,
        Some("highlight") => 7,
        Some("link") => 8,
        Some("reference_link") => 9,
        _ => u8::MAX,
    }
}

fn merge_adjacent_text(content: &mut Vec<Value>) {
    let mut merged: Vec<Value> = Vec::with_capacity(content.len());
    for node in content.drain(..) {
        if let Some(previous) = merged.last_mut() {
            let compatible = previous.get("type").and_then(Value::as_str) == Some("text")
                && node.get("type").and_then(Value::as_str) == Some("text")
                && previous.get("marks") == node.get("marks");
            if compatible
                && let (Some(left), Some(right)) = (
                    previous
                        .get("text")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                    node.get("text").and_then(Value::as_str),
                )
            {
                previous["text"] = Value::String(left + right);
                continue;
            }
        }
        merged.push(node);
    }
    *content = merged;
}

fn merge_stanza_breaks(content: &mut Vec<Value>) {
    let mut merged: Vec<Value> = Vec::with_capacity(content.len());
    for node in content.drain(..) {
        let current = stanza_count(&node);
        if let (Some(previous), Some(current)) = (merged.last_mut(), current)
            && let Some(previous_count) = stanza_count(previous)
            && let Some(sum) = previous_count.checked_add(current)
        {
            previous["attrs"]["blank_lines"] = Value::from(sum);
            continue;
        }
        merged.push(node);
    }
    *content = merged;
}

fn stanza_count(value: &Value) -> Option<u64> {
    if value.get("type").and_then(Value::as_str) != Some("stanza_break") {
        return None;
    }
    value.get("attrs")?.get("blank_lines")?.as_u64()
}

fn push_event(events: &mut Vec<NormalizationEvent>, event: NormalizationEvent) {
    if !events.contains(&event) {
        events.push(event);
    }
}

fn scan_canonical_defaults(value: &Value, path: &str) -> Result<(), KwdjError> {
    match value {
        Value::Array(values) => {
            for (index, value) in values.iter().enumerate() {
                scan_canonical_defaults(value, &index_path(path, index))?;
            }
        }
        Value::Object(object) => {
            if object
                .get("marks")
                .and_then(Value::as_array)
                .is_some_and(Vec::is_empty)
            {
                return Err(KwdjError::new(
                    KwdjErrorCode::NonNormalizedEmptyMarks,
                    key_path(path, "marks"),
                ));
            }
            let kind = object.get("type").and_then(Value::as_str);
            if kind == Some("ordered_list")
                && object
                    .get("attrs")
                    .and_then(Value::as_object)
                    .and_then(|attrs| attrs.get("start"))
                    .and_then(Value::as_u64)
                    == Some(1)
            {
                return Err(KwdjError::new(
                    KwdjErrorCode::NonNormalizedOrderedStartDefault,
                    key_path(&key_path(path, "attrs"), "start"),
                ));
            }
            if matches!(kind, Some("table_cell" | "table_header"))
                && let Some(attrs) = object.get("attrs").and_then(Value::as_object)
            {
                for key in ["rowspan", "colspan"] {
                    if attrs.get(key).and_then(Value::as_u64) == Some(1) {
                        return Err(KwdjError::new(
                            KwdjErrorCode::NonNormalizedUnitSpan,
                            key_path(&key_path(path, "attrs"), key),
                        ));
                    }
                }
            }
            for (key, value) in object {
                scan_canonical_defaults(value, &key_path(path, key))?;
            }
        }
        _ => {}
    }
    Ok(())
}
