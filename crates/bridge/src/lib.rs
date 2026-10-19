// SPDX-License-Identifier: MIT OR Apache-2.0
//! Real Session bridge. No host callback runs inside a Rust borrow.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};

use editor_core::commands::{CatalogError, CommandProvider, MAX_COMMANDS, SelectionIntent};
use editor_core::profile::{AdmissionMode, ProfileBinding};
use editor_core::transaction::{WorkLimits, WorkMeter};
use editor_engine::commands::{
    CommandAvailability, CommandEffect, CommandError, CommandOutcome, CommandRequest,
};
use editor_engine::events::{
    EventCursor, EventError, EventReadLimits, ProtectedCursor, ProtectionStart,
};
use editor_engine::history::HistoryDirection;
use editor_engine::mapping::MapResult;
use editor_engine::session::{AccessMode, Session, SessionError};
use editor_engine::snapshot::Snapshot;
use editor_engine::transaction::{DispatchOutcome, Transaction, TransactionError, error_code};
use editor_engine::{HistoryAvailability, HistoryOutcome, HistoryRequest};
use serde::de::DeserializeOwned;

use crate::convert::*;
use editor_protocol::*;

pub mod convert;
pub mod distribution;
pub mod recipes;
mod selection;
pub use distribution::{CreatedEndpoint, Distribution, DistributionSession, capability_digest};
pub use selection::SelectionTextData;

const MAX_REQUEST_BYTES: usize = 16 * 1024 * 1024;
const MAX_SNAPSHOT_HANDLES: usize = 32;
const MAX_SNAPSHOT_TOTAL: usize = 32 * 1024 * 1024;
static SESSIONS: AtomicU32 = AtomicU32::new(0);
static SNAPSHOTS: AtomicU32 = AtomicU32::new(0);
static SNAPSHOT_BYTES: AtomicU64 = AtomicU64::new(0);
static PROTECTIONS: AtomicU32 = AtomicU32::new(0);

pub const BUILD_ID: &str = match option_env!("KLENWRITER_EDITOR_SDK_BUILD_ID") {
    Some(v) => v,
    None => "unbuilt-editor-sdk",
};

fn mode(v: AdmissionDto) -> AdmissionMode {
    match v {
        AdmissionDto::Validate => AdmissionMode::Strict,
        AdmissionDto::Normalize => AdmissionMode::Import,
    }
}
fn direction(v: HistoryDirectionDto) -> HistoryDirection {
    match v {
        HistoryDirectionDto::Undo => HistoryDirection::Undo,
        HistoryDirectionDto::Redo => HistoryDirection::Redo,
    }
}

/// Count/depth scan before serde allocates recursive DTO values. String contents
/// are not interpreted here; serde performs exact Unicode/closed-field decode.
pub fn decode<T: DeserializeOwned>(json: &str) -> Result<T, DiagnosticDto> {
    if json.len() > MAX_REQUEST_BYTES {
        return Err(diagnostic("sdk.payload_limit", ""));
    }
    let mut depth = 0usize;
    let mut values = 0usize;
    let mut string = false;
    let mut escape = false;
    for b in json.bytes() {
        if string {
            if escape {
                escape = false;
            } else if b == b'\\' {
                escape = true;
            } else if b == b'"' {
                string = false;
            }
        } else {
            match b {
                b'"' => {
                    string = true;
                    values += 1;
                }
                b'{' | b'[' => {
                    depth += 1;
                    values += 1;
                }
                b'}' | b']' => {
                    depth = depth.saturating_sub(1);
                }
                b',' => {
                    values += 1;
                }
                _ => {}
            }
            if depth > 96 || values > 131_072 {
                return Err(diagnostic("sdk.payload_limit", ""));
            }
        }
    }
    serde_json::from_str(json).map_err(|e| {
        let mut d = diagnostic("sdk.invalid_dto", "");
        d.details.insert("line".into(), e.line().to_string());
        d.details.insert("column".into(), e.column().to_string());
        d
    })
}

