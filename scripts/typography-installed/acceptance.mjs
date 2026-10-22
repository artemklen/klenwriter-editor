// SPDX-License-Identifier: MIT OR Apache-2.0
// Finite OSR48 installed adaptation of source-pinned OSR47 ordinary-window adapters.
// Never sends synthetic DOM events or host edit/history commands. Import is inert.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {existsSync,mkdirSync,readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {computeSdkBuildIdentity} from '../generate-sdk-types.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export async function runInstalledTypography(){
process.chdir(root);
const argv=process.argv.slice(2),names=['--browser','--out','--helper','--source-helper'];
assert.equal(argv.length,8,'Usage: acceptance.mjs --browser chrome|safari --out /fresh/absolute --helper /pinned/input --source-helper /pinned/input-source');
const args=Object.fromEntries([0,2,4,6].map(i=>[argv[i],argv[i+1]]));assert.deepEqual(Object.keys(args).sort(),names.sort());assert.ok(['chrome','safari'].includes(args['--browser']));
for(const key of ['--out','--helper','--source-helper'])assert.ok(isAbsolute(args[key]),key+' must be absolute');
const browserName=args['--browser'],out=resolve(args['--out']),helperPath=resolve(args['--helper']),sourceHelper=resolve(args['--source-helper']);
assert.ok(out!==root&&!out.startsWith(root+'/'),'Evidence outside checkout');assert.ok(!existsSync(out),'Fresh evidence directory preserves failures');
for(const p of [helperPath,sourceHelper])assert.ok(existsSync(p)&&statSync(p).isFile(),'Existing compiled helper required');mkdirSync(out,{recursive:true});
const nonce=randomBytes(16).toString('hex'),url='http://127.0.0.1:4174/typing',title=`KlenWriter Typography native ${nonce}`;
const reportPath=resolve(out,'report.json'),start=performance.now(),runDeadline=start+300000;
const limits={callMs:12000,rowMs:45000,resultBytes:4*1024*1024,controlBytes:64*1024*1024,calls:768};
let rowDeadline=runDeadline,adapter=null,current=null,blocked=false,cleaning=false,owner=null,pending=null,helperDisabled=false,releaseAttempted=false,originalSource=null;
let authorityReadPersistenceDeferred=false;
let authorityEvidenceBudget=null,authorityEvidenceParity=null;
const oraclePath=resolve(root,'scripts/typography-installed/oracles.json'),oracles=JSON.parse(readFileSync(oraclePath));
assert.equal(oracles.format,'osr48-installed-typography-oracles/1');assert.equal(oracles.rows.length,6);
const report={format:'osr48-installed-typography/1',browser:browserName,nonce,title,url,status:'NOT_RUN',startedAt:new Date().toISOString(),
 scope:'Actual installed macOS Chrome or ordinary Safari, bounded fixed CGEvent keys and actual trusted browser/native result observations. Not hardware-device evidence. Controlled transformed composition is the separate three-engine lane. No screenshot, recording, synthetic event, arbitrary command or event-source fallback.',
 invocation:{node:process.version,argv:process.argv.slice(2),cwd:root,requiredContext:'Already authorized Terminal, normal user app-data context; no permission reset/request'},limits,controls:[],setup:[],helperReceipts:[],rows:[],cleanup:null};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const pin=path=>{const bytes=readFileSync(path);return{path,bytes:bytes.length,sha256:hash(bytes)};};
