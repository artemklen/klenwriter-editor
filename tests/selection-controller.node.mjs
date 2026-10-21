// SPDX-License-Identifier: MIT OR Apache-2.0
// Controlled SDK/configuration boundary only; never a replacement Rust authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SelectionOwner} from '../packages/dom/dist/selection.js';
import {attachInput} from '../packages/dom/dist/input.js';
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

// Controlled browser event boundary: literal hit results and an SDK callback,
// without a browser layout engine or a substitute native selection validator.
function pointerFixture() {
  class OwnedNode extends EventTarget {constructor(parent=null){super();this.parentElement=parent;}contains(node){for(let p=node;p;p=p.parentElement)if(p===this)return true;return false;}}
  class OwnedElement extends OwnedNode {}
  const doc=new EventTarget(),win=new EventTarget(),host=new OwnedElement(),text=new OwnedNode(host);
  let hitOffset=0,busy=false,onFocus=null,state=copy(literals.states.BASE),context=copy(literals.contexts.KWDJ_A);
  const calls={submit:[],set:[],focus:[],failures:[],preventedOnFocus:[],hits:[]},frames=new Map();let frameId=0,currentMouse=null;
  Object.assign(win,{Node:OwnedNode,HTMLElement:OwnedElement,visualViewport:null,
    getComputedStyle:()=>({writingMode:'horizontal-tb',getPropertyValue:()=>'',scrollBehavior:'auto',transform:'none',perspective:'none',clipPath:'none',overflowX:'hidden',overflowY:'auto',borderTopLeftRadius:'0px',borderTopRightRadius:'0px',borderBottomLeftRadius:'0px',borderBottomRightRadius:'0px'}),
    requestAnimationFrame:fn=>{const id=++frameId;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id)});
  const range={anchorNode:text,anchorOffset:0,focusNode:text,focusOffset:0,
    setBaseAndExtent(a,ao,f,fo){calls.set.push([a,ao,f,fo]);this.anchorNode=a;this.anchorOffset=ao;this.focusNode=f;this.focusOffset=fo;doc.dispatchEvent(new Event('selectionchange'));}};
  Object.assign(host,{ownerDocument:doc,isConnected:true,clientLeft:0,clientTop:0,clientWidth:200,clientHeight:100,scrollWidth:200,scrollHeight:1000,scrollTop:0,
    getBoundingClientRect:()=>({left:0,top:0,right:200,bottom:100}),hasPointerCapture:()=>false,
    focus(){calls.focus.push(true);calls.preventedOnFocus.push(currentMouse?.defaultPrevented);doc.activeElement=host;onFocus?.();}});
  Object.assign(doc,{defaultView:win,activeElement:host,documentElement:host,scrollingElement:host,hasFocus:()=>true,getSelection:()=>range,
    caretPositionFromPoint:(x,y)=>{calls.hits.push([x,y]);return hitOffset===null?null:{offsetNode:text,offset:hitOffset};},
    createRange:()=>({setStart(){},collapse(){},getClientRects:()=>[{left:20,top:20,right:20,bottom:40,width:0,height:20}]})});
  const position=offset=>({kind:'text',node:state.selection.anchor.node,offset,affinity:'after'});
  const known=(offset,endpoint)=>endpoint.kind==='text'&&endpoint.offset===offset?copy(endpoint):position(offset);
  const view={textPosition:(node,offset)=>node===text&&Number.isInteger(offset)&&offset>=0&&offset<=4?position(offset):null,
    readSelection:()=>({anchor:known(range.anchorOffset,state.selection.anchor),focus:known(range.focusOffset,state.selection.focus)})};
  let owner;owner=new SelectionOwner({element:()=>host,view:()=>view,capture:()=>state.stamp,context:()=>context,guard:()=>null,busy:()=>busy,
    report:f=>calls.failures.push(f),recover:f=>calls.failures.push(f),read:request=>{assert.equal(request.kind,'state');return {status:'ok',value:{kind:'state',state}};},
    submit(request){calls.submit.push(copy(request));const frame=owner.beginSubmission(request,true),before=state.stamp,changed=!same(state.selection,request.selection);state={...state,selection:copy(request.selection)};if(changed){state={...state,stamp:{...state.stamp,selection_epoch:String(BigInt(state.stamp.selection_epoch)+1n)}};owner.publication({before,after:state.stamp,change:{kind:'state'}});}const response={status:'completed',response:{status:'ok',value:{kind:'mutation',effect:changed?'state_changed':'unchanged',state:copy(state),presentation:null}}};owner.endSubmission(frame,response);return response;}});
  owner.attach();
  function emit(type,values={}){const e=new Event(type,{cancelable:true});Object.defineProperty(e,'target',{value:host});Object.assign(e,{pointerId:7,pointerType:'mouse',isPrimary:true,button:0,buttons:1,clientX:20,clientY:30,detail:1,altKey:false,ctrlKey:false,metaKey:false,shiftKey:false,...values});if(type==='mousedown')currentMouse=e;doc.dispatchEvent(e);return e;}
  return {owner,host,doc,range,calls,frames,emit,get state(){return state;},set hit(v){hitOffset=v;},set onFocus(v){onFocus=v;},set busy(v){busy=v;},set context(v){context=v;},retargetStamp(){state={...state,stamp:{...state.stamp,selection_epoch:String(BigInt(state.stamp.selection_epoch)+1n)}};},claim(){emit('pointerdown');return emit('mousedown');},tick(){const pending=[...frames.values()];frames.clear();for(const fn of pending)fn();}};
}
test('controlled primary single-click claims before focus/default; quick move/up keeps the actual last hit and no post-end setter',()=>{
  const f=pointerFixture();f.emit('pointerdown');assert.equal(f.calls.submit.length,0);assert.equal(f.calls.set.length,0);
  const down=f.emit('mousedown');assert.equal(down.defaultPrevented,true);assert.deepEqual(f.calls.preventedOnFocus,[true]);assert.equal(f.owner.resources().activePointers,1);
  f.hit=3;f.emit('pointermove',{clientX:60});assert.equal(f.state.selection.anchor.offset,0);assert.equal(f.state.selection.focus.offset,3);assert.equal(f.frames.size,0);
  const atRelease=f.calls.set.length,publications=f.calls.submit.length;f.emit('pointerup',{buttons:0,clientX:60});f.tick();
  assert.equal(f.calls.set.length,atRelease);assert.equal(f.calls.submit.length,publications);assert.equal(f.state.selection.focus.offset,3);assert.equal(f.owner.resources().activePointers,0);assert.equal(f.owner.resources().animationFrames,0);f.owner.destroy();
});
test('controlled modifier/multiple-click fallback leaves UA default untouched and synchronizes its literal range without a custom drag',()=>{
  for(const properties of [{detail:2},{detail:3},{shiftKey:true},{ctrlKey:true},{altKey:true},{metaKey:true}]){
    const f=pointerFixture();f.emit('pointerdown');const down=f.emit('mousedown',properties);assert.equal(down.defaultPrevented,false);assert.equal(f.calls.focus.length,0);assert.equal(f.calls.set.length,0);assert.equal(f.owner.resources().activePointers,0);
    f.range.anchorOffset=4;f.range.focusOffset=1;f.doc.dispatchEvent(new Event('selectionchange'));
    assert.equal(f.state.selection.anchor.offset,4);assert.equal(f.state.selection.focus.offset,1);assert.equal(f.calls.submit.length,1);
    f.emit('pointermove',{clientY:120});assert.equal(f.frames.size,0);f.owner.destroy();
  }
});
test('controlled fractional compatibility coordinates hit the precise pointer; >=1 or nonfinite mismatches never claim',()=>{
  for(const [x,y,mx,my] of [[23.09375,41.75,23,41],[109.6,30.4,109,30]]){
    const f=pointerFixture();f.emit('pointerdown',{clientX:x,clientY:y});const down=f.emit('mousedown',{clientX:mx,clientY:my});
    assert.equal(down.defaultPrevented,true);assert.deepEqual(f.calls.hits,[[x,y]]);assert.equal(f.owner.resources().activePointers,1);f.owner.destroy();
  }
  for(const [x,y,mx,my] of [[20.5,30.5,21.5,30.5],[20.5,30.5,20.5,29.5],[20,30,NaN,30],[Infinity,30,20,30]]){
    const f=pointerFixture();f.emit('pointerdown',{clientX:x,clientY:y});const down=f.emit('mousedown',{clientX:mx,clientY:my});
    assert.equal(down.defaultPrevented,false);assert.equal(f.calls.hits.length,0);assert.equal(f.calls.focus.length,0);assert.equal(f.calls.set.length,0);assert.equal(f.calls.submit.length,0);assert.equal(f.owner.resources().activePointers,0);f.owner.destroy();
  }
});
test('controlled synchronous focus retargeting rejects a claimed gesture before its DOM/native range publication',()=>{
  for(const change of ['intent','context','stamp']){
    const f=pointerFixture();f.onFocus=()=>{if(change==='intent')f.owner.invalidate();else if(change==='context')f.context=copy(literals.contexts.KWDJ_LOWER_CAPS);else f.retargetStamp();};
    const down=f.claim();assert.equal(down.defaultPrevented,true);assert.equal(f.calls.set.length,0);assert.equal(f.calls.submit.length,0);assert.equal(f.owner.resources().activePointers,0);assert.equal(f.frames.size,0);f.owner.destroy();
  }
});
test('controlled owned selection publications retain a drag; foreign host mutation cancels its pending edge frame',()=>{
  const f=pointerFixture();f.hit=1;f.claim();assert.equal(f.owner.resources().activePointers,1);assert.equal(f.calls.submit.length,1);
  f.emit('pointermove',{clientY:120});assert.equal(f.frames.size,1);
  const frame=f.owner.beginSubmission({kind:'command',stamp:f.state.stamp,command:{id:'fixture.document-only',payload_json:'{}'},history_hint:{kind:'isolated'}},false);
  assert.equal(f.owner.resources().activePointers,0);assert.equal(f.frames.size,0);const top=f.host.scrollTop;f.tick();assert.equal(f.host.scrollTop,top);
  f.owner.endSubmission(frame,{status:'completed',response:{status:'ok',value:{kind:'mutation',effect:'unchanged',state:f.state,presentation:null}}});f.owner.destroy();
});