pub fn resource_counts() -> ResourceCountsDto {
    ResourceCountsDto {
        sessions: SESSIONS.load(Ordering::SeqCst),
        snapshot_handles: SNAPSHOTS.load(Ordering::SeqCst),
        snapshot_bytes: SNAPSHOT_BYTES.load(Ordering::SeqCst).to_string(),
        protected_cursors: PROTECTIONS.load(Ordering::SeqCst),
    }
}

/// Profile-owned wire decoding and diagnostics. Session semantics remain typed.
pub trait BridgeAdapter<P: CommandProvider> {
    fn selection_text<V: editor_core::candidate::CandidateRead<Id = editor_engine::NodeId>>(
        &self,
        _view: &V,
        _selection: editor_core::positions::Selection<editor_engine::NodeId>,
        _max_bytes: u32,
        _work: &mut WorkMeter,
    ) -> Result<SelectionTextData, DiagnosticDto> {
        Err(diagnostic("profile.selection_text_unsupported", ""))
    }
    fn decode_command(
        &self,
        key: editor_engine::SessionKey,
        command: &CommandDto,
    ) -> Result<P::Intent<editor_engine::NodeId>, DiagnosticDto>;
    fn profile_error(error: &P::Error) -> DiagnosticDto;
}

/// A fully chosen immutable profile and admission context; no concrete-profile branch.
pub struct BridgeOpen<P: CommandProvider> {
    pub profile: P,
    pub binding: ProfileBinding,
    pub admission: AdmissionMode,
    pub access: AccessMode,
}

/// Erasure is allowed only after the typed bridge/profile has been constructed.
pub trait Endpoint {
    fn initialization(&self) -> SdkResponse;
    fn call_json(&mut self, request_json: &str) -> String;
    fn destroy(&mut self);
    fn own_resource_counts(&self) -> ResourceCountsDto;
}
pub trait SessionFactory {
    fn capability(&self) -> editor_protocol::v2::CompiledProfileV2;
    fn open(
        &self,
        input: &[u8],
        options: &editor_protocol::v2::OpenOptionsV2,
    ) -> Result<CreatedEndpoint, DiagnosticDto>;
}

pub struct Bridge<P: CommandProvider, A: BridgeAdapter<P>> {
    session: Option<Session<P>>,
    adapter: A,
    access: AccessMode,
    protection: Option<ProtectedCursor>,
    cursor: Option<EventCursor>,
    pending_cursor: Option<EventCursor>,
    snapshots: BTreeMap<String, Snapshot>,
    next_snapshot: u64,
    initialization: SdkResponse,
    fatal: Option<DiagnosticDto>,
}

