// SPDX-License-Identifier: MIT OR Apache-2.0
//! Source-authored flat-splice expectations. These generic fixture types are
//! not KWDJ admission, clipboard decode or mounted/native-clipboard evidence.

use super::*;
use crate::{
    AccessMode, DispatchOutcome, HistoryDirection, HistoryHint, HistoryOutcome, HistoryRequest,
    Session, Transaction, TypingClass,
};
use editor_core::commands::{LocalRef, PlanBuilder, SelectionIntent};
use editor_core::history::HistoryProfile;
use editor_core::profile::{AdmissionMode, FrozenProfile, ProfileBinding};
use editor_core::transaction::{TransactionProfile, ValidationStats, WorkLimits};

fn text(value: &str, marks: Vec<Mark>) -> Node {
    Node {
        type_id: "org.example.fragment/text".into(),
        primitive: Primitive::Text,
        attributes: Attributes::new(),
        marks,
        text: Some(value.into()),
        children: vec![],
    }
}
fn marked(name: &str) -> Vec<Mark> {
    vec![Mark {
        type_id: format!("org.example.fragment/{name}"),
        attributes: Attributes::new(),
    }]
}
fn hard_break() -> Node {
    Node {
        type_id: "org.example.fragment/break".into(),
        primitive: Primitive::HardBreak,
        attributes: Attributes::new(),
        marks: vec![],
        text: None,
        children: vec![],
    }
}
fn atom() -> Node {
    Node {
        type_id: "org.example.fragment/atom".into(),
        primitive: Primitive::InlineAtom,
        attributes: Attributes::from([("label".into(), Attribute::String("object".into()))]),
        marks: vec![],
        text: None,
        children: vec![],
    }
}
fn block(children: Vec<Node>) -> Node {
    Node {
        type_id: "org.example.fragment/paragraph".into(),
        primitive: Primitive::TextBlock,
        attributes: Attributes::new(),
        marks: vec![],
        text: None,
        children,
    }
}
fn forest(children: Vec<Node>) -> Document {
    Document { children }
}
fn rich() -> Document {
    let link = Mark {
        type_id: "org.example.fragment/link".into(),
        attributes: Attributes::from([(
            "href".into(),
            Attribute::String("https://example.test/".into()),
        )]),
    };
    forest(vec![
        text("X", marked("strong")),
        hard_break(),
        atom(),
        text("Y", vec![link]),
    ])
}
fn tree(children: Vec<Node>) -> AddressTree {
    AddressTree::from_document(
        SessionKey::allocate().unwrap(),
        forest(vec![block(children), block(vec![])]),
    )
    .unwrap()
}
fn parents(tree: &AddressTree) -> (NodeId, NodeId) {
    let roots = tree.node(tree.root()).unwrap().children();
    (roots[0], roots[1])
}
fn point<I>(leaf: I, offset: usize) -> Position<I> {
    Position::Text {
        leaf,
        utf16: Utf16Offset::new(offset),
        affinity: Affinity::After,
    }
}
fn gap<I>(parent: I, index: usize) -> Position<I> {
    Position::Child {
        parent,
        index,
        affinity: Affinity::After,
    }
}
fn selection<I>(anchor: Position<I>, focus: Position<I>) -> Selection<I> {
    Selection { anchor, focus }
}
fn meter() -> WorkMeter {
    WorkMeter::new(WorkLimits::default())
}
fn assert_pristine(draft: &TreeDraft<'_>, before: &Document) {
    assert_eq!(&draft.candidate_document(), before);
    assert_eq!(draft.written_nodes(), 0);
    assert!(draft.removed.is_empty());
    assert!(draft.steps().is_empty());
    assert!(draft.inverse.is_empty());
    assert_eq!(draft.inverse_steps, 0);
    assert_eq!(draft.prepared_copy_bytes(), 0);
}

