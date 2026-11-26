# KlenWriter Editor

Rust/WASM editor: a general core with extensions, with KWDJ as the first CMS profile.

The standalone workspace builds native Rust crates, prebuilt WASM and packages
for vanilla and Angular applications. Start with the
[compatibility matrix](docs/support.md) for browser targets, known behavior and
local document handling.

GitHub is the canonical repository. No GitLab mirror is configured or planned.

Original code and documentation are licensed under **MIT OR Apache-2.0**, at your option. See [license and provenance](docs/m0/licensing.md). No npm/crates package is published yet.

The owner-confirmed [distribution identity](docs/identity.md) is **KlenWriter Editor**:
`klenwriter-editor-*` Rust crates and `@klenwriter/editor*` web packages. Names and
versions are recorded in [package-map.json](package-map.json). The packages remain
unpublished bootstrap artifacts; registry observations do not reserve names.

The headless SDK supports compatible ABI1 and explicit ABI2 in one prebuilt
WASM. [Extension authors](docs/extensions.md) can supply bounded runtime JSON
packages or compile independent native/WASM profile modules through public Rust
crates. The notes profile and KWDJ use the same composition API.

The [mounted DOM boundary](docs/dom.md) provides an editable SDK2 surface,
explicit profile renderers and bounded input reconciliation. The
[selection controller](docs/selection.md), [composition owner](docs/composition.md)
and optional [block chrome](docs/ui.md) define the corresponding input,
recovery and host integration behavior.

KWDJ consumers can explicitly enable [RU/EN typography](docs/typography-integration.md)
with a separate renderer catalog and immutable native configuration. It is off
by default; literal insertion and clipboard keep their existing semantics.

## Use the local packages

- [Vanilla quickstart](docs/quickstart-vanilla.md)
- [Native Rust quickstart](docs/quickstart-rust.md)
- [Zoneless Angular quickstart](docs/quickstart-angular.md)
- [Standalone playground](examples/vanilla-alpha/README.md)
- [Extension tutorial](docs/extension-tutorial.md)

Start contributing with the [public corpus](docs/corpus-contributor.md) and see
the [roadmap](docs/roadmap.md) for planned and deferred work.

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

Tests use native browser clipboard shortcuts and run sequentially because the OS clipboard is shared. They put sample text on the clipboard. Browser builds and test tools are pinned in the lockfile. `test-results/` contains traces, screenshots and videos for local runs; CI is build-only and does not upload test artifacts (OPS-625).

Read the [decision and results](docs/m0/editing-host-decision.md) and the [native RU/EN and accessibility protocol](docs/m0/native-protocol.md). Successful test execution is distinct from a fulfilled editor requirement; negative observations are retained. Playwright WebKit is not installed Safari, Unicode insertion is not OS IME, and axe/AX snapshots are not a real screen-reader acceptance test.
## Unstable codec transport (OSR-76)

The prebuilt WASM artifact now exposes versioned KWDJ validate/normalize/canonical
entry points for corpus parity. This is not the stable editing SDK (OSR-63).
See [ABI, input bounds, exact u64 and versioned test corpus](docs/codec-v1.md).
