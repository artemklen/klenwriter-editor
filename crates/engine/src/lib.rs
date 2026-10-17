//! Generic session foundation. Validated dispatch and history follow in OSR-34/36.
#![forbid(unsafe_code)]

pub mod identity;
pub mod mapping;
pub mod session;
pub mod tree;

pub use identity::{NodeId, SessionKey};
pub use session::{AccessMode, Session, SessionError, SessionState, StateError};

pub const PACKAGE_VERSION: &str = env!("CARGO_PKG_VERSION");
/// The generic dependency is explicit; the engine never imports a concrete profile.
pub const CORE_PACKAGE_VERSION: &str = editor_core::PACKAGE_VERSION;
