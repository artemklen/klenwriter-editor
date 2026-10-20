# Explicit Chrome mouse pair and posting times

Frozen at7f5adab before this candidate or its physical execution. Chrome09
remains FAILED5P1F14NR: one trusted exact Add pointerdown was observed; no
pointerup/click appeared in nine passive observations or finish. Its platform
move/down/up program completed within83ms. Prior07 passed the same Add point
with a1.2ms DOM down/up interval. Neither observation identifies the cause or
proves that any minimum dwell is necessary. Safari03 remains separately PASSED.

For normal Chrome pointer programs only, retain exactly move/down/up at the
original guarded point and the existing25ms movement pause. Allocate the fixed
events before any post. Read the allocated down event's mouseEventNumber and
set the allocated up event to that same number before posting. Record both
read-back numbers as decimal strings; require equality. The local Apple SDK
CGEventTypes.h documents matching numbers for a matching mouse-down/up pair.
This does not prove that any historical pair had mismatched numbers.

Immediately before each original guarded post, set that owned event's timestamp
from DispatchTime.now().uptimeNanoseconds. Record the actual timestamp read back
from the owned event. Require the three positive decimal timestamp strings to
be strictly increasing. This is explicit source-authored event metadata, not a
record of WindowServer or DOM receipt. The local SDK describes CGEventTimestamp
as roughly nanoseconds since startup and provides get/set accessors; it does
not specify a browser delivery guarantee or historical constructor defaults.

After the one down post, request exactly25ms passive waiting, record the actual
monotonic elapsed time, then recheck the same original owned window and original
one-second deadline before the one up post. Keep the original deadline without
reset. No additional down/up, click, target, activation, source switch, recapture
or replay is introduced. This finite dwell is an operational assumption, not a
claim that a previous fast pair violated a documented browser timing bound.

The completed Chrome ACK additionally contains one closed pairTiming object:
downEventNumber, upEventNumber, moveTimestampNs, downTimestampNs, upTimestampNs,
requestedPauseMs25 and actual finite nonnegative elapsedMs. Validate exact keys,
canonical integer strings, matching pair numbers and strictly ordered positive
timestamps before clearing pending state. Preserve the existing prelude receipt.

Safari normal programs and all cleanup programs retain their original metadata,
down/up or up-only sequences and original checks; no movement/dwell is added to
cleanup. Unknown completion still allows only the existing one original-owner
up cleanup and stops normal input. Posting evidence is distinct from DOM proof.
The original strict trusted matching down/up/click requirement, target object,
pointer identity, passive observation bound, resource release and all other
assertions remain unchanged. A missing or mismatched DOM sequence still fails.
