// SPDX-License-Identifier: MIT OR Apache-2.0
// Closed acceptance host. Profile factories are deliberately outside generic UI.
import { loadSdkV2, sdkBuildId, createCommand } from '@klenwriter/editor-sdk';
import { mountEditor } from '@klenwriter/editor-dom';
import { createEditorUi, defineUiHostAction } from '@klenwriter/editor-ui';
import { kwdjCommand } from '@klenwriter/editor-kwdj';
import { kwdjBasicRenderers } from '@klenwriter/editor-kwdj/dom';
import { notesD0Renderers } from '/notes-dom.mjs';

const copy=value=>value===undefined?undefined:structuredClone(value),assert=(condition,message)=>{if(!condition)throw new Error(message);};
const [module,packet,cases,geometry]=await Promise.all([loadSdkV2(),fetch('/extensions-packet.json').then(r=>r.json()),fetch('/ui-cases.json').then(r=>r.json()),fetch('/ui-contract/geometry-fixtures.json').then(r=>r.json())]);
const records=new Map();let serial=0;
const rec=id=>{const value=records.get(id);assert(value,'Known fixture mount');return value;};
const text=(ru,en)=>({ru,en}),unavailable=(code='fixture.no_destination')=>({status:'unavailable',code,message:text('Нет подходящей позиции.','No suitable destination.')});
const done=result=>result.status==='queued'?result.completion.then(response=>({status:'queued',response})):Promise.resolve(result);
const nativeState=r=>{const response=r.editor.read({kind:'state'});assert(response.status==='ok'&&response.value.kind==='state','Native state');return response.value.state;};
function rows(r){
  const state=nativeState(r),result=[],pending=[{id:state.root,path:[]}],seen=new Set();
  for(let index=0;index<pending.length;index++){
    assert(index<4096,'Finite fixture');const next=pending[index];assert(!seen.has(next.id),'Unique native tree');seen.add(next.id);
    const response=r.editor.read({kind:'node',stamp:state.stamp,node:next.id});assert(response.status==='ok'&&response.value.kind==='node','Native row');const node=response.value.node;
    result.push({path:next.path,node:copy(node)});node.children.forEach((id,i)=>pending.push({id,path:[...next.path,i]}));
  }
  return {state:copy(state),rows:result};
}
function bind(r,paths){
  const actual=rows(r);
  for(const [role,path]of Object.entries(paths)){const found=actual.rows.find(row=>JSON.stringify(row.path)===JSON.stringify(path));assert(found,`Literal role ${role}`);if(r.ids.has(role))assert(r.ids.get(role)===found.node.id,`Historical role ${role}`);else r.ids.set(role,found.node.id);}
  return Object.fromEntries(r.ids);
}
function resolve(r,value){
  if(Array.isArray(value))return value.map(v=>resolve(r,v));
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,['node','parent'].includes(key)&&typeof v==='string'&&r.ids.has(v.replace(/^@/,''))?r.ids.get(v.replace(/^@/,'')):resolve(r,v)]));
}
async function snapshot(r){const result=await done(r.editor.submit({kind:'snapshot',stamp:r.editor.capture(),max_bytes:2097152}));assert(result.response?.status==='ok'&&result.response.value.kind==='snapshot','Canonical snapshot');const value=result.response.value;await done(r.editor.submit({kind:'release_snapshot',handle:value.handle}));return value.canonical_json;}
function hostDialog(r){
  const scope=document.createElement('section');scope.className='ui-fixture-dialog';scope.id=`${r.id}-dialog`;scope.hidden=true;scope.setAttribute('role','dialog');scope.setAttribute('aria-modal','true');
  const heading=document.createElement('h2');heading.id=`${scope.id}-title`;heading.textContent=r.locale==='ru'?'Параметры блока':'Block options';scope.setAttribute('aria-labelledby',heading.id);
  const form=document.createElement('form'),label=document.createElement('label'),input=document.createElement('input'),apply=document.createElement('button'),cancel=document.createElement('button');
  label.textContent=r.locale==='ru'?'Заголовок':'Title';input.id=`${scope.id}-input`;input.setAttribute('aria-label',label.textContent);input.type='text';input.autocomplete='off';label.append(input);
  apply.type='submit';apply.tabIndex=0;apply.textContent=r.locale==='ru'?'Применить':'Apply';cancel.type='button';cancel.tabIndex=0;cancel.textContent=r.locale==='ru'?'Отмена':'Cancel';form.append(label,apply,cancel);scope.append(heading,form);r.wrapper.append(scope);r.dialog=scope;r.dialogInput=input;
  const action=defineUiHostAction({id:'title',label:text('Параметры блока','Block options'),scope,
    open(connection){
      assert(!r.connection,'One host-owned dialog');r.connection=connection;r.hostConnections.push(connection);r.hostOpenCount++;scope.hidden=false;input.value='';
      const submit=event=>{event.preventDefault();connection.accept({title:input.value});},abort=()=>{},cancelling=()=>connection.cancel();
      const key=event=>{
        if(event.key==='Escape'){event.preventDefault();connection.cancel();}
        else if(event.key==='Tab'){
          const order=[input,apply,cancel],index=order.indexOf(document.activeElement);
          if(event.shiftKey&&index<=0){event.preventDefault();cancel.focus();}else if(!event.shiftKey&&index===order.length-1){event.preventDefault();input.focus();}
        }
      };
      form.addEventListener('submit',submit);cancel.addEventListener('click',cancelling);scope.addEventListener('keydown',key);connection.signal.addEventListener('abort',abort,{once:true});input.focus();
      let closed=false;return reason=>{if(closed)return;closed=true;r.hostCloseReasons.push(reason);form.removeEventListener('submit',submit);cancel.removeEventListener('click',cancelling);scope.removeEventListener('keydown',key);connection.signal.removeEventListener('abort',abort);scope.hidden=true;r.connection=null;};
    },
    command(captured,result){assert(captured.context.profile.profile_id==='org.example.notes','Real independent profile');return createCommand('org.example.notes/command/set-title',{title:result.title});},
  });
  return action;
}
function profile(r){
  if(r.notes){const title=hostDialog(r);return ()=>({toolbar:[title],insertions:[],blockActions:[],moves:()=>unavailable('fixture.profile_has_no_move')});}
  const action=(id,label,intent,kind='command')=>({id,label,kind,command:()=>kwdjCommand(intent)});
  return ()=>({toolbar:[action('strong',text('Полужирный','Bold'),{kind:'toggle_mark',mark:{type_id:'org.klenwriter.kwdj/strong',attributes:{}}},'toggle'),action('emphasis',text('Курсив','Italic'),{kind:'toggle_mark',mark:{type_id:'org.klenwriter.kwdj/emphasis',attributes:{}}},'toggle')],
    insertions:[action('paragraph',text('Абзац','Paragraph'),{kind:'insert_block',target:{kind:'paragraph'}}),action('quote',text('Цитата','Quote'),{kind:'insert_block',target:{kind:'blockquote'}}),action('table',text('Таблица','Table'),{kind:'insert_block',target:{kind:'table'}})],blockActions:[],
    moves(captured){
      const {node,parent,index}=captured.block,read=id=>{const x=r.editor.read({kind:'node',stamp:captured.state.stamp,node:id});return x.status==='ok'&&x.value.kind==='node'?x.value.node:null;};
      const previous=index>0?read(parent.children[index-1]):null,grandparent=parent.parent?read(parent.parent):null;
      return [
        {id:'up',direction:'up',label:text('Выше','Move up'),command:index>0?kwdjCommand({kind:'move',node:node.id,parent:parent.id,before_index:index-1}):unavailable()},
        {id:'down',direction:'down',label:text('Ниже','Move down'),command:kwdjCommand({kind:'move',node:node.id,parent:parent.id,before_index:index+2})},
        {id:'nest',direction:'nest',label:text('Внутрь','Nest'),command:previous?kwdjCommand({kind:'move',node:node.id,parent:previous.id,before_index:previous.children.length}):unavailable()},
        {id:'unnest',direction:'unnest',label:text('Наружу','Unnest'),command:grandparent?kwdjCommand({kind:'move',node:node.id,parent:grandparent.id,before_index:grandparent.children.indexOf(parent.id)+1}):unavailable()},
      ];
    },
  });
}
function publicFailure(value){return value?.status==='sdk_failure'?{status:value.status,response:copy(value.response)}:value?.status==='dom_refused'?copy(value):null;}
function fixtureFacts(r){return {mode:r.mode,modeResults:copy(r.modeResults),hostAttributes:Object.fromEntries(['contenteditable','tabindex','role','aria-readonly','aria-disabled','aria-label'].map(key=>[key,r.element.getAttribute(key)])),clipboardResults:copy(r.clipboardResults),recoveryResults:copy(r.recoveryResults),nativeTrace:{enabled:r.nativeTraceEnabled,calls:r.nativeCalls.length,bytes:r.nativeTraceBytes,overflow:r.nativeTraceOverflow}};}
function observedModule(r,{controlled=false,trace=false}={}){
  // Optional finite observation keeps exact call bytes and delegates unchanged.
  // Controlled geometry faults remain a distinct, explicitly labelled lane.
  class ObservedSession{
    constructor(input,options){this.actual=new module.Session(input,options);this.stamp=null;}
    initialization(){const bytes=this.actual.initialization(),reply=JSON.parse(bytes);this.stamp=reply.value?.state?.stamp??null;return bytes;}
    context(){return this.actual.context();}
    call(bytes){
      if(trace&&(r.nativeCalls.length>=16384||r.nativeTraceBytes>=8388608)){
        r.nativeTraceOverflow=true;throw new Error('Finite native-call observation exhausted; fixture proof failed');
      }
      const request=JSON.parse(bytes);if(controlled&&r.pendingFault&&request.kind==='state'){
      const status=r.pendingFault;r.pendingFault=null;const response={status,diagnostic:{code:`fixture.controlled_${status}`,path:'/controlled-geometry-read',category:'transport',details:{fixture:'finite geometry read failure'},stamp:this.stamp,may_have_committed:false}};r.faultResponses.push(copy(response));return JSON.stringify(response);
    }
      const bytesOut=this.actual.call(bytes),reply=JSON.parse(bytesOut);this.stamp=reply.value?.state?.stamp??this.stamp;
      if(trace){
        r.nativeCalls.push({ordinal:r.nativeCalls.length+1,requestJson:bytes,responseJson:bytesOut});
        r.nativeTraceBytes+=new TextEncoder().encode(bytes).length+new TextEncoder().encode(bytesOut).length;
        if(r.nativeTraceBytes>8388608){r.nativeTraceOverflow=true;throw new Error('Finite native-call observation byte limit exceeded; original bytes retained, fixture proof failed');}
      }
      return bytesOut;
    }
    destroy(){this.actual.destroy();}free(){this.actual.free();}
  }
  return {manifest:module.manifest,Session:ObservedSession,resourceCounts:()=>module.resourceCounts()};
}
export async function mount(config={}){
  const selected=cases.find(c=>c.job.id===(config.case??'V01-forward')),id=`ui42-${++serial}`,wrapper=document.createElement('section');wrapper.className='ui-fixture';wrapper.id=id;
  const toolbar=document.createElement('div'),gutter=document.createElement('div'),entry=document.createElement('div'),element=document.createElement('div');
  element.id=`${id}-editor`;element.className='ui-fixture-editor';element.setAttribute('aria-label',config.locale==='ru'?'Документ':'Document');
  for(const [name,node]of Object.entries({toolbar,gutter,entry}))node.id=`${id}-${name}`;
  wrapper.append(toolbar,element,gutter,entry);document.querySelector('#ui-mounts').append(wrapper);
  const r={id,wrapper,element,slots:{toolbar,gutter,entry},ids:new Map(),events:[],failures:[],results:[],focusResults:[],focusPromises:[],requests:new Map(),hostConnections:[],hostOpenCount:0,hostCloseReasons:[],locale:config.locale??'en',notes:selected.job.profile.profile_id==='org.example.notes',faultResponses:[],geometryProbeResults:[],mode:config.mode??'editable',modeResults:[],clipboardResults:[],recoveryResults:[],nativeCalls:[],nativeTraceEnabled:config.nativeTrace===true,nativeTraceBytes:0,nativeTraceOverflow:false};records.set(id,r);
  let job=copy(selected.job),rolePaths=selected.expected.rolesBefore;
  if(config.geometry){const f=geometry.fixtures[config.geometry];assert(f,'Closed geometry fixture');job.input=f.canonical_json;rolePaths=f.roles;job.selection=f.selection?resolve(r,f.selection):null;}
  if(config.source!==undefined)job.input=typeof config.source==='string'?config.source:JSON.stringify(config.source);
  r.source=job.input;r.job=job;
  if(config.direction){assert(config.direction==='rtl','Closed fixture direction');element.dir='rtl';}
  assert(!(config.controlledReadFault&&config.nativeTrace),'Native trace and controlled transport faults are separate lanes');
  const loaded=config.controlledReadFault||config.nativeTrace?observedModule(r,{controlled:config.controlledReadFault===true,trace:config.nativeTrace===true}):module;
  const loader=config.delayed?new Promise(resolve=>{r.releaseLoader=()=>resolve(loaded);}):Promise.resolve(loaded);
  r.editor=mountEditor({element,editor:{input:new TextEncoder().encode(job.input),options:{abi:'editor-sdk/2',build_id:sdkBuildId,profile:job.profile,admission:'validate',access:config.access??'editable',registry_json:job.registry_json,profile_options_json:job.profile_options_json},loader:()=>loader},renderers:r.notes?notesD0Renderers:kwdjBasicRenderers,...(config.mode?{mode:config.mode}:{}),onRefusal:f=>r.failures.push(copy(f)),
    clipboard:{onResult:value=>{assert(r.clipboardResults.length<64,'Finite clipboard observations');r.clipboardResults.push({action:value.action,status:value.status,clipboard:value.clipboard,failure:copy(value.failure),submission:value.submission?{status:value.submission.status,...(value.submission.status==='completed'?{response:copy(value.submission.response)}:{})}:null});}},
    onRecovery:packet=>{assert(r.recoveryResults.length<64,'Finite recovery observations');const c=packet.composition;r.recoveryResults.push({originalInputBytes:packet.originalInput?.byteLength??null,region:packet.region?.kind==='bounded'?copy(packet.region):packet.region?{kind:packet.region.kind,reason:packet.region.reason,ownership:packet.region.ownership,connected:packet.region.element.isConnected}:null,composition:c?{generation:c.generation,reason:c.reason,context:copy(c.context),base:copy(c.base),selection:copy(c.selection),affectedNodeIds:copy(c.affectedNodeIds),nativeOutcome:c.nativeOutcome,response:copy(c.response),disposition:c.disposition,unappliedInput:c.unappliedInput?.kind==='bounded'?copy(c.unappliedInput):c.unappliedInput?{kind:c.unappliedInput.kind,reason:c.unappliedInput.reason,ownership:c.unappliedInput.ownership}:null}:null});}});
  if(config.delayed)return {id,lifecycle:r.editor.lifecycle,uiCreated:false};
  const ready=await r.editor.ready;assert(ready.status==='ready',JSON.stringify(ready));r.editor.subscribe(event=>{r.events.push(copy(event));if(r.geometryProbe){const role=r.geometryProbe;r.geometryProbe=null;r.geometryProbeResults.push(copy(r.editor.geometry.read({kind:'block',node:r.ids.get(role),stamp:event.after})));}if(r.destroyProbe){r.destroyProbe=false;const receipt=r.editor.destroy();r.geometryProbeResults.push({phase:r.editor.lifecycle,sdkTicket:receipt.sdk.status,geometry:copy(r.editor.geometry.read({kind:'selection',stamp:event.after}))});}});bind(r,rolePaths);
  const chosen=config.selection??(config.geometry?geometry.fixtures[config.geometry].selection??null:selected.expected.selectionBefore);
  if(chosen){const request=r.editor.submit({kind:'set_selection',stamp:r.editor.capture(),selection:resolve(r,chosen)});assert(request.status==='completed'&&request.response.status==='ok','Literal selection setup');}
  if(config.geometryOnly)return {id,ready:ready.status,roles:Object.fromEntries(r.ids),uiCreated:false};
  r.ui=createEditorUi({editor:r.editor,editorElement:element,slots:r.slots,locale:r.locale,profile:profile(r),onResult:result=>{
    if(result.status==='submitted'){
      r.results.push({status:result.status,action:result.action,submission:result.submission.status,...(result.submission.status==='completed'?{response:copy(result.submission.response)}:{})});
      const work=result.focus.then(value=>r.focusResults.push(copy(value)));r.focusPromises.push(work);
    }else r.results.push(copy(result));
  }});
  assert(!('status'in r.ui),JSON.stringify(r.ui));const uiReady=await r.ui.ready;assert(uiReady.status==='ready',JSON.stringify(uiReady));r.events=[];
  return {id,ready:ready.status,uiReady:uiReady.status,roles:Object.fromEntries(r.ids),case:config.case??'V01-forward'};
}
export async function inspect(id){
  const r=rec(id);await Promise.all(r.focusPromises);const actual=rows(r);return {...actual,canonical:await snapshot(r),roles:Object.fromEntries(r.ids),events:copy(r.events),failures:copy(r.failures),results:copy(r.results),focusResults:copy(r.focusResults),activeId:document.activeElement?.id??null,activeTag:document.activeElement?.tagName??null,insideEditor:r.element.contains(document.activeElement),resources:copy(r.editor.resources()),uiResources:copy(r.ui.resources()),context:copy(r.editor.context()),...fixtureFacts(r),dialog:r.dialog?{hidden:r.dialog.hidden,openCount:r.hostOpenCount,closeReasons:copy(r.hostCloseReasons)}:null};
}
export async function editorFocus(id){const r=rec(id),capture=r.editor.selection.captureBookmark();if(capture.status!=='captured')return copy(capture);return copy(await done(r.editor.selection.restoreBookmark(capture.bookmark,{policy:'exact',focus:true})));}
export function refresh(id){rec(id).ui.refresh();}
export async function select(id,literal,{focus=false}={}){const r=rec(id);if(focus)r.element.focus({preventScroll:true});const result=await done(r.editor.submit({kind:'set_selection',stamp:r.editor.capture(),selection:resolve(r,literal)}));r.ui.refresh();return copy(result);}
export async function command(id,intent){const r=rec(id);return copy(await done(r.editor.submit({kind:'command',stamp:r.editor.capture(),command:kwdjCommand(resolve(r,intent)),history_hint:{kind:'isolated'}})));}
export async function history(id,direction){const r=rec(id);const result=await done(r.editor.submit({kind:'history',stamp:r.editor.capture(),direction}));r.ui.refresh();return copy(result);}
export function mode(id,value,direct=false){const r=rec(id),result=direct?r.editor.setInteractionMode(value):r.ui.setInteractionMode(value);if(direct)r.ui.refresh();r.modeResults.push(copy(result));if(result.status==='updated')r.mode=result.mode;return copy(result);}
export function locale(id,value){const r=rec(id);r.locale=value;r.ui.setLocale(value);}
export function bindAfter(id,paths){return bind(rec(id),paths);}
export function geometryRead(id,request){const r=rec(id);return copy(r.editor.geometry.read({...request,stamp:request.stamp??r.editor.capture(),...(request.node?{node:r.ids.get(request.node)??request.node}:{})}));}
export function geometryRawRead(id,request){return copy(rec(id).editor.geometry.read(request));}
export function nativeFault(id,status){assert(['refused','fatal'].includes(status),'Closed controlled fault');rec(id).pendingFault=status;}
export function geometryProbeNextEvent(id,role='P'){rec(id).geometryProbe=role;}
export async function destroySubscriberProbe(id,intent){const r=rec(id);r.destroyProbe=true;const result=await command(id,intent);return {result,probes:copy(r.geometryProbeResults),facts:mountedFacts(id)};}
export async function destroyMountedProbe(id){const r=rec(id);if(r.ui)await r.ui.destroy().settled;const receipt=r.editor.destroy();const immediate={phase:r.editor.lifecycle,geometry:copy(r.editor.geometry.read({kind:'selection',stamp:{session:'old',generation:'1',revision:'0',selection_epoch:'0',history_epoch:'0'}}))};if(receipt.sdk.status==='queued')await receipt.sdk.completion;r.releaseLoader?.();await Promise.resolve();return {immediate,facts:mountedFacts(id)};}
export function mountedFacts(id){const r=rec(id);return {lifecycle:r.editor.lifecycle,stamp:copy(r.editor.capture()),context:copy(r.editor.context()),resources:copy(r.editor.resources()),native:copy(r.editor.nativeResources()),faultResponses:copy(r.faultResponses),geometryProbeResults:copy(r.geometryProbeResults),...fixtureFacts(r)};}
export function nativeTrace(id){const r=rec(id);return {enabled:r.nativeTraceEnabled,overflow:r.nativeTraceOverflow,bytes:r.nativeTraceBytes,calls:copy(r.nativeCalls)};}
export async function nativeHostEdit(id){const r=rec(id);assert(r.notes,'Closed host edit is Notes-only');const result=await done(r.editor.submit({kind:'command',stamp:r.editor.capture(),command:createCommand('org.example.notes/command/set-title',{title:'host-updated'}),history_hint:{kind:'isolated'}}));r.ui.refresh();return copy(result);}
export function capture(id,name='R',scope='toolbar'){const r=rec(id),focusScope=scope==='dialog'?r.dialog:scope==='external'?document.body:r.slots[scope];const value=r.editor.hostRequests.capture(focusScope?{focusScope}:{});if(value.status==='captured')r.requests.set(name,value.request);return value.status==='captured'?{status:value.status,stamp:copy(value.request.stamp),context:copy(value.request.context)}:copy(value);}
export function release(id,name='R'){const r=rec(id);return r.editor.hostRequests.release(r.requests.get(name));}
export async function complete(id,name,intent,options={focus:'none'}){const r=rec(id),value=r.editor.hostRequests.complete(r.requests.get(name),kwdjCommand(resolve(r,intent)),options);if(value.status!=='submitted')return copy(value);const submission=await done(value.submission),focus=await value.focus;return {status:value.status,submission:copy(submission),focus:copy(focus)};}
export async function cancel(id,name,options={focus:false}){const r=rec(id),value=r.editor.hostRequests.cancel(r.requests.get(name),options);return value.status==='cancelled'?{status:value.status,restore:value.restore?copy(await done(value.restore)):null}:copy(value);}
export function lateAccept(id,index,value){const r=rec(id);r.hostConnections[index].accept(value);}
export function status(id){return copy(rec(id).editor.hostRequests.status());}
export async function replace(id,source){const r=rec(id),result=await r.editor.replace(new TextEncoder().encode(typeof source==='string'?source:JSON.stringify(source)));r.ui.refresh();return copy(await done(result));}
export async function destroy(id){const r=rec(id);if(r.ui)await r.ui.destroy().settled;const receipt=r.editor.destroy();if(receipt.sdk.status==='queued')await receipt.sdk.completion;r.releaseLoader?.();await Promise.resolve();const result={ui:r.ui?copy(r.ui.resources()):{listeners:0,observers:0,animationFrames:0,subscriptions:0,hostRequests:0,continuations:0},mounted:copy(r.editor.resources()),native:copy(r.editor.nativeResources()),...(r.nativeTraceEnabled?{nativeTrace:nativeTrace(id)}:{})};r.wrapper.remove();records.delete(id);return result;}
window.ui42={mount,inspect,editorFocus,refresh,select,command,history,mode,locale,bindAfter,geometryRead,geometryRawRead,nativeFault,geometryProbeNextEvent,destroySubscriberProbe,destroyMountedProbe,mountedFacts,nativeTrace,nativeHostEdit,capture,release,complete,cancel,lateAccept,status,replace,destroy,publicFailure,cases:copy(cases),geometry:copy(geometry),moduleManifest:copy(module.manifest)};
