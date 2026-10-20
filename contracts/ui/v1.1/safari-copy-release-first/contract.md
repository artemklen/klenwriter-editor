# SC01 — private Safari Copy release order

Status: SOURCE_AUTHORED_BEFORE_CANDIDATE. This additive installed-fixture
transport contract changes no editor command, clipboard literal, DOM acceptance
condition or public API. It specifies an independently authored candidate key
program; it does not claim that Safari will deliver its DOM keyup until an actual
installed run records that event. Original Safari08 remains FAILED.

## Closed opt-in and exact program

The private input owner may accept `safariCopyKeyTransport: 'sc-copy01'` only
for `browser: 'safari'`. An absent option preserves the original transport;
another tag or a Chrome owner refuses before any process/input dispatch. A valid
Safari owner uses the new route ONLY for normal `action: 'copy'`.

The existing compiled fixed AppleScript receives exactly FIVE arguments on that
route: `[browser, exactAxTitle, decimalFrontPid, 'copy', 'sc-copy01']` (excluding
the compiled-script path). The first argument must be `safari`; the final tag is
exact and case-sensitive. A five-argument invocation with another browser,
action or tag refuses before any key command. No caller-supplied script, keycode,
modifier or program is accepted. Existing four-argument legacy Copy, all Chrome
keys, all other keys and the eight-argument Chrome Find path keep their original
programs and guards. For an opted-in Safari owner, non-Copy normal actions still
use their original argument shape and transport.

After the original PRE ownership check, the entire normal program is exactly:

1. `key down command`
2. `key down 8`
3. `key up command`
4. `key up 8`

Thus the Copy keydown retains Command; only the release order changes. Execute
the program once, with no retry, replay, fallback, added down or artificial DOM
event. Retain the original full POST ownership check before successful return.

## Receipt, deadline and failure ownership

A successful normal reply has exactly these fields (JSON member order is not
authority): `status: 'key-sent'`, `action: 'copy'`, `keyCode: 8`,
`modifiers: ['command']`, `programId: 'safari-copy-release-first/1'`,
`keyTransitions: ['command-down','key8-down','command-up','key8-up']`, and
`frontPid` equal to the current strict Swift guard's actual positive PID. The
Node owner validates that entire literal program and identity before clearing
pending ownership. A receipt from the default release order, a missing/wrong
programId, extra/duplicate/omitted/reordered transition or mismatched PID cannot
establish completion or grant a retry.

Keep the original fresh page/nonce/URL/title/case/mount, PID, exact AX root/window/
viewport and AS PRE/POST checks, bounds and original total one-second deadline.
The new option creates no earlier, weaker or reusable authority. A guard refusal
before dispatch is `not_sent`, without owned-key cleanup. Once dispatch begins,
timeout, malformed/opaque reply or incomplete program disables normal actions
and retains the original owned Copy keys as potentially held. An exact complete
POST receipt received too late still fails the original deadline; because all
ups are then proven, it requires no redundant release. No late receipt grants an
acceptance PASS.

For uncertain ownership, allow at most ONE original fresh guarded cleanup:
the existing FOUR-argument `release-copy` route, with no fifth tag. Its only
program remains `key up command; key up 8`, and its original successful receipt
remains `keys-released` / `release-copy` / key8 / command /
`['command-up','key8-up']` / same original PID. It sends no down, cannot rebind to
another mount/case/PID/window, and cannot replay Copy or resume normal input.
Cleanup failure preserves the original failure and uncertainty; cleanup success
does not change the original failed row. No catch-and-retry program is added.

The platform reply is a posting/completion fact, not a browser ACK. The existing
actual trusted keydown AND keyup requirements, actual Copy event/clipboard ACK,
OS UTF-8 clipboard bytes, native model/canonical/history and resource assertions
remain unchanged. Missing DOM keyup remains a failure even with four platform
transitions recorded.

## Independent controlled coverage

The four named cases in `cases.json` use injected process/guard stubs only. They
verify closed arguments and exact validation/ownership behavior; they do not
execute AppleScript, inspect AX, use a clipboard, synthesize accepted physical
events or establish installed Safari behavior. Preserve all existing173 unit
names/assertions, three-file npm unit argv and browser inventory216/972. Append
exactly four independent Node tests (total177) through one additive import in
the existing input-test entry. No browser or installed matrix row is added.

Baseline source: `scripts/ui-native/protocol.mjs` defines Copy as code8/Command;
`scripts/ui-native/input.mjs` defines the original four-argument program, strict
fresh guard, pending-key state, one-shot release-only cleanup and deadline.
These source-derived constraints precede the SC01 candidate; actual failure
diagnostics are not expected event outputs.
