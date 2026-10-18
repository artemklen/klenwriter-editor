// SPDX-License-Identifier: MIT OR Apache-2.0
//! Standalone public-API reliability consumer; no production/browser linkage.
pub mod model;
pub mod properties;

use editor_core::commands::CommandProvider;
use editor_core::document::{Attributes, Mark, Primitive};
use editor_core::positions::{Affinity, Edge, Position, Selection, Utf16Offset};
use editor_core::profile::{AdmissionMode, ExtensionBinding, FrozenProfile, ProfileBinding};
use editor_core::transaction::{WorkLimits, WorkMeter};
use editor_engine::events::{EventStatus, SessionStamp};
use editor_engine::{
    AccessMode, CommandAvailability, CommandEffect, CommandOutcome, CommandRequest,
    DispatchOutcome, HistoryAvailability, HistoryDirection, HistoryOutcome, HistoryRequest,
    HistorySummary, JournalEntrySummary, JournalSummary, NodeId, Session, Transaction,
};
use editor_kwdj::{
    AdmissionBudget, IdentityResolver, IdentityResolverError, IdentityStatus, KwdjProfile, Limits,
};
use editor_notes::{NativeNotesIntent, NotesLimits, NotesProfile};
use editor_registry::CompilerLimits;
use model::{
    Action, Expected, HarnessFailure, LogicalSelection, Reachability, ReplayReport, Scenario,
};
use std::collections::BTreeMap;
use std::fmt::Debug;
use std::rc::Rc;

