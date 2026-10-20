# OSR-43 ordinary-input observation and popup presentation — source proposal

Source-only implementer design, not formal review/approval or execution. No source/contract/test/browser/native/Linear changes. Runtime files below are the authority; new bounded native `text_window` reply is a separately authored native/SDK contract, not an existing API assumed to work.

## Decisions to freeze

Use two stable sibling capabilities on real `MountedEditor`: `inputObservations` and `popupPresentation`. Add top-level resource siblings `{inputObservations:{subscribers:number},popupPresentation:{handles:number}}`; retain the exact existing `dom` resource object. Cap subscribers32 and live presentation handles1. No extra DOM listener, native subscription, RAF, promise queue or observer is needed for the DOM capabilities themselves. Optional slash UI owns its own existing-style listeners/subscription/oneRAF and reports their actual counts. Old UI without slash creates none of those new UI resources.

```ts
type OrdinaryInputType =
 | 'insertText' | 'insertReplacementText' | 'insertParagraph' | 'insertLineBreak'
 | 'deleteContentBackward' | 'deleteContentForward' | 'historyUndo' | 'historyRedo';
interface OrdinaryInputObservation {
 readonly kind:'ordinary_input';
 readonly inputType:OrdinaryInputType;
 readonly isTrusted:boolean;
 readonly dataHint:string|null; // actual data only when <=256 UTF16 units; else null
 readonly before:DeepReadonly<StampDto>;
 readonly after:DeepReadonly<StampDto>;
 readonly context:DeepReadonly<SessionContextV2>;
 readonly selectionBefore:DeepReadonly<SelectionDto>|null;
 readonly selectionAfter:DeepReadonly<SelectionDto>|null;
 readonly beforeWindow:DeepReadonly<TextWindowReplyV2>|null;
}
interface MountedInputObservations {
 subscribe(observer:(event:OrdinaryInputObservation)=>void):(()=>void)|DomRefusal;
}
interface PopupPresentationPoint {
 readonly stamp:DeepReadonly<StampDto>;
 readonly context:DeepReadonly<SessionContextV2>;
}
interface MountedPopupPresentationHandle {
 update(options:{readonly activeOption:HTMLElement|null}):
   (PopupPresentationPoint & {readonly status:'updated'})|DomRefusal;
 dispose():void;
}
interface MountedPopupPresentation {
 open(options:{readonly element:HTMLElement;readonly listbox:HTMLElement;
               readonly activeOption:HTMLElement|null}):
   (PopupPresentationPoint & {readonly status:'opened';
     readonly presentation:MountedPopupPresentationHandle})|DomRefusal;
}
```

No public observation sequence is necessary: complete native before/after stamps plus context already identify the accepted change. Do not turn a new local counter into authority. `dataHint` is merely a filter: null may mean original null or omitted oversized data. No raw Event, DOM text, constructed CommandDto, whole StateDto, generic success interface or second native ticket is exposed. The native reply type/limits/empty-child fields must be imported unchanged from the new native contract; do not invent a TypeScript interpretation of it.

## Input provenance and admission

Current ordinary entry is `input.ts:195`; actual listener dispatch is `input.ts:218`. CompositionOwner can call the same function with `ownedPermit=true` (`input.ts:217`). A native publication cannot distinguish those paths, clipboard, public commands, selection synchronization or reentrant activity (`mounted.ts:304`, `mounted.ts:380`). Therefore SDK `subscribe`/publication is not the observation source.

Keep a private per-admission capture token. Immediately after ordinary selection synchronization/support guards, but **before the host command factory**, capture current native state/selection/context and call a private mounted `beforeObservation()` only if subscribers exist and ownedPermit is false. That helper calls the new bounded native `controller.read({kind:'text_window',stamp,...})` directly using the exact captured native selection. It must not call a user callback, DOM mapper, semantic parser or queue. Revalidate full stamp/context and mount identity after the read; no transient SDK field is assumed public. A bounded-cap/ordinary read refusal yields null witness or suppressed observation and must not itself refuse/recover the otherwise valid input. Actual native fatal/lifecycle loss still follows existing fatal guards; it cannot be treated as a harmless cap refusal.

