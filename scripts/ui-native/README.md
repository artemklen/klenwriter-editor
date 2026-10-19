# Installed UI42 acceptance

Source-authored implementation of `contracts/ui/v1/installed-matrix.md`.
This directory is a separate42 protocol. Existing41 guards are not made to
accept42 actions, and no earlier installed result is inherited. Nothing in
this README asserts that this new harness has executed or passed.

The seven matrix families expand into15 independent cases per locale:
navigation; keyboard/pointer Strong; keyboard/pointer Add; fresh menu-up,
menu-down, local-key-up and local-key-down Move; host dialog; four independent
composition conflict gestures; modes/Find/copy/zoom. Each installed browser
therefore declares30 rows, EN and RU. Separate fresh brokers/reports are required
for Chrome and Safari. The actual browser version is an explicit CLI pin.

After the final coherent build/local gates and a clean committed source:

```sh
node scripts/ui-native/server.mjs --directory /absolute/fresh/ui42-broker
node scripts/ui-native-acceptance.mjs --browser chrome --output /absolute/fresh/chrome.json --broker /absolute/fresh/ui42-broker/config.json --head FULL_COMMITTED_SHA --expected-version ACTUAL_PINNED_VERSION
```

Stop only that server through its own process handle when it completes. Start
a new broker for Safari and use `--browser safari`. The server is opt-in and
serves only the closed nonce modules plus the one exact shared pure protocol
dependency. Ordinary `/ui` CSP remains unchanged: no composition41 style hash,
inline-script/style permission, filtering, screenshot-based oracle or synthetic
input fallback is introduced. A real UA CSP violation fails the row.

Chrome uses a fresh isolated headed installed channel, read-only CDP bootstrap
measurements and closed page setup/read calls. Safari creates one owned window;
Apple Events page access ends at bootstrap. Remaining Safari page calls use the
bounded same-origin HTTP broker. Mutating calls are claimed before dispatch,
unknown completion disables later actions, and no native call is replayed.

Physical actions are fixed System Events key programs or exact-control CGEvent
clicks. Each has a new page/mount/nonce guard and independent strict AX check of
the exact foreground process/window and actual web area. This is platform input,
not hardware-device provenance. Navigation is physical. Fixture mounting,
literal selection setup, explicit focus setup, host edit and native undo/redo
are labelled setup/host API actions; none is described as physical input.

Page zoom is changed by guarded native CmdPlus. The zoom oracle uses the
baseline/current CSS viewport width with unchanged outer window dimensions;
every action independently matches that viewport to the measured AX web area.
DPR is recorded as a crosscheck and may remain hardware-fixed in Safari. Pointer
coordinates use the actual AX-web-area/current-CSS-viewport ratio. The Find row
requires a trusted unprevented CmdF, actual document focus departure and an
owned-window screenshot; a single fresh-window-guarded Escape closes it.

Composition rows first require actual trusted compositionstart and an unresolved
native window. The distinct pointer gesture is separately guarded/acknowledged.
A window that ended before the gesture is UNOBSERVED. A window observed through
the gesture must preserve actual text/objects/range/focus and native state; an
end during the gesture fails preservation. Settlement must show no UI command
replay. Explicit retained recovery is REFUSED, never a fixed positive commit.
`settlement-literals.mjs` authors the fixed positive bytes before execution:
KWDJ F becomes `Aéאב` with the rest of F unchanged; Notes NC011 becomes `aéb`
with unchanged title/tags. Both collapse at the original T offset2, retain every
original opaque ID at its independently authored path, publish exactly one
document event, increment revision/selection/history once and create one undo
unit. The source fixture hashes, exact native command/payload and original
native response are checked. These literals are independent expected source;
they are never constructed from an observed canonical result.
Prior41 cancel/blur limitations and other platforms are not promoted to42 proof.

Reports retain PASS/REFUSED/FAILED/UNOBSERVED/UNSUPPORTED/NOT_RUN, actual action
counts and original source/compiled/helper/version/input-source pins. Missing
or uncertain evidence is not PASS. Source traces are exact original request and
response bytes from the pass-through fixture, with finite bounds and explicit
overflow failure. Screenshots cover only the exact owned foreground AX window.
No browser profile/app-data contents are read or copied into evidence.

Each row tears down its own UI/mount and checks SDK/native/DOM/selection/
clipboard/host-request counters. Owned uncertain keys/pointer receive at most
one separately recorded release-only cleanup; this never retries a semantic
action or turns its failed receipt into PASS. Cleanup closes only the owned
browser/window, then restores the original existing input source and requires
five coherent readbacks. Restore failure keeps the overall run FAILED even
when earlier individual rows passed. No settings/permission/login flow occurs.
