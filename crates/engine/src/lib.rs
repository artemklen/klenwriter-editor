//! Generic editing-engine boundary. Session/transaction implementation is OSR-33+.
#![forbid(unsafe_code)]

pub const PACKAGE_VERSION: &str = env!("CARGO_PKG_VERSION");
/// The generic dependency is explicit; the engine never imports a concrete profile.
pub const CORE_PACKAGE_VERSION: &str = editor_core::PACKAGE_VERSION;
