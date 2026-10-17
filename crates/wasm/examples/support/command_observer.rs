// SPDX-License-Identifier: MIT OR Apache-2.0
//! Test-only actual KWDJ command witnesses. Literal expectations predate implementation.
//! Snapshot calls below are explicit test checkpoints, counted independently of edits.
use editor_core::candidate::CandidateRead;
use editor_core::commands::{
    CommandDescriptor, CommandPresentation, CommandProvider, CommandState, PlanBuilder,
};
use editor_core::document::{Document, Mark};
use editor_core::positions::{Affinity, Edge, Position, Selection, Utf16Offset};
use editor_core::profile::{AdmissionMode, FrozenProfile, ProfileBinding};
use editor_core::transaction::{Operation, TransactionProfile, ValidationStats, WorkMeter};
use editor_engine::{
    AccessMode, CommandAvailability, CommandEffect, CommandOutcome, CommandRequest,
    DispatchOutcome, NodeId, Session,
};
use editor_kwdj::commands::{BlockTarget, KwdjIntent};
use editor_kwdj::{
    AdmissionBudget, IdentityResolver, IdentityResolverError, IdentityStatus, KwdjProfile,
    KwdjProfileError, Limits,
};
use serde_json::{Value, json};
use std::{cell::Cell, rc::Rc};
use uuid::Uuid;

#[path = "command_inline.rs"]
mod inline;
#[path = "command_structural.rs"]
mod structural;

