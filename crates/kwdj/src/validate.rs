// SPDX-License-Identifier: MIT OR Apache-2.0
// Derived from owner-controlled KlenWriter CMS source; see provenance/source-files.json.
use std::collections::HashSet;

use url::Url;
use uuid::{Uuid, Variant};

use super::model::{Document, Mark, Node, Profile, TableCellAttrs};
use super::{
    IdentityReference, IdentityResolver, IdentityStatus, KwdjError, KwdjErrorCode, Limits,
    index_path, key_path,
};

pub(crate) struct Manifests {
    pub media: Vec<IdentityReference>,
    pub references: Vec<IdentityReference>,
}

#[derive(Clone, Copy, Default)]
struct Ancestry {
    spoiler: bool,
    warning: bool,
    disclosure: bool,
    table: bool,
}

#[derive(Clone, Copy)]
enum Expected {
    ProseBlock,
    PoetryRoot,
    Inline,
    VerseChild,
    ListItem,
    TaskItem,
    TableRow,
    TableCell,
    Paragraph,
    CodeText,
    Container,
}

struct State<'a> {
    profile: Profile,
    identities: &'a dyn IdentityResolver,
    node_count: u64,
    limits: Limits,
    media: Vec<IdentityReference>,
    references: Vec<IdentityReference>,
    resolved_media: HashSet<Uuid>,
    resolved_references: HashSet<Uuid>,
}

pub(crate) fn validate(
    document: &Document,
    canonical_bytes: u64,
    identities: &dyn IdentityResolver,
    limits: Limits,
) -> Result<Manifests, KwdjError> {
    if document.schema != "klenwriter.document" || document.schema_version != 1 {
        return Err(KwdjError::new(KwdjErrorCode::InvalidEnvelope, ""));
    }
    if document.content.is_empty() {
        return Err(KwdjError::new(KwdjErrorCode::InvalidStructure, "/content"));
    }
    check_limit("", "document_bytes", limits.document_bytes, canonical_bytes)?;

    let mut state = State {
        profile: document.profile,
        identities,
        node_count: 0,
        limits,
        media: Vec::new(),
        references: Vec::new(),
        resolved_media: HashSet::new(),
        resolved_references: HashSet::new(),
    };
    let expected = match document.profile {
        Profile::Prose => Expected::ProseBlock,
        Profile::Poetry => Expected::PoetryRoot,
    };
    for (index, node) in document.content.iter().enumerate() {
        visit(
            node,
            &index_path("/content", index),
            1,
            expected,
            Ancestry::default(),
            &mut state,
        )?;
    }
    state
        .media
        .sort_by(|left, right| left.path.cmp(&right.path).then(left.id.cmp(&right.id)));
    state
        .references
        .sort_by(|left, right| left.path.cmp(&right.path).then(left.id.cmp(&right.id)));
    Ok(Manifests {
        media: state.media,
        references: state.references,
    })
}

