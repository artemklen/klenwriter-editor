// SPDX-License-Identifier: MIT OR Apache-2.0
// Source authored supplemental cases. Never import an old test module.
import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

test.use({trace:'off',screenshot:'off',video:'off'});
const presentationPath='contracts/accessibility/v1/legacy-presentation-cases.json';
const read=path=>{const bytes=readFileSync(path);return {path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};};
const data=JSON.parse(readFileSync(presentationPath,'utf8'));
const nested=JSON.parse(readFileSync('contracts/ui/v1/nesting-oracles.json','utf8'));
const checklist=JSON.parse(readFileSync('contracts/accessibility/v1/checklist.json','utf8'));
const sourcePaths=[presentationPath,'contracts/accessibility/v1/checklist.json','contracts/ui/v1/native-oracles.json','contracts/ui/v1/nesting-oracles.json','contracts/slash/v1/strings.json','spikes/workspace/ui-host.js','scripts/ui-semantic-data.mjs','packages/ui/src/ui.ts','packages/ui/src/slash-owner.ts','packages/ui/src/slash-list.ts','packages/dom/src/popup-presentation.ts','packages/ui/src/strings.ts','crates/bridge/src/lib.rs','crates/bridge/src/convert.rs','crates/engine/src/tree_impact.rs','package-lock.json','playwright.ui.config.js','tests/ui-accessibility-legacy-supplement-browser.spec.js'];
const buildPaths=['artifacts/sdk-native-manifest-v2.json','packages/wasm/src/sdk-build-id.ts','packages/wasm/dist/editor_wasm.js','packages/wasm/dist/editor_wasm_bg.wasm','packages/ui/dist/ui.js','packages/ui/dist/slash-owner.js','packages/ui/dist/style.css'];
const records=new WeakMap();
const call=(page,method,...args)=>page.evaluate(({method,args})=>window.ui42[method](...args),{method,args});
const shell=(page,id)=>page.locator(`#${id}`),surface=(page,id)=>page.locator(`#${id}-editor`);
const trigger=(page,id,key)=>shell(page,id).locator(`[data-editor-ui-control="${key}"]`);
const slashVisual=(page,id)=>shell(page,id).locator('.kw-ui-slash');
const slash=(page,id)=>slashVisual(page,id).locator('[role=listbox]');
const action=(page,id,key)=>shell(page,id).locator(`[data-editor-ui-action="${key}"]`);
const bindSelection=(roles,value)=>({anchor:{...value.anchor,node:roles[value.anchor.node]},focus:{...value.focus,node:roles[value.focus.node]}});
const paths=value=>Object.fromEntries(Object.entries(value).map(([role,v])=>[role,Array.isArray(v)?v:v.kind==='synthetic_root'?[]:v.path]));
const submissions=value=>value.results.filter(row=>row.status==='submitted');
const mutating=new Set(['command','input_command','history','set_selection','set_stored_marks','barrier','acknowledge_snapshot','remount']);
const wire=trace=>trace.calls.map(row=>({...row,request:JSON.parse(row.requestJson),response:row.responseJson===null?null:JSON.parse(row.responseJson)}));
function sameNative(after,before){for(const key of ['canonical','state','rows','events'])expect(after[key],key).toEqual(before[key]);}
async function checkpoint(page,id,label){const value=await call(page,'inspect',id);records.get(page).checkpoints.push({id,label,value});return value;}
async function ax(page,id,label){records.get(page).ax.push({id,label,method:'Playwright ariaSnapshot; full fixture semantic tree',observation:await shell(page,id).ariaSnapshot()});}
async function audit(page,id,label){
  await ax(page,id,label);
  const tags=['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'];
  const result=await new AxeBuilder({page}).include(`#${id}`).withTags(tags).analyze();
  records.get(page).axe.push({id,label,tags,scope:`#${id}`,result,incompleteDisposition:result.incomplete.length?'UNRESOLVED_REQUIRES_EXPLICIT_DISPOSITION':'NONE'});
  expect(result.testEngine.version).toBe('4.14.0');expect(result.violations).toEqual([]);
}
async function mount(page,options){const value=await call(page,'mount',{...options,nativeTrace:true});records.get(page).mounts.push(value.id);expect(value.ready).toBe('ready');expect(value.uiReady).toBe('ready');return value.id;}
async function initialFocus(page,id){await page.bringToFront();const result=await call(page,'editorFocus',id);expect(result.response.status).toBe('ok');await expect(surface(page,id)).toBeFocused();}
async function connectedRelationship(locator,attribute,expectedRole){
  return locator.evaluate((node,{attribute,expectedRole})=>{
    const ids=(node.getAttribute(attribute)??'').trim().split(/\s+/).filter(Boolean);
    return {ids,targets:ids.map(id=>{const target=node.ownerDocument.getElementById(id);return {id,connected:!!target?.isConnected,role:target?.getAttribute('role'),insideFixture:!!target&&node.closest('.ui-fixture')?.contains(target),expectedRole};})};
  },{attribute,expectedRole});
}
async function slashOwnership(page,id,{empty=false}={}){
  const editor=surface(page,id),list=slash(page,id),options=list.getByRole('option');
  await expect(slashVisual(page,id)).toBeVisible();await expect(list).toBeVisible();await expect(list).toHaveAttribute('role','listbox');await expect(editor).toBeFocused();await expect(editor).toHaveAttribute('role','textbox');await expect(editor).toHaveAccessibleName(data.labels[records.get(page).locale].editor);await expect(editor).toHaveAttribute('aria-haspopup','listbox');await expect(editor).not.toHaveAttribute('aria-expanded');
  await expect(trigger(page,id,'add')).toHaveAttribute('aria-expanded','true');
  const owns=await connectedRelationship(editor,'aria-controls','listbox');expect(owns.ids).toHaveLength(1);
  expect(owns.targets).toEqual([{id:await list.getAttribute('id'),connected:true,role:'listbox',insideFixture:true,expectedRole:'listbox'}]);
  if(empty){await expect(options).toHaveCount(0);await expect(editor).not.toHaveAttribute('aria-activedescendant');}
  else {const selected=list.locator('[role=option][aria-selected=true]');await expect(selected).toHaveCount(1);const active=await connectedRelationship(editor,'aria-activedescendant','option');expect(active.targets).toEqual([{id:await selected.getAttribute('id'),connected:true,role:'option',insideFixture:true,expectedRole:'option'}]);}
  records.get(page).ownership.push({id,empty,controls:owns,activeDescendant:await connectedRelationship(editor,'aria-activedescendant','option')});
}
async function slashRetired(page,id,baselineAttributes){
  await expect(slashVisual(page,id)).toBeHidden();await expect(slash(page,id)).toBeHidden();await expect(trigger(page,id,'add')).toHaveAttribute('aria-expanded','false');
  for(const key of ['aria-haspopup','aria-controls','aria-activedescendant'])expect(await surface(page,id).getAttribute(key)).toBe(baselineAttributes[key]);
  await expect(trigger(page,id,'add')).not.toHaveAttribute('aria-controls');
  const value=await checkpoint(page,id,'retired ownership/public resources');expect(value.resources.popupPresentation).toEqual({handles:0});expect(value.resources.hostRequests).toEqual({pending:0,focusContinuations:0});expect(value.uiResources.hostRequests).toBe(0);
}
function zero(result){
  expect(result.ui).toEqual({listeners:0,observers:0,animationFrames:0,subscriptions:0,hostRequests:0,continuations:0,dragGestures:0,pointerCaptures:0});
  expect(result.mounted.selection).toEqual({bookmarks:0,restoreTickets:0,activePointers:0,animationFrames:0});
  expect(result.mounted.hostRequests).toEqual({pending:0,focusContinuations:0});expect(result.mounted.inputObservations).toEqual({subscribers:0});expect(result.mounted.popupPresentation).toEqual({handles:0});
  expect(result.mounted.clipboard).toEqual({pending:0,continuations:0,retainedTextBytes:0});
  expect(result.mounted.dom).toEqual({listeners:0,observers:0,continuations:0,retainedInputBytes:0,retainedRecoveryRegions:0});
  for(const key of ['sessions','listeners','queued_mutations','queued_bytes','pending_tickets','host_requests','task_continuations'])expect(result.mounted.sdk[key],key).toBe(0);
  expect(result.native).toEqual({sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});
}
test.beforeEach(async({page,browser},info)=>{
  const record={status:'RUNNING',qualification:data.scope,engine:info.project.name,browserVersion:browser.version(),locale:null,sourcePins:sourcePaths.map(read),buildPins:buildPaths.map(read),acceptedBase:checklist.acceptedBase,mounts:[],checkpoints:[],ax:[],axe:[],ownership:[],traces:[],errors:[],external:[],cleanup:[]};records.set(page,record);
  page.on('pageerror',error=>record.errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:4174/'))record.external.push(request.url());});
  await page.addInitScript(()=>{window.legacyA66Policy=[];document.addEventListener('securitypolicyviolation',event=>window.legacyA66Policy.push({directive:event.effectiveDirective,blocked:event.blockedURI}));});
  const response=await page.goto('/ui');record.csp=response.headers()['content-security-policy'];expect(record.csp).toContain("default-src 'none'");expect(record.csp).not.toContain("'unsafe-inline'");expect(record.csp).not.toContain("'unsafe-eval'");
  await page.waitForFunction(()=>!!window.ui42,undefined,{timeout:15000});record.moduleManifest=await page.evaluate(()=>window.ui42.moduleManifest);
  expect(record.moduleManifest).toEqual(JSON.parse(readFileSync('artifacts/sdk-native-manifest-v2.json','utf8')));
});
test.afterEach(async({page},info)=>{
  const record=records.get(page);if(!record)return;const failures=[];
  try {
    // Each owner is disposed even if a preceding observation/assertion failed.
    for(const id of record.mounts){
      try{record.traces.push({id,phase:'before disposal',value:await call(page,'nativeTrace',id)});}catch(error){failures.push(String(error));}
      try{const result=await call(page,'destroy',id);record.cleanup.push({id,result});zero(result);expect(await shell(page,id).count()).toBe(0);}catch(error){failures.push(String(error));}
    }
    record.policy=await page.evaluate(()=>window.legacyA66Policy);expect(record.errors).toEqual([]);expect(record.external).toEqual([]);expect(record.policy).toEqual([]);expect(failures).toEqual([]);record.sourcePinsAfter=sourcePaths.map(read);record.buildPinsAfter=buildPaths.map(read);expect(record.sourcePinsAfter).toEqual(record.sourcePins);expect(record.buildPinsAfter).toEqual(record.buildPins);
  } finally {
    record.cleanupFailures=failures;record.testStatus=info.status;
    record.unresolved=record.axe.flatMap(item=>item.result.incomplete.map(check=>({id:item.id,label:item.label,rule:check.id,disposition:'UNRESOLVED_REQUIRES_EXPLICIT_DISPOSITION'})));
    record.status=failures.length||info.status!=='passed'?'FAILED':record.unresolved.length?'UNRESOLVED':'PASSED';
    const directory='artifacts/accessibility/legacy-supplement';mkdirSync(directory,{recursive:true});const path=`${directory}/${info.project.name}-${info.testId.replaceAll(/[^a-zA-Z0-9_-]/g,'_')}.json`;writeFileSync(path,JSON.stringify(record,null,2)+'\n');await info.attach('legacy-accessibility-full-observations',{path,contentType:'application/json'});
  }
});

for(const locale of ['en','ru']){
  const names=data.labels[locale];
  test(`A66-S03 supplement ${locale}: slash connected named ownership and active option retire exactly`,async({page})=>{
    records.get(page).locale=locale;const id=await mount(page,{case:'V07-text-caret',slash:true,locale,source:data.slash.canonical,sourceRoles:data.slash.roles,selection:data.slash.selection});await initialFocus(page,id);
    const initial=await checkpoint(page,id,'initial slash host attributes');await page.keyboard.type('/');const list=slash(page,id);await expect(list).toHaveAccessibleName(names.picker);await expect(list.getByRole('option')).toHaveText(data.slash.options[locale]);await slashOwnership(page,id);
    const before=await checkpoint(page,id,'ordinary slash committed; before menu navigation');await page.keyboard.press('ArrowUp');await expect(list.getByRole('option').last()).toHaveAttribute('aria-selected','true');await slashOwnership(page,id);await page.keyboard.press('ArrowDown');await expect(list.getByRole('option').first()).toHaveAttribute('aria-selected','true');
    sameNative(await checkpoint(page,id,'arrow navigation changes presentation only'),before);await audit(page,id,'named active slash options');await page.keyboard.press('Escape');await slashRetired(page,id,initial.hostAttributes);sameNative(await checkpoint(page,id,'Escape preserves exact slash text/native state'),before);await audit(page,id,'slash closed ownership restored');
  });
  test(`A66-S03 supplement ${locale}: slash no-results is status without active option`,async({page})=>{
    records.get(page).locale=locale;const id=await mount(page,{case:'V07-text-caret',slash:true,locale,source:data.slash.canonical,sourceRoles:data.slash.roles,selection:data.slash.selection});await initialFocus(page,id);const initial=await checkpoint(page,id,'initial no-results attributes');
    await page.keyboard.type('/zzzz');await expect(slash(page,id)).toHaveAccessibleName(names.picker);await expect(slashVisual(page,id).getByRole('status')).toHaveText(names.empty);await slashOwnership(page,id,{empty:true});
    const before=await checkpoint(page,id,'no-results literal committed');expect(before.canonical).toBe(data.slash.noResultsCanonical);await audit(page,id,'no-results full semantics');await page.keyboard.press('Enter');sameNative(await checkpoint(page,id,'empty Enter submits no native action'),before);expect(submissions(await call(page,'inspect',id))).toEqual([]);
    await page.keyboard.press('Escape');await slashRetired(page,id,initial.hostAttributes);sameNative(await checkpoint(page,id,'empty Escape retains exact committed query'),before);
  });
  test(`A66-S03 supplement ${locale}: ordinary Add listbox and Move menu names/options/context/focus`,async({page})=>{
    records.get(page).locale=locale;const id=await mount(page,{case:'N01',locale});await initialFocus(page,id);const before=await checkpoint(page,id,'ordinary controls baseline');
    await page.keyboard.press('Tab');await expect(trigger(page,id,'move')).toBeFocused();await page.keyboard.press('Tab');await expect(trigger(page,id,'drag')).toBeFocused();await page.keyboard.press('Tab');await expect(trigger(page,id,'add')).toBeFocused();await expect(trigger(page,id,'add')).toHaveAccessibleName(names.add);await page.keyboard.press('Enter');
    const list=shell(page,id).getByRole('listbox');await expect(list).toHaveAccessibleName(names.picker);await expect(list).toBeVisible();await expect(trigger(page,id,'add')).toHaveAttribute('aria-expanded','true');await expect(trigger(page,id,'add')).not.toHaveAttribute('aria-controls');await expect(list.getByRole('option')).toHaveText(names.addOptions);await expect(list.getByRole('option').first()).toBeFocused();await audit(page,id,'ordinary Add named listbox/options');
    await page.keyboard.press('ArrowDown');await expect(list.getByRole('option').nth(1)).toBeFocused();await page.keyboard.press('Escape');await expect(list).toBeHidden();await expect(trigger(page,id,'add')).toHaveAttribute('aria-expanded','false');await expect(surface(page,id)).toBeFocused();
    await page.keyboard.press('Tab');await expect(trigger(page,id,'move')).toBeFocused();await expect(trigger(page,id,'move')).toHaveAccessibleName(names.move);await page.keyboard.press('Enter');const menu=shell(page,id).getByRole('menu');await expect(menu).toHaveAccessibleName(names.move);await expect(trigger(page,id,'move')).toHaveAttribute('aria-expanded','true');await expect(trigger(page,id,'move')).not.toHaveAttribute('aria-controls');await expect(menu.getByRole('menuitem')).toHaveText(names.moveOptions);await expect(menu.getByRole('menuitem').first()).toBeFocused();
    const context=shell(page,id).locator('.kw-ui-context'),contextId=await context.getAttribute('id');await expect(context).toHaveText(names.N01Before);for(const owner of [menu,trigger(page,id,'move')]){const related=await connectedRelationship(owner,'aria-describedby',null);expect(related.ids).toContain(contextId);expect(related.targets.every(row=>row.connected&&row.insideFixture)).toBe(true);}
    await audit(page,id,'ordinary Move named menu/context');await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(trigger(page,id,'move')).toHaveAttribute('aria-expanded','false');sameNative(await checkpoint(page,id,'ordinary popup navigation/cancellation preserves native state'),before);expect(submissions(await call(page,'inspect',id))).toEqual([]);
  });
  for(const lane of data.nesting)test(`A66-K06 supplement ${locale} ${lane.id}: native keyboard menu ${lane.choice}, full frozen identities/state/history`,async({page})=>{
    records.get(page).locale=locale;const item=nested.cases.find(row=>row.id===lane.id),id=await mount(page,{case:lane.id,locale});await initialFocus(page,id);const before=await checkpoint(page,id,'single initial setup complete');const traceBase=(await call(page,'nativeTrace',id)).calls.length;
    expect(before.canonical).toBe(item.input_canonical);expect(before.state.stamp).toEqual({session:before.state.stamp.session,generation:before.state.stamp.generation,revision:'0',selection_epoch:'1',history_epoch:'0'});expect(before.state.selection).toEqual(bindSelection(before.roles,item.selection));expect(before.state.stored_marks).toBe(null);expect(before.state.dirty).toBe(false);expect(before.state.saved_revision).toBe('0');expect(before.state.history.undo_entries).toBe('0');expect(before.state.history.redo_entries).toBe('0');expect(before.events).toEqual([]);
    const assertLiteral=(value,expected,step)=>{
      expect(value.canonical).toBe(expected.canonical);expect(value.rows).toHaveLength(Object.keys(item.roles_before).length);expect(new Set(value.rows.map(row=>row.node.id)).size).toBe(value.rows.length);
      for(const [role,path]of Object.entries(paths(expected.roles))){const row=value.rows.find(row=>JSON.stringify(row.path)===JSON.stringify(path));expect(row,role).toBeTruthy();expect(row.node.id,role).toBe(before.roles[role]);const prior=before.rows.find(row=>row.node.id===before.roles[role]);for(const key of ['type_id','primitive','attributes','marks','text'])expect(row.node[key],`${role}.${key}`).toEqual(prior.node[key]);const parent=path.length?value.rows.find(row=>JSON.stringify(row.path)===JSON.stringify(path.slice(0,-1))).node.id:null;expect(row.node.parent,`${role}.parent`).toBe(parent);}
      expect(value.state.root).toBe(before.roles.R);expect(Object.keys(value.state).sort()).toEqual(['stamp','root','selection','stored_marks','dirty','saved_revision','history'].sort());expect(value.state.selection).toEqual(bindSelection(before.roles,expected.selection));expect(value.state.stored_marks).toEqual(expected.stored_marks);expect(value.state.saved_revision).toBe(expected.saved_revision);expect(value.state.dirty).toBe(expected.dirty);for(const key of ['undo_entries','redo_entries'])expect(value.state.history[key]).toBe(expected.history[key]);expect(value.state.history.retained_bytes).toMatch(/^\d+$/);
      const delta=expected.stamp_delta??expected.stamp_delta_from_action_baseline;expect(value.state.stamp).toEqual({...before.state.stamp,...Object.fromEntries(Object.entries(delta).map(([key,amount])=>[key,String(BigInt(before.state.stamp[key])+BigInt(amount))]))});expect(value.events).toHaveLength(step);expect(value.events.every(event=>event.change.kind==='document')).toBe(true);
    };
    await page.keyboard.press('Tab');await expect(trigger(page,id,'move')).toBeFocused();await page.keyboard.press('Enter');const menu=shell(page,id).getByRole('menu');await expect(menu).toHaveAccessibleName(names.move);await expect(menu.getByRole('menuitem').first()).toBeFocused();await expect(shell(page,id).locator('.kw-ui-context')).toHaveText(names[`${lane.id}Before`]);await audit(page,id,'keyboard Move menu before semantic action');await page.keyboard.press('Home');for(let n=0;n<lane.downKeys;n++)await page.keyboard.press('ArrowDown');await expect(action(page,id,lane.choice)).toBeFocused();await expect(action(page,id,lane.choice)).toHaveAttribute('aria-disabled','false');await page.keyboard.press('Enter');
    await expect.poll(async()=>submissions(await call(page,'inspect',id)).length).toBe(1);const after=await checkpoint(page,id,'keyboard native move completed');assertLiteral(after,item.expected.command,1);await expect(menu).toBeHidden();await expect(trigger(page,id,'move')).toBeFocused();await expect(shell(page,id).locator('.kw-ui-context')).toHaveText(names[`${lane.id}After`]);expect(submissions(after)[0]).toEqual({status:'submitted',action:lane.choice,submission:submissions(after)[0].submission,response:{status:'ok',value:{kind:'mutation',effect:'changed',state:after.state,presentation:{active:'none'}}}});expect(['completed','queued']).toContain(submissions(after)[0].submission);
    const undo=await call(page,'history',id,'undo'),undone=await checkpoint(page,id,'public native undo');assertLiteral(undone,item.expected.undo,2);expect(undo.response).toEqual({status:'ok',value:{kind:'mutation',effect:'changed',state:undone.state,presentation:null}});
    const redo=await call(page,'history',id,'redo'),redone=await checkpoint(page,id,'public native redo');assertLiteral(redone,item.expected.redo,3);expect(redo.response).toEqual({status:'ok',value:{kind:'mutation',effect:'changed',state:redone.state,presentation:null}});
    for(const [index,value]of [after,undone,redone].entries()){const previous=index===0?before:[after,undone][index-1],event=value.events[index];expect(event.before).toEqual(previous.state.stamp);expect(event.after).toEqual(value.state.stamp);expect(event.selection_before).toEqual(previous.state.selection);expect(event.selection_after).toEqual(value.state.selection);expect(event.stored_marks_before).toEqual(previous.state.stored_marks);expect(event.stored_marks_after).toEqual(value.state.stored_marks);expect(event.dirty_before).toBe(previous.state.dirty);expect(event.dirty_after).toBe(value.state.dirty);expect(event.history).toEqual(value.state.history);expect(event.change.from_revision).toBe(previous.state.stamp.revision);expect(event.change.to_revision).toBe(value.state.stamp.revision);expect(event.change.impact.removed).toEqual([]);for(const key of ['upserted','ancestors_before','ancestors_after']){expect(new Set(event.change.impact[key]).size).toBe(event.change.impact[key].length);expect(event.change.impact[key].every(node=>Object.values(before.roles).includes(node))).toBe(true);}}
    const trace=await call(page,'nativeTrace',id);expect(trace.enabled).toBe(true);expect(trace.overflow).toBe(false);const calls=wire({...trace,calls:trace.calls.slice(traceBase)});expect(calls.every(row=>row.outcome==='returned')).toBe(true);const mutations=calls.filter(row=>mutating.has(row.request.kind));expect(mutations.map(row=>row.request.kind)).toEqual(['command','history','history']);expect(mutations[0].request.command.id).toBe(item.command_id);expect(JSON.parse(mutations[0].request.command.payload_json)).toEqual({...item.intent,node:before.roles[item.intent.node],parent:before.roles[item.intent.parent]});expect(mutations[1].request.direction).toBe('undo');expect(mutations[2].request.direction).toBe('redo');records.get(page).traces.push({id,phase:'keyboard-only action and fresh-stamp history',value:trace});await audit(page,id,'keyboard nesting native history restored');
  });
}
