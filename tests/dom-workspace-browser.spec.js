import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { literaryFixture, spoilerDisclosureFixture, warningFixture } from './support/codec-fixtures.mjs';
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

test.describe('OSR-207 table keyboard navigation', () => {
  const retained = JSON.parse(readFileSync(new URL('../contracts/kwdj/v1/fixtures/positive.json', import.meta.url), 'utf8'))
    .fixtures.find(row => row.id === 'DOC-011').cases.find(row => row.name === 'table_spans_alignment').kwdj;
  const paragraph = text => ({type:'paragraph',content:[{type:'text',text}]});
  const source = canonicalizeRaw(JSON.stringify({...retained, content:[paragraph('before'), ...retained.content, paragraph('after')]}));
  const paths = {
    before:'/0/0', AB:'/1/0/0/0/0', A:'/1/1/0/0/0',
    B1:'/1/1/1/0/0', B2:'/1/2/0/0/0', after:'/2/0',
  };
  async function mounted(page) {
    const {id,ready,diagnostic}=await call(page,'mount',{source});
    expect(ready,JSON.stringify(diagnostic)).toBe('ready');
    const before=await checkpoint(page,id,'original DOC-011 table');
    return {id,before};
  }
  async function step(page,record,key,destination,offset) {
    await page.keyboard.press(key);
    const {id,before}=record;
    const point=await checkpoint(page,id,key+' to '+destination);
    caret(point,stateRow(before,paths[destination]).id,offset);
    expect(point.actualSelection).toMatchObject({inside:true});
    expect(await call(page,'nativeSelectionMatches',id,paths[destination],offset)).toBe(true);
    await expect(page.locator('#'+id)).toBeFocused();
    expect(point.canonical).toBe(source);
    expect(point.state.stamp.revision).toBe(before.state.stamp.revision);
    expect(point.state.dirty).toBe(before.state.dirty);
    expect(docEvents(point)).toEqual([]);
    history(point,0,0);
  }
  test('owned Tab follows authored cells and leaves the table on both edges', async ({page}) => {
    const record=await mounted(page);
    await call(page,'select',record.id,paths.AB,1);
    for (const destination of ['A','B1','B2','after']) await step(page,record,'Tab',destination,0);
    await call(page,'select',record.id,paths.B2,0);
    for (const [destination,offset] of [['B1',2],['A',1],['AB',2],['before',6]]) {
      await step(page,record,'Shift+Tab',destination,offset);
    }
  });
  test('owned arrows use effective faces, retain an entry slot and exit the last row', async ({page}) => {
    const record=await mounted(page);
    await call(page,'select',record.id,paths.B2,0);
    await step(page,record,'ArrowLeft','A',1);
    await step(page,record,'ArrowRight','B2',0);
    await call(page,'select',record.id,paths.B1,0);
    await step(page,record,'ArrowUp','AB',2);
    await step(page,record,'ArrowDown','B1',0);
    await call(page,'select',record.id,paths.B1,2);
    await step(page,record,'ArrowDown','B2',0);
    await call(page,'select',record.id,paths.B2,2);
    await step(page,record,'ArrowDown','after',0);
    await call(page,'select',record.id,paths.A,1);
    await step(page,record,'ArrowDown','after',0);
  });
  test('untrusted or host-canceled keys keep the original cell selection', async ({page}) => {
    const record=await mounted(page);
    await call(page,'select',record.id,paths.A,1);
    const initial=await checkpoint(page,record.id,'A right face');
    const editor=page.locator('#'+record.id);
    const syntheticUnprevented=await editor.evaluate(element=>element.dispatchEvent(
      new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}),
    ));
    expect(syntheticUnprevented).toBe(true);
    expect((await checkpoint(page,record.id,'untrusted ArrowRight')).state).toEqual(initial.state);
    await editor.evaluate(element=>element.addEventListener('keydown',event=>event.preventDefault(),{once:true}));
    await page.keyboard.press('ArrowRight');
    expect((await checkpoint(page,record.id,'host-canceled ArrowRight')).state).toEqual(initial.state);
    expect(await call(page,'nativeSelectionMatches',record.id,paths.A,1)).toBe(true);
    await step(page,record,'ArrowRight','B1',0);
  });
});

test.describe('OSR-208 rectangular table selection', () => {
  const corpus=JSON.parse(readFileSync(new URL('../contracts/kwdj/v1/fixtures/positive.json',import.meta.url),'utf8')).fixtures;
  const tables={
    'DOC-011':{name:'table_spans_alignment',anchor:'/0/1/1',focus:'/0/0/0',selected:['AB','A','B1','B2']},
    'DOC-010':{name:'rectangular_table',anchor:'/0/0/1',focus:'/0/1/1',initialOffset:1,selected:['B','2']},
  };
  const mark={kind:'toggle_mark',mark:{type_id:'org.klenwriter.kwdj/strong',attributes:{}}};
  const highlights=editor=>editor.locator('[data-editor-table-cell-selected]');
  async function mount(page,fixture) {
    const item=tables[fixture];
    const source=canonicalizeRaw(JSON.stringify(corpus.find(row=>row.id===fixture).cases.find(row=>row.name===item.name).kwdj));
    const {id,ready,diagnostic}=await call(page,'mount',{source});
    expect(ready,JSON.stringify(diagnostic)).toBe('ready');
    await call(page,'select',id,item.anchor+'/0/0',item.initialOffset??0);
    const before=await checkpoint(page,id,fixture+' initial table');
    return {source,id,before,item,editor:page.locator('#'+id)};
  }
  function expected(record) {
    return {
      anchor:{kind:'edge',node:stateRow(record.before,record.item.anchor).id,side:'before'},
      focus:{kind:'edge',node:stateRow(record.before,record.item.focus).id,side:'after'},
    };
  }
  async function rectangle(page,record) {
    const after=await checkpoint(page,record.id,'active rectangular selection');
    expect(after.state.selection).toEqual(expected(record));
    expect(await highlights(record.editor).allTextContents()).toEqual(record.item.selected);
    await expect(highlights(record.editor).first()).toHaveCSS('outline-style','solid');
    await expect(highlights(record.editor).first()).toHaveCSS('outline-width','2px');
    expect(await call(page,'nativeSelectionMatches',record.id,record.item.focus+'/0/0',0)).toBe(true);
    expect(after.canonical).toBe(record.source);
    expect(after.state.stamp.revision).toBe(record.before.state.stamp.revision);
    expect(after.state.dirty).toBe(record.before.state.dirty);
    expect(docEvents(after)).toEqual([]);
    expect(after.failures).toEqual([]);
    history(after,0,0);
    await expect(record.editor).toBeFocused();
    expect((await new AxeBuilder({page}).include('#'+record.id).analyze()).violations).toEqual([]);
  }
  async function mouseDrag(page,editor,from,to) {
    const text=label=>editor.getByText(label,{exact:true});
    const start=await text(from).boundingBox(),end=await text(to).boundingBox();
    expect(start).not.toBeNull();expect(end).not.toBeNull();
    await page.mouse.move(start.x+start.width/2,start.y+start.height/2);
    await page.mouse.down();
    await page.mouse.move(end.x+end.width/2,end.y+end.height/2,{steps:5});
    await page.mouse.up();
  }
  test('keyboard and mouse select the same expanded DOC-011 span rectangle',async({page})=>{
    const record=await mount(page,'DOC-011');
    await page.keyboard.press('Shift+ArrowUp');
    await rectangle(page,record);
    await page.keyboard.press('Escape');
    await expect(highlights(record.editor)).toHaveCount(0);
    await mouseDrag(page,record.editor,'B1','AB');
    await rectangle(page,record);
    await call(page,'dispose',record.id);
    await expect(highlights(record.editor)).toHaveCount(0);
  });
  test('DOC-010 column rectangle leaves the other column clear and same-cell drag stays text',async({page})=>{
    const record=await mount(page,'DOC-010');
    await page.keyboard.press('Shift+ArrowDown');
    await rectangle(page,record);
    await mouseDrag(page,record.editor,'B','2');
    await rectangle(page,record);
    await record.editor.getByText('A',{exact:true}).click();
    await expect(highlights(record.editor)).toHaveCount(0);
    const text=record.editor.getByText('B',{exact:true});
    const box=await text.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box.x+1,box.y+box.height/2);
    await page.mouse.down();
    await page.mouse.move(box.x+15,box.y+box.height/2,{steps:3});
    await page.mouse.up();
    const selected=await checkpoint(page,record.id,'same-cell native text range');
    const node=stateRow(record.before,record.item.anchor+'/0/0').id;
    expect(selected.state.selection).toEqual({
      anchor:{kind:'text',node,offset:0,affinity:'after'},
      focus:{kind:'text',node,offset:1,affinity:'after'},
    });
    await expect(highlights(record.editor)).toHaveCount(0);
  });
  test('custom table-like markup retains ordinary selection and never publishes a table rectangle',async({page})=>{
    const quote=content=>({type:'blockquote',content});
    const rows=Array.from({length:2},(_,row)=>quote(Array.from({length:3},(_,column)=>quote([
      {type:'paragraph',content:[{type:'text',text:`R${row}C${column}`}]},
    ]))));
    const source=canonicalizeRaw(JSON.stringify({
      schema:'klenwriter.document',schema_version:1,profile:'prose',content:[quote(rows)],
    }));
    const mounted=await page.evaluate(async source=>{
      const {loadSdkV2,sdkBuildId}=await import('/packages/sdk/index.js');
      const {mountEditor,defineRendererCatalog}=await import('/packages/dom/index.js');
      const {kwdjBasicRenderers}=await import('/packages/kwdj/dom.js');
      const {kwdjCommand}=await import('/packages/kwdj/index.js');
      const packet=await fetch('/extensions-packet.json').then(response=>response.json());
      const sdk=await loadSdkV2();
      const base=kwdjBasicRenderers.definition;
      const type='org.klenwriter.kwdj/blockquote';
      const renderers=defineRendererCatalog({...base,nodes:{...base.nodes,[type]:{
        ...base.nodes[type],present:node=>({tag:({1:'td',2:'table',3:'tr'})[node.children.length]}),
      }}});
      const element=document.createElement('div');
      element.setAttribute('aria-label','Custom blockquote presentation');
      element.id='custom-table-like-blockquotes';
      document.getElementById('mounts').append(element);
      const editor=mountEditor({element,renderers,editor:{input:new TextEncoder().encode(source),loader:async()=>sdk,
        options:{abi:'editor-sdk/2',build_id:sdkBuildId,profile:packet.kwdjProfile,admission:'validate',access:'editable',
          registry_json:packet.kwdjRegistryJson,profile_options_json:'{"identities":{"media":[],"references":[]},"limits":null}'}}});
      const ready=await editor.ready;
      if(ready.status!=='ready') {editor.destroy();element.remove();return {ready};}
      const state=()=>editor.read({kind:'state'}).value.state;
      const node=id=>editor.read({kind:'node',stamp:editor.capture(),node:id}).value.node;
      const wrapper=node(node(state().root).children[0]);
      const first=node(node(wrapper.children[0]).children[0]);
      const last=node(node(wrapper.children[1]).children[0]);
      const leaf=node(node(first.children[0]).children[0]);
      const point={kind:'text',node:leaf.id,offset:leaf.text.length,affinity:'after'};
      const select=(anchor,focus)=>editor.submit({kind:'set_selection',stamp:editor.capture(),selection:{anchor,focus}});
      const keys=[];
      const postEditorKey=event=>{
        if (!event.isTrusted || !['ArrowDown','Tab'].includes(event.key)) return;
        keys.push({key:event.key,shift:event.shiftKey,claimed:event.defaultPrevented});
        // Observe the document-bubble handler first, then suppress the UA default.
        event.preventDefault();
      };
      window.addEventListener('keydown',postEditorKey);
      element.focus();
      select(point,point);
      window.customTableLikeBlocks={
        read:()=>({
          keys,state:state(),highlighted:[...element.querySelectorAll('[data-editor-table-cell-selected]')].map(cell=>cell.textContent),
          browserCollapsed:getSelection().isCollapsed,
        }),
        deletion:()=>editor.submit({kind:'command',stamp:editor.capture(),history_hint:{kind:'isolated'},
          command:kwdjCommand({kind:'delete_selection'})}),
        selectStructuralEdges:()=>select(
          {kind:'edge',node:first.id,side:'before'},{kind:'edge',node:last.id,side:'after'},
        ),
        canonical:()=>{
          const snap=editor.submit({kind:'snapshot',stamp:editor.capture(),max_bytes:8192}).response.value;
          editor.submit({kind:'release_snapshot',handle:snap.handle});
          return snap.canonical_json;
        },
        close:()=>{
          window.removeEventListener('keydown',postEditorKey);
          editor.destroy();
          element.remove();
          delete window.customTableLikeBlocks;
        },
      };
      return {ready:ready.status,selection:state().selection,cellType:first.type_id};
    },source);
    expect(mounted).toMatchObject({ready:'ready',cellType:'org.klenwriter.kwdj/blockquote'});
    const editor=page.locator('#custom-table-like-blockquotes');
    const read=()=>page.evaluate(()=>window.customTableLikeBlocks.read());
    try {
      await expect(editor.locator('table tr td')).toHaveCount(6);
      await page.keyboard.press('Shift+ArrowDown');
      await page.keyboard.press('Tab');
      expect(await read()).toMatchObject({
        keys:[{key:'ArrowDown',shift:true,claimed:false},{key:'Tab',shift:false,claimed:false}],
        state:{selection:mounted.selection,stamp:{revision:'0'},history:{undo_entries:'0'}},
        highlighted:[],browserCollapsed:true,
      });
      expect(await page.evaluate(()=>window.customTableLikeBlocks.deletion())).toMatchObject({
        status:'completed',response:{status:'ok',value:{effect:'unchanged'}},
      });

      await mouseDrag(page,editor,'R0C0','R1C0');
      const dragged=await read();
      expect(dragged.state.selection.anchor.kind).toBe('text');
      expect(dragged.state.selection.focus.kind).toBe('text');
      expect(dragged.state.selection.anchor.node).not.toBe(dragged.state.selection.focus.node);
      expect(dragged.highlighted).toEqual([]);
      expect(dragged.browserCollapsed).toBe(false);

      expect(await page.evaluate(()=>window.customTableLikeBlocks.selectStructuralEdges())).toMatchObject({
        status:'completed',response:{status:'ok'},
      });
      expect(await read()).toMatchObject({
        state:{selection:{anchor:{kind:'edge',side:'before'},focus:{kind:'edge',side:'after'}},
          stamp:{revision:'0'},history:{undo_entries:'0'}},
        highlighted:[],browserCollapsed:false,
      });
      expect(await page.evaluate(()=>window.customTableLikeBlocks.canonical())).toBe(source);
    } finally {await page.evaluate(()=>window.customTableLikeBlocks.close());}
  });
  test('structural rectangle refuses linear marks and permits an explicit block target',async({page})=>{
    const record=await mount(page,'DOC-011');
    const selection=expected(record);
    expect((await call(page,'rawSelection',record.id,selection.anchor,selection.focus)).response.status).toBe('ok');
    const availability=await call(page,'queryCommand',record.id,mark);
    expect(availability).toMatchObject({status:'ok',value:{available:false,diagnostic:{code:'kwdj.command_unsupported_context'}}});
    const refused=await call(page,'command',record.id,mark);
    expect(refused.response.diagnostic?.code).toBe('kwdj.command_unsupported_context');
    const table=stateRow(record.before,'/0').id;
    const duplicate=await call(page,'queryCommand',record.id,{kind:'duplicate',node:table,parent:record.before.state.root,index:1});
    expect(duplicate).toMatchObject({status:'ok',value:{available:true}});
    const after=await checkpoint(page,record.id,'linear edit refusal preserves rectangle and document');
    expect(after.state.selection).toEqual(selection);
    expect(after.canonical).toBe(record.source);
    expect(docEvents(after)).toEqual([]);
    history(after,0,0);
  });
});

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