// Controlled event-order boundary only: this hub explicitly models trusted
// Window capture before document bubble, not browser/physical-input evidence.
function replacementSelectionFixture() {
  class Hub {
    handlers=new Map();
    addEventListener(type,fn,capture=false){const rows=this.handlers.get(type)??[];rows.push({fn,capture});this.handlers.set(type,rows);}
    removeEventListener(type,fn,capture=false){this.handlers.set(type,(this.handlers.get(type)??[]).filter(row=>row.fn!==fn||row.capture!==capture));}
    fire(type,event){for(const {fn} of [...(this.handlers.get(type)??[])])fn(event);}
    count(){return [...this.handlers.values()].reduce((n,rows)=>n+rows.length,0);}
  }
  class OwnedNode extends Hub {constructor(parent=null){super();this.parentElement=parent;}contains(node){for(let p=node;p;p=p.parentElement)if(p===this)return true;return false;}}
  const win=new Hub(),doc=new Hub(),host=new OwnedNode(),text=new OwnedNode(host),outside=new OwnedNode();win.Node=OwnedNode;
  let state=copy(literals.states.NULL),dom=null,busy=false,focused=true,rootFailure=false,setterOutcome=null;
  const calls={submit:[],restore:[],failures:[],read:[]};
  Object.assign(host,{ownerDocument:doc,focus(){doc.activeElement=host;}});
  Object.assign(doc,{defaultView:win,activeElement:host,hasFocus:()=>focused,getSelection:()=>({isCollapsed:true})});
  const at=offset=>({anchor:{kind:'text',node:literals.states.BASE.selection.anchor.node,offset,affinity:'after'},focus:{kind:'text',node:literals.states.BASE.selection.anchor.node,offset,affinity:'after'}});
  const view={readSelection:()=>dom,domPoint:()=>({node:text,offset:0}),hasProvisional:()=>false,restoreSelection(value){calls.restore.push(copy(value));dom=copy(value);return null;}};
  let owner;owner=new SelectionOwner({element:()=>host,view:()=>view,capture:()=>state.stamp,context:()=>literals.contexts.KWDJ_A,guard:()=>null,busy:()=>busy,
    report:value=>calls.failures.push(value),recover:value=>calls.failures.push(value),
    read(request){calls.read.push(copy(request));if(request.kind==='state')return {status:'ok',value:{kind:'state',state}};assert.equal(request.kind,'node');return rootFailure?{status:'refused',diagnostic:{code:'controlled.root_refused'}}:{status:'ok',value:{kind:'node',node:{children:['P','P2']}}};},
    submit(request){calls.submit.push(copy(request));if(setterOutcome)return setterOutcome;const frame=owner.beginSubmission(request,true),before=state.stamp,changed=!same(state.selection,request.selection);state={...state,selection:copy(request.selection)};if(changed){state={...state,stamp:{...state.stamp,selection_epoch:String(BigInt(state.stamp.selection_epoch)+1n)}};owner.publication({before,after:state.stamp,change:{kind:'state'}});}const result={status:'completed',response:{status:'ok',value:{kind:'mutation',effect:changed?'state_changed':'unchanged',state:copy(state),presentation:null}}};owner.endSubmission(frame,result);return result;}});
  owner.attach();
  function event(type,values={}){return {type,target:host,isTrusted:true,pointerId:7,pointerType:'mouse',isPrimary:true,button:0,buttons:1,clientX:20,clientY:30,detail:1,key:'',isComposing:false,altKey:false,ctrlKey:false,metaKey:false,shiftKey:false,cancelable:true,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...values};}
  function emit(type,values={},bubble=true){const e=event(type,values);win.fire(type,e);if(bubble)doc.fire(type,e);return e;}
  return {owner,win,doc,host,outside,view,calls,at,emit,get state(){return state;},set dom(value){dom=value;},set busy(value){busy=value;},set focused(value){focused=value;},set rootFailure(value){rootFailure=value;},set setterOutcome(value){setterOutcome=value;},
    held(values={}){emit('pointerdown',{target:outside,...values},false);},
    arm(){this.held();owner.viewReplaced();emit('pointerup',{target:outside,buttons:0},false);dom=at(0);},
    selectionchange(){doc.fire('selectionchange',event('selectionchange',{target:doc}));},
    destroyed(){owner.destroy();assert.equal(win.count()+doc.count(),0);assert.deepEqual(owner.resources(),{bookmarks:0,restoreTickets:0,activePointers:0,animationFrames:0});assert.deepEqual(calls.restore,[]);},
  };
}
test('replacement import boundary: held outside down is scalar-only; old terminal cannot import a fresh-view ghost caret',()=>{
  const f=replacementSelectionFixture(),serial=f.owner.intent();f.held();assert.equal(f.owner.intent(),serial);assert.equal(f.calls.submit.length,0);assert.equal(f.owner.resources().activePointers,0);
  f.owner.cancel();f.owner.invalidate(true);f.owner.viewReplaced();f.emit('pointerup',{target:f.outside,buttons:0},false);f.dom=f.at(0);f.selectionchange();
  assert.equal(f.state.selection,null);assert.equal(f.calls.submit.length,0);assert.equal(f.calls.read.length,0);f.destroyed();
});
test('replacement import boundary: no held owner, released/cancelled input and foreign or untrusted down retain normal automatic import',()=>{
  for(const kind of ['none','released','cancelled','untrusted','pen','nonprimary','foreign-focus','document-unfocused','new-foreign-down']){
    const f=replacementSelectionFixture();
    if(kind==='new-foreign-down')f.held();
    if(kind==='foreign-focus'||kind==='new-foreign-down')f.doc.activeElement=f.outside;if(kind==='document-unfocused')f.focused=false;
    if(kind!=='none')f.held(kind==='untrusted'?{isTrusted:false}:kind==='pen'?{pointerType:'pen'}:kind==='nonprimary'?{isPrimary:false}:{});
    if(kind==='released'||kind==='cancelled')f.emit(kind==='released'?'pointerup':'pointercancel',{target:f.outside,buttons:0},false);
    f.owner.viewReplaced();f.doc.activeElement=f.host;f.focused=true;f.dom=f.at(0);f.selectionchange();
    assert.deepEqual(f.state.selection,f.at(0),kind);assert.equal(f.calls.submit.length,1,kind);f.destroyed();
  }
});
test('replacement import boundary: lost capture and unrelated terminal do not stand in for the original physical up',()=>{
  for(const terminal of ['lostpointercapture','unrelated-up']){
    const f=replacementSelectionFixture();f.held();f.emit(terminal==='unrelated-up'?'pointerup':terminal,{target:f.outside,pointerId:terminal==='unrelated-up'?8:7,buttons:terminal==='unrelated-up'?0:1},false);
    f.owner.cancel();f.owner.viewReplaced();f.dom=f.at(0);f.selectionchange();assert.equal(f.state.selection,null);assert.equal(f.calls.submit.length,0);f.destroyed();
  }
});
test('replacement import boundary: another no-held replacement, focus, invalidation and pure bookmark capture never reopen an armed barrier',()=>{
  const f=replacementSelectionFixture();f.arm();f.owner.viewReplaced();f.owner.invalidate(true);f.emit('blur');
  f.doc.activeElement=f.outside;const bookmark=f.owner.api.captureBookmark();assert.equal(bookmark.status,'captured');assert.equal(f.owner.api.releaseBookmark(bookmark.bookmark),true);
  f.doc.activeElement=f.host;f.emit('focusin');f.selectionchange();assert.equal(f.state.selection,null);assert.equal(f.calls.submit.length,0);f.destroyed();
});
test('replacement import boundary: fresh guarded owned mouse down reopens native modified and multiple-click fallback',()=>{
  for(const properties of [{detail:2},{detail:3},{shiftKey:true},{ctrlKey:true},{altKey:true},{metaKey:true}]){
    const f=replacementSelectionFixture();f.arm();f.emit('pointerdown');const down=f.emit('mousedown',properties);assert.equal(down.defaultPrevented,false);assert.equal(f.owner.resources().activePointers,0);
    f.dom=f.at(1);f.selectionchange();assert.deepEqual(f.state.selection,f.at(1));assert.equal(f.calls.submit.length,1);f.destroyed();
  }
  for(const kind of ['busy','foreign','untrusted','prevented']){
    const f=replacementSelectionFixture();f.arm();if(kind==='busy')f.busy=true;
    f.emit('pointerdown',kind==='foreign'?{target:f.outside}:kind==='untrusted'?{isTrusted:false}:kind==='prevented'?{defaultPrevented:true}:{});f.emit('pointerup',{buttons:0});f.busy=false;
    f.selectionchange();assert.equal(f.state.selection,null,kind);assert.equal(f.calls.submit.length,0,kind);f.destroyed();
  }
});
test('replacement import boundary: only guarded focused selection navigation reopens automatic import',()=>{
  for(const key of ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown']){
    const f=replacementSelectionFixture();f.arm();f.emit('keydown',{key,shiftKey:true});f.dom=f.at(1);f.selectionchange();assert.deepEqual(f.state.selection,f.at(1),key);assert.equal(f.calls.submit.length,1);f.destroyed();
  }
  for(const values of [{key:'Tab'},{key:'Escape'},{key:'Enter'},{key:'Backspace'},{key:'Delete'},{key:'f',metaKey:true},{key:'Shift'},{key:'ArrowRight',isComposing:true},{key:'ArrowRight',isTrusted:false},{key:'ArrowRight',defaultPrevented:true},{key:'ArrowRight',foreign:true},{key:'ArrowRight',focusOutside:true},{key:'ArrowRight',documentUnfocused:true},{key:'ArrowRight',busy:true}]){
    const f=replacementSelectionFixture();f.arm();f.busy=!!values.busy;if(values.focusOutside)f.doc.activeElement=f.outside;if(values.documentUnfocused)f.focused=false;
    f.emit('keydown',{...values,...(values.foreign?{target:f.outside}:{})});f.busy=false;f.doc.activeElement=f.host;f.focused=true;f.selectionchange();assert.equal(f.state.selection,null,JSON.stringify(values));assert.equal(f.calls.submit.length,0);f.destroyed();
  }
});
test('replacement import boundary: valid fresh-input sync reopens; null, refusal or busy sync does not; explicit sync remains usable',()=>{
  for(const kind of ['null','refused','busy']){
    const f=replacementSelectionFixture();f.arm();f.dom=kind==='null'?null:kind==='refused'?{status:'dom_refused',diagnostic:{code:'dom.stale_selection',phase:'selection'}}:f.at(0);f.busy=kind==='busy';
    f.owner.syncFromDom(true);f.busy=false;f.dom=f.at(0);f.selectionchange();assert.equal(f.state.selection,null,kind);assert.equal(f.calls.submit.length,0);f.destroyed();
  }
  const f=replacementSelectionFixture();f.arm();assert.deepEqual(f.owner.syncFromDom(true),f.at(0));f.dom=f.at(1);f.selectionchange();assert.deepEqual(f.state.selection,f.at(1));assert.equal(f.calls.submit.length,2);f.destroyed();
  const explicit=replacementSelectionFixture();explicit.arm();assert.deepEqual(explicit.owner.syncFromDom(),explicit.at(0));explicit.dom=explicit.at(1);explicit.selectionchange();assert.deepEqual(explicit.state.selection,explicit.at(0));assert.equal(explicit.calls.submit.length,1);explicit.destroyed();
});
test('replacement import boundary: refused, queued or non-ok fresh range publication never reopens automatic import',()=>{
  const refused={status:'dom_refused',diagnostic:{code:'dom.busy',phase:'selection'}},response={status:'refused',diagnostic:{code:'controlled.selection_refused'}};
  for(const outcome of [refused,{status:'queued',completion:Promise.resolve(response)},{status:'completed',response}]){
    const f=replacementSelectionFixture();f.arm();f.setterOutcome=outcome;const result=f.owner.syncFromDom(true);
    if(outcome===refused)assert.equal(result,refused);else refusal(result,'dom.busy');
    assert.equal(f.calls.submit.length,1);assert.equal(f.state.selection,null);f.setterOutcome=null;f.dom=f.at(1);f.selectionchange();assert.equal(f.calls.submit.length,1);assert.equal(f.state.selection,null);f.destroyed();
  }
});
test('replacement import boundary: select-all still dispatches directly without reopening automatic import',()=>{
  for(const rootFailure of [false,true]){
    const f=replacementSelectionFixture();f.arm();f.rootFailure=rootFailure;f.emit('keydown',{key:'a',metaKey:true});
    if(rootFailure){f.selectionchange();assert.equal(f.state.selection,null);assert.equal(f.calls.submit.length,0);}
    else{const selected={anchor:{kind:'child',parent:f.state.root,index:0,affinity:'after'},focus:{kind:'child',parent:f.state.root,index:2,affinity:'after'}};assert.deepEqual(f.state.selection,selected);f.dom=f.at(1);f.selectionchange();assert.deepEqual(f.state.selection,selected);assert.equal(f.calls.submit.length,1);}
    f.destroyed();
  }
});

