// SPDX-License-Identifier: MIT OR Apache-2.0
// Actual packaged mounted lifecycle proof. Dispatched composition/transfer and
// explicit DOM/factory faults below are controlled, never installed/physical IME.
import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {install,frozen,records,call,surface,handle,frames,mount,inspect,prepareSource,arm,moveTo,nativeUnchanged,idle,identities,moved,semanticCalls,browserState,dispose,resolve,submitted,dragSubmissions} from './drag-browser-fixture.mjs';

test.use({trace:{mode:'retain-on-failure',screenshots:false,snapshots:true,sources:true}});
install();
const literal=frozen.cases.find(item=>item.id==='M44-01');
const mutationsNamed=(calls,kind)=>calls.filter(row=>row.request.kind===kind);
const moveCalls=calls=>calls.filter(row=>row.request.kind==='command'&&row.request.command.id==='org.klenwriter.kwdj/command/move');
const noLateMove=async(page,id,before)=>expect(await semanticCalls(page,id)).toEqual(before);

for(const locale of ['en','ru'])test(`DL01 ${locale} keyboard handle Move matches frozen pointer destination and returns the original handle`,async({page})=>{
  const id=await mount(page,literal,{locale}),before=await inspect(page,id,'frozen literal before keyboard equivalent');expect(before.canonical).toBe(literal.input);
  await prepareSource(page,id,literal);await handle(page,id).evaluate(node=>{window.dragKeyboardInitiator=node;node.focus({preventScroll:true});});
  await expect(handle(page,id)).toBeFocused();await page.keyboard.press('Enter');
  const menu=page.locator(`#${id} .kw-ui-popup[role=menu]`);await expect(menu).toBeVisible();await expect(menu.locator('[data-editor-ui-action=up]')).toBeFocused();
  await page.keyboard.press('ArrowDown');await expect(menu.locator('[data-editor-ui-action=down]')).toBeFocused();
  const open=await inspect(page,id,'keyboard menu is pure and retains one original request');nativeUnchanged(open,before);expect(open.resources.hostRequests.pending).toBe(1);
  await page.keyboard.press('Enter');await expect(menu).toBeHidden();await expect.poll(async()=>submitted(await call(page,'inspect',id)).length).toBe(1);
  const after=await inspect(page,id,'keyboard one isolated native Move');moved(after,before,literal,{action:'down'});await expect(handle(page,id)).toBeFocused();
  expect(await handle(page,id).evaluate(node=>node===window.dragKeyboardInitiator)).toBe(true);
  const calls=await semanticCalls(page,id),moves=moveCalls(calls);expect(moves).toHaveLength(1);expect(JSON.parse(moves[0].request.command.payload_json)).toEqual(resolve(literal.intent,before.roles));expect(moves[0].request.history_hint).toEqual({kind:'isolated'});
  expect(after.focusResults.at(-1)).toEqual({status:'not_requested',failure:null});
  expect((await call(page,'history',id,'undo')).response.status).toBe('ok');const undo=await inspect(page,id,'one Undo restores frozen input/identities');expect(undo.canonical).toBe(literal.input);identities(undo,literal.roles_before,before);expect(undo.state.selection).toEqual(before.state.selection);expect(undo.state.history.undo_entries).toBe('0');expect(undo.state.history.redo_entries).toBe('1');
  expect((await call(page,'history',id,'redo')).response.status).toBe('ok');const redo=await inspect(page,id,'one Redo restores frozen pointer-equivalent output');expect(redo.canonical).toBe(literal.after);identities(redo,literal.roles_after,before);expect(redo.state.selection).toEqual(after.state.selection);expect(redo.state.history.undo_entries).toBe('1');expect(redo.state.history.redo_entries).toBe('0');
});

