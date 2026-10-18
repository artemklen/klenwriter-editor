# OSR-37 — local delivery evidence

The [accepted execution contract](execution-contract.md) preserves all four
original Linear criteria. The tested uncommitted source is bound to base
`e6c6762952050b62fad30e7a5456ed5607adbb9d` by the 294 per-file hashes in
[local-verification.json](local-verification.json). A separate external binding
will identify the eventual committed source, PR and prepared CI. This local
receipt alone is not an independent review, CI result or task acceptance.

| Original criterion | Implementation and actual evidence |
|---|---|
| Ordinary local edits avoid unnecessary whole-document export/validation | Typed profile-owned proof cache, compositional wire/structure summaries, scoped shared KWDJ rules and fresh current identity answers. [Deltas report](deltas-report.json): 13 independent literals, incremental/full cohorts and 34 size/phase series. Native mixed comparison: 32 sequences and 1312 checked edit/undo/redo checkpoints in both profiles. |
| Dirty ancestors and ordered events cover nested edits, move/delete and statistics | Common sparse impact/cache/event publication for raw transactions, commands and history. Exact old/new ancestors, upserts/tombstones, guarded shallow reads and structural statistics. Five Session integration tests and 13 event-store tests include atomic refusal, protected cursor, gaps, state events, remount and terminal/MAX behavior. |
| Snapshot export has one coherent revision stamp and stale detection | Explicit engine-issued immutable canonical snapshot receipt with binding/session/revision/event cursor, stale reads and exact saved-baseline acknowledgement/reconciliation. Old saves cannot clear a newer dirty revision. Native integration and native/WASM literals check these boundaries. |
| Structural complexity is measured honestly | Phase counters separate local work, affected structural scopes, current references, event metadata and explicit export. [Benchmark raw samples](benchmark/raw.json), metadata and summary preserve five independent processes and 8000 dispatch samples; no latency SLA or release regression verdict is claimed. |

Actual completed local gates, all exit 0:

- `npm run check`: 288 Rust tests including doctests, 22 result blocks; all
  native/WASM witnesses, package/architecture/license checks and 12 browser tests.
- `cargo +1.89.0 test --locked -p klenwriter-editor-core -p klenwriter-editor-kwdj`:
  115 tests including doctests, 10 result blocks.
- `npm test`: 102 M0 browser tests across Chromium, Firefox and WebKit.
- `node scripts/summarize-evidence.mjs`: 102 observations, zero failures;
  MET 28, GAP 26, OBSERVATION 48 retain their original meanings.
- `npm run perf:deltas`: five interleaved native benchmark rounds. Controller
  Node 26.10.0 is recorded separately from acceptance Node 24.22.0/npm 11.14.0.

All 75 tracked files belonging to frozen OSR-58 evidence are byte-identical to
the base. The new M0 observations are archived separately in this delivery.
Raw logs, compressed-byte hashes, roundtrip/CRC proofs, actual exits, complete
reports and source/artifact hash scopes are indexed by local-verification.json.

## Corrections and limits

The first full run exposed a history steady-state fixture that assumed an
outbox was already steady after two cycles; the next run exposed the same
assumption in the inherited metadata fixture. Both now explicitly retain one
event, alongside one history action and one journal map, without changing
512 cycles/commits, the two warmups, 510 steady iterations, work ceilings or
document/ID/selection oracles. Native event tests separately exercise the
default 64-record outbox over 1536 appends; native/WASM Gap70 uses an explicit
two-record limit. Both fixture changes are asserted in the portable reports.

The failed full logs and a fixture import compile error are preserved. The
first full-run wrapper failed while serializing its exit table; that nested
command's exit was not recorded and stays null. Its wrapper metadata is clearly
identified as a retained transcription, not an original raw tool transcript.
Earlier mixed-fixture EGC refusal and focused intermediate logs retain their
historical source qualification. The final complete gates bind the final source.

Benchmark samples are descriptive same-source incremental/full native lanes.
All samples, including two groups with CV above 10%, are retained. They do not
measure browser input-to-paint, RSS/OOM behavior or an older release baseline.
Portable semantics are compared exactly; target-local work/copy diagnostics
and compiled artifacts remain distinct and fully hashed.

Native Session stores pull notifications without calling external code.
OSR-63 implements the public SDK/JS queue, listeners and disposal; OSR-69 owns
host persistence cadence. OSR-38 adds its own public-boundary fuzz/performance
gates after OSR-63/64. Generic opaque profiles retain an explicitly traced full
fallback. See [API and complexity documentation](../../docs/deltas.md).
