// SPDX-License-Identifier: MIT OR Apache-2.0
// Actual packaged UI/DOM/SDK/WASM and browser pointer; installed OS input is separate.
import {test,expect} from '@playwright/test';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const oraclePath='contracts/drag/v1/mounted-oracles.json';
const oracleBytes=readFileSync(oraclePath),frozen=JSON.parse(oracleBytes),records=new WeakMap();
test.use({trace:{mode:'retain-on-failure',screenshots:false,snapshots:true,sources:true}});
const call=(page,method,...args)=>page.evaluate(({method,args})=>window.ui42[method](...args),{method,args});
const handle=(page,id)=>page.locator(`#${id} [data-editor-ui-control="drag"]`);
const submissions=value=>value.results.filter(r=>r.status==='submitted'&&r.action==='drag-move');
const docEvents=value=>value.events.filter(e=>e.change.kind==='document');
const roleIds=value=>value.rows.map(row=>row.node.id).sort();
const resolve=(value,roles)=>Array.isArray(value)?value.map(v=>resolve(v,roles)):value&&typeof value==='object'
  ?Object.fromEntries(Object.entries(value).map(([key,v])=>[key,['node','parent'].includes(key)&&typeof v==='string'?(roles[v]??v):resolve(v,roles)])):value;
const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));

