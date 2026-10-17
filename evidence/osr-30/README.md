# OSR-30 local corpus evidence

`corpus-report.json.gz` is a machine-readable execution snapshot, not an
independent review or merge receipt. Its SHA-256 is
`d932a0e276b3e6d30a6761dfe55f8fbaa38848f57a3b07f9bcec1e1564d374b7`.

The authoritative data lives in `contracts/kwdj/v1`, version 1.0.0, content digest
`c3242ce26108229fbdf151af1e299d3cfe849c92738b0a2afbf733d12aef2b28`.
The report includes source/runtime hashes, 34 IDs, 59 named cases and 277 stage
memberships per runtime (831 rows): 400 passed, 21 deferred, 36 not applicable,
29 not exposed and 345 owned by other components. There are 60 expanded primary
codec inputs: 43 accepted and 17 refused. The separate actual public codec lane
executes all three operations (180 comparisons), including canonical reopening.

Native and compiled-WASM projection observations agree with literal corpus
expectations. The observer is test-only, outside the installed public API.
Bounded hardening74/75 runs actual assertions on both targets; 48 invalid-field77
comparisons and exact u64 projection refusal are recorded separately. All
extension vectors run through the frozen M0 reference; six production/native/
WASM wire comparisons establish KWDJ admission and safe notes-format refusal,
not production extension-registry support (OSR-64).

Local full `npm run check` passed. After adding the non-case version-reuse guard,
the seven package tests passed separately; CI runs the final combined suite.
Twelve workspace browser smoke tests and 102 M0 browser scenarios passed. The
latter retain 28 MET / 26 GAP / 48 observation dispositions; a collected scenario
is not a fulfilled editor requirement. Frozen M0 evidence was restored exactly.

Reproduce with `npm run check`, then `npm test` and
`node scripts/summarize-evidence.mjs`. Preserve new M0 observations separately;
do not overwrite the accepted frozen M0 package in a corpus delivery. CI uploads
fresh reports from `artifacts/`; delivery receipts bind the prepared commit and
postmerge checks separately. No corpus expected values or runtime schema/maxima
were changed. CMS pin verification and its own stage tests remain separate gates.