#[test]
fn rich_forest_preserves_literal_metadata_and_returns_only_roots_in_source_order() {
    for reverse in [false, true] {
        let base = tree(vec![text("abcd", vec![])]);
        let (parent, other) = parents(&base);
        let leaf = base.node(parent).unwrap().children()[0];
        let other_before = base.node(other).unwrap().clone();
        let payload = rich();
        let payload_before = payload.clone();
        let mut draft = base.prepare();
        let a = point(leaf, 1);
        let b = point(leaf, 3);
        let roots = draft
            .replace_inline_fragment(
                if reverse {
                    selection(b, a)
                } else {
                    selection(a, b)
                },
                &payload,
                &mut meter(),
            )
            .unwrap();
        let children = draft.node(parent).unwrap().children();
        assert_eq!(roots.len(), 4);
        assert_eq!(children.len(), 6);
        assert_eq!(children[0], leaf);
        assert_eq!(&children[1..5], roots.as_slice());
        assert_ne!(children[5], leaf);
        assert_eq!(draft.node(children[0]).unwrap().text(), Some("a"));
        assert_eq!(draft.node(children[5]).unwrap().text(), Some("d"));
        for (id, expected) in roots.iter().zip(&payload.children) {
            assert_eq!(draft.encode(*id), *expected);
            assert_eq!(draft.node(*id).unwrap().parent(), Some(parent));
        }
        assert_eq!(draft.node(other).unwrap(), &other_before);
        assert_eq!(payload, payload_before);
        draft.validate_structure(&mut meter()).unwrap();
    }
}

#[test]
fn original_barrier_authorizes_multi_leaf_splice_but_not_a_later_new_grapheme_gap() {
    let base = tree(vec![
        text("e", vec![]),
        hard_break(),
        text("\u{301}", marked("strong")),
    ]);
    let (parent, _) = parents(&base);
    let old = base.node(parent).unwrap().children();
    let payload = forest(vec![text("Q", marked("strong")), text("R", vec![])]);
    let mut draft = base.prepare();
    let roots = draft
        .replace_inline_fragment(
            selection(gap(parent, 1), gap(parent, 2)),
            &payload,
            &mut meter(),
        )
        .unwrap();
    assert_eq!(
        draft.node(parent).unwrap().children(),
        &[old[0], roots[0], roots[1], old[2]]
    );
    assert_eq!(draft.node(old[0]).unwrap().text(), Some("e"));
    assert_eq!(draft.node(old[2]).unwrap().text(), Some("\u{301}"));
    let before = draft.candidate_document();
    let high = base.next_id.get();
    assert_eq!(
        draft.replace_inline_fragment(
            selection(gap(parent, 3), gap(parent, 3)),
            &forest(vec![text("Z", vec![])]),
            &mut meter()
        ),
        Err(TreeError::Position(PositionError::NotGraphemeBoundary))
    );
    assert_eq!(draft.candidate_document(), before);
    assert_eq!(base.next_id.get(), high);
}

#[test]
fn original_styled_grapheme_interior_and_other_parent_refuse_without_writes_or_ids() {
    let base = tree(vec![
        text("e", vec![]),
        text("\u{301}", marked("strong")),
        text("!", vec![]),
    ]);
    let (parent, other) = parents(&base);
    let before = base.document();
    let high = base.next_id.get();
    for (range, expected) in [
        (
            selection(gap(parent, 1), gap(parent, 2)),
            TreeError::Position(PositionError::NotGraphemeBoundary),
        ),
        (
            selection(gap(parent, 0), gap(other, 0)),
            TreeError::InvalidStructure,
        ),
    ] {
        let mut draft = base.prepare();
        assert_eq!(
            draft.replace_inline_fragment(range, &rich(), &mut meter()),
            Err(expected)
        );
        assert_pristine(&draft, &before);
        assert_eq!(base.next_id.get(), high);
    }
    let mut draft = base.prepare();
    let roots = draft
        .replace_inline_fragment(
            selection(gap(parent, 0), gap(parent, 2)),
            &rich(),
            &mut meter(),
        )
        .unwrap();
    assert_eq!(roots.len(), 4);
    assert_eq!(draft.node(parent).unwrap().children().len(), 5);
}

#[test]
fn flat_forest_rejects_nested_block_and_incompatible_leaf_shapes_before_copying() {
    let base = tree(vec![text("abcd", vec![])]);
    let (parent, _) = parents(&base);
    let before = base.document();
    let high = base.next_id.get();
    let mut nested = text("hidden", vec![]);
    nested.children.push(text("child", vec![]));
    let mut missing = text("missing", vec![]);
    missing.text = None;
    let mut extra = hard_break();
    extra.text = Some("not-a-break".into());
    let mut unnamed = text("empty-type", vec![]);
    unnamed.type_id.clear();
    for node in [block(vec![]), nested, missing, extra, unnamed] {
        let payload = forest(vec![text("valid-first", vec![]), node]);
        let saved = payload.clone();
        let mut draft = base.prepare();
        assert_eq!(
            draft.replace_inline_fragment(
                selection(gap(parent, 0), gap(parent, 1)),
                &payload,
                &mut meter()
            ),
            Err(TreeError::InvalidStructure)
        );
        assert_pristine(&draft, &before);
        assert_eq!(base.next_id.get(), high);
        assert_eq!(payload, saved);
    }
}

