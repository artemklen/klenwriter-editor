// SPDX-License-Identifier: MIT OR Apache-2.0
import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {loadCompositionContract} from '../scripts/composition-contract-data.mjs';
const {dom,native,events,errata,pins}=loadCompositionContract();
const call=(page,method,...args)=>page.evaluate(({method,args})=>window.compositionHost[method](...args),{method,args});
const records=new WeakMap();
const point=(ids,p)=>p.kind==='text'?{kind:'text',node:ids[p.node],offset:p.offset,affinity:p.affinity}:p.kind==='child'?{kind:'child',parent:ids[p.parent],index:p.index,affinity:p.affinity}:{kind:'edge',node:ids[p.node],side:p.side};
const selection=(ids,s)=>s===null?null:{anchor:point(ids,s.anchor),focus:point(ids,s.focus)};
function state(actual,literal,ids){const expected=structuredClone(literal);expected.root=ids[literal.root];expected.selection=selection(ids,literal.selection);expected.stamp.session=actual.stamp.session;expected.stamp.generation=actual.stamp.generation;expected.history.retained_bytes=actual.history.retained_bytes;expect(actual.history.retained_bytes).toMatch(/^(0|[1-9][0-9]*)$/);expect(actual).toEqual(expected);}
function literalTree(actual,literal){expect(actual.nodeType).toBe(literal.nodeType);if(literal.nodeType===3){expect(actual.data).toBe(literal.data);return;}expect(actual.tag).toBe(literal.tag);for(const [k,v]of Object.entries(literal.attributes))expect(actual.attributes[k]).toBe(v);expect(actual.children).toHaveLength(literal.children.length);actual.children.forEach((x,i)=>literalTree(x,literal.children[i]));}
const docEvents=v=>v.events.filter(e=>e.change.kind==='document');
async function checkpoint(page,id,label){const v=await call(page,'inspect',id);records.get(page).checkpoints.push({label,value:v});return v;}
async function terminal(page,id){await expect.poll(async()=>{const v=await call(page,'inspect',id,false);return v.lifecycle==='recoveryRequired'||v.lifecycle==='fatal'||v.resources.dom.continuations===0&&(v.state.stamp.revision!=='0'||v.uaComposition.ends>0&&!v.uaComposition.open);},{timeout:3000}).toBe(true);}
function released(r){for(const k of ['listeners','observers','continuations','retainedInputBytes','retainedRecoveryRegions'])expect(r.resources.dom[k]).toBe(0);expect(r.resources.selection).toEqual({bookmarks:0,restoreTickets:0,activePointers:0,animationFrames:0});expect(r.resources.clipboard).toEqual({pending:0,continuations:0,retainedTextBytes:0});for(const k of ['sessions','listeners','queued_mutations','queued_bytes','pending_tickets','host_requests','task_continuations'])expect(r.resources.sdk[k]).toBe(0);}
test.beforeEach(async({page},info)=>{const r={engine:info.project.name,installedBrowser:false,scope:'Actual public mounted packaged SDK2/sealed WASM, CONTROLLED DOM mutations and synthetic composition events. Not real OS input.',errata,pins,errors:[],externalRequests:[],checkpoints:[]};records.set(page,r);page.on('pageerror',e=>r.errors.push(e.message));page.on('request',v=>{if(!v.url().startsWith('http://127.0.0.1:4174/'))r.externalRequests.push(v.url());});await page.addInitScript(()=>{window.compositionPolicy=[];window.compositionStartup=[];window.addEventListener('error',e=>window.compositionStartup.push(e.message));document.addEventListener('securitypolicyviolation',e=>window.compositionPolicy.push({directive:e.violatedDirective,blocked:e.blockedURI}));});const res=await page.goto('/composition');r.csp=res.headers()['content-security-policy'];expect(r.csp).toContain("default-src 'none'");expect(r.csp).not.toMatch(/'unsafe-inline'|'unsafe-eval'/);await page.waitForFunction(()=>window.compositionHostReady||window.compositionStartup.length,null,{timeout:15000});expect(await page.evaluate(()=>window.compositionStartup)).toEqual([]);r.metadata=await call(page,'metadata');expect(r.metadata.counts).toEqual({dom:18,native:30,event:40});});
test.afterEach(async({page},info)=>{const r=records.get(page);try{r.finish=await call(page,'allDisposed');for(const m of r.finish.mounts)released(m);expect(r.finish.native).toEqual({sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});r.policy=await page.evaluate(()=>window.compositionPolicy);expect(r.errors).toEqual([]);expect(r.externalRequests).toEqual([]);expect(r.policy).toEqual([]);}finally{r.status=info.status;mkdirSync('artifacts/composition',{recursive:true});const path=`artifacts/composition/${info.project.name}-${info.testId.replaceAll(/[^A-Za-z0-9_-]/g,'_')}.json`;writeFileSync(path,JSON.stringify(r,null,2)+'\n');await info.attach('composition-observations',{path,contentType:'application/json'});}});

