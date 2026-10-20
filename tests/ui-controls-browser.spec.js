// SPDX-License-Identifier: MIT OR Apache-2.0
import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const nativePath='contracts/ui/v1/native-oracles.json', nestingPath='contracts/ui/v1/nesting-oracles.json';
const nativeBytes=readFileSync(nativePath), nestingBytes=readFileSync(nestingPath);
const native=JSON.parse(nativeBytes), nesting=JSON.parse(nestingBytes);
const literals=new Map([...native.cases,...nesting.cases].map(c=>[c.id,c]));
const records=new WeakMap();
const call=(page,method,...args)=>page.evaluate(({method,args})=>window.ui42[method](...args),{method,args});
const root=(page,id)=>page.locator(`#${id}`);
const control=(page,id,key)=>root(page,id).locator(`[data-editor-ui-action="${key}"]`);
const add=(page,id)=>root(page,id).locator('[data-editor-ui-control="add"]');
const move=(page,id)=>root(page,id).locator('[data-editor-ui-control="move"]');
const documentEvents=state=>state.events.filter(e=>e.change.kind==='document');
const stateEvents=state=>state.events.filter(e=>e.change.kind==='state');
const submitted=state=>state.results.filter(r=>r.status==='submitted');
const point=(roles,p)=>p===null?null:Object.fromEntries(Object.entries(p).map(([k,v])=>[k,['node','parent'].includes(k)?roles[v]??v:v]));
const selection=(roles,s)=>s===null?null:{anchor:point(roles,s.anchor),focus:point(roles,s.focus)};
const rolePaths=paths=>Object.fromEntries(Object.entries(paths).map(([k,v])=>[k,Array.isArray(v)?v:v.kind==='synthetic_root'?[]:v.path]));
const idsAt=state=>state.rows.map(r=>r.node.id).sort();
const receiptHash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function mounted(page,configuration={}){
  const value=await call(page,'mount',configuration);records.get(page).mounts.push(value.id);
  expect(value.ready).toBe('ready');expect(value.uiReady).toBe('ready');
  expect(await root(page,value.id).getByRole('status').textContent()).not.toMatch(/^(Открываем документ…|Opening document…)$/);return value.id;
}
async function checkpoint(page,id,label){
  const value=await call(page,'inspect',id),statusText=await root(page,id).getByRole('status').textContent();records.get(page).checkpoints.push({label,id,...value,statusText});return value;
}
async function editorFocus(page,id){
  const response=await call(page,'editorFocus',id);expect(['completed','queued']).toContain(response.status);expect(response.response.status).toBe('ok');
  await expect(page.locator(`#${id}-editor`)).toBeFocused();
}
async function activate(page,id,key,method='pointer'){
  const button=control(page,id,key);await expect(button).toHaveAttribute('aria-disabled','false');
  if(method==='keyboard'){
    await editorFocus(page,id);await page.keyboard.press('Shift+Tab');
    await expect(control(page,id,'strong')).toBeFocused();
    if(key!=='strong')await button.focus();await page.keyboard.press('Enter');
  }else await button.click();
}
async function waitSubmissions(page,id,count){await expect.poll(async()=>submitted(await call(page,'inspect',id)).length).toBe(count);}
function unchanged(after,before){expect(after.canonical).toBe(before.canonical);expect(after.state).toEqual(before.state);expect(after.rows).toEqual(before.rows);expect(after.events).toEqual(before.events);}
function nativeChanged(after,before,item,{notes=false}={}){
  const e=item.expected,afterCanonical=notes?e.canonical:item.after_canonical??e.canonical_json;
  expect(after.canonical).toBe(afterCanonical);expect(after.state.stamp.revision).toBe(String(BigInt(before.state.stamp.revision)+1n));
  expect(after.state.history.undo_entries).toBe('1');expect(after.state.history.redo_entries).toBe('0');expect(after.state.dirty).toBe(true);
  expect(after.state.saved_revision).toBe('0');expect(documentEvents(after).length-documentEvents(before).length).toBe(1);
  const delta=e.stampDelta??e.command?.stamp_delta??{revision:1,selection_epoch:0,history_epoch:1};
  for(const key of ['revision','selection_epoch','history_epoch'])expect(BigInt(after.state.stamp[key])-BigInt(before.state.stamp[key])).toBe(BigInt(delta[key]));
  expect(stateEvents(after).length-stateEvents(before).length).toBe(0);
  expect(submitted(after).length-submitted(before).length).toBe(1);expect(submitted(after).at(-1).response.status).toBe('ok');
  expect(idsAt(after)).toEqual([...idsAt(before),...idsAt(after).filter(id=>!idsAt(before).includes(id))].sort());
}
async function nativeUndoRedo(page,id,item,before,after){
  const result=await call(page,'history',id,'undo');expect(result.response.status).toBe('ok');
  const undone=await checkpoint(page,id,'undo exact input, IDs, selection and stored marks');
  expect(undone.canonical).toBe(before.canonical);expect(undone.state.selection).toEqual(before.state.selection);expect(undone.state.stored_marks).toEqual(before.state.stored_marks);expect(idsAt(undone)).toEqual(idsAt(before));
  expect(undone.state.history.undo_entries).toBe('0');expect(undone.state.history.redo_entries).toBe('1');
  expect((await call(page,'history',id,'redo')).response.status).toBe('ok');
  const redone=await checkpoint(page,id,'redo exact output, IDs and directed selection');expect(redone.canonical).toBe(after.canonical);expect(redone.state.selection).toEqual(after.state.selection);expect(idsAt(redone)).toEqual(idsAt(after));
  expect(redone.state.history.undo_entries).toBe('1');expect(redone.state.history.redo_entries).toBe('0');
}

