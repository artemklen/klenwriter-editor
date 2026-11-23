// SPDX-License-Identifier: MIT OR Apache-2.0
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const vanillaEntry = fileURLToPath(new URL('../packages/vanilla/dist/index.js', import.meta.url));
const expectedCanonical = readFileSync(new URL('../contracts/dom/v1/expected/T04-X.canonical.json', import.meta.url), 'utf8');
const nativeEmpty = { sessions: 0, snapshot_handles: 0, snapshot_bytes: '0', protected_cursors: 0 };
const importMap = JSON.stringify({ imports: {
  '@klenwriter/editor': '/packages/vanilla/index.js',
  '@klenwriter/editor-wasm': '/packages/wasm/index.js',
  '@klenwriter/editor-sdk': '/packages/sdk/index.js',
  '@klenwriter/editor-dom': '/packages/dom/index.js',
  '@klenwriter/editor-kwdj': '/packages/kwdj/index.js',
  '@klenwriter/editor-kwdj/dom': '/packages/kwdj/dom.js',
} });
const importMapHash = createHash('sha256').update(importMap).digest('base64');

test('public vanilla lifecycle edits, exports and reopens on the same host after disposal', async ({ page, baseURL }) => {
  // Keep the existing source-bound fixture intact. Serve the vanilla entry
  // from its compiled file and all shared artifacts from the real workspace server.
  await page.route(`${baseURL}/packages/vanilla/index.js`, route => route.fulfill({
    path: vanillaEntry,
    contentType: 'text/javascript',
  }));
  await page.route(`${baseURL}/vanilla-lifecycle`, route => route.fulfill({
    contentType: 'text/html',
    headers: {
      'content-security-policy': `default-src 'none'; script-src 'self' 'wasm-unsafe-eval' 'sha256-${importMapHash}'; style-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'`,
    },
    body: `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Vanilla lifecycle</title>
<link rel="stylesheet" href="/style.css">
<script type="importmap">${importMap}</script>
<div id="editor" aria-label="KlenWriter Editor"></div>`,
  }));
  await page.goto('/vanilla-lifecycle');
  expect(await page.evaluate(async () => {
    const api = await import('@klenwriter/editor');
    return Object.fromEntries(['mount', 'update', 'subscribe', 'export', 'destroy'].map(name => [name, typeof api[name]]));
  }), 'public vanilla lifecycle exports').toEqual({
    mount: 'function', update: 'function', subscribe: 'function', export: 'function', destroy: 'function',
  });

  const actual = await page.evaluate(async () => {
    const { mount, update, subscribe, export: exportDocument, destroy } = await import('@klenwriter/editor');
    const { loadSdkV2, sdkBuildId } = await import('@klenwriter/editor-sdk');
    const { kwdjCommand } = await import('@klenwriter/editor-kwdj');
    const { kwdjBasicRenderers } = await import('@klenwriter/editor-kwdj/dom');
    const [wasm, packetResponse, inputResponse] = await Promise.all([
      loadSdkV2(), fetch('/extensions-packet.json'), fetch('/dom-fixtures/inputs/D0.json'),
    ]);
    if (!packetResponse.ok || !inputResponse.ok) throw new Error('Vanilla lifecycle fixture unavailable');
    const packet = await packetResponse.json();
    const initialInput = new Uint8Array(await inputResponse.arrayBuffer());
    const element = document.querySelector('#editor');
    const options = {
      element,
      editor: {
        input: initialInput,
        options: {
          abi: 'editor-sdk/2',
          build_id: sdkBuildId,
          profile: packet.kwdjProfile,
          admission: 'validate',
          access: 'editable',
          registry_json: packet.kwdjRegistryJson,
          profile_options_json: JSON.stringify({ identities: { media: [], references: [] }, limits: null }),
        },
      },
      renderers: kwdjBasicRenderers,
    };

    const settle = async submission => {
      if (submission.status === 'completed') return submission.response;
      if (submission.status === 'queued') return submission.completion;
      throw new Error(`Unexpected submission: ${JSON.stringify(submission)}`);
    };
    const value = (reply, kind) => {
      if (reply.status !== 'ok' || reply.value.kind !== kind) {
        throw new Error(`Expected ${kind}: ${JSON.stringify(reply)}`);
      }
      return reply.value;
    };
    const disposal = async editor => {
      const receipt = destroy(editor);
      value(await settle(receipt.sdk), 'destroyed');
      return {
        status: receipt.status,
        sameReceipt: destroy(editor) === receipt,
        recovery: receipt.recovery,
        callbackFailure: receipt.callbackFailure,
        lifecycle: editor.lifecycle,
        resources: editor.resources(),
        native: editor.nativeResources(),
        sameHost: element === document.querySelector('#editor'),
        emptyHost: element.childNodes.length === 0,
        editableAttribute: element.getAttribute('contenteditable'),
      };
    };

    const baseline = JSON.parse(wasm.resourceCounts());
    const editor = mount(options);
    const ready = await editor.ready;
    if (ready.status !== 'ready') throw new Error(`Mount failed: ${JSON.stringify(ready)}`);
    const mountedStamp = editor.capture();
    const rootId = value(editor.read({ kind: 'state' }), 'state').state.root;
    const root = value(editor.read({ kind: 'node', stamp: mountedStamp, node: rootId }), 'node').node;
    const paragraph = value(editor.read({ kind: 'node', stamp: mountedStamp, node: root.children[0] }), 'node').node;
    const documentEvents = [];
    const subscription = subscribe(editor, event => {
      if (event.change.kind === 'document') {
        documentEvents.push({ from: event.before.revision, to: event.after.revision, text: element.textContent });
      }
    });
    if (typeof subscription !== 'function') throw new Error(`Subscribe failed: ${JSON.stringify(subscription)}`);

    element.focus();
    const point = { kind: 'text', node: paragraph.children[2], offset: 2, affinity: 'after' };
    value(await settle(update(editor, {
      kind: 'set_selection', stamp: editor.capture(), selection: { anchor: point, focus: point },
    })), 'mutation');
    const updated = value(await settle(update(editor, {
      kind: 'command', stamp: editor.capture(), command: kwdjCommand({ kind: 'insert_text', text: 'X' }),
      history_hint: { kind: 'isolated' },
    })), 'mutation');
    const nativeBeforeExport = editor.nativeResources();
    const exported = await exportDocument(editor);
    if (exported.status !== 'exported') throw new Error(`Export failed: ${JSON.stringify(exported)}`);
    const nativeAfterExport = editor.nativeResources();
    const live = editor.resources();
    const disposed = await disposal(editor);

    const reopened = mount({
      ...options,
      editor: { ...options.editor, input: new TextEncoder().encode(exported.canonicalJson) },
    });
    const reopenedReady = await reopened.ready;
    if (reopenedReady.status !== 'ready') throw new Error(`Remount failed: ${JSON.stringify(reopenedReady)}`);
    const remount = {
      stamp: reopened.capture(),
      exported: await exportDocument(reopened),
      text: element.textContent,
      sameHost: element === document.querySelector('#editor'),
    };
    const final = await disposal(reopened);
    return {
      baseline, mountedStamp, updatedStamp: updated.state.stamp, documentEvents, exported,
      nativeBeforeExport, nativeAfterExport, live, disposed, remount, final, nativeFinal: JSON.parse(wasm.resourceCounts()),
    };
  });

  const editedText = 'А😀 e\u0301\u00a0ZXБета';
  expect(actual.baseline).toEqual(nativeEmpty);
  expect(actual.mountedStamp.revision).toBe('0');
  expect(actual.updatedStamp.revision).toBe('1');
  expect(actual.documentEvents).toEqual([{ from: '0', to: '1', text: editedText }]);
  expect(actual.exported).toEqual({ status: 'exported', canonicalJson: expectedCanonical, stamp: actual.updatedStamp });
  expect(actual.nativeBeforeExport).toEqual({ ...nativeEmpty, sessions: 1, protected_cursors: 1 });
  expect(actual.nativeAfterExport).toEqual(actual.nativeBeforeExport);
  expect(actual.live.dom.listeners).toBeGreaterThan(0);
  expect(actual.live.sdk.listeners).toBeGreaterThanOrEqual(2);
  expect(actual.live.sdk.sessions).toBe(1);
  for (const disposed of [actual.disposed, actual.final]) {
    expect(disposed).toMatchObject({
      status: 'destroy_requested',
      sameReceipt: true,
      recovery: null,
      callbackFailure: null,
      lifecycle: 'destroyed',
      resources: {
        dom: { listeners: 0, observers: 0, continuations: 0, retainedInputBytes: 0, retainedRecoveryRegions: 0 },
        sdk: { listeners: 0, sessions: 0, queued_mutations: 0, pending_tickets: 0 },
      },
      native: nativeEmpty,
      sameHost: true,
      emptyHost: true,
      editableAttribute: null,
    });
  }
  expect(actual.remount.sameHost).toBe(true);
  expect(actual.remount.stamp.session).not.toBe(actual.mountedStamp.session);
  expect(actual.remount.stamp.revision).toBe('0');
  expect(actual.remount.text).toBe(editedText);
  expect(actual.remount.exported).toEqual({
    status: 'exported', canonicalJson: expectedCanonical, stamp: actual.remount.stamp,
  });
  expect(actual.nativeFinal).toEqual(nativeEmpty);
});
