// SPDX-License-Identifier: MIT OR Apache-2.0
// Source-authored data integrity controls only. No editor/native/browser runs.
// Execution awaits finalized quiet-source pins; the pending scaffold refuses.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadMountedSourceContinuation47 } from '../scripts/mounted-corpus/source-continuation47.mjs';
import { loadMountedSourceContinuation48, SOURCE_CONTINUATION48_PATH } from '../scripts/mounted-corpus/source-continuation48.mjs';
import { loadMountedSourceContinuation66 } from '../scripts/mounted-corpus/source-continuation66.mjs';

const ROOT = new URL('../', import.meta.url);
const LEGACY_PATH = 'contracts/mounted-e2e/v1.1/source-continuation47.json';
const NAMED_CHANGE = 'packages/dom/src/input.ts';
const hash = b => createHash('sha256').update(b).digest('hex');
const corrupt = b => { const v = Uint8Array.from(b); assert.ok(v.length); v[v.length - 1] ^= 1; return v; };
function ordinaryReaderWith(overrides = new Map(), calls = []) {
  return async (path, maximum) => {
    calls.push({ path, maximum });
    assert.ok(Number.isSafeInteger(maximum) && maximum >= 0 && maximum <= 268435456);
    let bytes;
    if (overrides.has(path)) bytes = Uint8Array.from(overrides.get(path));
    else {
      assert.ok(typeof path === 'string' && !path.startsWith('/') && !path.includes('\\')
        && !path.split('/').some(p => !p || p === '.' || p === '..'));
      const url = new URL(path, ROOT), stat = await lstat(url);
      assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum, `Bounded ordinary source read: ${path}`);
      bytes = await readFile(url);
    }
    assert.ok(bytes.byteLength <= maximum, `Exact requested bound: ${path}`); return bytes;
  };
}
// Unchanged48 controls use an explicitly retained48 source namespace. The66
// layer validates fresh actual66 first; original48 corruption overrides remain
// overrides of their original namespace, never current runtime evidence.
const actual66Reader = ordinaryReaderWith();
const current66Layer = await loadMountedSourceContinuation66({ readArtifact: actual66Reader });
const accepted48SourceReader = current66Layer.retained48SourceReader(actual66Reader);
function readerWith(overrides = new Map(), calls = []) {
  const overridden = ordinaryReaderWith(overrides, calls);
  return async (path, maximum) => {
    if (overrides.has(path)) return overridden(path, maximum);
    calls.push({ path, maximum });
    return accepted48SourceReader(path, maximum);
  };
}
async function manifests() {
  const read = readerWith(); const oldBytes = await read(LEGACY_PATH, 32454);
  assert.equal(oldBytes.byteLength, 32454);
  assert.equal(hash(oldBytes), 'd6986b1010d0e8d9d4e1594410d0c92cc695ad27df2d65e77cbcac04a5ba4621');
  const legacy = JSON.parse(Buffer.from(oldBytes).toString('utf8'));
  const manifest = JSON.parse(Buffer.from(await read(SOURCE_CONTINUATION48_PATH, 262144)).toString('utf8'));
  assert.equal(manifest.status, 'FINALIZED_SOURCE_CONTRACT', 'No test execution against a draft source scaffold');
  return { manifest, legacy };
}
function refusal(error) {
  assert.match(error?.code ?? '', /^mounted-corpus\.source_continuation(?:48)?\./); return true;
}

test('48 layer preserves every accepted47 authority and original45 reference without rebinding runtime bytes', async () => {
  const { manifest, legacy } = await manifests();
  assert.equal(manifest.accepted47Commit, '753c77aadd5215a5a5f81448b71d45d17d77f85e');
  assert.equal(manifest.authorities.length, 32); assert.equal(legacy.authorities.length, 32);
  assert.equal(legacy.authorities.flatMap(a => a.references).length, 35);
  assert.equal(legacy.changes.length, 8);
  assert.deepEqual(manifest.authorities.map(a => a.path), legacy.authorities.map(a => a.path));
  for (const [i, entry] of manifest.authorities.entries()) {
    assert.deepEqual(entry.accepted47, legacy.authorities[i].current);
    assert.deepEqual(entry.retained47, { ...entry.accepted47, path: `contracts/mounted-e2e/v1.2/source-authority/accepted47/${entry.path}` });
  }
  const actual = readerWith(), outer = await loadMountedSourceContinuation48({ readArtifact: actual });
  const retained = await loadMountedSourceContinuation47({ readArtifact: outer.retained47SourceReader(actual) });
  const oldReceipt = await retained.verifyAll(); assert.equal(oldReceipt.authorities.length, 32);
  assert.equal(oldReceipt.currentProductionAnchor, 'e914716db9ed4143bea7e666e8cfb9e03de99479');
  assert.deepEqual(oldReceipt.changedPaths, legacy.changedPaths);
  const entry = manifest.authorities.find(a => a.path === NAMED_CHANGE);
  const now = await actual(entry.path, entry.current48.bytes);
  const old = await outer.retained47SourceReader(actual)(entry.path, entry.accepted47.bytes);
  assert.equal(hash(now), entry.current48.sha256); assert.equal(hash(old), entry.accepted47.sha256);
  assert.notEqual(hash(now), hash(old), 'Explicit48 source differs from the retained47 source');
  const historical = await outer.historicalAuthorityReader(actual)(entry.path, 1048576);
  assert.equal(hash(historical), legacy.authorities.find(a => a.path === entry.path).historical.sha256);
});

