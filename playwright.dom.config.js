import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests',testMatch:'**/dom-workspace-browser.spec.js',outputDir:'artifacts/dom/browser-results',
  workers:1,retries:0,timeout:90000,
  reporter:[['list'],['json',{outputFile:'artifacts/dom/browser.json'}]],
  use:{baseURL:'http://127.0.0.1:4174',trace:'retain-on-failure'},
  projects:['chromium','webkit','firefox'].map(name=>({name,use:{browserName:name}})),
  webServer:{command:'node scripts/workspace-server.mjs',url:'http://127.0.0.1:4174/dom',reuseExistingServer:false},
});
