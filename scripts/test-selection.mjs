// SPDX-License-Identifier: MIT OR Apache-2.0
// Actual Session selection literals on native and compiled WASM. No DOM emulation.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { computeSdkBuildIdentity } from './generate-sdk-types.mjs';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const output = 'artifacts/selection';
const reportPath = 'artifacts/selection-report.json';
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const walk = path => readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
  ? walk(`${path}/${entry.name}`) : entry.isFile() ? [`${path}/${entry.name}`] : []);
const hashes = paths => Object.fromEntries(paths.map(path => [path, digest(path)]));
const u64Max = (1n << 64n) - 1n;
const historyLimit = 32n * 1024n * 1024n;
const decimal = (value, path) => {
  assert.equal(typeof value, 'string', `${path}: lossless decimal string required`);
  assert.match(value, /^(0|[1-9][0-9]*)$/, `${path}: canonical decimal required`);
  const parsed = BigInt(value);
  assert.ok(parsed <= u64Max, `${path}: u64 overflow`);
  return parsed;
};
const parseToken = (value, prefix, length, path) => {
  assert.equal(typeof value, 'string', `${path}: opaque token required`);
  const parts = value.split(':');
  assert.equal(parts.length, length, `${path}: token component count`);
  assert.equal(parts[0], prefix, `${path}: token kind`);
  for (const [index, part] of parts.slice(1).entries()) {
    assert.ok(decimal(part, `${path}:${index + 1}`) > 0n, `${path}: live identity components must be positive`);
  }
  return parts;
};

/** Only known identity fields are bound. Text, diagnostic details and all other
 * semantic fields remain byte/value exact; no global token replacement occurs.
 * The observer independently asserts canonical bytes, identities, maps, history,
 * budgets and release against pre-candidate literals before returning these rows.
 */
