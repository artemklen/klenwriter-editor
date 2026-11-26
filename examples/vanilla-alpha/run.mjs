// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { serveAlphaConsumer } from '../../scripts/vanilla-alpha/browser.mjs';
import { buildConsumerModule, installAlphaConsumer } from '../../scripts/vanilla-alpha/consumer.mjs';
import { checkLinkDialog } from './link-check.mjs';
import { alternateEntry, checkAlternateHostServices, checkMockHostServices } from './host-check.mjs';
import { checkPlayground } from './import-export-check.mjs';

const example = fileURLToPath(new URL('./', import.meta.url));
const workspace = resolve(example, '../..');
const notesSource = join(workspace, 'examples', 'notes-extension');
const notesDocumentPath = join(workspace, 'contracts', 'dom', 'v1', 'expected', 'Notes-D0.canonical.json');
const notesCanonical = readFileSync(notesDocumentPath, 'utf8');
const notesDescriptor = readFileSync(join(notesSource, 'd0.json'), 'utf8');
const kwdjDescriptor = JSON.stringify(JSON.parse(readFileSync(join(example, 'kwdj-registry.json'), 'utf8')));
const [bundle, mode = '--check', ...extras] = process.argv.slice(2);
assert(bundle && ['--check', '--serve'].includes(mode) && extras.length === 0,
  'Usage: node examples/vanilla-alpha/run.mjs <tarball-directory> [--check|--serve]');

async function validateExport(page, canonical, descriptor, profileOptions) {
  const result = await page.evaluate(async ({ canonical, descriptor, profileOptions }) => {
    const { createEditor, loadSdkV2, sdkAbiV2, sdkBuildId } = await import('@klenwriter/editor-sdk');
    const sdk = await loadSdkV2();
    const resources = () => JSON.parse(sdk.resourceCounts());
    const before = resources();
    const registry = JSON.parse(descriptor);
    const profile = registry.profile;
    const validator = createEditor({
      input: new TextEncoder().encode(canonical),
      loader: async () => sdk,
      options: {
        abi: sdkAbiV2, build_id: sdkBuildId, admission: 'validate', access: 'read_only',
        profile: {
          profile_id: profile.id, profile_version: profile.version, codec_id: profile.codec_id,
          wire_version: profile.wire_version, extensions: registry.selected_extensions,
        },
        registry_json: descriptor, profile_options_json: JSON.stringify(profileOptions),
      },
    });
    const admitted = await validator.ready;
    const context = validator.context();
    const ticket = validator.destroy();
    const closed = ticket.status === 'queued' ? await ticket.completion : ticket.response;
    return { admitted, context, closed, before, after: resources() };
  }, { canonical, descriptor, profileOptions });
  assert.equal(result.admitted.status, 'ok', JSON.stringify(result.admitted));
  assert.equal(result.context.profile.profile_id, JSON.parse(descriptor).profile.id);
  assert.equal(result.closed.status, 'ok');
  assert.equal(result.closed.value.kind, 'destroyed');
  assert.equal(result.before.sessions, 1, 'Only the active editor is retained');
  assert.deepEqual(result.after, result.before, 'Validation releases its native resources');
}

const manifest = JSON.parse(readFileSync(join(example, 'package.json'), 'utf8'));
assert.deepEqual(Object.keys(manifest).sort(), ['dependencies', 'name', 'private', 'type']);
const profileSource = readFileSync(join(example, 'profile.mjs'), 'utf8');
const notesSpecifiers = [...profileSource.matchAll(/['"](@example\/notes-extension[^'"\r\n]*)['"]/gu)]
  .map(([, specifier]) => specifier).sort();
assert.deepEqual(notesSpecifiers,
  ['@example/notes-extension/d0.json', '@example/notes-extension/d1.json', '@example/notes-extension/dom']);
