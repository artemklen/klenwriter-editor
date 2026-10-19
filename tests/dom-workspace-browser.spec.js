import {test,expect} from '@playwright/test';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const literal=name=>readFileSync(`contracts/dom/v1/expected/${name}.canonical.json`,'utf8');
const wire=name=>readFileSync(`contracts/dom/v1/inputs/${name}.json`,'utf8');
const call=(page,method,...args)=>page.evaluate(({method,args})=>window.domHost[method](...args),{method,args});
const stateRow=(point,path)=>point.rows.find(row=>row.path===path).node;
const docEvents=point=>point.events.filter(event=>event.change.kind==='document');
function history(point,undo,redo) {expect(point.state.history.undo_entries).toBe(String(undo));expect(point.state.history.redo_entries).toBe(String(redo));}
function unique(point) {expect(new Set(point.ids).size).toBe(point.ids.length);}
function caret(point,node,offset,kind='text') {
  const expected=kind==='text'?{kind,node,offset,affinity:'after'}:{kind:'child',parent:node,index:offset,affinity:'after'};
  expect(point.state.selection).toEqual({anchor:expected,focus:expected});
}
const observations=new WeakMap();
test.beforeEach(async({page},testInfo)=>{
  const record={errors:[],requests:[],checkpoints:[],engine:testInfo.project.name,installedBrowser:false};observations.set(page,record);
  page.on('pageerror',error=>record.errors.push(error.message));
  page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:4174/'))record.requests.push(request.url());});
  await page.addInitScript(()=>{window.domViolations=[];document.addEventListener('securitypolicyviolation',event=>window.domViolations.push({directive:event.violatedDirective,blocked:event.blockedURI}));});
  const response=await page.goto('/dom');record.csp=response.headers()['content-security-policy'];
  expect(record.csp).toContain("default-src 'none'");expect(record.csp).toContain("'wasm-unsafe-eval'");
  expect(record.csp).not.toContain("'unsafe-inline'");expect(record.csp).not.toMatch(/(?:^|\s)'unsafe-eval'/);
  await page.waitForFunction(()=>window.domHostReady===true);
  record.metadata=await call(page,'metadata');
});
test.afterEach(async({page},testInfo)=>{
  const record=observations.get(page);if(!record)return;
  try {
    record.nativeFinal=await call(page,'allDisposed');record.violations=await page.evaluate(()=>window.domViolations);
    expect(record.nativeFinal).toEqual({sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});
    expect(record.errors).toEqual([]);expect(record.requests).toEqual([]);expect(record.violations).toEqual([]);
  } finally {
    record.status=testInfo.status;record.scope='Actual mounted public packages/WASM with literal pre-candidate fixtures; automated engine. Firefox experimental; failures remain failures. Full OSR40/41/47/50/65/67 and installed Chrome/Safari acceptance excluded.';
    mkdirSync('artifacts/dom',{recursive:true});const path=`artifacts/dom/${testInfo.project.name}-${testInfo.testId.replaceAll(/[^A-Za-z0-9_-]/g,'_')}.json`;
    writeFileSync(path,JSON.stringify(record,null,2)+'\n');await testInfo.attach('mounted-dom-observations',{path,contentType:'application/json'});
  }
});
async function checkpoint(page,id,label) {const point=await call(page,'inspect',id);observations.get(page).checkpoints.push({label,...point});return point;}

