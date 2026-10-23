// SPDX-License-Identifier: MIT OR Apache-2.0
// Finite installed43 protocol. Browser setup/RPC is never labelled physical input.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {computeSdkBuildIdentity} from './generate-sdk-types.mjs';
import {createChromeAdapter} from './slash-native/chrome-adapter.mjs';
import {createSafariAdapter} from './slash-native/safari-adapter.mjs';
import {fixedKeyScript} from './slash-native/input.mjs';
import {caseIds,keySpecs,keyText,limits} from './slash-native/protocol.mjs';
import {untrustedTerminalObservation} from './slash-native/terminal-observation.mjs';
import {observePointerAcknowledgement} from './slash-native/pointer-observation.mjs';
import {admitEarlyTerminal} from './slash-native/early-terminal-observation.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);
const args=process.argv.slice(2),baseNames=['--browser','--output','--broker','--head','--expected-version'],safariKeyBudgetFlag='--safari-key-guard-age-ms',names=args.includes(safariKeyBudgetFlag)?[...baseNames,safariKeyBudgetFlag]:baseNames;
if(args.length!==names.length*2||new Set(args.filter((_,i)=>i%2===0)).size!==names.length||args.filter((_,i)=>i%2===0).some(name=>!names.includes(name)))throw Error('Usage: node scripts/slash-native-acceptance.mjs --browser chrome|safari --output /fresh/outside/report.json --broker /fresh/outside/broker/config.json --head FULL_SHA --expected-version INSTALLED_VERSION [--safari-key-guard-age-ms 1500 (Safari only)]');
const option=name=>args[args.indexOf(name)+1],browserName=option('--browser'),expectedHead=option('--head');assert.ok(['chrome','safari'].includes(browserName));assert.match(expectedHead,/^[a-f0-9]{40}$/);
const safariKeyGuardAgeMs=names.includes(safariKeyBudgetFlag)?1500:1000;
if(names.includes(safariKeyBudgetFlag)){assert.equal(browserName,'safari','Safari-only explicit key-budget opt-in');assert.equal(option(safariKeyBudgetFlag),'1500','Only the closed1500ms opt-in is admitted');}
assert.equal(process.env.CFFIXED_USER_HOME,undefined,'Native parent must use the real OS environment');assert.equal(process.env.OSR42_NATIVE_DEVELOPMENT_CASE,undefined,'43 has no42 development selector');
const outside=value=>{assert.ok(value?.startsWith('/'));const path=resolve(value);assert.ok(path!==root&&!path.startsWith(root+'/'),'Evidence must remain outside checkout');return path;};
const outputPath=outside(option('--output')),configPath=outside(option('--broker'));assert.equal(existsSync(outputPath),false,'Preserve prior evidence; output must be fresh');mkdirSync(dirname(outputPath),{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),now=()=>new Date().toISOString(),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const pin=path=>{const bytes=readFileSync(resolve(root,path));return {path,bytes:bytes.length,sha256:hash(bytes),mode:(statSync(resolve(root,path)).mode&0o7777).toString(8).padStart(4,'0')};};
const absolutePin=path=>({...pin(path),path:resolve(path)});
const walk=path=>readdirSync(path,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(`${path}/${entry.name}`):entry.isFile()?[`${path}/${entry.name}`]:[]);
const oracle=JSON.parse(readFileSync('contracts/slash/installed-v1/oracles.json','utf8'));
const earlyTerminalLiteral=JSON.parse(readFileSync('contracts/slash/v1.1/installed-early-terminal/literal.json','utf8'));
const report={format:'editor-slash-installed/1',browser:browserName,expectedHead,status:'NOT_RUN',startedAt:now(),locales:['en','ru'].map(locale=>({locale,inputSourceId:'com.apple.keylayout.US',cases:caseIds.filter(id=>id.endsWith('-'+locale)).map(caseId=>({locale,caseId,status:'NOT_RUN',actualActionCount:0,preparation:[],checkpoints:[],startedAt:null}))})),physicalActions:[],setup:[],restoration:null,
 historyObservability:{publicHistoryFields:['undo_entries','redo_entries','retained_bytes'],openTypingGroup:{status:'NOT_EXPOSED_BY_PUBLIC_DTO',directObservation:false,basis:'Fresh genuine session plus exact isolated history_hint request and one native unit Undo/Redo; no internal group-state boolean is observed or invented'}},
 scope:'Installed43 platform System Events/CGEvent with independent AX/DOM/native facts; not hardware provenance or42 proof. Missing genuine composition opportunity remains UNOBSERVED; no retry/normalization/classifier inheritance, screenshots, AT/CJK/mobile or independent-review claim.'};
report.inputGuardBudget={defaultMs:limits.guardAgeMs,safariFixedKeyMs:safariKeyGuardAgeMs,selection:names.includes(safariKeyBudgetFlag)?'explicit Safari1500 opt-in; owner approval required before use':'original43 default1000',scope:'Safari fixed SystemEvents key cycle and same-owner UP cleanup; Chrome/pointer/bootstrap/inspect remain1000; no retry'};
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
    assert.deepEqual(actual,{format:'osr43-chrome-find-key-result/1',status:'refused',delivery:'not_sent',method:'CGEvent/cghidEventTap',request:{},programId:null,program:null,postedTransitions:[],postedCount:0,preflightProofs:[],core:null,postcondition:{status:'not_attempted',expectedPhase:null,observedPhase:null,reads:0,proof:null,diagnostic:null},diagnostic:{code:'request',reason:'Invalid closed request'},elapsedMs:actual.elapsedMs});
    stage.status='PASSED';stage.validationExitCode=0;
  }catch(error){stage.status='FAILED';stage.validationExitCode=1;stage.error={message:error.message};throw error;}
  finally{stage.finishedAt=now();}
}
let adapter=null,inputHelper=null,sourceHelper=null,keyScriptPath=null,findKeyHelper=null,originalSource=null,selectedSource=null,config=null,configSha=null,sourceWindowReadiness=false;
const source=()=>JSON.parse(run(sourceHelper,['status'],{fullStdout:true}).stdout);
function coherent(value,id){assert.equal(value.status,'ok');assert.equal(value.current.id,id);assert.equal(value.current.selected,true);assert.equal(value.current.enabled,true);assert.equal(value.current.selectable,true);assert.ok(value.sources.some(x=>x.id===id&&x.selected&&x.enabled&&x.selectable));}
async function selectSource(id){
 const before=source();coherent(before,before.current.id);
 if(before.current.id===id){
  coherent(before,id);report.setup.push({action:'keep-existing-source',requested:id,actual:before,selectionInvoked:false});selectedSource=id;return before;
 }
 const execution=run(sourceHelper,['select',id],{fullStdout:true}),result=JSON.parse(execution.stdout);assert.equal(result.status,'ok');report.setup.push({action:'select-existing-source',before,execution,result});await wait(250);const actual=source();coherent(actual,id);selectedSource=id;
 if(sourceWindowReadiness&&typeof adapter?.awaitSourceWindowReady==='function')await adapter.awaitSourceWindowReady(id);
 if(sourceWindowReadiness&&browserName==='safari'){
  const stage={action:'passive-safari-source-settle',status:'preparing',requested:id,durationMs:1000,before:actual,elapsedMs:null,actual:null};report.setup.push(stage);const began=process.hrtime.bigint();
  try{
   await wait(1000);stage.elapsedMs=Number(process.hrtime.bigint()-began)/1e6;assert.ok(Number.isFinite(stage.elapsedMs)&&stage.elapsedMs>=0&&stage.elapsedMs<2000,'Safari source settling delay exceeded its bound');
   stage.actual=source();coherent(stage.actual,id);stage.status='completed';return stage.actual;
  }catch(error){stage.status='refused';stage.error={message:error.message,execution:error.execution??null};throw error;}
 }
 return actual;
}
const roles=value=>Object.fromEntries(value.native.rows.map(row=>[JSON.stringify(row.path),row.node.id]));
const ids=value=>value.native.rows.map(row=>row.node.id).sort();
const events=(value,kind)=>value.native.events.filter(e=>e.change.kind===kind);
function bind(value,paths){const index=roles(value);return Object.fromEntries(Object.entries(paths).map(([role,path])=>{assert.ok(index[JSON.stringify(path)],'Authored genuine path '+role);return[role,index[JSON.stringify(path)]];}));}
function resolveTokens(value,bound){if(typeof value==='string'&&value.startsWith('$')){assert.ok(bound[value.slice(1)]);return bound[value.slice(1)];}if(Array.isArray(value))return value.map(x=>resolveTokens(x,bound));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolveTokens(v,bound)]));return value;}
function clean(value){assert.equal(value.traceOverflow,false);assert.equal(value.policyOverflow,false);assert.equal(value.errorOverflow,false);assert.deepEqual(value.policyViolations,[]);assert.deepEqual(value.errors,[]);assert.equal(value.nativeTrace.enabled,true);assert.equal(value.nativeTrace.overflow,false);assert.equal(value.facts.nativeTrace.overflow,false);assert.equal(value.facts.resources.sdk.callback_errors,0);}
function unchanged(actual,before){assert.equal(actual.native.canonical,before.native.canonical);assert.deepEqual(actual.native.state,before.native.state);assert.deepEqual(actual.native.rows,before.native.rows);assert.deepEqual(actual.native.events,before.native.events);}
function purePresentation(actual,before){
 unchanged(actual,before);assert.deepEqual(actual.dom.selection,before.dom.selection);assert.deepEqual(actual.dom.active,before.dom.active);assert.equal(actual.dom.activeObject,before.dom.activeObject);assert.deepEqual(actual.page,before.page);
 // Root ARIA is the explicitly owned presentation. Preserve every other actual
 // object/attribute/text while requiring the exact current genuine option ID.
 const strip=value=>value.dom.objects.map((row,i)=>i===0?{...row,attributes:row.attributes.filter(([name])=>!['aria-haspopup','aria-controls','aria-activedescendant'].includes(name))}:row);
 assert.deepEqual(strip(actual),strip(before));assert.equal(actual.dom.rootObject,before.dom.rootObject);
 assert.equal(actual.picker.aria['aria-haspopup'],'listbox');assert.equal(actual.picker.aria['aria-controls'],before.picker.elementId);
 const selected=actual.picker.items.find(item=>item.selected);assert.ok(selected);assert.equal(actual.picker.aria['aria-activedescendant'],selected.elementId);
 assert.equal(actual.native.resources.popupPresentation.handles,before.native.resources.popupPresentation.handles);
}
function currentRows(value){
 // NodeView.stamp is the actual read's full current stamp. These finite
 // installed fixtures have only the edited ancestry/new topology; all live
 // rows therefore have a changed_revision at this document revision.
 for(const row of value.native.rows){assert.deepEqual(row.node.stamp,value.native.state.stamp);assert.equal(row.node.changed_revision,value.native.state.stamp.revision);}
}
function structuralRows(value){
 // Temporal fields are verified by currentRows, not discarded as drift.
 // Preserve complete ordered paths, IDs, links, attributes, marks, content,
 // children and stats when checking Undo/Redo's historical structure.
 return value.native.rows.map(({node,...row})=>{const {stamp,changed_revision,...structure}=node;return {...row,node:structure};});
}
function commandCalls(actual,before){return actual.nativeTrace.calls.slice(before.nativeTrace.calls.length).map(row=>({row,request:JSON.parse(row.requestJson),response:JSON.parse(row.responseJson)})).filter(row=>row.request.kind==='command');}
function delta(actual,before,amount=1){currentRows(actual);currentRows(before);for(const key of ['session','generation'])assert.equal(actual.native.state.stamp[key],before.native.state.stamp[key]);for(const key of ['revision','selection_epoch','history_epoch'])assert.equal(BigInt(actual.native.state.stamp[key])-BigInt(before.native.state.stamp[key]),BigInt(amount),key);assert.equal(events(actual,'document').length-events(before,'document').length,amount);assert.equal(events(actual,'state').length-events(before,'state').length,0);assert.equal(BigInt(actual.native.state.history.undo_entries)-BigInt(before.native.state.history.undo_entries),BigInt(amount));assert.equal(actual.native.state.history.redo_entries,'0');assert.equal(actual.native.state.saved_revision,'0');assert.equal(actual.native.state.dirty,true);assert.equal(actual.native.state.stored_marks,null);}
function fixture(value,key){const expected=oracle.fixtures[key],bound=bind(value,oracle.fixtureBinding.roles),p={kind:'text',node:bound.T,offset:expected.caretUtf16,affinity:'after'};assert.equal(value.native.canonical,expected.canonical,key+' exact canonical');assert.deepEqual(value.native.state.selection,{anchor:p,focus:p});return bound;}
function picker(value,expected,active=expected[0]??null){assert.equal(value.picker.visible,true);assert.deepEqual(value.picker.items.map(x=>x.id),expected);assert.equal(value.picker.active,active);assert.equal(value.dom.active.id,`${value.id}-editor`);assert.equal(value.native.hostAttributes.role,'textbox');assert.equal(value.native.hostAttributes['aria-haspopup'],'listbox');assert.equal(value.native.hostAttributes['aria-controls'],value.picker.elementId);assert.equal(value.native.hostAttributes['aria-expanded'],null);const selected=value.picker.items.find(item=>item.selected);assert.equal(value.native.hostAttributes['aria-activedescendant'],selected?.elementId??null);}
const allChoices=oracle.caseFamilies.N02.expected.filter.ids;
async function checkpoint(entry,label){const value=await adapter.call('checkpoint');clean(value);entry.checkpoints.push({label,value});save();return value;}
async function presentationCheckpoint(entry,label){
 // One passive presentation interval AFTER the original completed input ACK.
 // No retry/refresh/selection repair, and never used for a preedit opportunity.
 entry.preparation.push({action:'passive ordinary presentation',durationMs:50});await wait(50);return checkpoint(entry,label);
}
function keyAck(value,action,before,reserved){const spec=keySpecs[action],trace=value.inputTrace.slice(before),down=trace.filter(x=>x.event==='keydown'&&x.isTrusted&&x.code===spec.domCode),up=trace.filter(x=>x.event==='keyup'&&x.isTrusted&&x.code===spec.domCode);if(reserved)return{scope:'Reserved shortcut: actual platform/AX/focus, no invented DOM keyup',trustedDown:down,trustedUp:up};assert.ok(down.some(x=>x.shift===spec.modifiers.includes('shift')&&x.alt===spec.modifiers.includes('option')&&x.meta===spec.modifiers.includes('command')),'Actual trusted matching keydown');assert.ok(up.length,'Actual trusted matching keyup');return{trustedDown:down,trustedUp:up};}
async function physical(entry,action,{reserved=false}={}){
 coherent(source(),selectedSource);if(keyText[action])assert.equal(selectedSource,keyText[action].sourceId,'Frozen source before fixed text post');
 const before=await adapter.call('inspect'),row={locale:entry.locale,caseId:entry.caseId,action,status:'attempted',startedAt:now(),inputSourceBefore:source().current,inputTraceBefore:before.inputTraceCount};report.physicalActions.push(row);entry.actualActionCount++;save();
 try{row.proof=await adapter.input(action);row.status='completed';coherent(source(),selectedSource);row.inputSourceAfter=source().current;
  const after=keySpecs[action]?await adapter.call('inspect'):await observePointerAcknowledgement({inspect:()=>adapter.call('inspect'),wait,before,action:row,observations:row.pointerObservations=[]});
  if(keySpecs[action])row.domAcknowledgement=keyAck(after,action,row.inputTraceBefore,reserved);
  else{const trace=after.inputTrace.slice(row.inputTraceBefore),down=trace.filter(x=>x.event==='pointerdown'&&x.isTrusted&&x.button===0),up=trace.filter(x=>x.event==='pointerup'&&x.isTrusted&&x.button===0),click=trace.filter(x=>x.event==='click'&&x.isTrusted&&x.button===0);assert.equal(down.length,1);assert.equal(up.length,1);assert.equal(click.length,1);assert.equal(up[0].pointerId,down[0].pointerId);assert.equal(up[0].targetObject,down[0].targetObject);assert.equal(click[0].targetObject,down[0].targetObject);row.domAcknowledgement={down,up,click};}
  return after;
 }catch(error){row.status='failed';row.error={message:error.message,execution:error.execution??null};throw error;}finally{row.finishedAt=now();save();}
}
async function modeSetup(entry,value){const result=await adapter.call('setup',value);entry.preparation.push(result);assert.equal(result.status,'updated');assert.equal(result.mode,value==='readonly'?'readOnly':value);return result;}
async function ordinary(entry,action){const before=await checkpoint(entry,'before fixed ordinary '+action);await physical(entry,action);const after=await presentationCheckpoint(entry,'after actual ordinary '+action),expected=keyText[action];delta(after,before);assert.deepEqual(ids(after),ids(before));const calls=commandCalls(after,before);assert.equal(calls.length,1);assert.equal(calls[0].request.command.id,'org.klenwriter.kwdj/command/insert-text');assert.deepEqual(JSON.parse(calls[0].request.command.payload_json),{kind:'insert_text',text:expected.text});assert.deepEqual(calls[0].request.history_hint,{kind:'isolated'});assert.equal(calls[0].response.status,'ok');assert.equal(calls[0].response.value.kind,'mutation');assert.equal(calls[0].response.value.effect,'changed');assert.deepEqual(calls[0].response.value.state,after.native.state);assert.equal(after.native.ordinaryInputs.length-before.native.ordinaryInputs.length,1);const event=after.native.ordinaryInputs.at(-1);assert.equal(event.kind,'ordinary_input');assert.equal(event.inputType,'insertText');assert.equal(event.isTrusted,true);assert.equal(event.dataHint,expected.text);assert.ok(event.beforeWindow);assert.deepEqual(event.before,before.native.state.stamp);assert.deepEqual(event.after,after.native.state.stamp);assert.deepEqual(event.context,after.native.context);assert.deepEqual(event.selectionBefore,before.native.state.selection);assert.deepEqual(event.selectionAfter,after.native.state.selection);return after;}
function historyStep(actual,previous){
 currentRows(actual);currentRows(previous);
 for(const key of ['session','generation'])assert.equal(actual.native.state.stamp[key],previous.native.state.stamp[key]);
 for(const key of ['revision','selection_epoch','history_epoch'])assert.equal(BigInt(actual.native.state.stamp[key])-BigInt(previous.native.state.stamp[key]),1n);
 assert.equal(events(actual,'document').length-events(previous,'document').length,1);assert.equal(events(actual,'state').length-events(previous,'state').length,0);
 assert.equal(actual.native.state.saved_revision,'0');assert.equal(actual.native.state.dirty,true);assert.equal(actual.native.state.stored_marks,null);
 assert.deepEqual(actual.native.ordinaryInputs,previous.native.ordinaryInputs);assert.deepEqual(actual.native.results,previous.native.results);
}
async function history(entry,before,after){
 assert.equal((await adapter.call('setup','undo')).response.status,'ok');const undo=await checkpoint(entry,'host Undo: original literal/range/IDs');
 assert.equal(undo.native.canonical,before.native.canonical);assert.deepEqual(undo.native.state.selection,before.native.state.selection);currentRows(before);assert.deepEqual(structuralRows(undo),structuralRows(before));historyStep(undo,after);
 assert.equal(BigInt(undo.native.state.history.undo_entries),BigInt(after.native.state.history.undo_entries)-1n);assert.equal(undo.native.state.history.redo_entries,'1');
 assert.equal((await adapter.call('setup','redo')).response.status,'ok');const redo=await checkpoint(entry,'host Redo: same semantic bytes/IDs');
 assert.equal(redo.native.canonical,after.native.canonical);assert.deepEqual(redo.native.state.selection,after.native.state.selection);assert.deepEqual(structuralRows(redo),structuralRows(after));historyStep(redo,undo);
 assert.equal(redo.native.state.history.undo_entries,after.native.state.history.undo_entries);assert.equal(redo.native.state.history.redo_entries,'0');
}
async function accepted(entry,before,goldenKey){const after=await presentationCheckpoint(entry,'one isolated semantic acceptance'),golden=oracle.semanticGoldens[goldenKey],old=bind(before,oracle.fixtureBinding.roles),bound=bind(after,golden.rolesAfter);assert.equal(after.native.canonical,golden.afterCanonical);assert.deepEqual(after.native.state.selection,resolveTokens(golden.afterSelection,bound));for(const role of golden.ids.preserve)assert.equal(bound[role],old[role]);const fresh=golden.ids.fresh.map(role=>bound[role]);assert.equal(new Set(fresh).size,fresh.length);for(const id of fresh)assert.ok(!ids(before).includes(id));assert.equal(after.native.rows.length,Object.keys(golden.rolesAfter).length);delta(after,before);const expected=resolveTokens(golden.command,old);expected.payload={kind:goldenKey==='K04'?'insert_block':'accept_slash',...expected.payload};if(expected.payload.range)expected.payload.range.focus.affinity='after';const calls=commandCalls(after,before);assert.equal(calls.length,1);assert.equal(calls[0].request.command.id,expected.id);assert.deepEqual(JSON.parse(calls[0].request.command.payload_json),expected.payload);assert.deepEqual(calls[0].request.history_hint,{kind:'isolated'});assert.equal(calls[0].response.status,'ok');assert.equal(calls[0].response.value.kind,'mutation');assert.equal(calls[0].response.value.effect,'changed');assert.deepEqual(calls[0].response.value.state,after.native.state);const requests=after.nativeTrace.calls.slice(before.nativeTrace.calls.length).map(row=>JSON.parse(row.requestJson));assert.equal(requests.slice(0,requests.findIndex(x=>x.kind==='command')).filter(x=>x.kind==='set_selection').length,0);assert.equal(after.native.results.filter(x=>x.status==='submitted').length-before.native.results.filter(x=>x.status==='submitted').length,1);assert.equal(after.picker.hidden,true);assert.equal(after.native.resources.popupPresentation.handles,0);assert.equal(after.native.resources.hostRequests.pending,0);assert.equal(after.controls.find(control=>control.control==='add')?.expanded,'false');assert.equal(after.dom.active.id,`${after.id}-editor`);await history(entry,before,after);return after;}
async function spacingSettlement(entry,before,after){
 const literal=earlyTerminalLiteral;assert.equal(before.native.canonical,literal.beforeCanonical);assert.equal(after.native.canonical,literal.afterCanonical);
 const original=bind(before,literal.roles),current=bind(after,literal.roles);const beforePoint={kind:'text',node:original.T,offset:literal.beforeCaret,affinity:literal.affinity};assert.deepEqual(before.native.state.selection,{anchor:beforePoint,focus:beforePoint});assert.deepEqual(current,original);assert.equal(after.native.rows.length,Object.keys(literal.roles).length);
 const point={kind:'text',node:original.T,offset:literal.afterCaret,affinity:literal.affinity};assert.deepEqual(after.native.state.selection,{anchor:point,focus:point});delta(after,before);
 assert.deepEqual(after.native.ordinaryInputs,before.native.ordinaryInputs);assert.deepEqual(after.native.results,before.native.results);
 assert.equal(after.picker.hidden,true);assert.equal(after.native.resources.popupPresentation.handles,0);assert.equal(after.native.resources.hostRequests.pending,0);
 const calls=commandCalls(after,before);assert.equal(calls.length,1);const call=calls[0];assert.deepEqual(call.request.command,literal.command);assert.deepEqual(call.request.history_hint,literal.historyHint);
 assert.equal(call.response.status,'ok');assert.equal(call.response.value.kind,'mutation');assert.equal(call.response.value.effect,'changed');assert.deepEqual(call.response.value.state,after.native.state);
 await history(entry,before,after);
}
async function protectedAddObservation(entry,before,preedit){
 await physical(entry,'click-add');const gesture=await checkpoint(entry,'distinct original Add during unresolved composition');let failure=null;
 try{
  assert.equal(gesture.composition.open,true,'End during gesture is not preservation PASS');unchanged(gesture,preedit);assert.deepEqual(gesture.dom,preedit.dom);assert.equal(gesture.native.results.filter(x=>x.status==='submitted').length,0);
 }catch(error){failure={message:error.message,stack:error.stack};}
 if(failure||gesture.composition.observedEnded){
  entry.originalProtectionObservation={classification:failure?'FAILED':'PASSED_ASSERTIONS_ONLY',error:failure};
  assert.ok(failure,'Observed closure cannot authorize another completion key');
  const observation=admitEarlyTerminal({before,preedit,gesture,action:report.physicalActions.at(-1),expectedCommand:earlyTerminalLiteral.command});
  await spacingSettlement(entry,before,gesture);entry.earlyTerminalObservation={...observation,classification:'UNOBSERVED',semanticAndHistory:'exact_frozen_spacing_accent_verified'};
  entry.disposition='explicit_terminal_before_original_add_missing_open_window_'+observation.phase;return true;
 }
 return false;
}
async function perform(entry,prepared){
 // Bridge::open owns one ProtectionStart::Now until destroy; disposed still requires zero.
 // Source derivation: contracts/slash/v1.1/installed-live-resource-baseline.md.
 const before=prepared.before;clean(before);const definition=oracle.rows.find(x=>x.id===entry.caseId),family=oracle.caseFamilies[definition.family],n=entry.caseId.slice(4,7);fixture(before,family.setupFixture);assert.equal(before.native.state.stamp.generation,'1');assert.equal(before.native.state.saved_revision,'0');assert.equal(before.native.state.stored_marks,null);assert.deepEqual(before.facts.native,{sessions:1,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:1});assert.equal(before.native.state.stamp.revision,'0');assert.equal(before.native.state.stamp.selection_epoch,'1');assert.equal(before.native.state.stamp.history_epoch,'0');assert.equal(before.native.state.history.undo_entries,'0');assert.equal(before.native.state.history.redo_entries,'0');assert.equal(before.native.state.history.retained_bytes,'0');assert.equal(before.native.state.dirty,false);currentRows(before);
 if(n==='N01'){await ordinary(entry,'slash');if(entry.locale==='ru')await selectSource('com.apple.keylayout.Russian');for(const key of entry.locale==='ru'?['query-ru-w','query-ru-b','query-ru-n']:['query-p','query-a','query-r','query-a'])await ordinary(entry,key);const pre=await checkpoint(entry,'frozen pre-accept');fixture(pre,family.expected.checkpoints[0].fixture);picker(pre,family.expected.filter.ids,family.expected.filter.active);await selectSource('com.apple.keylayout.US');await physical(entry,'enter');await accepted(entry,pre,family.expected.acceptGolden);return'PASS';}
 if(n==='N02'){const pre=await ordinary(entry,'slash');fixture(pre,'Hslash');picker(pre,allChoices);await physical(entry,'click-quote');await accepted(entry,pre,'K02');return'PASS';}
 if(n==='N03'){for(const key of ['slash','query-p','query-a','query-r','query-a'])await ordinary(entry,key);const pre=await checkpoint(entry,'before Escape');fixture(pre,'Ppara');await physical(entry,'escape');const closed=await checkpoint(entry,'Escape retains literal');unchanged(closed,pre);assert.equal(closed.picker.hidden,true);const later=await ordinary(entry,'ordinary-en');fixture(later,'Pparaz');assert.equal(later.picker.hidden,true);return'PASS';}
 if(n==='N04'){const pre=await ordinary(entry,'slash');fixture(pre,'Pslash');await physical(entry,'tab');let v=await checkpoint(entry,'native Tab to Move');unchanged(v,pre);assert.equal(v.dom.active.control,'move');assert.equal(v.picker.hidden,true);await physical(entry,'tab');v=await checkpoint(entry,'native Tab to Drag');unchanged(v,pre);assert.equal(v.dom.active.control,'drag');assert.equal(v.picker.hidden,true);await physical(entry,'tab');v=await checkpoint(entry,'native Tab to Add');unchanged(v,pre);assert.equal(v.dom.active.control,'add');await physical(entry,'enter');v=await presentationCheckpoint(entry,'shared Add catalog');unchanged(v,pre);assert.deepEqual(v.picker.items.map(x=>x.id),allChoices);assert.equal(v.dom.activeObject,v.picker.items[0].object);await physical(entry,'enter');await accepted(entry,pre,'K04');return'PASS';}
 if(n==='N05'){for(const key of ['slash',...Array(4).fill('ordinary-en')])await ordinary(entry,key);const pre=await checkpoint(entry,'actual no-results');fixture(pre,'PZZZZ');picker(pre,[],null);assert.equal(pre.picker.status,entry.locale==='ru'?'Ничего не найдено':'No results');await physical(entry,'enter');const kept=await checkpoint(entry,'Enter consumed without paragraph');unchanged(kept,pre);assert.equal(kept.picker.visible,true);await physical(entry,'find',{reserved:true});const find=await checkpoint(entry,'uncancelled native Find');unchanged(find,pre);assert.equal(find.documentFocused,false);assert.ok(find.inputTrace.some(x=>x.isTrusted&&x.event==='keydown'&&x.code==='KeyF'&&x.meta&&!x.defaultPrevented));await physical(entry,'close-find',{reserved:true});const closed=await checkpoint(entry,'original Find return');unchanged(closed,pre);assert.equal(closed.documentFocused,true);return'PASS';}
 if(n==='N06'){await modeSetup(entry,'readonly');const readonly=await checkpoint(entry,'readOnly baseline');await physical(entry,'slash');const blocked=await checkpoint(entry,'readOnly slash refused');unchanged(blocked,readonly);assert.equal(blocked.native.ordinaryInputs.length,0);assert.equal(blocked.picker.hidden,true);await modeSetup(entry,'editable');{const focused=await adapter.call('setup','editor');entry.preparation.push(focused);assert.equal(focused.status,'completed');assert.equal(focused.response.status,'ok');}const pre=await ordinary(entry,'slash');fixture(pre,'Pslash');picker(pre,allChoices);await modeSetup(entry,'disabled');const disabled=await presentationCheckpoint(entry,'disabled baseline');await physical(entry,'click-add');await physical(entry,'click-recovery');const last=await checkpoint(entry,'disabled no replay');unchanged(last,disabled);fixture(last,'Pslash');assert.equal(last.picker.hidden,true);assert.equal(last.native.resources.hostRequests.pending,0);assert.equal(last.native.resources.popupPresentation.handles,0);assert.equal(last.dom.active.id,'ui-after');assert.equal(last.native.hostAttributes.contenteditable,'false');assert.equal(last.native.hostAttributes['aria-disabled'],'true');return'PASS';}
 if(n==='N07'){for(let i=0;i<8;i++){const v=await adapter.call('inspect');if(Math.abs(v.viewport.pageZoom-2)<.01)break;assert.ok(v.viewport.pageZoom<2);await physical(entry,'zoom-in',{reserved:true});}if(browserName==='chrome'){entry.preparation.push({action:'existing passive zoom preparation',durationMs:2000});await wait(2000);}const zoom=await checkpoint(entry,'actual guarded zoom200');unchanged(zoom,before);assert.ok(Math.abs(zoom.viewport.pageZoom-2)<.01);assert.equal(zoom.zoomEvidence.stableWindow,true);assert.equal(zoom.zoomEvidence.currentOuterWidth,before.zoomEvidence.currentOuterWidth);assert.equal(zoom.zoomEvidence.currentOuterHeight,before.zoomEvidence.currentOuterHeight);const pre=await ordinary(entry,'slash');picker(pre,allChoices);await physical(entry,'up');const up=await presentationCheckpoint(entry,'Up presentation only');purePresentation(up,pre);assert.equal(up.picker.active,allChoices.at(-1));await physical(entry,'down');const down=await presentationCheckpoint(entry,'Down presentation only');purePresentation(down,pre);assert.equal(down.picker.active,allChoices[0]);const active=down.picker.items.find(x=>x.selected),list=down.picker;assert.ok(active.rect.y>=list.rect.y+list.clientTop-.5&&active.rect.y+active.rect.height<=list.rect.y+list.clientTop+list.clientHeight+.5);assert.ok(down.page.scrollWidth<=down.page.clientWidth);for(const x of down.picker.items)assert.ok(x.rect.width>=32&&x.rect.height>=32);await physical(entry,'escape');const closed=await checkpoint(entry,'Escape presentation only');unchanged(closed,pre);await physical(entry,'zoom-reset',{reserved:true});if(browserName==='chrome'){entry.preparation.push({action:'existing passive reset preparation',durationMs:2000});await wait(2000);}const reset=await checkpoint(entry,'actual native zoom reset');assert.ok(Math.abs(reset.viewport.pageZoom-1)<.01);fixture(reset,'Pslash');return'PASS';}
 if(n==='N08'||n==='N09'){const pre=await ordinary(entry,'slash');fixture(pre,'Pslash');await physical(entry,'deadkey-acute');const preedit=await checkpoint(entry,'actual trusted preedit opportunity');entry.opportunity={starts:preedit.composition.starts,open:preedit.composition.open,terminals:preedit.composition.terminals};assert.equal(preedit.native.results.filter(x=>x.status==='submitted').length,0);if(!preedit.composition.starts||!preedit.composition.open){entry.disposition='UNOBSERVED: no still-open trusted native composition; no replacement input';return'UNOBSERVED';}unchanged(preedit,pre);assert.equal(preedit.picker.hidden,true);assert.equal(preedit.native.resources.popupPresentation.handles,0);if(n==='N09'&&await protectedAddObservation(entry,pre,preedit))return'UNOBSERVED';await physical(entry,'complete-e');const after=await adapter.call('settle');clean(after);entry.checkpoints.push({label:'actual fixed settlement',value:after});if(after.facts.lifecycle==='recoveryRequired'){entry.disposition='REFUSED: retained original native/recovery outcome';return'REFUSED';}assert.equal(after.facts.lifecycle,'ready');fixture(after,'Peacute');delta(after,pre);assert.deepEqual(ids(after),ids(pre));assert.equal(after.native.ordinaryInputs.length,1);const calls=commandCalls(after,pre);assert.equal(calls.length,1);assert.equal(calls[0].request.command.id,'org.klenwriter.kwdj/command/insert-text');assert.deepEqual(JSON.parse(calls[0].request.command.payload_json),{kind:'insert_text',text:'é'});assert.deepEqual(calls[0].request.history_hint,{kind:'isolated'});assert.equal(calls[0].response.status,'ok');assert.equal(calls[0].response.value.kind,'mutation');assert.equal(calls[0].response.value.effect,'changed');assert.deepEqual(calls[0].response.value.state,after.native.state);assert.equal(after.native.results.filter(x=>x.status==='submitted').length,0);await history(entry,pre,after);if(!(after.composition.ends>0&&!after.composition.open)){entry.terminalObservation=untrustedTerminalObservation(preedit,after,report.physicalActions.at(-1));entry.disposition=entry.terminalObservation.reason;return'UNOBSERVED';}assert.ok(after.composition.ends>0&&!after.composition.open);entry.disposition='observed_native_window_exact_settlement_no_slash_authority_or_replay';return'PASS';}
 assert.equal(n,'N10');await ordinary(entry,'slash');let pre=await ordinary(entry,'query-p');fixture(pre,'Mslashp');assert.equal(pre.picker.hidden,true);await selectSource('com.apple.keylayout.Russian');pre=await ordinary(entry,'ordinary-ru');fixture(pre,'Mslashpya');assert.equal(pre.picker.hidden,true);await selectSource('com.apple.keylayout.US');return'PASS';
}
function released(finish){clean(finish.before);assert.equal(finish.traceOverflow,false);assert.equal(finish.policyOverflow,false);assert.deepEqual(finish.policyViolations,[]);const d=finish.disposed;assert.equal(d.nativeTrace.overflow,false);assert.deepEqual(d.native,{sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});for(const key of oracle.cleanup.requiredZero.UI)assert.equal(d.ui[key],0);for(const value of Object.values(d.ui))assert.equal(value,0);for(const name of ['sdk','dom','selection','clipboard','hostRequests','inputObservations','popupPresentation'])for(const key of oracle.cleanup.requiredZero[name])assert.equal(d.mounted[name][key],0);}

