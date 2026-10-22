// SPDX-License-Identifier: MIT OR Apache-2.0
//! Source-authored generic result controls GR01–16 and additive GR17. This provider has no
//! KWDJ/CMS rules and is not a native/installed typography acceptance claim.
use super::*;
use editor_core::commands::{
    InputCommandPolicy, InputOrigin, InputOriginal, InputSourceRegion, InputTextRun,
    RawInputRestorePlan, TextReplacementPlan,
};
use editor_core::document::Attribute;
use editor_core::transaction::WorkLimits;

#[derive(Clone, Copy, Debug)]
enum Case {
    Normal,
    BadSource,
    BadAfter,
    RawTooLong,
    LateLimit,
    NoRaw,
    Noop,
    FailLiteral,
}
#[derive(Clone, Debug)]
struct InputIntent<I> {
    block: I,
    original: Selection<I>,
    edit: Selection<I>,
    case: Case,
}
struct InputFixture {
    base: FixtureProfile,
    enabled: bool,
    rules: Rc<Cell<usize>>,
    literal: Rc<Cell<usize>>,
}
impl InputFixture {
    fn new(text: Option<&str>, join: bool) -> Self {
        let mut base = FixtureProfile::new(text.unwrap_or(""), false);
        if text.is_none() {
            base.initial.children[0].children.clear();
        }
        base.join = join;
        Self {
            base,
            enabled: true,
            rules: Rc::new(Cell::new(0)),
            literal: Rc::new(Cell::new(0)),
        }
    }
}
impl FrozenProfile for InputFixture {
    type Context = ();
    type Admitted = Document;
    type Error = &'static str;
    type Cache<I: Copy + Eq + Ord> = ();
    fn binding(&self) -> &ProfileBinding {
        self.base.binding()
    }
    fn admit_bytes(
        &self,
        b: &ProfileBinding,
        v: &[u8],
        m: AdmissionMode,
    ) -> Result<Document, Self::Error> {
        self.base.admit_bytes(b, v, m)
    }
    fn context(&self, _: &Document) {}
    fn to_document(&self, d: &Document) -> Document {
        d.clone()
    }
    fn admit_snapshot(&self, c: &(), d: &Document) -> Result<Document, Self::Error> {
        self.base.admit_snapshot(c, d)
    }
    fn canonical<'a>(&self, d: &'a Document) -> &'a [u8] {
        self.base.canonical(d)
    }
}
impl TransactionProfile for InputFixture {
    fn normalize_candidate<V: CandidateRead>(
        &self,
        c: &(),
        v: &V,
        w: &mut WorkMeter,
    ) -> Result<Vec<Operation<V::Id>>, Self::Error> {
        self.base.normalize_candidate(c, v, w)
    }
    fn validate_candidate<V: CandidateRead>(
        &self,
        c: &(),
        v: &V,
        w: &mut WorkMeter,
    ) -> Result<ValidationStats, Self::Error> {
        self.base.validate_candidate(c, v, w)
    }
}
fn local<I: Copy>(p: Position<I>) -> Position<LocalRef<I>> {
    match p {
        Position::Text {
            leaf,
            utf16,
            affinity,
        } => Position::Text {
            leaf: leaf.into(),
            utf16,
            affinity,
        },
        Position::Child {
            parent,
            index,
            affinity,
        } => Position::Child {
            parent: parent.into(),
            index,
            affinity,
        },
        Position::Edge { node, side } => Position::Edge {
            node: node.into(),
            side,
        },
    }
}
impl CommandProvider for InputFixture {
    type Intent<I: Copy + Eq + Ord> = InputIntent<I>;
    const COMMANDS: &'static [CommandDescriptor] = &[CommandDescriptor {
        id: "org.example.commands/input",
    }];
    fn command_id<I: Copy + Eq + Ord>(_: &InputIntent<I>) -> &str {
        Self::COMMANDS[0].id
    }
    fn supports_input_command<I: Copy + Eq + Ord>(&self, _: &InputIntent<I>) -> bool {
        self.enabled
    }
    fn prepare_command<V: CandidateRead>(
        &self,
        c: &(),
        v: &V,
        s: CommandState<'_, V::Id>,
        i: &InputIntent<V::Id>,
        p: &mut PlanBuilder<'_, V::Id>,
    ) -> Result<CommandPresentation, Self::Error> {
        self.prepare_input_command(c, v, s, i, InputCommandPolicy::AllowRules, p)
    }
    fn prepare_input_command<V: CandidateRead>(
        &self,
        _: &(),
        _: &V,
        state: CommandState<'_, V::Id>,
        i: &InputIntent<V::Id>,
        policy: InputCommandPolicy,
        p: &mut PlanBuilder<'_, V::Id>,
    ) -> Result<CommandPresentation, Self::Error> {
        let literal = policy == InputCommandPolicy::LiteralOnly;
        if literal {
            self.literal.set(self.literal.get() + 1);
        } else {
            self.rules.set(self.rules.get() + 1);
        }
        if literal && matches!(i.case, Case::FailLiteral) {
            p.work()
                .charge_bytes(u64::MAX)
                .map_err(|_| "fixture.work")?;
        }
        if matches!(i.case, Case::Noop) {
            return Ok(CommandPresentation::default());
        }
        let text = if literal { "X" } else { "Y" };
        let inserted = leaf_node(
            &p.charged_copy_text(text).map_err(|_| "fixture.work")?,
            vec![],
        );
        p.work()
            .charge_bytes(std::mem::size_of::<Node>() as u64)
            .map_err(|_| "fixture.work")?;
        let edit = if literal { i.original } else { i.edit };
        let op = p
            .push(Operation::ReplaceInlineFragment {
                range: Selection {
                    anchor: local(edit.anchor),
                    focus: local(edit.focus),
                },
                fragment: Document {
                    children: vec![inserted],
                },
            })
            .map_err(|_| "fixture.work")?;
        let created = |offset| Position::Text {
            leaf: LocalRef::Created {
                operation: op,
                path: vec![0],
            },
            utf16: Utf16Offset::new(offset),
            affinity: Affinity::After,
        };
        p.set_selection(SelectionIntent::MapFromUserResult(Some(Selection {
            anchor: created(1),
            focus: created(1),
        })))
        .map_err(|_| "fixture.work")?;
        if !literal {
            let raw = if matches!(i.case, Case::RawTooLong) {
                "ABCDEFGHIJKLM"
            } else {
                "X"
            };
            let mut attrs = Attributes::new();
            if matches!(i.case, Case::LateLimit | Case::FailLiteral) {
                attrs.insert("cost".into(), Attribute::String("m".repeat(5000)));
                p.work().charge_bytes(5004).map_err(|_| "fixture.work")?;
            }
            let result = TextReplacementPlan {
                original: InputOriginal {
                    origin: InputOrigin::OrdinaryInsertText,
                    selection: if matches!(i.case, Case::BadSource) {
                        i.edit
                    } else {
                        state.selection.copied().ok_or("fixture.selection")?
                    },
                    text: p.charged_copy_text("X").map_err(|_| "fixture.work")?,
                },
                before: InputSourceRegion {
                    block: i.block,
                    range: i.edit,
                },
                after_range: if matches!(i.case, Case::BadAfter) {
                    Selection {
                        anchor: local(i.original.anchor),
                        focus: local(i.original.focus),
                    }
                } else {
                    Selection {
                        anchor: created(0),
                        focus: created(1),
                    }
                },
                raw_restore: if matches!(i.case, Case::NoRaw) {
                    None
                } else {
                    Some(RawInputRestorePlan {
                        raw: vec![InputTextRun {
                            type_id: p
                                .charged_copy_text("org.example.commands/text")
                                .map_err(|_| "fixture.work")?,
                            attributes: attrs,
                            marks: vec![],
                            text: p.charged_copy_text(raw).map_err(|_| "fixture.work")?,
                        }],
                        raw_caret_utf16: Utf16Offset::new(raw.len()),
                        raw_stored_marks: None,
                    })
                },
            };
            p.set_input_result(result).map_err(|_| "fixture.work")?;
        }
        Ok(CommandPresentation::default())
    }
    fn finalize_typing_override<V: CandidateRead>(
        &self,
        c: &(),
        v: &V,
        s: Option<Selection<V::Id>>,
        m: Option<&[Mark]>,
        w: &mut WorkMeter,
    ) -> Result<Option<Vec<Mark>>, Self::Error> {
        self.base.finalize_typing_override(c, v, s, m, w)
    }
    fn error_code(e: &Self::Error) -> &'static str {
        e
    }
}
fn fixture(
    text: Option<&str>,
    join: bool,
    access: AccessMode,
) -> (
    Session<InputFixture>,
    NodeId,
    Option<NodeId>,
    Rc<Cell<usize>>,
    Rc<Cell<usize>>,
) {
    let p = InputFixture::new(text, join);
    let r = p.rules.clone();
    let l = p.literal.clone();
    let b = p.binding().clone();
    let mut s = Session::open(p, &b, b"", AdmissionMode::Strict, access).unwrap();
    let block = s.tree.node(s.tree.root()).unwrap().children()[0];
    let leaf = s.tree.node(block).unwrap().children().first().copied();
    let at = if let Some(leaf) = leaf {
        Position::Text {
            leaf,
            utf16: Utf16Offset::new(text.unwrap().encode_utf16().count()),
            affinity: Affinity::After,
        }
    } else {
        Position::Child {
            parent: block,
            index: 0,
            affinity: Affinity::After,
        }
    };
    s.set_selection(
        s.key(),
        0,
        Selection {
            anchor: at,
            focus: at,
        },
    )
    .unwrap();
    (s, block, leaf, r, l)
}
fn request(
    s: &Session<InputFixture>,
    block: NodeId,
    case: Case,
) -> CommandRequest<InputIntent<NodeId>> {
    let selected = s.selection(s.key()).unwrap().unwrap();
    let mut r = CommandRequest::new(
        s.key(),
        s.revision(),
        s.selection_epoch(),
        InputIntent {
            block,
            original: selected,
            edit: selected,
            case,
        },
    );
    r.history_epoch = Some(s.history_summary().epoch);
    r
}
fn changed(
    result: InputCommandOutcome<&'static str>,
) -> (CommitEvent, Option<TextReplacementResult>) {
    match result {
        InputCommandOutcome::Completed {
            outcome: DispatchOutcome::Changed(event),
            result,
            ..
        } => (event, result),
        other => panic!("expected changed: {other:?}"),
    }
}
fn unchanged(s: &Session<InputFixture>, tree: &Document, stamp: crate::events::SessionStamp) {
    assert_eq!(&s.tree.document(), tree);
    assert_eq!(s.stamp(), stamp);
}

