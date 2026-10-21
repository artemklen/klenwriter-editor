// SPDX-License-Identifier: MIT OR Apache-2.0
// Controlled source/platform actions; actual packaged mounted SDK2 and sealed WASM.
import {createEditor,createCommand,loadSdkV2,sdkBuildId} from '@klenwriter/editor-sdk';
import {mountEditor} from '@klenwriter/editor-dom';
import {kwdjBasicRenderers} from '@klenwriter/editor-kwdj/dom';
import {kwdjClipboardCodec,decodeClipboard} from '@klenwriter/editor-kwdj/clipboard';

const [module,packet,...corpus]=await Promise.all([loadSdkV2(),fetch('/extensions-packet.json').then(r=>r.json()),
  ...['positive','negative'].map(name=>fetch(`/clipboard-contract/${name}.json`).then(r=>{if(!r.ok)throw Error('Missing clipboard corpus');return r.json();}))]);
const records=new Map(), encoder=new TextEncoder();let serial=0;
const policy=Object.freeze({allow_origin_relative:true,allowed_schemes:Object.freeze(['http','https'])});
const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
const check=(yes,message)=>{if(!yes)throw Error(message);};
const record=id=>{const value=records.get(id);check(value,'Unknown clipboard mount');return value;};
const settle=async value=>value?.status==='queued'?{status:'queued',response:await value.completion}:value;
const p=text=>({type:'paragraph',content:text===''?[]:[{type:'text',text}]});
const doc=(content,mode='prose')=>({schema:'klenwriter.document',schema_version:1,profile:mode,content});
const binding={profile_id:'org.klenwriter.kwdj',profile_version:'1.0.0',codec_id:'org.klenwriter.kwdj/json',wire_version:1};
const label='CONTROLLED DataTransfer-like string source / trusted host writer; no OS clipboard delivery or installed-input claim';
function options(){return{abi:'editor-sdk/2',build_id:sdkBuildId,profile:packet.kwdjProfile,admission:'validate',access:'editable',registry_json:packet.kwdjRegistryJson,profile_options_json:JSON.stringify({identities:{media:[],references:[]},limits:null})};}
function state(r){const response=r.editor.read({kind:'state'});check(response.status==='ok'&&response.value.kind==='state','Native state refused');return response.value.state;}
function rows(r){const current=state(r),result=[];let count=0;
  const visit=(id,path)=>{check(++count<=8192,'Fixture native read bound');const read=r.editor.read({kind:'node',stamp:current.stamp,node:id});check(read.status==='ok'&&read.value.kind==='node','Native node read refused');result.push({path,node:clone(read.value.node)});read.value.node.children.forEach((child,index)=>visit(child,[...path,index]));};
  visit(current.root,[]);return{state:clone(current),rows:result};}
function role(r,path){const found=rows(r).rows.find(row=>JSON.stringify(row.path)===JSON.stringify(path));check(found,'Literal native role path missing');return found.node.id;}
function point(r,position){if(position.kind==='text')return{kind:'text',node:role(r,position.path),offset:position.offset,affinity:position.affinity??'after'};return{kind:'child',parent:role(r,position.path),index:position.index,affinity:position.affinity??'after'};}
function at(r,path){let node=r.element;for(const index of path){check(Number.isSafeInteger(index)&&index>=0,'Invalid literal DOM path');node=node.childNodes[index];check(node,'Missing literal DOM path');}return node;}
function path(r,node){const value=[];while(node&&node!==r.element&&value.length<128){const parent=node.parentNode;if(!parent)return null;value.unshift([...parent.childNodes].indexOf(node));node=parent;}return node===r.element?value:null;}
function raw(r){if(!r.element)return null;const s=getSelection();const end=(n,o)=>({path:path(r,n),offset:o,nodeType:n?.nodeType??null,text:n?.nodeType===3?n.data:null});return s?.anchorNode?{inside:r.element.contains(s.anchorNode)&&r.element.contains(s.focusNode),anchor:end(s.anchorNode,s.anchorOffset),focus:end(s.focusNode,s.focusOffset),rangeText:s.toString()}:null;}
function source(r,payload){const data=Object.freeze({...payload});const types=Object.keys(data);check(types.length<=4,'Closed fixture source bound');const calls=[];let active=true;
  const value={types,items:types.map(type=>({kind:'string',type})),files:{length:0},getData(format){calls.push(format);check(active,'Late source string read after synchronous event/API return');return data[format]??'';}};
  r.sources.push({label,calls,types,original:data,retire(){active=false;}});return value;}
