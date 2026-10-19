// SPDX-License-Identifier: MIT OR Apache-2.0
// Frozen native literals, then exact public packaged sealed SDK2/WASM replay.
// This headless lane makes no browser, event-order, composition or OS-input claim.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { computeSdkBuildIdentity } from './generate-sdk-types.mjs';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const output = 'artifacts/composition-native';
const reportPath = 'artifacts/composition-native-report.json';
const bytes = path => readFileSync(path);
const digest = path => createHash('sha256').update(bytes(path)).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
const walk = path => readdirSync(path, { withFileTypes: true }).flatMap(e => e.isDirectory()
  ? walk(`${path}/${e.name}`) : e.isFile() ? [`${path}/${e.name}`] : []);
const hashes = paths => Object.fromEntries(paths.map(path => [path, digest(path)]));
const git = args => {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
};
const released = { sessions: 0, snapshot_handles: 0, snapshot_bytes: '0', protected_cursors: 0 };
const decimal = (value, path) => {
  assert.equal(typeof value, 'string', path); assert.match(value, /^(0|[1-9][0-9]*)$/, path);
  const n = BigInt(value); assert(n <= (1n << 64n) - 1n, path); return n;
};
const token = (value, kind, size, path) => {
  assert.equal(typeof value, 'string', path); const fields = value.split(':');
  assert.equal(fields.length, size, path); assert.equal(fields[0], kind, path);
  for (const field of fields.slice(1)) assert(decimal(field, path) > 0n, path);
  return fields;
};

/** Only typed identity fields may bind opaque tokens. All other data is exact.
 * Binding is bijective and Session-generation checked, never allocator rank.
 * The native observer independently checks the complete frozen semantic literals.
 */
function binder(caseId) {
  const forward = new Map(), reverse = new Map(), history = new Map();
  const bindings = [], historyBytes = [];
  const nodeFields = new Set(['node', 'root', 'parent', 'id', 'children', 'upserted', 'removed', 'ancestors_before', 'ancestors_after']);
  let sessionPair = null;
  function identity(a, b, kind, path) {
    if (kind === 'session') {
      const left = token(a, 's1', 3, path), right = token(b, 's1', 3, path);
      assert.equal(left[2], right[2], `${path}: generation exact`);
      if (sessionPair) assert.deepEqual([a, b], sessionPair, `${path}: owning Session`);
      else sessionPair = [a, b];
    } else if (kind === 'node') {
      const left = token(a, 'n1', 4, path), right = token(b, 'n1', 4, path);
      identity(`s1:${left[1]}:${left[2]}`, `s1:${right[1]}:${right[2]}`, 'session', `${path}/namespace`);
    } else {
      assert.equal(kind, 'snapshot');
      const left = a.split(':'), right = b.split(':');
      assert.equal(left.length, 5, path); assert.equal(right.length, 5, path);
      assert.equal(left[0], 'snapshot1', path); assert.equal(right[0], 'snapshot1', path);
      identity(left.slice(1, 4).join(':'), right.slice(1, 4).join(':'), 'session', `${path}/namespace`);
      assert(decimal(left[4], path) > 0n && decimal(right[4], path) > 0n);
    }
    if (forward.has(a)) assert.equal(forward.get(a), b, `${path}: identity continuity`);
    if (reverse.has(b)) assert.equal(reverse.get(b), a, `${path}: no aliasing`);
    if (!forward.has(a)) bindings.push({ kind, native: a, wasm: b, firstPath: path });
    forward.set(a, b); reverse.set(b, a);
  }
  function compare(a, b, path, field = '', historyKey = null) {
    if (field === 'session') { identity(a, b, 'session', path); return; }
    if (field === 'handle') { identity(a, b, 'snapshot', path); return; }
    if (nodeFields.has(field) && typeof a === 'string' && a.startsWith('n1:')) {
      identity(a, b, 'node', path); return;
    }
    if (field === 'retained_bytes') {
      assert(historyKey, `${path}: history ownership requires exact state/event provenance`);
      const left = decimal(a, path), right = decimal(b, path);
      assert(left <= 33554432n && right <= 33554432n, `${path}: history cap`);
      assert.equal(left === 0n, right === 0n, `${path}: empty history ownership`);
      const pair = [a, b];
      if (history.has(historyKey)) assert.deepEqual(pair, history.get(historyKey), `${path}: same-target pure reads retain exact bytes`);
      else history.set(historyKey, pair);
      historyBytes.push({ path, stateKey: historyKey, native: a, wasm: b }); return;
    }
    if (Array.isArray(a)) {
      assert(Array.isArray(b), path); assert.equal(b.length, a.length, path);
      a.forEach((value, i) => compare(value, b[i], `${path}/${i}`, field, historyKey)); return;
    }
    if (a !== null && typeof a === 'object') {
      assert(b !== null && typeof b === 'object' && !Array.isArray(b), path);
      assert.deepEqual(Object.keys(b).sort(), Object.keys(a).sort(), `${path}: closed DTO fields`);
      let key = historyKey;
      if (a.history) {
        const stamp = a.stamp ?? a.after; assert(stamp, `${path}: history's owning stamp`);
        key = JSON.stringify([stamp.revision, stamp.selection_epoch, stamp.history_epoch, a.history.undo_entries, a.history.redo_entries]);
      }
      if (a.session && a.generation) {
        assert.equal(token(a.session, 's1', 3, path)[2], a.generation, path);
        assert.equal(token(b.session, 's1', 3, path)[2], b.generation, path);
      }
      for (const name of Object.keys(a)) compare(a[name], b[name], `${path}/${name}`, name, key);
      return;
    }
    assert.deepEqual(b, a, path);
  }
  function request(value, path = '/request', field = '') {
    if (value === null || typeof value !== 'object') {
      const allowed = field === 'session' || field === 'handle' || nodeFields.has(field);
      if (allowed && typeof value === 'string' && /^(s1:|n1:|snapshot1:)/.test(value)) {
        assert(forward.has(value), `${path}: only a previously observed exact token can be requested`);
        return forward.get(value);
      }
      return value;
    }
    if (Array.isArray(value)) return value.map((item, i) => request(item, `${path}/${i}`, field));
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, request(v, `${path}/${k}`, k)]));
  }
  return { compare, request, summary: () => ({ caseId, bindings, historyBytes,
    normalization: 'Only typed opaque identity fields and bounded target-local history ownership estimates. Every other request/response field remains exact.' }) };
}

