// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';

async function exported(page) {
  return page.locator('#canonical').evaluate(output => ({
    canonical: output.textContent,
    revision: output.dataset.revision,
  }));
}

async function selectVanilla(editor) {
  await editor.evaluate(element => {
    element.focus();
    const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode();
    if (text?.data !== 'Vanilla alpha') throw new Error('Expected fresh KWDJ sample');
    document.getSelection().setBaseAndExtent(text, 7, text, 0);
    window.alphaLinkInitialText = text;
    return new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
}

async function selection(editor) {
  return editor.evaluate(element => {
    const result = document.getSelection();
    return {
      editorFocused: document.activeElement === element,
      anchorMatches: result.anchorNode === window.alphaLinkInitialText,
      anchorOffset: result.anchorOffset,
      focusMatches: result.focusNode === window.alphaLinkInitialText,
      focusOffset: result.focusOffset,
      text: result.toString(),
    };
  });
}

export async function checkLinkDialog(page) {
  const editor = page.locator('#editor');
  const trigger = page.getByRole('button', { name: 'Link', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Insert link', exact: true });
  const field = dialog.getByRole('textbox', { name: 'Link URL' });
  const nativeBefore = await exported(page);
  assert.match(nativeBefore.revision, /^\d+$/);
  assert.deepEqual(JSON.parse(nativeBefore.canonical).content, [{
    type: 'paragraph', content: [{ type: 'text', text: 'Vanilla alpha' }],
  }]);

  await selectVanilla(editor);
  const beforeSelection = await selection(editor);
  assert.deepEqual(beforeSelection, {
    editorFocused: true, anchorMatches: true, anchorOffset: 7,
    focusMatches: true, focusOffset: 0, text: 'Vanilla',
  });
  for (const cancelWithEscape of [false, true]) {
    await trigger.click();
    await dialog.waitFor();
    assert.equal(await field.evaluate(input => document.activeElement === input), true);
    await field.fill('https://example.test/discarded');
    if (cancelWithEscape) {
      await page.mouse.click(8, 8);
      assert.equal(await field.evaluate(input => document.activeElement === input), true,
        'A backdrop click keeps keyboard focus inside the host dialog');
      await page.keyboard.press('Escape');
    } else {
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    await dialog.waitFor({ state: 'hidden' });
    await editor.evaluate(() => new Promise(done => requestAnimationFrame(done)));
    assert.deepEqual(await selection(editor), beforeSelection, 'Cancel restores exact directed selection and focus');
  }

  // The existing host Save refreshes the native export even without a document event.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Saved in this browser', { exact: true }).waitFor();
  assert.deepEqual(await exported(page), nativeBefore, 'Cancel preserves native revision and canonical bytes');

  await selectVanilla(editor);
  await trigger.click();
  await dialog.waitFor();
  assert.equal(await field.evaluate(input => document.activeElement === input), true);
  const href = 'https://example.test/alpha?view=note&tab=link#heading';
  await field.fill(href);
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });

  const revision = String(BigInt(nativeBefore.revision) + 1n);
  await page.waitForFunction(expected => document.querySelector('#canonical').dataset.revision === expected, revision);
  const nativeAfter = JSON.parse((await exported(page)).canonical);
  assert.deepEqual(nativeAfter.content, [{
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Vanilla', marks: [{ type: 'link', attrs: { href } }] },
      { type: 'text', text: ' alpha' },
    ],
  }]);
  const renderedLink = editor.getByRole('link', { name: 'Vanilla', exact: true });
  assert.equal(await renderedLink.getAttribute('href'), href);
  return { linkConfirm: 'pass', linkCancel: 'pass' };
}
