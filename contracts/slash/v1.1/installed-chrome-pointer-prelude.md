# One Chrome pointer movement before the original click pair

Authored atf968dd6 before this pointer-program candidate or its physical run.
Chrome08 remains FAILED5P1F14NR: N06 click-add received the original completed
platform down/up ACK, but no DOM pointerdown/up/click appeared in nine bounded
reads or finish. The root/window/point guards passed and resources were released.
The cause remains unknown. Safari03 remains its separate original PASSED20P.

For a normal Chrome pointer action only, post exactly one mouseMoved event at
the same already guarded screen point, request25 ms passive waiting, then post
the original single leftMouseDown/leftMouseUp pair. Recheck the same original
owned window before every post, including after the pause; keep the original
point and original one-second guard-to-post deadline without resetting it.
Mouse movement has clickState0; down/up retain clickState1. No extra click,
button-down, activation, refocus, source change or semantic request is added.

Record/validate the complete program explicitly as transitions[move,down,up],
with a prelude receipt identifying mouseMoved, the same screen point, the
requested25 ms pause and its actual monotonic elapsed time. This receipt is
platform-event posting evidence, not DOM delivery, hardware provenance or
guaranteed hover initialization. Local Apple CGEvent headers define movement
separately from down/up and promise posting to an event stream; they supply no
proof of the historical missing events or of future success.

Safari's normal pointer program remains exactly down/up. All cleanup programs
remain exactly one up-only transition: no movement or down during cleanup.
Unknown completion retains the existing single original-owner cleanup and
stops new input; nothing is replayed. A completed program clears pending state
only after its exact full-program ACK is checked.

The original DOM requirement remains one trusted matching pointerdown, pointerup
and click at the retained original target object/descendant and pointer identity,
within the original passive observation bound. Movement grants no replacement
target, capture, bookmark, stamp or Submission. Missing/wrong/extra DOM events
still fail; no UNOBSERVED/PASS reinterpretation is added. Original frozen files,
assertions,20-row/action inventory and all other limits remain unchanged.