function portableObservation(raw, oracle, target) {
  assert.equal(raw.format, 'osr40-native-selection-observer/1');
  assert.equal(raw.status, 'passed');
  assert.equal(raw.separator_cases, oracle.projection_separator_literals.length);
  assert.equal(raw.output_budget_cases, oracle.output_budget_literals.length);
  assert.equal(raw.format_cases, 2);
  assert.equal(raw.exact_one_mib_read, true);
  assert.equal(raw.stale_guards, 4);
  assert.equal(raw.abi1_new_read_refused, true);
  assert.deepEqual(raw.cases.map(row => row.id), oracle.cases.map(row => row.id), 'Exact frozen case membership and order');
  const portable = structuredClone(raw);
  const sessions = new Set();
  const bindings = [];
  const memory = {};
  const counts = { sessions: 0, nodeRoles: 0, nodeFields: 0, stampFields: 0, historyByteFields: 0 };
  for (const [index, actual] of raw.cases.entries()) {
    const expected = oracle.cases[index];
    const row = portable.cases[index];
    const base = `/cases/${index}`;
    assert.equal(actual.status, 'passed', expected.id);
    const namespace = parseToken(actual.after.stamp.session, 's1', 3, `${base}/after/stamp/session`);
    assert.ok(!sessions.has(actual.after.stamp.session), `${expected.id}: each case owns a fresh Session`);
    sessions.add(actual.after.stamp.session);
    const roles = new Set([...Object.keys(expected.input.identity_roles), ...Object.keys(expected.after.identity_roles)]);
    const roleToToken = new Map();
    const tokenToRole = new Map();
    const identityFields = [];
    const stampFields = [];
    const roleNode = (token, role, path) => {
      assert.ok(roles.has(role), `${path}: role must come from frozen input/output topology`);
      const parts = parseToken(token, 'n1', 4, path);
      assert.deepEqual(parts.slice(1, 3), namespace.slice(1), `${path}: NodeId belongs to exact Session generation`);
      if (roleToToken.has(role)) assert.equal(token, roleToToken.get(role), `${path}: retained role changed identity`);
      if (tokenToRole.has(token)) assert.equal(role, tokenToRole.get(token), `${path}: distinct roles aliased`);
      roleToToken.set(role, token);
      tokenToRole.set(token, role);
      identityFields.push({ path, role, token });
      counts.nodeFields += 1;
      return `@node:${role}`;
    };
    const position = (value, literal, path) => {
      const result = structuredClone(value);
      const field = literal.kind === 'child' ? 'parent' : 'node';
      assert.equal(value.kind, literal.kind, `${path}: exact position kind`);
      result[field] = roleNode(value[field], literal[field], `${path}/${field}`);
      assert.deepEqual(result, { ...literal, [field]: `@node:${literal[field]}` }, `${path}: exact literal position`);
      return result;
    };
    const selection = (value, literal, path) => {
      if (literal === null) { assert.equal(value, null, path); return null; }
      assert.deepEqual(Object.keys(value).sort(), ['anchor', 'focus'], `${path}: directed selection shape`);
      return {
        anchor: position(value.anchor, literal.anchor, `${path}/anchor`),
        focus: position(value.focus, literal.focus, `${path}/focus`),
      };
    };
    const initialCounters = {
      revision: '0', history_epoch: '0', selection_epoch: expected.input.selection === null ? '0' : '1',
    };
    const facets = expected.delete_selection.execute_facets;
    const afterCounters = Object.fromEntries(Object.entries(initialCounters).map(([key, value]) => [key,
      (BigInt(value) + BigInt(facets[`${key}_delta`] ?? 0)).toString()]));
    const stamp = (value, counters, path) => {
      assert.deepEqual(Object.keys(value).sort(), ['generation', 'history_epoch', 'revision', 'selection_epoch', 'session'], `${path}: stamp fields`);
      assert.equal(value.session, actual.after.stamp.session, `${path}: exact owning Session`);
      assert.equal(value.generation, namespace[2], `${path}: token/stamp generation agrees`);
      for (const [key, counter] of Object.entries(counters)) {
        decimal(value[key], `${path}/${key}`);
        assert.equal(value[key], counter, `${path}: frozen ${key}`);
      }
      stampFields.push({ path, value });
      counts.stampFields += 1;
      return { ...value, session: `@session:${expected.id}` };
    };
    const state = (value, path) => {
      const result = structuredClone(value);
      result.root = roleNode(value.root, 'ROOT', `${path}/root`);
      result.selection = selection(value.selection, expected.after.selection, `${path}/selection`);
      result.stamp = stamp(value.stamp, afterCounters, `${path}/stamp`);
      assert.equal(value.saved_revision, '0', `${path}: saved revision`);
      assert.equal(value.stored_marks, null, `${path}: stored marks`);
      const changed = expected.delete_selection.execute.status === 'ok'
        && expected.delete_selection.execute.value.effect === 'changed';
      assert.equal(value.dirty, changed, `${path}: dirty`);
      assert.equal(value.history.undo_entries, changed ? '1' : '0', `${path}: undo entry count`);
      assert.equal(value.history.redo_entries, '0', `${path}: redo entry count`);
      const bytePath = `${path}/history/retained_bytes`;
      const bytes = decimal(value.history.retained_bytes, bytePath);
      assert.ok(bytes <= historyLimit, `${bytePath}: default aggregate history cap`);
      assert.equal(bytes > 0n, changed, `${bytePath}: only Changed retains one history entry`);
      memory[bytePath] = value.history.retained_bytes;
      result.history.retained_bytes = { targetLocal: 'native-history-ownership-estimate', empty: bytes === 0n };
      counts.historyByteFields += 1;
      return result;
    };
    row.after = state(actual.after, `${base}/after`);
    if (expected.projection.expected.status === 'ok') {
      assert.equal(actual.projection.status, 'ok', expected.id);
      const value = row.projection.value;
      const literal = expected.projection.expected.value;
      value.selection = selection(actual.projection.value.selection, expected.input.selection, `${base}/projection/value/selection`);
      value.stamp = stamp(actual.projection.value.stamp, initialCounters, `${base}/projection/value/stamp`);
      assert.equal(actual.projection.value.selected_atoms.length, literal.selected_atoms.length);
      value.selected_atoms = actual.projection.value.selected_atoms.map((token, i) =>
        roleNode(token, literal.selected_atoms[i], `${base}/projection/value/selected_atoms/${i}`));
      assert.deepEqual(value, { ...literal, stamp: value.stamp, selection: value.selection,
        selected_atoms: literal.selected_atoms.map(role => `@node:${role}`) }, `${expected.id}: exact projection literal`);
    } else {
      assert.equal(actual.projection.status, 'refused', expected.id);
      row.projection.diagnostic.stamp = stamp(actual.projection.diagnostic.stamp, initialCounters, `${base}/projection/diagnostic/stamp`);
      assert.deepEqual(row.projection, { ...expected.projection.expected, diagnostic: {
        ...expected.projection.expected.diagnostic, stamp: row.projection.diagnostic.stamp,
      } }, `${expected.id}: exact projection refusal`);
    }
    if (expected.delete_selection.execute.status === 'ok') {
      assert.equal(actual.execute.status, 'ok', expected.id);
      assert.deepEqual(actual.execute.value.state, actual.after, `${expected.id}: mutation reply is exact same-target observed after-state`);
      row.execute.value.state = state(actual.execute.value.state, `${base}/execute/value/state`);
      assert.deepEqual(row.execute, { status: 'ok', value: { ...expected.delete_selection.execute.value,
        state: row.after } }, `${expected.id}: exact execute literal`);
      assert.equal(BigInt(memory[`${base}/execute/value/state/history/retained_bytes`])
        - BigInt(memory[`${base}/after/history/retained_bytes`]), 0n, `${expected.id}: same-target retained-byte delta`);
    } else {
      assert.equal(actual.execute.status, 'refused', expected.id);
      row.execute.diagnostic.stamp = stamp(actual.execute.diagnostic.stamp, afterCounters, `${base}/execute/diagnostic/stamp`);
      assert.deepEqual(row.execute, { ...expected.delete_selection.execute, diagnostic: {
        ...expected.delete_selection.execute.diagnostic, stamp: row.execute.diagnostic.stamp,
      } }, `${expected.id}: exact execute refusal`);
    }
    counts.sessions += 1;
    counts.nodeRoles += roleToToken.size;
    bindings.push({ caseId: expected.id, session: actual.after.stamp.session, generation: namespace[2],
      observedRoleTokens: Object.fromEntries([...roleToToken.entries()].sort(([a], [b]) => a.localeCompare(b))),
      identityFields, stampFields,
      qualification: 'Only roles exposed in returned DTOs are bound here; the shared observer independently asserts complete live topology, retention/retirement/creation, maps and undo/redo against frozen literals.',
    });
  }
  return { target, portable, bindings, memory, counts };
}

