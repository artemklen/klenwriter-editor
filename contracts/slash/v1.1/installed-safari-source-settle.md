# Safari passive settling after an actual layout change

Authored at a63be81 before this settling candidate or its physical run.
Safari01 remains FAILED: EN10 PASS, RU first query-w FAILED, remaining9
NOT_RUN. The main key13 attempt has unknown delivery; its single original
matching key13-UP cleanup received a completed ACK. No additional key-state
read or input is required. Bootstrap and the failed action both observed two
AX windows. Their count does not identify the front-window refusal's cause.

For Safari only, after a real TIS selection while the fixture adapter is live,
retain the existing250 ms wait and coherent source readback, then request one
fixed1000 ms passive delay and obtain another fresh coherent source readback.
Record the requested duration, actual monotonic elapsed time, original and
latest readbacks, and any failure. The delay's elapsed time must be finite,
nonnegative and below2000 ms; otherwise fail before further input. Return the
latest verified source status. A failed read is not retried.

This applies only after navigate completes and before adapter close starts.
Keeping an already selected layout returns before this preparation. Original
source restoration after browser departure keeps its original five readbacks.
No source reselection, page/native request, Apple Event, activation, focus,
resize, new helper, synthetic event or input is added by this settling step.
The frozen composition opportunity receives no additional wait inside preedit.

This is an operational settling assumption, not readiness, window identity,
ownership, delivery or timing-cause evidence. It guarantees no subsequent
success. Every physical action still obtains all original fresh page, source,
Carbon, PID, AX, exact System Events front-title and one-second guard-to-post
checks. A later refusal remains FAILED and stops new input. Original attempts,
cleanup statuses, fixed action inventory and assertions are not rewritten.
Chrome and its separate passive window preparation are unchanged.
