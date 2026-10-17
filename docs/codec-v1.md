# Unstable KWDJ codec ABI 1

OSR-76 exposes `kwdj-codec/1` for native/Node-WASM conformance before the
editing engine exists. This is **not the stable SDK**: OSR-63 may replace or
absorb it. No session, editing, DOM, import adapter, projection, CMS delivery,
database, network or package publication is provided here.

Initialize `@klenwriter/editor-wasm/artifact` with the matched prebuilt WASM,
then call one of its synchronous exports:

| Export | Admission |
| --- | --- |
| `kwdjValidateV1(input, optionsJson)` | Strict already-normalized KWDJ; defaults needing normalization refuse. |
| `kwdjNormalizeV1(input, optionsJson)` | Decode candidate, normalize, validate; report native normalization event codes. |
| `kwdjCanonicalV1(input, optionsJson)` | Strict validation then canonical bytes; never repairs an invalid/non-normalized document. |

All three return a JSON **string**. Accepted results contain `abi`, `operation`,
`status: "accepted"`, `canonical_json` (a string containing the exact canonical
UTF-8 JSON), `normalization_events`, `media_manifest` and `reference_manifest`.
Each manifest entry is `{id, path}`. Refusals contain `abi`, `operation`,
`status: "refused"` and `diagnostic: {code, path, category, limit, maximum,
observed}`. Optional diagnostic facts are `null`. No document text is echoed in
refusals. Expected errors do not require parsing exception messages.

`canonical_json` stays a string or UTF-8 bytes. **Do not parse it into JS Number
and serialize it back**: KWDJ permits exact u64, including
`18446744073709551615`. `maximum`/`observed` and all configured u64 limits are
decimal strings, including small values and zero. Canonical formatting is the
existing [custom rule](adr/004-canonical-json-v1.md), not JCS.

```js
import init, { kwdjNormalizeV1 } from '@klenwriter/editor-wasm/artifact';
// Initialize with the artifact matching the generated glue (fetch/bytes are host policy).
await init({ module_or_path: wasmBytes });
const optionsJson = JSON.stringify({
  abi: 'kwdj-codec/1',
  identities: { media: [], references: [] },
  budget: { raw_input_bytes: '1048576' },
});
const result = JSON.parse(kwdjNormalizeV1(originalBytes, optionsJson));
if (result.status === 'accepted') {
  const canonicalBytes = new TextEncoder().encode(result.canonical_json);
  // Pass canonicalBytes to the host's save/export boundary.
} else {
  // Preserve originalBytes. Display a host message selected by result.diagnostic.code.
}
```

The package root exports `CodecOptionsV1`, `CodecResponseV1`, `CodecExportsV1`
and related TypeScript types, plus `codecAbiV1`. Generated artifact declarations
are low-level wasm-bindgen declarations; the declared typed transport is in
`packages/wasm/src/codec.ts`. Native tools call `codec::execute` with borrowed
bytes and the same options string. Semantics and diagnostics remain in Rust.

## Input and allocation boundary

Input must be a real `Uint8Array` (Node Buffer is compatible) backed by a fixed,
non-shared ordinary ArrayBuffer. Proxies, other array/view types, detached,
resizable/shared buffers and aliases of this module's own WASM memory refuse
with `codec.invalid_input_type`. This prevents races and detachment while the
module allocates. Intrinsic typed-array getters inspect borrowed length before
any input allocation. Own shadow properties and methods are not consulted.
No `&[u8]` export lets wasm-bindgen implicitly copy an arbitrary host buffer.

Options must be a primitive string, at most 65,536 UTF-16 units. Its length is
checked before it is copied to WASM; native also bounds UTF-8 bytes first.
The bounded options may allocate before input admission. After effective raw
length admission, one explicit bounded Vec copy enters the native codec.
This is an operational work bound, not a claim of exact peak RSS or OOM safety.
Actual allocation failure/traps remain module faults, outside expected refusal.

Host buffers are borrowed for the synchronous call and never mutated. Early
raw refusal precedes JSON parsing and identity lookups. The host owns original
bytes and recovery on refusal, unsupported schema/version or module fault.

## Options

`abi` and `identities` are required. Unknown fields, wrong types, noncanonical
decimal strings, overflow, malformed UUIDs and duplicate catalog UUIDs refuse.
The JSON has no arbitrary resolver callback or hidden allow-all mode.

`identities.media` and `.references` each contain at most 256
`{id: UUID, status: "exists" | "missing" | "unavailable"}` facts. Absent facts
mean unavailable and produce native `kwdj.identity_resolution_failed` when
needed. Explicit missing facts give the corresponding native missing-identity
diagnostic. Client facts are conformance/input context, never server authority;
the server still resolves identities independently at save.

Optional `limits` names:
`document_bytes`, `tree_depth`, `node_count`, `text_leaf_bytes`, `table_rows`,
`table_effective_columns`, `authored_attribute_bytes`.
Optional `budget` names:
`raw_input_bytes`, `preflight_payload_bytes`, `preflight_values`,
`preflight_depth`. All values are decimal u64 strings. Missing fields select
native defaults. Every value is clamped to native distribution/profile ceilings;
hosts can tighten, including zero, and cannot weaken the seven KWDJ maxima.
Native limit diagnostic names remain unchanged (`text_length`,
`attribute_length`, etc.).

Closed transport codes are `codec.invalid_input_type`,
`codec.invalid_options_type`, `codec.options_too_large`,
`codec.invalid_options`, `codec.unsupported_abi`,
`codec.identity_catalog_limit`, `codec.duplicate_identity`,
`codec.input_unavailable`. Profile failures retain their native `kwdj.*` code,
path and limit context, rather than being reinterpreted by JS.

## Verification and temporary test artifact

`npm run build && npm run test:codec` builds the real WASM artifact and runs
four Node tests. `npm run check` includes this lane after building. The
native example `codec` is a JSONL test transport, not an installed SDK API.

[Provenance](../provenance/codec-fixtures.json) records per-file hashes, rights
and privacy inspection of four immutable synthetic data files from CMS baseline
`a7f8a081b7827dd31097ad6c9104654366ae6e04`. This temporary snapshot is **not a
second corpus authority**. CMS remains authoritative; OSR-30 replaces it with
the single versioned authority/pin. No CMS checkout or private access is needed
to run these tests or CI. Original files and expected fields are not rewritten.

39 document cases and 14 resource recipes expand to 60 codec inputs (21 resource
measurements). All three operations receive identical raw inputs in native and
Node/WASM: 180 comparisons of canonical output, diagnostics, events and
manifests. Primary outcomes are also checked against the existing contract.
Accepted canonical bytes reopen through all three exports. Generated resource
metrics are verified independently and attempted host increases still obey all
seven maxima. Small separate cases cover raw zero/exact/+1, tighter budgets,
wrong types, shadow getters, explicit identities, lossless u64::MAX and no copy/
resolver calls before raw refusal. No huge allocation experiment is used to
test a hypothetical host length.

The report `artifacts/codec-v1-report.json` distinguishes **1 deferred case**
(DOC-024, no real later schema) and **5 cases without a KWDJ candidate**. Other
stages—clipboard/import, editor operations, public rendering, projection and
upconversion—are named as not executed here. Their presence in a fixture does
not make them codec passes or complete OSR-30.

Rollback reverts codec, transport and test-artifact additions. Persisted v1 data,
canonical serializer, normative maxima and CMS runtime/pin stay unchanged.
