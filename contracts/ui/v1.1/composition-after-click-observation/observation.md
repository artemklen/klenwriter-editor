# Separate after-click terminal observation — additive source contract

Authored after original Chrome04 FAILED and before any candidate implementing
this separate subset. Original Chrome03/04 receipts, default BEFORE-DOWN
classifier, all existing CO tests and frozen v1/v1.1 bytes remain unchanged.
No production input/DOM/UI semantics or additional native request is introduced.

A terminal strictly before the distinct pointerdown can close the observed UA
preedit opportunity while its one native InsertText is still settling. This is
not evidence that a conflicting UI command was accepted. A separate explicit
AFTER-CLICK classifier may return only UNOBSERVED, never protected-gesture PASS
or positive evidence from an untrusted compositionend, when ALL of these hold:

- Reuse every existing bounded mount/context/clock/trace-prefix/trusted-start,
  genuine current preedit, original request/response and full fixed native
  settlement assertion. Current default classifier semantics are unchanged.
- Exactly one explicitly observed terminal is strictly before one trusted,
  primary, unmodified matching down/up/positive-detail click on the same actual
  fixed target. Record actual click.detail, event.isPrimary, targetObject and the
  existing closed pageGuard.targetObject (same bounded WeakMap token). Preserve
  trust, actual ordering and pointerId; labels/DOM IDs alone are insufficient.
  Down precedes up;
  up precedes or equals click. Click must follow down in recorded event order.
- Exactly one predeclared isolated composition InsertText starts AT OR AFTER
  click.time and returns AT OR BEFORE the genuine final checkpoint. No other
  semantic mutation/command, unknown completion, extra generation or terminal.
  Completion during down/up/click or ambiguous order is not this subset.
- Preserve exact preedit→gesture actual dom.html, rootObject, objects, directed
  raw selection, active object/focus identity and documentFocused. No UI results,
  host dialog opening, focus result, pending UI or mounted host request. Final
  state is ready, errors/CSP/overflow absent. No synthetic acknowledgement.
- Full unchanged native semantic verification still requires exact canonical
  bytes/IDs/outside node payloads/selection and original native response,
  revision/selection/history deltas, marks, event counts and one undo unit from
  the predeclared source input. No after-result generated expected golden.

The coordinator retains the original default FAILED observation diagnostically,
then may separately evaluate this subset. Only the separate successful proof
can give a FUTURE run UNOBSERVED. Otherwise existing FAILED/preservation checks
remain authoritative. No two-command exception or generic late-publication
acceptance is added. Existing extra-Strong CO03 negative stays FAILED in both
classifiers. Additive synthetic ordering literals are policy controls only, not
native/browser/OS evidence. A new actual run is required after contract freeze
and implementation. Original Chrome04 is never retrospectively reclassified.


## Notes early-spacing input extension (before Notes composition execution)

`notes-early-accent.json` independently authors the NotesD0 spacing U+00B4
counterpart from the existing Notes42 source input `ab`, exact T1 caret and its
public `{text}` InsertText schema. Result `a´b`, T2 caret and all IDs/root title/
tags remain exact; revision/selection/history each+1, one document event/undo
unit, null stored marks. The41 P18 string proves the already frozen one-unit
spacing input spelling, not a transferred KWDJ result for Notes. Native Notes
command semantics supply its own profile authority. No Notes runtime result was
read or learned to author this extension. Existing KWDJ acute/Notes é literals
stay unchanged. This binding may only identify an early completion; it never
converts untrusted end into positive protected-window acceptance.