mkdirSync(output, { recursive: true });
// Refuse to leave a prior successful report representing a failed current run.
writeJson(reportPath, { format: 'klenwriter-editor-selection-report/1', status: 'running', generatedAt: new Date().toISOString() });
let stage = 'source-and-artifact-admission';
try {
  const sdkIdentity = computeSdkBuildIdentity();
  const built = json('artifacts/sdk-build-identity.json');
  assert.equal(built.buildId, sdkIdentity.buildId, 'Build SDK artifacts from this source before testing selection');
  assert.deepEqual(built.sourceHashes, sdkIdentity.sourceHashes);
  const sources = [...new Set([...Object.keys(sdkIdentity.sourceHashes),
    ...walk('contracts/selection/v1'), ...walk('contracts/sdk/v1'), ...walk('contracts/dom/v1'), ...walk('contracts/commands/v1'),
    'crates/wasm/examples/selection_native.rs', 'crates/wasm/examples/support/selection_observer.rs',
    'crates/wasm/examples/sdk_probe.rs', 'crates/wasm/tests/selection.rs',
    'scripts/test-selection.mjs', 'packages/wasm/src/sdk-types.ts', 'packages/wasm/src/sdk-types-v2.ts',
  ])].sort();
  const before = hashes(sources);
  const producerPaths = ['artifacts/sdk-build-identity.json', 'artifacts/sdk/probe.js', 'artifacts/sdk/probe_bg.wasm',
    'packages/wasm/dist/editor_wasm.js', 'packages/wasm/dist/editor_wasm_bg.wasm',
    'artifacts/sdk-distribution/editor_wasm.js', 'artifacts/sdk-distribution/editor_wasm_bg.wasm',
    'artifacts/sdk-wasm-seal.json', 'artifacts/sdk-native-manifest.json', 'artifacts/sdk-native-manifest-v2.json',
    'artifacts/sdk-distribution/sdk-native-manifest.json', 'artifacts/sdk-distribution/sdk-native-manifest-v2.json'];
  const producerBefore = hashes(producerPaths);
  const manifests = ['artifacts/sdk-native-manifest.json', 'artifacts/sdk-native-manifest-v2.json'].map(json);
  assert.equal(manifests[0].abi, 'editor-sdk/1');
  assert.equal(manifests[1].abi, 'editor-sdk/2');
  for (const manifest of manifests) assert.equal(manifest.build_id, sdkIdentity.buildId, 'Native manifests match exact production identity');
  for (const name of ['editor_wasm.js', 'editor_wasm_bg.wasm']) {
    assert.deepEqual(readFileSync(`artifacts/sdk-distribution/${name}`), readFileSync(`packages/wasm/dist/${name}`), 'Distributed producer bytes must equal packaged bytes');
  }
  for (const name of ['sdk-native-manifest.json', 'sdk-native-manifest-v2.json']) {
    assert.deepEqual(readFileSync(`artifacts/sdk-distribution/${name}`), readFileSync(`artifacts/${name}`), 'Distributed manifests must equal actual native manifests');
  }
  const seal = json('artifacts/sdk-wasm-seal.json');
  assert.equal(seal.build_id, sdkIdentity.buildId);
  assert.equal(seal.sealed_sha256, digest('packages/wasm/dist/editor_wasm_bg.wasm'));
  assert.equal(seal.sealed_bytes, readFileSync('packages/wasm/dist/editor_wasm_bg.wasm').length);
  const oracle = json('contracts/selection/v1/native-oracles.json');
  stage = 'native-observer';
  const args = ['run', '--locked', '--quiet', '-p', 'klenwriter-editor-wasm', '--example', 'selection_native'];
  const result = spawnSync('cargo', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, KLENWRITER_EDITOR_SDK_BUILD_ID: sdkIdentity.buildId } });
  writeFileSync(`${output}/native.stderr.log`, result.stderr ?? '');
  writeFileSync(`${output}/native-observer.json`, result.stdout ?? '');
  writeJson(`${output}/native-execution.json`, { command: 'cargo', args, status: result.status, signal: result.signal,
    error: result.error?.message ?? null, buildId: sdkIdentity.buildId });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Actual native selection observer failed: ${result.stderr}`);
  const native = JSON.parse(result.stdout);
  stage = 'compiled-wasm-observer';
  const module = await import(pathToFileURL(resolve('artifacts/sdk/probe.js')).href);
  await module.default({ module_or_path: readFileSync('artifacts/sdk/probe_bg.wasm') });
  assert.deepEqual(JSON.parse(module.sdkManifestV1()), manifests[0], 'Actual probe ABI1 manifest must match native/source build');
  assert.deepEqual(JSON.parse(module.sdkManifestV2()), manifests[1], 'Actual probe ABI2 manifest must match native/source build');
  const released = { sessions: 0, snapshot_handles: 0, snapshot_bytes: '0', protected_cursors: 0 };
  const resources = { before: JSON.parse(module.sdkResourceCountsV2()) };
  assert.deepEqual(resources.before, released, 'No inherited native resources');
  const wasmRaw = module.observeSelection();
  writeFileSync(`${output}/wasm-observer.json`, wasmRaw + '\n');
  resources.after = JSON.parse(module.sdkResourceCountsV2());
  assert.deepEqual(resources.after, released, 'Selection observer releases actual WASM resources');
  const repeatRaw = module.observeSelection();
  writeFileSync(`${output}/wasm-repeat-observer.json`, repeatRaw + '\n');
  resources.afterRepeat = JSON.parse(module.sdkResourceCountsV2());
  writeJson(`${output}/wasm-resources.json`, resources);
  assert.deepEqual(resources.afterRepeat, released, 'Repeated observer releases actual WASM resources');
  stage = 'literal-and-role-comparison';
  const observations = [portableObservation(native, oracle, 'native'),
    portableObservation(JSON.parse(wasmRaw), oracle, 'wasm32'),
    portableObservation(JSON.parse(repeatRaw), oracle, 'wasm32-repeat')];
  for (const observation of observations) {
    writeJson(`${output}/${observation.target}-portable.json`, observation.portable);
    writeJson(`${output}/${observation.target}-bindings.json`, { counts: observation.counts, bindings: observation.bindings });
  }
  const [nativeResult, wasmResult, repeated] = observations;
  assert.deepEqual(wasmResult.portable, nativeResult.portable, 'Exact semantic public DTO parity after closed field-aware identity/ownership binding');
  assert.deepEqual(repeated.portable, wasmResult.portable, 'Fresh WASM Session identities preserve all semantic results');
  assert.deepEqual(repeated.memory, wasmResult.memory, 'Same target/repeated literals retain exactly equal ownership bytes');
  const wasmSessions = new Set(wasmResult.bindings.map(binding => binding.session));
  for (const binding of repeated.bindings) assert.ok(!wasmSessions.has(binding.session), 'Repeat actually allocates fresh opaque Sessions');
  assert.deepEqual(Object.keys(nativeResult.memory), Object.keys(wasmResult.memory));
  const memoryDiagnostics = Object.fromEntries(Object.entries(nativeResult.memory).map(([path, bytes]) => [path, {
    native: bytes, wasm32: wasmResult.memory[path], wasm32Repeat: repeated.memory[path],
    wasm32MinusNative: (BigInt(wasmResult.memory[path]) - BigInt(bytes)).toString(),
    repeatMinusWasm32: (BigInt(repeated.memory[path]) - BigInt(wasmResult.memory[path])).toString(),
  }]));
  writeJson(`${output}/history-ownership-diagnostics.json`, {
    paths: memoryDiagnostics, defaultAggregateCap: historyLimit.toString(),
    executeAfterDelta: '0',
    qualification: 'Only StateDto.history.retained_bytes is target-local: Rust ownership estimates include target layout/size_of metadata. Raw values and exact signed cross-target deltas are retained; same-target execute/after and WASM repeat byte values must be identical. All other history/state fields compare exactly.',
  });
  stage = 'final-source-and-artifact-stability';
  const after = hashes(sources);
  assert.deepEqual(after, before, 'Source changed during observation; raw outputs retained, success report refused');
  assert.deepEqual(hashes(producerPaths), producerBefore, 'Producer artifacts changed during observation; success report refused');
  assert.deepEqual(computeSdkBuildIdentity(), sdkIdentity, 'Production identity remains exact');
  // Other lanes also write artifacts/selection. Pin only this runner's owned
  // files so later controller/browser lanes cannot invalidate this receipt.
  const ownedOutputs = ['native.stderr.log', 'native-observer.json', 'native-execution.json',
    'wasm-observer.json', 'wasm-repeat-observer.json', 'wasm-resources.json',
    'native-portable.json', 'native-bindings.json', 'wasm32-portable.json', 'wasm32-bindings.json',
    'wasm32-repeat-portable.json', 'wasm32-repeat-bindings.json', 'history-ownership-diagnostics.json']
    .map(name => `${output}/${name}`);
  const artifactPaths = [...producerPaths, 'target/debug/examples/selection_native', ...ownedOutputs].sort();
  const report = {
    format: 'klenwriter-editor-selection-report/1', status: 'passed', nativeWasmEqual: true, wasmRepeatEqual: true,
    buildId: sdkIdentity.buildId, sourceUnchanged: true, producerUnchanged: true,
    sourceHashes: after, artifactHashes: hashes(artifactPaths),
    observerSummary: Object.fromEntries(Object.entries(native).filter(([key]) => key !== 'cases')),
    cases: oracle.cases.length, resourceCounts: resources,
    normalizations: {
      identities: 'Only explicit SessionStamp.session, StateDto.root, directed Text/Child/Edge position identity fields and selected_atoms bind to frozen case/role names. Per-case bijection, namespace/generation, counter literals and fresh-session disjointness are mandatory. No numeric ID ranking or text/diagnostic rewriting.',
      historyOwnership: { fields: Object.keys(memoryDiagnostics).length,
        differentNativeWasmFields: Object.values(memoryDiagnostics).filter(row => row.native !== row.wasm32).length,
        diagnosticPath: `${output}/history-ownership-diagnostics.json`,
        scope: 'Only history.retained_bytes; original full history/state remains in each raw report. Counts, dirty/stored marks, stamps and all other semantic fields remain exact.' },
      counts: Object.fromEntries(observations.map(({ target, counts }) => [target, counts])),
    },
    scope: 'Actual public Session selection projection/delete-selection, frozen 24 literal rows, separator/format/budget/stale/ABI compatibility checks, complete native maps/history/identity assertions within the common observer, and compiled WASM repeat. DOM, clipboard scheduling and installed physical input are separate lanes.',
    nativeExecutableHash: 'Target-local/compiler-dependent diagnostic, not portable semantic data.',
    generatedAt: new Date().toISOString(),
  };
  writeJson(reportPath, report);
  console.log(`Selection native/WASM PASS: cases=${report.cases}; separators=${native.separator_cases}; budgets=${native.output_budget_cases}; source hashes=${sources.length}; report=${reportPath}`);
} catch (error) {
  writeJson(reportPath, { format: 'klenwriter-editor-selection-report/1', status: 'failed', stage,
    error: { name: error.name, message: error.message, stack: error.stack },
    rawEvidenceDirectory: output, generatedAt: new Date().toISOString() });
  throw error;
}
