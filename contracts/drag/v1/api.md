# OSR44 v1 — bounded composite topology/geometry API

Design decision selected by root before implementation on branch `osr-44`, baseline main `a21a7f8030afaeb4879fcbbd4953a7c76e098184`, tree `1f45d9a9e79006de2c3bd4abad58c98a5af1d004`. OSR43 is Done and OSR44 Refined/InProgress by the authorized start. Authority: architecture v2/master plan v3, original four OSR44 AC, and root-selected Refine contract. This version records the chosen API and work/ownership semantics; it is not runtime evidence or an acceptance claim. Existing42 contracts remain unchanged.

## Choice

| Approach | Consequence |
|---|---|
| **One composite `geometry.read({kind:'drag',…})` (selected)** | One guard/native-state checkpoint, one actual private-view measurement, one shared budget and one after-check. Produces consistent source/hit/explicit-parent facts without public node reads or retained DOM.|
| Additional `headers.read(ids)` plus existing geometry calls | Caller must join several timestamps/contexts, source/hit/ancestor membership and separate caps. Correct total accounting needs a transaction/budget handle or repeating all work. That creates a larger lifetime/API than this one consumer needs.|

Use the first. Do **not** implement it by invoking public `block`, `block_at_point` and header reads separately, resetting budgets, then claiming1024 total. Existing42 request variants and their exact output/error fields remain unchanged; no new work metadata is appended to old snapshots and no frozen42 acceptance is rewritten. Additive overload/new discriminant only.

## Exact additive DTO

Existing imports: `StampDto`, `SessionContextV2`, `DeepReadonly` from SDK; `CssRect`, `DomRefusal`, `SelectionReadFailure` from DOM. The request context uses `DeepReadonly<SessionContextV2>` so the existing immutable public `editor.context()` result is assignable without casting; this is a type-compatibility decision, not a change to the closed runtime fields. All shown properties are required; nullable fields are explicit. Objects are closed plain/null-prototype own-enumerable data, no getters/symbol keys; outputs recursively immutable. Node IDs are nonempty bounded strings (≤128 UTF16 units), coordinates finite CSS numbers, indexes safe nonnegative integers (not -0). The genuine root header has `typeId:""`, matching the existing bridge projection (`NodeViewDto.type_id = node.type_id().unwrap_or("")`); it is not assigned an invented profile type. Non-root type IDs are nonempty and bounded to128 UTF16 units. No IDs confer ownership by themselves.

```ts
export interface DragNodeHeader {
  readonly id: string;
  readonly typeId: string;
  readonly primitive: string;
  readonly parent: string | null;
  readonly index: number | null; // null only for genuine root
  readonly childCount: number;
}
export interface DragDestination {
  readonly placement: 'before' | 'after' | 'inside';
  readonly reference: string;   // real hit, or explicitly chosen parent for inside
  readonly parent: string;
  readonly before_index: number; // PRE-removal native child array
}
export interface DragBox {
  readonly rect: CssRect;
  readonly clip: CssRect;
}
export interface DragGeometryRequest {
  readonly kind: 'drag';
  readonly stamp: StampDto;
  readonly context: DeepReadonly<SessionContextV2>;
  readonly source: string;
  readonly point: Readonly<{x:number;y:number}> | null;
  readonly insideParent: string | null;
}
export interface DragGeometrySnapshot {
  readonly status: 'drag_measured';
  readonly stamp: DeepReadonly<StampDto>;
  readonly context: DeepReadonly<SessionContextV2>;
  readonly source: DragNodeHeader;
  readonly sourceBox: DragBox;
  readonly hit: DragNodeHeader | null;
  readonly insideParents: readonly DragNodeHeader[];
  readonly destination: DragDestination | null;
  readonly targetBox: DragBox | null;
  readonly viewport: CssRect;
  readonly work: Readonly<{
    objects:number; childSlots:number; ancestors:number; rects:number;
  }>;
}
export type DragGeometryRead =
  DragGeometrySnapshot | DomRefusal | SelectionReadFailure;
// GeometryRequest and GeometryRead below are the UNCHANGED old aliases.
export interface MountedGeometry {
  read(request: DragGeometryRequest): DragGeometryRead;
  read(request: GeometryRequest): GeometryRead;
  read(request: GeometryRequest | DragGeometryRequest):
    GeometryRead | DragGeometryRead;
}
```

