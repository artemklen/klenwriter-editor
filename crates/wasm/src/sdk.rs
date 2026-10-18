// SPDX-License-Identifier: MIT OR Apache-2.0
//! Real Session bridge. No host callback runs inside a Rust borrow.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};

use editor_core::commands::{CommandProvider, SelectionIntent};
use editor_core::profile::{AdmissionMode, FrozenProfile};
use editor_core::transaction::WorkLimits;
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
use editor_engine::transaction::{DispatchOutcome, Transaction};
use editor_engine::{HistoryAvailability, HistoryOutcome, HistoryRequest};
use editor_kwdj::{
    AdmissionBudget, IdentityResolver, IdentityResolverError, IdentityStatus, KwdjProfile, Limits,
};
use serde::de::DeserializeOwned;
use uuid::Uuid;

use crate::sdk_convert::*;
use crate::sdk_wire::*;

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

#[derive(Default)]
struct Facts {
    media: BTreeMap<Uuid, IdentityFactStatusDto>,
    references: BTreeMap<Uuid, IdentityFactStatusDto>,
}
impl Facts {
    fn from_dto(v: IdentityFactsDto) -> Result<Self, DiagnosticDto> {
        fn entries(
            v: Vec<IdentityFactDto>,
        ) -> Result<BTreeMap<Uuid, IdentityFactStatusDto>, DiagnosticDto> {
            if v.len() > 256 {
                return Err(diagnostic("sdk.identity_limit", "identities"));
            }
            let mut result = BTreeMap::new();
            for fact in v {
                let id = Uuid::parse_str(&fact.id)
                    .map_err(|_| diagnostic("sdk.invalid_identity", "identities.id"))?;
                if id.to_string() != fact.id || result.insert(id, fact.status).is_some() {
                    return Err(diagnostic("sdk.invalid_identity", "identities.id"));
                }
            }
            Ok(result)
        }
        Ok(Self {
            media: entries(v.media)?,
            references: entries(v.references)?,
        })
    }
    fn resolve(v: Option<&IdentityFactStatusDto>) -> Result<IdentityStatus, IdentityResolverError> {
        match v {
            Some(IdentityFactStatusDto::Exists) => Ok(IdentityStatus::Exists),
            Some(IdentityFactStatusDto::Missing) => Ok(IdentityStatus::Missing),
            _ => Err(IdentityResolverError::Unavailable),
        }
    }
}
struct FactStore(RefCell<Facts>);
impl IdentityResolver for FactStore {
    fn resolve_media(&self, id: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Facts::resolve(self.0.borrow().media.get(id))
    }
    fn resolve_reference(&self, id: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Facts::resolve(self.0.borrow().references.get(id))
    }
}

fn mode(v: AdmissionDto) -> AdmissionMode {
    match v {
        AdmissionDto::Validate => AdmissionMode::Strict,
        AdmissionDto::Normalize => AdmissionMode::Import,
    }
}
fn access(v: &AccessDto) -> AccessMode {
    match v {
        AccessDto::Editable => AccessMode::Editable,
        AccessDto::ReadOnly => AccessMode::ReadOnly,
    }
}
fn direction(v: HistoryDirectionDto) -> HistoryDirection {
    match v {
        HistoryDirectionDto::Undo => HistoryDirection::Undo,
        HistoryDirectionDto::Redo => HistoryDirection::Redo,
    }
}

