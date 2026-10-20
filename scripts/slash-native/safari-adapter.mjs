// SPDX-License-Identifier: MIT OR Apache-2.0
// OSR-43 dedicated namespace adaptation of the existing guarded OSR-41 transport; separate evidence.
// Installed Slash43 Safari fixture adapter. Safari page Apple Events end at bootstrap.
import {appendFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {limits,validCall,boundedJson} from './protocol.mjs';
import {createInputOwner} from './input.mjs';
import {prepareSafariAxReadiness} from './safari-readiness.mjs';

const wait = ms=>new Promise(resolve=>setTimeout(resolve,ms));
const now = ()=>process.hrtime.bigint();
const elapsedMs = start=>Number(now()-start)/1e6; // Guard freshness, not a performance measure.
const createWindow = `tell application "Safari"
  set previousIDs to id of every window
  if (count of previousIDs) is greater than or equal to 32 then error "Safari fixture window observation limit"
  make new document with properties {URL:"http://127.0.0.1:4174/ui"}
  set createdIDs to {}
  repeat with candidate in windows
    set candidateID to id of candidate
    if previousIDs does not contain candidateID then set end of createdIDs to candidateID
  end repeat
  if (count of createdIDs) is not 1 then error "Could not identify one new Safari fixture window"
  set ownedID to item 1 of createdIDs
  set bounds of window id ownedID to {80,60,1280,960}
  set index of window id ownedID to 1
  activate
  return ownedID as text
end tell`;
const bootstrapEvaluate = `on run argv
  set codePath to item 1 of argv
  set ownedID to (item 2 of argv) as integer
  set javascriptText to read (POSIX file codePath) as «class utf8»
  tell application "Safari"
    if not (exists window id ownedID) then error "Owned fixture window missing during bootstrap"
    set ownedWindow to window id ownedID
    if (count of tabs of ownedWindow) is not 1 then error "Owned fixture bootstrap tab count changed"
    if (URL of current tab of ownedWindow) is not "http://127.0.0.1:4174/ui" then error "Owned fixture bootstrap URL changed"
    return do JavaScript javascriptText in current tab of ownedWindow
  end tell
end run`;
const resizeBootstrap = `on run argv
  set ownedID to (item 1 of argv) as integer
  set deltaWidth to (item 2 of argv) as integer
  set deltaHeight to (item 3 of argv) as integer
  tell application "Safari"
    if not (exists window id ownedID) then error "Owned resize fixture window missing"
    set ownedWindow to window id ownedID
    if (count of tabs of ownedWindow) is not 1 then error "Owned resize fixture tab count changed"
    if (URL of current tab of ownedWindow) is not "http://127.0.0.1:4174/ui" then error "Owned resize fixture URL changed"
    set previousBounds to bounds of ownedWindow
    set newRight to (item 3 of previousBounds) + deltaWidth
    set newBottom to (item 4 of previousBounds) + deltaHeight
    if newRight - (item 1 of previousBounds) < 1024 or newRight - (item 1 of previousBounds) > 2048 then error "Fixture bootstrap width bound"
    if newBottom - (item 2 of previousBounds) < 768 or newBottom - (item 2 of previousBounds) > 1536 then error "Fixture bootstrap height bound"
    set bounds of ownedWindow to {item 1 of previousBounds,item 2 of previousBounds,newRight,newBottom}
    return "fixture-resized"
  end tell
end run`;
const guardedClose = `on run argv
  set expectedTitle to item 1 of argv
  tell application "System Events"
    tell application process "Safari"
      if frontmost is not true then error "Safari is not frontmost at fixture cleanup"
      if (count of windows) is greater than 32 then error "Fixture AX cleanup window observation limit"
      if (count of (windows whose name is expectedTitle)) is not 1 then error "Cleanup refused: fixture AX title is not unique"
      if not (exists front window) then error "Safari has no front fixture tab at cleanup"
      if (name of front window) is not expectedTitle then error "Cleanup refused: unique fixture title is not frontmost"
    end tell
    key code 13 using {command down}
  end tell
  return "fixture-CmdW-sent"
end run`;
const ownedTitleExists = `on run argv
  set expectedTitle to item 1 of argv
  tell application "System Events"
    tell application process "Safari"
      if (count of windows) is greater than 32 then error "Fixture AX cleanup observation limit"
      return (exists window expectedTitle) as text
    end tell
  end tell
end run`;

export async function createSafariAdapter({config,report,run,outputPath,inputHelper,keyScriptPath}) {
  if (config.format !== 'osr43-slash-http-broker/1' || !/^[a-f0-9]{32}$/.test(config.nonce)
    || config.origin !== 'http://127.0.0.1:4174' || config.fixtureUrl !== config.origin+'/ui'
    || config.base !== '/slash-native-broker-'+config.nonce || config.title !== 'KlenWriter Slash native '+config.nonce) throw new Error('Invalid closed broker configuration');
  const base = config.origin+config.base+'/', clientLog = resolve(config.directory,'client.jsonl');
  writeFileSync(clientLog,'',{flag:'wx'});
  let clientBytes = 0, serial = 0, inflight = false, disabled = false, bootstrapped = false, mountedId = null;
  function record(kind,value) {
    const line = JSON.stringify({time:new Date().toISOString(),kind,...value})+'\n', bytes = Buffer.byteLength(line);
    if (clientBytes+bytes > limits.logBytes) { disabled=true; throw new Error('Client receipt log bound'); }
    appendFileSync(clientLog,line,'utf8'); clientBytes += bytes;
  }
  async function exchange(path,value,deadlineStart,maximum=limits.resultBytes) {
    const remaining = limits.commandMs-elapsedMs(deadlineStart);
    if (remaining <= 0) throw new Error('Absolute broker call deadline exceeded');
    const request = value === undefined ? {} : {method:'POST',headers:{Origin:config.origin,'Content-Type':'application/json'},body:JSON.stringify({nonce:config.nonce,...value})};
    record('http-request',{path,...(value===undefined?{}:{value})});
    const response = await fetch(base+path,{...request,signal:AbortSignal.timeout(Math.max(1,Math.floor(remaining)))});
    const result = await boundedJson(response,maximum);
    if (elapsedMs(deadlineStart) > limits.commandMs) throw new Error('Absolute broker response deadline exceeded');
    record('http-response',{path,status:response.status,value:result});
    if (!response.ok) throw new Error('Fixture broker HTTP '+response.status+': '+path);
    return result;
  }
  async function rpc(method,args=[]) {
    if (disabled || inflight || serial>=limits.commands || !validCall(method,args)) throw new Error('Broker call unavailable, concurrent or outside closed API');
    inflight = true;
    const id = config.nonce+':'+String(++serial), start = now();
    try {
      const accepted = await exchange('host/submit',{id,method,args},start,limits.commandBytes);
      if (accepted.accepted !== id) throw new Error('Broker request acknowledgement differs');
      for (;;) {
        const result = await exchange('host/read',{id},start);
        if (result.id !== id) throw new Error('Broker result identity differs');
        if (result.done) {
          // exchange already persisted the complete host/read response before returning.
          record('native-result',{id,method,resultReference:{kind:'http-response',path:'host/read',id,done:true}});
          const ack = await exchange('host/ack',{id},start,limits.commandBytes);
          if (ack.acknowledged !== id) throw new Error('Broker result consumption differs');
          if (!result.result?.ok) throw Object.assign(new Error('Fixture method failed: '+result.result?.error),{nativeMethodFailure:true});
          return {id,value:result.result.value,start};
        }
        if (elapsedMs(start) >= limits.commandMs-100) throw new Error('Broker native call did not complete within deadline');
        await wait(100);
      }
    } catch (error) {
      if (!error.nativeMethodFailure) disabled = true; // No replay or new input on unknown completion.
      throw error;
    } finally { inflight = false; }
  }
  const inputOwner=createInputOwner({browser:'safari',config,inputHelper,keyScriptPath,run,record,guard:action=>rpc('guard',[action]),cleanupGuard:action=>rpc('cleanupGuard',[action]),mountedId:()=>mountedId});
  try {
    const status = await exchange('host/status',undefined,now(),limits.commandBytes);
    if (status.stopped || status.ready || status.commands!==0 || status.pending) throw new Error('Broker is expired or already used');
  } catch (error) {
    disabled = true;
    throw new Error('Safari requires a fresh running fixture broker; start node scripts/slash-native/server.mjs --directory /absolute/fresh/outside-checkout/directory and pass its config.json with --broker: '+error.message);
  }
  const scripts = mkdtempSync(resolve(dirname(outputPath),'safari-http-bootstrap-'));
  const codePath = resolve(scripts,'bootstrap.js');
  const created = run('/usr/bin/osascript',['-e',createWindow],{timeout:15000}).stdout.trim();
  if (!/^[0-9]+$/.test(created) || !Number.isSafeInteger(Number(created)) || Number(created)<=0) throw new Error('Invalid newly owned Safari window ID');
  const windowId = Number(created);
  report.browserVersion = report.bundleVersion;
  report.control = {method:'ordinary Safari; bootstrap Apple Events, then same-origin closed HTTP fixture RPC, strict read-only AX guard, fixed System Events keys and exact-control CGEvent clicks',
    windowId,uniqueTitle:config.title,fixtureUrl:config.fixtureUrl,brokerNonce:config.nonce,brokerDirectory:config.directory,clientLog,
    webDriver:false,fixtureOnly:true,appleEventsScope:'Safari JavaScript/URL/title Apple Events are bootstrap-only; zero Safari page-control calls afterwards. System Events fixed guarded keys use a separate platform-input path',
    ownership:'fresh bootstrap numeric ID; thereafter exact random document title and fresh mounted-host page guard',
    cleanupScope:'CmdW closes only the current exact fixture tab; title absence is not a process/window shutdown claim'};
  function evaluateBootstrap(code,deadline) {
    if (bootstrapped) throw new Error('Apple Events are forbidden after fixture bootstrap');
    writeFileSync(codePath,code,'utf8');
    const result = run('/usr/bin/osascript',['-e',bootstrapEvaluate,codePath,String(windowId)],{timeout:Math.max(1,deadline-Date.now()),fullStdout:true});
    return JSON.parse(result.stdout.trim());
  }
  return {
    errors:[],
    async navigate() {
      const deadline = Date.now()+15000;
      for (;;) {
        const result = evaluateBootstrap('document.title='+JSON.stringify(config.title)+';JSON.stringify({ready:!!window.ui42})',deadline);
        if (result.ready) break;
        if (Date.now()>=deadline-100) throw new Error('Fixture compositionHostReady bootstrap deadline');
        await wait(100);
      }
      const viewportAttempts=[];
      for(let attempt=0;attempt<=3;attempt++){
        const value=evaluateBootstrap('JSON.stringify({width:innerWidth,height:innerHeight,scale:visualViewport?.scale,offsetLeft:visualViewport?.offsetLeft,offsetTop:visualViewport?.offsetTop})',deadline);
        viewportAttempts.push(value);
        if(value.width===1024&&value.height===768&&value.scale===1&&value.offsetLeft===0&&value.offsetTop===0)break;
        if(attempt===3||!Number.isSafeInteger(value.width)||!Number.isSafeInteger(value.height)||value.width<1||value.height<1||value.width>2048||value.height>1536||value.scale!==1||value.offsetLeft!==0||value.offsetTop!==0)throw Error('Frozen composition viewport unavailable during bounded bootstrap');
        run('/usr/bin/osascript',['-e',resizeBootstrap,String(windowId),String(1024-value.width),String(768-value.height)],{timeout:Math.max(1,deadline-Date.now())});
        await wait(100);
      }
      report.control.bootstrapViewportAttempts=viewportAttempts;
      const modulePath = config.base+'/page-client.mjs';
      const accepted = evaluateBootstrap('(()=>{document.title='+JSON.stringify(config.title)+';document.getElementById("ui-before").focus();import('+JSON.stringify(modulePath)+');return JSON.stringify({accepted:true});})()',deadline);
      if (accepted.accepted !== true) throw new Error('Fixture module bootstrap acknowledgement differs');
      bootstrapped = true; // Every remaining path, including cleanup, uses HTTP or AX.
      const start = now();
      for (;;) {
        const status = await exchange('host/status',undefined,start,limits.commandBytes);
        if (status.stopped) throw new Error('Fixture broker stopped during bootstrap');
        if (status.ready) {
          if (status.ready.url!==config.fixtureUrl || status.ready.title!==config.title) throw new Error('Page handshake differs');
          Object.assign(report.control,{userAgent:status.ready.userAgent,platform:status.ready.platform,language:status.ready.language});
          break;
        }
        await wait(100);
      }
      if(deadline-Date.now()<=500)throw new Error('Safari AX preparation lacks original navigate time');
      await wait(500);
      if(Date.now()>=deadline)throw new Error('Safari AX preparation exceeded original navigate deadline');
      report.control.safariAxReadiness=await prepareSafariAxReadiness({config,inputHelper,run,record,remainingNavigate:()=>deadline-Date.now()});
      if(report.control.safariAxReadiness.status!=='ready')throw new Error('Safari read-only AX readiness refused: '+report.control.safariAxReadiness.reason);
    },
    async focus() {
      const {value} = await rpc('documentGuard');
      if (value.nonce!==config.nonce || value.url!==config.fixtureUrl || value.title!==config.title || value.documentFocused!==true) throw new Error('Owned fixture document lost focus; no refocus or keys sent');
    },
    async call(method,...args) {
      const {value} = await rpc(method,args);
      if (method==='prepare') {
        if (typeof value?.id!=='string' || !/^ui42-[1-9][0-9]{0,8}$/.test(value.id)) throw new Error('Invalid prepared mount identity');
        mountedId = value.id;
      }
      if (method==='finish') mountedId = null;
      return value;
    },
    input:action=>inputOwner.input(action),
    releaseOwnedPointer:()=>inputOwner.releaseOwnedPointer(),
    releaseOwnedKeys:()=>inputOwner.releaseOwnedKeys(),
    get keysPending(){return inputOwner.keysPending;},
    get pointerDown(){return inputOwner.pointerDown;},
    get pointerState(){return inputOwner.pointerState;},
    get inputDisabled(){return inputOwner.disabled;},
    async close() {
      let pageGuard;
      if (disabled) pageGuard = {status:'unavailable',reason:'broker disabled after transport/unknown completion'};
      else {
        try {
          const {value} = await rpc('documentGuard');
          if (value.nonce!==config.nonce || value.url!==config.fixtureUrl || value.title!==config.title) throw Object.assign(new Error('Cleanup page ownership changed'),{ownershipChanged:true});
          pageGuard = {status:'confirmed',documentFocused:value.documentFocused};
        } catch (error) {
          if (error.ownershipChanged || error.nativeMethodFailure) throw error;
          pageGuard = {status:'unavailable',reason:error.message};
        }
      }
      report.control.cleanup = {status:'attempted',pageGuard,uniqueTitle:config.title,windowId};
      const result = run('/usr/bin/osascript',['-e',guardedClose,config.title],{timeout:5000});
      if (result.stdout.trim()!=='fixture-CmdW-sent') throw new Error('Fixture tab close command differs');
      const deadline = Date.now()+5000;
      for (;;) {
        const present = run('/usr/bin/osascript',['-e',ownedTitleExists,config.title],{timeout:Math.max(1,deadline-Date.now())}).stdout.trim();
        if (present==='false') {
          report.control.cleanup = {status:'fixture-tab-closed',pageGuard,uniqueTitle:config.title,windowId,
            evidence:'guarded CmdW, then exact unique AX window title no longer exists',nativeResources:'only the separate finish receipt establishes native release'};
          return;
        }
        if (present!=='true' || Date.now()>=deadline-100) throw new Error('Unique fixture title remains after guarded CmdW');
        await wait(100);
      }
    },
  };
}