assert.doesNotMatch(profileSource, /\.\.\/notes-extension\//u);
const consumer = installAlphaConsumer(workspace, resolve(bundle), manifest.dependencies);
let server;
try {
  for (const file of ['entry.mjs', 'app.mjs', 'profile.mjs', 'link-action.mjs', 'host-services.mjs', 'reference-document.json', 'kwdj-registry.json', 'index.html', 'example.css']) {
    copyFileSync(join(example, file), join(consumer.directory, file));
  }
  const notesDirectory = join(consumer.directory, 'notes-extension');
  mkdirSync(notesDirectory);
  copyFileSync(notesDocumentPath, join(consumer.directory, 'notes-document.json'));
  for (const member of ['dom.mjs', 'dom-inventory.mjs', 'd0.json', 'd1.json']) {
    copyFileSync(join(notesSource, member), join(notesDirectory, member));
  }
  const entry = join(consumer.directory, 'entry.mjs');
  const emitted = join(consumer.directory, 'dist', 'app.mjs');
  const build = buildConsumerModule(consumer, entry, emitted);
  const template = readFileSync(join(consumer.directory, 'index.html'), 'utf8');
  const resources = new Map([
    ['/app.mjs', { type: 'text/javascript', file: emitted }],
    ['/example.css', { type: 'text/css', file: join(consumer.directory, 'example.css') }],
    ['/notes-extension/dom.mjs', { type: 'text/javascript', file: join(notesDirectory, 'dom.mjs') }],
    ['/notes-extension/dom-inventory.mjs', { type: 'text/javascript', file: join(notesDirectory, 'dom-inventory.mjs') }],
    ['/notes-extension/d0.json', { type: 'application/json', file: join(notesDirectory, 'd0.json') }],
    ['/notes-extension/d1.json', { type: 'application/json', file: join(notesDirectory, 'd1.json') }],
  ]);
  server = await serveAlphaConsumer(consumer,
    ({ importMap, imports }) => template
      .replace('%%IMPORT_MAP%%', () => importMap)
      .replace('%%EDITOR_CSS%%', imports['@klenwriter/editor/style.css'])
      .replace('%%UI_CSS%%', imports['@klenwriter/editor-ui/style.css']),
    resources, {
      '@example/notes-extension/dom': '/notes-extension/dom.mjs',
      '@example/notes-extension/d0.json': '/notes-extension/d0.json',
      '@example/notes-extension/d1.json': '/notes-extension/d1.json',
    });

  if (mode === '--serve') {
    console.log(server.url);
    await new Promise(done => {
      process.once('SIGINT', done);
      process.once('SIGTERM', done);
    });
  } else {
    const results = [];
    const alternateSource = join(consumer.directory,'alternate-entry.mjs');
    const alternateBuild = join(consumer.directory,'dist','alternate-entry.mjs');
    writeFileSync(alternateSource,alternateEntry);
    buildConsumerModule(consumer,alternateSource,alternateBuild);
    for (const [engine, driver] of Object.entries({ chromium, webkit })) {
      const browser = await driver.launch();
      try {
        const page = await browser.newPage();
        page.setDefaultTimeout(8_000);
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

        const profile = page.getByLabel('Profile', { exact: true });
        await profile.selectOption('notes');
        await waitForStatus('Opened Generic Notes');
        assert.equal(await canonical(), notesCanonical);
        assert.equal(await page.locator('#editor [title]').getAttribute('title'), 'Notes D0');
        const notesOptions = { root_blocks: ['org.example.notes/paragraph'], limits: null };
        await validateExport(page, await canonical(), notesDescriptor, notesOptions);

        await profile.selectOption('kwdj');
        await waitForStatus('Opened KWDJ');
        assert.equal(await canonical(), before);
        assert.equal(await page.locator('#editor').textContent(), 'Vanilla alpha');
        const kwdjOptions = { identities: { media: [], references: [] }, limits: null };
        await validateExport(page, await canonical(), kwdjDescriptor, kwdjOptions);

        await profile.selectOption('notes');
        await waitForStatus('Opened Generic Notes');
        assert.equal(await canonical(), notesCanonical);
        await validateExport(page, await canonical(), notesDescriptor, notesOptions);

        await press('Insert callout');
        await waitForStatus('Callout inserted in the example copy');
        const extensionOutput = page.locator('#extension-canonical');
        const extended = JSON.parse(await extensionOutput.textContent());
        const original = JSON.parse(notesCanonical);
        assert.equal(extended.root.children.length, original.root.children.length + 1);
        assert.deepEqual(extended.root.children[0], original.root.children[0]);
        const [paragraph, callout] = extended.root.children;
        assert.equal(paragraph.type, 'org.example.notes/paragraph');
        assert.equal(callout.type, 'org.example.notes/callout');
        assert.deepEqual(callout.attrs, { kind: 'warning', title: 'Review' });
        assert.deepEqual(callout.children[0].children[0], {
          type: 'org.example.notes/text', attrs: {}, children: [], text: 'Check this note',
          marks: [{ type: 'org.example.notes/highlight', attrs: { color: 'mint' } }],
        });
        assert.equal(await extensionOutput.getAttribute('data-revision'), '1');
        assert.equal(await canonical(), notesCanonical);
        await press('Undo callout');
        await waitForStatus('Undid the callout');
        assert.equal(await extensionOutput.textContent(), notesCanonical);
        assert.equal(await extensionOutput.getAttribute('data-revision'), '2');
        assert.equal(await canonical(), notesCanonical);
        await validateExport(page, await canonical(), notesDescriptor, notesOptions);

        await profile.selectOption('kwdj');
        await waitForStatus('Opened KWDJ');
        const link = await checkLinkDialog(page);
        const hostServices = await checkMockHostServices(page);
        const alternate = await browser.newPage();
        alternate.setDefaultTimeout(8_000);
        alternate.on('pageerror', error => errors.push(error.message));
        await alternate.route(new URL('/app.mjs',server.url).href,
          route => route.fulfill({path:alternateBuild,contentType:'text/javascript'}));
        await alternate.goto(server.url);
        const alternateHostServices = await checkAlternateHostServices(alternate);

        const playground = await browser.newPage({ acceptDownloads: true });
        playground.setDefaultTimeout(8_000);
        playground.on('pageerror', error => errors.push(error.message));
        const playgroundResult = await checkPlayground(playground, server.url);

        assert.deepEqual(errors, []);
        results.push({
          engine, version: browser.version(),
          editUndoRedoSaveReloadReopen: 'pass', profileSwitchAndValidation: 'pass', extensionAndUndo: 'pass',
          linkDialog: link, hostServices, alternateHostServices, playground: playgroundResult,
        });
      } catch (error) {
        throw new Error(engine + ' alpha example check failed', {cause:error});
      } finally {
        await browser.close();
      }
    }
    const git = (...args) => execFileSync('git', args, { cwd: workspace, encoding: 'utf8' }).trim();
    console.log(JSON.stringify({
      format: 'klenwriter-editor-vanilla-alpha-example/1',
      sourceSha: git('rev-parse', 'HEAD'),
      sourceDirty: git('status', '--porcelain') !== '',
      packageSourceSha: consumer.receipt.sourceSha,
      sdkBuildId: consumer.receipt.sdkBuildId,
      packageVersion: consumer.receipt.version,
      tarballs: consumer.receipt.tarballs.map(({ name, filename, version, sha256 }) => ({
        name, filename, version, sha256,
      })),
      nodeVersion: process.versions.node,
      npmVersion: consumer.npmVersion,
      absentTools: consumer.absentTools,
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
