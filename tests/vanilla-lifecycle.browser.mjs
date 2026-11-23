// SPDX-License-Identifier: MIT OR Apache-2.0
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { canonicalizeRaw } from '../scripts/canonical-reference/reference.mjs';

const vanillaEntry = fileURLToPath(new URL('../packages/vanilla/dist/index.js', import.meta.url));
const initialCanonical = readFileSync(new URL('../contracts/dom/v1/expected/D0.canonical.json', import.meta.url), 'utf8');
const expectedCanonical = readFileSync(new URL('../contracts/dom/v1/expected/T04-X.canonical.json', import.meta.url), 'utf8');
const nativeEmpty = { sessions: 0, snapshot_handles: 0, snapshot_bytes: '0', protected_cursors: 0 };
const importMap = JSON.stringify({ imports: {
  '@klenwriter/editor': '/packages/vanilla/index.js',
  '@klenwriter/editor-wasm': '/packages/wasm/index.js',
  '@klenwriter/editor-sdk': '/packages/sdk/index.js',
  '@klenwriter/editor-dom': '/packages/dom/index.js',
  '@klenwriter/editor-ui': '/packages/ui/index.js',
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
    window.vanillaFixture = { options, wasm, kwdjCommand, packet };
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

test('public vanilla stylesheet supports a host focus theme without remounting', async ({ page, baseURL }) => {
  const asset = fileURLToPath(import.meta.resolve('@klenwriter/editor/style.css'));
  const stylesheet = '/packages/vanilla/style.css';
  const hostTheme = '/vanilla-host-theme.css';
  await page.route(`${baseURL}${stylesheet}`, route => route.fulfill({ path: asset, contentType: 'text/css' }));
  await page.route(`${baseURL}${hostTheme}`, route => route.fulfill({
    contentType: 'text/css',
    body: '#editor { --editor-focus-color: rgb(12, 34, 56) }',
  }));
  await page.locator('link[href="/style.css"]').evaluate(link => link.remove());
  await page.addStyleTag({ url: stylesheet });

  await mountMode(page, {});
  const editor = page.getByRole('textbox', { name: 'KlenWriter Editor' });
  const before = await documentCheckpoint(page);
  expect(before).toMatchObject({
    exported: { status: 'exported', canonicalJson: initialCanonical, revision: '0' },
    sameRoot: true,
  });
  await page.getByRole('textbox', { name: 'Before editor' }).focus();
  await page.evaluate(() => {
    document.addEventListener('keydown', event => {
      window.vanillaMode.tab = { key: event.key, trusted: event.isTrusted, target: event.target.id };
    }, { capture: true, once: true });
  });
  await page.keyboard.press('Tab');
  await expect(editor).toBeFocused();
  expect(await page.evaluate(() => window.vanillaMode.tab)).toEqual({ key: 'Tab', trusted: true, target: 'before' });

  const outline = () => editor.evaluate(element => {
    const style = getComputedStyle(element);
    return {
      visible: element.matches(':focus-visible'),
      style: style.outlineStyle,
      width: style.outlineWidth,
      offset: style.outlineOffset,
      color: style.outlineColor,
    };
  });
  const initial = await outline();
  expect(initial).toMatchObject({ visible: true, style: 'solid', width: '2px', offset: '2px' });
  expect(initial.color).not.toBe('rgb(12, 34, 56)');
  await page.addStyleTag({ url: hostTheme });
  expect(await outline()).toEqual({ ...initial, color: 'rgb(12, 34, 56)' });
  await expect(editor).toBeFocused();
  expect(await documentCheckpoint(page)).toEqual(before);
  await disposeMode(page);
});

async function mountLocaleUi(page, locale, withDialog = false) {
  await page.addStyleTag({ url: '/ui-style.css' });
  const initial = await page.evaluate(async ({ locale, withDialog }) => {
    const api = await import('@klenwriter/editor');
    const { defineUiHostAction } = await import('@klenwriter/editor-ui');
    const { options, kwdjCommand } = window.vanillaFixture;
    const { element } = options;
    const slots = Object.fromEntries(['toolbar', 'gutter', 'entry'].map(name => {
      const slot = document.createElement('div');
      slot.id = `vanilla-ui-${name}`;
      element.after(slot);
      return [name, slot];
    }));
    const slotListeners = [];
    let listenerAdditions = 0;
    const capture = options => typeof options === 'boolean' ? options : Boolean(options?.capture);
    for (const slot of Object.values(slots)) {
      // Observe native registrations on these test-owned slots without replacing the listeners.
      const add = slot.addEventListener.bind(slot);
      const remove = slot.removeEventListener.bind(slot);
      const find = (event, callback, capturing) => slotListeners.findIndex(listener =>
        listener.slot === slot && listener.event === event && listener.callback === callback && listener.capturing === capturing);
      slot.addEventListener = (event, callback, options) => {
        add(event, callback, options);
        const capturing = capture(options);
        if (find(event, callback, capturing) === -1) {
          listenerAdditions++;
          slotListeners.push({ slot, event, callback, capturing });
        }
      };
      slot.removeEventListener = (event, callback, options) => {
        remove(event, callback, options);
        const index = find(event, callback, capture(options));
        if (index !== -1) slotListeners.splice(index, 1);
      };
    }
    const toolbar = [];
    const dialogCloses = [];
    if (withDialog) {
      const scope = document.createElement('section');
      scope.hidden = true;
      scope.setAttribute('role', 'dialog');
      scope.setAttribute('aria-label', 'Host dialog');
      const field = document.createElement('input');
      field.setAttribute('aria-label', 'Dialog field');
      scope.append(field);
      element.after(scope);
      toolbar.push(defineUiHostAction({
        id: 'host-dialog',
        label: { ru: 'Открыть диалог', en: 'Open dialog' },
        scope,
        open(connection) {
          const request = {
            kind: 'command', stamp: connection.context.state.stamp,
            command: kwdjCommand({ kind: 'insert_text', text: 'X' }), history_hint: { kind: 'isolated' },
          };
          scope.hidden = false;
          field.focus();
          return reason => {
            dialogCloses.push({
              reason, lifecycle: editor.lifecycle, capture: editor.capture(),
              attemptedRevision: request.stamp.revision, result: api.update(editor, request),
            });
            scope.hidden = true;
          };
        },
        command: () => kwdjCommand({ kind: 'insert_text', text: 'X' }),
      }));
    }
    const mountOptions = {
      ...options,
      locale,
      ui: { slots, profile: () => ({ toolbar, insertions: [], blockActions: [], moves: () => [] }) },
    };
    const editor = api.mount(mountOptions);
    const ready = await editor.ready;
    const uiReady = await editor.uiReady;
    const add = slots.entry.querySelector('[data-editor-ui-control="add"]');
    window.vanillaMode = {
      api, editor, element, root: element.firstElementChild, slots, add, slotListeners, mountOptions,
      listenerAdditions: () => listenerAdditions, dialogCloses,
    };
    return { ready, uiReady, slotListenerCount: slotListeners.length };
  }, { locale, withDialog });
  expect(initial.ready).toMatchObject({ status: 'ready' });
  expect(initial.uiReady).toMatchObject({ status: 'ready' });
  expect(initial.slotListenerCount).toBeGreaterThan(0);
}

const addLabels = { ru: 'Добавить блок', en: 'Add block' };

async function disposeLocaleUi(page, destroyThrough) {
  const cleanup = await page.evaluate(async destroyThrough => {
    const { api, editor, element, slots, add, slotListeners } = window.vanillaMode;
    const receipt = destroyThrough === 'mounted' ? editor.destroy() : api.destroy(editor);
    const finished = receipt.sdk.status === 'queued' ? await receipt.sdk.completion : receipt.sdk.response;
    const { sdk, dom } = editor.resources();
    return {
      finished,
      lifecycle: editor.lifecycle,
      emptyEditor: element.isConnected && element.childNodes.length === 0,
      slots: Object.values(slots).map(slot => ({ connected: slot.isConnected, children: slot.childNodes.length })),
      detachedAdd: !add.isConnected,
      slotListenerCount: slotListeners.length,
      sdkListeners: sdk.listeners,
      domListeners: dom.listeners,
      native: editor.nativeResources(),
    };
  }, destroyThrough);
  expect(cleanup).toEqual({
    finished: { status: 'ok', value: { kind: 'destroyed' } },
    lifecycle: 'destroyed',
    emptyEditor: true,
    slots: Array.from({ length: 3 }, () => ({ connected: true, children: 0 })),
    detachedAdd: true,
    slotListenerCount: 0,
    sdkListeners: 0,
    domListeners: 0,
    native: nativeEmpty,
  });
}

for (const [locale, nextLocale, destroyThrough] of [['ru', 'en', 'mounted'], ['en', 'ru', 'vanilla']]) {
  test(`public vanilla locale ${locale} → ${nextLocale} preserves UI and tears it down via ${destroyThrough} destroy`, async ({ page }) => {
    await mountLocaleUi(page, locale);
    const entry = page.locator('#vanilla-ui-entry');
    const add = label => entry.getByRole('button', { name: label, exact: true });
    await expect(add(addLabels[locale])).toBeVisible();
    await expect(add(addLabels[locale])).toHaveText(addLabels[locale]);
    const before = await documentCheckpoint(page);
    expect(before).toMatchObject({
      exported: { status: 'exported', canonicalJson: initialCanonical, revision: '0' },
      sameRoot: true,
    });

    expect(await page.evaluate(locale => {
      const { api, editor } = window.vanillaMode;
      return api.update(editor, { locale });
    }, nextLocale)).toEqual({ status: 'updated', locale: nextLocale });
    await expect(add(addLabels[nextLocale])).toBeVisible();
    await expect(add(addLabels[nextLocale])).toHaveText(addLabels[nextLocale]);
    expect(await add(addLabels[nextLocale]).evaluate(button => button === window.vanillaMode.add)).toBe(true);
    expect(await documentCheckpoint(page)).toEqual(before);

    await disposeLocaleUi(page, destroyThrough);
  });
}

test('public vanilla locale refused duplicate does not allocate shared slot UI', async ({ page }) => {
  await mountLocaleUi(page, 'en');
  const before = await documentCheckpoint(page);
  const duplicate = await page.evaluate(async () => {
    const { api, editor, slots, mountOptions, listenerAdditions, slotListeners } = window.vanillaMode;
    const roots = Object.values(slots);
    const controls = () => roots.flatMap(slot => [...slot.querySelectorAll('button')]);
    const originalControls = controls();
    const listenerBaseline = listenerAdditions();
    const activeBaseline = slotListeners.length;
    const mutations = [];
    const observer = new MutationObserver(records => mutations.push(...records));
    roots.forEach(slot => observer.observe(slot, { childList: true }));
    try {
      const duplicate = api.mount(mountOptions);
      const ready = await duplicate.ready;
      const uiReady = await duplicate.uiReady;
      mutations.push(...observer.takeRecords());
      const currentControls = controls();
      return {
        ready,
        uiReady,
        originalReady: editor.lifecycle,
        appendedRoots: mutations.reduce((count, change) => count + change.addedNodes.length, 0),
        addedListeners: listenerAdditions() - listenerBaseline,
        activeListenerChange: slotListeners.length - activeBaseline,
        sameControls: currentControls.length === originalControls.length
          && currentControls.every((node, index) => node === originalControls[index]),
      };
    } finally {
      observer.disconnect();
    }
  });
  expect(duplicate.ready).toMatchObject({ status: 'dom_refused', diagnostic: { code: 'dom.invalid_options' } });
  expect(duplicate.uiReady).toEqual({ status: 'ui_refused', code: 'ui.unavailable', action: null });
  expect(duplicate).toMatchObject({
    originalReady: 'ready', appendedRoots: 0, addedListeners: 0, activeListenerChange: 0, sameControls: true,
  });
  await expect(page.locator('#vanilla-ui-entry').getByRole('button', { name: addLabels.en, exact: true })).toBeVisible();
  expect(await documentCheckpoint(page)).toEqual(before);
  await disposeLocaleUi(page, 'vanilla');
});

test('public vanilla locale destroy retires native editing before closing the attached host dialog', async ({ page }) => {
  await mountLocaleUi(page, 'en', true);
  const initial = await documentCheckpoint(page);
  expect(initial).toMatchObject({ exported: { status: 'exported', canonicalJson: initialCanonical, revision: '0' }, sameRoot: true });
  const selected = await page.evaluate(async () => {
    const { api, editor, element } = window.vanillaMode;
    element.focus();
    const stamp = editor.capture();
    const root = editor.read({ kind: 'state' }).value.state.root;
    const paragraph = editor.read({ kind: 'node', stamp, node: root }).value.node.children[0];
    const leaf = editor.read({ kind: 'node', stamp, node: paragraph }).value.node.children[2];
    const point = { kind: 'text', node: leaf, offset: 2, affinity: 'after' };
    const ticket = api.update(editor, { kind: 'set_selection', stamp, selection: { anchor: point, focus: point } });
    return ticket.status === 'queued' ? ticket.completion : ticket.response;
  });
  expect(selected).toMatchObject({ status: 'ok', value: { kind: 'mutation' } });
  await page.getByRole('button', { name: 'Open dialog', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Host dialog', includeHidden: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Dialog field' })).toBeFocused();
  expect(await documentCheckpoint(page)).toEqual(initial);

  await disposeLocaleUi(page, 'vanilla');
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.vanillaMode.dialogCloses)).toMatchObject([{
    reason: 'destroyed',
    lifecycle: expect.stringMatching(/^(disposing|destroyed)$/),
    capture: null,
    attemptedRevision: '0',
    result: { status: 'dom_refused', diagnostic: { code: 'dom.disposed' } },
  }]);
});

