# Pointer gesture rejection — additive contract draft

This extension is authored before implementing the pointer admission correction.
Frozen UI v1 and the independent v1.1 toolbar manifest stay byte-for-byte intact.
Installed development03 remains FAILED; its untrusted terminal has no native-call
clock evidence, so this extension neither diagnoses its exact gesture phase nor
reclassifies that run. This policy follows existing C01: only a fresh action after
composition terminal may submit.

An owned primary unmodified left-pointer down is one gesture admission attempt.
If availability, active tasks, or exact capture refuses that attempt, its later
positive-detail click MUST NOT re-evaluate availability and dispatch after a
composition happens to settle. Rejecting down is not a pending semantic command.
The one gesture decision is consumed before the click can call host callbacks,
query availability, capture, open a popup or submit. No replay, queue or timer is
introduced. A fresh pointerdown replaces the previous decision and is evaluated
normally. Its matching click can use only that fresh admitted decision.

A positive-detail click belongs to the latest owned-down decision for the same
actual Control object. When click exposes a nonnegative pointerId it must match;
a MouseEvent without pointerId uses only that latest same-Control decision. A
missing/refused/mismatched decision cannot activate. A decision is consumed once,
so duplicate late clicks without a new down cannot revive it. UI-owned key Enter
and Space continue through their existing key handler. Zero-detail activation
continues through its existing keyboard/AT-compatible path; no real AT claim is
inferred from a synthetic click. No DOM ID or class is action authority.

Bookkeeping is one bounded private WeakMap with at most one weak Control key,
replaced at each owned-slot down and each click. It retains no DOM element,
command, native input or host request strongly. No global event pump, pointer
capture, extra resource counter or command semantics is added. Popup item down
must explicitly admit the gesture before its existing early return. Both an
unavailable control and a failed capture leave a refused decision.

`pointer-gesture-cases.json` supplies independent fixed expectations. Its q
replacement is authored from frozen geometry F selection T1..5, not an observed
candidate output: q produces Aqאב, keeps the entire rest of F/IDs, collapses at
T2, and has one native document/history unit. PG01 then proves NO additional
submission, mutation, selection/history/stored-mark or DOM/focus change from its
same rejected gesture. PG02..05 keep fresh pointer, Enter, Space and zero-detail
compatibility. The regression draft uses controlled Composition/Pointer events
with real mounted SDK/native settlement and is not an OS-input lane.

Implementation is gated on parent contract commit and an actual pre-fix RED for
PG01. The supplied source patch is a draft, not an applied change or verdict.
