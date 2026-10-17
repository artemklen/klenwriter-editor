// SPDX-License-Identifier: MIT OR Apache-2.0
// Derived from owner-controlled KlenWriter CMS source; see provenance/source-files.json.
//! Deterministic, bounded plain-text projections from admitted KWDJ.
//!
//! Marks contribute no characters. Spoilers contribute their body to full/search
//! text and their label alone to public snippets. Authored text is never truncated.
//! A valid stored document may exceed an operational projection budget: callers
//! receive a typed refusal and keep the original canonical document unchanged.

use super::model::{Document, LiteraryKind, Node, WarningAttrs, WarningKind};

/// Operational ceilings, independent of the seven normative stored-v1 maxima.
/// Hosts can tighten each ceiling; larger values are clamped to these defaults.
/// Output bytes bound each intermediate/final string. Work bytes count every
/// byte copied/appended, including nested joins and the separate search copy.
/// Node visits also bound work on empty strings. No wall-clock timing is used.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProjectionBudget {
    pub output_bytes: u64,
    pub work_bytes: u64,
    pub node_visits: u64,
}

impl Default for ProjectionBudget {
    fn default() -> Self {
        Self {
            output_bytes: 4 * 1024 * 1024,
            work_bytes: 128 * 1024 * 1024,
            node_visits: 200_000,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectionBudgetKind {
    OutputBytes,
    WorkBytes,
    NodeVisits,
}

/// Refusal contains no authored content and never returns partial projections.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ProjectionError {
    #[error("projection budget exceeded: {budget:?} (limit {limit})")]
    BudgetExceeded {
        budget: ProjectionBudgetKind,
        limit: u64,
    },
    #[error("projection length arithmetic overflow")]
    ArithmeticOverflow,
    #[error("projection allocation unavailable")]
    AllocationUnavailable,
}

impl ProjectionError {
    pub fn code(self) -> &'static str {
        match self {
            Self::BudgetExceeded {
                budget: ProjectionBudgetKind::OutputBytes,
                ..
            } => "kwdj.projection_output_budget_exceeded",
            Self::BudgetExceeded {
                budget: ProjectionBudgetKind::WorkBytes,
                ..
            } => "kwdj.projection_work_budget_exceeded",
            Self::BudgetExceeded {
                budget: ProjectionBudgetKind::NodeVisits,
                ..
            } => "kwdj.projection_node_budget_exceeded",
            Self::ArithmeticOverflow => "kwdj.projection_arithmetic_overflow",
            Self::AllocationUnavailable => "kwdj.projection_allocation_unavailable",
        }
    }
}

/// Typed plain-text projection trio derived from one normalized document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectionResult {
    pub full_text: String,
    pub search_index_text: String,
    pub public_snippet_text: String,
}

#[derive(Clone, Copy)]
enum Mode {
    IncludeSpoilerBody,
    ExcludeSpoilerBody,
}

type Projected = Result<String, ProjectionError>;

struct Work {
    budget: ProjectionBudget,
    copied: u64,
    visited: u64,
}

impl Work {
    fn new(requested: ProjectionBudget) -> Self {
        let ceiling = ProjectionBudget::default();
        Self {
            budget: ProjectionBudget {
                output_bytes: requested.output_bytes.min(ceiling.output_bytes),
                work_bytes: requested.work_bytes.min(ceiling.work_bytes),
                node_visits: requested.node_visits.min(ceiling.node_visits),
            },
            copied: 0,
            visited: 0,
        }
    }

    fn visit(&mut self) -> Result<(), ProjectionError> {
        self.visited = self
            .visited
            .checked_add(1)
            .ok_or(ProjectionError::ArithmeticOverflow)?;
        Self::check(
            self.visited,
            self.budget.node_visits,
            ProjectionBudgetKind::NodeVisits,
        )
    }

    fn check(
        observed: u64,
        limit: u64,
        budget: ProjectionBudgetKind,
    ) -> Result<(), ProjectionError> {
        if observed > limit {
            Err(ProjectionError::BudgetExceeded { budget, limit })
        } else {
            Ok(())
        }
    }

    /// Check before reserve, usize conversion, or expansion. The cumulative
    /// counter includes intermediate copies, bounding even deeply nested joins.
    fn reserve(&mut self, out: &mut String, count: u64) -> Result<usize, ProjectionError> {
        let length = (out.len() as u64)
            .checked_add(count)
            .ok_or(ProjectionError::ArithmeticOverflow)?;
        Self::check(
            length,
            self.budget.output_bytes,
            ProjectionBudgetKind::OutputBytes,
        )?;
        self.copied = self
            .copied
            .checked_add(count)
            .ok_or(ProjectionError::ArithmeticOverflow)?;
        Self::check(
            self.copied,
            self.budget.work_bytes,
            ProjectionBudgetKind::WorkBytes,
        )?;
        let count = usize::try_from(count).map_err(|_| ProjectionError::ArithmeticOverflow)?;
        // Amortized reserve avoids reallocating once per text leaf. The allocator
        // may round capacity up; requested string lengths obey the exact ceiling.
        out.try_reserve(count)
            .map_err(|_| ProjectionError::AllocationUnavailable)?;
        Ok(count)
    }

    fn append(&mut self, out: &mut String, text: &str) -> Result<(), ProjectionError> {
        self.reserve(out, text.len() as u64)?;
        out.push_str(text);
        Ok(())
    }

    fn newlines(&mut self, out: &mut String, count: u64) -> Result<(), ProjectionError> {
        let count = self.reserve(out, count)?;
        for _ in 0..count {
            out.push('\n');
        }
        Ok(())
    }

    fn text(&mut self, text: &str) -> Projected {
        let mut out = String::new();
        self.append(&mut out, text)?;
        Ok(out)
    }
}

