# Notes capacity calibration before performance capture

Primary Codex decision,18.10.2026, before further feasibility probes or production timing capture. This is a test-input selection decision, not a product budget change or implementation review. Original four OSR-38 acceptance criteria remain unchanged.

The independently generated maximal Notes controls were tried once through the actual native public Session with unchanged defaults: long leaf1048576 text bytes /1048874 canonical bytes /3 nodes; many blocks10000 paragraphs /870212 bytes /10002 nodes; near nodes65535 authored nodes /5701583 bytes; near bytes15720000 text bytes /15722622 canonical bytes /31 nodes. Each returned the existing typed Notes resource-limit profile error. The first diagnostic runner converted that error into its own `expect` panic/exit101; this is retained as a harness failure, not a production panic, crash or successful admission. The accepted deep case had41 nodes/depth41. Original receipt `/tmp/osr-38-perf-shape-admission-smoke.json` and its exact stdout/stderr inventory remain immutable. All seven original KWDJ shapes admitted successfully in that same correctness-only pass.

Notes semantic maxima in `crates/notes/src/profile.rs::NotesLimits::default` are16MiB document,65536 nodes,48 depth,1MiB leaf. Their independent operational work bound remains1M units/64MiB. Semantic eligibility does not promise that every maximal shape fits finite operational admission. No Notes production budget, transaction budget, codec or engine API is raised or rewritten.

Before any more probes, freeze this ordered quantity ladder. Every rung is attempted and retained on accepted64, native public Session and actual sealed WASM/SDK2, under unchanged defaults. Quantities are input facts, not values learned from runtime output:

| Shape | Quantity meaning | Ascending ladder |
| --- | --- | --- |
| long leaf | ASCII text bytes in one text leaf |16384,32768,65536,131072,262144,524288,1048576|
| many blocks | paragraph count; first contains one ASCII `x`, others empty |128,256,512,1024,2048,4096,8192,10000|
| deep ancestors | nested callout count around one paragraph/text; semantic document adds one level |4,8,16,24,32,38,45|
| near nodes | total authored nodes including semantic document, paragraph and first text |1024,2048,4096,8192,16384,32768,65535|
| near bytes | total ASCII text bytes split into paragraphs with at most1048000 bytes/leaf |65536,131072,262144,524288,1048576,2097152,4194304,8388608,15720000|

Both profiles' list/table applicability remains explicit; Notes has no compiled list/table capability. The largest rung accepted on **both** native and actual WASM defines a frozen reference capacity input. Preserve all larger typed refusals and all original maximal controls as first-class capacity evidence. Candidate uses the exact same selected inputs and maximal controls; it never independently selects a smaller rung. Report exact counts/bytes/source/artifacts/capabilities and distinguish near-default-admission-capacity from near-semantic-ceiling. Admission, command feasibility and explicit export feasibility are separate facts; never time a refused operation as successful work.

For an operation whose budget differs from admission, evaluate command/export
feasibility over the SAME predeclared ladder during accepted64 calibration,
retaining every result. Freeze its largest jointly feasible rung per measured
operation before candidate capture. Do not substitute a smaller candidate input
or omit a refusing maximal control. Final release binaries must verify every
selected input/operation again; a debug correctness probe is not release timing.

Public Notes admission currently creates its own private WorkMeter and may omit exact usage in a resource diagnostic. Therefore report this telemetry limitation explicitly. Public authoritative validation WorkMeter usage and any separately fixed host-reduction observations may be reported with their exact phase; neither is total codec admission usage. No fabricated exact work/headroom or new public setter is permitted. Final selected-rung receipt and any qualification are frozen before candidate or timing capture. This decision does not claim calibration, reference comparison, CI or final acceptance has already passed.
