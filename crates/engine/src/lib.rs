//! Generic sessions, atomic validated dispatch and local position maps.
#![forbid(unsafe_code)]

pub mod identity;
pub mod mapping;
pub mod session;
pub mod transaction;
pub mod tree;

pub use identity::{NodeId, SessionKey};
pub use session::commands;
pub use session::commands::{
    CommandAvailability, CommandEffect, CommandError, CommandOutcome, CommandRequest,
};
pub use session::{AccessMode, Session, SessionError, SessionState, StateError};
pub use transaction::{
    CommitEvent, DispatchOutcome, JournalEntrySummary, JournalSummary, NodeRef, SelectionUpdate,
    Transaction, TransactionError, TransactionLimits,
};

pub const PACKAGE_VERSION: &str = env!("CARGO_PKG_VERSION");
/// The generic dependency is explicit; the engine never imports a concrete profile.
pub const CORE_PACKAGE_VERSION: &str = editor_core::PACKAGE_VERSION;
