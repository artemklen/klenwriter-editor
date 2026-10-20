// SPDX-License-Identifier: MIT OR Apache-2.0
// Actual mounted SDK2/WASM; browser-protocol input, not installed OS acceptance.
import {test,expect} from '@playwright/test';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';

const sourcePath='contracts/slash/v1/lexical-key-oracles.json',sourceBytes=readFileSync(sourcePath);
const seeds=JSON.parse(sourceBytes).mountedCanonicalSeeds,seed=id=>seeds.find(value=>value.id===id);
const call=(page,method,...args)=>page.evaluate(({method,args})=>window.ui42[method](...args),{method,args});
const records=new WeakMap(),point=(offset)=>({kind:'text',node:'T',offset,affinity:'after'});
const selection=offset=>({anchor:point(offset),focus:point(offset)});
const surface=(page,id)=>page.locator(`#${id}-editor`),menu=(page,id)=>page.locator(`#${id} .kw-ui-slash`);
const rows=(page,id)=>menu(page,id).getByRole('option');
async function mount(page,{locale='en',heading=false,unavailable=null}={}){
  const canonical=JSON.parse(seed(heading?'MC02':'MC01').preAcceptCanonical);
  canonical.content[0].content[0].text=heading?'a  tail':'pre  tail';
  const value=await call(page,'mount',{case:'V07-text-caret',slash:true,source:canonical,selection:selection(heading?2:4),locale,slashUnavailable:unavailable});
  expect(value.ready).toBe('ready');expect(value.uiReady).toBe('ready');records.get(page).mounts.push(value.id);
  await page.bringToFront();expect((await call(page,'editorFocus',value.id)).response.status).toBe('ok');await expect(surface(page,value.id)).toBeFocused();
  await expect.poll(()=>page.evaluate(()=>document.hasFocus())).toBe(true);return value.id;
}
async function inspect(page,id,note){const value=await call(page,'inspect',id);records.get(page).checkpoints.push({note,id,...value});return value;}
function unchanged(after,before){expect(after.canonical).toBe(before.canonical);expect(after.state).toEqual(before.state);expect(after.events).toEqual(before.events);expect(after.results).toEqual(before.results);}
test.beforeEach(async({page},info)=>{
  const record={engine:info.project.name,installedBrowser:false,scope:'Actual mounted SDK2/WASM and protocol keyboard/pointer; explicit dispatched events are controlled and not physical input.',
    oracle:{path:sourcePath,sha256:createHash('sha256').update(sourceBytes).digest('hex')},mounts:[],checkpoints:[],cleanup:[],errors:[],external:[]};records.set(page,record);
  page.on('pageerror',error=>record.errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:4174/'))record.external.push(request.url());});
  // S17/S18 control scheduling. Install before navigation as required by the
  // pinned Playwright Clock API; all native input still uses the real mounted SDK.
  if(/^S(?:17|18) /.test(info.title))await page.clock.install({time:new Date('2030-01-01T00:00:00Z')});
  await page.addInitScript(()=>{window.slashPolicy=[];document.addEventListener('securitypolicyviolation',e=>window.slashPolicy.push({directive:e.effectiveDirective,blocked:e.blockedURI}));});
  const response=await page.goto('/ui');record.csp=response.headers()['content-security-policy'];expect(record.csp).not.toContain("'unsafe-inline'");expect(record.csp).not.toContain("'unsafe-eval'");
  await page.waitForFunction(()=>!!window.ui42);
});
test.afterEach(async({page},info)=>{
  const record=records.get(page);if(!record)return;
  try{
    for(const id of record.mounts){
      if(info.status!=='passed'){const value=await call(page,'inspect',id,{snapshot:false});record.checkpoints.push({id,note:'pure native failure readback before disposal',...value,window:await call(page,'textWindow',id),presentation:await menu(page,id).evaluate(node=>({documentFocused:document.hasFocus(),hidden:node.hidden,display:getComputedStyle(node).display,visibility:getComputedStyle(node).visibility,rect:node.getBoundingClientRect().toJSON(),text:node.textContent}))});}
      const result=await call(page,'destroy',id);record.cleanup.push({id,...result});
      expect(result.ui).toEqual({listeners:0,observers:0,animationFrames:0,subscriptions:0,hostRequests:0,continuations:0,dragGestures:0,pointerCaptures:0});
      expect(result.mounted.inputObservations).toEqual({subscribers:0});expect(result.mounted.popupPresentation).toEqual({handles:0});
      expect(result.mounted.hostRequests).toEqual({pending:0,focusContinuations:0});expect(result.mounted.dom.listeners).toBe(0);
      expect(result.native).toEqual({sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});
    }
    record.policy=await page.evaluate(()=>window.slashPolicy);expect(record.errors).toEqual([]);expect(record.external).toEqual([]);expect(record.policy).toEqual([]);
  }finally{record.status=info.status;mkdirSync('artifacts/slash/browser',{recursive:true});const path=`artifacts/slash/browser/${info.project.name}-${info.testId.replaceAll(/[^\w-]/g,'_')}.json`;writeFileSync(path,JSON.stringify(record,null,2)+'\n');await info.attach('slash-source-observation',{path,contentType:'application/json'});}
});

test('S01 rapid ordinary /para, keyboard accept, exact native topology, one unit and undo/redo',async({page})=>{
  const id=await mount(page);await page.keyboard.type('/para');await expect(menu(page,id)).toBeVisible();await expect(rows(page,id)).toHaveCount(2);
  await expect(rows(page,id)).toHaveText(['Paragraph','Scene break']);await expect(rows(page,id).first()).toHaveAttribute('aria-selected','true');
  await expect(surface(page,id)).toBeFocused();const before=await inspect(page,id,'ordinary query is committed before acceptance');expect(before.canonical).toBe(seed('MC01').preAcceptCanonical);
  expect(before.ordinaryInputs).toHaveLength(5);expect(before.ordinaryInputs.every(value=>value.kind==='ordinary_input'&&value.beforeWindow)).toBe(true);
  await page.keyboard.press('Enter');await expect(menu(page,id)).toBeHidden();const after=await inspect(page,id,'one exact native accept');expect(after.canonical).toBe(seed('MC01').afterCanonical);
  expect(after.results).toHaveLength(1);expect(after.results[0].response.status).toBe('ok');expect(after.insideEditor).toBe(true);
  for(const key of ['revision','selection_epoch','history_epoch'])expect(BigInt(after.state.stamp[key])-BigInt(before.state.stamp[key])).toBe(1n);
  expect(BigInt(after.state.history.undo_entries)-BigInt(before.state.history.undo_entries)).toBe(1n);
  expect((await call(page,'history',id,'undo')).response.status).toBe('ok');const undone=await inspect(page,id,'undo restores literal and selection');expect(undone.canonical).toBe(before.canonical);expect(undone.state.selection).toEqual(before.state.selection);
  expect((await call(page,'history',id,'redo')).response.status).toBe('ok');const redone=await inspect(page,id,'redo same native output and selection');expect(redone.canonical).toBe(after.canonical);expect(redone.state.selection).toEqual(after.state.selection);
});
test('S02 RU heading pointer acceptance retains native heading prefix/suffix',async({page})=>{
  const id=await mount(page,{locale:'ru',heading:true});await page.keyboard.type('/');
  records.get(page).ruQueryTransport={slash:'browser-protocol ordinary key',query:'controlled cancelable beforeinput per scalar, isTrusted=false; no installed/OS claim'};
  await surface(page,id).evaluate(element=>{for(const data of ['ц','и','т'])element.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertText',data,bubbles:true,cancelable:true}));});
  await expect(menu(page,id)).toBeVisible();await expect(rows(page,id)).toHaveCount(1);
  const before=await inspect(page,id,'RU heading query');expect(before.canonical).toBe(seed('MC02').preAcceptCanonical);
  expect(before.ordinaryInputs.map(row=>({data:row.dataHint,trusted:row.isTrusted}))).toEqual([{data:'/',trusted:true},{data:'ц',trusted:false},{data:'и',trusted:false},{data:'т',trusted:false}]);
  await rows(page,id).click();await expect(menu(page,id)).toBeHidden();const after=await inspect(page,id,'RU quote preserves heading headers');expect(after.canonical).toBe(seed('MC02').afterCanonical);expect(after.insideEditor).toBe(true);expect(after.results).toHaveLength(1);
});
test('S03 Escape retains exact query/state/history; further typing cannot revive dismissed anchor',async({page})=>{
  const id=await mount(page);await page.keyboard.type('/para');await expect(menu(page,id)).toBeVisible();const before=await inspect(page,id,'before Escape');
  await page.keyboard.press('Escape');await expect(menu(page,id)).toBeHidden();const after=await inspect(page,id,'Escape zero native dispatch');expect(after.canonical).toBe(before.canonical);expect(after.state).toEqual(before.state);expect(after.events).toEqual(before.events);expect(after.results.at(-1)).toEqual({status:'cancelled',action:'slash',restore:null});
  await page.keyboard.type('x');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await expect(menu(page,id)).toBeHidden();expect((await inspect(page,id,'dismissed text remains editable')).canonical).toContain('pre /parax tail');
});
for(const locale of ['en','ru'])test(`S04 ${locale} no results is non-option; Enter/Escape preserve exact text and native state`,async({page})=>{
  const id=await mount(page,{locale});await page.keyboard.type('/zzzz');await expect(menu(page,id)).toBeVisible();await expect(rows(page,id)).toHaveCount(0);
  await expect(menu(page,id).getByRole('status')).toHaveText(locale==='ru'?'Ничего не найдено':'No results');const before=await inspect(page,id,'before unavailable Enter');
  await page.keyboard.press('Enter');await expect(menu(page,id)).toBeVisible();unchanged(await inspect(page,id,'Enter dispatches zero without native paragraph'),before);
  await page.keyboard.press('Escape');expect((await inspect(page,id,'no-results Escape retains text')).canonical).toBe(before.canonical);
});
test('S05 Up/Down wrap options; editor ARIA, focus and native state remain correct',async({page})=>{
  const id=await mount(page);await page.keyboard.type('/');await expect(rows(page,id)).toHaveCount(9);const before=await inspect(page,id,'before presentation navigation');
  await expect(surface(page,id)).toHaveAttribute('role','textbox');await expect(surface(page,id)).toHaveAttribute('aria-haspopup','listbox');await expect(surface(page,id)).not.toHaveAttribute('aria-expanded');
  await expect(page.locator(`#${id} [data-editor-ui-control=add]`)).toHaveAttribute('aria-expanded','true');
  await expect(rows(page,id).first()).toHaveAttribute('aria-selected','true');await page.keyboard.press('ArrowUp');await expect(rows(page,id).last()).toHaveAttribute('aria-selected','true');
  await page.keyboard.press('ArrowDown');await expect(rows(page,id).first()).toHaveAttribute('aria-selected','true');
  expect(await surface(page,id).getAttribute('aria-activedescendant')).toBe(await rows(page,id).first().getAttribute('id'));await expect(surface(page,id)).toBeFocused();unchanged(await inspect(page,id,'after option navigation'),before);
  const audit=await new AxeBuilder({page}).include(`#${id}`).analyze();expect(audit.violations).toEqual([]);
});
test('S06 Tab dismisses without changing text and follows actual page focus order',async({page})=>{
  const id=await mount(page);await page.keyboard.type('/');await expect(menu(page,id)).toBeVisible();const before=await inspect(page,id,'before Tab');
  await page.keyboard.press('Tab');await expect(menu(page,id)).toBeHidden();await expect(page.locator(`#${id} [data-editor-ui-control=move]`)).toBeFocused();
  const after=await inspect(page,id,'Tab retained exact native text');expect(after.canonical).toBe(before.canonical);expect(after.state).toEqual(before.state);
});
test('S07 shared Add catalog uses null slash range and original captured native insertion',async({page})=>{
  const id=await mount(page),before=await inspect(page,id,'original Add caret');await page.locator(`#${id} [data-editor-ui-control=add]`).click();await expect(rows(page,id)).toHaveCount(9);await expect(rows(page,id).first()).toBeFocused();
  await page.keyboard.press('Enter');await expect(menu(page,id)).toBeHidden();const after=await inspect(page,id,'same native insertion without query');expect(after.canonical).toBe(seed('MC01').afterCanonical);expect(after.results).toHaveLength(1);expect(after.insideEditor).toBe(true);
  expect((await call(page,'history',id,'undo')).response.status).toBe('ok');expect((await inspect(page,id,'Undo Add exact input')).canonical).toBe(before.canonical);
});
test('S08 unavailable known candidate explains refusal and cannot dispatch',async({page})=>{
  const id=await mount(page,{unavailable:'org.klenwriter.kwdj/slash/paragraph'});await page.keyboard.type('/');await expect(rows(page,id)).toHaveCount(9);await expect(rows(page,id).first()).toHaveAttribute('aria-disabled','true');
  const before=await inspect(page,id,'unavailable registered target');await page.keyboard.press('Enter');unchanged(await inspect(page,id,'unavailable Enter'),before);await expect(menu(page,id)).toBeVisible();await expect(page.locator(`#${id} .kw-ui-status`)).toContainText('No suitable destination.');
});
test('S09 factory reentry cannot overwrite changed native selection or recapture a lease',async({page})=>{
  const id=await mount(page);await page.keyboard.type('/para');await expect(menu(page,id)).toBeVisible();const before=await inspect(page,id,'before factory reentry');
  await call(page,'slashFactoryFault',id,'org.klenwriter.kwdj/slash/paragraph');await page.keyboard.press('Enter');await expect(menu(page,id)).toBeHidden();const after=await inspect(page,id,'explicit foreign selection remains');
  expect(after.canonical).toBe(before.canonical);expect(after.results.filter(value=>value.status==='submitted')).toHaveLength(0);expect(after.slashFaultResults).toHaveLength(1);expect(after.state.selection.anchor.offset).toBe(0);expect(after.resources.hostRequests.pending).toBe(0);
  expect(after.slashFaultPending).toEqual([1]);expect(after.slashFaultResults[0].response.value.effect).toBe('state_changed');
});
for(const text of ['word/x','https://x','/x '])test(`S10 lexical boundary ${JSON.stringify(text)} retains ordinary text without a popup`,async({page})=>{
  const id=await mount(page);await page.keyboard.type(text);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await expect(menu(page,id)).toBeHidden();
  const after=await inspect(page,id,'ineligible literal is ordinary committed text');expect(after.canonical).toContain(`pre ${text} tail`);expect(after.results.filter(value=>value.status==='submitted')).toHaveLength(0);
});
test('S11 read-only and disabled close the picker without deleting its committed literal',async({page})=>{
  const id=await mount(page);await page.keyboard.type('/');await expect(menu(page,id)).toBeVisible();const before=await inspect(page,id,'before mode switch');
  expect((await call(page,'mode',id,'readOnly')).status).toBe('updated');await expect(menu(page,id)).toBeHidden();const readOnly=await inspect(page,id,'read-only preserves text');expect(readOnly.canonical).toBe(before.canonical);expect(readOnly.results.filter(value=>value.status==='submitted')).toHaveLength(0);
  expect((await call(page,'mode',id,'disabled')).status).toBe('updated');expect((await inspect(page,id,'disabled preserves text')).canonical).toBe(before.canonical);
});
test('S12 controlled composition slash cannot certify ordinary input or open a picker',async({page})=>{
  const id=await mount(page),before=await inspect(page,id,'before controlled composition');
  await surface(page,id).evaluate(element=>{
    element.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));
    element.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:false,inputType:'insertCompositionText',data:'/',isComposing:true}));
  });
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await expect(menu(page,id)).toBeHidden();
  const after=await call(page,'inspect',id,{snapshot:false});records.get(page).checkpoints.push({note:'controlled composition, no fake settlement/OS claim',...after});
  expect(after.state).toEqual(before.state);expect(after.ordinaryInputs).toEqual([]);expect(after.results.filter(value=>value.status==='submitted')).toHaveLength(0);
});
test('S13 200% zoom and active-option scrolling preserve the native document/caret',async({page})=>{
  await page.setViewportSize({width:640,height:700});const id=await mount(page);await page.evaluate(()=>document.documentElement.style.zoom='2');await page.keyboard.type('/');await expect(menu(page,id)).toBeVisible();
  const before=await inspect(page,id,'before zoomed option navigation');
  const clip=()=>menu(page,id).evaluate(node=>{const active=node.querySelector('[aria-selected=true]'),a=active.getBoundingClientRect(),r=node.getBoundingClientRect(),scale=r.height/node.offsetHeight;return {activeTop:a.top,activeBottom:a.bottom,listTop:r.top+node.clientTop*scale,listBottom:r.top+(node.clientTop+node.clientHeight)*scale,scroll:node.scrollTop,scale};});
  const measurements=[];
  for(let i=0;i<8;i++){
    await page.keyboard.press('ArrowDown');const facts=await clip();measurements.push(facts);
    expect(facts.activeTop).toBeGreaterThanOrEqual(facts.listTop-1);expect(facts.activeBottom).toBeLessThanOrEqual(facts.listBottom+1);expect(Number.isFinite(facts.scroll)).toBe(true);
  }
  records.get(page).zoomedListMeasurements=measurements;
  await expect(rows(page,id).last()).toHaveAttribute('aria-selected','true');await expect(surface(page,id)).toBeFocused();
  unchanged(await inspect(page,id,'zoom/scroll are presentation only'),before);
  const facts=await clip();
  expect(facts.activeTop).toBeGreaterThanOrEqual(facts.listTop-1);expect(facts.activeBottom).toBeLessThanOrEqual(facts.listBottom+1);expect(Number.isFinite(facts.scroll)).toBe(true);
});
test('S14 interrupted pointer gestures release their original request without mutation',async({page})=>{
  const id=await mount(page);await page.keyboard.type('/');await expect(rows(page,id)).toHaveCount(9);const before=await inspect(page,id,'before interrupted gestures');
  const option=rows(page,id).first();
  for(let i=0;i<2;i++){
    await option.dispatchEvent('pointerdown',{pointerId:7,button:0,bubbles:true});expect((await call(page,'mountedFacts',id)).resources.hostRequests.pending).toBe(1);
    await page.locator('#ui-before').dispatchEvent('pointerup',{pointerId:7,button:0,bubbles:true});expect((await call(page,'mountedFacts',id)).resources.hostRequests.pending).toBe(0);
  }
  const after=await inspect(page,id,'controlled interrupted gestures, no native dispatch');unchanged(after,before);expect(after.uiResources.hostRequests).toBe(0);
});
test('S15 Add Tab cancellation preserves a callback external focus transfer',async({page})=>{
  const id=await mount(page),targets=await call(page,'slashCancelFocus',id),before=await inspect(page,id,'before host focus callback');
  for(const target of targets)await expect(page.locator(`#${target}`)).toHaveAttribute('tabindex','0');
  await page.locator(`#${id} [data-editor-ui-control=add]`).click();await expect(rows(page,id).first()).toBeFocused();await page.keyboard.press('Tab');
  await expect(page.locator(`#${targets[1]}`)).toBeFocused();const after=await inspect(page,id,'Tab proceeds from host-selected external control');expect(after.canonical).toBe(before.canonical);expect(after.state).toEqual(before.state);expect(after.resources.hostRequests.pending).toBe(0);
  expect(after.slashCancelFocusTransitions).toEqual([{targetId:targets[0],activeId:targets[0]}]);
});
test('S16 terminal Enter repeat never takes modified or composition-owned keys',async({page})=>{
  const id=await mount(page);await page.keyboard.type('/para');await expect(menu(page,id)).toBeVisible();
  // Labels for /pa, /par and /para can be identical. Observe two finite actual
  // presentation frames before this test's FIRST admitted acceptance.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.keyboard.down('Enter');await expect(menu(page,id)).toBeHidden();
  const accepted=await inspect(page,id,'first genuine fresh Enter accepted before controlled held-repeat assertions');
  expect(accepted.canonical).toBe(seed('MC01').afterCanonical);expect(accepted.results.filter(value=>value.status==='submitted')).toHaveLength(1);
  expect(accepted.results.find(value=>value.status==='submitted').response.status).toBe('ok');
  const routed=await surface(page,id).evaluate(element=>{
    const send=options=>{const event=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,repeat:true,...options});element.dispatchEvent(event);return event.defaultPrevented;};
    const unmodified=send({}),shift=send({shiftKey:true});element.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));const composing=send({isComposing:true});return {unmodified,shift,composing};
  });
  expect(routed).toEqual({unmodified:true,shift:false,composing:false});await page.keyboard.up('Enter');
  const after=await call(page,'inspect',id,{snapshot:false});records.get(page).checkpoints.push({note:'controlled held repeats retain first exact native acceptance',id,...after});expect(after.results.filter(value=>value.status==='submitted')).toHaveLength(1);
  // The controlled compositionstart prevents a canonical snapshot request;
  // compare the actual complete native rows/state/events and original result.
  expect(after.state).toEqual(accepted.state);expect(after.rows).toEqual(accepted.rows);expect(after.events).toEqual(accepted.events);
  expect(after.results).toEqual(accepted.results);expect(after.ordinaryInputs).toEqual(accepted.ordinaryInputs);
});

