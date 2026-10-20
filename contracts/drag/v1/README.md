# Block drag contract v1 — OSR-44

Source-first design for the four original OSR-44 acceptance criteria. This is a
contract, not an execution receipt. Architecture authority is
`docs/m0/architecture.md`, master plan v3 and `docs/m0/ux-contract.md` frames03–04.
Base: accepted main `a21a7f8030afaeb4879fcbbd4953a7c76e098184`.

1. Allowed targets agree with the native profile; invalid drop/cancel leaves the
   document unchanged.
2. A whole structural block retains content, attributes and session identity;
   one changed move creates one isolated history unit.
3. Pointer and keyboard moves have equivalent structural results and declared,
   predictable focus outcomes.
4. External drop cannot enter around the clipboard policy; missing internal DnD
   does not satisfy the CMS cutover gate.

The compact composite geometry/profile API is in `api.md`; the gesture, bounds
and presentation owner are in `owner.md`; independent native/SDK expectations
are in `semantic-oracles.json` and `semantic-oracles.md`. Existing UI42 and
slash43 contracts remain immutable inputs, not inherited OSR-44 acceptance.

One primary mouse gesture moves one native structural block. A text range is not
a structural multi-block selection. Motion, preview, destination measurement and
scroll publish no model changes. Before/after and explicitly chosen inside
destinations produce the existing pre-removal native Move command. Rust alone
checks grammar, cycles, depth, maps and history. No delete/insert surrogate or
TypeScript validator is introduced.

The original mounted request, full stamp/context, source, handle and pointer
identity remain bound until terminal claim. No recapture, replay or implicit
selection write is permitted. Foreign focus and invalidation win. The keyboard
Move/Nest/Unnest alternative remains discoverable, including profiles without
the optional drag factory. The reference KWDJ profile must implement internal
drag before OSR-44 can pass.

## External HTML drag policy

Native HTML drag is separate from the outside handle's Pointer Events protocol.
The mounted surface cancels cancelable `dragstart`, `dragover` and `drop` before
browser default behavior; it never reads DataTransfer or its text, HTML, URI,
file or private MIME fields. Terminal start/drop reports
`dom.command_unsupported` through the mounted refusal callback. Unsupported
`beforeinput` types `insertFromDrop` and `deleteByDrag` refuse before selection
synchronization, command construction, ordinary observation or composition
dispatch. No native state/selection/history operation is submitted by this gate.

Events outside the mounted surface remain untouched. A noncancelable event is
reported as unsupported, not falsely described as prevented. If the browser
subsequently changes DOM, the existing correspondence/recovery path retains the
actual provisional data. Rich drop admission belongs to OSR-47; a forged MIME
or another editor instance is never an internal move capability.

## Evidence and completion

Source-authored literals and finite programs precede runtime observations.
Native/sealed SDK, controlled owners, actual mounted Chromium/WebKit/Firefox,
installed Chrome/Safari EN/RU and a bounded recorded usability pass have distinct
evidence. Mandatory three-engine measurements never hide harness errors;
Firefox behavioral gaps remain experimental. Missing required DnD/Chrome/Safari
behavior is not promoted to PASS. Full cleanup maps, exact source/build and raw
failures survive. No real AT, mobile, rich external import or CMS acceptance is
claimed here.

Repository checks run locally on the exact final SHA; CI remains build-only.
Independent exact-SHA review, merge, postmerge checks and cleanup precede Done.
Rollback removes the optional drag factory while retaining keyboard Move and
persisted documents; this fallback alone is not cutover-ready.
