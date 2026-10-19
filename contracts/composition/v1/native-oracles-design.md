# Native literals for composition v1

These are independent expected data prepared before OSR-41 runtime implementation.
They are not results from an editor, native observer, WASM module, browser, or test.
The root contract commit supplies the freeze boundary. Existing InsertText behavior
is reused; no command, KWDJ schema, or ABI change is specified here.

The accepted Refine is `/tmp/osr-41-refine-69d8cff-01/refine.md`. The historical
unfrozen proposal in `/tmp/osr-41-native-oracle-proposal-01` remains unchanged.
`native-oracles.json` records its byte/SHA provenance and the selected source pins.
All 24 selected files were compared byte for byte with Git
`69d8cffe2704d7c868c240344c7c3131b0b10d82`; that commit and the accepted OSR-40
feature commit `39d5ee06b415f1450a7ad26f81ea668800196e78` have repository tree
`385f01e4fed9c539f75f01273fdc86f59e90921c`. This is selected-source binding,
not an assertion that all concurrently authored contract files are unchanged.

## Matrix and binding

The matrix has seven seeds and fifteen families, each in both directions: 30 cases.

| Family | Seed | Exact native boundary |
| --- | --- | --- |
| P01 | A | `abcd`, T1→T3, `Z` gives `aZd` |
| P02 | A | Same range, U+044F `я` gives `aяd` |
| P04 | A | Same range, `e` + U+0301 gives `aéd`; no NFC |
| P09 | B | Compatible sibling paragraphs `ab` / `cd`, L1→R1, gives `aяd` |
| P10 | C | Same endpoints around a fully selected scene_break, gives `aяd` |
| P11 | D | Scalar-readable E0→E1 inside cross-mark e+accent EGC refuses |
| P14 | G | Strong `abcd` T1→T3 gives strong `aяd`; attrs/hard_break/code tail survive |
| P15 | A | Precomposed U+00E9 `é` gives `aéd` |
| P16 | C | Precomposed `é` cross-scene gives `aéd` |
| P17 | G | Precomposed `é` gives strong `aéd`; outside BR/code/attrs survive |
| P18 | A | Spacing U+00B4 `´` gives `a´d`; changed Escape/blur counterpart |
| P19 | C | Spacing `´` cross-scene gives `a´d`; changed counterpart |
| P05 | A | Complete original correspondence after provisional input: no native dispatch |
| N01 | E | Headings with level2/level3 refuse lossy transformation |
| N02 | F | Paragraph inside blockquote→outside paragraph refuses different parents |

The forward and reverse variants have identical resulting canonical data and
caret, but different exact original directed selections. Undo must restore that
direction. P10 deliberately keeps the proposal's `я`; a DOM fixture using `Ж`
would be a different literal rather than proof of this case.

P15/P16/P17 are explicit native counterparts to the installed genuine US
Option+E/E observation requested for both EN/RU host locales. They specify the
literal U+00E9 replacement; native success alone cannot prove that a particular
physical sequence actually produced it. P18/P19 specify changed U+00B4 spacing
accent after Escape/blur, including empty compositionend data: this is a changed
replacement and must never be treated as P05 cancellation. These one-UTF-16-unit
replacements inherit the independently derived identity/map/history mechanics of
P02/P10/P14, while their exact canonical text and command payload are separate
literals. P04 remains decomposed e+U+0301, without normalization to any of them.

Each `inputs/*.json` and `expected/*.canonical.json` contains one independently
authored compact sorted-key JSON document followed by a file newline. Its content
without that newline is the case's exact `canonical_json` string. JSON serialization
used only the Python standard library, not the production canonical serializer.
Offsets are UTF-16 units, with explicit affinity. No Unicode segmentation or
normalization was performed by the data authoring step.

ROOT is captured from the admitted public native root. Other role tokens are
captured by the input's explicit child paths before any operation. These are
macros for opaque target-local IDs, not allocator-order or numeric-token guesses.
All historical role equality, retirement, revival, and final creation requirements
are exact. `$SESSION`, `$GENERATION`, and `$EXACT_CURRENT_STAMP` bind actual full
stamps, preserving equality and the literal revision/selection/history counters.
They are not strings to send as real tokens.

