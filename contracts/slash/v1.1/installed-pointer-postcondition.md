# Bounded pointer DOM acknowledgement observation

This rule is authored at `daf9ec6` before its candidate or next physical run.
Chrome04 remains FAILED: the original helper posted its down/up pair, but no
DOM pointer event was observed through cleanup. The saved successful Chrome03
uses the same target point and geometry. The cause of the missing events is
unknown; an asynchronous platform post alone is not a DOM acknowledgement.

After one original pointer pair, the coordinator may inspect the same owned
mount at most nine times, separated by 25 ms passive intervals (at most 200 ms
of added waiting). Each read must retain the original mount, case and page
clock. Record read times, trace counts and trusted down/up/click counts. Stop
when the complete sequence is available or extra events already make it invalid.

The original assertions still require exactly one trusted primary down/up/click
with matching pointer identity and target object. Missing events at the bound
remain FAILED; late, extra or foreign facts do not become success. The original
page/PID/root/title/nonce/coordinate/one-second pre-post guards remain mandatory.
This adds only passive observation after posting, not input authority or a new
key/pointer action. No resend, release, move, activation, source change, target
recapture or event normalization is permitted by this observation rule.
