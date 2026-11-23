// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { serveAlphaConsumer } from '../../scripts/vanilla-alpha/browser.mjs';
import { buildConsumerModule, installAlphaConsumer } from '../../scripts/vanilla-alpha/consumer.mjs';

const example = fileURLToPath(new URL('./', import.meta.url));
const workspace = resolve(example, '../..');
const [bundle, mode = '--check', ...extras] = process.argv.slice(2);
assert(bundle && ['--check', '--serve'].includes(mode) && extras.length === 0,
  'Usage: node examples/vanilla-alpha/run.mjs <tarball-directory> [--check|--serve]');

const manifest = JSON.parse(readFileSync(join(example, 'package.json'), 'utf8'));
assert.deepEqual(Object.keys(manifest).sort(), ['dependencies', 'name', 'private', 'type']);
const consumer = installAlphaConsumer(workspace, resolve(bundle), manifest.dependencies);
let server;
try {
  for (const file of ['app.mjs', 'profile.mjs', 'kwdj-registry.json', 'index.html', 'example.css']) {
    copyFileSync(join(example, file), join(consumer.directory, file));
  }
  const entry = join(consumer.directory, 'app.mjs');
  const emitted = join(consumer.directory, 'dist', 'app.mjs');
  const build = buildConsumerModule(consumer, entry, emitted);
  const template = readFileSync(join(consumer.directory, 'index.html'), 'utf8');
  const resources = new Map([
    ['/app.mjs', { type: 'text/javascript', file: emitted }],
    ['/example.css', { type: 'text/css', file: join(consumer.directory, 'example.css') }],
  ]);
  server = await serveAlphaConsumer(consumer,
    ({ importMap, imports }) => template
      .replace('%%IMPORT_MAP%%', () => importMap)
      .replace('%%EDITOR_CSS%%', imports['@klenwriter/editor/style.css']),
    resources);

  if (mode === '--serve') {
    console.log(server.url);
    await new Promise(done => {
      process.once('SIGINT', done);
      process.once('SIGTERM', done);
    });
  } else {
    const results = [];
    for (const [engine, driver] of Object.entries({ chromium, webkit })) {
      const browser = await driver.launch();
      try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const canonical = async () => {
          const text = await page.locator('#canonical').textContent();
          assert(text, 'Expected canonical export');
          return text;
        };
        const waitForStatus = message => page.getByRole('status').getByText(message, { exact: true }).waitFor();
        const press = label => page.getByRole('button', { name: label, exact: true }).click();

        await page.goto(server.url);
        await waitForStatus('Editor ready');
        const before = await canonical();
        await page.locator('#editor').evaluate(element => {
          window.typed = [];
          element.addEventListener('beforeinput', event => {
            window.typed.push({ trusted: event.isTrusted, type: event.inputType, data: event.data });
          });
        });
        await page.locator('#editor').click();
        await page.keyboard.press('ArrowRight');
        await page.keyboard.insertText('X');
        await page.waitForFunction(() => document.querySelector('#canonical').textContent.includes('X'));
        const after = await canonical();
        assert.equal(JSON.parse(after).content[0].content[0].text.replace('X', ''), 'Vanilla alpha');
        assert.notEqual(after, before);
        assert.deepEqual(await page.evaluate(() => window.typed), [{ trusted: true, type: 'insertText', data: 'X' }]);

        await press('Undo');
        await waitForStatus('Undone');
        assert.equal(await canonical(), before);
        await press('Redo');
        await waitForStatus('Redone');
        assert.equal(await canonical(), after);
        await press('Save');
        await waitForStatus('Saved in this browser');
        await page.reload();
        await waitForStatus('Editor ready');
        assert.equal(await canonical(), before);
        await press('Reopen saved');
        await waitForStatus('Reopened saved document');
        assert.equal(await canonical(), after);
        assert.equal(await page.locator('#editor').textContent(), JSON.parse(after).content[0].content[0].text);
        assert.deepEqual(errors, []);
        results.push({ engine, version: browser.version(), editUndoRedoSaveReloadReopen: 'pass' });
      } finally {
        await browser.close();
      }
    }
    console.log(JSON.stringify({
      sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim(),
      packageSourceSha: consumer.receipt.sourceSha,
      sdkBuildId: consumer.receipt.sdkBuildId,
      packageVersion: consumer.receipt.version,
      lockSha256: consumer.lockSha256,
      build,
      results,
    }));
  }
} finally {
  try {
    await server?.close();
  } finally {
    consumer.cleanup();
  }
}
