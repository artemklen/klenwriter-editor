// SPDX-License-Identifier: MIT OR Apache-2.0
// These controlled transport tests prove JS ownership/pump logic, not Rust semantics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../packages/sdk/dist/index.js';
import { deferred, fakeModule, mutation, options, result } from './helpers/sdk-fake.mjs';

async function open(extra = {}, hooks = {}) {
  const fixture = fakeModule(hooks);
  const editor = createEditor({ input: new Uint8Array([1, 2, 3]), options: options(), loader: async () => fixture.module, ...extra });
  const ready = await editor.ready; assert.equal(ready.status, 'ok');
  return { editor, fixture };
}
const code = value => value.diagnostic?.code;
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

test('controller-only: deferred loading owns bytes/options and cannot revive after cancellation', async () => {
  const load = deferred(), fixture = fakeModule();
  const input = new Uint8Array([65]), config = options();
  const editor = createEditor({ input, options: config, loader: () => load.promise, onCallbackError: () => assert.fail('destroyed error handler') });
  input[0] = 90; config.access = 'read_only';
  assert.deepEqual([...editor.originalInput()], [65]);
  assert.equal(editor.lifecycle, 'loading');
  assert.equal(editor.resources().callback_error_handlers, 1);
  assert.equal(code(editor.read({ kind: 'state' })), 'sdk.not_ready');
  editor.destroy(); editor.destroy();
  assert.equal(editor.resources().callback_error_handlers, 0);
  assert.equal(code(await editor.ready), 'sdk.cancelled');
  load.resolve(fixture.module); await tick();
  assert.equal(editor.lifecycle, 'destroyed');
  assert.equal(fixture.instances.length, 0);
  assert.equal(editor.resources().sessions, 0);
  assert.equal(editor.resources().original_input_bytes, 0);
});

test('controller-only: invalid configuration releases an already accepted error handler', async () => {
  const editor = createEditor({ input: new Uint8Array([65]), options: options(), onCallbackError: () => assert.fail('invalid controller error handler'), loader: 1 });
  assert.equal(code(await editor.ready), 'sdk.invalid_input');
  assert.equal(editor.lifecycle, 'destroyed');
  assert.equal(editor.resources().callback_error_handlers, 0);
  editor.destroy(); assert.equal(editor.resources().callback_error_handlers, 0);
});

test('controller-only: loader failure is structured and original bytes survive until disposal', async () => {
  const editor = createEditor({ input: new Uint8Array([9]), options: options(), loader: async () => { throw new Error('offline'); } });
  assert.equal(code(await editor.ready), 'sdk.load_failed');
  assert.deepEqual([...editor.originalInput()], [9]);
  editor.destroy(); assert.equal(editor.originalInput(), null);
  assert.equal(editor.resources().pending_tickets, 0);
});

test('controller-only: injected module identity is checked before constructing Session', async () => {
  const fixture = fakeModule(); fixture.module.manifest.build_id = `sha256:${'0'.repeat(64)}`;
  const editor = createEditor({ input: new Uint8Array(), options: options(), loader: async () => fixture.module });
  assert.equal(code(await editor.ready), 'sdk.build_mismatch');
  assert.equal(fixture.instances.length, 0);
  editor.destroy();
});

test('controller-only: failed initialization is Fatal with explicit original recovery ownership', async () => {
  const fixture = fakeModule({ initialization: () => 'invalid initialization transport' });
  const editor = createEditor({ input: new Uint8Array([7]), options: options(), loader: async () => fixture.module });
  const ready = await editor.ready;
  assert.equal(ready.status, 'fatal'); assert.equal(ready.diagnostic.may_have_committed, false);
  assert.deepEqual([...editor.originalInput()], [7]);
  assert.deepEqual(fixture.counts(), { live: 0, destroyed: 1, freed: 1 });
  editor.destroy(); assert.equal(editor.originalInput(), null);
});