test('T01/T06 exact authored text, nine marks, twelve nodes, attrs and safe static presentation',async({page})=>{
  const initial=await call(page,'mount',{fixture:'D0'});expect(initial.ready).toBe('ready');expect(initial.originalInput).toBeNull();
  const id=initial.id;await call(page,'select',id,'/0/2',2);
  const p=await checkpoint(page,id,'T01 initial');expect(p.canonical).toBe(literal('D0'));expect(p.state.stamp.revision).toBe('0');history(p,0,0);expect(p.state.dirty).toBe(false);
  expect(p.domText).toBe('А😀 e\u0301\u00a0ZБета');expect(stateRow(p,'/0').attributes).toEqual({align:{kind:'string',value:'right'},first_line_indent:{kind:'boolean',value:true}});
  expect(stateRow(p,'/0/1').marks.map(mark=>mark.type_id)).toEqual(['org.klenwriter.kwdj/strong']);caret(p,stateRow(p,'/0/2').id,2);unique(p);
  expect(await call(page,'nativeSelectionMatches',id,'/0/2',2)).toBe(true);
  const catalog=await call(page,'mount',{fixture:'KWDJ-basic-catalog'});expect(catalog.ready).toBe('ready');const rendered=await checkpoint(page,catalog.id,'T06 complete supported catalog');
  expect(rendered.canonical).toBe(literal('KWDJ-basic-catalog'));expect(new Set(rendered.rows.filter(x=>x.node.type_id).map(x=>x.node.type_id)).size).toBe(12);
  const semantic=await page.locator(`#${catalog.id}`).evaluate(el=>({h:el.querySelector('h2')?.textContent,quote:!!el.querySelector('blockquote'),lists:el.querySelectorAll('ul,ol').length,start:el.querySelector('ol')?.getAttribute('start'),checked:el.querySelector('[aria-checked="true"]')?.getAttribute('role'),atom:el.querySelector('hr')?.getAttribute('contenteditable'),strong:!!el.querySelector('strong'),code:el.querySelector('pre')?.textContent,whiteSpace:getComputedStyle(el).whiteSpace}));
  expect(semantic).toMatchObject({h:'Heading',quote:true,lists:3,start:'3',checked:'checkbox',atom:'false',strong:true,whiteSpace:'pre-wrap'});
  const safe=await call(page,'mount',{fixture:'T06-safe-data'});expect(safe.ready).toBe('ready');expect((await checkpoint(page,safe.id,'T06 data')).canonical).toBe(literal('T06-safe-data'));
  expect(await page.locator(`#${safe.id} script, #${safe.id} img, #${safe.id} iframe, #${safe.id} style`).count()).toBe(0);
  expect(await call(page,'brandCheck')).toBe(true);
});

test('T02 actual keyboard end split/join and six literal history/identity checkpoints',async({page})=>{
  const {id}=await call(page,'mount',{fixture:'D0'});await call(page,'select',id,'/0/2',2);await call(page,'mark',id,'P2','/1');
  const initial=await checkpoint(page,id,'T02 initial'), originalIds=new Set(initial.rows.map(row=>row.node.id));
  await page.keyboard.press('Enter');const split=await checkpoint(page,id,'T02 Enter');
  expect(split.canonical).toBe(literal('D1-after-end-split'));const empty=stateRow(split,'/1');expect(empty.children).toEqual([]);expect(originalIds.has(empty.id)).toBe(false);caret(split,empty.id,0,'child');
  await page.keyboard.press('Backspace');const joined=await checkpoint(page,id,'T02 Backspace');expect(joined.canonical).toBe(literal('D0'));caret(joined,stateRow(initial,'/0/2').id,2);
  const expected=[['undo','D1-after-end-split',1,1],['undo','D0',0,2],['redo','D1-after-end-split',1,1],['redo','D0',2,0]];
  const points=[split,joined];for(const [direction,document,undo,redo] of expected){expect((await call(page,'history',id,direction)).response.status).toBe('ok');const p=await checkpoint(page,id,`T02 ${direction} ${points.length}`);expect(p.canonical).toBe(literal(document));history(p,undo,redo);if(document==='D1-after-end-split')expect(stateRow(p,'/1').id).toBe(empty.id);points.push(p);}
  for(let i=0;i<points.length;i++){expect(points[i].state.stamp.revision).toBe(String(i+1));expect(docEvents(points[i])).toHaveLength(i+1);expect(points[i].state.dirty).toBe(true);unique(points[i]);}
  expect(await call(page,'sameIdentity',id,'P2','/1')).toBe(true);expect(await call(page,'nativeSelectionMatches',id,'/0/2',2)).toBe(true);
});

