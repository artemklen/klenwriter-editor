import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {longDocumentFixtures} from './support/large-document-fixtures.mjs';
import {canonicalizeRaw} from '../scripts/canonical-reference/reference.mjs';
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
  expect(record.csp).toContain('img-src http://127.0.0.1:4174/favicon.ico;');
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

async function recordHistoryKeys(page,id) {
  await page.locator(`#${id}`).evaluate(element=>{
    element.historyKeyTrace=[];
    element.addEventListener('keydown',event=>{
      if(event.code==='KeyZ'&&element.historyKeyTrace.length<16)element.historyKeyTrace.push({code:event.code,isTrusted:event.isTrusted,
        metaKey:event.metaKey,ctrlKey:event.ctrlKey,shiftKey:event.shiftKey,defaultPrevented:event.defaultPrevented});
    });
  });
}
async function historyKeys(page,id) {return page.locator(`#${id}`).evaluate(element=>element.historyKeyTrace);}
function historyLogicalRows(point) {
  return point.rows.map(({path,node})=>{
    // Node reads carry the current monotonic stamp, including after history.
    // For this authored D0 text edit only its leaf and ancestors change.
    expect(node.stamp).toEqual(point.state.stamp);
    expect(node.changed_revision).toBe(['','/0','/0/2'].includes(path)?point.state.stamp.revision:'0');
    const {stamp,changed_revision,...logical}=node;return {path,node:logical};
  });
}

for(const modifier of ['Meta','Control'])test(`HK01 real ${modifier}+KeyZ and Shift redo apply one native history unit`,async({page})=>{
  const {id,ready}=await call(page,'mount',{fixture:'D0'});expect(ready).toBe('ready');await call(page,'select',id,'/0/2',2);
  const initial=await checkpoint(page,id,'HK01 initial'),TC=stateRow(initial,'/0/2').id;
  // Native setup creates no browser undo stack. The actions under test below
  // are actual trusted keyboard chords, never the fixture's history() helper.
  expect((await call(page,'command',id,{kind:'insert_text',text:'XY'})).response.status).toBe('ok');
  const inserted=await checkpoint(page,id,'HK01 native setup');expect(inserted.canonical).toBe(literal('T04-XY'));history(inserted,1,0);caret(inserted,TC,4);
  await recordHistoryKeys(page,id);await expect(page.locator(`#${id}`)).toBeFocused();
  await page.keyboard.press(`${modifier}+KeyZ`);const undone=await checkpoint(page,id,'HK01 actual keyboard undo');
  expect(undone.canonical).toBe(literal('D0'));history(undone,0,1);caret(undone,TC,2);expect(docEvents(undone)).toHaveLength(2);
  expect(historyLogicalRows(undone)).toEqual(historyLogicalRows(initial));expect(undone.state.selection).toEqual(initial.state.selection);expect(undone.state.stamp.revision).toBe('2');
  await page.keyboard.press(`Shift+${modifier}+KeyZ`);const redone=await checkpoint(page,id,'HK01 actual keyboard redo');
  expect(redone.canonical).toBe(literal('T04-XY'));history(redone,1,0);caret(redone,TC,4);expect(docEvents(redone)).toHaveLength(3);
  expect(historyLogicalRows(redone)).toEqual(historyLogicalRows(inserted));expect(redone.state.selection).toEqual(inserted.state.selection);expect(redone.state.stamp.revision).toBe('3');
  expect(redone.failures).toEqual([]);expect(await call(page,'nativeSelectionMatches',id,'/0/2',4)).toBe(true);
  const keys=await historyKeys(page,id);expect(keys).toEqual([false,true].map(shiftKey=>({code:'KeyZ',isTrusted:true,metaKey:modifier==='Meta',ctrlKey:modifier==='Control',shiftKey,defaultPrevented:true})));
  observations.get(page).historyKeyboard={scope:'Trusted Playwright keyboard in actual packaged SDK/WASM; not installed OS input',keys};
});

test('HK02 a real shortcut consumes exactly one of two isolated native history units',async({page})=>{
  const {id}=await call(page,'mount',{fixture:'D0'});await call(page,'select',id,'/0/2',2);
  for(const text of ['X','Y'])expect((await call(page,'command',id,{kind:'insert_text',text})).response.status).toBe('ok');
  const inserted=await checkpoint(page,id,'HK02 two independent native setup units');expect(inserted.canonical).toBe(literal('T04-XY'));history(inserted,2,0);
  await recordHistoryKeys(page,id);await page.keyboard.press('Meta+KeyZ');const undone=await checkpoint(page,id,'HK02 exactly one undo');
  expect(undone.canonical).toBe(literal('T04-X'));history(undone,1,1);expect(docEvents(undone)).toHaveLength(3);caret(undone,stateRow(inserted,'/0/2').id,3);
  await page.keyboard.press('Shift+Meta+KeyZ');const redone=await checkpoint(page,id,'HK02 exactly one redo');
  expect(redone.canonical).toBe(literal('T04-XY'));history(redone,2,0);expect(docEvents(redone)).toHaveLength(4);expect(historyLogicalRows(redone)).toEqual(historyLogicalRows(inserted));
  expect(redone.state.selection).toEqual(inserted.state.selection);expect(redone.failures).toEqual([]);
  observations.get(page).historyKeyboard={keys:await historyKeys(page,id)};
});

test('HK03 real keys respect host prevention, foreign focus and read-only owner without native history edits',async({page})=>{
  const {id}=await call(page,'mount',{fixture:'D0'});await call(page,'select',id,'/0/2',2);await call(page,'command',id,{kind:'insert_text',text:'XY'});
  const before=await checkpoint(page,id,'HK03 seeded native history');await recordHistoryKeys(page,id);
  await page.locator(`#${id}`).evaluate(element=>{
    element.preventHistory=event=>{if(event.code==='KeyZ')event.preventDefault();};element.addEventListener('keydown',element.preventHistory,true);
  });
  await page.keyboard.press('Meta+KeyZ');const prevented=await checkpoint(page,id,'HK03 host prevented trusted chord');
  expect(prevented.state).toEqual(before.state);expect(prevented.rows).toEqual(before.rows);expect(prevented.canonical).toBe(before.canonical);expect(prevented.events).toEqual(before.events);
  await page.locator(`#${id}`).evaluate(element=>{element.removeEventListener('keydown',element.preventHistory,true);delete element.preventHistory;});
  await page.locator('#host-recovery-control').focus();await page.keyboard.press('Meta+KeyZ');const outside=await checkpoint(page,id,'HK03 actual foreign focus');
  expect(outside.state).toEqual(before.state);expect(outside.canonical).toBe(before.canonical);expect(outside.events).toEqual(before.events);expect(await historyKeys(page,id)).toHaveLength(1);
  expect((await call(page,'mode',id,'readOnly')).status).toBe('updated');await page.locator(`#${id}`).focus();await expect(page.locator(`#${id}`)).toBeFocused();
  await page.keyboard.press('Meta+KeyZ');const readonly=await checkpoint(page,id,'HK03 owned read-only shortcut');
  expect(readonly.state).toEqual(before.state);expect(readonly.rows).toEqual(before.rows);expect(readonly.canonical).toBe(before.canonical);expect(readonly.events).toEqual(before.events);
  expect(readonly.attributes.contenteditable).toBe('false');expect(readonly.failures.at(-1).diagnostic.code).toBe('dom.mode_blocked');
  const keys=await historyKeys(page,id);expect(keys).toHaveLength(2);for(const key of keys)expect(key).toMatchObject({isTrusted:true,defaultPrevented:true});
  observations.get(page).historyKeyboard={keys};
});

test('HK04 real keyboard history is blocked while controlled composition owns the provisional DOM',async({page})=>{
  const {id}=await call(page,'mount',{fixture:'composition-initial'});await call(page,'select',id,'/1/0',4);await call(page,'command',id,{kind:'insert_text',text:'!'});
  // Composition construction is explicitly controlled setup, not an OS IME
  // claim. The history chord itself is trusted browser keyboard input.
  await call(page,'beginComposition',id,'/0/0','o\u0301mega.');const before=await checkpoint(page,id,'HK04 actual protected owner');history(before,1,0);await recordHistoryKeys(page,id);
  await page.keyboard.press('Meta+KeyZ');const after=await checkpoint(page,id,'HK04 trusted keyboard under protected composition');
  expect(after.state).toEqual(before.state);expect(after.rows).toEqual(before.rows);expect(after.canonical).toBe(before.canonical);expect(after.events).toEqual(before.events);
  expect(await call(page,'compositionObjectsIntact',id,'/0/0','o\u0301mega.')).toBe(true);history(after,1,0);
  const keys=await historyKeys(page,id);expect(keys).toHaveLength(1);expect(keys[0]).toMatchObject({isTrusted:true,defaultPrevented:true});observations.get(page).historyKeyboard={compositionSetup:'controlled CompositionEvent and provisional region',keys};
});

test('T01/T06 exact authored text, nine marks, twelve nodes, attrs and safe static presentation',async({page})=>{
  const initial=await call(page,'mount',{fixture:'D0'});expect(initial.ready).toBe('ready');expect(initial.originalInput).toBeNull();
  const id=initial.id;await call(page,'select',id,'/0/2',2);
  const p=await checkpoint(page,id,'T01 initial');expect(p.canonical).toBe(literal('D0'));expect(p.state.stamp.revision).toBe('0');history(p,0,0);expect(p.state.dirty).toBe(false);
  expect(p.domText).toBe('А😀 e\u0301\u00a0ZБета');expect(stateRow(p,'/0').attributes).toEqual({align:{kind:'string',value:'right'},first_line_indent:{kind:'boolean',value:true}});
  expect(stateRow(p,'/0/1').marks.map(mark=>mark.type_id)).toEqual(['org.klenwriter.kwdj/strong']);caret(p,stateRow(p,'/0/2').id,2);unique(p);
  expect(await call(page,'nativeSelectionMatches',id,'/0/2',2)).toBe(true);
  const catalog=await call(page,'mount',{fixture:'KWDJ-basic-catalog'});expect(catalog.ready).toBe('ready');const rendered=await checkpoint(page,catalog.id,'T06 complete supported catalog');
  expect(rendered.canonical).toBe(literal('KWDJ-basic-catalog'));expect(new Set(rendered.rows.filter(x=>x.node.type_id).map(x=>x.node.type_id)).size).toBe(12);
  const semantic=await page.locator(`#${catalog.id}`).evaluate(el=>({h:el.querySelector('h2')?.textContent,quote:!!el.querySelector('blockquote'),lists:el.querySelectorAll('ul,ol').length,start:el.querySelector('ol')?.getAttribute('start'),
    validListChildren:[...el.querySelectorAll('ul,ol')].every(list=>[...list.children].every(item=>item.tagName==='LI'&&!item.hasAttribute('role'))),
    tasks:[...el.querySelectorAll('.editor-task-item')].map(item=>({tag:item.tagName,parent:item.parentElement.tagName,title:item.getAttribute('title'),role:item.getAttribute('role'),ariaChecked:item.getAttribute('aria-checked'),checked:item.classList.contains('editor-checked'),text:item.textContent})),
    atom:el.querySelector('hr')?.getAttribute('contenteditable'),strong:!!el.querySelector('strong'),code:el.querySelector('pre')?.textContent,whiteSpace:getComputedStyle(el).whiteSpace}));
  expect(semantic).toMatchObject({h:'Heading',quote:true,lists:3,start:'3',validListChildren:true,atom:'false',strong:true,whiteSpace:'pre-wrap'});
  expect(semantic.tasks).toEqual([
    {tag:'LI',parent:'UL',title:'Completed task',role:null,ariaChecked:null,checked:true,text:'Checked'},
    {tag:'LI',parent:'UL',title:'Incomplete task',role:null,ariaChecked:null,checked:false,text:'Unchecked'},
  ]);
  expect(rendered.rows.filter(row=>row.node.type_id==='org.klenwriter.kwdj/task_item').map(row=>row.node.attributes.checked)).toEqual([{kind:'boolean',value:true},{kind:'boolean',value:false}]);
  const safe=await call(page,'mount',{fixture:'T06-safe-data'});expect(safe.ready).toBe('ready');expect((await checkpoint(page,safe.id,'T06 data')).canonical).toBe(literal('T06-safe-data'));
  expect(await page.locator(`#${safe.id} script, #${safe.id} img, #${safe.id} iframe, #${safe.id} style`).count()).toBe(0);
  expect(await call(page,'brandCheck')).toBe(true);
});

test('T06 complete basic catalog has named host and valid static accessibility semantics',async({page})=>{
  const mounted=await call(page,'mount',{fixture:'KWDJ-basic-catalog'});expect(mounted.ready).toBe('ready');
  expect(await call(page,'snapshot',mounted.id)).toBe(literal('KWDJ-basic-catalog'));
  await expect(page.getByRole('textbox',{name:'KlenWriter editor example 1'})).toBeVisible();
  // Unmodified axe defaults, scoped to this actual mounted catalog. This is a
  // static OSR-39 smoke; wider assistive technology acceptance remains OSR-69.
  const result=await new AxeBuilder({page}).include(`#${mounted.id}`).analyze();
  observations.get(page).axe={engine:result.testEngine,scope:'Actual mounted KWDJ basic catalog static semantics; OSR-39 smoke only',
    violations:result.violations,incomplete:result.incomplete,passedRules:result.passes.map(rule=>rule.id)};
  expect(result.violations).toEqual([]);expect(result.incomplete).toEqual([]);expect(result.passes.length).toBeGreaterThan(0);
});

