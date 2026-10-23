// SPDX-License-Identifier: MIT OR Apache-2.0
// Actual mounted SDK/DOM with a held loader of the verified packaged module.
// This proves mounted timeout/fencing, not a network or installed-input failure.
import {test,expect} from '@playwright/test';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {assets,currentAssetBinding,observeDomContext,fixedObservationWindow,assertBrowserClean,assertNumericOwnersZero} from '../scripts/failure-states/dom-observation.mjs';

const contractPath='contracts/failure-states/v1/mounted-loading.json';
const contract=JSON.parse(readFileSync(contractPath,'utf8'));
const pin=path=>{const bytes=readFileSync(path);return{path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};};
const sourcePaths=[contractPath,'tests/failure-loading-browser.spec.js','spikes/workspace/clipboard-host.js','playwright.failure.config.js'];
const call=(page,method,...args)=>page.evaluate(({method,args})=>window.clipboardHost[method](...args),{method,args});

function terminal(point,original){
  const expected=contract.expected.terminal;
  expect(point.lifecycle).toBe(expected.lifecycle);expect(point.contenteditable).toBe(expected.contenteditable);
  expect(point.readySettlements).toBe(expected.readySettlements);expect(point.audit).toEqual(expected.audit);
  expect(point.events).toEqual(expected.events);expect(point.native).toBe(expected.native);expect(point.nativeResources).toBe(expected.nativeResources);
  expect(point.dom.tree).toEqual(expected.domTree);expect(point.originalInput).toEqual(original);
  expect(point.resources.sdk.lifecycle).toBe(expected.sdk.lifecycle);
  for(const [name,value]of Object.entries(point.resources.sdk)){
    if(name==='lifecycle')continue;
    expect(value,name).toBe(name==='original_input_bytes'?contract.input.bytes:expected.sdk.otherOwnedCounts);
  }
}
async function cleanBrowser(page,observer,report,label){
  const observed=await observer.browser(page);report.browser.push({label,...observed});assertBrowserClean(observed);
}

