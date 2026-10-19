# OSR-39 independent semantic/oracle packet V3

Status: SOURCE/DATA DRAFT FOR PRIMARY FREEZE BEFORE ADAPTERS. OSR-39 is authorized
In Progress by primary; this packet is no runtime result, acceptance or formal
review. The stale intake/start header in the copied primary document is historical;
the latest primary assignment supplies start authority. No repository/Linear/Git
write, native/WASM/browser/test/capture occurred while authoring this packet.

`acceptance-oracles.v3.json` is the complete behavior oracle. `inputs/` are literal
wire inputs; `expected/` are independently constructed exact canonical UTF-8 with
no BOM or final LF. `semantic-literals.v3.json` fixes the full documents before
candidate code. `source-pins.json` pins the exact authorities actually read.
`prior/` preserves V1/V2 byte-exact, with no replacement of their contents.

The independent constructor is `construct-packet.py`: it contains only literal
semantic/scenario authoring and stdlib file/JSON/hash operations. Its canonical
routine sorts object keys by Unicode scalar order, preserves arrays and exact
integers, quotes Serde-compatible controls and emits all other scalars literally.
It rejects floats/custom values/lone surrogates: this packet deliberately contains
no floating-point canonical expectations. No engine/profile serializer/parser,
Node adapter, SDK, native executable, WASM or browser supplies an expected value.
Canonical-v1 authority is ADR-004/OSR-77, not RFC8785/JCS. The large ordered-start
integer is written as an exact integer and is never rounded through JS Number.

V3 replaces former OPEN decisions by the primary contract: one privately composed
headless controller; ready after renderer admission/first coherent render;
forwarded subscriptions with one patch per actual event; explicit Rust-only
DeleteBackward; exact twelve KWDJ nodes/nine marks and independent Notes D0;
SceneBreak is BlockAtom, MediaImage is not; no viewer fallback; payload-aware
command/stored-marks/history closure; bounded affected-region reconciliation;
WeakMap/owned model binding and owner-document-unique DOM IDs; protected composing
subtree with owned pre-teardown recovery; UI guard modes distinct from immutable
native read_only; temporary real admission/disposal and captured-stamp recheck for
replacement. Model/IDs/history/canonical authority remains Rust. Temporary preflight
IDs never become final IDs. T01–T12 retain all original four AC.

## Accepted additive native command

Native KwdjIntent::DeleteBackward / SDK KwdjIntentDto::DeleteBackward{} use ID
org.klenwriter.kwdj/command/delete-backward and exact payload_json
`{"kind":"delete_backward"}` in SDK1 and SDK2. Append to old15 order; preserve old
vectors. Delete previous pinned EGC across style seams; noncollapsed range deletion
is one internal prepare, never a preparatory public SetSelection. Join same paragraph
or heading type+equal attrs/same parent, synthetic-root/optional blockquote ancestor
only. Lists/table/domain, hard-break/atom boundaries and code-block-start join refuse.
First top-level block start with no previous block is unchanged/no revision/history/
event. An existing incompatible previous block is an explicit typed refusal.

## Literal and identity obligations

T01: D0 exact `А😀 e\u0301\u00a0Z` (UTF16 8), right/first-line-indent, strong only
on TB; P2 `Бета`. SPACE and NBSP differ, no NFC/NFKC.
T02: Enter at P1 end creates only empty E; Backspace joins; six changes/revisions
1..6 each isolated. Undo/redo revive the same E; no authored empty Text/BR.
T03: `a😀b` strong splits at UTF16 1 into `a` / `😀b`; E/TR fresh, then retired,
then revived by replay. Join caret is old-left end T:1, not final text end T:4.
T04: X and independently queued Y have exact per-event states. Both listeners read
X before Y executes; direct return is never a second render/caret authority.
T05: scalar-safe versus EGC-safe positions, direction/affinity and styled whole-EGC
formatting are distinct. No extra raw operation/privilege endpoint is asserted.
T06: data strings never become HTML, handlers, styles or requests; nine marks and
twelve node types have a complete small valid catalog fixture. Native negatives
are anchored to closed model/metadata/URL/Notes literals, not renderer sanitization.
T07: valid Notes D0 is independent; D1 remains native-valid but renderer-missing,
with title/tags/callout/highlight payload retained. D0 cannot borrow D1 authority.
T08–T12: owned input through mounted ready, UI modes, explicit replacement/reset,
failed replacement invariance, cancellation/fatal/resource disposal and two mounts.
Selection/history tables use symbolic opaque IDs and document-revision strings;
selection/history epoch values are actual saved-stamp comparisons, never guessed.
Initial native selection is explicitly set where needed; it is not focus-on-mount.