const tableFixture = JSON.parse(readFileSync(new URL('../contracts/kwdj/v1/fixtures/positive.json', import.meta.url), 'utf8'))
  .fixtures.find(fixture => fixture.id === 'DOC-010').cases.find(item => item.name === 'rectangular_table');
const tableCanonical = canonicalizeRaw(JSON.stringify(tableFixture.kwdj));

async function observeAlphaInput(page, canonical, duplicateRootChild = false) {
  const originalBytes = [...new TextEncoder().encode(canonical)];
  const actual = await page.evaluate(async ({ originalBytes, duplicateRootChild }) => {
    const api = await import('@klenwriter/editor');
    const { options, wasm } = window.vanillaFixture;
    const { element } = options;
    const constructors = [];
    let projectionOverrides = 0;
    // Delegate to the packaged WASM. The controlled projection fault replaces
    // one read-only response and leaves editable sessions untouched.
    class ObservedSession {
      constructor(bytes, configuration) {
        const { access, admission } = JSON.parse(configuration);
        this.observation = { access, admission, initialization: null };
        constructors.push(this.observation);
        this.actual = new wasm.Session(bytes, configuration);
      }
      initialization() {
        const wire = this.actual.initialization();
        const reply = JSON.parse(wire);
        this.observation.initialization = reply.status;
        this.root = reply.value?.state?.root;
        return wire;
      }
      context() { return this.actual.context(); }
      call(wire) {
        const result = this.actual.call(wire);
        if (!duplicateRootChild || this.observation.access !== 'read_only') return result;
        const request = JSON.parse(wire);
        if (request.kind !== 'node' || request.node !== this.root) return result;
        const reply = JSON.parse(result);
        if (reply.status !== 'ok' || reply.value.kind !== 'node' || reply.value.node.children.length === 0) return result;
        reply.value.node.children.push(reply.value.node.children[0]);
        projectionOverrides++;
        return JSON.stringify(reply);
      }
      destroy() { this.actual.destroy(); }
      free() { this.actual.free(); }
    }
    const loader = async () => ({ manifest: wasm.manifest, Session: ObservedSession, resourceCounts: () => wasm.resourceCounts() });
    const input = new Uint8Array(originalBytes);
    const mutations = [];
    const observer = new MutationObserver(records => mutations.push(...records));
    observer.observe(element, { attributes: true, attributeFilter: ['contenteditable'], attributeOldValue: true });
    try {
      const editor = api.mount({ ...options, editor: { ...options.editor, input, loader } });
      const ready = await editor.ready;
      const afterRefusal = JSON.parse(wasm.resourceCounts());
      const emptyAtRefusal = element.childNodes.length === 0;
      const readyBytes = ready.recovery?.originalInput;
      const originalCopy = editor.originalInput();
      const reportedBytes = Array.from(readyBytes ?? []);
      const retainedBytes = Array.from(originalCopy ?? []);
      originalCopy?.fill(0);
      readyBytes?.fill(0);
      const retainedAfterMutation = Array.from(editor.originalInput() ?? []);
      const receipt = api.destroy(editor);
      const destroyed = receipt.sdk.status === 'queued' ? await receipt.sdk.completion : receipt.sdk.response;
      mutations.push(...observer.takeRecords());
      return {
        ready: { status: ready.status, diagnostic: ready.diagnostic, unsupportedTypes: ready.unsupportedTypes },
        reportedBytes, retainedBytes, retainedAfterMutation, callerBytes: Array.from(input),
        constructors, projectionOverrides, afterRefusal, emptyAtRefusal, destroyed, afterDestroy: JSON.parse(wasm.resourceCounts()),
        editableObserved: element.isContentEditable || mutations.some(record => record.oldValue === 'true'),
        emptyAfterDestroy: element.isConnected && element.childNodes.length === 0,
      };
    } finally {
      observer.disconnect();
    }
  }, { originalBytes, duplicateRootChild });
  return { actual, originalBytes };
}