test('OSR-191 mounted DOC-017 exposes the stored labels and retains both body paragraphs', async ({ page }) => {
  const fixture = spoilerDisclosureFixture();
  const whitespace = structuredClone(fixture.document);
  for (const block of whitespace.content) block.attrs.label = '  ';
  for (const [source, names] of [
    [fixture.canonical, fixture.document.content.map(block => block.attrs.label)],
    [canonicalizeRaw(JSON.stringify(whitespace)), ['Спойлер', 'Подробнее']],
  ]) {
    const { id, ready, diagnostic } = await call(page, 'mount', { source, access: 'read_only' });
    expect(ready, JSON.stringify(diagnostic)).toBe('ready');
    const host = page.locator(`#${id}`);
    await expect(host).toHaveAttribute('contenteditable', 'false');
    const containers = host.getByRole('group');
    await expect(containers).toHaveCount(2);
    for (const [index, block] of fixture.document.content.entries()) {
      const container = containers.nth(index);
      await expect(container).toHaveAccessibleName(names[index]);
      await expect(container.locator('p')).toHaveText(block.content[0].content[0].text);
    }
    expect((await checkpoint(page, id, 'read-only labels and canonical export')).canonical).toBe(source);
    await call(page, 'dispose', id);
  }
});

test('OSR-182 DOC-015 renders and reopens all literary kinds in a read-only editor', async ({ page }) => {
  const fixture = literaryFixture();
  const labels = ['Заметка автора', 'Письмо', 'Эпиграф', 'Заметка мира', 'Цитата хроники', 'Архивный фрагмент'];
  async function renderAndExport(source) {
    const { id, ready, diagnostic } = await call(page, 'mount', { source, access: 'read_only' });
    expect(ready, JSON.stringify(diagnostic)).toBe('ready');
    const host = page.locator(`#${id}`);
    await expect(host).toHaveAttribute('contenteditable', 'false');
    const blocks = host.getByRole('group');
    await expect(blocks).toHaveCount(6);
    for (const [index, label] of labels.entries()) await expect(blocks.nth(index)).toHaveAccessibleName(label);
    await expect(blocks.locator(':scope > p')).toHaveText(fixture.rows.map(([, child]) => child));
    const point = await checkpoint(page, id, 'DOC-015 read and rendered literary kinds');
    const rows = labels.map((_, index) => {
      const block = stateRow(point, `/${index}`);
      expect(block).toMatchObject({ type_id: 'org.klenwriter.kwdj/literary_block', primitive: 'container' });
      return [block.attributes.kind.value, stateRow(point, `/${index}/0/0`).text];
    });
    expect(rows).toEqual(fixture.rows);
    await call(page, 'dispose', id);
    return point.canonical;
  }
  const saved = await renderAndExport(fixture.canonical);
  expect(saved).toBe(fixture.canonical);
  expect(await renderAndExport(saved)).toBe(fixture.canonical);
});

const osr187Bytes = content => canonicalizeRaw(JSON.stringify({
  schema: 'klenwriter.document', schema_version: 1, profile: 'prose', content,
}));

// The OSR-184 native and packaged SDK2 wrap/unwrap fixture, with unchanged payload bytes.
const osr184MountedBlocks = [
  { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
  { type: 'paragraph', attrs: { align: 'right' }, content: [
    { type: 'text', text: 'Note 😀', marks: [{ type: 'strong' }] },
    { type: 'hard_break' },
    { type: 'text', text: 'Continuation' },
  ] },
  { type: 'scene_break' },
  { type: 'blockquote', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'Quotation', marks: [{ type: 'emphasis' }] },
  ] }] },
  { type: 'literary_block', attrs: { kind: 'letter' }, content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Preserved' }] },
  ] },
];
const osr184MountedInitial = osr187Bytes(osr184MountedBlocks);
const osr184MountedWrapped = osr187Bytes([
  osr184MountedBlocks[0],
  { type: 'literary_block', attrs: { kind: 'author_note' }, content: osr184MountedBlocks.slice(1, 4) },
  osr184MountedBlocks[4],
]);

async function osr187StructuralCommand(page, id, name, payload) {
  const result = await call(page, 'submit', id, {
    kind: 'command',
    command: { id: 'org.klenwriter.kwdj/command/' + name, payload_json: JSON.stringify(payload) },
    history_hint: { kind: 'isolated' },
  });
  expect(result, JSON.stringify(result)).toMatchObject({ response: { status: 'ok', value: { effect: 'changed' } } });
}

test('OSR-187 mounted wrap preserves the OSR-184 children', async ({ page, browser }) => {
  observations.get(page).browserVersion = browser.version();
  const { id, ready, diagnostic } = await call(page, 'mount', { source: osr184MountedInitial });
  expect(ready, JSON.stringify(diagnostic)).toBe('ready');
  await call(page, 'select', id, '', 1, '', 4);
  const before = await checkpoint(page, id, 'OSR-184 native wrap input with root gaps 1 through 4');
  expect(before.canonical).toBe(osr184MountedInitial);
  expect(before.actualSelection).toMatchObject({ anchorOffset: 1, focusOffset: 4, inside: true });
  const gap = index => ({ kind: 'child', parent: before.state.root, index, affinity: 'after' });
  expect(before.state.selection).toEqual({ anchor: gap(1), focus: gap(4) });
  const children = stateRow(before, '').children;

  await osr187StructuralCommand(page, id, 'wrap-literary-block', {
    kind: 'wrap_literary_block', literary_kind: 'author_note',
  });
  const after = await checkpoint(page, id, 'Mounted wrap produces the OSR-184 native result');
  expect(after.canonical).toBe(osr184MountedWrapped);
  const wrapper = stateRow(after, '/1');
  expect(wrapper).toMatchObject({
    type_id: 'org.klenwriter.kwdj/literary_block',
    attributes: { kind: { kind: 'string', value: 'author_note' } },
    children: children.slice(1, 4),
  });
  expect(stateRow(after, '').children).toEqual([children[0], wrapper.id, children[4]]);
  expect(after.failures).toEqual([]);
  history(after, 1, 0);
  expect(docEvents(after)).toHaveLength(1);

  const host = page.locator('#' + id);
  const note = host.getByRole('group', { name: 'Заметка автора', exact: true });
  await expect(note).toBeVisible();
  expect(await note.locator(':scope > [data-editor-node]').evaluateAll(elements => elements.map(el => el.tagName)))
    .toEqual(['P', 'HR', 'BLOCKQUOTE']);
});

test('OSR-187 mounted unwrap restores the OSR-184 children and its input passes axe', async ({ page, browser }) => {
  observations.get(page).browserVersion = browser.version();
  const { id, ready, diagnostic } = await call(page, 'mount', { source: osr184MountedWrapped });
  expect(ready, JSON.stringify(diagnostic)).toBe('ready');
  const before = await checkpoint(page, id, 'OSR-184 native unwrap input');
  expect(before.canonical).toBe(osr184MountedWrapped);
  const [left, wrapperId, right] = stateRow(before, '').children;
  const children = stateRow(before, '/1').children;
  const host = page.locator('#' + id);
  await expect(host.getByRole('group', { name: 'Заметка автора', exact: true })).toBeVisible();
  const result = await new AxeBuilder({ page }).include('#' + id).analyze();
  observations.get(page).axe = {
    engine: result.testEngine, scope: 'OSR-187 mounted literary document',
    violations: result.violations, incomplete: result.incomplete, passedRules: result.passes.map(rule => rule.id),
  };
  expect(result.violations).toEqual([]);
  expect(result.passes.length).toBeGreaterThan(0);

  await osr187StructuralCommand(page, id, 'unwrap-literary-block', {
    kind: 'unwrap_literary_block', node: wrapperId,
  });
  const after = await checkpoint(page, id, 'Mounted explicit unwrap produces the OSR-184 native result');
  expect(after.canonical).toBe(osr184MountedInitial);
  expect(stateRow(after, '').children).toEqual([left, ...children, right]);
  expect(after.failures).toEqual([]);
  history(after, 1, 0);
  expect(docEvents(after)).toHaveLength(1);
  await expect(host.getByRole('group', { name: 'Заметка автора', exact: true })).toHaveCount(0);
  expect(await host.locator(':scope > [data-editor-node]').evaluateAll(elements => elements.map(el => el.tagName)))
    .toEqual(['P', 'P', 'HR', 'BLOCKQUOTE', 'SECTION']);
});

test('OSR-187 trusted first-literary-child Backspace preserves the OSR-185 native bytes', async ({ page, browser }) => {
  observations.get(page).browserVersion = browser.version();
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/osr-185-literary.json', import.meta.url), 'utf8'));
  const source = canonicalizeRaw(JSON.stringify(fixture.initial));
  const expected = fixture.refusals.first_child_backspace;
  const { id, ready, diagnostic } = await call(page, 'mount', { source });
  expect(ready, JSON.stringify(diagnostic)).toBe('ready');
  const path = '/1/0/0';
  await call(page, 'select', id, path, 0);
  const before = await checkpoint(page, id, 'OSR-185 native first literary child at UTF-16 offset zero');
  expect(before.canonical).toBe(source);
  caret(before, stateRow(before, path).id, 0);
  expect(await call(page, 'nativeSelectionMatches', id, path, 0)).toBe(true);
  const availability = await call(page, 'queryCommand', id, { kind: 'delete_backward' });
  expect(availability, JSON.stringify(availability)).toMatchObject({
    status: 'ok', value: { available: false, diagnostic: expected },
  });

  const host = page.locator('#' + id);
  await expect(host).toBeFocused();
  await host.evaluate(element => {
    element.addEventListener('beforeinput', event => {
      element.literaryBackspace = {
        inputType: event.inputType, trusted: event.isTrusted, prevented: event.defaultPrevented,
      };
    }, { once: true });
  });
  await page.keyboard.press('Backspace');
  const input = await host.evaluate(element => element.literaryBackspace);
  expect(input).toEqual({ inputType: 'deleteContentBackward', trusted: true, prevented: true });
  observations.get(page).literaryBackspace = { input, nativeAvailability: availability };

  const after = await checkpoint(page, id, 'Trusted Backspace leaves the OSR-185 native result unchanged');
  expect(after.canonical).toBe(source);
  expect(after.state).toEqual(before.state);
  expect(after.rows).toEqual(before.rows);
  expect(after.events).toEqual(before.events);
  expect(after.actualSelection).toEqual(before.actualSelection);
  expect(after.lifecycle).toBe('ready');
  expect(after.failures).toHaveLength(before.failures.length + 1);
  expect(after.failures.at(-1)).toMatchObject({
    status: 'dom_refused', diagnostic: { code: 'dom.command_unsupported', phase: 'command', publication: 'none' },
  });
  expect(await call(page, 'nativeSelectionMatches', id, path, 0)).toBe(true);
});