`point:null` is the arm/source-only read; `insideParent` must then be null. It returns genuine source/sourceBox, empty `insideParents`, and null hit/destination/targetBox. No native selection is required to identify a source; the separate genuine host-request capture still requires the existing bookmark policy. The source must be a non-root text_block/container/block_atom with a genuine parent/index.

With a point, resolve the nearest actual owned structural hit, then its bounded native parent chain. `insideParents` lists only genuine root/container headers from hit itself outwards to root, without child arrays or schema availability claims. This lets UI render explicit parent choices; nearest text-block hit must never silently mean inside its parent. `insideParent:null` uses the upper quarter for container-before and lower quarter for container-after; its middle half returns a measured hit/insideParents/targetBox with `destination:null`, awaiting an explicit inside parent choice. Exact quarter boundaries belong to that middle half at25% and to after at75%. Non-container targets use the midpoint (before below50%, after from50%). This never silently converts the nearest child hit into its container. Non-null must equal hit-if-container or an actual member of that returned chain; it selects inside/append (`before_index=childCount`). The UI must bind the choice to its genuine labelled affordance, not read a DOM data-ID as authority. Ancestor membership does not imply schema allowance.

For before/after, `reference=hit.id`, `parent=hit.parent`, `before_index=hit.index` or `hit.index+1`; no same-parent forward adjustment. For inside, `reference=parent=insideParent`. Source may equal/contain the destination: geometry reports genuine facts; native query decides no-op/cycle/grammar/depth. Headers carry no `allowed` boolean.

An original owned browser hit can fall just outside its measured fractional rectangle when pointer coordinates use integer CSS pixels. If the rectangle has positive width/height, the point remains strictly inside the original viewport/clip, and each outside-axis distance is strictly less than1 CSS pixel, return a coherent **source-only transit**: genuine source/sourceBox, null hit/destination/targetBox and empty insideParents. All original hit ownership, explicit-parent membership, shared budgets and final revalidation still run. No coordinate or rectangle is changed and no parent/drop authority is granted. Exact1-pixel/farther discrepancies, zero-width/height rectangles, clipped or foreign hits still refuse. An exactly contained point retains the original quarter/midpoint policy. DG17 freezes this correction after the archived original WebKit border discrepancy and before corrected-candidate execution; earlier expectations remain unchanged.

`targetBox` is the actual hit box for before/after, or selected parent's actual box for inside. It is geometry, not an insertion-capability or caret. UI computes the visible labelled line/endpoint according to the versioned spatial policy and verifies **full** endpoint clipping at release. `visible` is deliberately absent:42's any-fragment flag is insufficient. New branch supports one finite nonzero-height rectangular fragment per measured box; fragmented/unsupported paths refuse rather than union an invisible gap. Old42 multi-rect behavior stays intact.

## One coherent private-view read and total accounting

