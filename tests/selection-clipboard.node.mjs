// SPDX-License-Identifier: MIT OR Apache-2.0
// Controlled platform/SDK callback ownership only, never native range/OS proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { attachClipboard } from '../packages/dom/dist/clipboard.js';
import { deferred } from './helpers/sdk-fake.mjs';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const mutation = () => ({ status: 'ok', value: { kind: 'mutation', effect: 'changed', state: {}, presentation: { active: 'none' } } });
function fixture(extra = {}) {
  const write = deferred(), textNode = {}, requests = [], notifications = [], reports = [], payloads = [];
  let intent = 0n;
  let current = { stamp: { session: 'controlled', generation: '1', revision: '0', selection_epoch: '1', history_epoch: '0' },
    selection: { anchor: { kind: 'text', node: 'L', offset: 1, affinity: 'after' }, focus: { kind: 'text', node: 'R', offset: 1, affinity: 'after' } } };
  const context = { build_id: 'controlled', profile: {}, registry_digest: 'a'.repeat(64), capability_digest: 'b'.repeat(64) };
  const element = new EventTarget(); element.isConnected = true;
  element.contains = candidate => candidate === element || candidate === textNode;
  const doc = { activeElement: element, hasFocus: () => true, getSelection: () => ({ anchorNode: textNode, focusNode: textNode }),
    defaultView: { navigator: {}, setTimeout: extra.timer ?? setTimeout, clearTimeout } };
  element.ownerDocument = doc;
  const dto = { id: 'org.klenwriter.kwdj/command/delete-selection', payload_json: '{"kind":"delete_selection"}' };
  const owner = attachClipboard({ element, view: { readSelection: () => current.selection },
    bindings: { deleteSelection: () => dto }, capture: () => current.stamp, context: () => context,
    readState: () => current, intent: () => intent,
    read: request => ({ status: 'ok', value: { kind: 'selection_text', stamp: request.stamp, selection: current.selection,
      projection_id: 'org.klenwriter.kwdj/selection-text/1', text: extra.text ?? 'b\nc', empty: extra.empty ?? false, selected_atoms: extra.atoms ?? [] } }),
    query: request => extra.query?.(request) ?? ({ status: 'ok', value: { kind: 'availability', available: true, effect: 'changed', presentation: { active: 'none' }, diagnostic: null } }),
    submit: request => { requests.push(structuredClone(request)); return extra.submit?.(request) ?? { status: 'completed', response: mutation() }; },
    guard: action => extra.guard?.(action) ?? null,
    report: value => reports.push(value),
    ...(extra.missingWriter ? {} : { writeText: text => { payloads.push(text); return extra.write?.(text) ?? write.promise; } }),
    onResult: value => { notifications.push(value); extra.onResult?.(value, owner); },
  });
  return { owner, write, dto, requests, notifications, reports, payloads,
    newIntent() { intent++; },
    newRevision() { current = { ...current, stamp: { ...current.stamp, revision: '1' } }; },
    newSelection() { current = { ...current, stamp: { ...current.stamp, selection_epoch: '2' }, selection: { ...current.selection, focus: { ...current.selection.focus, offset: 2 } } }; },
  };
}
const zero = { pending: 0, continuations: 0, retainedTextBytes: 0 };

test('clipboard controlled CP01/03: confirmed writer then one isolated native ticket; notifications after cleanup', async () => {
  for (const action of ['copy', 'cut']) {
    const f = fixture({ onResult: (_result, owner) => assert.deepEqual(owner.resources(), zero) });
    try {
      const result = f.owner[action](); assert.deepEqual(f.payloads, ['b\nc']); assert.equal(f.requests.length, 0);
      f.write.resolve(); const receipt = await result;
      assert.equal(receipt.status, action === 'copy' ? 'copied' : 'cut'); assert.equal(receipt.clipboard, 'confirmed');
      assert.equal(f.requests.length, action === 'copy' ? 0 : 1);
      if (action === 'cut') assert.deepEqual(f.requests[0].history_hint, { kind: 'isolated' });
      assert.deepEqual(f.owner.resources(), zero); assert.equal(f.notifications.length, 1);
    } finally { f.owner.destroy(); }
  }
});