test('OSR-188 mounted DOC-016 warning labels and body are readable without editing', async ({ page }) => {
  const fixture = warningFixture();
  const { id, ready, diagnostic } = await call(page, 'mount', { source: fixture.canonical, access: 'read_only' });
  expect(ready, JSON.stringify(diagnostic)).toBe('ready');
  const host = page.locator(`#${id}`);
  await expect(host).toHaveAttribute('contenteditable', 'false');
  const general = host.getByRole('group', { name: 'Предупреждение', exact: true });
  const content = host.getByRole('group', { name: 'Темы', exact: true });
  await expect(general.locator('p')).toHaveText('Общее');
  await expect(content.locator('p')).toHaveText('Контент');
  expect((await checkpoint(page, id, 'read-only warnings and exact export')).canonical).toBe(fixture.canonical);
});

const osr189WarningFixture = () => JSON.parse(readFileSync(new URL('./fixtures/osr-189-warning.json', import.meta.url), 'utf8'));

test('OSR-190 mounted root-gap create matches both OSR-188 warning defaults', async ({ page, browser }) => {
  observations.get(page).browserVersion = browser.version();
  const [left, right] = ['Before', 'After'].map(text => ({ type: 'paragraph', content: [{ type: 'text', text }] }));
  const source = osr187Bytes([left, right]);
  for (const [kind, name] of [['general', 'Предупреждение'], ['content', 'Контент']]) {
    const warning = { type: 'warning', attrs: { kind }, content: [{ type: 'paragraph', content: [] }] };
    const expected = osr187Bytes([left, warning, right]);
    const { id, ready, diagnostic } = await call(page, 'mount', { source });
    expect(ready, JSON.stringify(diagnostic)).toBe('ready');
    await call(page, 'select', id, '', 1);
    const before = await checkpoint(page, id, 'OSR-188 ' + kind + ' before root-gap create');
    expect(before.canonical).toBe(source);
    caret(before, before.state.root, 1, 'child');

    await osr187StructuralCommand(page, id, 'insert-block', {
      kind: 'insert_block', target: { kind: 'warning', warning_kind: kind },
    });
    const after = await checkpoint(page, id, 'OSR-188 ' + kind + ' after root-gap create');
    expect(after.canonical).toBe(expected);
    const [first, , last] = stateRow(after, '').children;
    expect([first, last]).toEqual(stateRow(before, '').children);
    expect(stateRow(after, '/1').attributes).toEqual({ kind: { kind: 'string', value: kind } });
    const seed = stateRow(after, '/1/0');
    expect(seed.children).toEqual([]);
    caret(after, seed.id, 0, 'child');
    history(after, 1, 0);
    expect(after.failures).toEqual([]);
    const group = page.locator('#' + id).getByRole('group', { name, exact: true });
    await expect(group).toBeVisible();
    const paragraph = group.locator(':scope > p');
    await expect(paragraph).toHaveCount(1);
    expect(await paragraph.evaluate(element => element.isContentEditable)).toBe(true);
    await call(page, 'dispose', id);
  }
});

test('OSR-190 mounted warning wrap and unwrap retain OSR-189 children, bytes and history', async ({ page, browser }) => {
  observations.get(page).browserVersion = browser.version();
  const fixture = osr189WarningFixture();
  const source = osr187Bytes(fixture.initial);
  const wrapped = osr187Bytes(fixture.wrapped);
  const { id, ready, diagnostic } = await call(page, 'mount', { source });
  expect(ready, JSON.stringify(diagnostic)).toBe('ready');
  await call(page, 'select', id, '', 4, '', 1);
  const before = await checkpoint(page, id, 'OSR-189 initial warning wrap range');
  expect(before.canonical).toBe(source);
  const gap = index => ({ kind: 'child', parent: before.state.root, index, affinity: 'after' });
  expect(before.state.selection).toEqual({ anchor: gap(4), focus: gap(1) });
  expect(before.actualSelection).toMatchObject({ anchorOffset: 4, focusOffset: 1, inside: true });
  const original = stateRow(before, '').children;
  const body = original.slice(1, 4);

  await osr187StructuralCommand(page, id, 'wrap-warning', { kind: 'wrap_warning', warning_kind: 'general' });
  const afterWrap = await checkpoint(page, id, 'OSR-189 wrapped warning');
  expect(afterWrap.canonical).toBe(wrapped);
  const warning = stateRow(afterWrap, '/1');
  expect(warning.children).toEqual(body);
  const wrappedIds = [original[0], warning.id, original[4]];
  expect(stateRow(afterWrap, '').children).toEqual(wrappedIds);
  expect(stateRow(afterWrap, '/1/0').children).toEqual(stateRow(before, '/1').children);
  history(afterWrap, 1, 0);
  expect(afterWrap.failures).toEqual([]);
  const group = page.locator('#' + id).getByRole('group', { name: 'Предупреждение', exact: true });
  await expect(group).toBeVisible();
  expect(await group.locator(':scope > [data-editor-node]').evaluateAll(elements => elements.map(el => el.tagName)))
    .toEqual(['P', 'HR', 'BLOCKQUOTE']);
  const axe = await new AxeBuilder({ page }).include('#' + id).analyze();
  observations.get(page).axe = {
    engine: axe.testEngine, scope: 'OSR-190 mounted wrapped warning',
    violations: axe.violations, incomplete: axe.incomplete, passedRules: axe.passes.map(rule => rule.id),
  };
  expect(axe.violations).toEqual([]);
  expect(axe.passes.length).toBeGreaterThan(0);

  await osr187StructuralCommand(page, id, 'unwrap-warning', { kind: 'unwrap_warning', node: warning.id });
  const afterUnwrap = await checkpoint(page, id, 'OSR-189 unwrapped warning');
  expect(afterUnwrap.canonical).toBe(source);
  expect(stateRow(afterUnwrap, '').children).toEqual(original);
  expect(stateRow(afterUnwrap, '/1').children).toEqual(stateRow(before, '/1').children);
  history(afterUnwrap, 2, 0);
  expect(afterUnwrap.failures).toEqual([]);
  await expect(group).toHaveCount(0);

  for (const [direction, canonical, ids, undo, redo] of [
    ['undo', wrapped, wrappedIds, 1, 1],
    ['undo', source, original, 0, 2],
    ['redo', wrapped, wrappedIds, 1, 1],
    ['redo', source, original, 2, 0],
  ]) {
    expect((await call(page, 'history', id, direction)).response.status).toBe('ok');
    const point = await checkpoint(page, id, direction + ' warning structure');
    expect(point.canonical).toBe(canonical);
    expect(stateRow(point, '').children).toEqual(ids);
    if (canonical === wrapped) expect(stateRow(point, '/1').children).toEqual(body);
    history(point, undo, redo);
  }
});

test('OSR-190 trusted first-warning-child Backspace preserves the OSR-189 native result', async ({ page, browser }) => {
  observations.get(page).browserVersion = browser.version();
  const fixture = osr189WarningFixture();
  const source = osr187Bytes(fixture.labeled);
  const { id, ready, diagnostic } = await call(page, 'mount', { source });
  expect(ready, JSON.stringify(diagnostic)).toBe('ready');
  const path = '/1/0/0';
  await call(page, 'select', id, path, 0);
  const before = await checkpoint(page, id, 'OSR-189 warning first child at UTF-16 offset zero');
  expect(before.canonical).toBe(source);
  caret(before, stateRow(before, path).id, 0);
  expect(await call(page, 'nativeSelectionMatches', id, path, 0)).toBe(true);
  const availability = await call(page, 'queryCommand', id, { kind: 'delete_backward' });
  expect(availability, JSON.stringify(availability)).toMatchObject({
    status: 'ok', value: { available: false, diagnostic: fixture.refusals.first_child_backspace },
  });

  const host = page.locator('#' + id);
  await expect(host).toBeFocused();
  await host.evaluate(element => {
    element.addEventListener('beforeinput', event => {
      element.warningBackspace = { inputType: event.inputType, trusted: event.isTrusted, prevented: event.defaultPrevented };
    }, { once: true });
  });
  await page.keyboard.press('Backspace');
  const input = await host.evaluate(element => element.warningBackspace);
  expect(input).toEqual({ inputType: 'deleteContentBackward', trusted: true, prevented: true });
  observations.get(page).warningBackspace = { input, nativeAvailability: availability };

  const after = await checkpoint(page, id, 'Trusted Backspace preserves all OSR-189 warning bytes');
  expect(after.canonical).toBe(source);
  expect(after.state).toEqual(before.state);
  expect(after.rows).toEqual(before.rows);
  expect(after.events).toEqual(before.events);
  expect(after.actualSelection).toEqual(before.actualSelection);
  expect(after.lifecycle).toBe('ready');
  expect(after.failures).toHaveLength(before.failures.length + 1);
  expect(after.failures.at(-1)).toMatchObject({
    status: 'dom_refused', diagnostic: { code: 'dom.command_unsupported', phase: 'command', publication: 'none' },
  });
  expect(await call(page, 'nativeSelectionMatches', id, path, 0)).toBe(true);
});

const osr193Routes = [
  { type: 'spoiler', index: 0, control: 'Spoiler label', body: '/0/0/0', bodyEnd: 5, next: '/1/0/0' },
  { type: 'disclosure', index: 1, control: 'Disclosure label', body: '/1/0/0', bodyEnd: 7, next: '/2/0' },
];

const osr193Source = () => readFileSync(new URL('./fixtures/osr-192-label-entry.input.json', import.meta.url), 'utf8');
const osr193Expected = () => readFileSync(new URL('./fixtures/osr-192-label-entry.canonical.json', import.meta.url), 'utf8');

