// SPDX-License-Identifier: MIT OR Apache-2.0
//! Independent notes wire adapter. The generic bridge owns Session semantics;
//! this crate owns only notes command payloads, options and compiled factory.
#![forbid(unsafe_code)]

mod adapter;
mod factory;
mod options;

pub use adapter::NotesAdapter;
pub use factory::NotesFactory;
pub use options::{NotesLimitsV2, NotesOptionsV2};
