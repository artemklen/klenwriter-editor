# Resource lane integration

Preparation is source-only until the root confirms a coherent build. The new
`tests/failure-resources.node.mjs` records nine new finite observations to
`artifacts/failure-states/resources-original.json`; override that path with
`KLENWRITER_FAILURE_RESOURCES_REPORT` for a run-owned directory. It imports the
actual packaged SDK2 and uses one actual production WASM Memory for its public
cases. Controlled JS/CompositionOwner cases explicitly have no native claim.

Reuse existing cases during their already-required Node commands by selecting
`scripts/failure-states/resource-reporter.mjs` as an additional Node test reporter,
with a unique `--test-reporter-destination` for each command. It records test
events and source hashes; it does not start or repeat tests. Each new stream's
header `buildBefore` and footer `buildAfter` must contain the verified current
source `buildId`, the complete `producerSourceHashes`, and `artifactHashes` for
the actual runtime JS/WASM/CSS closure under `packages/wasm/dist`,
`packages/sdk/dist`, `packages/dom/dist`, and `packages/kwdj/dist`, including
nested WASM snippets.
The build-identity and WASM-seal JSON files are also pinned. The reporter
recomputes production identity, checks the built identity and actual sealed
WASM, and records the same complete binding before and after the command;
the footer requires `buildUnchanged:true`. The collector compares both bindings
with its own verified current binding. This prospective requirement rejects
older streams without build/artifact bindings; it does not rewrite them.
Required original
names/paths are in `existing-resource-cases.mjs`. A normal visible reporter may
remain as a second reporter. Keep the actual parent-command exit/reap receipts.

The closed-data collector accepts this input shape:

```json
{
  "format": "editor-failure-states/resource-inputs/1",
  "localReport": "artifacts/failure-states/resources-original.json",
  "nodeEventFiles": ["RUN_OWNED_SDK_EVENTS.ndjson", "RUN_OWNED_CLIPBOARD_EVENTS.ndjson", "RUN_OWNED_COMPOSITION_EVENTS.ndjson"],
  "nativeCommandReceipts": ["ROOT_ACTUAL_CLOSED_NATIVE_COMMAND.json"],
  "codecReport": "artifacts/codec-v1-report.json",
  "workspaceBrowserReport": "artifacts/browser.json",
  "compiledAdmissionBinding": {
    "closed": true,
    "exitCode": 0,
    "buildId": "CURRENT_ACTUAL_SOURCE_BUILD_ID",
    "sourceHashes": {},
    "artifactHashes": {},
    "report": {
      "path": "artifacts/browser.json",
      "bytes": 0,
      "sha256": "ACTUAL_REPORT_SHA256_CAPTURED_AT_COMMAND_CLOSURE"
    }
  }
}
```

The native receipt records the **actual** argv (`cargo ... test ...`, or the
existing `npm run check`/`check:rust` parent), `closed:true`, actual `exitCode`,
current `buildId`, `sourcesUnchanged:true`, `sourceHashes`, and raw `stdout` and
`stderr` seals. Each seal requires the structured fields
`{ "path": "RUN_OWNED_RAW_LOG", "bytes": 0, "sha256": "ACTUAL_CLOSED_LOG_SHA256" }`
(the byte count is the actual nonnegative integer, not the example zero).
These bytes/hashes must be captured when the command closes, as produced by
the root's `run-command.py`; deriving a fresh seal only during collection
does not establish this join. The collector requires this object shape and
compares each file's bytes and SHA256 before using its contents. A former
path-only receipt remains incomplete. Include the source files named by `rustResourceCases` and
`package.json` for an npm parent. Keep the root's independent process/tool
closure alongside it; the collector cannot attest process completion.

`compiledAdmissionBinding` records the root's actual closed workspace browser
command, hashes of `tests/workspace-browser.spec.js`, the shared Rust admission
cases, `crates/wasm/examples/admission_budget_probe.rs`, and actual
`artifacts/admission-budget/probe.js`/`probe_bg.wasm`. The existing three-engine
JSON report must contain the original compiled nine-case witness without retry.
Its `report` seal records the actual workspace JSON path, byte count and SHA256
at that same command's closure. Its normalized path must equal
`workspaceBrowserReport`; the collector compares the closed seal with the exact
bytes it reads and gives no compiled-witness credit to an unbound report.
This joins the original assertions; it adds no installed input or browser run.

After all originals close, the root may run
`node scripts/failure-states/resources-collect.mjs INPUTS.json OUTPUT.json`.
Missing or mismatched joins remain `INCOMPLETE` and exit nonzero. The report
separates original assertions, measured public capacity/logical resources and
unobserved scopes; it is not formal review or blanket task acceptance. No test,
build, browser, native process or external action is launched by the collector.
