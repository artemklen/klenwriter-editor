# Public Session SDK ABI1

OSR-63 exposes a real Rust Session through `@klenwriter/editor-wasm` and the
framework-free `@klenwriter/editor-sdk`. Packages remain private, unpublished
`0.0.0`; ABI `editor-sdk/1` is an explicit compatibility contract, separate from
package SemVer, codec ABI `kwdj-codec/1`, persisted KWDJ schema1 and bindgen0.2.129.
This is a headless API. Production DOM/input/UI, general extension composition,
CMS persistence and registry release have their own tasks.

## Installation and loading

The packed wasm package includes generated web glue and its prebuilt WASM asset.
The SDK has no install/build hook and the consuming app needs no Rust toolchain.
Use a static asset URL under the host's CSP; do not inline/eval the module. The
default loader uses the asset adjacent to the installed wasm package. Node hosts
can supply prebuilt bytes; browsers may supply bytes or URL/Request/Response.
An externally compiled WebAssembly.Module is refused because its original bytes
cannot be verified. The loader shares only immutable verified module
initialization, not editing state. A different module input after initialization
is refused, rather than quietly reusing the wrong artifact.

```ts
import { createEditor, loadSdk, sdkAbiV1, sdkBuildId } from '@klenwriter/editor-sdk';
import { kwdjCommand } from '@klenwriter/editor-kwdj';

const loaded = await loadSdk(); // Node: loadSdk({ wasm: prebuiltBytes })
const editor = createEditor({
  input: originalKwdjBytes,
  options: {
    abi: sdkAbiV1,
    build_id: sdkBuildId,
    profile: loaded.manifest.profiles[0], // choose an exact offered profile
    admission: 'validate', // or explicit codec import normalization
    access: 'editable',
    identities: { media: [], references: [] },
    limits: null,
  },
  loader: async () => loaded,
});
const opened = await editor.ready;
if (opened.status !== 'ok') {
  // Inspect opened.diagnostic.code/path/details, retain editor.originalInput().
} else {
  const unsubscribe = editor.subscribe(event => {
    // Reads use event.after; no full document export is needed here.
    // Any submitted edit is queued until every eligible listener finishes.
  });
  // Capture after setting a valid native selection; InsertText uses that caret.
  const stamp = editor.capture();
  if (stamp) {
    editor.query({ kind: 'query_command', stamp,
      command: kwdjCommand({ kind: 'insert_text', text: 'Я😀' }) });
  }
  if (typeof unsubscribe === 'function') unsubscribe();
  editor.destroy();
}
```

The loader verifies the ABI, actual production source build ID and complete
manifest before constructing a Session. The build ID hashes sorted source bytes,
locked metadata and builder/generator inputs, including dirty/untracked source;
it is not merely Git HEAD or `0.0.0`. Generated outputs are excluded from their
own hash closure. The packaged WASM has one final compatibility section recording
its ABI, source build identity and exact pre-section bytes/hash. The loader checks
the bounded section table and that hash before initializing singleton glue, so a
normal incompatible/corrupt artifact does not poison a later correct retry.
It then checks the actual Rust manifest. A contradiction after verified packaging
is a terminal publisher fault for that JS realm. This metadata identifies a built
pair; it is not a signature or a promise of identical native binaries across systems.

The compiled KWDJ offer is `org.klenwriter.kwdj@1.0.0`, codec
`org.klenwriter.kwdj/json` wire1, base extension
`org.klenwriter.kwdj/base@1.0.0`. Unknown/profile/codec/extension versions refuse
before document decoding. This negotiates compiled capabilities; it does not
compile arbitrary third-party descriptors. OSR-64 supplies that public registry
and its independent profile proof. Renderer availability is a later editable
mount gate, not conferred by semantic admission.

## Rust DTOs, integers and ownership

