# Selection v1 erratum 002 — mixed-mark typing is isolated

Implementer decision, 19.10.2026. Identified by Chromium development runs02/03;
the five-second read-only state poll confirmed the original failure. No frozen
v1 data, native grouping implementation or accepted history semantics changes.

Bookmark data calls its mixed-mark `open_typing` document `OPEN_GROUP`, claiming
an open typing group after inserting a strong `x` into a plain paragraph. That
setup cannot establish the asserted group: accepted pre-OSR40 engine
`grouping::uniform_text` requires identical leaf marks for its typing footprint;
`TypingCandidate::finish` declines a mixed-mark footprint, and `history::prepare`
opens a group only for a valid footprint. The insertion remains a successful
isolated undo entry. This is an independent existing rule, not a candidate fix.

The older frozen `contracts/history/v1/vectors.json` policies `typing` and
`history_request_guard` expressly require the engine-checked marks/context and
preserve the history epoch at an already sealed boundary. Consequently the
original BM-FX01 mixed-mark gesture still must clear the explicit strong override,
change selection_epoch3→4, preserve exact canonical/IDs/revision1/undo1/redo0,
invalidate the old bookmark and publish exactly one state event. Its history
epoch remains1: this valid mixed-mark edit was already isolated. All other
SEALED_GROUP facts remain as originally authored; the erroneous open-group claim
and H2 are not accepted evidence of grouping.

Require a second, separately named mounted witness from **pre-existing frozen
history H04/H05**, not a candidate-generated document: start `documents.empty`,
select Child(P,0,After), type literal `a` with explicit typing token, bind the one
actual Text to historical role T, then physically/protocol-click T:0. Require
the pre-existing `documents.a` canonical result and the H05 navigation boundary:
revision1/document/IDs/dirty/undo1/redo0 remain; history_epoch1→2, current selection
T:0/After, one new state event and zero new document events. The same token's
following `b` must form a second undo unit and produce exact `documents.ba`, as
already fixed by H05. This verifies that a real open group was sealed, rather
than merely trusting a hidden open-group label. Stored-mark clearing is separately
proved by the unchanged original mixed-mark witness.

Keep the failed raw runs, original assertions/data and this explicit correction
in delivery evidence. No new expected documents come from runtime output; all
positive canonical documents above predate OSR40. This erratum neither waives AC
nor replaces browser/local/installed/exact-SHA independent-review requirements.
