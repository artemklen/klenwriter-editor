# Revisions, render deltas and explicit snapshots

OSR-37 implements the headless engine part of architecture v2.0. The native
Rust API is bootstrap, not the final JS SDK. The four original acceptance
criteria and exact execution contract are in
[`evidence/osr-37/execution-contract.md`](../evidence/osr-37/execution-contract.md).

## Publication and revision tokens

`Session::stamp()` contains the opaque session/generation, document revision,
selection epoch and history epoch. A successful document change always makes a
fresh r→r+1, including undo/redo. Selection, stored typing marks, manual history
boundaries and saved-baseline bookkeeping do not invent document revisions.

Preparation constructs the complete tree, generic topology/metrics proof,
profile validation-cache update, history/map retention and notification plan.
Every expected refusal happens before any committed facet changes. Publication
consumes those owned plans; it performs no profile hook or external callback.
The same preparation serves raw dispatch, commands, history and their queries.
A query never appends an event or changes the admitted cache.

`CommitEvent::notification` shares the exact immutable record retained by the
outbox. Its before/after stamps, selection/marks, map, dirty state and projected
history/journal summaries describe that single publication. The legacy native
`CommitEvent` fields remain available; their maps are prepared before commit.
No record retains inverse history material or a persisted document snapshot.

A document event contains `ChangeImpact`:

- `upserted`: sorted unique final-present authored records changed semantically;
- `removed`: sorted unique retired/tombstoned IDs, disjoint from upserts;
- `ancestors_before` and `ancestors_after`: sorted unique old/final ancestor
  chains. Both include the synthetic root on every actual document change;
- `root_order_changed`: the synthetic root child sequence actually changed.

Root is not an authored upsert. Even deleting all affected authored records
invalidates the surviving root's new stats/order. A move includes both parent
chains. Normalization and history replay enter the same impact preparation.
Derived-cache writes, speculative IDs and net-noop recipes are not semantic
upserts or revisions. State changes produce one State event; a document edit
with a selection change stays one Document event. Refusal/query/true noop
produce no event, including when the event counter is exhausted.

## Bounded event delivery

`Session::open` uses64 retained records,16MiB per record and32MiB aggregate
engine-owned event payload/metadata. `open_with_event_limits` can reduce these
ceilings. The chosen limits remain in effect across remount. They are separate
from history retention, transaction work and profile document limits.

Without an attached protected consumer, the immutable ring may evict an oldest
prefix. `event_status` exposes the head and oldest valid last-consumed cursor;
`events_after(key,cursor,read_limits,work_limits)` returns an ordered borrowed
batch. Repeating a read does not acknowledge it. A cursor older than retention
returns explicit `Gap { oldest_after, head }`, never a silently shortened stream.
Recover using a current stamped snapshot/read and restart at its captured head.
Event retention does not extend bookmark map retention.

A live binding calls `protect_events` at Now or an available cursor. Its opaque
capability owns the one protected delivery position. Pending records cannot be
evicted. Count/byte pressure refuses the next eventful mutation atomically;
the binding consumes the pending event and acknowledges it, then retries the
same still-valid request. Only validated monotonic acknowledgements advance the
position. Duplicate ack is harmless; future/foreign/stale capabilities/cursors
have structured errors. Release invalidates the capability. Engine admission
and public data reads do not require CommandProvider or a command-intent queue.

Close/poison are terminal even at full capacity or sequence MAX. A fixed
out-of-band terminal notice invalidates protection without consuming an ordinary
sequence. Normal reads/mutations refuse on the closed/poisoned handle; delivery
status remains inspectable. Successful remount replaces outbox, proof cache,
history, selection and baseline only after complete new admission, with a new
generation. Old cursors and receipts are stale. Failed remount preserves all
original facets, including pending events and protection.

Session contains no listener registry and invokes no user callbacks. OSR-63
implements JS handle/listener disposal and the public mutation queue. That queue
must serialize external and reentrant submissions until all eligible listeners
of event r finish; otherwise their guarded read at r could already be stale.
Queued is not Completed; captured revision/context tokens are checked when
actually executed. These bindings cannot bypass the engine's native protected
cursor/backpressure semantics.

## Small render/stat reads

`node_at(key,revision,id)` returns a borrowed shallow `NodeRead`: the coherent
stamp, the record's latest dirty revision, exact generic subtree stats and its
current `TreeNode`. Children stay IDs. Reading one block does not recursively
construct a persisted document. Stale revision/generation and removed IDs refuse
explicitly. Consumers decide how far to traverse the requested block.

The sidecar stats contain authored-node count, UTF8 bytes, UTF16 units and
subtree height. Synthetic root contributes no authored node. These are neither
word counts nor a sum of per-style-run graphemes; product text projection and
word-count policies remain profile/host concerns. Dirty ancestors invalidate
both render state and stats. Stats/stamps do not become persisted KWDJ or
historical semantic records, and undo never restores an old dirty revision.

