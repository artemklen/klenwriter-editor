# OSR-57 — Generic profile admission vectors

[ADR-002](../../docs/m0/extensions-contract.md) separates schema/attrs, commands, validation, codecs, rendering, keyboard and host services. [profile-vectors.json](profile-vectors.json) exercises the same reference admission function with a minimal KWDJ example and an independent notes profile containing a callout and highlight mark. All text is freshly authored synthetic content; no CMS fixture/source is copied.

Run `node scripts/check-m0-contracts.mjs`. The [shared JSON report](../osr-59/reference-report.json) records exact source hashes and runtime versions. It contains 28 profile cases and 6 dependency-order cases; the complete OSR-57/59 run passes 219 counted checks.

The executable profile cases cover both positive profiles and bounded structured attributes; unknown node/mark/renderer/profile/profile version/codec/wire version/registry version/extension/extension version; duplicate IDs; wrong children; missing/invalid bounded descriptors; UTF-8 string byte limits; list cardinality; closed-object fields; integer bounds; attribute byte budget; node/depth budgets. Admission/refusal preserves the caller's semantic input value. Prototype property names such as `constructor` are not treated as registered node types.

The registry ordering uses an explicit ASCII comparator (`a < b`), not locale-dependent collation. A case/punctuation vector distinguishes `org.A`, `org.a`, `org.a-1`, `org.a_1`; missing dependencies, cycles, duplicate IDs and non-ASCII IDs are rejected.

## Evidence boundary

This checker validates selected **manifest/admission invariants**. It does not parse or round-trip either profile's wire bytes: the sample `wire` fields illustrate two independent formats, while codec/wire refusals check requested identities against the admitted manifest. It does not compile a grammar, freeze a real Rust registry, run trusted extension code, sandbox plugins, validate URL existence or prove native/WASM parity. Those remain OSR-29/30/63/64 implementation gates.

Local checker caps (ID length 128, attribute descriptor depth 8, descriptor sizes up to 65536, object descriptor field count 64, default document depth 16, 100 nodes and 256 attribute bytes) bound the reference examples only. They are not new normative KWDJ or distribution limits. The actual effective limits remain the minimum of the pinned distribution, profile and host bounds described by the ADR.

No CMS-specific branch exists in `admit`: it consumes profile descriptors and requested identities uniformly. Fixture setup chooses which profile/example to test; that is not a kernel profile dispatch rule.
