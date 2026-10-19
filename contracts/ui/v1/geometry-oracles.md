# OSR-42 geometry contract and independently authored acceptance01

SOURCE AUTHORING before candidate/freeze. No implementation, runtime measurement, test/browser/OS action, status/API/repository mutation or acceptance is asserted. Basis: clean main `857f8cb7b27bb2b0ed36d99780fb19911dcff1cf`, tree `c701ffcdec8661865a0f7e0ef699e5b470ffd6e0`; same source tree as accepted41. Exact source ledger `/tmp/osr-42-geometry-source-pins-01.json`, SHA256 `15f39e54155fb9371199b7df1d18dbd216e524653b20d1a4c2f9733203ccf6cf`:14 committed files independently byte/mode checked,33 read-only Git commands actual0, tracked source clean before/after. This table authors new42 expectations; it changes no frozen39/40/41 geometry/input oracle.

## Exact public signatures

Unchanged from API alignment01/clean-main refresh02. SDK supplies DeepReadonly/StampDto/SessionContextV2/SelectionDto; DOM supplies DomRefusal/SelectionReadFailure. MountedEditor already has capture()/context(); geometry is additive.

```ts
type CssRect = Readonly<{x:number;y:number;width:number;height:number}>;
type GeometryRequest =
 | {readonly kind:'block';readonly stamp:StampDto;readonly node:string}
 | {readonly kind:'block_at_point';readonly stamp:StampDto;readonly x:number;readonly y:number}
 | {readonly kind:'selection';readonly stamp:StampDto};
interface GeometrySnapshot {
 readonly status:'measured';readonly stamp:DeepReadonly<StampDto>;
 readonly context:DeepReadonly<SessionContextV2>;
 readonly target:Readonly<{kind:'block';node:string}>
   | Readonly<{kind:'selection';selection:DeepReadonly<SelectionDto>}>;
 readonly rects:readonly CssRect[];
 readonly anchor:CssRect|null;readonly focus:CssRect|null;
 readonly clip:CssRect;readonly viewport:CssRect;readonly visible:boolean;
}
type GeometryRead = GeometrySnapshot|DomRefusal|SelectionReadFailure;
interface MountedGeometry {read(request:GeometryRequest):GeometryRead}
// MountedEditor adds readonly geometry:MountedGeometry.
```

No Node/Range/HTMLElement handle or action capability leaves this API. Geometry never authorizes command execution. Native state/node read refusal/fatal is `{status:'sdk_failure',response:ORIGINAL_Response}`; do not replace it with a DOM geometry code. Native fatal lifecycle reflection remains normal mounted read behavior, not a successful measurement.

## Resolution and finite rules to freeze

Current implementation is createDomView/DomView, not an exported ViewOwner class. Private Row owns view/outer/content/wrappers/text; rows maps native IDs and authority is WeakMap<Node,string>. Explicit block targets admit ONLY native text_block/container/block_atom primitives, using their genuine attached outer object. Root/text/hard_break/inline_atom are not explicit block targets. block_at_point uses the actual browser hit and nearest eligible owned ancestor on that hit's current path; it does not fall through a foreign overlay or guess a nearby block. A paragraph inside a quote resolves P; quote padding resolves quote; scene HR resolves its block_atom. Current ownedBlockAt only returns text_block and must not be reused unchanged for this API. domPoint needs additional actual attachment/correspondence checks.

Coordinates/rectangles are actual CSS client coordinates. Preserve UA fragment order/values, no LTR/RTL sorting or guessed glyph boxes. Block anchor is first usable actual outer.getClientRects rectangle, focus null. Selection measures CURRENT native directed selection through temporary ranges/private domPoint, never current browser Selection as authority. Anchor/focus use corresponding actual collapsed-range rectangles; empty/ambiguous/nonfinite endpoint is null, never fabricated. Selection without usable anchor refuses; missing focus alone may still be measured. A zero-width positive-height actual caret is usable. Return no successful unbounded/partial snapshot.

`visible` means ANY positive-height actual fragment/caret intersects effective clip, not all endpoints visible. For width>0 require positive X/Y intersection; zero-width caret requires X within clip and positive Y intersection. Use range rects plus nonnull anchor/focus; empty clip is not visible. rects remain original unclipped data; clip is separately the axis-aware ancestor intersection with visual/layout viewport. Thus partially or fully clipped measurable blocks can return measured/visible true or false respectively. No usable actual anchor/rectangle => geometry_unsupported.

