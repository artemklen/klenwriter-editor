import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: '**/workspace-browser.spec.js',
  outputDir: 'artifacts/browser-results',
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'artifacts/browser.json' }]],
  use: { baseURL: 'http://127.0.0.1:4190', trace: 'retain-on-failure' },
  projects: ['chromium', 'firefox', 'webkit'].map(name => ({ name, use: { browserName: name } })),
  webServer: { command: 'node scripts/workspace-server.mjs', url: 'http://127.0.0.1:4190', reuseExistingServer: false },
});
