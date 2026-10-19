// SPDX-License-Identifier: MIT OR Apache-2.0
// Closed installed-input fixture. Setup alone may select/scroll; a gesture never
// receives endpoint, scrolling or keyboard assistance from this module.
import * as host from '/selection-host.js';
const [native, unicode, scroll, formatting] = await Promise.all(
  ['native','unicode','scroll','formatting'].map(name => fetch(`/selection-contract/${name}-oracles.json`).then(r => {
    if (!r.ok) throw new Error('Missing installed selection literal'); return r.json();
  })),
);
const cases = ['key-comb','key-zwj','key-flag','key-rtl','key-select-all','mouse-forward','mouse-reverse',
  'scroll-down-terminal','scroll-up-terminal','scroll-down-active','scroll-up-active','scroll-down-focus','scroll-up-focus'];
const actions = ['move-start','down','move-end','up','shift-left','select-all','copy','cut','shift-tab','tab'];
const clone = value => structuredClone(value);
const check = (condition, message) => { if (!condition) throw new Error(message); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let active = null;
const errors = [], violations = [];
window.addEventListener('error', event => { if (errors.length < 32) errors.push(String(event.message).slice(0,1024)); });
window.addEventListener('unhandledrejection', event => { if (errors.length < 32) errors.push(String(event.reason).slice(0,1024)); });
document.addEventListener('securitypolicyviolation', event => {
  if (violations.length < 32) violations.push({directive:event.violatedDirective,blocked:event.blockedURI});
});
function current() { check(active, 'No installed selection case'); return active; }
function viewport() {
  const vv = visualViewport;
  return {width:innerWidth,height:innerHeight,scale:vv?.scale??1,offsetLeft:vv?.offsetLeft??0,offsetTop:vv?.offsetTop??0};
}
function rawGeometry() { const r = current(); return host.geometry(r.id); }
function addTrace(event) {
  const r = active; if (!r) return;
  if (r.inputTrace.length >= 256) { r.overflow = true; return; }
  r.inputTrace.push({time:performance.now(),event:event.type,isTrusted:event.isTrusted,
    x:event.clientX??null,y:event.clientY??null,buttons:event.buttons??null,pointerId:event.pointerId??null,
    button:event.button??null,isPrimary:event.isPrimary??null,pointerType:event.pointerType??null,
    key:event.key??null,code:event.code??null,shift:event.shiftKey??null,meta:event.metaKey??null,
    ctrl:event.ctrlKey??null,defaultPrevented:event.defaultPrevented,active:document.activeElement?.id??null});
}
function startSampling(r) {
  if (r.timer !== null || !r.scrollCase) return;
  const began = performance.now();
  r.timer = setInterval(() => {
    if (r.samples.length >= 100 || performance.now()-began > 10000) {
      clearInterval(r.timer); r.timer = null; return;
    }
    try { r.samples.push(host.sampleScroll(r.id)); } catch (error) { r.sampleError = String(error); }
  },100);
}
function recordSettlement(r,trigger) {
  if(r.settlementWait)return;
  const started=performance.now();
  r.settlementWait=new Promise(resolve=>{
    let done=false;
    const finish=value=>{if(done)return;done=true;clearTimeout(r.settlementTimer);r.settlementTimer=null;r.settlementFrame=null;r.settlement=value;resolve(value);};
    r.settlementTimer=setTimeout(()=>{cancelAnimationFrame(r.settlementFrame);finish({trigger,started,status:'timeout',elapsedMs:performance.now()-started});},100);
    r.settlementFrame=requestAnimationFrame(()=>finish({trigger,started,status:'frame',elapsedMs:performance.now()-started,geometry:host.geometry(r.id)}));
  });
}
function textPoint(node,offset) { return {kind:'text',node,offset,affinity:'after'}; }
function scrollRoles() {
  return Object.fromEntries([...scroll.structuralRoles.map(r=>[r.role,r.modelPath]),
    ...scroll.modelRowRoles.flatMap(r=>[[r.blockRole,r.modelBlockPath],...(r.textRole?[[r.textRole,r.modelTextPath]]:[])])]);
}
export async function prepare(locale,caseId) {
  check(['en','ru'].includes(locale) && cases.includes(caseId), 'Unknown installed selection case');
  check(active === null, 'Previous installed selection case not finished');
  document.body.classList.remove('selection-scroll-case');
  document.querySelector('#selection-mounts').replaceChildren();
  document.querySelector('#selection-status').textContent = '';
  let source, roles, setup = null, oracle = null;
  if (caseId.startsWith('scroll-')) {
    const direction = caseId.includes('-down-')?'down':'up';
    oracle = scroll.controlledCoreCases.find(c=>c.direction===direction && c.geometry==='plain'
      && c.ending===(caseId.endsWith('-terminal')?'terminal_release':'active_release'));
    check(oracle, 'Frozen scroll literal missing'); source = scroll.fixture.modelDocument; roles = scrollRoles();
  } else if (caseId.startsWith('mouse-')) {
    oracle = native.cases.find(c=>c.id===(caseId.endsWith('forward')?'L3-forward':'L3-reverse'));
    source = oracle.input.document; roles = oracle.input.identity_roles;
  } else if (caseId==='key-select-all') {
    source = formatting.inputs.F1; roles = formatting.roles;
  } else {
    const id = {'key-comb':'U-COMB','key-zwj':'U-ZWJ','key-flag':'U-FLAG','key-rtl':'U-RTL'}[caseId];
    oracle = unicode.cases.find(c=>c.id===id); check(oracle, 'Frozen Unicode literal missing');
    source = oracle.input; roles = {root:'',P:'/0',T:'/0/0'};
  }
  const mounted = await host.mount({source,roles,locale,writer:'platform',...(caseId==='key-rtl'?{direction:'rtl'}:{}),...(caseId.startsWith('scroll-')?{scroll:'plain'}:{})});
  check(mounted.ready.status==='ready', 'Installed selection mount admission failed');
  const element = document.getElementById(mounted.id);
  active = {id:mounted.id,caseId,locale,oracle,element,pointerDown:false,pointerId:null,foreignPointer:false,lastTrustedPointerMove:null,mouseStarted:false,points:null,prepared:null,
    scrollCase:caseId.startsWith('scroll-'),samples:[],inputTrace:[],removals:[],timer:null,overflow:false,stopped:null};
  const r = active;
  if (caseId.endsWith('-focus')) {
    // A text input owns its own range on Tab focus. Use a non-text listbox for
    // this separate focus-loss witness, before any fixture focus or input.
    const original=document.getElementById('selection-host-control');
    check(original instanceof HTMLInputElement && original.type==='text', 'Original host text control required');
    const control=document.createElement('select');control.id=original.id;control.size=2;control.tabIndex=0;
    control.setAttribute('aria-label','Installed focus cancellation control');
    const option=document.createElement('option');option.value='fixture';option.textContent='Host focus control';control.append(option);
    original.replaceWith(control);r.focusControlSwap={original,control};
  }
  for (const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','keydown','keyup','focusin','focusout','copy','cut']) {
    const listener = event => {
      if(event.type==='pointermove' && event.isTrusted)r.lastTrustedPointerMove={x:event.clientX,y:event.clientY,buttons:event.buttons,
        pointerId:event.pointerId,pointerType:event.pointerType,isPrimary:event.isPrimary,isTrusted:true,time:performance.now()};
      const ownedHeldPointer=r.pointerDown && ['pointermove','pointerup','pointercancel','lostpointercapture'].includes(event.type);
      if (!(ownedHeldPointer || event.target===element || element.contains(event.target) || event.target===document.getElementById('selection-host-control'))) return;
      addTrace(event);
      if (r.pointerDown && event.type.startsWith('pointer') && event.pointerId!==r.pointerId)r.foreignPointer=true;
      if (event.type==='pointerdown' && event.isTrusted && element.contains(event.target)
        && event.button===0 && event.isPrimary && event.pointerType==='mouse' && !r.pointerDown) {
        r.pointerId=event.pointerId;r.pointerDown=true;r.mouseStarted=true;r.started=performance.now();startSampling(r);
      }
      if ((event.type==='pointerup'||event.type==='pointercancel') && event.isTrusted && r.pointerDown && event.pointerId===r.pointerId) {
        r.pointerDown=false;r.stopped={kind:event.type,time:performance.now(),geometry:host.geometry(r.id)};recordSettlement(r,event.type);
      }
      if (event.type==='focusout' && event.isTrusted && r.pointerDown) {
        r.focusLoss={time:performance.now(),provenance:'Trusted UA focusout while installed pointer held'};recordSettlement(r,'focusout');
      }
    };
    document.addEventListener(type,listener,true);r.removals.push(()=>document.removeEventListener(type,listener,true));
  }
  for (const type of ['keydown','copy','cut']) {
    const listener = event => { if (event.target===element || element.contains(event.target)) {
      if (r.inputTrace.length<256) r.inputTrace.push({time:performance.now(),event:type,phase:'document-bubble',
        isTrusted:event.isTrusted,key:event.key??null,code:event.code??null,defaultPrevented:event.defaultPrevented});else r.overflow=true;
    }};
    document.addEventListener(type,listener);r.removals.push(()=>document.removeEventListener(type,listener));
  }
  element.focus({preventScroll:true});
  if (r.scrollCase) {
    const direction=caseId.includes('-down-')?'down':'up';
    r.prepared=await host.prepareScroll(r.id,direction);
    setup=await host.selectModel(r.id,oracle.initialModelSelection);
    r.points={start:clone(oracle.pointerDownCss),end:clone(oracle.stationaryHeldCss)};
    host.startScrollTrace(r.id);
  } else if (caseId.startsWith('mouse-')) {
    // Independent literal DOM structure: OL -> LI -> P -> SPAN -> mark -> Text.
    const paths={L:[0,0,0,0,0,0],R:[0,1,0,0,0,0]};
    const a=oracle.input.selection.anchor,f=oracle.input.selection.focus;
    r.points={start:host.literalHit(r.id,paths[a.node],a.offset),end:host.literalHit(r.id,paths[f.node],f.offset)};
  } else if (caseId==='key-select-all') {
    const point={kind:'child',parent:'root',index:0,affinity:'after'};
    setup=await host.selectModel(r.id,{anchor:point,focus:point});
  } else {
    const offset=caseId==='key-rtl'?oracle.utf16Length:unicode.keyboard.ltrWholeCluster.find(c=>c.case===oracle.id).setupOffset;
    const point=textPoint('T',offset);setup=await host.selectModel(r.id,{anchor:point,focus:point});
  }
  await sleep(50);
  r.before=await host.inspect(r.id);r.initialGeometry=host.geometry(r.id);
  const control=document.getElementById('selection-host-control');
  return {id:r.id,caseId,locale,setup,points:clone(r.points),viewport:viewport(),prepared:clone(r.prepared),before:r.before,
    focusControl:{tag:control.tagName,type:control.type,size:control.size??null,tabIndex:control.tabIndex,installedBeforeInput:!!r.focusControlSwap}};
}
export function guard(action) {
  check(actions.includes(action), 'Unknown installed input action');const r=current(),selection=document.getSelection();
  const control=document.getElementById('selection-host-control'),el=document.activeElement;
  const editorConnected=r.element.isConnected && !!r.element.closest('#selection-mounts');
  const target=el===r.element||r.element.contains(el)?'editor':el===control?'host-control':'blocked';
  const intended = action==='tab'?'host-control':action==='up'&&r.focusLoss?'host-control':'editor';
  const point=['move-start','down'].includes(action)?r.points?.start:['move-end','up'].includes(action)?r.points?.end:null;
  const v=viewport(),fixed=v.width===1024&&v.height===768&&v.scale===1&&v.offsetLeft===0&&v.offsetTop===0;
  const finitePoint=point===null||point===undefined||Number.isFinite(point.x)&&Number.isFinite(point.y)&&point.x>=0&&point.x<1024&&point.y>=0&&point.y<768;
  return {id:r.id,caseId:r.caseId,action,target,editorConnected,activeElementId:el?.id??null,
    documentFocused:document.hasFocus(),allowed:editorConnected&&document.hasFocus()&&target===intended&&fixed&&finitePoint,
    viewport:v,point:clone(point??null),pointerDown:r.pointerDown,lastTrustedPointerMove:clone(r.lastTrustedPointerMove),rawRangeOwned:!!selection?.anchorNode&&r.element.contains(selection.anchorNode)&&r.element.contains(selection.focusNode)};
}
export function inspect() {
  const r=current();return {id:r.id,caseId:r.caseId,geometry:rawGeometry(),pointerDown:r.pointerDown,focusLoss:r.focusLoss??null,
    stopped:clone(r.stopped),sampleCount:r.samples.length,sampleError:r.sampleError??null,
    clipboard:host.clipboardState(r.id),lastInputs:clone(r.inputTrace.slice(-8))};
}
export async function settle() {
  const r=current();check(r.settlementWait,'No trusted installed stop/focus-loss trigger observed');return r.settlementWait;
}
export async function checkpoint() {
  const r=current();return {id:r.id,caseId:r.caseId,locale:r.locale,before:r.before,after:await host.inspect(r.id),
    initialGeometry:r.initialGeometry,geometry:rawGeometry(),prepared:r.prepared,pointerDown:r.pointerDown,foreignPointer:r.foreignPointer,
    focusLoss:r.focusLoss??null,stopped:r.stopped,started:r.started??null,samples:r.samples,inputTrace:r.inputTrace,
    overflow:r.overflow,sampleError:r.sampleError??null,settlement:r.settlement??null,actionTrace:host.actionTrace(r.id),clipboard:host.clipboardState(r.id),
    errors:clone(errors),policyViolations:clone(violations),viewport:viewport()};
}
export function focusControl() {
  const r=current();if(!r.focusControlSwap)return host.outsideFocus();
  r.focusControlSwap.control.focus({preventScroll:true});return {id:document.activeElement?.id??null,type:'non-text-listbox'};
}
export async function finish() {
  const r=current();check(!r.pointerDown,'Physical pointer remains held at fixture teardown');
  if(r.timer!==null){clearInterval(r.timer);r.timer=null;}
  if(r.settlementFrame!==null&&r.settlementFrame!==undefined)cancelAnimationFrame(r.settlementFrame);
  if(r.settlementTimer!==null&&r.settlementTimer!==undefined)clearTimeout(r.settlementTimer);
  for(const remove of r.removals.splice(0))remove();
  const value=await host.dispose(r.id),global=await host.allDisposed();
  let focusControlRestoration=null;
  if(r.focusControlSwap){
    const {original,control}=r.focusControlSwap;
    check(document.getElementById('selection-host-control')===control && control.isConnected,'Owned native focus control changed before teardown');
    control.replaceWith(original);
    check(document.getElementById('selection-host-control')===original,'Original host input object was not restored');
    focusControlRestoration={status:'original-input-object-restored',type:original.type};
  }
  const result={id:r.id,...value,global,focusControlRestoration,errors:clone(errors),policyViolations:clone(violations)};
  active=null;return result;
}
window.selectionNative={prepare,guard,inspect,settle,checkpoint,finish,focusControl};
window.selectionNativeReady=true;
