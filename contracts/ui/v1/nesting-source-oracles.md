# OSR-42 — nesting and Text-caret Add native vectors, source-authored01

PRE-CANDIDATE DATA ONLY. Accepted source commit `857f8cb7b27bb2b0ed36d99780fb19911dcff1cf`, tree `c701ffcdec8661865a0f7e0ef699e5b470ffd6e0`. No editor/native/WASM/module/candidate execution, tests, browser/OS input, API or repository writes. The only programs used for this note read source/Git blobs, hash bytes and serialize independently authored JSON literals with Python stdlib. This document is a proposed oracle, not a freeze or review verdict. Input preparation drafts named below remain historical, not execution proof.

## Binding and exact public transport

There is no native `nest` or `unnest` intent. These UI labels use the existing KWDJ Move variant, not a new command or JavaScript tree transform. `KwdjIntentDto::Move` is exactly `{kind:'move',node:string,parent:string,before_index:u32}` (`crates/kwdj-sdk/src/wire.rs:157`, convert.rs:62); `kwdjCommand(intent)` returns `{id:'org.klenwriter.kwdj/command/move',payload_json:JSON.stringify(intent)}` (`packages/kwdj/src/index.ts:9–27`). Replace role strings with actual admitted IDs before constructing the payload; role names here are not native tokens. `before_index` is a JSON number, measured in destination children BEFORE source removal, never a decimal string.

Public read: `{kind:'query_command',stamp:S,command:C}`. Public mutation: `{kind:'command',stamp:S,command:C,history_hint:{kind:'isolated'}}`. SDK2 wrapper/context stays actual; do not pass raw `{kind:'move',…}` to mounted.submit. A preview is not authority and consumes no identities; execute rechecks the whole captured stamp and prepares again (`engine/commands.rs:245–286`). Every new action/undo/redo uses its current stamp, never the original stamp after publication.

All cases use `profile:'prose'`, admission validate, editable access, identities media/references empty, no existing history/open typing group. Install exactly one authored selection by public set_selection, then drain setup events. Full session/generation/context are actual opaque values. A fresh Session starts revision0/selection:null/selection_epoch0; after one different nonnull selection setup the action baseline is revision `'0'`, selection_epoch `'1'`, history_epoch `'0'`, saved_revision `'0'`, dirty:false, stored_marks:null, undo_entries `'0'`, redo_entries `'0'`. If an outer harness has additional explicit setup, use the EXACT deltas below against that baseline, disclose it, and do not rewrite this fresh-session scenario.

`T@i` expands to `{kind:'text',node:T,offset:i,affinity:'after'}`; `caret(T@i)` repeats that point for anchor/focus. Opaque identity comparison must be bijective and field-aware, not numeric token ranks. `R` is the synthetic root, not an authored KWDJ node. All canonical strings below are literal sorted-key compact UTF8, independently authored before candidate execution. Profile-owned cache/work/retained_bytes values are measured bounded target-local data, never invented shared native/WASM constants.

For every successful Move here, query value is exactly availability `available:true,effect:'changed',presentation:{active:'none'},diagnostic:null`. Mutation is Ok value `{kind:'mutation',effect:'changed',state:ACTUAL,presentation:{active:'none'}}`. One command, one document publication, one chronological map, one isolated undo unit. No state-only extra publication. Native preparation is not a second dispatch.

For every refusal, query itself is Ok availability `available:false,effect:null,presentation:null,diagnostic:D`; executing the same current-stamp command is Refused diagnostic D (not fatal). D includes `stamp:null,may_have_committed:false`. Query/refusal publish zero events and leave canonical, all identity roles, current selection/stored marks, ALL five stamp fields, dirty/saved revision, undo/redo and existing redo branch unchanged. No prepared maps become observable. Complete original responses must be retained; a UI disabled state is not proof a native refusal was exercised.

## N01 — Nest a whole paragraph into an existing blockquote

