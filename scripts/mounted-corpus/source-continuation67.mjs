// SPDX-License-Identifier: MIT OR Apache-2.0
// Prospective source authority only. No product/native/browser observation.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { loadMountedSourceContinuation66, SOURCE_CONTINUATION66_PATH } from './source-continuation66.mjs';

export const SOURCE_CONTINUATION67_PATH = 'contracts/mounted-e2e/v1.4/source-continuation67.json';
const HELPER = 'scripts/mounted-corpus/source-continuation67.mjs';
const CONTROL = 'tests/mounted-corpus-source-continuation67.node.mjs';
const BUNDLE = 'contracts/mounted-e2e/v1.4/accepted66-bundle.json';
const MANIFEST_PIN = Object.freeze({path:SOURCE_CONTINUATION67_PATH,bytes:21439,sha256:'33480751aa712c0d576d3db304d0e4064e47164dfe4dee95134d9047be161366'});
const ACCEPTED66 = '369f58c2125c902be1308df451afa88482a4f9b3';
const LEGACY_HELPER = 'scripts/mounted-corpus/source-continuation66.mjs';
const LEGACY_CONTROL = 'tests/mounted-corpus-source-continuation66.node.mjs';
const LEGACY_MANIFEST_PIN = Object.freeze({"path":"contracts/mounted-e2e/v1.3/source-continuation66.json","bytes":30443,"sha256":"159047260aa4526987de519f68306da42373c431d800f4a463e73f896aa54104"});
const LEGACY_HELPER_PIN = Object.freeze({"path":"scripts/mounted-corpus/source-continuation66.mjs","bytes":15716,"sha256":"c164da4b46c5750e1a83f03b316a4df2adbdcdb775bcb17b1fdea871b788c74b"});
const LEGACY_CONTROL_PIN = Object.freeze({"path":"tests/mounted-corpus-source-continuation66.node.mjs","bytes":12510,"sha256":"80494e72db2aa75b75536d58dca399a7d7bd885d69db75c67a4511a0f97e0a26"});
const HARNESS = Object.freeze(['scripts/mounted-corpus/run.mjs','tests/mounted-corpus-source-continuation.node.mjs',
  'tests/mounted-corpus-collector.node.mjs','tests/mounted-corpus-interactions.node.mjs']);
const LEGACY_CONTROLS = Object.freeze(['tests/mounted-corpus-source-continuation48.node.mjs',LEGACY_CONTROL]);
const CHANGED = Object.freeze(['packages/sdk/src/controller.ts',...HARNESS,...LEGACY_CONTROLS].sort());
const BUDGETS = Object.freeze({manifestBytes:262144,sourceBytes:262144,deltaBytes:65536,retainedBytes:2097152,
  runtimePaths:192,runtimeArtifactBytes:1048576,runtimeAggregateBytes:8388608});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const copy=value=>JSON.parse(JSON.stringify(value));
const freeze=value=>{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;};
const hex=(v,n)=>typeof v==='string'&&v.length===n&&/^[0-9a-f]+$/.test(v);
function need(ok,code,message){if(ok)return;const e=new Error(`mounted-corpus.source_continuation67.${code}: ${message}`);e.code=`mounted-corpus.source_continuation67.${code}`;throw e;}
function equal(a,b,code,message){need(isDeepStrictEqual(a,b),code,message);}
function closed(v,keys,label){need(v!==null&&typeof v==='object'&&!Array.isArray(v)&&isDeepStrictEqual(Object.keys(v).sort(),[...keys].sort()),'shape',label);}
function path(v){need(typeof v==='string'&&v.length>0&&v.length<=4096&&!v.startsWith('/')&&!v.includes('\\')&&!v.includes('\0')&&!v.split('/').some(p=>!p||p==='.'||p==='..'),'path','Canonical repository path');}
function pin(v,max){closed(v,['path','bytes','sha256'],'Closed pin');path(v.path);need(Number.isSafeInteger(v.bytes)&&v.bytes>0&&v.bytes<=max&&hex(v.sha256,64),'pin_shape',v.path);}
function bound(max,min){need(Number.isSafeInteger(max)&&max>=min&&max<=268435456,'read_bound','Finite caller bound contains exact accepted source');}

