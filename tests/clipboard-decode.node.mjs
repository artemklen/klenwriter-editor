// SPDX-License-Identifier: MIT OR Apache-2.0
// Source-authored pure adapter expectations. No editor, native admission, browser or OS execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeClipboard,isSafeClipboardUrl,clipboardDecodeLimits} from '../packages/kwdj/dist/clipboard-decode.js';
const binding={profile_id:'org.klenwriter.kwdj',profile_version:'1.0.0',codec_id:'org.klenwriter.kwdj/json',wire_version:1};
const policy={allow_origin_relative:true,allowed_schemes:['http','https']};
const complete=text=>({status:'complete_local',text}),absent=()=>({status:'unavailable',text:null});
const input=({plain='plain',html=null,mode='prose',context='root',media='not_observed',url_policy=policy}={})=>({
  source_profile:{...binding},mode,insertion_context:context,media,
  plain:plain===null?absent():complete(plain),html:html===null?absent():complete(html),url_policy:structuredClone(url_policy),
});
const t=text=>({type:'text',text}),p=(...content)=>({type:'paragraph',content});
const assertCandidate=(r,content,diagnostics=[])=>{assert.equal(r.status,'candidate');assert.deepEqual(r.diagnostics,diagnostics);
  assert.deepEqual(r.fragment,{format_id:'org.klenwriter.kwdj/clipboard-fragment/1',source_profile:binding,mode:'prose',kind:'blocks',content,open_start:false,open_end:false});};
