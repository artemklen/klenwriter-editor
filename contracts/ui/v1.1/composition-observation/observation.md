# Additive composition observation proposal — source01

Preparation only, before future observer changes; no execution, acceptance or
native-oracle revision. Keep the original Chrome03 FAILED and its raw bytes.

Current `ui-host.js:87–100` records exact request/response strings and ordinal,
but no native-call times. `page-fixture.mjs:13–23` records terminal trust, while
its open flag closes only on trusted compositionend. Chrome03 therefore has an
untrusted terminal before trusted pointerdown yet still reports open:true.
Native publication cannot be ordered against that pointer from old call records;
Chrome03 cannot retrospectively become UNOBSERVED or PASS.

Future pass-through observation records `startedAt=performance.now()` immediately
before actual.call(originalRequestBytes), and `finishedAt=performance.now()`
immediately after return, before parsing/bookkeeping. Preserve original request
and response bytes unchanged, ordinal, mount and same-document clock identity.
An exception retains its actual provenance and absent response; it proves no
completed insertion. This is bounded call ordering, not performance evidence.

Record EVERY composition terminal with isTrusted and event order; keep trust
separate from observed-ended state. An untrusted terminal never establishes a
native-positive composition outcome.

Only classify UNOBSERVED when a genuine current preedit checkpoint contains a
trusted start, an explicit terminal precedes trusted pointerdown, and exactly one
predeclared expected native composition InsertText completed with finishedAt <=
pointerdown.time. Require exact original request/response and unchanged existing
semantic checks; no deferred toolbar command. This reports loss of the gesture's
protected-window opportunity, not successful protected composition.

Otherwise retain ALL existing DOM/object/range/focus/native preservation and
fixed settlement assertions. Missing times, wrong clock/mount, overlap, extra or
mismatched commands and ambiguous order are FAILED, never guessed. The three
source-authored ordering cases below introduce no new canonical/output goldens.
