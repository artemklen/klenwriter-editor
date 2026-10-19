# OSR-40 native range contract — proposal for Refine

Source-only implementation assistance, not a formal review, accepted contract,
Ready/start decision, or authorization to implement. Read at clean main
`ff2bd3103eba9b47cd2a06098d1506d9a054a589` on 2026-10-19, together with
`/tmp/osr-40-selection-contract-draft.md` and
`/tmp/osr-40-contract-preflight-notes.md`. No source/fixture/Linear writes,
tests, builds, native/browser input, CI, remote operations, or OS diagnostics.
Only this outside-repository proposal is authored. Root's design preference is
positive cross-parent endpoints, preserving partial endpoint containers and their
outside metadata. This preference is not yet a freeze.

## Findings that materially reduce the change

1. There is already a real native selected-range deletion: KWDJ
   `InsertText { text: "" }`. `DeleteBackward` delegates noncollapsed ranges to it.
   Do not replace this with JS slicing, repeated Remove commands, DOM deletion,
   or remounting a rewritten canonical document.
2. It handles **more than one block**: endpoint textblocks with the same parent,
   type and attributes are joined; every wholly covered intermediate sibling is
   removed, including an entire list/scene_break subtree. Conversely it does not
   handle endpoints in different list items, item→outside, structural-container
   gaps, or an isolated scene_break selected by its two edges.
3. Formatting already traverses selected text across lists, quotes, hard_break
   and scene_break. It applies marks to selected text only; it does not turn an
   atom into text or remove structure. Code blocks / protected reference-link
   cases retain native refusals. A broad new formatting engine is unnecessary.
4. There is no public selected-text/fragment projection query today.
   `query_command` yields availability/effect/presentation/diagnostic, not text,
   plans, preview IDs or maps. `state/node/map_position` expose enough guarded
   native data to build a **Rust** borrowed reader; no new mutable engine getter
   is necessary. `prepare_tree` is unsuitable for copy: it refuses ReadOnly and
   its draft can allocate IDs.

Sources: `crates/kwdj/src/commands/inline.rs:811–917,920–1106`;
`commands/delete.rs:138–165`; `commands/inline.rs:309–357,475–526,552–723`;
`crates/engine/src/commands.rs:244–269`; `crates/bridge/src/lib.rs:251–262,490–545`;
`crates/engine/src/session.rs:434–472,540–553`.

## Actual current reachability (the sixteen commands remain authoritative)

Coordinates remain UTF-16 code-unit offsets checked at scalar boundaries.
Textblock Child gaps and Edge(Text/HardBreak/InlineAtom/TextBlock) resolve to
inline points. Child(Container/root) and Edge(BlockAtom/Container) do not resolve
to inline endpoints. **Crossing** a block atom with text endpoints is therefore
different from **ending** on that atom. Empty-placeholder BR is Child(P,0), not
a HardBreak. Selection can represent valid structural points even when a
particular command refuses them.

