import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('versioned codec transport preserves u64 and structured refusals under browser CSP', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const observations = await page.evaluate(async () => {
    const module = await import('/editor_wasm.js');
    await module.default();
    const options = JSON.stringify({ abi: 'kwdj-codec/1', identities: { media: [], references: [] } });
    const raw = '{"schema":"klenwriter.document","schema_version":1,"profile":"poetry","content":[{"type":"verse","content":[{"type":"verse_line","content":[{"type":"text","text":"a"}]},{"type":"stanza_break","attrs":{"blank_lines":18446744073709551615}},{"type":"verse_line","content":[{"type":"text","text":"b"}]}]}]}';
    return ['kwdjValidateV1', 'kwdjNormalizeV1', 'kwdjCanonicalV1'].map(name => ({
      accepted: JSON.parse(module[name](new TextEncoder().encode(raw), options)),
      refused: JSON.parse(module[name](new TextEncoder().encode(raw), JSON.stringify({ abi: 'kwdj-codec/1', identities: { media: [], references: [] }, budget: { raw_input_bytes: '0' } }))),
      invalid: JSON.parse(module[name]({}, options)),
    }));
  });
  for (const result of observations) {
    expect(result.accepted.status).toBe('accepted');
    expect(result.accepted.canonical_json).toContain('"blank_lines":18446744073709551615');
    expect(result.refused.diagnostic.limit).toBe('raw_input_bytes');
    expect(result.refused.diagnostic.maximum).toBe('0');
    expect(result.invalid.diagnostic.code).toBe('codec.invalid_input_type');
  }
  expect(errors).toEqual([]);
});

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

test('compiled Rust admission refuses before parse and snapshot copies', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const completed = await page.evaluate(async () => {
    const { default: init, runAdmissionBudgetCases } = await import('/admission-budget/probe.js');
    await init();
    return runAdmissionBudgetCases();
  });
  expect(completed).toBe(9);
  expect(errors).toEqual([]);
});
