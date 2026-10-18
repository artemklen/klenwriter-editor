// SPDX-License-Identifier: MIT OR Apache-2.0
//! Store proofs only. Session publication/dirty/read/snapshot witnesses are
//! separate; these tests do not impersonate that integration or a callback SDK.

use super::*;
use editor_core::transaction::WorkLimits;

fn meter() -> WorkMeter {
    WorkMeter::new(WorkLimits::default())
}
fn key() -> SessionKey {
    SessionKey::allocate().unwrap()
}
fn stamp(session: SessionKey, revision: u64) -> SessionStamp {
    SessionStamp {
        session,
        revision,
        selection_epoch: 0,
        history_epoch: revision,
    }
}
fn document(session: SessionKey, revision: u64) -> EventPayload {
    let history = HistorySummary {
        epoch: revision + 1,
        ..HistorySummary::default()
    };
    EventPayload {
        before: stamp(session, revision),
        after: stamp(session, revision + 1),
        selection_before: None,
        selection_after: None,
        stored_marks_before: None,
        stored_marks_after: None,
        dirty_before: revision != 0,
        dirty_after: true,
        history,
        journal: JournalSummary::default(),
        kind: EventKind::Document {
            impact: ChangeImpact {
                upserted: vec![NodeId::new(session, 2)],
                ancestors_before: vec![NodeId::new(session, 1)],
                ancestors_after: vec![NodeId::new(session, 1)],
                ..ChangeImpact::default()
            },
            map: PositionMap::new(revision, revision + 1, vec![]).unwrap(),
        },
    }
}
fn append(outbox: &mut EventOutbox, revision: u64, limits: EventLimits) -> EventCursor {
    let plan = outbox
        .prepare_append(
            Some(document(outbox.session, revision)),
            limits,
            &mut meter(),
        )
        .unwrap()
        .unwrap();
    let cursor = plan.event().cursor();
    outbox.publish(plan);
    cursor
}
fn batch(outbox: &EventOutbox, after: EventCursor, limit: usize) -> Vec<u64> {
    outbox
        .read_after(
            after,
            EventReadLimits {
                records: limit,
                ..EventReadLimits::default()
            },
            &mut meter(),
        )
        .unwrap()
        .iter()
        .map(|event| event.cursor().sequence())
        .collect()
}

#[test]
fn default_unprotected_ring_keeps_exact_order_and_explicit_gap_after_1536_appends() {
    let mut outbox = EventOutbox::new(key());
    let initial = outbox.status().head;
    for revision in 0..1536 {
        append(&mut outbox, revision, EventLimits::default());
    }
    let status = outbox.status();
    assert_eq!(status.records, 64);
    assert_eq!(status.head.sequence(), 1536);
    assert_eq!(status.oldest_after.sequence(), 1472);
    assert_eq!(
        outbox
            .read_after(initial, EventReadLimits::default(), &mut meter())
            .unwrap_err(),
        EventError::Gap {
            oldest_after: status.oldest_after,
            head: status.head
        }
    );
    assert_eq!(
        batch(&outbox, status.oldest_after, 64),
        (1473..=1536).collect::<Vec<_>>()
    );
}

#[test]
fn append_plan_is_pure_and_shares_existing_and_outcome_records() {
    let mut outbox = EventOutbox::new(key());
    let first = append(&mut outbox, 0, EventLimits::default());
    let first_arc = Arc::clone(&outbox.records[0].event);
    let status = outbox.status();
    let mut work = meter();
    let plan = outbox
        .prepare_append(
            Some(document(outbox.session, 1)),
            EventLimits::default(),
            &mut work,
        )
        .unwrap()
        .unwrap();
    assert!(work.trace().phase(WorkPhase::Event).visits > 0);
    assert!(work.trace().phase(WorkPhase::Event).bytes > 0);
    let outcome_arc = Arc::clone(plan.event());
    assert_eq!(outbox.status(), status);
    assert_eq!(batch(&outbox, first, 64), Vec::<u64>::new());
    assert!(Arc::ptr_eq(&first_arc, &plan.records[0].event));
    outbox.publish(plan);
    assert!(Arc::ptr_eq(&outcome_arc, &outbox.records[1].event));
    assert_eq!(outcome_arc.after().revision, 2);
    assert_eq!(first_arc.after().revision, 1);
}