Capture actual `inputType`, dataHint and isTrusted as scalar observations. beforeinput `isTrusted` is provenance, never an OS/IME acceptance claim; synthetic controlled events remain false. Do not retain the InputEvent or original arbitrarily long data in the new public event.

**Necessary origin seam:** `Pending` (`input.ts:30`) currently contains no ownedPermit. `begin(input,selection)` at213 and `reconcile` submit at181 therefore lose true origin; submit defaults to false at58. Store both `ownedPermit` and the private pre-admission capture in Pending; pass ownedPermit through `begin` and the later `submit(...,p.ownedPermit)`. True still routes to submitComposition. It never creates an ordinary observation, including noncancelable composition delegation. Freeze O04 and retain OSR41 exactly-once regressions; this is an origin fix, not permission to replay or weaken settlement.

Emit only from the original InputOwner operation, at its successful terminal boundary:

- Original result must be `completed`, `response.status==='ok'`, `value.kind==='mutation'`, `effect==='changed'`. No event for native no-op/state-only/set_selection, queued tickets (even if they later succeed), refused/fatal, thrown bindings, recovery, composition-owned dispatch, public submit, clipboard or host completion.
- Response native after-state supplies after stamp/selection. Before state and native window are the captured native values. After must still equal current full capture/context, mounted lifecycle must be ready/editable, view canonical/no provisional, and original root/mount identity unchanged.
- For cancelable input, check after original submit/patch return. For noncancelable input, check **after** every existing correspondence/deletion-equality check (`input.ts:170–193`), since native success can still be followed by recovery at191. Never emit before that last recovery decision.
- Suppress if command factory, SDK subscribers or any nested attempt changed the admission context. A same-stamp reentrant no-op is still reentry: use the existing SelectionOwner submission-frame reentry knowledge or a private observation-admission invalidation token, not stamp equality alone. `selection.ts:72` already marks enclosing frames reentrant; no public bookmark/intent serial need be exposed or forgiven.
- During notification, deny nested ordinary/native mutation admission before request traversal/selection invalidation; `mounted.ts:345` shows the required early-guard pattern. Include notification delivery in the private busy guard. Read-only state/window reads remain available. Do not let reentrant replace/mode calls retire existing resources before returning busy. Destroy/unsubscribe remain allowed; destroy clears everything and stops remaining callbacks.

Deliver synchronously after original forwarding/publication has unwound and all InputOwner checks pass; no new scheduled continuation. Snapshot current subscribers, recheck liveness/freshness before each callback, exclude listeners added during delivery, and honor unsubscribe immediately. Catch callback exceptions without changing/replaying the original Submission; stop only on actual disposal/staleness. Any refusal reporting must retain the delivery guard so an error callback cannot create another input. Loading/recovery/destroy registration returns typed refusal; subscription32 overflow returns bounded refusal, never silently evicts an old listener. Unsubscribe is idempotent and closes over only an inert detachable entry after owner disposal. Recovery/fatal/replace/destroy clear or revoke mount-local observations; do not retain old mount references via an eventual queued promise.

For initial slash, UI requires ordinary insertText, dataHint exactly `'/'`, fresh changed native result and a valid beforeWindow; it reads afterWindow through the new native bounded read at event.after. It checks the native before→after lexical window and directed collapsed caret/parent correspondence required by the frozen native oracle. An empty child gap may become new Text only with the native parent identity/empty membership witness. UI cannot manufacture those facts from `textContent` or event.data. Missing/limited windows suppress slash opening, not the successful edit. History observations close the slash UI rather than extending/filtering its query. Full SDK/native semantics remain authoritative.

## One owned ARIA presentation handle

Do not expose global `set/clear` or an arbitrary attributes bag. One open handle owns only root `aria-expanded`, `aria-controls`, `aria-activedescendant`. `element` is an equality witness: compare it with the private mounted `#element` **before reading any properties of the supplied value**. The root cannot be selected by caller IDs, UI geometry or fake MountedEditor-shaped objects. Actual writes always target the known mount-owned object.

