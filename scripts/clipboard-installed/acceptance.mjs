// SPDX-License-Identifier: MIT OR Apache-2.0
// Closed installed clipboard lane. Source-authored oracles precede all execution.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {existsSync,mkdirSync,readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {computeSdkBuildIdentity} from '../generate-sdk-types.mjs';
import {createClipboardPlatform} from './native-platform.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export async function runInstalledClipboard(protocol='strict-relative-1'){
assert.ok(['strict-relative-1','portable-absolute-1'].includes(protocol),'Closed source-authored installed protocol');
const portable=protocol==='portable-absolute-1';
process.chdir(root);
const argv=process.argv.slice(2),names=['--browser','--out','--helper'];
assert.equal(argv.length,6,'Usage: node scripts/clipboard-installed/acceptance.mjs --browser chrome|safari --out /absolute/fresh/directory --helper /absolute/pinned/clipboard-input');
const args=Object.fromEntries([0,2,4].map(i=>[argv[i],argv[i+1]]));
assert.deepEqual(Object.keys(args).sort(),names.sort());
assert.ok(['chrome','safari'].includes(args['--browser']));
for(const key of ['--out','--helper'])assert.ok(isAbsolute(args[key]),key+' must be absolute');
const browserName=args['--browser'],out=resolve(args['--out']),helperPath=resolve(args['--helper']);
assert.ok(out!==root&&!out.startsWith(root+'/'),'Evidence must be outside checkout');
assert.ok(!existsSync(out),'Preserve original outcomes: evidence directory must be fresh');
assert.ok(existsSync(helperPath)&&statSync(helperPath).isFile(),'Explicit compiled helper required');
mkdirSync(out,{recursive:true});
const nonce=randomBytes(16).toString('hex'),url='http://127.0.0.1:4174/clipboard',title=`KlenWriter Clipboard native ${nonce}`;
const reportPath=resolve(out,'report.json'),start=performance.now(),runDeadline=start+300000;
const limits={callMs:12000,rowMs:45000,resultBytes:4*1024*1024,controlBytes:64*1024*1024,calls:768};
let rowDeadline=runDeadline,controlBytes=0,adapter=null,platform=null,current=null,blocked=false,cleaning=false;
const report={format:portable?'klenwriter-editor-installed-clipboard-portable/1':'klenwriter-editor-installed-clipboard/1',protocol,browser:browserName,nonce,title,url,status:'NOT_RUN',startedAt:new Date().toISOString(),
  scope:'Actual installed macOS Chrome or ordinary Safari, physical fixed CGEvent shortcuts, trusted browser events, actual platform writer and selected NSPasteboard formats. Platform input is not hardware-device evidence. OS-selected scalar UTF-8 bytes, browser-exposed strings and native canonical content are distinct observations. No arbitrary OS UTF-16 preservation claim.',
  invocation:{node:process.version,argv:process.argv.slice(2),cwd:root,requiredContext:'Run from already authorized Terminal; no permission request or reset'},limits,setup:[],controls:[],platformReceipts:[],rows:[],cleanup:null};
