// SPDX-License-Identifier: MIT OR Apache-2.0
// Prospective source/data controls only. No editor/native/browser observation.
import { lstatSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat,readFile} from 'node:fs/promises';
import test from 'node:test';
import {loadMountedSourceContinuation66} from '../scripts/mounted-corpus/source-continuation66.mjs';
import {loadMountedSourceContinuation67,SOURCE_CONTINUATION67_PATH} from '../scripts/mounted-corpus/source-continuation67.mjs';
import {loadMountedResourceProfile67} from '../scripts/mounted-corpus/resource-profile67.mjs';
const ROOT=new URL('../',import.meta.url),BUNDLE='contracts/mounted-e2e/v1.4/accepted66-bundle.json';
const CONTROLLER='packages/sdk/src/controller.ts',HELPER='scripts/mounted-corpus/source-continuation67.mjs',CONTROL='tests/mounted-corpus-source-continuation67.node.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const corrupt=b=>{const c=Uint8Array.from(b);assert(c.length);c[c.length-1]^=1;return c;};
const refused=e=>{assert.match(e?.code??'',/^mounted-corpus\.source_continuation(?:48|66|67)?\./);return true;};
// Actual filesystem reads remain fresh; only the underlying I/O primitive is synchronous.
const readSourceFile = async (...args) => readFileSync(...args);
const lstatSource = async (...args) => lstatSync(...args);
function ordinaryReaderWith(overrides=new Map(),calls=[]){return async(path,maximum)=>{calls.push({path,maximum});assert(typeof path==='string'&&!path.startsWith('/')&&!path.includes('\\')&&!path.includes('\0')&&!path.split('/').some(p=>!p||p==='.'||p==='..'));assert(Number.isSafeInteger(maximum)&&maximum>=0&&maximum<=268435456);let b;if(overrides.has(path))b=Uint8Array.from(overrides.get(path));else{const url=new URL(path,ROOT),s=await lstatSource(url);assert(s.isFile()&&!s.isSymbolicLink()&&s.size<=maximum);b=await readSourceFile(url);}assert(b.byteLength<=maximum);return b;};}
// These unchanged controls inspect the retained c82 SOURCE namespace only.
// Fresh actual-current checks belong to the new independent resource-profile controls.
const actualResourceReader=ordinaryReaderWith();
const currentSourceLayer=await loadMountedResourceProfile67({readArtifact:actualResourceReader});
const c82SourceReader=currentSourceLayer.retainedC82SourceReader(actualResourceReader);
function readerWith(overrides=new Map(),calls=[]){const overridden=ordinaryReaderWith(overrides,calls);return async(path,maximum)=>{if(overrides.has(path))return overridden(path,maximum);calls.push({path,maximum});return c82SourceReader(path,maximum);};}
const entries=m=>[...m.authorities,...m.harness,...m.controls];
const retained=c=>c.path===BUNDLE||c.path==='contracts/mounted-e2e/v1.3/source-authority/accepted48/packages/sdk/src/controller.ts';
async function manifest(){return JSON.parse(Buffer.from(await readerWith()(SOURCE_CONTINUATION67_PATH,262144)).toString('utf8'));}

