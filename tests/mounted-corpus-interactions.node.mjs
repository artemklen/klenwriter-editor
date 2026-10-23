// SPDX-License-Identifier: MIT OR Apache-2.0
// Data-only source and collector controls; none is product/browser acceptance.
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { collectInteractions, interactionValidators, assessInteraction } from '../scripts/mounted-corpus/collect-interactions.mjs';
import { ownBoundedData, RESOURCE_KEYS } from '../scripts/mounted-corpus/protocol.mjs';
import { observeNativeModule } from '../scripts/mounted-corpus/native-observer.mjs';
import { loadMountedSourceContinuation67 } from '../scripts/mounted-corpus/source-continuation67.mjs';
import { loadMountedResourceProfile67 } from '../scripts/mounted-corpus/resource-profile67.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
// Actual filesystem reads remain fresh; only the underlying I/O primitive is synchronous.
const readSourceFile = async (...args) => readFileSync(...args);
const currentSourceReader = async (path, maximum) => {
  const value = await readSourceFile(join(root, path));
  assert.ok(value.length <= maximum, 'Current source reader respects exact continuation bound'); return value;
};
const currentSourceLayer = await loadMountedResourceProfile67({ readArtifact: currentSourceReader });
const c82SourceReader = currentSourceLayer.retainedC82SourceReader(currentSourceReader);
const continuation = await loadMountedSourceContinuation67({ readArtifact: c82SourceReader });
const historicalSourceReader = continuation.historicalAuthorityReader(c82SourceReader);
const literalPath = 'contracts/mounted-e2e/v1/interaction-literals.json';
const schemaPath = 'contracts/mounted-e2e/v1/observation.schema.json';
const bytes = await readFile(join(root, literalPath)), schemaBytes = await readFile(join(root, schemaPath));
const contract = JSON.parse(bytes), schema = JSON.parse(schemaBytes);
const hash = value => createHash('sha256').update(value).digest('hex');
const pin = (path, value) => ({ path, bytes: value.length, sha256: hash(value) });
const ids = ['selection-keyboard-replace', 'slash-keyboard-accept', 'drag-pointer-move', 'drag-keyboard-move'];
const engines = ['chromium', 'webkit', 'firefox'];
const binding = () => ({ runId: 'controlled-data-only-run', acceptedSource: contract.acceptedSource,
  scenarioPins: [pin(literalPath, bytes), pin(schemaPath, schemaBytes)] });
const reader = artifacts => continuation.historicalAuthorityReader(async (path, maxBytes) => {
  const value = path.startsWith('interactions/') ? artifacts[path] : await readFile(join(root, path));
  if (value === undefined) throw new Error(`Controlled missing artifact: ${path}`);
  assert.ok(value.length <= maxBytes, 'Reader respects requested byte bound'); return value;
});

test('native trace overflow preserves actual replies, errors and one bounded prefix', () => {
  const request = '{"kind":"state"}', reply = '{"text":"Ё😀"}';
  const cost = Buffer.byteLength(request) + Buffer.byteLength(reply);
  for (const limits of [{ nativeCalls: 1, nativeBytes: cost * 4 }, { nativeCalls: 4, nativeBytes: cost }]) {
    const record = { nativeTrace: [], nativeTraceBytes: 0, nativeTraceOverflow: false }, calls = [];
    const originalError = new Error('Independent native failure');
    const manifest = {}, context = {}, resources = {}, input = new Uint8Array([1]), options = {};
    const observed = observeNativeModule({ manifest, resourceCounts: () => resources, Session: class {
      constructor(actualInput, actualOptions) { assert.equal(actualInput, input); assert.equal(actualOptions, options); }
      context() { return context; }
      call(raw) { calls.push(raw); if (raw === 'throw') throw originalError; return raw === 'short' ? '' : reply; }
      destroy() { calls.push('destroy'); }
      free() { calls.push('free'); }
    } }, record, limits);
    const session = new observed.Session(input, options);
    assert.equal(observed.manifest, manifest); assert.equal(observed.resourceCounts(), resources); assert.equal(session.context(), context);
    assert.equal(session.call(request), reply); assert.equal(record.nativeTraceOverflow, false);
    const prefix = structuredClone(record.nativeTrace);
    assert.equal(record.nativeTraceBytes, cost);
    // A successful actual.call must not turn into an SDK transport exception.
    assert.equal(session.call(request), reply); assert.equal(record.nativeTraceOverflow, true);
    // Even a later small observation cannot fill the gap after overflow.
    assert.equal(session.call('short'), ''); assert.deepEqual(record.nativeTrace, prefix); assert.equal(record.nativeTraceBytes, cost);
    assert.throws(() => session.call('throw'), error => error === originalError);
    session.destroy(); session.free();
    assert.deepEqual(calls, [request, request, 'short', 'throw', 'destroy', 'free']);
    assert.deepEqual(record.nativeTrace, [{ ordinal: 0, method: 'call', requestJson: request, responseJson: reply, error: null }]);
  }
});