test('clipboard controlled CP05/08: semantic empty skips write; atom-only empty text still writes and cuts', async () => {
  const empty = fixture({ empty: true, text: '' });
  assert.equal((await empty.owner.cut()).status, 'empty'); assert.deepEqual(empty.payloads, []); empty.owner.destroy();
  const atom = fixture({ text: '', atoms: ['S'] });
  const result = atom.owner.cut(); assert.deepEqual(atom.payloads, ['']); atom.write.resolve();
  assert.equal((await result).status, 'cut'); assert.equal(atom.requests.length, 1); atom.owner.destroy();
});

test('clipboard controlled CP07/11: unavailable query and failed writer never delete', async () => {
  const native = { status: 'ok', value: { kind: 'availability', available: false, effect: null, presentation: null,
    diagnostic: { code: 'position.invalid', path: '', category: 'sdk', details: {}, stamp: null, may_have_committed: false } } };
  const unavailable = fixture({ query: () => native });
  const refused = await unavailable.owner.cut(); assert.equal(refused.status, 'refused'); assert.equal(refused.failure.response, native);
  assert.equal(unavailable.payloads.length, 0); assert.equal(unavailable.requests.length, 0); unavailable.owner.destroy();
  const failed = fixture(); const pending = failed.owner.cut(); failed.write.reject(new Error('controlled platform failure'));
  const result = await pending; assert.equal(result.status, 'write_failed'); assert.equal(result.clipboard, 'unconfirmed');
  assert.equal(failed.requests.length, 0); assert.deepEqual(failed.owner.resources(), zero); failed.owner.destroy();
});

test('clipboard controlled CP12: missing platform writer refuses before dispatch and retains nothing', async () => {
  const f = fixture({ missingWriter: true });
  try {
    const result = await f.owner.cut();
    assert.equal(result.status, 'refused'); assert.equal(result.clipboard, 'not_attempted');
    assert.equal(result.failure.diagnostic.code, 'dom.clipboard_unavailable');
    assert.deepEqual(f.payloads, []); assert.deepEqual(f.requests, []);
    assert.deepEqual(f.owner.resources(), zero);
  } finally { f.owner.destroy(); }
});

test('clipboard controlled CP19: preserve completed native refusal after confirmed platform ACK', async () => {
  const response = { status: 'refused', diagnostic: { code: 'session.stale_revision', path: 'stamp.revision',
    category: 'sdk', details: {}, stamp: null, may_have_committed: false } };
  const submission = { status: 'completed', response };
  const f = fixture({ submit: () => submission });
  try {
    const pending = f.owner.cut(); assert.equal(f.requests.length, 0); f.write.resolve();
    const result = await pending;
    assert.equal(result.status, 'copied_but_not_cut'); assert.equal(result.clipboard, 'confirmed');
    assert.equal(result.failure.response, response); assert.equal(result.submission, submission);
    assert.equal(f.requests.length, 1); assert.deepEqual(f.owner.resources(), zero);
  } finally { f.owner.destroy(); }
});

for (const method of ['newIntent', 'newSelection', 'newRevision']) test(`clipboard controlled CP13/14/15: ${method} before confirmed completion cannot retarget cut`, async () => {
  const f = fixture();
  try {
    const pending = f.owner.cut(); f[method](); f.write.resolve(); const result = await pending;
    assert.equal(result.status, 'copied_but_not_cut'); assert.equal(result.clipboard, 'confirmed');
    assert.equal(result.failure.diagnostic.code, 'dom.stale_selection'); assert.equal(f.requests.length, 0);
    assert.deepEqual(f.owner.resources(), zero);
  } finally { f.owner.destroy(); }
});

