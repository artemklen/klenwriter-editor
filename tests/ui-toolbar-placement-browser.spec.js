// SPDX-License-Identifier: MIT OR Apache-2.0
import {test,expect} from '@playwright/test';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const directory='contracts/ui/v1.1',hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifestBytes=readFileSync(`${directory}/manifest.json`),manifest=JSON.parse(manifestBytes);
const payload=manifest.files.map(pin=>({...pin,bytesValue:readFileSync(`${directory}/${pin.path}`)}));
const data=JSON.parse(payload.find(pin=>pin.path==='toolbar-placement-cases.json').bytesValue);
const baseBytes=readFileSync(manifest.baseV1manifest.path),base=JSON.parse(baseBytes);
const nativePin=base.files.find(pin=>pin.path==='native-oracles.json');
const nativeBytes=readFileSync(`contracts/ui/v1/${nativePin.path}`),native=JSON.parse(nativeBytes);
const literals=new Map(native.cases.map(item=>[item.id,item]));
const observations=new WeakMap(),call=(page,method,...args)=>page.evaluate(({method,args})=>window.ui42[method](...args),{method,args});
const bounds=data.bounds;
const inputSelection=(roles,selection)=>Object.fromEntries(Object.entries(selection).map(([key,point])=>[key,Object.fromEntries(Object.entries(point).map(([field,value])=>[field,['node','parent'].includes(field)?roles[value]:value]))]));

