// SPDX-License-Identifier: MIT OR Apache-2.0
//! OSR-39 literals frozen before the candidate. Shared native/WASM witnesses.
use editor_core::document::{Attributes, Mark};
use editor_core::positions::{Affinity, Position, Selection, Utf16Offset};
use editor_core::profile::{AdmissionMode, FrozenProfile};
use editor_core::transaction::WorkLimits;
use editor_engine::history::HistoryDirection;
use editor_engine::transaction::CommitEvent;
use editor_engine::{
    AccessMode, CommandAvailability, CommandEffect, CommandOutcome, CommandRequest,
    DispatchOutcome, HistoryOutcome, HistoryRequest, NodeId, Session,
};
use editor_kwdj::commands::KwdjIntent;
use editor_kwdj::{
    AdmissionBudget, IdentityResolver, IdentityResolverError, IdentityStatus, KwdjProfile, Limits,
};
use serde_json::{Value, json};
use uuid::Uuid;

struct Identities;
impl IdentityResolver for Identities {
    fn resolve_media(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(IdentityStatus::Missing)
    }
    fn resolve_reference(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(IdentityStatus::Missing)
    }
}
static IDENTITIES: Identities = Identities;
type Editor = Session<KwdjProfile<'static>>;
fn open(input: &[u8], access: AccessMode) -> Editor {
    let profile = KwdjProfile::new(&IDENTITIES, Limits::default(), AdmissionBudget::default());
    let binding = profile.binding().clone();
    Session::open(profile, &binding, input, AdmissionMode::Strict, access).unwrap()
}
fn wire(content: Value) -> Vec<u8> {
    serde_json::to_vec(&json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":content})).unwrap()
}
fn text(value: &str, strong: bool) -> Value {
    if strong {
        json!({"type":"text","text":value,"marks":[{"type":"strong"}]})
    } else {
        json!({"type":"text","text":value})
    }
}
fn paragraph(content: Value) -> Value {
    json!({"type":"paragraph","content":content})
}
fn at(s: &Editor, path: &[usize]) -> NodeId {
    path.iter().fold(s.root(s.key()).unwrap(), |id, index| {
        s.node(s.key(), id).unwrap().children()[*index]
    })
}
fn point(id: NodeId, n: usize) -> Position<NodeId> {
    Position::Text {
        leaf: id,
        utf16: Utf16Offset::new(n),
        affinity: Affinity::After,
    }
}
fn child(id: NodeId, n: usize) -> Position<NodeId> {
    Position::Child {
        parent: id,
        index: n,
        affinity: Affinity::After,
    }
}
fn collapsed(point: Position<NodeId>) -> Selection<NodeId> {
    Selection {
        anchor: point,
        focus: point,
    }
}
fn select(s: &mut Editor, selection: Selection<NodeId>) {
    s.set_selection(s.key(), s.revision(), selection).unwrap();
}
fn snapshot(s: &Editor) -> Vec<u8> {
    s.export_snapshot(s.key(), s.revision()).unwrap()
}
fn assert_document(s: &Editor, content: Value) {
    assert_eq!(
        serde_json::from_slice::<Value>(&snapshot(s)).unwrap(),
        serde_json::from_slice::<Value>(&wire(content)).unwrap()
    );
}
fn facets(s: &Editor) -> String {
    format!(
        "{:?}",
        (
            snapshot(s),
            s.stamp(),
            s.selection(s.key()).unwrap(),
            s.stored_marks(s.key()).unwrap(),
            s.history_summary(),
            s.journal_entries(),
            s.dirty(),
            s.event_status(s.key()).unwrap()
        )
    )
}
fn execute(
    s: &mut Editor,
    intent: KwdjIntent<NodeId>,
    effect: CommandEffect,
) -> Option<CommitEvent> {
    let request = CommandRequest::new(s.key(), s.revision(), s.selection_epoch(), intent);
    let before = facets(s);
    let query = s.query_command(&request);
    assert_eq!(
        facets(s),
        before,
        "query must not publish or allocate real identities"
    );
    let CommandAvailability::Available {
        effect: predicted,
        presentation,
        work,
        ..
    } = query
    else {
        panic!("expected availability: {query:?}")
    };
    assert_eq!(predicted, effect);
    assert_eq!(presentation.active, None);
    let outcome = s.execute_command(&request);
    match outcome {
        CommandOutcome::Completed {
            outcome: DispatchOutcome::Changed(event),
            ..
        } => {
            assert_eq!(effect, CommandEffect::Changed);
            assert_eq!(event.work, work);
            Some(event)
        }
        CommandOutcome::Completed {
            outcome: DispatchOutcome::Unchanged { work: actual, .. },
            ..
        } => {
            assert_eq!(effect, CommandEffect::Unchanged);
            assert_eq!(actual, work);
            assert_eq!(facets(s), before, "true no-op retains all committed facets");
            None
        }
        other => panic!("query/execute mismatch: {other:?}"),
    }
}
fn backward(s: &mut Editor) -> CommitEvent {
    execute(s, KwdjIntent::DeleteBackward, CommandEffect::Changed).unwrap()
}
fn refuse_request(s: &mut Editor, request: &CommandRequest<KwdjIntent<NodeId>>, code: &str) {
    let before = facets(s);
    let CommandAvailability::Unavailable { reason, work, .. } = s.query_command(request) else {
        panic!("unexpected availability")
    };
    assert_eq!(reason, code);
    assert_eq!(facets(s), before);
    let CommandOutcome::Refused {
        reason,
        work: actual,
        ..
    } = s.execute_command(request)
    else {
        panic!("unexpected execution")
    };
    assert_eq!(reason, code);
    assert_eq!(actual, work);
    assert_eq!(
        facets(s),
        before,
        "refusal must retain all committed facets"
    );
}
fn refuse(s: &mut Editor, code: &str) {
    let request = CommandRequest::new(
        s.key(),
        s.revision(),
        s.selection_epoch(),
        KwdjIntent::DeleteBackward,
    );
    refuse_request(s, &request, code);
}
fn replay(s: &mut Editor, direction: HistoryDirection) {
    let request = HistoryRequest::new(
        s.key(),
        s.revision(),
        s.selection_epoch(),
        s.history_summary().epoch,
        direction,
    );
    assert!(matches!(
        s.execute_history(&request),
        HistoryOutcome::Completed(_)
    ));
}
fn t02() {
    const D0: &[u8] = include_bytes!("../../../../contracts/dom/v1/inputs/D0.json");
    const C0: &[u8] = include_bytes!("../../../../contracts/dom/v1/expected/D0.canonical.json");
    const C1: &[u8] =
        include_bytes!("../../../../contracts/dom/v1/expected/D1-after-end-split.canonical.json");
    let mut s = open(D0, AccessMode::Editable);
    let p1 = at(&s, &[0]);
    let p2 = at(&s, &[1]);
    let ta = at(&s, &[0, 0]);
    let tb = at(&s, &[0, 1]);
    let tc = at(&s, &[0, 2]);
    let t2 = at(&s, &[1, 0]);
    let original = collapsed(point(tc, 2));
    select(&mut s, original);
    execute(&mut s, KwdjIntent::Enter, CommandEffect::Changed);
    assert_eq!(snapshot(&s), C1);
    let empty = at(&s, &[1]);
    assert_eq!(
        s.selection(s.key()).unwrap(),
        Some(collapsed(child(empty, 0)))
    );
    let event = backward(&mut s);
    assert_eq!(snapshot(&s), C0);
    assert_eq!(s.selection(s.key()).unwrap(), Some(original));
    assert_eq!(event.selection_before, Some(collapsed(child(empty, 0))));
    assert_eq!(event.selection_after, Some(original));
    assert!(s.node(s.key(), empty).is_err());
    assert_eq!(
        [
            at(&s, &[0]),
            at(&s, &[1]),
            at(&s, &[0, 0]),
            at(&s, &[0, 1]),
            at(&s, &[0, 2]),
            at(&s, &[1, 0])
        ],
        [p1, p2, ta, tb, tc, t2]
    );
    assert_eq!(s.history_summary().undo_units, 2);
    replay(&mut s, HistoryDirection::Undo);
    assert_eq!(snapshot(&s), C1);
    assert_eq!(at(&s, &[1]), empty);
    assert_eq!(
        s.selection(s.key()).unwrap(),
        Some(collapsed(child(empty, 0)))
    );
    replay(&mut s, HistoryDirection::Undo);
    assert_eq!(snapshot(&s), C0);
    assert_eq!(s.selection(s.key()).unwrap(), Some(original));
    assert_eq!(s.history_summary().undo_units, 0);
    assert_eq!(s.history_summary().redo_units, 2);
    replay(&mut s, HistoryDirection::Redo);
    assert_eq!(snapshot(&s), C1);
    assert_eq!(at(&s, &[1]), empty);
    replay(&mut s, HistoryDirection::Redo);
    assert_eq!(snapshot(&s), C0);
    assert_eq!(s.selection(s.key()).unwrap(), Some(original));
    assert!(s.node(s.key(), empty).is_err());
    assert_eq!(s.revision(), 6);
}
fn t03() {
    const INPUT: &[u8] = include_bytes!("../../../../contracts/dom/v1/inputs/T03-initial.json");
    const INITIAL: &[u8] =
        include_bytes!("../../../../contracts/dom/v1/expected/T03-initial.canonical.json");
    const SPLIT: &[u8] =
        include_bytes!("../../../../contracts/dom/v1/expected/T03-split.canonical.json");
    let mut s = open(INPUT, AccessMode::Editable);
    let p = at(&s, &[0]);
    let t = at(&s, &[0, 0]);
    select(&mut s, collapsed(point(t, 1)));
    execute(&mut s, KwdjIntent::Enter, CommandEffect::Changed);
    assert_eq!(snapshot(&s), SPLIT);
    let e = at(&s, &[1]);
    let tr = at(&s, &[1, 0]);
    let before = collapsed(point(tr, 0));
    assert_eq!(s.selection(s.key()).unwrap(), Some(before));
    let event = backward(&mut s);
    assert_eq!(snapshot(&s), INITIAL);
    assert_eq!(at(&s, &[0]), p);
    assert_eq!(at(&s, &[0, 0]), t);
    assert!(s.node(s.key(), e).is_err());
    assert!(s.node(s.key(), tr).is_err());
    assert_eq!(s.selection(s.key()).unwrap(), Some(collapsed(point(t, 1))));
    assert_eq!(event.map.map(point(tr, 0)).position(), Some(point(t, 1)));
    assert_eq!(event.selection_before, Some(before));
    replay(&mut s, HistoryDirection::Undo);
    assert_eq!(snapshot(&s), SPLIT);
    assert_eq!(at(&s, &[1]), e);
    assert_eq!(at(&s, &[1, 0]), tr);
    assert_eq!(s.selection(s.key()).unwrap(), Some(before));
    replay(&mut s, HistoryDirection::Redo);
    assert_eq!(snapshot(&s), INITIAL);
    assert_eq!(s.selection(s.key()).unwrap(), Some(collapsed(point(t, 1))));
}
fn unicode() {
    let mut s = open(
        include_bytes!("../../../../contracts/dom/v1/inputs/T05-backward-EGC.json"),
        AccessMode::Editable,
    );
    let left = at(&s, &[0, 0]);
    let accent = at(&s, &[0, 1]);
    select(&mut s, collapsed(point(accent, 1)));
    backward(&mut s);
    assert_eq!(
        snapshot(&s),
        include_bytes!(
            "../../../../contracts/dom/v1/expected/T05-backward-EGC-after.canonical.json"
        )
    );
    assert_eq!(
        s.selection(s.key()).unwrap(),
        Some(collapsed(point(left, 1)))
    );
    for (left, right, right_length) in [("X👩", "\u{200d}👩", 3), ("X🇺", "🇸", 2)] {
        let mut s = open(
            &wire(json!([paragraph(json!([
                text(left, false),
                text(right, true)
            ]))])),
            AccessMode::Editable,
        );
        let first = at(&s, &[0, 0]);
        let last = at(&s, &[0, 1]);
        select(&mut s, collapsed(point(last, right_length)));
        backward(&mut s);
        assert_document(&s, json!([paragraph(json!([text("X", false)]))]));
        assert_eq!(
            s.selection(s.key()).unwrap(),
            Some(collapsed(point(first, 1)))
        );
    }
    let mut s = open(
        &wire(json!([paragraph(json!([text("😀Z", false)]))])),
        AccessMode::Editable,
    );
    let old = at(&s, &[0, 0]);
    select(&mut s, collapsed(point(old, 2)));
    backward(&mut s);
    let suffix = at(&s, &[0, 0]);
    assert_ne!(suffix, old);
    assert!(s.node(s.key(), old).is_err());
    assert_document(&s, json!([paragraph(json!([text("Z", false)]))]));
    assert_eq!(
        s.selection(s.key()).unwrap(),
        Some(collapsed(point(suffix, 0)))
    );
    replay(&mut s, HistoryDirection::Undo);
    assert_eq!(at(&s, &[0, 0]), old);
    assert_eq!(
        s.selection(s.key()).unwrap(),
        Some(collapsed(point(old, 2)))
    );
    let mut s = open(
        &wire(json!([paragraph(json!([text("e\u{301}", false)]))])),
        AccessMode::Editable,
    );
    let p = at(&s, &[0]);
    let t = at(&s, &[0, 0]);
    select(&mut s, collapsed(point(t, 1)));
    refuse(&mut s, "position.invalid");
    select(&mut s, collapsed(point(t, 2)));
    backward(&mut s);
    assert_document(&s, json!([paragraph(json!([]))]));
    assert_eq!(s.selection(s.key()).unwrap(), Some(collapsed(child(p, 0))));
    let mut s = open(
        &wire(json!([paragraph(json!([text("A \u{a0}", false)]))])),
        AccessMode::Editable,
    );
    let t = at(&s, &[0, 0]);
    select(&mut s, collapsed(point(t, 3)));
    backward(&mut s);
    assert_document(&s, json!([paragraph(json!([text("A ", false)]))]));
    assert_eq!(s.selection(s.key()).unwrap(), Some(collapsed(point(t, 2))));
}
fn join_variants() {
    for (left, right, expected_caret_child) in [
        (json!([]), json!([]), true),
        (json!([]), json!([text("b", true)]), true),
        (json!([text("a", false)]), json!([text("b", true)]), false),
    ] {
        let mut s = open(
            &wire(json!([paragraph(left.clone()), paragraph(right.clone())])),
            AccessMode::Editable,
        );
        let left_block = at(&s, &[0]);
        let right_block = at(&s, &[1]);
        let first_text = if left.as_array().unwrap().is_empty() {
            None
        } else {
            Some(at(&s, &[0, 0]))
        };
        let right_text = if right.as_array().unwrap().is_empty() {
            None
        } else {
            Some(at(&s, &[1, 0]))
        };
        select(&mut s, collapsed(child(right_block, 0)));
        backward(&mut s);
        let mut expected = left.as_array().unwrap().clone();
        expected.extend(right.as_array().unwrap().clone());
        assert_document(&s, json!([paragraph(json!(expected))]));
        assert_eq!(at(&s, &[0]), left_block);
        let expected = if expected_caret_child {
            child(left_block, 0)
        } else {
            point(first_text.unwrap(), 1)
        };
        assert_eq!(s.selection(s.key()).unwrap(), Some(collapsed(expected)));
        if let Some(id) = right_text {
            assert_eq!(at(&s, &[0, usize::from(first_text.is_some())]), id);
        }
    }
    let heading = |text_value| json!({"type":"heading","attrs":{"level":2,"align":"right"},"content":[text(text_value,false)]});
    let mut s = open(
        &wire(json!([heading("a"), heading("b")])),
        AccessMode::Editable,
    );
    let t = at(&s, &[0, 0]);
    let right = at(&s, &[1, 0]);
    select(&mut s, collapsed(point(right, 0)));
    backward(&mut s);
    assert_document(&s, json!([heading("ab")]));
    assert_eq!(s.selection(s.key()).unwrap(), Some(collapsed(point(t, 1))));
    let mut s = open(
        &wire(
            json!([{"type":"blockquote","content":[paragraph(json!([text("a",false)])),paragraph(json!([text("b",false)]))]}]),
        ),
        AccessMode::Editable,
    );
    let t = at(&s, &[0, 0, 0]);
    let right = at(&s, &[0, 1, 0]);
    select(&mut s, collapsed(point(right, 0)));
    backward(&mut s);
    assert_document(
        &s,
        json!([{"type":"blockquote","content":[paragraph(json!([text("ab",false)]))]}]),
    );
    assert_eq!(s.selection(s.key()).unwrap(), Some(collapsed(point(t, 1))));
    let mut s = open(
        &wire(json!([paragraph(json!([
            text("a", false),
            text("b", true)
        ]))])),
        AccessMode::Editable,
    );
    let p = at(&s, &[0]);
    let a = at(&s, &[0, 0]);
    let b = at(&s, &[0, 1]);
    select(
        &mut s,
        Selection {
            anchor: point(a, 1),
            focus: child(p, 1),
        },
    );
    backward(&mut s);
    assert_document(&s, json!([paragraph(json!([text("b", true)]))]));
    assert_eq!(at(&s, &[0, 0]), b);
    assert_eq!(s.selection(s.key()).unwrap(), Some(collapsed(point(b, 0))));
}

fn guards_and_marks() {
    let input = wire(json!([paragraph(json!([text("abcd", false)]))]));
    let mut s = open(&input, AccessMode::Editable);
    refuse(&mut s, "kwdj.command_selection_required");
    let t = at(&s, &[0, 0]);
    let reversed = Selection {
        anchor: point(t, 3),
        focus: point(t, 1),
    };
    select(&mut s, reversed);
    let event = backward(&mut s);
    assert_document(&s, json!([paragraph(json!([text("ad", false)]))]));
    assert_eq!(event.selection_before, Some(reversed));
    replay(&mut s, HistoryDirection::Undo);
    assert_eq!(s.selection(s.key()).unwrap(), Some(reversed));
    for marks in [
        Some(vec![]),
        Some(vec![Mark {
            type_id: "org.klenwriter.kwdj/strong".into(),
            attributes: Attributes::new(),
        }]),
    ] {
        let mut s = open(&input, AccessMode::Editable);
        let t = at(&s, &[0, 0]);
        select(&mut s, collapsed(point(t, 4)));
        assert!(matches!(
            s.set_typing_marks(
                s.key(),
                s.revision(),
                s.selection_epoch(),
                s.history_summary().epoch,
                marks.clone()
            ),
            DispatchOutcome::Unchanged { .. }
        ));
        let event = backward(&mut s);
        assert_eq!(event.stored_marks_before, marks);
        assert_eq!(event.stored_marks_after, marks);
        assert_eq!(s.stored_marks(s.key()).unwrap(), marks.as_deref());
    }
    let mut s = open(&input, AccessMode::ReadOnly);
    let t = at(&s, &[0, 0]);
    select(&mut s, collapsed(point(t, 2)));
    refuse(&mut s, "session.read_only");
    let mut s = open(&input, AccessMode::Editable);
    let t = at(&s, &[0, 0]);
    select(&mut s, collapsed(point(t, 2)));
    let mut request = CommandRequest::new(
        s.key(),
        s.revision(),
        s.selection_epoch(),
        KwdjIntent::DeleteBackward,
    );
    request.selection_epoch += 1;
    refuse_request(&mut s, &request, "session.stale_selection_epoch");
    request.selection_epoch = s.selection_epoch();
    request.limits.work = WorkLimits { units: 0, bytes: 0 };
    refuse_request(&mut s, &request, "resource_limit_exceeded");
    request.limits = Default::default();
    request.limits.journal_bytes = 0;
    refuse_request(&mut s, &request, "transaction.journal_limit");
    let mut s = open(&input, AccessMode::Editable);
    let t = at(&s, &[0, 0]);
    select(&mut s, collapsed(point(t, 0)));
    execute(&mut s, KwdjIntent::DeleteBackward, CommandEffect::Unchanged);
    for (content, path, code) in [
        (
            json!([paragraph(json!([text("a",false)])),{"type":"heading","attrs":{"level":2},"content":[text("b",false)]}]),
            vec![1, 0],
            "kwdj.command_lossy_transform",
        ),
        (
            json!([paragraph(json!([text("a",false)])),{"type":"paragraph","attrs":{"align":"right"},"content":[text("b",false)]}]),
            vec![1, 0],
            "kwdj.command_lossy_transform",
        ),
        (
            json!([{"type":"scene_break"},paragraph(json!([text("b",false)]))]),
            vec![1, 0],
            "kwdj.command_unsupported_context",
        ),
        (
            json!([paragraph(
                json!([text("a",false),{"type":"hard_break"},text("b",false)])
            )]),
            vec![0, 2],
            "kwdj.command_unsupported_context",
        ),
        (
            json!([{"type":"blockquote","content":[paragraph(json!([text("a",false)]))]}]),
            vec![0, 0, 0],
            "kwdj.command_unsupported_context",
        ),
        (
            json!([{"type":"bullet_list","content":[{"type":"list_item","content":[paragraph(json!([text("a",false)])),paragraph(json!([text("b",false)]))]}]}]),
            vec![0, 0, 1, 0],
            "kwdj.command_unsupported_context",
        ),
        (
            json!([{"type":"code_block","content":[text("a\nb",false)]}]),
            vec![0, 0],
            "kwdj.command_unsupported_context",
        ),
    ] {
        let mut s = open(&wire(content), AccessMode::Editable);
        let t = at(&s, &path);
        select(&mut s, collapsed(point(t, 0)));
        refuse(&mut s, code);
    }
    let mut s = open(
        &wire(json!([{"type":"code_block","content":[text("a\nb",false)]}])),
        AccessMode::Editable,
    );
    let t = at(&s, &[0, 0]);
    select(&mut s, collapsed(point(t, 2)));
    backward(&mut s);
    assert_document(
        &s,
        json!([{"type":"code_block","content":[text("ab",false)]}]),
    );
    assert_eq!(s.selection(s.key()).unwrap(), Some(collapsed(point(t, 1))));
}

pub fn observe() -> Value {
    t02();
    t03();
    unicode();
    guards_and_marks();
    join_variants();
    json!({"status":"passed","authority":"contracts/dom/v1","frozen_t02_t03":true,
        "exact_caret_ids_history_maps":true,"cross_style_egc_zwj_ri":true,
        "prefix_suffix_identity":true,"native_query_execute_work_parity":true,
        "atomic_stale_readonly_work_journal_refusals":true,"stored_marks_keep":true})
}
