# Selection v1 erratum 001 — empty Unicode input

Implementer decision, 19.10.2026. This is a fixture authoring correction, identified
by the first complete Chromium development run (119 passed / 16 failed). It is
not acceptance, a changed native admission policy or regenerated candidate output.

`v1/unicode-oracles.json` case `U-EMPTY` writes a paragraph as `{ "type":
"paragraph" }`. The existing strict KWDJ admission requires the explicit empty
`content: []`. Actual refusal is `kwdj.invalid_structure`, path `/content/0`,
category `profile`, empty details, null stamp, `may_have_committed: false`.
The missing property is an authoring error. All original v1 bytes, manifest and
hashes remain unchanged; accepting that malformed wire is not a solution.

The positive empty-selection input is the **already independently authored and
frozen before runtime** `v1/bookmark-oracles.json` → `documents.empty.wire`.
It contains the required explicit empty paragraph content. Use that exact input
for the positive U-EMPTY mounted case; retain all original U-EMPTY expected
Child(paragraph, 0, After) points, empty copied text, root Select All and invariants.
The browser fixture already used this same frozen document as its independently
expected U-EMPTY canonical result. No expected native/model/DOM output changes.

Additionally execute the original malformed U-EMPTY input as a separately named
negative admission control and require the complete refusal above. It does not
count as the positive empty-selection case. Preserve the failed first-run raw
result and both source data hashes in delivery evidence.

Scope, five Linear acceptance criteria, Rust authority and all other frozen
selection expectations remain in force. No generalized normalization, repair or
admission relaxation is introduced. Full exact-SHA/local/browser/installed review
gates remain required after the implementation is complete.