test.beforeEach(async({page},info)=>{
  const record={engine:info.project.name,installedBrowser:false,scope:'Actual packaged mounted SDK2/WASM/UI; browser-protocol keyboard/pointer. Explicit synthetic composition is controlled integration, not OS IME.',
    frozen:[{path:nativePath,bytes:nativeBytes.length,sha256:receiptHash(nativeBytes)},{path:nestingPath,bytes:nestingBytes.length,sha256:receiptHash(nestingBytes)}],errors:[],externalRequests:[],mounts:[],checkpoints:[],cleanup:[]};
  records.set(page,record);page.on('pageerror',error=>record.errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:4174/'))record.externalRequests.push(request.url());});
  await page.addInitScript(()=>{window.uiPolicy=[];document.addEventListener('securitypolicyviolation',event=>window.uiPolicy.push({directive:event.effectiveDirective,blocked:event.blockedURI}));});
  const response=await page.goto('/ui');record.csp=response.headers()['content-security-policy'];expect(record.csp).toContain("default-src 'none'");expect(record.csp).not.toContain("'unsafe-inline'");expect(record.csp).not.toContain("'unsafe-eval'");
  await page.waitForFunction(()=>!!window.ui42,undefined,{timeout:15000});
});
test.afterEach(async({page},info)=>{
  const record=records.get(page);if(!record)return;
  try{
    for(const id of record.mounts){const result=await call(page,'destroy',id);record.cleanup.push({id,...result});expect(result.ui).toEqual({listeners:0,observers:0,animationFrames:0,subscriptions:0,hostRequests:0,continuations:0});
      expect(result.mounted.dom.listeners).toBe(0);expect(result.mounted.dom.observers).toBe(0);expect(result.mounted.dom.continuations).toBe(0);expect(result.mounted.selection).toEqual({bookmarks:0,restoreTickets:0,activePointers:0,animationFrames:0});
      expect(result.mounted.clipboard).toEqual({pending:0,continuations:0,retainedTextBytes:0});for(const key of ['sessions','listeners','queued_mutations','queued_bytes','pending_tickets','host_requests','task_continuations'])expect(result.mounted.sdk[key]).toBe(0);
      expect(result.mounted.hostRequests).toEqual({pending:0,focusContinuations:0});
    }
    if(record.cleanup.length)expect(record.cleanup.at(-1).native).toEqual({sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});
    record.policy=await page.evaluate(()=>window.uiPolicy);expect(record.errors).toEqual([]);expect(record.externalRequests).toEqual([]);expect(record.policy).toEqual([]);
  }finally{
    record.status=info.status;mkdirSync('artifacts/ui',{recursive:true});const path=`artifacts/ui/${info.project.name}-controls-${info.testId.replaceAll(/[^a-zA-Z0-9_-]/g,'_')}.json`;
    writeFileSync(path,JSON.stringify(record,null,2)+'\n');await info.attach('ui-controls-observations',{path,contentType:'application/json'});
  }
});

test('K01: one roving toolbar stop, arrows/Home/End, Tab exit and keyed controls preserve native state',async({page})=>{
  const id=await mounted(page,{case:'V01-forward'}),bold=control(page,id,'strong'),italic=control(page,id,'emphasis');
  await editorFocus(page,id);const before=await checkpoint(page,id,'before keyboard navigation');
  await bold.evaluate(node=>window.uiControlIdentity=node);
  await page.keyboard.press('Shift+Tab');await expect(bold).toBeFocused();await page.keyboard.press('ArrowRight');await expect(italic).toBeFocused();
  await page.keyboard.press('Home');await expect(bold).toBeFocused();await page.keyboard.press('End');await expect(italic).toBeFocused();await page.keyboard.press('ArrowLeft');await expect(bold).toBeFocused();
  expect(await root(page,id).getByRole('toolbar').locator('button[tabindex="0"]').count()).toBe(1);
  await call(page,'refresh',id);await expect.poll(()=>bold.evaluate(node=>node===window.uiControlIdentity)).toBe(true);await expect(bold).toBeFocused();
  await page.keyboard.press('Tab');await expect(page.locator(`#${id}-editor`)).toBeFocused();
  const after=await checkpoint(page,id,'after navigation only');unchanged(after,before);expect(submitted(after)).toHaveLength(0);
});

for(const locale of ['ru','en'])test(`L01 ${locale}: localized labels, 32px targets and 200% layout retain visible focus`,async({page})=>{
  await page.setViewportSize({width:640,height:768});const id=await mounted(page,{case:'V01-forward',locale});
  const toolbar=root(page,id).getByRole('toolbar'),bold=control(page,id,'strong');await expect(toolbar).toHaveAccessibleName(locale==='ru'?'Форматирование текста':'Text formatting');
  await expect(bold).toHaveAccessibleName(locale==='ru'?'Полужирный':'Bold');await expect(add(page,id)).toHaveAccessibleName(locale==='ru'?'Добавить блок':'Add block');
  await page.evaluate(()=>document.documentElement.style.zoom='2');await editorFocus(page,id);await page.keyboard.press('Shift+Tab');await expect(bold).toBeFocused();
  const geometry=await root(page,id).evaluate(node=>({buttons:[...node.querySelectorAll('.kw-ui-button')].map(button=>{const style=getComputedStyle(button),r=button.getBoundingClientRect();return {width:parseFloat(style.minWidth),height:parseFloat(style.minHeight),visible:r.width>0&&r.height>0,clipped:button.scrollWidth>button.clientWidth+1};}),
    focus:(()=>{const s=getComputedStyle(document.activeElement);return {style:s.outlineStyle,width:parseFloat(s.outlineWidth)};})(),toolbar:{scroll:node.querySelector('[role=toolbar]').scrollWidth,client:node.querySelector('[role=toolbar]').clientWidth,wrap:getComputedStyle(node.querySelector('[role=toolbar]')).flexWrap}}));
  for(const button of geometry.buttons){expect(button.width).toBeGreaterThanOrEqual(32);expect(button.height).toBeGreaterThanOrEqual(32);expect(button.visible).toBe(true);expect(button.clipped).toBe(false);}
  expect(geometry.focus.style).not.toBe('none');expect(geometry.focus.width).toBeGreaterThanOrEqual(2);expect(geometry.toolbar.wrap).toBe('wrap');expect(geometry.toolbar.scroll).toBeLessThanOrEqual(geometry.toolbar.client+1);
  await call(page,'locale',id,locale==='ru'?'en':'ru');await expect(bold).toHaveAccessibleName(locale==='ru'?'Bold':'Полужирный');expect(submitted(await checkpoint(page,id,'locale and layout are presentation only'))).toHaveLength(0);
});

for(const direction of ['forward','reverse'])for(const method of ['pointer','keyboard'])test(`T01 ${direction} ${method}: mixed Strong exact native document/range, one unit and undo`,async({page})=>{
  const item=literals.get(`V01-${direction}`),id=await mounted(page,{case:item.id}),bold=control(page,id,'strong');await expect(bold).toHaveAttribute('aria-pressed','mixed');
  const before=await checkpoint(page,id,'mixed selection before action');await activate(page,id,'strong',method);await waitSubmissions(page,id,1);await expect(bold).toHaveAttribute('aria-pressed','true');
  const after=await checkpoint(page,id,'Strong actual native completion');nativeChanged(after,before,item);expect(after.state.selection).toEqual(selection(before.roles,item.expected.selection));expect(idsAt(after)).toEqual(idsAt(before));
  expect(after.focusResults.at(-1)).toEqual({status:'restored',failure:null});expect(after.insideEditor).toBe(true);await nativeUndoRedo(page,id,item,before,after);
});

test('T02: collapsed Strong twice changes only native stored marks and preserves zero undo entries',async({page})=>{
  const item=literals.get('V02-collapsed-twice'),id=await mounted(page,{case:item.id});const initial=await checkpoint(page,id,'collapsed baseline');
  for(const [index,step]of item.expected.steps.entries()){
    const before=await checkpoint(page,id,`before collapsed toggle ${index+1}`);await activate(page,id,'strong');await waitSubmissions(page,id,index+1);
    const after=await checkpoint(page,id,`native collapsed toggle ${index+1}`);expect(after.canonical).toBe(item.expected.canonical_json);expect(after.state.selection).toEqual(initial.state.selection);expect(after.state.stored_marks).toEqual(step.stored_marks);
    expect(after.state.stamp.revision).toBe(before.state.stamp.revision);expect(BigInt(after.state.stamp.selection_epoch)-BigInt(before.state.stamp.selection_epoch)).toBe(1n);expect(after.state.history.undo_entries).toBe('0');expect(after.state.history.redo_entries).toBe('0');expect(after.state.dirty).toBe(false);
    expect(documentEvents(after)).toHaveLength(0);expect(stateEvents(after).length-stateEvents(before).length).toBe(1);expect(idsAt(after)).toEqual(idsAt(initial));await expect(control(page,id,'strong')).toHaveAttribute('aria-pressed',index===0?'true':'false');
  }
});

for(const caseId of ['V03-root-gap','V07-text-caret'])test(`A01/A02 ${caseId}: Add Paragraph preserves authored target, literal IDs/caret and one command`,async({page})=>{
  const item=literals.get(caseId),id=await mounted(page,{case:caseId}),before=await checkpoint(page,id,'before Add');await add(page,id).click();const listbox=root(page,id).getByRole('listbox');await expect(listbox).toBeVisible();
  await expect(control(page,id,'paragraph')).toBeFocused();await page.keyboard.press('Enter');await waitSubmissions(page,id,1);await call(page,'bindAfter',id,item.expected.roles);
  const after=await checkpoint(page,id,'paragraph native result');nativeChanged(after,before,item);expect(after.state.selection).toEqual(selection(after.roles,item.expected.selection));
  expect(stateEvents(after).length-stateEvents(before).length).toBe(0);for(const name of item.expected.created)expect(idsAt(before)).not.toContain(after.roles[name]);
  expect(after.focusResults.at(-1)).toEqual({status:'restored',failure:null});await expect(listbox).toBeHidden();await nativeUndoRedo(page,id,item,before,after);
});

test('A03: Add Escape restores exact native range; unavailable insertion stays discoverable without a ticket',async({page})=>{
  const id=await mounted(page,{case:'V03-root-gap'});await editorFocus(page,id);const before=await checkpoint(page,id,'before dismissed Add');await add(page,id).click();await page.keyboard.press('Escape');
  const after=await checkpoint(page,id,'dismissed Add');unchanged(after,before);expect(after.insideEditor).toBe(true);expect(submitted(after)).toHaveLength(0);expect(after.uiResources.hostRequests).toBe(0);
  await add(page,id).click();const table=control(page,id,'table');await expect(table).toHaveAttribute('aria-disabled','true');await table.focus();await expect(table).toBeFocused();await page.keyboard.press('Enter');
  const refused=await checkpoint(page,id,'unsupported table entry');expect(refused.canonical).toBe(before.canonical);expect(submitted(refused)).toHaveLength(0);expect(documentEvents(refused)).toHaveLength(0);
});

for(const [caseId,choice,key]of [['V04-up','up','ArrowUp'],['V04-down','down','ArrowDown']])for(const method of ['menu','shortcut'])test(`M01 ${caseId} ${method}: exact pre-removal native destination and stable move control`,async({page})=>{
  const item=literals.get(caseId),id=await mounted(page,{case:caseId}),before=await checkpoint(page,id,'before same-parent move');await move(page,id).evaluate(node=>window.uiMoveIdentity=node);
  if(method==='menu'){await move(page,id).click();await control(page,id,choice).click();}else {await editorFocus(page,id);await page.keyboard.press('Tab');await expect(move(page,id)).toBeFocused();await page.keyboard.press(`Alt+${key}`);}
  await waitSubmissions(page,id,1);await call(page,'bindAfter',id,item.expected.roles);const after=await checkpoint(page,id,'native move result');nativeChanged(after,before,item);expect(after.state.selection).toEqual(before.state.selection);expect(idsAt(after)).toEqual(idsAt(before));
  expect(await move(page,id).evaluate(node=>node===window.uiMoveIdentity)).toBe(true);await expect(move(page,id)).toBeFocused();await expect(root(page,id).getByRole('status')).toContainText(`position ${item.expected.roles.B.at(-1)+1}`);await nativeUndoRedo(page,id,item,before,after);
});

for(const [caseId,choice]of [['N01','nest'],['N02','unnest'],['N03','unnest'],['N08','nest']])test(`M02 ${caseId}: explicit ${choice} queries real native legality and preserves exact structure`,async({page})=>{
  const item=literals.get(caseId),id=await mounted(page,{case:caseId}),before=await checkpoint(page,id,'before nesting menu');
  if(caseId==='N01'||caseId==='N02'){
    const context=root(page,id).locator('.kw-ui-context');await expect(context).toHaveText(`Block 2: Text block — Document${caseId==='N02'?' / Container':''}`);
    const contextId=await context.getAttribute('id');expect(contextId).toBeTruthy();expect((await move(page,id).getAttribute('aria-describedby')).split(' ')).toContain(contextId);
  }
  await move(page,id).click();const target=control(page,id,choice);
  if(caseId==='N01'||caseId==='N02')expect((await root(page,id).getByRole('menu').getAttribute('aria-describedby')).split(' ')).toContain(await root(page,id).locator('.kw-ui-context').getAttribute('id'));
  if(item.expected.command.response_status==='refused'){
    await expect(target).toHaveAttribute('aria-disabled','true');await target.focus();await page.keyboard.press('Enter');const after=await checkpoint(page,id,'native query refused before semantic execution');unchanged(after,before);expect(submitted(after)).toHaveLength(0);await expect(root(page,id).getByRole('status')).toContainText(item.expected.command.diagnostic.code);
  }else{
    await target.click();await waitSubmissions(page,id,1);await call(page,'bindAfter',id,rolePaths(item.roles_after));const after=await checkpoint(page,id,'native nesting result');nativeChanged(after,before,item);expect(after.state.selection).toEqual(selection(after.roles,item.expected.command.selection));expect(idsAt(after)).toEqual(idsAt(before));
    await expect(root(page,id).locator('.kw-ui-context')).toHaveText(`Block 2: Text block — Document${caseId==='N01'?' / Container':''}`);await nativeUndoRedo(page,id,item,before,after);
  }
});

test('M03: local move shortcuts leave editor/global keyboard default untouched',async({page})=>{
  const id=await mounted(page,{case:'V04-up'});await editorFocus(page,id);const before=await checkpoint(page,id,'before editor-local unrelated shortcuts');
  const observations=await page.locator(`#${id}-editor`).evaluate(node=>{const results=[];for(const init of [{key:'ArrowUp',altKey:true},{key:'f',ctrlKey:true},{key:'f',metaKey:true}]){const event=new KeyboardEvent('keydown',{...init,bubbles:true,cancelable:true});node.dispatchEvent(event);results.push({key:init.key,defaultPrevented:event.defaultPrevented});}return results;});
  expect(observations.every(value=>!value.defaultPrevented)).toBe(true);unchanged(await checkpoint(page,id,'no global capture'),before);expect(submitted(await call(page,'inspect',id))).toHaveLength(0);
});

test('H01: real Notes modal is named and traps focus; Escape restores original exact range with no transaction',async({page})=>{
  const id=await mounted(page,{case:'V06-NC011-root-title-owned-metadata'});await editorFocus(page,id);const before=await checkpoint(page,id,'before Notes dialog');await control(page,id,'title').click();
  const dialog=root(page,id).getByRole('dialog');await expect(dialog).toHaveAccessibleName('Block options');await expect(dialog.getByRole('textbox',{name:'Title'})).toBeFocused();
  await page.keyboard.press('Tab');await expect(dialog.getByRole('button',{name:'Apply',exact:true})).toBeFocused();await page.keyboard.press('Tab');await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();await page.keyboard.press('Tab');await expect(dialog.getByRole('textbox')).toBeFocused();
  await page.keyboard.press('Shift+Tab');await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();await page.keyboard.press('Tab');await expect(dialog.getByRole('textbox')).toBeFocused();await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();const after=await checkpoint(page,id,'cancelled host dialog');unchanged(after,before);expect(after.insideEditor).toBe(true);expect(after.dialog.closeReasons).toEqual(['cancelled']);expect(after.uiResources.hostRequests).toBe(0);expect(submitted(after)).toHaveLength(0);
});

for(const caseId of ['V06-NC011-root-title-owned-metadata','V06-NC013-identical-title-noop','V06-NC014-title-257-byte-refusal'])test(`P01 ${caseId}: independent Notes factory keeps actual native success/noop/refusal`,async({page})=>{
  const item=literals.get(caseId),id=await mounted(page,{case:caseId}),before=await checkpoint(page,id,'before Notes title action');await control(page,id,'title').click();const dialog=root(page,id).getByRole('dialog');await dialog.getByRole('textbox').fill(item.command.payload.title);await dialog.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(dialog).toBeHidden();const after=await checkpoint(page,id,'Notes actual outcome');
  if(item.expected.kind==='refused'){
    // UI must honour the real native availability refusal before complete;
    // execution Refused is independently measured in the sealed native lane.
    unchanged(after,before);expect(submitted(after)).toHaveLength(0);expect(after.results.at(-1)).toEqual({status:'ui_refused',code:'ui.unavailable',action:'title'});await expect(root(page,id).getByRole('status')).toContainText(item.expected.code);
  }else if(item.expected.kind==='changed'){
    nativeChanged(after,before,item,{notes:true});expect(after.state.selection).toEqual(before.state.selection);expect(idsAt(after)).toEqual(idsAt(before));await nativeUndoRedo(page,id,item,before,after);
  }else {unchanged(after,before);expect(submitted(after)).toHaveLength(1);expect(submitted(after)[0].response.value.effect).toBe('unchanged');}
  expect(after.dialog.closeReasons).toHaveLength(1);expect(after.uiResources.hostRequests).toBe(0);
});

for(const transition of ['selection','mode','replace'])test(`H02 ${transition}: stale Notes result never dispatches, steals focus or replays`,async({page})=>{
  const id=await mounted(page,{case:'V06-NC011-root-title-owned-metadata'}),before=await checkpoint(page,id,'before stale dialog');await control(page,id,'title').click();
  if(transition==='selection')await call(page,'select',id,{anchor:{kind:'text',node:'T',offset:0,affinity:'after'},focus:{kind:'text',node:'T',offset:0,affinity:'after'}});
  else if(transition==='mode')await call(page,'mode',id,'readOnly');
  else {const source=JSON.parse(before.canonical);source.root.attrs.title='replacement';await call(page,'replace',id,source);}
  await page.locator('#ui-after').focus();const afterTransition=await checkpoint(page,id,'external transition before late host callback');await call(page,'lateAccept',id,0,{title:'late result'});
  const after=await checkpoint(page,id,'late accept ignored');unchanged(after,afterTransition);expect(submitted(after)).toHaveLength(0);await expect(page.locator('#ui-after')).toBeFocused();expect(after.uiResources.hostRequests).toBe(0);expect(after.dialog.closeReasons).toHaveLength(1);
});

for(const mode of ['readOnly','disabled'])test(`R01 ${mode}: mutation controls explain native mode and never consume an action`,async({page})=>{
  const id=await mounted(page,{case:'V01-forward'});await call(page,'mode',id,mode);await expect(control(page,id,'strong')).toHaveAttribute('aria-disabled','true');await expect(add(page,id)).toHaveAttribute('aria-disabled','true');const before=await checkpoint(page,id,'blocked mode baseline');await control(page,id,'strong').click({force:true});await add(page,id).click({force:true});
  const after=await checkpoint(page,id,'blocked controls');unchanged(after,before);expect(submitted(after)).toHaveLength(0);await expect(root(page,id).getByRole('status')).not.toBeEmpty();
  await call(page,'mode',id,'editable');await expect(control(page,id,'strong')).toHaveAttribute('aria-disabled','false');await control(page,id,'strong').click();await waitSubmissions(page,id,1);
});

test('C01: controlled composition lock preserves provisional objects/focus; only a fresh action after terminal may submit',async({page})=>{
  const id=await mounted(page,{case:'V02-collapsed-twice'});await editorFocus(page,id);const before=await checkpoint(page,id,'before controlled composition');
  await page.locator(`#${id}-editor`).evaluate(node=>{window.uiCompositionChildren=[...node.childNodes];node.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));});
  await expect(control(page,id,'strong')).toHaveAttribute('aria-disabled','true');await control(page,id,'strong').click({force:true});
  expect(await page.locator(`#${id}-editor`).evaluate(node=>node.contains(document.activeElement)&&node.childNodes.length===window.uiCompositionChildren.length&&[...node.childNodes].every((child,index)=>child===window.uiCompositionChildren[index]))).toBe(true);
  await page.locator(`#${id}-editor`).evaluate(node=>node.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:''})));
  await expect(control(page,id,'strong')).toHaveAttribute('aria-disabled','false');const settled=await checkpoint(page,id,'unchanged controlled composition settled');expect(settled.canonical).toBe(before.canonical);expect(settled.state.stamp.revision).toBe(before.state.stamp.revision);expect(submitted(settled)).toHaveLength(0);
  await control(page,id,'strong').click();await waitSubmissions(page,id,1);expect((await checkpoint(page,id,'fresh gesture after terminal')).state.stored_marks).toEqual([{type_id:'org.klenwriter.kwdj/strong',attributes:{}}]);
});

