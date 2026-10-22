// SPDX-License-Identifier: MIT OR Apache-2.0
// Source-first native-frame/owner controls. Native/DOM doubles are labelled;
// the separate sealed-browser lane supplies real renderer correspondence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyLiteralComposition} from '../packages/dom/dist/composition-literal.js';
import {InputResultOwner} from '../packages/dom/dist/input-result.js';
import {CompositionOwner} from '../packages/dom/dist/composition.js';

const clone=value=>structuredClone(value);
const stamp=(revision,epoch)=>({session:'literal-session',generation:'1',revision:String(revision),selection_epoch:String(epoch),history_epoch:String(revision)});
const point=(node,offset,affinity='after')=>({kind:'text',node,offset,affinity});
const selected={anchor:point('old-text',0),focus:point('old-text',3)};
const caret={anchor:point('actual-new-text',1),focus:point('actual-new-text',1)};
// Statistics are opaque to this correspondence proof; use the actual DTO keys.
const stats={authored_nodes:'0',text_utf8:'0',text_utf16:'0',height:'0'};
const node=(id,parent,primitive,type_id,text,children,base)=>({stamp:clone(base),id,parent,primitive,type_id,text,children,attributes:{},marks:[],changed_revision:base.revision,stats:clone(stats)});
function fixture(){
  const before=stamp(0,1),after=stamp(1,2),oldLeaf=node('old-text','block','text','org.klenwriter.kwdj/text','old',[],before),oldBlock=node('block','root','text_block','org.klenwriter.kwdj/paragraph',null,['old-text'],before),oldParent=node('root',null,'root','org.klenwriter.kwdj/root',null,['block','tail'],before);
  const state={stamp:clone(after),root:'root',selection:clone(caret),stored_marks:null,dirty:true,saved_revision:'0',history:{undo_entries:'1',redo_entries:'0',retained_bytes:'123'}};
  const event={sequence:'2',before:clone(before),after:clone(after),selection_before:clone(selected),selection_after:clone(caret),stored_marks_before:null,stored_marks_after:null,dirty_before:false,dirty_after:true,history:clone(state.history),
    change:{kind:'document',from_revision:'0',to_revision:'1',impact:{upserted:['block','actual-new-text'],removed:['old-text'],ancestors_before:['root','block'],ancestors_after:['root','block'],root_order_changed:false}}};
  return {source:{stamp:before,selection:clone(selected),stored_marks:null,root:'root',text:'é',leaf:oldLeaf,block:oldBlock,parent:oldParent},
    after:{effect:'changed',state,event,leaf:node('actual-new-text','block','text','org.klenwriter.kwdj/text','é',[],after),block:node('block','root','text_block','org.klenwriter.kwdj/paragraph',null,['actual-new-text'],after),parent:node('root',null,'root','org.klenwriter.kwdj/root',null,['block','tail'],after)}};
}
test('literal full replacement proof: exact source-authored old[0..3] to é joins the actual final ID, never an upserted-ID guess',()=>{
  const f=fixture();assert.equal(verifyLiteralComposition(f.source,f.after),true);assert.equal(f.source.leaf.text,'old');assert.equal(f.after.leaf.text,'é');assert.equal(f.after.state.selection.focus.node,'actual-new-text');
});
test('literal full replacement proof: complete reverse selection retains its directed original source',()=>{
  const f=fixture();f.source.selection={anchor:point('old-text',3,'before'),focus:point('old-text',0)};f.after.event.selection_before=clone(f.source.selection);assert.equal(verifyLiteralComposition(f.source,f.after),true);assert.equal(f.source.selection.anchor.offset,3);
});
test('literal full replacement proof: effective insertion marks come from the original stored override',()=>{
  const f=fixture(),marks=[{type_id:'org.klenwriter.kwdj/strong',attributes:{}}];f.source.stored_marks=clone(marks);f.after.state.stored_marks=clone(marks);f.after.event.stored_marks_before=clone(marks);f.after.event.stored_marks_after=clone(marks);f.after.leaf.marks=clone(marks);assert.equal(verifyLiteralComposition(f.source,f.after),true);
});
const invalid=[
  ['wrong literal text',f=>{f.after.leaf.text='ê';}],
  ['wrong native block',f=>{f.after.leaf.parent='other-block';}],
  ['changed inserted metadata',f=>{f.after.leaf.attributes={unexpected:{kind:'string',value:'x'}};}],
  ['changed inserted marks',f=>{f.after.leaf.marks=[{type_id:'org.klenwriter.kwdj/strong',attributes:{}}];}],
  ['changed block metadata',f=>{f.after.block.attributes={align:{kind:'string',value:'right'}};}],
  ['outside native mutation',f=>{f.after.event.change.impact.upserted.push('tail');}],
  ['outside parent reorder',f=>{f.after.parent.children=['tail','block'];}],
  ['unchanged result is not a publication proof',f=>{f.after.effect='unchanged';}],
  ['query/state event is not a document publication',f=>{f.after.event.change={kind:'state',selection_changed:true,stored_marks_changed:false,history_changed:false,baseline_changed:false};}],
  ['duplicate publication impact members',f=>{f.after.event.change.impact.upserted.push('block');}],
  ['stale native read',f=>{f.after.leaf.stamp=stamp(0,1);}],
  ['reply selection is not the current native child',f=>{f.after.state.selection={anchor:point('guessed-text',1),focus:point('guessed-text',1)};}],
  ['source selection is partial',f=>{f.source.selection.focus.offset=2;f.after.event.selection_before=clone(f.source.selection);}],
  ['original source ID incorrectly retained after complete removal',f=>{f.after.leaf.id='old-text';f.after.block.children=['old-text'];f.after.state.selection={anchor:point('old-text',1),focus:point('old-text',1)};}],
];
for(const [name,change]of invalid)test('literal full replacement proof refusal: '+name,()=>{const f=fixture();change(f);assert.equal(verifyLiteralComposition(f.source,f.after),false);});

