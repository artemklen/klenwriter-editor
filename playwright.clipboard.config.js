// SPDX-License-Identifier: MIT OR Apache-2.0
import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:'**/clipboard.browser.mjs',outputDir:'artifacts/clipboard/browser-results',
  workers:1,retries:0,timeout:45000,reporter:[['list'],['json',{outputFile:'artifacts/clipboard/browser.json'}]],
  use:{baseURL:'http://127.0.0.1:4174',viewport:{width:1024,height:768},trace:'off',screenshot:'off',video:'off'},
  projects:['chromium','webkit','firefox'].map(name=>({name,use:{browserName:name}})),
  webServer:{command:'node scripts/workspace-server.mjs',url:'http://127.0.0.1:4174/clipboard',reuseExistingServer:false}});
