import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('compiled Rust artifact loads through web glue under CSP with static CSS', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const info = await page.evaluate(async () => {
    const { default: init, buildInfo } = await import('/editor_wasm.js');
    await init();
    return buildInfo();
  });
  expect(info).toEqual(JSON.parse(readFileSync('artifacts/native-build-info.json', 'utf8')));
  expect(await page.locator('main').evaluate(el => getComputedStyle(el).whiteSpace)).toBe('pre-wrap');
  expect(errors).toEqual([]);
});


test('compiled Rust projection budgets refuse expansion and preserve canonical data', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const completed = await page.evaluate(async () => {
    const { default: init, runProjectionBudgetCases } = await import('/projection-budget/probe.js');
    await init();
    return runProjectionBudgetCases();
  });
  expect(completed).toBe(6);
  expect(errors).toEqual([]);
});
