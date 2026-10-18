# Public extension registry v1 — independent basic oracle

These synthetic literals were authored by a supporting Codex implementer BEFORE the OSR-64 registry/compiler, attribute evaluator or grammar matcher implementation. They are verification inputs, not executable code, measured passes, a second implementation of the compiler, or an independent review verdict. License: MIT OR Apache-2.0. No private/user/CMS documents are included.

Authority: `evidence/osr-64/execution-contract.md` (accepted OSR-64 contract), ADR002 and `docs/adr/004-canonical-json-v1.md`. The primary architect accepted the concrete closed registry DTO, composer mark policy and diagnostic taxonomy before this first freeze. This package freezes compiler/attribute/grammar expectations only; finite recipes/history/profile conformance and external Notes codec literals have separate later paths. Notes corpus belongs under `contracts/notes/v1`, not here. No test/compile result is claimed by this manifest.

## Files and fixture transport

- `compiler-vectors.json`: 58 complete raw descriptor inputs with literal accept/refuse codes, explicit deterministic extension order, and independent digest equality/inequality relations. Some deliberate invalid JSON/duplicate-key inputs cannot be represented as parsed objects.
- `attribute-vectors.json`: 60 standalone attribute policies plus exact raw attrs JSON and accepted canonical-v1 JSON bytes or typed refusals.
- `grammar-vectors.json`: 40 exact grammar AST/terminal-label examples, distinct compile and match outcomes. `match:null` means compilation must refuse; it is NEVER a passed match.
- `manifest.json`: byte/hash inventory of this basic oracle. Counts are authored cases, not executed coverage.

JSON fields named `input_json`/`attrs_json` contain exact UTF-8 text to feed the production Rust decoder. Consumers MUST NOT parse and stringify these through JS Number: that would destroy integer/float forms, 2^53 neighbors, u64 maxima, signed zero and duplicate keys before the real boundary. Expected canonical strings contain no trailing LF; container fixture files do end with LF. Strings preserve SPACE/NBSP, decomposed `e`+U+0301 and precomposed U+00E9 separately.

Compile budgets are fixture-only host reductions: named CompilerLimits fields `descriptor_bytes`, `states`, `transitions`, `owned_bytes`, `work_units`; omitted fields retain accepted defaults. Match budget `work_units` restricts the SAME production meter. Zero is exhausted, not unlimited. These fixture fields do not introduce a new public request DTO or normative document limit. Consumers may adapt them to the frozen public API without changing the input or expectation.

For an attribute case, compile the exact `fields` map as a synthetic known node's attribute policy, then validate that node's raw attrs object through the actual registry schema authority. The descriptor wrapper adds no attrs, defaults or normalization. Validate accepted values by exact canonical-v1 output; refusals preserve input and create no committed state. Grammar cases resolve labels against their `known_type_ids`, compile the supplied AST, then consume the COMPLETE literal label sequence. No prefix-match success, grammar-type expansion, greedy fallback or substitute regex implementation counts.

## Closed production descriptor shape

Every field is required, including empty arrays/maps and null numeric bounds. The envelope is exactly `format`, `profile`, `selected_extensions`, `root`, `mark_policy`, `extensions`. Format is `editor-registry/1`. Profile has `id,version,codec_id,wire_version`; selected identities have exact `id,version`. Each extension has `id,version,dependencies,nodes,marks,commands` (commands are EMPTY in this first subset). Nodes have `id,primitive,attrs,children,marks`; marks have `id,attrs,excludes`. Attribute fields have `required,value`.

Grammar is closed `op`: `empty`, `type{id}`, `sequence{items}`, `choice{items}`, `repeat{item,min,max}`. Empty sequence is Empty; empty choice is invalid; repeat0..0 is valid; min>max refuses. Type is a terminal label, not a recursive grammar expansion. Epsilon alternatives and variable-width ambiguity must remain complete and terminating. The literal greedy counterexamples require retaining BOTH viable branches. Compact million-count repeats are accepted only for Type or choice-of-Type; noncompact/nullable million-count cases exceed projected compiler resources and refuse BEFORE large allocation. They are small descriptors, not million-node documents.

