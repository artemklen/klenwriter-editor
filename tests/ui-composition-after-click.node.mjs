// SPDX-License-Identifier: MIT OR Apache-2.0
// Separate pure AFTER-CLICK policy controls. No browser/editor/native/helper/OS
// execution. Original CO01..03 source file and expectations remain unchanged.
// Controlled scaffolding follows ui-composition-observation.node.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classifyCompositionObservation,classifyCompositionAfterClickObservation,notesEarlySpacingAccentBinding} from '../scripts/ui-native/composition-observation.mjs';
const afterCases=JSON.parse(readFileSync(new URL('../contracts/ui/v1.1/composition-after-click-observation/cases.json',import.meta.url),'utf8'));
const clock={kind:'performance.now',timeOrigin:1700000000000},mount='ui42-1';
const command={id:'org.klenwriter.kwdj/command/insert-text',payload_json:'{"kind":"insert_text","text":"´"}'};
const stamp={session:'controlled-original',generation:'1',revision:'0',selection_epoch:'1',history_epoch:'0'};
const point=offset=>({kind:'text',node:'original-text',offset,affinity:'after'});
const beforeState={stamp,root:'original-root',selection:{anchor:point(1),focus:point(3)},stored_marks:null,dirty:false,saved_revision:'0',history:{undo_entries:'0',redo_entries:'0',retained_bytes:'100'}};
const afterState={...beforeState,stamp:{...stamp,revision:'1',selection_epoch:'2',history_epoch:'1'},selection:{anchor:point(2),focus:point(2)},dirty:true,history:{undo_entries:'1',redo_entries:'0',retained_bytes:'120'}};
const request={kind:'command',stamp,command,history_hint:{kind:'isolated'}};
const response={status:'ok',value:{kind:'mutation',effect:'changed',state:afterState,presentation:{active:'none'}}};
function baseFixture({terminal=true,trusted=false}={}){
  const event=(ordinal,time,name,fields={})=>({ordinal,time,event:name,mountId:mount,clock:{...clock},isTrusted:true,target:{id:`${mount}-editor`},...fields});
  const start=event(1,100,'compositionstart'),end=event(2,140,'compositionend',{isTrusted:trusted});
  const down=event(terminal?3:2,150,'pointerdown',{button:0,pointerId:17}),up=event(terminal?4:3,160,'pointerup',{button:0,pointerId:17});
  const stateValue=(at,state,trace,composition)=>({id:mount,caseId:'composition-format',locale:'en',observation:{mountId:mount,clock:{...clock},at},
    inputTrace:trace,inputTraceCount:trace.length,traceOverflow:false,
    composition,nativeTrace:{mountId:mount,clock:{...clock},enabled:true,overflow:false,calls:[]},
    facts:{context:{profile:{id:'controlled-profile'},session:'controlled-original',generation:'1'},stamp:state.stamp,lifecycle:'ready'},
    native:{state,canonical:state===beforeState?'abcd':'a´d',events:state===beforeState?[]:[{change:{kind:'document',from_revision:'0',to_revision:'1'}}]}});
  const empty={open:false,starts:0,ends:0,observedEnded:false,terminals:[]};
  const before=stateValue(90,beforeState,[],empty),preedit=stateValue(120,beforeState,[start],{...empty,open:true,starts:1});
  const gesture=stateValue(170,terminal?afterState:beforeState,[start,...terminal?[end]:[],down,up],{
    ...empty,open:!trusted,starts:1,ends:trusted?1:0,observedEnded:terminal,
    terminals:terminal?[{ordinal:2,time:140,isTrusted:trusted,mountId:mount,clock:{...clock}}]:[]});
  if(terminal)gesture.nativeTrace.calls.push({ordinal:1,mountId:mount,clock:{...clock},startedAt:141,finishedAt:149,outcome:'returned',error:null,requestJson:JSON.stringify(request),responseJson:JSON.stringify(response)});
  const input={before,preedit,gesture,action:{status:'completed',caseId:'composition-format',locale:'en',action:'click-strong',inputTraceBefore:1},expectedCommand:{...command}};
  let checks=0;
  input.verifySettlement=()=>{
    checks++;
    assert.equal(gesture.native.canonical,'a´d','Predeclared controlled semantic literal');
    assert.deepEqual(gesture.native.state,afterState,'Full original native response/state');
    assert.deepEqual(gesture.native.events,[{change:{kind:'document',from_revision:'0',to_revision:'1'}}]);
    return {scope:'CONTROLLED_VERIFIER_NOT_NATIVE_EXECUTION',canonical:'a´d',undoEntries:'1',originalTextId:'original-text'};
  };
  return {input,get checks(){return checks;},classify:()=>classifyCompositionObservation(input)};
}
const failed=(f,pattern)=>{const result=f.classify();assert.equal(result.classification,'FAILED');assert.equal(result.protectedGestureAcceptance,false);assert.equal(result.nativePositiveFromUntrustedTerminal,false);if(pattern)assert.match(result.error.message,pattern);return result;};
const rewriteRequest=(f,edit)=>{const row=f.input.gesture.nativeTrace.calls[0],value=JSON.parse(row.requestJson);edit(value);row.requestJson=JSON.stringify(value);};
const rewriteResponse=(f,edit)=>{const row=f.input.gesture.nativeTrace.calls[0],value=JSON.parse(row.responseJson);edit(value);row.responseJson=JSON.stringify(value);};


