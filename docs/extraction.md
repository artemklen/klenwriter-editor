# OSR-29 — native document semantics extraction

KlenWriter Editor extracts owner-controlled semantics at CMS revision
`a7f8a081b7827dd31097ad6c9104654366ae6e04` under the accepted D10/D11 grant.
[Per-file provenance](../provenance/source-files.json) identifies source hashes,
license, adaptations and exclusions. No private documents or production captures
are imported. The authoritative corpus remains in CMS until OSR-30 completes
its provenance/parity transfer; this extraction does not create a second corpus.

`editor-internal-core` contains schema-independent draft trees, borrowed structural
metrics, canonical JSON/Pointer helpers and limit primitives. It has no KWDJ node
names, authored CMS identity fields, resolver, renderer or reading-time policy.
A draft tree is untrusted. It cannot construct a normalized profile capability or
a committed editing session. The session/transaction API belongs to later work.

`editor-internal-kwdj` owns the closed v1 wire DTO, decoding, normalization,
validation, equality, manifests and the three text projections. Its public DTOs
are untrusted; `NormalizedDocument` stays opaque and has no Deserialize, Default
or unchecked constructor. Its `model()` is a read-only borrowed view for native
renderers. `IdentityResolver` is supplied by the host; the codec does no network
or database I/O. CMS audit word/reading-time policy and HTML rendering stay in CMS.

`Limits` carries the seven normative v1 maxima. Default entry points preserve the
existing CMS behavior and diagnostic strings. Explicit host limits only tighten:
each requested maximum is clamped to the profile ceiling. Candidate admission
retains the effective limits through normalization. Limits count canonical bytes,
not transport whitespace; they are not a claim of a separate raw-input budget.

`to_core_document` and `admit_core_document` are full snapshot boundary operations,
not per-keystroke transaction paths. Import uses the same closed profile validator
and host resolver, checks depth/node ceilings and compares the round-trip draft
so primitive mismatch or extra data cannot disappear silently. Independent draft
schemas can use core without depending on KWDJ. Public extension descriptors and
incremental engine operations remain OSR-64/OSR-33+.

The extracted native crates support Rust 1.89.0, matching the CMS CI compiler.
The reproducible artifact builder continues to use pinned Rust 1.97.1 and
wasm-bindgen 0.2.129. This is not a CMS compiler upgrade. The locked URL/IDNA/ICU
semantic dependency versions retain the baseline versions; bootstrap-only WASM
ABI dependencies retain their newer pins.

## Verification

- `cargo +1.89.0 test --locked -p editor-internal-core -p editor-internal-kwdj`
- `npm run check` (native, WASM build, dependency closure, packaging and browser smoke)
- `python3 scripts/extraction-diff/run.py --cms /path/to/klenwriter-cms --output /tmp/native-differential.json`

The differential runner reconstructs only the pinned domain crate from git
objects, seeds its baseline lock and compares both normalization modes and both
identity outcomes on the CMS corpus. It writes source paths/hashes, canonical and
projection hashes, manifests and closed diagnostics, never authored text. The
[recorded native result](../evidence/osr-29/native-differential.json) has 265 equal
comparisons, including one separate synthetic known-defect proof. This is an
extraction check, not the full native/WASM corpus conformance gate of OSR-30.
New boundary tests cover all 24 node and 10 mark kinds, exact reopen bytes,
manifests, projections, Unicode structural metrics, host limits and refusal of
untrusted generic data. The transferred regression source is synthetic.

## Known inherited defect

[OSR-74](https://linear.app/klenwriter/issue/OSR-74) tracks unbounded stanza-break
projection expansion and a u64 overflow panic. The isolated debug probe catches
the panic for u64::MAX before expansion. Neither ordinary parity nor successful
builds establish hostile projection safety. The fix must preserve stored v1 data
and use explicit bounded failure rather than silent truncation; OSS release is
blocked until it is integrated. Do not exercise arbitrary huge stanza loops.

## Native CMS integration and rollback

CMS pins the extracted profile by immutable public git revision. Its existing
`kwdj` facade keeps renderer/audit policy and delegates admission to that pin;
wire format, API/persistence and reading-time rules remain the same. Exact pin,
regression results and matching review/CI are recorded in the CMS change and
Linear OSR-29 before acceptance. Rollback reverts the CMS extraction commit and
its lock update, restoring the original local domain modules. No data migration
or storage-version rollback is necessary. Update core/profile and the native pin
together in later reviewed changes; never substitute a floating branch or path
in the delivered CMS dependency.
