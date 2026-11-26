# Angular zoneless quickstart

Install `@klenwriter/editor-angular` from the coordinated `1.0.0` bundle and
open a KWDJ document in an Angular standalone component. The example uses
Angular and Angular CLI `22.3.0`, TypeScript 6.0.2, RxJS 7.8.2, Node.js 24.22.0
and npm 11.14.0. The prebuilt editor uses no Rust toolchain, CMS or source
checkout. Obtain the candidate bundle and its approved manifest SHA-256. The
commands below use `jq` to read the verified manifest.

## Install in a clean directory

Set `bundle` to the absolute path of the candidate directory and verify the
manifest. The source revision in that manifest selects the matching public
example files.

```sh
bundle=/absolute/path/to/editor-candidate
manifest_sha256=REPLACE_WITH_APPROVED_MANIFEST_SHA256
printf '%s  %s\n' "$manifest_sha256" "$bundle/release-manifest.json" | shasum -a 256 -c - || exit 1
revision=$(jq -er '.source.commit' "$bundle/release-manifest.json") || exit 1
source=https://raw.githubusercontent.com/artemklen/klenwriter-editor

mkdir angular-quickstart && cd angular-quickstart && mkdir vendor || exit 1

for file in package.json angular.json tsconfig.json index.html main.ts; do
  curl -fsS -o "$file" "$source/$revision/examples/angular-quickstart/$file" || exit 1
done

for name in editor-angular editor-dom editor-kwdj editor-sdk editor-wasm; do
  archive="klenwriter-$name-1.0.0.tgz"
  digest=$(jq -er --arg path "npm/$archive" \
    '.artifacts[] | select(.kind == "npm" and .path == $path) | .sha256' \
    "$bundle/release-manifest.json") || exit 1
  cp "$bundle/npm/$archive" vendor/ || exit 1
  printf '%s  vendor/%s\n' "$digest" "$archive" | shasum -a 256 -c - || exit 1
done

npm install --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org || exit 1
npm run build || exit 1
npm start
```

## Edit, save and reopen

1. Open the local URL printed by Angular CLI and wait for **Editor ready**.
2. Edit `Hello, editor.` and check that the document revision appears. Click **Save**. The page displays **Saved in this browser**. **Canonical JSON** shows the native document written to local storage.
3. Refresh at the same address. When the sample reappears, click **Reopen saved** and check that your edit and its canonical JSON have returned.

The standalone component bootstraps with `provideZonelessChangeDetection()` and imports `KlenwriterEditorDirective`. The `[kwEditor]` input supplies the initial document, renderer and SDK configuration. The `(editorRevision)` output publishes native document revisions. Save uses `snapshot` and `release_snapshot` on the ready editor handle. Reopen passes the saved bytes to `replace`, which validates the document before replacing the view. Angular destroys the editor when it removes the directive. The Angular build serves the prebuilt WASM, glue and snippets next to the application bundle.

The original `0.0.0` bootstrap archive pins are in the archived quickstart.
[Bootstrap quickstart](https://github.com/artemklen/klenwriter-editor/blob/6843463a05969cb44466e72e06501a140ec140d0/docs/quickstart-angular.md)
