// SPDX-License-Identifier: MIT OR Apache-2.0
// Installed Safari fixture adapter. Apple Events end at bootstrap.
import {appendFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {limits,validCall,boundedJson} from './protocol.mjs';

const wait = ms=>new Promise(resolve=>setTimeout(resolve,ms));
const now = ()=>process.hrtime.bigint();
const elapsedMs = start=>Number(now()-start)/1e6; // Guard freshness, not a performance measure.
const createWindow = `tell application "Safari"
  set previousIDs to id of every window
  if (count of previousIDs) is greater than 32 then error "Safari fixture window observation limit"
  make new document with properties {URL:"http://127.0.0.1:4174/dom"}
  set createdIDs to {}
  repeat with candidate in windows
    set candidateID to id of candidate
    if previousIDs does not contain candidateID then set end of createdIDs to candidateID
  end repeat
  if (count of createdIDs) is not 1 then error "Could not identify one new Safari fixture window"
  set ownedID to item 1 of createdIDs
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
    if (URL of current tab of ownedWindow) is not "http://127.0.0.1:4174/dom" then error "Owned fixture bootstrap URL changed"
    return do JavaScript javascriptText in current tab of ownedWindow
  end tell
end run`;
const guardedKey = `on run argv
  set expectedTitle to item 1 of argv
  set physicalCode to (item 2 of argv) as integer
  if {2,4,5,11,14,17,31,36,37,45,48,51} does not contain physicalCode then error "Key outside closed native protocol"
  tell application "System Events"
    tell application process "Safari"
      if frontmost is not true then error "Safari is not frontmost before fixture key"
      if (count of windows) is greater than 32 then error "Fixture AX window observation limit"
      if (count of (windows whose name is expectedTitle)) is not 1 then error "Fixture AX title is not unique"
      if not (exists front window) then error "Safari has no front fixture window"
      if (name of front window) is not expectedTitle then error "Exact unique fixture title is not frontmost"
    end tell
    key code physicalCode
    delay 0.12
  end tell
  return "key-sent"
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
      return (exists window expectedTitle) as text
    end tell
  end tell
end run`;

export async function createSafariAdapter({config,report,run,outputPath}) {
  if (config.format !== 'osr39-safari-http-broker/1' || !/^[a-f0-9]{32}$/.test(config.nonce)
    || config.origin !== 'http://127.0.0.1:4174' || config.fixtureUrl !== config.origin+'/dom'
    || config.base !== '/dom-native-broker-'+config.nonce || config.title !== 'KlenWriter DOM native '+config.nonce) throw new Error('Invalid closed broker configuration');
  const base = config.origin+config.base+'/', clientLog = resolve(config.directory,'client.jsonl');
  writeFileSync(clientLog,'',{flag:'wx'});
  let clientBytes = 0, serial = 0, inflight = false, disabled = false, bootstrapped = false, mountedId = null, guardSerial = 0;
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
          record('native-result',{id,method,result:result.result}); // Persist before acknowledgement.
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
  try {
    const status = await exchange('host/status',undefined,now(),limits.commandBytes);
    if (status.stopped || status.ready || status.commands!==0 || status.pending) throw new Error('Broker is expired or already used');
  } catch (error) {
    disabled = true;
    throw new Error('Safari requires a fresh running fixture broker; start node scripts/dom-native/server.mjs --directory /absolute/fresh/outside-checkout/directory and pass its config.json with --broker: '+error.message);
  }
  const scripts = mkdtempSync(resolve(dirname(outputPath),'safari-http-bootstrap-'));
  const codePath = resolve(scripts,'bootstrap.js');
  const created = run('/usr/bin/osascript',['-e',createWindow],{timeout:15000}).stdout.trim();
  if (!/^[0-9]+$/.test(created) || !Number.isSafeInteger(Number(created)) || Number(created)<=0) throw new Error('Invalid newly owned Safari window ID');
  const windowId = Number(created);
  report.browserVersion = report.bundleVersion;
  report.control = {method:'ordinary Safari; bootstrap Apple Events, then same-origin closed HTTP fixture RPC and System Events AX/title input',
    windowId,uniqueTitle:config.title,fixtureUrl:config.fixtureUrl,brokerNonce:config.nonce,brokerDirectory:config.directory,clientLog,
    webDriver:false,fixtureOnly:true,appleEventsScope:'fresh fixture creation and module bootstrap only; zero calls after bootstrap',
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
        const result = evaluateBootstrap('JSON.stringify({ready:window.domHostReady===true})',deadline);
        if (result.ready) break;
        if (Date.now()>=deadline-100) throw new Error('Fixture domHostReady bootstrap deadline');
        await wait(100);
      }
      const modulePath = config.base+'/page-client.mjs';
      const accepted = evaluateBootstrap('(()=>{document.title='+JSON.stringify(config.title)+';document.getElementById("host-recovery-control").focus();import('+JSON.stringify(modulePath)+');return JSON.stringify({accepted:true});})()',deadline);
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
    },
    async focus() {
      const {value} = await rpc('documentGuard');
      if (value.nonce!==config.nonce || value.url!==config.fixtureUrl || value.title!==config.title || value.documentFocused!==true) throw new Error('Owned fixture document lost focus; no refocus or keys sent');
    },
    async call(method,...args) {
      const {value} = await rpc(method,args);
      if (method==='prepare') {
        if (typeof value?.id!=='string' || !/^mount-[1-9][0-9]{0,8}$/.test(value.id)) throw new Error('Invalid prepared mount identity');
        mountedId = value.id;
      }
      if (method==='finish') mountedId = null;
      return value;
    },
    async key(code) {
      let dispatchStarted=false, systemEventsExecution=null, proofStart=null, proofIdentity=null, preDispatchAge=null;
      try {
      if (!mountedId || ![2,4,5,11,14,17,31,36,37,45,48,51].includes(code)) throw new Error('Key lacks exact prepared fixture identity');
      const proof = await rpc('guard'), value = proof.value;
      proofStart=proof.start; proofIdentity={requestId:proof.id,pageGuardSerial:value.serial,mountedId:value.mountedId};
      if (value.nonce!==config.nonce || value.url!==config.fixtureUrl || value.title!==config.title || value.mountedId!==mountedId
        || value.allowed!==true || value.documentFocused!==true || value.editorConnected!==true || value.target!==(code===48?'host-control':'editor')
        || !Number.isSafeInteger(value.serial) || value.serial<=guardSerial || elapsedMs(proof.start)>limits.guardAgeMs) throw new Error('Fresh fixture key guard refused; no key sent');
      guardSerial = value.serial;
      if (inflight || disabled) throw new Error('A key cannot overlap a broker request');
      const preDispatchGuardAgeMs = elapsedMs(proof.start);
      preDispatchAge=preDispatchGuardAgeMs;
      const remaining = Math.floor(limits.guardAgeMs-preDispatchGuardAgeMs);
      if (remaining<=0) throw new Error('Fixture page guard expired before physical dispatch');
      dispatchStarted=true;
      const result = run('/usr/bin/osascript',['-e',guardedKey,config.title,String(code)],{timeout:remaining});
      systemEventsExecution=result;
      if (result.stdout.trim()!=='key-sent') throw new Error('System Events key result differs');
      const maximumGuardAgeMs = elapsedMs(proof.start);
      if (maximumGuardAgeMs>limits.guardAgeMs) throw new Error('Fixture page guard expired during physical dispatch');
      const receipt = {windowId,uniqueTitle:config.title,fixtureUrl:config.fixtureUrl,mountedId,requestId:proof.id,pageGuardSerial:guardSerial,
        target:value.target,activeElementId:value.activeElementId,documentFocused:true,preDispatchGuardAgeMs,maximumGuardAgeMs,guardAgeLimitMs:limits.guardAgeMs,
        systemEventsExecution:result,
        method:'fresh page HTTP guard + exact unique AX front-window title + one physical key'};
      record('physical-key',{code,guard:receipt}); return receipt;
      } catch (error) {
        disabled=true; // Never send later keys after failed or unknown delivery.
        record('physical-key-failure',{code,error:error.message,execution:systemEventsExecution??error.execution??null,
          delivery:dispatchStarted?'unknown/may_have_sent':'not_sent',dispatchStarted,guard:proofIdentity,
          preDispatchGuardAgeMs:preDispatchAge,maximumGuardAgeMs:proofStart===null?null:elapsedMs(proofStart),guardAgeLimitMs:limits.guardAgeMs});
        throw error;
      }
    },
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