function replacementInput(f,mode){
  return attachInput({element:f.host,view:f.view,selection:f.owner,bindings:{insertText:()=>null},canEdit:()=>mode!=='mode-blocked',canSelect:()=>true,busy:()=>mode==='busy',
    capture:()=>f.state.stamp,context:()=>literals.contexts.KWDJ_A,readState:()=>f.state,
    submit(){assert.fail('This controlled entry-boundary probe has no command capability');},submitComposition(){assert.fail('No composition commit in this controlled probe');},
    report:value=>f.calls.failures.push(value),recover:value=>f.calls.failures.push(value),composing(){assert.fail('No provisional generation is admitted');},consumeRecords:()=>0});
}
test('replacement import boundary: actual ordinary-beforeinput entry preserves pre-sync guards and valid-range synchronization before unsupported-command refusal',()=>{
  for(const mode of ['mode-blocked','busy','range-missing','valid']){
    const f=replacementSelectionFixture();f.arm();if(mode==='range-missing')f.dom=null;
    const input=replacementInput(f,mode),event={type:'beforeinput',target:f.host,inputType:'insertText',data:'x',isComposing:false,cancelable:true,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};
    f.host.fire('beforeinput',event);assert.equal(event.defaultPrevented,true);assert.equal(f.calls.submit.length,mode==='valid'?1:0,mode);
    f.dom=f.at(1);f.selectionchange();assert.equal(f.calls.submit.length,mode==='valid'?2:0,mode);assert.deepEqual(f.state.selection,mode==='valid'?f.at(1):null,mode);
    input.destroy();assert.equal(input.listeners(),0);f.destroyed();
  }
});
test('replacement import boundary: actual composition-start entry uses fresh sync only after its guards and before provisional capture [controlled capture stop]',()=>{
  for(const mode of ['mode-blocked','busy','range-missing','valid']){
    const f=replacementSelectionFixture();f.arm();if(mode==='range-missing')f.dom=null;
    let captures=0;const stop=new Error('controlled.stop-before-provisional');f.view.beginComposition=()=>{captures++;throw stop;};
    const input=replacementInput(f,mode),event={type:'compositionstart',target:f.host,data:'',cancelable:true,defaultPrevented:false};
    if(mode==='valid')assert.throws(()=>f.host.fire('compositionstart',event),error=>error===stop);else f.host.fire('compositionstart',event);
    assert.equal(captures,mode==='valid'?1:0,mode);assert.equal(f.calls.submit.length,mode==='valid'?1:0,mode);
    f.dom=f.at(1);f.selectionchange();assert.equal(f.calls.submit.length,mode==='valid'?2:0,mode);assert.deepEqual(f.state.selection,mode==='valid'?f.at(1):null,mode);
    input.destroy();assert.equal(input.listeners(),0);f.destroyed();
  }
});
