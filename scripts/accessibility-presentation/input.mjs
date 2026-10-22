// SPDX-License-Identifier: MIT OR Apache-2.0
// Dedicated accessibility66 transport, scoped from the accepted UI42 owner; separate evidence.
import assert from 'node:assert/strict';
import {caseIds,caseActions,keySpecs,pointerTargets,limits} from './protocol.mjs';
export {prepareChromeWindow} from './chrome-bootstrap.mjs';
const requireFixture=`on requireFixture(expectedPID, expectedName, expectedBundle, expectedTitle)
 tell application "System Events"
  set ownedProcesses to (application processes whose unix id is expectedPID)
  if (count of ownedProcesses) is not 1 then error "Exact fixture PID unavailable"
  tell item 1 of ownedProcesses
   if name is not expectedName or bundle identifier is not expectedBundle then error "Fixture identity changed"
   if frontmost is not true then error "Fixture is not frontmost"
   if (count of windows) is greater than 32 then error "Fixture window bound"
   if (count of (windows whose name is expectedTitle)) is not 1 then error "Fixture title not unique"
   if (name of front window) is not expectedTitle then error "Fixture title not frontmost"
   if (value of attribute "AXTitle" of (value of attribute "AXFocusedWindow")) is not expectedTitle then error "Fixture title not focused"
  end tell
 end tell
end requireFixture
`;
const branches=Object.entries(keySpecs).flatMap(([action,spec])=>[false,true].map(cleanup=>{
  const actual=(cleanup?'release-':'')+action;
  const transitions=cleanup?[...spec.modifiers.map(m=>m+'-up'),`key${spec.code}-up`]:[...spec.modifiers.map(m=>m+'-down'),`key${spec.code}-down`,`key${spec.code}-up`,...spec.modifiers.toReversed().map(m=>m+'-up')];
  const lines=cleanup?[...spec.modifiers.map(m=>`key up ${m}`),`key up ${spec.code}`]:[...spec.modifiers.map(m=>`key down ${m}`),`key down ${spec.code}`,`key up ${spec.code}`,...spec.modifiers.toReversed().map(m=>`key up ${m}`)];
  const prefix=JSON.stringify({status:cleanup?'keys-released':'key-sent',action:actual,keyCode:spec.code,modifiers:spec.modifiers,keyTransitions:transitions}).slice(0,-1)+',"frontPid":';
  // Preserve Safari's accepted Tab settlement within the original total 1s budget.
  const safariTabSettle=actual==='tab'?'if expectedBrowser is "safari" then delay 0.2\n ':'';
  return `if fixtureAction is "${actual}" then\n tell application "System Events"\n  ${lines.join('\n  ')}\n end tell\n ${safariTabSettle}my requireFixture(expectedPID, expectedName, expectedBundle, expectedTitle)\n return "${prefix.replaceAll('\\','\\\\').replaceAll('"','\\"')}" & expectedPID & "}"\nend if`;
})).join('\n');
export const fixedKeyScript=requireFixture+`on run argv
 if (count of argv) is not 4 then error "Closed accessibility66 key arguments required"
 set expectedBrowser to item 1 of argv
 set expectedTitle to item 2 of argv
 set expectedPID to (item 3 of argv) as integer
 set fixtureAction to item 4 of argv
 if expectedPID is less than 1 then error "Invalid fixture PID"
 if expectedBrowser is "chrome" then
  set expectedName to "Google Chrome"
  set expectedBundle to "com.google.Chrome"
 else if expectedBrowser is "safari" then
  set expectedName to "Safari"
  set expectedBundle to "com.apple.Safari"
 else
  error "Unknown closed fixture browser"
 end if
 my requireFixture(expectedPID, expectedName, expectedBundle, expectedTitle)
 ${branches}
 error "Unknown closed accessibility66 key"
end run
`;
export function createInputOwner({browser,config,inputHelper,keyScriptPath,run,record,guard,cleanupGuard,mountedId,nativeFindEpisode,nativeFindKeyTransport,findKeyHelper,nativeZoomKeyTransport,safariCopyKeyTransport,safariKeyGuardAgeMs=1000}){
  // Explicit OSR66 opt-in only; fixed programs/default1s and all non-Safari-key budgets stay unchanged.
  assert.ok([1000,1500].includes(safariKeyGuardAgeMs),'Closed Safari fixed-key guard budget');
  assert.ok(browser==='safari'||safariKeyGuardAgeMs===1000,'Safari-only fixed-key guard option');
  assert.ok(['chrome','safari'].includes(browser));assert.match(config.nonce,/^[a-f0-9]{32}$/);assert.equal(config.format,'osr66-accessibility-http-broker/1');assert.equal(config.fixtureUrl,'http://127.0.0.1:4174/accessibility');assert.equal(config.title,'KlenWriter Accessibility native '+config.nonce);
  let disabled=false,serial=0,pending=null,cleanupUsed=false,baselineWindow=null;
  assert.equal(nativeFindEpisode,undefined,'Find is outside the closed presentation transport');
  assert.equal(nativeFindKeyTransport,undefined,'Find is outside the closed presentation transport');
  assert.equal(safariCopyKeyTransport,undefined,'Copy is outside the closed presentation transport');
  const nativeZoomCg=nativeZoomKeyTransport==='cg-zoom01';
  assert.ok(nativeZoomKeyTransport===undefined||nativeZoomCg&&browser==='chrome','Closed Chrome Zoom CG transport only');
  if(nativeZoomCg){assert.equal(config.nonce.length,32);assert.equal(Buffer.byteLength(config.nonce,'utf8'),32);assert.ok(!/[^a-f0-9]/.test(config.nonce));}
  assert.ok(nativeZoomCg?typeof findKeyHelper==='string'&&findKeyHelper.startsWith('/')&&findKeyHelper.length<=4096&&!findKeyHelper.includes('\0'):findKeyHelper===undefined,'CG transport requires its fixed helper path');
  let operationBusy=false,ownerEpoch=0;
  function whole(value,pattern){assert.equal(typeof value,'string');const match=pattern.exec(value);assert.ok(match&&match[0]===value,'Exact presentation identifier required');}
  function exactKeys(value,keys){assert.ok(value&&typeof value==='object'&&!Array.isArray(value));assert.deepEqual(Object.keys(value).sort(),[...keys].sort());}
  function frame(value){exactKeys(value,['x','y','width','height']);assert.ok(Object.values(value).every(Number.isFinite)&&value.width>0&&value.height>0&&Number.isFinite(value.x+value.width)&&Number.isFinite(value.y+value.height));return {...value};}
  function pageZoom(proof,action,cleanup=false){
    const v=proof.value;assert.equal(typeof proof.start,'bigint');whole(proof.id,new RegExp('^'+config.nonce+':[1-9][0-9]{0,3}$'));whole(mountedId(),/^a66-[1-9][0-9]{0,8}$/);
    assert.ok(caseIds.includes(v.caseId)&&caseActions[v.caseId].includes(action),'Closed scene/action pair required');
    for(const [name,value]of Object.entries({nonce:config.nonce,url:config.fixtureUrl,title:config.title,id:mountedId(),mountedId:mountedId(),caseId:v.caseId,action,target:'focused',allowed:true,editorConnected:true,pointerDown:false}))assert.equal(v[name],value);
    assert.equal(v.point,null);assert.ok(Number.isSafeInteger(v.serial)&&v.serial>serial&&v.serial<=2048);serial=v.serial;
    assert.ok(cleanup?v.releaseOnly===true:v.documentFocused===true);
    assert.ok(Math.abs(v.zoomEvidence.dprRatio-1)<.01||Math.abs(v.zoomEvidence.dprRatio-v.viewport.pageZoom)<.01);
    exactKeys(v.viewport,['width','height','scale','offsetLeft','offsetTop','pageZoom']);const z=v.viewport;
    assert.ok(Number.isFinite(z.width)&&Number.isFinite(z.height)&&Number.isFinite(z.pageZoom)&&z.width>0&&z.width<=1024&&z.height>0&&z.height<=768&&z.pageZoom>=1&&z.pageZoom<=2&&Math.abs(z.width*z.pageZoom-1024)<=2&&z.height*z.pageZoom>=480&&z.height*z.pageZoom<=770&&z.scale===1&&z.offsetLeft===0&&z.offsetTop===0);
    return v;
  }
  function remainingKey(proof){const remaining=Math.floor(limits.guardAgeMs-age(proof.start));assert.ok(remaining>0,'Key guard deadline exhausted');return remaining;}
  function coreKeyAck(actual,action,cleanup,ep){
    const key=keySpecs[action];assert.equal(actual.action,(cleanup?'release-':'')+action);assert.equal(actual.status,cleanup?'keys-released':'key-sent');assert.equal(actual.keyCode,key.code);assert.deepEqual(actual.modifiers,key.modifiers);assert.equal(actual.frontPid,ep.pid);
    assert.deepEqual(actual.keyTransitions,cleanup?[...key.modifiers.map(m=>m+'-up'),`key${key.code}-up`]:[...key.modifiers.map(m=>m+'-down'),`key${key.code}-down`,`key${key.code}-up`,...key.modifiers.toReversed().map(m=>m+'-up')]);
  }
  function cgDiagnostic(value){if(value===null)return;exactKeys(value,['code','reason']);assert.equal(typeof value.code,'string');assert.ok(value.code.length>0&&Buffer.byteLength(value.code)<=128);assert.equal(typeof value.reason,'string');assert.ok(Buffer.byteLength(value.reason)<=512);}
  const zoomPrograms={
    'zoom-in':[{keyCode:55,down:true,flags:'command'},{keyCode:56,down:true,flags:'command+shift'},{keyCode:24,down:true,flags:'command+shift'},{keyCode:24,down:false,flags:'command+shift'},{keyCode:56,down:false,flags:'command'},{keyCode:55,down:false,flags:'none'}],
    'zoom-reset':[{keyCode:55,down:true,flags:'command'},{keyCode:29,down:true,flags:'command'},{keyCode:29,down:false,flags:'command'},{keyCode:55,down:false,flags:'none'}],
    'release-zoom-in':[{keyCode:55,down:false,flags:'none'},{keyCode:56,down:false,flags:'none'},{keyCode:24,down:false,flags:'none'}],
    'release-zoom-reset':[{keyCode:55,down:false,flags:'none'},{keyCode:29,down:false,flags:'none'}],
  };
  function zoomGeometry(actual,request){
    const r=frame(actual.axWindow),v=frame(actual.axViewport);assert.deepEqual(r,request.originalRootFrame);
    assert.ok(v.x>=r.x-.5&&v.y>=r.y-.5&&v.x+v.width<=r.x+r.width+.5&&v.y+v.height<=r.y+r.height+.5);
    assert.ok(Math.abs(v.width-request.viewport.width*request.viewport.pageZoom)<=2&&Math.abs(v.height-request.viewport.height*request.viewport.pageZoom)<=2);
    assert.ok(Number.isSafeInteger(actual.axWindowCount)&&actual.axWindowCount>=1&&actual.axWindowCount<=32);
  }
  function zoomOrdinaryProof(actual,request,pid,rootFrame){
    for(const [name,value]of Object.entries({status:'guarded',delivery:'not_sent',cleanupOnly:request.cleanupOnly,frontBundle:'com.google.Chrome',frontPid:pid,expectedAxWindowTitle:config.title+' - Google Chrome',observedAxWindowTitle:config.title+' - Google Chrome',action:request.action,requestId:request.requestId,nonce:config.nonce,mountedId:request.mountedId,caseId:request.caseId,target:'focused'}))assert.equal(actual[name],value,'Zoom ordinary proof '+name);
    zoomGeometry(actual,{...request,originalRootFrame:rootFrame});fixedWindow(actual.axWindow);
  }
  function zoomEnvelope(value,request){
    exactKeys(value,['format','status','delivery','method','request','programId','program','postedTransitions','postedCount','preflightProofs','core','diagnostic','elapsedMs']);
    assert.equal(value.format,'osr66-chrome-zoom-key-result/1');assert.equal(value.method,'CGEvent/cghidEventTap');assert.deepEqual(value.request,request);
    const id=(request.cleanupOnly?'release-':'')+request.action,program=zoomPrograms[id];assert.equal(value.programId,id);assert.deepEqual(value.program,program);
    assert.ok(Number.isSafeInteger(value.postedCount)&&value.postedCount>=0&&value.postedCount<=program.length);assert.deepEqual(value.postedTransitions,program.slice(0,value.postedCount));assert.ok(Array.isArray(value.preflightProofs));assert.equal(value.preflightProofs.length,value.postedCount);
    for(const p of value.preflightProofs){
      exactKeys(p,['frontPid','frontName','frontBundle','expectedAxWindowTitle','observedAxWindowTitle','axWindowCount','axMatchCount','axWindow','axViewport','contained','visitedNodes','maximumDepth','rootFocused']);
      for(const [k,v]of Object.entries({frontPid:request.originalPid,frontName:'Google Chrome',frontBundle:'com.google.Chrome',expectedAxWindowTitle:config.title+' - Google Chrome',observedAxWindowTitle:config.title+' - Google Chrome',axMatchCount:1,contained:true,rootFocused:true}))assert.equal(p[k],v,'Zoom per-post proof '+k);
      assert.ok(Number.isSafeInteger(p.visitedNodes)&&p.visitedNodes>=1&&p.visitedNodes<=512);assert.ok(Number.isSafeInteger(p.maximumDepth)&&p.maximumDepth>=0&&p.maximumDepth<=32);zoomGeometry(p,request);
    }
    cgDiagnostic(value.diagnostic);assert.ok(Number.isFinite(value.elapsedMs)&&value.elapsedMs>=0);return program;
  }
  async function performZoom(action,cleanup){
    assert.equal(operationBusy,false,'One private key operation at a time');if(!cleanup)assert.equal(disabled,false);
    operationBusy=true;let proof=null,preflight=null,execution=null,postflight=null,nativeZoomKeyResult=null,dispatched=false,completed=false,knownNotSent=false;
    try{
      const saved=cleanup?pending:null;if(cleanup){assert.ok(saved&&!saved.pointer&&!cleanupUsed);assert.equal(saved.action,action);cleanupUsed=true;}
      const epoch=ownerEpoch;proof=await(cleanup?cleanupGuard(action):guard(action));assert.equal(ownerEpoch,epoch,'Zoom owner retired during page guard');const v=pageZoom(proof,action,cleanup);
      if(cleanup){assert.equal(mountedId(),saved.mount);assert.equal(v.caseId,saved.caseId);}
      const original={format:'osr66-native-input/1',browser:'chrome',nonce:config.nonce,title:config.title,fixtureUrl:config.fixtureUrl,mountedId:mountedId(),requestId:proof.id,serial:v.serial,caseId:v.caseId,action,target:'focused',point:null,viewport:v.viewport,pointerDown:false,cleanupOnly:cleanup,deadlineMs:remainingKey(proof)};
      preflight=run(inputHelper,['--guard-key',JSON.stringify(original)],{timeout:original.deadlineMs,fullStdout:true,maxBuffer:32768});const strict=JSON.parse(preflight.stdout),pid=cleanup?saved.pid:strict.frontPid,rootFrame=cleanup?saved.rootFrame:frame(strict.axWindow);
      assert.ok(Number.isSafeInteger(pid)&&pid>0&&pid<=2147483647);zoomOrdinaryProof(strict,original,pid,rootFrame);assert.equal(ownerEpoch,epoch);assert.equal(original.mountedId,mountedId());
      const left=remainingKey(proof),request={...original,format:'osr66-chrome-zoom-key/1',deadlineMs:left,originalPid:pid,originalRootFrame:{...rootFrame}};assert.ok(Buffer.byteLength(JSON.stringify(request))<=4096);
      pending={action,pointer:false,pid,mount:mountedId(),caseId:v.caseId,rootFrame:{...rootFrame}};dispatched=true;
      try{execution=run(findKeyHelper,['--zoom-request',JSON.stringify(request)],{timeout:left,fullStdout:true,maxBuffer:32768});}catch(error){execution=error.execution??null;if(!execution?.stdout)throw error;}
      nativeZoomKeyResult=JSON.parse(execution.stdout);const program=zoomEnvelope(nativeZoomKeyResult,request);
      if(nativeZoomKeyResult.status==='completed'){
        assert.equal(nativeZoomKeyResult.delivery,'sent');assert.equal(nativeZoomKeyResult.postedCount,program.length);exactKeys(nativeZoomKeyResult.core,['status','action','keyCode','modifiers','keyTransitions','frontPid']);coreKeyAck(nativeZoomKeyResult.core,action,cleanup,{pid});
        completed=true;pending=null; // Complete contextual core is known BEFORE time and fresh ordinary postproof.
        assert.equal(execution.returnCode,0);assert.ok(nativeZoomKeyResult.elapsedMs<=left);assert.equal(ownerEpoch,epoch);assert.equal(original.mountedId,mountedId());
        const postRequest={...original,deadlineMs:remainingKey(proof)};
        try{postflight=run(inputHelper,['--guard-key',JSON.stringify(postRequest)],{timeout:postRequest.deadlineMs,fullStdout:true,maxBuffer:32768});}catch(error){postflight=error.execution??null;throw error;}
        zoomOrdinaryProof(JSON.parse(postflight.stdout),postRequest,pid,rootFrame);assert.equal(ownerEpoch,epoch);assert.equal(original.mountedId,mountedId());remainingKey(proof);
        const value={action,delivery:'sent',actual:nativeZoomKeyResult.core,execution,pageGuard:v,keyGuard:strict,keyGuardExecution:preflight,postKeyGuardExecution:postflight,nativeZoomKeyResult,maximumGuardAgeMs:age(proof.start),guardAgeLimitMs:limits.guardAgeMs,cleanupOnly:cleanup,keysPending:false,requestId:proof.id};record(cleanup?'owned-key-release':'physical-input',value);return value;
      }
      assert.equal(nativeZoomKeyResult.core,null);
      if(nativeZoomKeyResult.status==='refused'){assert.equal(nativeZoomKeyResult.delivery,'not_sent');assert.equal(nativeZoomKeyResult.postedCount,0);assert.equal(execution.returnCode,2);knownNotSent=true;if(!cleanup)pending=null;}
      else{assert.equal(nativeZoomKeyResult.status,'unknown');assert.equal(nativeZoomKeyResult.delivery,'unknown/may_have_sent');assert.ok(nativeZoomKeyResult.postedCount>0&&nativeZoomKeyResult.postedCount<program.length);}
      throw Error('CG Zoom program '+nativeZoomKeyResult.status+': '+(nativeZoomKeyResult.diagnostic?.code??'no diagnostic'));
    }catch(error){disabled=true;record('physical-input-failure',{action,delivery:completed?'sent/known_completed':knownNotSent?'not_sent':dispatched?'unknown/may_have_sent':'not_sent',keysPending:!!pending&&!pending.pointer,pointerDown:false,cleanupOnly:cleanup,error:error.message,execution:execution??error.execution??null,keyGuardExecution:preflight,postKeyGuardExecution:postflight,nativeZoomKeyResult,maximumGuardAgeMs:proof?age(proof.start):null});throw error;}
    finally{operationBusy=false;}
  }
  function fixedWindow(frame){assert.ok(frame&&['x','y','width','height'].every(key=>Number.isFinite(frame[key])));if(baselineWindow)assert.deepEqual(frame,baselineWindow,'Owned AX window changed during installed proof');else baselineWindow={...frame};}
  const clock=()=>process.hrtime.bigint(),age=start=>Number(clock()-start)/1e6;
  async function perform(action,cleanup=false){
    if(nativeZoomCg&&['zoom-in','zoom-reset'].includes(action))return performZoom(action,cleanup);
    if(nativeZoomCg)assert.equal(operationBusy,false,'One private key operation at a time');let proof=null,preflight=null,execution=null,dispatched=false,completed=false;
    const keyGuardAgeMs=browser==='safari'&&keySpecs[action]?safariKeyGuardAgeMs:limits.guardAgeMs;
    try {
      const key=keySpecs[action],pointer=pointerTargets[action];assert.ok(key||pointer);assert.ok(mountedId());
      assert.ok(cleanup?pending&&!cleanupUsed&&!pending.pointer:!disabled);if(cleanup){assert.equal(action,pending.action);cleanupUsed=true;}
      proof=await (cleanup?cleanupGuard(action):guard(action));const v=proof.value;
      assert.equal(typeof proof.start,'bigint');assert.ok(proof.id.startsWith(config.nonce+':'));assert.equal(v.nonce,config.nonce);assert.equal(v.url,config.fixtureUrl);assert.equal(v.title,config.title);
      assert.equal(v.id,mountedId());assert.equal(v.mountedId,mountedId());assert.equal(v.action,action);assert.ok(caseIds.includes(v.caseId)&&caseActions[v.caseId].includes(action));assert.equal(v.allowed,true);
      if(cleanup){assert.equal(v.id,pending.mount);assert.equal(v.caseId,pending.caseId);}
      assert.ok(Math.abs(v.zoomEvidence.dprRatio-1)<.01||Math.abs(v.zoomEvidence.dprRatio-v.viewport.pageZoom)<.01,'Unexpected hardware/DPR transition during fixed-window zoom');
      assert.ok(cleanup?v.releaseOnly===true:v.documentFocused===true);assert.equal(v.editorConnected,true);assert.equal(v.target,pointer??'focused');assert.equal(v.pointerDown,false);
      assert.ok(Number.isSafeInteger(v.serial)&&v.serial>serial);serial=v.serial;
      const remaining=Math.floor(keyGuardAgeMs-age(proof.start));assert.ok(remaining>0,'Fresh66 page guard expired');
      const request={format:'osr66-native-input/1',browser,nonce:config.nonce,title:config.title,fixtureUrl:config.fixtureUrl,mountedId:mountedId(),requestId:proof.id,serial,caseId:v.caseId,action,target:v.target,point:v.point,viewport:v.viewport,pointerDown:false,cleanupOnly:cleanup,deadlineMs:remaining};
      // One bounded number for this original pointer pair; pending.request owns cleanup's number.
      if(pointer){assert.ok(Number.isSafeInteger(serial)&&serial>=1&&serial<=2048);request.mouseEventNumber=serial;}
      if(key){
        preflight=run(inputHelper,['--guard-key',JSON.stringify(request)],{timeout:remaining,fullStdout:true,maxBuffer:32768});const strict=JSON.parse(preflight.stdout);
        assert.equal(strict.status,'guarded');assert.equal(strict.delivery,'not_sent');assert.equal(strict.cleanupOnly,cleanup);assert.equal(strict.frontBundle,browser==='chrome'?'com.google.Chrome':'com.apple.Safari');
        fixedWindow(strict.axWindow);
        if(cleanup)assert.equal(strict.frontPid,pending.pid);
        for(const [name,value]of Object.entries({action,requestId:proof.id,nonce:config.nonce,mountedId:mountedId(),caseId:v.caseId,target:v.target}))assert.equal(strict[name],value);
        const left=Math.floor(keyGuardAgeMs-age(proof.start));assert.ok(left>0,'AX guard consumed deadline');pending={action,pointer:false,pid:strict.frontPid,mount:mountedId(),caseId:v.caseId};dispatched=true;
        const keyArguments=[keyScriptPath,browser,strict.expectedAxWindowTitle,String(strict.frontPid),(cleanup?'release-':'')+action];
        execution=run('/usr/bin/osascript',keyArguments,{timeout:left,fullStdout:true,maxBuffer:32768});
        const actual=JSON.parse(execution.stdout);
        assert.equal(actual.action,(cleanup?'release-':'')+action);assert.equal(actual.status,cleanup?'keys-released':'key-sent');assert.equal(actual.keyCode,key.code);assert.deepEqual(actual.modifiers,key.modifiers);assert.equal(actual.frontPid,strict.frontPid);
        assert.deepEqual(actual.keyTransitions,cleanup?[...key.modifiers.map(m=>m+'-up'),`key${key.code}-up`]:[...key.modifiers.map(m=>m+'-down'),`key${key.code}-down`,`key${key.code}-up`,...key.modifiers.toReversed().map(m=>m+'-up')]);
        completed=true;pending=null;assert.ok(age(proof.start)<=keyGuardAgeMs,keyGuardAgeMs===1000?'Total66 key guard exceeded1s':'Total66 key guard exceeded1500ms');
        const value={action,delivery:'sent',actual,execution,pageGuard:proof.value,keyGuard:strict,keyGuardExecution:preflight,maximumGuardAgeMs:age(proof.start),guardAgeLimitMs:keyGuardAgeMs,cleanupOnly:cleanup,keysPending:false,requestId:proof.id};record(cleanup?'owned-key-release':'physical-input',value);return value;
      }
      assert.equal(cleanup,false);pending={action,pointer:true,request};dispatched=true;
      execution=run(inputHelper,['--request',JSON.stringify(request)],{timeout:remaining,fullStdout:true,maxBuffer:32768});const actual=JSON.parse(execution.stdout);
      assert.equal(actual.status,'sent');assert.equal(actual.delivery,'sent');assert.deepEqual(actual.transitions,['down','up']);assert.equal(actual.action,action);assert.equal(actual.requestId,proof.id);
      fixedWindow(actual.axWindow);
      assert.equal(actual.mouseEventNumber,request.mouseEventNumber);assert.deepEqual(actual.constructedMouseEventNumbers,[request.mouseEventNumber,request.mouseEventNumber]);
      for(const [name,value]of Object.entries({nonce:config.nonce,mountedId:mountedId(),caseId:v.caseId,target:v.target}))assert.equal(actual[name],value);
      completed=true;pending=null;assert.ok(age(proof.start)<=limits.guardAgeMs,'Total66 pointer guard exceeded1s');
      const value={action,delivery:'sent',actual,execution,pageGuard:proof.value,maximumGuardAgeMs:age(proof.start),guardAgeLimitMs:limits.guardAgeMs,cleanupOnly:false,keysPending:false,pointerDown:false,requestId:proof.id};record('physical-input',value);return value;
    } catch(error){let knownNotSent=false;if(pointerTargets[action]&&error.execution?.stdout)try{knownNotSent=JSON.parse(error.execution.stdout).delivery==='not_sent';}catch{}if(knownNotSent)pending=null;disabled=true;record('physical-input-failure',{action,delivery:completed?'sent/known_completed':knownNotSent?'not_sent':dispatched?'unknown/may_have_sent':'not_sent',keysPending:!!pending&&!pending.pointer,pointerDown:!!pending?.pointer,cleanupOnly:cleanup,error:error.message,execution:execution??error.execution??null,keyGuardExecution:preflight,maximumGuardAgeMs:proof?age(proof.start):null,guardAgeLimitMs:keyGuardAgeMs});throw error;}
  }
  return {input:action=>perform(action),retireFindEpisode:()=>{ownerEpoch++;},get disabled(){return disabled;},get keysPending(){return !!pending&&!pending.pointer;},get pointerDown(){return !!pending?.pointer;},get pointerState(){return pending?.pointer?'unknown':'up';},
    releaseOwnedKeys:()=>{assert.ok(pending&&!pending.pointer);return perform(pending.action,true);},async releaseOwnedPointer(){
      assert.ok(pending?.pointer&&!cleanupUsed);cleanupUsed=true;const saved=pending;let execution=null,actual=null,request=null;
      try {
      const proof=await cleanupGuard(saved.action),v=proof.value;assert.equal(typeof proof.start,'bigint');assert.ok(proof.id.startsWith(config.nonce+':'));assert.ok(Number.isSafeInteger(v.serial)&&v.serial>serial);serial=v.serial;
      assert.equal(v.nonce,config.nonce);assert.equal(v.id,mountedId());assert.equal(v.id,saved.request.mountedId);assert.equal(v.mountedId,saved.request.mountedId);assert.equal(v.action,saved.action);assert.equal(v.target,saved.request.target);assert.equal(v.releaseOnly,true);assert.equal(v.allowed,true);assert.equal(v.editorConnected,true);
      assert.equal(v.url,config.fixtureUrl);assert.equal(v.title,config.title);assert.equal(v.caseId,saved.request.caseId);assert.deepEqual(v.viewport,saved.request.viewport);
      const remaining=Math.floor(limits.guardAgeMs-age(proof.start));assert.ok(remaining>0);
      // Fresh cleanup proof retains the original pair's number, never its new guard serial.
      assert.ok(Number.isSafeInteger(saved.request.mouseEventNumber)&&saved.request.mouseEventNumber>=1&&saved.request.mouseEventNumber<=2048&&saved.request.mouseEventNumber<=v.serial);
      request={...saved.request,requestId:proof.id,serial:v.serial,cleanupOnly:true,pointerDown:true,deadlineMs:remaining};
      execution=run(inputHelper,['--request',JSON.stringify(request)],{timeout:remaining,fullStdout:true,maxBuffer:32768});actual=JSON.parse(execution.stdout);
      assert.equal(actual.status,'sent');assert.equal(actual.delivery,'sent');assert.equal(actual.cleanupOnly,true);assert.deepEqual(actual.transitions,['up']);
      assert.equal(actual.mouseEventNumber,saved.request.mouseEventNumber);assert.deepEqual(actual.constructedMouseEventNumbers,[saved.request.mouseEventNumber]);
      for(const name of ['action','requestId','nonce','mountedId','caseId','target'])assert.equal(actual[name],request[name]);
      assert.equal(actual.frontBundle,browser==='chrome'?'com.google.Chrome':'com.apple.Safari');assert.ok(Number.isSafeInteger(actual.frontPid)&&actual.frontPid>0);
      const expectedTitle=config.title+(browser==='chrome'?' - Google Chrome':'');assert.equal(actual.expectedAxWindowTitle,expectedTitle);assert.equal(actual.observedAxWindowTitle,expectedTitle);
      assert.ok(Number.isSafeInteger(actual.axWindowCount)&&actual.axWindowCount>=1&&actual.axWindowCount<=32);
      assert.ok(actual.axWindow&&['x','y','width','height'].every(key=>Number.isFinite(actual.axWindow[key])));assert.ok(actual.axWindow.width>0&&actual.axWindow.height>0);
      // Compare only an actually validated earlier measurement. An opaque first
      // pointer failure supplies no original window rectangle to invent here.
      if(baselineWindow)assert.deepEqual(actual.axWindow,baselineWindow,'Owned AX window changed during release-only cleanup');
      assert.ok(age(proof.start)<=limits.guardAgeMs);
      pending=null;const value={delivery:'sent',scope:'One release-only transition for this owner’s uncertain click; no down/replay',request,actual,execution};record('owned-pointer-release',value);return value;
      }catch(error){record('owned-pointer-release-failure',{action:saved.action,error:error.message,request,actual,execution:execution??error.execution??null,delivery:'unknown release completion; original action remains FAILED'});throw error;}
    }};
}