#[test]
fn gr01_created_child_source_has_exact_final_result() {
    let (mut s, b, _, _, _) = fixture(None, false, AccessMode::Editable);
    let q = request(&s, b, Case::Normal);
    let (event, result) = changed(s.execute_input_command(&q));
    let r = result.unwrap();
    let id = r.after.spans[0].node;
    assert_eq!(s.node(s.key(), id).unwrap().text(), Some("Y"));
    assert_eq!(r.after.spans[0].from_utf16, 0);
    assert_eq!(r.after.spans[0].to_utf16, 1);
    assert_eq!(r.after.spans[0].text, "Y");
    assert_eq!(r.raw_restore.as_ref().unwrap().raw[0].text, "X");
    assert_eq!(
        (
            s.revision(),
            s.selection_epoch(),
            s.history_summary().epoch,
            s.history_summary().undo_units
        ),
        (1, 2, 1, 1)
    );
    assert_eq!(r.after_stamp, s.stamp());
    assert_eq!(event.revision, 1);
}
#[test]
fn gr02_normalization_maps_created_span_to_surviving_old_text() {
    let (mut s, b, old, _, _) = fixture(Some("A"), true, AccessMode::Editable);
    let q = request(&s, b, Case::Normal);
    let (_, r) = changed(s.execute_input_command(&q));
    let r = r.unwrap();
    assert_eq!(r.after.spans[0].node, old.unwrap());
    assert_eq!(
        (r.after.spans[0].from_utf16, r.after.spans[0].to_utf16),
        (1, 2)
    );
    assert_eq!(r.after.spans[0].text, "Y");
    assert_eq!(s.node(s.key(), old.unwrap()).unwrap().text(), Some("AY"));
}
#[test]
fn gr03_original_interior_egc_refuses_even_with_safe_widened_range() {
    let (mut s, b, leaf, _, _) = fixture(Some("e\u{301}"), false, AccessMode::Editable);
    let leaf = leaf.unwrap();
    let p = |n| Position::Text {
        leaf,
        utf16: Utf16Offset::new(n),
        affinity: Affinity::After,
    };
    s.set_selection(
        s.key(),
        0,
        Selection {
            anchor: p(1),
            focus: p(1),
        },
    )
    .unwrap();
    let mut q = request(&s, b, Case::Normal);
    q.intent.edit = Selection {
        anchor: p(0),
        focus: p(2),
    };
    let tree = s.tree.document();
    let stamp = s.stamp();
    assert!(matches!(
        s.execute_input_command(&q),
        InputCommandOutcome::Refused {
            error: CommandError::InputResult(InputResultError::Tree(TreeError::Position(_))),
            ..
        }
    ));
    unchanged(&s, &tree, stamp);
}
#[test]
fn gr04_wrong_original_source_refuses() {
    let (mut s, b, leaf, _, _) = fixture(Some("AB"), false, AccessMode::Editable);
    let mut q = request(&s, b, Case::BadSource);
    let p = Position::Text {
        leaf: leaf.unwrap(),
        utf16: Utf16Offset::new(0),
        affinity: Affinity::After,
    };
    q.intent.edit = Selection {
        anchor: p,
        focus: p,
    };
    let stamp = s.stamp();
    let tree = s.tree.document();
    assert!(matches!(
        s.execute_input_command(&q),
        InputCommandOutcome::Refused { .. }
    ));
    unchanged(&s, &tree, stamp);
}
#[test]
fn gr05_unrelated_final_source_is_not_result_authority() {
    let (mut s, b, _, _, _) = fixture(Some("AB"), false, AccessMode::Editable);
    let q = request(&s, b, Case::BadAfter);
    let stamp = s.stamp();
    let tree = s.tree.document();
    assert!(matches!(
        s.execute_input_command(&q),
        InputCommandOutcome::Refused {
            error: CommandError::InputResult(InputResultError::Invalid),
            ..
        }
    ));
    unchanged(&s, &tree, stamp);
}
#[test]
fn gr06_query_is_pure_and_emits_only_availability() {
    let (mut s, b, _, _, _) = fixture(None, false, AccessMode::Editable);
    let q = request(&s, b, Case::Normal);
    let stamp = s.stamp();
    let tree = s.tree.document();
    for _ in 0..2 {
        assert!(matches!(
            s.query_input_command(&q),
            CommandAvailability::Available {
                effect: CommandEffect::Changed,
                ..
            }
        ));
    }
    unchanged(&s, &tree, stamp);
    let (_, r) = changed(s.execute_input_command(&q));
    assert!(r.is_some());
}
#[test]
fn gr07_local_raw_limit_selects_one_literal_without_rematching() {
    let (mut s, b, _, rules, literal) = fixture(None, false, AccessMode::Editable);
    let q = request(&s, b, Case::RawTooLong);
    let (_, r) = changed(s.execute_input_command(&q));
    assert!(r.is_none());
    assert_eq!((rules.get(), literal.get()), (1, 1));
    let id = s.node(s.key(), b).unwrap().children()[0];
    assert_eq!(s.node(s.key(), id).unwrap().text(), Some("X"));
    assert_eq!(s.history_summary().undo_units, 1);
}
#[test]
fn gr08_global_limit_never_uses_literal_fallback() {
    let (mut s, b, _, rules, literal) = fixture(None, false, AccessMode::Editable);
    let mut q = request(&s, b, Case::Normal);
    q.limits.work = WorkLimits { units: 0, bytes: 0 };
    let tree = s.tree.document();
    let stamp = s.stamp();
    assert!(matches!(
        s.execute_input_command(&q),
        InputCommandOutcome::Refused {
            error: CommandError::Transaction(TransactionError::Limit(_)),
            ..
        }
    ));
    assert_eq!((rules.get(), literal.get()), (0, 0));
    unchanged(&s, &tree, stamp);
}
#[test]
fn gr09_late_capacity_failure_preserves_spent_meter() {
    let (mut s, b, _, rules, literal) = fixture(None, false, AccessMode::Editable);
    let q = request(&s, b, Case::LateLimit);
    let (e, r) = changed(s.execute_input_command(&q));
    assert!(r.is_none());
    assert_eq!((rules.get(), literal.get()), (1, 1));
    let (mut control, cb, _, _, _) = fixture(None, false, AccessMode::Editable);
    let cq = request(&control, cb, Case::RawTooLong);
    let (c, _) = changed(control.execute_input_command(&cq));
    assert!(e.work.bytes > c.work.bytes);
    assert_eq!(s.history_summary().undo_units, 1);
}
#[test]
fn gr10_readonly_refuses_without_publication() {
    let (mut s, b, _, _, _) = fixture(None, false, AccessMode::ReadOnly);
    let q = request(&s, b, Case::Normal);
    let tree = s.tree.document();
    let stamp = s.stamp();
    assert!(matches!(
        s.execute_input_command(&q),
        InputCommandOutcome::Refused { .. }
    ));
    unchanged(&s, &tree, stamp);
}
#[test]
fn gr11_old_entry_cannot_publish_and_drop_result() {
    let (mut s, b, _, _, _) = fixture(None, false, AccessMode::Editable);
    let q = request(&s, b, Case::Normal);
    let tree = s.tree.document();
    let stamp = s.stamp();
    assert!(matches!(
        s.query_command(&q),
        CommandAvailability::Unavailable {
            error: CommandError::InputRouteRequired,
            ..
        }
    ));
    assert!(matches!(
        s.execute_command(&q),
        CommandOutcome::Refused {
            error: CommandError::InputRouteRequired,
            ..
        }
    ));
    unchanged(&s, &tree, stamp);
}
#[test]
fn gr12_default_provider_rejects_input_before_preparation() {
    let (mut s, b, _, rules, literal) = fixture(None, false, AccessMode::Editable);
    s.profile.enabled = false;
    let q = request(&s, b, Case::Normal);
    assert!(matches!(
        s.execute_input_command(&q),
        InputCommandOutcome::Refused {
            error: CommandError::InputUnsupported,
            ..
        }
    ));
    assert_eq!((rules.get(), literal.get()), (0, 0));
}
#[test]
fn gr13_nonisolated_input_cannot_join_history() {
    let (mut s, b, _, _, _) = fixture(None, false, AccessMode::Editable);
    let mut q = request(&s, b, Case::Normal);
    q.history_hint = HistoryHint::Typing {
        token: 1,
        class: crate::TypingClass::Insert,
    };
    let tree = s.tree.document();
    let stamp = s.stamp();
    assert!(matches!(
        s.execute_input_command(&q),
        InputCommandOutcome::Refused { .. }
    ));
    unchanged(&s, &tree, stamp);
}
#[test]
fn gr14_correspondence_result_can_omit_special_reversal() {
    let (mut s, b, _, _, _) = fixture(None, false, AccessMode::Editable);
    let q = request(&s, b, Case::NoRaw);
    let (_, r) = changed(s.execute_input_command(&q));
    assert!(r.unwrap().raw_restore.is_none());
}
#[test]
fn gr15_failed_literal_branch_is_not_retried_or_published() {
    let (mut s, b, _, rules, literal) = fixture(None, false, AccessMode::Editable);
    let q = request(&s, b, Case::FailLiteral);
    let tree = s.tree.document();
    let stamp = s.stamp();
    assert!(matches!(
        s.execute_input_command(&q),
        InputCommandOutcome::Refused { .. }
    ));
    assert_eq!((rules.get(), literal.get()), (1, 1));
    unchanged(&s, &tree, stamp);
}
#[test]
fn gr16_unchanged_completion_never_has_a_result() {
    let (mut s, b, _, _, _) = fixture(None, false, AccessMode::Editable);
    let q = request(&s, b, Case::Noop);
    assert!(matches!(
        s.execute_input_command(&q),
        InputCommandOutcome::Completed {
            outcome: DispatchOutcome::Unchanged { .. },
            result: None,
            ..
        }
    ));
    assert_eq!(s.revision(), 0);
    assert_eq!(s.history_summary().undo_units, 0);
}

