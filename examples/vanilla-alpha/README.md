# Vanilla editor alpha

This single-page example uses the public vanilla editor with KWDJ prose and
Generic Notes. **Profile** opens the selected demo document. **Save** writes
its canonical JSON to this browser's local storage. After reloading the same
page, choose the same profile and use **Reopen saved** to open those bytes in
a fresh editor session.

In Generic Notes, **Insert callout** uses the public Notes D1 descriptor
and the SDK to run its existing extension command on a copy of the open
document. **Extension copy JSON** shows the result. **Undo callout** restores
the copy's original bytes. The mounted note uses the D0 block set.

In KWDJ, select text and choose **Link**. The local host dialog passes the
URL to the editor. **Cancel** returns focus and the original selection.

Use the `packages` directory printed by the local alpha build in `CONTRIBUTING.md`.
It contains six `0.1.0-alpha.1` archives and their `pack-receipt.json`. The runner
verifies the archive hashes and builds the example in a fresh npm project
outside the checkout. Use Node 24.22.0 and npm 11.14.0.

Run from the repository root with the path to that directory.

```sh
node examples/vanilla-alpha/run.mjs /path/to/packages --serve
```

Open the printed URL. Keep the server running while you reload so the origin
stays the same. Run the following command with Playwright Chromium and WebKit
installed to verify editing, save and reopen, and strict validation of exports
after switching profiles. The run also checks the D1 command and byte-for-byte
Undo and both outcomes of the KWDJ link dialog in each browser.

```sh
node examples/vanilla-alpha/run.mjs /path/to/packages --check
```
