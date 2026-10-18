// SPDX-License-Identifier: MIT OR Apache-2.0
//! Test-only replay retry against changed synchronous reference identity facts.
//! Resolver state and target-local diagnostics never become portable DTO fields.

use editor_core::candidate::CandidateRead;
use editor_core::commands::{
    CommandDescriptor, CommandPresentation, CommandProvider, CommandState, PlanBuilder,
};
use editor_core::document::{Attributes, Document, Mark, Primitive};
use editor_core::positions::{Affinity, Position, Selection, Utf16Offset};
use editor_core::profile::{AdmissionMode, FrozenProfile, ProfileBinding};
use editor_core::transaction::{Operation, TransactionProfile, ValidationStats, WorkMeter};
use editor_engine::{
    AccessMode, CommandAvailability, CommandOutcome, CommandRequest, DispatchOutcome,
    HistoryAvailability, HistoryDirection, HistoryOutcome, HistoryRequest, NodeId, Session,
    SessionKey, SessionState,
};
use editor_kwdj::commands::KwdjIntent;
use editor_kwdj::{
    AdmissionBudget, IdentityResolver, IdentityResolverError, IdentityStatus, KwdjProfile,
    KwdjProfileError, Limits,
};
use serde_json::{Value, json};
use std::{cell::Cell, rc::Rc};
use uuid::Uuid;

const REFERENCE: &str = "550e8400-e29b-41d4-a716-446655440006";
const STRONG: &str = "org.klenwriter.kwdj/strong";

#[derive(Debug, Clone, Copy)]
enum Fact {
    Exists,
    Missing,
    LookupFailure,
}
struct MutableFacts {
    reference: Uuid,
    current: Cell<Fact>,
    reference_calls: Cell<u64>,
}
impl MutableFacts {
    fn new() -> Self {
        Self {
            reference: Uuid::parse_str(REFERENCE).unwrap(),
            current: Cell::new(Fact::Exists),
            reference_calls: Cell::new(0),
        }
    }
}
impl IdentityResolver for MutableFacts {
    fn resolve_media(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        panic!("reference-only fixture must not query media identity")
    }
    fn resolve_reference(&self, id: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        assert_eq!(*id, self.reference);
        self.reference_calls.set(self.reference_calls.get() + 1);
        match self.current.get() {
            Fact::Exists => Ok(IdentityStatus::Exists),
            Fact::Missing => Ok(IdentityStatus::Missing),
            Fact::LookupFailure => Err(IdentityResolverError::Unavailable),
        }
    }
}

