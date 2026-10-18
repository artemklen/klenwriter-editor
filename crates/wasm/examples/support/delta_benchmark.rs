// SPDX-License-Identifier: MIT OR Apache-2.0
//! Native descriptive measurement only. Admission/transaction construction and
//! correctness assertions are outside each measured dispatch interval.
use super::*;
use std::time::Instant;

pub fn observe() -> Value {
    observe_range(0..5)
}
pub fn observe_round(round: usize) -> Value {
    assert!(round < 5);
    observe_range(round..round + 1)
}
fn observe_range(rounds: std::ops::Range<usize>) -> Value {
    let round_count = rounds.len();
    let mut runs = vec![];
    for round in rounds {
        for width in [1, 16, 128, 1024] {
            for full in if round % 2 == 0 {
                [true, false]
            } else {
                [false, true]
            } {
                let (value, path, _, _) = series::fixture("roots", width);
                let (mut s, calls) =
                    open(&value, full, EventLimits::default(), AccessMode::Editable);
                let leaf = at(&s, &path);
                // Both histories and outboxes reach the same 64-record plateau.
                for i in 0..64 {
                    let tx = replace(&s, leaf, 0, 1, if i % 2 == 0 { "b" } else { "a" });
                    raw(&mut s, &calls, tx);
                }
                let before_calls = calls.get();
                let mut nanos = Vec::with_capacity(200);
                let mut traces = vec![];
                for i in 0..200 {
                    let tx = replace(&s, leaf, 0, 1, if i % 2 == 0 { "b" } else { "a" });
                    let start = Instant::now();
                    let outcome = s.dispatch(tx);
                    let elapsed = start.elapsed();
                    let DispatchOutcome::Changed(event) = outcome else {
                        panic!("measured operation did not commit")
                    };
                    nanos.push(u64::try_from(elapsed.as_nanos()).unwrap());
                    if i == 0 || i == 199 {
                        traces.push(series::trace_json(event.trace, event.work));
                    }
                }
                assert_eq!(calls.get(), before_calls);
                assert_eq!(s.revision(), 264);
                assert_eq!(s.node(s.key(), leaf).unwrap().text(), Some("a"));
                assert_eq!(
                    s.export_snapshot(s.key(), s.revision()).unwrap(),
                    canonical_expected(&value)
                );
                runs.push(json!({"round":round,"width":width,"lane":if full{"full_authoritative"}else{"incremental"},"warmup_publications":64,"samples_ns":nanos,"first_last_traces":traces,"ordinary_codec_hooks":0,"final_revision":"264","literal_final_bytes_restored":true}));
            }
        }
    }
    json!({"format":"klenwriter-editor-delta-native-benchmark/1","status":"passed","protocol":{"rounds":round_count,"samples_per_lane_round":200,"warmup_publications":64,"order":"AB/BA alternating by round, widths1/16/128/1024","timer":"std::time::Instant per actual dispatch","session_init_and_transaction_construction":"outside measurement","baseline":"Same-source authoritative full KWDJ hooks via explicit wrapper; not an older-release or prechange measurement","claim":"Descriptive native engine/profile dispatch only. No regression verdict, DOM/browser paint, RSS, latency SLA or release budget."},"runs":runs})
}