export async function mount(config={}){
  const id=`clipboard-mount-${++serial}`,r={id,headless:!!config.headless,writes:[],writePending:[],writer:config.writer??'resolve',events:[],failures:[],pasteResults:[],copyResults:[],sources:[],hostTransfers:[],deferred:null,disposed:false,operation:null,throwResult:!!config.throwResult,platform:config.writer==='platform',capturedInputs:[],trustedEvents:[],observers:[]};
  const codec=kwdjClipboardCodec(policy);r.codec=codec;
  const configured=Object.freeze({...codec,async decode(input){if(r.platform){check(r.capturedInputs.length<16,'Installed capture observation bound');r.capturedInputs.push(clone(input.capture));}let result=await codec.decode(input);
    if(config.decode==='foreign-profile'&&result.status==='candidate'){const intent=JSON.parse(result.command.payload_json),f=JSON.parse(intent.fragment_json);f.source_profile.profile_id='org.example.notes';result={...result,command:createCommand(result.command.id,{kind:'insert_fragment',fragment_json:JSON.stringify(f)})};}
    if(config.decode==='deferred')return new Promise(resolve=>{r.deferred={resolve,result};});return result;}});
  const shared={input:encoder.encode(typeof config.source==='string'?config.source:JSON.stringify(config.source??doc([p('abc'),p('def')]))),options:options(),loader:()=>module};
  if(r.headless){r.editor=createEditor(shared);r.ready=await r.editor.ready;check(r.ready.status==='ok','Headless SDK admission failed');}
  else{const element=document.createElement('div');element.id=id;element.className='clipboard-example';element.setAttribute('aria-label','Clipboard editor '+serial);document.querySelector('#clipboard-mounts').append(element);r.element=element;
    const write=payload=>{r.writes.push({payload:clone(payload),label,time:performance.now()});if(r.writer==='reject')return Promise.reject(Error('Controlled writer refusal'));if(r.writer==='pending')return new Promise((resolve,reject)=>r.writePending.push({resolve,reject}));return Promise.resolve();};
    r.editor=mountEditor({element,editor:shared,renderers:kwdjBasicRenderers,onRefusal:failure=>r.failures.push(clone(failure)),clipboard:{codec:configured,...(r.platform?{}:{write,writeText:text=>write({text})}),
      onPasteResult:outcome=>{r.pasteResults.push(clone(outcome));document.querySelector('#clipboard-status').textContent=outcome.status==='refused'?'Paste refused; inspect explicit raw-retention receipt.':'Paste '+outcome.status+'.';if(r.throwResult)throw Error('Controlled observer throw');},onResult:outcome=>r.copyResults.push(clone(outcome))}});
    r.ready=await r.editor.ready;check(r.ready.status==='ready','Mounted provider admission failed');
    if(r.platform)for(const name of ['paste','copy','cut','keydown','keyup','beforeinput']){const observe=event=>{check(r.trustedEvents.length<512,'Installed event observation bound');r.trustedEvents.push({type:name,isTrusted:event.isTrusted,inputType:event.inputType??null,key:event.key??null,code:event.code??null,time:performance.now()});};element.addEventListener(name,observe,true);r.observers.push(()=>element.removeEventListener(name,observe,true));}
  }
  records.set(id,r);r.editor.subscribe(event=>r.events.push(clone(event)));return{id,ready:clone(r.ready),label:r.platform?'ACTUAL platform writer and trusted-input observations; key delivery and native effect require separate receipts':label,headless:r.headless};
}
export async function select(id,selection,dom){const r=record(id);check(!r.headless,'Use selectHeadless for profile stage');r.element.focus({preventScroll:true});
  const native={anchor:point(r,selection.anchor),focus:point(r,selection.focus)};
  const changed=await settle(r.editor.submit({kind:'set_selection',stamp:r.editor.capture(),selection:native}));check(changed.response?.status==='ok','Literal native selection refused');
  check(dom,'Independent literal DOM endpoints required');const anchor=at(r,dom.anchor.path),focus=at(r,dom.focus.path);getSelection().setBaseAndExtent(anchor,dom.anchor.offset,focus,dom.focus.offset);
  const bookmark=r.editor.selection.captureBookmark();check(bookmark.status==='captured','Native/actual DOM selection mismatch');r.editor.selection.releaseBookmark(bookmark.bookmark);
  check(JSON.stringify(state(r).selection)===JSON.stringify(native),'Actual native selection differs');return{native:clone(native),raw:raw(r),label:'Declared native role coordinates and independent literal actual DOM endpoints; no hit-test retry'};
}
export async function selectHeadless(id,selection){const r=record(id);const native={anchor:point(r,selection.anchor),focus:point(r,selection.focus)};const result=await settle(r.editor.submit({kind:'set_selection',stamp:r.editor.capture(),selection:native}));check(result.response?.status==='ok','Headless native selection refused');return clone(native);}
export async function snapshot(id){const r=record(id),result=await settle(r.editor.submit({kind:'snapshot',stamp:r.editor.capture(),max_bytes:2097152}));check(result.response?.status==='ok'&&result.response.value.kind==='snapshot','Native snapshot refused');const value=result.response.value;const release=await settle(r.editor.submit({kind:'release_snapshot',handle:value.handle}));check(release.response?.status==='ok','Native snapshot release refused');return value.canonical_json;}
export async function inspect(id){const r=record(id),value=rows(r);const selection=value.state.selection;const projection=selection?r.editor.read({kind:'selection_text',stamp:value.state.stamp,max_bytes:1048576}):null;
  return{...value,canonical:await snapshot(id),projection:clone(projection),context:clone(r.editor.context()),resources:clone(r.editor.resources()),native:clone(r.editor.nativeResources()),raw:raw(r),events:clone(r.events),writes:clone(r.writes),failures:clone(r.failures),pasteResults:clone(r.pasteResults),sourceReads:r.sources.map(s=>({label:s.label,calls:s.calls.slice(),types:s.types})),dom:r.element?.innerHTML??null,...(r.platform?{capturedInputs:clone(r.capturedInputs),trustedEvents:clone(r.trustedEvents),copyResults:clone(r.copyResults)}:{})};}
