// SPDX-License-Identifier: MIT OR Apache-2.0
// Public packaged SDK/DOM and production sealed WASM. No matcher or DOM repair.
import {loadSdkV2,sdkBuildId} from '@klenwriter/editor-sdk';
import {mountEditor} from '@klenwriter/editor-dom';
import {kwdjCommand} from '@klenwriter/editor-kwdj';
import {kwdjBasicRenderers,createKwdjTypingRenderers} from '@klenwriter/editor-kwdj/dom';
import {kwdjClipboardCodec} from '@klenwriter/editor-kwdj/clipboard';

const [module,packet,authority]=await Promise.all([loadSdkV2(),fetch('/extensions-packet.json').then(r=>r.json()),fetch('/typing-contract/dom-oracles.json').then(r=>{if(!r.ok)throw Error('Missing frozen typing authority');return r.json();})]);
const records=new Map(),encoder=new TextEncoder();let serial=0;
const clone=value=>value===undefined?undefined:structuredClone(value);
const check=(condition,message)=>{if(!condition)throw Error(message);};
const rec=id=>{const r=records.get(id);check(r,'Unknown closed typing fixture');return r;};
const settle=async result=>result?.status==='queued'?{status:'queued',response:await result.completion}:result;
const nativeState=r=>{const response=r.editor.read({kind:'state'});check(response.status==='ok'&&response.value.kind==='state','Actual native state');return response.value.state;};
function rows(r){
  const state=nativeState(r),found=[],pending=[{id:state.root,path:[]}];
  for(let index=0;index<pending.length;index++){
    check(index<64,'Finite fixture nodes');const row=pending[index],read=r.editor.read({kind:'node',stamp:state.stamp,node:row.id});
    check(read.status==='ok'&&read.value.kind==='node','Actual native node');const node=read.value.node;found.push({path:row.path,node:clone(node)});
    node.children.forEach((id,i)=>pending.push({id,path:[...row.path,i]}));
  }
  return {state:clone(state),rows:found};
}
function at(r,path){let node=r.element;for(const i of path){node=node.childNodes[i];check(node,'Missing independently declared DOM path');}return node;}
function path(r,node){const out=[];while(node&&node!==r.element&&out.length<16){const parent=node.parentNode;if(!parent)return null;out.unshift([...parent.childNodes].indexOf(node));node=parent;}return node===r.element?out:null;}
function raw(r){const s=getSelection(),point=(node,offset)=>({path:path(r,node),nodeType:node?.nodeType??null,text:node?.nodeType===3?node.data:null,offset});return s?.anchorNode?{inside:r.element.contains(s.anchorNode)&&r.element.contains(s.focusNode),anchor:point(s.anchorNode,s.anchorOffset),focus:point(s.focusNode,s.focusOffset)}:null;}
function targetRanges(r,event){
  const phase='capture-before-mounted-listeners';
  if(typeof event.getTargetRanges!=='function')return {phase,status:'unavailable',count:null,ranges:[]};
  try{const ranges=event.getTargetRanges(),count=ranges.length,point=(node,offset)=>{const units=node?.nodeType===3?node.data.length:null;if(units!==null&&units>8192)r.rangeObservationOverflow=true;return {path:path(r,node),nodeType:node?.nodeType??null,text:units!==null&&units<=8192?node.data:null,textUtf16Units:units,offset};};
    if(count>8)r.rangeObservationOverflow=true;
    return {phase,status:'observed',count,ranges:Array.from({length:Math.min(count,8)},(_,i)=>ranges[i]).map(range=>({start:point(range.startContainer,range.startOffset),end:point(range.endContainer,range.endOffset)}))};
  }catch(error){return {phase,status:'error',count:null,ranges:[],error:String(error?.message??error).slice(0,256)};}
}
function tree(node){if(node.nodeType===3)return {nodeType:3,text:node.data};check(node.nodeType===1,'Closed DOM inspection');return {nodeType:1,tag:node.tagName.toLowerCase(),attributes:Object.fromEntries([...node.attributes].map(a=>[a.name,a.value])),children:[...node.childNodes].map(tree)};}
function resolve(r,value){
  if(value==='$source.text')return r.roles.text;if(value==='$source.block')return r.roles.block;if(value==='$source.root')return r.roles.root;
  if(Array.isArray(value))return value.map(v=>resolve(r,v));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolve(r,v)]));return value;
}
function recovery(value){if(!value)return null;const c=value.composition,t=value.typedInput;return {region:value.region?.kind??null,originalText:value.region?.originalText??null,provisionalText:value.region?.provisionalText??null,
  composition:c?{generation:c.generation,reason:c.reason,nativeOutcome:c.nativeOutcome,base:clone(c.base),selection:clone(c.selection),context:clone(c.context),response:clone(c.response)}:null,
  typedInput:t?{format:t.format,origin:t.origin,stamp:clone(t.stamp),selection:clone(t.selection),nativeOutcome:t.nativeOutcome,original:t.original.kind==='bounded'?clone(t.original):{kind:t.original.kind,reason:t.original.reason},response:clone(t.response)}:null};}
