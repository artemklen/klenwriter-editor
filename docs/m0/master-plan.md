# Editor WASM — master plan v3

Version: M0 2026-10-17. This is the implementation plan and evidence index for the architecture package. The production editor is not implemented in M0.

## Product and scope

Build a standalone open-source Rust/WASM document editor, with KlenWriter CMS as its first integration. The generic document engine has no CMS imports. KWDJ v1 is a profile and codec; an independent notes profile exercises the same public extension contract. GitHub `artemklen/klenwriter-editor` is the canonical repository; no GitLab mirror.

The project includes replacement or explicit retirement of every Angular Tiptap v3 and legacy Askama Tiptap v2 consumer, followed by complete dependency/asset removal. It does not imply a whole Askama-to-Angular rewrite or silent Markdown-to-KWDJ conversion.

Required v1 targets are desktop Chrome and Safari, RU/EN native input and ordinary dead keys. Firefox stays experimental, with mandatory measurement and a separate post-v1 promotion gate. Broken instrumentation remains a failure; an experimental behavioral gap is not hidden. Mobile, collaboration, CJK input and real screen-reader acceptance are beyond v1. Keyboard, focus, semantic markup and axe checks remain required. Unicode text storage itself is unrestricted by RU/EN product scope.

The initial release matrix and exact-version policy are in [decision register D04/D05](decision-register.md). Current M0 native evidence is macOS; it does not certify the future Windows Chrome release lane.

## Architecture and rationale

The [detailed architecture](architecture.md) explains growth boundaries, immediate constraints, alternatives, external libraries and the cost of omitting each. The [module and scenario contract](architecture-flows.md) assigns input/output/ownership to modules and covers successful edits, refusal, composition, undo, stale asynchronous replies, save conflicts and WASM load failure.

- [ADR-001: one editing host](editing-host-decision.md): preserve native cross-block selection, add explicit reconciliation and scroll behavior.
- [ADR-002: extension and profile contract](extensions-contract.md): frozen per-session registry; bounded declarative schemas; trusted compiled Rust modules for new semantic rules/codecs; no runtime untrusted plugin sandbox.
- [ADR-003: positions and history](unicode-positions.md): UTF-16 SDK coordinates, typed UTF-8 offsets inside Rust, grapheme-safe user operations and exact semantic inverse replay.
- [Decision register](decision-register.md): ownership, licensing, corpus authority, package-name candidates, unsupported content and evolution policy.
- [Performance protocol](performance-protocol.md): synchronous main-thread WASM and full DOM first; worker, rope and offscreen unmount require measured benefit and correctness evidence.

The host owns product dialogs, authentication, uploads, persistence, recovery and conflicts. Library UI may offer optional generic shells. Captured session/generation/revision/selection tokens protect asynchronous replies. Dirty events schedule explicit snapshots; they do not serialize the whole document on every key.

## Evidence package and its limits

| M0 task | Versioned artifact | What it establishes |
| --- | --- | --- |
| OSR-27 | [Decision register](decision-register.md), [licensing](licensing.md), CMS source provenance | Owner-approved MIT OR Apache-2.0 and scoped source/fixture transfer; third-party provenance remains checked per file |
| OSR-58 | [Browser decision](editing-host-decision.md), [native protocol](native-protocol.md), evidence/osr-58 | Three-engine comparison and installed Chrome/Safari/Firefox observations; single-host choice; known gaps; no production Rust adapter proof |
| OSR-57 | [Extension contract](extensions-contract.md), [profile vectors](../../evidence/osr-57/README.md) | KWDJ-shaped and independent-profile admission/registration examples; bounded reference checks, not a complete KWDJ codec |
| OSR-59 | [Positions/history](unicode-positions.md), [reference vectors](../../evidence/osr-59/README.md) | Explicit expected coordinate/operation/undo/refusal outcomes; no complete Rust or DOM engine |
| OSR-60 | [CMS inventory](cms-inventory.md), evidence/osr-60 | Exact source inspection, 7 Angular hosts/9 routes and 5 legacy forms, source hashes, 34 fixture IDs/59 cases/11 stages; no fabricated rerun of CMS tests |
| OSR-61 | [Protocol](performance-protocol.md), evidence/osr-61 | Reproducible calibration and raw samples separated by layer; measured/unsupported/censored results; no production SLA inferred from the small kernel |
| OSR-62 | [UX contract](ux-contract.md), [Figma evidence](../../evidence/osr-62/README.md) | Eight editable scenarios and keyboard acceptance scripts; no runtime or real AT acceptance claim |
| OSR-56 | [Module/flow contract](architecture-flows.md), [FigJam evidence](../../evidence/m0/README.md) | Diagrams, owners, interfaces, failure paths, ADR links and portable exports |
| OSR-26 | This plan, [delivery map](delivery-map.md), exact reviewed PR/CI and Linear acceptance record | Observable exits, complete requirement mapping, acyclic task dependencies and explicit remaining implementation gates |

