// SPDX-License-Identifier: MIT OR Apache-2.0
// Acceptance instrumentation around public ui42 fixture methods, not UI code.
import {actions,caseIds,caseActions,pointerTargets,setupIds} from './protocol.mjs';
const check=(condition,message)=>{if(!condition)throw Error(message);};
const host=()=>{check(window.ui42,'Public42 fixture ready');return window.ui42;};
let active=null,traceOverflow=false,policyOverflow=false,errorOverflow=false;
const trace=[],policy=[],errors=[],objects=new WeakMap();let nextObject=0;
function pageError(value){if(errors.length===64){errorOverflow=true;return;}errors.push(String(value).slice(0,2048));}
window.addEventListener('error',event=>pageError(event.message));window.addEventListener('unhandledrejection',event=>pageError(event.reason?.message??event.reason));
const token=node=>node?(objects.has(node)?objects.get(node):(objects.set(node,++nextObject),nextObject)):null;
function bounded(value,max){check(typeof value==='string'&&value.length<=max,'Bounded fixture text');return value;}
function identity(element){return element instanceof Element?{id:element.id,tag:element.tagName,action:element.getAttribute('data-editor-ui-action'),control:element.getAttribute('data-editor-ui-control'),buttonText:element.tagName==='BUTTON'?bounded(element.textContent,256):null}:null;}
function record(event){
  if(!active)return;if(trace.length>=16384){traceOverflow=true;return;}
  const row={time:performance.now(),event:event.type,isTrusted:event.isTrusted,target:identity(event.target),active:identity(document.activeElement),key:event.key??null,code:event.code??null,
    shift:!!event.shiftKey,alt:!!event.altKey,meta:!!event.metaKey,ctrl:!!event.ctrlKey,data:event.data==null?null:bounded(event.data,65536),inputType:event.inputType??null,
    button:event.button??null,buttons:event.buttons??null,pointerId:event.pointerId??null,x:event.clientX??null,y:event.clientY??null,defaultPrevented:event.defaultPrevented};
  trace.push(row);queueMicrotask(()=>{row.defaultPrevented=event.defaultPrevented;});
  if(event.isTrusted&&event.type==='compositionstart'){active.composition.open=true;active.composition.starts++;}
  if(event.isTrusted&&event.type==='compositionend'){active.composition.open=false;active.composition.ends++;}
  if(event.isTrusted&&event.type==='keydown'&&event.code==='KeyF'&&event.metaKey&&active.caseId==='modes-zoom')active.findArmed=true;
}
for(const name of ['keydown','keyup','beforeinput','input','compositionstart','compositionupdate','compositionend','pointerdown','pointerup','click','focusin','focusout','copy'])document.addEventListener(name,record,true);
document.addEventListener('securitypolicyviolation',event=>{
  if(policy.length===64){policyOverflow=true;return;}
  policy.push({time:performance.now(),directive:bounded(event.violatedDirective,128),blocked:bounded(event.blockedURI,2048),source:bounded(event.sourceFile,2048),line:event.lineNumber,column:event.columnNumber,sample:bounded(event.sample,256)});
});
function current(){check(active,'One active42 installed mount');return active;}
function element(){return document.getElementById(`${current().id}-editor`);}
function root(){return document.getElementById(current().id);}
function control(name){
  if(name==='before')return document.getElementById('ui-before');if(name==='recovery')return document.getElementById('ui-after');if(name==='editor')return element();
  if(name==='cancel')return root().querySelector('[role="dialog"] button[type="button"]');
  return root().querySelector(['add','move'].includes(name)?`[data-editor-ui-control="${name}"]`:`[data-editor-ui-action="${name}"]`);
}
function point(node){check(node instanceof HTMLElement&&node.isConnected,'Connected closed target');const r=node.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};}
function viewport(){const v=visualViewport;return {width:innerWidth,height:innerHeight,scale:v?.scale??1,offsetLeft:v?.offsetLeft??0,offsetTop:v?.offsetTop??0,pageZoom:current().baselineWidth/innerWidth};}
function zoomEvidence(){const r=current();return {basis:'Baseline/current CSS viewport width under independently guarded fixed AX window',baselineInnerWidth:r.baselineWidth,currentInnerWidth:innerWidth,baselineOuterWidth:r.outerWidth,currentOuterWidth:outerWidth,baselineOuterHeight:r.outerHeight,currentOuterHeight:outerHeight,baselineDpr:r.baselineDpr,currentDpr:devicePixelRatio,dprRatio:devicePixelRatio/r.baselineDpr,stableWindow:outerWidth===r.outerWidth&&outerHeight===r.outerHeight};}
function rawPoint(node,offset){if(!node)return null;const path=[];let item=node;while(item!==element()&&item.parentNode){check(path.length<128,'Bounded raw path');path.unshift([...item.parentNode.childNodes].indexOf(item));item=item.parentNode;}return {inside:item===element(),path,nodeType:node.nodeType,text:node.nodeType===3?bounded(node.data,65536):null,offset,object:token(node)};}
function rawSelection(){const s=getSelection();return {rangeCount:s?.rangeCount??0,anchor:rawPoint(s?.anchorNode,s?.anchorOffset??0),focus:rawPoint(s?.focusNode,s?.focusOffset??0)};}
function dom(){const e=element();check(e?.isConnected,'Current actual editing root');check(e.innerHTML.length<=2097152,'Bounded actual DOM');const walker=document.createTreeWalker(e,NodeFilter.SHOW_ALL),nodes=[];for(let n=walker.currentNode;n;n=walker.nextNode()){check(nodes.length<4096,'Finite installed fixture nodes');nodes.push(n);}return {html:e.innerHTML,rootObject:token(e),objects:nodes.map(n=>({object:token(n),nodeType:n.nodeType,tag:n instanceof Element?n.tagName:null,text:n.nodeType===3?bounded(n.data,65536):null,attributes:n instanceof Element?[...n.attributes].map(a=>[a.name,a.value]):null})),selection:rawSelection(),active:identity(document.activeElement)};}
function controls(){return [...root().querySelectorAll('button,[role="toolbar"],[role="listbox"],[role="menu"],[role="dialog"]')].map(node=>{
  const box=node.getBoundingClientRect(),s=getComputedStyle(node),labelled=node.getAttribute('aria-labelledby')?.split(/\s+/).map(id=>document.getElementById(id)?.textContent??'').join(' '),description=node.getAttribute('aria-describedby')?.split(/\s+/).map(id=>document.getElementById(id)?.textContent??'').join(' ');
  return {...identity(node),role:node.getAttribute('role'),name:node.getAttribute('aria-label')??labelled??node.textContent,description:description??null,modal:node.getAttribute('aria-modal'),disabled:node.getAttribute('aria-disabled'),tabIndex:node.tabIndex,expanded:node.getAttribute('aria-expanded'),pressed:node.getAttribute('aria-pressed'),hidden:node.hidden,
    visible:box.width>0&&box.height>0&&s.visibility!=='hidden',rect:{x:box.x,y:box.y,width:box.width,height:box.height},outline:{style:s.outlineStyle,width:s.outlineWidth,color:s.outlineColor}};
  });}