async function osr193Mount(page, bodyPath, source = osr193Source(), routes = osr193Routes, bindInitially = true, mediaIds = []) {
  await page.evaluate(async ({ source, routes, bodyPath, bindInitially, mediaIds }) => {
    const { loadSdkV2, sdkBuildId } = await import('/packages/sdk/index.js');
    const { mountEditor } = await import('/packages/dom/index.js');
    const { kwdjBasicRenderers, bindKwdjContainerLabel } = await import('/packages/kwdj/dom.js');
    const { kwdjCommand } = await import('/packages/kwdj/index.js');
    const packet = await fetch('/extensions-packet.json').then(response => response.json());
    const module = await loadSdkV2();
    const scope = document.createElement('section');
    scope.id = 'osr193-mount';
    const root = document.createElement('div');
    root.id = 'osr193-editor';
    root.setAttribute('aria-label', 'KlenWriter label editing example');
    const fields = routes.map(route => {
      const field = document.createElement('input');
      field.type = 'text';
      field.setAttribute('aria-label', route.control);
      scope.append(field);
      return field;
    });
    scope.append(root);
    document.getElementById('mounts').append(scope);

    const editor = mountEditor({
      element: root, renderers: kwdjBasicRenderers,
      editor: {
        input: new TextEncoder().encode(source), loader: async () => module,
        options: {
          abi: 'editor-sdk/2', build_id: sdkBuildId, profile: packet.kwdjProfile,
          admission: 'validate', access: 'editable', registry_json: packet.kwdjRegistryJson,
          profile_options_json: JSON.stringify({
            identities: { media: mediaIds.map(id => ({ id, status: 'exists' })), references: [] },
            limits: null,
          }),
        },
      },
    });
    const disposers = [];
    const disposeLabels = () => {
      for (const dispose of disposers.splice(0).reverse()) dispose();
    };
    const cleanup = async () => {
      disposeLabels();
      const receipt = editor.destroy();
      scope.remove();
      const response = receipt.sdk.status === 'queued' ? await receipt.sdk.completion : receipt.sdk.response;
      return { status: response.status, native: JSON.parse(module.resourceCounts()) };
    };
    window.osr193Mounted = { cleanup };
    const ready = await editor.ready;
    if (ready.status !== 'ready') throw new Error(JSON.stringify(ready));
    const accepted = reply => {
      if (reply.status !== 'ok') throw new Error(JSON.stringify(reply));
      return reply.value;
    };
    const result = async request => {
      const submission = editor.submit(request);
      if (submission.status === 'completed') return accepted(submission.response);
      if (submission.status === 'queued') return accepted(await submission.completion);
      throw new Error(JSON.stringify(submission));
    };
    const state = () => accepted(editor.read({ kind: 'state' })).state;
    const node = id => accepted(editor.read({ kind: 'node', stamp: editor.capture(), node: id })).node;
    const path = key => key.split('/').filter(Boolean).map(Number);
    const modelAt = key => path(key).reduce((parent, i) => node(parent.children[i]), node(state().root));
    const domAt = key => path(key).reduce((parent, i) => [...parent.children]
      .filter(child => child.hasAttribute('data-editor-node'))[i], root);
    const bindAt = index => {
      const route = routes[index];
      const binding = bindKwdjContainerLabel({
        editor, editorElement: root, input: fields[index], node: modelAt('/' + route.index).id,
      });
      if (typeof binding !== 'function') throw new Error('Expected the label binding disposer');
      disposers.push(binding);
    };
    if (bindInitially) routes.forEach((_, index) => bindAt(index));

    const trace = [];
    const events = [];
    editor.subscribe(event => { if (event.change.kind === 'document') events.push(event); });
    for (const [index, field] of fields.entries()) {
      field.addEventListener('input', event => trace.push({
        type: routes[index].type, inputType: event.inputType, data: event.data, trusted: event.isTrusted,
      }));
    }
    window.osr193Mounted = {
      cleanup, disposeLabels, mode: mode => editor.setInteractionMode(mode),
      hostRequests: () => editor.resources().hostRequests,
      bind(index) {
        try { bindAt(index); return { status: 'bound' }; }
        catch (error) { return { status: 'refused', name: error.name, message: error.message }; }
      },
      replace: source => editor.replace(new TextEncoder().encode(source)),
      setLabel(index, label) {
        return result({
          kind: 'command', stamp: editor.capture(), history_hint: { kind: 'isolated' },
          command: kwdjCommand({ kind: 'set_container_label', node: modelAt('/' + routes[index].index).id, label }),
        });
      },
      at(key, offset) {
        const leaf = modelAt(key);
        const actual = document.getSelection();
        const expected = { kind: 'text', node: leaf.id, offset, affinity: 'after' };
        const native = state().selection;
        const text = document.createTreeWalker(domAt(key), NodeFilter.SHOW_TEXT).nextNode();
        return document.activeElement === root && native?.anchor.kind === expected.kind
          && native.anchor.node === leaf.id && native.focus.node === leaf.id
          && native.anchor.offset === offset && native.focus.offset === offset
          && actual?.anchorNode === text && actual.focusNode === text
          && actual.anchorOffset === offset && actual.focusOffset === offset;
      },
      atAtomEdge(key, side, allowGap) {
        const atom = modelAt(key);
        const atomElement = domAt(key);
        const parent = atomElement.parentNode;
        const offset = [...parent.childNodes].indexOf(atomElement) + Number(side === 'after');
        const actual = document.getSelection();
        const native = state().selection;
        return atom.primitive === 'block_atom' && document.activeElement === root
          && [native?.anchor, native?.focus].every(point =>
            (point?.kind === 'edge' && point.node === atom.id && point.side === side)
            || (allowGap && point?.kind === 'child' && point.parent === atom.parent && point.index === offset))
          && actual?.anchorNode === parent && actual.focusNode === parent
          && actual.anchorOffset === offset && actual.focusOffset === offset;
      },
      atChildGap(key, index) {
        const block = modelAt(key);
        const element = domAt(key);
        const actual = document.getSelection();
        const native = state().selection;
        return document.activeElement === root
          && [native?.anchor, native?.focus].every(point => point?.kind === 'child' && point.parent === block.id && point.index === index)
          && actual?.anchorNode === element && actual.focusNode === element
          && actual.anchorOffset === index && actual.focusOffset === index;
      },
      async inspect(ownedPaths = ['/0', '/0/0', '/0/0/0', '/1', '/1/0', '/1/0/0', '/2', '/2/0']) {
        const saved = await result({ kind: 'snapshot', stamp: editor.capture(), max_bytes: 16384 });
        await result({ kind: 'release_snapshot', handle: saved.handle });
        return { canonical: saved.canonical_json, state: state(), events, trace,
          stableIds: ownedPaths.map(key => modelAt(key).id) };
      },
    };

    // Only initial fixture setup writes focus or a model selection.
    const leaf = modelAt(bodyPath);
    const point = leaf.primitive === 'block_atom'
      ? { kind: 'child', parent: leaf.parent, index: node(leaf.parent).children.indexOf(leaf.id) + 1, affinity: 'after' }
      : { kind: 'text', node: leaf.id, offset: 0, affinity: 'after' };
    root.focus();
    await result({ kind: 'set_selection', stamp: editor.capture(), selection: { anchor: point, focus: point } });
  }, { source, routes, bodyPath, bindInitially, mediaIds });
}

const osr193At = (page, path, offset) => expect.poll(() => page.evaluate(
  ({ path, offset }) => window.osr193Mounted.at(path, offset), { path, offset },
)).toBe(true);
const osr193Inspect = (page, paths) => page.evaluate(paths => window.osr193Mounted.inspect(paths), paths);
async function osr193Cleanup(page) {
  const receipt = await page.evaluate(() => {
    const mounted = window.osr193Mounted;
    delete window.osr193Mounted;
    return mounted?.cleanup();
  });
  if (!receipt) return;
  observations.get(page).labelCleanup = receipt;
  expect(receipt).toEqual({
    status: 'ok', native: { sessions: 0, snapshot_handles: 0, snapshot_bytes: '0', protected_cursors: 0 },
  });
}
async function osr193Field(page, route) {
  const field = page.getByRole('textbox', { name: route.control, exact: true });
  await expect(field).toBeFocused();
  expect(await field.evaluate(element => {
    const root = document.getElementById('osr193-editor');
    return !root.contains(element) && element.selectionStart === element.value.length
      && element.selectionEnd === element.value.length;
  })).toBe(true);
}

test('OSR-193 trusted Tab and arrows traverse label, body and next body in both directions', async ({ page, browser }) => {
  observations.get(page).browserVersion = browser.version();
  for (const route of osr193Routes) {
    try {
      await osr193Mount(page, route.body);
      await osr193At(page, route.body, 0);
      const before = await osr193Inspect(page);
      await page.keyboard.press('Shift+Tab');
      await osr193Field(page, route);
      await page.keyboard.press('Tab');
      await osr193At(page, route.body, 0);
      await page.keyboard.press('Tab');
      await osr193At(page, route.next, 0);
      await page.keyboard.press('Shift+Tab');
      await osr193At(page, route.body, 0);
      await page.keyboard.press('Shift+Tab');
      await osr193Field(page, route);

      await page.keyboard.press('ArrowRight');
      await osr193At(page, route.body, 0);
      for (let offset = 1; offset <= route.bodyEnd; offset++) {
        await page.keyboard.press('ArrowRight');
        await osr193At(page, route.body, offset);
      }
      await page.keyboard.press('ArrowRight');
      await osr193At(page, route.next, 0);
      await page.keyboard.press('ArrowLeft');
      await osr193At(page, route.body, route.bodyEnd);
      for (let offset = route.bodyEnd - 1; offset >= 0; offset--) {
        await page.keyboard.press('ArrowLeft');
        await osr193At(page, route.body, offset);
      }
      await page.keyboard.press('ArrowLeft');
      await osr193Field(page, route);
      const after = await osr193Inspect(page);
      expect(after.canonical).toBe(before.canonical);
      expect(after.state.stamp.revision).toBe(before.state.stamp.revision);
      expect(after.state.history).toEqual(before.state.history);
      expect(after.stableIds).toEqual(before.stableIds);
      expect(after.events).toEqual([]);
      observations.get(page).checkpoints.push({ label: route.type + ' keyboard navigation complete', ...after });
      if (route.type === 'spoiler') {
        await page.locator('#osr193-mount').evaluate(scope => {
          const previous = document.createElement('input');
          previous.type = 'text';
          previous.setAttribute('aria-label', 'Previous host field');
          scope.prepend(previous);
        });
        await page.keyboard.press('Shift+Tab');
        await expect(page.getByRole('textbox', { name: 'Previous host field' })).toBeFocused();
      }
    } finally {
      await osr193Cleanup(page);
    }
  }
});

test('OSR-193 trusted edits produce the OSR-192 label fixture and keep named accessibility roles', async ({ page, browser }) => {
  observations.get(page).browserVersion = browser.version();
  const [spoiler, disclosure] = osr193Routes;
  try {
    await osr193Mount(page, spoiler.body);
    const before = await osr193Inspect(page);
    await page.keyboard.press('Shift+Tab');
    await osr193Field(page, spoiler);
    await page.keyboard.press('!');
    await expect(page.getByRole('textbox', { name: spoiler.control })).toHaveValue('Финал!');
    await page.keyboard.press('Tab');
    await osr193At(page, spoiler.body, 0);
    await page.keyboard.press('Tab');
    await osr193At(page, disclosure.body, 0);
    // Ordinary movement within the disclosure retires the previous group's
    // reverse route before returning to its own label.
    await page.keyboard.press('ArrowRight');
    await osr193At(page, disclosure.body, 1);
    await page.keyboard.press('ArrowLeft');
    await osr193At(page, disclosure.body, 0);
    await page.keyboard.press('Shift+Tab');
    await osr193Field(page, disclosure);
    await page.keyboard.press('?');
    await expect(page.getByRole('textbox', { name: disclosure.control })).toHaveValue('Подробнее?');
    await expect.poll(async () => (await osr193Inspect(page)).canonical).toBe(osr193Expected());
    const after = await osr193Inspect(page);
    expect(after.stableIds).toEqual(before.stableIds);
    expect(after.events).toHaveLength(2);
    history(after, 2, 0);
    expect(after.trace).toEqual([
      { type: 'spoiler', inputType: 'insertText', data: '!', trusted: true },
      { type: 'disclosure', inputType: 'insertText', data: '?', trusted: true },
    ]);
    const scope = page.locator('#osr193-mount');
    await expect(scope.getByRole('textbox', { name: 'KlenWriter label editing example' })).toHaveAttribute('aria-multiline', 'true');
    await expect(scope.getByRole('group', { name: 'Финал!', exact: true })).toBeVisible();
    await expect(scope.getByRole('group', { name: 'Подробнее?', exact: true })).toBeVisible();
    const axe = await new AxeBuilder({ page }).include('#osr193-mount').analyze();
    observations.get(page).axe = {
      engine: axe.testEngine, violations: axe.violations, incomplete: axe.incomplete, passedRules: axe.passes.map(rule => rule.id),
      ariaSnapshot: await scope.ariaSnapshot(),
    };
    expect(axe.violations).toEqual([]);
    expect(axe.passes.length).toBeGreaterThan(0);
    observations.get(page).checkpoints.push({ label: 'trusted label mutations match OSR-192', ...after });
  } finally {
    await osr193Cleanup(page);
  }
});

