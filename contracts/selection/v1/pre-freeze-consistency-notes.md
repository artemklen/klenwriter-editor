# OSR-40 pre-freeze contract/data consistency notes

Snapshot 2026-10-19T11:51:11.598900+00:00. Implementation/data assistance only; **not formal review, approval,
Ready/freeze permission or runtime evidence**. Root reports40In Progress on osr-40
from accepted mainff2bd31. Only current contract/source/font bytes were read and
this outside Markdown written. No repository/fixture/Linear writes, test/build,
browser/native/CI/network execution. Native/bookmark literal files are still being
authored by other helpers; this check does not assert their completeness.

## Material fixes and their current disposition

**1. Preserve narrow legacy read signatures while adding the ABI2-only read.**

[README](/Users/artem/projects/klenwriter-editor/contracts/selection/v1/README.md:24) accepts new
ReadRequestV2/ResponseV2, while mounted-selection proposal says old read signatures
stay. These are compatible only with additive **typed overloads**, not widening
all old reads to ResponseV2 or treating selection_text as a mutation. Root agreed
to write the exact SDK2/mounted overloads before freeze. Current public-api snapshot
contains V2 read names: **True**; inspect final committed declarations rather
than infer this decision from prose alone.

Minimum shape: old `read(ReadRequest):Response` remains narrow; new selection_text
request and a union ReadRequestV2 call return ResponseV2 (mounted adds DomRefusal).
SDK1 never admits the new request. Ensure `MutationRequestV2` excludes the **new**
read union; otherwise the newly generated BridgeRequestV2 variant can accidentally
become a queued mutation via Exclude. Original command Submission/completion types
remain unchanged. Refused/Fatal envelopes of the new read use existing diagnostic
shapes; no need to widen native command tickets or claim old KwdjIntent bytes remain
identical after deliberately appending command17.

**2. Terminal padding is feasible; active visibility needs its own invariant.**

The accepted20/40 padding, max1356 and exact endpoint paths are internally
consistent. R00 at min100..124 and R63 at max256..280 fit both clips. Down anchor
R04 at196..220 and up R59 at160..184 are initially visible. Root57 children and
138 nodes, nested rows24..31 and terminal raw paths are consistent with the literal
model; copied font/OFL match the independently authored pins.

This does not make a near-edge hit safe at arbitrary active scroll positions.
Example clipped down at scroll24: R08 row y268..292; a naive y279.5 edge hit lies
in a partially clipped row. Its row envelope is not a proof of whole caret
visibility. Root accepted the material correction: validate the **actual full
focus-caret rect before every published active focus/stable checkpoint**, with
bounded browser hit/projection probes. No semantic nearest-text guess, expected
endpoint injection, post-cancel scrolling or reselection may make it pass.

Encode that final rule explicitly in the authoritative README and test obligations.
Copied scroll proposal currently distinguishes recorded transient visibility from
mandatory stable/terminal visibility; it is provenance, so an explicit primary
override may strengthen the active rule without regenerating literal endpoints.
Do not silently let a test using only the older JSON's weaker visibility field
ignore the new obligation. Full caret visibility is about the actual collapsed
Range, not row boxes/selection-union rects.

**3. CP24 must preserve the already running first clipboard operation — corrected.**

The earlier CP24 zero-resource immediate oracle would have rewarded cancelling
someone else's pending write. Current CP24 now has phase “immediately after second refusal, first L3 writer remains pending”
with resourceEnd `{"pending":1,"continuations":1,"retainedTextBytes":3}` and separate
`afterFirstCompletesOrCancels` zero counts. That correctly distinguishes the
refused second operation from eventual cleanup of the first. The retained3 bytes
must be checked against the final native L3 projection when its literal lands;
do not derive it from a candidate's writer payload. CP18 busy-before-write and
other composition/mode/foreign guards are split rather than one wildcard error.

**4. CP20 must retain the actual transport category — corrected.**

