# OSR-42 — native semantic vector source draft01

PREPARATION ONLY. Source supplied as eb028224f23e8522d43eb0b1db0d2390978cb06c; not an accepted42 base, freeze, execution or review. No modules/tests/browser/OS/API were run. These six small families are authored from current Rust and older independent fixtures, not candidate output. Refresh accepted main after41 before freezing.

Conventions: bind opaque IDs bijectively to admitted roles before the action; never parse IDs. `T@i` means `{kind:'text',node:T,offset:i,affinity:'after'}` (UTF16 units), `R#i` means `{kind:'child',parent:R,index:i,affinity:'after'}`. All fresh cases start revision0/saved_revision0, no undo/redo/open typing group, stored_marks:null, editable. Install the literal selection through public set_selection, drain setup events, then capture the action baseline. Counter deltas below are relative to that baseline, not mount. Full session/generation/stamp/context must remain actual opaque captured values.

For KWDJ use `kwdjCommand(intent)`: it produces `CommandDto{id,payload_json}` with the intent's `kind` included. Query the identical owned command/current full stamp, then submit `{kind:'command',stamp,command,history_hint:{kind:'isolated'}}`. Refresh after every state event; query is pure and does not consume identities. The raw DTO is not `{kind:'toggle_mark'}` passed directly to mounted.submit. Sources: packages/kwdj/src/index.ts:9–27; packages/sdk/src/index.ts:9; packages/wasm/src/sdk-types.ts:36–54.

## V01 — ranged mixed Strong, whole leaves, both directions

Roles R / P1,T1 / P2,T2. Exact canonical input:

```json
{"content":[{"content":[{"marks":[{"type":"strong"}],"text":"ab","type":"text"}],"type":"paragraph"},{"content":[{"text":"cd","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}
```

Selection T1@0→T2@2; reverse variant T2@2→T1@0. Intent `{kind:'toggle_mark',mark:{type_id:'org.klenwriter.kwdj/strong',attributes:{}}}`. Query: available, effect `changed`, presentation.active `mixed`. Expected canonical after:

```json
{"content":[{"content":[{"marks":[{"type":"strong"}],"text":"ab","type":"text"}],"type":"paragraph"},{"content":[{"marks":[{"type":"strong"}],"text":"cd","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}
```

All five IDs survive; none created/retired. Text, paragraph attrs, directed selection and stored_marks:null remain exact. Revision+1, selection_epoch+0, history_epoch+1, undo1/redo0, one document event, dirty:true. One undo restores input bytes and original direction/IDs; redo restores after bytes and same IDs. Revisions remain chronological during undo, not reset to0. **Mutation presentation is the pre-action `mixed`**, not refreshed `on`; a fresh query reports `on`. Source: inline.rs:460–468,552–650 and its reverse_partial_cross_block... test:1229; tree.rs:1042–1130 keeps an entire selected leaf's ID, splits only partial changed spans. Isolated history: history.rs:249–307; dispatch.rs:748–850.

## V02 — collapsed Strong twice, state-only override

Input `{"content":[{"content":[{"text":"ab","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}`; roles R/P/T, caret T@1. Same Strong intent. First query active `off`, effect `unchanged`, stored_marks_changed:true. First accepted command sets stored_marks to `[{type_id:'org.klenwriter.kwdj/strong',attributes:{}}]`; second fresh query active `on`, second command sets **[]**, not null. Canonical, all IDs, caret, revision0/saved_revision0/dirty:false and undo0/redo0 stay unchanged throughout. Each command increments selection_epoch once and publishes exactly one state event (stored_marks_changed:true, selection_changed:false); history_epoch stays unchanged because no open group. No document event/undo unit. A third query active `off`. Reusing the old stamp is stale after the first command. Source: inline.rs:360–374,525–550,581–615 and collapsed_toggle...:1290; dispatch.rs:748–776,844–845; history.rs:361–375. Existing command_tests.rs:901–920/1268–1336 independently tests the same state-only engine behavior. With an actual open typing group the state change can seal it and advance history_epoch: do not generalize the no-open baseline.

## V03 — Add Paragraph at an explicit root child boundary

Input `{"content":[{"content":[{"text":"ab","type":"text"}],"type":"paragraph"},{"content":[{"text":"cd","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}`. Roles R/P1,T1/P2,T2. Collapsed R#1. Intent `{kind:'insert_block',target:{kind:'paragraph'}}` (ID org.klenwriter.kwdj/command/insert-block). Query available/changed. Expected:

