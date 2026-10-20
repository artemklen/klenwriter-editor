// SPDX-License-Identifier: MIT OR Apache-2.0
// Finite installed42 protocol. Browser setup/RPC is never labelled physical input.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {computeSdkBuildIdentity} from './generate-sdk-types.mjs';
import {createChromeAdapter} from './ui-native/chrome-adapter.mjs';
import {createSafariAdapter} from './ui-native/safari-adapter.mjs';
import {captureOwnedWindow,fixedKeyScript} from './ui-native/input.mjs';
import {caseIds,keySpecs,limits} from './ui-native/protocol.mjs';
import {compositionSettlementLiterals,compositionSettlementState} from './ui-native/settlement-literals.mjs';
import {classifyCompositionObservation,classifyCompositionAfterClickObservation,classifyCompositionDuringPointerObservation,earlySpacingAccentBinding,notesEarlySpacingAccentBinding} from './ui-native/composition-observation.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);
const args=process.argv.slice(2),names=['--browser','--output','--broker','--head','--expected-version'];
if(args.length!==names.length*2||new Set(args.filter((_,i)=>i%2===0)).size!==names.length||args.filter((_,i)=>i%2===0).some(name=>!names.includes(name)))throw Error('Usage: node scripts/ui-native-acceptance.mjs --browser chrome|safari --output /fresh/outside/report.json --broker /fresh/outside/broker/config.json --head FULL_SHA --expected-version INSTALLED_VERSION');
const option=name=>args[args.indexOf(name)+1],browserName=option('--browser'),expectedHead=option('--head');assert.ok(['chrome','safari'].includes(browserName));assert.match(expectedHead,/^[a-f0-9]{40}$/);
const developmentCase=process.env.OSR42_NATIVE_DEVELOPMENT_CASE;assert.ok(developmentCase===undefined||developmentCase==='modes-zoom','Closed OSR42_NATIVE_DEVELOPMENT_CASE must be unset or exactly modes-zoom');
const outside=value=>{assert.ok(value?.startsWith('/'));const path=resolve(value);assert.ok(path!==root&&!path.startsWith(root+'/'),'Evidence must remain outside checkout');return path;};
const outputPath=outside(option('--output')),configPath=outside(option('--broker'));assert.equal(existsSync(outputPath),false,'Preserve prior evidence; output must be fresh');mkdirSync(dirname(outputPath),{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),now=()=>new Date().toISOString(),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const pin=path=>{const bytes=readFileSync(resolve(root,path));return {path,bytes:bytes.length,sha256:hash(bytes),mode:(statSync(resolve(root,path)).mode&0o7777).toString(8).padStart(4,'0')};};
const absolutePin=path=>({...pin(path),path:resolve(path)});
const walk=path=>readdirSync(path,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(`${path}/${entry.name}`):entry.isFile()?[`${path}/${entry.name}`]:[]);
const report={format:'editor-ui-installed/1',browser:browserName,expectedHead,status:'NOT_RUN',startedAt:now(),locales:['en','ru'].map(locale=>({locale,inputSourceId:locale==='en'?'com.apple.keylayout.US':'com.apple.keylayout.Russian',cases:caseIds.map(caseId=>({locale,caseId,status:'NOT_RUN',actualActionCount:0,preparation:[],checkpoints:[],startedAt:null}))})),physicalActions:[],setup:[],restoration:null,
  scope:'Installed macOS browser; finite42 scenarios, public mounted SDK/native readbacks and original request/response traces. Strict scoped System Events keys, closed Chrome Find/Zoom CGEvent keys and CGEvent clicks are platform input, not hardware-device provenance. Native preedit windows missing from actual trusted traces remain UNOBSERVED. No synthetic fallback, AT/CJK/mobile claim, previous41 evidence reuse or independent formal-review verdict.'};
if(developmentCase!==undefined)report.development={"environment":"OSR42_NATIVE_DEVELOPMENT_CASE","caseId":"modes-zoom","selectedCases":2,"excludedCases":28,"coverage":"INCOMPLETE","acceptance":false};
const save=()=>writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n');save();
function run(command,argv,{fullStdout=false,timeout=30000,maxBuffer=1024*1024}={}){
  const started=process.hrtime.bigint(),value=spawnSync(command,argv,{cwd:root,encoding:'utf8',timeout,maxBuffer}),wallTimeMs=Number(process.hrtime.bigint()-started)/1e6;
  const execution={command,argv,returnCode:value.status,signal:value.signal,stdout:fullStdout?(value.stdout??''):(value.stdout??'').slice(0,16384),stderr:(value.stderr??'').slice(0,4096),error:value.error?.message??null,wallTimeMs};
  if(value.status!==0)throw Object.assign(Error(`${command}: ${execution.stderr||execution.error||execution.stdout}`),{execution});return execution;
}
// CW01: one existing invalid request before the browser; never input authority.
function preflightChromeFindHelper(){
  assert.equal(browserName,'chrome');
  const stage={action:'preflight-closed-chrome-find-helper',status:'attempted',validationExitCode:null,startedAt:now(),scope:'Existing invalid-request process preparation only; no AX, CG allocation/post, input authority or performance guarantee',execution:null,helperBefore:null,helperAfter:null};
  report.setup.push(stage);
  try{
    const helper=findKeyHelper,argv=['--request','{}'];stage.helperBefore=absolutePin(helper);
    assert.deepEqual(stage.helperBefore,report.helperArtifacts.find(item=>item.path===helper),'Pinned Find helper before preflight');
    const started=process.hrtime.bigint(),value=spawnSync(helper,argv,{cwd:root,encoding:'utf8',timeout:5000,maxBuffer:32768}),wallTimeMs=Number(process.hrtime.bigint()-started)/1e6;
    const stdout=value.stdout??'',stderr=value.stderr??'',stdoutBytes=Buffer.byteLength(stdout),stderrBytes=Buffer.byteLength(stderr);
    stage.execution={command:helper,argv,returnCode:value.status,signal:value.signal,error:value.error?.message??null,stdout:stdout.slice(0,32768),stderr:stderr.slice(0,32768),stdoutBytes,stderrBytes,stdoutTruncated:stdoutBytes>32768,stderrTruncated:stderrBytes>32768,wallTimeMs};
    stage.helperAfter=absolutePin(helper);assert.deepEqual(stage.helperAfter,stage.helperBefore,'Pinned Find helper after preflight');
    assert.equal(value.error,undefined);assert.equal(value.signal,null);assert.equal(value.status,2);
    assert.ok(stdoutBytes<=32768&&stderrBytes<=32768);assert.equal(stderr,'');
    assert.ok(Number.isFinite(wallTimeMs)&&wallTimeMs>=0);
    const actual=JSON.parse(stdout);stage.actual=actual;
    assert.ok(Number.isFinite(actual.elapsedMs)&&actual.elapsedMs>=0&&actual.elapsedMs<=5000);
    assert.deepEqual(actual,{format:'osr42-chrome-find-key-result/1',status:'refused',delivery:'not_sent',method:'CGEvent/cghidEventTap',request:{},programId:null,program:null,postedTransitions:[],postedCount:0,preflightProofs:[],core:null,postcondition:{status:'not_attempted',expectedPhase:null,observedPhase:null,reads:0,proof:null,diagnostic:null},diagnostic:{code:'request',reason:'Invalid closed request'},elapsedMs:actual.elapsedMs});
    stage.status='PASSED';stage.validationExitCode=0;
  }catch(error){stage.status='FAILED';stage.validationExitCode=1;stage.error={message:error.message};throw error;}
  finally{stage.finishedAt=now();}
}
const native=JSON.parse(readFileSync('contracts/ui/v1/native-oracles.json','utf8')),literal=id=>{const value=native.cases.find(c=>c.id===id);assert.ok(value);return value;};
let adapter=null,inputHelper=null,sourceHelper=null,keyScriptPath=null,findKeyHelper=null,originalSource=null,selectedSource=null,config=null,configSha=null;
const source=()=>JSON.parse(run(sourceHelper,['status'],{fullStdout:true}).stdout);
function coherent(value,id){assert.equal(value.status,'ok');assert.equal(value.current.id,id);assert.equal(value.current.selected,true);assert.equal(value.current.enabled,true);assert.equal(value.current.selectable,true);assert.ok(value.sources.some(x=>x.id===id&&x.selected&&x.enabled&&x.selectable));}
async function selectSource(id){const execution=run(sourceHelper,['select',id],{fullStdout:true}),result=JSON.parse(execution.stdout);assert.equal(result.status,'ok');report.setup.push({action:'select-existing-source',execution,result});await wait(250);const actual=source();coherent(actual,id);selectedSource=id;return actual;}
const actualRole=(roles,p)=>p.kind==='text'?{...p,node:roles[p.node]}:p.kind==='child'?{...p,parent:roles[p.parent]}:{...p,node:roles[p.node]};
const directed=(roles,s)=>({anchor:actualRole(roles,s.anchor),focus:actualRole(roles,s.focus)});
const ids=checkpoint=>checkpoint.native.rows.map(r=>r.node.id).sort();
const docEvents=value=>value.native.events.filter(e=>e.change.kind==='document');
function clean(value){assert.equal(value.traceOverflow,false);assert.equal(value.policyOverflow,false);assert.deepEqual(value.policyViolations,[]);assert.deepEqual(value.errors,[]);assert.equal(value.errorOverflow,false);assert.equal(value.nativeTrace.overflow,false);assert.equal(value.nativeTrace.enabled,true);assert.equal(value.facts.nativeTrace.overflow,false);assert.equal(value.facts.resources.sdk.callback_errors,0);}
function unchanged(actual,before){assert.equal(actual.native.canonical,before.native.canonical);assert.deepEqual(actual.native.state,before.native.state);assert.deepEqual(actual.native.rows,before.native.rows);assert.deepEqual(actual.native.events,before.native.events);}
function semanticCalls(actual,before){assert.equal(actual.nativeTrace.overflow,false);return actual.nativeTrace.calls.slice(before.nativeTrace.calls.length).map(row=>({row,request:JSON.parse(row.requestJson),response:JSON.parse(row.responseJson)})).filter(row=>row.request.kind==='command');}
function compositionCommitted(actual,before,caseId,earlyBinding=null){
  const original=caseId==='composition-dialog'?compositionSettlementLiterals.notes:compositionSettlementLiterals.kwdj,
    literal=earlyBinding?{...original,afterCanonical:earlyBinding.afterCanonical,afterText:earlyBinding.afterText}:original,e=compositionSettlementState;
  assert.equal(pin(literal.source.path).sha256,literal.source.sha256,'Independent frozen composition source pin');
  if(earlyBinding)assert.equal(pin(earlyBinding.source.path).sha256,earlyBinding.source.sha256,'Existing41 source-authored spacing-accent input binding');
  assert.equal(before.native.canonical,literal.inputCanonical,'Composition input is the independently authored literal');
  assert.equal(before.native.state.stamp.revision,'0');assert.equal(before.native.state.stamp.history_epoch,'0');assert.equal(before.native.state.history.undo_entries,'0');assert.equal(before.native.state.history.redo_entries,'0');assert.equal(before.native.state.dirty,false);assert.equal(before.native.state.saved_revision,'0');assert.deepEqual(before.native.state.stored_marks,null);
  assert.equal(actual.native.canonical,literal.afterCanonical,'Exact source-authored composition settlement bytes');
  const roles={};
  for(const [role,path]of Object.entries(literal.roles)){
    const initial=before.native.rows.find(row=>JSON.stringify(row.path)===JSON.stringify(path)),after=actual.native.rows.find(row=>JSON.stringify(row.path)===JSON.stringify(path));assert.ok(initial&&after,'Every authored native path exists');
    roles[role]=initial.node.id;assert.equal(after.node.id,initial.node.id,'Original opaque ID stays at its authored path');
    for(const key of ['parent','type_id','primitive','attributes','marks','children'])assert.deepEqual(after.node[key],initial.node[key],`Composition preserves ${role}/${key}`);
    assert.equal(after.node.text,role==='T'?literal.afterText:initial.node.text,'Only the authored selected text changes');
  }
  assert.equal(new Set(Object.values(roles)).size,Object.keys(literal.roles).length,'Bijective role binding');assert.equal(before.native.rows.length,Object.keys(roles).length);assert.equal(actual.native.rows.length,Object.keys(roles).length);assert.deepEqual(ids(actual),ids(before));
  assert.deepEqual(before.native.state.selection,directed(roles,literal.selection));assert.deepEqual(actual.native.state.selection,directed(roles,literal.afterSelection));
  for(const key of ['session','generation'])assert.equal(actual.native.state.stamp[key],before.native.state.stamp[key]);
  for(const [key,delta]of Object.entries(e.stampDelta))assert.equal(BigInt(actual.native.state.stamp[key])-BigInt(before.native.state.stamp[key]),delta);
  assert.equal(docEvents(actual).length-docEvents(before).length,e.documentEvents);assert.equal(actual.native.events.filter(event=>event.change.kind==='state').length-before.native.events.filter(event=>event.change.kind==='state').length,e.stateEvents);
  assert.equal(actual.native.state.history.undo_entries,e.undoEntries);assert.equal(actual.native.state.history.redo_entries,e.redoEntries);assert.match(actual.native.state.history.retained_bytes,/^(0|[1-9][0-9]*)$/);
  assert.equal(actual.native.state.dirty,e.dirty);assert.equal(actual.native.state.saved_revision,e.savedRevision);assert.deepEqual(actual.native.state.stored_marks,e.storedMarks);
  const calls=semanticCalls(actual,before);assert.equal(calls.length,1);assert.equal(calls[0].request.command.id,literal.commandId);assert.equal(calls[0].request.command.payload_json,earlyBinding?.command.payload_json??literal.payloadJson);assert.deepEqual(calls[0].request.history_hint,{kind:'isolated'});
  assert.equal(calls[0].response.status,'ok');assert.equal(calls[0].response.value.kind,'mutation');assert.equal(calls[0].response.value.effect,'changed');assert.deepEqual(calls[0].response.value.state,actual.native.state);
  return {source:literal.source,...(earlyBinding?{inputBinding:earlyBinding.source}:{}),expectedCanonical:literal.afterCanonical,expectedSelection:directed(roles,literal.afterSelection),originalIds:Object.values(roles),stampDelta:{revision:'1',selection_epoch:'1',history_epoch:'1'},documentEvents:e.documentEvents,stateEvents:e.stateEvents,undoEntries:e.undoEntries,redoEntries:e.redoEntries};
}
function changed(actual,before,caseId){
  clean(actual);const e=literal(caseId).expected;assert.equal(actual.native.canonical,e.canonical_json);assert.equal(docEvents(actual).length-docEvents(before).length,1);assert.equal(actual.native.state.history.undo_entries,'1');assert.equal(actual.native.state.history.redo_entries,'0');
  for(const key of ['revision','selection_epoch','history_epoch'])assert.equal(BigInt(actual.native.state.stamp[key])-BigInt(before.native.state.stamp[key]),BigInt(e.stampDelta[key]));
  const calls=semanticCalls(actual,before);assert.equal(calls.length,1);assert.equal(calls[0].response.status,'ok');assert.equal(actual.native.results.filter(x=>x.status==='submitted').length-before.native.results.filter(x=>x.status==='submitted').length,1);
  if(e.allOriginalIdsSurvive)for(const id of ids(before))assert.ok(ids(actual).includes(id));
  const roles={...before.native.roles};for(const [role,path]of Object.entries(e.roles??{}))if(!roles[role]){const row=actual.native.rows.find(row=>JSON.stringify(row.path)===JSON.stringify(path));assert.ok(row);roles[role]=row.node.id;}
  if(e.selection)assert.deepEqual(actual.native.state.selection,directed(roles,e.selection));
  const requests=actual.nativeTrace.calls.slice(before.nativeTrace.calls.length).map(row=>JSON.parse(row.requestJson)),commandIndex=requests.findIndex(r=>r.kind==='command');
  assert.equal(requests.slice(0,commandIndex).filter(r=>r.kind==='set_selection').length,0,'No hidden pre-command selection write');
}
function focused(value,role){const active=value.dom.active;assert.ok(active);if(role==='editor')assert.equal(active.id,`${value.id}-editor`);else if(['add','move'].includes(role))assert.equal(active.control,role);else if(['before','recovery'].includes(role))assert.equal(active.id,role==='before'?'ui-before':'ui-after');else assert.equal(active.action,role);}
function keyAck(value,action,before,{reserved=false}={}){
  const spec=keySpecs[action],trace=value.inputTrace.slice(before),down=trace.filter(row=>row.event==='keydown'&&row.isTrusted&&row.code===spec.domCode),up=trace.filter(row=>row.event==='keyup'&&row.isTrusted&&row.code===spec.domCode);
  if(reserved)return {scope:'Browser-reserved shortcut: fixed OS transition proof and actual browser readback; no fabricated DOM ACK',trustedDown:down,trustedUp:up};
  assert.ok(down.some(row=>row.shift===spec.modifiers.includes('shift')&&row.alt===spec.modifiers.includes('option')&&row.meta===spec.modifiers.includes('command')),'Actual trusted matching keydown');assert.ok(up.length,'Actual trusted keyup');return {trustedDown:down,trustedUp:up};
}
async function physical(entry,action,{reserved=false}={}){
  coherent(source(),selectedSource);const before=await adapter.call('inspect'),row={locale:entry.locale,caseId:entry.caseId,action,status:'attempted',startedAt:now(),inputSourceBefore:source().current,inputTraceBefore:before.inputTraceCount};report.physicalActions.push(row);entry.actualActionCount++;save();
  try {
    row.proof=await adapter.input(action);coherent(source(),selectedSource);row.inputSourceAfter=source().current;row.status='completed';
    const after=await adapter.call('inspect');if(keySpecs[action])row.domAcknowledgement=keyAck(after,action,row.inputTraceBefore,{reserved});
    else {const rows=after.inputTrace.slice(row.inputTraceBefore),down=rows.filter(r=>r.event==='pointerdown'&&r.isTrusted&&r.button===0),up=rows.filter(r=>r.event==='pointerup'&&r.isTrusted&&r.button===0);assert.equal(down.length,1);assert.equal(up.length,1);assert.equal(up[0].pointerId,down[0].pointerId);row.domAcknowledgement={down,up};}
    return after;
  } catch(error){row.status='failed';row.error={message:error.message,execution:error.execution??null};throw error;}
  finally{row.finishedAt=now();save();}
}
async function checkpoint(entry,label){const value=await adapter.call('checkpoint');clean(value);entry.checkpoints.push({label,value});save();return value;}
async function history(entry,before,after){
  assert.equal((await adapter.call('setup','undo')).response.status,'ok');const undo=await checkpoint(entry,'explicit native host undo (not physical shortcut)');assert.equal(undo.native.canonical,before.native.canonical);assert.deepEqual(ids(undo),ids(before));assert.deepEqual(undo.native.state.selection,before.native.state.selection);assert.equal(undo.native.state.history.undo_entries,'0');assert.equal(undo.native.state.history.redo_entries,'1');
  assert.equal((await adapter.call('setup','redo')).response.status,'ok');const redo=await checkpoint(entry,'explicit native host redo (not physical shortcut)');assert.equal(redo.native.canonical,after.native.canonical);assert.deepEqual(ids(redo),ids(after));assert.deepEqual(redo.native.state.selection,after.native.state.selection);assert.equal(redo.native.state.history.undo_entries,'1');assert.equal(redo.native.state.history.redo_entries,'0');
}
async function screenshot(entry,label){const path=resolve(dirname(outputPath),`${entry.locale}-${entry.caseId}-${label}.png`);assert.equal(existsSync(path),false);const current=await adapter.call('inspect'),capture=browserName==='chrome'&&label==='native-find'?await adapter.captureFindWindow(path):captureOwnedWindow({browser:browserName,config,inputHelper,run,path,viewport:current.viewport});entry.screenshots??=[];entry.screenshots.push({...capture,pin:absolutePin(path)});save();}
async function perform(entry,prepared){
  const before=prepared.before;clean(before);const id=entry.caseId;
  if(id==='navigation'){
    focused(before,'before');let v=await physical(entry,'tab');focused(v,'strong');await physical(entry,'right');focused(await adapter.call('inspect'),'emphasis');await physical(entry,'home');focused(await adapter.call('inspect'),'strong');await physical(entry,'end');focused(await adapter.call('inspect'),'emphasis');await physical(entry,'left');focused(await adapter.call('inspect'),'strong');
    v=await physical(entry,'tab');focused(v,'editor');v=await physical(entry,'shift-tab');focused(v,'strong');const after=await checkpoint(entry,'physical navigation, no semantic action');unchanged(after,before);assert.equal(semanticCalls(after,before).length,0);assert.equal(after.controls.filter(c=>c.tag==='BUTTON'&&c.action&&c.tabIndex===0&&['strong','emphasis'].includes(c.action)).length,1);return 'PASS';
  }
  if(id.startsWith('format-')){
    if(id.endsWith('keyboard')){focused(await physical(entry,'shift-tab'),'strong');await physical(entry,'enter');}else await physical(entry,'click-strong');
    const after=await checkpoint(entry,'one original format command');changed(after,before,'V01-forward');focused(after,'editor');await history(entry,before,after);return 'PASS';
  }
  if(id.startsWith('add-')){
    if(id.endsWith('keyboard')){
      focused(before,'editor');focused(await physical(entry,'tab'),'move');let value=await checkpoint(entry,'physical Tab captures the editor range before Move focus');unchanged(value,before);assert.equal(semanticCalls(value,before).length,0);
      focused(await physical(entry,'tab'),'add');value=await checkpoint(entry,'second physical Tab reaches Add without native mutation');unchanged(value,before);assert.equal(semanticCalls(value,before).length,0);
      await physical(entry,'enter');value=await checkpoint(entry,'physical Enter opens the Add picker without native mutation');focused(value,'paragraph');unchanged(value,before);assert.equal(semanticCalls(value,before).length,0);
      const expected=[['paragraph',entry.locale==='ru'?'Абзац':'Paragraph'],['quote',entry.locale==='ru'?'Цитата':'Quote'],['table',entry.locale==='ru'?'Таблица':'Table']],items=value.controls.filter(control=>expected.some(([action])=>action===control.action));
      assert.deepEqual(items.map(control=>[control.action,control.name]),expected,'Frozen picker order and localized accessible names');assert.ok(items.every(control=>control.visible));
      const table=items.find(control=>control.action==='table');assert.equal(table.disabled,'true');assert.ok(table.description?.trim(),'Unavailable Table remains discoverable with its native refusal reason');
      for(const [action,target]of [['down','quote'],['end','table'],['up','quote'],['home','paragraph']]){
        focused(await physical(entry,action),target);value=await checkpoint(entry,`physical ${action} focuses ${target} without native mutation`);focused(value,target);unchanged(value,before);assert.equal(semanticCalls(value,before).length,0);
      }
      await physical(entry,'enter');
    }else{await physical(entry,'click-add');await physical(entry,'click-paragraph');}
    const after=await checkpoint(entry,'one original Add command at explicit root gap');changed(after,before,'V03-root-gap');focused(after,'editor');await history(entry,before,after);return 'PASS';
  }
  if(id.startsWith('move-')){
    const direction=id.endsWith('down')?'down':'up';
    if(id.includes('-menu-')){
      await physical(entry,'click-move');const open=await checkpoint(entry,'move menu and refused Nest reason'),nest=open.controls.find(c=>c.action==='nest');assert.ok(nest&&nest.disabled==='true');
      assert.ok(nest.description?.trim(),'Native refusal reason remains discoverable');await physical(entry,'click-nest');const refused=await checkpoint(entry,'unavailable native Nest never dispatches');unchanged(refused,before);assert.equal(semanticCalls(refused,before).length,0);await physical(entry,'click-'+direction);
    }else{focused(before,'editor');focused(await physical(entry,'tab'),'move');const focusedMove=await checkpoint(entry,'physical Tab captures the editor range before local Move shortcut');unchanged(focusedMove,before);assert.equal(semanticCalls(focusedMove,before).length,0);await physical(entry,'move-'+direction);}
    const after=await checkpoint(entry,'one original local native Move');changed(after,before,direction==='up'?'V04-up':'V04-down');focused(after,'move');await history(entry,before,after);return 'PASS';
  }
  if(id==='host-dialog'){
    await physical(entry,'click-title');let value=await checkpoint(entry,'actual host modal open');assert.equal(value.native.dialog.hidden,false);assert.equal(value.dom.active?.tag,'INPUT');
    const modal=value.controls.find(c=>c.role==='dialog');assert.equal(modal.modal,'true');assert.equal(modal.name,entry.locale==='ru'?'Параметры блока':'Block options');
    await physical(entry,'shift-tab');assert.equal((await adapter.call('inspect')).dom.active?.buttonText,entry.locale==='ru'?'Отмена':'Cancel');await physical(entry,'tab');assert.equal((await adapter.call('inspect')).dom.active?.tag,'INPUT');await physical(entry,'escape');value=await checkpoint(entry,'Escape cancels exact captured native range');unchanged(value,before);focused(value,'editor');assert.equal(value.native.dialog.hidden,true);
    await physical(entry,'click-title');await physical(entry,'click-cancel');value=await checkpoint(entry,'physical Cancel restores the same exact range');unchanged(value,before);focused(value,'editor');assert.equal(value.native.dialog.hidden,true);
    await physical(entry,'click-title');const edited=await adapter.call('setup','host-edit');entry.preparation.push({action:'explicit host native edit during dialog',result:edited});assert.equal(edited.response.status,'ok');const current=await checkpoint(entry,'host edit makes prior UI lease stale');
    entry.preparation.push(await adapter.call('setup','recovery'));entry.preparation.push(await adapter.call('setup','late-accept'));const late=await checkpoint(entry,'two late callback completions never dispatch');unchanged(late,current);focused(late,'recovery');assert.equal(late.native.uiResources.hostRequests,0);assert.equal(semanticCalls(late,current).length,0);return 'PASS';
  }
  if(id.startsWith('composition-')){
    await physical(entry,'deadkey-acute');const preedit=await checkpoint(entry,'actual native preedit observation');
    if(!preedit.composition.open||!preedit.inputTrace.some(r=>r.event==='compositionstart'&&r.isTrusted)){entry.disposition='native_preedit_window_unobserved';return 'UNOBSERVED';}
    unchanged(preedit,before);const target={'composition-format':'strong','composition-move':'move','composition-add':'add','composition-dialog':'title'}[id];
    await physical(entry,'click-'+target);const conflict=await checkpoint(entry,'distinct physical gesture during unresolved native preedit');
    // Fixed finite alternatives, declared from source before inspecting output.
    // No canonical result, DOM text or observed event.data constructs an oracle.
    const profileLiteral=id==='composition-dialog'?compositionSettlementLiterals.notes:compositionSettlementLiterals.kwdj,
      earlyBindings=[{command:{id:profileLiteral.commandId,payload_json:profileLiteral.payloadJson},binding:null},
        {command:(id==='composition-dialog'?notesEarlySpacingAccentBinding:earlySpacingAccentBinding).command,binding:id==='composition-dialog'?notesEarlySpacingAccentBinding:earlySpacingAccentBinding}],
      nativeCommands=semanticCalls(conflict,before),expected=earlyBindings.find(candidate=>nativeCommands.length===1&&JSON.stringify(candidate.command)===JSON.stringify(nativeCommands[0].request.command))??earlyBindings[0];
    const observationInput={before,preedit,gesture:conflict,action:report.physicalActions.at(-1),expectedCommand:expected.command,
      verifySettlement:()=>{assert.equal(conflict.native.results.filter(r=>r.status==='submitted').length,0,'No UI action or deferred replay');return compositionCommitted(conflict,before,id,expected.binding);}};
    entry.compositionObservation=classifyCompositionObservation(observationInput);
    if(entry.compositionObservation.classification==='FAILED'){
      // Keep the original default failure; this is a separately frozen subset.
      entry.compositionAfterClickObservation=classifyCompositionAfterClickObservation(observationInput);
      if(entry.compositionAfterClickObservation.classification!=='UNOBSERVED'){
        // Pure observation only; keep BOTH earlier classifier failures unchanged.
        entry.compositionDuringPointerObservation=classifyCompositionDuringPointerObservation(observationInput);
        assert.equal(entry.compositionDuringPointerObservation.classification,'UNOBSERVED',entry.compositionDuringPointerObservation.error?.message??entry.compositionAfterClickObservation.error?.message);
        entry.disposition=entry.compositionDuringPointerObservation.reason;return 'UNOBSERVED';
      }
      entry.disposition='native_terminal_before_gesture_insert_completed_after_click';return 'UNOBSERVED';
    }
    if(entry.compositionObservation.classification==='UNOBSERVED'){entry.disposition=entry.compositionObservation.reason;return 'UNOBSERVED';}
    assert.equal(conflict.composition.open,true,'Observed unresolved composition ended during the distinct gesture; preservation condition failed');
    unchanged(conflict,preedit);assert.equal(conflict.dom.html,preedit.dom.html);assert.deepEqual(conflict.dom.objects,preedit.dom.objects);assert.deepEqual(conflict.dom.selection,preedit.dom.selection);assert.deepEqual(conflict.dom.active,preedit.dom.active);assert.equal(semanticCalls(conflict,before).length,0);assert.equal(conflict.native.results.filter(r=>r.status==='submitted').length,0);
    await physical(entry,'complete-e');const settled=await adapter.call('settle');clean(settled);entry.checkpoints.push({label:'actual settlement after protected gesture',value:settled});
    const calls=semanticCalls(settled,before);assert.equal(calls.filter(c=>!c.request.command.id.endsWith('/insert-text')).length,0,'No deferred UI action replay');assert.equal(settled.native.results.filter(r=>r.status==='submitted').length,0);assert.ok(settled.composition.ends>0&&!settled.composition.open);
    if(settled.facts.lifecycle==='recoveryRequired'){entry.disposition='actual_input_retained_recovery_not_positive_commit';assert.ok(settled.facts.recoveryResults?.length||settled.native.recoveryResults?.length);return 'REFUSED';}
    assert.equal(settled.facts.lifecycle,'ready');entry.fixedSettlement=compositionCommitted(settled,before,id);entry.disposition='observed_native_window_distinct_gesture_preserved_exact_settlement_no_replay';return 'PASS';
  }
  assert.equal(id,'modes-zoom');
  entry.preparation.push(await adapter.call('setup','readonly'));let readonly=await checkpoint(entry,'readOnly native range remains selectable');
  await physical(entry,entry.locale==='en'?'ordinary-en':'ordinary-ru');unchanged(await checkpoint(entry,'readonly rejects ordinary layout typing'),readonly);
  await physical(entry,'copy');let copied;const deadline=performance.now()+12000;
  do{copied=await checkpoint(entry,'actual navigator clipboard completion');if(copied.native.clipboardResults?.some(r=>r.status==='copied'&&r.clipboard==='confirmed'))break;await wait(100);}while(performance.now()<deadline);
  assert.ok(copied.native.clipboardResults?.some(r=>r.status==='copied'&&r.clipboard==='confirmed'),'Actual native clipboard writer must confirm before OS read');
  entry.clipboardAppleScriptRead=run('/usr/bin/osascript',['-e','the clipboard as text'],{fullStdout:true});
  entry.clipboardRead=run('/usr/bin/env',['LC_ALL=en_US.UTF-8','LC_CTYPE=en_US.UTF-8','LANG=en_US.UTF-8','/usr/bin/pbpaste','-Prefer','txt'],{fullStdout:true});
  assert.equal(entry.clipboardRead.stdout.replace(/\n$/,''),'ab\ncd');
  assert.equal(entry.clipboardRead.stdout,'ab\ncd','Direct UTF-8 pbpaste stdout must be the exact LF literal, with no appended newline or CR normalization');unchanged(copied,readonly);
  await physical(entry,'find',{reserved:true});await screenshot(entry,'native-find');entry.findObservation=await checkpoint(entry,'uncancelled trusted native Find');
  assert.ok(entry.findObservation.inputTrace.some(r=>r.event==='keydown'&&r.code==='KeyF'&&r.isTrusted&&r.meta&&!r.defaultPrevented),'Native Find key not intercepted');assert.equal(entry.findObservation.documentFocused,false,'Actual browser Find owns focus outside document');unchanged(entry.findObservation,readonly);await physical(entry,'close-find',{reserved:true});
  const findClosed=await checkpoint(entry,'native Find closed and original fixture focus restored');assert.equal(findClosed.documentFocused,true);unchanged(findClosed,readonly);
  entry.preparation.push(await adapter.call('setup','recovery'));entry.preparation.push(await adapter.call('setup','disabled'));const disabled=await checkpoint(entry,'disabled baseline and external recovery access');
  const focusAttempt=await adapter.call('setup','editor');entry.disabledFocusAttempt=focusAttempt;assert.equal(focusAttempt.status,'dom_refused');
  await physical(entry,'click-strong');await physical(entry,'click-add');await physical(entry,'click-recovery');const blocked=await checkpoint(entry,'disabled UI never dispatches');unchanged(blocked,disabled);focused(blocked,'recovery');assert.equal(semanticCalls(blocked,disabled).length,0);
  entry.preparation.push(await adapter.call('setup','editable'));entry.preparation.push(await adapter.call('setup','editor'));
  for(let i=0;i<8;i++){const view=await adapter.call('inspect');if(Math.abs(view.viewport.pageZoom-2)<.01)break;assert.ok(view.viewport.pageZoom<2);await physical(entry,'zoom-in',{reserved:true});}
  const zoomed=await checkpoint(entry,'actual browser zoom200, no CSS zoom/emulation');assert.ok(Math.abs(zoomed.viewport.pageZoom-2)<.01);
  const physicalWindow=action=>action.proof?.keyGuard?.axWindow??action.proof?.actual?.axWindow,baselineWindow=physicalWindow(report.physicalActions.find(action=>physicalWindow(action))),zoomWindow=physicalWindow(report.physicalActions.at(-1));assert.deepEqual(zoomWindow,baselineWindow);
  entry.zoom={actual:zoomed.viewport,evidence:zoomed.zoomEvidence,baselineWindow,zoomWindow,method:'Guarded native browser CmdPlus; baseline/current CSS viewport width at independently measured fixed AX window, DPR/JS outer dimensions recorded as crosschecks'};
  if(browserName==='chrome'){
    entry.zoomUiSettling={method:'fixed passive preparation wait',requestedDurationMs:2000,startedAt:now(),scope:'No input, read, reactivation, retry or authority during the wait. Following ordinary input requires its original fresh page/AX/System Events guards; no browser UI duration guarantee.'};save();
    await wait(2000);entry.zoomUiSettling.finishedAt=now();
    const afterWait=await adapter.call('inspect');assert.ok(Math.abs(afterWait.viewport.pageZoom-2)<.01,'Actual zoom200 persists after passive preparation');entry.zoomUiSettling.followingViewport=afterWait.viewport;
  }
  entry.preparation.push(await adapter.call('setup','editor'));focused(await physical(entry,'shift-tab'),'strong');const focus=await checkpoint(entry,'actual focus at browser zoom200');
  const wanted=entry.locale==='ru'?['Полужирный','Курсив']:['Bold','Italic'];for(const [index,action]of ['strong','emphasis'].entries()){const c=focus.controls.find(c=>c.action===action);assert.equal(c.name,wanted[index]);assert.ok(c.rect.width>=32&&c.rect.height>=32);assert.ok(c.rect.x>=0&&c.rect.x+c.rect.width<=focus.viewport.width+.5);}
  const focusedControl=focus.controls.find(c=>c.action==='strong');assert.ok(focusedControl.outline.style!=='none'&&parseFloat(focusedControl.outline.width)>0);
  assert.ok(focus.page.scrollWidth<=focus.page.clientWidth,'No horizontal page overflow at200%');
  const geometry=focus.selectionGeometry;assert.equal(geometry.status,'measured');
  for(const endpoint of [geometry.anchor,geometry.focus]){assert.ok(endpoint&&endpoint.height>0,'Actual selection endpoint measurable at200%');const c=geometry.clip;assert.ok(endpoint.x>=c.x-.5&&endpoint.x+endpoint.width<=c.x+c.width+.5&&endpoint.y>=c.y-.5&&endpoint.y+endpoint.height<=c.y+c.height+.5,'Both actual endpoints visible at200%');}
  unchanged(focus,before);await screenshot(entry,'zoom200');await physical(entry,'zoom-reset',{reserved:true});assert.ok(Math.abs((await adapter.call('inspect')).viewport.pageZoom-1)<.01);
  if(browserName==='chrome'){
    entry.zoomResetUiSettling={method:'fixed passive preparation wait',requestedDurationMs:2000,startedAt:now(),scope:'After measured reset, before the next locale. No read, input, retry, reactivation or authority during the wait; subsequent ordinary guards remain mandatory.'};save();
    await wait(2000);entry.zoomResetUiSettling.finishedAt=now();
    const afterResetWait=await adapter.call('inspect');assert.ok(Math.abs(afterResetWait.viewport.pageZoom-1)<.01,'Actual zoom1 persists after reset preparation');entry.zoomResetUiSettling.followingViewport=afterResetWait.viewport;
  }
  return 'PASS';
}
function released(finish){assert.equal(finish.traceOverflow,false);assert.equal(finish.policyOverflow,false);assert.deepEqual(finish.policyViolations,[]);const d=finish.disposed;assert.equal(d.nativeTrace.overflow,false);assert.deepEqual(d.native,{sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});for(const value of Object.values(d.ui))assert.equal(value,0);for(const key of ['listeners','observers','continuations','retainedInputBytes','retainedRecoveryRegions'])assert.equal(d.mounted.dom[key],0);assert.deepEqual(d.mounted.selection,{bookmarks:0,restoreTickets:0,activePointers:0,animationFrames:0});assert.deepEqual(d.mounted.clipboard,{pending:0,continuations:0,retainedTextBytes:0});assert.deepEqual(d.mounted.hostRequests,{pending:0,focusContinuations:0});for(const key of ['sessions','listeners','queued_mutations','queued_bytes','pending_tickets','host_requests','task_continuations','callback_errors'])assert.equal(d.mounted.sdk[key],0);}

try {
  assert.equal(process.platform,'darwin');assert.equal(process.version,'v24.22.0');report.nodeVersion=process.version;
  report.os={version:run('/usr/bin/sw_vers',['-productVersion']).stdout.trim(),build:run('/usr/bin/sw_vers',['-buildVersion']).stdout.trim()};
  const identity=computeSdkBuildIdentity(),built=JSON.parse(readFileSync('artifacts/sdk-build-identity.json','utf8'));assert.equal(identity.buildId,built.buildId);assert.deepEqual(identity.sourceHashes,built.sourceHashes);report.buildId=identity.buildId;
  const seal=JSON.parse(readFileSync('artifacts/sdk-wasm-seal.json','utf8'));assert.equal(seal.build_id,identity.buildId);assert.equal(seal.sealed_sha256,pin('packages/wasm/dist/editor_wasm_bg.wasm').sha256);report.seal=seal;
  const paths=[...new Set([...Object.keys(identity.sourceHashes),...walk('contracts/ui/v1'),...walk('contracts/ui/v1.1'),...walk('scripts/ui-native'),...['wasm','sdk','dom','kwdj','ui'].flatMap(name=>walk(`packages/${name}/dist`)),
    'scripts/ui-native-acceptance.mjs',earlySpacingAccentBinding.source.path,'scripts/dom-native-input-source.swift','scripts/selection-native/protocol.mjs','scripts/workspace-server.mjs','scripts/ui-semantic-data.mjs','spikes/workspace/ui-host.js','spikes/workspace/ui.html','spikes/workspace/ui-fixture.css','examples/notes-extension/dom.mjs','examples/notes-extension/dom-inventory.mjs','artifacts/extensions/packet.json','artifacts/sdk-build-identity.json','artifacts/sdk-wasm-seal.json'])].sort();
  report.source={head:run('git',['rev-parse','HEAD']).stdout.trim(),dirty:run('git',['status','--porcelain']).stdout.trim(),pins:paths.map(pin)};assert.equal(report.source.head,expectedHead);assert.equal(report.source.dirty,'','Commit the exact prepared harness/fixture before installed acceptance');
  const configBytes=readFileSync(configPath);assert.ok(configBytes.length<=4096);config=JSON.parse(configBytes);configSha=hash(configBytes);assert.equal(config.format,'osr42-ui-http-broker/1');assert.equal(config.fixtureUrl,'http://127.0.0.1:4174/ui');assert.equal(config.title,'KlenWriter UI native '+config.nonce);assert.ok(Date.now()<config.expiresAt);report.broker={configPath,configSha256:configSha,nonce:config.nonce};
  const bundle=browserName==='chrome'?'/Applications/Google Chrome.app/Contents/Info.plist':'/Applications/Safari.app/Contents/Info.plist';report.bundleVersion=run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',bundle]).stdout.trim();report.bundleBuild=run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleVersion',bundle]).stdout.trim();assert.equal(report.bundleVersion,option('--expected-version'));
  assert.equal(run('/usr/bin/osascript',['-e','tell application "System Events" to get UI elements enabled']).stdout.trim(),'true','Use existing permissions only, no reset/login/request flow');
  const helpers=mkdtempSync(resolve(dirname(outputPath),'ui42-native-helpers-'));sourceHelper=resolve(helpers,'input-source');inputHelper=resolve(helpers,'fixture-input');const keySource=resolve(helpers,'fixed-keys.applescript');keyScriptPath=resolve(helpers,'fixed-keys.scpt');writeFileSync(keySource,fixedKeyScript,{flag:'wx'});
  const helperExecutions=[run('/usr/bin/swiftc',['scripts/dom-native-input-source.swift','-O','-o',sourceHelper]),run('/usr/bin/swiftc',['scripts/ui-native/guard.swift','-O','-o',inputHelper]),run('/usr/bin/osacompile',['-o',keyScriptPath,keySource])];
  if(browserName==='chrome'){findKeyHelper=resolve(helpers,'find-key');helperExecutions.push(run('/usr/bin/swiftc',['scripts/ui-native/find-key.swift','-O','-o',findKeyHelper]));}
  report.setup.push({action:'compile-closed-fixture-helpers',executions:helperExecutions});chmodSync(keyScriptPath,0o444);report.helperArtifacts=[sourceHelper,inputHelper,keySource,keyScriptPath,...(findKeyHelper?[findKeyHelper]:[])].map(absolutePin);
  if(browserName==='chrome'){preflightChromeFindHelper();save();}
  const initial=source();coherent(initial,initial.current.id);originalSource=initial.current.id;report.initialInputSources=initial;for(const id of ['com.apple.keylayout.US','com.apple.keylayout.Russian'])assert.ok(initial.sources.some(s=>s.id===id&&s.enabled&&s.selectable),'Existing source '+id);
  adapter=await(browserName==='chrome'?createChromeAdapter({config,report,inputHelper,keyScriptPath,findKeyHelper,run,save,outputPath}):createSafariAdapter({config,report,inputHelper,keyScriptPath,run,outputPath}));await adapter.navigate();assert.equal(report.browserVersion,report.bundleVersion);
  let blocked=false;
  for(const lane of report.locales){
    const locale=lane.locale;
    for(const entry of lane.cases){const caseId=entry.caseId;if(developmentCase!==undefined&&caseId!==developmentCase){entry.reason="Development-only OSR42_NATIVE_DEVELOPMENT_CASE=modes-zoom: excluded from this targeted run";continue;}save();if(blocked){entry.reason='Earlier failure/unknown completion disables further physical actions';continue;}entry.startedAt=now();
      let prepareAttempted=false,prepared=null;
      try {
        await adapter.focus();await selectSource(caseId.startsWith('composition-')?'com.apple.keylayout.US':lane.inputSourceId);prepareAttempted=true;prepared=await adapter.call('prepare',locale,caseId);entry.prepared=prepared;assert.equal(prepared.before.native.context.build_id,identity.buildId);entry.status=await perform(entry,prepared);await screenshot(entry,'final');
      }catch(error){entry.status=prepared?'FAILED':'NOT_RUN';entry.error={message:error.message,stack:error.stack,execution:error.execution??null};blocked=true;}
      finally {
        if(adapter.keysPending)try{entry.ownedKeyCleanup=await adapter.releaseOwnedKeys();entry.status='FAILED';blocked=true;}catch(error){entry.keyCleanupError=error.message;entry.status='FAILED';blocked=true;}
        if(adapter.pointerDown)try{entry.ownedPointerCleanup=await adapter.releaseOwnedPointer();entry.status='FAILED';blocked=true;}catch(error){entry.pointerCleanupError=error.message;entry.status='FAILED';blocked=true;}
        if(prepareAttempted){try{entry.finish=await adapter.call('finish');released(entry.finish);}catch(error){entry.finishError={message:error.message,execution:error.execution??null};entry.status='FAILED';blocked=true;}}
        if(adapter.inputDisabled)blocked=true;entry.finishedAt=now();save();
      }
    }
    lane.status=lane.cases.every(c=>c.status==='PASS')?'PASS':lane.cases.some(c=>c.status==='FAILED')?'FAILED':'INCOMPLETE';
  }
  assert.deepEqual(adapter.errors,[]);report.pageErrors=adapter.errors;report.status=report.locales.every(l=>l.status==='PASS')?'PASSED':report.locales.some(l=>l.status==='FAILED')?'FAILED':'INCOMPLETE';
} catch(error){report.error={message:error.message,stack:error.stack,execution:error.execution??null};report.status=report.physicalActions.length?'FAILED':'NOT_RUN';}
finally {
  if(adapter)try{await adapter.close();}catch(error){report.browserCleanupError={message:error.message,execution:error.execution??null};report.status='FAILED';}
  // Restore after closing the owned browser: per-app source switching can occur
  // at window departure. Original failed rows are never rewritten by cleanup.
  if(originalSource)try{const selected=await selectSource(originalSource),readbacks=[selected];for(let i=0;i<4;i++){await wait(100);const status=source();coherent(status,originalSource);readbacks.push(status);}report.restoration={status:'RESTORED',originalSource,readbacks};}catch(error){report.restoration={status:'FAILED',error:error.message,execution:error.execution??null};report.status='FAILED';}
  try {
    if(report.source){report.sourceAfter={head:run('git',['rev-parse','HEAD']).stdout.trim(),dirty:run('git',['status','--porcelain']).stdout.trim(),pins:report.source.pins.map(p=>pin(p.path))};report.sourceUnchanged=JSON.stringify(report.source)===JSON.stringify(report.sourceAfter);report.sourceClean=report.source.dirty===''&&report.sourceAfter.dirty==='';}else{report.sourceUnchanged=false;report.sourceClean=false;}
    if(report.helperArtifacts){report.helperArtifactsAfter=report.helperArtifacts.map(p=>absolutePin(p.path));report.helperArtifactsUnchanged=JSON.stringify(report.helperArtifacts)===JSON.stringify(report.helperArtifactsAfter);}
    if(report.broker){report.broker.configSha256After=hash(readFileSync(configPath));assert.equal(report.broker.configSha256After,configSha);}
    if(!report.sourceUnchanged||!report.sourceClean||!report.helperArtifactsUnchanged)report.status='FAILED';
  }catch(error){report.sourceIdentityError=error.message;report.status='FAILED';}
  report.counts=Object.fromEntries(['PASS','REFUSED','FAILED','UNOBSERVED','UNSUPPORTED','NOT_RUN'].map(status=>[status,report.locales.flatMap(l=>l.cases).filter(c=>c.status===status).length]));report.actualActionCount=report.physicalActions.length;report.finishedAt=now();save();
}
console.log(JSON.stringify({output:outputPath,status:report.status,counts:report.counts,actualActionCount:report.actualActionCount}));process.exitCode=report.status==='PASSED'?0:report.status==='FAILED'?1:2;
