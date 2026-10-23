// SPDX-License-Identifier: MIT OR Apache-2.0
// Eight frozen admission observations through the actual packaged SDK2/WASM.
// This lane does not mount a DOM editor or claim native browser observation.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createEditor, loadSdkV2, sdkBuildId } from '../packages/sdk/dist/index.js';
import { kwdjCommand } from '../packages/kwdj/dist/index.js';
import { computeSdkBuildIdentity } from '../scripts/generate-sdk-types.mjs';
import { wasmSections, sdkWasmSectionName } from '../scripts/seal-sdk-wasm.mjs';

const directory = 'contracts/failure-states/v1/admission';
const read = path => readFileSync(path);
const json = path => JSON.parse(read(path).toString('utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pin = path => { const bytes = read(path); return { path, bytes: bytes.length, sha256: sha(bytes) }; };
const copy = value => structuredClone(value);
// Public DTO records deliberately have null prototypes. Compare their data.
const equal = (actual, expected, message) => assert.deepEqual(copy(actual), copy(expected), message);
const contract = json(`${directory}/cases.json`);
const template = json(`${directory}/options.template.json`);
const records = contract.cases.map(row => ({ id: row.id, name: row.name, status: 'NOT_RUN' }));
const scope = 'Actual public createEditor/loadSdkV2, matching sealed packaged WASM and Rust KWDJ admission; no fake module, mounted DOM, installed browser or independent review claim.';
let producer, productionPromise;

function artifactFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    assert(!entry.isSymbolicLink(), `No artifact symlink: ${directory}/${entry.name}`);
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? artifactFiles(path) : /\.(?:js|wasm)$/.test(entry.name) ? [path] : [];
  });
}

async function production() {
  return productionPromise ??= (async () => {
    producer = { status: 'VERIFYING', sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      contracts: readdirSync(directory).sort().map(name => pin(`${directory}/${name}`)),
      testSource: pin('tests/failure-admission.node.mjs'), scope };
    assert.equal(contract.format, 'osr67-ac2-joined-public-controller-admission-contract/1');
    assert.equal(contract.case_count, 8); assert.equal(contract.cases.length, 8);
    equal(contract.cases.map(row => row.id), Array.from({ length: 8 }, (_, index) => `AC2-${String(index).padStart(2, '0')}`));
    for (const fixture of contract.inputs) {
      const actual = pin(`${directory}/${fixture.path}`);
      assert.equal(actual.bytes, fixture.bytes); assert.equal(actual.sha256, fixture.sha256);
      // Fatal UTF-8 decoding prevents replacement characters from hiding bytes.
      const text = new TextDecoder('utf-8', { fatal: true }).decode(read(actual.path));
      equal(new TextEncoder().encode(text), new Uint8Array(read(actual.path)));
    }
    const identity = json('artifacts/sdk-build-identity.json'), current = computeSdkBuildIdentity();
    producer.currentSource = current;
    assert.equal(identity.format, 'klenwriter-editor-sdk-build/1');
    assert.equal(identity.buildId, sdkBuildId); assert.equal(current.buildId, sdkBuildId);
    equal(identity.sourceHashes, current.sourceHashes, 'Every producer input is still the compiled source');
    const sourceId = /export const sdkBuildId = "(sha256:[0-9a-f]{64})" as const;/.exec(read('packages/wasm/src/sdk-build-id.ts').toString('utf8'));
    assert(sourceId); assert.equal(sourceId[1], sdkBuildId);
    const distId = /export const sdkBuildId = "(sha256:[0-9a-f]{64})";/.exec(read('packages/wasm/dist/sdk-build-id.js').toString('utf8'));
    assert(distId); assert.equal(distId[1], sdkBuildId);
    const wasmPath = 'packages/wasm/dist/editor_wasm_bg.wasm', wasm = new Uint8Array(read(wasmPath));
    const sections = wasmSections(wasm), seals = sections.filter(section => section.name === sdkWasmSectionName);
    assert.equal(seals.length, 1); const section = seals[0]; assert.equal(section.end, wasm.length);
    const seal = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(wasm.subarray(section.dataStart, section.end)));
    const recordedSeal = json('artifacts/sdk-wasm-seal.json');
    const manifestV1 = json('artifacts/sdk-native-manifest.json'), manifestV2 = json('artifacts/sdk-native-manifest-v2.json');
    assert.equal(seal.format, 'klenwriter-editor-sdk-wasm/1'); assert.equal(seal.abi, 'editor-sdk/1');
    assert.equal(seal.build_id, sdkBuildId); assert.equal(seal.wasm_bytes, section.start);
    assert.equal(seal.wasm_sha256, sha(wasm.subarray(0, section.start)));
    for (const [key, value] of Object.entries(seal)) equal(recordedSeal[key], value, `Seal record ${key}`);
    assert.equal(recordedSeal.section, sdkWasmSectionName);
    assert.equal(recordedSeal.sealed_bytes, wasm.length); assert.equal(recordedSeal.sealed_sha256, sha(wasm));
    assert.equal(manifestV1.abi, seal.abi); assert.equal(manifestV1.build_id, sdkBuildId);
    assert.equal(manifestV2.abi, 'editor-sdk/2'); assert.equal(manifestV2.build_id, sdkBuildId);
    producer.artifacts = [...new Set(['artifacts/sdk-build-identity.json', 'artifacts/sdk-wasm-seal.json',
      'artifacts/sdk-native-manifest.json', 'artifacts/sdk-native-manifest-v2.json', 'packages/wasm/src/sdk-build-id.ts',
      ...['sdk', 'wasm', 'kwdj'].flatMap(name => artifactFiles(`packages/${name}/dist`))])].sort().map(pin);
    producer.seal = seal; producer.manifests = { v1: manifestV1, v2: manifestV2 };
    const module = await loadSdkV2({ wasm });
    equal(module.manifest, manifestV2, 'Actual WASM native SDK2 manifest equals its producer record');
    assert.equal(module.manifest.build_id, sdkBuildId);
    assert.equal(template.build_id, '$CURRENT_SOURCE_BUILD_ID');
    const profile = module.manifest.profiles.find(item => item.profile_id === template.profile.profile_id);
    assert(profile);
    for (const key of ['profile_id', 'profile_version', 'codec_id', 'wire_version']) equal(profile[key], template.profile[key]);
    for (const extension of template.profile.extensions) assert(profile.compiled_extensions.some(item => JSON.stringify(item) === JSON.stringify(extension)));
    producer.buildIdBinding = { field: 'options.build_id', parameter: template.build_id, value: sdkBuildId };
    producer.status = 'VERIFIED'; return module;
  })();
}

