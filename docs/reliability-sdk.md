# Packaged SDK reliability replay

`node scripts/reliability/replay-sdk.mjs` reads the independently frozen JSONL
and its seal from `artifacts/reliability/`. It never generates expected editor
outcomes. The default selection is the first64 generated cases in each KWDJ
Prose/Poetry and Notes D0/D1 context plus all12 hand-literal scenarios:268
independent scenarios. Five additional public boundary/lifecycle cases are
reported separately and do not inflate the generated coverage floor. Actual
saved `contracts/reliability/v1/regressions/*.jsonl` entries run first, ordered by
file name and line, and are counted separately from all generated floors. The
report pins their raw file hashes and rechecks the corpus after execution. This
directory currently has no manufactured production-failure input.

Every case uses the real sealed `packages/wasm/dist` module and public packaged
`createEditor` V2 controller. A fresh Node process loads/verifies that module,
then signals readiness. The parent starts a2s case deadline **before** admission;
an independent30s startup deadline bounds cold loading. The parent kills a hung
process, including a synchronous WASM call. A Promise timeout is not used as an
interrupt and the editor does not gain a worker API. A timeout, trap, native
Fatal, failed assertion or nonzero child exit fails replay.

The adapter binds initial block IDs once through public reads. Subsequent live
child reads bind IDs returned by that block, not a stale path retarget. Full
canonical bytes, physically valid selection coordinates mapped to logical
UTF16, history counts, document revisions and conservative dirty state match
the preexecution oracle after every action. Explicit snapshots are test
checkpoints, not ordinary command work. Same-lane undo/redo must revive captured
historical IDs; opaque serials are not compared across targets. Two listeners
read one unchanged event fence. Immediate Isolated query/execute checks cover
observable state/resources/IDs/events only; SDK wire exposes no WorkUsage DTO
and the generic V2 SDK has no raw13-operation dispatch.

The small model is supplemented by actual reentrant/stale queued commands,
failed/successful remount, stale host completions, listener exceptions, delayed
loading cancellation, and scalar ownership guards. A raw authored MAXu64 JSON
lexeme reaches Rust without JS Number parsing; its tagged public attribute and
exact canonical bytes are checked. Hostile scalar/closed DTO cases must refuse
without publication or caller-byte changes. Facts routes are distinct: real V1
controller refusal/retry; raw KWDJ V2 profile endpoint facts; generic V2
controller typed unsupported. Existing frozen Notes53/commands18/recipe/D0D1
author literals remain an explicitly separate supplement.

After closure both public JS ownership and actual Rust Session/snapshot/cursor
resources must return to their baseline. Process termination is not used as a
cleanup oracle. Controlled watchdog tests contain a test-only infinite JS loop
and excessive stdout; they verify host isolation/evidence bounds, not a fake
Rust bridge or a manufactured production crash.

Each run has a new `artifacts/reliability/sdk/runs/<id>/` directory with actual
child exit/signal, stdout/stderr, checkpoints, input-line SHA and failure phase.
The latest `artifacts/reliability/sdk-report.json` names immutable run records,
the raw frozen oracle/seal, adapter hashes, actual producer build/source hashes
and sealed WASM SHA. Failure also preserves the original JSONL case separately;
Root's recorder/shrinker owns minimization, retaining the same invariant/phase.
Evidence is capped at64MiB per replay and1MiB per child stdout/stderr stream;
overflow fails visibly. Source, oracle and module hashes are rechecked after
execution. `--literal-only` is a focused lane and honestly reports that it does
not meet the generated SDK floor. No renderer, IME/AT, latency or independent
review claim follows from this report.

`shrink.mjs` provides `shrinkRaw(bytes,{probe,signature,limits})` and
`shrinkScenario(scenario,{probe,signature,limits,originalBytes?})`. The callback
returns `{failed:boolean,signature?}` and receives a tightened `timeoutMs`;
runtime callbacks must actually supervise an external child, for example with
`superviseProcess`. The reducer itself cannot interrupt a synchronous callback.
It permits at most128 probes/30s with a2s per-probe allowance. Exact invariant,
phase, class, target and context must match; incidental action index/opaque IDs
are excluded from the signature. Thrown callback errors and late results cannot
be substituted for semantic failures.

Raw reduction removes chunks and simplifies individual bytes without decoding
the authored payload. Finite-model reduction supports only the closed frozen
paragraph model, preserves surviving select/insert coordinates and regenerates
every expected checkpoint through `makeScenario` before probing. Its finite
token boundaries do not claim a general Unicode or13-operation reducer. Invalid
dependencies, changed metadata/oracles and unsupported operations preserve the
original with `not_minimized`. A reduced result is a bounded fixed point, not a
proof of global minimality.

`recordReproducer({directory,reduction,seed,sourceFiles,build,qualification})`
creates a new0700 directory with exclusive0600 original/minimized raw bytes,
probe trace and receipt, then verifies every write by exact readback. The receipt
retains seed/action traces, the failure signature, actual source-file hashes,
caller-supplied build ID and actual artifact SHA. Its64MiB aggregate bound fails
before creating the record; inputs and existing records are never overwritten.
The hand-authored NBSP→SPACE faulty model, raw BUG! marker and parser-escape
tests are expressly test-only fault injections, not production regressions.
