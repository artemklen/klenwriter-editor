// SPDX-License-Identifier: MIT OR Apache-2.0
//! Trusted, bounded native input rules. One final splice; never a DOM repair.

use super::inline;
use crate::typing::{Feature, Restore, TypingLimits, TypingRules, cyrillic, opening, whitespace};
use crate::{KwdjError, KwdjErrorCode, KwdjProfile, Profile};
use editor_core::admission::{PreflightBudget, preflight_node_fields};
use editor_core::candidate::CandidateRead;
use editor_core::commands::{
    CommandPresentation, CommandState, InputCommandPolicy, InputOrigin, InputOriginal,
    InputSourceRegion, InputTextRun, LocalRef, PlanBuilder, RawInputRestorePlan, SelectionIntent,
    StoredMarksUpdate, TextReplacementPlan,
};
use editor_core::document::{Attributes, Document, Mark, Node, Primitive};
use editor_core::positions::{Affinity, Position, Selection, Utf16Offset, utf16_to_utf8};
use editor_core::transaction::{Operation, WorkMeter};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Bypass {
    Disabled,
    Bulk,
    Protected,
    CrossBlock,
    Limit,
    NoMatch,
    ForcedLiteral,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Transformed(Feature),
    Literal(Bypass),
}

fn invalid() -> KwdjError {
    KwdjError::new(KwdjErrorCode::CommandInvalidTarget, "/input")
}
fn local(kind: &str) -> &str {
    kind.strip_prefix("org.klenwriter.kwdj/").unwrap_or(kind)
}
fn charge(work: &mut WorkMeter, units: usize, bytes: usize) -> Result<(), KwdjError> {
    work.charge_units(units as u64)
        .map_err(KwdjError::operational)?;
    work.charge_bytes(bytes as u64)
        .map_err(KwdjError::operational)
}
enum ScanError {
    Bypass(Bypass),
    Hard(KwdjError),
}
impl From<KwdjError> for ScanError {
    fn from(error: KwdjError) -> Self {
        Self::Hard(error)
    }
}
type Scan<T> = Result<T, ScanError>;
fn restore_scan_error(error: ScanError) -> KwdjError {
    match error {
        ScanError::Hard(error) => error,
        ScanError::Bypass(_) => invalid(),
    }
}
fn cap(ok: bool) -> Scan<()> {
    if ok {
        Ok(())
    } else {
        Err(ScanError::Bypass(Bypass::Limit))
    }
}
fn protected(
    marks: &[Mark],
    seen: &mut usize,
    limits: TypingLimits,
    work: &mut WorkMeter,
) -> Scan<bool> {
    for mark in marks {
        *seen += 1;
        cap(*seen <= limits.mark_records as usize)?;
        charge(work, 1, mark.type_id.len())?;
        if matches!(local(&mark.type_id), "code" | "link" | "reference_link") {
            return Ok(true);
        }
    }
    Ok(false)
}