test('T09 keyboard Tab return preserves current native caret and every committed facet before and after deletion',async({page})=>{
  const mounted=await call(page,'mount',{fixture:'D0'});expect(mounted.ready).toBe('ready');
  const id=mounted.id;await call(page,'select',id,'/0/2',2);
  const initial=await checkpoint(page,id,'T09 before initial Tab return'),TC=stateRow(initial,'/0/2').id;
  expect(initial.canonical).toBe(literal('D0'));expect(initial.state.stamp.revision).toBe('0');history(initial,0,0);caret(initial,TC,2);
  async function tabReturn(before,offset,label) {
    await page.locator('#host-recovery-control').focus();await expect(page.locator('#host-recovery-control')).toBeFocused();
    // Automated keyboard entry is the action under test. Do not focus/reselect the
    // editor from the fixture after Tab: that would conceal Safari's reset.
    await page.keyboard.press('Tab');await expect(page.locator(`#${id}`)).toBeFocused();
    await expect.poll(()=>call(page,'nativeSelectionMatches',id,'/0/2',offset)).toBe(true);
    const after=await checkpoint(page,id,label);
    expect(after.state).toEqual(before.state);expect(after.capture).toEqual(before.capture);
    expect(after.rows).toEqual(before.rows);expect(after.canonical).toBe(before.canonical);
    expect(after.events).toEqual(before.events);expect(after.ids).toEqual(before.ids);
    expect(after.actualSelection).toEqual(before.actualSelection);expect(after.failures).toEqual([]);
    caret(after,TC,offset);unique(after);return after;
  }
  await tabReturn(initial,2,'T09 initial keyboard Tab return');
  expect((await call(page,'command',id,{kind:'insert_text',text:'XY'})).response.status).toBe('ok');
  await page.keyboard.press('Backspace');
  const deleted=await checkpoint(page,id,'T09 current caret after deletion');
  expect(deleted.canonical).toBe(literal('T04-X'));expect(deleted.state.stamp.revision).toBe('2');history(deleted,2,0);
  expect(docEvents(deleted)).toHaveLength(2);caret(deleted,TC,3);
  // The second return must restore the current offset3, not the initial offset2.
  await tabReturn(deleted,3,'T09 post-delete keyboard Tab return');
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

test('OSR-277 mounted scene break insert and keyboard deletion preserve a neighboring caret', async ({ page }) => {
  const left = { content: [{ text: 'До сцены', type: 'text' }], type: 'paragraph' };
  const right = { content: [{ text: 'После сцены', type: 'text' }], type: 'paragraph' };
  const documentBytes = content => JSON.stringify({ content, profile: 'prose', schema: 'klenwriter.document', schema_version: 1 });
  const original = documentBytes([left, right]);
  const inserted = documentBytes([left, { type: 'scene_break' }, right]);
  const { id, ready } = await call(page, 'mount', { source: original });
  expect(ready).toBe('ready');
  await call(page, 'select', id, '', 1);
  const before = await checkpoint(page, id, 'OSR-139 original document and root gap');
  const leftLeaf = stateRow(before, '/0/0').id;
  const rightLeaf = stateRow(before, '/1/0').id;
  expect(before.canonical).toBe(original);
  caret(before, before.state.root, 1, 'child');

  const command = await call(page, 'command', id, { kind: 'insert_block', target: { kind: 'scene_break' } });
  expect(command.response.status).toBe('ok');
  const afterInsert = await checkpoint(page, id, 'OSR-139 exact inserted bytes and atom after edge');
  expect(afterInsert.canonical).toBe(inserted);
  const atom = stateRow(afterInsert, '/1').id;
  const edge = { kind: 'edge', node: atom, side: 'after' };
  expect(afterInsert.state.selection).toEqual({ anchor: edge, focus: edge });
  const host = page.locator(`#${id}`);
  await expect(host).toBeFocused();
  await expect(host.locator('hr.editor-scene-break')).toHaveCount(1);
  await host.evaluate(element => {
    element.sceneBreakInput = null;
    element.addEventListener('beforeinput', event => {
      element.sceneBreakInput = {
        inputType: event.inputType, trusted: event.isTrusted, prevented: event.defaultPrevented,
      };
    }, { once: true });
  });

  await page.keyboard.press('Backspace');
  const input = await host.evaluate(element => element.sceneBreakInput);
  expect(input).toEqual({ inputType: 'deleteContentBackward', trusted: true, prevented: true });
  observations.get(page).sceneBreakInput = input;
  const afterDelete = await checkpoint(page, id, 'keyboard deletion and caret at preceding text end');
  expect(afterDelete.canonical).toBe(original);
  expect(stateRow(afterDelete, '/0/0').id).toBe(leftLeaf);
  expect(stateRow(afterDelete, '/1/0').id).toBe(rightLeaf);
  caret(afterDelete, leftLeaf, 8);
  expect(await call(page, 'nativeSelectionMatches', id, '/0/0', 8)).toBe(true);
  expect(afterDelete.state.stamp.revision).toBe('2');
  expect(docEvents(afterDelete)).toHaveLength(2);
  expect(afterDelete.failures).toEqual([]);
  await expect(host.locator('hr.editor-scene-break')).toHaveCount(0);
});

function approvedMedia(caseId) {
  const family = caseId === 'DOC-022' ? 'mixed' : 'positive';
  const corpus = JSON.parse(readFileSync(`contracts/kwdj/v1/fixtures/${family}.json`, 'utf8'));
  const fixture = corpus.fixtures.find(item => item.id === caseId).cases[0];
  const media = fixture.kwdj.content.find(node => node.type === 'media_image');
  expect(fixture.input.identity_state.existing_media_ids).toContain(media.attrs.media_asset_id);
  return media;
}

test('OSR-141 mounted media retains its accessible name and caption during keyboard delete and Undo', async ({ page }) => {
  // DOC-013 supplies authored alt and a caption, DOC-022 supplies escaping-sensitive alt.
  const media = approvedMedia('DOC-013');
  const escapedMedia = approvedMedia('DOC-022');
  const decorative = approvedMedia('DOC-027');
  delete decorative.attrs.alt;
  decorative.attrs.decorative = true;
  const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  const doc = content => canonicalizeRaw(JSON.stringify({ schema: 'klenwriter.document', schema_version: 1, profile: 'prose', content }));
  const left = paragraph('Before');
  const right = paragraph('After');
  const source = doc([left, media, right, escapedMedia, decorative]);
  const removed = doc([left, right, escapedMedia, decorative]);
  const mediaIds = [...new Set([media, escapedMedia, decorative].map(block => block.attrs.media_asset_id))];
  const contentRequests = [];
  page.on('request', request => {
    if (['fetch', 'xhr', 'image'].includes(request.resourceType())
      && new URL(request.url()).pathname !== '/favicon.ico') contentRequests.push(request.url());
  });
  const { id, ready, diagnostic, nativeResponse } = await call(page, 'mount', { source, mediaIds });
  expect(ready, JSON.stringify({ diagnostic, nativeResponse })).toBe('ready');

  const host = page.locator(`#${id}`);
  const roots = host.locator(':scope > [data-editor-node]');
  const placeholders = host.locator('.editor-media-placeholder');
  const namedPlaceholder = host.getByRole('group');
  await expect(placeholders).toHaveCount(3);
  await expect(namedPlaceholder).toHaveCount(2);
  await expect(namedPlaceholder.nth(0)).toHaveAccessibleName(media.attrs.alt);
  await expect(namedPlaceholder.nth(1)).toHaveAccessibleName(escapedMedia.attrs.alt);
  expect(await placeholders.nth(2).getAttribute('aria-label')).toBeNull();
  expect(await placeholders.evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element, '::before');
    return [style.display, style.borderTopStyle];
  }))).toEqual([['block', 'dashed'], ['block', 'dashed'], ['block', 'dashed']]);
  const caption = media.content[0].content.map(leaf => leaf.text).join('');
  await expect(roots.nth(1).locator('p')).toHaveText(caption);
  expect(await roots.nth(1).locator('p').evaluate(element => element.isContentEditable)).toBe(true);
  await expect(host.locator('img[src], picture, [srcset], [onerror]')).toHaveCount(0);

  await call(page, 'select', id, '', 1, '', 2);
  const selected = await checkpoint(page, id, 'whole media root offsets before trusted deletion');
  expect(selected.canonical).toBe(source);
  expect(selected.actualSelection).toMatchObject({ anchorOffset: 1, focusOffset: 2, inside: true });
  const gap = index => ({ kind: 'child', parent: selected.state.root, index, affinity: 'after' });
  expect(selected.state.selection).toEqual({ anchor: gap(1), focus: gap(2) });
  const originalBlock = stateRow(selected, '/1');
  const leftId = stateRow(selected, '/0').id;
  const rightId = stateRow(selected, '/2').id;
  expect(originalBlock.type_id).toBe('org.klenwriter.kwdj/media_image');
  expect(originalBlock.attributes.media_asset_id.value).toBe(media.attrs.media_asset_id);
  const deleteWithKeyboard = async () => {
    await expect(host).toBeFocused();
    await host.evaluate(element => {
      element.mediaDeleteInput = null;
      element.addEventListener('beforeinput', event => {
        element.mediaDeleteInput = {
          inputType: event.inputType, trusted: event.isTrusted, prevented: event.defaultPrevented,
        };
      }, { once: true });
    });
    await page.keyboard.press('Delete');
    const input = await host.evaluate(element => element.mediaDeleteInput);
    expect(input).toMatchObject({ trusted: true, prevented: true });
    expect(['deleteContentForward', 'deleteContentBackward']).toContain(input.inputType);
    return input;
  };

  observations.get(page).mediaDeleteInput = await deleteWithKeyboard();
  const after = await checkpoint(page, id, 'trusted Delete published exactly one whole-media removal');
  expect(after.canonical).toBe(removed);
  expect(stateRow(after, '/0').id).toBe(leftId);
  expect(stateRow(after, '/1').id).toBe(rightId);
  history(after, 1, 0);
  expect(docEvents(after)).toHaveLength(1);
  expect(after.failures).toEqual([]);
  await expect(namedPlaceholder).toHaveCount(1);

  await recordHistoryKeys(page, id);
  await page.keyboard.press('Meta+KeyZ');
  const undone = await checkpoint(page, id, 'trusted Undo revived the original media and caption');
  expect(undone.canonical).toBe(source);
  expect(stateRow(undone, '/1').id).toBe(originalBlock.id);
  expect(stateRow(undone, '/1').attributes).toEqual(originalBlock.attributes);
  expect(await historyKeys(page, id)).toEqual([{
    code: 'KeyZ', isTrusted: true, metaKey: true, ctrlKey: false, shiftKey: false, defaultPrevented: true,
  }]);
  history(undone, 0, 1);
  expect(docEvents(undone)).toHaveLength(2);
  expect(undone.failures).toEqual([]);
  await expect(namedPlaceholder.nth(0)).toHaveAccessibleName(media.attrs.alt);
  await expect(roots.nth(1).locator('p')).toHaveText(caption);

  const editedMedia = structuredClone(media);
  editedMedia.content[0].content[0].text = 'Ппись';
  await call(page, 'select', id, '/1/0/0', 1, '/1/0/0', 3);
  observations.get(page).captionDeleteInput = await deleteWithKeyboard();
  const edited = await checkpoint(page, id, 'trusted Delete removed only the selected caption text');
  expect(edited.canonical).toBe(doc([left, editedMedia, right, escapedMedia, decorative]));
  expect(stateRow(edited, '/1').id).toBe(originalBlock.id);
  expect(stateRow(edited, '/1').attributes).toEqual(originalBlock.attributes);
  expect(edited.failures).toEqual([]);
  history(edited, 1, 0);
  expect(docEvents(edited)).toHaveLength(3);
  await expect(roots.nth(1).locator('p')).toHaveText('Ппись');

  await page.keyboard.press('Meta+KeyZ');
  const captionUndone = await checkpoint(page, id, 'trusted Undo restored the selected caption text');
  expect(captionUndone.canonical).toBe(source);
  expect(captionUndone.failures).toEqual([]);
  history(captionUndone, 0, 1);
  expect(docEvents(captionUndone)).toHaveLength(4);
  await expect(roots.nth(1).locator('p')).toHaveText(caption);
  await expect(host.locator('img[src], picture, [srcset], [onerror]')).toHaveCount(0);
  expect(contentRequests).toEqual([]);
});