Literal input:
```json
{"content":[{"content":[{"content":[{"text":"a","type":"text"}],"type":"paragraph"}],"type":"blockquote"},{"attrs":{"align":"right","first_line_indent":true},"content":[{"marks":[{"type":"strong"}],"text":"b","type":"text"}],"type":"paragraph"},{"attrs":{"level":3},"content":[{"text":"tail","type":"text"}],"type":"heading"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}
```
Roles before: R children[Q,B,H]; Q children[A]; A text AT=`a`; B text BT=`b` with Strong; H text HT=`tail`, level3. Paths Q[0], A[0,0], AT[0,0,0], B[1], BT[1,0], H[2], HT[2,0]. Selection caret(BT@1); independently also allow forward BT@0→BT@1 and reverse BT@1→BT@0, preserving that exact direction rather than collapsing it.

Intent: `{kind:'move',node:B,parent:Q,before_index:1}`.

Exact expected canonical:
```json
{"content":[{"content":[{"content":[{"text":"a","type":"text"}],"type":"paragraph"},{"attrs":{"align":"right","first_line_indent":true},"content":[{"marks":[{"type":"strong"}],"text":"b","type":"text"}],"type":"paragraph"}],"type":"blockquote"},{"attrs":{"level":3},"content":[{"text":"tail","type":"text"}],"type":"heading"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}
```
All R/Q/A/AT/B/BT/H/HT survive, created[], retired[]. B parent changes R→Q; exact B paragraph attrs and Strong mark survive; all text and H subtree are untouched. Selection stays identical by role/offset/affinity/direction and stored_marks remains null. New topology R[Q,H], Q[A,B].

Exact forward StepMap (source-level structural assertion, not an invented public DTO): `ChildMove{from_parent:R,from_index:1,to_parent:Q,to_index:1,count:1,from_len:3,to_len:1}`. Inverse: `ChildMove{from_parent:Q,from_index:1,to_parent:R,to_index:1,count:1,from_len:2,to_len:2}`. Map BT@1 and all other Text/Edge identity points unchanged, deleted:false; destination/source parent gaps follow remove+insert affinity rules, not “follow the block”. Do not manufacture a cross-parent positional relocation for a surviving Text ID (`engine/mapping.rs:472–526`).

Post-command revision1/selection_epoch1/history_epoch1, saved_revision0, dirty:true, undo1/redo0. Undo restores literal INPUT, original topology/IDs/selection; revision2/selection_epoch1/history_epoch2, undo0/redo1, dirty:true. Redo restores literal EXPECTED, same IDs, revision3/selection_epoch1/history_epoch3, undo1/redo0. Saved revision remains0; undo does not implicitly acknowledge a saved snapshot.

Derivation: block.rs:1692–1706 and1826–1840 (structural precheck and ONE Move); tree.rs:2420–2495 (same IDs/parent writes/one ChildMove); tree.rs:307–345 (inverse); validate.rs:281–291 and765–800 (blockquote accepts nonempty prose blocks).

## N02 — Unnest from a still-nonempty blockquote

Fresh input is exactly N01 EXPECTED. Roles by topology R[Q,H], Q[A,B]; all attrs/text unchanged. Selection caret(BT@1), or the same independently directed range variants as N01.

Intent: `{kind:'move',node:B,parent:R,before_index:1}`.

Exact expected canonical is exactly N01 INPUT (not a newly serialized candidate snapshot). All eight IDs survive, created[], retired[]; Q remains with A. Forward map is N01 inverse, inverse map is N01 forward. Counters/query/mutation/undo/redo as N01; Text selection is unchanged and undo/redo restores exact IDs. This is an inverse semantic scenario in a fresh session, not an assertion that invoking Unnest after Nest reuses an old stamp or merges both operations into one undo unit.

## N03 — Unnest sole child refuses; no hidden wrapper repair

Literal input:
```json
{"content":[{"content":[{"attrs":{"align":"right","first_line_indent":true},"content":[{"marks":[{"type":"strong"}],"text":"b","type":"text"}],"type":"paragraph"}],"type":"blockquote"},{"attrs":{"level":3},"content":[{"text":"tail","type":"text"}],"type":"heading"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}
```
Roles R[Q,H], Q[B], B[BT], H[HT]; selection caret(BT@1). Intent `{kind:'move',node:B,parent:R,before_index:1}`.