#[derive(Clone, Copy)]
struct Character<'a, I> {
    ch: char,
    at: Position<I>,
    marks: &'a [Mark],
}
struct Prefix<'a, I> {
    chars: [Option<Character<'a, I>>; 3],
    len: usize,
    start: bool,
}
impl<'a, I: Copy> Prefix<'a, I> {
    fn get(&self, index: usize) -> Option<Character<'a, I>> {
        self.chars.get(index).copied().flatten()
    }
}
fn predecessor<'a, V: CandidateRead>(
    view: &'a V,
    point: inline::TextPoint<V::Id>,
    first_byte: usize,
    need: usize,
    limits: TypingLimits,
    seen: &mut usize,
    work: &mut WorkMeter,
) -> Scan<Prefix<'a, V::Id>> {
    let block = view.node(point.block).ok_or_else(invalid)?;
    let mut out = Prefix {
        chars: [None; 3],
        len: 0,
        start: false,
    };
    let mut index = point.index;
    let mut leaf = point.leaf;
    let mut byte = first_byte;
    let mut offset = point.utf16.get();
    let mut slots = 0usize;
    loop {
        if let Some(id) = leaf {
            let node = view.node(id).ok_or_else(invalid)?;
            let text = node.text.ok_or_else(invalid)?;
            while byte > 0 && out.len < need {
                cap(out.len < limits.lookbehind_scalars as usize)?;
                charge(work, 1, 4)?;
                let (at, ch) = text[..byte]
                    .char_indices()
                    .next_back()
                    .ok_or_else(invalid)?;
                if protected(node.marks, seen, limits, work)? {
                    return Err(ScanError::Bypass(Bypass::Protected));
                }
                offset = offset.checked_sub(ch.len_utf16()).ok_or_else(invalid)?;
                out.chars[out.len] = Some(Character {
                    ch,
                    at: Position::Text {
                        leaf: id,
                        utf16: Utf16Offset::new(offset),
                        affinity: Affinity::After,
                    },
                    marks: node.marks,
                });
                out.len += 1;
                byte = at;
            }
            if out.len == need {
                return Ok(out);
            }
        }
        if index == 0 {
            out.start = true;
            return Ok(out);
        }
        slots += 1;
        cap(slots <= limits.inline_slots as usize)?;
        index -= 1;
        charge(work, 1, 0)?;
        let id = *block.children.get(index).ok_or_else(invalid)?;
        let node = view.node(id).ok_or_else(invalid)?;
        if node.primitive != Primitive::Text {
            if matches!(node.primitive, Primitive::HardBreak | Primitive::InlineAtom) {
                cap(out.len < limits.lookbehind_scalars as usize)?;
                if protected(node.marks, seen, limits, work)? {
                    return Err(ScanError::Bypass(Bypass::Protected));
                }
                out.chars[out.len] = Some(Character {
                    ch: '\u{fffc}',
                    at: Position::Child {
                        parent: point.block,
                        index: index + 1,
                        affinity: Affinity::After,
                    },
                    marks: &[],
                });
                out.len += 1;
                return Ok(out);
            }
            return Err(ScanError::Bypass(Bypass::Protected));
        }
        let text = node.text.ok_or_else(invalid)?;
        charge(work, 1, text.len())?;
        offset = text.encode_utf16().count();
        byte = text.len();
        leaf = Some(id);
    }
}

#[derive(Clone, Copy)]
struct Piece<'a> {
    ch: char,
    marks: &'a [Mark],
}
struct Rewrite<'a, I> {
    feature: Feature,
    range: Selection<I>,
    cooked: [Option<Piece<'a>>; 2],
    raw: [Option<Piece<'a>>; 3],
    raw_len: usize,
}
fn metadata_bound<'a>(
    pieces: impl Iterator<Item = Piece<'a>>,
    stored: Option<&[Mark]>,
    work: &mut WorkMeter,
) -> Scan<usize> {
    // Conservative escaped-wire envelope reserve. Count before any ownership;
    // actual final descriptor is independently checked by the generic engine.
    let mut total = 1024usize;
    let empty = Attributes::new();
    for piece in pieces {
        let mut encoded = [0u8; 4];
        let text = piece.ch.encode_utf8(&mut encoded);
        // Reserve the bounded walk before it starts, including a walk that
        // refuses. A local representation bypass must retain this spent work.
        charge(work, 512, 4096)?;
        let usage = preflight_node_fields(
            "org.klenwriter.kwdj/text",
            Some(text),
            &empty,
            piece.marks,
            0,
            PreflightBudget {
                payload_bytes: 4096,
                values: 512,
                depth: 8,
            },
        )
        .map_err(|_| ScanError::Bypass(Bypass::Limit))?;
        total = total
            .saturating_add((usage.payload_bytes as usize).saturating_mul(6))
            .saturating_add(160);
    }
    if let Some(marks) = stored {
        charge(work, 512, 4096)?;
        let usage = preflight_node_fields(
            "",
            None,
            &empty,
            marks,
            0,
            PreflightBudget {
                payload_bytes: 4096,
                values: 512,
                depth: 8,
            },
        )
        .map_err(|_| ScanError::Bypass(Bypass::Limit))?;
        total = total
            .saturating_add((usage.payload_bytes as usize).saturating_mul(12))
            .saturating_add(128);
    }
    Ok(total)
}

