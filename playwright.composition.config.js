import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests',testMatch:'**/composition-workspace-browser.spec.js',outputDir:'artifacts/composition/browser-results',
  workers:1,retries:0,timeout:30000,
  reporter:[['list'],['json',{outputFile:'artifacts/composition/browser.json'}]],
  use:{baseURL:'http://127.0.0.1:4174',viewport:{width:1024,height:768},trace:'retain-on-failure'},
  projects:['chromium','webkit','firefox'].map(name=>({name,use:{browserName:name}})),
  webServer:{command:'node scripts/workspace-server.mjs',url:'http://127.0.0.1:4174/composition',reuseExistingServer:false},
});