const walk=path=>readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(resolve(path,e.name)):e.isFile()?[resolve(path,e.name)]:[]);
const errorValue=error=>({message:String(error.message),stack:String(error.stack??'').slice(0,16384),execution:error.execution??null,lastObservation:error.lastObservation??null});
// Exact JSON byte accounting for the closed final-authority write set only.
// No historical entry is mutated during this interval; new facade records may
// acquire value/error, and the last physical receipt may acquire its authority.
function evidencePrettyBytes(value,depth){const text=JSON.stringify(value,null,2);assert.equal(typeof text,'string');let lines=0;for(let at=text.indexOf('\n');at!==-1;at=text.indexOf('\n',at+1))lines++;return Buffer.byteLength(text)+2*depth*lines;}
function evidenceAppendBytes(values,start,depth){assert.ok(Array.isArray(values)&&Number.isInteger(start)&&start>=0&&start<=values.length,'Original append-only evidence prefix');let compact=0,pretty=0;const count=values.length-start;
  for(let i=start;i<values.length;i++){assert.ok(Object.hasOwn(values,i),'Dense source-authored evidence suffix');const text=JSON.stringify(values[i]);assert.equal(typeof text,'string');compact+=Buffer.byteLength(text);pretty+=evidencePrettyBytes(values[i],depth+1)+2*(depth+1);}
  return{compact:count?compact+count-1+(start?1:0):0,pretty:count?pretty+2*count+(start?0:2*depth):0};
}
function captureAuthorityEvidence(report,row,receipt,sizes){assert.equal(report.rows.at(-1),row);assert.equal(row.physical.at(-1),receipt);return{report,row,controls:report.controls,controlCount:report.controls.length,helpers:report.helperReceipts,helperCount:report.helperReceipts.length,checkpoints:row.checkpoints,checkpointCount:row.checkpoints.length,physical:row.physical,physicalCount:row.physical.length,receipt,receiptBytes:evidencePrettyBytes(receipt,4),controlBytes:sizes.controlBytes,reportBytes:sizes.reportBytes};}
function measureAuthorityEvidence(budget,report,row){assert.equal(budget.report,report);assert.equal(budget.row,row);assert.equal(report.rows.at(-1),row);assert.equal(budget.controls,report.controls);assert.equal(budget.helpers,report.helperReceipts);assert.equal(budget.checkpoints,row.checkpoints);assert.equal(budget.physical,row.physical);assert.equal(row.physical.length,budget.physicalCount);assert.equal(row.physical.at(-1),budget.receipt);
  const controls=evidenceAppendBytes(report.controls,budget.controlCount,1),helpers=evidenceAppendBytes(report.helperReceipts,budget.helperCount,1),checkpoints=evidenceAppendBytes(row.checkpoints,budget.checkpointCount,3);
  const sizes={controlBytes:budget.controlBytes+controls.compact,reportBytes:budget.reportBytes+controls.pretty+helpers.pretty+checkpoints.pretty+evidencePrettyBytes(budget.receipt,4)-budget.receiptBytes};assert.ok(Number.isSafeInteger(sizes.controlBytes)&&sizes.controlBytes>=2&&Number.isSafeInteger(sizes.reportBytes)&&sizes.reportBytes>0,'Finite exact evidence sizes');return sizes;
}
function assertEvidenceCaps(sizes){assert.ok(sizes.controlBytes<=limits.controlBytes,'Control evidence cap');assert.ok(sizes.reportBytes<=128*1024*1024,'Report evidence cap');}
const save=()=>{if(authorityReadPersistenceDeferred){assert.ok(authorityEvidenceBudget);const sizes=measureAuthorityEvidence(authorityEvidenceBudget,report,current);assertEvidenceCaps(sizes);return sizes;}
  const controlBytes=Buffer.byteLength(JSON.stringify(report.controls));assert.ok(controlBytes<=limits.controlBytes,'Control evidence cap');const bytes=JSON.stringify(report,null,2)+'\n',sizes={controlBytes,reportBytes:Buffer.byteLength(bytes)};assertEvidenceCaps(sizes);writeFileSync(reportPath,bytes);
  if(authorityEvidenceParity){assert.deepEqual(measureAuthorityEvidence(authorityEvidenceParity,report,current),sizes,'Exact cached evidence sizes match fully serialized durable report');authorityEvidenceParity=null;}return sizes;
};
function remaining(maximum=limits.callMs){const value=Math.floor(Math.min(maximum,(cleaning?rowDeadline:runDeadline)-performance.now(),rowDeadline-performance.now()));assert.ok(value>0,'Original run/row or separate cleanup deadline expired');return value;}
async function bounded(promise,maximum=limits.callMs){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Original deadline expired; outcome unknown, no replay')),remaining(maximum));})]);}finally{clearTimeout(timer);}}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function recordControl(value){report.controls.push(value);save();}
function command(command,argv,{timeout=limits.callMs,maxBuffer=limits.resultBytes}={}){const began=performance.now(),r=spawnSync(command,argv,{cwd:root,encoding:'utf8',timeout:remaining(timeout),maxBuffer});const execution={command,argv,elapsedMs:performance.now()-began,exitCode:r.status,signal:r.signal,error:r.error?.message??null,stdout:r.stdout??'',stderr:r.stderr??''};recordControl({kind:'process',...execution});if(r.status!==0||r.signal||r.error)throw Object.assign(Error('Closed process failed'),{execution});return execution;}
const methods=new Set(['prepareInstalled','metadata','mount','select','focus','inspect','keyResultCounts','dispose','allDisposed']);
function validCall(method,args){
  assert.ok(methods.has(method),'Closed installed typography facade');assert.ok(Array.isArray(args)&&Buffer.byteLength(JSON.stringify(args))<=65536,'Bounded fixture arguments');
  if(method==='prepareInstalled')assert.deepEqual(args,[nonce]);
  else if(['metadata','allDisposed'].includes(method))assert.equal(args.length,0);
  else if(method==='mount'){assert.equal(args.length,1);assert.ok(args[0]&&typeof args[0].source==='string');assert.ok(['ru','en'].includes(args[0].locale));assert.ok(Object.keys(args[0]).every(k=>['source','locale','rules','selection'].includes(k)));}
  else{assert.match(args[0],/^typing-mount-[1-9][0-9]{0,8}$/);assert.equal(args.length,method==='select'?2:1);}
}
// Both adapters use this same closed, bounded page facade. It cannot invoke a
// synthetic clipboard API, command/history submission, arbitrary evaluator or URL.
const facadeSource=`function installedCall(method,args,nonce,url,title){
  if(location.href!==url)throw Error('Exact installed fixture URL changed');
  if(method!=='prepareInstalled'&&document.title!==title)throw Error('Exact installed fixture title changed');
  if(!window.typographyHostReady)throw Error('Clipboard host not ready');
  const allowed=['prepareInstalled','metadata','mount','select','focus','inspect','keyResultCounts','dispose','allDisposed'];
  if(!allowed.includes(method))throw Error('Closed installed facade');
  return Promise.resolve(window.typographyHost[method](...args));
}`;
const guardSource=`function installedGuard(id,url,title){
  if(location.href!==url||document.title!==title)throw Error('Exact owned fixture URL/title changed');
  const element=document.getElementById(id);
  return {url:location.href,title:document.title,documentFocused:document.hasFocus(),activeId:document.activeElement?.id??null,connected:!!element?.isConnected,contentEditable:element?.contentEditable??null};
}`;

async function createChrome(){
  const profile=resolve(out,'browser-appdata','chrome-profile'),childHome=resolve(out,'browser-tmp','chrome-home');mkdirSync(childHome,{recursive:true});
  const context=await bounded(chromium.launchPersistentContext(profile,{channel:'chrome',headless:false,viewport:{width:1024,height:768},timeout:15000,
    args:['--force-renderer-accessibility=complete','--window-size=1280,960','--window-position=80,60'],env:{...process.env,CFFIXED_USER_HOME:childHome}}),15000);
  const pages=context.pages();assert.equal(pages.length,1,'Exactly one launched Chrome page');const page=pages[0];page.setDefaultTimeout(limits.callMs);
  const errors=[];page.on('pageerror',error=>{errors.push(error.message);save();});page.on('dialog',dialog=>{errors.push('Unexpected '+dialog.type()+' dialog');void dialog.dismiss();});
  const browser=context.browser();assert.ok(browser);report.browserVersion=browser.version();
  let serial=0,busy=false,disabled=false;
  const call=async(method,...args)=>{validCall(method,args);assert.ok(!busy&&!disabled);assert.ok(++serial<=limits.calls);busy=true;
    const receipt={kind:'chrome-facade',id:serial,method,args,startedAt:new Date().toISOString()};recordControl(receipt);
    try{const value=await bounded(page.evaluate(async({method,args,nonce,url,title})=>{
      if(location.href!==url||(method!=='prepareInstalled'&&document.title!==title)||!window.typographyHostReady)throw Error('Exact closed Chrome fixture guard');
      const allowed=['prepareInstalled','metadata','mount','select','focus','inspect','keyResultCounts','dispose','allDisposed'];if(!allowed.includes(method))throw Error('Closed installed facade');
      return await window.typographyHost[method](...args);
    },{method,args,nonce,url,title}));receipt.value=value;save();return value;}
    catch(error){disabled=true;receipt.error=errorValue(error);save();throw error;}finally{busy=false;}};
  try{
    const response=await bounded(page.goto(url));assert.ok(response?.ok(),'Running exact fixture server required');
    report.csp=response.headers()['content-security-policy'];assert.ok(report.csp?.includes("default-src 'none'"));assert.ok(!report.csp.includes("'unsafe-inline'"));
    await bounded(page.waitForFunction(()=>window.typographyHostReady===true,null,{timeout:15000}),15000);
    const prepared=await call('prepareInstalled',nonce);assert.equal(prepared.title,title);assert.equal(prepared.url,url);
    const require=createRequire(import.meta.url),packagePath=require.resolve('playwright-core/package.json'),corePath=resolve(dirname(packagePath),'lib/coreBundle.js');
    const packagePin=pin(packagePath),corePin=pin(corePath),version=JSON.parse(readFileSync(packagePath,'utf8')).version;
    assert.equal(version,'1.64.1');assert.equal(packagePin.bytes,876);assert.equal(packagePin.sha256,'8aa1c9863fa8dea324e674254158cdc79440f4124ef2d84d38053013541cb7d6');
    assert.equal(corePin.bytes,3585406);assert.equal(corePin.sha256,'829521b67ed7be90c7d6d6098ff39f2241562d47e4ad7ccab13710924a56001d');
    // This is the original main FrameSession, after exact dependency pins; a new
    // CDP session would not disable Playwright's original focus emulation.
    assert.equal(typeof page._connection?.toImpl,'function');const serverPage=page._connection.toImpl(page),delegate=serverPage?.delegate,session=delegate?._mainFrameSession,client=session?._client;
    assert.ok(serverPage&&delegate&&session&&client);assert.equal(delegate._page,serverPage);assert.equal(session._crPage,delegate);assert.equal(session._page,serverPage);
    assert.equal(session._targetId,delegate._targetId);assert.equal(delegate._sessions.get(delegate._targetId),session);assert.equal(session._parentSession,null);
    assert.equal(client._connection,delegate._browserContext?._browser?._connection);assert.equal(client._connection._sessions.get(client._sessionId),client);assert.equal(client._closed,false);assert.equal(client._crashed,false);
    const focus={kind:'disable-original-focus-emulation',method:'Emulation.setFocusEmulationEnabled',params:{enabled:false},library:{version,packagePin,corePin},targetId:session._targetId,sessionId:client._sessionId};
    focus.response=await bounded(client.send(focus.method,focus.params));recordControl(focus);
    await bounded(page.bringToFront());command('/usr/bin/osascript',['-e','tell application "Google Chrome" to activate']);
    await bounded(page.waitForFunction(()=>document.hasFocus(),null,{timeout:5000}),5000);
    const browserSession=await bounded(browser.newBrowserCDPSession()),processes=await bounded(browserSession.send('SystemInfo.getProcessInfo'));
    const own=processes.processInfo.filter(p=>p.type==='browser');assert.equal(own.length,1);const pid=Number(own[0].id);assert.ok(Number.isSafeInteger(pid)&&pid>0);await browserSession.detach();
    report.control={kind:'owned persistent installed Chrome',profile,childHome,pid,webDriver:false,pageSetup:'closed Playwright facade only; original focus emulation disabled',physical:'fixed guarded CGEvent helper only'};save();
    return{call,errors,pid,guard:id=>bounded(page.evaluate(({id,url,title})=>{
      if(location.href!==url||document.title!==title)throw Error('Exact owned Chrome fixture changed');const element=document.getElementById(id);
      return{url:location.href,title:document.title,documentFocused:document.hasFocus(),activeId:document.activeElement?.id??null,connected:!!element?.isConnected,contentEditable:element?.contentEditable??null};
    },{id,url,title})),close:()=>bounded(context.close(),10000)};
  }catch(error){try{await bounded(context.close(),10000);}catch(cleanup){report.chromeBootstrapCleanupError=errorValue(cleanup);}throw error;}
}

const safariCreate=`on run argv
  tell application "Safari"
    set previousIDs to id of every window
    if (count of previousIDs) is greater than or equal to 32 then error "Bounded Safari fixture windows"
    make new document with properties {URL:"http://127.0.0.1:4174/typing"}
    set createdIDs to {}
    repeat with candidate in windows
      if previousIDs does not contain (id of candidate) then set end of createdIDs to (id of candidate)
    end repeat
    if (count of createdIDs) is not 1 then error "One newly owned Safari window required"
    set ownedID to item 1 of createdIDs
    set bounds of window id ownedID to {80,60,1280,960}
    set index of window id ownedID to 1
    activate
    return ownedID as text
  end tell
end run`;
const safariEvaluate=`on run argv
  set codePath to item 1 of argv
  set ownedID to (item 2 of argv) as integer
  set expectedTitle to item 3 of argv
  set javascriptText to read (POSIX file codePath) as «class utf8»
  tell application "Safari"
    if not (exists window id ownedID) then error "Original owned Safari fixture missing"
    set ownedWindow to window id ownedID
    if (count of tabs of ownedWindow) is not 1 then error "Owned Safari fixture tab count changed"
    if (URL of current tab of ownedWindow) is not "http://127.0.0.1:4174/typing" then error "Exact Safari fixture URL changed"
    if expectedTitle is not "" and (name of current tab of ownedWindow) is not expectedTitle then error "Exact Safari fixture title changed"
    return do JavaScript javascriptText in current tab of ownedWindow
  end tell
end run`;
const safariClose=`on run argv
  set ownedID to (item 1 of argv) as integer
  set expectedTitle to item 2 of argv
  set allowBootstrapTitle to item 3 of argv
  tell application "Safari"
    if not (exists window id ownedID) then return "original_owned_window_already_absent"
    set ownedWindow to window id ownedID
    if (count of tabs of ownedWindow) is not 1 then error "Cleanup owned tab count changed"
    if (URL of current tab of ownedWindow) is not "http://127.0.0.1:4174/typing" then error "Cleanup exact URL changed"
    if (name of current tab of ownedWindow) is not expectedTitle then
      if allowBootstrapTitle is not "1" or (name of current tab of ownedWindow) is not "Typography contract fixture" then error "Cleanup exact title changed"
    end if
    close ownedWindow
    if exists window id ownedID then error "Original Safari fixture did not close"
    return "original_owned_window_closed"
  end tell
end run`;
async function createSafari(){
  const createPath=resolve(out,'safari-create.applescript'),evaluatePath=resolve(out,'safari-evaluate.applescript'),closePath=resolve(out,'safari-close.applescript');
  for(const [path,source]of [[createPath,safariCreate],[evaluatePath,safariEvaluate],[closePath,safariClose]])writeFileSync(path,source,{flag:'wx',mode:0o444});
  const created=command('/usr/bin/osascript',[createPath],{timeout:15000}).stdout.trim();assert.match(created,/^[1-9][0-9]{0,9}$/);const windowId=Number(created);assert.ok(Number.isSafeInteger(windowId));
  let serial=0,busy=false,disabled=false,prepared=false;
  const evaluate=code=>{assert.ok(Buffer.byteLength(code)<=131072,'Bounded fixed facade script');const path=resolve(out,`safari-page-${String(++serial).padStart(4,'0')}.js`);assert.ok(serial<=limits.calls*8);writeFileSync(path,code,{flag:'wx',mode:0o444});const value=command('/usr/bin/osascript',[evaluatePath,path,String(windowId),prepared?title:''],{timeout:5000});assert.ok(Buffer.byteLength(value.stdout)<=limits.resultBytes);return JSON.parse(value.stdout.trim());};
  report.control={kind:'ordinary owned Safari window',windowId,webDriver:false,fixtureUrl:url,uniqueTitle:title,appleEvents:'bounded file evaluator, original numeric window ID, exact URL/title, fixed per-request promise result slot; no native edit/history substitutes',scripts:[createPath,evaluatePath,closePath].map(pin)};save();
  const call=async(method,...args)=>{validCall(method,args);assert.ok(!busy&&!disabled);busy=true;const id=`${nonce}:${serial+1}`,deadline=performance.now()+remaining();
    const receipt={kind:'safari-facade',id,method,args,startedAt:new Date().toISOString()};recordControl(receipt);
    try{const accepted=evaluate(`(()=>{${facadeSource};if(window.__typographyInstalledResult&&!window.__typographyInstalledResult.done)throw Error('Prior request pending');window.__typographyInstalledResult={id:${JSON.stringify(id)},done:false};Promise.resolve().then(()=>installedCall(${JSON.stringify(method)},${JSON.stringify(args)},${JSON.stringify(nonce)},${JSON.stringify(url)},${JSON.stringify(title)})).then(value=>{window.__typographyInstalledResult={id:${JSON.stringify(id)},done:true,ok:true,value};},error=>{window.__typographyInstalledResult={id:${JSON.stringify(id)},done:true,ok:false,error:String(error.message)};});return JSON.stringify({accepted:${JSON.stringify(id)}});})()`);assert.equal(accepted.accepted,id);
      for(;;){assert.ok(performance.now()<deadline,'Original Safari facade deadline expired');const value=evaluate(`(()=>{const s=window.__typographyInstalledResult;if(!s||s.id!==${JSON.stringify(id)})throw Error('Original request slot changed');return JSON.stringify(s);})()`);
        if(value.done){receipt.value=value;save();assert.equal(value.ok,true,value.error??'Safari fixture method failed');if(method==='prepareInstalled')prepared=true;return value.value;}
        await wait(Math.min(100,remaining()));}
    }catch(error){disabled=true;receipt.error=errorValue(error);save();throw error;}finally{busy=false;}};
  try{const deadline=performance.now()+remaining(15000);for(;;){const ready=evaluate('JSON.stringify({ready:window.typographyHostReady===true})');if(ready.ready)break;assert.ok(performance.now()<deadline,'Original Safari host-ready deadline');await wait(100);}
    const value=await call('prepareInstalled',nonce);assert.equal(value.title,title);assert.equal(value.url,url);
    return{call,errors:[],guard:id=>evaluate(`(()=>{${guardSource};return JSON.stringify(installedGuard(${JSON.stringify(id)},${JSON.stringify(url)},${JSON.stringify(title)}));})()`),
      close:()=>command('/usr/bin/osascript',[closePath,String(windowId),title,'0'],{timeout:5000})};
  }catch(error){try{report.safariBootstrapCleanup=command('/usr/bin/osascript',[closePath,String(windowId),title,'1'],{timeout:5000});}catch(cleanup){report.safariBootstrapCleanupError=errorValue(cleanup);}throw error;}
}

// Fixed transition programs authored from input.swift, not helper output.
const keyCodes=Object.freeze({'quote-en':39,'quote-ru':19,space:49,'ru-letter':3,backspace:51,undo:6,redo:6,'dead-e':14,'letter-e':14});
const browserCodes=Object.freeze({'quote-en':'Quote','quote-ru':'Digit2',space:'Space','ru-letter':'KeyF',backspace:'Backspace',undo:'KeyZ',redo:'KeyZ','dead-e':'KeyE','letter-e':'KeyE'});
function program(action,release=false){const key=keyCodes[action];assert.ok(Number.isInteger(key));const s=(keyCode,down,flags='none')=>({keyCode,down,flags});
  if(release)return[s(55,false),s(56,false),s(58,false),s(key,false)];
  if(action==='redo')return browserName==='safari'?[s(55,true,'command'),s(56,true,'command+shift'),s(key,true,'command+shift'),s(56,false,'command'),s(55,false),s(key,false)]:[s(55,true,'command'),s(56,true,'command+shift'),s(key,true,'command+shift'),s(key,false,'command+shift'),s(56,false,'command'),s(55,false)];
  if(action==='undo')return browserName==='safari'?[s(55,true,'command'),s(key,true,'command'),s(55,false),s(key,false)]:[s(55,true,'command'),s(key,true,'command'),s(key,false,'command'),s(55,false)];
  if(action==='quote-en'||action==='quote-ru')return[s(56,true,'shift'),s(key,true,'shift'),s(key,false,'shift'),s(56,false)];
  if(action==='dead-e')return[s(58,true,'option'),s(key,true,'option'),s(key,false,'option'),s(58,false)];return[s(key,true),s(key,false)];
}
function nativeRequest(operation,action='',owned=owner){return{format:'osr48-typography-keys/1',operation,browser:browserName,nonce,title,action,owner:operation==='inspect'?null:structuredClone(owned),deadlineMs:1000};}
function helperRun(request){const began=performance.now(),execution=spawnSync(helperPath,[],{input:JSON.stringify(request),cwd:root,encoding:'utf8',timeout:remaining(request.operation==='inspect'?5000:1000),maxBuffer:65536});
  const receipt={request,command:helperPath,argv:[],exitCode:execution.status,signal:execution.signal,error:execution.error?.message??null,stdout:execution.stdout??'',stderr:execution.stderr??'',elapsedMs:performance.now()-began,result:null};
  try{receipt.result=JSON.parse(receipt.stdout);}catch(error){receipt.parseError=error.message;}
  report.helperReceipts.push(receipt);save();return receipt;
}
function ownerProof(value){assert.deepEqual(Object.keys(value).sort(),['frame','pid']);assert.ok(Number.isSafeInteger(value.pid)&&value.pid>0);assert.deepEqual(Object.keys(value.frame).sort(),['height','width','x','y']);for(const n of Object.values(value.frame))assert.ok(Number.isFinite(n));assert.ok(value.frame.width>0&&value.frame.height>0);}
function validateHelper(receipt,expected,release=false){const value=receipt.result;assert.equal(receipt.error,null);assert.equal(receipt.signal,null);assert.equal(receipt.stderr,'');assert.ok(value&&Array.isArray(value.posted));assert.deepEqual(value.posted,expected.slice(0,value.posted.length),'Exact original fixed transition prefix');assert.ok(value.posted.length<=expected.length);
  if(value.posted.length===expected.length)pending=null; // all source-authored key-ups are already posted, even if final focus became unknown
  assert.equal(receipt.exitCode,0,value.reason??'Native key helper failed');assert.equal(value.status,'completed');assert.equal(value.delivery,'posted');assert.deepEqual(value.posted,expected);assert.deepEqual(value.owner,owner);assert.equal(value.bundle,browserName==='chrome'?'com.google.Chrome':'com.apple.Safari');assert.equal(value.title,title+(browserName==='chrome'?' - Google Chrome':''));assert.ok(Number.isFinite(value.elapsedMs)&&value.elapsedMs>=0&&value.elapsedMs<=1000);assert.ok(receipt.elapsedMs<=1000,'Original helper process deadline');return value;
}
function send(action){assert.ok(owner&&!helperDisabled&&!pending&&!blocked,'No input after failure/unknown or held-key uncertainty');assert.ok(Object.hasOwn(keyCodes,action));
  const request=nativeRequest('key',action);pending={request:structuredClone(request),action};const receipt=helperRun(request);
  try{return validateHelper(receipt,program(action));}catch(error){helperDisabled=true;receipt.validationError=error.message;if(receipt.result?.status==='refused'&&Array.isArray(receipt.result.posted)&&receipt.result.posted.length===0)pending=null;save();throw error;}
}
function release(){if(!pending)return{status:'not_needed',keysPending:false};if(releaseAttempted)return{status:'not_repeated',keysPending:true};releaseAttempted=true;helperDisabled=true;
  const original=pending,request=nativeRequest('release',original.action,original.request.owner),receipt=helperRun(request);
  try{validateHelper(receipt,program(original.action,true),true);return{status:'completed',keysPending:false,receipt};}catch(error){receipt.validationError=error.message;save();return{status:'failed',keysPending:pending!==null,receipt};}
}
async function checkpoint(id,label){const value=await adapter.call('inspect',id);current.checkpoints.push({label,value});save();return value;}
const published=value=>value.events.filter(event=>event.change.kind==='document');
const mutations=value=>value.nativeCalls.filter(row=>['input_command','command','history'].includes(row.request.kind));
const typed=value=>value.nativeCalls.filter(row=>row.request.kind==='input_command');
const firstText=canonical=>JSON.parse(canonical).content[0].content[0].text;
const fixedPoint=(id,offset)=>({kind:'text',node:id,offset,affinity:'after'});
const fixedCaret=(id,offset)=>({anchor:fixedPoint(id,offset),focus:fixedPoint(id,offset)});
function scalar(n,delta){return String(BigInt(n)+BigInt(delta));}
function checkState(value,before,{canonical,revision,epoch,undo,redo,caret,selection=null,armed=0,freshText=null}){
  assert.equal(value.canonical,canonical);assert.equal(value.lifecycle,'ready');assert.equal(value.recovery,null);assert.deepEqual(value.failures,[]);assert.deepEqual(adapter.errors,[]);
  assert.deepEqual(value.context,before.context);assert.equal(value.state.root,before.state.root);assert.equal(value.state.stored_marks,null);assert.equal(value.state.saved_revision,before.state.saved_revision);assert.equal(value.state.dirty,revision!==0);
  assert.deepEqual(value.state.stamp,{...before.state.stamp,revision:scalar(before.state.stamp.revision,revision),selection_epoch:scalar(before.state.stamp.selection_epoch,epoch),history_epoch:scalar(before.state.stamp.history_epoch,revision)});
  assert.equal(value.state.history.undo_entries,String(undo));assert.equal(value.state.history.redo_entries,String(redo));assert.match(value.state.history.retained_bytes,/^(0|[1-9][0-9]*)$/);assert.equal(published(value).length-published(before).length,revision);
  const textId=freshText??before.roles.text;assert.deepEqual(value.state.selection,selection??fixedCaret(textId,caret));assert.equal(value.rawDom.inside,true);
  for(const edge of ['anchor','focus']){assert.equal(value.rawDom[edge].nodeType,3);assert.equal(value.rawDom[edge].offset,(selection??fixedCaret(textId,caret))[edge].offset);assert.deepEqual(value.rawDom[edge].path,[0,0,0]);}
  const expectedIds=before.rows.map(row=>row.node.id),actualIds=value.rows.map(row=>row.node.id);if(freshText){assert.ok(!expectedIds.includes(freshText),'Composed full replacement uses one statically declared fresh identity');assert.deepEqual(actualIds,expectedIds.map(id=>id===before.roles.text?freshText:id));}else assert.deepEqual(actualIds,expectedIds);
  assert.equal(value.resources.dom.observers,1);assert.equal(value.resources.dom.listeners,before.resources.dom.listeners);assert.equal(value.resources.typing.armedSlots,armed);assert.equal(value.resources.typing.backspaceCandidates,0);assert.equal(value.resources.typing.pendingDispatches,0);assert.ok(value.resources.typing.retainedBytes>=armed&&value.resources.typing.retainedBytes<=(armed?4096:0));
  assert.equal(value.native.snapshot_handles,0);assert.equal(value.native.snapshot_bytes,'0');
  assert.equal(value.dom.length,2);assert.deepEqual(value.dom[1],before.dom[1]);assert.equal(value.rawDom.anchor.text,firstText(canonical));assert.equal(value.rawDom.focus.text,firstText(canonical));
  for(const mutation of mutations(value)){assert.equal(mutation.response.status,'ok');assert.equal(mutation.response.value.effect,'changed');}
  // Unchanged tail has independently source-bound ID, parent, metadata and payload.
  const tailBefore=before.rows.filter(row=>row.path[0]===1);for(const row of tailBefore){const after=value.rows.find(r=>r.node.id===row.node.id);assert.ok(after);for(const key of ['id','parent','type_id','primitive','attributes','marks','text','children'])assert.deepEqual(after.node[key],row.node[key]);}
}
function resultExpected(row,before,after){const type='org.klenwriter.kwdj/text',id=before.roles.text,block=before.roles.block;
  const dash=row.typedAction==='space',nbsp=row.id==='ru-nbsp',from=dash||nbsp?1:firstText(row.before).length,to=dash?3:nbsp?2:from,end=row.cookedText.length;
  const range=(a,b)=>({anchor:fixedPoint(id,a),focus:fixedPoint(id,b)}),span={node:id,from_utf16:from,to_utf16:end,type_id:type,attributes:{},marks:[],text:row.cookedText.slice(from)};
  const changed={block,range:range(from,end),spans:[span]},selection=fixedCaret(id,end),raw=dash?'-- ':row.typedData;
  return{kind:'text_replacement',before_stamp:before.state.stamp,after_stamp:after.state.stamp,original:{origin:'ordinary_insert_text',selection:before.state.selection,text:row.typedData},before:{block,range:range(from,to)},after:changed,after_selection:selection,after_stored_marks:null,
    raw_restore:nbsp?null:{format_id:'org.klenwriter.editor/raw-input-restore/1',stamp:after.state.stamp,selection,stored_marks:null,cooked:changed,raw:[{type_id:type,attributes:{},marks:[],text:raw}],raw_caret_utf16:raw.length,raw_stored_marks:null}};
}
async function physical(id,action,expected){assert.ok(!blocked&&!helperDisabled&&!pending);const source=JSON.parse(command(sourceHelper,['status'],{timeout:3000}).stdout);assert.equal(source.status,'ok');assert.equal(source.current.id,current.sourceId,'Original frozen source must remain selected, no layout retry');
  // Persist an incomplete intent before reading dispatch authority. Null authority
  // fields do not attest that a key was dispatched; the helper receipt is required.
  const receipt={action,source:source.current,beforeEventCount:null,guard:null,before:null,at:null};current.physical.push(receipt);const baseline=save();
  assert.equal(authorityReadPersistenceDeferred,false);assert.equal(authorityEvidenceBudget,null);assert.equal(authorityEvidenceParity,null);authorityEvidenceBudget=captureAuthorityEvidence(report,current,receipt,baseline);authorityReadPersistenceDeferred=true;let authorityValidated=false;
  try{const began=performance.now(),fresh=await checkpoint(id,'original authority before '+action),guard=await adapter.guard(id);
    assert.deepEqual(fresh.state,expected.state);assert.deepEqual(fresh.context,expected.context);assert.equal(fresh.canonical,expected.canonical);assert.deepEqual(fresh.rawDom,expected.rawDom);assert.equal(fresh.rawDom.inside,true);
    assert.deepEqual(guard,{url,title,documentFocused:true,activeId:id,connected:true,contentEditable:'true'});assert.ok(performance.now()-began<=1000,'Fresh original browser/native authority deadline');
    Object.assign(receipt,{beforeEventCount:fresh.inputTrace.length,guard,before:structuredClone(fresh.state),at:new Date().toISOString()});save();assert.ok(performance.now()-began<=1000,'Persistence cannot age original dispatch authority');authorityValidated=true;
  }finally{authorityReadPersistenceDeferred=false;authorityEvidenceParity=authorityValidated?authorityEvidenceBudget:null;authorityEvidenceBudget=null;}
  try{receipt.helper=send(action);}finally{authorityEvidenceParity=null;}save();return receipt;
}
function paired(value,action){const events=value.inputTrace.slice(action.beforeEventCount),code=browserCodes[action.action];return events.some(e=>e.event==='keydown'&&e.code===code&&e.isTrusted)&&events.some(e=>e.event==='keyup'&&e.code===code&&e.isTrusted);}
function trusted(value,action,{inputType=null,data=null,composition=false}={}){const events=value.inputTrace.slice(action.beforeEventCount),code=browserCodes[action.action];assert.ok(events.every(e=>e.isTrusted===true),'No synthetic event may satisfy installed observations');for(const name of ['keydown','keyup'])assert.equal(events.filter(e=>e.event===name&&e.code===code).length,1,'One original trusted '+code+' '+name);
  if(inputType)assert.ok(events.some(e=>e.event==='beforeinput'&&e.isTrusted&&e.inputType===inputType&&(data===null||e.data===data)),'Original trusted beforeinput/datum');if(composition){assert.ok(events.some(e=>e.event==='compositionstart'&&e.isTrusted));assert.ok(events.some(e=>e.event==='compositionend'&&e.isTrusted));}return events;}
async function observe(id,label,predicate){const deadline=performance.now()+remaining(8000);for(;;){const value=await checkpoint(id,label);if(predicate(value))return value;if(performance.now()>=deadline)throw Object.assign(Error('Original observation deadline; no input retry'),{lastObservation:value});await wait(100);}}
function zeroResources(value){assert.deepEqual(value.native,{sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});for(const r of value.readbacks){assert.equal(r.fixtureListeners,0);assert.equal(r.rangeObservationOverflow,false);if(r.resources===null){assert.equal(r.mountStatus,'no_controller_returned');assert.ok(r.nativeObservationScope.startsWith('module-global;'));continue;}assert.equal(r.resources.sdk.lifecycle,'destroyed');for(const [group,values]of Object.entries(r.resources))for(const [key,count]of Object.entries(values))if(typeof count==='number')assert.equal(count,0,group+'.'+key);}}
async function ordinaryRow(row){const mounted=await adapter.call('mount',{source:row.before,locale:row.locale,rules:null}),{id,before}=mounted;assert.match(id,/^typing-mount-[1-9][0-9]{0,8}$/);current.mountId=id;current.checkpoints.push({label:'source-bound setup',value:before});save();
  checkState(before,before,{canonical:row.before,revision:0,epoch:0,undo:0,redo:0,caret:firstText(row.before).length});assert.equal(mutations(before).length,0);
  const action=await physical(id,row.typedAction,before),cooked=await observe(id,'one actual typed native publication',v=>v.canonical===row.cooked&&paired(v,action));
  trusted(cooked,action,{inputType:'insertText',data:row.typedData});const dash=row.typedAction==='space',epoch=dash?0:1;
  checkState(cooked,before,{canonical:row.cooked,revision:1,epoch,undo:1,redo:0,caret:row.cookedText.length,armed:row.specialBackspace?1:0});assert.equal(mutations(cooked).length,1);assert.equal(typed(cooked).length,1);assert.deepEqual(typed(cooked)[0].response.value.result,resultExpected(row,before,cooked));assert.deepEqual(JSON.parse(typed(cooked)[0].request.command.payload_json),{kind:'insert_typed_text',origin:'ordinary_insert_text',text:row.typedData});
  const back=await physical(id,'backspace',cooked),raw=await observe(id,'one actual Backspace',v=>v.canonical===row.raw&&paired(v,back));trusted(raw,back,{inputType:'deleteContentBackward'});
  checkState(raw,before,{canonical:row.raw,revision:2,epoch:dash||!row.specialBackspace?epoch+1:epoch,undo:2,redo:0,caret:row.rawText.length});assert.equal(mutations(raw).length,2);assert.equal(typed(raw).length,row.specialBackspace?2:1);const terminal=mutations(raw).at(-1);assert.equal(terminal.request.kind,row.specialBackspace?'input_command':'command');if(row.specialBackspace){assert.equal(JSON.parse(terminal.request.command.payload_json).kind,'restore_typed_text');assert.equal(terminal.response.value.result,null);}
  if(row.completeReversalHistory){let previous=raw;const steps=[{action:'undo',canonical:row.cooked,revision:3,epoch:1,undo:1,redo:1,caret:row.cookedText.length},{action:'undo',canonical:row.before,revision:4,epoch:2,undo:0,redo:2,caret:firstText(row.before).length},{action:'redo',canonical:row.cooked,revision:5,epoch:3,undo:1,redo:1,caret:row.cookedText.length},{action:'redo',canonical:row.raw,revision:6,epoch:3,undo:2,redo:0,caret:row.rawText.length}];
    for(const step of steps){const key=await physical(id,step.action,previous),value=await observe(id,'actual '+step.action+' revision'+step.revision,v=>v.state.stamp.revision===scalar(before.state.stamp.revision,step.revision)&&paired(v,key));trusted(value,key);checkState(value,before,step);assert.equal(mutations(value).length,step.revision);assert.equal(mutations(value).at(-1).request.kind,'history');assert.equal(typed(value).length,2);previous=value;}
  }
}
async function compositionRow(row){const mounted=await adapter.call('mount',{source:row.before,locale:row.locale,rules:null,selection:row.selection}),{id,before}=mounted;assert.match(id,/^typing-mount-[1-9][0-9]{0,8}$/);current.mountId=id;current.checkpoints.push({label:'source-bound original directed replacement',value:before});save();
  const original={anchor:fixedPoint(before.roles.text,0),focus:fixedPoint(before.roles.text,3)};checkState(before,before,{canonical:row.before,revision:0,epoch:0,undo:0,redo:0,selection:original});
  const dead=await physical(id,'dead-e',before),preedit=await observe(id,'actual native dead-key preedit',v=>paired(v,dead)&&v.inputTrace.slice(dead.beforeEventCount).some(e=>e.event==='compositionstart'&&e.isTrusted));trusted(preedit,dead);assert.equal(preedit.canonical,row.before);assert.deepEqual(preedit.state,before.state);assert.equal(mutations(preedit).length,0);assert.equal(published(preedit).length,published(before).length);
  const finish=await physical(id,'letter-e',preedit),after=await observe(id,'one actual composed final claim',v=>v.canonical===row.composed&&paired(v,finish));trusted(after,finish);const events=after.inputTrace.slice(dead.beforeEventCount);assert.equal(events.filter(e=>e.event==='compositionstart'&&e.isTrusted).length,1);assert.equal(events.filter(e=>e.event==='compositionend'&&e.isTrusted).length,1);assert.ok(events.some(e=>e.event==='beforeinput'&&e.isTrusted&&e.isComposing===true));
  const fresh=after.rows.find(r=>JSON.stringify(r.path)==='[0,0]')?.node.id;assert.ok(fresh);current.freshCompositionAlias={role:'COMPOSED',id:fresh,relation:'fresh, distinct from ALL original IDs; source-empty replacement removes original T0'};
  checkState(after,before,{canonical:row.composed,revision:1,epoch:1,undo:1,redo:0,caret:1,freshText:fresh});assert.equal(mutations(after).length,1);assert.equal(typed(after).length,1);assert.deepEqual(JSON.parse(typed(after)[0].request.command.payload_json),{kind:'insert_typed_text',origin:'composition_commit',text:row.composedText});assert.equal(typed(after)[0].response.value.result,null);
  const undo=await physical(id,'undo',after),undone=await observe(id,'actual one Undo of composed unit',v=>v.canonical===row.before&&paired(v,undo));trusted(undone,undo);checkState(undone,before,{canonical:row.before,revision:2,epoch:2,undo:0,redo:1,selection:original});
  const redo=await physical(id,'redo',undone),redone=await observe(id,'actual one Redo of same composed identity',v=>v.canonical===row.composed&&paired(v,redo));trusted(redone,redo);checkState(redone,before,{canonical:row.composed,revision:3,epoch:3,undo:1,redo:0,caret:1,freshText:fresh});assert.equal(typed(redone).length,1);assert.equal(mutations(redone).length,3);
}
try{
  assert.equal(process.platform,'darwin','Installed macOS lane only');assert.equal(process.version,'v24.22.0','Pinned installed Node');assert.equal(process.env.TERM_PROGRAM,'Apple_Terminal','Already authorized Terminal context');assert.ok(!process.env.CFFIXED_USER_HOME,'Helpers run in normal real user context');
  report.os={version:command('/usr/bin/sw_vers',['-productVersion']).stdout.trim(),build:command('/usr/bin/sw_vers',['-buildVersion']).stdout.trim()};
  const identity=computeSdkBuildIdentity(),built=JSON.parse(readFileSync('artifacts/sdk-build-identity.json','utf8'));assert.equal(identity.buildId,built.buildId,'Build exact source before installed input');assert.deepEqual(identity.sourceHashes,built.sourceHashes);report.buildId=identity.buildId;
  const paths=[...new Set([...Object.keys(identity.sourceHashes).map(p=>resolve(root,p)),...['packages/wasm/dist','packages/sdk/dist','packages/dom/dist','packages/kwdj/dist','scripts/typography-installed'].flatMap(p=>walk(resolve(root,p))),...['spikes/workspace/typing-host.html','spikes/workspace/typing.browser.mjs','scripts/workspace-server.mjs','scripts/clipboard-installed/acceptance.mjs','scripts/dom-native-input-source.swift','contracts/typography/v1/dom-oracles.json','contracts/typography/v1/rules-contract.json','docs/typography.md','artifacts/sdk-build-identity.json','artifacts/sdk-wasm-seal.json','artifacts/sdk-native-manifest-v2.json'].map(p=>resolve(root,p)),helperPath,sourceHelper])].sort();report.pins=paths.map(pin);
  const seal=JSON.parse(readFileSync('artifacts/sdk-wasm-seal.json','utf8'));assert.equal(seal.build_id,identity.buildId);assert.equal(seal.sealed_sha256,pin(resolve(root,'packages/wasm/dist/editor_wasm_bg.wasm')).sha256);report.seal=seal;report.head=command('git',['rev-parse','HEAD']).stdout.trim();report.trackedDirty=command('git',['status','--porcelain','--untracked-files=no']).stdout;
  const bundle=browserName==='chrome'?'/Applications/Google Chrome.app/Contents/Info.plist':'/Applications/Safari.app/Contents/Info.plist';assert.ok(existsSync(bundle));report.bundleVersion=command('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',bundle]).stdout.trim();report.bundleBuild=command('/usr/libexec/PlistBuddy',['-c','Print :CFBundleVersion',bundle]).stdout.trim();assert.equal(report.bundleVersion,browserName==='chrome'?'155.0.8059.85':'27.0.1','Source-pinned browser version');
  const sourceStatus=JSON.parse(command(sourceHelper,['status'],{timeout:3000}).stdout);assert.equal(sourceStatus.status,'ok');originalSource=sourceStatus.current.id;report.originalSource=sourceStatus.current;report.sourcePolicy={kind:'exact frozen oracle sourceId only',oracle:pin(oraclePath),aliasFallback:false,requested:[...new Set(oracles.rows.map(row=>row.sourceId))]};
  for(const id of report.sourcePolicy.requested){assert.ok(['com.apple.keylayout.ABC','com.apple.keylayout.US','com.apple.keylayout.Russian'].includes(id),'Closed source-authored source ID');assert.ok(sourceStatus.sources.some(source=>source.id===id&&source.enabled===true&&source.selectable===true),'Exact preexisting frozen input source required; no fallback alias: '+id);}
  adapter=await(browserName==='chrome'?createChrome():createSafari());report.metadata=await adapter.call('metadata');assert.equal(report.metadata.buildId,identity.buildId);assert.equal(report.metadata.typingCommands.length,20);assert.equal(report.metadata.baseCommands.length,18);
  const inspected=helperRun(nativeRequest('inspect'));assert.equal(inspected.exitCode,0);assert.equal(inspected.error,null);assert.equal(inspected.signal,null);assert.equal(inspected.stderr,'');assert.equal(inspected.result.status,'completed');assert.equal(inspected.result.delivery,'not_sent');assert.deepEqual(inspected.result.posted,[]);ownerProof(inspected.result.owner);owner=structuredClone(inspected.result.owner);assert.equal(inspected.result.bundle,browserName==='chrome'?'com.google.Chrome':'com.apple.Safari');assert.equal(inspected.result.title,title+(browserName==='chrome'?' - Google Chrome':''));if(browserName==='chrome')assert.equal(owner.pid,adapter.pid,'Native AX owner must be original launched browser');report.owner=structuredClone(owner);save();
  for(const row of oracles.rows){current={id:row.id,mountId:null,sourceId:row.sourceId,status:'NOT_RUN',startedAt:new Date().toISOString(),checkpoints:[],physical:[]};Object.defineProperty(current,'id',{writable:false,configurable:false});report.rows.push(current);save();if(blocked){current.reason='Earlier original failure disables every later physical input';continue;}rowDeadline=Math.min(runDeadline,performance.now()+limits.rowMs);
    try{const source=JSON.parse(command(sourceHelper,['select',row.sourceId],{timeout:3000}).stdout);current.sourceSelection=source;assert.equal(source.status,'ok');assert.equal(source.current.id,row.sourceId);save();if(row.physicalSequence)await compositionRow(row);else await ordinaryRow(row);current.status='PASSED';}
    catch(error){current.status='FAILED';current.error=errorValue(error);blocked=true;helperDisabled=true;}
    finally{rowDeadline=runDeadline;if(current.mountId&&current.status!=='PASSED')try{current.failureObservation=await adapter.call('inspect',current.mountId);}catch(error){current.failureObservationError=errorValue(error);}
      try{current.disposal=await adapter.call('allDisposed');zeroResources(current.disposal);}catch(error){current.disposalError=errorValue(error);current.status='FAILED';blocked=true;}
      current.finishedAt=new Date().toISOString();save();}
  }
  report.status=report.rows.length===oracles.rows.length&&report.rows.every(row=>row.status==='PASSED')?'PASSED':'FAILED';
}catch(error){report.status='FAILED';report.error=errorValue(error);blocked=true;helperDisabled=true;}
finally{
  cleaning=true;rowDeadline=performance.now()+15000;report.cleanup={};
  try{report.cleanup.keys=release();if(report.cleanup.keys.keysPending)report.status='FAILED';}catch(error){report.cleanup.keyError=errorValue(error);report.status='FAILED';}
  if(adapter){try{report.cleanup.disposal=await adapter.call('allDisposed');zeroResources(report.cleanup.disposal);}catch(error){report.cleanup.disposalError=errorValue(error);report.status='FAILED';}try{report.cleanup.window=await adapter.close();}catch(error){report.cleanup.windowError=errorValue(error);report.status='FAILED';}}
  if(originalSource)try{const restored=JSON.parse(command(sourceHelper,['select',originalSource],{timeout:3000}).stdout);assert.equal(restored.status,'ok');assert.equal(restored.current.id,originalSource);report.cleanup.originalSource=restored;}catch(error){report.cleanup.sourceError=errorValue(error);report.status='FAILED';}
  try{if(report.pins){report.finalPins=report.pins.map(p=>pin(p.path));assert.deepEqual(report.finalPins,report.pins,'Source, dist, fixtures and both helpers must remain unchanged');report.finalHead=command('git',['rev-parse','HEAD']).stdout.trim();report.finalTrackedDirty=command('git',['status','--porcelain','--untracked-files=no']).stdout;assert.equal(report.finalHead,report.head);assert.equal(report.finalTrackedDirty,report.trackedDirty);const final=computeSdkBuildIdentity();assert.equal(final.buildId,report.buildId);report.sourceStable=true;}}catch(error){report.sourceStable=false;report.stabilityError=errorValue(error);report.status='FAILED';}
  report.finishedAt=new Date().toISOString();report.elapsedMs=performance.now()-start;report.inputResources={keysPending:pending!==null,disabled:helperDisabled,releaseAttempted};save();
}
process.stdout.write(JSON.stringify({status:report.status,browser:browserName,report:reportPath,rows:report.rows.map(row=>({id:row.id,mountId:row.mountId,status:row.status}))})+'\n');if(report.status!=='PASSED')process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await runInstalledTypography();
