# OSR-39 mounted API proposal — source-only, for primary freeze

Proposal, not an accepted API or runtime result. Read on the OSR-39 branch after
accepted merge b9e2790; `/tmp/osr-39-refine-contract.md` has historical intake/status
headers. The parent has authorized OSR-39. No code, fixtures, tests or builds were
changed/run for this memo.

## Facts that constrain the shape

- `packages/sdk/src/controller.ts:19` defines the original `Submission` as completed
  `Response` or queued `Promise<Response>`. `:114–134,272–338` own the only mutation
  queue/fence. Listener work may execute before the original completed submission
  returns. DOM must not turn its return value into another render publication.
- `controller.ts:109–112,137–144,223` supplies capture/context/read/query/subscribe
  and decoded SDK2 context. `packages/sdk/src/context.ts:18–32` checks the exact
  build/profile tuple, not node coverage. `packages/wasm/src/sdk-types-v2.ts:8–12`
  has no effective type catalog. SDK2 is sufficient for mounted identity; SDK1 stays
  headless and unchanged.
- `controller.ts:125` rejects `update_facts` in SDK2. `BridgeRequest` contains no such
  variant. The mounted owner can retain its initial owned profile-options/facts;
  there is no public SDK2 live-facts getter/updater to forward or reconstruct.
- `crates/bridge/src/lib.rs:811–841` remounts under the same frozen profile/access,
  resets generation, snapshots and event protection, then returns state. It does not
  emit an ordinary document event. `controller.ts:284–288` handles generation reset.
  Explicit replacement therefore needs one fresh full-render completion boundary;
  ordinary mutations remain event-driven only.
- SDK catches subscriber exceptions (`controller.ts:305–308`). An internal renderer
  must catch its own failure, preserve publication truth and enter DOM recovery;
  merely throwing would leave an editable stale view behind an otherwise successful
  native result.
- Native renderer-independent authority remains unchanged: ADR002
  `docs/m0/extensions-contract.md:26–36,46–56`; one host/composition preservation is
  `docs/m0/architecture.md:169–177`. `packages/dom/src/index.ts` is only a scaffold.

## Minimal public facade: proposed declarations

Use the primary's spellings. Import existing generated DTOs and SDK types; do not
write another semantic selection/transaction/response schema.

```ts
type InteractionMode = 'editable' | 'readOnly' | 'disabled';
type MountedLifecycle =
  | 'loading' | 'ready' | 'recoveryRequired' | 'disposing' | 'destroyed' | 'fatal';

interface DomDiagnostic {
  readonly code: DomCode;
  readonly phase: 'mount' | 'command' | 'render' | 'replace' | 'mode' | 'destroy';
  readonly stamp: DeepReadonly<StampDto> | null;
  readonly node: string | null; // opaque token, never a parsed serial
  readonly typeId: string | null;
  readonly publication: 'none' | 'alreadyPublished' | 'unknown';
}
interface DomRefusal {
  readonly status: 'dom_refused';
  readonly diagnostic: DomDiagnostic;
}
type MountedMutation = Exclude<MutationRequestV2, { kind: 'remount' | 'destroy' }>;
type MountedSubmission = Submission | DomRefusal;
type MountedReady =
  | { readonly status: 'ready'; readonly response: Response }
  | { readonly status: 'sdk_failure'; readonly response: Response;
      readonly recovery: RecoveryPacket | null }
  | (DomRefusal & { readonly response: Response | null;
                   readonly recovery: RecoveryPacket | null });

interface MountEditorOptions {
  readonly element: HTMLElement;
  readonly editor: CreateEditorOptionsV2;
  readonly renderers: RendererCatalog;
  readonly mode?: InteractionMode;
  readonly onRecovery?: (packet: RecoveryPacket) => void;
  readonly onRefusal?: (failure: DomRefusal) => void;
}
interface MountedResourceCounts {
  readonly sdk: ReturnType<EditorControllerV2['resources']>;
  readonly dom: Readonly<{ listeners: number; observers: number;
    continuations: number; retainedInputBytes: number;
    retainedRecoveryRegions: number }>;
}
interface MountedEditor {
  readonly ready: Promise<MountedReady>;
  readonly lifecycle: MountedLifecycle;
  capture(): ReturnType<EditorControllerV2['capture']>;
  context(): ReturnType<EditorControllerV2['context']>;
  read(request: ReadRequest): Response | DomRefusal;
  query(request: QueryRequest): Response | DomRefusal;
  submit(request: MountedMutation): MountedSubmission;
  subscribe(listener: (event: DeepReadonly<EventDto>) => void):
    ReturnType<EditorControllerV2['subscribe']> | DomRefusal;
  setInteractionMode(mode: InteractionMode):
    { readonly status: 'updated'; readonly mode: InteractionMode } | DomRefusal;
  replace(input: Uint8Array): Promise<Submission | DomRefusal>;
  destroy(): DestroyReceipt;
  resources(): MountedResourceCounts;
  nativeResources(): ReturnType<EditorControllerV2['nativeResources']>;
  originalInput(): Uint8Array | null;
}
declare function mountEditor(options: MountEditorOptions): MountedEditor;
```

