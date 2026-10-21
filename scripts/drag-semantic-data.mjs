// SPDX-License-Identifier: MIT OR Apache-2.0
// Data-only projection of source-authored literals. No editor/canonicalizer.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const clone=value=>structuredClone(value),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=path=>readFileSync(resolve(root,path));
const parse=path=>JSON.parse(read(path));
const paths=source=>Object.fromEntries(Object.entries(source).map(([role,path])=>[role,Array.isArray(path)?clone(path):path.kind==='synthetic_root'?[]:clone(path.path)]));
const state=(canonical,roles,selection,revision=0,historyEpoch=revision,undo=revision?1:0,redo=0)=>({
  canonical,roles:clone(roles),selection:clone(selection),stored_marks:null,
  counters:{revision:String(revision),selection_epoch:'1',history_epoch:String(historyEpoch)},
  history:{undo_entries:String(undo),redo_entries:String(redo)},saved_revision:'0',dirty:revision!==0,
});
const diagnostic=(code,category='sdk')=>({code,path:'',category,details:{},stamp:'CURRENT_STAMP',may_have_committed:false});

export function loadDragContract(){
  const source='contracts/drag/v1/semantic-oracles.json',bytes=read(source),contract=JSON.parse(bytes);
  assert.equal(contract.format,'editor-drag-semantic-oracles/1');
  const pins=[{path:source,bytes:bytes.length,sha256:sha(bytes)}],reused=[];
  const ids=new Set(contract.new_cases.map(c=>c.id));assert.equal(ids.size,contract.new_cases.length);
  for(const ref of contract.reused_frozen_cases){
    const bytes=read(ref.path);assert.equal(bytes.length,ref.bytes,'Original frozen bytes');assert.equal(sha(bytes),ref.sha256,'Original frozen SHA');
    pins.push({path:ref.path,bytes:bytes.length,sha256:sha(bytes)});const source=JSON.parse(bytes);
    for(const id of ref.case_ids){assert(!ids.has(id),'Distinct case IDs');ids.add(id);const found=source.cases.filter(c=>c.id===id);assert.equal(found.length,1);reused.push({source:ref.path,literal:clone(found[0])});}
  }
  return {contract:clone(contract),reused,pins};
}
function reusedCase(source,c,contract){
  const nested=source.endsWith('/nesting-oracles.json'),rolesBefore=nested?paths(c.roles_before):clone(c.input.roles);
  const canonical=nested?c.input_canonical:c.input.canonical_json,selection=nested?c.selection:c.input.selection;
  const result=nested?c.expected.command:c.expected,refused=nested?result.response_status==='refused':!!result.code;
  const changed=nested?!refused:result.documentEvents===1;
  const canonicalAfter=nested?c.after_canonical:result.canonical_json;
  const rolesAfter=nested?paths(c.roles_after):clone(result.roles??rolesBefore),selectionAfter=nested?result.selection:result.selection??selection;
  const expected=state(canonicalAfter,rolesAfter,selectionAfter,changed?1:0,changed?1:0,changed?1:0);
  const effect=refused?'refused':changed?'changed':'unchanged';
  const first={kind:'command',intent:clone(c.intent),expected:{effect,state:expected,events:changed?1:0}};
  if(refused)first.expected.diagnostic=nested?{...clone(result.diagnostic),stamp:'CURRENT_STAMP'}:
    // Native commands::refusal categorizes CommandInvalidTarget as command;
    // the legacy compact fixture pins only its code, not that full envelope.
    diagnostic(result.code,result.code==='kwdj.command_invalid_target'?'command':result.code.startsWith('kwdj.')?'profile':'sdk');
  if(nested&&result.maps?.forward)first.expected.source_step_map=clone(result.maps.forward[0]);
  const operations=[first,...clone(contract.reused_public_map_probes?.[c.id]??[])];
  if(changed){
    operations.push({kind:'history',direction:'undo',expected:{effect:'changed',state:state(canonical,rolesBefore,selection,2,2,0,1),events:1}});
    operations.push({kind:'history',direction:'redo',expected:{effect:'changed',state:state(canonicalAfter,rolesAfter,selectionAfter,3,3,1,0),events:1}});
  }
  return {id:c.id,source,input_canonical:canonical,roles_before:rolesBefore,selection:clone(selection),
    profile_options:nested?clone(c.profile_options):{identities:{media:[],references:[]},limits:null},operations};
}
function roleTokens(value,roles,key=''){
  if(['node','parent'].includes(key)&&typeof value==='string'&&Object.hasOwn(roles,value))return `@${value}`;
  if(Array.isArray(value))return value.map(v=>roleTokens(v,roles,key));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,roleTokens(v,roles,k)]));
  return value;
}
export function loadDragCases({packet}={}){
  const {contract,reused,pins}=loadDragContract();packet??=parse('artifacts/extensions/packet.json');
  assert(packet.kwdjProfile&&typeof packet.kwdjRegistryJson==='string','Actual compiled profile packet');
  const literals=[...contract.new_cases.map(clone),...reused.map(({source,literal})=>reusedCase(source,literal,contract))];
  const cases=literals.map(literal=>{
    assert(Array.isArray(literal.operations)&&literal.operations.length<=24);
    const roles=literal.roles_before;
    const operations=literal.operations.map(op=>op.kind==='command'?{
      kind:'command',command:{id:contract.command_id,payload:roleTokens(op.intent,roles)},
    }:op.kind==='history'?{kind:'history',direction:op.direction}:{
      kind:'map',from_revision:op.from_revision,position:roleTokens(op.position,roles),
    });
    return {job:{id:literal.id,input:literal.input_canonical,roles_before:clone(roles),selection:roleTokens(literal.selection,roles),
      profile:clone(packet.kwdjProfile),registry_json:packet.kwdjRegistryJson,
      profile_options_json:JSON.stringify(literal.profile_options),operations},expected:clone(literal)};
  });
  return {cases,qualifiedNotRun:clone(contract.qualified_not_run),pins};
}