test('label IME terminal preserves a newer edit and restores ordinary typing', async ({ page, browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Uses the Chromium input protocol for a real composing field');
  const record = observations.get(page);
  record.browserVersion = browser.version();
  const route = osr193Routes[0];
  const doc = JSON.parse(osr193Source());
  const cdp = await page.context().newCDPSession(page);
  try {
    await osr193Mount(page, route.body);
    const before = await osr193Inspect(page);
    await page.keyboard.press('Shift+Tab');
    await osr193Field(page, route);
    const field = page.getByRole('textbox', { name: route.control, exact: true });
    await field.evaluate(input => {
      input.compositionTrace = [];
      for (const type of ['compositionstart', 'input', 'compositionend']) {
        input.addEventListener(type, event => input.compositionTrace.push({
          type, trusted: event.isTrusted, data: event.data,
          inputType: event.inputType ?? null, isComposing: event.isComposing ?? null,
        }));
      }
    });

    await cdp.send('Input.imeSetComposition', { text: 'Ж', selectionStart: 1, selectionEnd: 1 });
    await expect(field).toHaveValue('ФиналЖ');
    expect(await page.evaluate(() => window.osr193Mounted.hostRequests())).toEqual({ pending: 1, focusContinuations: 0 });
    const composing = await osr193Inspect(page);
    expect(composing.canonical).toBe(before.canonical);
    expect(composing.events).toEqual([]);

    const updated = await page.evaluate(label => window.osr193Mounted.setLabel(0, label), 'Новая метка');
    expect(updated.effect).toBe('changed');
    doc.content[0].attrs.label = 'Новая метка';
    const accepted = canonicalizeRaw(JSON.stringify(doc));
    const competing = await osr193Inspect(page);
    expect(competing.canonical).toBe(accepted);
    expect(competing.events).toHaveLength(1);
    await expect(field).toHaveValue('ФиналЖ');

    await cdp.send('Input.insertText', { text: 'Ю' });
    await expect(field).toHaveValue('Новая метка');
    const settled = await osr193Inspect(page);
    expect(settled.canonical).toBe(accepted);
    expect(settled.state).toEqual(competing.state);
    expect(settled.events).toEqual(competing.events);
    expect(await page.evaluate(() => window.osr193Mounted.hostRequests())).toEqual({ pending: 0, focusContinuations: 0 });

    await page.keyboard.press('!');
    await expect(field).toHaveValue('Новая метка!');
    doc.content[0].attrs.label = 'Новая метка!';
    const after = await osr193Inspect(page);
    expect(after.canonical).toBe(canonicalizeRaw(JSON.stringify(doc)));
    expect(after.stableIds).toEqual(before.stableIds);
    expect(after.events).toHaveLength(2);
    history(after, 2, 0);
    const trace = await field.evaluate(input => input.compositionTrace);
    expect(trace).toEqual([
      { type: 'compositionstart', trusted: true, data: '', inputType: null, isComposing: null },
      { type: 'input', trusted: true, data: 'Ж', inputType: 'insertCompositionText', isComposing: true },
      { type: 'input', trusted: true, data: 'Ю', inputType: 'insertCompositionText', isComposing: true },
      { type: 'compositionend', trusted: expect.any(Boolean), data: 'Ю', inputType: null, isComposing: null },
      { type: 'input', trusted: true, data: '!', inputType: 'insertText', isComposing: false },
    ]);
    record.checkpoints.push({ label: 'stale composition discarded and ordinary typing restored', ...after });
    await field.evaluate(input => { input.compositionTrace = []; });
    await cdp.send('Input.imeSetComposition', { text: 'Р', selectionStart: 1, selectionEnd: 1 });
    await expect(field).toHaveValue('Новая метка!Р');
    expect((await osr193Inspect(page)).state).toEqual(after.state);
    await cdp.send('Input.insertText', { text: 'Я' });
    const fresh = await osr193Inspect(page);
    doc.content[0].attrs.label = 'Новая метка!Я';
    expect(fresh.canonical).toBe(canonicalizeRaw(JSON.stringify(doc)));
    expect(fresh.stableIds).toEqual(before.stableIds);
    expect(fresh.events).toHaveLength(3);
    history(fresh, 3, 0);
    expect(await page.evaluate(() => window.osr193Mounted.hostRequests())).toEqual({ pending: 0, focusContinuations: 0 });
    const freshTrace = await field.evaluate(input => input.compositionTrace);
    expect(freshTrace.at(-1)).toMatchObject({ type: 'compositionend', data: 'Я' });
    record.labelComposition = { stale: trace, fresh: freshTrace };
    record.checkpoints.push({ label: 'current composition published once', ...fresh });

    await cdp.send('Input.imeSetComposition', { text: 'Ц', selectionStart: 1, selectionEnd: 1 });
    await expect(field).toHaveValue('Новая метка!ЯЦ');
    expect((await page.evaluate(() => window.osr193Mounted.mode('readOnly'))).status).toBe('updated');
    await expect(field).not.toBeEditable();
    await expect(field).toHaveValue('Новая метка!Я');
    await cdp.send('Input.insertText', { text: 'Щ' });
    expect((await osr193Inspect(page)).state).toEqual(fresh.state);
    expect(await page.evaluate(() => window.osr193Mounted.hostRequests())).toEqual({ pending: 0, focusContinuations: 0 });
    expect((await page.evaluate(() => window.osr193Mounted.mode('editable'))).status).toBe('updated');
    await expect(field).toBeEditable();
    await page.keyboard.press('?');
    await expect(field).toHaveValue('Новая метка!Я?');
    const resumed = await osr193Inspect(page);
    doc.content[0].attrs.label = 'Новая метка!Я?';
    expect(resumed.canonical).toBe(canonicalizeRaw(JSON.stringify(doc)));
    expect(resumed.events).toHaveLength(4);
    history(resumed, 4, 0);
    record.checkpoints.push({ label: 'read-only mode canceled composition and the field resumed ordinary typing', ...resumed });
    await field.evaluate(input => {
      input.addEventListener('input', event => {
        if (event.isTrusted && event.isComposing) {
          input.dispatchEvent(new CompositionEvent('compositionend', {
            data: event.data, bubbles: true, cancelable: true, composed: true,
          }));
        }
      }, { once: true });
    });
    await cdp.send('Input.imeSetComposition', { text: 'Х', selectionStart: 1, selectionEnd: 1 });
    await expect(field).toHaveValue('Новая метка!Я?Х');
    expect((await osr193Inspect(page)).state).toEqual(resumed.state);
    expect(await page.evaluate(() => window.osr193Mounted.hostRequests())).toEqual({ pending: 1, focusContinuations: 0 });

    await field.evaluate(async input => {
      await new Promise(resolve => setTimeout(resolve, 0));
      input.dispatchEvent(new CompositionEvent('compositionend', {
        data: 'Х', bubbles: true, cancelable: true, composed: true,
      }));
    });
    expect((await osr193Inspect(page)).state).toEqual(resumed.state);
    expect(await page.evaluate(() => window.osr193Mounted.hostRequests())).toEqual({ pending: 1, focusContinuations: 0 });

    await cdp.send('Input.insertText', { text: 'Х' });
    const sameValue = await osr193Inspect(page);
    doc.content[0].attrs.label = 'Новая метка!Я?Х';
    expect(sameValue.canonical).toBe(canonicalizeRaw(JSON.stringify(doc)));
    expect(sameValue.events).toHaveLength(5);
    history(sameValue, 5, 0);
    expect(await page.evaluate(() => window.osr193Mounted.hostRequests())).toEqual({ pending: 0, focusContinuations: 0 });
    record.checkpoints.push({ label: 'native terminal accepted after unrelated synthetic endings', ...sameValue });
  } finally {
    await cdp.detach();
    await osr193Cleanup(page);
  }
});

test('OSR-193 trusted keyboard navigation enters and crosses an atom-only body', async ({ page, browser }) => {
  const record = observations.get(page);
  record.browserVersion = browser.version();
  const [spoiler, disclosure] = osr193Routes;
  const fixture = JSON.parse(osr193Source());
  fixture.content[0].content = [{ type: 'scene_break' }];
  const source = canonicalizeRaw(JSON.stringify(fixture));
  const paths = ['/0', '/0/0', '/1', '/1/0', '/1/0/0', '/2', '/2/0'];
  try {
    await osr193Mount(page, disclosure.body, source);
    const before = await osr193Inspect(page, paths);
    const field = page.getByRole('textbox', { name: spoiler.control, exact: true });
    await field.evaluate(input => {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    await osr193Field(page, spoiler);
    const edge = side => expect.poll(() => page.evaluate(
      side => window.osr193Mounted.atAtomEdge('/0/0', side), side,
    )).toBe(true);

    await page.keyboard.press('ArrowRight');
    await edge('before');
    await page.keyboard.press('ArrowRight');
    await edge('after');
    await page.keyboard.press('ArrowRight');
    await osr193At(page, disclosure.body, 0);
    await page.keyboard.press('ArrowLeft');
    await edge('after');
    await page.keyboard.press('ArrowLeft');
    await edge('before');
    await page.keyboard.press('ArrowLeft');
    await osr193Field(page, spoiler);

    await page.keyboard.press('Tab');
    await edge('before');
    await page.keyboard.press('Tab');
    await osr193At(page, disclosure.body, 0);
    await page.keyboard.press('Shift+Tab');
    await edge('before');
    await page.keyboard.press('Shift+Tab');
    await osr193Field(page, spoiler);

    const after = await osr193Inspect(page, paths);
    expect(after.canonical).toBe(source);
    expect(after.stableIds).toEqual(before.stableIds);
    expect(after.state.stamp.revision).toBe('0');
    expect(after.events).toEqual([]);
    history(after, 0, 0);
    record.checkpoints.push({ label: 'atom-only body keyboard navigation complete', ...after });
  } finally {
    await osr193Cleanup(page);
  }
});

test('OSR-193 arrows recognize a browser gap beside the final atom in a mixed body', async ({ page, browser }) => {
  const record = observations.get(page);
  record.browserVersion = browser.version();
  const [, disclosure] = osr193Routes;
  const fixture = JSON.parse(osr193Source());
  fixture.content[0].content.push({ type: 'scene_break' });
  const source = canonicalizeRaw(JSON.stringify(fixture));
  try {
    await osr193Mount(page, '/0/1', source);
    const before = await osr193Inspect(page);
    expect(before.state.selection.anchor.kind).toBe('child');
    await expect.poll(() => page.evaluate(() => window.osr193Mounted.atAtomEdge('/0/1', 'after', true))).toBe(true);
    await page.keyboard.press('ArrowRight');
    await osr193At(page, disclosure.body, 0);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => page.evaluate(() => window.osr193Mounted.atAtomEdge('/0/1', 'after'))).toBe(true);
    const after = await osr193Inspect(page);
    expect(after.canonical).toBe(source);
    expect(after.stableIds).toEqual(before.stableIds);
    expect(after.state.stamp.revision).toBe('0');
    expect(after.events).toEqual([]);
    history(after, 0, 0);
    record.checkpoints.push({ label: 'mixed body recognizes an equivalent atom gap', ...after });
  } finally {
    await osr193Cleanup(page);
  }
});

test('OSR-193 arrows visit both sides of a hard break before leaving the body', async ({ page, browser }) => {
  const record = observations.get(page);
  record.browserVersion = browser.version();
  const [spoiler, disclosure] = osr193Routes;
  for (const prefix of [[], [{ type: 'text', text: 'Тайна' }]]) {
    const fixture = JSON.parse(osr193Source());
    fixture.content[0].content[0].content = [...prefix, { type: 'hard_break' }];
    const source = canonicalizeRaw(JSON.stringify(fixture));
    try {
      await osr193Mount(page, disclosure.body, source);
      const before = await osr193Inspect(page);
      const field = page.getByRole('textbox', { name: spoiler.control, exact: true });
      await field.evaluate(input => {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });
      await osr193Field(page, spoiler);
      const gap = index => expect.poll(() => page.evaluate(
        index => window.osr193Mounted.atChildGap('/0/0', index), index,
      )).toBe(true);
      await page.keyboard.press('ArrowRight');
      if (prefix.length) {
        await osr193At(page, spoiler.body, 0);
        for (let offset = 1; offset <= spoiler.bodyEnd; offset++) {
          await page.keyboard.press('ArrowRight');
          await osr193At(page, spoiler.body, offset);
        }
      } else {
        await gap(0);
      }
      await page.keyboard.press('ArrowRight');
      await gap(prefix.length + 1);
      await page.keyboard.press('ArrowRight');
      await osr193At(page, disclosure.body, 0);
      await page.keyboard.press('ArrowLeft');
      await gap(prefix.length + 1);
      await page.keyboard.press('ArrowLeft');
      await gap(prefix.length);
      await page.keyboard.press(prefix.length ? 'Shift+Tab' : 'ArrowLeft');
      await osr193Field(page, spoiler);

      const after = await osr193Inspect(page);
      expect(after.canonical).toBe(source);
      expect(after.stableIds).toEqual(before.stableIds);
      expect(after.state.stamp.revision).toBe('0');
      expect(after.events).toEqual([]);
      history(after, 0, 0);
      record.checkpoints.push({ label: 'hard break keyboard navigation complete', ...after });
    } finally {
      await osr193Cleanup(page);
    }
  }
});

test('OSR-193 nested label follows model siblings and retires its owned input', async ({ page, browser }) => {
  observations.get(page).browserVersion = browser.version();
  const initial = JSON.parse(osr193Source());
  initial.content[0] = { type: 'blockquote', content: [initial.content[0]] };
  const source = canonicalizeRaw(JSON.stringify(initial));
  const route = { ...osr193Routes[0], index: '0/0', body: '/0/0/0/0' };
  try {
    await osr193Mount(page, route.body, source, [route]);
    await osr193At(page, route.body, 0);
    await page.keyboard.press('Shift+Tab');
    await osr193Field(page, route);
    await page.keyboard.press('Tab');
    await osr193At(page, route.body, 0);
    await page.keyboard.press('Tab');
    await osr193At(page, route.next, 0);
    await page.keyboard.press('Shift+Tab');
    await osr193At(page, route.body, 0);
    await page.keyboard.press('Shift+Tab');
    await osr193Field(page, route);

    const field = page.getByRole('textbox', { name: route.control, exact: true });
    const mode = value => page.evaluate(value => window.osr193Mounted.mode(value), value);
    expect((await mode('readOnly')).status).toBe('updated');
    await expect(field).not.toBeEditable();
    await page.keyboard.press('!');
    await expect(field).toHaveValue('Финал');
    expect((await mode('editable')).status).toBe('updated');
    await expect(field).toBeEditable();
    await page.evaluate(() => window.osr193Mounted.disposeLabels());
    await page.keyboard.press('!');
    await expect(field).toHaveValue('Финал!');
    const after = await osr193Inspect(page);
    expect(after.canonical).toBe(source);
    expect(after.events).toEqual([]);
    expect(after.state.stamp.revision).toBe('0');
    observations.get(page).checkpoints.push({ label: 'nested navigation and detached label owner', ...after });
  } finally {
    await osr193Cleanup(page);
  }
});

test('OSR-193 nested bound labels return to the field that entered their shared body', async ({ page, browser }) => {
  const record = observations.get(page);
  record.browserVersion = browser.version();
  const initial = JSON.parse(osr193Source());
  initial.content[0].content = initial.content.splice(1, 1);
  const source = canonicalizeRaw(JSON.stringify(initial));
  const body = '/0/0/0/0';
  const next = '/1/0';
  const [spoiler, disclosure] = osr193Routes;
  const outer = { ...spoiler, body, next };
  const inner = { ...disclosure, index: '0/0', body, next };
  const paths = ['/0', '/0/0', '/0/0/0', body, '/1', next];

  try {
    await osr193Mount(page, body, source, [outer, inner]);
    const before = await osr193Inspect(page, paths);
    await page.keyboard.press('Shift+Tab');
    await osr193Field(page, inner);
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('textbox', { name: outer.control, exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await osr193At(page, body, 0);
    await page.keyboard.press('Shift+Tab');
    await osr193Field(page, outer);
    await page.keyboard.press('Tab');
    await osr193At(page, body, 0);
    await page.keyboard.press('Tab');
    await osr193At(page, next, 0);
    await page.keyboard.press('Shift+Tab');
    await osr193At(page, body, 0);
    await page.keyboard.press('Shift+Tab');
    await osr193Field(page, outer);

    await page.keyboard.press('ArrowRight');
    await osr193At(page, body, 0);
    await page.keyboard.press('ArrowLeft');
    await osr193Field(page, outer);
    await page.keyboard.press('ArrowRight');
    for (let offset = 0; offset <= inner.bodyEnd; offset++) {
      await osr193At(page, body, offset);
      await page.keyboard.press('ArrowRight');
    }
    await osr193At(page, next, 0);
    await page.keyboard.press('ArrowLeft');
    for (let offset = inner.bodyEnd; offset >= 0; offset--) {
      await osr193At(page, body, offset);
      await page.keyboard.press('ArrowLeft');
    }
    await osr193Field(page, outer);

    const after = await osr193Inspect(page, paths);
    expect(after.canonical).toBe(source);
    expect(after.stableIds).toEqual(before.stableIds);
    expect(after.state.stamp.revision).toBe('0');
    expect(after.events).toEqual([]);
    history(after, 0, 0);
    record.checkpoints.push({ label: 'both nested fields keep independent keyboard routes', ...after });
  } finally {
    await osr193Cleanup(page);
  }
});

test.describe('OSR-207 tables in bound label containers', () => {
  const retained = JSON.parse(readFileSync(new URL('../contracts/kwdj/v1/fixtures/positive.json', import.meta.url), 'utf8'))
    .fixtures.find(row => row.id === 'DOC-011').cases.find(row => row.name === 'table_spans_alignment').kwdj;
  const paths = { table:'/0/0', AB:'/0/0/0/0/0/0', A:'/0/0/1/0/0/0', B1:'/0/0/1/1/0/0', B2:'/0/0/2/0/0/0', next:'/1/0' };
  const owned = ['/0', ...Object.values(paths)];

  for (const [type, key, path, offset] of [
    ['spoiler', 'Tab', paths.B2, 0],
    ['disclosure', 'Shift+Tab', paths.A, 1],
  ]) {
    test(`${type} yields its trusted ${key} to the interior cell route`, async ({ page }) => {
      const label = `${type} label`;
      const source = canonicalizeRaw(JSON.stringify({...retained,content:[
        {type,attrs:{label},content:retained.content},
        {type:'paragraph',content:[{type:'text',text:'after table container'}]},
      ]}));
      await osr193Mount(page,paths.B1,source,[{type,index:0,control:label}]);
      try {
        await osr193At(page,paths.B1,0);
        const original = await osr193Inspect(page,owned);
        await page.keyboard.press(key);
        await osr193At(page,path,offset);
        await expect(page.getByRole('textbox',{name:label,exact:true})).not.toBeFocused();

        const beforeCancel = await osr193Inspect(page,owned);
        await page.locator('#osr193-editor').evaluate(root => {
          function cancelTab(event) {
            if (event.key !== 'Tab') return;
            event.preventDefault();
            root.removeEventListener('keydown',cancelTab);
          }
          root.addEventListener('keydown',cancelTab);
        });
        await page.keyboard.press(type === 'spoiler' ? 'Tab' : 'Shift+Tab');
        await osr193At(page,path,offset);
        expect((await osr193Inspect(page,owned)).state).toEqual(beforeCancel.state);

        if (type === 'spoiler') {
          await page.keyboard.press('Tab');
          await expect.poll(() => page.evaluate(() => window.osr193Mounted.atChildGap('/0',1))).toBe(true);
          await page.keyboard.press('Tab');
          await osr193At(page,paths.next,0);
          await page.keyboard.press('Shift+Tab');
          await osr193At(page,paths.AB,0);
        } else {
          await page.keyboard.press('Shift+Tab');
          await osr193At(page,paths.AB,2);
          await page.keyboard.press('Shift+Tab');
          await expect.poll(() => page.evaluate(() => window.osr193Mounted.atChildGap('/0',0))).toBe(true);
          await page.keyboard.press('Shift+Tab');
          const field = page.getByRole('textbox',{name:label,exact:true});
          await expect(field).toBeFocused();
          await page.keyboard.press('Tab');
          await osr193At(page,paths.AB,0);
          // The table has no left-hand neighbor here, so the label can handle its own boundary.
          await page.keyboard.press('ArrowLeft');
          await expect(field).toBeFocused();
          await page.keyboard.press('ArrowRight');
          await osr193At(page,paths.AB,0);
        }

        await page.evaluate(() => window.osr193Mounted.disposeLabels());
        await page.keyboard.press('Tab');
        await osr193At(page,paths.A,0);
        const after = await osr193Inspect(page,owned);
        expect(after.canonical).toBe(source);
        expect(after.stableIds).toEqual(original.stableIds);
        expect(after.state.stamp.revision).toBe(original.state.stamp.revision);
        expect(after.state.history).toEqual(original.state.history);
        expect(after.state.dirty).toBe(original.state.dirty);
        expect(after.events).toEqual([]);
      } finally {
        await osr193Cleanup(page);
      }
    });
  }
});

test('OSR-193 Tab reaches the immediate sibling in a wide manuscript', async ({ page, browser }) => {
  observations.get(page).browserVersion = browser.version();
  const initial = JSON.parse(osr193Source());
  initial.content.splice(1, 1);
  initial.content.push(...Array.from({ length: 4095 }, () => ({ type: 'paragraph', content: [] })));
  const route = { ...osr193Routes[0], next: '/1/0' };
  try {
    await osr193Mount(page, route.body, canonicalizeRaw(JSON.stringify(initial)), [route]);
    expect(await page.locator('#osr193-editor > [data-editor-node]').count()).toBe(4097);
    await page.keyboard.press('Shift+Tab');
    await osr193Field(page, route);
    await page.keyboard.press('Tab');
    await osr193At(page, route.body, 0);
    await page.keyboard.press('Tab');
    await osr193At(page, route.next, 0);
    await page.keyboard.press('Shift+Tab');
    await osr193At(page, route.body, 0);
    await page.keyboard.press('Shift+Tab');
    await osr193Field(page, route);
  } finally {
    await osr193Cleanup(page);
  }
});

test('OSR-193 routes through a captionless media body', async ({ page, browser }) => {
  const record = observations.get(page);
  record.browserVersion = browser.version();
  const [spoiler, disclosure] = osr193Routes;
  const initial = JSON.parse(osr193Source());
  const media = approvedMedia('DOC-027');
  initial.content[0].content = [media];
  const source = canonicalizeRaw(JSON.stringify(initial));
  const body = '/0/0';
  const paths = ['/0', body, '/1', '/1/0', disclosure.body];
  try {
    await osr193Mount(page, disclosure.body, source, osr193Routes, true, [media.attrs.media_asset_id]);
    const before = await osr193Inspect(page, paths);
    const field = page.getByRole('textbox', { name: spoiler.control, exact: true });
    await field.evaluate(input => {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    const atBody = () => expect.poll(() => page.evaluate(path => window.osr193Mounted.atChildGap(path, 0), body)).toBe(true);

    for (const [forward, backward] of [['Tab', 'Shift+Tab'], ['ArrowRight', 'ArrowLeft']]) {
      await page.keyboard.press(forward);
      await atBody();
      await page.keyboard.press(forward);
      await osr193At(page, disclosure.body, 0);
      await page.keyboard.press(backward);
      await atBody();
      await page.keyboard.press(backward);
      await osr193Field(page, spoiler);
    }

    const after = await osr193Inspect(page, paths);
    expect(after.canonical).toBe(source);
    expect(after.stableIds).toEqual(before.stableIds);
    expect(after.state.stamp.revision).toBe('0');
    expect(after.events).toEqual([]);
    history(after, 0, 0);
    record.checkpoints.push({ label: 'captionless media body and following text remain intact', ...after });
  } finally {
    await osr193Cleanup(page);
  }
});

test('OSR-193 single-line field preserves admitted CR and LF labels', async ({ page, browser }) => {
  observations.get(page).browserVersion = browser.version();
  const original = JSON.parse(osr193Source());
  const labels = ['Фи\rнал', 'Под\nробнее'];
  original.content[0].attrs.label = labels[0];
  original.content[1].attrs.label = labels[1];
  const literal = canonicalizeRaw(JSON.stringify(original));
  try {
    await osr193Mount(page, osr193Routes[0].body, literal, osr193Routes, false);
    const wrappers = page.locator('#osr193-editor > section[data-editor-node]');
    for (const [index, route] of osr193Routes.entries()) {
      await expect(wrappers.nth(index)).toHaveAttribute('aria-label', labels[index]);
      const binding = await page.evaluate(index => window.osr193Mounted.bind(index), index);
      expect(binding).toMatchObject({ status: 'refused', name: 'TypeError' });
      const field = page.getByRole('textbox', { name: route.control, exact: true });
      await expect(field).toHaveValue('');
      await field.focus();
      await page.keyboard.press('!');
      await expect(field).toHaveValue('!');
    }
    const after = await osr193Inspect(page);
    expect(after.canonical).toBe(literal);
    expect(after.events).toEqual([]);
    expect(after.state.stamp.revision).toBe('0');
    observations.get(page).checkpoints.push({ label: 'admitted CR/LF and no published write', ...after });
  } finally {
    await osr193Cleanup(page);
  }

  try {
    const spoiler = osr193Routes[0];
    await osr193Mount(page, spoiler.body);
    await page.keyboard.press('Shift+Tab');
    await osr193Field(page, spoiler);
    const field = page.getByRole('textbox', { name: spoiler.control, exact: true });
    const changed = await page.evaluate(label => window.osr193Mounted.setLabel(0, label), labels[0]);
    expect(changed.effect).toBe('changed');
    await expect(page.locator('#osr193-editor > section[data-editor-node]').first()).toHaveAttribute('aria-label', labels[0]);
    await expect(field).toHaveValue('Финал');
    await page.keyboard.press('!');
    await expect(field).toHaveValue('Финал!');
    const expected = JSON.parse(osr193Source());
    expected.content[0].attrs.label = labels[0];
    const after = await osr193Inspect(page);
    expect(after.canonical).toBe(canonicalizeRaw(JSON.stringify(expected)));
    expect(after.events).toHaveLength(1);
    expect(after.state.stamp.revision).toBe('1');
    observations.get(page).checkpoints.push({ label: 'multiline label preserved through external field retirement', ...after });
  } finally {
    await osr193Cleanup(page);
  }
});

test('OSR-193 replacement retires label inputs before the next interaction', async ({ page, browser }) => {
  observations.get(page).browserVersion = browser.version();
  const source = osr193Source();
  try {
    await osr193Mount(page, osr193Routes[0].body);
    const before = await osr193Inspect(page);
    const replaced = await page.evaluate(source => window.osr193Mounted.replace(source), source);
    expect(replaced).toMatchObject({ status: 'completed', response: { status: 'ok', value: { effect: 'remounted' } } });
    const after = await osr193Inspect(page);
    expect(after.canonical).toBe(before.canonical);
    expect(after.events).toEqual([]);
    expect(after.state.stamp.generation).not.toBe(before.state.stamp.generation);
    expect(after.stableIds).not.toEqual(before.stableIds);
    for (const index of osr193Routes.keys()) {
      expect(await page.evaluate(index => window.osr193Mounted.bind(index), index)).toEqual({ status: 'bound' });
    }
    observations.get(page).checkpoints.push({ label: 'old generation fields can be rebound without a key', ...after });
  } finally {
    await osr193Cleanup(page);
  }
});

test('trusted delete keys remove selected text inside a profile container body', async ({ page }) => {
  for (const [key, type, attrs] of [
    ['Backspace', 'warning', { kind: 'content', label: 'Темы' }],
    ['Delete', 'spoiler', { label: 'Финал' }],
  ]) {
    const documentWithText = text => osr187Bytes([
      { type, attrs, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    ]);
    const source = documentWithText('abc');
    const { id, ready, diagnostic } = await call(page, 'mount', { source });
    expect(ready, JSON.stringify(diagnostic)).toBe('ready');
    try {
      await call(page, 'select', id, '/0/0/0', 2, '/0/0/0', 1);
      const before = await checkpoint(page, id, key + ' selected text within ' + type);
      const wrapper = stateRow(before, '/0');
      const host = page.locator(`#${id}`);
      await host.evaluate(element => {
        element.addEventListener('beforeinput', event => {
          element.bodyDeleteTrace = { trusted: event.isTrusted, prevented: event.defaultPrevented };
        }, { once: true });
      });
      await page.keyboard.press(key);
      expect(await host.evaluate(element => element.bodyDeleteTrace)).toEqual({ trusted: true, prevented: true });
      const after = await checkpoint(page, id, key + ' removed selected text');
      expect(after.canonical).toBe(documentWithText('ac'));
      expect(stateRow(after, '/0')).toMatchObject({
        id: wrapper.id, attributes: wrapper.attributes, children: wrapper.children,
      });
      history(after, 1, 0);
      expect(after.failures).toEqual([]);
      expect((await call(page, 'history', id, 'undo')).response.status).toBe('ok');
      const undone = await checkpoint(page, id, key + ' Undo restores the profile body');
      expect(undone.canonical).toBe(source);
      expect(stateRow(undone, '/0').id).toBe(wrapper.id);
      expect(undone.state.selection).toEqual(before.state.selection);
    } finally {
      await call(page, 'dispose', id);
    }
  }
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

test.describe('OSR-209 mounted table cell edits', () => {
  test.skip(({ browserName }) => browserName === 'firefox', 'OSR-209 requires Chromium and WebKit');
  const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  const fixture = read('./fixtures/osr-209-table-cell-edits.json');
  const retained = read('../contracts/kwdj/v1/fixtures/positive.json').fixtures.flatMap(f => f.cases)
    .find(row => row.name === fixture.source).kwdj;
  const path = '/' + fixture.leaf.join('/');
  const tableIds = point => point.rows.map(row => [row.path, row.node.id]);

  for (const row of fixture.cases) test(row.id, async ({ page }) => {
    const document = structuredClone(retained);
    const paragraph = fixture.leaf.slice(0, -1).reduce((value, index) => value.content[index], document);
    paragraph.content[0].text = fixture.initial_text;
    const source = canonicalizeRaw(JSON.stringify(document));
    const mounted = await call(page, 'mount', { source });
    expect(mounted.ready, JSON.stringify(mounted.diagnostic)).toBe('ready');
    const { id } = mounted;
    const host = page.locator('#' + id);
    await call(page, 'select', id, path, row.range[0], path, row.range[1]);
    await expect(host).toBeFocused();
    const before = await checkpoint(page, id, 'before ' + row.id);
    expect(before.canonical).toBe(source);
    expect(before.actualSelection).toMatchObject({inside:true,anchorOffset:row.range[0],focusOffset:row.range[1]});
    await traceLargeInput(host);
    await host.evaluate(element => {
      element.tableKeys = [];
      element.addEventListener('keydown', event => {
        element.tableKeys.push({key:event.key,trusted:event.isTrusted});
      });
    });
    if (row.key) {
      await page.keyboard.press(row.key);
      expect(await host.evaluate(element => element.tableKeys)).toContainEqual({key:row.key,trusted:true});
    } else {
      await page.keyboard.insertText(row.payload.text);
    }
    await expect(host.locator('table tr')).toHaveCount(3);
    await expect(host.locator('th[colspan="2"]')).toHaveText('AB');
    await expect(host.locator('td[rowspan="2"]')).toHaveText('A');
    await expect(host.locator('td').last()).toHaveText('B2');

    if (row.diagnostic) {
      const after = await checkpoint(page, id, 'border ' + row.id);
      expect(after.state).toEqual(before.state);
      expect(after.canonical).toBe(source);
      expect(tableIds(after)).toEqual(tableIds(before));
      expect(docEvents(after)).toHaveLength(0);
      const inputs = await host.evaluate(element => element.largeEvents);
      for (const input of inputs.filter(event => event.type === 'beforeinput')) {
        expect(input).toMatchObject({inputType:row.input_type,trusted:true,prevented:true});
      }
      return;
    }

    paragraph.content[0].text = row.text;
    const expected = canonicalizeRaw(JSON.stringify(document));
    await expect.poll(() => call(page, 'snapshot', id)).toBe(expected);
    const after = await checkpoint(page, id, 'after ' + row.id);
    expect(after.failures).toEqual([]);
    expect(after.state.stamp.revision).toBe('1');
    expect(docEvents(after)).toHaveLength(1);
    history(after, 1, 0);
    expect(tableIds(after)).toEqual(tableIds(before));
    caret(after, stateRow(before, path).id, row.caret);
    expect(after.actualSelection).toMatchObject({inside:true,anchorOffset:row.caret,focusOffset:row.caret});
    const events = await host.evaluate(element => element.largeEvents);
    const beforeInputs = events.filter(event => event.type === 'beforeinput');
    const inputType = row.payload.kind === 'delete_selection'
      ? expect.stringMatching(/^deleteContent(Backward|Forward)$/)
      : row.input_type;
    expect(beforeInputs).toEqual([
      expect.objectContaining({inputType,trusted:true,prevented:true,data:row.payload.text ?? null}),
    ]);

    await page.keyboard.press('ControlOrMeta+KeyZ');
    await expect.poll(() => call(page, 'snapshot', id)).toBe(source);
    const undone = await checkpoint(page, id, 'undo ' + row.id);
    expect(undone.state.selection).toEqual(before.state.selection);
    expect(tableIds(undone)).toEqual(tableIds(before));
    history(undone, 0, 1);
    expect(docEvents(undone)).toHaveLength(2);
  });

  test('an owned warning rendered as td cannot dispatch forward Delete for a table', async ({ page }) => {
    const poetry = read('./fixtures/osr-196-verse-boundary-deletion.json');
    const row = poetry.cases.find(item => item.id === 'nested_near_heading_end_delete');
    const source = canonicalizeRaw(JSON.stringify(poetry.documents[row.input]));
    const mounted = await page.evaluate(async ({ source, point }) => {
      const {loadSdkV2,sdkBuildId} = await import('/packages/sdk/index.js');
      const {mountEditor,defineRendererCatalog} = await import('/packages/dom/index.js');
      const {kwdjBasicRenderers} = await import('/packages/kwdj/dom.js');
      const packet = await fetch('/extensions-packet.json').then(response => response.json());
      const wasm = await loadSdkV2();
      const host = document.createElement('div');
      host.setAttribute('aria-label','Custom warning renderer');
      document.getElementById('mounts').append(host);
      const base = kwdjBasicRenderers.definition, warning = 'org.klenwriter.kwdj/warning';
      const renderers = defineRendererCatalog({...base,nodes:{
        ...base.nodes,[warning]:{...base.nodes[warning],present:()=>({tag:'td'})},
      }});
      const failures = [], documents = [], input = [];
      const editor = mountEditor({element:host,renderers,onRefusal:failure=>failures.push(failure.diagnostic.code),
        editor:{input:new TextEncoder().encode(source),loader:async()=>wasm,options:{
          abi:'editor-sdk/2',build_id:sdkBuildId,profile:packet.kwdjProfile,admission:'validate',access:'editable',
          registry_json:packet.kwdjRegistryJson,profile_options_json:'{"identities":{"media":[],"references":[]},"limits":null}',
        }}});
      window.osr209Custom = {close(){editor.destroy();host.remove();delete window.osr209Custom;}};
      const ready = await editor.ready;
      if (ready.status !== 'ready') return {ready:ready.status,diagnostic:ready.diagnostic};
      editor.subscribe(event=>{if(event.change.kind==='document') documents.push(event);});
      const accepted = reply => {
        if (reply.status !== 'ok') throw Error(JSON.stringify(reply));
        return reply.value;
      };
      const state = () => accepted(editor.read({kind:'state'})).state;
      const node = id => accepted(editor.read({kind:'node',stamp:editor.capture(),node:id})).node;
      const target = node(point.path.reduce((id,index)=>node(id).children[index],state().root));
      const caret = {kind:'text',node:target.primitive==='text'?target.id:target.children[0],offset:point.offset,affinity:'after'};
      host.focus();
      const selected = editor.submit({kind:'set_selection',stamp:editor.capture(),selection:{anchor:caret,focus:caret}});
      host.addEventListener('beforeinput',event=>input.push({inputType:event.inputType,trusted:event.isTrusted,prevented:event.defaultPrevented}));
      window.osr209Custom.read = () => {
        const saved = accepted(editor.submit({kind:'snapshot',stamp:editor.capture(),max_bytes:8192}).response);
        accepted(editor.submit({kind:'release_snapshot',handle:saved.handle}).response);
        return {canonical:saved.canonical_json,state:state(),children:node(state().root).children,text:host.textContent,input,failures,documents};
      };
      return {ready:ready.status,selected:selected.response.status,role:node(node(state().root).children[0]).type_id,
        cell:host.querySelector('td')?.localName,table:!!host.querySelector('table')};
    },{source,point:row.selection.focus});
    try {
      expect(mounted).toEqual({ready:'ready',selected:'ok',role:'org.klenwriter.kwdj/warning',cell:'td',table:false});
      const before = await page.evaluate(()=>window.osr209Custom.read());
      expect(before.canonical).toBe(source);
      await page.keyboard.press('Delete');
      const after = await page.evaluate(()=>window.osr209Custom.read());
      observations.get(page).checkpoints.push({label:'custom warning before Delete',...before},{label:'custom warning after Delete',...after});
      expect(after.input).toEqual([{inputType:'deleteContentForward',trusted:true,prevented:true}]);
      expect(after.canonical).toBe(source);
      expect(after.state).toEqual(before.state);
      expect(after.children).toEqual(before.children);
      expect(after.text).toBe(before.text);
      expect(after.documents).toEqual([]);
      expect(after.failures).toEqual(['dom.command_unsupported']);
    } finally {await page.evaluate(()=>window.osr209Custom.close());}
  });
});

test.describe('OSR-199 mounted poetry', () => {
  test.skip(({ browserName }) => browserName === 'firefox', 'Firefox poetry acceptance is tracked by OSR-201');

  const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  const canonical = document => canonicalizeRaw(JSON.stringify(document));
  const corpus = json('../contracts/kwdj/v1/fixtures/positive.json').fixtures;
  const retained = id => corpus.find(fixture => fixture.id === id).cases[0];
  const doc019 = retained('DOC-019');
  const doc020 = retained('DOC-020');
  const doc027 = retained('DOC-027');
  const split = json('./fixtures/osr-194-verse-keys.json');
  const middle = key => split.cases.find(row => row.key === key && row.position === 'middle');
  const empty = json('./fixtures/osr-195-empty-verse-and-stanzas.json').keys
    .find(row => row.id === 'terminal_blank_after_line');
  const deletion = json('./fixtures/osr-196-verse-boundary-deletion.json');
  const stanza = deletion.cases.find(row => row.id === 'stanza_right_backspace');
  const clipboard = json('./fixtures/osr-197-poetry-clipboard.json');
  const partial = clipboard.cases.find(row => row.id === 'open_verse_edges_into_closed_gap_refuse').capture;
  const path = indices => '/' + indices.join('/');

  const inserted = structuredClone(doc020.kwdj);
  inserted.content[0].content[0].content[0].text = 'Сильная! строка';
  const mixed = structuredClone(doc027.kwdj);
  mixed.content[2].content.splice(1, 1);
  const edits = [
    {
      name: 'DOC-020 trusted insertion retains poetry marks',
      input: doc020.kwdj, expected: inserted,
      from: ['/0/0/0', 7], to: ['/0/0/0', 8, 'text'],
      inputType: 'insertText', text: '!',
    },
    {
      name: 'DOC-019 middle Enter matches OSR-194',
      input: split.input, expected: middle('Enter').expected,
      from: ['/0/0/0', middle('Enter').offset], to: ['/0/1/0', middle('Enter').caret.offset, 'text'],
      key: 'Enter', inputType: 'insertParagraph',
    },
    {
      name: 'DOC-019 Shift+Enter writes the OSR-194 hard break',
      input: split.input, expected: middle('Shift+Enter').expected,
      from: ['/0/0/0', middle('Shift+Enter').offset], to: ['/0/0/1', 'after', 'edge'],
      key: 'Shift+Enter', inputType: 'insertLineBreak',
    },
    {
      name: 'DOC-019 empty-line Enter matches OSR-195',
      input: empty.input, expected: empty.expected,
      from: [path(empty.enter_at), 0], to: [path(empty.caret.path), empty.caret.offset, 'child'],
      key: 'Enter', inputType: 'insertParagraph',
    },
    {
      name: 'DOC-019 stanza Backspace matches OSR-196',
      input: deletion.documents[stanza.input], expected: deletion.documents[stanza.expected],
      from: [path([...stanza.selection.anchor.path, 0]), stanza.selection.anchor.offset],
      to: [path(stanza.expected_selection.anchor.path), 0, 'child'],
      key: 'Backspace', inputType: 'deleteContentBackward',
    },
    {
      name: 'DOC-027 stanza Backspace preserves mixed poetry block order',
      input: doc027.kwdj, expected: mixed, mediaIds: doc027.input.identity_state.existing_media_ids,
      from: ['/2/2/0', 0], to: ['/2/1', 0, 'child'],
      key: 'Backspace', inputType: 'deleteContentBackward',
    },
  ];

  for (const row of edits) test(row.name, async ({ page }) => {
    const source = canonical(row.input);
    const mounted = await call(page, 'mount', { source, mediaIds: row.mediaIds ?? [] });
    expect(mounted.ready, JSON.stringify(mounted.diagnostic)).toBe('ready');
    const { id } = mounted;
    const host = page.locator('#' + id);
    await call(page, 'select', id, ...row.from);
    await expect(host).toBeFocused();
    expect((await checkpoint(page, id, 'before ' + row.name)).canonical).toBe(source);
    await traceLargeInput(host);
    const shifted = row.key === 'Shift+Enter';
    if (shifted) await host.evaluate(element => {
      element.poetryShift = [];
      element.addEventListener('keydown', event => {
        if (event.key === 'Enter') element.poetryShift.push({ shift: event.shiftKey, trusted: event.isTrusted });
      });
    });
    if (row.key) await page.keyboard.press(row.key);
    else await page.keyboard.insertText(row.text);

    await expect.poll(() => call(page, 'snapshot', id)).toBe(canonical(row.expected));
    const after = await checkpoint(page, id, 'after ' + row.name);
    expect(after.failures).toEqual([]);
    expect(after.state.stamp.revision).toBe('1');
    expect(docEvents(after)).toHaveLength(1);
    history(after, 1, 0);
    const [target, offset, kind] = row.to;
    const node = stateRow(after, target).id;
    if (kind === 'edge') {
      const point = { kind, node, side: offset };
      expect(after.state.selection).toEqual({ anchor: point, focus: point });
    } else {
      caret(after, node, offset, kind);
    }
    expect(after.actualSelection).toMatchObject({ inside: true });
    const inputTypes = shifted ? ['insertLineBreak', 'insertParagraph'] : [row.inputType];
    const events = await host.evaluate(element => element.largeEvents);
    const input = events.find(event => event.type === 'beforeinput' && inputTypes.includes(event.inputType));
    expect(input).toMatchObject({ type: 'beforeinput', data: row.text ?? null, trusted: true, prevented: true });
    if (shifted) {
      const key = await host.evaluate(element => element.poetryShift);
      expect(key).toEqual([{ shift: true, trusted: true }]);
      observations.get(page).poetryShiftEnter = { key, input };
    }
  });

  const copies = [
    {
      name: 'DOC-019 copy matches the full-text projection',
      input: doc019.kwdj, anchor: ['/0/0/0', 0], focus: ['/0/3/0', 8],
      text: doc019.expected.full_text,
    },
    {
      name: 'OSR-197 partial reverse copy preserves three line feeds across the stanza',
      input: clipboard.documents[partial.document],
      anchor: [path(partial.focus.path), partial.focus.offset],
      focus: [path(partial.anchor.path), partial.anchor.offset],
      text: 'Строка 1\n\n\nСтр',
    },
  ];
  for (const row of copies) test(row.name, async ({ page }) => {
    const source = canonical(row.input);
    const mounted = await call(page, 'mount', { source, observeClipboard: true });
    expect(mounted.ready, JSON.stringify(mounted.diagnostic)).toBe('ready');
    const { id } = mounted, host = page.locator('#' + id);
    const initial = await checkpoint(page, id, 'before cross-line selection');
    await host.focus();
    const actual = await page.evaluate(({ id, anchor, focus }) => {
      const a = window.domHost.leaf(id, anchor[0]), f = window.domHost.leaf(id, focus[0]);
      const selection = document.getSelection();
      selection.setBaseAndExtent(a, anchor[1], f, focus[1]);
      return selection.anchorNode === a && selection.focusNode === f
        && selection.anchorOffset === anchor[1] && selection.focusOffset === focus[1];
    }, { id, anchor: row.anchor, focus: row.focus });
    expect(actual).toBe(true);
    const point = ([leaf, offset]) => ({ kind: 'text', node: stateRow(initial, leaf).id, offset, affinity: 'after' });
    const selection = { anchor: point(row.anchor), focus: point(row.focus) };
    await expect.poll(async () => (await call(page, 'read', id, { kind: 'state' })).value.state.selection).toEqual(selection);
    const before = await checkpoint(page, id, 'before trusted copy');
    const projection = await call(page, 'read', id, { kind: 'selection_text', max_bytes: 8192 });
    await traceLargeInput(host);
    await page.keyboard.press('ControlOrMeta+KeyC');
    const observed = () => call(page, 'clipboardObservations', id);
    await expect.poll(async () => (await observed()).results.length).toBe(1);
    expect(projection).toMatchObject({ status: 'ok', value: { kind: 'selection_text', text: row.text, selection } });
    expect(await observed()).toEqual({
      writes: [row.text],
      results: [{ action: 'copy', status: 'copied', clipboard: 'confirmed', failure: null, submission: null }],
    });
    expect(await host.evaluate(element => element.largeEvents)).toEqual([
      { type: 'copy', inputType: null, data: null, trusted: true, prevented: true },
    ]);
    const after = await checkpoint(page, id, 'after trusted copy');
    expect(after.canonical).toBe(source);
    expect(after.state).toEqual(before.state);
    expect(docEvents(after)).toEqual([]);
  });
});

test.describe('OSR-201 mounted poetry accessibility', () => {
  test.skip(
    ({ browserName }) => browserName === 'firefox' && process.env.KWE_OSR201_FIREFOX !== '1',
    'Experimental Firefox observation runs separately with KWE_OSR201_FIREFOX=1',
  );
  const corpus = JSON.parse(readFileSync(
    new URL('../contracts/kwdj/v1/fixtures/positive.json', import.meta.url), 'utf8',
  )).fixtures;
  for (const caseId of ['DOC-019', 'DOC-020', 'DOC-027']) test(`${caseId} has zero axe violations and a reachable verse caret`, async ({ page, browser, browserName }) => {
    const evidence = { caseId, browserVersion: browser.version(), experimental: browserName === 'firefox', focus: [] };
    observations.get(page).poetryAccessibility = evidence;
    const fixture = corpus.find(row => row.id === caseId).cases[0];
    const source = canonicalizeRaw(JSON.stringify(fixture.kwdj));
    evidence.canonicalSha256 = createHash('sha256').update(source).digest('hex');
    const mounted = await call(page, 'mount', {
      source, mediaIds: fixture.input.identity_state?.existing_media_ids ?? [],
    });
    evidence.mount = { ready: mounted.ready, diagnostic: mounted.diagnostic };
    expect(mounted.ready, JSON.stringify(mounted.diagnostic)).toBe('ready');
    const { id } = mounted, host = page.locator('#' + id);
    await expect(host).toHaveRole('textbox');
    await expect(host).toHaveAccessibleName('KlenWriter editor example 1');
    await expect(host).toHaveAttribute('contenteditable', 'true');
    await expect(host).toHaveAttribute('aria-multiline', 'true');

    const axe = await new AxeBuilder({ page }).include('#' + id).analyze();
    evidence.axe = { engine: axe.testEngine, violations: axe.violations, incomplete: axe.incomplete,
      passedRules: axe.passes.map(rule => rule.id) };
    expect(axe.violations).toEqual([]);
    expect(axe.passes.length).toBeGreaterThan(0);

    const beforeLabel = 'Before the verse editor', afterLabel = 'After the verse editor';
    await host.evaluate((element, { beforeLabel, afterLabel }) => {
      for (const [label, side] of [[beforeLabel, 'before'], [afterLabel, 'after']]) {
        const input = document.createElement('input');
        input.type = 'text';
        input.setAttribute('aria-label', label);
        element[side](input);
      }
    }, { beforeLabel, afterLabel });
    const beforeField = page.getByRole('textbox', { name: beforeLabel, exact: true });
    const afterField = page.getByRole('textbox', { name: afterLabel, exact: true });

    // Only setup chooses focus and a caret. Keyboard input takes it from here.
    const path = '/0/0/0', offset = 1;
    await call(page, 'select', id, path, offset);
    await expect(host).toBeFocused();
    const initial = await checkpoint(page, id, 'OSR-201 initial verse caret');
    expect(initial.canonical).toBe(source);
    expect(stateRow(initial, '/0').type_id).toBe('org.klenwriter.kwdj/verse');
    expect(stateRow(initial, '/0/0').type_id).toBe('org.klenwriter.kwdj/verse_line');
    caret(initial, stateRow(initial, path).id, offset);
    const keys = await page.evaluateHandle(() => {
      const events = [];
      document.addEventListener('keydown', event => {
        if (event.key === 'Tab') events.push({ key: event.key, trusted: event.isTrusted, shift: event.shiftKey });
      }, true);
      return events;
    });
    const press = async key => {
      await page.keyboard.press(key);
      const active = await page.evaluate(() => ({
        id: document.activeElement?.id,
        name: document.activeElement?.getAttribute('aria-label'),
        href: document.activeElement?.getAttribute('href'),
      }));
      evidence.focus.push({ key, active });
      evidence.keys = await keys.jsonValue();
    };

    await press('Shift+Tab');
    await expect(beforeField).toBeFocused();
    await press('Tab');
    await expect(host).toBeFocused();
    await expect.poll(() => call(page, 'nativeSelectionMatches', id, path, offset)).toBe(true);
    const entered = await checkpoint(page, id, 'OSR-201 Tab restored the verse caret');
    expect(entered.actualSelection).toMatchObject({ inside: true, anchorOffset: offset, focusOffset: offset });
    expect(entered.state).toEqual(initial.state);

    await press('Tab');
    if (caseId === 'DOC-020' && evidence.focus.at(-1).active.href === '/works/example') {
      // Browser keyboard settings can include the existing verse link in Tab order.
      await expect(host.getByRole('link', { name: 'Ссылка' })).toBeFocused();
      await press('Tab');
    }
    await expect(afterField).toBeFocused();
    expect(evidence.keys).toEqual(evidence.focus.map(({ key }) => ({
      key: 'Tab', trusted: true, shift: key === 'Shift+Tab',
    })));
    await keys.dispose();

    const exited = await checkpoint(page, id, 'OSR-201 Tab reached the following host control');
    expect(exited.canonical).toBe(source);
    expect(exited.state).toEqual(initial.state);
    expect(docEvents(exited)).toEqual([]);
    expect(exited.failures).toEqual([]);
    history(exited, 0, 0);
  });
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
  const fragment = content => JSON.stringify({
    format_id: 'org.klenwriter.kwdj/clipboard-fragment/1', mode: 'prose',
    source_profile: { profile_id: 'org.klenwriter.kwdj', profile_version: '1.0.0', codec_id: 'org.klenwriter.kwdj/json', wire_version: 1 },
    kind: 'blocks', content, open_start: false, open_end: false,
  });
  const literary = JSON.parse(literaryFixture().canonical).content[0];
  const warning = JSON.parse(warningFixture().canonical).content[0];
  const [spoiler, disclosure] = spoilerDisclosureFixture().document.content;
  const requests=[
    ['unsupported-target',command('insert-block',{kind:'insert_block',target:{kind:'media'}}),'dom.command_unsupported'],
    ['native-only-media-fragment',command('insert-fragment',{kind:'insert_fragment',fragment_json:fragment([media])}),'dom.command_unsupported'],
    ['unavailable-mounted-literary-fragment',command('insert-fragment',{kind:'insert_fragment',fragment_json:fragment([literary])}),'dom.command_unsupported'],
    ['unavailable-mounted-warning-fragment',command('insert-fragment',{kind:'insert_fragment',fragment_json:fragment([warning])}),'dom.command_unsupported'],
    ['unavailable-mounted-spoiler-fragment',command('insert-fragment',{kind:'insert_fragment',fragment_json:fragment([spoiler])}),'dom.command_unsupported'],
    ['unavailable-mounted-disclosure-fragment',command('insert-fragment',{kind:'insert_fragment',fragment_json:fragment([disclosure])}),'dom.command_unsupported'],
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

test.describe('OSR-204 mounted table rendering', () => {
  test.skip(({ browserName }) => browserName === 'firefox', 'Table acceptance covers Chromium and WebKit');
  const load = name => JSON.parse(readFileSync(new URL(`../contracts/kwdj/v1/fixtures/${name}.json`, import.meta.url), 'utf8')).fixtures;
  const fixtures = [...load('positive'), ...load('mixed')];

  for (const [doc, name] of [
    ['DOC-010', 'rectangular_table'],
    ['DOC-011', 'table_spans_alignment'],
    ['DOC-012', 'valid_effective_grid'],
    ['DOC-011', 'pre_normalized_unit_spans_removed'],
  ]) test(`${doc}/${name}`, async ({ page }) => {
    const fixture = fixtures.find(row => row.id === doc).cases.find(row => row.name === name);
    expect(fixture.pipeline_stages).toContain('public_render');
    const source = canonicalizeRaw(JSON.stringify(fixture.kwdj));
    const mounted = await call(page, 'mount', { source, access: 'read_only' });
    expect(mounted.ready, JSON.stringify(mounted.diagnostic)).toBe('ready');
    const { id } = mounted;
    const point = await checkpoint(page, id, 'Mounted table');
    expect(point.canonical).toBe(source);
    expect(point.failures).toEqual([]);
    const table = page.locator('#' + id).getByRole('table');
    await expect(table).toHaveCount(1);
    const rows = fixture.kwdj.content[0].content;
    await expect(table.getByRole('row')).toHaveCount(rows.length);
    const rendered = await table.evaluate(element => ({
      tag: element.localName,
      rows: Array.from(element.rows, row => ({
        tag: row.localName,
        cells: Array.from(row.cells, cell => ({
          tag: cell.localName,
          text: cell.textContent,
          colspan: cell.getAttribute('colspan'),
          rowspan: cell.getAttribute('rowspan'),
          colSpan: cell.colSpan,
          rowSpan: cell.rowSpan,
        })),
      })),
    }));
    expect(rendered).toEqual({
      tag: 'table',
      rows: rows.map(row => ({
        tag: 'tr',
        cells: row.content.map(({ type, attrs, content }) => ({
          tag: type === 'table_header' ? 'th' : 'td',
          text: content[0].content[0].text,
          colspan: attrs?.colspan === undefined ? null : String(attrs.colspan),
          rowspan: attrs?.rowspan === undefined ? null : String(attrs.rowspan),
          colSpan: attrs?.colspan ?? 1,
          rowSpan: attrs?.rowspan ?? 1,
        })),
      })),
    });
    for (const [index, row] of rows.entries()) {
      const cells = table.getByRole('row').nth(index).locator(':scope > th, :scope > td');
      await expect(cells).toHaveCount(row.content.length);
      for (const [cellIndex, cell] of row.content.entries()) {
        if (cell.attrs?.align) {
          await expect(cells.nth(cellIndex)).toHaveClass('editor-align-' + cell.attrs.align);
          await expect(cells.nth(cellIndex)).toHaveCSS('text-align', cell.attrs.align);
        }
      }
    }
    const axe = await new AxeBuilder({ page }).include('#' + id).analyze();
    observations.get(page).tableAxeViolations = axe.violations;
    expect(axe.violations).toEqual([]);
  });
});