const save=()=>{controlBytes=Buffer.byteLength(JSON.stringify(report.controls));assert.ok(controlBytes<=limits.controlBytes,'Bounded completed control evidence');const text=JSON.stringify(report,null,2)+'\n';assert.ok(Buffer.byteLength(text)<=128*1024*1024,'Bounded complete report');writeFileSync(reportPath,text);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const pin=path=>{const bytes=readFileSync(path);return{path,bytes:bytes.length,sha256:hash(bytes)};};
const walk=path=>readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(resolve(path,e.name)):e.isFile()?[resolve(path,e.name)]:[]);
function errorValue(error){return{message:String(error.message),stack:String(error.stack??'').slice(0,16384),execution:error.execution??null,record:error.record??null,cleanup:error.cleanup??null,lastObservation:error.lastObservation??null};}
function recordControl(value){report.controls.push(value);save();}
function remaining(maximum=limits.callMs){const value=Math.floor(Math.min(maximum,(cleaning?rowDeadline:runDeadline)-performance.now(),rowDeadline-performance.now()));assert.ok(value>0,'Original run/row or separate cleanup deadline expired');return value;}
async function bounded(promise,maximum=limits.callMs){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Original operation deadline expired; completion is unknown and must not be replayed')),remaining(maximum));})]);}finally{clearTimeout(timer);}}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function command(command,argv,{timeout=limits.callMs,maxBuffer=limits.resultBytes}={}){
  const started=performance.now(),value=spawnSync(command,argv,{cwd:root,encoding:'utf8',timeout:remaining(timeout),maxBuffer});
  const execution={command,argv,elapsedMs:performance.now()-started,exitCode:value.status,signal:value.signal,error:value.error?.message??null,stdout:value.stdout??'',stderr:value.stderr??''};
  recordControl({kind:'process',...execution});
  if(value.status!==0||value.signal||value.error)throw Object.assign(Error('Closed process failed'),{execution});return execution;
}
const p=text=>({type:'paragraph',content:text===''?[]:[{type:'text',text}]});
const doc=content=>({schema:'klenwriter.document',schema_version:1,profile:'prose',content});
const text=(path,offset)=>({kind:'text',path,offset,affinity:'after'}),dom=(path,offset)=>({path,offset});
const plainSource=doc([p('abc'),p('def')]);
const plainSelection={anchor:text([0,0],1),focus:text([1,0],2)};
const plainDom={anchor:dom([0,0,0],1),focus:dom([1,0,0],2)};
const strictRichSource=doc([{type:'paragraph',content:[{type:'text',text:'a'},{type:'text',text:'bc',marks:[{type:'strong'}]}]},
  {type:'paragraph',content:[{type:'text',text:'de',marks:[{type:'link',attrs:{href:'/owned'}}]},{type:'hard_break'},{type:'text',text:'f'}]}]);
const portableRichSource=doc([{type:'paragraph',content:[{type:'text',text:'a'},{type:'text',text:'bc',marks:[{type:'strong'}]}]},
  {type:'paragraph',content:[{type:'text',text:'de',marks:[{type:'link',attrs:{href:'https://example.test/clipboard-owned'}}]},{type:'hard_break'},{type:'text',text:'f'}]}]);
const richSource=portable?portableRichSource:strictRichSource;
const richSelection={anchor:text([0,1],0),focus:text([1,2],0)};
const richDom={anchor:dom([0,1,0,0],0),focus:dom([1,2,0],0)};
const unicodeNfd='Я EN e\u0301 ё 😀',unicodeNfc='Я EN é ё 😀';
const cases=Object.freeze(portable?['ascii-forward','ascii-reverse','rich-absolute-copy-over-selection','rich-absolute-cut-paste','unicode-exposure']:['ascii-forward','ascii-reverse','rich-copy-over-selection','rich-cut-paste','unicode-exposure']);
const published=value=>value.events.filter(e=>e.change.kind==='document').length;
const canonical=value=>JSON.parse(value.canonical);
const identities=value=>value.rows.map(({path,node})=>({path,...Object.fromEntries(['id','parent','type_id','primitive','attributes','marks','text','children','stats'].map(key=>[key,node[key]]))}));
const methods=new Set(['prepareInstalled','metadata','mount','select','inspect','dispose','allDisposed']);
function validCall(method,args){
  assert.ok(methods.has(method),'Closed fixture facade method');assert.ok(Array.isArray(args)&&Buffer.byteLength(JSON.stringify(args))<=65536,'Bounded fixture arguments');
  if(method==='prepareInstalled')assert.deepEqual(args,[nonce]);
  else if(['metadata','allDisposed'].includes(method))assert.equal(args.length,0);
  else if(method==='mount'){assert.equal(args.length,1);assert.ok(args[0]&&args[0].writer==='platform');assert.ok(Object.keys(args[0]).every(k=>['source','writer','headless'].includes(k)));}
  else{assert.match(args[0],/^clipboard-mount-[1-9][0-9]{0,8}$/);assert.equal(args.length,method==='select'?3:1);}
}
// Both adapters use this same closed, bounded page facade. It cannot invoke a
// synthetic clipboard API, command/history submission, arbitrary evaluator or URL.
const facadeSource=`function installedCall(method,args,nonce,url,title){
  if(location.href!==url)throw Error('Exact installed fixture URL changed');
  if(method!=='prepareInstalled'&&document.title!==title)throw Error('Exact installed fixture title changed');
  if(!window.clipboardHostReady)throw Error('Clipboard host not ready');
  const allowed=['prepareInstalled','metadata','mount','select','inspect','dispose','allDisposed'];
  if(!allowed.includes(method))throw Error('Closed installed facade');
  return Promise.resolve(window.clipboardHost[method](...args));
}`;
const guardSource=`function installedGuard(id,url,title){
  if(location.href!==url||document.title!==title)throw Error('Exact owned fixture URL/title changed');
  const element=document.getElementById(id);
  return {url:location.href,title:document.title,documentFocused:document.hasFocus(),activeId:document.activeElement?.id??null,connected:!!element?.isConnected,contentEditable:element?.contentEditable??null};
}`;