for(const item of dom.cases.filter(c=>c.expected?.committedDom))test(`${item.id}: actual final delta, native identity/history and duplicate end`,async({page})=>{
  const n=native.cases.find(x=>x.id===item.nativeCase),mounted=await call(page,'mount',{caseId:item.id}),id=mounted.id,before=mounted.before;records.get(page).checkpoints.push({label:'post-setup baseline',value:before});expect(before.canonical).toBe(n.input.canonical_json);state(before.state,n.before_state,before.roles);
  await call(page,'start',id);await call(page,'mutate',id);const during=await checkpoint(page,id,'actual controlled provisional');expect(during.canonical).toBe(before.canonical);expect(docEvents(during)).toHaveLength(docEvents(before).length);expect(during.trace.filter(x=>x.kind==='dom-write'&&x.writer==='adapter'&&x.phase==='composing'&&x.insideWindow)).toEqual([]);
  for(const role of item.controlledObservation.protectedObjectsRequiredDuringUa)expect(during.objects[role]?.connected).toBe(true);
  if(item.id.startsWith('D02')){expect(during.objects.T_text.connected).toBe(false);expect(during.objects.T_outer.connected).toBe(true);}
  await call(page,'end',id,{data:item.controlledObservation.eventDataDiagnostic,duplicate:true});await terminal(page,id);const after=await checkpoint(page,id,'settled actual native');expect(after.canonical).toBe(n.after_canonical_json);state(after.state,n.after_state,before.roles);expect(docEvents(after).length-docEvents(before).length).toBe(1);expect(after.dom).toHaveLength(item.expected.committedDom.length);after.dom.forEach((x,i)=>literalTree(x,item.expected.committedDom[i]));
  for(const role of n.identity.retained_live)expect(after.rows.some(x=>x.node.id===before.roles[role])).toBe(true);for(const role of n.identity.retired_old)expect(after.rows.some(x=>x.node.id===before.roles[role])).toBe(false);
  for(const role of item.expected.outsideActualObjectsUnchanged){expect(after.objects[role].connected).toBe(true);expect(after.objects[role].attributes).toEqual(before.objects[role].attributes);expect(after.objects[role].text).toEqual(before.objects[role].text);}
  expect(after.rawDom.inside).toBe(true);for(const edge of ['anchor','focus']){const p=item.expected.finalDomSelection[edge];expect(after.rawDom[edge].path).toEqual(p.path);expect(after.rawDom[edge].nodeType).toBe(p.nodeType);expect(after.rawDom[edge].offset).toBe(p.offsetUtf16);}
  const original=after.state;await call(page,'trailing',id);await page.evaluate(()=>new Promise(requestAnimationFrame));const duplicate=await checkpoint(page,id,'unchanged trailing input deduplicated');expect(duplicate.state).toEqual(original);expect(docEvents(duplicate)).toEqual(docEvents(after));
  expect((await call(page,'history',id,'undo')).response.status).toBe('ok');const undone=await checkpoint(page,id,'native undo');expect(undone.canonical).toBe(n.undo.canonical_json);state(undone.state,n.undo.state,before.roles);expect(new Set(undone.rows.map(x=>x.node.id))).toEqual(new Set(before.rows.map(x=>x.node.id)));
  expect((await call(page,'history',id,'redo')).response.status).toBe('ok');const redone=await checkpoint(page,id,'native redo');expect(redone.canonical).toBe(n.redo.canonical_json);state(redone.state,n.redo.state,before.roles);
});
test('D10 complete unchanged cancel has zero native document/history',async({page})=>{const {id,before}=await call(page,'mount',{caseId:'D10-unchanged-complete-cancel'});await call(page,'start',id);await call(page,'mutate',id);await call(page,'end',id,{data:'misleading'});await terminal(page,id);const after=await checkpoint(page,id,'unchanged cancel');expect(after.canonical).toBe(before.canonical);expect(after.state.stamp.revision).toBe(before.state.stamp.revision);expect(after.state.history).toEqual(before.state.history);expect(after.state.dirty).toBe(before.state.dirty);expect(after.state.saved_revision).toBe(before.state.saved_revision);expect(after.state.selection).toEqual(before.state.selection);expect(after.dom).toEqual(before.dom);expect(after.rows.map(x=>({...x.node,stamp:null}))).toEqual(before.rows.map(x=>({...x.node,stamp:null})));expect(docEvents(after)).toEqual(docEvents(before));expect(after.resources.dom.continuations).toBe(0);expect(after.recovery).toBeNull();expect(after.lifecycle).toBe('ready');});
test('D11 actual Rust EGC Refused retains latest input before committed restoration',async({page})=>{const {id,before}=await call(page,'mount',{caseId:'D11-readable-scalar-EGC-refusal'});await call(page,'start',id);await call(page,'mutate',id);await call(page,'end',id,{data:'notZ'});await terminal(page,id);const after=await checkpoint(page,id,'actual native Refused');expect(after.lifecycle).toBe('recoveryRequired');expect(after.canonical).toBe(before.canonical);expect(after.state).toEqual(before.state);expect(after.recovery.composition.reason).toBe('native_refused');const expected=structuredClone(native.cases.find(x=>x.id==='P11-forward').execute_expected);expected.diagnostic.stamp=before.state.stamp;expect(after.recovery.composition.response).toEqual(expected);expect(after.recovery.composition.submission.status).toMatch(/^(completed|queued)$/);expect(after.recovery.provisionalText).toBe('Z\u0301x');expect(after.statusText).toContain(expected.diagnostic.code);await expect(page.locator('#composition-status')).toBeVisible();await expect(page.locator('#composition-status')).toContainText(expected.diagnostic.code);expect(after.dom).toHaveLength(1);after.dom.forEach((x,i)=>literalTree(x,dom.cases.find(x=>x.id.startsWith('D11')).expected.restoredAffectedCommittedDom[i]));});
for(const prefix of ['D12','D13','D14','D17'])test(`${prefix} incomplete structure/outside/bound preserves actual input without dispatch`,async({page})=>{const item=dom.cases.find(x=>x.id.startsWith(prefix)),{id,before}=await call(page,'mount',{caseId:item.id});await call(page,'start',id);await call(page,'mutate',id);await call(page,'end',id);await terminal(page,id);const after=await checkpoint(page,id,'lossless incomplete/stale refusal');expect(after.lifecycle).toBe('recoveryRequired');expect(after.canonical).toBe(before.canonical);expect(after.state.stamp.revision).toBe('0');expect(after.state.history.undo_entries).toBe('0');expect(after.recovery).not.toBeNull();expect(after.recovery.composition.reason).toBe(item.expected.recoveryReason);});
test('D15 copied attributes cannot grant cloned Text native ownership',async({page})=>{const {id,before}=await call(page,'mount',{caseId:'D15-UA-clone-not-owned-before-settlement'});await call(page,'start',id);await call(page,'mutate',id);expect((await call(page,'captureSelection',id)).status).toBe('dom_refused');await call(page,'end',id);await terminal(page,id);const after=await checkpoint(page,id,'clone ownership refused');expect(after.state.stamp.revision).toBe('0');expect(after.canonical).toBe(before.canonical);});
test('D16 outside native publication preserves active marked/BR objects and stales settlement',async({page})=>{const {id}=await call(page,'mount',{caseId:'D16-adapter-remount-is-functional-failure'});await call(page,'start',id);const result=await call(page,'outsideEdit',id);expect(result.edited.response.status).toBe('ok');const active=await checkpoint(page,id,'outside native edit while provisional');for(const role of ['P','T_outer','T_mark','T_text','BR','C_outer','C_mark','C_text'])expect(active.objects[role].connected).toBe(true);expect(active.trace.filter(x=>x.kind==='dom-write'&&x.writer==='adapter'&&x.phase==='composing'&&x.insideWindow)).toEqual([]);await call(page,'end',id);await terminal(page,id);const after=await checkpoint(page,id,'stale settlement retained');expect(after.lifecycle).toBe('recoveryRequired');expect(after.state.stamp.revision).toBe('1');expect(after.canonical).toContain('tXail');expect(after.recovery.composition.reason).toBe('stale');});
test('D18 destroy transfers intact over-limit actual DOM without clearing sole input',async({page})=>{const {id}=await call(page,'mount',{caseId:'D18-destroy-during-incomplete-capture'});await call(page,'start',id);await call(page,'mutate',id);const after=await checkpoint(page,id,'over-limit actual input before destroy');expect(after.objects.T_text.utf16Units).toBe(2097153);const destroyed=await call(page,'dispose',id);expect(destroyed.recovery.regionKind).toBe('retained_dom');expect(destroyed.retainedDomOwned).toBe(true);expect(destroyed.hostRecoveryOwners).toBeGreaterThan(0);expect(destroyed.retainedTextObjects.T_text).toEqual({utf16Units:2097153,insideRetainedDom:true});released(destroyed);});