| Current command(s) | Real native range behavior and boundary |
|---|---|
| `insert-text` | Same supported textblock: replace/delete across styled leaves and selected hard breaks; outer EGC admission is one core range operation. Types paragraph/heading/verse_line/code_block. Across blocks: only format-capable paragraph/heading/verse_line endpoints with the same parent, same type, exactly equal attributes. Deletes all intermediate siblings and joins the surviving right suffix into the left. Code cross-block refuses; mismatched endpoint metadata gives `kwdj.command_lossy_transform`; different parents gives `kwdj.command_unsupported_context`. |
| `delete-backward` | Semantically noncollapsed inline endpoints use `insert-text("")`, with those same limits. Collapsed behavior is the frozen39 previous-EGC / restricted adjacent-block join; it does not acquire arbitrary structural range deletion. An isolated selected scene_break still refuses during inline endpoint resolution. |
| `toggle-mark` | Native ordered Text/Child/Edge traversal collects selected text across container/list/atom boundaries, with paragraph/heading/verse_line context checks. Applies only the exact mark key and only selected text spans. Whole EGC across differently marked leaves is admitted; an interior editing boundary refuses. Selected atom alone has no text spans and is not a new atom-mark operation. |
| `set-link`, `unset-link` | Same range traversal; ordinary-link edits refuse a covered protected reference_link. They do not alter unselected marks/attributes. Code context refuses. |
| `enter`, `shift-enter` | Replace selected inline content and add a block/line boundary according to native block policy. Cross-block variants have their own same-parent/type guards. These are not copy/cut primitives and should not be used as a range delete workaround. |
| `transform-block` | Operates on selected textblocks, including partially selected blocks. It intentionally transforms whole blocks and may refuse a lossy target. It is not exact selected-substring formatting/deletion. |
| `toggle-quote`, `toggle-list` | Selected-block structural policies, with contiguous/same-parent/same-list guards. Preserve their existing scope; do not substitute them for a range cut. |
| `insert-block`, `accept-slash` | Block insertion / exact slash replacement policies; not general range deletion. |
| `move`, `duplicate` | Explicit structural node operands, independent of a selected substring. |
| `remove` | Removes a named structural subtree; can lift removal to a singleton list and insert a mandatory empty paragraph. Not equivalent to deleting a user range; an arbitrary command sequence would add several history/publication boundaries. |
| `dismiss-slash` | No document edit. |

Exact bindings: `crates/kwdj/src/commands/mod.rs:42–137,193–232` (16 IDs),
`commands/inline.rs:55–152,213–345,347–357,552–723,811–1106`;
`commands/delete.rs:138–165,324–381`;
`commands/block.rs:436–546,864–923,1097–1109,1311–1397,1445–1548,1692–1771,1774–1863`.

The core user-boundary authority is `crates/engine/src/tree.rs:791–834` and
`:1240–1362`: scalar-admitted internal splits are licensed only by the original
outer EGC-safe edit. `PatchMarkRange` follows the same original-range authority
at `:1040–1117`. BR/atom barriers participate in order without acquiring text
offsets. Never treat the private ordering counter's barrier increment as a
public character unit (`commands/inline.rs:278–288`).

## Two meaningful scope choices

**A — projection query plus reuse only.** Add a native selection-text read;
cut invokes the existing guarded `insert-text("")` only when the actual native
query accepts. This is the smallest seam and proves positive styled/BR ranges,
matching sibling blocks, and a whole list/atom between matching endpoint blocks.
It truthfully refuses item→item / item→outside endpoints. This cannot meet the
root's stated full40 cross-parent acceptance preference. It is an option only
if the final card explicitly scopes those endpoints elsewhere; do not disguise
it as full AC2 completion.

**B — projection query plus new native `delete_selection` (recommended).** Keep
every old16 behavior/vector intact; add exactly one namespaced command17. Reuse
existing inline / compatible same-parent paths, and add KWDJ-native planning for
the remaining basic cross-parent/structural range cases. Preserve partial
endpoint contexts instead of forcing a lossy join. No new generic subtree-
splice instruction, import/remount, JS range semantics, or clipboard token
resource is required. Existing core `ReplaceInlineRange`, `Remove`,
`MoveInlineGroup` and normal transaction/profile/history publication suffice for
this defined policy. A small shared native endpoint-admission helper is
appropriate if needed; do not duplicate EGC validation in KWDJ or TS.

This requires independent exact topology vectors before implementation; a
"general delete" name alone does not determine what happens to list scaffolding.

## Recommended explicit native read seam

Keep the current ABI2 session endpoint / context negotiation. Add one closed,
read-only profile-selected-text DTO, not an open arbitrary query registry:

```ts
type SelectionTextRequestV2 = {
  kind: 'selection_text';
  stamp: StampDto;
  max_bytes: number; // u32 UTF-8 TEXT bytes; 0 is meaningful for an empty projection
};
type SelectionTextReplyV2 = {
  kind: 'selection_text';
  stamp: StampDto;
  selection: SelectionDto; // original anchor/focus order and affinities
  projection_id: string;
  text: string;
  empty: boolean; // semantic empty range, NOT text.length === 0
  selected_atoms: string[]; // complete selected basic atoms, native document order
};
```

KWDJ reply ID: `org.klenwriter.kwdj/selection-text/1`; the compiled adapter
chooses it, not the request caller. Notes can opt into a separate
`org.example.notes/selection-text/1` under its own module policy; absence of that
implementation is `profile.selection_text_unsupported`, never a KWDJ fallback.
Projection selection is the **current native selection** at the exact supplied
stamp. No arbitrary stale point parameter, automatic map, hidden selection
submit, new handle or durable Range. Null selection refuses the proposed read
diagnostic `selection.required`; command17 keeps `kwdj.command_selection_required`.
A collapsed semantic range returns `{text:'',empty:true,
selected_atoms:[]}`. A selected scene_break returns empty text with
`empty:false,selected_atoms:[S]`. ReadOnly copy succeeds.

Compatibility choice: **new read is ABI2-only**. Leave the legacy
`kwdj-sdk/wire.rs::SdkRequest` and existing shared `SdkReply`/`SdkResponse`
variants unchanged for this read. Add thin native/generated unions
`BridgeRequestV2 = BridgeRequest | SelectionTextRequestV2`,
`SdkReplyV2 = SdkReply | SelectionTextReplyV2`, and `SdkResponseV2` with the same
three outer statuses (Ok uses SdkReplyV2; Refused/Fatal use the existing
DiagnosticDto). Untagged outer wrappers preserve the exact existing JSON
envelopes; inner read structs remain closed/tagged. Add Bridge::call_v2 (and
v2 endpoint decoding) with existing requests delegated to the existing call.
ABI1 call never accepts the new read. Add explicit ABI2 controller/mounted
ReadRequestV2/ResponseV2 admission and one closed reply decoder case, leaving
SDK1 declaration/transport shapes for this read unchanged. This is a small
additive v2 wrapper, not ABI3, an arbitrary query registry or free-form JS
response passthrough. Exact build negotiation still fences generated clients.
Appending command17 to the KWDJ profile intent/catalog is a separate deliberate
additive profile change; keep the original16 intent shapes/semantics unchanged
and ensure every catalog-advertised command is decodable in its advertised
lane. Do not claim byte-identical KwdjIntentDto after appending its new variant.

Implementation placement: native KWDJ range-order/projection policy in
`editor_kwdj`; a **borrowed, metered** reader in bridge/profile adapter wraps
public Session root/node/selection/validate_position access and implements
CandidateRead. Recommend one new optional BridgeAdapter::selection_text
callback, receiving immutable Session<P>, max_bytes and WorkMeter, returning
typed projection data or a diagnostic; default returns
`profile.selection_text_unsupported`. Bridge::call_v2 checks exact stamp before
calling it, assembles unchanged stamp/directed selection in the reply and checks
the bounded serialized result. KwdjAdapter calls its native KWDJ projector;
NotesAdapter can opt in separately. No profile-ID branch in generic bridge/core,
no mutable Session or prepare_tree, and no public engine access addition.
Existing adapter trait currently has only command decode + profile_error
(`bridge/src/lib.rs:117–125`), so the callback is a deliberate addition, not an
already available seam. Existing V2 profile endpoint wrappers
(`crates/kwdj-sdk/src/factory.rs:144–163`) supply explicit v2 decode/dispatch
without exposing the new read through legacy BridgeSession.

