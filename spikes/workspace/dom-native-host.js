// SPDX-License-Identifier: MIT OR Apache-2.0
// Installed-browser acceptance instrumentation. It does not dispatch edit events.
const MAX_TRACE = 2048, MAX_PHASES = 24;
const copy = value => JSON.parse(JSON.stringify(value));
let active = null;
const pageErrors=[],policyViolations=[];
window.addEventListener('error',event=>{if(pageErrors.length<32)pageErrors.push(String(event.message).slice(0,512));});
window.addEventListener('unhandledrejection',event=>{if(pageErrors.length<32)pageErrors.push(String(event.reason).slice(0,512));});
document.addEventListener('securitypolicyviolation',event=>{if(policyViolations.length<32)policyViolations.push({directive:event.violatedDirective,blocked:String(event.blockedURI).slice(0,512)});});
const ensure = condition => { if (!condition) throw new Error('Native fixture is not prepared'); };
function small(value, max = 128) { return typeof value === 'string' ? value.slice(0,max) : null; }
function row(point,path) { const found=point.rows.find(entry=>entry.path===path);ensure(found);return found.node; }
function position(node,offset,kind='text') {
  return kind==='text'?{kind,node,offset,affinity:'after'}:{kind:'child',parent:node,index:offset,affinity:'after'};
}
function expected(point,document,node,offset,revision,undo,redo=0,kind='text') {
  const p=position(node,offset,kind);
  if (JSON.stringify(JSON.parse(point.canonical))!==JSON.stringify(document)) {
    // Object-key order is not document semantics; canonical bytes remain in the receipt.
    const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'
      ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
    if(JSON.stringify(ordered(JSON.parse(point.canonical)))!==JSON.stringify(ordered(document)))throw new Error('Canonical document differs from independent expected literal');
  }
  if(JSON.stringify(point.state.selection)!==JSON.stringify({anchor:p,focus:p}))throw new Error('Exact native caret differs');
  if(point.state.stamp.revision!==String(revision))throw new Error('Exact revision differs');
  if(point.state.history.undo_entries!==String(undo)||point.state.history.redo_entries!==String(redo))throw new Error('Exact native history differs');
  if(point.lifecycle!=='ready'||point.failures.length)throw new Error('Mounted lifecycle/refusal failure');
  if(point.events.filter(event=>event.change.kind==='document').length!==revision)throw new Error('Document publication count differs');
}
function listen(target,name,callback) { target.addEventListener(name,callback,true);active.removals.push(()=>target.removeEventListener(name,callback,true)); }
function trace(event) {
  if(active.trace.length===MAX_TRACE){active.overflow=true;return;}
  const value={phase:active.phase,type:event.type,time:performance.now(),isTrusted:event.isTrusted,
    inputType:small(event.inputType),data:small(event.data,64),key:small(event.key),code:small(event.code),
    cancelable:event.cancelable,defaultPreventedAtCapture:event.defaultPrevented,
    defaultPreventedAfterDispatch:null,isComposing:event.isComposing??null,targetId:small(event.target?.id)};
  active.trace.push(value);queueMicrotask(()=>{value.defaultPreventedAfterDispatch=event.defaultPrevented;});
}
export async function prepare(locale) {
  if(!['en','ru'].includes(locale))throw new Error('Locale must be en or ru');
  if(active){for(const remove of active.removals)remove();await window.domHost.allDisposed();}
  const d0=JSON.parse(await window.domHost.fixture('D0')),d1=JSON.parse(await window.domHost.fixture('D1-after-end-split'));
  const mounted=await window.domHost.mount({fixture:'D0'});if(mounted.ready!=='ready')throw new Error(`Native mount: ${mounted.ready}`);
  const element=document.getElementById(mounted.id);ensure(element);
  active={id:mounted.id,element,locale,text:locale==='en'?'hello':'привет',phase:'setup',trace:[],checkpoints:[],removals:[],overflow:false,d0,d1,empty:null};
  for(const name of ['keydown','keyup','beforeinput','input','compositionstart','compositionupdate','compositionend','focusin','focusout'])listen(element,name,trace);
  for(const name of ['keydown','keyup','focusin','focusout'])listen(document.getElementById('host-recovery-control'),name,trace);
  listen(document,'selectionchange',event=>{const selection=document.getSelection();if(selection?.anchorNode&&element.contains(selection.anchorNode))trace(event);});
  await window.domHost.select(active.id,'/0/2',2);
  const initial=await window.domHost.inspect(active.id);active.initial=initial;active.tc=row(initial,'/0/2').id;
  expected(initial,d0,active.tc,2,0,0);return {id:active.id,locale,text:active.text,initial,metadata:await window.domHost.metadata()};
}
export function focusControl() {ensure(active);document.getElementById('host-recovery-control').focus();return document.activeElement?.id??null;}
export function phase(name) {ensure(active);if(active.checkpoints.length>=MAX_PHASES)throw new Error('Native phase cap');active.phase=name;return {phase:name,time:performance.now()};}
export async function checkpoint(name) {
  ensure(active);if(active.checkpoints.length>=MAX_PHASES)throw new Error('Native phase cap');
  const point=await window.domHost.inspect(active.id),n=active.text.length;
  const focused=active.element===document.activeElement||active.element.contains(document.activeElement);
  const result={name,focused,activeElement:document.activeElement?.id??null,...point};active.checkpoints.push(copy(result));
  try {
  const typed=copy(active.d0);typed.content[0].content[2].text+=active.text;
  const split=copy(active.d1);split.content[0].content[2].text+=active.text;
  if(name==='typed')expected(point,typed,active.tc,2+n,n,n);
  else if(name==='split') {active.empty=row(point,'/1').id;expected(point,split,active.empty,0,n+1,n+1,0,'child');}
  else if(name==='joined')expected(point,typed,active.tc,2+n,n+2,n+2);
  else if(name==='undo-join') {if(row(point,'/1').id!==active.empty)throw new Error('Undo did not revive historical empty-block ID');expected(point,split,active.empty,0,n+3,n+1,1,'child');}
  else if(name==='redo-join')expected(point,typed,active.tc,2+n,n+4,n+2);
  else if(name==='delete-last'||name==='focus-return') {const shortened=copy(active.d0);shortened.content[0].content[2].text+=active.text.slice(0,-1);expected(point,shortened,active.tc,1+n,n+5,n+3);}
  else if(name!=='focused')throw new Error(`Unknown checkpoint ${name}`);
  if(['focused','focus-return'].includes(name)&&!focused)throw new Error('Physical Tab did not return editor focus under current browser policy');
  if(row(point,'/0/2').id!==active.tc)throw new Error('Original surviving text ID changed');
  if(active.overflow)throw new Error('Native trace cap exceeded');
  } catch(error) {active.checkpoints.at(-1).assertionError=String(error.message??error);throw error;}
  return result;
}
export async function history(direction) {ensure(active);if(!['undo','redo'].includes(direction))throw new Error('History direction');return window.domHost.history(active.id,direction);}
export function observations() {ensure(active);return {locale:active.locale,initial:copy(active.initial??null),trace:copy(active.trace),checkpoints:copy(active.checkpoints),overflow:active.overflow,pageErrors:copy(pageErrors),policyViolations:copy(policyViolations),
  eventScope:'Only the fixture editing host and selection changes inside it; no synthetic event dispatch. Programmatic setup/focus/public history actions are labelled separately.'};}
