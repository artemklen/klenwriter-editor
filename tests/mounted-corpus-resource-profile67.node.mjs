// SPDX-License-Identifier: MIT OR Apache-2.0
// Prospective controlled data/source checks only; no editor/native/browser run.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {lstat,readFile} from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import {RESOURCE_KEYS} from '../scripts/mounted-corpus/protocol.mjs';
import {interactionValidators,assessInteraction} from '../scripts/mounted-corpus/collect-interactions.mjs';
import {RESOURCE_PROFILE67_ID,RESOURCE_PROFILE67_PATH,resourceSchema67,resourceKeys67,assertResourceProfile67,assertResourceProfileBinding67,assertSettledResources67,loadMountedResourceProfile67} from '../scripts/mounted-corpus/resource-profile67.mjs';
const ROOT=new URL('../',import.meta.url),MODULE='scripts/mounted-corpus/resource-profile67.mjs',CONTROL='tests/mounted-corpus-resource-profile67.node.mjs';
const BUNDLE='contracts/mounted-e2e/v1.5/source-snapshot-c82-bundle.json',ID=RESOURCE_PROFILE67_ID;
const hash=b=>createHash('sha256').update(b).digest('hex'),copy=v=>JSON.parse(JSON.stringify(v));
const pin=(path,b)=>({path,bytes:b.byteLength,sha256:hash(b)}),encode=v=>Buffer.from(JSON.stringify(v)+'\n');
const corrupt=b=>{const out=Uint8Array.from(b);assert(out.length);out[out.length-1]^=1;return out;};
const refusal=e=>{assert.match(e?.code??'',/^mounted-corpus\.resource_profile67\./);return true;};
function readerWith(overrides=new Map(),calls=[]){return async(path,maximum)=>{calls.push({path,maximum});assert(typeof path==='string'&&!path.startsWith('/')&&!path.includes('\\')&&!path.includes('\0')&&!path.split('/').some(p=>!p||p==='.'||p==='..'));assert(Number.isSafeInteger(maximum)&&maximum>=0&&maximum<=268435456);let b;if(overrides.has(path))b=Uint8Array.from(overrides.get(path));else{const u=new URL(path,ROOT),s=await lstat(u);assert(s.isFile()&&!s.isSymbolicLink()&&s.size<=maximum);b=await readFile(u);}assert(b.byteLength<=maximum);return b;};}
const base=JSON.parse(Buffer.from(await readerWith()('contracts/mounted-e2e/v1/observation.schema.json',262144)).toString('utf8'));
const descriptor=JSON.parse(Buffer.from(await readerWith()(RESOURCE_PROFILE67_PATH,262144)).toString('utf8'));
function validateDef(schema,name){return new Ajv2020({strict:true}).compile({$schema:schema.$schema,$defs:schema.$defs,$ref:`#/$defs/${name}`});}
const sdk=(life='ready',deadline=0)=>({...Object.fromEntries(RESOURCE_KEYS.sdk.map(k=>[k,k==='lifecycle'?life:0])),loading_deadlines:deadline});
const maps=(life='ready',deadline=0)=>({mounted:Object.fromEntries(Object.entries(RESOURCE_KEYS).filter(([k])=>!['native','ui'].includes(k)).map(([g,keys])=>[g,g==='sdk'?sdk(life,deadline):Object.fromEntries(keys.map(k=>[k,0]))])),ui:null});
let shared;
async function context(){if(!shared){const overrides=new Map(),calls=[],raw=readerWith(overrides,calls),layer=await loadMountedResourceProfile67({readArtifact:raw,resourceProfile:ID});shared={overrides,calls,raw,layer};}return shared;}

test('legacy11 remains unchanged while explicit67 requires the complete strict12 SDK map',()=>{
 const before=copy(base),schema=resourceSchema67(base,ID);assert.equal(resourceSchema67(base,undefined),base);assert.deepEqual(base,before);const expected=copy(base),def=expected.$defs.sdkResources;def.required.push('loading_deadlines');def.properties.loading_deadlines={type:'integer',minimum:0,maximum:1};def.allOf=[{if:{properties:{lifecycle:{not:{const:'loading'}}}},then:{properties:{loading_deadlines:{const:0}}}}];assert.deepEqual(schema,expected);
 const old=validateDef(base,'sdkResources'),modern=validateDef(schema,'sdkResources'),oldValue=Object.fromEntries(RESOURCE_KEYS.sdk.map(k=>[k,k==='lifecycle'?'ready':0]));assert(old(oldValue));assert.equal(old(sdk()),false);assert.equal(modern(oldValue),false);assert(modern(sdk()));assert.equal(Object.keys(sdk()).length,12);assert.equal(resourceKeys67(undefined,RESOURCE_KEYS),RESOURCE_KEYS);assert.deepEqual(resourceKeys67(ID,RESOURCE_KEYS).sdk,[...RESOURCE_KEYS.sdk,'loading_deadlines']);
});

