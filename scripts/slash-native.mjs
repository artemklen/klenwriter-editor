// SPDX-License-Identifier: MIT OR Apache-2.0
// Independent frozen native literals and pure reader vectors, actual SDK2
// native bridge versus the packaged sealed WASM through the public SDK2.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {computeSdkBuildIdentity} from './generate-sdk-types.mjs';
import {defaultSdkCargoFeatures} from './sdk-distribution.mjs';
import {loadSlashCases} from './slash-semantic-data.mjs';
import {assertSlashObservation,compareSlashWindowTargets} from './slash-semantic-assertions.mjs';

const directory='artifacts/slash/native',clone=value=>structuredClone(value);
const sha=value=>createHash('sha256').update(value).digest('hex');
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const write=(name,value)=>writeFileSync(`${directory}/${name}`,JSON.stringify(value,null,2)+'\n');
const zero={sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0};
const controllerZero={lifecycle:'destroyed',sessions:0,listeners:0,queued_mutations:0,queued_bytes:0,
  pending_tickets:0,host_requests:0,task_continuations:0,loading_deadlines:0,original_input_bytes:0,callback_errors:0,callback_error_handlers:0};
mkdirSync(directory,{recursive:true});
const source=computeSdkBuildIdentity(),inventory=loadSlashCases(),cases=inventory.cases;
const commands=[],job={cases:cases.map(c=>c.job)};
write('job.json',job);
const pin=path=>{const bytes=readFileSync(path);return {path,bytes:bytes.length,sha256:sha(bytes)};};
const report={format:'editor-slash-native-proof/1',status:'failed',
  scope:'Frozen semantic literals and bounded pure reads through actual native Bridge2 and packaged sealed WASM/public SDK2. No DOM, event-order, installed-input or independent review claim.',
  environment:{node:process.version,platform:process.platform,arch:process.arch},
  sourceBuildId:source.buildId,producerSourceHashes:source.sourceHashes,
  producerPins:['artifacts/sdk-build-identity.json','artifacts/sdk-wasm-seal.json','artifacts/sdk-native-manifest-v2.json','packages/sdk/dist/index.js','packages/wasm/dist/editor_wasm.js','packages/wasm/dist/editor_wasm_bg.wasm'].map(pin),
  wasmSha256:sha(readFileSync('packages/wasm/dist/editor_wasm_bg.wasm')),commands,cases:[],
  inputOriginScope:'No DOM input-origin branch is executed by this headless lane. O04 remains defensive/unreachable NOT_RUN under current41 noncancelable composition policy; separate DOM tests must prove refusal gives zero ordinary notifications.',
  sdkControllerResourceScope:'Each sealed raw row persists actual controllerReleased primary/foreign resources after destroy; released and recordedReleased remain separate native module resourceCounts.',
  qualifiedNotRun:inventory.qualifiedNotRun.map(row=>({...row,status:'NOT_RUN_QUALIFIED_SOURCE_SEED'}))};
