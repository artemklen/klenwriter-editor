import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
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
  const p=await checkpoint(page,id,'engine-specific RU insertText');
  if(browserName==='firefox') {
    // Actual Playwright Firefox insertText uses composition. OSR-39 preserves
    // that unresolved region; exactly-once native settlement belongs to OSR-41.
    expect(trace.some(event=>event.type==='compositionstart')).toBe(true);expect(trace.some(event=>event.type==='compositionend')).toBe(true);
    expect(p.lifecycle).toBe('recoveryRequired');expect(p.state).toEqual(en.state);expect(p.canonical).toBe(en.canonical);expect(docEvents(p)).toHaveLength(2);
    expect(p.domText).toBe('А😀 e\u0301\u00a0ZAzяБета');expect(p.failures.some(failure=>failure.diagnostic.code==='dom.composition_conflict')).toBe(true);
    const disposed=await call(page,'dispose',id);observations.get(page).typingRecovery=disposed;
    expect(disposed.receipt.recovery.region).toMatchObject({kind:'bounded',originalText:'А😀 e\u0301\u00a0ZAz',provisionalText:'А😀 e\u0301\u00a0ZAzя'});expect(disposed.recoveries).toHaveLength(1);
  } else {
    expect(trace.some(event=>event.type==='compositionstart')).toBe(false);expect(p.lifecycle).toBe('ready');
    expect(stateRow(p,'/0/2').text).toBe('\u00a0ZAzя');expect(docEvents(p)).toHaveLength(3);caret(p,stateRow(p,'/0/2').id,5);expect(await call(page,'nativeSelectionMatches',id,'/0/2',5)).toBe(true);
  }
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
  const requests=[
    ['unsupported-target',command('insert-block',{kind:'insert_block',target:{kind:'media'}}),'dom.command_unsupported'],
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
