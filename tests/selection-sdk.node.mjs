// SPDX-License-Identifier: MIT OR Apache-2.0
// Actual compiled release WASM + public SDK2; literal oracles predate runtime.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createEditor, loadSdkV2, sdkBuildId } from '../packages/sdk/dist/index.js';
import { kwdjCommand } from '../packages/kwdj/dist/index.js';

const oracleBytes = readFileSync('contracts/selection/v1/native-oracles.json');
const oracle = JSON.parse(oracleBytes), packet = JSON.parse(readFileSync('artifacts/extensions/packet.json', 'utf8'));
const records = [], digest = bytes => createHash('sha256').update(bytes).digest('hex');
// Public SDK DTOs intentionally use frozen null-prototype records. Literals are
// JSON data; compare all fields without imposing an Object.prototype identity.
const assertData = (actual, literal, label) => assert.deepEqual(structuredClone(actual), structuredClone(literal), label);
let modulePromise;
const production = () => modulePromise ??= loadSdkV2({ wasm: new Uint8Array(readFileSync('packages/wasm/dist/editor_wasm_bg.wasm')) });
const ok = response => { assert.equal(response.status, 'ok', JSON.stringify(response)); return response.value; };
const completed = ticket => { assert.equal(ticket.status, 'completed'); return ticket.response; };
const state = editor => ok(editor.read({ kind: 'state' })).state;
const node = (editor, id) => ok(editor.read({ kind: 'node', stamp: editor.capture(), node: id })).node;
function rows(editor) {
  const result = [], pending = [{ id: state(editor).root, path: [] }], seen = new Set();
  for (let index = 0; index < pending.length; index++) {
    assert(index < 200000); const next = pending[index]; assert(!seen.has(next.id)); seen.add(next.id);
    const current = node(editor, next.id); result.push({ path: next.path, node: current });
    current.children.forEach((id, child) => pending.push({ id, path: [...next.path, child] }));
  }
  return result;
}
function canonical(editor) {
  const receipt = ok(completed(editor.submit({ kind: 'snapshot', stamp: editor.capture(), max_bytes: 16 * 1024 * 1024 })));
  assert.equal(receipt.kind, 'snapshot'); const result = receipt.canonical_json;
  ok(completed(editor.submit({ kind: 'release_snapshot', handle: receipt.handle }))); return result;
}
function checkpoint(editor, events) {
  return { state: state(editor), rows: rows(editor), canonical: canonical(editor), events: structuredClone(events),
    native: editor.nativeResources(), resources: editor.resources() };
}
function bind(editor, literal, ids, originalIds = null) {
  const all = rows(editor);
  for (const [role, path] of Object.entries(literal)) {
    const actual = path?.virtual_root ? all[0].node : all.find(row => JSON.stringify(row.path) === JSON.stringify(path))?.node;
    assert(actual, `Authored path for ${role} exists`);
    if (ids.has(role)) assert.equal(actual.id, ids.get(role), `Historical identity ${role}`);
    else { if (originalIds) assert(!originalIds.has(actual.id), `Created ${role} is new`); ids.set(role, actual.id); }
  }
}
function point(literal, ids) {
  if (literal.kind === 'text') { assert(ids.has(literal.node)); return { ...literal, node: ids.get(literal.node) }; }
  if (literal.kind === 'child') { assert(ids.has(literal.parent)); return { ...literal, parent: ids.get(literal.parent) }; }
  assert.equal(literal.kind, 'edge'); assert(ids.has(literal.node)); return { ...literal, node: ids.get(literal.node) };
}
const selection = (literal, ids) => literal === null ? null : { anchor: point(literal.anchor, ids), focus: point(literal.focus, ids) };
function expected(value, ids, stamp, afterState = null) {
  if (value === 'exact_current_stamp') return stamp;
  if (value === '$after_state') return afterState;
  if (Array.isArray(value)) return value.map(item => expected(item, ids, stamp, afterState));
  if (!value || typeof value !== 'object') return value;
  if (['text', 'child', 'edge'].includes(value.kind) && ('node' in value || 'parent' in value)) return point(value, ids);
  const result = {};
  for (const [key, item] of Object.entries(value)) result[key] = key === 'selected_atoms' ? item.map(role => { assert(ids.has(role)); return ids.get(role); }) : expected(item, ids, stamp, afterState);
  return result;
}
async function open(input, access = 'editable', identities = { media: [], references: [] }) {
  const module = await production(), baseline = JSON.parse(module.resourceCounts());
  const editor = createEditor({ input: new TextEncoder().encode(JSON.stringify(input)), loader: async () => module,
    options: { abi: 'editor-sdk/2', build_id: module.manifest.build_id, profile: packet.kwdjProfile,
      admission: 'validate', access, registry_json: packet.kwdjRegistryJson,
      profile_options_json: JSON.stringify({ identities, limits: null }) } });
  assert.equal((await editor.ready).status, 'ok');
  return { editor, close() { editor.destroy(); assertData(JSON.parse(module.resourceCounts()), baseline); } };
}
function checkMaps(editor, facts, ids, label) {
  for (const fact of facts ?? []) {
    const actual = ok(editor.read({ kind: 'map_position', stamp: editor.capture(), from_revision: fact.from_revision ?? '0', position: point(fact.input, ids) }));
    assertData(actual, { kind: 'mapped', status: fact.status, position: fact.position ? point(fact.position, ids) : null,
      deleted: fact.deleted, stamp: editor.capture() }, label);
  }
}