// The borrowed original range and both already-admitted endpoints are kept
// explicit here; no alternate snapshot or copied matcher context is built.
#[allow(clippy::too_many_arguments)]
fn scan<'a, V: CandidateRead>(
    rules: TypingRules,
    view: &'a V,
    state: CommandState<'a, V::Id>,
    range: &inline::OrderedRange<V::Id>,
    start: inline::TextPoint<V::Id>,
    end: inline::TextPoint<V::Id>,
    first_byte: usize,
    ch: char,
    marks: &'a [Mark],
    work: &mut WorkMeter,
) -> Scan<Option<Rewrite<'a, V::Id>>> {
    let limits = rules.limits();
    let mut seen = 0;
    if protected(marks, &mut seen, limits, work)? {
        return Err(ScanError::Bypass(Bypass::Protected));
    }
    // Explicit empty stored marks change insertion style, not protection of
    // the original current leaf at an admitted zero-width endpoint.
    for id in [start.leaf, end.leaf].into_iter().flatten() {
        charge(work, 1, 0)?;
        if protected(
            view.node(id).ok_or_else(invalid)?.marks,
            &mut seen,
            limits,
            work,
        )? {
            return Err(ScanError::Bypass(Bypass::Protected));
        }
    }
    if let Some(stored) = state.stored_marks
        && protected(stored, &mut seen, limits, work)?
    {
        return Err(ScanError::Bypass(Bypass::Protected));
    }
    let mut parent = start.block;
    let mut depth = 0usize;
    while parent != view.root() {
        depth += 1;
        cap(depth <= limits.ancestor_depth as usize)?;
        charge(work, 1, 0)?;
        let node = view.node(parent).ok_or_else(invalid)?;
        if local(node.type_id) == "code_block" {
            return Err(ScanError::Bypass(Bypass::Protected));
        }
        parent = node.parent;
    }
    let block = view.node(start.block).ok_or_else(invalid)?;
    let stop = end.index + usize::from(end.leaf.is_some() && end.utf16.get() > 0);
    for id in block.children.iter().take(stop).skip(start.index) {
        charge(work, 1, 0)?;
        if view.node(*id).ok_or_else(invalid)?.primitive != Primitive::Text {
            return Err(ScanError::Bypass(Bypass::Protected));
        }
    }
    cap(range.spans.len() <= limits.selected_nodes as usize)?;
    let mut selected_bytes = 0usize;
    let mut selected_scalars = 0usize;
    for span in &range.spans {
        let node = view.node(span.leaf).ok_or_else(invalid)?;
        if protected(node.marks, &mut seen, limits, work)? {
            return Err(ScanError::Bypass(Bypass::Protected));
        }
        let text = node.text.ok_or_else(invalid)?;
        charge(work, 1, text.len().saturating_mul(2))?;
        let a = utf16_to_utf8(text, span.from).map_err(|_| invalid())?.get();
        let b = utf16_to_utf8(text, span.to).map_err(|_| invalid())?.get();
        selected_bytes += b - a;
        cap(selected_bytes <= limits.selected_utf8 as usize)?;
        for _ in text[a..b].chars() {
            charge(work, 1, 4)?;
            selected_scalars += 1;
            cap(selected_scalars <= limits.selected_scalars as usize)?;
        }
    }
    let need = if ch == '"' { 1 } else { 3 };
    let prefix = predecessor(view, start, first_byte, need, limits, &mut seen, work)?;
    let trigger = Piece { ch, marks };
    let mut rewrite = None;
    if rules.enabled(Feature::SpacedEmDash)
        && whitespace(ch)
        && prefix.get(0).is_some_and(|c| c.ch == '-')
        && prefix.get(1).is_some_and(|c| c.ch == '-')
        && prefix.get(2).is_some_and(|c| whitespace(c.ch))
    {
        let first = prefix.get(1).unwrap();
        let second = prefix.get(0).unwrap();
        rewrite = Some(Rewrite {
            feature: Feature::SpacedEmDash,
            range: Selection {
                anchor: first.at,
                focus: range.end,
            },
            cooked: [
                Some(Piece {
                    ch: '—',
                    marks: first.marks,
                }),
                Some(trigger),
            ],
            raw: [
                Some(Piece {
                    ch: '-',
                    marks: first.marks,
                }),
                Some(Piece {
                    ch: '-',
                    marks: second.marks,
                }),
                Some(trigger),
            ],
            raw_len: 3,
        });
    } else if rules.enabled(Feature::DoubleQuotes) && ch == '"' {
        let (open, close) = rules.quotes();
        let cooked =
            if prefix.get(0).is_some_and(|c| opening(c.ch)) || prefix.len == 0 && prefix.start {
                open
            } else {
                close
            };
        rewrite = Some(Rewrite {
            feature: Feature::DoubleQuotes,
            range: Selection {
                anchor: range.start,
                focus: range.end,
            },
            cooked: [Some(Piece { ch: cooked, marks }), None],
            raw: [Some(trigger), None, None],
            raw_len: 1,
        });
    } else if rules.enabled(Feature::CyrillicNbsp)
        && cyrillic(ch)
        && prefix.get(0).is_some_and(|c| c.ch == ' ')
        && prefix.get(1).is_some_and(|c| cyrillic(c.ch))
        && (prefix
            .get(2)
            .is_some_and(|c| whitespace(c.ch) || c.ch == '\u{fffc}')
            || prefix.len == 2 && prefix.start)
    {
        let space = prefix.get(0).unwrap();
        rewrite = Some(Rewrite {
            feature: Feature::CyrillicNbsp,
            range: Selection {
                anchor: space.at,
                focus: range.end,
            },
            cooked: [
                Some(Piece {
                    ch: '\u{00a0}',
                    marks: space.marks,
                }),
                Some(trigger),
            ],
            raw: [None; 3],
            raw_len: 0,
        });
    }
    if let Some(ref rewrite) = rewrite {
        let metadata = metadata_bound(
            rewrite.cooked.iter().chain(&rewrite.raw).filter_map(|p| *p),
            state.stored_marks,
            work,
        )?;
        if rewrite.raw_len > 0 {
            cap(metadata <= limits.restoration_bytes as usize)?;
        }
    }
    Ok(rewrite)
}