test('T02 selected-empty join restores surviving DOM caret before the first structural mutation',async({page})=>{
  const mounted=await call(page,'mount',{fixture:'D1-after-end-split'});expect(mounted.ready).toBe('ready');
  const id=mounted.id;await call(page,'select',id,'/1',0);
  const before=await checkpoint(page,id,'T02 literal selected-empty before join');
  const TC=stateRow(before,'/0/2').id,P2=stateRow(before,'/2').id,empty=stateRow(before,'/1').id;
  expect(before.canonical).toBe(literal('D1-after-end-split'));expect(before.state.stamp.revision).toBe('0');history(before,0,0);
  expect(stateRow(before,'/1').children).toEqual([]);caret(before,empty,0,'child');
  const selected=await page.evaluate(id=>{
    const node=window.domHost.domAt(id,'/1'),selection=document.getSelection();
    return {anchor:selection?.anchorNode===node,focus:selection?.focusNode===node,anchorOffset:selection?.anchorOffset,focusOffset:selection?.focusOffset};
  },id);
  expect(selected).toEqual({anchor:true,focus:true,anchorOffset:0,focusOffset:0});
  await page.evaluate(id=>{
    const host=document.getElementById(id),selected=window.domHost.domAt(id,'/1');
    const target=window.domHost.leaf(id,'/0/2'),p2=window.domHost.domAt(id,'/2');
    const snapshots=[],saved=[];let dropped=0;
    // Observe only this owner's three structural entrypoints. No SDK calls,
    // range writes, event dispatch, or changes to the original method behavior.
    function observe(method,phase) {
      if(snapshots.length===64){dropped++;return;}
      const selection=document.getSelection();
      snapshots.push({method,phase,anchorIsTC:selection?.anchorNode===target,focusIsTC:selection?.focusNode===target,
        anchorOffset:selection?.anchorOffset??null,focusOffset:selection?.focusOffset??null,
        anchorIsSelectedEmpty:selection?.anchorNode===selected,focusIsSelectedEmpty:selection?.focusNode===selected,
        targetConnected:target.isConnected,selectedConnected:selected.isConnected});
    }
    for(const [owner,name] of [[host,'insertBefore'],[host,'removeChild'],[selected,'remove']]) {
      const descriptor=Object.getOwnPropertyDescriptor(owner,name),original=owner[name];saved.push({owner,name,descriptor});
      Object.defineProperty(owner,name,{configurable:true,writable:true,value:function(...args){
        observe(name,'before');try{return Reflect.apply(original,this,args);}finally{observe(name,'after');}
      }});
    }
    window.selectedEmptyJoinProbe={snapshots,target,p2,selected,get dropped(){return dropped;},restore(){
      for(const {owner,name,descriptor} of saved.reverse())if(descriptor)Object.defineProperty(owner,name,descriptor);else delete owner[name];
    }};
  },id);
  let probe;
  try {
    // Automated keyboard input drives the actual mounted command/event path.
    await page.keyboard.press('Backspace');
  } finally {
    probe=await page.evaluate(()=>{
      const probe=window.selectedEmptyJoinProbe;
      try{return {snapshots:probe.snapshots,dropped:probe.dropped};}finally{probe.restore();}
    });
    observations.get(page).selectedEmptyJoin=probe;
  }
  const joined=await checkpoint(page,id,'T02 selected-empty after keyboard join');
  const identity=await page.evaluate(id=>{
    const probe=window.selectedEmptyJoinProbe;
    try{return {sameTC:window.domHost.leaf(id,'/0/2')===probe.target,sameP2:window.domHost.domAt(id,'/1')===probe.p2,
      emptyDetached:!probe.selected.isConnected,selectedTC:window.domHost.nativeSelectionMatches(id,'/0/2',2)};}finally{delete window.selectedEmptyJoinProbe;}
  },id);
  expect(probe.dropped).toBe(0);expect(probe.snapshots.length).toBeGreaterThan(0);
  // This is an independent transient invariant: at the VERY FIRST structural
  // mutation, the raw Selection must already target the surviving literal TC2.
  expect(probe.snapshots[0]).toMatchObject({phase:'before',anchorIsTC:true,focusIsTC:true,anchorOffset:2,focusOffset:2,targetConnected:true,selectedConnected:true});
  expect(joined.canonical).toBe(literal('D0'));caret(joined,TC,2);expect(joined.state.stamp.revision).toBe('1');history(joined,1,0);
  expect(docEvents(joined)).toHaveLength(1);expect(joined.failures).toEqual([]);expect(joined.lifecycle).toBe('ready');
  expect(stateRow(joined,'/0/2').id).toBe(TC);expect(stateRow(joined,'/1').id).toBe(P2);expect(joined.rows.some(row=>row.node.id===empty)).toBe(false);
  expect(identity).toEqual({sameTC:true,sameP2:true,emptyDetached:true,selectedTC:true});unique(joined);
  expect(joined.resources).toEqual(before.resources);
  const disposed=await call(page,'dispose',id);
  expect(disposed.resources.dom).toEqual({listeners:0,observers:0,continuations:0,retainedInputBytes:0,retainedRecoveryRegions:0});
  expect(disposed.native).toEqual({sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});
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
  // Clearing this mount's authoritative null selection must preserve another
  // instance's actual browser range, including its native read-only selection.
  await call(page,'select',ro.id,'/0/2',1);expect(await call(page,'nativeSelectionMatches',ro.id,'/0/2',1)).toBe(true);
  expect((await call(page,'replace',id,'T10-replacement')).response.status).toBe('ok');
  const replacedAgain=await checkpoint(page,id,'T10 replacement preserves another owner selection');expect(replacedAgain.state.selection).toBeNull();
  expect(await call(page,'nativeSelectionMatches',ro.id,'/0/2',1)).toBe(true);
});

for(const [fixtureName,path,offset]of [['D0','/0/2',2],['T03-initial','/0/0',1]])test(`bounded noncancelable split/join reconciles actual cloned DOM (${fixtureName})`,async({page})=>{
  const {id}=await call(page,'mount',{fixture:fixtureName});await call(page,'select',id,path,offset);const initial=await checkpoint(page,id,'noncancelable initial'),left=stateRow(initial,path).id;
  const split=await call(page,'noncancelable',id,'insertParagraph');expect(split.lifecycle).toBe('ready');expect(split.clonedIdObserved).toBe(true);let p=await checkpoint(page,id,'noncancelable split');expect(p.canonical).toBe(literal(fixtureName==='D0'?'D1-after-end-split':'T03-split'));unique(p);
  const target=fixtureName==='D0'?'/1':'/1/0';await call(page,'select',id,target,0);const joined=await call(page,'noncancelable',id,'deleteContentBackward');expect(joined.lifecycle).toBe('ready');p=await checkpoint(page,id,'noncancelable join');expect(p.canonical).toBe(literal(fixtureName));caret(p,left,offset);expect(docEvents(p)).toHaveLength(2);
});

test('ordinary EN typing and engine-specific RU insertion preserve exact scalars',async({page,browserName})=>{
  const {id}=await call(page,'mount',{fixture:'D0'});await call(page,'select',id,'/0/2',2);
  await page.locator(`#${id}`).evaluate(element=>{element.typingTrace=[];for(const type of ['beforeinput','input','compositionstart','compositionupdate','compositionend'])element.addEventListener(type,event=>{if(element.typingTrace.length<64)element.typingTrace.push({type:event.type,inputType:event.inputType??null,data:event.data??null,isComposing:event.isComposing??false,isTrusted:event.isTrusted,cancelable:event.cancelable,defaultPrevented:event.defaultPrevented});});});
  await page.keyboard.type('Az');const en=await checkpoint(page,id,'ordinary keyboard EN');expect(stateRow(en,'/0/2').text).toBe('\u00a0ZAz');expect(docEvents(en)).toHaveLength(2);caret(en,stateRow(en,'/0/2').id,4);
  await page.keyboard.insertText('я');
  const trace=await page.locator(`#${id}`).evaluate(element=>element.typingTrace);observations.get(page).typingTrace=trace;
  if(browserName==='firefox') {
    // Firefox insertText uses its real composition event path. OSR-41 now
    // settles it; this automated insertion remains distinct from OS IME input.
    expect(trace.some(event=>event.type==='compositionstart')).toBe(true);expect(trace.some(event=>event.type==='compositionend')).toBe(true);
  } else {
    expect(trace.some(event=>event.type==='compositionstart')).toBe(false);
  }
  await expect.poll(async()=>(await call(page,'inspect',id)).state.stamp.revision,{timeout:2000}).toBe('3');
  const p=await checkpoint(page,id,'engine-specific RU insertText settled');expect(p.lifecycle).toBe('ready');expect(p.failures).toEqual([]);
  expect(p.state.stamp).toMatchObject({revision:'3',selection_epoch:'4',history_epoch:'3'});
  expect(stateRow(p,'/0/2').text).toBe('\u00a0ZAzя');expect(p.canonical).toBe(literal('D0').replace('\u00a0Z','\u00a0ZAzя'));expect(p.domText).toBe('А😀 e\u0301\u00a0ZAzяБета');
  expect(docEvents(p)).toHaveLength(3);history(p,3,0);caret(p,stateRow(p,'/0/2').id,5);expect(await call(page,'nativeSelectionMatches',id,'/0/2',5)).toBe(true);
  const semanticRows=(point,revision)=>point.rows.map(({path,node})=>{
    // History restores content and identity while native counters stay monotonic.
    expect(node.stamp).toEqual(point.state.stamp);expect(node.changed_revision).toBe(['','/0','/0/2'].includes(path)?revision:'0');
    const {stamp,changed_revision,...semantic}=node;return {path,node:semantic};
  });
  expect((await call(page,'history',id,'undo')).response.status).toBe('ok');const undone=await checkpoint(page,id,'RU insertion one-unit undo');expect(undone.canonical).toBe(en.canonical);expect(undone.state.stamp).toEqual({...p.state.stamp,revision:'4',selection_epoch:'5',history_epoch:'4'});expect(semanticRows(undone,'4')).toEqual(semanticRows(en,'2'));expect(undone.state.selection).toEqual(en.state.selection);history(undone,2,1);
  expect((await call(page,'history',id,'redo')).response.status).toBe('ok');const redone=await checkpoint(page,id,'RU insertion exact redo');expect(redone.canonical).toBe(p.canonical);expect(redone.state.stamp).toEqual({...p.state.stamp,revision:'5',selection_epoch:'6',history_epoch:'5'});expect(semanticRows(redone,'5')).toEqual(semanticRows(p,'3'));history(redone,3,0);caret(redone,stateRow(redone,'/0/2').id,5);
  const disposed=await call(page,'dispose',id);observations.get(page).typingRecovery=disposed;expect(disposed.receipt.recovery).toBeNull();expect(disposed.recoveries).toHaveLength(0);
});

test('noncancelable basic RU/EN text uses native command and preserves exact scalars',async({page})=>{
  const {id}=await call(page,'mount',{fixture:'D0'});await call(page,'select',id,'/0/2',2);
  expect((await call(page,'noncancelable',id,'insertText','яZ')).lifecycle).toBe('ready');const p=await checkpoint(page,id,'noncancelable RU EN');expect(stateRow(p,'/0/2').text).toBe('\u00a0ZяZ');expect(docEvents(p)).toHaveLength(1);caret(p,stateRow(p,'/0/2').id,4);
});

test('noncancelable text after authored hard break preserves literal structure and native caret',async({page})=>{
  const source='{"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[{"type":"text","text":"a"},{"type":"hard_break"},{"type":"text","text":"b"}]}]}';
  const expected='{"content":[{"content":[{"text":"a","type":"text"},{"type":"hard_break"},{"text":"bя","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}';
  const {id}=await call(page,'mount',{source});await call(page,'select',id,'/0/2',1);
  const initial=await checkpoint(page,id,'authored hard break before noncancelable insert'),B=stateRow(initial,'/0/2').id;
  expect((await call(page,'noncancelable',id,'insertText','я')).lifecycle).toBe('ready');
  const after=await checkpoint(page,id,'authored hard break after noncancelable insert');
  expect(after.canonical).toBe(expected);expect(stateRow(after,'/0/1').type_id).toBe('org.klenwriter.kwdj/hard_break');
  expect(stateRow(after,'/0/2').id).toBe(B);caret(after,B,2);expect(after.state.stamp.revision).toBe('1');expect(docEvents(after)).toHaveLength(1);
});

test('malformed public requests during composition refuse without invoking accessors or native changes',async({page})=>{
  const {id}=await call(page,'mount',{fixture:'composition-initial'});await call(page,'beginComposition',id,'/0/0','o\u0301mega.');
  const result=await call(page,'malformedCompositionRequests',id);observations.get(page).malformedComposition=result;
  expect(result.results).toHaveLength(4);for(const refusal of result.results)expect(refusal).toMatchObject({status:'dom_refused',diagnostic:{code:'dom.invalid_options',publication:'none'}});
  expect(result.accessorCalls).toBe(0);expect(result.after).toEqual(result.before);expect(result.lifecycle).toBe('ready');
  expect(await call(page,'compositionObjectsIntact',id,'/0/0','o\u0301mega.')).toBe(true);
  expect(await call(page,'snapshot',id)).toBe(literal('composition-initial'));
});

test('composition seam preserves actual provisional objects through outside update and destroy callback failure',async({page})=>{
  const {id}=await call(page,'mount',{fixture:'composition-initial',throwRecovery:true});await call(page,'beginComposition',id,'/0/0','o\u0301mega.');
  await call(page,'select',id,'/1/0',4);const outside=await call(page,'command',id,{kind:'insert_text',text:'!'});expect(outside.response.status).toBe('ok');expect(await call(page,'compositionObjectsIntact',id,'/0/0','o\u0301mega.')).toBe(true);
  expect(await call(page,'snapshot',id)).toBe(literal('composition-outside-edit'));const blocked=await call(page,'replace',id,'T10-replacement');expect(blocked.diagnostic.code).toBe('dom.composition_conflict');
  const destroyed=await call(page,'dispose',id);expect(destroyed.receipt.callbackFailure.diagnostic.code).toBe('dom.recovery_callback_failed');expect(destroyed.receipt.recovery.region).toMatchObject({kind:'bounded',originalText:'omega.',provisionalText:'o\u0301mega.'});expect(destroyed.recoveries).toHaveLength(1);
});

