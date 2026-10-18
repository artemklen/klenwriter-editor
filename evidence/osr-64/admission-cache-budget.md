# Admission proof budget amendment

Primary Codex accepts this bounded implementation refinement on2026-10-18 under
the same delegated technical authority as the original execution contract. That
contract's bytes/hash and four acceptance criteria remain unchanged.

The first actual separate compiled KWDJ consumer refused the independently
specified DOC-026 node-count inputs49999/50000 with
`registry.resource_limit_exceeded`, although the codec accepted them. The raw
failed run is `/tmp/osr-64-root-extensions-first.log` (exit1), and the complete
60-input admission inventory is
`/tmp/osr-64-kwdj-resource-admissions-first.json` (observer exit0, two mismatches).
Original artifacts/source bindings are preserved in
`/tmp/osr-64-first-compiled-snapshot.zip`, SHA256
`1d2891fc04a23b47eb9f36418b76d9c3418b33fe020441eeccc534b06e65c2c8`.
No expected outcome or normative KWDJ limit is changed.

Session admission reused the one-transaction WorkMeter hard ceiling1,000,000
units/64MiB for building both immutable caches. A private observational copy
with only its constructor ceiling lifted measured the unchanged combined proof
at2,174,965units/92,620,787 logical bytes for49999 nodes and
2,175,002units/92,622,440 bytes for50000. The schema proof alone exceeds1,000,000
units. Those are diagnostic measurements of existing work, not acceptance runs
or permission to bypass production accounting.

Before implementing the repair, fix the following limits and literal tests:

- Ordinary `WorkMeter::new` and transaction planning remain capped at1,000,000
  units/64MiB. Compiler capabilities remain1,000,000units/16MiB.
- Add a separately named admission-cache constructor capped at4,000,000units/
  128MiB logical charged bytes. This accommodates the two separately validated,
  retained proof structures and bounded traversal without weakening ordinary
  edit/compiler limits. Logical charged bytes are not a retained-heap claim.
- A new default profile hook requests the old1,000,000/64MiB. The KWDJ profile
  explicitly requests the new admission ceiling; `Recipes<P>` delegates the
  exact hook. Engine admission/remount takes the minimum with the fixed hard
  admission ceiling. A host or profile cannot exceed it.
- The V2 KWDJ effective capability digest records the admission-cache ceilings.
  No field is added to the closed SDK1 DTOs. Notes keeps its existing default.
- Both original DOC-026 accepted inputs must open through the real V2 factory,
  export unchanged semantic data and clean up. Hard-cap clamp, below-cap refusal
  and unchanged transaction ceilings receive independent literal assertions.

This changes a distribution preparation capability, not document grammar,
canonical bytes, normative document maxima, per-edit work or compiler authority.
Native/WASM, MSRV and legacy regressions remain mandatory after the repair.
