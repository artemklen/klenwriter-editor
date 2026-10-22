// SPDX-License-Identifier: MIT OR Apache-2.0
// Closed public-API host. All content is an authored test literal, never user data.
import {loadSdkV2,sdkBuildId,createCommand} from '@klenwriter/editor-sdk';
import {mountEditor} from '@klenwriter/editor-dom';
import {createEditorUi,defineUiHostAction} from '@klenwriter/editor-ui';
import {kwdjCommand} from '@klenwriter/editor-kwdj';
import {kwdjBasicRenderers} from '@klenwriter/editor-kwdj/dom';
import {notesD0Renderers} from '/notes-dom.mjs';
const [module,packet,cases]=await Promise.all([loadSdkV2(),fetch('/extensions-packet.json').then(r=>r.json()),fetch('/ui-cases.json').then(r=>r.json())]);
const records=new Map(),encoder=new TextEncoder();let serial=0;
const clone=value=>value===undefined?undefined:structuredClone(value),check=(ok,why)=>{if(!ok)throw Error(why);};
const rec=id=>{const r=records.get(id);check(r,'Unknown accessibility mount');return r;};
const done=async value=>value.status==='queued'?{status:value.status,response:await value.completion}:value;
const words={en:{document:'Document',title:'Title',dialog:'Block options',apply:'Apply',cancel:'Cancel',required:'Enter a title.',save:'Save document',reopen:'Reopen saved copy',saved:'Saved copy acknowledged.',loadError:'Could not open the editor.',runtimeError:'Editing stopped. Save a copy before restarting.',retry:'Retry',original:'Download original document'},ru:{document:'Документ',title:'Заголовок',dialog:'Параметры блока',apply:'Применить',cancel:'Отмена',required:'Введите заголовок.',save:'Сохранить документ',reopen:'Открыть сохранённую копию',saved:'Сохранённая копия подтверждена.',loadError:'Не удалось открыть редактор.',runtimeError:'Редактирование остановлено. Сохраните копию перед повторным запуском.',retry:'Повторить',original:'Скачать исходный документ'}};
const text=(ru,en)=>({ru,en}),unavailable=()=>({status:'unavailable',code:'fixture.no_destination',message:text('Нет подходящей позиции.','No suitable destination.')});
function boundedPush(array,value,limit=256){check(array.length<limit,'Bounded source-observation overflow');array.push(value);}
function nativeRows(r){
  const response=r.editor.read({kind:'state'});if(response.status!=='ok')return {response:clone(response),state:null,rows:null};
  const state=response.value.state,rows=[],queue=[{id:state.root,path:[]}],seen=new Set();
  for(const entry of queue){check(queue.length<=128&&!seen.has(entry.id),'Finite unique authored tree');seen.add(entry.id);const reply=r.editor.read({kind:'node',stamp:state.stamp,node:entry.id});check(reply.status==='ok'&&reply.value.kind==='node','Original native node reply');const node=reply.value.node;rows.push({path:entry.path,node:clone(node)});node.children.forEach((id,index)=>queue.push({id,path:[...entry.path,index]}));}
  return {state:clone(state),rows};
}
function resolve(value,roles){if(Array.isArray(value))return value.map(v=>resolve(v,roles));if(!value||typeof value!=='object')return value;return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,['node','parent'].includes(key)&&typeof v==='string'&&Object.hasOwn(roles,v)?roles[v]:resolve(v,roles)]));}
function tracedModule(r){
  class Session{
    constructor(input,options){this.actual=new module.Session(input,options);this.stamp=null;}
    initialization(){const bytes=this.actual.initialization();this.stamp=JSON.parse(bytes).value?.state?.stamp??null;return bytes;}
    context(){return this.actual.context();}
    call(bytes){
      check(r.trace.length<1024&&r.traceBytes<2097152,'Finite original wire trace');const request=JSON.parse(bytes),at=performance.now();let reply,error;
      if(r.controlledFatal&&request.kind==='state'){
        r.controlledFatal=false;reply=JSON.stringify({status:'fatal',diagnostic:{code:'fixture.controlled_fatal',path:'/controlled-accessibility-state',category:'transport',details:{fixture:'source-authored controlled fatal read, no native mutation'},stamp:this.stamp,may_have_committed:false}});
      }else try{reply=this.actual.call(bytes);}catch(value){error=value;}
      boundedPush(r.trace,{requestJson:bytes,responseJson:reply??null,startedAt:at,finishedAt:performance.now(),outcome:error?'threw':'returned',...(error?{error:{name:String(error.name),message:String(error.message)}}:{})},1024);
      r.traceBytes+=encoder.encode(bytes).length+(reply?encoder.encode(reply).length:0);check(r.traceBytes<=2097152,'Original wire byte cap');if(error)throw error;
      this.stamp=JSON.parse(reply).value?.state?.stamp??this.stamp;return reply;
    }
    destroy(){this.actual.destroy();}free(){this.actual.free();}
  }
  return {manifest:module.manifest,Session,resourceCounts:()=>module.resourceCounts()};
}
function hostDialog(r){
  const scope=document.createElement('section');scope.className='a66-dialog';scope.id=`${r.id}-dialog`;scope.hidden=true;scope.setAttribute('role','dialog');scope.setAttribute('aria-modal','true');scope.lang=r.locale;
  const title=document.createElement('h2');title.id=`${scope.id}-title`;title.textContent=words[r.locale].dialog;scope.setAttribute('aria-labelledby',title.id);
  const form=document.createElement('form'),label=document.createElement('label'),input=document.createElement('input'),error=document.createElement('p'),apply=document.createElement('button'),cancel=document.createElement('button');
  label.textContent=words[r.locale].title;input.id=`${scope.id}-field`;input.type='text';label.htmlFor=input.id;error.id=`${input.id}-error`;error.className='a66-field-error';error.setAttribute('role','alert');
  apply.type='submit';apply.textContent=words[r.locale].apply;cancel.type='button';cancel.textContent=words[r.locale].cancel;form.append(label,input,error,apply,cancel);scope.append(title,form);r.wrapper.append(scope);
  r.dialog={scope,title,label,input,error,apply,cancel};
  return defineUiHostAction({id:'title',label:text('Параметры блока','Block options'),scope,open(connection){
    check(!r.connection,'One actual host dialog');r.connection=connection;scope.hidden=false;input.value='';error.textContent='';input.removeAttribute('aria-invalid');input.removeAttribute('aria-describedby');
    const submit=event=>{event.preventDefault();if(!input.value.trim()){input.setAttribute('aria-invalid','true');input.setAttribute('aria-describedby',error.id);error.textContent=words[r.locale].required;input.focus();return;}connection.accept({title:input.value});};
    const abort=()=>connection.cancel(),key=event=>{if(event.key==='Escape'){event.preventDefault();connection.cancel();}if(event.key==='Tab'&&!event.altKey&&!event.ctrlKey&&!event.metaKey){const order=[input,apply,cancel],at=order.indexOf(document.activeElement);event.preventDefault();order[(Math.max(0,at)+(event.shiftKey?order.length-1:1))%order.length].focus();}};
    form.addEventListener('submit',submit);cancel.addEventListener('click',abort);scope.addEventListener('keydown',key);input.focus();
    return reason=>{r.closedDialogs.push(reason);form.removeEventListener('submit',submit);cancel.removeEventListener('click',abort);scope.removeEventListener('keydown',key);scope.hidden=true;r.connection=null;};
  },command(captured,result){check(captured.context.profile.profile_id==='org.example.notes','Independent actual Notes profile');return createCommand('org.example.notes/command/set-title',{title:result.title});}});
}
function profile(r){
  if(r.notes){const title=hostDialog(r);return ()=>({toolbar:[title],insertions:[],blockActions:[],moves:unavailable});}
  const action=(id,label,intent,kind='command')=>({id,label,kind,command:()=>kwdjCommand(intent)});
  return ()=>({toolbar:[action('strong',text('Полужирный','Bold'),{kind:'toggle_mark',mark:{type_id:'org.klenwriter.kwdj/strong',attributes:{}}},'toggle'),action('emphasis',text('Курсив','Italic'),{kind:'toggle_mark',mark:{type_id:'org.klenwriter.kwdj/emphasis',attributes:{}}},'toggle')],
    insertions:[action('paragraph',text('Абзац','Paragraph'),{kind:'insert_block',target:{kind:'paragraph'}}),action('quote',text('Цитата','Quote'),{kind:'insert_block',target:{kind:'blockquote'}})],blockActions:[],
    moves(c){const {node,parent,index}=c.block,read=id=>{const q=r.editor.read({kind:'node',stamp:c.state.stamp,node:id});return q.status==='ok'?q.value.node:null;},previous=index?read(parent.children[index-1]):null,grand=parent.parent?read(parent.parent):null;
      return [{id:'up',direction:'up',label:text('Выше','Move up'),command:index?kwdjCommand({kind:'move',node:node.id,parent:parent.id,before_index:index-1}):unavailable()},
        {id:'down',direction:'down',label:text('Ниже','Move down'),command:kwdjCommand({kind:'move',node:node.id,parent:parent.id,before_index:index+2})},
        {id:'nest',direction:'nest',label:text('Внутрь','Nest'),command:previous?kwdjCommand({kind:'move',node:node.id,parent:previous.id,before_index:previous.children.length}):unavailable()},
        {id:'unnest',direction:'unnest',label:text('Наружу','Unnest'),command:grand?kwdjCommand({kind:'move',node:node.id,parent:grand.id,before_index:grand.children.indexOf(parent.id)+1}):unavailable()}];},
  });
}
function showHostError(r,kind){
  r.error.hidden=false;r.errorHeading.textContent=words[r.locale][kind==='load'?'loadError':'runtimeError'];r.retry.textContent=words[r.locale].retry;r.original.textContent=words[r.locale].original;r.error.dataset.failure=kind;
}
export async function mount(options={}){
  check([...records.values()].filter(r=>!r.disposed).length<4&&records.size<12,'Finite mounts');const locale=options.locale??'en';check(['ru','en'].includes(locale),'Closed locale');
  const selected=cases.find(c=>c.job.id===(options.caseId??'V01-forward'));check(selected,'Authored UI case');const job=clone(selected.job),id=`a66-${++serial}`;
  if(options.source!==undefined){check(typeof options.source==='string'&&encoder.encode(options.source).length<=16384,'Bounded authored canonical input');job.input=options.source;}
  check(options.layout===undefined||options.layout==='scroll','Closed supplemental initial layout');
  const wrapper=document.createElement('section');wrapper.id=id;wrapper.className='a66-mount'+(options.layout==='scroll'?' a66-scroll':'');const element=document.createElement('div');element.id=`${id}-editor`;element.className='a66-editor';
  // Name localization updates this connected, external host label. Root attrs
  // are supplied once before mount; the mounted mutation guard stays intact.
  const label=document.createElement('p');label.id=`${id}-label`;label.lang=locale;label.textContent=words[locale].document;
  const hostAttributes={'aria-labelledby':label.id,lang:options.hostLang??locale,'aria-multiline':'false','aria-busy':'false',...options.hostAttributes};
  for(const [name,value]of Object.entries(hostAttributes)){check(['aria-labelledby','aria-label','lang','aria-multiline','aria-busy'].includes(name)&&typeof value==='string','Closed host attributes');element.setAttribute(name,value);}
  const toolbar=document.createElement('div'),gutter=document.createElement('div'),entry=document.createElement('div');wrapper.append(label,toolbar,element,gutter,entry);
  const controls=document.createElement('div');controls.className='a66-host-controls';const save=document.createElement('button'),reopen=document.createElement('button'),hostStatus=document.createElement('p');save.id=`${id}-save`;reopen.id=`${id}-reopen`;save.textContent=words[locale].save;reopen.textContent=words[locale].reopen;save.type=reopen.type='button';save.tabIndex=reopen.tabIndex=0;reopen.disabled=true;hostStatus.setAttribute('role','status');controls.append(save,reopen,hostStatus);wrapper.append(controls);
  const error=document.createElement('section'),errorHeading=document.createElement('h2'),retry=document.createElement('button'),original=document.createElement('button');error.className='a66-host-error';error.hidden=true;error.setAttribute('role','alert');errorHeading.id=`${id}-error-title`;error.setAttribute('aria-labelledby',errorHeading.id);retry.type=original.type='button';retry.tabIndex=original.tabIndex=0;error.append(errorHeading,retry,original);wrapper.append(error);document.getElementById('a66-mounts').append(wrapper);
  const r={id,locale,wrapper,label,element,slots:{toolbar,gutter,entry},job,source:job.input,options:clone(options),notes:job.profile.profile_id==='org.example.notes',roles:{},hostAttributes,events:[],results:[],failures:[],fixtureErrors:[],recoveries:[],closedDialogs:[],trace:[],traceBytes:0,focusTasks:[],hostTasks:[],saves:[],save,reopen,hostStatus,error,errorHeading,retry,original,removals:[],disposed:null,disposing:null};records.set(id,r);
  const listen=(node,type,fn)=>{node.addEventListener(type,fn);r.removals.push(()=>node.removeEventListener(type,fn));};
  listen(save,'click',()=>track(r,'host',saveSnapshot(id)));listen(reopen,'click',()=>track(r,'host',reopenSaved(id)));listen(retry,'click',()=>track(r,'host',restart(id)));listen(original,'click',()=>{r.originalRecovery={bytes:encoder.encode(r.source).length,input:r.source,qualification:'Controlled test-host original payload; no edited/saved claim'};});
  let loaded=Promise.resolve(tracedModule(r));
  if(options.loader==='held')loaded=new Promise(resolve=>{r.releaseLoader=()=>resolve(tracedModule(r));});
  if(options.loader==='reject')loaded=Promise.reject(new Error('Source-authored controlled loader rejection'));
  r.editor=mountEditor({element,editor:{input:encoder.encode(job.input),options:{abi:'editor-sdk/2',build_id:sdkBuildId,profile:job.profile,admission:'validate',access:'editable',registry_json:job.registry_json,profile_options_json:job.profile_options_json},loader:()=>loaded},renderers:r.notes?notesD0Renderers:kwdjBasicRenderers,mode:options.mode??'editable',onRefusal:value=>boundedPush(r.failures,clone(value)),onRecovery:value=>{boundedPush(r.recoveries,{originalInput:value.originalInput?Array.from(value.originalInput):null,hasRegion:value.region!==null,hasComposition:!!value.composition});showHostError(r,'runtime');}});
  r.ui=createEditorUi({editor:r.editor,editorElement:element,slots:r.slots,locale,profile:profile(r),onResult:value=>recordResult(r,value)});check(!('status'in r.ui),'Actual UI owner');
  r.ready=(async()=>{
    const ready=await r.editor.ready;if(ready.status!=='ready'){showHostError(r,'load');return {id,ready:clone(ready),roles:{}};}
    r.unsubscribe=r.editor.subscribe(event=>boundedPush(r.events,clone(event)));check(typeof r.unsubscribe==='function','Actual event subscription');
    const actual=nativeRows(r),paths=options.sourceRoles??selected.expected.rolesBefore;
    for(const [role,value]of Object.entries(paths)){const path=Array.isArray(value)?value:value.kind==='synthetic_root'?[]:value.path,node=actual.rows.find(row=>JSON.stringify(row.path)===JSON.stringify(path));check(node,'Source-authored role path');r.roles[role]=node.node.id;}
    const selection=Object.hasOwn(options,'selection')?options.selection:selected.expected.selectionBefore;
    if(selection){const result=await done(r.editor.submit({kind:'set_selection',stamp:r.editor.capture(),selection:resolve(selection,r.roles)}));check(result.response?.status==='ok','Initial authored selection only');}
    await r.ui.ready;
    if(options.focus===true){const captured=r.editor.selection.captureBookmark();check(captured.status==='captured','Initial exact bookmark');try{const focused=await done(r.editor.selection.restoreBookmark(captured.bookmark,{policy:'exact',focus:true}));check(focused.response?.status==='ok','Initial focus correspondence');}finally{r.editor.selection.releaseBookmark(captured.bookmark);check(r.editor.resources().selection.bookmarks===0,'Consumed or released initial bookmark');}}
    r.events=[];return {id,ready:{status:'ready'},roles:clone(r.roles)};
  })();
  if(options.loader==='held')return {id,ready:{status:'loading'},roles:{}};return r.ready;
}
function track(r,kind,promise){const tasks=kind==='host'?r.hostTasks:r.focusTasks;check(tasks.length<64,'Finite host/focus journals');const task=Promise.resolve(promise).catch(error=>{boundedPush(r.fixtureErrors,{kind,message:String(error.message)});});tasks.push(task);return task;}
function recordResult(r,value){
  if(value.status==='submitted'){const row={status:value.status,action:value.action,submission:value.submission.status,response:value.submission.status==='completed'?clone(value.submission.response):null};boundedPush(r.results,row);track(r,'focus',(async()=>{if(value.submission.status==='queued')row.response=clone(await value.submission.completion);row.focus=clone(await value.focus);})());return;}
  if(value.status==='cancelled'){
    const restore=value.restore,row={status:value.status,action:value.action,restore:restore?.status==='queued'?{status:'queued',response:null}:clone(restore)};boundedPush(r.results,row);
    if(restore?.status==='queued')track(r,'focus',(async()=>{row.restore.response=clone(await restore.completion);})());return;
  }
  boundedPush(r.results,clone(value));
}
export async function releaseLoader(id){const r=rec(id);check(r.releaseLoader,'One held loader');r.releaseLoader();r.releaseLoader=null;return r.ready;}
export async function inspect(id){
  const r=rec(id);await Promise.all(r.hostTasks);await Promise.all(r.focusTasks);const native=r.editor.lifecycle==='ready'?nativeRows(r):{state:null,rows:null};let canonical=null;
  if(native.state){const result=await done(r.editor.submit({kind:'snapshot',stamp:r.editor.capture(),max_bytes:65536}));check(result.response?.status==='ok'&&result.response.value.kind==='snapshot','Public snapshot');canonical=result.response.value.canonical_json;const released=await done(r.editor.submit({kind:'release_snapshot',handle:result.response.value.handle}));check(released.response?.status==='ok','Release inspection snapshot');}
  return {...native,canonical,lifecycle:r.editor.lifecycle,context:clone(r.editor.context()),roles:clone(r.roles),events:clone(r.events),results:clone(r.results),failures:clone(r.failures),fixtureErrors:clone(r.fixtureErrors),recoveries:clone(r.recoveries),trace:clone(r.trace),traceBytes:r.traceBytes,resources:clone(r.editor.resources()),uiResources:clone(r.ui.resources()),native:JSON.parse(module.resourceCounts()),activeId:document.activeElement?.id??null,insideEditor:r.element.contains(document.activeElement),hostAttributes:Object.fromEntries(['aria-labelledby','aria-label','lang','role','aria-multiline','aria-busy','aria-readonly','aria-disabled','contenteditable','tabindex'].map(k=>[k,r.element.getAttribute(k)])),source:r.source,saveReceipts:r.saves.map(({canonical,snapshot,acks,released})=>({canonical,snapshot:clone(snapshot),acks:clone(acks),released})),closedDialogs:clone(r.closedDialogs),error:{visible:!r.error.hidden,kind:r.error.dataset.failure??null},originalRecovery:clone(r.originalRecovery??null),reopenedId:r.reopenedId??null};
}
// Fixed installed-only read: no mutation, focus or arbitrary geometry request.
export function installedSelectionGeometry(id){const r=rec(id),stamp=r.editor.capture();return clone(r.editor.geometry.read({kind:'selection',stamp}));}
export function locale(id,value){
  const r=rec(id);check(['ru','en'].includes(value),'Closed locale');r.locale=value;r.label.textContent=words[value].document;r.label.lang=value;r.save.textContent=words[value].save;r.reopen.textContent=words[value].reopen;
  if(r.hostStatus.textContent)r.hostStatus.textContent=words[value].saved;
  if(r.dialog){const d=r.dialog;d.scope.lang=value;d.title.textContent=words[value].dialog;d.label.textContent=words[value].title;d.apply.textContent=words[value].apply;d.cancel.textContent=words[value].cancel;if(d.error.textContent)d.error.textContent=words[value].required;}
  if(!r.error.hidden)showHostError(r,r.error.dataset.failure);r.ui.setLocale(value);
}
export function mode(id,value){check(['editable','readOnly','disabled'].includes(value),'Closed mode');return clone(rec(id).ui.setInteractionMode(value));}
export function presentation(id,{theme='default',spacing=false}={}){check(['default','highContrast'].includes(theme)&&typeof spacing==='boolean','Closed presentation');const r=rec(id);r.wrapper.classList.toggle('a66-high-contrast',theme==='highContrast');r.wrapper.classList.toggle('a66-spacing',spacing);return {theme,spacing};}
export function controlledFatal(id){const r=rec(id);r.controlledFatal=true;const response=r.editor.read({kind:'state'});showHostError(r,'runtime');r.ui.refresh();return {qualification:'Controlled source-authored single fatal public state reply; not an external production-failure simulation',response:clone(response)};}
export async function saveSnapshot(id){
  const r=rec(id),result=await done(r.editor.submit({kind:'snapshot',stamp:r.editor.capture(),max_bytes:65536}));check(result.response?.status==='ok'&&result.response.value.kind==='snapshot','Real host snapshot');
  const snapshot=result.response.value,row={canonical:snapshot.canonical_json,snapshot:clone(snapshot),acks:[],released:false};check(r.saves.length<4,'Finite host save receipts');r.saves.push(row);r.reopen.disabled=false;
  if(r.options.saveMode!=='held'){await acknowledge(id,r.saves.length-1);await releaseSave(id,r.saves.length-1);}return {index:r.saves.length-1,canonical:row.canonical,snapshot:clone(snapshot)};
}
export async function acknowledge(id,index=0){const r=rec(id),row=r.saves[index];check(row&&!row.released&&row.acks.length<3,'Original retained snapshot acknowledgement');const result=await done(r.editor.submit({kind:'acknowledge_snapshot',stamp:r.editor.capture(),handle:row.snapshot.handle}));row.acks.push(clone(result));if(result.response?.status==='ok')r.hostStatus.textContent=words[r.locale].saved;return clone(result);}
export async function releaseSave(id,index=0){const r=rec(id),row=r.saves[index];check(row&&!row.released,'Snapshot released exactly once');const result=await done(r.editor.submit({kind:'release_snapshot',handle:row.snapshot.handle}));check(result.response?.status==='ok','Real release_snapshot');row.released=true;return clone(result);}
export async function reopenSaved(id){const r=rec(id),row=r.saves.at(-1);check(row,'Real captured host save');const options={...r.options,source:row.canonical,sourceRoles:{R:[],P:[0]},selection:null,loader:'ready',focus:false};await finishDispose(r);const fresh=await mount(options);r.reopenedId=fresh.id;return fresh;}
export async function restart(id){const r=rec(id),options={...r.options,loader:'ready'};await finishDispose(r);return mount(options);}
async function finishDispose(r){
  if(r.disposed)return clone(r.disposed);if(r.disposing)return r.disposing;r.disposing=(async()=>{
  await Promise.all(r.focusTasks);
  for(let i=0;i<r.saves.length;i++)if(!r.saves[i].released&&r.editor.lifecycle==='ready')await releaseSave(r.id,i);
  r.unsubscribe?.();await r.ui.destroy().settled;const result=r.editor.destroy();r.releaseLoader?.();r.releaseLoader=null;if(result.sdk.status==='queued')await result.sdk.completion;
  for(const remove of r.removals.splice(0))remove();const restored=Object.fromEntries(Object.keys(r.hostAttributes).map(k=>[k,r.element.getAttribute(k)]));r.wrapper.remove();
  r.disposed={id:r.id,resources:clone(r.editor.resources()),uiResources:clone(r.ui.resources()),native:JSON.parse(module.resourceCounts()),fixtureListeners:r.removals.length,fixtureErrors:clone(r.fixtureErrors),restoredHostAttributes:restored,expectedHostAttributes:clone(r.hostAttributes)};return clone(r.disposed);})();return r.disposing;
}
export async function dispose(id){const r=rec(id);await Promise.all(r.hostTasks);return finishDispose(r);}
export async function allDisposed(){const values=[];for(const id of records.keys())values.push(await dispose(id));return {mounts:values,native:JSON.parse(module.resourceCounts())};}
window.accessibilityHost={mount,inspect,installedSelectionGeometry,releaseLoader,locale,mode,presentation,controlledFatal,saveSnapshot,acknowledge,releaseSave,reopenSaved,restart,dispose,allDisposed};window.accessibilityHostReady=true;
