//! Generic document boundary, independent of codecs, hosts and browser runtimes.
#![forbid(unsafe_code)]

/// Artifact identity only; not a document codec or session API version.
pub const PACKAGE_VERSION: &str = env!("CARGO_PKG_VERSION");

pub mod document;
pub mod json;
pub mod limits;
