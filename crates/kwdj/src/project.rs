// SPDX-License-Identifier: MIT OR Apache-2.0
// Derived from owner-controlled KlenWriter CMS source; see provenance/source-files.json.
//! Deterministic plain-text projections from validated/normalized KWDJ.
//!
//! Pure, no I/O. Marks never contribute characters. Spoiler body is
//! included in `full_text` / `search_index_text` and excluded from
//! `public_snippet_text` per `docs/contracts/kwdj_operational_policy_v1.md` §5.
//!
//! # Output bounds (no truncation policy)
//!
//! Operational policy §4: over-limit validation emits **no** projections.
//! Policy §5 defines spoiler inclusion only — it does **not** define snippet
//! truncation, ellipsis, or a maximum projected-string length. This builder
//! therefore never truncates and never inserts `…`.
//!
//! Known inherited exception: stanza_break.blank_lines can expand without a work
//! budget and overflow in project_verse. Tracked by OSR-74; extraction parity
//! preserves this behavior and does not certify bounded hostile projections.
//! The estimate below excludes authored stanza expansion.
//!
//! For a validated document without stanza expansion:
//! ```text
//! |projection| ≤ Σ|text leaves|
//!            + Σ|authored attrs projected| (alt, spoiler/disclosure/warning labels)
//!            + Σ|server literary/warning default labels|
//!            + node_count          // ≤1 separator byte per node join
//! ```
//! with each leaf ≤ `MAX_TEXT_LEAF_BYTES`, each authored attr ≤
//! `MAX_AUTHORED_ATTRIBUTE_BYTES`, and `node_count` ≤ `MAX_NODE_COUNT`.

use super::model::{Document, LiteraryKind, Node, WarningAttrs, WarningKind};

/// Typed plain-text projection trio derived from one normalized document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectionResult {
    pub full_text: String,
    pub search_index_text: String,
    pub public_snippet_text: String,
}

#[derive(Clone, Copy)]
enum Mode {
    /// Include spoiler label and body (full semantic text / search index).
    IncludeSpoilerBody,
    /// Include spoiler label only; recursively exclude spoiler body.
    ExcludeSpoilerBody,
}

/// Project plain-text surfaces from a normalized document.
///
/// The document must already be validated/normalized; this function does not
/// re-validate, touch manifests, or perform I/O.
pub(crate) fn project_document(document: &Document) -> ProjectionResult {
    let full = project_nodes(&document.content, Mode::IncludeSpoilerBody);
    let snippet = project_nodes(&document.content, Mode::ExcludeSpoilerBody);
    ProjectionResult {
        full_text: full.clone(),
        search_index_text: full,
        public_snippet_text: snippet,
    }
}

fn project_nodes(nodes: &[Node], mode: Mode) -> String {
    nodes
        .iter()
        .map(|node| project_node(node, mode))
        .collect::<Vec<_>>()
        .join("\n")
}

fn project_node(node: &Node, mode: Mode) -> String {
    match node {
        Node::Text { text, .. } => text.clone(),
        Node::HardBreak => "\n".to_string(),
        Node::SceneBreak => String::new(),
        Node::Paragraph { content, .. }
        | Node::Heading { content, .. }
        | Node::CodeBlock { content, .. }
        | Node::VerseLine { content, .. } => project_inline(content, mode),
        Node::ListItem { content, .. }
        | Node::TaskItem { content, .. }
        | Node::Blockquote { content }
        | Node::BulletList { content }
        | Node::OrderedList { content, .. }
        | Node::TaskList { content } => project_nodes(content, mode),
        Node::Table { content } => project_table(content, mode),
        Node::TableRow { content } => project_table_row(content, mode),
        Node::TableHeader { content, .. } | Node::TableCell { content, .. } => {
            project_nodes(content, mode)
        }
        Node::MediaImage { attrs, content } => {
            let mut parts = Vec::new();
            if let Some(alt) = attrs.alt.as_ref()
                && !alt.is_empty()
            {
                parts.push(alt.clone());
            }
            let caption = project_nodes(content, mode);
            if !caption.is_empty() {
                parts.push(caption);
            }
            parts.join("\n")
        }
        Node::LiteraryBlock { attrs, content } => {
            join_label_and_body(literary_label(attrs.kind), project_nodes(content, mode))
        }
        Node::Warning { attrs, content } => {
            join_label_and_body(warning_label(attrs), project_nodes(content, mode))
        }
        Node::Spoiler { attrs, content } => match mode {
            Mode::IncludeSpoilerBody => {
                join_label_and_body(&attrs.label, project_nodes(content, mode))
            }
            Mode::ExcludeSpoilerBody => attrs.label.clone(),
        },
        Node::Disclosure { attrs, content } => {
            join_label_and_body(&attrs.label, project_nodes(content, mode))
        }
        Node::Verse { content } => project_verse(content, mode),
        Node::StanzaBreak { .. } => String::new(),
    }
}

