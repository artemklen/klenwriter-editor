// SPDX-License-Identifier: MIT OR Apache-2.0
// CONTROLLED SYNTHETIC DATA ONLY. These receipts never came from a product,
// browser, native module or human. Passing controls are not execution evidence.
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadContract, collect } from '../scripts/mounted-corpus/collect.mjs';
import { loadMountedSourceContinuation67 } from '../scripts/mounted-corpus/source-continuation67.mjs';
import { loadMountedResourceProfile67 } from '../scripts/mounted-corpus/resource-profile67.mjs';
import { ENGINES, RESOURCE_KEYS, REQUIRED_SCENARIO_PATHS, PROTOCOL_VERSION, ACCEPTED_SOURCE, BUDGETS } from '../scripts/mounted-corpus/protocol.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
const pin = (path, bytes) => ({ path, bytes: bytes.length, sha256: hash(bytes) });
const clone = value => structuredClone(value);
const root = new URL('../', import.meta.url);
// Actual filesystem reads remain fresh; only the underlying I/O primitive is synchronous.
const readSourceFile = async (...args) => readFileSync(...args);
const currentSourceReader = async (path, limit) => {
  const value = await readSourceFile(new URL(path, root)); assert(value.length <= limit); return value;
};
// Controlled oracle fixtures retain original45 authority bytes. The explicit
// continuation independently verifies all current67 bytes and retained48/47 authority before every alias.
const currentSourceLayer = await loadMountedResourceProfile67({ readArtifact: currentSourceReader });
const c82SourceReader = currentSourceLayer.retainedC82SourceReader(currentSourceReader);
const continuation = await loadMountedSourceContinuation67({ readArtifact: c82SourceReader });
const sourceReader = continuation.historicalAuthorityReader(c82SourceReader);
const contract = await loadContract({ readArtifact: sourceReader });
const fixtures = new Map();
for (const p of [...contract.sourcePins.files, ...contract.sourcePins.acceptedSourceFiles]) fixtures.set(p.path, await sourceReader(p.path, 4 * 1024 * 1024));
fixtures.set('contracts/mounted-e2e/v1/source-pins.json', await sourceReader('contracts/mounted-e2e/v1/source-pins.json', 256 * 1024));
const profile = { profile_id: 'org.klenwriter.kwdj', profile_version: '1.0.0', codec_id: 'org.klenwriter.kwdj/json', wire_version: 1,
  extensions: [{ id: 'org.klenwriter.kwdj/base', version: '1.0.0' }] };
fixtures.set('artifacts/extensions/packet.json', encode({ format: 'editor-extensions-public-consumer/1', kwdjProfile: profile,
  kwdjRegistryJson: JSON.stringify({ profile: { id: profile.profile_id, version: profile.profile_version, codec_id: profile.codec_id,
    wire_version: 1 }, selected_extensions: profile.extensions }) }));
// Noncontract implementation bytes are deliberately synthetic, so these controls
// remain independent of root's build/runner availability and cannot attest to it.
for (const path of REQUIRED_SCENARIO_PATHS) if (!fixtures.has(path)) fixtures.set(path, encode(`synthetic implementation ${path}`));
for (const path of ['synthetic/wasm', 'synthetic/seal', 'synthetic/dependencies']) fixtures.set(path, encode(`synthetic bytes ${path}`));
const zeroNative = { sessions: 0, snapshot_handles: 0, snapshot_bytes: '0', protected_cursors: 0 };
const native = (source, timing) => ({ source, timing, rawJson: JSON.stringify(zeroNative), value: clone(zeroNative), validation: 'valid' });
const resourceMap = () => ({ mounted: Object.fromEntries(['sdk', 'dom', 'selection', 'clipboard', 'hostRequests', 'inputObservations', 'popupPresentation']
  .map(key => [key, Object.fromEntries(RESOURCE_KEYS[key].map(k => [k, k === 'lifecycle' ? 'destroyed' : 0]))])), ui: null });
