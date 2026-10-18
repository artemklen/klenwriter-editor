// SPDX-License-Identifier: MIT OR Apache-2.0
//! Immutable, bounded notifications. Preparation never changes retained delivery.
//! The owner publishes a prepared append with the other Session facets; this
//! module stores no callbacks, document snapshots or history restoration data.

use std::collections::VecDeque;
use std::fmt::{self, Write};
use std::mem::size_of;
use std::sync::Arc;

use editor_core::admission::{PreflightBudget, preflight_node_fields};
use editor_core::document::{Attribute, Attributes, Mark};
use editor_core::limits::{LimitExceeded, check};
use editor_core::positions::Selection;
use editor_core::transaction::{WorkMeter, WorkPhase, WorkUsage};

use crate::history::HistorySummary;
use crate::identity::{NodeId, SessionKey};
use crate::mapping::{PositionMap, StepMap};
use crate::transaction::JournalSummary;

const MAX_RECORDS: usize = 64;
const MAX_SINGLE_BYTES: usize = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionStamp {
    pub session: SessionKey,
    pub revision: u64,
    pub selection_epoch: u64,
    pub history_epoch: u64,
}

/// Last consumed event, bound to one session generation. Only the engine mints
/// cursors from an actual head, batch or retained-prefix boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EventCursor {
    session: SessionKey,
    sequence: u64,
}
impl EventCursor {
    pub fn session(self) -> SessionKey {
        self.session
    }
    pub fn sequence(self) -> u64 {
        self.sequence
    }
}

/// Final net identities and both ancestry closures, in sorted unique order.
/// Removed identities are tombstones and never also readable upserts.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ChangeImpact {
    pub upserted: Vec<NodeId>,
    pub removed: Vec<NodeId>,
    pub ancestors_before: Vec<NodeId>,
    pub ancestors_after: Vec<NodeId>,
    pub root_order_changed: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StateChange {
    pub selection_changed: bool,
    pub stored_marks_changed: bool,
    pub history_changed: bool,
    pub baseline_changed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EventKind {
    Document {
        impact: ChangeImpact,
        map: PositionMap<NodeId>,
    },
    State(StateChange),
}

/// Owned prepared input. Publication retains it behind an immutable shared
/// record; consumers receive a borrowed payload, not mutable Session authority.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EventPayload {
    pub before: SessionStamp,
    pub after: SessionStamp,
    pub selection_before: Option<Selection<NodeId>>,
    pub selection_after: Option<Selection<NodeId>>,
    pub stored_marks_before: Option<Vec<Mark>>,
    pub stored_marks_after: Option<Vec<Mark>>,
    pub dirty_before: bool,
    pub dirty_after: bool,
    pub history: HistorySummary,
    pub journal: JournalSummary,
    pub kind: EventKind,
}