test('oversize provisional region transfers untouched actual DOM and second instance remains independent',async({page})=>{
  const a=await call(page,'mount',{fixture:'composition-initial',throwRecovery:true}),b=await call(page,'mount',{fixture:'D0'});const other=await checkpoint(page,b.id,'T12 second mount');
  await call(page,'beginComposition',a.id,'/0/0','omega.');await page.evaluate(id=>{document.querySelector(`#${id}`).hidden=true;window.domHost.replaceCompositionText(id,'Ж'.repeat(2097153));},a.id);
  const result=await call(page,'dispose',a.id);expect(result.receipt.callbackFailure.diagnostic.code).toBe('dom.recovery_callback_failed');expect(result.receipt.recovery.region).toMatchObject({kind:'retained_dom',reason:'capture_limit',ownership:'transferred_to_host',connected:true});
  expect(await page.evaluate(id=>document.querySelector(`#${id}`).firstElementChild.firstElementChild.firstChild.data.length,a.id)).toBe(2097153);
  const after=await checkpoint(page,b.id,'T12 second mount unchanged');expect(after.canonical).toBe(other.canonical);expect(after.state).toEqual(other.state);unique(after);
});

test('T12 destroy from native publication listener suppresses later callbacks and releases owners',async({page})=>{
  const {id}=await call(page,'mount',{fixture:'D0'});await call(page,'select',id,'/0/2',2);await call(page,'listenerDestroy',id);await call(page,'command',id,{kind:'insert_text',text:'X'});
  const result=await call(page,'listenerDestroyResult',id);expect(result.calls).toBe(0);expect(result.receipt.status).toBe('destroy_requested');expect(result.resources.dom).toMatchObject({listeners:0,observers:0,continuations:0,retainedInputBytes:0,retainedRecoveryRegions:0});
});

test('derived ordered-list value refusal preserves native publication and exact committed integer',async({page})=>{
  const source='{"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"ordered_list","attrs":{"start":2147483647},"content":[{"type":"list_item","content":[{"type":"paragraph","content":[{"type":"text","text":"A"}]}]},{"type":"list_item","content":[{"type":"paragraph","content":[]}]},{"type":"list_item","content":[{"type":"paragraph","content":[{"type":"text","text":"C"}]}]}]}]}';
  const {id}=await call(page,'mount',{source});await call(page,'select',id,'/0/1/0',0);const result=await call(page,'command',id,{kind:'enter'});expect(result.response.status).toBe('ok');
  const p=await checkpoint(page,id,'postpublication derived presentation refusal');expect(p.lifecycle).toBe('recoveryRequired');expect(p.failures.at(-1).diagnostic).toMatchObject({code:'dom.presentation_unsupported',publication:'alreadyPublished'});
  expect(p.canonical).toBe('{"content":[{"attrs":{"start":2147483647},"content":[{"content":[{"content":[{"text":"A","type":"text"}],"type":"paragraph"}],"type":"list_item"}],"type":"ordered_list"},{"content":[],"type":"paragraph"},{"attrs":{"start":2147483649},"content":[{"content":[{"content":[{"text":"C","type":"text"}],"type":"paragraph"}],"type":"list_item"}],"type":"ordered_list"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}');expect(p.state.stamp.revision).toBe('1');history(p,1,0);
});

test('destroy captures latest unresolved provisional DOM after recovery and a late input',async({page})=>{
  const {id}=await call(page,'mount',{fixture:'composition-initial'});
  await call(page,'beginComposition',id,'/0/0','o\u0301mega.');
  await page.evaluate(id=>document.querySelector(`#${id}`).dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:''})),id);
  // OSR-41 settlement is unclaimed: emulate a browser-owned trailing DOM change
  // after recovery. Teardown must preserve the actual latest region nonetheless.
  await page.evaluate(id=>{window.domHost.replaceCompositionText(id,'o\u0301mega.終');window.domHost.input(id,'insertCompositionText','終');},id);
  const destroyed=await call(page,'dispose',id);
  expect(destroyed.receipt.recovery.region).toMatchObject({kind:'bounded',originalText:'omega.',provisionalText:'o\u0301mega.終'});
});


test('controlled transport fatal during initial native node read keeps original envelope and input',async({page})=>{
  const result=await call(page,'mount',{fixture:'D0',faultKind:'node'});observations.get(page).controlledFault=result;
  expect(result.ready).toBe('sdk_failure');expect(result.nativeResponse).toMatchObject({status:'fatal',diagnostic:{code:'fixture.native_fatal',path:'/controlled-transport',category:'transport',details:{fixture:'dom-mounted-controlled-reply'},may_have_committed:false}});
  expect(result.lifecycle).toBe('fatal');expect(new TextDecoder().decode(Uint8Array.from(result.originalInput))).toBe(wire('D0'));
  const disposed=await call(page,'dispose',result.id);expect(disposed.resources.sdk.sessions).toBe(0);expect(disposed.native.sessions).toBe(0);
});
for(const [method,kind]of [['read','catalog'],['query','query_history']])test(`controlled transport fatal from mounted ${method} synchronizes fatal lifecycle and disables DOM`,async({page})=>{
  const mounted=await call(page,'mount',{fixture:'D0',faultKind:kind});expect(mounted.ready).toBe('ready');
  const result=await call(page,'faultRequest',mounted.id,method);observations.get(page).controlledFault=result;
  expect(result.response).toMatchObject({status:'fatal',diagnostic:{code:'fixture.native_fatal',path:'/controlled-transport',category:'transport',details:{fixture:'dom-mounted-controlled-reply'},may_have_committed:false}});
  expect(result.faults).toHaveLength(1);expect(result.lifecycle).toBe('fatal');expect(result.contenteditable).toBe('false');expect(result.resources.sdk.sessions).toBe(0);expect(result.native.sessions).toBe(0);
});

const frozenNegatives=JSON.parse(readFileSync('contracts/dom/v1/acceptance-oracles.v3.json','utf8')).negativeValidations;
for(const item of frozenNegatives)test(`frozen negative ${item.id}: exact native refusal, owned bytes and failed replacement invariance`,async({page})=>{
  const notes=item.layer.includes('Notes')||item.id.startsWith('notes-'),profile=notes?'notes':'kwdj';
  // The six declared Import fixtures exercise native Import rather than Strict.
  // This mapping is pinned by AdmissionDto::Normalize -> AdmissionMode::Import.
  const admission=item.layer.includes('Import')?'normalize':'validate';
  const source=item.input?readFileSync(`contracts/dom/v1/${item.input.path}`,'utf8'):wire(item.document);
  if(item.input){expect(Buffer.byteLength(source)).toBe(item.input.bytes);expect(createHash('sha256').update(source).digest('hex')).toBe(item.input.sha256);}
  const failed=await call(page,'mount',{profile,registry:'D0',admission,source});
  observations.get(page).negative={id:item.id,layer:item.layer,admission,authority:item.authority,expected:item.expected,actualMountedReady:failed};
  expect(failed.ready).toBe('sdk_failure');expect(failed.nativeResponse.status).toBe(item.expected.status);expect(failed.nativeResponse.diagnostic).toMatchObject({code:item.expected.code,path:item.expected.path});
  expect(new TextDecoder().decode(Uint8Array.from(failed.originalInput))).toBe(source);
  const failureReceipt=await call(page,'dispose',failed.id);expect(new TextDecoder().decode(Uint8Array.from(failureReceipt.receipt.recovery.originalInput))).toBe(source);expect(failureReceipt.resources.sdk.sessions).toBe(0);
  const live=await call(page,'mount',{profile,registry:'D0',admission,fixture:notes?'Notes-D0':'D0'});expect(live.ready).toBe('ready');
  await call(page,'select',live.id,notes?'/0/0/0':'/0/2',notes?0:2);
  const edit=notes?await call(page,'rawRequest',live.id,{kind:'command',command:{id:'org.example.notes/command/insert-text',payload_json:'{"text":"X"}'},history_hint:{kind:'isolated'}}):await call(page,'command',live.id,{kind:'insert_text',text:'X'});
  expect(edit.response.status).toBe('ok');await call(page,'mark',live.id,'unchanged-native-parent','/0');const before=await checkpoint(page,live.id,`${item.id} before failed replace`);history(before,1,0);
  const replacement=await call(page,'replace',live.id,source,true);observations.get(page).negative.actualReplacement=replacement;
  expect(replacement.status).toBe('completed');expect(replacement.response.status).toBe(item.expected.status);expect(replacement.response.diagnostic).toMatchObject({code:item.expected.code,path:item.expected.path});
  const after=await checkpoint(page,live.id,`${item.id} after failed replace`);expect(after.canonical).toBe(before.canonical);expect(after.state).toEqual(before.state);expect(after.capture).toEqual(before.capture);expect(after.context).toEqual(before.context);expect(after.rows).toEqual(before.rows);expect(after.events).toEqual(before.events);expect(after.ids).toEqual(before.ids);expect(await call(page,'sameIdentity',live.id,'unchanged-native-parent','/0')).toBe(true);
  expect(new TextDecoder().decode(Uint8Array.from(await call(page,'original',live.id)))).toBe(source);expect(after.resources.sdk.host_requests).toBe(0);expect(after.resources.dom.continuations).toBe(0);
});

test('closed payload coverage refuses unsupported targets, marks, recipes and raw lifecycle bypass without native changes',async({page})=>{
  const {id}=await call(page,'mount',{fixture:'D0'});await call(page,'select',id,'/0/2',2);await call(page,'command',id,{kind:'insert_text',text:'X'});await call(page,'mark',id,'P1','/0');const before=await checkpoint(page,id,'closed payload before');
  const command=(name,payload)=>({kind:'command',command:{id:`org.klenwriter.kwdj/command/${name}`,payload_json:JSON.stringify(payload)},history_hint:{kind:'isolated'}});
  const unknownMark={type_id:'org.example/unrendered_mark',attributes:{}};
  const media = approvedMedia('DOC-013');
  media.attrs.align = 'center';
  const mediaFragment = JSON.stringify({
    format_id: 'org.klenwriter.kwdj/clipboard-fragment/1', mode: 'prose',
    source_profile: { profile_id: 'org.klenwriter.kwdj', profile_version: '1.0.0', codec_id: 'org.klenwriter.kwdj/json', wire_version: 1 },
    kind: 'blocks', content: [media], open_start: false, open_end: false,
  });
  const requests=[
    ['unsupported-target',command('insert-block',{kind:'insert_block',target:{kind:'media'}}),'dom.command_unsupported'],
    ['native-only-media-fragment',command('insert-fragment',{kind:'insert_fragment',fragment_json:mediaFragment}),'dom.command_unsupported'],
    ['unsupported-mark',command('toggle-mark',{kind:'toggle_mark',mark:unknownMark}),'dom.command_unsupported'],
    ['closed-mark-attrs',command('toggle-mark',{kind:'toggle_mark',mark:{type_id:'org.klenwriter.kwdj/strong',attributes:{extra:{kind:'boolean',value:true}}}}),'dom.command_unsupported'],
    ['stored-marks',{kind:'set_stored_marks',marks:[unknownMark]},'dom.command_unsupported'],
    ['unknown-recipe',{kind:'command',command:{id:'org.example/command/recipe',payload_json:'{"kind":"recipe","arguments":{"nodes":{},"values":{}}}'},history_hint:{kind:'isolated'}},'dom.command_unsupported'],
    ['closed-known-command-payload',command('enter',{kind:'enter',extra:true}),'dom.command_unsupported'],
    ['unsupported-numeric-target',command('insert-block',{kind:'insert_block',target:{kind:'ordered_list',start:'2147483648'}}),'dom.command_unsupported'],
    ['raw-remount',{kind:'remount',input_json:wire('D0'),admission:'validate'},'dom.explicit_method_required'],
    ['raw-destroy',{kind:'destroy'},'dom.explicit_method_required'],
    ['live-facts',{kind:'update_facts',identities:{media:[],references:[]}},'dom.command_unsupported'],
  ];
  observations.get(page).payloadRefusals=[];
  for(const [name,request,code]of requests){const result=await call(page,'rawRequest',id,request);observations.get(page).payloadRefusals.push({name,request,result});expect(result.status).toBe('dom_refused');expect(result.diagnostic).toMatchObject({code,publication:'none'});}
  const query=await call(page,'rawRequest',id,{kind:'query_command',command:requests[0][1].command},true);expect(query.status).toBe('dom_refused');expect(query.diagnostic.code).toBe('dom.command_unsupported');
  const after=await checkpoint(page,id,'closed payload after');expect(after.canonical).toBe(before.canonical);expect(after.state).toEqual(before.state);expect(after.capture).toEqual(before.capture);expect(after.events).toEqual(before.events);expect(after.rows).toEqual(before.rows);expect(await call(page,'sameIdentity',id,'P1','/0')).toBe(true);
});