function expectAlphaOriginalAndCleanup({ actual, originalBytes }) {
  expect(actual.constructors).toEqual([{ access: 'read_only', admission: 'validate', initialization: 'ok' }]);
  for (const bytes of [actual.reportedBytes, actual.retainedBytes, actual.retainedAfterMutation, actual.callerBytes]) {
    expect(bytes).toEqual(originalBytes);
  }
  expect(actual.emptyAtRefusal).toBe(true);
  expect(actual.editableObserved).toBe(false);
  expect(actual.afterRefusal).toEqual(nativeEmpty);
  expect(actual.destroyed).toEqual({ status: 'ok', value: { kind: 'destroyed' } });
  expect(actual.afterDestroy).toEqual(nativeEmpty);
  expect(actual.emptyAfterDestroy).toBe(true);
}

test('public vanilla alpha refuses DOC-010 before opening an editable session', async ({ page }) => {
  const observation = await observeAlphaInput(page, tableCanonical);
  expectAlphaOriginalAndCleanup(observation);
  expect(observation.actual.ready).toMatchObject({
    status: 'dom_refused',
    diagnostic: { code: 'dom.renderer_missing' },
    unsupportedTypes: [
      'org.klenwriter.kwdj/table',
      'org.klenwriter.kwdj/table_cell',
      'org.klenwriter.kwdj/table_header',
      'org.klenwriter.kwdj/table_row',
    ],
  });
});

