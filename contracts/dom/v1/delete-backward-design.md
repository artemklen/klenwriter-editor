# OSR-39: exact native backward-delete contract proposal

SOURCE-ONLY PROPOSAL FOR THE VERSIONED FREEZE. Primary has selected the behavior below; implementation remains on hold until the versioned contract/oracles are committed. No code, generated declarations, fixture expectations or repository files were changed, and no runtime/tests/builds/CI were run. This is supporting design, not formal review. Source anchors refer to `/Users/artem/projects/klenwriter-editor`.

The older `/tmp/osr-39-refine-contract.md` contains historical intake/source/status observations; current primary authority is OSR-39 from accepted main b9e2790, after OSR-38 close. Do not turn that older intake's pending38/source9a text into current execution metadata.

## 1. Exact additive native and wire surface

- Exact command ID: **`org.klenwriter.kwdj/command/delete-backward`**.
- Native intent: **`KwdjIntent::DeleteBackward`**, no parameters.
- Closed SDK payload DTO: **`KwdjIntentDto::DeleteBackward {}`**, internally tagged serde kind `delete_backward`. It must be an empty STRUCT variant, matching the existing closed-unit repair; not a serde unit that can ignore extra fields.
- Exact canonical payload string: **`{"kind":"delete_backward"}`**.
- Exact `CommandDto` JSON fragment, identical for SDK1 and SDK2:

```json
{"id":"org.klenwriter.kwdj/command/delete-backward","payload_json":"{\"kind\":\"delete_backward\"}"}
```

The command uses the actual Session selection. It adds no range, raw operations, target IDs, scalar privilege, implicit rebase or pre-query authorization field. `{"kind":"delete_backward","extra":true}` must fail existing strict decode with `sdk.invalid_dto`, path `""`, before planning. ID/payload mismatch keeps the existing `command.unknown`, path `command.id` guard (`crates/bridge/src/lib.rs:319`–334). Old unknown variants remain refused.

Let **S** be the complete actual `StampDto` returned by `capture()`/state (session, generation, revision, selection_epoch, history_epoch: existing string representations). S is a data substitution, not a fabricated session token. The exact request structures are:

```text
query:   {kind:"query_command", stamp:S, command:C}
execute: {kind:"command", stamp:S, command:C, history_hint:{kind:"isolated"}}
```

Here C is the exact CommandDto above; only S is captured at runtime. No extra SDK2 field/wrapper is inserted into C: SDK2 chooses the KWDJ profile during admission, and `RecipeAdapter` routes the compiled marker to the real KWDJ adapter. ABI1 uses the same native adapter payload. Public TS construction is `kwdjCommand({kind:"delete_backward"})`, then ordinary `query`/`submit`. This is DTO construction only, never semantic deletion in TS. No new WASM export or common request/reply DTO is needed.

Default `CommandPresentation` has active=None. Existing wire query reply remains `availability`: enabled successful edit predicts effect `changed`; first eligible top-level start predicts `unchanged`; presentation is `{active:null}`, diagnostic null. Execute returns existing mutation/state/event structures. Unavailable query remains an OK availability envelope with available=false, effect/presentation null and diagnostic; execute is Refused. Match diagnostic **code/path/reason**, not byte equality of the whole envelopes: current bridge fills an outer execute diagnostic's actual stamp, whereas an inner query-availability diagnostic can retain stamp=null. No fabricated literal StateDto/opaque tokens are introduced.

## 2. Primary-selected behavior and deterministic guards

Use actual logical point equivalence (Text/Child/Edge and affinity variants can describe a zero-width range), while preserving the exact original typed anchor/focus in before-state/history. Existing `ordered_range`/`text_point` are at `crates/kwdj/src/commands/inline.rs:46`–145, and `ordered_range.is_empty` is derived near340. No public selection mutation is used to stage deletion.