test('asynchronous temporary replacement busy and stale checks retain the edited live native session',async({page})=>{
  const {id}=await call(page,'mount',{fixture:'D0',delayReplacement:true});await call(page,'select',id,'/0/2',2);await call(page,'mark',id,'P1','/0');
  const started=await call(page,'startReplacement',id,'T10-replacement');expect(started.loaderCalls).toBe(2);expect(started.resources.sdk.host_requests).toBe(1);expect(started.resources.dom.continuations).toBe(1);
  const busy=await call(page,'replace',id,'D0');expect(busy.status).toBe('dom_refused');expect(busy.diagnostic.code).toBe('dom.busy');
  expect((await call(page,'command',id,{kind:'insert_text',text:'X'})).response.status).toBe('ok');const edited=await checkpoint(page,id,'asynchronous replace main edit');expect(edited.canonical).toBe(literal('T04-X'));
  const finished=await call(page,'finishReplacement',id);observations.get(page).replacementRace={started,busy,finished};expect(finished.result.status).toBe('dom_refused');expect(finished.result.diagnostic.code).toBe('dom.stale_replace');expect(finished.resources.sdk.host_requests).toBe(0);expect(finished.resources.dom.continuations).toBe(0);expect(finished.native.sessions).toBe(1);
  const after=await checkpoint(page,id,'asynchronous stale replacement');expect(after.canonical).toBe(edited.canonical);expect(after.state).toEqual(edited.state);expect(after.capture).toEqual(edited.capture);expect(after.events).toEqual(edited.events);expect(after.rows).toEqual(edited.rows);expect(await call(page,'sameIdentity',id,'P1','/0')).toBe(true);
});

test('asynchronous temporary replacement destroyed during loading never resurrects after late actual loader resolution',async({page})=>{
  const {id}=await call(page,'mount',{fixture:'D0',delayReplacement:true});const started=await call(page,'startReplacement',id,'T10-replacement');expect(started.loaderCalls).toBe(2);
  const destroyed=await call(page,'dispose',id);expect(destroyed.receipt.status).toBe('destroy_requested');expect(new TextDecoder().decode(Uint8Array.from(destroyed.receipt.recovery.originalInput))).toBe(wire('T10-replacement'));expect(destroyed.resources.dom).toMatchObject({listeners:0,observers:0,continuations:0,retainedInputBytes:0,retainedRecoveryRegions:0});
  const finished=await call(page,'finishReplacement',id);observations.get(page).replacementDestroyedRace={started,destroyed,finished};expect(finished.result.status).toBe('dom_refused');expect(finished.result.diagnostic.code).toBe('dom.disposed');expect(finished.native.sessions).toBe(0);expect(finished.resources.sdk.sessions).toBe(0);expect(finished.resources.sdk.host_requests).toBe(0);expect(finished.resources.dom.continuations).toBe(0);expect(finished.domText).toBe('');expect(finished.capture).toBeNull();
});

test('long leaves keep their canonical bytes and map physical Text seams to native UTF-16 positions', async ({page}) => {
  const corpora = longDocumentFixtures();
  expect(corpora.map(({canonical}) => createHash('sha256').update(canonical).digest('hex'))).toEqual([
    '83c74cf00eee8dc890dbc495d078f430aab553be47f9d406e53aabe423116296',
    'c98e383b2d654d64a52b6bdd1d5dc6c55cc3757def5159702c9251a323a7bb11',
  ]);
  const result = await page.evaluate(async corpora => {
    const [{createEditor, sdkBuildId}, {createDomView}, {kwdjBasicRenderers}, {kwdjCommand}, packet] = await Promise.all([
      import('@klenwriter/editor-sdk'), import('/packages/dom/view.js'), import('@klenwriter/editor-kwdj/dom'),
      import('@klenwriter/editor-kwdj'),
      fetch('/extensions-packet.json').then(response => response.json()),
    ]);
    const text = '  Русский e\u0301 👩‍💻 latin 👋🏽 '.repeat(36);
    const unbroken = 'x'.repeat(text.length);
    const observations = [];
    const edgeCase = {id: 'Unicode and leading spaces', leaves: [text, unbroken],
      canonical: JSON.stringify({content: [text, unbroken].map(value => ({content: [{text: value, type: 'text'}], type: 'paragraph'})),
        profile: 'prose', schema: 'klenwriter.document', schema_version: 1})};
    for (const {id, leaves, canonical} of [...corpora, edgeCase]) {
      const text = leaves[0];
      const element = document.createElement('div');
      document.body.appendChild(element);
      const editor = createEditor({input: new TextEncoder().encode(canonical), options: {
        abi: 'editor-sdk/2', build_id: sdkBuildId, profile: packet.kwdjProfile, registry_json: packet.kwdjRegistryJson,
        profile_options_json: '{"identities":{"media":[],"references":[]},"limits":null}', access: 'editable', admission: 'validate',
      }});
      const view = createDomView({element, catalog: kwdjBasicRenderers, textRepresentation: 'auto', patchPolicy: 'stable-fragments',
        readNode: (stamp, node) => editor.read({kind: 'node', stamp, node})});
      try {
        const ready = await editor.ready;
        if (ready.status !== 'ok' || ready.value.kind !== 'state') throw new Error(JSON.stringify(ready));
        const state = ready.value.state;
        const refusal = view.initialize(state);
        if (refusal) throw new Error(JSON.stringify(refusal));
        const read = node => editor.read({kind: 'node', stamp: state.stamp, node}).value.node;
        const block = read(read(state.root).children[0]);
        const leaf = read(block.children[0]);
        const fragments = [...element.firstChild.firstChild.childNodes];
        const seam = fragments[0].length;
        const modelPoint = {kind: 'text', node: leaf.id, offset: seam, affinity: 'after'};
        const back = view.domPoint(modelPoint);
        const range = document.createRange();
        range.setStart(fragments[0], 0);
        range.setEnd(fragments.at(-1), fragments.at(-1).length);
        const snapshot = editor.submit({kind: 'snapshot', stamp: state.stamp, max_bytes: 16777216}).response.value;
        editor.submit({kind: 'release_snapshot', handle: snapshot.handle});
        const highSurrogate = text.search(/[\uD800-\uDBFF]/);
        const observation = {id, allText: fragments.every(node => node.nodeType === Node.TEXT_NODE), count: fragments.length,
          safeSeam: text[seam - 1] === ' ' && seam <= 640,
          seamAliases: fragments.length > 1 && [view.textPosition(fragments[0], seam),
            view.textPosition(fragments[1], 0), view.textPosition(element.firstChild.firstChild, 1)]
            .every(value => JSON.stringify(value) === JSON.stringify(modelPoint)),
          afterSeam: back.node === fragments[1] && back.offset === 0,
          splitsSurrogate: view.textPosition(fragments[0], highSurrogate + 1)?.kind === 'text',
          exactDom: element.textContent === leaves.join('') && range.toString() === leaf.text && leaf.text === text,
          canonical: snapshot.canonical_json === canonical,
          fallback: id !== edgeCase.id || element.lastChild.firstChild.childNodes.length === 1};
        if (id === 'R1') {
          element.contentEditable = 'true';
          element.focus();
          let patchFailure = null;
          const unsubscribe = editor.subscribe(event => { patchFailure = view.patch(event); });
          const point = offset => ({...modelPoint, offset});
          const selected = editor.submit({kind:'set_selection', stamp:editor.capture(), selection:{anchor:point(8),focus:point(16)}});
          if (selected.response.status !== 'ok' || patchFailure) throw new Error(JSON.stringify(patchFailure ?? selected));
          const browser = document.getSelection(), liveRange = browser.getRangeAt(0);
          const edit = editor.submit({kind:'command', stamp:editor.capture(), command:kwdjCommand({kind:'insert_text',text:'ABCDEFGH'}), history_hint:{kind:'isolated'}});
          unsubscribe();
          const next = [...element.firstChild.firstChild.childNodes];
          observation.localPatch = {
            published: edit.response.status === 'ok' && patchFailure === null,
            changedPhysicalText: next[0] !== fragments[0] && !fragments[0].isConnected,
            otherFragmentsRetained: next.length === fragments.length && next.slice(1).every((node,index) => node === fragments[index+1]),
            exactText: element.textContent === text.replace('abcdefgh','ABCDEFGH'),
            exactCaret: browser.isCollapsed && browser.focusNode === next[0] && browser.focusOffset === 16,
            associatedRange: browser.rangeCount === 1 && browser.getRangeAt(0) === liveRange,
          };
        }
        observations.push(observation);
      } finally {
        view.destroy();
        editor.destroy();
        element.remove();
      }
    }
    return observations;
  }, corpora);
  for (const value of result) {
    expect(value.count, value.id).toBeGreaterThan(1);
    expect(value).toMatchObject({allText: true, safeSeam: true, seamAliases: true, afterSeam: true,
      splitsSurrogate: false, exactDom: true, canonical: true, fallback: true});
    if (value.id === 'R1') expect(value.localPatch).toEqual({published:true,changedPhysicalText:true,otherFragmentsRetained:true,
      exactText:true,exactCaret:true,associatedRange:true});
  }
});
async function observeMountRenderingOptions(page, cases) {
  return page.evaluate(async cases => {
    const [{mountEditor}, {loadSdkV2, sdkBuildId}, {kwdjBasicRenderers}, packet] = await Promise.all([
      import('@klenwriter/editor-dom'), import('@klenwriter/editor-sdk'), import('@klenwriter/editor-kwdj/dom'),
      fetch('/extensions-packet.json').then(response => response.json()),
    ]);
    const module = await loadSdkV2();
    const text = 'Русский English e\u0301 👍🏽 '.repeat(44);
    const source = JSON.stringify({content: [{content: [{text, type: 'text'}], type: 'paragraph'}],
      profile: 'prose', schema: 'klenwriter.document', schema_version: 1});
    const observations = [];
    for (const {options, accessor, mutate} of cases) {
      const element = document.createElement('div');
      element.setAttribute('aria-label', 'Render policy fixture');
      document.body.appendChild(element);
      const before = element.outerHTML;
      let loaderCalls = 0, getterCalls = 0, releaseLoad;
      const delay = new Promise(resolve => { releaseLoad = resolve; });
      const config = {element, renderers: kwdjBasicRenderers, ...options,
        editor: {input: new TextEncoder().encode(source), options: {
          abi: 'editor-sdk/2', build_id: sdkBuildId, profile: packet.kwdjProfile, registry_json: packet.kwdjRegistryJson,
          profile_options_json: '{"identities":{"media":[],"references":[]},"limits":null}', access: 'editable', admission: 'validate',
        }, loader: () => { loaderCalls++; return delay; }}};
      if (accessor) Object.defineProperty(config, accessor, {enumerable: true, get() { getterCalls++; return 'full'; }});
      let domWrites = 0;
      const observer = new MutationObserver(records => { domWrites += records.length; });
      observer.observe(element, {attributes: true, subtree: true, childList: true, characterData: true});
      const mounted = mountEditor(config);
      try {
        const loading = mounted.lifecycle;
        if (mutate) Object.assign(config, mutate);
        releaseLoad(module);
        const ready = await mounted.ready;
        domWrites += observer.takeRecords().length;
        const block = element.firstElementChild;
        const fragments = [...(block?.firstElementChild?.childNodes ?? [])];
        observations.push({status: ready.status, code: ready.diagnostic?.code ?? null, loading, loaderCalls, getterCalls,
          textExact: element.textContent === text, allText: fragments.every(node => node.nodeType === Node.TEXT_NODE),
          fragments: fragments.length, blockVisibility: block && getComputedStyle(block).contentVisibility,
          domWrites, hostUnchanged: element.outerHTML === before, sessions: mounted.resources().sdk.sessions});
      } finally {
        observer.disconnect();
        mounted.destroy();
        element.remove();
      }
    }
    return observations;
  }, cases);
}

test('mounted rendering options default to auto text and keep full text available', async ({page}) => {
  const cases = [
    {name: 'omitted', fragments: true},
    {name: 'undefined', options: {textRepresentation: undefined, patchPolicy: undefined, layoutPolicy: undefined}, fragments: true},
    {name: 'explicit auto', options: {textRepresentation: 'auto'}, fragments: true},
    {name: 'full alone', options: {textRepresentation: 'full'}, fragments: false},
    {name: 'full text with stable fragments', options: {textRepresentation: 'full', patchPolicy: 'stable-fragments', layoutPolicy: 'full'}, fragments: false},
    {name: 'auto text with full patch', options: {textRepresentation: 'auto', patchPolicy: 'full', layoutPolicy: 'full'}, fragments: true},
  ];
  const observations = await observeMountRenderingOptions(page, cases);
  for (const [index, result] of observations.entries()) {
    const {name, fragments} = cases[index];
    expect(result, name).toMatchObject({status: 'ready', loading: 'loading', loaderCalls: 1, textExact: true, allText: true,
      blockVisibility: 'visible', sessions: 1});
    if (fragments) expect(result.fragments, name).toBeGreaterThan(1);
    else expect(result.fragments, name).toBe(1);
  }
});

test('mount captures rendering options before a delayed loader resolves', async ({page}) => {
  const [result] = await observeMountRenderingOptions(page, [
    {options: {textRepresentation: 'full', patchPolicy: 'stable-text', layoutPolicy: 'full'},
      mutate: {textRepresentation: 'auto', patchPolicy: 'unrecognized', layoutPolicy: 'auto-blocks'}},
  ]);
  expect(result).toMatchObject({status: 'ready', loading: 'loading', loaderCalls: 1, textExact: true, allText: true,
    fragments: 1, blockVisibility: 'visible', sessions: 1});
});

test('mount refuses malformed rendering options and accessors before starting a session or touching the host', async ({page}) => {
  const cases = [
    {options: {textRepresentation: 'fragments'}},
    {options: {patchPolicy: 'auto'}},
    {options: {layoutPolicy: null}},
    ...['textRepresentation', 'patchPolicy', 'layoutPolicy'].map(accessor => ({accessor})),
  ];
  const observations = await observeMountRenderingOptions(page, cases);
  for (const result of observations) {
    expect(result).toMatchObject({status: 'dom_refused', code: 'dom.invalid_options', loaderCalls: 0, getterCalls: 0,
      domWrites: 0, hostUnchanged: true, sessions: 0});
  }
});