test('controller-only: successful admission frees original and callbacks share immutable revision fence', async () => {
  const { editor, fixture } = await open();
  assert.equal(editor.originalInput(), null);
  const observations = [], queued = [];
  editor.subscribe(event => {
    assert.ok(Object.isFrozen(event)); assert.ok(Object.isFrozen(event.after));
    assert.throws(() => { event.after.revision = '999'; }, TypeError);
    observations.push(['first', event.after.revision, editor.read({ kind: 'state' }).value.state.stamp.revision]);
    if (event.after.revision === '1') {
      const request = mutation(editor);
      const ticket = editor.submit(request); assert.equal(ticket.status, 'queued'); queued.push(ticket);
      request.command.id = 'fixture.refuse';
      assert.equal(editor.capture().revision, '1');
    }
  });
  editor.subscribe(event => observations.push(['second', event.after.revision, editor.read({ kind: 'state' }).value.state.stamp.revision]));
  const done = editor.submit(mutation(editor));
  assert.equal(done.status, 'completed'); assert.equal(done.response.status, 'ok');
  assert.equal((await result(queued[0])).status, 'ok');
  assert.deepEqual(observations, [['first', '1', '1'], ['second', '1', '1'], ['first', '2', '2'], ['second', '2', '2']]);
  assert.equal(fixture.log.filter(r => r.kind === 'acknowledge_events').length, 2);
  editor.destroy(); assert.deepEqual(fixture.counts(), { live: 0, destroyed: 1, freed: 1 });
});

test('controller-only: unsubscribe/new listener/throw are isolated with bounded error recording', async () => {
  const reports = []; const { editor } = await open({ onCallbackError: record => { reports.push(record); throw new Error('report failed'); } });
  const seen = []; let remove;
  editor.subscribe(event => {
    seen.push(`a${event.sequence}`); remove();
    editor.subscribe(e => seen.push(`new${e.sequence}`));
    throw new Error('listener failed');
  });
  remove = editor.subscribe(event => seen.push(`removed${event.sequence}`));
  editor.subscribe(event => seen.push(`last${event.sequence}`));
  editor.submit(mutation(editor));
  assert.deepEqual(seen, ['a1', 'last1']);
  editor.submit(mutation(editor));
  assert.deepEqual(seen, ['a1', 'last1', 'a2', 'last2', 'new2']);
  assert.equal(reports.length, 2); assert.equal(editor.callbackErrors().length, 2);
  for (let index = 0; index < 20; index++) editor.submit(mutation(editor));
  assert.equal(editor.callbackErrors().length, 16);
  editor.destroy(); assert.equal(editor.resources().callback_errors, 0);
});

test('controller-only: no-op/refused/query has no callback; state mutations serialize after listener fence', async () => {
  const { editor, fixture } = await open(); const seen = [], queued = [];
  editor.subscribe(event => {
    seen.push(event.change.kind);
    if (event.sequence === '1') {
      for (const kind of ['set_selection', 'set_stored_marks', 'barrier', 'snapshot', 'acknowledge_snapshot', 'update_facts']) {
        const request = { kind, stamp: structuredClone(editor.capture()) };
        if (kind === 'set_selection') request.selection = null;
        if (kind === 'set_stored_marks') request.marks = [];
        if (kind === 'snapshot') request.max_bytes = 1000;
        if (kind === 'acknowledge_snapshot') request.handle = 'receipt-1';
        if (kind === 'update_facts') request.identities = { media: [], references: [] };
        queued.push(editor.submit(request));
      }
    }
  });
  editor.query({ kind: 'query_command', stamp: editor.capture(), command: { id: 'fixture.insert', payload_json: '{}' } });
  editor.submit(mutation(editor, 'fixture.noop')); editor.submit(mutation(editor, 'fixture.refuse'));
  assert.equal(seen.length, 0);
  editor.submit(mutation(editor));
  assert.equal(queued.length, 6); assert.ok(queued.every(q => q.status === 'queued'));
  const outcomes = await Promise.all(queued.map(result));
  assert.equal(outcomes[0].status, 'ok');
  assert.ok(outcomes.slice(1).every(r => code(r) === 'session.stale_revision'));
  assert.deepEqual(seen, ['document', 'state']);
  assert.equal(fixture.log.filter(r => r.kind === 'snapshot').length, 1);
  editor.destroy();
});

