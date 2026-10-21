// SPDX-License-Identifier: MIT OR Apache-2.0
// Actual input owner with controlled event/native/view doubles. Not browser or OS input proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { attachInput } from '../packages/dom/dist/input.js';

const clone=value=>structuredClone(value);
function fixture(configuration={}) {
  const registrations=new Map(),windowListeners=new Map(),requests=[],reports=[],beforeObservations=[],rafs=new Map(),timers=new Map();let serial=0n,next=0,listener=null;
  let focused=true,owned=true,editable=true,busy=false,observationBusy=false,provisional=false,selectionPresent=true;
  let state={stamp:{session:'controlled',generation:'1',revision:'2',selection_epoch:'1',history_epoch:'2'},selection:{anchor:{kind:'text',node:'T',offset:1,affinity:'after'},focus:{kind:'text',node:'T',offset:1,affinity:'after'}}};
  let context=configuration.sdk1?null:{build_id:'controlled',registry_digest:'R',capability_digest:'C'},syncHook=()=>{},readHook=()=>{},submitHook=()=>{},reportHook=()=>{};
  const element={contains:value=>value===element||value===text||value===block,addEventListener(name,callback){const set=registrations.get(name)??new Set();set.add(callback);registrations.set(name,set);},removeEventListener(name,callback){registrations.get(name)?.delete(callback);}};
  const text={nodeType:3,data:'a',childNodes:[]},block={nodeType:1,childNodes:[text],parentNode:element,contains:value=>value===text||value===block};text.parentNode=block;element.childNodes=[block];
  const browser={isCollapsed:true,anchorNode:text,focusNode:text,anchorOffset:1,focusOffset:1};
  element.ownerDocument={hasFocus:()=>focused,getSelection:()=>browser,defaultView:{addEventListener(name,callback){windowListeners.set(name,callback);},removeEventListener(name,callback){assert.equal(windowListeners.get(name),callback);windowListeners.delete(name);},performance:{now:()=>0},requestAnimationFrame:callback=>{const id=++next;rafs.set(id,callback);return id;},cancelAnimationFrame:id=>rafs.delete(id),setTimeout:callback=>{const id=++next;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id)}};
  const selection={ownsFocus:()=>owned,intent:()=>serial,intentAvailable:()=>true,observeInputIntent(callback){listener=callback;return()=>{listener=null;};},invalidate(_clear=false,event=null){const before=serial++;listener?.(before,serial,event);},cancel(){},syncFromDom(){syncHook();return selectionPresent?clone(state.selection):null;}};
  const region=()=>({kind:'bounded',stamp:clone(state.stamp),originalText:'a',provisionalText:'a',affectedNodeIds:['P']});
  const view={hasProvisional:()=>provisional,readSelection:()=>clone(state.selection),domPoint:point=>({node:text,offset:point.offset}),ownedBlockAt:()=> 'P',captureRegion:region,captureComposition:region,
    beginComposition(stamp,range){provisional=true;return {stamp,selection:range,originalRegion:region(),affectedNodeIds:['P']};},observeComposition:window=>({region:region(),unchanged:true,replacement:'a',fingerprint:'a'}),restoreComposition:()=>null,restoreSelection:()=>null,endProvisional(){provisional=false;},setComposing(){}};
  const owner=attachInput({element,view,selection,bindings:{},canEdit:()=>editable,canSelect:()=>true,busy:()=>busy,capture:()=>clone(state.stamp),context:()=>clone(context),readState(){const captured=clone(state);readHook();return captured;},
    submit(request,observation){requests.push({request:clone(request),observation});submitHook();return configuration.queued?{status:'queued',completion:{then(){throw Error('Shortcut must not replay/await a queued native submission');}}}:{status:'completed',response:{status:'ok',value:{kind:'mutation',effect:'changed',state:clone(state)}}};},
    beforeObservation(input){beforeObservations.push(input.type);return null;},afterObservation(){},observationBusy:()=>observationBusy,submitComposition(){throw Error('Shortcut cannot consume a composition capability');},report(value){reports.push(value);reportHook();},recover(){},composing(){},consumeRecords:()=>0});
  function fire(type,properties={}){const event={type,target:element,cancelable:true,defaultPrevented:false,isTrusted:true,isComposing:false,inputType:'',data:null,key:'z',code:'KeyZ',keyCode:0,ctrlKey:false,metaKey:true,altKey:false,shiftKey:false,repeat:false,getTargetRanges:()=>[],preventDefault(){this.defaultPrevented=true;},...properties};for(const callback of [...(registrations.get(type)??[])])callback(event);return event;}
  return {owner,requests,reports,beforeObservations,fire,state:()=>clone(state),set(values){if('focused'in values)focused=values.focused;if('owned'in values)owned=values.owned;if('editable'in values)editable=values.editable;if('busy'in values)busy=values.busy;if('observationBusy'in values)observationBusy=values.observationBusy;if('provisional'in values)provisional=values.provisional;if('selectionPresent'in values)selectionPresent=values.selectionPresent;},
    onSync:callback=>syncHook=callback,onRead:callback=>readHook=callback,onSubmit:callback=>submitHook=callback,onReport:callback=>reportHook=callback,windowBlur:()=>windowListeners.get('blur')?.(),advance(){state.stamp.selection_epoch=String(BigInt(state.stamp.selection_epoch)+1n);},
    close(){owner.destroy();assert.equal([...registrations.values()].reduce((n,set)=>n+set.size,0),0);assert.equal(windowListeners.size,0);assert.equal(rafs.size,0);assert.equal(timers.size,0);assert.deepEqual(owner.resources(),{continuations:0,retainedInputBytes:0,retainedRecoveryRegions:0});}};
}