async function frames(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function checkpoint(page,id,label,options){
  const native=await call(page,'inspect',id,options),facts=await call(page,'mountedFacts',id),trace=await call(page,'nativeTrace',id);
  const value={label,native,nativeCounts:facts.native,trace};observations.get(page).checkpoints.push(value);return value;
}
function pureNative(after,before,{snapshot=true}={}){
  if(snapshot)expect(after.native.canonical,'real SDK canonical snapshot is unchanged').toBe(before.native.canonical);
  else for(const value of [before,after]){expect(value.native.canonical).toBeNull();expect(value.native.canonicalObservation).toEqual({status:'not_requested'});}
  for(const key of ['state','rows','events','failures','results','focusResults','context','mode','modeResults','hostAttributes','clipboardResults','recoveryResults','resources'])expect(after.native[key],`placement preserves ${key}`).toEqual(before.native[key]);
  expect(after.nativeCounts).toEqual(before.nativeCounts);
  expect(after.trace.overflow).toBe(false);
  const requests=after.trace.calls.slice(before.trace.calls.length).map(row=>JSON.parse(row.requestJson));
  expect(requests.filter(row=>['command','history','set_selection'].includes(row.kind)),'position refresh does not submit a semantic command or selection write').toEqual([]);
  expect(after.native.uiResources.animationFrames).toBeLessThanOrEqual(1);
  expect(after.native.uiResources.observers).toBeLessThanOrEqual(1);
  expect(after.native.uiResources.subscriptions).toBe(1);
  expect(after.native.uiResources.hostRequests).toBe(before.native.uiResources.hostRequests);
  expect(after.native.uiResources.continuations).toBe(before.native.uiResources.continuations);
}

// Independent oracle: literal childNodes endpoints, raw UA Ranges and object identity.
// No candidate mapper, position class or computed position is an expected result.
async function raw(page,id,literal,remember=false){
  return page.evaluate(({id,literal,remember})=>{
    const host=document.getElementById(`${id}-editor`),wrapper=document.getElementById(id),toolbar=wrapper.querySelector('[role=toolbar]');
    window.toolbarPlacementObjects??=new WeakMap();window.toolbarPlacementSerial??=0;
    const token=node=>{if(!node)return null;if(!window.toolbarPlacementObjects.has(node))window.toolbarPlacementObjects.set(node,++window.toolbarPlacementSerial);return window.toolbarPlacementObjects.get(node);};
    const endpoint=point=>{let node=host;for(const index of point.path)node=node.childNodes[index];if(node?.nodeType!==Node.TEXT_NODE||node.data!==point.text||point.offset>node.length)throw Error('Independent literal Text endpoint mismatch');return {node,offset:point.offset};};
    const a=endpoint(literal.anchor),f=endpoint(literal.focus),ar=document.createRange(),fr=document.createRange(),range=document.createRange();
    ar.setStart(a.node,a.offset);ar.collapse(true);fr.setStart(f.node,f.offset);fr.collapse(true);
    const forward=ar.compareBoundaryPoints(Range.START_TO_START,fr)<=0,start=forward?a:f,end=forward?f:a;
    range.setStart(start.node,start.offset);range.setEnd(end.node,end.offset);
    const rect=box=>({x:box.x,y:box.y,width:box.width,height:box.height});
    const fragments=[...range.getClientRects()].map(rect),anchor=[...ar.getClientRects()].map(rect),focus=[...fr.getClientRects()].map(rect);
    const viewport={x:visualViewport?.offsetLeft??0,y:visualViewport?.offsetTop??0,width:visualViewport?.width??innerWidth,height:visualViewport?.height??innerHeight};
    const clip=r=>{if(!Object.values(r).every(Number.isFinite)||r.height<=0||r.width<0)return null;const x=Math.max(r.x,viewport.x),right=Math.min(r.x+r.width,viewport.x+viewport.width),y=Math.max(r.y,viewport.y),bottom=Math.min(r.y+r.height,viewport.y+viewport.height);return bottom>y&&(r.width===0?r.x>=viewport.x&&r.x<=viewport.x+viewport.width:right>x)?{x:r.width===0?r.x:x,y,width:r.width===0?0:right-x,height:bottom-y}:null;};
    const visible=[...fragments,...anchor,...focus].map(clip).filter(Boolean),envelope=visible.length?{x:Math.min(...visible.map(r=>r.x)),y:Math.min(...visible.map(r=>r.y)),right:Math.max(...visible.map(r=>r.x+r.width)),bottom:Math.max(...visible.map(r=>r.y+r.height))}:null;
    const walker=document.createTreeWalker(host,NodeFilter.SHOW_ALL),objects=[];for(let node=walker.currentNode;node;node=walker.nextNode()){if(objects.length>=128)throw Error('Finite literal fixture bound');objects.push(node);}
    const nodes=[...objects.filter(node=>node.nodeType===Node.ELEMENT_NODE)];for(let node=host.parentElement;node;node=node.parentElement){if(nodes.length>=256)throw Error('Finite scroll ancestry');nodes.push(node);}
    const selection=document.getSelection(),rawSelection=selection?{rangeCount:selection.rangeCount,anchor:token(selection.anchorNode),anchorOffset:selection.anchorOffset,focus:token(selection.focusNode),focusOffset:selection.focusOffset}:null;
    const buttons=[...toolbar.querySelectorAll('button')].map(button=>({key:button.getAttribute('data-editor-ui-action'),object:token(button)}));
    const value={toolbar:{object:token(toolbar),parent:token(toolbar.parentElement),connected:toolbar.isConnected,rect:rect(toolbar.getBoundingClientRect()),left:toolbar.style.left,top:toolbar.style.top},buttons,toolbarCount:wrapper.querySelectorAll('[role=toolbar]').length,
      fragments,anchor,focus,visible,envelope,viewport,rawSelection,literalSelection:{anchor:token(a.node),anchorOffset:a.offset,focus:token(f.node),focusOffset:f.offset},
      hostHtml:host.outerHTML,objects:objects.map(token),contentRects:[host,...host.querySelectorAll('*')].map(node=>({object:token(node),rects:[...node.getClientRects()].map(rect)})),
      active:token(document.activeElement),scroll:{window:[scrollX,scrollY],nodes:nodes.map(node=>({object:token(node),x:node.scrollLeft,y:node.scrollTop}))}};
    window.toolbarPlacementBaselines??=new Map();if(remember)window.toolbarPlacementBaselines.set(id,value);return value;
  },{id,literal,remember});
}
function nearRects(after,before){
  expect(after.length).toBe(before.length);
  for(let index=0;index<before.length;index++)for(const key of ['x','y','width','height'])expect(Math.abs(after[index][key]-before[index][key]),`actual range ${index}/${key} is unchanged`).toBeLessThanOrEqual(bounds.toleranceCssPx);
}
function pureBrowser(after,before){
  for(const key of ['buttons','toolbarCount','rawSelection','literalSelection','hostHtml','objects','active','scroll'])expect(after[key],`position preserves browser ${key}`).toEqual(before[key]);
  for(const key of ['object','parent','connected'])expect(after.toolbar[key]).toBe(before.toolbar[key]);
  for(const key of ['fragments','anchor','focus'])nearRects(after[key],before[key]);
  expect(after.contentRects.map(row=>row.object)).toEqual(before.contentRects.map(row=>row.object));
  after.contentRects.forEach((row,index)=>nearRects(row.rects,before.contentRects[index].rects));
}
function feasibility(value){
  const {viewport:v,envelope:e,toolbar:{rect:b}}=value;
  expect(e,'actual visible independent fragments').not.toBeNull();
  expect([b.x,b.y,b.width,b.height].every(Number.isFinite)).toBe(true);expect(b.width).toBeGreaterThan(0);expect(b.height).toBeGreaterThan(0);
  return {above:e.y-v.y-bounds.viewportInsetCssPx-bounds.verticalGapMinCssPx,
    below:v.y+v.height-bounds.viewportInsetCssPx-e.bottom-bounds.verticalGapMinCssPx,
    toolbarHeight:b.height,toolbarWidth:b.width,availableWidth:v.width-2*bounds.viewportInsetCssPx};
}
function floating(value){
  const {viewport:v,envelope:e,toolbar:{rect:b}}=value,t=bounds.toleranceCssPx,inset=bounds.viewportInsetCssPx;
  expect(b.x).toBeGreaterThanOrEqual(v.x+inset-t);expect(b.y).toBeGreaterThanOrEqual(v.y+inset-t);
  expect(b.x+b.width).toBeLessThanOrEqual(v.x+v.width-inset+t);expect(b.y+b.height).toBeLessThanOrEqual(v.y+v.height-inset+t);
  const above=e.y-(b.y+b.height),below=b.y-e.bottom;
  expect([above,below].some(gap=>gap>=bounds.verticalGapMinCssPx-t&&gap<=bounds.nearGapMaxCssPx+t),'actual box floats above or below the independent range').toBe(true);
  expect(b.x+b.width).toBeGreaterThanOrEqual(e.x-t);expect(b.x).toBeLessThanOrEqual(e.right+t);
  for(const r of value.visible){
    if(r.width===0)expect(r.x<b.x-t||r.x>b.x+b.width+t||r.y+r.height<=b.y+t||r.y>=b.y+b.height-t,'actual caret is not covered').toBe(true);
    else expect(Math.min(b.x+b.width,r.x+r.width)-Math.max(b.x,r.x)<=t||Math.min(b.y+b.height,r.y+r.height)-Math.max(b.y,r.y)<=t,'selected fragment is not covered').toBe(true);
  }
}
async function runtimeFile(page,url,path,pin){
  const response=await page.request.get(url);expect(response.ok(),url).toBe(true);const actual=await response.body(),local=readFileSync(path);
  expect(hash(actual),`served bytes ${url}`).toBe(hash(local));if(pin){expect(actual.length).toBe(pin.bytes);expect(hash(actual)).toBe(pin.sha256);}
  return {url,path,bytes:actual.length,sha256:hash(actual)};
}

test.beforeEach(async({page},info)=>{
  const record={engine:info.project.name,installedBrowser:false,scope:'Actual packaged SDK2/WASM/UI toolbar placement; independent literal raw Range/viewport oracle. Browser protocol is not installed OS input or independent formal review.',
    frozen:{manifestSha256:hash(manifestBytes),baseV1Sha256:hash(baseBytes),members:manifest.files},runtimeFiles:[],errors:[],externalRequests:[],checkpoints:[],geometry:[],raw:[],mounts:[],cleanup:[]};observations.set(page,record);
  expect(hash(baseBytes)).toBe(manifest.baseV1manifest.sha256);expect(baseBytes.length).toBe(manifest.baseV1manifest.bytes);expect(hash(nativeBytes)).toBe(nativePin.sha256);
  for(const pin of payload){expect(pin.bytesValue.length).toBe(pin.bytes);expect(hash(pin.bytesValue)).toBe(pin.sha256);}
  page.on('pageerror',error=>record.errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:4174/'))record.externalRequests.push(request.url());});
  await page.addInitScript(()=>{window.toolbarPlacementPolicy=[];document.addEventListener('securitypolicyviolation',event=>window.toolbarPlacementPolicy.push({directive:event.effectiveDirective,blocked:event.blockedURI}));});
  const response=await page.goto('/ui');record.csp=response.headers()['content-security-policy'];expect(record.csp).toContain("default-src 'none'");expect(record.csp).not.toContain("'unsafe-inline'");expect(record.csp).not.toContain("'unsafe-eval'");
  await page.waitForFunction(()=>!!window.ui42,undefined,{timeout:15000});record.moduleManifest=await page.evaluate(()=>window.ui42.moduleManifest);
  record.runtimeFiles.push(await runtimeFile(page,'/ui-contract/v1.1/manifest.json',`${directory}/manifest.json`));
  for(const pin of payload)record.runtimeFiles.push(await runtimeFile(page,`/ui-contract/v1.1/${pin.path}`,`${directory}/${pin.path}`,pin));
  for(const file of readdirSync('packages/ui/dist').filter(name=>name.endsWith('.js')))record.runtimeFiles.push(await runtimeFile(page,`/packages/ui/${file}`,`packages/ui/dist/${file}`));
  for(const [url,path]of [['/ui-style.css','packages/ui/dist/style.css'],['/ui-fixture.css','spikes/workspace/ui-fixture.css']])record.runtimeFiles.push(await runtimeFile(page,url,path));
});
test.afterEach(async({page},info)=>{
  const record=observations.get(page);if(!record)return;
  try{
    for(const id of record.mounts){const result=await call(page,'destroy',id);record.cleanup.push({id,...result});
      expect(result.ui).toEqual({listeners:0,observers:0,animationFrames:0,subscriptions:0,hostRequests:0,continuations:0});
      expect(result.mounted.dom).toEqual({listeners:0,observers:0,continuations:0,retainedInputBytes:0,retainedRecoveryRegions:0});
      expect(result.mounted.selection).toEqual({bookmarks:0,restoreTickets:0,activePointers:0,animationFrames:0});expect(result.mounted.clipboard).toEqual({pending:0,continuations:0,retainedTextBytes:0});
      expect(result.mounted.hostRequests).toEqual({pending:0,focusContinuations:0});for(const key of ['sessions','listeners','queued_mutations','queued_bytes','pending_tickets','host_requests','task_continuations'])expect(result.mounted.sdk[key]).toBe(0);
      expect(result.native).toEqual({sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});
    }
    record.policy=await page.evaluate(()=>window.toolbarPlacementPolicy);expect(record.errors).toEqual([]);expect(record.externalRequests).toEqual([]);expect(record.policy).toEqual([]);
  }finally{
    record.status=info.status;mkdirSync('artifacts/ui',{recursive:true});const path=`artifacts/ui/${info.project.name}-toolbar-placement-${info.testId.replaceAll(/[^A-Za-z0-9_-]/g,'_')}.json`;
    writeFileSync(path,JSON.stringify(record,null,2)+'\n');await info.attach('ui-toolbar-placement-observations',{path,contentType:'application/json'});
  }
});

for(const scenario of data.cases)for(const variant of scenario.variants)test(`${scenario.id} ${variant}: ${scenario.expected.placement} from independent range bounds; native, focus and objects remain exact`,async({page})=>{
  const record=observations.get(page),literal=data.literalSelections[variant],item=literals.get(literal.case);record.scenario={id:scenario.id,variant,expected:scenario.expected};
  await page.setViewportSize(scenario.viewport);const mounted=await call(page,'mount',{case:literal.case,nativeTrace:true});record.mounts.push(mounted.id);
  expect(mounted.ready).toBe('ready');expect(mounted.uiReady).toBe('ready');const id=mounted.id,toolbar=page.locator(`#${id}`).getByRole('toolbar'),bold=toolbar.locator('[data-editor-ui-action=strong]');
  await expect(toolbar).toHaveAccessibleName('Text formatting');expect(await page.locator(`#${id}`).getByRole('status').textContent()).not.toMatch(/^(Открываем документ…|Opening document…)$/);
  const initial=await raw(page,id,literal);record.raw.push({label:'original keyed controls before layout setup',...initial});
  // Exact bookmark focus is setup, before deliberately unsupported geometry.
  // It must succeed; presentation-only assertions start after the layout setup.
  const focused=await call(page,'editorFocus',id);expect(focused.response?.status).toBe('ok');await expect(page.locator(`#${id}-editor`)).toBeFocused();
  const unsupported=scenario.id==='TP03',preTransform=unsupported?await checkpoint(page,id,'full real SDK canonical before unsupported transform'):null;
  const preTransformRaw=unsupported?await raw(page,id,literal):null;
  if(unsupported){expect(preTransform.native.canonical).toBe(item.input.canonical_json);record.raw.push({label:'before unsupported transform, focus setup complete',...preTransformRaw});}
  await page.evaluate(({id,setup})=>{const wrapper=document.getElementById(id),editor=document.getElementById(`${id}-editor`);if(setup.wrapperClass)wrapper.classList.add(setup.wrapperClass);if(setup.existingExternalClass)editor.classList.add(setup.existingExternalClass);},{id,setup:scenario.setup});
  await frames(page);
  const observation=unsupported?{snapshot:false}:undefined;
  const before=await checkpoint(page,id,'baseline after closed setup and real exact bookmark focus',observation);
  if(unsupported){expect(before.native.canonical).toBeNull();expect(before.native.canonicalObservation).toEqual({status:'not_requested'});}
  else expect(before.native.canonical).toBe(item.input.canonical_json);
  expect(before.native.state.selection).toEqual(inputSelection(before.native.roles,item.input.selection));expect(before.native.results).toEqual([]);
  const a=await raw(page,id,literal,true);record.raw.push({label:'before explicit presentation refresh',...a});
  expect(a.toolbar.object).toBe(initial.toolbar.object);expect(a.buttons).toEqual(initial.buttons);expect(a.toolbarCount).toBe(1);expect(a.rawSelection).toEqual({rangeCount:1,...a.literalSelection});expect(a.scroll.window).toEqual([0,0]);
  const geometry=await call(page,'geometryRead',id,{kind:'selection'});record.geometry.push(geometry);
  if(scenario.id==='TP03'){expect(geometry.status).toBe('dom_refused');expect(geometry.diagnostic.code).toBe(scenario.expected.originalGeometryCode);}
  else{
    expect(geometry.status).toBe('measured');expect(geometry.visible).toBe(true);const fit=feasibility(a);record.feasibility=fit;
    if(scenario.id==='TP01'){expect(a.envelope.y).toBeGreaterThanOrEqual(250);expect(a.envelope.y).toBeLessThanOrEqual(400);expect(Math.max(fit.above,fit.below)).toBeGreaterThanOrEqual(fit.toolbarHeight);expect(fit.availableWidth).toBeGreaterThanOrEqual(fit.toolbarWidth);}
    else{expect(fit.above).toBeLessThan(fit.toolbarHeight-bounds.toleranceCssPx);expect(fit.below).toBeLessThan(fit.toolbarHeight-bounds.toleranceCssPx);}
  }
  await call(page,'refresh',id);await frames(page);const b=await raw(page,id,literal);record.raw.push({label:'after presentation refresh',...b});
  const after=await checkpoint(page,id,'after presentation-only refresh',observation);pureBrowser(b,a);pureNative(after,before,{snapshot:!unsupported});
  if(scenario.expected.placement==='floating')floating(b);else{expect(b.toolbar.left).toBe('');expect(b.toolbar.top).toBe('');expect(b.toolbar.connected).toBe(true);}
  if(unsupported){
    // All unsupported-layout/fallback checks are finished. This is explicit
    // fixture CSS teardown, never focus/scroll/selection assistance to pass them.
    record.layoutTeardown=await page.evaluate(({id,name})=>{const editor=document.getElementById(`${id}-editor`),present=editor.classList.contains(name);editor.classList.remove(name);return {kind:'remove_only_closed_transform_class_after_unsupported_assertions',name,presentBefore:present,presentAfter:editor.classList.contains(name),focusScrollOrSelectionRequested:false};},{id,name:scenario.setup.existingExternalClass});
    expect(record.layoutTeardown.presentBefore).toBe(true);expect(record.layoutTeardown.presentAfter).toBe(false);await frames(page);
    const restored=await checkpoint(page,id,'full real SDK canonical after explicit unsupported-layout teardown'),restoredRaw=await raw(page,id,literal);
    record.raw.push({label:'after CSS teardown, full canonical observations available',...restoredRaw});
    expect(restored.native.canonical).toBe(item.input.canonical_json);pureNative(restored,preTransform);pureBrowser(restoredRaw,preTransformRaw);
    for(const key of ['state','rows','events','results','context'])expect(restored.native[key],`unsupported phase preserved ${key}`).toEqual(after.native[key]);
  }
  if(scenario.id==='TP01'){
    await page.keyboard.press('Shift+Tab');await expect(bold).toBeFocused();await page.keyboard.press('ArrowRight');await expect(toolbar.locator('[data-editor-ui-action=emphasis]')).toBeFocused();await page.keyboard.press('Home');await expect(bold).toBeFocused();
    expect(await toolbar.locator('button[tabindex="0"]').count()).toBe(1);
    const focusBefore=await checkpoint(page,id,'real roving toolbar focus baseline'),focusRaw=await raw(page,id,literal);record.raw.push({label:'focused keyed button before refresh',...focusRaw});
    await call(page,'refresh',id);await frames(page);const focusAfterRaw=await raw(page,id,literal);record.raw.push({label:'focused keyed button after refresh',...focusAfterRaw});
    pureBrowser(focusAfterRaw,focusRaw);pureNative(await checkpoint(page,id,'focused control after presentation refresh'),focusBefore);floating(focusAfterRaw);await expect(bold).toBeFocused();
    await page.keyboard.press('Tab');await expect(page.locator(`#${id}-editor`)).toBeFocused();
    const exit=await checkpoint(page,id,'normal Tab exit after floating toolbar');for(const key of ['state','rows','canonical','events','results'])expect(exit.native[key]).toEqual(before.native[key]);
  }
});
