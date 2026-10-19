// SPDX-License-Identifier: MIT OR Apache-2.0
// Closed acceptance fixture. Model edits use only the actual public SDK/WASM.
import { createEditor, loadSdkV2, sdkBuildId } from '@klenwriter/editor-sdk';
import { mountEditor } from '@klenwriter/editor-dom';
import { kwdjCommand } from '@klenwriter/editor-kwdj';
import { kwdjBasicRenderers } from '@klenwriter/editor-kwdj/dom';

const names = ['bookmark','native','formatting','clipboard','unicode','scroll'];
const [module, packet, ...data] = await Promise.all([
  loadSdkV2(), fetch('/extensions-packet.json').then(r => r.json()),
  ...names.map(name => fetch(`/selection-contract/${name}-oracles.json`).then(r => {
    if (!r.ok) throw new Error(`Missing frozen selection contract ${name}`);
    return r.json();
  })),
]);
const contracts = Object.fromEntries(names.map((name,index) => [name,data[index]]));
const records = new Map(), encoder = new TextEncoder();
let serial = 0;
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const assert = (ok,message) => { if (!ok) throw new Error(message); };
const rec = id => { const r = records.get(id); assert(r,`Unknown selection mount ${id}`); return r; };
const wire = value => encoder.encode(typeof value === 'string' ? value : JSON.stringify(value));
const settle = result => result?.status === 'queued'
  ? result.completion.then(response => ({status:'queued',response})) : Promise.resolve(result);
