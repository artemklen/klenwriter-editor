# Preserved reliability regressions

This directory is reserved for independently checked **actual** original and
minimized production failures. It currently contains no manufactured failing
editor input. The deliberately faulty NBSP model and raw-marker probes live in
`../shrinker-literals.json` and the shrinker unit tests instead.

Replay every regular `*.jsonl` file here before generated exploration. Each
nonempty line is a complete `editor-reliability-scenario/1` scenario with its
independent expected checkpoints. A companion reproducer receipt binds exact
original/minimized bytes, seed/action trace, failure invariant/phase/class,
target/context and actual source/build hashes. Raw binary crash inputs remain
raw files with a receipt; they are not silently parsed into model scenarios.

New regressions require an actual recorded failure and a separately justified
expected result. Shrinking is evidence, not a license to rewrite the oracle.
Finite-model reduction retains select/insert edit pairs and regenerates their
undo/redo/checkpoints through the independent model before probing. It keeps
surviving coordinates unchanged; invalid dependencies or unsupported operations
are refused rather than retargeting a stale handle. A parse error, timeout or
different failure class cannot replace the original semantic failure.

The reducer has finite probe/time/evidence bounds. Runtime callbacks must use an
external process watchdog; a Promise timeout cannot interrupt synchronous WASM.
An unsupported or budget-exhausted input remains preserved and is labelled
`not_minimized` or bounded reduction, never claimed globally minimal.