fn visit(
    node: &Node,
    path: &str,
    depth: u64,
    expected: Expected,
    ancestry: Ancestry,
    state: &mut State<'_>,
) -> Result<(), KwdjError> {
    if !allowed(node, expected) {
        return Err(KwdjError::categorized(
            KwdjErrorCode::InvalidProfileContent,
            path,
            node.kind(),
        ));
    }
    if state.profile == Profile::Prose && matches!(node, Node::Verse { .. }) {
        return Err(KwdjError::categorized(
            KwdjErrorCode::InvalidProfileContent,
            path,
            "verse",
        ));
    }
    check_limit(path, "tree_depth", state.limits.tree_depth, depth)?;
    state.node_count += 1;
    check_limit(
        path,
        "node_count",
        state.limits.node_count,
        state.node_count,
    )?;

    match node {
        Node::Text { text, marks } => {
            check_limit(
                path,
                "text_length",
                state.limits.text_leaf_bytes,
                text.len() as u64,
            )?;
            if text.is_empty() {
                return Err(KwdjError::new(KwdjErrorCode::NonNormalized, path));
            }
            validate_marks(marks.as_deref(), path, state)?;
        }
        Node::Paragraph { attrs, content } => {
            if let Some(attrs) = attrs {
                if attrs.align.is_none() && attrs.first_line_indent.is_none() {
                    return Err(KwdjError::new(KwdjErrorCode::NonNormalized, path));
                }
                if attrs.first_line_indent == Some(false) {
                    return Err(KwdjError::new(
                        KwdjErrorCode::InvalidStructure,
                        key_path(&key_path(path, "attrs"), "first_line_indent"),
                    ));
                }
            }
            visit_children(content, path, depth, Expected::Inline, ancestry, state)?;
        }
        Node::Heading { attrs, content } => {
            if !(1..=6).contains(&attrs.level) || attrs.first_line_indent == Some(false) {
                return Err(KwdjError::new(
                    KwdjErrorCode::InvalidStructure,
                    key_path(path, "attrs"),
                ));
            }
            visit_children(content, path, depth, Expected::Inline, ancestry, state)?;
        }
        Node::HardBreak | Node::SceneBreak => {}
        Node::CodeBlock { attrs, content } => {
            if let Some(attrs) = attrs {
                check_attribute(
                    &attrs.language,
                    &key_path(&key_path(path, "attrs"), "language"),
                    state.limits.authored_attribute_bytes,
                )?;
                if attrs.language.is_empty()
                    || !attrs
                        .language
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"_+.-".contains(&byte))
                {
                    return Err(KwdjError::new(
                        KwdjErrorCode::InvalidStructure,
                        key_path(path, "attrs"),
                    ));
                }
            }
            if content.len() > 1 {
                return Err(KwdjError::new(
                    KwdjErrorCode::InvalidStructure,
                    key_path(path, "content"),
                ));
            }
            visit_children(content, path, depth, Expected::CodeText, ancestry, state)?;
        }
        Node::Blockquote { content } | Node::ListItem { content } => {
            require_nonempty(content, path)?;
            visit_children(content, path, depth, Expected::ProseBlock, ancestry, state)?;
        }
        Node::TaskItem { content, .. } => {
            require_nonempty(content, path)?;
            visit_children(content, path, depth, Expected::ProseBlock, ancestry, state)?;
        }
        Node::BulletList { content } => {
            require_nonempty(content, path)?;
            visit_children(content, path, depth, Expected::ListItem, ancestry, state)?;
        }
        Node::OrderedList { attrs, content } => {
            if attrs.as_ref().is_some_and(|attrs| attrs.start < 2) {
                return Err(KwdjError::new(
                    KwdjErrorCode::InvalidStructure,
                    key_path(path, "attrs"),
                ));
            }
            require_nonempty(content, path)?;
            visit_children(content, path, depth, Expected::ListItem, ancestry, state)?;
        }
        Node::TaskList { content } => {
            require_nonempty(content, path)?;
            visit_children(content, path, depth, Expected::TaskItem, ancestry, state)?;
        }
        Node::Table { content } => {
            if ancestry.table {
                return Err(KwdjError::new(KwdjErrorCode::NestedTable, path));
            }
            require_nonempty(content, path)?;
            validate_table(content, path, state.limits)?;
            let mut nested = ancestry;
            nested.table = true;
            visit_children(content, path, depth, Expected::TableRow, nested, state)?;
        }
        Node::TableRow { content } => {
            require_nonempty(content, path)?;
            visit_children(content, path, depth, Expected::TableCell, ancestry, state)?;
        }
        Node::TableHeader { attrs, content } | Node::TableCell { attrs, content } => {
            validate_cell_attrs(attrs.as_ref(), path)?;
            require_nonempty(content, path)?;
            visit_children(content, path, depth, Expected::ProseBlock, ancestry, state)?;
        }
        Node::MediaImage { attrs, content } => {
            let media_id_path = key_path(&key_path(path, "attrs"), "media_asset_id");
            validate_uuid(&attrs.media_asset_id, &media_id_path)?;
            match (&attrs.alt, attrs.decorative) {
                (Some(alt), None) if !alt.is_empty() => {
                    check_attribute(
                        alt,
                        &key_path(&key_path(path, "attrs"), "alt"),
                        state.limits.authored_attribute_bytes,
                    )?;
                }
                (None, Some(true)) => {}
                _ => {
                    return Err(KwdjError::new(
                        KwdjErrorCode::InvalidMediaAccessibility,
                        key_path(path, "attrs"),
                    ));
                }
            }
            if !state.resolved_media.contains(&attrs.media_asset_id) {
                match state.identities.resolve_media(&attrs.media_asset_id) {
                    Ok(IdentityStatus::Exists) => {
                        state.resolved_media.insert(attrs.media_asset_id);
                    }
                    Ok(IdentityStatus::Missing) => {
                        return Err(KwdjError::new(
                            KwdjErrorCode::MissingMediaIdentity,
                            media_id_path,
                        ));
                    }
                    Err(_) => {
                        return Err(KwdjError::categorized(
                            KwdjErrorCode::IdentityResolutionFailed,
                            media_id_path,
                            "media",
                        ));
                    }
                }
            }
            state.media.push(IdentityReference {
                id: attrs.media_asset_id,
                path: path.to_string(),
            });
            visit_children(content, path, depth, Expected::Paragraph, ancestry, state)?;
        }
        Node::LiteraryBlock { content, .. } => {
            require_nonempty(content, path)?;
            visit_children(content, path, depth, Expected::Container, ancestry, state)?;
        }
        Node::Warning { attrs, content } => {
            if ancestry.warning {
                return Err(KwdjError::new(KwdjErrorCode::RecursiveWarning, path));
            }
            if let Some(label) = &attrs.label {
                require_string(
                    label,
                    &key_path(&key_path(path, "attrs"), "label"),
                    state.limits.authored_attribute_bytes,
                )?;
            }
            require_nonempty(content, path)?;
            let mut nested = ancestry;
            nested.warning = true;
            visit_children(content, path, depth, Expected::Container, nested, state)?;
        }
        Node::Spoiler { attrs, content } => {
            if ancestry.spoiler {
                return Err(KwdjError::new(KwdjErrorCode::RecursiveSpoiler, path));
            }
            require_string(
                &attrs.label,
                &key_path(&key_path(path, "attrs"), "label"),
                state.limits.authored_attribute_bytes,
            )?;
            require_nonempty(content, path)?;
            let mut nested = ancestry;
            nested.spoiler = true;
            visit_children(content, path, depth, Expected::Container, nested, state)?;
        }
        Node::Disclosure { attrs, content } => {
            if ancestry.disclosure {
                return Err(KwdjError::new(KwdjErrorCode::RecursiveDisclosure, path));
            }
            require_string(
                &attrs.label,
                &key_path(&key_path(path, "attrs"), "label"),
                state.limits.authored_attribute_bytes,
            )?;
            require_nonempty(content, path)?;
            let mut nested = ancestry;
            nested.disclosure = true;
            visit_children(content, path, depth, Expected::Container, nested, state)?;
        }
        Node::Verse { content } => {
            require_nonempty(content, path)?;
            if matches!(content.first(), Some(Node::StanzaBreak { .. }))
                || matches!(content.last(), Some(Node::StanzaBreak { .. }))
                || content.windows(2).any(|pair| {
                    matches!(pair, [Node::StanzaBreak { .. }, Node::StanzaBreak { .. }])
                })
            {
                return Err(KwdjError::new(
                    KwdjErrorCode::InvalidVerse,
                    key_path(path, "content"),
                ));
            }
            visit_children(content, path, depth, Expected::VerseChild, ancestry, state)?;
        }
        Node::VerseLine { attrs, content } => {
            if let Some(attrs) = attrs
                && !(1..=8).contains(&attrs.indent)
            {
                return Err(KwdjError::new(
                    KwdjErrorCode::InvalidStructure,
                    key_path(&key_path(path, "attrs"), "indent"),
                ));
            }
            visit_children(content, path, depth, Expected::Inline, ancestry, state)?;
        }
        Node::StanzaBreak { attrs } => {
            if attrs.blank_lines == 0 {
                return Err(KwdjError::new(KwdjErrorCode::InvalidVerse, path));
            }
        }
    }
    Ok(())
}

