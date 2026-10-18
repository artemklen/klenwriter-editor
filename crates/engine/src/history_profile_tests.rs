// SPDX-License-Identifier: MIT OR Apache-2.0
//! Private supporting profile-gate witnesses. This compiled fixture has no
//! CommandProvider; live service facts never replace its immutable binding.

use std::cell::Cell;
use std::rc::Rc;

use editor_core::candidate::CandidateRead;
use editor_core::document::{Attribute, Attributes, Document, Mark, Node, Primitive};
use editor_core::history::HistoryProfile;
use editor_core::positions::{Affinity, Edge, Position, Selection, Utf16Offset};
use editor_core::profile::{AdmissionMode, FrozenProfile, ProfileBinding};
use editor_core::transaction::{Operation, TransactionProfile, ValidationStats, WorkMeter};

use super::{AccessMode, Session, SessionState, StateError};
use crate::history::{HistoryDirection, HistoryError, HistoryHint, HistorySummary, TypingClass};
use crate::identity::{NodeId, SessionKey};
use crate::mapping::MapResult;
use crate::transaction::{
    DispatchOutcome, JournalEntrySummary, JournalSummary, Transaction, TransactionError,
};
use crate::tree::{ReplayDirection, TreeError, TreeNode};
use crate::{HistoryAvailability, HistoryOutcome, HistoryRequest};

const FINALIZER_UNITS: u64 = 50_000;

#[derive(Clone, Copy)]
enum Gate {
    Honest,
    FinalizerError,
    FinalizerRewrite,
    NeedsNormalization,
    ValidatorFacts,
    ExpensiveFinalizer,
}

#[derive(Clone, Default)]
struct Facts {
    unavailable: Rc<Cell<bool>>,
    codecs: Rc<Cell<[usize; 4]>>,
    phases: Rc<Cell<[usize; 3]>>,
}

impl Facts {
    fn codec(&self, index: usize) {
        let mut counts = self.codecs.get();
        counts[index] += 1;
        self.codecs.set(counts);
    }
    fn phase(&self, index: usize) {
        let mut counts = self.phases.get();
        counts[index] += 1;
        self.phases.set(counts);
    }
}

struct Profile {
    binding: ProfileBinding,
    facts: Facts,
    gate: Gate,
    initial_text: &'static str,
    padding: usize,
}

struct Admitted {
    document: Document,
    bytes: Vec<u8>,
}

fn initial() -> Document {
    fixture_document("a", 0)
}

fn fixture_document(text: &str, padding: usize) -> Document {
    let mut attributes = Attributes::new();
    if padding != 0 {
        attributes.insert(
            "diagnostic_padding".into(),
            Attribute::String("x".repeat(padding)),
        );
    }
    Document {
        children: vec![Node {
            type_id: "org.example.history-gates/paragraph".into(),
            primitive: Primitive::TextBlock,
            attributes: Attributes::new(),
            marks: vec![],
            text: None,
            children: vec![Node {
                type_id: "org.example.history-gates/text".into(),
                primitive: Primitive::Text,
                attributes,
                marks: vec![],
                text: Some(text.into()),
                children: vec![],
            }],
        }],
    }
}

fn admitted(document: Document) -> Admitted {
    // Explicit fixture codec boundary. Ordinary dispatch/query/replay must not
    // call this serializer or clone an admitted whole document through hooks.
    let bytes = format!("{document:?}").into_bytes();
    Admitted { document, bytes }
}

impl FrozenProfile for Profile {
    type Context = ();
    type Admitted = Admitted;
    type Error = &'static str;
    type Cache<I: Copy + Eq + Ord> = ();