`capture/context` return null until *mounted* ready, including the native-ready /
renderer-admission interval. A successful mounted ready response is the actual
native initialization response and settles only after first render/selection.
Native Refused/Fatal stay unchanged inside `sdk_failure`, including category,
stamp and may-have-committed. Initial original bytes belong to the mounted owner
until this boundary, even though SDK discards its own copy at `controller.ts:224`.
`originalInput()` is an explicit bounded defensive copy, not a model export.

Read/query forward their exact response. Before forwarding, local lifecycle,
composition and renderer-capability gates may instead return `dom_refused`.
Once submit is forwarded, return its *original Submission*, including its original
queued/completed shape and response/completion. A post-publication patch failure
changes mounted lifecycle and calls onRefusal; it must not replace native Ok by a
fabricated atomic Refused. No added DOM command queue, rewritten stamps or ticket
retries. `subscribe` uses the actual SDK subscription, behind its same fence; the
internal rendering listener is registered first, before ready/host subscriptions.
Do not expose the private controller/raw handle or event acknowledgement cursor.

Direct/raw `remount` and `destroy` are excluded statically AND rejected at runtime
(`dom.explicit_method_required`), so casts cannot bypass replacement/recovery.
`update_facts` is not in SDK2 and is locally unsupported; no new method is promised.
All other supported SDK mutation variants remain available, including explicit
snapshot/save/release, selection, marks, history and barrier, under their original
native guards. Renderer rules additionally gate command ID AND full payload,
`set_stored_marks`, and any action's possible native output shapes.

Proposed small code set: `dom.invalid_options`, `dom.not_ready`, `dom.disposed`,
`dom.renderer_binding_mismatch`, `dom.renderer_missing`,
`dom.presentation_unsupported`, `dom.command_unsupported`,
`dom.explicit_method_required`, `dom.composition_conflict`, `dom.mode_blocked`,
`dom.native_read_only`, `dom.busy`, `dom.stale_replace`, `dom.reconcile_limit`,
`dom.recovery_required`, `dom.recovery_callback_failed`.
These are adapter outcomes, never additions to SdkResponse/DiagnosticDto. Before
native execution publication=none; a failed event patch uses alreadyPublished and
event.after. Native Fatal provenance remains original, not an invented DOM refusal.

## RendererCatalog: explicit capabilities plus immutable binding

`RendererCatalog` is opaque, frozen, bounded, created by
`defineRendererCatalog(definition)`. Definition has:

1. A trusted schema witness: exact `ProfileDto` (including extension versions),
   expected canonical registry digest, and explicit node/mark/command inventories.
   Do not use a primitive/name suffix or context digest as the inventory.
2. The subset of exact full IDs with node/mark presentation handlers and closed
   supported-attribute policies. Handlers receive read-only NodeView/mark data,
   produce bounded declarative presentation under the DOM kernel's fixed allowed
   elements/attrs/classes, and cannot receive controller/commit/HTML-string access.
   The kernel owns text nodes, keyed child containers, identity and selection.