test('controller-only: queue/listener/request byte caps tighten and refusals never enqueue', async () => {
  const { editor } = await open({ limits: { pending: 1, queuedBytes: 1024, listeners: 1 } });
  const tickets = [];
  editor.subscribe(() => {
    if (tickets.length) return;
    tickets.push(editor.submit(mutation(editor)), editor.submit(mutation(editor)));
    assert.equal(editor.resources().queued_mutations, 1);
  });
  assert.equal(code(editor.subscribe(() => {})), 'sdk.listener_limit');
  editor.submit(mutation(editor));
  assert.equal(tickets[0].status, 'queued');
  assert.equal(code(tickets[1].response), 'sdk.queue_limit');
  assert.equal((await result(tickets[0])).status, 'ok');
  editor.destroy();
  const tight = await open({ limits: { requestBytes: 20 } });
  assert.equal(code(tight.editor.submit(mutation(tight.editor)).response), 'sdk.request_too_large');
  assert.equal(tight.fixture.log.length, 0); tight.editor.destroy();
  const bytes = await open({ limits: { queuedBytes: 0 } }); let ticket;
  bytes.editor.subscribe(() => { ticket = bytes.editor.submit(mutation(bytes.editor)); });
  bytes.editor.submit(mutation(bytes.editor));
  assert.equal(code(ticket.response), 'sdk.queue_limit'); bytes.editor.destroy();
});

test('controller-only: self-queuing listeners yield after64 mutations and settle all tickets once', async () => {
  const { editor } = await open(); const tickets = [];
  editor.subscribe(event => { if (Number(event.after.revision) < 130) tickets.push(editor.submit(mutation(editor))); });
  editor.submit(mutation(editor));
  assert.equal(editor.capture().revision, '64');
  assert.equal(editor.resources().task_continuations, 1);
  await tick(); await tick();
  assert.equal(editor.capture().revision, '130');
  assert.equal(tickets.length, 129);
  assert.ok((await Promise.all(tickets.map(result))).every(r => r.status === 'ok'));
  assert.equal(editor.resources().pending_tickets, 0); assert.equal(editor.resources().queued_bytes, 0);
  editor.destroy();
});

test('controller-only: destroy during callback stops all further listeners, cancels queue and frees once', async () => {
  const reports = []; const { editor, fixture } = await open({ onCallbackError: error => reports.push(error) }); let queued, destroy;
  const seen = [];
  editor.subscribe(() => { seen.push('first'); queued = editor.submit(mutation(editor)); destroy = editor.destroy(); assert.equal(destroy.status, 'queued'); assert.equal(editor.destroy(), destroy); assert.equal(editor.resources().callback_error_handlers, 0); throw new Error('after destroy request'); });
  editor.subscribe(() => seen.push('forbidden'));
  editor.submit(mutation(editor));
  assert.deepEqual(seen, ['first']);
  assert.deepEqual(reports, []);
  assert.equal(code(await result(queued)), 'sdk.cancelled');
  assert.equal((await result(destroy)).value.kind, 'destroyed');
  assert.equal(editor.lifecycle, 'destroyed'); editor.destroy();
  assert.deepEqual(fixture.counts(), { live: 0, destroyed: 1, freed: 1 });
  const counts = editor.resources();
  for (const key of ['sessions', 'listeners', 'queued_mutations', 'queued_bytes', 'pending_tickets', 'host_requests', 'task_continuations', 'callback_error_handlers']) assert.equal(counts[key], 0, key);
});

test('controller-only: generation replacement cancels captured/queued work; failure preserves it', async () => {
  const { editor } = await open();
  const host = editor.captureHostRequest(); assert.equal(host.status, 'captured');
  const before = editor.capture();
  const refused = editor.submit({ kind: 'remount', stamp: before, input_json: 'invalid', admission: 'validate' });
  assert.equal(code(refused.response), 'fixture.invalid_document');
  assert.deepEqual(editor.capture(), before); assert.equal(editor.resources().host_requests, 1);
  let remount, stale;
  editor.subscribe(() => {
    remount = editor.submit({ kind: 'remount', stamp: editor.capture(), input_json: '{}', admission: 'validate' });
    stale = editor.submit(mutation(editor));
  });
  editor.submit(mutation(editor));
  assert.equal((await result(remount)).status, 'ok');
  assert.equal(code(await result(stale)), 'sdk.stale_generation');
  assert.equal(editor.capture().generation, '2');
  assert.equal(editor.resources().host_requests, 0);
  assert.equal(code(editor.completeHostRequest(host.request, { kind: 'barrier', stamp: before }).response), 'sdk.stale_request');
  editor.destroy();
});