test('DL02 explicit native selection invalidates the original held request; late up cannot recapture',async({page})=>{
  const id=await mount(page,literal),before=await inspect(page,id,'literal before external selection');await arm(page,id,literal);await moveTo(page,id,literal);
  const held=await inspect(page,id,'one genuine live pointer request');nativeUnchanged(held,before);expect(held.uiResources.dragGestures).toBe(1);expect(held.resources.hostRequests.pending).toBe(1);
  const point={kind:'text',node:'BT',offset:0,affinity:'after'},selection={anchor:point,focus:point};expect((await call(page,'select',id,selection)).response.status).toBe('ok');await frames(page);
  const changed=await inspect(page,id,'explicit host selection is setup, not a drag result');expect(changed.canonical).toBe(literal.input);expect(changed.state.selection).toEqual(resolve(selection,before.roles));expect(changed.state.history).toEqual(before.state.history);expect(changed.state.stamp.revision).toBe(before.state.stamp.revision);expect(BigInt(changed.state.stamp.selection_epoch)-BigInt(before.state.stamp.selection_epoch)).toBe(1n);idle(changed);
  const calls=await semanticCalls(page,id);expect(moveCalls(calls)).toHaveLength(0);await page.mouse.up();await frames(page);
  const late=await inspect(page,id,'same old up and ordinary refresh have no authority');nativeUnchanged(late,changed,{results:true});idle(late);await noLateMove(page,id,calls);expect(dragSubmissions(late)).toHaveLength(0);
});

test('DL03 native history publication cancels a held gesture and preserves the exact independently restored input',async({page})=>{
  const id=await mount(page,literal),before=await inspect(page,id,'frozen input before explicit setup Move');expect((await call(page,'command',id,literal.intent)).response.status).toBe('ok');await call(page,'bindAfter',id,literal.roles_after);await frames(page);
  const setup=await inspect(page,id,'host setup Move has frozen output, no UI submission');expect(setup.canonical).toBe(literal.after);identities(setup,literal.roles_after,before);expect(submitted(setup)).toHaveLength(0);
  await arm(page,id,{...literal,roles_before:literal.roles_after});await moveTo(page,id,{...literal,roles_before:literal.roles_after});
  expect((await call(page,'history',id,'undo')).response.status).toBe('ok');await frames(page);
  const undo=await inspect(page,id,'actual Undo publication independently restores input');expect(undo.canonical).toBe(literal.input);identities(undo,literal.roles_before,before);expect(undo.state.selection).toEqual(before.state.selection);expect(undo.state.history.undo_entries).toBe('0');expect(undo.state.history.redo_entries).toBe('1');idle(undo);
  const calls=await semanticCalls(page,id);expect(moveCalls(calls)).toHaveLength(1);expect(mutationsNamed(calls,'history')).toHaveLength(1);
  await page.mouse.up();await frames(page);const late=await inspect(page,id,'late release cannot replay the retired Move');nativeUnchanged(late,undo,{results:true});idle(late);expect(dragSubmissions(late)).toHaveLength(0);await noLateMove(page,id,calls);
});

for(const[mode,direct]of [['readOnly',false],['disabled',true]])test(`DL04 ${mode} ${direct?'direct mounted':'UI wrapper'} mode change cancels without a late replay`,async({page})=>{
  const id=await mount(page,literal),before=await inspect(page,id,'literal before mode setup');await arm(page,id,literal);await moveTo(page,id,literal);
  expect(await call(page,'mode',id,mode,direct)).toEqual({status:'updated',mode});await frames(page);await expect(handle(page,id)).toHaveAttribute('aria-disabled','true');
  const unavailable=await inspect(page,id,'mode transition is DOM availability only');nativeUnchanged(unavailable,before);idle(unavailable);const raw=await browserState(page,id),calls=await semanticCalls(page,id);
  await page.mouse.up();await frames(page);const after=await inspect(page,id,'old release is not a fresh action');nativeUnchanged(after,unavailable,{results:true});idle(after);expect(moveCalls(await semanticCalls(page,id))).toHaveLength(0);await noLateMove(page,id,calls);
  const now=await browserState(page,id);expect(now.range).toEqual(raw.range);expect(now.children).toEqual(raw.children);
  expect(await call(page,'mode',id,'editable',direct)).toEqual({status:'updated',mode:'editable'});await frames(page);await expect(handle(page,id)).toHaveAttribute('aria-disabled','false');nativeUnchanged(await inspect(page,id,'editable restoration does not revive old owner'),before);expect(dragSubmissions(after)).toHaveLength(0);
});