fn project_inline(nodes: &[Node], mode: Mode) -> String {
    let mut out = String::new();
    for node in nodes {
        match node {
            Node::Text { text, .. } => out.push_str(text),
            Node::HardBreak => out.push('\n'),
            // Nested blocks inside inline contexts are not schema-legal for most
            // parents, but cells/captions may contain paragraphs — project as text.
            other => out.push_str(&project_node(other, mode)),
        }
    }
    out
}

fn project_table(rows: &[Node], mode: Mode) -> String {
    rows.iter()
        .map(|row| match row {
            Node::TableRow { content } => project_table_row(content, mode),
            other => project_node(other, mode),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn project_table_row(cells: &[Node], mode: Mode) -> String {
    cells
        .iter()
        .map(|cell| match cell {
            Node::TableHeader { content, .. } | Node::TableCell { content, .. } => {
                // Cell content is one or more prose blocks; join block texts without
                // inventing span placeholders (authored cells only, document order).
                project_nodes(content, mode)
            }
            other => project_node(other, mode),
        })
        .collect::<Vec<_>>()
        .join("\t")
}

fn project_verse(nodes: &[Node], mode: Mode) -> String {
    let mut out = String::new();
    let mut pending_blank_lines: Option<u64> = None;
    for node in nodes {
        match node {
            Node::VerseLine { content } => {
                let line = project_inline(content, mode);
                if !out.is_empty() {
                    let blanks = pending_blank_lines.unwrap_or(0);
                    // One separating newline plus `blank_lines` blank lines.
                    for _ in 0..(1 + blanks) {
                        out.push('\n');
                    }
                }
                out.push_str(&line);
                pending_blank_lines = None;
            }
            Node::StanzaBreak { attrs } => {
                pending_blank_lines = Some(attrs.blank_lines);
            }
            other => {
                if !out.is_empty() {
                    out.push('\n');
                }
                out.push_str(&project_node(other, mode));
                pending_blank_lines = None;
            }
        }
    }
    out
}

fn join_label_and_body(label: &str, body: String) -> String {
    if body.is_empty() {
        label.to_string()
    } else if label.is_empty() {
        body
    } else {
        format!("{label}\n{body}")
    }
}

fn literary_label(kind: LiteraryKind) -> &'static str {
    match kind {
        LiteraryKind::AuthorNote => "Заметка автора",
        LiteraryKind::Letter => "Письмо",
        LiteraryKind::Epigraph => "Эпиграф",
        LiteraryKind::WorldNote => "Заметка мира",
        LiteraryKind::ChronicleQuote => "Цитата хроники",
        LiteraryKind::ArchiveFragment => "Архивный фрагмент",
    }
}

fn warning_label(attrs: &WarningAttrs) -> &str {
    if let Some(label) = attrs.label.as_deref() {
        return label;
    }
    match attrs.kind {
        WarningKind::General => "Предупреждение",
        WarningKind::Content => "Контент",
    }
}

#[cfg(test)]
mod exhaustive_coverage {
    use super::*;
    use crate::model::{
        Align, CellAlign, CodeBlockAttrs, ColorAttrs, ColorToken, HeadingAttrs, HighlightAttrs,
        HighlightToken, LabelAttrs, LinkAttrs, LiteraryAttrs, Mark, MediaAlign, MediaAttrs,
        OrderedListAttrs, ParagraphAttrs, ReferenceLinkAttrs, StanzaBreakAttrs, TaskItemAttrs,
        WarningAttrs, WarningKind,
    };
    use uuid::Uuid;

    /// Touch every Node and Mark variant so projection stays exhaustive as grammar grows.
    #[test]
    fn every_node_and_mark_projects_without_panic() {
        let id = Uuid::nil();
        let text = |t: &str, marks: Option<Vec<Mark>>| Node::Text {
            text: t.into(),
            marks,
        };
        let para = |t: &str| Node::Paragraph {
            attrs: Some(ParagraphAttrs {
                align: Some(Align::Left),
                first_line_indent: Some(false),
            }),
            content: vec![text(t, None)],
        };
        let nodes = vec![
            para("p"),
            Node::Heading {
                attrs: HeadingAttrs {
                    level: 1,
                    align: None,
                    first_line_indent: None,
                },
                content: vec![text(
                    "h",
                    Some(vec![
                        Mark::Code,
                        Mark::Strong,
                        Mark::Emphasis,
                        Mark::Strike,
                        Mark::Subscript,
                        Mark::Superscript,
                        Mark::TextColor {
                            attrs: ColorAttrs {
                                token: ColorToken::Accent,
                            },
                        },
                        Mark::Highlight {
                            attrs: HighlightAttrs {
                                token: HighlightToken::Accent,
                            },
                        },
                        Mark::Link {
                            attrs: LinkAttrs {
                                href: "/x".into(),
                                title: Some("t".into()),
                            },
                        },
                        Mark::ReferenceLink {
                            attrs: ReferenceLinkAttrs {
                                reference_entity_id: id,
                            },
                        },
                    ]),
                )],
            },
            Node::HardBreak,
            Node::SceneBreak,
            Node::CodeBlock {
                attrs: Some(CodeBlockAttrs {
                    language: "text".into(),
                }),
                content: vec![text("code", None)],
            },
            Node::Blockquote {
                content: vec![para("q")],
            },
            Node::BulletList {
                content: vec![Node::ListItem {
                    content: vec![para("bi")],
                }],
            },
            Node::OrderedList {
                attrs: Some(OrderedListAttrs { start: 2 }),
                content: vec![Node::ListItem {
                    content: vec![para("oi")],
                }],
            },
            Node::TaskList {
                content: vec![Node::TaskItem {
                    attrs: TaskItemAttrs { checked: true },
                    content: vec![para("ti")],
                }],
            },
            Node::Table {
                content: vec![Node::TableRow {
                    content: vec![
                        Node::TableHeader {
                            attrs: Some(crate::model::TableCellAttrs {
                                colspan: Some(2),
                                rowspan: None,
                                align: Some(CellAlign::Left),
                            }),
                            content: vec![para("th")],
                        },
                        Node::TableCell {
                            attrs: None,
                            content: vec![para("td")],
                        },
                    ],
                }],
            },
            Node::MediaImage {
                attrs: MediaAttrs {
                    media_asset_id: id,
                    alt: Some("alt".into()),
                    decorative: None,
                    align: MediaAlign::None,
                },
                content: vec![para("cap")],
            },
            Node::LiteraryBlock {
                attrs: LiteraryAttrs {
                    kind: LiteraryKind::AuthorNote,
                },
                content: vec![para("lit")],
            },
            Node::Warning {
                attrs: WarningAttrs {
                    kind: WarningKind::General,
                    label: None,
                },
                content: vec![para("w")],
            },
            Node::Spoiler {
                attrs: LabelAttrs { label: "S".into() },
                content: vec![para("secret")],
            },
            Node::Disclosure {
                attrs: LabelAttrs { label: "D".into() },
                content: vec![para("open")],
            },
            Node::Verse {
                content: vec![
                    Node::VerseLine {
                        content: vec![text("v1", None)],
                    },
                    Node::StanzaBreak {
                        attrs: StanzaBreakAttrs { blank_lines: 1 },
                    },
                    Node::VerseLine {
                        content: vec![text("v2", None)],
                    },
                ],
            },
        ];
        let doc = Document {
            schema: "klenwriter.document".into(),
            schema_version: 1,
            profile: crate::Profile::Prose,
            content: nodes,
        };
        let result = project_document(&doc);
        assert!(result.full_text.contains("secret"));
        assert!(!result.public_snippet_text.contains("secret"));
        assert!(result.public_snippet_text.contains('S'));
        assert_eq!(result.full_text, result.search_index_text);
        // Marks must not alter characters.
        assert!(result.full_text.contains('h'));
    }
}