test('67 preserves old66 source authority and exact six accepted consumer bodies within unchanged ceilings',async()=>{
 const source=readerWith(),m=await manifest(),bundle=JSON.parse(Buffer.from(await source(BUNDLE,m.bundle.bytes)).toString('utf8'));
 assert.equal(m.accepted66Commit,'369f58c2125c902be1308df451afa88482a4f9b3');assert.equal(m.authorities.length,32);assert.equal(m.harness.length,4);assert.equal(m.controls.length,2);assert.equal(entries(m).length,38);
 assert.deepEqual(m.budgets,{manifestBytes:262144,sourceBytes:262144,deltaBytes:65536,retainedBytes:2097152,runtimePaths:192,runtimeArtifactBytes:1048576,runtimeAggregateBytes:8388608});
 const old=JSON.parse(Buffer.from(await source(m.legacy66.manifest.path,m.legacy66.manifest.bytes)).toString('utf8'));assert.deepEqual(m.authorities.map(e=>e.path),old.authorities.map(e=>e.path));assert.deepEqual(m.harness.map(e=>e.path),old.harness.map(e=>e.path));
 assert.equal(bundle.retained.length,6);assert.equal(bundle.changes.length,7);assert.deepEqual(bundle.changes.map(e=>e.path),m.changedPaths);assert(m.bundle.bytes<=262144);
 for(const item of bundle.retained){const e=entries(m).find(e=>e.path===item.path),bytes=Buffer.from(item.utf8);assert.equal(bytes.length,e.accepted66.bytes);assert.equal(hash(bytes),e.accepted66.sha256);const current=await source(item.path,e.current67.bytes);assert.equal(hash(current),e.current67.sha256);if(item.path.startsWith('tests/')){const a=item.utf8.indexOf('\ntest('),text=Buffer.from(current).toString('utf8'),b=text.indexOf('\ntest(');assert(a>=0&&b>=0);assert.equal(text.slice(b),item.utf8.slice(a),'Every inherited test assertion/stimulus remains byte-exact');}}
 const c=m.authorities.find(e=>e.path===CONTROLLER);assert.equal(c.accepted66.bytes,29459);assert.equal(c.current67.bytes,31821);assert.equal(c.accepted66.sha256,'76cc9f9899db61d59224e91601177b2bddc00103916ba9e422ff56eace0fc10d');assert.equal(c.current67.sha256,'0f62c46239a9f3ea928e19bf2c747ca627ea1121918fbb349417c95a31e547b7');
});

test('all38 actual67 current pins refuse before any retained bundle/controller read',async()=>{
 const m=await manifest(),source=readerWith();for(const e of entries(m)){const calls=[],overrides=new Map([[e.path,corrupt(await source(e.path,e.current67.bytes))]]);await assert.rejects(loadMountedSourceContinuation67({readArtifact:readerWith(overrides,calls)}),refused);assert.equal(calls.some(retained),false,e.path);}
});

test('later actual67 mutations invalidate every changed alias, historical authority read and raw inventory',async()=>{
 const m=await manifest(),overrides=new Map(),calls=[],source=readerWith(overrides,calls),outer=await loadMountedSourceContinuation67({readArtifact:source});
 const c=m.authorities.find(e=>e.path===CONTROLLER);for(const e of entries(m)){overrides.set(e.path,corrupt(await source(e.path,e.current67.bytes)));try{for(const invoke of [()=>outer.retained66SourceReader(source)(CONTROLLER,c.accepted66.bytes),()=>outer.historicalAuthorityReader(source)(CONTROLLER,1048576),()=>outer.captureRuntimeInventory('a'.repeat(40))]){calls.length=0;await assert.rejects(invoke(),refused);assert.equal(calls.some(retained),false,e.path);}}finally{overrides.delete(e.path);}}
 overrides.set(CONTROLLER,corrupt(await source(CONTROLLER,c.current67.bytes)));try{for(const path of m.changedPaths){const e=entries(m).find(e=>e.path===path);calls.length=0;await assert.rejects(outer.retained66SourceReader(source)(path,e.accepted66.bytes),refused);assert.equal(calls.some(retained),false,path);}}finally{overrides.delete(CONTROLLER);}
});

test('unchanged66 accepts only exact retained66 namespace and keeps original48/47/45 lineage',async()=>{
 const m=await manifest(),source=readerWith(),outer=await loadMountedSourceContinuation67({readArtifact:source}),alias=outer.retained66SourceReader(source),old=await loadMountedSourceContinuation66({readArtifact:alias}),receipt=await old.verifyAll();
 const c=m.authorities.find(e=>e.path===CONTROLLER),actual=await source(CONTROLLER,c.current67.bytes),accepted=await alias(CONTROLLER,c.accepted66.bytes);assert.notEqual(hash(actual),hash(accepted));assert.equal(hash(accepted),c.accepted66.sha256);assert.equal(receipt.format,'mounted-corpus-source-continuation-receipt/3');assert.equal(receipt.authorities.length,32);assert.equal(receipt.harness.length,4);assert.equal(receipt.retained48.authorities.length,32);assert.equal(receipt.retained48.retained47.authorities.length,32);
 for(const e of [...m.harness,...m.controls])assert.equal(hash(await alias(e.path,e.accepted66.bytes)),e.accepted66.sha256);
});