Guard all five stamp fields using the existing stamp checker. The controller
also captures mount/context identity and an independent intent serial; stamp
equality alone cannot prove no later equal-endpoint user intent occurred.
Context is the existing ABI2 build/profile/registry/capability tuple; bind the
request/result to that session context rather than inventing a projection
session. Include projection version and effective query ceilings in the ABI2
effective capability bytes if they are configurable, hence capability_digest;
normal build_id changes also fence old compiled readers. A different registry
digest is not implicit support for a third-party node.

Proposed hard query ceilings: max_bytes is0..1MiB, larger values refuse;
requested smaller cap honored; ≤200,000 visited nodes; ≤128 depth;
≤4,096 selected atoms; existing
native preparation WorkLimits ≤1,000,000 units /64MiB. Charge before traversal
stack/output/ID allocation, checked arithmetic, no partial result or truncation.
Refusals: `selection_text.output_limit`, `.node_limit`, `.atom_limit`,
`.unsupported_context` (new proposed names); existing stamp/position diagnostics
remain original. Output cap means text bytes, not grapheme count or JSON bytes.
Give the new projection reply a separate8MiB UTF-8 JSON bound, checked before
serialization allocation (or by a conservative escaped-size preflight), including
IDs/stamp; do not use the shared decoder's much larger128MiB string/256MiB
owned-response ceilings as a native projection budget (`packages/sdk/src/response.ts`,
`decodeResponse`). Query is
facet-pure: no ID reservation, history barrier, revision/selection/marks/events,
dirty flag, baseline, snapshot handle or map-journal mutation.

### Plain-text projection to freeze

For this basic subset, marks and attributes add no characters; text is literal
without normalization; HardBreak contributes one LF. Block child sequences join
selected block fragments with LF, recursively; container nesting itself adds no
extra LF. scene_break contributes an empty block fragment: `P('a'),S,P('b')`
projects `a\n\nb`, while S alone projects `''` with selected_atoms `[S]`.
Lists have no fabricated bullets, checkbox labels or ordered numerals. A partially
selected endpoint textblock contributes only its selected UTF-16 slice; no LF is
added for an unselected neighbor outside the range. Empty selected block
fragments retain their separators. Reverse ranges produce the same text and
membership, preserving the original direction in the returned selection.

This follows existing full-document basic projection conventions
(`crates/kwdj/src/project.rs:201–232,270–283`), but is a **new native range**
projection: calling full-document projection and slicing it by a flattened
offset is invalid. Domain nodes (spoiler/media/table/reference/custom extension)
are explicitly outside this basic projector until their own policy is admitted.
Do not expose concealed content by reusing the full-document spoiler mode.

Separator literals: with adjacent paragraphs L='ab',R='cd', L:1→R:1 is
`b\nc`; L:2→R:0 is exactly LF; L:0→L:2 is `ab` without a trailing LF.
Two wholly selected empty paragraph rows project one LF; one wholly selected
empty paragraph projects `''` but empty=false. Selecting the empty paragraph's
coincident inside gap alone is empty=true. Consecutive selected scene_break rows
project separators between their empty fragments, not U+FFFC. An atom row at a
range edge does not fabricate a leading/trailing separator outside that range.

Scalar-valid interior-EGC endpoints are copy-readable: `e\u0301` offset0→1
copies `e`; a cross-mark seam can copy an accent alone. Cut/delete/format must
still pass pinned native EGC admission. A half-surrogate never yields a copy
substring; refuse without replacement/clamping. A copy response is not a cut
capability or proof that a destructive edit is available.

## Recommended command17 semantics to freeze

Native `KwdjIntent::DeleteSelection`; ID
`org.klenwriter.kwdj/command/delete-selection`; closed payload
`{"kind":"delete_selection"}`. Use current native selection and the existing
`query_command`/`command` envelope and stamp. No supplied range/token/history
setter. Mounted coverage gate explicitly admits the new empty payload only
after catalog/generation agrees. Isolated history for a cut or explicit range
delete; never label a clipboard async completion as a typing burst.