fn run(
    piece: Piece<'_>,
    builder: &mut PlanBuilder<'_, impl Copy>,
) -> Result<InputTextRun, KwdjError> {
    let mut encoded = [0u8; 4];
    run_text(piece.ch.encode_utf8(&mut encoded), piece.marks, builder)
}
fn run_text(
    text: &str,
    marks: &[Mark],
    builder: &mut PlanBuilder<'_, impl Copy>,
) -> Result<InputTextRun, KwdjError> {
    let text = builder
        .charged_copy_text(text)
        .map_err(KwdjError::operational)?;
    let type_id = builder
        .charged_copy_text("org.klenwriter.kwdj/text")
        .map_err(KwdjError::operational)?;
    let marks = builder
        .charged_copy_marks(marks)
        .map_err(KwdjError::operational)?;
    Ok(InputTextRun {
        type_id,
        attributes: Attributes::new(),
        marks,
        text,
    })
}

pub fn prepare<V: CandidateRead>(
    rules: TypingRules,
    view: &V,
    state: CommandState<'_, V::Id>,
    text: &str,
    origin: InputOrigin,
    policy: InputCommandPolicy,
    builder: &mut PlanBuilder<'_, V::Id>,
) -> Result<CommandPresentation, KwdjError> {
    prepare_with_decision(rules, view, state, text, origin, policy, builder)
        .map(|(presentation, _)| presentation)
}