fn profile_limits(value: Option<ProfileLimitsDto>) -> Result<Limits, DiagnosticDto> {
    let mut limits = Limits::default();
    if let Some(value) = value {
        for (incoming, target, path) in [
            (
                value.document_bytes,
                &mut limits.document_bytes,
                "limits.document_bytes",
            ),
            (
                value.tree_depth,
                &mut limits.tree_depth,
                "limits.tree_depth",
            ),
            (
                value.node_count,
                &mut limits.node_count,
                "limits.node_count",
            ),
            (
                value.text_leaf_bytes,
                &mut limits.text_leaf_bytes,
                "limits.text_leaf_bytes",
            ),
            (
                value.table_rows,
                &mut limits.table_rows,
                "limits.table_rows",
            ),
            (
                value.table_effective_columns,
                &mut limits.table_effective_columns,
                "limits.table_effective_columns",
            ),
            (
                value.authored_attribute_bytes,
                &mut limits.authored_attribute_bytes,
                "limits.authored_attribute_bytes",
            ),
        ] {
            if let Some(incoming) = incoming {
                *target = (*target).min(decimal(&incoming, path)?);
            }
        }
    }
    Ok(limits)
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

pub fn manifest() -> SdkManifest {
    let facts = FactStore(RefCell::new(Facts::default()));
    let p = KwdjProfile::new(&facts, Limits::default(), AdmissionBudget::default());
    SdkManifest {
        abi: SDK_ABI.into(),
        build_id: BUILD_ID.into(),
        profiles: vec![profile_out(p.binding())],
    }
}
pub fn resource_counts() -> ResourceCountsDto {
    ResourceCountsDto {
        sessions: SESSIONS.load(Ordering::SeqCst),
        snapshot_handles: SNAPSHOTS.load(Ordering::SeqCst),
        snapshot_bytes: SNAPSHOT_BYTES.load(Ordering::SeqCst).to_string(),
        protected_cursors: PROTECTIONS.load(Ordering::SeqCst),
    }
}

pub struct BridgeSession {
    session: Option<Session<KwdjProfile<'static>>>,
    facts: Rc<FactStore>,
    access: AccessMode,
    protection: Option<ProtectedCursor>,
    cursor: Option<EventCursor>,
    pending_cursor: Option<EventCursor>,
    snapshots: BTreeMap<String, Snapshot>,
    next_snapshot: u64,
    initialization: SdkResponse,
    fatal: Option<DiagnosticDto>,
}

impl BridgeSession {
    pub fn new(input: &[u8], options_json: &str) -> Self {
        let mut this = Self {
            session: None,
            facts: Rc::new(FactStore(RefCell::new(Facts::default()))),
            access: AccessMode::Editable,
            protection: None,
            cursor: None,
            pending_cursor: None,
            snapshots: BTreeMap::new(),
            next_snapshot: 1,
            initialization: SdkResponse::Refused {
                diagnostic: diagnostic("sdk.not_initialized", ""),
            },
            fatal: None,
        };
        this.initialization = match this.open(input, options_json) {
            Ok(state) => SdkResponse::Ok {
                value: Box::new(SdkReply::State { state }),
            },
            Err(diagnostic) => SdkResponse::Refused { diagnostic },
        };
        this
    }
    fn open(&mut self, input: &[u8], json: &str) -> Result<StateDto, DiagnosticDto> {
        if input.len() > 16 * 1024 * 1024 {
            return Err(diagnostic("sdk.payload_limit", "input"));
        }
        let options: OpenOptions = decode(json)?;
        if options.abi != SDK_ABI {
            return Err(diagnostic("sdk.abi_mismatch", "abi"));
        }
        if options.build_id != BUILD_ID {
            return Err(diagnostic("sdk.build_mismatch", "build_id"));
        }
        // Validate exact profile manifest before decoding any document bytes.
        let binding = profile_in(&options.profile)?;
        let facts = Rc::new(FactStore(RefCell::new(Facts::from_dto(
            options.identities,
        )?)));
        let profile = KwdjProfile::new_owned(
            facts.clone(),
            profile_limits(options.limits)?,
            AdmissionBudget::default(),
        );
        profile
            .binding()
            .ensure_matches(&binding)
            .map_err(|e| diagnostic(e.as_str(), "profile"))?;
        self.access = access(&options.access);
        let mut session = Session::open(
            profile,
            &binding,
            input,
            mode(options.admission),
            self.access,
        )
        .map_err(|e| session_error(&e))?;
        let cursor = session
            .event_status(session.key())
            .map_err(|e| session_error(&e))?
            .head;
        let protection = session
            .protect_events(session.key(), ProtectionStart::Now)
            .map_err(|e| session_error(&e))?;
        SESSIONS
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |v| {
                (v < 256).then_some(v + 1)
            })
            .map_err(|_| diagnostic("sdk.session_limit", ""))?;
        PROTECTIONS.fetch_add(1, Ordering::SeqCst);
        self.session = Some(session);
        self.facts = facts;
        self.cursor = Some(cursor);
        self.protection = Some(protection);
        self.state()
    }
    fn session(&self) -> Result<&Session<KwdjProfile<'static>>, DiagnosticDto> {
        self.session
            .as_ref()
            .ok_or_else(|| diagnostic("sdk.disposed", ""))
    }
    fn session_mut(&mut self) -> Result<&mut Session<KwdjProfile<'static>>, DiagnosticDto> {
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
    fn state(&self) -> Result<StateDto, DiagnosticDto> {
        let s = self.session()?;
        let key = s.key();
        Ok(StateDto {
            stamp: stamp_out(s.stamp()),
            root: s.root(key).map_err(|e| session_error(&e))?.to_token(),
            selection: s
                .selection(key)
                .map_err(|e| session_error(&e))?
                .map(selection_out),
            stored_marks: s
                .stored_marks(key)
                .map_err(|e| session_error(&e))?
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
        outcome: DispatchOutcome<editor_kwdj::KwdjProfileError>,
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
            DispatchOutcome::Refused { error, .. } => Err(transaction_error(&error)),
        }
    }
    fn command_request(
        &self,
        stamp: &StampDto,
        command: CommandDto,
        hint: HistoryHintDto,
    ) -> Result<
        CommandRequest<editor_kwdj::commands::KwdjIntent<editor_engine::NodeId>>,
        DiagnosticDto,
    > {
        self.check(stamp)?;
        let s = self.session()?;
        let intent = intent_in(decode::<KwdjIntentDto>(&command.payload_json)?, s.key())?;
        if KwdjProfile::command_id(&intent) != command.id {
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
    fn command_error(e: &CommandError<editor_kwdj::KwdjProfileError>) -> DiagnosticDto {
        match e {
            CommandError::Catalog(e) => diagnostic(e.as_str(), "command"),
            CommandError::UnknownCommand => diagnostic("command.unknown", "command.id"),
            CommandError::Transaction(e) => transaction_error(e),
        }
    }
    pub fn call(&mut self, request: SdkRequest) -> SdkResponse {
        if let Some(diagnostic) = &self.fatal {
            return SdkResponse::Fatal {
                diagnostic: diagnostic.clone(),
            };
        }
        let fingerprint = |s: &Session<KwdjProfile<'static>>| {
            (
                s.stamp(),
                s.dirty(),
                s.saved_revision(),
                s.event_status(s.key()).ok().map(|v| v.head.sequence()),
            )
        };
        let before = self.session.as_ref().map(fingerprint);
        let result = self.execute(request);
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
    pub fn call_json(&mut self, json: &str) -> String {
        let response = match decode(json) {
            Ok(request) => self.call(request),
            Err(diagnostic) => SdkResponse::Refused { diagnostic },
        };
        // DTO encode happens after native publication. A conversion failure is
        // fatal/indeterminate, never a retroactive ordinary refusal.
        self.encode_response(response, false)
    }
    fn encode_response(&mut self, response: SdkResponse, force_failure: bool) -> String {
        if !force_failure && let Ok(json) = serde_json::to_string(&response) {
            return json;
        }
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
    fn execute(&mut self, request: SdkRequest) -> Result<SdkReply, DiagnosticDto> {
        match request {
            SdkRequest::Destroy {} => {
                self.destroy();
                Ok(SdkReply::Destroyed {})
            }
            SdkRequest::Resources {} => Ok(SdkReply::Resources {
                resources: self.own_resource_counts(),
            }),
            SdkRequest::State {} => Ok(SdkReply::State {
                state: self.state()?,
            }),
            SdkRequest::Catalog {} => {
                self.session()?;
                Ok(SdkReply::Catalog {
                    commands: <KwdjProfile as CommandProvider>::COMMANDS
                        .iter()
                        .map(|v| v.id.into())
                        .collect(),
                })
            }
            SdkRequest::Node { stamp, node } => {
                self.check(&stamp)?;
                let s = self.session()?;
                let id = s
                    .key()
                    .parse_node_token(&node)
                    .map_err(|e| diagnostic(e.as_str(), "node"))?;
                let n = s
                    .node_at(s.key(), s.revision(), id)
                    .map_err(|e| session_error(&e))?;
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
            SdkRequest::QueryCommand { stamp, command } => {
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
            SdkRequest::Command {
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
            SdkRequest::QueryHistory { stamp, direction } => {
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
                        diagnostic: Some(transaction_error(&error)),
                    },
                })
            }
            SdkRequest::History { stamp, direction } => {
                let r = self.history_request(&stamp, direction)?;
                match self.session_mut()?.execute_history(&r) {
                    HistoryOutcome::Completed(_) => self.mutation("changed", None),
                    HistoryOutcome::Refused { error, .. } => Err(transaction_error(&error)),
                }
            }
            SdkRequest::SetSelection { stamp, selection } => {
                self.check(&stamp)?;
                let s = self.session()?;
                let outcome = if let Some(selection) = selection {
                    let selection = selection_in(&selection, s.key())?;
                    let before = s.stamp();
                    let s = self.session_mut()?;
                    s.set_selection(s.key(), s.revision(), selection)
                        .map_err(|e| session_error(&e))?;
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
            SdkRequest::SetStoredMarks { stamp, marks } => {
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
            SdkRequest::Barrier { stamp } => {
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
                    .map_err(|e| transaction_error(&e))?;
                self.mutation(
                    if event.changed {
                        "state_changed"
                    } else {
                        "unchanged"
                    },
                    None,
                )
            }
            SdkRequest::Snapshot { stamp, max_bytes } => {
                self.check(&stamp)?;
                if self.snapshots.len() >= MAX_SNAPSHOT_HANDLES || self.next_snapshot == u64::MAX {
                    return Err(diagnostic("sdk.snapshot_limit", "snapshot"));
                }
                let s = self.session()?;
                let snapshot = s
                    .export_snapshot_receipt(s.key(), s.revision())
                    .map_err(|e| session_error(&e))?;
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
            SdkRequest::AcknowledgeSnapshot { stamp, handle } => {
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
                    .map_err(|e| session_error(&e))?;
                self.mutation(
                    if before != (self.session()?.saved_revision(), self.session()?.dirty()) {
                        "state_changed"
                    } else {
                        "unchanged"
                    },
                    None,
                )
            }
            SdkRequest::ReconcileSnapshot { stamp, handle } => {
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
                    .map_err(|e| session_error(&e))?;
                self.mutation(
                    if changed {
                        "state_changed"
                    } else {
                        "unchanged"
                    },
                    None,
                )
            }
            SdkRequest::ReleaseSnapshot { handle } => {
                self.session()?;
                let snapshot = self
                    .snapshots
                    .remove(&handle)
                    .ok_or_else(|| diagnostic("sdk.stale_snapshot", "handle"))?;
                SNAPSHOTS.fetch_sub(1, Ordering::SeqCst);
                SNAPSHOT_BYTES.fetch_sub(snapshot.document().len() as u64, Ordering::SeqCst);
                Ok(SdkReply::Released {})
            }
            SdkRequest::MapPosition {
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
                    .map_err(|e| session_error(&e))?;
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
            SdkRequest::Events {} => {
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
                    Err(e) => Err(session_error(&e)),
                }
            }
            SdkRequest::AcknowledgeEvents { cursor } => {
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
                    .map_err(|e| session_error(&e))?;
                self.cursor = Some(through);
                self.pending_cursor = None;
                Ok(SdkReply::Released {})
            }
            SdkRequest::Remount {
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
                .map_err(|e| session_error(&e))?;
                // Old generation capabilities have ceased to exist atomically.
                self.clear_snapshots();
                let s = self.session_mut()?;
                let cursor = s.event_status(s.key()).map_err(|e| session_error(&e))?.head;
                let protection = s
                    .protect_events(s.key(), ProtectionStart::Now)
                    .map_err(|e| session_error(&e))?;
                self.cursor = Some(cursor);
                self.pending_cursor = None;
                self.protection = Some(protection);
                self.mutation("remounted", None)
            }
            SdkRequest::UpdateFacts { stamp, identities } => {
                self.check(&stamp)?;
                let facts = Facts::from_dto(identities)?;
                *self.facts.0.borrow_mut() = facts;
                self.mutation("context_updated", None)
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
impl Drop for BridgeSession {
    fn drop(&mut self) {
        self.destroy();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use editor_core::positions::{Affinity, Position, Selection, Utf16Offset};

    #[test]
    fn post_commit_transport_failure_is_fatal_and_releases_real_resources() {
        let manifest = manifest();
        let options = OpenOptions {
            abi: manifest.abi,
            build_id: manifest.build_id,
            profile: manifest.profiles[0].clone(),
            admission: AdmissionDto::Validate,
            access: AccessDto::Editable,
            identities: IdentityFactsDto::default(),
            limits: None,
        };
        let original = br#"{"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[{"type":"text","text":"a"}]}]}"#;
        let mut bridge = BridgeSession::new(original, &serde_json::to_string(&options).unwrap());
        assert!(matches!(bridge.initialization(), SdkResponse::Ok { .. }));
        let s = bridge.session_mut().unwrap();
        let root = s.root(s.key()).unwrap();
        let block = s.node(s.key(), root).unwrap().children()[0];
        let leaf = s.node(s.key(), block).unwrap().children()[0];
        let caret = Position::Text {
            leaf,
            utf16: Utf16Offset::new(1),
            affinity: Affinity::After,
        };
        s.set_selection(
            s.key(),
            s.revision(),
            Selection {
                anchor: caret,
                focus: caret,
            },
        )
        .unwrap();
        let response = bridge.call(SdkRequest::Command {
            stamp: bridge.state().unwrap().stamp,
            command: CommandDto {
                id: "org.klenwriter.kwdj/command/insert-text".into(),
                payload_json: r#"{"kind":"insert_text","text":"X"}"#.into(),
            },
            history_hint: HistoryHintDto::Isolated {},
        });
        assert!(
            matches!(&response, SdkResponse::Ok { value } if matches!(value.as_ref(), SdkReply::Mutation { effect, .. } if effect=="changed"))
        );
        let s = bridge.session().unwrap();
        assert_eq!(s.revision(), 1);
        let actual: serde_json::Value =
            serde_json::from_slice(&s.export_snapshot(s.key(), 1).unwrap()).unwrap();
        assert_eq!(actual["content"][0]["content"][0]["text"], "aX");
        let fatal: SdkResponse =
            serde_json::from_str(&bridge.encode_response(response, true)).unwrap();
        let SdkResponse::Fatal { diagnostic } = fatal else {
            panic!("post-commit failure is not ordinary Refused");
        };
        assert!(diagnostic.may_have_committed);
        assert_eq!(diagnostic.code, "sdk.transport_failed");
        assert_eq!(diagnostic.stamp.as_ref().unwrap().revision, "1");
        assert_eq!(
            bridge.own_resource_counts(),
            ResourceCountsDto {
                sessions: 0,
                snapshot_handles: 0,
                snapshot_bytes: "0".into(),
                protected_cursors: 0
            }
        );
        assert!(matches!(
            bridge.call(SdkRequest::State {}),
            SdkResponse::Fatal { .. }
        ));
        bridge.destroy();
        bridge.destroy();
    }
}
