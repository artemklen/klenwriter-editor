# IME composition · OSR-41

OSR-41 adds a composition owner to the existing single mounted SDK2 host. This
guide describes the implementation and its frozen acceptance protocol. Browser
and installed Chrome/Safari acceptance is recorded separately in exact-source run
receipts; the presence of code, fixtures or commands does not assert a successful
run. OSR-39/40 results remain evidence for their original scenarios.

The normative source is [contracts/composition/v1](../contracts/composition/v1/README.md),
frozen before runtime implementation at `fd5439e`. Its state machine, structural
and event tables, independent native/DOM literals, installed matrix and manifest
must be read together. The existing [DOM](dom.md), [selection](selection.md) and
[SDK2](extensions.md) boundaries continue to apply. Full clipboard/paste47,
CJK/mobile input, real assistive-technology acceptance and Firefox promotion are
separate gates.

## Authority and ownership

Rust owns the document, EGC admission, normalization, selection, marks, IDs,
events and history. Composition uses the existing KWDJ `InsertText` binding with
isolated history; there is no public composition command, second SDK owner,
TypeScript document normalizer or DeleteSelection-then-InsertText transaction.
DOM and native offsets remain UTF-16 unit counts checked at scalar boundaries.
The adapter does not segment EGCs or normalize precomposed/decomposed Unicode.

One private composition owner per mount coordinates the input and view owners.
Before provisional ownership it synchronizes the actual directed selection and
captures the post-setup full SDK2 context/stamp, native range, local generation,
targeting serial, structural window and actual DOM objects. A failed or busy
checkpoint preserves available input instead of inventing a selection. The
generation is a checked local decimal u64, not a document or model identity.

While composing, the browser owns the actual provisional region. The adapter
does not format, normalize, detach, recreate or remount that region. A browser
may replace a Text object; this is different from an adapter remount. Copied DOM
IDs and newly created wrappers do not create model IDs or mark authority.
Selection bookmarks, pointer work and pending clipboard work are invalidated
at the owned input boundary. Conflicting formatting/history/move/replace/mode
operations refuse before dispatch. Existing narrowly admitted outside work must
preserve the protected objects; a newer native stamp or targeting intent makes
the old composition stale, even when the targeting operation was NativeNoop.

Admitted snapshot/receipt/barrier work does not reset the captured baseline.
An explicit barrier retains OSR-40's targeting-serial invalidation even when the
native barrier is a no-op, so settlement of that older composition becomes stale.
During the commit claim, reentrant public mutations, including barriers, return
busy before they can invalidate the claim's selection intent.

## Structural correspondence

Supported observations are one existing text block, or compatible same-parent
paragraphs with every selected middle paragraph/scene atom explicitly accounted
for. Paragraph → scene_break → paragraph can become one paragraph through one
native replacement. The scene is a selected structural entry, never flattened
into a newline. Cross-parent windows, unequal endpoint attrs, partial/unknown
atoms, noncontiguous windows and cloned ownership refuse correspondence.

The original exact endpoints delimit the unselected prefix and suffix. At
settlement their text, marks, attrs, structural membership and untouched objects
must still agree. Outside siblings/parents and metadata must remain valid. The
replacement is actual contiguous Text between those boundaries in an admitted
shape. Event data, longest-common-prefix matching, LF joining or browser labels
cannot supply a different replacement or recover missing atom membership.

The frozen cases include compatible paragraphs, selected scenes, actual Text
replacement, and strong `abcd` range1..3 with an untouched authored hard_break,
code `tail`, paragraph attrs and outside heading. The literals distinguish `я`,
precomposed `é`, decomposed `e`+U+0301 and spacing acute U+00B4. Native historical
IDs are captured and checked through undo; expected endpoint paths use literal
raw DOM child paths independently of the production mapper.

## Settlement and exactly-once publication

`compositionend` starts bounded observation; its data and trust are diagnostic.
An initial end checkpoint is followed by two equal complete reads at consecutive
RAF boundaries, without an intervening relevant mutation. The initial checkpoint
does not count as either RAF read. Changed reads reset the equality count without
extending the budget. The owner has at most eight post-end reads, one RAF and one
deadline timer, with a 250ms deadline from end. A callback first observed at or
after the deadline cannot dispatch. These are engineering bounds, not a promise
that every browser stream becomes quiescent in that time.

Before dispatch the owner synchronously rechecks the full context/stamp, original
native selection, targeting serial, complete final region and outside sentinels.
It claims the generation and retains recovery material before unprotecting,
native publication or host callbacks. There is no await between recheck and
submit. Complete unchanged correspondence is cancellation: no document command
or added undo entry after the declared baseline. Escape, blur and empty end data
alone do not mean cancellation; selection/marks/barrier epochs are measured
separately from document/history changes.