function observedModule(r){
  class ObservedSession {
    constructor(input,options){this.actual=new module.Session(input,options);}
    initialization(){return this.actual.initialization();}context(){return this.actual.context();}
    call(bytes){
      check(r.nativeCalls.length<4096&&r.nativeBytes<4194304,'Finite native observation cap');
      const request=JSON.parse(bytes),row={sequence:r.nativeCalls.length+1,request,requestJson:bytes};r.nativeCalls.push(row);r.nativeBytes+=encoder.encode(bytes).length;
      try{const result=this.actual.call(bytes);row.responseJson=result;row.response=JSON.parse(result);r.nativeBytes+=encoder.encode(result).length;check(r.nativeBytes<=4194304,'Finite native observation bytes');return result;}
      catch(error){row.thrown=String(error?.message??error);throw error;}
    }
    destroy(){this.actual.destroy();}free(){this.actual.free();}
  }
  return {manifest:module.manifest,Session:ObservedSession,resourceCounts:()=>module.resourceCounts()};
}
export function metadata(){return {buildId:sdkBuildId,manifest:clone(module.manifest),scope:'Actual packaged SDK2/DOM/production sealed WASM. Browser keyboard delivery and controlled event/DOM drivers are labelled separately; neither is physical installed input.',typingCommands:createKwdjTypingRenderers().definition.inventory.commands,baseCommands:kwdjBasicRenderers.definition.inventory.commands};}
export async function mount({fixture='quote',typing='defaults',source=null,textPath=null,locale=null,rules=null,selection=null}={}){
  const f=authority.fixtures[fixture];check(f,'Declared frozen fixture');const enabled=typing!==null;
  check(locale===null||locale==='ru'||locale==='en','Closed explicit locale');
  const config=typing==='defaults'?{version:1,locale:locale??f.config.locale,rules,limits:null}:typing;
  const id=`typing-mount-${++serial}`,element=document.createElement('div');element.id=id;element.setAttribute('aria-label','Typing editor');document.getElementById('typing-mounts').append(element);
  const r={id,element,fixture,definition:f,roles:{},events:[],failures:[],recoveries:[],nativeCalls:[],nativeBytes:0,inputTrace:[],beforeInputRanges:new WeakMap(),rangeObservationOverflow:false,removals:[],disposed:null};records.set(id,r);
  // Observe immutable coordinates before mountEditor registers its handlers.
  // No event, StaticRange or DOM node is changed or retained by this observer.
  const capture=event=>r.beforeInputRanges.set(event,targetRanges(r,event));element.addEventListener('beforeinput',capture,true);r.removals.push(()=>element.removeEventListener('beforeinput',capture,true));
  const options={abi:'editor-sdk/2',build_id:sdkBuildId,profile:enabled?packet.kwdjTypingProfile:packet.kwdjProfile,admission:'validate',access:'editable',registry_json:enabled?packet.kwdjTypingRegistryJson:packet.kwdjRegistryJson,
    profile_options_json:JSON.stringify({identities:{media:[],references:[]},limits:null,...(enabled?{typing_rules:config}:{})})};
  check(options.profile&&typeof options.registry_json==='string','Explicit generated typing/base packet binding');
  r.editor=mountEditor({element,editor:{input:encoder.encode(source??f.initial.canonical_json),options,loader:()=>observedModule(r)},renderers:enabled?createKwdjTypingRenderers():kwdjBasicRenderers,
    clipboard:{codec:kwdjClipboardCodec({allow_origin_relative:true,allowed_schemes:['http','https']})},onRefusal:value=>r.failures.push(clone(value)),onRecovery:value=>r.recoveries.push(recovery(value))});
  const ready=await r.editor.ready;check(ready.status==='ready','Actual configured mount: '+JSON.stringify(ready));
  const initial=rows(r);for(const [name,p]of Object.entries({root:[],block:[0],text:[0,0]})){const row=initial.rows.find(row=>JSON.stringify(row.path)===JSON.stringify(p));check(row,'Initial source-bound role '+name);r.roles[name]=row.node.id;}
  r.editor.subscribe(event=>r.events.push(clone(event)));
  for(const type of ['keydown','keyup','beforeinput','input','compositionstart','compositionupdate','compositionend','focusin','focusout']){
    const observe=event=>{check(r.inputTrace.length<512,'Finite input trace');r.inputTrace.push({event:type,isTrusted:event.isTrusted,inputType:event.inputType??null,data:event.data??null,key:event.key??null,code:event.code??null,isComposing:event.isComposing??null,cancelable:event.cancelable,defaultPrevented:event.defaultPrevented,targetRanges:type==='beforeinput'?clone(r.beforeInputRanges.get(event)??{status:'missing_capture'}):null});};
    element.addEventListener(type,observe);r.removals.push(()=>element.removeEventListener(type,observe));
  }
  check(textPath===null||JSON.stringify(textPath)==='[0,0,0,0]','Closed additional mark presentation path');
  r.textPath=textPath??(fixture==='marked'?[0,0,0,0]:[0,0,0]);const authored=resolve(r,f.selection);
  if(source!==null&&selection===null){const n=initial.rows.find(row=>row.node.id===r.roles.text).node;authored.anchor.offset=authored.focus.offset=n.text.length;}
  await select(id,selection??authored);
  const before=await inspect(id);return {id,ready:clone(ready),before};
}
export function focus(id){const r=rec(id);r.element.focus({preventScroll:true});return {focused:document.activeElement===r.element,rawDom:raw(r)};}
export async function reacquireRetiredQuote(id){
  const r=rec(id),before=nativeState(r),expected=resolve(r,authority.states.quote_cooked_retired.selection);
  check(r.fixture==='quote'&&JSON.stringify(before.selection)===JSON.stringify(expected),'Closed source-bound retired quote selection');
  check(r.editor.resources().typing.armedSlots===0,'Retirement must be proved before focus acquisition');
  check(r.editor.resources().selection.bookmarks===0,'No prior setup bookmark');
  const captured=r.editor.selection.captureBookmark();check(captured.status==='captured','Capture actual current native selection while outside');
  let submitted,released;
  try{
    check(r.editor.resources().selection.bookmarks===1,'Exactly one public setup bookmark');
    check(JSON.stringify(captured.bookmark.selection)===JSON.stringify(expected),'Bookmark retains independently authored source selection');
    submitted=await settle(r.editor.selection.restoreBookmark(captured.bookmark,{policy:'exact',focus:true}));
    check(submitted.response?.status==='ok','Exact public bookmark restoration');
  }finally{
    released=r.editor.selection.releaseBookmark(captured.bookmark);
    check(r.editor.resources().selection.bookmarks===0,'Release setup bookmark even if restoration fails');
  }
  check(JSON.stringify(nativeState(r))===JSON.stringify(before),'Focus acquisition must not change native state or history');
  return {strategy:'public exact native bookmark with focus; no text or DOM repair',submission:clone(submitted),released,bookmarks:r.editor.resources().selection.bookmarks,focused:document.activeElement===r.element,rawDom:raw(r)};
}
export async function select(id,selection){const r=rec(id);check(selection&&typeof selection==='object','Explicit authored selection');
  const point=p=>{check(p&&p.kind==='text'&&Number.isSafeInteger(p.offset)&&p.offset>=0,'Closed text selection point');check(p.node===r.roles.text||p.node==='$source.text'||JSON.stringify(p.path)==='[0,0]','Only the authored source Text');check(p.affinity==='before'||p.affinity==='after','Explicit affinity');return {kind:'text',node:r.roles.text,offset:p.offset,affinity:p.affinity};};
  const expected={anchor:point(selection.anchor),focus:point(selection.focus)};focus(id);
  const submitted=await settle(r.editor.submit({kind:'set_selection',stamp:r.editor.capture(),selection:expected}));check(submitted.response?.status==='ok','Authored native selection');
  const node=at(r,r.textPath);check(node.nodeType===3,'Literal source Text');getSelection().setBaseAndExtent(node,expected.anchor.offset,node,expected.focus.offset);
  const bookmark=r.editor.selection.captureBookmark();check(bookmark.status==='captured','Literal native/DOM correspondence');check(r.editor.selection.releaseBookmark(bookmark.bookmark),'Release setup bookmark');
  return {submission:clone(submitted),selection:clone(expected),rawDom:raw(r)};
}
export async function snapshot(id){const r=rec(id),result=await settle(r.editor.submit({kind:'snapshot',stamp:r.editor.capture()??nativeState(r).stamp,max_bytes:65536}));check(result.response?.status==='ok'&&result.response.value.kind==='snapshot','Public canonical snapshot');const v=result.response.value;const released=await settle(r.editor.submit({kind:'release_snapshot',handle:v.handle}));check(released.response?.status==='ok','Release public snapshot');return v.canonical_json;}
export async function inspect(id){const r=rec(id),actual=rows(r),canonical=await snapshot(id);return {...actual,canonical,roles:clone(r.roles),context:clone(r.editor.context()),lifecycle:r.editor.lifecycle,events:clone(r.events),failures:clone(r.failures),recovery:clone(r.recoveries.at(-1)??null),resources:clone(r.editor.resources()),native:clone(r.editor.nativeResources()),rawDom:raw(r),dom:[...r.element.childNodes].map(tree),domText:r.element.textContent,activeElementId:document.activeElement?.id??null,inputTrace:clone(r.inputTrace),rangeObservationOverflow:r.rangeObservationOverflow,nativeCalls:clone(r.nativeCalls),nativeBytes:r.nativeBytes};}
export function ordinary(id,{data='"',inputType='insertText',cancelable=true,rawText=null}={}){
  const r=rec(id),event=new InputEvent('beforeinput',{bubbles:true,cancelable,inputType,data,isComposing:false});r.element.dispatchEvent(event);
  if(!cancelable){check(typeof rawText==='string','Declared noncancelable raw DOM delta');const node=at(r,r.textPath);node.data=rawText;getSelection().setBaseAndExtent(node,rawText.length,node,rawText.length);r.element.dispatchEvent(new InputEvent('input',{bubbles:true,inputType,data,isComposing:false}));}
  return {defaultPrevented:event.defaultPrevented,isTrusted:event.isTrusted,qualification:'Controlled synthetic beforeinput; optional declared UA-like raw DOM delta, no physical-input claim'};
}
export function backspace(id){const r=rec(id),key=new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Backspace',code:'Backspace'}),input=new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'deleteContentBackward',data:null});r.element.dispatchEvent(key);r.element.dispatchEvent(input);r.element.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key:'Backspace',code:'Backspace'}));return {defaultPrevented:input.defaultPrevented,isTrusted:input.isTrusted};}
export async function history(id,direction){check(['undo','redo'].includes(direction),'Closed history direction');const r=rec(id);return clone(await settle(r.editor.submit({kind:'history',stamp:r.editor.capture(),direction})));}
export async function literal(id,text){const r=rec(id);return clone(await settle(r.editor.submit({kind:'command',stamp:r.editor.capture(),command:kwdjCommand({kind:'insert_text',text}),history_hint:{kind:'isolated'}})));}
export async function paste(id,text){const r=rec(id);check(typeof text==='string'&&text.length<128,'Bounded controlled paste text');return clone(await r.editor.clipboard.paste({types:['text/plain'],items:[{kind:'string',type:'text/plain'}],files:{length:0},getData:type=>type==='text/plain'?text:''}));}
export function compositionStart(id){const r=rec(id);r.element.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));return {isTrusted:false};}
export function preedit(id,{rawText,data}={}){const r=rec(id);check(typeof rawText==='string'&&rawText.length<128,'Declared raw preedit');r.element.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,inputType:'insertCompositionText',data,isComposing:true}));const node=at(r,r.textPath);node.data=rawText;getSelection().setBaseAndExtent(node,rawText.length,node,rawText.length);r.element.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data,isComposing:true}));r.element.dispatchEvent(new CompositionEvent('compositionupdate',{bubbles:true,data}));return {raw:raw(r),label:'Controlled actual DOM preedit; synthetic event identities, not OS IME'};}
export function compositionEnd(id,data='misleading'){rec(id).element.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data}));}
export function echo(id){const element=rec(id).element;element.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:null,isComposing:false}));}
export async function frames(count=4){check(Number.isSafeInteger(count)&&count>=1&&count<=12,'Finite settling observations');for(let i=0;i<count;i++)await new Promise(requestAnimationFrame);}
export async function invalidate(id,kind){const r=rec(id);
  if(kind==='same-selection')return clone(await settle(r.editor.submit({kind:'set_selection',stamp:r.editor.capture(),selection:nativeState(r).selection})));
  if(kind==='empty-literal')return literal(id,'');
  if(kind==='barrier')return clone(await settle(r.editor.submit({kind:'barrier',stamp:r.editor.capture()})));
  if(kind==='pointer'){r.element.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:1,button:0,buttons:1}));return {isTrusted:false};}
  if(kind==='blur'){document.getElementById('typing-outside').focus();return {focus:r.element===document.activeElement,qualification:'Stop outside before independent retirement proof; reacquire separately'};}
  if(kind==='readOnly'||kind==='disabled'){const first=r.editor.setInteractionMode(kind),second=r.editor.setInteractionMode('editable');return {first:clone(first),second:clone(second)};}
  throw Error('Unknown closed invalidator');
}
export async function dispose(id){const r=rec(id);if(r.disposed)return clone(r.disposed);
  if(!r.editor){for(const remove of r.removals.splice(0))remove();r.element.remove();r.disposed={id,mountStatus:'no_controller_returned',resources:null,native:JSON.parse(module.resourceCounts()),nativeObservationScope:'module-global; no mounted controller was returned, numeric SDK owner counts are not invented',fixtureListeners:r.removals.length,rangeObservationOverflow:r.rangeObservationOverflow};return clone(r.disposed);}
  const receipt=r.editor.destroy();await settle(receipt.sdk);for(const remove of r.removals.splice(0))remove();r.element.remove();r.disposed={id,mountStatus:'controller_destroyed',resources:clone(r.editor.resources()),native:clone(r.editor.nativeResources()),recovery:recovery(receipt.recovery),fixtureListeners:r.removals.length,rangeObservationOverflow:r.rangeObservationOverflow};return clone(r.disposed);}