    fn binding(&self) -> &ProfileBinding {
        &self.binding
    }
    fn admit_bytes(
        &self,
        requested: &ProfileBinding,
        input: &[u8],
        _: AdmissionMode,
    ) -> Result<Admitted, Self::Error> {
        self.facts.codec(0);
        self.binding
            .ensure_matches(requested)
            .map_err(|_| "profile.binding")?;
        if input != b"history-gates" {
            return Err("profile.input");
        }
        Ok(admitted(fixture_document(self.initial_text, self.padding)))
    }
    fn context(&self, _: &Admitted) {}
    fn to_document(&self, value: &Admitted) -> Document {
        self.facts.codec(1);
        value.document.clone()
    }
    fn admit_snapshot(&self, _: &(), document: &Document) -> Result<Admitted, Self::Error> {
        self.facts.codec(2);
        Ok(admitted(document.clone()))
    }
    fn canonical<'a>(&self, value: &'a Admitted) -> &'a [u8] {
        self.facts.codec(3);
        &value.bytes
    }
}

fn candidate_text<'a, V: CandidateRead>(
    view: &'a V,
    work: &mut WorkMeter,
) -> Result<&'a str, &'static str> {
    work.charge_units(1).map_err(|_| "profile.work")?;
    let block = view
        .roots()
        .first()
        .and_then(|id| view.node(*id))
        .ok_or("profile.block")?;
    work.charge_units(1).map_err(|_| "profile.work")?;
    let leaf = block
        .children
        .first()
        .and_then(|id| view.node(*id))
        .ok_or("profile.leaf")?;
    let text = leaf.text.ok_or("profile.text")?;
    work.charge_units(text.len() as u64)
        .map_err(|_| "profile.work")?;
    Ok(text)
}

fn text_is_ab<V: CandidateRead>(view: &V, work: &mut WorkMeter) -> Result<bool, &'static str> {
    Ok(candidate_text(view, work)? == "ab")
}

impl TransactionProfile for Profile {
    fn normalize_candidate<V: CandidateRead>(
        &self,
        _: &(),
        view: &V,
        work: &mut WorkMeter,
    ) -> Result<Vec<Operation<V::Id>>, Self::Error> {
        self.facts.phase(0);
        let final_text = candidate_text(view, work)?;
        let ab = final_text == "ab";
        if matches!(self.gate, Gate::NeedsNormalization) && self.facts.unavailable.get() && ab {
            work.charge_bytes(6).map_err(|_| "profile.work")?;
            return Ok(vec![Operation::SetAttribute {
                node: view.roots()[0],
                key: "repair".into(),
                value: Some(Attribute::Boolean(true)),
            }]);
        }
        Ok(vec![])
    }
    fn validate_candidate<V: CandidateRead>(
        &self,
        _: &(),
        view: &V,
        work: &mut WorkMeter,
    ) -> Result<ValidationStats, Self::Error> {
        self.facts.phase(1);
        let ab = text_is_ab(view, work)?;
        if matches!(self.gate, Gate::ValidatorFacts) && self.facts.unavailable.get() && ab {
            return Err("profile.current_fact_missing");
        }
        Ok(ValidationStats {
            nodes: 2,
            canonical_bytes: 0,
        })
    }
}