Expected canonical remains the exact INPUT above. Query unavailable, execution Refused:
```json
{"code":"kwdj.invalid_structure","path":"/content/0/content","category":"profile","details":{},"stamp":null,"may_have_committed":false}
```

All baseline counters stay 0/1/0 as defined, dirty:false, undo0/redo0 and zero events. B is not moved publicly; Q is not removed or replaced. Primitive Move can stage Q with zero children, but KWDJ requires blockquote nonempty and normalization does not synthesize an empty paragraph or delete a blockquote. The special mandatory-child repair in block.rs:1717–1770 belongs to Remove, not Move. Shared inline normalizer child fixes at edit_normalize.rs:350–357 cover paragraph/heading/code/verse text sequences and verse, not empty quote repair; `require_nonempty` produces this exact /content suffix (validate.rs:1174). This is a useful UI disabled-availability oracle; do not silently implement a multi-command “move then remove wrapper”.

## N04 — real cycle, with a legal Container destination primitive

Literal input:
```json
{"content":[{"content":[{"content":[{"text":"a","type":"text"}],"type":"paragraph"},{"content":[{"content":[{"text":"b","type":"text"}],"type":"paragraph"}],"type":"blockquote"}],"type":"blockquote"},{"attrs":{"level":3},"content":[{"text":"tail","type":"text"}],"type":"heading"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}
```
Roles R[Q1,H], Q1[A,Q2], A[AT], Q2[B], B[BT]; selection caret(BT@1).

Intent `{kind:'move',node:Q1,parent:Q2,before_index:1}`.

Exact expected canonical stays INPUT. Query unavailable, execution Refused:
```json
{"code":"tree.cycle","path":"","category":"sdk","details":{},"stamp":null,"may_have_committed":false}
```

Q2 has one child, so index1 is valid; both Q1 and Q2 are Container; source/destination differ, so no same-parent no-op escape. The actual ancestor walk reaches Q1 from Q2 and refuses before modification (tree.rs:2428–2455). The primitive check occurs BEFORE the cycle walk: moving Q1 into paragraph B would instead return `tree.invalid_structure`, and cannot serve as this cycle oracle. All baseline facets/IDs/history/maps/events remain unchanged. Generic tree MAX_DEPTH128 is not this profile's KWDJ depth ceiling32.

## N05/N06 — independently meaningful reduced profile depth boundary

Literal input shared by two fresh sessions:
```json
{"content":[{"content":[{"content":[{"text":"a","type":"text"}],"type":"paragraph"}],"type":"blockquote"},{"content":[{"content":[{"text":"b","type":"text"}],"type":"paragraph"}],"type":"blockquote"},{"attrs":{"level":3},"content":[{"text":"tail","type":"text"}],"type":"heading"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}
```
Roles R[Q1,Q2,H], Q1[A], A[AT], Q2[B], B[BT], H[HT]; selection caret(AT@1). Input authored depth3: root children depth1, paragraph depth2, Text depth3; synthetic R is not counted as depth1.

Closed ABI2 `profile_options_json` parses this object (do not place profile limits under generic transport work limits):
```json
{"identities":{"media":[],"references":[]},"limits":{"document_bytes":null,"tree_depth":"3","node_count":null,"text_leaf_bytes":null,"table_rows":null,"table_effective_columns":null,"authored_attribute_bytes":null}}
```
For N05 change only tree_depth to string `"4"` BEFORE session admission; N06 keeps string `"3"`. All seven optional limit fields are required nullable members when limits is nonnull (`kwdj-sdk/wire.rs:49–69`, factory.rs:26–61). Other budgets/defaults remain sufficient, with no forced operational failure.

Same intent: `{kind:'move',node:Q1,parent:Q2,before_index:1}`.

