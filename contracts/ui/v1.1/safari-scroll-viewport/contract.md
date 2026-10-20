# Safari direct-scroll viewport fallback — source contract

Status: SOURCE_AUTHORED_BEFORE_CANDIDATE. This additive private installed-fixture
geometry rule changes neither editor semantics nor accepted UI/native outputs.
Synthetic cases are authored independently of any diagnostic/candidate output.
No implementation API or public protocol DTO shape is frozen by these files.

## Route and native ownership

The existing exact-AXWebArea route, including its ambiguity refusals and Chrome
behavior, remains unchanged. Only Safari may consider this fallback, and only
when that original route found ZERO exact-size WebArea matches after the SAME
complete bounded scan: at most512 unique elements, depth at most32, native
identity deduplicated using CFEqual. A partial/truncated/failed scan, old-route
ambiguity, or another browser never authorizes fallback.

There must be exactly ONE AXWebArea in the entire exact owned root. Its genuine
DIRECT parent must be AXScrollArea, established from actual native identity and
tree membership. A required bar must be its DIRECT sibling under that same
ScrollArea, with the native scroll-bar role (kAXScrollBarRole / AXScrollBar) and
orientation exactly AXVerticalOrientation. Strings, descendants of another
container, heuristics or arbitrary nearby rectangles do not establish identity.

Original exact nonce/title/window uniqueness, front PID/bundle, same focused CF
root, root rectangle, bounded/deadline checks and final pre-post recheck remain
mandatory. Every physical action obtains its original fresh guard; readiness or
a prior measurement is never reused as input authority. No retry of an input,
extra down, coordinate warp, ownership fallback, or failure promotion is added.

## Geometry (screen coordinates)

Validate every used rectangle's original x/y/width/height and computed edges as
finite, with width/height strictly positive; do not standardize invalid sizes.
Let R be owned-root frame, S the direct ScrollArea, C its WebArea content, and
G = S.right - C.right. All comparisons below use actual measured coordinates.

* S.width/height must match request CSS viewport width/height × pageZoom within
  inclusive2px. CSS dimensions and zoom must themselves be positive and finite.
  S must be inside R within inclusive0.5px on each edge.
* abs(C.left - S.left) <=0.5; C.top <= S.top+0.5;
  C.bottom >= S.bottom-0.5. Require 0 <= G <=32 exactly. Content may extend
  vertically beyond S/R; it is not required to have viewport height.
* If G>0, require exactly ONE genuine direct vertical sibling bar B:
  abs(B.left-C.right)<=0.5, abs(B.width-G)<=0.5 and
  abs(B.right-S.right)<=0.5. Its y and height must be finite and height positive,
  but neither establishes a viewport origin/height, clipping or coordinate scale.
  In particular, B may be taller or vertically displaced relative to S.
* If G=0, no bar is required or used as coordinate authority. This permits an
  exact-width overlay-scrollbar configuration without a reported bar.
* Visible content is the exact positive intersection V=C∩S. Tolerances never
  expand V. Keep S as the FULL mapping viewport and C as the content frame.

For a required pointer, both CSS components must be present, numeric and finite;
require 0<=x<CSS.width and 0<=y<CSS.height. Compute exactly
screenX=S.left+x*S.width/CSS.width and
screenY=S.top+y*S.height/CSS.height. The computed point must be finite and inside
V with left/top inclusive and right/bottom EXCLUDED. A point in the classic bar
strip, or on V.right/V.bottom, refuses before posting. Do not clamp, round into
V, rescale using C/V width, or shift origins to admit it. Keyboard-only geometry
checks do not invent or require a pointer.

## Raw evidence and exclusions

Fallback proof must explicitly distinguish its basis, measured C content frame,
S full mapping viewport, V visible intersection and optional B/orientation. It
must not call S or V the measured WebArea frame. Preserve the original exact
route's proof meaning, original request/reply bytes and errors. Any successful
fallback is geometry authority only; all original trusted event/native/selection/
focus/history/resource assertions remain. Original Safari04/05 failures and any
UNKNOWN delivery stay unchanged; later cleanup does not grant an earlier PASS.

Mandatory structural negatives (in addition to numeric JSON cases): Chrome or
other browser; old matchcount>0 or ambiguous; incomplete/capped scan; duplicate
CFEqual traversal cannot inflate counts; zero/multiple WebAreas; parent not the
direct genuine ScrollArea; missing/non-direct/foreign bar for G>0; wrong role or
orientation; multiple direct vertical bars for G>0; nonpositive/nonfinite bar
geometry; negative/right-gap>32; C.top>S.top+0.5; nonfinite computed edges;
owner/PID/title/root/frame/focus/deadline change. For the classic case, CSS
(483,50) maps to the EXCLUDED visible right edge(493,110), and CSS(100,300)
reaches the EXCLUDED CSS/bottom boundary; neither may be clamped/admitted.

The JSON is data for independently compiled pure geometry controls, not a public
request schema. Its single string "NaN" encodes an IEEE754 NaN component for a
pure numeric test only; JSON itself contains no non-standard numeric token. A
missing pointer component remains missing, never zero-filled. Pure tests do not
exercise AX/CGEvent/physical input; the actual pointer-post branch must separately
be verified to use the same full-S mapping and exact V clip.
