# OSR-40 mounted selection API and dataflow — source-only proposal

2026-10-19. Root reports OSR-39 fully closed (26/55 Done), main `ff2bd3103eba9b47cd2a06098d1506d9a054a589`; OSR-40 is in Refine/Backlog with **no source start**. This is an unaccepted proposal, not Ready, a frozen contract, source implementation or formal review. Inputs: `/tmp/osr-40-selection-contract-draft.md` and `/tmp/osr-40-contract-preflight-notes.md`; their observations are inputs, their API/geometry choices were not accepted. No repo/fixture/Linear/Git/runtime/browser/native/test/CI mutations or executions were performed.

## 1. Smallest ownership arrangement

Keep exactly one private SDK2 controller, its native Session and its event pump inside MountedOwner. Add one per-mount selection owner shared by input, view restoration and edge scrolling; do not leave the old input selection publisher running beside a new controller. The existing first internal renderer subscription still patches once per actual event. The selection owner receives the same event during that publication boundary, then makes/defers the corresponding native DOM range; no second SDK subscription pump or public journal is needed.

Current seams: `packages/dom/src/mounted.ts:19` owns controller/view/input; `:119` defines busy including forwarding/delivery/native pending tickets; `:176` registers the first renderer listener; `:184` constructs input; `:219` publishes native events; `:242` forwards original Submission; `:288` performs explicit replacement and `:350` disposal. Internal `view.readSelection/domPoint/restoreSelection` exist (`packages/dom/src/view.ts:168`, `:196`, `:213`, `:239`). Input's current syncSelection and narrow Tab recovery are `packages/dom/src/input.ts:37`, `:219`; neither is a separate future authority.

The new owner keeps only bounded correspondence/provenance: current model selection/stamp, current event sequence, gesture/intent serial, focused-owner serial, active pointer/RAF, a small bookmark table and at most one restore continuation. It uses guarded shallow reads, native `map_position`, native `set_selection` and native events. It never holds a semantic document, persistent DOM paths, native maps, segmentation tables or canonical exports per tick.

## 2. Proposed public surface and outcomes

Recommendation: add `readonly selection: MountedSelectionController` to MountedEditor. Keep existing capture/read/query/submit/subscribe signatures and native Submission semantics. Exactly three new selection methods suffice:

```ts
interface SelectionBookmark {
  readonly selection: DeepReadonly<SelectionDto> | null;
  readonly stamp: DeepReadonly<StampDto>;
  readonly context: DeepReadonly<SessionContextV2>;
  readonly __selectionBookmark: unique symbol;
}
interface MountedSelectionController {
  captureBookmark(): BookmarkCapture;
  restoreBookmark(bookmark: SelectionBookmark,
    options?: { readonly policy?: 'exact' | 'mapped'; readonly focus?: boolean }): BookmarkRestore;
  releaseBookmark(bookmark: SelectionBookmark): boolean;
}
type SelectionReadFailure = { readonly status: 'sdk_failure'; readonly response: Response };
type BookmarkCapture = { readonly status: 'captured'; readonly bookmark: SelectionBookmark }
  | DomRefusal | SelectionReadFailure;
type BookmarkRestore = MountedSubmission | SelectionReadFailure;
```

`captureBookmark` captures current **model** selection without publication. Synchronization of an actual pending DOM range is a separate **internal** input stage, `syncFromDom`; it uses the existing native set_selection and returns its original outcome. It is not implicit work in capture and needs no extra public method. Host code can already read current model selection via mounted.read(state). A capture that cannot establish correspondence refuses selection_unsynchronized rather than secretly flushing a browser range.

restoreBookmark returns the **original** native SDK Submission for its one actual set_selection. A completed native failure stays that completed Submission; native map/read failures before submission are exposed as sdk_failure with the original response. No invented completed mutation is made from a read. Busy/reentrant calls refuse **before** dispatch; there is no automatic wait/retry queue. An unexpected actual queued Submission is retained and returned unchanged, its real completion observed once; never claim cancellation or resubmit it. One bounded private continuation handles DOM/focus after that completion, without a public second ticket or event pump.

The returned Submission certifies native execution, not that a later focus transfer was applied. UI follow-up rechecks state/intent/focus ownership. On failure after a native publication, report the separate DOM refusal through existing onRefusal with publication=alreadyPublished (or unknown when the actual native fatal says so), enter existing recovery if required, and **still preserve the original Submission**. A subscriber-induced newer selection merely makes the old focus follow-up stale; it cannot be overwritten. onRefusal throwing cannot change publication truth or skip cleanup. This follows39's existing render-failure boundary rather than introducing a new restore-result wrapper.

