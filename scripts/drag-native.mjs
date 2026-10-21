// SPDX-License-Identifier: MIT OR Apache-2.0
// Actual native Bridge2 and sealed public SDK2, each against source literals.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {computeSdkBuildIdentity} from './generate-sdk-types.mjs';
import {defaultSdkCargoFeatures} from './sdk-distribution.mjs';
import {loadDragCases} from './drag-semantic-data.mjs';
import {assertDragRecord,nativeModuleZero,sdkControllerZero} from './drag-semantic-assertions.mjs';

const directory='artifacts/drag/native',clone=value=>structuredClone(value),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const pin=path=>{const bytes=readFileSync(path);return {path,bytes:bytes.length,sha256:sha(bytes)};};
mkdirSync(directory,{recursive:true});
const write=(name,value)=>writeFileSync(`${directory}/${name}`,JSON.stringify(value,null,2)+'\n');
const commands=[],wasmRaw=[];
const report={format:'editor-drag-native-proof/1',status:'failed',commands,cases:[],
  environment:{node:process.version,platform:process.platform,arch:process.arch},
  scope:'Native/public sealed SDK2 semantic literals and public map projection only. No drag/input/browser/installed/CMS or independent review acceptance.',
  cleanupScope:'Per-row complete native module destroy resources; sealed rows additionally retain the original SDK destroy Submission and complete controller resources.'};
