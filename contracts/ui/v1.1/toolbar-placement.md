# Toolbar placement v1.1 — OSR-42

Additive source-authored expectations before floating-toolbar implementation.
Existing UI/evidence are historical, not proof of this extension. Root freezes
these files before code. Base: v1 manifest SHA256
`4f6f643c8fcc4f6b8716b614862173400dcc08436114462d450e923dc9eec889`;
all v1 bytes/native literals remain unchanged. Original scope requires floating
toolbar; v1 ui-behavior:85 permits conditional fallback, while placement-decisions:5
puts specifically global Add below the document. No API/command/profile changes.

## Placement and fallback

For genuine measured visible current native selection/caret, with available nearby
above or below space, present the SAME toolbar near its fragments. Read existing
selection geometry with exact current stamp/context. Geometry never authorizes
an action. A docked toolbar alone does not satisfy positive placement.

Let E bound independently measured visible positive-height selection fragments
and usable carets; V is actual viewport, with fragment visibility intersecting
its geometry clip. Width-zero positive-height caret is valid. Actual toolbar B:

- finite positive dimensions; wholly inside viewport inset8 CSSpx;
- wholly above OR below E, gap4..24px; no overlap with visible fragments/carets;
- horizontal distance from a visible fragment/caret <=24px; middle-case projections
  overlap. Tolerance0.5px applies to geometric comparisons.

These are independent bounds, not an exact pixel algorithm or required CSS
position keyword. Flow-preserving relative offsets are allowed. Positioning must
not move editing content or actual selection/caret rectangles (tolerance0.5px).

For unavailable/invisible/nofit/unsupported/busy/stale geometry, clear own placement
left/top/state and retain connected sticky/normal-flow entry and SAME keyed controls.
Never reuse stale coordinates, replace/reparent controls, focus, scroll, rewrite
selection or replay an action. Reason is evidenced by original typed response or
independent visibility/space proof; no new public diagnostic API is required.
`dom.composition_conflict` is busy; geometry limits/refusal remain unchanged v1.

## Independent checks

JSON maps existing V01/V02 literals to raw childNodes paths. Temporary DOM Ranges,
actual viewport/clip and actual toolbar dimensions supply expected bounds; candidate
coordinates/internal mapper/prior runtime outputs never supply goldens. Apply finite
external fixture CSS BEFORE baseline; no later focus/selection/scroll assistance.
Failed setup feasibility is FAIL, never skip/retarget. Nofit proves BOTH sides
insufficient for actual B, inset8 and gap4.

Preserve exact native canonical/IDs/full stamp/context/selection/marks/history/dirty/
events, browser endpoint objects/direction, activeElement, scroll, editing DOM and
keyed controls. All existing K01/T01/T02/L01,32px/RUEN/200%/Tab/focus/undo assertions
remain. Keep one RAF capacity and existing disposal; no polling or semantic queue.
External CSS/bounded CSSOM left/top only; no style-attribute/cssText, unsafe-inline/
eval/hash exemption or violation filtering. Normal CSP/errors/external requests
remain empty. Three-engine packaged proof and mandatory final-source/build local9
and installed protocol remain required; this authoring claims no execution/review.
