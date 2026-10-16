# KlenWriter Editor

Rust/WASM editor: a general core with extensions, with KWDJ as the first CMS profile.

The repository is in M0 (feasibility and architecture). There is no production editor or published package yet. Desktop Chromium, Firefox and Safari are the first target; mobile input and collaboration are later work.

GitHub is the canonical repository. No GitLab mirror is configured or planned.

License and publication decisions remain part of M0; no license grant is implied by this scaffold.

## Run the M0 comparison

```sh
npm ci
PLAYWRIGHT_SKIP_BROWSER_GC=1 npx playwright install chromium firefox webkit
npm start
```

Open http://127.0.0.1:4173 and switch between one editing host and separate block fields. Runtime: plain browser APIs, no third-party editor library. The WASM probe is an empty module, not a Rust editor implementation.

```sh
npm test
node scripts/summarize-evidence.mjs
npm run report
```

Tests use native browser clipboard shortcuts and run sequentially because the OS clipboard is shared. They put sample text on the clipboard. Browser builds and test tools are pinned in the lockfile. `test-results/` contains traces, screenshots and videos; CI uploads them as a 14-day artifact.

Read the [decision and results](docs/m0/editing-host-decision.md) and the [native RU/EN and accessibility protocol](docs/m0/native-protocol.md). Successful test execution is distinct from a fulfilled editor requirement; negative observations are retained. Playwright WebKit is not installed Safari, Unicode insertion is not OS IME, and axe/AX snapshots are not a real screen-reader acceptance test.