PR #1 is merged at `922c5c6afc5772e114938a790c2abf0c75944108`; its [post-merge CI](https://github.com/artemklen/klenwriter-editor/actions/runs/38969622549) passed. The rest of this M0 package has its own reviewed commit and matching CI recorded in the delivery PR and Linear; an uncommitted working tree is not a release version.

## Implementation order and milestone exits

The [delivery map](delivery-map.md) is the complete 48-task inventory, with 136 blocking edges and a machine-checked topological order. It also maps each requirement to its contract, implementation task and acceptance. A dependency means readiness to accept a result; research and scaffolding can proceed in parallel.

| Milestone | Observable exit |
| --- | --- |
| M0 — Architecture and feasibility | Reviewed ADRs, browser evidence, profile/Unicode vectors, live CMS inventory, performance calibration, UX/FigJam and recorded owner decisions |
| M1 — Standalone library and KWDJ profile | Reproducible native/WASM build, extracted semantics, one authoritative pinned corpus, parity/provenance/license/package-name checks |
| M2 — Editing engine and SDK | Atomic operations, mapping/history/lifecycle, versioned DTO parity, independent profile through public API, property/fuzz/performance gates |
| M3 — Browser and standalone alpha | Installable vanilla example; required input/selection/clipboard/UI/states; security/keyboard/focus/semantics; three-engine evidence and a measured virtualization go/no-go |
| M4 — Complete KWDJ capabilities | Domain containers, poetry/tables, host media/link/reference adapters, stage-aware mounted parity; preservation and new authoring checked separately |
| M5 — CMS pilot | Real CSP delivery and native validator, Angular pilot, save/reopen/conflict/auth/navigation/recovery, rollback without draft loss |
| M6 — Full CMS cutover | Every Angular/legacy surface replaced or explicitly retired, rollback drill/observation, then zero Tiptap v2/v3 imports/manifests/locks/bundles/runtime paths |
| M7 — Open Source 1.0 | Clean external consumer, reproducible packages, contribution/security/support docs, exact artifact checks and M6 complete |

Critical path: M0 → workspace/profile/corpus → session/transactions/SDK → browser/input and KWDJ capabilities → CMS pilot → both cutovers → Tiptap removal → 1.0. OSR-73 Firefox promotion has no blocking edge into M0–M7.

## CMS migration invariants

The inventory pins CMS source at `a7f8a081b7827dd31097ad6c9104654366ae6e04`. Preserve current KWDJ envelope, normalization and limits; server rendering/API/persistence are not silently migrated. Existing locked reference-entity bodies remain locked while their create flow can be editable. Legacy Markdown fields retain their contract unless a separate lossless migration is accepted.

The canonical corpus remains in CMS until owner-approved provenance transfer and parity pass. It then lives in editor `contracts/kwdj/v1`; CMS consumes a pinned version and digest, not a mutable duplicate. Imported CMS code/fixtures need per-file provenance and third-party notices even after the owner's rights grant.

## Acceptance and next phase

M0 acceptance records exact artifact versions, independent review, applicable checks and Linear/FigJam read-back. Product scope and rights grants belong to the owner; technical design choices belong to the primary architect by delegation. M0 completion does not authorize deployment, publishing packages or beginning an unspecified production rollout. M1 implementation follows its own task contracts.
