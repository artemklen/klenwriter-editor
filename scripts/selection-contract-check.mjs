// SPDX-License-Identifier: MIT OR Apache-2.0
// Immutable data/provenance check, not a production selection implementation.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
const root=process.cwd(), directory='contracts/selection/v1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const manifest=json(`${directory}/manifest.json`), pins=[];
function verify(path,expected) {
  const absolute=resolve(root,path);assert(!relative(root,absolute).startsWith('..'),'Contract pin escapes repository');
  const bytes=readFileSync(absolute), actual={path,bytes:bytes.length,sha256:hash(bytes)};
  assert.equal(actual.bytes,expected.bytes,`Frozen bytes ${path}`);assert.equal(actual.sha256,expected.sha256,`Frozen hash ${path}`);pins.push(actual);
}
assert.equal(manifest.status,'FROZEN_BEFORE_IMPLEMENTATION');
for(const file of manifest.files)verify(`${directory}/${file.path}`,file);
for(const file of manifest.externalAssets)verify(file.path,file);
// v39 remains a historical contract, including its original declaration bytes.
const old=json('contracts/dom/v1/manifest.json');
for(const file of old.files)verify(`contracts/dom/v1/${file.path}`,file);
verify(`${directory}/legacy/dom-types.v39.ts`,old.publicTypes);
const errata=['001-empty-unicode-input','002-mixed-mark-typing-group'].map(name=>{
  const path=`contracts/selection/errata/${name}.json`,bytes=readFileSync(path),decision=json(path);
  assert.equal(decision.format,'selection-input-erratum/1');assert.equal(decision.status,'AUTHORING_CORRECTION_NOT_ACCEPTANCE');
  for(const pin of [...decision.pins,...(decision.unchangedNativeAuthority??[])])verify(pin.path,pin);
  return {path,bytes:bytes.length,sha256:hash(bytes),erratum:decision.erratum};
});
const data=Object.fromEntries(['bookmark','native','formatting','clipboard','unicode','scroll'].map(name=>[name,json(`${directory}/${name}-oracles.json`)]));
const counts={bookmark:data.bookmark.cases.length,native:data.native.cases.length,formatting:data.formatting.cases.length,clipboard:data.clipboard.cases.length,unicode:data.unicode.cases.length,scroll:data.scroll.controlledCoreCases.length};
assert.deepEqual(counts,{bookmark:59,native:24,formatting:2,clipboard:28,unicode:8,scroll:12});
for(const name of ['bookmark','native','formatting','clipboard','unicode'])assert.equal(new Set(data[name].cases.map(c=>c.id)).size,data[name].cases.length,`Duplicate ${name} literal ID`);
for(const item of data.native.cases){assert.deepEqual(JSON.parse(item.input.canonical_json),item.input.document,item.id);assert.deepEqual(JSON.parse(item.after.canonical_json),item.after.document,item.id);for(const direction of ['undo','redo'])if(item.history?.[direction]?.canonical_json)assert.deepEqual(JSON.parse(item.history[direction].canonical_json),item.history[direction].document,`${item.id} ${direction}`);}
assert.deepEqual(JSON.parse(data.formatting.canonical.F1),data.formatting.inputs.F1);
assert.deepEqual(data.unicode.cases.find(c=>c.id==='U-EMPTY').input.content,[{type:'paragraph'}],'Preserve malformed original data; negative control, erratum001');
assert.deepEqual(data.bookmark.documents.empty.wire.content,[{type:'paragraph',content:[]}],'Positive empty input predates runtime');
const history=json('contracts/history/v1/vectors.json');
assert.deepEqual(history.documents.empty,data.bookmark.documents.empty.wire);
assert.equal(history.cases.find(c=>c.id==='H05').steps[1][5],'StateOnly');
assert.match(history.policies.history_request_guard,/alreadysealed boundary preserve H/);
for(const item of data.unicode.cases){assert.equal(item.text.length,item.utf16Length,item.id);for(const offset of item.scalarBoundaries){assert(Number.isSafeInteger(offset)&&offset>=0&&offset<=item.text.length);if(offset>0&&offset<item.text.length)assert(!(item.text.charCodeAt(offset-1)>=0xd800&&item.text.charCodeAt(offset-1)<=0xdbff&&item.text.charCodeAt(offset)>=0xdc00&&item.text.charCodeAt(offset)<=0xdfff));}}
const scroll=data.scroll;assert.equal(scroll.fixture.modelDocument.content.length,57);assert.equal(scroll.fixture.scrollHeightCssPx,1596);assert.equal(scroll.fixture.scrollTopMaximum,1356);assert.equal(scroll.rowGeometry.length,64);
assert.deepEqual(JSON.parse(scroll.fixture.independentlySerializedExpectedCanonical),scroll.fixture.modelDocument);
for(const row of scroll.rowGeometry){assert.equal(row.contentY[0],20+24*row.ordinal);assert.equal(row.contentY[1]-row.contentY[0],24);}
const report={format:'selection-frozen-data-check/1',status:'passed',runtimeExecuted:false,scope:'Immutable literal hashes/data consistency and explicit authoring errata only; not native/WASM/DOM conformance or formal review',counts,errata,pins,manifest:{path:`${directory}/manifest.json`,sha256:hash(readFileSync(`${directory}/manifest.json`))}};
mkdirSync('artifacts/selection',{recursive:true});writeFileSync('artifacts/selection/contract-check.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,counts,pins:pins.length,runtimeExecuted:false}));
