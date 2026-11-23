# Vanilla editor alpha

This single-page example uses the public vanilla editor and the KWDJ prose
profile. **Save** writes canonical JSON to this browser's local storage.
After reloading the same page, **Reopen saved** opens those bytes in a fresh
editor session.

Use the `packages` directory printed by the [local alpha build](../../CONTRIBUTING.md#локальные-vanilla-alpha-tarballs).
It contains six `0.1.0-alpha.1` archives and their `pack-receipt.json`. The runner
verifies the archive hashes and builds the example in a fresh npm project
outside the checkout. Use Node 24.22.0 and npm 11.14.0.

Run from the repository root with the path to that directory.

```sh
node examples/vanilla-alpha/run.mjs /path/to/packages --serve
```

Open the printed URL. Keep the server running while you reload so the origin
stays the same. To verify real input, Undo, Redo, Save and reload/reopen in
Playwright Chromium and WebKit, run the following command with both browsers installed.

```sh
node examples/vanilla-alpha/run.mjs /path/to/packages --check
```
