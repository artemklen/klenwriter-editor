# IME composition contract v1 — OSR-41

Normative pre-candidate contract for the production single editing host.
Architecture v2, master plan v3 and F03 remain authoritative. Base main
`69d8cffe2704d7c868c240344c7c3131b0b10d82`; all native semantics stay in Rust.
No acceptance execution or implementation success is asserted by these files.

The user can compose and replace a selection, including compatible paragraphs
around a selected scene_break, without provisional history or duplicate commits.
The adapter preserves UA-owned composing objects, refuses conflicting work and
retains input when it cannot safely reconcile. Existing SDK2 and isolated native
InsertText are the sole command/event authority. Cancel means unchanged complete
correspondence, not Escape, blur, end.data or trust alone.

- state-machine.md freezes ownership, cadence, original ticket, new intent,
  deduplication, recovery and lifecycle. Its timing/caps are engineering choices
  adopted before the candidate, not universal guarantees of browser quiescence.
- public-api-additions.ts freezes the small additive recovery provenance; no new
  public composition command or queue is introduced.
- native-oracles.json and inputs/expected contain independently authored native
  literals, roles, history and explicit measurement qualifications.
- structural-correspondence.md and dom-oracles.json freeze actual DOM windows,
  object identities, prefix/suffix/atom membership and refusal ownership.
- event-oracles.json supplies finite controlled event-policy rows, separately from
  actual native/WASM/browser/OS evidence.
- installed-matrix.md specifies real Chrome/Safari EN/RU/dead-key acceptance.

Native role tokens bind to actual initial IDs; historical undo must revive those
same IDs. Candidate output is never made a golden. Target-local measurement and
opaque transient allocations are disclosed rather than guessed. Every supported
positive and every refusal has its own outcome; unknown/unsupported is not PASS.

Before runtime changes, commit this directory with a byte/SHA manifest and source
pin ledger. The old frozen DOM39 and selection40 directories are immutable history.
Change an assumption through an explicit new pre-candidate contract version with
reason; do not edit expected bytes to fit a result.

All five original Linear acceptance criteria remain mandatory. Verification uses
native + sealed WASM/packaged SDK, finite controlled Node tests, three-engine
mounted measurements and actual installed Chrome/Safari input. RU keyboard alone
is not IME; Playwright WebKit is not Safari. CJK/mobile/real AT and Firefox promotion
are separate gates. Data loss, stale overwrite and instrumentation errors are
failures. A measured Firefox behavioral GAP is recorded separately under v1 policy.

Complete the exact committed nine-command local pre-send gate, one prepared
build-only CI, independent Grok4.7/xhigh/OIDC exact-SHA review, normal exact-head
merge, one automatic postmerge build, durable raw archive/readback and cleanup,
then Linear Done/rollup. No publication/deploy is authorized by this contract.
Stopped OSR-38 campaigns and host diagnostics are not restarted.