1. Null selection refuses original selection-required diagnostic. A semantically
   collapsed range is a true Unchanged, not Backspace. Validate positions before
   deciding empty; do not use projected text emptiness.
2. Same inline-parent cases reuse the existing whole-range operation and caret
   policy; the command supports the basic accepted textblocks and BR barriers.
   Same-parent matching textblock endpoints reuse the existing `insert_text("")`
   join policy, with exactly the existing ID/map/normalization result.
3. For different parents **or heterogeneous endpoint block metadata**, preserve
   both partial endpoint textblock identities and ancestor paths. Delete their
   selected suffix/prefix via core whole-range operations. Remove only maximal
   wholly covered middle subtrees, in native order. Do not hoist/move a surviving
   suffix across list/task/heading boundaries, merge unequal block attributes,
   renumber an outside ordered_list, or reset outside task_item.checked.
   Remaining container boundaries are intentional scaffolding; cut is defined
   as deleting selected authored text and wholly selected nodes, preserving
   partial contexts, not as flattening all copied LF separators into one block.
   Explicit boundary-only control: end(P1)→start(P2) with different ancestor
   paths or unequal block metadata projects LF, but contains no selected authored
   text/whole subtree to erase. If a lossless same-parent join does not apply,
   refuse `kwdj.command_unsupported_context` without even collapsing selection;
   do not report that copied LF was cut while both context boundaries remain.
4. A TextBlock Edge before/after follows existing inline-edge convention; it
   selects contents, preserving that block shell. A root/container Child gap or
   structural Container/BlockAtom Edge selects whole intervening children.
   Thus Edge(S,before)→Edge(S,after) removes S once. Fully selected container
   subtrees can be removed, whereas partially selected endpoint ancestors remain.
5. For a surviving inside-textblock start, collapse at the deletion start with
   After affinity (existing same-parent helper retains its existing policy).
   For a structural gap start collapse at that surviving ancestor gap After.
   If all children of a retained mandatory basic owner are wholly selected,
   repair after removals in the same native plan: root/blockquote/list_item/
   task_item gets one new empty paragraph; bullet_list/ordered_list gets one
   new list_item containing a new empty paragraph; task_list gets one new
   task_item(checked=false) containing a new empty paragraph. Collapse into that
   new paragraph at Child(P,0,After). Preserve the retained owner's attributes
   (including ordered start). A wholly selected container selected from its
   parent's outside gaps is removed instead of being unnecessarily repaired.
   This is an explicit new17 policy; do not emit invalid list→paragraph children
   or silently promote a parent. An owner outside this basic grammar refuses.
6. KWDJ profile admits only the basic renderable contexts targeted by40. Check
   actually selected/wrapping context before reusing a legacy helper; unsupported
   content elsewhere does not itself grant or remove authority. Code
   cross-context / domain / reference / unknown node or marks policy gets a typed
   refusal; code same-block may retain existing supported empty InsertText
   behavior if frozen explicitly. No new command broadens old16 context checks.
7. StoredMarks Keep plus current native finalization, as39: do not silently
   canonicalize incompatible marks into a successful destructive edit. Query
   must exercise full finalization/normalization/selection/history limits;
   available query is not a reserved commit and stale execute still refuses.
8. One transaction/publication/history entry for Changed. Query/refusal/no-op
   changes no facets. Maps compose all user operations and normalization in
   original order; deletion provenance remains Deleted even with a usable
   fallback. Undo restores original identities/selection/metadata, redo reuses
   the historical created identities, revisions remain monotonic.

The old16 exact semantic vectors stay byte-identical; update only current
catalog assertions to base17 /18 with one recipe, add independent command17
vectors and source/compiled-WASM comparisons. No automatic runtime registry
insertion from renderer support, nor recipe reinterpretation as native17.

## Independent literal oracle seeds (author before candidate)