test('T03 actual keyboard middle split/join preserves historical IDs and old-left caret',async({page})=>{
  const {id}=await call(page,'mount',{fixture:'T03-initial'});await call(page,'select',id,'/0/0',1);const before=await checkpoint(page,id,'T03 initial'), left=stateRow(before,'/0/0').id;
  await page.keyboard.press('Enter');const split=await checkpoint(page,id,'T03 Enter'), E=stateRow(split,'/1').id,TR=stateRow(split,'/1/0').id;
  expect(split.canonical).toBe(literal('T03-split'));expect(stateRow(split,'/0/0').id).toBe(left);expect(stateRow(split,'/0/0').text).toBe('a');expect(stateRow(split,'/1/0').text).toBe('😀b');caret(split,TR,0);
  const mapped=await call(page,'read',id,{kind:'map_position',from_revision:'0',position:{kind:'text',node:left,offset:1,affinity:'after'}});expect(mapped.status).toBe('ok');expect(mapped.value.position).toEqual({kind:'text',node:TR,offset:0,affinity:'after'});
  await page.keyboard.press('Backspace');let p=await checkpoint(page,id,'T03 join');expect(p.canonical).toBe(literal('T03-initial'));caret(p,left,1);expect(await call(page,'nativeSelectionMatches',id,'/0/0',1)).toBe(true);
  for(const [direction,document] of [['undo','T03-split'],['undo','T03-initial'],['redo','T03-split'],['redo','T03-initial']]){await call(page,'history',id,direction);p=await checkpoint(page,id,`T03 ${direction} ${document}`);expect(p.canonical).toBe(literal(document));if(document==='T03-split'){expect(stateRow(p,'/1').id).toBe(E);expect(stateRow(p,'/1/0').id).toBe(TR);}else caret(p,left,1);}
  expect(p.state.stamp.revision).toBe('6');history(p,2,0);expect(docEvents(p)).toHaveLength(6);
});

test('T04 programmatic/reentrant publications patch once and preserve unaffected DOM identity',async({page})=>{
  const {id}=await call(page,'mount',{fixture:'D0'});await call(page,'select',id,'/0/2',2);await call(page,'mark',id,'P2','/1');await call(page,'reentrant',id);
  const availability=await call(page,'queryCommand',id,{kind:'insert_text',text:'X'});expect(availability.status).toBe('ok');expect(availability.value.available).toBe(true);
  const result=await call(page,'command',id,{kind:'insert_text',text:'X'});expect(result.status).toBe('completed');expect(result.response.status).toBe('ok');
  const observed=await call(page,'reentrantResult',id),p=await checkpoint(page,id,'T04 reentrant XY');expect(observed.ticketKinds).toEqual(['queued']);
  expect(observed.observations).toEqual([{listener:1,canonicalText:'А😀 e\u0301\u00a0ZXБета',revision:'1'},{listener:2,canonicalText:'А😀 e\u0301\u00a0ZXБета',revision:'1'},{listener:1,canonicalText:'А😀 e\u0301\u00a0ZXYБета',revision:'2'},{listener:2,canonicalText:'А😀 e\u0301\u00a0ZXYБета',revision:'2'}]);
  expect(p.canonical).toBe(literal('T04-XY'));caret(p,stateRow(p,'/0/2').id,4);expect(await call(page,'nativeSelectionMatches',id,'/0/2',4)).toBe(true);expect(await call(page,'sameIdentity',id,'P2','/1')).toBe(true);expect(docEvents(p)).toHaveLength(2);
});