## Setup, publication, history, and marks

Every case admits a fresh standard editable KWDJ document with unchanged default
limits and no registry extensions or fact updates. One public guarded set_selection
changes the fresh null selection to the declared directed selection. Establish and
acknowledge the event checkpoint after this setup state event. Source:
`crates/engine/src/session.rs:485`; the empty/sealed history barrier is a no-op at
`crates/engine/src/history.rs:364`.

The measured baseline is revision0 / selection_epoch1 / history_epoch0, saved0,
clean, no stored-mark override, undo0/redo0. Each changed case uses exactly one
isolated InsertText request, never DeleteSelection then InsertText. Apply is
r1/s2/h1, undo1/redo0; undo is r2/s3/h2, undo0/redo1; redo is r3/s4/h3,
undo1/redo0. Each transition has one document event and no extra state event.
Undo restores the exact original canonical document, historical IDs, directed
selection, and null override. Redo restores the same first-result live IDs and
caret. Dirty remains true even after undo restores the initial bytes: the saved
revision is still0. See `crates/engine/src/dispatch.rs:510`, `:557`, `:752`,
`crates/engine/src/history.rs:250`, and `crates/engine/src/history_dispatch.rs:95`.

P14's input paragraph has `{align:"right",first_line_indent:true}` and children
strong Text T=`abcd`, hard_break BR, code Text C=`tail`. An untouched heading3 H/O
follows it. The selected range is wholly inside T. `caret_marks` at
`crates/kwdj/src/commands/inline.rs:368` chooses the ordered start Text's strong
marks; it does not choose the reversed selection's focus or the code tail.
The inserted fragment is strong, so normalization joins it with the original
left strong T. Final T=`aяd`, caret T2/After. P/BR/C/H/O, both block attrs, the
hard_break, and code-marked tail retain their exact IDs and payloads. The override
stays null. This positive case does not claim support for replacing a selected
hard_break across different old mark spans.

P05 declares no SDK query/command/history dispatch as the cancellation operation;
there is consequently no fictional mutation reply to compare. The complete native
state, canonical data, identities, mapping at revision0, and events remain exactly
the checkpoint. Its empty undo/redo probes are separate checks after that checkpoint,
not cancellation calls or hidden entries. Legitimate mounted state-only effects
must be checked by separate state/event rows; this native literal cannot erase
their counters or mislabel them as document transactions.

## Text and structural identity

`crates/kwdj/src/commands/inline.rs:811` builds the one same-block
ReplaceInlineRange and chooses the inserted result end. Core validates the original
outer EGC boundaries, splits the end before the start, removes the selected middle,
then inserts the replacement (`crates/engine/src/tree.rs:1243`). For `abcd` the
temporary sequence is original T=`a`, inserted fragment, suffix=`d`.
`crates/kwdj/src/edit_normalize.rs:355` joins compatible neighboring Text into the
left survivor. Therefore original T survives P01/P02/P04/P14; no new live role
remains after normalization. Private split/insert tokens may be allocated, but
their numeric values and serial order are not portable goldens.

`insert_across_blocks` at `crates/kwdj/src/commands/inline.rs:920` requires equal
parent, type, and attributes. It preserves the right tail, replaces the left
suffix, moves that tail, then removes the fully selected middle siblings and
right shell (`:1055`). B and C have compatible plain paragraph endpoints. Final
ROOT/P1/L/H/O survive, old P2/R retire, and P10 additionally retires S. The right
tail normalizes into original L, so no new final live token is required. Undo
revives exactly old P2/R/S; redo retires those historical IDs again. The scene has
structural membership, not invented text offsets or U+FFFC content.

## Exact maps and deleted provenance

The listed maps are required semantic results, not optional observations.
Split attachment rules come from `crates/engine/src/mapping.rs:313`; joins from
`:354`, child insert/delete from `:427`, moves from `:471`, retirement from `:528`,
and chronological sticky deletion from `:628`. Refusal/cancel at unchanged revision
use exact identity mappings and do not enter the committed map log.

