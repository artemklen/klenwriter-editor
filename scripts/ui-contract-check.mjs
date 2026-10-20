// SPDX-License-Identifier: MIT OR Apache-2.0
// Frozen independent data/provenance check; does not execute an editor.
import assert from 'node:assert/strict';
import { readFileSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';

const root=process.cwd(), directory='contracts/ui/v1';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const manifest=json(`${directory}/manifest.json`), verified=[];
assert.equal(manifest.status,'FROZEN_BEFORE_IMPLEMENTATION');
assert.equal(manifest.sourceRevision,'857f8cb7b27bb2b0ed36d99780fb19911dcff1cf');
function check(path,pin){
  const full=resolve(root,path);assert(!relative(root,full).startsWith('..'),'Contract path escapes root');
  const stat=lstatSync(full);assert(stat.isFile()&&!stat.isSymbolicLink(),path);
  const bytes=readFileSync(full), actual={path,bytes:bytes.length,sha256:sha(bytes),mode:stat.mode&0o777};
  for(const key of ['bytes','sha256','mode'])assert.equal(actual[key],pin[key],`Frozen ${path} ${key}`);
  verified.push(actual);
}
for(const pin of manifest.files)check(`${directory}/${pin.path}`,pin);
for(const pin of manifest.externalAssets)check(pin.path,pin);
const native=json(`${directory}/native-oracles.json`),nesting=json(`${directory}/nesting-oracles.json`);
const host=json(`${directory}/host-request-oracles.json`),keyboard=json(`${directory}/keyboard-focus-oracles.json`),geometry=json(`${directory}/geometry-fixtures.json`);
assert.equal(native.authoredBeforeRuntime,true);assert.equal(host.authoredBeforeRuntime,true);assert.equal(keyboard.authoredBeforeRuntime,true);assert.equal(geometry.authoredBeforeRuntime,true);
const counts={native:native.cases.length,nesting:nesting.cases.length,host:host.cases.length,keyboard:keyboard.cases.length,geometryFixtures:Object.keys(geometry.fixtures).length};
assert.deepEqual(counts,{native:15,nesting:7,host:34,keyboard:14,geometryFixtures:5});
for(const data of [native,nesting,host,keyboard])assert.equal(new Set(data.cases.map(row=>row.id)).size,data.cases.length,'Unique oracle IDs');
for(const row of native.cases){
  if(row.input?.canonical_json)assert.deepEqual(JSON.parse(row.input.canonical_json),row.input.document,row.id);
  if(row.expected?.canonical_json&&row.expected.document)assert.deepEqual(JSON.parse(row.expected.canonical_json),row.expected.document,row.id);
}
for(const row of nesting.cases){JSON.parse(row.input_canonical);JSON.parse(row.after_canonical);JSON.parse(row.profile_options_json);}
for(const row of Object.values(geometry.fixtures))assert.deepEqual(JSON.parse(row.canonical_json),row.document);
assert.deepEqual(native.cases.find(row=>row.id==='V02-collapsed-twice').expected.steps[1].stored_marks,[]);
assert.equal(native.cases.find(row=>row.id==='V04-down').intent.before_index,3);
assert.equal(native.cases.find(row=>row.id==='V07-text-caret').expected.created.length,3);
const report={format:'editor-ui-contract-check/1',status:'passed',runtimeExecuted:false,scope:'Frozen independent literals/source history only; not native/WASM/browser conformance or independent review',counts,verified,manifestSha256:sha(readFileSync(`${directory}/manifest.json`))};
mkdirSync('artifacts/ui',{recursive:true});writeFileSync('artifacts/ui/contract-check.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,runtimeExecuted:false,counts,pins:verified.length}));