function run(label,command,args,input){
  const startedAt=new Date().toISOString(),result=spawnSync(command,args,{input,encoding:'utf8',maxBuffer:256*1024*1024,timeout:20*60*1000,
    env:{...process.env,KLENWRITER_EDITOR_SDK_BUILD_ID:report.sourceBuildId}});
  for(const [name,value]of [['stdout',result.stdout],['stderr',result.stderr]])writeFileSync(`${directory}/${label}.${name}.log`,value??'');
  commands.push({label,command,args,startedAt,finishedAt:new Date().toISOString(),status:result.status,signal:result.signal,
    error:result.error?.message??null,stdoutSha256:sha(result.stdout??''),stderrSha256:sha(result.stderr??'')});write('commands.json',commands);
  return result;
}
const successful=result=>{assert(!result.error,result.error?.message);assert.equal(result.status,0,result.stderr);};
async function observeSdk(c,module,createEditor,createCommand,record,persist){
  const j=c.job,calls=record.calls,submissions=record.submissions;let editor=null,unsubscribe=null;
  const observation=record.observation;
  try{
    editor=createEditor({input:new TextEncoder().encode(j.input),options:{abi:'editor-sdk/2',build_id:module.manifest.build_id,
      profile:j.profile,admission:'validate',access:'editable',registry_json:j.registry_json,profile_options_json:j.profile_options_json},loader:async()=>module});
    observation.initial=clone(await editor.ready);assert.equal(observation.initial.status,'ok',JSON.stringify(observation.initial));
    const publications=[];unsubscribe=editor.subscribe(event=>publications.push(clone(event)));assert.equal(typeof unsubscribe,'function');
    const call=request=>{
      let response;
      if(['state','node','resources','map_position'].includes(request.kind))response=editor.read(request);
      else if(['query_command','query_history'].includes(request.kind))response=editor.query(request);
      else{
        const ticket=editor.submit(request);
        if(ticket.status!=='completed'){
          record.unexpectedQueued={request:clone(request),status:ticket.status,ticket:clone(ticket.ticket??null)};
          record.pendingCompletion=ticket.completion;throw new Error('Finite idle semantic dispatch unexpectedly queued; original completion is retained, never replayed');
        }
        submissions.push({request:clone(request),submission:clone(ticket)});response=ticket.response;
      }
      calls.push({request:clone(request),response:clone(response)});return clone(response);
    };
    const ok=request=>{const response=call(request);assert.equal(response.status,'ok',JSON.stringify(response));return response.value;};
    const checkpoint=()=>{
      const state=ok({kind:'state'}).state,snapshot=ok({kind:'snapshot',stamp:state.stamp,max_bytes:2097152});
      ok({kind:'release_snapshot',handle:snapshot.handle});
      const nodes=[],pending=[{id:state.root,path:[]}],seen=new Set();
      for(let index=0;index<pending.length;index++){
        assert(index<4096,'Finite authored live tree');const next=pending[index];assert(!seen.has(next.id));seen.add(next.id);
        const node=ok({kind:'node',stamp:state.stamp,node:next.id}).node;nodes.push({path:next.path,node});
        node.children.forEach((id,ordinal)=>pending.push({id,path:[...next.path,ordinal]}));
      }
      return {state,canonical:snapshot.canonical_json,nodes,resources:ok({kind:'resources'}).resources};
    };
    observation.admitted=checkpoint();
    const roles=Object.fromEntries(Object.entries(j.roles_before).map(([role,path])=>{
      const found=observation.admitted.nodes.find(r=>JSON.stringify(r.path)===JSON.stringify(path));assert(found,`Authored role ${role}`);return [role,found.node.id];
    }));
    const resolve=value=>{
      if(typeof value==='string'&&value.startsWith('@')){assert(Object.hasOwn(roles,value.slice(1)));return roles[value.slice(1)];}
      if(Array.isArray(value))return value.map(resolve);
      if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,resolve(v)]));
      return value;
    };
    ok({kind:'set_selection',stamp:observation.admitted.state.stamp,selection:resolve(j.selection)});
    observation.setupEvents=publications.splice(0);observation.baseline=checkpoint();observation.roles=clone(roles);observation.context=clone(editor.context());persist();
    for(const operation of j.operations){
      const before=checkpoint();let row;
      if(operation.kind==='map'){
        const request={kind:'map_position',stamp:before.state.stamp,from_revision:operation.from_revision,position:resolve(operation.position)};
        const response=call(request),events=publications.splice(0),after=checkpoint();row={kind:'map',before,request,response,events,after};
      }else if(operation.kind==='history'){
        const direction=operation.direction,query=call({kind:'query_history',stamp:before.state.stamp,direction}),afterQuery=checkpoint();
        const response=call({kind:'history',stamp:before.state.stamp,direction}),events=publications.splice(0),after=checkpoint();
        row={kind:'history',direction,before,query,afterQuery,response,events,after};
      }else{
        assert.equal(operation.kind,'command');const command=createCommand(operation.command.id,resolve(operation.command.payload));
        const query=call({kind:'query_command',stamp:before.state.stamp,command}),afterQuery=checkpoint();
        const response=call({kind:'command',stamp:before.state.stamp,command,history_hint:{kind:'isolated'}}),events=publications.splice(0),after=checkpoint();
        row={kind:'command',before,command:clone(command),query,afterQuery,response,events,after};
      }
      observation.operations.push(row);persist();
    }
    observation.after=checkpoint();record.status='recorded';
  }catch(error){
    record.status='failed';record.failure={message:error.message,stack:error.stack};
  }finally{
    const failures=[];
    if(record.pendingCompletion){
      const original=record.pendingCompletion;delete record.pendingCompletion;
      try{record.unexpectedQueued.originalCompletion=clone(await original);}catch(error){record.unexpectedQueued.completionError=error.message;}
    }
    try{unsubscribe?.();}catch(error){failures.push({phase:'unsubscribe',message:error.message});}
    if(editor){
      try{
        const ticket=editor.destroy();
        record.destroySubmission=ticket.status==='completed'?clone(ticket):{status:ticket.status,ticket:clone(ticket.ticket??null)};
        if(ticket.status==='queued')record.destroyCompletion=clone(await ticket.completion);
      }catch(error){failures.push({phase:'destroy',message:error.message});}
      try{record.controllerReleased=clone(editor.resources());assert.deepEqual(record.controllerReleased,sdkControllerZero);}catch(error){failures.push({phase:'controller-resources',message:error.message});}
    }
    try{record.released=JSON.parse(module.resourceCounts());assert.deepEqual(record.released,nativeModuleZero);}catch(error){failures.push({phase:'native-resources',message:error.message});}
    record.cleanupFailures=failures;if(failures.length)record.status='failed';persist();
  }
}
write('wasm-sdk-raw.json',wasmRaw);
try{
  const source=computeSdkBuildIdentity(),inventory=loadDragCases();
  Object.assign(report,{sourceBuildId:source.buildId,producerSourceHashes:source.sourceHashes,oraclePins:inventory.pins,
    qualifiedNotRun:inventory.qualifiedNotRun,plannedCases:inventory.cases.map(c=>c.job.id),
    producerPins:['artifacts/sdk-build-identity.json','artifacts/sdk-wasm-seal.json','artifacts/sdk-native-manifest-v2.json',
      'packages/sdk/dist/index.js','packages/wasm/dist/editor_wasm.js','packages/wasm/dist/editor_wasm_bg.wasm'].map(pin),
    harnessPins:['scripts/drag-native.mjs','scripts/drag-semantic-data.mjs','scripts/drag-semantic-assertions.mjs','tests/fixtures/drag-native/main.rs'].map(pin)});
  const cases=inventory.cases,job={cases:cases.map(c=>c.job)};write('job.json',job);
  const seal=json('artifacts/sdk-wasm-seal.json');report.wasmSha256=sha(readFileSync('packages/wasm/dist/editor_wasm_bg.wasm'));
  assert.equal(seal.build_id,source.buildId,'Current coherent source producer required');assert.equal(seal.sealed_sha256,report.wasmSha256);
  const compile=run('compile','cargo',['build','--locked','--release','-p','klenwriter-editor-wasm',...defaultSdkCargoFeatures,'--example','drag_native']);successful(compile);
  report.nativeBinary=pin('target/release/examples/drag_native');
  const observed=run('observe','target/release/examples/drag_native',[],JSON.stringify(job));
  // Preserve valid partial native JSON before checking the original exit code.
  let native;
  try{native=JSON.parse(observed.stdout);write('native-raw.json',native);}catch(error){report.nativeRawParseError=error.message;}
  successful(observed);assert(native);assert.equal(native.status,'recorded');assert.equal(native.manifest.build_id,source.buildId);
  assert.equal(native.records.length,cases.length);
  for(const [index,c]of cases.entries())report.cases.push(assertDragRecord(c,native.records[index],'native'));
  assert.deepEqual(native.resources,nativeModuleZero);
  const {createEditor,loadSdkV2,createCommand}=await import('../packages/sdk/dist/index.js');
  const module=await loadSdkV2({wasm:new Uint8Array(readFileSync('packages/wasm/dist/editor_wasm_bg.wasm'))});assert.equal(module.manifest.build_id,source.buildId);
  for(const c of cases){
    assert.deepEqual(JSON.parse(module.resourceCounts()),nativeModuleZero);
    const row={id:c.job.id,status:'recording',observation:{operations:[]},calls:[],submissions:[]};wasmRaw.push(row);
    const persist=()=>write('wasm-sdk-raw.json',wasmRaw);
    await observeSdk(c,module,createEditor,createCommand,row,persist);report.cases.push(assertDragRecord(c,row,'sealed-wasm-sdk',{sdk:true}));
  }
  report.recordedReleased={native:native.resources,sealedSdk:JSON.parse(module.resourceCounts())};assert.deepEqual(report.recordedReleased.sealedSdk,nativeModuleZero);
  const after=computeSdkBuildIdentity();report.sourceAfter=after;assert.deepEqual(after,source,'Production source remains unchanged across actual pair');
  report.counts={planned:cases.length,native:report.cases.filter(c=>c.lane==='native').length,sealedWasmSdk:report.cases.filter(c=>c.lane==='sealed-wasm-sdk').length,
    newLiteralCases:inventory.cases.filter(c=>c.job.id.startsWith('M44-')).length,reusedFrozenCases:inventory.cases.filter(c=>!c.job.id.startsWith('M44-')).length,
    qualifiedNotRun:inventory.qualifiedNotRun.length};report.status='passed';
}catch(error){report.error={message:error.message,stack:error.stack};throw error;}
finally{report.finishedAt=new Date().toISOString();write('report.json',report);}
console.log(JSON.stringify({status:report.status,counts:report.counts,sourceBuildId:report.sourceBuildId,wasmSha256:report.wasmSha256}));
