# OSR-40 contract preflight — proposals for fresh Refine

Implementation assistance only, not formal review39, approval, Ready/start/freeze,
or authority to execute any native gesture. Input:
[/tmp/osr-40-selection-contract-draft.md](/tmp/osr-40-selection-contract-draft.md).
Only source/doc reading and literal arithmetic were performed; no source, Linear,
browser, native, build, test or network actions. Root reports39 merged/approved
`ff2bd31`, postCI running and39 still In Review until actual close. The draft's
opening “formal review running” is therefore historical; fresh dependency readback
must precede40 start. All five40 AC remain required.

## Resolve before freezing the oracle

**1. The proposed clipped terminal geometry is impossible without extra scroll extent.**

For64 contiguous rows of24px, content height1536, scrollport y80/h240 and no
padding: maxScroll=1536−240=1296. Effective clip is `[100,280]`.

| Boundary | Row box at available extreme | Consequence |
|---|---|---|
| R00 at scrollTop0 | y80..104 | Its upper part cannot become visible: negative scroll is unavailable. |
| R63 at scrollTop1296 | y296..320 | Entire row lies below effective clip, even at maximum scroll. |

Recommended reversible fixture choice: freeze **top padding20, bottom padding40**
as extra fixture content extent, not authored model rows. Height=20+64×24+40=1596;
maxScroll=1356. Then R00 at minimum is y100..124; R63 at maximum is y256..280.
Both complete row boxes fit clipped100..280 and plain80..320. General bounds are
`paddingTop≥100−80=20` and `paddingBottom≥320−280=40`.

Freeze where padding lives, border-box/margins/borders, row/atom/nesting heights,
font asset+hash/loaded status and exact client/scroll heights. These numbers prove
feasibility of a24px caret envelope; they do not manufacture an actual caret rect.
Keep actual positive-height collapsed-Range measurement and ≤0.5px tolerance.
Alternative: make the clip equal the scrollport or enlarge the visible clip, but
choose and commit geometry before a candidate, not after a failure.

Also freeze **initial setup versus gesture**: down starts at minScroll; up at
maxScroll (then R59 is y160..184 with proposed padding, so anchor is visible).
Allow literal setup scroll only before gesture/first checkpoint. The blanket ban
on direct scrollTop currently also forbids preparing the up case. During/after
candidate gesture no scrollTop/wheel/scrollIntoView/reselection assistance. Freeze
mousedown anchor coordinates, held x/y, actual viewport→screen conversion, pointer
ID/buttons, hold deadline and cadence. Final terminal target remains exact R63:3
or R00:0; do not replace it with “last currently visible row”.

**2. Public text units must be named UTF-16 throughout.**

The heading “UTF-16 ↔ native scalar bridge” and “scalar offsets0,2,4,5,7” invite a
wrong scalar-index implementation. Actual `PositionDto.text.offset` is a checked
u32 **UTF-16 code-unit count**; validation requires a Unicode-scalar boundary.
No public conversion into scalar ordinals or UTF-8 bytes occurs. For 👩🏽‍💻, valid
UTF-16 offsets at scalar boundaries are0/2/4/5/7; EGC endpoints0/7. For `e\u0301`,
UTF-16 offset1 is readable but is not an authorized EGC edit boundary. Rename the
section/table accordingly; retain half-surrogate refusal unchanged.
Sources: [DTO](/Users/artem/projects/klenwriter-editor/packages/wasm/src/sdk-types.ts:28),
[wire rules](/Users/artem/projects/klenwriter-editor/docs/sdk-v1.md:105),
[ADR Unicode](/Users/artem/projects/klenwriter-editor/docs/m0/unicode-positions.md:20).

**3. Exact affinity cannot be inferred from a newly observed DOM Range.**

Native DOM anchor/focus objects+offsets carry direction, not model insertion
attachment. Current39 maps new Text/Child points to `after`; retained exact owned
endpoints preserve prior model affinity. Draft up terminal requires `before`, but
has not specified how an actual pointer gesture creates that affinity without
injecting the expected model endpoint. Freeze one explicit new-endpoint policy,
plus provenance for preserving a bookmark's before/after. Keep affinity separate
from RTL direction and forward/reverse range order. Author independent expected
model and DOM tables under that policy; do not compute expected affinity using
candidate mapping. See [positionAt](/Users/artem/projects/klenwriter-editor/packages/dom/src/view.ts:168)
and [retention](/Users/artem/projects/klenwriter-editor/packages/dom/src/view.ts:240).

**4. selection_epoch alone is insufficient user-intent provenance.**

A document command can remap selection and advance its epoch; a real user can
reselect the same endpoints and native no-op will not advance it. Thus “epoch
changed ⇒ user intent” and “epoch unchanged ⇒ no user intent” are both unsound.
Freeze a small state table: bookmark ownership/context/generation, captured stamp,
current native stamp, controller intent serial and event provenance. An owned
pointerdown/new selection intent invalidates pending restoration even if endpoints
stay equal; document-only maps do not authorize overwriting later user/host intent.
Default ambiguous provenance refuses. Explicit mapped policy may use native map
results only for named authorized contexts, with final current-stamp validation.
Do not reconstruct a semantic map journal in TS: public `map_position` already
composes retained native maps from source revision to current revision.

