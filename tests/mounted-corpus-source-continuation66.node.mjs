// SPDX-License-Identifier: MIT OR Apache-2.0
// Independent source/data controls, authored before execution. No product/native
// or browser run, and no inherited runtime/semantic acceptance claim.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadMountedSourceContinuation48 } from '../scripts/mounted-corpus/source-continuation48.mjs';
import { loadMountedSourceContinuation66, SOURCE_CONTINUATION66_PATH } from '../scripts/mounted-corpus/source-continuation66.mjs';
import { loadMountedSourceContinuation67 } from '../scripts/mounted-corpus/source-continuation67.mjs';

const ROOT=new URL('../',import.meta.url),SELECTED='packages/dom/src/selection.ts';
const LEGACY48='contracts/mounted-e2e/v1.2/source-continuation48.json';
const LEGACY47='contracts/mounted-e2e/v1.1/source-continuation47.json';
const HARNESS=['scripts/mounted-corpus/run.mjs','tests/mounted-corpus-source-continuation.node.mjs',
  'tests/mounted-corpus-collector.node.mjs','tests/mounted-corpus-interactions.node.mjs'];
const hash=b=>createHash('sha256').update(b).digest('hex');
const corrupt=b=>{const out=Uint8Array.from(b);assert(out.length);out[out.length-1]^=1;return out;};
const refusal=error=>{assert.match(error?.code??'',/^mounted-corpus\.source_continuation(?:48|66)?\./);return true;};
function ordinaryReaderWith(overrides=new Map(),calls=[]){
  return async(path,maximum)=>{
    calls.push({path,maximum});assert.ok(typeof path==='string'&&!path.startsWith('/')&&!path.includes('\\')&&!path.includes('\0')&&!path.split('/').some(p=>!p||p==='.'||p==='..'));
    assert.ok(Number.isSafeInteger(maximum)&&maximum>=0&&maximum<=268435456);let bytes;
    if(overrides.has(path))bytes=Uint8Array.from(overrides.get(path));
    else{const url=new URL(path,ROOT),stat=await lstat(url);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=maximum,`Actual bounded regular source ${path}`);bytes=await readFile(url);}
    assert.ok(bytes.byteLength<=maximum);return bytes;
  };
}
// The unchanged66 controls retain accepted66 source authority. Fresh actual67
// is guarded independently; corruption overrides still target their old namespace.
const actual67Reader=ordinaryReaderWith();
const current67Layer=await loadMountedSourceContinuation67({readArtifact:actual67Reader});
const accepted66SourceReader=current67Layer.retained66SourceReader(actual67Reader);
function readerWith(overrides=new Map(),calls=[]){
  const overridden=ordinaryReaderWith(overrides,calls);
  return async(path,maximum)=>{
    if(overrides.has(path))return overridden(path,maximum);
    calls.push({path,maximum});return accepted66SourceReader(path,maximum);
  };
}
async function manifests(){
  const source=readerWith(),bytes=await source(SOURCE_CONTINUATION66_PATH,262144),manifest=JSON.parse(Buffer.from(bytes).toString('utf8'));
  assert.equal(manifest.status,'FINALIZED_SOURCE_CONTRACT','Pending source must not execute the active controls');
  const b48=await source(LEGACY48,34648),b47=await source(LEGACY47,32454);
  assert.equal(hash(b48),'87f7c7b4059b662bcee05f0e90301eb44dcff329a15cc68e22e0bc335ac02ca7');
  assert.equal(hash(b47),'d6986b1010d0e8d9d4e1594410d0c92cc695ad27df2d65e77cbcac04a5ba4621');
  return {manifest,legacy48:JSON.parse(Buffer.from(b48).toString('utf8')),legacy47:JSON.parse(Buffer.from(b47).toString('utf8'))};
}
const entries=manifest=>[...manifest.authorities,...manifest.harness,manifest.legacy48.control];
const retainedRead=c=>c.path.startsWith('contracts/mounted-e2e/v1.3/source-authority/accepted48/');