function options(config) {
  return {abi:'editor-sdk/2',build_id:sdkBuildId,profile:packet.kwdjProfile,
    admission:'validate',access:config.access ?? 'editable',registry_json:packet.kwdjRegistryJson,
    profile_options_json:JSON.stringify({identities:config.identities ?? {media:[],references:[]},limits:config.limits ?? null})};
}
function state(r) {
  const result = r.editor.read({kind:'state'});
  assert(result.status === 'ok' && result.value.kind === 'state','Actual native state unavailable');
  return result.value.state;
}
function rows(r) {
  const current=state(r), found=[];
  function visit(id,path) {
    const result=r.editor.read({kind:'node',stamp:current.stamp,node:id});
    assert(result.status==='ok' && result.value.kind==='node',`Native row ${path}`);
    found.push({path,node:clone(result.value.node)});
    result.value.node.children.forEach((child,i)=>visit(child,`${path}/${i}`));
  }
  visit(current.root,'');return {state:clone(current),rows:found};
}
function rolePath(value) { return value?.virtual_root ? '' : Array.isArray(value) ? `/${value.join('/')}` : value; }
function bind(r, paths, overwrite=false) {
  const actual=rows(r);
  for (const [name,pathValue] of Object.entries(paths ?? {})) {
    const path=rolePath(pathValue), found=actual.rows.find(row=>row.path===path);
    assert(found,`Frozen role ${name} at ${path} missing`);
    if (overwrite || !r.ids.has(name)) r.ids.set(name,found.node.id);
  }
  return Object.fromEntries(r.ids);
}
function nativePoint(r,p) {
  if (!p) return p;
  const name=p.role ?? p.nodeRole ?? p.node ?? p.parent;
  const id=r.ids.get(name) ?? name;
  if (p.kind==='text') return {kind:'text',node:id,offset:p.offset,affinity:p.affinity ?? 'after'};
  if (p.kind==='child') return {kind:'child',parent:id,index:p.index,affinity:p.affinity ?? 'after'};
  return {kind:'edge',node:id,side:p.side};
}
function nativeSelection(r,value) {return value===null ? null : {anchor:nativePoint(r,value.anchor),focus:nativePoint(r,value.focus)};}
function nativeIntent(r,intent) {
  const result=clone(intent);
  for(const field of ['node','parent'])if(result[field] && r.ids.has(result[field]))result[field]=r.ids.get(result[field]);
  return result;
}
function nodeAt(r,path) {
  assert(r.element,'Headless SDK has no DOM oracle');let node=r.element;
  for(const index of path){assert(Number.isSafeInteger(index)&&index>=0,'Invalid literal DOM path');node=node.childNodes[index];assert(node,'Frozen raw DOM child path missing');}
  return node;
}
function domPath(r,node) {
  const path=[];let current=node;
  while(current && current!==r.element && path.length<64){const parent=current.parentNode;if(!parent)return null;path.unshift([...parent.childNodes].indexOf(current));current=parent;}
  return current===r.element?path:null;
}
function rawPoint(r,node,offset) {return {path:domPath(r,node),nodeType:node?.nodeType??null,text:node?.nodeType===3?node.data:null,offset};}
function rawSelection(r) {
  const selection=document.getSelection();
  return selection?.anchorNode ? {anchor:rawPoint(r,selection.anchorNode,selection.anchorOffset),focus:rawPoint(r,selection.focusNode,selection.focusOffset),inside:r.element?.contains(selection.anchorNode)&&r.element.contains(selection.focusNode)} : null;
}
function setDom(r,selection) {
  const a=nodeAt(r,selection.anchor.path),f=nodeAt(r,selection.focus.path);
  document.getSelection().setBaseAndExtent(a,selection.anchor.offset,f,selection.focus.offset);
}
function trace(r,type,value) {
  if(r.trace.length>=2048){r.traceOverflow=true;return;}
  r.trace.push({type,time:performance.now(),...value});
}
function updateStatus(r,failure) {
  if(failure?.diagnostic?.code!=='dom.stale_selection')return;
  document.querySelector('#selection-status').textContent=r.locale==='ru'
    ? 'Выделение изменилось. Выберите текст снова.' : 'The selection changed. Select the text again.';
}
export async function mount(config={}) {
  const id=`selection-mount-${++serial}`, r={id,headless:!!config.headless,ids:new Map(),bookmarks:new Map(),events:[],failures:[],trace:[],traceOverflow:false,writes:[],results:[],pendingWrites:[],operations:new Map(),locale:config.locale??'en',writerMode:config.writer??'resolve'};
  let element=null;
  if(!r.headless){
    element=document.createElement('div');element.id=id;element.className='selection-example';element.setAttribute('aria-label',`Selection editor ${serial}`);r.element=element;
    if(config.scroll){
      document.body.classList.add('selection-scroll-case');const port=document.createElement('div');port.className='selection-scrollport';port.id=`${id}-port`;r.port=port;
      if(config.scroll==='clipped'){const clip=document.createElement('div');clip.className='selection-clip';document.querySelector('#selection-mounts').append(clip);clip.append(port);r.clip=clip;}
      else document.querySelector('#selection-mounts').append(port);
      port.append(element);
    } else document.querySelector('#selection-mounts').append(element);
  }
  const source=config.source??contracts.bookmark.documents.plain.wire;
  const shared={input:wire(source),options:options(config),loader:()=>module};
  if(r.headless){r.editor=createEditor(shared);r.ready=await r.editor.ready;}
  else {
    r.editor=mountEditor({element,editor:shared,renderers:kwdjBasicRenderers,...(config.mode?{mode:config.mode}:{}),
      onRefusal:failure=>{r.failures.push(clone(failure));updateStatus(r,failure);},
      clipboard:{...(r.writerMode==='platform'?{}:{writeText:text=>{
        r.writes.push({text,utf8Bytes:encoder.encode(text).length,time:performance.now(),provenance:'CONTROLLED trusted host platform writer; not OS clipboard ACK'});
        if(r.writerMode==='throw')throw new Error('Controlled platform writer throw');
        if(r.writerMode==='reject')return Promise.reject(new Error('Controlled platform writer rejection'));
        if(r.writerMode==='pending')return new Promise((resolve,reject)=>r.pendingWrites.push({resolve,reject}));
        return Promise.resolve();
      }}),onResult:result=>{r.results.push(clone(result));if(config.throwResult)throw new Error('Controlled onResult throw');}},
    });r.ready=await r.editor.ready;
  }
  records.set(id,r);
  const admitted=r.headless?r.ready.status==='ok':r.ready.status==='ready';
  if(admitted){
    r.editor.subscribe(event=>{r.events.push(clone(event));if(r.scrollTracing)trace(r,'publication',{event:clone(event),geometry:geometry(id)});});
    bind(r,config.roles??{});
    if(element){
      for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','keydown','keyup','beforeinput','copy','cut'])element.addEventListener(type,event=>{
        if(type==='pointerdown')r.lastPointerId=event.pointerId;
        trace(r,'browser',{event:type,isTrusted:event.isTrusted,pointerId:event.pointerId??null,buttons:event.buttons??null,key:event.key??null,inputType:event.inputType??null,x:event.clientX??null,y:event.clientY??null});
      },true);
    }
  }
  return {id,ready:clone(r.ready),headless:r.headless,roles:Object.fromEntries(r.ids),resources:clone(r.editor.resources())};
}
export function bindRoles(id,paths){return bind(rec(id),paths);}
export function read(id,request){const r=rec(id);return clone(r.editor.read({...request,...(request.kind==='state'||request.kind==='catalog'||request.kind==='resources'?{}:{stamp:r.editor.capture()})}));}
export async function selectModel(id,selection){const r=rec(id);if(r.element)r.element.focus({preventScroll:true});return clone(await settle(r.editor.submit({kind:'set_selection',stamp:r.editor.capture(),selection:nativeSelection(r,selection)})));}
export function selectDomLiteral(id,selection){const r=rec(id);r.element.focus({preventScroll:true});setDom(r,selection);return rawSelection(r);}
export function captureAfterDom(id,selection,name='B'){const r=rec(id),before=rows(r),eventsBefore=r.events.length;setDom(r,selection);const captured=captureBookmark(id,name);return {...captured,immediate:{before,after:rows(r),eventsBefore,eventsAfter:r.events.length,provenance:'Same synchronous fixture turn before asynchronous UA selectionchange'}};}
export async function submit(id,request){const r=rec(id),owned=clone(request);if('selection'in owned)owned.selection=nativeSelection(r,owned.selection);return clone(await settle(r.editor.submit({...owned,stamp:r.editor.capture()})));}
export async function command(id,intent,hint={kind:'isolated'}){const r=rec(id);return clone(await settle(r.editor.submit({kind:'command',stamp:r.editor.capture(),command:kwdjCommand(nativeIntent(r,intent)),history_hint:hint})));}
export function queryCommand(id,intent){const r=rec(id);return clone(r.editor.query({kind:'query_command',stamp:r.editor.capture(),command:kwdjCommand(nativeIntent(r,intent))}));}
export async function history(id,direction){return submit(id,{kind:'history',direction});}
export async function snapshot(id){const r=rec(id),result=await settle(r.editor.submit({kind:'snapshot',stamp:r.editor.capture(),max_bytes:16777216}));assert(result.response?.status==='ok'&&result.response.value.kind==='snapshot','Native canonical snapshot refused');const value=result.response.value;await settle(r.editor.submit({kind:'release_snapshot',handle:value.handle}));return value.canonical_json;}
export async function inspect(id,canonical=true){const r=rec(id),actual=rows(r);return {...actual,roles:Object.fromEntries(r.ids),canonical:canonical?await snapshot(id):null,context:clone(r.editor.context()),events:clone(r.events),failures:clone(r.failures),resources:clone(r.editor.resources()),native:clone(r.editor.nativeResources()),rawDom:r.element?rawSelection(r):null,activeElement:document.activeElement?.id??null,ids:r.element?[...r.element.querySelectorAll('[id]')].map(n=>n.id):[]};}
export function captureBookmark(id,name){const r=rec(id),result=r.editor.selection.captureBookmark();if(result.status==='captured')r.bookmarks.set(name,result.bookmark);return result.status==='captured'?{status:result.status,bookmark:clone(result.bookmark),frozen:Object.isFrozen(result.bookmark),frozenSelection:result.bookmark.selection===null||Object.isFrozen(result.bookmark.selection),resources:clone(r.editor.resources())}:clone(result);}
export function cloneBookmark(id,from,to){const r=rec(id);r.bookmarks.set(to,clone(r.bookmarks.get(from)));}
export function useForeignBookmark(id,other,name,to){rec(id).bookmarks.set(to,rec(other).bookmarks.get(name));}
export async function restoreBookmark(id,name,options={policy:'exact',focus:false}){const r=rec(id);return clone(await settle(r.editor.selection.restoreBookmark(r.bookmarks.get(name),options)));}
export function releaseBookmark(id,name){const r=rec(id);return r.editor.selection.releaseBookmark(r.bookmarks.get(name));}
export function mode(id,value){return rec(id).editor.setInteractionMode(value);}
export async function replace(id,source){return clone(await settle(await rec(id).editor.replace(wire(source))));}
export function outsideFocus(){const el=document.querySelector('#selection-host-control');el.focus();el.setSelectionRange(1,4);return {id:document.activeElement.id,start:el.selectionStart,end:el.selectionEnd};}
export function outsideState(){const el=document.querySelector('#selection-host-control');return {id:document.activeElement.id,start:el.selectionStart,end:el.selectionEnd};}
export function beginProvisional(id,text,path=[0,0,0]){const r=rec(id),node=nodeAt(r,path);assert(node.nodeType===3,'Provisional fixture requires its literal Text object');r.element.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));node.data=text;return {text:node.data,resources:clone(r.editor.resources())};}
export function ownedPointerIntent(id,path,offset){const r=rec(id),node=nodeAt(r,path),range=document.createRange();range.setStart(node,offset);range.collapse(true);const rect=range.getBoundingClientRect();r.element.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:991,pointerType:'mouse',isPrimary:true,button:0,buttons:1,clientX:rect.left,clientY:rect.top+rect.height/2}));setDom(r,{anchor:{path,offset},focus:{path,offset}});r.element.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:991,pointerType:'mouse',isPrimary:true,button:0,buttons:0}));return {provenance:'CONTROLLED synthetic targeting input; actual native selection remains subject to normal owner',rawDom:rawSelection(r)};}
export function literalHit(id,path,offset){const r=rec(id),node=nodeAt(r,path),range=document.createRange();range.setStart(node,offset);range.collapse(true);const box=range.getBoundingClientRect();assert(box.height>0&&Number.isFinite(box.left),'Literal hit caret instrumentation unavailable');return {x:box.left,y:box.top+box.height/2};}
export function installSubscriber(id,request,kind='state'){
  const r=rec(id);let fired=false;r.editor.subscribe(event=>{if(fired||event.change.kind!==kind)return;fired=true;const value={...clone(request),stamp:event.after};if('selection'in value)value.selection=nativeSelection(r,value.selection);r.nestedSubmission=r.editor.submit(value);});
}
export function installFocusListener(id,request){const r=rec(id);r.element.addEventListener('focusin',()=>{const value={...clone(request),stamp:r.editor.capture()};if('selection'in value)value.selection=nativeSelection(r,value.selection);r.nestedSubmission=r.editor.submit(value);},{once:true});}
export async function nestedResult(id){const r=rec(id);return r.nestedSubmission?clone(await settle(r.nestedSubmission)):null;}
export function setWriter(id,mode){assert(['resolve','reject','throw','pending'].includes(mode),'Unknown controlled writer');rec(id).writerMode=mode;}
export function startClipboard(id,action,name='operation'){const r=rec(id);assert(action==='copy'||action==='cut','Closed clipboard action');const promise=r.editor.clipboard[action]();r.operations.set(name,{promise,result:null});promise.then(result=>{r.operations.get(name).result=clone(result);});return {started:true,resources:clone(r.editor.resources()),writes:clone(r.writes)};}
export function settleWriter(id,success=true){const r=rec(id),pending=r.pendingWrites.shift();assert(pending,'No pending controlled platform writer');success?pending.resolve():pending.reject(new Error('Controlled platform writer rejection'));}
export async function clipboardResult(id,name='operation'){const r=rec(id),op=r.operations.get(name);assert(op,'Unknown operation');const result=await op.promise;return {result:clone(result),resources:clone(r.editor.resources()),writes:clone(r.writes),results:clone(r.results)};}
export function clipboardState(id){const r=rec(id);return {resources:clone(r.editor.resources()),writes:clone(r.writes),results:clone(r.results),operations:[...r.operations].map(([name,op])=>({name,result:op.result}))};}
export async function clipboard(id,action){startClipboard(id,action);return clipboardResult(id);}
export async function clipboardAtPublication(id){const r=rec(id);let fired=false;r.editor.subscribe(()=>{if(!fired){fired=true;startClipboard(id,'cut','BUSY');}});const p={kind:'text',node:r.ids.get('L'),offset:0,affinity:'after'};await settle(r.editor.submit({kind:'set_selection',stamp:r.editor.capture(),selection:{anchor:p,focus:p}}));assert(fired,'Actual native publication did not occur');return clipboardResult(id,'BUSY');}
export async function dispose(id){const r=rec(id);if(r.disposed)return clone(r.disposed);const receipt=r.editor.destroy();if(r.headless)await settle(receipt);else await settle(receipt.sdk);r.disposed={resources:clone(r.editor.resources()),native:clone(r.editor.nativeResources()),status:receipt.status};return clone(r.disposed);}
export async function allDisposed(){for(const id of records.keys())await dispose(id);return JSON.parse(module.resourceCounts());}
export function resourceReadbacks(){return [...records].map(([id,r])=>({id,headless:r.headless,resources:clone(r.editor.resources())}));}
export function metadata(){return {buildId:sdkBuildId,manifest:clone(module.manifest),native:JSON.parse(module.resourceCounts()),contractCounts:{bookmark:contracts.bookmark.cases.length,native:contracts.native.cases.length,formatting:contracts.formatting.cases.length,clipboard:contracts.clipboard.cases.length,unicode:contracts.unicode.cases.length,scroll:contracts.scroll.controlledCoreCases.length},scope:'Actual public mounted/SDK2/WASM. Browser protocol input is automated; platform writer controls and synthetic cancel are labelled. No installed native claim.'};}
function rect(value){return {left:value.left,top:value.top,right:value.right,bottom:value.bottom,width:value.width,height:value.height};}
export function geometry(id){
  const r=rec(id),s=document.getSelection(),client=r.port?rect(r.port.getBoundingClientRect()):null,ancestor=r.clip?rect(r.clip.getBoundingClientRect()):null;
  const vv=window.visualViewport;let clip=client?{...client}:null;
  if(clip){clip.left=Math.max(clip.left,ancestor?.left??0,vv?.offsetLeft??0);clip.top=Math.max(clip.top,ancestor?.top??0,vv?.offsetTop??0);clip.right=Math.min(clip.right,ancestor?.right??innerWidth,(vv?.offsetLeft??0)+(vv?.width??innerWidth));clip.bottom=Math.min(clip.bottom,ancestor?.bottom??innerHeight,(vv?.offsetTop??0)+(vv?.height??innerHeight));}
  let caret=null;if(s?.focusNode&&r.element?.contains(s.focusNode)){const range=document.createRange();range.setStart(s.focusNode,s.focusOffset);range.collapse(true);const boxes=[...range.getClientRects()].filter(x=>Number.isFinite(x.top)&&x.height>0);if(boxes.length)caret=rect(boxes[0]);}
  let monotonic=null;
  if(r.previousFocus&&s?.focusNode&&r.element.contains(s.focusNode)){const a=document.createRange(),b=document.createRange();a.setStart(r.previousFocus.node,r.previousFocus.offset);a.collapse(true);b.setStart(s.focusNode,s.focusOffset);b.collapse(true);monotonic=a.compareBoundaryPoints(Range.START_TO_START,b);}
  if(s?.focusNode&&r.element?.contains(s.focusNode))r.previousFocus={node:s.focusNode,offset:s.focusOffset};
  return {time:performance.now(),client,ancestor,effectiveClip:clip,caret,rawDom:r.element?rawSelection(r):null,state:clone(state(r)),scrollTop:r.port?.scrollTop??null,scrollLeft:r.port?.scrollLeft??null,scrollHeight:r.port?.scrollHeight??null,clientHeight:r.port?.clientHeight??null,clientWidth:r.port?.clientWidth??null,allScrollOwners:{windowX:scrollX,windowY:scrollY,portTop:r.port?.scrollTop??0,portLeft:r.port?.scrollLeft??0,clipTop:r.clip?.scrollTop??0,clipLeft:r.clip?.scrollLeft??0},resources:clone(r.editor.resources()),monotonicFromPrevious:monotonic,activeElement:document.activeElement?.id??null,dpr:devicePixelRatio,visualViewport:vv?{offsetLeft:vv.offsetLeft,offsetTop:vv.offsetTop,width:vv.width,height:vv.height,scale:vv.scale}:null};
}
export async function prepareScroll(id,direction){
  const r=rec(id);assert(r.port,'Not a scroll fixture');const faces=await document.fonts.load("400 16px 'OSR40FixtureMono'",'R0123456789');await document.fonts.ready;
  assert(faces.length===1&&faces[0].status==='loaded','Exact fixture FontFace not loaded');
  r.port.scrollTop=direction==='down'?0:1356;r.port.scrollLeft=0;r.previousFocus=null;
  const literal=contracts.scroll;
  const domRows=literal.rawDomRowRoles.map(item=>{const element=nodeAt(r,item.elementChildNodesPath);assert(element.tagName===item.expectedElementTag,`Raw row tag ${item.row}`);let text=null;if(item.textChildNodesPath){const node=nodeAt(r,item.textChildNodesPath);assert(node.nodeType===3&&node.data===item.literalText,`Raw row Text ${item.row}`);text=rect(node.parentElement.getBoundingClientRect());}return {row:item.row,box:rect(element.getBoundingClientRect()),text};});
  return {font:{family:faces[0].family,status:faces[0].status,style:faces[0].style,weight:faces[0].weight},domRows,geometry:geometry(id)};
}
export function startScrollTrace(id){const r=rec(id);r.scrollTracing=true;r.previousFocus=null;r.trace.length=0;return geometry(id);}
export function sampleScroll(id){const r=rec(id),point=geometry(id);trace(r,'sample',{geometry:point});return point;}
export function cancelControlledPointer(id){const r=rec(id);assert(r.lastPointerId!==undefined,'No pointer owner observed');r.element.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:r.lastPointerId,pointerType:'mouse',isPrimary:true,button:0,buttons:0}));return {pointerId:r.lastPointerId,provenance:'CONTROLLED synthetic pointercancel, isTrusted=false. Actual held-mouse cleanup has not occurred.'};}
export function actionTrace(id){const r=rec(id);return {trace:clone(r.trace),overflow:r.traceOverflow,lifecycle:r.editor.lifecycle,failures:clone(r.failures),scope:'Bounded actual publication/browser/sample observations; no canonical export per tick'};}

window.selectionHost={metadata,mount,bindRoles,read,selectModel,selectDomLiteral,captureAfterDom,submit,command,queryCommand,history,snapshot,inspect,captureBookmark,cloneBookmark,useForeignBookmark,restoreBookmark,releaseBookmark,mode,replace,outsideFocus,outsideState,beginProvisional,ownedPointerIntent,literalHit,installSubscriber,installFocusListener,nestedResult,setWriter,startClipboard,settleWriter,clipboardResult,clipboardState,clipboard,clipboardAtPublication,dispose,allDisposed,resourceReadbacks,geometry,prepareScroll,startScrollTrace,sampleScroll,cancelControlledPointer,actionTrace};
window.selectionHostReady=true;
