// SPDX-License-Identifier: MIT OR Apache-2.0
// Closed, source-authored presentation carrier around actual public host methods.
import {actions,caseIds,caseActions,pointerTargets,setupIds} from './protocol.mjs';
import {observeSurface,observeLayout} from './measure.mjs';
const check=(ok,why)=>{if(!ok)throw Error(why);},host=()=>{check(window.accessibilityHost,'Actual accessibility host ready');return window.accessibilityHost;};
let active=null,trace=[],policy=[],errors=[],removals=[],traceOverflow=false,policyOverflow=false,errorOverflow=false;
let objects=new WeakMap(),serial=0;
const clock=Object.freeze({kind:'performance.now',timeOrigin:performance.timeOrigin});
const token=node=>node?(objects.has(node)?objects.get(node):(objects.set(node,++serial),serial)):null;
const text=(value,max=65536)=>{check(typeof value==='string'&&value.length<=max,'Bounded observation string');return value;};
const current=()=>{check(active,'One live presentation scene');return active;};
const wrapper=()=>{const root=document.getElementById(current().id);check(root?.isConnected,'Original scene connected');return root;};
const editor=()=>document.getElementById(`${current().id}-editor`);
const stylesheet=document.createElement('link');stylesheet.rel='stylesheet';stylesheet.href=new URL('presentation.css',import.meta.url).href;
const listen=(target,type,callback)=>{target.addEventListener(type,callback,true);removals.push(()=>target.removeEventListener(type,callback,true));};
function identity(node){if(!(node instanceof Element))return null;return {id:node.id,tag:node.tagName,action:node.getAttribute('data-editor-ui-action'),control:node.getAttribute('data-editor-ui-control'),object:token(node)};}
function record(event){if(!active)return;if(trace.length>=16384){traceOverflow=true;return;}const row={ordinal:trace.length+1,time:performance.now(),clock,event:event.type,isTrusted:event.isTrusted,target:identity(event.target),active:identity(document.activeElement),key:event.key??null,code:event.code??null,shift:!!event.shiftKey,alt:!!event.altKey,meta:!!event.metaKey,ctrl:!!event.ctrlKey,isComposing:!!event.isComposing,inputType:event.inputType??null,data:event.data==null?null:text(event.data),button:event.button??null,buttons:event.buttons??null,pointerId:event.pointerId??null,defaultPrevented:event.defaultPrevented};trace.push(row);queueMicrotask(()=>{row.defaultPrevented=event.defaultPrevented;});}
function begin(){trace=[];policy=[];errors=[];traceOverflow=policyOverflow=errorOverflow=false;objects=new WeakMap();serial=0;
  for(const name of ['keydown','keyup','beforeinput','input','compositionstart','compositionend','pointerdown','pointerup','click','focusin','focusout'])listen(document,name,record);
  listen(document,'securitypolicyviolation',event=>{if(policy.length>=64){policyOverflow=true;return;}policy.push({directive:text(event.violatedDirective,128),blocked:text(event.blockedURI,2048)});});
  listen(window,'error',event=>{if(errors.length>=64){errorOverflow=true;return;}errors.push(text(String(event.message),2048));});
  listen(window,'unhandledrejection',event=>{if(errors.length>=64){errorOverflow=true;return;}errors.push(text(String(event.reason?.message??event.reason),2048));});
  document.head.append(stylesheet);
}
const frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
function control(name){const root=wrapper(),id=current().id;
  if(name==='before')return document.getElementById('a66-before');if(name==='editor')return editor();
  if(['add','move','drag'].includes(name))return root.querySelector(`[data-editor-ui-control="${name}"]`);
  if(['strong','emphasis','paragraph','quote','title'].includes(name))return root.querySelector(`[data-editor-ui-action="${name}"]`);
  if(name==='save')return document.getElementById(`${id}-save`);
  if(name==='field')return document.getElementById(`${id}-dialog-field`);
  if(name==='apply')return root.querySelector('.a66-dialog button[type="submit"]');
  if(name==='cancel')return root.querySelector('.a66-dialog button[type="button"]');
  if(['retry','original'].includes(name))return root.querySelectorAll('.a66-host-error button')[name==='retry'?0:1]??null;
  throw Error('Unknown fixed observation target');
}
function named(node){const ids=(node.getAttribute('aria-labelledby')??'').trim().split(/\s+/).filter(Boolean);check(ids.length<=16,'Bounded labelledby');const associated=ids.map(id=>{const found=document.getElementById(id);check(found?.isConnected,'Connected name association');return text(found.textContent,4096);}).join(' ');return text(node.getAttribute('aria-label')??(ids.length?associated:node instanceof HTMLInputElement&&node.labels?.length?[...node.labels].map(label=>text(label.textContent,4096)).join(' '):node.textContent??''),65536);}
function surface(name){const node=control(name);if(!node)return null;const measured=observeSurface(node);return {name,identity:identity(node),accessibleName:named(node),role:node.getAttribute('role'),readonly:node.getAttribute('aria-readonly'),disabled:node.getAttribute('aria-disabled'),pressed:node.getAttribute('aria-pressed'),expanded:node.getAttribute('aria-expanded'),selected:node.getAttribute('aria-selected'),descriptionIds:text(node.getAttribute('aria-describedby')??'',4096),descriptionText:(node.getAttribute('aria-describedby')??'').split(/\s+/).filter(Boolean).map(id=>{const found=document.getElementById(id);check(found?.isConnected,'Connected description association');return text(found.textContent,4096);}).join(' '),invalid:node.getAttribute('aria-invalid'),textDecoration:getComputedStyle(node).textDecorationLine,borderStyle:getComputedStyle(node).borderTopStyle,borderWidth:parseFloat(getComputedStyle(node).borderTopWidth),...measured};}
function viewport(){const r=current(),v=visualViewport;return {width:innerWidth,height:innerHeight,scale:v?.scale??1,offsetLeft:v?.offsetLeft??0,offsetTop:v?.offsetTop??0,pageZoom:r.baselineWidth/innerWidth};}
function zoomEvidence(){const r=current();return {basis:'Initial/current CSS viewport under independent original AX window',baselineInnerWidth:r.baselineWidth,currentInnerWidth:innerWidth,baselineDpr:r.baselineDpr,currentDpr:devicePixelRatio,dprRatio:devicePixelRatio/r.baselineDpr,baselineOuter:r.baselineOuter,currentOuter:{width:outerWidth,height:outerHeight}};}
function selection(){const s=getSelection(),point=(node,offset)=>{if(!node)return null;check(!node.textContent||node.textContent.length<=65536,'Bounded actual browser point');return {object:token(node),nodeType:node.nodeType,inside:!!editor()?.contains(node),offset,text:node.nodeType===3?node.textContent:null};};return {rangeCount:s?.rangeCount??0,anchor:point(s?.anchorNode,s?.anchorOffset??0),focus:point(s?.focusNode,s?.focusOffset??0)};}
function measurements(){const r=current(),root=wrapper(),names=r.caseId==='presentation-kwdj'?['strong','emphasis','move','drag','add','paragraph','quote','save']:r.caseId==='presentation-notes'?['title','field','apply','cancel','save']:['retry','original'];
  const surfaces=Object.fromEntries(names.map(name=>[name,surface(name)])),reasons=[];
  for(const node of root.querySelectorAll('.kw-ui-reason')){check(reasons.length<64,'Bounded reason inventory');const style=getComputedStyle(node),box=node.getBoundingClientRect();if(node.textContent&&style.visibility==='visible'&&box.width>0&&box.height>0)reasons.push({id:node.id,text:text(node.textContent),pointerEvents:style.pointerEvents,...observeSurface(node)});}
  const clips=[];for(const node of [root,...root.querySelectorAll('.kw-ui-popup,.a66-dialog')]){check(clips.length<8,'Bounded clip inventory');const rect=node.getBoundingClientRect();clips.push({id:node.id,role:node.getAttribute('role'),accessibleName:named(node),modal:node.getAttribute('aria-modal'),hidden:node.hidden,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},scrollTop:node.scrollTop,scrollHeight:node.scrollHeight,clientHeight:node.clientHeight,scrollLeft:node.scrollLeft,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth});}
  return {surfaces,reasons,clips,layout:observeLayout(root)};
}
export async function prepare(locale,caseId){check(!active&&['en','ru'].includes(locale)&&caseIds.includes(caseId),'One closed scene');begin();
  const options={locale,caseId:caseId==='presentation-notes'?'V06-NC011-root-title-owned-metadata':'V01-forward',focus:caseId!=='presentation-recovery',...(caseId==='presentation-recovery'?{loader:'reject'}:{})};
  const mounted=await host().mount(options);check(/^a66-[1-9][0-9]{0,8}$/.test(mounted.id),'Actual a66 host ID');
  active={id:mounted.id,locale,caseId,baselineWidth:innerWidth,baselineDpr:devicePixelRatio,baselineOuter:{width:outerWidth,height:outerHeight},theme:'default'};wrapper().classList.add('a66-installed-scroll');await frames();check(stylesheet.sheet,'Frozen external presentation CSS loaded');check(viewport().width===1024&&viewport().height===768,'Initial baseline100 viewport');
  if(caseId==='presentation-recovery')check(mounted.ready.status!=='ready','Actual rejected loader, not native ready');else check(mounted.ready.status==='ready','Actual native ready');
  const before=await checkpoint();return {id:active.id,locale,caseId,prepared:mounted,before,scope:'Fixed source-authored setup; focus/mode/theme changes here are preparation, never physical interaction'};
}
export async function setup(action){check(setupIds.includes(action),'Closed presentation setup');const r=current();
  if(action==='before'){control('before').focus({preventScroll:true});return {status:'setup-focus-only',target:identity(document.activeElement)};}
  if(action.startsWith('theme-')){r.theme=action==='theme-default'?'default':'highContrast';const result=host().presentation(r.id,{theme:r.theme});await frames();return result;}
  check(r.caseId==='presentation-kwdj','Only KWDJ readonly/editable preparation');const result=host().mode(r.id,action==='readonly'?'readOnly':'editable');await frames();return result;
}
export function guard(action){const r=current();check(actions.includes(action)&&caseActions[r.caseId].includes(action),'Fixed action belongs to scene');const v=viewport(),targetName=pointerTargets[action],target=targetName?control(targetName):document.activeElement;
  let point=null,inside=false;if(target instanceof HTMLElement&&target.isConnected){if(targetName){const rect=target.getBoundingClientRect();point={x:rect.x+rect.width/2,y:rect.y+rect.height/2};const hit=document.elementFromPoint(point.x,point.y);inside=!!hit&&(hit===target||target.contains(hit));}else inside=wrapper().contains(target)||target===control('before');}
  // No Enter accepts a KWDJ option/format command, no Notes nonempty submission.
  const enterSafe=action!=='enter'||(r.caseId==='presentation-kwdj'?target===control('add'):r.caseId==='presentation-notes'&&(target===control('title')||['field','apply'].some(name=>target===control(name))&&control('field').value===''));
  const readonlyClick=action!=='click-strong'||control('strong')?.getAttribute('aria-disabled')==='true';
  return {id:r.id,caseId:r.caseId,action,target:targetName??'focused',targetIdentity:identity(target),targetObject:token(target),editorConnected:!!editor()?.isConnected,documentFocused:document.hasFocus(),point,pointerDown:false,viewport:v,zoomEvidence:zoomEvidence(),allowed:!traceOverflow&&!policyOverflow&&!errorOverflow&&policy.length===0&&errors.length===0&&!!editor()?.isConnected&&document.hasFocus()&&inside&&enterSafe&&readonlyClick&&v.scale===1&&v.offsetLeft===0&&v.offsetTop===0&&v.pageZoom>=1&&v.pageZoom<=2&&!trace.some(row=>row.event==='compositionstart'),composition:{open:false},inputTraceCount:trace.length};
}
export function cleanupGuard(action){const r=current();check(caseActions[r.caseId].includes(action),'Same scene release-only action');return {id:r.id,caseId:r.caseId,action,target:pointerTargets[action]??'focused',editorConnected:!!editor()?.isConnected,documentFocused:document.hasFocus(),viewport:viewport(),zoomEvidence:zoomEvidence(),allowed:!!editor()?.isConnected&&wrapper().isConnected,point:null,pointerDown:false,releaseOnly:true,composition:{open:false}};}
export async function inspect(){const r=current(),v=viewport();return {id:r.id,locale:r.locale,caseId:r.caseId,theme:r.theme,observation:{mountId:r.id,clock,at:performance.now()},documentFocused:document.hasFocus(),viewport:v,zoomEvidence:zoomEvidence(),active:identity(document.activeElement),selection:selection(),measurements:measurements(),inputTraceCount:trace.length,inputTrace:trace.slice(),traceOverflow,policyViolations:policy.slice(),policyOverflow,errors:errors.slice(),errorOverflow};}
export async function checkpoint(){const r=current(),native=await host().inspect(r.id),observed=await inspect(),selectionGeometry=native.state?host().installedSelectionGeometry(r.id):null;return {...observed,native,selectionGeometry};}
export async function finish(){const r=current(),before=await checkpoint(),disposed=await host().dispose(r.id);for(const remove of removals.splice(0))remove();stylesheet.remove();active=null;return {before,disposed,traceOverflow,policyOverflow,errorOverflow,policyViolations:policy.slice(),errors:errors.slice(),instrumentation:{listeners:removals.length,styleConnected:stylesheet.isConnected}};}
window.accessibilityNative={prepare,setup,guard,cleanupGuard,inspect,checkpoint,finish};
