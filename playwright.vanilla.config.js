// SPDX-License-Identifier: MIT OR Apache-2.0
import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4174';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/vanilla-lifecycle.browser.mjs',
  outputDir: 'artifacts/vanilla/browser-results',
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'artifacts/vanilla/browser.json' }]],
  use: { baseURL },
  projects: ['chromium', 'webkit'].map(browserName => ({ name: browserName, use: { browserName } })),
  webServer: {
    command: 'node scripts/workspace-server.mjs',
    url: `${baseURL}/dom`,
    reuseExistingServer: false,
  },
});