test('T05 scalar positions, reverse selection, styled EGC deletion and exact undo',async({page})=>{
  const {id}=await call(page,'mount',{fixture:'D0'});
  for(const [path,offsets]of [['/0/0',[0,1,3,4]],['/0/1',[0,1,2]],['/0/2',[0,1,2]]])for(const offset of offsets){await call(page,'select',id,path,offset);expect(await call(page,'nativeSelectionMatches',id,path,offset)).toBe(true);}
  const point=await checkpoint(page,id,'T05 positions'),TA=stateRow(point,'/0/0').id,TB=stateRow(point,'/0/1').id,TC=stateRow(point,'/0/2').id;
  const invalid=await call(page,'rawSelection',id,{kind:'text',node:TA,offset:2,affinity:'after'});expect(invalid.response.status).toBe('refused');expect(invalid.response.diagnostic).toMatchObject({code:'position.invalid',path:'',category:'sdk',details:{},may_have_committed:false});
  await call(page,'select',id,'/0/1',1);const interior=await call(page,'command',id,{kind:'insert_text',text:'x'});expect(interior.response.status).toBe('refused');expect(interior.response.diagnostic.code).toBe('position.invalid');expect(await call(page,'snapshot',id)).toBe(literal('D0'));
  const reverse=await call(page,'rawSelection',id,{kind:'text',node:TC,offset:2,affinity:'before'},{kind:'text',node:TA,offset:1,affinity:'after'});expect(reverse.response.status).toBe('ok');const reversed=await checkpoint(page,id,'T05 reverse');expect(reversed.state.selection.anchor.affinity).toBe('before');expect(reversed.actualSelection.anchorOffset).toBe(2);expect(reversed.actualSelection.focusOffset).toBe(1);
  const formatted=await call(page,'mount',{fixture:'T05-styled-EGC'});await call(page,'select',formatted.id,'/0/0',0,'/0/1',1);expect((await call(page,'command',formatted.id,{kind:'toggle_mark',mark:{type_id:'org.klenwriter.kwdj/emphasis',attributes:{}}})).response.status).toBe('ok');expect(await call(page,'snapshot',formatted.id)).toBe(literal('T05-formatted-EGC'));
  const deleted=await call(page,'mount',{fixture:'T05-backward-EGC'}),did=deleted.id;await call(page,'select',did,'/0/1',1);const old=await checkpoint(page,did,'T05 before EGC delete'),plain=stateRow(old,'/0/0').id,accent=stateRow(old,'/0/1').id;
  await page.keyboard.press('Backspace');let after=await checkpoint(page,did,'T05 EGC delete');expect(after.canonical).toBe(literal('T05-backward-EGC-after'));caret(after,plain,1);expect(after.rows.some(r=>r.node.id===accent)).toBe(false);
  await call(page,'history',did,'undo');after=await checkpoint(page,did,'T05 undo EGC');expect(after.canonical).toBe(literal('T05-backward-EGC'));expect(stateRow(after,'/0/1').id).toBe(accent);caret(after,accent,1);
});

test('T07 independent Notes D0 and unsupported D1 never flatten native-valid data',async({page})=>{
  const d0=await call(page,'mount',{profile:'notes',fixture:'Notes-D0'});expect(d0.ready).toBe('ready');const p=await checkpoint(page,d0.id,'T07 Notes D0');expect(p.canonical).toBe(literal('Notes-D0'));expect(stateRow(p,'/0').attributes.title.value).toBe('Notes D0');expect(stateRow(p,'/0').attributes.tags.value.map(v=>v.value)).toEqual(['alpha','β','alpha']);
  const native=await call(page,'headlessNotesAdmission','Notes-D1-callout-highlight');expect(native.status).toBe('ok');
  const d1=await call(page,'mount',{profile:'notes',registry:'D1',fixture:'Notes-D1-callout-highlight'});expect(d1.ready).toBe('dom_refused');expect(['dom.renderer_binding_mismatch','dom.renderer_missing']).toContain(d1.diagnostic.code);expect(new TextDecoder().decode(Uint8Array.from(d1.originalInput))).toBe(wire('Notes-D1-callout-highlight'));
  const destroyed=await call(page,'dispose',d1.id);expect(new TextDecoder().decode(Uint8Array.from(destroyed.receipt.recovery.originalInput))).toBe(wire('Notes-D1-callout-highlight'));
});

test('T08/T12 loading, failed admission, cancellation, callback copies and idempotent teardown',async({page})=>{
  const loading=await call(page,'mount',{fixture:'D0',delayed:true,throwRecovery:true,mutateRecovery:true});expect(loading.lifecycle).toBe('loading');expect(loading.contenteditable).toBe('false');expect(new TextDecoder().decode(Uint8Array.from(loading.originalInput))).toBe(wire('D0'));
  const disposed=await call(page,'dispose',loading.id);expect(disposed.sameReceipt).toBe(true);expect(disposed.receipt.callbackFailure.diagnostic.code).toBe('dom.recovery_callback_failed');expect(new TextDecoder().decode(Uint8Array.from(disposed.receipt.recovery.originalInput))).toBe(wire('D0'));expect(disposed.resources.dom).toMatchObject({listeners:0,observers:0,continuations:0,retainedInputBytes:0,retainedRecoveryRegions:0});
  expect((await call(page,'releaseLoader',loading.id)).lifecycle).toBe('destroyed');
  for(const config of [{source:'{'},{fixture:'D0',badBinding:true},{fixture:'D0',failLoad:true}]){const failed=await call(page,'mount',config);expect(failed.ready).not.toBe('ready');expect(failed.originalInput).not.toBeNull();const receipt=await call(page,'dispose',failed.id);expect(receipt.resources.sdk.sessions).toBe(0);}
});