A changed admitted replacement uses one isolated native `InsertText`. The
original `Submission` remains authoritative, including a queued ticket and its
single completion. Queued does not mean success and does not permit retry. A
native Refused keeps its exact response; fatal/unknown retains possible-commit
truth. Reentrant callbacks and duplicate end/input cannot claim a second commit.
Exactly-once checks include the actual document event, revision, native IDs,
selection/marks, one undo unit and exact undo/redo, not just matching final text.

After success/cancel one bounded tombstone retains accepted native/DOM
correspondence. An unchanged duplicate is deduplicated. A changed or uncorrelated
tail is retained and recovers. A timer cannot relabel a late input as ordinary
typing, and an unresolved generation is never implicitly rebased over newer
host work. Blur requests observation; if no end arrives, its bounded watchdog
transfers the actual region and recovers without remounting an active preedit.

## A narrow ordinary-gesture boundary

After a settled generation, a fresh owned non-composing ordinary keydown can
prospectively permit one corresponding cancelable beforeinput. Complete stable
DOM, coherent native context/selection, current targeting intent, host focus and
no busy original ticket are all required. Printable input must match that
literal key; Backspace/Delete/Enter must match their existing command and
Shift-Enter distinction. The actual owned DOM range must correspond to native;
any supplied target range must also match. Keyup without input closes the permit.

Dead/Process, keyCode229/isComposing, modifier-only keys, Escape and an unresolved
composition-closing Enter do not establish an ordinary permit. A held-key repeat
does not prove a new gesture. A second unmatched key, noncancelable/mismatching
input, changed target or queued original completion is retained rather than
silently coalesced or queued. Ordinary typing without a composition generation
or tombstone keeps the existing input path.

This policy does not claim causal provenance for arbitrary streams. In particular,
the historical Safari early-space observation—U+0020 event data, U+00A0 observed
DOM change before a later Space keydown—remains ambiguous negative/recovery
evidence. Novel data, trust, elapsed time or the later keydown cannot retrospectively
authorize that input as a second composition or ordinary transaction.

## Recovery, limits and destroy

`RecoveryPacket.composition` is additive provenance. It carries the generation,
reason, captured context/base/directed selection (nullable when start admission
failed), affected IDs, original submission/response, native-outcome status,
unapplied input and disposition. The existing `originalInput` and `region` fields
retain their meanings. Hosts must keep this packet before presenting a refusal
or offering explicit recovery; recovery is separate from saving committed dirty
native state.

For a complete bounded capture, retain newest original/provisional input before
restoring only affected committed presentation through existing native rows or
guarded reads. A stale outside publication uses the newer committed authority,
never the obsolete baseline. Editing stops and `onRecovery` runs after storage.
The packet remains available if the callback is absent, throws or reenters.
Normal native refusal cannot be reclassified as success or retried; a failure
after native publication keeps that original published outcome.

| Observation budget | Inclusive maximum |
| --- | ---: |
| Structural entries, including selected atoms | 8 |
| Visited nodes, including consulted ancestors/sentinels | 131072 |
| Traversal depth, entry outer node at depth0 | 128 |
| Text per complete observation | 2097152 UTF-16 units |
| Mutation records across the generation | 4096 |

Budgets are charged before copying/pushing traversal work and cannot reset on
an event/update. Text is a unit limit, not a two-megabyte byte claim; authored BR
and diagnostic inter-block separators are charged, placeholders are not text.
Native/transport budgets can refuse earlier. An incomplete or over-limit result
is never truncated into success: the intact actual DOM region is transferred to
the host through `retained_dom`, with explicit ownership. Bounded text alone is
not a complete serialization of markup or atoms.

An unapplied subsequent input is either a bounded descriptor or, when too large
or unreadable, its original InputEvent/KeyboardEvent/CompositionEvent reference
with ownership transferred to the host. Retaining that existing capability does
not claim bounded recovery bytes. Capture precedes preventDefault, disabling or
callbacks that could otherwise remove the sole input.

`destroy()` stops owned listeners, observation RAF/timer and work, retains or
transfers input before release, and returns the same retained material without
repeating recovery notification. Original pending native completion remains
truthful and counted until terminal; it cannot replay into a new mount or mutate
an already returned immutable destroy receipt. Existing DOM resource counts
include composition continuations, bounded retained bytes and recovery regions.
Final receipts must show actual terminal SDK/DOM/selection/clipboard resources,
and preserve host-transferred recovery ownership separately. Closing a tab or
removing listeners alone is not a zero-resource proof.

