import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: '**/editing-hosts.spec.js',
  fullyParallel: true,
  // Native clipboard is shared by browsers on macOS: keep copy/cut/paste deterministic.
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1100, height: 900 }, trace: 'off', screenshot: 'off', video: 'off' },
  projects: ['chromium','firefox','webkit'].map(name => ({ name, use: { browserName: name } })),
  webServer: { command: 'npm start', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
});
