// SPDX-License-Identifier: MIT OR Apache-2.0
// Data/validator controls only. Synthetic observations below execute no editor,
// native module, WASM, browser, input or model. Actual semantics are a separate pair lane.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadDragContract,loadDragCases} from '../scripts/drag-semantic-data.mjs';
import {assertDragRecord,nativeModuleZero,sdkControllerZero} from '../scripts/drag-semantic-assertions.mjs';
const clone=value=>structuredClone(value);
const packet={kwdjProfile:{profile_id:'CONTROL_ONLY',profile_version:'1',codec_id:'CONTROL_ONLY',wire_version:1,extensions:[]},kwdjRegistryJson:'{}'};
const inventory=()=>loadDragCases({packet});
const resolve=(value,roles,key='')=>{
  if(['node','parent'].includes(key)&&typeof value==='string'&&Object.hasOwn(roles,value))return roles[value];
  if(Array.isArray(value))return value.map(v=>resolve(v,roles,key));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolve(v,roles,k)]));
  return value;
};
function controlled(c){
  const expected=c.expected,roles=Object.fromEntries(Object.keys(expected.roles_before).map(role=>[role,`controlled-id:${role}`]));
  const document=JSON.parse(expected.input_canonical),header=new Map();
  for(const [role,path]of Object.entries(expected.roles_before)){
    const node=path.reduce((p,i)=>p.content[i],{content:document.content});
    header.set(role,{type_id:path.length?`org.klenwriter.kwdj/${node.type}`:'controlled-root',
      primitive:path.length?node.type==='text'?'text':node.type==='scene_break'?'block_atom':node.type==='blockquote'?'container':'text_block':'root',
      attributes:clone(node.attrs??{}),marks:clone(node.marks??[]),text:node.text??null});
  }
  const checkpoint=e=>{
    const stamp={session:'controlled-session',generation:'1',...clone(e.counters)};
    const nodes=Object.entries(e.roles).map(([role,path])=>({path:clone(path),node:{id:roles[role],stamp:clone(stamp),changed_revision:'0',
      ...clone(header.get(role)),parent:path.length?roles[Object.keys(e.roles).find(name=>JSON.stringify(e.roles[name])===JSON.stringify(path.slice(0,-1)))]:null,
      children:Object.entries(e.roles).filter(([,p])=>p.length===path.length+1&&p.slice(0,-1).every((n,i)=>n===path[i])).sort((a,b)=>a[1].at(-1)-b[1].at(-1)).map(([name])=>roles[name])}}));
    return {state:{stamp,root:roles.R,selection:resolve(e.selection,roles),stored_marks:null,dirty:e.dirty,saved_revision:'0',
      history:{...clone(e.history),retained_bytes:'128'}},canonical:e.canonical,nodes,
      resources:{sessions:1,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:1}};
  };
  const initialState={canonical:expected.input_canonical,roles:expected.roles_before,selection:expected.selection,
    counters:{revision:'0',selection_epoch:'1',history_epoch:'0'},history:{undo_entries:'0',redo_entries:'0'},dirty:false};
  const base=checkpoint(initialState),admitted=clone(base);admitted.state.stamp.selection_epoch='0';admitted.state.selection=null;
  for(const row of admitted.nodes)row.node.stamp.selection_epoch='0';
  const observation={initial:{status:'ok'},admitted,baseline:base,setupEvents:[{change:{kind:'state'},selection_after:clone(base.state.selection)}],operations:[]};
  const calls=[{request:{kind:'set_selection',stamp:clone(admitted.state.stamp),selection:clone(base.state.selection)},response:{status:'ok'}}];let prior=base;
  for(const operation of expected.operations){
    const before=clone(prior);let row,request;
    if(operation.kind==='map'){
      request={kind:'map_position',stamp:clone(before.state.stamp),from_revision:operation.from_revision,position:resolve(operation.position,roles)};
      row={kind:'map',before,request:clone(request),response:{status:'ok',value:{kind:'mapped',status:'mapped',position:resolve(operation.expected.position,roles),deleted:false,stamp:clone(before.state.stamp)}},events:[],after:clone(before)};
    }else{
      const changed=operation.expected.effect==='changed',after=checkpoint(operation.expected.state),refused=operation.expected.effect==='refused';
      const command=operation.kind==='command'?{id:'org.klenwriter.kwdj/command/move',payload_json:JSON.stringify(resolve(operation.intent,roles))}:null;
      const inner=refused?{...clone(operation.expected.diagnostic),stamp:null}:null;
      const query={status:'ok',value:{kind:'availability',available:!refused,effect:refused?null:operation.expected.effect,
        presentation:refused||operation.kind==='history'?null:{active:'none'},diagnostic:inner}};
      const response=refused?{status:'refused',diagnostic:{...clone(operation.expected.diagnostic),stamp:clone(before.state.stamp)}}:
        {status:'ok',value:{kind:'mutation',effect:operation.expected.effect,state:clone(after.state),presentation:operation.kind==='history'?null:{active:'none'}}};
      const events=changed?[{change:{kind:'document'},before:clone(before.state.stamp),after:clone(after.state.stamp),
        selection_before:clone(before.state.selection),selection_after:clone(after.state.selection),stored_marks_before:null,stored_marks_after:null,
        history:clone(after.state.history),dirty_before:before.state.dirty,dirty_after:after.state.dirty}]:[];
      row={kind:operation.kind,before,afterQuery:clone(before),query,response,events,after,...(command?{command}:{direction:operation.direction})};
      const q=command?{kind:'query_command',stamp:clone(before.state.stamp),command:clone(command)}:{kind:'query_history',stamp:clone(before.state.stamp),direction:operation.direction};
      calls.push({request:q,response:clone(query)});
      request=command?{kind:'command',stamp:clone(before.state.stamp),command:clone(command),history_hint:{kind:'isolated'}}:
        {kind:'history',stamp:clone(before.state.stamp),direction:operation.direction};
    }
    calls.push({request:clone(request),response:clone(row.response)});observation.operations.push(row);prior=row.after;
  }
  observation.after=clone(prior);
  return {id:c.job.id,status:'recorded',observation,calls,released:clone(nativeModuleZero),controllerReleased:clone(sdkControllerZero),cleanupFailures:[]};
}
const find=id=>inventory().cases.find(c=>c.job.id===id);