For same-block replacement, T1/Before remains T1/Before, while T1/After and selected
interior attachments become Deleted at Child(P,1) with their original affinity.
T3/After rides the surviving suffix; T3/Before rides the selected middle and is
Deleted. Inverse suffix maps recover the original UTF-16 offsets. P14 uses the
same selected Text mechanics; BR/C maps remain exact identities.

Additional 0→2 and 0→3 probes freeze the original selected attachment at T2/After
(or L2/After for cross-block cases) as Deleted at Child(P,1)/Child(P1,1), After.
These composite fallback positions are independently derived, not left OPEN and
later taken from candidate output. For the same-block inverse, undo first restores
suffix and inserted siblings (ChildInsert), removes the inserted fragment
(ChildDelete), restores the removed middle (ChildInsert), and rejoins both original
splits (ChildDelete). Index1/After traverses 2→3→2→3→2→1. Redo returns index1.
For cross-block undo, the restored suffix/inserted siblings similarly produce
index3, reverse MoveInlineGroup removes the tail to index2, and inverse left
replacement restores/rejoins the old suffix to index1. Operations on the other
parent do not change that final gap. The Deleted flag is sticky throughout, even
when an old ID becomes live again. No private transient token needs to be named
in any of these public fallback results.

## Atomic negative cases

P11 preserves the existing independently frozen L6 input (`contracts/selection/v1`)
but independently specifies the actual InsertText query/execute boundary. The
selection is scalar-readable; its end is inside a cross-mark EGC. Core's range
admission fails with TreeError::Position (`tree.rs:791`, `:1249`), converted to
`position.invalid` (`crates/engine/src/transaction.rs:144`). The diagnostic has
path `""`, category `sdk`, details `{}`, may_have_committed false. Query is
unavailable with nested diagnostic stamp null; execute is Refused with the exact
current full stamp. Canonical bytes/IDs/stamps/selection/marks/history/events remain
unchanged. This does not by itself prove mounted retention of browser input.

N01 has two otherwise valid headings with attrs level2 and level3. The explicit
comparison at `inline.rs:938` refuses `kwdj.command_lossy_transform`; it must not
discard either attr set. N02 has one paragraph within a blockquote and one at the
root. `inline.rs:933` refuses `kwdj.command_unsupported_context` before publishing
any partial plan. Both are profile diagnostics, path `/command`, details `{}`,
with the same stamp/null and may_have_committed policy as above. Exact profile
category conversion is in `crates/kwdj-sdk/src/convert.rs:96`. Supported storage
shapes are established by `crates/kwdj/src/validate.rs:222`, `:236`, `:281`.
These negative cases run in both directions; equal parent/type/attrs positive
cases remain P09/P10. Empty undo/redo refuse `history.empty` atomically, with no
new event or counter.

## Portable requirements and target-local observations

Canonical strings, topology, role binding, directed selection/affinity, marks,
declared counter deltas, event cardinality, diagnostic fields, undo/redo identities,
and every listed map are normative exact facets. Raw observations must also be
retained; normalizing opaque session/ID tokens is only permitted through explicit
bijections and full-stamp relationships.

History retained_bytes is a native ownership estimate, not serialized canonical
length (`crates/engine/src/history.rs:98`). Its actual u64 string is required at
each checkpoint. Query/refusal/cancel equality is exact within a target. Changed
apply/undo/redo values are bounded target-local observations, not fabricated zero
or byte-identical cross-target constants. The existing aggregate bound is32MiB;
unit bound16MiB (`history.rs:47`). Actual query/execute/replay work is likewise
retained with default ceilings1,000,000 units/64MiB (`crates/core/src/transaction.rs:219`).
Private transient allocator tokens, implementation step counts, and impact lists
are recorded if exposed but do not replace exact final public role semantics.
No observation class silently removes the native state/resource object from a
comparison. Resource0 is asserted only for actual exposed final disposal counters;
unavailable fields must be disclosed rather than invented.

There is no remaining native literal decision that needs candidate output to
become a golden. Actual native/WASM execution is still required after freeze.
Mounted protected-object correspondence, cadence, stale intent, exactly-once
submission, lossless recovery, and genuine installed OS input remain separate
acceptance obligations; success of these headless literals cannot prove them.