async function createChrome(){
  const profile=resolve(out,'chrome-profile'),childHome=resolve(out,'chrome-child-home');mkdirSync(childHome);
  const context=await bounded(chromium.launchPersistentContext(profile,{channel:'chrome',headless:false,viewport:{width:1024,height:768},timeout:15000,
    args:['--force-renderer-accessibility=complete','--window-size=1280,960','--window-position=80,60'],env:{...process.env,CFFIXED_USER_HOME:childHome}}),15000);
  const pages=context.pages();assert.equal(pages.length,1,'Exactly one launched Chrome page');const page=pages[0];page.setDefaultTimeout(limits.callMs);
  const errors=[];page.on('pageerror',error=>{errors.push(error.message);save();});page.on('dialog',dialog=>{errors.push('Unexpected '+dialog.type()+' dialog');void dialog.dismiss();});
  const browser=context.browser();assert.ok(browser);report.browserVersion=browser.version();
  let serial=0,busy=false,disabled=false;
  const call=async(method,...args)=>{validCall(method,args);assert.ok(!busy&&!disabled);assert.ok(++serial<=limits.calls);busy=true;
    const receipt={kind:'chrome-facade',id:serial,method,args,startedAt:new Date().toISOString()};recordControl(receipt);
    try{const value=await bounded(page.evaluate(async({method,args,nonce,url,title})=>{
      if(location.href!==url||(method!=='prepareInstalled'&&document.title!==title)||!window.clipboardHostReady)throw Error('Exact closed Chrome fixture guard');
      const allowed=['prepareInstalled','metadata','mount','select','inspect','dispose','allDisposed'];if(!allowed.includes(method))throw Error('Closed installed facade');
      return await window.clipboardHost[method](...args);
    },{method,args,nonce,url,title}));receipt.value=value;save();return value;}
    catch(error){disabled=true;receipt.error=errorValue(error);save();throw error;}finally{busy=false;}};
  try{
    const response=await bounded(page.goto(url));assert.ok(response?.ok(),'Running exact fixture server required');
    report.csp=response.headers()['content-security-policy'];assert.ok(report.csp?.includes("default-src 'none'"));assert.ok(!report.csp.includes("'unsafe-inline'"));
    await bounded(page.waitForFunction(()=>window.clipboardHostReady===true,null,{timeout:15000}),15000);
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
    make new document with properties {URL:"http://127.0.0.1:4174/clipboard"}
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
    if (URL of current tab of ownedWindow) is not "http://127.0.0.1:4174/clipboard" then error "Exact Safari fixture URL changed"
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
    if (URL of current tab of ownedWindow) is not "http://127.0.0.1:4174/clipboard" then error "Cleanup exact URL changed"
    if (name of current tab of ownedWindow) is not expectedTitle then
      if allowBootstrapTitle is not "1" or (name of current tab of ownedWindow) is not "Clipboard contract fixture" then error "Cleanup exact title changed"
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
    try{const accepted=evaluate(`(()=>{${facadeSource};if(window.__clipboardInstalledResult&&!window.__clipboardInstalledResult.done)throw Error('Prior request pending');window.__clipboardInstalledResult={id:${JSON.stringify(id)},done:false};Promise.resolve().then(()=>installedCall(${JSON.stringify(method)},${JSON.stringify(args)},${JSON.stringify(nonce)},${JSON.stringify(url)},${JSON.stringify(title)})).then(value=>{window.__clipboardInstalledResult={id:${JSON.stringify(id)},done:true,ok:true,value};},error=>{window.__clipboardInstalledResult={id:${JSON.stringify(id)},done:true,ok:false,error:String(error.message)};});return JSON.stringify({accepted:${JSON.stringify(id)}});})()`);assert.equal(accepted.accepted,id);
      for(;;){assert.ok(performance.now()<deadline,'Original Safari facade deadline expired');const value=evaluate(`(()=>{const s=window.__clipboardInstalledResult;if(!s||s.id!==${JSON.stringify(id)})throw Error('Original request slot changed');return JSON.stringify(s);})()`);
        if(value.done){receipt.value=value;save();assert.equal(value.ok,true,value.error??'Safari fixture method failed');if(method==='prepareInstalled')prepared=true;return value.value;}
        await wait(Math.min(100,remaining()));}
    }catch(error){disabled=true;receipt.error=errorValue(error);save();throw error;}finally{busy=false;}};
  try{const deadline=performance.now()+remaining(15000);for(;;){const ready=evaluate('JSON.stringify({ready:window.clipboardHostReady===true})');if(ready.ready)break;assert.ok(performance.now()<deadline,'Original Safari host-ready deadline');await wait(100);}
    const value=await call('prepareInstalled',nonce);assert.equal(value.title,title);assert.equal(value.url,url);
    return{call,errors:[],guard:id=>evaluate(`(()=>{${guardSource};return JSON.stringify(installedGuard(${JSON.stringify(id)},${JSON.stringify(url)},${JSON.stringify(title)}));})()`),
      close:()=>command('/usr/bin/osascript',[closePath,String(windowId),title,'0'],{timeout:5000})};
  }catch(error){try{report.safariBootstrapCleanup=command('/usr/bin/osascript',[closePath,String(windowId),title,'1'],{timeout:5000});}catch(cleanup){report.safariBootstrapCleanupError=errorValue(cleanup);}throw error;}
}