fn visit_children(
    content: &[Node],
    path: &str,
    depth: u64,
    expected: Expected,
    ancestry: Ancestry,
    state: &mut State<'_>,
) -> Result<(), KwdjError> {
    let base = key_path(path, "content");
    for (index, node) in content.iter().enumerate() {
        visit(
            node,
            &index_path(&base, index),
            depth + 1,
            expected,
            ancestry,
            state,
        )?;
    }
    Ok(())
}

fn allowed(node: &Node, expected: Expected) -> bool {
    match expected {
        Expected::Inline => matches!(node, Node::Text { .. } | Node::HardBreak),
        Expected::VerseChild => matches!(node, Node::VerseLine { .. } | Node::StanzaBreak { .. }),
        Expected::ListItem => matches!(node, Node::ListItem { .. }),
        Expected::TaskItem => matches!(node, Node::TaskItem { .. }),
        Expected::TableRow => matches!(node, Node::TableRow { .. }),
        Expected::TableCell => matches!(node, Node::TableHeader { .. } | Node::TableCell { .. }),
        Expected::Paragraph => matches!(node, Node::Paragraph { .. }),
        Expected::CodeText => matches!(node, Node::Text { marks: None, .. }),
        Expected::PoetryRoot => is_prose_block(node) || matches!(node, Node::Verse { .. }),
        Expected::Container => is_prose_block(node) || matches!(node, Node::Verse { .. }),
        Expected::ProseBlock => is_prose_block(node),
    }
}

