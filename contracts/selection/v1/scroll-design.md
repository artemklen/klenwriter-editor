# OSR-40 independent scroll oracles — Refine proposal

[Data](/tmp/osr-40-independent-scroll-oracles.json) is independently authored fixture arithmetic and model/rawDOM
role tables, not Ready/freeze/start permission or an executed result. Only two
outside files were written; no fixture/source, runtime, browser/native, tests,
network/Linear or branch action occurred. Root reports39Done/mainff2bd31.

The JSON materializes64 rows, the57-child literal model document (138nodes incl
root), separate model and raw `childNodes` role paths, row boxes at scroll0/1356,
selection membership and12 controlled cases. Opaque native IDs bind once to the
preauthored role paths before the gesture. RawDOM expectation follows literal
DIV→P→SPAN→Text or DIV→BLOCKQUOTE→UL→LI→P→SPAN→Text objects; production mapping
helpers/candidate selection are forbidden as expected-output generators.

| Direction | Initial scroll / anchor | Mandatory terminal focus | Independent raw Text path |
|---|---|---|---|
| Down |0 / R04:1 after|R63:3 after|anchor `[4,0,0]`, focus `[56,0,0]`|
| Up |1356 / R59:2 after|R00:0 after|anchor `[52,0,0]`, focus `[0,0,0]`|

Nested paragraph R24..R31 model block paths are `/24/0/{0..7}/0`; their model
text adds `/0`, and raw Text adds two zero child indices to the block path.
R16 is one HR/scene_break structural atom, no text or fake character. Both terminal
ranges cross it once and all eight nested rows. New DOM points use after under
root's current policy; bookmark before-affinity tests remain separate. Offsets
remain UTF-16 code-unit counts with scalar-boundary checks, never scalar indices.

Padding20/40 gives scrollHeight1596 and maxScroll1356. Literal row top is
`80+20+24*r−scrollTop`: R00 at min100..124, R63 at max256..280, down anchor
R04 before196..220, up anchor R59 before160..184. All fit clipped100..280 and
plain80..320. This proves feasibility, not an actual caret measurement. Keep
finite positive-height collapsed-focus Range geometry and all four clip edges.
Clipped wrapper should use fixture-only `overflow:clip` so it is not another
programmatically scrollable hidden ancestor; freeze this CSS choice and actual
client boxes before runtime. Hide scrollbar presentation if needed to retain exact
client width640; no assumption that every installed engine uses overlay bars.

No suitable repo font was found; installed Playwright assets contain only codicon.
Propose copying unchanged local
[JetBrainsMono-Regular.ttf](/Users/artem/.agents/skills/synced/87c0046d-5e82-4cb5-9a8f-5e0e7b19fbc9_4cda9f85-150c-4281-80fa-3ffadf785e49/canvas-design/canvas-fonts/JetBrainsMono-Regular.ttf) and
[OFL notice](/Users/artem/.agents/skills/synced/87c0046d-5e82-4cb5-9a8f-5e0e7b19fbc9_4cda9f85-150c-4281-80fa-3ffadf785e49/canvas-design/canvas-fonts/JetBrainsMono-OFL.txt) into test-only assets before freeze.
Font114904B SHA `b6b1ff4ddefe36d7f2a6174e1d001cab374e594519ee9049af028d577b64c5f5`;
license4492B SHA `4d9694c4844a13ea377458c3f98c90d2bf83d3c214612dcae2b7808406520708`.
Attribution: Copyright2020 The JetBrains Mono Project Authors; OFL-1.1. No package
runtime dependency, system font reliance, download or copy was made. Font tables
show600/1000 advance for R/digits, so16px yields9.6px glyph advance. Disable
kerning/ligatures, load the exact aliased FontFace from a narrow same-origin route,
record face.status=loaded and actual row/advance geometry before pointerdown.
`document.fonts.check` alone does not exclude fallback. Font-face rule and exact
source/license paths+hashes are in JSON; root will review/copy license+notice.

Initial fixed scroll0/down or1356/up is permitted only before pointerdown. Literal
anchor hits are (109.6,208)/(119.2,172); held x is128.55/down or100.25/up. Held y
is effective bottom+8 or top−8: plain328/72, clipped288/92. These are proposed
preauthored CSS coordinates, not candidate-derived terminal corrections. Verify
geometry/DPR/viewport→screen conversion; failure is setup failure. During/after
gesture no wheel, scrollTop, scrollIntoView, model endpoint injection or reselection.

Each direction×clip mode has terminal_release, active_release, active_cancel.
Terminal cases require exact literal endpoints within8s, not merely scrollTop or
last visible row. Active cases end after two positive distinct scroll advances
with directional range remaining; they intentionally have **no fixed transient
focus**. Require valid owned scalar-boundary points, monotonic logical progress,
exact anchor at every publication/sample and no state loss. Snapshotting an actual
settled transient point is only a stability baseline. If active window is not
exercised, it does not become a passed terminal/cancel case.

Cadence100ms; at most one actual settlement RAF with100ms absolute deadline; then
five100ms stable samples with all scroll owners/selection unchanged and zero owned
RAF/capture/continuations. Full actual focus caret visibility≤0.5px tolerance is
mandatory at initial/terminal/stable checkpoints; in-progress visibility is
recorded separately from the terminal literal. Bounded scroll/publication records
supplement cadence so temporary anchor drift is not hidden. These budgets remain
Refine proposals, not observed speeds or a new production SLA.

Synthetic active_cancel is explicitly controlled, isTrusted=false and proves no
physical pointer cancellation. Automated mouse protocol is also labelled separately
from installed physical Chrome/Safari EN/RU. A real native cancellation needs its
own trusted stimulus/receipt; no generic desktop-input capability is proposed.
Firefox labeling cannot waive configured mandatory assertions or hide missing
font/geometry/ownership instrumentation.

Document bytes/revision/IDs/dirty and undo/redo entry counts remain stable. Native
set_selection effects on selection epoch/events, stored_marks clearing and sealing
an open group/history_epoch follow the existing native contract. The fresh geometry
fixture starts with null stored marks/no open group; a separate selection control
must cover those side effects. No blanket “history unchanged” oracle. Full clipboard47,
IME41 and AT69 remain outside these scroll data; all five40 AC still apply.

Before freeze root must commit the literal data, copy/review the pinned test font
and notice, confirm overflow/scrollbar geometry/CSP and timing/cancel provenance.
No expected endpoint may be repaired from a later candidate observation.