const PREFIX: &str = "org.klenwriter.kwdj/";
const VECTORS: &str = include_str!("../../../../contracts/commands/v1/vectors.json");
struct Identities;
impl IdentityResolver for Identities {
    fn resolve_media(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(IdentityStatus::Missing)
    }
    fn resolve_reference(&self, id: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(
            if id.to_string() == "550e8400-e29b-41d4-a716-446655440006" {
                IdentityStatus::Exists
            } else {
                IdentityStatus::Missing
            },
        )
    }
}
static IDENTITIES: Identities = Identities;
#[derive(Clone, Default)]
struct Calls(Rc<Cell<[u64; 4]>>);
impl Calls {
    fn bump(&self, i: usize) {
        let mut n = self.0.get();
        n[i] += 1;
        self.0.set(n);
    }
}
struct Counted {
    inner: KwdjProfile<'static>,
    calls: Calls,
}
impl FrozenProfile for Counted {
    type Context = <KwdjProfile<'static> as FrozenProfile>::Context;
    type Admitted = <KwdjProfile<'static> as FrozenProfile>::Admitted;
    type Error = KwdjProfileError;
    fn binding(&self) -> &ProfileBinding {
        self.inner.binding()
    }
    fn admit_bytes(
        &self,
        b: &ProfileBinding,
        bytes: &[u8],
        m: AdmissionMode,
    ) -> Result<Self::Admitted, Self::Error> {
        self.calls.bump(0);
        self.inner.admit_bytes(b, bytes, m)
    }
    fn context(&self, a: &Self::Admitted) -> Self::Context {
        self.inner.context(a)
    }
    fn to_document(&self, a: &Self::Admitted) -> Document {
        self.calls.bump(1);
        self.inner.to_document(a)
    }
    fn admit_snapshot(
        &self,
        c: &Self::Context,
        d: &Document,
    ) -> Result<Self::Admitted, Self::Error> {
        self.calls.bump(2);
        self.inner.admit_snapshot(c, d)
    }
    fn canonical<'a>(&self, a: &'a Self::Admitted) -> &'a [u8] {
        self.calls.bump(3);
        self.inner.canonical(a)
    }
}
impl TransactionProfile for Counted {
    fn normalize_candidate<V: CandidateRead>(
        &self,
        c: &Self::Context,
        v: &V,
        w: &mut WorkMeter,
    ) -> Result<Vec<Operation<V::Id>>, Self::Error> {
        self.inner.normalize_candidate(c, v, w)
    }
    fn validate_candidate<V: CandidateRead>(
        &self,
        c: &Self::Context,
        v: &V,
        w: &mut WorkMeter,
    ) -> Result<ValidationStats, Self::Error> {
        self.inner.validate_candidate(c, v, w)
    }
}
impl CommandProvider for Counted {
    type Intent<I: Copy + Eq + Ord> = KwdjIntent<I>;
    const COMMANDS: &'static [CommandDescriptor] =
        <KwdjProfile<'static> as CommandProvider>::COMMANDS;
    fn command_id<I: Copy + Eq + Ord>(i: &Self::Intent<I>) -> &str {
        <KwdjProfile<'static> as CommandProvider>::command_id(i)
    }
    fn prepare_command<V: CandidateRead>(
        &self,
        c: &Self::Context,
        v: &V,
        s: CommandState<'_, V::Id>,
        i: &Self::Intent<V::Id>,
        p: &mut PlanBuilder<'_, V::Id>,
    ) -> Result<CommandPresentation, Self::Error> {
        self.inner.prepare_command(c, v, s, i, p)
    }
    fn finalize_typing_override<V: CandidateRead>(
        &self,
        c: &Self::Context,
        v: &V,
        s: Option<Selection<V::Id>>,
        m: Option<&[Mark]>,
        w: &mut WorkMeter,
    ) -> Result<Option<Vec<Mark>>, Self::Error> {
        self.inner.finalize_typing_override(c, v, s, m, w)
    }
    fn error_code(e: &Self::Error) -> &'static str {
        <KwdjProfile<'static> as CommandProvider>::error_code(e)
    }
}
fn profile() -> KwdjProfile<'static> {
    KwdjProfile::new(&IDENTITIES, Limits::default(), AdmissionBudget::default())
}
fn open(v: &Value) -> (Session<Counted>, Calls) {
    let calls = Calls::default();
    let p = Counted {
        inner: profile(),
        calls: calls.clone(),
    };
    let b = p.binding().clone();
    (
        Session::open(
            p,
            &b,
            &serde_json::to_vec(v).unwrap(),
            AdmissionMode::Strict,
            AccessMode::Editable,
        )
        .unwrap(),
        calls,
    )
}
fn canonical(v: &Value) -> String {
    let p = profile();
    let a = p
        .admit_bytes(
            p.binding(),
            &serde_json::to_vec(v).unwrap(),
            AdmissionMode::Import,
        )
        .unwrap();
    String::from_utf8(p.canonical(&a).to_vec()).unwrap()
}
fn doc(s: &Session<Counted>) -> String {
    String::from_utf8(s.export_snapshot(s.key(), s.revision()).unwrap()).unwrap()
}
fn at(s: &Session<Counted>, path: &str) -> NodeId {
    let mut id = s.root(s.key()).unwrap();
    if !path.is_empty() {
        let parts = path.trim_start_matches('/').split('/').collect::<Vec<_>>();
        assert_eq!(parts.len() % 2, 0);
        for pair in parts.chunks_exact(2) {
            assert_eq!(pair[0], "content");
            id = s.node(s.key(), id).unwrap().children()[pair[1].parse::<usize>().unwrap()];
        }
    }
    id
}
fn affinity(v: &Value) -> Affinity {
    match v.as_str().unwrap() {
        "before" => Affinity::Before,
        "after" => Affinity::After,
        _ => panic!("fixture affinity"),
    }
}
fn position(s: &Session<Counted>, v: &Value) -> Position<NodeId> {
    let id = at(s, v["path"].as_str().unwrap());
    match v["kind"].as_str().unwrap() {
        "text" => Position::Text {
            leaf: id,
            utf16: Utf16Offset::new(v["utf16"].as_u64().unwrap() as usize),
            affinity: affinity(&v["affinity"]),
        },
        "child" => Position::Child {
            parent: id,
            index: v["index"].as_u64().unwrap() as usize,
            affinity: affinity(&v["affinity"]),
        },
        "edge" => Position::Edge {
            node: id,
            side: if v["side"] == "before" {
                Edge::Before
            } else {
                Edge::After
            },
        },
        _ => panic!("fixture position"),
    }
}
fn selection(s: &Session<Counted>, v: &Value) -> Selection<NodeId> {
    if v.get("caret").is_some() {
        let p = position(s, &v["caret"]);
        Selection {
            anchor: p,
            focus: p,
        }
    } else {
        Selection {
            anchor: position(s, &v["selection"]["anchor"]),
            focus: position(s, &v["selection"]["focus"]),
        }
    }
}
fn intent(s: &Session<Counted>, v: &Value) -> KwdjIntent<NodeId> {
    match v["semantic"].as_str().unwrap() {
        "enter" => KwdjIntent::Enter,
        "shift_enter" => KwdjIntent::ShiftEnter,
        "transform_block" => KwdjIntent::TransformBlock {
            target: BlockTarget::Heading {
                level: v["level"].as_u64().unwrap() as u8,
            },
        },
        "add_mark" => KwdjIntent::ToggleMark {
            mark: Mark {
                type_id: format!("{PREFIX}{}", v["mark"].as_str().unwrap()),
                attributes: Default::default(),
            },
        },
        "set_ordinary_link" => KwdjIntent::SetLink {
            href: v["href"].as_str().unwrap().into(),
            title: v["title"].as_str().map(str::to_owned),
        },
        "accept_slash_block" => {
            assert_eq!(v["candidate"], "scene_break");
            let q = &v["captured_query"];
            KwdjIntent::AcceptSlash {
                target: BlockTarget::SceneBreak,
                range: Selection {
                    anchor: position(s, &q["from"]),
                    focus: position(s, &q["to"]),
                },
                literal: q["literal"].as_str().unwrap().into(),
            }
        }
        "dismiss_slash" => KwdjIntent::DismissSlash,
        _ => panic!("unbound fixture intent"),
    }
}
type Checkpoint = (
    String,
    Option<Selection<NodeId>>,
    Option<Vec<Mark>>,
    u64,
    u64,
    bool,
    editor_engine::JournalSummary,
    Vec<editor_engine::JournalEntrySummary>,
);
fn checkpoint(s: &Session<Counted>) -> Checkpoint {
    (
        doc(s),
        s.selection(s.key()).unwrap(),
        s.stored_marks(s.key()).unwrap().map(<[Mark]>::to_vec),
        s.revision(),
        s.selection_epoch(),
        s.dirty(),
        s.journal_summary(),
        s.journal_entries(),
    )
}
fn semantic_reason(
    reason: &str,
    error: &editor_engine::CommandError<KwdjProfileError>,
) -> &'static str {
    use editor_engine::{CommandError, TransactionError};
    match error {
        CommandError::Transaction(TransactionError::Tree(
            editor_engine::tree::TreeError::Position(
                editor_core::positions::PositionError::NotGraphemeBoundary,
            ),
        )) => "not_grapheme_boundary",
        _ => match reason {
            "kwdj.command_reference_protected" => "reference_link_protected",
            "transaction.journal_limit" => "journal_limit",
            "kwdj.command_ordered_overflow" => "ordered_start_overflow",
            _ => "UNBOUND_REFUSAL",
        },
    }
}
macro_rules! ensure {($condition:expr,$($message:tt)*)=>{if !$condition{return Err(format!($($message)*));}}}
fn run(v: &Value) -> Result<Value, String> {
    let (mut s, calls) = open(&v["before"]["document"]);
    let initial = selection(&s, &v["before"]);
    s.set_selection(s.key(), 0, initial).unwrap();
    let before = checkpoint(&s);
    let mut request = CommandRequest::new(
        s.key(),
        s.revision(),
        s.selection_epoch(),
        intent(&s, &v["intent"]),
    );
    if let Some(n) = v["intent"]["host_limits"]["journal_entries"].as_u64() {
        request.limits.journal_entries = n as usize;
    }
    let count = calls.0.get();
    let query = s.query_command(&request);
    ensure!(calls.0.get() == count, "query called snapshot/codec hook");
    for _ in 0..3 {
        ensure!(
            s.query_command(&request) == query,
            "repeated full query changed result/work"
        );
        ensure!(
            calls.0.get() == count,
            "repeat query called snapshot/codec hook"
        );
    }
    ensure!(checkpoint(&s) == before, "query mutated committed state");
    let count = calls.0.get();
    let result = s.execute_command(&request);
    ensure!(calls.0.get() == count, "execute called snapshot/codec hook");
    let (outcome, reason, work) = match (&query, &result) {
        (
            CommandAvailability::Available {
                effect,
                work,
                presentation,
                ..
            },
            CommandOutcome::Completed {
                outcome,
                presentation: executed,
            },
        ) => {
            ensure!(presentation == executed, "query presentation != execute");
            let (name, e, w) = match outcome {
                DispatchOutcome::Changed(e) => ("Changed", CommandEffect::Changed, e.work),
                DispatchOutcome::Unchanged { work, .. } => {
                    ("Unchanged", CommandEffect::Unchanged, *work)
                }
                other => return Err(format!("available but {other:?}")),
            };
            ensure!(*effect == e, "query effect != execute");
            ensure!(*work == w, "query work != execute");
            (name, None, w)
        }
        (
            CommandAvailability::Unavailable {
                reason: r,
                error: e,
                work: w,
            },
            CommandOutcome::Refused {
                reason,
                error,
                work,
            },
        ) => {
            ensure!(
                r == reason && e == error && w == work,
                "query refusal != execute"
            );
            (
                "Refused",
                Some((*reason, semantic_reason(reason, error))),
                *work,
            )
        }
        _ => return Err(format!("query/execute mismatch: {query:?} / {result:?}")),
    };
    let after = checkpoint(&s);
    if let CommandAvailability::Available {
        selection_changed,
        stored_marks_changed,
        ..
    } = &query
    {
        ensure!(
            *selection_changed == (after.1 != before.1),
            "predicted selection change flag"
        );
        ensure!(
            *stored_marks_changed == (after.2 != before.2),
            "predicted typing change flag"
        );
        if let CommandOutcome::Completed {
            outcome:
                DispatchOutcome::Unchanged {
                    selection_changed: actual_selection,
                    stored_marks_changed: actual_marks,
                    ..
                },
            ..
        } = &result
        {
            ensure!(
                actual_selection == selection_changed && actual_marks == stored_marks_changed,
                "unchanged facet flags differ"
            );
        }
    }
    if let CommandOutcome::Completed {
        outcome: DispatchOutcome::Changed(event),
        ..
    } = &result
    {
        ensure!(
            event.selection_before == before.1 && event.selection_after == after.1,
            "commit selection facets"
        );
        ensure!(
            event.stored_marks_before == before.2 && event.stored_marks_after == after.2,
            "commit typing facets"
        );
    }
    let expected = &v["expected"];
    if let Some(enabled) = v["expected_availability"]["enabled"].as_bool() {
        ensure!(
            matches!(query, CommandAvailability::Available { .. }) == enabled,
            "literal availability mismatch"
        );
    }
    if let Some(change) = v["expected_availability"]["would_change"].as_bool() {
        ensure!(
            (outcome == "Changed") == change,
            "literal predicted effect mismatch"
        );
    }
    ensure!(
        outcome == expected["outcome"].as_str().unwrap(),
        "outcome {outcome}, expected {}; query {query:?}",
        expected["outcome"]
    );
    ensure!(
        after.0 == canonical(&expected["document"]),
        "document mismatch: actual {} expected {}",
        after.0,
        canonical(&expected["document"])
    );
    let selected = selection(&s, expected);
    ensure!(
        after.1 == Some(selected),
        "caret mismatch: actual {:?} expected {:?}",
        after.1,
        selected
    );
    ensure!(
        s.revision() - before.3 == expected["document_revision_delta"].as_u64().unwrap(),
        "revision delta"
    );
    ensure!(
        s.journal_summary().entries - before.6.entries
            == usize::from(expected["journal_entry_added"].as_bool().unwrap()),
        "journal delta"
    );
    if let Some(expected_reason) = expected["reason_semantic"].as_str() {
        ensure!(
            reason.map(|r| r.1) == Some(expected_reason),
            "wrong refusal {reason:?}, expected {expected_reason}; {query:?}"
        );
    }
    if let Some(dirty) = expected["dirty_after"].as_bool() {
        ensure!(s.dirty() == dirty, "dirty mismatch");
    }
    if expected["preserve_all_session_facets"] == true {
        ensure!(after == before, "refusal/no-op changed committed facets");
    }
    ensure!(
        work.units <= request.limits.work.units && work.bytes <= request.limits.work.bytes,
        "work exceeded host bounds"
    );
    Ok(
        json!({"id":v["id"],"status":"passed","outcome":outcome,"reason":reason.map(|r|r.0),"canonical_json":after.0,"revision_delta":s.revision()-before.3,"journal_entries_added":s.journal_summary().entries-before.6.entries,"query_repetitions":4,"full_query_execute_equal":true,"query_preserves_all_facets":true,"ordinary_snapshot_codec_calls":0,"work_bounded":true,"literal_caret_matches":true}),
    )
}
fn generated() -> Value {
    let prefixes = ["a", "😀", "e\u{301}", "👩‍🚀", "🇨🇦", "Ж", "漢字", "👍🏽"];
    let suffixes = ["z", "😀!", "e\u{301}b", "👩‍🚀 tail"];
    let mut count = 0;
    for prefix in prefixes {
        for suffix in suffixes {
            for marked in [false, true] {
                let mut attrs = json!({"align":"right","first_line_indent":true});
                if !marked {
                    attrs = json!({"align":"center"});
                }
                let text = |t: &str| {
                    if marked {
                        json!({"type":"text","text":t,"marks":[{"type":"strong"}]})
                    } else {
                        json!({"type":"text","text":t})
                    }
                };
                let wire = |content: Value| json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":content});
                let v = json!({"id":format!("generated-enter-{count}"),"before":{"document":wire(json!([{"type":"paragraph","attrs":attrs,"content":[text(&format!("{prefix}{suffix}"))]}])),"caret":{"kind":"text","path":"/content/0/content/0","utf16":prefix.encode_utf16().count(),"affinity":"after"}},
            "intent":{"semantic":"enter"},"expected_availability":{"enabled":true,"would_change":true},"expected":{"outcome":"Changed","document":wire(json!([{"type":"paragraph","attrs":attrs,"content":[text(prefix)]},{"type":"paragraph","attrs":attrs,"content":[text(suffix)]}])),"caret":{"kind":"text","path":"/content/1/content/0","utf16":0,"affinity":"after"},"document_revision_delta":1,"journal_entry_added":true,"dirty_after":true}});
                assert_eq!(run(&v).unwrap()["status"], "passed");
                count += 1;
            }
        }
    }
    let mut refused = 0;
    for (cluster, interior) in [("e\u{301}", 1), ("👩‍🚀", 2), ("🇨🇦", 2), ("👍🏽", 2)]
    {
        let wire = json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[{"type":"text","text":format!("A{cluster}Z")}]}]});
        let range = json!({"anchor":{"kind":"text","path":"/content/0/content/0","utf16":1,"affinity":"after"},"focus":{"kind":"text","path":"/content/0/content/0","utf16":1+interior,"affinity":"before"}});
        let v = json!({"id":format!("generated-interior-{refused}"),"before":{"document":wire,"selection":range},"intent":{"semantic":"add_mark","mark":"strong"},"expected_availability":{"enabled":false,"reason_semantic":"not_grapheme_boundary"},"expected":{"outcome":"Refused","document":wire,"selection":range,"reason_semantic":"not_grapheme_boundary","document_revision_delta":0,"journal_entry_added":false,"preserve_all_session_facets":true}});
        assert_eq!(run(&v).unwrap()["status"], "passed");
        refused += 1;
    }
    json!({"status":"passed","enter_cases":count,"interior_refusals":refused,"oracle":"parameterized literal split/text/layout/mark and original EGC boundaries","query_execute_equal":true,"snapshot_codec_calls":0})
}
fn execute(
    s: &mut Session<Counted>,
    calls: &Calls,
    i: KwdjIntent<NodeId>,
) -> DispatchOutcome<KwdjProfileError> {
    let r = CommandRequest::new(s.key(), s.revision(), s.selection_epoch(), i);
    let before_selection = s.selection(s.key()).unwrap();
    let before_marks = s.stored_marks(s.key()).unwrap().map(<[Mark]>::to_vec);
    let before = calls.0.get();
    let q = s.query_command(&r);
    let outcome = s.execute_command(&r);
    assert_eq!(calls.0.get(), before, "ordinary path used codec/snapshot");
    let CommandAvailability::Available {
        work,
        effect,
        presentation,
        selection_changed,
        stored_marks_changed,
    } = q
    else {
        panic!("unexpected query refusal {q:?}")
    };
    let CommandOutcome::Completed {
        presentation: p,
        outcome,
    } = outcome
    else {
        panic!("available command refused {outcome:?}")
    };
    assert_eq!(p, presentation);
    assert_eq!(
        selection_changed,
        s.selection(s.key()).unwrap() != before_selection
    );
    assert_eq!(
        stored_marks_changed,
        s.stored_marks(s.key()).unwrap() != before_marks.as_deref()
    );
    if let DispatchOutcome::Unchanged {
        selection_changed: actual_selection,
        stored_marks_changed: actual_marks,
        ..
    } = &outcome
    {
        assert_eq!(
            (*actual_selection, *actual_marks),
            (selection_changed, stored_marks_changed)
        );
    }
    match &outcome {
        DispatchOutcome::Changed(e) => {
            assert_eq!(effect, CommandEffect::Changed);
            assert_eq!(work, e.work)
        }
        DispatchOutcome::Unchanged { work: w, .. } => {
            assert_eq!(effect, CommandEffect::Unchanged);
            assert_eq!(work, *w)
        }
        x => panic!("unexpected refusal {x:?}"),
    };
    outcome
}
fn future_typing() -> Value {
    let wire = json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[{"type":"text","text":"ab"}]}]});
    let (mut s, calls) = open(&wire);
    let initial = selection(
        &s,
        &json!({"caret":{"kind":"text","path":"/content/0/content/0","utf16":1,"affinity":"after"}}),
    );
    s.set_selection(s.key(), 0, initial).unwrap();
    let start = checkpoint(&s);
    let strong = Mark {
        type_id: format!("{PREFIX}strong"),
        attributes: Default::default(),
    };
    assert!(matches!(
        execute(
            &mut s,
            &calls,
            KwdjIntent::ToggleMark {
                mark: strong.clone()
            }
        ),
        DispatchOutcome::Unchanged {
            stored_marks_changed: true,
            ..
        }
    ));
    assert_eq!(
        s.stored_marks(s.key()).unwrap(),
        Some([strong.clone()].as_slice())
    );
    assert_eq!(doc(&s), start.0);
    assert_eq!(s.revision(), 0);
    assert!(!s.dirty());
    assert_eq!(s.journal_summary().entries, 0);
    assert_eq!(s.selection_epoch(), start.4 + 1);
    let DispatchOutcome::Changed(first) =
        execute(&mut s, &calls, KwdjIntent::InsertText { text: "x".into() })
    else {
        panic!("typing must commit")
    };
    assert_eq!(first.stored_marks_before, Some(vec![strong.clone()]));
    assert_eq!(first.stored_marks_after, Some(vec![strong.clone()]));
    assert_eq!(
        s.journal_entries()[0].stored_marks_before,
        first.stored_marks_before
    );
    assert_eq!(
        s.journal_entries()[0].stored_marks_after,
        first.stored_marks_after
    );
    assert!(matches!(
        execute(&mut s, &calls, KwdjIntent::ToggleMark { mark: strong }),
        DispatchOutcome::Unchanged {
            stored_marks_changed: true,
            ..
        }
    ));
    assert_eq!(s.stored_marks(s.key()).unwrap(), Some([].as_slice()));
    let DispatchOutcome::Changed(second) =
        execute(&mut s, &calls, KwdjIntent::InsertText { text: "y".into() })
    else {
        panic!("plain typing must commit")
    };
    assert_eq!(second.stored_marks_before, Some(vec![]));
    assert_eq!(second.stored_marks_after, Some(vec![]));
    let expected = json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[{"type":"text","text":"a"},{"type":"text","text":"x","marks":[{"type":"strong"}]},{"type":"text","text":"yb"}]}]});
    assert_eq!(doc(&s), canonical(&expected));
    let before = s.selection_epoch();
    let pos = selection(
        &s,
        &json!({"caret":{"kind":"text","path":"/content/0/content/0","utf16":0,"affinity":"after"}}),
    );
    s.set_selection(s.key(), s.revision(), pos).unwrap();
    assert_eq!(s.stored_marks(s.key()).unwrap(), None);
    assert_eq!(s.selection_epoch(), before + 1);
    json!({"status":"passed","state_only_toggles":2,"typing_commits":2,"explicit_plain_distinguished_from_inherit":true,"actual_journal_mark_before_after":true,"navigation_clears_override":true,"ordinary_snapshot_codec_calls":0,"canonical_json":doc(&s)})
}
pub fn observe() -> Value {
    let vectors: Value = serde_json::from_str(VECTORS).unwrap();
    let cases = vectors["vectors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| match run(v) {
            Ok(r) => r,
            Err(error) => json!({"id":v["id"],"status":"failed","error":error}),
        })
        .collect::<Vec<_>>();
    let passed = cases.iter().filter(|v| v["status"] == "passed").count();
    json!({"format":"klenwriter-editor-command-observations","version":1,"status":if passed==cases.len(){"passed"}else{"failed"},"literal_cases":cases,"literal_total":24,"literal_passed":passed,"generated":generated(),"future_typing":future_typing(),"structural":structural::observe(),"inline":inline::observe(),"scope":"Actual native/bootstrap Session<KwdjProfile>; no public transport or mounted UI claim"})
}