function afterFixture(){
  const f=baseFixture(),g=f.input.gesture;
  g.observation.at=180;g.nativeTrace.calls[0].startedAt=170;g.nativeTrace.calls[0].finishedAt=171;
  g.inputTrace.push({...g.inputTrace[3],ordinal:5,time:161,event:'click',detail:1});g.inputTraceCount=g.inputTrace.length;
  for(const event of g.inputTrace.slice(2))Object.assign(event,{isPrimary:true,targetObject:101,shift:false,alt:false,meta:false,ctrl:false});
  f.input.action.proof={pageGuard:{id:mount,mountedId:mount,caseId:'composition-format',action:'click-strong',target:'strong',targetObject:101,allowed:true}};
  const dom={html:'<p><span>a´d</span></p>',rootObject:9,objects:[{object:9,nodeType:1,tag:'DIV'},{object:10,nodeType:3,text:'a´d'}],selection:{rangeCount:1,anchor:{object:10,offset:2},focus:{object:10,offset:2}},active:{id:`${mount}-editor`,tag:'DIV'},activeObject:9};
  for(const checkpoint of [f.input.preedit,g]){
    checkpoint.dom=structuredClone(dom);checkpoint.documentFocused=true;
    checkpoint.native.results=[];checkpoint.native.focusResults=[];checkpoint.native.uiResources={hostRequests:0};checkpoint.native.dialog=null;
    checkpoint.facts.resources={hostRequests:{pending:0}};
    checkpoint.errors=[];checkpoint.policyViolations=[];checkpoint.errorOverflow=false;checkpoint.policyOverflow=false;
  }
  f.classifyAfter=()=>classifyCompositionAfterClickObservation(f.input);return f;
}
function afterFailed(f){const result=f.classifyAfter();assert.equal(result.classification,'FAILED');assert.equal(result.protectedGestureAcceptance,false);assert.equal(result.nativePositiveFromUntrustedTerminal,false);return result;}

