// SPDX-License-Identifier: MIT OR Apache-2.0
// Controlled private-owner policy checks. The native controller and DOM below
// are finite fakes, not Rust/WASM/browser/physical-focus acceptance evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HostRequestOwner } from '../packages/dom/dist/host-request.js';
import { SelectionOwner } from '../packages/dom/dist/selection.js';
import { domRefusal } from '../packages/dom/dist/refusal.js';

const copy=value=>JSON.parse(JSON.stringify(value));
const command=Object.freeze({id:'org.klenwriter.kwdj/command/toggle-mark',payload_json:'{"kind":"toggle_mark","mark":{"type_id":"org.klenwriter.kwdj/strong","attributes":{}}}'});
const quiet={focus:'none'};
function harness(){
  const context={build_id:'controlled-build',profile:{profile_id:'controlled',profile_version:'1',codec_id:'controlled/json',wire_version:1,extensions:[]},registry_digest:'controlled-registry',capability_digest:'controlled-capability'};
  let state={stamp:{session:'controlled-session',generation:'1',revision:'0',selection_epoch:'1',history_epoch:'0'},root:'R',selection:{anchor:{kind:'text',node:'T',offset:1,affinity:'after'},focus:{kind:'text',node:'T',offset:1,affinity:'after'}},stored_marks:null,dirty:false,saved_revision:'0',history:{undo_entries:'0',redo_entries:'0',retained_bytes:'0'}};
  let owner,guardCode=null,behavior='changed',sdkFailure=null,beforeValidate=null,subscriber=null,pendingResolve=null;
  let browser=copy(state.selection),ids=0;
  const requests=[],submittedSelections=[],restoredRanges=[],reports=[],sdkLive=new Map(),released=[];
  class Element {
    constructor(name){this.name=name;this.ownerDocument=doc;this.isConnected=true;this.children=new Set();this.focusCalls=0;this.onFocus=null;}
    contains(value){return value===this || this.children.has(value);}
    focus(){this.focusCalls++;doc.activeElement=this;this.onFocus?.();const event=new Event('focusin');Object.defineProperty(event,'target',{value:this});doc.dispatchEvent(event);}
  }
  const documentEvents=new EventTarget(),windowEvents=new EventTarget();
  const doc={activeElement:null,defaultView:{HTMLElement:Element,Node:Element,addEventListener:windowEvents.addEventListener.bind(windowEvents),removeEventListener:windowEvents.removeEventListener.bind(windowEvents)},hasFocus:()=>doc.focused,focused:true,
    addEventListener:documentEvents.addEventListener.bind(documentEvents),removeEventListener:documentEvents.removeEventListener.bind(documentEvents),dispatchEvent:documentEvents.dispatchEvent.bind(documentEvents)};
  const host=new Element('editor'),scope=new Element('scope'),external=new Element('external'),text={isConnected:true};
  host.children.add(text);doc.activeElement=host;
  const view={domPoint:()=>({node:text,offset:1}),readSelection:()=>browser,restoreSelection:value=>{restoredRanges.push(copy(value));browser=copy(value);return null;}};
  const guard=()=>guardCode?domRefusal(guardCode,'host_request',state.stamp):null;
  const read=()=>({status:'ok',value:{kind:'state',state:copy(state)}});
  const selection=new SelectionOwner({element:()=>host,view:()=>view,capture:()=>copy(state.stamp),context:()=>copy(context),read,
    submit:request=>{submittedSelections.push(copy(request));return {status:'completed',response:{status:'ok',value:{kind:'mutation',effect:'unchanged',state:copy(state),presentation:null}}};},
    guard,busy:()=>false,report:failure=>{reports.push(failure);return failure;},recover:failure=>reports.push(failure),invalidated:()=>owner?.intentChanged()});
  const controller={
    captureHostRequest(){if(sdkFailure)return {status:'refused',response:sdkFailure};const request=Object.freeze({id:String(++ids),stamp:copy(state.stamp)});sdkLive.set(request.id,request);return {status:'captured',request};},
    releaseHostRequest(request){released.push(request);return sdkLive.get(request.id)===request && sdkLive.delete(request.id);},
  };
  const config={element:()=>host,view:()=>view,controller:()=>controller,capture:()=>copy(state.stamp),context:()=>copy(context),selection,guard,
    report:failure=>{reports.push(failure);return failure;},
    dispatch(request,handle,validate){
      beforeValidate?.();const failure=validate();if(failure)return {result:failure,permit:null};
      const frame=selection.beginSubmission(request,false);
      assert.equal(sdkLive.get(handle.id),handle,'the exact SDK request is forwarded');sdkLive.delete(handle.id);requests.push(copy(request));
      let result;
      if(behavior==='queued'){
        result=Object.freeze({status:'queued',completion:new Promise(resolve=>{pendingResolve=resolve;})});
      }else if(behavior==='refused' || behavior==='fatal'){
        result=Object.freeze({status:'completed',response:{status:behavior,diagnostic:{code:'controlled.native_refusal',path:'/literal',category:'controlled',details:{literal:'retained'},stamp:copy(state.stamp),may_have_committed:behavior==='fatal'}}});
      }else{
        const before=copy(state.stamp);
        if(behavior==='changed'){
          state.stamp.revision=String(BigInt(state.stamp.revision)+1n);state.stamp.history_epoch=String(BigInt(state.stamp.history_epoch)+1n);state.dirty=true;state.history.undo_entries='1';
        }else if(behavior==='state'){
          state.stamp.selection_epoch=String(BigInt(state.stamp.selection_epoch)+1n);state.stored_marks=[{type_id:'org.klenwriter.kwdj/strong',attributes:{}}];
        }
        if(behavior!=='noop')selection.publication({before,after:copy(state.stamp),change:{kind:behavior==='state'?'state':'document'}});
        subscriber?.();
        result=Object.freeze({status:'completed',response:{status:'ok',value:{kind:'mutation',effect:behavior==='changed'?'changed':behavior==='state'?'state_changed':'unchanged',state:copy(state),presentation:{active:'none'}}}});
      }
      selection.endSubmission(frame,result);
      return {result,permit:selection.resultFocusPermit(frame,result)};
    },
  };
  owner=new HostRequestOwner(config);
  return {owner,selection,host,scope,external,doc,text,requests,submittedSelections,restoredRanges,reports,sdkLive,released,context,
    state:()=>copy(state),setBrowser:value=>{browser=value;},setGuard:code=>{guardCode=code;},behavior:value=>{behavior=value;},sdkFailure:value=>{sdkFailure=value;},beforeValidate:fn=>{beforeValidate=fn;},subscriber:fn=>{subscriber=fn;},
    bumpStamp(){state.stamp.revision=String(BigInt(state.stamp.revision)+1n);},
    completeQueued(response={status:'ok',value:{kind:'mutation',effect:'unchanged',state:copy(state),presentation:{active:'none'}}}){assert.ok(pendingResolve);pendingResolve(response);},
    capture(options){const captured=owner.api.capture(options);assert.equal(captured.status,'captured');return captured.request;},
    assertReleased(){assert.equal(owner.resources().pending,0);assert.equal(selection.resources().bookmarks,0);assert.equal(sdkLive.size,0);},
  };
}