Every real owner-document id, including host controls/two instances, must be unique.
Unchanged keyed DOM objects survive ordinary patches; revived model identity does
not require resurrecting an already detached DOM object. Browser-cloned ids cannot
authorize a model identity. Test-only observations must not create a public raw API.

## Composition and bounded failure

The cross-cutting fixture has committed `omega.` and provisional `o\u0301mega.`.
An unrelated committed `tail`→`tail!` patch preserves actual active subtree/Text
objects/provisional scalars/focus. Conflicts refuse/defer without stale replay.
Destroy first captures bounded owned original/provisional recovery, invokes the
synchronous host callback outside native borrow with mutations disabled, and returns
the owned packet even if callback throws. If capture exceeds bounds, preserve the
existing provisional region and stop conflicting writes; do not claim full recovery.
No exact new receipt/schema/name is manufactured. Native exactly-once IME settlement,
trailing input and complete cross-block composition remain OSR-41.

Bounds are 8 blocks/131072 visited DOM nodes/depth128/2097152 UTF16/4096 mutation
records per observation batch, counted before traversal/copy. Tighter existing
native/profile/transport bounds apply. No full export/root reconstruction per key;
initial render/replacement and test checkpoints are explicit separate boundaries.
These are work bounds, not performance promises or relaxed KWDJ admission limits.

## Remaining freeze items, not reopened behavior

Primary fixed names: mountEditor / MountedEditor, RendererCatalog /
defineRendererCatalog; config element/editor/renderers/mode/onRecovery/onRefusal;
facade ready/lifecycle/capture/context/read/query/submit/subscribe/
setInteractionMode/replace/destroy/resources/nativeResources/originalInput.
Modes editable/readOnly/disabled. Mounted SDK2 only, headless SDK1 unchanged.
kwdjBasicRenderers is the optional KWDJ catalog; notesD0Renderers is independent.
Exact declaration/receipt type shapes and new typed diagnostic codes/paths remain
for primary freeze; no extra overload/field/endpoint is invented.
Mounted SDK2 facade facts are immutable initial profile_options_json: mounted live
update_facts is refused. This does not erase profile-owned raw KWDJ endpoint
capabilities or change the accepted headless SDK63/64 contracts.
Native remount emits no ordinary event: explicit replacement renders once after
success; ordinary updates render events only. Internal renderer view errors stay
separate from native publication truth. The exact DeleteBackward ID/native intent/closed SDK1+SDK2 payload are now primary
accepted and fixed in deleteBackwardContract. New refusal taxonomy still requires
B/primary's exact existing stable code/path literals; none is invented here. This packet does not invent
native diagnostics. Code paths already frozen in existing closed contracts retain
their exact published literals. The new ID appends to the unchanged old fifteen-ID order. Additive generated
DTO/catalog implementation and actual compatibility evidence remain future work.

Automated Chromium/WebKit/Firefox experimental and actual installed Chrome/Safari
RU/EN keyboard/focus traces are separate evidence. WebKit is not Safari. All-engine
harness/integrity failures block; Firefox behavior GAP is published, not job-skipped.
M0 historical gaps are unchanged; this packet does not complete OSR40/41/47/50/65/67.

## Append-only draft3 binding overlay

All original C draft2 files remain at the parent directory; the four changed
metadata/data documents are also preserved byte-exact under prior/c-draft2/.
The 19 semantic documents, 19 input files, 19 canonical byte files and 17 closed
negative cases retain their original bytes/expectations. construct-packet.py is
retained historical authoring provenance: it was not run for this tidy-up and does
not reproduce this later binding overlay. This directory is a proposal for primary
review, not an implementation or a declaration freeze.

Exact accepted member name is replace; replace(input) was prose invocation
notation. Optional KWDJ catalog path is @klenwriter/editor-kwdj/dom.
T05.symbolicPathBindings identifies the initial fixture and symbolic path table
for every subcase. Eplain/AccentStrong in the formatting fixture and
Plain/AccentStrong in the backward-delete fixture are separately captured opaque
identities. Deletion retains Plain, retires AccentStrong, and Undo revives the same
historical token. No DOM ID, path-derived serial or cross-fixture alias authorizes
a native identity.

mountedBoundaryBindings records the already selected SDK2 facts/remount, first
internal renderer listener and owned-input ready boundaries. It does not add a
queued SDK hook or treat committed view failure as atomic native refusal.
Exact result/recovery/oversize receipts and position/DOM diagnostics remain
unfrozen, as does the final replacement idle/busy policy. The copied A mounted
API proposal is explicitly unaccepted; no dom_refused code or result shape is
introduced by this packet. See pending-items.json.
