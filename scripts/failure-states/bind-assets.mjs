// SPDX-License-Identifier: MIT OR Apache-2.0
// Bind frozen URL/count policy to actual current producer bytes before browsing.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import { computeSdkBuildIdentity } from '../generate-sdk-types.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = path => readFileSync(resolve(root, path));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const baseBytes = read('contracts/failure-states/v1/dom-assets.json');
const rendererBytes = read('contracts/failure-states/v1/dom-assets-renderer-addition.json');
const base = JSON.parse(baseBytes), renderer = JSON.parse(rendererBytes);
assert.equal(base.files.length, 52);
assert.equal(renderer.format, 'osr67-ac1-current-renderer-assets/1');
assert.equal(renderer.files.length, 7);
const snippetPrefix = 'packages/wasm/dist/snippets/';
const frozenSnippets = base.files.filter(file => file.path.startsWith(snippetPrefix));
assert.equal(frozenSnippets.length, 1, 'The historical policy describes one generated snippet');
const [frozenSnippet] = frozenSnippets;

// wasm-bindgen names the directory from the crate identity, including its
// version. Only this generated URL slot follows the current static import.
const gluePath = 'packages/wasm/dist/editor_wasm.js';
const { metafile } = buildSync({
  stdin: { contents: read(gluePath).toString('utf8'), sourcefile: gluePath, loader: 'js' },
  bundle: false, write: false, metafile: true, format: 'esm', treeShaking: false, logLevel: 'silent',
});
const [glue] = Object.values(metafile.outputs);
assert(glue.imports.every(record => record.kind === 'import-statement'), 'Generated WASM glue uses static snippet imports');
const imports = [...new Set(glue.imports.map(record => record.path))];
assert.equal(imports.length, 1, 'Generated WASM glue imports exactly one snippet');
assert.match(imports[0], /^\.\/snippets\/klenwriter-editor-wasm-[a-f0-9]{16}\/inline0\.js$/u);
const snippet = imports[0].slice(2);
const currentSnippet = { ...frozenSnippet, url: '/packages/wasm/' + snippet, path: 'packages/wasm/dist/' + snippet };
const descriptors = [...base.files.map(file => file === frozenSnippet ? currentSnippet : file), ...renderer.files];
assert.equal(new Set(descriptors.map(file => file.url)).size, descriptors.length);
export const domAssetPolicy = { origin: base.origin, optionalResponses: base.optionalResponses, files: descriptors };
export const domAssetContractPins = { assets: sha(baseBytes), rendererAssets: sha(rendererBytes) };

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const current = computeSdkBuildIdentity();
  const produced = JSON.parse(read('artifacts/sdk-build-identity.json'));
  assert.equal(produced.buildId, current.buildId, 'Build must precede asset binding');
  assert.deepEqual(produced.sourceHashes, current.sourceHashes);
  const files = domAssetPolicy.files.map(({ url, path }) => {
    assert(!isAbsolute(path) && !path.split(/[\\/]/).includes('..'));
    const file = resolve(root, path);
    assert(file.startsWith(root), 'Binding path within repository');
    const stat = lstatSync(file); assert(stat.isFile() && !stat.isSymbolicLink());
    const bytes = readFileSync(file);
    return { url, path, bytes: bytes.length, sha256: sha(bytes) };
  });
  const binding = { format: 'osr67-ac1-current-assets/2', contractSha256: domAssetContractPins.assets,
    rendererContractSha256: domAssetContractPins.rendererAssets,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    buildId: current.buildId, sourceHashes: current.sourceHashes, files };
  writeFileSync(resolve(root, 'artifacts/failure-states/dom-assets-current.json'), JSON.stringify(binding, null, 2) + '\n');
  console.log(`Bound ${files.length} current asset URLs to ${binding.buildId}`);
}
