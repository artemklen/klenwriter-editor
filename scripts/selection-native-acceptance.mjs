// SPDX-License-Identifier: MIT OR Apache-2.0
// Closed installed macOS selection lane. No retries or input outside its fixture.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {computeSdkBuildIdentity} from './generate-sdk-types.mjs';
import {createSafariAdapter} from './selection-native/safari-adapter.mjs';
import {createInputOwner,prepareChromeWindow,fixedKeyScript} from './selection-native/input.mjs';
import {caseIds,limits,validCall} from './selection-native/protocol.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
const args=process.argv.slice(2),option=name=>{const at=args.indexOf(name);return at<0?null:args[at+1];};
const browserName=option('--browser'),output=option('--output'),brokerPath=option('--broker');
const usage='Usage: node scripts/selection-native-acceptance.mjs --browser chrome --output /absolute/fresh/report.json OR --browser safari --output /absolute/fresh/report.json --broker /absolute/fresh/broker/config.json';
const required=browserName==='chrome'?['--browser','--output']:browserName==='safari'?['--browser','--output','--broker']:[];
const names=args.filter((_,index)=>index%2===0);
if(args.length!==required.length*2||new Set(names).size!==required.length||!names.every(name=>required.includes(name))||!['chrome','safari'].includes(browserName)||!output?.startsWith('/'))throw Error(usage);
const outside=path=>{const actual=resolve(path);if(actual===root||actual.startsWith(root+'/'))throw Error('Installed evidence and broker config must be outside checkout');return actual;};
const outputPath=outside(output);
if(existsSync(outputPath))throw Error('Evidence output already exists; preserve the first result and use a fresh path');
mkdirSync(dirname(outputPath),{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const pin=path=>{const bytes=readFileSync(resolve(root,path));return {path,bytes:bytes.length,sha256:hash(bytes)};};
const helperPin=path=>{const bytes=readFileSync(path);return {path,bytes:bytes.length,sha256:hash(bytes)};};
const walk=path=>readdirSync(path,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(`${path}/${entry.name}`):entry.isFile()?[`${path}/${entry.name}`]:[]);
const frozen=name=>JSON.parse(readFileSync(`contracts/selection/v1/${name}-oracles.json`,'utf8'));
const native=frozen('native'),unicode=frozen('unicode'),scroll=frozen('scroll'),formatting=frozen('formatting');
assert.deepEqual(caseIds,['key-comb','key-zwj','key-flag','key-rtl','key-select-all','mouse-forward','mouse-reverse',
  'scroll-down-terminal','scroll-up-terminal','scroll-down-active','scroll-up-active','scroll-down-focus','scroll-up-focus'],'Exact closed13-case installed matrix');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const monotonic=()=>performance.now();
const report={format:'klenwriter-editor-installed-selection-native/1',browser:browserName,status:'NOT_RUN',startedAt:new Date().toISOString(),
  locales:[],setup:[],physicalActions:[],restoration:null,
  scope:'Actual installed macOS Chrome/Safari; fixture-scoped CGEvent mouse and guarded System Events keys with trusted UA traces, native public SDK2/WASM selection, own-confirmed clipboard writes and OS readback. Platform input is not hardware-device evidence. No IME settlement, arbitrary clipboard47, assistive-technology or independent-review claim.'};
const save=()=>writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n');
function run(command,argv,{fullStdout=false,timeout=30000,maxBuffer=1024*1024}={}){
  const result=spawnSync(command,argv,{cwd:root,encoding:'utf8',timeout,maxBuffer});
  const execution={command,argv,returnCode:result.status,signal:result.signal,stdout:fullStdout?(result.stdout??''):(result.stdout??'').slice(0,16384),stderr:(result.stderr??'').slice(0,4096),error:result.error?.message??null};
  if(result.status!==0)throw Object.assign(Error(`${command} failed: ${execution.stderr||execution.error||execution.stdout}`),{execution});
  return execution;
}
const script=text=>run('/usr/bin/osascript',['-e',text]);
let config=null,configPath=null,configHash=null,adapter=null,inputHelper=null,keyScriptPath=null,sourceHelper=null,originalSource=null,selectedSource=null;
if(browserName==='safari'){
  if(!brokerPath?.startsWith('/'))throw Error(usage);
  configPath=outside(brokerPath);const bytes=readFileSync(configPath);if(bytes.length>4096)throw Error('Broker config bound');
  config=JSON.parse(bytes);configHash=hash(bytes);
  report.broker={configPath,configSha256:configHash,nonce:config.nonce};
}else{
  const nonce=randomBytes(16).toString('hex');
  config={nonce,origin:'http://127.0.0.1:4174',fixtureUrl:'http://127.0.0.1:4174/selection',title:'KlenWriter Selection native '+nonce};
}
const source=()=>JSON.parse(run(sourceHelper,['status']).stdout);
async function selectSource(id){
  const result=JSON.parse(run(sourceHelper,['select',id]).stdout);report.setup.push({action:'select-existing-input-source',...result});
  await wait(250);const actual=source();assert.equal(actual.current.id,id,'Existing source selection did not persist');selectedSource=id;return actual;
}
async function physical(action,entry){
  assert.equal(source().current.id,selectedSource,'Selected input source changed before action; no input sent');
  const row={locale:entry.locale,caseId:entry.caseId,action,status:'attempted',startedAt:new Date().toISOString(),inputSourceBefore:source().current};
  report.physicalActions.push(row);save();
  try{row.proof=await adapter.input(action);row.inputSourceAfter=source().current;assert.equal(row.inputSourceAfter.id,selectedSource,'Input source changed during action');row.status='completed';}
  catch(error){row.status='failed';row.error={message:error.message,execution:error.execution??null};throw error;}
  finally{row.finishedAt=new Date().toISOString();save();}
  return row.proof;
}
function point(roles,p){
  const name=p.role??p.nodeRole??p[p.kind==='child'?'parent':'node'];
  assert.ok(typeof roles[name]==='string',`Missing independent role ${name}`);
  if(p.kind==='text')return {kind:'text',node:roles[name],offset:p.offset,affinity:p.affinity??'after'};
  if(p.kind==='child')return {kind:'child',parent:roles[name],index:p.index,affinity:p.affinity??'after'};
  return {kind:'edge',node:roles[name],side:p.side};
}
const selection=(roles,value)=>value===null?null:{anchor:point(roles,value.anchor),focus:point(roles,value.focus)};
const rawPoint=literal=>({path:literal.hostChildNodesPath,nodeType:literal.nodeType,text:literal.expectedData,offset:literal.offset});
function rawExact(actual,expected,label){assert.equal(actual.inside,true,`${label}: owned raw range`);assert.deepEqual(actual.anchor,rawPoint(expected.anchor),`${label}: raw anchor`);assert.deepEqual(actual.focus,rawPoint(expected.focus),`${label}: raw focus`);}
const rowAt=(snapshot,path)=>{const row=snapshot.rows.find(row=>row.path===path);assert.ok(row,`Missing native topology ${path}`);return row.node;};
function boundRoles(snapshot,literal){return Object.fromEntries(Object.entries(literal).map(([role,path])=>[role,rowAt(snapshot,path?.virtual_root?'':Array.isArray(path)?'/'+path.join('/'):path).id]));}
function scalar(text,offset){return Number.isSafeInteger(offset)&&offset>=0&&offset<=text.length&&!(offset>0&&offset<text.length&&/[\uD800-\uDBFF]/.test(text[offset-1])&&/[\uDC00-\uDFFF]/.test(text[offset]));}
function selectionOnly(after,before){
  assert.equal(after.canonical,before.canonical,'Selection must preserve exact canonical bytes');
  assert.deepEqual(after.rows.map(row=>[row.path,row.node.id,row.node.type_id,row.node.attributes,row.node.marks,row.node.text,row.node.children]),before.rows.map(row=>[row.path,row.node.id,row.node.type_id,row.node.attributes,row.node.marks,row.node.text,row.node.children]),'Selection must preserve exact identity/topology/attributes');
  for(const key of ['session','generation','revision','history_epoch'])assert.equal(after.state.stamp[key],before.state.stamp[key],`Selection ${key}`);
  assert.deepEqual(after.state.history,before.state.history,'Selection must retain exact history');
  assert.equal(after.state.dirty,before.state.dirty);assert.equal(after.state.saved_revision,before.state.saved_revision);assert.equal(after.state.stored_marks,null);
  assert.ok(BigInt(after.state.stamp.selection_epoch)>=BigInt(before.state.stamp.selection_epoch),'Selection epoch must be monotonic');
}
function visible(geometry){
  const c=geometry.caret,clip=geometry.effectiveClip;assert.ok(c&&clip,'Actual caret and effective clip are required');assert.ok(c.height>0,'Actual positive-height caret');
  for(const key of ['left','right','top','bottom'])assert.ok(Number.isFinite(c[key])&&Number.isFinite(clip[key]),`Finite ${key}`);
  assert.ok(c.left>=clip.left-.5&&c.right<=clip.right+.5&&c.top>=clip.top-.5&&c.bottom<=clip.bottom+.5,'All four actual caret edges are inside effective clip');
}
function nearBox(actual,literal){assert.ok(actual&&literal,'Fixture geometry required');for(const key of ['left','right','top','bottom'])assert.ok(Math.abs(actual[key]-literal[key])<=.5,`Frozen fixture ${key}`);}
function ownerStopped(geometry){
  assert.equal(geometry.resources.selection.activePointers,0);assert.equal(geometry.resources.selection.animationFrames,0);
  assert.equal(geometry.resources.selection.restoreTickets,0);assert.equal(geometry.resources.dom.continuations,0);
  assert.equal(geometry.resources.sdk.task_continuations,0);assert.equal(geometry.resources.sdk.pending_tickets,0);
}
function traceBase(checkpoint){
  assert.equal(checkpoint.foreignPointer,false,'Foreign pointer interference cannot prove this owned gesture');
  assert.equal(checkpoint.overflow,false);assert.equal(checkpoint.sampleError,null);assert.equal(checkpoint.actionTrace.overflow,false);
  assert.deepEqual(checkpoint.errors,[]);assert.deepEqual(checkpoint.policyViolations,[]);assert.deepEqual(checkpoint.after.failures,[]);
  assert.ok(checkpoint.inputTrace.length>0,'Actual trusted fixture input trace required');
  for(const row of checkpoint.inputTrace)assert.equal(row.isTrusted,true,`Untrusted ${row.event} cannot prove installed input`);
}
function trustedKey(checkpoint,code,{shift=false,meta=false,cancelled=false}={}){
  const rows=checkpoint.inputTrace.filter(row=>row.event==='keydown'&&row.phase!=='document-bubble'&&row.code===code);
  assert.ok(rows.some(row=>row.shift===shift&&row.meta===meta),`Actual ${code} modifier keydown required`);
  assert.ok(checkpoint.inputTrace.some(row=>row.event==='keyup'&&row.code===code),'Actual keyup required');
  if(cancelled)assert.ok(checkpoint.inputTrace.some(row=>row.event==='keydown'&&row.phase==='document-bubble'&&row.code===code&&row.defaultPrevented===true),'Actual bubbling cancellation required');
}
function pointerTrace(checkpoint,prepared,{focus=false}={}){
  const trace=checkpoint.inputTrace.filter(row=>row.phase!=='document-bubble');
  const down=trace.filter(row=>row.event==='pointerdown'),up=trace.filter(row=>row.event==='pointerup');
  assert.equal(down.length,1,'One actual trusted pointerdown');assert.equal(up.length,1,'One actual trusted pointerup');
  assert.equal(down[0].button,0);assert.equal(down[0].isPrimary,true);assert.equal(down[0].pointerType,'mouse');
  assert.equal(down[0].buttons,1);assert.equal(up[0].buttons,0);assert.equal(up[0].pointerId,down[0].pointerId);
  assert.ok(Number.isSafeInteger(down[0].pointerId),'Actual pointerId');
  assert.ok(Math.abs(down[0].x-prepared.points.start.x)<=.5&&Math.abs(down[0].y-prepared.points.start.y)<=.5,'Pointerdown hits exact fixture point');
  const moved=trace.filter(row=>row.event==='pointermove'&&row.time>=down[0].time&&row.time<=up[0].time);
  const atEnd=row=>row.buttons===1&&row.pointerId===down[0].pointerId&&Math.abs(row.x-prepared.points.end.x)<=.5&&Math.abs(row.y-prepared.points.end.y)<=.5;
  const firstEnd=moved.findIndex(atEnd);assert.ok(firstEnd>=0,'Actual held drag reaches fixed point');
  for(const row of moved.slice(firstEnd))assert.ok(atEnd(row),'Held pointer stays at the fixed fixture point without later assistance');
  assert.ok(up[0].time-down[0].time<=8000,'Actual trusted pointer hold is bounded at8s');
  if(focus){assert.ok(checkpoint.focusLoss,'Trusted focusout during held pointer required');trustedKey(checkpoint,'Tab',{shift:true});}
  return {pointerId:down[0].pointerId,heldMs:up[0].time-down[0].time};
}
function released(value){
  assert.equal(value.status,'destroy_requested');assert.deepEqual(value.global,{sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});
  const r=value.resources;for(const key of ['listeners','observers','continuations','retainedInputBytes','retainedRecoveryRegions'])assert.equal(r.dom[key],0,`Disposed DOM ${key}`);
  assert.deepEqual(r.selection,{bookmarks:0,restoreTickets:0,activePointers:0,animationFrames:0});assert.deepEqual(r.clipboard,{pending:0,continuations:0,retainedTextBytes:0});
  for(const key of ['sessions','listeners','queued_mutations','queued_bytes','pending_tickets','host_requests','task_continuations'])assert.equal(r.sdk[key],0,`Disposed SDK ${key}`);
  assert.deepEqual(value.errors,[]);assert.deepEqual(value.policyViolations,[]);
}
async function checkpoint(entry,label){const value=await adapter.call('checkpoint');entry.checkpoints.push({label,value});save();return value;}
async function until(read,predicate,maximum=2000){const start=monotonic();let value;do{value=await read();if(predicate(value))return value;await wait(100);}while(monotonic()-start<maximum);throw Object.assign(Error('Bounded fixture observation did not reach its required condition'),{lastObservation:value});}

async function chrome(){
  const childHome=mkdtempSync(resolve(dirname(outputPath),'chrome-selection-appdata-'));
  report.setup.push({action:'isolate-chrome-child-app-data',variable:'CFFIXED_USER_HOME',directory:childHome,scope:'Only Chrome child; Carbon and scoped CGEvent helper use the real user environment'});
  const launchArguments=['--force-renderer-accessibility=complete'];
  const browser=await chromium.launch({channel:'chrome',headless:false,args:launchArguments,env:{...process.env,CFFIXED_USER_HOME:childHome}});
  const page=await browser.newPage({viewport:{width:1024,height:768}});const errors=[];
  let mountedId=null,serial=0,guardSerial=0,busy=false,navigationStarted=false,bootstrapReady=false,physicalStarted=false,browserCdp=null,pageCdp=null;
  page.on('pageerror',error=>errors.push(error.message));report.browserVersion=browser.version();
  const record=(kind,value)=>{report.controlLog??=[];if(report.controlLog.length>=4096)throw Error('Chrome control receipt bound');report.controlLog.push({kind,...value});};
  const call=async(method,...args)=>{
    if(busy||++serial>limits.commands||!validCall(method,args))throw Error('Concurrent, excessive or unknown Chrome fixture call');busy=true;
    try{const value=await page.evaluate(async({method,args,nonce,url,title})=>{
      if(method==='documentGuard')return {url:location.href,title:document.title,documentFocused:document.hasFocus()};
      if(location.href!==url||document.title!==title)throw Error('Selection fixture left its exact owned URL/title');
      const value=await window.selectionNative[method](...args);
      return method==='guard'?{...value,nonce,url:location.href,title:document.title,documentFocused:document.hasFocus()}:value;
    },{method,args,nonce:config.nonce,url:config.fixtureUrl,title:config.title});
      if(method==='prepare'){assert.match(value.id,/^selection-mount-[1-9][0-9]{0,8}$/);mountedId=value.id;}
      if(method==='finish')mountedId=null;return value;
    }finally{busy=false;}
  };
  const inputOwner=createInputOwner({browser:'chrome',config,inputHelper,keyScriptPath,run,record,mountedId:()=>mountedId,guard:async action=>{
    const start=process.hrtime.bigint(),value=await call('guard',action);
    assert.equal(value.url,config.fixtureUrl);assert.equal(value.title,config.title);
    return {id:config.nonce+':'+String(serial),start,value:{...value,mountedId,serial:++guardSerial}};
  }});
  report.control={method:'Installed headed Chrome; closed Playwright page setup/read RPC, strict AX CGEvent mouse and guarded System Events keys',webDriver:false,
    uniqueTitle:config.title,fixtureUrl:config.fixtureUrl,fixtureOnly:true,childOnlyEnvironment:true,launchArguments};
  return {errors,input:action=>{assert.equal(bootstrapReady,true,'Strict Chrome window bootstrap required before input');physicalStarted=true;return inputOwner.input(action);},releaseOwnedPointer:()=>inputOwner.releaseOwnedPointer(),
    get pointerDown(){return inputOwner.pointerDown;},get pointerState(){return inputOwner.pointerState;},get inputDisabled(){return inputOwner.disabled;},
    async navigate(){
      assert.equal(navigationStarted,false,'Chrome bootstrap cannot be retried');assert.equal(physicalStarted,false);navigationStarted=true;
      const response=await page.goto(config.fixtureUrl);assert.ok(response?.ok(),'Selection fixture server unavailable');
      await page.waitForFunction(()=>window.selectionHostReady===true,null,{timeout:15000});
      await page.evaluate(async title=>{document.title=title;await import('/selection-native-host.js');},config.title);
      await page.bringToFront();script('tell application "Google Chrome" to activate');await page.waitForFunction(()=>document.hasFocus(),null,{timeout:5000});
      report.control.bootstrap=await prepareChromeWindow({config,record,
        pageState:()=>page.evaluate(()=>{
          const prefix='KlenWriter Selection native ',v=visualViewport,selection=getSelection();
          const point=(node,offset)=>{if(!node)return null;const path=[];let current=node;
            while(current.parentNode){if(path.length>=64)throw Error('Bounded bootstrap raw selection path');path.unshift(Array.prototype.indexOf.call(current.parentNode.childNodes,current));current=current.parentNode;}
            return {nodeType:node.nodeType,path,offset};};
          return {url:location.href,title:document.title,nonce:document.title.startsWith(prefix)?document.title.slice(prefix.length):null,documentFocused:document.hasFocus(),
            viewport:{width:innerWidth,height:innerHeight,scale:v?.scale,offsetLeft:v?.offsetLeft,offsetTop:v?.offsetTop},scroll:{x:scrollX,y:scrollY},
            selection:{rangeCount:selection?.rangeCount??0,anchor:point(selection?.anchorNode,selection?.anchorOffset),focus:point(selection?.focusNode,selection?.focusOffset)}};
        }),
        inspectWindow:request=>{
          const json=JSON.stringify(request);assert.ok(Buffer.byteLength(json)<=4096);
          const execution=run(inputHelper,['--inspect-window',json],{timeout:request.deadlineMs,fullStdout:true,maxBuffer:32768});
          return {execution,actual:JSON.parse(execution.stdout)};
        },
        async getBrowserPid(){
          browserCdp=await browser.newBrowserCDPSession();const result=await browserCdp.send('SystemInfo.getProcessInfo');
          const owned=result.processInfo.filter(value=>value.type==='browser');assert.equal(owned.length,1);return Number(owned[0].id);
        },
        async getTargetInfo(){pageCdp??=await page.context().newCDPSession(page);return (await pageCdp.send('Target.getTargetInfo')).targetInfo;},
        windowCommand:(method,params)=>{assert.ok(browserCdp);return browserCdp.send(method,params);},
      });
      bootstrapReady=true;save();
    },
    async focus(){await page.bringToFront();await page.waitForFunction(()=>document.hasFocus(),null,{timeout:5000});},call,
    async close(){await browser.close();report.control.cleanup={status:'owned-chrome-browser-closed',scope:'Only isolated browser instance launched for this fixture'};},
  };
}

async function keyboard(entry,prepared){
  const all=entry.caseId==='key-select-all';await physical(all?'select-all':'shift-left',entry);await wait(150);
  const observed=await checkpoint(entry,'trusted keyboard selection');traceBase(observed);selectionOnly(observed.after,prepared.before);
  trustedKey(observed,all?'KeyA':'ArrowLeft',{shift:!all,meta:all,cancelled:all});
  if(all){
    assert.equal(prepared.before.canonical,formatting.canonical.F1,'Exact frozen F1 Select All source');
    assert.equal(rowAt(prepared.before,'').children.length,6,'F1 has six native root children');
    const literal=unicode.keyboard.selectAll.fixtures.find(row=>row.fixture==='formatting F1');
    assert.deepEqual(observed.after.state.selection,selection(prepared.before.roles,{anchor:literal.anchor,focus:literal.focus}));
    assert.equal(observed.after.rawDom.inside,true);assert.equal(observed.after.rawDom.anchor.offset,0);assert.equal(observed.after.rawDom.focus.offset,6);
    assert.deepEqual(observed.after.rawDom.anchor.path,[]);assert.deepEqual(observed.after.rawDom.focus.path,[]);
  }else{
    const id={'key-comb':'U-COMB','key-zwj':'U-ZWJ','key-flag':'U-FLAG','key-rtl':'U-RTL'}[entry.caseId],literal=unicode.cases.find(row=>row.id===id);
    const selected=observed.after.state.selection;assert.equal(selected.anchor.kind,'text');assert.equal(selected.focus.kind,'text');
    for(const endpoint of ['anchor','focus']){
      assert.equal(selected[endpoint].node,prepared.before.roles.T);assert.ok(scalar(literal.text,selected[endpoint].offset));assert.equal(selected[endpoint].affinity,'after');
      assert.deepEqual(observed.after.rawDom[endpoint],{path:[0,0,0],nodeType:3,text:literal.text,offset:selected[endpoint].offset},'Raw DOM and native directed UTF16 position agree');
    }
    assert.equal(observed.after.rawDom.inside,true);
    if(entry.caseId!=='key-rtl'){
      const expected=unicode.keyboard.ltrWholeCluster.find(row=>row.case===id);
      assert.equal(selected.anchor.offset,expected.expectedAnchor);assert.equal(selected.focus.offset,expected.expectedFocus);
    }else entry.rtlQualification='Actual browser dir=rtl visual navigation recorded; owned scalar endpoints and native/raw agreement checked. No identical cross-engine traversal oracle invented.';
  }
}

async function clipboardResult(entry,action,previous){
  await physical(action,entry);
  const observation=await until(()=>adapter.call('inspect'),value=>value.clipboard.results.length>previous,12000);
  const result=observation.clipboard.results[previous];assert.equal(result.action,action);assert.equal(result.status,action==='copy'?'copied':'cut');assert.equal(result.clipboard,'confirmed');assert.equal(result.failure,null);
  // This is the first OS clipboard read. The fixture has now acknowledged its
  // own navigator.clipboard.writeText; no prior/unrelated clipboard is inspected.
  const readback=run('/usr/bin/pbpaste',[],{fullStdout:true,maxBuffer:1024*1024,timeout:5000});
  entry.clipboard??=[];entry.clipboard.push({action,result,confirmation:'Actual default navigator.clipboard.writeText ACK before OS readback',osReadback:readback});save();
  assert.equal(readback.stdout,'b\nc','Exact own-written plain LF clipboard');
  return result;
}
async function mouse(entry,prepared){
  const literal=native.cases.find(row=>row.id===(entry.caseId==='mouse-forward'?'L3-forward':'L3-reverse'));
  await physical('move-start',entry);await physical('down',entry);await wait(100);
  const anchor=point(prepared.before.roles,literal.input.selection.anchor);
  const start=await adapter.call('inspect');assert.deepEqual(start.geometry.state.selection,{anchor,focus:anchor});
  await physical('move-end',entry);await wait(150);await physical('up',entry);await wait(100);
  const dragged=await checkpoint(entry,'trusted directed list-item drag');traceBase(dragged);entry.pointer=pointerTrace(dragged,prepared);
  selectionOnly(dragged.after,prepared.before);assert.equal(dragged.after.canonical,literal.input.canonical_json);
  assert.deepEqual(dragged.after.state.selection,selection(prepared.before.roles,literal.input.selection));
  const text={L:'ab',R:'cd'},paths={L:[0,0,0,0,0,0],R:[0,1,0,0,0,0]};
  const raw=endpoint=>{const p=literal.input.selection[endpoint];return {path:paths[p.node],nodeType:3,text:text[p.node],offset:p.offset};};
  assert.equal(dragged.after.rawDom.inside,true);assert.deepEqual(dragged.after.rawDom.anchor,raw('anchor'));assert.deepEqual(dragged.after.rawDom.focus,raw('focus'));
  await clipboardResult(entry,'copy',0);const copied=await checkpoint(entry,'confirmed own copy');traceBase(copied);selectionOnly(copied.after,dragged.after);assert.deepEqual(copied.after.state,dragged.after.state);
  assert.ok(copied.inputTrace.some(row=>row.event==='copy'&&row.phase==='document-bubble'&&row.defaultPrevented),'Actual owned copy cancellation');
  await clipboardResult(entry,'cut',1);const cut=await checkpoint(entry,'confirmed own cut then one native mutation');traceBase(cut);
  assert.ok(cut.inputTrace.some(row=>row.event==='cut'&&row.phase==='document-bubble'&&row.defaultPrevented),'Actual owned cut cancellation');
  assert.equal(cut.after.canonical,literal.after.canonical_json);const roles=boundRoles(cut.after,literal.after.identity_roles);
  assert.deepEqual(cut.after.state.selection,selection(roles,literal.after.selection));
  assert.equal(cut.after.rawDom.inside,true);
  const rawCut={path:[0,0,0,0,0,0],nodeType:3,text:'a',offset:1};
  assert.deepEqual(cut.after.rawDom.anchor,rawCut);assert.deepEqual(cut.after.rawDom.focus,rawCut);
  const old=new Set(prepared.before.rows.map(row=>row.node.id)),live=new Set(cut.after.rows.map(row=>row.node.id));
  for(const role of literal.identity.retained_live)assert.equal(roles[role],prepared.before.roles[role],`Retained ${role}`);
  for(const role of literal.identity.retired_old)assert.ok(!live.has(prepared.before.roles[role]),`Retired ${role}`);
  for(const role of literal.identity.created_live)assert.ok(!old.has(roles[role]),`Fresh ${role}`);
  assert.equal(cut.after.state.stamp.revision,'1');assert.equal(cut.after.state.history.undo_entries,'1');assert.equal(cut.after.state.history.redo_entries,'0');
  assert.equal(cut.after.state.stamp.history_epoch,'1');assert.equal(cut.after.state.stored_marks,null);assert.equal(cut.after.state.dirty,true);
  assert.equal(BigInt(cut.after.state.stamp.selection_epoch)-BigInt(copied.after.state.stamp.selection_epoch),1n,'Cut has one native selection transition');
  for(const key of ['session','generation'])assert.equal(cut.after.state.stamp[key],copied.after.state.stamp[key]);
  assert.equal(cut.after.events.filter(row=>row.change.kind==='document').length,1,'One native cut publication');
}

function scrollInvariant(geometry,roles,literal,{caret=false}={}){
  assert.deepEqual(geometry.state.selection.anchor,point(roles,literal.anchorInvariant));assert.equal(geometry.rawDom.inside,true);
  assert.deepEqual(geometry.rawDom.anchor,rawPoint(literal.rawDomAnchorInvariant));
  const owners=geometry.allScrollOwners;assert.equal(owners.windowX,0);assert.equal(owners.windowY,0);assert.equal(owners.clipTop,0);assert.equal(owners.clipLeft,0);assert.equal(owners.portLeft,0);
  if(caret)visible(geometry);
  if(geometry.monotonicFromPrevious!==null){if(literal.direction==='down')assert.ok(geometry.monotonicFromPrevious<=0);else assert.ok(geometry.monotonicFromPrevious>=0);}
  const position=geometry.state.selection.focus;
  if(position.kind==='text'){
    const row=scroll.modelRowRoles.find(row=>row.textRole&&roles[row.textRole]===position.node);assert.ok(row,'Owned scalar text focus must have frozen native role');assert.ok(scalar(row.literalText,position.offset));
    const dom=scroll.rawDomRowRoles.find(raw=>raw.row===row.row);
    assert.deepEqual(geometry.rawDom.focus,{path:dom.textChildNodesPath,nodeType:3,text:dom.literalText,offset:position.offset},'Scroll native/raw Text endpoint agreement');
  }else if(position.kind==='child'){
    const structural=scroll.structuralRoles.find(row=>roles[row.role]===position.parent);
    const block=scroll.modelRowRoles.find(row=>roles[row.blockRole]===position.parent);
    const dom=block?scroll.rawDomRowRoles.find(row=>row.row===block.row):null;
    const path=structural?.domChildNodesPath??dom?.elementChildNodesPath;
    const count=structural?.children??(block?.textRole?1:0);
    assert.ok(path&&Number.isSafeInteger(position.index)&&position.index>=0&&position.index<=count,'Owned Child focus agrees with frozen parent topology');
    assert.deepEqual(geometry.rawDom.focus,{path,nodeType:1,text:null,offset:position.index},'Scroll native/raw Child endpoint agreement');
  }else{
    assert.equal(position.kind,'edge');assert.ok(['before','after'].includes(position.side));
    const block=scroll.modelRowRoles.find(row=>roles[row.blockRole]===position.node),text=scroll.modelRowRoles.find(row=>row.textRole&&roles[row.textRole]===position.node);
    const row=block??text;assert.ok(row,'Owned Edge focus has a frozen row role');const dom=scroll.rawDomRowRoles.find(raw=>raw.row===row.row);
    const outer=block?dom.elementChildNodesPath:dom.spanChildNodesPath;
    assert.deepEqual(geometry.rawDom.focus,{path:outer.slice(0,-1),nodeType:1,text:null,offset:outer.at(-1)+(position.side==='after'?1:0)},'Scroll native/raw Edge endpoint agreement');
  }
}
async function scrolling(entry,prepared){
  const direction=entry.caseId.includes('-down-')?'down':'up',terminal=entry.caseId.endsWith('-terminal'),focus=entry.caseId.endsWith('-focus');
  if(focus)assert.deepEqual(prepared.focusControl,{tag:'SELECT',type:'select-one',size:2,tabIndex:0,installedBeforeInput:true},'Pre-input non-text focus witness');
  const literal=scroll.controlledCoreCases.find(row=>row.direction===direction&&row.geometry==='plain'&&row.ending===(terminal?'terminal_release':'active_release'));
  const setup=prepared.prepared,mode=scroll.geometryModes.plain;assert.equal(setup.font.status,'loaded');assert.equal(setup.font.family.replace(/^['"]|['"]$/g,''),'OSR40FixtureMono');
  nearBox(setup.geometry.client,mode.scrollportClient);nearBox(setup.geometry.effectiveClip,mode.effectiveClip);
  assert.equal(setup.geometry.clientWidth,640);assert.equal(setup.geometry.clientHeight,240);assert.equal(setup.geometry.scrollHeight,1596);assert.equal(setup.geometry.scrollTop,literal.initialScrollTop);
  for(const actual of setup.domRows){const row=scroll.rowGeometry.find(row=>row.row===actual.row);nearBox(actual.box,literal.initialScrollTop===0?row.blockBoxAtScroll0:row.blockBoxAtScrollMax1356);if(actual.text)assert.ok(Math.abs(actual.text.width-28.8)<=.5,'Frozen font width');}
  assert.equal(prepared.before.canonical,scroll.fixture.independentlySerializedExpectedCanonical);
  const roles=prepared.before.roles,anchor=point(roles,literal.anchorInvariant),end=point(roles,scroll.endpointTables[direction].terminalFocus);
  await physical('move-start',entry);const began=monotonic();await physical('down',entry);
  const first=await until(()=>adapter.call('inspect'),value=>JSON.stringify(value.geometry.state.selection)===JSON.stringify({anchor,focus:anchor}),1000);
  scrollInvariant(first.geometry,roles,literal,{caret:true});entry.anchor=first;
  await physical('move-end',entry);
  let previous=literal.initialScrollTop,advances=0,stopped=null;
  entry.heldObservations=[];
  while(monotonic()-began<7000){
    await wait(100);const sample=await adapter.call('inspect');entry.heldObservations.push(sample);scrollInvariant(sample.geometry,roles,literal);
    const delta=sample.geometry.scrollTop-previous;assert.ok(direction==='down'?delta>=0:delta<=0,'Directional native scroll progression');if(delta!==0)advances++;previous=sample.geometry.scrollTop;
    const remaining=direction==='down'?previous<1356:previous>0;
    const reached=terminal?JSON.stringify(sample.geometry.state.selection.focus)===JSON.stringify(end):advances>=2&&remaining;
    if(reached){visible(sample.geometry);stopped=sample;break;}
  }
  assert.ok(stopped,terminal?'Frozen terminal endpoint not reached within bounded hold':'Active window with two positive advances and range remaining was not exercised');assert.ok(advances>=2,'Two distinct observed positive advances required');
  entry.stop={terminal,focus,advances,observation:stopped};save();
  await physical(focus?'shift-tab':'up',entry);
  const settled=await adapter.call('settle');entry.settlement=settled;
  assert.equal(settled.status,'frame','Actual stop RAF measurement must succeed');assert.ok(settled.elapsedMs<=100&&settled.elapsedMs>=0,'Actual first stop RAF within100ms');
  assert.equal(settled.trigger,focus?'focusout':'pointerup');ownerStopped(settled.geometry);scrollInvariant(settled.geometry,roles,literal,{caret:true});
  const stable=[];
  for(let index=0;index<5;index++){
    await wait(100);const value=await adapter.call('inspect');scrollInvariant(value.geometry,roles,literal,{caret:true});ownerStopped(value.geometry);
    if(terminal)assert.deepEqual(value.geometry.state.selection.focus,end);
    assert.deepEqual(value.geometry.state,settled.geometry.state,'Native state is stable from the actual first stop RAF');
    assert.deepEqual(value.geometry.rawDom,settled.geometry.rawDom,'Raw DOM range is stable from the actual first stop RAF');
    assert.deepEqual(value.geometry.allScrollOwners,settled.geometry.allScrollOwners,'Every scroll owner is stable from the actual first stop RAF');
    if(focus){assert.equal(value.geometry.activeElement,'selection-host-control');assert.equal(value.pointerDown,true,'Physical mouse remains held through focus-cancellation stability evidence');}
    stable.push(value);
  }
  entry.stable=stable;
  if(focus){
    await physical('up',entry);entry.mouseupCleanup={afterFiveStableFocusCancellationSamples:true};
    await physical('tab',entry);await wait(100);const returned=await adapter.call('inspect');
    assert.equal(returned.geometry.activeElement,prepared.id);assert.deepEqual(returned.geometry.state,stable[0].geometry.state);assert.deepEqual(returned.geometry.rawDom,stable[0].geometry.rawDom);
    entry.focusReturn=returned;ownerStopped(returned.geometry);visible(returned.geometry);
  }
  const final=await checkpoint(entry,'held scrolling stopped and stable');traceBase(final);selectionOnly(final.after,prepared.before);
  entry.pointer=pointerTrace(final,prepared,{focus});assert.equal(final.pointerDown,false);
  for(const sample of final.samples)scrollInvariant(sample,roles,literal);
  for(const row of final.actionTrace.trace.filter(row=>row.type==='publication'))scrollInvariant(row.geometry,roles,literal);
}

try{
  assert.equal(process.platform,'darwin','Installed native acceptance requires macOS');assert.equal(process.version,'v24.22.0','Pinned acceptance Node');report.nodeVersion=process.version;
  report.os={productVersion:run('/usr/bin/sw_vers',['-productVersion']).stdout.trim(),buildVersion:run('/usr/bin/sw_vers',['-buildVersion']).stdout.trim()};
  const identity=computeSdkBuildIdentity(),built=JSON.parse(readFileSync('artifacts/sdk-build-identity.json','utf8'));assert.equal(built.buildId,identity.buildId,'Build exact current production source before installed input');assert.deepEqual(built.sourceHashes,identity.sourceHashes);
  report.buildId=identity.buildId;
  const paths=[...new Set([...Object.keys(identity.sourceHashes),...walk('contracts/selection/v1'),...walk('scripts/selection-native'),
    ...walk('packages/wasm/dist'),...walk('packages/sdk/dist'),...walk('packages/dom/dist'),...walk('packages/kwdj/dist'),
    'scripts/selection-native-acceptance.mjs','scripts/selection-native-input.swift','scripts/dom-native-input-source.swift','spikes/workspace/selection-native-host.js',
    'spikes/workspace/selection-host.js','spikes/workspace/selection.css','spikes/workspace/selection.html','scripts/workspace-server.mjs','artifacts/sdk-build-identity.json',
    'artifacts/sdk-native-manifest.json','artifacts/sdk-native-manifest-v2.json','artifacts/sdk-wasm-seal.json'])].sort();
  report.source={head:run('git',['rev-parse','HEAD']).stdout.trim(),trackedDirty:run('git',['status','--porcelain','--untracked-files=no']).stdout.trim(),pins:paths.map(pin)};
  const seal=JSON.parse(readFileSync('artifacts/sdk-wasm-seal.json','utf8'));assert.equal(seal.build_id,identity.buildId);assert.equal(seal.sealed_sha256,pin('packages/wasm/dist/editor_wasm_bg.wasm').sha256);
  const bundle=browserName==='chrome'?'/Applications/Google Chrome.app/Contents/Info.plist':'/Applications/Safari.app/Contents/Info.plist';
  assert.ok(existsSync(bundle),'Installed browser bundle required');report.bundleVersion=run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',bundle]).stdout.trim();report.bundleBuild=run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleVersion',bundle]).stdout.trim();
  const accessibility=script('tell application "System Events" to get UI elements enabled').stdout.trim();report.setup.push({action:'read-existing-ui-automation-availability',value:accessibility});assert.equal(accessibility,'true','Existing Accessibility permission required; no request/grant flow');
  const helperDirectory=mkdtempSync(resolve(dirname(outputPath),'selection-native-helpers-'));sourceHelper=resolve(helperDirectory,'input-source');inputHelper=resolve(helperDirectory,'fixture-input');
  const keySourcePath=resolve(helperDirectory,'fixture-keys.applescript');keyScriptPath=resolve(helperDirectory,'fixture-keys.scpt');
  writeFileSync(keySourcePath,fixedKeyScript,{flag:'wx'});
  report.setup.push({action:'write-fixed-key-script-source',source:helperPin(keySourcePath),scope:'Exact fixed program; compile once before browser/input/page guards'});
  report.setup.push({action:'compile-closed-source-helpers',executions:[run('/usr/bin/swiftc',[resolve(root,'scripts/dom-native-input-source.swift'),'-O','-o',sourceHelper]),run('/usr/bin/swiftc',[resolve(root,'scripts/selection-native-input.swift'),'-O','-o',inputHelper]),run('/usr/bin/osacompile',['-o',keyScriptPath,keySourcePath])],sourceHelper,inputHelper,keySourcePath,keyScriptPath});
  report.helperArtifacts=[sourceHelper,inputHelper,keySourcePath,keyScriptPath].map(helperPin);
  const initial=source();report.inputSources=initial;originalSource=initial.current.id;
  const russian=['com.apple.keylayout.RussianWin','com.apple.keylayout.Russian'].find(id=>initial.sources.some(row=>row.id===id&&row.enabled&&row.selectable));assert.ok(russian,'Existing enabled Russian/RussianWin source required');
  adapter=await(browserName==='chrome'?chrome():createSafariAdapter({config,report,run,outputPath,inputHelper,keyScriptPath}));await adapter.navigate();
  let blocked=false;
  for(const [locale,inputSourceId]of [['en','com.apple.keylayout.US'],['ru',russian]]){
    const lane={locale,inputSourceId,status:'NOT_RUN',cases:[],startedAt:new Date().toISOString()};report.locales.push(lane);
    if(!blocked){assert.ok(initial.sources.some(row=>row.id===inputSourceId&&row.enabled&&row.selectable),'Required existing enabled source unavailable');await adapter.focus();lane.actualInputSource=await selectSource(inputSourceId);}
    for(const caseId of caseIds){
      const entry={locale,caseId,status:'NOT_RUN',checkpoints:[],startedAt:new Date().toISOString()};lane.cases.push(entry);save();
      if(blocked){entry.reason='Earlier acceptance/control/cleanup failure disabled later physical input';continue;}
      let prepared=null,physicalBegan=false,prepareAttempted=false;
      try{
        prepareAttempted=true;
        prepared=await adapter.call('prepare',locale,caseId);entry.prepared=prepared;assert.equal(prepared.caseId,caseId);assert.equal(prepared.locale,locale);assert.equal(prepared.before.context.build_id,identity.buildId,'Mounted actual build identity');save();
        physicalBegan=true;
        if(caseId.startsWith('key-'))await keyboard(entry,prepared);else if(caseId.startsWith('mouse-'))await mouse(entry,prepared);else await scrolling(entry,prepared);
        entry.status='PASSED';
      }catch(error){entry.status=physicalBegan?'FAILED':'NOT_RUN';entry.error={message:error.message,stack:error.stack,execution:error.execution??null,lastObservation:error.lastObservation??null};if(!prepared)blocked=true;}
      finally{
        if(adapter.pointerDown){try{entry.failedCasePointerCleanup=await adapter.releaseOwnedPointer();}catch(error){entry.pointerCleanupError={message:error.message,execution:error.execution??null};blocked=true;}entry.status='FAILED';}
        if(prepareAttempted){
          if(entry.status!=='PASSED')try{entry.failedCaseEvidence=await adapter.call('checkpoint');}catch(error){entry.failedEvidenceError=error.message;}
          try{entry.finish=await adapter.call('finish');if(prepared)assert.equal(entry.finish.id,prepared.id);released(entry.finish);
            if(caseId.endsWith('-focus'))assert.deepEqual(entry.finish.focusControlRestoration,{status:'original-input-object-restored',type:'text'});
          }catch(error){entry.finishError=error.message;entry.status='FAILED';blocked=true;}
        }
        if(entry.status!=='PASSED'||adapter.inputDisabled)blocked=true;entry.finishedAt=new Date().toISOString();save();
      }
    }
    lane.status=lane.cases.length===13&&lane.cases.every(value=>value.status==='PASSED')?'PASSED':lane.cases.some(value=>value.status==='FAILED')?'FAILED':'NOT_RUN';lane.finishedAt=new Date().toISOString();save();
  }
  report.pageErrors=adapter.errors;assert.deepEqual(report.pageErrors,[]);
  report.status=report.locales.length===2&&report.locales.every(lane=>lane.status==='PASSED')?'PASSED':report.locales.some(lane=>lane.status==='FAILED')?'FAILED':'NOT_RUN';
}catch(error){report.error={message:error.message,stack:error.stack,execution:error.execution??null};if(report.physicalActions.length)report.status='FAILED';}
finally{
  if(adapter)try{await adapter.close();}catch(error){report.browserCleanupError={message:error.message,execution:error.execution??null};report.status='FAILED';}
  if(originalSource&&sourceHelper)try{report.restoration=await selectSource(originalSource);assert.equal(report.restoration.current.id,originalSource);}catch(error){report.restoration={status:'FAILED',error:error.message};report.status='FAILED';}
  try{
    if(report.source){report.sourceAfter={head:run('git',['rev-parse','HEAD']).stdout.trim(),trackedDirty:run('git',['status','--porcelain','--untracked-files=no']).stdout.trim(),pins:report.source.pins.map(value=>pin(value.path))};report.sourceUnchanged=JSON.stringify(report.source)===JSON.stringify(report.sourceAfter);report.sourceClean=report.source.trackedDirty===''&&report.sourceAfter.trackedDirty==='';
      if(report.broker){report.broker.configSha256After=hash(readFileSync(configPath));report.sourceUnchanged&&=report.broker.configSha256After===configHash;}}
    else{report.sourceUnchanged=false;report.sourceClean=false;}
    if((!report.sourceUnchanged||!report.sourceClean)&&report.status==='PASSED')report.status='FAILED';
    if(report.helperArtifacts){report.helperArtifactsAfter=report.helperArtifacts.map(value=>helperPin(value.path));report.helperArtifactsUnchanged=JSON.stringify(report.helperArtifactsAfter)===JSON.stringify(report.helperArtifacts);if(!report.helperArtifactsUnchanged&&report.status==='PASSED')report.status='FAILED';}
  }catch(error){report.sourceIdentityError=error.message;report.sourceUnchanged=false;if(report.status==='PASSED')report.status='FAILED';}
  report.finishedAt=new Date().toISOString();save();
}
console.log(JSON.stringify({output:outputPath,status:report.status,locales:report.locales.map(lane=>({locale:lane.locale,status:lane.status,cases:lane.cases.map(entry=>({caseId:entry.caseId,status:entry.status}))}))}));
process.exitCode=report.status==='PASSED'?0:report.status==='NOT_RUN'?2:1;