#[derive(Clone, Default)]
struct Hooks(Rc<Cell<[u64; 4]>>);
impl Hooks {
    fn bump(&self, index: usize) {
        let mut counts = self.0.get();
        counts[index] += 1;
        self.0.set(counts);
    }
}
struct CountedFacts<'a> {
    inner: KwdjProfile<'a>,
    hooks: Hooks,
}
impl FrozenProfile for CountedFacts<'_> {
    type Context = <KwdjProfile<'static> as FrozenProfile>::Context;
    type Admitted = <KwdjProfile<'static> as FrozenProfile>::Admitted;
    type Error = KwdjProfileError;
    fn binding(&self) -> &ProfileBinding {
        self.inner.binding()
    }
    fn admit_bytes(
        &self,
        binding: &ProfileBinding,
        input: &[u8],
        mode: AdmissionMode,
    ) -> Result<Self::Admitted, Self::Error> {
        self.hooks.bump(0);
        self.inner.admit_bytes(binding, input, mode)
    }
    fn context(&self, admitted: &Self::Admitted) -> Self::Context {
        self.inner.context(admitted)
    }
    fn to_document(&self, admitted: &Self::Admitted) -> Document {
        self.hooks.bump(1);
        self.inner.to_document(admitted)
    }
    fn admit_snapshot(
        &self,
        context: &Self::Context,
        document: &Document,
    ) -> Result<Self::Admitted, Self::Error> {
        self.hooks.bump(2);
        self.inner.admit_snapshot(context, document)
    }
    fn canonical<'a>(&self, admitted: &'a Self::Admitted) -> &'a [u8] {
        self.hooks.bump(3);
        self.inner.canonical(admitted)
    }
}
impl TransactionProfile for CountedFacts<'_> {
    fn normalize_candidate<V: CandidateRead>(
        &self,
        context: &Self::Context,
        view: &V,
        work: &mut WorkMeter,
    ) -> Result<Vec<Operation<V::Id>>, Self::Error> {
        self.inner.normalize_candidate(context, view, work)
    }
    fn validate_candidate<V: CandidateRead>(
        &self,
        context: &Self::Context,
        view: &V,
        work: &mut WorkMeter,
    ) -> Result<ValidationStats, Self::Error> {
        self.inner.validate_candidate(context, view, work)
    }
}
impl CommandProvider for CountedFacts<'_> {
    type Intent<I: Copy + Eq + Ord> = KwdjIntent<I>;
    const COMMANDS: &'static [CommandDescriptor] =
        <KwdjProfile<'static> as CommandProvider>::COMMANDS;
    fn command_id<I: Copy + Eq + Ord>(intent: &Self::Intent<I>) -> &str {
        <KwdjProfile<'static> as CommandProvider>::command_id(intent)
    }
    fn prepare_command<V: CandidateRead>(
        &self,
        context: &Self::Context,
        view: &V,
        state: CommandState<'_, V::Id>,
        intent: &Self::Intent<V::Id>,
        plan: &mut PlanBuilder<'_, V::Id>,
    ) -> Result<CommandPresentation, Self::Error> {
        self.inner
            .prepare_command(context, view, state, intent, plan)
    }
    fn finalize_typing_override<V: CandidateRead>(
        &self,
        context: &Self::Context,
        view: &V,
        selection: Option<Selection<V::Id>>,
        proposed: Option<&[Mark]>,
        work: &mut WorkMeter,
    ) -> Result<Option<Vec<Mark>>, Self::Error> {
        self.inner
            .finalize_typing_override(context, view, selection, proposed, work)
    }
    fn error_code(error: &Self::Error) -> &'static str {
        <KwdjProfile<'static> as CommandProvider>::error_code(error)
    }
}
type FactsSession<'a> = Session<CountedFacts<'a>>;

