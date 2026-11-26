# Vanilla quickstart

Install the six editor packages from the coordinated `1.0.0` bundle and edit
a short KWDJ document in a plain browser page. Use Node.js 24.22.0 and npm
11.14.0. The archives contain prebuilt WASM and run without a source
checkout, Rust or a CMS. Obtain the candidate bundle and its approved
manifest SHA-256. The commands use `jq` to read the verified manifest.

## Install in a clean directory

Set `bundle` to the absolute path of the candidate directory and verify the
manifest. Its source revision selects the matching example files.

```sh
bundle=/absolute/path/to/editor-candidate
manifest_sha256=REPLACE_WITH_APPROVED_MANIFEST_SHA256
printf '%s  %s\n' "$manifest_sha256" "$bundle/release-manifest.json" | shasum -a 256 -c - || exit 1
revision=$(jq -er '.source.commit' "$bundle/release-manifest.json") || exit 1
source=https://raw.githubusercontent.com/artemklen/klenwriter-editor

mkdir vanilla-quickstart && cd vanilla-quickstart && mkdir vendor || exit 1

for file in package.json index.html app.mjs serve.mjs; do
  curl -fsS -o "$file" "$source/$revision/examples/vanilla-quickstart/$file" || exit 1
done
for name in editor editor-dom editor-kwdj editor-sdk editor-ui editor-wasm; do
  archive="klenwriter-$name-1.0.0.tgz"
  digest=$(jq -er --arg path "npm/$archive" \
    '.artifacts[] | select(.kind == "npm" and .path == $path) | .sha256' \
    "$bundle/release-manifest.json") || exit 1
  cp "$bundle/npm/$archive" vendor/ || exit 1
  printf '%s  vendor/%s\n' "$digest" "$archive" | shasum -a 256 -c - || exit 1
done

registry_path=$(jq -er '.kwdjProfile.path' "$bundle/release-manifest.json") || exit 1
registry_sha256=$(jq -er '.kwdjProfile.sha256' "$bundle/release-manifest.json") || exit 1
cp "$bundle/$registry_path" kwdj-registry.json || exit 1
printf '%s  kwdj-registry.json\n' "$registry_sha256" | shasum -a 256 -c - || exit 1

npm install --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org || exit 1
npm start
```

## Edit, save and reopen

1. Open `http://127.0.0.1:4173/` and wait for **Editor ready**.
2. Edit `Hello, editor.` and click **Save**. The page displays **Saved in this browser**. Expand **Canonical JSON** to see the stored native document.
3. Refresh at the same address. When the sample reappears, click **Reopen saved** and check that your edit and its canonical JSON have returned.

The app uses `mount` and `export` from `@klenwriter/editor`. It waits for `ready` before exporting, and calls `destroy` before it mounts the saved bytes. The development server serves the WASM binary and its JavaScript alongside the app. Save stores the JSON in local storage for the page's origin. Keep the address and port the same when testing reload.

For the historical `0.1.0-alpha.1` archives, use the archived quickstart with
its `revision` set to `6843463a05969cb44466e72e06501a140ec140d0`.
[Alpha quickstart](https://github.com/artemklen/klenwriter-editor/blob/6843463a05969cb44466e72e06501a140ec140d0/docs/quickstart-vanilla.md)