// Append to tests/ui-controls-browser.spec.js AFTER committing the additive
// pointer contract. Reuses that file's actual SDK/WASM/CSP/resource helpers.
// Controlled lifecycle and pointer-event order; never physical/OS IME evidence.
const pg42 = JSON.parse(readFileSync('contracts/ui/v1.1/pointer-gesture-cases.json'));
const pg42Manifest = JSON.parse(readFileSync('contracts/ui/v1.1/pointer-gesture-manifest.json'));
for (const pin of pg42Manifest.files)
  expect(receiptHash(readFileSync(`contracts/ui/v1.1/${pin.path}`))).toBe(pin.sha256);
expect(receiptHash(readFileSync(pg42.geometry.path))).toBe(pg42.geometry.sha256);
const pg42Commands = async(page,id)=>(await call(page,'nativeTrace',id)).calls
  .map(row=>({request:JSON.parse(row.requestJson),response:JSON.parse(row.responseJson)}))
  .filter(row=>row.request.kind==='command');
async function pg42RejectedThenSettled(page){
  const id=await mounted(page,{geometry:'F',nativeTrace:true});await editorFocus(page,id);
  const before=await checkpoint(page,id,'PG independent F before controlled composition');
  expect(before.canonical).toBe(pg42.geometry.inputCanonical);
  const editor=page.locator(`#${id}-editor`),button=control(page,id,'strong');
  await editor.evaluate(node=>node.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''})));
  await expect(button).toHaveAttribute('aria-disabled','true');
  const down=await button.evaluate(node=>{const event=new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,buttons:1,pointerId:73,pointerType:'mouse',isPrimary:true,detail:1});node.dispatchEvent(event);return {prevented:event.defaultPrevented,trusted:event.isTrusted};});
  expect(down).toEqual({prevented:true,trusted:false});
  const rejected=await checkpoint(page,id,'PG actual rejected down before terminal');unchanged(rejected,before);expect(submitted(rejected)).toHaveLength(0);
  await editor.evaluate((node,expected)=>{
    const text=node.firstElementChild?.firstElementChild?.firstChild;
    if(!text||text.nodeType!==3||text.data!==expected.textBefore)throw Error('Authored F owned text mismatch');
    node.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,inputType:'insertCompositionText',data:'q',isComposing:true,cancelable:false}));
    text.data=expected.textAfter;node.ownerDocument.getSelection().setBaseAndExtent(text,2,text,2);
    node.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:'q',isComposing:true}));
    node.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'q'}));
  },pg42.controlledSettlement);
  await expect.poll(async()=>(await call(page,'inspect',id)).state.stamp.revision).toBe('1');
  await expect(button).toHaveAttribute('aria-disabled','false');
  const settled=await checkpoint(page,id,'PG source-authored q settled by actual native command');
  const expected=pg42.controlledSettlement;expect(settled.canonical).toBe(expected.canonicalAfter);
  expect(settled.state.selection).toEqual(selection(settled.roles,expected.selectionAfter));expect(idsAt(settled)).toEqual(idsAt(before));
  for(const key of ['revision','selection_epoch','history_epoch'])expect(BigInt(settled.state.stamp[key])-BigInt(before.state.stamp[key])).toBe(BigInt(expected.stampDelta[key]));
  expect(documentEvents(settled).length-documentEvents(before).length).toBe(1);expect(stateEvents(settled).length-stateEvents(before).length).toBe(0);
  expect(settled.state.history.undo_entries).toBe('1');expect(settled.state.history.redo_entries).toBe('0');expect(settled.state.stored_marks).toBe(null);expect(submitted(settled)).toHaveLength(0);
  const commands=await pg42Commands(page,id);expect(commands).toHaveLength(1);expect(commands[0].request.command.id).toBe(expected.nativeCommandId);expect(JSON.parse(commands[0].request.command.payload_json)).toEqual(expected.nativePayload);expect(commands[0].response.status).toBe('ok');
  return {id,button,before,settled};
}
async function pg42AssertStrong(page,id,settled){
  await waitSubmissions(page,id,1);const value=await checkpoint(page,id,'PG fresh independent activation');
  expect(value.canonical).toBe(pg42.controlledSettlement.canonicalAfter);expect(idsAt(value)).toEqual(idsAt(settled));
  expect(value.state.stored_marks).toEqual([{type_id:'org.klenwriter.kwdj/strong',attributes:{}}]);
  expect(value.state.stamp.revision).toBe(settled.state.stamp.revision);expect(value.state.stamp.history_epoch).toBe(settled.state.stamp.history_epoch);
  expect(value.state.stamp.selection_epoch).toBe(String(BigInt(settled.state.stamp.selection_epoch)+1n));expect(value.state.history).toEqual(settled.state.history);
  expect((await pg42Commands(page,id)).map(row=>row.request.command.id)).toEqual(['org.klenwriter.kwdj/command/insert-text','org.klenwriter.kwdj/command/toggle-mark']);
}
test('PG01 controlled rejected down cannot replay as an enabled click after actual native settlement',async({page})=>{
  const {id,button,settled}=await pg42RejectedThenSettled(page);
  await button.evaluate(node=>{for(const type of ['pointerup','click'])node.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,button:0,buttons:0,pointerId:73,pointerType:'mouse',isPrimary:true,detail:1}));});
  const after=await checkpoint(page,id,'PG same rejected gesture consumed without action');unchanged(after,settled);expect(submitted(after)).toHaveLength(0);expect(await pg42Commands(page,id)).toHaveLength(1);expect(after.activeId).toBe(settled.activeId);
  // A duplicate positive-detail click has no new admitted down either.
  await button.evaluate(node=>node.dispatchEvent(new PointerEvent('click',{bubbles:true,cancelable:true,button:0,pointerId:73,pointerType:'mouse',isPrimary:true,detail:1})));
  unchanged(await checkpoint(page,id,'PG duplicate click cannot revive consumed rejection'),settled);
  await button.click();await pg42AssertStrong(page,id,settled);
});
for(const method of ['fresh-pointer','Enter','Space','detail0'])test(`PG02-05 controlled ${method} remains a new independent activation after rejected down`,async({page})=>{
  const {id,button,settled}=await pg42RejectedThenSettled(page);
  if(method==='fresh-pointer')await button.click();
  else if(method==='detail0')await button.evaluate(node=>node.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:0})));
  else {await editorFocus(page,id);await page.keyboard.press('Shift+Tab');await expect(button).toBeFocused();await page.keyboard.press(method==='Space'?'Space':'Enter');}
  await pg42AssertStrong(page,id,settled);
});

