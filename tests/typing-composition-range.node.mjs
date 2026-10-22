// SPDX-License-Identifier: MIT OR Apache-2.0
// Source-first finite range controls: actual CompositionOwner, controlled native,
// view and scheduler doubles. Not browser range, native-rule or OS input evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CompositionOwner} from '../packages/dom/dist/composition.js';

const clone=value=>structuredClone(value);
const point=(offset,node='text-1')=>({kind:'text',node,offset,affinity:'after'});
const caret=offset=>({anchor:point(offset),focus:point(offset)});
const stamp=(revision,selectionEpoch)=>({session:'controlled-range-1',generation:'1',revision:String(revision),selection_epoch:String(selectionEpoch),history_epoch:String(revision)});
function harness({kind='quote',typing=true,resultMode='changed',joined=true,regionFailure=false,afterStampMismatch=false}={}){
  const source=kind==='nbsp'?'а ':'a ',raw=source+(kind==='nbsp'?'я':'"');
  const cooked=resultMode==='null'||!typing?raw:kind==='nbsp'?'а\u00a0я':'a «';
  const originalStamp=stamp(0,1),publishedStamp=stamp(1,2),initialContext={build_id:'controlled-range-build',profile:{},registry_digest:'registry',capability_digest:'capability'};
  let context=clone(initialContext),state={stamp:originalStamp,root:'root-1',selection:caret(2),stored_marks:null,dirty:false,saved_revision:'0',history:{undo_entries:'0',redo_entries:'0',retained_bytes:'0'}};
  let text=source,serial=0n,listener=null,time=0,next=0,sourceWindow=null,acceptedWindow=null,actualResponse=null;
  const rafs=new Map(),timers=new Map(),packets=[],dispatches=[],ordinary=[],regionChecks=[];
  const textNode={nodeType:3},otherNode={nodeType:3};
  const browser={isCollapsed:true,anchorNode:textNode,focusNode:textNode,anchorOffset:2,focusOffset:2};
  const win={performance:{now:()=>time},requestAnimationFrame:fn=>{const id=++next;rafs.set(id,fn);return id;},cancelAnimationFrame:id=>rafs.delete(id),
    setTimeout:(fn,delay)=>{const id=++next;timers.set(id,{fn,at:time+delay});return id;},clearTimeout:id=>timers.delete(id)};
  const element={ownerDocument:{defaultView:win,getSelection:()=>browser},contains:node=>node===element||node===textNode||node===otherNode};
  const selection={intent:()=>serial,intentAvailable:()=>true,ownsFocus:()=>true,cancel:()=>{},syncFromDom:()=>clone(state.selection),
    invalidate(_clear=false,event=null){const before=serial;serial++;listener?.(before,serial,event);},observeInputIntent(fn){listener=fn;return()=>{listener=null;};}};
  const region=(base,original,provisional)=>Object.freeze({kind:'bounded',stamp:clone(base),originalText:original,provisionalText:provisional,affectedNodeIds:Object.freeze(['block-1'])});
  const makeWindow=(base,selection,original)=>Object.freeze({stamp:clone(base),selection:clone(selection),entries:Object.freeze([{id:'block-1'}]),parent:element,before:null,after:null,
    anchor:{node:textNode,offset:selection.anchor.offset},focus:{node:textNode,offset:selection.focus.offset},selectedAtomIds:Object.freeze([]),affectedNodeIds:Object.freeze(['block-1']),originalRegion:region(base,original,original)});
  const refusal=()=>({status:'dom_refused',diagnostic:{code:'dom.stale_selection',phase:'command',stamp:clone(state.stamp),publication:'none',node:null,typeId:null}});
  const view={beginComposition(base,selected){const window=makeWindow(base,selected,text);if(sourceWindow===null)sourceWindow=window;return window;},
    observeComposition(window){return {region:region(window.stamp,window.originalRegion.originalText,text),unchanged:text===window.originalRegion.originalText,
      replacement:window===sourceWindow?text.slice(2):'',fingerprint:`actual:${text}`};},
    restoreComposition(window){text=window.originalRegion.originalText;return null;},setComposing:()=>{},endProvisional:()=>{},restoreSelection:()=>null,
    readSelection:()=>clone(state.selection),captureComposition:window=>region(window.stamp,window.originalRegion.originalText,text),captureRegion:()=>region(state.stamp,text,text),
    textPosition(node,offset){if(node===textNode&&Number.isSafeInteger(offset)&&offset>=0&&offset<=text.length)return point(offset);if(node===otherNode)return point(offset,'text-other');return null;},
    checkInputRegion(value,base){regionChecks.push({region:clone(value),stamp:clone(base)});return regionFailure?refusal():null;}};
  let owner;
  const inputResult=()=>{
    const from=kind==='nbsp'?1:2,cookedRegion={block:'block-1',range:{anchor:point(from),focus:point(3)},spans:[{node:'text-1',from_utf16:from,to_utf16:3,type_id:'org.klenwriter.kwdj/text',attributes:{},marks:[],text:cooked.slice(from)}]};
    return {kind:'text_replacement',before_stamp:clone(originalStamp),after_stamp:afterStampMismatch?stamp(0,1):clone(publishedStamp),
      original:{origin:'composition_commit',selection:caret(2),text:kind==='nbsp'?'я':'"'},before:{block:'block-1',range:{anchor:point(from),focus:point(2)}},after:cookedRegion,
      after_selection:caret(3),after_stored_marks:null,raw_restore:kind==='nbsp'?null:{format_id:'org.klenwriter.editor/raw-input-restore/1',stamp:clone(publishedStamp),selection:caret(3),stored_marks:null,
        cooked:clone(cookedRegion),raw:[{type_id:'org.klenwriter.kwdj/text',attributes:{},marks:[],text:'"'}],raw_caret_utf16:1,raw_stored_marks:null}};
  };
  function publish(request){dispatches.push(request);selection.invalidate();text=cooked;
    state={...state,stamp:clone(publishedStamp),selection:caret(3),dirty:true,history:{undo_entries:'1',redo_entries:'0',retained_bytes:'100'}};browser.anchorOffset=browser.focusOffset=3;
    acceptedWindow=makeWindow(publishedStamp,state.selection,cooked);
    actualResponse={status:'ok',value:resultMode==='query'?{kind:'availability',available:true,effect:'changed',presentation:null,diagnostic:null}
      :{kind:typing?'input_mutation':'mutation',effect:'changed',state:clone(state),presentation:null,...(typing?{result:resultMode==='null'?null:inputResult()}: {})}};
    return {status:'completed',response:actualResponse};
  }
  const typed=typing?{enabled:()=>true,prepare(value,origin,window){assert.equal(value,kind==='nbsp'?'я':'"');assert.equal(origin,'composition_commit');assert.equal(window,sourceWindow);return {command:{id:'typed',payload_json:'{}'}};},
    dispatch:(prepared,submit)=>submit({kind:'input_command',stamp:clone(originalStamp),command:prepared.command}),joined:response=>{assert.equal(response,actualResponse);return joined?acceptedWindow:null;},arm:()=>{},retire:()=>{}}:undefined;
  owner=new CompositionOwner({element,view,selection,bindings:{insertText:()=>({id:'literal',payload_json:'{}'})},typed,canEdit:()=>true,busy:()=>false,
    capture:()=>clone(state.stamp),context:()=>clone(context),readState:()=>clone(state),submit:publish,submitInput:publish,
    ordinary(event){event.preventDefault();selection.invalidate(false,event);ordinary.push(event);text=kind==='nbsp'?'а\u00a0':'a "';
      state={...state,stamp:stamp(2,kind==='nbsp'?3:2),selection:caret(kind==='nbsp'?2:3),history:{undo_entries:'2',redo_entries:'0',retained_bytes:'200'}};browser.anchorOffset=browser.focusOffset=state.selection.focus.offset;
      return {status:'completed',response:{status:'ok',value:{kind:kind==='nbsp'||!typing?'mutation':'input_mutation',effect:'changed',state:clone(state),presentation:null,...(kind==='nbsp'||!typing?{}:{result:null})}}};},
    report:()=>{},recover:(failure,actualRegion,composition)=>packets.push({failure,region:actualRegion,composition}),composing:()=>{},consumeRecords:()=>0});
  const event=(type,extra={})=>({type,target:element,cancelable:true,defaultPrevented:false,isComposing:false,inputType:'',data:null,key:'',code:'',keyCode:0,
    shiftKey:false,altKey:false,ctrlKey:false,metaKey:false,repeat:false,getTargetRanges:()=>[],preventDefault(){this.defaultPrevented=true;},...extra});
  const api={owner,packets,ordinary,dispatches,regionChecks,textNode,otherNode,state:()=>clone(state),text:()=>text,sourceWindow:()=>sourceWindow,
    commit(){owner.start(event('compositionstart'));text=raw;browser.anchorOffset=browser.focusOffset=3;owner.end(event('compositionend',{data:'not authority'}));
      for(let i=0;i<2;i++){time+=16;const pending=[...rafs.values()];rafs.clear();for(const fn of pending)fn(time);}},
    range(start=2,end=3,node=textNode){return {startContainer:node,startOffset:start,endContainer:textNode,endOffset:end};},
    backspace(ranges,{shift=false}={}){owner.keydown(event('keydown',{key:'Backspace',code:'Backspace',shiftKey:shift}));const input=event('beforeinput',{inputType:'deleteContentBackward',getTargetRanges:()=>ranges});owner.beforeInput(input);return input;},
    foreign(){selection.invalidate(false,event('pointerdown'));},stale(){state={...state,stamp:{...state.stamp,revision:'2'}};},foreignContext(){context={...context,capability_digest:'foreign'};},
    close(){owner.destroy();assert.equal(listener,null);assert.equal(rafs.size,0);assert.equal(timers.size,0);assert.deepEqual(owner.resources(),{continuations:0,retainedInputBytes:0,retainedRecoveryRegions:0});}};
  return api;
}
for(const kind of ['quote','nbsp'])test(`typed composition range controlled: checked native ${kind} cooked span admits one actual-shaped Backspace range`,()=>{
  const h=harness({kind});h.commit();assert.equal(h.packets.length,0);const before=h.state(),source=h.sourceWindow();
  const input=h.backspace([h.range()]);assert.equal(input.defaultPrevented,true);assert.equal(h.ordinary.length,1);assert.equal(h.dispatches.length,1);assert.equal(h.packets.length,0);
  assert.equal(h.text(),kind==='nbsp'?'а\u00a0':'a "');assert.deepEqual(h.state().stamp,stamp(2,kind==='nbsp'?3:2));assert.equal(h.state().history.undo_entries,'2');
  assert(h.regionChecks.length>0);assert.deepEqual(h.regionChecks[0].stamp,before.stamp);assert.equal(h.regionChecks[0].region.spans[0].text,kind==='nbsp'?'\u00a0я':'«');
  assert.equal(source.originalRegion.originalText,kind==='nbsp'?'а ':'a ');assert.equal(source.stamp.revision,'0');h.close();
});
const negativeCases=[
  {name:'range begins outside cooked span',ranges:h=>[h.range(1)]},
  {name:'range begins in another owned leaf',ranges:h=>[h.range(0,3,h.otherNode)]},
  {name:'multiple actual ranges',ranges:h=>[h.range(),h.range()]},
  {name:'range ends before accepted caret',ranges:h=>[h.range(2,2)]},
  {name:'result null supplies no cooked authority',options:{resultMode:'null'},ranges:h=>[h.range()]},
  {name:'query availability cannot become a result frame',options:{resultMode:'query'},earlyReason:'native_unknown'},
  {name:'missing joined result window refuses adoption',options:{joined:false},earlyReason:'native_unknown'},
  {name:'foreign private intent',before:h=>h.foreign(),ranges:h=>[h.range()]},
  {name:'stale native revision',before:h=>h.stale(),ranges:h=>[h.range()]},
  {name:'changed immutable context',before:h=>h.foreignContext(),ranges:h=>[h.range()]},
  {name:'fresh native region correspondence refused',options:{regionFailure:true},ranges:h=>[h.range()]},
  {name:'native result after stamp differs',options:{afterStampMismatch:true},ranges:h=>[h.range()]},
  {name:'modified Backspace cannot use the narrow permit',ranges:h=>[h.range()],key:{shift:true}},
  {name:'legacy noncollapsed range stays refused',options:{typing:false},ranges:h=>[h.range()]},
];
for(const row of negativeCases)test(`typed composition range controlled refusal: ${row.name}`,()=>{
  const h=harness(row.options);h.commit();if(!row.earlyReason){assert.equal(h.packets.length,0);row.before?.(h);const before=h.state(),text=h.text();h.backspace(row.ranges(h),row.key);assert.deepEqual(h.state(),before);assert.equal(h.text(),text);}
  assert.equal(h.dispatches.length,1);assert.equal(h.ordinary.length,0);assert.equal(h.packets.length,1);assert.equal(h.packets[0].composition.reason,row.earlyReason??'ambiguous_tail');h.close();
});
test('typed composition range controlled legacy: empty getTargetRanges keeps the original41 ordinary permit',()=>{
  const h=harness({typing:false});h.commit();h.backspace([]);assert.equal(h.ordinary.length,1);assert.equal(h.packets.length,0);assert.equal(h.regionChecks.length,0);h.close();
});
