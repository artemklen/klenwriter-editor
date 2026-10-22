// SPDX-License-Identifier: MIT OR Apache-2.0
// Controlled transport/controller only. Frozen literals are not native rule evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEditor,createCommand} from '../packages/sdk/dist/index.js';
import {fakeV2Module,v2Options} from './helpers/sdk-v2-fake.mjs';
import {fakeModule,options,result as terminal,mutation} from './helpers/sdk-fake.mjs';
const oracle=JSON.parse(readFileSync(new URL('../contracts/typography/v1/dom-oracles.json',import.meta.url),'utf8'));
const clone=value=>structuredClone(value),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const json=value=>JSON.parse(JSON.stringify(value));
const point=offset=>({kind:'text',node:'leaf-1',offset,affinity:'after'});
const selection=offset=>({anchor:point(offset),focus:point(offset)});
const typed=editor=>({kind:'input_command',stamp:clone(editor.capture()),command:createCommand('org.klenwriter.kwdj/command/insert-typed-text',
  {kind:'insert_typed_text',origin:'ordinary_insert_text',text:'"'})});
function literalResult(before,after){
  const afterRegion={block:'block-1',range:{anchor:point(2),focus:point(3)},spans:[{node:'leaf-1',from_utf16:2,to_utf16:3,
    type_id:'org.klenwriter.kwdj/text',attributes:{},marks:[],text:'«'}]};
  return {kind:'text_replacement',before_stamp:clone(before),after_stamp:clone(after),
    original:{origin:'ordinary_insert_text',selection:selection(2),text:'"'},before:{block:'block-1',range:selection(2)},after:afterRegion,
    after_selection:selection(3),after_stored_marks:null,raw_restore:{format_id:'org.klenwriter.editor/raw-input-restore/1',stamp:clone(after),
      selection:selection(3),stored_marks:null,cooked:clone(afterRegion),raw:[{type_id:'org.klenwriter.kwdj/text',attributes:{},marks:[],text:'"'}],
      raw_caret_utf16:1,raw_stored_marks:null}};
}
async function open({alter,replyKind='input_mutation',largeState=false}={}){
  const fixture=fakeV2Module({open(session){session.state.selection=selection(2);session.state.stamp.selection_epoch='1';},
    call(request,session){
      if(request.kind==='query_input_command')return JSON.stringify({status:'ok',value:{kind:'availability',available:true,effect:'changed',presentation:null,diagnostic:null}});
      if(request.kind!=='input_command')return;
      if(!same(request.stamp,session.state.stamp))return session.refused('session.stale_revision');
      const before=clone(session.state);
      session.state.stamp={...before.stamp,revision:String(BigInt(before.stamp.revision)+1n),selection_epoch:String(BigInt(before.stamp.selection_epoch)+1n),history_epoch:String(BigInt(before.stamp.history_epoch)+1n)};
      session.state.selection=selection(3);session.state.dirty=true;session.state.history={undo_entries:'1',redo_entries:'0',retained_bytes:'100'};
      if(largeState)session.state.root='r'.repeat(40000);
      session.events.push({sequence:String(++session.sequence),before:before.stamp,after:clone(session.state.stamp),selection_before:before.selection,
        selection_after:clone(session.state.selection),stored_marks_before:null,stored_marks_after:null,dirty_before:before.dirty,dirty_after:true,
        history:clone(session.state.history),change:{kind:'document',impact:{upserted:['leaf-1'],removed:[],ancestors_before:['block-1','root-1'],ancestors_after:['block-1','root-1'],root_order_changed:false},from_revision:before.stamp.revision,to_revision:session.state.stamp.revision}});
      const value={kind:replyKind,effect:'changed',state:clone(session.state),presentation:null};
      if(replyKind==='input_mutation')value.result=literalResult(before.stamp,session.state.stamp);
      alter?.(value,session);
      return JSON.stringify({status:'ok',value});
    }});
  const editor=createEditor({input:new Uint8Array([65]),options:v2Options(),loader:async()=>fixture.module});
  assert.equal((await editor.ready).status,'ok');return {editor,fixture};
}

