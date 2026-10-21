// SPDX-License-Identifier: MIT OR Apache-2.0
// Closed44 installed proof. Preparation/RPC/control evidence is never native input proof.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {computeSdkBuildIdentity} from './generate-sdk-types.mjs';
import {createChromeAdapter} from './drag-installed/chrome-adapter.mjs';
import {createSafariAdapter} from './drag-installed/safari-adapter.mjs';
import {createReportWriter} from './drag-installed/report-writer.mjs';
import {caseIds,keySpecs,pointerActions,limits} from './drag-installed/protocol.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);
const args=process.argv.slice(2),names=['--browser','--output','--broker','--head','--expected-version'];
assert.equal(args.length,10);assert.equal(new Set(args.filter((_,i)=>i%2===0)).size,5);assert.ok(args.filter((_,i)=>i%2===0).every(x=>names.includes(x)));
const option=name=>args[args.indexOf(name)+1],browser=option('--browser'),head=option('--head');assert.ok(['chrome','safari'].includes(browser));assert.match(head,/^[a-f0-9]{40}$/);
assert.equal(process.env.CFFIXED_USER_HOME,undefined,'Parent uses actual existing user environment');
const outside=value=>{assert.ok(value.startsWith('/'));const path=resolve(value);assert.ok(path!==root&&!path.startsWith(root+'/'));return path;};
const output=outside(option('--output')),configPath=outside(option('--broker'));assert.equal(existsSync(output),false);mkdirSync(dirname(output),{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),now=()=>new Date().toISOString(),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const pin=path=>{const bytes=readFileSync(resolve(root,path));return{path,bytes:bytes.length,sha256:hash(bytes),mode:(statSync(resolve(root,path)).mode&0o7777).toString(8).padStart(4,'0')};};
const walk=path=>readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path+'/'+e.name):e.isFile()?[path+'/'+e.name]:[]);
const programs=JSON.parse(readFileSync('contracts/drag/v1/installed-programs.json','utf8'));
const report={format:'editor-drag-installed/1',browser,expectedHead:head,status:'NOT_RUN',startedAt:now(),rows:programs.rows.map(row=>({...row,status:'NOT_RUN',actions:[],checkpoints:[]})),setup:[],physicalActions:[],restoration:null,
  scope:'Sixteen source-authored installed44 core rows. CGEvent platform provenance, not hardware. Separate controlled composition/external boundaries and manual usability remain separately qualified.',
  separateBoundaries:programs.separate_boundaries,historyObservability:{publicFields:['undo_entries','redo_entries','retained_bytes'],openTypingGroup:'NOT_EXPOSED; original isolated request plus exact one-unit Undo/Redo is observed'}};
