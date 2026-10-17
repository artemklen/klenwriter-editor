// SPDX-License-Identifier: MIT OR Apache-2.0
//! Extra actual-profile witnesses. Snapshots here are explicit test checkpoints.

use editor_core::document::Mark;
use editor_core::positions::{Affinity, Edge, Position, Selection, Utf16Offset};
use editor_core::profile::{AdmissionMode, FrozenProfile};
use editor_core::transaction::{Operation, WorkUsage};
use editor_engine::mapping::MapResult;
use editor_engine::{
    AccessMode, CommandAvailability, CommandEffect, CommandOutcome, CommandRequest,
    DispatchOutcome, JournalEntrySummary, JournalSummary, NodeId, Session, Transaction,
};
use editor_kwdj::commands::{BlockTarget, KWDJ_SLASH_CANDIDATES, KwdjIntent, ListKind};
use editor_kwdj::{
    AdmissionBudget, IdentityResolver, IdentityResolverError, IdentityStatus, KwdjProfile, Limits,
};
use serde_json::{Value, json};
use uuid::Uuid;

struct Identities;
impl IdentityResolver for Identities {
    fn resolve_media(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(IdentityStatus::Exists)
    }
    fn resolve_reference(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(IdentityStatus::Exists)
    }
}
static IDENTITIES: Identities = Identities;
type RealSession = Session<KwdjProfile<'static>>;
type Request = CommandRequest<KwdjIntent<NodeId>>;

fn wire(content: Value) -> Value {
    json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":content})
}
fn p(text: &str) -> Value {
    if text.is_empty() {
        json!({"type":"paragraph","content":[]})
    } else {
        json!({"type":"paragraph","content":[{"type":"text","text":text}]})
    }
}
fn layout(text: &str) -> Value {
    let mut node = p(text);
    node["attrs"] = json!({"align":"right","first_line_indent":true});
    node
}
fn open_mode(value: &Value, access: AccessMode) -> RealSession {
    let profile = KwdjProfile::new(&IDENTITIES, Limits::default(), AdmissionBudget::default());
    let binding = profile.binding().clone();
    Session::open(
        profile,
        &binding,
        &serde_json::to_vec(value).unwrap(),
        AdmissionMode::Strict,
        access,
    )
    .unwrap()
}
fn open(value: &Value) -> RealSession {
    open_mode(value, AccessMode::Editable)
}
fn doc(session: &RealSession) -> Value {
    serde_json::from_slice(
        &session
            .export_snapshot(session.key(), session.revision())
            .unwrap(),
    )
    .unwrap()
}
fn at(session: &RealSession, path: &[usize]) -> NodeId {
    let mut id = session.root(session.key()).unwrap();
    for index in path {
        id = session.node(session.key(), id).unwrap().children()[*index];
    }
    id
}
fn ids(session: &RealSession, root: NodeId) -> Vec<NodeId> {
    let mut result = vec![root];
    for child in session.node(session.key(), root).unwrap().children() {
        result.extend(ids(session, *child));
    }
    result
}
fn text(leaf: NodeId, utf16: usize) -> Position<NodeId> {
    Position::Text {
        leaf,
        utf16: Utf16Offset::new(utf16),
        affinity: Affinity::After,
    }
}
fn gap(parent: NodeId, index: usize) -> Position<NodeId> {
    Position::Child {
        parent,
        index,
        affinity: Affinity::After,
    }
}
fn caret(position: Position<NodeId>) -> Selection<NodeId> {
    Selection {
        anchor: position,
        focus: position,
    }
}
fn select(session: &mut RealSession, selection: Selection<NodeId>) {
    session
        .set_selection(session.key(), session.revision(), selection)
        .unwrap();
}
fn request(session: &RealSession, intent: KwdjIntent<NodeId>) -> Request {
    CommandRequest::new(
        session.key(),
        session.revision(),
        session.selection_epoch(),
        intent,
    )
}
#[derive(Debug, PartialEq, Eq)]
struct Checkpoint {
    document: Value,
    selection: Option<Selection<NodeId>>,
    stored_marks: Option<Vec<Mark>>,
    revision: u64,
    epoch: u64,
    dirty: bool,
    journal: JournalSummary,
    entries: Vec<JournalEntrySummary>,
    live_ids: Vec<NodeId>,
}
fn checkpoint(session: &RealSession) -> Checkpoint {
    Checkpoint {
        document: doc(session),
        selection: session.selection(session.key()).unwrap(),
        stored_marks: session
            .stored_marks(session.key())
            .unwrap()
            .map(<[Mark]>::to_vec),
        revision: session.revision(),
        epoch: session.selection_epoch(),
        dirty: session.dirty(),
        journal: session.journal_summary(),
        entries: session.journal_entries(),
        live_ids: ids(session, at(session, &[])),
    }
}
fn changed(session: &mut RealSession, req: &Request) -> WorkUsage {
    let before = checkpoint(session);
    let query = session.query_command(req);
    assert_eq!(
        checkpoint(session),
        before,
        "query altered committed facets"
    );
    assert_eq!(session.query_command(req), query, "query is not repeatable");
    let CommandAvailability::Available {
        effect: CommandEffect::Changed,
        work,
        presentation,
        selection_changed,
        stored_marks_changed,
    } = query
    else {
        panic!("expected available changed command: {query:?}");
    };
    let CommandOutcome::Completed {
        outcome: DispatchOutcome::Changed(event),
        presentation: actual_presentation,
    } = session.execute_command(req)
    else {
        panic!("available command did not commit");
    };
    assert_eq!(event.work, work, "query and execution used different work");
    assert_eq!(actual_presentation, presentation);
    assert_eq!(
        selection_changed,
        session.selection(session.key()).unwrap() != before.selection
    );
    assert_eq!(
        stored_marks_changed,
        session.stored_marks(session.key()).unwrap() != before.stored_marks.as_deref()
    );
    assert_eq!(event.selection_before, before.selection);
    assert_eq!(event.stored_marks_before, before.stored_marks);
    assert_eq!(
        event.stored_marks_after.as_deref(),
        session.stored_marks(session.key()).unwrap()
    );
    assert_eq!(session.revision(), before.revision + 1);
    assert_eq!(
        session.journal_summary().entries,
        before.journal.entries + 1
    );
    assert_eq!(
        event.selection_after,
        session.selection(session.key()).unwrap()
    );
    assert_eq!(
        session.journal_entries().last().unwrap().after_revision,
        event.revision
    );
    assert!(session.dirty());
    work
}
fn refused(session: &mut RealSession, req: &Request, expected: Option<&str>) -> String {
    let before = checkpoint(session);
    let query = session.query_command(req);
    assert_eq!(checkpoint(session), before, "refused query changed state");
    assert_eq!(session.query_command(req), query);
    let CommandAvailability::Unavailable {
        reason,
        error,
        work,
    } = query
    else {
        panic!("expected refusal: {query:?}");
    };
    if let Some(expected) = expected {
        assert_eq!(reason, expected);
    }
    let CommandOutcome::Refused {
        reason: actual,
        error: actual_error,
        work: actual_work,
    } = session.execute_command(req)
    else {
        panic!("refused query was executed");
    };
    assert_eq!((actual, actual_error, actual_work), (reason, error, work));
    assert_eq!(
        checkpoint(session),
        before,
        "refusal changed committed facets"
    );
    reason.to_owned()
}