Role IDs below name native opaque tokens discovered from the literal input
tree's named roles, not fixed numeric tokens or candidate output. All positions
use UTF-16 and After unless stated. Start with no stored marks, no open typing
group, empty history, revision0; native selection is already installed. Each
Changed command is isolated: revision1, undo entries1/redo0, one Document event.
Undo→revision2 restores exact original tree/IDs and directed selection;
redo→revision3 restores the exact edited tree and same historical created IDs.
Check selection/history epochs relative to the actual installed initial stamp;
do not count the fixture's earlier set_selection as part of deletion.

**L1 — old inline behavior retained, partial endpoints with distinct marks.**
P `[L='ab'{strong}, R='cd'{emphasis}]`; select Text(L,1)→Text(R,1), then reverse
as a separate input. Text projection `bc`. Delete result P
`[L='a'{strong}, N='d'{emphasis}]`, where N is the newly split surviving suffix;
R is retired, L/P survive. No other IDs survive as live hidden empty leaves.
Caret Child(P,1,After). Maps: old Text(L,0)→L:0 Mapped; old Text(R,2)→N:1 Mapped;
old Text(R,0,After)→Child(P,1,After) Deleted. Original P attributes unchanged.
Undo revives R and retires N; redo restores exactly N. No new17-specific path
may alter this existing old command's identity contract.

**L2 — existing cross-block positive includes both a list and atom.**
Root `[A[L='ab'{strong}], S(scene_break), O(start=7)[I[P[M='uv']]],
 B[R='cd'{emphasis}], C[Z='!']]`, A/B plain paragraphs with equal attributes.
Select L:1→R:1. Native copy `b\n\nuv\nc`, selected_atoms `[S]`.
Existing `insert-text('')` (and new17 reuse) yields root
`[A[L='a'{strong}, N='d'{emphasis}], C[Z='!']]`.
Retire S/O/I/P/M/B/R; A/L/C/Z remain, N new right suffix. Map R:2→N:1 Mapped;
Z:1→Z:1 Mapped; old Edge(S,before)→Child(root,1,Before) Deleted after ordered maps.
Caret Child(A,1,After). No outside C/Z change. This is real coverage, but does
not stand in for L3/L4.

**L3 — new positive item→item, preserve both endpoint paths.**
Root `[O(start=7)[I1[P1[L='ab'{strong}]], I2[P2[R='cd'{emphasis}]]],
 C[Z='!']]`; select L:1→R:1, repeat reversed. Native copy `b\nc`.
Old `insert-text('')` refuses unsupported_context; new17 yields the same root
topology with P1 `[L='a'{strong}]` and P2 `[N='d'{emphasis}]`. Preserve
O/start7, I1/I2/P1/P2, C/Z and outside marks byte-for-byte. N new, R retired;
do not join P2 into P1 or merge/remove the list items. Caret Text(L,1,After)
(this is the proposed new cross-parent policy, not the legacy Child caret).
Maps L:0→L:0 Mapped, R:2→N:1 Mapped, R:0→Child(P2,0,After) Deleted.
Undo original L/R and selected direction; redo same N. No full selected middle
subtree exists in this small vector.

**L4 — new positive item→outside through a middle forest.**
Root `[T(task_list)[TI(checked=true)[P1[L='ab'{strong}],
 Q(quote)[QM[U='uv']]], TI2(checked=false)[P2[V='wx']]],
 S(scene_break), H(heading level=3)[R='cd'{emphasis}], C[Z='!']]`.
Select L:1→R:1. Result root
`[T[TI(checked=true)[P1[L='a'{strong}]]], H(level=3)[N='d'{emphasis}], C[Z='!']]`.
Remove maximal selected Q, TI2, S; retain T/TI/P1/L and H with its level3,
outside C/Z, no hoist/join/task reset. R retired, N new; Q/QM/U/TI2/P2/V/S
retired. Caret L:1 After. Maps R:2→N:1 Mapped, Z:1→Z:1 Mapped,
U:0→Child(TI,1,After) Deleted, V:0→Child(T,1,After) Deleted;
S-before→Child(root,1,Before) Deleted. Native copy is `b\nuv\nwx\n\nc`.
These exact fallback gaps follow the chosen maximal-subtree removals, not
permission to restore a bookmark through them. Freeze removal order and raw
maps before treating the fallback positions as contractual ABI evidence.