test('DL05 same-input native replacement rotates view authority and old up cannot operate on its replacement',async({page})=>{
  const id=await mount(page,literal),before=await inspect(page,id,'original literal before replacement'),original=await browserState(page,id);await arm(page,id,literal);await moveTo(page,id,literal);
  const held=await inspect(page,id,'genuine held original before replacement');nativeUnchanged(held,before);expect(held.uiResources.dragGestures).toBe(1);expect(held.uiResources.pointerCaptures).toBe(1);
  expect((await call(page,'replace',id,literal.input)).response.status).toBe('ok');await frames(page);
  const replaced=await inspect(page,id,'actual replacement is explicit setup');expect(replaced.canonical).toBe(literal.input);expect(replaced.state.stamp).not.toEqual(before.state.stamp);idle(replaced);
  const raw=await browserState(page,id);expect(raw.children).not.toEqual(original.children);const calls=await semanticCalls(page,id);
  await page.mouse.up();await frames(page);const late=await inspect(page,id,'retired pointer has no replacement-view authority');nativeUnchanged(late,replaced,{results:true});idle(late);expect(dragSubmissions(late)).toHaveLength(0);await noLateMove(page,id,calls);
  // The original drag is complete before this distinct, genuine editor-input
  // stage. A view-lineage barrier must not become a permanent selection lock.
  records.get(page).gestures.at(-1).end=await page.evaluate(()=>window.dragLifecycleEvents.length);
  const text=await page.evaluate(id=>{const node=document.getElementById(`${id}-editor`).firstElementChild.firstElementChild,box=node.getBoundingClientRect();return{x:box.x+.25,y:box.y+box.height/2};},id);
  await page.mouse.click(text.x,text.y);await frames(page);
  // Role aliases in the fixture retain their historical IDs. Bind the new
  // generation's opaque text ID from its independently fixed native path.
  const textId=replaced.rows.find(row=>JSON.stringify(row.path)==='[0,0]').node.id;expect(textId).not.toBe(before.roles.AT);
  const point=offset=>({kind:'text',node:textId,offset,affinity:'after'});
  const fresh=await inspect(page,id,'fresh genuine editor pointer admits only its own caret');expect(fresh.state.selection).toEqual({anchor:point(0),focus:point(0)});expect(fresh.canonical).toBe(literal.input);expect(fresh.state.history).toEqual(replaced.state.history);expect(fresh.state.stamp.session).toBe(replaced.state.stamp.session);expect(fresh.state.stamp.generation).toBe(replaced.state.stamp.generation);expect(moveCalls(await semanticCalls(page,id))).toHaveLength(0);
  await page.keyboard.press('ArrowRight');await expect.poll(async()=>(await call(page,'inspect',id)).state.selection).toEqual({anchor:point(1),focus:point(1)});
  await page.keyboard.type('x');await frames(page);const typed=await inspect(page,id,'fresh ordinary typing follows the genuine caret after replacement');
  const expected=JSON.parse(literal.input);expected.content[0].content[0].text='ax';expect(typed.canonical).toBe(JSON.stringify(expected));expect(typed.state.selection).toEqual({anchor:point(2),focus:point(2)});expect(typed.state.history.undo_entries).toBe('1');expect(typed.state.history.redo_entries).toBe('0');expect(moveCalls(await semanticCalls(page,id))).toHaveLength(0);idle(typed);
});

