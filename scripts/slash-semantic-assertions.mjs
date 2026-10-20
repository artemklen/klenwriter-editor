// SPDX-License-Identifier: MIT OR Apache-2.0
// Actual observations are checked against pre-candidate literals, not each other
// as a substitute for expected semantics. Window purity is within each target.
import assert from 'node:assert/strict';
import {assertSlashStructuralObservation} from './slash-structural-assertions.mjs';

const clone=value=>structuredClone(value);
const resolve=(value,roles)=>{
  if(Array.isArray(value))return value.map(v=>resolve(v,roles));
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,['node','parent'].includes(key)&&typeof v==='string'&&Object.hasOwn(roles,v)?roles[v]:resolve(v,roles)]));
};
function rolesAt(checkpoint,paths){
  const roles={};assert.equal(checkpoint.nodes.length,Object.keys(paths).length,'Complete authored live tree');
  for(const [name,path]of Object.entries(paths)){
    const row=checkpoint.nodes.find(row=>JSON.stringify(row.path)===JSON.stringify(path));assert(row,`Genuine role ${name}`);roles[name]=row.node.id;
  }
  assert.equal(new Set(Object.values(roles)).size,Object.keys(roles).length);return roles;
}
export function assertSlashObservation(c,o,lane){
  if(c.job.mode==='semantic'){
    const result=assertSlashStructuralObservation(c,o,lane);
    if(!c.expected.refused)assert.equal(o.steps[0].response.value.presentation.active,'none','Native slash/default presentation, not a UI active-option hint');
    if(c.expected.changed)for(const row of o.steps[0].after.nodes)assert.equal(row.node.changed_revision,'1','Frozen fixture touches all original/live rows and creates all remaining rows');
    return result;
  }
  const e=c.expected,w=e.window,roles=rolesAt(o.baseline,e.rolesBefore);
  assert.deepEqual(o.baseline.state.selection,resolve(e.selectionBefore,roles),'Actual directed setup');
  assert.equal(o.reads.length,1);const read=o.reads[0];
  assert.deepEqual(read.after,read.before,'Native read preserves complete state/canonical/live-ID/row/resource checkpoint');
  assert.deepEqual(read.events,[],'Pure read publishes no events');
  if(w.diagnostic){
    assert.equal(read.response.status,'refused');assert.equal(read.response.diagnostic.code,w.diagnostic);
    assert.equal(read.response.diagnostic.may_have_committed,false);assert.deepEqual(read.response.diagnostic.stamp,read.before.state.stamp);
    if(w.path!==undefined)assert.equal(read.response.diagnostic.path,w.path);
    if(w.category!==undefined)assert.equal(read.response.diagnostic.category,w.category);
  }else{
    assert.equal(read.response.status,'ok');const value=read.response.value;
    assert.deepEqual(Object.keys(value).sort(),['kind','stamp','selection','block','caret','ancestors','before','after','before_stop','after_stop'].sort(),'Closed native reply');
    assert.equal(value.kind,'text_window');assert.deepEqual(value.stamp,read.before.state.stamp);
    assert.deepEqual(value.selection,read.before.state.selection);assert.deepEqual(value.caret,read.before.state.selection.focus);
    assert.deepEqual(value.before,resolve(e.expectedBefore,roles));assert.deepEqual(value.after,resolve(e.expectedAfter,roles));
    assert.equal(value.before_stop,w.before_stop);assert.equal(value.after_stop,w.after_stop);
    assert.deepEqual(value.block,{node:roles.P,type_id:'org.klenwriter.kwdj/paragraph',primitive:'text_block'});
    assert.deepEqual(value.ancestors,[],'Top-level paragraph has no semantic ancestor, synthetic root excluded');
    assert(value.before.reduce((n,s)=>n+s.text.length,0)+value.after.reduce((n,s)=>n+s.text.length,0)<=256);
    for(const span of [...value.before,...value.after]){assert.equal(span.to_utf16-span.from_utf16,span.text.length);assert.equal(Object.keys(span).length,4);}
  }
  return {id:e.id,lane,status:'passed',reads:1,publication:0,sourceScope:w.scope??'admitted sealed KWDJ'};
}
export function compareSlashWindowTargets(native,wasm){
  function normalize(observation){
    const table=new Map(observation.baseline.nodes.map(row=>[row.node.id,`path:${row.path.join('/')}`]));
    const walk=(value,key='')=>{
      if(key==='session')return '$SESSION';
      if((key==='node'||key==='parent')&&typeof value==='string'){assert(table.has(value),'Only observed genuine subject IDs');return table.get(value);}
      if(Array.isArray(value))return value.map(v=>walk(v,key));
      if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,walk(v,k)]));
      return value;
    };
    return observation.reads.map(row=>walk(clone(row.response)));
  }
  assert.deepEqual(normalize(native),normalize(wasm),'Full native/sealed window response equality with only genuine identity bindings');
}
