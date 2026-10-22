// SPDX-License-Identifier: MIT OR Apache-2.0
//! ID-free clipboard values and native, bounded range/fragment policies.
use super::{block, inline};
use crate::{KwdjError, KwdjErrorCode, KwdjProfile, Profile, model};
use editor_core::{
    admission::{PreflightBudget, preflight_node_fields},
    candidate::CandidateRead,
    commands::{CommandPresentation, CommandState, LocalRef, PlanBuilder, SelectionIntent},
    document::{Document, Node, Primitive, TreeNode},
    positions::{Affinity, Edge, Position, Selection, Utf16Offset, utf16_to_utf8},
    transaction::{Operation, WorkMeter},
};
use serde::{Deserialize, Serialize};

pub const CONTEXT_FORMAT: &str = "org.klenwriter.kwdj/clipboard-context/1";
pub const FRAGMENT_FORMAT: &str = "org.klenwriter.kwdj/clipboard-fragment/1";
pub const FRAGMENT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceProfile {
    pub profile_id: String,
    pub profile_version: String,
    pub codec_id: String,
    pub wire_version: u32,
}
impl SourceProfile {
    fn current() -> Self {
        Self {
            profile_id: crate::PROFILE_ID.into(),
            profile_version: crate::KWDJ_PROFILE_VERSION.into(),
            codec_id: crate::KWDJ_CODEC_ID.into(),
            wire_version: 1,
        }
    }
    fn matches(&self) -> bool {
        self.profile_id == crate::PROFILE_ID
            && self.profile_version == crate::KWDJ_PROFILE_VERSION
            && self.codec_id == crate::KWDJ_CODEC_ID
            && self.wire_version == 1
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FragmentKind {
    Inline,
    Blocks,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Fragment {
    pub format_id: String,
    pub source_profile: SourceProfile,
    pub mode: Profile,
    pub kind: FragmentKind,
    pub content: Vec<model::Node>,
    pub open_start: bool,
    pub open_end: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InsertionContext {
    Root,
    ProseBlock,
    Verse,
}
#[derive(Debug, Serialize)]
pub struct ClipboardContext {
    pub mode: Profile,
    pub insertion_context: InsertionContext,
    pub allowed_fragment_kinds: Vec<FragmentKind>,
}
fn error(code: KwdjErrorCode) -> KwdjError {
    KwdjError::new(code, "/clipboard")
}
fn unsupported() -> KwdjError {
    error(KwdjErrorCode::CommandUnsupportedContext)
}
fn invalid() -> KwdjError {
    error(KwdjErrorCode::CommandInvalidTarget)
}
fn unit(work: &mut WorkMeter, n: usize) -> Result<(), KwdjError> {
    work.charge_units(n as u64).map_err(KwdjError::operational)
}
fn bytes(work: &mut WorkMeter, n: usize) -> Result<(), KwdjError> {
    work.charge_bytes(n as u64).map_err(KwdjError::operational)
}
fn local(s: &str) -> &str {
    s.strip_prefix("org.klenwriter.kwdj/").unwrap_or("")
}
fn encoded_len(value: &impl Serialize, maximum: usize) -> Result<usize, KwdjError> {
    struct Count {
        len: usize,
        maximum: usize,
    }
    impl std::io::Write for Count {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.len = self.len.saturating_add(bytes.len());
            if self.len > self.maximum {
                return Err(std::io::ErrorKind::OutOfMemory.into());
            }
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut count = Count { len: 0, maximum };
    serde_json::to_writer(&mut count, value)
        .map_err(|_| error(KwdjErrorCode::ResourceLimitExceeded))?;
    Ok(count.len)
}
fn text_block<V: CandidateRead>(
    view: &V,
    position: Position<V::Id>,
    work: &mut WorkMeter,
) -> Result<V::Id, KwdjError> {
    Ok(inline::text_point(view, position, work)?.block)
}
fn structural<V: CandidateRead>(
    view: &V,
    position: Position<V::Id>,
    work: &mut WorkMeter,
) -> Result<Option<(V::Id, usize)>, KwdjError> {
    unit(work, 1)?;
    match position {
        Position::Child { parent, index, .. } => {
            let children = if parent == view.root() {
                view.roots()
            } else {
                let node = view.node(parent).ok_or_else(invalid)?;
                if node.primitive != Primitive::Container {
                    return Ok(None);
                }
                node.children
            };
            if index > children.len() {
                return Err(invalid());
            }
            Ok(Some((parent, index)))
        }
        Position::Edge { node, side } => {
            let n = view.node(node).ok_or_else(invalid)?;
            if n.primitive == Primitive::TextBlock {
                return Ok(None);
            }
            let children = if n.parent == view.root() {
                view.roots()
            } else {
                let parent = view.node(n.parent).ok_or_else(invalid)?;
                if parent.primitive != Primitive::Container {
                    return Ok(None);
                }
                parent.children
            };
            unit(work, children.len())?;
            let index = children
                .iter()
                .position(|id| *id == node)
                .ok_or_else(invalid)?;
            Ok(Some((n.parent, index + usize::from(side == Edge::After))))
        }
        _ => Ok(None),
    }
}
pub fn context<V: CandidateRead>(
    mode: Profile,
    view: &V,
    selection: Selection<V::Id>,
    work: &mut WorkMeter,
) -> Result<ClipboardContext, KwdjError> {
    let a = structural(view, selection.anchor, work)?;
    let b = structural(view, selection.focus, work)?;
    if let (Some((ap, _)), Some((bp, _))) = (a, b)
        && ap == bp
    {
        let verse = ap != view.root() && view.node(ap).is_some_and(|n| local(n.type_id) == "verse");
        return Ok(ClipboardContext {
            mode,
            insertion_context: if verse {
                InsertionContext::Verse
            } else {
                InsertionContext::Root
            },
            allowed_fragment_kinds: vec![FragmentKind::Blocks],
        });
    }
    let left = text_block(view, selection.anchor, work)?;
    let right = text_block(view, selection.focus, work)?;
    let a = view.node(left).ok_or_else(invalid)?;
    let b = view.node(right).ok_or_else(invalid)?;
    unit(work, 2)?;
    if local(a.type_id) == "verse_line"
        && local(b.type_id) == "verse_line"
        && a.parent == b.parent
        && mode == Profile::Poetry
    {
        return Ok(ClipboardContext {
            mode,
            insertion_context: InsertionContext::Verse,
            allowed_fragment_kinds: vec![FragmentKind::Inline, FragmentKind::Blocks],
        });
    }
    if !matches!(local(a.type_id), "paragraph" | "heading")
        || !matches!(local(b.type_id), "paragraph" | "heading")
        || a.parent != b.parent
        || a.type_id != b.type_id
        || a.attributes != b.attributes
    {
        return Err(unsupported());
    }
    Ok(ClipboardContext {
        mode,
        insertion_context: InsertionContext::ProseBlock,
        allowed_fragment_kinds: vec![FragmentKind::Inline, FragmentKind::Blocks],
    })
}

/// Bound the entire nested JSON source before recursive DTO allocation.
pub fn decode_fragment(json: &str) -> Result<Fragment, KwdjError> {
    if json.len() > FRAGMENT_BYTES {
        return Err(KwdjError::limit(
            "/clipboard",
            "clipboard_fragment_bytes",
            FRAGMENT_BYTES as u64,
            json.len() as u64,
        ));
    }
    let (mut depth, mut values, mut string, mut escape) = (0usize, 0usize, false, false);
    for byte in json.bytes() {
        if string {
            if escape {
                escape = false;
            } else if byte == b'\\' {
                escape = true;
            } else if byte == b'"' {
                string = false;
            }
        } else {
            match byte {
                b'"' => {
                    string = true;
                    values += 1;
                }
                b'{' | b'[' => {
                    depth += 1;
                    values += 1;
                }
                b'}' | b']' => depth = depth.saturating_sub(1),
                b',' => values += 1,
                _ => {}
            }
            if depth > 96 || values > 131_072 {
                return Err(error(KwdjErrorCode::ResourceLimitExceeded));
            }
        }
    }
    serde_json::from_str(json).map_err(|_| error(KwdjErrorCode::InvalidJson))
}

fn preflight(
    fragment: &Fragment,
    profile: &KwdjProfile<'_>,
    mode: Profile,
    work: &mut WorkMeter,
) -> Result<(), KwdjError> {
    if fragment.format_id != FRAGMENT_FORMAT
        || !fragment.source_profile.matches()
        || fragment.mode != mode
    {
        return Err(error(KwdjErrorCode::InvalidEnvelope));
    }
    // An empty clipboard payload has no insertion semantics. A real empty
    // paragraph remains an explicit node; deletion uses DeleteSelection.
    if fragment.content.is_empty() {
        return Err(invalid());
    }
    if fragment.kind == FragmentKind::Inline && (fragment.open_start || fragment.open_end) {
        return Err(invalid());
    }
    if (fragment.open_start || fragment.open_end) && fragment.content.is_empty() {
        return Err(invalid());
    }
    let verse_wrapper = fragment.mode == Profile::Poetry
        && fragment.content.len() == 1
        && matches!(fragment.content.first(), Some(model::Node::Verse { .. }));
    if !verse_wrapper
        && (fragment.open_start
            && !matches!(
                fragment.content.first(),
                Some(model::Node::Paragraph { .. } | model::Node::Heading { .. })
            )
            || fragment.open_end
                && !matches!(
                    fragment.content.last(),
                    Some(model::Node::Paragraph { .. } | model::Node::Heading { .. })
                ))
    {
        return Err(unsupported());
    }
    fn walk(
        nodes: &[model::Node],
        depth: usize,
        count: &mut usize,
        total: &mut usize,
        p: &KwdjProfile<'_>,
        w: &mut WorkMeter,
    ) -> Result<(), KwdjError> {
        if nodes.is_empty() {
            return Ok(());
        }
        if depth as u64 > p.limits().tree_depth || nodes.len() as u64 > p.limits().node_count {
            return Err(error(KwdjErrorCode::ResourceLimitExceeded));
        }
        for node in nodes {
            *count += 1;
            unit(w, 1)?;
            bytes(w, std::mem::size_of::<model::Node>())?;
            if *count as u64 > p.limits().node_count {
                return Err(error(KwdjErrorCode::ResourceLimitExceeded));
            }
            if let Some(text) = node.text() {
                *total = total.saturating_add(text.len());
                if text.len() as u64 > p.limits().text_leaf_bytes || *total > FRAGMENT_BYTES {
                    return Err(error(KwdjErrorCode::ResourceLimitExceeded));
                }
                bytes(w, text.len())?;
            }
            walk(node.children(), depth + 1, count, total, p, w)?;
        }
        Ok(())
    }
    walk(&fragment.content, 1, &mut 0, &mut 0, profile, work)?;
    crate::validate::validate_fragment(
        &fragment.content,
        mode,
        fragment.kind == FragmentKind::Inline,
        profile.identities(),
        profile.limits(),
        work,
    )
}

struct CaptureBudget {
    nodes: usize,
    bytes: usize,
}
impl CaptureBudget {
    fn new() -> Self {
        Self {
            nodes: 50_000,
            bytes: FRAGMENT_BYTES,
        }
    }
}
fn copy_node<V: CandidateRead>(
    view: &V,
    id: V::Id,
    work: &mut WorkMeter,
    depth: usize,
    remaining: &mut CaptureBudget,
) -> Result<Node, KwdjError> {
    if depth > 32 || remaining.nodes == 0 {
        return Err(error(KwdjErrorCode::ResourceLimitExceeded));
    }
    remaining.nodes -= 1;
    let node = view.node(id).ok_or_else(invalid)?;
    let usage = preflight_node_fields(
        node.type_id,
        node.text,
        node.attributes,
        node.marks,
        node.children.len(),
        PreflightBudget {
            payload_bytes: FRAGMENT_BYTES as u64,
            values: 50_000,
            depth: 32,
        },
    )
    .map_err(KwdjError::operational)?;
    let payload = usage.payload_bytes as usize + 128;
    remaining.bytes = remaining
        .bytes
        .checked_sub(payload)
        .ok_or_else(|| error(KwdjErrorCode::ResourceLimitExceeded))?;
    unit(work, usage.values as usize)?;
    bytes(
        work,
        usage.payload_bytes as usize
            + std::mem::size_of::<Node>()
            + node.children.len() * std::mem::size_of::<Node>(),
    )?;
    let mut result = Node {
        type_id: node.type_id.to_owned(),
        primitive: node.primitive,
        attributes: node.attributes.clone(),
        marks: node.marks.to_vec(),
        text: node.text.map(str::to_owned),
        children: Vec::new(),
    };
    for child in node.children {
        result
            .children
            .push(copy_node(view, *child, work, depth + 1, remaining)?);
    }
    Ok(result)
}
fn point_index<I: Copy>(point: inline::TextPoint<I>) -> usize {
    point.index + usize::from(point.leaf.is_some() && point.utf16.get() > 0)
}
fn clip_inline<V: CandidateRead>(
    view: &V,
    block: V::Id,
    start: Option<inline::TextPoint<V::Id>>,
    end: Option<inline::TextPoint<V::Id>>,
    work: &mut WorkMeter,
    budget: &mut CaptureBudget,
) -> Result<Vec<Node>, KwdjError> {
    let node = view.node(block).ok_or_else(invalid)?;
    let from = start.map_or(0, |p| p.index);
    let to = end.map_or(node.children.len(), |p| {
        p.index + usize::from(p.leaf.is_some())
    });
    if from > to || to > node.children.len() {
        return Err(invalid());
    }
    unit(work, to - from)?;
    bytes(work, (to - from) * std::mem::size_of::<Node>())?;
    let mut result = Vec::new();
    for (index, id) in node.children.iter().enumerate().take(to).skip(from) {
        let mut child = copy_node(view, *id, work, 1, budget)?;
        if let Some(text) = &child.text {
            bytes(work, text.len())?;
            let lo = if start.is_some_and(|p| p.index == index && p.leaf.is_some()) {
                utf16_to_utf8(text, start.expect("present").utf16)
                    .map_err(|_| invalid())?
                    .get()
            } else {
                0
            };
            let hi = if end.is_some_and(|p| p.index == index && p.leaf.is_some()) {
                utf16_to_utf8(text, end.expect("present").utf16)
                    .map_err(|_| invalid())?
                    .get()
            } else {
                text.len()
            };
            if lo > hi {
                return Err(invalid());
            }
            if lo == hi {
                continue;
            }
            bytes(work, hi - lo)?;
            child.text = Some(text[lo..hi].to_owned());
        }
        result.push(child);
    }
    Ok(result)
}
fn siblings<V: CandidateRead>(
    view: &V,
    left: V::Id,
    right: V::Id,
    work: &mut WorkMeter,
) -> Result<(V::Id, usize, usize), KwdjError> {
    let a = view.node(left).ok_or_else(invalid)?;
    let b = view.node(right).ok_or_else(invalid)?;
    if a.parent != b.parent || a.type_id != b.type_id || a.attributes != b.attributes {
        return Err(unsupported());
    }
    let children = if a.parent == view.root() {
        view.roots()
    } else {
        view.children(a.parent).ok_or_else(invalid)?
    };
    unit(work, children.len())?;
    let l = children
        .iter()
        .position(|id| *id == left)
        .ok_or_else(invalid)?;
    let r = children
        .iter()
        .position(|id| *id == right)
        .ok_or_else(invalid)?;
    if l > r {
        return Err(invalid());
    }
    Ok((a.parent, l, r))
}
pub fn extract<V: CandidateRead>(
    mode: Profile,
    view: &V,
    selection: Selection<V::Id>,
    max_bytes: u32,
    work: &mut WorkMeter,
) -> Result<(String, bool), KwdjError> {
    let mut roots = Vec::new();
    let kind;
    let (open_start, open_end);
    let budget = &mut CaptureBudget::new();
    if let (Some((ap, a)), Some((bp, b))) = (
        structural(view, selection.anchor, work)?,
        structural(view, selection.focus, work)?,
    ) {
        if ap != bp {
            return Err(unsupported());
        }
        let children = if ap == view.root() {
            view.roots()
        } else {
            view.children(ap).ok_or_else(invalid)?
        };
        unit(work, a.abs_diff(b))?;
        for id in &children[a.min(b)..a.max(b)] {
            roots.push(copy_node(view, *id, work, 1, budget)?);
        }
        kind = FragmentKind::Blocks;
        (open_start, open_end) = (false, false);
    } else {
        let range = inline::ordered_range(view, selection, work)?;
        let start = inline::text_point(view, range.start, work)?;
        let end = inline::text_point(view, range.end, work)?;
        let _ = context(mode, view, selection, work)?;
        if start.block == end.block {
            roots = clip_inline(view, start.block, Some(start), Some(end), work, budget)?;
            kind = FragmentKind::Inline;
            (open_start, open_end) = (false, false);
        } else {
            let (parent, l, r) = siblings(view, start.block, end.block, work)?;
            let children = if parent == view.root() {
                view.roots()
            } else {
                view.children(parent).ok_or_else(invalid)?
            };
            for (index, id) in children.iter().enumerate().take(r + 1).skip(l) {
                let mut node = copy_node(view, *id, work, 1, budget)?;
                if index == l {
                    node.children = clip_inline(view, *id, Some(start), None, work, budget)?;
                }
                if index == r {
                    node.children = clip_inline(view, *id, None, Some(end), work, budget)?;
                }
                roots.push(node);
            }
            kind = FragmentKind::Blocks;
            (open_start, open_end) = (true, true);
        }
    }
    let empty = roots.is_empty();
    if mode == Profile::Poetry
        && kind == FragmentKind::Blocks
        && roots
            .first()
            .is_some_and(|n| matches!(local(&n.type_id), "verse_line" | "stanza_break"))
    {
        roots = vec![Node {
            type_id: "org.klenwriter.kwdj/verse".into(),
            primitive: Primitive::Container,
            attributes: Default::default(),
            marks: Vec::new(),
            text: None,
            children: roots,
        }];
    }
    let mut content = Vec::new();
    bytes(work, (FRAGMENT_BYTES - budget.bytes).saturating_mul(12))?;
    for node in roots {
        let value = crate::core_bridge::encode_node(&node, "/content")?;
        let n = serde_json::from_value(value).map_err(|_| invalid())?;
        content.push(n);
    }
    let fragment = Fragment {
        format_id: FRAGMENT_FORMAT.into(),
        source_profile: SourceProfile::current(),
        mode,
        kind,
        content,
        open_start,
        open_end,
    };
    let length = encoded_len(&fragment, (max_bytes as usize).min(FRAGMENT_BYTES))?;
    unit(work, length)?;
    bytes(work, length)?;
    let json = serde_json::to_string(&fragment).map_err(|_| invalid())?;
    Ok((json, empty))
}

fn map_position<I: Copy>(p: Position<I>) -> Position<LocalRef<I>> {
    match p {
        Position::Text {
            leaf,
            utf16,
            affinity,
        } => Position::Text {
            leaf: leaf.into(),
            utf16,
            affinity,
        },
        Position::Child {
            parent,
            index,
            affinity,
        } => Position::Child {
            parent: parent.into(),
            index,
            affinity,
        },
        Position::Edge { node, side } => Position::Edge {
            node: node.into(),
            side,
        },
    }
}
fn range<I: Copy>(a: Position<I>, b: Position<I>) -> Selection<LocalRef<I>> {
    Selection {
        anchor: map_position(a),
        focus: map_position(b),
    }
}
fn gap<I>(parent: I, index: usize) -> Position<I> {
    Position::Child {
        parent,
        index,
        affinity: Affinity::After,
    }
}
fn set_caret<I: Copy>(
    plan: &mut PlanBuilder<'_, I>,
    caret: Position<LocalRef<I>>,
) -> Result<(), KwdjError> {
    plan.work()
        .charge_bytes(256)
        .map_err(KwdjError::operational)?;
    plan.set_selection(SelectionIntent::MapFromUserResult(Some(Selection {
        anchor: caret.clone(),
        focus: caret,
    })))
    .map_err(KwdjError::operational)
}
fn splice_with_caret<I: Copy + Eq>(
    plan: &mut PlanBuilder<'_, I>,
    selected: Selection<LocalRef<I>>,
    roots: Vec<Node>,
    parent: LocalRef<I>,
    prefix: usize,
) -> Result<Position<LocalRef<I>>, KwdjError> {
    if roots.is_empty() && selected.anchor == selected.focus {
        return Ok(selected.focus);
    }
    // PlanBuilder exposes no mutable plan. Compute its Created operation index
    // from push's return, retaining only a bounded last-leaf witness.
    let count = roots.len();
    let last = roots.last().map(|node| {
        (
            node.primitive,
            node.text.as_deref().map(|s| s.encode_utf16().count()),
        )
    });
    bytes(plan.work(), 512)?;
    let operation = plan
        .push(Operation::ReplaceInlineFragment {
            range: selected,
            fragment: Document { children: roots },
        })
        .map_err(KwdjError::operational)?;
    Ok(match last {
        Some((Primitive::Text, Some(length))) => Position::Text {
            leaf: LocalRef::Created {
                operation,
                path: vec![count - 1],
            },
            utf16: Utf16Offset::new(length),
            affinity: Affinity::After,
        },
        _ => gap(parent, prefix + count),
    })
}
type InsertedCaret<I> = (Position<LocalRef<I>>, usize);

fn insert_blocks<I: Copy>(
    plan: &mut PlanBuilder<'_, I>,
    parent: I,
    index: usize,
    roots: Vec<Node>,
) -> Result<Option<InsertedCaret<I>>, KwdjError> {
    let count = roots.len();
    insert_blocks_caret(plan, parent, index, roots, count)
}
fn insert_blocks_caret<I: Copy>(
    plan: &mut PlanBuilder<'_, I>,
    parent: I,
    index: usize,
    roots: Vec<Node>,
    caret_count: usize,
) -> Result<Option<InsertedCaret<I>>, KwdjError> {
    if roots.is_empty() {
        return Ok(None);
    }
    // A bounded shape-only witness avoids cloning the actual forest.
    let mut path = vec![caret_count.saturating_sub(1)];
    let mut node = &roots[caret_count.saturating_sub(1)];
    let mut inline_gap = None;
    while matches!(node.primitive, Primitive::Container | Primitive::TextBlock)
        && !node.children.is_empty()
    {
        if node.primitive == Primitive::TextBlock {
            inline_gap = Some((path.clone(), node.children.len()));
        }
        let last = node.children.len() - 1;
        path.push(last);
        node = &node.children[last];
    }
    bytes(plan.work(), path.len() * std::mem::size_of::<usize>() + 256)?;
    let terminal = (
        node.primitive,
        node.text.as_deref().map(|s| s.encode_utf16().count()),
    );
    let operation = plan
        .push(Operation::InsertFragment {
            parent: parent.into(),
            index,
            fragment: Document { children: roots },
        })
        .map_err(KwdjError::operational)?;
    let caret = if caret_count == 0 {
        gap(parent.into(), index)
    } else {
        match terminal {
            (Primitive::Text, Some(length)) => Position::Text {
                leaf: LocalRef::Created { operation, path },
                utf16: Utf16Offset::new(length),
                affinity: Affinity::After,
            },
            (Primitive::TextBlock, _) => gap(LocalRef::Created { operation, path }, 0),
            (Primitive::HardBreak | Primitive::InlineAtom, _) if inline_gap.is_some() => {
                let (path, end) = inline_gap.expect("present");
                gap(LocalRef::Created { operation, path }, end)
            }
            _ => gap(parent.into(), index + caret_count),
        }
    };
    Ok(Some((caret, operation)))
}
fn header_matches<V: CandidateRead>(
    view: &V,
    id: V::Id,
    payload: &Node,
    work: &mut WorkMeter,
) -> Result<(), KwdjError> {
    let actual = view.node(id).ok_or_else(invalid)?;
    let usage = preflight_node_fields(
        actual.type_id,
        None,
        actual.attributes,
        &[],
        0,
        PreflightBudget::default(),
    )
    .map_err(KwdjError::operational)?;
    unit(work, usage.values as usize)?;
    bytes(work, usage.payload_bytes as usize)?;
    if actual.type_id != payload.type_id || actual.attributes != &payload.attributes {
        return Err(error(KwdjErrorCode::CommandLossyTransform));
    }
    Ok(())
}
fn inline_across<V: CandidateRead>(
    view: &V,
    ordered: inline::OrderedRange<V::Id>,
    roots: Vec<Node>,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<(), KwdjError> {
    let start = inline::text_point(view, ordered.start, plan.work())?;
    let end = inline::text_point(view, ordered.end, plan.work())?;
    let (parent, l, r) = siblings(view, start.block, end.block, plan.work())?;
    let left = view.node(start.block).ok_or_else(invalid)?;
    let right_start = gap(end.block, 0);
    let mut cut = block::prepare_inline_cut(
        view,
        Selection {
            anchor: right_start,
            focus: ordered.end,
        },
        plan,
    )?;
    block::finish_inline_cut(&mut cut, plan)?;
    let count = roots.len();
    let prefix = point_index(start);
    let caret = splice_with_caret(
        plan,
        range(ordered.start, gap(start.block, left.children.len())),
        roots,
        start.block.into(),
        prefix,
    )?;
    if !cut.tail.is_empty() {
        plan.push(Operation::MoveInlineGroup {
            nodes: cut.tail,
            parent: start.block.into(),
            before_index: prefix + count,
        })
        .map_err(KwdjError::operational)?;
    }
    let children = if parent == view.root() {
        view.roots()
    } else {
        view.children(parent).ok_or_else(invalid)?
    };
    for id in &children[l + 1..=r] {
        plan.push(Operation::Remove { node: (*id).into() })
            .map_err(KwdjError::operational)?;
    }
    set_caret(plan, caret)
}

pub(super) fn prepare<V: CandidateRead>(
    profile: &KwdjProfile<'_>,
    mode: Profile,
    view: &V,
    state: CommandState<'_, V::Id>,
    fragment: &Fragment,
    plan: &mut PlanBuilder<'_, V::Id>,
) -> Result<CommandPresentation, KwdjError> {
    preflight(fragment, profile, mode, plan.work())?;
    let selection = state
        .selection
        .copied()
        .ok_or_else(|| error(KwdjErrorCode::CommandSelectionRequired))?;
    // Conservatively account the full conversion's strings/metadata before the
    // codec allocates owned generic nodes. No selected/document snapshot exists.
    let length = encoded_len(fragment, FRAGMENT_BYTES)?;
    bytes(plan.work(), length.saturating_mul(6))?;
    unit(plan.work(), length)?;
    let mut roots: Vec<Node> = fragment
        .content
        .iter()
        .map(crate::core_bridge::convert_node)
        .collect();
    let native_context = context(mode, view, selection, plan.work())?;
    let verse_target = native_context.insertion_context == InsertionContext::Verse;
    let verse_wrapper = verse_target && roots.len() == 1 && local(&roots[0].type_id) == "verse";
    if verse_wrapper {
        roots = roots.remove(0).children;
    }
    // A whole canonical Verse becomes compatible line/stanza units only in an
    // already native-classified Verse target; no HTML or TS context inference.
    let open_start = fragment.open_start || verse_wrapper;
    let open_end = fragment.open_end || verse_wrapper;
    if let (Some((ap, a)), Some((bp, b))) = (
        structural(view, selection.anchor, plan.work())?,
        structural(view, selection.focus, plan.work())?,
    ) {
        if ap != bp
            || fragment.kind != FragmentKind::Blocks
            || fragment.open_start
            || fragment.open_end
        {
            return Err(unsupported());
        }
        let children = if ap == view.root() {
            view.roots()
        } else {
            view.children(ap).ok_or_else(invalid)?
        };
        for id in &children[a.min(b)..a.max(b)] {
            plan.push(Operation::Remove { node: (*id).into() })
                .map_err(KwdjError::operational)?;
        }
        if let Some((caret, _)) = insert_blocks(plan, ap, a.min(b), roots)? {
            set_caret(plan, caret)?;
        } else if a != b {
            set_caret(plan, gap(ap.into(), a.min(b)))?;
        }
        return Ok(CommandPresentation::default());
    }
    if !matches!(
        native_context.insertion_context,
        InsertionContext::ProseBlock | InsertionContext::Verse
    ) {
        return Err(unsupported());
    }
    let ordered = inline::ordered_range(view, selection, plan.work())?;
    let start = inline::text_point(view, ordered.start, plan.work())?;
    let end = inline::text_point(view, ordered.end, plan.work())?;
    if fragment.kind == FragmentKind::Inline {
        if start.block == end.block {
            let caret = splice_with_caret(
                plan,
                range(ordered.start, ordered.end),
                roots,
                start.block.into(),
                point_index(start),
            )?;
            set_caret(plan, caret)?;
        } else {
            inline_across(view, ordered, roots, plan)?;
        }
        return Ok(CommandPresentation::default());
    }
    if roots.len() == 1 && open_start && open_end {
        header_matches(view, start.block, &roots[0], plan.work())?;
        header_matches(view, end.block, &roots[0], plan.work())?;
        let children = roots.remove(0).children;
        if start.block == end.block {
            let caret = splice_with_caret(
                plan,
                range(ordered.start, ordered.end),
                children,
                start.block.into(),
                point_index(start),
            )?;
            set_caret(plan, caret)?;
        } else {
            inline_across(view, ordered, children, plan)?;
        }
        return Ok(CommandPresentation::default());
    }
    if open_start {
        header_matches(
            view,
            start.block,
            roots.first().ok_or_else(invalid)?,
            plan.work(),
        )?;
    }
    if open_end {
        header_matches(
            view,
            end.block,
            roots.last().ok_or_else(invalid)?,
            plan.work(),
        )?;
    }
    if start.block != end.block {
        let (parent, l, r) = siblings(view, start.block, end.block, plan.work())?;
        let left = view.node(start.block).ok_or_else(invalid)?;
        let right = view.node(end.block).ok_or_else(invalid)?;
        let first = if open_start {
            roots.remove(0).children
        } else {
            Vec::new()
        };
        let last = if open_end {
            roots.pop().ok_or_else(invalid)?.children
        } else {
            Vec::new()
        };
        let left_caret = splice_with_caret(
            plan,
            range(ordered.start, gap(start.block, left.children.len())),
            first,
            start.block.into(),
            point_index(start),
        )?;
        let right_caret = splice_with_caret(
            plan,
            range(gap(end.block, 0), ordered.end),
            last,
            end.block.into(),
            0,
        )?;
        let prefix = start.index != 0 || start.utf16.get() != 0;
        let suffix_exists = if let Some(leaf) = end.leaf {
            let text = view
                .node(leaf)
                .ok_or_else(invalid)?
                .text
                .ok_or_else(invalid)?;
            bytes(plan.work(), text.len())?;
            end.utf16.get() < text.encode_utf16().count() || end.index + 1 < right.children.len()
        } else {
            end.index < right.children.len()
        };
        let keep_left = open_start || prefix;
        let keep_right = open_end || suffix_exists;
        let children = if parent == view.root() {
            view.roots()
        } else {
            view.children(parent).ok_or_else(invalid)?
        };
        for id in &children[l + 1..r] {
            plan.push(Operation::Remove { node: (*id).into() })
                .map_err(KwdjError::operational)?;
        }
        if !keep_left {
            plan.push(Operation::Remove {
                node: start.block.into(),
            })
            .map_err(KwdjError::operational)?;
        }
        if !keep_right {
            plan.push(Operation::Remove {
                node: end.block.into(),
            })
            .map_err(KwdjError::operational)?;
        }
        let inserted = insert_blocks(plan, parent, l + usize::from(keep_left), roots)?;
        let caret = if open_end {
            right_caret
        } else if let Some((caret, _)) = inserted {
            caret
        } else if keep_left {
            left_caret
        } else {
            gap(parent.into(), l)
        };
        set_caret(plan, caret)?;
    } else {
        let header = view.node(start.block).ok_or_else(invalid)?;
        let (parent, index, _) = siblings(view, start.block, start.block, plan.work())?;
        let mut cut = block::prepare_inline_cut(
            view,
            Selection {
                anchor: ordered.start,
                focus: ordered.end,
            },
            plan,
        )?;
        let first = if open_start {
            roots.remove(0).children
        } else {
            Vec::new()
        };
        let keep_prefix = open_start || !cut.at_start;
        let suffix_in_host = !keep_prefix && !cut.at_end && !open_end;
        let last_payload_children = roots.last().map_or(0, |n| n.children.len());
        let payload_count = roots.len();
        if !open_end && !cut.at_end && !suffix_in_host {
            let mut attrs = plan
                .charged_copy_attrs(header.attributes)
                .map_err(KwdjError::operational)?;
            let type_id = plan
                .charged_copy_text(header.type_id)
                .map_err(KwdjError::operational)?;
            roots.push(Node {
                type_id,
                primitive: Primitive::TextBlock,
                attributes: std::mem::take(&mut attrs),
                marks: Vec::new(),
                text: None,
                children: Vec::new(),
            });
        }
        let insert_index = index + usize::from(keep_prefix);
        let inserted = insert_blocks_caret(plan, parent, insert_index, roots, payload_count)?;
        let mut payload_caret = inserted.as_ref().map(|(caret, _)| caret.clone());
        if let Some((_, operation)) = &inserted {
            if !cut.tail.is_empty() && !suffix_in_host {
                let last_index = if open_end {
                    payload_count - 1
                } else {
                    payload_count
                };
                bytes(plan.work(), std::mem::size_of::<usize>())?;
                plan.push(Operation::MoveInlineGroup {
                    nodes: std::mem::take(&mut cut.tail),
                    parent: LocalRef::Created {
                        operation: *operation,
                        path: vec![last_index],
                    },
                    before_index: if open_end { last_payload_children } else { 0 },
                })
                .map_err(KwdjError::operational)?;
            }
            if !open_end && payload_count == 0 {
                payload_caret = None;
            }
        }
        let selected = cut
            .deletion
            .take()
            .unwrap_or_else(|| range(ordered.start, ordered.end));
        let prefix_caret = splice_with_caret(
            plan,
            selected,
            first,
            start.block.into(),
            point_index(start),
        )?;
        if !keep_prefix && !suffix_in_host {
            plan.push(Operation::Remove {
                node: start.block.into(),
            })
            .map_err(KwdjError::operational)?;
        }
        let caret = if open_end {
            payload_caret.ok_or_else(invalid)?
        } else if open_start {
            payload_caret.unwrap_or(prefix_caret)
        } else {
            payload_caret.unwrap_or_else(|| gap(parent.into(), insert_index))
        };
        set_caret(plan, caret)?;
    }
    Ok(CommandPresentation::default())
}