function ownerHarness({queued=false,publication='own',foreign=false,contextChange=false,stale=false,proofFailure=false}={}){
  const f=fixture(),initial={stamp:clone(f.source.stamp),root:'root',selection:clone(selected),stored_marks:null,dirty:false,saved_revision:'0',history:{undo_entries:'0',redo_entries:'0',retained_bytes:'0'}};
  let state=clone(initial),serial=0n,listener=null,now=0,next=0,text='old',typed,composition,resolve,reject,actualResponse;
  let context={build_id:'literal-build',profile:{},registry_digest:'registry',capability_digest:'capability'};
  const rafs=new Map(),timers=new Map(),recoveries=[],requests=[],windows=[],checks=[],sourceRegion=Object.freeze({kind:'bounded',stamp:clone(initial.stamp),originalText:'old',provisionalText:'old',affectedNodeIds:['block']});
  const textNode={},browser={isCollapsed:false,anchorNode:textNode,focusNode:textNode,anchorOffset:0,focusOffset:3};
  const win={performance:{now:()=>now},requestAnimationFrame:fn=>{const id=++next;rafs.set(id,fn);return id;},cancelAnimationFrame:id=>rafs.delete(id),setTimeout:(fn,delay)=>{const id=++next;timers.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id)};
  const element={ownerDocument:{defaultView:win,hasFocus:()=>true,getSelection:()=>browser},contains:n=>n===element||n===textNode};
  const selection={intent:()=>serial,intentAvailable:()=>true,ownsFocus:()=>true,cancel:()=>{},syncFromDom:()=>clone(state.selection),invalidate(_clear=false,event=null){const before=serial;serial++;listener?.(before,serial,event);},observeInputIntent(fn){listener=fn;return()=>{listener=null;};}};
  const view={beginComposition(base,range){const originalRegion=windows.length===0?sourceRegion:Object.freeze({kind:'bounded',stamp:clone(base),originalText:'é',provisionalText:'é',affectedNodeIds:['block']});const window={stamp:clone(base),selection:clone(range),entries:[{id:'block'}],originalRegion};windows.push(window);return window;},
    observeComposition(window){if(window===windows[0]&&state.stamp.revision==='1')return {status:'dom_refused',diagnostic:{code:'dom.composition_stale',phase:'composition',stamp:clone(state.stamp),publication:'none',node:null,typeId:null}};
      return {region:Object.freeze({kind:'bounded',stamp:clone(window.stamp),originalText:window.originalRegion.originalText,provisionalText:text,affectedNodeIds:['block']}),unchanged:text===window.originalRegion.originalText,replacement:window===windows[0]?'é':'',fingerprint:'actual:'+text};},
    captureLiteralComposition(window,value,marks){assert.equal(window,windows[0]);assert.equal(value,'é');assert.equal(marks,null);assert.deepEqual(state,initial);return f.source;},
    checkLiteralComposition(source,event,current){checks.push({source,event,current});return !proofFailure&&verifyLiteralComposition(source,{...f.after,event,state:current})?null:{status:'dom_refused',diagnostic:{code:'dom.composition_stale',phase:'composition',stamp:clone(current.stamp),publication:'alreadyPublished',node:null,typeId:null}};},
    readSelection:()=>clone(state.selection),setComposing:()=>{},endProvisional:()=>{},captureComposition:()=>Object.freeze({kind:'bounded',stamp:clone(initial.stamp),originalText:'old',provisionalText:'é',affectedNodeIds:['block']}),captureRegion:()=>sourceRegion,restoreComposition:()=>{throw Error('No restoration after actual publication');},restoreSelection:()=>null};
  function terminal(){state=clone(f.after.state);text='é';browser.isCollapsed=true;browser.anchorOffset=browser.focusOffset=1;
    if(publication!=='none'){typed.publication(clone(f.after.event));if(publication==='multiple')typed.publication(clone(f.after.event));}selection.invalidate();
    if(contextChange)context={...context,capability_digest:'foreign'};if(stale)state={...state,stamp:{...state.stamp,history_epoch:'2'}};
    actualResponse={status:'ok',value:{kind:'input_mutation',effect:'changed',state:clone(f.after.state),presentation:null,result:null}};return actualResponse;}
  function submit(request){requests.push(request);selection.invalidate();if(foreign)selection.invalidate(false,{type:'pointerdown'});
    if(queued)return {status:'queued',completion:new Promise((yes,no)=>{resolve=()=>yes(terminal());reject=no;})};return {status:'completed',response:terminal()};}
  typed=new InputResultOwner({element,view,selection,bindings:{insertTypedText:data=>({id:'typed',payload_json:JSON.stringify(data)})},capture:()=>clone(state.stamp),context:()=>clone(context),readState:()=>clone(state),canEdit:()=>true,busy:()=>false,recover:(failure,region)=>recoveries.push({failure,region}),changed:()=>{}});
  composition=new CompositionOwner({element,view,selection,bindings:{},typed,observeIntent:(before,after,event)=>typed.intent(before,after,event),capture:()=>clone(state.stamp),context:()=>clone(context),readState:()=>clone(state),canEdit:()=>true,busy:()=>false,submit:()=>{throw Error('No legacy resubmission');},submitInput:submit,ordinary:()=>{throw Error('No extra ordinary input');},report:()=>{},recover:(failure,region,packet)=>recoveries.push({failure,region,packet}),composing:()=>{},consumeRecords:()=>0});
  const event=type=>({type,target:element,cancelable:true,defaultPrevented:false,data:'not authority',isComposing:false,inputType:'',key:'',code:'',preventDefault(){this.defaultPrevented=true;}});
  return {typed,composition,requests,recoveries,windows,checks,
    commit(){composition.start(event('compositionstart'));text='é';composition.end(event('compositionend'));for(let i=0;i<2;i++){now+=16;const callbacks=[...rafs.values()];rafs.clear();for(const cb of callbacks)cb(now);}},
    resolve:()=>resolve(),unknown:()=>reject(Error('Original queued outcome unknown')),response:()=>actualResponse,state:()=>clone(state),
    close(){composition.destroy();typed.destroy();assert.equal(listener,null);assert.equal(rafs.size,0);assert.equal(timers.size,0);assert.deepEqual(composition.resources(),{continuations:0,retainedInputBytes:0,retainedRecoveryRegions:0});assert.deepEqual(typed.resources(),{armedSlots:0,backspaceCandidates:0,pendingDispatches:0,retainedBytes:0});}};
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();await Promise.resolve();};
test('literal full replacement owner: one actual own publication adopts a separate fresh-ID frame, consumes it once and keeps result null',()=>{
  const h=ownerHarness();h.commit();assert.equal(h.requests.length,1);assert.equal(h.recoveries.length,0);assert.equal(h.windows.length,2);assert.equal(h.checks.length,1);assert.equal(h.response().value.result,null);assert.deepEqual(h.state().selection,caret);assert.equal(h.state().history.undo_entries,'1');
  assert.equal(h.windows[0].originalRegion.originalText,'old');assert.equal(h.windows[0].stamp.revision,'0');assert.equal(h.windows[1].originalRegion.originalText,'é');assert.equal(h.typed.joined(h.response()),null);assert.equal(h.typed.resources().armedSlots,0);assert.equal(h.typed.resources().retainedBytes,0);h.close();
});
for(const [name,options]of [['nonowned publication',{publication:'none'}],['multiple publication',{publication:'multiple'}],['foreign intent',{foreign:true}],['stale context',{contextChange:true}],['stale stamp',{stale:true}],['failed native/DOM literal proof',{proofFailure:true}]])test('literal full replacement owner refusal: '+name,()=>{
  const h=ownerHarness(options);h.commit();assert.equal(h.requests.length,1);assert.equal(h.recoveries.length,1);assert.equal(h.recoveries[0].packet.response,h.response());assert.equal(h.recoveries[0].packet.nativeOutcome,'completed');assert.equal(h.recoveries[0].region.originalText,'old');assert.equal(h.recoveries[0].region.provisionalText,'é');assert.equal(h.response().value.result,null);assert.equal(h.typed.resources().armedSlots,0);h.close();
});
test('literal full replacement owner: queued original has no accepted frame until its own terminal publication',async()=>{
  const h=ownerHarness({queued:true});h.commit();assert.equal(h.windows.length,1);assert.equal(h.typed.resources().pendingDispatches,1);h.resolve();await flush();assert.equal(h.requests.length,1);assert.equal(h.recoveries.length,0);assert.equal(h.windows.length,2);assert.equal(h.state().history.undo_entries,'1');h.close();
});
test('literal full replacement owner: queued unknown retains original input and never fabricates a final frame',async()=>{
  const h=ownerHarness({queued:true});h.commit();h.unknown();await flush();assert.equal(h.requests.length,1);assert.equal(h.windows.length,1);assert.equal(h.recoveries.length,1);assert.equal(h.recoveries[0].packet.nativeOutcome,'unknown');assert.equal(h.recoveries[0].region.provisionalText,'é');h.close();
});

// Added before correcting the draft view's typography-only12B check. The sealed
// browser counterpart exercises the actual registered renderer rather than this
// pure native proof double. Existing26 controls above remain byte-identical.
test('literal full replacement proof: multiscalar literal phrase exceeds typography12B but remains an exact literal commit',()=>{
  const f=fixture(),text='literal phrase';
  f.source.text=text;f.after.leaf.text=text;
  f.after.state.selection={anchor:point('actual-new-text',14),focus:point('actual-new-text',14)};
  f.after.event.selection_after=clone(f.after.state.selection);
  assert.equal(Buffer.byteLength(text,'utf8'),14);
  assert.equal(verifyLiteralComposition(f.source,f.after),true);
  assert.equal(f.source.leaf.text,'old');assert.equal(f.after.state.history.undo_entries,'1');
});