fn is_prose_block(node: &Node) -> bool {
    matches!(
        node,
        Node::Paragraph { .. }
            | Node::Heading { .. }
            | Node::Blockquote { .. }
            | Node::BulletList { .. }
            | Node::OrderedList { .. }
            | Node::TaskList { .. }
            | Node::CodeBlock { .. }
            | Node::SceneBreak
            | Node::Table { .. }
            | Node::MediaImage { .. }
            | Node::LiteraryBlock { .. }
            | Node::Warning { .. }
            | Node::Spoiler { .. }
            | Node::Disclosure { .. }
    )
}

fn validate_marks(
    marks: Option<&[Mark]>,
    path: &str,
    state: &mut State<'_>,
) -> Result<(), KwdjError> {
    let Some(marks) = marks else {
        return Ok(());
    };
    if marks.is_empty() {
        return Err(KwdjError::new(
            KwdjErrorCode::NonNormalizedEmptyMarks,
            key_path(path, "marks"),
        ));
    }
    let marks_path = key_path(path, "marks");
    let mut kinds = HashSet::new();
    let mut previous = None;
    for (index, mark) in marks.iter().enumerate() {
        if !kinds.insert(mark.kind()) {
            return Err(KwdjError::new(
                KwdjErrorCode::DuplicateMarkType,
                index_path(&marks_path, index),
            ));
        }
        if previous.is_some_and(|value| value >= mark.precedence()) {
            return Err(KwdjError::new(
                KwdjErrorCode::NonNormalized,
                marks_path.clone(),
            ));
        }
        previous = Some(mark.precedence());
        let mark_path = index_path(&marks_path, index);
        let attrs_path = key_path(&mark_path, "attrs");
        match mark {
            Mark::Link { attrs } => {
                let href_path = key_path(&attrs_path, "href");
                validate_url(&attrs.href, &href_path)?;
                check_attribute(
                    &attrs.href,
                    &href_path,
                    state.limits.authored_attribute_bytes,
                )?;
                if let Some(title) = &attrs.title {
                    require_string(
                        title,
                        &key_path(&attrs_path, "title"),
                        state.limits.authored_attribute_bytes,
                    )?;
                }
            }
            Mark::ReferenceLink { attrs } => {
                let reference_id_path = key_path(&attrs_path, "reference_entity_id");
                validate_uuid(&attrs.reference_entity_id, &reference_id_path)?;
                if !state
                    .resolved_references
                    .contains(&attrs.reference_entity_id)
                {
                    match state
                        .identities
                        .resolve_reference(&attrs.reference_entity_id)
                    {
                        Ok(IdentityStatus::Exists) => {
                            state.resolved_references.insert(attrs.reference_entity_id);
                        }
                        Ok(IdentityStatus::Missing) => {
                            return Err(KwdjError::new(
                                KwdjErrorCode::MissingReferenceIdentity,
                                reference_id_path,
                            ));
                        }
                        Err(_) => {
                            return Err(KwdjError::categorized(
                                KwdjErrorCode::IdentityResolutionFailed,
                                reference_id_path,
                                "reference",
                            ));
                        }
                    }
                }
                state.references.push(IdentityReference {
                    id: attrs.reference_entity_id,
                    path: mark_path,
                });
            }
            _ => {}
        }
    }
    if (kinds.contains("subscript") && kinds.contains("superscript"))
        || (kinds.contains("link") && kinds.contains("reference_link"))
        || (kinds.contains("code")
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
        return Err(KwdjError::new(KwdjErrorCode::IncompatibleMarks, marks_path));
    }
    Ok(())
}