fn payload_fixture() -> Value {
    wire(json!([
        p("lead"),
        {"type":"bullet_list","content":[{"type":"list_item","content":[
            {"type":"paragraph","attrs":{"align":"center","first_line_indent":true},"content":[
                {"type":"text","text":"linked task","marks":[{"type":"strong"},{"type":"reference_link","attrs":{"reference_entity_id":"550e8400-e29b-41d4-a716-446655440006"}}]}]},
            {"type":"task_list","content":[{"type":"task_item","attrs":{"checked":true},"content":[p("checked"),
                {"type":"blockquote","content":[p("nested tail")]}]}]}
        ]}]},
        {"type":"table","content":[
            {"type":"table_row","content":[{"type":"table_header","attrs":{"colspan":2,"align":"center"},"content":[p("wide header")]}]},
            {"type":"table_row","content":[{"type":"table_cell","attrs":{"align":"right"},"content":[p("left")]},{"type":"table_cell","content":[p("right")]}]}
        ]},
        p("tail")
    ]))
}
fn structural_payload() -> Value {
    let original = payload_fixture();
    let mut session = open(&original);
    let root = at(&session, &[]);
    let list = at(&session, &[1]);
    let table = at(&session, &[2]);
    let old_list_ids = ids(&session, list);
    let old_table_ids = ids(&session, table);
    let anchor = text(at(&session, &[1, 0, 0, 0]), 3);
    select(&mut session, caret(anchor));
    let before = session.revision();
    let req = request(
        &session,
        KwdjIntent::Move {
            node: list,
            parent: root,
            before_index: 4,
        },
    );
    changed(&mut session, &req);
    let mut expected = original.clone();
    expected["content"] = json!([
        original["content"][0],
        original["content"][2],
        original["content"][3],
        original["content"][1]
    ]);
    assert_eq!(doc(&session), expected);
    assert_eq!(ids(&session, list), old_list_ids);
    assert_eq!(ids(&session, table), old_table_ids);
    assert_eq!(
        session.map_position(session.key(), before, anchor).unwrap(),
        MapResult::Mapped(anchor)
    );
    assert_eq!(
        session.selection(session.key()).unwrap(),
        Some(caret(anchor))
    );
    let req = request(
        &session,
        KwdjIntent::Move {
            node: list,
            parent: root,
            before_index: 1,
        },
    );
    changed(&mut session, &req);
    assert_eq!(doc(&session), original);

    let mut duplicated = 0;
    for (source, payload) in [
        (list, original["content"][1].clone()),
        (table, original["content"][2].clone()),
    ] {
        let original_ids = ids(&session, source);
        let before_ids = ids(&session, root);
        let req = request(
            &session,
            KwdjIntent::Duplicate {
                node: source,
                parent: root,
                index: 4,
            },
        );
        changed(&mut session, &req);
        let copy = at(&session, &[4]);
        let copy_ids = ids(&session, copy);
        assert_eq!(copy_ids.len(), original_ids.len());
        assert!(copy_ids.iter().all(|id| !before_ids.contains(id)));
        assert_eq!(ids(&session, source), original_ids);
        assert_eq!(doc(&session)["content"][4], payload);
        let req = request(&session, KwdjIntent::Remove { node: copy });
        changed(&mut session, &req);
        assert!(
            copy_ids
                .iter()
                .all(|id| session.node(session.key(), *id).is_err())
        );
        assert_eq!(doc(&session), original);
        duplicated += 1;
    }
    json!({"id":"nested_task_table_move_duplicate_remove","status":"passed","moves":2,"duplicated_complete_subtrees":duplicated,"payload_attrs_marks_and_existing_ids_preserved":true,"duplicate_ids_disjoint":true,"canonical_json":doc(&session)})
}

