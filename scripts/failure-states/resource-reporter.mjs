// SPDX-License-Identifier: MIT OR Apache-2.0
// Node test event reporter for the EXISTING command; does not launch/repeat tests.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import { computeSdkBuildIdentity } from '../generate-sdk-types.mjs';
import { existingSourceFiles } from './existing-resource-cases.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hashes = () => Object.fromEntries([...existingSourceFiles, 'scripts/failure-states/resource-reporter.mjs']
  .map(path => [path, sha(readFileSync(path))]));
const normalized = file => typeof file === 'string' ? (isAbsolute(file) ? relative(process.cwd(), file) : file).replaceAll('\\', '/') : null;
const line = value => JSON.stringify({ format: 'editor-failure-states/test-event/1', ...value }) + '\n';

// Read-only identity/artifact capture, shared with the closed-data collector.
// Importing this module neither starts a test nor invokes a build helper.
export function captureResourceBuildBinding() {
  const identity = computeSdkBuildIdentity();
  const produced = JSON.parse(readFileSync('artifacts/sdk-build-identity.json', 'utf8'));
  assert.equal(produced.format, 'klenwriter-editor-sdk-build/1');
  assert.equal(produced.buildId, identity.buildId, 'Build the exact current production source before recording resource events');
  assert.deepEqual(produced.sourceHashes, identity.sourceHashes, 'Complete current production source closure');
  const paths = ['artifacts/sdk-build-identity.json', 'artifacts/sdk-wasm-seal.json'];
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      assert(!entry.isSymbolicLink(), `Runtime artifact must not be a symlink: ${path}`);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && /\.(?:js|wasm|css)$/.test(entry.name)) paths.push(path);
    }
  };
  for (const directory of ['packages/wasm/dist', 'packages/sdk/dist', 'packages/dom/dist', 'packages/kwdj/dist']) walk(directory);
  for (const path of ['packages/wasm/dist/editor_wasm.js', 'packages/wasm/dist/editor_wasm_bg.wasm', 'packages/wasm/dist/sdk.js',
    'packages/sdk/dist/index.js', 'packages/sdk/dist/controller.js', 'packages/dom/dist/index.js',
    'packages/dom/dist/composition.js', 'packages/dom/dist/clipboard-capture.js']) {
    assert(paths.includes(path), `Required actual runtime artifact: ${path}`);
  }
  const artifactHashes = Object.fromEntries(paths.sort().map(path => [path, sha(readFileSync(path))]));
  const seal = JSON.parse(readFileSync('artifacts/sdk-wasm-seal.json', 'utf8'));
  const wasm = readFileSync('packages/wasm/dist/editor_wasm_bg.wasm');
  assert.equal(seal.format, 'klenwriter-editor-sdk-wasm/1');
  assert.equal(seal.build_id, identity.buildId, 'Actual WASM seal belongs to the current source build');
  assert.equal(seal.sealed_bytes, wasm.length);
  assert.equal(seal.sealed_sha256, artifactHashes['packages/wasm/dist/editor_wasm_bg.wasm']);
  assert.equal(sha(wasm), seal.sealed_sha256, 'Actual WASM bytes remain identical during capture');
  return { format: 'editor-failure-states/resource-build-binding/1', buildId: identity.buildId,
    producerSourceHashes: identity.sourceHashes, artifactHashes };
}

export default async function* resourceReporter(events) {
  const sourceBefore = hashes();
  const buildBefore = captureResourceBuildBinding();
  yield line({ type: 'header', sourceBefore, buildBefore });
  let failed = 0;
  for await (const event of events) {
    const data = event.data ?? {};
    if (event.type === 'test:pass' || event.type === 'test:fail') {
      if (event.type === 'test:fail') failed++;
      yield line({ type: event.type, name: data.name, file: normalized(data.file), line: data.line ?? null,
        skip: Boolean(data.skip), todo: Boolean(data.todo), nesting: data.nesting ?? null,
        durationMs: data.details?.duration_ms ?? null,
        error: data.details?.error ? { name: data.details.error.name, message: data.details.error.message, stack: data.details.error.stack, code: data.details.error.code } : null });
    } else if (event.type === 'test:stdout' || event.type === 'test:stderr') {
      yield line({ type: event.type, file: normalized(data.file), message: data.message });
    } else if (event.type === 'test:summary') {
      yield line({ type: event.type, success: data.success, counts: data.counts });
    }
  }
  const sourceAfter = hashes();
  const buildAfter = captureResourceBuildBinding();
  yield line({ type: 'footer', failed, sourceAfter, sourceUnchanged: JSON.stringify(sourceAfter) === JSON.stringify(sourceBefore),
    buildAfter, buildUnchanged: JSON.stringify(buildAfter) === JSON.stringify(buildBefore) });
}
