// SPDX-License-Identifier: MIT OR Apache-2.0
// Fixture-profile isolation tests; real KWDJ composition has separate witnesses.

mod transactions {

    use super::*;
    use crate::mapping::{MapResult, PositionMap};
    use crate::transaction::{
        DispatchOutcome, NodeRef, SelectionUpdate, Transaction, TransactionError,
    };
    use editor_core::candidate::CandidateRead;
    use editor_core::document::{Attribute, Mark};
    use editor_core::transaction::{Operation, TransactionProfile, ValidationStats, WorkMeter};

    impl TransactionProfile for FixtureProfile {
        fn normalize_candidate<V: CandidateRead>(
            &self,
            _: &(),
            candidate: &V,
            work: &mut WorkMeter,
        ) -> Result<Vec<Operation<V::Id>>, Self::Error> {
            fn visit<V: CandidateRead>(
                candidate: &V,
                id: V::Id,
                work: &mut WorkMeter,
            ) -> Result<Vec<Operation<V::Id>>, &'static str> {
                work.charge_units(1).map_err(|_| "budget")?;
                let node = candidate.node(id).ok_or("missing")?;
                if node.attributes.contains_key("_normalize") {
                    return Ok(vec![Operation::SetAttribute {
                        node: id,
                        key: "_normalize".into(),
                        value: None,
                    }]);
                }
                if node.attributes.contains_key("_loop") {
                    return Ok(vec![Operation::SetAttribute {
                        node: id,
                        key: "_loop".into(),
                        value: Some(Attribute::Boolean(true)),
                    }]);
                }
                for id in node.children {
                    let operations = visit(candidate, *id, work)?;
                    if !operations.is_empty() {
                        return Ok(operations);
                    }
                }
                Ok(vec![])
            }
            for id in candidate.roots() {
                let operations = visit(candidate, *id, work)?;
                if !operations.is_empty() {
                    return Ok(operations);
                }
            }
            Ok(vec![])
        }
        fn validate_candidate<V: CandidateRead>(
            &self,
            _: &(),
            candidate: &V,
            work: &mut WorkMeter,
        ) -> Result<ValidationStats, Self::Error> {
            fn visit<V: CandidateRead>(
                candidate: &V,
                id: V::Id,
                work: &mut WorkMeter,
                count: &mut u64,
            ) -> Result<(), &'static str> {
                work.charge_units(1).map_err(|_| "budget")?;
                let node = candidate.node(id).ok_or("missing")?;
                if node.attributes.contains_key("_reject") || node.type_id.ends_with("/invalid") {
                    return Err("fixture refused");
                }
                *count += 1;
                for id in node.children {
                    visit(candidate, *id, work, count)?;
                }
                Ok(())
            }
            if candidate.roots().is_empty() {
                return Err("empty root");
            }
            let mut count = 0;
            for id in candidate.roots() {
                visit(candidate, *id, work, &mut count)?;
            }
            Ok(ValidationStats {
                nodes: count,
                canonical_bytes: 0,
            })
        }
    }
    fn transaction(
        s: &Session<FixtureProfile>,
        operations: Vec<Operation<NodeRef>>,
    ) -> Transaction {
        Transaction::new(s.key(), s.revision(), operations)
    }
    fn replace(id: NodeId, from: usize, to: usize, inserted: &str) -> Operation<NodeRef> {
        Operation::ReplaceText {
            leaf: id.into(),
            from: Utf16Offset::new(from),
            to: Utf16Offset::new(to),
            inserted: inserted.into(),
        }
    }
    fn attr(id: NodeId, key: &str, value: Option<Attribute>) -> Operation<NodeRef> {
        Operation::SetAttribute {
            node: id.into(),
            key: key.into(),
            value,
        }
    }
    fn changed(
        s: &mut Session<FixtureProfile>,
        transaction: Transaction,
    ) -> crate::transaction::CommitEvent {
        match s.dispatch(transaction) {
            DispatchOutcome::Changed(event) => event,
            other => panic!("expected change: {other:?}"),
        }
    }

    #[test]
    fn coherent_commit_maps_selection_metadata_and_owns_sparse_journal() {
        let (mut s, calls) = open(AccessMode::Editable);
        let id = leaf(&s);
        let key = s.key();
        let paragraph = s.node(key, id).unwrap().parent().unwrap();
        s.set_selection(
            key,
            0,
            Selection {
                anchor: text(id, 4),
                focus: text(id, 2),
            },
        )
        .unwrap();
        let request = transaction(
            &s,
            vec![
                replace(id, 0, 2, "Q"),
                attr(paragraph, "domain", Some(Attribute::String("kept".into()))),
                Operation::SetMarks {
                    leaf: id.into(),
                    marks: vec![Mark {
                        type_id: "org.example.fixture/strong".into(),
                        attributes: Attributes::new(),
                    }],
                },
            ],
        );
        let event = changed(&mut s, request);
        assert_eq!(s.node(key, id).unwrap().text(), Some("Q😀"));
        assert_eq!(
            s.node(key, paragraph).unwrap().attributes().unwrap()["domain"],
            Attribute::String("kept".into())
        );
        assert_eq!(s.node(key, id).unwrap().marks().len(), 1);
        assert_eq!(s.revision(), 1);
        assert_eq!(s.selection_epoch(), 2);
        assert_eq!(
            s.selection(key).unwrap(),
            Some(Selection {
                anchor: text(id, 3),
                focus: text(id, 1)
            })
        );
        assert_eq!(event.selection_after, s.selection(key).unwrap());
        assert_eq!(event.revision, event.map.after());
        assert_eq!(event.journal, s.journal_summary());
        assert!(s.dirty());
        let journal = s.journal_entries();
        assert_eq!(journal.len(), 1);
        assert_eq!(
            (
                journal[0].before_records,
                journal[0].after_records,
                journal[0].changed_records
            ),
            (2, 2, 2)
        );
        assert_eq!(
            s.map_position(key, 0, text(id, 4)).unwrap(),
            MapResult::Mapped(text(id, 3))
        );
        assert_eq!(
            calls.get(),
            1,
            "dispatch must not call any full snapshot admission/decoder"
        );
    }

    #[test]
    fn every_late_refusal_preserves_all_committed_observables_and_prior_owned_history() {
        let (mut s, calls) = open(AccessMode::Editable);
        let id = leaf(&s);
        let key = s.key();
        let request = transaction(&s, vec![replace(id, 0, 2, "a")]);
        changed(&mut s, request);
        s.set_selection(
            key,
            1,
            Selection {
                anchor: text(id, 3),
                focus: text(id, 1),
            },
        )
        .unwrap();
        for i in 0..128 {
            let before = (
                s.tree.document(),
                s.revision(),
                s.selection(key).unwrap(),
                s.selection_epoch(),
                s.dirty(),
                s.journal_summary(),
                s.journal_entries(),
            );
            let inserted = format!("case-{i}-Жe\u{301}😀");
            let mut request = transaction(&s, vec![replace(id, 0, 1, &inserted)]);
            if i % 2 == 0 {
                request
                    .operations
                    .push(attr(id, "_reject", Some(Attribute::Boolean(true))));
            } else {
                request.selection = SelectionUpdate::Set(Some(Selection {
                    anchor: Position::Text {
                        leaf: id.into(),
                        utf16: Utf16Offset::new(usize::MAX - i),
                        affinity: Affinity::After,
                    },
                    focus: Position::Text {
                        leaf: id.into(),
                        utf16: Utf16Offset::new(0),
                        affinity: Affinity::After,
                    },
                }));
            }
            let outcome = s.dispatch(request);
            assert!(matches!(outcome, DispatchOutcome::Refused { .. }));
            if let DispatchOutcome::Refused { map, .. } = outcome {
                assert_eq!(map, PositionMap::identity(1));
            }
            assert_eq!(
                before,
                (
                    s.tree.document(),
                    s.revision(),
                    s.selection(key).unwrap(),
                    s.selection_epoch(),
                    s.dirty(),
                    s.journal_summary(),
                    s.journal_entries()
                )
            );
            assert_eq!(
                s.map_position(key, 0, text(id, 4)).unwrap(),
                MapResult::Mapped(text(id, 3))
            );
        }
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn net_noop_has_identity_map_no_revision_journal_or_dirty_and_allows_max_revision() {
        let (mut s, calls) = open(AccessMode::Editable);
        let id = leaf(&s);
        let key = s.key();
        s.set_selection(
            key,
            0,
            Selection {
                anchor: text(id, 4),
                focus: text(id, 2),
            },
        )
        .unwrap();
        s.revision = u64::MAX;
        let request = transaction(
            &s,
            vec![
                replace(id, 0, 2, "Q"),
                replace(id, 0, 1, "e\u{301}"),
                Operation::SplitText {
                    leaf: id.into(),
                    at: Utf16Offset::new(2),
                },
                Operation::JoinText {
                    left: id.into(),
                    right: NodeRef::Created {
                        operation: 2,
                        path: vec![0],
                    },
                },
            ],
        );
        assert!(matches!(
            s.dispatch(request),
            DispatchOutcome::Unchanged {
                revision: u64::MAX,
                selection_changed: false,
                ..
            }
        ));
        assert_eq!(s.node(key, id).unwrap().text(), Some("e\u{301}😀"));
        assert_eq!(s.selection_epoch(), 1);
        assert!(!s.dirty());
        assert_eq!(s.journal_summary().entries, 0);
        assert_eq!(calls.get(), 1);
        let request = transaction(&s, vec![replace(id, 0, 2, "Q")]);
        assert!(matches!(
            s.dispatch(request),
            DispatchOutcome::Refused {
                error: TransactionError::State(StateError::CounterExhausted),
                ..
            }
        ));
        assert_eq!(s.node(key, id).unwrap().text(), Some("e\u{301}😀"));
    }

    #[test]
    fn selection_only_and_captured_epoch_lifecycle_guards_are_explicit() {
        let (mut s, _) = open(AccessMode::ReadOnly);
        let id = leaf(&s);
        let mut request = transaction(&s, vec![]);
        request.selection = SelectionUpdate::Set(Some(Selection {
            anchor: Position::Text {
                leaf: id.into(),
                utf16: Utf16Offset::new(4),
                affinity: Affinity::After,
            },
            focus: Position::Text {
                leaf: id.into(),
                utf16: Utf16Offset::new(1),
                affinity: Affinity::After,
            },
        }));
        assert!(matches!(
            s.dispatch(request),
            DispatchOutcome::Unchanged {
                revision: 0,
                selection_epoch: 1,
                selection_changed: true,
                ..
            }
        ));
        let mut request = transaction(&s, vec![]);
        request.selection_epoch = Some(0);
        assert!(matches!(
            s.dispatch(request),
            DispatchOutcome::Refused {
                error: TransactionError::State(StateError::StaleSelectionEpoch),
                ..
            }
        ));
        let request = transaction(&s, vec![replace(id, 0, 2, "x")]);
        assert!(matches!(
            s.dispatch(request),
            DispatchOutcome::Refused {
                error: TransactionError::State(StateError::ReadOnly),
                ..
            }
        ));
        assert_eq!(s.journal_summary().entries, 0);
        assert!(!s.dirty());
        s.close(s.key()).unwrap();
        let request = transaction(&s, vec![]);
        assert!(matches!(
            s.dispatch(request),
            DispatchOutcome::Refused {
                error: TransactionError::State(StateError::Closed),
                ..
            }
        ));
    }

    #[test]
    fn finite_work_normalization_and_journal_limits_refuse_or_evict_observably() {
        let (mut s, _) = open(AccessMode::Editable);
        let id = leaf(&s);
        let key = s.key();
        for limit in [0, 1, 16] {
            let mut request = transaction(&s, vec![replace(id, 0, 2, "Q")]);
            request.limits.work.bytes = limit;
            assert!(matches!(
                s.dispatch(request),
                DispatchOutcome::Refused { .. }
            ));
            assert_eq!(s.node(key, id).unwrap().text(), Some("e\u{301}😀"));
        }
        let mut request = transaction(&s, vec![attr(id, "_loop", Some(Attribute::Boolean(true)))]);
        request.limits.normalization_passes = 2;
        assert!(matches!(
            s.dispatch(request),
            DispatchOutcome::Refused {
                error: TransactionError::NormalizationLimit,
                ..
            }
        ));
        let mut request = transaction(&s, vec![replace(id, 0, 2, "Q")]);
        request.limits.journal_bytes = 1;
        assert!(matches!(
            s.dispatch(request),
            DispatchOutcome::Refused {
                error: TransactionError::JournalLimit,
                ..
            }
        ));
        assert!(!s.dirty());
        assert_eq!(s.revision(), 0);
        for i in 0..4 {
            let end = if i == 0 { 2 } else { 1 };
            let mut request = transaction(
                &s,
                vec![replace(id, 0, end, if i % 2 == 0 { "Q" } else { "R" })],
            );
            request.limits.journal_entries = 2;
            changed(&mut s, request);
        }
        assert_eq!(s.journal_summary().entries, 2);
        assert_eq!(s.journal_summary().evicted, 2);
        assert_eq!(s.journal_summary().oldest_revision, 2);
        assert_eq!(
            s.map_position(key, 0, text(id, 2)).unwrap(),
            MapResult::Stale
        );
        assert!(matches!(
            s.map_position(key, 2, text(id, 1)).unwrap(),
            MapResult::Mapped(_)
        ));
    }

    #[test]
    fn normalization_is_in_commit_and_local_references_cannot_point_forward() {
        let (mut s, calls) = open(AccessMode::Editable);
        let id = leaf(&s);
        let request = transaction(
            &s,
            vec![
                attr(id, "_normalize", Some(Attribute::Boolean(true))),
                replace(id, 0, 2, "Q"),
            ],
        );
        let event = changed(&mut s, request);
        assert_eq!(event.normalization_operations, 1);
        assert!(
            !s.node(s.key(), id)
                .unwrap()
                .attributes()
                .unwrap()
                .contains_key("_normalize")
        );
        let request = transaction(
            &s,
            vec![Operation::Remove {
                node: NodeRef::Created {
                    operation: 1,
                    path: vec![0],
                },
            }],
        );
        assert!(matches!(
            s.dispatch(request),
            DispatchOutcome::Refused {
                error: TransactionError::InvalidLocalReference,
                ..
            }
        ));
        assert_eq!(s.revision(), 1);
        assert_eq!(calls.get(), 1);
    }
}
