# Coverage-guided fuzz lane

This lane executes the OSR-38 AC3 stopped block: real coverage-guided
fuzzing of the public native harness families plus replay of retained corpus
bytes through the actual packaged WASM/SDK. The ordinary
[reliability check](reliability.md) keeps its own scope and still makes no fuzz
claim. Nothing here proves performance, renderer latency, release gates
(OSR-71/OSR-80) or the inconclusive AC4 comparison; the
[owner acceptance exception](../evidence/osr-38/owner-acceptance-exception.md)
remains recorded for every item outside this lane.

## Pins and isolation

The standalone `tests/fixtures/fuzz-native` workspace carries its own lock and
`rust-toolchain.toml` pinning `nightly-2026-10-17` (rustc
`1.101.0-nightly (5d8fec066…)`). The orchestrator requires
`cargo-fuzz 0.13.2` in `.tools` (`cargo install cargo-fuzz --version 0.13.2
--locked --root .tools`) and the lock pins `libfuzzer-sys =0.4.13`
(`(MIT OR Apache-2.0) AND NCSA`, bundled libFuzzer runtime notice in `NOTICE`
scope: test-only, never shipped). Every invocation performs an explicit
`cargo fetch --locked` first and then builds only with `CARGO_NET_OFFLINE`;
the lock hash may not change. The production root lock and the ordinary
native fixture lock must not contain `libfuzzer-sys`/`cargo-fuzz`; the
published proptest/dhat closure proofs remain in the dependency inventory.

## Families and envelope

Four families map one-to-one to libFuzzer targets and the frozen harness
entries in `tests/fixtures/reliability-native/src/lib.rs`:

| target | entry | payload |
| --- | --- | --- |
| `admission_options` | `fuzz_admission` | raw document bytes |
| `registry_grammar_attrs_recipes` | `fuzz_registry` | raw closed-descriptor bytes |
| `positions_maps_state_history_events` | `fuzz_stateful` | bounded opcode bytes (≤64 consumed) |
| `bridge_lifecycle_facts_stale_tokens` | `fuzz_bridge` | bridge envelope JSON |

The first input byte is a test-only context selector (`kwdj-prose`,
`kwdj-poetry`, `notes-d0`, `notes-d1`); every remaining byte reaches
production admission/options/compiler/request paths verbatim. A malformed
envelope is a harness non-admission, never a production typed refusal. The
registry family has no envelope (the whole input is compiler payload).

The committed deterministic seeds live in `tests/fixtures/fuzz-native/seeds`
with a manifest; `scripts/reliability/fuzz-seeds.mjs` regenerates them and
refuses silent replacement of retained bytes. Seeds anchor successful
admission, typed refusal, descriptor compilation, deep stateful opcodes
(including the NBSP-insert variant) and the public bridge envelope for every
context, so corpus regression replay alone must already demonstrate the
required phase reachability.

## Bounds and failure semantics

`node scripts/reliability/fuzz.mjs bounded` runs four 60-second targets under
a 20-minute job cap; `node scripts/reliability/fuzz.mjs long` runs four
900-second targets under a 90-minute job cap. Both apply `max_len=16384`,
`timeout=2` seconds per input, `rss_limit_mb=2048` per target, value profile,
a fixed seed and `print_final_stats`. A panic-derived crash, trap, sanitizer
report, per-input timeout, OOM (libFuzzer `rss_limit_mb`) or watchdog kill
inside bounds fails the lane; typed refusals are expected outcomes. Zero
explored iterations or missing coverage feedback cannot pass. Retained
corpus/artifact evidence per target is capped at 64 MiB and overflow fails
visibly. The default cargo-fuzz address-sanitizer build is used on the pinned
host; leak detection is disabled explicitly because LSan is not supported on
this host and the RSS cap owns that bound.

After fuzzing, the uninstrumented `corpus-replay` binary replays every seed
and corpus file through the same family entries: any harness panic fails, and
aggregated per-context reachability must show for all four contexts
successful admit + canonical export + cleanup (admission), compile attempt +
success (registry), plan/publish + history + late refusal + cleanup
(stateful), and admission + publish + history + snapshot + events + cleanup
(bridge).

## Actual packaged WASM/SDK replay

Retained corpus bytes replay through the real packaged module
(`packages/wasm` + `packages/sdk`, seal-verified against
`artifacts/sdk-wasm-seal.json`; stale packaging refuses) in a separate Node
child process. The parent owns an external wall-clock watchdog and kills the
child process on overrun; no in-process `Promise.race` is treated as an
interrupt because synchronous WASM execution cannot be interrupted in-process.

- Admission corpus: each raw payload that is valid UTF-8 opens through the
  actual controller with authored options rebuilt for the packaged module
  identity. The outcome must be `ok`/`refused` without fatal or uncaught
  exception; where the native replay is unambiguous (all admission modes
  admitted, or none), the packaged verdict must agree. Non-UTF-8 payloads are
  counted skips, not passes: the JS admission input is a string byte domain.
- Bridge corpus: each envelope's exact `input_json` and every raw request
  string pass verbatim through the actual raw V2 `Session`; a bridge `Fatal`
  or uncaught exception inside bounds fails. Host options are rebuilt with
  the packaged module identity exactly like the ordinary scenario SDK lane.
- The registry and stateful opcode families are native-public lanes with no
  byte-identical packaged surface; their bytes still replay natively above.
  This mapping is explicit and is not silently widened.
- The packaged-WASM replay walks every committed seed plus a bounded
  deterministic subset of at most 256 sorted corpus files per family; the
  native `corpus-replay` stage above always walks the complete corpus.

## Reproducers

On any retained crash/timeout/OOM artifact the lane fails and retains the
original seed/bytes and stream logs. `node scripts/reliability/fuzz.mjs
minimize <family> <artifact>` runs libFuzzer crash minimization with the same
bounds, keeping the original untouched and writing the minimized reproducer
beside a receipt; the minimized reproducer must reproduce the same
invariant+phase/class before any corpus addition. The shrinker/recorder
itself stays verified by the deliberately faulty test-only model in the
ordinary `tests/reliability-shrink.node.mjs` lane; production failures are
never fabricated.

## Evidence

Each invocation creates a UUID directory under
`artifacts/reliability/fuzz/<mode>-runs/` retaining raw command streams,
receipts, corpus manifests, replay reports and the final report; the summary
`artifacts/reliability/fuzz/<mode>-report.json` points at it. The report
records toolchain identities, lock pins before/after, per-target executed
units/coverage/features/peak RSS, corpus counts, reachability and WASM replay
tallies. A configured future schedule alone is not completed evidence: the
bounded and long configurations must actually finish on this host with their
outputs retained.
