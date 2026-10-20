# Transient availability status — source-authored invariant

**FROZEN BEFORE REGRESSION AND IMPLEMENTATION; NOT ACCEPTANCE.** Bound to committed
`ba41330e177c1e1cce21f985fb20d61f6982b4f7`. No active UI210 artifacts were read.
Only completed `/tmp/osr-42-reason-layout-development-02` was inspected.

## Concrete finding

All12 distinct canonical RL02 artifact records (4/engine) start with an empty
status. At both “empty terminal” and “same browser-protocol coordinate” checkpoints,
mode is editable and UI results are empty, yet statusText still says “Finish
typing to use this action. (dom.composition_conflict)” / “Завершите ввод, чтобы
применить действие. (dom.composition_conflict)”. Reason-layout raw observations
independently record the same text. Existing tests had passed12/12 while checking
actual control availability, native/browser/layout preservation and cleanup;
none asserted that restored availability removes this stale live message.
This is an actual stale lifecycle reason, not a recorded action/result message.

`packages/ui/src/ui.ts:425` writes the current host guard into live status.
`:426–427` clears only loading on a validated available refresh. The snapshot
failure path `:405–406` invokes `#disable`, whose `:507–512` writes another reason.
`#showControl` (`:514`, used by rejected down/activation `:213/:538`) also writes
current availability. The identical mode-blocking writer can retain stale
mode text after restoration; that transition is a source-backed inference here,
not an additional measured RL02 mode-restoration outcome.

## Additive invariant before the correction

The polite status may describe a CURRENT transient lifecycle block, or preserve
independent action/host-dialog/result feedback. When an exact validated refresh
observes available/current context, clear a message owned by loading or the
expired current composition/mode availability episode. The blocked control's
current guard reason, including a rejected attempt that only exposes that guard,
is transient. No automatic semantic retry, result callback, native command,
selection/focus/scroll write or new public API follows from clearing it.

Retain a newer independent action refusal/result, host unavailable message,
stale-dialog/callback diagnostic, or move result on an otherwise successful
refresh. Do not infer ownership by string equality or matching a diagnostic
substring: a host may deliberately return identical text. Track private writer
provenance (a finite status owner/episode or equivalent), changing it at every
feedback writer. Automatic guard writes and `#disable`'s lifecycle path need
separate ownership from `#show`, host/result writers and error feedback; do not
make every `#disable`/UiFailure transient. Clear only the still-current owned
transient message after all existing stamp/context availability checks pass.
This does not require a feedback history/queue or new announcement text.

## Required additive assertions, preserving existing tests and counts

1. **Existing RL01×4:** after empty terminal and actual `aria-disabled=false`,
   require live status `''`; after original up require `''` again. Keep all
   fixed native/canonical/objects/range/focus/flow/same-target/no-replay/CSP/resource
   assertions. This source-authored empty literal means no current block and no
   action/result feedback in this zero-change case; it is not a native golden.
2. **Existing R01 readOnly/disabled:** after explicit editable restoration and
   actual enabled Strong, before the fresh Strong click, require status `''`.
   Keep the blocked nonempty-reason/zero-submission assertions and later one
   fresh action. Existing C01 can assert the same before its fresh action.
3. **Existing P01 NC014:** retain actual `notes.invalid_attribute` feedback;
   perform an ordinary public UI refresh and require exact previously observed
   feedback text plus the independently frozen diagnostic code, unchanged
   result/native/submission facets. This proves a current available refresh
   cannot blindly erase actual host/native refusal feedback. Keep all existing
   query-before-complete, zero-submission, canonical/state/cleanup assertions.

No tests were edited or run before this freeze. This contract neither weakens old assertions nor
claims final UI210/local9/installed/review completion. Exact source/data hashes
and compact per-record facts are in `source-readback.json` beside this note.
