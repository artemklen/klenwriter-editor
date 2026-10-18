// SPDX-License-Identifier: MIT OR Apache-2.0
// Private counter injection is deliberately absent from the bootstrap API.

mod history_counters {
    use super::*;
    use crate::history::{HistoryDirection, HistoryHint, TypingClass};
    use crate::transaction::{DispatchOutcome, SelectionUpdate, Transaction, TransactionError};
    use crate::{HistoryAvailability, HistoryOutcome, HistoryRequest};
    use editor_core::candidate::CandidateRead;
    use editor_core::history::HistoryProfile;
    use editor_core::transaction::{Operation, WorkLimits, WorkMeter};

    impl HistoryProfile for FixtureProfile {
        fn finalize_history_typing<V: CandidateRead>(
            &self,
            _: &(),
            _: &V,
            _: Option<Selection<V::Id>>,
            saved: Option<&[editor_core::document::Mark]>,
            work: &mut WorkMeter,
        ) -> Result<Option<Vec<editor_core::document::Mark>>, &'static str> {
            super::super::dispatch::copy_marks::<&'static str>(saved, work)
                .map(|(marks, _)| marks)
                .map_err(|_| "fixture.history_budget")
        }
        fn history_error_code(error: &&'static str) -> &'static str {
            error
        }
    }

    fn populated() -> Session<FixtureProfile> {
        let (mut session, _) = open(AccessMode::Editable);
        let key = session.key();
        let id = leaf(&session);
        session
            .set_selection(
                key,
                0,
                Selection {
                    anchor: text(id, 0),
                    focus: text(id, 0),
                },
            )
            .unwrap();
        let mut transaction = Transaction::new(
            key,
            0,
            vec![Operation::ReplaceText {
                leaf: id.into(),
                from: Utf16Offset::new(0),
                to: Utf16Offset::new(0),
                inserted: "A".into(),
            }],
        );
        transaction.selection = SelectionUpdate::Set(Some(Selection {
            anchor: text(id, 1).map_id(),
            focus: text(id, 1).map_id(),
        }));
        transaction.history_hint = HistoryHint::Typing {
            token: 7,
            class: TypingClass::Insert,
        };
        assert!(matches!(
            session.dispatch(transaction),
            DispatchOutcome::Changed(_)
        ));
        assert_eq!(session.history_summary().undo_units, 1);
        session
    }

    // A local explicit address conversion; it adds no restore authority.
    trait LocalPosition {
        fn map_id(self) -> Position<crate::transaction::NodeRef>;
    }
    impl LocalPosition for Position<NodeId> {
        fn map_id(self) -> Position<crate::transaction::NodeRef> {
            match self {
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
    }

    fn request(s: &Session<FixtureProfile>) -> HistoryRequest {
        HistoryRequest::new(
            s.key(),
            s.revision(),
            s.selection_epoch(),
            s.history_summary().epoch,
            HistoryDirection::Undo,
        )
    }

    fn unchanged_after_counter_refusal(s: &mut Session<FixtureProfile>, history_counter: bool) {
        let req = request(s);
        let doc = s.tree.document();
        let selection = s.selection;
        let marks = s.stored_marks.clone();
        let revision = s.revision;
        let epoch = s.selection_epoch;
        let journal = s.journal_entries();
        let journal_summary = s.journal_summary();
        let history = s.history_summary();
        let query = s.query_history(&req);
        let execute = s.execute_history(&req);
        let (query_error, query_work) = match query {
            HistoryAvailability::Unavailable { error, work, .. } => (error, work),
            other => panic!("unexpected query {other:?}"),
        };
        let (execute_error, execute_work) = match execute {
            HistoryOutcome::Refused { error, work, .. } => (error, work),
            other => panic!("unexpected execute {other:?}"),
        };
        assert_eq!(query_error, execute_error);
        assert_eq!(query_work, execute_work);
        if history_counter {
            assert!(matches!(
                execute_error,
                TransactionError::History(crate::history::HistoryError::CounterExhausted)
            ))
        } else {
            assert!(matches!(
                execute_error,
                TransactionError::State(StateError::CounterExhausted)
            ))
        }
        assert_eq!(s.tree.document(), doc);
        assert_eq!(s.selection, selection);
        assert_eq!(s.stored_marks, marks);
        assert_eq!(s.revision, revision);
        assert_eq!(s.selection_epoch, epoch);
        assert_eq!(s.journal_entries(), journal);
        assert_eq!(s.journal_summary(), journal_summary);
        assert_eq!(s.history_summary(), history);
        assert!(s.dirty);
    }

    #[test]
    fn h23_private_revision_and_selection_counter_limits_preserve_every_replay_facet() {
        let mut revision = populated();
        revision.revision = u64::MAX;
        unchanged_after_counter_refusal(&mut revision, false);
        let mut selection = populated();
        selection.selection_epoch = u64::MAX;
        unchanged_after_counter_refusal(&mut selection, false);
    }

    #[test]
    fn h23_private_history_counter_limits_refuse_replay_record_and_real_barriers_atomically() {
        let mut session = populated();
        session.history.set_epoch_for_test(u64::MAX);
        unchanged_after_counter_refusal(&mut session, true);
        let req = request(&session);
        let history = session.history_summary();
        let selection = session.selection;
        let epoch = session.selection_epoch;
        let id = leaf(&session);
        assert!(matches!(
            session.seal_history(
                req.session,
                req.revision,
                req.selection_epoch,
                req.history_epoch,
                WorkLimits::default()
            ),
            Err(TransactionError::History(
                crate::history::HistoryError::CounterExhausted
            ))
        ));
        assert!(matches!(
            session.set_selection(
                req.session,
                req.revision,
                Selection {
                    anchor: text(id, 2),
                    focus: text(id, 2)
                }
            ),
            Err(SessionError::History(
                crate::history::HistoryError::CounterExhausted
            ))
        ));
        assert_eq!(session.selection, selection);
        assert_eq!(session.selection_epoch, epoch);
        assert_eq!(session.history_summary(), history);
        let transaction = Transaction::new(
            session.key(),
            session.revision(),
            vec![Operation::ReplaceText {
                leaf: id.into(),
                from: Utf16Offset::new(1),
                to: Utf16Offset::new(1),
                inserted: "B".into(),
            }],
        );
        let doc = session.tree.document();
        let journal = session.journal_entries();
        assert!(matches!(
            session.dispatch(transaction),
            DispatchOutcome::Refused {
                error: TransactionError::History(crate::history::HistoryError::CounterExhausted),
                ..
            }
        ));
        assert_eq!(session.tree.document(), doc);
        assert_eq!(session.journal_entries(), journal);
        assert_eq!(session.history_summary(), history);
    }

    #[test]
    fn h23_private_already_sealed_boundary_is_noop_at_maximum_history_counter() {
        let mut session = populated();
        let req = request(&session);
        assert!(
            session
                .seal_history(
                    req.session,
                    req.revision,
                    req.selection_epoch,
                    req.history_epoch,
                    WorkLimits::default()
                )
                .unwrap()
                .changed
        );
        session.history.set_epoch_for_test(u64::MAX);
        let req = request(&session);
        let before = session.history_summary();
        let event = session
            .seal_history(
                req.session,
                req.revision,
                req.selection_epoch,
                req.history_epoch,
                WorkLimits::default(),
            )
            .unwrap();
        assert!(!event.changed);
        assert_eq!(event.history, before);
        assert_eq!(session.history_summary(), before);
    }
}
