# Installed selection40 fixture transport

This test-only transport is separate from `scripts/dom-native/`. The native39
foundation runner and broker remain unchanged. It does not provide arbitrary
desktop RPC, URLs, eval, selectors, keycodes or coordinate arguments.

Start one opt-in broker instead of the ordinary workspace server:

```sh
node scripts/selection-native/server.mjs --directory /tmp/editor-selection-safari-001
```

The directory must be fresh and outside the checkout. The broker creates a nonce,
unique title, exact `/selection` URL, `config.json` and raw `broker.jsonl`. Port4174
has one owner. The native driver consumes this config; a server start alone proves
no native acceptance. Browser/source/input-source setup and restoration belong to
the driver. No grants, preferences or existing browser windows are changed here.

`protocol.mjs` fixes13 cases and10 input actions. A run allows1024 commands in10min,
4KiB commands,2MiB results,64MiB combined traffic,128MiB logs and16384 page polls.
One request is pending until host read, persistence and explicit acknowledgement.
The page claims its ID before await/native execution. Transport failure never
resubmits a command. Absolute per-call deadline is15s.

`createSafariAdapter({config,report,run,outputPath,inputHelper})` exposes
`navigate/focus/call/input/close` plus pointer state and `releaseOwnedPointer`.
Fresh window creation and at most3 viewport adjustments are bootstrap-only Apple
Events. The exact viewport is1024×768, visual scale1/offset0. HTTP page-ready
confirms module initialization. After bootstrap, fixture commands use HTTP;
physical transitions use the compiled Swift helper. Cleanup uses an exact unique
foreground AX title and guarded CmdW; the separate finish result establishes
native resource release.

`createInputOwner` is shared with the Chrome driver. Its `guard(action)` supplies
the actual fixed fixture point and one-use monotonic guard identity. Every input
checks nonce/URL/title/mount/target, foreground ownership, transition state and1s
total guard age. `selection-native-input.swift` accepts the closed request only,
requires an exact focused Safari/Chrome AX window and one1024×768 AXWebArea,
with at most32 windows/512 AX nodes/depth32. The AX rectangle is the physical
coordinate origin; outerHeight/toolbar estimates do not select screen positions.
The page title remains exactly `KlenWriter Selection native <nonce>`. Safari's
expected AX window title is that same string; Chrome's expected AX window title
adds exactly ` - Google Chrome`. Both checks require one exact matching focused
window and recheck its exact title immediately before input; no substring match
or alternate title is accepted. Input receipts retain the expected and observed
AX window titles separately from the page guard.
The fixture separately compares trusted client coordinates to its independent
geometry. CGEvent provenance means platform input, not hardware-device evidence.

Chrome starts only its isolated fixture child with
`--force-renderer-accessibility=complete`, Chromium's documented fixed AX mode
([official overview](https://github.com/chromium/chromium/blob/main/docs/accessibility/overview.md#command-line-options)).
Before the first prepare or input, the driver uses the separate read-only
`--inspect-window` mode. Its closed JSON envelope has exactly
`{format:"osr40-native-window-inspection/1",browser:"chrome",nonce,title,fixtureUrl,deadlineMs}`,
at most4KiB and a finite1–1000ms deadline. It has no action, point, key, mount or
resize argument and returns before the CGEvent path. Shared AX measurement keeps
the same unique focused title, frozen WebArea size,512-node/depth32 budgets and
final ownership recheck. Only inspection may return `contained:false`; physical
`--request` still requires containment and a fresh page/AX guard for every action.

Bootstrap records actual page URL/title/nonce, viewport, scroll and raw selection
before and after each inspection. The URL is driver-observed, not an AX URL
claim; these observations are separate operations. It correlates the AX foreground
PID with its own CDP browser and obtains the window from its own page target.
After reading bounds it rechecks the page, target identity and target-to-window
association before each resize; any change refuses that mutation.
Within15s and at most3 rounds it may increase only that window's width/height by
the ceiling of measured positive right/bottom WebArea spill. It preserves window
origin,1024×768 page viewport, scale1/offset0, scroll and selection. Initial failed
geometry, exact CDP requests/bounds and every later measurement remain in the
receipt. Left/top spill, malformed data, changed ownership, unknown completion or
remaining strict refusal stops bootstrap; no physical input follows that failure.
Inspector stdout is bounded at32KiB. No toolbar inset or fixed pixel correction
is inferred, and no VoiceOver, system setting or existing Chrome instance changes.

Any failure disables normal actions. A dispatched timeout is recorded as
unknown/may_have_sent. If a pointer is down/may-have-down, one **separate cleanup**
release is permitted only after a new exact page guard('up') and fresh AX/title
checks. It never resumes the failed scenario or changes its failed result.
An unacknowledged unknown broker request cannot be bypassed for cleanup.
Call this release before finish destroys the mount. Unknown cleanup is retained,
never replaced with a fabricated successful release.

`tests/selection-native-input.node.mjs` checks controlled protocol/dispatch
boundaries without executing Swift, AX, browser or network operations. Swift
compile-only success is distinct from actual installed Chrome/Safari EN/RU
acceptance, which requires the full native driver and retained raw receipts.