```json
{"content":[{"content":[{"text":"ab","type":"text"}],"type":"paragraph"},{"content":[],"type":"paragraph"},{"content":[{"text":"cd","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}
```

Exactly one new paragraph N, no empty Text; all original IDs/subtrees survive. Both endpoints become Child(N,0,After), stored_marks:null. Revision+1/selection_epoch+1/history_epoch+1, undo1/redo0, one document event. Undo retires N and restores original R#1; redo revives the same N and its child caret. Sources: block.rs:436–463 outside_gap,1036 target_node,1616–1671 insertion/caret; wire_view.rs:165–213 writes empty content. **This is not Enter or insertion at a Text caret**: the latter follows the different cut/split/trailing-block branch at1673–1690. Freeze the host's placement intent explicitly; do not silently manufacture a root-gap selection while completing a captured text-range action.

## V04 — same-parent Move, independent up/down variants + undo

Input `{"content":[{"content":[{"text":"a","type":"text"}],"type":"paragraph"},{"content":[{"text":"b","type":"text"}],"type":"paragraph"},{"content":[{"text":"c","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}`. Roles R/A,AT/B,BT/C,CT; caret BT@0.

Up intent `{kind:'move',node:B,parent:R,before_index:0}` → B,A,C, exact canonical:

```json
{"content":[{"content":[{"text":"b","type":"text"}],"type":"paragraph"},{"content":[{"text":"a","type":"text"}],"type":"paragraph"},{"content":[{"text":"c","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}
```

Down (fresh initial fixture) `{kind:'move',node:B,parent:R,before_index:3}` → A,C,B, exact canonical:

```json
{"content":[{"content":[{"text":"a","type":"text"}],"type":"paragraph"},{"content":[{"text":"c","type":"text"}],"type":"paragraph"},{"content":[{"text":"b","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}
```

**Index3 is before removal; index2 would be a no-op.**

No created/retired IDs, attributes/text/subtrees unchanged; caret retains BT@0 and stored_marks:null. Each query available/changed, revision+1/selection_epoch+0/history_epoch+1, undo1/redo0, one document event. Undo/redo restore exact order and original subtree IDs, not cloned replacement IDs. Source: block.rs:1826–1840 forwards an ordinary Operation::Move; tree.rs:2418–2485 defines index correction and identity retention; tree test move_forward_backward...:4530–4564 proves the same index/point mapping. Freeze these already-authored complete canonical strings before42; never reconstruct expectations from candidate logic.

## V05 — true Move no-ops and precise refusal distinctions

Fresh V04 input/caret each time. Move B to R before_index1 **or2**: query available/effect `unchanged`; execution Ok/unchanged with entire canonical, IDs, stamp, selection, stored marks, dirty/saved_revision/history and events unchanged (zero events; no hidden barrier or undo slot).

Move B to R index4: query unavailable and actual native refusal `tree.invalid_index`. Move B into A at0: `tree.invalid_structure` (TextBlock cannot contain a block). Move synthetic R itself: KWDJ's structural precheck refuses `kwdj.command_invalid_target`; do **not** demand tree.root_mutation from this profile command. Every refused action retains all baseline facets and existing redo; no native ticket is replayed. Sources: block.rs:1692–1706,1826–1840; tree.rs:2428–2444 checks index/primitive before cycle; transaction.rs:162–166 exact engine codes. A cycle fixture needs a destination Container descendant accepted by the primitive check; arbitrary paragraph/text descendants cannot prove tree.cycle. Depth/cycle Nest/Unnest literals remain separate prefreeze authoring work, not guessed from this three-block case.

## V06 — real non-KWDJ D0 profile/action through the same generic UI

