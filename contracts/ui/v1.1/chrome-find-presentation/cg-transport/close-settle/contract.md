# CL01 — passive preparation before Chrome Escape phase observation

SOURCE_AUTHORED_BEFORE_CANDIDATE. This append-only installed-harness policy
changes no key program, ownership predicate, deadline, acceptance assertion,
public API or result schema. It does not establish a Chrome transition-duration
bound or the cause of an earlier failure.

## Completed observation

Chrome22 targeted modes run at a24acc437b97a96804964fd20b10a6f18f19f6b7
remains FAILED: EN modes PASS, RU modes FAILED,28 excluded rows,18 actions.
Immutable report: /tmp/osr-42-installed-development-a24acc4-22/chrome/chrome.json,
SHA2561c3bf98eaf95993b1d5e570b1c31edee0466c7a4b725228b1f7ecfca7c57fbea.
The root reports both original Escape posts complete, then a third post-phase
sample refused the generic auxiliary predicate. Which attribute differed and
whether AX teardown caused it are unproven. This new policy does not reclassify
that completed failure or catch a refused measurement and wait for it to pass.

## One bounded wait, before any post-phase query

Only after ALL original normal `close-find` posts have returned, and BEFORE its
FIRST post-phase measurement, read the existing monotonic clock once for this
decision. If `deadlineMs - elapsedMs > 266` (250+existing16ms result reserve),
request exactly ONE passive250ms `Thread.sleep`. This is preparation for the
following read, with no AX query, event, activation, focus call, authority or
input retry during the wait. No wait is added to normal Find, either UP-only
cleanup, Zoom, AS, Safari, per-post checks or an incomplete key program.

If remaining<=266, skip BOTH this wait and normal close's post-phase measurements:
return its already complete core with the existing UNOBSERVED postcondition,
reads0/proof null. Do not replace the policy by an immediate measurement with
known insufficient wait allowance. Keep the same result keys/diagnostic shape.

After the requested wait, re-read current monotonic time through the original
loop condition. Only remaining>16 permits a phase measurement. Keep CS01's
maximum12 full original-owner reads, existing<=64ms waits after opposite-phase
success, and immediate stop on ownership refusal. Strict final CLOSED, CF root,
nonce/title/PID/bundle/front/focused object, original frame, exact auxiliary,
containment and all other checks remain. No ownership assertion is made about
the unsampled passive interval; every later proof is fresh and grants no input.

A sleep/measurement can overrun. No1s budget is restarted or extended. If the
wait leaves remaining<=16, return complete core + UNOBSERVED/reads0. An exact
complete core returned late remains known-completed but fails Node's original
phase/deadline checks, with no redundant UP. A killed/opaque response retains
original unknown semantics. The original normal2 Escape posts and original
one-UP cleanup are unchanged; no second down or replay is allowed.

## Predicate-specific diagnostics, identical reads

Split only the current compound open-auxiliary guard into sequential guards.
Preserve short-circuit order and one read per original getter: other-object
count/binding, exact title, role, subrole, rectangle, four containment comparisons.
No new property read, title/text value, broader window observation or helper
field is added. Every failure still has diagnostic.code `ownership`; stop at the
first failing original predicate. The six exact reason literals are in cases.json.
Other ownership diagnostics are unchanged. These buckets apply to the same
existing measurement function, not a weaker close-only ownership path.

## Evidence and scope

Existing elapsedMs records the total wait cost; add no requested/actual-wait
field or other ACK/postcondition key. Original complete-core-before-phase rules
remain. Existing177 Node test names/assertions and browser216/overall972
inventory stay unchanged; the data cases are source expectations, not new
mirror tests or executed checks. No compiler, helper, GUI or input during
contract authoring. Candidate source is allowed only after root source review
and freeze; actual installed behavior remains unobserved for this policy.