#[test]
fn gr17_final_restore_boundary_uses_literal_without_publishing_candidate() {
    // Source-authored before execution: the original block-start caret is a
    // valid EGC boundary, while Y + standalone combining acute forms one EGC.
    // A cooked range ending after Y is scalar-valid but cannot be restored by
    // a user splice. Only the optional restoration representation falls back.
    let (mut s, b, leaf, rules, literal) = fixture(Some("\u{301}"), true, AccessMode::Editable);
    let at = Position::Text {
        leaf: leaf.unwrap(),
        utf16: Utf16Offset::new(0),
        affinity: Affinity::After,
    };
    s.set_selection(
        s.key(),
        0,
        Selection {
            anchor: at,
            focus: at,
        },
    )
    .unwrap();
    let before = s.stamp();
    let q = request(&s, b, Case::Normal);
    let (_, result) = changed(s.execute_input_command(&q));
    assert!(result.is_none());
    assert_eq!((rules.get(), literal.get()), (1, 1));
    let text = s.node(s.key(), b).unwrap().children()[0];
    assert_eq!(s.node(s.key(), text).unwrap().text(), Some("X\u{301}"));
    assert_eq!(s.revision(), before.revision + 1);
    assert_eq!(s.history_summary().undo_units, 1);

    // Correspondence without raw restoration is not an EGC splice promise.
    let (mut s, b, leaf, rules, literal) = fixture(Some("\u{301}"), true, AccessMode::Editable);
    let at = Position::Text {
        leaf: leaf.unwrap(),
        utf16: Utf16Offset::new(0),
        affinity: Affinity::After,
    };
    s.set_selection(
        s.key(),
        0,
        Selection {
            anchor: at,
            focus: at,
        },
    )
    .unwrap();
    let q = request(&s, b, Case::NoRaw);
    let (_, result) = changed(s.execute_input_command(&q));
    let result = result.unwrap();
    assert!(result.raw_restore.is_none());
    assert_eq!(result.after.spans[0].text, "Y");
    assert_eq!((rules.get(), literal.get()), (1, 0));
}
