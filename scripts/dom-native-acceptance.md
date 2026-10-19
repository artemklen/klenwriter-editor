# OSR-39 installed Chrome/Safari native input harness

This is an ordinary functional acceptance runner. Its authoring and Node syntax
checks do not execute a native lane. Results are NOT_RUN until the runner or the
same bounded protocol actually runs on an installed browser. It neither starts
performance captures nor changes browser settings, authentication or preferences.

Prerequisites: built public DOM/SDK/WASM artifacts and the workspace server at
`http://127.0.0.1:4174/dom`; installed Google Chrome/Safari; existing enabled
U.S. and Russian or RussianWin input sources; previously granted System Events automation
and Accessibility access. Safari WebDriver must already be enabled. Missing
permissions/sources produce a retained NOT_RUN/error, with no permission-setting,
authentication flow or retry. The runner does not start the workspace server or
run a build/CI.

The workspace server needs this one exact static allowlist route:

```js
['/dom-native-host.js', ['spikes/workspace/dom-native-host.js', 'text/javascript']],
```

From the repository root, after the implementer freezes runtime source and is
ready for the single native functional run:

```sh
PATH="$PWD/.tools/node/node_modules/.bin:$PATH" node scripts/dom-native-acceptance.mjs --browser chrome --output /tmp/osr-39-native/chrome.json
PATH="$PWD/.tools/node/node_modules/.bin:$PATH" node scripts/dom-native-acceptance.mjs --browser safari --output /tmp/osr-39-native/safari.json
```

Node24.22.0 is enforced. Reports, the compiled Carbon helper and checkpoint data
stay outside the checkout. Each run records exact Node, macOS product/build,
browser capability/bundle versions, source/artifact hashes, actual current and
available input source IDs, physical key-code actions, trusted browser event
traces and native canonical/selection/history checkpoints. Chrome uses the actual
installed `channel: 'chrome'`, headed. Safari uses the installed safaridriver and
W3C session; pass `--safari-url http://127.0.0.1:PORT` to use an already-running
local driver. It never executes `safaridriver --enable` or changes Safari options.
A driver started by this runner is stopped in its final cleanup.

Chrome receives a fresh `CFFIXED_USER_HOME` directory under the external report
folder for its app-data lookup. This addresses the observed macOS27 startup
path-service failure without using the real Chrome app-data directory. The
override applies only to the Chrome child; Carbon input-source verification and
System Events use the actual user environment. The report records that boundary.

The Carbon helper lists existing input sources and selects only an existing,
enabled, selectable source. It does not enable, install or persist a layout.
The runner verifies the selected ID after selection and again after activating
the browser, before sending key codes; it verifies the ID again after each batch.
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
code, inputType, data, composing/cancelable state and prevention after dispatch.
Canceled beforeinput may correctly yield no browser input event. No synthetic
InputEvent dispatch is used. System Events is platform key-code injection; this
is not a claim of input from a physical hardware device. An isTrusted flag alone
cannot establish the provenance, so the runner also records its actual key-code
commands and verified OS input source.

The trace is limited to2048 entries and24 checkpoints; only the fixture editing
host, fixture host control and selection changes inside the host are observed.
Page errors/CSP violations and native resource cleanup are bounded and checked.
No private documents, accounts, general application keystrokes or host diagnostics
are collected. Actual Tab return is recorded; the runner does not read or alter
the user's global Safari Tab preference. This covers basic39 focus only.

For an existing Safari MCP session, load `/dom`, then import the static module:

```js
await import('/dom-native-host.js');
await domNative.prepare('en'); // or 'ru', fresh mount
```

The same module exposes `phase(name)`, `focusControl()`, `checkpoint(name)`,
`history('undo'|'redo')`, `verifyTrace()`, `observations()` and `finish()`.
Checkpoint names in order are `focused`, `typed`, `split`, `joined`, `undo-join`,
`redo-join`, `delete-last`, `focus-return`; trace phases for real input are
`focused`, `type`, `split`, `join`, `delete-last`, `focus-return`.
Perform OS input-source confirmation and actual physical key-code actions between
these calls. WebDriver/PW text insertion is not an OS-layout input proof. Retain
actual browser/OS/source/action metadata alongside the module result, preserve
failures, call `finish()` and verify `resourcesReleased`, and restore the original
input source even if an assertion fails. Do not select another layout merely to
make an unexpected result pass.

This run does not claim OSR-40 full selection/drag/scroll, OSR-41 IME settlement,
clipboard, screen-reader acceptance, Firefox support or release acceptance. The
broader historical OSR-58 prototype protocol remains separately qualified.
