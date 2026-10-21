# Mounted corpus acceptance

OSR-45 adds a mounted projection of the immutable KWDJ corpus, using the public
SDK2, DOM adapter and packaged WASM. The contract is
[`contracts/mounted-e2e/v1`](../contracts/mounted-e2e/v1/README.md). Its 277
case/stage memberships retain their original stage and component owner. Initial
coverage is 25 rows per engine: 12 unchanged positive documents, eight semantic
command/edit/history/reopen paths and five expected native admission refusals.
Clipboard, unavailable presentation/providers and deferred corpus cases retain
explicit dispositions. Previous codec measurements are separate evidence.

After a coherent build, `npm run test:extensions` (which creates the current
registry packet) and `npm run check:workspace`, run
`npm run test:mounted-corpus` under pinned Node24.22.0. The command first checks
the collector's controlled data tests, then starts its own fixed localhost
fixture. It preflights Chromium, WebKit and Firefox to record their actual
versions, executable hashes, public module manifests and native baselines.
Only then does it create an immutable RunBinding and execute the bound rows
with one worker and zero retries. Browser application data is isolated in
task-owned child directories. It does not use an installed browser profile.

Each run has a unique `artifacts/mounted-corpus/runs/mounted45-*` directory:

- `run-binding.json` binds source, corpus, source literals, implementation/config,
  generated registry packet, build ID, WASM, seal, dependencies and environment.
- `observations/{engine}/{index}.json` preserves original public ready, requests,
  responses, queued completions, events, snapshots/releases, directed selection,
  history, destruction and full resource maps for both owners.
- `report.json` keeps measurement integrity separate from requirements and
  pending/deferred/not-owned rows. Its full ledger has 831 engine/membership
  cells; these are distinct from the earlier codec report's 831 rows.
- `receipt.json` records actual subprocess completion and whether the run used
  a clean committed source. A development run with uncommitted files cannot
  qualify as the exact-SHA delivery gate.

Saving retains the original canonical UTF-8 bytes, destroys the original owner,
and opens those same bytes in a distinct element and controller. Same-owner
replace and parse/reserialization are not reopen. Expected negative admission
keeps the native Refused diagnostic and original input; it has no invented
snapshot or fresh-owner branch.

Chromium and WebKit are required. A complete authentic Firefox behavioral GAP
remains visible as experimental; malformed/missing evidence and failed cleanup
block all three engines. Unknown native counters stay unknown and fail
integrity. Screenshots and previous passing reports do not establish content,
identity, selection, history or cleanup.

Genuine keyboard selection, slash and drag routes have separate source-authored
interaction literals and observations. Public semantic command execution does
not establish those input paths. Paste waits for its accepted provider. Installed
Chrome/Safari EN/RU/dead-key, human manual observations and real assistive
technology remain distinct lanes, with actual execution required by the task's
acceptance contract. The browser corpus command does not establish them.

The initial interaction profile intentionally has no formatting actions. Its
empty toolbar stays hidden and outside the Tab order; populated profiles retain
their ordinary toolbar. The drag control is the separate button labelled
“Drag block; Enter opens the move menu”. The interaction fixture reserves room
for the external gutter beside the source at its declared desktop viewport and
checks the pointer's gradual approach to the control. When a host's gutter cannot fit beside the
source block, that button remains in normal flow below the editor. Human
instructions must identify this actual control rather than infer a handle
from an empty rounded panel or assume a fixed position.

CI remains build-only. The local pre-send gate runs the new lane after the
existing checks; independent review and merge still apply to the exact source.
Rollback is a revert of the additive harness; document persistence is unchanged.