// Draft additive fragment for tests/ui-controls-browser.spec.js after root freeze.
// Uses its existing helpers/beforeEach/afterEach; do not replace existing cases.
const pg06Path='contracts/ui/v1.1/pointer-capture-continuity-cases.json';
const pg06Bytes=readFileSync(pg06Path),pg06=JSON.parse(pg06Bytes),pg06Case=pg06.cases[0];
const pg06PayloadRows=value=>value.rows.map(({path,node:{stamp,...node}})=>({path,node}));
const pg06MutationRows=async(page,id)=>(await call(page,'nativeTrace',id)).calls
  .map(row=>({request:JSON.parse(row.requestJson),response:JSON.parse(row.responseJson)}))
  .filter(row=>['set_selection','command','history'].includes(row.request.kind));

test('PG06 controlled admitted down cannot recapture after explicit host selection invalidates its original request',async({page})=>{
  records.get(page).frozen.push({path:pg06Path,bytes:pg06Bytes.length,sha256:receiptHash(pg06Bytes)});
  const id=await mounted(page,{geometry:'F',nativeTrace:true});await editorFocus(page,id);
  const button=control(page,id,'strong'),before=await checkpoint(page,id,'PG06 independent frozen F input');
  expect(before.canonical).toBe(pg06.geometry.inputCanonical);expect(before.state.selection).toEqual(selection(before.roles,pg06.geometry.inputSelection));
  expect(before.state.stored_marks).toBe(null);expect(before.state.history.undo_entries).toBe('0');expect(before.state.history.redo_entries).toBe('0');
  expect(before.state.dirty).toBe(false);expect(before.state.saved_revision).toBe('0');expect(before.uiResources.hostRequests).toBe(0);
  await expect(button).toHaveAttribute('aria-disabled','false');
  const down=await button.evaluate(node=>{const event=new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,buttons:1,pointerId:83,pointerType:'mouse',isPrimary:true,detail:1});node.dispatchEvent(event);return {prevented:event.defaultPrevented,trusted:event.isTrusted};});
  expect(down).toEqual({prevented:false,trusted:false});
  const captured=await checkpoint(page,id,'PG06 actual admitted controlled down, genuine request retained');unchanged(captured,before);
  expect(captured.uiResources.hostRequests).toBe(1);expect(captured.resources.hostRequests.pending).toBe(1);
  expect(captured.resources.selection.bookmarks).toBe(1);expect(captured.resources.sdk.host_requests).toBe(1);expect(submitted(captured)).toHaveLength(0);
  const mutationsBefore=await pg06MutationRows(page,id);
  const selected=await call(page,'select',id,pg06Case.hostSelection);expect(selected.response.status).toBe('ok');
  await call(page,'refresh',id);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const host=await checkpoint(page,id,'PG06 independently asserted host T0 selection and old request release');
  expect(host.canonical).toBe(pg06.geometry.inputCanonical);expect(host.state.selection).toEqual(selection(host.roles,pg06Case.hostSelection));
  expect(idsAt(host)).toEqual(idsAt(before));expect(pg06PayloadRows(host)).toEqual(pg06PayloadRows(before));for(const row of host.rows)expect(row.node.stamp).toEqual(host.state.stamp);
  expect(host.context).toEqual(before.context);expect(host.state.stamp.session).toBe(before.state.stamp.session);expect(host.state.stamp.generation).toBe(before.state.stamp.generation);
  for(const key of ['revision','selection_epoch','history_epoch'])expect(BigInt(host.state.stamp[key])-BigInt(before.state.stamp[key])).toBe(BigInt(pg06Case.hostSelectionExpected.stampDelta[key]));
  expect(host.state.stored_marks).toBe(null);expect(host.state.history).toEqual(before.state.history);expect(host.state.dirty).toBe(false);expect(host.state.saved_revision).toBe('0');
  expect(documentEvents(host)).toEqual(documentEvents(before));expect(stateEvents(host).length-stateEvents(before).length).toBe(1);expect(stateEvents(host).at(-1).change).toEqual(pg06Case.hostSelectionExpected.eventFlags);
  expect(host.uiResources.hostRequests).toBe(0);expect(host.resources.hostRequests.pending).toBe(0);expect(host.resources.selection.bookmarks).toBe(0);expect(host.resources.sdk.host_requests).toBe(0);expect(submitted(host)).toHaveLength(0);
  const hostMutations=await pg06MutationRows(page,id);expect(hostMutations).toHaveLength(mutationsBefore.length+1);expect(hostMutations.slice(0,-1)).toEqual(mutationsBefore);expect(hostMutations.at(-1).request.kind).toBe('set_selection');expect(hostMutations.at(-1).request.selection).toEqual(selection(host.roles,pg06Case.hostSelection));
  expect(await pg42Commands(page,id)).toHaveLength(0);
  await button.evaluate(node=>{for(const type of ['pointerup','click'])node.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,button:0,buttons:0,pointerId:83,pointerType:'mouse',isPrimary:true,detail:1}));});
  const after=await checkpoint(page,id,'PG06 same admitted-but-invalidated gesture consumed without recapture');unchanged(after,host);expect(after.context).toEqual(host.context);expect(after.activeId).toBe(host.activeId);
  expect(submitted(after)).toHaveLength(0);expect(await pg06MutationRows(page,id)).toEqual(hostMutations);expect(await pg42Commands(page,id)).toHaveLength(0);
  expect(after.uiResources.hostRequests).toBe(0);expect(after.resources.hostRequests.pending).toBe(0);expect(after.resources.selection.bookmarks).toBe(0);expect(after.resources.sdk.host_requests).toBe(0);
  // A later new pointerdown/click has independent authority at the host's T0.
  await button.click();await waitSubmissions(page,id,1);const fresh=await checkpoint(page,id,'PG06 later fresh gesture may ordinarily toggle Strong at T0');
  expect(fresh.canonical).toBe(pg06.geometry.inputCanonical);expect(fresh.state.selection).toEqual(selection(fresh.roles,pg06Case.hostSelection));expect(idsAt(fresh)).toEqual(idsAt(host));expect(pg06PayloadRows(fresh)).toEqual(pg06PayloadRows(host));
  for(const key of ['revision','selection_epoch','history_epoch'])expect(BigInt(fresh.state.stamp[key])-BigInt(host.state.stamp[key])).toBe(BigInt(pg06Case.freshGestureExpected.stampDelta[key]));
  expect(fresh.state.stored_marks).toEqual(pg06Case.freshGestureExpected.storedMarks);expect(fresh.state.history).toEqual(host.state.history);expect(fresh.state.dirty).toBe(false);expect(fresh.state.saved_revision).toBe('0');
  expect(documentEvents(fresh)).toEqual(documentEvents(host));expect(stateEvents(fresh).length-stateEvents(host).length).toBe(1);expect(submitted(fresh)).toHaveLength(1);expect(submitted(fresh)[0].response.status).toBe('ok');
  const commands=await pg42Commands(page,id);expect(commands).toHaveLength(1);expect(commands[0].request.command.id).toBe(pg06Case.freshGestureExpected.nativeCommandId);expect(JSON.parse(commands[0].request.command.payload_json)).toEqual(pg06Case.freshGestureExpected.nativePayload);expect(commands[0].response.status).toBe('ok');
});