N05 exact expected canonical (limit4, available/changed):
```json
{"content":[{"content":[{"content":[{"text":"b","type":"text"}],"type":"paragraph"},{"content":[{"content":[{"text":"a","type":"text"}],"type":"paragraph"}],"type":"blockquote"}],"type":"blockquote"},{"attrs":{"level":3},"content":[{"text":"tail","type":"text"}],"type":"heading"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}
```
All IDs survive. New R[Q2,H], Q2[B,Q1], Q1[A], AT now depth4; AT@1 selection/stored marks unchanged. Forward map `ChildMove{from_parent:R,from_index:0,to_parent:Q2,to_index:1,count:1,from_len:3,to_len:1}`; inverse `ChildMove{from_parent:Q2,from_index:1,to_parent:R,to_index:0,count:1,from_len:2,to_len:2}`. Same successful counters/undo/redo as N01.

N06 exact expected canonical remains INPUT; availability unavailable/execution Refused:
```json
{"code":"kwdj.resource_limit_exceeded","path":"","category":"profile","details":{"limit":"tree_depth","maximum":"3","observed":"4"},"stamp":null,"may_have_committed":false}
```
No document/selection/history publication, all original IDs/counters/marks/history/redo unchanged. `observed` is FULL candidate height4, not the first local traversal depth or generic core depth128. Candidate cache detects aggregate height above domain ceiling, then authoritative fallback gathers complete depth with root path `""` (candidate_cache.rs:975–984; candidate_validate.rs:578–595). Diagnostic projection retains code/path plus decimal-string details (`kwdj-sdk/convert.rs:96–124`); no invented operational `resource_limit_exceeded` code here.

Default-ceiling extension SPECIFICATION, not a substitute already-executed vector: limits null means KWDJ tree_depth32 (lib.rs:39–65). A finite default-boundary family can use root[R→Q01→…→Q30→P(a), S(P(b)), H(tail)], max depth32. Moving whole S into Q29 at index1 yields max32 (accept); moving S into Q30 at index1 yields max33 (Refused same diagnostic with maximum32/observed33). Q29/Q30 each already has one child; source R remains nonempty and quotes remain nonempty, so no cycle/index/empty-parent ambiguity. This source-authored structural specification must receive its own literal JSON and role paths before being frozen/executed; N05/N06 are the fully literal reduced-limit cases in this note, not a promise that a tiny document exercises default32.

## N07 — Text-caret Add Paragraph is a split plus two new blocks

Independent literal input (separate from root-gap Add V03):
```json
{"content":[{"content":[{"text":"ab","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}
```
Roles R[P], P[T=`ab`]; selection caret(T@1), affinity After. Intent `{kind:'insert_block',target:{kind:'paragraph'}}`; command ID `org.klenwriter.kwdj/command/insert-block`, payload includes that kind.

Exact expected canonical:
```json
{"content":[{"content":[{"text":"a","type":"text"}],"type":"paragraph"},{"content":[],"type":"paragraph"},{"content":[{"text":"b","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}
```

Exact identity topology: R[P,N,PT]; P retains ORIGINAL T now `a`; N is a fresh empty paragraph with children[] and NO empty Text; PT is a fresh trailing paragraph containing fresh right split Text U=`b`. R/P/T all survive; created exactly U,N,PT; no original node retires. U is created by splitting T and inherits its type/attrs/marks, then moves from P to PT without changing U's ID. PT copies original P header (for this literal attrs absent); inserted N is target_node paragraph attrs absent. No Join/removal/normalization merges across paragraphs. Allocation tokens are opaque; role freshness/distinctness and creation order U then N then PT are source facts, never hard-coded serials.

Both final endpoints are EXACT `{kind:'text',node:U,offset:0,affinity:'after'}`, not Child(N,0), not original T@1, and not a caret in inserted empty N. stored_marks:null. Query available/changed; mutation Ok/changed/presentation none. Revision1/selection_epoch2/history_epoch1, saved_revision0, dirty:true, undo1/redo0; one document event, no hidden intermediate publication. Unlike N01, selection_epoch increments because the exact position ID/offset changes.