export async function prepare(locale,caseId){
  check(!active&&['en','ru'].includes(locale)&&caseIds.includes(caseId),'Closed42 prepare');trace.length=0;traceOverflow=false;
  const notes=['host-dialog','composition-dialog'].includes(caseId),geometry=caseId.startsWith('composition-')&&!notes?'F':null;
  const nativeCase=notes?'V06-NC011-root-title-owned-metadata':caseId.startsWith('add-')?'V03-root-gap':caseId.startsWith('move-')?(caseId.endsWith('-down')?'V04-down':'V04-up'):'V01-forward';
  const mounted=await host().mount({case:nativeCase,locale,nativeTrace:true,...geometry?{geometry}: {}});check(mounted.ready==='ready'&&mounted.uiReady==='ready','Actual native+UI readiness');
  active={id:mounted.id,caseId,locale,nativeCase,baselineDpr:devicePixelRatio,baselineWidth:innerWidth,outerWidth,outerHeight,composition:{open:false,starts:0,ends:0},findArmed:false,restorations:[]};
  for(const name of ['ui-before','ui-after']){const button=document.getElementById(name);active.restorations.push({button,value:button.getAttribute('tabindex')});button.setAttribute('tabindex','0');}
  await host().editorFocus(active.id);host().refresh(active.id);
  if(caseId==='navigation')control('before').focus({preventScroll:true});
  const before=await checkpoint();return {id:mounted.id,caseId,locale,nativeCase,before,scope:'Public/native setup and DOM focus are preparation only, no physical interaction claimed'};
}
export async function setup(action){check(setupIds.includes(action),'Closed explicit setup');const r=current();
  if(['readonly','disabled','editable'].includes(action))return host().mode(r.id,action==='readonly'?'readOnly':action);
  if(action==='host-edit')return host().nativeHostEdit(r.id);
  if(action==='late-accept'){const observation=await host().inspect(r.id),index=observation.dialog.openCount-1;check(index>=0,'Existing owned host callback');host().lateAccept(r.id,index,{title:'late result'});host().lateAccept(r.id,index,{title:'second late result'});return {status:'late-callbacks-delivered',count:2,index};}
  if(['undo','redo'].includes(action))return host().history(r.id,action);
  if(action==='editor')return host().editorFocus(r.id);
  const target=control(action);check(target instanceof HTMLElement&&target.isConnected,'Closed setup focus target');target.focus({preventScroll:true});return {status:'setup-focus-only',target:identity(target)};
}
export function guard(action){check(actions.includes(action),'Closed42 physical action');const r=current();check(caseActions[r.caseId].includes(action),'Action belongs to current finite row');const editor=element(),targetName=pointerTargets[action],target=targetName?control(targetName):document.activeElement,v=viewport();
  let p=null,inside=false;
  if(target instanceof HTMLElement&&target.isConnected){if(targetName){p=point(target);const hit=document.elementFromPoint(p.x,p.y);inside=!!hit&&(hit===target||target.contains(hit));}else inside=root().contains(target)||target===control('before')||target===control('recovery');}
  const compositionAttempt=r.caseId.startsWith('composition-')&&action.startsWith('click-');
  return {id:r.id,caseId:r.caseId,action,target:targetName??'focused',targetIdentity:identity(target),editorConnected:editor.isConnected,documentFocused:document.hasFocus(),point:p,pointerDown:false,viewport:v,zoomEvidence:zoomEvidence(),
    allowed:!traceOverflow&&!policyOverflow&&policy.length===0&&editor.isConnected&&(document.hasFocus()||action==='close-find'&&r.findArmed)&&inside&&v.scale===1&&v.offsetLeft===0&&v.offsetTop===0&&v.pageZoom>=1&&v.pageZoom<=2&&(!compositionAttempt||r.composition.open),
    composition:{...r.composition},inputTraceCount:trace.length};
}
export function cleanupGuard(action){const r=current();check(actions.includes(action)&&caseActions[r.caseId].includes(action),'Same closed owner action for release-only cleanup');const editor=element();
  return {id:r.id,caseId:r.caseId,action,target:pointerTargets[action]??'focused',editorConnected:!!editor?.isConnected,documentFocused:document.hasFocus(),viewport:viewport(),zoomEvidence:zoomEvidence(),
    allowed:!!editor?.isConnected&&!!root()?.isConnected,point:null,pointerDown:false,releaseOnly:true,normalAvailabilityIgnored:{policyOverflow,policyViolations:policy.length,traceOverflow,errorOverflow},composition:{...r.composition}};
}
export async function inspect(){const r=current();return {id:r.id,caseId:r.caseId,locale:r.locale,facts:host().mountedFacts(r.id),composition:{...r.composition},viewport:viewport(),zoomEvidence:zoomEvidence(),page:{scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,scrollX,scrollY},documentFocused:document.hasFocus(),inputTraceCount:trace.length,inputTrace:trace.slice(),traceOverflow,policyViolations:policy.slice(),policyOverflow,errors:errors.slice(),errorOverflow,dom:dom(),controls:controls()};}
export async function checkpoint(){const r=current(),value=await host().inspect(r.id);return {...await inspect(),native:value,selectionGeometry:host().geometryRead(r.id,{kind:'selection'}),nativeTrace:host().nativeTrace(r.id)};}
export async function settle(){const began=performance.now();let previous=null;do{
  const value=await inspect();if(!value.composition.open&&value.facts.resources.dom.continuations===0){const key=JSON.stringify({stamp:value.facts.stamp,dom:value.dom,composition:value.composition});if(key===previous)return checkpoint();previous=key;}else previous=null;
  await new Promise(resolve=>setTimeout(resolve,50));
}while(performance.now()-began<3000);throw Error('One bounded42 settlement did not complete; no replay');}
export async function finish(){const r=current(),before=await checkpoint(),disposed=await host().destroy(r.id);for(const {button,value}of r.restorations){check(button.isConnected,'Original fixture focus button remains connected');if(value===null)button.removeAttribute('tabindex');else button.setAttribute('tabindex',value);check(button.getAttribute('tabindex')===value,'Original tabindex restored');}active=null;return {before,disposed,policyViolations:policy.slice(),policyOverflow,traceOverflow};}
window.ui42Native={prepare,setup,guard,cleanupGuard,inspect,checkpoint,settle,finish};