fn last_root() -> Value {
    let mut session = open(&wire(json!([layout("last")])));
    let old = at(&session, &[0]);
    let old_ids = ids(&session, old);
    let leaf = at(&session, &[0, 0]);
    select(&mut session, caret(text(leaf, 2)));
    let req = request(&session, KwdjIntent::Remove { node: old });
    changed(&mut session, &req);
    assert_eq!(doc(&session), wire(json!([p("")])));
    let new = at(&session, &[0]);
    assert_ne!(new, old);
    assert_eq!(
        session.selection(session.key()).unwrap(),
        Some(caret(gap(new, 0)))
    );
    assert!(
        old_ids
            .iter()
            .all(|id| session.node(session.key(), *id).is_err())
    );
    assert!(session.stored_marks(session.key()).unwrap().is_none());
    json!({"id":"last_root_remove_has_valid_paragraph_fallback","status":"passed","canonical_json":doc(&session),"old_subtree_retired":true,"caret_valid":true})
}

// Independent expected payloads: do not derive these from provider output.
fn slash_payloads() -> Vec<Value> {
    vec![
        p(""),
        json!({"type":"heading","attrs":{"level":2},"content":[]}),
        json!({"type":"heading","attrs":{"level":3},"content":[]}),
        json!({"type":"blockquote","content":[p("")]}),
        json!({"type":"bullet_list","content":[{"type":"list_item","content":[p("")]}]}),
        json!({"type":"ordered_list","content":[{"type":"list_item","content":[p("")]}]}),
        json!({"type":"task_list","content":[{"type":"task_item","attrs":{"checked":false},"content":[p("")]}]}),
        json!({"type":"code_block","content":[]}),
        json!({"type":"scene_break"}),
    ]
}
fn slash_range(session: &RealSession) -> Selection<NodeId> {
    Selection {
        anchor: text(at(session, &[0, 0]), 4),
        focus: text(at(session, &[0, 0]), 6),
    }
}
fn slash_request(session: &RealSession, target: BlockTarget) -> Request {
    request(
        session,
        KwdjIntent::AcceptSlash {
            target,
            range: slash_range(session),
            literal: "/x".into(),
        },
    )
}
fn slash_session(access: AccessMode) -> RealSession {
    let mut session = open_mode(&wire(json!([layout("pre /x tail")])), access);
    let selected = caret(text(at(&session, &[0, 0]), 6));
    select(&mut session, selected);
    session
}
fn slash_and_insert() -> Value {
    let expected_ids = [
        "paragraph",
        "heading2",
        "heading3",
        "blockquote",
        "bullet-list",
        "ordered-list",
        "task-list",
        "code-block",
        "scene-break",
    ];
    let payloads = slash_payloads();
    assert_eq!(KWDJ_SLASH_CANDIDATES.len(), 9);
    let mut cases = Vec::new();
    for (index, entry) in KWDJ_SLASH_CANDIDATES.iter().enumerate() {
        assert_eq!(
            entry.id,
            format!("org.klenwriter.kwdj/slash/{}", expected_ids[index])
        );
        let mut session = slash_session(AccessMode::Editable);
        let prefix_id = at(&session, &[0]);
        let prefix_text = at(&session, &[0, 0]);
        let req = slash_request(&session, entry.target.clone());
        changed(&mut session, &req);
        assert_eq!(
            doc(&session),
            wire(json!([layout("pre "), payloads[index], layout(" tail")]))
        );
        assert_eq!(at(&session, &[0]), prefix_id);
        assert_eq!(at(&session, &[0, 0]), prefix_text);
        let focus = text(at(&session, &[2, 0]), 0);
        assert_eq!(
            session.selection(session.key()).unwrap(),
            Some(caret(focus))
        );
        cases.push(json!({"id":entry.id,"status":"passed","canonical_json":doc(&session),"single_commit":true,"query_removed_only_on_success":true,"literal_caret_matches":true}));
    }
    let mut session = open(&wire(json!([layout("pre tail")])));
    let leaf = at(&session, &[0, 0]);
    select(&mut session, caret(text(leaf, 4)));
    let req = request(
        &session,
        KwdjIntent::InsertBlock {
            target: BlockTarget::CodeBlock {
                language: Some("rust".into()),
            },
        },
    );
    changed(&mut session, &req);
    assert_eq!(
        doc(&session),
        wire(
            json!([layout("pre "),{"type":"code_block","attrs":{"language":"rust"},"content":[]},layout("tail")])
        )
    );
    let inserted = json!({"id":"insert_code_block_retains_language_and_both_layout_headers","status":"passed","canonical_json":doc(&session)});
    json!({"id":"registered_slash_and_insert","status":"passed","slash_candidates":cases,"insert_block":inserted})
}

