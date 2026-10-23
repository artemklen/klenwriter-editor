# Browser failure-state contract — OSR-67

This contract is frozen before its implementation and new executions. It is a
finite local fixture plan, not a result, an exhaustive safety claim or a change
to an existing assertion. The four original OSR-67 acceptance criteria and the
accepted architecture v2.0 / master plan v3 remain authoritative.

The complete matrix joins clipboard/parser, allowlist conversion, real native
admission and fresh mounted rendering. A refusal stops at its declared stage;
it must not be described as successful execution of later stages. Trusted Rust
and TS application extensions are application code, not a sandbox. Transactions
do not perform network requests. Runtime asset loading has a separately pinned
allowlist; blocked content-initiated attempts are observations, not a clean PASS.

## Loading and fatal recovery decision

The loading ceiling is **30,000 milliseconds**, measured over asynchronous
loading from the caller's entry. The optional `loadTimeoutMs` must be a safe
integer from 1 through 30,000; callers can only tighten it. Both the public loader
and controller enforce their own admission lifetime, including injected loaders.
Expiration is `sdk.load_timeout`; controller ready settles once as Refused,
retains original bytes, and never opens a Session after expiration. The deadline
is an operational ceiling, not a latency SLA or synchronous interruption of JS,
parsing, module evaluation or WASM.

Concurrent readers have independent waiting lifetimes. One reader's expiration
must not cancel another live reader. Retired asynchronous work must not replace
a newer cache entry. Once the last reader leaves a pending initialization,
the implementation must distinguish work that can safely be abandoned before
glue initialization from an already-started singleton initialization. The latter
must fail closed for that realm rather than quietly reuse a late instance.

The current generated glue is a singleton at a fixed static module URL. The
chosen recovery boundary is therefore **explicit host recovery in a fresh JS
realm/document**, using the same coherent verified static JS/WASM pair. There
is no cache-busting module factory, Worker protocol, eval, dynamic source or blob
URL. A new controller in the same realm is not a fresh WASM instance. A genuine
runtime trap retires the affected shared module capability; subsequent calls and
loads in that realm refuse `sdk.runtime_retired`. Previously obtained projections
and peer handles cannot continue invoking it.

The failing operation remains Fatal, with its existing publication uncertainty;
queued unexecuted operations are Refused and settle once. No best-effort destroy
or free after a trap is proof of repaired native state. Counters from an unusable
instance may be unavailable; do not fabricate zero. Host original/coherent
snapshot and bounded provisional text live outside the failed instance. Recovery
is explicit, never an empty replacement or a false Saved. Old host callbacks
are fenced by the host lifecycle identity, independently of native serials.

The genuine trap lane uses an isolated test-only Rust/bridge composition with
its own source-derived build identity, seal and matching fixture-local SDK
binding. It does not relabel modified fixture WASM as production bytes. A JS
`throw new WebAssembly.RuntimeError` remains a controlled transport test. The
trap fixture states whether its trap occurs before dispatch or after completed
native publication; neither proves arbitrary failure inside commit.

## Measurements and execution

Record exact source/build/fixture identities, literal outcomes, complete raw
failures, stage/publication, host-owned recovery, and cleanup. Distinguish native
logical resources, JS timers/handles, sampled actual-instance WASM memory
capacity and optional process RSS. A sampled maximum is not allocator-live bytes
or an exact peak. Existing normative/operational limits and their units remain;
no threshold is selected after results. Current mandatory repository checks and
separate installed Chrome/Safari observations precede one build-only CI and
independent exact-SHA review. Firefox remains experimental.

No CMS deployment/storage migration, stopped OSR-38 campaign, broad survey,
screenshots/video/traces, mobile/CJK/collaboration or AT/conformance claim is part
of this contract. Rollback reverts OSR-67 and restores the previous coherent
pair while retaining host recovery data.