const record = literal => ({ utf8: literal.utf8, bytes: literal.bytes, sha256: literal.sha256 });
const context = () => ({ build_id: 'synthetic-controlled-build', profile: clone(profile), registry_digest: 'a'.repeat(64), capability_digest: 'b'.repeat(64) });
const attr = value => ({ kind: typeof value === 'number' ? 'number' : typeof value, value: typeof value === 'number' ? String(value) : value });
const attrs = value => Object.fromEntries(Object.entries(value ?? {}).map(([k, v]) => [k, attr(v)]));
function roleIds(document, replacementPointer = null) {
  const ids = new Map([['', 'synthetic-root']]);
  const walk = (node, pointer) => { ids.set(pointer, pointer === replacementPointer ? 'synthetic-replacement' : `synthetic:${pointer}`);
    for (let i = 0; i < (node.content ?? []).length; i++) walk(node.content[i], `${pointer}/content/${i}`); };
  for (let i = 0; i < document.content.length; i++) walk(document.content[i], `/content/${i}`);
  return ids;
}
function selection(template, roles) {
  if (typeof template === 'string' && template.startsWith('$role.')) return roles[template.slice(6, -3)];
  if (Array.isArray(template)) return template.map(v => selection(v, roles));
  if (template && typeof template === 'object') return Object.fromEntries(Object.entries(template).map(([k, v]) => [k, selection(v, roles)]));
  return template;
}
function positiveOwner(literal, editStage, fresh, ordinal, key) {
  const input = fresh && editStage ? literal.edit.expected : literal.input;
  const originalIds = roleIds(input.value), ctx = context();
  const owner = { elementToken: `synthetic-element-${key}`, mountOrdinal: ordinal, destroyOrdinal: ordinal + 1,
    input: record(input), originalInputBeforeDestroy: null, originalInputAfterDestroy: null,
    ready: null, context: ctx, calls: [], events: [], snapshots: [],
    destroy: { status: 'destroy_requested', sdk: { status: 'completed', response: { status: 'ok', value: { kind: 'destroyed' } } }, recovery: null, callbackFailure: null },
    resourcesBefore: resourceMap(), resourcesAfter: resourceMap(), nativeBefore: native('module.resourceCounts', 'before_owner_construction'),
    nativeAfter: native('mounted.nativeResources', 'after_destroy_settlement') };
  let state = { stamp: { session: `synthetic-session-${key}`, generation: '0', revision: '0', selection_epoch: '0', history_epoch: '0' },
    root: originalIds.get(''), selection: null, stored_marks: null, dirty: false, saved_revision: '0',
    history: { undo_entries: '0', redo_entries: '0', retained_bytes: '0' } };
  owner.ready = { status: 'ready', response: { status: 'ok', value: { kind: 'state', state: clone(state) } } };
  const add = (label, method, request, value, submission = method === 'submit') => {
    const response = { status: 'ok', value };
    owner.calls.push({ label, method, capture: clone(state.stamp), context: clone(ctx), request,
      result: submission ? { status: 'completed', response } : response });
  };
  const readPhase = (phase, document, ids) => {
    add(`${phase}-state`, 'read', { kind: 'state' }, { kind: 'state', state: clone(state) });
    const walk = (n, path, parent) => {
      const synthetic = path === '', id = ids.get(path), children = (n.content ?? []).map((_, i) => ids.get(`${path}/content/${i}`));
      const node = { stamp: clone(state.stamp), id, parent, type_id: synthetic ? '' : `org.klenwriter.kwdj/${n.type}`,
        primitive: synthetic ? 'root' : n.type === 'text' ? 'text' : n.type === 'hard_break' ? 'hard_break'
          : ['paragraph', 'heading', 'code_block'].includes(n.type) ? 'text_block' : 'container',
        attributes: synthetic ? {} : attrs(n.attrs), marks: (n.marks ?? []).map(m => ({ type_id: `org.klenwriter.kwdj/${m.type}`, attributes: attrs(m.attrs) })),
        text: n.text ?? null, children, changed_revision: '0', stats: { authored_nodes: '0', text_utf8: '0', text_utf16: '0', height: '0' } };
      add(`${phase}-node`, 'read', { kind: 'node', stamp: clone(state.stamp), node: id }, { kind: 'node', node });
      for (let i = 0; i < (n.content ?? []).length; i++) walk(n.content[i], `${path}/content/${i}`, id);
    };
    walk(document, '', null);
  };
  const mutation = (label, request, next, effect) => {
    const before = state;
    add(label, 'submit', { ...request, stamp: clone(state.stamp) }, { kind: 'mutation', effect, state: clone(next), presentation: null });
    state = next;
    if (effect === 'changed') owner.events.push({ sequence: String(owner.events.length + 1), before: clone(before.stamp), after: clone(next.stamp),
      selection_before: clone(before.selection), selection_after: clone(next.selection), stored_marks_before: null, stored_marks_after: null,
      dirty_before: before.dirty, dirty_after: next.dirty, history: clone(next.history),
      change: before.stamp.revision === next.stamp.revision
        ? { kind: 'state', selection_changed: true, stored_marks_changed: false, history_changed: false, baseline_changed: false }
        : { kind: 'document', impact: { upserted: [], removed: [], ancestors_before: [], ancestors_after: [], root_order_changed: false },
          from_revision: before.stamp.revision, to_revision: next.stamp.revision } });
  };
  const snapshot = (suffix, expected) => {
    const call = owner.calls.length, handle = `synthetic-handle-${call}`;
    add(`snapshot-${suffix}`, 'submit', { kind: 'snapshot', stamp: clone(state.stamp), max_bytes: 65536 },
      { kind: 'snapshot', handle, canonical_json: expected.utf8, stamp: clone(state.stamp), profile: clone(profile), event_sequence: String(owner.events.length) });
    add(`release-${suffix}`, 'submit', { kind: 'release_snapshot', handle }, { kind: 'released' });
    owner.snapshots.push({ call, ...record(expected), releaseCall: call + 1 });
  };
  readPhase('initial', input.value, originalIds);
  if (!fresh && editStage) {
    const e = literal.edit, replacement = e.identity.liveCreatedRoles.length ? e.target.kwdjPointer : null;
    const afterIds = roleIds(e.expected.value, replacement), roles = { targetText: originalIds.get(e.target.kwdjPointer), replacementText: afterIds.get(e.target.kwdjPointer) };
    const setup = clone(state); setup.stamp.selection_epoch = '1'; setup.selection = selection(e.selection.setup.selection, roles);
    mutation('setup-selection', { kind: 'set_selection', selection: clone(setup.selection) }, setup, 'changed');
    mutation('setup-marks', { kind: 'set_stored_marks', marks: null }, clone(state), 'unchanged');
    readPhase('prepared', input.value, originalIds);
    add('query-edit', 'query', { kind: 'query_command', stamp: clone(state.stamp), command: { id: e.commandId, payload_json: JSON.stringify(e.intent) } },
      { kind: 'availability', available: true, effect: 'changed', presentation: null, diagnostic: null });
    const after = clone(state); Object.assign(after.stamp, { revision: '1', selection_epoch: '2', history_epoch: '1' });
    after.selection = selection(e.selection.afterEdit.selection, roles); after.history = { ...e.history.afterEdit, retained_bytes: '0' }; after.dirty = true;
    mutation('edit', { kind: 'command', command: { id: e.commandId, payload_json: JSON.stringify(e.intent) }, history_hint: { kind: 'isolated' } }, after, 'changed');
    readPhase('after-edit', e.expected.value, afterIds); snapshot('edit', e.expected);
    for (const direction of ['undo', 'redo']) {
      add(`query-${direction}`, 'query', { kind: 'query_history', stamp: clone(state.stamp), direction },
        { kind: 'availability', available: true, effect: 'changed', presentation: null, diagnostic: null });
      const next = clone(state), isUndo = direction === 'undo';
      Object.assign(next.stamp, { revision: isUndo ? '2' : '3', selection_epoch: isUndo ? '3' : '4', history_epoch: isUndo ? '2' : '3' });
      next.selection = selection((isUndo ? e.selection.afterUndo : e.selection.afterRedo).selection, roles);
      next.history = { ...(isUndo ? e.history.afterUndo : e.history.afterRedo), retained_bytes: '0' };
      mutation(direction, { kind: 'history', direction }, next, 'changed');
      readPhase(`after-${direction}`, isUndo ? input.value : e.expected.value, isUndo ? originalIds : afterIds);
      snapshot(isUndo ? 'undo' : 'save', isUndo ? literal.roundTrip : e.expected);
    }
  } else snapshot(fresh ? 'reopen' : 'save', input);
  return owner;
}
function negativeOwner(literal, ordinal, key) {
  const diagnostic = { ...literal.diagnostic, path: literal.diagnostic.path.exact ?? '/synthetic-observed-unknown-attribute-path' };
  const response = { status: 'refused', diagnostic };
  const recovery = { originalInput: record(literal.input), region: null };
  return { elementToken: `synthetic-element-${key}`, mountOrdinal: ordinal, destroyOrdinal: ordinal + 1,
    input: record(literal.input), originalInputBeforeDestroy: record(literal.input), originalInputAfterDestroy: null,
    ready: { status: 'sdk_failure', response, recovery }, context: null, calls: [], events: [], snapshots: [],
    destroy: { status: 'destroy_requested', sdk: { status: 'completed', response: { status: 'ok', value: { kind: 'destroyed' } } }, recovery, callbackFailure: null },
    resourcesBefore: resourceMap(), resourcesAfter: resourceMap(), nativeBefore: native('module.resourceCounts', 'before_owner_construction'),
    nativeAfter: native('mounted.nativeResources', 'after_destroy_settlement') };
}
function syntheticRun() {
  const files = new Map(fixtures), rows = contract.manifest.rows.filter(r => r.initial);
  const positives = new Map(contract.literals.positiveCases.map(c => [c.caseId, c])), negatives = new Map(contract.literals.negativeCases.map(c => [c.caseId, c]));
  const binding = { protocol: PROTOCOL_VERSION, runId: 'CONTROLLED-SYNTHETIC-NOT-PRODUCT-EVIDENCE', sourceSHA: 'f'.repeat(40), acceptedSource: ACCEPTED_SOURCE,
    corpusIndex: pin(contract.manifest.corpus.indexFile, files.get(contract.manifest.corpus.indexFile)), corpusPackageSha256: contract.manifest.corpus.declaredContentSha256,
    scenarioPins: [...new Set([...contract.sourcePins.files.map(p => p.path), ...REQUIRED_SCENARIO_PATHS])].map(path => pin(path, files.get(path))),
    build: { buildId: 'synthetic-controlled-build', wasm: pin('synthetic/wasm', files.get('synthetic/wasm')), seal: pin('synthetic/seal', files.get('synthetic/seal')),
      dependencies: pin('synthetic/dependencies', files.get('synthetic/dependencies')) },
    environment: { nodeVersion: 'synthetic', playwrightVersion: 'synthetic', os: { platform: 'synthetic', release: 'synthetic', arch: 'synthetic' },
      engines: ENGINES.map(engine => ({ engine, browserVersion: 'synthetic', executablePath: '/synthetic/not-executed', executableSha256: '0'.repeat(64) })) },
    nativeBaselines: ENGINES.map(engine => ({ engine, buildId: 'synthetic-controlled-build', wasmSha256: hash(files.get('synthetic/wasm')),
      sample: native('module.resourceCounts', 'before_owner_construction') })) };
  const data = [];
  for (const engine of ENGINES) for (let i = 0; i < rows.length; i++) {
    const row = rows[i], key = `${engine}-${i}`, ordinal = i * 4;
    const negative = row.branch === 'expected_admission_refusal', literal = positives.get(row.caseId) ?? negatives.get(row.caseId);
    const editStage = row.stage === 'editor_edit_save_reopen';
    data.push({ protocol: PROTOCOL_VERSION, runId: binding.runId, engine, rowId: row.rowId, caseId: row.caseId, stage: row.stage, branch: row.branch,
      route: negative ? 'native-admission-refusal' : editStage ? 'public-command-edit-history' : 'corpus-unchanged',
      stop: { phase: 'complete', status: 'completed', reason: null }, original: negative ? negativeOwner(literal, ordinal, key)
        : positiveOwner(literal, editStage, false, ordinal, key), fresh: negative ? null : positiveOwner(literal, editStage, true, ordinal + 2, `${key}-fresh`), errors: [], cspViolations: [] });
  }
  const publish = () => data.map((value, i) => { const path = `synthetic-observations/${i}.json`, bytes = encode(value); files.set(path, bytes); return pin(path, bytes); });
  const reader = async (path, limit) => { const bytes = files.get(path); assert(bytes, `Synthetic artifact missing: ${path}`); assert(bytes.length <= limit); return bytes; };
  const run = (observations = publish()) => collect({ contract, runBinding: binding, observations, readArtifact: reader, sourceSHA: 'f'.repeat(40) });
  return { data, binding, files, publish, run };
}
const rowFor = (report, observation) => report.rows.find(r => r.engine === observation.engine && r.rowId === observation.rowId);
const editCase = (run, engine = 'chromium', caseId = 'DOC-003/headings_and_layout') => run.data.find(r => r.engine === engine && r.caseId === caseId && r.stage === 'editor_edit_save_reopen');
const assertIntegrityFailure = report => { assert.equal(report.integrity.status, 'FAIL'); assert(report.blockingReasons.some(r => r.class === 'integrity')); };

