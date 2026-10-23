// SPDX-License-Identifier: MIT OR Apache-2.0
// Source authority only. No editor, build, native or browser observation.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { loadMountedSourceContinuation48, SOURCE_CONTINUATION48_PATH } from './source-continuation48.mjs';

export const SOURCE_CONTINUATION66_PATH = 'contracts/mounted-e2e/v1.3/source-continuation66.json';
const HELPER_PATH = 'scripts/mounted-corpus/source-continuation66.mjs';
const CONTROL_PATH = 'tests/mounted-corpus-source-continuation66.node.mjs';
// Root must review the quiet anchor, all current pins and exact deltas, then
// finalize this hard pin. Pending source must refuse BEFORE its first read.
const MANIFEST_PIN = Object.freeze({ path: SOURCE_CONTINUATION66_PATH, bytes: 30443, sha256: '159047260aa4526987de519f68306da42373c431d800f4a463e73f896aa54104' });
const ACCEPTED48 = 'bd92d9469e05a4ba1d43a71700b41fb9d1a50c8a';
const LEGACY_HELPER = 'scripts/mounted-corpus/source-continuation48.mjs';
const LEGACY_CONTROL = 'tests/mounted-corpus-source-continuation48.node.mjs';
const LEGACY_MANIFEST_PIN = Object.freeze({ path: SOURCE_CONTINUATION48_PATH, bytes: 34648,
  sha256: '87f7c7b4059b662bcee05f0e90301eb44dcff329a15cc68e22e0bc335ac02ca7' });
const LEGACY_HELPER_PIN = Object.freeze({ path: LEGACY_HELPER, bytes: 14095,
  sha256: 'dd3f5cff02db9abcd22bbcdf4fe67dfc89e0d33d2eaec972ba98d97a2c7bce9b' });
const LEGACY_CONTROL_PIN = Object.freeze({ path: LEGACY_CONTROL, bytes: 10159,
  sha256: 'b6786abbdbb0b40109c5dba43c1d8a9b3cb3f605c04e6b599d504ea1442c0396' });
const HARNESS_PATHS = Object.freeze(['scripts/mounted-corpus/run.mjs',
  'tests/mounted-corpus-source-continuation.node.mjs', 'tests/mounted-corpus-collector.node.mjs',
  'tests/mounted-corpus-interactions.node.mjs']);