// Additional frozen event-policy integration; the original 18 DOM literals stay
// unchanged. These events are synthetic and exercise real mounted/native owners.
async function policyCommitted(page,eventId,{reentry=false}={}){
  const row=events.rows.find(row=>row.id.startsWith(eventId+'-')),literal=native.cases.find(candidate=>candidate.id===row.nativeCase);
  const mounted=await call(page,'policyMount',eventId),{id,before}=mounted;records.get(page).checkpoints.push({label:eventId+' independent post-setup baseline',value:before});expect(mounted.policy).toEqual(row);expect(before.canonical).toBe(literal.input.canonical_json);state(before.state,literal.before_state,before.roles);
  if(reentry)await call(page,'policyReentry',id);await call(page,'start',id);await call(page,'policyPreedit',id);await call(page,'end',id,{data:'Q'});await terminal(page,id);
  const after=await checkpoint(page,id,eventId+' first native composition');expect(after.canonical).toBe(literal.after_canonical_json);state(after.state,literal.after_state,before.roles);expect(after.lifecycle).toBe('ready');expect(after.recovery).toBeNull();expect(docEvents(after).length-docEvents(before).length).toBe(1);expect(after.state.history.undo_entries).toBe('1');
  return {id,before,after,row,literal};
}
test('E23 controlled fresh Space delegates existing ordinary input once through real mounted owners',async({page})=>{
  const {id,before,after:composition,row,literal}=await policyCommitted(page,'E23'),gesture=await call(page,'policyGesture',id);expect(gesture.input).toEqual({defaultPrevented:true,isTrusted:false});expect(gesture.bubble).toEqual([{defaultPrevented:true,isTrusted:false,inputType:'insertText',data:' '}]);
  await terminal(page,id);const after=await checkpoint(page,id,'E23 ordinary Space actual native publication');
  // This exact output is from frozen E23 + the frozen P01 document shape. No
  // candidate canonical or production mapper supplies the expected value.
  const document=JSON.parse(literal.after_canonical_json);document.content[0].content[0].text=row.expected.nativeText;expect(after.canonical).toBe(JSON.stringify(document));expect(after.lifecycle).toBe('ready');expect(after.recovery).toBeNull();expect(docEvents(after).length-docEvents(before).length).toBe(row.expected.compositionDispatches+row.expected.ordinaryDispatches);expect(after.state.history.undo_entries).toBe(String(row.expected.nativeHistoryEntriesAdded));expect(after.state.history.redo_entries).toBe('0');expect(after.state.stamp.revision).toBe('2');expect(after.state.stamp.selection_epoch).toBe('3');expect(after.state.stamp.history_epoch).toBe('2');expect(after.state.selection).toEqual({anchor:{kind:'text',node:before.roles.T,offset:3,affinity:'after'},focus:{kind:'text',node:before.roles.T,offset:3,affinity:'after'}});expect(new Set(after.rows.map(row=>row.node.id))).toEqual(new Set(before.rows.map(row=>row.node.id)));for(const edge of ['anchor','focus']){expect(after.rawDom[edge].path).toEqual([0,0,0]);expect(after.rawDom[edge].nodeType).toBe(3);expect(after.rawDom[edge].offset).toBe(3);}
  expect((await call(page,'history',id,'undo')).response.status).toBe('ok');const first=await checkpoint(page,id,'E23 first undo removes only ordinary Space');expect(first.canonical).toBe(literal.after_canonical_json);expect(first.state.selection).toEqual(composition.state.selection);expect(first.state.history.undo_entries).toBe('1');expect(first.state.history.redo_entries).toBe('1');
  expect((await call(page,'history',id,'undo')).response.status).toBe('ok');const second=await checkpoint(page,id,'E23 second undo restores original directed range and IDs');expect(second.canonical).toBe(literal.input.canonical_json);expect(second.state.selection).toEqual(selection(before.roles,literal.input.selection));expect(second.state.history.undo_entries).toBe('0');expect(second.state.history.redo_entries).toBe('2');expect(new Set(second.rows.map(row=>row.node.id))).toEqual(new Set(before.rows.map(row=>row.node.id)));
});
test('E22 controlled early Space before keydown stays unapplied and never gains a retrospective permit',async({page})=>{
  const {id,before,after:accepted,row,literal}=await policyCommitted(page,'E22'),gesture=await call(page,'policyGesture',id);expect(gesture.input).toEqual({defaultPrevented:true,isTrusted:false});expect(gesture.bubble).toEqual([{defaultPrevented:true,isTrusted:false,inputType:'insertText',data:' '}]);await terminal(page,id);const after=await checkpoint(page,id,'E22 early Space retained after later synthetic down/up');expect(after.lifecycle).toBe('recoveryRequired');expect(after.canonical).toBe(literal.after_canonical_json);expect(after.state).toEqual(accepted.state);expect(docEvents(after)).toEqual(docEvents(accepted));expect(docEvents(after).length-docEvents(before).length).toBe(row.expected.compositionDispatches);expect(after.recovery.composition.reason).toBe(row.expected.recoveryReason);expect(after.recovery.composition.unappliedInput).toMatchObject({kind:'bounded',source:'beforeinput',inputType:'insertText',data:row.expected.unappliedInputData});expect(after.dom).toEqual(accepted.dom);expect(after.state.history.undo_entries).toBe('1');expect(after.state.history.redo_entries).toBe('0');
});
test('E17 controlled public publication reentry refuses barrier before invalidating the composition claim',async({page})=>{
  const {id,before,after,literal}=await policyCommitted(page,'E17',{reentry:true});expect(after.policyReentries).toHaveLength(1);expect(after.policyReentries[0].response).toMatchObject({status:'dom_refused',diagnostic:{code:'dom.busy',publication:'none'}});expect(after.events.filter(row=>row.change.kind==='document').length-docEvents(before).length).toBe(1);expect(after.canonical).toBe(literal.after_canonical_json);expect(after.recovery).toBeNull();expect(after.lifecycle).toBe('ready');const stable=await checkpoint(page,id,'E17 reentrant end/input/end settled without another unit');expect(stable.state).toEqual(after.state);expect(docEvents(stable)).toEqual(docEvents(after));expect(stable.policyReentries).toEqual(after.policyReentries);
});

