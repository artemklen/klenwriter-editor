# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: editing-hosts.spec.js >> single >> typing and browser undo
- Location: tests/editing-hosts.spec.js:64:5

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator: locator('#editor')
Timeout: 5000ms
- Expected  - 1
+ Received  + 1

@@ -1,6 +1,6 @@
- Alpha bold omega.
+ Alpha bold omega. tes

  Bravo café 👩🏽‍💻 é.

  Reference card · atomic, not editable
  ↵

Call log:
  - Expect "toHaveText" locator('#editor') with timeout 5000ms
  - waiting for locator('#editor')
    14 × locator resolved to <div id="editor" tabindex="0" role="textbox" aria-multiline="true" contenteditable="true" aria-label="Sample document" aria-describedby="instructions">…</div>
       - unexpected value "Alpha bold omega. tes

Bravo café 👩🏽‍💻 é.

Reference card · atomic, not editable

Charlie nested paragraph. Русский текст. 日本語."

```

```yaml
- textbox "Sample document":
  - paragraph:
    - text: Alpha
    - strong: bold
    - text: omega. tes
  - paragraph: Bravo café 👩🏽‍💻 é.
  - group "Read-only reference card": Reference card · atomic, not editable
  - blockquote:
    - paragraph: Charlie nested paragraph. Русский текст. 日本語.
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | import AxeBuilder from '@axe-core/playwright';
  3   | import { randomUUID } from 'node:crypto';
  4   | 
  5   | const modes = ['single', 'islands'];
  6   | // Only seeds the starting caret. The action being measured uses browser keyboard/mouse input.
  7   | async function caret(page, block, end = false) {
  8   |   await page.locator(`#${block}`).click();
  9   |   await page.evaluate(({ block, end }) => {
  10  |     const p = document.getElementById(block);
  11  |     const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  12  |     const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  13  |     const node = end ? nodes.at(-1) : nodes[0];
  14  |     getSelection().setBaseAndExtent(node, end ? node.length : 0, node, end ? node.length : 0);
  15  |   }, { block, end });
  16  | }
  17  | async function record(page, testInfo, scenario, observation) {
  18  |   const snapshot = await page.evaluate(() => window.spike.snapshot());
  19  |   await testInfo.attach('observation', { body: JSON.stringify({ scenario, project: testInfo.project.name, observation, snapshot }, null, 2), contentType: 'application/json' });
  20  | }
  21  | for (const mode of modes) {
  22  |   test.describe(mode, () => {
  23  |     test.beforeEach(async ({ page }) => { await page.goto(`/?mode=${mode}`); });
  24  |     test('fixture, CSP and WASM loading', async ({ page, request, browser }, info) => {
  25  |       const response = await request.get('/');
  26  |       expect(response.headers()['content-security-policy']).toContain("'wasm-unsafe-eval'");
  27  |       expect(response.headers()['content-security-policy']).not.toContain("'unsafe-eval'");
  28  |       await expect(page.locator('#wasm-status')).toContainText('allowed');
  29  |       expect(await page.locator('#editor [contenteditable="true"]').count()).toBe(mode === 'single' ? 0 : 3);
  30  |       const violations = await page.evaluate(async () => {
  31  |         const results = [];
  32  |         document.addEventListener('securitypolicyviolation', e => results.push(e.violatedDirective));
  33  |         const script = document.createElement('script'); script.textContent = 'window.inlineExecuted = true'; document.body.append(script);
  34  |         await new Promise(resolve => setTimeout(resolve, 50));
  35  |         return { results, executed: window.inlineExecuted === true };
  36  |       });
  37  |       expect(violations.executed).toBe(false);
  38  |       expect(violations.results).toContain('script-src-elem');
  39  |       await record(page, info, 'csp-fixture', { browserVersion: browser.version(), inlineBlocked: true, emptyWasmAllowed: true });
  40  |     });
  41  |     test('native fixture hides diagnostic copies and records caret geometry', async ({ page }, info) => {
  42  |       await page.goto(`/?mode=${mode}&native=1`);
  43  |       await expect(page.locator('#wasm-status')).toContainText('allowed');
  44  |       await expect(page.locator('#diagnostics')).toBeHidden();
  45  |       await caret(page, 'p1');
  46  |       const snapshot = await page.evaluate(() => window.spike.snapshot());
  47  |       const { viewport, focusRect } = snapshot;
  48  |       expect(snapshot.nativeMode).toBe(true);
  49  |       expect(snapshot.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
  50  |       expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
  51  |       expect(viewport.rect.width).toBeGreaterThan(0);
  52  |       expect(viewport.rect.height).toBeGreaterThan(0);
  53  |       expect(viewport.scrollTop).toBe(0);
  54  |       expect(focusRect).not.toBeNull();
  55  |       expect(focusRect.height).toBeGreaterThan(0);
  56  |       expect(focusRect.y).toBeGreaterThanOrEqual(viewport.rect.y);
  57  |       expect(focusRect.y + focusRect.height).toBeLessThanOrEqual(viewport.rect.y + viewport.rect.height);
  58  |       for (const id of ['single-link', 'islands-link']) {
  59  |         await expect(page.locator(`#${id}`)).toHaveAttribute('href', /[?&]native=1(?:&|$)/);
  60  |       }
  61  |       await record(page, info, 'native-fixture', { diagnosticsHidden: true, viewport, focusRect,
  62  |         limitation: 'Geometry/fixture check only; browser Find requires the native browser UI' });
  63  |     });
  64  |     test('typing and browser undo', async ({ page }, info) => {
  65  |       await caret(page, 'p1', true);
  66  |       const before = await page.locator('#editor').innerText();
  67  |       await page.keyboard.type(' test');
  68  |       await expect(page.locator('#p1')).toHaveText('Alpha bold omega. test');
  69  |       await page.keyboard.press('ControlOrMeta+z');
> 70  |       await expect(page.locator('#editor')).toHaveText(before, { useInnerText: true });
      |                                             ^ Error: expect(locator).toHaveText(expected) failed
  71  |       await expect(page.locator('#p1 strong')).toHaveText('bold');
  72  |       await record(page, info, 'typing-undo', { restoredTextAndMark: true });
  73  |     });
  74  |     test('forward shift selection across paragraph boundary', async ({ page }, info) => {
  75  |       await caret(page, 'p1', true);
  76  |       for (let i=0; i<7; i++) await page.keyboard.press('Shift+ArrowRight');
  77  |       const selection = await page.evaluate(() => window.spike.snapshot().selection);
  78  |       await record(page, info, 'shift-forward', { reachesNextBlock: selection.focus.block === 'p2', selection });
  79  |     });
  80  |     test('backward shift selection across paragraph boundary', async ({ page }, info) => {
  81  |       await caret(page, 'p2');
  82  |       for (let i=0; i<7; i++) await page.keyboard.press('Shift+ArrowLeft');
  83  |       const selection = await page.evaluate(() => window.spike.snapshot().selection);
  84  |       await record(page, info, 'shift-backward', { reachesPreviousBlock: selection.focus.block === 'p1', selection });
  85  |     });
  86  |     test('native select all scope', async ({ page }, info) => {
  87  |       await caret(page, 'p2');
  88  |       await page.keyboard.press('ControlOrMeta+a');
  89  |       const selection = await page.evaluate(() => window.spike.snapshot().selection);
  90  |       await record(page, info, 'select-all', { wholeDocument: selection.text.includes('Alpha') && selection.text.includes('Charlie'), excludesChrome: !selection.text.includes('Diagnostics'), selection });
  91  |     });
  92  |     test('mouse drag through two paragraphs', async ({ page }, info) => {
  93  |       const a = await page.locator('#p1').boundingBox();
  94  |       const b = await page.locator('#p2').boundingBox();
  95  |       await page.mouse.move(a.x + 3, a.y + a.height/2);
  96  |       await page.mouse.down();
  97  |       await page.mouse.move(b.x + 90, b.y + b.height/2, { steps: 20 });
  98  |       await page.mouse.up();
  99  |       const selection = await page.evaluate(() => window.spike.snapshot().selection);
  100 |       await record(page, info, 'mouse-cross-block', { reachesNextBlock: selection.anchor.block === 'p1' && selection.focus.block === 'p2', selection });
  101 |     });
  102 |     test('tab order and accessible fields', async ({ page }, info) => {
  103 |       await page.locator('#export').focus();
  104 |       const stops = [];
  105 |       for (let i=0; i<7; i++) {
  106 |         await page.keyboard.press('Tab');
  107 |         stops.push(await page.evaluate(() => document.activeElement.id));
  108 |       }
  109 |       // Safari's default Tab policy skips buttons. Record it; do not change OS preferences.
  110 |       expect(stops).toContain('run-label');
  111 |       const aria = await page.locator('#editor').ariaSnapshot();
  112 |       await info.attach('aria-tree', { body: aria, contentType: 'text/plain' });
  113 |       const axe = await new AxeBuilder({ page }).analyze();
  114 |       await record(page, info, 'keyboard-ax-axe', { stops, axeViolations: axe.violations, limitation: 'Not a real screen reader test' });
  115 |       expect(axe.violations).toEqual([]);
  116 |     });
  117 |     test('tab topology and return caret', async ({ page }, info) => {
  118 |       await caret(page, 'p1', true);
  119 |       await page.keyboard.press('Tab');
  120 |       const outside = await page.evaluate(() => document.activeElement.id);
  121 |       await page.keyboard.press('Shift+Tab');
  122 |       const returned = await page.evaluate(() => document.activeElement.id);
  123 |       await page.keyboard.type('Z');
  124 |       await record(page, info, 'tab-return', { nextTabStop: outside, returned, text: await page.locator('#editor').innerText(), limitation: 'Tab stays within document for islands; no bookmark restoration implemented' });
  125 |     });
  126 |     test('Unicode insertion is not OS IME', async ({ page }, info) => {
  127 |       await caret(page, 'p1', true);
  128 |       await page.keyboard.insertText(' Русский 日本語 é 👩🏽‍💻');
  129 |       await expect(page.locator('#p1')).toContainText(' Русский 日本語 é 👩🏽‍💻');
  130 |       await record(page, info, 'unicode-insert', { textPreserved: true, OS_IME: 'NOT_RUN', reason: 'insertText does not use OS input method' });
  131 |     });
  132 |     test('selection through atom and nested block with scroll', async ({ page }, info) => {
  133 |       await caret(page, 'p1');
  134 |       for (let i=0; i<20; i++) await page.keyboard.press('Shift+ArrowDown');
  135 |       const s = await page.evaluate(() => window.spike.snapshot().selection);
  136 |       const scrollTop = await page.locator('.viewport').evaluate(el => el.scrollTop);
  137 |       await record(page, info, 'nested-scroll', { reachesNested: s.focus.block === 'p3', includesAtom: s.text.includes('Reference card'), scrolled: scrollTop > 0, scrollTop, selection: s });
  138 |     });
  139 |     test('native copy cut paste and undo scope', async ({ page }, info) => {
  140 |       // Seed a unique fixture marker before any user edit/history. Typing it first
  141 |       // conflates the cut/undo observation with browser typing-history grouping.
  142 |       const marker = ` clip-${randomUUID()}`;
  143 |       await page.locator('#p2').evaluate((p, value) => p.append(document.createTextNode(value)), marker);
  144 |       await caret(page, 'p2', true);
  145 |       const before = await page.locator('#editor').innerText();
  146 |       await page.keyboard.press('ControlOrMeta+a');
  147 |       const selected = await page.evaluate(() => getSelection().toString());
  148 |       await page.keyboard.press('ControlOrMeta+c');
  149 |       await page.locator('#clipboard-sink').focus();
  150 |       await page.keyboard.press('ControlOrMeta+v');
  151 |       const copied = await page.locator('#clipboard-sink').inputValue();
  152 |       await caret(page, 'p2');
  153 |       await page.keyboard.press('ControlOrMeta+a');
  154 |       await page.keyboard.press('ControlOrMeta+x');
  155 |       const afterCut = await page.locator('#editor').innerText();
  156 |       await page.keyboard.press('ControlOrMeta+z');
  157 |       const restored = await page.locator('#editor').innerText();
  158 |       const freshClipboard = copied.includes(marker);
  159 |       const exactClipboard = selected === copied;
  160 |       const nfcEquivalent = selected.normalize('NFC') === copied.normalize('NFC');
  161 |       const cutChanged = afterCut !== before && !afterCut.includes(marker);
  162 |       await record(page, info, 'clipboard', { selected, copied, afterCut, freshClipboard, exactClipboard, nfcEquivalent, cutChanged, restored: restored === before, wholeDocumentCopied: copied.includes('Alpha') && copied.includes('Charlie'), clipboardAvailable: copied.length > 0 });
  163 |       expect(freshClipboard).toBe(true);
  164 |       expect(nfcEquivalent).toBe(true);
  165 |       expect(cutChanged).toBe(true);
  166 |       expect(mode === 'single' ? afterCut.trim() === '' : !afterCut.includes('Bravo') && afterCut.includes('Alpha') && afterCut.includes('Charlie')).toBe(true);
  167 |       expect(restored).toBe(before);
  168 |     });
  169 |     test('paste replaces the native cross-block selection and undo restores text', async ({ page }, info) => {
  170 |       // Copy a fresh marker from a separate plain-text source. Its presence in the
```