`crates/wasm/src/sdk_wire.rs` is the data authority. `ts-rs=12.0.1` generates the
36 TypeScript declarations using a native-only optional build feature. It adds no
default runtime or WASM dependency. Generation is checked during build; TS compile
fixtures include intentional negative cases. Declarations do not validate data
at runtime: JS validates bounded owned plain data, while Rust decodes closed
typed DTOs before executing semantic operations.

Required nullable fields must be present, explicitly null when absent. Unknown
fields/variants are refused, including zero-field tagged variants. Do not infer
that serde's enum-level `deny_unknown_fields` alone enforces zero-field variants;
these use empty struct variants and have direct negative tests.

Revisions, generations, selection/history epochs, sequences, grouping tokens and
u64 values are canonical decimal strings. No leading zeros/signs/overflow or JS
number rounding. UTF16 offsets/indices are checked u32 numbers. Lone surrogates,
non-finite/fractional/unsafe integers, accessors, cycles and non-plain values are
refused before lossy conversion or enqueue. Metadata uses recursive tagged
attributes; numeric JSON lexemes stay strings, preserving `18446744073709551615`.
Snapshots retain exact canonical JSON, never parse/re-encode it through Number.

Opaque session/node tokens are bounded and checked by the generic engine codec.
They are addresses, not secret authorization; callers still need current context
and valid live nodes/positions. Retired IDs may be used only through guarded
mapping, which exposes mapped/deleted/stale/invalid provenance. The bridge uses
revision-guarded `node_at` for shallow render state. No Debug parsing, public
unchecked constructors or ever-growing identity side table is involved.

KWDJ owns its resolver through an Rc-backed Rust construction path; native callers
can retain the borrowed constructor. Identity facts are explicit bounded owned
data with exists/missing/unavailable results, not calls into JS during validation.
Absent facts mean unavailable. `update_facts` is serialized outside Session
preparation; native commands and replay recheck current facts. Server checks of
auth/references remain authoritative.

## Lifecycle and synchronous commands

`createEditor` returns a controller immediately. Loading is noneditable; `.ready`
settles once with a structured response. States are loading/ready/disposing/
destroyed/fatal. Destroy-before-ready cancels admission; late module completion
cannot resurrect it. Double destroy is idempotent. A failed load retains the
original input for explicit retry in a fresh controller; successful admission
releases this recovery copy. Explicit disposal releases retained recovery input.

After ready, idle reads/query/submit are synchronous main-thread operations:

- `read`: state, catalog, revisioned shallow node, map-position and resources.
- `query`: full actual-payload command/history availability; it grants no future
  permission. Native execute rechecks capture and prepares again.
- `submit`: command, history, selection, typing marks, history barrier, explicit
  snapshot/release/save acknowledgement/reconcile, remount or current facts.
- `captureHostRequest` and `completeHostRequest`: bound host request identity and
  exact session/generation/revision/selection/history stamp. Network/dialog work
  happens outside the SDK. A late result refuses; it cannot overwrite a newer
  selection/document. Release unused host requests explicitly.

`kwdjCommand` constructs a namespaced generic command envelope from the generated
profile-specific intent type. It rejects accessors, `toJSON`, cycles and other
unsupported data before serialization. `createCommand(id, payload)` applies the
same bounded plain-data ownership check for a generic command envelope. Neither
helper performs semantic validation. All15 compiled
KWDJ command families, their actual query/execute and native history policy remain
in Rust. There is no external restoration/replay privilege or semantic TS mirror.

Submission returns `{status:'completed',response}` when executed synchronously, or
`{status:'queued',completion}` from inside delivery/drain. Queued does not mean
Changed. A queued request owns its original payload and captured tokens; it may
later refuse stale, rather than silently changing them to current values. Async
host requests use this same queue and are cancelled on remount/destroy. Mapping
is explicit; a map-retention gap is not automatically rebased away.

