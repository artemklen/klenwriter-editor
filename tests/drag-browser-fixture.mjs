// SPDX-License-Identifier: MIT OR Apache-2.0
// Shared only by the lifecycle spec; importing root pointer specs would register
// their tests. Actual packages/native traces remain the authority in this lane.
import {test,expect} from '@playwright/test';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

export const oraclePath='contracts/drag/v1/mounted-oracles.json';
const oracleBytes=readFileSync(oraclePath);
export const frozen=JSON.parse(oracleBytes),records=new WeakMap();
export const call=(page,method,...args)=>page.evaluate(({method,args})=>window.ui42[method](...args),{method,args});
export const surface=(page,id)=>page.locator(`#${id}-editor`);
export const handle=(page,id)=>page.locator(`#${id} [data-editor-ui-control="drag"]`);
export const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
export const submitted=value=>value.results.filter(result=>result.status==='submitted');
export const dragSubmissions=value=>submitted(value).filter(result=>result.action==='drag-move');
export const resolve=(value,roles)=>Array.isArray(value)?value.map(item=>resolve(item,roles)):value&&typeof value==='object'
  ?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,['node','parent'].includes(key)&&typeof item==='string'?(roles[item]??item):resolve(item,roles)])):value;

export async function mount(page,item,extra={}){
  const value=await call(page,'mount',{drag:true,nativeTrace:true,source:item.input,sourceRoles:item.roles_before??item.roles,selection:item.selection,...extra});
  records.get(page).mounts.add(value.id);expect(value.ready).toBe('ready');expect(value.uiReady).toBe('ready');await frames(page);return value.id;
}
export async function inspect(page,id,label,options){
  const value=await call(page,'inspect',id,...(options?[options]:[]));records.get(page).checkpoints.push({id,label,...value});return value;
}
export async function box(page,id,paths,role){
  return page.evaluate(({id,path})=>{let node=document.getElementById(`${id}-editor`);for(const index of path)node=node.children[index];const rect=node.getBoundingClientRect();return{x:rect.x,y:rect.y,width:rect.width,height:rect.height,tag:node.tagName};},{id,path:paths[role]});
}
export async function prepareSource(page,id,item){
  expect((await call(page,'editorFocus',id)).response.status).toBe('ok');await frames(page);
  const r=await box(page,id,item.roles_before??item.roles,item.source??item.cancel_source);
  await page.mouse.move(r.x+(r.tag==='BLOCKQUOTE'?frozen.pointer.container_hover_inset_css_px:Math.min(32,r.width/2)),r.y+(r.tag==='BLOCKQUOTE'?frozen.pointer.container_hover_inset_css_px:r.height/2));
  await frames(page);return r;
}
export async function arm(page,id,item){
  await prepareSource(page,id,item);await expect(handle(page,id)).toHaveAttribute('aria-disabled','false');
  const r=await handle(page,id).boundingBox();expect(r).not.toBeNull();const point={x:r.x+r.width/2,y:r.y+r.height/2};
  await page.mouse.move(point.x,point.y);await frames(page);const start=await page.evaluate(()=>window.dragLifecycleEvents.length);
  await page.mouse.down();records.get(page).gestures.push({id,start});
  await expect.poll(async()=>(await call(page,'inspect',id)).uiResources.dragGestures).toBe(1);
  return point;
}
export async function moveTo(page,id,item){
  const r=await box(page,id,item.roles_before??item.roles,item.target??item.cancel_target);
  const fraction=item.placement==='after'?frozen.pointer.after_y_fraction:frozen.pointer.before_y_fraction;
  const point={x:r.x+Math.min(32,r.width/2),y:r.y+r.height*fraction};
  await page.mouse.move(point.x,point.y,{steps:frozen.pointer.held_move_steps});await frames(page);return point;
}
export function nativeUnchanged(after,before,{canonical=true,results=false,context=true}={}){
  if(canonical)expect(after.canonical).toBe(before.canonical);
  expect(after.state).toEqual(before.state);expect(after.rows).toEqual(before.rows);expect(after.events).toEqual(before.events);if(context)expect(after.context).toEqual(before.context);
  if(results)expect(after.results).toEqual(before.results);
}
export function idle(value){
  expect(value.uiResources.dragGestures).toBe(0);expect(value.uiResources.pointerCaptures).toBe(0);expect(value.uiResources.hostRequests).toBe(0);
  expect(value.resources.hostRequests).toEqual({pending:0,focusContinuations:0});expect(value.resources.selection.bookmarks).toBe(0);expect(value.resources.sdk.host_requests).toBe(0);
}
export function identities(value,paths,before){
  expect(value.rows).toHaveLength(Object.keys(paths).length);
  for(const[role,path]of Object.entries(paths)){const row=value.rows.find(row=>JSON.stringify(row.path)===JSON.stringify(path));expect(row,role).toBeDefined();expect(row.node.id,role).toBe(before.roles[role]);}
  expect(value.rows.map(row=>row.node.id).sort()).toEqual(before.rows.map(row=>row.node.id).sort());
  for(const row of value.rows)expect(row.node.stamp).toEqual(value.state.stamp);
}
export function moved(value,before,item,{action='drag-move'}={}){
  expect(value.canonical).toBe(item.after);identities(value,item.roles_after,before);expect(value.state.selection).toEqual(before.state.selection);expect(value.state.stored_marks).toEqual(before.state.stored_marks);
  expect(value.state.stamp.session).toBe(before.state.stamp.session);expect(value.state.stamp.generation).toBe(before.state.stamp.generation);
  for(const[key,delta]of [['revision',1n],['selection_epoch',0n],['history_epoch',1n]])expect(BigInt(value.state.stamp[key])-BigInt(before.state.stamp[key])).toBe(delta);
  expect(value.state.history.undo_entries).toBe('1');expect(value.state.history.redo_entries).toBe('0');expect(value.state.dirty).toBe(true);expect(value.state.saved_revision).toBe(before.state.saved_revision);
  expect(value.events.filter(event=>event.change.kind==='document').length-before.events.filter(event=>event.change.kind==='document').length).toBe(1);
  expect(value.events.filter(event=>event.change.kind==='state')).toEqual(before.events.filter(event=>event.change.kind==='state'));
  const results=submitted(value).slice(submitted(before).length);expect(results).toHaveLength(1);expect(results[0].action).toBe(action);expect(results[0].response.status).toBe('ok');expect(results[0].response.value.effect).toBe('changed');idle(value);
}
export async function semanticCalls(page,id){
  const trace=await call(page,'nativeTrace',id);expect(trace.enabled).toBe(true);expect(trace.overflow).toBe(false);
  return trace.calls.map(row=>({request:JSON.parse(row.requestJson),response:JSON.parse(row.responseJson)})).filter(row=>['command','history','set_selection','remount'].includes(row.request.kind));
}
export async function browserState(page,id){
  const value=await page.evaluate(id=>{
    const r=window.dragLifecycleObjects??=(new WeakMap()),state=window.dragLifecycleObjectSerial??={value:0};
    const token=node=>{if(!node)return null;if(!r.has(node))r.set(node,++state.value);return r.get(node);};
    const wrapper=document.getElementById(id),editor=document.getElementById(`${id}-editor`),handle=wrapper.querySelector('[data-editor-ui-control=drag]'),selection=document.getSelection();
    return{editor:token(editor),handle:token(handle),editorHtml:editor.outerHTML,children:[...editor.childNodes].map(token),active:token(document.activeElement),activeId:document.activeElement?.id??null,
      range:selection?{count:selection.rangeCount,anchor:token(selection.anchorNode),anchorOffset:selection.anchorOffset,focus:token(selection.focusNode),focusOffset:selection.focusOffset}:null,scroll:{x:scrollX,y:scrollY},captured:window.dragLifecycleEvents.filter(event=>event.id===id&&event.name==='gotpointercapture').map(event=>event.pointerId)};
  },id);records.get(page).browser.push({id,value});return value;
}
export async function dispose(page,id,label='explicit disposal'){
  const result=await call(page,'destroy',id);records.get(page).mounts.delete(id);records.get(page).cleanup.push({id,label,...result});assertReleased(result);return result;
}
export function assertReleased(result){
  expect(result.ui).toEqual({listeners:0,observers:0,animationFrames:0,subscriptions:0,hostRequests:0,continuations:0,dragGestures:0,pointerCaptures:0});
  expect(result.mounted.dom).toEqual({listeners:0,observers:0,continuations:0,retainedInputBytes:0,retainedRecoveryRegions:0});
  expect(result.mounted.selection).toEqual({bookmarks:0,restoreTickets:0,activePointers:0,animationFrames:0});
  expect(result.mounted.clipboard).toEqual({pending:0,continuations:0,retainedTextBytes:0});expect(result.mounted.hostRequests).toEqual({pending:0,focusContinuations:0});
  expect(result.mounted.inputObservations).toEqual({subscribers:0});expect(result.mounted.popupPresentation).toEqual({handles:0});
  expect(result.mounted.sdk.lifecycle).toBe('destroyed');
  for(const[key,value]of Object.entries(result.mounted.sdk))if(key!=='lifecycle'){expect(typeof value,`sdk/${key}`).toBe('number');expect(value,`sdk/${key}`).toBe(0);}
  if(result.nativeTrace)expect(result.nativeTrace.overflow).toBe(false);
}
export function install(){
  test.beforeEach(async({page,browser},info)=>{
    records.set(page,{engine:info.project.name,browserVersion:browser.version(),installedBrowser:false,oracle:{path:oraclePath,bytes:oracleBytes.length,sha256:createHash('sha256').update(oracleBytes).digest('hex')},mounts:new Set(),checkpoints:[],browser:[],gestures:[],cleanup:[],controlled:[],errors:[],external:[]});
    page.on('pageerror',error=>records.get(page).errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:4174/'))records.get(page).external.push(request.url());});
    await page.setViewportSize({width:1600,height:1400});
    await page.addInitScript(()=>{
      window.dragLifecyclePolicy=[];window.dragLifecycleEvents=[];window.dragLifecycleOverflow=false;
      document.addEventListener('securitypolicyviolation',event=>window.dragLifecyclePolicy.push({directive:event.effectiveDirective,blocked:event.blockedURI}));
      // Install on window before the owner. Its terminal capture handler may
      // stop propagation before document/root observers, without losing the up.
      for(const name of ['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture','mouseup','click','keydown','compositionstart','compositionend','selectionchange','dragstart','dragover','drop'])window.addEventListener(name,event=>{
        if(window.dragLifecycleEvents.length===1024){window.dragLifecycleOverflow=true;return;}
        if(name==='selectionchange'){
          const selection=document.getSelection(),objects=window.dragLifecycleObjects??=(new WeakMap()),serial=window.dragLifecycleObjectSerial??={value:0};
          const token=node=>{if(!node)return null;if(!objects.has(node))objects.set(node,++serial.value);return objects.get(node);};
          // Only this page's currently mounted fixture roots are sampled. The
          // directed range is scalar observation, never imported or repaired.
          for(const editor of document.querySelectorAll('.ui-fixture-editor')){
            if(window.dragLifecycleEvents.length===1024){window.dragLifecycleOverflow=true;return;}
            const wrapper=editor.closest('.ui-fixture');if(!wrapper||!editor.isConnected)continue;
            const anchor=selection?.anchorNode,focus=selection?.focusNode;
            window.dragLifecycleEvents.push({name,id:wrapper.id,at:performance.now(),isTrusted:event.isTrusted,
              range:{count:selection?.rangeCount??0,anchor:token(anchor),anchorName:anchor?.nodeName??null,anchorOffset:selection?.anchorOffset??0,anchorInEditor:!!anchor&&editor.contains(anchor),focus:token(focus),focusName:focus?.nodeName??null,focusOffset:selection?.focusOffset??0,focusInEditor:!!focus&&editor.contains(focus)}});
          }
          return;
        }
        const element=event.target instanceof Element?event.target:null,wrapper=element?.closest('.ui-fixture');
        const pointer=['pointerdown','pointermove','pointerup','mouseup','click'].includes(name)&&Number.isFinite(event.clientX)&&Number.isFinite(event.clientY);
        // Observation only: captured target and actual under-pointer object can
        // differ. This bounded hit fact never supplies a destination/authority.
        const hit=pointer?document.elementFromPoint(event.clientX,event.clientY):null,editor=wrapper?.querySelector('.ui-fixture-editor'),gutter=wrapper?.querySelector('.kw-ui-gutter');
        const row={name,id:wrapper?.id??null,at:performance.now(),isTrusted:event.isTrusted,pointerId:event.pointerId??null,pointerType:event.pointerType??null,isPrimary:event.isPrimary??null,detail:event.detail??null,button:event.button??null,buttons:event.buttons??null,key:event.key??null,targetTag:element?.tagName??null,targetControl:element?.dataset.editorUiControl??null,
          defaultPreventedAtCapture:event.defaultPrevented,dispatchEnd:null,point:pointer?{x:event.clientX,y:event.clientY}:null,hit:pointer?{tag:hit?.tagName??null,control:hit?.dataset.editorUiControl??null,mount:hit?.closest('.ui-fixture')?.id??null,inEditor:!!hit&&!!editor&&editor.contains(hit),inOwnGutter:!!hit&&!!gutter&&gutter.contains(hit),isEditorRoot:hit===editor}:null};
        window.dragLifecycleEvents.push(row);
        if(['pointerup','mouseup','click'].includes(name))setTimeout(()=>{
          // A separate task, rather than a microtask between native listeners,
          // records whether the full dispatch has actually ended (phase0).
          row.dispatchEnd={at:performance.now(),eventPhase:event.eventPhase,afterDispatch:event.eventPhase===0,defaultPrevented:event.defaultPrevented};
        },0);
      },true);
    });
    const response=await page.goto('/ui'),csp=response.headers()['content-security-policy'];records.get(page).csp=csp;expect(csp).toContain("default-src 'none'");expect(csp).not.toContain("'unsafe-inline'");expect(csp).not.toContain("'unsafe-eval'");
    await page.waitForFunction(()=>!!window.ui42);records.get(page).moduleManifest=await page.evaluate(()=>window.ui42.moduleManifest);
  });
  test.afterEach(async({page},info)=>{
    const record=records.get(page);if(!record)return;
    try{
      for(const id of [...record.mounts])await dispose(page,id,'afterEach original fixture cleanup');
      if(record.cleanup.length)expect(record.cleanup.at(-1).native).toEqual({sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});
      const actual=await page.evaluate(()=>({events:window.dragLifecycleEvents,overflow:window.dragLifecycleOverflow,policy:window.dragLifecyclePolicy}));Object.assign(record,actual);
      expect(actual.overflow).toBe(false);expect(actual.policy).toEqual([]);expect(record.errors).toEqual([]);expect(record.external).toEqual([]);
      if(info.status==='passed')for(let i=0;i<record.gestures.length;i++){
        const gesture=record.gestures[i],events=actual.events.slice(gesture.start,gesture.end??record.gestures[i+1]?.start??actual.events.length);
        const down=events.filter(event=>event.name==='pointerdown'&&event.id===gesture.id&&event.targetControl==='drag');expect(down).toHaveLength(1);expect(down[0].isTrusted).toBe(true);expect(down[0].pointerType).toBe('mouse');
        const up=events.filter(event=>event.name==='pointerup'&&event.pointerId===down[0].pointerId);expect(up).toHaveLength(1);expect(up[0].isTrusted).toBe(true);
        gesture.pointerId=down[0].pointerId;gesture.down=down[0];gesture.up=up[0];
      }
    }finally{
      record.remainingMounts=[...record.mounts];delete record.mounts;record.status=info.status;record.scope='Actual packaged mounted UI/DOM/SDK/WASM; original protocol input. Explicit dispatched composition/transfer/DOM-fault cases are controlled, not physical or installed input.';
      mkdirSync('artifacts/drag/lifecycle',{recursive:true});const path=`artifacts/drag/lifecycle/${info.project.name}-${info.testId.replaceAll(/[^A-Za-z0-9_-]/g,'_')}.json`;writeFileSync(path,JSON.stringify(record,null,2)+'\n');await info.attach('drag-lifecycle-observations',{path,contentType:'application/json'});
    }
  });
}