test('attribute-free direct unmarked suffix preserves frozen P16 scene replacement semantics',async({page})=>{
  const item=dom.cases.find(c=>c.id==='D08-selected-scene-forward'),literal=native.cases.find(c=>c.id==='P16-forward');
  const {id,before}=await call(page,'mount',{caseId:item.id,nativeCase:literal.id});
  records.get(page).checkpoints.push({label:'P16 independent scene baseline',value:before});expect(before.canonical).toBe(literal.input.canonical_json);state(before.state,literal.before_state,before.roles);
  await call(page,'start',id);const mutation=await call(page,'wrapperPreedit',id,'direct-unmarked-suffix');expect(mutation.variant).toBe('direct-unmarked-suffix');
  const during=await checkpoint(page,id,'controlled original SPAN a-é plus direct unmarked d');
  expect(during.canonical).toBe(before.canonical);expect(during.state).toEqual(before.state);expect(docEvents(during)).toEqual(docEvents(before));
  expect(during.dom).toHaveLength(2);expect(during.dom[0].children).toHaveLength(2);expect(during.dom[0].children[0].tag).toBe('span');expect(during.dom[0].children[0].children[0].data).toBe('a\u00e9');expect(during.dom[0].children[1]).toEqual({nodeType:3,data:'d',utf16Units:1});
  expect(during.objects.P1.connected).toBe(true);expect(during.objects.L_outer.connected).toBe(true);expect(during.objects.L_text.connected).toBe(true);expect(during.objects.S.connected).toBe(false);expect(during.objects.P2.connected).toBe(false);
  for(const role of ['H','O_outer','O_text']){expect(during.objects[role].connected).toBe(true);expect(during.objects[role].attributes).toEqual(before.objects[role].attributes);expect(during.objects[role].text).toEqual(before.objects[role].text);}
  expect(during.trace.filter(x=>x.kind==='dom-write'&&x.writer==='adapter'&&x.phase==='composing'&&x.insideWindow)).toEqual([]);
  await call(page,'end',id,{data:'not the replacement',duplicate:true});await terminal(page,id);const after=await checkpoint(page,id,'P16 direct suffix settled through actual Rust');
  expect(after.lifecycle).toBe('ready');expect(after.recovery).toBeNull();expect(after.canonical).toBe(literal.after_canonical_json);state(after.state,literal.after_state,before.roles);expect(docEvents(after).length-docEvents(before).length).toBe(1);
  for(const role of literal.identity.retained_live)expect(after.rows.some(row=>row.node.id===before.roles[role])).toBe(true);for(const role of literal.identity.retired_old)expect(after.rows.some(row=>row.node.id===before.roles[role])).toBe(false);
  const expectedDom=structuredClone(item.expected.committedDom);expectedDom[0].children[0].children[0].data=JSON.parse(literal.after_canonical_json).content[0].content[0].text;
  expect(after.dom).toHaveLength(expectedDom.length);after.dom.forEach((node,i)=>literalTree(node,expectedDom[i]));
  for(const edge of ['anchor','focus']){expect(after.rawDom[edge].path).toEqual(item.expected.finalDomSelection[edge].path);expect(after.rawDom[edge].nodeType).toBe(3);expect(after.rawDom[edge].offset).toBe(2);}
  for(const role of ['H','O_outer','O_text']){expect(after.objects[role].connected).toBe(true);expect(after.objects[role].attributes).toEqual(before.objects[role].attributes);expect(after.objects[role].text).toEqual(before.objects[role].text);}
  await call(page,'trailing',id);await page.evaluate(()=>new Promise(requestAnimationFrame));const duplicate=await checkpoint(page,id,'P16 direct suffix duplicate deduplicated');expect(duplicate.state).toEqual(after.state);expect(docEvents(duplicate)).toEqual(docEvents(after));
  expect((await call(page,'history',id,'undo')).response.status).toBe('ok');const undone=await checkpoint(page,id,'P16 undo restores selected scene and original identities');expect(undone.canonical).toBe(literal.undo.canonical_json);state(undone.state,literal.undo.state,before.roles);expect(new Set(undone.rows.map(row=>row.node.id))).toEqual(new Set(before.rows.map(row=>row.node.id)));expect(docEvents(undone).length-docEvents(before).length).toBe(2);
  for(const edge of ['anchor','focus']){expect(undone.rawDom[edge].path).toEqual(item.originalDomSelection[edge].path);expect(undone.rawDom[edge].offset).toBe(item.originalDomSelection[edge].offsetUtf16);}
  expect((await call(page,'history',id,'redo')).response.status).toBe('ok');const redone=await checkpoint(page,id,'P16 exact redo after direct-suffix correspondence');expect(redone.canonical).toBe(literal.redo.canonical_json);state(redone.state,literal.redo.state,before.roles);expect(docEvents(redone).length-docEvents(before).length).toBe(3);
});
test('transparent SPAN policy cannot erase STRONG from an unselected prefix or suffix',async({page})=>{
  const literal=native.cases.find(c=>c.id==='P17-forward');
  for(const variant of ['unmarked-prefix','unmarked-suffix']){
    const {id,before}=await call(page,'mount',{caseId:'D04-marks-BR-sentinels-forward',nativeCase:literal.id});records.get(page).checkpoints.push({label:variant+' independent marked baseline',value:before});expect(before.canonical).toBe(literal.input.canonical_json);state(before.state,literal.before_state,before.roles);
    await call(page,'start',id);await call(page,'wrapperPreedit',id,variant);const during=await checkpoint(page,id,variant+' controlled mark erasure');
    const children=during.dom[0].children[0].children;expect(children).toHaveLength(2);expect(children[variant==='unmarked-prefix'?0:1]).toEqual({nodeType:3,data:variant==='unmarked-prefix'?'a':'d',utf16Units:1});expect(children[variant==='unmarked-prefix'?1:0].tag).toBe('strong');expect(during.objects.T_mark.connected).toBe(true);
    expect(during.canonical).toBe(before.canonical);expect(during.state).toEqual(before.state);expect(during.trace.filter(x=>x.kind==='dom-write'&&x.writer==='adapter'&&x.phase==='composing'&&x.insideWindow)).toEqual([]);
    await call(page,'end',id,{data:'\u00e9'});await terminal(page,id);const after=await checkpoint(page,id,variant+' rejected before semantic command');
    expect(after.lifecycle).toBe('recoveryRequired');expect(after.canonical).toBe(before.canonical);expect(after.state).toEqual(before.state);expect(docEvents(after)).toEqual(docEvents(before));expect(after.rows).toEqual(before.rows);
    expect(after.recovery.composition.reason).toBe('capture_limit');expect(after.recovery.composition.nativeOutcome).toBe('not_submitted');expect(after.recovery.composition.submission).toBeNull();expect(after.recovery.composition.response).toBeNull();expect(after.recovery.provisionalText).toBe('a\u00e9d\ntail');
    for(const role of ['BR','C_outer','C_mark','C_text','H','O_outer','O_text']){expect(after.objects[role].connected).toBe(true);expect(after.objects[role].attributes).toEqual(before.objects[role].attributes);expect(after.objects[role].text).toEqual(before.objects[role].text);}
    expect(after.dom).toEqual(during.dom);
  }
});
test('attribute-free custom mark SPAN remains significant when its unselected suffix loses the mark',async({page})=>{
  const literal=native.cases.find(c=>c.id==='P17-forward'),mounted=await call(page,'markSpanMount'),{id,before}=mounted;
  records.get(page).checkpoints.push({label:'Independent native P17 with explicit public mark-SPAN presentation',value:before});expect(mounted.presentation).toContain('native P17 strong mark is unchanged');expect(before.canonical).toBe(literal.input.canonical_json);state(before.state,literal.before_state,before.roles);
  const text=before.rows.find(row=>row.node.id===before.roles.T).node;expect(text.marks.map(mark=>mark.type_id)).toEqual(['org.klenwriter.kwdj/strong']);expect(before.dom[0].children[0].children[0].tag).toBe('span');expect(before.objects.T_mark.attributes).toEqual({});
  await call(page,'start',id);await call(page,'wrapperPreedit',id,'unmarked-custom-span-suffix');const during=await checkpoint(page,id,'Controlled custom mark-SPAN suffix erasure');
  expect(during.dom[0].children[0].children).toHaveLength(2);expect(during.dom[0].children[0].children[0].tag).toBe('span');expect(during.dom[0].children[0].children[1]).toEqual({nodeType:3,data:'d',utf16Units:1});expect(during.objects.T_mark.connected).toBe(true);expect(during.canonical).toBe(before.canonical);expect(during.state).toEqual(before.state);expect(during.trace.filter(x=>x.kind==='dom-write'&&x.writer==='adapter'&&x.phase==='composing'&&x.insideWindow)).toEqual([]);
  await call(page,'end',id,{data:'\u00e9'});await terminal(page,id);const after=await checkpoint(page,id,'Custom mark-SPAN loss refused before native dispatch');
  expect(after.lifecycle).toBe('recoveryRequired');expect(after.canonical).toBe(before.canonical);expect(after.state).toEqual(before.state);expect(after.rows).toEqual(before.rows);expect(docEvents(after)).toEqual(docEvents(before));expect(after.recovery.composition.reason).toBe('capture_limit');expect(after.recovery.composition.nativeOutcome).toBe('not_submitted');expect(after.recovery.composition.submission).toBeNull();expect(after.recovery.composition.response).toBeNull();expect(after.recovery.provisionalText).toBe('a\u00e9d\ntail');expect(after.dom).toEqual(during.dom);
  for(const role of ['BR','C_outer','C_mark','C_text','H','O_outer','O_text']){expect(after.objects[role].connected).toBe(true);expect(after.objects[role].attributes).toEqual(before.objects[role].attributes);expect(after.objects[role].text).toEqual(before.objects[role].text);}
});

