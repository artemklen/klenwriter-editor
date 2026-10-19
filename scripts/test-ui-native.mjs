// SPDX-License-Identifier: MIT OR Apache-2.0
// Finite frozen semantic vectors, actual native public bridge and sealed WASM
// through the public SDK. This lane makes no browser/OS-input claim.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { computeSdkBuildIdentity } from './generate-sdk-types.mjs';
import { loadUiSemanticCases } from './ui-semantic-data.mjs';
import { assertUiSemanticObservation } from './ui-semantic-assertions.mjs';
import { defaultSdkCargoFeatures } from './sdk-distribution.mjs';

const directory='artifacts/ui/native',sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const clone=value=>structuredClone(value),write=(name,value)=>writeFileSync(`${directory}/${name}`,JSON.stringify(value,null,2)+'\n');
mkdirSync(directory,{recursive:true});
const source=computeSdkBuildIdentity(),cases=loadUiSemanticCases(),job={cases:cases.map(c=>c.job)};
write('job.json',job);
const commands=[];
function run(label,command,args,input){
  const start=new Date().toISOString();
  const result=spawnSync(command,args,{encoding:'utf8',input,env:{...process.env,KLENWRITER_EDITOR_SDK_BUILD_ID:source.buildId},maxBuffer:64*1024*1024,timeout:20*60*1000});
  for(const [name,value]of [['stdout',result.stdout],['stderr',result.stderr]])writeFileSync(`${directory}/${label}.${name}.log`,value??'');
  commands.push({label,command,args,start,finishedAt:new Date().toISOString(),status:result.status,error:result.error?.message??null,stdoutSha256:sha(result.stdout??''),stderrSha256:sha(result.stderr??'')});
  write('commands.json',commands);
  assert(!result.error,result.error?.message);assert.equal(result.status,0,result.stderr);
  return result.stdout;
}
const result={format:'editor-ui-native-proof/1',status:'failed',scope:'Frozen semantic literals through actual native Bridge2 and sealed packaged SDK2. Not DOM/browser/physical input.',sourceBuildId:source.buildId,wasmSha256:sha(readFileSync('packages/wasm/dist/editor_wasm_bg.wasm')),cases:[],commands};
try{
  run('compile','cargo',['build','--locked','--release','-p','klenwriter-editor-wasm',...defaultSdkCargoFeatures,'--example','ui_native']);
  const native=JSON.parse(run('observe','target/release/examples/ui_native',[],JSON.stringify(job)));
  write('native-raw.json',native);assert.equal(native.status,'recorded');assert.equal(native.manifest.build_id,source.buildId);assert.equal(native.records.length,cases.length);
  for(const [index,c]of cases.entries()){
    const row=native.records[index];assert.equal(row.id,c.job.id);assert.equal(row.status,'recorded');
    result.cases.push(assertUiSemanticObservation(c,row.observation,'native'));
    assert.deepEqual(row.released,{sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});
  }
  const {createEditor,loadSdkV2,createCommand}=await import('../packages/sdk/dist/index.js');
  const module=await loadSdkV2({wasm:new Uint8Array(readFileSync('packages/wasm/dist/editor_wasm_bg.wasm'))});
  assert.equal(module.manifest.build_id,source.buildId);
  const raw=[];
  const zero={sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0};
  for(const c of cases){
    assert.deepEqual(JSON.parse(module.resourceCounts()),zero);
    const j=c.job,calls=[],publications=[];let initial=null,subscription=null;
    const editor=createEditor({input:new TextEncoder().encode(j.input),options:{abi:'editor-sdk/2',build_id:module.manifest.build_id,profile:j.profile,admission:'validate',access:'editable',registry_json:j.registry_json,profile_options_json:j.profile_options_json},loader:async()=>module});
    try{
    initial=await editor.ready;assert.equal(initial.status,'ok',JSON.stringify(initial));
    subscription=editor.subscribe(event=>publications.push(clone(event)));assert.equal(typeof subscription,'function');
    const call=request=>{
      let response;
      if(['state','node','catalog','resources'].includes(request.kind))response=editor.read(request);
      else if(['query_command','query_history'].includes(request.kind))response=editor.query(request);
      else{const ticket=editor.submit(request);assert.equal(ticket.status,'completed','Finite idle semantic calls are synchronous');response=ticket.response;}
      calls.push({request:clone(request),response:clone(response)});return clone(response);
    };
    const ok=request=>{const r=call(request);assert.equal(r.status,'ok',JSON.stringify(r));return r.value;};
    const state=()=>ok({kind:'state'}).state;
    const checkpoint=()=>{
      const st=state(),snap=ok({kind:'snapshot',stamp:st.stamp,max_bytes:2097152});ok({kind:'release_snapshot',handle:snap.handle});
      const nodes=[],pending=[{id:st.root,path:[]}],seen=new Set();
      for(let index=0;index<pending.length;index++){
        assert(index<4096);const row=pending[index];assert(!seen.has(row.id));seen.add(row.id);
        const node=ok({kind:'node',stamp:st.stamp,node:row.id}).node;nodes.push({path:row.path,node});node.children.forEach((id,i)=>pending.push({id,path:[...row.path,i]}));
      }
      return {state:st,canonical:snap.canonical_json,nodes,resources:ok({kind:'resources'}).resources};
    };
      const admitted=checkpoint(),roles=Object.fromEntries(Object.entries(j.roles_before).map(([role,path])=>[role,admitted.nodes.find(row=>JSON.stringify(row.path)===JSON.stringify(path)).node.id]));
      const resolve=value=>{
        if(typeof value==='string'&&value.startsWith('@')){assert(Object.hasOwn(roles,value.slice(1)));return roles[value.slice(1)];}
        if(Array.isArray(value))return value.map(resolve);
        if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolve(v)]));
        return value;
      };
      ok({kind:'set_selection',stamp:admitted.state.stamp,selection:resolve(j.selection)});const setupEvents=publications.splice(0),baseline=checkpoint(),steps=[];
      for(const sourceCommand of j.commands){
        const before=checkpoint(),command=createCommand(sourceCommand.id,resolve(sourceCommand.payload));
        const query=call({kind:'query_command',stamp:before.state.stamp,command}),afterQuery=checkpoint();
        const response=call({kind:'command',stamp:before.state.stamp,command,history_hint:{kind:'isolated'}}),events=publications.splice(0),after=checkpoint();
        steps.push({before,command:clone(command),query,afterQuery,response,events,after});
      }
      const after=checkpoint(),history=[];
      if(j.history)for(const direction of ['undo','redo']){
        const before=checkpoint(),query=call({kind:'query_history',stamp:before.state.stamp,direction}),response=call({kind:'history',stamp:before.state.stamp,direction}),events=publications.splice(0),after=checkpoint();history.push({direction,query,response,events,after});
      }
      const observation={initial:clone(initial),context:clone(editor.context()),admitted,roles,setupEvents,baseline,steps,after,history};
      raw.push({id:j.id,observation,calls});write('wasm-sdk-raw.json',raw);
      result.cases.push(assertUiSemanticObservation(c,observation,'sealed-wasm-sdk'));
    }catch(error){
      const failure={message:error.message,stack:error.stack},index=raw.findIndex(row=>row.id===j.id);
      if(index>=0)raw[index]={...raw[index],status:'failed',failure};
      else raw.push({id:j.id,status:'failed',initial:clone(initial),calls,publications,failure});
      write('wasm-sdk-raw.json',raw);throw error;
    }finally{
      if(typeof subscription==='function')subscription();const ticket=editor.destroy();if(ticket.status==='queued')await ticket.completion;
      assert.deepEqual(JSON.parse(module.resourceCounts()),zero);assert.equal(editor.resources().host_requests,0);assert.equal(editor.resources().pending_tickets,0);
    }
  }
  assert.equal(computeSdkBuildIdentity().buildId,source.buildId,'Production source stayed frozen');
  result.status='passed';result.counts={literalCases:cases.length,native:cases.length,sealedWasmSdk:cases.length};
}catch(error){result.error={message:error.message,stack:error.stack};throw error;}
finally{result.finishedAt=new Date().toISOString();write('report.json',result);}
console.log(JSON.stringify({status:result.status,counts:result.counts,sourceBuildId:source.buildId,wasmSha256:result.wasmSha256}));