test('clipboard controlled CP16/25: cancelled write has unknown external outcome, no late cut or callback', async () => {
  for (const destroy of [false, true]) {
    const f = fixture(); const pending = f.owner.cut();
    if (destroy) f.owner.destroy(); else f.owner.cancel('dom.stale_selection');
    const result = await pending; assert.equal(result.status, 'write_failed'); assert.equal(result.clipboard, 'unconfirmed');
    assert.equal(result.failure.diagnostic.code, destroy ? 'dom.disposed' : 'dom.stale_selection');
    assert.deepEqual(f.owner.resources(), zero); const calls = f.notifications.length;
    f.write.resolve(); await tick(); assert.equal(f.requests.length, 0); assert.equal(f.notifications.length, calls);
    if (destroy) assert.equal(calls, 0); f.owner.destroy();
  }
});

test('clipboard controlled CP17: deadline drops retention without claiming the external write failed atomically', async () => {
  const f = fixture({ timer: (callback, milliseconds) => { assert.equal(milliseconds, 15000); return setTimeout(callback, 0); } });
  try {
    const result = await f.owner.cut(); assert.equal(result.status, 'write_failed'); assert.equal(result.clipboard, 'unconfirmed');
    assert.equal(result.failure.diagnostic.code, 'dom.clipboard_timeout'); assert.equal(f.requests.length, 0); assert.deepEqual(f.owner.resources(), zero);
    f.write.resolve(); await tick(); assert.equal(f.requests.length, 0);
  } finally { f.owner.destroy(); }
});

test('clipboard controlled CP20/21/22: keep actual queued promise/terminal response and fatal provenance', async () => {
  for (const terminal of ['changed', 'refused', 'fatal']) {
    const completion = deferred(), submission = { status: 'queued', completion: completion.promise };
    const f = fixture({ submit: () => submission });
    try {
      const pending = f.owner.cut(); f.write.resolve(); await tick(); assert.equal(f.requests.length, 1);
      const response = terminal === 'changed' ? mutation() : { status: terminal, diagnostic: { code: terminal === 'fatal' ? 'sdk.transport_failure' : 'session.stale_revision',
        path: terminal === 'fatal' ? '' : 'stamp.revision', category: terminal === 'fatal' ? 'transport' : 'sdk', details: {}, stamp: null, may_have_committed: terminal === 'fatal' } };
      completion.resolve(response); const result = await pending;
      assert.equal(result.submission, submission); assert.equal(result.submission.completion, completion.promise);
      assert.equal(result.status, terminal === 'changed' ? 'cut' : terminal === 'fatal' ? 'indeterminate' : 'copied_but_not_cut');
      if (terminal !== 'changed') assert.equal(result.failure.response, response);
      assert.deepEqual(f.owner.resources(), zero); assert.equal(f.requests.length, 1);
    } finally { f.owner.destroy(); }
  }
});

test('clipboard controlled CP23/24: observer throws cannot alter cut; busy second request retains first payload', async () => {
  const f = fixture({ onResult: () => { throw new Error('controlled host callback'); } });
  try {
    const first = f.owner.cut(), second = await f.owner.copy();
    assert.equal(second.status, 'refused'); assert.equal(second.failure.diagnostic.code, 'dom.busy');
    assert.deepEqual(f.owner.resources(), { pending: 1, continuations: 1, retainedTextBytes: 3 });
    assert.deepEqual(f.payloads, ['b\nc']); f.write.resolve(); assert.equal((await first).status, 'cut');
    assert.deepEqual(f.owner.resources(), zero); assert.equal(f.requests.length, 1);
  } finally { f.owner.destroy(); }
});

test('clipboard controlled: constructor-owned command cannot be changed by writer while awaiting completion', async () => {
  const f = fixture();
  try {
    const result = f.owner.cut(); f.dto.id = 'org.klenwriter.kwdj/command/dismiss-slash'; f.dto.payload_json = '{"kind":"dismiss_slash"}';
    f.write.resolve(); assert.equal((await result).status, 'cut');
    assert.deepEqual(f.requests[0].command, { id: 'org.klenwriter.kwdj/command/delete-selection', payload_json: '{"kind":"delete_selection"}' });
  } finally { f.owner.destroy(); }
});