for (const literal of oracle.cases) test(`selection actual SDK2/WASM ${literal.id}`, async () => {
  const record = { id: literal.id, scope: 'actual packaged SDK2/compiled release WASM', status: 'running', checkpoints: [] }; records.push(record);
  const context = await open(literal.input.document, literal.input.access, literal.input.identities), { editor } = context;
  try {
    const ids = new Map(); bind(editor, literal.input.identity_roles, ids);
    ok(completed(editor.submit({ kind: 'set_selection', stamp: editor.capture(), selection: selection(literal.input.selection, ids) })));
    const events = []; editor.subscribe(event => events.push(structuredClone(event)));
    const before = checkpoint(editor, events), originalIds = new Set(before.rows.map(row => row.node.id));
    assert.equal(before.canonical, literal.input.canonical_json);
    record.checkpoints.push({ label: 'before', ...before });
    if (literal.before_projection_action) {
      const action = literal.before_projection_action, stamp = editor.capture();
      const request = { ...action.request, stamp, selection: selection(action.request.selection, ids) };
      assertData(completed(editor.submit(request)), expected(action.expected, ids, stamp));
      assertData(checkpoint(editor, events), before, 'Invalid scalar admission is pure');
    }
    const stamp = editor.capture();
    const projection = editor.read({ ...literal.projection.request, stamp });
    assertData(projection, expected(literal.projection.expected, ids, stamp));
    assertData(checkpoint(editor, events), before, 'Selection-text read has no observable facet changes');
    const command = literal.delete_selection.command;
    const query = editor.query({ kind: 'query_command', stamp, command });
    assertData(query, expected(literal.delete_selection.query, ids, stamp));
    assertData(checkpoint(editor, events), before, 'Actual native query remains pure');
    if (literal.old_insert_empty) {
      const legacy = editor.query({ kind: 'query_command', stamp, command: { id: literal.old_insert_empty.command, payload_json: literal.old_insert_empty.payload_json } });
      assert.equal(ok(legacy).available, literal.old_insert_empty.available, 'Old command context unchanged');
      if (literal.old_insert_empty.query_diagnostic) assertData(legacy.value.diagnostic, literal.old_insert_empty.query_diagnostic);
      assertData(checkpoint(editor, events), before);
    }
    const response = completed(editor.submit({ kind: 'command', stamp, command, history_hint: { kind: 'isolated' } }));
    const afterState = state(editor);
    assertData(response, expected(literal.delete_selection.execute, ids, stamp, afterState));
    if (literal.after.identity_roles) bind(editor, literal.after.identity_roles, ids, originalIds);
    assert.equal(canonical(editor), literal.after.canonical_json);
    assertData(afterState.selection, selection(literal.after.selection, ids));
    const facets = literal.delete_selection.execute_facets;
    if (facets) {
      for (const [field, delta] of [['revision', facets.revision_delta], ['selection_epoch', facets.selection_epoch_delta], ['history_epoch', facets.history_epoch_delta]]) {
        if (delta !== undefined) assert.equal(BigInt(afterState.stamp[field]) - BigInt(before.state.stamp[field]), BigInt(delta), field);
      }
      if (facets.undo_entries_delta !== undefined) assert.equal(BigInt(afterState.history.undo_entries) - BigInt(before.state.history.undo_entries), BigInt(facets.undo_entries_delta));
      if (facets.redo_entries !== undefined) assert.equal(afterState.history.redo_entries, String(facets.redo_entries));
      if (facets.dirty !== undefined) assert.equal(afterState.dirty, facets.dirty === 'unchanged' ? before.state.dirty : facets.dirty);
      if (facets.stored_marks !== undefined) assertData(afterState.stored_marks, facets.stored_marks === 'unchanged' ? before.state.stored_marks : facets.stored_marks);
      if (facets.document_event_count !== undefined) assert.equal(events.filter(event => event.change.kind === 'document').length, facets.document_event_count);
      if (facets.state_event_count !== undefined) assert.equal(events.filter(event => event.change.kind === 'state').length, facets.state_event_count);
      if (facets.event_count_delta !== undefined) assert.equal(events.length - before.events.length, facets.event_count_delta);
      if (facets.resources === 'unchanged' || facets.resource_counts === 'unchanged') {
        assertData(editor.resources(), before.resources); assertData(editor.nativeResources(), before.native);
      }
    }
    if (literal.identity) {
      const live = new Set(rows(editor).map(row => row.node.id));
      for (const role of literal.identity.retained_live) assert(live.has(ids.get(role)), `Retained ${role}`);
      for (const role of literal.identity.retired_old) assert(!live.has(ids.get(role)), `Retired ${role}`);
      for (const role of literal.identity.created_live) assert(live.has(ids.get(role)) && !originalIds.has(ids.get(role)), `Created ${role}`);
    }
    checkMaps(editor, literal.maps, ids, literal.id);
    record.checkpoints.push({ label: 'execute', response, ...checkpoint(editor, events) });
    if (response.status !== 'ok' || response.value.kind !== 'mutation' || response.value.effect === 'unchanged') {
      assertData(checkpoint(editor, events), before, 'Refusal/no-op has no observable facet changes');
    }
    if (literal.history?.undo) for (const direction of ['undo', 'redo']) {
      const fact = literal.history[direction];
      ok(completed(editor.submit({ kind: 'history', stamp: editor.capture(), direction })));
      bind(editor, fact.identity_roles, ids, originalIds);
      assert.equal(canonical(editor), fact.canonical_json); assertData(state(editor).selection, selection(fact.selection, ids));
      assert.equal(editor.capture().revision, fact.revision);
      assert.equal(state(editor).history.undo_entries, String(fact.undo_entries));
      assert.equal(state(editor).history.redo_entries, String(fact.redo_entries));
      checkMaps(editor, fact.maps_from_revision1?.map(item => ({ ...item, from_revision: '1' })) ?? fact.maps_from_revision2?.map(item => ({ ...item, from_revision: '2' })), ids, `${literal.id}/${direction}`);
      if (fact.map_from_initial_revision0) checkMaps(editor, [fact.map_from_initial_revision0], ids, `${literal.id}/${direction}/initial`);
      record.checkpoints.push({ label: direction, ...checkpoint(editor, events) });
    }
    record.status = 'passed';
  } catch (error) { record.status = 'failed'; record.error = String(error); throw error; }
  finally { context.close(); record.finalResources = editor.resources(); }
});

