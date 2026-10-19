// SPDX-License-Identifier: MIT OR Apache-2.0
// Controlled SDK/configuration boundary only; never a replacement Rust authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SelectionOwner} from '../packages/dom/dist/selection.js';
const literals=JSON.parse(readFileSync(new URL('../contracts/selection/v1/bookmark-oracles.json',import.meta.url),'utf8'));
const copy=value=>structuredClone(value),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function fixture(initial='BASE') {
  let state=copy(literals.states[initial]),context=copy(literals.contexts.KWDJ_A),busy=false,dom=copy(state.selection),next=null,readFailure=null,mapReply=null,onFocus=null;
  const calls={read:[],submit:[],restore:[],failures:[],focus:0};
  const host={ownerDocument:{activeElement:null},contains:node=>node?.owned===true,focus(){calls.focus++;host.ownerDocument.activeElement=host;onFocus?.();}};host.ownerDocument.activeElement=host;
  const nodes=new Map();const point=position=>{const role=position.kind==='child'?position.parent:position.node;if(!nodes.has(role))nodes.set(role,{owned:true,role});return {node:nodes.get(role),offset:position.kind==='text'?position.offset:position.kind==='child'?position.index:position.side==='before'?0:1};};
  const view={readSelection:()=>dom,domPoint:point,restoreSelection(selection){calls.restore.push(copy(selection));dom=copy(selection);return null;}};
  let owner;
  const mutation=(effect='unchanged')=>({status:'completed',response:{status:'ok',value:{kind:'mutation',effect,state:copy(state),presentation:null}}});
  owner=new SelectionOwner({element:()=>host,view:()=>view,capture:()=>state.stamp,context:()=>context,guard:()=>null,busy:()=>busy,
    report:f=>calls.failures.push(f),recover:f=>calls.failures.push(f),
    read(request){calls.read.push(copy(request));if(readFailure && request.kind==='map_position')return readFailure;if(request.kind==='state')return {status:'ok',value:{kind:'state',state}};if(request.kind==='map_position'){assert(mapReply,'A literal mapping reply must be installed explicitly');return typeof mapReply==='function'?mapReply(request):mapReply;}throw Error('Unexpected controlled read '+request.kind);},
    submit(request){calls.submit.push(copy(request));const frame=owner.beginSubmission(request,true);const result=next?next(request):mutation();owner.endSubmission(frame,result);return result;}});
  const event=(before,after,kind='document')=>({before:before.stamp,after:after.stamp,selection_before:before.selection,selection_after:after.selection,stored_marks_before:before.stored_marks,stored_marks_after:after.stored_marks,change:{kind},sequence:after.last_published_event_sequence});
  return {owner,calls,host,view,get state(){return state;},set busy(v){busy=v;},set dom(v){dom=v;},set context(v){context=v;},set readFailure(v){readFailure=v;},set mapReply(v){mapReply=v;},set nextSubmit(v){next=v;},set onFocus(v){onFocus=v;},mutation,
    capture(){const result=owner.api.captureBookmark();assert.equal(result.status,'captured');return result.bookmark;},
    setState(name){state=copy(literals.states[name]);dom=copy(state.selection);},
    document(name,mapName,duringPublication){const before=copy(state),frame=owner.beginSubmission({kind:'command',stamp:state.stamp,command:{id:'fixture.document-only',payload_json:'{}'},history_hint:{kind:'isolated'}},false);state=copy(literals.states[name]);dom=copy(state.selection);owner.publication(event(before,state));duringPublication?.();owner.endSubmission(frame,mutation('changed'));const probes=literals.native_map_facts[mapName].probes;mapReply=request=>{const expected=probes.find(probe=>same(probe.input,request.position));assert(expected,'Literal map probe missing');return {status:'ok',value:{kind:'mapped',status:expected.status,position:copy(expected.output),deleted:expected.deleted,stamp:state.stamp}};};},
    nativeChange(name){const before=copy(state);state=copy(literals.states[name]);dom=copy(state.selection);owner.publication(event(before,state,'state'));},
  };
}
function refusal(result,code){assert.equal(result.status,'dom_refused');assert.equal(result.diagnostic.code,code);assert.equal(result.diagnostic.phase,'selection');}