Use a private per-mount WeakMap capability registration plus a bounded strong table of **64 live bookmarks**. Object shape, copied visible brand, serialization and a foreign mount do not grant authority. Bookmarks are frozen; no native/DOM mutable objects escape. Capture65 refuses before retention. release is idempotent (false for foreign/already released), drops retained data, and invalidates the handle. Busy or preflight refusal does not consume a valid handle, allowing an explicit mapped retry after an exact-stamp refusal. At final actual dispatch the handle is consumed once; reentrant/late completion cannot dispatch it twice. That restore is a new explicit target intent even if native selection is a no-op. Replacement/destroy invalidates all handles.

Keep one restore continuation, one owned pointer and one RAF per mount. Proposed resources extension: retain resources().dom's existing five fields/exact disposal shape; add a **sibling** resources().selection object `{bookmarks,restoreTickets,activePointers,animationFrames}` in the40 contract. Include listeners/continuations in existing aggregate counts too. This keeps the public selection surface at three methods while making retained ownership testable; native resource counters are unchanged.

Proposed new DOM refusal codes: `dom.invalid_bookmark`, `dom.stale_selection`, `dom.selection_unsynchronized`, `dom.selection_missing`, `dom.selection_limit`, with diagnostic phase `selection`; existing lifecycle/mode/busy/composition codes remain. They are DOM diagnostics, never fabricated SdkResponse code/path/category. Freeze exact additions before literals under the explicit40 public-type version below.

## 3. Capture, null and coordinate contract

captureBookmark is **read-only model capture**, not “flush browser selection”. It reads the current native state and context. It may inspect the current owned browser range to ensure there is no uncommitted mismatch; if an owned range is pending/mismatched, return selection_unsynchronized, with no secret set_selection. If a host control has focus, capture still refers to the current model selection, not that control's DOM range. Loading/disposed/recovery, busy, provisional/composing or disabled interaction refuses as appropriate; readOnly may capture/restore/select but never gains edit permission.

`selection:null` is a legitimate captured absence. Exact, focus=false restoration can submit native null and clear only this mount's browser range through its publication boundary. It must never pick the first paragraph or collapse to a guessed position. A request to focus a null bookmark returns selection_missing before dispatch; mapped null with a changed stamp also refuses (there are no endpoints to map). Identical null restoration is subject to native no-op rules, not a synthesized state event.

Actual `PositionDto.text.offset` is a checked u32 **UTF-16 code-unit count**, never a scalar index. Validate finite integer/range/scalar boundary; refuse a point inside a surrogate pair without rounding, scalar-index conversion or U+FFFD replacement. Scalar-readable offset1 in `e\u0301` does not authorize an EGC edit. Rust/profile commands own EGC admission across adjacent styled text; inline atoms/hard_break reset the sequence. `Intl.Segmenter` is not production authority.

Newly observed owned Text/Child DOM endpoints use explicit affinity=`after`, matching39. If the exact same owned DOM object+offset is already known from current native correspondence, retain its known affinity. Newly inferred points have no hidden before affinity; reversed direction and RTL do not change this rule. Edge side is before/after the structural node, not a text affinity. API-restored/map-returned native points retain their explicit affinities. Intent detection must still occur when a user reselects the same coordinates; retaining affinity does not mean the action was not new intent.

## 4. Intent serial, epoch and map provenance

selection_epoch is a native optimistic token, not a user-intent clock: document remapping may change it, and a user can select the same endpoints without changing it. Use a monotonic checked per-mount intent serial plus native stamp/context. On counter exhaustion refuse/cancel pending work rather than wrap. No serial is exported as a document revision or written into persisted JSON.

| Observation | Intent/certificate action | Bookmark consequence |
|---|---|---|
| Owned pointerdown / navigation or selection key / Select All / beforeinput | Advance intent serial before possible native no-op; one serial per gesture, not per self-produced frame | Earlier pending restores stale even if native endpoints are unchanged |
| Explicit host set_selection (including identical/null), explicit history navigation | Advance intent serial; guard current generation | Old bookmark cannot overwrite this newer target |
| Own selection publisher / own range setter's correlated selectionchange | Do not count as new user intent; match actual endpoints/write serial | No feedback loop or false invalidation; still obey native epochs |
| A proven native document event, no intervening input/host target intent | Advance only bounded document-continuity certificate | Exact stamp stale; explicitly mapped restoration may remain eligible |
| State-only selection/stored-marks/history change not correlated to an owned action; unknown event origin/gap or out-of-order boundary | Advance intent serial as conservative invalidation and reset continuity | Explicit mapped policy also refuses; do not infer permission from a plausible point |
| Focus leaves for a control without changing document target | Preserve model bookmark; advance separate focus-owner serial where needed | No automatic global range restoration while outside; explicit return can transfer focus |
| New document selection in this/another mount, composition/provisional start, replacement/destroy/recovery | Advance/invalidate intent or generation/availability; cancel active drag | No stale asynchronous restoration or focus stealing |