1. Use the existing pure mounted geometry guard (read-only/disabled reads remain allowed; UI separately refuses drag admission). Strictly own the new request, capture current host/view/stamp/context, compare all5 stamp tokens and full immutable session context (build/profile/registry/capability). One existing native `state` read validates native stamp; preserve any native refused/fatal/error as the original `sdk_failure.response`, never translate it into a guessed geometry code.
2. Use existing `view.geometryRow`, `geometryOwner`, `geometryStamp`: they expose **references to cached authoritative rows**, not SDK `read({kind:'node'})` clones. Fetch compact scalar fields directly; never spread/clone NodeView, children, text, marks, attrs or stats. Map lookup IDs are verified against actual outer/content/wrapper/text objects and parent-child membership. Same-ID clones, stale detached rows, replaced views, wrong document/host and foreign overlay never acquire authority.
3. A **single measurement** serves source, hit walk, source/hit ancestors, explicit-parent choice, relevant owned subtree checks, clipping, all rects and final revalidation. Source+hit+selected-parent cannot each receive1024/256/128. Reuse bounded private measurement/style helpers only if they preserve this total; old public reads are not subroutines. No whole root traversal or native tree copy.
4. Shared sets: all distinct inspected DOM objects (including inspected ancestors) count in `objects`; native cached child-array positions inspected for ordinal discovery count in `childSlots` by `(parentID,index)`. Require `objects+childSlots <=1024`, `ancestors <=128` distinct **all** ancestor elements (including nonclipping), `rects <=256` raw rects including clip crops. Charge before access/iteration; `.children.indexOf(...)` or `.map/filter/spread` over unbounded children is forbidden in this branch. A bounded incremental search plus actual `content.childNodes[index]===child.outer`, matching parent IDs/counts and actual row-map identity establishes the ordinal. ChildCount itself is a scalar length, not an enumerated copy. Admission already guarantees unique native child IDs; the geometry read does not reconstruct grammar.
5. Before measuring selected boxes, bound actual ownership/presentation walks with that same object budget; atoms stay opaque per existing renderer contract. Large nested rows or a source near the end of a huge sibling list may refuse before the limit; no blanket large-document/O(1) promise. Text/schema validation remains native; existing bounded DOM correspondence checks may compare cached text to its actual owned text object but do not serialize it into this result. This node/object cap does not claim a novel native string-byte or layout-time SLA.
6. Final revalidation uses the same cached witnesses/counters, not a reset measurement. Recheck authoritative row objects, parent membership/ordinal, connected host, view identity, full current capture/context and mounted guard before return. No callbacks between successful final check and result construction; no external profile factory runs inside the DOM measurement. Temporary ranges/styles/sets die at return; no listeners, retained leases, focus, selection writes, mutation, scrolling or resource handles are created by the read. Layout timing itself is browser work, not certified O(1).

Budget exhaustion on the **new kind only**: `dom.selection_limit`, phase `geometry`, publication `none`. Invalid closed options: `dom.invalid_options`; full stamp/context changed: `dom.stale_selection`; unsupported/foreign/detached/unmeasurable geometry: `dom.selection_geometry_unsupported`. Existing lifecycle/composition/busy/native-failure precedence and original diagnostics remain. No new DomCode is necessary. A well-formed but nonmember insideParent is unsupported geometry, never a fallback to a different parent. Native unavailable semantics are obtained later from `query_command`, not these DOM failures.

## Optional profile factory

Use the selected name `UiProfile.drag.move`; name the function type `UiDragFactory`. No new state/catalog callback or semantic payload interpreter in generic UI:

```ts
export interface UiDragContext {
  readonly context: DeepReadonly<SessionContextV2>;
  readonly stamp: DeepReadonly<StampDto>;
  readonly source: DragNodeHeader;
}
export type UiDragFactory = (
  captured: UiDragContext,
  destination: DragDestination
) => CommandDto | UiUnavailable;
export interface UiDragProfile { readonly move: UiDragFactory }
// UiProfile adds: readonly drag?: UiDragProfile;
```

Do **not** pass full `UiActionContext`/`StateDto` or catalog: Move construction needs source/parent/index, while stored marks, attrs, entire child lists and fresh query catalogs add copying without authority. `StateDto` is consumed internally only for the native stamp read, not exported as a drag fact. A source node ID may differ from the text-selection block; don't set selection to manufacture context. The genuine mounted request owns original bookmark/selection intent, separate from this pure measurement. Profiles needing more semantic data must obtain a separately versioned bounded public contract; the factory cannot ask generic UI to import KWDJ.

