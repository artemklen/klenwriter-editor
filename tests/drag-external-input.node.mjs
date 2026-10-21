// SPDX-License-Identifier: MIT OR Apache-2.0
// Actual input owner, controlled EventTarget; browser default behavior is measured separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import {attachInput} from '../packages/dom/dist/input.js';

const stamp=Object.freeze({session:'controlled',generation:'1',revision:'4',selection_epoch:'3',history_epoch:'2'});
function harness({editable=true,busy=false,onReport=()=>{}}={}){
  const registrations=[],effects=[],reports=[];
  class Target extends EventTarget{
    addEventListener(name,callback,capture){registrations.push({name,callback,capture});super.addEventListener(name,callback,capture);}
    removeEventListener(name,callback,capture){const i=registrations.findIndex(r=>r.name===name&&r.callback===callback&&r.capture===capture);assert(i>=0);registrations.splice(i,1);super.removeEventListener(name,callback,capture);}
  }
  const element=new Target();element.ownerDocument={defaultView:{}};
  const unused=name=>()=>{effects.push(name);throw Error(`Transfer must not reach ${name}`);};
  const selection={observeInputIntent:()=>()=>{},syncFromDom:unused('selection sync'),invalidate:unused('selection intent'),cancel:unused('selection cancel')};
  const owner=attachInput({element,view:new Proxy({},{get:(_target,name)=>unused(`view ${String(name)}`)}),selection,
    bindings:{insertText:unused('command factory')},capture:()=>stamp,context:unused('context'),readState:unused('native state'),
    canEdit:()=>{effects.push('canEdit');return editable;},canSelect:()=>true,busy:()=>busy,
    beforeObservation:unused('ordinary observation'),afterObservation:unused('ordinary completion'),
    submit:unused('ordinary submit'),submitComposition:unused('composition submit'),
    report:value=>{reports.push(value);onReport(owner);},recover:unused('recovery'),composing:unused('composing'),consumeRecords:unused('records')});
  function fire(type,{cancelable=true,inputType}={}){
    const event=new Event(type,{cancelable});
    Object.defineProperty(event,'dataTransfer',{get(){throw Error('Foreign DataTransfer read');}});
    Object.defineProperty(event,'data',{get(){throw Error('Foreign text read');}});
    if(inputType!==undefined)Object.defineProperty(event,'inputType',{value:inputType});
    element.dispatchEvent(event);return event;
  }
  return {owner,element,reports,effects,registrations,fire};
}
const refused={status:'dom_refused',diagnostic:{code:'dom.command_unsupported',phase:'command',stamp,node:null,typeId:null,publication:'none'}};

test('external HTML drag uses capture and consumes no data, selection, command or model operation',()=>{
  const f=harness(),before=structuredClone(stamp);
  for(const name of ['dragstart','dragover','drop']){
    assert.equal(f.registrations.find(r=>r.name===name).capture,true);
    assert.equal(f.fire(name).defaultPrevented,true);
  }
  assert.deepEqual(f.reports,[refused,refused]);assert.deepEqual(f.effects,[]);assert.deepEqual(stamp,before);
  f.owner.destroy();assert.equal(f.registrations.length,0);assert.equal(f.owner.listeners(),0);
  assert.deepEqual(f.owner.resources(),{continuations:0,retainedInputBytes:0,retainedRecoveryRegions:0});
});

for(const inputType of ['insertFromDrop','deleteByDrag'])for(const cancelable of [true,false])
test(`${inputType} cancelable=${cancelable} refuses before ordinary/composition/selection work`,()=>{
  const f=harness();const event=f.fire('beforeinput',{inputType,cancelable});
  assert.equal(event.defaultPrevented,cancelable);assert.deepEqual(f.reports,[refused]);assert.deepEqual(f.effects,[]);
  assert.equal(f.owner.isProtected(),false);assert.equal(f.owner.isCommitting(),false);f.owner.destroy();
});

test('noncancelable drop is reported without claiming default cancellation',()=>{
  const f=harness(),event=f.fire('drop',{cancelable:false});
  assert.equal(event.defaultPrevented,false);assert.deepEqual(f.reports,[refused]);assert.deepEqual(f.effects,[]);f.owner.destroy();
});

test('transfer gate remains effective in unavailable modes, and disappears on destroy',()=>{
  const f=harness({editable:false,busy:true});assert.equal(f.fire('drop').defaultPrevented,true);
  assert.deepEqual(f.effects,[]);assert.deepEqual(f.reports,[refused]);f.owner.destroy();f.owner.destroy();
  assert.equal(f.fire('drop').defaultPrevented,false);assert.deepEqual(f.reports,[refused]);assert.equal(f.registrations.length,0);
});

test('refusal callback may synchronously destroy without retaining listeners or issuing a second operation',()=>{
  const f=harness({onReport:owner=>owner.destroy()});assert.equal(f.fire('drop').defaultPrevented,true);
  assert.deepEqual(f.reports,[refused]);assert.deepEqual(f.effects,[]);assert.equal(f.registrations.length,0);
});