test('native initialization overflow returns its original result without an observer exception', () => {
  const reply = '{"native":"initialization"}', record = { nativeTrace: [], nativeTraceBytes: 0, nativeTraceOverflow: false };
  let initializations = 0;
  const observed = observeNativeModule({ Session: class { initialization() { initializations++; return reply; } } }, record, { nativeCalls: 1, nativeBytes: 1 });
  assert.equal(new observed.Session().initialization(), reply); assert.equal(initializations, 1);
  assert.equal(record.nativeTraceOverflow, true); assert.equal(record.nativeTraceBytes, 0); assert.deepEqual(record.nativeTrace, []);
});

test('native trace overflow remains an explicit blocking integrity failure in every engine tier', () => {
  const validators = interactionValidators(schema), route = contract.routes[0], literalPin = pin(literalPath, bytes);
  const toyBinding = { ...binding(), sourceSHA: '0'.repeat(40), build: { buildId: 'controlled-toy-build', wasm: { sha256: '0'.repeat(64) } } };
  for (const engine of engines) {
    // Deliberately claim a complete terminal: the independent overflow check must still fail.
    const observation = { protocol: contract.protocol, runId: toyBinding.runId, engine, routeId: route.routeId,
      binding: { sourceSHA: toyBinding.sourceSHA, buildId: toyBinding.build.buildId, wasmSha256: toyBinding.build.wasm.sha256 },
      literalPin, scope: 'Independent overflow control; no product execution', stop: { status: 'completed', phase: 'complete', reason: null },
      original: null, fresh: null, checkpoints: [], nativeTrace: [], nativeTraceBytes: 0, nativeTraceOverflow: true,
      ordinaryInputs: [], uiReady: null, uiResults: [], commands: [], browserEvents: [], focusSetup: null, errors: [], cspViolations: [] };
    const assessment = assessInteraction({ observation, route, binding: toyBinding, harnessError: null, contract, pin: literalPin, validators });
    assert.deepEqual(assessment.checks.find(value => value.name === 'native trace overflow'),
      { domain: 'integrity', name: 'native trace overflow', status: 'FAIL', actual: true, expected: false });
    assert.equal(assessment.checks.find(value => value.name === 'complete original terminal').status, 'MET');
    assert.equal(assessment.integrity, 'FAIL'); assert.equal(assessment.requirement, 'OBSERVATION'); assert.equal(assessment.blocking, true);
  }
});

test('interaction literals fit the browser plain-data contract and exact finite inventory', () => {
  const owned = ownBoundedData(contract, 65536);
  assert.deepEqual(JSON.parse(owned.json), contract);
  assert.deepEqual(contract.routes.map(value => value.routeId), ids);
  assert.deepEqual(Object.keys(contract.engines), engines);
  assert.deepEqual(contract.engines, { chromium: 'required', webkit: 'required', firefox: 'experimental' });
  assert.equal(contract.budgets.routes, 4); assert.equal(contract.budgets.owners, 2);
  assert.equal(contract.budgets.checkpoints, 6); assert.equal(contract.budgets.forwardTabs, 16);
  assert.equal(contract.budgets.nativeCalls, 4096); assert.equal(contract.budgets.nativeBytes, 2 * 1024 * 1024);
  assert.equal(contract.budgets.artifactBytes, 4 * 1024 * 1024);
  for (const route of contract.routes) {
    for (const name of ['input', 'before', 'after']) {
      const raw = Buffer.from(route[name].utf8);
      assert.equal(route[name].bytes, raw.length); assert.equal(route[name].sha256, hash(raw));
      assert.equal(JSON.parse(raw).schema, 'klenwriter.document');
    }
    assert.deepEqual(Object.keys(route.rolesBefore).sort(), [...route.surviving, ...route.retired].sort());
    assert.deepEqual(Object.keys(route.rolesAfter).sort(), [...route.surviving, ...route.fresh].sort());
    if (route.pointer) {
      assert.equal(route.pointer.targetYFraction, '0.875'); assert.equal(Number(route.pointer.targetYFraction), 7 / 8);
      assert.equal(route.pointer.heldMoveSteps, 8); assert.equal(route.pointer.inset, 2);
    }
  }
});