export async function paste(id,payload){const r=record(id),pending=r.editor.clipboard.paste(source(r,payload));r.sources.at(-1).retire();return clone(await pending);}
export function startPaste(id,payload){const r=record(id);check(!r.operation,'One fixture operation');r.operation=r.editor.clipboard.paste(source(r,payload));r.sources.at(-1).retire();return asyncState(id);}
export function dispatchPaste(id,payload,outside=false){const r=record(id),event=new Event('paste',{bubbles:true,cancelable:true}),index=r.pasteResults.length;
  Object.defineProperty(event,'clipboardData',{value:source(r,payload)});const target=outside?document.querySelector('#clipboard-outside'):r.element;if(outside)target.focus();target.dispatchEvent(event);r.sources.at(-1).retire();
  return{index,defaultPrevented:event.defaultPrevented,isTrusted:event.isTrusted,scope:'CONTROLLED synthetic paste event; no trusted OS clipboard provenance'};}
export function pasteOutcome(id,index){return clone(record(id).pasteResults[index]??null);}
export function asyncState(id){const r=record(id);return{deferred:!!r.deferred,writers:r.writePending.length,pasteResults:r.pasteResults.length,reads:r.sources.map(s=>s.calls.slice()),resources:clone(r.editor.resources())};}
export function resolveDecode(id){const r=record(id),deferred=r.deferred;check(deferred,'No deferred decoder');r.deferred=null;deferred.resolve(deferred.result);}
export async function finish(id){const r=record(id);check(r.operation,'No operation');const result=await r.operation;r.operation=null;return clone(result);}
export function startCopy(id,action){const r=record(id);check(['copy','cut'].includes(action)&&!r.operation,'Closed copy/cut fixture');r.operation=r.editor.clipboard[action]();return asyncState(id);}
export function settleWriter(id,ok=true){const r=record(id),pending=r.writePending.shift();check(pending,'No pending controlled writer');if(ok)pending.resolve();else pending.reject(Error('Controlled writer refusal'));}
export async function copy(id,action='copy'){check(['copy','cut'].includes(action),'Closed copy action');return clone(await record(id).editor.clipboard[action]());}
export function takeRecovery(id){const r=record(id),value=r.editor.clipboard.takeRecovery();if(value)r.hostTransfers.push(value);return clone(value);}
export async function history(id,direction){check(['undo','redo'].includes(direction),'Closed history action');const r=record(id);return clone(await settle(r.editor.submit({kind:'history',stamp:r.editor.capture(),direction})));}
export function destroy(id){const r=record(id);r.destroyReceipt??=r.editor.destroy();return{status:r.destroyReceipt.status,transferStatus:r.destroyReceipt.clipboardRecovery?.status??null,resources:clone(r.editor.resources())};}
export async function dispose(id){const r=record(id);if(r.disposed)return r.disposeReadback;
  if(r.deferred)resolveDecode(id);while(r.writePending.length)settleWriter(id,false);if(r.operation){await r.operation;r.operation=null;}
  if(!r.headless)r.editor.clipboard.releaseRecovery();const receipt=r.destroyReceipt??r.editor.destroy();r.destroyReceipt=receipt;
  const sdk=r.headless?receipt:receipt.sdk;if(sdk?.status==='queued')await sdk.completion;
  const transfer=receipt.clipboardRecovery;const recovery=transfer?.status==='pending'?await transfer.completion:transfer?.recovery??null;if(recovery)r.hostTransfers.push(recovery);
  for(const remove of r.observers.splice(0))remove();r.capturedInputs.length=0;
  r.disposed=true;r.element?.remove();r.disposeReadback={id,resources:clone(r.editor.resources()),native:JSON.parse(module.resourceCounts()),clipboardTransfer:clone(recovery),hostTransferredInputs:r.hostTransfers.length,fixtureObservers:r.observers.length};return r.disposeReadback;
}
export async function allDisposed(){const readbacks=[];for(const id of records.keys())readbacks.push(await dispose(id));return{readbacks,native:JSON.parse(module.resourceCounts())};}
export function metadata(){return{buildId:sdkBuildId,manifest:clone(module.manifest),scope:label,browserSupport:{chromium:'required measurement',webkit:'required measurement',firefox:'experimental behavior; evidence integrity required'},policy};}
export async function parser(source){check(typeof source==='string'&&source.length<=524289,'Closed parser measurement source bound');const before=document.querySelector('#clipboard-mounts').innerHTML;const {parseClipboardHtml}=await import('/packages/kwdj/clipboard-parser.js');const result=parseClipboardHtml(source);return{result,domBefore:before,domAfter:document.querySelector('#clipboard-mounts').innerHTML,attack:window.__clipboardUnexpectedExecution??0,parserUrl:'/packages/kwdj/clipboard-parser.js',scope:'Actual delivered bundled parser; inert data only, no live DOM insertion'};}
export async function corpusStage(fixtureId){const fixture=corpus.flatMap(group=>group.fixtures).find(f=>f.id===fixtureId);check(fixture&&/^DOC-0(?:2[89]|3[0-4])$/.test(fixtureId),'Closed corpus stage');const c=fixture.cases[0],input=c.input;
  const seed=input.profile==='poetry'?doc([{type:'verse',content:[{type:'verse_line',content:[]}]}],'poetry'):doc([p('')]);const mounted=await mount({source:seed,headless:true});const r=record(mounted.id);
  const selection=input.profile==='poetry'?{anchor:{kind:'child',path:[0,0],index:0},focus:{kind:'child',path:[0,0],index:0}}:{anchor:{kind:'child',path:[],index:0},focus:{kind:'child',path:[],index:1}};await selectHeadless(r.id,selection);
  const before=await inspect(r.id);const native=r.editor.read({kind:'clipboard_context',stamp:r.editor.capture()});check(native.status==='ok'&&native.value.kind==='clipboard_context','Native corpus insertion context refused');const context=JSON.parse(native.value.context_json);
  const decoded=await decodeClipboard({source_profile:binding,mode:context.mode,insertion_context:context.insertion_context,media:input.clipboard_items.some(k=>['image','file','blob'].includes(k))?'present':'not_observed',plain:{status:input.kind==='clipboard_plain'||input.plain_fallback!==undefined?'complete_local':'unavailable',text:input.kind==='clipboard_plain'?input.value:input.plain_fallback??null},html:{status:input.kind==='clipboard_html'?'complete_local':'unavailable',text:input.kind==='clipboard_html'?input.value:null},url_policy:policy});
  let applied=null,after=before,undone=null,reopened=null;
  if(decoded.status==='candidate'){applied=await settle(r.editor.submit({kind:'command',stamp:r.editor.capture(),command:createCommand('org.klenwriter.kwdj/command/insert-fragment',{kind:'insert_fragment',fragment_json:JSON.stringify(decoded.fragment)}),history_hint:{kind:'isolated'}}));after=await inspect(r.id);
    const saved=after.canonical;const fresh=await mount({headless:true,source:saved});reopened=await inspect(fresh.id);await dispose(fresh.id);await history(r.id,'undo');undone=await inspect(r.id);}
  return{fixtureId,id:r.id,sourceInput:clone(input),nativeContext:clone(native.value),decoded:clone(decoded),applied:clone(applied),before,after,undone,reopened,
    stages:{conversion:'actual packaged TS clipboard decoder',nativeProfile:decoded.status==='candidate'?'actual packaged SDK2/sealed WASM command':'not_dispatched_conversion_refusal',mountedPresentation:['DOC-029','DOC-030'].includes(fixtureId)?'not_attempted_basic_provider_excludes_verse_or_table':'not_attempted_headless_corpus_stage',OSClipboard:'not_observed_controlled_strings_only'}};
}
export function prepareInstalled(nonce){check(typeof nonce==='string'&&/^[a-f0-9]{32}$/.test(nonce),'Closed installed fixture nonce');check(location.href==='http://127.0.0.1:4174/clipboard','Exact installed fixture URL');document.title='KlenWriter Clipboard native '+nonce;return{title:document.title,url:location.href,scope:'Installed foreground fixture, no scripted native edit or clipboard write',metadata:metadata()};}
window.clipboardHost={prepareInstalled,metadata,mount,select,selectHeadless,inspect,snapshot,paste,startPaste,dispatchPaste,pasteOutcome,asyncState,resolveDecode,finish,startCopy,settleWriter,copy,takeRecovery,history,destroy,dispose,allDisposed,parser,corpusStage};
window.clipboardHostReady=true;