test('D44-C01 source inventory has four additions and fourteen pinned42 families; default32 stays qualified',()=>{
  const value=inventory();assert.equal(value.cases.length,18);
  assert.deepEqual(value.cases.slice(0,4).map(c=>c.job.id),['M44-01','M44-02','M44-03','M44-04']);
  assert.deepEqual(value.cases.slice(4).map(c=>c.job.id),['V04-up','V04-down','V05-same-index','V05-after-self-index','V05-invalid-index','V05-wrong-child','V05-synthetic-root','N01','N02','N03','N04','N05','N06','N08']);
  assert.equal(value.qualifiedNotRun.length,1);assert.equal(value.qualifiedNotRun[0].status,'NOT_RUN_SPECIFICATION_ONLY');
});
test('D44-C02 contract loader returns fresh data without altering frozen source references',()=>{
  const a=loadDragContract();a.contract.new_cases[0].operations[0].intent.before_index=99;
  assert.equal(loadDragContract().contract.new_cases[0].operations[0].intent.before_index,3);
  assert.equal(a.reused.length,14);assert.equal(a.pins.length,3);
});
test('D44-C03 controlled validator accepts complete reverse-selection, atom and actual-redo observation shapes',()=>{
  for(const id of ['M44-01','M44-02','M44-03','M44-04']){
    const c=find(id);assert.equal(assertDragRecord(c,controlled(c),'controlled-only',{sdk:true}).status,'passed');
  }
});
test('D44-C04 a replaced descendant native ID is refused even when canonical text matches',()=>{
  const c=find('M44-01'),row=controlled(c);row.observation.operations[0].after.nodes.find(n=>n.node.id==='controlled-id:BT').node.id='replacement';
  assert.throws(()=>assertDragRecord(c,row,'controlled-only'),/Original native identity|bijective|Identity/iu);
});
test('D44-C05 losing original Strong mark is refused without relying on changed canonical',()=>{
  const c=find('M44-01'),row=controlled(c);row.observation.operations[0].after.nodes.find(n=>n.node.id==='controlled-id:BT').node.marks=[];
  assert.throws(()=>assertDragRecord(c,row,'controlled-only'),/structural header/u);
});
test('D44-C06 public gap-map deletion or affinity substitution is refused',()=>{
  const c=find('M44-01'),row=controlled(c);row.observation.operations[2].response.value.deleted=true;
  assert.throws(()=>assertDragRecord(c,row,'controlled-only'),/Full original public map/u);
});
test('D44-C07 forward replacement of the original reverse range is refused',()=>{
  const c=find('M44-01'),row=controlled(c),selection=row.observation.operations[0].after.state.selection;
  [selection.anchor,selection.focus]=[selection.focus,selection.anchor];
  row.observation.operations[0].response.value.state.selection=clone(selection);
  row.observation.operations[0].events[0].selection_after=clone(selection);
  assert.throws(()=>assertDragRecord(c,row,'controlled-only'),/directed model selection/u);
});
test('D44-C08 a no-op that discards an existing actual redo entry is refused',()=>{
  const c=find('M44-04'),row=controlled(c);row.observation.operations[2].after.state.history.redo_entries='0';
  row.observation.operations[2].response.value.state.history.redo_entries='0';
  assert.throws(()=>assertDragRecord(c,row,'controlled-only'),/mutation state|History redo_entries/u);
});
test('D44-C09 raw semantic replay and a substituted original response are refused',()=>{
  const c=find('M44-04'),extra=controlled(c);extra.calls.push(clone(extra.calls.find(call=>call.request.kind==='command')));
  assert.throws(()=>assertDragRecord(c,extra,'controlled-only'),/one original dispatch/u);
  const substituted=controlled(c);substituted.calls.find(call=>call.request.kind==='command').response={status:'fatal'};
  assert.throws(()=>assertDragRecord(c,substituted,'controlled-only'),/Raw original response/u);
});
test('D44-C10 native leak or incomplete original SDK controller cleanup cannot count as released',()=>{
  const c=find('M44-03'),native=controlled(c);native.released.protected_cursors=1;
  assert.throws(()=>assertDragRecord(c,native,'controlled-only'),/native module resource/u);
  const sdk=controlled(c);delete sdk.controllerReleased.pending_tickets;
  assert.throws(()=>assertDragRecord(c,sdk,'controlled-only',{sdk:true}),/SDK controller/u);
});