The certificate is constant-size: last observed native revision/stamp/event sequence and validity, not a TS map-chain journal. Every uncertain continuity invalidation also advances the checked intent serial; a later fresh capture can establish a new baseline without revalidating older handles. The serial is an invalidation token, not a claim that every increment was a user action. Native map_position composes every retained native map. Known direct host **document-only** updates can keep it valid; real typing/navigation, explicit set_selection/history and unknown/reentrant provenance invalidate it. A host command is not automatically evidence of “document-only”: the owner must identify its originating intent and publication, or invalidate. Do not infer this classification solely from event.selection_after, revision changes or equality of mapped points. The conservative initial implementation may refuse mapped restoration after an unclassified queued/reentrant event rather than implement a general provenance system.

Restore default is `{policy:'exact',focus:false}`:

1. Verify branded handle ownership/live table, lifecycle/mode/provisional/busy, same session/generation/build/profile/registry/capability context and unchanged captured intent. Copy only bounded two-endpoint data.
2. Exact requires full captured stamp equality. Mapped requires the valid continuity certificate and both original points mapped by native from bookmark revision to the **same current stamp**. Only status=mapped, deleted=false and non-null positions qualify. Deleted fallback, stale/invalid, missing chain, changed context or uncertain origin returns stale_selection; never guess nearest text/gap. Read failure retains original native response.
3. Preflight both current DOM targets using owned-object correspondence before publication. Re-read current native stamp/context/intent/focus serial and compare after mapping. From final check through one SDK set_selection there is no await or host callback. Native full-stamp checking remains final authority. No stored marks/history values are copied from the bookmark.
4. Consume this handle at actual dispatch and advance the owned intent serial for this explicit restoration, even on a native no-op. Keep the actual returned SDK Submission. Before UI/focus follow-up check original terminal response, current stamp/selection/context and intent again. Another subscriber may have queued a new command during delivery; never restore the old DOM range over it. A requested focus transfer requires its captured focus-owner serial still current. Failure here is a separate DOM refusal/callback with truthful publication provenance, not retroactive native refusal.
5. focus=false preserves external focus/range; if another control/mount owns focus, defer DOM selection until explicit owned return. focus=true is the caller's immediate explicit transfer request, not permission for a late callback to steal newer focus. After focus(), synchronous focus handlers may change intent/state: recheck before setting the range. Keep the current native selection on ordinary Tab return; do not revive an older bookmark automatically.

The existing view's unconditional final range restoration must become an owner decision during40, using its same internal DOM mapping/setter. This avoids a new publisher competing with it and prevents background document events from overwriting a focused host control. Full document patch still occurs once; selection realization may be deferred. Existing39 provisional preservation/early empty-block relocation remain required and must not be disabled to make a new bookmark test pass.

## 5. Native side effects, not UI assumptions

Native non-null set_selection validates first, no-ops on identical selection, otherwise clears stored_marks, plans a history barrier and publishes selection state (`crates/engine/src/session.rs:485`). Null uses the existing guarded raw empty transaction (`crates/bridge/src/lib.rs:587`); raw selection changes inherit native typing-reset/history rules (`crates/engine/src/dispatch.rs:741`). Therefore:

- Selection interaction leaves canonical bytes, authored IDs, document revision, dirty and undo/redo **entry counts** unchanged.
- selection_epoch, stored_marks, state events and history_epoch are asserted exactly as native specifies, including sealing an open typing group without a new undo entry. Do not demand all history facets stay equal.
- Add a stored-marks + open typing-group control and identical-range/null no-op controls before implementation. Capture/map/query/failed preflight are pure. No JS restoration of old marks, manual barrier, synthetic history entry or duplicate state publication.
- Focus-only return when current native endpoints are unchanged preserves the entire native stamp/history/marks. Intent serial can still change on a new user targeting action even when native stamp is unchanged.

## 6. One pointer/scroll lifecycle; no second layout engine