test('R1 and R5 public default and full opt-out edit and reopen the same canonical document', async ({page}, testInfo) => {
  const observations = [];
  for (const {id: corpus, canonical, leaves} of longDocumentFixtures()) {
    const directTextCount = id => page.evaluate(id => {
      const leaf = window.domHost.domAt(id,'/0/0');
      return [...leaf.childNodes].every(node => node.nodeType === Node.TEXT_NODE) ? leaf.childNodes.length : 0;
    },id);
    const defaultMount = await call(page,'mount',{source:canonical});
    const fullMount = await call(page,'mount',{source:canonical,renderOptions:{textRepresentation:'full'}});
    expect([defaultMount.ready,fullMount.ready],corpus).toEqual(['ready','ready']);
    const defaultDirectTextNodes = await directTextCount(defaultMount.id), fullDirectTextNodes = await directTextCount(fullMount.id);
    expect(defaultDirectTextNodes).toBeGreaterThan(1);
    expect(fullDirectTextNodes).toBe(1);
    for (const {id} of [defaultMount,fullMount]) {
      const mountedText = await page.locator(`#${id}`).textContent();
      expect(mountedText === leaves.join('')).toBe(true);
    }
    const exported = await Promise.all([defaultMount,fullMount].map(({id}) => call(page,'snapshot',id)));
    expect(exported.map(value => createHash('sha256').update(value).digest('hex'))).toEqual(
      Array(2).fill(createHash('sha256').update(canonical).digest('hex')));
    observations.push({corpus, targetLeafPath:[0,0], defaultDirectTextNodes, fullDirectTextNodes,
      defaultCanonicalSha256:createHash('sha256').update(exported[0]).digest('hex'),
      fullCanonicalSha256:createHash('sha256').update(exported[1]).digest('hex')});
    const edited = [];
    for (const {id} of [defaultMount,fullMount]) {
      await call(page,'select',id,'/0/0',0,'/0/0',1);
      expect((await call(page,'command',id,{kind:'insert_text',text:'A'})).response.status).toBe('ok');
      edited.push(await call(page,'snapshot',id));
      const result = await page.evaluate(async id => {
        const children = [...window.domHost.domAt(id,'/0/0').childNodes];
        const disposed = await window.domHost.dispose(id);
        return {disconnected: children.every(node => !node.isConnected), resources:disposed.resources};
      },id);
      expect(result.disconnected).toBe(true);
      expect(result.resources.dom).toMatchObject({listeners:0,observers:0,continuations:0});
      expect(result.resources.sdk.sessions).toBe(0);
    }
    const expected = canonical.replace(`${corpus}_BEGIN`,`A${corpus.slice(1)}_BEGIN`);
    expect(edited.map(value => createHash('sha256').update(value).digest('hex'))).toEqual(
      Array(2).fill(createHash('sha256').update(expected).digest('hex')));
    const reopened = await call(page,'mount',{source:edited[0],renderOptions:{textRepresentation:'full'}});
    expect(reopened.ready).toBe('ready');
    expect(await directTextCount(reopened.id)).toBe(1);
    expect(await call(page,'snapshot',reopened.id) === edited[0]).toBe(true);
    await call(page,'dispose',reopened.id);
  }
  await testInfo.attach('render-configuration-observations',{contentType:'application/json',body:JSON.stringify({
    buildId:(await call(page,'metadata')).buildId,
    default:{options:{},effectiveProfile:{textRepresentation:'auto',patchPolicy:'stable-fragments',layoutPolicy:'full'}},
    fullOptOut:{options:{textRepresentation:'full'}},observations,
  })});
});

const solidLongParagraphs = () => {
  const text = 'alpha beta gamma delta epsilon '.repeat(400);
  const source = JSON.stringify({content:Array.from({length:3},() => ({content:[{text,type:'text'}],type:'paragraph'})),
    profile:'prose',schema:'klenwriter.document',schema_version:1});
  return {text,source};
};

test('explicit auto-blocks can retain the full-text representation and retires before editing', async ({page,browserName}) => {
  const {text,source} = solidLongParagraphs();
  const {id,ready} = await call(page,'mount',{source,scrollable:true,renderOptions:{textRepresentation:'full',layoutPolicy:'auto-blocks'}});
  expect(ready).toBe('ready');
  const host = page.locator(`#${id}`);
  const before = await host.evaluate(element => {
    const nodes = [...element.children];
    element.testLayoutNodes = nodes;
    return {visibility:nodes.map(node => node.style.contentVisibility),
      textNodes:nodes.map(node => node.firstChild.childNodes.length)};
  });
  expect(before.textNodes).toEqual([1,1,1]);
  if (browserName === 'chromium') expect(before.visibility).toEqual(['','auto','auto']);
  expect(await host.textContent() === text.repeat(3)).toBe(true);
  await call(page,'select',id,'/0/0',5);
  expect((await call(page,'command',id,{kind:'insert_text',text:'Z'})).response.status).toBe('ok');
  const after = await host.evaluate(element => ({visible:[...element.children].every(node => !node.style.contentVisibility),
    unchangedNodes:[...element.children].every((node,index) => node === element.testLayoutNodes[index]),
    caret:document.getSelection().focusOffset, exactLeaf:element.firstChild.textContent.startsWith('alphaZ ')}));
  expect(after).toEqual({visible:true,unchangedNodes:true,caret:6,exactLeaf:true});
  const disposed = await call(page,'dispose',id);
  expect(disposed.resources.dom).toMatchObject({listeners:0,observers:0,continuations:0});
});

test('offscreen programmatic edits retire active auto-blocks before rendering the native change', async ({page,browserName}) => {
  const {source} = solidLongParagraphs();
  const {id,ready} = await call(page,'mount',{source,scrollable:true,renderOptions:{layoutPolicy:'auto-blocks'}});
  expect(ready).toBe('ready');
  const host = page.locator(`#${id}`);
  if (browserName === 'chromium') expect(await host.evaluate(element => element.children[1].style.contentVisibility)).toBe('auto');
  await call(page,'select',id,'/0/0',5);
  await page.locator('#host-recovery-control').focus();
  await page.locator('#mounts').evaluate(element => Object.assign(element.style,{position:'fixed',top:'1500px'}));
  expect((await host.boundingBox()).y).toBeGreaterThan(page.viewportSize().height);
  expect((await call(page,'command',id,{kind:'insert_text',text:'Z'})).response.status).toBe('ok');
  const after = await call(page,'inspect',id);
  expect(after.lifecycle).toBe('ready');
  expect(after.domText.startsWith('alphaZ ')).toBe(true);
  expect(await host.evaluate(element => element.children[1].style.contentVisibility)).toBe('');
});

test('auto-block teardown leaves styles on a paragraph already adopted by another host', async ({page,browserName}) => {
  const {source} = solidLongParagraphs();
  const {id,ready} = await call(page,'mount',{source,scrollable:true,renderOptions:{layoutPolicy:'auto-blocks'}});
  expect(ready).toBe('ready');
  const result = await page.locator(`#${id}`).evaluate(async element => {
    const adopter = document.createElement('div'), paragraph = element.children[1];
    document.body.appendChild(adopter);
    const before = paragraph.getAttribute('style');
    adopter.appendChild(paragraph);
    const teardown = await window.domHost.dispose(element.id);
    const value = {before,after:paragraph.getAttribute('style'),parent:paragraph.parentNode===adopter,listeners:teardown.resources.dom.listeners};
    adopter.remove();
    return value;
  });
  if (browserName === 'chromium') expect(result.before).toContain('content-visibility: auto');
  expect(result).toMatchObject({after:result.before,parent:true,listeners:0});
});

test('a covered auto-block selection refuses before publication and can retry when visible', async ({page,browserName}) => {
  const {source} = solidLongParagraphs();
  const {id,ready} = await call(page,'mount',{source,scrollable:true,renderOptions:{layoutPolicy:'auto-blocks'}});
  expect(ready).toBe('ready');
  await call(page,'select',id,'/0/0',5);
  const active = await page.locator(`#${id}`).evaluate(element => element.children[1].style.contentVisibility === 'auto');
  if (browserName === 'chromium') expect(active).toBe(true);
  const before = await call(page,'inspect',id), destination = stateRow(before,'/1/0').id;
  const point = {kind:'text',node:destination,offset:5,affinity:'after'};
  const selection = {anchor:point,focus:point};
  await page.evaluate(() => {
    const cover = document.createElement('div');
    cover.id = 'geometry-test-cover';
    cover.textContent = 'Geometry test cover';
    Object.assign(cover.style,{position:'fixed',inset:'0',zIndex:'1000',backgroundColor:'white'});
    document.body.appendChild(cover);
  });
  const result = await call(page,'submit',id,{kind:'set_selection',selection});
  const after = await call(page,'inspect',id);
  expect(after.lifecycle).toBe('ready');
  if (active) {
    expect(result).toMatchObject({status:'dom_refused',diagnostic:{code:'dom.selection_geometry_unsupported',publication:'none'}});
    expect(after.state).toEqual(before.state);
  } else expect(after.state.selection).toEqual(selection);
  await page.locator('#geometry-test-cover').evaluate(element => element.remove());
  expect((await call(page,'submit',id,{kind:'set_selection',selection})).response.status).toBe('ok');
  expect((await call(page,'inspect',id)).state.selection).toEqual(selection);
});

const viewportTolerance = 24;
const osr131Modes = [['default (omitted)', {}], ['full opt-out', {renderOptions:{textRepresentation:'full'}}]];
const canonicalWithLeaves = (fixture, leaves) => {
  const wire = JSON.parse(fixture.canonical);
  wire.content = leaves.map(text => ({content:[{text,type:'text'}],type:'paragraph'}));
  return JSON.stringify(wire);
};
const sha256 = text => createHash('sha256').update(text).digest('hex');
const position = (node, offset) => ({kind:'text',node,offset,affinity:'after'});

async function mountLargeDocument(page, fixture, mode, {scrollable = true,viewportSized = false,scrollParent = false} = {}) {
  test.slow(fixture.id === 'R5' && Boolean(mode.renderOptions) && test.info().project.name === 'chromium',
    'Chromium lays out eight near-limit leaves as single Text nodes in the full opt-out');
  const {id,ready} = await call(page,'mount',{source:fixture.canonical,scrollable,viewportSized,scrollParent,observeClipboard:true,...mode});
  expect(ready).toBe('ready');
  const host = page.locator(`#${id}`);
  const parts = await host.evaluate(element => [...element.children].map(block => {
    const nodes = [...block.firstElementChild.childNodes];
    return {textOnly:nodes.every(node => node.nodeType === Node.TEXT_NODE), lengths:nodes.map(node => node.length)};
  }));
  for (const [index,{textOnly,lengths}] of parts.entries()) {
    expect(textOnly).toBe(true);
    expect(lengths.reduce((sum,value) => sum+value,0)).toBe(fixture.leaves[index].length);
    if (mode.renderOptions) expect(lengths).toHaveLength(1);
    else expect(lengths.length).toBeGreaterThan(4);
  }
  // Pin the fourth physical seam and exercise its logical offset in full mode.
  const seam = fixture.id === 'R1' ? 2039 : 2041;
  expect(fixture.leaves[0][seam-1]).toBe(' ');
  if (!mode.renderOptions) expect(parts[0].lengths.slice(0,4).reduce((sum,value) => sum+value,0)).toBe(seam);
  const record = {corpus:fixture.id,options:mode.renderOptions ?? {},browserVersion:page.context().browser().version(),parts:parts.map(part => part.lengths.length),seam,
    canonicalSha256:sha256(fixture.canonical),scenarios:{}};
  observations.get(page).largeDocument = record;
  return {id,host,seam,record};
}

// Set a real browser Selection through its physical Text endpoints. The seam
// aliases use opposite sides of the same UTF-16 boundary when there are fragments.
async function browserTextSelection(host, anchor, focus = anchor) {
  return host.evaluate((element,{anchor,focus}) => {
    function resolve({block = 0,offset,side = 'right'}) {
      const nodes = [...element.children[block].firstElementChild.childNodes];
      let start = 0;
      for (const [index,node] of nodes.entries()) {
        const end = start+node.length;
        if (offset < end || (offset === end && (side === 'left' || index === nodes.length-1))) {
          return {node,offset:offset-start,index};
        }
        start = end;
      }
      throw new RangeError('Browser selection point is outside fixture text');
    }
    if (document.activeElement !== element) element.focus({preventScroll:true});
    const a = resolve(anchor), f = resolve(focus);
    const selection = getSelection();
    selection.setBaseAndExtent(a.node,a.offset,f.node,f.offset);
    return {anchor:{index:a.index,offset:a.offset},focus:{index:f.index,offset:f.offset},selected:selection.toString()};
  },{anchor,focus});
}

async function readLargeDocument(page,id,fixture,leaves=fixture.leaves) {
  const {state,rows} = await call(page,'nativeRows',id);
  expect(rows.map(row => row.path)).toEqual(['',...leaves.flatMap((_,index) => [`/${index}`,`/${index}/0`])]);
  expect(rows.map(row => row.node.primitive)).toEqual(['root',...leaves.flatMap(() => ['text_block','text'])]);
  expect(rows.filter(row => row.node.primitive === 'text').map(row => sha256(row.node.text)),'exact native text').toEqual(leaves.map(sha256));
  expect(sha256(await call(page,'snapshot',id)),'exact canonical bytes').toBe(sha256(canonicalWithLeaves(fixture,leaves)));
  expect(sha256(await page.locator(`#${id}`).textContent()),'complete mounted text').toBe(sha256(leaves.join('')));
  return {state,rows};
}