Successful external remount first admits the whole replacement, then rotates
generation, resets history/maps/events/baseline and cancels old ownership. Failed
remount preserves the old Session. It never merges two documents or silently
normalizes unknown data by dropping it.
Remount carries `input_json` inside the request JSON. Its effective byte ceiling
is the intersection of the profile/native input bound and the encoded request
bound (at most16MiB, including escaping, envelope and captured stamp). A document
accepted as initial input can therefore exceed the remount transport bound.
That case returns a typed refusal and preserves the old Session/generation.

## Events and reentrancy

One native protected cursor is the delivery authority. Query/refusal/true no-op
produces no callbacks. State-only changes have their own epochs/events without
advancing document revision. Each actual native event is delivered once in order;
there is no second direct-return change notification.

For event r, the controller takes a listener membership snapshot. Newly added
listeners start next event; removed listeners are skipped. Every remaining
synchronous listener receives the same deeply immutable event and can readAt(r).
Listener mutations wait until the delivery fence and native acknowledgement.
A thrown listener error is isolated and reported by a bounded error channel; it
does not roll back or relabel the edit. Returning a Promise does not extend the
fence. No external callback runs while a Rust Session is borrowed or preparing.
If a listener's permitted read/query instead encounters a native fatal or
transport failure after publication, the enclosing edit ticket is Fatal with
`may_have_committed:true`; it cannot report an atomic refusal for that edit.

Hard maxima are128 pending mutations,16MiB/request,32MiB queued payload and64
listeners; controller options can reduce them. Tickets settle once and internal
result references are released, not saved in an unbounded history. After64 drained
mutations execution yields through a task continuation, preserving FIFO and
captured context. Destroy from a listener suppresses further notifications,
cancels queued requests and frees at the safe delivery fence. Native outbox
backpressure is distinct from JS queue bounds; neither drops changes silently.

## Snapshots, errors and resource accounting

Snapshots are explicit boundaries, not per-key listener state. Each export
returns immutable canonical JSON, stamp/profile/event sequence and a minted
generation-bound receipt handle. There are at most32 live handles and32MiB total
retained snapshot bytes, also bounded by native16MiB/snapshot and profile limits.
Release handles once no longer needed. A caller-supplied JSON/revision is not a
save receipt. Old r acknowledgement at r+1 keeps r+1 dirty; current exact snapshot
equality may reconcile dirty without changing revision or server ETag. The host
owns actual server/IDB save acknowledgement, concurrency and persistence cadence.

Expected errors use structured code/path/category/details/stamp, without parsing
messages. `Refused` means no native publication occurred. A trap or output
transport failure after native commit is `Fatal` with `may_have_committed`; do not
blindly retry it. The handle stops accepting commands. Original/explicit snapshot
recovery data belongs outside the trapped instance; neither OOM nor a trapped
instance is promised repairable in place. Actual loading/transport diagnostics
are separate from listener exceptions.

Destroy/remount/fatal release owned Session/protection/snapshot handles and JS
listeners/queue/tickets/requests. Native counters report real live resources;
controller counters report its owned JS state. Immutable cached module code and
caller-retained result promises/snapshot strings are separate ownership. WASM
linear memory capacity need not shrink after free, and monotonic session serials
are not leak counters. Tests must observe actual handles returning to baseline,
not substitute a memory-capacity assertion or a fabricated zero.

## Verification scope

The new lanes exercise actual native and compiled WASM Sessions against independent
literal inputs, plus real packaged SDK queue/lifecycle scenarios. Controlled
loader/controller tests isolate scheduling/error seams and are labelled as such;
they do not replace actual Session acceptance. A clean external JS consumer uses
packed artifacts with Rust/cargo absent from PATH; a strict CSP test host runs
the SDK under Chromium/Firefox/WebKit. Neither proves installed Safari/input/AT
or a production renderer. Existing command/history/delta/M0 gates remain intact.

The accepted [execution contract](../evidence/osr-63/execution-contract.md) defines
the full AC/DoD; final evidence records actual counts, source/artifact hashes,
raw failures and limits. Delivery requires exact-SHA independent review, one
prepared CI, merge/post-CI, cleanup and preserved review evidence. Publishing and
CMS rollout remain separate gates.