fn original_boundary_regressions() -> Value {
    let mut cases = Vec::new();
    for target in [None, Some(BlockTarget::SceneBreak)] {
        let before = wire(
            json!([{"type":"paragraph","content":[{"type":"text","text":"e"},{"type":"hard_break"},{"type":"text","text":"\u{301}","marks":[{"type":"strong"}]}]}]),
        );
        let mut session = open(&before);
        let original_prefix = at(&session, &[0, 0]);
        let original_suffix = at(&session, &[0, 2]);
        let block = at(&session, &[0]);
        select(
            &mut session,
            Selection {
                anchor: gap(block, 1),
                focus: gap(block, 2),
            },
        );
        let is_insert = target.is_some();
        let intent = match target {
            Some(target) => KwdjIntent::InsertBlock { target },
            None => KwdjIntent::Enter,
        };
        let req = request(&session, intent);
        changed(&mut session, &req);
        let mut expected = vec![p("e")];
        if is_insert {
            expected.push(json!({"type":"scene_break"}));
        }
        expected.push(json!({"type":"paragraph","content":[{"type":"text","text":"\u{301}","marks":[{"type":"strong"}]}]}));
        assert_eq!(doc(&session), wire(Value::Array(expected)));
        assert_eq!(at(&session, &[0, 0]), original_prefix);
        let tail_index = if is_insert { 2 } else { 1 };
        assert_eq!(at(&session, &[tail_index, 0]), original_suffix);
        assert_eq!(
            session.selection(session.key()).unwrap(),
            Some(caret(text(original_suffix, 0)))
        );
        cases.push(json!({"id":if is_insert{"insert_block_selected_break_before_accent"}else{"enter_selected_break_before_accent"},"status":"passed","canonical_json":doc(&session),"outside_leaf_ids_preserved":true}));
    }
    for variant in 0..8 {
        let mut session = open(&wire(json!([p("ab")])));
        let original_leaf = at(&session, &[0, 0]);
        let original_block = at(&session, &[0]);
        let at_end = variant >= 4;
        let (anchor, focus) = match variant {
            0 => (text(original_leaf, 0), gap(original_block, 0)),
            1 => (gap(original_block, 0), text(original_leaf, 0)),
            2 => (
                Position::Edge {
                    node: original_leaf,
                    side: Edge::Before,
                },
                text(original_leaf, 0),
            ),
            3 => (
                text(original_leaf, 0),
                Position::Edge {
                    node: original_block,
                    side: Edge::Before,
                },
            ),
            4 => (text(original_leaf, 2), gap(original_block, 1)),
            5 => (gap(original_block, 1), text(original_leaf, 2)),
            6 => (
                Position::Edge {
                    node: original_leaf,
                    side: Edge::After,
                },
                text(original_leaf, 2),
            ),
            7 => (
                text(original_leaf, 2),
                Position::Edge {
                    node: original_block,
                    side: Edge::After,
                },
            ),
            _ => unreachable!(),
        };
        select(&mut session, Selection { anchor, focus });
        let req = request(&session, KwdjIntent::Enter);
        changed(&mut session, &req);
        let expected = if at_end {
            wire(json!([p("ab"), p("")]))
        } else {
            wire(json!([p(""), p("ab")]))
        };
        assert_eq!(doc(&session), expected);
        assert_eq!(at(&session, &[usize::from(!at_end), 0]), original_leaf);
        let expected_caret = if at_end {
            gap(at(&session, &[1]), 0)
        } else {
            text(original_leaf, 0)
        };
        assert_eq!(
            session.selection(session.key()).unwrap(),
            Some(caret(expected_caret))
        );
        cases.push(json!({"id":format!("enter_equivalent_zero_range_coordinates_{variant}"),"status":"passed","canonical_json":doc(&session),"outside_leaf_ids_preserved":true,"literal_caret_matches":true}));
    }
    json!({"id":"original_unicode_boundary_recipes","status":"passed","cases":cases})
}

