// SPDX-License-Identifier: MIT OR Apache-2.0
// One fixture owner. Returned page points are not a general coordinate/key API.
import {actions,caseIds,limits} from './protocol.mjs';
import assert from 'node:assert/strict';
const now=()=>process.hrtime.bigint(),age=start=>Number(now()-start)/1e6;
const mouseActions=new Set(['move-start','down','move-end','up']);
const keyActions=Object.freeze({'shift-left':{code:123,modifier:'shift'},'select-all':{code:0,modifier:'command'},
  copy:{code:8,modifier:'command'},cut:{code:7,modifier:'command'},'shift-tab':{code:48,modifier:'shift'},tab:{code:48,modifier:'none'}});
export const fixedKeyScript=`on requireFixture(expectedPID, expectedName, expectedBundle, expectedTitle)
  tell application "System Events"
    set ownedProcesses to (application processes whose unix id is expectedPID)
    if (count of ownedProcesses) is not 1 then error "Exact fixture browser PID unavailable"
    set ownedProcess to item 1 of ownedProcesses
    tell ownedProcess
      if name is not expectedName or bundle identifier is not expectedBundle then error "Fixture browser identity changed"
      if frontmost is not true then error "Fixture browser is not frontmost for key"
      if (count of windows) is greater than 32 then error "Fixture AX window observation limit"
      if (count of (windows whose name is expectedTitle)) is not 1 then error "Fixture AX title is not unique"
      if not (exists front window) then error "Fixture front window missing"
      if (name of front window) is not expectedTitle then error "Exact fixture title is not frontmost"
      set focusedFixtureWindow to value of attribute "AXFocusedWindow"
      if (value of attribute "AXTitle" of focusedFixtureWindow) is not expectedTitle then error "Exact fixture title is not focused"
    end tell
  end tell
end requireFixture
on run argv
  if (count of argv) is not 4 then error "Closed fixture key arguments required"
  set expectedBrowser to item 1 of argv
  set expectedTitle to item 2 of argv
  set expectedPID to (item 3 of argv) as integer
  set fixtureAction to item 4 of argv
  if expectedPID is less than 1 then error "Invalid fixture browser PID"
  if expectedBrowser is "chrome" then
    set expectedName to "Google Chrome"
    set expectedBundle to "com.google.Chrome"
  else if expectedBrowser is "safari" then
    set expectedName to "Safari"
    set expectedBundle to "com.apple.Safari"
  else
    error "Browser outside closed fixture"
  end if
  if {"shift-left", "select-all", "copy", "cut", "shift-tab", "tab"} does not contain fixtureAction then error "Key action outside closed fixture"
  my requireFixture(expectedPID, expectedName, expectedBundle, expectedTitle)
  tell application "System Events"
    if fixtureAction is "shift-left" then
      key code 123 using {shift down}
      set physicalCode to 123
      set modifierName to "shift"
    else if fixtureAction is "select-all" then
      key code 0 using {command down}
      set physicalCode to 0
      set modifierName to "command"
    else if fixtureAction is "copy" then
      key code 8 using {command down}
      set physicalCode to 8
      set modifierName to "command"
    else if fixtureAction is "cut" then
      key code 7 using {command down}
      set physicalCode to 7
      set modifierName to "command"
    else if fixtureAction is "shift-tab" then
      key code 48 using {shift down}
      set physicalCode to 48
      set modifierName to "shift"
    else
      key code 48
      set physicalCode to 48
      set modifierName to "none"
    end if
    delay 0.12
  end tell
  my requireFixture(expectedPID, expectedName, expectedBundle, expectedTitle)
  return "{\\"status\\":\\"key-sent\\",\\"action\\":\\"" & fixtureAction & "\\",\\"keyCode\\":" & physicalCode & ",\\"modifier\\":\\"" & modifierName & "\\",\\"frontPid\\":" & expectedPID & "}"
end run`;
export function createInputOwner({browser,config,inputHelper,keyScriptPath,run,record,guard,mountedId}){
  if(!['safari','chrome'].includes(browser)||config.nonce.length!==32||!/^[a-f0-9]{32}$/.test(config.nonce)
    ||config.origin!=='http://127.0.0.1:4174'||config.fixtureUrl!==config.origin+'/selection'
    ||config.title!=='KlenWriter Selection native '+config.nonce||!inputHelper.startsWith('/')
    ||typeof keyScriptPath!=='string'||!keyScriptPath.startsWith('/')||!keyScriptPath.endsWith('.scpt')||keyScriptPath.includes('\0'))throw Error('Invalid closed selection input configuration');
  let disabled=false,serial=0,held=false,mayHaveDown=false,cleanupAttempted=false;
  async function perform(action,cleanup=false){
      let dispatchStarted=false,execution=null,keyGuardExecution=null,keyGuard=null,systemEventsExecution=null,proof=null,preAge=null;
      try{
        if((disabled&&!cleanup)||!actions.includes(action)||!mountedId())throw Error('Selection input disabled or missing owned mount');
        if(cleanup&&(action!=='up'||cleanupAttempted||!held&&!mayHaveDown))throw Error('No separately owned pointer cleanup is available');
        if(cleanup)cleanupAttempted=true;
        proof=await guard(action);const value=proof.value;
        if(typeof proof.start!=='bigint'||typeof proof.id!=='string'||!proof.id.startsWith(config.nonce+':')
          ||value.nonce!==config.nonce||value.url!==config.fixtureUrl||value.title!==config.title
          ||value.id!==mountedId()||value.mountedId!==mountedId()||value.action!==action||!caseIds.includes(value.caseId)
          ||value.allowed!==true||value.documentFocused!==true||value.editorConnected!==true
          ||!Number.isSafeInteger(value.serial)||value.serial<=serial||age(proof.start)>limits.guardAgeMs)throw Error('Fresh owned selection action guard refused');
        const expectedTarget=action==='tab'?'host-control':'editor';
        if(value.target!==expectedTarget&&!(action==='up'&&(held||mayHaveDown)&&value.target==='host-control'))throw Error('Selection input target differs');
        const viewport=value.viewport;
        if(!viewport||viewport.width!==1024||viewport.height!==768||viewport.scale!==1||viewport.offsetLeft!==0||viewport.offsetTop!==0)throw Error('Selection viewport is not the frozen geometry');
        if(typeof value.pointerDown!=='boolean'||action==='down'&&(held||value.pointerDown)
          ||action==='move-start'&&(held||value.pointerDown)||action==='move-end'&&(!held||!value.pointerDown)
          ||action==='up'&&!held&&!mayHaveDown||!mouseActions.has(action)&&action!=='shift-tab'&&(held||value.pointerDown))throw Error('Selection pointer transition differs');
        const point=value.point;
        if(mouseActions.has(action)?!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.x>=1024||point.y<0||point.y>=768:point!==null)throw Error('Missing or invalid fixed fixture point');
        if(action==='down'){
          const move=value.lastTrustedPointerMove;
          if(!move||move.isTrusted!==true||move.pointerType!=='mouse'||move.isPrimary!==true
            ||!Number.isSafeInteger(move.pointerId)||move.pointerId<=0||move.buttons!==0
            ||!Number.isFinite(move.time)||move.time<0||!Number.isFinite(move.x)||!Number.isFinite(move.y)
            ||Math.abs(move.x-point.x)>.5||Math.abs(move.y-point.y)>.5)throw Error('Actual trusted mousemove did not confirm the fixed start; no down posted');
        }
        serial=value.serial;preAge=age(proof.start);const remaining=Math.floor(limits.guardAgeMs-preAge);
        if(remaining<=0)throw Error('Selection guard expired before input');
        const request={format:'osr40-native-input/1',browser,nonce:config.nonce,title:config.title,fixtureUrl:config.fixtureUrl,
          mountedId:mountedId(),requestId:proof.id,serial,caseId:value.caseId,action,target:value.target,point,viewport,
          pointerDown:held||mayHaveDown,cleanupOnly:cleanup,deadlineMs:remaining};
        const json=JSON.stringify(request);if(Buffer.byteLength(json)>limits.commandBytes)throw Error('Selection physical request exceeds bound');
        let actual;
        if(mouseActions.has(action)){
          dispatchStarted=true;if(action==='down')mayHaveDown=true;
          execution=run(inputHelper,['--request',json],{timeout:remaining,fullStdout:true,maxBuffer:32768});
          actual=JSON.parse(execution.stdout);
          if(actual.status!=='sent'||actual.action!==action||actual.requestId!==proof.id||actual.nonce!==config.nonce)throw Error('Native physical input receipt differs');
        }else{
          try{keyGuardExecution=run(inputHelper,['--guard-key',json],{timeout:remaining,fullStdout:true,maxBuffer:32768});}
          catch(error){keyGuardExecution=error.execution??null;throw error;}
          keyGuard=JSON.parse(keyGuardExecution.stdout);
          if(keyGuard.status!=='guarded'||keyGuard.delivery!=='not_sent'||keyGuard.action!==action||keyGuard.requestId!==proof.id||keyGuard.nonce!==config.nonce
            ||keyGuard.mountedId!==mountedId()||keyGuard.caseId!==value.caseId||keyGuard.target!==value.target||keyGuard.cleanupOnly!==false
            ||keyGuard.frontBundle!==(browser==='chrome'?'com.google.Chrome':'com.apple.Safari')
            ||!Number.isSafeInteger(keyGuard.frontPid)||keyGuard.frontPid<=0||keyGuard.frontPid>2147483647
            ||keyGuard.expectedAxWindowTitle!==config.title+(browser==='chrome'?' - Google Chrome':'')
            ||keyGuard.observedAxWindowTitle!==keyGuard.expectedAxWindowTitle)throw Error('Strict native key preflight differs');
          const view=keyGuard.axViewport;
          if(!Number.isSafeInteger(keyGuard.axWindowCount)||keyGuard.axWindowCount<1||keyGuard.axWindowCount>32
            ||!view||!['x','y','width','height'].every(key=>Number.isFinite(view[key]))
            ||Math.abs(view.width-1024)>.5||Math.abs(view.height-768)>.5||!Number.isFinite(view.x+view.width)||!Number.isFinite(view.y+view.height)
            ||!Number.isFinite(keyGuard.elapsedMs)||keyGuard.elapsedMs<0||keyGuard.elapsedMs>remaining)throw Error('Strict native key geometry/deadline differs');
          const keyRemaining=Math.floor(limits.guardAgeMs-age(proof.start));
          if(keyRemaining<=0)throw Error('Selection guard expired after read-only key preflight; no key sent');
          dispatchStarted=true;
          try{systemEventsExecution=run('/usr/bin/osascript',[keyScriptPath,browser,keyGuard.expectedAxWindowTitle,String(keyGuard.frontPid),action],
            {timeout:keyRemaining,fullStdout:true,maxBuffer:32768});}
          catch(error){systemEventsExecution=error.execution??null;throw error;}
          execution=systemEventsExecution;actual=JSON.parse(execution.stdout);
          const expected=keyActions[action];
          if(actual.status!=='key-sent'||actual.action!==action||actual.keyCode!==expected.code||actual.modifier!==expected.modifier
            ||actual.frontPid!==keyGuard.frontPid)throw Error('System Events closed key receipt differs');
        }
        if(age(proof.start)>limits.guardAgeMs)throw Error('Selection guard expired during physical input');
        if(action==='down'){held=true;mayHaveDown=false;}else if(action==='up'){held=false;mayHaveDown=false;}
        const receipt={action,requestId:proof.id,pageGuardSerial:serial,mountedId:mountedId(),caseId:value.caseId,
          point,target:value.target,preDispatchGuardAgeMs:preAge,maximumGuardAgeMs:age(proof.start),guardAgeLimitMs:limits.guardAgeMs,
          lastTrustedPointerMove:action==='down'?value.lastTrustedPointerMove:null,
          execution,actual,keyGuardExecution,keyGuard,systemEventsExecution,delivery:'sent',pointerDown:held,cleanupOnly:cleanup,
          method:mouseActions.has(action)?'Strict AX guard + CGEvent mouse':'Fresh strict AX key preflight + precompiled System Events fixed key code; post receipt, not browser acknowledgement'};
        record(cleanup?'cleanup-pointer-release':'physical-input',receipt);return receipt;
      }catch(error){
        disabled=true;
        record(cleanup?'cleanup-pointer-release-failure':'physical-input-failure',{action,error:String(error?.message??error),execution:execution??error.execution??null,
          keyGuardExecution,keyGuard,systemEventsExecution,
          requestId:proof?.id??null,preDispatchGuardAgeMs:preAge,maximumGuardAgeMs:proof?.start?age(proof.start):null,
          lastTrustedPointerMove:proof?.value?.lastTrustedPointerMove??null,
          delivery:dispatchStarted?'unknown/may_have_sent':'not_sent',pointerState:held?'down':mayHaveDown?'may-have-down':'up',dispatchStarted,cleanupOnly:cleanup});
        throw error;
      }
  }
  return {
    get disabled(){return disabled;},get pointerDown(){return held||mayHaveDown;},
    get pointerState(){return mayHaveDown?'may-have-down':held?'down':'up';},
    input:action=>perform(action),
    async releaseOwnedPointer(){disabled=true;return perform('up',true);},
  };
}