const alphaDocuments = [
  {
    id: 'DOC-002',
    profile: 'kwdj',
    canonical: readFileSync(new URL('../contracts/mounted-e2e/v1/cases/DOC-002--unicode_whitespace_hard_break/approved-input.canonical.kwdj.json', import.meta.url), 'utf8'),
  },
  {
    id: 'Notes-D0',
    profile: 'notes',
    canonical: readFileSync(new URL('../contracts/dom/v1/expected/Notes-D0.canonical.json', import.meta.url), 'utf8'),
  },
];

test('public vanilla alpha checks replacement before publishing to the live editor', async ({ page }) => {
  const original = alphaDocuments[0].canonical;
  const replacement = '{"content":[{"content":[{"text":"Replacement permitted","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}';
  const observed = await page.evaluate(async ({ original, table, replacement }) => {
    const api = await import('@klenwriter/editor');
    const { defineRendererCatalog } = await import('@klenwriter/editor-dom');
    const { options, wasm } = window.vanillaFixture;
    const { element } = options;
    const constructors = [];
    class ObservedSession extends wasm.Session {
      constructor(bytes, configuration) {
        const { access } = JSON.parse(configuration);
        constructors.push(access);
        super(bytes, configuration);
      }
    }
    const { definition } = options.renderers;
    const nodes = { ...definition.nodes };
    for (const { id, primitive, attributes } of definition.inventory.nodes) {
      if (id.startsWith('org.klenwriter.kwdj/table')) {
        nodes[id] = { primitive, attributes, present: () => ({ tag: 'div' }) };
      }
    }
    const renderers = defineRendererCatalog({ ...definition, nodes });
    const encode = input => new TextEncoder().encode(input);
    const editor = api.mount({
      ...options,
      editor: { ...options.editor, input: encode(original), loader: async () => ({
        manifest: wasm.manifest, Session: ObservedSession, resourceCounts: wasm.resourceCounts,
      }) },
      renderers,
    });
    try {
      const ready = await editor.ready;
      const before = await api.export(editor);
      const root = element.firstElementChild;
      constructors.length = 0;
      const refused = await editor.replace(encode(table));
      const refusedConstructors = constructors.splice(0);
      const after = await api.export(editor);
      const sameRoot = element.firstElementChild === root;
      const editable = element.isContentEditable;
      const retained = editor.originalInput();
      const retainedInput = retained === null ? null : new TextDecoder().decode(retained);
      const accepted = await editor.replace(encode(replacement));
      const allowedConstructors = constructors.splice(0);
      const exported = await api.export(editor);
      return { ready, before, refused, refusedConstructors, after, sameRoot, editable, retainedInput,
        accepted, allowedConstructors, exported, liveSessions: editor.nativeResources().sessions };
    } finally {
      api.destroy(editor);
      if (JSON.parse(wasm.resourceCounts()).sessions !== 0) throw new Error('Replacement left native sessions');
    }
  }, { original, table: tableCanonical, replacement });
  expect(observed.ready.status).toBe('ready');
  expect(observed.before).toMatchObject({ status: 'exported', canonicalJson: original });
  expect(observed.refused).toMatchObject({
    status: 'dom_refused', diagnostic: { code: 'dom.renderer_missing', phase: 'replace', publication: 'none' },
    unsupportedTypes: ['table', 'table_cell', 'table_header', 'table_row'].map(type => 'org.klenwriter.kwdj/' + type),
  });
  expect(observed.refusedConstructors).toEqual(['read_only']);
  expect(observed.after).toEqual(observed.before);
  expect(observed.sameRoot).toBe(true);
  expect(observed.editable).toBe(true);
  expect(observed.retainedInput).toBe(tableCanonical);
  expect(observed.accepted).toMatchObject({ status: 'completed', response: { status: 'ok', value: { kind: 'mutation' } } });
  expect(observed.allowedConstructors).toEqual(['read_only']);
  expect(observed.exported).toMatchObject({ status: 'exported', canonicalJson: replacement });
  expect(observed.liveSessions).toBe(1);
});

