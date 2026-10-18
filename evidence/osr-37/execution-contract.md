# OSR-37 — accepted execution contract

18.10.2026. Refine/technical acceptance: main Codex, implementer; authority is
owner's project instruction and technical delegation recorded in OSR-26,
architecture v2.0/master plan v3, ADR-003/004 and accepted OSR-33/34/35/36.
The four original Linear AC remain unchanged and mandatory. No product-scope,
production or publication permission is inferred from this technical contract.

Fresh intake: standalone, parent null, zero children, no comments, full list
hasNextPage=false; blocker OSR-34 Done, related foundation OSR-36 now Done.
OSR-37 blocks38/63/69. Base main is e6c6762952050b62fad30e7a5456ed5607adbb9d.
ci_mode=standalone, ci_owner=none. This contract supersedes unaccepted /tmp
proposals, not the accepted architecture or original AC.

## Outcome and choice

Local input must stop repeatedly traversing/serializing unaffected documents.
The current source has full normalization, generic structure, header/preflight,
normality, count-serialization and semantic/identity walks despite no snapshot
hook call. Zero snapshot calls alone is insufficient evidence for AC1.

Choose admitted-baseline, profile-owned incremental proof and compositional
metrics with sparse prepared updates, plus one engine-owned revisioned event
store and guarded read/snapshot APIs. Reuse the authoritative KWDJ rules and
serializers on justified scopes. A full codec round trip on every edit fails
AC1. A separate permissive local validator risks semantic divergence. Merely
wrapping the same full walks in a cache also fails the purpose.

A generic opaque profile may explicitly use a metered full fallback; this is
reported separately, not advertised as affected-scope performance. KWDJ is the
actual optimized first profile. No new runtime dependency is planned.

## Incremental validation and complexity

An admitted tree, immutable profile binding/context/effective limits and current
generation/revision bind the reusable proof. Runtime summaries are separate
from frozen configuration. All cache construction and retained payload must be
bounded; initial admission/remount and explicit export may traverse the document.

Prepare exact impact from old and candidate records, both parent chains,
inserted/deleted/moved subtrees and normalization/replay effects. Reuse static
validation only where payload and relevant inherited context remain proved.
Local metadata, sibling constraints, owning table/verse and moved descendants
must invalidate the actual required scope. Never use a hash collision, stale
revision or caller-supplied 'already validated' flag as authority.

Global byte/node/depth/preflight maxima use compositional summaries produced
by the same rules/serialization as full validation. Preserve closed syntax,
normalization order, unsupported-data erasure guards, exact text, table geometry,
profile ancestry constraints, Unicode and typed error paths. Comparisons with
the full authoritative path include tight limits and multiple failures; do not
weaken or quietly reorder diagnostics to make a fast path pass.

IdentityResolver is synchronous and unversioned, and can change through interior
mutability. Recheck current facts for all distinct currently referenced IDs on
each relevant validation, including references outside the changed subtree.
An exact maintained occurrence index may avoid rescanning every node, but an
inter-transaction fact cache is not valid authority. Preserve first occurrence
and current missing/unavailable refusal semantics; retry is safe.

Normalization must visit justified invalidated scopes using the existing local
and sibling rules, including destructive metadata checks before erasure. Generic
shape proof must also avoid a full DFS for an ordinary proven-local edit.
Final profile validation, typing finalization, history, impact/cache/event plans,
checked counters and all resource/copy budgets are prepared before publication.
Queries use the same feasibility and work path without publishing cache changes,
outbox records, counters, dirty stamps or IDs. No whole-cache clone per input.

Publish only sparse prepared cache/tree/event deltas in one infallible final
phase shared by raw dispatch, command execution and history replay. Expected
refusal/noop/failed remount preserves every committed facet. Successful history
replay uses fresh monotonic revisions and identical validation/impact rules.
No snapshot or full canonical byte buffer is created by ordinary input.

Actual counters distinguish structure, header/preflight, normalization,
serialization/counting, static semantic visits, identity checks, cache reuse,
impact/events and explicit export. Count work before scanning/copying. A local
edit may cost O(changed block bytes + required sibling/ancestor scope + distinct
references + bounded retained metadata), with BTree lookup factors documented.
Wide child-vector edits, ranges, moved subtrees and table/verse constraints may
cost their affected scope. Global operations/fallbacks are named and measured.
No O(1), 1ms, total-RSS or callback-CPU promise.

## Dirty impact, ordered events and read API

One real document publication r→r+1 appends exactly one immutable event after
all preparations succeed. It carries SessionKey/generation, before/after
revision and selection/history context, chronological position map, final dirty
state, actual changed/upsert and removed IDs, and deduplicated old/new dirty
ancestors including the synthetic root. Removed IDs are tombstones, not readable
upserts. Moves invalidate both chains; normalization and replay contribute once.
The same closure invalidates render/stat consumers without inventing product
word-count semantics in generic engine.

Actual selection/stored-mark/history-barrier/baseline state changes have state
events without a document revision or fake undo entry. Document+selection changes
stay one coherent document event. Identical selection, duplicate boundary,
no-change dispatch, refusal and query append none. Event sequence is checked u64
per generation, independent of document revision; eventful overflow refuses
atomically while a true noop at MAX remains a noop.

