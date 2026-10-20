// SPDX-License-Identifier: MIT OR Apache-2.0
// Pure source-case ordering controls, not browser/IME/native acceptance. The
// supplied settlement verifier stands in for the coordinator's unchanged full
// source-literal checks; it is never a factory for an expected native response.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classifyCompositionObservation} from '../scripts/ui-native/composition-observation.mjs';

const sourceCases=JSON.parse(readFileSync(new URL('../contracts/ui/v1.1/composition-observation/cases.json',import.meta.url),'utf8'));
const clock={kind:'performance.now',timeOrigin:1700000000000},mount='ui42-1';
const command={id:'org.klenwriter.kwdj/command/insert-text',payload_json:'{"kind":"insert_text","text":"´"}'};
const stamp={session:'controlled-original',generation:'1',revision:'0',selection_epoch:'1',history_epoch:'0'};
const point=offset=>({kind:'text',node:'original-text',offset,affinity:'after'});
const beforeState={stamp,root:'original-root',selection:{anchor:point(1),focus:point(3)},stored_marks:null,dirty:false,saved_revision:'0',history:{undo_entries:'0',redo_entries:'0',retained_bytes:'100'}};
const afterState={...beforeState,stamp:{...stamp,revision:'1',selection_epoch:'2',history_epoch:'1'},selection:{anchor:point(2),focus:point(2)},dirty:true,history:{undo_entries:'1',redo_entries:'0',retained_bytes:'120'}};
const request={kind:'command',stamp,command,history_hint:{kind:'isolated'}};
const response={status:'ok',value:{kind:'mutation',effect:'changed',state:afterState,presentation:{active:'none'}}};
function fixture({terminal=true,trusted=false}={}){
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

test('CO01 frozen source case keeps protected-window preservation and settlement mandatory',()=>{
  assert.equal(sourceCases.cases.find(c=>c.id==='CO01').expected.classification,'RUN_UNCHANGED_PRESERVATION_AND_FIXED_SETTLEMENT_ASSERTIONS');
  const f=fixture({terminal:false}),result=f.classify();assert.equal(result.classification,'RUN_UNCHANGED_PRESERVATION_AND_FIXED_SETTLEMENT_ASSERTIONS');assert.equal(f.checks,0);
});
for(const trusted of [false,true])test(`CO02 explicit ${trusted?'trusted':'untrusted'} early terminal plus exact completed insertion is only UNOBSERVED`,()=>{
  assert.equal(sourceCases.cases.find(c=>c.id==='CO02').expected.classification,'UNOBSERVED');
  const f=fixture({trusted}),result=f.classify();assert.equal(result.classification,'UNOBSERVED');assert.equal(result.protectedGestureAcceptance,false);assert.equal(result.nativePositiveFromUntrustedTerminal,false);assert.equal(result.terminal.isTrusted,trusted);assert.equal(f.checks,1);
  assert.equal(result.nativeCall.requestJson,f.input.gesture.nativeTrace.calls[0].requestJson);assert.equal(result.nativeCall.responseJson,f.input.gesture.nativeTrace.calls[0].responseJson);
});
test('CO02 native completion exactly at pointerdown bound is allowed with STRICTLY earlier terminal',()=>{
  const f=fixture();f.input.gesture.nativeTrace.calls[0].finishedAt=150;assert.equal(f.classify().classification,'UNOBSERVED');
});
for(const [name,edit,pattern]of [
  ['missing completion time',f=>{f.input.gesture.nativeTrace.calls[0].finishedAt=null;},/completed call timing/],
  ['completion after pointerdown',f=>{f.input.gesture.nativeTrace.calls[0].finishedAt=150.001;},/BEFORE/],
  ['native call before genuine preedit',f=>{f.input.gesture.nativeTrace.calls[0].startedAt=119;},/BEFORE/],
  ['wrong native clock',f=>{f.input.gesture.nativeTrace.calls[0].clock.timeOrigin++;},/document clock/],
  ['wrong checkpoint clock',f=>{f.input.gesture.observation.clock.timeOrigin++;},/document clock/],
  ['wrong event mount',f=>{f.input.gesture.inputTrace[2].mountId='foreign';},/Original|strictEqual|equal/i],
  ['wrong call mount',f=>{f.input.gesture.nativeTrace.calls[0].mountId='foreign';},/equal/i],
  ['untrusted start',f=>{f.input.preedit.inputTrace[0].isTrusted=false;},/Trusted start/],
  ['start belongs to foreign editor',f=>{f.input.preedit.inputTrace[0].target.id='foreign-editor';},/Trusted start/],
  ['preedit already terminal',f=>{f.input.preedit.composition.observedEnded=true;},/equal/i],
  ['missing genuine current stamp',f=>{f.input.gesture.facts.stamp={...stamp};},/current native checkpoint/],
  ['wrong context',f=>{f.input.gesture.facts.context={session:'foreign'};},/profile\/context/],
  ['terminal at pointerdown',f=>{const g=f.input.gesture;g.inputTrace[1].time=150;g.composition.terminals[0].time=150;},/STRICTLY/],
  ['terminal after pointerdown',f=>{const g=f.input.gesture;g.inputTrace[1].time=151;g.composition.terminals[0].time=151;},/ordering|STRICTLY/],
  ['native exception has no response',f=>{Object.assign(f.input.gesture.nativeTrace.calls[0],{outcome:'threw',responseJson:null,error:{name:'Error',message:'original'}});},/exception|unknown/],
  ['wrong insertion payload',f=>rewriteRequest(f,q=>{q.command.payload_json='{"kind":"insert_text","text":"x"}';}),/Exact original/],
  ['wrong original stamp',f=>rewriteRequest(f,q=>{q.stamp.selection_epoch='2';}),/Exact original/],
  ['nonisolated history',f=>rewriteRequest(f,q=>{q.history_hint={kind:'typing'};}),/Exact original/],
  ['unknown native response',f=>rewriteResponse(f,r=>{r.status='fatal';}),/completed native insertion/],
  ['original response differs from final native state',f=>rewriteResponse(f,r=>{r.value.state.history.undo_entries='2';}),/current native state/],
  ['action did not complete',f=>{f.input.action.status='failed';},/guarded action/],
  ['pointerup missing',f=>{f.input.gesture.inputTrace.pop();f.input.gesture.inputTraceCount--;},/matching up/],
])test(`CO03 ${name} fails without inferred order or positive promotion`,()=>{
  assert.equal(sourceCases.cases.find(c=>c.id==='CO03').expected.classification,'FAILED');const f=fixture();edit(f);failed(f,pattern);assert.equal(f.checks,0);
});
test('CO03 extra deferred toolbar command fails even when the first insertion is exact',()=>{
  const f=fixture(),row={...f.input.gesture.nativeTrace.calls[0],ordinal:2,startedAt:151,finishedAt:152,requestJson:JSON.stringify({kind:'command',stamp:afterState.stamp,command:{id:'org.klenwriter.kwdj/command/toggle-mark',payload_json:'{"kind":"toggle_mark","mark":{"type_id":"org.klenwriter.kwdj/strong","attributes":{}}}'},history_hint:{kind:'isolated'}})};
  f.input.gesture.nativeTrace.calls.push(row);failed(f,/Exactly one/);assert.equal(f.checks,0);
});
test('CO03 additional state-only selection mutation cannot masquerade as a read',()=>{
  const f=fixture();f.input.gesture.nativeTrace.calls.push({...f.input.gesture.nativeTrace.calls[0],ordinal:2,startedAt:151,finishedAt:152,requestJson:JSON.stringify({kind:'set_selection',stamp:afterState.stamp,selection:afterState.selection})});failed(f,/additional semantic mutation/);
});
test('CO03 native publication without any observed terminal cannot bypass preservation',()=>{
  const f=fixture({terminal:false});f.input.gesture.nativeTrace.calls=fixture().input.gesture.nativeTrace.calls;failed(f,/inferred/);
});
test('CO03 missing full semantic verifier cannot produce UNOBSERVED',()=>{
  const f=fixture();delete f.input.verifySettlement;failed(f,/semantic assertions/);
});
test('CO03 unchanged canonical/history/identity assertion failure remains FAILED',()=>{
  const f=fixture();f.input.gesture.native.canonical='wrong';failed(f,/controlled semantic literal/);assert.equal(f.checks,1);
});
test('CO03 byte-exact request serialization cannot be replaced by equivalent parsed JSON',()=>{
  const f=fixture(),row=f.input.gesture.nativeTrace.calls[0];row.requestJson=' '+row.requestJson;failed(f,/serialized request bytes/);
});