| Actual selection/context | Required result |
|---|---|
| No selection | Refuse `kwdj.command_selection_required`, `/command`. |
| Noncollapsed supported range, including reverse range | Route the actual selection through existing internal `InsertText("")` replacement preparation in the SAME command. Preserve existing range replacement contexts, final-caret policy, barriers/refusals, marks and normalization semantics; no separate SetSelection/history/event. Its before-history keeps the actual original range/direction. This addition does not redefine old InsertText. |
| Collapsed text position after a full pinned EGC | Delete exactly the immediately preceding logical EGC; adjacent styled Text leaves are one segmentation stream, so a cluster crossing mark boundaries is deleted whole. Preserve every surviving code point, SPACE/NBSP, attrs and mark payload. No NFC/NFKC, UTF16-unit/code-point deletion, Intl.Segmenter authority or partial style-leaf workaround. |
| Scalar-valid caret inside an EGC | Refuse edit boundary admission; never round/expand silently. Surrogate-interior coordinates remain invalid under existing native positions. |
| CodeBlock interior text | Previous-EGC deletion is supported, including ordinary newline TEXT when the original boundary is valid. A hard_break NODE is a separate barrier. |
| Collapsed eligible paragraph/heading start, with previous sibling | Atomic same-parent join only when both exact full profile types match (`paragraph` with `paragraph`, `heading` with same heading type) and attrs are semantically equal, including heading level/layout. Preserve all inline runs/marks/IDs except explicit normalization retirement. |
| Eligible join ancestor chain | Synthetic root, optionally a simple blockquote. No list/task/table/domain ancestry crossing or implicit lift/unwrap. No skipping an incompatible previous sibling. |
| Collapsed CodeBlock start | Explicit unsupported; no joining code blocks because Enter's LF policy differs. |
| Existing incompatible sibling/type/attrs | Refuse atomically: type/attrs mismatch => `kwdj.command_lossy_transform`; unsupported block/barrier/nesting/domain => `kwdj.command_unsupported_context`, `/command`. |
| HardBreak/InlineAtom at deletion/join boundary or incompatible inline group | Explicit unsupported. Initial join requires boundary-compatible text-only inline groups; no implicit atom removal, placeholder text, or movement across a forbidden boundary. |
| Top-level first eligible block start with NO previous sibling | True Unchanged: no document/selection/history/event increment, no allocator serial prediction. Query may be available with the same empty plan. Distinguish an existing incompatible sibling (Refused) from no sibling (Unchanged). |
| Readonly/stale/context/facts/limits/late validation failure | Existing typed engine/profile refusal; preserve every committed facet. A previous available query is not authority. |

Diagnostic order: existing engine stale/access guards first; then selection presence; then eligible context/ancestor/barrier checks; only when both join endpoints are eligible compare exact type/attrs for lossy-transform. Missing previous sibling is Unchanged only after current top-level eligibility is established. No-op does not bypass the existing final candidate/typing/facts validation.

Notes does not receive this intent, compiled marker or TS helper. Its existing3 native commands and profile behavior remain independent. New KWDJ default command behavior is not a generic editor-wide deletion contract. Mounted renderer capability guards still govern whether a document/mark context is editable; they do not replace Rust validation. Existing URL/reference/current-identity/registry final checks remain authoritative; this proposal grants no special exemption for deleting protected/domain content.

## 3. Pinned Unicode and bounded planning

The existing authority is core positions' pinned `unicode-segmentation`1.13.3 (`Cargo.lock:651`–655), with `SEGMENTATION_UNICODE_VERSION`, `grapheme_boundaries` and borrowed `InlineSpan`/`validate_inline_boundary` (`crates/core/src/positions.rs:158`–259). A leaf-local call alone is insufficient for `e` in one leaf plus U+0301 in another, RI parity or ZWJ context. Read the contiguous logical Text run, stopped by hard-break/atom barriers, and compute a predecessor using those pinned semantics. Retain the original current endpoint; core user-operation guards must still validate both original outer EGC boundaries. Never take an interior caret and expand it to an accepted endpoint.

One PlanBuilder WorkMeter covers neighbor/ancestor/child lookups, text/context scans, segmentation metadata/temporary text, attrs comparisons, operation/path growth and later transaction phases. Charge before copying/allocation/scan, use checked lengths, and refuse on the existing cap. Initial implementation may use a bounded charged logical Text-run buffer plus existing core segmentation, or a borrowed chunk cursor with identical rules; neither may scan the whole Document or hide an unmetered Vec. No new public scalar/origin flag, counter setter, mutable view or engine semantic branch is needed.

## 4. PlanBuilder, identity and caret strategy

**Same-block EGC deletion:** emit the existing `Operation::ReplaceInlineRange {range:[previousBoundary,currentCaret], inserted:None}` with one complete original EGC, not per-leaf ReplaceText. Generic operation handles internal style seams under its sealed complete-range authority (`crates/core/src/transaction.rs:48`–58; `crates/engine/src/tree.rs:1243`–1362). Operations are still prepared before normalization/publication.