test('AC01 completed click before one exact insertion is separately UNOBSERVED, preserving default failure and literal Notes source binding',()=>{
  assert.equal(afterCases.cases.find(c=>c.id==='AC01').expected.afterClick,'UNOBSERVED');
  const f=afterFixture(),bytesBefore=JSON.stringify(f.input),original=f.classify();assert.equal(original.classification,'FAILED');
  const result=f.classifyAfter();assert.equal(result.classification,'UNOBSERVED');assert.equal(result.phase,'AFTER_CLICK');
  assert.equal(result.protectedGestureAcceptance,false);assert.equal(result.nativePositiveFromUntrustedTerminal,false);assert.equal(result.terminal.isTrusted,false);assert.equal(f.checks,1);
  assert.equal(JSON.stringify(f.input),bytesBefore,'No fabricated checkpoint or timestamp transformation');assert.equal(original.classification,'FAILED');
  assert.equal(result.nativeCall.requestJson,f.input.gesture.nativeTrace.calls[0].requestJson);assert.equal(result.click.time,161);
  const source=JSON.parse(readFileSync(new URL('../contracts/ui/v1.1/composition-after-click-observation/notes-early-accent.json',import.meta.url),'utf8'));
  assert.deepEqual(notesEarlySpacingAccentBinding.command,source.command);assert.equal(notesEarlySpacingAccentBinding.afterText,source.afterText);assert.equal(notesEarlySpacingAccentBinding.afterCanonical,source.afterCanonical);
});
for(const [id,edit]of [
  ['AC02',f=>{f.input.gesture.nativeTrace.calls[0].clock.timeOrigin++;}],
  ['AC03',f=>{f.input.gesture.inputTrace.pop();f.input.gesture.inputTraceCount--;}],
  ['AC04',f=>{Object.assign(f.input.gesture.nativeTrace.calls[0],{startedAt:155,finishedAt:156});}],
  ['AC05',f=>{f.input.gesture.nativeTrace.calls.push({...f.input.gesture.nativeTrace.calls[0],ordinal:2,startedAt:172,finishedAt:173,requestJson:JSON.stringify({kind:'command',stamp:afterState.stamp,command:{id:'org.klenwriter.kwdj/command/toggle-mark',payload_json:'{"kind":"toggle_mark","mark":{"type_id":"org.klenwriter.kwdj/strong","attributes":{}}}'},history_hint:{kind:'isolated'}})});}],
  ['AC06',f=>{f.input.gesture.inputTrace[2].isTrusted=false;}],
  ['AC07',f=>rewriteRequest(f,q=>{q.command.payload_json='{"kind":"insert_text","text":"wrong"}';})],
  ['AC08',f=>{const g=f.input.gesture;g.inputTrace.splice(2,0,{...g.inputTrace[1],time:145});g.inputTrace.forEach((row,index)=>{row.ordinal=index+1;});g.inputTraceCount++;}],
  ['AC09',f=>{f.input.gesture.dom.selection.focus.offset=1;}],
  ['AC10',f=>{f.input.gesture.native.results.push({status:'submitted'});f.input.gesture.facts.resources.hostRequests.pending=1;}],
])test(`${id} frozen separate AFTER-CLICK negative stays FAILED in both classifiers`,()=>{
  assert.equal(afterCases.cases.find(c=>c.id===id).expected.afterClick,'FAILED');const f=afterFixture();edit(f);afterFailed(f);assert.equal(f.classify().classification,'FAILED');assert.equal(f.checks,0);
});
test('AFTER-CLICK requires explicit terminal even though default CO01 preservation path remains available',()=>{
  const f=baseFixture({terminal:false});assert.equal(f.classify().classification,'RUN_UNCHANGED_PRESERVATION_AND_FIXED_SETTLEMENT_ASSERTIONS');
  const result=classifyCompositionAfterClickObservation(f.input);assert.equal(result.classification,'FAILED');assert.match(result.error.message,/requires one explicit terminal/);assert.equal(f.checks,0);
});

for(const [name,edit]of [
  ['foreign target object',f=>{f.input.gesture.inputTrace[4].targetObject=102;}],
  ['foreign fixed guard',f=>{f.input.action.proof.pageGuard.target='move';}],
  ['absent click detail',f=>{delete f.input.gesture.inputTrace[4].detail;}],
  ['nonprimary down',f=>{f.input.gesture.inputTrace[2].isPrimary=false;}],
  ['replaced focused object',f=>{f.input.gesture.dom.activeObject=11;}],
  ['absent focused object',f=>{delete f.input.preedit.dom.activeObject;delete f.input.gesture.dom.activeObject;}],
])test(`AFTER-CLICK ${name} cannot supply the required actual gesture identity`,()=>{
  const f=afterFixture();edit(f);afterFailed(f);assert.equal(f.checks,0);
});
