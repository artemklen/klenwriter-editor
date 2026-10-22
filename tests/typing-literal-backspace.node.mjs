// SPDX-License-Identifier: MIT OR Apache-2.0
// Source-first actual InputResultOwner + CompositionOwner controls, with
// explicitly controlled native/view/scheduler doubles. No OS/browser claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {InputResultOwner} from '../packages/dom/dist/input-result.js';
import {CompositionOwner} from '../packages/dom/dist/composition.js';
import {verifyLiteralComposition} from '../packages/dom/dist/composition-literal.js';
const clone=value=>structuredClone(value);
const point=(node,offset)=>({kind:'text',node,offset,affinity:'after'});
const selected={anchor:point('old-text',0),focus:point('old-text',3)};
const caret=offset=>({anchor:point('actual-new-text',offset),focus:point('actual-new-text',offset)});
const stamp=(revision,epoch)=>({session:'literal-backspace',generation:'1',revision:String(revision),selection_epoch:String(epoch),history_epoch:String(revision)});
const stats={authored_nodes:'0',text_utf8:'0',text_utf16:'0',height:'0'};
const node=(id,parent,primitive,type_id,text,children,base)=>({stamp:clone(base),id,parent,primitive,type_id,text,children,attributes:{},marks:[],changed_revision:base.revision,stats:clone(stats)});
const expected={
  accent:{text:'é',deleted:'',from:0,to:1},
  phrase:{text:'literal phrase',deleted:'literal phras',from:13,to:14},
};
function harness({kind='accent',unjoined=false,frameRefused=false}={}){
  const oracle=expected[kind],before=stamp(0,1),after=stamp(1,2);
  const oldLeaf=node('old-text','block','text','org.klenwriter.kwdj/text','old',[],before),oldBlock=node('block','root','text_block','org.klenwriter.kwdj/paragraph',null,['old-text'],before),oldParent=node('root',null,'root','org.klenwriter.kwdj/root',null,['block','tail'],before);
  const source={stamp:before,selection:clone(selected),stored_marks:null,root:'root',text:oracle.text,leaf:oldLeaf,block:oldBlock,parent:oldParent};
  const published={stamp:clone(after),root:'root',selection:caret(oracle.to),stored_marks:null,dirty:true,saved_revision:'0',history:{undo_entries:'1',redo_entries:'0',retained_bytes:'100'}};
  const ownEvent={sequence:'2',before:clone(before),after:clone(after),selection_before:clone(selected),selection_after:caret(oracle.to),stored_marks_before:null,stored_marks_after:null,dirty_before:false,dirty_after:true,history:clone(published.history),change:{kind:'document',from_revision:'0',to_revision:'1',impact:{upserted:['block','actual-new-text'],removed:['old-text'],ancestors_before:['root','block'],ancestors_after:['root','block'],root_order_changed:false}}};
  const nativeAfter={effect:'changed',state:published,event:ownEvent,leaf:node('actual-new-text','block','text','org.klenwriter.kwdj/text',oracle.text,[],after),block:node('block','root','text_block','org.klenwriter.kwdj/paragraph',null,['actual-new-text'],after),parent:node('root',null,'root','org.klenwriter.kwdj/root',null,['block','tail'],after)};
  let state={stamp:clone(before),root:'root',selection:clone(selected),stored_marks:null,dirty:false,saved_revision:'0',history:{undo_entries:'0',redo_entries:'0',retained_bytes:'0'}},text='old',serial=0n,listener=null,time=0,next=0,typed,composition,context={build_id:'controlled-literal-backspace',profile:{},registry_digest:'registry',capability_digest:'capability'},fingerprintChanged=false,actualResponse;
  const windows=[],requests=[],ordinary=[],packets=[],frameChecks=[],rafs=new Map(),timers=new Map();
  const textNode={},otherNode={},outsideNode={};
  const browser={isCollapsed:false,anchorNode:textNode,focusNode:textNode,anchorOffset:0,focusOffset:3};
  const win={performance:{now:()=>time},requestAnimationFrame:fn=>{const id=++next;rafs.set(id,fn);return id;},cancelAnimationFrame:id=>rafs.delete(id),setTimeout:(fn,delay)=>{const id=++next;timers.set(id,{fn,at:time+delay});return id;},clearTimeout:id=>timers.delete(id)};
  const element={ownerDocument:{defaultView:win,hasFocus:()=>true,getSelection:()=>browser},contains:n=>n===element||n===textNode||n===otherNode};
  const selection={intent:()=>serial,intentAvailable:()=>true,ownsFocus:()=>true,cancel:()=>{},syncFromDom:()=>clone(state.selection),invalidate(_clear=false,event=null){const previous=serial;serial++;listener?.(previous,serial,event);},observeInputIntent(fn){listener=fn;return()=>{listener=null;};}};
  const region=(base,original,provisional)=>Object.freeze({kind:'bounded',stamp:clone(base),originalText:original,provisionalText:provisional,affectedNodeIds:['block']});
  const stale=()=>({status:'dom_refused',diagnostic:{code:'dom.composition_stale',phase:'composition',stamp:clone(state.stamp),publication:'alreadyPublished',node:null,typeId:null}});
  const view={
    beginComposition(base,range){const window=Object.freeze({stamp:clone(base),selection:clone(range),entries:[{id:'block'}],originalRegion:region(base,text,text)});windows.push(window);return window;},
    observeComposition(window){if(window===windows[0]&&state.stamp.revision!=='0')return stale();return {region:region(window.stamp,window.originalRegion.originalText,text),unchanged:text===window.originalRegion.originalText,replacement:window===windows[0]?oracle.text:'',fingerprint:'actual:'+text+(fingerprintChanged?':changed':'')};},
    captureLiteralComposition(window,value,marks){assert.equal(window,windows[0]);assert.equal(value,oracle.text);assert.equal(marks,null);return unjoined?null:source;},
    checkLiteralComposition(value,event,current){return verifyLiteralComposition(value,{...nativeAfter,event,state:current})?null:stale();},
    checkLiteralCompositionWindow(window,current){frameChecks.push({window,current:clone(current)});assert.equal(window,windows[1]);assert.deepEqual(current,published);return frameRefused?stale():null;},
    readSelection:()=>clone(state.selection),setComposing:()=>{},endProvisional:()=>{},captureComposition:()=>region(before,'old',oracle.text),captureRegion:()=>region(state.stamp,text,text),restoreComposition:()=>{throw Error('No rollback after an actual publication');},restoreSelection:()=>null,
    textPosition(n,offset){if(!Number.isSafeInteger(offset)||offset<0||offset>text.length)return null;if(n===textNode)return point('actual-new-text',offset);if(n===otherNode)return point('other-text',offset);return null;},
  };
  function submit(request){requests.push(request);selection.invalidate();state=clone(published);text=oracle.text;browser.isCollapsed=true;browser.anchorOffset=browser.focusOffset=oracle.to;typed.publication(clone(ownEvent));selection.invalidate();actualResponse={status:'ok',value:{kind:'input_mutation',effect:'changed',state:clone(published),presentation:null,result:null}};return {status:'completed',response:actualResponse};}
  function ordinaryDelete(event){event.preventDefault();selection.invalidate(false,event);ordinary.push(event);text=oracle.deleted;
    // This controlled native stub owns the chosen deletion outcome. The actual
    // sealed-browser lane independently checks native EGC/caret/identity rules.
    const finalSelection=kind==='phrase'?caret(13):{anchor:{kind:'child',parent:'block',index:0,affinity:'after'},focus:{kind:'child',parent:'block',index:0,affinity:'after'}};
    state={...state,stamp:stamp(2,3),selection:finalSelection,history:{undo_entries:'2',redo_entries:'0',retained_bytes:'200'}};browser.anchorOffset=browser.focusOffset=kind==='phrase'?13:0;
    return {status:'completed',response:{status:'ok',value:{kind:'mutation',effect:'changed',state:clone(state),presentation:null}}};
  }
  typed=new InputResultOwner({element,view,selection,bindings:{insertTypedText:value=>({id:'typed',payload_json:JSON.stringify(value)})},capture:()=>clone(state.stamp),context:()=>clone(context),readState:()=>clone(state),canEdit:()=>true,busy:()=>false,recover:(failure,actualRegion)=>packets.push({failure,region:actualRegion}),changed:()=>{}});
  composition=new CompositionOwner({element,view,selection,bindings:{},typed,observeIntent:(a,b,event)=>typed.intent(a,b,event),capture:()=>clone(state.stamp),context:()=>clone(context),readState:()=>clone(state),canEdit:()=>true,busy:()=>false,submit:()=>{throw Error('No legacy composition resubmit');},submitInput:submit,ordinary:ordinaryDelete,report:()=>{},recover:(failure,actualRegion,packet)=>packets.push({failure,region:actualRegion,packet}),composing:()=>{},consumeRecords:()=>0});
  const event=(type,extra={})=>({type,target:element,cancelable:true,defaultPrevented:false,data:null,isComposing:false,inputType:'',key:'',code:'',keyCode:0,altKey:false,ctrlKey:false,metaKey:false,shiftKey:false,repeat:false,getTargetRanges:()=>[],preventDefault(){this.defaultPrevented=true;},...extra});
  const api={typed,composition,windows,requests,ordinary,packets,frameChecks,textNode,otherNode,outsideNode,oracle,
    commit(){composition.start(event('compositionstart'));text=oracle.text;composition.end(event('compositionend'));for(let i=0;i<2;i++){time+=16;const callbacks=[...rafs.values()];rafs.clear();for(const callback of callbacks)callback(time);}},
    state:()=>clone(state),text:()=>text,response:()=>actualResponse,
    range(from=oracle.from,to=oracle.to,n=textNode){return {startContainer:n,startOffset:from,endContainer:textNode,endOffset:to};},
    backspace(ranges,{shift=false,repeat=false}={}){composition.keydown(event('keydown',{key:'Backspace',code:'Backspace',shiftKey:shift,repeat}));const input=event('beforeinput',{inputType:'deleteContentBackward',getTargetRanges:()=>ranges});composition.beforeInput(input);return input;},
    replay(ranges){const input=event('beforeinput',{inputType:'deleteContentBackward',getTargetRanges:()=>ranges});composition.beforeInput(input);return input;},
    foreign(){selection.invalidate(false,event('pointerdown'));},stale(){state={...state,stamp:{...state.stamp,revision:'2'}};},foreignContext(){context={...context,capability_digest:'foreign'};},stateMetadata(){state={...state,stored_marks:[]};},changedDom(){fingerprintChanged=true;},
    close(){composition.destroy();typed.destroy();assert.equal(listener,null);assert.equal(rafs.size,0);assert.equal(timers.size,0);assert.deepEqual(composition.resources(),{continuations:0,retainedInputBytes:0,retainedRecoveryRegions:0});assert.deepEqual(typed.resources(),{armedSlots:0,backspaceCandidates:0,pendingDispatches:0,retainedBytes:0});},
  };return api;
}
for(const kind of ['accent','phrase'])test('literal composition Backspace controlled: '+kind+' exact native delete interval reaches ordinary once without raw restoration',()=>{
  const h=harness({kind});h.commit();assert.equal(h.packets.length,0);assert.equal(h.response().value.result,null);assert.equal(h.windows.length,2);assert.equal(h.typed.resources().armedSlots,0);
  const input=h.backspace([h.range()]);assert.equal(input.defaultPrevented,true);assert.equal(h.ordinary.length,1);assert.equal(h.requests.length,1);assert.equal(h.packets.length,0);assert.equal(h.frameChecks.length,1);assert.equal(h.text(),h.oracle.deleted);assert.deepEqual(h.state().stamp,stamp(2,3));assert.equal(h.state().history.undo_entries,'2');assert.equal(h.windows[0].originalRegion.originalText,'old');assert.equal(h.typed.resources().armedSlots,0);assert.equal(h.typed.resources().retainedBytes,0);
  h.replay([h.range()]);assert.equal(h.ordinary.length,1);assert.equal(h.requests.length,1);assert.equal(h.state().history.undo_entries,'2');assert.equal(h.packets.length,1);h.close();
});
const negatives=[
  {name:'start outside proved literal interval',ranges:h=>[h.range(-1)]},
  {name:'start belongs to another native leaf',ranges:h=>[h.range(0,h.oracle.to,h.otherNode)]},
  {name:'end is not the accepted caret',ranges:h=>[h.range(0,0)]},
  {name:'end exceeds accepted caret',ranges:h=>[h.range(0,2)]},
  {name:'multiple actual target ranges',ranges:h=>[h.range(),h.range()]},
  {name:'range is outside owned mount',ranges:h=>[h.range(0,h.oracle.to,h.outsideNode)]},
  {name:'modified Backspace',ranges:h=>[h.range()],key:{shift:true}},
  {name:'repeated Backspace',ranges:h=>[h.range()],key:{repeat:true}},
  {name:'foreign private intent',before:h=>h.foreign(),ranges:h=>[h.range()]},
  {name:'stale native stamp',before:h=>h.stale(),ranges:h=>[h.range()]},
  {name:'changed context',before:h=>h.foreignContext(),ranges:h=>[h.range()]},
  {name:'state differs from the actual native response',before:h=>h.stateMetadata(),ranges:h=>[h.range()]},
  {name:'registered final native/DOM frame refuses',options:{frameRefused:true},ranges:h=>[h.range()]},
  {name:'changed accepted DOM fingerprint',before:h=>h.changedDom(),ranges:h=>[h.range()]},
];
for(const row of negatives)test('literal composition Backspace controlled refusal: '+row.name,()=>{
  const h=harness(row.options);h.commit();assert.equal(h.packets.length,0);row.before?.(h);const before=h.state();h.backspace(row.ranges(h),row.key);assert.equal(h.ordinary.length,0);assert.equal(h.requests.length,1);assert.equal(h.packets.length,1);assert.deepEqual(h.state(),before);assert.equal(h.text(),'é');assert.equal(h.response().value.result,null);assert.equal(h.typed.resources().armedSlots,0);h.close();
});
test('literal composition Backspace controlled refusal: unjoined null response cannot supply literal frame authority',()=>{
  const h=harness({unjoined:true});h.commit();assert.equal(h.windows.length,1);assert.equal(h.packets.length,1);h.backspace([h.range()]);assert.equal(h.ordinary.length,0);assert.equal(h.requests.length,1);assert.equal(h.state().history.undo_entries,'1');assert.equal(h.typed.resources().armedSlots,0);h.close();
});
