// SPDX-License-Identifier: MIT OR Apache-2.0
// The same independently authored literals check each target separately.
import assert from 'node:assert/strict';
const copy=value=>structuredClone(value);
const equal=(a,b,message)=>assert.deepEqual(copy(a),copy(b),message);
const u64=value=>typeof value==='string'&&/^(?:0|[1-9][0-9]*)$/.test(value)&&BigInt(value)<=18446744073709551615n;
export const nativeModuleZero=Object.freeze({sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});
export const sdkControllerZero=Object.freeze({lifecycle:'destroyed',sessions:0,listeners:0,queued_mutations:0,queued_bytes:0,
  pending_tickets:0,host_requests:0,task_continuations:0,original_input_bytes:0,callback_errors:0,callback_error_handlers:0});

function resolve(value,roles,key=''){
  if(['node','parent'].includes(key)&&typeof value==='string'&&Object.hasOwn(roles,value))return roles[value];
  if(Array.isArray(value))return value.map(v=>resolve(v,roles,key));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolve(v,roles,k)]));
  return value;
}
function bind(checkpoint,paths,known){
  assert.equal(checkpoint.nodes.length,Object.keys(paths).length,'Complete authored live tree, not a subset');
  const table={};
  for(const [role,path]of Object.entries(paths)){
    const found=checkpoint.nodes.filter(row=>JSON.stringify(row.path)===JSON.stringify(path));assert.equal(found.length,1,`Exact authored path ${role}`);
    const id=found[0].node.id;assert.equal(typeof id,'string');assert(id.length);
    if(known)assert.equal(id,known[role],`Original native identity survives: ${role}`);
    table[role]=id;
  }
  assert.equal(new Set(Object.values(table)).size,Object.keys(paths).length,'Bijective original roles');
  assert.equal(checkpoint.state.root,table.R,'Original synthetic root identity');return table;
}
function structure(checkpoint,paths,known,original){
  const roles=bind(checkpoint,paths,known),byPath=new Map(Object.entries(paths).map(([role,path])=>[JSON.stringify(path),roles[role]]));
  for(const [role,path]of Object.entries(paths)){
    const row=checkpoint.nodes.find(r=>r.node.id===roles[role]).node,baseline=original.get(roles[role]);assert(baseline);
    equal(row.stamp,checkpoint.state.stamp,'Actual row full stamp is current');
    assert(u64(row.changed_revision)&&BigInt(row.changed_revision)<=BigInt(checkpoint.state.stamp.revision),'Target-local temporal changed_revision bound');
    assert(BigInt(row.changed_revision)>=BigInt(baseline.changed_revision),'changed_revision does not revert with content');
    for(const key of ['type_id','primitive','attributes','marks','text'])equal(row[key],baseline[key],`Original structural header ${role}.${key}`);
    assert.equal(row.parent,path.length?byPath.get(JSON.stringify(path.slice(0,-1))):null,`Authored parent ${role}`);
    const children=Object.entries(paths).filter(([,p])=>p.length===path.length+1&&p.slice(0,-1).every((n,i)=>n===path[i]))
      .sort((a,b)=>a[1].at(-1)-b[1].at(-1)).map(([name],i)=>{assert.equal(paths[name].at(-1),i);return roles[name];});
    equal(row.children,children,`Exact child order ${role}`);
  }
  return roles;
}
function verifyState(checkpoint,expected,baseline,roles,original){
  assert.equal(checkpoint.canonical,expected.canonical,'Independent exact canonical literal');
  structure(checkpoint,expected.roles,roles,original);const state=checkpoint.state;
  assert.equal(state.stamp.session,baseline.state.stamp.session);assert.equal(state.stamp.generation,baseline.state.stamp.generation);
  for(const key of ['revision','selection_epoch','history_epoch'])assert.equal(state.stamp[key],expected.counters[key],`Chronological ${key}`);
  equal(state.selection,resolve(expected.selection,roles),'Exact directed model selection/affinity');equal(state.stored_marks,expected.stored_marks,'Stored marks');
  assert.equal(state.saved_revision,expected.saved_revision);assert.equal(state.dirty,expected.dirty);
  equal(Object.keys(state.history).sort(),['redo_entries','retained_bytes','undo_entries'],'Closed public HistoryViewDto');
  for(const key of ['undo_entries','redo_entries'])assert.equal(state.history[key],expected.history[key],`History ${key}`);
  assert(u64(state.history.retained_bytes)&&BigInt(state.history.retained_bytes)<=33554432n,'Actual bounded target-local retained bytes');
}
function verifyEvents(row,count){
  assert.equal(row.events.length,count,'Exactly original events, no hidden intermediate publication');
  if(!count)return;
  const event=row.events[0];assert.equal(event.change.kind,'document');
  equal(event.before,row.before.state.stamp);equal(event.after,row.after.state.stamp);
  for(const [field,key]of [['selection','selection'],['stored_marks','stored_marks']]){
    equal(event[`${field}_before`],row.before.state[key]);equal(event[`${field}_after`],row.after.state[key]);
  }
  equal(event.history,row.after.state.history);assert.equal(event.dirty_before,row.before.state.dirty);assert.equal(event.dirty_after,row.after.state.dirty);
}
export function assertDragObservation(c,o,lane){
  assert.equal(o.initial.status,'ok',`${lane} original initialization`);
  const e=c.expected,base=o.baseline,roles=bind(base,e.roles_before),original=new Map(base.nodes.map(row=>[row.node.id,copy(row.node)]));
  const baseline={canonical:e.input_canonical,roles:e.roles_before,selection:e.selection,stored_marks:null,
    counters:{revision:'0',selection_epoch:'1',history_epoch:'0'},history:{undo_entries:'0',redo_entries:'0'},saved_revision:'0',dirty:false};
  verifyState(base,baseline,base,roles,original);assert.equal(o.admitted.canonical,e.input_canonical);
  assert.equal(o.setupEvents.length,1,'Only original public selection setup');assert.equal(o.setupEvents[0].change.kind,'state');
  equal(o.setupEvents[0].selection_after,base.state.selection);
  assert.equal(o.operations.length,e.operations.length,'All declared operations, no hidden semantic replay');
  let prior=base,commands=0,maps=0,history=0,documentEvents=0;
  for(const [index,expected]of e.operations.entries()){
    const row=o.operations[index];assert.equal(row.kind,expected.kind);equal(row.before,prior,'Current original operation baseline');
    if(expected.kind==='map'){
      maps++;equal(row.request,{kind:'map_position',stamp:row.before.state.stamp,from_revision:expected.from_revision,position:resolve(expected.position,roles)},'Original public map request');
      equal(row.after,row.before,'Pure map preserves complete native facets and resources');equal(row.events,[],'Pure map has no publication');
      equal(row.response,{status:'ok',value:{kind:'mapped',status:expected.expected.status,position:resolve(expected.expected.position,roles),deleted:expected.expected.deleted,stamp:row.before.state.stamp}},'Full original public map response');
    }else{
      equal(row.afterQuery,row.before,'Pure query preserves all native state/canonical/IDs/headers/resources');
      const query=row.query;assert.equal(query.status,'ok');assert.equal(query.value.kind,'availability');
      if(expected.kind==='command'){
        commands++;assert.equal(row.command.id,'org.klenwriter.kwdj/command/move');
        equal(JSON.parse(row.command.payload_json),resolve(expected.intent,roles),'Same closed original Move payload, independent JSON key order');
        assert.equal(query.value.available,expected.expected.effect!=='refused');
        if(expected.expected.effect==='refused'){
          const diagnostic=expected.expected.diagnostic;const inner={...copy(diagnostic),stamp:null},outer={...copy(diagnostic),stamp:row.before.state.stamp};
          equal(query.value,{kind:'availability',available:false,effect:null,presentation:null,diagnostic:inner},'Full unavailable diagnostic');
          equal(row.response,{status:'refused',diagnostic:outer},'Original complete execution Refused');
        }else{
          equal(query.value,{kind:'availability',available:true,effect:expected.expected.effect,presentation:{active:'none'},diagnostic:null},'Complete original Move availability');
          equal(row.response,{status:'ok',value:{kind:'mutation',effect:expected.expected.effect,state:row.after.state,presentation:{active:'none'}}},'Original returned mutation state');
        }
      }else{
        history++;assert.equal(row.direction,expected.direction);
        equal(query.value,{kind:'availability',available:true,effect:'changed',presentation:null,diagnostic:null},'Actual original unit availability');
        equal(row.response,{status:'ok',value:{kind:'mutation',effect:'changed',state:row.after.state,presentation:null}},'Original history response; no invented presentation');
      }
      verifyState(row.after,expected.expected.state,base,roles,original);verifyEvents(row,expected.expected.events);documentEvents+=row.events.length;
      if(expected.expected.effect!=='changed')equal(row.after,row.before,'Noop/refusal retains full facets including actual redo and retained bytes');
    }
    prior=row.after;
  }
  equal(o.after,prior,'Final original checkpoint');
  return {id:e.id,lane,status:'passed',commands,historySteps:history,publicMapReads:maps,documentEvents,
    originalIds:Object.keys(roles).length,created:0,retired:0,scope:'Independent literal canonical/IDs/selection/history/public map projection; no internal StepMap DTO or UI/input claim.'};
}
export function assertDragReleased(row,{sdk=false}={}){
  equal(row.released,nativeModuleZero,'Every original native module resource released');
  if(sdk)equal(row.controllerReleased,sdkControllerZero,'Complete original SDK controller destruction resources');
  assert.equal(row.cleanupFailures?.length??0,0,'No suppressed destroy/resource failure');
}