pub struct ExistingFacts;
impl IdentityResolver for ExistingFacts {
    fn resolve_media(&self, _: &uuid::Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(IdentityStatus::Exists)
    }
    fn resolve_reference(&self, _: &uuid::Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(IdentityStatus::Exists)
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
struct Record {
    id: NodeId,
    parent: Option<NodeId>,
    children: Vec<NodeId>,
    primitive: Option<Primitive>,
    type_id: Option<String>,
    attrs: Option<Attributes>,
    marks: Vec<Mark>,
    text: Option<String>,
    changed_revision: u64,
    stats: editor_engine::NodeStats,
}
#[derive(Debug, Clone, PartialEq, Eq)]
struct Facets {
    records: Vec<Record>,
    stamp: SessionStamp,
    selection: Option<Selection<NodeId>>,
    marks: Option<Vec<Mark>>,
    dirty: bool,
    saved: u64,
    history: HistorySummary,
    journal: JournalSummary,
    entries: Vec<JournalEntrySummary>,
    events: EventStatus,
    binding: ProfileBinding,
    state: editor_engine::SessionState,
}
fn fail(
    s: &Scenario,
    action: Option<usize>,
    phase: &str,
    invariant: &str,
    detail: impl Debug,
) -> HarnessFailure {
    HarnessFailure::at(&s.id, action, phase, invariant, detail)
}
fn capture<P: CommandProvider>(session: &Session<P>) -> Facets
where
    P::Error: Debug,
{
    let key = session.key();
    let mut pending = vec![session.root(key).unwrap()];
    let mut records = vec![];
    while let Some(id) = pending.pop() {
        let read = session.node_at(key, session.revision(), id).unwrap();
        let n = read.node;
        pending.extend(n.children().iter().rev().copied());
        records.push(Record {
            id,
            parent: n.parent(),
            children: n.children().to_vec(),
            primitive: n.primitive(),
            type_id: n.type_id().map(str::to_owned),
            attrs: n.attributes().cloned(),
            marks: n.marks().to_vec(),
            text: n.text().map(str::to_owned),
            changed_revision: read.changed_revision,
            stats: read.stats,
        });
    }
    Facets {
        records,
        stamp: session.stamp(),
        selection: session.selection(key).unwrap(),
        marks: session.stored_marks(key).unwrap().map(<[Mark]>::to_vec),
        dirty: session.dirty(),
        saved: session.saved_revision(),
        history: session.history_summary(),
        journal: session.journal_summary(),
        entries: session.journal_entries(),
        events: session.event_status(key).unwrap(),
        binding: session.binding().clone(),
        state: session.state(),
    }
}
fn path<P: CommandProvider>(session: &Session<P>, indices: &[usize]) -> Option<NodeId> {
    let mut id = session.root(session.key()).ok()?;
    for &index in indices {
        id = *session
            .node(session.key(), id)
            .ok()?
            .children()
            .get(index)?;
    }
    Some(id)
}
fn logical_point<P: CommandProvider>(
    session: &Session<P>,
    block: NodeId,
    p: Position<NodeId>,
) -> Option<usize> {
    let children = session.node(session.key(), block).ok()?.children();
    let mut offset = 0;
    for &id in children {
        let n = session.node(session.key(), id).ok()?;
        let len = n.text()?.encode_utf16().count();
        match p {
            Position::Text { leaf, utf16, .. } if leaf == id => return Some(offset + utf16.get()),
            Position::Edge { node, side } if node == id => {
                return Some(offset + if side == Edge::After { len } else { 0 });
            }
            _ => {}
        }
        offset += len;
    }
    match p {
        Position::Child { parent, index, .. } if parent == block && index <= children.len() => {
            children.iter().take(index).try_fold(0, |sum, id| {
                Some(
                    sum + session
                        .node(session.key(), *id)
                        .ok()?
                        .text()?
                        .encode_utf16()
                        .count(),
                )
            })
        }
        Position::Edge { node, side } if node == block => {
            Some(if side == Edge::After { offset } else { 0 })
        }
        _ => None,
    }
}
fn physical<P: CommandProvider>(
    session: &Session<P>,
    block: NodeId,
    offset: usize,
) -> Option<Position<NodeId>> {
    let children = session.node(session.key(), block).ok()?.children();
    let mut total = 0;
    for &id in children {
        let n = session.node(session.key(), id).ok()?;
        let len = n.text()?.encode_utf16().count();
        if offset <= total + len {
            return Some(Position::Text {
                leaf: id,
                utf16: Utf16Offset::new(offset - total),
                affinity: Affinity::After,
            });
        }
        total += len;
    }
    (offset == 0 && children.is_empty()).then_some(Position::Child {
        parent: block,
        index: 0,
        affinity: Affinity::After,
    })
}
fn checkpoint<P: CommandProvider>(
    session: &Session<P>,
    block: NodeId,
    expected: &Expected,
    s: &Scenario,
    action: Option<usize>,
    reach: &mut Reachability,
) -> Result<Vec<NodeId>, HarnessFailure>
where
    P::Error: Debug,
{
    let key = session.key();
    let bytes = session
        .export_snapshot(key, session.revision())
        .map_err(|e| fail(s, action, "checkpoint", "export", e))?;
    reach.snapshot_exports += 1;
    if bytes != expected.canonical_json.as_bytes() {
        return Err(fail(
            s,
            action,
            "checkpoint",
            "exact_canonical",
            format!(
                "actual={} expected={}",
                String::from_utf8_lossy(&bytes),
                expected.canonical_json
            ),
        ));
    }
    let actual = match session
        .selection(key)
        .map_err(|e| fail(s, action, "checkpoint", "selection_read", e))?
    {
        None => None,
        Some(sel) => Some(LogicalSelection {
            anchor_utf16: logical_point(session, block, sel.anchor)
                .ok_or_else(|| fail(s, action, "checkpoint", "anchor_projection", sel.anchor))?,
            focus_utf16: logical_point(session, block, sel.focus)
                .ok_or_else(|| fail(s, action, "checkpoint", "focus_projection", sel.focus))?,
        }),
    };
    if actual != expected.selection {
        return Err(fail(
            s,
            action,
            "checkpoint",
            "exact_logical_selection",
            (actual, expected.selection.clone()),
        ));
    }
    let history = session.history_summary();
    if (history.undo_units, history.redo_units)
        != (expected.history.undo_units, expected.history.redo_units)
    {
        return Err(fail(
            s,
            action,
            "checkpoint",
            "exact_history_units",
            (history, expected.history.clone()),
        ));
    }
    if session.revision().to_string() != expected.document_revision
        || session.dirty() != expected.dirty
    {
        return Err(fail(
            s,
            action,
            "checkpoint",
            "revision_dirty",
            (
                session.revision(),
                session.dirty(),
                &expected.document_revision,
                expected.dirty,
            ),
        ));
    }
    if session
        .stored_marks(key)
        .map_err(|e| fail(s, action, "checkpoint", "marks_read", e))?
        .is_some()
    {
        return Err(fail(
            s,
            action,
            "checkpoint",
            "inherit_marks",
            "finite scenarios never set future override",
        ));
    }
    Ok(capture(session).records.into_iter().map(|r| r.id).collect())
}
fn record_event(event: &editor_engine::CommitEvent, reach: &mut Reachability) {
    reach.work_units += event.work.units;
    reach.work_bytes += event.work.bytes;
    reach.normalization_operations += event.normalization_operations as u64;
    for i in 0..13 {
        reach.phase_visits[i] += event.trace.phases[i].visits;
        reach.phase_bytes[i] += event.trace.phases[i].bytes;
    }
}
fn replay<P, F>(
    mut session: Session<P>,
    s: &Scenario,
    intent: F,
) -> Result<ReplayReport, HarnessFailure>
where
    P: CommandProvider,
    P::Error: Debug,
    F: Fn(String) -> P::Intent<NodeId>,
{
    let block = path(&session, &s.initial_labels.block)
        .ok_or_else(|| fail(s, None, "bind", "block_path", &s.initial_labels.block))?;
    let primary = path(&session, &s.initial_labels.primary_leaf).ok_or_else(|| {
        fail(
            s,
            None,
            "bind",
            "primary_leaf_path",
            &s.initial_labels.primary_leaf,
        )
    })?;
    let mut reach = Reachability {
        admission_attempts: 1,
        admitted: 1,
        compiler_attempts: 1,
        compiled: 1,
        ..Default::default()
    };
    let initial_ids = checkpoint(&session, block, &s.initial_expected, s, None, &mut reach)?;
    let mut expected_identity_by_canonical =
        BTreeMap::from([(s.initial_expected.canonical_json.clone(), initial_ids)]);
    for (index, action) in s.actions.iter().enumerate() {
        let before = capture(&session);
        let cursor = before.events.head;
        match action {
            Action::Select { from, to, .. } => {
                let selection = Selection {
                    anchor: physical(&session, block, *from)
                        .ok_or_else(|| fail(s, Some(index), "selection", "anchor", from))?,
                    focus: physical(&session, block, *to)
                        .ok_or_else(|| fail(s, Some(index), "selection", "focus", to))?,
                };
                session
                    .set_selection(session.key(), session.revision(), selection)
                    .map_err(|e| fail(s, Some(index), "selection", "admission", e))?;
            }
            Action::InsertText { text, isolated, .. } => {
                if !isolated {
                    return Err(fail(
                        s,
                        Some(index),
                        "input",
                        "isolated_request_required",
                        isolated,
                    ));
                }
                let stamp = session.stamp();
                let mut request = CommandRequest::new(
                    stamp.session,
                    stamp.revision,
                    stamp.selection_epoch,
                    intent(text.clone()),
                );
                request.history_epoch = Some(stamp.history_epoch);
                let available = session.query_command(&request);
                reach.command_queries += 1;
                if capture(&session) != before {
                    return Err(fail(
                        s,
                        Some(index),
                        "query",
                        "all_public_facets_pure",
                        available,
                    ));
                }
                let (query_work, query_sel, query_marks) = match available {
                    CommandAvailability::Available {
                        effect: CommandEffect::Changed,
                        work,
                        selection_changed,
                        stored_marks_changed,
                        ..
                    } => (work, selection_changed, stored_marks_changed),
                    other => {
                        return Err(fail(
                            s,
                            Some(index),
                            "query",
                            "expected_changed_available",
                            other,
                        ));
                    }
                };
                let event = match session.execute_command(&request) {
                    CommandOutcome::Completed {
                        outcome: DispatchOutcome::Changed(event),
                        ..
                    } => event,
                    other => {
                        return Err(fail(
                            s,
                            Some(index),
                            "execute",
                            "query_effect_parity",
                            other,
                        ));
                    }
                };
                if query_work != event.work
                    || query_sel != (before.selection != session.selection(session.key()).unwrap())
                    || query_marks
                        != (before.marks
                            != session
                                .stored_marks(session.key())
                                .unwrap()
                                .map(<[Mark]>::to_vec))
                {
                    return Err(fail(
                        s,
                        Some(index),
                        "execute",
                        "query_work_flags_parity",
                        (query_work, event.work),
                    ));
                }
                record_event(&event, &mut reach);
                reach.command_publications += 1;
            }
            Action::Undo { .. } | Action::Redo { .. } => {
                let stamp = session.stamp();
                let direction = if matches!(action, Action::Undo { .. }) {
                    HistoryDirection::Undo
                } else {
                    HistoryDirection::Redo
                };
                let request = HistoryRequest::new(
                    stamp.session,
                    stamp.revision,
                    stamp.selection_epoch,
                    stamp.history_epoch,
                    direction,
                );
                let available = session.query_history(&request);
                reach.history_queries += 1;
                if capture(&session) != before {
                    return Err(fail(
                        s,
                        Some(index),
                        "history_query",
                        "all_public_facets_pure",
                        available,
                    ));
                }
                let work = match available {
                    HistoryAvailability::Available { work, .. } => work,
                    other => {
                        return Err(fail(s, Some(index), "history_query", "availability", other));
                    }
                };
                let event = match session.execute_history(&request) {
                    HistoryOutcome::Completed(event) => event,
                    other => {
                        return Err(fail(
                            s,
                            Some(index),
                            "history_execute",
                            "availability_parity",
                            other,
                        ));
                    }
                };
                if work != event.work {
                    return Err(fail(
                        s,
                        Some(index),
                        "history_execute",
                        "work_parity",
                        (work, event.work),
                    ));
                }
                record_event(&event, &mut reach);
                reach.history_publications += 1;
            }
        }
        let expected = action.expected();
        let ids = checkpoint(&session, block, expected, s, Some(index), &mut reach)?;
        if !ids.contains(&block) {
            return Err(fail(
                s,
                Some(index),
                "identity",
                "bound_block_still_live",
                block,
            ));
        }
        // This finite sentinel subset keeps one canonical leaf. It must retain its
        // original identity across replacements, undo, redo (no path retargeting).
        if !ids.contains(&primary) {
            return Err(fail(
                s,
                Some(index),
                "identity",
                "bound_primary_leaf_still_live",
                primary,
            ));
        }
        if matches!(action, Action::Undo { .. } | Action::Redo { .. }) {
            if let Some(saved) = expected_identity_by_canonical.get(&expected.canonical_json)
                && saved != &ids
            {
                return Err(fail(
                    s,
                    Some(index),
                    "history_execute",
                    "exact_saved_ids",
                    (&ids, saved),
                ));
            }
        } else {
            expected_identity_by_canonical.insert(expected.canonical_json.clone(), ids.clone());
        }
        let batch = session
            .events_after(
                session.key(),
                cursor,
                Default::default(),
                WorkLimits::default(),
            )
            .map_err(|e| fail(s, Some(index), "events", "actual_read", e))?;
        reach.event_reads += 1;
        let expected_events = if before.stamp == session.stamp() {
            0
        } else {
            1
        };
        if batch.iter().count() != expected_events {
            return Err(fail(
                s,
                Some(index),
                "events",
                "one_coherent_notification",
                (batch.iter().count(), expected_events),
            ));
        }
    }
    session
        .close(session.key())
        .map_err(|e| fail(s, None, "lifecycle", "close", e))?;
    reach.closed = 1;
    Ok(ReplayReport {
        id: s.id.clone(),
        context: s.context,
        seed: s.seed,
        actions: s.actions.len(),
        checkpoints: s.actions.len() + 1,
        exact_canonical_selection_history: true,
        all_query_facets_pure: true,
        query_execute_work_equal: true,
        all_original_identity_restoration: true,
        reachability: reach,
    })
}
fn requested_binding(s: &Scenario) -> Result<ProfileBinding, HarnessFailure> {
    let p = &s.profile;
    let extensions = p
        .extensions
        .iter()
        .map(|e| ExtensionBinding::new(&e.id, &e.version))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| fail(s, None, "binding", "extensions", e))?;
    ProfileBinding::new(
        &p.profile_id,
        &p.profile_version,
        &p.codec_id,
        u64::from(p.wire_version),
        &extensions,
    )
    .map_err(|e| fail(s, None, "binding", "exact_scenario", e))
}
/// Replays only the frozen finite model. Raw admission strings reach the actual
/// profile constructor untouched; no production result constructs expectations.
pub fn replay_scenario(s: &Scenario) -> Result<ReplayReport, HarnessFailure> {
    if s.format != "editor-reliability-scenario/1"
        || s.model != "finite-token-paragraph/1"
        || s.admission != "validate"
        || s.actions.len() > 64
        || s.input_json.len() > 16384
    {
        return Err(fail(s, None, "input", "scenario_bounds", &s.id));
    }
    let mut work = WorkMeter::new(WorkLimits::default());
    if s.context.is_kwdj() {
        let p = KwdjProfile::new_owned(
            Rc::new(ExistingFacts),
            Limits::default(),
            AdmissionBudget::default(),
        )
        .with_registry_json(
            s.registry_json.as_bytes(),
            CompilerLimits::default(),
            &mut work,
        )
        .map_err(|e| fail(s, None, "registry", "compile", e))?;
        let binding = requested_binding(s)?;
        let session = Session::open(
            p,
            &binding,
            s.input_json.as_bytes(),
            AdmissionMode::Strict,
            AccessMode::Editable,
        )
        .map_err(|e| fail(s, None, "admission", "strict_open", e))?;
        replay(session, s, |text| {
            editor_kwdj::commands::KwdjIntent::InsertText { text }
        })
    } else {
        let options: serde_json::Value = serde_json::from_str(&s.profile_options_json)
            .map_err(|e| fail(s, None, "input", "profile_options", e))?;
        let roots = options["root_blocks"]
            .as_array()
            .ok_or_else(|| fail(s, None, "input", "root_blocks", &options))?
            .iter()
            .map(|v| {
                v.as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| fail(s, None, "input", "root_block_string", v))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let p = NotesProfile::compile_json(
            s.registry_json.as_bytes(),
            &roots,
            NotesLimits::default(),
            CompilerLimits::default(),
            &mut work,
        )
        .map_err(|e| fail(s, None, "registry", "compile", e))?;
        let binding = requested_binding(s)?;
        let session = Session::open(
            p,
            &binding,
            s.input_json.as_bytes(),
            AdmissionMode::Strict,
            AccessMode::Editable,
        )
        .map_err(|e| fail(s, None, "admission", "strict_open", e))?;
        replay(session, s, |text| NativeNotesIntent::InsertText { text })
    }
}

pub const FUZZ_BUILD_ID: &str = "osr38-native-fuzz-fixture";
fn default_notes(context: model::Context) -> NotesProfile {
    let raw = if context == model::Context::NotesD1 {
        include_bytes!("../../../../examples/notes-extension/d1.json").as_slice()
    } else {
        include_bytes!("../../../../examples/notes-extension/d0.json").as_slice()
    };
    let mut roots = vec![editor_notes::PARAGRAPH.into()];
    if context == model::Context::NotesD1 {
        roots.push("org.example.notes/callout".into());
    }
    NotesProfile::compile_json(
        raw,
        &roots,
        NotesLimits::default(),
        CompilerLimits::default(),
        &mut WorkMeter::new(WorkLimits::default()),
    )
    .expect("frozen valid notes registry")
}
fn fuzz_wire(context: model::Context) -> Vec<u8> {
    let value = if context.is_kwdj() {
        serde_json::json!({"schema":"klenwriter.document","schema_version":1,"profile":if context==model::Context::KwdjPoetry{"poetry"}else{"prose"},"content":[{"type":"paragraph","content":[{"type":"text","text":"ab"}]}]})
    } else {
        serde_json::json!({"schema_version":1,"root":{"type":"org.example.notes/document","attrs":{"title":"Fuzz","tags":[]},"marks":[],"text":null,"children":[{"type":"org.example.notes/paragraph","attrs":{},"marks":[],"text":null,"children":[{"type":"org.example.notes/text","attrs":{},"marks":if context==model::Context::NotesD1{serde_json::json!([{"type":"org.example.notes/highlight","attrs":{"color":"sun"}}])}else{serde_json::json!([])},"text":"ab","children":[]}]}]}})
    };
    serde_json::to_vec(&value).unwrap()
}
fn fuzz_admitted<P: CommandProvider>(mut s: Session<P>, r: &mut Reachability)
where
    P::Error: Debug,
{
    r.admitted += 1;
    let key = s.key();
    let b = s
        .export_snapshot(key, s.revision())
        .expect("admitted export must remain valid");
    r.snapshot_exports += 1;
    let binding = s.binding().clone();
    let next = s
        .remount(
            key,
            &binding,
            &b,
            AdmissionMode::Strict,
            AccessMode::Editable,
        )
        .expect("canonical remount");
    r.admission_attempts += 1;
    r.admitted += 1;
    assert_ne!(key, next);
    assert!(s.root(key).is_err());
    assert_eq!(s.export_snapshot(next, 0).unwrap(), b);
    r.snapshot_exports += 1;
    let imported = s
        .remount(
            next,
            &binding,
            &b,
            AdmissionMode::Import,
            AccessMode::Editable,
        )
        .expect("canonical re-normalization");
    r.admission_attempts += 1;
    r.admitted += 1;
    assert_eq!(s.export_snapshot(imported, 0).unwrap(), b);
    r.snapshot_exports += 1;
    s.close(imported).unwrap();
    r.closed += 1;
}
/// The original raw bytes reach both real admission modes before any harness
/// JSON parse. Typed refusal is expected; panic/trap is never converted to pass.
pub fn fuzz_admission(context: model::Context, raw: &[u8]) -> Reachability {
    let mut r = Reachability::default();
    for mode in [AdmissionMode::Strict, AdmissionMode::Import] {
        r.admission_attempts += 1;
        if context.is_kwdj() {
            let p = KwdjProfile::new_owned(
                Rc::new(ExistingFacts),
                Limits::default(),
                AdmissionBudget::default(),
            );
            let binding = p.binding().clone();
            if let Ok(s) = Session::open(p, &binding, raw, mode, AccessMode::Editable) {
                fuzz_admitted(s, &mut r);
            }
        } else {
            let p = default_notes(context);
            let binding = p.binding().clone();
            if let Ok(s) = Session::open(p, &binding, raw, mode, AccessMode::Editable) {
                fuzz_admitted(s, &mut r);
            }
        }
    }
    r
}
/// Closed raw descriptor compiler, no invented trusted mandatory registration.
pub fn fuzz_registry(raw: &[u8]) -> Reachability {
    let mut r = Reachability {
        compiler_attempts: 1,
        ..Default::default()
    };
    let mut work = WorkMeter::new(WorkLimits::default());
    if let Ok(registry) =
        editor_registry::compile_json(raw, &[], CompilerLimits::default(), &mut work)
    {
        r.compiled = 1;
        assert!(registry.catalog_ids().len() <= 256);
        let _ = registry.binding();
        let _ = registry.digest();
    }
    r.work_units = work.usage().units;
    r.work_bytes = work.usage().bytes;
    r
}
fn stateful<P, F>(mut s: Session<P>, bytes: &[u8], intent: F) -> Reachability
where
    P: CommandProvider,
    P::Error: Debug,
    F: Fn(String) -> P::Intent<NodeId>,
{
    let mut r = Reachability {
        admission_attempts: 1,
        admitted: 1,
        ..Default::default()
    };
    let key = s.key();
    let mut pending = vec![s.root(key).unwrap()];
    let block = loop {
        let id = pending.pop().expect("frozen baseline paragraph");
        let n = s.node(key, id).unwrap();
        if n.primitive() == Some(Primitive::TextBlock) {
            break id;
        }
        pending.extend(n.children().iter().rev().copied());
    };
    for &byte in bytes.iter().take(64) {
        match byte % 8 {
            0 => {
                let end = s
                    .node(key, block)
                    .unwrap()
                    .children()
                    .iter()
                    .map(|id| {
                        s.node(key, *id)
                            .unwrap()
                            .text()
                            .unwrap_or("")
                            .encode_utf16()
                            .count()
                    })
                    .sum();
                let p = physical(&s, block, end).unwrap();
                s.set_selection(
                    key,
                    s.revision(),
                    Selection {
                        anchor: p,
                        focus: p,
                    },
                )
                .unwrap();
                let before = capture(&s);
                let st = s.stamp();
                let token = ["X", " ", "\u{a0}", "e\u{301}", "😀", "👩‍💻"][(byte as usize / 8) % 6];
                let mut req =
                    CommandRequest::new(key, st.revision, st.selection_epoch, intent(token.into()));
                req.history_epoch = Some(st.history_epoch);
                let q = s.query_command(&req);
                r.command_queries += 1;
                assert_eq!(capture(&s), before, "query changed committed facets");
                let result = s.execute_command(&req);
                match (q, result) {
                    (
                        CommandAvailability::Available {
                            effect: CommandEffect::Changed,
                            work,
                            ..
                        },
                        CommandOutcome::Completed {
                            outcome: DispatchOutcome::Changed(e),
                            ..
                        },
                    ) => {
                        assert_eq!(work, e.work);
                        record_event(&e, &mut r);
                        r.command_publications += 1;
                    }
                    (
                        CommandAvailability::Unavailable { reason, work, .. },
                        CommandOutcome::Refused {
                            reason: other,
                            work: actual,
                            ..
                        },
                    ) => {
                        assert_eq!((reason, work), (other, actual));
                        assert_eq!(capture(&s), before);
                    }
                    other => panic!("query/execute discrepancy: {other:?}"),
                }
            }
            1 | 2 => {
                let before = capture(&s);
                let st = s.stamp();
                let req = HistoryRequest::new(
                    key,
                    st.revision,
                    st.selection_epoch,
                    st.history_epoch,
                    if byte % 8 == 1 {
                        HistoryDirection::Undo
                    } else {
                        HistoryDirection::Redo
                    },
                );
                let q = s.query_history(&req);
                r.history_queries += 1;
                assert_eq!(capture(&s), before);
                match (q, s.execute_history(&req)) {
                    (HistoryAvailability::Available { work, .. }, HistoryOutcome::Completed(e)) => {
                        assert_eq!(work, e.work);
                        record_event(&e, &mut r);
                        r.history_publications += 1;
                    }
                    (
                        HistoryAvailability::Unavailable { reason, work, .. },
                        HistoryOutcome::Refused {
                            reason: other,
                            work: actual,
                            ..
                        },
                    ) => {
                        assert_eq!((reason, work), (other, actual));
                        assert_eq!(capture(&s), before);
                    }
                    other => panic!("history query/execute discrepancy: {other:?}"),
                }
            }
            3 => {
                let leaf = s.node(key, block).unwrap().children()[0];
                let len = s
                    .node(key, leaf)
                    .unwrap()
                    .text()
                    .unwrap()
                    .encode_utf16()
                    .count();
                let before = capture(&s);
                let ops = vec![
                    editor_core::transaction::Operation::ReplaceText {
                        leaf: leaf.into(),
                        from: Utf16Offset::new(len),
                        to: Utf16Offset::new(len),
                        inserted: "Y".into(),
                    },
                    editor_core::transaction::Operation::ReplaceText {
                        leaf: leaf.into(),
                        from: Utf16Offset::new(1),
                        to: Utf16Offset::new(0),
                        inserted: String::new(),
                    },
                ];
                match s.dispatch(Transaction::new(key, s.revision(), ops)) {
                    DispatchOutcome::Refused { map, .. } => {
                        let p = Position::Text {
                            leaf,
                            utf16: Utf16Offset::new(0),
                            affinity: Affinity::After,
                        };
                        assert_eq!(map.map(p), editor_engine::mapping::MapResult::Mapped(p));
                    }
                    other => panic!("late candidate unexpectedly published: {other:?}"),
                };
                assert_eq!(capture(&s), before);
                r.late_refusals += 1;
            }
            4 => {
                let snapshot = s.export_snapshot_receipt(key, s.revision()).unwrap();
                r.snapshot_exports += 1;
                s.acknowledge_snapshot(&snapshot).unwrap();
                assert!(!s.dirty());
            }
            5 => {
                let protection = s
                    .protect_events(key, editor_engine::events::ProtectionStart::Now)
                    .unwrap();
                let cursor = s.event_status(key).unwrap().head;
                let through = s
                    .events_after(key, cursor, Default::default(), WorkLimits::default())
                    .unwrap()
                    .through();
                r.event_reads += 1;
                s.acknowledge_events(key, protection, through).unwrap();
                assert!(s.release_events(key, protection).unwrap());
            }
            6 => {
                let before = capture(&s);
                let st = s.stamp();
                match s.set_typing_marks(
                    key,
                    st.revision,
                    st.selection_epoch,
                    st.history_epoch,
                    Some(vec![]),
                ) {
                    DispatchOutcome::Refused { .. } => assert_eq!(capture(&s), before),
                    DispatchOutcome::Unchanged { .. } => {}
                    other => panic!("mark override mutated document: {other:?}"),
                }
            }
            _ => {
                let before = capture(&s);
                let req = Transaction::new(key, s.revision() + 1, vec![]);
                assert!(matches!(s.dispatch(req), DispatchOutcome::Refused { .. }));
                assert_eq!(capture(&s), before);
            }
        }
    }
    let bytes = s.export_snapshot(key, s.revision()).unwrap();
    r.snapshot_exports += 1;
    let binding = s.binding().clone();
    let old = s.key();
    let next = s
        .remount(
            old,
            &binding,
            &bytes,
            AdmissionMode::Strict,
            AccessMode::Editable,
        )
        .unwrap();
    assert!(s.root(old).is_err());
    assert_eq!(s.export_snapshot(next, 0).unwrap(), bytes);
    r.snapshot_exports += 1;
    s.close(next).unwrap();
    r.closed += 1;
    r
}
/// Byte opcodes modulo8: insert-at-end,undo,redo,late reversed-range batch,
/// save/ack,events/protect/ack/release,plain override,stale revision refusal.
/// Insert token is (byte/8)%6. Known deep seed: [0,3,1,2,4,5,6,7].
pub fn fuzz_stateful(context: model::Context, bytes: &[u8]) -> Reachability {
    let input = fuzz_wire(context);
    if context.is_kwdj() {
        let p = KwdjProfile::new_owned(
            Rc::new(ExistingFacts),
            Limits::default(),
            AdmissionBudget::default(),
        );
        let binding = p.binding().clone();
        stateful(
            Session::open(
                p,
                &binding,
                &input,
                AdmissionMode::Strict,
                AccessMode::Editable,
            )
            .unwrap(),
            bytes,
            |text| editor_kwdj::commands::KwdjIntent::InsertText { text },
        )
    } else {
        let p = default_notes(context);
        let binding = p.binding().clone();
        stateful(
            Session::open(
                p,
                &binding,
                &input,
                AdmissionMode::Strict,
                AccessMode::Editable,
            )
            .unwrap(),
            bytes,
            |text| NativeNotesIntent::InsertText { text },
        )
    }
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct BridgeSeed {
    input_json: String,
    options_json: String,
    requests: Vec<String>,
}
fn bridge_value(
    endpoint: &mut editor_bridge::distribution::DistributionSession,
    request: serde_json::Value,
) -> Option<serde_json::Value> {
    use editor_bridge::Endpoint;
    let text = endpoint.call_json(&request.to_string());
    let response: editor_protocol::SdkResponse = serde_json::from_str(&text).unwrap();
    match response {
        editor_protocol::SdkResponse::Ok { value } => Some(serde_json::to_value(value).unwrap()),
        editor_protocol::SdkResponse::Refused { .. } => None,
        editor_protocol::SdkResponse::Fatal { diagnostic } => {
            panic!("unexpected bridge prelude Fatal: {diagnostic:?}")
        }
    }
}
fn bridge_state(
    endpoint: &mut editor_bridge::distribution::DistributionSession,
) -> Option<editor_protocol::StateDto> {
    let v = bridge_value(endpoint, serde_json::json!({"kind":"state"}))?;
    serde_json::from_value(v["state"].clone()).ok()
}
/// Test envelope keeps exact production input/options/request strings. Malformed
/// envelope itself is a harness non-admission, never a production typed refusal.
pub fn fuzz_bridge(context: model::Context, raw: &[u8]) -> Reachability {
    use editor_bridge::{Endpoint, distribution::Distribution};
    use editor_protocol::{SdkReply, SdkResponse};
    let mut r = Reachability::default();
    let Ok(seed) = serde_json::from_slice::<BridgeSeed>(raw) else {
        return r;
    };
    if seed.requests.len() > 64 {
        return r;
    }
    let factories: Vec<Box<dyn editor_bridge::SessionFactory>> = if context.is_kwdj() {
        vec![Box::new(editor_kwdj_sdk::KwdjFactory)]
    } else {
        vec![Box::new(editor_notes_sdk::NotesFactory)]
    };
    let d = Distribution::new(FUZZ_BUILD_ID, factories).unwrap();
    let mut endpoint = d.open(seed.input_json.as_bytes(), &seed.options_json);
    r.admission_attempts = 1;
    let initial = match endpoint.initialization() {
        SdkResponse::Ok { value } => {
            let SdkReply::State { state } = *value else {
                panic!("initial state DTO required")
            };
            r.admitted = 1;
            Some(state)
        }
        SdkResponse::Refused { .. } => None,
        SdkResponse::Fatal { diagnostic } => panic!("unexpected initial Fatal: {diagnostic:?}"),
    };
    if let Some(mut state) = initial {
        // A bounded public prelude guarantees successful seeds reach planning,
        // publication, both history directions, snapshot ownership and delivery.
        // Raw request strings below still reach production unchanged.
        let mut pending = vec![state.root.clone()];
        let mut first_text = None;
        for _ in 0..128 {
            let Some(id) = pending.pop() else { break };
            let Some(reply) = bridge_value(
                &mut endpoint,
                serde_json::json!({"kind":"node","stamp":state.stamp,"node":id}),
            ) else {
                break;
            };
            let node = &reply["node"];
            if node["primitive"] == "text" {
                first_text = Some(node["id"].clone());
                break;
            }
            if let Some(children) = node["children"].as_array() {
                pending.extend(
                    children
                        .iter()
                        .rev()
                        .map(|id| id.as_str().unwrap().to_owned()),
                );
            }
        }
        if let Some(leaf) = first_text {
            let point = serde_json::json!({"kind":"edge","node":leaf,"side":"after"});
            if bridge_value(&mut endpoint,serde_json::json!({"kind":"set_selection","stamp":state.stamp,"selection":{"anchor":point,"focus":point}})).is_some(){
                state=bridge_state(&mut endpoint).unwrap();let payload=if context.is_kwdj(){serde_json::json!({"kind":"insert_text","text":"X"})}else{serde_json::json!({"text":"X"})};let command=serde_json::json!({"id":if context.is_kwdj(){"org.klenwriter.kwdj/command/insert-text"}else{"org.example.notes/command/insert-text"},"payload_json":payload.to_string()});
                let before=state.clone();let available=bridge_value(&mut endpoint,serde_json::json!({"kind":"query_command","stamp":state.stamp,"command":command}));r.command_queries+=1;assert_eq!(bridge_state(&mut endpoint),Some(before.clone()));
                if available.as_ref().is_some_and(|v|v["available"]==true){let reply=bridge_value(&mut endpoint,serde_json::json!({"kind":"command","stamp":state.stamp,"command":command,"history_hint":{"kind":"isolated"}})).expect("available Isolated command execution");if reply["effect"]=="changed"{r.command_publications+=1;}
                    for direction in ["undo","redo"] {state=bridge_state(&mut endpoint).unwrap();let before=state.clone();let available=bridge_value(&mut endpoint,serde_json::json!({"kind":"query_history","stamp":state.stamp,"direction":direction}));r.history_queries+=1;assert_eq!(bridge_state(&mut endpoint),Some(before));if available.as_ref().is_some_and(|v|v["available"]==true){assert!(bridge_value(&mut endpoint,serde_json::json!({"kind":"history","stamp":state.stamp,"direction":direction})).is_some());r.history_publications+=1;}}
                }
            }
        }
        if let Some(state) = bridge_state(&mut endpoint)
            && let Some(snapshot) = bridge_value(
                &mut endpoint,
                serde_json::json!({"kind":"snapshot","stamp":state.stamp,"max_bytes":16777216}),
            )
        {
            r.snapshot_exports += 1;
            assert!(
                bridge_value(
                    &mut endpoint,
                    serde_json::json!({"kind":"release_snapshot","handle":snapshot["handle"]})
                )
                .is_some()
            );
        }
        if let Some(events) = bridge_value(&mut endpoint, serde_json::json!({"kind":"events"})) {
            r.event_reads += 1;
            if let Some(cursor) = events["cursor"].as_str() {
                let _ = bridge_value(
                    &mut endpoint,
                    serde_json::json!({"kind":"acknowledge_events","cursor":cursor}),
                );
            }
        }
    }
    for request in seed.requests {
        let text = endpoint.call_json(&request);
        let reply: SdkResponse =
            serde_json::from_str(&text).expect("bridge always emits closed DTO");
        match reply {
            SdkResponse::Fatal { diagnostic } => panic!("unexpected bridge Fatal: {diagnostic:?}"),
            SdkResponse::Ok { value } => match *value {
                SdkReply::Mutation { .. } => r.command_publications += 1,
                SdkReply::Availability { .. } => r.command_queries += 1,
                _ => {}
            },
            SdkResponse::Refused { .. } => {}
        }
    }
    endpoint.destroy();
    let count = endpoint.own_resource_counts();
    assert_eq!(
        (
            count.sessions,
            count.snapshot_handles,
            count.snapshot_bytes.as_str(),
            count.protected_cursors
        ),
        (0, 0, "0", 0)
    );
    r.closed = 1;
    r
}
