// SPDX-License-Identifier: MIT OR Apache-2.0
// Source-authored accepted-frame regression. Actual CompositionOwner with controlled
// scheduler/view/native-ticket doubles; not native, real DOM or OS IME evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CompositionOwner} from '../packages/dom/dist/composition.js';

const clone=value=>structuredClone(value);
const point=offset=>({kind:'text',node:'text-1',offset,affinity:'after'});
const selectionAt=offset=>({anchor:point(offset),focus:point(offset)});
const originalStamp={session:'controlled-1',generation:'1',revision:'0',selection_epoch:'1',history_epoch:'0'};
const acceptedStamp={session:'controlled-1',generation:'1',revision:'1',selection_epoch:'2',history_epoch:'1'};

test('typed composition controlled: a refused fresh ordinary operation restores the accepted cooked frame, preserving original source and the sole actual refusal',()=>{
  let now=0,next=0,serial=0n,intentListener=null,text='a ',owner;
  const rafs=new Map(),timers=new Map(),windows=[],observations=[],restored=[],packets=[],requests=[],ordinaryTickets=[];
  const context=Object.freeze({build_id:'controlled-build',profile:{},registry_digest:'controlled-registry',capability_digest:'controlled-capability'});
  let state={stamp:clone(originalStamp),root:'root-1',selection:selectionAt(2),stored_marks:null,dirty:false,saved_revision:'0',history:{undo_entries:'0',redo_entries:'0',retained_bytes:'0'}};
  const textNode={nodeType:3},browser={isCollapsed:true,anchorNode:textNode,focusNode:textNode,anchorOffset:3,focusOffset:3};
  const win={performance:{now:()=>now},requestAnimationFrame:fn=>{const id=++next;rafs.set(id,fn);return id;},cancelAnimationFrame:id=>rafs.delete(id),
    setTimeout:(fn,delay)=>{const id=++next;timers.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id)};
  const element={ownerDocument:{defaultView:win,getSelection:()=>browser},contains:node=>node===element||node===textNode};
  const selection={intent:()=>serial,intentAvailable:()=>true,ownsFocus:()=>true,cancel:()=>{},syncFromDom:()=>clone(state.selection),
    invalidate(_clear=false,event=null){const before=serial;serial++;intentListener?.(before,serial,event);},
    observeInputIntent(fn){intentListener=fn;return()=>{intentListener=null;};}};
  const region=(stamp,originalText,provisionalText)=>Object.freeze({kind:'bounded',stamp:clone(stamp),originalText,provisionalText,affectedNodeIds:Object.freeze(['block-1'])});
  const sourceRegion=region(originalStamp,'a ','a ');
  const preeditRegion=region(originalStamp,'a ','a "');
  const cookedRegion=region(acceptedStamp,'a «','a «');
  const windowFor=(stamp,range,originalRegion)=>Object.freeze({stamp:clone(stamp),selection:clone(range),entries:Object.freeze([]),parent:element,before:null,after:null,
    anchor:{node:textNode,offset:range.anchor.offset},focus:{node:textNode,offset:range.focus.offset},selectedAtomIds:Object.freeze([]),affectedNodeIds:Object.freeze(['block-1']),originalRegion});
  const sourceWindow=windowFor(originalStamp,selectionAt(2),sourceRegion);
  const acceptedWindow=windowFor(acceptedStamp,selectionAt(3),cookedRegion);
  const view={beginComposition(){windows.push(sourceWindow);return sourceWindow;},
    observeComposition(window){
      const observation=window===acceptedWindow
        ?{region:cookedRegion,unchanged:text==='a «',replacement:'',fingerprint:`cooked:${text}`}
        :{region:text==='a "'?preeditRegion:sourceRegion,unchanged:text==='a ',replacement:text==='a "'?'"':'',fingerprint:`source:${text}`};
      observations.push({window,observation});return observation;
    },
    restoreComposition(window){restored.push(window);text=window.originalRegion.provisionalText;return null;},
    readSelection:()=>clone(state.selection),restoreSelection:()=>null,setComposing:()=>{},endProvisional:()=>{},
    captureComposition:()=>cookedRegion,captureRegion:()=>cookedRegion};
  let committedResponse=null,armed=0,retired=0;
  const typed={enabled:()=>true,
    prepare(value,origin,window,compositionOwned){assert.equal(value,'"');assert.equal(origin,'composition_commit');assert.equal(window,sourceWindow);assert.equal(compositionOwned,true);return {command:{id:'typed',payload_json:JSON.stringify({kind:'insert_typed_text',text:'"',origin:'composition_commit'})}};},
    dispatch(prepared,submit){return submit({kind:'input_command',stamp:clone(originalStamp),command:prepared.command});},
    joined(response){assert.equal(response,committedResponse);return acceptedWindow;},arm(response){assert.equal(response,committedResponse);armed++;},retire(){retired++;}};
  const failure={status:'refused',diagnostic:{code:'position.invalid',path:'selection',category:'session',details:{},stamp:clone(acceptedStamp),may_have_committed:false}};
  owner=new CompositionOwner({element,view,selection,bindings:{insertText:()=>{throw new Error('unexpected literal resubmission');}},typed,
    canEdit:()=>true,busy:()=>false,capture:()=>clone(state.stamp),context:()=>context,readState:()=>clone(state),
    submit:()=>{throw new Error('unexpected legacy dispatch');},
    submitInput(request){requests.push(request);selection.invalidate();text='a «';state={...state,stamp:clone(acceptedStamp),selection:selectionAt(3),dirty:true,history:{undo_entries:'1',redo_entries:'0',retained_bytes:'100'}};
      committedResponse={status:'ok',value:{kind:'input_mutation',effect:'changed',state:clone(state),presentation:null,result:{kind:'text_replacement'}}};
      return {status:'completed',response:committedResponse};},
    ordinary(event){event.preventDefault();selection.invalidate(false,event);const ticket={status:'completed',response:failure};ordinaryTickets.push(ticket);return ticket;},
    report:()=>{throw new Error('unexpected separate report');},recover:(refusal,actualRegion,composition)=>packets.push({refusal,region:actualRegion,composition}),
    composing:()=>{},consumeRecords:()=>0});
  const event=(type,extra={})=>({type,target:element,cancelable:true,defaultPrevented:false,isComposing:false,inputType:'',data:null,key:'',code:'',keyCode:0,
    shiftKey:false,altKey:false,ctrlKey:false,metaKey:false,repeat:false,getTargetRanges:()=>[],preventDefault(){this.defaultPrevented=true;},...extra});
  const raf=()=>{now+=16;const pending=[...rafs.values()];rafs.clear();for(const fn of pending)fn(now);};

  owner.start(event('compositionstart'));text='a "';owner.end(event('compositionend',{data:'"'}));raf();raf();
  assert.equal(requests.length,1);assert.equal(armed,1);assert.equal(packets.length,0);assert.equal(text,'a «');
  assert(observations.some(entry=>entry.window===acceptedWindow&&entry.observation.unchanged));
  const acceptedState=clone(state);
  owner.keydown(event('keydown',{key:'x',code:'KeyX'}));const input=event('beforeinput',{inputType:'insertText',data:'x'});assert.equal(owner.beforeInput(input),true);

  assert.equal(input.defaultPrevented,true);assert.equal(ordinaryTickets.length,1);assert.equal(requests.length,1);
  assert.deepEqual(restored,[acceptedWindow]);assert.equal(text,'a «');assert.deepEqual(state,acceptedState);
  assert.equal(packets.length,1);const packet=packets[0];
  assert.equal(packet.composition.reason,'native_refused');assert.equal(packet.composition.disposition,'committed_restored');assert.equal(packet.composition.nativeOutcome,'completed');
  assert.equal(packet.composition.submission,ordinaryTickets[0]);assert.equal(packet.composition.response,failure);assert.equal(packet.region,cookedRegion);
  assert.deepEqual(packet.composition.base,acceptedStamp);assert.deepEqual(packet.composition.selection,selectionAt(3));
  assert.equal(packet.composition.unappliedInput.data,'x');assert.equal(packet.composition.unappliedInput.inputType,'insertText');
  assert.equal(sourceWindow.originalRegion,sourceRegion);assert.deepEqual(sourceRegion,region(originalStamp,'a ','a '));assert.deepEqual(preeditRegion,region(originalStamp,'a ','a "'));
  assert.equal(owner.retained().composition.response,failure);assert.equal(retired,1);assert.equal(windows.length,1);
  owner.destroy();assert.equal(intentListener,null);assert.equal(rafs.size,0);assert.equal(timers.size,0);
  assert.deepEqual(owner.resources(),{continuations:0,retainedInputBytes:0,retainedRecoveryRegions:0});
});