async function mount(page,item,extra={}){
  const value=await call(page,'mount',{drag:true,nativeTrace:true,source:item.input,sourceRoles:item.roles_before??item.roles,selection:item.selection,...extra});
  records.get(page).mounts.add(value.id);expect(value.ready).toBe('ready');expect(value.uiReady).toBe('ready');
  await page.evaluate(id=>{
    const root=document.getElementById(id),r={events:[],removals:[],overflow:false};window.dragPointers??=new Map();window.dragPointers.set(id,r);
    for(const name of ['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture','click']){
      // The terminal owner consumes propagation at Window capture. Observe
      // that same phase, retaining only events targeting this genuine root.
      const listener=e=>{if(!root.contains(e.target))return;if(r.events.length===512){r.overflow=true;return;}r.events.push({name,at:performance.now(),isTrusted:e.isTrusted,pointerId:e.pointerId??null,pointerType:e.pointerType??null,button:e.button,buttons:e.buttons,x:e.clientX,y:e.clientY,targetTag:e.target.tagName,targetControl:e.target.dataset?.editorUiControl??null});};
      window.addEventListener(name,listener,true);r.removals.push(()=>window.removeEventListener(name,listener,true));
    }
  },value.id);return value.id;
}
async function inspect(page,id,label){
  const value=await call(page,'inspect',id);records.get(page).checkpoints.push({label,id,...value});return value;
}
async function roleBox(page,id,paths,role){
  return page.evaluate(({id,path})=>{
    let element=document.getElementById(`${id}-editor`);for(const index of path)element=element.children[index];
    const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,tag:element.tagName};
  },{id,path:paths[role]});
}
async function arm(page,id,item,{focus=true}={}){
  if(focus)await call(page,'editorFocus',id);await frames(page);
  const box=await roleBox(page,id,item.roles_before??item.roles,item.source??item.cancel_source);
  // Container border is a genuine container hit; paragraph body is a genuine text-block hit.
  await page.mouse.move(box.x+(box.tag==='BLOCKQUOTE'?2:Math.min(32,box.width/2)),box.y+(box.tag==='BLOCKQUOTE'?2:box.height/2));
  await frames(page);await expect(handle(page,id)).toHaveAttribute('aria-disabled','false');
  const h=await handle(page,id).boundingBox();expect(h).not.toBeNull();
  const point={x:h.x+h.width/2,y:h.y+h.height/2};await page.mouse.move(point.x,point.y);await frames(page);
  await page.mouse.down();return point;
}
async function originalPointer(page,id){
  const observations=await page.evaluate(id=>window.dragPointers.get(id).events,id);
  const downs=observations.filter(e=>e.name==='pointerdown'&&e.targetControl==='drag');expect(downs).toHaveLength(1);
  const down=downs[0],held=observations.filter(e=>e.at>=down.at&&e.name==='pointermove'&&e.buttons===1),ups=observations.filter(e=>e.at>=down.at&&e.name==='pointerup');
  expect(down.isTrusted).toBe(true);expect(down.pointerType).toBe('mouse');expect(down.button).toBe(0);expect(down.buttons).toBe(1);
  expect(held.length).toBeGreaterThanOrEqual(frozen.pointer.held_move_steps);expect(ups).toHaveLength(1);
  for(const e of [...held,...ups]){expect(e.isTrusted).toBe(true);expect(e.pointerId).toBe(down.pointerId);expect(e.pointerType).toBe('mouse');}
  expect(ups[0].button).toBe(0);expect(ups[0].buttons).toBe(0);expect(observations.filter(e=>e.at>=down.at&&e.name==='pointercancel')).toEqual([]);
}
async function moveTo(page,id,item){
  const box=await roleBox(page,id,item.roles_before??item.roles,item.target??item.cancel_target);
  const fraction=item.placement==='after'?frozen.pointer.after_y_fraction:frozen.pointer.before_y_fraction;
  const point={x:box.x+Math.min(32,box.width/2),y:box.y+box.height*fraction};
  await page.mouse.move(point.x,point.y,{steps:frozen.pointer.held_move_steps});await frames(page);
  return point;
}
function unchanged(after,before){
  expect(after.canonical).toBe(before.canonical);expect(after.state).toEqual(before.state);
  expect(after.rows).toEqual(before.rows);expect(after.events).toEqual(before.events);
}
function identities(value,paths,before){
  expect(value.rows).toHaveLength(Object.keys(paths).length);
  for(const[role,path]of Object.entries(paths)){
    const row=value.rows.find(v=>JSON.stringify(v.path)===JSON.stringify(path));expect(row,role).toBeDefined();expect(row.node.id,role).toBe(before.roles[role]);
  }
  expect(roleIds(value)).toEqual(roleIds(before));
}
function changed(after,before,item){
  expect(after.canonical).toBe(item.after);identities(after,item.roles_after,before);
  expect(after.state.selection).toEqual(before.state.selection);expect(after.state.stored_marks).toEqual(before.state.stored_marks);
  expect(after.state.stamp.session).toBe(before.state.stamp.session);expect(after.state.stamp.generation).toBe(before.state.stamp.generation);
  for(const[key,amount]of [['revision',1n],['selection_epoch',0n],['history_epoch',1n]])expect(BigInt(after.state.stamp[key])-BigInt(before.state.stamp[key])).toBe(amount);
  expect(after.state.history.undo_entries).toBe('1');expect(after.state.history.redo_entries).toBe('0');
  expect(after.state.dirty).toBe(true);expect(after.state.saved_revision).toBe(before.state.saved_revision);
  expect(docEvents(after).length-docEvents(before).length).toBe(1);
  expect(after.events.filter(e=>e.change.kind==='state')).toEqual(before.events.filter(e=>e.change.kind==='state'));
  expect(submissions(after).length-submissions(before).length).toBe(1);
  expect(submissions(after).at(-1).response.status).toBe('ok');expect(submissions(after).at(-1).response.value.effect).toBe('changed');
  const command=after.dragCommands.at(-1).command,expected=resolve(item.intent,before.roles);
  expect(command.id).toBe('org.klenwriter.kwdj/command/move');expect(JSON.parse(command.payload_json)).toEqual(expected);
  expect(after.uiResources.dragGestures).toBe(0);expect(after.uiResources.pointerCaptures).toBe(0);
  expect(after.resources.hostRequests).toEqual({pending:0,focusContinuations:0});
}
async function history(page,id,item,before,after){
  expect((await call(page,'history',id,'undo')).response.status).toBe('ok');
  const undo=await inspect(page,id,'one Undo restores exact input and original identities');
  expect(undo.canonical).toBe(item.input);identities(undo,item.roles_before,before);expect(undo.state.selection).toEqual(before.state.selection);
  expect(undo.state.history.undo_entries).toBe('0');expect(undo.state.history.redo_entries).toBe('1');
  expect((await call(page,'history',id,'redo')).response.status).toBe('ok');
  const redo=await inspect(page,id,'one Redo restores exact output and original identities');
  expect(redo.canonical).toBe(after.canonical);identities(redo,item.roles_after,before);expect(redo.state.selection).toEqual(after.state.selection);
  expect(redo.state.history.undo_entries).toBe('1');expect(redo.state.history.redo_entries).toBe('0');
  for(const[value,n]of [[undo,2n],[redo,3n]]){
    expect(BigInt(value.state.stamp.revision)-BigInt(before.state.stamp.revision)).toBe(n);
    expect(BigInt(value.state.stamp.history_epoch)-BigInt(before.state.stamp.history_epoch)).toBe(n);
    expect(value.state.stamp.selection_epoch).toBe(before.state.stamp.selection_epoch);
  }
}
test.beforeEach(async({page,browser},info)=>{
  const record={engine:info.project.name,browserVersion:browser.version(),installedBrowser:false,oracle:{path:oraclePath,bytes:oracleBytes.length,sha256:createHash('sha256').update(oracleBytes).digest('hex')},errors:[],externalRequests:[],checkpoints:[],gestures:[],cleanup:[],mounts:new Set()};records.set(page,record);
  page.on('pageerror',error=>record.errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:4174/'))record.externalRequests.push(request.url());});
  await page.addInitScript(()=>{window.dragPolicy=[];document.addEventListener('securitypolicyviolation',e=>window.dragPolicy.push({directive:e.effectiveDirective,blocked:e.blockedURI}));});
  const loaded=await page.goto('/ui');record.csp=loaded.headers()['content-security-policy'];expect(record.csp).toContain("default-src 'none'");expect(record.csp).not.toContain("'unsafe-inline'");expect(record.csp).not.toMatch(/(?:^|\s)'unsafe-eval'/);
  await page.waitForFunction(()=>!!window.ui42);record.moduleManifest=await page.evaluate(()=>window.ui42.moduleManifest);
});
test.afterEach(async({page},info)=>{
  const r=records.get(page);if(!r)return;
  try{
    for(const id of r.mounts){
      const pointers=await page.evaluate(id=>{const r=window.dragPointers.get(id);if(!r)return null;for(const remove of r.removals)remove();window.dragPointers.delete(id);return {events:r.events,overflow:r.overflow};},id);
      r.gestures.push({id,...pointers});expect(pointers?.overflow).toBe(false);
      const result=await call(page,'destroy',id);r.mounts.delete(id);r.cleanup.push({id,...result});
      expect(result.ui).toEqual({listeners:0,observers:0,animationFrames:0,subscriptions:0,hostRequests:0,continuations:0,dragGestures:0,pointerCaptures:0});
      expect(result.mounted.dom).toEqual({listeners:0,observers:0,continuations:0,retainedInputBytes:0,retainedRecoveryRegions:0});
      expect(result.mounted.selection).toEqual({bookmarks:0,restoreTickets:0,activePointers:0,animationFrames:0});
      expect(result.mounted.clipboard).toEqual({pending:0,continuations:0,retainedTextBytes:0});expect(result.mounted.hostRequests).toEqual({pending:0,focusContinuations:0});
      for(const group of ['inputObservations','popupPresentation'])for(const[key,value]of Object.entries(result.mounted[group])){expect(typeof value,`${group}/${key}`).toBe('number');expect(value,`${group}/${key}`).toBe(0);}
      expect(result.mounted.sdk.lifecycle).toBe('destroyed');
      for(const[key,value]of Object.entries(result.mounted.sdk))if(key!=='lifecycle'){expect(typeof value,`sdk/${key}`).toBe('number');expect(value,`sdk/${key}`).toBe(0);}
    }
    if(r.cleanup.length)expect(r.cleanup.at(-1).native).toEqual({sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});
    r.policy=await page.evaluate(()=>window.dragPolicy);expect(r.errors).toEqual([]);expect(r.externalRequests).toEqual([]);expect(r.policy).toEqual([]);
  }finally{
    r.remainingMounts=[...r.mounts];delete r.mounts;r.status=info.status;r.scope='Actual packaged mounted UI/SDK/WASM and browser pointer; fault/synthetic transfer rows explicitly controlled, no installed OS or CMS acceptance.';
    mkdirSync('artifacts/drag/mounted',{recursive:true});const path=`artifacts/drag/mounted/${info.project.name}-${info.testId.replaceAll(/[^A-Za-z0-9_-]/g,'_')}.json`;writeFileSync(path,JSON.stringify(r,null,2)+'\n');await info.attach('drag-mounted-observations',{path,contentType:'application/json'});
  }
});

for(const item of frozen.cases.filter(c=>!c.scroll))test(`drag ${item.id}: exact native Move, identity and one Undo/Redo`,async({page})=>{
  const id=await mount(page,item),before=await inspect(page,id,'literal baseline before gesture');expect(before.canonical).toBe(item.input);
  await arm(page,id,item);await moveTo(page,id,item);
  if(item.inside_key){await page.keyboard.press(item.inside_key);await frames(page);}
  const held=await inspect(page,id,'held preview is publication-free');unchanged(held,before);
  expect(held.uiResources.dragGestures).toBe(1);expect(held.uiResources.pointerCaptures).toBe(1);
  await page.mouse.up();await expect.poll(async()=>submissions(await call(page,'inspect',id)).length).toBe(1);
  const after=await inspect(page,id,'one original pointer completion');changed(after,before,item);
  await originalPointer(page,id);
  await expect(page.locator(`#${id}-editor`)).toBeFocused();await history(page,id,item,before,after);
});

for(const item of frozen.cases.filter(c=>c.scroll))test(`drag ${item.id}: original held pointer scrolls to frozen opposite terminal`,async({page})=>{
  const id=await mount(page,item);await call(page,'editorFocus',id);
  const setup=await page.evaluate(({id,direction})=>{
    const root=document.getElementById(id),editor=document.getElementById(`${id}-editor`);root.classList.add('ui-drag-scroll');
    editor.scrollTop=direction==='up'?editor.scrollHeight-editor.clientHeight:0;
    const r=editor.getBoundingClientRect();return {scrollTop:editor.scrollTop,maximum:editor.scrollHeight-editor.clientHeight,clip:{x:r.x+editor.clientLeft,y:r.y+editor.clientTop,width:editor.clientWidth,height:editor.clientHeight}};
  },{id,direction:item.scroll.direction});
  expect(setup.maximum).toBeGreaterThan(setup.clip.height);await frames(page);
  const before=await inspect(page,id,'scroll layout and offset fixed before original pointer down');
  await arm(page,id,item,{focus:false});
  const point={x:setup.clip.x+80,y:item.scroll.direction==='down'?setup.clip.y+setup.clip.height-10:setup.clip.y+10};
  await page.mouse.move(point.x,point.y,{steps:frozen.pointer.held_move_steps});await frames(page);
  const samples=[],began=Date.now();let terminal=false;
  while(Date.now()-began<=item.scroll.maximum_hold_ms){
    const sample=await page.evaluate(({id,path,point,direction})=>{
      const editor=document.getElementById(`${id}-editor`);let target=editor;for(const index of path)target=target.children[index];
      const e=editor.getBoundingClientRect(),r=target.getBoundingClientRect(),top=e.y+editor.clientTop,bottom=top+editor.clientHeight,maximum=editor.scrollHeight-editor.clientHeight;
      const line=direction==='down'?r.bottom-2:r.top;
      return {at:performance.now(),offset:editor.scrollTop,maximum,gesture:document.querySelector(`#${id} .kw-ui-drag-preview`)?.hidden===false,terminal:(direction==='down'?Math.abs(editor.scrollTop-maximum)<=1:editor.scrollTop<=1)&&line>=top&&line+2<=bottom&&point.y>=r.top&&point.y<=r.bottom};
    },{id,path:item.roles_before[item.target],point,direction:item.scroll.direction});
    samples.push(sample);if(sample.terminal){terminal=true;break;}await page.waitForTimeout(item.scroll.poll_ms);
  }
  records.get(page).checkpoints.push({label:'finite passive scroll observations; no external scroll writes after down',id,setup,samples});
  expect(terminal).toBe(true);expect(samples.some(s=>Math.abs(s.offset-setup.scrollTop)>1)).toBe(true);
  const held=await inspect(page,id,'scroll preview still publication-free');unchanged(held,before);expect(held.uiResources.dragGestures).toBe(1);
  await page.mouse.up();await expect.poll(async()=>submissions(await call(page,'inspect',id)).length).toBe(1);
  const after=await inspect(page,id,'original scroll pointer completes one literal Move');changed(after,before,item);await originalPointer(page,id);
  await history(page,id,item,before,after);
});

for(const locale of ['en','ru'])test(`drag ${locale}: Escape and subthreshold release preserve exact native facets`,async({page})=>{
  const f=frozen.unchanged_fixture,item={...f,source:f.cancel_source,target:f.cancel_target,placement:'before'};
  const id=await mount(page,item,{locale}),before=await inspect(page,id,'cancel baseline');
  await arm(page,id,item);await moveTo(page,id,item);await page.keyboard.press('Escape');await page.mouse.up();await frames(page);
  const cancelled=await inspect(page,id,'Escape releases gesture without native publication');unchanged(cancelled,before);
  expect(submissions(cancelled)).toEqual([]);expect(cancelled.uiResources.dragGestures).toBe(0);expect(cancelled.uiResources.pointerCaptures).toBe(0);
  const start=await arm(page,id,item);await page.mouse.move(start.x+1,start.y);await page.mouse.up();await frames(page);
  const small=await inspect(page,id,'subthreshold click neither moves nor opens a fresh command');unchanged(small,before);
  expect(submissions(small)).toEqual([]);expect(small.resources.hostRequests).toEqual({pending:0,focusContinuations:0});
});

test('drag invalid descendant destination is refused by native query without publishing or clearing history',async({page})=>{
  const f=frozen.unchanged_fixture,item={...f,source:f.cycle_source,target:f.cycle_target,placement:'before'};
  const id=await mount(page,item),before=await inspect(page,id,'cycle baseline');await arm(page,id,item);await moveTo(page,id,item);
  const held=await inspect(page,id,'native query rejects cycle');unchanged(held,before);
  expect(JSON.parse(held.dragCommands.at(-1).command.payload_json)).toEqual(resolve(f.cycle_intent,before.roles));
  const trace=await call(page,'nativeTrace',id);expect(trace.overflow).toBe(false);
  const query=trace.calls.filter(c=>{const v=JSON.parse(c.requestJson);return v.kind==='query_command'&&v.command.id==='org.klenwriter.kwdj/command/move';}).at(-1);
  expect(query).toBeDefined();const response=JSON.parse(query.responseJson);expect(response.status).toBe('ok');expect(response.value.available).toBe(false);expect(response.value.diagnostic.code).toBe('tree.cycle');
  await page.mouse.up();await frames(page);const after=await inspect(page,id,'invalid drop terminal');unchanged(after,before);
  expect(submissions(after)).toEqual([]);expect(after.uiResources.dragGestures).toBe(0);expect(after.uiResources.pointerCaptures).toBe(0);
});
