// SPDX-License-Identifier: MIT OR Apache-2.0
// Finite acceptance observations. This module does not build or launch a process.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { captureActualMemory, ownedResourcesZero } from '../reliability/perf-memory.mjs';

export const recipePath = 'contracts/failure-states/v1/resource-recipes.json';
export const recipe = JSON.parse(readFileSync(recipePath, 'utf8'));
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const jsonData = value => structuredClone(value);
export const accepted = response => {
  assert.equal(response.status, 'ok', JSON.stringify(response));
  return response.value;
};
export const completed = submission => {
  assert.equal(submission.status, 'completed');
  return submission.response;
};
export const settled = submission => submission.status === 'queued' ? submission.completion : Promise.resolve(submission.response);
export const state = editor => accepted(editor.read({ kind: 'state' })).state;
export function snapshot(editor, maximum = recipe.healthyCanonical.bytes) {
  const response = accepted(completed(editor.submit({ kind: 'snapshot', stamp: editor.capture(), max_bytes: maximum })));
  assert.equal(response.kind, 'snapshot');
  return response;
}
export function release(editor, handle) {
  return accepted(completed(editor.submit({ kind: 'release_snapshot', handle })));
}
export function healthyBytes() {
  const bytes = readFileSync(recipe.healthyCanonical.path);
  assert.equal(bytes.length, recipe.healthyCanonical.bytes);
  assert.equal(digest(bytes), recipe.healthyCanonical.sha256);
  return bytes;
}
export function paddedInput(length) {
  assert(recipe.publicInput.byteLengths.includes(length));
  const input = new Uint8Array(length);
  input.fill(0x20);
  input.set(healthyBytes(), 0);
  return input;
}
export function optionsFor(buildId) {
  const options = JSON.parse(readFileSync('contracts/failure-states/v1/admission/options.template.json', 'utf8'));
  assert.equal(options.build_id, '$CURRENT_SOURCE_BUILD_ID');
  return { ...options, build_id: buildId };
}
export const nativeCounts = module => JSON.parse(module.resourceCounts());
export { ownedResourcesZero };

const localSources = [
  recipePath, 'contracts/failure-states/v1/resources.md',
  recipe.healthyCanonical.path, 'contracts/failure-states/v1/admission/options.template.json',
  'tests/failure-resources.node.mjs', 'scripts/failure-states/resource-case-helpers.mjs',
  'scripts/failure-states/resource-composition.mjs', 'scripts/reliability/perf-memory.mjs',
  'tests/helpers/sdk-fake.mjs',
];
const actualArtifacts = [
  'artifacts/sdk-build-identity.json', 'artifacts/sdk-wasm-seal.json',
  'packages/wasm/dist/editor_wasm.js', 'packages/wasm/dist/editor_wasm_bg.wasm',
  'packages/wasm/dist/sdk.js', 'packages/sdk/dist/index.js', 'packages/sdk/dist/controller.js',
  'packages/dom/dist/composition.js',
];
export function hashFiles(paths) {
  return Object.fromEntries(paths.map(path => [path, digest(readFileSync(path))]));
}
function errorData(error) {
  return { name: error?.name ?? 'Error', message: error?.message ?? String(error), stack: error?.stack ?? null,
    actual: error?.actual, expected: error?.expected, operator: error?.operator };
}

