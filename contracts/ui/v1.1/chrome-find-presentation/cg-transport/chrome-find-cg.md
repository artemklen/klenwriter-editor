# Closed native Chrome Find CG transport — CG02

Source-authored before candidate. Chrome13 partial FAILED and all old reports
remain immutable. AS markers never became ACK. Root chooses a separate small
self-contained scripts/ui-native/find-key.swift for fixed CGEvent keyboard
programs. Existing guard.swift/AS paths, ordinary/Safari behavior and original
155 controlled tests stay unchanged. No AS micro-optimization campaign, extended
deadline, native literal, RPC, public editor API, arbitrary key or input replay.

Actual Chrome opts into private nativeFindKeyTransport:'cg-fd02' plus fixed
findKeyHelper path, only with nativeFindEpisode:'chrome-fd01'/browser Chrome.
Absence preserves old AS8 transport/controls. Program request is closed16 fields
in design; only action find/close-find plus cleanupOnly determines one of four
SOURCE-literal programs. Caller cannot supply events, flags, keycodes, pointer
coordinates, commands, selectors or another app. Requests use existing exact
nonce/mount/request whole-string checks and sole modes-zoom context/private
episode originalPID/frame. Same Node pageguard deadline remains1s total; helper
gets only remaining integer1..1000ms, never a new budget.

Literal programs (source JSON is normative): Find key55 down flagsCommand,
key3 down flagsCommand, key3 up flagsCommand, key55 up flagsNone. Escape key53
down/up flagsNone. Cleanup original Find ONLY key55 up then key3 up, both flagsNone;
cleanup Escape ONLY key53 up flagsNone. No down on cleanup, no repeated command
or semantic Escape cleanup. .maskCommand/empty CGEventFlags at cghidEventTap;
platform posting provenance, never hardware-device or native-delivery ACK.
All at most4 CGEvents are allocated/configured before any post.

Every event gets a fresh complete exact-owned-window proof BEFORE posting.
First normal Find requires CLOSED1; first normal close requires OPEN2. Cleanup
starts only under the exact original private pending tuple and OPEN2 or CLOSED1.
Between posts permit only these two completely valid original-owner states;
wrong identity/topology/frame/focus fails immediately, no remaining events.
ExactPID/name GoogleChrome/bundle/frontmost, unique nonce root AXWindow/
AXStandardWindow, original finite positive frame, genuine CFEqual root focus;
OPEN2 has exactlyone DISTINCT full 'Find in page\n    '+pageTitle aux AXWindow/
AXUnknown, positive finite frame wholly contained. CLOSED1 has only root/aux
absent. Retain the initial genuine root inside one helper call and require its
CFEqual identity on later reads, no rebind. Across CLI calls do not invent a
persisted AX reference; genuine each-call root proof plus original private
PID/frame/nonce/mount/case binding remains. No descendants, AXWebArea, URL, current
viewport, broad app survey or new permission request.

After a CG post returns, append that exact source event and its preflight proof
to bounded prefix facts. Zero posts => typed refused/not_sent, core null.
Partial posts => typed unknown, core null, exact posted prefix, never a forged
full keyTransitions. ALL program posts => typed completed core with all old6
ACK fields plus exact context/program facts, even if subsequent phase fails.
Core is a platform-posting fact: events actually processed by native Find still
require measured phase/native checks. Node validates full envelope/context/
source program/full posted prefix/core BEFORE clearing pending. It then checks
postcondition and elapsed budgets; completed late/phase-refused never receives
redundant UP. Opaque timeout/no valid result remains unknown even if events might
have completed; never infer a core from markers or possibility.

Single-result protocol: completed helper exits0 with core intact and typed
postcondition verified/refused/unobserved; postfailure does not throw away core.
Before-post refusal/partial unknown exit2 with typed JSON; Node may validate
error.execution.stdout, never stderr as authority. Primary valid-context
not_sent0posts clears only that new pending attempt; input disabled/episode
retired, row FAILED. A cleanup not_sent0UP posts MUST retain previous unknown
pending, consume the one cleanup attempt, disable/retire, original FAILED.
Partial/opaque unknown permits at most ONE matching original UP-only attempt.
No normal continuation/retry after unknown or failure.

Final desired phase: Find OPEN, close CLOSED, cleanup either. After ALL posts
only READ-ONLY phase samples may wait: max12 measurement attempts, each wait
<=4ms and inside SAME deadline, no events/phase-loop input retry. Exact owned
opposite phase alone is pending; wrong ownership immediately produces completed
core + refused postcondition. Correct phase verified; deadline/readlimit gives
completed core + unobserved postcondition. No sampling after expired authority.
No performance success predicted. Default core/phase/source/native checks and
30-row acceptance remain; DEV modes-only stays INCOMPLETE even both pass.

Eight additive FD-C controlled cases preserve all old155 names/assertions:
expected163 units, UI216/overall972 unchanged. These are source expectations,
not executed results or formal review. This preparation writes no candidate
Swift/Node code and executes no compiler/helper/browser/OS input.

SDK source authority (local exact bytes pinned in design): CGEvent.h lines66–79
requires modifier transitions and creates correct flagsChanged for virtualkey55;
CGEventTypes.h source state private=-1 is chosen explicitly via
CGEventSource(stateID: .privateState). No manual event.type assignment. Events.h
pins F0x03/Escape0x35/Command0x37. Exact flags are set on every preallocatedevent;
these primary declarations establish API/source semantics, not future delivery
or timing success.

Four separate compile-only malformed controls FD-S01..04 are source-authored:
unknown action; cleanupOnly numeric0; requestId trailing LF; extra keyCode. Each
rejects closed schema before AX query or CG source/event allocation/post, exit2,
refused/not_sent, postedCount0/core null. They do not add Node cases or installed
coverage. Root may later compile/execute only these invalid requests.
