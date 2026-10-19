// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import {actions,caseIds,limits} from './protocol.mjs';
export {prepareChromeWindow} from './chrome-bootstrap.mjs';
const clock=()=>process.hrtime.bigint(),age=start=>Number(clock()-start)/1e6;
export const keySpecs=Object.freeze({'ordinary-en':{code:6,modifier:'shift'},'ordinary-ru':{code:6,modifier:'none'},'deadkey-acute':{code:14,modifier:'option'},'complete-e':{code:14,modifier:'none'},escape:{code:53,modifier:'none'},'shift-tab':{code:48,modifier:'shift'},tab:{code:48,modifier:'none'}});
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
  const actual=(cleanup?'release-':'')+action,modifier=spec.modifier==='none'?null:spec.modifier;
  const keys=cleanup?[...(modifier?[`key up ${modifier}`]:[]),`key up ${spec.code}`]:[...(modifier?[`key down ${modifier}`]:[]),`key down ${spec.code}`,`key up ${spec.code}`,...(modifier?[`key up ${modifier}`]:[])];
  const transitions=cleanup?[...(modifier?[`${modifier}-up`]:[]),`key${spec.code}-up`]:[...(modifier?[`${modifier}-down`]:[]),`key${spec.code}-down`,`key${spec.code}-up`,...(modifier?[`${modifier}-up`]:[])];
  const reply=JSON.stringify({status:cleanup?'keys-released':'key-sent',action:actual,keyCode:spec.code,modifier:spec.modifier,keyTransitions:transitions}).slice(0,-1)+',"frontPid":';
  const literal=reply.replaceAll('\\','\\\\').replaceAll('"','\\"');
  return `if fixtureAction is "${actual}" then\n tell application "System Events"\n  ${keys.join('\n  ')}\n end tell\n my requireFixture(expectedPID, expectedName, expectedBundle, expectedTitle)\n return "${literal}" & expectedPID & "}"\nend if`;
})).join('\n');
export const fixedKeyScript=requireFixture+`on run argv
 if (count of argv) is not 4 then error "Closed composition key arguments required"
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
 error "Unknown closed composition action"
end run
`;
export function createInputOwner({browser,config,inputHelper,keyScriptPath,run,record,guard,mountedId,clock=()=>process.hrtime.bigint()}){
  const age=start=>Number(clock()-start)/1e6;
  assert.ok(['chrome','safari'].includes(browser));assert.match(config.nonce,/^[a-f0-9]{32}$/);assert.equal(config.origin,'http://127.0.0.1:4174');assert.equal(config.fixtureUrl,'http://127.0.0.1:4174/composition');assert.equal(config.title,'KlenWriter Composition native '+config.nonce);assert.ok(typeof inputHelper==='string'&&inputHelper.startsWith('/')&&!inputHelper.includes('\0'));assert.ok(typeof keyScriptPath==='string'&&keyScriptPath.startsWith('/')&&keyScriptPath.endsWith('.scpt')&&!keyScriptPath.includes('\0'));
  let disabled=false,serial=0,pending=null,cleanupUsed=false;
  async function perform(action,cleanup=false){let proof=null,preflight=null,execution=null,dispatched=false,completed=false;
    try{
      assert.ok(actions.includes(action)&&mountedId());assert.ok(cleanup?pending&&!cleanupUsed&&!pending.released:!disabled);
      if(cleanup){assert.equal(pending.action,action);assert.equal(pending.mount,mountedId());cleanupUsed=true;}
      proof=await guard(action);const v=proof.value;assert.equal(typeof proof.start,'bigint');assert.ok(proof.id.startsWith(config.nonce+':'));
      assert.equal(v.nonce,config.nonce);assert.equal(v.url,config.fixtureUrl);assert.equal(v.title,config.title);assert.equal(v.id,mountedId());assert.equal(v.mountedId,mountedId());assert.equal(v.action,action);assert.ok(caseIds.includes(v.caseId));assert.equal(v.allowed,true);assert.equal(v.documentFocused,true);assert.equal(v.editorConnected,true);assert.ok(Number.isSafeInteger(v.serial)&&v.serial>serial);assert.equal(v.target,action==='tab'?'host-control':'editor');
      assert.deepEqual(v.viewport,{width:1024,height:768,scale:1,offsetLeft:0,offsetTop:0});assert.equal(v.point,null);assert.equal(v.pointerDown,false);serial=v.serial;
      const remaining=Math.floor(limits.guardAgeMs-age(proof.start));assert.ok(remaining>0,'Fresh page guard expired');
      const request={format:'osr41-native-input/1',browser,nonce:config.nonce,title:config.title,fixtureUrl:config.fixtureUrl,mountedId:mountedId(),requestId:proof.id,serial,caseId:v.caseId,action,target:v.target,point:null,viewport:v.viewport,pointerDown:false,cleanupOnly:false,deadlineMs:remaining,mouseFrom:null};
      preflight=run(inputHelper,['--guard-key',JSON.stringify(request)],{timeout:remaining,fullStdout:true,maxBuffer:32768});const k=JSON.parse(preflight.stdout);
      assert.equal(k.status,'guarded');assert.equal(k.delivery,'not_sent');for(const [field,value]of Object.entries({action,requestId:proof.id,nonce:config.nonce,mountedId:mountedId(),caseId:v.caseId,target:v.target}))assert.equal(k[field],value);
      assert.equal(k.frontBundle,browser==='chrome'?'com.google.Chrome':'com.apple.Safari');assert.ok(Number.isSafeInteger(k.frontPid)&&k.frontPid>0&&k.frontPid<=2147483647);assert.equal(k.cleanupOnly,false);assert.equal(k.expectedAxWindowTitle,config.title+(browser==='chrome'?' - Google Chrome':''));assert.equal(k.observedAxWindowTitle,k.expectedAxWindowTitle);assert.ok(Number.isSafeInteger(k.axWindowCount)&&k.axWindowCount>=1&&k.axWindowCount<=32);assert.ok(['x','y','width','height'].every(key=>Number.isFinite(k.axViewport?.[key])));assert.ok(Math.abs(k.axViewport.width-1024)<=.5&&Math.abs(k.axViewport.height-768)<=.5);assert.ok(Number.isFinite(k.elapsedMs)&&k.elapsedMs>=0&&k.elapsedMs<=remaining);if(cleanup){assert.equal(k.frontPid,pending.pid);assert.equal(v.caseId,pending.caseId);}
      const left=Math.floor(limits.guardAgeMs-age(proof.start));assert.ok(left>0,'Strict preflight consumed deadline');const physical=(cleanup?'release-':'')+action;
      pending={action,mount:mountedId(),caseId:v.caseId,pid:k.frontPid,released:false};dispatched=true;
      execution=run('/usr/bin/osascript',[keyScriptPath,browser,k.expectedAxWindowTitle,String(k.frontPid),physical],{timeout:left,fullStdout:true,maxBuffer:32768});
      const actual=JSON.parse(execution.stdout);assert.equal(actual.action,physical);assert.equal(actual.status,cleanup?'keys-released':'key-sent');assert.equal(actual.keyCode,keySpecs[action].code);assert.equal(actual.modifier,keySpecs[action].modifier);assert.equal(actual.frontPid,k.frontPid);
      const spec=keySpecs[action],modifier=spec.modifier==='none'?[]:[spec.modifier];assert.deepEqual(actual.keyTransitions,cleanup?[...modifier.map(x=>x+'-up'),`key${spec.code}-up`]:[...modifier.map(x=>x+'-down'),`key${spec.code}-down`,`key${spec.code}-up`,...modifier.map(x=>x+'-up')]);pending=null;completed=true;
      assert.ok(age(proof.start)<=limits.guardAgeMs,'Total input guard exceeded1s');const value={action:physical,delivery:'sent',actual,execution,keyGuardExecution:preflight,keyGuard:k,maximumGuardAgeMs:age(proof.start),guardAgeLimitMs:limits.guardAgeMs,cleanupOnly:cleanup,keysPending:false,requestId:proof.id};record(cleanup?'cleanup-key-release':'physical-input',value);return value;
    }catch(error){disabled=true;record('physical-input-failure',{action,delivery:completed?'sent/known_completed':dispatched?'unknown/may_have_sent':'not_sent',keysPending:pending!==null,cleanupOnly:cleanup,error:error.message,execution:execution??error.execution??null,keyGuardExecution:preflight,maximumGuardAgeMs:proof?age(proof.start):null});throw error;}
  }
  return {input:action=>perform(action),get disabled(){return disabled;},get keysPending(){return pending!==null;},get pointerDown(){return false;},get pointerState(){return 'up';},async releaseOwnedPointer(){throw Error('Composition protocol has no posted pointer');},releaseOwnedKeys:()=>{assert.ok(pending);return perform(pending.action,true);}};
}