Proposed internal states: idle → ownedDrag → edgeHold → ownedDrag/idle; separate suspended/unavailable state for provisional, busy/recovery, replacement and disposal. Capture at most one primary pointer originating in this host; freeze supported button/modifiers. Record anchor model+owned DOM correspondence and intent once. Do not capture a pointer that began in another control, native scrollbar or mount. Pointer capture policy is explicit and tested; lostpointercapture is a cancellation stimulus, not assumed proof of native pointercancel.

One RAF runs only during owned held edge selection. Each tick rechecks pointer buttons/ownership, mount/context, lifecycle/mode, active focus and no conflicting input. Compute the effective visible clip from actual viewport/visualViewport, supported scrollport and clipping ancestors. Freeze a finite ancestor/scroll-owner bound; unsupported transforms/geometry refuse rather than walking an unbounded tree. Use browser hit testing/native visual selection for the focus endpoint; if needed project the held point to the effective edge inset and extend native Selection while retaining the actual anchor. This is DOM correspondence, not Unicode segmentation or native edit semantics. Invalid scalar/foreign hit points are not rounded. Skip a DOM setter when the actual range is already exact.

Publish the resulting owned selection through the same selection publisher at most once per scheduled frame/current stamp; avoid a second selectionchange loop. Native document mutation during a drag cancels or explicitly invalidates the gesture; a stale pointer must not force old endpoints back after normalization. No canonical snapshot, whole-document walk, native map reconstruction or second SDK per tick.

pointerup/cancel, lost capture, window blur, new external pointer/focus owner, disabled mode, provisional/composition, replacement, recovery and destroy cancel the controller RAF and pointer ownership immediately. Do not fake input delivery to release an unowned desktop pointer. A final UA selectionchange may be observed and synchronized under the normal owned guards; settlement is not a license to keep scrolling after release. ReadOnly may select/scroll/copy. Disabled blocks this controller's editing focus/interaction; it does not promise to suppress static browser selection/Find.

## 7. Feasible independently authored edge fixture

Use the proposed64 visual rows ×24px, viewport1024×768/zoom100, source-bound loaded font16px/line-height24, no border/margins/transforms/smooth scrolling/overlays. **Add fixture-only top padding20 and bottom padding40.** Scrollport x100/y80/w640/h240; clipped variant intersects ancestor x96/y100/w648/h180, giving effective y100..280. Content height1596, maxScroll1356. R00 at min is y100..124; R63 at max is y256..280: full24px row envelopes can fit. This corrects the infeasible unpadded proposal; actual caret geometry still must be measured.

Authored tree roles, before candidate: R00…R15 paragraphs; R16 scene_break; R17…R23 paragraphs; one quote containing bullet-list items with paragraph rows R24…R31; then paragraphs R32…R63. Every text row is the three literal characters `Rnn`, no wrapping; containers have zero fixture margin/padding and contribute no extra visual row. Native root has57 top-level children, not64. Its stable roles and a separate rendered-DOM table are authored independently:

| Gesture | Initial model anchor and independent native DOM anchor | Terminal model focus and independent native DOM focus |
|---|---|---|
| Down | Text(role R04, UTF16=1, after); literal Text(`R04`),offset1; model path /4/0 | Text(role R63, UTF16=3, after); literal Text(`R63`),offset3; model path /56/0 |
| Up | Text(role R59, UTF16=2, after); literal Text(`R59`),offset2; model path /52/0 | Text(role R00, UTF16=0, after); literal Text(`R00`),offset0; model path /0/0 |

New pointer-derived focus affinity is after in both directions. Before-affinity retention/mapping belongs separate known-affinity literals; it cannot be inferred from an upward drag. Resolve process-opaque IDs through authored roles once; resolve actual DOM Text objects through the independent literal DOM structure, never production mapper output. Assertions compare both complete endpoint tables, selected structural membership and invariant anchor throughout.

**Initial setup scroll is permitted only before pointerdown and the first saved checkpoint:** down minScroll0, up maxScroll1356. R59 initially lies y160..184. Setup can establish the authored initial native/model selection. Bounded fixture-only caret/text geometry may determine initial hit coordinates and viewport→screen conversion; it cannot derive expected semantic endpoints. After gesture begins there is no wheel/direct scrollTop/scrollIntoView/reselection assistance; no late injection of the expected point.

