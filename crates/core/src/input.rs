// SPDX-License-Identifier: MIT OR Apache-2.0
//! Closed, profile-neutral data for one atomic input replacement.
//! These values are explicit edit descriptions, never authentication tokens.

use crate::commands::LocalRef;
use crate::document::{Attributes, Mark};
use crate::positions::{Selection, Utf16Offset};

pub const INPUT_RESULT_BYTES: usize = 16 * 1024;
pub const INPUT_RESTORE_BYTES: usize = 4096;
pub const INPUT_TEXT_BYTES: usize = 12;
pub const INPUT_TEXT_RUNS: usize = 12;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputOrigin {
    OrdinaryInsertText,
    CompositionCommit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputCommandPolicy {
    AllowRules,
    LiteralOnly,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InputOriginal<I> {
    pub origin: InputOrigin,
    pub selection: Selection<I>,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InputSourceRegion<I> {
    pub block: I,
    pub range: Selection<I>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InputTextRun {
    pub type_id: String,
    pub attributes: Attributes,
    pub marks: Vec<Mark>,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawInputRestorePlan {
    pub raw: Vec<InputTextRun>,
    pub raw_caret_utf16: Utf16Offset,
    pub raw_stored_marks: Option<Vec<Mark>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextReplacementPlan<I> {
    pub original: InputOriginal<I>,
    pub before: InputSourceRegion<I>,
    /// Coordinates after all user operations, before normalization. Created
    /// references are resolved by the engine, not guessed by a profile or DOM.
    pub after_range: Selection<LocalRef<I>>,
    pub raw_restore: Option<RawInputRestorePlan>,
}