test('BM-C/L/B controlled capture purity,64 handles, release and private brands',()=>{
  const f=fixture(),before=copy(f.state),handles=[];
  for(let i=0;i<64;i++)handles.push(f.capture());
  refusal(f.owner.api.captureBookmark(),'dom.selection_limit');assert.equal(f.calls.submit.length,0);assert.deepEqual(f.state,before);
  assert.equal(f.owner.api.releaseBookmark(handles[0]),true);assert.equal(f.owner.api.releaseBookmark(handles[0]),false);f.capture();assert.equal(f.owner.resources().bookmarks,64);
  refusal(f.owner.api.restoreBookmark({...handles[1]}),'dom.invalid_bookmark');
  const other=fixture(),foreign=other.capture();refusal(f.owner.api.restoreBookmark(foreign),'dom.invalid_bookmark');assert.equal(f.owner.api.releaseBookmark(foreign),false);assert.equal(other.owner.resources().bookmarks,1);
});
test('BM-E01/E02 controlled exact no-op returns original Submission, marks preserved, handle consumed',()=>{
  const f=fixture('MARKS'),bookmark=f.capture(),native=f.mutation();f.nextSubmit=()=>native;
  assert.equal(f.owner.api.restoreBookmark(bookmark),native);assert.deepEqual(f.state,literals.states.MARKS);assert.equal(f.owner.resources().bookmarks,0);refusal(f.owner.api.restoreBookmark(bookmark),'dom.invalid_bookmark');
});
test('BM-C09/null controlled model capture does not flush pending DOM; null never chooses a caret',()=>{
  const f=fixture();f.dom={anchor:{kind:'text',node:'T',offset:3,affinity:'after'},focus:{kind:'text',node:'T',offset:3,affinity:'after'}};
  refusal(f.owner.api.captureBookmark(),'dom.selection_unsynchronized');assert.equal(f.calls.submit.length,0);
  const n=fixture('NULL'),bookmark=n.capture();assert.equal(bookmark.selection,null);refusal(n.owner.api.restoreBookmark(bookmark,{focus:true}),'dom.selection_missing');assert.equal(n.owner.resources().bookmarks,1);assert.equal(n.calls.submit.length,0);
});
test('BM-E08/E09 controlled new same-point intent invalidates without native stamp change',()=>{
  const f=fixture(),bookmark=f.capture(),stamp=copy(f.state.stamp);f.owner.invalidate();refusal(f.owner.api.restoreBookmark(bookmark,{policy:'mapped'}),'dom.stale_selection');assert.deepEqual(f.state.stamp,stamp);assert.equal(f.calls.submit.length,0);assert.equal(f.calls.read.filter(r=>r.kind==='map_position').length,0);
});
test('controlled restore option validation does not coerce host objects or consume the handle',()=>{
  const f=fixture(),bookmark=f.capture();let coerced=0;
  refusal(f.owner.api.restoreBookmark(bookmark,{policy:{toString(){coerced++;return 'mapped';}}}),'dom.invalid_options');
  assert.equal(coerced,0);assert.equal(f.owner.resources().bookmarks,1);assert.equal(f.calls.submit.length,0);
  assert.equal(f.owner.api.restoreBookmark(bookmark).status,'completed');
});
test('controlled browser selection synchronization invalidates old intent before its native setter',()=>{
  const f=fixture(),bookmark=f.capture();f.dom=copy(literals.states.NATIVE_NEW_SELECTION.selection);
  const native=f.mutation('state_changed');f.nextSubmit=request=>{assert.deepEqual(request.selection,literals.states.NATIVE_NEW_SELECTION.selection);f.setState('NATIVE_NEW_SELECTION');return native;};
  assert.deepEqual(f.owner.syncFromDom(),literals.states.NATIVE_NEW_SELECTION.selection);
  assert.equal(f.calls.submit.length,1);refusal(f.owner.api.restoreBookmark(bookmark,{policy:'mapped'}),'dom.stale_selection');
  assert.equal(f.calls.read.filter(r=>r.kind==='map_position').length,0);
});
test('BM-M01/M10 controlled direct synchronous document continuity maps literal split; exact refusal retains handle',()=>{
  const f=fixture(),bookmark=f.capture();f.document('AFTER_SPLIT','SPLIT_AT_2');refusal(f.owner.api.restoreBookmark(bookmark),'dom.stale_selection');assert.equal(f.owner.resources().bookmarks,1);
  const result=f.owner.api.restoreBookmark(bookmark,{policy:'mapped'});assert.equal(result.status,'completed');assert.deepEqual(f.calls.submit[0].selection,literals.states.AFTER_SPLIT.selection);assert.equal(f.calls.read.filter(r=>r.kind==='map_position').length,2);assert.equal(f.owner.resources().bookmarks,0);
});
test('BM-M02 controlled split Before uses independently authored old-left endpoint and original changed response',()=>{
  const f=fixture('BEFORE_AFFINITY'),bookmark=f.capture();f.document('AFTER_SPLIT','SPLIT_AT_2');let returned;
  f.nextSubmit=request=>{assert.deepEqual(request.selection,literals.states.RESTORED_SPLIT_BEFORE.selection);f.setState('RESTORED_SPLIT_BEFORE');returned=f.mutation('state_changed');return returned;};
  assert.equal(f.owner.api.restoreBookmark(bookmark,{policy:'mapped'}),returned);assert.deepEqual(f.state.selection,literals.states.RESTORED_SPLIT_BEFORE.selection);
});
test('BM-M04/M06 controlled join EdgeAfter and pre-operation Move gap use frozen literal map facts',()=>{
  for(const [before,after,map] of [['JOIN_EDGE','AFTER_JOIN_EDGE','JOIN_2_PLUS_2'],['MOVE_GAP','MOVED_GAP','MOVE_FORWARD']]){
    const f=fixture(before),bookmark=f.capture();f.document(after,map);const result=f.owner.api.restoreBookmark(bookmark,{policy:'mapped'});assert.equal(result.status,'completed');assert.deepEqual(f.calls.submit[0].selection,literals.states[after].selection);
  }
});
test('BM-M11/M12/M13 controlled deleted,stale,invalid map results never dispatch a plausible fallback',()=>{
  for(const kind of ['deleted','stale','invalid']){
    const f=fixture(),bookmark=f.capture();f.document('AFTER_SPLIT','SPLIT_AT_2');f.mapReply={status:'ok',value:{kind:'mapped',status:kind,position:kind==='deleted'?{kind:'child',parent:'ROOT',index:1,affinity:'after'}:null,deleted:kind==='deleted',stamp:f.state.stamp}};
    refusal(f.owner.api.restoreBookmark(bookmark,{policy:'mapped'}),'dom.stale_selection');assert.equal(f.calls.submit.length,0);assert.equal(f.owner.resources().bookmarks,1);
  }
});
test('BM-M14 controlled native read failure object is preserved without fake mutation',()=>{
  const f=fixture(),bookmark=f.capture();f.document('AFTER_SPLIT','SPLIT_AT_2');const response={status:'refused',diagnostic:{code:'fixture.map_read_refused',path:'/controlled',category:'fixture',details:{},stamp:f.state.stamp,may_have_committed:false}};f.readFailure=response;
  const result=f.owner.api.restoreBookmark(bookmark,{policy:'mapped'});assert.equal(result.status,'sdk_failure');assert.equal(result.response,response);assert.equal(f.calls.submit.length,0);
});
test('BM-H01/H05 controlled unknown/history provenance invalidates even when native map can succeed',()=>{
  const f=fixture(),old=f.capture();f.document('AFTER_SPLIT','SPLIT_AT_2');f.nativeChange('UNDO_SPLIT');refusal(f.owner.api.restoreBookmark(old,{policy:'mapped'}),'dom.stale_selection');
  const fresh=f.capture();refusal(f.owner.api.restoreBookmark(old,{policy:'mapped'}),'dom.stale_selection');assert.equal(f.owner.api.restoreBookmark(fresh).status,'completed');assert.equal(f.owner.resources().bookmarks,1);
});
test('BM-A01 controlled busy rejects before queue and retains the handle',()=>{
  const f=fixture(),bookmark=f.capture();f.busy=true;refusal(f.owner.api.restoreBookmark(bookmark),'dom.busy');assert.equal(f.calls.submit.length,0);assert.equal(f.owner.resources().bookmarks,1);
});
test('BM-C11/A02 controlled publication fence rejects capture and restore before reads or queue',()=>{
  const f=fixture('AFTER_SPLIT'),bookmark=f.capture(),before=copy(f.state),reads=f.calls.read.length;f.busy=true;
  refusal(f.owner.api.captureBookmark(),'dom.busy');refusal(f.owner.api.restoreBookmark(bookmark),'dom.busy');
  assert.equal(f.calls.read.length,reads);assert.equal(f.calls.submit.length,0);assert.equal(f.owner.resources().bookmarks,1);assert.deepEqual(f.state,before);
});
test('BM-M15 controlled reentrant queued native no-op invalidates direct document continuity',()=>{
  const f=fixture(),bookmark=f.capture();let nested;
  const queued={status:'queued',completion:Promise.resolve(f.mutation().response)};
  f.document('AFTER_SPLIT','SPLIT_AT_2',()=>{nested=f.owner.beginSubmission({kind:'set_selection',stamp:f.state.stamp,selection:f.state.selection},false);f.owner.endSubmission(nested,queued);});
  assert(nested);refusal(f.owner.api.restoreBookmark(bookmark,{policy:'mapped'}),'dom.stale_selection');
  assert.equal(f.calls.submit.length,0);assert.equal(f.calls.read.filter(r=>r.kind==='map_position').length,0);
});
test('BM-A04 controlled newer subscriber selection preserves original changed restore response',()=>{
  const f=fixture('BEFORE_AFFINITY'),bookmark=f.capture();f.document('AFTER_SPLIT','SPLIT_AT_2');let native,nested;
  f.nextSubmit=request=>{
    assert.deepEqual(request.selection,literals.states.RESTORED_SPLIT_BEFORE.selection);
    f.nativeChange('RESTORED_SPLIT_BEFORE');native=f.mutation('state_changed');
    const frame=f.owner.beginSubmission({kind:'set_selection',stamp:f.state.stamp,selection:literals.states.AFTER_RESTORE_SUBSCRIBER.selection},false);
    nested={status:'queued',completion:Promise.resolve({status:'ok',value:{kind:'mutation',effect:'state_changed',state:copy(literals.states.AFTER_RESTORE_SUBSCRIBER),presentation:null}})};
    f.owner.endSubmission(frame,nested);f.nativeChange('AFTER_RESTORE_SUBSCRIBER');return native;
  };
  const result=f.owner.api.restoreBookmark(bookmark,{policy:'mapped',focus:true});
  assert.equal(result,native);assert.equal(nested.status,'queued');assert.deepEqual(result.response.value.state,literals.states.RESTORED_SPLIT_BEFORE);
  assert.deepEqual(f.state,literals.states.AFTER_RESTORE_SUBSCRIBER);assert.equal(f.calls.focus,0);assert.equal(f.calls.restore.length,0);
  const failure=f.calls.failures.at(-1);assert.equal(failure.diagnostic.code,'dom.stale_selection');assert.equal(failure.diagnostic.publication,'alreadyPublished');
  assert.equal(f.calls.submit.length,1);assert.equal(f.owner.resources().bookmarks,0);
});
test('BM-A03 controlled unexpected queued Submission identity/completion survives new intent and destroy',async()=>{
  const f=fixture(),bookmark=f.capture();let resolve;const completion=new Promise(done=>{resolve=done;}),native={status:'queued',completion};f.nextSubmit=()=>native;
  assert.equal(f.owner.api.restoreBookmark(bookmark,{focus:true}),native);assert.equal(f.owner.resources().restoreTickets,1);f.owner.invalidate();f.owner.destroy();assert.equal(f.owner.resources().restoreTickets,1);
  const response={status:'refused',diagnostic:{code:'fixture.stale_selection_epoch'}};resolve(response);assert.equal(await native.completion,response);await Promise.resolve();assert.equal(f.owner.resources().restoreTickets,0);assert.equal(f.calls.focus,0);assert.equal(f.calls.submit.length,1);assert.equal(f.calls.failures.length,0);
});
test('BM-A05 controlled focus listener can retarget after native no-op; old DOM setter is skipped',()=>{
  const f=fixture(),bookmark=f.capture();f.host.ownerDocument.activeElement={control:true};f.onFocus=()=>{f.owner.invalidate();f.setState('NATIVE_NEW_SELECTION');};const native=f.mutation();f.nextSubmit=()=>native;
  assert.equal(f.owner.api.restoreBookmark(bookmark,{focus:true}),native);assert.equal(f.calls.focus,1);assert.equal(f.calls.restore.length,0);assert.equal(f.calls.failures.at(-1).diagnostic.code,'dom.stale_selection');assert.deepEqual(f.state.selection,literals.states.NATIVE_NEW_SELECTION.selection);
});
test('BM-S07 controlled immutable context mismatch rejects before native maps',()=>{
  const f=fixture(),bookmark=f.capture();f.context=copy(literals.contexts.KWDJ_LOWER_CAPS);refusal(f.owner.api.restoreBookmark(bookmark,{policy:'mapped'}),'dom.stale_selection');assert.equal(f.calls.submit.length,0);
});
test('BM-S02/S03 controlled replace/destroy invalidation drops capabilities and keeps API stable',()=>{
  const f=fixture(),api=f.owner.api,bookmark=f.capture();f.owner.invalidate(true);refusal(api.restoreBookmark(bookmark),'dom.invalid_bookmark');const next=f.capture();f.owner.destroy();assert.equal(f.owner.api,api);refusal(api.restoreBookmark(next),'dom.disposed');assert.deepEqual(f.owner.resources(),{bookmarks:0,restoreTickets:0,activePointers:0,animationFrames:0});
});
