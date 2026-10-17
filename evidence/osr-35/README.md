# OSR-35 local evidence

## Mapping repair, iteration 2

`repair-r2-command-report.json` and `repair-r2-local-verification.json` record
the corrected source based on merge `bcd1b9440089653a26c5ee7aff5f79eddbe0dca6`.
The actual native/WASM observer now has8 structural groups, including6 new map
cases: forward/backward whole-EGC moves through KWDJ normalization and four
ToggleMark cases comparing Edge/Text seams in both selection directions. The
report binds31 source/artifact hashes, including `engine/src/mapping.rs`.

The repair preserves the original destination in `MoveInlineGroup` maps and
the original UTF-16 seam of `EdgeAfter(left)` during `JoinText`. Focused map
regressions reproduced both defects before their fixes. Exact prepared CI and
a fresh independent review of the repaired commit are required; the earlier
review does not approve this source. The historical M0 run is reused locally
only after its exact input hashes are reverified unchanged; it is explicitly
labeled as an earlier execution.

## Historical iteration 1

The following original files remain unchanged evidence for source
`627f0a7982d342bf23a0a59c0b019f2828f5b79d`. Successful checks and review missed
the two mapping defects above and do not establish the repair's acceptance.

`command-report.json` is emitted by `npm run test:commands` inside the full
workspace gate. It compares actual native and compiled-WASM Session/provider
behavior, including24 independent literal documents/carets,64 generated Unicode/
layout/mark Enter cases,4 generated EGC-interior refusals, future typing and7
structural plus8 inline groups. Its source hashes bind all observers and provider/
engine inputs; its binary hash is the local compiled test-only probe. Cross-host
WASM hashes may differ; this is semantic agreement, not bit-identical builds.

The counted profile wraps the24 literal,68 generated and future-typing cases.
It proves no ordinary admission/snapshot/canonical-buffer hook calls in those
runs. Supplemental structural/inline observers use the actual plain KWDJ profile;
their explicit checkpoints and labeled final-context probe are separate evidence.
Target-dependent raw work/journal byte counts are checked within each target and
excluded from portable comparison. Preview allocator high-water purity and late
counter/normalization/finalizer failures also have a compiled non-KWDJ unit
provider witness, without leaking engine policy into KWDJ/core.

`local-verification.json` records full local gates and raw log digests. Initial
local all-target clippy found a complex fixture type; a test-only type alias
resolved it before the recorded final successful checks. No CI was used to debug
that lint. The102-case M0 browser regression ran once against unchanged input
hashes in parallel with final Rust work. `m0-observations.json.gz` preserves the
exact new observations; the original OSR-58 artifact was restored byte-for-byte.
These are harness observations (including historical MET/GAP classifications),
not production editor/OS IME/assistive-technology acceptance.

The independent command expectations live in `contracts/commands/v1/vectors.json`;
codec authority remains `contracts/kwdj/v1`, whose expectations are unchanged.
[Command contract](../../docs/commands.md) and [baseline disposition](../../docs/command-parity.md)
assign UI/SDK/history/CMS gates explicitly. Exact prepared CI, independent Grok
review, merge and post-merge evidence belong to the Linear delivery/closing
records; local evidence alone does not close the task.