async function assertLargeSelection(page,id,selection) {
  await expect.poll(async () => (await call(page,'read',id,{kind:'state'})).value.state.selection).toEqual(selection);
}

async function traceLargeInput(host) {
  await host.evaluate(element => {
    element.largeEvents = [];
    for (const type of ['beforeinput','keydown','copy']) element.addEventListener(type,event => {
      if (type === 'keydown' && event.code !== 'KeyZ') return;
      element.largeEvents.push({type,inputType:event.inputType ?? null,data:event.data ?? null,
        trusted:event.isTrusted,prevented:event.defaultPrevented});
    });
  });
}

async function editingViewport(host) {
  return host.evaluate(async element => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const selection = getSelection(), rect = element.getBoundingClientRect();
    const bounds = selection.getRangeAt(0).getBoundingClientRect();
    const leaves = [...element.children].map(block => block.firstElementChild);
    function readPoint(node,offset) {
      const leaf = node.parentElement;
      if (node.nodeType !== Node.TEXT_NODE) return {kind:'child',block:[...element.children].indexOf(node),offset};
      let total = offset;
      for (let previous = node.previousSibling; previous; previous = previous.previousSibling) total += previous.length;
      return {kind:'text',block:leaves.indexOf(leaf),offset:total};
    }
    return {scrollTop:element.scrollTop, width:element.clientWidth,height:element.clientHeight,
      active:document.activeElement === element, rangeCount:selection.rangeCount, collapsed:selection.isCollapsed,
      anchor:readPoint(selection.anchorNode,selection.anchorOffset),focus:readPoint(selection.focusNode,selection.focusOffset),
      fullyVisible:bounds.height > 0 && bounds.top >= rect.top+element.clientTop &&
        bounds.bottom <= rect.top+element.clientTop+element.clientHeight};
  });
}

async function placeInViewport(host, block, offset) {
  await host.evaluate((element,{block,offset}) => {
    let local = offset;
    const point = [...element.children[block].firstElementChild.childNodes].find(node => {
      if (local < node.length) return true;
      local -= node.length;
      return false;
    });
    const range = document.createRange();
    range.setStart(point,local);
    range.collapse(true);
    element.scrollTop += range.getBoundingClientRect().top-element.getBoundingClientRect().top-90;
  },{block,offset});
}

async function largeDocumentContrast(host, incomplete) {
  const targets = [];
  for (const rule of incomplete) {
    expect(rule.id).toBe('color-contrast');
    for (const node of rule.nodes) {
      expect(node.any.map(check => check.data.messageKey)).toEqual(['elmPartiallyObscuring']);
      expect(node.target).toHaveLength(1);
      targets.push(node.target[0]);
    }
  }
  return host.evaluate((element,targets) => {
    if (!targets.length) return [];
    const sample = document.createElement('div');
    sample.style.color = 'Canvas';
    document.body.append(sample);
    const canvasColor = getComputedStyle(sample).color;
    sample.remove();
    const transparent = 'rgba(0, 0, 0, 0)';
    function luminance(color) {
      const components = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(color);
      if (!components) throw new Error(`Expected an opaque RGB color, received ${color}`);
      const [r,g,b] = components.slice(1).map(Number).map(value => {
        const channel = value/255;
        return channel <= 0.04045 ? channel/12.92 : ((channel+0.055)/1.055)**2.4;
      });
      return r*0.2126+g*0.7152+b*0.0722;
    }
    return targets.map(target => {
      const leaf = element.querySelector(target);
      if (!leaf || !leaf.matches('p > [data-editor-node]')) throw new Error(`Unexpected axe contrast target ${target}`);
      const foreground = getComputedStyle(leaf).color;
      let background = canvasColor;
      for (let ancestor = leaf; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (style.opacity !== '1' || style.backgroundImage !== 'none') throw new Error('Unexpected contrast layer');
        if (style.backgroundColor === transparent) continue;
        background = style.backgroundColor;
        break;
      }
      const levels = [luminance(foreground),luminance(background)];
      return {target,foreground,background,ratio:(Math.max(...levels)+0.05)/(Math.min(...levels)+0.05)};
    });
  },targets);
}

async function disposeLargeDocument(page,id,host) {
  const disposed = await call(page,'dispose',id);
  expect(disposed.sameReceipt).toBe(true);
  expect(disposed.recoveries).toEqual([]);
  expect(disposed.resources.dom).toEqual({listeners:0,observers:0,continuations:0,retainedInputBytes:0,retainedRecoveryRegions:0});
  expect(disposed.resources.clipboard).toEqual({pending:0,continuations:0,retainedTextBytes:0});
  expect(disposed.native).toEqual({sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});
  await expect(host).toBeEmpty();
  await expect(host).not.toHaveAttribute('contenteditable');
  observations.get(page).largeDocument.disposed = {dom:disposed.resources.dom,clipboard:disposed.resources.clipboard,native:disposed.native};
}

for (const fixture of longDocumentFixtures()) {
  for (const [modeName,mode] of osr131Modes) {
    const scenario = `OSR-131 ${fixture.id} ${modeName}`;

    test(`${scenario} trusted seam input and keyboard Undo/Redo`, async ({page}) => {
      const {id,host,seam,record} = await mountLargeDocument(page,fixture,mode);
      const base = await readLargeDocument(page,id,fixture), leaf = stateRow(base,'/0/0').id;
      await traceLargeInput(host);
      for (const side of mode.renderOptions ? ['right'] : ['left','right']) {
        const physical = await browserTextSelection(host,{offset:seam,side});
        expect(physical.anchor).toEqual(mode.renderOptions ? {index:0,offset:seam} :
          side === 'left' ? {index:3,offset:510} : {index:4,offset:0});
        await assertLargeSelection(page,id,{anchor:position(leaf,seam),focus:position(leaf,seam)});
      }
      const collapsedInput = await call(page,'queryCommand',id,{kind:'insert_text',text:'x'});
      // R1 already uses every byte of the per-leaf limit. Replace the seam
      // space with one byte at its reverse endpoint. R5 can grow at its caret.
      const start = fixture.id === 'R1' ? seam-1 : seam;
      const inputSelection = {anchor:position(leaf,seam),focus:position(leaf,start)};
      if (fixture.id === 'R1') {
        expect(collapsedInput).toMatchObject({status:'ok',value:{available:false,diagnostic:{
          code:'kwdj.resource_limit_exceeded',details:{limit:'text_length',maximum:'262144',observed:'262145'},
        }}});
        await browserTextSelection(host,{offset:seam},{offset:start});
      } else {
        expect(collapsedInput).toMatchObject({status:'ok',value:{available:true}});
      }
      await assertLargeSelection(page,id,inputSelection);
      await page.keyboard.press('KeyX');
      record.scenarios.inputAndHistory = {collapsedInput,inputSelection};
      const edited = [fixture.leaves[0].slice(0,start)+'x'+fixture.leaves[0].slice(seam),...fixture.leaves.slice(1)];
      const caretAfterInput = start+1;
      const inserted = await readLargeDocument(page,id,fixture,edited);
      const nextLeaf = stateRow(inserted,'/0/0').id;
      caret(inserted,nextLeaf,caretAfterInput);
      history(inserted,1,0);
      const nativeCaret = await editingViewport(host);
      expect(nativeCaret.anchor).toEqual({kind:'text',block:0,offset:caretAfterInput});
      expect(nativeCaret.focus).toEqual(nativeCaret.anchor);
      await page.keyboard.press('ControlOrMeta+KeyZ');
      const undone = await readLargeDocument(page,id,fixture);
      expect(undone.state.selection).toEqual(inputSelection);
      history(undone,0,1);
      await page.keyboard.press('Shift+ControlOrMeta+KeyZ');
      const redone = await readLargeDocument(page,id,fixture,edited);
      caret(redone,nextLeaf,caretAfterInput);
      history(redone,1,0);
      expect([inserted,undone,redone].map(row => row.state.stamp.revision)).toEqual(['1','2','3']);
      const events = await host.evaluate(element => element.largeEvents);
      expect(events).toEqual([
        {type:'beforeinput',inputType:'insertText',data:'x',trusted:true,prevented:true},
        ...Array.from({length:2},() => ({type:'keydown',inputType:null,data:null,trusted:true,prevented:true})),
      ]);
      Object.assign(record.scenarios.inputAndHistory,{events,editedCanonicalSha256:sha256(canonicalWithLeaves(fixture,edited)),nativeCaret});
      await disposeLargeDocument(page,id,host);
    });

    test(`${scenario} trusted seam range deletion keeps canonical history and viewport`, async ({page}) => {
      const {id,host,seam,record} = await mountLargeDocument(page,fixture,mode);
      const base = await readLargeDocument(page,id,fixture), leaf = stateRow(base,'/0/0').id, block = stateRow(base,'/0').id;
      const start = seam-1, end = seam;
      const beforeSelection = {anchor:position(leaf,end),focus:position(leaf,start)};
      const physical = await browserTextSelection(host,{offset:end},{offset:start});
      expect(physical.selected).toBe(' ');
      expect(physical.anchor.index).toBe(mode.renderOptions ? 0 : 4);
      expect(physical.focus.index).toBe(mode.renderOptions ? 0 : 3);
      await assertLargeSelection(page,id,beforeSelection);
      await placeInViewport(host,0,start);
      const before = await editingViewport(host);
      expect(before.active).toBe(true);
      expect(before.fullyVisible).toBe(true);
      await traceLargeInput(host);
      await page.keyboard.press('Backspace');
      const edited = [fixture.leaves[0].slice(0,start)+fixture.leaves[0].slice(end),...fixture.leaves.slice(1)];
      const deleted = await readLargeDocument(page,id,fixture,edited);
      expect(stateRow(deleted,'/0/0').id).toBe(leaf);
      caret(deleted,block,1,'child');
      history(deleted,1,0);
      const after = await editingViewport(host);
      expect(after).toMatchObject({active:true,collapsed:true,rangeCount:1,
        anchor:{kind:'child',block:0,offset:1},focus:{kind:'child',block:0,offset:1}});
      await page.keyboard.press('ControlOrMeta+KeyZ');
      const undone = await readLargeDocument(page,id,fixture);
      expect(undone.state.selection).toEqual(beforeSelection);
      history(undone,0,1);
      await page.keyboard.press('Shift+ControlOrMeta+KeyZ');
      const redone = await readLargeDocument(page,id,fixture,edited);
      caret(redone,block,1,'child');
      history(redone,1,0);
      const events = await host.evaluate(element => element.largeEvents);
      expect(events[0]).toEqual({type:'beforeinput',inputType:'deleteContentBackward',data:null,trusted:true,prevented:true});
      record.scenarios.deletion = {before,after,scrollDelta:Math.abs(after.scrollTop-before.scrollTop),events,
        editedCanonicalSha256:sha256(canonicalWithLeaves(fixture,edited))};
      await disposeLargeDocument(page,id,host);
      expect(record.scenarios.deletion.scrollDelta,'scroll displacement after trusted deletion').toBeLessThanOrEqual(viewportTolerance);
    });

    test(`${scenario} forward and reverse selection across the viewport copies through the host`, async ({page}) => {
      const {id,host,seam,record} = await mountLargeDocument(page,fixture,mode);
      const base = await readLargeDocument(page,id,fixture), leaf = stateRow(base,'/0/0').id;
      const start = seam-1, end = seam+4096;
      const selected = fixture.leaves[0].slice(start,end);
      await traceLargeInput(host);
      await placeInViewport(host,0,start);
      const geometry = await host.evaluate((element,{start,end}) => {
        const range = document.createRange(), leaf = element.firstElementChild.firstElementChild;
        function rectAt(offset) {
          for (const part of leaf.childNodes) {
            if (offset < part.length) {
              range.setStart(part,offset); range.collapse(true);
              return range.getBoundingClientRect().top;
            }
            offset -= part.length;
          }
          throw new RangeError('Missing viewport range endpoint');
        }
        const rect = element.getBoundingClientRect(), top = rectAt(start), bottom = rectAt(end);
        return {startVisible:top >= rect.top && top < rect.bottom,endBelow:bottom >= rect.bottom};
      },{start,end});
      expect(geometry).toEqual({startVisible:true,endBelow:true});
      const directions = [[start,end],[end,start]];
      for (const [index,[anchor,focus]] of directions.entries()) {
        const physical = await browserTextSelection(host,{offset:anchor},{offset:focus});
        expect(physical.selected === selected).toBe(true);
        if (!mode.renderOptions) expect(physical.anchor.index).not.toBe(physical.focus.index);
        await assertLargeSelection(page,id,{anchor:position(leaf,anchor),focus:position(leaf,focus)});
        const beforeCopy = await call(page,'read',id,{kind:'state'});
        await page.keyboard.press('ControlOrMeta+KeyC');
        await expect.poll(async () => (await call(page,'clipboardObservations',id)).results.length).toBe(index+1);
        expect(await call(page,'read',id,{kind:'state'})).toEqual(beforeCopy);
      }
      const clipboard = await call(page,'clipboardObservations',id);
      expect(clipboard.writes.map(sha256)).toEqual([sha256(selected),sha256(selected)]);
      expect(clipboard.results).toEqual(Array.from({length:2},() => ({action:'copy',status:'copied',clipboard:'confirmed',failure:null,submission:null})));
      const events = await host.evaluate(element => element.largeEvents);
      expect(events).toEqual(Array.from({length:2},() => ({type:'copy',inputType:null,data:null,trusted:true,prevented:true})));
      const after = await readLargeDocument(page,id,fixture);
      expect(after.state.stamp.revision).toBe(base.state.stamp.revision);
      history(after,0,0);
      record.scenarios.viewportCopy = {geometry,directions,events,results:clipboard.results,sha256:sha256(selected),utf16:selected.length};
      await disposeLargeDocument(page,id,host);
    });

    test(`${scenario} accessible full text, keyboard focus and semantic paragraphs`, async ({page}) => {
      const {id,host,seam,record} = await mountLargeDocument(page,fixture,mode,{scrollable:false});
      // Text fields participate in keyboard navigation with the default macOS settings.
      const fieldName = 'Document title';
      await host.evaluate((element,name) => {
        const field = document.createElement('input');
        field.type = 'text';
        field.setAttribute('aria-label',name);
        element.before(field);
      },fieldName);
      const initial = await readLargeDocument(page,id,fixture);
      const target = position(stateRow(initial,'/0/0').id,seam);
      await browserTextSelection(host,{offset:seam});
      await assertLargeSelection(page,id,{anchor:target,focus:target});
      const beforeTab = await call(page,'read',id,{kind:'state'});
      await expect(page.getByRole('textbox',{name:'KlenWriter editor example 1'})).toBeVisible();
      await expect(host).toHaveAttribute('aria-multiline','true');
      await expect(host).toHaveAttribute('contenteditable','true');
      const semantics = await host.evaluate(element => ({
        tags:[...element.children].map(node => node.tagName),
        hidden:element.querySelectorAll('[aria-hidden="true"],[hidden],[inert]').length,
        complete:[...element.children].every(block => getComputedStyle(block).contentVisibility === 'visible'),
      }));
      expect(semantics).toEqual({tags:fixture.leaves.map(() => 'P'),hidden:0,complete:true});
      const title = page.getByRole('textbox',{name:fieldName,exact:true});
      await page.keyboard.press('Shift+Tab');
      await expect(title).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(host).toBeFocused();
      await assertLargeSelection(page,id,{anchor:target,focus:target});
      const restored = await editingViewport(host);
      expect(restored).toMatchObject({active:true,collapsed:true,rangeCount:1,
        anchor:{kind:'text',block:0,offset:seam},focus:{kind:'text',block:0,offset:seam}});
      const outline = await host.evaluate(element => {
        const style = getComputedStyle(element);
        return {focusVisible:element.matches(':focus-visible'),outlineStyle:style.outlineStyle,outlineWidth:style.outlineWidth};
      });
      expect(outline).toEqual({focusVisible:true,outlineStyle:'solid',outlineWidth:'2px'});
      const result = await new AxeBuilder({page}).include(`#${id}`).analyze();
      record.scenarios.accessibility = {semantics,restored,outline,axe:{engine:result.testEngine,
        violations:result.violations,incomplete:result.incomplete,passedRules:result.passes.map(rule => rule.id)}};
      expect(result.violations).toEqual([]);
      expect(result.passes.length).toBeGreaterThan(0);
      // Axe can report overlap on a huge inline box. Retain its result and
      // independently measure actual text/background colors for each such box.
      const contrast = await largeDocumentContrast(host,result.incomplete);
      for (const measurement of contrast) expect(measurement.ratio,measurement.target).toBeGreaterThanOrEqual(4.5);
      record.scenarios.accessibility.contrast = contrast;
      const after = await readLargeDocument(page,id,fixture);
      expect(after.state).toEqual(beforeTab.value.state);
      history(after,0,0);
      await disposeLargeDocument(page,id,host);
    });

    if (fixture.id === 'R5') test(`${scenario} move and resize retain visible caret and scroll position`, async ({page}) => {
      const {id,host,seam,record} = await mountLargeDocument(page,fixture,mode,{viewportSized:true});
      const initial = await readLargeDocument(page,id,fixture);
      const leaf = stateRow(initial,'/0/0').id, source = stateRow(initial,'/3').id;
      await browserTextSelection(host,{offset:seam});
      await assertLargeSelection(page,id,{anchor:position(leaf,seam),focus:position(leaf,seam)});
      await placeInViewport(host,0,seam);
      const before = await editingViewport(host);
      expect(before.scrollTop).toBeGreaterThan(0);
      expect(before).toMatchObject({active:true,collapsed:true,fullyVisible:true,
        anchor:{kind:'text',block:0,offset:seam},focus:{kind:'text',block:0,offset:seam}});
      const move = await call(page,'command',id,{kind:'move',node:source,parent:initial.state.root,before_index:8});
      expect(move.response.status).toBe('ok');
      const leaves = fixture.leaves.filter((_,index) => index !== 3).concat(fixture.leaves[3]);
      const moved = await readLargeDocument(page,id,fixture,leaves);
      expect(stateRow(moved,'/7').id).toBe(source);
      caret(moved,leaf,seam);
      history(moved,1,0);
      const afterMove = await editingViewport(host);
      await page.setViewportSize({width:512,height:340});
      const resized = await editingViewport(host);
      const afterResize = await readLargeDocument(page,id,fixture,leaves);
      expect(afterResize.state).toEqual(moved.state);
      expect(afterResize.rows).toEqual(moved.rows);
      expect(resized.width).not.toBe(before.width);
      expect(resized.height).not.toBe(before.height);
      record.scenarios.moveAndResize = {before,afterMove,resized,canonicalSha256:sha256(canonicalWithLeaves(fixture,leaves))};
      for (const actual of [afterMove,resized]) {
        expect(actual).toMatchObject({active:true,collapsed:true,fullyVisible:true,anchor:before.anchor,focus:before.focus});
        expect(Math.abs(actual.scrollTop-before.scrollTop)).toBeLessThanOrEqual(viewportTolerance);
      }
      await disposeLargeDocument(page,id,host);
    });
  }
}

