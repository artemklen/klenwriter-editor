//! KWDJ profile boundary. Codecs and normative semantics are delivered in OSR-29/30.
#![forbid(unsafe_code)]

pub const PROFILE_ID: &str = "org.klenwriter.kwdj";
pub const PACKAGE_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const CORE_PACKAGE_VERSION: &str = editor_core::PACKAGE_VERSION;