const recorder=createReportWriter({output,report}),save=recorder.save;save();
function run(command,argv,{fullStdout=false,timeout=30000,maxBuffer=1048576}={}){
  const start=process.hrtime.bigint(),value=spawnSync(command,argv,{cwd:root,encoding:'utf8',timeout,maxBuffer});
  const execution={command,argv,returnCode:value.status,signal:value.signal,error:value.error?.message??null,stdout:fullStdout?(value.stdout??''):(value.stdout??'').slice(0,16384),stderr:(value.stderr??'').slice(0,8192),wallTimeMs:Number(process.hrtime.bigint()-start)/1e6};
  if(value.status!==0||value.error)throw Object.assign(Error(command+': '+(execution.stderr||execution.error||execution.stdout)),{execution});return execution;
}
let adapter=null,sourceHelper=null,inputHelper=null,originalSource=null,selectedSource=null,config=null,identity=null;
const source=()=>JSON.parse(run(sourceHelper,['status'],{fullStdout:true}).stdout);
function coherent(value,id){assert.equal(value.status,'ok');assert.equal(value.current.id,id);for(const key of ['selected','enabled','selectable'])assert.equal(value.current[key],true);assert.ok(value.sources.some(x=>x.id===id&&x.selected&&x.enabled&&x.selectable));}
async function ensureSource(id){const before=source();coherent(before,before.current.id);if(before.current.id!==id){const execution=run(sourceHelper,['select',id],{fullStdout:true});report.setup.push({action:'select-existing-source',before,execution});await wait(250);}const actual=source();coherent(actual,id);selectedSource=id;return actual;}
function clean(c){assert.equal(c.overflow,false);assert.deepEqual(c.policy,[]);assert.deepEqual(c.errors,[]);if(c.nativeTrace){assert.equal(c.nativeTrace.enabled,true);assert.equal(c.nativeTrace.overflow,false);}assert.equal(c.facts.resources.sdk.callback_errors,0);}
const nativeCalls=(c,from=0)=>c.nativeTrace.calls.slice(from).map(row=>({raw:row,request:JSON.parse(row.requestJson),response:JSON.parse(row.responseJson)}));
const commands=(a,b)=>nativeCalls(a,b.nativeTrace.calls.length).filter(x=>x.request.kind==='command');
const resolveRoles=(value,roles)=>Array.isArray(value)?value.map(v=>resolveRoles(v,roles)):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,['node','parent'].includes(k)&&typeof v==='string'&&roles[v]?roles[v]:resolveRoles(v,roles)])):value;
function idle(c){assert.equal(c.native.uiResources.dragGestures,0);assert.equal(c.native.uiResources.pointerCaptures,0);assert.equal(c.native.uiResources.hostRequests,0);assert.deepEqual(c.native.resources.hostRequests,{pending:0,focusContinuations:0});assert.equal(c.native.resources.selection.bookmarks,0);}
function unchanged(a,b){assert.equal(a.native.canonical,b.native.canonical);assert.deepEqual(a.native.state,b.native.state);assert.deepEqual(a.native.rows,b.native.rows);assert.deepEqual(a.native.events,b.native.events);assert.deepEqual(commands(a,b),[]);}
function structure(a,b,paths){
  assert.equal(a.native.rows.length,Object.keys(paths).length);assert.deepEqual(a.native.rows.map(x=>x.node.id).sort(),b.native.rows.map(x=>x.node.id).sort());
  for(const [role,path]of Object.entries(paths)){
    const row=a.native.rows.find(x=>JSON.stringify(x.path)===JSON.stringify(path));assert.ok(row,role);assert.equal(row.node.id,b.native.roles[role]);const old=b.native.rows.find(x=>x.node.id===row.node.id).node;
    for(const field of ['type_id','primitive','attributes','marks','text'])assert.deepEqual(row.node[field],old[field]);
    assert.deepEqual(row.node.stamp,a.native.state.stamp);assert.ok(BigInt(row.node.changed_revision)>=BigInt(old.changed_revision)&&BigInt(row.node.changed_revision)<=BigInt(a.native.state.stamp.revision));
    const parent=path.length?Object.entries(paths).find(([,p])=>JSON.stringify(p)===JSON.stringify(path.slice(0,-1)))[0]:null;assert.equal(row.node.parent,parent?b.native.roles[parent]:null);
    const children=Object.entries(paths).filter(([,p])=>p.length===path.length+1&&p.slice(0,-1).every((n,i)=>n===path[i])).sort((x,y)=>x[1].at(-1)-y[1].at(-1)).map(([role])=>b.native.roles[role]);assert.deepEqual(row.node.children,children);
    const descendants=Object.entries(paths).filter(([,p])=>p.length>=path.length&&path.every((n,i)=>n===p[i]));let utf8=0,utf16=0,height=0;for(const [name,p]of descendants){const original=b.native.rows.find(x=>x.node.id===b.native.roles[name]).node,text=original.text??'';utf8+=Buffer.byteLength(text);utf16+=text.length;height=Math.max(height,p.length-path.length+(path.length?1:0));}assert.deepEqual(row.node.stats,{authored_nodes:String(descendants.length-(path.length?0:1)),text_utf8:String(utf8),text_utf16:String(utf16),height:String(height)},'Source-derived complete topology/text metrics');
  }
}
function chronology(a,b,{r=1n,s=0n,h=1n,undo='1',redo='0'}={}){
  for(const field of ['session','generation'])assert.equal(a.native.state.stamp[field],b.native.state.stamp[field]);
  for(const [field,n]of [['revision',r],['selection_epoch',s],['history_epoch',h]])assert.equal(BigInt(a.native.state.stamp[field])-BigInt(b.native.state.stamp[field]),n,field);
  assert.deepEqual(a.native.state.selection,b.native.state.selection);assert.deepEqual(a.native.state.stored_marks,b.native.state.stored_marks);assert.equal(a.native.state.history.undo_entries,undo);assert.equal(a.native.state.history.redo_entries,redo);
  assert.deepEqual(Object.keys(a.native.state.history).sort(),['redo_entries','retained_bytes','undo_entries']);assert.ok(BigInt(a.native.state.history.retained_bytes)<=33554432n);assert.equal(a.native.state.saved_revision,b.native.state.saved_revision);assert.equal(a.native.state.dirty,true);
  assert.equal(a.native.events.filter(x=>x.change.kind==='document').length-b.native.events.filter(x=>x.change.kind==='document').length,1);assert.deepEqual(a.native.events.filter(x=>x.change.kind==='state'),b.native.events.filter(x=>x.change.kind==='state'));
}
async function checkpoint(row,label){const value=await adapter.call('checkpoint');clean(value);row.checkpoints.push({label,value});save();return value;}
async function physical(row,action,{reserved=false}={}){
  coherent(source(),selectedSource);const before=await adapter.call('inspect'),entry={caseId:row.id,locale:row.locale,action,status:'attempted',startedAt:now(),eventOffset:before.eventCount};row.actions.push(entry);report.physicalActions.push(entry);save();
  try{
    entry.platform=await adapter.input(action);entry.status='platform_completed';coherent(source(),selectedSource);
    // Retain only existing passive replies: initial inspection plus at most the
    // original five 20 ms polls. This record does not participate in admission.
    const spec=keySpecs[action],phase=spec?'keyup':action==='down'?'pointerdown':action==='up'?'pointerup':'pointermove';
    const requested=entry.platform.request,posted=entry.platform.actual;
    entry.passiveCorrelation={eventOffset:entry.eventOffset,beforeClock:before.clock,beforeEventArrayLength:before.events.length,phase,code:spec?.domCode??null,originalPointerId:row.pointerId??null,
      requestId:requested.requestId,serial:requested.serial,point:requested.point,
      constructorTimestampNs:posted.constructorTimestampNs??null,postUptimeNs:posted.postUptimeNs??null};
    entry.passiveInspections=[];
    const retainInspection=value=>{
      const index=value.events.findLastIndex(event=>event.name===phase&&event.isTrusted
        &&(spec?event.code===spec.domCode:event.pointerType==='mouse'&&event.isPrimary===true));
      const event=index<0?null:value.events[index],point=requested.point;
      entry.passiveInspections.push({inspection:entry.passiveInspections.length,receivedAt:now(),clock:value.clock,
        eventCount:value.eventCount,eventArrayLength:value.events.length,overflow:value.overflow,pointer:value.pointer,
        lastMatchingPhase:event?{index,sinceOffset:index>=entry.eventOffset,name:event.name,at:event.at,timeOrigin:event.timeOrigin,eventTimeStamp:event.eventTimeStamp??null,
          pointerId:event.pointerId,pointerType:event.pointerType,isPrimary:event.isPrimary,button:event.button,buttons:event.buttons,x:event.x,y:event.y,
          code:event.code,withinRoot:event.withinRoot??null,originalHeldPointer:event.originalHeldPointer??null,
          sameOriginalPointer:row.pointerId===undefined?null:event.pointerId===row.pointerId,
          matchesRequestedPoint:point?Math.abs(event.x-point.x)<=1&&Math.abs(event.y-point.y)<=1:null}:null});
    };
    let actual=await adapter.call('inspect');retainInspection(actual);
    // Passive acknowledgement only, no input replay or authority refresh.
    for(let i=0;i<5;i++){
      const events=actual.events.slice(entry.eventOffset),spec=keySpecs[action];
      const seen=spec?events.some(e=>e.name==='keyup'&&e.isTrusted&&e.code===spec.domCode):events.some(e=>e.name===(action==='down'?'pointerdown':action==='up'?'pointerup':'pointermove')&&e.isTrusted);
      if(seen||reserved)break;await wait(20);actual=await adapter.call('inspect');retainInspection(actual);
    }
    const events=actual.events.slice(entry.eventOffset);entry.dom=events;
    if(keySpecs[action]){
      const spec=keySpecs[action];if(reserved)entry.domQualification='Reserved OS shortcut: platform core and measured zoom; no invented DOM ACK';
      else {assert.ok(events.some(e=>e.name==='keydown'&&e.isTrusted&&e.code===spec.domCode&&e.metaKey===spec.modifiers.includes('command')&&e.shiftKey===spec.modifiers.includes('shift')),'Actual matching trusted keydown');assert.ok(events.some(e=>e.name==='keyup'&&e.isTrusted&&e.code===spec.domCode),'Actual matching trusted keyup');}
    }else{
      const name=action==='down'?'pointerdown':action==='up'?'pointerup':'pointermove',matches=events.filter(e=>e.name===name&&e.isTrusted&&e.pointerType==='mouse'&&e.isPrimary===true);
      assert.ok(matches.length>0,'Actual trusted original pointer phase');
      const expected=entry.platform.request.point;assert.ok(matches.some(e=>Math.abs(e.x-expected.x)<=1&&Math.abs(e.y-expected.y)<=1),'Actual fixed point acknowledgement');
      for(const e of matches){
        for(const modifier of ['altKey','ctrlKey','shiftKey','metaKey'])assert.equal(e[modifier],false,'Actual unmodified pointer phase: '+modifier);
        assert.equal(e.buttons,['hover-source','move-start','up'].includes(action)?0:1);if(['down','up'].includes(action))assert.equal(e.button,0);
      }
      if(action==='down'){assert.equal(matches.length,1);assert.equal(matches[0].handleHit,true,'Actual original handle/descendant Down');row.pointerId=matches[0].pointerId;}
      if(row.pointerId!==undefined&&!['hover-source','move-start'].includes(action))for(const e of matches)assert.equal(e.pointerId,row.pointerId);
    }
    entry.status='completed';return actual;
  }catch(error){entry.status='FAILED';entry.error={message:error.message,execution:error.execution??null};throw error;}
  finally{entry.finishedAt=now();save();}
}
async function history(row,before,after,fixture){
  const undo=await adapter.call('setup','undo');assert.equal(undo.response.status,'ok');assert.equal(undo.response.value.effect,'changed');const undone=await checkpoint(row,'one actual Undo');
  assert.equal(undone.native.canonical,fixture.input);structure(undone,before,fixture.roles_before);chronology(undone,after,{undo:'0',redo:'1'});assert.deepEqual(commands(undone,after),[]);
  const redo=await adapter.call('setup','redo');assert.equal(redo.response.status,'ok');assert.equal(redo.response.value.effect,'changed');const redone=await checkpoint(row,'one actual Redo');
  assert.equal(redone.native.canonical,fixture.after);structure(redone,before,fixture.roles_after);chronology(redone,undone);assert.deepEqual(commands(redone,undone),[]);idle(redone);
}
async function perform(row,prepared){
  const family=programs.families.find(x=>x.id===row.family),fixture=programs.fixtures[family.fixture],before=prepared.baseline;
  clean(before);assert.equal(before.native.canonical,fixture.input);assert.deepEqual(before.native.state.selection,resolveRoles(fixture.selection,before.native.roles));assert.equal(before.native.context.build_id,identity.buildId);
  if(family.zoom===2){for(let i=0;i<8;i++){const v=await adapter.call('inspect');if(Math.abs(v.viewport.pageZoom-2)<.02)break;assert.ok(v.viewport.pageZoom<2);await physical(row,'zoom-in',{reserved:true});}await wait(2000);const z=await checkpoint(row,'actual zoom200 before original gesture');unchanged(z,before);assert.ok(Math.abs(z.viewport.pageZoom-2)<.02);assert.ok(Math.abs(z.dpr/before.dpr-2)<.02);}
  // Persist the current prelude without serializing prior rows between its fresh events.
  await recorder.prelude(row,async()=>{
    await physical(row,'hover-source');await adapter.call('settle');await physical(row,'move-start');await adapter.call('settle');
    if(family.mode!=='keyboard')await physical(row,'down');
  });
  if(family.mode==='keyboard'){
    let reached=false;for(let i=0;i<16;i++){const v=await adapter.call('inspect');if(v.handleFocused){reached=true;break;}await physical(row,'tab');}
    // Observe the last allowed Tab without posting a seventeenth key.
    if(!reached)reached=(await adapter.call('inspect')).handleFocused;
    assert.equal(reached,true,'Original actual handle focus reached without JS focus');await physical(row,'enter');await physical(row,'down-key');const menu=await adapter.call('inspect');const selected=menu.menu.filter(x=>x.focused);assert.equal(selected.length,1);assert.equal(selected[0].label.trim(),row.locale==='ru'?'Ниже':'Move down');await physical(row,'enter');
  }else{
    for(let i=1;i<=8;i++)await physical(row,'move-'+i);
    if(['N04','N06'].includes(row.family))await physical(row,'right');
    if(family.scroll){const began=performance.now();let terminal=false;row.scrollObservations=[];while(performance.now()-began<=8000){const v=await adapter.call('inspect');row.scrollObservations.push(v);if(v.scroll.terminal){terminal=true;break;}await wait(100);}assert.equal(terminal,true,'Independent frozen target reached at actual scroll limit within8s');}
    const held=await checkpoint(row,'original held publication-free preview');unchanged(held,before);assert.equal(held.native.uiResources.dragGestures,1);assert.equal(held.native.uiResources.pointerCaptures,1);
    if(row.family==='N05')await physical(row,'escape');await physical(row,'up');
  }
  await adapter.call('settle');const after=await checkpoint(row,'one original terminal, no replay');
  if(family.expected==='changed'){
    assert.equal(after.native.canonical,fixture.after);structure(after,before,fixture.roles_after);chronology(after,before);const semantic=commands(after,before);assert.equal(semantic.length,1);const call=semantic[0];assert.equal(call.request.command.id,'org.klenwriter.kwdj/command/move');assert.deepEqual(JSON.parse(call.request.command.payload_json),resolveRoles(fixture.intent,before.native.roles));assert.deepEqual(call.request.history_hint,{kind:'isolated'});assert.equal(call.response.status,'ok');assert.equal(call.response.value.effect,'changed');assert.deepEqual(call.response.value.state,after.native.state);
    if(family.mode==='keyboard')assert.equal(after.handleFocused,true);else assert.equal(after.editorFocused,true);idle(after);
    const baselineCalls=before.nativeTrace.calls.length;const hiddenSelection=nativeCalls(after,baselineCalls).filter(x=>x.request.kind==='set_selection');assert.deepEqual(hiddenSelection,[],'No post-baseline selection repair');
    for(let i=0;i<5;i++){await wait(100);const stable=await checkpoint(row,'stable original terminal '+i);unchanged(stable,after);}
    await history(row,before,after,fixture);
  }else{
    unchanged(after,before);idle(after);
    if(row.family==='N06'){
      const queries=nativeCalls(after,before.nativeTrace.calls.length).filter(x=>x.request.kind==='query_command'&&x.request.command.id==='org.klenwriter.kwdj/command/move'&&JSON.stringify(Object.entries(JSON.parse(x.request.command.payload_json)).sort())===JSON.stringify(Object.entries(resolveRoles(fixture.intent,before.native.roles)).sort()));
      assert.ok(queries.length>0,'Actual exact unavailable native candidate query');const expected=fixture.expected_query_diagnostic;assert.ok(expected,'Frozen full refusal diagnostic');assert.deepEqual(queries.at(-1).response.value,{kind:'availability',available:false,effect:null,presentation:null,diagnostic:{...expected,stamp:null}});
    }
  }
  if(family.zoom===2){await physical(row,'zoom-reset',{reserved:true});await wait(2000);const reset=await checkpoint(row,'actual zoom reset');assert.ok(Math.abs(reset.viewport.pageZoom-1)<.02);}
  return 'PASS';
}
function released(finish){
  const d=finish.disposed;assert.ok(d,'Actual complete disposal required');assert.deepEqual(d.native,{sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});
  assert.equal(d.nativeTrace.overflow,false);for(const value of Object.values(d.ui))assert.equal(value,0);assert.equal(d.mounted.sdk.lifecycle,'destroyed');
  for(const [owner,values]of Object.entries(d.mounted))if(values&&typeof values==='object')for(const [key,value]of Object.entries(values)){if(owner==='sdk'&&key==='lifecycle')continue;assert.equal(typeof value,'number',owner+'/'+key);assert.equal(value,0,owner+'/'+key);}
  assert.equal(finish.overflow,false);assert.deepEqual(finish.policy,[]);assert.deepEqual(finish.errors,[]);
}
try{
  assert.equal(process.platform,'darwin');assert.equal(process.version,'v24.22.0');assert.deepEqual(caseIds,programs.rows.map(x=>x.id));
  for(const ref of programs.source_refs){const actual=pin(ref.path);assert.equal(actual.sha256,ref.sha256);assert.equal(actual.bytes,ref.bytes);}
  identity=computeSdkBuildIdentity();const built=JSON.parse(readFileSync('artifacts/sdk-build-identity.json','utf8'));assert.equal(built.buildId,identity.buildId);assert.deepEqual(built.sourceHashes,identity.sourceHashes);report.buildId=identity.buildId;
  report.seal=JSON.parse(readFileSync('artifacts/sdk-wasm-seal.json','utf8'));assert.equal(report.seal.build_id,identity.buildId);assert.equal(report.seal.sealed_sha256,pin('packages/wasm/dist/editor_wasm_bg.wasm').sha256);
  const paths=[...new Set([...Object.keys(identity.sourceHashes),...walk('contracts/drag/v1'),...walk('scripts/drag-installed'),...['wasm','sdk','dom','kwdj','ui'].flatMap(n=>walk('packages/'+n+'/dist')),'scripts/drag-native-acceptance.mjs','scripts/dom-native-input-source.swift','scripts/selection-native/protocol.mjs','scripts/workspace-server.mjs','spikes/workspace/drag-native-host.js','spikes/workspace/ui-host.js','spikes/workspace/ui.html','spikes/workspace/ui-fixture.css','artifacts/extensions/packet.json','artifacts/sdk-build-identity.json','artifacts/sdk-wasm-seal.json'])].sort();
  report.source={head:run('git',['rev-parse','HEAD']).stdout.trim(),dirty:run('git',['status','--porcelain']).stdout.trim(),pins:paths.map(pin)};assert.equal(report.source.head,head);assert.equal(report.source.dirty,'','Root must commit reviewed exact source before installed execution');
  const bytes=readFileSync(configPath);assert.ok(bytes.length<=4096);config=JSON.parse(bytes);assert.equal(config.format,'osr44-drag-http-broker/1');assert.equal(config.title,'KlenWriter Drag native '+config.nonce);assert.equal(config.fixtureUrl,'http://127.0.0.1:4174/ui');assert.ok(Date.now()<config.expiresAt);report.broker={configPath,sha256:hash(bytes)};
  const bundle=browser==='chrome'?'/Applications/Google Chrome.app/Contents/Info.plist':'/Applications/Safari.app/Contents/Info.plist';report.bundleVersion=run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',bundle]).stdout.trim();report.bundleBuild=run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleVersion',bundle]).stdout.trim();assert.equal(report.bundleVersion,option('--expected-version'));
  report.os={version:run('/usr/bin/sw_vers',['-productVersion']).stdout.trim(),build:run('/usr/bin/sw_vers',['-buildVersion']).stdout.trim()};
  const helpers=mkdtempSync(resolve(dirname(output),'drag44-native-helpers-'));sourceHelper=resolve(helpers,'input-source');inputHelper=resolve(helpers,'fixture-input');
  report.setup.push({action:'compile-source-only-closed-helpers',executions:[run('/usr/bin/swiftc',['scripts/dom-native-input-source.swift','-O','-o',sourceHelper]),run('/usr/bin/swiftc',['scripts/drag-installed/guard.swift','-O','-o',inputHelper])]});report.helperArtifacts=[sourceHelper,inputHelper].map(pin);
  const initial=source();coherent(initial,initial.current.id);originalSource=initial.current.id;report.initialInputSources=initial;assert.ok(initial.sources.some(x=>x.id==='com.apple.keylayout.US'&&x.enabled&&x.selectable));await ensureSource('com.apple.keylayout.US');
  adapter=await(browser==='chrome'?createChromeAdapter({config,report,inputHelper,run,save,outputPath:output}):createSafariAdapter({config,report,inputHelper,run,outputPath:output}));await adapter.navigate();assert.equal(report.browserVersion,report.bundleVersion);
  let blocked=false;
  for(const row of report.rows){if(blocked){row.reason='Prior original failure/unknown; no further physical action';continue;}row.startedAt=now();let prepared=null,attempted=false;
    try{await adapter.focus();coherent(source(),selectedSource);attempted=true;prepared=await adapter.call('prepare',row.locale,row.id);row.prepared=prepared;row.status=await perform(row,prepared);}
    catch(error){row.status='FAILED';row.error={message:error.message,stack:error.stack,execution:error.execution??null};blocked=true;}
    finally{
      if(adapter.keysPending){row.keyCleanup=await adapter.releaseOwnedKeys();row.status='FAILED';blocked=true;}
      if(adapter.pointerDown){row.pointerCleanup=await adapter.releaseOwnedPointer();row.status='FAILED';blocked=true;}
      if(attempted){try{row.finish=await adapter.call('finish');released(row.finish);}catch(error){row.finishError={message:error.message,execution:error.execution??null};row.status='FAILED';blocked=true;}}
      if(adapter.inputDisabled)blocked=true;row.finishedAt=now();save();
    }
  }
  report.pageErrors=adapter.errors;assert.deepEqual(adapter.errors,[]);report.status=report.rows.every(r=>r.status==='PASS')?'PASSED':'FAILED';
}catch(error){report.status=report.physicalActions.length?'FAILED':'NOT_RUN';report.error={message:error.message,stack:error.stack,execution:error.execution??null};}
finally{
  if(adapter)try{await adapter.closeSender();}catch(error){report.senderCleanupError={message:error.message,execution:error.execution??null};report.status='FAILED';}
  if(adapter)try{await adapter.close();}catch(error){report.browserCleanupError={message:error.message,execution:error.execution??null};report.status='FAILED';}
  if(originalSource)try{const first=await ensureSource(originalSource),readbacks=[first];for(let i=0;i<4;i++){await wait(100);const actual=source();coherent(actual,originalSource);readbacks.push(actual);}report.restoration={status:'RESTORED',scope:'Original input source only; separate key/pointer cleanup and fixture close receipts retain their own outcomes',originalSource,readbacks};}catch(error){report.restoration={status:'FAILED',error:error.message,execution:error.execution??null};report.status='FAILED';}
  try{
    if(report.source){report.sourceAfter={head:run('git',['rev-parse','HEAD']).stdout.trim(),dirty:run('git',['status','--porcelain']).stdout.trim(),pins:report.source.pins.map(x=>pin(x.path))};report.sourceUnchanged=JSON.stringify(report.source)===JSON.stringify(report.sourceAfter);report.sourceClean=report.source.dirty===''&&report.sourceAfter.dirty==='';}
    if(report.helperArtifacts){report.helperArtifactsAfter=report.helperArtifacts.map(x=>pin(x.path));report.helperArtifactsUnchanged=JSON.stringify(report.helperArtifacts)===JSON.stringify(report.helperArtifactsAfter);}
    if(report.broker)assert.equal(hash(readFileSync(configPath)),report.broker.sha256);
    if(!report.sourceUnchanged||!report.sourceClean||!report.helperArtifactsUnchanged)report.status='FAILED';
  }catch(error){report.identityError=error.message;report.status='FAILED';}
  report.counts=Object.fromEntries(['PASS','FAILED','UNOBSERVED','UNSUPPORTED','NOT_RUN'].map(status=>[status,report.rows.filter(r=>r.status===status).length]));report.actualActionCount=report.physicalActions.length;report.finishedAt=now();save();
}
console.log(JSON.stringify({output,status:report.status,counts:report.counts,actualActionCount:report.actualActionCount}));process.exitCode=report.status==='PASSED'?0:report.status==='FAILED'?1:2;