Single prepared recipe, operation order source-authored:
1. SplitText(T,1) creates U=`b`, T=`a` stays original.
2. InsertFragment(R,1,[empty paragraph N]).
3. InsertFragment(R,2,[empty paragraph PT copied header]).
4. MoveInlineGroup([U],PT,0).
No ReplaceInlineRange for this collapsed selection (`deletion=None`). Private final selection is MapFromUserResult(U@0 After), and stored marks Inherit.

Exact forward map-step sequence (private source assertion, not an exposed protocol map DTO):
```text
SplitText{left:T,right:U,at:1,old_len:2}
ChildInsert{parent:P,index:1,count:1,old_len:1}
ChildInsert{parent:R,index:1,count:1,old_len:1}
ChildInsert{parent:R,index:2,count:1,old_len:2}
ChildMove{from_parent:P,from_index:1,to_parent:PT,to_index:0,count:1,from_len:2,to_len:0}
```

Public mapping required points: original T@0→T@0, T@1 After→U@0 After, T@2 After→U@1 After; each mapped/deleted:false. ORIGINAL root Child(R,1,After)→Child(R,3,After). Original Edge(T,Before) maps to Edge(T,Before), whereas original Edge(T,After) maps to Edge(U,After) by SplitText (engine/mapping.rs:339–350); both deleted:false. Do not substitute Text-ID survival for actual Edge mapping semantics.

Undo restores EXACT INPUT with original R/P/T, T=`ab`, original caret(T@1 After); U,N,PT retire. Revision2/selection_epoch3/history_epoch2, undo0/redo1, dirty:true/saved_revision0. Redo revives SAME U,N,PT IDs and exact EXPECTED/caret(U@0), revision3/selection_epoch4/history_epoch3, undo1/redo0; no clone IDs. Snapshot equality does not reset chronological counters.

Derivation: block.rs:287–351 splits ONLY outside end into tail (collapsed still splits);231–251 picks first tail's Text@0;1638–1673 root-gap branch does not admit a Text position;1674–1688 inserts target+copied trailing header, moves tail, finishes deletion only if nonempty; tree.rs:1903–1970 keeps left and allocates right;1367–1495 preserves moved suffix IDs;3260–3310 gives inserted-node map/undo retirement. This is NOT Enter, which has its own recipe. The host MUST complete with the captured original T@1 native selection; staging a root Child gap to make Add simpler would violate this scenario and stale the captured host request.

## N08 — Container primitive does not imply profile-legal Nest

Literal input:
```json
{"content":[{"content":[{"content":[{"content":[{"text":"a","type":"text"}],"type":"paragraph"}],"type":"list_item"}],"type":"bullet_list"},{"attrs":{"align":"right","first_line_indent":true},"content":[{"marks":[{"type":"strong"}],"text":"b","type":"text"}],"type":"paragraph"},{"attrs":{"level":3},"content":[{"text":"tail","type":"text"}],"type":"heading"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}
```
Roles R[L,B,H], L[I], I[A], A[AT], B[BT]; selection caret(BT@1). Intent `{kind:'move',node:B,parent:L,before_index:1}`. Primitive Container accepts a block but KWDJ BulletList accepts only list_item, so exact expected canonical remains INPUT; query unavailable/execution Refused:
```json
{"code":"kwdj.invalid_profile_content","path":"/content/0/content/1","category":"paragraph","details":{},"stamp":null,"may_have_committed":false}
```
Category is `paragraph`, because validate.rs:183–190 uses categorized InvalidProfileContent with actual node.kind(), not the generic fallback category profile. All baseline facets unchanged. Do not call this “indent list item”; direct Move does not synthesize list/list_item wrappers. A product affordance may present this target disabled only after native query, not infer Container legality in TS.

## Host request focus / one pump source check