export function createResourceRecorder() {
  const producer = JSON.parse(readFileSync('artifacts/sdk-build-identity.json', 'utf8'));
  assert.match(producer.buildId, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(hashFiles(Object.keys(producer.sourceHashes)), producer.sourceHashes, 'Build the exact current production source before this lane');
  const sourceBefore = hashFiles(localSources), artifactBefore = hashFiles(actualArtifacts);
  const cases = [];
  let actual, actualPromise;
  const observation = {
    format: 'editor-failure-states/resource-originals/1',
    status: 'RUNNING', buildId: producer.buildId, producerSourceHashes: producer.sourceHashes,
    sourceBefore, artifactBefore, cases,
    selectedRows: recipe.selectedRows, omittedRows: recipe.omittedRows,
    qualifications: [
      'Local new observations and existing-case assertions must be joined by the collector; this file alone is not all-nine-row acceptance.',
      'Only public SDK2 cases observe the same actual production WASM instance; controlled JS/owner cases have no native or WASM-memory claim.',
      'Memory samples are capacity bytes at declared boundaries, not allocator-live bytes, RSS or within-call peak; no page-shrink or elapsed threshold.',
      'Default million-value/depth128, aggregate snapshot32MiB and global256-session boundaries are not dynamically exercised here.',
      'Clipboard aggregate+1 alone is unreachable under the frozen two-representation per-item ceilings.',
    ],
  };
  async function production() {
    return actualPromise ??= (async () => {
      const sdk = await import('../../packages/sdk/dist/index.js');
      assert.equal(sdk.sdkBuildId, producer.buildId);
      actual = await captureActualMemory(() => sdk.loadSdkV2({ wasm: new Uint8Array(readFileSync('packages/wasm/dist/editor_wasm_bg.wasm')) }));
      assert.equal(actual.value.manifest.build_id, producer.buildId);
      return actual.value;
    })();
  }
  function sample(entry, label, editor = null, { controlled = false, beforeLoader = false } = {}) {
    const point = { label, js: editor ? jsonData(editor.resources()) : null };
    if (controlled || beforeLoader) {
      point.native = { status: 'NOT_APPLICABLE', reason: controlled ? 'Controlled JS/owner fixture, no native invocation' : 'Input refused before any loader invocation' };
      point.wasm = { status: 'NOT_APPLICABLE', reason: point.native.reason };
    } else {
      assert(actual, 'Observe only the actual captured production instance');
      point.wasm = { status: 'OBSERVED', capacityBytes: actual.memory.buffer.byteLength };
      try { point.native = { status: 'OBSERVED', value: nativeCounts(actual.value) }; }
      catch (error) { point.native = { status: 'UNOBSERVED', error: errorData(error) }; }
    }
    if (editor) {
      try {
        const response = editor.read({ kind: 'state' });
        point.history = response.status === 'ok' ? { status: 'OBSERVED', value: jsonData(response.value.state.history) }
          : { status: 'NOT_AVAILABLE', response: jsonData(response) };
      } catch (error) { point.history = { status: 'UNOBSERVED', error: errorData(error) }; }
    }
    entry.samples.push(point);
    return point;
  }
  async function observe(id, scope, action) {
    assert(!cases.some(entry => entry.id === id), `Duplicate observation ${id}`);
    const entry = { id, scope, status: 'RUNNING', samples: [] };
    cases.push(entry);
    const start = performance.now();
    try { await action(entry); entry.status = 'PASSED'; }
    catch (error) { entry.status = 'FAILED'; entry.error = errorData(error); throw error; }
    finally {
      entry.elapsedMs = performance.now() - start;
      const capacities = entry.samples.flatMap(point => point.wasm?.status === 'OBSERVED' ? [point.wasm.capacityBytes] : []);
      entry.memory = capacities.length ? { status: 'OBSERVED', beforeBytes: capacities[0], sampledMaximumBytes: Math.max(...capacities), afterBytes: capacities.at(-1), afterMinusBeforeBytes: capacities.at(-1) - capacities[0] }
        : scope === 'actual-public-sdk2' ? { status: 'UNOBSERVED', reason: 'Actual public episode did not yield an available memory observation' }
          : { status: 'NOT_APPLICABLE', reason: 'No actual production WASM call in this declared case' };
    }
  }
  function finish() {
    observation.sourceAfter = hashFiles(localSources);
    observation.artifactAfter = hashFiles(actualArtifacts);
    observation.producerSourcesAfter = hashFiles(Object.keys(producer.sourceHashes));
    observation.sourceUnchanged = JSON.stringify(observation.sourceAfter) === JSON.stringify(sourceBefore)
      && JSON.stringify(observation.producerSourcesAfter) === JSON.stringify(producer.sourceHashes);
    observation.artifactsUnchanged = JSON.stringify(observation.artifactAfter) === JSON.stringify(artifactBefore);
    observation.sameActualProductionInstanceCount = actual?.instanceCount ?? 0;
    observation.status = observation.sourceUnchanged && observation.artifactsUnchanged && cases.length > 0 && cases.every(entry => entry.status === 'PASSED')
      ? 'LOCAL_PASSED_EXISTING_EVIDENCE_REQUIRED' : 'FAILED';
    const path = resolve(process.env.KLENWRITER_FAILURE_RESOURCES_REPORT ?? 'artifacts/failure-states/resources-original.json');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(observation, null, 2) + '\n');
    assert(observation.sourceUnchanged, 'Resource sources changed during observation; raw result retained');
    assert(observation.artifactsUnchanged, 'Actual artifacts changed during observation; raw result retained');
    return observation;
  }
  return { production, sample, observe, finish, buildId: producer.buildId };
}
