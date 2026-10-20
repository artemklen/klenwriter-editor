# SA02 — one passive Safari bootstrap preparation interval

SOURCE_AUTHORED_BEFORE_CANDIDATE. This installed-fixture addition changes only
when the first existing SA01 readiness call begins. It changes no AX proof,
containment tolerance, retry class, input transport or acceptance assertion.

Safari10 at c7a4214465d99ca6423096ec6d10714dfdc74595 remains NOT_RUN:
all30 rows NOT_RUN, zero input. Immutable report SHA256
0c4c576298501f3b8d973b8551483143e43cd7b07cc8911f80cbf4093b29ec41 at
/tmp/osr-42-installed-development-c7a4214-10/safari/safari.json.
The root records the full-shaped first proof with original owner and expected
viewport size but viewport{x:0,y:1132,width:1024,height:768} outside original
root{x:80,y:60,width:1024,height:820}; contained=false. Immediate refusal was
correct. That complete-invalid proof is not the old typed retryable refusal.
Whether Safari's initial AX coordinate presentation was stale is UNPROVEN.
No OS settling-duration guarantee or prior-run PASS is claimed.

## Exact location and policy

In the Safari adapter's existing navigate(), keep its ORIGINAL
`const deadline = Date.now()+15000` at the same entry. Preserve viewport bootstrap,
final page-client import and the successful same-origin page/broker handshake.
After the handshake loop has validated exact ready URL/title, and immediately
BEFORE the first prepareSafariAxReadiness call, perform exactly this preparation:

1. Read the original outer remaining budget. If remaining<=500ms, abort before
   waiting or invoking SA01; do not knowingly consume its remaining allowance.
2. Request ONE passive500ms wait through the existing timer helper. During that
   interval add no AX query, page RPC/read, input, focus call, activation, retry,
   ownership claim or other browser operation.
3. Read the SAME original outer deadline again. If remaining<=0, abort before
   SA01. A timer can overshoot; this policy is not a maximum-latency assertion.
4. Otherwise call the existing SA01 method once with the unchanged
   remainingNavigate:()=>deadline-Date.now() callback. Its existing private
   monotonic2000ms budget still starts inside that method; the original outer15s
   budget is neither reset nor extended.

No new result or readiness DTO field is required. The existing runtime timing
and execution records retain the later first sample. This is a one-time navigate
preparation interval, not a case/action wait or a retry after a bad proof. No
wait is added to any later input, sample, cleanup or Chrome path.

## Strict failures and ownership

SA01's at-most3 samples, at-most2 existing100ms waits,<=500ms sample timeout,
exact19-field success validation, bounds, nonce/title/PID/front/focused CF root,
viewport size and recomputed containment remain unchanged. Only the original
exact four-field typed not_sent/viewport-unavailable refusal may be retried under
SA01. A complete invalid proof, nonempty stderr, timeout/signal, ownership refusal,
foreign/malformed success, expired deadline or other failure still aborts
immediately. SA02 never catches such a failure, waits and re-submits it.

No proof or input authority is retained from before the pause. Fresh readiness
and all later original per-input guards remain mandatory. Existing six SA01 Node
controls and all177 unit names/assertions stay unchanged; browser216/overall972
inventory stays unchanged. The data cases are source expectations, not new
mirror tests or executed evidence. Earlier failed/NOT_RUN reports remain intact.

Candidate code is allowed only after root source review/freeze. During this
source authoring there is no repo mutation, compilation, helper or OS/UI/input
execution, and no acceptance claim for the new preparation policy.
