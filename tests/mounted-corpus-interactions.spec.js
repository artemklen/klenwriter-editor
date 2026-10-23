// SPDX-License-Identifier: MIT OR Apache-2.0
// Four genuine browser-protocol routes; installed/native and human lanes are separate.
import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync, lstatSync, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { resolve as resolvePath, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ENGINES } from '../scripts/mounted-corpus/protocol.mjs';
import { assessInteraction, interactionValidators } from '../scripts/mounted-corpus/collect-interactions.mjs';
import { RESOURCE_PROFILE67_ID, assertResourceProfileBinding67 } from '../scripts/mounted-corpus/resource-profile67.mjs';

const literalPath = 'contracts/mounted-e2e/v1/interaction-literals.json';
const literalBytes = readFileSync(literalPath), contract = JSON.parse(literalBytes);
const resourceProfile = RESOURCE_PROFILE67_ID;
const schemaPath = 'contracts/mounted-e2e/v1/observation.schema.json';
const repository = fileURLToPath(new URL('../', import.meta.url));
// This is the original current-source reader, not a historical authority alias.
const readResourceProfileArtifact = async (path, maximum) => {
  if (typeof path !== 'string' || !path || path.length > 4096 || path.startsWith('/')
    || path.includes('\\') || path.includes('\0') || path.split('/').some(part => !part || part === '.' || part === '..')
    || !Number.isSafeInteger(maximum) || maximum < 0 || maximum > 268435456) throw new Error('Invalid bounded resource-profile source read');
  let current = repository;
  for (const part of path.split('/')) { current = join(current, part); if (lstatSync(current).isSymbolicLink()) throw new Error(`Resource-profile source symlink: ${path}`); }
  const file = openSync(current, 'r');
  try {
    const before = fstatSync(file);
    if (!before.isFile() || before.size > maximum) throw new Error(`Resource-profile source exceeds bound: ${path}`);
    const bytes = Buffer.alloc(before.size + 1); let length = 0;
    while (length < bytes.length) { const read = readSync(file, bytes, length, bytes.length - length, length); if (!read) break; length += read; }
    const after = fstatSync(file);
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error(`Resource-profile source changed during read: ${path}`);
    return bytes.subarray(0, length);
  } finally { closeSync(file); }
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pin = { path: literalPath, bytes: literalBytes.length, sha256: hash(literalBytes) };
const invoke = (page, method, ...args) => page.evaluate(({ method, args }) => window.mountedInteractions45[method](...args), { method, args });
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

for (const route of contract.routes) test(`mounted interaction ${route.routeId}`, async ({ page, browser }, info) => {
  const runRoot = process.env.KLENWRITER_MOUNTED_RUN_ROOT;
  if (!runRoot || resolvePath(runRoot) !== runRoot) throw new Error('Absolute immutable mounted run root required');
  const binding = JSON.parse(readFileSync(join(runRoot, 'run-binding.json'), 'utf8'));
  if (!ENGINES.includes(info.project.name) || binding.environment.engines.find(value => value.engine === info.project.name)?.browserVersion !== browser.version()) throw new Error('Actual browser version differs from frozen binding');
  await assertResourceProfileBinding67({ resourceProfile, runBinding: binding, readArtifact: readResourceProfileArtifact });
  const schemaBytes = await readResourceProfileArtifact(schemaPath, 262144), schemaPins = binding.scenarioPins.filter(value => value.path === schemaPath);
  if (schemaPins.length !== 1 || schemaPins[0].bytes !== schemaBytes.length || schemaPins[0].sha256 !== hash(schemaBytes)) throw new Error('Actual base observation schema differs from its bound source');
  const validators = interactionValidators(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(schemaBytes)), { resourceProfile });
  let observation = null, harnessError = null, opened = false;
  const pageErrors = [], externalRequests = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4174/')) externalRequests.push(request.url()); });
  try {
    await page.setViewportSize({ width: 1280, height: 1000 });
    const loaded = await page.goto(`/mounted-corpus?engine=${info.project.name}`);
    const csp = loaded.headers()['content-security-policy'] ?? '';
    if (!loaded.ok() || !csp.includes("default-src 'none'") || /'unsafe-inline'|'unsafe-eval'/.test(csp)) throw new Error('Interaction CSP response integrity');
    await page.evaluate(async () => { await import('/mounted-corpus-interactions.mjs'); await window.mountedInteractions45.ready; });
    await invoke(page, 'open', route.routeId, binding); opened = true;
    const wrapper = page.locator('#mounted-interaction'), editor = wrapper.locator(':scope > [data-mounted-corpus-owner]'), handle = wrapper.locator('[data-editor-ui-control="drag"]');
    await page.bringToFront(); await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true); await frames(page);
    if (route.kind === 'selection') {
      await expect(editor).toBeFocused();
      for (let index = 0; index < 5; index++) await page.keyboard.press('Shift+ArrowLeft');
      await frames(page); await invoke(page, 'checkpoint', 'before'); await page.keyboard.type('X');
    } else if (route.kind === 'slash') {
      await expect(editor).toBeFocused(); await page.keyboard.type('/para');
      await expect(wrapper.locator('.kw-ui-slash')).toBeVisible();
      await expect(wrapper.locator('.kw-ui-slash [role="option"]')).toHaveText(['Paragraph', 'Scene break']);
      await invoke(page, 'checkpoint', 'before'); await page.keyboard.press('Enter'); await expect(wrapper.locator('.kw-ui-slash')).toBeHidden();
    } else {
      await invoke(page, 'checkpoint', 'before');
      const source = await editor.locator(':scope > blockquote').boundingBox();
      if (!source) throw new Error('Authored drag source not rendered');
      await page.mouse.move(source.x + route.pointer.inset, source.y + route.pointer.inset); await frames(page); await expect(handle).toHaveAttribute('aria-disabled', 'false');
      const gutter = await wrapper.locator('.kw-ui-gutter').boundingBox();
      if (!gutter || gutter.x < 8 || gutter.x + gutter.width > source.x - 7.5) throw new Error('Declared fixture must leave room beside the source for its external gutter');
      if (route.kind === 'drag-pointer') {
        const h = await handle.boundingBox(), target = await editor.locator(':scope > p').last().boundingBox();
        if (!h || !target) throw new Error('Authored drag endpoint unavailable');
        const down = { x: h.x + h.width / 2, y: h.y + h.height / 2 }, to = { x: target.x + Math.min(32, target.width / 2), y: target.y + target.height * Number(route.pointer.targetYFraction) };
        // Approach through real intermediate hit targets, rather than a single jump.
        await page.mouse.move(down.x, down.y, { steps: route.pointer.heldMoveSteps }); await frames(page); await page.mouse.down();
        for (let step = 1; step <= route.pointer.heldMoveSteps; step++) { await page.mouse.move(down.x + (to.x - down.x) * step / route.pointer.heldMoveSteps, down.y + (to.y - down.y) * step / route.pointer.heldMoveSteps); await frames(page); }
        await page.mouse.up();
      } else {
        await expect(editor).toBeFocused();
        for (let tabs = 0; tabs < 16 && !await handle.evaluate(node => node === document.activeElement); tabs++) await page.keyboard.press('Tab');
        await expect(handle).toBeFocused(); await page.keyboard.press('Enter');
        const menu = wrapper.locator('.kw-ui-popup[role="menu"]'); await expect(menu).toBeVisible();
        await expect(menu.locator('[data-editor-ui-action="up"]')).toBeFocused(); await page.keyboard.press('ArrowDown');
        await expect(menu.locator('[data-editor-ui-action="down"]')).toBeFocused(); await page.keyboard.press('Enter'); await expect(menu).toBeHidden();
      }
    }
    await frames(page); await invoke(page, 'checkpoint', 'after');
    await invoke(page, 'history', 'undo'); await invoke(page, 'history', 'redo');
  } catch (error) { harnessError = { name: error.name, message: error.message }; }
  finally {
    // Always retain partial originals. A behavior timeout never manufactures a later phase.
    if (opened || await page.evaluate(() => !!window.mountedInteractions45).catch(() => false)) {
      try { observation = await invoke(page, 'finish'); } catch (error) { harnessError ??= { name: error.name, message: error.message }; }
    }
  }
  const assessment = assessInteraction({ observation, route, binding, harnessError, contract, pin, validators, resourceProfile });
  if (pageErrors.length || externalRequests.length) { assessment.integrity = 'FAIL'; assessment.requirement = 'OBSERVATION'; assessment.blocking = true; }
  const artifact = { format: 'mounted-corpus-interaction-receipt/1', runId: binding.runId, engine: info.project.name, routeId: route.routeId,
    observation, assessment, harnessError, pageErrors, externalRequests };
  const json = JSON.stringify(artifact, null, 2) + '\n';
  if (Buffer.byteLength(json) > contract.budgets.artifactBytes) throw new Error('Interaction original artifact bound');
  const directory = join(runRoot, 'interactions', info.project.name); mkdirSync(directory, { recursive: true });
  const path = join(directory, `${route.routeId}.json`); writeFileSync(path, json, { flag: 'wx' });
  await info.attach('mounted-interaction-original', { path, contentType: 'application/json' });
  expect(assessment.blocking, JSON.stringify({ integrity: assessment.integrity, requirement: assessment.requirement, cleanup: assessment.cleanup, gaps: assessment.checks.filter(value => value.status !== 'MET') })).toBe(false);
});
