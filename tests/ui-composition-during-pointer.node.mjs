// SPDX-License-Identifier: MIT OR Apache-2.0
// Seven finite source-authored policy controls; no editor/browser/helper/OS input.
// Reuse the private controlled AFTER-CLICK fixture, without changing its tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {afterFixture} from './ui-composition-after-click.node.mjs';
import {classifyCompositionDuringPointerObservation} from '../scripts/ui-native/composition-observation.mjs';
const cases=JSON.parse(readFileSync(new URL('../contracts/ui/v1.1/composition-during-pointer-observation/cases.json',import.meta.url),'utf8')).cases;
function duringFixture(){const f=afterFixture();Object.assign(f.input.gesture.nativeTrace.calls[0],{startedAt:154,finishedAt:155});return f;}
function during(f){return classifyCompositionDuringPointerObservation(f.input);}

test('DP01 one own settlement during actual matching pointer is only separately UNOBSERVED, including closed timing bounds',()=>{
  assert.equal(cases.find(c=>c.id==='DP01').expected.duringPointer,'UNOBSERVED');
  for(const timing of [{startedAt:154,finishedAt:155},{startedAt:150,finishedAt:161}]){
    const f=duringFixture();Object.assign(f.input.gesture.nativeTrace.calls[0],timing);const original=JSON.stringify(f.input),before=f.classify(),after=f.classifyAfter();
    assert.equal(before.classification,'FAILED');assert.equal(after.classification,'FAILED');
    const result=during(f);assert.equal(result.classification,'UNOBSERVED');assert.equal(result.phase,'DURING_POINTER');
    assert.equal(result.protectedGestureAcceptance,false);assert.equal(result.nativePositiveFromUntrustedTerminal,false);assert.equal(result.terminal.isTrusted,false);assert.equal(f.checks,1);
    assert.equal(JSON.stringify(f.input),original,'No synthetic checkpoint/times or input mutation');assert.equal(before.classification,'FAILED');assert.equal(after.classification,'FAILED');
    assert.equal(result.nativeCall.requestJson,f.input.gesture.nativeTrace.calls[0].requestJson);assert.equal(result.nativeCall.responseJson,f.input.gesture.nativeTrace.calls[0].responseJson);
  }
});
for(const [id,edit]of [
  ['DP02',f=>{Object.assign(f.input.gesture.nativeTrace.calls[0],{startedAt:149,finishedAt:150});}],
  ['DP03',f=>{Object.assign(f.input.gesture.nativeTrace.calls[0],{startedAt:161,finishedAt:162});}],
  ['DP04',f=>{for(const event of f.input.gesture.inputTrace.slice(3)){event.targetObject=102;event.target={id:'',tag:'BODY'};}}],
  ['DP05',f=>{f.input.gesture.nativeTrace.calls.push({...f.input.gesture.nativeTrace.calls[0],ordinal:2,startedAt:170,finishedAt:171,requestJson:JSON.stringify({kind:'command',stamp:f.input.gesture.native.state.stamp,command:{id:'org.klenwriter.kwdj/command/toggle-mark',payload_json:'{"kind":"toggle_mark","mark":{"type_id":"org.klenwriter.kwdj/strong","attributes":{}}}'},history_hint:{kind:'isolated'}})});}],
  ['DP06',f=>{f.input.gesture.dom.objects[1].text='foreign';}],
  ['DP07',f=>{const g=f.input.gesture;g.inputTrace.splice(1,1);g.inputTrace.forEach((row,index)=>{row.ordinal=index+1;});g.inputTraceCount--;g.composition.observedEnded=false;g.composition.terminals=[];}],
])test(`${id} separate DURING_POINTER negative never widens prior classifier or admits foreign target/replay`,()=>{
  assert.equal(cases.find(c=>c.id===id).expected.duringPointer,'FAILED');const f=duringFixture();edit(f);
  const result=during(f);assert.equal(result.classification,'FAILED');assert.equal(result.protectedGestureAcceptance,false);assert.equal(result.nativePositiveFromUntrustedTerminal,false);assert.equal(f.checks,0);
});
