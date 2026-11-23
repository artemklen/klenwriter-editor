// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as vanilla from '@klenwriter/editor';

const stamp = Object.freeze({
  session: 'vanilla-test', generation: '1', revision: '1', selection_epoch: '0', history_epoch: '1',
});
const snapshot = {
  status: 'ok',
  value: {
    kind: 'snapshot', handle: 'vanilla-snapshot', canonical_json: '{"text":"Привет"}',
    stamp, event_sequence: '1',
    profile: {
      profile_id: 'org.example.notes', profile_version: '1.0.0',
      codec_id: 'org.example.notes/json', wire_version: 1, extensions: [],
    },
  },
};
const released = { status: 'ok', value: { kind: 'released' } };
const completed = response => ({ status: 'completed', response });

function exportDocument(editor, options) {
  assert.equal(typeof vanilla.export, 'function', 'The public package must expose export');
  return vanilla.export(editor, options);
}

test('the installed entry exposes lifecycle functions with editor-dom as its runtime dependency', async () => {
  for (const name of ['mount', 'update', 'subscribe', 'export', 'destroy']) {
    assert.equal(typeof vanilla[name], 'function', `Missing public lifecycle function ${name}`);
  }
  const entry = import.meta.resolve('@klenwriter/editor');
  const packageRoot = new URL('../', entry);
  const manifest = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));
  assert.deepEqual(Object.keys(manifest.dependencies), ['@klenwriter/editor-dom']);
  for (const path of Object.values(manifest.exports['.'])) {
    const emitted = await readFile(new URL(path, packageRoot), 'utf8');
    const imports = emitted.matchAll(/(?:from\s+|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/g);
    const dependencies = new Set(Array.from(imports, ([, specifier]) => specifier));
    assert.deepEqual([...dependencies], ['@klenwriter/editor-dom'], path);
  }
});

test('export waits for a queued snapshot and release before returning canonical text', async () => {
  const pendingSnapshot = Promise.withResolvers();
  const pendingRelease = Promise.withResolvers();
  const releaseRequested = Promise.withResolvers();
  const requests = [];
  const editor = {
    capture: () => stamp,
    submit(request) {
      requests.push(request);
      if (request.kind === 'snapshot') return { status: 'queued', completion: pendingSnapshot.promise };
      releaseRequested.resolve();
      return { status: 'queued', completion: pendingRelease.promise };
    },
  };
  let finished = false;
  const result = exportDocument(editor, { maxBytes: 64 }).then(value => {
    finished = true;
    return value;
  });
  pendingSnapshot.resolve(snapshot);
  await Promise.race([releaseRequested.promise, result]);
  assert.deepEqual(requests, [
    { kind: 'snapshot', stamp, max_bytes: 64 },
    { kind: 'release_snapshot', handle: 'vanilla-snapshot' },
  ]);
  assert.equal(finished, false);
  pendingRelease.resolve(released);
  assert.deepEqual(await result, { status: 'exported', canonicalJson: '{"text":"Привет"}', stamp });
});

test('export can use the readable native stamp when the view no longer has a capture', async () => {
  const state = {
    stamp, root: 'vanilla-root', selection: null, stored_marks: null, dirty: true, saved_revision: '0',
    history: { undo_entries: '1', redo_entries: '0', retained_bytes: '12' },
  };
  const requests = [];
  const editor = {
    capture: () => null,
    read(request) {
      assert.deepEqual(request, { kind: 'state' });
      return { status: 'ok', value: { kind: 'state', state } };
    },
    submit(request) {
      requests.push(request);
      return completed(request.kind === 'snapshot' ? snapshot : released);
    },
  };
  assert.equal((await exportDocument(editor)).status, 'exported');
  assert.deepEqual(requests, [
    { kind: 'snapshot', stamp, max_bytes: 16_777_216 },
    { kind: 'release_snapshot', handle: 'vanilla-snapshot' },
  ]);
});

test('export preserves the original refusal at the failed step', async () => {
  const disposed = {
    status: 'dom_refused',
    diagnostic: {
      code: 'dom.disposed', phase: 'command', stamp: null, node: null, typeId: null, publication: 'none',
    },
  };
  const editor = {
    capture: () => null,
    read: () => disposed,
    submit() { assert.fail('Export without a stamp must not submit a snapshot'); },
  };
  assert.deepEqual(await exportDocument(editor), { status: 'export_failed', stage: 'capture', response: disposed });

  const snapshotRefusal = {
    status: 'refused',
    diagnostic: {
      code: 'snapshot.limit', category: 'resource_limit', path: '/snapshot',
      details: {}, stamp, may_have_committed: false,
    },
  };
  const requests = [];
  editor.capture = () => stamp;
  editor.submit = request => {
    requests.push(request.kind);
    return completed(snapshotRefusal);
  };
  assert.deepEqual(await exportDocument(editor, { maxBytes: 1 }), {
    status: 'export_failed', stage: 'snapshot', response: snapshotRefusal,
  });
  assert.deepEqual(requests, ['snapshot']);

  editor.submit = request => request.kind === 'snapshot' ? completed(snapshot) : disposed;
  assert.deepEqual(await exportDocument(editor), { status: 'export_failed', stage: 'release', response: disposed });
});