try {
  assert.deepEqual(caseIds,oracle.inventory.fixedRowIds);assert.equal(oracle.inventory.rowsPerBrowser,20);
  const frozen=JSON.parse(readFileSync('contracts/slash/installed-v1/manifest.json','utf8'));for(const entry of frozen.files){const bytes=readFileSync('contracts/slash/installed-v1/'+entry.path);assert.equal(bytes.length,entry.bytes);assert.equal(hash(bytes),entry.sha256);}
  assert.equal(process.platform,'darwin');assert.equal(process.version,'v24.22.0');report.nodeVersion=process.version;
  report.os={version:run('/usr/bin/sw_vers',['-productVersion']).stdout.trim(),build:run('/usr/bin/sw_vers',['-buildVersion']).stdout.trim()};
  const identity=computeSdkBuildIdentity(),built=JSON.parse(readFileSync('artifacts/sdk-build-identity.json','utf8'));assert.equal(identity.buildId,built.buildId);assert.deepEqual(identity.sourceHashes,built.sourceHashes);report.buildId=identity.buildId;
  const seal=JSON.parse(readFileSync('artifacts/sdk-wasm-seal.json','utf8'));assert.equal(seal.build_id,identity.buildId);assert.equal(seal.sealed_sha256,pin('packages/wasm/dist/editor_wasm_bg.wasm').sha256);report.seal=seal;
  const paths=[...new Set([...Object.keys(identity.sourceHashes),...walk('contracts/ui/v1'),...walk('contracts/ui/v1.1'),...walk('scripts/ui-native'),...walk('scripts/slash-native'),...walk('contracts/slash'),...['wasm','sdk','dom','kwdj','ui'].flatMap(name=>walk(`packages/${name}/dist`)),
    'scripts/slash-native-acceptance.mjs','contracts/slash/v1.1/installed-command-payload.md','scripts/dom-native-input-source.swift','scripts/selection-native/protocol.mjs','scripts/workspace-server.mjs','scripts/ui-semantic-data.mjs','spikes/workspace/ui-host.js','spikes/workspace/ui.html','spikes/workspace/ui-fixture.css','examples/notes-extension/dom.mjs','examples/notes-extension/dom-inventory.mjs','artifacts/extensions/packet.json','artifacts/sdk-build-identity.json','artifacts/sdk-wasm-seal.json'])].sort();
  report.source={head:run('git',['rev-parse','HEAD']).stdout.trim(),dirty:run('git',['status','--porcelain']).stdout.trim(),pins:paths.map(pin)};assert.equal(report.source.head,expectedHead);assert.equal(report.source.dirty,'','Commit the exact prepared harness/fixture before installed acceptance');
  const configBytes=readFileSync(configPath);assert.ok(configBytes.length<=4096);config=JSON.parse(configBytes);configSha=hash(configBytes);assert.equal(config.format,'osr43-slash-http-broker/1');assert.equal(config.fixtureUrl,'http://127.0.0.1:4174/ui');assert.equal(config.title,'KlenWriter Slash native '+config.nonce);assert.ok(Date.now()<config.expiresAt);report.broker={configPath,configSha256:configSha,nonce:config.nonce};
  const bundle=browserName==='chrome'?'/Applications/Google Chrome.app/Contents/Info.plist':'/Applications/Safari.app/Contents/Info.plist';report.bundleVersion=run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',bundle]).stdout.trim();report.bundleBuild=run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleVersion',bundle]).stdout.trim();assert.equal(report.bundleVersion,option('--expected-version'));
  assert.equal(run('/usr/bin/osascript',['-e','tell application "System Events" to get UI elements enabled']).stdout.trim(),'true','Use existing permissions only, no reset/login/request flow');
  const helpers=mkdtempSync(resolve(dirname(outputPath),'slash43-native-helpers-'));sourceHelper=resolve(helpers,'input-source');inputHelper=resolve(helpers,'fixture-input');const keySource=resolve(helpers,'fixed-keys.applescript');keyScriptPath=resolve(helpers,'fixed-keys.scpt');writeFileSync(keySource,fixedKeyScript,{flag:'wx'});
  const helperExecutions=[run('/usr/bin/swiftc',['scripts/dom-native-input-source.swift','-O','-o',sourceHelper]),run('/usr/bin/swiftc',['scripts/slash-native/guard.swift','-O','-o',inputHelper]),run('/usr/bin/osacompile',['-o',keyScriptPath,keySource])];
  if(browserName==='chrome'){findKeyHelper=resolve(helpers,'find-key');helperExecutions.push(run('/usr/bin/swiftc',['scripts/slash-native/find-key.swift','-O','-o',findKeyHelper]));}
  report.setup.push({action:'compile-closed-fixture-helpers',executions:helperExecutions});chmodSync(keyScriptPath,0o444);report.helperArtifacts=[sourceHelper,inputHelper,keySource,keyScriptPath,...(findKeyHelper?[findKeyHelper]:[])].map(absolutePin);
  if(browserName==='chrome'){preflightChromeFindHelper();save();}
  const initial=source();coherent(initial,initial.current.id);originalSource=initial.current.id;report.initialInputSources=initial;for(const id of ['com.apple.keylayout.US','com.apple.keylayout.Russian'])assert.ok(initial.sources.some(s=>s.id===id&&s.enabled&&s.selectable),'Existing source '+id);
  adapter=await(browserName==='chrome'?createChromeAdapter({config,report,inputHelper,keyScriptPath,findKeyHelper,run,save,outputPath}):createSafariAdapter({config,report,inputHelper,keyScriptPath,run,outputPath,safariKeyGuardAgeMs}));await adapter.navigate();assert.equal(report.browserVersion,report.bundleVersion);sourceWindowReadiness=true;
  let blocked=false;
  for(const lane of report.locales){
    const locale=lane.locale;
    for(const entry of lane.cases){const caseId=entry.caseId;save();if(blocked){entry.reason='Earlier failure/unknown completion disables further physical actions';continue;}entry.startedAt=now();
      let prepareAttempted=false,prepared=null;
      try {
        await adapter.focus();await selectSource('com.apple.keylayout.US');prepareAttempted=true;prepared=await adapter.call('prepare',locale,caseId);entry.prepared=prepared;assert.equal(prepared.before.native.context.build_id,identity.buildId);entry.status=await perform(entry,prepared);
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
  sourceWindowReadiness=false;
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