export function assertDragRecord(c,row,lane,{sdk=false}={}){
  assert.equal(row.id,c.job.id);assert.equal(row.status,'recorded',JSON.stringify(row.failure??null));
  const result=assertDragObservation(c,row.observation,lane);assertDragReleased(row,{sdk});
  const semantic=row.calls.filter(call=>['command','history','map_position'].includes(call.request.kind));
  equal(semantic.map(call=>call.request.kind),c.job.operations.map(op=>op.kind==='map'?'map_position':op.kind),'Exactly one original dispatch/read per declared operation');
  const queries=row.calls.filter(call=>['query_command','query_history'].includes(call.request.kind));
  equal(queries.map(call=>call.request.kind),c.job.operations.filter(op=>op.kind!=='map').map(op=>op.kind==='command'?'query_command':'query_history'),'Exactly one original pure availability query per dispatch');
  const setups=row.calls.filter(call=>call.request.kind==='set_selection');
  assert.equal(setups.length,1,'One genuine initial public selection, no hidden selection repair');
  const roles=bind(row.observation.baseline,c.expected.roles_before);let queryIndex=0;
  equal(setups[0].request,{kind:'set_selection',stamp:row.observation.admitted.state.stamp,selection:resolve(c.expected.selection,roles)},'Original genuine setup request');
  for(const [index,operation]of row.observation.operations.entries()){
    const expected=operation.kind==='map'?operation.request:operation.kind==='history'?
      {kind:'history',stamp:operation.before.state.stamp,direction:operation.direction}:
      {kind:'command',stamp:operation.before.state.stamp,command:operation.command,history_hint:{kind:'isolated'}};
    equal(semantic[index].request,expected,'Raw original semantic request is the observed operation');
    equal(semantic[index].response,operation.response,'Raw original response retained, not substituted');
    if(operation.kind!=='map'){
      const query=operation.kind==='history'?{kind:'query_history',stamp:operation.before.state.stamp,direction:operation.direction}:
        {kind:'query_command',stamp:operation.before.state.stamp,command:operation.command};
      equal(queries[queryIndex].request,query,'Same original command/current stamp queried before dispatch');
      equal(queries[queryIndex].response,operation.query,'Raw original query retained');queryIndex++;
    }
  }
  return result;
}