test('explicit67 preserves all old constraints and bounds loading0..1 with zero outside loading',()=>{
 const validate=validateDef(resourceSchema67(base,ID),'sdkResources');for(const life of ['loading','ready','disposing','destroyed','fatal'])assert(validate(sdk(life,0)));assert(validate(sdk('loading',1)));for(const life of ['ready','disposing','destroyed','fatal'])assert.equal(validate(sdk(life,1)),false);
 for(const value of [-1,2,0.5,'0',null,false])assert.equal(validate(sdk('loading',value)),false);for(const key of RESOURCE_KEYS.sdk){const v=sdk();delete v[key];assert.equal(validate(v),false,key);}assert.equal(validate({...sdk(),unknown:0}),false);assert.equal(validate({...sdk(),sessions:4294967296}),false);assert.equal(validate({...sdk(),lifecycle:'unknown'}),false);
});

test('full checkpoint resources are typed and legacy/new validator modes cannot silently mix',()=>{
 const modern=interactionValidators(base,{resourceProfile:ID}),legacy=interactionValidators(base);assert(modern.resources(maps()));for(const change of [r=>{delete r.mounted.sdk.loading_deadlines;},r=>{r.mounted.sdk.unknown=0;},r=>{r.mounted.sdk.loading_deadlines=1;},r=>{delete r.mounted.dom.listeners;}]){const r=maps();change(r);assert.equal(modern.resources(r),false);}
 for(const [validators,resourceProfile]of [[legacy,ID],[modern,undefined],[modern,'unknown']]){const original={retainedRaw:{loading_deadlines:1}},before=copy(original),assessment=assessInteraction({observation:original,validators,resourceProfile});assert.equal(assessment.integrity,'FAIL');assert.equal(assessment.blocking,true);assert.equal(assessment.cleanup,'UNKNOWN');assert.deepEqual(original,before,'Configuration failure preserves the original writable observation');}for(const v of [null,'unknown',{},67])assert.throws(()=>assertResourceProfile67(v),refusal);
});

test('settled ready and refusal owners require deadline0 before any positive branch; cleanup always0',()=>{
 for(const status of ['ready','sdk_failure','dom_refused']){const owner={ready:{status},resourcesBefore:maps('ready',0),resourcesAfter:maps('destroyed',0)};assert.doesNotThrow(()=>assertSettledResources67({resourceProfile:ID,owner}));owner.resourcesBefore=maps('loading',1);assert.throws(()=>assertSettledResources67({resourceProfile:ID,owner}),refusal);owner.resourcesBefore=maps('ready',0);owner.resourcesAfter=maps('loading',1);assert.throws(()=>assertSettledResources67({resourceProfile:ID,owner}),refusal);}
 assert.doesNotThrow(()=>assertSettledResources67({resourceProfile:undefined,owner:null}));
});

test('all42 actual current source guards precede every retained c82 snapshot read',async()=>{
 const raw=readerWith();for(const p of descriptor.source.currentPins){const calls=[],overrides=new Map([[p.path,corrupt(await raw(p.path,p.bytes))]]);await assert.rejects(loadMountedResourceProfile67({readArtifact:readerWith(overrides,calls),resourceProfile:ID}),refusal);assert.equal(calls.some(c=>c.path===BUNDLE),false,p.path);}
});

test('later current mutations block snapshot/historical aliases and whole raw inventory; tiny aliases perform no reads',async()=>{
 const c=await context(),target=descriptor.source.snapshotPins.find(p=>p.path==='scripts/mounted-corpus/run.mjs');for(const p of descriptor.source.currentPins){c.overrides.set(p.path,corrupt(await c.raw(p.path,p.bytes)));try{for(const invoke of [()=>c.layer.retainedC82SourceReader(c.raw)(target.path,target.bytes),()=>c.layer.historicalAuthorityReader(c.raw)('packages/sdk/src/controller.ts',1048576),()=>c.layer.captureRuntimeInventory('a'.repeat(40))]){c.calls.length=0;await assert.rejects(invoke(),refusal);assert.equal(c.calls.some(v=>v.path===BUNDLE),false,p.path);}}finally{c.overrides.delete(p.path);}}
 const old47=JSON.parse(Buffer.from(await c.raw('contracts/mounted-e2e/v1.1/source-continuation47.json',32454)).toString('utf8')),minimum=old47.authorities.find(p=>p.path==='packages/sdk/src/controller.ts').historical.bytes;c.calls.length=0;await assert.rejects(c.layer.retainedC82SourceReader(c.raw)(target.path,target.bytes-1),refusal);await assert.rejects(c.layer.historicalAuthorityReader(c.raw)('packages/sdk/src/controller.ts',minimum-1),refusal);assert.deepEqual(c.calls,[]);
});