mkdirSync(output, { recursive: true });
write(reportPath, { format: 'composition-native-report/1', status: 'running', generatedAt: new Date().toISOString() });
let stage = 'source-artifact-admission';
const owned = [];
let admission = null;
const save = (name, value) => { const path = `${output}/${name}`; write(path, value); owned.push(path); };
try {
  const computed = computeSdkBuildIdentity(), built = json('artifacts/sdk-build-identity.json');
  assert.equal(built.buildId, computed.buildId, 'Rebuild SDK from current production source before this lane');
  assert.deepEqual(built.sourceHashes, computed.sourceHashes);
  const sourcePaths = [...new Set([...Object.keys(computed.sourceHashes), ...walk('contracts/composition/v1'),
    'crates/wasm/examples/composition_native.rs', 'crates/wasm/examples/support/composition_observer.rs',
    'crates/wasm/tests/composition.rs', 'scripts/test-composition-native.mjs', ...walk('packages/sdk/dist'), ...walk('packages/wasm/dist').filter(p => p.endsWith('.js'))])].sort();
  const sourceBefore = hashes(sourcePaths), headBefore = git(['rev-parse', 'HEAD']), statusBefore = git(['status', '--porcelain=v1']);
  const producers = ['artifacts/sdk-build-identity.json', 'artifacts/sdk-wasm-seal.json',
    'artifacts/sdk-native-manifest.json', 'artifacts/sdk-native-manifest-v2.json',
    'packages/wasm/dist/editor_wasm.js', 'packages/wasm/dist/editor_wasm_bg.wasm',
    'artifacts/sdk-distribution/editor_wasm.js', 'artifacts/sdk-distribution/editor_wasm_bg.wasm'];
  const producerBefore = hashes(producers), seal = json('artifacts/sdk-wasm-seal.json');
  admission = { sourcePaths, sourceBefore, producers, producerBefore, headBefore, statusBefore };
  save('admission.json', { buildId: built.buildId, ...admission });
  assert.equal(seal.build_id, built.buildId); assert.equal(seal.sealed_sha256, digest('packages/wasm/dist/editor_wasm_bg.wasm'));
  assert.equal(seal.sealed_bytes, bytes('packages/wasm/dist/editor_wasm_bg.wasm').length);
  for (const name of ['editor_wasm.js', 'editor_wasm_bg.wasm']) assert.deepEqual(bytes(`packages/wasm/dist/${name}`), bytes(`artifacts/sdk-distribution/${name}`));
  const oracle = json('contracts/composition/v1/native-oracles.json');
  stage = 'actual-native-observer';
  const args = ['run', '--locked', '--quiet', '-p', 'klenwriter-editor-wasm', '--example', 'composition_native'];
  const start = new Date().toISOString();
  const result = spawnSync('cargo', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, KLENWRITER_EDITOR_SDK_BUILD_ID: built.buildId } });
  writeFileSync(`${output}/native-observer.json`, result.stdout ?? ''); owned.push(`${output}/native-observer.json`);
  writeFileSync(`${output}/native.stderr.log`, result.stderr ?? ''); owned.push(`${output}/native.stderr.log`);
  save('native-execution.json', { command: 'cargo', args, startedAt: start, finishedAt: new Date().toISOString(),
    actualExit: result.status, signal: result.signal, error: result.error?.message ?? null, buildId: built.buildId });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Native literal failure preserved in ${output}/native-observer.json`);
  const native = JSON.parse(result.stdout);
  assert.equal(native.format, 'osr41-native-composition-observer/1'); assert.equal(native.status, 'passed');
  assert.deepEqual(native.resources_before, released); assert.deepEqual(native.resources_after, released);
  assert.deepEqual(native.cases.map(c => c.id), oracle.cases.map(c => c.id));
  stage = 'sealed-public-sdk2-replay';
  const { loadSdkV2 } = await import(pathToFileURL(resolve('packages/sdk/dist/index.js')).href);
  const module = await loadSdkV2({ wasm: new Uint8Array(bytes('artifacts/sdk-distribution/editor_wasm_bg.wasm')) });
  assert.deepEqual(module.manifest, json('artifacts/sdk-native-manifest-v2.json'));
  assert.deepEqual(JSON.parse(module.resourceCounts()), released, 'No inherited native module resources');
  const replay = { format: 'composition-sealed-sdk2-replay/1', status: 'running', cases: [] }, normalizations = [];
  try {
    for (const record of native.cases) {
      const literal = oracle.cases.find(c => c.id === record.id);
      assert.equal(record.status, 'passed'); assert.equal(record.error, null);
      const binding = binder(record.id), row = { id: record.id, status: 'running', initialization: null, context: null, calls: [] };
      replay.cases.push(row);
      const session = new module.Session(new TextEncoder().encode(literal.input.canonical_json), JSON.stringify(record.options));
      try {
        row.initialization = JSON.parse(session.initialization());
        binding.compare(record.initialization, row.initialization, '/initialization');
        row.context = JSON.parse(session.context()); binding.compare(record.context, row.context, '/context');
        for (const [index, call] of record.calls.entries()) {
          const request = binding.request(call.request), response = JSON.parse(session.call(JSON.stringify(request)));
          row.calls.push({ request, response });
          binding.compare(call.response, response, `/calls/${index}/response`);
        }
        assert.deepEqual(JSON.parse(session.context()), row.context, 'Exact full context remains stable');
        row.status = 'passed';
      } catch (error) { row.status = 'failed'; row.error = String(error?.stack ?? error); throw error; }
      finally {
        session.destroy(); session.free(); row.released = JSON.parse(module.resourceCounts());
        assert.deepEqual(row.released, released, 'Actual owned session and snapshot/protection release');
        assert.deepEqual(record.released, released); normalizations.push(binding.summary());
      }
    }
    replay.status = 'passed';
  } finally { save('sealed-sdk2-replay.json', replay); save('identity-and-memory-bindings.json', normalizations); }
  stage = 'source-artifact-readback';
  const sourceAfter = hashes(sourcePaths), producerAfter = hashes(producers);
  assert.deepEqual(sourceAfter, sourceBefore, 'Source bytes stable during actual lane');
  assert.deepEqual(producerAfter, producerBefore, 'Sealed producer bytes stable during actual lane');
  assert.equal(git(['rev-parse', 'HEAD']), headBefore); assert.equal(git(['status', '--porcelain=v1']), statusBefore);
  const executable = 'target/debug/examples/composition_native';
  write(reportPath, { format: 'composition-native-report/1', status: 'passed', generatedAt: new Date().toISOString(),
    scope: 'Actual public native SDK2 literal assertions, then full DTO replay through public packaged SDK2 Session on the actual distributed sealed release WASM. No test probe, DOM emulation, browser or OS input.',
    buildId: built.buildId, head: headBefore, trackedStatus: statusBefore, sourceBefore, sourceAfter, producerBefore, producerAfter,
    cases: native.cases.length, changed: oracle.counts.changed_success_variants, refused: oracle.counts.native_refusal_variants,
    zeroDispatchCancel: oracle.counts.zero_dispatch_cancel_variants,
    sealedPublicCalls: replay.cases.reduce((n, c) => n + c.calls.length, 0), resources: JSON.parse(module.resourceCounts()),
    normalization: { bindings: normalizations.reduce((n, c) => n + c.bindings.length, 0),
      historyByteFields: normalizations.reduce((n, c) => n + c.historyBytes.length, 0),
      policy: 'Closed field-aware bijections and exact Session-generation continuity; retained_bytes bounded and same-target-purity checked. Complete raw DTOs are preserved, never erased.' },
    artifacts: hashes([...new Set([...owned, ...producers, executable])].sort()) });
  console.log(`Composition native/sealed SDK2: ${native.cases.length} cases; ${replay.cases.reduce((n,c) => n+c.calls.length,0)} actual public calls; release zero.`);
} catch (error) {
  write(reportPath, { format: 'composition-native-report/1', status: 'failed', generatedAt: new Date().toISOString(), stage,
    error: String(error?.stack ?? error), admission,
    sourceAfterFailure: admission ? hashes(admission.sourcePaths) : null,
    producerAfterFailure: admission ? hashes(admission.producers) : null,
    headAfterFailure: admission ? git(['rev-parse', 'HEAD']) : null,
    statusAfterFailure: admission ? git(['status', '--porcelain=v1']) : null,
    preservedRawArtifacts: hashes([...new Set(owned)].sort()) });
  throw error;
}
