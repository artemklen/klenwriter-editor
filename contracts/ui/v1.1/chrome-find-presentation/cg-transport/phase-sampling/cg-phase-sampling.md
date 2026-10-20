# CG02 read-only final-phase sampling — CS01

Source-authored before candidate. This append-only addendum changes only the
maximum wait and scheduling of the already bounded final phase observation in
find-key.swift. The existing CG02 contract/SDK pins and all old run reports stay
unchanged. Root reports Chrome15 Find completed with native Find focus outside
the document; its close program completed both posts but remained exact-owner
OPEN for all12 read-only samples, exhausted at128.401917ms with approximately970ms
original helper allowance. That completed run remains FAILED. Its exact bytes
are not reconstructed or reclassified by this source proposal. No phase-duration
guarantee or single blocking-getter cause is claimed.

Retain at most12 total full original-owner phase measurements after all posts.
The first measurement is immediate when the original budget has result reserve.
Keep the SAME helper remaining deadline received from Node, itself bounded by the
original1s pageguard. Keep all proof predicates, strict final Find OPEN / Escape
CLOSED, exact OPEN/CLOSED-only intermediate ownership, and core-before-phase
completion semantics. Ownership failure stops immediately; no wait for ownership
to return. This is read-only observation, never another key post or input retry.

After a successful complete-owner measurement in the opposite desired phase:
`remainingReads = 12 - reads`; `remaining = deadlineMs - elapsedMs`;
`usable = max(0, remaining - 16)`; when remainingReads>0 and usable>0, wait
`min(64, usable / remainingReads)` milliseconds. Otherwise stop as UNOBSERVED.
Before another measurement require `deadlineMs - elapsedMs > 16`; recheck after
every wait using the current monotonic clock, never the previous remaining value.
Each requested wait is <=64ms, and there are at most11 waits. Actual scheduling
and AX-call durations can overrun; no latency guarantee is inferred. No wait
occurs for correct phase, refused owner, expired budget, or reads==12.

The16ms reserve is a source-authored bounded policy for encoding/return, not an
OS latency fact or guarantee. It does not extend the deadline or grant input
authority. If a measurement exceeds it or the process times out before a valid
result, the existing conservative outer unknown/completion rules remain. After
all posts, valid complete core is always retained in a returned completed result
regardless of verified/refused/unobserved final phase or late return.

No acceptance predicate, native literal, key sequence, event count, private
episode guard, ordinary/Safari/AS path, or public API changes. No native/runtime
actions during authoring. Existing163 units, UI216/overall972 browser inventory
remain unchanged source expectations, not a new execution or PASS claim.
