# KlenWriter Editor

Rust/WASM editor: a general core with extensions, with KWDJ as the first CMS profile.

M0 architecture is accepted; M1 supplies the workspace foundation and extracted native document semantics. There is no production editor or published package yet. Desktop Chrome and Safari are the v1 support target. Firefox remains an experimental compatibility lane with recorded results, not a v1 release guarantee; its acceptance gate is separate. Mobile input and collaboration are later work.

GitHub is the canonical repository. No GitLab mirror is configured or planned.

Original code and documentation are licensed under **MIT OR Apache-2.0**, at your option. See [license and provenance](docs/m0/licensing.md). No npm/crates package is published yet.

The owner-confirmed [distribution identity](docs/identity.md) is **KlenWriter Editor**:
`klenwriter-editor-*` Rust crates and `@klenwriter/editor*` web packages. Names and
versions are recorded in [package-map.json](package-map.json). The packages remain
unpublished bootstrap artifacts; registry observations do not reserve names.

## Build the standalone workspace

Use Node 24.22.0, npm 11.14.0 and rustup (Rust 1.97.1 is pinned automatically):

```sh
npm ci --ignore-scripts
cargo install wasm-bindgen-cli --version 0.2.129 --locked --root .tools
PLAYWRIGHT_SKIP_BROWSER_GC=1 npx playwright install chromium firefox webkit
npm run check
npm test
```

Canonical bytes and number representation: [ADR-004](docs/adr/004-canonical-json-v1.md);
independent reference vectors: `npm run test:canonical`.

Native extraction, compatibility and inherited limitations: [OSR-29 extraction](docs/extraction.md).

See [contribution workflow](CONTRIBUTING.md), [package map](docs/workspace.md) and
[versioned contracts](contracts/README.md). No CMS, database, private registry or
secrets are needed. These commands create local artifacts; they never publish.

## Architecture package

Start with the [master plan](docs/m0/master-plan.md), [detailed architecture and rationale](docs/m0/architecture.md), [decision register](docs/m0/decision-register.md) and [milestone/task map](docs/m0/delivery-map.md). The [module and scenario contract](docs/m0/architecture-flows.md) links the textual ADRs, [FigJam](https://www.figma.com/board/MfPnaBZYxczK6Yi9qd6fiv) and [eight editable Figma UX scenarios](https://www.figma.com/design/4Mkb3kl1RU3wV5H1hNYH7S).

Run `npm run test:contracts` for executable M0 profile/position reference vectors and `npm run check:m0` for artifact/traceability consistency. `npm run perf:verify` verifies sealed calibration sources, raw samples and derived reports without rerunning benchmarks. These do not prove production engine parity. The separate [performance calibration](docs/m0/performance-protocol.md) requires its pinned Rust toolchain; its tiny kernel is not the editor implementation.

## Run the M0 comparison

```sh
npm ci
PLAYWRIGHT_SKIP_BROWSER_GC=1 npx playwright install chromium firefox webkit
npm start
```

Open http://127.0.0.1:4173 (`?mode=single&native=1` for native Find/input without duplicate diagnostic text) and switch between one editing host and separate block fields. Runtime: plain browser APIs, no third-party editor library. The WASM probe is an empty module, not a Rust editor implementation.

```sh
npm test
node scripts/summarize-evidence.mjs
npm run report
```

Tests use native browser clipboard shortcuts and run sequentially because the OS clipboard is shared. They put sample text on the clipboard. Browser builds and test tools are pinned in the lockfile. `test-results/` contains traces, screenshots and videos; CI uploads them as a 14-day artifact.

Read the [decision and results](docs/m0/editing-host-decision.md) and the [native RU/EN and accessibility protocol](docs/m0/native-protocol.md). Successful test execution is distinct from a fulfilled editor requirement; negative observations are retained. Playwright WebKit is not installed Safari, Unicode insertion is not OS IME, and axe/AX snapshots are not a real screen-reader acceptance test.