Parse the request with the existing own-data descriptor copier (`ownership.ts:12`), exact required keys/no accessors/symbols/unknown keys. Do not deep-serialize options through ownConfiguration: it intentionally rejects live DOM capabilities. Capture trusted mount-realm DOM intrinsics; verify external objects using genuine DOM brand calls/getters, not `value.ownerDocument` or duck-typed methods before admission. A prototype-shaped fake can pass instanceof; native Element/Node getter/method receiver checks must reject it. No caller-owned getter is used as an ID/document/containment oracle. Descriptor/proxy traps can reenter JS, so acquire the operation guard before parsing and revalidate afterward; getter-free parsing is not a claim of arbitrary-JS-free validation.

Listbox must be an actual connected HTMLElement in the same owning document, outside and not containing the editing root, with actual role listbox. ActiveOption is null or a genuine connected descendant option of that exact listbox. Bound the local option inventory to32, distinct nonempty IDs, using a finite local walk (e.g.256 nodes/depth8, refuse overflow); no querySelectorAll over an unbounded tree. Validate DOM IDREFs by the browser's actual `document.getElementById(id)===theGenuineObject` for listbox and active option. This proves resolution of the used reference, **not** a full global duplicate-ID audit. No global DOM scan. Use bounded ID strings (suggest256 UTF16 units, no ASCII whitespace); label contents have no native semantic authority.

Open and update capture current stamp/context for the returned point, recheck host/listbox/option relationships immediately before writing, and refuse when loading/disposed/recovery/fatal, readOnly/disabled, busy, composing/protected/provisional or replacing. Opening a second live handle returns busy. Update only changes activeOption for its already-bound listbox; it cannot retarget another root/listbox. Closed or retired handles refuse updates; dispose is idempotent and performs teardown even when ordinary opening is blocked. There is no stamp/bookmark/selection/focus lease, native mutation, scroll, range setter or DOM child edit in this API. Returned stamp/context is diagnostic freshness, not command authority.

Handle remains a presentation owner within the same mounted generation; ordinary publications do not inherently grant or revoke mutation rights because none exist. UI must close/refresh it according to slash origin/query policy. Replace, mode transition out of editable, recovery/fatal, composition protection and destroy retire it. Validate retained references on every operation and existing owner lifecycle/publication refresh; detached/changed listbox/option invalidates presentation. Caller/UI disposes before replacing option children or disconnecting its popup. Do not promise instantaneous detection of arbitrary outside DOM edits while claiming zero new observers; any such stronger behavior needs a separately counted observer, not an invisible resource.

## Mutation guard, restoration and resources

Root attribute writes currently recover (`mounted.ts:289–307`); root is the actual native root row (`view.ts:684`), not a public arbitrary overlay. Add one private controlled-root-attribute writer shared with presentation lifecycle. Drain existing MutationObserver records first and process them normally; if they expose a foreign edit/recovery, refuse the new presentation. Then disconnect, write only the three exact owned attributes, update the expected owned values, finally reobserve. Never discard pending records, add a blanket attribute-name whitelist or exempt foreign mutations. `setInteractionMode` uses this drain/disconnect/reobserve shape at389; general foreign class/style/ARIA edits must still recover as before.

Snapshot the three original host attributes alongside the five existing originals (`mounted.ts:135`) and retain the handle's previous/last-written values. On close/retirement/destroy, restore each prior value only if the current attribute still equals this owner's exact last write. If a foreign owner changed it, do not clobber that value; retire the handle and preserve normal foreign-mutation/refusal handling. Destroy must not later unconditionally overwrite those three fields via the generic original-attribute loop (`mounted.ts:486`); route their restore through compare-and-restore ownership. No new renderer DomAttribute permissions or root presentation rewrites are needed: view does not apply node presentation to host (`view.ts:107`), and geometry checks actual root/child objects (`geometry.ts:78`), not an attribute-count exemption. Preserve those invariants.

Counts: subscribers0..32 and handles0..1 are new top-level siblings only. No allocation on opt-out. Owner disposal clears callbacks/captured window references and restores owned ARIA, then reports both0. UI retains one unsubscribe and one presentation handle, releases both before tearing down popup nodes and on its existing destroy path (`ui.ts:729`), so existing UI subscriptions/resources remain independently meaningful. Reuse existing invalid_options/not_ready/disposed/mode_blocked/busy/composition_conflict/presentation_unsupported refusals; no native error codec or command extension follows from ARIA ownership.

## Files and bounded proof obligations

