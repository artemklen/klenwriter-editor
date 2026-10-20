# Chrome pointer routing to the original owned process

Frozen at2e75a5a before this candidate or its execution. Chrome10 remains
FAILED1P1F18NR: Quote received a completed move/down/up platform ACK with paired
number0, ordered timestamps and measured pauses, but no DOM pointer events in
nine observations or finish. Chrome09/08 remain their original failures. The
cause is unknown; timing metadata does not establish browser receipt.

Local Apple CGEvent.h documents CGEventPost as a global stream post and
CGEventPostToPid as a process-specific post. It separately documents the
read-only CGPreflightPostEventAccess check for the current process. These APIs
do not promise DOM delivery or establish any historical denial/routing cause.

For Chrome pointer programs only, use CGEventPostToPid with the genuine
ownBrowserPid from the already completed existing Chrome bootstrap. Provide
that PID through a private adapter callback, read once for each new normal
pointer request. Require a positive signed32-bit integer. Store it in the
pending original request before dispatch; never reacquire it for cleanup.

The closed request gains pid ONLY for Chrome pointer actions. Require the
exact extended keys, an integer1..2147483647 and equality with the existing
actual frontmost measured process before posting. Chrome keys, Safari and
other closed requests retain their exact original keys. Every existing
per-post ownership/window/title/root/point/deadline check remains in force.

Before any Chrome pointer post, including cleanup, call only the read-only
CGPreflightPostEventAccess. False refuses with no posted event; no prompting
Request API or alternate route is invoked. On success, record one closed
posting object: route:"CGEventPostToPid", pid:the original request PID,
preflightAccess:true. JS validates its exact keys, route, same original PID,
positive integer range and equality with actual frontPid before clearing
pending state. This is API access/posting evidence, not DOM completion.

Retain the exact normal move/down/up, original guarded global point, matching
event numbers, timestamp metadata, both fixed25ms pauses and original total1s
deadline. Change only routing and explicit read-only preflight coverage. No
fallback to global posting, extra click, source-state change, activation,
recapture or retry is added. Cleanup retains its one up-only original program,
without movement/down/dwell/timestamp changes, and posts to saved request.pid
only after the same strict current ownership checks; it never targets a newly
obtained PID. A lost/denied owner refuses and stops.

Safari, keyboard/Find/zoom, fixed AppleScript and all product code are unchanged.
Original strict trusted DOM down/up/click, original target/pointer identity,
passive bounds, mutation/history/focus and release assertions remain intact.
Missing/mismatched DOM events remain FAILED. No UNOBSERVED/PASS relaxation,
hardware-device provenance or fix of a historical failure is claimed.