async function checkpoint(id,label){const value=await adapter.call('inspect',id);current.checkpoints.push({label,value});save();return value;}
function initialRange(actual,selected,selection,literal,source){
  assert.deepEqual(actual.state.selection,selected.native);assert.deepEqual(canonical(actual),source);assert.equal(actual.raw.inside,true);
  for(const edge of ['anchor','focus']){assert.deepEqual(actual.raw[edge].path,literal[edge].path);assert.equal(actual.raw[edge].offset,literal[edge].offset);assert.equal(actual.raw[edge].nodeType,3);
    const path=selection[edge].path,node=actual.rows.find(r=>JSON.stringify(r.path)===JSON.stringify(path))?.node;assert.ok(node);assert.equal(selected.native[edge].node,node.id);assert.equal(selected.native[edge].offset,selection[edge].offset);assert.equal(actual.raw[edge].text,node.text);}
}
async function physical(id,action,expected){
  assert.ok(!blocked&&!platform.resources().disabled,'No physical input after failure');
  const started=performance.now(),fresh=await checkpoint(id,'fresh full native/context/range before '+action),guard=await adapter.guard(id);
  assert.equal(guard.url,url);assert.equal(guard.title,title);assert.equal(guard.documentFocused,true);assert.equal(guard.activeId,id);assert.equal(guard.connected,true);assert.equal(guard.contentEditable,'true');
  assert.deepEqual(fresh.state,expected.state,'Original full native state/stamp before shortcut');assert.deepEqual(fresh.context,expected.context,'Original SessionContext before shortcut');assert.equal(fresh.canonical,expected.canonical);assert.deepEqual(fresh.raw,expected.raw,'Original actual directed DOM range before shortcut');assert.equal(fresh.raw.inside,true);
  assert.ok(performance.now()-started<=1000,'Original fixture authority must remain fresh at key dispatch');
  const receipt={action,guard,beforeEventCount:fresh.trustedEvents.length,beforePasteCount:fresh.pasteResults.length,beforeCopyCount:fresh.copyResults.length,before:fresh.state,startedAt:new Date().toISOString()};current.physical.push(receipt);save();
  assert.ok(performance.now()-started<=1000,'Evidence persistence must not age original fixture authority before key dispatch');
  try{receipt.platform=platform.key(action);receipt.status='posted';}catch(error){receipt.status='failed_or_unknown';receipt.error=errorValue(error);save();throw error;}save();return receipt;
}
async function observe(id,label,predicate){const deadline=performance.now()+remaining(8000);let value;for(;;){value=await checkpoint(id,label);if(predicate(value))return value;if(performance.now()>=deadline)throw Object.assign(Error('Original bounded observation did not complete; no input retry'),{lastObservation:value});await wait(100);}}
const shortcutCodes=Object.freeze({copy:'KeyC',cut:'KeyX',paste:'KeyV',undo:'KeyZ',redo:'KeyZ'});
function paired(after,action){const events=after.trustedEvents.slice(action.beforeEventCount),code=shortcutCodes[action.action];return events.some(e=>e.type==='keydown'&&e.code===code&&e.isTrusted===true)&&events.some(e=>e.type==='keyup'&&e.code===code&&e.isTrusted===true);}
function trusted(after,action,type){const events=after.trustedEvents.slice(action.beforeEventCount);if(type)assert.ok(events.some(e=>e.type===type&&e.isTrusted===true),'Actual trusted '+type+' required');assert.ok(events.every(e=>e.isTrusted===true),'No synthetic event can satisfy installed input');const code=shortcutCodes[action.action];for(const name of ['keydown','keyup'])assert.equal(events.filter(e=>e.type===name&&e.code===code).length,1,'One trusted '+code+' '+name+' required independently of helper completion');return events;}
function captured(after,index=0){const value=after.capturedInputs[index];assert.ok(value,'Actual exposed ClipboardData capture required');assert.equal(value.representations['text/plain'].status,'complete_local');return value;}
function cleanErrors(value){assert.deepEqual(value.failures,[]);assert.deepEqual(adapter.errors,[]);}
async function undo(id,after,before,{entries='0',redos='1'}={}){const action=await physical(id,'undo',after);const value=await observe(id,'physical one Undo',v=>v.canonical===before.canonical&&v.state.history.undo_entries===entries&&paired(v,action));
  assert.equal(value.canonical,before.canonical);assert.deepEqual(identities(value),identities(before),'Undo restores historical identity, topology, attributes, marks and text');assert.deepEqual(value.state.selection,before.state.selection);assert.equal(value.state.history.undo_entries,entries);assert.equal(value.state.history.redo_entries,redos);
  trusted(value,action,null);cleanErrors(value);return value;}