/// A native-only diagnostic return is useful to controlled contract witnesses;
/// the public wire deliberately represents all literal paths with result:null.
pub fn prepare_with_decision<V: CandidateRead>(
    rules: TypingRules,
    view: &V,
    state: CommandState<'_, V::Id>,
    text: &str,
    origin: InputOrigin,
    policy: InputCommandPolicy,
    builder: &mut PlanBuilder<'_, V::Id>,
) -> Result<(CommandPresentation, Decision), KwdjError> {
    let literal = |reason, builder: &mut PlanBuilder<'_, V::Id>| {
        inline::insert_text(view, state, text, builder).map(|p| (p, Decision::Literal(reason)))
    };
    if policy == InputCommandPolicy::LiteralOnly {
        return literal(Bypass::ForcedLiteral, builder);
    }
    let mut chars = text.chars();
    let Some(ch) = chars.next() else {
        return literal(Bypass::Bulk, builder);
    };
    if chars.next().is_some() {
        return literal(Bypass::Bulk, builder);
    }
    if !(rules.enabled(Feature::DoubleQuotes) && ch == '"'
        || rules.enabled(Feature::SpacedEmDash) && whitespace(ch)
        || rules.enabled(Feature::CyrillicNbsp) && cyrillic(ch))
    {
        return literal(Bypass::NoMatch, builder);
    }
    let selection = state.selection.copied().ok_or_else(invalid)?;
    // Existing target ordering/UTF16 admission remains charged native work;
    // this does not claim total typing is O(the tiny lexical lookbehind).
    let range = inline::ordered_range(view, selection, builder.work())?;
    let start = inline::text_point(view, range.start, builder.work())?;
    let end = inline::text_point(view, range.end, builder.work())?;
    if start.block != end.block {
        return literal(Bypass::CrossBlock, builder);
    }
    let insertion = if range.is_empty {
        selection.focus
    } else {
        range.start
    };
    let marks = inline::caret_marks(view, state, insertion, builder.work())?;
    let first_byte = if let Some(id) = start.leaf {
        let node = view.node(id).ok_or_else(invalid)?;
        let text = node.text.ok_or_else(invalid)?;
        charge(builder.work(), 1, text.len())?;
        utf16_to_utf8(text, start.utf16)
            .map_err(|_| invalid())?
            .get()
    } else {
        0
    };
    let enclosing = builder.work().limits();
    let result = builder.work().with_budget(rules.limits().work(), |work| {
        scan(
            rules, view, state, &range, start, end, first_byte, ch, marks, work,
        )
    });
    let rewrite = match result {
        Ok(Some(rewrite)) => rewrite,
        Ok(None) => return literal(Bypass::NoMatch, builder),
        Err(ScanError::Bypass(reason)) => return literal(reason, builder),
        Err(ScanError::Hard(error)) => {
            let optional = match (error.context.limit, error.context.maximum) {
                (Some("transaction_work"), Some(max)) => max < enclosing.units,
                (Some("transaction_bytes"), Some(max)) => max < enclosing.bytes,
                _ => false,
            };
            if optional {
                return literal(Bypass::Limit, builder);
            }
            return Err(error);
        }
    };
    let count = rewrite.cooked.iter().flatten().count();
    charge(builder.work(), count, count * std::mem::size_of::<Node>())?;
    let mut inserted = Vec::with_capacity(count);
    for piece in rewrite.cooked.into_iter().flatten() {
        let value = run(piece, builder)?;
        inserted.push(Node {
            type_id: value.type_id,
            primitive: Primitive::Text,
            attributes: value.attributes,
            marks: value.marks,
            text: Some(value.text),
            children: vec![],
        });
    }
    let operation = builder
        .push(Operation::ReplaceInlineFragment {
            range: inline::map_selection(rewrite.range),
            fragment: Document { children: inserted },
        })
        .map_err(KwdjError::operational)?;
    charge(builder.work(), 4, 4 * std::mem::size_of::<usize>())?;
    let first = Position::Text {
        leaf: LocalRef::Created {
            operation,
            path: vec![0],
        },
        utf16: Utf16Offset::new(0),
        affinity: Affinity::After,
    };
    let last_piece_units = rewrite
        .cooked
        .iter()
        .flatten()
        .last()
        .unwrap()
        .ch
        .len_utf16();
    let last = Position::Text {
        leaf: LocalRef::Created {
            operation,
            path: vec![count - 1],
        },
        utf16: Utf16Offset::new(last_piece_units),
        affinity: Affinity::After,
    };
    builder
        .set_selection(SelectionIntent::MapFromUserResult(Some(Selection {
            anchor: last.clone(),
            focus: last.clone(),
        })))
        .map_err(KwdjError::operational)?;
    let raw_restore = if rewrite.raw_len > 0 {
        charge(
            builder.work(),
            rewrite.raw_len,
            rewrite.raw_len * std::mem::size_of::<InputTextRun>(),
        )?;
        let mut raw = Vec::with_capacity(rewrite.raw_len);
        let mut caret = 0;
        let mut group: Option<&[Mark]> = None;
        let mut encoded = [0u8; 12];
        let mut length = 0;
        for piece in rewrite.raw.into_iter().flatten() {
            caret += piece.ch.len_utf16();
            let same_marks = if let Some(marks) = group {
                // Both metadata walks already passed the fixed8/512/4096
                // preflight. Reserve their comparison before visiting values.
                charge(builder.work(), 1024, 8192)?;
                marks == piece.marks
            } else {
                false
            };
            if !same_marks && let Some(marks) = group {
                charge(builder.work(), 1, length)?;
                let text = std::str::from_utf8(&encoded[..length]).map_err(|_| invalid())?;
                raw.push(run_text(text, marks, builder)?);
                length = 0;
            }
            group = Some(piece.marks);
            let mut scalar = [0u8; 4];
            let text = piece.ch.encode_utf8(&mut scalar);
            charge(builder.work(), 1, text.len())?;
            encoded[length..length + text.len()].copy_from_slice(text.as_bytes());
            length += text.len();
        }
        if let Some(marks) = group {
            charge(builder.work(), 1, length)?;
            let text = std::str::from_utf8(&encoded[..length]).map_err(|_| invalid())?;
            raw.push(run_text(text, marks, builder)?);
        }
        let raw_stored_marks = state
            .stored_marks
            .map(|marks| builder.charged_copy_marks(marks))
            .transpose()
            .map_err(KwdjError::operational)?;
        Some(RawInputRestorePlan {
            raw,
            raw_caret_utf16: Utf16Offset::new(caret),
            raw_stored_marks,
        })
    } else {
        None
    };
    let original_text = builder
        .charged_copy_text(text)
        .map_err(KwdjError::operational)?;
    builder
        .set_input_result(TextReplacementPlan {
            original: InputOriginal {
                origin,
                selection,
                text: original_text,
            },
            before: InputSourceRegion {
                block: start.block,
                range: rewrite.range,
            },
            after_range: Selection {
                anchor: first,
                focus: last,
            },
            raw_restore,
        })
        .map_err(KwdjError::operational)?;
    Ok((
        CommandPresentation::default(),
        Decision::Transformed(rewrite.feature),
    ))
}