test('66 preserves all32 authority/4 harness memberships and only one production authority delta',async()=>{
  const {manifest,legacy48,legacy47}=await manifests();assert.equal(manifest.accepted48Commit,'bd92d9469e05a4ba1d43a71700b41fb9d1a50c8a');
  assert.equal(manifest.authorities.length,32);assert.equal(manifest.harness.length,4);assert.deepEqual(manifest.authorities.map(e=>e.path),legacy48.authorities.map(e=>e.path));assert.deepEqual(legacy48.authorities.map(e=>e.path),legacy47.authorities.map(e=>e.path));
  assert.equal(legacy47.authorities.flatMap(e=>e.references).length,35);assert.equal(legacy47.changes.length,8);assert.deepEqual(manifest.harness.map(e=>e.path),HARNESS);assert.deepEqual(legacy48.harness.map(e=>e.path),HARNESS);
  assert.deepEqual(manifest.authorityChangedPaths,[SELECTED]);assert.deepEqual(manifest.changedPaths,[SELECTED,...HARNESS,manifest.legacy48.control.path].sort());assert.equal(manifest.changes.length,6);assert.deepEqual(manifest.budgets,legacy48.budgets);
  for(const entry of [...manifest.authorities,...manifest.harness])assert.deepEqual(entry.accepted48,[...legacy48.authorities,...legacy48.harness].find(e=>e.path===entry.path).current48);
  const source=readerWith();for(const entry of entries(manifest)){const retained=await source(entry.retained48.path,entry.accepted48.bytes);assert.equal(hash(retained),entry.accepted48.sha256);assert.equal(retained.byteLength,entry.accepted48.bytes);}
  assert.equal(manifest.legacy48.control.accepted48.bytes,10159);assert.equal(manifest.legacy48.control.accepted48.sha256,'b6786abbdbb0b40109c5dba43c1d8a9b3cb3f605c04e6b599d504ea1442c0396');
});

test('every actual66 current pin is checked before any retained48 namespace read',async()=>{
  const {manifest}=await manifests(),source=readerWith();
  for(const entry of entries(manifest)){
    const calls=[],overrides=new Map([[entry.path,corrupt(await source(entry.path,entry.current66.bytes))]]);
    await assert.rejects(loadMountedSourceContinuation66({readArtifact:readerWith(overrides,calls)}),refusal);
    assert.equal(calls.some(retainedRead),false,`All current pins precede any old48 alias: ${entry.path}`);
  }
});

test('fresh later changes in selection, unchanged authority or reader harness invalidate EVERY alias',async()=>{
  const {manifest}=await manifests(),overrides=new Map(),calls=[],source=readerWith(overrides,calls),outer=await loadMountedSourceContinuation66({readArtifact:source});
  const selected=manifest.authorities.find(e=>e.path===SELECTED),untouched=manifest.authorities.find(e=>e.path==='contracts/kwdj/v1/README.md');
  for(const entry of [selected,untouched,...manifest.harness,manifest.legacy48.control]){
    overrides.set(entry.path,corrupt(await source(entry.path,entry.current66.bytes)));
    for(const invoke of [()=>outer.retained48SourceReader(source)(SELECTED,selected.accepted48.bytes),()=>outer.historicalAuthorityReader(source)(SELECTED,1048576),()=>outer.captureRuntimeInventory('a'.repeat(40))]){
      calls.length=0;await assert.rejects(invoke(),refusal);assert.equal(calls.some(retainedRead),false,`Later current mutation blocks all historical reads: ${entry.path}`);
    }
    overrides.delete(entry.path);
  }
});

test('unchanged48 loader sees exact retained48, then unchanged47/45 lineage',async()=>{
  const {manifest,legacy48,legacy47}=await manifests(),source=readerWith(),outer=await loadMountedSourceContinuation66({readArtifact:source});
  const alias=outer.retained48SourceReader(source),inner=await loadMountedSourceContinuation48({readArtifact:alias}),receipt=await inner.verifyAll();
  assert.equal(receipt.currentProductionAnchor,legacy48.currentProductionAnchor);assert.equal(receipt.authorities.length,32);assert.equal(receipt.harness.length,4);
  const entry=manifest.authorities.find(e=>e.path===SELECTED),actual=await source(SELECTED,entry.current66.bytes),retained=await alias(SELECTED,entry.accepted48.bytes);
  assert.equal(hash(actual),entry.current66.sha256);assert.equal(hash(retained),entry.accepted48.sha256);assert.notEqual(hash(actual),hash(retained));
  const historical=await outer.historicalAuthorityReader(source)(SELECTED,1048576);assert.equal(hash(historical),legacy47.authorities.find(e=>e.path===SELECTED).historical.sha256);
});

test('retained48 corruption after initialization cannot hide behind healthy current66',async()=>{
  const {manifest}=await manifests(),overrides=new Map(),source=readerWith(overrides),outer=await loadMountedSourceContinuation66({readArtifact:source});
  const target=manifest.authorities.find(e=>e.path===SELECTED);
  for(const entry of entries(manifest)){
    const pin=entry.retained48;overrides.set(pin.path,corrupt(await source(pin.path,pin.bytes)));
    await assert.rejects(outer.retained48SourceReader(source)(SELECTED,target.accepted48.bytes),refusal);
    await assert.rejects(outer.historicalAuthorityReader(source)(SELECTED,1048576),refusal);overrides.delete(pin.path);
  }
});