// Deterministic source regression: a real rendered slash frame is intentionally
// older than two fresh completed ordinary inputs until the next presentation RAF.
test('S17 pending ordinary input chain survives a later letter before presentation RAF',async({page})=>{
  const id=await mount(page);await page.keyboard.type('/');await expect(menu(page,id)).toBeVisible();await expect(rows(page,id)).toHaveCount(9);
  const before=await inspect(page,id,'rendered slash frame before controlled RAF pause');
  const pauseAt=await page.evaluate(()=>Date.now()+1000);await page.clock.pauseAt(pauseAt);
  records.get(page).scheduler={kind:'Playwright Clock',scope:'Controlled presentation scheduling only; no installed/OS evidence',pausedAt:pauseAt,advancedMs:50};
  let pending;
  try{
    await page.keyboard.type('p');
    const first=await inspect(page,id,'first ordinary input completed while its render RAF is pending');
    expect(first.ordinaryInputs.at(-1).dataHint).toBe('p');expect(BigInt(first.state.stamp.revision)-BigInt(before.state.stamp.revision)).toBe(1n);
    await page.keyboard.type('a');
    pending=await inspect(page,id,'second key precedes pending render but preserves native ordinary origin chain');
    expect(pending.ordinaryInputs.map(row=>row.dataHint)).toEqual(['/','p','a']);
    expect(pending.ordinaryInputs[2].before).toEqual(pending.ordinaryInputs[1].after);
    expect(pending.canonical).toContain('"text":"pre /pa tail"');expect(pending.state.selection.anchor.offset).toBe(7);expect(pending.state.selection.focus.offset).toBe(7);
    expect(pending.results).toEqual([]);
    await page.clock.runFor(50);
  }finally{await page.clock.resume();}
  await expect(menu(page,id)).toBeVisible();await expect(rows(page,id)).toHaveText(['Paragraph','Scene break']);
  await expect(rows(page,id).first()).toHaveAttribute('aria-selected','true');await expect(surface(page,id)).toBeFocused();
  const rendered=await inspect(page,id,'finite resumed RAF renders latest /pa without a semantic replay');unchanged(rendered,pending);
  expect(rendered.ordinaryInputs).toEqual(pending.ordinaryInputs);expect(rendered.resources.popupPresentation).toEqual({handles:1});
});