test('DL06 controlled empty composition retires the held lease, preserves original objects and requires a fresh gesture',async({page})=>{
  const id=await mount(page,literal),before=await inspect(page,id,'before explicitly controlled composition');await arm(page,id,literal);await moveTo(page,id,literal);const raw=await browserState(page,id);
  const live=await inspect(page,id,'genuine held original before controlled composition');nativeUnchanged(live,before);expect(live.uiResources.dragGestures).toBe(1);expect(live.uiResources.pointerCaptures).toBe(1);
  records.get(page).controlled.push({kind:'synthetic CompositionEvent start/end',trusted:false,scope:'empty terminal only; no OS/native IME claim'});
  await surface(page,id).evaluate(node=>node.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''})));await expect(handle(page,id)).toHaveAttribute('aria-disabled','true');
  const locked=await inspect(page,id,'pure native state while composition owns provisional DOM',{snapshot:false});expect(locked.canonicalObservation).toEqual({status:'not_requested'});nativeUnchanged(locked,before,{canonical:false});idle(locked);
  await page.mouse.up();await frames(page);const held=await browserState(page,id);expect(held.children).toEqual(raw.children);expect(held.range).toEqual(raw.range);expect(held.active).toBe(raw.active);expect(held.editorHtml).toBe(raw.editorHtml);
  await surface(page,id).evaluate((node,id)=>{window.ui42.refresh(id);node.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:''}));},id);await expect(handle(page,id)).toHaveAttribute('aria-disabled','false');await frames(page);
  const settled=await inspect(page,id,'empty unchanged terminal cannot replay old drag');nativeUnchanged(settled,before);expect(submitted(settled)).toHaveLength(0);idle(settled);expect(moveCalls(await semanticCalls(page,id))).toHaveLength(0);
  await arm(page,id,literal);await moveTo(page,id,literal);const freshHeld=await inspect(page,id,'separate fresh owner reaches the original frozen destination');nativeUnchanged(freshHeld,before);expect(freshHeld.uiResources.dragGestures).toBe(1);await page.mouse.up();await expect.poll(async()=>dragSubmissions(await call(page,'inspect',id)).length).toBe(1);
  const fresh=await inspect(page,id,'separate fresh original gesture is admitted');moved(fresh,before,literal);await expect(surface(page,id)).toBeFocused();
});

test('DL07 controlled factory throw/selection/disposal cannot complete or recapture their invalidated originals',async({page})=>{
  for(const kind of ['throw','selection','destroy']){
    const id=await mount(page,literal),before=await inspect(page,id,`before controlled ${kind} callback`);await arm(page,id,literal);await call(page,'dragFactoryFault',id,kind);
    records.get(page).controlled.push({kind:'source-authored factory fault',fault:kind,scope:'callback boundary, not real input failure'});
    await moveTo(page,id,literal);await frames(page);const changed=await inspect(page,id,`controlled callback ${kind} has settled`);expect(changed.canonical).toBe(literal.input);idle(changed);expect(dragSubmissions(changed)).toHaveLength(0);
    if(kind==='throw')expect(changed.results).toContainEqual({status:'ui_refused',code:'ui.callback_failed',action:'drag-move'});
    else expect(changed.dragFaultResults).toHaveLength(1);
    if(kind==='selection'){const point={kind:'text',node:'BT',offset:0,affinity:'after'};expect(changed.state.selection).toEqual(resolve({anchor:point,focus:point},before.roles));expect(changed.dragFaultResults).toHaveLength(1);expect(changed.dragFaultResults[0].response.status).toBe('ok');}
    else nativeUnchanged(changed,before);
    if(kind==='destroy')expect(changed.uiResources).toEqual({listeners:0,observers:0,animationFrames:0,subscriptions:0,hostRequests:0,continuations:0,dragGestures:0,pointerCaptures:0});
    const calls=await semanticCalls(page,id);expect(moveCalls(calls)).toHaveLength(0);await page.mouse.up();await frames(page);const late=await inspect(page,id,`${kind} old up remains terminal`);nativeUnchanged(late,changed,{results:true});idle(late);await noLateMove(page,id,calls);await dispose(page,id,`controlled ${kind} fixture release`);
  }
});

