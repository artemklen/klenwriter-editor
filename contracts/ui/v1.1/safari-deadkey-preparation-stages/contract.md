# SD01 — initial Safari deadkey preparation and literal stage observations

SOURCE_AUTHORED_BEFORE_CANDIDATE. This separate installed-fixture addition
changes no key/cleanup program, guard predicate/read order, ACK, DOM assertion,
clipboard/model literal, public API or input completion policy.

## Closed observation and limits

Safari11 at6833de4e9be60b332115d8a7962b6870a284163b remains FAILED:
28PASS/1FAILED/1NOT_RUN,110 actions. Immutable report:
/tmp/osr-42-installed-development-6833de4-11/safari/safari.json,
SHA25617fd2e5feee9bc680b5810d5eebad1987d3519ffd59b33ffcd605db1e266d668.
RU composition-dialog's initial deadkey had a full original Swift preguard but
AS failed `Fixture title not frontmost`, empty stdout/exit1 at297ms. Its finish
trace contains only focusin, with no KeyE/composition. AS4 has no stage evidence,
so PRE versus POST failure and the native cause are UNPROVEN. One original
UP-only cleanup returned complete ACK; actual resources0/layout restoration and
owned-tab closure do not promote the failed row. No failure is retroclassified.

## One new-mount preparation interval

At the start of coordinator physical(), BEFORE its original coherent source
check, inspect, action-row creation and adapter.input, request exactly one
passive200ms wait iff ALL are true:

- browserName==='safari'; action==='deadkey-acute';
- entry.caseId starts with the existing literal `composition-`;
- entry.actualActionCount===0 (the original first action of this prepared mount).

Record an entry.preparation item with action
`safari-new-mount-deadkey-preparation`, requestedWaitMs200, startedAt/finishedAt
from the existing now() clock and a literal scope saying preparation only,
no input/read/refocus/retry/authority. Save before and after the wait. No browser,
AX/input-source read, input, focus/activation or other platform operation is added
during the interval. Only timer/clock/evidence writes occur. Do not replace a
failed action, repeat a deadkey, or wait inside an already issued input guard.
The unchanged original coherent/source/inspect and fresh one-second input guard
start afterward. The pause neither retains old authority nor extends that1s.
No claimed OS settling-duration bound or causal remedy follows from this policy.

No such pause is added for cleanup, Chrome, noncomposition rows, other actions,
later actions in a mount or excluded/not-run rows. The original finite matrix
contains one initial deadkey per composition row; at most eight preparations
occur in a full Safari EN/RU run. No new row, loop or action is introduced.

## Closed literal AS stages

Add one private boolean to fixedKeyScript after existing arity/PID/browser and
AS5 tag validation. It is true ONLY for original FOUR-argument Safari invocations
whose fixtureAction is exactly `deadkey-acute` or `release-deadkey-acute`.
Consequently invalid AS5 tag/browser/action, invalid PID/browser, AS8 and all
other routes cannot emit these markers. The same existing AS4 ownership PRE
and action dispatch remain mandatory. There is no new caller option/argument.

For these two action branches only, emit exactly the six possible literal stderr
markers below, in order, with no dynamic value or timestamp. Place PRE begin/end
immediately around the UNCHANGED original requireFixture call; KEYS begin/end
immediately around the UNCHANGED original System Events program; POST begin/end
immediately around the UNCHANGED original POST requireFixture call. Never put a
marker in a catch that alters/rethrows another failure or resumes input.

1. OSR42-SD01 PRE begin
2. OSR42-SD01 PRE end
3. OSR42-SD01 KEYS begin
4. OSR42-SD01 KEYS end
5. OSR42-SD01 POST begin
6. OSR42-SD01 POST end

A failure/timeout may retain only a prefix or no marker. At most six are emitted
per invocation, no loops/getters/window/title/text/value surveys. Stage records
are NOT ACK, posting/completion proof, native event proof or input authority.
The existing full stdout core receipt is the sole original platform ACK. Missing
or malformed/late replies preserve original unknown/known-completed behavior;
strict actual trusted DOM keydown AND keyup and all downstream checks stay.

Normal deadkey remains OptionDOWN, key14DOWN, key14UP, OptionUP. Original
release-deadkey-acute remains OptionUP,key14UP, at most one fresh pending-owner
cleanup, with no DOWN/replay/refocus. No guard predicate/getter/read order changes.
Chrome and other keys have no SD markers; SC01 Copy AS5 branch, old AS8 markers,
default stdout, request/reply fields, private API and all acceptance checks stay.
AS stderr remains under the original bounded capture. Added diagnostic overhead
can still fail the original deadline; there is no retry or acceptance exception.

## Source scope

Candidate touches only scripts/ui-native/input.mjs and
scripts/ui-native-acceptance.mjs; root freezes this contract first. No candidate
code, actual repository mutation, compile, tests, helper/UI/OS input during
contract authoring. Existing177 unit names/assertions and216/972 browser
inventory remain; these finite data vectors are not new glue mirror tests.
