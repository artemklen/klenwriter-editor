// SPDX-License-Identifier: MIT OR Apache-2.0
//! Actual Session mixed transactions: optimized KWDJ versus the unchanged full
//! profile hooks. The control deliberately has no incremental proof cache.

use editor_core::candidate::CandidateRead;
use editor_core::document::{Attribute, Attributes, Document, Mark, Node, Primitive};
use editor_core::history::HistoryProfile;
use editor_core::positions::{Affinity, Position, Selection, Utf16Offset};
use editor_core::profile::{AdmissionMode, FrozenProfile, ProfileBinding};
use editor_core::transaction::{
    MarkEdit, Operation, TransactionProfile, ValidationStats, WorkMeter, WorkPhase,
};
use editor_engine::{
    AccessMode, DispatchOutcome, HistoryDirection, HistoryOutcome, HistoryRequest, NodeId, NodeRef,
    Session, Transaction,
};
use editor_kwdj::{
    AdmissionBudget, IdentityResolver, IdentityResolverError, IdentityStatus, KwdjProfile,
    KwdjProfileError, Limits,
};
use serde_json::json;
use uuid::Uuid;

struct Facts;
impl IdentityResolver for Facts {
    fn resolve_media(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(IdentityStatus::Exists)
    }
    fn resolve_reference(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(IdentityStatus::Exists)
    }
}
static FACTS: Facts = Facts;
struct Full(KwdjProfile<'static>);
impl FrozenProfile for Full {
    type Context = <KwdjProfile<'static> as FrozenProfile>::Context;
    type Admitted = <KwdjProfile<'static> as FrozenProfile>::Admitted;
    type Error = KwdjProfileError;
    type Cache<I: Copy + Eq + Ord> = ();
    fn binding(&self) -> &ProfileBinding {
        self.0.binding()
    }
    fn admit_bytes(
        &self,
        b: &ProfileBinding,
        bytes: &[u8],
        mode: AdmissionMode,
    ) -> Result<Self::Admitted, Self::Error> {
        self.0.admit_bytes(b, bytes, mode)
    }
    fn context(&self, admitted: &Self::Admitted) -> Self::Context {
        self.0.context(admitted)
    }
    fn to_document(&self, admitted: &Self::Admitted) -> Document {
        self.0.to_document(admitted)
    }
    fn admit_snapshot(
        &self,
        context: &Self::Context,
        document: &Document,
    ) -> Result<Self::Admitted, Self::Error> {
        self.0.admit_snapshot(context, document)
    }
    fn canonical<'a>(&self, admitted: &'a Self::Admitted) -> &'a [u8] {
        self.0.canonical(admitted)
    }
}
impl TransactionProfile for Full {
    fn normalize_candidate<V: CandidateRead>(
        &self,
        c: &Self::Context,
        v: &V,
        w: &mut WorkMeter,
    ) -> Result<Vec<Operation<V::Id>>, Self::Error> {
        self.0.normalize_candidate(c, v, w)
    }
    fn validate_candidate<V: CandidateRead>(
        &self,
        c: &Self::Context,
        v: &V,
        w: &mut WorkMeter,
    ) -> Result<ValidationStats, Self::Error> {
        self.0.validate_candidate(c, v, w)
    }
}
impl HistoryProfile for Full {
    fn finalize_history_typing<V: CandidateRead>(
        &self,
        c: &Self::Context,
        v: &V,
        selection: Option<Selection<V::Id>>,
        marks: Option<&[Mark]>,
        w: &mut WorkMeter,
    ) -> Result<Option<Vec<Mark>>, Self::Error> {
        self.0.finalize_history_typing(c, v, selection, marks, w)
    }
    fn history_error_code(error: &Self::Error) -> &'static str {
        <KwdjProfile<'static> as HistoryProfile>::history_error_code(error)
    }
}
fn profile() -> KwdjProfile<'static> {
    KwdjProfile::new(&FACTS, Limits::default(), AdmissionBudget::default())
}
fn p(text: &str) -> serde_json::Value {
    json!({"type":"paragraph","content":[{"type":"text","text":text}]})
}
fn initial(poetry: bool) -> Vec<u8> {
    let mut content = vec![
        p("ab"),
        json!({"type":"blockquote","content":[p("cd"),p("ef")]}),
        p("gh"),
    ];
    if poetry {
        content.push(json!({"type":"verse","content":[{"type":"verse_line","content":[{"type":"text","text":"Яé😀"}]},{"type":"stanza_break","attrs":{"blank_lines":2}},{"type":"verse_line","content":[]}]}));
    }
    serde_json::to_vec(&json!({"schema":"klenwriter.document","schema_version":1,"profile":if poetry {"poetry"} else {"prose"},"content":content})).unwrap()
}
fn open<P: FrozenProfile<Error = KwdjProfileError>>(profile: P, input: &[u8]) -> Session<P> {
    let binding = profile.binding().clone();
    Session::open(
        profile,
        &binding,
        input,
        AdmissionMode::Strict,
        AccessMode::Editable,
    )
    .unwrap()
}
fn path<P: FrozenProfile<Error = KwdjProfileError>>(s: &Session<P>, path: &[usize]) -> NodeId {
    let mut id = s.root(s.key()).unwrap();
    for index in path {
        id = s.node(s.key(), id).unwrap().children()[*index];
    }
    id
}
fn canon<P: FrozenProfile<Error = KwdjProfileError>>(s: &Session<P>) -> Vec<u8> {
    s.export_snapshot(s.key(), s.revision()).unwrap()
}
fn mark(name: &str) -> Mark {
    Mark {
        type_id: format!("org.klenwriter.kwdj/{name}"),
        attributes: Attributes::new(),
    }
}
fn inline_text(value: &str) -> Node {
    Node {
        type_id: "org.klenwriter.kwdj/text".into(),
        primitive: Primitive::Text,
        attributes: Attributes::new(),
        marks: vec![],
        text: Some(value.into()),
        children: vec![],
    }
}
fn fragment(value: &str) -> Document {
    Document {
        children: vec![Node {
            type_id: "org.klenwriter.kwdj/paragraph".into(),
            primitive: Primitive::TextBlock,
            attributes: Attributes::new(),
            marks: vec![],
            text: None,
            children: vec![inline_text(value)],
        }],
    }
}
fn range<P: FrozenProfile<Error = KwdjProfileError>>(
    s: &Session<P>,
    parent: NodeId,
) -> Selection<NodeRef> {
    let children = s.node(s.key(), parent).unwrap().children();
    Selection {
        anchor: Position::Child {
            parent: parent.into(),
            index: 0,
            affinity: Affinity::Before,
        },
        focus: Position::Child {
            parent: parent.into(),
            index: children.len(),
            affinity: Affinity::After,
        },
    }
}
fn operations<P: FrozenProfile<Error = KwdjProfileError>>(
    s: &Session<P>,
    step: usize,
    seed: usize,
) -> Vec<Operation<NodeRef>> {
    let root = s.root(s.key()).unwrap();
    let first = path(s, &[0]);
    let leaf = || path(s, &[0, 0]);
    match step {
        0 => {
            let current = s.node(s.key(), leaf()).unwrap().text().unwrap();
            vec![Operation::ReplaceText {
                leaf: leaf().into(),
                from: Utf16Offset::new(0),
                to: Utf16Offset::new(current.encode_utf16().count()),
                inserted: format!("{}ab\"\\", ["Я", "é", "😀", "\t"][seed % 4]),
            }]
        }
        1 => vec![Operation::SetMarks {
            leaf: leaf().into(),
            marks: vec![mark("strong")],
        }],
        2 => vec![Operation::SetAttribute {
            node: first.into(),
            key: "align".into(),
            value: Some(Attribute::String("RIGHT".into())),
        }],
        3 => {
            // All generated fixtures have a known four-scalar ASCII suffix;
            // split after the whole independent prefix EGC, including e+acute.
            let prefix_units = s
                .node(s.key(), leaf())
                .unwrap()
                .text()
                .unwrap()
                .encode_utf16()
                .count()
                - 4;
            vec![
                Operation::SplitText {
                    leaf: leaf().into(),
                    at: Utf16Offset::new(prefix_units),
                },
                Operation::JoinText {
                    left: leaf().into(),
                    right: NodeRef::Created {
                        operation: 0,
                        path: vec![0],
                    },
                },
            ]
        }
        4 => vec![Operation::InsertFragment {
            parent: root.into(),
            index: 1,
            fragment: fragment(&format!("insert-{seed}")),
        }],
        5 => vec![Operation::Duplicate {
            node: first.into(),
            parent: path(s, &[2]).into(),
            index: 1,
        }],
        6 => vec![Operation::Move {
            node: path(s, &[2, 0]).into(),
            parent: root.into(),
            before_index: 2,
        }],
        7 => vec![Operation::Remove {
            node: path(s, &[1]).into(),
        }],
        8 => vec![
            Operation::SetAttribute {
                node: first.into(),
                key: "level".into(),
                value: Some(Attribute::Number((1 + seed % 6).into())),
            },
            Operation::Transform {
                node: first.into(),
                type_id: "org.klenwriter.kwdj/heading".into(),
                primitive: Primitive::TextBlock,
            },
        ],
        9 => vec![
            Operation::SetAttribute {
                node: first.into(),
                key: "level".into(),
                value: None,
            },
            Operation::Transform {
                node: first.into(),
                type_id: "org.klenwriter.kwdj/paragraph".into(),
                primitive: Primitive::TextBlock,
            },
        ],
        10 => vec![Operation::PatchMarkRange {
            range: range(s, first),
            edits: vec![
                MarkEdit::Remove {
                    type_id: "org.klenwriter.kwdj/strong".into(),
                },
                MarkEdit::Upsert(mark("emphasis")),
            ],
        }],
        11 => vec![Operation::ReplaceInlineRange {
            range: range(s, first),
            inserted: Some(Node {
                type_id: "org.klenwriter.kwdj/hard_break".into(),
                primitive: Primitive::HardBreak,
                attributes: Attributes::new(),
                marks: vec![],
                text: None,
                children: vec![],
            }),
        }],
        12 => vec![Operation::ReplaceInlineRange {
            range: range(s, first),
            inserted: Some(inline_text("RestoredЯ")),
        }],
        13 => vec![Operation::MoveInlineGroup {
            nodes: vec![leaf().into()],
            parent: path(s, &[1]).into(),
            before_index: 1,
        }],
        _ => unreachable!(),
    }
}
fn result<P: TransactionProfile<Error = KwdjProfileError>>(
    s: &mut Session<P>,
    ops: Vec<Operation<NodeRef>>,
    expect_full: bool,
) -> bool {
    let transaction = Transaction::new(s.key(), s.revision(), ops);
    match s.dispatch(transaction) {
        DispatchOutcome::Changed(event) => {
            assert_eq!(event.notification.after(), s.stamp());
            if expect_full {
                assert!(event.trace.phase(WorkPhase::FullFallback).visits >= 2);
            } else {
                assert_eq!(
                    event.trace.phase(WorkPhase::FullFallback).visits,
                    0,
                    "a valid admitted KWDJ mixed change must keep scoped proof"
                );
            }
            true
        }
        DispatchOutcome::Unchanged { .. } => false,
        other => panic!("unexpected refusal: {other:?}"),
    }
}
fn paired_check<
    P: FrozenProfile<Error = KwdjProfileError>,
    Q: FrozenProfile<Error = KwdjProfileError>,