async function prepareDeletionScrollReview(page) {
  const [fixture] = longDocumentFixtures();
  const mounted = await mountLargeDocument(page,fixture,{}, {scrollable:false,scrollParent:true});
  const {id,host,seam} = mounted;
  const base = await readLargeDocument(page,id,fixture);
  const leaf = stateRow(base,'/0/0').id;
  const selection = {anchor:position(leaf,seam),focus:position(leaf,seam-1)};
  expect(await browserTextSelection(host,{offset:seam},{offset:seam-1})).toEqual({
    anchor:{index:4,offset:0},focus:{index:3,offset:509},selected:' ',
  });
  await assertLargeSelection(page,id,selection);
  await host.evaluate(async element => {
    const scroller = element.parentElement;
    const range = getSelection().getRangeAt(0).getBoundingClientRect();
    scroller.scrollTo(0,scroller.scrollTop+range.top-scroller.getBoundingClientRect().top-90);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  return {...mounted,fixture,leaf,block:stateRow(base,'/0').id};
}

async function armDeletionScrollReview(host,id,destroy) {
  await host.evaluate((element,{id,destroy}) => {
    const scroller = element.parentElement;
    const win = element.ownerDocument.defaultView;
    const offsets = () => ({left:scroller.scrollLeft,top:scroller.scrollTop});
    const baseline = offsets();
    const baselineListeners = window.domHost.resources(id).dom.listeners;
    const frames = new Map();
    const listeners = [];
    const requestFrame = win.requestAnimationFrame;
    const cancelFrame = win.cancelAnimationFrame;
    const addListener = EventTarget.prototype.addEventListener;
    const removeListener = EventTarget.prototype.removeEventListener;
    const capture = options => typeof options === 'boolean' ? options : !!options?.capture;
    const watched = target => target === win || target === scroller || target === element ||
      target === element.ownerDocument;
    const scrolling = type => type === 'scroll' || type === 'wheel' || type === 'beforeinput';
    const report = {};

    win.requestAnimationFrame = callback => {
      const frame = {ran:false,cancelled:false};
      const handle = requestFrame.call(win,time => {frame.ran = true; callback(time);});
      frames.set(handle,frame);
      return handle;
    };
    win.cancelAnimationFrame = handle => {
      const frame = frames.get(handle);
      if (frame) frame.cancelled = true;
      cancelFrame.call(win,handle);
    };
    EventTarget.prototype.addEventListener = function(type,listener,options) {
      if (watched(this) && scrolling(type)) listeners.push({target:this,type,listener,capture:capture(options),removed:false});
      return addListener.call(this,type,listener,options);
    };
    EventTarget.prototype.removeEventListener = function(type,listener,options) {
      for (const row of listeners) {
        if (row.target === this && row.type === type && row.listener === listener && row.capture === capture(options)) row.removed = true;
      }
      return removeListener.call(this,type,listener,options);
    };
    function restoreObservers() {
      win.requestAnimationFrame = requestFrame;
      win.cancelAnimationFrame = cancelFrame;
      EventTarget.prototype.addEventListener = addListener;
      EventTarget.prototype.removeEventListener = removeListener;
    }

    // This listener is attached after mount. The editor's trusted beforeinput
    // listener publishes the deletion and schedules its frame before we run.
    addListener.call(element,'beforeinput',event => {
      report.input = {inputType:event.inputType,trusted:event.isTrusted,prevented:event.defaultPrevented};
      report.baseline = baseline;
      report.beforeHostScroll = offsets();
      report.pending = window.domHost.resources(id);
      report.pendingFrames = [...frames.values()].filter(frame => !frame.ran && !frame.cancelled).length;
      report.pendingListeners = listeners.filter(listener => !listener.removed).map(listener => listener.type);
      report.additionalDomListeners = report.pending.dom.listeners-baselineListeners;
      const requested = {left:baseline.left+73,top:baseline.top+137};
      scroller.scrollTo(requested.left,requested.top);
      report.requested = requested;
      report.applied = offsets();
      if (destroy) {
        report.disposed = window.domHost.dispose(id);
        report.afterDestroy = offsets();
        report.extentsAfterDestroy = {width:scroller.scrollWidth,height:scroller.scrollHeight,
          clientWidth:scroller.clientWidth,clientHeight:scroller.clientHeight};
      }
    },{once:true});

    element.deletionScrollReview = async () => {
      try {
        const nextPaint = () => new Promise(resolve => requestFrame.call(win,() => requestFrame.call(win,resolve)));
        await nextPaint();
        if (destroy) {
          // WebKit can reset the scroller when its focused editable subtree is
          // destroyed. Keep that native result and test a fresh host scroll
          // after teardown, alongside the actual pending-frame cancellation.
          report.nativeAfterDestroy = offsets();
          scroller.scrollTo(report.requested.left,report.requested.top);
          report.postDestroyScroll = offsets();
          await nextPaint();
        }
        return {...report,disposed:await report.disposed,final:offsets(),frames:[...frames.values()],
          listeners:listeners.map(({type,removed}) => ({type,removed}))};
      } finally {
        restoreObservers();
      }
    };
  },{id,destroy});
}

async function finishDeletionScrollReview(page,host,record) {
  await page.keyboard.press('Backspace');
  const review = await host.evaluate(element => element.deletionScrollReview());
  record.scenarios.deletionScrollReview = review;
  expect(review.input).toEqual({inputType:'deleteContentBackward',trusted:true,prevented:true});
  expect(review.pending.selection.animationFrames).toBe(1);
  expect(review.pendingFrames).toBe(1);
  expect(review.pendingListeners.filter(type => type === 'wheel')).toEqual(['wheel']);
  expect(review.additionalDomListeners).toBe(review.pendingListeners.length);
  expect(review.baseline.top).toBeGreaterThan(0);
  expect(review.applied).toEqual(review.requested);
  return review;
}

test('OSR-131 trusted deletion preserves later host scroll on both axes in the same frame', async ({page}) => {
  const {id,host,fixture,seam,leaf,block,record} = await prepareDeletionScrollReview(page);
  await armDeletionScrollReview(host,id,false);
  const review = await finishDeletionScrollReview(page,host,record);
  const edited = [fixture.leaves[0].slice(0,seam-1)+fixture.leaves[0].slice(seam)];
  const point = await readLargeDocument(page,id,fixture,edited);
  expect(stateRow(point,'/0/0').id).toBe(leaf);
  caret(point,block,1,'child');
  history(point,1,0);
  expect((await call(page,'resources',id)).selection.animationFrames).toBe(0);
  await disposeLargeDocument(page,id,host);
  expect(review.final).toEqual(review.applied);
});

test('OSR-131 destroy in the trusted deletion handler cancels the pending correction', async ({page}) => {
  const {id,host,record} = await prepareDeletionScrollReview(page);
  await armDeletionScrollReview(host,id,true);
  const review = await finishDeletionScrollReview(page,host,record);
  expect(review.frames).toEqual([{ran:false,cancelled:true}]);
  expect(review.listeners.filter(listener => !listener.removed)).toEqual([]);
  expect(review.disposed.sameReceipt).toBe(true);
  expect(review.disposed.recoveries).toEqual([]);
  expect(review.disposed.resources.selection.animationFrames).toBe(0);
  expect(review.disposed.resources.dom).toEqual({listeners:0,observers:0,continuations:0,retainedInputBytes:0,retainedRecoveryRegions:0});
  expect(review.disposed.native).toEqual({sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});
  await expect(host).toBeEmpty();
  await expect(host).not.toHaveAttribute('contenteditable');
  expect(review.postDestroyScroll).toEqual(review.requested);
  expect(review.final).toEqual(review.postDestroyScroll);
});