test('T09/T10/T11 UI modes preserve history, replacement rotates generation and invalid replacement stays intact',async({page})=>{
  const {id}=await call(page,'mount',{fixture:'D0'});await call(page,'select',id,'/0/2',2);await call(page,'command',id,{kind:'insert_text',text:'X'});await call(page,'mark',id,'P1','/0');const before=await checkpoint(page,id,'T09 edited');
  expect((await call(page,'mode',id,'readOnly')).status).toBe('updated');expect(await call(page,'beforeInput',id,'insertText','Q',true)).toBe(true);
  const readonly=await checkpoint(page,id,'T09 readonly');expect(readonly.canonical).toBe(before.canonical);expect(readonly.attributes.contenteditable).toBe('false');expect(readonly.attributes['aria-readonly']).toBe('true');
  expect((await call(page,'command',id,{kind:'insert_text',text:'Y'})).response.status).toBe('ok');expect((await call(page,'mode',id,'disabled')).status).toBe('updated');const disabled=await checkpoint(page,id,'T09 disabled');expect(disabled.attributes.tabindex).toBe('-1');
  await page.locator('#host-recovery-control').focus();await expect(page.locator('#host-recovery-control')).toBeFocused();await call(page,'mode',id,'editable');expect(await call(page,'sameIdentity',id,'P1','/0')).toBe(true);
  const previous=await checkpoint(page,id,'T11 before refusal');expect((await call(page,'replace',id,'{',true)).response.status).toBe('refused');const refused=await checkpoint(page,id,'T11 failed replacement');expect(refused.canonical).toBe(previous.canonical);expect(refused.state).toEqual(previous.state);expect(await call(page,'sameIdentity',id,'P1','/0')).toBe(true);
  expect((await call(page,'replace',id,'T10-replacement')).response.status).toBe('ok');const replaced=await checkpoint(page,id,'T10 replaced');expect(replaced.canonical).toBe(literal('T10-replacement'));expect(replaced.state.stamp.generation).not.toBe(previous.state.stamp.generation);expect(replaced.state.stamp.revision).toBe('0');expect(replaced.state.selection).toBeNull();expect(replaced.state.dirty).toBe(false);history(replaced,0,0);expect(replaced.attributes.contenteditable).toBe('true');expect(replaced.attributes.role).toBe('textbox');
  const ro=await call(page,'mount',{fixture:'D0',access:'read_only'});expect(ro.ready).toBe('ready');expect((await call(page,'mode',ro.id,'editable')).diagnostic.code).toBe('dom.native_read_only');
});

for(const [fixtureName,path,offset]of [['D0','/0/2',2],['T03-initial','/0/0',1]])test(`bounded noncancelable split/join reconciles actual cloned DOM (${fixtureName})`,async({page})=>{
  const {id}=await call(page,'mount',{fixture:fixtureName});await call(page,'select',id,path,offset);const initial=await checkpoint(page,id,'noncancelable initial'),left=stateRow(initial,path).id;
  const split=await call(page,'noncancelable',id,'insertParagraph');expect(split.lifecycle).toBe('ready');let p=await checkpoint(page,id,'noncancelable split');expect(p.canonical).toBe(literal(fixtureName==='D0'?'D1-after-end-split':'T03-split'));unique(p);
  const target=fixtureName==='D0'?'/1':'/1/0';await call(page,'select',id,target,0);const joined=await call(page,'noncancelable',id,'deleteContentBackward');expect(joined.lifecycle).toBe('ready');p=await checkpoint(page,id,'noncancelable join');expect(p.canonical).toBe(literal(fixtureName));caret(p,left,offset);expect(docEvents(p)).toHaveLength(2);
});

