// SPDX-License-Identifier: MIT OR Apache-2.0
// Derived from owner-controlled KlenWriter CMS source; see provenance/source-files.json.
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Document {
    pub schema: String,
    pub schema_version: u64,
    pub profile: Profile,
    pub content: Vec<Node>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Profile {
    Prose,
    Poetry,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Align {
    Left,
    Center,
    Right,
    Justify,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CellAlign {
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaAlign {
    None,
    Center,
    Wide,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LiteraryKind {
    AuthorNote,
    Letter,
    Epigraph,
    WorldNote,
    ChronicleQuote,
    ArchiveFragment,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WarningKind {
    General,
    Content,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ColorToken {
    Muted,
    Accent,
    Manuscript,
    Warning,
    Success,
    Danger,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HighlightToken {
    Accent,
    Manuscript,
    Warning,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct ParagraphAttrs {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub align: Option<Align>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_line_indent: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HeadingAttrs {
    pub level: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub align: Option<Align>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_line_indent: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CodeBlockAttrs {
    pub language: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskItemAttrs {
    pub checked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OrderedListAttrs {
    pub start: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct TableCellAttrs {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub colspan: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rowspan: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub align: Option<CellAlign>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MediaAttrs {
    pub media_asset_id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decorative: Option<bool>,
    pub align: MediaAlign,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LiteraryAttrs {
    pub kind: LiteraryKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WarningAttrs {
    pub kind: WarningKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LabelAttrs {
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StanzaBreakAttrs {
    pub blank_lines: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, tag = "type", rename_all = "snake_case")]
pub enum Node {
    Text {
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        marks: Option<Vec<Mark>>,
    },
    Paragraph {
        #[serde(skip_serializing_if = "Option::is_none")]
        attrs: Option<ParagraphAttrs>,
        content: Vec<Node>,
    },
    Heading {
        attrs: HeadingAttrs,
        content: Vec<Node>,
    },
    HardBreak {},
    SceneBreak {},
    CodeBlock {
        #[serde(skip_serializing_if = "Option::is_none")]
        attrs: Option<CodeBlockAttrs>,
        content: Vec<Node>,
    },
    Blockquote {
        content: Vec<Node>,
    },
    ListItem {
        content: Vec<Node>,
    },
    TaskItem {
        attrs: TaskItemAttrs,
        content: Vec<Node>,
    },
    BulletList {
        content: Vec<Node>,
    },
    OrderedList {
        #[serde(skip_serializing_if = "Option::is_none")]
        attrs: Option<OrderedListAttrs>,
        content: Vec<Node>,
    },
    TaskList {
        content: Vec<Node>,
    },
    TableHeader {
        #[serde(skip_serializing_if = "Option::is_none")]
        attrs: Option<TableCellAttrs>,
        content: Vec<Node>,
    },
    TableCell {
        #[serde(skip_serializing_if = "Option::is_none")]
        attrs: Option<TableCellAttrs>,
        content: Vec<Node>,
    },
    TableRow {
        content: Vec<Node>,
    },
    Table {
        content: Vec<Node>,
    },
    MediaImage {
        attrs: MediaAttrs,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        content: Vec<Node>,
    },
    LiteraryBlock {
        attrs: LiteraryAttrs,
        content: Vec<Node>,
    },
    Warning {
        attrs: WarningAttrs,
        content: Vec<Node>,
    },
    Spoiler {
        attrs: LabelAttrs,
        content: Vec<Node>,
    },
    Disclosure {
        attrs: LabelAttrs,
        content: Vec<Node>,
    },
    VerseLine {
        content: Vec<Node>,
    },
    StanzaBreak {
        attrs: StanzaBreakAttrs,
    },
    Verse {
        content: Vec<Node>,
    },
}

impl Node {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Text { .. } => "text",
            Self::Paragraph { .. } => "paragraph",
            Self::Heading { .. } => "heading",
            Self::HardBreak {} => "hard_break",
            Self::SceneBreak {} => "scene_break",
            Self::CodeBlock { .. } => "code_block",
            Self::Blockquote { .. } => "blockquote",
            Self::ListItem { .. } => "list_item",
            Self::TaskItem { .. } => "task_item",
            Self::BulletList { .. } => "bullet_list",
            Self::OrderedList { .. } => "ordered_list",
            Self::TaskList { .. } => "task_list",
            Self::TableHeader { .. } => "table_header",
            Self::TableCell { .. } => "table_cell",
            Self::TableRow { .. } => "table_row",
            Self::Table { .. } => "table",
            Self::MediaImage { .. } => "media_image",
            Self::LiteraryBlock { .. } => "literary_block",
            Self::Warning { .. } => "warning",
            Self::Spoiler { .. } => "spoiler",
            Self::Disclosure { .. } => "disclosure",
            Self::VerseLine { .. } => "verse_line",
            Self::StanzaBreak { .. } => "stanza_break",
            Self::Verse { .. } => "verse",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, tag = "type", rename_all = "snake_case")]
pub enum Mark {
    Strong {},
    Emphasis {},
    Strike {},
    Code {},
    Subscript {},
    Superscript {},
    TextColor { attrs: ColorAttrs },
    Highlight { attrs: HighlightAttrs },
    Link { attrs: LinkAttrs },
    ReferenceLink { attrs: ReferenceLinkAttrs },
}

impl Mark {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Strong {} => "strong",
            Self::Emphasis {} => "emphasis",
            Self::Strike {} => "strike",
            Self::Code {} => "code",
            Self::Subscript {} => "subscript",
            Self::Superscript {} => "superscript",
            Self::TextColor { .. } => "text_color",
            Self::Highlight { .. } => "highlight",
            Self::Link { .. } => "link",
            Self::ReferenceLink { .. } => "reference_link",
        }
    }

    pub fn precedence(&self) -> u8 {
        match self {
            Self::Code {} => 0,
            Self::Strong {} => 1,
            Self::Emphasis {} => 2,
            Self::Strike {} => 3,
            Self::Subscript {} => 4,
            Self::Superscript {} => 5,
            Self::TextColor { .. } => 6,
            Self::Highlight { .. } => 7,
            Self::Link { .. } => 8,
            Self::ReferenceLink { .. } => 9,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ColorAttrs {
    pub token: ColorToken,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HighlightAttrs {
    pub token: HighlightToken,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LinkAttrs {
    pub href: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReferenceLinkAttrs {
    pub reference_entity_id: Uuid,
}

impl editor_core::document::TreeNode for Node {
    fn type_name(&self) -> &str {
        self.kind()
    }
    fn primitive(&self) -> editor_core::document::Primitive {
        use editor_core::document::Primitive;
        match self {
            Self::Text { .. } => Primitive::Text,
            Self::HardBreak {} => Primitive::HardBreak,
            Self::SceneBreak {} | Self::StanzaBreak { .. } => Primitive::BlockAtom,
            Self::Paragraph { .. }
            | Self::Heading { .. }
            | Self::CodeBlock { .. }
            | Self::VerseLine { .. } => Primitive::TextBlock,
            _ => Primitive::Container,
        }
    }
    fn children(&self) -> &[Self] {
        match self {
            Self::Text { .. }
            | Self::HardBreak {}
            | Self::SceneBreak {}
            | Self::StanzaBreak { .. } => &[],
            Self::Paragraph { content, .. }
            | Self::Heading { content, .. }
            | Self::CodeBlock { content, .. }
            | Self::Blockquote { content }
            | Self::ListItem { content }
            | Self::TaskItem { content, .. }
            | Self::BulletList { content }
            | Self::OrderedList { content, .. }
            | Self::TaskList { content }
            | Self::TableHeader { content, .. }
            | Self::TableCell { content, .. }
            | Self::TableRow { content }
            | Self::Table { content }
            | Self::MediaImage { content, .. }
            | Self::LiteraryBlock { content, .. }
            | Self::Warning { content, .. }
            | Self::Spoiler { content, .. }
            | Self::Disclosure { content, .. }
            | Self::VerseLine { content }
            | Self::Verse { content } => content,
        }
    }
    fn text(&self) -> Option<&str> {
        match self {
            Self::Text { text, .. } => Some(text),
            _ => None,
        }
    }
}
