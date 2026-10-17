// SPDX-License-Identifier: MIT OR Apache-2.0
//! Trusted bounded fixtures exercise actual Session<KwdjProfile>::dispatch.
//! Not a distributable transaction ABI, alternate engine, or Undo implementation.
use editor_core::document::{Attribute, Attributes, Document, Mark, Node, Primitive};
use editor_core::positions::{Affinity, Position, Selection, Utf16Offset};
use editor_core::profile::{AdmissionMode, FrozenProfile};
use editor_core::transaction::Operation;
use editor_engine::mapping::MapResult;
use editor_engine::{
    AccessMode, CommitEvent, DispatchOutcome, NodeId, NodeRef, SelectionUpdate, Session,
    Transaction, TransactionError,
};
use editor_kwdj::{
    AdmissionBudget, IdentityResolver, IdentityResolverError, IdentityStatus, KwdjProfile,
    KwdjProfileError, Limits,
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
const PREFIX: &str = "org.klenwriter.kwdj/";
fn wire(content: Value) -> Value {
    json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":content})
}
fn paragraph(text: &str) -> Value {
    json!({"type":"paragraph","content":[{"type":"text","text":text}]})
}
fn open(value: &Value) -> Session<KwdjProfile<'static>> {
    let p = KwdjProfile::new(&IDENTITIES, Limits::default(), AdmissionBudget::default());
    let b = p.binding().clone();
    Session::open(
        p,
        &b,
        &serde_json::to_vec(value).unwrap(),
        AdmissionMode::Strict,
        AccessMode::Editable,
    )
    .unwrap()
}
fn doc(s: &Session<KwdjProfile<'_>>) -> Value {
    serde_json::from_slice(&s.export_snapshot(s.key(), s.revision()).unwrap()).unwrap()
}
fn root(s: &Session<KwdjProfile<'_>>) -> NodeId {
    s.root(s.key()).unwrap()
}
fn children(s: &Session<KwdjProfile<'_>>, node: NodeId) -> Vec<NodeId> {
    s.node(s.key(), node).unwrap().children().to_vec()
}
fn leaf(s: &Session<KwdjProfile<'_>>) -> NodeId {
    children(s, children(s, root(s))[0])[0]
}
fn point(leaf: NodeId, at: usize, affinity: Affinity) -> Position<NodeId> {
    Position::Text {
        leaf,
        utf16: Utf16Offset::new(at),
        affinity,
    }
}
fn tx(s: &Session<KwdjProfile<'_>>, operations: Vec<Operation<NodeRef>>) -> Transaction {
    Transaction::new(s.key(), s.revision(), operations)
}
fn replace(id: NodeRef, from: usize, to: usize, inserted: &str) -> Operation<NodeRef> {
    Operation::ReplaceText {
        leaf: id,
        from: Utf16Offset::new(from),
        to: Utf16Offset::new(to),
        inserted: inserted.into(),
    }
}
fn changed(result: DispatchOutcome<KwdjProfileError>) -> CommitEvent {
    let DispatchOutcome::Changed(event) = result else {
        panic!("expected real commit: {result:?}")
    };
    assert!(event.dirty);
    assert!(event.work.bytes > 0);
    assert!(event.work.bytes <= 64 * 1024 * 1024);
    event
}
fn generic_paragraph(text: &str) -> Node {
    Node {
        type_id: format!("{PREFIX}paragraph"),
        primitive: Primitive::TextBlock,
        attributes: Attributes::new(),
        marks: vec![],
        text: None,
        children: vec![Node {
            type_id: format!("{PREFIX}text"),
            primitive: Primitive::Text,
            attributes: Attributes::new(),
            marks: vec![],
            text: Some(text.into()),
            children: vec![],
        }],
    }
}
fn mark(name: &str, attrs: &[(&str, Attribute)]) -> Mark {
    Mark {
        type_id: format!("{PREFIX}{name}"),
        attributes: attrs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), v.clone()))
            .collect(),
    }
}