>(
    a: &Session<P>,
    b: &Session<Q>,
) {
    assert_eq!(canon(a), canon(b));
    assert_eq!(a.revision(), b.revision());
    assert_eq!(a.selection_epoch(), b.selection_epoch());
    assert_eq!(a.dirty(), b.dirty());
    assert_eq!(a.history_summary(), b.history_summary());
    assert_eq!(a.journal_summary(), b.journal_summary());
    assert_eq!(
        a.event_status(a.key()).unwrap().head.sequence(),
        b.event_status(b.key()).unwrap().head.sequence()
    );
    assert_eq!(
        a.node_at(a.key(), a.revision(), a.root(a.key()).unwrap())
            .unwrap()
            .stats,
        b.node_at(b.key(), b.revision(), b.root(b.key()).unwrap())
            .unwrap()
            .stats
    );
}
fn replay<P: HistoryProfile<Error = KwdjProfileError>>(
    s: &mut Session<P>,
    direction: HistoryDirection,
) {
    let request = HistoryRequest::new(
        s.key(),
        s.revision(),
        s.selection_epoch(),
        s.history_summary().epoch,
        direction,
    );
    assert!(matches!(
        s.query_history(&request),
        editor_engine::HistoryAvailability::Available { .. }
    ));
    assert!(matches!(
        s.execute_history(&request),
        HistoryOutcome::Completed(_)
    ));
}