impl<P: CommandProvider, A: BridgeAdapter<P>> Bridge<P, A> {
    pub fn refused(adapter: A, diagnostic: DiagnosticDto) -> Self {
        Self {
            session: None,
            adapter,
            access: AccessMode::Editable,
            protection: None,
            cursor: None,
            pending_cursor: None,
            snapshots: BTreeMap::new(),
            next_snapshot: 1,
            initialization: SdkResponse::Refused { diagnostic },
            fatal: None,
        }
    }
    pub fn new(input: &[u8], open: BridgeOpen<P>, adapter: A) -> Self {
        // ABI1's shared binding DTO has a u32 capability; refuse wider bindings
        // before profile admission rather than truncate an exported version.
        if open.binding.wire_version() > u64::from(u32::MAX) {
            return Self::refused(
                adapter,
                diagnostic("profile.unsupported_wire_version", "profile.wire_version"),
            );
        }
        let mut this = Self::refused(adapter, diagnostic("sdk.not_initialized", ""));
        this.initialization = match this.open(input, open) {
            Ok(state) => SdkResponse::Ok {
                value: Box::new(SdkReply::State { state }),
            },
            Err(diagnostic) => SdkResponse::Refused { diagnostic },
        };
        this
    }
    fn open(&mut self, input: &[u8], open: BridgeOpen<P>) -> Result<StateDto, DiagnosticDto> {
        if input.len() > MAX_REQUEST_BYTES {
            return Err(diagnostic("sdk.payload_limit", "input"));
        }
        self.access = open.access;
        let mut session = Session::open(
            open.profile,
            &open.binding,
            input,
            open.admission,
            self.access,
        )
        .map_err(|e| Self::session_error(&e))?;
        let cursor = session
            .event_status(session.key())
            .map_err(|e| Self::session_error(&e))?
            .head;
        let protection = session
            .protect_events(session.key(), ProtectionStart::Now)
            .map_err(|e| Self::session_error(&e))?;
        SESSIONS
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |v| {
                (v < 256).then_some(v + 1)
            })
            .map_err(|_| diagnostic("sdk.session_limit", ""))?;
        PROTECTIONS.fetch_add(1, Ordering::SeqCst);
        self.session = Some(session);
        self.cursor = Some(cursor);
        self.protection = Some(protection);
        self.state()
    }
    fn transaction_error(e: &TransactionError<P::Error>) -> DiagnosticDto {
        if let TransactionError::Profile(error) = e {
            return A::profile_error(error);
        }
        let mut d = diagnostic(error_code(e, P::error_code), "");
        if let TransactionError::Limit(e) = e {
            d.details.insert("limit".into(), e.name.into());
            d.details.insert("maximum".into(), e.maximum.to_string());
            d.details.insert("observed".into(), e.observed.to_string());
        }
        d
    }
    fn session_error(e: &SessionError<P::Error>) -> DiagnosticDto {
        match e {
            SessionError::Binding(e) => diagnostic(e.as_str(), "profile"),
            SessionError::Profile(e) => A::profile_error(e),
            SessionError::State(e) => Self::transaction_error(&TransactionError::State(*e)),
            SessionError::Tree(e) => Self::transaction_error(&TransactionError::Tree(e.clone())),
            SessionError::History(e) => diagnostic(e.as_str(), "history"),
            SessionError::Events(e) => diagnostic(e.as_str(), "events"),
            SessionError::Snapshot(e) => diagnostic(e.as_str(), "snapshot"),
        }
    }
    pub fn session(&self) -> Result<&Session<P>, DiagnosticDto> {
        self.session
            .as_ref()
            .ok_or_else(|| diagnostic("sdk.disposed", ""))
    }
    pub fn session_mut(&mut self) -> Result<&mut Session<P>, DiagnosticDto> {
        self.session
            .as_mut()
            .ok_or_else(|| diagnostic("sdk.disposed", ""))
    }
    fn check(&self, stamp: &StampDto) -> Result<(), DiagnosticDto> {
        stamp_check(stamp, self.session()?.stamp())
    }
    pub fn initialization(&self) -> SdkResponse {
        self.initialization.clone()
    }
    pub fn state(&self) -> Result<StateDto, DiagnosticDto> {
        let s = self.session()?;
        let key = s.key();
        Ok(StateDto {
            stamp: stamp_out(s.stamp()),
            root: s.root(key).map_err(|e| Self::session_error(&e))?.to_token(),
            selection: s
                .selection(key)
                .map_err(|e| Self::session_error(&e))?
                .map(selection_out),
            stored_marks: s
                .stored_marks(key)
                .map_err(|e| Self::session_error(&e))?
                .map(marks_out),
            dirty: s.dirty(),
            saved_revision: s.saved_revision().to_string(),
            history: history_out(s.history_summary()),
        })
    }
    fn mutation(
        &self,
        effect: &str,
        presentation: Option<PresentationDto>,
    ) -> Result<SdkReply, DiagnosticDto> {
        Ok(SdkReply::Mutation {
            effect: effect.into(),
            state: self.state()?,
            presentation,
        })
    }
    fn dispatch_outcome(
        &self,
        outcome: DispatchOutcome<P::Error>,
        presentation: Option<PresentationDto>,
    ) -> Result<SdkReply, DiagnosticDto> {
        match outcome {
            DispatchOutcome::Changed(_) => self.mutation("changed", presentation),
            DispatchOutcome::Unchanged {
                selection_changed,
                stored_marks_changed,
                ..
            } => self.mutation(
                if selection_changed || stored_marks_changed {
                    "state_changed"
                } else {
                    "unchanged"
                },
                presentation,
            ),
            DispatchOutcome::Refused { error, .. } => Err(Self::transaction_error(&error)),
        }
    }
    fn command_request(
        &self,
        stamp: &StampDto,
        command: CommandDto,
        hint: HistoryHintDto,
    ) -> Result<CommandRequest<P::Intent<editor_engine::NodeId>>, DiagnosticDto> {
        self.check(stamp)?;
        let s = self.session()?;
        let intent = self.adapter.decode_command(s.key(), &command)?;
        if P::command_id(&intent) != command.id {
            return Err(diagnostic("command.unknown", "command.id"));
        }
        let mut r = CommandRequest::new(s.key(), s.revision(), s.selection_epoch(), intent);
        r.history_epoch = Some(s.history_summary().epoch);
        r.history_hint = history_hint(hint)?;
        Ok(r)
    }
    fn history_request(
        &self,
        stamp: &StampDto,
        d: HistoryDirectionDto,
    ) -> Result<HistoryRequest, DiagnosticDto> {
        self.check(stamp)?;
        let s = self.session()?;
        Ok(HistoryRequest::new(
            s.key(),
            s.revision(),
            s.selection_epoch(),
            s.history_summary().epoch,
            direction(d),
        ))
    }
    fn command_error(e: &CommandError<P::Error>) -> DiagnosticDto {
        match e {
            CommandError::Catalog(e) => diagnostic(e.as_str(), "command"),
            CommandError::UnknownCommand => diagnostic("command.unknown", "command.id"),
            CommandError::Transaction(e) => Self::transaction_error(e),
        }
    }
    pub fn call(&mut self, request: BridgeRequest) -> SdkResponse {
        self.boundary(move |this| this.execute(request))
    }
    pub fn update_context<F>(&mut self, stamp: StampDto, apply: F) -> SdkResponse
    where
        F: FnOnce(&mut A) -> Result<(), DiagnosticDto>,
    {
        self.boundary(move |this| {
            this.check(&stamp)?;
            apply(&mut this.adapter)?;
            this.mutation("context_updated", None)
        })
    }
    fn boundary<F>(&mut self, execute: F) -> SdkResponse
    where
        F: FnOnce(&mut Self) -> Result<SdkReply, DiagnosticDto>,
    {
        if let Some(diagnostic) = &self.fatal {
            return SdkResponse::Fatal {
                diagnostic: diagnostic.clone(),
            };
        }
        let fingerprint = |s: &Session<P>| {
            (
                s.stamp(),
                s.dirty(),
                s.saved_revision(),
                s.event_status(s.key()).ok().map(|v| v.head.sequence()),
            )
        };
        let before = self.session.as_ref().map(fingerprint);
        let result = execute(self);
        match result {
            Ok(value) => SdkResponse::Ok {
                value: Box::new(value),
            },
            Err(mut diagnostic) => {
                if diagnostic.stamp.is_none() {
                    diagnostic.stamp = self
                        .session
                        .as_ref()
                        .map(|s| Box::new(stamp_out(s.stamp())));
                }
                if self.session.as_ref().map(fingerprint) != before {
                    diagnostic.may_have_committed = true;
                    diagnostic.category = "post_commit_boundary".into();
                    self.destroy();
                    self.fatal = Some(diagnostic.clone());
                    SdkResponse::Fatal { diagnostic }
                } else {
                    SdkResponse::Refused { diagnostic }
                }
            }
        }
    }
    /// Profile-owned endpoint wrappers use this before decoding their extra
    /// request variants. A terminal boundary cannot become an ordinary refusal.
    pub fn retained_fatal_response(&self) -> Option<SdkResponse> {
        self.fatal.as_ref().map(|diagnostic| SdkResponse::Fatal {
            diagnostic: diagnostic.clone(),
        })
    }
    pub fn call_json(&mut self, json: &str) -> String {
        if let Some(response) = self.retained_fatal_response() {
            return self.encode_response(response);
        }
        let response = match decode(json) {
            Ok(request) => self.call(request),
            Err(diagnostic) => SdkResponse::Refused { diagnostic },
        };
        // DTO encode happens after native publication. A conversion failure is
        // fatal/indeterminate, never a retroactive ordinary refusal.
        self.encode_response(response)
    }
    pub fn encode_response(&mut self, response: SdkResponse) -> String {
        if let Ok(json) = serde_json::to_string(&response) {
            return json;
        }
        self.transport_failure()
    }
    /// Publisher reports a post-publication transport failure as indeterminate.
    pub fn transport_failure(&mut self) -> String {
        let mut d = diagnostic("sdk.transport_failed", "");
        d.may_have_committed = true;
        d.stamp = self
            .session
            .as_ref()
            .map(|s| Box::new(stamp_out(s.stamp())));
        self.destroy();
        self.fatal = Some(d.clone());
        serde_json::to_string(&SdkResponse::Fatal { diagnostic: d })
            .expect("fixed scalar diagnostic serializes")
    }
    fn execute(&mut self, request: BridgeRequest) -> Result<SdkReply, DiagnosticDto> {
        match request {
            BridgeRequest::Destroy {} => {
                self.destroy();
                Ok(SdkReply::Destroyed {})
            }
            BridgeRequest::Resources {} => Ok(SdkReply::Resources {
                resources: self.own_resource_counts(),
            }),
            BridgeRequest::State {} => Ok(SdkReply::State {
                state: self.state()?,
            }),
            BridgeRequest::Catalog {} => {
                let session = self.session()?;
                let catalog = session
                    .command_catalog(session.key())
                    .map_err(|e| Self::session_error(&e))?;
                // The Session getter only lends an immutable view. Even a
                // trusted external provider must pass the public transport
                // bound before enumeration, owned copies or serialization.
                let count = catalog.len();
                if count > MAX_COMMANDS {
                    return Err(diagnostic(
                        CatalogError::TooManyCommands.as_str(),
                        "commands",
                    ));
                }
                let mut work = WorkMeter::new(WorkLimits::default());
                work.charge_units((count as u64).saturating_mul(count as u64 + 1))
                    .map_err(|_| diagnostic("sdk.payload_limit", "commands"))?;
                work.charge_bytes(catalog.ids().map(|id| id.len().min(129) as u64).sum())
                    .map_err(|_| diagnostic("sdk.payload_limit", "commands"))?;
                catalog
                    .validate()
                    .map_err(|error| diagnostic(error.as_str(), "commands"))?;
                Ok(SdkReply::Catalog {
                    commands: catalog.ids().map(str::to_owned).collect(),
                })
            }
            BridgeRequest::Node { stamp, node } => {
                self.check(&stamp)?;
                let s = self.session()?;
                let id = s
                    .key()
                    .parse_node_token(&node)
                    .map_err(|e| diagnostic(e.as_str(), "node"))?;
                let n = s
                    .node_at(s.key(), s.revision(), id)
                    .map_err(|e| Self::session_error(&e))?;
                Ok(SdkReply::Node {
                    node: NodeViewDto {
                        stamp: stamp_out(n.stamp),
                        id: node,
                        parent: n.node.parent().map(|v| v.to_token()),
                        type_id: n.node.type_id().unwrap_or("").into(),
                        primitive: primitive_out(n.node.primitive()).into(),
                        attributes: n.node.attributes().map(attrs_out).unwrap_or_default(),
                        marks: marks_out(n.node.marks()),
                        text: n.node.text().map(str::to_owned),
                        children: n.node.children().iter().map(|v| v.to_token()).collect(),
                        changed_revision: n.changed_revision.to_string(),
                        stats: NodeStatsDto {
                            authored_nodes: n.stats.authored_nodes.to_string(),
                            text_utf8: n.stats.text_utf8.to_string(),
                            text_utf16: n.stats.text_utf16.to_string(),
                            height: n.stats.height.to_string(),
                        },
                    },
                })
            }
            BridgeRequest::QueryCommand { stamp, command } => {
                let r = self.command_request(&stamp, command, HistoryHintDto::Isolated {})?;
                Ok(match self.session()?.query_command(&r) {
                    CommandAvailability::Available {
                        presentation,
                        effect,
                        ..
                    } => SdkReply::Availability {
                        available: true,
                        effect: Some(
                            match effect {
                                CommandEffect::Changed => "changed",
                                CommandEffect::Unchanged => "unchanged",
                            }
                            .into(),
                        ),
                        presentation: Some(presentation_out(presentation)),
                        diagnostic: None,
                    },
                    CommandAvailability::Unavailable { error, .. } => SdkReply::Availability {
                        available: false,
                        effect: None,
                        presentation: None,
                        diagnostic: Some(Self::command_error(&error)),
                    },
                })
            }
            BridgeRequest::Command {
                stamp,
                command,
                history_hint,
            } => {
                let r = self.command_request(&stamp, command, history_hint)?;
                let outcome = self.session_mut()?.execute_command(&r);
                match outcome {
                    CommandOutcome::Completed {
                        presentation,
                        outcome,
                    } => self.dispatch_outcome(outcome, Some(presentation_out(presentation))),
                    CommandOutcome::Refused { error, .. } => Err(Self::command_error(&error)),
                }
            }
            BridgeRequest::QueryHistory { stamp, direction } => {
                let r = self.history_request(&stamp, direction)?;
                Ok(match self.session()?.query_history(&r) {
                    HistoryAvailability::Available { .. } => SdkReply::Availability {
                        available: true,
                        effect: Some("changed".into()),
                        presentation: None,
                        diagnostic: None,
                    },
                    HistoryAvailability::Unavailable { error, .. } => SdkReply::Availability {
                        available: false,
                        effect: None,
                        presentation: None,
                        diagnostic: Some(Self::transaction_error(&error)),
                    },
                })
            }
            BridgeRequest::History { stamp, direction } => {
                let r = self.history_request(&stamp, direction)?;
                match self.session_mut()?.execute_history(&r) {
                    HistoryOutcome::Completed(_) => self.mutation("changed", None),
                    HistoryOutcome::Refused { error, .. } => Err(Self::transaction_error(&error)),
                }
            }
            BridgeRequest::SetSelection { stamp, selection } => {
                self.check(&stamp)?;
                let s = self.session()?;
                let outcome = if let Some(selection) = selection {
                    let selection = selection_in(&selection, s.key())?;
                    let before = s.stamp();
                    let s = self.session_mut()?;
                    s.set_selection(s.key(), s.revision(), selection)
                        .map_err(|e| Self::session_error(&e))?;
                    return self.mutation(
                        if self.session()?.stamp() != before {
                            "state_changed"
                        } else {
                            "unchanged"
                        },
                        None,
                    );
                } else {
                    let mut r = Transaction::new(s.key(), s.revision(), vec![]);
                    r.selection_epoch = Some(s.selection_epoch());
                    r.history_epoch = Some(s.history_summary().epoch);
                    r.selection = SelectionIntent::Set(None);
                    self.session_mut()?.dispatch(r)
                };
                self.dispatch_outcome(outcome, None)
            }
            BridgeRequest::SetStoredMarks { stamp, marks } => {
                self.check(&stamp)?;
                let marks = marks.as_deref().map(marks_in).transpose()?;
                let s = self.session_mut()?;
                let outcome = s.set_typing_marks(
                    s.key(),
                    s.revision(),
                    s.selection_epoch(),
                    s.history_summary().epoch,
                    marks,
                );
                self.dispatch_outcome(outcome, None)
            }
            BridgeRequest::Barrier { stamp } => {
                self.check(&stamp)?;
                let s = self.session_mut()?;
                let event = s
                    .seal_history(
                        s.key(),
                        s.revision(),
                        s.selection_epoch(),
                        s.history_summary().epoch,
                        WorkLimits::default(),
                    )
                    .map_err(|e| Self::transaction_error(&e))?;
                self.mutation(
                    if event.changed {
                        "state_changed"
                    } else {
                        "unchanged"
                    },
                    None,
                )
            }
            BridgeRequest::Snapshot { stamp, max_bytes } => {
                self.check(&stamp)?;
                if self.snapshots.len() >= MAX_SNAPSHOT_HANDLES || self.next_snapshot == u64::MAX {
                    return Err(diagnostic("sdk.snapshot_limit", "snapshot"));
                }
                let s = self.session()?;
                let snapshot = s
                    .export_snapshot_receipt(s.key(), s.revision())
                    .map_err(|e| Self::session_error(&e))?;
                let bytes = snapshot.document().len();
                if bytes > max_bytes as usize
                    || self
                        .snapshot_bytes()
                        .checked_add(bytes)
                        .is_none_or(|v| v > MAX_SNAPSHOT_TOTAL)
                {
                    return Err(diagnostic("sdk.snapshot_limit", "snapshot"));
                }
                let handle = format!("snapshot1:{}:{}", s.key().to_token(), self.next_snapshot);
                let value = SdkReply::Snapshot {
                    handle: handle.clone(),
                    canonical_json: String::from_utf8(snapshot.document().to_vec())
                        .map_err(|_| diagnostic("sdk.invalid_snapshot_utf8", "snapshot"))?,
                    stamp: stamp_out(snapshot.stamp()),
                    profile: profile_out(snapshot.binding()),
                    event_sequence: snapshot.event_cursor().sequence().to_string(),
                };
                self.next_snapshot += 1;
                self.snapshots.insert(handle, snapshot);
                SNAPSHOTS.fetch_add(1, Ordering::SeqCst);
                SNAPSHOT_BYTES.fetch_add(bytes as u64, Ordering::SeqCst);
                Ok(value)
            }
            BridgeRequest::AcknowledgeSnapshot { stamp, handle } => {
                self.check(&stamp)?;
                let snapshot = self
                    .snapshots
                    .get(&handle)
                    .ok_or_else(|| diagnostic("sdk.stale_snapshot", "handle"))?;
                let s = self
                    .session
                    .as_mut()
                    .ok_or_else(|| diagnostic("sdk.disposed", ""))?;
                let before = (s.saved_revision(), s.dirty());
                s.acknowledge_snapshot(snapshot)
                    .map_err(|e| Self::session_error(&e))?;
                self.mutation(
                    if before != (self.session()?.saved_revision(), self.session()?.dirty()) {
                        "state_changed"
                    } else {
                        "unchanged"
                    },
                    None,
                )
            }
            BridgeRequest::ReconcileSnapshot { stamp, handle } => {
                self.check(&stamp)?;
                let snapshot = self
                    .snapshots
                    .get(&handle)
                    .ok_or_else(|| diagnostic("sdk.stale_snapshot", "handle"))?;
                let s = self
                    .session
                    .as_mut()
                    .ok_or_else(|| diagnostic("sdk.disposed", ""))?;
                let changed = s
                    .reconcile_saved_snapshot(snapshot)
                    .map_err(|e| Self::session_error(&e))?;
                self.mutation(
                    if changed {
                        "state_changed"
                    } else {
                        "unchanged"
                    },
                    None,
                )
            }
            BridgeRequest::ReleaseSnapshot { handle } => {
                self.session()?;
                let snapshot = self
                    .snapshots
                    .remove(&handle)
                    .ok_or_else(|| diagnostic("sdk.stale_snapshot", "handle"))?;
                SNAPSHOTS.fetch_sub(1, Ordering::SeqCst);
                SNAPSHOT_BYTES.fetch_sub(snapshot.document().len() as u64, Ordering::SeqCst);
                Ok(SdkReply::Released {})
            }
            BridgeRequest::MapPosition {
                stamp,
                from_revision,
                position,
            } => {
                self.check(&stamp)?;
                let s = self.session()?;
                let result = s
                    .map_position(
                        s.key(),
                        decimal(&from_revision, "from_revision")?,
                        position_in(&position, s.key())?,
                    )
                    .map_err(|e| Self::session_error(&e))?;
                Ok(SdkReply::Mapped {
                    status: match result {
                        MapResult::Mapped(_) => "mapped",
                        MapResult::Deleted(_) => "deleted",
                        MapResult::Stale => "stale",
                        MapResult::Invalid(_) => "invalid",
                    }
                    .into(),
                    position: result.position().map(position_out),
                    deleted: result.is_deleted(),
                    stamp: stamp_out(s.stamp()),
                })
            }
            BridgeRequest::Events {} => {
                let s = self.session()?;
                let cursor = self
                    .cursor
                    .ok_or_else(|| diagnostic("sdk.disposed", "events"))?;
                match s.events_after(
                    s.key(),
                    cursor,
                    EventReadLimits::default(),
                    WorkLimits::default(),
                ) {
                    Ok(batch) => {
                        let through = batch.through();
                        let events = batch.iter().map(|v| event_out(v)).collect::<Vec<_>>();
                        if !events.is_empty() {
                            self.pending_cursor = Some(through);
                        }
                        Ok(SdkReply::Events {
                            events,
                            cursor: through.sequence().to_string(),
                            gap: false,
                        })
                    }
                    Err(SessionError::Events(EventError::Gap { head, .. })) => {
                        Ok(SdkReply::Events {
                            events: vec![],
                            cursor: head.sequence().to_string(),
                            gap: true,
                        })
                    }
                    Err(e) => Err(Self::session_error(&e)),
                }
            }
            BridgeRequest::AcknowledgeEvents { cursor } => {
                let through = self
                    .pending_cursor
                    .ok_or_else(|| diagnostic("events.stale_acknowledgement", "cursor"))?;
                if decimal(&cursor, "cursor")? != through.sequence() {
                    return Err(diagnostic("events.stale_acknowledgement", "cursor"));
                }
                let protection = self
                    .protection
                    .ok_or_else(|| diagnostic("sdk.disposed", "events"))?;
                let s = self.session_mut()?;
                s.acknowledge_events(s.key(), protection, through)
                    .map_err(|e| Self::session_error(&e))?;
                self.cursor = Some(through);
                self.pending_cursor = None;
                Ok(SdkReply::Released {})
            }
            BridgeRequest::Remount {
                stamp,
                input_json,
                admission,
            } => {
                self.check(&stamp)?;
                let access = self.access;
                let s = self.session_mut()?;
                let binding = s.binding().clone();
                s.remount(
                    s.key(),
                    &binding,
                    input_json.as_bytes(),
                    mode(admission),
                    access,
                )
                .map_err(|e| Self::session_error(&e))?;
                // Old generation capabilities have ceased to exist atomically.
                self.clear_snapshots();
                let s = self.session_mut()?;
                let cursor = s
                    .event_status(s.key())
                    .map_err(|e| Self::session_error(&e))?
                    .head;
                let protection = s
                    .protect_events(s.key(), ProtectionStart::Now)
                    .map_err(|e| Self::session_error(&e))?;
                self.cursor = Some(cursor);
                self.pending_cursor = None;
                self.protection = Some(protection);
                self.mutation("remounted", None)
            }
        }
    }
    fn snapshot_bytes(&self) -> usize {
        self.snapshots.values().map(|v| v.document().len()).sum()
    }
    pub fn own_resource_counts(&self) -> ResourceCountsDto {
        ResourceCountsDto {
            sessions: u32::from(self.session.is_some()),
            snapshot_handles: self.snapshots.len() as u32,
            snapshot_bytes: self.snapshot_bytes().to_string(),
            protected_cursors: u32::from(self.protection.is_some()),
        }
    }
    fn clear_snapshots(&mut self) {
        SNAPSHOTS.fetch_sub(self.snapshots.len() as u32, Ordering::SeqCst);
        SNAPSHOT_BYTES.fetch_sub(self.snapshot_bytes() as u64, Ordering::SeqCst);
        self.snapshots.clear();
    }
    pub fn destroy(&mut self) {
        self.clear_snapshots();
        if let Some(mut session) = self.session.take() {
            if let Some(p) = self.protection.take() {
                let _ = session.release_events(session.key(), p);
                PROTECTIONS.fetch_sub(1, Ordering::SeqCst);
            }
            let _ = session.close(session.key());
            SESSIONS.fetch_sub(1, Ordering::SeqCst);
        }
        self.cursor = None;
        self.pending_cursor = None;
    }
}
impl<P: CommandProvider, A: BridgeAdapter<P>> Drop for Bridge<P, A> {
    fn drop(&mut self) {
        self.destroy();
    }
}
impl<P: CommandProvider, A: BridgeAdapter<P>> Endpoint for Bridge<P, A> {
    fn initialization(&self) -> SdkResponse {
        Bridge::initialization(self)
    }
    fn call_json(&mut self, json: &str) -> String {
        Bridge::call_json_v2(self, json)
    }
    fn destroy(&mut self) {
        Bridge::destroy(self);
    }
    fn own_resource_counts(&self) -> ResourceCountsDto {
        Bridge::own_resource_counts(self)
    }
}