#[derive(Debug, PartialEq, Eq)]
struct Record {
    id: NodeId,
    parent: Option<NodeId>,
    primitive: Option<Primitive>,
    type_id: Option<String>,
    attributes: Option<Attributes>,
    text: Option<String>,
    children: Vec<NodeId>,
    marks: Vec<Mark>,
}
fn records(session: &FactsSession<'_>) -> Vec<Record> {
    fn walk(session: &FactsSession<'_>, id: NodeId, out: &mut Vec<Record>) {
        let node = session.node(session.key(), id).unwrap();
        out.push(Record {
            id,
            parent: node.parent(),
            primitive: node.primitive(),
            type_id: node.type_id().map(str::to_owned),
            attributes: node.attributes().cloned(),
            text: node.text().map(str::to_owned),
            children: node.children().to_vec(),
            marks: node.marks().to_vec(),
        });
        for child in node.children() {
            walk(session, *child, out);
        }
    }
    let mut result = Vec::new();
    walk(session, session.root(session.key()).unwrap(), &mut result);
    result
}
#[derive(Debug, PartialEq, Eq)]
struct Facets {
    key: SessionKey,
    state: SessionState,
    binding: ProfileBinding,
    revision: u64,
    epoch: u64,
    history: editor_engine::HistorySummary,
    journal: editor_engine::JournalSummary,
    entries: Vec<editor_engine::JournalEntrySummary>,
    selection: Option<Selection<NodeId>>,
    marks: Option<Vec<Mark>>,
    dirty: bool,
    records: Vec<Record>,
}
fn facets(session: &FactsSession<'_>) -> Facets {
    Facets {
        key: session.key(),
        state: session.state(),
        binding: session.binding().clone(),
        revision: session.revision(),
        epoch: session.selection_epoch(),
        history: session.history_summary(),
        journal: session.journal_summary(),
        entries: session.journal_entries(),
        selection: session.selection(session.key()).unwrap(),
        marks: session
            .stored_marks(session.key())
            .unwrap()
            .map(<[Mark]>::to_vec),
        dirty: session.dirty(),
        records: records(session),
    }
}
fn checkpoint(session: &FactsSession<'_>, hooks: &Hooks) -> Vec<u8> {
    let before = hooks.0.get();
    let bytes = session
        .export_snapshot(session.key(), session.revision())
        .unwrap();
    let mut expected = before;
    expected[2] += 1;
    expected[3] += 1;
    assert_eq!(
        hooks.0.get(),
        expected,
        "explicit checkpoint hook scope changed"
    );
    bytes
}
fn command(session: &mut FactsSession<'_>, hooks: &Hooks, intent: KwdjIntent<NodeId>) {
    let mut request = CommandRequest::new(
        session.key(),
        session.revision(),
        session.selection_epoch(),
        intent,
    );
    request.history_epoch = Some(session.history_summary().epoch);
    let before = facets(session);
    let count = hooks.0.get();
    let available = session.query_command(&request);
    assert_eq!(before, facets(session));
    let outcome = session.execute_command(&request);
    assert_eq!(
        hooks.0.get(),
        count,
        "ordinary command called snapshot/codec"
    );
    let CommandAvailability::Available {
        work,
        selection_changed,
        stored_marks_changed,
        ..
    } = available
    else {
        panic!("command unavailable {available:?}")
    };
    let CommandOutcome::Completed { outcome, .. } = outcome else {
        panic!("command refused {outcome:?}")
    };
    match outcome {
        DispatchOutcome::Changed(event) => assert_eq!(event.work, work),
        DispatchOutcome::Unchanged { work: actual, .. } => assert_eq!(actual, work),
        _ => panic!("available command refused"),
    }
    assert_eq!(
        selection_changed,
        before.selection != session.selection(session.key()).unwrap()
    );
    assert_eq!(
        stored_marks_changed,
        before.marks
            != session
                .stored_marks(session.key())
                .unwrap()
                .map(<[Mark]>::to_vec)
    );
}
fn request(session: &FactsSession<'_>, direction: HistoryDirection) -> HistoryRequest {
    HistoryRequest::new(
        session.key(),
        session.revision(),
        session.selection_epoch(),
        session.history_summary().epoch,
        direction,
    )
}
fn refused(
    session: &mut FactsSession<'_>,
    hooks: &Hooks,
    facts: &MutableFacts,
    request: &HistoryRequest,
    expected_code: &str,
) {
    let before = facets(session);
    let count = hooks.0.get();
    let lookup_before = facts.reference_calls.get();
    let query = session.query_history(request);
    assert!(
        facts.reference_calls.get() > lookup_before,
        "query skipped current identity facts"
    );
    assert_eq!(before, facets(session));
    assert_eq!(
        query,
        session.query_history(request),
        "same bad facts changed availability"
    );
    assert_eq!(before, facets(session));
    let lookup_before = facts.reference_calls.get();
    let outcome = session.execute_history(request);
    assert!(
        facts.reference_calls.get() > lookup_before,
        "execute skipped current identity facts"
    );
    assert_eq!(
        hooks.0.get(),
        count,
        "ordinary refusal called snapshot/codec"
    );
    match (query, outcome) {
        (
            HistoryAvailability::Unavailable {
                reason,
                error,
                work,
            },
            HistoryOutcome::Refused {
                reason: actual,
                error: actual_error,
                work: actual_work,
            },
        ) => {
            assert_eq!(reason, expected_code);
            assert_eq!(actual, expected_code);
            assert_eq!(error, actual_error);
            assert_eq!(work, actual_work);
            assert!(
                work.units <= request.limits.work.units && work.bytes <= request.limits.work.bytes
            );
        }
        other => panic!("identity fact refusal diverged {other:?}"),
    }
    assert_eq!(
        before,
        facets(session),
        "refusal changed committed facets or retained stack"
    );
}
fn accepted(session: &mut FactsSession<'_>, hooks: &Hooks, request: &HistoryRequest) {
    let before = facets(session);
    let count = hooks.0.get();
    let query = session.query_history(request);
    assert_eq!(before, facets(session));
    let outcome = session.execute_history(request);
    assert_eq!(
        hooks.0.get(),
        count,
        "ordinary replay called snapshot/codec"
    );
    match (query, outcome) {
        (
            HistoryAvailability::Available {
                selection_changed,
                stored_marks_changed,
                work,
            },
            HistoryOutcome::Completed(event),
        ) => {
            assert_eq!(event.work, work);
            assert_eq!(
                selection_changed,
                before.selection != session.selection(session.key()).unwrap()
            );
            assert_eq!(
                stored_marks_changed,
                before.marks
                    != session
                        .stored_marks(session.key())
                        .unwrap()
                        .map(<[Mark]>::to_vec)
            );
            assert_eq!(event.revision, before.revision + 1);
        }
        other => panic!("same captured request failed after restoring facts {other:?}"),
    }
}
fn wire(content: Value) -> Value {
    json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":content})
}
fn fixture(facts: &MutableFacts, after: bool) -> Vec<u8> {
    // Literal independent expected documents are admitted outside counted paths.
    let mut inline = vec![
        json!({"type":"text","text":"ref","marks":[{"type":"reference_link","attrs":{"reference_entity_id":REFERENCE}}]}),
        json!({"type":"text","text":"x"}),
    ];
    if after {
        inline.push(json!({"type":"text","text":"!","marks":[{"type":"strong"}]}));
    }
    let value = wire(json!([{"type":"paragraph","content":inline}]));
    let profile = KwdjProfile::new(facts, Limits::default(), AdmissionBudget::default());
    let admitted = profile
        .admit_bytes(
            profile.binding(),
            &serde_json::to_vec(&value).unwrap(),
            AdmissionMode::Import,
        )
        .unwrap();
    profile.canonical(&admitted).to_vec()
}
fn run(failure: Fact, label: &str, expected_code: &str) -> Value {
    let facts = MutableFacts::new();
    let expected_before = fixture(&facts, false);
    let expected_after = fixture(&facts, true);
    let hooks = Hooks::default();
    let profile = CountedFacts {
        inner: KwdjProfile::new(&facts, Limits::default(), AdmissionBudget::default()),
        hooks: hooks.clone(),
    };
    let binding = profile.binding().clone();
    let mut session = Session::open(
        profile,
        &binding,
        &expected_before,
        AdmissionMode::Strict,
        AccessMode::Editable,
    )
    .unwrap();
    let opened_hooks = hooks.0.get();
    let parent = session
        .node(session.key(), session.root(session.key()).unwrap())
        .unwrap()
        .children()[0];
    let plain = session.node(session.key(), parent).unwrap().children()[1];
    let caret = Position::Text {
        leaf: plain,
        utf16: Utf16Offset::new(1),
        affinity: Affinity::After,
    };
    session
        .set_selection(
            session.key(),
            session.revision(),
            Selection {
                anchor: caret,
                focus: caret,
            },
        )
        .unwrap();
    let strong = vec![Mark {
        type_id: STRONG.into(),
        attributes: Attributes::new(),
    }];
    command(
        &mut session,
        &hooks,
        KwdjIntent::ToggleMark {
            mark: strong[0].clone(),
        },
    );
    assert_eq!(
        session.stored_marks(session.key()).unwrap(),
        Some(strong.as_slice())
    );
    let before_records = records(&session);
    let before_selection = session.selection(session.key()).unwrap();
    assert_eq!(checkpoint(&session, &hooks), expected_before);
    command(
        &mut session,
        &hooks,
        KwdjIntent::InsertText { text: "!".into() },
    );
    assert_eq!(session.revision(), 1);
    assert_eq!(session.history_summary().undo_units, 1);
    assert_eq!(session.history_summary().redo_units, 0);
    let after_records = records(&session);
    let after_selection = session.selection(session.key()).unwrap();
    let after_marks = session
        .stored_marks(session.key())
        .unwrap()
        .map(<[Mark]>::to_vec);
    assert_eq!(after_marks, Some(strong.clone()));
    assert_eq!(checkpoint(&session, &hooks), expected_after);

    let undo = request(&session, HistoryDirection::Undo);
    facts.current.set(failure);
    refused(&mut session, &hooks, &facts, &undo, expected_code);
    facts.current.set(Fact::Exists);
    accepted(&mut session, &hooks, &undo); // the identical captured request retries
    assert_eq!(records(&session), before_records);
    assert_eq!(session.selection(session.key()).unwrap(), before_selection);
    assert_eq!(
        session.stored_marks(session.key()).unwrap(),
        Some(strong.as_slice())
    );
    assert_eq!(session.history_summary().undo_units, 0);
    assert_eq!(session.history_summary().redo_units, 1);
    assert_eq!(checkpoint(&session, &hooks), expected_before);

    let redo = request(&session, HistoryDirection::Redo);
    facts.current.set(failure);
    refused(&mut session, &hooks, &facts, &redo, expected_code);
    facts.current.set(Fact::Exists);
    accepted(&mut session, &hooks, &redo);
    assert_eq!(records(&session), after_records);
    assert_eq!(session.selection(session.key()).unwrap(), after_selection);
    assert_eq!(
        session
            .stored_marks(session.key())
            .unwrap()
            .map(<[Mark]>::to_vec),
        after_marks
    );
    assert_eq!(session.history_summary().undo_units, 1);
    assert_eq!(session.history_summary().redo_units, 0);
    assert_eq!(session.revision(), 3);
    assert_eq!(checkpoint(&session, &hooks), expected_after);
    let mut expected_hooks = opened_hooks;
    expected_hooks[2] += 4;
    expected_hooks[3] += 4;
    assert_eq!(
        hooks.0.get(),
        expected_hooks,
        "only four explicit checkpoints may call snapshot/codec hooks after admission"
    );
    json!({"case":label,"status":"passed","reason":expected_code,"directions":["undo","redo"],"refused_attempts":2,"same_captured_requests_retry":true,"typed_errors_and_work_equal":true,"current_resolver_rechecked":true,"all_committed_facets_preserved":true,"retained_stacks_preserved":true,"exact_historical_records_ids_selection_marks":true,"ordinary_snapshot_codec_calls":0,"explicit_checkpoint_exports":4,"canonical_before":String::from_utf8(expected_before).unwrap(),"canonical_after":String::from_utf8(expected_after).unwrap()})
}

pub(super) fn observe() -> Value {
    let cases = vec![
        run(
            Fact::Missing,
            "reference_missing_then_restored",
            "kwdj.reference_identity_unresolved",
        ),
        run(
            Fact::LookupFailure,
            "reference_lookup_unavailable_then_restored",
            "kwdj.identity_resolution_failed",
        ),
    ];
    json!({"status":"passed","case_total":2,"cases":cases,"ordinary_snapshot_codec_calls":0,"explicit_checkpoint_exports":8,"scope":"Actual real KWDJ mutable synchronous identity facts; same captured undo and redo requests retry after atomic refusal."})
}

#[cfg(test)]
mod tests {
    #[test]
    fn facts_retry_same_request() {
        let result = super::observe();
        assert_eq!(result["case_total"], 2);
        assert_eq!(result["status"], "passed");
    }
}
