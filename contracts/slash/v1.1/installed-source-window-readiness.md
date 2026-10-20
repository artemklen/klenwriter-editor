# Chrome window preparation after a real layout selection

Authored at b7210f5 before this preparation candidate or its physical run.
Chrome06 remains FAILED: the main ordinary-ru attempt has unknown delivery;
its single original key6-UP cleanup has a completed matching ACK. No additional
key or neutral-state helper is required. The extra AX window is undescribed;
its identity and the cause of the front-window refusal remain unknown.

For this isolated Chrome adapter only, a real TIS source selection retains its
existing 250 ms wait and coherent status readback, then performs passive window
preparation. Keeping an already selected layout adds no preparation. Restoration
after browser departure adds no window reads. Safari is unchanged by this rule.

Use only the existing read-only --inspect-window helper and own-page reads.
Bind every successful sample to the original bootstrap PID, nonce/URL/title,
exact root frame and viewport, unique expected/focused root and contained view.
The page URL/title/focus/viewport must remain the same, and its actual raw
selection must remain equal before/after and between samples. No activation,
focus, resize, source reselection, semantic request or input is permitted.

At most15 inspector samples and a separate total preparation deadline of2000 ms;
each inspection uses at most500 ms of the remaining deadline. Between successful
same-owner samples only, at most100 ms passive waiting is permitted. Exactly one
AX window is READY. Exactly two with the same fully proven root permits passive
waiting only; no auxiliary purpose is inferred or accepted as input authority.
Other counts, changed owner/frame/page/selection, malformed/error/timeout or
expired preparation fail immediately. Record all original requests, readbacks,
timings, failures and executions. There are no retries of failed inspector calls.

This preparation never authorizes a key. Every subsequent original physical
action retains the unchanged page/PID/root/title/source checks and fresh one-
second guard-to-post deadline. No title guard is loosened. A missing readiness
proof remains explicit failure/NOT_RUN; prior FAILED attempts are not rewritten.