No contradiction found in root's narrow prospective-result permit decision IF it preserves these distinctions:
- Existing bookmarks keep native-noop/state-only/queued invalidations (`selection.ts:59–77`); the new permit is separately bound to ORIGINAL submission frame/context/intent and original result, not a revived bookmark or an arbitrary fresh serial read after callbacks.
- For collapsed stored-mark completion, native state event increments selection_epoch and endSubmission deliberately invalidates the old bookmark. A private focus permit may recognize only the exactly expected own publication/end invalidation with no reentry/foreign intent; it must use RESULT selection and keep the actual original Submission/Response unchanged. Queued/unknown continuity can truthfully be not_restored.
- completeHostRequest consumes genuine identity BEFORE copying/dispatch and requires captured/current FULL stamp equality (`sdk/controller.ts:171–182`). Restoring captured selection before complete would increment epochs when changed and stale the request. Do not add a second controller.submit after complete, or an SDK-external queue.
- Mounted currently forwards through controller.submit inside one SelectionOwner frame (`mounted.ts:309–335`). The new private host-complete dispatch needs the SAME lifecycle/composition/catalog/frame/fatal/externalSubmission skeleton with only the final dispatch closure changed; direct raw controller completion would bypass mount protection. Shared SDK #submitOwned already owns the pump.
- Post-result focus still requires the originally captured connected outside focusScope and activeElement inside it at checks, with original generation/context/result continuity checked before AND after focus. A hidden connected shell at capture is compatible; no body-wide lease, DOM IDs, fresh bookmark or independent set_selection/focus transaction should grant authority.

The supplied alignment note already distinguishes `MountedHostCapture` from SDK HostCapture and acknowledges query purity. These vectors add no new focus authority and do not pretend geometry coordinates establish a native move target. Source-specific error matrices should preserve native diagnostics, not translate every refusal into dom.stale_host_request.

## Source pins and provenance

Read inputs: `/tmp/osr-42-api-alignment-source-notes-01.md` and `/tmp/osr-42-native-vector-source-draft-01.md`. Their historical eb source is tree-identical to accepted857; the pins below were independently compared byte-for-byte to Git857, not assumed from that statement. All source pins rechecked after writing this outside-only file. No source acceptance/test result follows from a hash.