Existing [SDK #fatal](/Users/artem/projects/klenwriter-editor/packages/sdk/src/controller.ts:248) emits
`sdk.transport_failure`, category `transport`, path empty/details empty, current
cached stamp and may_have_committed=true for mutation. Current CP20 category is
`transport` (root fixed old `sdk`). Keep the original
native/SDK ticket. CP19 `session.stale_revision` / `stamp.revision` / category sdk
matches [existing stamp checker](/Users/artem/projects/klenwriter-editor/crates/bridge/src/convert.rs:90).
The controlled CP19..22 boundary provenance must remain distinct from native
semantic success literals; no synthetic failed ticket is production execution proof.

**5. Native access and UI readOnly are distinct — corrected in current README.**

Current clipboard policy now says cut requires **both** UI editable and native
edit access: immutable native read_only ⇒ dom.native_read_only (CP10); UI readOnly
on a native-editable session ⇒ dom.mode_blocked (CP27). Copy/select remain allowed
with actual owned host selection; disabled blocks controller interaction. This
matches the existing distinction where general host programmatic writes may remain
available while a new user-facing clipboard cut is blocked. Preserve another
control/mount's range, and do not make toolbar ownership a generic clipboard bypass.

## Narrow clarifications before freeze; no future-scope expansion

- **Controlled cancel versus UA/physical cancellation.** Current12 cases label a
  synthetic pointercancel as controlled only; README gives real focus-loss its
  own provenance and installed active release/focus return. Retain this distinction.
  Dispatching synthetic cancel does not make the UA release a still-held real
  pointer or stop its own native selection/autoscroll. The controller must actually
  release its owned capture/RAF and preserve the required stable range. Any harness
  physical button cleanup must be separately labelled and must not be the hidden
  cause of the alleged cancel quiescence. No requirement to invent a physical
  pointercancel or to expand the desktop RPC is added here.
- **Supported clipping is rectangular.** overflow:clip avoids creating an extra
  scroll container and fixes this fixture. Freeze border-radius0, clip-path:none,
  mask:none and no other nonrectangular clip in its setup assumptions. For product
  geometry outside the supported axis-aligned rectangular chain, use the declared
  explicit geometry refusal instead of claiming intersection of client rectangles
  models arbitrary clips. No custom layout engine is requested.
- **Monotonic is logical, not y/scrollTop.** Keep the fixed ASCII/LTR fixture's
  monotonic focus check in independent raw DOM document order (including owned
  Child/Edge representations), alongside valid native owned points. Comparing only
  row y, native token strings or screen x is insufficient. Do not impose a fixed
  transient focus; terminal endpoints and directed anchor remain exact literals.
- **Cancellation has no post-stop assist.** At most one passive settlement frame
  observes/synchronizes UA effects, then five stable100ms samples with range left
  in active cases. It cannot perform another active scroll step. Record every
  publication/sample anchor so a temporary lost anchor cannot be repaired away.
- **Pure clipboard read stays pure.** README's borrowed profile-owned projection
  avoids prepare_tree/ReadOnly rejection/ID allocation. Copy of scalar-readable
  EGC interiors and atom-only semantic nonempty ranges must not be replaced by cut
  query permission. Query command17 only for cut before external write; preserve
  stale/write-failed/late external outcomes. This is the accepted minimal40 seam,
  not an added full47 HTML/paste/import/multiformat requirement.

No contradiction was found in the authored F1 forward/backward formatting
canonical slices: selected b/cd/ef/gh/i gain strong; scene/hard_break/list/task
structure and outside a/j/code sentinel remain literal. Identity/map/epoch details
for the pending native/bookmark data remain the owning helpers' pre-freeze input;
this note does not manufacture their expected outputs or require widening scope.
All five original AC remain required; Firefox experimental labeling cannot hide
configured semantic, data-loss, ownership or setup failures.

## Byte pins of this bounded snapshot

Root is still resolving the contract; these are observed bytes, not a declaration
that a manifest is frozen. Existing39 source paths below were read only as evidence
for exact compatibility/diagnostic facts. No runtime was executed.

| Path (repository-relative) | Bytes | SHA256 |
|---|---:|---|
| `contracts/selection/v1/README.md` |16815|`84c0a0f40e2f07ecebb020aac43f72f65bfd915fb383a11264f5d1b27e5975da`|
| `contracts/selection/v1/public-api.ts` |3817|`a1945acfb1a700204da8cb309c18094e0b0b5d5784e7766716dfe6c817a79422`|
| `contracts/selection/v1/clipboard-oracles.json` |15183|`4af63134ef75f9e401ab8e39007869094b791fad301b7896f52266f9bf008098`|
| `contracts/selection/v1/formatting-oracles.json` |12192|`10295fce4cf05c4bb12428e49cdefa553e33f9846f2914a4d2cc22d2a9f8c421`|
| `contracts/selection/v1/scroll-oracles.json` |191863|`7709f232db057e76fff0db76a6c187bc884c61ee9641025db3f81de4c4f45350`|
| `contracts/selection/v1/mounted-selection-design.md` |26566|`b4e003b821dcc98bdf231cf049243e56c324ef125512e3d53b524a81d613b252`|
| `contracts/selection/v1/native-range-design.md` |32783|`01ccad830b711aceeb5330e1252706e1f5850e0edc7568111e1828d86c51c213`|
| `contracts/selection/v1/legacy/dom-types.v39.ts` |6208|`8ec05a6e8d3804d9fc9d8c466478adfc60bad2d8860e21e3efb16a274bd2e033`|
| `tests/fixtures/fonts/JetBrainsMono-Regular.ttf` |114904|`b6b1ff4ddefe36d7f2a6174e1d001cab374e594519ee9049af028d577b64c5f5`|
| `tests/fixtures/fonts/JetBrainsMono-OFL.txt` |4492|`4d9694c4844a13ea377458c3f98c90d2bf83d3c214612dcae2b7808406520708`|
| `tests/fixtures/fonts/README.md` |498|`5e490f2865fcbe0684ac72e44f7ebb60f7dc59e479bb8818b3ae2f5c0002f08d`|
| `packages/sdk/src/controller.ts` |22958|`e3298c859a25737ef4cbe7a4d1ee89df5a3cb93c7cb82ce9a256a61231953718`|
| `crates/bridge/src/convert.rs` |13259|`c2a8303ca7ea4a88c5b395add6860e536b69875e0b1b7ec036f7d65acc10a815`|

The final freeze must bind the resulting authoritative README/API and literal files
after root's accepted changes. This assistance supplies no formal verdict.
