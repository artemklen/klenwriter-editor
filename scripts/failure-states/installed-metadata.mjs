// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
const executable='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sha=value=>createHash('sha256').update(value).digest('hex');
export async function failureBrowserMetadata(browser,info){
  const selected=info.project.metadata.failureStatesInstalled;
  if(!selected)return{installed:false,browserVersion:browser.version(),method:'bundled Playwright browser',physicalInput:false,osClipboard:false};
  assert.equal(selected.browser,'chrome');assert.equal(selected.executablePath,executable);
  assert.equal(selected.physicalInput,false);assert.equal(selected.osClipboard,false);
  assert.equal(info.project.use.headless,false);assert.equal(info.project.use.launchOptions.executablePath,executable);
  const stat=lstatSync(executable);assert(stat.isFile()&&!stat.isSymbolicLink(),'Declared installed executable must be a regular file');
  const bytes=readFileSync(executable),session=await browser.newBrowserCDPSession();
  let version,commandLine;
  try{version=await session.send('Browser.getVersion');commandLine=await session.send('Browser.getBrowserCommandLine');}
  finally{await session.detach();}
  assert.match(version.product,/^Chrome\//);assert(!version.userAgent.includes('HeadlessChrome'));
  assert.equal(version.product.slice('Chrome/'.length),browser.version());
  assert.equal(realpathSync(commandLine.arguments[0]),realpathSync(executable),'Actual launched executable');
  assert(!commandLine.arguments.some(arg=>arg==='--headless'||arg.startsWith('--headless=')));
  return{installed:true,browser:'chrome',browserVersion:browser.version(),method:selected.method,physicalInput:false,osClipboard:false,
    executable:{path:executable,bytes:bytes.length,sha256:sha(bytes)},cdpVersion:version,actualBrowserArguments:commandLine.arguments};
}
