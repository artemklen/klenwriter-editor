// SPDX-License-Identifier: MIT OR Apache-2.0
//! Explicit snapshot checkpoints around actual production KWDJ command paths.
//! The final-context probe is a test-only compiled wrapper, never a public ABI.

use editor_core::candidate::CandidateRead;
use editor_core::commands::{
    ActiveState, CommandDescriptor, CommandPresentation, CommandProvider, CommandState,
    PlanBuilder, StoredMarksUpdate,
};
use editor_core::document::{Attributes, Document, Mark, Primitive};
use editor_core::positions::{Affinity, Position, Selection, Utf16Offset};
use editor_core::profile::{AdmissionMode, FrozenProfile, ProfileBinding};
use editor_core::transaction::{Operation, TransactionProfile, ValidationStats, WorkMeter};
use editor_engine::{
    AccessMode, CommandAvailability, CommandEffect, CommandOutcome, CommandRequest,
    DispatchOutcome, NodeId, Session,
};
use editor_kwdj::commands::KwdjIntent;
use editor_kwdj::{
    AdmissionBudget, IdentityResolver, IdentityResolverError, IdentityStatus, KwdjProfile,
    KwdjProfileError, Limits, Profile,
};
use serde_json::{Value, json};
use uuid::Uuid;

const PREFIX: &str = "org.klenwriter.kwdj/";
const REFERENCE: &str = "550e8400-e29b-41d4-a716-446655440006";
struct Identities;
impl IdentityResolver for Identities {
    fn resolve_media(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(IdentityStatus::Missing)
    }
    fn resolve_reference(&self, id: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(if id.to_string() == REFERENCE {
            IdentityStatus::Exists
        } else {
            IdentityStatus::Missing
        })
    }
}
static IDENTITIES: Identities = Identities;
fn profile() -> KwdjProfile<'static> {
    KwdjProfile::new(&IDENTITIES, Limits::default(), AdmissionBudget::default())
}
fn wire(content: Value) -> Value {
    json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":content})
}
fn t(text: &str, marks: &[&str]) -> Value {
    let mut node = json!({"type":"text","text":text});
    if !marks.is_empty() {
        node["marks"] = json!(
            marks
                .iter()
                .map(|kind| json!({"type":kind}))
                .collect::<Vec<_>>()
        );
    }
    node
}
fn p(content: Value) -> Value {
    json!({"type":"paragraph","content":content})
}
fn mark(kind: &str) -> Mark {
    Mark {
        type_id: format!("{PREFIX}{kind}"),
        attributes: Attributes::new(),
    }
}
fn open(value: &Value) -> Session<KwdjProfile<'static>> {
    let profile = profile();
    let binding = profile.binding().clone();
    Session::open(
        profile,
        &binding,
        &serde_json::to_vec(value).unwrap(),
        AdmissionMode::Strict,
        AccessMode::Editable,
    )
    .unwrap()
}
fn canonical(value: &Value) -> String {
    let profile = profile();
    let admitted = profile
        .admit_bytes(
            profile.binding(),
            &serde_json::to_vec(value).unwrap(),
            AdmissionMode::Import,
        )
        .unwrap();
    String::from_utf8(profile.canonical(&admitted).to_vec()).unwrap()
}
fn doc<P: FrozenProfile>(s: &Session<P>) -> String
where
    P::Error: std::fmt::Debug,
{
    String::from_utf8(s.export_snapshot(s.key(), s.revision()).unwrap()).unwrap()
}
fn at<P: FrozenProfile>(s: &Session<P>, path: &[usize]) -> NodeId
where
    P::Error: std::fmt::Debug,
{
    let mut id = s.root(s.key()).unwrap();
    for index in path {
        id = s.node(s.key(), id).unwrap().children()[*index];
    }
    id
}
fn point(id: NodeId, n: usize) -> Position<NodeId> {
    Position::Text {
        leaf: id,
        utf16: Utf16Offset::new(n),
        affinity: Affinity::After,
    }
}
fn select<P: FrozenProfile>(s: &mut Session<P>, anchor: Position<NodeId>, focus: Position<NodeId>)
where
    P::Error: std::fmt::Debug,
{
    s.set_selection(s.key(), s.revision(), Selection { anchor, focus })
        .unwrap();
}
fn whole(s: &mut Session<KwdjProfile<'static>>, path: &[usize], length: usize) {
    let leaf = at(s, path);
    select(s, point(leaf, 0), point(leaf, length));
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
fn checkpoint<P: FrozenProfile>(s: &Session<P>) -> Checkpoint
where
    P::Error: std::fmt::Debug,
{
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
fn apply(
    s: &mut Session<KwdjProfile<'static>>,
    intent: KwdjIntent<NodeId>,
    active: Option<ActiveState>,
    effect: CommandEffect,
) -> DispatchOutcome<KwdjProfileError> {
    let request = CommandRequest::new(s.key(), s.revision(), s.selection_epoch(), intent);
    let before = checkpoint(s);
    let query = s.query_command(&request);
    assert_eq!(checkpoint(s), before, "query changed committed facets");
    let CommandAvailability::Available {
        presentation,
        effect: predicted,
        work,
        selection_changed,
        stored_marks_changed,
    } = query
    else {
        panic!("expected available command: {query:?}")
    };
    assert_eq!(presentation.active, active);
    assert_eq!(predicted, effect);
    let CommandOutcome::Completed {
        presentation: actual,
        outcome,
    } = s.execute_command(&request)
    else {
        panic!("available command refused")
    };
    assert_eq!(presentation, actual);
    assert_eq!(selection_changed, s.selection(s.key()).unwrap() != before.1);
    assert_eq!(
        stored_marks_changed,
        s.stored_marks(s.key()).unwrap() != before.2.as_deref()
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
        DispatchOutcome::Changed(event) => {
            assert_eq!(effect, CommandEffect::Changed);
            assert_eq!(work, event.work);
        }
        DispatchOutcome::Unchanged { work: actual, .. } => {
            assert_eq!(effect, CommandEffect::Unchanged);
            assert_eq!(work, *actual);
        }
        other => panic!("unexpected dispatch {other:?}"),
    }
    outcome
}
fn refuse<P: CommandProvider<Error = KwdjProfileError>>(
    s: &mut Session<P>,
    request: CommandRequest<P::Intent<NodeId>>,
    expected: &str,
) -> Value {
    let before = checkpoint(s);
    let CommandAvailability::Unavailable {
        reason,
        error,
        work,
    } = s.query_command(&request)
    else {
        panic!("expected {expected}")
    };
    assert_eq!(reason, expected);
    assert_eq!(checkpoint(s), before);
    match s.execute_command(&request) {
        CommandOutcome::Refused {
            reason: actual,
            error: actual_error,
            work: actual_work,
        } => {
            assert_eq!(actual, reason);
            assert_eq!(actual_error, error);
            assert_eq!(actual_work, work);
        }
        _ => panic!("query/execute refusal mismatch"),
    }
    assert_eq!(checkpoint(s), before, "refusal changed committed state");
    if let Some(selected) = s.selection(s.key()).unwrap() {
        assert_eq!(
            s.map_position(s.key(), s.revision(), selected.focus)
                .unwrap()
                .position(),
            Some(selected.focus)
        );
    }
    json!({"reason":reason,"all_committed_facets_preserved":true,"current_revision_map_identity":true,"query_execute_equal":true})
}
fn request(
    s: &Session<KwdjProfile<'static>>,
    intent: KwdjIntent<NodeId>,
) -> CommandRequest<KwdjIntent<NodeId>> {
    CommandRequest::new(s.key(), s.revision(), s.selection_epoch(), intent)
}
fn assert_doc(s: &Session<KwdjProfile<'static>>, expected: Value) {
    assert_eq!(doc(s), canonical(&expected));
}

fn formatting_states() -> Value {
    let mut s = open(&wire(json!([p(json!([
        t("ab", &[]),
        t("cd", &["strong"]),
        t("ef", &["emphasis"])
    ]))])));
    let first = at(&s, &[0, 0]);
    let last = at(&s, &[0, 2]);
    select(&mut s, point(last, 1), point(first, 1));
    apply(
        &mut s,
        KwdjIntent::ToggleMark {
            mark: mark("strong"),
        },
        Some(ActiveState::Mixed),
        CommandEffect::Changed,
    );
    let formatted = wire(json!([p(json!([
        t("a", &[]),
        t("bcd", &["strong"]),
        t("e", &["strong", "emphasis"]),
        t("f", &["emphasis"])
    ]))]));
    assert_doc(&s, formatted.clone());
    let selected = s.selection(s.key()).unwrap().unwrap();
    assert_eq!(selected.anchor, point(at(&s, &[0, 3]), 0));
    assert_eq!(selected.focus, point(at(&s, &[0, 1]), 0));
    apply(
        &mut s,
        KwdjIntent::ToggleMark {
            mark: mark("strong"),
        },
        Some(ActiveState::On),
        CommandEffect::Changed,
    );
    assert_doc(
        &s,
        wire(json!([p(json!([t("abcd", &[]), t("ef", &["emphasis"])]))])),
    );
    apply(
        &mut s,
        KwdjIntent::ToggleMark {
            mark: mark("strong"),
        },
        Some(ActiveState::Off),
        CommandEffect::Changed,
    );
    assert_doc(&s, formatted);
    json!({"status":"passed","active_sequence":["mixed","all","none"],"reverse_partial_range":true,"canonical_json":doc(&s),"query_execute_equal":true})
}

fn unicode_ranges() -> Value {
    let mut s = open(&wire(json!([
        p(
            json!([t("e",&[]),t("\u{301}",&["strong"]),t("!",&[]),{"type":"hard_break"},t("👩",&[]),t("🏽‍💻",&["emphasis"])])
        ),
        p(json!([t("tail", &[])]))
    ])));
    let base = at(&s, &[0, 0]);
    let accent = at(&s, &[0, 1]);
    select(&mut s, point(base, 0), point(accent, 1));
    apply(
        &mut s,
        KwdjIntent::ToggleMark {
            mark: mark("emphasis"),
        },
        Some(ActiveState::Off),
        CommandEffect::Changed,
    );
    let woman = at(&s, &[0, 4]);
    let rest = at(&s, &[0, 5]);
    select(&mut s, point(woman, 0), point(rest, 5));
    apply(
        &mut s,
        KwdjIntent::ToggleMark {
            mark: mark("strong"),
        },
        Some(ActiveState::Off),
        CommandEffect::Changed,
    );
    let end = at(&s, &[1, 0]);
    let start = at(&s, &[0, 0]);
    select(&mut s, point(end, 4), point(start, 0));
    apply(
        &mut s,
        KwdjIntent::ToggleMark {
            mark: mark("strike"),
        },
        Some(ActiveState::Off),
        CommandEffect::Changed,
    );
    assert_doc(
        &s,
        wire(json!([
            p(
                json!([t("e",&["emphasis","strike"]),t("\u{301}",&["strong","emphasis","strike"]),t("!",&["strike"]),{"type":"hard_break"},t("👩",&["strong","strike"]),t("🏽‍💻",&["strong","emphasis","strike"])])
            ),
            p(json!([t("tail", &["strike"])]))
        ])),
    );
    assert_eq!(
        s.node(s.key(), at(&s, &[0, 3])).unwrap().primitive(),
        Some(Primitive::HardBreak)
    );
    let selected = s.selection(s.key()).unwrap().unwrap();
    assert_eq!(selected.anchor, point(at(&s, &[1, 0]), 4));
    assert_eq!(selected.focus, point(at(&s, &[0, 0]), 0));
    json!({"status":"passed","whole_combining_cluster":true,"whole_zwj_cluster":true,"cross_basic_blocks":true,"reverse_direction_preserved":true,"hard_break_preserved":true,"canonical_json":doc(&s)})
}

fn typing_replacement() -> Value {
    let mut same = open(&wire(json!([p(json!([
        t("ab", &["strong"]),
        t("cd", &["emphasis"])
    ]))])));
    let a = at(&same, &[0, 0]);
    let b = at(&same, &[0, 1]);
    select(&mut same, point(b, 1), point(a, 1));
    apply(
        &mut same,
        KwdjIntent::InsertText { text: "X".into() },
        None,
        CommandEffect::Changed,
    );
    assert_doc(
        &same,
        wire(json!([p(json!([
            t("aX", &["strong"]),
            t("d", &["emphasis"])
        ]))])),
    );
    assert_eq!(
        same.selection(same.key()).unwrap().unwrap().focus,
        point(at(&same, &[0, 0]), 2)
    );
    let mut cross = open(&wire(json!([
        {"type":"paragraph","attrs":{"align":"center"},"content":[t("pre DEL",&[])]},
        {"type":"paragraph","attrs":{"align":"center"},"content":[t("DEL",&["emphasis"]),t("e",&[]),t("\u{301}",&["strong"]),t(" tail",&["emphasis"])]}
    ])));
    let a = at(&cross, &[0, 0]);
    let b = at(&cross, &[1, 0]);
    let accent = at(&cross, &[1, 2]);
    select(&mut cross, point(b, 3), point(a, 4));
    apply(
        &mut cross,
        KwdjIntent::InsertText { text: "X".into() },
        None,
        CommandEffect::Changed,
    );
    assert_doc(
        &cross,
        wire(
            json!([{"type":"paragraph","attrs":{"align":"center"},"content":[t("pre Xe",&[]),t("\u{301}",&["strong"]),t(" tail",&["emphasis"])]}]),
        ),
    );
    assert_eq!(
        cross.node(cross.key(), accent).unwrap().text(),
        Some("\u{301}")
    );
    json!({"status":"passed","same_block_reverse_replacement":true,"same_block_normalized_caret":true,"cross_block_reverse_replacement":true,"surviving_styled_accent_identity":true,"same_canonical_json":doc(&same),"cross_canonical_json":doc(&cross)})
}

fn ordinary_links() -> Value {
    let mut s = open(&wire(json!([p(json!([t("abcde", &["strong"])]))])));
    let leaf = at(&s, &[0, 0]);
    select(&mut s, point(leaf, 1), point(leaf, 4));
    apply(
        &mut s,
        KwdjIntent::SetLink {
            href: "/safe/a?b=1#c".into(),
            title: Some("one\r\ntwo".into()),
        },
        Some(ActiveState::Off),
        CommandEffect::Changed,
    );
    assert_doc(
        &s,
        wire(json!([p(
            json!([t("a",&["strong"]),{"type":"text","text":"bcd","marks":[{"type":"strong"},{"type":"link","attrs":{"href":"/safe/a?b=1#c","title":"one\ntwo"}}]},t("e",&["strong"])])
        )])),
    );
    let linked = doc(&s);
    apply(
        &mut s,
        KwdjIntent::UnsetLink,
        Some(ActiveState::On),
        CommandEffect::Changed,
    );
    assert_doc(&s, wire(json!([p(json!([t("abcde", &["strong"])]))])));
    json!({"status":"passed","safe_relative_url":true,"shared_title_newlines":true,"other_marks_preserved":true,"set_canonical_json":linked,"unset_canonical_json":doc(&s)})
}

fn atomic_link_refusals() -> Value {
    let mut ordinary = open(&wire(json!([p(json!([t("prior", &[])]))])));
    whole(&mut ordinary, &[0, 0], 5);
    apply(
        &mut ordinary,
        KwdjIntent::ToggleMark {
            mark: mark("strong"),
        },
        Some(ActiveState::Off),
        CommandEffect::Changed,
    );
    let mut cases = Vec::new();
    for href in [
        "javascript:alert(1)",
        "//evil.example/a",
        "/a/%2e%2e/b",
        "https://u:p@example.org/a",
        "https://example.org\\bad",
        "/bad\u{0}",
    ] {
        let captured = request(
            &ordinary,
            KwdjIntent::SetLink {
                href: href.into(),
                title: None,
            },
        );
        cases.push(refuse(&mut ordinary, captured, "kwdj.unsafe_url"));
    }
    let mut reference = open(&wire(json!([p(
        json!([{"type":"text","text":"ref","marks":[{"type":"reference_link","attrs":{"reference_entity_id":REFERENCE}}]},t(" plain",&[])])
    )])));
    let a = at(&reference, &[0, 0]);
    let b = at(&reference, &[0, 1]);
    select(&mut reference, point(b, 6), point(a, 1));
    for intent in [
        KwdjIntent::SetLink {
            href: "/safe".into(),
            title: None,
        },
        KwdjIntent::UnsetLink,
    ] {
        let captured = request(&reference, intent);
        cases.push(refuse(
            &mut reference,
            captured,
            "kwdj.command_reference_protected",
        ));
    }
    json!({"status":"passed","typed_refusals":cases,"unsafe_url_cases":6,"reference_protected_cases":2,"preexisting_history_preserved":ordinary.journal_summary().entries==1})
}

fn mark_policy() -> Value {
    let mut successful = Vec::new();
    for (kind, attrs) in [
        ("strong", json!({})),
        ("emphasis", json!({})),
        ("strike", json!({})),
        ("code", json!({})),
        ("subscript", json!({})),
        ("superscript", json!({})),
        ("text_color", json!({"token":"accent"})),
        ("highlight", json!({"token":"warning"})),
    ] {
        let mut s = open(&wire(json!([p(json!([t("ab", &[])]))])));
        whole(&mut s, &[0, 0], 2);
        let mut core = mark(kind);
        for (key, value) in attrs.as_object().unwrap() {
            core.attributes.insert(
                key.clone(),
                editor_core::document::Attribute::String(value.as_str().unwrap().into()),
            );
        }
        apply(
            &mut s,
            KwdjIntent::ToggleMark { mark: core },
            Some(ActiveState::Off),
            CommandEffect::Changed,
        );
        let mut expected = json!({"type":kind});
        if !attrs.as_object().unwrap().is_empty() {
            expected["attrs"] = attrs;
        }
        assert_doc(
            &s,
            wire(json!([p(
                json!([{"type":"text","text":"ab","marks":[expected]}])
            )])),
        );
        successful.push(kind);
    }
    let mut refused = Vec::new();
    for (existing, added) in [("code", "strong"), ("subscript", "superscript")] {
        let mut s = open(&wire(json!([p(json!([t("ab", &[existing])]))])));
        whole(&mut s, &[0, 0], 2);
        let captured = request(&s, KwdjIntent::ToggleMark { mark: mark(added) });
        refused.push(refuse(&mut s, captured, "kwdj.incompatible_marks"));
    }
    let mut code = open(&wire(
        json!([{"type":"code_block","attrs":{"language":"rust"},"content":[t("ab",&[])]}]),
    ));
    whole(&mut code, &[0, 0], 2);
    let captured = request(
        &code,
        KwdjIntent::ToggleMark {
            mark: mark("strong"),
        },
    );
    refused.push(refuse(
        &mut code,
        captured,
        "kwdj.command_unsupported_context",
    ));
    let mut unknown = open(&wire(json!([p(json!([t("ab", &[])]))])));
    whole(&mut unknown, &[0, 0], 2);
    let captured = request(
        &unknown,
        KwdjIntent::ToggleMark {
            mark: mark("unknown"),
        },
    );
    refused.push(refuse(
        &mut unknown,
        captured,
        "kwdj.command_invalid_target",
    ));
    json!({"status":"passed","formatting_kinds":successful,"link_and_reference_policy_tested_separately":true,"typed_refusals":refused})
}

fn equivalent_carets() -> Value {
    let mut cases = Vec::new();
    for variant in 0..4 {
        let mut s = open(&wire(json!([p(json!([t("ab", &[])]))])));
        let block = at(&s, &[0]);
        let leaf = at(&s, &[0, 0]);
        let anchor = point(leaf, 0);
        let focus = match variant {
            0 => Position::Child {
                parent: block,
                index: 0,
                affinity: Affinity::Before,
            },
            1 => Position::Edge {
                node: leaf,
                side: editor_core::positions::Edge::Before,
            },
            2 => Position::Edge {
                node: block,
                side: editor_core::positions::Edge::Before,
            },
            _ => Position::Text {
                leaf,
                utf16: Utf16Offset::new(0),
                affinity: Affinity::Before,
            },
        };
        select(&mut s, anchor, focus);
        let before = doc(&s);
        assert!(matches!(
            apply(
                &mut s,
                KwdjIntent::ToggleMark {
                    mark: mark("strong")
                },
                Some(ActiveState::Off),
                CommandEffect::Unchanged
            ),
            DispatchOutcome::Unchanged {
                stored_marks_changed: true,
                ..
            }
        ));
        assert_eq!(
            s.stored_marks(s.key()).unwrap(),
            Some([mark("strong")].as_slice())
        );
        assert_eq!(doc(&s), before);
        assert_eq!(s.revision(), 0);
        assert_eq!(s.journal_summary().entries, 0);
        let untouched = checkpoint(&s);
        apply(
            &mut s,
            KwdjIntent::InsertText {
                text: String::new(),
            },
            None,
            CommandEffect::Unchanged,
        );
        assert_eq!(
            checkpoint(&s),
            untouched,
            "empty typing at equivalent caret must preserve all facets"
        );
        apply(
            &mut s,
            KwdjIntent::InsertText { text: "X".into() },
            None,
            CommandEffect::Changed,
        );
        assert_doc(
            &s,
            wire(json!([p(json!([t("X", &["strong"]), t("ab", &[])]))])),
        );
        cases.push(json!({"variant":variant,"state_only_override":true,"empty_typing_noop":true,"canonical_json":doc(&s)}));
    }
    let mut link = open(&wire(json!([p(json!([t("ab", &[])]))])));
    let leaf = at(&link, &[0, 0]);
    let block = at(&link, &[0]);
    select(
        &mut link,
        point(leaf, 0),
        Position::Child {
            parent: block,
            index: 0,
            affinity: Affinity::Before,
        },
    );
    apply(
        &mut link,
        KwdjIntent::SetLink {
            href: "/future".into(),
            title: None,
        },
        Some(ActiveState::Off),
        CommandEffect::Unchanged,
    );
    assert_eq!(
        link.stored_marks(link.key()).unwrap().unwrap()[0].type_id,
        "org.klenwriter.kwdj/link"
    );
    apply(
        &mut link,
        KwdjIntent::UnsetLink,
        Some(ActiveState::On),
        CommandEffect::Unchanged,
    );
    assert_eq!(link.stored_marks(link.key()).unwrap(), Some([].as_slice()));
    assert_doc(&link, wire(json!([p(json!([t("ab", &[])]))])));
    json!({"status":"passed","equivalent_representations":cases,"link_override_at_equivalent_caret":true,"no_neighbor_leaf_mark_edit":true})
}

// This trusted test-only provider deliberately proposes Keep during a valid
// paragraph→code candidate. It delegates every authoritative KWDJ phase; it is
// not a KWDJ catalog entry, production capability, SDK hook, or exported ABI.
struct KeepProbe {
    inner: KwdjProfile<'static>,
}
enum ProbeIntent<I> {
    Marks,
    KeepIntoCode { block: I },
}
impl FrozenProfile for KeepProbe {
    type Context = Profile;
    type Admitted = <KwdjProfile<'static> as FrozenProfile>::Admitted;
    type Error = KwdjProfileError;
    fn binding(&self) -> &ProfileBinding {
        self.inner.binding()
    }
    fn admit_bytes(
        &self,
        b: &ProfileBinding,
        input: &[u8],
        mode: AdmissionMode,
    ) -> Result<Self::Admitted, Self::Error> {
        self.inner.admit_bytes(b, input, mode)
    }
    fn context(&self, a: &Self::Admitted) -> Profile {
        self.inner.context(a)
    }
    fn to_document(&self, a: &Self::Admitted) -> Document {
        self.inner.to_document(a)
    }
    fn admit_snapshot(&self, c: &Profile, d: &Document) -> Result<Self::Admitted, Self::Error> {
        self.inner.admit_snapshot(c, d)
    }
    fn canonical<'a>(&self, a: &'a Self::Admitted) -> &'a [u8] {
        self.inner.canonical(a)
    }
}
impl TransactionProfile for KeepProbe {
    fn normalize_candidate<V: CandidateRead>(
        &self,
        c: &Profile,
        v: &V,
        w: &mut WorkMeter,
    ) -> Result<Vec<Operation<V::Id>>, Self::Error> {
        self.inner.normalize_candidate(c, v, w)
    }
    fn validate_candidate<V: CandidateRead>(
        &self,
        c: &Profile,
        v: &V,
        w: &mut WorkMeter,
    ) -> Result<ValidationStats, Self::Error> {
        self.inner.validate_candidate(c, v, w)
    }
}
impl CommandProvider for KeepProbe {
    type Intent<I: Copy + Eq + Ord> = ProbeIntent<I>;
    const COMMANDS: &'static [CommandDescriptor] = &[
        CommandDescriptor {
            id: "org.example.keep-probe/marks",
        },
        CommandDescriptor {
            id: "org.example.keep-probe/code",
        },
    ];
    fn command_id<I: Copy + Eq + Ord>(intent: &ProbeIntent<I>) -> &'static str {
        match intent {
            ProbeIntent::Marks => Self::COMMANDS[0].id,
            ProbeIntent::KeepIntoCode { .. } => Self::COMMANDS[1].id,
        }
    }
    fn prepare_command<V: CandidateRead>(
        &self,
        _: &Profile,
        _: &V,
        _: CommandState<'_, V::Id>,
        intent: &ProbeIntent<V::Id>,
        plan: &mut PlanBuilder<'_, V::Id>,
    ) -> Result<CommandPresentation, Self::Error> {
        match intent {
            ProbeIntent::Marks => {
                let marks = plan
                    .charged_copy_marks(&[mark("strong")])
                    .map_err(editor_kwdj_error)?;
                plan.set_stored_marks(StoredMarksUpdate::Set(marks))
                    .map_err(editor_kwdj_error)?;
            }
            ProbeIntent::KeepIntoCode { block } => {
                let type_id = plan
                    .charged_copy_text("org.klenwriter.kwdj/code_block")
                    .map_err(editor_kwdj_error)?;
                plan.push(Operation::Transform {
                    node: (*block).into(),
                    type_id,
                    primitive: Primitive::TextBlock,
                })
                .map_err(editor_kwdj_error)?;
                // Default stored-marks policy remains Keep deliberately.
            }
        }
        Ok(CommandPresentation::default())
    }
    fn finalize_typing_override<V: CandidateRead>(
        &self,
        c: &Profile,
        v: &V,
        s: Option<Selection<V::Id>>,
        m: Option<&[Mark]>,
        w: &mut WorkMeter,
    ) -> Result<Option<Vec<Mark>>, Self::Error> {
        self.inner.finalize_typing_override(c, v, s, m, w)
    }
    fn error_code(error: &Self::Error) -> &'static str {
        <KwdjProfile<'static> as CommandProvider>::error_code(error)
    }
}
fn editor_kwdj_error(_: editor_core::limits::LimitExceeded) -> KwdjProfileError {
    // Probe requests are fixed and tiny; reaching this path is a test failure,
    // not a new public domain-error constructor or production budget policy.
    panic!("bounded keep-probe planner exceeded default work")
}
fn final_context() -> Value {
    let profile = KeepProbe { inner: profile() };
    let binding = profile.binding().clone();
    let initial = wire(json!([p(json!([t("ab", &[])]))]));
    let mut s = Session::open(
        profile,
        &binding,
        &serde_json::to_vec(&initial).unwrap(),
        AdmissionMode::Strict,
        AccessMode::Editable,
    )
    .unwrap();
    let leaf = at(&s, &[0, 0]);
    select(&mut s, point(leaf, 1), point(leaf, 1));
    let marks = CommandRequest::new(
        s.key(),
        s.revision(),
        s.selection_epoch(),
        ProbeIntent::Marks,
    );
    assert!(matches!(
        s.query_command(&marks),
        CommandAvailability::Available {
            effect: CommandEffect::Unchanged,
            stored_marks_changed: true,
            ..
        }
    ));
    assert!(matches!(
        s.execute_command(&marks),
        CommandOutcome::Completed {
            outcome: DispatchOutcome::Unchanged {
                stored_marks_changed: true,
                ..
            },
            ..
        }
    ));
    assert_eq!(
        s.stored_marks(s.key()).unwrap(),
        Some([mark("strong")].as_slice())
    );
    let block = at(&s, &[0]);
    let captured = CommandRequest::new(
        s.key(),
        s.revision(),
        s.selection_epoch(),
        ProbeIntent::KeepIntoCode { block },
    );
    let refusal = refuse(&mut s, captured, "kwdj.command_unsupported_context");
    assert_eq!(doc(&s), canonical(&initial));
    assert_eq!(s.revision(), 0);
    assert_eq!(s.journal_summary().entries, 0);
    json!({"status":"passed","classification":"Test-only compiled wrapper proposes Keep; actual KWDJ admission, normalization, final schema and final typing validator delegate unchanged","schema_valid_code_candidate_rejected_by_final_typing_context":true,"refusal":refusal})
}

pub fn observe() -> Value {
    let groups = json!({
        "formatting_states":formatting_states(),"unicode_ranges":unicode_ranges(),
        "typing_replacement":typing_replacement(),"ordinary_links":ordinary_links(),
        "atomic_link_refusals":atomic_link_refusals(),"mark_policy":mark_policy(),
        "final_context":final_context(),"equivalent_carets":equivalent_carets(),
    });
    json!({"format":"klenwriter-editor-command-inline-observations","version":1,"status":"passed","groups":groups,"query_execute_equal":true,"scope":"Actual Session<KwdjProfile> command behavior with explicit snapshot checkpoints; one labeled test-only final-context probe. No mounted UI/public SDK ABI claim."})
}