Selection with heterogeneous clipping chains REFUSES rather than claiming one clip represents multiple scrollers. Inspect actually selected owned DOM objects, including intervening rows; endpoint checks alone are insufficient. Technical caps:1024 distinct visited selected objects,128 distinct inspected ancestor objects (including nonclipping ancestors),256 raw measured rectangles including endpoint lists. Count/check BEFORE copying/descending; count repeated same object once, count every raw rectangle before any filtering. Limit+1 refuses, never truncates or raises a success flag. Bound traversal to the selected actual interval, not whole-host serialization; atom internals remain opaque owned presentation. These are pre-candidate engineering limits, not browser performance claims.

Conservative unsupported geometry: iframe embedding; non-none transforms/perspective/clip-path/mask; CSS zoom other than1/normal; non-horizontal-tb writing; rounded clipping that cannot be represented by one rectangle; nonfinite derived edges. Browser page zoom/visual-viewport changes remain CSS-client measurement and are not CSS zoom. Existing selection-geometry.ts32-ancestor pointer behavior is frozen40 history; implement new bounds without changing that path.

Refusal precedence: lifecycle (loading not_ready; recoveryRequired recovery_required; disposing/destroyed/fatal disposed), then active commit/replace/SDK pending/delivery busy, then protected composition, then closed request-shape validation, then full current five-field stamp/context continuity, then native read outcome and actual geometry/identity/limits. ReadOnly/disabled/native-read-only do NOT block measurement. Every DOM refusal below uses status dom_refused, phase geometry, publication none, current stamp or null when unavailable; node is explicit requested native ID when applicable. No onRefusal callback is invoked by this pure read. Malformed options never enter native dispatch.

## Independently authored fixtures and result table

Roles bind bijectively to actual native initial IDs, never DOM IDs. Profile-backed fixture F: ROOT[P(T='A😀e\u0301אב'),Q[P2(U='cd')],S,P3(V='ef')], Q=blockquote/container, S=scene_break/block_atom. Separate list fixture L=bullet_list/list_item/P; empty P fixture E; marks/hard_break from a separately authored supported KWDJ input. Seed strings/positions/DOM paths must be committed before candidate execution. Valid Unicode range T1→T5 (and reverse) includes full surrogate/grapheme spans. Static external fixture CSS/CSP determines layout; no candidate-learned pixel literal. Browser assertions compare underlying actual UA rectangles from independently authored object paths/ranges, not prior geometry.read output. Exact cap branches may use labelled controlled DOM-measurement faults on genuine mounted objects; they do not prove real-browser layout/native semantics.

