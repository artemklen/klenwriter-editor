// SPDX-License-Identifier: MIT OR Apache-2.0
// Actual private owners with controlled native/view/event doubles; not browser/OS/native semantics evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { InputObservationOwner } from '../packages/dom/dist/input-observations.js';
import { attachInput } from '../packages/dom/dist/input.js';
const clone=x=>structuredClone(x);
const point=offset=>({kind:'text',node:'T',offset,affinity:'after'});
const context={build_id:'controlled',profile:{profile_id:'controlled'},registry_digest:'R',capability_digest:'C'};
function fixture(){
  let state={stamp:{session:'s',generation:'1',revision:'0',selection_epoch:'1',history_epoch:'0'},selection:{anchor:point(1),focus:point(1)}};
  let guard=null,windowFailure=false,reads=0,hook=()=>{},corresponds=true;
  const owner=new InputObservationOwner({guard:()=>guard,capture:()=>clone(state.stamp),context:()=>clone(context),state:()=>clone(state),corresponds:()=>corresponds,window(stamp){reads++;hook();return windowFailure?{status:'refused',diagnostic:{code:'text_window.source_scan_limit'}}:{status:'ok',value:{kind:'text_window',stamp:clone(stamp),selection:clone(state.selection),caret:point(1),block:{node:'P',type_id:'paragraph',primitive:'text_block'},ancestors:[],before:[{node:'T',from_utf16:0,to_utf16:1,text:'a'}],after:[],before_stop:'block',after_stop:'window_limit'}};}});
  const input={inputType:'insertText',data:'/',isTrusted:false};
  function result(effect='changed'){state={...state,stamp:{...state.stamp,revision:'1'},selection:{anchor:point(2),focus:point(2)}};return {status:'completed',response:{status:'ok',value:{kind:'mutation',effect,state:clone(state)}}};}
  const request={kind:'command',stamp:state.stamp,command:{id:'literal',payload_json:'{}'},history_hint:{kind:'isolated'}};
  return {owner,input,request,result,reads:()=>reads,state:()=>state,setGuard:x=>guard=x,setWindowFailure:()=>windowFailure=true,setCorrespondence:x=>corresponds=x,hook:x=>hook=x};
}
test('O01/O13 actual owner observes fresh changed ordinary mutation with native before witness and trust unchanged',()=>{
  const f=fixture(),seen=[];f.owner.api.subscribe(x=>seen.push(x));const capture=f.owner.before(f.input);
  const result=f.owner.submission(capture,f.request,()=>{f.owner.forward(f.request);return f.result();});f.owner.after(capture,result);
  assert.equal(seen.length,1);assert.equal(seen[0].isTrusted,false);assert.equal(seen[0].dataHint,'/');assert.equal(seen[0].beforeWindow.before[0].text,'a');
  assert.deepEqual(seen[0].selectionBefore,{anchor:point(1),focus:point(1)});assert.deepEqual(seen[0].selectionAfter,{anchor:point(2),focus:point(2)});assert.equal(seen[0].before.revision,'0');assert.equal(seen[0].after.revision,'1');assert(Object.isFrozen(seen[0]));
});
test('O05–O08 queued/refused/fatal/unchanged/state-only do not notify or install completion replay',()=>{
  for(const kind of ['queued','refused','fatal','unchanged','state_changed']){const f=fixture(),seen=[];f.owner.api.subscribe(x=>seen.push(x));const capture=f.owner.before(f.input);let thenCalls=0;
    const result=kind==='queued'?{status:'queued',completion:{then(){thenCalls++;}}}:kind==='refused'||kind==='fatal'?{status:'completed',response:{status:kind}}:f.result(kind);
    f.owner.after(capture,result);assert.equal(seen.length,0,kind);assert.equal(thenCalls,0,kind);}
});
test('O10 reentrant dispatch attempt invalidates witness even if stamp remains unchanged',()=>{
  const f=fixture(),seen=[];f.owner.api.subscribe(x=>seen.push(x));const capture=f.owner.before(f.input);
  const result=f.owner.submission(capture,f.request,()=>{f.owner.forward(f.request);f.owner.forward({...f.request});return f.result();});f.owner.after(capture,result);assert.equal(seen.length,0);
});
test('O11 before native read refusal is a null witness; oversized hints are null and no subscribers means no read',()=>{
  const f=fixture();assert.equal(f.owner.before(f.input),null);assert.equal(f.reads(),0);f.owner.api.subscribe(()=>{});f.setWindowFailure();
  const captured=f.owner.before({...f.input,data:'x'.repeat(257)});assert.equal(captured.event.beforeWindow,null);assert.equal(captured.event.dataHint,null);assert.equal(f.reads(),1);
});
test('observer snapshot, unsubscribe, exceptions, destroy and cap32 are synchronous and bounded',()=>{
  const f=fixture(),seen=[];let removeB;f.owner.api.subscribe(()=>{seen.push('a');removeB();f.owner.api.subscribe(()=>seen.push('late'));throw Error('observer');});removeB=f.owner.api.subscribe(()=>seen.push('b'));
  const capture=f.owner.before(f.input);f.owner.after(capture,f.result());assert.deepEqual(seen,['a']);
  const cap=fixture(),removes=[];for(let i=0;i<32;i++)removes.push(cap.owner.api.subscribe(()=>{}));assert.equal(cap.owner.api.subscribe(()=>{}).diagnostic.code,'dom.busy');removes[0]();removes[0]();assert.equal(cap.owner.resources().subscribers,31);cap.owner.destroy();assert.equal(cap.owner.resources().subscribers,0);assert.equal(cap.owner.api.subscribe(()=>{}).diagnostic.code,'dom.disposed');
  const d=fixture(),calls=[];d.owner.api.subscribe(()=>{calls.push(1);d.owner.destroy();});d.owner.api.subscribe(()=>calls.push(2));const c=d.owner.before(d.input);d.owner.after(c,d.result());assert.deepEqual(calls,[1]);
});
test('stale capture/read callback and first subscriber invalidation suppress remaining stale delivery',()=>{
  const f=fixture(),seen=[];f.owner.api.subscribe(()=>{seen.push(1);f.owner.invalidate();});f.owner.api.subscribe(()=>seen.push(2));const capture=f.owner.before(f.input);f.owner.after(capture,f.result());assert.deepEqual(seen,[1]);
  const g=fixture();g.owner.api.subscribe(()=>{});g.hook(()=>g.owner.invalidate());assert.equal(g.owner.before(g.input),null);
  const h=fixture(),events=[];h.owner.api.subscribe(x=>events.push(x));const c=h.owner.before(h.input);h.setCorrespondence(false);h.owner.after(c,h.result());assert.equal(events.length,0);
});
function inputHarness(){
  let native='a',live='a',provisional=false,serial=0n,intentListener=null,time=0,ids=0;const rafs=new Map(),timers=new Map();
  let state={stamp:{session:'s',generation:'1',revision:'0',selection_epoch:'1',history_epoch:'0'},selection:{anchor:point(1),focus:point(1)}};
  const calls=[],events=[],recoveries=[],notifications=[];
  const text={nodeType:3,childNodes:[],get data(){return live;}};
  const block={nodeType:1,childNodes:[text],parentNode:null,previousSibling:null,nextSibling:null,contains:n=>n===block||n===text};
  const element=new EventTarget();element.childNodes=[block];element.contains=n=>[element,block,text].includes(n);block.parentNode=element;text.parentNode=block;
  const browser={isCollapsed:true,anchorNode:text,focusNode:text,anchorOffset:1,focusOffset:1};
  element.ownerDocument={getSelection:()=>browser,defaultView:{performance:{now:()=>time},requestAnimationFrame:f=>{const id=++ids;rafs.set(id,f);return id;},cancelAnimationFrame:id=>rafs.delete(id),setTimeout:f=>{const id=++ids;timers.set(id,f);return id;},clearTimeout:id=>timers.delete(id)}};
  const selection={syncFromDom:()=>clone(state.selection),intent:()=>serial,intentAvailable:()=>true,ownsFocus:()=>true,cancel(){},invalidate(_clear=false,event=null){const before=serial++;intentListener?.(before,serial,event);},observeInputIntent(fn){intentListener=fn;return()=>{intentListener=null;};}};
  const region=()=>({kind:'bounded',stamp:clone(state.stamp),originalText:native,provisionalText:live,affectedNodeIds:['P']});
  const view={hasProvisional:()=>provisional,readSelection:()=>clone(state.selection),domPoint:p=>({node:text,offset:p.offset}),ownedBlockAt:n=>n===text||n===block?'P':null,
    captureBlocks:()=>({blocks:[{id:'P',element:block,originalText:native}],stamp:clone(state.stamp)}),beginProvisional(){provisional=true;return null;},endProvisional(){provisional=false;},boundedText:()=>live,captureRegion:region,
    beginComposition(stamp,range){provisional=true;return {stamp,selection:range,originalRegion:region(),affectedNodeIds:['P']};},observeComposition:window=>({region:region(),unchanged:live===window.originalRegion.provisionalText,replacement:live,fingerprint:live}),
    restoreComposition(){live=native;return null;},restoreSelection:()=>null,captureComposition:region,setComposing(){},};
  const observation=new InputObservationOwner({guard:()=>null,capture:()=>clone(state.stamp),context:()=>context,state:()=>clone(state),corresponds:()=>true,window:stamp=>{calls.push('before-window');return {status:'refused',diagnostic:{code:'text_window.source_scan_limit'}};}});observation.api.subscribe(x=>notifications.push(x));
  function dispatch(request,origin){calls.push(origin);selection.invalidate();native=origin==='ordinary-delete-mismatch'?'wrong':live==='a'?'a/':live;live=native;state={...state,stamp:{...state.stamp,revision:String(+state.stamp.revision+1)},selection:{anchor:point(native.length),focus:point(native.length)}};return {status:'completed',response:{status:'ok',value:{kind:'mutation',effect:'changed',state:clone(state)}}};}
  let mode='ordinary';const owner=attachInput({element,view,selection,bindings:{insertText:data=>{calls.push('factory');return{id:'literal',payload_json:JSON.stringify({text:data})};},deleteBackward:()=>({id:'delete',payload_json:'{}'})},canEdit:()=>true,canSelect:()=>true,busy:()=>false,capture:()=>clone(state.stamp),context:()=>context,readState:()=>clone(state),
    beforeObservation:e=>observation.before(e),afterObservation:(c,r)=>observation.after(c,r),submit:(r,c)=>observation.submission(c,r,()=>{observation.forward(r);return dispatch(r,mode);}),submitComposition:r=>dispatch(r,'composition'),report:f=>events.push(f),recover:f=>recoveries.push(f),composing(){},consumeRecords:()=>0});
  function fire(type,properties={}){const e=new Event(type,{cancelable:properties.cancelable??true});for(const [key,value]of Object.entries({inputType:'',data:null,isComposing:false,key:'',code:'',keyCode:0,repeat:false,shiftKey:false,ctrlKey:false,altKey:false,metaKey:false,...properties}))if(key!=='cancelable')Object.defineProperty(e,key,{value});element.dispatchEvent(e);return e;}
  return {owner,notifications,calls,recoveries,fire,live:x=>live=x,mode:x=>mode=x,raf(){time+=16;const fs=[...rafs.values()];rafs.clear();fs.forEach(f=>f(time));}};
}
test('O01 real attachInput captures before factory and notifies only after ordinary completed dispatch',()=>{
  const f=inputHarness();f.fire('beforeinput',{inputType:'insertText',data:'/'});assert.equal(f.notifications.length,1);assert(f.calls.indexOf('before-window')<f.calls.indexOf('factory'));assert.equal(f.calls.filter(x=>x==='ordinary').length,1);f.owner.destroy();
});
test('O03 real noncancelable Pending retains witness until all correspondence checks finish',()=>{
  const f=inputHarness();f.fire('beforeinput',{inputType:'insertText',data:'/',cancelable:false});assert.equal(f.notifications.length,0);f.live('a/');f.fire('input',{inputType:'insertText',data:'/',cancelable:false});assert.equal(f.notifications.length,1);assert.equal(f.notifications[0].before.revision,'0');assert.equal(f.calls.filter(x=>x==='ordinary').length,1);assert.equal(f.recoveries.length,0);f.owner.destroy();
});
test('O09 post-submit deletion mismatch keeps recovery and suppresses ordinary notification',()=>{
  const f=inputHarness();f.mode('ordinary-delete-mismatch');f.fire('beforeinput',{inputType:'deleteContentBackward',cancelable:false});f.live('');f.fire('input',{inputType:'deleteContentBackward',cancelable:false});assert.equal(f.recoveries.length,1);assert.equal(f.notifications.length,0);f.owner.destroy();
});
for(const cancelable of [true,false])test(`O02/O04 actual CompositionOwner fresh slash cancelable=${cancelable}: no ordinary observation`,()=>{
  const f=inputHarness();f.fire('compositionstart');f.fire('compositionend');f.raf();f.raf();f.fire('keydown',{key:'/',code:'Slash'});f.fire('beforeinput',{inputType:'insertText',data:'/',cancelable});
  assert.equal(f.notifications.length,0);assert.equal(f.calls.filter(x=>x==='ordinary').length,0);
  assert.equal(f.calls.filter(x=>x==='composition').length,cancelable?1:0);assert.equal(f.recoveries.length,cancelable?0:1);f.owner.destroy();
});