test('typing ABI2 controller: exact result and cached state precede publication callbacks',async()=>{
  const {editor,fixture}=await open(),before=clone(editor.capture()),seen=[];
  editor.subscribe(event=>seen.push([event.after.revision,editor.capture().revision,editor.read({kind:'state'}).value.state.selection]));
  const ticket=editor.submit(typed(editor));assert.equal(ticket.status,'completed');assert.equal(ticket.response.status,'ok');
  assert.equal(ticket.response.value.kind,'input_mutation');assert.deepEqual(JSON.parse(JSON.stringify(ticket.response.value.result)),literalResult(before,editor.capture()));
  assert.deepEqual(json(seen),[['1','1',selection(3)]]);assert(Object.isFrozen(ticket.response.value.result.raw_restore.raw));
  assert.equal(oracle.states.quote_cooked.canonical_json,'{"content":[{"content":[{"text":"a «","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}');
  editor.destroy();assert.deepEqual(fixture.counts(),{live:0,destroyed:1,freed:1});
});
test('typing ABI2 controller: queued original input is executed once and duplicate old stamp refuses',async()=>{
  const {editor,fixture}=await open(),tickets=[];
  editor.subscribe(event=>{if(event.sequence==='1'){const request=typed(editor);tickets.push(editor.submit(request),editor.submit(request));}});
  editor.submit(mutation(editor));assert.equal(tickets.length,2);assert(tickets.every(t=>t.status==='queued'));
  assert.equal((await terminal(tickets[0])).value.kind,'input_mutation');assert.equal((await terminal(tickets[1])).diagnostic.code,'session.stale_revision');
  assert.equal(fixture.log.filter(r=>r.kind==='input_command').length,2);assert.equal(editor.capture().revision,'2');
  editor.destroy();assert.equal(editor.resources().pending_tickets,0);
});
test('typing ABI2 pure query has no result, event, state or ticket side effects',async()=>{
  const {editor,fixture}=await open(),before=clone(editor.capture()),request=typed(editor);
  const response=editor.query({...request,kind:'query_input_command'});assert.equal(response.value.kind,'availability');
  assert.deepEqual(json(editor.capture()),before);assert.equal(fixture.log.filter(r=>r.kind==='events').length,0);assert.equal(editor.resources().pending_tickets,0);editor.destroy();
});
test('typing ABI2 has no new 32KiB whole-state ceiling',async()=>{
  const {editor}=await open({largeState:true});const response=editor.submit(typed(editor)).response;
  assert.equal(response.status,'ok');assert.equal(response.value.state.root.length,40000);assert.equal(response.value.result.after.spans[0].text,'«');editor.destroy();
});
test('typing ABI2 legal marked wire nesting is separate from native attribute-relative depth',async()=>{
  const {editor}=await open({alter(value){
    const marks=[{type_id:'org.klenwriter.kwdj/highlight',attributes:{token:{kind:'string',value:'accent'}}}];
    value.result.after.spans[0].marks=marks;value.result.raw_restore.cooked=clone(value.result.after);value.result.raw_restore.raw[0].marks=clone(marks);
  }});
  const response=editor.submit(typed(editor)).response;assert.equal(response.status,'ok');assert.equal(response.value.result.raw_restore.raw[0].marks[0].attributes.token.value,'accent');editor.destroy();
});
for(const [name,alter]of[
  ['wrong original stamp',value=>value.result.before_stamp.revision='99'],
  ['wrong final selection',value=>value.result.after_selection=selection(2)],
  ['missing required nullable',value=>delete value.result.raw_restore],
  ['unknown result field',value=>value.result.extra=true],
  ['oversize cooked text',value=>{value.result.after.spans[0].text='a'.repeat(13);value.result.after.spans[0].to_utf16=15;value.result.after.range.focus.offset=15;value.result.raw_restore.cooked=clone(value.result.after);}],
  ['non scalar result',value=>value.result.original.text='\ud800'],
  ['restore metadata beyond4096',value=>{const attrs={large:{kind:'string',value:'x'.repeat(4100)}};value.result.after.spans[0].attributes=attrs;value.result.raw_restore.cooked=clone(value.result.after);}],
  ['result beyond16384 with no restoration',value=>{value.result.raw_restore=null;value.result.after.spans[0].attributes={large:{kind:'string',value:'x'.repeat(16400)}};}],
  ['no changed result',value=>value.effect='unchanged'],
  ['wrong reply for request',null],
])test(`typing ABI2 malformed ${name} cannot be adopted or replayed`,async()=>{
  const {editor,fixture}=await open({alter,replyKind:alter?'input_mutation':'mutation'}),before=clone(editor.capture()),seen=[];editor.subscribe(e=>seen.push(e));
  const response=editor.submit(typed(editor)).response;assert.equal(response.status,'fatal');assert.equal(response.diagnostic.may_have_committed,true);
  assert.equal(editor.lifecycle,'fatal');assert.equal(editor.capture(),null);assert.equal(seen.length,0);assert.equal(before.revision,'0');
  assert.deepEqual(fixture.counts(),{live:0,destroyed:1,freed:1});editor.destroy();
});
test('typing reply on legacy command remains closed and ABI1 input kind never reaches native',async()=>{
  const v1=fakeModule(),old=createEditor({input:new Uint8Array([65]),options:options(),loader:async()=>v1.module});await old.ready;
  assert.equal(old.submit({kind:'input_command',stamp:old.capture(),command:{id:'fixture.input',payload_json:'{}'}}).response.diagnostic.code,'sdk.invalid_request_kind');
  assert.equal(v1.log.length,0);old.destroy();
  const fixture=fakeV2Module({call(request,session){if(request.kind==='command')return JSON.stringify({status:'ok',value:{kind:'input_mutation',effect:'unchanged',state:session.state,presentation:null,result:null}});}});
  const editor=createEditor({input:new Uint8Array([65]),options:v2Options(),loader:async()=>fixture.module});await editor.ready;
  const response=editor.submit(mutation(editor)).response;assert.equal(response.status,'fatal');assert.equal(response.diagnostic.may_have_committed,true);editor.destroy();
});