fn text_selection_journal() -> Value {
    let mut s = open(&wire(json!([paragraph("abcdef")])));
    let k = s.key();
    let id = leaf(&s);
    let before = Selection {
        anchor: point(id, 5, Affinity::Before),
        focus: point(id, 3, Affinity::After),
    };
    s.set_selection(k, 0, before).unwrap();
    let event = changed(s.dispatch(tx(&s, vec![replace(id.into(), 2, 5, "")])));
    let after = Selection {
        anchor: point(id, 2, Affinity::Before),
        focus: point(id, 2, Affinity::After),
    };
    assert_eq!(event.selection_before, Some(before));
    assert_eq!(event.selection_after, Some(after));
    assert_eq!(
        event.map.map(before.anchor),
        MapResult::Mapped(after.anchor)
    );
    assert_eq!(event.map.map(before.focus), MapResult::Deleted(after.focus));
    assert_eq!(doc(&s), wire(json!([paragraph("abf")])));
    assert_eq!((s.revision(), s.selection_epoch()), (1, 2));
    let entries = s.journal_entries();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].selection_before, Some(before));
    assert_eq!(entries[0].selection_after, Some(after));
    let event = changed(s.dispatch(tx(&s, vec![replace(id.into(), 1, 1, "Ж")])));
    assert_eq!(event.revision, 2);
    assert_eq!(
        s.map_position(k, 0, before.anchor).unwrap(),
        MapResult::Mapped(point(id, 3, Affinity::Before))
    );
    assert_eq!(
        s.map_position(k, 0, before.focus).unwrap(),
        MapResult::Deleted(point(id, 3, Affinity::After))
    );
    let mut next = tx(&s, vec![replace(id.into(), 4, 4, "!")]);
    next.limits.journal_entries = 1;
    changed(s.dispatch(next));
    assert_eq!(s.journal_summary().entries, 1);
    assert_eq!(s.journal_summary().evicted, 2);
    assert_eq!(s.journal_summary().oldest_revision, 2);
    assert_eq!(
        s.map_position(k, 0, before.anchor).unwrap(),
        MapResult::Stale
    );
    assert_eq!(doc(&s), wire(json!([paragraph("aЖbf!")])));
    json!({"status":"passed","canonical":doc(&s),"revision":3,"endpoint_deleted":false,
        "interior_deleted":true,"retained_entries":1,"evicted":2,"old_bookmark":"stale"})
}

fn attributes_marks_spans() -> Value {
    let value = wire(
        json!([paragraph("hello"),{"type":"table","content":[{"type":"table_row","content":[
            {"type":"table_cell","content":[paragraph("A")]},{"type":"table_cell","content":[paragraph("B")]}
        ]}]}]),
    );
    let mut s = open(&value);
    let roots = children(&s, root(&s));
    let id = leaf(&s);
    let row = children(&s, roots[1])[0];
    let cell = children(&s, row)[0];
    let ops = vec![
        Operation::SetAttribute {
            node: roots[0].into(),
            key: "level".into(),
            value: Some(Attribute::Number(2.into())),
        },
        Operation::Transform {
            node: roots[0].into(),
            type_id: format!("{PREFIX}heading"),
            primitive: Primitive::TextBlock,
        },
        Operation::SetMarks {
            leaf: id.into(),
            marks: vec![
                mark(
                    "link",
                    &[(
                        "href",
                        Attribute::String("https://example.test/path".into()),
                    )],
                ),
                mark("strong", &[]),
            ],
        },
        Operation::SetAttribute {
            node: cell.into(),
            key: "colspan".into(),
            value: Some(Attribute::Number(2.into())),
        },
    ];
    let event = changed(s.dispatch(tx(&s, ops)));
    assert!(
        event.normalization_operations > 0,
        "unsorted marks require explicit normalization"
    );
    let expected = wire(json!([
        {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"hello","marks":[{"type":"strong"},{"type":"link","attrs":{"href":"https://example.test/path"}}]}]},
        {"type":"table","content":[{"type":"table_row","content":[
            {"type":"table_cell","attrs":{"colspan":2},"content":[paragraph("A")]},
            {"type":"table_cell","content":[paragraph("B")]}
        ]}]}
    ]));
    assert_eq!(doc(&s), expected);
    assert_eq!(
        event.map.map(point(id, 4, Affinity::After)),
        MapResult::Mapped(point(id, 4, Affinity::After))
    );
    json!({"status":"passed","canonical":doc(&s),"revision":s.revision(),"normalization_explicit":true})
}