fn refusals() -> Value {
    let mut cases = Vec::new();
    for (target, reason) in [
        (BlockTarget::Table, "kwdj.command_table_unavailable"),
        (BlockTarget::Poetry, "kwdj.command_poetry_unavailable"),
        (BlockTarget::Media, "kwdj.command_host_required"),
        (
            BlockTarget::Heading { level: 0 },
            "kwdj.command_invalid_target",
        ),
        (
            BlockTarget::Heading { level: 7 },
            "kwdj.command_invalid_target",
        ),
        (
            BlockTarget::OrderedList { start: 0 },
            "kwdj.command_invalid_target",
        ),
    ] {
        let mut session = slash_session(AccessMode::Editable);
        let req = request(&session, KwdjIntent::InsertBlock { target });
        let reason = refused(&mut session, &req, Some(reason));
        cases.push(json!({"id":format!("insert_refusal_{}",cases.len()),"reason":reason,"all_facets_preserved":true}));
    }
    for target in [
        BlockTarget::Heading { level: 1 },
        BlockTarget::OrderedList { start: 9 },
    ] {
        let mut session = slash_session(AccessMode::Editable);
        let req = slash_request(&session, target);
        let reason = refused(&mut session, &req, Some("kwdj.command_invalid_target"));
        cases.push(json!({"id":format!("unregistered_slash_{}",cases.len()),"reason":reason,"all_facets_preserved":true}));
    }
    let mut session = slash_session(AccessMode::Editable);
    let mut req = slash_request(&session, BlockTarget::SceneBreak);
    if let KwdjIntent::AcceptSlash { literal, .. } = &mut req.intent {
        *literal = "/other".into();
    }
    let reason = refused(&mut session, &req, Some("kwdj.command_query_mismatch"));
    cases.push(
        json!({"id":"slash_exact_literal_mismatch","reason":reason,"all_facets_preserved":true}),
    );
    let mut session = slash_session(AccessMode::ReadOnly);
    let req = slash_request(&session, BlockTarget::SceneBreak);
    let reason = refused(&mut session, &req, Some("session.read_only"));
    cases.push(json!({"id":"read_only_slash","reason":reason,"all_facets_preserved":true}));

    let mut session = slash_session(AccessMode::Editable);
    let stale_revision = slash_request(&session, BlockTarget::SceneBreak);
    let req = request(&session, KwdjIntent::InsertText { text: "!".into() });
    changed(&mut session, &req);
    let reason = refused(
        &mut session,
        &stale_revision,
        Some("session.stale_revision"),
    );
    cases.push(json!({"id":"stale_revision","reason":reason,"all_facets_preserved":true}));
    let mut session = slash_session(AccessMode::Editable);
    let stale_epoch = slash_request(&session, BlockTarget::SceneBreak);
    let leaf = at(&session, &[0, 0]);
    select(&mut session, caret(text(leaf, 5)));
    let reason = refused(
        &mut session,
        &stale_epoch,
        Some("session.stale_selection_epoch"),
    );
    cases.push(json!({"id":"stale_selection_epoch","reason":reason,"all_facets_preserved":true}));
    let foreign = slash_session(AccessMode::Editable);
    let req = slash_request(&foreign, BlockTarget::SceneBreak);
    let mut session = slash_session(AccessMode::Editable);
    let reason = refused(&mut session, &req, Some("session.stale_session"));
    cases.push(json!({"id":"stale_session","reason":reason,"all_facets_preserved":true}));

    let mut session = open(&payload_fixture());
    let list = at(&session, &[1]);
    let root = at(&session, &[]);
    let descendant = at(&session, &[1, 0]);
    let leaf = at(&session, &[0, 0]);
    for (intent, expected) in [
        (
            KwdjIntent::Move {
                node: list,
                parent: descendant,
                before_index: 0,
            },
            "tree.cycle",
        ),
        (
            KwdjIntent::Move {
                node: list,
                parent: root,
                before_index: usize::MAX,
            },
            "tree.invalid_index",
        ),
        (
            KwdjIntent::Duplicate {
                node: list,
                parent: root,
                index: usize::MAX,
            },
            "tree.invalid_index",
        ),
        (
            KwdjIntent::Remove { node: leaf },
            "kwdj.command_invalid_target",
        ),
    ] {
        let req = request(&session, intent);
        let reason = refused(&mut session, &req, Some(expected));
        cases.push(json!({"id":format!("structural_payload_refusal_{}",cases.len()),"reason":reason,"all_facets_preserved":true}));
    }
    json!({"id":"typed_refusals_and_tokens","status":"passed","cases":cases,"total":cases.len()})
}