test('noncancelable basic RU/EN text uses native command and preserves exact scalars',async({page})=>{
  const {id}=await call(page,'mount',{fixture:'D0'});await call(page,'select',id,'/0/2',2);
  expect((await call(page,'noncancelable',id,'insertText','яZ')).lifecycle).toBe('ready');const p=await checkpoint(page,id,'noncancelable RU EN');expect(stateRow(p,'/0/2').text).toBe('\u00a0ZяZ');expect(docEvents(p)).toHaveLength(1);caret(p,stateRow(p,'/0/2').id,4);
});

test('composition seam preserves actual provisional objects through outside update and destroy callback failure',async({page})=>{
  const {id}=await call(page,'mount',{fixture:'composition-initial',throwRecovery:true});await call(page,'beginComposition',id,'/0/0','o\u0301mega.');
  await call(page,'select',id,'/1/0',4);const outside=await call(page,'command',id,{kind:'insert_text',text:'!'});expect(outside.response.status).toBe('ok');expect(await call(page,'compositionObjectsIntact',id,'/0/0','o\u0301mega.')).toBe(true);
  expect(await call(page,'snapshot',id)).toBe(literal('composition-outside-edit'));const blocked=await call(page,'replace',id,'T10-replacement');expect(blocked.diagnostic.code).toBe('dom.composition_conflict');
  const destroyed=await call(page,'dispose',id);expect(destroyed.receipt.callbackFailure.diagnostic.code).toBe('dom.recovery_callback_failed');expect(destroyed.receipt.recovery.region).toMatchObject({kind:'bounded',originalText:'omega.',provisionalText:'o\u0301mega.'});expect(destroyed.recoveries).toHaveLength(1);
});

test('oversize provisional region transfers untouched actual DOM and second instance remains independent',async({page})=>{
  const a=await call(page,'mount',{fixture:'composition-initial'}),b=await call(page,'mount',{fixture:'D0'});const other=await checkpoint(page,b.id,'T12 second mount');
  await call(page,'beginComposition',a.id,'/0/0','omega.');await page.evaluate(id=>window.domHost.replaceCompositionText(id,'Ж'.repeat(2097153)),a.id);
  const result=await call(page,'dispose',a.id);expect(result.receipt.recovery.region).toMatchObject({kind:'retained_dom',reason:'capture_limit',ownership:'transferred_to_host',connected:true});
  expect(await page.evaluate(id=>document.querySelector(`#${id}`).firstElementChild.firstElementChild.firstChild.data.length,a.id)).toBe(2097153);
  const after=await checkpoint(page,b.id,'T12 second mount unchanged');expect(after.canonical).toBe(other.canonical);expect(after.state).toEqual(other.state);unique(after);
});

test('T12 destroy from native publication listener suppresses later callbacks and releases owners',async({page})=>{
  const {id}=await call(page,'mount',{fixture:'D0'});await call(page,'select',id,'/0/2',2);await call(page,'listenerDestroy',id);await call(page,'command',id,{kind:'insert_text',text:'X'});
  const result=await call(page,'listenerDestroyResult',id);expect(result.calls).toBe(0);expect(result.receipt.status).toBe('destroy_requested');expect(result.resources.dom).toMatchObject({listeners:0,observers:0,continuations:0,retainedInputBytes:0,retainedRecoveryRegions:0});
});

test('derived ordered-list value refusal preserves native publication and exact committed integer',async({page})=>{
  const source='{"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"ordered_list","attrs":{"start":2147483647},"content":[{"type":"list_item","content":[{"type":"paragraph","content":[{"type":"text","text":"A"}]}]},{"type":"list_item","content":[{"type":"paragraph"}]},{"type":"list_item","content":[{"type":"paragraph","content":[{"type":"text","text":"C"}]}]}]}]}';
  const {id}=await call(page,'mount',{source});await call(page,'select',id,'/0/1/0',0);const result=await call(page,'command',id,{kind:'enter'});expect(result.response.status).toBe('ok');
  const p=await checkpoint(page,id,'postpublication derived presentation refusal');expect(p.lifecycle).toBe('recoveryRequired');expect(p.failures.at(-1).diagnostic).toMatchObject({code:'dom.presentation_unsupported',publication:'alreadyPublished'});
  expect(p.canonical).toContain('"start":2147483649');expect(p.canonical).not.toContain('2147483650');expect(p.state.stamp.revision).toBe('1');history(p,1,0);
});