impl HistoryProfile for Profile {
    fn finalize_history_typing<V: CandidateRead>(
        &self,
        _: &(),
        view: &V,
        selection: Option<Selection<V::Id>>,
        saved: Option<&[Mark]>,
        work: &mut WorkMeter,
    ) -> Result<Option<Vec<Mark>>, Self::Error> {
        self.facts.phase(2);
        let final_text = candidate_text(view, work)?;
        let ab = final_text == "ab";
        // Verify that the hook sees the FINAL restored selection as well as the
        // final candidate, rather than the currently committed one-letter view.
        let Some(Selection {
            anchor: Position::Text { utf16, .. },
            focus: Position::Text { utf16: focus, .. },
        }) = selection
        else {
            return Err("profile.final_selection");
        };
        if utf16.get() != final_text.encode_utf16().count() || focus != utf16 {
            return Err("profile.final_selection");
        }
        if ab {
            match self.gate {
                Gate::FinalizerError => return Err("profile.finalizer_refused"),
                Gate::FinalizerRewrite => return Ok(Some(vec![])),
                Gate::ExpensiveFinalizer => work
                    .charge_units(FINALIZER_UNITS)
                    .map_err(|_| "profile.finalizer_budget")?,
                _ => {}
            }
        }
        // These fixtures save inherit; no unmetered metadata copy is needed.
        assert!(saved.is_none());
        Ok(None)
    }
    fn history_error_code(error: &&'static str) -> &'static str {
        error
    }
}

#[derive(Debug, PartialEq, Eq)]
struct Facets {
    key: SessionKey,
    binding: ProfileBinding,
    state: SessionState,
    document: Document,
    records: Vec<TreeNode>,
    revision: u64,
    selection_epoch: u64,
    selection: Option<Selection<NodeId>>,
    marks: Option<Vec<Mark>>,
    dirty: bool,
    journal: JournalSummary,
    entries: Vec<JournalEntrySummary>,
    maps: Vec<MapResult<NodeId>>,
    history: HistorySummary,
}

fn facets(session: &Session<Profile>) -> Facets {
    fn walk(session: &Session<Profile>, id: NodeId, out: &mut Vec<TreeNode>) {
        let node = session.tree.node(id).unwrap();
        out.push(node.clone());
        for child in node.children() {
            walk(session, *child, out);
        }
    }
    let mut records = vec![];
    walk(session, session.tree.root(), &mut records);
    let mut maps = vec![];
    for node in &records {
        for from in 0..=session.revision {
            for side in [Edge::Before, Edge::After] {
                maps.push(session.journal.map(
                    from,
                    session.revision,
                    Position::Edge {
                        node: node.id(),
                        side,
                    },
                ));
            }
        }
    }
    Facets {
        key: session.key,
        binding: session.binding.clone(),
        state: session.state,
        document: session.tree.document(),
        records,
        revision: session.revision,
        selection_epoch: session.selection_epoch,
        selection: session.selection,
        marks: session.stored_marks.clone(),
        dirty: session.dirty,
        journal: session.journal_summary(),
        entries: session.journal_entries(),
        maps,
        history: session.history_summary(),
    }
}

fn point(leaf: NodeId, offset: usize) -> Position<NodeId> {
    Position::Text {
        leaf,
        utf16: Utf16Offset::new(offset),
        affinity: Affinity::After,
    }
}

fn request(session: &Session<Profile>) -> HistoryRequest {
    HistoryRequest::new(
        session.key,
        session.revision,
        session.selection_epoch,
        session.history_summary().epoch,
        HistoryDirection::Redo,
    )
}

fn setup(gate: Gate) -> (Session<Profile>, Facts) {
    let (mut session, facts, leaf) = opened(gate, "a", 0);
    let codecs = facts.codecs.get();
    let transaction = Transaction::new(
        session.key,
        0,
        vec![Operation::ReplaceText {
            leaf: leaf.into(),
            from: Utf16Offset::new(1),
            to: Utf16Offset::new(1),
            inserted: "b".into(),
        }],
    );
    assert!(matches!(
        session.dispatch(transaction),
        DispatchOutcome::Changed(_)
    ));
    assert_eq!(session.revision, 1);
    let mut undo = request(&session);
    undo.direction = HistoryDirection::Undo;
    let before = facets(&session);
    let available = session.query_history(&undo);
    assert_eq!(facets(&session), before);
    let expected_work = match available {
        HistoryAvailability::Available { work, .. } => work,
        other => panic!("setup undo unavailable {other:?}"),
    };
    match session.execute_history(&undo) {
        HistoryOutcome::Completed(event) => assert_eq!(event.work, expected_work),
        other => panic!("setup undo refused {other:?}"),
    }
    assert_eq!(session.tree.document(), initial());
    assert_eq!(session.revision, 2);
    assert_eq!(session.history_summary().redo_units, 1);
    assert_eq!(
        facts.codecs.get(),
        codecs,
        "ordinary setup used full codec hooks"
    );
    (session, facts)
}

fn opened(
    gate: Gate,
    initial_text: &'static str,
    padding: usize,
) -> (Session<Profile>, Facts, NodeId) {
    let facts = Facts::default();
    let profile = Profile {
        binding: ProfileBinding::new(
            "org.example.history-gates",
            "1.0.0",
            "org.example.history-gates/fixture",
            1,
            &[],
        )
        .unwrap(),
        facts: facts.clone(),
        gate,
        initial_text,
        padding,
    };
    let binding = profile.binding.clone();
    let mut session = Session::open(
        profile,
        &binding,
        b"history-gates",
        AdmissionMode::Strict,
        AccessMode::Editable,
    )
    .unwrap();
    let block = session.tree.node(session.tree.root()).unwrap().children()[0];
    let leaf = session.tree.node(block).unwrap().children()[0];
    let at = point(leaf, initial_text.encode_utf16().count());
    session
        .set_selection(
            session.key,
            0,
            Selection {
                anchor: at,
                focus: at,
            },
        )
        .unwrap();
    (session, facts, leaf)
}

fn refused(
    session: &mut Session<Profile>,
    facts: &Facts,
    request: &HistoryRequest,
    expected: TransactionError<&'static str>,
) {
    let before = facets(session);
    let codecs = facts.codecs.get();
    let query = session.query_history(request);
    assert_eq!(facets(session), before, "query changed a committed facet");
    let (reason, error, work) = match query {
        HistoryAvailability::Unavailable {
            reason,
            error,
            work,
        } => (reason, error, work),
        other => panic!("gate unexpectedly available {other:?}"),
    };
    assert_eq!(error, expected);
    for _ in 0..2 {
        match session.execute_history(request) {
            HistoryOutcome::Refused {
                reason: actual_reason,
                error: actual_error,
                work: actual_work,
            } => {
                assert_eq!(actual_reason, reason);
                assert_eq!(actual_error, expected);
                assert_eq!(actual_work, work);
            }
            other => panic!("gate unexpectedly published {other:?}"),
        }
        assert_eq!(facets(session), before, "refusal changed a committed facet");
    }
    assert_eq!(
        facts.codecs.get(),
        codecs,
        "ordinary gate used full codec hooks"
    );
}

fn successful_retry(session: &mut Session<Profile>, facts: &Facts, request: &HistoryRequest) {
    let before = facets(session);
    let codecs = facts.codecs.get();
    let query = session.query_history(request);
    assert_eq!(facets(session), before);
    let (selection_changed, stored_marks_changed, expected_work) = match query {
        HistoryAvailability::Available {
            selection_changed,
            stored_marks_changed,
            work,
        } => (selection_changed, stored_marks_changed, work),
        other => panic!("retained unit not retryable {other:?}"),
    };
    let event = match session.execute_history(request) {
        HistoryOutcome::Completed(event) => event,
        other => panic!("retained unit retry refused {other:?}"),
    };
    assert_eq!(event.work, expected_work);
    assert_eq!(selection_changed, session.selection != before.selection);
    assert_eq!(stored_marks_changed, session.stored_marks != before.marks);
    assert_eq!(session.revision, 3);
    assert_eq!(session.history_summary().undo_units, 1);
    assert_eq!(session.history_summary().redo_units, 0);
    assert_eq!(
        session.tree.document().children[0].children[0]
            .text
            .as_deref(),
        Some("ab")
    );
    assert_eq!(
        facts.codecs.get(),
        codecs,
        "ordinary retry used full codec hooks"
    );
}

#[test]
fn explicit_history_profile_finalizer_error_and_none_to_plain_rewrite_are_atomic() {
    for (gate, error) in [
        (
            Gate::FinalizerError,
            TransactionError::Profile("profile.finalizer_refused"),
        ),
        (
            Gate::FinalizerRewrite,
            TransactionError::History(HistoryError::TypingMismatch),
        ),
    ] {
        let (mut session, facts) = setup(gate);
        let req = request(&session);
        let phases = facts.phases.get();
        refused(&mut session, &facts, &req, error);
        assert_eq!(
            facts.phases.get()[2],
            phases[2] + 3,
            "final typing gate was not reached"
        );
    }
}

#[test]
fn normalization_proposal_refuses_exact_replay_and_keeps_the_same_request_retryable() {
    let (mut session, facts) = setup(Gate::NeedsNormalization);
    let req = request(&session);
    facts.unavailable.set(true);
    let phases = facts.phases.get();
    refused(
        &mut session,
        &facts,
        &req,
        TransactionError::History(HistoryError::NotNormal),
    );
    assert_eq!(facts.phases.get()[0], phases[0] + 3);
    assert_eq!(
        facts.phases.get()[1],
        phases[1],
        "NotNormal unexpectedly ran final validation"
    );
    assert_eq!(
        facts.phases.get()[2],
        phases[2],
        "NotNormal unexpectedly ran final typing"
    );
    facts.unavailable.set(false);
    successful_retry(&mut session, &facts, &req);
}

#[test]
fn current_validator_facts_are_checked_on_query_and_execution_before_same_request_retry() {
    let (mut session, facts) = setup(Gate::ValidatorFacts);
    let req = request(&session);
    facts.unavailable.set(true);
    let phases = facts.phases.get();
    refused(
        &mut session,
        &facts,
        &req,
        TransactionError::Profile("profile.current_fact_missing"),
    );
    assert_eq!(facts.phases.get()[1], phases[1] + 3);
    assert_eq!(
        facts.phases.get()[2],
        phases[2],
        "invalid current facts reached final typing"
    );
    facts.unavailable.set(false);
    successful_retry(&mut session, &facts, &req);
}

#[test]
fn fixed_nonzero_budget_reaches_late_finalizer_then_refuses_atomically_and_retries() {
    let (mut session, facts) = setup(Gate::ExpensiveFinalizer);
    let mut limited = request(&session);
    // A fixed fixture contract: finalizer alone needs 50,000 units. The shared
    // meter has already paid staging+normality+validation, so this cannot fit.
    limited.limits.work.units = FINALIZER_UNITS;
    let phases = facts.phases.get();
    refused(
        &mut session,
        &facts,
        &limited,
        TransactionError::Profile("profile.finalizer_budget"),
    );
    assert_eq!(facts.phases.get()[1], phases[1] + 3);
    assert_eq!(facts.phases.get()[2], phases[2] + 3);
    let full = request(&session);
    successful_retry(&mut session, &facts, &full);
}

#[test]
fn read_only_closed_and_poisoned_history_guards_preserve_all_committed_facets() {
    for expected in [
        StateError::ReadOnly,
        StateError::Closed,
        StateError::Poisoned,
    ] {
        let (mut session, facts) = setup(Gate::Honest);
        match expected {
            // Private guard fixture only; no public mode-changing API is added.
            StateError::ReadOnly => session.state = SessionState::Open(AccessMode::ReadOnly),
            StateError::Closed => session.close(session.key).unwrap(),
            StateError::Poisoned => session.poison(session.key).unwrap(),
            _ => unreachable!(),
        }
        let req = request(&session);
        let phases = facts.phases.get();
        refused(
            &mut session,
            &facts,
            &req,
            TransactionError::State(expected),
        );
        assert_eq!(
            facts.phases.get(),
            phases,
            "lifecycle refusal ran profile hooks"
        );
    }
}

#[test]
fn one_shared_budget_fits_each_member_but_refuses_the_complete_three_member_replay() {
    const PADDING: usize = 8192;
    fn append(session: &mut Session<Profile>, leaf: NodeId, inserted: &str) {
        let Position::Text { utf16, .. } = session.selection.unwrap().focus else {
            panic!("fixture caret must be text")
        };
        let mut transaction = Transaction::new(
            session.key,
            session.revision,
            vec![Operation::ReplaceText {
                leaf: leaf.into(),
                from: utf16,
                to: utf16,
                inserted: inserted.into(),
            }],
        );
        transaction.history_hint = HistoryHint::Typing {
            token: 19,
            class: TypingClass::Insert,
        };
        assert!(matches!(
            session.dispatch(transaction),
            DispatchOutcome::Changed(_)
        ));
    }
    fn undo_request(session: &Session<Profile>) -> HistoryRequest {
        let mut result = request(session);
        result.direction = HistoryDirection::Undo;
        result
    }

    let mut single_members = vec![];
    let mut q = 0;
    for (before_text, inserted) in [("a", "b"), ("ab", "c"), ("abc", "d")] {
        let (mut session, facts, leaf) = opened(Gate::Honest, before_text, PADDING);
        let codecs = facts.codecs.get();
        append(&mut session, leaf, inserted);
        let request = undo_request(&session);
        let before = facets(&session);
        let actual = match session.query_history(&request) {
            HistoryAvailability::Available { work, .. } => work,
            other => panic!("single member unexpectedly unavailable {other:?}"),
        };
        assert_eq!(facets(&session), before);
        assert_eq!(facts.codecs.get(), codecs);
        q = q.max(actual.units);
        single_members.push((session, facts, request));
    }
    // Q is target-local cost calibration, never a restoration oracle or a
    // portable report constant. All document/selection checkpoints below are
    // independent literals; the same Q must fit ALL three complete singles.
    for (mut session, facts, mut request) in single_members {
        request.limits.work.units = q;
        let before = facets(&session);
        let codecs = facts.codecs.get();
        let expected = match session.query_history(&request) {
            HistoryAvailability::Available { work, .. } => work,
            other => panic!("Q did not fit a complete single member {other:?}"),
        };
        assert!(expected.units <= q);
        assert_eq!(facets(&session), before);
        match session.execute_history(&request) {
            HistoryOutcome::Completed(event) => assert_eq!(event.work, expected),
            other => panic!("Q refused a complete single member {other:?}"),
        }
        assert_eq!(
            session.tree.document(),
            fixture_document(session.profile.initial_text, PADDING)
        );
        assert_eq!(facts.codecs.get(), codecs);
    }

    let (mut grouped, facts, leaf) = opened(Gate::Honest, "a", PADDING);
    let original_records = facets(&grouped).records;
    let codecs = facts.codecs.get();
    for inserted in ["b", "c", "d"] {
        append(&mut grouped, leaf, inserted);
    }
    assert_eq!(grouped.tree.document(), fixture_document("abcd", PADDING));
    assert_eq!(grouped.history_summary().undo_units, 1);
    assert_eq!(grouped.history_summary().undo_members, 3);
    let unit = grouped.history.replay_unit(HistoryDirection::Undo).unwrap();
    let stage_sum: u64 = unit
        .members()
        .iter()
        .map(|member| member.replay_cost(ReplayDirection::Undo).units)
        .sum();
    assert!(
        stage_sum > q,
        "fixture must make grouped staging alone exceed single Q: {stage_sum} <= {q}"
    );
    let mut limited = undo_request(&grouped);
    limited.limits.work.units = q;
    let phases = facts.phases.get();
    refused(
        &mut grouped,
        &facts,
        &limited,
        TransactionError::Tree(TreeError::ResourceLimit),
    );
    assert_eq!(
        facts.phases.get(),
        phases,
        "group should exhaust the shared meter before final profile gates"
    );

    for (direction, expected_text, expected_revision, caret) in [
        (HistoryDirection::Undo, "a", 4, 1),
        (HistoryDirection::Redo, "abcd", 5, 4),
    ] {
        let mut request = request(&grouped);
        request.direction = direction;
        let before = facets(&grouped);
        let expected = match grouped.query_history(&request) {
            HistoryAvailability::Available { work, .. } => work,
            other => panic!("unrestricted group retry unavailable {other:?}"),
        };
        assert_eq!(facets(&grouped), before);
        match grouped.execute_history(&request) {
            HistoryOutcome::Completed(event) => assert_eq!(event.work, expected),
            other => panic!("unrestricted group retry refused {other:?}"),
        }
        assert_eq!(
            grouped.tree.document(),
            fixture_document(expected_text, PADDING)
        );
        assert_eq!(grouped.revision, expected_revision);
        assert_eq!(
            grouped.selection,
            Some(Selection {
                anchor: point(leaf, caret),
                focus: point(leaf, caret)
            })
        );
        assert_eq!(grouped.stored_marks, None);
        if direction == HistoryDirection::Undo {
            assert_eq!(facets(&grouped).records, original_records);
        }
    }
    assert_eq!(
        facts.codecs.get(),
        codecs,
        "ordinary grouped replay used full codec hooks"
    );
}
