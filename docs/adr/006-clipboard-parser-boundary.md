# ADR-006: optional clipboard parser boundary

Status: accepted technical choice for OSR-47 implementation/proof, 21.10.2026.
Browser support, limits and product acceptance require actual task evidence.

The architecture selects parse5 as the first isolated HTML parser candidate.
Use the published parse5 8.0.1 package and locked entities 8.1.0, rather than
assuming the current upstream branch is the published dependency graph. Both
licenses and original package integrity are recorded before inclusion. parse5
is a parser; the profile allowlist decoder and native fragment validation remain
separate authorities. Parsed nodes and source HTML never enter the live editor.

The optional `@klenwriter/editor-kwdj/clipboard` subpath owns the KWDJ decoder.
Its parser module is lazy loaded. The concrete package runtime graph extends
ADR-005 to `kwdj -> {sdk, dom, parse5}`; generic DOM/SDK/core do not import parse5
or a concrete profile. The root KWDJ entry does not import clipboard parsing.
No new package identity or Angular dependency is introduced.

esbuild 0.28.2 is a build-only dependency used to produce and inspect an actual
browser ESM parser graph. It is absent from browser runtime and native/core
closures. The parser bundle has no external Node builtins or dynamic code
evaluation. Preserve parse5/entities license texts and generated legal notices.
Record exact inputs/outputs, metafile, raw/gzip sizes and hashes. These build
properties do not alone establish the pipeline's no-fetch/browser acceptance.

Before parser execution, enforce source limits. A metered tree adapter bounds
application-visible parser construction and decoder traversal; final output
also observes native profile limits. A deadline does not interrupt synchronous
parser work, and a post-read limit does not bound ClipboardData's initial
whole-string materialization. Keep those limits and raw-retention outcomes
explicit rather than presenting them as a process-memory guarantee.

Required proof covers the selected published graph in all three browser
engines, no unexpected resource loads/live DOM insertion, bounded failure and
profile/canonical conformance. If the parser gate fails, compare an isolated
DOMParser adapter under the same requirements before choosing a replacement.

Rollback: remove the optional clipboard subpath, parser bundle integration and
paired manifest/lock changes. Persisted KWDJ and existing clipboard/cut contracts
do not require migration.
