# ADR-002 — Frozen schemas and two levels of extension

Status: architectural decision; M0 contract proof, implementation proof belongs to OSR-64. Decider: primary Codex, delegated by the owner. Date: 2026-10-17. Issues: [OSR-57](https://linear.app/klenwriter/issue/OSR-57), OSR-29, OSR-34, OSR-63, OSR-64.

## Decision and reason

A session is created with an immutable, validated profile registry. Declarative extensions compose a bounded set of primitives without rebuilding WASM. New semantic algorithms, validators or codecs are trusted Rust modules compiled into matching native/WASM artifacts. The browser renderer and host services are separate capabilities; neither can change committed state directly.

This gives a third-party author a useful middle ground: a callout and an emphasis mark need descriptors and a renderer; a new table invariant needs Rust and a new distribution. KWDJ is one profile implementing the generic contracts, never a branch in the kernel. A profile version is a compatibility contract, not a promise that any document can be translated losslessly to every other profile.

## Contract surfaces

| Surface | Input → output | Authority / phase |
| --- | --- | --- |
| Schema | Namespaced types, bounded attrs, child grammar, mark sets → validated registry | Rust; session admission |
| Command | Intent + captured range + base revision → operation batch or refusal | Rust command provider; prepare |
| Validation | Read-only candidate and dirty scope → typed diagnostics | Rust; before atomic commit |
| Codec | Bounded bytes + declared wire version ↔ semantic document | Profile Rust module; import/export |
| Renderer | Read-only render DTO + changes → keyed DOM | TS; after commit; no model mutation |
| Command recipe | UI intention → existing public command/batch | TS; subject to all Rust validators |
| Keyboard | Context + shortcut → intent/handled decision | TS; does not suppress schema checks |
| Host service | Request token + validated input → asynchronous result/refusal | Host; outside transaction |

Names are stable identifiers such as `org.klenwriter.kwdj`, `org.example.notes/callout`, `org.example.notes/highlight`. They are compared as exact case-sensitive ASCII strings with a documented maximum length; display names are localized separately. Node/mark identifiers are scoped by extension ID, never registration array position.

## Admission and compatibility

`createSession` receives `profileId`, exact semantic `profileVersion`, `codecId`, `wireVersion`, exact extension IDs/versions, registry descriptors, limits and host capabilities. Its result is `Opened`, or `Refused { code, path, details, recoverableInputToken }`. The caller retains original input bytes until successful admission; the refusal does not return a silently shortened document.

1. Validate descriptor bytes/counts/depth before expensive compilation; reject duplicate IDs, unknown primitive kinds and invalid bounds.
2. Resolve dependencies by exact version. Reject missing dependencies and cycles. Topological ordering breaks ties lexicographically by extension ID; never depend on object iteration or load timing.
3. Compile bounded grammar and attribute descriptors, check referenced types and mark exclusions. Record a canonical registry digest and artifact/codec ABI identities.
4. Decode/import under the selected codec, then validate the entire candidate against the same schema and semantic validators used for commands. Host URL/reference facts are untrusted hints; authoritative server checks remain necessary.
5. An editable mount additionally requires a renderer for every admitted semantic type. Missing renderer returns `renderer_missing`; an explicit separate viewer may show an opaque unsupported placeholder only while preserving original bytes and disabling save-as-supported. A renderer does not confer codec support.

No semantic-version range is resolved over the network at session creation. A package manager may select compatible packages before startup; the resulting manifest pins exact versions. Same wire version can remain readable across engine releases, but only after codec conformance tests. An unknown node, mark, codec or version produces a typed refusal, never deletion, flattening or replacement by an empty paragraph. Schema migration is a separate explicit transformation with before/after artifacts, not an import side effect.

## Declarative language and limits

Node primitives distinguish text leaves, text blocks, block containers, inline atoms, block atoms and hard breaks. Child grammar uses exact type references, sequence, choice and bounded repetition. No executable predicates, arbitrary regular expressions, unrestricted recursion through grammar operators or network lookups are accepted. Recursive document shapes refer to node types and remain bounded by document depth and operation limits. Grammar compilation has independent limits on descriptor bytes, rule count, operator depth and automaton states; excessive work is refused before document admission.

Attributes are closed, typed descriptors: string with byte limit, boolean, finite number/integer with range, enum, ID, nullable value, bounded list and closed object. Lists/objects are explicit bounded descriptors, not arbitrary JSON escapes. This refines the earlier short list of scalar examples: structured metadata must be representable without embedding CMS logic in the kernel. Unknown authored fields are rejected by the profile unless its codec explicitly defines a preserved opaque field with a byte bound. No functions, prototypes, DOM nodes, NaN or Infinity cross this boundary.

Limits are part of the admitted capability manifest: document bytes/nodes/depth, text leaf bytes, authored attribute bytes, operation size and validation work. The effective bound is the minimum of distribution hard limits, profile rules and host reductions. A host cannot raise KWDJ normative maxima. The first KWDJ profile uses its pinned upstream counting rules, not an invented generic count; see the CMS inventory. Independent profiles choose their own bounded codec/counting policy within distribution capabilities. Exhaustion returns `resource_limit_exceeded` atomically. Cancellation/time budget cannot publish a half-validated candidate.

## Mutation phases and refusals

`capture → generation/revision check → prepare → candidate write set → deterministic normalization → core/schema/profile validation → commit with position maps/history/revisions → queued notification → render`.

Normalization belongs to the profile command/import policy, not to a validator's side effects. It proposes explicit bounded operations on the candidate (for example merging adjacent stanza breaks), never edits committed state. Run those operations in deterministic profile order under an iteration/work budget until canonical, then validate the complete candidate. Nonconvergence or exhausted work refuses the whole transaction. Every normalization operation contributes to limits, the position map, inverse history and the single atomic commit. Canonical input is a fixed point: re-normalizing it makes no semantic change. Import may apply only the codec's documented normalization; editing normalization must map every affected selection/identity and cannot silently discard unsupported data. Read-only validators observe the resulting candidate and return diagnostics.

All validators run in the deterministic registry order and must agree before publication. A validator declares `node`, `subtree`, `ancestors` or `document` scope; a global rule may cost O(document). Incremental evaluation must be equivalent to full validation. No plugin mutates the committed tree, registry or history, invokes callbacks during an unfinished commit, or relies on clock/random/network for validity. Trusted Rust code is not sandboxed: native code can violate process assumptions or panic; third-party trust, review and distribution are explicit responsibilities.

Refusal preserves committed document, selection, revision, dirty state and history. A WASM trap is different: poison the handle, preserve last durable/original snapshot plus recoverable provisional input, and require a new session. `Changed`, `Unchanged`, `Refused`, `StaleSession`, `StaleRevision` and `Fatal` are distinct outcomes. A selection-only change advances its own epoch without changing document revision or dirty state. Subscribers run after commit; nested dispatch is queued and rechecks its captured revision.

Async service replies carry session, generation, document revision, selection epoch and request ID. Default behavior is refusal if any required token is stale. Explicit remapping requires a retained chain of position maps and a command-specific policy; it never searches for a similar-looking paragraph. URLs are parsed by a host policy with an allowlist of schemes/origins and no network access inside validation. Resource resolution, auth, uploads and save/recovery belong to the host. Core validity cannot assert that an offline external ID exists merely because it is well-formed.

## API sketch

```ts
type Revision = string; // canonical decimal u64, not a rounded JS number
type SessionToken = string;
type CommandEnvelope = {
  session: SessionToken; generation: string; baseRevision: Revision;
  selectionEpoch?: Revision; command: CommandDto;
};
type Result =
  | { kind: 'changed'; revision: Revision; changes: ChangeSet; map: PositionMap; selection: Selection }
  | { kind: 'unchanged'; revision: Revision }
  | { kind: 'refused'; revision: Revision; code: string; path?: string }
  | { kind: 'stale-session' | 'stale-revision' }
  | { kind: 'fatal'; recoveryToken: string };
// async init loads the verified artifact pair; dispatch is synchronous afterwards.
```

DTO representations (maps, null, integers, unions) must have native/WASM/TS round-trip tests in OSR-63. Generated TypeScript alone is insufficient. The sketch intentionally contains no Angular, CMS persistence, HTML string or DOM handle.

## Alternatives and evolution

| Alternative | Benefit | Reason not selected / future trigger |
| --- | --- | --- |
| Arbitrary JavaScript validators | Immediate runtime extensibility | Native server would need a JS runtime or different semantics; breaks the one-authority contract |
| Rust-only extensions for everything | Simple compile-time consistency | Rebuild/toolchain cost for a trivial block; retain it for genuinely new semantics |
| Mutable registry during editing | Hot plugin loading | Existing documents, history and maps could become invalid mid-session; recreate through explicit export/admit instead |
| Opaque unrestricted JSON attributes | Maximum apparent flexibility | Unbounded validation and unclear preservation; use bounded typed descriptors and explicit codecs |
| Remote plugin marketplace | Easy discovery | Trust/sandbox/version distribution is a separate product; excluded from v1 |

New primitives extend the registry format/ABI with capability negotiation. New profiles stay outside the core. Native/WASM builds must include the same semantic Rust modules and validate the same corpus. Collaboration later needs its own identity, conflict, operation and undo design; session IDs and deterministic local validation do not make this a CRDT.

## Libraries and evidence boundary

Production choices remain `serde`/`serde_json` for bounded codec DTOs, `wasm-bindgen` plus `serde-wasm-bindgen` behind the SDK boundary, and generated TS types with runtime checks. Their gain is maintained JSON/ABI conversion, not domain correctness. Without them we would own parsing, memory/encoding/cleanup and cross-language conversions. Exact versions, licenses, transitive graph and bundle proof are M1/OSR-28 work. No editor framework or dynamic code loader is needed by this contract.

`evidence/osr-57/profile-vectors.json` contains independently authored KWDJ-minimal and notes-with-callout/highlight cases plus refusal cases. The reference checker exercises admission invariants only; it is neither the normative KWDJ codec nor proof of production Rust/native/WASM parity. OSR-64 must implement both profiles through the public API without kernel special cases.