| ID | Authored request/setup | Exact expected result |
|---|---|---|
| G01 | block(P), block(P2), valid current stamp, normal visible layout | measured target exact requested native ID; actual owned outer rectangles; block anchor actual, focus null, visible true. |
| G02 | block(Q), block(L), block(list_item), same setup | measured CONTAINER outer, not inner P; exact container ID and actual corresponding bounds. |
| G03 | block(S) | measured scene block_atom HR, no need for a Text child/caret; original separator/CE attributes unchanged. |
| G04 | block(ROOT/T/hard_break/inline_atom) | dom.selection_geometry_unsupported; no promotion to an implicit different target. |
| G05 | block_at_point in P2 text/mark/inline-atom label within P2; separately Q padding; separately S HR | measured target P2/Q/S respectively, by actual owned ancestry. Inline atom itself remains ineligible as block. |
| G06 | finite point over foreign overlay, outside host/viewport or empty root padding | dom.selection_geometry_unsupported; no fall-through/nearest-block guess. |
| G07 | selection T1→T5 and reverse, RTL direction, mixed marks, supported hard_break endpoints | measured native directed target unchanged; UA fragments preserved; anchor/focus remain directed (no X sorting). If underlying endpoint has no unique usable rectangle, specified null/anchor-refusal rule applies, never guessed coordinates. |
| G08 | collapsed native selection with a literal actual width0,height>0 UA caret | measured, width0 retained; native/current browser range unchanged. |
| G09 | E/BR/atom boundary whose actual collapsed anchor yields no rectangle, or ambiguous distinct rectangles | dom.selection_geometry_unsupported; a measurable block read can still succeed. Controlled empty/ambiguous-return tests have this fixed outcome. |
| G10 | current native selection null | dom.selection_missing; no selection synthesized from browser Selection or block bounds. |
| G11 | browser Selection is elsewhere/different, current native range remains valid | measure NATIVE target; foreign/owned browser Selection unchanged, no syncFromDom/set_selection. |
| G12 | partially clipped range/block has at least one intersecting fragment; focus off clip | measured visible true (no full-endpoint visibility promise), actual rects retained; unusable focus null. |
| G13 | measurable block fully outside effective clip; zero-area clip intersection | measured visible false, no focus/scroll into view; nonnegative clip dimensions. display:none/no usable block rect instead refuses geometry_unsupported. |
| G14 | identical native stamp; host scroll/resize/font/page zoom changes actual layout | fresh actual measurement each read, updated viewport/clip as applicable; no cache based on stamp alone. |
| G15 | selection spans distinct inner clip chains; also clipped middle row despite same endpoint chain | dom.selection_geometry_unsupported; partial successful snapshot prohibited. |
| G16 | controlled boundary256 total raw rects/128 ancestors/1024 visited objects with usable anchor | measured complete snapshot when all other conditions hold. Independent cap cases isolate each bound. |
| G17 | same corresponding boundary plus1 rectangle, ancestor or visited object | dom.selection_geometry_unsupported; no truncated measured output/no leaked temporary owner. |
| G18 | transform/perspective/clip-path/mask, CSS zoom, vertical writing, rounded clip, iframe or nonfinite UA edges | dom.selection_geometry_unsupported; ordinary browser page zoom is separately G14. |
| G19 | well-formed stamp differs in EACH of session/generation/revision/selection_epoch/history_epoch, one at a time | dom.stale_selection, even if revision or document text otherwise matches. |
| G20 | full context changes during measurement, or stamp changes between pre/post checks | dom.stale_selection; no mixed snapshot. Controlled reentry is labelled, not real native behavior proof. |
| G21 | malformed/extra fields, wrong kind/node type, missing stamp field, NaN/Infinity point | dom.invalid_options. Finite offscreen point is G06, not invalid_options. |
| G22 | valid stamp, unknown/retired native ID, detached owned target/host | dom.selection_geometry_unsupported. Old-generation stamp after replace instead G19. |
| G23 | same-ID/data-attribute clone replaces genuine row, immediate same-turn read before observer recovery | dom.selection_geometry_unsupported; clone receives no authority. After observer enters recoveryRequired, dom.recovery_required has precedence. |
| G24 | old detached object reattached after successful replace; hit inside it | dom.selection_geometry_unsupported, even if native/DOM ID strings repeat; successful replace rotates authority. |
| G25 | ready readOnly/disabled/native-read-only with valid view | measured as ordinary geometry; no editing/focus permission implied, no mode_blocked/native_read_only refusal. |
| G26 | ready protected composition/provisional UA subtree, otherwise idle | dom.composition_conflict; zero writes/range/focus/scroll/history changes, provisional objects unchanged. |
| G27 | active commit, replacement preflight, subscriber delivery or actual SDK pending ticket | dom.busy; no new continuation/queue. Pure geometry does not reopen original ticket. |
| G28 | loading / recoveryRequired / disposing,destroyed,fatal | dom.not_ready / dom.recovery_required / dom.disposed respectively. |
| G29 | native state/node read returns original Refused or Fatal | sdk_failure with EXACT original Response; never measured/geometry substitution. Controlled transport faults labelled separately. |
| G30 | unrelated native patch preserves target object; then query fresh vs old stamp | fresh read uses same unaffected actual object; old stamp stale_selection. Geometry does not remount/rewrite to make correspondence succeed. |

Every successful/refused normal read preserves canonical native bytes, directed native selection/stored marks/history/dirty/saved revision/full stamp/event count, actual browser range/active element/scroll, owned DOM identities/attributes and bookmark/request/SDK/DOM/selection/clipboard resources. No listener/observer/RAF/persistent Range allocation; all result data immutable, no live DOM references. Existing fatal-read disposal is the explicit G29 exception to lifecycle/resource invariance. Existing copied geometry output is presentation data only and cannot complete a host request or bypass current native query/command guards.

## Source anchors and freeze handoff

Ledger primary paths: view.ts19–45/61–75/94–129/176–235 (actual private rows, primitives, WeakMap, point limits); selection-geometry.ts1–82 (existing pointer-only clipping/caret policy); mounted.ts120–130/167–171/196–206/308–334 (current lifecycle/busy/read/forwarding); types.ts1–79 (actual DTO/failure API); KWDJ dom.ts54–89 (paragraph/container/scene presentation), generated native NodeViewDto/StampDto/SelectionDto in packages/wasm/src/sdk-types.ts. Source APIs do not yet implement this contract. Root must copy/freeze table, selected-object/clipping definitions and literal fixture bytes before implementation; no later output-derived expectation learning.

## Root pre-freeze authoring clarification

Before any candidate, the128 bound counts ALL distinct ancestor objects inspected, including nonclipping ancestors, not just ancestors which clip. Repeated objects count once across a read. This closes an otherwise unbounded nonclipping walk without changing expected layout semantics. The original outside preparation note is retained separately; no execution motivated this clarification.