**L5 — BR and structural Edge are different.**
P `[L='a'{strong}, H(hard_break), R='b'{emphasis}]`, selection
Edge(H,before)→Edge(H,after): copy LF, no selected block atoms; delete removes
H only; L/R/P survive, caret Child(P,1,After), map R:1→R:1 Mapped.
Separately root `[A['a'], S, B['b']]`, Edge(S,before)→Edge(S,after): copy `''`
with empty=false/selected_atoms `[S]`; new17 removes S only, caret
Child(root,1,After), old S-before→Child(root,1,Before) Deleted. Edge-before's
mapped affinity is Before (`core/src/positions.rs:78–87`), independently of the
new command caret's After policy. Old insert-text and
DeleteBackward refuse this endpoint shape. Empty projection is not a no-op.

**L6 — readable scalar versus editable EGC, across marks.**
P `[E='e'{strong}, C='\u0301'{emphasis}, X='x'{code}]`.
Text(E,0)→Text(E,1): copy `e` succeeds; delete/format refuses `position.invalid`
because the end is inside a cross-leaf EGC. Text(C,0)→Text(C,1) copies the
literal accent, but destructive start refuses. Text(E,0)→Text(C,1) is a whole
cluster: copy `e\u0301`; delete retires E/C, preserves X, caret Child(P,0,After).
Do not insert or normalize a composed `é`. Map X:1→X:1 Mapped.

**L7 — refusal and purity controls.**
Half-surrogate offset1 in `👩🏽‍💻`: read projection and mutation refuse with
original typed position diagnostic, no U+FFFD/no clamp. ReadOnly: projection
succeeds, changed delete unavailable/refused `session.read_only`.
No selection: typed required refusal. Old stamp after any revision or
selection/history epoch change: exact original stale diagnostic, no deletion.
code-block→list, domain/reference/custom context, inadequate output/work/atom
budget: typed refusal with no partial text, publication/history/resources/ID
change. Busy/composing/mounted recovery failure is a DOM ownership refusal and
must not be forged into a native command refusal.

**L8 — literal mandatory-owner repair.** Root `[O(start=7)[I[P[T='ab']]]]`,
select Child(O,0,After)→Child(O,1,After). Keep O/start7, retire I/P/T, create
new I2 containing new empty P2; caret Child(P2,0,After). No direct paragraph child
under O, no change to start7. The repair insertion follows the removals. Map
old Text(T,1,After)→Child(O,1,After) Deleted (retired gap0 then insertion of I2
at0 with After affinity); old Child(O,0,Before)→Child(O,0,Before) Mapped.
Undo revives exactly I/P/T, removes I2/P2; redo restores exactly I2/P2. Separately
select all root children by root Child gaps: exactly one new empty paragraph
under the same root; task_list all-item selection yields exactly one new
task_item checked=false plus empty paragraph under the same task_list. Freeze
the authored empty-result repair diagrams rather than copying the old named-
subtree Remove command's singleton-list lifting rule.

All scalar-valid interior-EGC copy cases require the projection reader's own
literal expected substring; never call the edit candidate or Intl.Segmenter to
produce the oracle. New cross-parent fallback gaps in L4 are **proposals to
freeze**, not a claim today's mapper emitted them. If core normalized map
conventions require a different independently computed gap, resolve that in
contract review before candidate implementation.

## Clipboard completion and stale async outcomes — the40 boundary

