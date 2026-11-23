// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { buildConsumerModule, installAlphaConsumer } from './consumer.mjs';
import { serveAlphaConsumer } from './browser.mjs';

const smokeProgram = `
import { mount, update, export as exportDocument, destroy } from '@klenwriter/editor';
import { loadSdkV2, sdkBuildId } from '@klenwriter/editor-sdk';
import { kwdjBasicRenderers } from '@klenwriter/editor-kwdj/dom';

function accepted(reply, kind) {
  if (reply.status !== 'ok' || reply.value.kind !== kind) throw new Error(JSON.stringify(reply));
  return reply.value;
}
function finish(submission) {
  if (submission.status === 'completed') return submission.response;
  if (submission.status === 'queued') return submission.completion;
  throw new Error(JSON.stringify(submission));
}

window.smokeReady = (async () => {
  const fixture = await fetch('/smoke-fixture.json').then(response => response.json());
  const wasm = await loadSdkV2();
  if (sdkBuildId !== fixture.sdkBuildId || wasm.manifest.build_id !== sdkBuildId) throw new Error('SDK binding changed');
  const element = document.querySelector('#editor');
  const editor = mount({
    element,
    editor: {
      input: new TextEncoder().encode(JSON.stringify(fixture.input)),
      loader: async () => wasm,
      options: {
        abi: 'editor-sdk/2', build_id: sdkBuildId, profile: fixture.profile,
        admission: 'validate', access: 'editable', registry_json: fixture.registryJson,
        profile_options_json: JSON.stringify({ identities: { media: [], references: [] }, limits: null }),
      },
    },
    renderers: kwdjBasicRenderers,
  });
  const ready = await editor.ready;
  if (ready.status !== 'ready') throw new Error(JSON.stringify(ready));
  const stamp = editor.capture();
  const state = accepted(editor.read({ kind: 'state' }), 'state').state;
  const node = id => accepted(editor.read({ kind: 'node', stamp, node: id }), 'node').node;
  const first = node(node(state.root).children[0]);
  const leaf = first.children[0];
  const point = { kind: 'text', node: leaf, offset: 5, affinity: 'after' };
  element.focus();
  accepted(await finish(update(editor, {
    kind: 'set_selection', stamp, selection: { anchor: point, focus: point },
  })), 'mutation');

  const input = [];
  element.addEventListener('beforeinput', event => {
    input.push({ trusted: event.isTrusted, kind: event.inputType, data: event.data });
  });
  window.smoke = {
    sdkBuildId,
    input,
    inspect: () => exportDocument(editor),
    destroy: async () => {
      accepted(await finish(destroy(editor).sdk), 'destroyed');
      return JSON.parse(wasm.resourceCounts());
    },
  };
  return true;
})();
`;

const html = ({ importMap, imports }) => `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Vanilla editor smoke</title>
<link rel="stylesheet" href="${imports['@klenwriter/editor/style.css']}">
<script type="importmap">${importMap}</script>
<div id="editor" aria-label="Editor"></div>
<script type="module" src="/smoke.mjs"></script>
`;

export async function smokeAlphaBundle(workspace, bundle) {
  const consumer = installAlphaConsumer(workspace, bundle);
  let browser;
  let server;
  try {
    const packet = JSON.parse(readFileSync(join(workspace, 'artifacts/extensions/packet.json'), 'utf8'));
    const fixture = {
      sdkBuildId: consumer.receipt.sdkBuildId,
      profile: packet.kwdjProfile,
      registryJson: packet.kwdjRegistryJson,
      input: {
        schema: 'klenwriter.document', schema_version: 1, profile: 'prose',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Alpha' }] }],
      },
    };
    const modulePath = join(consumer.directory, 'smoke.mjs');
    writeFileSync(modulePath, smokeProgram);
    const emittedPath = join(consumer.directory, 'dist', 'smoke.mjs');
    const build = buildConsumerModule(consumer, modulePath, emittedPath);
    const resources = new Map([
      ['/smoke.mjs', { type: 'text/javascript', file: emittedPath }],
      ['/smoke-fixture.json', { type: 'application/json', body: JSON.stringify(fixture) }],
    ]);
    server = await serveAlphaConsumer(consumer, html, resources);
    browser = await chromium.launch();
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(server.url);
    await page.waitForFunction(() => Boolean(window.smokeReady));
    assert.equal(await page.evaluate(() => window.smokeReady), true);
    assert.equal(await page.locator('#editor').textContent(), 'Alpha');
    const styles = await page.locator('#editor').evaluate(element => ({
      wrap: getComputedStyle(element).whiteSpace,
      sheet: document.querySelector('link[rel="stylesheet"]').sheet?.href,
    }));
    assert.equal(styles.wrap, 'pre-wrap');
    assert.equal(styles.sheet, server.url + server.imports['@klenwriter/editor/style.css']);
    await page.keyboard.insertText('X');
    const after = await page.evaluate(() => window.smoke.inspect());
    assert.equal(after.status, 'exported');
    assert.equal(after.stamp.revision, '1');
    assert.equal(JSON.parse(after.canonicalJson).content[0].content[0].text, 'AlphaX');
    const input = await page.evaluate(() => window.smoke.input);
    assert.deepEqual(input, [{ trusted: true, kind: 'insertText', data: 'X' }]);
    const native = await page.evaluate(() => window.smoke.destroy());
    assert.deepEqual(native, { sessions: 0, snapshot_handles: 0, snapshot_bytes: '0', protected_cursors: 0 });
    assert.equal(await page.locator('#editor').textContent(), '');
    assert.deepEqual(pageErrors, []);
    return {
      format: 'klenwriter-editor-vanilla-alpha-smoke/1',
      sourceSha: consumer.receipt.sourceSha,
      sdkBuildId: consumer.receipt.sdkBuildId,
      version: consumer.receipt.version,
      lockSha256: consumer.lockSha256,
      npmVersion: consumer.npmVersion,
      absentTools: consumer.absentTools,
      consumerBuild: build,
      browser: { engine: 'chromium', version: browser.version() },
      input,
      canonicalJson: after.canonicalJson,
      revision: after.stamp.revision,
      native,
    };
  } finally {
    try {
      await browser?.close();
      await server?.close();
    } finally {
      consumer.cleanup();
    }
  }
}
