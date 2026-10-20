# Closed Chrome Zoom CG transport — CZ01

Source-authored before candidate. Extend find-key.swift with an isolated EARLY
--zoom-request branch; leave every existing Find branch and guard.swift unchanged.
Actual Chrome privately opts into nativeZoomKeyTransport:'cg-zoom01', reusing the
fixed compiled findKeyHelper path. Absent/default/Safari/ordinary transports and
old163 controlled assertions stay unchanged. No public API/RPC/case additions.

Closed request18 is the original native-input16 plus originalPid and
originalRootFrame, with format osr42-chrome-zoom-key/1. Only modes-zoom, focused
target, null point, pointerDown:false, actions zoom-in/zoom-reset and genuine
cleanupOnly Boolean. Whole ASCII nonce/mount/request checks. Original CSS viewport
scalars/caps/tolerances remain exact. No arbitrary keycode/flags/program/coordinate.
OriginalPid/frame come from the genuine ordinary pre-key proof; cleanup retains
the original pending tuple/frame, never rebinds. Entire original Node pageguard
budget remains1s; helper receives only its remaining integer1..1000ms.

JSON source programs are normative: zoom-in6events includes every Command and
Shift transition and exact flags; reset4events. Cleanup only original modifierUPs
in original order then keyUP, all flagsNone; no down/replay. New privateState
CGEventSource; allocate/configure all<=6events before anypost, never assign
event.type manually. CGEvent platform posting provenance, never hardware.

Before EACH event copy full ordinary measureWindow/webViewport/recheckWindow
semantics: actualfront Chrome, bounded<=32 AXwindows, unique exact nonce root
actually CFfocused, one measured AXWebArea matching requested CSSwidth*pageZoom/
height*pageZoom within2, traversal<=512objects/depth32, positivefinite frame and
viewport contained using existing0.5 tolerance. Require originalPID/frame and
same genuine CFroot acrossposts. Root title/frame/focus and deadline rechecked
beforepost. No front-window-array order assumption, auxiliary guessing, URL or
broader AX survey. Fresh current AXWebArea only; never fabricate viewport proof.

Response13 exactkeys (CG envelope without Find postcondition) retains literal
program, actual posted prefix and per-post complete ordinary proofs. Zero posts:
typed refused/not_sent/core null/exit2. Partial: typedunknown/core null/exit2.
ALL posts: completed/fullcore/exit0; Node validates complete context/program/core
and clears pending BEFORE checking lateness or fresh original guard.swift
--guard-key postproof (same originalid/serial, recalculatedremaining, original
native-input format). Postproof must match pre-PID/frame; failure remains FAILED
known_completed, no redundantUP. Invalid/opaque timeout has no completion fact.
Primary typed0posts clears only new pending; cleanup0UP retains originalunknown
pending and consumes its sole release attempt. Failure disables continuation.

Existing coordinator native/DOM/focus/zoom assertions unchanged; actual Chrome16
remains FAILED. No expected new zoom value is put in the helper or inferred from
old output. Four new CZ controlled names ->167, UI216/overall972 unchanged; four
separate invalid-request controls reject before AX/CG and do not add Node count.
SDK Events.h exactpin in JSON establishes Equal24,Digit0=29,Command55,Shift56;
existing CG02 SDK/source semantics remain. No compile/runtime/OS during authoring.

Chrome-only synchronization: once per locale after the existing native zoom loop
has reached and checked200%, before subsequent ordinary ShiftTab, coordinator
waits once for a fixed requested2000ms and records duration/scope in the entry.
This passive preparation performs no reads, input, reactivation or retry; grants
no authority and claims no native-bubble lifetime bound. The next ordinary
page/fullAX/AS guards are fresh and unchanged, including strict window order;
they still fail if the presentation is not settled. The wait is outside every
physical action and never extends its original1s guard. No extra wait after final
zoom-reset, since no later ordinary input follows it. Root owns this coordinator
addition; old4CZ/167 and all schemas/programs/assertions remain unchanged.