#[test]
fn protected_undelivered_prefix_backpressures_until_valid_monotonic_ack() {
    let mut outbox = EventOutbox::new(key());
    let token = outbox.protect(ProtectionStart::Now).unwrap();
    let limits = EventLimits {
        records: 2,
        ..EventLimits::default()
    };
    let first = append(&mut outbox, 0, limits);
    let second = append(&mut outbox, 1, limits);
    let status = outbox.status();
    assert_eq!(
        outbox
            .prepare_append(Some(document(outbox.session, 2)), limits, &mut meter())
            .unwrap_err(),
        EventError::Backpressure
    );
    assert_eq!(outbox.status(), status);
    assert!(outbox.acknowledge(token, first).unwrap());
    assert!(!outbox.acknowledge(token, first).unwrap());
    append(&mut outbox, 2, limits);
    assert_eq!(batch(&outbox, first, 64), vec![2, 3]);
    assert_eq!(
        outbox.acknowledge(token, outbox.cursor(0)),
        Err(EventError::StaleAcknowledgement)
    );
    assert_eq!(
        outbox.acknowledge(token, outbox.cursor(4)),
        Err(EventError::FutureCursor)
    );
    assert!(outbox.acknowledge(token, second).unwrap());
}

#[test]
fn protection_can_start_at_retained_boundary_or_now_and_old_capability_stays_stale() {
    let mut outbox = EventOutbox::new(key());
    let initial = outbox.status().head;
    for revision in 0..4 {
        append(
            &mut outbox,
            revision,
            EventLimits {
                records: 2,
                ..EventLimits::default()
            },
        );
    }
    assert!(matches!(
        outbox.protect(ProtectionStart::After(initial)),
        Err(EventError::Gap { .. })
    ));
    let token = outbox
        .protect(ProtectionStart::After(outbox.status().oldest_after))
        .unwrap();
    assert_eq!(
        outbox.protect(ProtectionStart::Now),
        Err(EventError::ProtectedAlready)
    );
    assert!(outbox.release(token).unwrap());
    assert!(!outbox.release(token).unwrap());
    let next = outbox.protect(ProtectionStart::Now).unwrap();
    assert_ne!(token, next);
    assert_eq!(
        outbox.acknowledge(token, outbox.status().head),
        Err(EventError::StaleProtection)
    );
    assert_eq!(outbox.release(token), Err(EventError::StaleProtection));
}

#[test]
fn borrowed_batches_are_repeatable_bounded_and_do_not_acknowledge() {
    let mut outbox = EventOutbox::new(key());
    let start = outbox.status().head;
    let token = outbox.protect(ProtectionStart::Now).unwrap();
    for revision in 0..3 {
        append(&mut outbox, revision, EventLimits::default());
    }
    let status = outbox.status();
    assert_eq!(batch(&outbox, start, 2), vec![1, 2]);
    assert_eq!(batch(&outbox, start, 2), vec![1, 2]);
    let read = outbox
        .read_after(
            start,
            EventReadLimits {
                records: 2,
                bytes: usize::MAX,
            },
            &mut meter(),
        )
        .unwrap();
    assert_eq!(read.through().sequence(), 2);
    assert_eq!(read.head().sequence(), 3);
    assert!(read.work().units > 0);
    assert_eq!(outbox.status(), status);
    assert_eq!(
        outbox
            .read_after(
                start,
                EventReadLimits {
                    records: 0,
                    bytes: usize::MAX
                },
                &mut meter()
            )
            .unwrap_err()
            .as_str(),
        "resource_limit_exceeded"
    );
    assert_eq!(
        outbox
            .read_after(
                start,
                EventReadLimits {
                    records: 3,
                    bytes: 1
                },
                &mut meter()
            )
            .unwrap_err()
            .as_str(),
        "resource_limit_exceeded"
    );
    assert!(outbox.acknowledge(token, read.through()).unwrap());
}

#[test]
fn byte_eviction_and_protection_use_actual_payload_cost_not_only_record_count() {
    let mut outbox = EventOutbox::new(key());
    let payload = document(outbox.session, 0);
    let bytes = payload_bytes(&payload, &mut meter()).unwrap();
    let ring = size_of::<EventOutbox>() + MAX_RECORDS * size_of::<RetainedEvent>();
    let limits = EventLimits {
        records: 64,
        total_bytes: ring + bytes,
        ..EventLimits::default()
    };
    let initial = outbox.status().head;
    let first = append(&mut outbox, 0, limits);
    append(&mut outbox, 1, limits);
    assert_eq!(outbox.status().records, 1);
    assert!(matches!(
        outbox.read_after(initial, EventReadLimits::default(), &mut meter()),
        Err(EventError::Gap { .. })
    ));
    let token = outbox.protect(ProtectionStart::After(first)).unwrap();
    let status = outbox.status();
    assert_eq!(
        outbox
            .prepare_append(Some(document(outbox.session, 2)), limits, &mut meter())
            .unwrap_err(),
        EventError::Backpressure
    );
    assert_eq!(outbox.status(), status);
    outbox.release(token).unwrap();
}