3. A closed command envelope/payload allowlist from the trusted profile binding;
   all output-producing targets/marks/recipes are accounted for. This is renderer
   coverage, not a TS implementation of Rust validity/normalization/history.
4. Runtime build binding from the existing exported `sdkBuildId`, not a circular
   source literal. Mount compares it to actual verified SDK2 context/build.

Minimal proposed authoring signature (all presentation types are DOM-local, not
generated semantic DTOs):

```ts
interface RendererCatalogDefinition {
  readonly binding: Readonly<{ buildId: string;
    profile: DeepReadonly<ProfileDto>; registryDigest: string }>;
  readonly inventory: TrustedRegistryInventory;
  readonly nodes: Readonly<Record<string, NodeRendererDefinition>>;
  readonly marks: Readonly<Record<string, MarkRendererDefinition>>;
  readonly commandGate: (request: DeepReadonly<QueryRequest | MountedMutation>) =>
    DomRefusal | null;
}
declare function defineRendererCatalog(definition: RendererCatalogDefinition):
  RendererCatalog | DomRefusal;
```

TrustedRegistryInventory is the generated native witness above, with exact owner /
kind IDs and closed authored attr names; it is not a host-supplied semantic schema
override. NodeRendererDefinition fixes one exact native primitive and a bounded
`present(readonly NodeViewDto)` function. MarkRendererDefinition fixes one exact ID
and a bounded presentation function for its readonly MarkDto. Their result is a
DOM-local closed element/attribute/class description, never HTMLElement/HTML/CSS
strings, model edits, callbacks or direct child traversal. Generic DOM checks the
description against its fixed policy. The commandGate is trusted profile-binding
code operating only on the bounded original payload, not on mutable model state;
it returns null for coverage only, leaving all semantic validity to Rust. Catalog
definitions themselves cannot install a native validator or enqueue a mutation.
These capability definitions are trusted application code, not a JS sandbox.

Concrete proof source already exists in Rust: `registry::compile_descriptor`,
`FrozenRegistry::{binding,digest,extension_order,node,mark}` and borrowed descriptor
owner/attrs/allowed_marks (`crates/registry/src/compile.rs:46–85`), plus
`catalog_ids/compiled_catalog_ids` (`recipes.rs:596–606`). Public mandatory
registrations expose complete authored IDs: KWDJ `registry::{base_registration,
registry_descriptor}` (`crates/kwdj/src/registry.rs:18–77`); Notes
`base_registration(root_blocks)` (`crates/notes/src/registration.rs:28–84`).
There is no public FrozenRegistry enumerator: derive candidate IDs from the exact
selected registration DTOs, then resolve every one through the actual compiled
registry, checking owner/kind. Do not invent `context.types` or infer ownership
from extension prefixes.

Smallest production binding approach: a build-time trusted Rust inventory producer
for the two *specific* declared compositions, using those public APIs and the real
mandatory modules. Ship its registry digest + complete source-bound inventory with
the optional profile renderer binding. This is a proposed producer, NOT an existing
public SDK endpoint. The native canonical digest identifies schema semantics;
handler subset/payload closure proves editable coverage. New descriptor/recipe/
mark-policy compositions change the digest and refuse until explicitly bound.
Initial admitted traversal still verifies every actual node/mark/attribute before
editing. Missing handlers never become an opaque editable viewer.

Capability digest is intentionally separate. KWDJ factory computes it from build,
registry and *effective* host reductions (`kwdj-sdk/src/factory.rs:75–80,107–142`);
Notes also incorporates effective limits (`notes-sdk/src/factory.rs:59–64`,
`options.rs:84–105`), through `bridge/distribution.rs:19–44`. Pin the actual context's
capability digest into this mounted instance, then require exact equality across
preflight/final replacement. Do not bake one default digest and reject all valid
lower limits, or reimplement Rust effective-limit hashing in TS. Coverage trust
comes from the fixed profile module/registry and explicit handler/command policy;
the opaque per-instance capability digest identifies the actual limits, not a new
permission to render unknown semantics. A binding for a future module whose host
capabilities alter type semantics needs an explicit trusted policy/witness.