## Independent data and authoring correction

The frozen data declares 30 native variants, 40 event-policy rows, 18 DOM cases
and 24 installed rows. These are coverage obligations, not executed pass counts.
[Erratum 001](../contracts/composition/errata/001-d11-outside-heading.json) removes
an invented outside heading from the DOM D/D11 fixture: unchanged native seed D
and P11 contain only one paragraph. It was found by source inspection before
mounted candidate execution and is labelled `AUTHORING_CORRECTION_NOT_ACCEPTANCE`.
Original v1 bytes/native expectations remain unchanged. The
[data loader](../scripts/composition-contract-data.mjs) validates the original
pins and applies only the exact declared replacements; the fixture server serves
this resolved DOM data. Candidate output never becomes a golden.

## Commands and evidence boundaries

After a coherent build, automated lanes are available separately:

```sh
npm run check:composition-contract
npm run test:composition:native
npm run test:composition:unit
npm run test:composition:browser
npm run test:composition
```

The contract check validates byte/hash/data relations without running the editor.
The native lane compares actual Rust with packaged sealed-WASM SDK2 against
independent literals. Node owner/transport suites label their controlled
boundaries; a stub process is not OS input and a fake SDK boundary is not Rust
semantics. The mounted browser lane uses real packaged SDK2/WASM and actual DOM
mutations with explicitly synthetic composition events in Chromium/WebKit/Firefox.
Its 18 DOM cases and three integrations of the event policy per engine measure
state/history, raw endpoints, actual objects, adapter writes,
recovery and resources, and stores `artifacts/composition/browser.json` plus raw
case reports. The aggregate is part of `npm run check`; `npm test` retains the
separate M0 scenarios. CI remains build-only. None of these commands executes the
installed physical protocol.

The [installed matrix](../contracts/composition/v1/installed-matrix.md) requires
Chrome 155.0.8059.85 and Safari 27.0.1 on the recorded macOS 27.0.1/26A434 baseline,
with fresh actual versions recorded by each run. Both en/ru host locales run six
cases per browser: ordinary-layout smoke, plain/marked/scene true composition,
Escape-preedit and blur/refocus. Ordinary US/Russian layout smoke is not IME.
True composition in both locales temporarily uses actual US Option+E then E,
expects pre-authored U+00E9, and restores the prior layout.

Escape/blur rows classify what actually occurred: unchanged complete cancellation,
the exact pre-authored U+00B4 native outcome, or retained recovery/diagnostics.
They cannot replace fixed `é` positives. Real P11 EGC refusal remains mandatory
on native/sealed WASM and actual packaged mounted controlled DOM; a physical
scalar-interior fixture is not assumed because a UA may expand it to an EGC.
No SDK-only mock substitutes for that refusal proof.

For an explicitly scheduled installed run with a clean committed candidate,
coherent build, existing macOS grants and exclusive foreground availability,
use fresh absolute output directories. Chrome uses the ordinary fixture server:

```sh
node scripts/workspace-server.mjs
node scripts/composition-native-acceptance.mjs --browser chrome --output /absolute/fresh/chrome/chrome.json
```

Stop that server before the separately started Safari broker:

```sh
node scripts/composition-native/server.mjs --directory /absolute/fresh/safari
node scripts/composition-native-acceptance.mjs --browser safari --output /absolute/fresh/safari/safari.json --broker /absolute/fresh/safari/config.json
```

The [closed transport](../scripts/composition-native/README.md) admits only fixed
fixture methods/actions, nonce/mount/case and foreground/AX guards, a one-second
action bound and no replay after unknown delivery. Actual trusted browser
keydown/up and composition observations are required; helper `sent`/exit0 or
correct final text alone is not an input acknowledgement. Safari page control
uses the bounded HTTP broker after bootstrap; physical System Events keys remain
a separately qualified AppleEvents channel. During composition the fixture does
not set text/ranges or repair the result.

Reports preserve first failure, later NOT_RUN, raw guards/events/tickets, exact
source/build/helper bytes and modes, layout restoration, all finish resources,
and cleanup of only the owned Chrome window/Safari fixture tab. Unknown cleanup
does not turn failure into PASS. WebKit does not prove Safari, synthetic events
do not prove physical input, and Firefox experimental policy never excuses
instrumentation errors, wrong data/offsets, loss or stale overwrite. Fresh local,
installed, CI and independent exact-SHA review receipts are still required
before OSR-41 acceptance.
