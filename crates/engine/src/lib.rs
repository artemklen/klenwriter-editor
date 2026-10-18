//! Generic sessions, atomic validated dispatch and local position maps.
#![forbid(unsafe_code)]

pub mod events;
mod grouping;
pub mod history;
pub mod identity;
pub mod mapping;
pub mod session;
pub mod snapshot;
pub mod transaction;
pub mod tree;

pub use history::{
    HistoryDirection, HistoryError, HistoryHint, HistoryLimits, HistorySummary, TypingClass,
};
pub use identity::{IdentityTokenError, MAX_IDENTITY_TOKEN_BYTES, NodeId, SessionKey};
pub use session::commands;
pub use session::commands::{
    CommandAvailability, CommandEffect, CommandError, CommandOutcome, CommandRequest,
};
pub use session::history_dispatch::{
    HistoryAvailability, HistoryBoundaryEvent, HistoryOutcome, HistoryRequest,
};
pub use session::{
    AccessMode, NodeRead, NodeStats, Session, SessionError, SessionState, StateError,
};
pub use snapshot::{SaveAcknowledgement, Snapshot, SnapshotError};
pub use transaction::{
    CommitEvent, DispatchOutcome, JournalEntrySummary, JournalSummary, NodeRef, SelectionUpdate,
    Transaction, TransactionError, TransactionLimits,
};

pub const PACKAGE_VERSION: &str = env!("CARGO_PKG_VERSION");
/// The generic dependency is explicit; the engine never imports a concrete profile.
pub const CORE_PACKAGE_VERSION: &str = editor_core::PACKAGE_VERSION;
