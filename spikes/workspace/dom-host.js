// SPDX-License-Identifier: MIT OR Apache-2.0
// Acceptance fixture only. All editing goes through the public mounted facade.
import { createEditor, loadSdkV2, sdkBuildId } from '@klenwriter/editor-sdk';
import { mountEditor, defineRendererCatalog } from '@klenwriter/editor-dom';
import { kwdjCommand } from '@klenwriter/editor-kwdj';
import { kwdjBasicRenderers } from '@klenwriter/editor-kwdj/dom';
import { notesD0Renderers } from '/notes-dom.mjs';
const records = new Map(), modulePromise = loadSdkV2(), packetPromise = fetch('/extensions-packet.json').then(r => r.json());
let serial = 0;
const encoder = new TextEncoder();
const copy = value => JSON.parse(JSON.stringify(value));
const assert = (condition,message) => { if (!condition) throw new Error(message); };
const encode = value => encoder.encode(typeof value === 'string' ? value : JSON.stringify(value));
const rec = id => { const result = records.get(id); assert(result,`Unknown mount ${id}`); return result; };
const outcome = result => result?.status === 'queued' ? result.completion.then(response => ({status:'queued',response})) : Promise.resolve(result);
const response = result => { assert(result.status === 'completed' || result.status === 'queued','Expected SDK submission'); return result.response; };
export async function fixture(name, expected = false) {
  const result = await fetch(`/dom-fixtures/${expected ? 'expected' : 'inputs'}/${name}${expected ? '.canonical' : ''}.json`);
  assert(result.ok, `Missing frozen fixture ${name}`); return result.text();
}
function regionSummary(region) {
  return !region ? null : region.kind === 'retained_dom' ? {kind:region.kind,reason:region.reason,ownership:region.ownership,connected:region.element.isConnected,elementTag:region.element.tagName}
    : copy(region);
}
function receiptSummary(receipt) {
  return {status:receipt.status,sdk:receipt.sdk.status,callbackFailure:receipt.callbackFailure,
    recovery:receipt.recovery ? {originalInput:receipt.recovery.originalInput ? Array.from(receipt.recovery.originalInput) : null,region:regionSummary(receipt.recovery.region)} : null};
}
async function options(profile, access = 'editable', registry = 'D0', admission = 'validate') {
  const [module,packet] = await Promise.all([modulePromise,packetPromise]);
  const notes = profile === 'notes', descriptor = packet.registries[registry];
  return {abi:'editor-sdk/2',build_id:sdkBuildId,profile:notes ? {profile_id:'org.example.notes',profile_version:'1.0.0',codec_id:'org.example.notes/json',wire_version:1,extensions:descriptor.selected_extensions} : packet.kwdjProfile,
    admission,access,registry_json:notes ? packet.registryJson[registry] : packet.kwdjRegistryJson,
    profile_options_json:JSON.stringify(notes ? {root_blocks:registry === 'D0' ? ['org.example.notes/paragraph'] : ['org.example.notes/paragraph','org.example.notes/callout'],limits:null} : {identities:{media:[],references:[]},limits:null})};
}
function controlledFaultModule(module,kind,observations) {
  class ActualSessionWithControlledReply {
    constructor(input,optionsJson){this.actual=new module.Session(input,optionsJson);this.stamp=null;}
    initialization(){const json=this.actual.initialization(),reply=JSON.parse(json);this.stamp=reply.value?.state?.stamp??null;return json;}
    context(){return this.actual.context();}
    call(json){
      const request=JSON.parse(json);
      if(request.kind===kind){
        const reply={status:'fatal',diagnostic:{code:'fixture.native_fatal',path:'/controlled-transport',category:'transport',details:{fixture:'dom-mounted-controlled-reply'},stamp:this.stamp,may_have_committed:false}};
        observations.push({requestKind:request.kind,response:copy(reply),provenance:'CONTROLLED transport reply; all other calls and native ownership delegate to actual packaged WASM Session'});
        return JSON.stringify(reply);
      }
      const result=this.actual.call(json),reply=JSON.parse(result);this.stamp=reply.value?.state?.stamp??this.stamp;return result;
    }
    destroy(){this.actual.destroy();}
    free(){this.actual.free();}
  }
  return {manifest:module.manifest,Session:ActualSessionWithControlledReply,resourceCounts:()=>module.resourceCounts()};
}
export async function mount(config = {}) {
  const module = await modulePromise, id = `mount-${++serial}`, element = document.createElement('div');
  element.id = id; element.setAttribute('aria-label',`KlenWriter editor example ${serial}`);
  document.querySelector('#mounts').appendChild(element);
  const profile = config.profile ?? 'kwdj', source = config.source ?? await fixture(config.fixture ?? (profile === 'notes' ? 'Notes-D0' : 'D0'));
  const failures = [], recoveries = [], events = [], faults=[];
  const loaded=config.faultKind?controlledFaultModule(module,config.faultKind,faults):module;
  let resolveLoader,resolveTemporary,loaderCalls=0;
  const temporaryDelay=config.delayReplacement?new Promise(resolve=>{resolveTemporary=resolve;}):null;
  const delayed = config.delayed ? new Promise(resolve => {resolveLoader=resolve;}) : null;
  const editor = mountEditor({element,editor:{input:encode(source),options:await options(profile,config.access ?? 'editable',config.registry ?? 'D0',config.admission ?? 'validate'),loader:() => {loaderCalls++;return config.failLoad ? Promise.reject(new Error('controlled loader rejection')) : config.delayReplacement&&loaderCalls===2 ? temporaryDelay : delayed ?? Promise.resolve(loaded);}},
    renderers:config.badBinding ? defineRendererCatalog({...kwdjBasicRenderers.definition,binding:{...kwdjBasicRenderers.definition.binding,registryDigest:'0'.repeat(64)}}) : profile === 'notes' ? notesD0Renderers : kwdjBasicRenderers,
    ...(config.mode ? {mode:config.mode} : {}),onRefusal:failure => failures.push(copy(failure)),onRecovery:packet => {
      recoveries.push({originalInput:packet.originalInput ? Array.from(packet.originalInput) : null,region:regionSummary(packet.region)});
      if (config.mutateRecovery && packet.originalInput) packet.originalInput.fill(0);
      if (config.throwRecovery) throw new Error('intentional recovery callback failure');
    }});
  const record = {id,editor,element,source,failures,recoveries,events,faults,marks:new Map(),resolveLoader,resolveTemporary,loaderCalls:()=>loaderCalls,ready:null}; records.set(id,record);
  if (config.delayed) return {id,lifecycle:editor.lifecycle,contenteditable:element.getAttribute('contenteditable'),originalInput:Array.from(editor.originalInput() ?? [])};
  const ready = await editor.ready; record.ready = ready;
  if (ready.status === 'ready') editor.subscribe(event => events.push(copy(event)));
  return {id,ready:ready.status,diagnostic:ready.diagnostic ?? null,nativeResponse:ready.response??null,lifecycle:editor.lifecycle,originalInput:editor.originalInput() ? Array.from(editor.originalInput()) : null};
}
export async function releaseLoader(id) {
  const r=rec(id); r.resolveLoader(await modulePromise); r.resolveLoader=null;
  const ready=await r.editor.ready;r.ready=ready;
  if(ready.status==='ready')r.editor.subscribe(event=>r.events.push(copy(event)));
  return {status:ready.status,lifecycle:r.editor.lifecycle};
}
export function nativeRows(id) {
  const r=rec(id), state=r.editor.read({kind:'state'});assert(state.status==='ok' && state.value.kind==='state','Mounted state unavailable');
  const stamp=state.value.state.stamp, rows=[];
  function visit(node,path) {
    const read=r.editor.read({kind:'node',stamp,node});assert(read.status==='ok' && read.value.kind==='node',`Shallow read ${path}`);
    rows.push({path,node:copy(read.value.node)});read.value.node.children.forEach((child,i)=>visit(child,`${path}/${i}`));
  }
  visit(state.value.state.root,'');return {state:copy(state.value.state),rows};
}
export function row(id,path) {const found=nativeRows(id).rows.find(value=>value.path===path);assert(found,`Unknown path ${path}`);return found.node;}
export function domAt(id,path) {
  let node=rec(id).element;
  for(const part of path.split('/').filter(Boolean)) {
    const children=[...node.children].filter(child=>child.hasAttribute('data-editor-node'));node=children[Number(part)];assert(node,`Missing DOM ${path}`);
  }
  return node;
}
export function leaf(id,path) {const outer=domAt(id,path),walker=document.createTreeWalker(outer,NodeFilter.SHOW_TEXT);const node=walker.nextNode();assert(node,`Missing text ${path}`);return node;}
export async function select(id,path,offset,focusPath=path,focusOffset=offset,affinity='after') {
  const r=rec(id);r.element.focus();const a=row(id,path),f=row(id,focusPath);
  const point=(node,value)=>node.primitive==='text'?{kind:'text',node:node.id,offset:value,affinity}:{kind:'child',parent:node.id,index:value,affinity};
  const result=await outcome(r.editor.submit({kind:'set_selection',stamp:r.editor.capture(),selection:{anchor:point(a,offset),focus:point(f,focusOffset)}}));
  assert(response(result).status==='ok','Actual set_selection refused');return result;
}
export async function command(id,intent) {const r=rec(id);return outcome(r.editor.submit({kind:'command',stamp:r.editor.capture(),command:kwdjCommand(intent),history_hint:{kind:'isolated'}}));}
export async function submit(id,request) {const r=rec(id);return outcome(r.editor.submit({...request,...('stamp' in request || !['release_snapshot'].includes(request.kind)?{stamp:r.editor.capture()}:{})}));}
export async function history(id,direction) {return submit(id,{kind:'history',direction});}
export async function snapshot(id) {
  const r=rec(id), state=r.editor.read({kind:'state'}), stamp=r.editor.capture() ?? (state.status==='ok'&&state.value.kind==='state'?state.value.state.stamp:null);
  const result=await outcome(r.editor.submit({kind:'snapshot',stamp,max_bytes:16777216}));
  const reply=response(result);assert(reply.status==='ok'&&reply.value.kind==='snapshot','Actual snapshot refused');
  const released=await outcome(r.editor.submit({kind:'release_snapshot',handle:reply.value.handle}));assert(response(released).status==='ok','Snapshot release');return reply.value.canonical_json;
}
export async function inspect(id) {
  const r=rec(id), native=nativeRows(id), selection=document.getSelection();
  return {...native,lifecycle:r.editor.lifecycle,failures:copy(r.failures),events:copy(r.events),canonical:await snapshot(id),
    capture:copy(r.editor.capture()),context:copy(r.editor.context()),domText:r.element.textContent,ids:[...document.querySelectorAll('[id]')].map(e=>e.id),resources:copy(r.editor.resources()),
    actualSelection:selection?.anchorNode?{anchorText:selection.anchorNode.textContent,anchorOffset:selection.anchorOffset,focusText:selection.focusNode.textContent,focusOffset:selection.focusOffset,inside:r.element.contains(selection.anchorNode)&&r.element.contains(selection.focusNode)}:null,
    attributes:{contenteditable:r.element.getAttribute('contenteditable'),tabindex:r.element.getAttribute('tabindex'),role:r.element.getAttribute('role'),'aria-readonly':r.element.getAttribute('aria-readonly'),'aria-disabled':r.element.getAttribute('aria-disabled')}};
}
export function mark(id,name,path) {const r=rec(id),el=domAt(id,path);r.marks.set(name,{element:el,text:el.querySelector('*')?.firstChild??el.firstChild});}
export function sameIdentity(id,name,path) {return rec(id).marks.get(name)?.element===domAt(id,path);}
export function nativeSelectionMatches(id,path,offset) {const r=rec(id),selection=document.getSelection(),node=leaf(id,path);return selection.anchorNode===node&&selection.focusNode===node&&selection.anchorOffset===offset&&selection.focusOffset===offset;}
export function mode(id,value) {return rec(id).editor.setInteractionMode(value);}
export async function replace(id,nameOrRaw,raw=false) {const r=rec(id);return outcome(await r.editor.replace(encode(raw?nameOrRaw:await fixture(nameOrRaw))));}
export async function dispose(id) {
  const r=rec(id),receipt=r.editor.destroy(),again=r.editor.destroy();if(receipt.sdk.status==='queued')await receipt.sdk.completion;
  return {receipt:receiptSummary(receipt),sameReceipt:receipt===again,resources:copy(r.editor.resources()),recoveries:copy(r.recoveries),native:copy(r.editor.nativeResources())};
}
export async function allDisposed() {for(const id of records.keys())await dispose(id);return JSON.parse((await modulePromise).resourceCounts());}
export function beforeInput(id,inputType,data=null,cancelable=true) {const event=new InputEvent('beforeinput',{bubbles:true,cancelable,inputType,data});rec(id).element.dispatchEvent(event);return event.defaultPrevented;}
export function input(id,inputType,data=null) {rec(id).element.dispatchEvent(new InputEvent('input',{bubbles:true,inputType,data}));}
export function noncancelable(id,inputType,data=null) {
  const r=rec(id),selection=document.getSelection(),anchor=selection.anchorNode,offset=selection.anchorOffset;
  assert(anchor?.nodeType===Node.TEXT_NODE || inputType==='deleteContentBackward','Expected actual text caret');
  let block=anchor.nodeType===Node.TEXT_NODE?anchor.parentElement.closest('p,h1,h2,h3,h4,h5,h6,pre'):selection.anchorNode.closest?.('p,h1,h2,h3,h4,h5,h6,pre');
  assert(block,'Affected text block');beforeInput(id,inputType,data,false);let clonedIdObserved=false;
  if(inputType==='insertText') anchor.replaceData(offset,selection.focusOffset-offset,data);
  else if(inputType==='insertParagraph') {
    const range=document.createRange();range.setStart(anchor,offset);range.setEnd(block,block.childNodes.length);
    const right=block.cloneNode(false);right.appendChild(range.extractContents());
    if(!right.textContent&&right.childNodes.length===0)right.appendChild(document.createElement('br'));
    block.after(right);clonedIdObserved=right.id===block.id&&right.id!=='';range.detach();
    const walker=document.createTreeWalker(right,NodeFilter.SHOW_TEXT),text=walker.nextNode();
    selection.setBaseAndExtent(text??right,0,text??right,0);
  } else if(inputType==='deleteContentBackward') {
    const previous=block.previousElementSibling;assert(previous,'Previous block for join');
    while(block.firstChild)previous.appendChild(block.firstChild);block.remove();
  } else throw new Error('Unsupported harness provisional action');
  input(id,inputType,data);
  return {clonedIdObserved,lifecycle:r.editor.lifecycle,failures:copy(r.failures)};
}
export async function beginComposition(id,path,text) {
  await select(id,path,0);const r=rec(id),node=leaf(id,path);r.element.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));
  node.data=text;r.composing={outer:domAt(id,path.split('/').slice(0,-1).join('/')),text:node};return {lifecycle:r.editor.lifecycle};
}
export function compositionObjectsIntact(id,path,text) {const r=rec(id);return r.composing.text===leaf(id,path)&&r.composing.text.data===text&&r.composing.outer.contains(r.composing.text);}
export function replaceCompositionText(id,text) {rec(id).composing.text.data=text;}
export function original(id) {return rec(id).editor.originalInput();}
export function callbackCounts(id) {const r=rec(id);return {failures:r.failures,recoveries:r.recoveries};}
export function forceDomMutation(id,path,text) {leaf(id,path).data=text;}
export function brandCheck() {const counterfeit={...kwdjBasicRenderers};const element=document.createElement('div');document.querySelector('#mounts').appendChild(element);return mountEditor({element,editor:{input:new Uint8Array(),options:{}},renderers:counterfeit}).ready.then(result=>result.status==='dom_refused'&&result.diagnostic.code==='dom.invalid_options');}
export async function headlessNotesAdmission(name) {
  const module=await modulePromise,source=await fixture(name),editor=createEditor({input:encode(source),options:await options('notes','editable','D1'),loader:async()=>module});
  try {const result=await editor.ready;return {status:result.status,context:editor.context()};}finally{editor.destroy();}
}
export function reentrant(id) {
  const r=rec(id),observations=[],queued=[];
  const first=r.editor.subscribe(event=>{
    if(event.change.kind!=='document')return;
    observations.push({listener:1,canonicalText:r.element.textContent,revision:event.after.revision});
    if(queued.length===0)queued.push(r.editor.submit({kind:'command',stamp:r.editor.capture(),command:kwdjCommand({kind:'insert_text',text:'Y'}),history_hint:{kind:'isolated'}}));
  });
  const second=r.editor.subscribe(event=>{if(event.change.kind==='document')observations.push({listener:2,canonicalText:r.element.textContent,revision:event.after.revision});});
  r.reentrant={observations,queued,first,second};
}
export async function reentrantResult(id) {const r=rec(id);await Promise.all(r.reentrant.queued.map(ticket=>ticket.status==='queued'?ticket.completion:null));return {observations:copy(r.reentrant.observations),ticketKinds:r.reentrant.queued.map(ticket=>ticket.status)};}
export async function metadata() {const module=await modulePromise;return {buildId:sdkBuildId,manifest:module.manifest,native:JSON.parse(module.resourceCounts()),scope:'Actual public mounted DOM+SDK2+compiled WASM. Automated engine; installed native Chrome/Safari are separate evidence.'};}
window.domHost={mount,releaseLoader,fixture,nativeRows,row,domAt,leaf,select,command,submit,history,snapshot,inspect,mark,sameIdentity,nativeSelectionMatches,mode,replace,dispose,allDisposed,beforeInput,input,noncancelable,beginComposition,compositionObjectsIntact,replaceCompositionText,original,callbackCounts,forceDomMutation,brandCheck,headlessNotesAdmission,reentrant,reentrantResult,metadata};
window.domHostReady=true;
export async function rawSelection(id,anchor,focus=anchor) {const r=rec(id);return outcome(r.editor.submit({kind:'set_selection',stamp:r.editor.capture(),selection:{anchor,focus}}));}
export function queryCommand(id,intent) {const r=rec(id);return r.editor.query({kind:'query_command',stamp:r.editor.capture(),command:kwdjCommand(intent)});}
export function read(id,request) {const r=rec(id);return r.editor.read({...request,...(request.kind==='state'?{}:{stamp:r.editor.capture()})});}
export function listenerDestroy(id) {const r=rec(id);let receipt=null,calls=0;r.editor.subscribe(event=>{if(event.change.kind==='document')receipt=r.editor.destroy();});r.editor.subscribe(()=>calls++);r.listenerDisposal=()=>({calls,receipt:receipt?receiptSummary(receipt):null,resources:r.editor.resources()});}
export function listenerDestroyResult(id) {return rec(id).listenerDisposal();}
Object.assign(window.domHost,{rawSelection,queryCommand,read,listenerDestroy,listenerDestroyResult});

