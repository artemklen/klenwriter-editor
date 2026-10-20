// SPDX-License-Identifier: MIT OR Apache-2.0
// Controlled assertion-helper unit. No SDK/native execution or semantic proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertSlashStructuralObservation} from '../scripts/slash-structural-assertions.mjs';

const oracle=JSON.parse(readFileSync(new URL('../contracts/slash/v1/native-source-oracles.json',import.meta.url),'utf8'));
const literal=oracle.additionalNativeGoldens.find(row=>row.id==='S43-E01');
const ids=Object.freeze({R:'controlled-root',P:'controlled-prefix',T:'controlled-original-text',A:'controlled-target',N:'controlled-trailing'});
const point=(node,offset)=>({kind:'text',node,offset,affinity:'after'});
const caret=point=>({anchor:structuredClone(point),focus:structuredClone(point)});
const first=caret(point(ids.T,2));
const last=caret({kind:'child',parent:ids.N,index:0,affinity:'after'});
const symbolic=point=>({kind:'text',node:point,offset:2,affinity:'after'});
const pathsBefore={R:[],P:[0],T:[0,0]},pathsAfter={R:[],P:[0],A:[1],N:[2]};
function state(step,selection){return {root:ids.R,stamp:{session:'controlled-session',generation:'1',revision:String(step),selection_epoch:String(step+1),history_epoch:String(step)},selection:structuredClone(selection),stored_marks:null,saved_revision:'0',dirty:step>0,
  history:{undo_entries:step===0||step===2?'0':'1',redo_entries:step===2?'1':'0',retained_bytes:'0'}};}
function checkpoint(step,after){const paths=after?pathsAfter:pathsBefore;return {state:state(step,after?last:first),canonical:after?literal.afterCanonical:literal.beforeCanonical,
  nodes:Object.entries(paths).map(([role,path])=>({path,node:{id:ids[role]}}))};}
function event(before,after){return {change:{kind:'document'},before:before.stamp,after:after.stamp,selection_before:before.selection,selection_after:after.selection,stored_marks_before:null,stored_marks_after:null,
  history:after.history,dirty_before:before.dirty,dirty_after:after.dirty};}
function fixture(){
  const before=checkpoint(0,false),after=checkpoint(1,true),undo=checkpoint(2,false),redo=checkpoint(3,true);
  const c={expected:{id:literal.id,inputCanonical:literal.beforeCanonical,afterCanonical:literal.afterCanonical,rolesBefore:pathsBefore,rolesAfter:pathsAfter,
    selectionBefore:caret(symbolic('T')),selectionAfter:caret({kind:'child',parent:'N',index:0,affinity:'after'}),stateOnly:false,changed:true,refused:false,
    queryEffect:'changed',queryActive:'none',stampDelta:{revision:'1',selection_epoch:'1',history_epoch:'1'},literal}};
  const response=checkpoint=>({status:'ok',value:{kind:'mutation',effect:'changed',state:checkpoint.state,presentation:{active:'none'}}});
  const o={baseline:before,steps:[{before,afterQuery:structuredClone(before),query:{status:'ok',value:{kind:'availability',available:true,effect:'changed',presentation:{active:'none'}}},response:response(after),after,events:[event(before.state,after.state)]}],after,
    history:[{direction:'undo',query:{status:'ok',value:{available:true}},response:response(undo),after:undo,events:[event(after.state,undo.state)]},
      {direction:'redo',query:{status:'ok',value:{available:true}},response:response(redo),after:redo,events:[event(undo.state,redo.state)]}]};
  return {c,o};
}

test('controlled E01 history retains original retired Text identity and created redo identities',()=>{
  assert.equal(literal.beforeCanonical,'{"content":[{"content":[{"text":"/x","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}');
  assert.deepEqual(literal.ids.retired,['T']);
  const {c,o}=fixture();
  assert.equal(o.steps[0].after.nodes.some(row=>row.node.id===ids.T),false);
  assert.equal(o.history[0].after.nodes.find(row=>row.path.join('/')==='0/0').node.id,ids.T);
  assert.equal(assertSlashStructuralObservation(c,o,'controlled-helper').status,'passed');
});
test('controlled E01 history rejects a self-consistent replacement ID for the original retired Text',()=>{
  const {c,o}=fixture(),undo=o.history[0],replacement='controlled-wrong-original-text';
  undo.after.nodes.find(row=>row.path.join('/')==='0/0').node.id=replacement;
  undo.after.state.selection=caret(point(replacement,2));
  undo.events[0].selection_after=structuredClone(undo.after.state.selection);
  assert.throws(()=>assertSlashStructuralObservation(c,o,'controlled-helper'),/Identity T survives/);
});