test('all interaction oracle authority bytes retain their independently frozen source hashes', async () => {
  // Exact old hash assertions remain historical authority checks. The helper
  // separately verifies current source against the closed47 continuation.
  for (const expected of contract.sourcePins) assert.deepEqual(pin(expected.path, await historicalSourceReader(expected.path, expected.bytes)), expected);
  await continuation.verifyAll();
  const lexical = JSON.parse(await readFile(join(root, 'contracts/slash/v1/lexical-key-oracles.json')));
  const mc01 = lexical.mountedCanonicalSeeds.find(value => value.id === 'MC01');
  const slash = contract.routes.find(value => value.kind === 'slash');
  assert.equal(slash.before.utf8, mc01.preAcceptCanonical); assert.equal(slash.after.utf8, mc01.afterCanonical);
  // Actual current source keeps window.caret; this additive intent does not edit the older lexical golden.
  assert.equal(slash.intent.range.focus.affinity, 'after');
  assert.match(await readFile(join(root, 'packages/ui/src/slash-window.ts'), 'utf8'), /focus:window\.caret/);
});

test('derived interaction DTO validators compile and preserve closed native responses', () => {
  const validators = interactionValidators(schema);
  assert.equal(validators.response({ status: 'ok', value: { kind: 'destroyed' } }), true);
  assert.equal(validators.response({ status: 'ok', value: { kind: 'destroyed', invented: 0 } }), false);
  assert.equal(validators.response({ status: 'refused', diagnostic: { code: 'toy' } }), false);
  assert.equal(validators.owner({ ready: { status: 'ready' } }), false);
  const command = { kind: 'command', stamp: { session: 'toy', generation: '1', revision: '0', selection_epoch: '0', history_epoch: '0' },
    command: { id: 'org.klenwriter.kwdj/command/move', payload_json: '{}' }, history_hint: { kind: 'isolated' } };
  assert.equal(validators.request(command), true);
  assert.equal(validators.request({ ...command, command: { ...command.command, id: 'org.example/command/unbound' } }), false);
  assert.equal(validators.request({ ...command, history_hint: { kind: 'unbound' } }), false);
});

test('missing genuine observations fail every engine and never turn pending evidence into MET', async () => {
  const report = await collectInteractions({ runBinding: binding(), readArtifact: reader({}) });
  assert.equal(report.rows.length, 12); assert.equal(report.counts.integrityFailures, 12);
  assert.equal(report.counts.met, 0); assert.equal(report.blocking, true); assert.deepEqual(report.pins, []);
  assert.deepEqual(report.rows.map(value => `${value.engine}/${value.routeId}`), engines.flatMap(engine => ids.map(id => `${engine}/${id}`)));
  assert.ok(report.rows.every(value => value.integrity === 'FAIL' && value.requirement === 'OBSERVATION' && value.cleanup === 'UNKNOWN' && value.blocking));
});