test('old retained47/45, unchanged helper/manifest and all6 reviewed delta corruptions refuse',async()=>{
  const {manifest,legacy48,legacy47}=await manifests(),source=readerWith();
  const pins=[manifest.legacy48.manifest,manifest.legacy48.helper,legacy48.legacy47.manifest,legacy48.legacy47.helper,
    legacy48.authorities.find(e=>e.path===SELECTED).retained47,legacy47.authorities.find(e=>e.path===SELECTED).retained,
    ...manifest.changes.map(c=>c.delta)];
  for(const pin of pins)await assert.rejects(loadMountedSourceContinuation66({readArtifact:readerWith(new Map([[pin.path,corrupt(await source(pin.path,pin.bytes))]]))}),refusal);
});

test('aliases cannot substitute for original actual66 source reader',async()=>{
  await manifests();const source=readerWith(),outer=await loadMountedSourceContinuation66({readArtifact:source});
  for(const alias of [outer.retained48SourceReader(source),outer.historicalAuthorityReader(source)])await assert.rejects(loadMountedSourceContinuation66({readArtifact:alias}),refusal);
});

test('current66 runtime inventory is wholly unaliased and fits inherited192/8MiB caps',async()=>{
  const {manifest}=await manifests(),source=readerWith(),outer=await loadMountedSourceContinuation66({readArtifact:source}),inventory=await outer.captureRuntimeInventory('b'.repeat(40));
  assert.equal(inventory.format,'mounted-corpus-source-runtime-inventory/3');assert.equal(inventory.sourceSHA,'b'.repeat(40));assert.equal(inventory.currentProductionAnchor,manifest.currentProductionAnchor);
  assert.deepEqual(inventory.budgets,{paths:192,artifactBytes:1048576,aggregateBytes:8388608});const expected=[...new Set([...outer.sourcePaths,...outer.requiredCurrentPaths])].sort();assert.deepEqual(inventory.pins.map(p=>p.path),expected);assert.equal(expected.length,181);assert.equal(new Set(expected).size,181);
  let total=0;for(const pin of inventory.pins){const bytes=await source(pin.path,inventory.budgets.artifactBytes);assert.equal(bytes.byteLength,pin.bytes);assert.equal(hash(bytes),pin.sha256);total+=bytes.byteLength;}assert.ok(total<=8388608);
  for(const entry of entries(manifest))assert.deepEqual(inventory.pins.find(p=>p.path===entry.path),entry.current66);
  const selected=manifest.authorities.find(e=>e.path===SELECTED);assert.deepEqual(inventory.pins.find(p=>p.path===selected.retained48.path),selected.retained48);assert.notEqual(selected.current66.sha256,selected.accepted48.sha256);
});

test('fresh runtime inventory detects later raw helper/control changes rather than cached aliases',async()=>{
  await manifests();const overrides=new Map(),source=readerWith(overrides),outer=await loadMountedSourceContinuation66({readArtifact:source});
  const before=await outer.captureRuntimeInventory('c'.repeat(40));
  for(const path of ['scripts/mounted-corpus/source-continuation66.mjs','tests/mounted-corpus-source-continuation66.node.mjs']){
    const pin=before.pins.find(p=>p.path===path);assert.ok(pin);overrides.set(path,corrupt(await source(path,pin.bytes)));const after=await outer.captureRuntimeInventory('c'.repeat(40));assert.notDeepEqual(after,before);assert.notEqual(after.pins.find(p=>p.path===path).sha256,pin.sha256);overrides.delete(path);
  }
});

test('non-authority build/observation reads pass through unchanged; too-small aliases do not read',async()=>{
  const {manifest,legacy47}=await manifests(),source=readerWith(),outer=await loadMountedSourceContinuation66({readArtifact:source}),bytes=new Uint8Array([3,2,1]),calls=[];
  const fallback=async(path,maximum)=>{calls.push({path,maximum});return bytes;};
  for(const alias of [outer.retained48SourceReader(fallback),outer.historicalAuthorityReader(fallback)])for(const path of ['observations/owned.json','interactions/owned.json','artifacts/sdk-native-manifest-v2.json','packages/wasm/dist/editor_wasm_bg.wasm']){assert.equal(await alias(path,123),bytes);assert.deepEqual(calls.pop(),{path,maximum:123});}
  const selected=manifest.authorities.find(e=>e.path===SELECTED),old=legacy47.authorities.find(e=>e.path===SELECTED);
  await assert.rejects(outer.retained48SourceReader(fallback)(SELECTED,selected.accepted48.bytes-1),refusal);await assert.rejects(outer.historicalAuthorityReader(fallback)(SELECTED,old.historical.bytes-1),refusal);assert.deepEqual(calls,[]);
});

test('runtime SHA is exactly40hex, including final line terminators',async()=>{
  await manifests();const outer=await loadMountedSourceContinuation66({readArtifact:readerWith()});
  for(const value of [undefined,null,66,'','a'.repeat(39),'a'.repeat(41),'g'.repeat(40),...['\n','\r','\r\n','\u2028','\u2029'].map(s=>'a'.repeat(40)+s)])await assert.rejects(outer.captureRuntimeInventory(value),refusal);
});
