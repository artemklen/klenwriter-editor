// SPDX-License-Identifier: MIT OR Apache-2.0
// Actual owner, controlled scheduler/native/view doubles. Not real DOM or native typography evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {InputResultOwner} from '../packages/dom/dist/input-result.js';
const expected=JSON.parse(readFileSync(new URL('../contracts/typography/v1/dom-oracles.json',import.meta.url),'utf8'));
const clone=v=>structuredClone(v),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const point=offset=>({kind:'text',node:'text-1',offset,affinity:'after'}),sel=offset=>({anchor:point(offset),focus:point(offset)});
function harness({queued=false,refused=false,after,reenterRestore=false,origin='ordinary_insert_text',compositionOwned=false}={}){
  let serial=0n,available=true,focused=true,editable=true,viewCalls=0;
  let state={stamp:{session:'s1',generation:'1',revision:'0',selection_epoch:'1',history_epoch:'0'},root:'root-1',selection:sel(2),stored_marks:null,dirty:false,saved_revision:'0',history:{undo_entries:'0',redo_entries:'0',retained_bytes:'0'}};
  const context={build_id:'controlled',profile:{},registry_digest:'registry',capability_digest:'capability'};
  const initial=clone(state),events=[],recoveries=[],resourceSnapshots=[],submissions=[];
  const textNode={},element={contains:target=>target===element||target===textNode,ownerDocument:{hasFocus:()=>focused,getSelection:()=>({isCollapsed:true,anchorNode:textNode,focusNode:textNode})}};
  let owner,resolve,reject;
  const view={domPoint:()=>({node:textNode,offset:2}),ownedBlockAt:()=> 'block-1',readSelection:()=>clone(state.selection),hasProvisional:()=>false,
    checkInputResult:result=>{viewCalls++;assert.equal(result.after.spans[0].text,'«');return null;},checkInputRegion:()=>{viewCalls++;return null;},
    beginComposition(stamp,selection){viewCalls++;return {stamp,selection,entries:[{id:'block-1'}],originalRegion:{kind:'bounded',stamp,originalText:'a «',provisionalText:'a «',affectedNodeIds:['block-1']}};},
    observeComposition:()=>{viewCalls++;return {unchanged:true,fingerprint:'checked:cooked',region:{kind:'bounded',stamp:state.stamp,originalText:'a «',provisionalText:'a «',affectedNodeIds:['block-1']},replacement:''};},endProvisional(){viewCalls++;}};
  const selection={intent:()=>serial,intentAvailable:()=>available,ownsFocus:()=>focused,invalidate(event=null){const before=serial;serial++;owner.intent(before,serial,event);}};
  function inputResult(before){
    const cooked={block:'block-1',range:{anchor:point(2),focus:point(3)},spans:[{node:'text-1',from_utf16:2,to_utf16:3,type_id:'org.klenwriter.kwdj/text',attributes:{},marks:[],text:'«'}]};
    return {kind:'text_replacement',before_stamp:before.stamp,after_stamp:clone(state.stamp),original:{origin,selection:sel(2),text:'"'},before:{block:'block-1',range:sel(2)},after:cooked,
      after_selection:sel(3),after_stored_marks:null,raw_restore:{format_id:'org.klenwriter.editor/raw-input-restore/1',stamp:clone(state.stamp),selection:sel(3),stored_marks:null,cooked:clone(cooked),raw:[{type_id:'org.klenwriter.kwdj/text',attributes:{},marks:[],text:'"'}],raw_caret_utf16:1,raw_stored_marks:null}};
  }
  function actual(request){
    if(refused)return {status:'refused',diagnostic:{code:'session.stale_revision',path:'',category:'session',details:{},stamp:clone(state.stamp),may_have_committed:false}};
    const before=clone(state),restore=request.command.id==='restore';
    state={...state,stamp:{...state.stamp,revision:restore?'2':'1',selection_epoch:'2',history_epoch:restore?'2':'1'},selection:sel(3),dirty:true,history:{undo_entries:restore?'2':'1',redo_entries:'0',retained_bytes:'100'}};
    const event={before:before.stamp,after:clone(state.stamp),selection_before:clone(before.selection),selection_after:clone(state.selection)};events.push(event);owner.publication(event);selection.invalidate();
    return {status:'ok',value:{kind:'input_mutation',effect:'changed',state:clone(state),presentation:null,result:restore?null:inputResult(before)}};
  }
  const bindings={insertTypedText:data=>({id:'typed',payload_json:JSON.stringify(data)}),restoreTypedText:restore=>{if(reenterRestore)owner.retire();return {id:'restore',payload_json:JSON.stringify(restore)};}};
  owner=new InputResultOwner({element,view,bindings,selection,capture:()=>clone(state.stamp),context:()=>clone(context),readState:()=>clone(state),canEdit:()=>editable,busy:()=>false,
    recover:(failure,region)=>recoveries.push({failure,region,retained:owner.takeRecovery()}),changed:()=>resourceSnapshots.push(owner.resources())});
  function submit(request){submissions.push(request);selection.invalidate();
    if(queued)return {status:'queued',completion:new Promise((yes,no)=>{resolve=()=>yes(actual(request));reject=no;})};
    return {status:'completed',response:actual(request)};
  }
  function event(type,extra={}){return {type,target:element,key:'Backspace',code:'Backspace',keyCode:8,cancelable:true,defaultPrevented:false,repeat:false,
    altKey:false,ctrlKey:false,metaKey:false,shiftKey:false,isComposing:false,inputType:'deleteContentBackward',data:null,getTargetRanges:()=>[],preventDefault(){this.defaultPrevented=true;},...extra};}
  const api={owner,view,selection,submissions,recoveries,resourceSnapshots,event,
    start(){const window=compositionOwned?{stamp:initial.stamp,selection:initial.selection,entries:[{id:'block-1'}]}:null;const prepared=owner.prepare('"',origin,window,compositionOwned);assert(!('status'in prepared));return owner.dispatch(prepared,submit,after);},
    complete:()=>resolve(),unknown:()=>reject(new Error('controlled unknown terminal')),state:()=>clone(state),viewCalls:()=>viewCalls,
    key(){const key=event('keydown');owner.keydown(key);selection.invalidate(key);selection.invalidate(key);owner.afterKeydown(key);return key;},
    before(){const input=event('beforeinput');owner.beforeInput(input);selection.invalidate(input);return input;},
    restore(input){const prepared=owner.restore(input,compositionOwned);if(prepared&&!('status'in prepared))return owner.dispatch(prepared,submit);return prepared;},
    focus:value=>{focused=value;},mode:value=>{editable=value;},exhaust:()=>{available=false;},
  };return api;
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
test('typed owner controlled: completed owned result arms only compact descriptor and matching key/beforeinput restores once',()=>{
  const h=harness();h.start();assert.equal(h.owner.resources().armedSlots,expected.states.quote_cooked.privateInputState.armedSlots);
  assert(h.owner.resources().retainedBytes<=4096);const key=h.key(),input=h.before();assert.equal(h.owner.resources().armedSlots,0);assert.equal(h.owner.resources().backspaceCandidates,1);
  h.restore(input);assert.equal(h.submissions.length,2);assert.equal(h.submissions[1].command.id,'restore');assert.equal(h.state().stamp.selection_epoch,'2');
  assert.deepEqual(h.owner.resources(),{armedSlots:0,backspaceCandidates:0,pendingDispatches:0,retainedBytes:0});
  h.owner.keydown(key);h.owner.beforeInput(input);assert.equal(h.restore(input),null);assert.equal(h.submissions.length,2);h.owner.destroy();
});
test('typed owner controlled: queued ticket cannot arm until its original actual terminal publication',async()=>{
  const h=harness({queued:true}),ticket=h.start();assert.equal(ticket.status,'queued');assert.equal(h.owner.resources().armedSlots,0);assert.equal(h.owner.resources().pendingDispatches,1);
  h.complete();await flush();assert.equal(h.owner.resources().armedSlots,1);assert.equal(h.submissions.length,1);h.owner.destroy();
});
test('typed owner controlled: foreign intent while queued forbids adoption of later native success',async()=>{
  const h=harness({queued:true});h.start();h.selection.invalidate(h.event('pointerdown'));h.complete();await flush();
  assert.equal(h.owner.resources().armedSlots,0);assert.equal(h.recoveries[0].failure.diagnostic.publication,'alreadyPublished');assert.equal(h.recoveries[0].retained.original.text,'"');
  assert.equal(h.recoveries[0].retained.response.value.kind,'input_mutation');h.owner.destroy();
});
test('typed owner controlled: query/foreign publication alone cannot arm automatic slot',()=>{
  const h=harness();h.owner.publication({before:h.state().stamp,after:h.state().stamp});assert.equal(h.owner.resources().armedSlots,0);
  assert.equal(h.submissions.length,0);h.owner.destroy();
});
for(const kind of ['navigation_noop','pointer_same_caret','host_noop','focus','mode','repeat','keyup_without_input','foreign_between_events'])test(`typed owner controlled invalidator ${kind}`,()=>{
  const h=harness();h.start();const before=h.state();
  if(kind==='focus'){h.focus(false);h.owner.retire();h.focus(true);}
  else if(kind==='mode'){h.mode(false);h.owner.retire();h.mode(true);}
  else if(kind==='repeat')h.owner.keydown(h.event('keydown',{repeat:true}));
  else if(kind==='keyup_without_input'){h.key();h.owner.keyup(h.event('keyup'));}
  else if(kind==='foreign_between_events'){h.key();h.selection.invalidate(h.event('pointerdown'));h.before();}
  else h.selection.invalidate(kind==='host_noop'?null:h.event(kind));
  assert.deepEqual(h.state(),before);assert.equal(h.owner.resources().armedSlots,0);assert.equal(h.owner.resources().backspaceCandidates,0);assert.equal(h.submissions.length,1);h.owner.destroy();
});
test('typed owner controlled: original exact event invalidations advance lineage but a new event cannot',()=>{
  const h=harness();h.start();h.key();h.selection.invalidate(h.event('keydown'));const input=h.before();assert.equal(h.restore(input),null);assert.equal(h.submissions.length,1);h.owner.destroy();
});
test('typed owner controlled: claim before constructor prevents reentrant restore and fallback',()=>{
  const h=harness({reenterRestore:true});h.start();h.key();const input=h.before();assert.equal(h.restore(input).status,'dom_refused');
  assert.equal(h.submissions.length,1);assert.equal(h.owner.resources().armedSlots,0);assert.equal(h.owner.takeRecovery().nativeOutcome,'not_submitted');h.owner.destroy();
});
test('typed owner controlled: observers can retire prospective receipt before arming',()=>{
  let h;h=harness({after:()=>h.owner.retire()});h.start();assert.equal(h.owner.resources().armedSlots,0);h.owner.destroy();
});
test('typed owner controlled: actual refusal and unknown outcomes retain exact raw source, never retry',async()=>{
  const refused=harness({refused:true});refused.start();assert.equal(refused.recoveries[0].retained.original.text,'"');assert.equal(refused.recoveries[0].retained.response.diagnostic.code,'session.stale_revision');assert.equal(refused.submissions.length,1);refused.owner.destroy();
  const unknown=harness({queued:true});unknown.start();unknown.unknown();await flush();assert.equal(unknown.recoveries[0].retained.nativeOutcome,'unknown');assert.equal(unknown.recoveries[0].failure.diagnostic.publication,'unknown');assert.equal(unknown.submissions.length,1);unknown.owner.destroy();
});
test('typed owner controlled: destroy transfers queued source and late completion only releases numeric resources',async()=>{
  const h=harness({queued:true});h.start();const receipt=h.owner.takeRecovery();assert.equal(receipt.nativeOutcome,'queued');h.owner.destroy();const calls=h.viewCalls();h.complete();await flush();
  assert.equal(h.viewCalls(),calls);assert.equal(receipt.nativeOutcome,'queued');assert.deepEqual(h.owner.resources(),{armedSlots:0,backspaceCandidates:0,pendingDispatches:0,retainedBytes:0});assert.equal(h.resourceSnapshots.at(-1).pendingDispatches,0);
});
test('typed owner controlled: committed composition requires joined result frame before explicit arm',()=>{
  const h=harness({origin:'composition_commit',compositionOwned:true}),ticket=h.start();assert.equal(h.owner.resources().armedSlots,0);
  const window=h.owner.joined(ticket.response);assert(window);assert.equal(window.originalRegion.provisionalText,'a «');assert.equal(ticket.response.value.result.original.origin,'composition_commit');
  h.owner.arm(ticket.response);assert.equal(h.owner.resources().armedSlots,1);h.owner.destroy();
});
test('typed owner controlled: bulk original source retains the existing exact2MiB UTF16 bound without truncation',()=>{
  const h=harness(),raw='x'.repeat(2097152),prepared=h.owner.prepare(raw,'ordinary_insert_text');
  assert(!('status'in prepared));assert.equal(h.owner.resources().retainedBytes,4194304);
  const receipt=h.owner.takeRecovery();assert.equal(receipt.original.kind,'bounded');assert.equal(receipt.original.text,raw);assert.equal(receipt.nativeOutcome,'not_submitted');
  assert.equal(h.submissions.length,0);h.owner.destroy();assert.equal(h.owner.resources().retainedBytes,0);
});
test('typed owner controlled: over-cap original event transfers truthful authority rather than a prefix',()=>{
  const h=harness(),raw='x'.repeat(2097153),event=h.event('beforeinput',{inputType:'insertText',data:raw});
  assert.equal(h.owner.prepare(raw,'ordinary_insert_text',null,false,false,event).status,'dom_refused');
  const receipt=h.owner.takeRecovery();assert.equal(receipt.original.kind,'retained_event');assert.equal(receipt.original.event,event);assert.equal(receipt.original.event.data,raw);
  assert.equal(receipt.retainedBytes,0);assert.equal(h.submissions.length,0);h.owner.destroy();
});