test('bundle and reused controller corruption remain refusals after initialization',async()=>{
 const m=await manifest(),overrides=new Map(),source=readerWith(overrides),outer=await loadMountedSourceContinuation67({readArtifact:source}),c=m.authorities.find(e=>e.path===CONTROLLER);
 for(const p of [m.bundle,c.retained66.pin,m.legacy66.manifest,m.legacy66.helper]){overrides.set(p.path,corrupt(await source(p.path,p.bytes)));try{await assert.rejects(outer.retained66SourceReader(source)(CONTROLLER,c.accepted66.bytes),refused);await assert.rejects(outer.historicalAuthorityReader(source)(CONTROLLER,1048576),refused);}finally{overrides.delete(p.path);}}
});

test('whole185 raw67 inventory is unaliased, bounded and detects later importing helper/control changes',async()=>{
 const m=await manifest(),overrides=new Map(),source=readerWith(overrides),outer=await loadMountedSourceContinuation67({readArtifact:source}),before=await outer.captureRuntimeInventory('b'.repeat(40));
 assert.equal(before.format,'mounted-corpus-source-runtime-inventory/4');assert.equal(before.sourceSHA,'b'.repeat(40));assert.deepEqual(before.budgets,{paths:192,artifactBytes:1048576,aggregateBytes:8388608});const expected=[...new Set([...outer.sourcePaths,...outer.requiredCurrentPaths])].sort();assert.equal(expected.length,185);assert.equal(new Set(expected).size,185);assert.deepEqual(before.pins.map(p=>p.path),expected);
 let total=0;for(const p of before.pins){const b=await source(p.path,1048576);assert.equal(b.byteLength,p.bytes);assert.equal(hash(b),p.sha256);total+=b.byteLength;}assert(total<=8388608);for(const e of entries(m))assert.deepEqual(before.pins.find(p=>p.path===e.path),e.current67);
 for(const p of [HELPER,CONTROL]){const pin=before.pins.find(v=>v.path===p);overrides.set(p,corrupt(await source(p,pin.bytes)));try{const after=await outer.captureRuntimeInventory('b'.repeat(40));assert.notDeepEqual(after,before);assert.notEqual(after.pins.find(v=>v.path===p).sha256,pin.sha256);}finally{overrides.delete(p);}}
});

test('aliases cannot replace original67 authority and small bounds fail before reads',async()=>{
 const m=await manifest(),rawCalls=[],source=readerWith(new Map(),rawCalls),outer=await loadMountedSourceContinuation67({readArtifact:source});for(const alias of [outer.retained66SourceReader(source),outer.historicalAuthorityReader(source)])await assert.rejects(loadMountedSourceContinuation67({readArtifact:alias}),refused);
 const calls=[],fallback=async(path,maximum)=>{calls.push({path,maximum});return new Uint8Array([3,2,1]);},a=outer.retained66SourceReader(fallback),c=m.authorities.find(e=>e.path===CONTROLLER);
 for(const path of ['observations/current.json','interactions/current.json','artifacts/sdk-native-manifest-v2.json','packages/wasm/dist/editor_wasm_bg.wasm']){assert.deepEqual(await a(path,123),new Uint8Array([3,2,1]));assert.deepEqual(calls.pop(),{path,maximum:123});}const old47=JSON.parse(Buffer.from(await source('contracts/mounted-e2e/v1.1/source-continuation47.json',32454)).toString('utf8')),historical=old47.authorities.find(e=>e.path===CONTROLLER).historical;rawCalls.length=0;await assert.rejects(a(CONTROLLER,c.accepted66.bytes-1),refused);await assert.rejects(outer.historicalAuthorityReader(fallback)(CONTROLLER,historical.bytes-1),refused);assert.deepEqual(calls,[]);assert.deepEqual(rawCalls,[],'Both inadmissible alias bounds refuse before ANY actual source read');
});

test('67 inventory source SHA remains exactly40 lowercase hex without line endings',async()=>{
 const outer=await loadMountedSourceContinuation67({readArtifact:readerWith()});for(const x of [undefined,null,67,'','a'.repeat(39),'a'.repeat(41),'g'.repeat(40),...['\n','\r','\r\n','\u2028','\u2029'].map(s=>'a'.repeat(40)+s)])await assert.rejects(outer.captureRuntimeInventory(x),refused);
});