- `crates/kwdj/src/commands/block.rs` — 90571 B; SHA256 `85ca66ce1c5121f6ef73e6159819bbedc0c934729a18c287cdc03e02b197cc0e`; bytes equal Git857.
- `crates/kwdj/src/commands/mod.rs` — 8311 B; SHA256 `aeb7ea6abb41a69405e7876fe5df6a9572d7a544f05308be4de84f708ed7a8e4`; bytes equal Git857.
- `crates/kwdj/src/validate.rs` — 40723 B; SHA256 `9824aeb6c05aeb5eff99af84d3c711c87eb728efa53181c1834d39354221ceec`; bytes equal Git857.
- `crates/kwdj/src/edit_normalize.rs` — 41095 B; SHA256 `4b8b4e2e26e74312e24d832a845a40fcbef1daf12f50e6b5a613cdded0e88b0a`; bytes equal Git857.
- `crates/kwdj/src/candidate_cache.rs` — 36718 B; SHA256 `79bc689f6d7e33351dd9ced3d465860fba6577f14cf59bfd9c60c259b9ac3020`; bytes equal Git857.
- `crates/kwdj/src/candidate_validate.rs` — 47536 B; SHA256 `61316de282ff53bbed9dca09d9584996fb5172e5c11b32d2f004befe4bf11eb5`; bytes equal Git857.
- `crates/kwdj/src/session_profile.rs` — 17973 B; SHA256 `262e3878671e9e69a1afe77257877dc1232f7642722df6946d80541325b53876`; bytes equal Git857.
- `crates/kwdj/src/lib.rs` — 27861 B; SHA256 `c9d33aeb376a6be9eaab53b34ab17229f40a584aeba85b9bfbcc302a27c463b9`; bytes equal Git857.
- `crates/kwdj-sdk/src/wire.rs` — 12999 B; SHA256 `d19033b8f4f3f244ec01ffab0ee17a11dd2a770cd1105c589bc94ab9f38f3cdd`; bytes equal Git857.
- `crates/kwdj-sdk/src/convert.rs` — 4900 B; SHA256 `6586e933c1bb3d76f51101b9c33f0ff62c3350dd029a01bef7f056af458c4833`; bytes equal Git857.
- `crates/kwdj-sdk/src/factory.rs` — 35265 B; SHA256 `e6a46b164afb21ff350d4c8c7d1b3e8266bf91393b9b12465e8752ef5d8284db`; bytes equal Git857.
- `crates/engine/src/tree.rs` — 197736 B; SHA256 `d1bc2205af12063d4b3b6386f0198830d321ba35b8f2a1d4ae4962d075caedda`; bytes equal Git857.
- `crates/engine/src/commands.rs` — 10689 B; SHA256 `21940c788ad28d4555d698feefc5a8021c1b784335c90cbecde53eb7a5ae529d`; bytes equal Git857.
- `crates/engine/src/dispatch.rs` — 37299 B; SHA256 `b85613e1f86b5ae0221834b2557656fde63233ae2399f0fe0cacc2f393b799a3`; bytes equal Git857.
- `crates/engine/src/history.rs` — 56430 B; SHA256 `43a28d7fc3e48138d71f4e0cb2889a572fa25dc545b39e6a0e793ae6d610382d`; bytes equal Git857.
- `crates/engine/src/mapping.rs` — 46845 B; SHA256 `1a4fa095075d31407d6f042d1374320b2e30102d7b89a67652daf55b32924e54`; bytes equal Git857.
- `crates/engine/src/session.rs` — 35352 B; SHA256 `156f018cf9927ec8ea0648b2ffac873a3807886019020cda6445efd7a294a7b5`; bytes equal Git857.
- `crates/engine/src/transaction.rs` — 15508 B; SHA256 `34e628108dff27be15ab8ba1787ecf0132125ecf91d40d6ef38b438f7ac5260d`; bytes equal Git857.
- `crates/bridge/src/lib.rs` — 36728 B; SHA256 `1d59524a4db8ac7de9793f9ccd352e34f18c7e2da55b8b408690ed1ce2016600`; bytes equal Git857.
- `crates/bridge/src/convert.rs` — 13259 B; SHA256 `c2a8303ca7ea4a88c5b395add6860e536b69875e0b1b7ec036f7d65acc10a815`; bytes equal Git857.
- `crates/protocol/src/lib.rs` — 13477 B; SHA256 `34bdfbce364e45c89b3c531985ca1a4728da3142b903c585ce3b0a9058ab55b3`; bytes equal Git857.
- `crates/core/src/commands.rs` — 19905 B; SHA256 `c6cb3b20e83524d4892b05d9c36d6ce47184e7e14eccb71b7604c540cdcb7f8a`; bytes equal Git857.
- `packages/kwdj/src/index.ts` — 1536 B; SHA256 `f369b51656c4840107b4db51dc157ce7b2635888a73896b52ad113be6ce612ca`; bytes equal Git857.
- `packages/dom/src/mounted.ts` — 34380 B; SHA256 `8de7eb6cd4db47782ebaafcec874c533e2f3adaa2e72df5ce4647dbd1e2dee53`; bytes equal Git857.
- `packages/dom/src/selection.ts` — 21151 B; SHA256 `c17faf3e6d082f5dc939622a380e16fb1e5dcecf648362e26a02083f98f4d4cd`; bytes equal Git857.
- `packages/sdk/src/controller.ts` — 25035 B; SHA256 `4bbfc4e4221c91c6a4aaeb6db6ac6ab18267363662f0dc6c8b53a1c516b0b509`; bytes equal Git857.

- Input note `/tmp/osr-42-api-alignment-source-notes-01.md` — 8177 B; SHA256 `65496a031a9511d523669879df1475527aabca7de0e1577f81144f3ff63e8b69`.
- Input note `/tmp/osr-42-native-vector-source-draft-01.md` — 12994 B; SHA256 `f98d01fce6dde908ce7d5d929c09f4d0647f7e7f69cd7d1f1bbfd5f77828f000`.
