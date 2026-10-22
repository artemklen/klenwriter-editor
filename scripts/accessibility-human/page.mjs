// SPDX-License-Identifier: MIT OR Apache-2.0
// A human supplies every semantic action. This observer has no input helper,
// command/select/focus replay, browser protocol, screen or recording API.
import {sdkBuildId} from '@klenwriter/editor-sdk';
import '/accessibility-host.js';
const PLAN_SHA256='7f10a395d854caf33a3b8bfa017a970517d90a978b4a55706be983c5d5754c6e';
const $=id=>document.getElementById(id),encoder=new TextEncoder();
const check=(ok,why)=>{if(!ok)throw Error(why);};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
const copy=value=>structuredClone(value);
const controls={start:$('a66-human-start'),stop:$('a66-human-stop'),status:$('a66-human-status'),clock:$('a66-human-clock'),form:$('a66-human-observations'),note:$('a66-human-note'),final:$('a66-human-final')};
const query=new URL(location.href).searchParams,nonce=query.get('nonce');
check(query.size===1&&/^[a-f0-9]{64}$/.test(nonce??''),'Exact manual launch nonce');
const planBytes=new Uint8Array(await (await fetch('/accessibility-human/plan.json',{cache:'no-store'})).arrayBuffer());
check(await sha(planBytes)===PLAN_SHA256,'Frozen source-first plan bytes');const plan=JSON.parse(new TextDecoder().decode(planBytes)),limits=plan.limits;
const configResponse=await fetch(`/accessibility-human/config?nonce=${nonce}`,{cache:'no-store'});check(configResponse.ok,'Explicit fresh manual sink configuration required');const config=await configResponse.json();
check(config.nonce===nonce&&config.expectedBuildId===sdkBuildId&&config.expectedPlanSha256===PLAN_SHA256,'Actual sealed build/plan matches root launch');
const browserUserAgent=navigator.userAgent;check(browserUserAgent.includes('Safari/')&&!/Chrome|Chromium|CriOS|Edg\//.test(browserUserAgent),'This finite human lane is Safari, not another browser');
for(const key of ['chunkCount','chunkBytes','totalBytes'])check(config.caps[key]===limits[key],'Exact page/sink caps');
const host=window.accessibilityHost;check(host&&window.accessibilityHostReady===true,'Existing real public host facade');
const state={phase:'idle',openedAt:new Date().toISOString(),startedAt:null,exerciseStartedAt:null,deadline:Date.now()+limits.idleMs,mountId:null,freshId:null,semantic:0,machineComplete:false,freshFocused:false,roles:{},freshRoles:{},inspects:0,eventCount:0,eventBytes:0,wireCount:0,wireBytes:0,ordinal:0,totalBytes:0,wire:new Map(),accountStamp:null,stateEvents:0,setup:null,last:null,closed:false,issues:[],source:{planSha256:PLAN_SHA256,buildId:sdkBuildId,browserUserAgent,rootPins:config.sourcePins}};
const removals=[],pendingCodes=new Set();let pendingEvents=[],pendingWrites=Promise.resolve(),inspection=Promise.resolve(),startup=null,finalization=null,timer=null,frame=null,inspectionRequested=false;
function listen(target,type,fn,options){target.addEventListener(type,fn,options);removals.push(()=>target.removeEventListener(type,fn,options));}
function announce(text){controls.status.textContent=text;}
function instructions(){
  for(const item of plan.instructions){const li=document.createElement('li'),heading=document.createElement('strong'),body=document.createElement('p');li.id=`a66-human-step-${item.id}`;heading.textContent=item.title;body.textContent=item.instructions;li.append(heading,body);$('a66-human-instructions').append(li);}
  for(const item of plan.humanChecks){const label=document.createElement('label'),select=document.createElement('select');label.htmlFor=`a66-human-check-${item.id}`;label.textContent=item.label;select.id=label.htmlFor;select.required=true;for(const [value,text]of [['','Выбери ответ'],['yes','Да, наблюдал'],['no','Нет / возникла проблема']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}label.append(select);$('a66-human-checks').append(label);}
}
function progress(id){for(const item of plan.instructions){const li=$(`a66-human-step-${item.id}`);if(item.id===id)li.dataset.observed='true';li.dataset.current=String(item.id===plan.instructions.find(x=>$(`a66-human-step-${x.id}`).dataset.observed!=='true')?.id);}}
function post(kind,payload){
  // Serial exact ordinals; no resend, retry or overwrite after uncertain receipt.
  const task=pendingWrites.then(async()=>{check(state.ordinal<limits.chunkCount,'Immutable chunk count cap');const envelope={schema:'kwe-a66-human-chunk/1',nonce,ordinal:state.ordinal,kind,payload},bytes=encoder.encode(JSON.stringify(envelope));check(bytes.byteLength<=limits.chunkBytes&&state.totalBytes+bytes.byteLength<=limits.totalBytes,'Immutable receipt byte cap');const response=await fetch('/accessibility-human/receipt',{method:'POST',headers:{'Content-Type':'application/json','X-A66-Human-Nonce':nonce},body:bytes});check(response.status===201,'Original receipt must be acknowledged once');const receipt=await response.json();check(receipt.status==='recorded'&&receipt.ordinal===state.ordinal&&receipt.bytes===bytes.byteLength&&receipt.sha256===await sha(bytes),'Original immutable sink receipt');state.ordinal++;state.totalBytes+=bytes.byteLength;return receipt;});
  pendingWrites=task;return task;
}
function observation(payload){return post('observation',payload);}
function fail(error){if(state.phase==='closed')return;state.issues.push({at:new Date().toISOString(),name:error.name??'Error',message:String(error.message??error)});if(!state.closed)void finish('FAILED',null);}
function nodePath(node){
  if(!node)return null;if(node===document)return {kind:'document'};const element=node.nodeType===Node.ELEMENT_NODE?node:node.parentElement;let root=element?.closest('.a66-mount')??null;
  if(root){const path=[];let cursor=node;while(cursor!==root){const parent=cursor.parentNode;check(parent,'Connected owned path');path.unshift([...parent.childNodes].indexOf(cursor));cursor=parent;check(path.length<=16,'Owned DOM path depth');}return {kind:'mounted',mountId:root.id,path,text:node.nodeType===Node.TEXT_NODE?node.data:null};}
  return {kind:'host',id:element?.id??null,tag:element?.tagName??null};
}
function browserSelection(){const selection=getSelection();return selection?{anchor:nodePath(selection.anchorNode),anchorOffset:selection.anchorOffset,focus:nodePath(selection.focusNode),focusOffset:selection.focusOffset,isCollapsed:selection.isCollapsed}:null;}
function eventRow(event){
  const row={type:event.type,at:performance.now(),isTrusted:event.isTrusted,target:nodePath(event.target),activeId:document.activeElement?.id??null};
  if(event instanceof KeyboardEvent)Object.assign(row,{key:event.key,code:event.code,repeat:event.repeat,alt:event.altKey,meta:event.metaKey,ctrl:event.ctrlKey,shift:event.shiftKey,isComposing:event.isComposing});
  if(event instanceof InputEvent){Object.assign(row,{inputType:event.inputType,data:event.data,isComposing:event.isComposing,targetRanges:[]});const ranges=event.getTargetRanges();check(ranges.length<=4,'Finite original target ranges');row.targetRanges=[...ranges].map(range=>({start:nodePath(range.startContainer),startOffset:range.startOffset,end:nodePath(range.endContainer),endOffset:range.endOffset}));}
  if(event.type==='selectionchange')row.selection=browserSelection();return row;
}
function recordEvent(event){
  if(!['exercise','human'].includes(state.phase))return;
  try{const row=eventRow(event),bytes=encoder.encode(JSON.stringify(row)).length;check(++state.eventCount<=limits.events&&state.eventBytes+bytes<=limits.eventUtf8Bytes,'Bounded original event journal');state.eventBytes+=bytes;pendingEvents.push(row);
    if(['keydown','keyup','beforeinput','input'].includes(event.type))check(event.isTrusted,'Actual human input cannot be synthetic');
    if(event.type==='pointerdown'&&state.phase==='exercise'&&event.target instanceof Element&&event.target.closest('.a66-mount'))throw Error('Pointer action inside keyboard-only exercise; original partial result retained');
    if(event.type==='focusin'&&state.freshId&&event.target?.id===`${state.freshId}-editor`)state.freshFocused=true;
    if(state.phase==='exercise'&&event.type==='keydown'&&(event.code==='KeyX'||event.key==='Enter'||event.key==='Backspace'||event.code==='KeyZ'&&(event.metaKey||event.ctrlKey)||event.key==='ArrowUp'&&event.altKey))pendingCodes.add(event.code);
    if(state.phase==='exercise'&&event.type==='keyup'&&pendingCodes.delete(event.code))requestInspection();
  }catch(error){fail(error);}
}
function point(roles,value){return value===null?null:Object.fromEntries(Object.entries(value).map(([key,v])=>[key,['node','parent'].includes(key)?roles[v]:v]));}
function selection(roles,value){return value===null?null:{anchor:point(roles,value.anchor),focus:point(roles,value.focus)};}
function assertMaterial(value,item,roles,{selectionRequired=true}={}){
  check(value.lifecycle==='ready'&&value.state!==null&&value.canonical===plan.canonicalLiterals[item.canonical].json,'Exact authored canonical and ready native state');check(value.fixtureErrors.length===0&&value.failures.length===0&&value.recoveries.length===0,'No hidden failure/recovery');
  for(const [role,path]of Object.entries(item.roles)){const node=value.rows.find(row=>same(row.path,path))?.node;check(node,`Authored native role ${role}`);if(Object.hasOwn(roles,role))check(roles[role]===node.id,`Original role identity ${role}`);else{check(!Object.values(roles).includes(node.id),`Fresh unique native role ${role}`);roles[role]=node.id;}}
  check(same(value.rows.map(row=>row.node.id).sort(),Object.keys(item.roles).map(role=>roles[role]).sort()),'Exact live role/ID bijection');
  for(const [role,marks]of Object.entries(item.textMarks))check(same(value.rows.find(row=>row.node.id===roles[role]).node.marks,marks),`Source-authored marks ${role}`);
  if(selectionRequired)check(same(value.state.selection,selection(roles,item.selection)),'Exact directed native selection');check(same(value.state.stored_marks,item.stored_marks),'Exact native stored marks');
  check(value.state.stamp.revision===item.revision&&value.state.stamp.history_epoch===item.history_epoch&&value.state.history.undo_entries===item.undo_entries&&value.state.history.redo_entries===item.redo_entries,'Exact source-authored revision/history');
}
function account(row){
  const request=JSON.parse(row.requestJson),response=row.responseJson===null?null:JSON.parse(row.responseJson);if(!['command','input_command','history','set_selection','set_stored_marks','barrier','acknowledge_snapshot'].includes(request.kind))return;
  check(row.outcome==='returned'&&response?.status==='ok'&&response.value.kind==='mutation','Original completed native mutation reply');check(same(request.stamp,state.accountStamp),'Original command-before fullstamp chain');const next=response.value.state.stamp;
  if(['command','history','input_command'].includes(request.kind)){
    const item=plan.nativeSteps[++state.semantic];check(item&&state.semantic<=6,'Exactly six authored semantic operations, no replay');if(state.semantic===6)check(request.kind==='history'&&request.direction==='undo','Actual native keyboard Undo, not host replay');
    for(const key of ['revision','selection_epoch','history_epoch'])check(BigInt(next[key])-BigInt(state.accountStamp[key])===BigInt(item.semanticDelta[key]),`Authored semantic ${key} delta`);
  }else{
    check(['set_selection','barrier','acknowledge_snapshot'].includes(request.kind),'No hidden mark/native mutation');check(next.revision===state.accountStamp.revision&&next.history_epoch===state.accountStamp.history_epoch,'Navigation/save never adds document/history unit');
    const expectedS=request.kind==='set_selection'&&response.value.effect!=='unchanged'?1n:0n;check(BigInt(next.selection_epoch)-BigInt(state.accountStamp.selection_epoch)===expectedS,'Explicit source-bound selection epoch accounting');if(response.value.effect==='state_changed')state.stateEvents++;
  }
  state.accountStamp=copy(next);
}
function originalWire(value,mountId){
  const previous=state.wire.get(mountId)??[],rows=value.trace;check(rows.length>=previous.length,'Original wire cannot shrink');for(let i=0;i<previous.length;i++)check(same(rows[i],previous[i]),'Original wire prefix cannot change');const added=rows.slice(previous.length);
  for(const row of added){state.wireCount++;state.wireBytes+=encoder.encode(row.requestJson).length+(row.responseJson===null?0:encoder.encode(row.responseJson).length);check(state.wireCount<=limits.wireRecords&&state.wireBytes<=limits.wireUtf8Bytes,'Original wire count/UTF8 caps');}
  state.wire.set(mountId,copy(rows));
  return added;
}
function withoutWire(value){const {trace,...rest}=value;return rest;}
async function flushEvents(){if(!pendingEvents.length)return;const events=pendingEvents;pendingEvents=[];await observation({kind:'human-browser-events',events});}
async function inspect(id,label,{initial=false,fresh=false}={}){
  check(++state.inspects<=limits.inspectCount,'Finite readonly inspection cap');const value=await host.inspect(id),wire=originalWire(value,id),events=pendingEvents;pendingEvents=[];
  // One bounded chunk per normal inspection. Original evidence reaches durable
  // storage before canonical/counter validation, including a failing outcome.
  await observation({kind:'native-checkpoint',label,mountId:id,events,wire,value:withoutWire(value)});
  if(!initial&&!fresh)for(const row of wire)account(row);return value;
}
function documentEvents(value){return value.events.filter(event=>event.change.kind==='document');}
function stateEvents(value){return value.events.filter(event=>event.change.kind==='state');}
async function takeInspection(){
  if(state.phase!=='exercise')return;const priorSemantic=state.last.semantic,value=await inspect(state.mountId,'after actual human potential semantic key');
  if(state.closed)return;
  if(value.reopenedId){
    check(state.last.saved===true&&value.reopenedId!==state.mountId,'Reopen only after matching explicit receipt');state.freshId=value.reopenedId;
    const fresh=await inspect(state.freshId,'fresh saved copy BEFORE any automatic focus or selection',{fresh:true}),expected=plan.save.reopen;if(state.closed)return;
    assertMaterial(fresh,{...plan.nativeSteps[4],revision:'0',history_epoch:'0',undo_entries:'0',redo_entries:'0',selection:null},state.freshRoles);check(fresh.state.stamp.selection_epoch==='0'&&fresh.state.stamp.session!==state.setup.state.stamp.session&&fresh.state.saved_revision==='0'&&!fresh.state.dirty,'Actual fresh Session baseline');check(fresh.events.length===0&&fresh.resources.selection.bookmarks===0,'No historical event/bookmark transfer');
    check(same(Object.keys(expected.roles).sort(),Object.keys(state.freshRoles).sort()),'Fresh Session-local authored role set');state.machineComplete=true;state.phase='human';progress('REOPEN');controls.form.hidden=false;announce('Новая копия открыта, машинные шаги сохранены. Tab войди в новый «Документ», проверь видимый фокус, затем заполни наблюдения ниже. Автоматического ввода не было.');return;
  }
  check(state.semantic>=priorSemantic&&state.semantic<=priorSemantic+1,'One authored semantic checkpoint at a time; no missed/replayed edit');const item=plan.nativeSteps[state.semantic];assertMaterial(value,item,state.roles,{selectionRequired:state.semantic!==priorSemantic});check(same(value.state.stamp,state.accountStamp),'Actual checkpoint fullstamp equals original wire');check(documentEvents(value).length===state.semantic&&stateEvents(value).length===state.stateEvents,'Exact native publication accounting');
  if(state.semantic>priorSemantic){progress(item.id);announce(`Шаг ${state.semantic}/6 подтверждён по исходному контракту. Следуй следующей инструкции; времени достаточно.`);}
  let saved=state.last.saved===true;
  if(value.saveReceipts.length){
    check(state.semantic===6&&value.saveReceipts.length===1,'Exactly one explicit host Save after Undo');const receipt=value.saveReceipts[0],before=state.last.value;
    check(receipt.canonical===plan.canonicalLiterals.C4.json&&receipt.snapshot.stamp.revision==='6'&&receipt.acks.length===1&&receipt.acks[0].response?.status==='ok'&&receipt.released===true,'Original public matching snapshot/ack/release receipt');
    check(value.state.saved_revision==='6'&&!value.state.dirty&&same(value.state.selection,selection(state.roles,plan.save.ack.selection))&&Object.entries(plan.save.ack.history).every(([key,expected])=>value.state.history[key]===expected)&&same(value.state.history,before.state.history),'Matching saved baseline and exact selection/history');
    if(!saved){check(same(value.state.stamp,before.state.stamp)&&documentEvents(value).length===documentEvents(before).length&&stateEvents(value).length-stateEvents(before).length===1&&stateEvents(value).at(-1).change.baseline_changed===true,'Acknowledgement is one baseline state event, zero document/stamp change');saved=true;progress('SAVE');announce('Сохранённая копия подтверждена. Теперь Tab до «Открыть сохранённую копию», Enter; дождись проверки новой копии.');}
    check(value.trace.filter(row=>{const q=JSON.parse(row.requestJson);return q.kind==='release_snapshot'&&q.handle===receipt.snapshot.handle;}).length===1,'Original host snapshot released exactly once');
  }
  state.last={semantic:state.semantic,saved,value:withoutWire(value)};
}
function requestInspection(){
  if(inspectionRequested||state.phase!=='exercise')return;inspectionRequested=true;
  frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(()=>{frame=null;inspectionRequested=false;inspection=inspection.then(()=>takeInspection());void inspection.catch(fail);});});
}
function zeroCleanup(value){
  check(same(value.native,{sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0}),'Final native zero');
  for(const row of value.mounts){check(Object.values(row.uiResources).every(n=>n===0)&&row.fixtureListeners===0&&row.fixtureErrors.length===0,'Actual UI/fixture zero');check(same(row.restoredHostAttributes,row.expectedHostAttributes),'Host attrs restored');const r=row.resources;
    check(r.dom.listeners===0&&r.dom.observers===0&&r.dom.continuations===0&&r.dom.retainedInputBytes===0&&r.dom.retainedRecoveryRegions===0,'Actual DOM zero');for(const key of ['selection','clipboard','hostRequests','inputObservations','popupPresentation'])check(Object.values(r[key]).every(n=>n===0),'Actual mounted resource zero');for(const key of ['sessions','listeners','queued_mutations','queued_bytes','pending_tickets','host_requests','task_continuations'])check(r.sdk[key]===0,'Actual SDK zero');
  }
}
async function finish(status,human){
  if(finalization)return finalization;state.closed=true;state.phase='closing';controls.start.disabled=true;controls.stop.disabled=true;controls.form.hidden=true;if(timer!==null)clearInterval(timer);if(frame!==null)cancelAnimationFrame(frame);frame=null;for(const remove of removals.splice(0))remove();
  finalization=(async()=>{let cleanup=null,cleanupError=null,receiptError=null;
    try{if(startup)await startup.catch(()=>{});await inspection.catch(()=>{});await flushEvents();}catch(error){receiptError={message:String(error.message)};status='FAILED';}
    try{cleanup=await host.allDisposed();zeroCleanup(cleanup);}catch(error){cleanupError={message:String(error.message)};status='FAILED';}
    if(status==='OBSERVED_PASS'&&state.issues.length)status='FAILED';
    const payload={schema:'kwe-a66-human-final/1',status,performer:'owner',method:plan.method,openedAt:state.openedAt,startedAt:state.startedAt,exerciseStartedAt:state.exerciseStartedAt,finishedAt:new Date().toISOString(),source:state.source,machine:{complete:state.machineComplete,semanticOperations:state.semantic,freshFocusObserved:state.freshFocused,inspections:state.inspects,eventCount:state.eventCount,eventUtf8Bytes:state.eventBytes,wireCount:state.wireCount,wireUtf8Bytes:state.wireBytes},human,issues:state.issues,cleanup,cleanupError,receiptError,qualification:plan.qualification};
    try{await post('final',payload);controls.final.textContent=`${status}: оригинальные наблюдения и cleanup сохранены.\nЭто одна ручная RU Safari проверка; она не является полным WCAG/AT verdict.`;}catch(error){controls.final.textContent=`FAILED / сохранение финального receipt не подтверждено: ${error.message}. Исходные уже записанные chunks не переписаны. Cleanup: ${cleanupError?'НЕ ПОДТВЕРЖДЁН':'завершён'}.`;}
    controls.final.hidden=false;announce('Проверка завершена. Ввод и фокус автоматически не воспроизводились.');state.phase='closed';
  })();return finalization;
}
async function start(event){
  if(state.phase!=='idle')return;check(event.isTrusted,'Start is a human action');state.phase='starting';controls.start.disabled=true;state.startedAt=new Date().toISOString();
  try{
    await observation({kind:'actual-human-start',performer:'owner',isTrusted:event.isTrusted,at:state.startedAt});if(state.closed)return;
    const mounted=await host.mount(copy(plan.setup));if(state.closed)return;check(mounted.ready.status==='ready','Actual manually started host ready');state.mountId=mounted.id;const setup=await inspect(state.mountId,'Start only: authored initial selection and exact public focus',{initial:true});if(state.closed)return;assertMaterial(setup,plan.nativeSteps[0],state.roles);check(setup.insideEditor&&setup.state.stamp.selection_epoch==='1'&&!setup.state.dirty&&setup.state.saved_revision==='0','Exact initial caret/focus/baseline');
    state.setup=withoutWire(setup);state.accountStamp=copy(setup.state.stamp);state.last={semantic:0,saved:false,value:withoutWire(setup)};state.phase='exercise';state.exerciseStartedAt=new Date().toISOString();state.deadline=Date.now()+limits.exerciseMs;controls.stop.disabled=false;announce('Начали: 5 минут. Введи x, затем следуй шагам справа. После изменений дождись отметки; между шагами нажимать подтверждения не нужно.');progress(null);
  }catch(error){fail(error);}
}
instructions();
for(const type of ['keydown','keyup','beforeinput','input','focusin','focusout','selectionchange','pointerdown'])listen(document,type,recordEvent,true);
listen(window,'pagehide',()=>{if(!state.closed)fail(Error('Own manual page left before completed receipt; original partial evidence retained'));});
listen(controls.start,'click',event=>{startup=start(event);void startup.catch(fail);});
listen(controls.stop,'click',event=>{if(event.isTrusted){state.issues.push({message:'Owner explicitly stopped; no automatic retry or reset.'});void finish('INCOMPLETE',null);}});
listen(controls.form,'submit',event=>{
  event.preventDefault();if(!event.isTrusted||state.phase!=='human')return;
  try{const checks=Object.fromEntries(plan.humanChecks.map(item=>[item.id,$(`a66-human-check-${item.id}`).value]));check(Object.values(checks).every(v=>['yes','no'].includes(v)),'Explicit actual human observations');const text=controls.note.value.trim();check(text.length>0&&[...text].length<=limits.humanTextScalars,'Bounded actual human written observation');check(state.machineComplete&&state.freshFocused,'Actual fresh editor focus observed, not automated');void finish(Object.values(checks).every(v=>v==='yes')?'OBSERVED_PASS':'FAILED',{performer:'owner',checks,text,isTrustedSubmit:event.isTrusted,qualification:'Human written observations distinct from machine original events and canonical assertions.'});}catch(error){fail(error);}
});
await post('intent',{schema:'kwe-a66-human-intent/1',status:'WAITING_FOR_HUMAN',performer:'owner',source:state.source,limits,qualification:plan.qualification});
if(!state.closed){
  timer=setInterval(()=>{const left=Math.max(0,state.deadline-Date.now());controls.clock.textContent=`${['idle','starting'].includes(state.phase)?'Ожидание начала/готовности':'Осталось на упражнение'}: ${Math.ceil(left/60000)} мин. ${Math.ceil(left/1000)%60} с.`;if(left===0&&!state.closed){state.issues.push({message:['idle','starting'].includes(state.phase)?'20-minute idle/setup deadline reached':'5-minute exercise deadline reached'});void finish('INCOMPLETE',null);}},1000);
  controls.start.disabled=false;controls.stop.disabled=false;announce('Готово. Прочитай последовательность, затем нажми «Начать». Таймер упражнения начинается после готовности редактора.');
}