fn fragment_local_references() -> Value {
    let mut s = open(&wire(json!([paragraph("A"), paragraph("B")])));
    let r = root(&s);
    let roots = children(&s, r);
    let old_b = children(&s, roots[1])[0];
    let local = NodeRef::Created {
        operation: 0,
        path: vec![0, 0],
    };
    let mut transaction = tx(
        &s,
        vec![
            Operation::InsertFragment {
                parent: r.into(),
                index: 1,
                fragment: Document {
                    children: vec![
                        generic_paragraph("X"),
                        generic_paragraph("Y"),
                        Node {
                            type_id: format!("{PREFIX}scene_break"),
                            primitive: Primitive::BlockAtom,
                            attributes: Attributes::new(),
                            marks: vec![],
                            text: None,
                            children: vec![],
                        },
                    ],
                },
            },
            replace(local.clone(), 0, 1, "Z"),
            Operation::Duplicate {
                node: roots[0].into(),
                parent: r.into(),
                index: 5,
            },
            Operation::Move {
                node: NodeRef::Created {
                    operation: 2,
                    path: vec![0],
                },
                parent: r.into(),
                before_index: 0,
            },
            Operation::Remove {
                node: roots[1].into(),
            },
        ],
    );
    transaction.selection = SelectionUpdate::Set(Some(Selection {
        anchor: Position::Text {
            leaf: local.clone(),
            utf16: Utf16Offset::new(1),
            affinity: Affinity::After,
        },
        focus: Position::Text {
            leaf: local,
            utf16: Utf16Offset::new(1),
            affinity: Affinity::After,
        },
    }));
    let event = changed(s.dispatch(transaction));
    let actual_roots = children(&s, r);
    assert_ne!(actual_roots[0], roots[0]);
    assert_eq!(actual_roots[1], roots[0]);
    assert_ne!(children(&s, actual_roots[0])[0], children(&s, roots[0])[0]);
    assert_eq!(
        doc(&s),
        wire(
            json!([paragraph("A"),paragraph("A"),paragraph("Z"),paragraph("Y"),{"type":"scene_break"}])
        )
    );
    assert_eq!(
        s.node(s.key(), actual_roots[4]).unwrap().primitive(),
        Some(Primitive::BlockAtom)
    );
    assert_eq!(
        event.map.map(point(old_b, 0, Affinity::After)),
        MapResult::Deleted(Position::Child {
            parent: r,
            index: 5,
            affinity: Affinity::After
        })
    );
    let selected = children(&s, actual_roots[2])[0];
    assert_eq!(
        s.selection(s.key()).unwrap().unwrap().anchor,
        point(selected, 1, Affinity::After)
    );
    json!({"status":"passed","canonical":doc(&s),"local_reference_text":"Z","duplicate_has_fresh_ids":true,
        "removed_descendant_fallback":5,"scene_atom":true,"revision":s.revision()})
}

fn normalization_and_noops() -> Value {
    let mut s = open(&wire(json!([paragraph("ab")])));
    let id = leaf(&s);
    let original = Selection {
        anchor: point(id, 2, Affinity::After),
        focus: point(id, 1, Affinity::Before),
    };
    s.set_selection(s.key(), 0, original).unwrap();
    let event = changed(s.dispatch(tx(&s, vec![replace(id.into(), 1, 1, "\r\n")])));
    assert!(event.normalization_operations > 0);
    assert!(event.map.steps().len() >= 2);
    assert_eq!(
        event.map.map(point(id, 1, Affinity::After)),
        MapResult::Mapped(point(id, 2, Affinity::After))
    );
    assert_eq!(
        event.map.map(original.anchor),
        MapResult::Mapped(point(id, 3, Affinity::After))
    );
    assert_eq!(doc(&s), wire(json!([paragraph("a\nb")])));
    let before = doc(&s);
    let selection = s.selection(s.key()).unwrap();
    let journal = s.journal_summary();
    let revision = s.revision();
    let result = s.dispatch(tx(
        &s,
        vec![Operation::SplitText {
            leaf: id.into(),
            at: Utf16Offset::new(1),
        }],
    ));
    let DispatchOutcome::Unchanged {
        map,
        revision: unchanged,
        ..
    } = result
    else {
        panic!("split+normalizing join must be net-noop: {result:?}")
    };
    assert_eq!(unchanged, revision);
    assert_eq!(map.before(), revision);
    assert_eq!(map.after(), revision);
    assert!(map.steps().is_empty());
    assert_eq!(doc(&s), before);
    assert_eq!(s.journal_summary(), journal);
    assert_eq!(s.selection(s.key()).unwrap(), selection);
    let mut select = tx(&s, vec![]);
    select.selection = SelectionUpdate::Set(None);
    assert!(matches!(
        s.dispatch(select),
        DispatchOutcome::Unchanged {
            selection_changed: true,
            ..
        }
    ));
    assert_eq!(s.revision(), revision);
    assert_eq!(s.journal_summary(), journal);
    json!({"status":"passed","canonical":doc(&s),"crlf_mapping_after":2,"normalization_explicit":true,
        "split_join":"net-noop","selection_only_revision":revision,"selection_only_journal_entries":journal.entries})
}