#[derive(Debug, PartialEq, Eq)]
pub struct SessionEvent {
    cursor: EventCursor,
    payload: EventPayload,
}
impl SessionEvent {
    pub fn cursor(&self) -> EventCursor {
        self.cursor
    }
    pub fn payload(&self) -> &EventPayload {
        &self.payload
    }
    pub fn before(&self) -> SessionStamp {
        self.payload.before
    }
    pub fn after(&self) -> SessionStamp {
        self.payload.after
    }
    pub fn kind(&self) -> &EventKind {
        &self.payload.kind
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EventLimits {
    pub records: usize,
    pub single_bytes: usize,
    pub total_bytes: usize,
}
impl Default for EventLimits {
    fn default() -> Self {
        Self {
            records: MAX_RECORDS,
            single_bytes: MAX_SINGLE_BYTES,
            total_bytes: MAX_TOTAL_BYTES,
        }
    }
}
impl EventLimits {
    pub(crate) fn effective(self) -> Self {
        Self {
            records: self.records.min(MAX_RECORDS),
            single_bytes: self.single_bytes.min(MAX_SINGLE_BYTES),
            total_bytes: self.total_bytes.min(MAX_TOTAL_BYTES),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EventReadLimits {
    pub records: usize,
    pub bytes: usize,
}
impl Default for EventReadLimits {
    fn default() -> Self {
        Self {
            records: MAX_RECORDS,
            bytes: MAX_TOTAL_BYTES,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProtectionStart {
    Now,
    After(EventCursor),
}

/// An opaque capability for the one protected delivery cursor. A released
/// capability cannot acknowledge a later protection, even in the same session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProtectedCursor {
    session: SessionKey,
    id: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalKind {
    Closed,
    Poisoned,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TerminalNotice {
    pub session: SessionKey,
    pub cursor: EventCursor,
    pub kind: TerminalKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EventStatus {
    pub head: EventCursor,
    /// Oldest valid last-consumed cursor. Reading an earlier one returns Gap.
    pub oldest_after: EventCursor,
    pub records: usize,
    pub retained_bytes: usize,
    pub protected_after: Option<EventCursor>,
    pub terminal: Option<TerminalNotice>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventError {
    ForeignSession,
    FutureCursor,
    Gap {
        oldest_after: EventCursor,
        head: EventCursor,
    },
    ProtectedAlready,
    StaleProtection,
    StaleAcknowledgement,
    Terminated,
    CounterExhausted,
    Backpressure,
    InvalidPayload,
    Limit(LimitExceeded),
}
impl EventError {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ForeignSession => "session.stale_session",
            Self::FutureCursor => "events.future_cursor",
            Self::Gap { .. } => "events.gap",
            Self::ProtectedAlready => "events.already_protected",
            Self::StaleProtection => "events.stale_protection",
            Self::StaleAcknowledgement => "events.stale_acknowledgement",
            Self::Terminated => "events.terminated",
            Self::CounterExhausted => "session.counter_exhausted",
            Self::Backpressure => "events.backpressure",
            Self::InvalidPayload => "events.invalid_payload",
            Self::Limit(_) => "resource_limit_exceeded",
        }
    }
}
impl From<LimitExceeded> for EventError {
    fn from(error: LimitExceeded) -> Self {
        Self::Limit(error)
    }
}

#[derive(Debug, Clone)]
struct RetainedEvent {
    event: Arc<SessionEvent>,
    bytes: usize,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Protection {
    token: ProtectedCursor,
    after: EventCursor,
}

/// The iterator borrows immutable retained records and allocates no payload.
#[derive(Debug)]
pub struct EventBatch<'a> {
    records: &'a VecDeque<RetainedEvent>,
    start: usize,
    len: usize,
    through: EventCursor,
    head: EventCursor,
    work: WorkUsage,
}
impl EventBatch<'_> {
    pub fn iter(&self) -> impl ExactSizeIterator<Item = &Arc<SessionEvent>> + DoubleEndedIterator {
        self.records
            .iter()
            .skip(self.start)
            .take(self.len)
            .map(|record| &record.event)
    }
    pub fn len(&self) -> usize {
        self.len
    }
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
    pub fn through(&self) -> EventCursor {
        self.through
    }
    pub fn head(&self) -> EventCursor {
        self.head
    }
    pub fn work(&self) -> WorkUsage {
        self.work
    }
}

#[derive(Debug)]
pub(crate) struct EventOutbox {
    session: SessionKey,
    sequence: u64,
    records: VecDeque<RetainedEvent>,
    bytes: usize,
    protection: Option<Protection>,
    protection_id: u64,
    last_released: Option<ProtectedCursor>,
    terminal: Option<TerminalNotice>,
}

/// Everything that can fail, including ring storage and the shared allocation,
/// is owned here before any committed facet changes.
#[derive(Debug)]
pub(crate) struct EventPlan {
    base: EventCursor,
    protection: Option<Protection>,
    records: VecDeque<RetainedEvent>,
    bytes: usize,
    event: Arc<SessionEvent>,
}
impl EventPlan {
    pub(crate) fn event(&self) -> &Arc<SessionEvent> {
        &self.event
    }
}

impl EventOutbox {
    pub(crate) fn new(session: SessionKey) -> Self {
        Self {
            session,
            sequence: 0,
            records: VecDeque::new(),
            bytes: size_of::<Self>(),
            protection: None,
            protection_id: 0,
            last_released: None,
            terminal: None,
        }
    }

    fn cursor(&self, sequence: u64) -> EventCursor {
        EventCursor {
            session: self.session,
            sequence,
        }
    }
    pub(crate) fn status(&self) -> EventStatus {
        EventStatus {
            head: self.cursor(self.sequence),
            oldest_after: self.cursor(
                self.records
                    .front()
                    .map_or(self.sequence, |record| record.event.cursor.sequence - 1),
            ),
            records: self.records.len(),
            retained_bytes: self.bytes,
            protected_after: self.protection.map(|protection| protection.after),
            terminal: self.terminal,
        }
    }
    fn open(&self) -> Result<(), EventError> {
        if self.terminal.is_some() {
            Err(EventError::Terminated)
        } else {
            Ok(())
        }
    }
    fn check_cursor(&self, cursor: EventCursor) -> Result<(), EventError> {
        if cursor.session != self.session {
            return Err(EventError::ForeignSession);
        }
        if cursor.sequence > self.sequence {
            return Err(EventError::FutureCursor);
        }
        let status = self.status();
        if cursor.sequence < status.oldest_after.sequence {
            return Err(EventError::Gap {
                oldest_after: status.oldest_after,
                head: status.head,
            });
        }
        Ok(())
    }

    pub(crate) fn prepare_append(
        &self,
        payload: Option<EventPayload>,
        limits: EventLimits,
        work: &mut WorkMeter,
    ) -> Result<Option<EventPlan>, EventError> {
        self.open()?;
        let Some(payload) = payload else {
            return Ok(None);
        };
        let sequence = self
            .sequence
            .checked_add(1)
            .ok_or(EventError::CounterExhausted)?;
        let limits = limits.effective();
        let event_bytes = payload_bytes(&payload, work)?;
        validate_payload(self.session, &payload, work)?;
        bound("event_single_bytes", limits.single_bytes, event_bytes)?;
        bound("event_records", limits.records, 1)?;
        let ring_bytes = add(size_of::<Self>(), bytes_for::<RetainedEvent>(MAX_RECORDS)?)?;
        let mut total = add(ring_bytes, event_bytes)?;
        for record in &self.records {
            event_visit(work, 1)?;
            total = add(total, record.bytes)?;
        }
        let mut evict = 0;
        // Even if a host tightens limits between calls, retain only a prefix-
        // eviction suffix whose existing records satisfy the reduced ceiling.
        let mut oversized = None;
        for (index, record) in self.records.iter().enumerate() {
            event_visit(work, 1)?;
            if record.bytes > limits.single_bytes {
                oversized = Some(index);
            }
        }
        while self.records.len() - evict + 1 > limits.records
            || total > limits.total_bytes
            || oversized.is_some_and(|last| evict <= last)
        {
            let Some(oldest) = self.records.get(evict) else {
                bound("event_total_bytes", limits.total_bytes, total)?;
                return Err(EventError::InvalidPayload);
            };
            event_visit(work, 1)?;
            if self
                .protection
                .is_some_and(|protection| oldest.event.cursor.sequence > protection.after.sequence)
            {
                return Err(EventError::Backpressure);
            }
            total -= oldest.bytes;
            evict += 1;
        }
        // Fixed maximum ring capacity keeps copying allocation bounded before
        // cloning the Arc handles. Existing event payloads are not copied.
        work.charge_bytes(add(event_bytes, add(ring_bytes, size_of::<EventPlan>())?)? as u64)?;
        // Phase bytes describe prepared allocation/copy storage, not a rescan
        // of the old shared payloads or the retained capacity being moved.
        work.note_phase(
            WorkPhase::Event,
            0,
            add(
                size_of::<SessionEvent>() + 2 * size_of::<usize>(),
                add(
                    bytes_for::<RetainedEvent>(MAX_RECORDS)?,
                    size_of::<EventPlan>(),
                )?,
            )? as u64,
        );
        let mut records = VecDeque::with_capacity(MAX_RECORDS);
        debug_assert_eq!(records.capacity(), MAX_RECORDS);
        for record in self.records.iter().skip(evict) {
            event_visit(work, 1)?;
            records.push_back(record.clone());
        }
        let event = Arc::new(SessionEvent {
            cursor: self.cursor(sequence),
            payload,
        });
        records.push_back(RetainedEvent {
            event: Arc::clone(&event),
            bytes: event_bytes,
        });
        Ok(Some(EventPlan {
            base: self.cursor(self.sequence),
            protection: self.protection,
            records,
            bytes: total,
            event,
        }))
    }

    pub(crate) fn publish(&mut self, plan: EventPlan) {
        assert_eq!(
            self.cursor(self.sequence),
            plan.base,
            "stale event append plan"
        );
        assert_eq!(
            self.protection, plan.protection,
            "delivery changed during preparation"
        );
        assert!(self.terminal.is_none(), "terminal event append plan");
        self.sequence = plan.event.cursor.sequence;
        self.records = plan.records;
        self.bytes = plan.bytes;
    }

    pub(crate) fn read_after(
        &self,
        cursor: EventCursor,
        limits: EventReadLimits,
        work: &mut WorkMeter,
    ) -> Result<EventBatch<'_>, EventError> {
        self.open()?;
        self.check_cursor(cursor)?;
        event_visit(work, 1)?;
        let maximum = limits.records.min(MAX_RECORDS);
        let maximum_bytes = limits.bytes.min(MAX_TOTAL_BYTES);
        let mut start = self.records.len();
        for (index, record) in self.records.iter().enumerate() {
            event_visit(work, 1)?;
            if record.event.cursor.sequence > cursor.sequence {
                start = index;
                break;
            }
        }
        let mut len = 0;
        let mut bytes = 0;
        let mut through = cursor;
        for record in self.records.iter().skip(start) {
            if len == maximum {
                if len == 0 {
                    bound("event_batch_records", maximum, 1)?;
                }
                break;
            }
            event_visit(work, 1)?;
            let next = add(bytes, record.bytes)?;
            if next > maximum_bytes {
                if len == 0 {
                    bound("event_batch_bytes", maximum_bytes, next)?;
                }
                break;
            }
            bytes = next;
            len += 1;
            through = record.event.cursor;
        }
        Ok(EventBatch {
            records: &self.records,
            start,
            len,
            through,
            head: self.cursor(self.sequence),
            work: work.usage(),
        })
    }

    pub(crate) fn protect(
        &mut self,
        start: ProtectionStart,
    ) -> Result<ProtectedCursor, EventError> {
        self.open()?;
        if self.protection.is_some() {
            return Err(EventError::ProtectedAlready);
        }
        let after = match start {
            ProtectionStart::Now => self.cursor(self.sequence),
            ProtectionStart::After(cursor) => {
                self.check_cursor(cursor)?;
                cursor
            }
        };
        let id = self
            .protection_id
            .checked_add(1)
            .ok_or(EventError::CounterExhausted)?;
        let token = ProtectedCursor {
            session: self.session,
            id,
        };
        self.protection_id = id;
        self.protection = Some(Protection { token, after });
        Ok(token)
    }
    fn check_protection(&self, token: ProtectedCursor) -> Result<Protection, EventError> {
        if token.session != self.session {
            return Err(EventError::ForeignSession);
        }
        self.open()?;
        self.protection
            .filter(|protection| protection.token == token)
            .ok_or(EventError::StaleProtection)
    }
    pub(crate) fn acknowledge(
        &mut self,
        token: ProtectedCursor,
        cursor: EventCursor,
    ) -> Result<bool, EventError> {
        let current = self.check_protection(token)?;
        if cursor.session != self.session {
            return Err(EventError::ForeignSession);
        }
        if cursor.sequence < current.after.sequence {
            return Err(EventError::StaleAcknowledgement);
        }
        self.check_cursor(cursor)?;
        if cursor == current.after {
            return Ok(false);
        }
        self.protection = Some(Protection {
            after: cursor,
            ..current
        });
        Ok(true)
    }
    pub(crate) fn release(&mut self, token: ProtectedCursor) -> Result<bool, EventError> {
        if token.session != self.session {
            return Err(EventError::ForeignSession);
        }
        self.open()?;
        if self.protection.is_none() && self.last_released == Some(token) {
            return Ok(false);
        }
        self.check_protection(token)?;
        self.protection = None;
        self.last_released = Some(token);
        Ok(true)
    }
    /// Fixed metadata outside ordinary queue/sequence; no capacity or counter
    /// check may prevent a fatal/closed handle from disabling mutation.
    pub(crate) fn terminate(&mut self, kind: TerminalKind) {
        self.protection = None;
        if self.terminal.is_none() {
            self.terminal = Some(TerminalNotice {
                session: self.session,
                cursor: self.cursor(self.sequence),
                kind,
            });
        }
    }

    #[cfg(test)]
    pub(crate) fn set_sequence_for_test(&mut self, sequence: u64) {
        self.sequence = sequence;
    }
}

/// Clone only after bounded borrowed preflight and allocation charge. Input
/// capacities are not copied by clone; values conservatively cover the full
/// B-tree slot/header/edge policy used for retained metadata below.
pub(crate) fn copy_event_marks(
    source: Option<&[Mark]>,
    work: &mut WorkMeter,
) -> Result<Option<Vec<Mark>>, EventError> {
    let Some(source) = source else {
        return Ok(None);
    };
    let limits = work.limits();
    let usage = work.usage();
    let measured = preflight_node_fields(
        "",
        None,
        &Attributes::new(),
        source,
        0,
        PreflightBudget {
            payload_bytes: limits.bytes.saturating_sub(usage.bytes),
            values: limits.units.saturating_sub(usage.units),
            depth: 128,
        },
    )?;
    let payload =
        usize::try_from(measured.payload_bytes).map_err(|_| EventError::CounterExhausted)?;
    let values = usize::try_from(measured.values).map_err(|_| EventError::CounterExhausted)?;
    let node = 11 * size_of::<(String, Attribute)>() + 14 * size_of::<usize>();
    let metadata = values
        .checked_mul(node)
        .ok_or(EventError::CounterExhausted)?;
    let bytes = add(add(payload, metadata)?, bytes_for::<Mark>(source.len())?)?;
    work.charge_units(measured.values)?;
    work.charge_bytes(bytes as u64)?;
    // The completed bounded preflight visited these values; clone now visits
    // them again. Bytes are conservative prepared clone storage, not RSS.
    work.note_phase(
        WorkPhase::Event,
        measured.values.saturating_mul(2),
        bytes as u64,
    );
    Ok(Some(source.to_vec()))
}

fn validate_payload(
    session: SessionKey,
    payload: &EventPayload,
    work: &mut WorkMeter,
) -> Result<(), EventError> {
    event_visit(work, 1)?;
    if payload.before.session != session || payload.after.session != session {
        return Err(EventError::ForeignSession);
    }
    if payload.after.selection_epoch < payload.before.selection_epoch
        || payload.after.history_epoch < payload.before.history_epoch
        || payload.history.epoch != payload.after.history_epoch
    {
        return Err(EventError::InvalidPayload);
    }
    for selection in [payload.selection_before, payload.selection_after]
        .into_iter()
        .flatten()
    {
        if selection.anchor.node().session() != session
            || selection.focus.node().session() != session
        {
            return Err(EventError::ForeignSession);
        }
    }
    match &payload.kind {
        EventKind::Document { impact, map } => {
            if payload.before.revision.checked_add(1) != Some(payload.after.revision)
                || map.before() != payload.before.revision
                || map.after() != payload.after.revision
            {
                return Err(EventError::InvalidPayload);
            }
            for values in [
                &impact.upserted,
                &impact.removed,
                &impact.ancestors_before,
                &impact.ancestors_after,
            ] {
                event_visit(work, values.len() as u64)?;
                if values.iter().any(|id| id.session() != session)
                    || values.windows(2).any(|pair| pair[0] >= pair[1])
                {
                    return Err(EventError::InvalidPayload);
                }
            }
            event_visit(work, (impact.upserted.len() + impact.removed.len()) as u64)?;
            let mut removed = impact.removed.iter().peekable();
            for id in &impact.upserted {
                while removed.peek().is_some_and(|removed| *removed < id) {
                    removed.next();
                }
                if removed.peek().is_some_and(|removed| *removed == id) {
                    return Err(EventError::InvalidPayload);
                }
            }
        }
        EventKind::State(changed) => {
            if payload.after.revision != payload.before.revision
                || changed.selection_changed
                    != (payload.selection_before != payload.selection_after)
                || changed.stored_marks_changed
                    != (payload.stored_marks_before != payload.stored_marks_after)
                || changed.history_changed
                    != (payload.before.history_epoch != payload.after.history_epoch)
                || !(changed.selection_changed
                    || changed.stored_marks_changed
                    || changed.history_changed
                    || changed.baseline_changed
                    || payload.dirty_before != payload.dirty_after)
            {
                return Err(EventError::InvalidPayload);
            }
        }
    }
    Ok(())
}

fn payload_bytes(payload: &EventPayload, work: &mut WorkMeter) -> Result<usize, EventError> {
    // Arc's two counters are allocated once, independent of strong_count.
    let mut bytes = add(size_of::<SessionEvent>(), 2 * size_of::<usize>())?;
    bytes = add(
        bytes,
        marks_bytes(payload.stored_marks_before.as_ref(), work)?,
    )?;
    bytes = add(
        bytes,
        marks_bytes(payload.stored_marks_after.as_ref(), work)?,
    )?;
    if let EventKind::Document { impact, map } = &payload.kind {
        for values in [
            &impact.upserted,
            &impact.removed,
            &impact.ancestors_before,
            &impact.ancestors_after,
        ] {
            bytes = add(bytes, bytes_for::<NodeId>(values.capacity())?)?;
        }
        bytes = add(bytes, bytes_for::<StepMap<NodeId>>(map.steps_capacity())?)?;
        event_visit(work, map.steps().len() as u64)?;
        for step in map.steps() {
            if let StepMap::Retire { nodes, .. } | StepMap::Revive { nodes } = step {
                bytes = add(bytes, bytes_for::<NodeId>(nodes.capacity())?)?;
            }
        }
    }
    Ok(bytes)
}
fn marks_bytes(marks: Option<&Vec<Mark>>, work: &mut WorkMeter) -> Result<usize, EventError> {
    let Some(marks) = marks else { return Ok(0) };
    let mut bytes = bytes_for::<Mark>(marks.capacity())?;
    for mark in marks {
        event_visit(work, 1)?;
        bytes = add(bytes, string_bytes(&mark.type_id, work)?)?;
        bytes = add(bytes, attributes_bytes(&mark.attributes, 0, work)?)?;
    }
    Ok(bytes)
}
fn attributes_bytes(
    attributes: &Attributes,
    depth: usize,
    work: &mut WorkMeter,
) -> Result<usize, EventError> {
    bound("event_metadata_depth", 128, depth)?;
    let mut bytes = 0;
    for (key, value) in attributes {
        event_visit(work, 1)?;
        // Same conservative full B-tree-node-per-entry policy as history:
        // spare slots, node header and child pointers are not hidden.
        bytes = add(
            bytes,
            11 * size_of::<(String, Attribute)>() + 14 * size_of::<usize>(),
        )?;
        bytes = add(bytes, string_bytes(key, work)?)?;
        bytes = add(bytes, attribute_bytes(value, depth + 1, work)?)?;
    }
    Ok(bytes)
}
fn attribute_bytes(
    value: &Attribute,
    depth: usize,
    work: &mut WorkMeter,
) -> Result<usize, EventError> {
    bound("event_metadata_depth", 128, depth)?;
    event_visit(work, 1)?;
    match value {
        Attribute::Null | Attribute::Boolean(_) => Ok(0),
        Attribute::String(value) => string_bytes(value, work),
        Attribute::Number(value) => number_bytes(value, work),
        Attribute::List(values) => {
            let mut bytes = bytes_for::<Attribute>(values.capacity())?;
            for value in values {
                bytes = add(bytes, attribute_bytes(value, depth + 1, work)?)?;
            }
            Ok(bytes)
        }
        Attribute::Object(values) => attributes_bytes(values, depth, work),
    }
}
fn number_bytes(value: &impl fmt::Display, work: &mut WorkMeter) -> Result<usize, EventError> {
    // Stream decimal spelling rather than allocating a measurement String;
    // this also covers serde_json arbitrary_precision feature unification.
    struct Counter<'a> {
        work: &'a mut WorkMeter,
        bytes: usize,
        error: Option<EventError>,
    }
    impl Write for Counter<'_> {
        fn write_str(&mut self, value: &str) -> fmt::Result {
            let result = (|| {
                self.work.charge_units(value.len() as u64)?;
                self.work.note_phase(WorkPhase::Event, 1, 0);
                self.bytes = add(self.bytes, value.len())?;
                Ok::<_, EventError>(())
            })();
            result.map_err(|error| {
                self.error = Some(error);
                fmt::Error
            })
        }
    }
    let mut counter = Counter {
        work,
        bytes: 0,
        error: None,
    };
    write!(&mut counter, "{value}")
        .map_err(|_| counter.error.unwrap_or(EventError::InvalidPayload))?;
    Ok(counter.bytes)
}
fn string_bytes(value: &String, work: &mut WorkMeter) -> Result<usize, EventError> {
    work.charge_units(value.len() as u64)?;
    // Only the String descriptor is read here; its capacity is not rescanned.
    work.note_phase(WorkPhase::Event, 1, 0);
    Ok(value.capacity())
}
fn event_visit(work: &mut WorkMeter, count: u64) -> Result<(), EventError> {
    work.charge_units(count)?;
    work.note_phase(WorkPhase::Event, count, 0);
    Ok(())
}
fn bytes_for<T>(count: usize) -> Result<usize, EventError> {
    count
        .checked_mul(size_of::<T>())
        .ok_or(EventError::CounterExhausted)
}
fn add(a: usize, b: usize) -> Result<usize, EventError> {
    a.checked_add(b).ok_or(EventError::CounterExhausted)
}
fn bound(name: &'static str, maximum: usize, observed: usize) -> Result<(), EventError> {
    check(name, maximum as u64, observed as u64).map_err(EventError::Limit)
}

#[cfg(test)]
#[path = "eventtests.rs"]
mod tests;
