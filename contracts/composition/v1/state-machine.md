# Composition ownership and settlement, v1

Normative pre-candidate OSR-41 design. Accepted base is main
`69d8cffe2704d7c868c240344c7c3131b0b10d82` (tree
`385f01e4fed9c539f75f01273fdc86f59e90921c`). This file specifies behavior;
it records no implementation or executed acceptance.

## Authority and start checkpoint

One InputOwner per mount owns one composition generation. Its private states are
idle, composing, settling, committing, committed, cancelled, recovery and destroyed.
Mounted flags mirror that owner; they are not another command publisher.
Before provisional ownership, use the existing selection owner to synchronize the
actual directed DOM selection. A refused/busy/incomplete sync preserves available
input and never fabricates a range. Bind the baseline *after* legitimate state-only
selection setup: private mount identity, checked local u64 generation, full SDK2
context and StampDto, original directed native selection, structural window, actual
objects, and shared targeting serial. Original native state remains the authority.

Every preedit invalidates old public bookmarks/cancels pointer and clipboard work.
Advance the generation's expected serial for an owned preedit observation only
when the prior serial still matches, synchronously, without admitting a foreign
target between check and update. An owned composition beforeinput, or owned
IME-control key observation while actually composing, can be accounted this way.
An intervening public host selection/command intent, even NativeNoop, cannot be
adopted. Escape/Enter/IME candidate navigation may invalidate bookmarks without
themselves deciding the final text. Ordinary typing when no composition generation
or tombstone exists keeps the existing OSR-39 path.

## Browser ownership and protected work

While composing, the UA owns the bounded actual provisional subtree. The adapter
does not normalize, format, detach, recreate, or remount it. A UA-created Text or
wrapper is not a new model ID/mark authority. Observe exact original/provisional
text, selected structural atoms, endpoint correspondence and outside sentinels;
never derive final text from event.data or longest-common-prefix guessing.
Capture and identity rules are in structural-correspondence.md.

Keep the existing OSR-39 harmless snapshot/receipt/barrier and narrowly admitted
outside selection/typing paths, including its actual-object preservation witness.
Conflicting formatting/history/move/replace/mode work refuses before dispatch.
No adapter command queue is added. An outside native stamp/target change makes the
old generation stale at settlement: retain its newest available input, refuse, and
do not reset the baseline or implicitly rebase over another intent.

## Bounded settle protocol

On compositionend, retain an initial complete bounded checkpoint and schedule one
settle owner. The original end data/trust value remains raw evidence only.
Two equal complete reads at consecutive RAF boundaries, with no relevant mutation
between them, admit settlement. The initial end capture is not one of these two
RAF reads. At most eight post-end reads, one RAF and one deadline timer are owned.
Deadline is 250ms from end using the document's monotonic clock. The first observed
callback at/after that deadline cannot dispatch; actual delayed callback time is
recorded. No timer can prove the browser will never emit another event.

Changed observations reset the consecutive-equality count but do not extend the
deadline or read budget. Charge every observation and relevant mutation. Caps:
eight structural entries including atoms, 131072 visited nodes, depth128,
2097152 UTF-16 units per text observation, 4096 mutation records per generation.
Do not allocate an unchecked traversal stack or truncate a result into success.
Incomplete/bounds/deadline/stale results preserve input and enter explicit recovery.

Blur requests observation but does not manufacture an end or release UA ownership.
If end never arrives, a bounded 250ms blur watchdog transfers the actual region and
recovers; it cannot restore/remount an active composition. Escape alone does not
cancel. Empty/mismatching end.data and a false trusted bit alone do not refuse.
An unrelated control can keep focus; settlement does not focus or steal its range.

Before native dispatch, synchronously recheck full context/stamp, original native
selection, expected targeting serial, complete final region, and outside sentinels.
An unchanged complete original correspondence means no semantic dispatch and no
document/history entry. Restore valid committed DOM correspondence after retention,
without claiming that setup selection/marks/barrier epochs never changed. A changed
admissible replacement uses the existing InsertText binding with isolated history.
Claim the generation and retain recovery material *before* unprotecting, dispatch,
native publication, or a host callback. There is no await between recheck and submit.
No second DeleteSelection dispatch precedes insertion.

## Original native submission and one-use completion

Keep the original immediate or queued Submission. Queued is not success, refusal,
cancellation, or permission to retry. One completion path owns it. Reentrant end,
input, native event and host callbacks cannot claim the generation again. Native
response and native event decide changed/no-op/refused/fatal truth. Record full
document, selection, marks, IDs, maps and history separately; never infer a commit
from DOM patching or MutationObserver alone. A first native Refused is not rerun.

After success/cancel, one bounded tombstone keeps exact accepted native/DOM
correspondence. An unchanged final/end/input observation is deduplicated without
another transaction. A changed/composition-specific/uncorrelated tail is retained
and recovers. Expiring a timer does not turn a late input into an ordinary edit.
The tombstone is replaced only by a checked new generation or explicit new intent;
it is not an unbounded event log and is never extended by duplicate observations.

## Explicit ordinary gesture boundary