// KY22: a still displayed but stale owned frame refuses Enter. The same event
// must not fall through to ordinary insertParagraph, nor revive on a later RAF.
test('S18 stale owned Enter before pending presentation RAF refuses without native paragraph or replay',async({page})=>{
  const id=await mount(page);await page.keyboard.type('/');await expect(menu(page,id)).toBeVisible();await expect(rows(page,id)).toHaveCount(9);
  const rendered=await inspect(page,id,'genuine rendered slash before controlled stale Enter');
  const pauseAt=await page.evaluate(()=>Date.now()+1000);await page.clock.pauseAt(pauseAt);
  records.get(page).scheduler={kind:'Playwright Clock',scope:'Controlled presentation scheduling only; no installed/OS evidence',pausedAt:pauseAt,advancedMs:50};
  let pending;
  try{
    await page.keyboard.type('p');pending=await inspect(page,id,'ordinary p completes while original slash frame awaits RAF');
    expect(pending.canonical).toBe(seed('MC01').preAcceptCanonical.replace('/para','/p'));
    expect(pending.ordinaryInputs.map(row=>row.dataHint)).toEqual(['/','p']);
    expect(pending.ordinaryInputs[1].before).toEqual(pending.ordinaryInputs[0].after);
    expect(BigInt(pending.state.stamp.revision)-BigInt(rendered.state.stamp.revision)).toBe(1n);expect(pending.results).toEqual([]);
    await expect(rows(page,id)).toHaveCount(9);await expect(surface(page,id)).toBeFocused();
    await page.keyboard.press('Enter');await expect(menu(page,id)).toBeHidden();
    const refused=await inspect(page,id,'same stale owned Enter is consumed with zero native dispatch');unchanged(refused,pending);
    expect(refused.rows).toEqual(pending.rows);expect(refused.ordinaryInputs).toEqual(pending.ordinaryInputs);
    expect(refused.results).toEqual([]);expect(refused.resources.hostRequests.pending).toBe(0);expect(refused.resources.popupPresentation.handles).toBe(0);
    await expect(surface(page,id)).toBeFocused();await page.clock.runFor(50);
  }finally{await page.clock.resume();}
  await expect(menu(page,id)).toBeHidden();const later=await inspect(page,id,'finite resumed RAF cannot revive refused anchor or replay Enter');unchanged(later,pending);
  expect(later.rows).toEqual(pending.rows);expect(later.ordinaryInputs).toEqual(pending.ordinaryInputs);expect(later.results).toEqual([]);
  expect(later.resources.hostRequests.pending).toBe(0);expect(later.resources.popupPresentation.handles).toBe(0);await expect(surface(page,id)).toBeFocused();
});