test('HR01/02 controlled status is allocation/callback-free',()=>{
  const h=harness();h.setGuard('dom.not_ready');assert.equal(h.owner.api.status().diagnostic.code,'dom.not_ready');
  h.setGuard(null);const result=h.owner.api.status();assert.equal(result.status,'available');assert.deepEqual(result.stamp,h.state().stamp);assert.deepEqual(result.context,h.context);
  assert.equal(h.reports.length,0);h.assertReleased();assert.equal(h.released.length,0);
});
for(const code of ['dom.mode_blocked','dom.native_read_only','dom.composition_conflict','dom.busy'])test(`HR03–06 controlled user gate ${code} does not allocate`,()=>{
  const h=harness();h.setGuard(code);assert.equal(h.owner.api.status().diagnostic.code,code);assert.equal(h.owner.api.capture().diagnostic.code,code);h.assertReleased();assert.equal(h.requests.length,0);
});
test('HR07 capture rejects a mismatched actual owned range without synchronizing',()=>{
  const h=harness();const raw=h.state().selection;raw.focus.offset=0;h.setBrowser(raw);
  assert.equal(h.owner.api.capture().diagnostic.code,'dom.selection_unsynchronized');h.assertReleased();assert.equal(h.submittedSelections.length,0);
});
test('HR07 native range with missing owned browser range is not silently captured',()=>{
  const h=harness();h.setBrowser(null);assert.equal(h.owner.api.capture().diagnostic.code,'dom.selection_unsynchronized');h.assertReleased();assert.equal(h.submittedSelections.length,0);
});
test('HR08 genuine capture allocates one shared bookmark and one exact SDK request',()=>{
  const h=harness();const request=h.capture({focusScope:h.scope});assert.deepEqual(request.stamp,h.state().stamp);assert.deepEqual(request.context,h.context);
  assert.equal(h.owner.resources().pending,1);assert.equal(h.selection.resources().bookmarks,1);assert.equal(h.sdkLive.size,1);assert.equal(h.submittedSelections.length,0);
  assert.equal(h.owner.api.release(request),true);h.assertReleased();
});
for(const variant of ['detached','foreign','ancestor','malformed'])test(`HR09 controlled ${variant} scope refuses before allocation`,()=>{
  const h=harness();let options={focusScope:h.scope};
  if(variant==='detached')h.scope.isConnected=false;
  if(variant==='foreign')h.scope.ownerDocument={};
  if(variant==='ancestor')h.scope.children.add(h.host);
  if(variant==='malformed')options={unknown:h.scope};
  assert.equal(h.owner.api.capture(options).diagnostic.code,'dom.invalid_options');h.assertReleased();
});
test('HR10 shared64 limit preserves all previous capabilities and unrelated bookmark',()=>{
  const h=harness();const legacy=h.selection.captureBookmark();assert.equal(legacy.status,'captured');
  const handles=Array.from({length:63},()=>h.capture());assert.equal(h.owner.api.capture().diagnostic.code,'dom.selection_limit');
  assert.equal(h.selection.resources().bookmarks,64);assert.equal(h.sdkLive.size,63);assert.equal(h.owner.resources().pending,63);
  for(const handle of handles)assert.equal(h.owner.api.release(handle),true);
  assert.equal(h.selection.resources().bookmarks,1);assert.equal(h.selection.releaseBookmark(legacy.bookmark),true);h.assertReleased();
});
test('HR11 partial allocation releases bookmark and preserves original SDK refusal',()=>{
  const h=harness(),response={status:'refused',diagnostic:{code:'sdk.host_request_limit',path:'',category:'sdk',details:{},stamp:h.state().stamp,may_have_committed:false}};
  h.sdkFailure(response);const result=h.owner.api.capture();assert.equal(result.status,'sdk_failure');assert.equal(result.response,response);h.assertReleased();
});
test('HR12 copied/proxied descriptors have no authority and do not consume genuine handle',()=>{
  const h=harness(),request=h.capture();for(const forged of [{...request},new Proxy(request,{})])assert.equal(h.owner.api.complete(forged,command,quiet).diagnostic.code,'dom.invalid_host_request');
  assert.equal(h.owner.resources().pending,1);assert.equal(h.requests.length,0);assert.equal(h.owner.api.release(request),true);h.assertReleased();
});
test('HR13 complete dispatches exactly once with captured stamp and never hidden set_selection',async()=>{
  const h=harness(),request=h.capture(),before=h.state().stamp;
  const result=h.owner.api.complete(request,command,quiet);assert.equal(result.status,'submitted');assert.equal(result.submission.status,'completed');
  assert.deepEqual(h.requests,[{kind:'command',stamp:before,command,history_hint:{kind:'isolated'}}]);assert.equal(h.submittedSelections.length,0);
  assert.deepEqual(await result.focus,{status:'not_requested',failure:null});h.assertReleased();
});
test('HR14 terminal options Proxy reentry sees already claimed identity, at most one dispatch',()=>{
  const h=harness(),request=h.capture();let reentrant;
  const options=new Proxy({focus:'none'},{getPrototypeOf(target){reentrant=h.owner.api.complete(request,command,quiet);return Object.getPrototypeOf(target);}});
  const result=h.owner.api.complete(request,command,options);assert.equal(reentrant.diagnostic.code,'dom.invalid_host_request');assert.equal(result.status,'submitted');assert.equal(h.requests.length,1);h.assertReleased();
});
test('HR14 command-copy reentry invalidates target and cannot publish',()=>{
  const h=harness(),request=h.capture();let touched=false;
  const malicious=new Proxy(command,{getPrototypeOf(target){if(!touched){touched=true;h.selection.invalidate();}return Object.getPrototypeOf(target);}});
  const result=h.owner.api.complete(request,malicious,quiet);assert.equal(result.status,'dom_refused');assert.equal(result.diagnostic.code,'dom.stale_selection');assert.equal(h.requests.length,0);h.assertReleased();
});
test('HR14 final validation after presentation callback refuses a changed original intent',()=>{
  const h=harness(),request=h.capture();h.beforeValidate(()=>h.selection.invalidate());
  const result=h.owner.api.complete(request,command,quiet);assert.equal(result.status,'dom_refused');assert.equal(h.requests.length,0);h.assertReleased();
});
test('HR15 malformed terminal options consumes handle; repeat cannot replay',()=>{
  const h=harness(),request=h.capture();assert.equal(h.owner.api.complete(request,command,{focus:'bad'}).diagnostic.code,'dom.invalid_options');h.assertReleased();
  assert.equal(h.owner.api.complete(request,command,quiet).diagnostic.code,'dom.invalid_host_request');assert.equal(h.owner.api.cancel(request).diagnostic.code,'dom.invalid_host_request');assert.equal(h.requests.length,0);
});
test('HR16/17 pure reads leave request live, release is idempotent and focus-free',()=>{
  const h=harness(),request=h.capture();for(let i=0;i<3;i++)assert.equal(h.owner.api.status().status,'available');
  assert.equal(h.owner.api.release(request),true);assert.equal(h.owner.api.release(request),false);assert.equal(h.host.focusCalls,0);assert.equal(h.requests.length,0);h.assertReleased();
});
test('HR18/22 stamp-changing publication retires even when original bookmark intent survives',()=>{
  const h=harness(),request=h.capture(),intent=h.selection.intent();h.bumpStamp();h.owner.publication();
  assert.equal(h.selection.intent(),intent);assert.equal(h.owner.api.release(request),false);assert.equal(h.owner.api.complete(request,command,quiet).diagnostic.code,'dom.stale_host_request');assert.equal(h.requests.length,0);h.assertReleased();
});
test('HR19 private intent retirement is synchronous and cannot be forgiven by same stamps',()=>{
  const h=harness(),request=h.capture(),stamp=h.state().stamp;h.selection.invalidate();assert.deepEqual(h.state().stamp,stamp);
  assert.equal(h.owner.resources().pending,0);assert.equal(h.owner.api.release(request),false);assert.equal(h.owner.api.complete(request,command,quiet).diagnostic.code,'dom.stale_host_request');h.assertReleased();
});
test('HR20/21 explicit lifecycle retirement does not revive when guard returns available',()=>{
  const h=harness(),request=h.capture();h.owner.retire();h.setGuard('dom.mode_blocked');h.setGuard(null);
  assert.equal(h.owner.api.status().status,'available');assert.equal(h.owner.api.complete(request,command,quiet).diagnostic.code,'dom.stale_host_request');h.assertReleased();
});
test('HR22 context-only changes are swept and live-release proof fails',()=>{
  const h=harness(),request=h.capture();h.context.capability_digest='changed';assert.equal(h.owner.api.release(request),false);h.assertReleased();assert.equal(h.requests.length,0);
});
test('HR23 destroy retires genuine requests without retaining their SDK/bookmark authority',()=>{
  const h=harness(),request=h.capture();h.owner.destroy();h.assertReleased();assert.equal(h.owner.api.status().diagnostic.code,'dom.disposed');assert.equal(h.owner.api.complete(request,command,quiet).diagnostic.code,'dom.stale_host_request');assert.equal(h.requests.length,0);
});
test('HR24 cancel delegates exact original bookmark restore ticket and never a document command',()=>{
  const h=harness(),request=h.capture(),expected=h.state().selection;
  const result=h.owner.api.cancel(request,{focus:false});assert.equal(result.status,'cancelled');assert.equal(result.restore.status,'completed');assert.equal(h.requests.length,0);assert.equal(h.submittedSelections.length,1);assert.deepEqual(h.submittedSelections[0].selection,expected);h.assertReleased();
});
test('HR25 stale cancel cannot guess selection or steal focus',()=>{
  const h=harness(),request=h.capture();h.selection.invalidate();const result=h.owner.api.cancel(request);assert.equal(result.status,'dom_refused');assert.equal(h.submittedSelections.length,0);assert.equal(h.host.focusCalls,0);h.assertReleased();
});
test('HR26 controlled original synchronous document frame restores RESULT range with no semantic focus ticket',async()=>{
  const h=harness(),request=h.capture({focusScope:h.scope});h.doc.activeElement=h.scope;
  const result=h.owner.api.complete(request,command);assert.equal(result.status,'submitted');assert.deepEqual(await result.focus,{status:'restored',failure:null});
  assert.equal(h.host.focusCalls,1);assert.deepEqual(h.restoredRanges,[h.state().selection]);assert.equal(h.requests.length,1);assert.equal(h.submittedSelections.length,0);h.assertReleased();
});
for(const failure of ['detached','external','document'])test(`HR28 controlled ${failure} lease does not steal focus while preserving semantic result`,async()=>{
  const h=harness(),request=h.capture({focusScope:h.scope});h.doc.activeElement=h.scope;
  if(failure==='detached')h.scope.isConnected=false;if(failure==='external')h.doc.activeElement=h.external;if(failure==='document')h.doc.focused=false;
  const result=h.owner.api.complete(request,command);assert.equal(result.status,'submitted');assert.equal(result.submission.response.status,'ok');assert.equal((await result.focus).status,'not_restored');assert.equal(h.requests.length,1);assert.equal(h.host.focusCalls,0);h.assertReleased();
});
for(const behavior of ['state','noop'])test(`HR29 original controlled ${behavior} invalidations permit focus without reviving old bookmarks`,async()=>{
  const h=harness();h.behavior(behavior);const legacy=h.selection.captureBookmark();assert.equal(legacy.status,'captured');
  const request=h.capture({focusScope:h.scope}),serial=h.selection.intent();h.doc.activeElement=h.scope;
  const result=h.owner.api.complete(request,command);assert.equal((await result.focus).status,'restored');assert.ok(h.selection.intent()>serial);
  assert.equal(h.selection.validateExact(legacy.bookmark).diagnostic.code,'dom.stale_selection');assert.equal(h.selection.releaseBookmark(legacy.bookmark),true);assert.equal(h.submittedSelections.length,0);h.assertReleased();
});
test('HR30 subscriber intent reentry suppresses prospective focus, preserving original successful submission',async()=>{
  const h=harness(),request=h.capture({focusScope:h.scope});h.doc.activeElement=h.scope;h.subscriber(()=>h.selection.invalidate());
  const result=h.owner.api.complete(request,command);assert.equal(result.submission.response.status,'ok');assert.equal((await result.focus).status,'not_restored');assert.equal(h.host.focusCalls,0);assert.equal(h.requests.length,1);h.assertReleased();
});
test('HR30 focus callback reentry is rechecked before result range write',async()=>{
  const h=harness(),request=h.capture({focusScope:h.scope});h.doc.activeElement=h.scope;h.host.onFocus=()=>h.selection.invalidate();
  const result=h.owner.api.complete(request,command);assert.equal((await result.focus).status,'not_restored');assert.equal(h.restoredRanges.length,0);assert.equal(h.requests.length,1);h.assertReleased();
});
test('HR30 attached Tab-entry focus handler cannot bypass an in-progress prospective range-writing guard',async()=>{
  const h=harness();h.selection.attach();const request=h.capture({focusScope:h.scope});h.doc.activeElement=h.scope;
  const tab=new Event('keydown');for(const [key,value] of Object.entries({key:'Tab',target:h.scope,altKey:false,ctrlKey:false,metaKey:false}))Object.defineProperty(tab,key,{value});h.doc.dispatchEvent(tab);
  h.host.onFocus=()=>h.selection.invalidate();const result=h.owner.api.complete(request,command);
  assert.equal((await result.focus).status,'not_restored');assert.equal(h.restoredRanges.length,0);assert.equal(h.requests.length,1);h.selection.destroy();h.assertReleased();
});
test('HR30 focus callback cannot turn the captured outside lease into an ancestor lease',async()=>{
  const h=harness(),request=h.capture({focusScope:h.scope});h.doc.activeElement=h.scope;h.host.onFocus=()=>h.scope.children.add(h.host);
  const result=h.owner.api.complete(request,command);assert.equal((await result.focus).status,'not_restored');assert.equal(h.restoredRanges.length,0);assert.equal(h.requests.length,1);h.assertReleased();
});
test('HR30 focus callback removing the owned endpoint is refused before a range write',async()=>{
  const h=harness(),request=h.capture({focusScope:h.scope});h.doc.activeElement=h.scope;h.host.onFocus=()=>{h.text.isConnected=false;};
  const result=h.owner.api.complete(request,command);assert.equal((await result.focus).status,'not_restored');assert.equal(h.restoredRanges.length,0);assert.equal(h.requests.length,1);h.assertReleased();
});
test('HR31/34 original queued ticket survives destroy; only numeric continuation remains until settlement',async()=>{
  const h=harness();h.behavior('queued');const request=h.capture({focusScope:h.scope});h.doc.activeElement=h.scope;
  const result=h.owner.api.complete(request,command);assert.equal(result.submission.status,'queued');const original=result.submission;
  assert.equal(h.owner.resources().focusContinuations,1);h.assertReleased();h.owner.destroy();h.assertReleased();assert.equal(result.submission,original);assert.equal(h.owner.resources().focusContinuations,1);
  h.completeQueued();const response=await original.completion;assert.equal(response.status,'ok');assert.equal((await result.focus).status,'not_restored');assert.equal(h.owner.resources().focusContinuations,0);assert.equal(h.host.focusCalls,0);assert.equal(h.requests.length,1);
});
for(const behavior of ['refused','fatal'])test(`HR32 original controlled native ${behavior} is retained verbatim and never replayed`,async()=>{
  const h=harness();h.behavior(behavior);const request=h.capture({focusScope:h.scope});h.doc.activeElement=h.scope;
  const result=h.owner.api.complete(request,command);assert.equal(result.status,'submitted');const response=result.submission.response;assert.equal(response.status,behavior);assert.equal(response.diagnostic.details.literal,'retained');
  const focus=await result.focus;assert.equal(focus.status,'not_restored');assert.equal(focus.failure.response,response);assert.equal(h.requests.length,1);assert.equal(h.host.focusCalls,0);h.assertReleased();
});