## Explicit export and saved state

`export_snapshot_receipt(key,revision)` performs current authoritative profile
admission/codec work at an explicit full-document boundary. The immutable
`Snapshot` owns canonical profile bytes, exact binding, stamp and event head.
It contains no session node IDs. The existing `export_snapshot` returns guarded
bytes as a convenience. Both fail on stale/state/profile/operational errors
without changing any committed facet. Engine output has a16MiB operational
ceiling; KWDJ's2MiB semantic maximum remains stricter.

The snapshot's trace counts actual engine tree/output copies. The profile's
explicit admission/codec enforces its own authoritative budget; the engine
trace does not invent the implementation cost of an opaque profile hook.
No event, read, ordinary input or dirty-state query exports a snapshot.

The host calls `acknowledge_snapshot` only after it has saved those exact bytes.
This is a host assertion, not proof of an HTTP or IDB commit. An acknowledgement
for r at current r+1 can advance the known saved baseline but keeps dirty r+1.
Older acknowledgements cannot roll the baseline backwards; duplicates are
harmless. A current saved receipt clears dirty without changing document
revision. Save acknowledgement is state publication and obeys event capacity.

Undo always leaves conservative dirty state. At an explicit current snapshot
boundary, `matches_saved_baseline` reports exact canonical byte equality at the
time of export. Export alone does not mutate dirty. `reconcile_saved_snapshot`
can establish clean from a current immutable equal receipt; it does not infer
clean from revision/history depth, trust a hash collision or move a saved
revision backwards. The engine retains one exact baseline only at admission or
explicit acknowledgement, never a full-document copy on every character.
HTTP/ETag, idempotency, IDB durability, cadence and recovery switching remain
OSR-69.

## Profile-owned incremental proof

`FrozenProfile::Cache<I>` is trusted compiled profile state implementing
`CandidateCache`; `()` is an explicit unoptimized fallback. A default seed and
default `TransactionProfile::{normalize_scoped,validate_scoped}` preserve generic
profiles that use full validation. KWDJ overrides these hooks with typed static
memos and sparse prepared updates. No runtime downcast or KWDJ policy enters the
engine. Wrappers of actual KWDJ forward its cache hooks instead of accidentally
benchmarking the full fallback.

The engine provides `CandidateChanges`: actual net old/final records and a dirty
forest with direct payload/order changes, old/new parents/ordinals and only
invalidated child edges. The view grants no publication/admission authority.
Queries prepare it independently. Topology sidecars preserve child ordinals,
exact sums and height distributions without cloning a wide ancestor's child
vector for a text change. Structural edits retain their real child-vector and
subtree costs.

KWDJ reuses the same closed decoder, local/sibling normalizer, serializer and
business-rule walker on justified scopes. Compositional summaries enforce byte,
node, depth and borrowed-preflight limits. Same-serializer local wire lengths
include escaped strings, presence/omission, delimiters and commas; String.len
is not JSON length. Moves/type changes recheck inherited contexts and affected
subtrees; owning table geometry is rechecked when relevant. Unsupported data
cannot disappear through destructive normalization.

External identity answers are never retained as cross-transaction validity.
The synchronous unversioned resolver can change even for an untouched node.
An exact occurrence-owner index rechecks current distinct referenced identities
in document order. Its cost is explicitly proportional to current references.
The prepared sparse cache publishes only with the matching tree revision;
no whole-cache clone occurs on ordinary input. Full diagnostic/unproved-profile
fallbacks are named and traced rather than advertised as local work.

`CommitEvent::trace` separates Structure, Header, Preflight, Normalization,
Serialization, StaticValidation, Identity, CacheReuse/Update, Impact, Event,
Export and FullFallback observations from logical `WorkUsage` limits. Counting
hooks alone cannot prove absence of a hidden full pass; size-series traces must
also show unaffected document width does not grow ordinary validation work.

## Verification boundaries

The inherited 512-cycle history recurrence and 512-commit metadata fixture open
a one-record event outbox, alongside their one-action history and one-map
journal, to measure steady state after two warmup cycles. Their original
publication counts and 32 KiB work ceilings remain unchanged. Native event tests
exercise the default 64-record outbox over 1536 appends; the native/WASM delta
lane exercises cursor gaps with an explicitly reduced two-record outbox.

Native engine tests cover event storage and complete publication/export facets.
The delta lane uses actual KWDJ native/compiled-WASM observations with independent
literal expectations, phase/size series and source/binary hashes. Native timing
samples are separate from portable semantic parity. Full authoritative
comparison and explicit snapshots belong to test/benchmark boundaries, never
the ordinary implementation path. OSR-38 broadens fuzz/release performance and
JS-boundary gates; OSR-63 packages the public SDK. Neither replaces the four
OSR-37 criteria. No CMS runtime, persisted schema or registry publication changes
are required for this headless delivery.
