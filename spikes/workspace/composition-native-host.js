// SPDX-License-Identifier: MIT OR Apache-2.0
// Closed installed41 surface; synthetic drivers are deliberately absent.
import * as host from './composition-host.js';
const cases=['ordinary-layout','plain-deadkey','marked-deadkey','scene-deadkey','escape-preedit','blur-refocus'];
const actions=['ordinary-en','ordinary-ru','deadkey-acute','complete-e','escape','shift-tab','tab'];
let active=null,preparing=null,policyOverflow=null;const policy=[],policyLimit=64;
function policyFailed(reason){if(policyOverflow)return;policyOverflow={reason,time:performance.now(),maximumRecords:policyLimit};throw Error('CSP diagnostic capture overflow: '+reason);}
function policyString(value,maximum,field){if(typeof value!=='string'||value.length>maximum){policyFailed(field);return null;}return value;}
document.addEventListener('securitypolicyviolation',event=>{
  if(policyOverflow)return;if(policy.length>=policyLimit){policyFailed('record_limit');return;}
  const target=event.target instanceof Element?event.target:null;
  const record={time:performance.now(),mountId:active?.id??null,caseId:active?.caseId??preparing?.caseId??null,
    directive:policyString(event.violatedDirective,128,'directive'),effectiveDirective:policyString(event.effectiveDirective,128,'effectiveDirective'),blocked:policyString(event.blockedURI,2048,'blockedURI'),
    sourceFile:policyString(event.sourceFile,2048,'sourceFile'),line:event.lineNumber,column:event.columnNumber,sample:policyString(event.sample,256,'sample'),
    targetTag:target?policyString(target.tagName.toLowerCase(),64,'targetTag'):null,targetId:target?policyString(target.id,128,'targetId'):null,disposition:policyString(event.disposition,32,'disposition')};
  if(!policyOverflow)policy.push(record);
});
const policyReadback=()=>({policyViolations:policy.slice(),policyOverflow:policyOverflow?{...policyOverflow}:null});
const check=(ok,message)=>{if(!ok)throw Error(message);};
function current(){check(active,'No owned installed composition mount');return active;}
function viewport(){const v=visualViewport;return {width:innerWidth,height:innerHeight,scale:v?.scale??1,offsetLeft:v?.offsetLeft??0,offsetTop:v?.offsetTop??0};}
export async function prepare(locale,caseId){check(!active&&['en','ru'].includes(locale)&&cases.includes(caseId),'Closed prepare');
  const family=caseId==='ordinary-layout'?(locale==='en'?'P01':'P02'):({'plain-deadkey':'P15','marked-deadkey':'P17','scene-deadkey':'P16','escape-preedit':'P18','blur-refocus':'P19'})[caseId];
  const domCase=caseId==='marked-deadkey'?'D04-marks-BR-sentinels-forward':caseId==='scene-deadkey'||caseId==='blur-refocus'?'D08-selected-scene-forward':'D01-plain-event-data-mismatch';
  preparing={caseId,locale};let prepared;try{prepared=await host.mount({caseId:domCase,nativeCase:family+'-forward',locale});}finally{preparing=null;}
  const baselinePolicy=policyReadback(),before={...prepared.before,...baselinePolicy};active={id:prepared.id,caseId,locale,family,before};
  return {...prepared,before,...baselinePolicy,caseId,locale,family,viewport:viewport(),scope:'Prepared actual SDK2 fixture only; no physical input yet'};
}
export function guard(action){check(actions.includes(action),'Closed key action');const r=current(),element=host.element(r.id),focus=document.activeElement,target=focus===element||element.contains(focus)?'editor':focus===document.getElementById('composition-host-control')?'host-control':'blocked';const v=viewport();
  return {id:r.id,caseId:r.caseId,action,target,editorConnected:element.isConnected&&!!element.closest('#composition-mounts'),documentFocused:document.hasFocus(),allowed:!policyOverflow&&element.isConnected&&document.hasFocus()&&target===(action==='tab'?'host-control':'editor')&&v.width===1024&&v.height===768&&v.scale===1&&v.offsetLeft===0&&v.offsetTop===0,viewport:v,point:null,pointerDown:false};
}
export async function inspect(){const r=current(),v=await host.inspect(r.id,false),inputs=v.trace.filter(x=>x.kind==='browser');return {id:r.id,caseId:r.caseId,lifecycle:v.lifecycle,state:v.state,resources:v.resources,inputTraceCount:inputs.length,lastInputs:inputs.slice(-24),uaComposition:v.uaComposition,rawDom:v.rawDom,activeElementId:v.activeElementId,recovery:v.recovery,traceOverflow:v.traceOverflow,...policyReadback()};}
export async function checkpoint(){const r=current(),v=await host.inspect(r.id);return {...v,caseId:r.caseId,locale:r.locale,family:r.family,inputTrace:v.trace.filter(x=>x.kind==='browser'),...policyReadback()};}
export async function settle(){const r=current(),began=performance.now();let prior=null;
  do{const v=await inspect();if(v.lifecycle==='recoveryRequired'||v.lifecycle==='fatal')return checkpoint();
    if(v.lifecycle==='ready'&&v.resources.dom.continuations===0&&(v.state.stamp.revision!==r.before.state.stamp.revision||v.uaComposition.ends>0&&!v.uaComposition.open)){
      const observed=await checkpoint(),fingerprint=JSON.stringify({state:observed.state,dom:observed.dom,ua:observed.uaComposition,resources:observed.resources.dom});if(fingerprint===prior)return observed;prior=fingerprint;
    }else prior=null;
    await new Promise(resolve=>setTimeout(resolve,50));}while(performance.now()-began<3000);
  throw Error('Bounded installed composition settlement did not become terminal; actual UA ownership is not cancellation');
}
export async function undo(){return host.history(current().id,'undo');}
export async function redo(){return host.history(current().id,'redo');}
export function focusControl(){return host.focusControl();}
export async function finish(){const r=current(),before=await checkpoint(),disposed=await host.dispose(r.id),final=await host.allDisposed();host.element(r.id).remove();active=null;return {...disposed,caseId:r.caseId,before,nativeFinal:final.native,errors:before.errors,...policyReadback()};}
window.compositionNative={prepare,guard,inspect,checkpoint,settle,finish,focusControl,undo,redo};window.compositionNativeReady=true;
