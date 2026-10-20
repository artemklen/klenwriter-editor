// SPDX-License-Identifier: MIT OR Apache-2.0
// Frozen source/data integrity only. Does not execute an editor.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative,sep} from 'node:path';

const root=process.cwd(),directory='contracts/slash/v1';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const manifest=json(`${directory}/manifest.json`),verified=[];
assert.equal(sha(readFileSync(`${directory}/manifest.json`)),'2ec9e5131dc9672aa28dc80b264858239634d46797fc26ae650fbf2757da7af2','Manifest bytes frozen at94ca3c4, never learned from runtime');
assert.equal(manifest.format,'editor-slash-contract/1');
assert.equal(manifest.status,'FROZEN_BEFORE_IMPLEMENTATION');
assert.equal(manifest.sourceRevision,'3960664b286b0939d3e7d8e724183eb9f7b71ee6');
assert.equal(manifest.sourceTree,'0f24703a5dc7f9c1fd2689a87a8cb2afaecdaadd');
assert.equal(manifest.authoredBeforeRuntime,true);
const names=new Set();
for(const pin of manifest.files){
  assert.equal(typeof pin.path,'string');assert(!names.has(pin.path));names.add(pin.path);
  const full=resolve(directory,pin.path),local=relative(resolve(directory),full);
  assert(local && local!=='..'&&!local.startsWith(`..${sep}`),'Contract member remains inside its directory');
  const stat=lstatSync(full);assert(stat.isFile()&&!stat.isSymbolicLink(),pin.path);
  const bytes=readFileSync(full),actual={path:`${directory}/${pin.path}`,bytes:bytes.length,sha256:sha(bytes),mode:stat.mode&0o777};
  for(const key of ['bytes','sha256','mode'])assert.equal(actual[key],pin[key],`Frozen ${pin.path} ${key}`);
  verified.push(actual);
}
assert.deepEqual(readdirSync(directory).sort(),[...names,'manifest.json'].sort(),'No unlisted contract member');
const native=json(`${directory}/native-source-oracles.json`),window=json(`${directory}/text-window-oracles.json`);
const lexical=json(`${directory}/lexical-key-oracles.json`),origin=json(`${directory}/input-origin-oracles.json`);
assert.equal(native.nativeCandidates.length,9);assert.equal(native.additionalNativeGoldens.length,3);
assert.equal(window.cases.length,20);assert.equal(origin.cases.length,18);
for(const rows of [native.nativeCandidates,native.additionalNativeGoldens,native.negativeSeeds,window.cases,origin.cases])
  assert.equal(new Set(rows.map(row=>row.id)).size,rows.length,'Unique authored case identities');
const ids=native.nativeCandidates.map(row=>row.candidateId);
assert.equal(new Set(ids).size,9);assert.equal(ids[0],'org.klenwriter.kwdj/slash/paragraph');
assert.deepEqual(native.nativeCandidates[5].target,{kind:'ordered_list',start:'1'});
assert.deepEqual(native.nativeCandidates[7].target,{kind:'code_block',language:null});
for(const row of [...native.nativeCandidates,...native.additionalNativeGoldens]){
  JSON.parse(row.afterCanonical);if(row.beforeCanonical)JSON.parse(row.beforeCanonical);
}
JSON.parse(native.baselineF.canonical);
for(const field of ['lexical','search','keys','provenance'])assert.equal(new Set(lexical[field].map(row=>row[0])).size,lexical[field].length);
const installedDirectory='contracts/slash/installed-v1',installedManifestBytes=readFileSync(`${installedDirectory}/manifest.json`);
assert.equal(sha(installedManifestBytes),'36aa9d4aed8f45e4e8c2188d22c6e837cb7dbd575c006e89b335f331a27fa254','Installed source freeze at c864d38 precedes its implementation');
const installedManifest=JSON.parse(installedManifestBytes),installedPins=[];
assert.equal(installedManifest.format,'editor-slash-installed-contract-freeze/1');
assert.equal(installedManifest.status,'FROZEN_BEFORE_INSTALLED_IMPLEMENTATION');
for(const pin of installedManifest.files){
  assert(/^[a-z][a-z-]*\.(?:md|json)$/.test(pin.path));
  const full=`${installedDirectory}/${pin.path}`,stat=lstatSync(full),bytes=readFileSync(full);
  assert(stat.isFile()&&!stat.isSymbolicLink());assert.equal(stat.mode&0o777,0o644);
  assert.equal(bytes.length,pin.bytes);assert.equal(sha(bytes),pin.sha256);
  installedPins.push({...pin,path:full,mode:stat.mode&0o777});
}
assert.equal(new Set(installedManifest.files.map(pin=>pin.path)).size,installedPins.length);
assert.deepEqual(readdirSync(installedDirectory).sort(),[...installedManifest.files.map(pin=>pin.path),'manifest.json'].sort());
const installed=json(`${installedDirectory}/oracles.json`);
assert.equal(installed.rows.length,20);assert.deepEqual(installed.rows.map(row=>row.id),installed.inventory.fixedRowIds);
assert.equal(new Set(installed.rows.map(row=>row.id)).size,20);
for(const row of installed.rows){assert.equal(row.id.slice(-2),row.locale);assert(installed.caseFamilies[row.family]);}
const report={format:'editor-slash-contract-check/1',status:'passed',runtimeExecuted:false,
  scope:'Frozen independent source contracts; incomplete seeds remain qualified, no native/WASM/DOM conformance or review verdict.',
  manifestSha256:sha(readFileSync(`${directory}/manifest.json`)),verified,
  installed:{manifestSha256:sha(installedManifestBytes),verified:installedPins,rowsPerBrowser:20,totalRows:40,runtimeExecuted:false},
  counts:{nativeTargets:9,additionalNativeGoldens:3,nativeNegativeSeeds:native.negativeSeeds.length,
    textWindows:20,originBranches:18,lexical:lexical.lexical.length,search:lexical.search.length,keys:lexical.keys.length}};
mkdirSync('artifacts/slash',{recursive:true});writeFileSync('artifacts/slash/contract-check.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,runtimeExecuted:false,counts:report.counts,pins:verified.length}));