fn late_limits() -> Value {
    let mut session = slash_session(AccessMode::Editable);
    let mut req = slash_request(&session, BlockTarget::SceneBreak);
    let CommandAvailability::Available { work, .. } = session.query_command(&req) else {
        panic!("baseline slash not available");
    };
    req.limits.work.bytes = work.bytes.checked_sub(1).unwrap();
    let reason = refused(&mut session, &req, Some("resource_limit_exceeded"));
    let req = slash_request(&session, BlockTarget::SceneBreak);
    changed(&mut session, &req);
    let expected = wire(json!([layout("pre "),{"type":"scene_break"},layout(" tail")]));
    assert_eq!(doc(&session), expected);
    let mut session = slash_session(AccessMode::Editable);
    let mut req = slash_request(&session, BlockTarget::SceneBreak);
    req.limits.journal_entries = 0;
    let journal = refused(&mut session, &req, Some("transaction.journal_limit"));
    let req = slash_request(&session, BlockTarget::SceneBreak);
    changed(&mut session, &req);
    assert_eq!(doc(&session), expected);
    json!({"id":"slash_atomic_late_limits","status":"passed","late_work_reason":reason,"journal_reason":journal,"query_and_full_facets_preserved_on_refusal":true,"same_intent_succeeds_with_default_limits":true,"canonical_json":expected})
}

