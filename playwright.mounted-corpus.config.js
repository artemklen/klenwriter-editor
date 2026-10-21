// SPDX-License-Identifier: MIT OR Apache-2.0
import { defineConfig, chromium, webkit, firefox } from '@playwright/test';

const browserTypes = { chromium, webkit, firefox };

export default defineConfig({
  testDir: './tests',
  testMatch: ['mounted-corpus-browser.spec.js', 'mounted-corpus-interactions.spec.js'],
  outputDir: 'artifacts/mounted-corpus/browser-results',
  workers: 1,
  retries: 0,
  timeout: 90000,
  reporter: [['list'], ['json', { outputFile: 'artifacts/mounted-corpus/playwright.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: ['chromium', 'webkit', 'firefox'].map(name => ({ name, use: {
    browserName: name, launchOptions: { executablePath: browserTypes[name].executablePath() },
  } })),
  webServer: {
    command: 'node scripts/workspace-server.mjs',
    url: 'http://127.0.0.1:4174/mounted-corpus',
    reuseExistingServer: false,
  },
});
