# Bounded AS8 duplicate-check reduction — FA01

Source-first addendum before candidate change. Preserve frozen ChromeFindv3,
all native/Find episode predicates, original core ACK ordering, legacy4 paths,
Swift normal/window-only measurements and 1s guard budget. Chrome11 stays FAILED
with unknown main/UP completion; no retry/timeout increase/action replay.

Source duplication: AS8 normal Find PRE calls old requireFixture, then stronger
closed requireChromeFindFixture; AS8 close POST calls the stronger closed check,
then old requireFixture again. Both routines repeatedly query the same owned
process/root/window attributes. Chrome11 timeouts do not locate a particular
slow call, and this source hypothesis is not measured performance proof.

Minimal candidate must consolidate EACH of those two duplicated whole checks
into the single complete closed presentation check at that same PRE/POST phase.
DO NOT simply delete predicates. In particular, current new guard's genuine
focused-root equality and root name do not explicitly read the original focused
AXTitle property: retain/add that exact equality against expectedTitle. The
closed check must preserve all original predicates plus all new ones, including
exactPID/processcount/name/bundle/frontmost, count1 (stronger than <=32), unique
nonce root name, actual front root object/name, actual focused root object AND
its AXTitle, original frame/finite bounds and original role/subrole. Keep OPEN
aux exact full title/roles/distinct object/containment and all context rules.

Keep actual ownership checks BEFORE and AFTER unchanged key transitions. Keep
the new guard's final fresh count/frontmost/focused-root/title/frame rechecks;
never reuse a pre-key observation after keys or silently cache final fresh reads.
Only the expected nonce/title/pageTitle and original argument-frame validation
are pure constants: validate once per AS8 invocation, retain locally and reuse
within that invocation. Neither parsing constants nor a captured object/title
becomes input authority. No actual field cache across guards/key boundaries.

Minimal candidate may replace ONLY new-AS8 nested AXRole/AXSubrole reads with
the direct read-only role/subrole properties declared by the installed primary
SystemEvents.sdef (pinned in system-events-role-source.json). Keep exact expected
AXWindow/AXStandardWindow/AXUnknown strings; reject missing/other values, never
use human role description. Preserve fresh PRE/POST/final checks. This changes
access form, not predicates, and predicts no measured speed.

Use only explicit required scalar reads of exact owned process/window/AX
attributes; no get-properties/all-attributes/children, no broader
host/URL/AXWebArea/clipboard/appdata queries. No speculative get{object references}
remote batching: FD01 showed a logged frontmost specifier rather than an explicit
boolean. If repeated scalar values are locally grouped, force actual primitive
values and preserve the same fresh snapshots/predicates. No claim that source
list construction reduces IPC; that cannot be established from these traces.

Leave the existing requireFixture and legacy4 branches byte-identical. AS8
external arguments, frozen request/response/phase fields and key sequence stay
identical. Normal Find PRE and close POST still have EVERY old guard condition
via the single complete closed guard; other special PRE/POST remain complete.
No new helper process/event pump/queue/listener, snapshot authority, public API,
window exception, predicate removal, positive result, retry or alternative input.

No additional unit/browser case count: expected155/216/972 remain. Finite source
conformance vectors below augment existing FD source expectations; candidate must
pass root-owned compilation/appropriate existing controlled checks before fresh
normal finite installed proof. Actual timing may still fail within1s; preserve
that failure rather than broaden scope. This preparation runs no AS/Swift/helper,
compiler, browser or OS input and changes no repository bytes.

The UP-only cleanup does not contain either duplicate whole old guard; removing
those calls cannot establish cleanup improvement. Only pure constant-validation
reuse and the same strict direct role/subrole access apply there. Its original
timeout remains UNKNOWN/FAILED. No performance success is claimed for any path.
