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
    test('typing and browser undo', async ({ page }, info) => {
      await caret(page, 'p1', true);
      const before = await page.locator('#editor').innerText();
      await page.keyboard.type(' test');
      await expect(page.locator('#p1')).toHaveText('Alpha bold omega. test');
      await page.keyboard.press('ControlOrMeta+z');
      await expect(page.locator('#editor')).toHaveText(before, { useInnerText: true });
      await expect(page.locator('#p1 strong')).toHaveText('bold');
      await record(page, info, 'typing-undo', { restoredTextAndMark: true });
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
