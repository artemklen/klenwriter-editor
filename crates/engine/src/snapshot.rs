// SPDX-License-Identifier: MIT OR Apache-2.0
//! Explicit profile export receipts and exact saved-content baselines.
//!
//! A receipt is minted only by Session after guarded export. Its document is
//! immutable and contains no engine IDs. It is not a claim of server/IDB save.

use std::sync::Arc;

use editor_core::limits::LimitExceeded;
use editor_core::profile::ProfileBinding;
use editor_core::transaction::WorkTrace;

use crate::events::{EventCursor, SessionStamp};

/// Operational ceiling independent of any profile's stricter document limit.
pub const MAX_SNAPSHOT_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SnapshotError {
    Limit(LimitExceeded),
    BindingMismatch,
    FutureRevision,
    InconsistentReceipt,
}

impl SnapshotError {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Limit(_) => "snapshot.limit",
            Self::BindingMismatch => "snapshot.binding_mismatch",
            Self::FutureRevision => "snapshot.future_revision",
            Self::InconsistentReceipt => "snapshot.inconsistent_receipt",
        }
    }
}

/// Immutable evidence of one explicitly exported revision. Private fields
/// prevent callers from manufacturing an acknowledgement for arbitrary bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Snapshot {
    stamp: SessionStamp,
    event_cursor: EventCursor,
    binding: ProfileBinding,
    document: Arc<[u8]>,
    matches_saved_baseline: bool,
    trace: WorkTrace,
}

impl Snapshot {
    pub(crate) fn new(
        stamp: SessionStamp,
        event_cursor: EventCursor,
        binding: ProfileBinding,
        document: Arc<[u8]>,
        matches_saved_baseline: bool,
        trace: WorkTrace,
    ) -> Self {
        Self {
            stamp,
            event_cursor,
            binding,
            document,
            matches_saved_baseline,
            trace,
        }
    }

    pub fn stamp(&self) -> SessionStamp {
        self.stamp
    }
    pub fn event_cursor(&self) -> EventCursor {
        self.event_cursor
    }
    pub fn binding(&self) -> &ProfileBinding {
        &self.binding
    }
    pub fn document(&self) -> &[u8] {
        &self.document
    }
    /// Result of exact equality at export time, not a live dirty-state query.
    pub fn matches_saved_baseline(&self) -> bool {
        self.matches_saved_baseline
    }
    /// Actual engine tree-copy/export bytes; profile admission has its own
    /// authoritative operational budget, not inferred costs in this trace.
    pub fn trace(&self) -> WorkTrace {
        self.trace
    }
    pub(crate) fn shared_document(&self) -> Arc<[u8]> {
        Arc::clone(&self.document)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SaveAcknowledgement {
    Updated { saved_revision: u64, dirty: bool },
    Unchanged { saved_revision: u64, dirty: bool },
    IgnoredOlder { saved_revision: u64, dirty: bool },
}

/// Engine retains one exact baseline only at explicit admission/save boundaries.
/// Ordinary edits do not copy or compare its document.
pub(crate) struct SavedBaseline {
    pub(crate) revision: u64,
    pub(crate) document: Arc<[u8]>,
}

impl SavedBaseline {
    pub(crate) fn admitted(bytes: &[u8]) -> Result<Self, SnapshotError> {
        editor_core::limits::check(
            "snapshot_bytes",
            MAX_SNAPSHOT_BYTES as u64,
            bytes.len() as u64,
        )
        .map_err(SnapshotError::Limit)?;
        Ok(Self {
            revision: 0,
            document: Arc::from(bytes),
        })
    }

    pub(crate) fn equals(&self, bytes: &[u8]) -> bool {
        self.document.as_ref() == bytes
    }
}
