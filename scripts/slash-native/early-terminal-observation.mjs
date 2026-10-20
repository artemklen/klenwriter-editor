// SPDX-License-Identifier: MIT OR Apache-2.0
// Pure observation admission only. Native literal/history verification is separate.
import assert from 'node:assert/strict';
const reads=new Set(['state','node','catalog','query_command','text_window','events','acknowledge_events','snapshot','release_snapshot']);
const command={id:'org.klenwriter.kwdj/command/insert-text',payload_json:'{"kind":"insert_text","text":"´"}'};
const pslash='{"content":[{"attrs":{"align":"center","first_line_indent":true},"content":[{"text":"pre / tail","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}';
const finite=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
function clock(actual,expected){assert.equal(actual?.kind,'performance.now');assert.ok(finite(actual.timeOrigin)&&actual.timeOrigin>0);assert.deepEqual(actual,expected);}
export function admitEarlyTerminal({before,preedit,gesture,action,expectedCommand}){
 assert.deepEqual(expectedCommand,command,'Only frozen43 spacing-accent binding');
 const mount=before.id,c=before.observation.clock;
 assert.ok(typeof mount==='string'&&mount.length>0);assert.match(before.caseId,/^I43-N09-(en|ru)$/);assert.equal(before.locale,before.caseId.slice(-2));clock(c,c);
 for(const v of [before,preedit,gesture]){
  assert.equal(v.id,mount);assert.equal(v.caseId,before.caseId);assert.equal(v.locale,before.locale);
  assert.equal(v.observation.mountId,mount);clock(v.observation.clock,c);assert.ok(finite(v.observation.at));
  assert.equal(v.nativeTrace.mountId,mount);clock(v.nativeTrace.clock,c);assert.equal(v.nativeTrace.enabled,true);assert.equal(v.nativeTrace.overflow,false);
  assert.equal(v.traceOverflow,false);assert.equal(v.policyOverflow,false);assert.equal(v.errorOverflow,false);assert.deepEqual(v.errors,[]);assert.deepEqual(v.policyViolations,[]);
  assert.ok(Array.isArray(v.inputTrace)&&v.inputTrace.length<=16384);assert.equal(v.inputTraceCount,v.inputTrace.length);
  assert.ok(Array.isArray(v.nativeTrace.calls)&&v.nativeTrace.calls.length<=16384);
  assert.equal(v.facts.lifecycle,'ready');assert.deepEqual(v.facts.context,before.facts.context);assert.deepEqual(v.native.context,before.native.context);assert.deepEqual(v.facts.stamp,v.native.state.stamp);
 }
 assert.ok(before.observation.at<=preedit.observation.at&&preedit.observation.at<=gesture.observation.at);
 assert.equal(before.native.canonical,pslash);assert.deepEqual(preedit.native.state,before.native.state);assert.deepEqual(preedit.native.rows,before.native.rows);assert.deepEqual(preedit.native.events,before.native.events);assert.equal(preedit.native.canonical,before.native.canonical);
 assert.deepEqual(preedit.composition,{open:true,starts:1,ends:0,observedEnded:false,terminals:[]});
 assert.deepEqual(preedit.inputTrace.slice(0,before.inputTrace.length),before.inputTrace);assert.deepEqual(gesture.inputTrace.slice(0,preedit.inputTrace.length),preedit.inputTrace);
 assert.deepEqual(preedit.nativeTrace.calls.slice(0,before.nativeTrace.calls.length),before.nativeTrace.calls);assert.deepEqual(gesture.nativeTrace.calls.slice(0,preedit.nativeTrace.calls.length),preedit.nativeTrace.calls);
 for(let i=0;i<gesture.inputTrace.length;i++){const r=gesture.inputTrace[i];assert.equal(r.ordinal,i+1);assert.equal(r.mountId,mount);clock(r.clock,c);assert.ok(finite(r.time));if(i)assert.ok(r.time>=gesture.inputTrace[i-1].time);}
 const starts=gesture.inputTrace.filter(r=>r.event==='compositionstart');assert.equal(starts.length,1);assert.equal(starts[0].isTrusted,true);assert.equal(starts[0].target.id,`${mount}-editor`);assert.ok(starts[0].time<=preedit.observation.at);assert.deepEqual(preedit.inputTrace.filter(r=>r.event==='compositionstart'),starts);
 assert.equal(action.action,'click-add');assert.equal(action.status,'completed');assert.equal(action.caseId,before.caseId);assert.equal(action.locale,before.locale);assert.equal(action.proof.delivery,'sent');
 assert.ok(Number.isSafeInteger(action.inputTraceBefore)&&action.inputTraceBefore>=preedit.inputTrace.length&&action.inputTraceBefore<=gesture.inputTrace.length);
 const guard=action.proof.pageGuard;assert.equal(guard.allowed,true);assert.deepEqual(guard.composition,preedit.composition,'Original Add guard still observed the same open generation');assert.equal(guard.id,mount);assert.equal(guard.mountedId,mount);assert.equal(guard.caseId,before.caseId);assert.equal(guard.action,'click-add');assert.equal(guard.target,'add');assert.ok(Number.isSafeInteger(guard.targetObject)&&guard.targetObject>0);
 const later=gesture.inputTrace.slice(action.inputTraceBefore),pointer=later.filter(r=>['pointerdown','pointerup','click'].includes(r.event));assert.equal(pointer.length,3);
 const [down,up,click]=pointer;assert.ok(Number.isSafeInteger(down.pointerId)&&down.pointerId>0);
 for(let i=0;i<3;i++){const r=pointer[i];assert.equal(r.event,['pointerdown','pointerup','click'][i]);assert.equal(r.isTrusted,true);assert.equal(r.button,0);assert.equal(r.pointerId,down.pointerId);assert.equal(r.targetObject,guard.targetObject);for(const k of ['shift','alt','meta','ctrl'])assert.equal(r[k],false);}
 assert.equal(down.isPrimary,true);assert.equal(up.isPrimary,true);assert.ok(Number.isSafeInteger(click.detail)&&click.detail>0);assert.ok(down.ordinal<up.ordinal&&up.ordinal<click.ordinal&&down.time<=up.time&&up.time<=click.time);assert.ok(preedit.observation.at<=down.time&&click.time<=gesture.observation.at);
 assert.deepEqual(action.domAcknowledgement,{down:[down],up:[up],click:[click]});
 const terminals=gesture.inputTrace.filter(r=>r.event==='compositionend');assert.equal(terminals.length,1);const terminal=terminals[0];assert.equal(typeof terminal.isTrusted,'boolean');assert.ok(terminal.ordinal>action.inputTraceBefore&&terminal.ordinal<down.ordinal&&terminal.time<down.time&&terminal.time>=preedit.observation.at);
 assert.equal(gesture.composition.starts,1);assert.equal(gesture.composition.observedEnded,true);assert.equal(gesture.composition.ends,terminal.isTrusted?1:0);assert.equal(gesture.composition.open,!terminal.isTrusted);assert.deepEqual(gesture.composition.terminals,[{ordinal:terminal.ordinal,time:terminal.time,isTrusted:terminal.isTrusted,mountId:mount,clock:c}]);
 for(const k of ['html','rootObject','objects','selection','active','activeObject']){assert.ok(preedit.dom[k]!==undefined);assert.deepEqual(gesture.dom[k],preedit.dom[k]);}assert.equal(typeof preedit.documentFocused,'boolean');assert.equal(gesture.documentFocused,preedit.documentFocused);
 for(const v of [preedit,gesture]){assert.deepEqual(v.native.ordinaryInputs,before.native.ordinaryInputs);assert.deepEqual(v.native.results,[]);assert.deepEqual(v.native.focusResults,[]);assert.deepEqual(v.native.failures,[]);assert.equal(v.native.uiResources.hostRequests,0);assert.equal(v.native.uiResources.continuations,0);assert.equal(v.facts.resources.hostRequests.pending,0);assert.equal(v.facts.resources.hostRequests.focusContinuations,0);assert.equal(v.facts.resources.popupPresentation.handles,0);assert.ok(v.native.dialog===null||v.native.dialog.hidden===true&&v.native.dialog.openCount===0);assert.deepEqual(v.native.dialog,preedit.native.dialog);}
 const semantic=[];const calls=gesture.nativeTrace.calls.slice(before.nativeTrace.calls.length);
 for(let i=0;i<calls.length;i++){
  const r=calls[i];assert.equal(r.ordinal,before.nativeTrace.calls.length+i+1);assert.equal(r.mountId,mount);clock(r.clock,c);assert.ok(finite(r.startedAt)&&finite(r.finishedAt)&&r.startedAt<=r.finishedAt&&r.finishedAt<=gesture.observation.at);if(i)assert.ok(r.startedAt>=calls[i-1].finishedAt);
  assert.equal(r.outcome,'returned');assert.equal(r.error,null);assert.ok(typeof r.requestJson==='string'&&r.requestJson.length<=8388608);assert.ok(typeof r.responseJson==='string'&&r.responseJson.length<=8388608);const request=JSON.parse(r.requestJson),response=JSON.parse(r.responseJson);
  if(request.kind==='command')semantic.push({row:r,request,response});else assert.ok(reads.has(request.kind),'Only frozen43 read kinds');
 }
 assert.equal(semantic.length,1);const native=semantic[0],expected={kind:'command',stamp:before.native.state.stamp,command:expectedCommand,history_hint:{kind:'isolated'}};
 assert.deepEqual(native.request,expected);assert.equal(native.row.requestJson,JSON.stringify(expected));assert.equal(native.response.status,'ok');assert.equal(native.response.value.kind,'mutation');assert.equal(native.response.value.effect,'changed');assert.deepEqual(native.response.value.state,gesture.native.state);
 assert.ok(native.row.startedAt>=terminal.time);const phases=[];
 if(native.row.finishedAt<=down.time)phases.push('BEFORE_DOWN');
 if(native.row.startedAt>=down.time&&native.row.finishedAt<=click.time)phases.push('DURING_POINTER');
 if(native.row.startedAt>=click.time&&native.row.finishedAt<=gesture.observation.at)phases.push('AFTER_CLICK');
 assert.equal(phases.length,1,'One disjoint fully observed native-call interval');
 return {classification:'ADMITTED_EARLY_TERMINAL',phase:phases[0],mountId:mount,clock:c,terminal,originalPointer:{down,up,click},nativeCall:native.row,protectedGestureAcceptance:false,nativePositiveFromUntrustedTerminal:false,nativeAndHistoryProof:'REQUIRED_SEPARATELY_BEFORE_UNOBSERVED'};
}
