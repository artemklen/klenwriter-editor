# Angular zoneless quickstart

Install the supplied `@klenwriter/editor-angular` bootstrap tarball and open a KWDJ document with an Angular standalone component. The example uses Angular and Angular CLI 22.0.8, TypeScript 6.0.2, RxJS 7.8.2, Node.js 24.22.0 and npm 11.14.0. The prebuilt editor uses no Rust toolchain, CMS or source checkout. Obtain the matching unpublished `0.0.0` bundle before starting.

## Install in a clean directory

Set `bundle` to the absolute path of your supplied tarballs. `revision` selects the public repository revision containing this page and example.

```sh
bundle=/absolute/path/to/angular-bootstrap-tarballs
revision=main
source=https://raw.githubusercontent.com/artemklen/klenwriter-editor

mkdir angular-quickstart && cd angular-quickstart && mkdir vendor || exit 1

for file in package.json angular.json tsconfig.json index.html main.ts; do
  curl -fsS -o "$file" "$source/$revision/examples/angular-quickstart/$file" || exit 1
done

for name in editor-angular editor-dom editor-kwdj editor-sdk editor-wasm; do
  cp "$bundle/klenwriter-$name-0.0.0.tgz" vendor/ || exit 1
done

shasum -a 256 -c <<'SHA256' || exit 1
c722be7a03400c2d8c80ec117d3fe5922a7ad5903b5b8c1b7dcb529bd7be535c  vendor/klenwriter-editor-angular-0.0.0.tgz
9afb85fc7e18f7b20c9dd44c47ecc370c5466ca669dc2e447f0e3e3bb045c352  vendor/klenwriter-editor-dom-0.0.0.tgz
245e52133ef52ccfebc80143d619479748db413adb52ffb79f95ae20ed3345da  vendor/klenwriter-editor-kwdj-0.0.0.tgz
a29bad5c69f0855009fa93f4d1216b435bc05176298c90e712d49751ec17ce8a  vendor/klenwriter-editor-sdk-0.0.0.tgz
a893f825351c1cbae77c5fb32d76ae41d2d3fcf9c02b1afec23c177ccb65fff2  vendor/klenwriter-editor-wasm-0.0.0.tgz
SHA256

npm install --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org || exit 1
npm run build || exit 1
npm start
```

## Edit, save and reopen

1. Open the local URL printed by Angular CLI and wait for **Editor ready**.
2. Edit `Hello, editor.` and check that the document revision appears. Click **Save**. The page displays **Saved in this browser**. **Canonical JSON** shows the native document written to local storage.
3. Refresh at the same address. When the sample reappears, click **Reopen saved** and check that your edit and its canonical JSON have returned.

The standalone component bootstraps with `provideZonelessChangeDetection()` and imports `KlenwriterEditorDirective`. The `[kwEditor]` input supplies the initial document, renderer and SDK configuration. The `(editorRevision)` output publishes native document revisions. Save uses `snapshot` and `release_snapshot` on the ready editor handle. Reopen passes the saved bytes to `replace`, which validates the document before replacing the view. Angular destroys the editor when it removes the directive. The Angular build serves the prebuilt WASM, glue and snippets next to the application bundle.

The archive source is `0811798579cbbedc44b70c2395dca1a06f3ac232` with SDK build `sha256:792405543241726d0cb7aa9174ac48bf124b63e61a8119373e622a4c9bf0e935`.
