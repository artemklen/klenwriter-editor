// SPDX-License-Identifier: MIT OR Apache-2.0
// Same strict AX/System Events ownership model as composition41, separate42 API.
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
  return `if fixtureAction is "${actual}" then\n tell application "System Events"\n  ${lines.join('\n  ')}\n end tell\n my requireFixture(expectedPID, expectedName, expectedBundle, expectedTitle)\n return "${prefix.replaceAll('\\','\\\\').replaceAll('"','\\"')}" & expectedPID & "}"\nend if`;
})).join('\n');
export const fixedKeyScript=requireFixture+`on run argv
 if (count of argv) is not 4 then error "Closed UI42 key arguments required"
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
 error "Unknown closed UI42 key"
end run
`;
export function createInputOwner({browser,config,inputHelper,keyScriptPath,run,record,guard,cleanupGuard,mountedId}){
  assert.ok(['chrome','safari'].includes(browser));assert.match(config.nonce,/^[a-f0-9]{32}$/);assert.equal(config.fixtureUrl,'http://127.0.0.1:4174/ui');assert.equal(config.title,'KlenWriter UI native '+config.nonce);
  let disabled=false,serial=0,pending=null,cleanupUsed=false,baselineWindow=null;
  function fixedWindow(frame){assert.ok(frame&&['x','y','width','height'].every(key=>Number.isFinite(frame[key])));if(baselineWindow)assert.deepEqual(frame,baselineWindow,'Owned AX window changed during installed proof');else baselineWindow={...frame};}
  const clock=()=>process.hrtime.bigint(),age=start=>Number(clock()-start)/1e6;
  async function perform(action,cleanup=false){let proof=null,preflight=null,execution=null,dispatched=false,completed=false;
    try {
      const key=keySpecs[action],pointer=pointerTargets[action];assert.ok(key||pointer);assert.ok(mountedId());
      assert.ok(cleanup?pending&&!cleanupUsed&&!pending.pointer:!disabled);if(cleanup){assert.equal(action,pending.action);cleanupUsed=true;}
      proof=await (cleanup?cleanupGuard(action):guard(action));const v=proof.value;
      assert.equal(typeof proof.start,'bigint');assert.ok(proof.id.startsWith(config.nonce+':'));assert.equal(v.nonce,config.nonce);assert.equal(v.url,config.fixtureUrl);assert.equal(v.title,config.title);
      assert.equal(v.id,mountedId());assert.equal(v.mountedId,mountedId());assert.equal(v.action,action);assert.ok(caseIds.includes(v.caseId)&&caseActions[v.caseId].includes(action));assert.equal(v.allowed,true);
      if(cleanup){assert.equal(v.id,pending.mount);assert.equal(v.caseId,pending.caseId);}
      assert.ok(Math.abs(v.zoomEvidence.dprRatio-1)<.01||Math.abs(v.zoomEvidence.dprRatio-v.viewport.pageZoom)<.01,'Unexpected hardware/DPR transition during fixed-window zoom');
      assert.ok(cleanup?v.releaseOnly===true:v.documentFocused===true||action==='close-find'&&v.documentFocused===false);assert.equal(v.editorConnected,true);assert.equal(v.target,pointer??'focused');assert.equal(v.pointerDown,false);
      assert.ok(Number.isSafeInteger(v.serial)&&v.serial>serial);serial=v.serial;
      const remaining=Math.floor(limits.guardAgeMs-age(proof.start));assert.ok(remaining>0,'Fresh42 page guard expired');
      const request={format:'osr42-native-input/1',browser,nonce:config.nonce,title:config.title,fixtureUrl:config.fixtureUrl,mountedId:mountedId(),requestId:proof.id,serial,caseId:v.caseId,action,target:v.target,point:v.point,viewport:v.viewport,pointerDown:false,cleanupOnly:cleanup,deadlineMs:remaining};
      if(key){
        preflight=run(inputHelper,['--guard-key',JSON.stringify(request)],{timeout:remaining,fullStdout:true,maxBuffer:32768});const strict=JSON.parse(preflight.stdout);
        assert.equal(strict.status,'guarded');assert.equal(strict.delivery,'not_sent');assert.equal(strict.cleanupOnly,cleanup);assert.equal(strict.frontBundle,browser==='chrome'?'com.google.Chrome':'com.apple.Safari');
        fixedWindow(strict.axWindow);
        if(cleanup)assert.equal(strict.frontPid,pending.pid);
        for(const [name,value]of Object.entries({action,requestId:proof.id,nonce:config.nonce,mountedId:mountedId(),caseId:v.caseId,target:v.target}))assert.equal(strict[name],value);
        const left=Math.floor(limits.guardAgeMs-age(proof.start));assert.ok(left>0,'AX guard consumed deadline');pending={action,pointer:false,pid:strict.frontPid,mount:mountedId(),caseId:v.caseId};dispatched=true;
        execution=run('/usr/bin/osascript',[keyScriptPath,browser,strict.expectedAxWindowTitle,String(strict.frontPid),(cleanup?'release-':'')+action],{timeout:left,fullStdout:true,maxBuffer:32768});
        const actual=JSON.parse(execution.stdout);assert.equal(actual.action,(cleanup?'release-':'')+action);assert.equal(actual.status,cleanup?'keys-released':'key-sent');assert.equal(actual.keyCode,key.code);assert.deepEqual(actual.modifiers,key.modifiers);assert.equal(actual.frontPid,strict.frontPid);
        assert.deepEqual(actual.keyTransitions,cleanup?[...key.modifiers.map(m=>m+'-up'),`key${key.code}-up`]:[...key.modifiers.map(m=>m+'-down'),`key${key.code}-down`,`key${key.code}-up`,...key.modifiers.toReversed().map(m=>m+'-up')]);
        completed=true;pending=null;assert.ok(age(proof.start)<=limits.guardAgeMs,'Total42 key guard exceeded1s');
        const value={action,delivery:'sent',actual,execution,pageGuard:proof.value,keyGuard:strict,keyGuardExecution:preflight,maximumGuardAgeMs:age(proof.start),guardAgeLimitMs:limits.guardAgeMs,cleanupOnly:cleanup,keysPending:false,requestId:proof.id};record(cleanup?'owned-key-release':'physical-input',value);return value;
      }
      assert.equal(cleanup,false);pending={action,pointer:true,request};dispatched=true;
      execution=run(inputHelper,['--request',JSON.stringify(request)],{timeout:remaining,fullStdout:true,maxBuffer:32768});const actual=JSON.parse(execution.stdout);
      assert.equal(actual.status,'sent');assert.equal(actual.delivery,'sent');assert.deepEqual(actual.transitions,['down','up']);assert.equal(actual.action,action);assert.equal(actual.requestId,proof.id);
      fixedWindow(actual.axWindow);
      for(const [name,value]of Object.entries({nonce:config.nonce,mountedId:mountedId(),caseId:v.caseId,target:v.target}))assert.equal(actual[name],value);
      completed=true;pending=null;assert.ok(age(proof.start)<=limits.guardAgeMs,'Total42 pointer guard exceeded1s');
      const value={action,delivery:'sent',actual,execution,pageGuard:proof.value,maximumGuardAgeMs:age(proof.start),guardAgeLimitMs:limits.guardAgeMs,cleanupOnly:false,keysPending:false,pointerDown:false,requestId:proof.id};record('physical-input',value);return value;
    } catch(error){let knownNotSent=false;if(pointerTargets[action]&&error.execution?.stdout)try{knownNotSent=JSON.parse(error.execution.stdout).delivery==='not_sent';}catch{}if(knownNotSent)pending=null;disabled=true;record('physical-input-failure',{action,delivery:completed?'sent/known_completed':knownNotSent?'not_sent':dispatched?'unknown/may_have_sent':'not_sent',keysPending:!!pending&&!pending.pointer,pointerDown:!!pending?.pointer,cleanupOnly:cleanup,error:error.message,execution:execution??error.execution??null,keyGuardExecution:preflight,maximumGuardAgeMs:proof?age(proof.start):null});throw error;}
  }
  return {input:action=>perform(action),get disabled(){return disabled;},get keysPending(){return !!pending&&!pending.pointer;},get pointerDown(){return !!pending?.pointer;},get pointerState(){return pending?.pointer?'unknown':'up';},
    releaseOwnedKeys:()=>{assert.ok(pending&&!pending.pointer);return perform(pending.action,true);},async releaseOwnedPointer(){
      assert.ok(pending?.pointer&&!cleanupUsed);cleanupUsed=true;const saved=pending;let execution=null,actual=null,request=null;
      try {
      const proof=await cleanupGuard(saved.action),v=proof.value;assert.equal(typeof proof.start,'bigint');assert.ok(proof.id.startsWith(config.nonce+':'));assert.ok(Number.isSafeInteger(v.serial)&&v.serial>serial);serial=v.serial;
      assert.equal(v.nonce,config.nonce);assert.equal(v.id,mountedId());assert.equal(v.id,saved.request.mountedId);assert.equal(v.mountedId,saved.request.mountedId);assert.equal(v.action,saved.action);assert.equal(v.target,saved.request.target);assert.equal(v.releaseOnly,true);assert.equal(v.allowed,true);assert.equal(v.editorConnected,true);
      assert.equal(v.url,config.fixtureUrl);assert.equal(v.title,config.title);assert.equal(v.caseId,saved.request.caseId);assert.deepEqual(v.viewport,saved.request.viewport);
      const remaining=Math.floor(limits.guardAgeMs-age(proof.start));assert.ok(remaining>0);
      request={...saved.request,requestId:proof.id,serial:v.serial,cleanupOnly:true,pointerDown:true,deadlineMs:remaining};
      execution=run(inputHelper,['--request',JSON.stringify(request)],{timeout:remaining,fullStdout:true,maxBuffer:32768});actual=JSON.parse(execution.stdout);
      assert.equal(actual.status,'sent');assert.equal(actual.delivery,'sent');assert.equal(actual.cleanupOnly,true);assert.deepEqual(actual.transitions,['up']);
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
export function captureOwnedWindow({browser,config,inputHelper,run,path,viewport}){
  const request={format:'osr42-native-window-inspection/1',browser,nonce:config.nonce,title:config.title,fixtureUrl:config.fixtureUrl,deadlineMs:1000,viewport};
  const guardExecution=run(inputHelper,['--inspect-window',JSON.stringify(request)],{timeout:1000,fullStdout:true,maxBuffer:32768}),actual=JSON.parse(guardExecution.stdout);
  assert.equal(actual.status,'inspected');assert.equal(actual.delivery,'not_sent');assert.equal(actual.nonce,config.nonce);assert.equal(actual.fixtureUrl,config.fixtureUrl);assert.equal(actual.contained,true);
  const r=actual.axWindow;for(const n of Object.values(r))assert.ok(Number.isFinite(n));
  const rect=[Math.floor(r.x),Math.floor(r.y),Math.ceil(r.width),Math.ceil(r.height)];assert.ok(rect[2]>0&&rect[3]>0&&rect[2]<=4096&&rect[3]<=4096);
  const execution=run('/usr/sbin/screencapture',['-x','-R'+rect.join(','),path],{timeout:5000,fullStdout:true});return {path,scope:'Exact owned foreground fixture AX window rectangle; screenshot only, no input',guardExecution,actual,execution};
}