export async function faultRequest(id,method) {
  const r=rec(id),stamp=r.editor.capture();
  const response=method==='read'?r.editor.read({kind:'catalog'}):r.editor.query({kind:'query_history',stamp,direction:'undo'});
  return {response,lifecycle:r.editor.lifecycle,contenteditable:r.element.getAttribute('contenteditable'),resources:copy(r.editor.resources()),faults:copy(r.faults),native:copy(r.editor.nativeResources())};
}
Object.assign(window.domHost,{faultRequest});

export async function negativeSource(item) {
  const path=item.input?item.input.path:`inputs/${item.document}.json`;
  const result=await fetch(`/dom-fixtures/${path}`);assert(result.ok,`Missing frozen negative ${path}`);return result.text();
}
export async function startReplacement(id,name) {
  const r=rec(id),source=await fixture(name);r.pendingReplacement=r.editor.replace(encode(source));
  return {loaderCalls:r.loaderCalls(),resources:copy(r.editor.resources()),capture:copy(r.editor.capture()),source};
}
export async function finishReplacement(id) {
  const r=rec(id);assert(r.resolveTemporary,'No delayed temporary loader');r.resolveTemporary(await modulePromise);r.resolveTemporary=null;
  const result=await r.pendingReplacement;return {result:await outcome(result),resources:copy(r.editor.resources()),capture:copy(r.editor.capture()),native:copy(r.editor.nativeResources()),domText:r.element.textContent,loaderCalls:r.loaderCalls()};
}
export async function rawRequest(id,request,query=false) {
  const r=rec(id),owned={...request,stamp:r.editor.capture()};return query?r.editor.query(owned):outcome(r.editor.submit(owned));
}
Object.assign(window.domHost,{negativeSource,startReplacement,finishReplacement,rawRequest});

export function malformedCompositionRequests(id) {
  const r=rec(id),before=nativeRows(id);let accessorCalls=0;
  const accessor={};Object.defineProperty(accessor,'kind',{enumerable:true,get(){accessorCalls++;return 'command';}});
  const results=[r.editor.submit(null),r.editor.query(null),r.editor.submit(accessor),r.editor.query(accessor)];
  return {results,accessorCalls,before,after:nativeRows(id),lifecycle:r.editor.lifecycle};
}
Object.assign(window.domHost,{malformedCompositionRequests});