test('controlled baseline checks all 75 observations and retains 831 distinct full-ledger cells', async () => {
  const r = await syntheticRun().run(); assert.equal(r.integrity.status, 'PASS'); assert.equal(r.blockingReasons.length, 0);
  assert.equal(r.rows.length, 831); assert.equal(r.rows.filter(row => row.requirement === 'MET').length, 75);
  for (const e of r.engineSummaries) assert.deepEqual([e.executed, e.pending, e.deferred, e.notOwned, e.met], [25, 33, 7, 212, 25]);
  assert(r.rows.filter(row => row.measurementStatus === 'NOT_EXECUTED').every(row => row.requirement === null));
  assert.equal(r.separateLanes.humanManual, 'NOT_EXECUTED'); assert(r.crossCuttingRoutes.every(r => r.requirement === null));
});
test('missing and duplicate memberships cannot compensate for one another', async () => {
  const s = syntheticRun(); s.data[1] = clone(s.data[0]); const r = await s.run(); assertIntegrityFailure(r);
  assert(r.integrity.failures.some(f => f.code.endsWith('missing_observation'))); assert(r.integrity.failures.some(f => f.code.endsWith('duplicate_observation')));
});
test('a missing Firefox measurement fails integrity despite experimental behavior tier', async () => {
  const s = syntheticRun(), pins = s.publish(); pins.pop(); assertIntegrityFailure(await s.run(pins));
});
test('stale run, source, scenario, engine and fixture identity joins fail closed', async t => {
  for (const [name, change] of [
    ['run', s => { s.data[0].runId = 'stale'; }], ['source', s => { s.binding.sourceSHA = 'e'.repeat(40); }],
    ['scenario', s => { s.binding.scenarioPins[0].sha256 = '0'.repeat(64); }],
    ['required implementation', s => { s.binding.scenarioPins = s.binding.scenarioPins.filter(p => p.path !== 'scripts/mounted-corpus/collect.mjs'); }],
    ['duplicate engine', s => { s.binding.environment.engines[2].engine = 'chromium'; }],
    ['wrong case', s => { s.data[0].caseId = 'DOC-002/unicode_whitespace_hard_break'; }],
    ['wrong stage', s => { s.data[0].stage = 'editor_edit_save_reopen'; }],
  ]) await t.test(name, async () => { const s = syntheticRun(); change(s); assertIntegrityFailure(await s.run()); });
});
test('bad raw pin, invalid UTF-8, duplicate JSON keys and oversized artifacts are not measurements', async t => {
  for (const mode of ['hash', 'utf8', 'duplicate-key', 'oversized']) await t.test(mode, async () => {
    const s = syntheticRun(), pins = s.publish(), p = pins[0];
    if (mode === 'hash') s.files.set(p.path, encode('{}'));
    else {
      const bytes = mode === 'utf8' ? Buffer.from([0xff]) : mode === 'oversized' ? Buffer.alloc(4 * 1024 * 1024 + 1, 32)
        : encode('{"engine":"chromium","engine":"firefox"}');
      s.files.set(p.path, bytes); pins[0] = pin(p.path, bytes);
    }
    assertIntegrityFailure(await s.run(pins));
  });
});
test('unknown raw fields, out-of-range U64 and truncated queued terminals fail integrity', async t => {
  for (const [name, change] of [
    ['unknown field', o => { o.original.unowned = true; }],
    ['u64 overflow', o => { o.original.ready.response.value.state.stamp.revision = '18446744073709551616'; }],
    ['queued without completion', o => { o.original.calls.find(c => c.label === 'snapshot-save').result = { status: 'queued' }; }],
  ]) await t.test(name, async () => { const s = syntheticRun(); change(s.data[0]); assertIntegrityFailure(await s.run()); });
});
test('actual queued completion retains valid original scheduling', async () => {
  const s = syntheticRun(), call = s.data[0].original.calls.find(c => c.method === 'submit');
  call.result = { status: 'queued', completion: call.result.response }; assert.equal((await s.run()).integrity.status, 'PASS');
});
test('expected native refusal is separate from positive save/reopen and unknown attribute path is observed', async () => {
  const s = syntheticRun(), o = s.data.find(r => r.caseId === 'DOC-018/unknown_attribute');
  o.original.ready.response.diagnostic.path = '/a-different-actual-source-valid-path';
  const r = await s.run(); assert.equal(rowFor(r, o).requirement, 'MET'); assert.equal(r.integrity.status, 'PASS');
});
test('wrong authentic negative diagnostic is a behavior GAP rather than a forged positive result', async () => {
  const s = syntheticRun(), o = s.data.find(r => r.branch === 'expected_admission_refusal');
  o.original.ready.response.diagnostic.code = 'kwdj.some_other_native_refusal';
  const r = await s.run(), row = rowFor(r, o); assert.equal(row.integrity, 'PASS'); assert.equal(row.requirement, 'GAP');
  assert(row.blockingReasons.some(r => r.class === 'required_behavior'));
});
test('genuine clean positive refusal is GAP with its exact reached phase, never fabricated fresh owner', async () => {
  const s = syntheticRun(), o = s.data[0], owner = o.original;
  owner.ready = { status: 'sdk_failure', response: { status: 'refused', diagnostic: { code: 'kwdj.native_refusal', path: '', category: 'profile', details: {}, stamp: null, may_have_committed: false } }, recovery: null };
  owner.context = null; owner.calls = []; owner.events = []; owner.snapshots = []; o.fresh = null;
  o.stop = { phase: 'ready', status: 'native_refused', reason: 'actual controlled refusal' };
  const row = rowFor(await s.run(), o); assert.equal(row.integrity, 'PASS'); assert.equal(row.requirement, 'GAP'); assert.equal(row.cleanup, 'PASS');
});
test('an actual Fatal is not promoted to the native Refused oracle', async () => {
  const s = syntheticRun(), o = s.data.find(r => r.branch === 'expected_admission_refusal');
  // Use a complete native Fatal instead of guessing a DOM diagnostic shape.
  o.original.ready.response.status = 'fatal';
  const row = rowFor(await s.run(), o); assert.equal(row.integrity, 'PASS'); assert.equal(row.requirement, 'GAP');
});
test('a complete DOM refusal is separate from the native negative terminal', async () => {
  const s = syntheticRun(), o = s.data.find(r => r.branch === 'expected_admission_refusal');
  o.original.ready = { status: 'dom_refused', response: null, recovery: null,
    diagnostic: { code: 'dom.renderer_missing', phase: 'render', stamp: null, node: null, typeId: null, publication: 'none' } };
  const row = rowFor(await s.run(), o); assert.equal(row.integrity, 'PASS'); assert.equal(row.requirement, 'GAP');
});
test('a complete native availability refusal retains the reached prefix as behavior GAP', async () => {
  const s = syntheticRun(), o = editCase(s), query = o.original.calls.findIndex(c => c.label === 'query-edit');
  o.original.calls = o.original.calls.slice(0, query + 1);
  o.original.calls.at(-1).result.value.available = false;
  o.original.events = o.original.events.filter(e => e.after.revision === '0'); o.original.snapshots = []; o.fresh = null;
  o.stop = { phase: 'query-edit', status: 'native_refused', reason: 'actual availability false' };
  let r = await s.run(), row = rowFor(r, o); assert.equal(row.integrity, 'PASS'); assert.equal(row.requirement, 'GAP');
  o.stop.phase = 'ready'; r = await s.run(); assertIntegrityFailure(r);
});
test('typed explicit release failure retains actual snapshot bytes and original response', async () => {
  const s = syntheticRun(), o = s.data[0], call = o.original.calls.at(-1);
  call.result = { status: 'completed', response: { status: 'refused', diagnostic: { code: 'sdk.release_failure', path: '', category: 'sdk',
    details: { sequence: 'arbitrary public detail, not a StampDto field' }, stamp: clone(call.capture), may_have_committed: false } } };
  o.fresh = null; o.stop = { phase: 'release', status: 'native_refused', reason: 'actual release refused' };
  const row = rowFor(await s.run(), o); assert.equal(row.integrity, 'PASS'); assert.equal(row.requirement, 'GAP');
});
test('typed settled original destruction failure does not fabricate a fresh phase', async () => {
  const s = syntheticRun(), o = s.data[0];
  o.original.destroy.sdk = { status: 'completed', response: { status: 'fatal', diagnostic: { code: 'sdk.destroy_failure', path: '', category: 'sdk', details: {}, stamp: null, may_have_committed: true } } };
  o.fresh = null; o.stop = { phase: 'destroy', status: 'native_fatal', reason: 'actual settled destroy failure' };
  const row = rowFor(await s.run(), o); assert.equal(row.integrity, 'PASS'); assert.equal(row.requirement, 'GAP'); assert.equal(row.cleanup, 'GAP');
  assert(row.blockingReasons.some(r => r.class === 'cleanup_isolation'));
});
test('snapshots must join exact original calls/handles and explicit releases', async t => {
  for (const [name, change] of [
    ['wrong call index', o => { o.original.snapshots[0].call = 0; }],
    ['wrong handle', o => { o.original.calls.find(c => c.label === 'release-save').request.handle = 'forged'; }],
    ['missing retained snapshot', o => { o.original.snapshots = []; }],
    ['duplicate retained snapshot', o => { o.original.snapshots.push(clone(o.original.snapshots[0])); }],
  ]) await t.test(name, async () => { const s = syntheticRun(); change(s.data[0]); assertIntegrityFailure(await s.run()); });
});
test('canonical byte/value differences remain genuine behavior while lossy/rehashed inputs fail integrity', async () => {
  const s = syntheticRun(), o = s.data[0], original = o.original, snap = original.snapshots[0];
  const changed = `${snap.utf8}\n`; Object.assign(snap, { utf8: changed, bytes: Buffer.byteLength(changed), sha256: hash(encode(changed)) });
  original.calls[snap.call].result.response.value.canonical_json = changed;
  o.fresh.input = record(snap);
  const row = rowFor(await s.run(), o); assert.equal(row.integrity, 'PASS'); assert.equal(row.requirement, 'GAP');
  const bad = syntheticRun(); bad.data[0].original.input.bytes++; assertIntegrityFailure(await bad.run());
});
test('fresh reopening requires distinct host identity and settled original destruction', async t => {
  for (const [name, change] of [
    ['same host', o => { o.fresh.elementToken = o.original.elementToken; }],
    ['early fresh mount', o => { o.fresh.mountOrdinal = o.original.mountOrdinal; }],
    ['missing fresh owner', o => { o.fresh = null; }],
  ]) await t.test(name, async () => { const s = syntheticRun(); change(s.data[0]); assertIntegrityFailure(await s.run()); });
});
test('mandatory full resource maps include accepted drag fields; null/invalid native maps fail integrity', async t => {
  for (const [name, change] of [
    ['missing native key', o => { delete o.original.nativeAfter.value.protected_cursors; }],
    ['null native', o => { o.original.nativeAfter.value = null; o.original.nativeAfter.rawJson = null; o.original.nativeAfter.validation = 'null'; }],
    ['wrong wire value', o => { o.original.nativeAfter.rawJson = '{}'; }],
    ['wrong native timing', o => { o.original.nativeBefore.timing = 'after_destroy_settlement'; }],
    ['truncated created UI', o => { o.original.resourcesBefore.ui = { ...Object.fromEntries(RESOURCE_KEYS.ui.map(k => [k, 0])) }; delete o.original.resourcesBefore.ui.dragGestures; }],
  ]) await t.test(name, async () => { const s = syntheticRun(); change(s.data[0]); assertIntegrityFailure(await s.run()); });
});
test('authentic complete cleanup failure blocks required and experimental engines without corrupting integrity', async t => {
  for (const engine of ['chromium', 'firefox']) await t.test(engine, async () => {
    const s = syntheticRun(), o = s.data.find(r => r.engine === engine);
    o.original.resourcesAfter.mounted.dom.listeners = 1;
    const r = await s.run(), row = rowFor(r, o); assert.equal(row.integrity, 'PASS'); assert.equal(row.requirement, 'GAP'); assert.equal(row.cleanup, 'GAP');
    assert(row.blockingReasons.some(r => r.class === 'cleanup_isolation')); assert.equal(r.integrity.status, 'PASS');
  });
});
test('authentic typed destruction failure is a lifecycle GAP across all engines', async () => {
  const s = syntheticRun(), o = s.data.find(r => r.engine === 'firefox');
  o.original.destroy.sdk = { status: 'completed', response: { status: 'fatal', diagnostic: { code: 'sdk.native_failure', path: '', category: 'sdk', details: {}, stamp: null, may_have_committed: true } } };
  const row = rowFor(await s.run(), o); assert.equal(row.integrity, 'PASS'); assert.equal(row.cleanup, 'GAP'); assert(row.blockingReasons.some(r => r.class === 'cleanup_isolation'));
});
test('a complete native map with a live session is lifecycle GAP, never corruption or an acceptable live baseline', async () => {
  const s = syntheticRun(), o = s.data.find(r => r.engine === 'firefox');
  o.original.nativeAfter.value.sessions = 1; o.original.nativeAfter.rawJson = JSON.stringify(o.original.nativeAfter.value);
  const row = rowFor(await s.run(), o); assert.equal(row.integrity, 'PASS'); assert.equal(row.requirement, 'GAP'); assert.equal(row.cleanup, 'GAP');
  assert(row.blockingReasons.some(r => r.class === 'cleanup_isolation'));
});
test('directed selection, independent history and opaque identity mismatches are behavioral', async t => {
  for (const [name, change] of [
    ['selection direction', o => {
      const c = o.original.calls.find(c => c.label === 'after-undo-state');
      const x = c.result.value.state.selection; [x.anchor, x.focus] = [x.focus, x.anchor];
    }],
    ['history counts', o => { o.original.calls.find(c => c.label === 'after-undo-state').result.value.state.history.undo_entries = '1'; }],
    ['replacement reused original target', o => {
      const target = o.original.calls.filter(c => c.label === 'initial-node').at(-1).result.value.node.id;
      for (const c of o.original.calls.filter(c => ['after-edit-node', 'after-redo-node'].includes(c.label))) {
        const n = c.result.value.node;
        if (n.id === 'synthetic-replacement') { n.id = target; c.request.node = target; }
        n.children = n.children.map(id => id === 'synthetic-replacement' ? target : id);
      }
    }],
  ]) await t.test(name, async () => { const s = syntheticRun(), o = editCase(s); change(o);
    const row = rowFor(await s.run(), o); assert.equal(row.integrity, 'PASS'); assert.equal(row.requirement, 'GAP'); });
});
test('wrong submitted command/setup is measurement error, not evidence for the prescribed operation', async t => {
  for (const kind of ['command', 'selection']) await t.test(kind, async () => {
    const s = syntheticRun(), o = editCase(s);
    if (kind === 'command') o.original.calls.find(c => c.label === 'edit').request.command.payload_json = '{"kind":"insert_text","text":"wrong"}';
    else o.original.calls.find(c => c.label === 'setup-selection').request.selection = null;
    assertIntegrityFailure(await s.run());
  });
});
test('broken phase order, node stamp, notification or request capture joins fail integrity', async t => {
  for (const [name, change] of [
    ['phase order', o => { const a = o.original.calls; [a[0], a[1]] = [a[1], a[0]]; }],
    ['missing traversal node', o => { const a = o.original.calls; a.splice(a.findIndex(c => c.label === 'initial-node'), 1); }],
    ['node request stamp', o => { o.original.calls.find(c => c.label === 'initial-node').request.stamp.revision = '99'; }],
    ['missing mutation notification', o => { o.original.events = []; }],
    ['call capture', o => { o.original.calls.find(c => c.label === 'edit').capture.revision = '99'; }],
  ]) await t.test(name, async () => { const s = syntheticRun(); change(editCase(s)); assertIntegrityFailure(await s.run()); });
});
test('Firefox authentic behavior GAP is visible/nonblocking, but CSP and capture failure still block', async () => {
  const s = syntheticRun(), o = editCase(s, 'firefox');
  o.original.calls.find(c => c.label === 'after-undo-state').result.value.state.history.undo_entries = '1';
  const r = await s.run(), row = rowFor(r, o); assert.equal(row.integrity, 'PASS'); assert.equal(row.requirement, 'GAP'); assert.equal(row.blockingReasons.length, 0);
  assert.equal(r.blockingReasons.length, 0);
  o.cspViolations.push({ effectiveDirective: 'script-src', blockedURI: 'synthetic', sourceFile: 'synthetic', lineNumber: 0, columnNumber: 0, disposition: 'enforce' });
  assertIntegrityFailure(await s.run());
});
test('the frozen source authority cannot be replaced by runtime-authored expected data', async () => {
  await assert.rejects(loadContract({ readArtifact: async (path, limit) => path.endsWith('source-pins.json') ? encode('{}') : sourceReader(path, limit) }),
    error => error.code === 'mounted-corpus.artifact_pin');
});
test('large registry packet keeps full-byte integrity while owning only its bounded profile/registry projection', async t => {
  for (const mode of ['valid', 'hash', 'duplicate-key', 'oversized', 'nonpacket']) await t.test(mode, async () => {
    const s = syntheticRun(), path = 'artifacts/extensions/packet.json';
    const packet = JSON.parse(s.files.get(path).toString('utf8'));
    packet.unrelatedConsumerFixture = 'synthetic-fixture'.repeat(Math.ceil((BUDGETS.observationBytes + 1) / 17));
    let bytes = encode(packet);
    assert(bytes.length > BUDGETS.observationBytes && bytes.length < BUDGETS.registryPacketBytes);
    if (mode === 'duplicate-key') bytes = encode(`${bytes.toString('utf8').slice(0, -1)},"ignored":{"same":1,"same":2}}`);
    s.files.set(path, bytes);
    const index = s.binding.scenarioPins.findIndex(p => p.path === path);
    s.binding.scenarioPins[index] = pin(path, bytes);
    if (mode === 'hash') s.binding.scenarioPins[index].sha256 = '0'.repeat(64);
    if (mode === 'oversized') s.binding.scenarioPins[index].bytes = BUDGETS.registryPacketBytes + 1;
    if (mode === 'nonpacket') {
      s.files.set('synthetic/oversized-nonpacket', bytes);
      s.binding.scenarioPins.push(pin('synthetic/oversized-nonpacket', bytes));
    }
    const report = await s.run();
    if (mode === 'valid') { assert.equal(report.integrity.status, 'PASS'); assert.equal(report.blockingReasons.length, 0); }
    else assertIntegrityFailure(report);
  });
});
test('large binary WASM has its own schema pin ceiling while JSON/build companions stay at 4MiB', async t => {
  for (const mode of ['valid', 'hash', 'over-schema-ceiling', 'large-seal']) await t.test(mode, async () => {
    const s = syntheticRun(), bytes = Buffer.alloc(BUDGETS.observationBytes + 1, 1), path = s.binding.build.wasm.path;
    s.files.set(path, bytes); s.binding.build.wasm = pin(path, bytes);
    for (const baseline of s.binding.nativeBaselines) baseline.wasmSha256 = s.binding.build.wasm.sha256;
    if (mode === 'hash') s.binding.build.wasm.sha256 = '0'.repeat(64);
    if (mode === 'over-schema-ceiling') s.binding.build.wasm.bytes = 268435457;
    if (mode === 'large-seal') {
      const seal = s.binding.build.seal.path; s.files.set(seal, bytes); s.binding.build.seal = pin(seal, bytes);
    }
    if (mode === 'over-schema-ceiling') {
      await assert.rejects(s.run(), error => error.code === 'mounted-corpus.run_binding_shape'); return;
    }
    const report = await s.run();
    if (mode === 'valid') { assert.equal(report.integrity.status, 'PASS'); assert.equal(report.blockingReasons.length, 0); }
    else assertIntegrityFailure(report);
  });
});
test('unowned/pending memberships cannot acquire outcomes through unsolicited observations', async () => {
  const s = syntheticRun(); const pending = contract.manifest.rows.find(r => !r.initial && r.group === 'mounted_provider_pending');
  assert(pending); s.data[0].rowId = pending.rowId; s.data[0].caseId = pending.caseId;
  const r = await s.run(); assertIntegrityFailure(r); assert(r.rows.filter(row => row.measurementStatus === 'NOT_EXECUTED').every(row => row.requirement === null));
});
test('foreign public profile/context and native baseline pins cannot pass on shape alone', async t => {
  for (const [name, change] of [
    ['foreign profile', s => { s.data[0].original.context.profile.profile_id = 'org.example.foreign'; }],
    ['foreign capability', s => { s.data[1].original.context.capability_digest = 'c'.repeat(64); }],
    ['foreign baseline build', s => { s.binding.nativeBaselines[0].buildId = 'stale'; }],
  ]) await t.test(name, async () => { const s = syntheticRun(); change(s); assertIntegrityFailure(await s.run()); });
});
