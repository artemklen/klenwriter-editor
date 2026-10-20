# Direct UTF-8 clipboard observer — CB01

Source-authored observer correction before a fresh installed attempt. Preserve
Chrome08 FAILED, original action/checkpoint bytes and every existing native,
copy-confirmation, mode, Find, zoom, focus, CSP, cleanup/resource assertion. No
editor/runtime/public API, frozen native literal, browser-test or unit inventory
change. Old observed AppleScript output must remain diagnostic, never rewritten.

In the existing readOnly copy part of modes-zoom, wait for the same actual
clipboardResults copied/confirmed. Preserve the original exact AppleScript
command and its unmodified execution record at entry.clipboardAppleScriptRead.
Read the general pasteboard separately through fixed /usr/bin/env argv
['LC_ALL=en_US.UTF-8','LC_CTYPE=en_US.UTF-8','LANG=en_US.UTF-8',
 '/usr/bin/pbpaste','-Prefer','txt'], full stdout, UTF-8 decode. This executes
pbpaste directly, with no shell, pipeline or output transformation. Its exact
wrapper/argv execution is entry.clipboardRead. Add no stdin, conversion pipeline, trim, newline append,
CR replacement or LF/CR acceptance alternative. Never write the clipboard.

The fixed env argv supplies and records ONLY those three closed locale
overrides. Other inherited environment values remain private and unrecorded;
env has an explicit utility, so it executes pbpaste rather than printing the
environment. Explicit LC_ALL prevents inherited category overrides changing
the encoding. The private run() helper and every other caller are byte-identical;
its existing encoding:'utf8', timeout/exit/error/maxBuffer checks remain. No
helper option or public API extension.

Keep the old LF assertion on clipboardRead.stdout.replace(/\n$/,'') against
'ab\ncd', and ADD the stricter assertion clipboardRead.stdout === 'ab\ncd'.
The exact required UTF-8 stdout is FIVE bytes 61 62 0a 63 64, with no terminal
newline. CR, CRLF, an extra LF, empty output or another value all FAIL. The old
assert is preserved, but cannot mask an appended newline because the new exact
assert also must pass. Native/canonical/state/events unchanged checks remain.

Installed primary docs document -Prefer txt and locale-determined encoding.
They explicitly permit fallback to other pasteboard formats if txt is absent;
this observer does not claim a txt-only UTI/raw NSPasteboard inspection. They
also do not establish the actual copied line-ending bytes or guarantee the
future stdout. The fresh command result must satisfy the fixed LF assertion;
if it is CR the run stays FAILED. No accepting both, normalization or inference
from native confirmation alone. This source preparation never reads clipboard.