Session owns a bounded immutable pull outbox. Hard limits:64 ordinary records,
16MiB per record and32MiB aggregate event payload/metadata, host reductions only;
these are separate from history retention/work limits. Account maps/IDs/marks,
containers and shared ownership accurately, and prepare all copies/evictions
before publication. An external retained handle is not counted as engine-owned
RSS. Payload beyond a limit gets an atomic typed refusal.

Pull reads have session-bound cursors and explicit Gap/Resync when a caller is
older than the unprotected retained prefix. Never silently skip or coalesce
revision records. A bounded protected live cursor pins undelivered records;
full count/bytes backpressures eventful mutation before it changes the document.
Acknowledgement advances only validated monotonic consumed positions; duplicate
ack is harmless, future/stale/foreign ack is explicit. Event retention does not
extend chronological bookmark map retention.

Guarded per-node/block reads require expected session+revision and return only
requested borrowed/shallow data/children and stamps, never the full persisted
document. Changed-node/ancestor revision stamps allow consumers to detect reuse.
A stale request refuses, including removed/retired IDs and generation changes.
Bounded event batches are ordered and repeatable; acknowledgement is explicit.

Session never invokes external code during publication. OSR-37 implements and
proves native notification storage/delivery primitives. OSR-63 owns JS listener
registry/handle disposal and the public mutation queue that serializes both
external and reentrant submissions until an event's listeners have consumed it.
The SDK must recheck captured tokens when draining; Queued is not Completed.
This division follows63's explicit callback/lifecycle scope and does not defer
any of37's dirty/event/snapshot AC. No arbitrary Rust callback framework or
unbounded opaque command-intent queue is introduced merely for future bindings.

## Explicit snapshot and saved baseline

An export receipt owns canonical profile document bytes and a coherent stamp:
SessionKey/generation, document revision, profile binding and event cursor.
The profile remains the sole canonical codec authority. Export validates current
facts, is explicitly O(document), has typed stale/state/profile failures and
changes no committed facets. Preserve the existing guarded byte-export API as
a compatibility convenience if needed; do not export on every event/read.

Acknowledging a save uses an engine-issued snapshot stamp/receipt for this
session, not an arbitrary old revision or history depth. Save r at current r+1
may update the known saved baseline but cannot clear dirty r+1. Duplicate/out-of-
order acknowledgements cannot roll the baseline backwards. The saved bytes may
be retained only at explicit snapshot/save boundaries under bounded document
limits; use exact equality, not a hash-only proof. Undo does not infer clean.
At an explicit current snapshot comparison/ack boundary, equality with saved
canonical content may establish clean without changing document revision.
Selection, marks, navigation and event cursor do not change persisted equality.
HTTP/ETag, IDB durability, recovery cadence and switching policy remain OSR-69.

Successful remount prepares all admission/cache/event state before replacement,
then creates a new generation, empty history/maps/outbox and clean initial
baseline. Old cursors/receipts/reads fail stale; failed remount preserves the
original complete session. Close/poison cannot be prevented by full outbox or
sequence MAX: expose terminal lifecycle state/notice outside ordinary append,
invalidate protected delivery and permit no mutation/read through closed handle.
Do not promise recovery after a real trap. Native originals/review evidence and
CMS/prod resources remain outside task implementation.

## Verification and delivery

1. Native plus compiled-WASM literal contract witnesses for local/nested edits,
   structural move/delete/duplicate/ranges, normalization and undo/redo. Assert
   exact upserts/tombstones/old+new ancestor closure, stamps and ordered events;
   queries/refusals/noops produce none. Literal expectations precede observations.
2. Incremental-vs-full authoritative equivalence over both profiles, all operation
   families and bounded generated sequences; include identity changes on untouched
   nodes, erasure guards, ancestry/table/verse, Unicode, seven semantic maxima,
   operational limits, cache context/revision mismatch and late atomic refusal.
3. Tight event limits, protected cursor/backpressure, gap/batch/ack, counter MAX,
   state-only changes, read-only/stale/closed/poisoned, successful/failed remount,
   stale save and exact baseline equality. No callbacks run in Session.
4. Phase counters and size-series benchmark distinguish ordinary local work,
   structural work, identity work, admission and explicit export. Traces must show
   no ordinary full export/static validation sweep or hidden whole-cache copy.
   Use accepted performance protocol for comparative timing claims; report raw
   samples/overhead/noise, no unsupported latency promises. OSR-38 broadens fuzz,
   release budgets and JS-boundary measurements, not a replacement for37 proof.

Version docs, literals, receipts, source/artifact hashes, native/WASM report and
provenance. Run applicable pinned-toolchain/MSRV/workspace/license/package/M0
checks locally; preserve frozen M0 evidence byte-exact and record new observations
separately. One prepared CI, fresh independent exact-SHA full Grok4.7/xhigh/OIDC
review and verbatim publications/readbacks, normal merge, one post-merge CI,
cleanup/archive/closing/Done. Relevant repair rationale before another CI.
Rollback: revert source change; no persisted KWDJ/CMS migration, runtime deploy
or registry publish belongs to37. Full project continues after actual close.

PO verdict: Ready with assumptions. Native bootstrap API naming, exact internal
cache representation and bounded read-batch defaults are reversible technical
choices within delegated architecture; they cannot weaken the above behavior,
original AC or independent acceptance gates. No hidden owner blocker.