fn validate_cell_attrs(attrs: Option<&TableCellAttrs>, path: &str) -> Result<(), KwdjError> {
    if let Some(attrs) = attrs {
        if attrs.colspan.is_none() && attrs.rowspan.is_none() && attrs.align.is_none() {
            return Err(KwdjError::new(
                KwdjErrorCode::NonNormalized,
                key_path(path, "attrs"),
            ));
        }
        if attrs.colspan.is_some_and(|value| value < 2)
            || attrs.rowspan.is_some_and(|value| value < 2)
        {
            return Err(KwdjError::new(
                KwdjErrorCode::InvalidStructure,
                key_path(path, "attrs"),
            ));
        }
    }
    Ok(())
}

fn validate_table(rows: &[Node], path: &str, limits: Limits) -> Result<(), KwdjError> {
    let row_count = u64::try_from(rows.len())
        .map_err(|_| KwdjError::limit(path, "table_rows", limits.table_rows, u64::MAX))?;
    check_limit(path, "table_rows", limits.table_rows, row_count)?;
    let mut occupancy: Vec<u64> = Vec::new();
    let mut width = None;
    for (row_index, row) in rows.iter().enumerate() {
        let row_path = index_path(&key_path(path, "content"), row_index);
        while occupancy.last() == Some(&0) {
            occupancy.pop();
        }
        let Node::TableRow { content } = row else {
            return Err(KwdjError::new(
                KwdjErrorCode::InvalidStructure,
                key_path(path, "content"),
            ));
        };
        let mut column = 0usize;
        for (cell_index, cell) in content.iter().enumerate() {
            let cell_path = index_path(&key_path(&row_path, "content"), cell_index);
            while occupancy.get(column).copied().unwrap_or(0) > 0 {
                column += 1;
            }
            let attrs = match cell {
                Node::TableHeader { attrs, .. } | Node::TableCell { attrs, .. } => attrs.as_ref(),
                _ => {
                    return Err(KwdjError::new(
                        KwdjErrorCode::InvalidStructure,
                        key_path(&row_path, "content"),
                    ));
                }
            };
            let colspan = attrs.and_then(|value| value.colspan).unwrap_or(1);
            let rowspan = attrs.and_then(|value| value.rowspan).unwrap_or(1);
            if colspan == 0 {
                return Err(KwdjError::new(
                    KwdjErrorCode::InvalidStructure,
                    key_path(&key_path(&cell_path, "attrs"), "colspan"),
                ));
            }
            if rowspan == 0 {
                return Err(KwdjError::new(
                    KwdjErrorCode::InvalidStructure,
                    key_path(&key_path(&cell_path, "attrs"), "rowspan"),
                ));
            }

            let column_value = u64::try_from(column).map_err(|_| {
                KwdjError::limit(
                    &cell_path,
                    "table_effective_columns",
                    limits.table_effective_columns,
                    u64::MAX,
                )
            })?;
            let effective_end = column_value.saturating_add(colspan);
            check_limit(
                &key_path(&key_path(&cell_path, "attrs"), "colspan"),
                "table_effective_columns",
                limits.table_effective_columns,
                effective_end,
            )?;
            let end = usize::try_from(effective_end).map_err(|_| {
                KwdjError::limit(
                    &cell_path,
                    "table_effective_columns",
                    limits.table_effective_columns,
                    effective_end,
                )
            })?;

            let remaining_rows = u64::try_from(rows.len() - row_index)
                .map_err(|_| KwdjError::new(KwdjErrorCode::TableNotRectangular, &cell_path))?;
            if rowspan > remaining_rows {
                return Err(KwdjError::new(
                    KwdjErrorCode::TableNotRectangular,
                    key_path(&key_path(&cell_path, "attrs"), "rowspan"),
                ));
            }

            if occupancy.len() < end {
                occupancy.resize(end, 0);
            }
            if occupancy[column..end].iter().any(|value| *value > 0) {
                return Err(KwdjError::new(KwdjErrorCode::TableNotRectangular, path));
            }
            occupancy[column..end].fill(rowspan);
            column = end;
        }
        let row_width = occupancy.len();
        if occupancy.contains(&0) {
            return Err(KwdjError::new(KwdjErrorCode::TableNotRectangular, path));
        }
        if let Some(expected) = width {
            if expected != row_width {
                return Err(KwdjError::new(KwdjErrorCode::TableNotRectangular, path));
            }
        } else {
            width = Some(row_width);
        }
        for value in &mut occupancy {
            *value = value.saturating_sub(1);
        }
    }
    if occupancy.iter().any(|value| *value > 0) {
        return Err(KwdjError::new(KwdjErrorCode::TableNotRectangular, path));
    }
    Ok(())
}