Choose an actual surviving Text identity at the deletion seam and use `SelectionIntent::MapFromUserResult(Some(collapsed_caret))`; do not blindly set Child(block,prefix) when later JoinText can change that gap's meaning. Prefer a retained left prefix/previous Text end. If there is no left survivor, use the surviving right suffix at offset0; if both sides empty, use Child(block,0,after). Prefix deletion can split the original endpoint leaf internally and retire its original ID: the planner must not assume that suffix retains the old leaf ID. If a known suffix reference is necessary, pre-split ONLY the user-safe outer current endpoint with `SplitText`, obtain `LocalRef::Created{operation:<that prior op>,path:[0]}`, then delete the already validated preceding range. Never split an internal styled EGC seam or refer to hidden Created IDs from `ReplaceInlineRange(None)`, which returns no inserted root. Retain normal EGC validation and final shape/selection validation for this whole batch.

**Start join:** inspect the immediate preceding eligible sibling, validate exact type/attrs/ancestor/barrier policy, preserve its ID, and move the current block's whole contiguous inline group with `MoveInlineGroup {nodes:<existing right children>,parent:<left>,before_index:<original left child count>}`. Skip that operation when right is empty. Remove ONLY the now-empty right block. Both operations belong to one PlanBuilder result, not two public submissions. Do not use the existing standalone Remove planner's caret policy, which targets the containing parent gap (`commands/block.rs:1720`–1770).

Record the join caret BEFORE normalization as Text(last original left Text,old UTF16 end,after), or Child(left,0,after) if left was empty. Set `MapFromUserResult` after the user operations. The engine validates this user-frame caret and maps only the normalization suffix (`core/commands.rs:28`–33; `engine/dispatch.rs:729`–748). Existing JoinText maps preserve the left endpoint offset and retire right leaf IDs (`engine/mapping.rs:350`–417); equal attrs/marks may merge, distinct marks stay distinct runs. No copied browser ID is accepted as a model identity.

For a collapsed command, **the Session selection is never temporarily changed**: state passed to the planner is borrowed, and local derived ranges are only operation parameters. Engine event/history before-selection remains the actual collapsed original selection. Range routing likewise uses actual state, not a synthetic public SetSelection. Proposed typing policy is `StoredMarksUpdate::Keep` (including None inheritance and Some([])); existing finalizer must validate it against FINAL candidate/selection/registry under the same meter (`commands/mod.rs:228`–248). Any invalid final typing context refuses the whole command; no mark copying onto an arbitrary neighbor. Primary should include this explicit Keep choice in the freeze.

Each real isolated action publishes once, revision+1 and one history unit; true no-op/refusal/query publish none. Do not promise allocator high-water rollback on refused real prepare. Query uses preview allocation and stays pure. Native journal/history saves actual before/after IDs, selection and stored marks, so undo/redo revives historical retired nodes without a public replay privilege. Host-supplied typing hints retain the existing generic engine policy; this task promises isolated T02/T03, not a new grouping algorithm.

## 5. Exact required T02/T03 checkpoints

T02 existing draft: after Enter, P1,E,P2 with E empty and attrs equal P1. Before delete is exactly Child(E,0,after), collapsed. Join returns D0, leaves P1/P2/TA/TB/TC/T2 IDs, retires E, and final caret exactly Text(TC,2,after). Undo join restores D1 and the SAME E with original Child(E,0,after); redo retires E again and restores exact Text(TC,2,after). Preserve Enter's earlier separate history unit and the draft6 revision/undo/redo checkpoints. No empty authored text prototype is inserted.

T03 existing draft: split `a😀b`/strong at UTF16 offset1 leaves original left P/T=`a`, new E/TR=`😀b`/strong, collapsed Text(TR,0,after). Join moves TR to left, retires E, then normalization retains left T=`a😀b`/strong and retires TR with maps. Final caret **Text(T,1,after)**, not end4 and not Child gap. Undo restores the SAME E/TR, exact split canonical text/marks/layout and before-caret Text(TR,0,after); redo rejoins with same left identity. One action/event/history publication each. These literals are frozen before implementation, never derived from renderer or new native output.

Additional independent literals before implementation: whole EGC spanning plain `e` + strong U+0301; emoji/ZWJ and RI context across styled leaves; SPACE versus NBSP; interior-EGC refusal; prefix deletion with known suffix identity/caret; erase full sole cluster to empty paragraph; same-mark merge versus distinct-mark preservation; equal heading attrs versus mismatched level/layout; no previous versus forbidden existing sibling; CodeBlock text LF deletion versus blockstart refusal; hard-break/atom/list/table/domain barriers; readonly/stale/facts/late-work/journal failure; Some([])/Some(mark) typing override and finalizer refusal. Tests assert actual query/execute code/effect/work parity within target, committed facets/maps/IDs/history and final selection, not fabricated serials or approximate text equality.

## 6. New16 inventory and compatibility qualification

Append the new entry after the unchanged original15 KWDJ_COMMANDS entries, preserving their indices/order:

```text
org.klenwriter.kwdj/command/enter
org.klenwriter.kwdj/command/shift-enter
org.klenwriter.kwdj/command/toggle-mark
org.klenwriter.kwdj/command/set-link
org.klenwriter.kwdj/command/unset-link
org.klenwriter.kwdj/command/insert-text
org.klenwriter.kwdj/command/transform-block
org.klenwriter.kwdj/command/toggle-quote
org.klenwriter.kwdj/command/toggle-list
org.klenwriter.kwdj/command/insert-block
org.klenwriter.kwdj/command/move
org.klenwriter.kwdj/command/duplicate
org.klenwriter.kwdj/command/remove
org.klenwriter.kwdj/command/accept-slash
org.klenwriter.kwdj/command/dismiss-slash
org.klenwriter.kwdj/command/delete-backward
```

This is the proposed frozen **compiled base inventory**. V1 advertises that native provider order. V2 `Recipes<P>` uses the registry's ASCII-sorted catalog:16 base IDs plus each actually selected runtime recipe, not a false universal count16. KWDJ mandatory compiled markers already derive from KWDJ_COMMANDS (`crates/kwdj/src/registry.rs:18`–27), so the additional marker must enter that same registry/digest/catalog authority; do not advertise an ID absent from compiled handlers. Notes catalogs stay unchanged.

Old15 command payloads, canonical document/selection/history behaviors, old namespaced IDs and all persisted KWDJ schema1 semantics remain unchanged. Retain their independent vectors byte-exact as historical authority; add a versioned39 command/catalog supplement rather than rewriting their expected edit results. Exact current-catalog assertions of15 must explicitly move to the frozen16 inventory, not be weakened to `>=15`. Existing `contracts/sdk/v1/vectors.json` still declares command_total15; distinguish that historical corpus count from the newly shipped catalog. Tests with one extra runtime recipe become17, not16. New declarations widen the one KwdjIntentDto union; downstream exhaustive TS switches/Record maps may need a new branch even though old wire payloads remain valid. Older WASM correctly refuses the new payload/command; hosts feature-detect actual catalog, not infer support from a profile version.

No SDK1/SDK2 envelope ABI, common DTO count, codec ID/wire version or persisted document migration is proposed. The production source/build ID MUST change and be coherently regenerated/sealed/packaged; mixed old glue/WASM is rejected as before. Mandatory command change also changes registry/context digest; do not mutate an admitted old Session registry. A host extension that previously claimed this full command ID now conflicts with the mandatory owner and must fail existing duplicate-command rules, never be silently replaced. Primary must freeze/document this additive catalog/build compatibility explicitly before code.

## 7. Expected change locations (implementation only after freeze)

- `crates/kwdj/src/commands/mod.rs`: append native intent/catalog, explicit command_id branch preserving oldindices, route new planner. Proposed new helper module or narrow inline.rs planner shares metered point/range/metadata authority; generic engine stays profile-independent.
- `crates/kwdj-sdk/src/wire.rs:132` and `convert.rs:29`–90: closed empty-struct variant and exact native mapping. Old `crates/wasm/src/sdk_wire.rs` reexport path remains; no duplicated DTO definition.
- `packages/kwdj/src/index.ts:9`–24: add delete_backward -> delete-backward builder mapping, no semantic edits. Regenerate existing `packages/wasm/src/sdk-types.ts` through `crates/wasm/examples/sdk_types.rs`/`scripts/generate-sdk-types.mjs`; no manual type fork. Common SDK2 BridgeRequest remains unchanged.
- `crates/kwdj/src/registry.rs` auto-derived markers; native/WASM/provider/SDK1/SDK2 tests and exact catalog fixtures/inventory must cover base16, base+runtime17 and Notes unaffected. Existing factory/observer15 assertions and `tests/sdk-integration.node.mjs:98` need precise inventory updates, not weakened assertions. V2 compiled-ID checking stays exact.
- Versioned39 contract/oracles/newcatalog supplement, `docs/commands.md`, `docs/sdk-v1.md`/extension compatibility notes and ordinary build/provenance source bindings. Rebuild real production artifacts and verify actual packaged v1/v2 query/edit/history/events/maps after implementation; none has run for this proposal.

Existing refusal taxonomy is sufficient: selection-required, unsupported-context, lossy-transform at `/command`; core edit-position refusal `position.invalid` and existing stale/readonly/limit/profile/registry codes propagate unchanged. No new generic operation or raw SDK mutation endpoint is part of this proposal. Exact boundary diagnostic vectors should be frozen through their existing source authority before implementation; no arbitrary new path field is invented.