fn wrapper_selection_contexts() -> Value {
    let mut cases = Vec::new();
    for quote in [true, false] {
        let wrapper = |a: &str, b: &str| {
            if quote {
                json!({"type":"blockquote","content":[p(a),p(b)]})
            } else {
                json!({"type":"bullet_list","content":[{"type":"list_item","content":[p(a)]},{"type":"list_item","content":[p(b)]}]})
            }
        };
        let before = wire(json!([wrapper("a", "b"), p("outside"), wrapper("c", "d")]));
        for second_wrapper in [false, true] {
            let mut session = open(&before);
            let start = at(&session, if quote { &[0, 0, 0] } else { &[0, 0, 0, 0] });
            let end = if second_wrapper {
                at(&session, if quote { &[2, 1, 0] } else { &[2, 1, 0, 0] })
            } else {
                at(&session, &[1, 0])
            };
            select(
                &mut session,
                Selection {
                    anchor: text(start, 0),
                    focus: text(end, if second_wrapper { 1 } else { 7 }),
                },
            );
            let intent = if quote {
                KwdjIntent::ToggleQuote
            } else {
                KwdjIntent::ToggleList {
                    kind: ListKind::Bullet,
                }
            };
            let req = request(&session, intent);
            let reason = refused(&mut session, &req, Some("kwdj.command_unsupported_context"));
            cases.push(json!({"id":format!("{}_mixed_{}",if quote{"quote"}else{"list"},if second_wrapper{"second_wrapper"}else{"outside_paragraph"}),"status":"passed","reason":reason,"all_facets_preserved":true}));
        }
        let mut session = open(&before);
        let first_p = at(&session, if quote { &[0, 0] } else { &[0, 0, 0] });
        let last_p = at(&session, if quote { &[0, 1] } else { &[0, 1, 0] });
        let first_leaf = at(&session, if quote { &[0, 0, 0] } else { &[0, 0, 0, 0] });
        let last_leaf = at(&session, if quote { &[0, 1, 0] } else { &[0, 1, 0, 0] });
        select(
            &mut session,
            Selection {
                anchor: text(first_leaf, 0),
                focus: text(last_leaf, 1),
            },
        );
        let intent = if quote {
            KwdjIntent::ToggleQuote
        } else {
            KwdjIntent::ToggleList {
                kind: ListKind::Bullet,
            }
        };
        let req = request(&session, intent);
        changed(&mut session, &req);
        assert_eq!(
            doc(&session),
            wire(json!([p("a"), p("b"), p("outside"), wrapper("c", "d")]))
        );
        assert_eq!(at(&session, &[0]), first_p);
        assert_eq!(at(&session, &[1]), last_p);
        assert_eq!(at(&session, &[0, 0]), first_leaf);
        assert_eq!(at(&session, &[1, 0]), last_leaf);
        cases.push(json!({"id":if quote{"quote_same_wrapper_unwrap"}else{"list_same_wrapper_unwrap"},"status":"passed","existing_payload_ids_preserved":true,"canonical_json":doc(&session)}));
    }
    json!({"id":"whole_selection_wrapper_context","status":"passed","cases":cases})
}

