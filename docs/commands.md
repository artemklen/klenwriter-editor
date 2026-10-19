# OSR-35 — commands and exact availability

The native bootstrap command API composes a frozen compiled provider with the
same sparse transaction engine used by raw dispatch. `core` owns generic plans,
local references, presentation and typing state; `engine` owns preparation and
publication; `kwdj` owns document, URL, mark, list and reference policy. There is
no KWDJ/DOM/CMS dependency in generic core/engine. The transport SDK and extensible
public descriptors retain OSR-63/64 gates.

`CommandRequest` captures session/generation, document revision, selection epoch,
typed actual intent and tightening limits. `query_command` performs the entire
publication-free prepare. `execute_command` repeats the identical guard, compiled
catalog lookup, metered plan, sparse operations, normalization, structure/profile
validation, final selection/typing validation, checked counters, maps/material
and journal preflight, then publishes once. An available result predicts Changed
or Unchanged and presentation; an unavailable result carries the same stable
reason and typed error as execution with those exact facts and limits. Contextual
hints or a previously queried result grant no execution authority.

Preview uses a private allocation cursor with the real ID representation and
counter checks. Split/fragment/duplicate reservations share that policy. It does
not advance real allocator high-water, clone a Session/Document, save/restore a
counter or return preview IDs/material/maps. A sealed allocation mode prevents a
preview patch from being published. A failed real edit may consume abandoned IDs
under the existing ABA rule. Mutable facts/network callbacks and cached authority
are absent; changed facts require a fresh query.

One WorkMeter covers planning and all transaction phases, before bounded scans,
payload copies and vector growth. Catalogs contain at most 256 exact namespaced
ASCII IDs of at most 128 bytes, with duplicate/case-sensitive validation. Plan
operations, refs/depth, marks, metadata, text, normalization, work/copy and journal
limits remain finite. Limits and counters can refuse after planning without
changing any committed facet. Raw byte-work and journal sizes are conservative
logical costs and depend on target representation; portable semantics, work
boundedness and within-target query/execute equality are compared across targets.

`SelectionIntent::MapFromUserResult` resolves and validates the requested caret
immediately after user operations, then maps only the normalization suffix and
validates again. This retains a valid caret when normalization joins/retires a
created leaf, without allowing normalization to hide invalid user-frame offsets.
Raw `Set` continues to address the final candidate. Direction and affinity remain
explicit. `LocalRef` permits only prior-operation created roots and bounded paths.

Collapsed formatting changes a session-local future typing override: `None`
inherits, `Some([])` means explicit plain text. The companion `InsertText` consumes
this policy. State-only toggles advance the context epoch once, leave document
revision/dirty/action count unchanged, and do not mark an adjacent leaf. Actual
state-only context changes seal an open [typing group](history.md) atomically.
Navigation,
remount and close clear it; identical navigation/no-op retains it. Raw dispatch
resets to inheritance on an actual document/selection change. Command Keep/Set/
Inherit is revalidated against the final candidate and entire final selection,
including code/reference policy. Document commits own actual before/after mark
state in event and retained journal used by [OSR-36 replay](history.md); unchecked
restore is not exposed.

Three generic bounded range operations close ordinary composition gaps:
`PatchMarkRange` applies one uniform exact-key mark delta to all selected text;
`ReplaceInlineRange` replaces a same-parent inline range with an optional childless
Text/HardBreak/InlineAtom prototype; `MoveInlineGroup` moves contiguous inline
siblings preserving IDs. All outer endpoints are checked in the original logical
EGC context, including styled-leaf boundaries and Child/Edge forms. Only internal
splits of an already validated complete range are private. Existing per-leaf
scalar/EGC guards remain; there is no public scalar/origin privilege flag.
Unrelated marks and inline barriers survive. Same-block split commands move the
intact suffix before deleting an old separating range, avoiding an artificial
intermediate EGC boundary rejection.

KWDJ publishes16 typed command IDs and9 registered slash candidates. Enter handles
paragraph/heading boundaries, code LF and basic nested/task/list split/exit/lift
without flattening tails. Shift+Enter inserts a bare hard break (code uses LF).
Paragraph/heading and lossless code/quote/list transforms preserve compatible
layout and authored payload. Selected incompatible contexts refuse as a whole.
Formatting uses all/none/mixed presentation; toggle removes iff every eligible
selected text already has the mark. URL/title/identity checks use the authoritative
KWDJ validators. Ordinary set/unset refuses any intersecting reference link.
Structural intents take explicit node/parent/index, never infer multi-selection.
Duplicate has fresh IDs, move retains IDs, and last-root removal creates a legal
empty paragraph atomically. Slash acceptance requires an exact registered target,
captured range/literal and fresh request tokens; prefix/suffix/layout survive one
atomic delete+insert. Escape is a no-op command seam; keyboard handling belongs to
its later host gate. Future domain/media/table/poetry algorithms return precise
unavailable reasons. See the [baseline disposition](command-parity.md).

OSR-39 appends `org.klenwriter.kwdj/command/delete-backward` after the original15
commands. Its closed payload is `{"kind":"delete_backward"}` on both SDK ABIs.
Rust deletes the previous pinned EGC across styled Text leaves, or prepares the
existing empty InsertText replacement for an actual selected range. At a block
start it joins compatible paragraph/heading siblings under the same root or
simple blockquote, retaining the left identity and the pre-join caret seam.
Code-block text supports EGC deletion, while its block-start join, inline barriers,
lists/domain boundaries and lossy type/attribute joins refuse atomically. Only a
first eligible top-level start is Unchanged. `Keep` typing state is revalidated on
the final candidate. The [frozen DOM contract](../contracts/dom/v1/README.md)
supplies independent exact T02/T03 history/identity/caret and Unicode literals;
shared native/WASM command and SDK1/SDK2 witnesses exercise them.

The24 [independent literal vectors](../contracts/commands/v1/vectors.json) were
chosen before implementation. Actual native/WASM witnesses compare their complete
canonical document and exact semantic path/caret/direction/affinity, not a relaxed
caret equivalence. Exact large JSON integers travel in canonical strings, avoiding
JS Number rounding. Additional generated preservation/refusal cases, future typing
and structural/inline regressions supplement these illustrative vectors.
`npm run test:commands` writes `artifacts/command-report.json` with source/binary
hashes and portable target comparison. A counted profile proves zero ordinary
snapshot/admission/canonical-buffer hooks in the24 literal,68 generated and
future-typing witnesses; explicit test checkpoints are separate. Structural and
inline supplemental observers use the real plain KWDJ profile and do not claim
this counter instrumentation independently.
Generic non-KWDJ provider tests cover preview allocator purity, final typing and
late refusal/counter/normalization paths. Full gates remain CONTRIBUTING.

These results establish headless native and compiled-WASM behavior. Mounted input,
IME, UI focus, public extension registration, CMS host integration and user-facing
undo retain their own tasks. Corpus codec authority/expectations and persisted
schema remain unchanged. Rollback is a source revert.