Attribute schema is closed `kind`: `string{max_bytes}`, `boolean`, `number{min,max}`, `integer{min,max}`, `enum{values}`, `id`, `nullable{inner}`, `list{item,max_items}`, `object{fields}`. Unit forms are closed empty STRUCT variants; extras must refuse. Presence and nullability are independent; required+nullable does not permit omission. Unknown fields never disappear. String limits count UTF-8 bytes, list bounds count items, closed objects recurse. Integer accepts exact i64/u64 serde_json Number representation only:1.0,1e0,-0 and integer overflow fallback are not integers.

## Ownership, order and digest oracle

Public type IDs `org.example.fixture/*` deliberately differ from owner `org.example.owner/*`. Prefix inference would fail this fixture. Same-kind duplicate public IDs refuse even if declarations are equal or owners differ. References resolve selected exact owners, but NEVER synthesize dependency edges. The cross-owner highlight and mutually referring container labels therefore compile without artificial cycles. Explicit exact dependencies independently enforce availability/version/topological order; ASCII tie-break applies among available extensions. Input array reorder must not change dependency order or digest.

`mark_policy:{}` retains each owner's default allowed marks. A composer entry replaces the allowed set for exactly that existing node; no ownership/attrs/primitive/child grammar patch occurs. Policy and exact owner assignment enter digest. Sequence/choice operator order is semantic data for digest even when accepted languages overlap. Expected digests are RELATIONS to named earlier cases; no output-derived SHA or guessed encoding is embedded. Exact digest byte vectors require a separately frozen canonical encoding before implementation of that later oracle.

## Numeric oracle

Bound strings use exact bounded decimal comparison, not f64; numeric authored values are compared using the canonical decimal of their represented serde_json Number. No reconstruction of already-rounded raw tokens. In particular raw9007199254740993 remains exact integer, while raw9007199254740993.0 represents9007199254740994.0 in the pinned ADR004 parser. Bound exactly9007199254740993 therefore accepts the former and refuses the latter. Raw1e-400 represents0.0; a positive lower bound1e-400 must still refuse it. Signed zero compares equal to0 but canonical authored -0.0 remains unchanged. Bound spelling normalization may yield equal digests without rewriting document values.

Both i64 minimum and u64 maximum, neighboring2^53 integers, fractional integer bounds, represented overflow fallback, exact endpoints, bound exponent4096/4097, coefficient256/257 and malformed decimal spelling have independent expectations. Existing canonical-v1 authority remains unchanged; no JS precision normalization or arbitrary_precision feature is authorized.

## Stable diagnostics and future execution

Compiler cases use the primary-accepted `registry.*` taxonomy: invalid_json/duplicate_json_key/unsupported_format/invalid_descriptor/invalid_identifier/invalid_version/duplicate_extension/extension_missing/extension_version_mismatch/dependency_missing/dependency_version_mismatch/dependency_cycle/duplicate_node/duplicate_mark/unknown_type/unknown_mark/invalid_grammar/invalid_attribute_schema/invalid_numeric_bound/resource_limit_exceeded. Runtime attribute cases distinguish required_attribute_missing, unknown_attribute, attribute_type_mismatch, attribute_out_of_range, attribute_limit_exceeded; grammar mismatch is grammar_mismatch. Match/compile work exhaustion is resource_limit_exceeded.

A runner must execute the actual native and compiled-WASM authority against these SAME inputs, report each case/phase honestly, and retain every refusal/failure. Basic literals do not prove all compiler caps, runtime dirty-cache correctness, command recipes, full profile semantics, history, public SDK lifecycle or the four OSR-64 AC alone. Those remain mandatory independent conformance lanes. Fix a demonstrably incorrect oracle by an explicit reviewed correction; never rewrite expected values from current implementation output.