export function verifyTrace() {
  ensure(active);const trusted=active.trace.filter(event=>event.isTrusted);
  if(pageErrors.length||policyViolations.length)throw new Error('Native fixture page error or CSP violation');
  const typing=trusted.filter(event=>event.type==='beforeinput'&&event.inputType==='insertText'&&event.phase==='type');
  if(typing.map(event=>event.data??'').join('')!==active.text)throw new Error('Trusted native beforeinput text sequence differs');
  for(const [phase,inputType]of [['split','insertParagraph'],['join','deleteContentBackward'],['delete-last','deleteContentBackward']]) {
    if(!trusted.some(event=>event.phase===phase&&event.type==='beforeinput'&&event.inputType===inputType))throw new Error(`Missing trusted native ${phase} beforeinput`);
  }
  if(!trusted.some(event=>event.type==='keydown'&&event.key==='Tab'&&event.phase==='focus-return'))throw new Error('Missing trusted physical focus-return Tab');
  if(active.trace.some(event=>event.type==='beforeinput'&&!event.isTrusted))throw new Error('Untrusted beforeinput cannot qualify native lane');
  return {status:'passed',trustedBeforeinput:trusted.filter(event=>event.type==='beforeinput').length,
    observedInputEvents:trusted.filter(event=>event.type==='input').length,
    note:'Canceled beforeinput may correctly produce zero browser input events; the actual trace is retained.'};
}
export async function finish() {
  ensure(active);const result=observations();for(const remove of active.removals)remove();
  const resources=await window.domHost.allDisposed();active=null;
  const resourcesReleased=resources.sessions===0&&resources.snapshot_handles===0&&resources.snapshot_bytes==='0'&&resources.protected_cursors===0;
  return {...result,resources,resourcesReleased};
}
window.domNative={prepare,focusControl,phase,checkpoint,history,observations,verifyTrace,finish};
window.domNativeReady=true;