#[test]
fn empty_forest_distinguishes_collapsed_noop_deletion_and_an_explicit_empty_text() {
    let base = tree(vec![text("abcd", vec![])]);
    let (parent, _) = parents(&base);
    let leaf = base.node(parent).unwrap().children()[0];
    let before = base.document();
    let high = base.next_id.get();
    let mut noop = base.prepare();
    assert_eq!(
        noop.replace_inline_fragment(
            selection(point(leaf, 2), point(leaf, 2)),
            &forest(vec![]),
            &mut meter()
        )
        .unwrap(),
        Vec::<NodeId>::new()
    );
    assert_pristine(&noop, &before);
    assert_eq!(base.next_id.get(), high);
    let mut erase = base.prepare();
    assert!(
        erase
            .replace_inline_fragment(
                selection(point(leaf, 1), point(leaf, 3)),
                &forest(vec![]),
                &mut meter()
            )
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        erase.candidate_document(),
        forest(vec![
            block(vec![text("a", vec![]), text("d", vec![])]),
            block(vec![])
        ])
    );
    let mut explicit = base.prepare();
    let roots = explicit
        .replace_inline_fragment(
            selection(gap(parent, 0), gap(parent, 0)),
            &forest(vec![text("", vec![])]),
            &mut meter(),
        )
        .unwrap();
    assert_eq!(roots.len(), 1);
    assert_eq!(explicit.node(roots[0]).unwrap().text(), Some(""));
    assert_eq!(explicit.node(parent).unwrap().children(), &[roots[0], leaf]);
}

#[test]
fn work_refusal_keeps_the_original_draft_and_borrowed_payload() {
    for limits in [
        WorkLimits {
            units: 1,
            bytes: 64 * 1024 * 1024,
        },
        WorkLimits {
            units: 1_000_000,
            bytes: 1,
        },
    ] {
        let base = tree(vec![text("abcd", vec![])]);
        let (parent, _) = parents(&base);
        let leaf = base.node(parent).unwrap().children()[0];
        let before = base.document();
        let high = base.next_id.get();
        let payload = rich();
        let saved = payload.clone();
        let mut draft = base.prepare();
        assert_eq!(
            draft.replace_inline_fragment(
                selection(point(leaf, 1), point(leaf, 3)),
                &payload,
                &mut WorkMeter::new(limits)
            ),
            Err(TreeError::ResourceLimit)
        );
        assert_pristine(&draft, &before);
        assert_eq!(base.next_id.get(), high);
        assert_eq!(payload, saved);
    }
    // Every individual leaf fits this cap. The complete borrowed forest does
    // not: accounting cannot reset per root or defer until after copying.
    let base = tree(vec![]);
    let (parent, _) = parents(&base);
    let before = base.document();
    let high = base.next_id.get();
    let payload = forest((0..64).map(|_| text("0123456789abcdef", vec![])).collect());
    let saved = payload.clone();
    let mut draft = base.prepare();
    let mut work = WorkMeter::new(WorkLimits {
        units: 1_000_000,
        bytes: 1024,
    });
    assert_eq!(
        draft.replace_inline_fragment(
            selection(gap(parent, 0), gap(parent, 0)),
            &payload,
            &mut work
        ),
        Err(TreeError::ResourceLimit)
    );
    assert_pristine(&draft, &before);
    assert_eq!(base.next_id.get(), high);
    assert_eq!(payload, saved);
}