KWDJ factory returns the existing Move DTO from the two arguments. The independent profile constructs its own command by the same public extension API, or returns its typed `UiUnavailable`; generic UI knows neither command ID nor KWDJ schema. Existing `moves(c)` and optional43 slash remain unchanged; no drag factory means explicit unavailable handle and fully retained keyboard path, not44 KWDJ acceptance.

The controller passes owned immutable copies of the compact context/destination to synchronous factory, catches throw as `ui.callback_failed`, validates the returned closed `CommandDto|UiUnavailable`, then rechecks original genuine lease, source identity, full stamp/context, pointer/gesture and UI lifetime **after the callback and after native query**. Reentrant edits/selection/mode/replace/dispose invalidate; a later click cannot recapture. Native query evaluates exactly those command bytes; one terminal completion consumes original host request with `focus:'none'`/isolated history and preserves original Submission. No callback permits, new pump, queue, normalization or focus callback are added. Geometry facts are not reusable authority at drop: rerun this composite read and exact token/lease checks, retaining original request identity.

## Source implementation correction before browser execution

DG15 was independently authored from the final-witness rule before any44 browser output: a controlled final `getClientRects` hook detaches its genuine source while returning the prior rectangle. Source inspection found that an ownership sweep performed only before those last geometry reads could miss this change. The implementation therefore performs an ownership-only sweep again after final style/crop/fragment/viewport reads, using the SAME sets/counters and no extra rectangle read or cap reset; outer full view/stamp/context/guard checks still follow. This is a source-detected correction, not a claimed reproduced runtime failure or test pass.

## Source anchors and boundary checks

- `packages/dom/src/types.ts159–174`: current3 geometry kinds and old snapshot; new discriminant avoids changing their bytes.
- `packages/dom/src/view.ts20–39,205–215`: private row witnesses are cached native views with actual-object ownership; no new native header protocol is needed.
- `packages/dom/src/geometry.ts`: current guard/readState/token/clip machinery; existing ordinal `indexOf` must not be called without bounded charging in the new branch. Current block walk can hit caps and does not certify arbitrary huge containers.
- `packages/ui/src/types.ts10–36`: current large UiActionContext vs new compact context; required directional moves, optional slash.
- `packages/ui/src/ui.ts275–320`: old snapshot performs native NodeView reads; **not** the drag-motion path. `host-request.ts` remains sole mutation/bookmark authority.

No genuine new native capability blocker found. The bounded private branch can use current authoritative cached rows; it must not pretend one public old geometry read plus an unbounded header lookup is a coherent1024-object measurement. This API was selected before candidate implementation. Its source pins below identify the baseline, not a verified runtime distribution. Old42 contract bytes and behavior stay unchanged.

| Source | Bytes | SHA256 |
|---|---:|---|
| `packages/dom/src/types.ts` | 15223 | `ea3275c48aa31b7f5b601b659848b6097a8b46f71e2521d89ef4a91bae533e72` |
| `packages/dom/src/view.ts` | 49573 | `4907ae81793b60be73a6bfcfe689a37c237fe6585866b41f04b9bbfcb24741db` |
| `packages/dom/src/geometry.ts` | 19244 | `2c826c6ad6e9b2016fb789754f74b99c4e8e5b63abad938268b9502bf0d838ca` |
| `packages/dom/src/host-request.ts` | 13501 | `24b81b004da775ae43d380156ef938afaadf5224d2c0ecd6dda434e1c4c2669a` |
| `packages/ui/src/types.ts` | 3371 | `045c423b888ea1e59413593f51cdf67aeb61e38980642e563c0f19e5544711e7` |
| `packages/ui/src/ui.ts` | 57548 | `f83238c640ad131ac49bac1f31cfcc278716e2a96a0f4591f133bbcbf9a62c48` |
| `packages/ui/src/slash-profile.ts` | 2074 | `573007ec16969bfc35c768a94ac3d851b9e28284ab3d73801b89a3df501ceff5` |