The external clipboard and native model cannot commit atomically. Capture
`{mountIdentity,context,stamp,intentSerial,selection}`; native projection is pure.
Use an explicit, bounded, owned host ClipboardWriter interface returning a
Promise of `written` or a typed failure. A resolved platform
`navigator.clipboard.writeText(text)` is a completed browser write operation,
not independently observed OS paste provenance. Actual system round-trip is a
separate installed-browser evidence lane if frozen as mandatory. No page API
promise can prove another application's future paste.

| Outcome | Required honest effect |
|---|---|
| Projection/refusal/unsupported/composing/foreign ownership | No clipboard write, no delete; preserve original refusal. |
| Writer rejects/cancelled before confirmed completion | No delete. If delivery is unknown, record external outcome unknown; do not retry/replay automatically. |
| Copy writer resolves | Report copied text/write completion only; no content/history mutation. |
| Cut writer resolves, captured target and intent still current | Submit exactly one new17 isolated command with captured stamp. Preserve completed/queued SDK Submission and await the actual native response. |
| Write resolves after new selection/user intent/revision/context/generation/replace/destroy | `clipboardWritten:true`, cut not applied; stale/ownership refusal. Do not map the old destructive target into a new selection or silently delete the latest selection. |
| Native command refuses after successful write (including queued stale completion) | External clipboard contains the old projected payload; document unchanged by this cut. Report `copied_but_not_cut` plus the original native diagnostic. |
| Native fatal/transport failure with may_have_committed | Report indeterminate model outcome and existing fatal lifecycle. Do not claim unchanged/cut success or retry. |

Recheck the intent serial even when native endpoints/stamp happen to match;
equal-endpoint reselection is real new intent. Do not publish a hidden
`set_selection(captured)` merely to make the destructive command match. Capture
and release pending work in one bounded per-mount owner (proposed max1 pending
cut, no replay); cancel on mode/lifecycle/composition ownership loss. Cannot
cancel a command already queued: retain its actual completion and stamp fences.

`ClipboardEvent.clipboardData.setData` only populates an event payload. An event
handler cannot observe a transactional OS-write acknowledgement; therefore it
cannot truthfully treat setData/no exception as the async writer's `written`
receipt. Two explicit adapters are possible: (recommended) use the confirmed
async writer for destructive cut, with unsupported/permission failure refusing
deletion; or explicitly freeze a browser-default delegated-cut contract with
its weaker acknowledgement and separate evidence. Do not silently use the
second path when the first fails. Keep actual trusted clipboard events, payload
checks, controlled DataTransfer tests and installed system round-trip labelled
as distinct evidence. Full HTML serialization/import/sanitization/paste, media,
multi-format negotiation and clipboard47 remain outside40.

## Notes and capability compatibility

Notes is not KWDJ with another digest. Its present catalog is three commands;
its InsertText only accepts same-parent inline points (`crates/notes/src/commands.rs:
258–264,306–367`). Notes title/tags have no selected-range meaning. D0 scalar
copy can opt in using its own native projector/read ID; D1 callout/token kinds
remain explicitly unsupported by the mounted renderer until separately added.
Do not add KWDJ command17 to Notes or synthesize capability from a matching
primitive. A profile lacking projection/delete support remains selectable/readable
through existing APIs and returns typed unsupported at the new seam; this is an
actual profile capability boundary, not permission to omit KWDJ positive cases.
Native-only downstream consumers retain ordinary engine/core/registry closure;
no browser, clipboard, CMS or JS semantic library enters native policy.

Before implementation, root should freeze: the proposed ABI2-only additive wrappers;
the plain-text grammar and empty atom rule; new17 cross-parent topology/caret and
mandatory-owner repair cases; code/reference/domain refusal scope; exact budgets;
clipboard acknowledgement/partial-outcome contract; and these independent literal
IDs/maps/history expectations. Source inspection supports the seams above; it is
not execution evidence or authorization to mark OSR-40 Ready.