const ok = response => { assert.equal(response.status, 'ok', JSON.stringify(response)); return response.value; };
const completed = ticket => { assert.equal(ticket.status, 'completed'); return ticket.response; };
const getState = editor => { const value = ok(editor.read({ kind: 'state' })); assert.equal(value.kind, 'state'); return value.state; };
const native = module => JSON.parse(module.resourceCounts());
function tree(editor) {
  const stamp = editor.capture(), pending = [{ id: getState(editor).root, path: [] }], result = [], seen = new Set();
  for (let index = 0; index < pending.length; index++) {
    assert(index < 32, 'This literal has a bounded small tree');
    const item = pending[index]; assert(!seen.has(item.id)); seen.add(item.id);
    const value = ok(editor.read({ kind: 'node', stamp, node: item.id })); assert.equal(value.kind, 'node');
    equal(value.node.stamp, stamp); assert.equal(value.node.id, item.id);
    result.push({ path: item.path, node: value.node });
    value.node.children.forEach((id, child) => pending.push({ id, path: [...item.path, child] }));
  }
  return result;
}
function canonical(editor) {
  const before = editor.nativeResources(), snapshot = ok(completed(editor.submit({ kind: 'snapshot', stamp: editor.capture(), max_bytes: 65536 })));
  assert.equal(snapshot.kind, 'snapshot');
  try { equal(snapshot.stamp, editor.capture()); return snapshot.canonical_json; }
  finally { assert.equal(ok(completed(editor.submit({ kind: 'release_snapshot', handle: snapshot.handle }))).kind, 'released');
    equal(editor.nativeResources(), before, 'Temporary observation snapshot has been released'); }
}
function checkpoint(editor, events) {
  const state = getState(editor), rows = tree(editor), canonicalJson = canonical(editor);
  return copy({ state, rows, canonical: canonicalJson, capture: editor.capture(), context: editor.context(),
    originalInput: editor.originalInput(), resources: editor.resources(), native: editor.nativeResources(), events });
}
function zeroOwned(resources, originalBytes = 0) {
  assert.equal(resources.lifecycle, 'destroyed');
  for (const [name, value] of Object.entries(resources)) if (name !== 'lifecycle') {
    assert.equal(typeof value, 'number'); assert.equal(value, name === 'original_input_bytes' ? originalBytes : 0, name);
  }
}
function applyOverride(options, override) {
  if (!override) return;
  const path = override.field.split('.'); let target = options;
  for (const field of path.slice(0, -1)) { assert(Object.hasOwn(target, field)); target = target[field]; }
  assert(Object.hasOwn(target, path.at(-1))); target[path.at(-1)] = copy(override.value);
}
function healthy(editor, ready, baseline, record) {
  assert.equal(ready.status, 'ok'); assert.equal(ready.value.kind, 'state'); assert.equal(editor.lifecycle, 'ready');
  equal(editor.capture(), ready.value.state.stamp); assert.notEqual(editor.capture(), null);
  const context = editor.context(); assert.notEqual(context, null);
  assert.equal(context.build_id, sdkBuildId); equal(context.profile, template.profile);
  assert.match(context.registry_digest, /^[0-9a-f]{64}$/); assert.match(context.capability_digest, /^[0-9a-f]{64}$/);
  const events = [], unsubscribe = editor.subscribe(event => events.push(copy(event)));
  assert.equal(typeof unsubscribe, 'function');
  let point;
  try { point = checkpoint(editor, events); }
  finally { unsubscribe(); }
  record.healthy = point;
  equal(point.state, ready.value.state); assert.equal(point.canonical, read(`${directory}/${contract.canonical_literals.healthy}`).toString('utf8'));
  assert.equal(point.originalInput, null);
  for (const [field, expected] of Object.entries(contract.cases[0].expected.state)) {
    let actual = point.state; for (const key of field.split('.')) actual = actual[key]; equal(actual, expected, field);
  }
  equal(point.native, { ...baseline, sessions: baseline.sessions + 1, protected_cursors: baseline.protected_cursors + 1 });
  assert.equal(point.resources.sessions, 1); assert.equal(point.resources.original_input_bytes, 0);
  equal(point.events, [], 'Actual listener sees no publication from read-only observations'); return point;
}

