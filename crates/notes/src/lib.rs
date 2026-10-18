// SPDX-License-Identifier: MIT OR Apache-2.0
//! Independent notes codec and registry-backed profile. No KWDJ or engine
//! dependency is present in the production closure. Registry schema validation
//! is authoritative; notes deliberately uses a metered full fallback on edits.
#![forbid(unsafe_code)]

mod borrowed;
mod codec;
mod commands;
mod error;
mod profile;
mod registration;
mod wire;

pub use commands::{INSERT_TEXT, NativeNotesIntent, SET_TAGS, SET_TITLE};
pub use error::{NotesError, NotesErrorCode};
pub use profile::{AdmittedNotes, NotesContext, NotesLimits, NotesProfile};
pub use registration::base_registration;

pub const PROFILE_ID: &str = "org.example.notes";
pub const VERSION: &str = "1.0.0";
pub const CODEC_ID: &str = "org.example.notes/json";
pub const BASE_EXTENSION: &str = "org.example.notes/base";
pub const DOCUMENT: &str = "org.example.notes/document";
pub const PARAGRAPH: &str = "org.example.notes/paragraph";
pub const TEXT: &str = "org.example.notes/text";
pub const HARD_BREAK: &str = "org.example.notes/hard_break";