const fixtures=['positive','negative'].flatMap(name=>JSON.parse(readFileSync(new URL('../contracts/kwdj/v1/fixtures/'+name+'.json',import.meta.url),'utf8')).fixtures);
const corpus=fixtures.filter(f=>/^DOC-0(?:2[89]|3[0-4])$/.test(f.id));
assert.deepEqual(corpus.map(f=>f.id),['DOC-028','DOC-029','DOC-030','DOC-031','DOC-032','DOC-033','DOC-034']);
for(const fixture of corpus)test('CDEC corpus '+fixture.id+' preserves untouched conversion literals and diagnostic precedence',async()=>{
  assert.equal(fixture.cases.length,1);const c=fixture.cases[0],s=c.input;
  const r=await decodeClipboard(input({plain:s.kind==='clipboard_plain'?s.value:s.plain_fallback??null,
    html:s.kind==='clipboard_html'?s.value:null,mode:s.profile,context:s.insertion_context,
    media:s.clipboard_items.some(k=>['image','file','blob'].includes(k))?'present':'not_observed'}));
  assert.deepEqual(r.diagnostics,c.expected.diagnostic_codes);
  if(c.expected.outcome==='accepted'){
    assert.equal(r.status,'candidate');assert.deepEqual(r.fragment.content,c.kwdj.content);assert.equal(r.fragment.mode,c.kwdj.profile);
    assert.equal(r.fragment.kind,'blocks');assert.equal(r.fragment.open_start,false);assert.equal(r.fragment.open_end,false);assert.deepEqual(r.fragment.source_profile,binding);
  }else assert.equal(r.status,'refused');
});
test('CDEC08 plain CRLF and punctuation stay literal without typography NFC or Markdown interpretation',async()=>{
  const r=await decodeClipboard(input({plain:'# A\r\ne\u0301 **b**\r\n\r\n[x](y) <p>\u00a0😀'}));
  assertCandidate(r,[p(t('# A'),{type:'hard_break'},t('e\u0301 **b**')),p(t('[x](y) <p>\u00a0😀'))]);
});
test('CDEC09 actual prose context selects inline or open paragraph edges without inventing heading attrs',async()=>{
  const single=await decodeClipboard(input({plain:'a\nb',context:'prose_block'}));assert.equal(single.status,'candidate');
  assert.equal(single.fragment.kind,'inline');assert.deepEqual(single.fragment.content,[t('a'),{type:'hard_break'},t('b')]);assert.equal(single.fragment.open_start,false);assert.equal(single.fragment.open_end,false);
  const multi=await decodeClipboard(input({plain:'a\n\nb',context:'prose_block'}));assert.equal(multi.status,'candidate');assert.equal(multi.fragment.kind,'blocks');
  assert.deepEqual(multi.fragment.content,[p(t('a')),p(t('b'))]);assert.equal(multi.fragment.open_start,true);assert.equal(multi.fragment.open_end,true);
  const heading=await decodeClipboard(input({html:'<h2>Title</h2>',context:'prose_block'}));assert.equal(heading.status,'candidate');assert.equal(heading.fragment.kind,'blocks');assert.equal(heading.fragment.open_start,false);assert.equal(heading.fragment.open_end,false);
});
test('CDEC10 explicit poetry root and verse contexts preserve source stanza counts and mode',async()=>{
  const content=[{type:'verse',content:[{type:'verse_line',content:[t('a')]},{type:'stanza_break',attrs:{blank_lines:2}},{type:'verse_line',content:[t('b')]}]}];
  for(const context of['root','verse']){const r=await decodeClipboard(input({plain:'\n\na\r\n\r\n\r\nb\n\n',mode:'poetry',context}));assert.equal(r.status,'candidate');assert.equal(r.fragment.mode,'poetry');assert.deepEqual(r.fragment.content,content);assert.equal(r.fragment.open_start,false);assert.equal(r.fragment.open_end,false);}
  for(const [mode,context]of[['prose','verse'],['poetry','prose_block']])assert.deepEqual(await decodeClipboard(input({mode,context})),{status:'refused',diagnostics:['clipboard.invalid_context']});
});
test('CDEC11 fully inspected unsupported rich content can use only independent complete plain with causal diagnostics',async()=>{
  const r=await decodeClipboard(input({html:'<ruby>x<rt>annotation</rt></ruby><p onclick="bad()">x</p>',plain:'literal **x**'}));
  assertCandidate(r,[p(t('literal **x**'))],['clipboard.rich_branch_rejected','clipboard.plain_fallback_used','clipboard.unsupported_semantics']);
  const poetry=await decodeClipboard(input({html:'<p>line</p>',plain:'a\nb',mode:'poetry',context:'verse'}));assert.equal(poetry.status,'candidate');assert.equal(poetry.fragment.content[0].type,'verse');assert.deepEqual(poetry.diagnostics,['clipboard.rich_branch_rejected','clipboard.plain_fallback_used','clipboard.unsupported_semantics']);
});
test('CDEC12 incomplete or unread representation and unknown media cannot authorize plain fallback',async()=>{
  for(const format of['plain','html'])for(const status of['oversize_not_retained','unread_due_limit','read_failed']){
    const value=input({html:'<ruby>x</ruby>'});value[format]={status,text:null};assert.deepEqual(await decodeClipboard(value),{status:'refused',diagnostics:['clipboard.invalid_input']});
  }
  assert.deepEqual(await decodeClipboard(input({media:'unknown',html:'<p>rich</p>'})),{status:'refused',diagnostics:['clipboard.invalid_input']});
  assert.deepEqual(await decodeClipboard(input({html:'<p>'+ 'x'.repeat(524289)+'</p>'})),{status:'refused',diagnostics:['clipboard.invalid_input']});
});
test('CDEC13 media pre-scan inspects after unsupported siblings and forbids all fallback',async()=>{
  for(const html of['<ruby>x</ruby><img src="https://example.test/a">','<img src="https://example.test/a"><ruby>x</ruby>']){
    assert.deepEqual(await decodeClipboard(input({html,plain:'safe independent'})),{status:'refused',diagnostics:['clipboard.media_item_forbidden','clipboard.remote_image_forbidden']});
  }
  assert.deepEqual(await decodeClipboard(input({media:'present',plain:'not a media fallback'})),{status:'refused',diagnostics:['clipboard.media_item_forbidden']});
});
test('CDEC14 URL checks preserve bytes and allow hosts only to tighten native-safe subset',async()=>{
  for(const href of['/safe?q=1#x','https://example.test/a?b=1#c','http://example.test'])assert.equal(isSafeClipboardUrl(href,policy),true,href);
  for(const href of['javascript:alert(1)','data:text/html,x','//foreign.test/a','/a/../b','/a/%2E%2e/b','https://u:p@example.test/','https://@example.test/','https://example.test/a/./b','https://example.test/\u000a','https://example.test/a\\b'])assert.equal(isSafeClipboardUrl(href,policy),false,href);
  const tighter={allow_origin_relative:false,allowed_schemes:['https'],allowed_origins:['https://example.test']};
  assert.equal(isSafeClipboardUrl('/safe',tighter),false);assert.equal(isSafeClipboardUrl('http://example.test',tighter),false);assert.equal(isSafeClipboardUrl('https://foreign.test/',tighter),false);assert.equal(isSafeClipboardUrl('https://example.test/a',tighter),true);
  const r=await decodeClipboard(input({html:'<p><a href="https://foreign.test/">visible</a></p>',plain:'visible',url_policy:tighter}));
  assertCandidate(r,[p(t('visible'))],['clipboard.rich_branch_rejected','clipboard.plain_fallback_used','clipboard.unsafe_url_rejected']);
});
test('CDEC15 safe marks link title hard breaks and ordered/table spans remain ID-free semantic data',async()=>{
  const r=await decodeClipboard(input({plain:null,html:'<p><em><strong>A</strong></em><br><a href="/x" title="hint">B</a></p><ol start="3"><li>C</li></ol><table><tr><th colspan="2" rowspan="1">D</th></tr></table>'}));
  assertCandidate(r,[p({type:'text',text:'A',marks:[{type:'strong'},{type:'emphasis'}]},{type:'hard_break'},{type:'text',text:'B',marks:[{type:'link',attrs:{href:'/x',title:'hint'}}]}),
    {type:'ordered_list',attrs:{start:3},content:[{type:'list_item',content:[p(t('C'))]}]},
    {type:'table',content:[{type:'table_row',content:[{type:'table_header',attrs:{colspan:2},content:[p(t('D'))]}]}]}]);
  assert.equal(JSON.stringify(r).includes('node_id'),false);
});
test('CDEC16 unknown blocks bad numeric structure and incompatible marks never silently flatten',async()=>{
  for(const html of['<aside>important</aside>','<p><constructor>x</constructor></p>','<ol start="no"><li>x</li></ol>','<table><tr><td colspan="0">x</td></tr></table>','<p><code><strong>x</strong></code></p>','<p><sup><sub>x</sub></sup></p>']){
    const r=await decodeClipboard(input({plain:null,html}));assert.deepEqual(r,{status:'refused',diagnostics:['clipboard.unsupported_semantics']},html);
  }
});
test('CDEC17 parser or output limit refuses without converting a plain fallback',async()=>{
  assert.equal(clipboardDecodeLimits.nodes,8192);
  const exact=await decodeClipboard(input({plain:'x\n\n'.repeat(4096)}));assert.equal(exact.status,'candidate');assert.equal(exact.fragment.content.length,4096);
  const over=await decodeClipboard(input({plain:'x\n\n'.repeat(4097)}));assert.deepEqual(over,{status:'refused',diagnostics:['clipboard.invalid_input']});
  const deep=await decodeClipboard(input({plain:'do not fallback',html:'<div>'.repeat(80)+'text'+'</div>'.repeat(80)}));assert.deepEqual(deep,{status:'refused',diagnostics:['clipboard.invalid_input']});
});
test('CDEC18 empty versus invalid scalar strings remain distinct without replacing source text',async()=>{
  assert.deepEqual(await decodeClipboard(input({plain:''})),{status:'refused',diagnostics:['clipboard.empty_payload']});
  assert.deepEqual(await decodeClipboard(input({plain:'\ud800'})),{status:'refused',diagnostics:['clipboard.invalid_input']});
  assert.deepEqual(await decodeClipboard(input({plain:null,html:''})),{status:'refused',diagnostics:['clipboard.empty_payload']});
});
test('CDEC19 rich conversion owns immutable context policy and strings across the parser import yield',async()=>{
  const value=input({html:'<p><a href="/safe">kept</a></p>',plain:'original'}),promise=decodeClipboard(value);
  value.source_profile.profile_id='foreign';value.mode='poetry';value.url_policy.allow_origin_relative=false;value.html.text='<img src="https://foreign.test/">';
  const r=await promise;assertCandidate(r,[p({type:'text',text:'kept',marks:[{type:'link',attrs:{href:'/safe'}}]})]);
  const frozen=v=>{if(v&&typeof v==='object'){assert.equal(Object.isFrozen(v),true);for(const item of Object.values(v))frozen(item);}};frozen(r);
});
test('CDEC20 closed request rejects accessors extra keys and an attempted widening URL policy',async()=>{
  let calls=0;const value=input();Object.defineProperty(value,'plain',{get(){calls++;throw Error('not data');}});
  assert.deepEqual(await decodeClipboard(value),{status:'refused',diagnostics:['clipboard.invalid_input']});assert.equal(calls,0);
  assert.deepEqual(await decodeClipboard({...input(),profile:'inferred'}),{status:'refused',diagnostics:['clipboard.invalid_input']});
  assert.deepEqual(await decodeClipboard(input({url_policy:{allow_origin_relative:true,allowed_schemes:['javascript']}})),{status:'refused',diagnostics:['clipboard.invalid_input']});
});