async function reopen(value){const fresh=await adapter.call('mount',{writer:'platform',headless:true,source:value.canonical});const readback=await adapter.call('inspect',fresh.id);assert.equal(readback.canonical,value.canonical);assert.equal(readback.state.history.undo_entries,'0');const disposed=await adapter.call('dispose',fresh.id);current.reopened={readback,disposed};save();}
function released(value){assert.deepEqual(value.native,{sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});for(const item of value.readbacks){const resources=item.resources,sdk=resources.sdk??resources;assert.equal(sdk.lifecycle,'destroyed');for(const [key,count]of Object.entries(sdk))if(typeof count==='number')assert.equal(count,0,key);if(resources.dom){for(const name of ['listeners','observers','continuations','retainedInputBytes','retainedRecoveryRegions'])assert.equal(resources.dom[name],0,name);for(const name of ['selection','clipboard','hostRequests','inputObservations','popupPresentation'])for(const count of Object.values(resources[name]))assert.equal(count,0,name);}assert.equal(item.fixtureObservers,0);}}

async function ascii(direction){const mounted=await adapter.call('mount',{writer:'platform',source:plainSource}),id=mounted.id;current.id=id;
  const selection=direction==='forward'?plainSelection:{anchor:plainSelection.focus,focus:plainSelection.anchor},literal=direction==='forward'?plainDom:{anchor:plainDom.focus,focus:plainDom.anchor};
  const selected=await adapter.call('select',id,selection,literal),before=await checkpoint(id,'literal directed selection before fresh payload');initialRange(before,selected,selection,literal,plainSource);assert.equal(before.projection.value.text,'bc\nde');
  const marker=`CP47-${direction}-${nonce}`;current.marker=marker;current.sourceWrite=platform.writeClipboard({plain:marker,html:null});save();
  const action=await physical(id,'paste',before),after=await observe(id,'actual fresh paste',v=>v.pasteResults.length>action.beforePasteCount&&paired(v,action));
  trusted(after,action,'paste');assert.equal(after.pasteResults.at(-1).status,'inserted');assert.deepEqual(canonical(after),doc([p('a'+marker+'f')]));assert.equal(after.state.history.undo_entries,'1');assert.equal(published(after)-published(before),1);assert.equal(captured(after).representations['text/plain'].text,marker);cleanErrors(after);
  await reopen(after);await undo(id,after,before);
}
async function rich(cut){const mounted=await adapter.call('mount',{writer:'platform',source:richSource}),id=mounted.id;current.id=id;
  const selected=await adapter.call('select',id,richSelection,richDom),before=await checkpoint(id,'literal rich directed range');initialRange(before,selected,richSelection,richDom,richSource);assert.equal(before.projection.value.text,'bc\nde\n');
  const action=await physical(id,cut?'cut':'copy',before),written=await observe(id,'actual platform writer completion',v=>v.copyResults.length>action.beforeCopyCount&&paired(v,action));
  trusted(written,action,cut?'cut':'copy');const result=written.copyResults.at(-1);assert.equal(result.action,cut?'cut':'copy');assert.equal(result.status,cut?'cut':'copied');assert.equal(result.clipboard,'confirmed');
  current.OSAfterWrite=platform.readClipboard();save();const formats=current.OSAfterWrite.result.formats;assert.equal(formats.plain?.text,'bc\nde\n');assert.ok(formats.html&&formats.html.bytes>0,'OS readback must contain actual rich HTML');
  if(cut){assert.deepEqual(canonical(written),doc([p('af')]));assert.equal(written.state.history.undo_entries,'1');assert.equal(published(written)-published(before),1);
    const caret={anchor:text([0,0],1),focus:text([0,0],1)},literal={anchor:dom([0,0,0],1),focus:dom([0,0,0],1)};await adapter.call('select',id,caret,literal);
  }else{assert.equal(written.canonical,before.canonical);assert.deepEqual(written.state.history,before.state.history);assert.equal(published(written),published(before));}
  const ready=await checkpoint(id,'actual unchanged clipboard and paste target'),paste=await physical(id,'paste',ready),after=await observe(id,'actual rich paste native result',v=>v.pasteResults.length>paste.beforePasteCount&&paired(v,paste));
  trusted(after,paste,'paste');assert.equal(after.pasteResults.at(-1).status,'inserted');assert.deepEqual(canonical(after),richSource);assert.equal(after.state.history.undo_entries,cut?'2':'1');assert.equal(published(after)-published(ready),1);const capture=captured(after);assert.equal(capture.representations['text/plain'].text,formats.plain.text);assert.equal(capture.representations['text/html'].status,'complete_local');cleanErrors(after);await reopen(after);
  if(cut){const first=await undo(id,after,ready,{entries:'1',redos:'1'});await undo(id,first,before,{entries:'0',redos:'2'});}else await undo(id,after,before);
}
async function unicode(){const source=doc([p('old')]),mounted=await adapter.call('mount',{writer:'platform',source}),id=mounted.id;current.id=id;
  const selection={anchor:text([0,0],0),focus:text([0,0],3)},literal={anchor:dom([0,0,0],0),focus:dom([0,0,0],3)},selected=await adapter.call('select',id,selection,literal),before=await checkpoint(id,'literal Unicode target');initialRange(before,selected,selection,literal,source);
  current.sourceWrite=platform.writeClipboard({plain:unicodeNfd,html:null});save();const action=await physical(id,'paste',before),after=await observe(id,'actual mixed Unicode paste',v=>v.pasteResults.length>action.beforePasteCount&&paired(v,action));trusted(after,action,'paste');assert.equal(after.pasteResults.at(-1).status,'inserted');
  const exposed=captured(after).representations['text/plain'].text;assert.ok(exposed===unicodeNfd||exposed===unicodeNfc,'Only the two source-frozen exact/NFC exposure branches are admitted');
  const branch=exposed===unicodeNfd?'literal_decomposed':'literal_composed_browser_exposure';assert.deepEqual(canonical(after),doc([p(branch==='literal_decomposed'?unicodeNfd:unicodeNfc)]));assert.equal(after.state.history.undo_entries,'1');assert.equal(published(after)-published(before),1);
  current.unicode={branch,sourceLiteral:unicodeNfd,sourceCodePoints:[...unicodeNfd].map(c=>c.codePointAt(0)),OSSelected:current.sourceWrite.result.formats.plain,exposed,exposedCodePoints:[...exposed].map(c=>c.codePointAt(0)),nativeLiteral:canonical(after).content[0].content[0].text,exactSource:exposed===unicodeNfd,NFCEquivalent:exposed.normalize('NFC')===unicodeNfd.normalize('NFC'),qualification:'Selected OS UTF-8 scalar bytes and browser-exposed strings are independently recorded; no arbitrary OS UTF-16 preservation claim'};save();cleanErrors(after);await reopen(after);await undo(id,after,before);
}