/** Only seven changed paths substitute accepted66 bytes. Unchanged files go
 * to the raw fallback. Every actual substitution verifies all38 current pins
 * afresh; no retained text or whole-verification result is cached across calls. */
export async function loadMountedSourceContinuation67({readArtifact}){
  need(typeof readArtifact==='function','reader','Original bounded actual67 source reader');pin(MANIFEST_PIN,BUDGETS.manifestBytes);
  async function exact(expected,code){const b=await readArtifact(expected.path,expected.bytes);need(b instanceof Uint8Array&&b.byteLength===expected.bytes&&hash(b)===expected.sha256,code,expected.path);return Uint8Array.from(b);}
  const decode=b=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
  const manifest=decode(await exact(MANIFEST_PIN,'manifest_pin'));
  closed(manifest,['format','status','id','license','accepted66Commit','currentProductionAnchor','legacy66','authorities','harness','controls','changedPaths','bundle','budgets','qualification'],'Closed67 continuation');
  equal([manifest.format,manifest.status,manifest.id,manifest.license,manifest.accepted66Commit],['mounted-corpus-source-continuation/4','FINALIZED_SOURCE_CONTRACT','OSR-67','MIT OR Apache-2.0',ACCEPTED66],'manifest','Prospective source-only67 layer');
  need(hex(manifest.currentProductionAnchor,40),'anchor','Quiet source anchor, not runtime acceptance');equal(manifest.budgets,BUDGETS,'budgets','Inherited ceilings unchanged');
  need(typeof manifest.qualification==='string'&&manifest.qualification.length>0&&manifest.qualification.length<=4096,'qualification','Bounded source-only scope');
  closed(manifest.legacy66,['manifest','helper'],'Closed unchanged66 layer');equal(manifest.legacy66.manifest,LEGACY_MANIFEST_PIN,'legacy_manifest','Original66 manifest unchanged');equal(manifest.legacy66.helper,LEGACY_HELPER_PIN,'legacy_helper','Original66 helper unchanged');
  const old66=decode(await exact(LEGACY_MANIFEST_PIN,'legacy_manifest'));await exact(LEGACY_HELPER_PIN,'legacy_helper');
  const old48=decode(await exact(old66.legacy48.manifest,'legacy48_manifest'));
  const old47=decode(await exact(old48.legacy47.manifest,'legacy47_manifest'));
  need(Array.isArray(manifest.authorities)&&manifest.authorities.length===32,'authority_membership','All32 old authority paths');equal(manifest.authorities.map(e=>e.path),old66.authorities.map(e=>e.path),'authority_membership','No authority addition/omission/reordering');
  need(Array.isArray(manifest.harness)&&manifest.harness.length===4,'harness','Four inherited harness consumers');equal(manifest.harness.map(e=>e.path),HARNESS,'harness','Exact inherited harness paths');
  need(Array.isArray(manifest.controls)&&manifest.controls.length===2,'controls','Two inherited controls');equal(manifest.controls.map(e=>e.path),LEGACY_CONTROLS,'controls','Exact48/66 controls');
  pin(manifest.bundle,BUDGETS.sourceBytes);equal(manifest.bundle.path,BUNDLE,'bundle_path','Single bounded lossless source/delta bundle');
  const entries=[...manifest.authorities,...manifest.harness,...manifest.controls],current=new Map();
  for(const e of entries){closed(e,['path','accepted66','current67','retained66'],'Closed67 lineage');path(e.path);need(!current.has(e.path),'membership','Unique current path');for(const k of ['accepted66','current67']){pin(e[k],BUDGETS.sourceBytes);equal(e[k].path,e.path,'source_path','Original/current source path');}
    const inherited=[...old66.authorities,...old66.harness,old66.legacy48.control].find(a=>a.path===e.path);
    equal(e.accepted66,inherited?.current66??LEGACY_CONTROL_PIN,'accepted66_pin','Accepted66 bytes never repinned');current.set(e.path,e);
  }
  equal([...current.values()].filter(e=>!isDeepStrictEqual(e.accepted66,e.current67)).map(e=>e.path).sort(),CHANGED,'changes','Every and only seven named changes');equal(manifest.changedPaths,CHANGED,'changes','Frozen changed membership');
  equal(manifest.authorities.filter(e=>!isDeepStrictEqual(e.accepted66,e.current67)).map(e=>e.path),['packages/sdk/src/controller.ts'],'authority_changes','Only controller changes authoritative source');
  const changed=new Map([...current].filter(([p])=>CHANGED.includes(p))),consumerPaths=[...HARNESS,...LEGACY_CONTROLS].sort();
  for(const e of current.values()){
    if(!changed.has(e.path))equal(e.retained66,{kind:'same'},'retained','Unchanged source remains raw passthrough');
    else if(e.path==='packages/sdk/src/controller.ts'){closed(e.retained66,['kind','pin'],'Reused accepted controller');equal(e.retained66.kind,'artifact','retained','Controller retained in accepted48 tree');equal(e.retained66.pin,{...e.accepted66,path:old66.authorities.find(a=>a.path===e.path).retained48.path},'retained','Existing byte-identical controller reuse');}
    else equal(e.retained66,{kind:'bundle',index:consumerPaths.indexOf(e.path)},'retained','Canonical complete consumer text in one bundle');
  }
  freeze(manifest);let inner66;
  async function guards(){await exact(MANIFEST_PIN,'manifest_pin');await exact(LEGACY_MANIFEST_PIN,'legacy_manifest');await exact(LEGACY_HELPER_PIN,'legacy_helper');await exact(old66.legacy48.manifest,'legacy48_manifest');await exact(old66.legacy48.helper,'legacy48_helper');await exact(old48.legacy47.manifest,'legacy47_manifest');await exact(old48.legacy47.helper,'legacy47_helper');}
  async function verifyOuter(){
    await guards();
    // ALL38 raw current pins precede ANY retained controller/bundle payload.
    for(const e of current.values())await exact(e.current67,'current67_pin');
    const bundle=decode(await exact(manifest.bundle,'bundle_pin'));closed(bundle,['format','license','accepted66Commit','retained','changes'],'Closed lossless bundle');equal([bundle.format,bundle.license,bundle.accepted66Commit],['mounted-corpus-accepted-source-bundle/1','MIT OR Apache-2.0',ACCEPTED66],'bundle','Accepted66 source-only namespace');
    need(Array.isArray(bundle.retained)&&bundle.retained.length===6&&Array.isArray(bundle.changes)&&bundle.changes.length===7,'bundle','Six complete sources and seven exact reviewed deltas');equal(bundle.retained.map(e=>e.path),consumerPaths,'bundle','Canonical consumer membership');equal(bundle.changes.map(e=>e.path),CHANGED,'bundle','Canonical delta membership');
    let retainedBytes=0;
    for(const r of bundle.retained){closed(r,['path','bytes','sha256','utf8'],'Closed complete retained text');const e=current.get(r.path);const bytes=new TextEncoder().encode(r.utf8);need(typeof r.utf8==='string'&&bytes.byteLength===r.bytes&&hash(bytes)===r.sha256,'retained66_pin',r.path);equal({path:r.path,bytes:r.bytes,sha256:r.sha256},e.accepted66,'retained66_pin','Exact accepted66 text');retainedBytes+=bytes.byteLength;}
    const controller=current.get('packages/sdk/src/controller.ts');await exact(controller.retained66.pin,'retained66_pin');retainedBytes+=controller.accepted66.bytes;need(retainedBytes<=BUDGETS.retainedBytes,'retained_budget','Inherited retained ceiling unchanged');
    for(const d of bundle.changes){closed(d,['path','reason','before','after','patch'],'Closed reviewed delta');const e=current.get(d.path);equal(d.before,e.accepted66,'delta','Exact accepted before');equal(d.after,e.current67,'delta','Exact current after');need(typeof d.reason==='string'&&d.reason.length>0&&d.reason.length<=4096&&typeof d.patch==='string'&&new TextEncoder().encode(d.patch).byteLength>0&&new TextEncoder().encode(d.patch).byteLength<=BUDGETS.deltaBytes&&d.patch.startsWith(`--- a/${d.path}\n+++ b/${d.path}\n`),'delta','Bounded exact reviewed patch');}
    return bundle;
  }
  function retained66SourceReader(fallback){need(typeof fallback==='function','reader','Original unaliased artifact fallback');return async(p,max)=>{const e=changed.get(p);if(!e)return fallback(p,max);bound(max,e.accepted66.bytes);const bundle=await verifyOuter();return e.retained66.kind==='artifact'?exact(e.retained66.pin,'retained66_pin'):new TextEncoder().encode(bundle.retained[e.retained66.index].utf8);};}
  async function verifyAll(){await verifyOuter();const inherited=inner66?await inner66.verifyAll():null;return freeze({format:'mounted-corpus-source-continuation-receipt/4',accepted66Commit:ACCEPTED66,currentProductionAnchor:manifest.currentProductionAnchor,scope:'Fresh actual67 guards precede every changed accepted66 alias. Unchanged66/48/47/45 lineage is preserved as source authority only; no inherited semantic/runtime acceptance.',continuation:copy(MANIFEST_PIN),changedPaths:[...CHANGED],authorities:copy(manifest.authorities),harness:copy(manifest.harness),controls:copy(manifest.controls),retained66:inherited});}
  await verifyOuter();inner66=await loadMountedSourceContinuation66({readArtifact:retained66SourceReader(readArtifact)});
  const authorityPaths=new Set(manifest.authorities.map(e=>e.path)),historicalPins=new Map(old47.authorities.map(e=>[e.path,e.historical]));
  const historical66=inner66.historicalAuthorityReader(readArtifact);
  function historicalAuthorityReader(fallback){need(typeof fallback==='function','reader','Unaliased run/build fallback');return async(p,max)=>{if(!authorityPaths.has(p))return fallback(p,max);bound(max,historicalPins.get(p).bytes);await verifyOuter();return historical66(p,max);};}
  const sourcePaths=freeze([...new Set([...inner66.sourcePaths,SOURCE_CONTINUATION67_PATH,HELPER,CONTROL,BUNDLE])].sort());
  const requiredCurrentPaths=freeze([...current.keys()].sort()),runtimePaths=[...new Set([...sourcePaths,...requiredCurrentPaths])].sort();need(runtimePaths.length<=BUDGETS.runtimePaths,'runtime_inventory_bound','Full sparse67 union fits unchanged192 paths');
  const known=new Map([MANIFEST_PIN,manifest.bundle,LEGACY_MANIFEST_PIN,LEGACY_HELPER_PIN,old66.legacy48.manifest,old66.legacy48.helper,old48.legacy47.manifest,old48.legacy47.helper,...old47.frozenContracts,...old47.authorities.map(e=>e.retained),...old47.changes.map(e=>e.delta),...[...old48.authorities,...old48.harness].map(e=>e.retained47),...old48.changes.map(e=>e.delta),...[...old66.authorities,...old66.harness,old66.legacy48.control].map(e=>e.retained48),...old66.changes.map(e=>e.delta),...entries.map(e=>e.current67)].map(p=>[p.path,p]));
  async function captureRuntimeInventory(sourceSHA){need(hex(sourceSHA,40),'runtime_source','Exactly40 lowercase hex');await verifyAll();const pins=[];let aggregate=0;
    for(const p of runtimePaths){const expected=known.get(p);let bytes;if(expected)bytes=await exact(expected,'runtime_pin');else{need([HELPER,CONTROL].includes(p),'runtime_path','Only own importing helper/control lack recursive inner hash');bytes=await readArtifact(p,BUDGETS.runtimeArtifactBytes);need(bytes instanceof Uint8Array&&bytes.byteLength>0&&bytes.byteLength<=BUDGETS.runtimeArtifactBytes,'runtime_pin','Actual bounded unaliased helper/control');}aggregate+=bytes.byteLength;need(aggregate<=BUDGETS.runtimeAggregateBytes,'runtime_inventory_bound','Inherited8MiB ceiling unchanged');pins.push({path:p,bytes:bytes.byteLength,sha256:hash(bytes)});}
    return freeze({format:'mounted-corpus-source-runtime-inventory/4',sourceSHA,currentProductionAnchor:manifest.currentProductionAnchor,accepted66Commit:ACCEPTED66,scope:'Original unaliased actual67 reader only; all legacy source artifacts plus one lossless accepted66 bundle. No inner capture, historical alias or semantic acceptance.',budgets:{paths:BUDGETS.runtimePaths,artifactBytes:BUDGETS.runtimeArtifactBytes,aggregateBytes:BUDGETS.runtimeAggregateBytes},pins});}
  await verifyAll();return Object.freeze({verifyAll,retained66SourceReader,historicalAuthorityReader,captureRuntimeInventory,sourcePaths,requiredCurrentPaths});
}
