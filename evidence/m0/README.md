# M0 architecture evidence

The editable [FigJam board](https://www.figma.com/board/MfPnaBZYxczK6Yi9qd6fiv) contains the current M0 v2.0 module, editing, asynchronous lifecycle and decision sections. Earlier sections are retained and explicitly labelled Historical v1. [figjam-manifest.json](figjam-manifest.json) records node URLs and SHA-256 of each portable PNG export; [figjam-readback.xml](figjam-readback.xml) is the board text/structure read-back after the final flow-label update.

| Export | Meaning |
| --- | --- |
| [Modules](figjam-modules.png) | Core/profile/browser/host responsibilities, direction of dependencies and task owners |
| [Editing](figjam-editing.png) | Input/composition, candidate normalization/validation, atomic commit/refusal, history and render notification |
| [Async lifecycle](figjam-async-lifecycle.png) | Stale replies, save receipts/conflicts/recovery and WASM load/fatal paths |
| [Decisions and reading guide](figjam-decisions.png) | Architecture, Linear, UX and decision-register links |

All four exports were visually inspected. The board remains editable; the textual [module/flow contract](../../docs/m0/architecture-flows.md) defines precise IO and seven scenarios where a diagram abbreviates details. The [master plan](../../docs/m0/master-plan.md), [architecture rationale](../../docs/m0/architecture.md), [decisions](../../docs/m0/decision-register.md) and ADRs remain readable without Figma.

`dependency-graph.json` is the complete live Linear snapshot: 48 tasks, 136 blocking edges and an acyclic topological order. `npm run check:m0` validates graph/traceability, local file links and declared export hashes. It does not claim to test access to external URLs or to implement the editor. Independent review, exact reviewed commit, matching CI and owner decisions are recorded in the delivery PR and Linear; those live delivery records are not fabricated into this pre-commit evidence.