export async function allDisposed(){const readbacks=[];for(const id of records.keys())readbacks.push(await dispose(id));return {readbacks,native:JSON.parse(module.resourceCounts())};}
export function keyResultCounts(id){const r=rec(id),commands=r.nativeCalls.filter(row=>['input_command','command','history'].includes(row.request.kind));return {state:clone(nativeState(r)),domText:r.element.textContent,resources:clone(r.editor.resources()),documentPublications:r.events.filter(event=>event.change.kind==='document').length,commands:commands.map(row=>({request:clone(row.request),response:clone(row.response)})),inputTrace:clone(r.inputTrace),rangeObservationOverflow:r.rangeObservationOverflow};}
export function prepareInstalled(nonce){check(typeof nonce==='string'&&/^[a-f0-9]{32}$/.test(nonce),'Closed installed fixture nonce');check(location.href==='http://127.0.0.1:4174/typing','Exact installed fixture route');document.title='KlenWriter Typography native '+nonce;return {title:document.title,url:location.href,metadata:metadata(),qualification:'Installed foreground fixture prepared only; no input or acceptance inferred'};}

// SOURCE03 controlled UA schedule. This helper belongs only to typingHost;
// installed typographyHost exposes no synthetic event or DOM mutation driver.
export function transientTerminal(id,variant='complete'){
  const r=rec(id),allowed=['complete','pending-at-end','missing-delete-before','attributed-br','foreign-tail','wrong-insert-range','repeat-echo','wrong-code-echo','ordinary-after-echo','payload-end-no-echo','closing-echo'];
  check(allowed.includes(variant),'Closed transient-terminal controlled variant');
  const key=(type,key,code,extra={})=>{const e=new KeyboardEvent(type,{bubbles:true,cancelable:type==='keydown',key,code,...extra});r.element.dispatchEvent(e);return {type,key,code,isTrusted:e.isTrusted,defaultPrevented:e.defaultPrevented};};
  if(variant==='closing-echo')return {qualification:'Controlled synthetic late echo only; no input event',keys:[key('keydown','é','KeyE'),key('keyup','e','KeyE')]};
  const p=at(r,[0]),oldSpan=at(r,[0,0]),oldText=at(r,[0,0,0]),tail=at(r,[1]);
  check(p.tagName==='P'&&oldSpan.tagName==='SPAN'&&oldText.nodeType===3&&oldText.data==='old','Exact source-first sole-Text fixture');
  const nativeBefore=clone(nativeState(r)),initialRaw=raw(r);check(initialRaw.anchor.offset===0&&initialRaw.focus.offset===3,'Exact full forward original source selection');
  const stages=[],record=name=>stages.push({name,dom:tree(p),raw:raw(r),state:clone(nativeState(r)),sameBlock:at(r,[0])===p,sameTail:at(r,[1])===tail,oldSpanConnected:r.element.contains(oldSpan)});
  const input=(type,inputType,data,cancelable,isComposing,range=null)=>{
    const e=new InputEvent(type,{bubbles:true,cancelable,inputType,data,isComposing});
    // Closed synthetic carrier: engines may sanitize constructor inputType.
    // This immutable own value is controlled test data; isTrusted stays false.
    Object.defineProperty(e,'inputType',{value:inputType,writable:false,configurable:false});
    if(range){const value=new StaticRange({startContainer:range.node,startOffset:range.start,endContainer:range.node,endOffset:range.end});Object.defineProperty(e,'getTargetRanges',{value:()=>[value]});}
    r.element.dispatchEvent(e);return {type:e.type,inputType:e.inputType,isTrusted:e.isTrusted,defaultPrevented:e.defaultPrevented};
  };
  const events=[];key('keydown','Alt','AltLeft',{altKey:true});
  r.element.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'old'}));
  r.element.dispatchEvent(new CompositionEvent('compositionupdate',{bubbles:true,data:'´'}));
  events.push(input('beforeinput','insertCompositionText','´',false,true,{node:oldText,start:0,end:3}));
  oldText.data='´';getSelection().setBaseAndExtent(oldText,0,oldText,1);
  events.push(input('input','insertCompositionText','´',false,true));
  key('keydown','Dead','KeyE',{altKey:true,isComposing:true});key('keyup','´','KeyE',{altKey:true,isComposing:true});key('keyup','Alt','AltLeft',{isComposing:true});
  record('provisional acute in original SPAN before owned deletion');
  if(variant!=='missing-delete-before')events.push(input('beforeinput','deleteCompositionText',null,false,true,{node:oldText,start:0,end:1}));
  const br=document.createElement('br');if(variant==='attributed-br')br.setAttribute('data-foreign','x');p.replaceChildren(br);getSelection().setBaseAndExtent(p,0,p,0);
  events.push(input('input','deleteCompositionText',null,false,true));record('actual one fresh BR and original block child0');
  if(variant==='pending-at-end'){r.element.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'é'}));return {qualification:'Controlled pending BR at end; old immediate refusal required',nativeBefore,stages,events};}
  if(variant==='foreign-tail')tail.setAttribute('data-foreign','x');
  const range=variant==='wrong-insert-range'?{node:p,start:0,end:1}:{node:p,start:0,end:0};
  events.push(input('beforeinput','insertFromComposition','é',true,true,range));
  const payload=document.createTextNode('é');p.replaceChildren(payload);getSelection().setBaseAndExtent(payload,1,payload,1);
  events.push(input('input','insertFromComposition','é',false,true));record('actual direct Text payload BEFORE compositionend');
  r.element.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'é'}));
  const keys=[];if(variant!=='payload-end-no-echo'){
    keys.push(key('keydown','é',variant==='wrong-code-echo'?'KeyQ':'KeyE'));
    if(variant==='repeat-echo')keys.push(key('keydown','é','KeyE',{repeat:true}));
    keys.push(key('keyup','e',variant==='wrong-code-echo'?'KeyQ':'KeyE'));
    if(variant==='ordinary-after-echo')events.push(input('beforeinput','insertText','é',true,false,{node:payload,start:1,end:1}));
  }
  record('after terminal and controlled echo, before settlement RAF');
  return {qualification:'Controlled synthetic source-observed Safari event schedule with actual DOM mutations; no trusted or OS provenance',nativeBefore,initialRaw,stages,events,keys,oldSpanDetached:!r.element.contains(oldSpan),directPayloadBeforeEnd:stages.find(s=>s.name==='actual direct Text payload BEFORE compositionend').dom.children.length===1&&stages.find(s=>s.name==='actual direct Text payload BEFORE compositionend').dom.children[0].nodeType===3};
}