test('public vanilla alpha refuses a duplicate DOC-002 child in the native probe', async ({ page }) => {
  const source = alphaDocuments.find(document => document.id === 'DOC-002');
  const observation = await observeAlphaInput(page, source.canonical, true);
  expect(observation.actual.projectionOverrides).toBe(1);
  expect.soft(observation.actual.ready).toMatchObject({
    status: 'dom_refused', diagnostic: { code: 'dom.reconcile_limit' },
  });
  expectAlphaOriginalAndCleanup(observation);
});

for (const { id, profile, canonical } of alphaDocuments) {
  test(`public vanilla alpha mounts, edits and re-exports ${id}`, async ({ page }) => {
    const ready = await page.evaluate(async ({ profile, canonical }) => {
      const api = await import('@klenwriter/editor');
      const { options, packet } = window.vanillaFixture;
      const { element } = options;
      const editorOptions = { ...options.editor, input: new TextEncoder().encode(canonical) };
      let renderers = options.renderers;
      if (profile === 'notes') {
        const { notesD0Renderers } = await import('/notes-dom.mjs');
        renderers = notesD0Renderers;
        editorOptions.options = {
          ...editorOptions.options,
          profile: {
            profile_id: 'org.example.notes', profile_version: '1.0.0', codec_id: 'org.example.notes/json',
            wire_version: 1, extensions: packet.registries.D0.selected_extensions,
          },
          registry_json: packet.registryJson.D0,
          profile_options_json: JSON.stringify({ root_blocks: ['org.example.notes/paragraph'], limits: null }),
        };
      }
      const editor = api.mount({ ...options, editor: editorOptions, renderers });
      const ready = await editor.ready;
      window.vanillaMode = { api, editor, element, root: element.firstElementChild };
      return ready;
    }, { profile, canonical });
    expect(ready).toMatchObject({ status: 'ready' });
    const editor = page.getByRole('textbox', { name: 'KlenWriter Editor' });
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    const original = await documentCheckpoint(page);
    expect(original).toMatchObject({ exported: { status: 'exported', canonicalJson: canonical, revision: '0' }, sameRoot: true });

    const selected = await page.evaluate(async profile => {
      const { api, editor, element } = window.vanillaMode;
      element.focus();
      const stamp = editor.capture();
      const root = editor.read({ kind: 'state' }).value.state.root;
      const firstChild = node => editor.read({ kind: 'node', stamp, node }).value.node.children[0];
      const content = firstChild(root);
      // Notes retains its wire document wrapper under the native root.
      const leaf = firstChild(profile === 'notes' ? firstChild(content) : content);
      const point = { kind: 'text', node: leaf, offset: 0, affinity: 'after' };
      const ticket = api.update(editor, { kind: 'set_selection', stamp, selection: { anchor: point, focus: point } });
      return ticket.status === 'queued' ? ticket.completion : ticket.response;
    }, profile);
    expect(selected).toMatchObject({ status: 'ok', value: { kind: 'mutation' } });
    await expect(editor).toBeFocused();
    await page.keyboard.type('X');
    const edited = JSON.parse(canonical);
    const leaf = profile === 'kwdj' ? edited.content[0].content[0] : edited.root.children[0].children[0];
    leaf.text = `X${leaf.text}`;
    expect(await documentCheckpoint(page)).toMatchObject({
      exported: { status: 'exported', canonicalJson: canonicalizeRaw(JSON.stringify(edited)), revision: '1' },
      session: original.session,
      generation: original.generation,
      sameRoot: true,
    });
    const undone = await page.evaluate(async () => {
      const { api, editor } = window.vanillaMode;
      const ticket = api.update(editor, { kind: 'history', stamp: editor.capture(), direction: 'undo' });
      return ticket.status === 'queued' ? ticket.completion : ticket.response;
    });
    expect(undone).toMatchObject({ status: 'ok', value: { kind: 'mutation' } });
    expect(await documentCheckpoint(page)).toEqual({
      ...original, exported: { status: 'exported', canonicalJson: canonical, revision: '2' },
    });
    await disposeMode(page);
  });
}
