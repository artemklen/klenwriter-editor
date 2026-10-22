// SPDX-License-Identifier: MIT OR Apache-2.0
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests',testMatch:'**/ui-*-browser.spec.js',outputDir:'artifacts/ui/browser-results',
  workers:1,retries:0,timeout:90000,
  reporter:[['list'],['json',{outputFile:'artifacts/ui/browser.json'}]],
  use:{baseURL:'http://127.0.0.1:4174',trace:'off',screenshot:'off',video:'off'},
  projects:['chromium','webkit','firefox'].map(name=>({name,use:{browserName:name}})),
  webServer:{command:'node scripts/workspace-server.mjs',url:'http://127.0.0.1:4174/ui',reuseExistingServer:false},
});