fn refusal_code(error: TransactionError<KwdjProfileError>) -> String {
    match error {
        TransactionError::Profile(KwdjProfileError::Document(e)) => e.code.as_str().into(),
        TransactionError::Tree(editor_engine::tree::TreeError::Position(
            editor_core::positions::PositionError::NotGraphemeBoundary,
        )) => "tree.invalid_grapheme_boundary".into(),
        TransactionError::Limit(e) => format!("limit.{}", e.name),
        TransactionError::JournalLimit => "transaction.journal_limit".into(),
        TransactionError::InvalidLocalReference => "transaction.invalid_local_reference".into(),
        other => panic!("unexpected refusal variant {other:?}"),
    }
}
fn assert_refused(
    s: &mut Session<KwdjProfile<'static>>,
    transaction: Transaction,
    expected: &str,
) -> Value {
    let before = doc(s);
    let revision = s.revision();
    let epoch = s.selection_epoch();
    let selected = s.selection(s.key()).unwrap();
    let journal = s.journal_summary();
    let dirty = s.dirty();
    let DispatchOutcome::Refused { error, map, .. } = s.dispatch(transaction) else {
        panic!("expected typed refusal {expected}")
    };
    let code = refusal_code(error);
    assert_eq!(code, expected);
    assert_eq!(map.before(), revision);
    assert_eq!(map.after(), revision);
    assert!(map.steps().is_empty());
    assert_eq!(doc(s), before);
    assert_eq!((s.revision(), s.selection_epoch()), (revision, epoch));
    assert_eq!(s.selection(s.key()).unwrap(), selected);
    assert_eq!(s.journal_summary(), journal);
    assert_eq!(s.dirty(), dirty);
    json!({"code":code,"canonical_and_state_preserved":true,"identity_map":true})
}
fn atomic_refusals() -> Value {
    let mut rows = Vec::new();
    let mut s = open(&wire(json!([paragraph("abc")])));
    let id = leaf(&s);
    let p = children(&s, root(&s))[0];
    let late = tx(
        &s,
        vec![
            replace(id.into(), 0, 1, "X"),
            Operation::SetAttribute {
                node: p.into(),
                key: "unexpected".into(),
                value: Some(Attribute::Boolean(true)),
            },
        ],
    );
    rows.push(assert_refused(&mut s, late, "kwdj.unknown_attribute"));
    let url = tx(
        &s,
        vec![
            replace(id.into(), 0, 1, "X"),
            Operation::SetMarks {
                leaf: id.into(),
                marks: vec![mark(
                    "link",
                    &[("href", Attribute::String("javascript:alert(1)".into()))],
                )],
            },
        ],
    );
    rows.push(assert_refused(&mut s, url, "kwdj.unsafe_url"));
    let image = Node {
        type_id: format!("{PREFIX}media_image"),
        primitive: Primitive::Container,
        attributes: Attributes::from([
            (
                "media_asset_id".into(),
                Attribute::String("22222222-2222-4222-8222-222222222222".into()),
            ),
            ("alt".into(), Attribute::String("fixture".into())),
            ("align".into(), Attribute::String("center".into())),
        ]),
        marks: vec![],
        text: None,
        children: vec![],
    };
    let missing = tx(
        &s,
        vec![
            replace(id.into(), 0, 1, "X"),
            Operation::InsertFragment {
                parent: root(&s).into(),
                index: 1,
                fragment: Document {
                    children: vec![image],
                },
            },
        ],
    );
    rows.push(assert_refused(
        &mut s,
        missing,
        "kwdj.media_identity_unresolved",
    ));
    let mut limited = tx(&s, vec![replace(id.into(), 0, 1, "X")]);
    limited.limits.work.bytes = 0;
    rows.push(assert_refused(&mut s, limited, "limit.transaction_bytes"));
    let mut nojournal = tx(&s, vec![replace(id.into(), 0, 1, "X")]);
    nojournal.limits.journal_entries = 0;
    rows.push(assert_refused(
        &mut s,
        nojournal,
        "transaction.journal_limit",
    ));
    let badlocal = tx(
        &s,
        vec![replace(
            NodeRef::Created {
                operation: 0,
                path: vec![0, 0],
            },
            0,
            1,
            "X",
        )],
    );
    rows.push(assert_refused(
        &mut s,
        badlocal,
        "transaction.invalid_local_reference",
    ));
    let mut unicode = open(&wire(json!([paragraph("e\u{301}")])));
    let unicode_id = leaf(&unicode);
    let invalid = tx(&unicode, vec![replace(unicode_id.into(), 1, 2, "")]);
    rows.push(assert_refused(
        &mut unicode,
        invalid,
        "tree.invalid_grapheme_boundary",
    ));
    // Removing empty runs must not erase authored identity/URL errors. Both
    // marks are syntactically valid operation payloads and become active before
    // the text is emptied within the same candidate batch.
    let mut empty = open(&wire(json!([paragraph("abc")])));
    let empty_leaf = leaf(&empty);
    for (case, kind, key, value, code) in [
        (
            "empty-text-missing-reference",
            "reference_link",
            "reference_entity_id",
            "33333333-3333-4333-8333-333333333333",
            "kwdj.reference_identity_unresolved",
        ),
        (
            "empty-text-active-unsafe-url",
            "link",
            "href",
            "javascript:alert(1)",
            "kwdj.unsafe_url",
        ),
    ] {
        let operation = tx(
            &empty,
            vec![
                Operation::SetMarks {
                    leaf: empty_leaf.into(),
                    marks: vec![mark(kind, &[(key, Attribute::String(value.into()))])],
                },
                replace(empty_leaf.into(), 0, 3, ""),
            ],
        );
        let mut row = assert_refused(&mut empty, operation, code);
        row["case"] = json!(case);
        rows.push(row);
    }
    // Inserting a zero-count stanza beside an admitted positive count exercises
    // the actual pre-normalization guard. Merging 0+1 or 1+0 must never hide it.
    for (case, index) in [
        ("stanza-left-zero-before-merge", 1),
        ("stanza-right-zero-before-merge", 2),
    ] {
        let mut poetry = open(
            &json!({"schema":"klenwriter.document", "schema_version":1,"profile":"poetry","content":[
                {"type":"verse","content":[
                    {"type":"verse_line","content":[{"type":"text","text":"a"}]},
                    {"type":"stanza_break","attrs":{"blank_lines":1}},
                    {"type":"verse_line","content":[{"type":"text","text":"b"}]}
                ]}
            ]}),
        );
        let verse = children(&poetry, root(&poetry))[0];
        let zero = Node {
            type_id: format!("{PREFIX}stanza_break"),
            primitive: Primitive::BlockAtom,
            attributes: Attributes::from([("blank_lines".into(), Attribute::Number(0.into()))]),
            marks: vec![],
            text: None,
            children: vec![],
        };
        let operation = tx(
            &poetry,
            vec![Operation::InsertFragment {
                parent: verse.into(),
                index,
                fragment: Document {
                    children: vec![zero],
                },
            }],
        );
        let mut row = assert_refused(&mut poetry, operation, "kwdj.invalid_verse");
        row["case"] = json!(case);
        rows.push(row);
    }
    json!({"status":"passed","cases":rows})
}

pub fn observe() -> String {
    json!({"schema":1,"task":"OSR-34","production_profile":"org.klenwriter.kwdj",
        "scope":"Actual Rust dispatch; test-only transport; user Undo/Redo remains OSR-36",
        "groups":{"text_selection_journal":text_selection_journal(),"attributes_marks_spans":attributes_marks_spans(),
            "fragments_local_references":fragment_local_references(),"normalization_noops":normalization_and_noops(),
            "atomic_refusals":atomic_refusals()},
        "target_metrics":"Architecture-dependent logical byte costs are checked against bounds, not asserted equal across targets"}).to_string()
}