`@klenwriter/editor-dom` continues to depend only on SDK. Optional
`@klenwriter/editor-kwdj/dom` exports `kwdjBasicRenderers` and depends on DOM+SDK;
SDK never imports DOM or KWDJ binding. Notes D0 example exports `notesD0Renderers`
outside generic DOM. No automatic Notes D1 extension/render support.

KWDJ handled nodes (12): text, hard_break, paragraph, heading, code_block,
blockquote, bullet_list, ordered_list, list_item, task_list, task_item, scene_break,
all under `org.klenwriter.kwdj/`. Handled marks (9): strong, emphasis, strike, code,
subscript, superscript, text_color, highlight, link. Attr inventory is source-backed
by `crates/kwdj/src/registry-base-v1.json`: paragraph align/first_line_indent;
heading also level1..6; code language; ordered-list optional u64 start (INCLUDING0);
task-item checked; colors/highlight fixed token enums; link href/title. All other
authored attrs remain native data and require explicit presentation handling or
refusal. Color tokens select finite classes, never authored CSS. Ordered start
must not pass unchecked Number/HTML IDL conversion: the simple HTML-list binding
may explicitly refuse values above signed-32-bit presentation range, including
the corresponding command target. It must not alter/round the model's full u64.
SceneBreak is BlockAtom. MediaImage is a Container; reference_link, media, tables,
verse and domain nodes refuse. Notes D0 covers authored document/paragraph/text/
hard_break with title/tags preserved; synthetic native root is separately handled.

## Replacement: exact source ownership, one existing native remount

`replace(input)` is explicitly asynchronous for temporary admission, but introduces
no mutation queue. Refuse a second replacement while one is pending. Own bounded
input once before async work; retain it on any failure. Capture the real SDK
HostRequest (`controller.ts:147–170`) and current context. Instantiate a temporary
SDK2 using the exact privately owned initial options/profile facts/limits/registry/
loader, with only input changed; never use a host-mutated options reference.
Await admission; require exact profile/build/registry/capability context, traverse
real guarded reads and renderer rules, then dispose temp controller on EVERY path.
Temporary IDs never become final DOM/model identities.

After async preflight, recheck lifecycle, stamp, context and composition. An actual
UI mode change may be harmless, but no conflicting state/provisional input may be
discarded. Use existing completeHostRequest with the original remount stamp and
unchanged decoded input/admission; it checks capture and Rust checks again at real
execution. **Prefer refusing dom.busy if main SDK work is still pending**, using
the actual public pending-ticket/queued-mutation/continuation counts plus mounted
forwarding/delivery depth. There is no SDK execution-time DOM/composition hook for
an already queued remount: a check before enqueue cannot prove absence of a later
provisional subtree when that remount executes. Because the controller is private
and all entry points are mediated, an idle check immediately before synchronous
completeHostRequest avoids that interval without copying the SDK queue. No await
or host callback occurs between this final check and native execution. Release
the captured request on every refused path. Do not implement a DOM retry queue.

Ordinary submit still preserves SDK queued/completed meanings. Input admission
must account for outstanding forwarded tickets before starting a new provisional
region; a browser-owned region that nevertheless appears must be preserved and
put into explicit recovery rather than patched away. A stronger promise to reject
every earlier queued native request at its later execution would require a real
SDK seam, and must not be silently claimed by the DOM wrapper.

On actual successful remount completion, use current capture/state, not saved
temporary IDs or a response made stale by reentrant listeners. Perform one full
render/selection boundary because native remount has no event; cancel old keyed
DOM bindings by generation. Do not forward success before mounted completion is
coherent. With the preferred idle refusal, the final remount is completed
synchronously and replace's Promise returns that original Submission only after
its coherent render. If primary deliberately admits queued remounts, the Promise
must await their actual completion and the execution-time composition issue above
must be resolved first. Failure before publication leaves old Session/DOM
intact; unexpected post-admission rendering failure is recoveryRequired with true
native result, not an atomic rollback claim.

