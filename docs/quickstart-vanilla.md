# Vanilla quickstart

Install the six supplied `0.1.0-alpha.1` tarballs and edit a short KWDJ document in a plain browser page. Use Node.js 24.22.0 and npm 11.14.0. The archives contain prebuilt WASM, so a source checkout, Rust and a CMS are unnecessary. These archives are unpublished. Obtain the matching tarballs as a bundle before starting.

## Install in a clean directory

Set `bundle` to the absolute path of your supplied tarballs. The following downloads only the example files and checks the package bytes before npm installs them. `revision` selects the public repository revision containing this page and example.

```sh
bundle=/absolute/path/to/vanilla-alpha-tarballs
revision=main
source=https://raw.githubusercontent.com/artemklen/klenwriter-editor

mkdir vanilla-quickstart && cd vanilla-quickstart && mkdir vendor || exit 1

for file in package.json index.html app.mjs serve.mjs; do
  curl -fsS -o "$file" "$source/$revision/examples/vanilla-quickstart/$file" || exit 1
done
curl -fsS -o kwdj-registry.json \
  "$source/a6a9eb17bcdb89ea67785a45384e8091d8f95567/examples/vanilla-alpha/kwdj-registry.json" || exit 1

for name in editor editor-dom editor-kwdj editor-sdk editor-ui editor-wasm; do
  cp "$bundle/klenwriter-$name-0.1.0-alpha.1.tgz" vendor/ || exit 1
done

shasum -a 256 -c <<'SHA256' || exit 1
bed2578ddf088000230d6d22649c98f070c78e8ff8d689b1ee303f28be39f964  vendor/klenwriter-editor-0.1.0-alpha.1.tgz
168c17471292ac7abd97991c9da548f45d3dde22175e78f45320b4720bae1b8e  vendor/klenwriter-editor-dom-0.1.0-alpha.1.tgz
3c1f6ad201295a2f776f164802344ebda1a3de69da3521332dc66dac5e444af3  vendor/klenwriter-editor-kwdj-0.1.0-alpha.1.tgz
db1ce923bb3d4d9edce270252a5e968cd27c83ec5696401cbb528a336e5c5d85  vendor/klenwriter-editor-sdk-0.1.0-alpha.1.tgz
7489c0511da6c0cd78964efff260994e40cbed60b05bb405bf475ea20dbaf157  vendor/klenwriter-editor-ui-0.1.0-alpha.1.tgz
881c7ed464c60fa8c4713af734f91b5acdef76fa899c07c09977c1b726580387  vendor/klenwriter-editor-wasm-0.1.0-alpha.1.tgz
dff6c95e5b23b1e1f9443dc4ad60ebc9d0685dd4b48bde56bb823c4719fd80f6  kwdj-registry.json
SHA256

npm install --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org || exit 1
npm start
```

## Edit, save and reopen

1. Open `http://127.0.0.1:4173/` and wait for **Editor ready**.
2. Edit `Hello, editor.` and click **Save**. The page displays **Saved in this browser**. Expand **Canonical JSON** to see the stored native document.
3. Refresh at the same address. When the sample reappears, click **Reopen saved** and check that your edit and its canonical JSON have returned.

The app uses `mount` and `export` from `@klenwriter/editor`. It waits for `ready` before exporting, and calls `destroy` before it mounts the saved bytes. The development server serves the WASM binary and its JavaScript alongside the app. Save stores the JSON in local storage for the page's origin. Keep the address and port the same when testing reload.

The archive source is `a6a9eb17bcdb89ea67785a45384e8091d8f95567` with SDK build `sha256:75207266468b98f0df5b4c33d081e189269ff25dd7aee534b28816c897a9cd89`.