for (const [index, row] of contract.cases.entries()) test(`failure actual SDK2/WASM ${row.id} ${row.name}`, { concurrency: false }, async () => {
  const record = records[index]; record.status = 'RUNNING'; record.literal = row;
  let module, editor, baseline, hostBytes, unsubscribe, failure;
  try {
    module = await production(); baseline = native(module); record.baseline = baseline;
    equal(baseline, { sessions: 0, snapshot_handles: 0, snapshot_bytes: '0', protected_cursors: 0 }, 'Cases do not share live owners');
    const inputName = row.input ?? contract.cases[0].input;
    hostBytes = new Uint8Array(read(`${directory}/${inputName}`));
    const callerBytes = hostBytes.slice(), options = copy(template); options.build_id = sdkBuildId;
    applyOverride(options, row.single_literal_option_override); record.options = copy(options);
    editor = createEditor({ input: callerBytes, options, loader: async () => module });
    // Mutate the caller's buffer before the loader continuation; admission and
    // recovery must use the controller's separate exact byte copy.
    callerBytes.fill(0); record.callerBytesAfterMutation = [...callerBytes];
    const ready = await editor.ready; record.ready = copy(ready); record.lifecycleAfterReady = editor.lifecycle;
    record.hostOriginal = [...hostBytes];
    if (row.expected.oracles === 'INITIAL_REFUSAL') {
      equal(ready, { status: row.expected.status, diagnostic: row.expected.diagnostic });
      record.capture = editor.capture(); record.context = editor.context();
      assert.equal(record.capture, null); assert.equal(record.context, null);
      const stateRead = editor.read({ kind: 'state' }); record.stateRead = copy(stateRead);
      assert.equal(stateRead.status, 'refused'); assert.equal(stateRead.diagnostic.code, 'sdk.disposed');
      assert.equal(Object.hasOwn(stateRead, 'value'), false, 'No admitted StateDto or invented empty state');
      const events = []; const attempted = editor.subscribe(event => events.push(copy(event)));
      assert.equal(typeof attempted, 'object'); assert.equal(attempted.status, 'refused');
      record.subscribeResult = copy(attempted); record.events = events; equal(events, []);
      const first = editor.originalInput(); assert(first instanceof Uint8Array); equal(first, hostBytes);
      first.fill(0); const second = editor.originalInput(); assert(second instanceof Uint8Array);
      equal(second, hostBytes, 'Each recovery read is a fresh independent byte copy');
      record.recoveryBytes = [...second]; record.recoveryCopyIndependent = true;
      record.resourcesAfterRefusal = copy(editor.resources()); zeroOwned(record.resourcesAfterRefusal, hostBytes.length);
      record.nativeAfterRefusal = native(module); equal(record.nativeAfterRefusal, baseline);
      equal(editor.callbackErrors(), []);
    } else {
      const initial = healthy(editor, ready, baseline, record);
      if (row.id === 'AC2-07') {
        const leaves = initial.rows.filter(item => item.node.text !== null); assert.equal(leaves.length, 1);
        const point = { kind: 'text', node: leaves[0].node.id, offset: 0, affinity: 'after' };
        record.setSelection = copy(completed(editor.submit({ kind: 'set_selection', stamp: editor.capture(), selection: { anchor: point, focus: point } })));
        ok(record.setSelection);
        record.insert = copy(completed(editor.submit({ kind: 'command', stamp: editor.capture(),
          command: kwdjCommand({ kind: 'insert_text', text: 'X' }), history_hint: { kind: 'isolated' } })));
        assert.equal(ok(record.insert).kind, 'mutation');
        const events = []; unsubscribe = editor.subscribe(event => events.push(copy(event))); assert.equal(typeof unsubscribe, 'function');
        const before = checkpoint(editor, events); record.beforeRemount = before;
        assert.equal(before.state.dirty, true); assert.equal(before.state.saved_revision, '0');
        assert.equal(before.state.history.undo_entries, '1'); assert.equal(before.state.history.redo_entries, '0');
        assert.notEqual(before.state.selection, null); equal(before.state.selection.anchor, before.state.selection.focus);
        assert.equal(before.canonical, read(`${directory}/${contract.canonical_literals.after_isolated_X_insert}`).toString('utf8'));
        assert.notEqual(before.canonical, initial.canonical); assert.equal(before.originalInput, null);
        const request = copy(row.request); assert.equal(request.stamp, 'EXACT_CAPTURED_PRE_STATE_STAMP'); request.stamp = before.state.stamp;
        const candidateBytes = new TextEncoder().encode(request.input_json); record.hostMalformedCandidate = [...candidateBytes];
        const ticket = editor.submit(request); record.submissionStatus = ticket.status;
        assert.equal(ticket.status, row.expected.submission_status); record.response = copy(ticket.response);
        const expected = copy(row.expected.response); assert.equal(expected.diagnostic.stamp, 'EXACT_CAPTURED_PRE_STATE_STAMP'); expected.diagnostic.stamp = before.state.stamp;
        equal(record.response, expected);
        const after = checkpoint(editor, events); record.afterRemount = after;
        equal(after, before, 'Full admitted state/tree/canonical/context/all stamp facets/resources/events retained');
        equal(events, [], 'Malformed remount publishes no success, mutation or replacement state');
        assert.equal(editor.originalInput(), null);
        equal(candidateBytes, new TextEncoder().encode(row.request.input_json));
        equal(hostBytes, new Uint8Array(read(`${directory}/valid-original.utf8`)));
        assert.equal(record.beforeRemount.canonical, read(`${directory}/${contract.canonical_literals.after_isolated_X_insert}`).toString('utf8'));
      }
    }
    equal(hostBytes, new Uint8Array(read(`${directory}/${inputName}`)), 'Host retains its separate original bytes');
    record.status = 'PASSED';
  } catch (error) {
    failure = error; record.status = 'FAILED'; record.originalFailure = { name: error.name, message: error.message, stack: error.stack };
  } finally {
    if (editor) try {
      if (unsubscribe) unsubscribe();
      const ticket = editor.destroy(); record.destroySubmission = ticket.status;
      record.destroyResponse = copy(ticket.status === 'queued' ? await ticket.completion : ticket.response);
      equal(record.destroyResponse, { status: 'ok', value: { kind: 'destroyed' } });
      record.finalResources = copy(editor.resources()); zeroOwned(record.finalResources);
      record.finalNative = native(module); equal(record.finalNative, baseline);
      assert.equal(editor.capture(), null); assert.equal(editor.context(), null); assert.equal(editor.originalInput(), null);
      record.retainedHostOriginal = [...hostBytes];
      equal(hostBytes, new Uint8Array(read(`${directory}/${row.input ?? contract.cases[0].input}`)));
      record.cleanup = 'PASSED';
    } catch (error) {
      record.cleanup = 'FAILED'; record.cleanupFailure = { name: error.name, message: error.message, stack: error.stack };
      failure ??= error; record.status = 'FAILED';
    }
  }
  if (failure) throw failure;
});

after(() => {
  mkdirSync('artifacts/failure-states/admission', { recursive: true });
  writeFileSync('artifacts/failure-states/admission/report.json', JSON.stringify({
    format: 'osr67-ac2-joined-public-controller-admission-observations/1', scope,
    status: records.length === 8 && records.every(record => record.status === 'PASSED' && record.cleanup === 'PASSED') ? 'PASSED' : 'FAILED',
    producer, records,
  }, null, 2) + '\n');
});