const AUTHORITY_CHANGES = Object.freeze(['packages/dom/src/selection.ts']);
const CHANGED_PATHS = Object.freeze([...AUTHORITY_CHANGES, ...HARNESS_PATHS, LEGACY_CONTROL].sort());
// Identical to the accepted48 budgets; the new union must fit without widening.
const BUDGETS = Object.freeze({ manifestBytes: 262144, sourceBytes: 262144, deltaBytes: 65536,
  retainedBytes: 2097152, runtimePaths: 192, runtimeArtifactBytes: 1048576, runtimeAggregateBytes: 8388608 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const freeze = value => { if (value && typeof value === 'object') { for (const v of Object.values(value)) freeze(v); Object.freeze(value); } return value; };
function requireData(condition, code, message) {
  if (condition) return;
  const error = new Error(`mounted-corpus.source_continuation66.${code}: ${message}`);
  error.code = `mounted-corpus.source_continuation66.${code}`; throw error;
}
function equal(actual, expected, code, message) { requireData(isDeepStrictEqual(actual, expected), code, message); }
function closed(value, keys, label) { requireData(value !== null && typeof value === 'object' && !Array.isArray(value)
  && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort()), 'shape', label); }
function path(value) { requireData(typeof value === 'string' && value.length > 0 && value.length <= 4096
  && !value.startsWith('/') && !value.includes('\\') && !value.includes('\0')
  && !value.split('/').some(p => !p || p === '.' || p === '..'), 'path', 'Canonical repository path'); return value; }
const hex = (value, length) => typeof value === 'string' && value.length === length && /^[0-9a-f]+$/.test(value);
function pin(value, maximum) { closed(value, ['path', 'bytes', 'sha256'], 'Closed artifact pin'); path(value.path);
  requireData(Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= maximum && hex(value.sha256, 64), 'pin_shape', value.path); }
function callerBound(maximum, minimum) { requireData(Number.isSafeInteger(maximum) && maximum >= minimum
  && maximum <= 268435456, 'read_bound', 'Finite caller bound contains exact retained source'); }

/** The original reader remains private authority for every actual66 guard and
 * runtime inventory. An alias reader can never replace that original reader. */
export async function loadMountedSourceContinuation66({ readArtifact }) {
  requireData(typeof readArtifact === 'function', 'reader', 'Original bounded actual66 source reader');
  requireData(MANIFEST_PIN.bytes > 0 && hex(MANIFEST_PIN.sha256, 64), 'not_finalized', 'Quiet production anchor and manifest await root finalization');
  pin(MANIFEST_PIN, BUDGETS.manifestBytes);
  async function readExact(expected, code) {
    const bytes = await readArtifact(expected.path, expected.bytes);
    requireData(bytes instanceof Uint8Array && bytes.byteLength === expected.bytes && hash(bytes) === expected.sha256, code, expected.path);
    return Uint8Array.from(bytes);
  }
  const manifestBytes = await readExact(MANIFEST_PIN, 'manifest_pin');
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
  closed(manifest, ['format','status','id','license','accepted48Commit','currentProductionAnchor',
    'legacy48','authorities','harness','authorityChangedPaths','changedPaths','changes','budgets','qualification'], 'Closed66 continuation');
  equal([manifest.format,manifest.status,manifest.id,manifest.license,manifest.accepted48Commit],
    ['mounted-corpus-source-continuation/3','FINALIZED_SOURCE_CONTRACT','OSR-66','MIT OR Apache-2.0',ACCEPTED48], 'manifest', 'Finalized source-only66 layer');
  requireData(hex(manifest.currentProductionAnchor,40), 'anchor', 'Reviewed quiet source anchor, not a runtime result');
  equal(manifest.budgets,BUDGETS,'budgets','Inherited bounds cannot widen');
  requireData(typeof manifest.qualification === 'string' && manifest.qualification.length > 0 && manifest.qualification.length <= 4096, 'qualification', 'Bounded source-only qualification');
  closed(manifest.legacy48,['manifest','helper','control'],'Closed accepted48 layer');
  equal(manifest.legacy48.manifest,LEGACY_MANIFEST_PIN,'legacy_manifest','Original48 manifest unchanged');
  equal(manifest.legacy48.helper,LEGACY_HELPER_PIN,'legacy_helper','Original48 helper unchanged');
  const legacyBytes = await readExact(LEGACY_MANIFEST_PIN,'legacy_manifest');
  const legacy = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(legacyBytes));
  await readExact(LEGACY_HELPER_PIN,'legacy_helper');
  const legacy47Bytes = await readExact(legacy.legacy47.manifest,'legacy47_manifest');
  const legacy47 = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(legacy47Bytes));
  requireData(Array.isArray(manifest.authorities) && manifest.authorities.length === 32
    && legacy.authorities.length === 32 && legacy47.authorities.length === 32, 'authority_membership','All32 authority paths');
  equal(manifest.authorities.map(a=>a.path),legacy.authorities.map(a=>a.path),'authority_membership','No addition, omission, duplicate or reordering');
  equal(legacy.authorities.map(a=>a.path),legacy47.authorities.map(a=>a.path),'authority_membership','Original47 membership preserved');
  requireData(Array.isArray(manifest.harness) && manifest.harness.length === 4,'harness','Exact4 inherited harness paths');
  equal(manifest.harness.map(a=>a.path),HARNESS_PATHS,'harness','Exact inherited reader consumers');
  equal(legacy.harness.map(a=>a.path),HARNESS_PATHS,'harness','Original48 harness membership');
  const entries = [...manifest.authorities,...manifest.harness,manifest.legacy48.control], current = new Map(); let retainedTotal = 0;
  for(const entry of entries) {
    closed(entry,['path','accepted48','retained48','current66'],'Closed66 lineage');path(entry.path);
    requireData(!current.has(entry.path),'authority_membership','Unique actual source path');
    for(const key of ['accepted48','retained48','current66'])pin(entry[key],BUDGETS.sourceBytes);
    equal(entry.accepted48.path,entry.path,'source_path','Accepted48 path');equal(entry.current66.path,entry.path,'source_path','Actual66 path');
    equal(entry.retained48,{...entry.accepted48,path:`contracts/mounted-e2e/v1.3/source-authority/accepted48/${entry.path}`},'retained_path','Exact retained48 copy path');
    const inherited=[...legacy.authorities,...legacy.harness].find(a=>a.path===entry.path);
    if(inherited)equal(entry.accepted48,inherited.current48,'accepted48_pin','Original48 current pin never repinned');
    current.set(entry.path,entry);retainedTotal+=entry.retained48.bytes;
  }
  equal(manifest.legacy48.control.path,LEGACY_CONTROL,'legacy_control','Original48 control is separate from4 inherited harness paths');
  equal(manifest.legacy48.control.accepted48,LEGACY_CONTROL_PIN,'legacy_control','Accepted48 control source never silently repinned');
  requireData(retainedTotal<=BUDGETS.retainedBytes,'retained_budget','Exact finite retained48 copies');
  const authorityChanged=manifest.authorities.filter(e=>!isDeepStrictEqual(e.accepted48,e.current66)).map(e=>e.path).sort();
  equal(manifest.authorityChangedPaths,AUTHORITY_CHANGES,'authority_changes','Exactly selection authority delta');
  equal(authorityChanged,AUTHORITY_CHANGES,'authority_changes','No other authority is silently rebased');
  const changed=[...current.values()].filter(e=>!isDeepStrictEqual(e.accepted48,e.current66)).map(e=>e.path).sort();
  equal(manifest.changedPaths,CHANGED_PATHS,'change_membership','Exactly six reviewed authority/reader changes');
  equal(changed,CHANGED_PATHS,'change_membership','Every and only changed source path');
  requireData(Array.isArray(manifest.changes)&&manifest.changes.length===6,'changes','Exactly6 reviewed deltas');
  equal(manifest.changes.map(c=>c.path),CHANGED_PATHS,'changes','Canonical exact delta membership');
  const changes=new Map();
  for(const [index,change]of manifest.changes.entries()){
    closed(change,['path','reason','delta'],'Closed reviewed66 delta');requireData(typeof change.reason==='string'&&change.reason.length>0&&change.reason.length<=4096,'reason',change.path);pin(change.delta,BUDGETS.deltaBytes);
    equal(change.delta.path,`contracts/mounted-e2e/v1.3/source-deltas/osr66/${String(index+1).padStart(2,'0')}.patch`,'delta_path','Fixed reviewed66 delta path');changes.set(change.path,change.delta);
  }
  freeze(manifest);let inner48;
  async function guards(){
    await readExact(MANIFEST_PIN,'manifest_pin');await readExact(LEGACY_MANIFEST_PIN,'legacy_manifest');await readExact(LEGACY_HELPER_PIN,'legacy_helper');
    await readExact(legacy.legacy47.manifest,'legacy47_manifest');await readExact(legacy.legacy47.helper,'legacy47_helper');
  }
  async function verifyOuter(){
    await guards();
    // ALL37 actual source pins first, before ANY retained48 read/old48 alias.
    // This runs again on every alias invocation, never just at initialization.
    for(const entry of current.values())await readExact(entry.current66,'current66_pin');
    for(const entry of current.values())await readExact(entry.retained48,'retained48_pin');
    for(const delta of changes.values())await readExact(delta,'delta_pin');
  }
  function retained48SourceReader(fallback){
    requireData(typeof fallback==='function','reader','Original artifact fallback');
    return async(artifactPath,maximum)=>{
      const entry=current.get(artifactPath);if(!entry)return fallback(artifactPath,maximum);
      callerBound(maximum,entry.accepted48.bytes);await verifyOuter();return readExact(entry.retained48,'retained48_pin');
    };
  }
  async function verifyAll(){
    await verifyOuter();const inherited=inner48?await inner48.verifyAll():null;
    return freeze({format:'mounted-corpus-source-continuation-receipt/3',accepted48Commit:ACCEPTED48,currentProductionAnchor:manifest.currentProductionAnchor,
      scope:'Actual66 guards first; exact retained48 namespace enters unchanged48/47 helpers. Historical source authority only, never inherited runtime/semantic acceptance.',
      continuation:clone(MANIFEST_PIN),authorityChangedPaths:[...AUTHORITY_CHANGES],changedPaths:[...CHANGED_PATHS],authorities:clone(manifest.authorities),harness:clone(manifest.harness),legacy48Control:clone(manifest.legacy48.control),retained48:inherited});
  }
  // Full actual66 checks precede the first invocation of unchanged48.
  await verifyOuter();inner48=await loadMountedSourceContinuation48({readArtifact:retained48SourceReader(readArtifact)});
  const authorityPaths=new Set(manifest.authorities.map(a=>a.path));
  const historicalPins=new Map(legacy47.authorities.map(a=>[a.path,a.historical]));
  const historical48=inner48.historicalAuthorityReader(readArtifact);
  function historicalAuthorityReader(fallback){
    requireData(typeof fallback==='function','reader','Unaliased run/build/observation fallback');
    return async(artifactPath,maximum)=>{
      if(!authorityPaths.has(artifactPath))return fallback(artifactPath,maximum);
      callerBound(maximum,historicalPins.get(artifactPath).bytes);await verifyOuter();return historical48(artifactPath,maximum);
    };
  }
  const sourcePaths=freeze([...new Set([SOURCE_CONTINUATION66_PATH,HELPER_PATH,CONTROL_PATH,...inner48.sourcePaths,
    ...[...current.values()].map(e=>e.retained48.path),...[...changes.values()].map(p=>p.path)])].sort());
  const requiredCurrentPaths=freeze([...current.keys()].sort());
  const runtimePaths=[...new Set([...sourcePaths,...requiredCurrentPaths])].sort();
  requireData(runtimePaths.length<=BUDGETS.runtimePaths,'runtime_inventory_bound','Full66 union fits unchanged path ceiling');
  const known=new Map([MANIFEST_PIN,LEGACY_MANIFEST_PIN,LEGACY_HELPER_PIN,legacy.legacy47.manifest,legacy.legacy47.helper,
    ...legacy47.frozenContracts,...legacy47.authorities.map(a=>a.retained),...legacy47.changes.map(c=>c.delta),
    ...[...legacy.authorities,...legacy.harness].map(a=>a.retained47),...legacy.changes.map(c=>c.delta),
    ...[...current.values()].flatMap(e=>[e.current66,e.retained48]),...changes.values()].map(p=>[p.path,p]));
  async function captureRuntimeInventory(sourceSHA){
    requireData(hex(sourceSHA,40),'runtime_source','Exact actual runtime source SHA');await verifyAll();const pins=[];let aggregate=0;
    for(const artifactPath of runtimePaths){
      const expected=known.get(artifactPath);let bytes;
      if(expected)bytes=await readExact(expected,'runtime_pin');
      else{
        requireData([HELPER_PATH,CONTROL_PATH].includes(artifactPath),'runtime_path','Only new importing helper/control lack recursive inner hash');
        // Never call inner48.captureRuntimeInventory or an alias reader here.
        bytes=await readArtifact(artifactPath,BUDGETS.runtimeArtifactBytes);
        requireData(bytes instanceof Uint8Array&&bytes.byteLength>0&&bytes.byteLength<=BUDGETS.runtimeArtifactBytes,'runtime_pin','Actual bounded unaliased helper/control');
      }
      aggregate+=bytes.byteLength;requireData(aggregate<=BUDGETS.runtimeAggregateBytes,'runtime_inventory_bound','Unchanged aggregate byte ceiling');pins.push({path:artifactPath,bytes:bytes.byteLength,sha256:hash(bytes)});
    }
    return freeze({format:'mounted-corpus-source-runtime-inventory/3',sourceSHA,currentProductionAnchor:manifest.currentProductionAnchor,accepted48Commit:ACCEPTED48,
      scope:'Original unaliased actual66 reader only: current32+4+legacy48control, all retained45/47/48 copies, unchanged legacy helpers/manifests and reviewed deltas. Source inventory, no semantic acceptance.',
      budgets:{paths:BUDGETS.runtimePaths,artifactBytes:BUDGETS.runtimeArtifactBytes,aggregateBytes:BUDGETS.runtimeAggregateBytes},pins});
  }
  await verifyAll();return Object.freeze({verifyAll,retained48SourceReader,historicalAuthorityReader,captureRuntimeInventory,sourcePaths,requiredCurrentPaths});
}