// Actual browser keyboard/focus topology only. No OS IME, composition gesture,
// synthetic keyboard event, or programmatic focus/range repair is used here.
// The installed I06 preedit lane remains a separate mandatory observation.
for(const locale of ['en','ru'])test(`installed fixture nontext focus topology ${locale}: actual browser ShiftTab/Tab preserves original native range`,async({page})=>{
  const observations=records.get(page);
  observations.scope='Actual public packaged SDK2/sealed WASM and browser keyboard focus topology; not OS IME or installed physical input.';
  const nativeCall=(method,...args)=>page.evaluate(({method,args})=>window.compositionNative[method](...args),{method,args});
  const original=await page.evaluate(()=>{
    const button=document.getElementById('composition-host-control');
    window.compositionFocusOriginalButton=button;
    return {tag:button.tagName,type:button.type,tabIndexAttribute:button.getAttribute('tabindex'),connected:button.isConnected};
  });
  expect(original).toEqual({tag:'BUTTON',type:'button',tabIndexAttribute:null,connected:true});
  expect(await page.evaluate(async()=>{await import('/composition-native-host.js');return window.compositionNativeReady;})).toBe(true);
  let prepared=null;
  try{
    prepared=await nativeCall('prepare',locale,'blur-refocus');
    const {id}=prepared,literal=native.cases.find(row=>row.id==='P19-forward');
    observations.nativeFocusPrepared=prepared;
    const setup=await page.evaluate(id=>{
      const control=document.getElementById('composition-host-control'),editor=document.getElementById(id);
      return {tag:control.tagName,type:control.type,tabIndex:control.tabIndex,tabIndexAttribute:control.getAttribute('tabindex'),sameObject:control===window.compositionFocusOriginalButton,
        controls:document.querySelectorAll('#composition-host-control').length,connected:control.isConnected,
        beforeEditor:!!(control.compareDocumentPosition(editor)&Node.DOCUMENT_POSITION_FOLLOWING),
        outsideEditable:!control.closest('[contenteditable="true"]'),editorFocused:document.activeElement===editor};
    },id);
    observations.nativeFocusSetup=setup;
    // Frozen I06 requires a nontext focus control; a text input is not a substitute.
    // An explicit tabindex makes the original button reachable without a swap.
    expect(setup).toEqual({tag:'BUTTON',type:'button',tabIndex:0,tabIndexAttribute:'0',sameObject:true,controls:1,connected:true,beforeEditor:true,outsideEditable:true,editorFocused:true});
    const originalButton=async()=>{
      const value=await page.evaluate(()=>{const control=document.getElementById('composition-host-control');return {sameObject:control===window.compositionFocusOriginalButton,tag:control.tagName,type:control.type,tabIndexAttribute:control.getAttribute('tabindex'),connected:control.isConnected};});
      (observations.nativeFocusControlChecks??=[]).push(value);
      expect(value).toEqual({sameObject:true,tag:'BUTTON',type:'button',tabIndexAttribute:'0',connected:true});
    };
    const before=await nativeCall('checkpoint');
    observations.checkpoints.push({label:'Noncomposing P19 original directed focus baseline',value:before});
    expect(before.canonical).toBe(literal.input.canonical_json);state(before.state,literal.before_state,before.roles);
    expect(before.state.selection).toEqual(selection(before.roles,literal.input.selection));
    expect(before.activeElementId).toBe(id);expect(before.rawDom.inside).toBe(true);
    const unchanged=value=>{
      expect(value.lifecycle).toBe('ready');expect(value.recovery).toBeNull();expect(value.errors).toEqual([]);
      expect(value.policyViolations).toEqual([]);expect(value.policyOverflow).toBeNull();expect(value.traceOverflow).toBe(false);
      expect(value.canonical).toBe(before.canonical);expect(value.state).toEqual(before.state);
      expect(value.rows).toEqual(before.rows);expect(value.events).toEqual(before.events);expect(value.dom).toEqual(before.dom);
      expect(value.uaComposition).toEqual({starts:0,ends:0,open:false});
    };
    const acknowledged=(value,from,shift)=>{
      expect(value.traceOverflow).toBe(false);
      for(const event of ['keydown','keyup'])expect(value.inputTrace.slice(from).some(row=>row.event===event&&row.code==='Tab'&&row.isTrusted===true&&row.shift===shift&&row.alt===false&&row.meta===false),`Actual trusted ${event}/Tab shift=${shift}`).toBe(true);
    };
    const departureStart=before.inputTrace.length;
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#composition-host-control')).toBeFocused();
    const departed=await nativeCall('checkpoint');
    observations.checkpoints.push({label:'Actual browser ShiftTab departure',value:departed});
    acknowledged(departed,departureStart,true);unchanged(departed);expect(departed.activeElementId).toBe('composition-host-control');await originalButton();
    for(let i=0;i<5;i++){
      await page.waitForTimeout(100);const stable=await nativeCall('checkpoint');
      observations.checkpoints.push({label:`External nontext focus stable ${i}`,value:stable});
      expect(stable.activeElementId).toBe('composition-host-control');unchanged(stable);await originalButton();
    }
    const returnStart=(await nativeCall('inspect')).inputTraceCount;
    await page.keyboard.press('Tab');
    await expect(page.locator(`#${id}`)).toBeFocused();
    const returned=await nativeCall('checkpoint');
    observations.checkpoints.push({label:'Actual browser Tab return to original native range',value:returned});
    acknowledged(returned,returnStart,false);unchanged(returned);expect(returned.activeElementId).toBe(id);await originalButton();
    // SelectionOwner's Tab-return uses view.restoreSelection, not SDK publish;
    // syncFromDom submits only a DIFFERENT selection. No epoch allowance is invented.
    expect(returned.rawDom).toEqual(before.rawDom);
  }finally{
    if(prepared){
      observations.nativeFocusFinish=await nativeCall('finish');released(observations.nativeFocusFinish);
      expect(observations.nativeFocusFinish.nativeFinal).toEqual({sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});
      expect(observations.nativeFocusFinish.errors).toEqual([]);expect(observations.nativeFocusFinish.policyViolations).toEqual([]);expect(observations.nativeFocusFinish.policyOverflow).toBeNull();
      observations.nativeFocusRestoration=await page.evaluate(()=>{
        const control=document.getElementById('composition-host-control');
        return {sameObject:control===window.compositionFocusOriginalButton,tag:control.tagName,type:control.type,tabIndexAttribute:control.getAttribute('tabindex'),connected:control.isConnected};
      });
      expect(observations.nativeFocusRestoration).toEqual({sameObject:true,tag:'BUTTON',type:'button',tabIndexAttribute:null,connected:true});
    }
  }
});
