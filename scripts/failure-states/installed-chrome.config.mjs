// SPDX-License-Identifier: MIT OR Apache-2.0
// Same finite oracles, installed Chrome; programmatic fixture calls, no OS input.
import {defineConfig} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
export const installedChromeExecutable='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export default defineConfig({
  testDir:resolve(root,'tests'),testMatch:['**/failure-dom-browser.spec.js','**/failure-runtime-browser.spec.js'],
  outputDir:resolve(root,'artifacts/failure-states/installed-chrome-results'),workers:1,retries:0,timeout:45000,
  reporter:[['list'],['json',{outputFile:resolve(root,'artifacts/failure-states/installed-chrome.json')}]],
  use:{baseURL:'http://127.0.0.1:4174',viewport:{width:1024,height:768},serviceWorkers:'block',
    trace:'off',screenshot:'off',video:'off'},
  projects:[{name:'installed-chrome',metadata:{failureStatesInstalled:{browser:'chrome',executablePath:installedChromeExecutable,
    method:'Playwright-controlled installed binary; exact request interception and pre-navigation observation; selected fixture strings only',
    physicalInput:false,osClipboard:false}},use:{browserName:'chromium',headless:false,
      launchOptions:{executablePath:installedChromeExecutable}}}],
  webServer:{command:'node scripts/workspace-server.mjs',cwd:root,url:'http://127.0.0.1:4174/clipboard',reuseExistingServer:false},
});