test('corrupt and stale experimental artifacts remain blocking integrity failures', async () => {
  const path = `interactions/firefox/${ids[0]}.json`;
  for (const raw of [Buffer.from('{'), Buffer.from('{"format":"duplicate","format":"duplicate"}')]) {
    const report = await collectInteractions({ runBinding: binding(), readArtifact: reader({ [path]: raw }) });
    const row = report.rows.find(value => value.engine === 'firefox' && value.routeId === ids[0]);
    assert.equal(row.integrity, 'FAIL'); assert.equal(row.blocking, true); assert.equal(row.requirement, 'OBSERVATION');
    assert.equal(row.artifact.sha256, hash(raw));
  }
  const stale = Buffer.from(JSON.stringify({ format: 'mounted-corpus-interaction-receipt/1', runId: 'different-run', engine: 'firefox', routeId: ids[0],
    observation: null, assessment: null, harnessError: null, pageErrors: [], externalRequests: [] }));
  const report = await collectInteractions({ runBinding: binding(), readArtifact: reader({ [path]: stale }) });
  assert.match(report.rows.find(value => value.engine === 'firefox' && value.routeId === ids[0]).checks[0].actual.message, /inventory binding/);
});

test('changed oracle source pin stops collection before any measurement can qualify', async () => {
  const invalid = binding(); invalid.scenarioPins[0].sha256 = '0'.repeat(64);
  await assert.rejects(collectInteractions({ runBinding: invalid, readArtifact: reader({}) }), /frozen source pin mismatch/);
});

test('partial owner cleanup remains UNKNOWN despite a genuinely zero original map', () => {
  const native = { sessions: 0, snapshot_handles: 0, snapshot_bytes: '0', protected_cursors: 0 };
  const mounted = Object.fromEntries(Object.entries(RESOURCE_KEYS).filter(([key]) => !['native', 'ui'].includes(key))
    .map(([group, keys]) => [group, Object.fromEntries(keys.map(key => [key, group === 'sdk' && key === 'lifecycle' ? 'destroyed' : 0]))]));
  const toyBinding = { ...binding(), sourceSHA: '0'.repeat(40), build: { buildId: 'controlled-toy-build', wasm: { sha256: '0'.repeat(64) } },
    nativeBaselines: [{ engine: 'chromium', sample: { value: native } }] };
  const observation = { protocol: contract.protocol, runId: toyBinding.runId, engine: 'chromium', routeId: ids[0],
    binding: { sourceSHA: toyBinding.sourceSHA, buildId: toyBinding.build.buildId, wasmSha256: toyBinding.build.wasm.sha256 },
    literalPin: pin(literalPath, bytes), scope: 'Independent synthetic partial-owner control; no product execution',
    stop: { status: 'failed', phase: 'open', reason: 'Controlled missing later owner' },
    original: { elementToken: 'controlled-original', ready: { status: 'ready' }, calls: [], snapshots: [],
      destroy: { sdk: { status: 'completed', response: { status: 'ok', value: { kind: 'destroyed' } } } },
      resourcesAfter: { mounted, ui: null }, nativeAfter: { validation: 'valid', value: native }, originalInputAfterDestroy: null },
    fresh: null, checkpoints: [], nativeTrace: [], nativeTraceBytes: 0, nativeTraceOverflow: false,
    ordinaryInputs: [], uiReady: null, uiResults: [], commands: [], browserEvents: [], focusSetup: null, errors: [], cspViolations: [] };
  const assessment = assessInteraction({ observation, route: contract.routes[0], binding: toyBinding,
    harnessError: null, contract, pin: pin(literalPath, bytes), validators: interactionValidators(schema) });
  assert.equal(assessment.integrity, 'FAIL'); assert.equal(assessment.requirement, 'OBSERVATION');
  assert.equal(assessment.cleanup, 'UNKNOWN'); assert.equal(assessment.blocking, true);
  assert.ok(assessment.checks.some(value => value.name === 'controlled-original: native baseline restored' && value.status === 'MET'));
  assert.ok(assessment.checks.some(value => value.name === 'complete actual resource maps, typed destroy and module baseline' && value.domain === 'integrity' && value.status === 'FAIL'));
  observation.original.nativeAfter = { validation: 'valid', value: null };
  const unknownMap = assessInteraction({ observation, route: contract.routes[0], binding: toyBinding,
    harnessError: null, contract, pin: pin(literalPath, bytes), validators: interactionValidators(schema) });
  assert.equal(unknownMap.integrity, 'FAIL'); assert.equal(unknownMap.cleanup, 'UNKNOWN');
  assert.ok(unknownMap.checks.some(value => value.name === 'controlled-original: full native count map' && value.domain === 'integrity' && value.status === 'FAIL'));
});