test('c82 is retained source only; all six inherited Node test bodies and frozen v1/v1.4 data stay exact',async()=>{
 const c=await context(),bytes=await c.raw(BUNDLE,262144),bundle=JSON.parse(Buffer.from(bytes).toString('utf8'));assert.equal(bundle.sourceSnapshot,'c82f3c8641e9a27aed5edca6f890e533024f579b');assert.equal(bundle.retained.length,7);assert.equal(bundle.changes.length,10);for(const r of bundle.retained){const expected=descriptor.source.snapshotPins.find(p=>p.path===r.path),old=Buffer.from(r.utf8),current=await c.raw(r.path,262144);assert.deepEqual(pin(r.path,old),expected);assert.equal(hash(await c.layer.retainedC82SourceReader(c.raw)(r.path,expected.bytes)),expected.sha256);if(r.path.startsWith('tests/')){const a=r.utf8.indexOf('\ntest('),now=Buffer.from(current).toString('utf8'),b=now.indexOf('\ntest(');assert(a>=0&&b>=0);assert.equal(now.slice(b),r.utf8.slice(a));}}
 for(const p of [descriptor.source.previousManifest,descriptor.source.previousHelper,descriptor.baseSchema.pin])assert.deepEqual(pin(p.path,await c.raw(p.path,p.bytes)),p);
});

test('whole192 runtime inventory is original unaliased data under unchanged path/byte ceilings',async()=>{
 const c=await context(),inventory=await c.layer.captureRuntimeInventory('b'.repeat(40));assert.equal(inventory.format,'mounted-corpus-source-runtime-inventory/5');assert.equal(inventory.sourceSHA,'b'.repeat(40));assert.deepEqual(inventory.budgets,{paths:192,artifactBytes:1048576,aggregateBytes:8388608});assert.equal(inventory.pins.length,192);assert.deepEqual(inventory.pins.map(p=>p.path),descriptor.source.rawPaths);assert.equal(new Set(inventory.pins.map(p=>p.path)).size,192);let bytes=0;for(const p of inventory.pins){const actual=await c.raw(p.path,1048576);assert.deepEqual(pin(p.path,actual),p);bytes+=p.bytes;}assert(bytes<=8388608);assert.equal(inventory.resourceProfile.selectedProfile,ID);for(const path of [MODULE,CONTROL]){const p=inventory.pins.find(v=>v.path===path);c.overrides.set(path,corrupt(await c.raw(path,p.bytes)));try{const later=await c.layer.captureRuntimeInventory('b'.repeat(40));assert.notEqual(later.pins.find(v=>v.path===path).sha256,p.sha256);}finally{c.overrides.delete(path);}}
 for(const x of [undefined,null,67,'','a'.repeat(39),'a'.repeat(41),'g'.repeat(40),'a'.repeat(40)+'\n'])await assert.rejects(c.layer.captureRuntimeInventory(x),refusal);
});

test('profile/source binding is explicit in both directions and rejects absent/foreign/duplicate source metadata',async()=>{
 const c=await context(),inventory=await c.layer.captureRuntimeInventory('c'.repeat(40)),runId='mounted45-00000000-0000-4000-8000-000000000067',sidecar=`artifacts/mounted-corpus/runs/${runId}/source-continuation67-runtime-before.json`,sidecarBytes=encode(inventory),sidecarPin=pin(sidecar,sidecarBytes),profile=inventory.resourceProfile,binding={runId,sourceSHA:inventory.sourceSHA,scenarioPins:[profile.descriptor,profile.policyModule,profile.control,profile.baseSchema,sidecarPin]};c.overrides.set(sidecar,sidecarBytes);
 try{assert.equal((await assertResourceProfileBinding67({resourceProfile:ID,runBinding:binding,readArtifact:c.raw})).selectedProfile,ID);c.calls.length=0;await assert.rejects(assertResourceProfileBinding67({resourceProfile:undefined,runBinding:binding,readArtifact:c.raw}),refusal);assert.deepEqual(c.calls,[]);const sidecarOnly=copy(binding);sidecarOnly.scenarioPins=sidecarOnly.scenarioPins.filter(p=>![RESOURCE_PROFILE67_PATH,MODULE,CONTROL].includes(p.path));await assert.rejects(assertResourceProfileBinding67({resourceProfile:undefined,runBinding:sidecarOnly,readArtifact:c.raw}),refusal);assert.equal(await assertResourceProfileBinding67({resourceProfile:undefined,runBinding:{scenarioPins:[]}}),null);await assert.rejects(assertResourceProfileBinding67({resourceProfile:ID,runBinding:{scenarioPins:[]},readArtifact:c.raw}),refusal);
  const duplicate=copy(binding);duplicate.scenarioPins.push(copy(profile.descriptor));await assert.rejects(assertResourceProfileBinding67({resourceProfile:ID,runBinding:duplicate,readArtifact:c.raw}),refusal);
  for(const mutate of [v=>{v.sourceSHA='d'.repeat(40);},v=>{v.resourceProfile.selectedProfile=null;},v=>{v.pins[0].sha256='e'.repeat(64);},v=>{v.pins[1]=copy(v.pins[0]);}]){const wrong=copy(inventory);mutate(wrong);const b=encode(wrong),bound=copy(binding);bound.scenarioPins[4]=pin(sidecar,b);c.overrides.set(sidecar,b);await assert.rejects(assertResourceProfileBinding67({resourceProfile:ID,runBinding:bound,readArtifact:c.raw}),refusal);}c.overrides.set(sidecar,sidecarBytes);
 }finally{c.overrides.delete(sidecar);}
});