#[test]
fn optimized_and_full_sessions_match_mixed_sequences_and_every_replay_checkpoint_in_both_profiles()
{
    let mut checkpoints = 0;
    for poetry in [false, true] {
        for seed in 0..16 {
            let input = initial(poetry);
            let mut optimized = open(profile(), &input);
            let mut control = open(Full(profile()), &input);
            let initial_canonical = canon(&optimized);
            let mut units = 0;
            paired_check(&optimized, &control);
            checkpoints += 1;
            for step in 0..14 {
                let left = operations(&optimized, step, seed);
                let right = operations(&control, step, seed);
                let changed = result(&mut optimized, left, false);
                assert_eq!(changed, result(&mut control, right, true));
                if changed {
                    units += 1;
                }
                paired_check(&optimized, &control);
                checkpoints += 1;
            }
            let final_canonical = canon(&optimized);
            assert_eq!(optimized.history_summary().undo_units, units);
            for _ in 0..units {
                replay(&mut optimized, HistoryDirection::Undo);
                replay(&mut control, HistoryDirection::Undo);
                paired_check(&optimized, &control);
                checkpoints += 1;
            }
            assert_eq!(canon(&optimized), initial_canonical);
            for _ in 0..units {
                replay(&mut optimized, HistoryDirection::Redo);
                replay(&mut control, HistoryDirection::Redo);
                paired_check(&optimized, &control);
                checkpoints += 1;
            }
            assert_eq!(canon(&optimized), final_canonical);
        }
    }
    assert_eq!(
        checkpoints, 1312,
        "32 seeds x (initial+14 mixed+13 undo+13 redo)"
    );
}

#[test]
fn the_control_really_uses_full_hooks_while_an_ordinary_kwdj_edit_reuses_proof() {
    let input = initial(false);
    let mut optimized = open(profile(), &input);
    let mut control = open(Full(profile()), &input);
    let left = operations(&optimized, 0, 0);
    let right = operations(&control, 0, 0);
    let DispatchOutcome::Changed(a) =
        optimized.dispatch(Transaction::new(optimized.key(), 0, left))
    else {
        panic!("optimized")
    };
    let DispatchOutcome::Changed(b) = control.dispatch(Transaction::new(control.key(), 0, right))
    else {
        panic!("control")
    };
    assert_eq!(a.trace.phase(WorkPhase::FullFallback).visits, 0);
    assert!(b.trace.phase(WorkPhase::FullFallback).visits >= 2);
    assert_eq!(canon(&optimized), canon(&control));
}
