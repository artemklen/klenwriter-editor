# OSR-39 installed Chrome/Safari native input harness

This is an ordinary functional acceptance runner. Its authoring and Node syntax
checks do not execute a native lane. Results are NOT_RUN until the runner or the
same bounded protocol actually runs on an installed browser. It neither starts
performance captures nor changes browser settings, authentication or preferences.

Prerequisites: a clean committed source revision, corresponding built public
DOM/SDK/WASM artifacts, installed Google Chrome/Safari, and existing enabled
U.S. and Russian or RussianWin input sources; previously granted System Events automation
and Accessibility access. For Safari, the owner must already have enabled
**Allow JavaScript from Apple Events**. The runner does not change that setting. Missing
permissions/sources produce a retained NOT_RUN/error, with no permission-setting,
authentication flow or retry. The runner does not start its fixture server or
run a build/CI. Only one fixture server may occupy `127.0.0.1:4174`.

From the repository root, after the implementer freezes runtime source and is
ready for the native functional run, start the ordinary server for Chrome:

```sh
PATH="$PWD/.tools/node/node_modules/.bin:$PATH" node scripts/workspace-server.mjs
```

Run Chrome in another terminal, then stop that server before starting Safari:

```sh
PATH="$PWD/.tools/node/node_modules/.bin:$PATH" node scripts/dom-native-acceptance.mjs --browser chrome --output /tmp/editor-chrome-001/chrome.json
```

Safari uses a separate opt-in fixture server. Use a fresh outside directory for
every server start; it writes a random nonce/title and immutable `config.json`:

```sh
PATH="$PWD/.tools/node/node_modules/.bin:$PATH" node scripts/dom-native/server.mjs --directory /tmp/editor-safari-001
```

In another terminal:

```sh
PATH="$PWD/.tools/node/node_modules/.bin:$PATH" node scripts/dom-native-acceptance.mjs --browser safari --output /tmp/editor-safari-001/safari.json --broker /tmp/editor-safari-001/config.json
```

Stop the server after the receipt completes. Keep config and broker/client JSONL
beside that receipt. Chrome retains its four-argument CLI; Safari requires the
explicit `--broker` configuration and rejects an absent, expired or used broker
before opening a browser window.

Node 24.22.0 is enforced. Reports, the compiled Carbon helper and checkpoint data
stay outside the checkout. Each run records exact Node, macOS product/build,
browser bundle/build versions, source/artifact hashes, actual current and
available input source IDs, physical key-code actions, trusted browser event
traces and native canonical/selection/history checkpoints. Chrome uses the actual
installed `channel: 'chrome'`, headed. Safari uses one ordinary window created by
Safari's Apple Events `make new document` command at the fixed fixture URL.
Its fresh numeric window ID and single fixture tab are validated during bootstrap.
The page receives a fresh unique nonce title and imports the fixed broker client.
Every later command/result uses same-origin HTTP; there are no Apple Events calls
after bootstrap, including focus checks and cleanup. Existing Safari tabs remain
outside the command/input scope.
The report records this control method, window ID, fixture URL, actual
`navigator.userAgent`, language/platform and installed Safari bundle version/build.
No WebDriver capability or W3C-session result is claimed. Earlier failed and
NOT_RUN receipts retain their original qualification.

Only bootstrap JavaScript uses a fixed UTF-8 file and positional `osascript`
arguments. The broker has no arbitrary evaluation, URL, selector or input RPC.
It admits closed methods with literal locale/phase/history arguments and at most
one unacknowledged request. The page claims its ID before execution; neither a
lost delivery nor a lost response repeats a native operation. Node persists the
result before acknowledging it. The ordinary server keeps its routes and CSP;
only the explicitly started broker wrapper adds exact generated nonce routes.

Bounds are 128 commands, 4096-byte commands, streamed 2MiB results, 32MiB combined
payload, 64MiB per receipt log, 8192 page polls, 15-second absolute command deadlines
and a five-minute broker lifetime. Deadlines are rechecked after reading bodies.
Protocol or unknown-delivery failures disable further input.

Cleanup obtains a fresh page ownership guard when available. Known ownership
refusal prevents cleanup; unavailable transport is labelled explicitly. It sends
one CmdW only while the exact unique AX fixture title is frontmost, then verifies
that title no longer exists. This proves current fixture-tab closure, not whole
window/process shutdown. Native release requires the separate `finish` receipt.
The runner does not change Safari preferences, remote automation, JavaScript
grants, authentication or global app-data environment variables.

Chrome receives a fresh `CFFIXED_USER_HOME` directory under the external report
folder for its app-data lookup. This addresses the observed macOS27 startup
path-service failure without using the real Chrome app-data directory. The
override applies only to the Chrome child; Carbon input-source verification and
System Events use the actual user environment. The report records that boundary.

