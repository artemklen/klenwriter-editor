// SPDX-License-Identifier: MIT OR Apache-2.0
import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:'**/typography-browser.spec.js',outputDir:'artifacts/typography/browser-results',
  workers:1,retries:0,timeout:30000,reporter:[['list'],['json',{outputFile:'artifacts/typography/browser.json'}]],
  use:{baseURL:'http://127.0.0.1:4174',viewport:{width:1024,height:768},trace:'off',screenshot:'off',video:'off'},
  projects:['chromium','firefox','webkit'].map(name=>({name,use:{browserName:name}})),
  webServer:{command:'node scripts/workspace-server.mjs',url:'http://127.0.0.1:4174/typing',reuseExistingServer:false}});