#[test]
fn limits_work_and_counter_failures_preserve_every_store_facet() {
    let mut outbox = EventOutbox::new(key());
    append(&mut outbox, 0, EventLimits::default());
    let token = outbox.protect(ProtectionStart::Now).unwrap();
    let status = outbox.status();
    for limits in [
        EventLimits {
            records: 0,
            ..EventLimits::default()
        },
        EventLimits {
            single_bytes: 1,
            ..EventLimits::default()
        },
        EventLimits {
            total_bytes: 1,
            ..EventLimits::default()
        },
    ] {
        assert!(
            outbox
                .prepare_append(Some(document(outbox.session, 1)), limits, &mut meter())
                .is_err()
        );
        assert_eq!(outbox.status(), status);
    }
    let mut no_work = WorkMeter::new(WorkLimits { units: 0, bytes: 0 });
    assert!(matches!(
        outbox.prepare_append(
            Some(document(outbox.session, 1)),
            EventLimits::default(),
            &mut no_work
        ),
        Err(EventError::Limit(_))
    ));
    assert_eq!(outbox.status(), status);
    outbox.set_sequence_for_test(u64::MAX);
    let max_status = outbox.status();
    assert!(
        outbox
            .prepare_append(None, EventLimits::default(), &mut no_work)
            .unwrap()
            .is_none()
    );
    assert_eq!(
        outbox
            .prepare_append(
                Some(document(outbox.session, 1)),
                EventLimits::default(),
                &mut meter()
            )
            .unwrap_err(),
        EventError::CounterExhausted
    );
    assert_eq!(outbox.status(), max_status);
    outbox.release(token).unwrap();
}

#[test]
fn terminal_is_outside_full_queue_and_max_sequence_and_invalidates_protection() {
    for kind in [TerminalKind::Closed, TerminalKind::Poisoned] {
        let mut outbox = EventOutbox::new(key());
        let token = outbox.protect(ProtectionStart::Now).unwrap();
        for revision in 0..64 {
            append(&mut outbox, revision, EventLimits::default());
        }
        outbox.set_sequence_for_test(u64::MAX);
        let bytes = outbox.status().retained_bytes;
        outbox.terminate(kind);
        assert_eq!(outbox.status().head.sequence(), u64::MAX);
        assert_eq!(outbox.status().records, 64);
        assert_eq!(outbox.status().retained_bytes, bytes);
        assert_eq!(outbox.status().terminal.unwrap().kind, kind);
        assert_eq!(outbox.status().protected_after, None);
        assert_eq!(
            outbox.acknowledge(token, outbox.status().head),
            Err(EventError::Terminated)
        );
        assert_eq!(
            outbox
                .read_after(
                    outbox.status().head,
                    EventReadLimits::default(),
                    &mut meter()
                )
                .unwrap_err(),
            EventError::Terminated
        );
        assert_eq!(
            outbox
                .prepare_append(None, EventLimits::default(), &mut meter())
                .unwrap_err(),
            EventError::Terminated
        );
    }
}

#[test]
fn foreign_generation_future_and_protection_counter_are_typed_without_mutation() {
    let mut outbox = EventOutbox::new(key());
    let other = EventOutbox::new(outbox.session.next_generation().unwrap());
    let status = outbox.status();
    assert_eq!(
        outbox
            .read_after(
                other.status().head,
                EventReadLimits::default(),
                &mut meter()
            )
            .unwrap_err(),
        EventError::ForeignSession
    );
    assert_eq!(
        outbox.protect(ProtectionStart::After(outbox.cursor(1))),
        Err(EventError::FutureCursor)
    );
    let other_token = ProtectedCursor {
        session: other.session,
        id: 1,
    };
    assert_eq!(outbox.release(other_token), Err(EventError::ForeignSession));
    assert_eq!(outbox.status(), status);
    outbox.protection_id = u64::MAX;
    assert_eq!(
        outbox.protect(ProtectionStart::Now),
        Err(EventError::CounterExhausted)
    );
    assert_eq!(outbox.status(), status);
}