#[test]
fn exhausted_forest_reservation_rolls_back_both_boundary_splits_without_rewinding_highwater() {
    let base = tree(vec![text("abcd", vec![])]);
    let (parent, _) = parents(&base);
    let leaf = base.node(parent).unwrap().children()[0];
    let before = base.document();
    base.next_id.set(u64::MAX - 3);
    let mut draft = base.prepare();
    assert_eq!(
        draft.replace_inline_fragment(
            selection(point(leaf, 1), point(leaf, 3)),
            &forest(vec![text("X", vec![]), text("Y", marked("strong"))]),
            &mut meter()
        ),
        Err(TreeError::CounterExhausted)
    );
    assert_eq!(base.next_id.get(), u64::MAX - 1);
    assert_pristine(&draft, &before);
    for serial in [u64::MAX - 3, u64::MAX - 2] {
        assert_eq!(
            draft.node(NodeId::new(base.key, serial)),
            Err(TreeError::MissingNode)
        );
    }
    // A later deletion on the same draft sees the original leaf, not ghosts.
    assert!(
        draft
            .replace_inline_fragment(
                selection(gap(parent, 0), gap(parent, 1)),
                &forest(vec![]),
                &mut meter()
            )
            .unwrap()
            .is_empty()
    );
    assert!(draft.node(parent).unwrap().children().is_empty());
    assert_eq!(base.next_id.get(), u64::MAX - 1);
}

#[test]
fn legacy_unmetered_operation_route_never_grants_forest_splice_authority() {
    let base = tree(vec![text("ab", vec![])]);
    let (parent, _) = parents(&base);
    let before = base.document();
    let high = base.next_id.get();
    for origin in [EditOrigin::User, EditOrigin::Normalization] {
        let mut draft = base.prepare();
        let operation = Operation::ReplaceInlineFragment {
            range: selection(gap(parent, 0), gap(parent, 1)),
            fragment: rich(),
        };
        assert_eq!(
            draft.apply_operation(&operation, origin),
            Err(TreeError::InvalidStructure)
        );
        assert_pristine(&draft, &before);
        assert_eq!(base.next_id.get(), high);
    }
}

#[test]
fn core_address_mapping_preserves_forest_and_planbuilder_checks_original_references() {
    let payload = rich();
    let operation = Operation::ReplaceInlineFragment {
        range: selection(point(1u32, 2), gap(2u32, 0)),
        fragment: payload.clone(),
    };
    let mapped = operation.try_map_ids(|id| Ok::<_, ()>(id + 10)).unwrap();
    assert_eq!(
        mapped,
        Operation::ReplaceInlineFragment {
            range: selection(point(11u32, 2), gap(12u32, 0)),
            fragment: payload
        }
    );
    let mut work = meter();
    let mut plan = PlanBuilder::<u32>::new(&mut work, 256);
    assert!(
        plan.push(Operation::ReplaceInlineFragment {
            range: selection(
                point(
                    LocalRef::Created {
                        operation: 0,
                        path: vec![0]
                    },
                    0
                ),
                point(LocalRef::Existing(1), 0)
            ),
            fragment: forest(vec![])
        })
        .is_err()
    );
    assert_eq!(plan.len(), 0);
}

#[test]
fn even_a_single_text_forest_has_no_legacy_typing_group_proof() {
    let base = tree(vec![text("ab", vec![])]);
    let (parent, _) = parents(&base);
    let leaf = base.node(parent).unwrap().children()[0];
    let range = selection(point(leaf, 0), point(leaf, 0));
    let hint = HistoryHint::Typing {
        token: 7,
        class: TypingClass::Insert,
    };
    assert!(
        crate::grouping::prepare::<_, ()>(
            &base,
            &Operation::ReplaceInlineRange {
                range,
                inserted: Some(text("X", vec![]))
            },
            hint,
            Some(range),
            None,
            &mut meter()
        )
        .unwrap()
        .is_some()
    );
    assert!(
        crate::grouping::prepare::<_, ()>(
            &base,
            &Operation::ReplaceInlineFragment {
                range,
                fragment: forest(vec![text("X", vec![])])
            },
            hint,
            Some(range),
            None,
            &mut meter()
        )
        .unwrap()
        .is_none()
    );
}