Implementation belongs in dom `types.ts`/exports, `input.ts` (origin+Pending+terminal hooks), `mounted.ts` (private capture/delivery and controlled writer/lifecycle), plus a small private popup owner if clearer. `view.ts` should require no new public mutable root API. `host-request.ts` continues to own actual captured command/focus requests; do not reuse its live handle for ARIA. New bounded native read must extend the real SDK/wasm request union/decoder rather than passing a fake read interface. UI `ui.ts`/slash submodule subscribes after ready, uses the real mounted capability and disposes on close; existing SDK publication/DOM listeners remain presentation triggers, never origin.

Meaningful frozen cases: cancelable ordinary changed + trusted flag; noncancelable ordinary changed; both ownedPermit=true routes excluded; unchanged/refused/queued/fatal/recovery excluded; subscriber reentrant change and same-point no-op suppress; observer throw/unsubscribe/destroy bounded. Popup: actual root/ref matching and accessor/prototype fake refusal, foreign/outside option and ID resolution,32-option bound, one-handle conflict, update(null), compare-and-restore foreign attribute case, real pending MutationRecord preserved, mode/composition/replace/dispose cleanup. Required compatibility includes OSR41 exactly-once/noncancelable delegation and OSR42 unchanged DOM/host leases/keyed controls/CSP/resources. These are proposed proof requirements, not execution results.

## Source byte pins

Observed 2026-10-20T10:59:01.909779+00:00; HEAD at pin read `3960664b286b0939d3e7d8e724183eb9f7b71ee6`. These pins bind unchanged runtime source inspected; contract authoring may be concurrent and no clean/final acceptance is claimed.

```json
[
  {
    "path": "packages/dom/src/mounted.ts",
    "bytes": 37397,
    "sha256": "818305bdc5e37696ed74fb2c84eefcd5bde72bc01b5a64bbbe22503da8ee2d3a"
  },
  {
    "path": "packages/dom/src/input.ts",
    "bytes": 16385,
    "sha256": "96d74ec9cbb3f2d0c2daa2297434a4556ca0aac3823e56530af7baf18d77e3ae"
  },
  {
    "path": "packages/dom/src/view.ts",
    "bytes": 49573,
    "sha256": "4907ae81793b60be73a6bfcfe689a37c237fe6585866b41f04b9bbfcb24741db"
  },
  {
    "path": "packages/dom/src/types.ts",
    "bytes": 13547,
    "sha256": "7eb8bc06c8a24b7128e228db3f9c6d31a84443c95135acf24bdd82b63ee44a6c"
  },
  {
    "path": "packages/dom/src/host-request.ts",
    "bytes": 13501,
    "sha256": "24b81b004da775ae43d380156ef938afaadf5224d2c0ecd6dda434e1c4c2669a"
  },
  {
    "path": "packages/ui/src/ui.ts",
    "bytes": 55447,
    "sha256": "64525bda5906c241c27ccf63657c1b642d891c79adde0d278edfe136f664e0a5"
  },
  {
    "path": "packages/dom/src/ownership.ts",
    "bytes": 3436,
    "sha256": "78fc6600652cfbbc93e0f44155255aaffeb9a9d0f67629106b5e07479baab3e0"
  },
  {
    "path": "packages/dom/src/selection.ts",
    "bytes": 28520,
    "sha256": "a9a49f91556d8a05880be5dfdf81c84f57bd575753bb0569c7c6532ca8d702b4"
  },
  {
    "path": "packages/dom/src/geometry.ts",
    "bytes": 19244,
    "sha256": "2c826c6ad6e9b2016fb789754f74b99c4e8e5b63abad938268b9502bf0d838ca"
  },
  {
    "path": "packages/sdk/src/controller.ts",
    "bytes": 25035,
    "sha256": "4bbfc4e4221c91c6a4aaeb6db6ac6ab18267363662f0dc6c8b53a1c516b0b509"
  }
]
```

Root pre-freeze readback: signatures/caps match the chosen API; no material mismatch.
- contracts/slash/v1/dom-api.ts: `dba5cb8a4ed224957285d121d01973d6588f1e57560644e5c6c7a20c2dfc3d57`
- contracts/slash/v1/freeze-decisions.md: `50269f33978cf73773f647192abea6b04741dc70e50c9082f63f695872522e7d`
