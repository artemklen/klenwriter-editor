// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as vanilla from '@klenwriter/editor';
import { kwdjBasicRenderers } from '@klenwriter/editor-kwdj/dom';
import { notesD0Renderers } from '../examples/notes-extension/dom.mjs';

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

test('the installed entry exposes lifecycle functions with declared DOM and UI runtime dependencies', async () => {
  for (const name of ['mount', 'update', 'subscribe', 'export', 'destroy']) {
    assert.equal(typeof vanilla[name], 'function', `Missing public lifecycle function ${name}`);
  }
  const entry = import.meta.resolve('@klenwriter/editor');
  const packageRoot = new URL('../', entry);
  const manifest = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));
  const declared = ['@klenwriter/editor-dom', '@klenwriter/editor-ui'];
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), declared);
  for (const path of Object.values(manifest.exports['.'])) {
    const emitted = await readFile(new URL(path, packageRoot), 'utf8');
    const imports = emitted.matchAll(/(?:from\s+|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/g);
    const dependencies = new Set(Array.from(imports, ([, specifier]) => specifier));
    assert.deepEqual([...dependencies].sort(), declared, path);
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
  const releaseFailure = await exportDocument(editor);
  assert.deepEqual(releaseFailure, {
    status: 'export_failed', stage: 'release', response: disposed, snapshotHandle: 'vanilla-snapshot',
  });

  editor.submit = request => {
    assert.deepEqual(request, { kind: 'release_snapshot', handle: 'vanilla-snapshot' });
    return completed(released);
  };
  assert.deepEqual(vanilla.update(editor, { kind: 'release_snapshot', handle: releaseFailure.snapshotHandle }), completed(released));
});

test('mode updates keep the other flag and commit only an accepted change', () => {
  const refused = {
    status: 'dom_refused',
    diagnostic: {
      code: 'dom.busy', phase: 'mode', stamp, node: null, typeId: null, publication: 'none',
    },
  };
  let blockDisabled = true;
  const editor = {
    submit() { assert.fail('Interaction options must not submit a document mutation'); },
    setInteractionMode(mode) {
      if (mode === 'disabled' && blockDisabled) return refused;
      return { status: 'updated', mode };
    },
  };
  assert.deepEqual(vanilla.update(editor, { readOnly: true }), { status: 'updated', mode: 'readOnly' });
  assert.equal(vanilla.update(editor, { disabled: true }), refused);
  assert.deepEqual(vanilla.update(editor, { readOnly: false }), { status: 'updated', mode: 'editable' });

  blockDisabled = false;
  assert.deepEqual(vanilla.update(editor, { readOnly: true, disabled: true }), { status: 'updated', mode: 'disabled' });
  assert.deepEqual(vanilla.update(editor, { disabled: false }), { status: 'updated', mode: 'readOnly' });
});

test('a mode change from a focus callback cannot interrupt disabling', () => {
  let ranFocusCallback = false;
  const editor = {
    capture: () => stamp,
    setInteractionMode(mode) {
      if (mode === 'disabled' && !ranFocusCallback) {
        // Blurring a disabled host can synchronously run an app callback.
        ranFocusCallback = true;
        const nested = vanilla.update(editor, { readOnly: true });
        assert.equal(nested.status, 'dom_refused');
        assert.equal(nested.diagnostic.code, 'dom.busy');
      }
      return { status: 'updated', mode };
    },
  };
  assert.deepEqual(vanilla.update(editor, { disabled: true }), { status: 'updated', mode: 'disabled' });
  assert.deepEqual(vanilla.update(editor, { disabled: false }), { status: 'updated', mode: 'editable' });
});

test('the package exports the shared surface CSS and documents all of its hooks', async () => {
  const entry = import.meta.resolve('@klenwriter/editor');
  const packageRoot = new URL('../', entry);
  const manifest = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));
  assert.equal(typeof manifest.exports['./style.css'], 'string', 'Missing public CSS subpath');

  const [stylesheet, sharedStylesheet, readme] = await Promise.all([
    readFile(new URL(import.meta.resolve('@klenwriter/editor/style.css')), 'utf8'),
    readFile(new URL('../packages/dom/src/style.css', import.meta.url), 'utf8'),
    readFile(new URL('README.md', packageRoot), 'utf8'),
  ]);
  assert.equal(stylesheet, sharedStylesheet);
  const declared = Array.from(stylesheet.matchAll(/^\s*(--[\w-]+):/gm), ([, property]) => property).sort();
  const documented = Array.from(readme.matchAll(/^\|\s*`(--[\w-]+)`\s*\|/gm), ([, property]) => property).sort();
  assert.deepEqual(declared, ['--editor-focus-color']);
  assert.deepEqual(documented, declared);
});

test('locale options preserve a headless mount and refuse unsupported requests', () => {
  const editor = {
    lifecycle: 'ready',
    setInteractionMode() { assert.fail('Locale changes must not change interaction mode'); },
  };
  assert.deepEqual(vanilla.update(editor, { locale: 'ru' }), {
    status: 'ui_refused', code: 'ui.unavailable', action: null,
  });
  assert.deepEqual(vanilla.update(editor, { locale: 'fr' }), {
    status: 'ui_refused', code: 'ui.invalid_options', action: null,
  });
  assert.deepEqual(vanilla.update(editor, { locale: 'en', disabled: true }), {
    status: 'ui_refused', code: 'ui.invalid_options', action: null,
  });
});

test('public alpha node types match the standalone subset of both renderer catalogs and the package guide', async () => {
  assert.ok(vanilla.alphaBlockTypes, 'Missing public alpha block map');
  const catalogs = [kwdjBasicRenderers, notesD0Renderers];
  const kwdjNodesOutsideAlpha = [
    'org.klenwriter.kwdj/disclosure',
    'org.klenwriter.kwdj/literary_block',
    'org.klenwriter.kwdj/spoiler',
    'org.klenwriter.kwdj/stanza_break',
    'org.klenwriter.kwdj/table',
    'org.klenwriter.kwdj/table_cell',
    'org.klenwriter.kwdj/table_header',
    'org.klenwriter.kwdj/table_row',
    'org.klenwriter.kwdj/verse',
    'org.klenwriter.kwdj/verse_line',
    'org.klenwriter.kwdj/warning',
  ];
  const allKwdjNodes = Object.keys(kwdjBasicRenderers.definition.nodes);
  assert.deepEqual(allKwdjNodes.filter(node => kwdjNodesOutsideAlpha.includes(node)).sort(), kwdjNodesOutsideAlpha);
  const rendered = Object.fromEntries(catalogs.map(({ definition }) => [
    definition.binding.profile.profile_id,
    Object.keys(definition.nodes).filter(node =>
      definition.binding.profile.profile_id !== 'org.klenwriter.kwdj' || !kwdjNodesOutsideAlpha.includes(node)
    ).sort(),
  ]));
  assert.deepEqual(vanilla.alphaBlockTypes, rendered);
  assert.equal(Object.isFrozen(vanilla.alphaBlockTypes), true);
  assert.ok(Object.values(vanilla.alphaBlockTypes).every(Object.isFrozen));

  const entry = import.meta.resolve('@klenwriter/editor');
  const readme = await readFile(new URL('../README.md', entry), 'utf8');
  const documented = {};
  for (const [, profile, node] of readme.matchAll(/^\|\s*`([\w.-]+)`\s*\|\s*`([\w.-]+\/[\w-]+)`\s*\|/gm)) {
    (documented[profile] ??= []).push(node);
  }
  assert.deepEqual(documented, rendered);
});