// A compiled generic transaction/history witness, not a clipboard provider.
struct FixtureProfile {
    binding: ProfileBinding,
    initial: Document,
    join: bool,
}
impl FrozenProfile for FixtureProfile {
    type Context = ();
    type Admitted = Document;
    type Error = &'static str;
    type Cache<I: Copy + Eq + Ord> = ();
    fn binding(&self) -> &ProfileBinding {
        &self.binding
    }
    fn admit_bytes(
        &self,
        requested: &ProfileBinding,
        _: &[u8],
        _: AdmissionMode,
    ) -> Result<Document, Self::Error> {
        self.binding
            .ensure_matches(requested)
            .map_err(|_| "fixture.binding")?;
        Ok(self.initial.clone())
    }
    fn context(&self, _: &Document) {}
    fn to_document(&self, document: &Document) -> Document {
        document.clone()
    }
    fn admit_snapshot(&self, _: &(), document: &Document) -> Result<Document, Self::Error> {
        Ok(document.clone())
    }
    fn canonical<'a>(&self, _: &'a Document) -> &'a [u8] {
        b"explicit generic fixture codec"
    }
}
impl TransactionProfile for FixtureProfile {
    fn normalize_candidate<V: CandidateRead>(
        &self,
        _: &(),
        view: &V,
        work: &mut WorkMeter,
    ) -> Result<Vec<Operation<V::Id>>, Self::Error> {
        if self.join {
            for root in view.roots() {
                let node = view.node(*root).ok_or("fixture.missing")?;
                for pair in node.children.windows(2) {
                    work.charge_units(2).map_err(|_| "fixture.work")?;
                    let a = view.node(pair[0]).ok_or("fixture.missing")?;
                    let b = view.node(pair[1]).ok_or("fixture.missing")?;
                    if a.primitive == Primitive::Text
                        && b.primitive == Primitive::Text
                        && a.attributes == b.attributes
                        && a.marks == b.marks
                    {
                        work.charge_bytes(std::mem::size_of::<Operation<V::Id>>() as u64)
                            .map_err(|_| "fixture.work")?;
                        return Ok(vec![Operation::JoinText {
                            left: pair[0],
                            right: pair[1],
                        }]);
                    }
                }
            }
        }
        Ok(vec![])
    }
    fn validate_candidate<V: CandidateRead>(
        &self,
        _: &(),
        view: &V,
        work: &mut WorkMeter,
    ) -> Result<ValidationStats, Self::Error> {
        let mut nodes = 0;
        for root in view.roots() {
            work.charge_units(1).map_err(|_| "fixture.work")?;
            nodes += 1;
            let n = view.node(*root).ok_or("fixture.missing")?;
            for id in n.children {
                work.charge_units(1).map_err(|_| "fixture.work")?;
                view.node(*id).ok_or("fixture.missing")?;
                nodes += 1;
            }
        }
        Ok(ValidationStats {
            canonical_bytes: 0,
            nodes,
        })
    }
}
impl HistoryProfile for FixtureProfile {
    fn finalize_history_typing<V: CandidateRead>(
        &self,
        _: &(),
        _: &V,
        _: Option<Selection<V::Id>>,
        saved: Option<&[Mark]>,
        _: &mut WorkMeter,
    ) -> Result<Option<Vec<Mark>>, Self::Error> {
        assert!(saved.is_none());
        Ok(None)
    }
    fn history_error_code(error: &&'static str) -> &'static str {
        error
    }
}
fn session(join: bool) -> Session<FixtureProfile> {
    let binding = ProfileBinding::new(
        "org.example.fragment",
        "1.0.0",
        "org.example.fragment/json",
        1,
        &[],
    )
    .unwrap();
    Session::open(
        FixtureProfile {
            binding: binding.clone(),
            initial: forest(vec![block(vec![text("abcd", vec![])])]),
            join,
        },
        &binding,
        b"fixture",
        AdmissionMode::Strict,
        AccessMode::Editable,
    )
    .unwrap()
}

#[test]
fn dispatch_created_root_paths_preserve_order_and_one_history_unit_with_exact_undo_redo() {
    let mut s = session(false);
    let key = s.key();
    let root = s.root(key).unwrap();
    let parent = s.node(key, root).unwrap().children()[0];
    let leaf = s.node(key, parent).unwrap().children()[0];
    let initial = selection(point(leaf, 1), point(leaf, 3));
    s.set_selection(key, 0, initial).unwrap();
    let before = s.prepare_tree(key, 0).unwrap().candidate_document();
    let before_epoch = s.selection_epoch();
    let mut tx = Transaction::new(
        key,
        0,
        vec![
            Operation::ReplaceInlineFragment {
                range: selection(
                    point(LocalRef::Existing(leaf), 1),
                    point(LocalRef::Existing(leaf), 3),
                ),
                fragment: rich(),
            },
            Operation::SetAttribute {
                node: LocalRef::Created {
                    operation: 0,
                    path: vec![2],
                },
                key: "proof".into(),
                value: Some(Attribute::Boolean(true)),
            },
        ],
    );
    tx.selection = SelectionIntent::MapFromUserResult(Some(selection(
        point(
            LocalRef::Created {
                operation: 0,
                path: vec![3],
            },
            1,
        ),
        point(
            LocalRef::Created {
                operation: 0,
                path: vec![3],
            },
            1,
        ),
    )));
    let DispatchOutcome::Changed(event) = s.dispatch(tx) else {
        panic!("expected one atomic forest commit")
    };
    assert_eq!(s.revision(), 1);
    assert_eq!(s.selection_epoch(), before_epoch + 1);
    assert_eq!(s.history_summary().undo_units, 1);
    assert_eq!(event.selection_before, Some(initial));
    let children = s.node(key, parent).unwrap().children().to_vec();
    assert_eq!(children.len(), 6);
    assert_eq!(children[0], leaf);
    assert_eq!(
        s.node(key, children[3]).unwrap().primitive(),
        Some(Primitive::InlineAtom)
    );
    assert_eq!(
        s.node(key, children[3])
            .unwrap()
            .attributes()
            .unwrap()
            .get("proof"),
        Some(&Attribute::Boolean(true))
    );
    assert_eq!(
        s.selection(key).unwrap(),
        Some(selection(point(children[4], 1), point(children[4], 1)))
    );
    let after = s.prepare_tree(key, 1).unwrap().candidate_document();
    let after_ids = children;
    for direction in [HistoryDirection::Undo, HistoryDirection::Redo] {
        let stamp = s.stamp();
        let request = HistoryRequest::new(
            key,
            stamp.revision,
            stamp.selection_epoch,
            stamp.history_epoch,
            direction,
        );
        assert!(matches!(
            s.execute_history(&request),
            HistoryOutcome::Completed(_)
        ));
        match direction {
            HistoryDirection::Undo => {
                assert_eq!(
                    s.prepare_tree(key, s.revision())
                        .unwrap()
                        .candidate_document(),
                    before
                );
                assert_eq!(s.selection(key).unwrap(), Some(initial));
                assert_eq!(s.node(key, parent).unwrap().children(), &[leaf]);
            }
            HistoryDirection::Redo => {
                assert_eq!(
                    s.prepare_tree(key, s.revision())
                        .unwrap()
                        .candidate_document(),
                    after
                );
                assert_eq!(
                    s.node(key, parent).unwrap().children(),
                    after_ids.as_slice()
                );
                assert_eq!(
                    s.selection(key).unwrap(),
                    Some(selection(point(after_ids[4], 1), point(after_ids[4], 1)))
                );
            }
        }
    }
}

#[test]
fn created_final_caret_is_mapped_through_normalization_that_retires_inserted_roots() {
    let mut s = session(true);
    let key = s.key();
    let root = s.root(key).unwrap();
    let parent = s.node(key, root).unwrap().children()[0];
    let leaf = s.node(key, parent).unwrap().children()[0];
    let mut tx = Transaction::new(
        key,
        0,
        vec![Operation::ReplaceInlineFragment {
            range: selection(
                point(LocalRef::Existing(leaf), 1),
                point(LocalRef::Existing(leaf), 3),
            ),
            fragment: forest(vec![text("X", vec![]), text("Y", vec![])]),
        }],
    );
    tx.selection = SelectionIntent::MapFromUserResult(Some(selection(
        point(
            LocalRef::Created {
                operation: 0,
                path: vec![1],
            },
            1,
        ),
        point(
            LocalRef::Created {
                operation: 0,
                path: vec![1],
            },
            1,
        ),
    )));
    let DispatchOutcome::Changed(event) = s.dispatch(tx) else {
        panic!("expected normalized forest commit")
    };
    assert_eq!(event.normalization_operations, 3);
    assert_eq!(s.node(key, parent).unwrap().children(), &[leaf]);
    assert_eq!(s.node(key, leaf).unwrap().text(), Some("aXYd"));
    assert_eq!(
        s.selection(key).unwrap(),
        Some(selection(point(leaf, 3), point(leaf, 3)))
    );
    assert_eq!(s.history_summary().undo_units, 1);
}