window.typingHost={transientTerminal,metadata,mount,select,focus,reacquireRetiredQuote,inspect,ordinary,backspace,history,literal,paste,compositionStart,preedit,compositionEnd,echo,frames,invalidate,dispose,allDisposed,keyResultCounts,prepareInstalled};
// Installed driver receives observations/setup only, with no arbitrary command
// submit, synthetic event driver or programmatic text-insertion method.
window.typographyHost={metadata,mount,select,focus,inspect,dispose,allDisposed,keyResultCounts,prepareInstalled};window.typingHostReady=true;window.typographyHostReady=true;

// Additive controlled carrier only. The original transientTerminal variants and
// installed typographyHost facade above are unchanged. No trust field is changed.
export function transientTerminal229(id,variant='complete'){
  check(variant==='complete'||variant==='ordinary-after','Closed controlled229 variant');
  const delivery=transientTerminal(id,'payload-end-no-echo'),r=rec(id),keys=[],events=[...delivery.events];
  for(const [type,key,keyCode]of [['keydown','é',229],['keyup','e',69]]){
    const e=new KeyboardEvent(type,{bubbles:true,cancelable:type==='keydown',key,code:'KeyE',keyCode,which:keyCode,isComposing:false,repeat:false,altKey:false,ctrlKey:false,metaKey:false,shiftKey:false});
    // Deprecated constructor fields are an explicit immutable synthetic carrier,
    // just as the existing closed inputType carrier is controlled fixture data.
    Object.defineProperties(e,{keyCode:{value:keyCode,writable:false,configurable:false},which:{value:keyCode,writable:false,configurable:false}});
    r.element.dispatchEvent(e);keys.push({type:e.type,key:e.key,code:e.code,keyCode:e.keyCode,which:e.which,isComposing:e.isComposing,repeat:e.repeat,altKey:e.altKey,ctrlKey:e.ctrlKey,metaKey:e.metaKey,shiftKey:e.shiftKey,isTrusted:e.isTrusted,cancelable:e.cancelable,defaultPrevented:e.defaultPrevented});
  }
  if(variant==='ordinary-after'){
    const payload=at(r,[0]).firstChild;check(payload?.nodeType===3&&payload.data==='é','Actual direct payload before the unpermitted ordinary input');
    const e=new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertText',data:'é',isComposing:false});
    Object.defineProperty(e,'inputType',{value:'insertText',writable:false,configurable:false});
    const range=new StaticRange({startContainer:payload,startOffset:1,endContainer:payload,endOffset:1});Object.defineProperty(e,'getTargetRanges',{value:()=>[range]});
    r.element.dispatchEvent(e);events.push({type:e.type,inputType:e.inputType,data:e.data,isComposing:e.isComposing,isTrusted:e.isTrusted,cancelable:e.cancelable,defaultPrevented:e.defaultPrevented});
  }
  return {...delivery,qualification:'Controlled synthetic completed terminal + explicit keyCode/which229. No trusted input, physical causality, OS timing or new native oracle claim.',keys,events};
}
window.typingHost.transientTerminal229=transientTerminal229;