try{
  assert.equal(process.platform,'darwin','Installed macOS lane only');assert.equal(process.version,'v24.22.0','Pinned installed Node');
  assert.equal(process.env.TERM_PROGRAM,'Apple_Terminal','Already authorized real Terminal context required');assert.ok(!process.env.CFFIXED_USER_HOME,'Normal Terminal app-data context required');
  report.os={version:command('/usr/bin/sw_vers',['-productVersion']).stdout.trim(),build:command('/usr/bin/sw_vers',['-buildVersion']).stdout.trim()};
  const identity=computeSdkBuildIdentity(),built=JSON.parse(readFileSync('artifacts/sdk-build-identity.json','utf8'));assert.equal(identity.buildId,built.buildId,'Build exact source before installed input');assert.deepEqual(identity.sourceHashes,built.sourceHashes);report.buildId=identity.buildId;
  const paths=[...new Set([...Object.keys(identity.sourceHashes).map(p=>resolve(root,p)),...['packages/wasm/dist','packages/sdk/dist','packages/dom/dist','packages/kwdj/dist','scripts/clipboard-installed'].flatMap(p=>walk(resolve(root,p))),...['spikes/workspace/clipboard.html','spikes/workspace/clipboard-host.js','spikes/workspace/clipboard.css','scripts/workspace-server.mjs','artifacts/sdk-build-identity.json','artifacts/sdk-wasm-seal.json','artifacts/sdk-native-manifest-v2.json'].map(p=>resolve(root,p)),helperPath])].sort();
  report.pins=paths.map(pin);const seal=JSON.parse(readFileSync('artifacts/sdk-wasm-seal.json','utf8'));assert.equal(seal.build_id,identity.buildId);assert.equal(seal.sealed_sha256,pin(resolve(root,'packages/wasm/dist/editor_wasm_bg.wasm')).sha256);
  report.head=command('git',['rev-parse','HEAD']).stdout.trim();report.trackedDirty=command('git',['status','--porcelain','--untracked-files=no']).stdout;
  const bundle=browserName==='chrome'?'/Applications/Google Chrome.app/Contents/Info.plist':'/Applications/Safari.app/Contents/Info.plist';assert.ok(existsSync(bundle));report.bundleVersion=command('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',bundle]).stdout.trim();report.bundleBuild=command('/usr/libexec/PlistBuddy',['-c','Print :CFBundleVersion',bundle]).stdout.trim();
  assert.equal(report.bundleVersion,browserName==='chrome'?'155.0.8059.85':'27.0.1','Source-pinned installed browser version');
  adapter=await(browserName==='chrome'?createChrome():createSafari());report.metadata=await adapter.call('metadata');assert.equal(report.metadata.buildId,identity.buildId);
  platform=createClipboardPlatform({helperPath,browser:browserName,nonce,title,onRecord:record=>{const path=resolve(out,`platform-${String(report.platformReceipts.length+1).padStart(3,'0')}.json`);writeFileSync(path,JSON.stringify(record,null,2)+'\n',{flag:'wx'});report.platformReceipts.push({path,...pin(path)});save();}});
  const owner=platform.inspectOwnedWindow();report.owner=owner;if(browserName==='chrome')assert.equal(owner.pid,adapter.pid,'AX original owner must be the launched browser PID');save();
  for(const caseId of cases){current={caseId,status:'NOT_RUN',checkpoints:[],physical:[],startedAt:new Date().toISOString()};report.rows.push(current);save();if(blocked){current.reason='Earlier original failure disables all later physical input';continue;}
    rowDeadline=Math.min(runDeadline,performance.now()+limits.rowMs);
    try{if(caseId.startsWith('ascii-'))await ascii(caseId.slice(6));else if(caseId==='rich-copy-over-selection'||caseId==='rich-absolute-copy-over-selection')await rich(false);else if(caseId==='rich-cut-paste'||caseId==='rich-absolute-cut-paste')await rich(true);else await unicode();current.status='PASSED';}
    catch(error){current.status='FAILED';current.error=errorValue(error);blocked=true;}
    finally{rowDeadline=runDeadline;if(current.id){if(current.status!=='PASSED')try{current.failureObservation=await adapter.call('inspect',current.id);}catch(error){current.failureObservationError=errorValue(error);}
        try{current.disposal=await adapter.call('allDisposed');released(current.disposal);}catch(error){current.disposalError=errorValue(error);current.status='FAILED';blocked=true;}}
      current.finishedAt=new Date().toISOString();save();}
  }
  report.status=report.rows.length===cases.length&&report.rows.every(r=>r.status==='PASSED')?'PASSED':'FAILED';
}catch(error){report.status='FAILED';report.error=errorValue(error);blocked=true;}
finally{
  cleaning=true;rowDeadline=performance.now()+15000;
  report.cleanup={};
  if(platform){try{report.cleanup.keys=platform.releaseOwnedKeys();}catch(error){report.cleanup.keyError=errorValue(error);report.status='FAILED';}report.cleanup.platformResources=platform.resources();if(report.cleanup.platformResources.keysPending)report.status='FAILED';}
  if(adapter){try{report.cleanup.disposal=await adapter.call('allDisposed');released(report.cleanup.disposal);}catch(error){report.cleanup.disposalError=errorValue(error);report.status='FAILED';}
    try{report.cleanup.window=await adapter.close();}catch(error){report.cleanup.windowError=errorValue(error);report.status='FAILED';}}
  try{if(report.pins){report.finalPins=report.pins.map(value=>pin(value.path));assert.deepEqual(report.finalPins,report.pins,'Source, dist, helper and fixture must remain unchanged');report.finalHead=command('git',['rev-parse','HEAD']).stdout.trim();report.finalTrackedDirty=command('git',['status','--porcelain','--untracked-files=no']).stdout;assert.equal(report.finalHead,report.head);assert.equal(report.finalTrackedDirty,report.trackedDirty);const finalIdentity=computeSdkBuildIdentity();assert.equal(finalIdentity.buildId,report.buildId);report.sourceStable=true;}}catch(error){report.sourceStable=false;report.stabilityError=errorValue(error);report.status='FAILED';}
  report.finishedAt=new Date().toISOString();report.elapsedMs=performance.now()-start;save();
}
process.stdout.write(JSON.stringify({status:report.status,browser:browserName,report:reportPath,rows:report.rows.map(r=>({caseId:r.caseId,status:r.status}))})+'\n');
if(report.status!=='PASSED')process.exitCode=1;

}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await runInstalledClipboard('strict-relative-1');
