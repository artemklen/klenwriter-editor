# Frozen extensions and SDK V2

An extension author uses the public Rust crates or supplies a bounded JSON
descriptor. The kernel has no list of concrete profiles. The default artifact
includes KWDJ and the independent notes module; the separate
[`extensions-consumer`](../tests/fixtures/extensions-consumer/README.md) builds
notes alone or KWDJ alone through those same public crates.

SDK1, its 36 generated DTOs, KWDJ JSON1 and codec1 remain available. Explicit
`editor-sdk/2` adds frozen runtime schemas and compiled module negotiation.
Package SemVer, registry format, codec wire version and SDK ABI are independent.
These packages remain private/bootstrap until OSR-71.

## A descriptor without rebuilding WASM

[`examples/notes-extension`](../examples/notes-extension/) is a separate JSON
package. Its D0 selects the mandatory notes base; D1 additionally supplies a
callout, a highlight mark and `org.example.notes/insert-callout`. The recipe
inserts authored content, selects a Created text leaf, and participates in the
ordinary atomic transaction and undo/redo pipeline. No JavaScript validator or
callback runs in Rust.

Pass the original registry JSON text and original document bytes. In particular,
do not parse/stringify numeric literals through JavaScript Number. Schema bounds
are decimal strings; command `AttributeDto::Number` values are canonical decimal
strings. Integer attributes accept exact i64/u64 representations, including
`18446744073709551615`, and refuse floating `1.0`. A number schema compares the
represented serde_json number with exact decimal bounds; it does not recover an
already rounded original floating-point token. Canonical JSON1 stays unchanged.

```ts
import { createEditor, loadSdkV2 } from '@klenwriter/editor-sdk';

const module = await loadSdkV2(); // one sealed prebuilt WASM, shared with SDK1
const editor = createEditor({
  input: originalDocumentBytes,
  options: {
    abi: 'editor-sdk/2', build_id: module.manifest.build_id,
    profile: {
      profile_id: 'org.example.notes', profile_version: '1.0.0',
      codec_id: 'org.example.notes/json', wire_version: 1,
      extensions: [
        { id: 'org.example.notes/base', version: '1.0.0' },
        { id: 'org.example.notes/callout', version: '1.0.0' },
        { id: 'org.example.notes/highlight', version: '1.0.0' },
      ],
    },
    admission: 'validate', access: 'editable',
    registry_json: originalD1RegistryText,
    profile_options_json: JSON.stringify({
      root_blocks: ['org.example.notes/paragraph', 'org.example.notes/callout'],
      limits: null,
    }),
  },
});
const result = await editor.ready;
// Check result.status before using capture/read/query/submit.
const context = editor.context();
// Destroy the controller when its owner ends the session.
```

The notes factory composes its mandatory document/paragraph/text/hard-break
definitions with the supplied extensions. `root_blocks` is an explicit composer
policy, validated by the registry; it is not an implicit dependency or codec
allowlist. `mark_policy` explicitly selects allowed marks for a node type. It
cannot replace that node's attributes, primitive, child grammar or owner.

The document root owns `title` and `tags`. They are authored semantic attributes,
therefore ordinary history restores them. Notes JSON requires the closed
`{schema_version:1,root:Node}` envelope and all five node fields
`{type,attrs,marks,text,children}`. Primitives come from the selected registry.
Unknown data refuses; it is never flattened or dropped. The complete independent
notes codec contract is in [`contracts/notes/v1`](../contracts/notes/v1/README.md).

Descriptor and notes JSON duplicate keys refuse before owned parsing. The
generic KWDJ parser keeps its existing JSON1 behavior. Missing required fields,
explicit null and an empty value have distinct meanings. An optional attribute
may be absent; a required nullable attribute must still be present.

## Exact registration and finite recipes

Registry `editor-registry/1` identifies the profile/codec/wire version, exact
selected extension IDs/versions, root grammar, mark policy and declarations.
Definitions map each `(kind, full public ID)` to its explicit owner and version.
ID prefixes have no authority. Dependencies are exact, explicit and acyclic;
references must resolve in the selected set but do not invent dependency edges.
Topological order breaks ties by ASCII extension ID.

The language is closed: node primitives, bounded string/boolean/number/integer/
enum/ID/nullable/list/object attributes and Empty/Type/Sequence/Choice/finite
Repeat grammar. Recursive document types refer to labels; grammar operators
cannot expand recursively. The compiler uses bounded epsilon-NFA simulation,
with a compact count path only for a nonnullable single-label/label-choice
repeat. Excessive state, transition, depth or work requirements refuse.

Trusted Rust registrations may declare `Compiled` commands backed by an actual
provider. A host descriptor cannot claim that provenance. The constructor of
`Recipes<P>` checks that the provider's exact real catalog equals its mandatory
compiled registrations before exposing runtime recipes. A compiled intent
cannot impersonate a recipe ID.

Recipes have at most 64 typed parameters and 256 operations, and the registry
has at most 4096 recipe operations in total. The first finite subset is
ReplaceText, SetAttribute, SetMarks and InsertFragment. Node references are
arguments or Created paths into an earlier insert in the same recipe. No loops,
network calls, general expression evaluator, recursive recipe calls or arbitrary
Rust callback can be supplied in JSON. Runtime expansion revalidates native
arguments under the existing PlanBuilder meter, then uses the real Session
normalizer, validator, selection mapper, atomic publisher and history.

The command payload is closed and bounded to 65536 UTF-8 bytes:

```json
{"kind":"recipe","arguments":{"nodes":{"doc":"n1:…"},"values":{"text":{"kind":"string","value":"A😀B"},"title":{"kind":"string","value":"Подсказка"}}}}
```

`doc` is a current opaque node token obtained through guarded reads. It conveys
no privilege beyond the normal session/revision/selection checks. Offsets and
indices have the same u32 capability on native and WASM; numeric attributes keep
their wider exact range. `MapFromUserResult` resolves before normalization and
maps through its operations; `Set` resolves in the final frame. A Created child
path removed by a join can therefore refuse `transaction.invalid_local_reference`.
Direct references to a retired root may instead refuse `tree.missing_node`.

## A compiled Rust module

New semantic algorithms or a new codec require a new native/WASM distribution.
They are trusted Rust code. The public traits are `FrozenProfile`,
`TransactionProfile`, `CommandProvider` and, for runtime schemas,
`RegistryProfile`. The profile owns its codec, Context, Admitted value and GAT
Cache. The engine remains `Session<P>`; only its fully constructed bridge is
erased at the outer distribution boundary.

The complete independently compiled consumer is executable source, rather than
an API sketch:

```rust
use klenwriter_editor_bridge::{Distribution, SessionFactory};
use klenwriter_editor_notes_sdk::NotesFactory;

let factories: Vec<Box<dyn SessionFactory>> = vec![Box::new(NotesFactory)];
let distribution = Distribution::new(build_id, factories)?;
let session = distribution.open(original_bytes, original_options_json);
```

The real notes crate's normal closure is core + registry + serde, without engine
or KWDJ. Its SDK adapter uses generic engine/bridge/protocol and notes. KWDJ has a
separate codec, adapter and mandatory registration. Its domain validator still
owns contextual grammar, identity facts, URL policy, normality and seven domain
ceilings. Adding a generic declaration cannot make an unknown KWDJ wire node
valid. A new KWDJ semantic type requires the corresponding trusted module change.

`SessionFactory::capability` describes the compiled profile/codec offer.
`Distribution` checks the exact ABI/build/profile/version/codec/wire tuple before
calling a factory or decoding authored bytes. Each factory compiles and freezes
the complete registry, verifies the requested extension binding and supplies an
already typed bridge. Missing modules return `profile.unsupported_profile`;
missing codecs/versions have their own typed refusals. The offer cannot be
enlarged by host descriptors.

## Identity, bounds and cache ownership

The build ID binds production source, locked dependencies and actual compiled
module choice. The semantic registry digest sorts unordered maps/sets, preserves
grammar and recipe order, and normalizes equivalent numeric bounds. It excludes
build identity and host reductions. `context()` separately returns the build,
exact profile binding, registry digest and effective capability digest. Changing
an attempted host increase above a hard ceiling does not change effective
capabilities; a real reduction does. The digest is compatibility metadata,
not authentication or permission.

Compiler hard ceilings are 256 KiB descriptor bytes, JSON depth128/131072 values,
64 extensions, 1024 node/mark declarations, 4096 attribute rules/depth16,
8192 grammar operators/depth32, 16384 states, 65536 transitions, one million
work units and 16 MiB logical owned bytes. Decimal descriptors are bounded to
512 bytes/256 digits/absolute exponent4096. Hosts can lower ceilings. They cannot
raise them. Compiler phases use the same relative bounded WorkMeter; counters
and charged failed work are retained. Profile transaction reductions are applied
before planning through the engine's componentwise minimum.

Registry and profile caches are immutable session proof state. Schema cache
preparation returns a sparse unpublished patch; refusal or query does not
publish it. Default or mismatched-digest caches take the full validation path.
KWDJ composes domain and schema proofs and publishes both only after success;
notes currently uses an explicit full fallback. Ordinary KWDJ local edits keep
the scoped path. A grammar that needs a full affected-parent scan charges that
actual work instead of claiming constant cost.

Refusal preserves all committed document/state/history/event facets. Preview
queries also preserve the real allocator. A refused execution may reserve IDs;
those IDs are never reused. Fatal transport/trap outcomes poison the handle and
remain distinguishable from ordinary refusal. The controller keeps its recovery
contract and queues nested mutation callbacks after publication.

## Author test kit and reproducible checks

[`testkit.mjs`](../examples/notes-extension/testkit.mjs) accepts an actual public
native or WASM port and independent literals. It checks exact codec export,
query purity, command effects, metadata, caret, marks, undo/redo identities,
atomic refusal, simultaneous frozen D0/D1 and resource cleanup. It supplies no
alternate validator or executor. The packet builder copies the original raw
inputs and expected bytes; it does not record outputs as expectations.

After the workspace build, run `npm run test:extensions`. It exercises the two
separate compiled consumers on native and WASM, plus the default packaged WASM.
Both absent/present comparisons use SDK2. The default runs D0 and D1 without a
rebuild. The same module also exposes SDK1 and SDK2 with shared actual Rust
resource counters. Strict-CSP Chromium/Firefox/WebKit and an offline external
consumer with install scripts disabled and no Rust tools in its child PATH run
as separately reported lanes in `npm run check`.

The literal inventories and transparent corrections remain under
`contracts/extensions/v1`, `contracts/notes/v1` and `contracts/sdk-v2/v1`.
Target raw outputs, actual feature graphs, native/WASM manifests, seals and
source/artifact hashes are retained under `artifacts/extensions`. Resource and
target-specific logical byte costs are not normalized into fabricated equality.
Renderer/mount/clipboard/IME/publication implementations remain with their
own project tasks; registry admission supplies no renderer capability.
