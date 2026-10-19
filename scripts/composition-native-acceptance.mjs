// SPDX-License-Identifier: MIT OR Apache-2.0
// Closed installed macOS composition lane. No retries or input outside its fixture.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {computeSdkBuildIdentity} from './generate-sdk-types.mjs';
import {createSafariAdapter} from './composition-native/safari-adapter.mjs';
import {createInputOwner,prepareChromeWindow,fixedKeyScript} from './composition-native/input.mjs';
import {caseIds,limits,validCall} from './composition-native/protocol.mjs';
import {loadCompositionContract} from './composition-contract-data.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
const args=process.argv.slice(2),option=name=>{const at=args.indexOf(name);return at<0?null:args[at+1];};
const browserName=option('--browser'),output=option('--output'),brokerPath=option('--broker');
const usage='Usage: node scripts/composition-native-acceptance.mjs --browser chrome --output /absolute/fresh/report.json OR --browser safari --output /absolute/fresh/report.json --broker /absolute/fresh/broker/config.json';
const required=browserName==='chrome'?['--browser','--output']:browserName==='safari'?['--browser','--output','--broker']:[];
const names=args.filter((_,index)=>index%2===0);
if(args.length!==required.length*2||new Set(names).size!==required.length||!names.every(name=>required.includes(name))||!['chrome','safari'].includes(browserName)||!output?.startsWith('/'))throw Error(usage);
const outside=path=>{const actual=resolve(path);if(actual===root||actual.startsWith(root+'/'))throw Error('Installed evidence and broker config must be outside checkout');return actual;};
const outputPath=outside(output);
if(existsSync(outputPath))throw Error('Evidence output already exists; preserve the first result and use a fresh path');
mkdirSync(dirname(outputPath),{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const pin=path=>{const bytes=readFileSync(resolve(root,path));return {path,bytes:bytes.length,sha256:hash(bytes)};};
const helperPin=path=>{const bytes=readFileSync(path);return {path,bytes:bytes.length,sha256:hash(bytes),mode:(statSync(path).mode&0o7777).toString(8).padStart(4,'0')};};
const walk=path=>readdirSync(path,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(`${path}/${entry.name}`):entry.isFile()?[`${path}/${entry.name}`]:[]);
const {native,dom}=loadCompositionContract();
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const monotonic=()=>performance.now();
const report={format:'klenwriter-editor-installed-composition-native/1',browser:browserName,status:'NOT_RUN',startedAt:new Date().toISOString(),
  locales:[],setup:[],physicalActions:[],restoration:null,
  scope:'Actual installed macOS Chrome/Safari composition41: guarded System Events keys, US OptionE/E actual UA traces, packaged SDK2/sealed WASM, exact source-authored model/history/undo and object/recovery observations. Conditional Escape/blur dispositions are explicit. Not hardware-device, CJK/mobile/AT or independent-review evidence.'};
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
  config={nonce,origin:'http://127.0.0.1:4174',fixtureUrl:'http://127.0.0.1:4174/composition',title:'KlenWriter Composition native '+nonce};
}
const source=()=>JSON.parse(run(sourceHelper,['status']).stdout);
async function selectSource(id){
  const result=JSON.parse(run(sourceHelper,['select',id]).stdout);report.setup.push({action:'select-existing-input-source',...result});
  await wait(250);const actual=source();assert.equal(actual.current.id,id,'Existing source selection did not persist');selectedSource=id;return actual;
}
async function physical(action,entry){
  assert.equal(source().current.id,selectedSource,'Selected input source changed before action; no input sent');
  const before=await adapter.call('inspect');assert.equal(before.traceOverflow,false,'Complete action input trace required');
  const row={locale:entry.locale,caseId:entry.caseId,action,status:'attempted',startedAt:new Date().toISOString(),inputSourceBefore:source().current,inputTraceBefore:before.inputTraceCount};
  report.physicalActions.push(row);save();
  try{row.proof=await adapter.input(action);row.inputSourceAfter=source().current;assert.equal(row.inputSourceAfter.id,selectedSource,'Input source changed during action');row.status='completed';}
  catch(error){row.status='failed';row.error={message:error.message,execution:error.execution??null};throw error;}
  finally{row.finishedAt=new Date().toISOString();save();}
  return row;
}

async function chrome(){
  const childHome=mkdtempSync(resolve(dirname(outputPath),'chrome-composition-appdata-'));
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
      const value=await window.compositionNative[method](...args);
      return method==='guard'?{...value,nonce,url:location.href,title:document.title,documentFocused:document.hasFocus()}:value;
    },{method,args,nonce:config.nonce,url:config.fixtureUrl,title:config.title});
      if(method==='prepare'){assert.match(value.id,/^composition-mount-[1-9][0-9]{0,8}$/);mountedId=value.id;}
      if(method==='finish')mountedId=null;return value;
    }finally{busy=false;}
  };
  const inputOwner=createInputOwner({browser:'chrome',config,inputHelper,keyScriptPath,run,record,mountedId:()=>mountedId,guard:async action=>{
    const start=process.hrtime.bigint(),value=await call('guard',action);
    assert.equal(value.url,config.fixtureUrl);assert.equal(value.title,config.title);
    return {id:config.nonce+':'+String(serial),start,value:{...value,mountedId,serial:++guardSerial}};
  }});
  report.control={method:'Installed headed Chrome; closed Playwright page setup/read RPC, strict AX preflight and fixed System Events composition keys',webDriver:false,
    uniqueTitle:config.title,fixtureUrl:config.fixtureUrl,fixtureOnly:true,childOnlyEnvironment:true,launchArguments};
  return {errors,input:action=>{assert.equal(bootstrapReady,true,'Strict Chrome window bootstrap required before input');physicalStarted=true;return inputOwner.input(action);},releaseOwnedPointer:()=>inputOwner.releaseOwnedPointer(),
    releaseOwnedKeys:()=>inputOwner.releaseOwnedKeys(),get keysPending(){return inputOwner.keysPending;},
    get pointerDown(){return inputOwner.pointerDown;},get pointerState(){return inputOwner.pointerState;},get inputDisabled(){return inputOwner.disabled;},
    async navigate(){
      assert.equal(navigationStarted,false,'Chrome bootstrap cannot be retried');assert.equal(physicalStarted,false);navigationStarted=true;
      const response=await page.goto(config.fixtureUrl);assert.ok(response?.ok(),'Selection fixture server unavailable');
      await page.waitForFunction(()=>window.compositionHostReady===true,null,{timeout:15000});
      await page.evaluate(async title=>{document.title=title;await import('/composition-native-host.js');},config.title);
      await page.bringToFront();script('tell application "Google Chrome" to activate');await page.waitForFunction(()=>document.hasFocus(),null,{timeout:5000});
      report.control.bootstrap=await prepareChromeWindow({config,record,
        pageState:()=>page.evaluate(()=>{
          const prefix='KlenWriter Composition native ',v=visualViewport,selection=getSelection();
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


const byId=id=>{const c=native.cases.find(x=>x.id===id);assert.ok(c,'Frozen native family missing');return c;};
const rolePoint=(ids,p)=>p.kind==='text'?{kind:'text',node:ids[p.node],offset:p.offset,affinity:p.affinity}:p.kind==='child'?{kind:'child',parent:ids[p.parent],index:p.index,affinity:p.affinity}:{kind:'edge',node:ids[p.node],side:p.side};
const roleSelection=(ids,s)=>s===null?null:{anchor:rolePoint(ids,s.anchor),focus:rolePoint(ids,s.focus)};
function expectedState(actual,literal,ids){const expected=structuredClone(literal);expected.root=ids[literal.root];expected.selection=roleSelection(ids,literal.selection);expected.stamp.session=actual.stamp.session;expected.stamp.generation=actual.stamp.generation;expected.history.retained_bytes=actual.history.retained_bytes;assert.match(actual.history.retained_bytes,/^(0|[1-9][0-9]*)$/);assert.deepEqual(actual,expected);}
function released(value){const r=value.resources;for(const key of ['listeners','observers','continuations','retainedInputBytes','retainedRecoveryRegions'])assert.equal(r.dom[key],0,'Disposed DOM '+key);assert.deepEqual(r.selection,{bookmarks:0,restoreTickets:0,activePointers:0,animationFrames:0});assert.deepEqual(r.clipboard,{pending:0,continuations:0,retainedTextBytes:0});for(const key of ['sessions','listeners','queued_mutations','queued_bytes','pending_tickets','host_requests','task_continuations'])assert.equal(r.sdk[key],0,'Disposed SDK '+key);assert.deepEqual(value.nativeFinal,{sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});assert.deepEqual(value.errors,[]);assert.deepEqual(value.policyViolations,[]);}
async function checkpoint(entry,label){const v=await adapter.call('checkpoint');entry.checkpoints.push({label,value:v});save();return v;}
function keyAck(value,action,code,{alt=false,shift=false}={}){assert.equal(value.traceOverflow,false,'Complete physical action trace required');assert.ok(Number.isSafeInteger(action.inputTraceBefore)&&action.inputTraceBefore>=0);for(const event of ['keydown','keyup'])assert.ok(value.inputTrace.slice(action.inputTraceBefore).some(x=>x.event===event&&x.code===code&&x.isTrusted===true&&x.alt===alt&&x.shift===shift),`Actual trusted ${event}/${code} required for ${action.action}`);}
function literalTree(actual,literal){assert.equal(actual.nodeType,literal.nodeType);if(literal.nodeType===3){assert.equal(actual.data,literal.data);return;}assert.equal(actual.tag,literal.tag);for(const [key,value]of Object.entries(literal.attributes))assert.equal(actual.attributes[key],value,'Literal DOM attribute '+key);assert.equal(actual.children.length,literal.children.length);actual.children.forEach((child,i)=>literalTree(child,literal.children[i]));}
function literalDom(actual,literal){assert.equal(actual.length,literal.length);actual.forEach((node,i)=>literalTree(node,literal[i]));}
function presentation(family){const id=family+'-forward',installed=dom.installedLiteralBranches.find(x=>x.nativeCase===id);if(installed)return {dom:installed.expectedCommittedDom,selection:installed.finalDomSelection,outside:installed.outsideActualObjectsUnchanged};const controlled=dom.cases.find(x=>x.nativeCase===id&&x.expected?.committedDom);assert.ok(controlled,'Frozen presentation required for '+family);return {dom:controlled.expected.committedDom,selection:controlled.expected.finalDomSelection,outside:controlled.expected.outsideActualObjectsUnchanged};}
async function committed(entry,prepared,family){const literal=byId(family+'-forward'),after=await checkpoint(entry,'committed');assert.equal(after.canonical,literal.after_canonical_json);expectedState(after.state,literal.after_state,prepared.before.roles);assert.equal(after.events.filter(x=>x.change.kind==='document').length-prepared.before.events.filter(x=>x.change.kind==='document').length,1,'Exactly one native document publication');
  for(const role of literal.identity.retained_live){const id=prepared.before.roles[role];assert.ok(after.rows.some(x=>x.node.id===id),'Retained native '+role);}for(const role of literal.identity.retired_old)assert.ok(!after.rows.some(x=>x.node.id===prepared.before.roles[role]),'Retired native '+role);
  for(const role of literal.identity.unchanged_outside_roles??[]){const id=prepared.before.roles[role],a=after.rows.find(x=>x.node.id===id).node,b=prepared.before.rows.find(x=>x.node.id===id).node;for(const key of ['id','type_id','attributes','marks','text','children'])assert.deepEqual(a[key],b[key],'Outside native '+role+'/'+key);}
  assert.equal(after.lifecycle,'ready');assert.equal(after.recovery,null);assert.deepEqual(after.errors,[]);assert.equal(after.traceOverflow,false);
  const rendered=presentation(family);literalDom(after.dom,rendered.dom);
  for(const role of rendered.outside){assert.equal(after.objects[role]?.connected,true,'Actual outside object '+role);assert.deepEqual(after.objects[role].attributes,prepared.before.objects[role].attributes);assert.equal(after.objects[role].text,prepared.before.objects[role].text);}
  assert.equal(after.rawDom.inside,true);for(const edge of ['anchor','focus']){const expected=rendered.selection[edge];assert.deepEqual(after.rawDom[edge].path,expected.path);assert.equal(after.rawDom[edge].nodeType,expected.nodeType);assert.equal(after.rawDom[edge].offset,expected.offsetUtf16);}
  if(family==='P17')for(const role of ['P','T_outer','T_mark','BR','C_outer','C_mark','C_text'])assert.equal(after.objects[role]?.connected,true,'Marked/hardbreak object '+role);
  assert.equal(after.trace.filter(x=>x.kind==='dom-write'&&x.writer==='adapter'&&x.phase==='composing'&&x.insideWindow).length,0,'No adapter writes into active UA subtree');
  assert.equal((await adapter.call('undo')).response?.status,'ok');const undo=await checkpoint(entry,'undo');assert.equal(undo.canonical,literal.undo.canonical_json);expectedState(undo.state,literal.undo.state,prepared.before.roles);assert.deepEqual(new Set(undo.rows.map(x=>x.node.id)),new Set(prepared.before.rows.map(x=>x.node.id)),'Undo exact historical IDs');
  assert.equal((await adapter.call('redo')).response?.status,'ok');const redo=await checkpoint(entry,'redo');assert.equal(redo.canonical,literal.redo.canonical_json);expectedState(redo.state,literal.redo.state,prepared.before.roles);return after;
}
async function performCase(entry,prepared){
  if(entry.caseId==='ordinary-layout'){const action=await physical(entry.locale==='en'?'ordinary-en':'ordinary-ru',entry);const after=await adapter.call('settle');keyAck(after,action,'KeyZ',{shift:entry.locale==='en'});entry.disposition='ordinary_layout_not_IME';await committed(entry,prepared,entry.locale==='en'?'P01':'P02');return;}
  const start=await physical('deadkey-acute',entry),preedit=await checkpoint(entry,'actual US OptionE preedit');keyAck(preedit,start,'KeyE',{alt:true});assert.ok(preedit.inputTrace.slice(start.inputTraceBefore).some(x=>x.event==='compositionstart'&&x.isTrusted),'Actual UA compositionstart required');
  assert.equal(preedit.lifecycle,'ready','Preedit must remain admitted before further physical input');assert.equal(preedit.recovery,null,'No further physical input after provisional recovery');
  if(['plain-deadkey','marked-deadkey','scene-deadkey'].includes(entry.caseId)){
    const action=await physical('complete-e',entry),final=await adapter.call('settle');keyAck(final,action,'KeyE');assert.ok(final.inputTrace.slice(action.inputTraceBefore).some(x=>x.event==='compositionend'),'Actual UA compositionend required');entry.disposition='fixed_precomposed_e_acute_positive';await committed(entry,prepared,prepared.family);return;
  }
  if(entry.caseId==='escape-preedit'){const action=await physical('escape',entry);keyAck(await checkpoint(entry,'actual Escape'),action,'Escape');}
  else{const blur=await physical('shift-tab',entry);keyAck(await checkpoint(entry,'physical focus departure'),blur,'Tab',{shift:true});for(let i=0;i<5;i++){await wait(100);const v=await checkpoint(entry,'external focus stable'+i);assert.equal(v.activeElementId,'composition-host-control','No focus theft while UA owns preedit');}const refocus=await physical('tab',entry),focused=await checkpoint(entry,'physical refocus');keyAck(focused,refocus,'Tab');assert.equal(focused.activeElementId,prepared.id);}
  const final=await adapter.call('settle');entry.checkpoints.push({label:'conditional actual final',value:final});
  if(final.canonical===prepared.before.canonical&&final.lifecycle==='ready'){
    const literal=dom.installedUnchangedBranches[entry.caseId==='escape-preedit'?'I05':'I06'];literalDom(final.dom,literal.actualDomMustEqual);assert.deepEqual(final.dom,prepared.before.dom,'Complete original DOM metadata correspondence');
    for(const field of ['root','dirty','saved_revision'])assert.deepEqual(final.state[field],prepared.before.state[field]);for(const field of ['session','generation','revision'])assert.equal(final.state.stamp[field],prepared.before.state.stamp[field]);assert.deepEqual(final.state.history,prepared.before.state.history,'No document undo/redo/history ownership change');assert.deepEqual(final.state.selection,prepared.before.state.selection);assert.deepEqual(final.rows.map(x=>({...x.node,stamp:null})),prepared.before.rows.map(x=>({...x.node,stamp:null})),'Original model IDs/payload/metadata unchanged');assert.equal(final.events.filter(x=>x.change.kind==='document').length,prepared.before.events.filter(x=>x.change.kind==='document').length);assert.equal(final.resources.dom.continuations,0);assert.equal(final.uaComposition.open,false);assert.ok(final.uaComposition.ends>0);assert.equal(final.recovery,null);
    for(const [role,before]of Object.entries(prepared.before.objects))if(before.attributes!==null||['O_text','C_text'].includes(role)){assert.equal(final.objects[role]?.connected,true,'Original cancel object '+role);assert.deepEqual(final.objects[role].attributes,before.attributes);assert.equal(final.objects[role].text,before.text);}
    entry.cancelStateOnlyObservation={selection_epoch:final.state.stamp.selection_epoch,history_epoch:final.state.stamp.history_epoch,stored_marks:final.state.stored_marks};entry.disposition='observed_complete_unchanged_cancel';}
  else if(final.canonical===byId(prepared.family+'-forward').after_canonical_json){entry.disposition='observed_exact_spacing_acute_commit';await committed(entry,prepared,prepared.family);}
  else{assert.equal(final.lifecycle,'recoveryRequired','Unlisted changed input must be explicit recovery');assert.ok(final.recovery&&(final.recovery.regionKind==='retained_dom'||typeof final.recovery.provisionalText==='string'),'Actual input retained');entry.disposition='other_changed_retained_recovery_not_fixed_positive';entry.actualConditional=final;}
}

try{
  assert.equal(process.platform,'darwin','Installed native acceptance requires macOS');assert.equal(process.version,'v24.22.0','Pinned acceptance Node');report.nodeVersion=process.version;
  report.os={productVersion:run('/usr/bin/sw_vers',['-productVersion']).stdout.trim(),buildVersion:run('/usr/bin/sw_vers',['-buildVersion']).stdout.trim()};
  const identity=computeSdkBuildIdentity(),built=JSON.parse(readFileSync('artifacts/sdk-build-identity.json','utf8'));assert.equal(built.buildId,identity.buildId,'Build exact current production source before installed input');assert.deepEqual(built.sourceHashes,identity.sourceHashes);
  report.buildId=identity.buildId;
  const paths=[...new Set([...Object.keys(identity.sourceHashes),...walk('contracts/composition'),...walk('scripts/composition-native'),
    ...walk('packages/wasm/dist'),...walk('packages/sdk/dist'),...walk('packages/dom/dist'),...walk('packages/kwdj/dist'),
    'scripts/composition-native-acceptance.mjs','scripts/composition-native-input.swift','scripts/dom-native-input-source.swift','spikes/workspace/composition-native-host.js',
    'spikes/workspace/composition-host.js','spikes/workspace/composition.css','spikes/workspace/composition.html','scripts/workspace-server.mjs','artifacts/sdk-build-identity.json',
    'scripts/composition-contract-data.mjs','scripts/composition-csp-policy.mjs','scripts/selection-native/protocol.mjs','artifacts/sdk-native-manifest.json','artifacts/sdk-native-manifest-v2.json','artifacts/sdk-wasm-seal.json'])].sort();
  report.source={head:run('git',['rev-parse','HEAD']).stdout.trim(),trackedDirty:run('git',['status','--porcelain','--untracked-files=no']).stdout.trim(),pins:paths.map(pin)};
  const seal=JSON.parse(readFileSync('artifacts/sdk-wasm-seal.json','utf8'));assert.equal(seal.build_id,identity.buildId);assert.equal(seal.sealed_sha256,pin('packages/wasm/dist/editor_wasm_bg.wasm').sha256);
  const bundle=browserName==='chrome'?'/Applications/Google Chrome.app/Contents/Info.plist':'/Applications/Safari.app/Contents/Info.plist';
  assert.ok(existsSync(bundle),'Installed browser bundle required');report.bundleVersion=run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',bundle]).stdout.trim();report.bundleBuild=run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleVersion',bundle]).stdout.trim();
  const accessibility=script('tell application "System Events" to get UI elements enabled').stdout.trim();report.setup.push({action:'read-existing-ui-automation-availability',value:accessibility});assert.equal(accessibility,'true','Existing Accessibility permission required; no request/grant flow');
  const helperDirectory=mkdtempSync(resolve(dirname(outputPath),'composition-native-helpers-'));sourceHelper=resolve(helperDirectory,'input-source');inputHelper=resolve(helperDirectory,'fixture-input');
  const keySourcePath=resolve(helperDirectory,'fixture-keys.applescript');keyScriptPath=resolve(helperDirectory,'fixture-keys.scpt');
  writeFileSync(keySourcePath,fixedKeyScript,{flag:'wx'});
  report.setup.push({action:'write-fixed-key-script-source',source:helperPin(keySourcePath),scope:'Exact fixed program; compile once before browser/input/page guards'});
  report.setup.push({action:'compile-closed-source-helpers',executions:[run('/usr/bin/swiftc',[resolve(root,'scripts/dom-native-input-source.swift'),'-O','-o',sourceHelper]),run('/usr/bin/swiftc',[resolve(root,'scripts/composition-native-input.swift'),'-O','-o',inputHelper]),run('/usr/bin/osacompile',['-o',keyScriptPath,keySourcePath])],sourceHelper,inputHelper,keySourcePath,keyScriptPath});
  chmodSync(keyScriptPath,0o444);
  const readonlyKeyScript=helperPin(keyScriptPath);assert.equal(readonlyKeyScript.mode,'0444','Compiled key script must be read-only before browser/input');
  report.setup.push({action:'lock-fixed-key-script',artifact:readonlyKeyScript,scope:'No compiled runtime-state persistence; exact bytes/hash/mode remain required before and after input'});
  report.helperArtifacts=[sourceHelper,inputHelper,keySourcePath,keyScriptPath].map(helperPin);
  const initial=source();report.inputSources=initial;originalSource=initial.current.id;
  const russian='com.apple.keylayout.Russian';assert.ok(initial.sources.some(row=>row.id===russian&&row.enabled&&row.selectable),'Frozen installed matrix requires existing enabled/selectable Russian source');
  adapter=await(browserName==='chrome'?chrome():createSafariAdapter({config,report,run,outputPath,inputHelper,keyScriptPath}));await adapter.navigate();

  assert.equal(report.bundleVersion,browserName==='chrome'?'155.0.8059.85':'27.0.1','Pinned installed browser version');
  let blocked=false;
  for(const [locale,inputSourceId]of [['en','com.apple.keylayout.US'],['ru',russian]]){
    const lane={locale,inputSourceId,status:'NOT_RUN',cases:[]};report.locales.push(lane);
    if(!blocked){await adapter.focus();await selectSource(inputSourceId);}
    for(const caseId of caseIds){const entry={locale,caseId,status:'NOT_RUN',checkpoints:[],startedAt:new Date().toISOString()};lane.cases.push(entry);save();if(blocked){entry.reason='Earlier failure disables physical input';continue;}
      let prepared=null,prepareAttempted=false,priorLayout=null;
      try{priorLayout=source().current.id;if(caseId!=='ordinary-layout')await selectSource('com.apple.keylayout.US');prepareAttempted=true;prepared=await adapter.call('prepare',locale,caseId);entry.prepared=prepared;assert.equal(prepared.before.context.build_id,identity.buildId);await performCase(entry,prepared);entry.status='PASSED';}
      catch(error){entry.status=prepared?'FAILED':'NOT_RUN';entry.error={message:error.message,stack:error.stack,execution:error.execution??null};blocked=true;}
      finally{if(adapter.keysPending){try{entry.failedOwnedKeyCleanup=await adapter.releaseOwnedKeys();}catch(error){entry.keyCleanupError=error.message;}entry.status='FAILED';blocked=true;}
        if(prepareAttempted){if(entry.status!=='PASSED')try{entry.failedCaseEvidence=await adapter.call('checkpoint');}catch(error){entry.failedEvidenceError=error.message;}try{entry.finish=await adapter.call('finish');released(entry.finish);}catch(error){entry.finishError=error.message;entry.status='FAILED';blocked=true;}}
        if(priorLayout)try{entry.layoutRestoration=await selectSource(priorLayout);}catch(error){entry.layoutRestorationError=error.message;entry.status='FAILED';blocked=true;}
        if(entry.status!=='PASSED'||adapter.inputDisabled)blocked=true;entry.finishedAt=new Date().toISOString();save();}
    }
    lane.status=lane.cases.length===6&&lane.cases.every(x=>x.status==='PASSED')?'PASSED':lane.cases.some(x=>x.status==='FAILED')?'FAILED':'NOT_RUN';save();
  }
  report.pageErrors=adapter.errors;assert.deepEqual(report.pageErrors,[]);report.status=report.locales.length===2&&report.locales.every(x=>x.status==='PASSED')?'PASSED':'FAILED';
}
catch(error){report.error={message:error.message,stack:error.stack,execution:error.execution??null};if(report.physicalActions.length)report.status='FAILED';}
finally{
  if(adapter)try{await adapter.close();}catch(error){report.browserCleanupError={message:error.message,execution:error.execution??null};report.status='FAILED';}
  if(originalSource&&sourceHelper)try{report.restoration=await selectSource(originalSource);}catch(error){report.restoration={status:'FAILED',error:error.message};report.status='FAILED';}
  try{if(report.source){report.sourceAfter={head:run('git',['rev-parse','HEAD']).stdout.trim(),trackedDirty:run('git',['status','--porcelain','--untracked-files=no']).stdout.trim(),pins:report.source.pins.map(x=>pin(x.path))};report.sourceUnchanged=JSON.stringify(report.source)===JSON.stringify(report.sourceAfter);report.sourceClean=report.source.trackedDirty===''&&report.sourceAfter.trackedDirty==='';if(report.broker){report.broker.configSha256After=hash(readFileSync(configPath));report.sourceUnchanged&&=report.broker.configSha256After===configHash;}}else{report.sourceUnchanged=false;report.sourceClean=false;}if(report.helperArtifacts){report.helperArtifactsAfter=report.helperArtifacts.map(x=>helperPin(x.path));report.helperArtifactsUnchanged=JSON.stringify(report.helperArtifacts)===JSON.stringify(report.helperArtifactsAfter);}if(!report.sourceUnchanged||!report.sourceClean||!report.helperArtifactsUnchanged)report.status='FAILED';}catch(error){report.sourceIdentityError=error.message;report.status='FAILED';}
  report.finishedAt=new Date().toISOString();save();
}
console.log(JSON.stringify({output:outputPath,status:report.status}));process.exitCode=report.status==='PASSED'?0:report.status==='NOT_RUN'?2:1;
