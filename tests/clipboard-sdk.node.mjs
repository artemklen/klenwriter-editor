// SPDX-License-Identifier: MIT OR Apache-2.0
// Controlled ABI transport boundary; no native clipboard or range-semantic claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditor} from '../packages/sdk/dist/index.js';
import {fakeModule,options as v1Options} from './helpers/sdk-fake.mjs';
import {fakeV2Module,v2Options} from './helpers/sdk-v2-fake.mjs';
const owned = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(owned) : Object.assign(Object.create(null),Object.fromEntries(Object.entries(value).map(([k,v])=>[k,owned(v)]))) : value;
const p={kind:'text',node:'leaf-1',offset:0,affinity:'after'};
function reply(request){return{status:'ok',value:{kind:request.kind,stamp:request.stamp,selection:{anchor:p,focus:p},format_id:'org.example/clipboard/1',...(request.kind==='clipboard_context'?{context_json:'{}'}:{fragment_json:'{}',empty:false})}};}
async function open(change=v=>v){const fixture=fakeV2Module({call(request){if(['clipboard_context','selection_fragment'].includes(request.kind))return JSON.stringify(change(reply(request)));}}),editor=createEditor({input:new Uint8Array([65]),options:v2Options(),loader:async()=>fixture.module});assert.equal((await editor.ready).status,'ok');return{fixture,editor};}
for(const kind of['clipboard_context','selection_fragment'])test('CSDK additive pure read '+kind+' keeps stamp/resources and never enters mutation queue',async()=>{
 const{editor,fixture}=await open();const before=structuredClone(editor.resources()),stamp=editor.capture(),request={kind,stamp,...(kind==='selection_fragment'?{max_bytes:1024}:{})};const r=editor.read(request);assert.deepEqual(r,owned(reply(request)));assert.equal(Object.isFrozen(r.value),true);assert.deepEqual(editor.resources(),before);assert.equal(editor.capture(),stamp);assert.deepEqual(fixture.log.map(r=>r.kind),[kind]);assert.equal(editor.submit(request).response.diagnostic.code,'sdk.invalid_request_kind');editor.destroy();assert.equal(fixture.counts().live,0);
});
test('CSDK legacy ABI refuses both additive read kinds before transport',async()=>{
 const fixture=fakeModule(),editor=createEditor({input:new Uint8Array([65]),options:v1Options(),loader:async()=>fixture.module});assert.equal((await editor.ready).status,'ok');for(const kind of['clipboard_context','selection_fragment'])assert.equal(editor.read({kind,stamp:editor.capture(),...(kind==='selection_fragment'?{max_bytes:1}:{})}).diagnostic.code,'sdk.invalid_request_kind');assert.deepEqual(fixture.log,[]);editor.destroy();
});
for(const[name,kind,change]of[
 ['extra field','clipboard_context',v=>({...v,value:{...v.value,extra:true}})],
 ['null directed selection','clipboard_context',v=>({...v,value:{...v.value,selection:null}})],
 ['wrong reply kind','clipboard_context',v=>({...v,value:{...v.value,kind:'selection_fragment',fragment_json:'{}',empty:false}})],
 ['stale selection epoch','clipboard_context',v=>({...v,value:{...v.value,stamp:{...v.value.stamp,selection_epoch:'99'}}})],
 ['over 4096 UTF8 context','clipboard_context',v=>({...v,value:{...v.value,context_json:'Я'.repeat(2049)}})],
 ['non scalar nested source','selection_fragment',v=>({...v,value:{...v.value,fragment_json:'\ud800'}})],
 ['over requested fragment bytes','selection_fragment',v=>({...v,value:{...v.value,fragment_json:'Я'.repeat(513)}})],
])test('CSDK '+name+' produces read-only fatal provenance and cleans instance',async()=>{
 const{editor,fixture}=await open(change),r=editor.read({kind,stamp:editor.capture(),...(kind==='selection_fragment'?{max_bytes:1024}:{})});assert.equal(r.status,'fatal');assert.equal(r.diagnostic.may_have_committed,false);assert.equal(editor.lifecycle,'fatal');assert.deepEqual(fixture.counts(),{live:0,destroyed:1,freed:1});editor.destroy();
});
