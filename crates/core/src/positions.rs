// SPDX-License-Identifier: MIT OR Apache-2.0
//! Coordinate units and boundary checks independent of a document profile.
//!
//! A typed offset identifies its unit, not an admitted position in a particular
//! string. Conversion and the tree owner must still validate the string/node.
//! Read-only scalar positions and user-command grapheme admission are separate.

use unicode_segmentation::{GraphemeCursor, GraphemeIncomplete, UnicodeSegmentation};

pub const SEGMENTATION_PACKAGE_VERSION: &str = "1.13.3";
pub const SEGMENTATION_UNICODE_VERSION: (u64, u64, u64) = unicode_segmentation::UNICODE_VERSION;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Utf8Offset(usize);

impl Utf8Offset {
    pub const fn new(value: usize) -> Self {
        Self(value)
    }

    pub const fn get(self) -> usize {
        self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Utf16Offset(usize);

impl Utf16Offset {
    pub const fn new(value: usize) -> Self {
        Self(value)
    }

    pub const fn get(self) -> usize {
        self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Affinity {
    Before,
    After,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Edge {
    Before,
    After,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Position<N> {
    Text {
        leaf: N,
        utf16: Utf16Offset,
        affinity: Affinity,
    },
    Child {
        parent: N,
        index: usize,
        affinity: Affinity,
    },
    Edge {
        node: N,
        side: Edge,
    },
}

impl<N: Copy> Position<N> {
    pub fn node(self) -> N {
        match self {
            Self::Text { leaf, .. } => leaf,
            Self::Child { parent, .. } => parent,
            Self::Edge { node, .. } => node,
        }
    }

    pub fn affinity(self) -> Affinity {
        match self {
            Self::Text { affinity, .. } | Self::Child { affinity, .. } => affinity,
            Self::Edge {
                side: Edge::Before, ..
            } => Affinity::Before,
            Self::Edge {
                side: Edge::After, ..
            } => Affinity::After,
        }
    }
}

/// Anchor/focus order is retained, including reverse selections.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Selection<N> {
    pub anchor: Position<N>,
    pub focus: Position<N>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PositionError {
    OutOfBounds,
    NotScalarBoundary,
    LoneSurrogate,
    NotGraphemeBoundary,
    MissingLeaf,
    DuplicateLeaf,
    ArithmeticOverflow,
    InvalidInlineSequence,
}

pub fn utf16_to_utf8(text: &str, offset: Utf16Offset) -> Result<Utf8Offset, PositionError> {
    let mut units = 0usize;
    for (bytes, scalar) in text.char_indices() {
        if units == offset.get() {
            return Ok(Utf8Offset::new(bytes));
        }
        units = units
            .checked_add(scalar.len_utf16())
            .ok_or(PositionError::ArithmeticOverflow)?;
        if offset.get() < units {
            return Err(PositionError::NotScalarBoundary);
        }
    }
    if units == offset.get() {
        Ok(Utf8Offset::new(text.len()))
    } else {
        Err(PositionError::OutOfBounds)
    }
}

pub fn utf8_to_utf16(text: &str, offset: Utf8Offset) -> Result<Utf16Offset, PositionError> {
    if offset.get() > text.len() {
        return Err(PositionError::OutOfBounds);
    }
    if !text.is_char_boundary(offset.get()) {
        return Err(PositionError::NotScalarBoundary);
    }
    let units = text[..offset.get()].chars().try_fold(0usize, |n, scalar| {
        n.checked_add(scalar.len_utf16())
            .ok_or(PositionError::ArithmeticOverflow)
    })?;
    Ok(Utf16Offset::new(units))
}

/// Strict transport decoding: never repairs a lone surrogate with U+FFFD.
pub fn decode_utf16(units: &[u16]) -> Result<String, PositionError> {
    String::from_utf16(units).map_err(|_| PositionError::LoneSurrogate)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BoundaryPolicy {
    Scalar,
    Grapheme,
}

/// Marks do not appear here: adjacent styled leaves share one logical sequence.
/// The tree owner emits a barrier for an inline atom, hard break or block edge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InlineSpan<'a, N> {
    Text { leaf: N, text: &'a str },
    Barrier,
}

/// Validates a leaf-local coordinate against borrowed adjacent inline spans.
/// GraphemeCursor receives disjoint, consistent borrowed chunks and can request
/// all necessary preceding context (including RI and ZWJ sequences). Text is
/// never concatenated or normalized, and empty marked leaves remain addressable.
pub fn validate_inline_boundary<N: Copy + Eq>(
    spans: &[InlineSpan<'_, N>],
    leaf: N,
    offset: Utf16Offset,
    policy: BoundaryPolicy,
) -> Result<Utf8Offset, PositionError> {
    let mut target = None;
    for (index, span) in spans.iter().enumerate() {
        if let InlineSpan::Text { leaf: id, text } = span
            && *id == leaf
        {
            if target.is_some() {
                return Err(PositionError::DuplicateLeaf);
            }
            target = Some((index, *text));
        }
    }
    let (index, text) = target.ok_or(PositionError::MissingLeaf)?;
    let local_bytes = utf16_to_utf8(text, offset)?;
    if policy == BoundaryPolicy::Scalar {
        return Ok(local_bytes);
    }
    let start = spans[..index]
        .iter()
        .rposition(|span| matches!(span, InlineSpan::Barrier))
        .map_or(0, |barrier| barrier + 1);
    let end = spans[index..]
        .iter()
        .position(|span| matches!(span, InlineSpan::Barrier))
        .map_or(spans.len(), |barrier| index + barrier);
    let mut length = 0usize;
    let mut absolute = None;
    let mut chunks = Vec::new();
    for (relative, span) in spans[start..end].iter().enumerate() {
        let InlineSpan::Text { text, .. } = span else {
            return Err(PositionError::InvalidInlineSequence);
        };
        if start + relative == index {
            absolute = Some(
                length
                    .checked_add(local_bytes.get())
                    .ok_or(PositionError::ArithmeticOverflow)?,
            );
        }
        if !text.is_empty() {
            chunks.push((length, *text));
        }
        length = length
            .checked_add(text.len())
            .ok_or(PositionError::ArithmeticOverflow)?;
    }
    let absolute = absolute.ok_or(PositionError::InvalidInlineSequence)?;
    if absolute == 0 || absolute == length {
        return Ok(local_bytes);
    }
    let &(chunk_start, chunk) = chunks
        .iter()
        .find(|(start, text)| *start <= absolute && absolute - *start < text.len())
        .ok_or(PositionError::InvalidInlineSequence)?;
    let mut cursor = GraphemeCursor::new(absolute, length, true);
    loop {
        match cursor.is_boundary(chunk, chunk_start) {
            Ok(true) => return Ok(local_bytes),
            Ok(false) => return Err(PositionError::NotGraphemeBoundary),
            Err(GraphemeIncomplete::PreContext(end)) => {
                let &(start, context) = chunks
                    .iter()
                    .rev()
                    .find(|(start, text)| *start < end && end - *start <= text.len())
                    .ok_or(PositionError::InvalidInlineSequence)?;
                let prefix = context
                    .get(..end - start)
                    .ok_or(PositionError::InvalidInlineSequence)?;
                cursor.provide_context(prefix, start);
            }
            Err(_) => return Err(PositionError::InvalidInlineSequence),
        }
    }
}

/// Pinned extended grapheme boundaries for logical navigation within one string.
pub fn grapheme_boundaries(text: &str) -> Result<Vec<Utf16Offset>, PositionError> {
    let mut result = vec![Utf16Offset::new(0)];
    let mut units = 0usize;
    for cluster in text.graphemes(true) {
        units = cluster.chars().try_fold(units, |count, scalar| {
            count
                .checked_add(scalar.len_utf16())
                .ok_or(PositionError::ArithmeticOverflow)
        })?;
        result.push(Utf16Offset::new(units));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn literal_adr003_coordinate_vectors_are_lossless_and_not_normalized() {
        // The complete frozen JSON intentionally contains lone-surrogate
        // rejection inputs, which serde_json must refuse. Read only the literal
        // text array as a streamed value; exercise rejected UTF-16 units below.
        let source = include_str!("../../../evidence/osr-59/position-vectors.json");
        let (_, text_array) = source.split_once("\"text\":").unwrap();
        let vectors = serde_json::Deserializer::from_str(text_array)
            .into_iter::<serde_json::Value>()
            .next()
            .unwrap()
            .unwrap();
        for vector in vectors.as_array().unwrap() {
            let text = vector["value"].as_str().unwrap();
            let utf16 = vector["utf16"].as_array().unwrap();
            let utf8 = vector["utf8"].as_array().unwrap();
            for (u16, u8) in utf16.iter().zip(utf8) {
                let u16 = Utf16Offset::new(u16.as_u64().unwrap() as usize);
                let u8 = Utf8Offset::new(u8.as_u64().unwrap() as usize);
                assert_eq!(utf16_to_utf8(text, u16), Ok(u8));
                assert_eq!(utf8_to_utf16(text, u8), Ok(u16));
            }
            let expected = vector["graphemes"]
                .as_array()
                .unwrap()
                .iter()
                .map(|n| Utf16Offset::new(n.as_u64().unwrap() as usize))
                .collect::<Vec<_>>();
            assert_eq!(grapheme_boundaries(text).unwrap(), expected);
            if let Some(rejected) = vector["rejectUtf16"].as_array() {
                for n in rejected {
                    assert_eq!(
                        utf16_to_utf8(text, Utf16Offset::new(n.as_u64().unwrap() as usize)),
                        Err(PositionError::NotScalarBoundary)
                    );
                }
            }
            if let Some(rejected) = vector["rejectUserEditOffsets"].as_array() {
                for n in rejected {
                    let offset = Utf16Offset::new(n.as_u64().unwrap() as usize);
                    let spans = [InlineSpan::Text { leaf: 1, text }];
                    assert!(
                        validate_inline_boundary(&spans, 1, offset, BoundaryPolicy::Scalar).is_ok()
                    );
                    assert_eq!(
                        validate_inline_boundary(&spans, 1, offset, BoundaryPolicy::Grapheme),
                        Err(PositionError::NotGraphemeBoundary)
                    );
                }
            }
        }
        assert_eq!(decode_utf16(&[0xd800]), Err(PositionError::LoneSurrogate));
        assert_eq!(
            decode_utf16(&[b'x' as u16, 0xdfff]),
            Err(PositionError::LoneSurrogate)
        );
        assert_eq!(decode_utf16(&[0xd83d, 0xdc69]).unwrap(), "👩");
        assert_eq!(
            utf8_to_utf16("Я", Utf8Offset::new(1)),
            Err(PositionError::NotScalarBoundary)
        );
        assert_eq!(
            utf16_to_utf8("", Utf16Offset::new(1)),
            Err(PositionError::OutOfBounds)
        );
    }

    #[test]
    fn cross_mark_chunks_keep_combining_zwj_and_regional_clusters_intact() {
        for (parts, refused) in [
            (vec!["e", "\u{301}"], vec![(0, 1), (1, 0)]),
            (
                vec!["👩", "🏽", "\u{200d}", "💻"],
                vec![(0, 2), (1, 0), (2, 0), (3, 0)],
            ),
            (
                vec!["🇷", "🇺", "🇫", "🇷"],
                vec![(0, 2), (1, 0), (2, 2), (3, 0)],
            ),
        ] {
            let spans = parts
                .iter()
                .enumerate()
                .map(|(leaf, text)| InlineSpan::Text { leaf, text })
                .collect::<Vec<_>>();
            for (leaf, at) in refused {
                assert!(
                    validate_inline_boundary(
                        &spans,
                        leaf,
                        Utf16Offset::new(at),
                        BoundaryPolicy::Scalar
                    )
                    .is_ok()
                );
                assert_eq!(
                    validate_inline_boundary(
                        &spans,
                        leaf,
                        Utf16Offset::new(at),
                        BoundaryPolicy::Grapheme
                    ),
                    Err(PositionError::NotGraphemeBoundary)
                );
            }
            assert_eq!(
                validate_inline_boundary(&spans, 0, Utf16Offset::new(0), BoundaryPolicy::Grapheme),
                Ok(Utf8Offset::new(0))
            );
        }
    }

    #[test]
    fn barriers_empty_leaves_and_ambiguous_targets_have_explicit_outcomes() {
        let spans = [
            InlineSpan::Text { leaf: 0, text: "e" },
            InlineSpan::Text { leaf: 1, text: "" },
            InlineSpan::Text {
                leaf: 2,
                text: "\u{301}",
            },
            InlineSpan::Barrier,
            InlineSpan::Text {
                leaf: 3,
                text: "\u{301}",
            },
        ];
        assert_eq!(
            validate_inline_boundary(&spans, 1, Utf16Offset::new(0), BoundaryPolicy::Grapheme),
            Err(PositionError::NotGraphemeBoundary)
        );
        assert_eq!(
            validate_inline_boundary(&spans, 3, Utf16Offset::new(0), BoundaryPolicy::Grapheme),
            Ok(Utf8Offset::new(0))
        );
        assert_eq!(
            validate_inline_boundary(&spans, 9, Utf16Offset::new(0), BoundaryPolicy::Scalar),
            Err(PositionError::MissingLeaf)
        );
        let duplicate = [
            InlineSpan::Text { leaf: 0, text: "" },
            InlineSpan::Text { leaf: 0, text: "" },
        ];
        assert_eq!(
            validate_inline_boundary(&duplicate, 0, Utf16Offset::new(0), BoundaryPolicy::Scalar),
            Err(PositionError::DuplicateLeaf)
        );
        let empty = [InlineSpan::Text { leaf: 0, text: "" }];
        assert_eq!(
            validate_inline_boundary(&empty, 0, Utf16Offset::new(0), BoundaryPolicy::Grapheme),
            Ok(Utf8Offset::new(0))
        );
    }

    #[test]
    fn borrowed_scalar_chunks_preserve_full_string_boundaries_and_context() {
        // Unlike the literal expectation test above, this checks the chunk
        // adapter against segmentation of the complete immutable string. It
        // exercises preceding-context requests across more than one leaf.
        for text in [
            "e\u{301}x",
            "👩🏽\u{200d}💻!",
            "🇷🇺🇫🇷🇦",
            "\u{915}\u{94d}\u{937}",
            "\r\nx",
            "aאבb",
        ] {
            let boundaries = grapheme_boundaries(text).unwrap();
            let pieces = text
                .char_indices()
                .map(|(start, scalar)| &text[start..start + scalar.len_utf8()])
                .collect::<Vec<_>>();
            let spans = pieces
                .iter()
                .enumerate()
                .map(|(leaf, text)| InlineSpan::Text { leaf, text })
                .collect::<Vec<_>>();
            let mut prefix = 0;
            for (leaf, piece) in pieces.iter().enumerate() {
                for local in [0, piece.encode_utf16().count()] {
                    let expected = boundaries.contains(&Utf16Offset::new(prefix + local));
                    assert_eq!(
                        validate_inline_boundary(
                            &spans,
                            leaf,
                            Utf16Offset::new(local),
                            BoundaryPolicy::Grapheme,
                        )
                        .is_ok(),
                        expected,
                        "{text:?}, leaf {leaf}, offset {local}"
                    );
                }
                prefix += piece.encode_utf16().count();
            }
        }
    }
}