// Bootstrap only. These readbacks never authorize a later physical action.
export async function prepareChromeWindow({config,pageState,inspectWindow,getBrowserPid,getTargetInfo,windowCommand,record,
  clock=()=>performance.now(),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  assert.match(config.nonce,/^[a-f0-9]{32}$/);
  assert.equal(config.nonce.length,32);
  assert.equal(config.title,'KlenWriter Selection native '+config.nonce);
  assert.equal(config.fixtureUrl,'http://127.0.0.1:4174/selection');
  const began=clock(),maximumMs=15000;let sequence=0;
  const remaining=()=>maximumMs-(clock()-began);
  async function step(operation,callback,cap=5000){
    const timeout=Math.floor(Math.min(cap,remaining()));assert.ok(timeout>0,'Chrome bootstrap deadline expired');
    const row={sequence:++sequence,operation,timeoutMs:timeout,status:'pending'};record('chrome-bootstrap',row);
    let timer;
    try{
      const value=await Promise.race([Promise.resolve().then(()=>callback(timeout)),new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(Error('Unknown Chrome bootstrap completion; no further commands permitted')),timeout);
      })]);
      assert.ok(remaining()>0,'Chrome bootstrap deadline expired after operation');
      record('chrome-bootstrap',{...row,status:'completed',result:value});return value;
    }catch(error){record('chrome-bootstrap',{...row,status:'failed',error:String(error?.message??error),execution:error.execution??null});throw error;}
    finally{clearTimeout(timer);}
  }
  function page(value){
    assert.equal(value.nonce,config.nonce,'Bootstrap page nonce changed');
    assert.equal(value.url,config.fixtureUrl,'Bootstrap page URL changed');assert.equal(value.title,config.title,'Bootstrap page title changed');
    assert.equal(value.documentFocused,true,'Bootstrap page lost focus');
    assert.deepEqual(value.viewport,{width:1024,height:768,scale:1,offsetLeft:0,offsetTop:0},'Frozen bootstrap viewport');
    assert.deepEqual(value.scroll,{x:0,y:0},'Bootstrap must not change document scroll');
    assert.ok(value.selection&&typeof value.selection==='object','Actual raw selection readback required');return value;
  }
  function rectangle(value){
    assert.ok(value&&['x','y','width','height'].every(key=>typeof value[key]==='number'&&Number.isFinite(value[key])),'Finite measured AX rectangle');
    assert.ok(value.width>0&&value.height>0&&Number.isFinite(value.x+value.width)&&Number.isFinite(value.y+value.height),'Finite positive measured AX edges');return value;
  }
  function bounds(value){
    assert.ok(value&&['left','top','width','height'].every(key=>Number.isSafeInteger(value[key])),'Exact own-window CDP bounds');
    assert.ok(value.width>0&&value.height>0);assert.equal(value.windowState,'normal');return value;
  }
  const ownPid=await step('own-browser-pid',getBrowserPid);assert.ok(Number.isSafeInteger(ownPid)&&ownPid>0);
  let baselinePage=null;
  async function snapshot(index){
    const before=page(await step('page-before-inspection',pageState));
    baselinePage??=before;
    assert.deepEqual(before.selection,baselinePage.selection,'Bootstrap changed actual raw selection');
    let request;
    const result=await step('read-only-window-inspection',timeout=>{
      request={format:'osr40-native-window-inspection/1',browser:'chrome',nonce:config.nonce,title:config.title,fixtureUrl:config.fixtureUrl,deadlineMs:timeout};
      return inspectWindow(request);
    },1000);
    assert.equal(result.execution.returnCode,0,'Inspector must complete successfully');
    const actual=result.actual;
    assert.equal(actual.format,'osr40-native-window-inspection/1');assert.equal(actual.status,'inspected');assert.equal(actual.delivery,'not_sent');
    assert.equal(actual.browser,'chrome');assert.equal(actual.nonce,config.nonce);assert.equal(actual.title,config.title);assert.equal(actual.fixtureUrl,config.fixtureUrl);
    assert.equal(actual.frontBundle,'com.google.Chrome');assert.equal(actual.frontPid,ownPid,'AX foreground PID differs from own CDP browser');
    assert.equal(actual.expectedAxWindowTitle,config.title+' - Google Chrome');assert.equal(actual.observedAxWindowTitle,actual.expectedAxWindowTitle);
    assert.ok(Number.isSafeInteger(actual.axWindowCount)&&actual.axWindowCount>=1&&actual.axWindowCount<=32);assert.equal(actual.axMatchCount,1);
    assert.ok(Number.isSafeInteger(actual.visitedNodes)&&actual.visitedNodes>=1&&actual.visitedNodes<=512);
    assert.ok(Number.isSafeInteger(actual.maximumDepth)&&actual.maximumDepth>=0&&actual.maximumDepth<=32);
    assert.ok(typeof actual.elapsedMs==='number'&&Number.isFinite(actual.elapsedMs)&&actual.elapsedMs>=0&&actual.elapsedMs<=request.deadlineMs);
    const frame=rectangle(actual.axWindow),view=rectangle(actual.axViewport);
    assert.ok(Math.abs(view.width-1024)<=.5&&Math.abs(view.height-768)<=.5,'Exact frozen AXWebArea size');
    const contained=view.x>=frame.x-.5&&view.x+view.width<=frame.x+frame.width+.5&&view.y>=frame.y-.5&&view.y+view.height<=frame.y+frame.height+.5;
    assert.equal(actual.contained,contained,'Inspection containment contradicts measured rectangles');
    const after=page(await step('page-after-inspection',pageState));
    assert.deepEqual(after.selection,baselinePage.selection,'Bootstrap changed actual raw selection');
    const value={index,before,request,execution:result.execution,actual,after};
    record('chrome-bootstrap-inspection',value);return actual;
  }
  let measured=await snapshot(0);
  const target=await step('own-page-target',getTargetInfo);assert.equal(target.type,'page');assert.equal(target.url,config.fixtureUrl);assert.equal(target.title,config.title);
  assert.ok(typeof target.targetId==='string'&&target.targetId.length>0);
  const ownWindow=await step('own-target-window',()=>windowCommand('Browser.getWindowForTarget',{targetId:target.targetId}));
  assert.ok(Number.isSafeInteger(ownWindow.windowId)&&ownWindow.windowId>0);bounds(ownWindow.bounds);
  let adjustments=0;
  while(!measured.contained&&adjustments<3){
    const frame=measured.axWindow,view=measured.axViewport;
    assert.ok(view.x>=frame.x-.5&&view.y>=frame.y-.5,'Left/top AX spill cannot use size-only bootstrap');
    const right=Math.max(0,view.x+view.width-frame.x-frame.width),bottom=Math.max(0,view.y+view.height-frame.y-frame.height);
    const widthIncrement=Math.ceil(right),heightIncrement=Math.ceil(bottom);assert.ok(widthIncrement>0||heightIncrement>0,'No measured positive spill; no blind resize');
    const before=bounds((await step('own-window-bounds-before',()=>windowCommand('Browser.getWindowBounds',{windowId:ownWindow.windowId}))).bounds);
    const requested={width:before.width+widthIncrement,height:before.height+heightIncrement};
    assert.ok(Number.isSafeInteger(requested.width)&&Number.isSafeInteger(requested.height),'Measured resize overflows bounds');
    const currentTarget=await step('own-page-target-before-resize',getTargetInfo);
    assert.equal(currentTarget.type,'page');assert.equal(currentTarget.targetId,target.targetId,'Own page target changed before resize');
    assert.equal(currentTarget.url,config.fixtureUrl);assert.equal(currentTarget.title,config.title);
    const currentWindow=await step('own-target-window-before-resize',()=>windowCommand('Browser.getWindowForTarget',{targetId:currentTarget.targetId}));
    assert.equal(currentWindow.windowId,ownWindow.windowId,'Own page moved to a different window before resize');
    assert.deepEqual(bounds(currentWindow.bounds),before,'Own window bounds changed before measured resize');
    const currentPage=page(await step('page-before-resize',pageState));
    assert.deepEqual(currentPage.selection,baselinePage.selection,'Bootstrap changed actual raw selection before resize');
    await step('own-window-measured-resize',()=>windowCommand('Browser.setWindowBounds',{windowId:ownWindow.windowId,bounds:requested}));
    await step('passive-window-settlement',()=>delay(100));
    const after=bounds((await step('own-window-bounds-after',()=>windowCommand('Browser.getWindowBounds',{windowId:ownWindow.windowId}))).bounds);
    assert.equal(after.left,before.left,'Bootstrap moved own window origin');assert.equal(after.top,before.top,'Bootstrap moved own window origin');
    record('chrome-bootstrap-resize',{round:++adjustments,measuredRightSpill:right,measuredBottomSpill:bottom,widthIncrement,heightIncrement,before,requested,after});
    measured=await snapshot(adjustments);
  }
  assert.equal(measured.contained,true,'Strict AX viewport guard still refuses after at most3 measured adjustments');
  const result={status:'prepared',ownBrowserPid:ownPid,windowId:ownWindow.windowId,adjustments,maximumMs,elapsedMs:clock()-began,
    authority:'Bootstrap geometry only; later input requires a new page and strict AX guard',measurement:measured};
  record('chrome-bootstrap-completed',result);return result;
}