test('controller-only: async capture requires actual token identity and every captured stamp', async () => {
  const { editor } = await open();
  const host = editor.captureHostRequest(); assert.equal(host.status, 'captured');
  assert.equal(code(editor.completeHostRequest({ ...host.request }, { kind: 'barrier', stamp: host.request.stamp }).response), 'sdk.stale_request');
  assert.equal(editor.resources().host_requests, 1);
  editor.submit({ kind: 'set_selection', stamp: editor.capture(), selection: null });
  assert.equal(code(editor.completeHostRequest(host.request, { kind: 'barrier', stamp: host.request.stamp }).response), 'sdk.stale_request');
  const current = editor.captureHostRequest();
  assert.equal(editor.completeHostRequest(current.request, { kind: 'barrier', stamp: current.request.stamp }).response.status, 'ok');
  assert.equal(editor.resources().host_requests, 0); editor.destroy();
});

test('controller-only: accessors, cyclic/prototype/surrogate/integer/u64 inputs refuse before bridge call', async () => {
  const { editor, fixture } = await open(); let getters = 0;
  const accessor = Object.defineProperty({}, 'kind', { enumerable: true, get() { getters++; return 'command'; } });
  const cyclic = { kind: 'command' }; cyclic.self = cyclic;
  const invalid = [accessor, cyclic, Object.assign(new Date(), { kind: 'barrier' }), { kind: 'barrier', stamp: { ...editor.capture(), revision: '01' } }, { kind: 'barrier', stamp: { ...editor.capture(), revision: '18446744073709551616' } }, { kind: 'snapshot', stamp: editor.capture(), max_bytes: NaN }, { kind: 'snapshot', stamp: editor.capture(), max_bytes: 1.5 }, { ...mutation(editor), command: { id: 'fixture.insert', payload_json: '\ud800' } }];
  for (const request of invalid) assert.equal(editor.submit(request).response.status, 'refused');
  assert.equal(getters, 0); assert.equal(fixture.log.length, 0);
  assert.equal(code(editor.read({ kind: 'events' })), 'sdk.invalid_request_kind');
  editor.destroy();
});

test('controller-only: closed destroy payload cannot bypass exact decode through controller shortcut', async () => {
  const { editor, fixture } = await open(); const before = editor.capture();
  assert.equal(code(editor.submit({ kind: 'destroy', extra: true }).response), 'sdk.invalid_input');
  const host = editor.captureHostRequest();
  assert.equal(code(editor.completeHostRequest(host.request, { kind: 'destroy', stamp: host.request.stamp }).response), 'sdk.invalid_input');
  assert.equal(editor.lifecycle, 'ready'); assert.deepEqual(editor.capture(), before);
  assert.equal(fixture.log.length, 0); assert.equal(fixture.counts().live, 1);
  editor.destroy(); assert.equal(fixture.counts().live, 0);
});

test('controller-only: disposal during hostile Proxy input inspection stays disposed, not Fatal', async () => {
  const { editor, fixture } = await open();
  const request = new Proxy({ kind: 'state' }, { ownKeys(target) { editor.destroy(); return Reflect.ownKeys(target); } });
  assert.equal(code(editor.read(request)), 'sdk.disposed');
  assert.equal(editor.lifecycle, 'destroyed');
  assert.equal(fixture.log.length, 0); assert.deepEqual(fixture.counts(), { live: 0, destroyed: 1, freed: 1 });
});

test('controller-only: post-commit malformed transport and traps are fatal, never atomic refusal', async () => {
  for (const id of ['fixture.transport_failure', 'fixture.trap']) {
    const { editor, fixture } = await open(); let callbacks = 0;
    editor.subscribe(() => callbacks++);
    const outcome = editor.submit(mutation(editor, id));
    assert.equal(outcome.response.status, 'fatal');
    assert.equal(outcome.response.diagnostic.may_have_committed, true);
    assert.equal(editor.lifecycle, 'fatal'); assert.equal(callbacks, 0);
    assert.deepEqual(fixture.counts(), { live: 0, destroyed: 1, freed: 1 });
    assert.equal(code(editor.submit(mutation(editor)).response), 'sdk.fatal'); editor.destroy();
  }
});