test('DL08 two real instances preserve external editor focus and never cross-complete original requests',async({page})=>{
  const a=await mount(page,literal),b=await mount(page,literal),beforeA=await inspect(page,a,'instance A baseline'),beforeB=await inspect(page,b,'instance B baseline');expect(beforeA.state.stamp.session).not.toBe(beforeB.state.stamp.session);
  await arm(page,a,literal);await moveTo(page,a,literal);const heldA=await inspect(page,a,'genuine A owner before external focus');nativeUnchanged(heldA,beforeA);expect(heldA.uiResources.dragGestures).toBe(1);expect((await call(page,'editorFocus',b)).response.status).toBe('ok');await frames(page);await expect(surface(page,b)).toBeFocused();
  const ownedB=await inspect(page,b,'external instance focus is explicit setup'),retiredA=await inspect(page,a,'instance A original retired by foreign focus');nativeUnchanged(retiredA,beforeA);idle(retiredA);idle(ownedB);
  await page.mouse.up();await frames(page);await expect(surface(page,b)).toBeFocused();nativeUnchanged(await inspect(page,a,'A late up remains pure'),retiredA,{results:true});nativeUnchanged(await inspect(page,b,'B does not inherit A pointer'),ownedB,{results:true});expect(moveCalls(await semanticCalls(page,a))).toHaveLength(0);
  await arm(page,b,literal);await moveTo(page,b,literal);const heldB=await inspect(page,b,'genuine fresh B owner reaches its frozen destination');nativeUnchanged(heldB,beforeB);expect(heldB.uiResources.dragGestures).toBe(1);await page.mouse.up();await expect.poll(async()=>dragSubmissions(await call(page,'inspect',b)).length).toBe(1);moved(await inspect(page,b,'B fresh own gesture only'),beforeB,literal);nativeUnchanged(await inspect(page,a,'A remains independent after B commit'),beforeA);
});

test('DL09 destroy during actual capture releases all owned resources before late up; the other instance stays unchanged',async({page})=>{
  const a=await mount(page,literal),b=await mount(page,literal),beforeB=await inspect(page,b,'surviving instance baseline');await arm(page,a,literal);await moveTo(page,a,literal);
  const held=await inspect(page,a,'actual capture before destroy');expect(held.uiResources.dragGestures).toBe(1);expect(held.uiResources.pointerCaptures).toBe(1);
  const destroyed=await dispose(page,a,'destroy while pointer still held');expect(destroyed.ui.pointerCaptures).toBe(0);expect(destroyed.ui.dragGestures).toBe(0);await expect(page.locator(`#${a}`)).toHaveCount(0);
  const calls=await semanticCalls(page,b);await page.mouse.up();await frames(page);const late=await inspect(page,b,'late up from removed owner cannot submit in another instance');nativeUnchanged(late,beforeB,{results:true});idle(late);await noLateMove(page,b,calls);expect(moveCalls(calls)).toHaveLength(0);
});

for(const locale of ['en','ru'])test(`DL10 ${locale} controlled benign external transfer is refused without native import or outside-control interception`,async({page})=>{
  const id=await mount(page,literal,{locale}),before=await inspect(page,id,'native literal before controlled transfer');await arm(page,id,literal);await moveTo(page,id,literal);const raw=await browserState(page,id);
  const actual=await page.evaluate(id=>{
    const editor=document.getElementById(`${id}-editor`),transfer=new DataTransfer();transfer.setData('text/plain','external literal');transfer.setData('text/html','<p>external literal</p>');let reads=0;
    const get=transfer.getData.bind(transfer);transfer.getData=type=>{reads++;return get(type);};
    const rows=[];for(const name of ['dragstart','dragover','drop']){const event=new DragEvent(name,{bubbles:true,cancelable:true,dataTransfer:transfer});editor.dispatchEvent(event);rows.push({name,isTrusted:event.isTrusted,prevented:event.defaultPrevented});}
    for(const inputType of ['insertFromDrop','deleteByDrag']){const event=new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType,data:'external literal'});editor.dispatchEvent(event);rows.push({name:'beforeinput',inputType,isTrusted:event.isTrusted,prevented:event.defaultPrevented});}
    const external=document.getElementById('ui-after'),outside=new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer});external.dispatchEvent(outside);
    return{rows,reads,outside:{isTrusted:outside.isTrusted,prevented:outside.defaultPrevented},url:location.href};
  },id);records.get(page).controlled.push({kind:'finite benign DataTransfer and beforeinput',...actual});expect(actual.reads).toBe(0);expect(actual.rows).toHaveLength(5);expect(actual.rows.every(row=>row.isTrusted===false&&row.prevented===true)).toBe(true);expect(actual.outside).toEqual({isTrusted:false,prevented:false});expect(actual.url).toBe(page.url());
  await frames(page);const after=await inspect(page,id,'external events are refusal-only and retire internal owner');nativeUnchanged(after,before);idle(after);expect(submitted(after)).toHaveLength(0);expect(after.failures.slice(-4).map(value=>value.diagnostic.code)).toEqual(Array(4).fill('dom.command_unsupported'));
  await expect(page.locator(`#${id} [role=status]`)).toContainText(locale==='ru'?'Внешнее перетаскивание недоступно.':'External drop is unavailable.');
  const afterRaw=await browserState(page,id);expect(afterRaw.editorHtml).toBe(raw.editorHtml);expect(afterRaw.children).toEqual(raw.children);expect(afterRaw.range).toEqual(raw.range);
  const calls=await semanticCalls(page,id);await page.mouse.up();await frames(page);nativeUnchanged(await inspect(page,id,'late original up after refusal'),after,{results:true});await noLateMove(page,id,calls);expect(moveCalls(calls)).toHaveLength(0);
});

