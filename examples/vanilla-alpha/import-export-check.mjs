// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
  return { ...results, documentRequests: requests.length };
}