test('actual48 pin mismatch refuses before any retained47 alias read', async () => {
  const { manifest } = await manifests(), calls = [], overrides = new Map(), source = readerWith();
  const entry = manifest.authorities.find(a => a.path === NAMED_CHANGE);
  overrides.set(entry.path, corrupt(await source(entry.path, entry.current48.bytes)));
  await assert.rejects(loadMountedSourceContinuation48({ readArtifact: readerWith(overrides, calls) }), refusal);
  assert.ok(!calls.some(c => c.path === entry.retained47.path), 'Current source is verified before its retained alias');
});

test('retained47 and original45 mutations independently refuse even when actual48 matches', async () => {
  const { manifest, legacy } = await manifests(), source = readerWith();
  for (const pin of [manifest.authorities.find(a => a.path === NAMED_CHANGE).retained47,
    legacy.authorities.find(a => a.path === NAMED_CHANGE).retained,
    manifest.legacy47.helper, manifest.legacy47.manifest]) {
    const overrides = new Map([[pin.path, corrupt(await source(pin.path, pin.bytes))]]);
    await assert.rejects(loadMountedSourceContinuation48({ readArtifact: readerWith(overrides) }), refusal);
  }
});

test('neither retained47 nor historical45 reader can substitute for the actual48 reader', async () => {
  const source = readerWith(), outer = await loadMountedSourceContinuation48({ readArtifact: source });
  for (const alias of [outer.retained47SourceReader(source), outer.historicalAuthorityReader(source)]) {
    await assert.rejects(loadMountedSourceContinuation48({ readArtifact: alias }), refusal);
  }
});

test('fresh alias reads and runtime inventories detect later actual48 or retained47 changes', async () => {
  const { manifest } = await manifests(), entry = manifest.authorities.find(a => a.path === NAMED_CHANGE);
  for (const pin of [entry.current48, entry.retained47]) {
    const overrides = new Map(), source = readerWith(overrides);
    const outer = await loadMountedSourceContinuation48({ readArtifact: source });
    overrides.set(pin.path, corrupt(await source(pin.path, pin.bytes)));
    await assert.rejects(outer.retained47SourceReader(source)(entry.path, entry.accepted47.bytes), refusal);
    await assert.rejects(outer.historicalAuthorityReader(source)(entry.path, 1048576), refusal);
    await assert.rejects(outer.captureRuntimeInventory('a'.repeat(40)), refusal);
  }
});

test('new actual inventory uses the original reader and includes all source layers without the old64-pin claim', async () => {
  const { manifest } = await manifests(), source = readerWith();
  const outer = await loadMountedSourceContinuation48({ readArtifact: source });
  const inventory = await outer.captureRuntimeInventory('a'.repeat(40));
  assert.equal(inventory.format, 'mounted-corpus-source-runtime-inventory/2');
  assert.equal(inventory.sourceSHA, 'a'.repeat(40));
  const expected = [...new Set([...outer.sourcePaths, ...outer.requiredCurrentPaths])].sort();
  assert.deepEqual(inventory.pins.map(p => p.path), expected);
  assert.equal(inventory.pins.length, new Set(inventory.pins.map(p => p.path)).size);
  assert.ok(inventory.pins.length <= inventory.budgets.paths && inventory.pins.length > 78);
  let total = 0;
  for (const pin of inventory.pins) {
    const bytes = await source(pin.path, inventory.budgets.artifactBytes);
    assert.equal(bytes.byteLength, pin.bytes); assert.equal(hash(bytes), pin.sha256); total += bytes.byteLength;
  }
  assert.ok(total <= inventory.budgets.aggregateBytes);
  const actual = inventory.pins.find(p => p.path === NAMED_CHANGE);
  assert.deepEqual(actual, manifest.authorities.find(a => a.path === NAMED_CHANGE).current48);
  const second = await outer.captureRuntimeInventory('a'.repeat(40)); assert.deepEqual(second, inventory);
});

test('all closed48 current source and reviewed delta pins remain exact', async () => {
  const { manifest } = await manifests(), source = readerWith();
  for (const pin of [...manifest.authorities.map(a => a.current48), ...manifest.harness.map(a => a.current48), ...manifest.changes.map(a => a.delta)]) {
    await assert.rejects(loadMountedSourceContinuation48({ readArtifact: readerWith(new Map([[pin.path, corrupt(await source(pin.path, pin.bytes))]])) }), refusal);
  }
});

test('runtime identifiers retain exact40hex length including every final line terminator', async () => {
  const outer = await loadMountedSourceContinuation48({ readArtifact: readerWith() });
  for (const sourceSHA of [undefined, null, 48, '', 'a'.repeat(39), 'a'.repeat(41), 'g'.repeat(40),
    ...['\n', '\r', '\r\n', '\u2028', '\u2029'].map(s => 'a'.repeat(40) + s)]) {
    await assert.rejects(outer.captureRuntimeInventory(sourceSHA), refusal);
  }
});

test('non-authority observation and current build reads pass through unchanged; undersized aliases never read', async () => {
  const { manifest } = await manifests(), source = readerWith(), outer = await loadMountedSourceContinuation48({ readArtifact: source });
  const bytes = new Uint8Array([1, 2, 3]), calls = [];
  const fallback = async (path, maximum) => { calls.push({ path, maximum }); return bytes; };
  for (const alias of [outer.retained47SourceReader(fallback), outer.historicalAuthorityReader(fallback)]) {
    for (const path of ['observations/owned.json', 'interactions/owned.json', 'artifacts/sdk-native-manifest-v2.json', 'packages/wasm/dist/editor_wasm_bg.wasm']) {
      assert.equal(await alias(path, 123), bytes); assert.deepEqual(calls.pop(), { path, maximum: 123 });
    }
  }
  const entry = manifest.authorities.find(a => a.path === NAMED_CHANGE);
  await assert.rejects(outer.retained47SourceReader(fallback)(entry.path, entry.accepted47.bytes - 1), refusal);
  assert.deepEqual(calls, []);
});
