// SPDX-License-Identifier: MIT OR Apache-2.0
import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { BUDGETS } from '../scripts/mounted-corpus/protocol.mjs';

const runRoot = process.env.KLENWRITER_MOUNTED_RUN_ROOT;
if (!runRoot) throw new Error('Use npm run test:mounted-corpus to create an immutable current RunBinding');
const binding = JSON.parse(readFileSync(resolve(runRoot, 'run-binding.json'), 'utf8'));
const manifest = JSON.parse(readFileSync('contracts/mounted-e2e/v1/manifest.json', 'utf8'));
const rows = manifest.rows.filter(row => row.initial);
for (const [index, row] of rows.entries()) test(row.rowId, async ({ page }, testInfo) => {
  const engine = testInfo.project.name;
  await page.goto(`/mounted-corpus?engine=${engine}`);
  await page.waitForFunction(() => !!window.mountedCorpus45, null, { timeout: BUDGETS.readyMs });
  const ready = await page.evaluate(() => window.mountedCorpus45.ready);
  expect(ready.engine).toBe(engine);
  expect(ready.module.buildId).toBe(binding.build.buildId);
  const observation = await page.evaluate(({ rowId, binding }) => window.mountedCorpus45.run(rowId, binding), { rowId: row.rowId, binding });
  const bytes = Buffer.from(JSON.stringify(observation) + '\n');
  expect(bytes.length).toBeLessThanOrEqual(BUDGETS.observationBytes);
  const path = resolve(runRoot, `observations/${engine}/${String(index).padStart(3, '0')}.json`);
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes, { flag: 'wx' });
  // Behavior belongs to the independent collector, including Firefox's tier.
  expect(observation.engine).toBe(engine);
  expect(observation.rowId).toBe(row.rowId);
  expect(observation.runId).toBe(binding.runId);
});