// Additive source draft for tests/ui-controls-browser.spec.js; retain all old cases.
const rlPath='contracts/ui/v1.1/reason-layout-cases.json',rlBytes=readFileSync(rlPath),rl=JSON.parse(rlBytes);
async function rlFrames(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function rlRaw(page,id){return page.evaluate(id=>{
  const wrapper=document.getElementById(id),editor=document.getElementById(`${id}-editor`),toolbar=wrapper.querySelector('[role=toolbar]'),add=wrapper.querySelector('[data-editor-ui-control=add]');
  window.rlObjects??=new WeakMap();window.rlSerial??=0;const token=node=>{if(!node)return null;if(!window.rlObjects.has(node))window.rlObjects.set(node,++window.rlSerial);return window.rlObjects.get(node);};
  const rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
  const walker=document.createTreeWalker(editor,NodeFilter.SHOW_ALL),objects=[];for(let n=walker.currentNode;n;n=walker.nextNode()){if(objects.length>=128)throw Error('Finite frozen F objects');objects.push(token(n));}
  const ancestors=[];for(let n=editor;n;n=n.parentElement){if(ancestors.length>=64)throw Error('Finite fixture scroll ancestry');ancestors.push({object:token(n),x:n.scrollLeft,y:n.scrollTop});}
  const s=document.getSelection();return {toolbarAllocatedHeight:toolbar.offsetHeight,toolbarAllocatedWidth:toolbar.offsetWidth,toolbarSlotHeight:toolbar.parentElement.getBoundingClientRect().height,
    editorRect:rect(editor),addRect:rect(add),editorHtml:editor.outerHTML,objects,active:token(document.activeElement),selection:s?{rangeCount:s.rangeCount,anchor:token(s.anchorNode),anchorOffset:s.anchorOffset,focus:token(s.focusNode),focusOffset:s.focusOffset}:null,
    scroll:{window:[scrollX,scrollY],ancestors},buttons:[...toolbar.querySelectorAll('button')].map(n=>({object:token(n),parent:token(n.parentNode),key:n.dataset.editorUiAction,label:n.textContent})),addObject:token(add),status:wrapper.querySelector('[role=status]').textContent};
},id);}
function rlNear(after,before){expect(Math.abs(after-before)).toBeLessThanOrEqual(rl.toleranceCssPx);}
function rlFlow(after,before){for(const key of ['toolbarAllocatedHeight','toolbarAllocatedWidth','toolbarSlotHeight'])rlNear(after[key],before[key]);for(const role of ['editorRect','addRect'])for(const key of ['x','y','width','height'])rlNear(after[role][key],before[role][key]);}
function rlBrowser(after,before,{focus=true}={}){for(const key of ['editorHtml','objects','selection','scroll','buttons','addObject'])expect(after[key],key).toEqual(before[key]);if(focus)expect(after.active).toBe(before.active);}
async function rlReason(page,button,expected){
  const ids=(await button.getAttribute('aria-describedby')).split(/\s+/),reason=page.locator(`[id="${ids[0]}"]`);expect(await reason.textContent()).toBe(expected);await expect(reason).toBeVisible();
  const paint=await reason.evaluate(node=>{const s=getComputedStyle(node),r=document.createRange();r.selectNodeContents(node);return {visibility:s.visibility,opacity:s.opacity,pointerEvents:s.pointerEvents,position:s.position,viewport:{width:innerWidth,height:innerHeight},scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,scrollHeight:node.scrollHeight,clientHeight:node.clientHeight,fragments:[...r.getClientRects()].map(r=>({x:r.x,y:r.y,width:r.width,height:r.height}))};});
  expect(paint.visibility).toBe('visible');expect(Number(paint.opacity)).toBeGreaterThan(0);expect(paint.pointerEvents).toBe('none');expect(paint.scrollWidth).toBeLessThanOrEqual(paint.clientWidth+1);expect(paint.scrollHeight).toBeLessThanOrEqual(paint.clientHeight+1);expect(paint.fragments.length).toBeGreaterThan(0);
  for(const r of paint.fragments){expect(r.x).toBeGreaterThanOrEqual(-rl.toleranceCssPx);expect(r.y).toBeGreaterThanOrEqual(-rl.toleranceCssPx);expect(r.x+r.width).toBeLessThanOrEqual(paint.viewport.width+rl.toleranceCssPx);expect(r.y+r.height).toBeLessThanOrEqual(paint.viewport.height+rl.toleranceCssPx);}return {reason,paint};
}
for(const variant of rl.variants)test(`RL01 ${variant.locale} ${variant.layoutScale*100}%: availability reasons preserve flow and fixed Add gesture while remaining visible`,async({page})=>{
  records.get(page).frozen.push({path:rlPath,bytes:rlBytes.length,sha256:receiptHash(rlBytes)});await page.setViewportSize(variant.viewport);
  const id=await mounted(page,{geometry:'F',locale:variant.locale,nativeTrace:true});await editorFocus(page,id);if(variant.layoutScale===2)await page.evaluate(()=>{document.documentElement.style.zoom='2';});await call(page,'refresh',id);await rlFrames(page);
  const editor=page.locator(`#${id}-editor`),plus=add(page,id),before=await checkpoint(page,id,'RL01 independent F after explicit viewport/layout-scale setup'),a=await rlRaw(page,id);
  expect(before.canonical).toBe(rl.fixture.canonical);expect(before.state.selection).toEqual(selection(before.roles,rl.fixture.selection));expect(before.state.stored_marks).toBe(null);expect(before.state.history.undo_entries).toBe('0');expect(before.state.history.redo_entries).toBe('0');
  await editor.evaluate(node=>node.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''})));await expect(plus).toHaveAttribute('aria-disabled','true');await rlFrames(page);
  const locked=await checkpoint(page,id,'RL01 unchanged native protected window; reasons may not allocate flow'),b=await rlRaw(page,id);unchanged(locked,before);expect(locked.context).toEqual(before.context);rlBrowser(b,a);rlFlow(b,a);expect(submitted(locked)).toHaveLength(0);
  const point={x:b.addRect.x+b.addRect.width/2,y:b.addRect.y+b.addRect.height/2};await page.mouse.move(point.x,point.y);await rlReason(page,plus,rl.composingReason[variant.locale]);await rlFrames(page);
  const hover=await checkpoint(page,id,'RL01 visible hovered reason is presentation only'),c=await rlRaw(page,id);unchanged(hover,before);rlBrowser(c,b);rlFlow(c,a);
  await page.evaluate(id=>{const add=document.querySelector(`#${id} [data-editor-ui-control=add]`);window.rlAdd=add;window.rlEvents=[];for(const name of ['pointerdown','pointerup','click'])document.addEventListener(name,event=>{if(window.rlEvents.length>=8)throw Error('Finite RL pointer trace');window.rlEvents.push({event:name,sameAdd:event.target===window.rlAdd,prevented:event.defaultPrevented,trusted:event.isTrusted});},{once:true});},id);
  await page.mouse.down();const down=await checkpoint(page,id,'RL01 rejected Add down retains protected native/browser input'),d=await rlRaw(page,id);unchanged(down,before);rlBrowser(d,c);rlFlow(d,a);
  await editor.evaluate(node=>node.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:''})));await expect(plus).toHaveAttribute('aria-disabled','false');await rlFrames(page);
  const settled=await checkpoint(page,id,'RL01 empty terminal: no native InsertText or other semantic work'),e=await rlRaw(page,id);unchanged(settled,before);expect(settled.context).toEqual(before.context);rlBrowser(e,d);rlFlow(e,a);
  expect(await page.evaluate(point=>document.elementFromPoint(point.x,point.y)===window.rlAdd,point)).toBe(true);await page.mouse.up();await rlFrames(page);
  const up=await checkpoint(page,id,'RL01 same browser-protocol coordinate remains exact Add; no replay'),f=await rlRaw(page,id);unchanged(up,before);rlBrowser(f,e);rlFlow(f,a);expect(submitted(up)).toHaveLength(0);expect(await pg42Commands(page,id)).toHaveLength(0);expect(await root(page,id).getByRole('listbox').count()).toBe(0);
  expect(await page.evaluate(()=>window.rlEvents.map(e=>({event:e.event,sameAdd:e.sameAdd})))).toEqual([{event:'pointerdown',sameAdd:true},{event:'pointerup',sameAdd:true},{event:'click',sameAdd:true}]);
  // Explicit noncomposing readonly/focus setup: focus priority, full description,
  // and a real floating gutter retain their own scroll bounds. No native edit.
  await call(page,'mode',id,'readonly');await rlFrames(page);
  const modeBase=await checkpoint(page,id,'RL01 explicit readonly setup at the SAME variant scale');unchanged(modeBase,before);
  const bold=control(page,id,'strong'),italic=control(page,id,'emphasis');await bold.focus();await italic.hover();await rlReason(page,bold,rl.modeReason[variant.locale]);
  const otherId=(await italic.getAttribute('aria-describedby')).split(/\s+/)[0];await expect(page.locator(`[id="${otherId}"]`)).not.toBeVisible();
  // Separate ordinary geometry setup for the fixed-gutter scrollport branch.
  // The full focused reason above was already verified at the variant's200%.
  if(variant.layoutScale===2)await page.evaluate(()=>{document.documentElement.style.zoom='1';});await page.setViewportSize({width:1800,height:1400});await call(page,'refresh',id);await rlFrames(page);
  const gutter=root(page,id).locator('.kw-ui-gutter');expect(await gutter.evaluate(n=>getComputedStyle(n).position)).toBe('fixed');expect(await gutter.evaluate(n=>getComputedStyle(n).overflowY)).toBe('auto');await move(page,id).focus();
  const focused=await rlReason(page,move(page,id),rl.modeReason[variant.locale]);expect(focused.paint.position).toBe('fixed');unchanged(await checkpoint(page,id,'RL01 visible full focus reason without native mutation'),modeBase);
});