Specify capture as current **model** bookmark versus synchronization of an actual
pending DOM range; these are different operations. If capture is read-only, it
must not secretly publish set_selection to catch up. Freeze null-selection,
expiry/capacity/release and foreign-object outcomes. Also resolve queue behavior:
refuse bookmark restore while busy/reentrant, or preserve an actual queued native
Submission and its stale outcome; never invent cancellation of an already queued
native mutation. Passive map completion must not focus or clobber another host.
An explicit focus-return action must clearly transfer focus ownership before
restoration; “never overwrite any external-control range” cannot simultaneously
mean “never allow explicit return from that control”.

**5. The “history unchanged” scroll oracle conflicts with current native selection effects.**

`Session::set_selection` no-ops for identical selection; a changed selection clears
stored_marks and may seal an open typing group, changing history epoch without a
new undo unit. Draft AC5 says history remains unchanged, whereas earlier text says
“only as native specifies”. Freeze native outcome facets: document/canonical,
revision/dirty/IDs and undo/redo **entries** unchanged; selection epoch/events,
stored marks and barrier/history epoch exactly as native specifies. Add an open
history-group + stored-marks fixture and an identical-selection no-op control.
Do not demand a new history unit or hide a native barrier change.
[Source](/Users/artem/projects/klenwriter-editor/crates/engine/src/session.rs:485).

**6. Clipboard success and range deletion need a concrete minimal seam.**

The current public DTO/catalog has no copy/cut/selected-fragment export command;
internal `cut_inline_range` is not a public clipboard capability. Draft correctly
calls for inventory, but “copy/cut native range” is not yet executable API design.
Freeze one native-authoritative projection/admission seam and one guarded native
range-deletion command for positive cross-list/atom cases; do not implement a JS
semantic slice or call any generic subtree Remove equivalent to a selection cut.

Specify what **successful clipboard write** means. `ClipboardEvent.setData` only
populates the event payload; it is not independent proof that OS clipboard write
succeeded. Async write can fail or settle after a new selection/document command:
write old content may be observable, but deletion must refuse if the captured
stamp/intent is stale. External clipboard write and model mutation cannot be one
atomic transaction. Require failed/stale write ⇒ no deletion, successful write +
current guarded target ⇒ one native deletion, and honest partial external outcome.
Freeze exact plain-text separators/atom projection and literal structural
membership without U+FFFC-as-native-character. Keep HTML import/sanitization/paste,
full multi-format47 and global clipboard handling outside40. Decide separately
whether installed OS clipboard round-trip is required evidence or a labelled
additional lane; do not leave an unbounded47 deliverable implicit.

**7. Terminal, active-cancel and ownership samples need separate budgets.**

The12-case matrix is useful, but freeze numerical held deadline/cadence, settlement
budget and active release/cancel trigger with **remaining** scroll range. Decide
whether full caret visibility is required at every in-progress selection sample
or only named stable checkpoints; terminal visibility must remain mandatory.
Do not let sampling only before/after hide anchor drift between publications:
collect bounded pointer/selection publications and retained intent provenance.
Specify how native pointercancel is induced/proven (window focus loss is a
separate cancellation stimulus); synthetic dispatch does not prove a physical
pointer cancellation. No new general desktop-input RPC is authorized here.
Reduced-motion/zoom/mode/destroy/replace controls need named ownership/resource
baselines, not inclusion in a Cartesian native matrix by implication.

**8. Experimental Firefox is not an all-purpose acceptance escape.**

Freeze all five semantic/ownership assertions independently of the browser label.
Wrong offsets, data loss, stale overwrite, broken cancel or instrumentation/setup
failures cannot become experimental GAP. Any predeclared browser-specific behavior
must remain an explicit unmet measured requirement or its named OSR-73 follow-up,
not a passing case. Keep installed Chrome+Safari mandatory and retain identical
frozen literal expectations where the contract requires identical behavior.
Composition preservation remains39's floor; exactly-once settlement belongs41.

## Short Refine decision list

1. Adopt padding20/40 + exact row/scroll geometry, initial scroll setup and physical
   hit coordinates; or choose a different mathematically feasible fixture.
2. Fix UTF-16 terminology and new DOM-endpoint affinity policy before literal
   model/DOM endpoint tables are frozen.
3. Choose internal versus opaque public bookmark API, bounded lifetime, intent
   provenance table and exact/mapped/busy/null outcomes; no epoch-only permission.
4. Preserve native selection side effects in history/stored-mark/event oracles.
5. Name the minimal native copy projection/range cut seam and clipboard completion
   policy without adding full47; retain successful cross-atom/list operations.
6. Freeze scroll timing/cancel/visibility and Firefox disposition per requirement.

These are unresolved draft choices, not accepted API additions, code defects in39,
formal-review findings or permission to start40 before dependency close/readback.