This is a deliberately narrow operational policy, not proof of causal provenance
for arbitrary browser streams. No combination of event name, data novelty, trust,
elapsed time, or a later keydown can retrospectively classify an earlier input.
The historical Safari early-space case stays ambiguous, including the distinction
between U+0020 event data and U+00A0 observed DOM. Do not make it a positive golden.

A new owned non-composing ordinary keydown can establish a *forward* boundary only
while current complete DOM equals the stable accepted checkpoint, full native
context/stamp/selection are coherent, focus still belongs to the host, the expected
intent is current, and no original native ticket is busy. Dead/Process,
keyCode229/isComposing, Escape, modifier-only and IME-closing Enter are not ordinary
permits. Printable scalar key, plain Backspace/Delete, and a later ordinary Enter
are admitted only after composing ownership ended; modified shortcut keys are not
text permits. OSR-40 navigation/selection ownership remains authoritative.

The permit is created prospectively during that owned keydown, not by a later
input/keyup. A repeated down inherited from a still-held composing key is not a
fresh gesture. Enter is not a permit while its composition-closing key identity
is unknown or still held; a separately observed release followed by a fresh
ordinary down, or a known different closing key, is required. Keyup without a
corresponding beforeinput closes the permit without fabricating an operation.
Only one pending permit is retained. A second unmatched key replaces nothing:
retain the unavailable intent and recover rather than coalesce two operations.

At that boundary, settle an already stable pending generation once if necessary;
if not yet stable, refuse the new gesture explicitly and retain it. Only an
immediate native ok result and a fresh post-publication token/DOM recheck permit
the new ordinary operation. Queued original completion cannot enqueue that next
operation in a second queue. Preserve the unapplied gesture in recovery instead.

One permit admits at most one cancelable non-composing ordinary beforeinput with
the same owned collapsed DOM range/intent. Printable insertText must match the
literal permitted key; Backspace/Delete/Enter must match their declared existing
command, with Enter vs Shift-Enter distinguished. It is cancelled and sent through
the existing ordinary input path as its own isolated operation. A missing/changed
target, changed context/serial, unmatched data/type, duplicate beforeinput, or
composition-specific input type cannot use the permit. Preserve available input
and recover instead. Normalization/autocorrection without that correspondence is
not silently relabelled a new key. A new explicit public native host targeting
operation may retire a *committed* tombstone after native/DOM correspondence is
checked; it never makes an unresolved old generation current again.

The owned range is the actual bounded DOM Selection with native correspondence.
If getTargetRanges supplies a range, it too must match that owned range; an empty
getTargetRanges result does not authorize inventing one and does not replace the
required actual DOM/native selection check. No StaticRange or event.data is model
authority while provisional text is unresolved.

At most one composition semantic unit and one corresponding ordinary unit can
therefore be claimed for these two explicit owners. Observably indistinguishable
old and new browser streams are not claimed distinguishable. Any later duplicate
or ambiguity remains a visible lossless recovery path. A key arriving after an
already ambiguous input cannot rescue or replay that input retroactively.

## Recovery and destruction

Freeze additive public provenance in public-api-additions.ts; existing recovery
originalInput/region semantics remain. Store latest original/provisional text and
structural/range provenance before allowing a native patch. A normal native Refused
keeps its original response/ticket/reason and unchanged committed native facets.
After safe retention, restore affected committed presentation through authoritative
existing native view rows/guarded reads, disable editing, and expose the packet and
reason. No fabricated publication Event, whole-document serializer, second SDK,
or whole-root remount is used for restoration.

For incomplete/oversize capture, keep the actual region intact and explicitly
transfer its ownership. Bounded text is not a complete markup/atom serialization.
Unapplied input of at most2097152 UTF-16 units uses the bounded descriptor; larger
or unreadable input transfers the original InputEvent/KeyboardEvent reference
instead of copying/truncating its sole data. This retains one unbounded existing
host capability, like retained_dom, and makes no bounded-byte recovery claim for
it. Capture occurs before preventDefault/disable/host callback can destroy input.

Fatal/unknown preserves actual may-have-committed/ticket truth and available input;
it does not promise base restoration or pretend to be Refused. Store the packet
before notification. Missing/throwing/reentrant callbacks cannot replace the sole
copy or original native outcome. Composition recovery invokes onRecovery only
after storage and editing is stopped; destroy returns the same retained material
without recursively repeating that notification. Legacy non-composition behavior
remains covered by the unchanged39 tests.

Destroy stops owned RAF/timer/listeners and retains bounded input or transfers the
actual DOM before release. Original queued native completion remains truthful;
late completion cannot access another mount, replay work, or mutate an already
returned immutable destroy receipt. Actual pending owner continuations remain
counted until terminal, even after listeners are removed. Existing DOM resource
continuations include settle RAF/timer/completion work, retainedInputBytes includes
owned bounded copies, and retainedRecoveryRegions includes the retained owner.
Final detached/native/installed receipts must show actual terminal zero resources;
the mere absence of a listener is not complete cleanup.

A start whose checkpoint cannot be admitted reports only facts it has: nullable
context/base/range in recovery provenance, without an invented valid generation.
Local u64 exhaustion refuses as dom.composition_limit/generation_limit instead of
wrapping or proceeding without ownership. Retain any already available composition
event input as data/provenance, never as an authority to commit. Its bounded source
is composition; an oversize event reference can be transferred like an input event.
