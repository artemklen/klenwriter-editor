# Find postguard read-only diagnostic — FD01

Additive source-authored observation before any candidate run. Chrome09 and all
its statuses/checkpoints remain FAILED/unchanged. No acceptance relaxation,
Find-title allowlist, retry, reactivation, input transition, clipboard access,
browser mutation, broader host survey or stopped campaign.

Existing key helper checks exact process PID/name/bundle/frontmost/unique fixture
title/front/focused windows before and after the unchanged key sequence. Keep
ALL checks. Only the existing POST-check in actual normal action 'find' is
wrapped: if it throws, preserve its message and number, optionally collect this
bounded read-only diagnostic, then ALWAYS rethrow that original message/number.
All other key and cleanup branches retain the original direct POST-check. The
PRE-check, transition specification, owner pending/disabled semantics, physical
receipt fields and command coordinator remain unchanged.

Diagnostic re-resolves ONLY application processes whose unix id is the exact
expected already-guarded PID. Require exactly one and its unchanged expected
name AND bundle before reading windows. Never inspect another process or
system-wide focused app. Log that owned identity/frontmost/window count, with
cap32. If count exceeds32, stop diagnostic. Never copy an unbounded window-reference list: iterate only the previously
bounded count by index. Log same-process focused window AXTitle FIRST;
then at most32 windows' name, position, size, AXRole and AXSubrole. Bound title
strings to96 characters, role/subrole48, mark actual truncation explicitly.
Unsupported individual attributes are explicitly [unavailable]; not fabricated
measurements. No elements/child tree, documents, URLs, user text or appdata read.
Existing stderr record is max4096 characters, so diagnostics may be incomplete
after that existing cap; never claim unrecorded windows as inspected proof.

Diagnostic failures, including logging failure, must not replace the original
POST-check message/number. Suppress nested diagnostic error, then unconditionally
error originalMessage number originalNumber. A successful diagnostic never
returns a successful key receipt. If the POST-check succeeds, no diagnostic runs.
Actual transition facts/window names remain UNKNOWN until a fresh otherwise
normal finite candidate attempt. No inferred Find-window name or permission
claim. Source preparation performs no AppleScript compile/execution/OS action.

Only scripts/ui-native/input.mjs changes. Existing controlled UI unit145 counts
and test-name inventory remain unchanged. V7's16 explicit unit inventory pins
do NOT include input.mjs, so those16 remain identical. The helper's tracked
source and generated-script pins must be updated to actual committed bytes.
Compiled fixed AppleScript helper bytes/pins necessarily change and must be
recorded fresh. No inherited PASS for the changed physical helper.
