// SPDX-License-Identifier: MIT OR Apache-2.0
import {lstatSync, readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import {captureRendererInventory,assertResourceProfileBinding67,RESOURCE_PROFILE67_ID} from '../scripts/mounted-corpus/renderer-source.mjs';
import {descriptorPin,decodeDescriptor,previousBytes} from '../scripts/mounted-corpus/renderer-source-data.mjs';
const root=new URL('../',import.meta.url);
function raw(path,maximum){
  const url=new URL(path,root),stat=lstatSync(url);
  assert(stat.isFile() && stat.size<=maximum);return readFileSync(url);
}
const hex=buffer=>createHash('sha256').update(buffer).digest('hex');
const descriptor=decodeDescriptor(raw(descriptorPin.path,descriptorPin.bytes));
const sourceSHA='a'.repeat(40),runId='mounted45-00000000-0000-4000-8000-000000000067';
const resourceProfile=RESOURCE_PROFILE67_ID;
test('renderer inventory binds actual files and keeps independently checked historical bytes',async()=>{
  const inventory=await captureRendererInventory(raw,sourceSHA),pins=new Map(inventory.pins.map(p=>[p.path,p]));
  assert.equal(inventory.sourceSHA,sourceSHA);assert.equal(inventory.base,descriptor.base);
  for(const row of descriptor.changes){
    const actual=raw(row.current.path,row.current.bytes);
    assert.deepEqual(pins.get(row.current.path),row.current);assert.equal(hex(actual),row.current.sha256);
    assert.equal(hex(previousBytes(row,actual)),row.previous.sha256);
    const altered=Buffer.from(actual);altered[0]^=1;
    await assert.rejects(captureRendererInventory((path,max)=>path===row.current.path?altered:raw(path,max),sourceSHA));
    assert.throws(()=>previousBytes(row,altered));
  }
  for(const p of descriptor.extra){assert.deepEqual(pins.get(p.path),p);assert.equal(hex(raw(p.path,p.bytes)),p.sha256);}
  const sidecar='artifacts/mounted-corpus/runs/'+runId+'/renderer-source-runtime-before.json';
  const encoded=Buffer.from(JSON.stringify(inventory,null,2)+'\n'),meta=inventory.resourceProfile;
  const marker={path:sidecar,bytes:encoded.length,sha256:hex(encoded)};
  const runBinding={runId,sourceSHA,scenarioPins:[meta.descriptor,meta.policyModule,meta.control,meta.baseSchema,marker]};
  const readArtifact=(p,max)=>p===sidecar&&encoded.length<=max?encoded:raw(p,max);
  assert.deepEqual(await assertResourceProfileBinding67({runBinding,resourceProfile,readArtifact}),meta);
  await assert.rejects(assertResourceProfileBinding67({runBinding:{...runBinding,sourceSHA:'b'.repeat(40)},resourceProfile,readArtifact}));
  await assert.rejects(assertResourceProfileBinding67({runBinding,resourceProfile:undefined,readArtifact}));
  await assert.rejects(assertResourceProfileBinding67({runBinding:{...runBinding,scenarioPins:[...runBinding.scenarioPins,marker]},resourceProfile,readArtifact}));
  for(const invalid of [Object.assign(Object.create({inherited:true}),meta.descriptor),{...meta.descriptor,extra:0}]) {
    const scenarioPins=[invalid,...runBinding.scenarioPins.slice(1)];
    await assert.rejects(assertResourceProfileBinding67({runBinding:{...runBinding,scenarioPins},resourceProfile,readArtifact}));
  }
  const legacy={...marker,path:marker.path.replace('renderer-source-runtime','source-continuation67-runtime')};
  await assert.rejects(assertResourceProfileBinding67({runBinding:{...runBinding,scenarioPins:[...runBinding.scenarioPins,legacy]},resourceProfile,readArtifact}));
});