pub fn restore<V: CandidateRead>(
    profile: &KwdjProfile<'_>,
    _context: Profile,
    rules: TypingRules,
    view: &V,
    state: CommandState<'_, V::Id>,
    restore: &Restore<V::Id>,
    builder: &mut PlanBuilder<'_, V::Id>,
) -> Result<CommandPresentation, KwdjError> {
    if restore.serialized_bytes > rules.limits().restoration_bytes as usize
        || restore.cooked.is_empty()
        || restore.cooked.len() > 12
        || restore.raw.is_empty()
        || restore.raw.len() > 12
    {
        return Err(invalid());
    }
    // Bound and charge untrusted metadata before equality, canonicalization or
    // fragment ownership. The wire's early preflight is not native authority.
    let mut payload = 0u64;
    let mut values = 0u64;
    for (kind, attrs, marks, text) in restore
        .cooked
        .iter()
        .map(|s| {
            (
                s.type_id.as_str(),
                &s.attributes,
                s.marks.as_slice(),
                s.text.as_str(),
            )
        })
        .chain(restore.raw.iter().map(|s| {
            (
                s.type_id.as_str(),
                &s.attributes,
                s.marks.as_slice(),
                s.text.as_str(),
            )
        }))
    {
        charge(
            builder.work(),
            (512 - values) as usize * 2 + 1,
            (4096 - payload) as usize * 2,
        )?;
        let usage = preflight_node_fields(
            kind,
            Some(text),
            attrs,
            marks,
            0,
            PreflightBudget {
                payload_bytes: 4096 - payload,
                values: 512 - values,
                depth: 8,
            },
        )
        .map_err(|_| invalid())?;
        payload += usage.payload_bytes;
        values += usage.values;
    }
    for marks in [
        restore.stored_marks.as_deref(),
        restore.raw_stored_marks.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        charge(
            builder.work(),
            (512 - values) as usize * 2 + 1,
            (4096 - payload) as usize * 2,
        )?;
        let usage = preflight_node_fields(
            "",
            None,
            &Attributes::new(),
            marks,
            0,
            PreflightBudget {
                payload_bytes: 4096 - payload,
                values: 512 - values,
                depth: 8,
            },
        )
        .map_err(|_| invalid())?;
        payload += usage.payload_bytes;
        values += usage.values;
    }
    if state.selection != Some(&restore.selection)
        || state.stored_marks != restore.stored_marks.as_deref()
        || restore.raw_stored_marks != restore.stored_marks
        || restore.selection.anchor != restore.selection.focus
        || restore.selection.focus != restore.range.focus
    {
        return Err(invalid());
    }
    let range = inline::ordered_range(view, restore.range, builder.work())?;
    let start = inline::text_point(view, range.start, builder.work())?;
    let end = inline::text_point(view, range.end, builder.work())?;
    if range.is_empty
        || restore.range
            != (Selection {
                anchor: range.start,
                focus: range.end,
            })
        || start.block != restore.block
        || end.block != restore.block
        || range.spans.len() != restore.cooked.len()
    {
        return Err(invalid());
    }
    let block = view.node(start.block).ok_or_else(invalid)?;
    if !matches!(local(block.type_id), "paragraph" | "heading" | "verse_line") {
        return Err(invalid());
    }
    let stop = end.index + usize::from(end.leaf.is_some() && end.utf16.get() > 0);
    for id in block.children.iter().take(stop).skip(start.index) {
        charge(builder.work(), 1, 0)?;
        if view.node(*id).ok_or_else(invalid)?.primitive != Primitive::Text {
            return Err(invalid());
        }
    }
    charge(builder.work(), 6, 6 * std::mem::size_of::<Piece<'_>>())?;
    let mut cooked = Vec::with_capacity(3);
    let mut raw_chars = Vec::with_capacity(3);
    let mut seen = 0;
    if let Some(marks) = state.stored_marks
        && protected(marks, &mut seen, rules.limits(), builder.work())
            .map_err(restore_scan_error)?
    {
        return Err(invalid());
    }
    let mut cooked_bytes = 0;
    let mut raw_bytes = 0;
    for (span, expected) in range.spans.iter().zip(&restore.cooked) {
        let node = view.node(span.leaf).ok_or_else(invalid)?;
        let text = node.text.ok_or_else(invalid)?;
        charge(builder.work(), 1, text.len().saturating_mul(2))?;
        let a = utf16_to_utf8(text, span.from).map_err(|_| invalid())?.get();
        let b = utf16_to_utf8(text, span.to).map_err(|_| invalid())?.get();
        if span.leaf != expected.node
            || span.from != expected.from_utf16
            || span.to != expected.to_utf16
            || text[a..b] != expected.text
            || node.type_id != expected.type_id
            || node.attributes != &expected.attributes
            || node.marks != expected.marks
        {
            return Err(invalid());
        }
        if protected(node.marks, &mut seen, rules.limits(), builder.work())
            .map_err(restore_scan_error)?
        {
            return Err(invalid());
        }
        cooked_bytes += b - a;
        if cooked_bytes > 12 {
            return Err(invalid());
        }
        for ch in text[a..b].chars() {
            charge(builder.work(), 1, 4)?;
            if cooked.len() == 3 {
                return Err(invalid());
            }
            cooked.push(Piece {
                ch,
                marks: node.marks,
            });
        }
    }
    let mut raw_units = 0;
    for run in &restore.raw {
        if run.text.is_empty()
            || run.type_id != "org.klenwriter.kwdj/text"
            || !run.attributes.is_empty()
        {
            return Err(invalid());
        }
        let canonical = crate::validate::canonical_command_marks(
            &run.marks,
            profile.identities(),
            profile.limits(),
            builder.work(),
        )?;
        if canonical != run.marks
            || protected(&run.marks, &mut seen, rules.limits(), builder.work())
                .map_err(restore_scan_error)?
        {
            return Err(invalid());
        }
        raw_bytes += run.text.len();
        if raw_bytes > 12 {
            return Err(invalid());
        }
        for ch in run.text.chars() {
            charge(builder.work(), 1, 4)?;
            if raw_chars.len() == 3 {
                return Err(invalid());
            }
            raw_units += ch.len_utf16();
            raw_chars.push(Piece {
                ch,
                marks: &run.marks,
            });
        }
    }
    if restore.raw_caret_utf16.get() != raw_units {
        return Err(invalid());
    }
    let quote = rules.enabled(Feature::DoubleQuotes)
        && cooked.len() == 1
        && raw_chars.len() == 1
        && raw_chars[0].ch == '"'
        && (cooked[0].ch == rules.quotes().0 || cooked[0].ch == rules.quotes().1)
        && cooked[0].marks == raw_chars[0].marks;
    let dash = rules.enabled(Feature::SpacedEmDash)
        && cooked.len() == 2
        && raw_chars.len() == 3
        && cooked[0].ch == '—'
        && whitespace(cooked[1].ch)
        && raw_chars[0].ch == '-'
        && raw_chars[1].ch == '-'
        && raw_chars[2].ch == cooked[1].ch
        && raw_chars[0].marks == cooked[0].marks
        && raw_chars[2].marks == cooked[1].marks;
    if !quote && !dash {
        return Err(invalid());
    }
    let metadata = metadata_bound(
        cooked.iter().chain(&raw_chars).copied(),
        state.stored_marks,
        builder.work(),
    )
    .map_err(restore_scan_error)?;
    if metadata > rules.limits().restoration_bytes as usize {
        return Err(invalid());
    }
    charge(
        builder.work(),
        restore.raw.len(),
        restore.raw.len() * std::mem::size_of::<Node>(),
    )?;
    let mut inserted = Vec::with_capacity(restore.raw.len());
    for raw in &restore.raw {
        inserted.push(Node {
            type_id: builder
                .charged_copy_text(&raw.type_id)
                .map_err(KwdjError::operational)?,
            primitive: Primitive::Text,
            attributes: Attributes::new(),
            marks: builder
                .charged_copy_marks(&raw.marks)
                .map_err(KwdjError::operational)?,
            text: Some(
                builder
                    .charged_copy_text(&raw.text)
                    .map_err(KwdjError::operational)?,
            ),
            children: vec![],
        });
    }
    let operation = builder
        .push(Operation::ReplaceInlineFragment {
            range: inline::map_selection(restore.range),
            fragment: Document { children: inserted },
        })
        .map_err(KwdjError::operational)?;
    charge(builder.work(), 2, 2 * std::mem::size_of::<usize>())?;
    let last = restore.raw.last().ok_or_else(invalid)?;
    let caret = Position::Text {
        leaf: LocalRef::Created {
            operation,
            path: vec![restore.raw.len() - 1],
        },
        utf16: Utf16Offset::new(last.text.encode_utf16().count()),
        affinity: Affinity::After,
    };
    builder
        .set_selection(SelectionIntent::MapFromUserResult(Some(Selection {
            anchor: caret.clone(),
            focus: caret,
        })))
        .map_err(KwdjError::operational)?;
    let update = restore
        .raw_stored_marks
        .as_ref()
        .map(|marks| {
            builder
                .charged_copy_marks(marks)
                .map(StoredMarksUpdate::Set)
        })
        .transpose()
        .map_err(KwdjError::operational)?
        .unwrap_or(StoredMarksUpdate::Inherit);
    builder
        .set_stored_marks(update)
        .map_err(KwdjError::operational)?;
    Ok(CommandPresentation::default())
}
