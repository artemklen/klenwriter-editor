// SPDX-License-Identifier: MIT OR Apache-2.0
import {test,expect} from '@playwright/test';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pipeline,assets,contractPins,currentAssetBinding,observeDomContext,fixedObservationWindow,assertBrowserClean,assertNumericOwnersZero} from '../scripts/failure-states/dom-observation.mjs';
const call=(page,method,...args)=>page.evaluate(({method,args})=>window.clipboardHost[method](...args),{method,args});
const nativeZero={sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0};
function sameNativeAndDom(after,before){
  expect(after.native).toEqual(before.native);expect(after.events).toEqual(before.events);expect(after.dom).toEqual(before.dom);expect(after.identityIntact).toBe(true);
}
function treeCheck(point,row){
  expect(point.dom.tree).toEqual(row.oracle.dom.expectedTree);
  const ids=point.dom.identities.map(i=>i.id);expect(ids.every(Boolean)).toBe(true);expect(new Set(ids).size).toBe(ids.length);expect(point.dom.identities.every(i=>i.marker==='')).toBe(true);
  if(point.native){expect(ids).toHaveLength(point.native.rows.length-1);expect(new Set(point.native.rows.map(r=>r.node.id)).size).toBe(point.native.rows.length);for(const item of point.native.rows)expect(item.node.stamp).toEqual(point.native.state.stamp);}
  const forbidden=new Set(pipeline.shared.domComparison.forbiddenDescendants);
  const walk=node=>{if(node.tag){expect(forbidden.has(node.tag)).toBe(false);for(const child of node.children)walk(child);}};
  for(const node of point.dom.tree)walk(node);
}
async function cleanCheckpoint(page,observer,report,label){const value=await observer.browser(page);report.browser.push({label,...value});assertBrowserClean(value);}
for(const row of pipeline.rows)test(`${row.id} finite ${row.pipeline}`,async({browser},info)=>{
  test.setTimeout(pipeline.shared.completion.wholeRowDeadlineMs);
  const binding=currentAssetBinding(),report={format:'osr67-ac1-browser-observation/1',rowId:row.id,engine:info.project.name,installed:false,qualification:'Actual bundled browser/public mounted SDK and packaged WASM; controlled selected strings, no OS clipboard/installed/HTML conformance claim',sourceCommit:binding.sourceCommit,contractPins,binding,row,browser:[],checkpoints:[],status:'RUNNING'};
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1024,height:768}}),observer=await observeDomContext(context,binding);
  let page,id,cleaned=false,failure;
  try{
    page=await context.newPage();
    const readyStarted=performance.now();
    const response=await page.goto(assets.origin+'/clipboard',{timeout:pipeline.shared.completion.initialReadyDeadlineMs});
    report.csp=response.headers()['content-security-policy'];
    expect(report.csp).toContain("default-src 'none'");expect(report.csp).toContain("'wasm-unsafe-eval'");expect(report.csp).not.toMatch(/'unsafe-inline'|'unsafe-eval'/);
    const importMap=/<script type="importmap">([^<]+)<\/script>/.exec(readFileSync('spikes/workspace/clipboard.html','utf8'))[1];
    expect(report.csp).toContain(`'sha256-${createHash('sha256').update(importMap).digest('base64')}'`);
    const readyRemaining=pipeline.shared.completion.initialReadyDeadlineMs-(performance.now()-readyStarted);expect(readyRemaining).toBeGreaterThan(0);
    await page.waitForFunction(()=>window.clipboardHostReady===true,undefined,{timeout:readyRemaining});
    await observer.settle();observer.assertPhase('bootstrap');await cleanCheckpoint(page,observer,report,'ready');observer.assertClean();
    observer.setPhase('operation');
    const paste=row.input.action==='public mounted clipboard.paste';
    report.mount=await call(page,'failureMount',paste?row.input.seedCanonicalUtf8:row.input.rawUtf8);id=report.mount.id;
    if(paste){
      expect(report.mount.ready.status).toBe('ready');report.selection=await call(page,'failureSelect',id,row.input.selection);
      const before=await call(page,'failureInspect',id);report.checkpoints.push({label:'before',...before});expect(before.native.canonical).toBe(row.input.seedCanonicalUtf8);
      report.outcome=await call(page,'failurePaste',id,row.input.representations,row.input.metadata.types);
      expect(report.outcome.status).toBe(row.oracle.outcome);expect(report.outcome.diagnostics).toEqual(row.oracle.clipboardDiagnostics);
      const after=await call(page,'failureInspect',id);report.checkpoints.push({label:'terminal',...after});treeCheck(after,row);
      expect(after.sourceReads).toHaveLength(1);expect(after.sourceReads[0]).toEqual({types:row.input.metadata.types,calls:row.input.captureReadOrder});
      if(row.oracle.outcome==='inserted'){
        expect(report.outcome.submission.status).toBe('completed');expect(report.outcome.submission.response.status).toBe('ok');expect(after.native.canonical).toBe(row.oracle.native.canonicalUtf8);
        const a=after.native.state.stamp,b=before.native.state.stamp;expect(a.session).toBe(b.session);expect(a.generation).toBe(b.generation);
        for(const key of ['revision','selection_epoch','history_epoch'])expect(BigInt(a[key])-BigInt(b[key])).toBe(1n);
        expect(after.native.state.history.undo_entries).toBe(String(BigInt(before.native.state.history.undo_entries)+1n));expect(after.native.state.history.redo_entries).toBe('0');expect(after.native.state.dirty).toBe(true);
        expect(after.events.filter(e=>e.change.kind==='document').length-before.events.filter(e=>e.change.kind==='document').length).toBe(1);
        expect(after.audit.queries-before.audit.queries).toBe(1);expect(after.audit.commands-before.audit.commands).toBe(1);
        report.recovery=await call(page,'failureTakeRecovery',id);expect(report.recovery).toBeNull();
      }else{
        expect(report.outcome.failure.diagnostic).toMatchObject(row.oracle.failure);sameNativeAndDom(after,before);expect(after.audit.queries-before.audit.queries).toBe(0);expect(after.audit.commands-before.audit.commands).toBe(0);
        report.recovery=await call(page,'failureTakeRecovery',id);expect(report.recovery.reason).toBe(row.oracle.recovery.reason);expect(report.recovery.capture.retainedUtf16Units).toBe(row.oracle.recovery.retainedUtf16Units);
        expect(report.recovery.capture.metadata.types).toEqual(row.input.metadata.types);expect(report.recovery.capture.metadata.counts.files).toBe(0);
        for(const mime of row.input.metadata.types)expect(report.recovery.capture.representations[mime]).toMatchObject({status:'complete_local',readAttempted:true,text:row.input.representations[mime],utf16Units:row.input.representations[mime].length});
        expect(await call(page,'failureTakeRecovery',id)).toBeNull();
      }
    }else if(row.oracle.outcome==='ready'){
      expect(report.mount.ready.status).toBe('ready');expect(report.mount.originalInput).toBeNull();
      const after=await call(page,'failureInspect',id);report.checkpoints.push({label:'terminal',...after});treeCheck(after,row);expect(after.native.canonical).toBe(row.oracle.native.canonicalUtf8);
      for(const key of ['revision','selection_epoch','history_epoch'])expect(after.native.state.stamp[key]).toBe(row.oracle.native[key]);
      expect(after.events).toEqual([]);expect(after.native.state.history.undo_entries).toBe('0');expect(after.native.state.dirty).toBe(false);
    }else{
      expect(report.mount.ready.status).toBe('sdk_failure');expect(report.mount.ready.response.status).toBe('refused');expect(report.mount.ready.response.diagnostic).toMatchObject({code:row.oracle.native.code,path:row.oracle.native.path,may_have_committed:false});
      const original=Array.from(new TextEncoder().encode(row.input.rawUtf8));expect(report.mount.ready.recovery.originalInput).toEqual(original);expect(report.mount.originalInput).toEqual(original);expect(report.mount.originalCopyIndependent).toBe(true);
      const after=await call(page,'failureInspect',id);report.checkpoints.push({label:'terminal',...after});expect(after.native).toBeNull();expect(after.dom.tree).toEqual([]);expect(after.contenteditable).toBe('false');expect(after.lifecycle).toBe('recoveryRequired');expect(after.events).toEqual([]);
    }
    await cleanCheckpoint(page,observer,report,'operation terminal');report.operationWindow=await fixedObservationWindow(page);expect(report.operationWindow.finished-report.operationWindow.started).toBeGreaterThanOrEqual(250);
    const stable=await call(page,'failureInspect',id);report.checkpoints.push({label:'window complete',...stable});const previous=report.checkpoints.at(-2);sameNativeAndDom(stable,previous);
    await observer.settle();observer.assertPhase('operation',paste);await cleanCheckpoint(page,observer,report,'window complete');observer.assertClean();
    observer.setPhase('cleanup');report.cleanup=await call(page,'failureDispose',id);cleaned=true;
    expect(report.cleanup.sameReceipt).toBe(true);expect(report.cleanup.receipt.sdk.response.status).toBe('ok');expect(report.cleanup.receipt.callbackFailure).toBeNull();expect(report.cleanup.restoredAttributes).toEqual(report.cleanup.initialAttributes);expect(report.cleanup.native).toEqual(nativeZero);assertNumericOwnersZero(report.cleanup.resources);assertNumericOwnersZero(report.cleanup.fixtureResources);
    expect(report.cleanup.receipt.clipboardRecovery).toBeNull();
    if(row.oracle.outcome==='sdk_failure'){
      const original=Array.from(new TextEncoder().encode(row.input.rawUtf8));expect(report.cleanup.receipt.recovery.originalInput).toEqual(original);expect(report.cleanup.recoveries).toHaveLength(1);expect(report.cleanup.recoveries[0].originalInput).toEqual(original);
    }else{expect(report.cleanup.receipt.recovery).toBeNull();expect(report.cleanup.recoveries).toEqual([]);}
    report.cleanupWindow=await fixedObservationWindow(page);expect(report.cleanupWindow.finished-report.cleanupWindow.started).toBeGreaterThanOrEqual(250);await observer.settle();observer.assertPhase('cleanup');await cleanCheckpoint(page,observer,report,'cleanup complete');observer.assertClean();
    report.status='PASSED';
  }catch(error){failure=error;report.status='FAILED';report.originalFailure={name:error.name,message:error.message,stack:error.stack};}
  finally{
    if(page&&!cleaned)try{report.emergencyCleanup=await call(page,'failureAllDisposed');}catch(error){report.emergencyCleanupFailure=String(error);}
    try{await observer.settle();report.observation=observer.snapshot();}catch(error){report.observationFailure=String(error);failure??=error;report.status='FAILED';}
    try{await context.close();report.contextClosed=true;}catch(error){report.contextCloseFailure=String(error);failure??=error;report.status='FAILED';}
    const directory='artifacts/failure-states/dom';mkdirSync(directory,{recursive:true});const path=`${directory}/${info.project.name}-${row.id}.json`;
    writeFileSync(path,JSON.stringify(report,null,2)+'\n');await info.attach('failure-dom-observations',{path,contentType:'application/json'});
  }
  if(failure)throw failure;
});
