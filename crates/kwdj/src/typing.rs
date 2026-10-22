// SPDX-License-Identifier: MIT OR Apache-2.0
//! Immutable opt-in KWDJ input policy. This is never import normalization.
//! RU predicates are independently ported from the owner-granted CMS baseline;
//! see contracts/typography/v1/provenance.json and docs/typography.md.

use editor_core::commands::InputTextRun;
use editor_core::document::{Attributes, Mark};
use editor_core::positions::{Selection, Utf16Offset};
use editor_core::transaction::WorkLimits;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Locale {
    Ru,
    En,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Feature {
    SpacedEmDash,
    DoubleQuotes,
    CyrillicNbsp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TypingLimits {
    pub lookbehind_scalars: u32,
    pub inline_slots: u32,
    pub ancestor_depth: u32,
    pub selected_scalars: u32,
    pub selected_utf8: u32,
    pub selected_nodes: u32,
    pub mark_records: u32,
    pub work_units: u32,
    pub work_bytes: u32,
    pub restoration_bytes: u32,
}
impl Default for TypingLimits {
    fn default() -> Self {
        Self {
            lookbehind_scalars: 3,
            inline_slots: 32,
            ancestor_depth: 32,
            selected_scalars: 4096,
            selected_utf8: 16384,
            selected_nodes: 256,
            mark_records: 1024,
            work_units: 32768,
            work_bytes: 65536,
            restoration_bytes: 4096,
        }
    }
}
impl TypingLimits {
    pub fn valid(self) -> bool {
        let hard = Self::default();
        self.values()
            .into_iter()
            .zip(hard.values())
            .all(|((_, requested), (_, maximum))| requested <= maximum)
    }
    pub fn values(self) -> [(&'static str, u32); 10] {
        [
            ("lookbehind_scalars", self.lookbehind_scalars),
            ("inline_slots", self.inline_slots),
            ("ancestor_depth", self.ancestor_depth),
            ("selected_scalars", self.selected_scalars),
            ("selected_utf8", self.selected_utf8),
            ("selected_nodes", self.selected_nodes),
            ("mark_records", self.mark_records),
            ("work_units", self.work_units),
            ("work_bytes", self.work_bytes),
            ("restoration_bytes", self.restoration_bytes),
        ]
    }
    pub fn work(self) -> WorkLimits {
        WorkLimits {
            units: self.work_units.into(),
            bytes: self.work_bytes.into(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TypingRules {
    locale: Locale,
    features: [bool; 3],
    limits: TypingLimits,
}
impl TypingRules {
    /// Closed feature sets are canonicalized before the profile is mounted.
    pub fn new(locale: Locale, features: Option<&[Feature]>, limits: TypingLimits) -> Option<Self> {
        if !limits.valid() {
            return None;
        }
        let mut selected = [false; 3];
        if let Some(features) = features {
            for feature in features {
                let index = *feature as usize;
                if selected[index] || locale == Locale::En && *feature == Feature::CyrillicNbsp {
                    return None;
                }
                selected[index] = true;
            }
        } else {
            selected = [true, true, locale == Locale::Ru];
        }
        Some(Self {
            locale,
            features: selected,
            limits,
        })
    }
    pub fn locale(self) -> Locale {
        self.locale
    }
    pub fn enabled(self, feature: Feature) -> bool {
        self.features[feature as usize]
    }
    pub fn limits(self) -> TypingLimits {
        self.limits
    }
    pub fn feature_names(self) -> Vec<&'static str> {
        ["spaced_em_dash", "double_quotes", "cyrillic_nbsp"]
            .into_iter()
            .zip(self.features)
            .filter_map(|(name, enabled)| enabled.then_some(name))
            .collect()
    }
    pub(crate) fn quotes(self) -> (char, char) {
        match self.locale {
            Locale::Ru => ('«', '»'),
            Locale::En => ('“', '”'),
        }
    }
}

/// Native domain decode of the closed compact descriptor. Full request stamps
/// are checked by the bridge/engine; there is no global receipt/auth token.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RestoreSpan<I> {
    pub node: I,
    pub from_utf16: Utf16Offset,
    pub to_utf16: Utf16Offset,
    pub type_id: String,
    pub attributes: Attributes,
    pub marks: Vec<Mark>,
    pub text: String,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Restore<I> {
    pub selection: Selection<I>,
    pub stored_marks: Option<Vec<Mark>>,
    pub block: I,
    pub range: Selection<I>,
    pub cooked: Vec<RestoreSpan<I>>,
    pub raw: Vec<InputTextRun>,
    pub raw_caret_utf16: Utf16Offset,
    pub raw_stored_marks: Option<Vec<Mark>>,
    /// Exact serialized closed descriptor size measured before domain decode.
    pub serialized_bytes: usize,
}

/// ECMAScript WhiteSpace ∪ LineTerminator, frozen from primary source tables.
/// Rust's Unicode whitespace predicate has a different U+0085/FEFF policy.
pub(crate) fn whitespace(ch: char) -> bool {
    matches!(ch, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}'
        | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}'
        | '\u{205f}' | '\u{3000}' | '\u{feff}')
}
pub(crate) fn cyrillic(ch: char) -> bool {
    matches!(ch, 'А'..='Я' | 'а'..='я' | 'Ё' | 'ё')
}
pub(crate) fn opening(ch: char) -> bool {
    whitespace(ch) || matches!(ch, '(' | '[' | '{' | '—' | '–' | '-' | '/' | '\u{fffc}')
}
