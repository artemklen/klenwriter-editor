// SPDX-License-Identifier: MIT OR Apache-2.0
// Slash-specific copy of the unchanged42 semantic assertions. Preserve genuine
// original and created bindings across retirement so history must revive IDs.
import assert from 'node:assert/strict';

const copy=value=>structuredClone(value);
const equal=(a,b,label)=>assert.deepEqual(copy(a),copy(b),label);
const resolve=(value,roles)=>{
  if(Array.isArray(value))return value.map(v=>resolve(v,roles));
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,['node','parent'].includes(k)&&typeof v==='string'&&Object.hasOwn(roles,v)?roles[v]:resolve(v,roles)]));
};
function rolesAt(checkpoint,paths,known={},initial=new Set()){
  const roles={};
  for(const [role,path]of Object.entries(paths)){
    const row=checkpoint.nodes.find(row=>JSON.stringify(row.path)===JSON.stringify(path));assert(row,`Authored ${role} path`);
    roles[role]=row.node.id;
    if(Object.hasOwn(known,role))assert.equal(row.node.id,known[role],`Identity ${role} survives`);
    else if(initial.size)assert(!initial.has(row.node.id),`Fresh ${role}`);
  }
  assert.equal(new Set(Object.values(roles)).size,Object.keys(roles).length,'Role bijection');
  assert.equal(checkpoint.nodes.length,Object.keys(paths).length,'Complete literal tree roles, no extra nodes');
  return roles;
}
function delta(before,after,expected,label){
  assert.equal(after.session,before.session,`${label} Session`);assert.equal(after.generation,before.generation,`${label} generation`);
  for(const key of ['revision','selection_epoch','history_epoch'])assert.equal(BigInt(after[key])-BigInt(before[key]),BigInt(expected[key]),`${label} ${key}`);
}
function history(state,undo,redo){assert.equal(state.history.undo_entries,String(undo));assert.equal(state.history.redo_entries,String(redo));assert(BigInt(state.history.retained_bytes)>=0n&&BigInt(state.history.retained_bytes)<=33554432n,'Target-local history bounded');}
function events(step,before,after,kind,count){
  assert.equal(step.events.length,count,'Exactly original publications');
  if(!count)return;
  const event=step.events[0];assert.equal(event.change.kind,kind);equal(event.before,before.stamp,'event before');equal(event.after,after.stamp,'event after');equal(event.selection_before,before.selection,'event selection before');equal(event.selection_after,after.selection,'event selection after');equal(event.stored_marks_before,before.stored_marks);equal(event.stored_marks_after,after.stored_marks);equal(event.history,after.history);assert.equal(event.dirty_before,before.dirty);assert.equal(event.dirty_after,after.dirty);
}
export function assertSlashStructuralObservation(c,o,lane){
  const e=c.expected,base=o.baseline,initial=rolesAt(base,e.rolesBefore),initialIds=new Set(Object.values(initial));let known={...initial};
  assert.equal(base.canonical,e.inputCanonical,`${lane} ${e.id} exact input`);
  equal(base.state.selection,resolve(e.selectionBefore,initial),'literal initial selection');equal(base.state.stored_marks,null);
  assert.equal(base.state.stamp.revision,'0');assert.equal(base.state.saved_revision,'0');assert.equal(base.state.dirty,false);history(base.state,0,0);
  assert.equal(o.steps.length,e.stateOnly?2:1);
  for(const [index,step]of o.steps.entries()){
    equal(step.before,step.afterQuery,'Publication-free query preserves all observable facets');
    const query=step.query;assert.equal(query.status,'ok');assert.equal(query.value.kind,'availability');assert.equal(query.value.available,!e.refused);
    if(e.stateOnly){
      const expected=e.literal.expected.steps[index];assert.equal(query.value.effect,expected.queryEffect);assert.equal(query.value.presentation.active,expected.queryActive);
      assert.equal(step.response.status,'ok');assert.equal(step.response.value.effect,'state_changed');assert.equal(step.after.canonical,e.inputCanonical);
      equal(step.after.state.selection,base.state.selection);equal(step.after.state.stored_marks,expected.stored_marks);delta(step.before.state.stamp,step.after.state.stamp,expected.stampDelta,'state-only');
      rolesAt(step.after,e.rolesBefore,known,initialIds);history(step.after.state,0,0);assert.equal(step.after.state.dirty,false);assert.equal(step.after.state.saved_revision,'0');events(step,step.before.state,step.after.state,'state',1);
      assert.equal(step.events[0].change.selection_changed,false);assert.equal(step.events[0].change.stored_marks_changed,true);
      continue;
    }
    assert.equal(query.value.effect,e.queryEffect);
    if(e.queryActive!==null)assert.equal(query.value.presentation.active,e.queryActive);
    if(e.refused){
      assert.equal(step.response.status,'refused');assert.equal(step.response.diagnostic.code,e.code);assert.equal(step.response.diagnostic.may_have_committed,false);equal(step.response.diagnostic.stamp,step.before.state.stamp,'Refused current full stamp');
      if(e.diagnosticPath!==null)assert.equal(step.response.diagnostic.path,e.diagnosticPath);
      if(e.queryDiagnostic)equal(query.value.diagnostic,e.queryDiagnostic,'Full frozen query diagnostic');
      if(e.diagnostic){const literal={...e.diagnostic,stamp:step.before.state.stamp};equal(step.response.diagnostic,literal,'Full frozen execution diagnostic');}
      equal(step.after,step.before,'Refused preserves complete native facets');events(step,step.before.state,step.after.state,'document',0);
    }else if(!e.changed){
      assert.equal(step.response.status,'ok');assert.equal(step.response.value.effect,'unchanged');equal(step.after,step.before,'True noop preserves complete facets');events(step,step.before.state,step.after.state,'document',0);
    }else{
      assert.equal(step.response.status,'ok');assert.equal(step.response.value.kind,'mutation');assert.equal(step.response.value.effect,'changed');equal(step.response.value.state,step.after.state,'Original mutation state');
      assert.equal(step.after.canonical,e.afterCanonical,'Independent exact resulting canonical');
      known={...known,...rolesAt(step.after,e.rolesAfter,known,initialIds)};equal(step.after.state.selection,resolve(e.selectionAfter,known),'Literal directed result range');equal(step.after.state.stored_marks,null);
      delta(step.before.state.stamp,step.after.state.stamp,e.stampDelta,'command');history(step.after.state,1,0);assert.equal(step.after.state.dirty,true);assert.equal(step.after.state.saved_revision,'0');events(step,step.before.state,step.after.state,'document',1);
      if(e.literal.expected?.mutationActive)assert.equal(step.response.value.presentation.active,e.literal.expected.mutationActive,'Mutation carries PRE-action active state');
    }
  }
  if(e.changed){
    assert.equal(o.history.length,2);
    for(const [index,step]of o.history.entries()){
      const redo=index===1;assert.equal(step.direction,redo?'redo':'undo');assert.equal(step.query.status,'ok');assert.equal(step.query.value.available,true);assert.equal(step.response.status,'ok');assert.equal(step.response.value.effect,'changed');
      assert.equal(step.after.canonical,redo?e.afterCanonical:e.inputCanonical,'Exact undo/redo canonical');
      const roles=rolesAt(step.after,redo?e.rolesAfter:e.rolesBefore,known,initialIds);
      equal(step.after.state.selection,resolve(redo?e.selectionAfter:e.selectionBefore,roles),'Undo/redo direction and IDs');equal(step.after.state.stored_marks,null);history(step.after.state,redo?1:0,redo?0:1);assert.equal(step.after.state.saved_revision,'0');assert.equal(step.after.state.dirty,true);
      delta(base.state.stamp,step.after.state.stamp,{revision:String(index+2),selection_epoch:String(BigInt(e.stampDelta.selection_epoch)*(BigInt(index)+2n)),history_epoch:String(index+2)},'chronological history');
      const prior=index?o.history[0].after.state:o.after.state;events(step,prior,step.after.state,'document',1);
    }
  }else assert.equal(o.history.length,0);
  return {id:e.id,lane,status:'passed',steps:o.steps.length,documentEvents:o.steps.flatMap(s=>s.events).filter(event=>event.change.kind==='document').length,stateEvents:o.steps.flatMap(s=>s.events).filter(event=>event.change.kind==='state').length,historySteps:o.history.length};
}
