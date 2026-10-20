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
Chrome explicitly disables Playwright focus emulation before any mount/input,
recording the CDP method, parameters and response. Normal fresh-case entry
activates Chrome once as preparation; a failed entry or uncertain input cannot
trigger reactivation. Each physical action still requires its fresh OS AX guard.

Physical actions are fixed System Events key programs or exact-control CGEvent
clicks. Each has a new page/mount/nonce guard and independent strict AX check of
the exact foreground process/window. Ordinary actions also measure the actual web area. This is platform input,
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

Chrome's one live native Find episode follows the separate
[window contract](../../contracts/ui/v1.1/chrome-find-presentation/find-presentation.md).
Its initial CmdF keeps the ordinary measured-WebArea guard. While Find is open,
Escape, original UP-only cleanup and its screenshot use explicit window-only
proofs of the original PID, nonce, mount and root frame, with the exact contained
Find auxiliary. These proofs provide no viewport or pointer coordinates. The
screenshot crops the original root rectangle. Unknown completion remains FAILED;
only one matching original-key UP cleanup is permitted. Ordinary actions and
Safari retain their existing measurement paths.

For targeted development only, the exact environment value
`OSR42_NATIVE_DEVELOPMENT_CASE=modes-zoom` selects the existing EN/RU modes rows.
All30 report rows remain: the other28 are explicitly NOT_RUN, and two PASS still
produce INCOMPLETE/exit2. This cannot supply full installed acceptance. Unset the
variable for the normal matrix. The
[diagnostic contract](../../contracts/ui/v1.1/chrome-find-presentation/stage-development/find-stage-development.md)
also bounds AS8 stderr stage markers; these observations never replace a key ACK.

Composition rows first require actual trusted compositionstart and an unresolved
native window. The distinct pointer gesture is separately guarded/acknowledged.
A window that ended before the gesture is UNOBSERVED only after the additive
`contracts/ui/v1.1/composition-observation` proof: one genuine current trusted
start/preedit, an explicitly recorded terminal strictly before actual trusted
pointerdown, and exactly one predeclared native InsertText finished no later
than that down. Mount and document-local `performance.timeOrigin` must match;
all original request/response bytes, native state, identity, one undo unit and
no-replay assertions remain mandatory. Every terminal keeps its actual trust;
observed-ended metadata never turns an untrusted event into positive native IME
evidence. A missing/late/throwing call, another mutation, or ambiguous order
fails. `composition-observation.mjs` is pinned with the other closed helpers;
its pure CO units run from the existing transport-unit entry. Source-bound41
P18/P19 U+00B4 may identify an early spacing-accent insertion for this opportunity
classification only. It does not count as42 protected-gesture acceptance.
A separate frozen AFTER-CLICK subset also requires the explicit terminal before
trusted matching primary down/up/positive-detail click on the exact guarded
object, one expected InsertText starting at/after click and returning by the
checkpoint, exact provisional DOM/objects/raw range/focus preservation, and zero
UI results/dialog openings/pending requests. The original default failure stays
in the report alongside that separate observation. It permits no interleaving or
two-command exception and does not turn missed opportunity into protected PASS.
The separate frozen DURING_POINTER subset keeps those same stronger actual
target/DOM/raw/focus/no-UI-command checks and permits only the composition's
one expected original InsertText within down.time<=startedAt<=finishedAt<=click.time,
with its explicit terminal strictly before down. Both earlier classifier results
remain recorded. Foreign up/click targets still fail; this cannot replace layout
stability or accept a replay/second command. Original Chrome05 remains FAILED.
These are single-threaded event-record/call bounds, not concurrent dispatch proof.
The source-authored Notes spacing-accent binding is `a´b`/T2 with its distinct
`{text}` payload; existing Notes é and KWDJ bindings stay unchanged.
Original Chrome04 remains FAILED under its original before-down contract; only a
new run with all new actual event/object fields can supply this separate proof.
Original Chrome03 stays FAILED: its old call rows lack ordering times and also
contain an additional toolbar command. No historical bytes are rewritten.
A window observed through
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
response bytes from the pass-through fixture. Each actual native call is timed
immediately around the original call, before reply parsing; a thrown original
value retains bounded error provenance and no fabricated response/completion.
This is bounded call ordering, not a performance measurement. Finite bounds and explicit
overflow failure. Screenshots cover only the exact owned foreground AX window.
No browser profile/app-data contents are read or copied into evidence.

Each row tears down its own UI/mount and checks SDK/native/DOM/selection/
clipboard/host-request counters. Owned uncertain keys/pointer receive at most
one separately recorded release-only cleanup; this never retries a semantic
action or turns its failed receipt into PASS. Cleanup closes only the owned
browser/window, then restores the original existing input source and requires
five coherent readbacks. Restore failure keeps the overall run FAILED even
when earlier individual rows passed. No settings/permission/login flow occurs.