fn validate_uuid(id: &Uuid, path: &str) -> Result<(), KwdjError> {
    if id.get_variant() != Variant::RFC4122 || !(1..=8).contains(&id.get_version_num()) {
        return Err(KwdjError::new(KwdjErrorCode::InvalidUuid, path));
    }
    Ok(())
}

fn validate_url(value: &str, path: &str) -> Result<(), KwdjError> {
    if value.chars().any(char::is_control) || value.contains('\\') {
        return Err(KwdjError::new(KwdjErrorCode::UnsafeUrl, path));
    }
    if value.starts_with('/') {
        if value.starts_with("//")
            || has_dot_segment(value.split(['?', '#']).next().unwrap_or(value))
        {
            return Err(KwdjError::new(KwdjErrorCode::UnsafeUrl, path));
        }
        return Ok(());
    }
    let parsed = Url::parse(value).map_err(|_| KwdjError::new(KwdjErrorCode::UnsafeUrl, path))?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err(KwdjError::new(KwdjErrorCode::UnsafeUrl, path));
    }
    let raw_path = absolute_raw_path(value);
    if has_dot_segment(raw_path) {
        return Err(KwdjError::new(KwdjErrorCode::UnsafeUrl, path));
    }
    Ok(())
}

fn absolute_raw_path(value: &str) -> &str {
    let Some((_, authority_and_suffix)) = value.split_once("://") else {
        return "/";
    };
    let Some(path_start) = authority_and_suffix.find(['/', '?', '#']) else {
        return "/";
    };
    if authority_and_suffix.as_bytes()[path_start] != b'/' {
        return "/";
    }
    let path_and_suffix = &authority_and_suffix[path_start..];
    let path_end = path_and_suffix
        .find(['?', '#'])
        .unwrap_or(path_and_suffix.len());
    &path_and_suffix[..path_end]
}

fn has_dot_segment(path: &str) -> bool {
    path.split('/').any(|segment| {
        let decoded = percent_decode(segment);
        decoded == "." || decoded == ".."
    })
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && let (Some(high), Some(low)) = (hex(bytes[index + 1]), hex(bytes[index + 2]))
        {
            output.push(high * 16 + low);
            index += 3;
            continue;
        }
        output.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&output).into_owned()
}

fn hex(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn require_nonempty(content: &[Node], path: &str) -> Result<(), KwdjError> {
    if content.is_empty() {
        Err(KwdjError::new(
            KwdjErrorCode::InvalidStructure,
            key_path(path, "content"),
        ))
    } else {
        Ok(())
    }
}

fn require_string(value: &str, path: &str, maximum: u64) -> Result<(), KwdjError> {
    if value.is_empty() {
        return Err(KwdjError::new(KwdjErrorCode::InvalidStructure, path));
    }
    check_attribute(value, path, maximum)
}

fn check_attribute(value: &str, path: &str, maximum: u64) -> Result<(), KwdjError> {
    check_limit(path, "attribute_length", maximum, value.len() as u64)
}

fn check_limit(
    path: &str,
    name: &'static str,
    maximum: u64,
    observed: u64,
) -> Result<(), KwdjError> {
    editor_core::limits::check(name, maximum, observed)
        .map_err(|limit| KwdjError::limit(path, limit.name, limit.maximum, limit.observed))
}