Use existing examples/notes-extension/d0.json and notesD0Renderers; ABI editor-sdk/2 profile tuple org.example.notes@1.0.0, codec org.example.notes/json wire1, base extension1.0.0, root_blocks:[org.example.notes/paragraph]. Generic UI receives a supplied factory `createCommand('org.example.notes/command/set-title',{title:'new title'})`; **Notes payload has no KWDJ kind discriminator**. The single space in `new title` is U+00A0. Reuse independently frozen NC011 input/expected canonical strings from contracts/notes/v1/commands/vectors.json:593–636 (D1 packet's base-only literal is also valid in D0): root attrs tags:[], title:""→"new title", one paragraph/text `ab`; caret semantic Text path[0,0]@1 remains exact. Engine synthetic root R and semantic document D are distinct; command updates D (view.roots()[0]), not R or a DOM title property.

Query available/changed; one isolated document update: all R/D/P/T IDs survive, text/tags/selection/stored_marks:null unchanged, revision+1/history_epoch+1/undo1/redo0, selection_epoch+0, event1. Undo/redo restore exact metadata/IDs. Repeating the identical title is a genuine zero-event no-op (NC013:680). For a true native refusal through the D0 DOM binding, use the already-authored NC014:721 payload (128 precomposed é + 'a':257 UTF8 bytes,129 UTF16 units): its129-unit string passes the binding's <=256-unit presentation gate, then Rust rejects `notes.invalid_attribute` at /root/attrs/title with no publication. An ASCII257 title instead refuses at the DOM gate and is a different oracle. Generic Strong/Move controls must not invent KWDJ commands in this catalog. Sources: notes/commands.rs:15–23,283–295; examples/.../dom.mjs:14–18,39–46; testkit.mjs:80–87. No new Notes business rules or second Session.

## Freeze decisions still needed, without a new product question

Freeze these source-authored literal families plus role correspondence and action-baseline counters. Refresh42 base/pins after41 acceptance. Specify Add's root-gap versus current-text placement and exact active/disabled query DTOs per supplied profile factory; these are implementation-contract choices already bounded by accepted UX, not permission to start42. Keep navigation/host-dialog focus and geometry expectations separate from native semantic vectors. Never promise unchanged epochs for bookmark restoration/state-only actions or dirty:false after undo merely because input bytes reappear; do not freeze target-dependent retained_bytes as one shared native/WASM constant.

Source pin readback (same before/after this outside-only authoring; not a git/code-review verdict):
- `packages/kwdj/src/index.ts` SHA256 `f369b51656c4840107b4db51dc157ce7b2635888a73896b52ad113be6ce612ca`
- `packages/sdk/src/index.ts` SHA256 `185cafbffbb9dcac4f51df81c3cacec7061e05976fee937a87c6637bd2a3b2cb`
- `packages/wasm/src/sdk-types.ts` SHA256 `309b33ca672d5037f0325f13fe886626e27b164094cfe20b79919d44778b5d66`
- `crates/kwdj/src/commands/inline.rs` SHA256 `eb1fe676535cf136f5fb7cdb059a06f03c2c128c5b8d3078da869401487b4394`
- `crates/kwdj/src/commands/block.rs` SHA256 `85ca66ce1c5121f6ef73e6159819bbedc0c934729a18c287cdc03e02b197cc0e`
- `crates/engine/src/tree.rs` SHA256 `d1bc2205af12063d4b3b6386f0198830d321ba35b8f2a1d4ae4962d075caedda`
- `crates/engine/src/dispatch.rs` SHA256 `b85613e1f86b5ae0221834b2557656fde63233ae2399f0fe0cacc2f393b799a3`
- `crates/engine/src/history.rs` SHA256 `43a28d7fc3e48138d71f4e0cb2889a572fa25dc545b39e6a0e793ae6d610382d`
- `crates/engine/src/transaction.rs` SHA256 `34e628108dff27be15ab8ba1787ecf0132125ecf91d40d6ef38b438f7ac5260d`
- `crates/notes/src/commands.rs` SHA256 `7035e6b3f98c3b2d11f4d5f1c411cecca081b33467e7eb69f42d40b7f03e9095`
- `contracts/notes/v1/commands/vectors.json` SHA256 `43d060a1e3a07d1c44d9eaa9e57d7aa47347d8f13790e8641acbd38aad20e4f9`
- `examples/notes-extension/d0.json` SHA256 `96758c6f9b60282947953ea10e17004467e736e97ee0123e60106d57b413764a`
- `examples/notes-extension/dom.mjs` SHA256 `0d4aebb834b03f068e21fc74f7888f60cdfe794ac3d78d1dd7a5967471815205`
- `examples/notes-extension/testkit.mjs` SHA256 `984c2d90735c4c9cdf58e188f8e4d6cc4d871e1913928e744a36d029d8d87420`
