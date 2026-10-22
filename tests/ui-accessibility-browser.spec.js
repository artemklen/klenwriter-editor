// SPDX-License-Identifier: MIT OR Apache-2.0
// Source-first, finite verification. Platform keyboard/AT/zoom remain separate lanes.
import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {checklist,copy,emptyCanonical,nativeCase,selectedAxe,limits,roleSnapshot,sourcePins,editingKeys} from '../scripts/accessibility/oracles.mjs';
import {observeSurface,observeLayout,measuredContrast} from '../scripts/accessibility/measure.mjs';

const records=new WeakMap();
const call=(page,method,...args)=>page.evaluate(({method,args})=>window.accessibilityHost[method](...args),{method,args});
const shell=(page,id)=>page.locator(`#${id}`),editor=(page,id)=>page.locator(`#${id}-editor`);
const action=(page,id,key)=>shell(page,id).locator(`[data-editor-ui-action="${key}"]`);
const button=(page,id,key)=>shell(page,id).locator(`[data-editor-ui-control="${key}"]`);
const docs=value=>value.events.filter(e=>e.change.kind==='document');
const states=value=>value.events.filter(e=>e.change.kind==='state');
const parseWire=value=>value.trace.map(row=>({request:JSON.parse(row.requestJson),response:row.responseJson===null?null:JSON.parse(row.responseJson),outcome:row.outcome}));
const mutating=new Set(['command','input_command','history','set_selection','set_stored_marks','barrier','acknowledge_snapshot','remount']);
const point=(roles,value)=>value===null?null:Object.fromEntries(Object.entries(value).map(([key,v])=>[key,['node','parent'].includes(key)?roles[v]:v]));
const select=(roles,value)=>value===null?null:{anchor:point(roles,value.anchor),focus:point(roles,value.focus)};
function unchanged(after,before){expect(after.canonical).toBe(before.canonical);expect(after.state).toEqual(before.state);expect(after.rows).toEqual(before.rows);expect(after.events).toEqual(before.events);}
function healthy(value){expect(value.lifecycle).toBe('ready');expect(value.fixtureErrors).toEqual([]);expect(value.recoveries).toEqual([]);}
async function mount(page,options={}){const value=await call(page,'mount',options);records.get(page).mounts.push(value.id);if(options.loader!=='held'&&options.loader!=='reject')expect(value.ready.status).toBe('ready');return value.id;}
async function checkpoint(page,id,label){const value=await call(page,'inspect',id);records.get(page).checkpoints.push({id,label,value});expect(value.fixtureErrors).toEqual([]);return value;}
async function frames(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function ax(page,locator,expected,label){const observation=await locator.ariaSnapshot();records.get(page).ax.push({label,expected,observation});await expect(locator).toMatchAriaSnapshot(expected);}
async function axe(page,id,label){
  // Retain the full engine result, including incomplete checks, before asserting.
  const result=await new AxeBuilder({page}).include(`#${id}`).withTags(selectedAxe.tags).analyze();
  records.get(page).axe.push({label,scope:`#${id}`,tags:[...selectedAxe.tags],qualification:selectedAxe.qualification,incompleteDisposition:result.incomplete.length?'UNRESOLVED_REQUIRES_EXPLICIT_DISPOSITION':'NONE',result});
  expect(result.testEngine.version).toBe(selectedAxe.version);expect(result.violations).toEqual([]);
}
async function tabTo(page,target,{reverse=false,limit=16}={}){
  for(let i=0;i<limit;i++){if(await target.evaluate(node=>node===document.activeElement))return;await page.keyboard.press(reverse?'Shift+Tab':'Tab');}
  await expect(target).toBeFocused();
}
function zero(value){
  expect(value.uiResources).toEqual({listeners:0,observers:0,animationFrames:0,subscriptions:0,hostRequests:0,continuations:0,dragGestures:0,pointerCaptures:0});
  expect(value.fixtureListeners).toBe(0);expect(value.fixtureErrors).toEqual([]);expect(value.restoredHostAttributes).toEqual(value.expectedHostAttributes);
  const r=value.resources;expect(r.dom.listeners).toBe(0);expect(r.dom.observers).toBe(0);expect(r.dom.continuations).toBe(0);
  expect(r.selection).toEqual({bookmarks:0,restoreTickets:0,activePointers:0,animationFrames:0});
  expect(r.clipboard).toEqual({pending:0,continuations:0,retainedTextBytes:0});expect(r.hostRequests).toEqual({pending:0,focusContinuations:0});
  for(const key of ['sessions','listeners','queued_mutations','queued_bytes','pending_tickets','host_requests','task_continuations'])expect(r.sdk[key]).toBe(0);
}
test.beforeEach(async({page},info)=>{
  const r={engine:info.project.name,status:'RUNNING',qualification:'Actual sealed public SDK/DOM/UI; browser-protocol input and controlled host states, no installed OS/AT/zoom claim.',sourcePins:sourcePins(),mounts:[],checkpoints:[],ax:[],axe:[],measurements:[],errors:[],external:[],cleanup:null};records.set(page,r);
  page.on('pageerror',error=>r.errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:4174/'))r.external.push(request.url());});
  await page.addInitScript(()=>{window.a66Policy=[];document.addEventListener('securitypolicyviolation',event=>window.a66Policy.push({directive:event.effectiveDirective,blocked:event.blockedURI}));});
  const response=await page.goto('/accessibility');r.csp=response.headers()['content-security-policy'];expect(r.csp).toContain("default-src 'none'");expect(r.csp).not.toContain("'unsafe-inline'");expect(r.csp).not.toContain("'unsafe-eval'");
  await page.waitForFunction(()=>window.accessibilityHostReady===true,undefined,{timeout:15000});
});
test.afterEach(async({page},info)=>{
  const r=records.get(page);if(!r)return;let cleanupError=null;
  try{r.cleanup=await call(page,'allDisposed');for(const value of r.cleanup.mounts)zero(value);expect(r.cleanup.native).toEqual({sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});r.policy=await page.evaluate(()=>window.a66Policy);expect(r.errors).toEqual([]);expect(r.external).toEqual([]);expect(r.policy).toEqual([]);}
  catch(error){cleanupError=error;r.cleanupFailure={name:error.name,message:error.message};throw error;}
  finally{r.testStatus=info.status;r.cleanupStatus=cleanupError?'FAILED':'PASSED';r.status=cleanupError||info.status!=='passed'?'FAILED':'PASSED';mkdirSync('artifacts/accessibility',{recursive:true});const path=`artifacts/accessibility/${info.project.name}-${info.testId.replaceAll(/[^a-zA-Z0-9_-]/g,'_')}.json`;writeFileSync(path,JSON.stringify(r,null,2)+'\n');await info.attach('accessibility-observations',{path,contentType:'application/json'});}
});

for(const locale of ['ru','en']){
  const names=copy[locale];
  test(`A66-S01/S02/S04 ${locale}: named multiline empty/ready and held loading/error preserve host attributes`,async({page})=>{
    const id=await mount(page,{locale,source:emptyCanonical,sourceRoles:{R:[],P:[0]},selection:null,hostLang:'de'}),el=editor(page,id);await checkpoint(page,id,'original pre-assertion ready semantics');
    await expect(el).toHaveAccessibleName(names.document);await expect(el).toHaveAttribute('role','textbox');await expect(el).toHaveAttribute('aria-multiline','true');await expect(el).toHaveAttribute('aria-busy','false');await expect(el).toHaveAttribute('lang','de');
    await ax(page,el,roleSnapshot('textbox',names.document),'empty named editor');const before=await checkpoint(page,id,'authored empty canonical');expect(before.canonical).toBe(emptyCanonical);healthy(before);await axe(page,id,'empty ready');unchanged(await checkpoint(page,id,'after read-only AX/axe'),before);
    zero(await call(page,'dispose',id));
    const held=await mount(page,{locale,loader:'held'});await expect(editor(page,held)).toHaveAttribute('aria-busy','true');await expect(editor(page,held)).toHaveAttribute('aria-multiline','true');await expect(shell(page,held).locator('.kw-ui-status')).toHaveText(names.loading);
    const loading=await checkpoint(page,held,'controlled held module, no native Session admitted');expect(loading.lifecycle).toBe('loading');expect(loading.state).toBeNull();expect(loading.native.sessions).toBe(0);
    expect((await call(page,'releaseLoader',held)).ready.status).toBe('ready');await expect(editor(page,held)).toHaveAttribute('aria-busy','false');await expect(shell(page,held).locator('.kw-ui-status')).not.toHaveText(names.loading);healthy(await checkpoint(page,held,'held loader ready'));zero(await call(page,'dispose',held));
    const failed=await mount(page,{locale,loader:'reject'});await expect(editor(page,failed)).toHaveAttribute('aria-busy','false');const alert=shell(page,failed).getByRole('alert',{name:names.loadError});await expect(alert).toBeVisible();await ax(page,alert,roleSnapshot('alert',names.loadError),'truthful load error');
    const loadFailure=await checkpoint(page,failed,'controlled rejected loader');expect(loadFailure.state).toBeNull();expect(loadFailure.canonical).toBeNull();expect(loadFailure.error).toEqual({visible:true,kind:'load'});
    await alert.getByRole('button',{name:names.original}).click();expect((await checkpoint(page,failed,'original payload remains recoverable')).originalRecovery.input).toBe(loadFailure.source);
    await axe(page,failed,'load failure and host exit');
    zero(await call(page,'dispose',failed));
    const runtime=await mount(page,{locale,focus:true}),prior=await checkpoint(page,runtime,'before controlled fatal public read');
    const fatal=await call(page,'controlledFatal',runtime);expect(fatal.response.status).toBe('fatal');await frames(page);await expect(editor(page,runtime)).toHaveAttribute('aria-busy','false');await expect(editor(page,runtime)).toHaveAttribute('contenteditable','false');const runtimeAlert=shell(page,runtime).getByRole('alert',{name:names.runtimeError});await expect(runtimeAlert).toBeVisible();
    const stopped=await checkpoint(page,runtime,'controlled fatal means unavailable, never false empty success');expect(stopped.lifecycle).toBe('fatal');expect(stopped.canonical).toBeNull();expect(stopped.state).toBeNull();expect(stopped.error).toEqual({visible:true,kind:'runtime'});expect(parseWire(stopped).slice(parseWire(prior).length).filter(row=>mutating.has(row.request.kind))).toEqual([]);
    await runtimeAlert.getByRole('button',{name:names.original}).click();expect((await checkpoint(page,runtime,'host original bytes remain explicitly original')).originalRecovery.input).toBe(prior.source);await axe(page,runtime,'controlled fatal and host recovery exit');
  });

  test(`A66-S03/M01/M02/L01 ${locale}: RU/EN pressed/name/mode/reason semantics localize external host name only`,async({page})=>{
    const id=await mount(page,{locale,hostLang:'de',focus:true}),el=editor(page,id),bold=action(page,id,'strong');
    await expect(shell(page,id).getByRole('toolbar',{name:names.toolbar})).toBeVisible();await expect(bold).toHaveAccessibleName(names.bold);await expect(bold).toHaveAttribute('aria-pressed','mixed');await ax(page,bold,roleSnapshot('button',names.bold,' [pressed=mixed]'),'mixed whole-range formatting');
    const before=await checkpoint(page,id,'before presentation-only mode/locale');
    for(const [mode,readonly,disabled,tabindex]of [['readOnly','true','false','0'],['disabled','true','true','-1'],['editable','false','false','0']]){
      expect(await call(page,'mode',id,mode)).not.toHaveProperty('status','fatal');await frames(page);await expect(el).toHaveAttribute('aria-readonly',readonly);await expect(el).toHaveAttribute('aria-disabled',disabled);await expect(el).toHaveAttribute('tabindex',tabindex);await expect(el).toHaveAttribute('aria-multiline','true');await expect(el).toHaveAttribute('aria-busy','false');
      if(mode!=='editable'){await expect(bold).toHaveAttribute('aria-disabled','true');await bold.focus();await page.keyboard.press('Enter');await frames(page);unchanged(await checkpoint(page,id,`${mode}: unavailable activation changes no native facet`),before);await axe(page,id,mode);}
    }
    await bold.focus();const focused=await bold.getAttribute('data-editor-ui-action'),other=locale==='en'?'ru':'en';await call(page,'locale',id,other);await frames(page);
    await expect(bold).toBeFocused();expect(await bold.getAttribute('data-editor-ui-action')).toBe(focused);await expect(bold).toHaveAccessibleName(copy[other].bold);await expect(el).toHaveAccessibleName(copy[other].document);await expect(el).toHaveAttribute('lang','de');await expect(shell(page,id).getByRole('toolbar')).toHaveAttribute('lang',other);await expect(page.locator(`#${id}-label`)).toHaveAttribute('lang',other);
    unchanged(await checkpoint(page,id,'localized external label, same native authority'),before);await axe(page,id,'localized chrome');
    const writes=parseWire(await call(page,'inspect',id)).slice(parseWire(before).length).filter(row=>mutating.has(row.request.kind));expect(writes).toEqual([]);
  });

  test(`A66-K07/E01 ${locale}: independent Notes named modal, required association and frozen native refusal/accept`,async({page})=>{
    const literal=nativeCase('V06-NC014-title-257-byte-refusal'),valid=nativeCase('V06-NC011-root-title-owned-metadata');
    const id=await mount(page,{locale,caseId:literal.id,focus:true}),before=await checkpoint(page,id,'independent Notes original');
    await page.keyboard.press('Shift+Tab');const titleAction=action(page,id,'title');await expect(titleAction).toBeFocused();await page.keyboard.press('Enter');
    const modal=shell(page,id).getByRole('dialog',{name:names.dialog}),field=modal.getByRole('textbox',{name:names.title});await expect(modal).toHaveAttribute('aria-modal','true');await expect(field).toBeFocused();await ax(page,modal,roleSnapshot('dialog',names.dialog),'named Notes modal');
    await page.keyboard.press('Tab');await expect(modal.getByRole('button',{name:names.apply})).toBeFocused();await page.keyboard.press('Tab');await expect(modal.getByRole('button',{name:names.cancel})).toBeFocused();await page.keyboard.press('Tab');await expect(field).toBeFocused();
    await field.press('Enter');await expect(field).toHaveAttribute('aria-invalid','true');const errorId=await field.getAttribute('aria-describedby');expect(errorId).toBeTruthy();await expect(page.locator(`#${errorId}`)).toHaveText(names.required);await expect(page.locator(`#${errorId}`)).toHaveAttribute('role','alert');unchanged(await checkpoint(page,id,'host-required field does not submit native command'),before);await axe(page,id,'modal invalid field');
    await field.fill(literal.command.payload.title);await field.press('Enter');await expect(modal).toBeHidden();await frames(page);const refused=await checkpoint(page,id,'original Notes 257-byte command refusal');unchanged(refused,before);expect(refused.results.some(row=>row.status==='submitted')).toBe(false);
    const nativeRefusal=parseWire(refused).filter(row=>row.request.kind==='query_command'&&row.response?.status==='ok'&&row.response.value.kind==='availability'&&row.response.value.available===false&&row.response.value.diagnostic?.code===literal.expected.code);expect(nativeRefusal.length).toBeGreaterThan(0);expect(nativeRefusal.at(-1).response.value.diagnostic.path).toBe(literal.expected.path);
    await titleAction.focus();await page.keyboard.press('Enter');await field.fill(valid.command.payload.title);await field.press('Enter');await expect(modal).toBeHidden();await frames(page);const accepted=await checkpoint(page,id,'independent Notes valid NBSP title');expect(accepted.canonical).toBe(valid.expected.canonical);expect(accepted.state.selection).toEqual(before.state.selection);expect(accepted.rows.map(row=>row.node.id)).toEqual(before.rows.map(row=>row.node.id));expect(docs(accepted)).toHaveLength(1);expect(accepted.state.stamp.revision).toBe('1');expect(accepted.state.history.undo_entries).toBe('1');healthy(accepted);
    const commandWrites=parseWire(accepted).filter(row=>row.request.kind==='command');expect(commandWrites).toHaveLength(1);expect(commandWrites[0].request.command.id).toBe('org.example.notes/command/set-title');expect(JSON.parse(commandWrites[0].request.command.payload_json)).toEqual(valid.command.payload);await axe(page,id,'Notes accepted, dialog closed');
  });

  test(`A66-V01/V02/V07 ${locale}: actual default/declared-theme contrast, keyboard focus and 32 CSS hit targets`,async({page})=>{
    const id=await mount(page,{locale,focus:true}),before=await checkpoint(page,id,'before visual-only conditions');
    for(const theme of ['default','highContrast']){
      await call(page,'presentation',id,{theme});await page.keyboard.press('Shift+Tab');const bold=action(page,id,'strong');await expect(bold).toBeFocused();
      const targets=[['strong',bold],['add',button(page,id,'add')],['move',button(page,id,'move')],['host-save',page.locator(`#${id}-save`)]];
      for(const [name,target]of targets){await target.scrollIntoViewIfNeeded();const measured=await target.evaluate(observeSurface),ratio=measuredContrast(measured);records.get(page).measurements.push({theme,name,measured,ratio});expect(measured.visible).toBe(true);expect(measured.rect.width).toBeGreaterThanOrEqual(limits.projectTarget);expect(measured.rect.height).toBeGreaterThanOrEqual(limits.projectTarget);expect(measured.hits[0].inside).toBe(true);expect(ratio.text).toBeGreaterThanOrEqual(limits.textContrast);expect(ratio.border).toBeGreaterThanOrEqual(limits.nonTextContrast);}
      // Re-enter by keyboard, then measure the actual focus ring, not a CSS token.
      await tabTo(page,bold);const focused=await bold.evaluate(observeSurface),ratio=measuredContrast(focused);records.get(page).measurements.push({theme,name:'focused-strong',measured:focused,ratio});expect(focused.focused).toBe(true);expect(focused.outlineStyle).not.toBe('none');expect(focused.outlineWidth).toBeGreaterThanOrEqual(2);expect(ratio.outline).toBeGreaterThanOrEqual(3);expect(focused.hits[0].inside).toBe(true);await axe(page,id,`${theme} selected/focus`);
      unchanged(await checkpoint(page,id,`${theme} presentation leaves native unchanged`),before);await page.keyboard.press('Tab');await expect(editor(page,id)).toBeFocused();
    }
  });

  test(`A66-V04/V05 ${locale}: 320 CSS reflow plus all four spacing overrides in both declared themes`,async({page})=>{
    await page.setViewportSize({width:320,height:800});const id=await mount(page,{locale,focus:true}),before=await checkpoint(page,id,'before CSS-only reflow/spacing');
    for(const theme of ['default','highContrast'])for(const spacing of [false,true]){
      await call(page,'presentation',id,{theme,spacing});await frames(page);const measured=await shell(page,id).evaluate(observeLayout);records.get(page).measurements.push({theme,spacing,measured});expect(measured.viewport).toBe(320);expect(measured.shellWidth).toBeLessThanOrEqual(321);
      for(const target of measured.targets){expect(target.left).toBeGreaterThanOrEqual(-1);expect(target.right).toBeLessThanOrEqual(321);expect(target.clipped).toBe(false);if(target.tag==='BUTTON'){expect(target.width).toBeGreaterThanOrEqual(32);expect(target.height).toBeGreaterThanOrEqual(32);}if(spacing){const size=parseFloat(target.fontSize);expect(parseFloat(target.lineHeight)).toBeCloseTo(size*1.5,1);expect(parseFloat(target.letterSpacing)).toBeCloseTo(size*.12,1);expect(parseFloat(target.wordSpacing)).toBeCloseTo(size*.16,1);}}
      if(spacing){const paragraph=await editor(page,id).locator('p').first().evaluate(node=>({margin:getComputedStyle(node).marginBlockEnd,size:getComputedStyle(node).fontSize}));expect(parseFloat(paragraph.margin)).toBeCloseTo(parseFloat(paragraph.size)*2,1);}
      await axe(page,id,`320px ${theme} spacing=${spacing}`);unchanged(await checkpoint(page,id,`320px ${theme} spacing=${spacing}: native unchanged`),before);
    }
  });

  test(`A66-V06 ${locale}: actual hover reason survives 4px traversal and Escape dismisses without focus/native change`,async({page})=>{
    const id=await mount(page,{locale,mode:'readOnly'}),bold=action(page,id,'strong'),italic=action(page,id,'emphasis');await frames(page);const before=await checkpoint(page,id,'before reason-only interaction');
    await expect(bold).toHaveAttribute('aria-disabled','true');const reasonId=await bold.getAttribute('aria-describedby'),reason=page.locator(`#${reasonId}`),pair=checklist.stableReasonPairs.find(value=>value.code==='dom.mode_blocked');await bold.hover();await expect(reason).toBeVisible();await expect(reason).toHaveText(`${pair.label[locale]} (${pair.code})`);expect(await reason.evaluate(node=>getComputedStyle(node).pointerEvents)).toBe('none');
    const from=await bold.boundingBox(),to=await reason.boundingBox();expect(from).not.toBeNull();expect(to).not.toBeNull();await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.move(to.x+Math.min(to.width/2,12),to.y+Math.min(to.height/2,12),{steps:8});await expect(reason).toBeVisible();
    const measured=await reason.evaluate(observeSurface),ratio=measuredContrast(measured);records.get(page).measurements.push({name:'readable hovered reason',measured,ratio});expect(ratio.text).toBeGreaterThanOrEqual(4.5);
    const active=await page.evaluate(()=>document.activeElement?.id);await page.keyboard.press('Escape');await expect(reason).toBeHidden();expect(await page.evaluate(()=>document.activeElement?.id)).toBe(active);unchanged(await checkpoint(page,id,'Escape only dismisses reason'),before);
    await page.mouse.move(1,1);await bold.focus();await expect(reason).toBeVisible();await italic.hover();await expect(reason).toBeVisible();const otherId=await italic.getAttribute('aria-describedby');await expect(page.locator(`#${otherId}`)).toBeHidden();await page.keyboard.press('Escape');await expect(reason).toBeHidden();await expect(bold).toBeFocused();unchanged(await checkpoint(page,id,'focus priority and Escape preserve native'),before);
    // A still-focused available control may acquire its reason on a mode
    // change. It must be dismissible without requiring a new focus event.
    await page.mouse.move(1,1);await call(page,'mode',id,'editable');await frames(page);await expect(reason).toBeHidden();await expect(bold).toBeFocused();
    await call(page,'mode',id,'readOnly');await frames(page);await expect(reason).toBeVisible();await page.keyboard.press('Escape');await expect(reason).toBeHidden();await expect(bold).toBeFocused();unchanged(await checkpoint(page,id,'new reason on existing focus remains dismissible'),before);
  });

  test(`A66-V09 ${locale}: declared forced-colors/reduced-motion emulation retains focus and semantic cues`,async({page})=>{
    await page.emulateMedia({forcedColors:'active',reducedMotion:'reduce'});const id=await mount(page,{locale,focus:true}),before=await checkpoint(page,id,'media-emulation scope only');await page.keyboard.press('Shift+Tab');const bold=action(page,id,'strong');await expect(bold).toBeFocused();await expect(bold).toHaveAttribute('aria-pressed','mixed');
    const observation=await bold.evaluate(node=>{const s=getComputedStyle(node);return {forced:matchMedia('(forced-colors: active)').matches,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,outline:s.outlineStyle,width:parseFloat(s.outlineWidth),animation:s.animationName,transition:s.transitionDuration,pressed:node.getAttribute('aria-pressed')};});records.get(page).measurements.push({name:'forced-colors/reduced-motion emulation',observation});expect(observation).toMatchObject({forced:true,reduced:true,animation:'none',pressed:'mixed'});expect(observation.outline).not.toBe('none');expect(observation.width).toBeGreaterThanOrEqual(2);expect(observation.transition.split(',').every(v=>parseFloat(v)===0)).toBe(true);unchanged(await checkpoint(page,id,'media emulation preserves native'),before);await axe(page,id,'media emulation');
  });
}

// Integrated keyboard/content expectations were independently authored before
// this fixture/candidate, in the immutable 27-row contract. Never use observed
// snapshots to generate any canonical, mark, selection, counter or ID relation.
const chain=checklist.integratedKeyboardChain;
function chainState(value,item,roles){
  expect(value.canonical).toBe(chain.canonicalLiterals[item.canonical].json);healthy(value);expect(value.failures).toEqual([]);
  for(const [role,path]of Object.entries(item.roles)){const node=value.rows.find(row=>JSON.stringify(row.path)===JSON.stringify(path))?.node;expect(node,`native role ${role}`).toBeTruthy();if(Object.hasOwn(roles,role))expect(node.id).toBe(roles[role]);else{expect(Object.values(roles)).not.toContain(node.id);roles[role]=node.id;}}
  expect(value.rows.map(row=>row.node.id).sort()).toEqual(Object.keys(item.roles).map(role=>roles[role]).sort());expect(value.state.selection).toEqual(select(roles,item.selection));expect(value.state.stored_marks).toEqual(item.stored_marks);
  for(const [role,marks]of Object.entries(item.textMarks))expect(value.rows.find(row=>row.node.id===roles[role]).node.marks).toEqual(marks);
  expect(value.state.stamp.revision).toBe(item.revision);expect(value.state.stamp.history_epoch).toBe(item.history_epoch);expect(value.state.history.undo_entries).toBe(item.undo_entries);expect(value.state.history.redo_entries).toBe(item.redo_entries);
}
function commandAccounting(before,after,item){
  const writes=parseWire(after).slice(parseWire(before).length).filter(row=>mutating.has(row.request.kind));let stamp=before.state.stamp,semantic=0;
  for(const row of writes){expect(row.outcome).toBe('returned');expect(row.response?.status).toBe('ok');expect(row.request.stamp).toEqual(stamp);expect(row.response.value.kind).toBe('mutation');const next=row.response.value.state.stamp,isSemantic=['command','history','input_command'].includes(row.request.kind);if(isSemantic){semantic++;for(const key of ['revision','selection_epoch','history_epoch'])expect(BigInt(next[key])-BigInt(stamp[key])).toBe(BigInt(item.semanticDelta[key]));}else{expect(['set_selection','barrier']).toContain(row.request.kind);expect(next.revision).toBe(stamp.revision);expect(next.history_epoch).toBe(stamp.history_epoch);expect(BigInt(next.selection_epoch)-BigInt(stamp.selection_epoch)).toBe(row.response.value.effect==='unchanged'?0n:1n);}stamp=next;}
  expect(semantic).toBe(1);expect(after.state.stamp).toEqual(stamp);expect(docs(after).length-docs(before).length).toBe(item.documentEvents);
}
async function runChain(page,locale,held){
  const initial=chain.steps[0],id=await mount(page,{locale,source:chain.canonicalLiterals.C0.json,sourceRoles:initial.roles,selection:initial.selection,focus:true,saveMode:held?'held':'immediate'}),roles={};
  // Only setup above may call bookmark/selection APIs. Everything from here to
  // Save/Reopen uses real browser keyboard controls, never locator.focus/select.
  await page.keyboard.press('Shift+Tab');await expect(action(page,id,'strong')).toBeFocused();await page.keyboard.press('Tab');await expect(editor(page,id)).toBeFocused();
  let before=await checkpoint(page,id,'C66-00 initial keyboard entry');chainState(before,initial,roles);expect(before.state.stamp.selection_epoch).toBe('1');
  const perform=async(index,operation)=>{await operation();await frames(page);const after=await checkpoint(page,id,chain.steps[index].id);chainState(after,chain.steps[index],roles);commandAccounting(before,after,chain.steps[index]);before=after;return after;};
  await perform(1,()=>page.keyboard.type('x'));
  await perform(2,async()=>{await page.keyboard.press(editingKeys.lineStart);await page.keyboard.press(editingKeys.selectLineEnd);await page.keyboard.press('Shift+Tab');await expect(action(page,id,'strong')).toBeFocused();await page.keyboard.press('Enter');});
  await perform(3,async()=>{await expect(editor(page,id)).toBeFocused();await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowRight');await tabTo(page,button(page,id,'add'));await page.keyboard.press('Enter');await expect(shell(page,id).getByRole('option',{name:copy[locale].paragraph,exact:true})).toBeFocused();await page.keyboard.press('Enter');});
  await perform(4,async()=>{await tabTo(page,button(page,id,'move'));await page.keyboard.press('Alt+ArrowUp');await expect(button(page,id,'move')).toBeFocused();});
  await perform(5,async()=>{await page.keyboard.press('Shift+Tab');await expect(editor(page,id)).toBeFocused();await page.keyboard.press(editingKeys.lineEnd);await page.keyboard.press('Backspace');});
  await perform(6,()=>page.keyboard.press('ControlOrMeta+z'));await expect(editor(page,id)).toBeFocused();
  return {id,roles,before};
}
for(const locale of ['ru','en']){
  test(`A66-K01/K02/K03/K05/K06/K08 ${locale}: complete keyboard edit/select/format/insert/move/delete/Undo/Save/reopen chain`,async({page})=>{
    const {id,roles,before}=await runChain(page,locale,false);await tabTo(page,page.locator(`#${id}-save`));await page.keyboard.press('Enter');const saved=await checkpoint(page,id,'explicit host receipt then matching acknowledgement');
    expect(saved.canonical).toBe(chain.canonicalLiterals.C4.json);expect(saved.state.stamp).toEqual(before.state.stamp);expect(saved.state.selection).toEqual(before.state.selection);expect(saved.state.history).toEqual(before.state.history);expect(saved.state.saved_revision).toBe('6');expect(saved.state.dirty).toBe(false);expect(docs(saved)).toEqual(docs(before));expect(states(saved).length-states(before).length).toBe(1);expect(states(saved).at(-1).change.baseline_changed).toBe(true);
    expect(saved.saveReceipts).toHaveLength(1);const receipt=saved.saveReceipts[0];expect(receipt.canonical).toBe(chain.canonicalLiterals.C4.json);expect(receipt.snapshot.stamp.revision).toBe('6');expect(receipt.acks).toHaveLength(1);expect(receipt.acks[0].response.status).toBe('ok');expect(receipt.released).toBe(true);
    const releases=parseWire(saved).filter(row=>row.request.kind==='release_snapshot'&&row.request.handle===receipt.snapshot.handle);expect(releases).toHaveLength(1);
    await tabTo(page,page.locator(`#${id}-reopen`));await page.keyboard.press('Enter');const original=await checkpoint(page,id,'old owner completely disposed, real saved copy reopened');expect(original.reopenedId).toBeTruthy();const fresh=await checkpoint(page,original.reopenedId,'fresh Session exact saved canonical');
    expect(fresh.canonical).toBe(chain.canonicalLiterals.C4.json);expect(fresh.state.stamp.session).not.toBe(before.state.stamp.session);for(const key of ['revision','selection_epoch','history_epoch'])expect(fresh.state.stamp[key]).toBe('0');expect(fresh.state.selection).toBeNull();expect(fresh.state.stored_marks).toBeNull();expect(fresh.state.saved_revision).toBe('0');expect(fresh.state.dirty).toBe(false);expect(fresh.state.history.undo_entries).toBe('0');expect(fresh.state.history.redo_entries).toBe('0');
    // Rebind only inside the fresh Session. NodeID strings need not be globally
    // novel across Sessions; fresh rows must match the authored paths and marks.
    const freshIds=new Set();expect(fresh.rows).toHaveLength(Object.keys(chain.save.reopen.roles).length);
    for(const [role,path]of Object.entries(chain.save.reopen.roles)){
      const matches=fresh.rows.filter(row=>JSON.stringify(row.path)===JSON.stringify(path));expect(matches,`fresh native role ${role}`).toHaveLength(1);
      const node=matches[0].node;expect(freshIds.has(node.id)).toBe(false);freshIds.add(node.id);expect(node.marks).toEqual(chain.steps.at(-1).textMarks[role]??[]);
    }
    expect(freshIds.size).toBe(Object.keys(chain.save.reopen.roles).length);
    await tabTo(page,editor(page,original.reopenedId));await expect(editor(page,original.reopenedId)).toBeFocused();healthy(fresh);expect(fresh.resources.selection.bookmarks).toBe(0);await axe(page,original.reopenedId,'fresh reopened saved copy');
  });

  test(`A66-K08 ${locale}: held old receipt never marks newer edit saved and late old acknowledgement is public unchanged`,async({page})=>{
    const {id,roles,before}=await runChain(page,locale,true);await tabTo(page,page.locator(`#${id}-save`));await page.keyboard.press('Enter');let held=await checkpoint(page,id,'old revision6 snapshot retained, not acknowledged');expect(held.saveReceipts[0].snapshot.stamp.revision).toBe('6');expect(held.saveReceipts[0].released).toBe(false);expect(held.state.saved_revision).toBe('0');expect(held.state.dirty).toBe(true);
    await tabTo(page,editor(page,id),{reverse:true});await page.keyboard.type('y');await frames(page);const newer=await checkpoint(page,id,'held receipt, newer strong xby revision7');const h=checklist.heldSaveBranch.keyboardEditWhileReceiptHeld;chainState(newer,{...h,canonical:'C7',history_epoch:'7',createdLiveRoles:[],retiredLiveRoles:[]},roles);commandAccounting(held,newer,{...h,documentEvents:1});
    const ack=await call(page,'acknowledge',id,0);expect(ack.response.status).toBe('ok');const stale=await checkpoint(page,id,'old snapshot acknowledgement saves6 while revision7 stays dirty');expect(stale.canonical).toBe(chain.canonicalLiterals.C7.json);expect(stale.state.stamp).toEqual(newer.state.stamp);expect(stale.state.selection).toEqual(newer.state.selection);expect(stale.state.history).toEqual(newer.state.history);expect(stale.state.saved_revision).toBe('6');expect(stale.state.dirty).toBe(true);expect(docs(stale)).toEqual(docs(newer));expect(states(stale).length-states(newer).length).toBe(1);
    await tabTo(page,page.locator(`#${id}-save`));await page.keyboard.press('Enter');const latest=await checkpoint(page,id,'fresh explicit save holds current revision7');expect(latest.saveReceipts[1].canonical).toBe(chain.canonicalLiterals.C7.json);expect(latest.saveReceipts[1].snapshot.stamp.revision).toBe('7');expect((await call(page,'acknowledge',id,1)).response.status).toBe('ok');const current=await checkpoint(page,id,'matching revision7 ack');expect(current.state.saved_revision).toBe('7');expect(current.state.dirty).toBe(false);
    expect(current.canonical).toBe(chain.canonicalLiterals.C7.json);expect(current.canonical).toBe(latest.canonical);expect(current.state.stamp).toEqual(latest.state.stamp);expect(current.state.selection).toEqual(latest.state.selection);expect(current.state.selection).toEqual(select(roles,h.selection));expect(current.state.stored_marks).toEqual(latest.state.stored_marks);expect(current.state.history).toEqual(latest.state.history);expect(docs(current)).toEqual(docs(latest));
    const late=await call(page,'acknowledge',id,0);expect(late.response).toMatchObject(checklist.heldSaveBranch.lateOldAfterCurrent.outcome);const afterLate=await checkpoint(page,id,'late original handle retained: unchanged public outcome');unchanged(afterLate,current);
    await call(page,'releaseSave',id,0);await call(page,'releaseSave',id,1);const released=await checkpoint(page,id,'each original host handle released once');expect(released.saveReceipts.every(row=>row.released)).toBe(true);for(const receipt of released.saveReceipts)expect(parseWire(released).filter(row=>row.request.kind==='release_snapshot'&&row.request.handle===receipt.snapshot.handle)).toHaveLength(1);expect(released.native.snapshot_handles).toBe(0);
  });
}