test('DL11 controlled unsupported wrapper geometry cancels without weakening canonical authority or requiring focus repair',async({page})=>{
  const id=await mount(page,literal),before=await inspect(page,id,'full actual canonical before layout-only fault');await arm(page,id,literal);
  records.get(page).controlled.push({kind:'external wrapper transform',scope:'measurement fault; editor owned attributes unchanged; explicit teardown after assertions'});
  await page.locator(`#${id}`).evaluate(node=>node.classList.add('ui-geometry-transform'));await moveTo(page,id,literal);await page.mouse.up();await frames(page);
  const unsupported=await inspect(page,id,'pure reads during unsupported geometry',{snapshot:false});expect(unsupported.canonicalObservation).toEqual({status:'not_requested'});nativeUnchanged(unsupported,before,{canonical:false});idle(unsupported);expect(submitted(unsupported)).toHaveLength(0);expect(moveCalls(await semanticCalls(page,id))).toHaveLength(0);
  await page.locator(`#${id}`).evaluate(node=>node.classList.remove('ui-geometry-transform'));await frames(page);
  const after=await inspect(page,id,'real canonical after explicit CSS teardown, no focus/scroll/selection assist');nativeUnchanged(after,before);idle(after);
});

test('DL12 controlled same-ID clone cannot gain geometry or original gesture authority and remains truthful recovery',async({page})=>{
  const id=await mount(page,literal),before=await inspect(page,id,'genuine view before clone fault');await arm(page,id,literal);await moveTo(page,id,literal);
  const observation=await page.evaluate(({id,path,source})=>{
    let node=document.getElementById(`${id}-editor`);for(const index of path)node=node.children[index];const clone=node.cloneNode(true),sameId=clone.id===node.id;node.replaceWith(clone);const r=clone.getBoundingClientRect();
    return{sameId,immediate:window.ui42.dragGeometryRead(id,source,{x:r.x+Math.min(32,r.width/2),y:r.y+r.height/8},null)};
  },{id,path:literal.roles_before[literal.target],source:literal.source});records.get(page).controlled.push({kind:'same-ID clone of genuine target',...observation});expect(observation.sameId).toBe(true);expect(observation.immediate.status).toBe('dom_refused');expect(observation.immediate.diagnostic.code).toBe('dom.selection_geometry_unsupported');
  await frames(page);const recovered=await inspect(page,id,'controlled foreign clone enters truthful recovery; real native canonical remains available');nativeUnchanged(recovered,before,{context:false});expect(recovered.context).toBeNull();idle(recovered);expect((await call(page,'status',id)).diagnostic.code).toBe('dom.recovery_required');expect(submitted(recovered)).toHaveLength(0);const calls=await semanticCalls(page,id);
  await page.mouse.up();await frames(page);const late=await inspect(page,id,'clone is not promoted by late up');nativeUnchanged(late,recovered,{results:true});expect(late.context).toBeNull();idle(late);await noLateMove(page,id,calls);expect(moveCalls(calls)).toHaveLength(0);
});

