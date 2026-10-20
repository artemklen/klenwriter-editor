# RL01 mode setup spelling correction

The first post-CSS development target on d59e5f1 remains FAILED12/12. Every
variant passed its original zero-change layout, preserved-input and same-Add
pointer assertions, then refused its focused-mode reason check because the new
fixture called the unsupported string `readonly` without asserting the setup
result. This is a test authoring error, not a permitted empty reason.

Before correcting that fixture, existing source defines `InteractionMode` as
`editable | readOnly | disabled` in packages/dom/src/types.ts:4; mounted.ts
rejects unsupported strings through MODES.has(mode), and pre-existing R01 uses
`readOnly`. Use that exact existing public value and assert the actual returned
`status:updated, mode:readOnly` before observing the mode reason. The frozen
localized dom.mode_blocked expectations, all visibility/flow/gesture/native/
DOM/CSP/resource assertions and prior receipts remain unchanged. No production
or CSS change is required; the same coherent5212139d/c1e98ae8 artifact applies.
