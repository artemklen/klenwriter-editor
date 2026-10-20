# TP03 fixture authoring correction

This source correction takes precedence over TP03's `applyTo: editorElement`
setup field. Apply the existing `ui-geometry-transform` class to the fixture
wrapper outside the editing root, as the original G18 test does in
`tests/ui-geometry-browser.spec.js:232–240`. Preserve the exact expected
`dom.selection_geometry_unsupported`, fallback and every side-effect assertion.

`packages/dom/src/mounted.ts:293–307` observes all editing-root/subtree attribute
mutations and enters recovery for external changes. Adding a class directly to
that owned root tests projection tampering rather than unsupported ancestor
geometry. The previous TP03 setup was therefore incorrectly authored. Neither
that recovery guard nor any frozen native/DOM/v1 bytes are changed here.

The wrapper class is established before the measurement baseline and removed
only during explicit teardown after the unsupported/fallback assertions.
Canonical bytes remain actual SDK snapshots before and after that layout phase;
all native state, objects, selection, focus, scroll and CSP checks remain exact.
Prior failed development attempts remain failed. This note claims no execution.