#[test]
fn state_events_keep_doc_revision_and_validate_actual_flags() {
    let mut outbox = EventOutbox::new(key());
    let mut payload = document(outbox.session, 0);
    payload.after = payload.before;
    payload.history.epoch = 0;
    payload.kind = EventKind::State(StateChange {
        baseline_changed: true,
        ..StateChange::default()
    });
    payload.dirty_before = true;
    payload.dirty_after = false;
    let plan = outbox
        .prepare_append(Some(payload.clone()), EventLimits::default(), &mut meter())
        .unwrap()
        .unwrap();
    assert_eq!(
        plan.event().before().revision,
        plan.event().after().revision
    );
    outbox.publish(plan);
    assert_eq!(outbox.status().head.sequence(), 1);
    payload.kind = EventKind::State(StateChange::default());
    payload.dirty_before = false;
    let status = outbox.status();
    assert_eq!(
        outbox
            .prepare_append(Some(payload), EventLimits::default(), &mut meter())
            .unwrap_err(),
        EventError::InvalidPayload
    );
    assert_eq!(outbox.status(), status);
}

#[test]
fn retained_capacity_marks_maps_and_disjoint_tombstones_are_accounted() {
    let session = key();
    let mut payload = document(session, 0);
    let base = payload_bytes(&payload, &mut meter()).unwrap();
    let mut spelling = String::with_capacity(2048);
    spelling.push('x');
    payload.stored_marks_after = Some(vec![Mark {
        type_id: spelling,
        attributes: Attributes::new(),
    }]);
    let with_mark = payload_bytes(&payload, &mut meter()).unwrap();
    assert!(with_mark >= base + 2048 + size_of::<Mark>());
    if let EventKind::Document { impact, map } = &mut payload.kind {
        impact.removed = impact.upserted.clone();
        let mut retired = Vec::with_capacity(128);
        retired.push(NodeId::new(session, 3));
        *map = PositionMap::new(
            0,
            1,
            vec![StepMap::Retire {
                nodes: retired,
                parent: NodeId::new(session, 1),
                index: 0,
            }],
        )
        .unwrap();
    }
    assert!(
        payload_bytes(&payload, &mut meter()).unwrap() >= with_mark + 128 * size_of::<NodeId>()
    );
    let outbox = EventOutbox::new(session);
    assert_eq!(
        outbox
            .prepare_append(Some(payload), EventLimits::default(), &mut meter())
            .unwrap_err(),
        EventError::InvalidPayload
    );
}

#[test]
fn marks_copy_is_precharged_preserves_none_vs_plain_and_never_calls_profile_code() {
    let marks = vec![Mark {
        type_id: "org.example/color".into(),
        attributes: Attributes::from([
            ("color".into(), Attribute::String("violet".into())),
            ("number".into(), Attribute::Number(123u64.into())),
            (
                "nested".into(),
                Attribute::List(vec![Attribute::Boolean(true)]),
            ),
        ]),
    }];
    let mut no_copy = WorkMeter::new(WorkLimits {
        units: 10000,
        bytes: 0,
    });
    assert!(matches!(
        copy_event_marks(Some(&marks), &mut no_copy),
        Err(EventError::Limit(_))
    ));
    let mut work = meter();
    assert_eq!(copy_event_marks(None, &mut work).unwrap(), None);
    assert_eq!(
        copy_event_marks(Some(&[]), &mut work).unwrap(),
        Some(vec![])
    );
    assert_eq!(
        copy_event_marks(Some(&marks), &mut work).unwrap(),
        Some(marks)
    );
    assert!(work.usage().bytes > 0);
}

#[test]
fn raised_host_limits_cannot_hide_oversized_retained_spare_capacity() {
    let outbox = EventOutbox::new(key());
    let mut payload = document(outbox.session, 0);
    let mut name = String::with_capacity(MAX_SINGLE_BYTES);
    name.push('x');
    payload.stored_marks_after = Some(vec![Mark {
        type_id: name,
        attributes: Attributes::new(),
    }]);
    let before = outbox.status();
    let raised = EventLimits {
        records: usize::MAX,
        single_bytes: usize::MAX,
        total_bytes: usize::MAX,
    };
    let error = outbox
        .prepare_append(Some(payload), raised, &mut meter())
        .unwrap_err();
    assert!(matches!(
        error,
        EventError::Limit(LimitExceeded {
            name: "event_single_bytes",
            maximum: 16_777_216,
            ..
        })
    ));
    assert_eq!(outbox.status(), before);
}