for (const literal of oracle.output_budget_literals) test(`selection actual SDK2/WASM ${literal.id}`, async () => {
  const context = await open(literal.document), { editor } = context;
  try {
    const ids = new Map([['ROOT', state(editor).root]]); bind(editor, literal.roles, ids);
    ok(completed(editor.submit({ kind: 'set_selection', stamp: editor.capture(), selection: selection(literal.selection, ids) })));
    const before = checkpoint(editor, []), stamp = editor.capture();
    const response = editor.read({ ...literal.request, stamp });
    const target = literal.expected.status === 'ok' ? { status: 'ok', value: {
      kind: 'selection_text', stamp, selection: selection(literal.selection, ids),
      projection_id: 'org.klenwriter.kwdj/selection-text/1', text: literal.expected.text,
      empty: literal.expected.empty, selected_atoms: literal.expected.selected_atoms.map(role => ids.get(role)),
    } } : expected(literal.expected, ids, stamp);
    assertData(response, target);
    assertData(checkpoint(editor, []), before);
    records.push({ id: literal.id, scope: 'actual SDK2/WASM public output cap', status: 'passed', response });
  } finally { context.close(); }
});

after(() => {
  mkdirSync('artifacts/selection', { recursive: true });
  writeFileSync('artifacts/selection/sdk-report.json', JSON.stringify({ format: 'editor-selection-sdk/1',
    buildId: sdkBuildId, oracleSha256: digest(oracleBytes), frozenManifestSha256: digest(readFileSync('contracts/selection/v1/manifest.json')),
    scope: 'Actual packaged SDK2/compiled release WASM; not installed browser/clipboard/DOM or independent code review. Private allocator high-water is not externally observed.', records }, null, 2) + '\n');
});
