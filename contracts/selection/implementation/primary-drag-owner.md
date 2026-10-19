# Primary single-click drag ownership

Implementer decision, 19.10.2026, after main integration `cf07b12`. This chooses
browser event ownership within the existing v1 contract; public API, Rust range
semantics, all five AC and frozen expected outputs remain unchanged.

The complete development matrix measured Chromium137/137, WebKit137/137 and
Firefox135/137. In the two Firefox plain active-cancel cases the library pointer
and RAF were already zero, with exact stable model/raw endpoints, while the UA's
held-mouse selection autoscroll kept advancing the actual port. Clipped cases
did not activate that UA path. A separate finite same-range clear/reinstall
experiment did not stop the UA scroll either; its observations and final harness
exit13 are retained separately, not represented as acceptance or a product fix.

For a supported primary plain-left single-click drag, the selection owner must
therefore own the gesture before the UA selection default begins. Stage a primary
mouse pointer on pointerdown; claim only its corresponding compatibility
mousedown with button0, no modifiers and detail1 after a valid owned browser
caret hit and the existing lifecycle/mode/provisional/busy guards. Prevent that
default, focus with preventScroll, then recheck intent/context/stamp after any
synchronous focus handlers. Install the actual hit range and publish through the
same existing native set_selection boundary, retaining its exact raw anchor.

Inside motion uses actual browser caret hit testing and existing scalar-checked
DOM correspondence. Update synchronously for the actual last move so fast
move/up does not require endpoint repair after release. Outside vertical clip,
retain the one edge RAF, maximum24CSSpx scroll step and at most eight actual
fully visible caret probes. Do not simulate glyphs, segment words/EGCs, infer
semantic endpoints, sort direction or create a second model/publisher/SDK.
Known native affinity remains known; new Text/Child endpoints remain After.

Release/cancel/lost capture/blur/mode/provisional/replacement/recovery/destroy
cancel only the owned pointer/RAF; no post-end selection or scrolling correction.
Foreign host mutations cancel the active drag; its own selection publications
do not. Bookmarks retain their independently guarded continuity policy.

Modifier and multiple-click mousedown retain native word/line/modified selection:
release the staged custom pointer, leave the UA default intact, and observe its
ordinary selectionchange through the sole existing publisher. These are not
claimed as custom edge-drag forms. Do not add a TS word-segmentation policy.
No UA sniffing, synthetic mouseup, test-only scroll assistance or Firefox
expected-failure waiver is introduced.

Validate the exact existing137×3 mounted matrix and basic39 assertions, including
both formerly failing held cancellation cases. Independently exercise native
fallback preservation and the new event ownership boundary. Final exact-SHA
local/build/installed Chrome/Safari/review/merge gates remain outstanding; this
decision and any further corrections belong in that independent review.

Compatibility MouseEvent coordinates may truncate fractional PointerEvent CSS
coordinates. Correlate only finite pairs with absolute difference below one
CSS pixel on each axis; a difference of one or more declines ownership before
preventDefault/focus/hit/publication. The browser caret hit uses the original
precise PointerEvent point. This does not round any frozen fixture point or
change the caret visibility tolerance.

An authored bookmark pointer target can sit at a shared visual caret between
separate marked text leaves. The actual browser hit at that boundary may choose
the adjacent leaf, which is a distinct native position. Production retains that
actual correspondence. For an authored ASCII leaf-end input, the fixture may
choose the last quarter of the final glyph's actual rectangle, inside that leaf,
and must confirm the browser's raw node/offset equals the authored target before
dispatch. It records the glyph geometry, point and raw preflight. A failed
preflight fails the test; there is no retry, endpoint setter after the gesture,
production-mapper oracle or change to expected marks/history/epochs. Explicit
scroll and installed native input coordinates remain unchanged.