function run(label,command,args,input){
  const startedAt=new Date().toISOString(),result=spawnSync(command,args,{encoding:'utf8',input,
    env:{...process.env,KLENWRITER_EDITOR_SDK_BUILD_ID:source.buildId},maxBuffer:128*1024*1024,timeout:20*60*1000});
  for(const [name,value]of [['stdout',result.stdout],['stderr',result.stderr]])writeFileSync(`${directory}/${label}.${name}.log`,value??'');
  commands.push({label,command,args,startedAt,finishedAt:new Date().toISOString(),status:result.status,error:result.error?.message??null,stdoutSha256:sha(result.stdout??''),stderrSha256:sha(result.stderr??'')});
  write('commands.json',commands);assert(!result.error,result.error?.message);assert.equal(result.status,0,result.stderr);return result.stdout;
}
async function observeSdkCase(c,module,createEditor,createCommand){
  const j=c.job,calls=[],publications=[];let editor=null,foreign=null,subscription=null,initial=null,record=null;
  const controllerReleased={primary:null,foreign:null};
  const open=()=>createEditor({input:new TextEncoder().encode(j.input),options:{abi:'editor-sdk/2',build_id:module.manifest.build_id,
    profile:j.profile,admission:'validate',access:'editable',registry_json:j.registry_json,profile_options_json:j.profile_options_json},loader:async()=>module});
  const finish=async(instance,owner,failures)=>{
    if(!instance)return;
    try{const ticket=instance.destroy();if(ticket.status==='queued')await ticket.completion;}
    catch(error){failures.push({owner,phase:'destroy',message:error?.message??String(error),stack:error?.stack??null});}
    try{
      const resources=clone(instance.resources());controllerReleased[owner]=resources;
      assert.deepEqual(resources,controllerZero,`${owner} complete SDK controller resources after destroy`);
    }catch(error){failures.push({owner,phase:'controller-resources',message:error?.message??String(error),stack:error?.stack??null});}
  };
  try{
    editor=open();initial=await editor.ready;assert.equal(initial.status,'ok',JSON.stringify(initial));
    let foreignStamp=null;
    if(j.foreign){foreign=open();const ready=await foreign.ready;assert.equal(ready.status,'ok');foreignStamp=clone(foreign.capture());}
    subscription=editor.subscribe(event=>publications.push(clone(event)));assert.equal(typeof subscription,'function');
    const call=request=>{
      let response;
      if(['state','node','catalog','resources','text_window'].includes(request.kind))response=editor.read(request);
      else if(['query_command','query_history'].includes(request.kind))response=editor.query(request);
      else{const ticket=editor.submit(request);assert.equal(ticket.status,'completed','Finite idle headless case is synchronous');response=ticket.response;}
      calls.push({request:clone(request),response:clone(response)});return clone(response);
    };
    const ok=request=>{const response=call(request);assert.equal(response.status,'ok',JSON.stringify(response));return response.value;};
    const checkpoint=()=>{
      const state=ok({kind:'state'}).state,snapshot=ok({kind:'snapshot',stamp:state.stamp,max_bytes:2097152});
      ok({kind:'release_snapshot',handle:snapshot.handle});
      const nodes=[],pending=[{id:state.root,path:[]}],seen=new Set();
      for(let index=0;index<pending.length;index++){
        assert(index<4096,'Finite authored tree');const row=pending[index];assert(!seen.has(row.id));seen.add(row.id);
        const node=ok({kind:'node',stamp:state.stamp,node:row.id}).node;nodes.push({path:row.path,node});
        node.children.forEach((id,i)=>pending.push({id,path:[...row.path,i]}));
      }
      return {state,canonical:snapshot.canonical_json,nodes,resources:ok({kind:'resources'}).resources};
    };
    const admitted=checkpoint(),roles=Object.fromEntries(Object.entries(j.roles_before).map(([role,path])=>{
      const node=admitted.nodes.find(row=>JSON.stringify(row.path)===JSON.stringify(path));assert(node,`Authored role ${role}`);return [role,node.node.id];
    }));
    const resolve=value=>{
      if(typeof value==='string'&&value.startsWith('@')){assert(Object.hasOwn(roles,value.slice(1)));return roles[value.slice(1)];}
      if(Array.isArray(value))return value.map(resolve);
      if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolve(v)]));
      return value;
    };
    ok({kind:'set_selection',stamp:admitted.state.stamp,selection:resolve(j.selection)});
    const setupEvents=publications.splice(0),baseline=checkpoint(),steps=[],reads=[];
    for(const sourceCommand of j.commands){
      const before=checkpoint(),command=createCommand(sourceCommand.id,resolve(sourceCommand.payload));
      const query=call({kind:'query_command',stamp:before.state.stamp,command}),afterQuery=checkpoint();
      const response=call({kind:'command',stamp:before.state.stamp,command,history_hint:{kind:'isolated'}});
      const events=publications.splice(0),after=checkpoint();steps.push({before,command:clone(command),query,afterQuery,response,events,after});
    }
    for(const sourceRead of j.reads??[]){
      const before=checkpoint(),request={...resolve(sourceRead),stamp:clone(before.state.stamp)};
      if(request.use_foreign_stamp){assert(foreignStamp);request.stamp=clone(foreignStamp);}
      delete request.use_foreign_stamp;
      if(request.stamp_overrides){Object.assign(request.stamp,request.stamp_overrides);delete request.stamp_overrides;}
      const response=call(request),events=publications.splice(0),after=checkpoint();reads.push({before,request,response,events,after});
    }
    const after=checkpoint(),history=[];
    if(j.history)for(const direction of ['undo','redo']){
      const before=checkpoint(),query=call({kind:'query_history',stamp:before.state.stamp,direction});
      const response=call({kind:'history',stamp:before.state.stamp,direction}),events=publications.splice(0),after=checkpoint();history.push({direction,query,response,events,after});
    }
    record={id:j.id,status:'recorded',observation:{initial:clone(initial),context:clone(editor.context()),admitted,roles,setupEvents,baseline,steps,reads,after,history},calls};return record;
  }catch(error){record={id:j.id,status:'failed',initial:clone(initial),calls,publications:clone(publications),failure:{message:error.message,stack:error.stack}};return record;}
  finally{
    const cleanupFailures=[];
    try{if(typeof subscription==='function')subscription();}
    catch(error){cleanupFailures.push({phase:'unsubscribe',message:error?.message??String(error),stack:error?.stack??null});}
    await finish(editor,'primary',cleanupFailures);await finish(foreign,'foreign',cleanupFailures);
    if(record)record.controllerReleased=controllerReleased;
    try{const released=JSON.parse(module.resourceCounts());if(record)record.released=released;assert.deepEqual(released,zero,'All native resources released');}
    catch(error){cleanupFailures.push({message:error.message,stack:error.stack});}
    if(record&&cleanupFailures.length){record.status='failed';record.cleanupFailures=cleanupFailures;}
  }
}
const wasmRaw=[];
try{
  const seal=json('artifacts/sdk-wasm-seal.json');assert.equal(seal.sealed_sha256,report.wasmSha256,'Actual packaged sealed bytes');
  run('compile','cargo',['build','--locked','--release','-p','klenwriter-editor-wasm',...defaultSdkCargoFeatures,'--example','slash_native']);
  report.nativeBinary=pin('target/release/examples/slash_native');
  const native=JSON.parse(run('observe','target/release/examples/slash_native',[],JSON.stringify(job)));
  write('native-raw.json',native);assert.equal(native.status,'recorded');assert.equal(native.manifest.build_id,source.buildId);assert.equal(native.records.length,cases.length);
  for(const [index,c]of cases.entries()){
    const row=native.records[index];assert.equal(row.id,c.job.id);assert.equal(row.status,'recorded');
    report.cases.push(assertSlashObservation(c,row.observation,'native'));assert.deepEqual(row.released,zero);
  }
  assert.deepEqual(native.resources,zero);
  const {createEditor,loadSdkV2,createCommand}=await import('../packages/sdk/dist/index.js');
  const module=await loadSdkV2({wasm:new Uint8Array(readFileSync('packages/wasm/dist/editor_wasm_bg.wasm'))});
  assert.equal(module.manifest.build_id,source.buildId);
  for(const [index,c]of cases.entries()){
    assert.deepEqual(JSON.parse(module.resourceCounts()),zero);
    const row=await observeSdkCase(c,module,createEditor,createCommand);wasmRaw.push(row);write('wasm-sdk-raw.json',wasmRaw);
    assert.equal(row.status,'recorded',JSON.stringify(row.failure));report.cases.push(assertSlashObservation(c,row.observation,'sealed-wasm-sdk'));
    if(c.job.mode==='window')compareSlashWindowTargets(native.records[index].observation,row.observation);
  }
  assert.equal(computeSdkBuildIdentity().buildId,source.buildId,'Production source remains frozen');
  report.status='passed';report.counts={literalSemanticCases:cases.filter(c=>c.job.mode==='semantic').length,
    boundedReadCases:cases.filter(c=>c.job.mode==='window').length,native:cases.length,sealedWasmSdk:cases.length,
    qualifiedNotRun:inventory.qualifiedNotRun.length};
  report.recordedReleased={native:zero,sealedSdk:JSON.parse(module.resourceCounts())};
}catch(error){report.error={message:error.message,stack:error.stack};throw error;}
finally{report.finishedAt=new Date().toISOString();write('report.json',report);}
console.log(JSON.stringify({status:report.status,counts:report.counts,sourceBuildId:source.buildId,wasmSha256:report.wasmSha256}));
