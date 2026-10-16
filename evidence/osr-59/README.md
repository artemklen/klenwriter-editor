# OSR-59 — Executable position and selection vectors

The [ADR](../../docs/m0/unicode-positions.md) is the contract. These are synthetic M0 expected-value examples and a small JavaScript reference interpreter, **not** production Rust/DOM/native-WASM acceptance.

Run `node scripts/check-m0-contracts.mjs`. The [recorded report](reference-report.json) includes the interpreter/vector hashes and Node/ICU/Unicode versions. The run contains 219 counted checks across OSR-57 and OSR-59, with zero failures.

## What is actually executed

- [position-vectors.json](position-vectors.json): UTF-16/UTF-8 scalar boundaries; ASCII, Cyrillic, combining text, emoji ZWJ, regional pair, pure RTL and mixed bidi logical order, empty text; lone-surrogate and mid-byte refusal; separate scalar and grapheme coordinates; simple hand-calculated map endpoints.
- [operation-vectors.json](operation-vectors.json): 16 complete before/after/undo/redo vectors. Each gives explicit initial document and selection, operations, independently authored expected document and selection, endpoint provenance and revisions `7 → 8 → 9 → 10`.
- The checker computes each operation on a cloned candidate tree, builds inverse operations from affected original content, maps both selection endpoints, and compares the calculated commit to the literal expected result. It replays inverses for undo and forward operations for redo. Undo/redo restore the stored selection snapshots after replay, as specified by the ADR. Expected document/position values are never read by the interpreter.
- Covered operations: insert/replace/delete text; split/join; forward/backward same-parent and cross-parent move; delete nested subtree; mark run split and inverse merge; atomic insert/delete; structural hard break; insertion into an empty text leaf.
- Combining-accent insertion verifies `a → á → a → á`: internal history replay permits the exact scalar inverse, while a new user deletion inside the cluster still refuses. Half-surrogate history replay also refuses.
- The cascade vector deletes a child, then its parent, then its grandparent in one transaction. Both endpoints follow the recorded step maps to the surviving root gap and retain `deleted` provenance. It does not use DOM proximity or a single-level parent lookup.
- Eight refusal vectors verify scalar/grapheme boundaries, cross-mark cluster protection, cycles, duplicate IDs and atomic compound refusal. In the compound case an earlier candidate edit succeeds, a later move fails, and the original document/selection/revision remain value-identical.
- Five lifecycle reply vectors exercise exact session/generation, revision and selection-epoch comparisons with no mutation on stale replies.

The old `position-vectors.json.history` object remains an explicitly labelled static illustration. It is no longer counted as an executable undo/redo proof; the new transaction vectors replace that shallow comparison.

## Coverage and limits

| OSR-59 criterion | Evidence | Remaining implementation proof |
| --- | --- | --- |
| Separate UTF-8, UTF-16 and graphemes | Scalar arrays, invalid positions, `assertEditBoundary` across adjacent marked text leaves | Pinned Rust Unicode library/table version and native/WASM boundary conversion |
| Emoji, combining, Cyrillic, RTL/bidi, empty, nested, reverse selection | Text vectors and full operation vectors | Visual bidi/keyboard behavior and real DOM selection |
| Operation maps, deletion fallback, selection, undo/redo | Computed forward/inverse replay for 16 transaction cases; cascade deletion; `mapped/deleted` endpoints | Complete command algebra, normalization maps, production history grouping/retention, every profile invariant |
| Session identity/generation/export boundary | Stale-reply guards and documented export-key exclusion; historical identity revived by inverse replay | ID allocator/retired-ID set, actual wire codec export, remount and retention integration |

`Intl.Segmenter` uses the report's ICU version only for this reference/comparison lane. It is **not** the production segmentation pin. No visual bidi guarantee follows from logical offsets. The tree model is intentionally small: text/container/atom nodes, known IDs, whole in-memory candidate clones and explicit operation payloads. It does not implement production commands, profile grammar, efficient rendering, history budgets, save, async scheduling or a CRDT. The ID examples do not prove a production allocator prevents future reuse.