pub(crate) fn project_document(
    document: &Document,
    budget: ProjectionBudget,
) -> Result<ProjectionResult, ProjectionError> {
    let mut work = Work::new(budget);
    let full_text = project_nodes(&document.content, Mode::IncludeSpoilerBody, &mut work)?;
    let public_snippet_text =
        project_nodes(&document.content, Mode::ExcludeSpoilerBody, &mut work)?;
    let search_index_text = work.text(&full_text)?;
    Ok(ProjectionResult {
        full_text,
        search_index_text,
        public_snippet_text,
    })
}

fn project_nodes(nodes: &[Node], mode: Mode, work: &mut Work) -> Projected {
    let mut out = String::new();
    for (index, node) in nodes.iter().enumerate() {
        if index != 0 {
            work.append(&mut out, "\n")?;
        }
        let part = project_node(node, mode, work)?;
        work.append(&mut out, &part)?;
    }
    Ok(out)
}

fn project_node(node: &Node, mode: Mode, work: &mut Work) -> Projected {
    work.visit()?;
    match node {
        Node::Text { text, .. } => work.text(text),
        Node::HardBreak => work.text("\n"),
        Node::SceneBreak | Node::StanzaBreak { .. } => Ok(String::new()),
        Node::Paragraph { content, .. }
        | Node::Heading { content, .. }
        | Node::CodeBlock { content, .. }
        | Node::VerseLine { content, .. } => project_inline(content, mode, work),
        Node::ListItem { content, .. }
        | Node::TaskItem { content, .. }
        | Node::Blockquote { content }
        | Node::BulletList { content }
        | Node::OrderedList { content, .. }
        | Node::TaskList { content }
        | Node::TableHeader { content, .. }
        | Node::TableCell { content, .. }
        | Node::Table { content } => project_nodes(content, mode, work),
        Node::TableRow { content } => project_table_row(content, mode, work),
        Node::MediaImage { attrs, content } => {
            let mut out = String::new();
            if let Some(alt) = attrs.alt.as_ref().filter(|s| !s.is_empty()) {
                work.append(&mut out, alt)?;
            }
            let caption = project_nodes(content, mode, work)?;
            if !caption.is_empty() {
                if !out.is_empty() {
                    work.append(&mut out, "\n")?;
                }
                work.append(&mut out, &caption)?;
            }
            Ok(out)
        }
        Node::LiteraryBlock { attrs, content } => {
            let body = project_nodes(content, mode, work)?;
            join_label_and_body(literary_label(attrs.kind), body, work)
        }
        Node::Warning { attrs, content } => {
            let body = project_nodes(content, mode, work)?;
            join_label_and_body(warning_label(attrs), body, work)
        }
        Node::Spoiler { attrs, content } => match mode {
            Mode::IncludeSpoilerBody => {
                let body = project_nodes(content, mode, work)?;
                join_label_and_body(&attrs.label, body, work)
            }
            Mode::ExcludeSpoilerBody => work.text(&attrs.label),
        },
        Node::Disclosure { attrs, content } => {
            let body = project_nodes(content, mode, work)?;
            join_label_and_body(&attrs.label, body, work)
        }
        Node::Verse { content } => project_verse(content, mode, work),
    }
}

fn project_inline(nodes: &[Node], mode: Mode, work: &mut Work) -> Projected {
    let mut out = String::new();
    for node in nodes {
        work.visit()?;
        match node {
            Node::Text { text, .. } => work.append(&mut out, text)?,
            Node::HardBreak => work.append(&mut out, "\n")?,
            other => {
                let part = project_node(other, mode, work)?;
                work.append(&mut out, &part)?;
            }
        }
    }
    Ok(out)
}

fn project_table_row(cells: &[Node], mode: Mode, work: &mut Work) -> Projected {
    let mut out = String::new();
    for (index, cell) in cells.iter().enumerate() {
        if index != 0 {
            work.append(&mut out, "\t")?;
        }
        let part = project_node(cell, mode, work)?;
        work.append(&mut out, &part)?;
    }
    Ok(out)
}

fn project_verse(nodes: &[Node], mode: Mode, work: &mut Work) -> Projected {
    let mut out = String::new();
    let mut pending_blank_lines: Option<u64> = None;
    for node in nodes {
        work.visit()?;
        match node {
            Node::VerseLine { content } => {
                let line = project_inline(content, mode, work)?;
                if !out.is_empty() {
                    let count = pending_blank_lines
                        .unwrap_or(0)
                        .checked_add(1)
                        .ok_or(ProjectionError::ArithmeticOverflow)?;
                    work.newlines(&mut out, count)?;
                }
                work.append(&mut out, &line)?;
                pending_blank_lines = None;
            }
            Node::StanzaBreak { attrs } => pending_blank_lines = Some(attrs.blank_lines),
            other => {
                if !out.is_empty() {
                    work.append(&mut out, "\n")?;
                }
                let part = project_node(other, mode, work)?;
                work.append(&mut out, &part)?;
                pending_blank_lines = None;
            }
        }
    }
    Ok(out)
}

fn join_label_and_body(label: &str, body: String, work: &mut Work) -> Projected {
    if body.is_empty() {
        work.text(label)
    } else if label.is_empty() {
        Ok(body)
    } else {
        let mut out = work.text(label)?;
        work.append(&mut out, "\n")?;
        work.append(&mut out, &body)?;
        Ok(out)
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
        let result = project_document(&doc, ProjectionBudget::default()).unwrap();
        assert!(result.full_text.contains("secret"));
        assert!(!result.public_snippet_text.contains("secret"));
        assert!(result.public_snippet_text.contains('S'));
        assert_eq!(result.full_text, result.search_index_text);
        // Marks must not alter characters.
        assert!(result.full_text.contains('h'));
    }
}