for(const row of contract.cases)test(`${row.id} mounted deadline fences late ${row.lateCompletion}`,async({browser},info)=>{
  expect(contract.format).toBe('editor-failure-states/mounted-loading/1');expect(contract.family).toBe('F67-H02');
  expect(contract.loadTimeoutMs).toBe(30);expect(contract.cases.map(value=>value.lateCompletion)).toEqual(['resolve','reject']);
  const input=readFileSync(contract.input.path),inputPin=pin(contract.input.path);
  expect(inputPin.bytes).toBe(contract.input.bytes);expect(inputPin.sha256).toBe(contract.input.sha256);
  const text=new TextDecoder('utf-8',{fatal:true}).decode(input),original=Array.from(input);
  expect(Array.from(new TextEncoder().encode(text))).toEqual(original);
  const binding=currentAssetBinding(),sources=sourcePaths.map(pin);
  const report={format:'osr67-mounted-loading-observation/1',caseId:row.id,engine:info.project.name,installed:false,
    qualification:contract.qualification,contract,sourcePins:sources,inputPin,binding,browser:[],checkpoints:[],status:'RUNNING'};
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1024,height:768}});
  const observer=await observeDomContext(context,binding);
  let page,id,cleaned=false,failure;
  try{
    page=await context.newPage();
    const response=await page.goto(assets.origin+'/clipboard');expect(response.status()).toBe(200);
    report.csp=response.headers()['content-security-policy'];
    expect(report.csp).toContain("default-src 'none'");expect(report.csp).toContain("'wasm-unsafe-eval'");
    expect(report.csp).not.toMatch(/'unsafe-inline'|'unsafe-eval'/);
    await page.waitForFunction(()=>window.clipboardHostReady===true);
    await observer.settle();observer.assertPhase('bootstrap');await cleanBrowser(page,observer,report,'ready');observer.assertClean();
    observer.setPhase('operation');
    report.mount=await call(page,'failureMount',text,contract.helperConfiguration);id=report.mount.id;
    const mounted=report.mount;
    expect(mounted.initial.lifecycle).toBe(contract.expected.initial.lifecycle);
    expect(mounted.initial.contenteditable).toBe(contract.expected.initial.contenteditable);
    expect(mounted.initial.resources.sdk.loading_deadlines).toBe(contract.expected.initial.loading_deadlines);
    expect(mounted.ready.status).toBe(contract.expected.ready.status);expect(mounted.ready.response).toEqual(contract.expected.ready.response);
    expect(mounted.ready.recovery.originalInput).toEqual(original);expect(mounted.originalInput).toEqual(original);
    expect(mounted.originalCopyIndependent).toBe(true);expect(mounted.readySettlements).toBe(1);
    expect(mounted.audit).toEqual(contract.expected.terminal.audit);
    const expired=await call(page,'failureInspect',id);report.checkpoints.push({label:'timeout',...expired});terminal(expired,original);
    expect(expired.loadCompletion).toBeNull();
    const late=await call(page,'failureReleaseHeldLoader',id,row.lateCompletion);
    report.checkpoints.push({label:'late completion',...late});terminal(late,original);
    expect(late.loadCompletion).toEqual({completion:row.lateCompletion,released:true});
    expect(late.dom).toEqual(expired.dom);expect(late.resources).toEqual(expired.resources);
    report.operationWindow=await fixedObservationWindow(page);
    expect(report.operationWindow.finished-report.operationWindow.started).toBeGreaterThanOrEqual(250);
    const stable=await call(page,'failureInspect',id);report.checkpoints.push({label:'late observation window',...stable});
    terminal(stable,original);expect(stable.audit.constructors).toBe(0);expect(stable.dom).toEqual(expired.dom);
    expect(stable.resources).toEqual(expired.resources);expect(stable.readySettlements).toBe(1);
    await observer.settle();observer.assertPhase('operation');await cleanBrowser(page,observer,report,'late completion observed');observer.assertClean();
    observer.setPhase('cleanup');report.cleanup=await call(page,'failureDispose',id);cleaned=true;
    const cleanup=report.cleanup,expected=contract.expected.cleanup;
    expect(cleanup.resources.sdk.lifecycle).toBe(expected.lifecycle);expect(cleanup.sameReceipt).toBe(expected.sameDestroyReceipt);
    expect(cleanup.receipt.callbackFailure).toBe(expected.callbackFailure);expect(cleanup.receipt.sdk.response.status).toBe('ok');
    expect(cleanup.receipt.recovery.originalInput).toEqual(original);expect(cleanup.recoveries).toHaveLength(expected.recoveryNotifications);
    expect(cleanup.recoveries[0].originalInput).toEqual(original);expect(cleanup.audit).toEqual(contract.expected.terminal.audit);
    expect(cleanup.readySettlements).toBe(1);expect(cleanup.native).toEqual(expected.native);
    expect(cleanup.restoredAttributes).toEqual(cleanup.initialAttributes);expect(cleanup.receipt.clipboardRecovery).toBeNull();
    assertNumericOwnersZero(cleanup.resources);assertNumericOwnersZero(cleanup.fixtureResources);
    report.cleanupWindow=await fixedObservationWindow(page);expect(report.cleanupWindow.finished-report.cleanupWindow.started).toBeGreaterThanOrEqual(250);
    await observer.settle();observer.assertPhase('cleanup');await cleanBrowser(page,observer,report,'cleanup');observer.assertClean();
    for(const item of sources)expect(pin(item.path)).toEqual(item);
    expect(pin(contract.input.path)).toEqual(inputPin);report.status='PASSED';
  }catch(error){failure=error;report.status='FAILED';report.originalFailure={name:error.name,message:error.message,stack:error.stack};}
  finally{
    if(page&&!cleaned)try{report.emergencyCleanup=await call(page,'failureAllDisposed');}catch(error){report.emergencyCleanupFailure=String(error);}
    try{await observer.settle();report.observation=observer.snapshot();}catch(error){report.observationFailure=String(error);failure??=error;report.status='FAILED';}
    try{await context.close();report.contextClosed=true;}catch(error){report.contextCloseFailure=String(error);failure??=error;report.status='FAILED';}
    const directory='artifacts/failure-states/loading';mkdirSync(directory,{recursive:true});
    const path=`${directory}/${info.project.name}-${row.id}.json`;writeFileSync(path,JSON.stringify(report,null,2)+'\n');
    await info.attach('mounted-loading-observation',{path,contentType:'application/json'});
  }
  if(failure)throw failure;
});
