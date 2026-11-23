// SPDX-License-Identifier: MIT OR Apache-2.0
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const vanillaEntry = fileURLToPath(new URL('../packages/vanilla/dist/index.js', import.meta.url));
const initialCanonical = readFileSync(new URL('../contracts/dom/v1/expected/D0.canonical.json', import.meta.url), 'utf8');
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

test.beforeEach(async ({ page, baseURL }) => {
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
<input id="before" aria-label="Before editor">
<div id="editor" aria-label="KlenWriter Editor"></div>
<input id="after" aria-label="After editor">`,
  }));
  await page.goto('/vanilla-lifecycle');

  await page.evaluate(async () => {
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
    window.vanillaFixture = { options, wasm, kwdjCommand };
  });
});

test('public vanilla lifecycle edits, exports and reopens on the same host after disposal', async ({ page }) => {
  expect(await page.evaluate(async () => {
    const api = await import('@klenwriter/editor');
    return Object.fromEntries(['mount', 'update', 'subscribe', 'export', 'destroy'].map(name => [name, typeof api[name]]));
  }), 'public vanilla lifecycle exports').toEqual({
    mount: 'function', update: 'function', subscribe: 'function', export: 'function', destroy: 'function',
  });

  const actual = await page.evaluate(async () => {
    const { mount, update, subscribe, export: exportDocument, destroy } = await import('@klenwriter/editor');
    const { options, wasm, kwdjCommand } = window.vanillaFixture;
    const { element } = options;
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

async function mountMode(page, flags) {
  const ready = await page.evaluate(async flags => {
    const api = await import('@klenwriter/editor');
    const { options } = window.vanillaFixture;
    const writes = [];
    const editor = api.mount({
      ...options, ...flags, clipboard: { writeText: async text => { writes.push(text); } },
    });
    const ready = await editor.ready;
    window.vanillaMode = { api, editor, element: options.element, root: options.element.firstElementChild, writes };
    return ready;
  }, flags);
  expect(ready).toMatchObject({ status: 'ready' });
}

async function documentCheckpoint(page) {
  return page.evaluate(async () => {
    const { api, editor, element, root } = window.vanillaMode;
    const exported = await api.export(editor);
    const { session, generation } = editor.capture();
    return {
      exported: exported.status === 'exported'
        ? { status: exported.status, canonicalJson: exported.canonicalJson, revision: exported.stamp.revision }
        : exported,
      session,
      generation,
      sameRoot: root !== null && element.firstElementChild === root,
      text: element.textContent,
    };
  });
}

async function changeMode(page, flags, mode) {
  expect(await page.evaluate(flags => {
    const { api, editor } = window.vanillaMode;
    return api.update(editor, flags);
  }, flags)).toEqual({ status: 'updated', mode });
}

async function expectNoUserEdit(page, editor, before) {
  await page.keyboard.type('mutation');
  const events = await editor.evaluate(element => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', 'Mutation from clipboard or drag');
    const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer });
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });
    element.dispatchEvent(paste);
    element.dispatchEvent(drop);
    return {
      paste: { prevented: paste.defaultPrevented, text: paste.clipboardData.getData('text/plain') },
      drop: { prevented: drop.defaultPrevented, text: drop.dataTransfer.getData('text/plain') },
    };
  });
  expect(events).toEqual({
    paste: { prevented: true, text: 'Mutation from clipboard or drag' },
    drop: { prevented: true, text: 'Mutation from clipboard or drag' },
  });
  expect(await documentCheckpoint(page)).toEqual(before);
}

async function disposeMode(page) {
  expect(await page.evaluate(async () => {
    const { api, editor } = window.vanillaMode;
    const receipt = api.destroy(editor);
    if (receipt.sdk.status === 'queued') await receipt.sdk.completion;
    return editor.nativeResources();
  })).toEqual(nativeEmpty);
  await expect(page.locator('#editor')).toBeEmpty();
}

test('public vanilla readOnly mode preserves the mounted document and allows selection and copy', async ({ page }) => {
  await mountMode(page, { readOnly: true });
  const editor = page.getByRole('textbox', { name: 'KlenWriter Editor' });
  await expect(editor).toHaveAttribute('aria-readonly', 'true');
  await expect(editor).toHaveAttribute('aria-disabled', 'false');
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  await editor.focus();
  await expect(editor).toBeFocused();
  const before = await documentCheckpoint(page);
  expect(before).toMatchObject({
    exported: { status: 'exported', canonicalJson: initialCanonical, revision: '0' },
    sameRoot: true,
  });
  await expectNoUserEdit(page, editor, before);

  const selectedText = await editor.evaluate(element => {
    const leaf = document.createTreeWalker(element.lastElementChild, NodeFilter.SHOW_TEXT).nextNode();
    const selection = getSelection();
    selection.setBaseAndExtent(leaf, 0, leaf, leaf.length);
    return selection.toString();
  });
  expect(selectedText).toBe('Бета');
  await expect.poll(() => page.evaluate(() => {
    const { editor } = window.vanillaMode;
    const result = editor.read({ kind: 'selection_text', stamp: editor.capture(), max_bytes: 64 });
    return result.status === 'ok' && result.value.kind === 'selection_text' ? result.value.text : null;
  })).toBe('Бета');
  const clipboard = await page.evaluate(async () => {
    const { editor, writes } = window.vanillaMode;
    return { outcome: await editor.clipboard.copy(), writes };
  });
  expect(clipboard).toEqual({
    outcome: { action: 'copy', status: 'copied', clipboard: 'confirmed', failure: null, submission: null },
    writes: ['Бета'],
  });
  expect(await documentCheckpoint(page)).toEqual(before);
  expect((await new AxeBuilder({ page }).include('#editor').analyze()).violations).toEqual([]);
  await disposeMode(page);
});

test('public vanilla disabled mode skips Tab and mode updates reuse the root and session', async ({ page }) => {
  await mountMode(page, { disabled: true });
  const editor = page.getByRole('textbox', { name: 'KlenWriter Editor' });
  const beforeField = page.getByRole('textbox', { name: 'Before editor' });
  const afterField = page.getByRole('textbox', { name: 'After editor' });
  await expect(editor).toHaveAttribute('aria-disabled', 'true');
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  const before = await documentCheckpoint(page);
  expect(before).toMatchObject({
    exported: { status: 'exported', canonicalJson: initialCanonical, revision: '0' },
    sameRoot: true,
  });
  await beforeField.focus();
  await page.keyboard.press('Tab');
  await expect(afterField).toBeFocused();
  await expectNoUserEdit(page, editor, before);
  await expect(afterField).toHaveValue('mutation');
  expect((await new AxeBuilder({ page }).include('#editor').analyze()).violations).toEqual([]);

  await changeMode(page, { readOnly: true }, 'disabled');
  await changeMode(page, { disabled: false }, 'readOnly');
  await expect(editor).toHaveAttribute('aria-disabled', 'false');
  await expect(editor).toHaveAttribute('aria-readonly', 'true');
  await expect(editor).toHaveAttribute('tabindex', '0');
  await editor.focus();
  await expect(editor).toBeFocused();
  await expectNoUserEdit(page, editor, before);
  await changeMode(page, { disabled: true }, 'disabled');
  await expect(editor).toHaveAttribute('aria-disabled', 'true');
  await beforeField.focus();
  await page.keyboard.press('Tab');
  await expect(afterField).toBeFocused();
  await expectNoUserEdit(page, editor, before);
  await changeMode(page, { disabled: false }, 'readOnly');
  await changeMode(page, { readOnly: false }, 'editable');
  await expect(editor).toHaveAttribute('aria-readonly', 'false');
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  expect(await documentCheckpoint(page)).toEqual(before);
  await disposeMode(page);
});

test('public vanilla restores the public mounted read-only mode after disabling', async ({ page }) => {
  await mountMode(page, {});
  const editor = page.getByRole('textbox', { name: 'KlenWriter Editor' });
  const before = await documentCheckpoint(page);
  expect(before).toMatchObject({
    exported: { status: 'exported', canonicalJson: initialCanonical, revision: '0' },
    sameRoot: true,
  });
  expect(await page.evaluate(() => window.vanillaMode.editor.setInteractionMode('readOnly')))
    .toEqual({ status: 'updated', mode: 'readOnly' });
  await expect(editor).toHaveAttribute('aria-readonly', 'true');
  await changeMode(page, { disabled: true }, 'disabled');
  await expect(editor).toHaveAttribute('aria-disabled', 'true');
  await changeMode(page, { disabled: false }, 'readOnly');
  await expect(editor).toHaveAttribute('aria-disabled', 'false');
  await expect(editor).toHaveAttribute('aria-readonly', 'true');
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  expect(await documentCheckpoint(page)).toEqual(before);
  await disposeMode(page);
});

test('public vanilla rejects a reentrant mode update from the disabled transition blur', async ({ page }) => {
  await mountMode(page, {});
  const editor = page.getByRole('textbox', { name: 'KlenWriter Editor' });
  const before = await documentCheckpoint(page);
  expect(before).toMatchObject({
    exported: { status: 'exported', canonicalJson: initialCanonical, revision: '0' },
    sameRoot: true,
  });
  await editor.focus();
  await expect(editor).toBeFocused();
  const transition = await page.evaluate(() => {
    const { api, editor, element } = window.vanillaMode;
    let returned = false;
    const calls = [];
    element.addEventListener('blur', () => {
      calls.push({ synchronous: !returned, result: api.update(editor, { readOnly: true }) });
    }, { once: true });
    const outer = api.update(editor, { disabled: true });
    returned = true;
    return { outer, calls };
  });
  expect(transition).toMatchObject({
    outer: { status: 'updated', mode: 'disabled' },
    calls: [{ synchronous: true, result: { status: 'dom_refused', diagnostic: { code: 'dom.busy' } } }],
  });
  await expect(editor).toHaveAttribute('aria-disabled', 'true');
  await expect(editor).toHaveAttribute('tabindex', '-1');
  await page.getByRole('textbox', { name: 'Before editor' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox', { name: 'After editor' })).toBeFocused();

  await changeMode(page, { readOnly: true }, 'disabled');
  await changeMode(page, { disabled: false }, 'readOnly');
  await expect(editor).toHaveAttribute('aria-disabled', 'false');
  await expect(editor).toHaveAttribute('aria-readonly', 'true');
  expect(await documentCheckpoint(page)).toEqual(before);
  await disposeMode(page);
});