The Carbon helper lists existing input sources and selects only an existing,
enabled, selectable source. It does not enable, install or persist a layout.
The runner verifies the selected ID after selection, before key codes and after
each batch. Chrome activates and brings its page forward. Safari starts frontmost
during bootstrap; subsequent focus checks use the page broker and refuse lost
document focus. This setup is separate from the tested Tab action. Physical Tab and its trusted trace
must still return focus from the host control to the editor.
Immediately before each Safari key, a new page guard confirms nonce, fixed URL,
unique title, prepared mounted ID, connected host and document focus. Tab requires
the host control; other keys require the exact editor. A one-second guard lifetime
includes the complete System Events process. Its AppleScript requires Safari
frontmost, no more than 32 AX windows, exactly one matching title and that exact
front-window title immediately before one closed ANSI key code. Each key retains
the guard request ID/serial, freshness bounds and actual System Events execution.
Any key error disables further keys. A failure after dispatch is recorded as
`unknown/may_have_sent`, with its actual execution row when available; `not_sent`
is reserved for failures before dispatch. No further key follows either failure.
The original source is restored and verified in `finally`, including failures.
No assumption that the first key will already use a newly selected layout is
made. Restore failure remains a failed run.

Each EN/RU lane prepares a fresh frozen D0 document and explicitly sets its initial
native caret to TC offset2 via public API. This setup is labelled separately.
It focuses the host control and sends physical Tab to return to the editor under
the current browser policy, then sends these System Events ANSI virtual keycodes:

- EN: H/E/L/L/O (`4,14,37,37,31`) under `com.apple.keylayout.US`: `hello`.
- RU: G/H/B/D/T/N (`5,4,11,2,17,45`) under an existing enabled
  `com.apple.keylayout.RussianWin` or `com.apple.keylayout.Russian`: `привет`.
  These letter keys are shared; this protocol makes no punctuation-layout claim.
- Return (`36`): append the compatible empty paragraph; Backspace (`51`): join.
- Public host undo/redo: verify historical empty-block identity revival/retirement.
  These actions are labelled public host API, and do not claim native shortcut proof.
- Physical Backspace: delete the final letter; physical Tab: return focus once more.

Independent expected documents come from frozen D0/D1 literals plus the stated
text. Checkpoints assert exact native caret IDs/offsets, revision, undo/redo units,
one document publication per action, canonical content, lifecycle and retained
surviving text identity. The actual canonical strings, rows, events and failed
checkpoint are retained before assertions. Native events record `isTrusted`, key,
code, inputType, data and composing/cancelable state. The capture-listener
microtask is named `defaultPreventedAtCaptureMicrotask`; the independent document
bubble observer records `defaultPreventedAtDocumentBubble`. Trusted cancelable
noncomposing beforeinput must be prevented at document bubble. A capture microtask
is not assumed to run after target dispatch.
Canceled beforeinput may correctly yield no browser input event. No synthetic
InputEvent dispatch is used. System Events is platform key-code injection; this
is not a claim of input from a physical hardware device. An isTrusted flag alone
cannot establish the provenance, so the runner also records its actual key-code
commands and verified OS input source.
Action records distinguish attempted, failed and completed key batches; a failed
batch is not reported as completed physical input.

The trace is limited to2048 entries and24 checkpoints; only the fixture editing
host, fixture host control and selection changes inside the host are observed.
Page errors/CSP violations and native resource cleanup are bounded and checked.
No private documents, accounts, general application keystrokes or host diagnostics
are collected. Actual Tab return is recorded; the runner does not read or alter
the user's global Safari Tab preference. This covers basic39 focus only.

The ordinary Safari adapter loads `/dom` and imports the same static fixture
module after readiness. Its closed HTTP protocol invokes these public hooks:

```js
await import('/dom-native-host.js');
await domNative.prepare('en'); // or 'ru', fresh mount
```

The broker also invokes `phase(name)`, `focusControl()`, `checkpoint(name)`,
`history('undo'|'redo')`, `verifyTrace()` and `finish()`. The module's `observations()`
helper is included by `finish`; it is not a separate broker command. Read-only
`guard` and `documentGuard` are implemented by the page client.
Checkpoint names in order are `focused`, `typed`, `split`, `joined`, `undo-join`,
`redo-join`, `delete-last`, `focus-return`; trace phases for real input are
`focused`, `type`, `split`, `join`, `delete-last`, `focus-return`.
The runner performs OS input-source confirmation and actual physical key-code
actions between these calls. Retain
actual browser/OS/source/action metadata alongside the module result, preserve
failures, call `finish()` and verify `resourcesReleased`, and restore the original
input source even if an assertion fails. Do not select another layout merely to
make an unexpected result pass. Receipt format `/2` pins all 14 source/dist files
and the Safari broker config before/after, checks HEAD and a clean tracked tree,
and requires `sourceUnchanged` plus `sourceClean`. Source, resource, cleanup or
layout-restoration failures cannot produce PASSED.

This run does not claim OSR-40 full selection/drag/scroll, OSR-41 IME settlement,
clipboard, screen-reader acceptance, Firefox support or release acceptance. The
broader historical OSR-58 prototype protocol remains separately qualified.
