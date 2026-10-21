# Installed clipboard transport (OSR-47)

This source is a closed helper and Node adapter, not an executed installed
acceptance result. The fixture/coordinator must separately prove trusted browser
events, native state/canonical/range/identity/history, recovery, and final release.
It reuses no prior installed result and changes no existing helper or test.

Compile `input.swift` to an absolute outside evidence path using `/usr/bin/swiftc
-O scripts/clipboard-installed/input.swift -o /absolute/fresh/clipboard-input`.
Compilation does not execute the helper. The future runner must start in the
already authorized Terminal context and pin the compiled binary and source.
There is no permission request/reset, launch, activation, browser evaluator,
pointer, screen capture, host survey, or arbitrary shortcut API in this module.

```js
import { createClipboardPlatform } from './native-platform.mjs';
const platform = createClipboardPlatform({
  helperPath: '/absolute/pinned/clipboard-input', browser: 'safari',
  nonce, title: `KlenWriter Clipboard native ${nonce}`, onRecord
});
const originalOwner = platform.inspectOwnedWindow();
platform.writeClipboard({ plain: 'known source literal', html: null });
platform.key('paste');
// After a separately verified actual browser Copy:
const actual = platform.readClipboard();
```

`inspectOwnedWindow()` is a single bounded inspection of the exact foreground
Chrome/Safari process and one nonce title in at most32 AX windows. It requires
the original AXStandardWindow to be the focused CF object, records the actual
PID/frame, and rechecks the same CF object within each helper invocation. Keys
and clipboard calls bind that original PID/frame/title; a failed inspection or
later failure cannot reacquire another owner. Chrome's AX title has its literal
` - Google Chrome` suffix. No web viewport, URL or target geometry is inferred.
The caller must obtain fresh owned fixture focus/range facts before each key;
the OS guard alone is not document/range authority.

Only `copy`, `cut`, `paste`, `undo`, and `redo` are accepted. The fixed programs
are CmdC/CmdX/CmdV/CmdZ/ShiftCmdZ using key codes8/7/9/6 and modifiers55/56.
Safari normal Copy releases Command before key8 (the previously source-selected
SC01 program); the other single-modifier programs release the key first.
Events use a private CG source and original constructor timestamps, with all
finite events allocated before the first post. Every transition has a fresh
full owner measurement and read-only post-event access check before the program.
Posting uses `cghidEventTap`; this is platform event provenance, not hardware
device evidence and not a browser delivery ACK. The total key process deadline
is1000ms, including Node spawn. A complete contextual posting receipt clears the
pending program before final owner/deadline validation; later failure remains
failure without inventing held keys. Missing/malformed/partial completion is
unknown and disables later normal input. Exactly one guarded matching UP-only
cleanup is attempted automatically, using the saved original owner/action.
Cleanup never sends a DOWN, replays the command, reactivates, or rebinds a window.
Its actual outcome remains separate. `releaseOwnedKeys()` cannot repeat it.

Clipboard access is limited to `public.utf8-plain-text` and `public.html`, at
most2MiB per format and4MiB combined. Write accepts only two closed string/null
fields, validates before clearing, constructs one item, and records actual
NSPasteboard change counts. Read fetches only these selected formats, records
exact UTF-8 bytes as base64 plus scalar text, and rejects invalid UTF-8 or a
changeCount race. Neither path normalizes CR/LF or NFC/NFD. Any OS normalization
or scalar inequality is a separate observed failure/qualification, never silently
accepted. NSPasteboard may materialize a full selected representation before its
size is known; the post-read cap does not claim to bound that OS-side allocation.
No prior user clipboard content is read or restored: the coordinator may use
these methods only for predeclared fixture writes and reads following actual
fixture Copy/Cut. Failure after clear/write records that the clipboard may have
changed; it is never retried or described as unchanged.

Helper stdin is one closed JSON request (maximum32MiB); stdout/stderr are bounded
to16MiB by Node. Clipboard calls have a2000ms process deadline; no key authority
is extended by that separate clipboard budget. The adapter records original
request, exact stdout/stderr/exit/signal/error, parsed receipt, monotonic duration,
and validation error. The runner must persist each `onRecord` immediately in its
owned evidence directory and report every failure/unknown before cleanup.

No operation is performed by importing `native-platform.mjs`. The fixture and
coordinator are separate integration work; this module supplies no acceptance
verdict, native semantic assertion, retry policy, or synthetic-event fallback.
