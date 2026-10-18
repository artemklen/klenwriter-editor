// SPDX-License-Identifier: MIT OR Apache-2.0
// Actual packaged release WASM + public controller; no controlled/fake bridge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCommand, createEditor, loadSdk } from '../packages/sdk/dist/index.js';
import { kwdjCommand } from '../packages/kwdj/dist/index.js';

let modulePromise;
const productionModule = () => modulePromise ??= loadSdk({ wasm: new Uint8Array(readFileSync(new URL('../packages/wasm/dist/editor_wasm_bg.wasm', import.meta.url))) });
const document = text => ({ schema: 'klenwriter.document', schema_version: 1, profile: 'prose', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const source = value => typeof value === 'string' ? value : JSON.stringify(value);
const completed = submission => { assert.equal(submission.status, 'completed'); return submission.response; };
const settled = submission => submission.status === 'queued' ? submission.completion : Promise.resolve(submission.response);
const accepted = response => { assert.equal(response.status, 'ok', JSON.stringify(response)); return response.value; };
const refused = response => { assert.equal(response.status, 'refused', JSON.stringify(response)); return response.diagnostic; };
const state = editor => accepted(editor.read({ kind: 'state' })).state;
const node = (editor, id, stamp = editor.capture()) => accepted(editor.read({ kind: 'node', stamp, node: id })).node;
const root = editor => node(editor, state(editor).root);
const textLeaf = (editor, paragraphIndex = 0) => node(editor, node(editor, root(editor).children[paragraphIndex]).children[0]);
const position = (id, offset) => ({ kind: 'text', node: id, offset, affinity: 'after' });
const commandRequest = (editor, intent, history_hint = { kind: 'isolated' }, stamp = editor.capture()) => ({ kind: 'command', stamp, command: kwdjCommand(intent), history_hint });
const command = (editor, intent, hint) => editor.submit(commandRequest(editor, intent, hint));
function select(editor, leaf, offset) {
  const point = position(leaf, offset);
  return accepted(completed(editor.submit({ kind: 'set_selection', stamp: editor.capture(), selection: { anchor: point, focus: point } })));
}
const snapshot = editor => {
  const reply = accepted(completed(editor.submit({ kind: 'snapshot', stamp: editor.capture(), max_bytes: 16 * 1024 * 1024 })));
  assert.equal(reply.kind, 'snapshot'); return reply;
};
const release = (editor, handle) => accepted(completed(editor.submit({ kind: 'release_snapshot', handle })));
const canonical = editor => { const receipt = snapshot(editor); const value = receipt.canonical_json; release(editor, receipt.handle); return value; };
const counts = module => JSON.parse(module.resourceCounts());

test('packaged KWDJ helper: rejects accessors without invoking them', () => {
  let reads = 0;
  const kindGetter = { get kind() { reads++; return 'insert_text'; }, text: 'keep' };
  assert.throws(() => kwdjCommand(kindGetter));
  assert.equal(reads, 0);
  const nestedGetter = { kind: 'toggle_mark', mark: { type_id: 'org.klenwriter.kwdj/strong', attributes: {
    get extra() { reads++; return { kind: 'string', value: 'keep' }; },
  } } };
  assert.throws(() => kwdjCommand(nestedGetter));
  assert.equal(reads, 0);
});

test('packaged KWDJ helper: rejects toJSON without invoking it', () => {
  let calls = 0;
  const intent = { kind: 'insert_text', text: 'keep', toJSON() { calls++; return { kind: 'insert_text', text: 'changed' }; } };
  assert.throws(() => kwdjCommand(intent));
  assert.equal(calls, 0);
});

test('packaged KWDJ helper: owns plain data and rejects inherited command names', () => {
  const intent = Object.assign(Object.create(null), { kind: 'insert_text', text: 'Я 😀\u00a0e\u0301' });
  const command = kwdjCommand(intent);
  intent.text = 'later';
  assert.deepEqual(command, { id: 'org.klenwriter.kwdj/command/insert-text', payload_json: '{"kind":"insert_text","text":"Я 😀\u00a0e\u0301"}' });
  for (const kind of ['toString', 'constructor', '__proto__', 'unknown']) assert.throws(() => kwdjCommand({ kind }));
  const mark = kwdjCommand({ kind: 'toggle_mark', mark: { type_id: 'org.klenwriter.kwdj/strong', attributes: {
    count: { kind: 'number', value: '18446744073709551615' },
  } } });
  assert.equal(JSON.parse(mark.payload_json).mark.attributes.count.value, '18446744073709551615');
});

test('packaged command helper: captures payload before caller mutation without executing hooks', () => {
  const payload = { text: 'keep', nested: [{ value: '18446744073709551615' }] };
  const command = createCommand('org.example.notes/command/insert', payload);
  payload.text = 'changed'; payload.nested[0].value = '0';
  assert.deepEqual(JSON.parse(command.payload_json), { text: 'keep', nested: [{ value: '18446744073709551615' }] });
  let calls = 0;
  assert.throws(() => createCommand('org.example.notes/command/insert', { get text() { calls++; return 'unsafe'; } }));
  assert.throws(() => createCommand('org.example.notes/command/insert', { toJSON() { calls++; return {}; } }));
  assert.equal(calls, 0);
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => createCommand('org.example.notes/command/insert', cyclic));
});

async function open(input = document('abc'), optionOverrides = {}, controllerOverrides = {}) {
  const module = await productionModule(), baseline = counts(module), callbackErrors = [];
  const options = { abi: module.manifest.abi, build_id: module.manifest.build_id, profile: structuredClone(module.manifest.profiles[0]), admission: 'validate', access: 'editable', identities: { media: [], references: [] }, limits: null, ...optionOverrides };
  const editor = createEditor({ input: new TextEncoder().encode(source(input)), options, loader: async () => module, onCallbackError: error => callbackErrors.push(error), ...controllerOverrides });
  const ready = await editor.ready;
  if (ready.status !== 'ok') { editor.destroy(); assert.fail(JSON.stringify(ready)); }
  const close = () => {
    editor.destroy();
    assert.deepEqual(counts(module), baseline, 'actual Rust Session/snapshot/protection ownership returns to baseline');
    const own = editor.resources();
    for (const field of ['sessions', 'listeners', 'queued_mutations', 'queued_bytes', 'pending_tickets', 'host_requests', 'task_continuations', 'original_input_bytes', 'callback_error_handlers']) assert.equal(own[field], 0, field);
  };
  return { editor, module, baseline, callbackErrors, close };
}

test('packaged SDK: real catalog, text command, revisioned reads, snapshot and exact undo/redo', async () => {
  const context = await open(); const { editor } = context;
  try {
    assert.equal(accepted(editor.read({ kind: 'catalog' })).commands.length, 15);
    const leaf = textLeaf(editor).id; select(editor, leaf, 2);
    const events = []; editor.subscribe(event => events.push(event));
    const before = editor.capture();
    const query = accepted(editor.query({ kind: 'query_command', stamp: before, command: kwdjCommand({ kind: 'insert_text', text: 'X' }) }));
    assert.equal(query.available, true); assert.equal(query.effect, 'changed'); assert.deepEqual(editor.capture(), before); assert.equal(events.length, 0);
    assert.equal(accepted(completed(command(editor, { kind: 'insert_text', text: 'X' }))).effect, 'changed');
    assert.deepEqual(JSON.parse(canonical(editor)), document('abXc'));
    assert.equal(events.length, 1); assert.equal(events[0].change.kind, 'document');
    assert.equal(events[0].before.revision, '0'); assert.equal(events[0].after.revision, '1');
    assert.equal(node(editor, leaf).text, 'abXc');
    assert.equal(node(editor, leaf).stats.text_utf16, '4');
    assert.equal(refused(editor.read({ kind: 'node', stamp: before, node: leaf })).code, 'session.stale_revision');
    const undo = accepted(editor.query({ kind: 'query_history', stamp: editor.capture(), direction: 'undo' })); assert.equal(undo.available, true);
    accepted(completed(editor.submit({ kind: 'history', stamp: editor.capture(), direction: 'undo' })));
    assert.deepEqual(JSON.parse(canonical(editor)), document('abc'));
    accepted(completed(editor.submit({ kind: 'history', stamp: editor.capture(), direction: 'redo' })));
    assert.deepEqual(JSON.parse(canonical(editor)), document('abXc'));
    assert.deepEqual(events.map(e => e.after.revision), ['1', '2', '3']);
    assert.equal(context.callbackErrors.length, 0);
  } finally { context.close(); }
});

test('packaged SDK: two listeners read revision r before queued command; second same capture refuses stale', async () => {
  const context = await open(); const { editor } = context;
  try {
    const leaf = textLeaf(editor).id; select(editor, leaf, 2);
    const seen = [], tickets = []; let once = false;
    editor.subscribe(event => {
      seen.push(['first', event.after.revision, editor.read({ kind: 'node', stamp: event.after, node: leaf })]);
      if (!once) { once = true; const request = commandRequest(editor, { kind: 'insert_text', text: 'Y' }); tickets.push(editor.submit(request), editor.submit(request)); }
    });
    editor.subscribe(event => seen.push(['second', event.after.revision, editor.read({ kind: 'node', stamp: event.after, node: leaf })]));
    accepted(completed(command(editor, { kind: 'insert_text', text: 'X' })));
    assert.equal(tickets[0].status, 'queued'); assert.equal(tickets[1].status, 'queued');
    accepted(await settled(tickets[0])); assert.equal(refused(await settled(tickets[1])).code, 'session.stale_revision');
    assert.deepEqual(seen.map(([listener, revision, reply]) => [listener, revision, accepted(reply).node.text]), [['first', '1', 'abXc'], ['second', '1', 'abXc'], ['first', '2', 'abXYc'], ['second', '2', 'abXYc']]);
    assert.deepEqual(JSON.parse(canonical(editor)), document('abXYc'));
    assert.equal(context.callbackErrors.length, 0);
  } finally { context.close(); }
});

test('packaged SDK: state-only queued marks preserve listener stamp and noop/refusal/query emit zero events', async () => {
  const context = await open(); const { editor } = context;
  try {
    const leaf = textLeaf(editor).id; select(editor, leaf, 1);
    const events = [], reads = []; let ticket, once = false;
    editor.subscribe(event => {
      events.push(event);
      if (!once) { once = true; ticket = editor.submit({ kind: 'set_stored_marks', stamp: editor.capture(), marks: [] }); }
    });
    editor.subscribe(event => reads.push(editor.read({ kind: 'node', stamp: event.after, node: leaf })));
    accepted(completed(editor.submit({ kind: 'set_stored_marks', stamp: editor.capture(), marks: [{ type_id: 'org.klenwriter.kwdj/strong', attributes: {} }] })));
    assert.equal(ticket.status, 'queued'); accepted(await settled(ticket));
    assert.equal(events.length, 2); assert.ok(events.every(e => e.change.kind === 'state' && e.before.revision === '0' && e.after.revision === '0'));
    assert.deepEqual(state(editor).stored_marks, []); assert.equal(reads.filter(r => r.status === 'ok').length, 2);
    const count = events.length, before = editor.capture();
    select(editor, leaf, 1);
    accepted(completed(command(editor, { kind: 'dismiss_slash' })));
    accepted(editor.query({ kind: 'query_history', stamp: editor.capture(), direction: 'undo' }));
    const request = commandRequest(editor, { kind: 'insert_text', text: 'Z' }); request.command.id = 'unregistered.command';
    assert.equal(refused(completed(editor.submit(request))).code, 'command.unknown');
    assert.deepEqual(editor.capture(), before); assert.equal(events.length, count);
    assert.equal(context.callbackErrors.length, 0);
  } finally { context.close(); }
});

test('packaged SDK: save acknowledgement queues behind all listeners and never exports per callback', async () => {
  const context = await open(); const { editor } = context;
  try {
    const leaf = textLeaf(editor).id; select(editor, leaf, 2);
    accepted(completed(command(editor, { kind: 'insert_text', text: 'X' })));
    const saved = snapshot(editor); const observed = []; let ticket, once = false;
    editor.subscribe(event => { if (!once) { once = true; ticket = editor.submit({ kind: 'acknowledge_snapshot', stamp: editor.capture(), handle: saved.handle }); } });
    editor.subscribe(event => observed.push([event.change.kind, event.after.revision, editor.read({ kind: 'state' }), editor.read({ kind: 'node', stamp: event.after, node: leaf })]));
    select(editor, leaf, 0);
    assert.equal(ticket.status, 'queued'); accepted(await settled(ticket));
    assert.deepEqual(observed.map(([kind, revision, response, read]) => [kind, revision, accepted(response).state.dirty, accepted(read).node.text]), [['state', '1', true, 'abXc'], ['state', '1', false, 'abXc']]);
    assert.equal(state(editor).saved_revision, '1'); release(editor, saved.handle);
    assert.equal(context.callbackErrors.length, 0);
  } finally { context.close(); }
});

test('packaged SDK: remount is deferred through old-generation read fence and cancels queued/host capabilities', async () => {
  const context = await open(); const { editor } = context;
  try {
    const oldStamp = editor.capture(), oldLeaf = textLeaf(editor).id; select(editor, oldLeaf, 1);
    const host = editor.captureHostRequest(); const seen = []; let remount, cancelled, once = false;
    editor.subscribe(event => {
      if (!once) {
        once = true;
        remount = editor.submit({ kind: 'remount', stamp: editor.capture(), input_json: JSON.stringify(document('new')), admission: 'validate' });
        cancelled = command(editor, { kind: 'insert_text', text: 'forbidden' });
      }
    });
    editor.subscribe(event => seen.push(editor.read({ kind: 'node', stamp: event.after, node: oldLeaf })));
    accepted(completed(editor.submit({ kind: 'set_stored_marks', stamp: editor.capture(), marks: [] })));
    accepted(await settled(remount)); assert.equal(refused(await settled(cancelled)).code, 'sdk.stale_generation');
    assert.equal(seen.length, 1); assert.equal(accepted(seen[0]).node.text, 'abc');
    assert.notEqual(editor.capture().generation, oldStamp.generation);
    assert.equal(refused(editor.read({ kind: 'node', stamp: oldStamp, node: oldLeaf })).code, 'session.stale_session');
    assert.equal(refused(completed(editor.completeHostRequest(host.request, { kind: 'barrier', stamp: host.request.stamp }))).code, 'sdk.stale_request');
    assert.deepEqual(JSON.parse(canonical(editor)), document('new'));
    const before = editor.capture(), current = canonical(editor);
    refused(completed(editor.submit({ kind: 'remount', stamp: before, input_json: 'invalid', admission: 'validate' })));
    assert.deepEqual(editor.capture(), before); assert.equal(canonical(editor), current);
    assert.equal(context.callbackErrors.length, 0);
  } finally { context.close(); }
});

test('packaged SDK: async host completions refuse after each revision/selection/history/generation/lifecycle barrier', async () => {
  for (const change of ['revision', 'selection', 'history', 'remount', 'destroy']) {
    const context = await open(); const { editor } = context;
    try {
      const leaf = textLeaf(editor).id; select(editor, leaf, 1);
      if (change === 'history') accepted(completed(command(editor, { kind: 'insert_text', text: 'A' }, { kind: 'typing', token: '7', class: 'insert' })));
      const captured = editor.captureHostRequest(); assert.equal(captured.status, 'captured');
      if (change === 'revision') accepted(completed(command(editor, { kind: 'insert_text', text: 'X' })));
      if (change === 'selection') select(editor, leaf, 2);
      if (change === 'history') { const before = editor.capture(); accepted(completed(editor.submit({ kind: 'barrier', stamp: before }))); assert.notEqual(editor.capture().history_epoch, before.history_epoch); }
      if (change === 'remount') accepted(completed(editor.submit({ kind: 'remount', stamp: editor.capture(), input_json: JSON.stringify(document('new')), admission: 'validate' })));
      if (change === 'destroy') editor.destroy();
      const before = editor.capture();
      assert.equal(refused(completed(editor.completeHostRequest(captured.request, { kind: 'barrier', stamp: captured.request.stamp }))).code, 'sdk.stale_request', change);
      assert.deepEqual(editor.capture(), before); assert.equal(editor.resources().host_requests, 0);
    } finally { context.close(); }
  }
});

test('packaged SDK: listener throw/unsubscribe/new listener and callback destroy preserve exact native ownership', async () => {
  const context = await open(); const { editor } = context;
  try {
    const leaf = textLeaf(editor).id; select(editor, leaf, 1);
    const seen = []; let remove, once = false;
    const removeFirst = editor.subscribe(event => { seen.push(`first:${event.after.revision}`); if (!once) { once = true; remove(); editor.subscribe(e => seen.push(`new:${e.after.revision}`)); } throw new Error('controlled listener exception'); });
    remove = editor.subscribe(event => seen.push(`removed:${event.after.revision}`));
    editor.subscribe(event => seen.push(`last:${event.after.revision}`));
    accepted(completed(command(editor, { kind: 'insert_text', text: 'X' })));
    accepted(completed(command(editor, { kind: 'insert_text', text: 'Y' })));
    assert.deepEqual(seen, ['first:1', 'last:1', 'first:2', 'last:2', 'new:2']);
    assert.equal(context.callbackErrors.length, 2); removeFirst();
  } finally { context.close(); }
  const next = await open();
  try {
    const leaf = textLeaf(next.editor).id; select(next.editor, leaf, 1);
    const seen = []; let queued, disposal;
    next.editor.subscribe(() => { seen.push('first'); queued = command(next.editor, { kind: 'insert_text', text: 'never' }); disposal = next.editor.destroy(); throw new Error('after destroy request'); });
    next.editor.subscribe(() => seen.push('forbidden'));
    accepted(completed(command(next.editor, { kind: 'insert_text', text: 'X' })));
    assert.equal(refused(await settled(queued)).code, 'sdk.cancelled'); assert.equal(accepted(await settled(disposal)).kind, 'destroyed');
    assert.deepEqual(seen, ['first']); assert.equal(next.editor.lifecycle, 'destroyed');
    assert.equal(next.callbackErrors.length, 0); assert.equal(next.editor.resources().callback_error_handlers, 0);
  } finally { next.close(); }
});

test('packaged SDK: pending hard cap128 and64-turn yielding settle actual stale native requests exactly once', async () => {
  const context = await open(undefined, {}, { limits: { pending: 9999, listeners: 9999 } }); const { editor } = context;
  try {
    const leaf = textLeaf(editor).id; select(editor, leaf, 1);
    const tickets = []; let once = false;
    editor.subscribe(() => { if (!once) { once = true; const request = commandRequest(editor, { kind: 'insert_text', text: 'Y' }); for (let i = 0; i < 129; i++) tickets.push(editor.submit(request)); } });
    for (let index = 1; index < 64; index++) assert.equal(typeof editor.subscribe(() => {}), 'function');
    assert.equal(refused(editor.subscribe(() => {})).code, 'sdk.listener_limit');
    accepted(completed(command(editor, { kind: 'insert_text', text: 'X' })));
    assert.equal(tickets.filter(t => t.status === 'queued').length, 128);
    assert.equal(refused(completed(tickets[128])).code, 'sdk.queue_limit');
    assert.equal(editor.resources().task_continuations, 1);
    const outcomes = await Promise.all(tickets.slice(0, 128).map(settled));
    assert.equal(outcomes.filter(r => r.status === 'ok').length, 1);
    assert.ok(outcomes.slice(1).every(r => refused(r).code === 'session.stale_revision'));
    assert.deepEqual(JSON.parse(canonical(editor)), document('aXYbc'));
    assert.equal(editor.resources().pending_tickets, 0); assert.equal(context.callbackErrors.length, 0);
  } finally { context.close(); }
});

test('packaged SDK: current identity facts on untouched nodes are rechecked and retry succeeds', async () => {
  const id = '550e8400-e29b-41d4-a716-446655440006';
  const input = document('abc'); input.content.unshift({ type: 'paragraph', content: [{ type: 'text', text: 'Name', marks: [{ type: 'reference_link', attrs: { reference_entity_id: id } }] }] });
  const context = await open(input, { identities: { media: [], references: [{ id, status: 'exists' }] } }); const { editor } = context;
  try {
    select(editor, textLeaf(editor, 1).id, 1); const events = []; editor.subscribe(event => events.push(event));
    accepted(completed(editor.submit({ kind: 'update_facts', stamp: editor.capture(), identities: { media: [], references: [{ id, status: 'unavailable' }] } })));
    const before = editor.capture(), query = accepted(editor.query({ kind: 'query_command', stamp: before, command: kwdjCommand({ kind: 'insert_text', text: 'X' }) }));
    assert.equal(query.available, false); assert.ok(query.diagnostic.code.length > 0);
    const failure = refused(completed(command(editor, { kind: 'insert_text', text: 'X' })));
    assert.equal(failure.code, query.diagnostic.code); assert.deepEqual(editor.capture(), before); assert.equal(events.length, 0);
    accepted(completed(editor.submit({ kind: 'update_facts', stamp: editor.capture(), identities: { media: [], references: [{ id, status: 'exists' }] } })));
    accepted(completed(command(editor, { kind: 'insert_text', text: 'X' })));
    const expected = structuredClone(input); expected.content[1].content[0].text = 'aXbc';
    assert.deepEqual(JSON.parse(canonical(editor)), expected); assert.equal(events.length, 1); assert.equal(context.callbackErrors.length, 0);
  } finally { context.close(); }
});

test('packaged SDK:32 engine-issued receipts are bounded, release/retry works and forged/old handles refuse', async () => {
  const context = await open(); const { editor } = context;
  try {
    const receipts = Array.from({ length: 32 }, () => snapshot(editor));
    assert.equal(accepted(editor.read({ kind: 'resources' })).resources.snapshot_handles, 32);
    const before = editor.capture();
    assert.equal(refused(completed(editor.submit({ kind: 'snapshot', stamp: before, max_bytes: 100000 }))).code, 'sdk.snapshot_limit');
    assert.deepEqual(editor.capture(), before);
    assert.equal(refused(completed(editor.submit({ kind: 'acknowledge_snapshot', stamp: before, handle: 'forged' }))).code, 'sdk.stale_snapshot');
    release(editor, receipts[0].handle); const replacement = snapshot(editor); assert.notEqual(replacement.handle, receipts[0].handle);
    assert.equal(refused(completed(editor.submit({ kind: 'release_snapshot', handle: receipts[0].handle }))).code, 'sdk.stale_snapshot');
    for (const receipt of receipts.slice(1)) release(editor, receipt.handle); release(editor, replacement.handle);
    assert.equal(accepted(editor.read({ kind: 'resources' })).resources.snapshot_handles, 0); assert.equal(context.callbackErrors.length, 0);
  } finally { context.close(); }
});

test('packaged SDK: lossless metadata/MAXu64/null values and malformed destroy preserve coherent Session', async () => {
  const input = '{"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"ordered_list","attrs":{"start":18446744073709551615},"content":[{"type":"list_item","content":[{"type":"paragraph","content":[{"type":"text","text":"abc"}]}]}]}]}';
  const context = await open(input); const { editor } = context;
  try {
    const list = node(editor, root(editor).children[0]);
    // Owned JSON dictionaries deliberately have a null prototype; authored data
    // and the closed tagged DTO fields are the literal preservation contract.
    assert.deepEqual(Object.keys(list.attributes.start).sort(), ['kind', 'value']);
    assert.equal(list.attributes.start.kind, 'number');
    assert.equal(list.attributes.start.value, '18446744073709551615');
    assert.match(canonical(editor), /"start":18446744073709551615/);
    const before = editor.capture();
    assert.equal(refused(editor.read({ kind: 'node', stamp: { ...before, revision: '18446744073709551615' }, node: list.id })).code, 'session.stale_revision');
    assert.equal(refused(editor.read({ kind: 'node', stamp: { ...before, revision: '18446744073709551616' }, node: list.id })).code, 'sdk.invalid_u64');
    assert.equal(refused(completed(editor.submit({ kind: 'destroy', extra: true }))).code, 'sdk.invalid_input');
    const captured = editor.captureHostRequest();
    assert.equal(refused(completed(editor.completeHostRequest(captured.request, { kind: 'destroy', stamp: captured.request.stamp }))).code, 'sdk.invalid_input');
    assert.equal(editor.lifecycle, 'ready'); assert.deepEqual(editor.capture(), before);
    assert.equal(accepted(editor.read({ kind: 'resources' })).resources.sessions, 1);
    assert.equal(context.callbackErrors.length, 0);
  } finally { context.close(); }
});

test('packaged SDK: readonly permits navigation while document commands refuse without publication', async () => {
  const context = await open(document('abc'), { access: 'read_only' }); const { editor } = context;
  try {
    const events = []; editor.subscribe(event => events.push(event));
    select(editor, textLeaf(editor).id, 1); assert.equal(events.length, 1); assert.equal(events[0].change.kind, 'state');
    const before = editor.capture(), query = accepted(editor.query({ kind: 'query_command', stamp: before, command: kwdjCommand({ kind: 'insert_text', text: 'X' }) }));
    assert.equal(query.available, false);
    assert.equal(refused(completed(command(editor, { kind: 'insert_text', text: 'X' }))).code, query.diagnostic.code);
    assert.deepEqual(editor.capture(), before); assert.equal(events.length, 1); assert.deepEqual(JSON.parse(canonical(editor)), document('abc'));
  } finally { context.close(); }
});

test('packaged SDK: repeated complete lifecycle releases actual native and JS ownership', async () => {
  const module = await productionModule(), baseline = counts(module);
  let resolve;
  const delayed = new Promise(ready => { resolve = ready; });
  const options = { abi: module.manifest.abi, build_id: module.manifest.build_id, profile: structuredClone(module.manifest.profiles[0]), admission: 'validate', access: 'editable', identities: { media: [], references: [] }, limits: null };
  const cancelled = createEditor({ input: new TextEncoder().encode(source(document('abc'))), options, loader: () => delayed, onCallbackError: () => assert.fail('cancelled callback') });
  assert.equal(cancelled.resources().callback_error_handlers, 1);
  cancelled.destroy(); assert.equal(cancelled.resources().callback_error_handlers, 0);
  assert.equal(refused(await cancelled.ready).code, 'sdk.cancelled');
  resolve(module); await new Promise(ready => setTimeout(ready, 0));
  assert.equal(cancelled.resources().sessions, 0); assert.deepEqual(counts(module), baseline);
  const invalid = createEditor({ input: new Uint8Array(), options, loader: 1, onCallbackError: () => assert.fail('invalid callback') });
  assert.equal(refused(await invalid.ready).code, 'sdk.invalid_input');
  assert.equal(invalid.resources().callback_error_handlers, 0); invalid.destroy();
  assert.deepEqual(counts(module), baseline);
  for (let cycle = 0; cycle < 24; cycle++) {
    const context = await open();
    try {
      const { editor } = context; select(editor, textLeaf(editor).id, 1); editor.subscribe(() => {});
      accepted(completed(command(editor, { kind: 'insert_text', text: 'X' })));
      const receipt = snapshot(editor); assert.equal(accepted(editor.read({ kind: 'resources' })).resources.snapshot_handles, 1);
      accepted(completed(editor.submit({ kind: 'acknowledge_snapshot', stamp: editor.capture(), handle: receipt.handle })));
      editor.captureHostRequest();
      assert.equal(context.callbackErrors.length, 0);
    } finally { context.close(); }
    assert.deepEqual(counts(module), baseline);
  }
});