Changing registry/profile/facts is not `replace(input)`: construct another mounted
owner through new admission after recovery transfer. Existing remount cannot update
its frozen context. No pretend facts revalidation API is added.

## Modes, recovery, destroy and resource ownership

Default mode is readOnly for native `access:'read_only'`, otherwise editable.
setInteractionMode(editable) on native read-only returns dom.native_read_only.
Modes never remount/reset IDs/history. UI readOnly/disabled block user/view edits;
explicit host submit stays allowed under native permissions and renderer/
composition guards. Native validation decides which state/read/save operations
remain legal. Disabled removes editing focus, not host recovery controls; readOnly
retains text selection/copy/Find. Mode change during unresolved composition
refuses; it does not blur/cancel or force settlement.

Proposed recovery data is owned and bounded, with no implicit canonical export:

```ts
type RecoveryRegion =
  | { readonly kind: 'bounded'; readonly stamp: DeepReadonly<StampDto> | null;
      readonly originalText: string; readonly provisionalText: string;
      readonly affectedNodeIds: readonly string[] }
  | { readonly kind: 'retained_dom'; readonly element: HTMLElement;
      readonly reason: 'capture_limit'; readonly ownership: 'transferred_to_host' };
interface RecoveryPacket {
  readonly originalInput: Uint8Array | null; // loading/admission/render failure only
  readonly region: RecoveryRegion | null;
}
interface DestroyReceipt {
  readonly status: 'destroy_requested';
  readonly sdk: Submission;
  readonly recovery: RecoveryPacket | null;
  readonly callbackFailure: DomRefusal | null;
}
```

Before teardown capture original/provisional region under the frozen 8-block /
131072-node / depth128 /2097152-UTF16 /4096-record bounds, charging before copying.
If capture exceeds bounds, stop conflicting writes and preserve the ACTUAL owned
region untouched. On destroy, hand the same region reference to the host explicitly;
do not clone, serialize, clear or normalize an unbounded subtree. This retains input
even when no callback exists: the destroy receipt owns the transfer reference.

Destroy disables mounted mutation before calling onRecovery, outside native borrow;
captures packet first; callback throw records dom.recovery_callback_failed and
cannot skip returning recovery or SDK teardown. Keep the receipt's bounded binary
copy private while invoking the callback with a bounded defensive copy (or freeze
an immutable binary carrier at primary's type freeze); never share the only mutable
Uint8Array with a callback that can throw. Retained-DOM transfer never depends on
callback return and DOM is not cleared on throw. Host deliberately modifying its
transferred DOM is outside the adapter's non-destructive teardown guarantee.
Idempotent calls return the same receipt; callback/transfer happens once.
SDK destroy may be queued within its pump (`controller.ts:173–190`): mounted
disposing is immediate, released-native status awaits its actual completion.
Dispose pending temp SDK/late async continuations, remove tracked listeners and
observer, release mappings/host requests without walking an oversized subtree.
Clear onRecovery/onRefusal and editor options/loader references after their final
use; a retained mounted facade must not keep disposed host callback closures alive.

Recovery covers owned original/provisional input, not an automatic dirty-document
save. Explicit caller snapshots/save receipts retain their SDK meanings. Do not
promise whole committed-document recovery after destroy unless a separate explicit
snapshot boundary succeeded. `resources()` should report actual owner counts as
`{sdk: controller.resources(), dom:{listeners,observers,continuations,
retainedInputBytes,retainedRecoveryRegions}}`; nativeResources forwards unchanged.
Linear-memory capacity is not a live-handle count and need not shrink.

The remaining freeze choices are the trusted native inventory producer's file
location, immutable-vs-defensively-copied recovery binary carrier, and acceptance
of the explicit busy-refusal replacement boundary. They require primary technical
decisions, not an owner permission flow or a TS semantic mirror.
