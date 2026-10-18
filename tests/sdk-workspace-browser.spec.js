import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

test('packaged headless SDK runs real Session lifecycle and releases resources under strict CSP', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto('/sdk');
  const csp = response.headers()['content-security-policy'];
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("'wasm-unsafe-eval'");
  expect(csp).not.toContain("'unsafe-inline'");
  expect(csp).not.toMatch(/(?:^|\s)'unsafe-eval'/);
  const html = readFileSync('spikes/workspace/sdk-host.html', 'utf8');
  const map = /<script type="importmap">([^<]+)<\/script>/.exec(html)[1];
  expect(csp).toContain(`'sha256-${createHash('sha256').update(map).digest('base64')}'`);
  const result = await page.evaluate(async () => {
    const violations = [];
    const record = event => violations.push({ directive: event.violatedDirective, blocked: event.blockedURI });
    document.addEventListener('securitypolicyviolation', record);
    try {
      const { runSdkHost } = await import('/sdk-host.js');
      return { report: await runSdkHost(12), violations };
    } finally { document.removeEventListener('securitypolicyviolation', record); }
  });
  expect(result.report.status).toBe('passed');
  expect(result.report.cycles).toBe(12);
  expect(result.report.late_callbacks_refused).toBe(25);
  expect(result.report.native_final).toEqual(result.report.native_baseline);
  expect(result.report.native_final).toEqual({ sessions: 0, snapshot_handles: 0, snapshot_bytes: '0', protected_cursors: 0 });
  expect(result.report.exact_space_nbsp).toBe(true);
  expect(result.report.retained_snapshot_listener_request_cleanup).toBe(true);
  const expected = JSON.parse(readFileSync('artifacts/sdk-build-identity.json', 'utf8'));
  expect(result.report.build_id).toBe(expected.buildId);
  expect(result.violations).toEqual([]);
  expect(errors).toEqual([]);
});
