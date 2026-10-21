// SPDX-License-Identifier: MIT OR Apache-2.0
// Pure codec/serialization controls, not native admission or platform clipboard evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {kwdjClipboardCodec} from '../packages/kwdj/dist/clipboard.js';
import {serializeClipboardHtml} from '../packages/kwdj/dist/clipboard-html.js';
import {captureClipboard} from '../packages/dom/dist/clipboard-capture.js';
const binding={profile_id:'org.klenwriter.kwdj',profile_version:'1.0.0',codec_id:'org.klenwriter.kwdj/json',wire_version:1};
const sessionContext={build_id:'test-only-no-native-build',profile:{...binding,extensions:[]},registry_digest:'0'.repeat(64),capability_digest:'1'.repeat(64)};
const policy={allow_origin_relative:true,allowed_schemes:['https']};
const codec=()=>kwdjClipboardCodec(structuredClone(policy));
const context=(kinds=['inline','blocks'],where='prose_block')=>({formatId:'org.klenwriter.kwdj/clipboard-context/1',json:JSON.stringify({mode:'prose',insertion_context:where,allowed_fragment_kinds:kinds})});
const capture=(plain,html)=>captureClipboard({types:[...(plain===null?[]:['text/plain']),...(html===null?[]:['text/html'])],items:[],files:{length:0},getData:type=>type==='text/plain'?plain:html});
const fragment=(content,extra={})=>({format_id:'org.klenwriter.kwdj/clipboard-fragment/1',source_profile:binding,mode:'prose',kind:'blocks',content,open_start:false,open_end:false,...extra});
const encoded=(c,value)=>c.encode({fragment:{formatId:c.fragmentFormat,json:JSON.stringify(value)},text:'independent plain',sessionContext});
const t=text=>({type:'text',text}),p=(...content)=>({type:'paragraph',content});
test('CCOD01 genuine selected data and explicit native context create only one untrusted insert-fragment command',async()=>{
  const c=codec(),r=await c.decode({capture:capture('a\nb',null),nativeContext:context(),sessionContext});
  assert.equal(r.status,'candidate');assert.equal(r.command.id,'org.klenwriter.kwdj/command/insert-fragment');assert.deepEqual(r.diagnostics,[]);
  const payload=JSON.parse(r.command.payload_json);assert.deepEqual(Object.keys(payload).sort(),['fragment_json','kind']);assert.equal(payload.kind,'insert_fragment');
  assert.deepEqual(JSON.parse(payload.fragment_json),fragment([t('a'),{type:'hard_break'},t('b')],{kind:'inline'}));
  assert.equal(Object.isFrozen(c),true);assert.equal(Object.isFrozen(r.command),true);
});
test('CCOD02 closed native context and allowed kinds gate decoding before a command exists',async()=>{
  const c=codec();for(const nativeContext of[context([]),context(['blocks']),{formatId:'foreign',json:context().json},
    {formatId:c.contextFormat,json:JSON.stringify({mode:'prose',insertion_context:'prose_block',allowed_fragment_kinds:['inline'],extra:'no'})},
    {formatId:c.contextFormat,json:'x'.repeat(4097)}]){
    const r=await c.decode({capture:capture('inline',null),nativeContext,sessionContext});assert.deepEqual(r,{status:'refused',diagnostics:['clipboard.invalid_context']});
  }
});
test('CCOD03 the factory owns its explicit tightening policy instead of retaining caller arrays',async()=>{
  const own={allow_origin_relative:true,allowed_schemes:['https'],allowed_origins:['https://example.test']},c=kwdjClipboardCodec(own);
  own.allow_origin_relative=false;own.allowed_schemes.length=0;own.allowed_origins[0]='https://foreign.test';
  const r=await c.decode({capture:capture(null,'<p><a href="/safe">label</a></p>'),nativeContext:context(['blocks'],'root'),sessionContext});assert.equal(r.status,'candidate');
  assert.equal(JSON.parse(JSON.parse(r.command.payload_json).fragment_json).content[0].content[0].marks[0].attrs.href,'/safe');
  assert.throws(()=>kwdjClipboardCodec({allow_origin_relative:true,allowed_schemes:['javascript']}));
});
test('CCOD04 serialization escapes text and link attributes including CR without raw source HTML or metadata',()=>{
  const value=fragment([p({type:'text',text:'<&\r"\'😀',marks:[{type:'link',attrs:{href:'/safe?q=1&b=2',title:'"<hint>\r'}}]})]);
  assert.deepEqual(encoded(codec(),value),{status:'encoded',html:'<p><a href="/safe?q=1&amp;b=2" title="&quot;&lt;hint&gt;&#13;">&lt;&amp;&#13;&quot;&#39;😀</a></p>'});
});
test('CCOD05 rich marks hardbreak links and cross-block paragraphs roundtrip as semantic candidate data',async()=>{
  const c=codec(),value=fragment([p({type:'text',text:'strong',marks:[{type:'strong'}]},{type:'hard_break'},t('e\u0301')),p({type:'text',text:'link',marks:[{type:'link',attrs:{href:'/safe',title:'title'}}]})]);
  const e=encoded(c,value);assert.equal(e.status,'encoded');
  const r=await c.decode({capture:capture('independent',e.html),nativeContext:context(['blocks'],'root'),sessionContext});assert.equal(r.status,'candidate');
  assert.deepEqual(JSON.parse(JSON.parse(r.command.payload_json).fragment_json),value);
});
test('CCOD06 unsupported canonical semantics refuse instead of flattening or emitting media/editor authority',()=>{
  for(const value of[
    fragment([{type:'code_block',content:[t('code')]}]),fragment([{type:'media_image',attrs:{media_asset_id:'00000000-0000-4000-8000-000000000001',align:'center'}}]),
    fragment([{type:'verse',content:[{type:'verse_line',content:[t('line')]}]}],{mode:'poetry'}),
    fragment([{type:'paragraph',attrs:{align:'right'},content:[t('aligned')]}]),
    fragment([p({type:'text',text:'token',marks:[{type:'text_color',attrs:{token:'accent'}}]})]),
    fragment([p({type:'text',text:'reference',marks:[{type:'reference_link',attrs:{reference_entity_id:'00000000-0000-4000-8000-000000000001'}}]})]),
  ])assert.deepEqual(encoded(codec(),value),{status:'refused'});
});
test('CCOD07 encoder checks profile envelope grammar and URL safety without assuming a native fragment is trusted',()=>{
  for(const value of[
    fragment([p(t('x'))],{source_profile:{...binding,profile_id:'foreign'}}),fragment([p(t('x'))],{extra:'metadata'}),
    fragment([p(t('x'))],{kind:'inline',open_start:true}),fragment([{type:'text',text:'wrong root'}]),
    fragment([p({type:'text',text:'x',marks:[{type:'link',attrs:{href:'javascript:alert(1)'}}]})]),
    fragment([p({type:'text',text:'\u0000'})]),fragment([p(t('poetry-invalid'))],{mode:'poetry'}),fragment([{type:'table',content:[]}]),fragment([p({type:'text',text:'\ud800'})]),
  ])assert.equal(serializeClipboardHtml(JSON.stringify(value),binding,policy),null);
  const c=codec();assert.deepEqual(c.encode({fragment:{formatId:'foreign',json:JSON.stringify(fragment([p(t('x'))]))},text:'x',sessionContext}),{status:'refused'});
  assert.equal(serializeClipboardHtml('['.repeat(100)+'0'+']'.repeat(100),binding,policy),null);
});
test('CCOD08 declared media internal unsupported capture and wrong session never turn into a candidate',async()=>{
  const c=codec(),internal=captureClipboard({types:['text/plain','application/vnd.klenwriter.editor.fragment+json'],items:[],files:{length:0},getData(){throw Error('must not read');}});
  assert.deepEqual(await c.decode({capture:internal,nativeContext:context(),sessionContext}),{status:'refused',diagnostics:['clipboard.unsupported_semantics']});
  const media=captureClipboard({types:['text/plain','Files'],items:[],files:{length:1},getData(){return'x';}});
  assert.deepEqual(await c.decode({capture:media,nativeContext:context(),sessionContext}),{status:'refused',diagnostics:['clipboard.media_item_forbidden']});
  assert.deepEqual(await c.decode({capture:capture('x',null),nativeContext:context(),sessionContext:{...sessionContext,profile:{...binding,profile_id:'foreign'}}}),{status:'refused',diagnostics:['clipboard.invalid_context']});
});
test('CCOD09 open heading edges refuse instead of becoming closed blocks while a closed heading stays rich',()=>{
  const heading={type:'heading',attrs:{level:2},content:[t('X')]};
  for(const edges of[{open_start:true},{open_end:true},{open_start:true,open_end:true}])
    assert.deepEqual(encoded(codec(),fragment([heading],edges)),{status:'refused'});
  assert.deepEqual(encoded(codec(),fragment([heading])),{status:'encoded',html:'<h2>X</h2>'});
});
