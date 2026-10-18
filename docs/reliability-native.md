# Ordinary native reliability replay

`node scripts/reliability/replay-native.mjs` explicitly runs pinned
`cargo +1.97.1 fetch --locked --manifest-path tests/fixtures/reliability-native/Cargo.toml`
before `cargo +1.97.1 build --locked --offline --manifest-path
tests/fixtures/reliability-native/Cargo.toml --bin replay --target-dir <directory>`.
It records the actual toolchain command, fetch/build exits, raw streams and
unchanged lock/source hashes. Fetch failure never falls back to an unlocked or
online build. This is an ordinary debug consumer, separate from release timing
and sanitizer/coverage-guided fuzz builds.

The default replay reads the same frozen sealed oracle as the SDK adapter with
`readScenarios({perContext:256})`:1024 generated plus12 hand literals. Actual
saved regular `contracts/reliability/v1/regressions/*.jsonl` cases run first and
are counted separately from that1036 floor. The unchanged Rust consumer reads
one original JSONL line on stdin and emits one serialized serde Result. JS
checks the result binding/positive flags but never constructs expected editor
outcomes. Raw authored document strings remain verbatim.

Each scenario gets a fresh actual native child and an external2s wall deadline,
starting before process spawn. There is no excluded startup/readiness allowance
and no Promise timeout used as a synchronous-code interrupt. A timeout, panic,
signal, failed Result, invalid output or nonzero exit fails visibly. The native
consumer itself proves committed state/query/identity/canonical/history facts;
process termination is not used to invent cleanup evidence.

`--operations` invokes the same native binary as a separate category after the
scenario replay. Its frozen13 raw-operation literals cover real KWDJ prose
public native transactions and their refusal/map/history checks; they do not
count as random cases, SDK raw dispatch or all-profile grammar coverage.

Every build and replay has a new UUID directory under
`artifacts/reliability/native/{builds,runs}/`. Run records preserve exact original
JSONL, raw stdout/stderr including empty streams, actual exit/signal, phase and
failure Result. Original failure input is saved even when replay stops early.
Raw per-case streams are bounded at1MiB each and the aggregate replay evidence
at64MiB; overflow fails rather than dropping diagnostics and passing. The latest
`artifacts/reliability/native-report.json` points to the immutable run records.

Source coherence covers all production Rust/Cargo inputs conservatively, the
used native lib/model/properties/replay entrypoint, embedded operation/Notes
oracles, driver imports and raw selected oracle/lock/binary pins. Unused native
measurement binaries and their support module are explicitly excluded because
they are not compiled by `--bin replay`. Before/after equality and exact build
receipt/binary readback are required. Source/build hashes prove the declared
consumer/artifact pairing; they do not establish a release performance claim.

For a focused check use `node scripts/reliability/replay-native.mjs --literal-only`.
It runs12 literals plus the separate operation category and explicitly reports
that it does not meet the generated native floor. It still performs real locked
fetch/offline build. Imports have no execution effects.

Root can separate build and replay: `node scripts/reliability/replay-native.mjs
build build-config.json` accepts `{outputRoot?,targetDirectory?}` and prints
`{binary,buildReceipt}`. Then `node scripts/reliability/replay-native.mjs replay
replay-config.json` accepts `{binary,buildReceipt,perContext?,operations?,
failFast?,outputRoot?,regressionDirectory?}`. A stale, missing or unsuccessful
build receipt refuses before scenario execution. The receipt uses
`editor-reliability-native-replay-build/1`; external callers may supply that
schema only with actual captured commands and matching source/binary/raw hashes.
