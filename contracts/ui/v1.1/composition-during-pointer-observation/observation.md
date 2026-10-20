# Separate during-pointer own-settlement observation

Source-authored after Chrome05 FAILED and before this subset's implementation.
Original BEFORE-DOWN and AFTER-CLICK semantics, all existing138 unit expectations,
old contracts and original03/04/05 receipts remain unchanged. No CSS/UI layout,
composition owner, native command or gesture admission behavior changes here.

The DURING_POINTER export may report ONLY UNOBSERVED for a missed UA preedit
opportunity, never protected-gesture PASS, when every stronger AFTER-CLICK proof
holds except its timing interval, replaced by these exact bounds:

`terminal.time < down.time <= native.startedAt <= native.finishedAt <= click.time`

Exactly one explicit terminal must precede trusted down. Require one actual
trusted matching primary unmodified down/up/positive-detail click, same pointer
and the exact actual guarded target object throughout. Native completion is
only the composition owner's one predeclared expected isolated InsertText,
with unchanged full original request/response/context/stamp/ID/canonical/marks/
history/event-count verification. Full genuine preedit/checkpoint clock, prefix,
finite limits and error checks are reused. No other semantic mutation or UI
command, no UI results/dialog/focus continuation/pending host request. Actual
preedit→final DOM HTML/root/objects/raw range/active object/document focus must
be exactly preserved. Missing terminal/click/time/identity or an unknown native
completion fails. Native calls are synchronous on this document thread: these
are event-record/call-entry/return bounds, not a claim of simultaneous or
partially overlapping execution inside an event dispatch.

BEFORE-DOWN still requires its original completion-before-down condition;
AFTER-CLICK still requires its original start-at/after-click condition and MUST
reject this during-pointer case. The coordinator retains both original failure
records and may separately test DURING_POINTER only when needed. Its successful
proof is not a generic interleaving/two-command exception or a queue/replay.

This subset cannot replace the independent CSS layout correction. Original05
remains FAILED because Add's up/click landed on BODY rather than the original
Add target; DURING_POINTER must also fail that foreign-target literal. No
retrospective acceptance or learned native-output golden is introduced. A new
real run after freeze/implementation is required. New finite units may reuse the
existing private controlled AFTER-CLICK fixture via append-only export without
changing any old assertion; this is no public product API.
