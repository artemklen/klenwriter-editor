# Run and save a public extension

Use the authored Generic Notes D1 descriptor to add a callout and highlight to a note. Save the canonical JSON and reopen it in a fresh session with the same D1 descriptor. This headless example uses the prebuilt SDK2 WASM and local bootstrap packages at version `0.0.0`.

## Run the tutorial

Use Node `24.22.0` and npm `11.14.0`. From the repository root, prepare the local archives using the build tools in [Contributing](../CONTRIBUTING.md).

```sh
npm run build
npm run check:packages
node examples/notes-extension/run-save-reopen.mjs
```

If the checked archives and their inventory already exist, start with the last command. The runner packs the existing Notes fixture and installs it with SDK, WASM and DOM archives in a separate npm project. It checks the installed archive versions and digests and resolves the public entry points from that project's `node_modules`. The example and the [author testkit](../examples/notes-extension/testkit.mjs) execute there.

## Follow the document through Save and Reopen

1. Read D1 through the public `@example/notes-extension/d1.json` export and pass its original registry text to SDK2. The descriptor selects the Notes base, callout and highlight extensions, with the exact versions shown in the descriptor.
2. Read the current document node ID from the admitted editor. Use it in `org.example.notes/insert-callout` with the current stamp and typed command arguments. The recipe publishes one ordinary editing transaction.
3. Read a bounded snapshot. Write its canonical JSON to the local file, acknowledge that snapshot after the write, and release its handle. Destroy the editing controller.
4. Read the saved bytes from the file into a plain `Uint8Array` and admit them in a new D1 session. Export again and compare the canonical bytes, then release the snapshot and destroy the new controller.

The command reports `PASS`, 53 codec cases, 18 command cases and the runtime recipe result from the unchanged testkit. It also verifies byte-identical D1 reopen and reports the archive SHA-256 hashes, WASM build ID, saved document hash and checked public imports.

D0 remains the base renderer in the [browser example](../examples/vanilla-alpha/README.md). Use the matching descriptor when opening a saved document with D1 callout content. See [Frozen extensions and SDK V2](extensions.md) for the descriptor contract and authoring bounds.

[Runnable Save and Reopen source](../examples/notes-extension/save-reopen.mjs)