Terminal oracle: hold at predeclared x and outside top/bottom target, cross atom+nesting, reach exact terminal model and DOM endpoint before a frozen deadline. Check finite positive-height collapsed focus caret rect (zero width valid), **all four edges** within viewport ∩ scrollport ∩ every relevant clipping ancestor, proposed≤0.5 CSSpx rounding tolerance. Partial intersection, union/highlight rect, last visible row or scrollTop alone fails. Missing geometry blocks measurement. Record actual geometry/buttons/heldMs and bounded selection/scroll publications, not only endpoints or an overlay.

Keep terminal/release and active-release/cancel distinct. Active cancellation must occur with scroll range remaining, and post-cancel selection/scroll positions remain exactly at their validated cancellation checkpoint, with no RAF/capture left. That dynamic stop invariant is not falsely called a preauthored intermediate endpoint oracle; the independent exact endpoints come from terminal cases, and deterministic controller unit schedules can separately freeze intermediate points. Do not require a coarse100ms poll to land on an arbitrary intermediate row. Freeze hold/cadence/deadline, one passive settlement-frame allowance and five100ms stop samples before code. No new product scroll-speed SLA.

## 8. Compatibility, evidence and remaining bounded decisions

The39 manifest is `contracts/dom/v1/manifest.json`:60 contract-file pins plus external publicTypes `packages/dom/src/types.ts` (6,208 B, SHA8ec05a6e8d3804d9fc9d8c466478adfc60bad2d8860e21e3efb16a274bd2e033). Keep all frozen39 contract bytes/expected literals and that **historical public-types snapshot** intact. Current source is allowed to evolve only under an explicit40 additive contract; do not recompute the old manifest to bless it or claim its old pin still matches the new file.

Recommended versioning: new `contracts/selection/v1/` API/oracles/manifest, with an exact byte copy of the old public-types snapshot under its legacy proof section plus the old pin/source identity and new40 public-type pins. Add readonly selection, proposed DOM codes/phase and new types in the live public surface; document those additions explicitly. Keep every old method/diagnostic shape and code behavior, raw39 expected documents and API assertions. Source and generated declarations naturally change; historical39 pins are not relabelled current. If root instead requires live types.ts byte-exact, use a separate exported getter/extended return type, but that adds indirection; it is not necessary for honest versioned evolution.

Actual source tests: `tests/dom-workspace-browser.spec.js:180` compares whole before/after resources; `:182` requires the exact five-field disposed resources.dom zero object; `:219`-era assertions retain39 semantics. `spikes/workspace/dom-host.js:106` uses native selection submissions; its checkpoint helper exports canonical bytes only at explicit test checkpoints. Existing39 tests do not automatically reinterpret the old manifest as a new40 contract. Do not relax configured assertions or replace literal expected data. New manifest integrity should bind both the preserved39 proof and new40 data before runtime.

Native physical drag is a **separate bounded fixture plan**, not an API implementation here. Existing Safari broker is key-only and cannot prove native pointercancel or mouse support merely by reuse (`scripts/dom-native/safari-adapter.mjs:40`). Extend only explicit fixture-owned bounded gestures with fresh nonce/URL/title/mount and exact foreground guards, known button ownership, actual delivery/unknown completion and narrow cleanup. No general desktop RPC, no Apple Events after Safari bootstrap/physical input, no replay after uncertain delivery. Controlled pointercancel/lostcapture/blur tests must be labelled separately; do not promise a physical pointercancel lane unless a real supported stimulus exists. Installed Chrome/Safari EN/RU and automated Chromium/WebKit are distinct evidence. Firefox experimental cannot waive configured assertions, mandatory local failures or missing instrumentation; its applicable40 disposition is a fresh contract decision.

Minimum40 UX feedback: distinguish focus from selection, retain labelled one-host semantics, expose a persistent stale/refusal status with exact “The selection changed. Select the text again.” / “Выделение изменилось. Выберите текст снова.”, and do not steal focus on refusal. Minimal generic labels/status are not full UI/i18n66, AT69 or custom bidi. Root separately proposes a narrow native selected-text query and DeleteSelection command17; their exact payload/projection/oracles belong the native-helper freeze, not a TS semantic slice. This controller supplies the captured stamp/intent and current validated range, not JS clipboard semantics. Full IME41, toolbar42, external clipboard pipeline47 and virtualization46 stay separate while their safety seams remain valid.

Primary decisions before implementation: accept public spelling/original-Submission outcomes and64/1 bounds; freeze exact DOM diagnostic additions/versioning; freeze which native publications prove document-only continuity (unknown refuses); accept feasible padded geometry/endpoint/hold/cancel oracles and native evidence scope. No floor/policy/OSR-38 campaign is altered or resumed.
