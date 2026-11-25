// SPDX-License-Identifier: MIT OR Apache-2.0
//! Shared word and character counting over projected literary text.

use unicode_general_category::{GeneralCategory, get_general_category};

/// Unicode scalar-value count excluding Rust's complete `char::is_whitespace`
/// set. This deliberately does not claim grapheme-cluster semantics.
pub fn character_count(text: &str) -> u32 {
    text.chars().filter(|c| !c.is_whitespace()).count() as u32
}

/// Combining marks and soft hyphen continue an open word without starting one.
pub fn is_word_continuation(value: char) -> bool {
    matches!(
        get_general_category(value),
        GeneralCategory::NonspacingMark
            | GeneralCategory::SpacingMark
            | GeneralCategory::EnclosingMark
    ) || value == '\u{00AD}'
}

/// Unicode 16 assignment filter for the persisted alphanumeric word class.
/// Recheck scalar parity when changing the Rust Unicode data or category table.
pub fn is_pinned_alphanumeric(value: char) -> bool {
    value.is_alphanumeric() && get_general_category(value) != GeneralCategory::Unassigned
}

/// Russian-prose-aware word count for projected literary text.
///
/// A word starts at a Unicode letter or digit. An apostrophe or hyphen joins
/// two adjacent alphanumeric runs (`из-за`, `д'Артаньян`); other punctuation,
/// including an em dash, is a boundary even without surrounding whitespace.
/// A combining mark or a soft hyphen continues the open word
/// ([`is_word_continuation`]), so `замо́к`, `сло­во` and decomposed `cafés`
/// are one word each, while zero-width characters stay boundaries.
pub fn word_count(text: &str) -> u32 {
    let chars: Vec<char> = text.chars().collect();
    let mut count = 0_u32;
    let mut in_word = false;
    for (index, value) in chars.iter().copied().enumerate() {
        if is_pinned_alphanumeric(value) {
            if !in_word {
                count = count.saturating_add(1);
            }
            in_word = true;
        } else if in_word && is_word_continuation(value) {
            // Mark or soft hyphen keeps the current word open.
        } else if in_word
            && matches!(value, '\'' | '’' | '-' | '‑')
            && chars
                .get(index + 1)
                .is_some_and(|next| is_pinned_alphanumeric(*next))
        {
            // Connector remains part of the current word.
        } else {
            in_word = false;
        }
    }
    count
}