for(const modifiers of [{metaKey:true,ctrlKey:false},{metaKey:false,ctrlKey:true}])for(const shiftKey of [false,true])test(`trusted focused physical KeyZ routes ${JSON.stringify({...modifiers,shiftKey})} once using post-sync native stamp`,()=>{
  const f=fixture({sdk1:true});f.onSync(()=>f.advance());const event=f.fire('keydown',{...modifiers,shiftKey,key:'я'});
  assert.equal(event.defaultPrevented,true);assert.deepEqual(f.requests,[{request:{kind:'history',stamp:f.state().stamp,direction:shiftKey?'redo':'undo'},observation:null}]);assert.equal(f.beforeObservations.length,0);assert.equal(f.reports.length,0);f.close();
});
test('held shortcut suppresses all matching UA echoes/repeats; keyup restores standalone beforeinput history',()=>{
  const f=fixture();assert.equal(f.fire('keydown').defaultPrevented,true);
  for(let i=0;i<2;i++){assert.equal(f.fire('beforeinput',{inputType:'historyUndo'}).defaultPrevented,true);assert.equal(f.fire('keydown',{repeat:true}).defaultPrevented,true);}assert.equal(f.requests.length,1);
  // A different direction is a distinct beforeinput intent, not the original echo.
  assert.equal(f.fire('beforeinput',{inputType:'historyRedo'}).defaultPrevented,true);assert.equal(f.requests.length,2);assert.equal(f.requests.at(-1).request.direction,'redo');
  f.fire('keyup');assert.equal(f.fire('beforeinput',{inputType:'historyUndo'}).defaultPrevented,true);assert.equal(f.requests.length,3);
  f.fire('keydown');assert.equal(f.requests.length,4);f.close();
});
test('reentrant matching echo cannot submit a second native operation; noncancelable echo claims no cancellation',()=>{
  const f=fixture({queued:true});f.onSubmit(()=>{assert.equal(f.fire('beforeinput',{inputType:'historyUndo'}).defaultPrevented,true);});f.fire('keydown');assert.equal(f.requests.length,1);
  assert.equal(f.fire('beforeinput',{inputType:'historyUndo',cancelable:false}).defaultPrevented,false);assert.equal(f.requests.length,1);f.close();
});
for(const [name,settings,event] of [
  ['read-only',{editable:false},{}],['busy',{busy:true},{}],['observer delivery',{observationBusy:true},{}],['provisional',{provisional:true},{}],['composing key',{}, {isComposing:true}],['IME Process key',{}, {keyCode:229}],
])test(`owned ${name} shortcut prevents UA default without native/selection edits`,()=>{
  const f=fixture();f.set(settings);const before=f.state();let synced=false;f.onSync(()=>{synced=true;});assert.equal(f.fire('keydown',event).defaultPrevented,true);assert.equal(f.requests.length,0);assert.equal(synced,false);assert.deepEqual(f.state(),before);assert.equal(f.fire('beforeinput',{inputType:'historyUndo'}).defaultPrevented,true);assert.equal(f.requests.length,0);f.close();
});
for(const [name,settings,event] of [
  ['foreign focus',{owned:false},{}],['background document',{focused:false},{}],['untrusted key',{}, {isTrusted:false}],['already prevented',{}, {defaultPrevented:true}],['noncancelable',{}, {cancelable:false}],['foreign target',{}, {target:{}}],['Alt chord',{}, {altKey:true}],['both primary modifiers',{}, {ctrlKey:true}],['unmodified',{}, {metaKey:false}],['other physical key',{}, {code:'KeyY'}],
])test(`${name} is not captured as a history shortcut`,()=>{
  const f=fixture();f.set(settings);const input=f.fire('keydown',event);assert.equal(input.defaultPrevented,event.defaultPrevented??false);assert.equal(f.requests.length,0);assert.equal(f.reports.length,0);f.close();
});
test('absent/stale selection never submits and actual composition generation remains protected',()=>{
  for(const stale of [false,true]){const f=fixture();if(stale)f.onRead(()=>f.advance());else f.set({selectionPresent:false});f.fire('keydown');assert.equal(f.requests.length,0);if(stale)assert.equal(f.reports.at(-1).diagnostic.code,'dom.stale_selection');f.close();}
  const f=fixture();f.fire('compositionstart',{key:'',code:'',metaKey:false});assert.equal(f.owner.isProtected(),true);assert.equal(f.fire('keydown').defaultPrevented,true);assert.equal(f.requests.length,0);assert.equal(f.owner.isProtected(),true);f.close();
});
test('fresh pointer/blur retires fence and destroy during original callback cannot forward a stale key',()=>{
  for(const type of ['pointerdown','blur']){const f=fixture();f.fire('keydown');f.fire(type,{code:'',metaKey:false});f.fire('beforeinput',{inputType:'historyUndo'});assert.equal(f.requests.length,2);f.close();}
  const w=fixture();w.fire('keydown');w.windowBlur();w.fire('keydown');assert.equal(w.requests.length,2);w.close();
  const f=fixture();f.onSync(()=>f.owner.destroy());f.fire('keydown');assert.equal(f.requests.length,0);f.close();
});
