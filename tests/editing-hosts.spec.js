import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';

const modes = ['single', 'islands'];
// Only seeds the starting caret. The action being measured uses browser keyboard/mouse input.
async function caret(page, block, end = false) {
  await page.locator(`#${block}`).click();
  await page.evaluate(({ block, end }) => {
    const p = document.getElementById(block);
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    const node = end ? nodes.at(-1) : nodes[0];
    getSelection().setBaseAndExtent(node, end ? node.length : 0, node, end ? node.length : 0);
  }, { block, end });
}
async function record(page, testInfo, scenario, observation) {
  const snapshot = await page.evaluate(() => window.spike.snapshot());
  await testInfo.attach('observation', { body: JSON.stringify({ scenario, project: testInfo.project.name, observation, snapshot }, null, 2), contentType: 'application/json' });
}
for (const mode of modes) {
  test.describe(mode, () => {
    test.beforeEach(async ({ page }) => { await page.goto(`/?mode=${mode}`); });
    test('fixture, CSP and WASM loading', async ({ page, request, browser }, info) => {
      const response = await request.get('/');
      expect(response.headers()['content-security-policy']).toContain("'wasm-unsafe-eval'");
      expect(response.headers()['content-security-policy']).not.toContain("'unsafe-eval'");
      await expect(page.locator('#wasm-status')).toContainText('allowed');
      expect(await page.locator('#editor [contenteditable="true"]').count()).toBe(mode === 'single' ? 0 : 3);
      const violations = await page.evaluate(async () => {
        const results = [];
        document.addEventListener('securitypolicyviolation', e => results.push(e.violatedDirective));
        const script = document.createElement('script'); script.textContent = 'window.inlineExecuted = true'; document.body.append(script);
        await new Promise(resolve => setTimeout(resolve, 50));
        return { results, executed: window.inlineExecuted === true };
      });
      expect(violations.executed).toBe(false);
      expect(violations.results).toContain('script-src-elem');
      await record(page, info, 'csp-fixture', { browserVersion: browser.version(), inlineBlocked: true, emptyWasmAllowed: true });
    });
    test('native fixture hides diagnostic copies and records caret geometry', async ({ page }, info) => {
      await page.goto(`/?mode=${mode}&native=1`);
      await expect(page.locator('#wasm-status')).toContainText('allowed');
      await expect(page.locator('#diagnostics')).toBeHidden();
      await caret(page, 'p1');
      const snapshot = await page.evaluate(() => window.spike.snapshot());
      const { viewport, focusRect } = snapshot;
      expect(snapshot.nativeMode).toBe(true);
      expect(snapshot.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
      expect(viewport.rect.width).toBeGreaterThan(0);
      expect(viewport.rect.height).toBeGreaterThan(0);
      expect(viewport.scrollTop).toBe(0);
      expect(focusRect).not.toBeNull();
      expect(focusRect.height).toBeGreaterThan(0);
      expect(focusRect.y).toBeGreaterThanOrEqual(viewport.rect.y);
      expect(focusRect.y + focusRect.height).toBeLessThanOrEqual(viewport.rect.y + viewport.rect.height);
      for (const id of ['single-link', 'islands-link']) {
        await expect(page.locator(`#${id}`)).toHaveAttribute('href', /[?&]native=1(?:&|$)/);
      }
      await record(page, info, 'native-fixture', { diagnosticsHidden: true, viewport, focusRect,
        limitation: 'Geometry/fixture check only; browser Find requires the native browser UI' });
    });
    test('typing and browser undo', async ({ page }, info) => {
      await caret(page, 'p1', true);
      const before = await page.locator('#editor').innerText();
      const beforeParagraph = await page.locator('#p1').innerText();
      const unchangedBlocks = async () => page.locator('#editor [data-block]:not([data-block="p1"])').evaluateAll(blocks => blocks.map(block => block.outerHTML));
      const otherBlocksBefore = await unchangedBlocks();
      const inserted = ' test';
      await page.keyboard.type(inserted);
      await expect(page.locator('#p1')).toHaveText(beforeParagraph + inserted);
      await page.keyboard.press('ControlOrMeta+z');
      const after = await page.locator('#editor').innerText();
      const afterParagraph = await page.locator('#p1').innerText();
      const remainingTypedText = afterParagraph.slice(beforeParagraph.length);
      const undoChangedOnlyTypedSuffix = afterParagraph.startsWith(beforeParagraph) &&
        inserted.startsWith(remainingTypedText) && remainingTypedText.length < inserted.length;
      const otherBlocksPreserved = JSON.stringify(await unchangedBlocks()) === JSON.stringify(otherBlocksBefore);
      const undoRestored = after === before;
      await record(page, info, 'typing-undo', { undoRestored, restoredTextAndMark: undoRestored,
        undoChangedOnlyTypedSuffix, otherBlocksPreserved, remainingTypedText, before, after,
        limitation: 'One native Undo may revert one typing group rather than the whole string; production history grouping is not implemented' });
      // The first expanded run reverted only the final character in Chromium;
      // three unchanged repeats reverted the whole string. Preserve that evidence
      // and measure grouping instead of assuming one browser Undo equals one command.
      expect(undoChangedOnlyTypedSuffix).toBe(true);
      expect(otherBlocksPreserved).toBe(true);
      await expect(page.locator('#p1 strong')).toHaveText('bold');
    });
    test('forward shift selection across paragraph boundary', async ({ page }, info) => {
      await caret(page, 'p1', true);
      for (let i=0; i<7; i++) await page.keyboard.press('Shift+ArrowRight');
      const selection = await page.evaluate(() => window.spike.snapshot().selection);
      await record(page, info, 'shift-forward', { reachesNextBlock: selection.focus.block === 'p2', selection });
    });
    test('backward shift selection across paragraph boundary', async ({ page }, info) => {
      await caret(page, 'p2');
      for (let i=0; i<7; i++) await page.keyboard.press('Shift+ArrowLeft');
      const selection = await page.evaluate(() => window.spike.snapshot().selection);
      await record(page, info, 'shift-backward', { reachesPreviousBlock: selection.focus.block === 'p1', selection });
    });
    test('native select all scope', async ({ page }, info) => {
      await caret(page, 'p2');
      await page.keyboard.press('ControlOrMeta+a');
      const selection = await page.evaluate(() => window.spike.snapshot().selection);
      await record(page, info, 'select-all', { wholeDocument: selection.text.includes('Alpha') && selection.text.includes('Charlie'), excludesChrome: !selection.text.includes('Diagnostics'), selection });
    });
    test('mouse drag through two paragraphs', async ({ page }, info) => {
      const a = await page.locator('#p1').boundingBox();
      const b = await page.locator('#p2').boundingBox();
      await page.mouse.move(a.x + 3, a.y + a.height/2);
      await page.mouse.down();
      await page.mouse.move(b.x + 90, b.y + b.height/2, { steps: 20 });
      await page.mouse.up();
      const selection = await page.evaluate(() => window.spike.snapshot().selection);
      await record(page, info, 'mouse-cross-block', { reachesNextBlock: selection.anchor.block === 'p1' && selection.focus.block === 'p2', selection });
    });
    test('tab order and accessible fields', async ({ page }, info) => {
      await page.locator('#export').focus();
      const stops = [];
      for (let i=0; i<7; i++) {
        await page.keyboard.press('Tab');
        stops.push(await page.evaluate(() => document.activeElement.id));
      }
      // Safari's default Tab policy skips buttons. Record it; do not change OS preferences.
      expect(stops).toContain('run-label');
      const aria = await page.locator('#editor').ariaSnapshot();
      await info.attach('aria-tree', { body: aria, contentType: 'text/plain' });
      const axe = await new AxeBuilder({ page }).analyze();
      await record(page, info, 'keyboard-ax-axe', { stops, axeViolations: axe.violations, limitation: 'Not a real screen reader test' });
      expect(axe.violations).toEqual([]);
    });
    test('tab topology and return caret', async ({ page }, info) => {
      await caret(page, 'p1', true);
      await page.keyboard.press('Tab');
      const outside = await page.evaluate(() => document.activeElement.id);
      await page.keyboard.press('Shift+Tab');
      const returned = await page.evaluate(() => document.activeElement.id);
      await page.keyboard.type('Z');
      await record(page, info, 'tab-return', { nextTabStop: outside, returned, text: await page.locator('#editor').innerText(), limitation: 'Tab stays within document for islands; no bookmark restoration implemented' });
    });
    test('Unicode insertion is not OS IME', async ({ page }, info) => {
      await caret(page, 'p1', true);
      await page.keyboard.insertText(' Русский 日本語 é 👩🏽‍💻');
      await expect(page.locator('#p1')).toContainText(' Русский 日本語 é 👩🏽‍💻');
      await record(page, info, 'unicode-insert', { textPreserved: true, OS_IME: 'NOT_RUN', reason: 'insertText does not use OS input method' });
    });
    test('selection through atom and nested block with scroll', async ({ page }, info) => {
      await caret(page, 'p1');
      for (let i=0; i<20; i++) await page.keyboard.press('Shift+ArrowDown');
      const s = await page.evaluate(() => window.spike.snapshot().selection);
      const scrollTop = await page.locator('.viewport').evaluate(el => el.scrollTop);
      await record(page, info, 'nested-scroll', { reachesNested: s.focus.block === 'p3', includesAtom: s.text.includes('Reference card'), scrolled: scrollTop > 0, scrollTop, selection: s });
    });
    test('native copy cut paste and undo scope', async ({ page }, info) => {
      // Seed a unique fixture marker before any user edit/history. Typing it first
      // conflates the cut/undo observation with browser typing-history grouping.
      const marker = ` clip-${randomUUID()}`;
      await page.locator('#p2').evaluate((p, value) => p.append(document.createTextNode(value)), marker);
      await caret(page, 'p2', true);
      const before = await page.locator('#editor').innerText();
      await page.keyboard.press('ControlOrMeta+a');
      const selected = await page.evaluate(() => getSelection().toString());
      await page.keyboard.press('ControlOrMeta+c');
      await page.locator('#clipboard-sink').focus();
      await page.keyboard.press('ControlOrMeta+v');
      const copied = await page.locator('#clipboard-sink').inputValue();
      await caret(page, 'p2');
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.press('ControlOrMeta+x');
      const afterCut = await page.locator('#editor').innerText();
      await page.keyboard.press('ControlOrMeta+z');
      const restored = await page.locator('#editor').innerText();
      const freshClipboard = copied.includes(marker);
      const exactClipboard = selected === copied;
      const nfcEquivalent = selected.normalize('NFC') === copied.normalize('NFC');
      const cutChanged = afterCut !== before && !afterCut.includes(marker);
      await record(page, info, 'clipboard', { selected, copied, afterCut, freshClipboard, exactClipboard, nfcEquivalent, cutChanged, restored: restored === before, wholeDocumentCopied: copied.includes('Alpha') && copied.includes('Charlie'), clipboardAvailable: copied.length > 0 });
      expect(freshClipboard).toBe(true);
      expect(nfcEquivalent).toBe(true);
      expect(cutChanged).toBe(true);
      expect(mode === 'single' ? afterCut.trim() === '' : !afterCut.includes('Bravo') && afterCut.includes('Alpha') && afterCut.includes('Charlie')).toBe(true);
      expect(restored).toBe(before);
    });
    test('paste replaces the native cross-block selection and undo restores text', async ({ page }, info) => {
      // Copy a fresh marker from a separate plain-text source. Its presence in the
      // editor proves this paste did not reuse an old clipboard payload.
      const marker = `paste-${randomUUID()}`;
      await page.locator('#clipboard-sink').fill(marker);
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.press('ControlOrMeta+c');
      await page.locator('#clipboard-sink').fill('');
      await caret(page, 'p1', true);
      for (let i = 0; i < 7; i++) await page.keyboard.press('Shift+ArrowRight');
      const before = await page.evaluate(() => {
        const editor = document.querySelector('#editor');
        const selection = getSelection();
        const range = selection.getRangeAt(0);
        // Range textContent supplies an oracle without assuming browser-specific
        // innerText paragraph separators or forcing a cross-host DOM selection.
        const prefix = document.createRange(); prefix.selectNodeContents(editor);
        prefix.setEnd(range.startContainer, range.startOffset);
        const suffix = document.createRange(); suffix.selectNodeContents(editor);
        suffix.setStart(range.endContainer, range.endOffset);
        return { text: editor.textContent, html: editor.innerHTML,
          prefix: prefix.cloneContents().textContent, suffix: suffix.cloneContents().textContent,
          removedText: range.cloneContents().textContent, selection: window.spike.snapshot().selection };
      });
      await page.keyboard.press('ControlOrMeta+v');
      const after = await page.evaluate(() => ({ text: document.querySelector('#editor').textContent, snapshot: window.spike.snapshot() }));
      await page.keyboard.press('ControlOrMeta+z');
      const restored = await page.evaluate(() => ({ text: document.querySelector('#editor').textContent, html: document.querySelector('#editor').innerHTML }));
      const freshClipboard = after.text.split(marker).length - 1 === 1 && !before.text.includes(marker);
      const exactTextReplacement = after.text === before.prefix + marker + before.suffix;
      const undoRestored = restored.text === before.text;
      const crossBlockReplacement = before.selection.anchor.block === 'p1' && before.selection.focus.block === 'p2' && !before.selection.collapsed && exactTextReplacement;
      const met = crossBlockReplacement && freshClipboard && undoRestored;
      await record(page, info, 'paste-cross-block', { comparisonStatus: met ? 'MET' : 'GAP',
        crossBlockReplacement, freshClipboard, exactTextReplacement, undoRestored,
        undoRestoredHtml: restored.html === before.html, before, after,
        limitation: 'Islands use their actual native selection; a clipped/collapsed range is a document-scope GAP even when local paste works' });
      expect(freshClipboard).toBe(true);
      expect(exactTextReplacement).toBe(true);
      expect(undoRestored).toBe(true);
      await expect(page.locator('#p1 strong')).toHaveText('bold');
    });
    test('Enter then Backspace at a paragraph boundary records structure and IDs', async ({ page }, info) => {
      await caret(page, 'p1', true);
      const structure = () => {
        const editor = document.querySelector('#editor');
        const ids = [...editor.querySelectorAll('[id]')].map(el => el.id);
        const blocks = [...editor.querySelectorAll('[data-block]')].map(el => ({ id: el.id, block: el.dataset.block, tag: el.tagName, text: el.textContent }));
        return { text: editor.textContent, html: editor.innerHTML, ids, blocks,
          duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
          strong: [...editor.querySelectorAll('strong')].map(el => el.textContent),
          snapshot: window.spike.snapshot() };
      };
      const before = await page.evaluate(structure);
      await page.keyboard.press('Enter');
      const afterEnter = await page.evaluate(structure);
      await page.keyboard.press('Backspace');
      const afterBackspace = await page.evaluate(structure);
      const enterChangedStructure = afterEnter.html !== before.html;
      const enterInputObserved = afterEnter.snapshot.events.some(event => event.type === 'input' && ['insertParagraph', 'insertLineBreak'].includes(event.inputType));
      const restoredText = afterBackspace.text === before.text;
      await record(page, info, 'enter-backspace-boundary', { enterChangedStructure, enterInputObserved, restoredText,
        restoredHtml: afterBackspace.html === before.html, restoredIds: JSON.stringify(afterBackspace.ids) === JSON.stringify(before.ids),
        before, afterEnter, afterBackspace,
        limitation: 'Native DOM split/merge observation only; model transactions and stable identity reconciliation are not implemented' });
      expect(enterChangedStructure).toBe(true);
      expect(enterInputObserved).toBe(true);
      expect(restoredText).toBe(true);
      expect(afterBackspace.strong).toEqual(before.strong);
      for (const block of ['p2', 'card', 'p3']) {
        expect(afterBackspace.blocks.find(item => item.block === block)?.text).toBe(before.blocks.find(item => item.block === block)?.text);
      }
    });
    test('held mouse selection autoscrolls across the atom into the nested block', async ({ page }, info) => {
      await page.goto(`/?mode=${mode}&native=1`);
      await caret(page, 'p1');
      const before = await page.evaluate(() => window.spike.snapshot());
      expect(before.viewport.scrollTop).toBe(0);
      const p1 = await page.locator('#p1').boundingBox();
      const rect = before.viewport.rect;
      const clip = await page.locator('.viewport').evaluate(el => ({ left: el.clientLeft, top: el.clientTop, width: el.clientWidth, height: el.clientHeight }));
      const start = { x: p1.x + 3, y: p1.y + p1.height / 2 };
      const outside = { x: p1.x + 90, y: rect.y + rect.height + 16 };
      const endpointVisibility = snapshot => {
        const focus = snapshot.focusRect;
        const viewport = snapshot.viewport.rect;
        // Preserve the earlier intersection metric, but it cannot establish a
        // fully visible caret. The strict predicate uses the actual client clip
        // (excluding borders/scrollbars), with no pixel tolerance.
        const intersects = focus !== null && focus.height > 0 && focus.y < viewport.y + viewport.height &&
          focus.y + focus.height > viewport.y && focus.x >= viewport.x && focus.x <= viewport.x + viewport.width;
        const left = viewport.x + clip.left;
        const top = viewport.y + clip.top;
        const full = focus !== null && focus.height > 0 && focus.x >= left && focus.x + focus.width <= left + clip.width &&
          focus.y >= top && focus.y + focus.height <= top + clip.height;
        return { intersects, full };
      };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      const started = Date.now();
      let held;
      try {
        await page.mouse.move(outside.x, outside.y, { steps: 20 });
        // Wait for native scroll ticks with the button still held. Do not use
        // scrollIntoView, wheel input or keyboard selection to manufacture success.
        for (let i = 0; i < 20; i++) {
          await page.waitForTimeout(100);
          held = await page.evaluate(() => window.spike.snapshot());
          if (held.viewport.scrollTop > before.viewport.scrollTop && held.selection.focus.block === 'p3' && endpointVisibility(held).full) break;
        }
      } finally {
        await page.mouse.up();
      }
      const after = await page.evaluate(() => window.spike.snapshot());
      const reachesNested = after.selection.anchor.block === 'p1' && after.selection.focus.block === 'p3';
      const includesAtom = after.selection.text.includes('Reference card');
      const scrolled = after.viewport.scrollTop > before.viewport.scrollTop;
      const visible = endpointVisibility(after);
      const met = reachesNested && includesAtom && scrolled && visible.full;
      await record(page, info, 'mouse-autoscroll', { comparisonStatus: met ? 'MET' : 'GAP', reachesNested, includesAtom, scrolled,
        endpointVisible: visible.intersects, endpointIntersectsViewport: visible.intersects, endpointFullyVisible: visible.full,
        viewportClientClip: clip, visibilityTolerancePx: 0, start, outside, heldMs: Date.now() - started, before, held, after,
        limitation: 'endpointVisible is the legacy intersection metric; MET requires endpointFullyVisible. A clipped caret or islands selection remains GAP' });
      expect(after.text).toBe(before.text);
      expect(after.html).toBe(before.html);
    });
    test('explicit leave and return to same host', async ({ page }, info) => {
      await caret(page, 'p1', true);
      const host = mode === 'single' ? '#editor' : '#p1';
      await page.locator('#after').focus();
      await page.locator(host).focus();
      await page.keyboard.type('Z');
      const text = await page.locator('#p1').innerText();
      await record(page, info, 'same-host-focus-return', { caretRestored: text === 'Alpha bold omega.Z', text, limitation: 'No saved selection bookmark/controller' });
    });
    test('composition instrumentation synthetic control only', async ({ page }, info) => {
      await caret(page, 'p1', true);
      await page.locator('#p1').dispatchEvent('compositionstart', { data: '' });
      expect(await page.evaluate(() => window.spike.snapshot().composing)).toBe(true);
      await page.locator('#p1').dispatchEvent('compositionend', { data: '字' });
      expect(await page.evaluate(() => window.spike.snapshot().composing)).toBe(false);
      await expect(page.locator('#p1')).toHaveText('Alpha bold omega.');
      await record(page, info, 'synthetic-control', { OS_IME: 'NOT_RUN', reason: 'No native default action; proves recording only' });
    });
  });
}
