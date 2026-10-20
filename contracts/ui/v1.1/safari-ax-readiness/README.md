# Safari AX readiness — SA01

Source-authored before candidate. Add one private, bounded READ-ONLY readiness
step inside Safari bootstrap after its existing exact page/broker handshake and
before the first physical action. Use the existing unchanged guard.swift
--inspect-window; no AX actions, keys, pointers, resize, activation, input replay,
permission requests or settings changes. It is not a new input guard or editing
authority; every later action retains its original fresh page/AX/fixed-AS checks.
Original Safari04 remains FAILED; no predicate or assertion is weakened.

At most3 sample executions, each request/parent timeout<=500ms, and at most2
fixed100ms passive waits. Entire readiness step has a private monotonic2000ms
budget contained within the ORIGINAL navigate15s deadline, never restarted. Each
sample gets only positive integer floor(min(500,remainingReadiness,remainingNav))
ms. Before a wait ensure100ms plus positive next-sample allowance remains; all
returns/waits check both budgets. No fourth sample or retry after timeout/unknown.

Retry ONLY an actual exact old-helper exit2 result with closed4-field JSON:
status refused; delivery not_sent; reason exactly
`Unique measured AXWebArea viewport unavailable`; finite elapsedMs>=0 and
<=request.deadlineMs. It must come from the exact fixed helper command/argv
--inspect-window plus that serialized closed6 request, empty stderr, no process
error/signal. This one structural not-ready bucket may take another sample after
the passive wait. Any other refusal, wrong ownership, malformed/extra fields,
foreign/invalid success, nonempty stderr, overdeadline, signal/timeout/unknown
completion aborts immediately. No fallback predicate or retained authority.

Success validates EXACT old19 fields, current nonce/title/url/Safari bundle,
positive Int32 actual frontPID, title equality, bounded window/node/depth/match
counts, finite positive rectangles/edges and recomputed containment. AXWebArea
size must be1024x768 within2px; axMatchCount1, windows1..32,nodes1..512,depth0..32;
elapsed must fit request and both outer budgets. Old helper internally verifies
genuine focusedCFroot and rechecks original process/title before returning. JSON
does not export a CF identity across processes; do not invent one. If an original
owner PID is already independently known, success must also equal it. Readiness
success is preparation only and never reused to authorize any future input.

Evidence: the separate cf0 read-only owned-window episode observed one1024x768
AXWebArea and one AXScrollArea at80,112, root1024x820 at80,60,45nodes/depth10,
115.8ms, stable before/after exactCFroot/frame/PID. This confirms only that episode.
Safari04 failure cause remains UNPROVEN; a CSS hypothesis is not confirmed. Its
failed first guard sent no editing input. No old report is reclassified.

Six independent finite process-stub controls S01..S06 are defined in cases.json;
no valid helper/OS execution in those tests. Existing167 assertions unchanged;
expected173units, UI216/overall972 browser inventory unchanged. Source expectation
is not execution, formal review, installed pass or acceptance waiver.
