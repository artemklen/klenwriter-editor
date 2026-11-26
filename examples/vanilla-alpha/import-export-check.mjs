// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function checkPendingImport(page, status, importFile, canonical) {
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      File.prototype.arrayBuffer = read;
      await new Promise(resolve => { window.finishFileRead = resolve; });
      return read.call(this);
    };
  });
  const original = await canonical();
  await importFile(Buffer.from(original));
  await page.waitForFunction(() => typeof window.finishFileRead === 'function');
  await page.locator('#editor').click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(' while importing');
  await page.waitForFunction(() => document.querySelector('#canonical').textContent.includes('while importing'));
  const edited = await canonical();
  await page.evaluate(() => {
    window.finishFileRead();
    delete window.finishFileRead;
  });
  await status('Import refused (file.stale_document)').waitFor();
  assert.equal(await canonical(), edited);
}

async function checkNotesCopy(page, status, importFile, canonical) {
  const button = label => page.getByRole('button', { name: label, exact: true });
  const copy = page.locator('#extension-canonical');
  await button('Insert callout').click();
  await status('Callout inserted in the example copy').waitFor();
  const oldCopy = await copy.textContent();
  assert(oldCopy);

  await importFile(Buffer.from('{'));
  await status('Import refused (notes.invalid_json)').waitFor();
  assert.equal(await copy.textContent(), oldCopy);

  const replacement = JSON.parse(await canonical());
  replacement.root.children[0].children[0].text = 'Another local note';
  await importFile(Buffer.from(JSON.stringify(replacement)));
  await status('Imported Generic Notes').waitFor();
  assert.equal(await copy.textContent(), '');
  assert.equal(await button('Insert callout').isEnabled(), true);
  assert.equal(await button('Undo callout').isDisabled(), true);
}

export async function checkPlayground(page, url) {
  const status = message => page.getByRole('status').getByText(message, { exact: true });
  const canonical = () => page.locator('#canonical').textContent();
  await page.goto(url);
  await status('Editor ready').waitFor();

  const requests = [];
  const request = event => {
    if (/^https?:/u.test(event.url())) requests.push({ method: event.method(), url: event.url() });
  };
  page.on('request', request);
  const importFile = bytes => page.getByLabel('Import JSON file').setInputFiles({
    name: 'local-document.json', mimeType: 'application/json', buffer: bytes,
  });
  const results = {};

  try {
    await checkPendingImport(page, status, importFile, canonical);
    for (const [profile, label] of [['kwdj', 'KWDJ'], ['notes', 'Generic Notes']]) {
      if (profile === 'notes') {
        await page.getByLabel('Profile', { exact: true }).selectOption(profile);
        await status('Opened Generic Notes').waitFor();
      }
      const expected = JSON.parse(await canonical());
      const paragraph = profile === 'kwdj' ? expected.content[0].content : expected.root.children[0].children;
      paragraph.splice(1);
      paragraph[0].text = 'Local sample';

      await importFile(Buffer.from(JSON.stringify(expected)));
      await status('Imported ' + label).waitFor();
      assert.deepEqual(JSON.parse(await canonical()), expected);
      assert.equal(await page.locator('#editor').textContent(), 'Local sample');

      await page.locator('#editor').click();
      await page.keyboard.press('End');
      await page.keyboard.insertText('X');
      await page.waitForFunction(() => document.querySelector('#canonical').textContent.includes('Local sampleX'));
      paragraph[0].text = 'Local sampleX';

      const downloadReady = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
      const download = await downloadReady;
      await status('Exported ' + label).waitFor();
      assert.equal(download.suggestedFilename(), profile + '.json');
      const exported = await readFile(await download.path(), 'utf8');
      assert.deepEqual(JSON.parse(exported), expected);
      assert.equal(exported, await canonical());

      await importFile(Buffer.from('{'));
      const refusal = status('Import refused (' + profile + '.invalid_json)');
      await refusal.waitFor();
      assert.equal(await canonical(), exported);
      assert.equal(await page.locator('#editor').textContent(), 'Local sampleX');
      results[profile] = { editedAndExported: true, refusal: await refusal.textContent() };
    }
    assert.deepEqual(requests, [], 'Document import, edit, export and refusal stay local');
  } finally {
    page.off('request', request);
  }
  await checkNotesCopy(page, status, importFile, canonical);
  return { ...results, documentRequests: requests.length, staleImportPreserved: true, notesCopyReset: true };
}