fn normalization_map_regressions() -> Value {
    let mut cases = Vec::new();
    for forward in [true, false] {
        let original = wire(json!([{"type":"paragraph","content":[
            {"type":"text","text":"A"},
            {"type":"text","text":"e","marks":[{"type":"strong"}]},
            {"type":"text","text":"\u{301}","marks":[{"type":"emphasis"}]},
            {"type":"text","text":"B"}
        ]}]));
        let mut session = open(&original);
        let parent = at(&session, &[0]);
        let [a, base, accent, b] = [0, 1, 2, 3].map(|i| at(&session, &[0, i]));
        let before = session.revision();
        let old_caret = Position::Child {
            parent,
            index: if forward { 4 } else { 0 },
            affinity: Affinity::Before,
        };
        select(&mut session, caret(old_caret));
        let transaction = Transaction::new(
            session.key(),
            before,
            vec![Operation::MoveInlineGroup {
                nodes: vec![base.into(), accent.into()],
                parent: parent.into(),
                before_index: if forward { 4 } else { 0 },
            }],
        );
        let DispatchOutcome::Changed(event) = session.dispatch(transaction) else {
            panic!("whole EGC move did not commit");
        };
        let content = if forward {
            json!([
                {"type":"text","text":"AB"},
                original["content"][0]["content"][1],
                original["content"][0]["content"][2]
            ])
        } else {
            json!([
                original["content"][0]["content"][1],
                original["content"][0]["content"][2],
                {"type":"text","text":"AB"}
            ])
        };
        assert_eq!(
            doc(&session),
            wire(json!([{"type":"paragraph","content":content}]))
        );
        assert_eq!(at(&session, &[0, if forward { 0 } else { 2 }]), a);
        assert_eq!(at(&session, &[0, if forward { 1 } else { 0 }]), base);
        assert_eq!(at(&session, &[0, if forward { 2 } else { 1 }]), accent);
        assert!(session.node(session.key(), b).is_err());
        assert!(event.normalization_operations > 0);
        let before_gaps = if forward {
            [0, 1, 1, 1, 1]
        } else {
            [0, 3, 3, 3, 3]
        };
        let after_gaps = if forward {
            [0, 1, 1, 1, 3]
        } else {
            [2, 3, 3, 3, 3]
        };
        for (affinity, indices) in [
            (Affinity::Before, before_gaps),
            (Affinity::After, after_gaps),
        ] {
            for (index, mapped_index) in indices.into_iter().enumerate() {
                let old = Position::Child {
                    parent,
                    index,
                    affinity,
                };
                let expected = MapResult::Mapped(Position::Child {
                    parent,
                    index: mapped_index,
                    affinity,
                });
                assert_eq!(event.map.map(old), expected);
                assert_eq!(
                    session.map_position(session.key(), before, old).unwrap(),
                    expected
                );
            }
        }
        let expected_caret = Position::Child {
            parent,
            index: if forward { 1 } else { 0 },
            affinity: Affinity::Before,
        };
        assert_eq!(event.selection_before, Some(caret(old_caret)));
        assert_eq!(event.selection_after, Some(caret(expected_caret)));
        assert_eq!(
            session.selection(session.key()).unwrap(),
            event.selection_after
        );
        assert_eq!(
            session
                .map_position(
                    session.key(),
                    before,
                    Position::Text {
                        leaf: b,
                        utf16: Utf16Offset::new(0),
                        affinity: Affinity::Before
                    }
                )
                .unwrap(),
            MapResult::Mapped(Position::Text {
                leaf: a,
                utf16: Utf16Offset::new(1),
                affinity: Affinity::Before
            })
        );
        cases.push(json!({"id":if forward {"same_parent_group_forward"} else {"same_parent_group_backward"},"status":"passed","original_parent_gaps_checked":10,"event_and_journal_maps_equal":true,"whole_egc_ids_and_marks_preserved":true,"joined_right_leaf_retired":true,"selection_matches_map":true,"canonical_json":doc(&session)}));
    }
    for edge in [false, true] {
        for reverse in [false, true] {
            let mut session = open(&wire(json!([{"type":"paragraph","content":[
                {"type":"text","text":"𝄞"},
                {"type":"text","text":"b","marks":[{"type":"strong"}]}
            ]}])));
            let left = at(&session, &[0, 0]);
            let right = at(&session, &[0, 1]);
            let start = if edge {
                Position::Edge {
                    node: left,
                    side: Edge::After,
                }
            } else {
                text(left, 2)
            };
            let end = text(right, 1);
            let before = session.revision();
            select(
                &mut session,
                if reverse {
                    Selection {
                        anchor: end,
                        focus: start,
                    }
                } else {
                    Selection {
                        anchor: start,
                        focus: end,
                    }
                },
            );
            let req = request(
                &session,
                KwdjIntent::ToggleMark {
                    mark: Mark {
                        type_id: "org.klenwriter.kwdj/strong".into(),
                        attributes: Default::default(),
                    },
                },
            );
            changed(&mut session, &req);
            let expected_start = text(left, 2);
            let expected_end = text(left, 3);
            assert_eq!(doc(&session), wire(json!([p("𝄞b")])));
            assert_eq!(
                session.selection(session.key()).unwrap(),
                Some(if reverse {
                    Selection {
                        anchor: expected_end,
                        focus: expected_start,
                    }
                } else {
                    Selection {
                        anchor: expected_start,
                        focus: expected_end,
                    }
                })
            );
            assert_eq!(
                session.map_position(session.key(), before, start).unwrap(),
                MapResult::Mapped(expected_start)
            );
            assert!(session.node(session.key(), right).is_err());
            cases.push(json!({"id":format!("join_seam_{}_{}",if edge {"edge"} else {"text"},if reverse {"reverse"} else {"forward"}),"status":"passed","command":"toggle-mark","query_execute_equal":true,"anchor_utf16":if reverse {3} else {2},"focus_utf16":if reverse {2} else {3},"canonical_json":doc(&session)}));
        }
    }
    json!({"id":"normalization_position_maps","status":"passed","cases":cases,"case_total":6})
}

pub fn observe() -> Value {
    let groups = vec![
        structural_payload(),
        last_root(),
        slash_and_insert(),
        original_boundary_regressions(),
        refusals(),
        late_limits(),
        wrapper_selection_contexts(),
        normalization_map_regressions(),
    ];
    json!({"format":"klenwriter-editor-command-structural-observations","version":1,"status":"passed","groups":groups,"group_total":8,"scope":"Actual Session<KwdjProfile> structural/refusal commands and raw whole-EGC move map witnesses; explicit checkpoint snapshots only"})
}