test('DL13 optional slash coexistence retires its picker but preserves every committed query byte when drag is cancelled',async({page})=>{
  const path='contracts/slash/v1/lexical-key-oracles.json',bytes=readFileSync(path),seeds=JSON.parse(bytes).mountedCanonicalSeeds,pre=seeds.find(seed=>seed.id==='MC03'),query=seeds.find(seed=>seed.id==='MC01');
  records.get(page).slashOracle={path,sha256:createHash('sha256').update(bytes).digest('hex')};
  const point={kind:'text',node:'T',offset:4,affinity:'after'},item={input:pre.preAcceptCanonical,roles:{R:[],P:[0],T:[0,0]},selection:{anchor:point,focus:point},source:'P',target:'P',placement:'before'};
  const id=await mount(page,item,{case:'V07-text-caret',slash:true});expect((await call(page,'editorFocus',id)).response.status).toBe('ok');await page.keyboard.type('/para');
  const menu=page.locator(`#${id} .kw-ui-slash`);await expect(menu).toBeVisible();await expect(menu.getByRole('option')).toHaveText(['Paragraph','Scene break']);await frames(page);
  const before=await inspect(page,id,'genuine ordinary /para committed before drag');expect(before.canonical).toBe(query.preAcceptCanonical);expect(before.ordinaryInputs).toHaveLength(5);expect(before.ordinaryInputs.every(row=>row.kind==='ordinary_input'&&row.beforeWindow&&row.isTrusted)).toBe(true);
  await arm(page,id,item);await expect(menu).toBeHidden();const held=await inspect(page,id,'drag owns original lease; slash literal retained');nativeUnchanged(held,before);expect(held.ordinaryInputs).toEqual(before.ordinaryInputs);expect(held.resources.hostRequests.pending).toBe(1);expect(held.resources.popupPresentation.handles).toBe(0);
  await page.keyboard.press('Escape');await page.mouse.up();await frames(page);const after=await inspect(page,id,'drag cancellation cannot delete or accept retained slash query');nativeUnchanged(after,before);expect(after.ordinaryInputs).toEqual(before.ordinaryInputs);expect(submitted(after)).toHaveLength(0);idle(after);await expect(menu).toBeHidden();expect(moveCalls(await semanticCalls(page,id))).toHaveLength(0);
});

test('DL14 actual benign HTML drag defaults are refused at the mounted surface without importing or navigating',async({page})=>{
  const id=await mount(page,literal);
  await page.evaluate(id=>{
    const source=document.createElement('div');source.id='drag-external-source';source.draggable=true;source.textContent='External literal';
    source.addEventListener('dragstart',event=>event.dataTransfer.setData('text/plain','external literal'));
    document.getElementById(id).before(source);window.dragExternalDefaults=[];
    for(const name of ['dragstart','dragover','drop'])document.addEventListener(name,event=>{
      if(event.target===source||document.getElementById(`${id}-editor`).contains(event.target))window.dragExternalDefaults.push({name,isTrusted:event.isTrusted,prevented:event.defaultPrevented,inside:document.getElementById(`${id}-editor`).contains(event.target)});
    });
  },id);
  const before=await inspect(page,id,'literal before actual browser HTML drag'),url=page.url();
  await page.locator('#drag-external-source').dragTo(surface(page,id).locator('p').first());await frames(page);
  const events=await page.evaluate(()=>window.dragExternalDefaults);records.get(page).controlled.push({kind:'actual protocol mouse HTML drag; one fixed benign plaintext transfer',events});
  expect(events.some(event=>event.name==='dragstart'&&event.isTrusted&&!event.inside&&!event.prevented)).toBe(true);
  expect(events.some(event=>event.name==='dragover'&&event.isTrusted&&event.inside&&event.prevented)).toBe(true);
  expect(events.some(event=>event.name==='drop'&&event.isTrusted&&event.inside&&event.prevented)).toBe(true);
  const after=await inspect(page,id,'actual external drop is refusal-only');nativeUnchanged(after,before);idle(after);expect(submitted(after)).toHaveLength(0);expect(moveCalls(await semanticCalls(page,id))).toHaveLength(0);expect(page.url()).toBe(url);
});
