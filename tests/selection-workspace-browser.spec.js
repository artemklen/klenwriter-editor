// SPDX-License-Identifier: MIT OR Apache-2.0
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const frozen=name=>JSON.parse(readFileSync(`contracts/selection/v1/${name}-oracles.json`,'utf8'));
const native=frozen('native'), bookmarks=frozen('bookmark'), formatting=frozen('formatting'), unicode=frozen('unicode'), scroll=frozen('scroll'), clipboard=frozen('clipboard');
const errata=Object.fromEntries(['001-empty-unicode-input','002-mixed-mark-typing-group'].map(name=>{const path=`contracts/selection/errata/${name}.json`,bytes=readFileSync(path);return [name.slice(0,3),{path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),data:JSON.parse(bytes)}];}));
const historyLiterals=JSON.parse(readFileSync('contracts/history/v1/vectors.json','utf8'));
const call=(page,method,...args)=>page.evaluate(({method,args})=>window.selectionHost[method](...args),{method,args});
const points=new WeakMap();
const canonical=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const idsAt=point=>new Set(point.rows.map(r=>r.node.id));
const row=(point,path)=>point.rows.find(r=>r.path===path)?.node;
function point(ids,p){if(p===null)return null;const field=p.kind==='child'?'parent':'node';const name=p[field]??p.role??p.nodeRole;return p.kind==='text'?{kind:'text',node:ids[name]??name,offset:p.offset,affinity:p.affinity}:p.kind==='child'?{kind:'child',parent:ids[name]??name,index:p.index,affinity:p.affinity}:{kind:'edge',node:ids[name]??name,side:p.side};}
const selection=(ids,s)=>s===null?null:{anchor:point(ids,s.anchor),focus:point(ids,s.focus)};
function response(result){expect(['completed','queued']).toContain(result.status);return result.response;}
function pure(after,before){expect(after.state).toEqual(before.state);expect(after.rows).toEqual(before.rows);if(before.canonical!==null)expect(after.canonical).toBe(before.canonical);expect(after.events).toEqual(before.events);expect(after.native).toEqual(before.native);}
function diagnostic(actual,expected,stamp){expect(actual.status).toBe(expected.status);expect(actual.diagnostic).toEqual({...expected.diagnostic,...('stamp'in expected.diagnostic?{stamp}: {})});}
function macros(value,stamp){if(value==='exact_current_stamp')return stamp;if(Array.isArray(value))return value.map(v=>macros(v,stamp));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,macros(v,stamp)]));return value;}
async function checkpoint(page,id,label,includeCanonical=true){const value=await call(page,'inspect',id,includeCanonical);points.get(page).checkpoints.push({label,...value});return value;}
test.beforeEach(async({page},info)=>{
  const record={engine:info.project.name,installedBrowser:false,errors:[],externalRequests:[],checkpoints:[]};points.set(page,record);
  page.on('pageerror',e=>record.errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:4174/'))record.externalRequests.push(r.url());});
  await page.addInitScript(()=>{window.selectionViolations=[];window.selectionStartupErrors=[];window.addEventListener('error',e=>window.selectionStartupErrors.push(e.message));document.addEventListener('securitypolicyviolation',e=>window.selectionViolations.push({directive:e.violatedDirective,blocked:e.blockedURI}));});
  const loaded=await page.goto('/selection');record.csp=loaded.headers()['content-security-policy'];
  expect(record.csp).toContain("default-src 'none'");expect(record.csp).not.toContain("'unsafe-inline'");expect(record.csp).not.toMatch(/(?:^|\s)'unsafe-eval'/);
  await page.waitForFunction(()=>window.selectionHostReady===true||window.selectionStartupErrors.length>0,undefined,{timeout:15000});expect(await page.evaluate(()=>window.selectionStartupErrors)).toEqual([]);record.metadata=await call(page,'metadata');
  expect(record.metadata.contractCounts).toEqual({bookmark:59,native:24,formatting:2,clipboard:28,unicode:8,scroll:12});
});
test.afterEach(async({page},info)=>{
  const record=points.get(page);if(!record)return;
  try {record.nativeFinal=await call(page,'allDisposed');record.resourceReadbacks=await call(page,'resourceReadbacks');for(const mount of record.resourceReadbacks){const r=mount.resources;if(!mount.headless){expect(r.dom.listeners).toBe(0);expect(r.dom.observers).toBe(0);expect(r.dom.continuations).toBe(0);expect(r.selection).toEqual({bookmarks:0,restoreTickets:0,activePointers:0,animationFrames:0});expect(r.clipboard).toEqual({pending:0,continuations:0,retainedTextBytes:0});}const sdk=mount.headless?r:r.sdk;for(const key of ['sessions','listeners','queued_mutations','queued_bytes','pending_tickets','host_requests','task_continuations'])expect(sdk[key]).toBe(0);}record.cspViolations=await page.evaluate(()=>window.selectionViolations);expect(record.nativeFinal).toEqual({sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});expect(record.errors).toEqual([]);expect(record.externalRequests).toEqual([]);expect(record.cspViolations).toEqual([]);}
  finally {record.status=info.status;record.scope='Actual public packaged mounted DOM/SDK2/WASM; browser protocol input automated. Controlled platform writer/synthetic cancellation labelled. Not installed/native or full IME/clipboard pipeline proof.';mkdirSync('artifacts/selection',{recursive:true});const path=`artifacts/selection/${info.project.name}-${info.testId.replaceAll(/[^A-Za-z0-9_-]/g,'_')}.json`;writeFileSync(path,JSON.stringify(record,null,2)+'\n');await info.attach('selection-observations',{path,contentType:'application/json'});}
});

for(const item of native.cases)test(`native ${item.id}: literal projection/query/delete/maps/history`,async({page})=>{
  // These three documents intentionally exceed the basic renderer. Their real
  // SDK2/native semantics are measured without pretending DOM admission passed.
  const headless=['L7-selected-domain-refused','L7-selected-reference-refused','L7-unselected-domain-elsewhere-not-a-refusal'].includes(item.id);
  const mounted=await call(page,'mount',{source:item.input.document,roles:item.input.identity_roles,access:item.input.access,identities:item.input.identities,headless});
  expect(mounted.ready.status).toBe(headless?'ok':'ready');const id=mounted.id;
  if(item.input.selection!==null)expect(response(await call(page,'selectModel',id,item.input.selection)).status).toBe('ok');
  if(item.input.stored_marks)expect(response(await call(page,'submit',id,{kind:'set_stored_marks',marks:item.input.stored_marks})).status).toBe('ok');
  const before=await checkpoint(page,id,'before projection');expect(before.canonical).toBe(item.input.canonical_json);
  expect(before.state.selection).toEqual(selection(before.roles,item.input.selection));
  if(item.before_projection_action){const result=await call(page,'selectModel',id,item.before_projection_action.request.selection);diagnostic(response(result),item.before_projection_action.expected,before.state.stamp);pure(await checkpoint(page,id,'invalid selection remains pure'),before);}
  const projected=await call(page,'read',id,{kind:'selection_text',max_bytes:1048576});
  if(item.projection.expected.status==='ok')expect(projected).toEqual({status:'ok',value:{...item.projection.expected.value,stamp:before.state.stamp,selection:selection(before.roles,item.projection.expected.value.selection),selected_atoms:item.projection.expected.value.selected_atoms.map(role=>before.roles[role])}});
  else diagnostic(projected,item.projection.expected,before.state.stamp);
  pure(await checkpoint(page,id,'pure projection'),before);
  const query=await call(page,'queryCommand',id,{kind:'delete_selection'});expect(query).toEqual(macros(item.delete_selection.query,before.state.stamp));pure(await checkpoint(page,id,'pure command query'),before);
  const executed=response(await call(page,'command',id,{kind:'delete_selection'}));
  if(item.delete_selection.execute.status!=='ok'){diagnostic(executed,item.delete_selection.execute,before.state.stamp);pure(await checkpoint(page,id,'native refusal'),before);return;}
  expect(executed.status).toBe('ok');expect(executed.value.effect).toBe(item.delete_selection.execute.value.effect);
  await call(page,'bindRoles',id,item.after.identity_roles);const after=await checkpoint(page,id,'delete selection');expect(after.canonical).toBe(item.after.canonical_json);expect(after.state.selection).toEqual(selection(after.roles,item.after.selection));
  const oldIds=idsAt(before),live=idsAt(after);for(const role of item.identity.retained_live??[])expect(live.has(before.roles[role])).toBe(true);for(const role of item.identity.retired_old??[])expect(live.has(before.roles[role])).toBe(false);for(const role of item.identity.created_live??[])expect(oldIds.has(after.roles[role])).toBe(false);
  for(const probe of item.maps??[]){const actual=await call(page,'read',id,{kind:'map_position',from_revision:probe.from_revision,position:point(after.roles,probe.input)});expect(actual.status).toBe('ok');expect(actual.value).toEqual({kind:'mapped',status:probe.status,position:point(after.roles,probe.position),deleted:probe.deleted,stamp:after.state.stamp});}
  if(item.delete_selection.execute.value.effect==='unchanged'){pure(after,before);return;}
  expect(after.state.stamp.revision).toBe('1');expect(after.state.history.undo_entries).toBe('1');expect(after.state.history.redo_entries).toBe('0');expect(after.events.filter(e=>e.change.kind==='document')).toHaveLength(1);
  for(const direction of ['undo','redo']){
    const expected=item.history?.[direction];if(!expected)continue;expect(response(await call(page,'history',id,direction)).status).toBe('ok');
    const p=await checkpoint(page,id,direction);expect(p.canonical).toBe(expected.canonical_json);expect(p.state.stamp.revision).toBe(expected.revision);expect(p.state.selection).toEqual(selection(p.roles,expected.selection));
    for(const [role,path] of Object.entries(expected.identity_roles)){const actual=row(p,path.virtual_root?'':`/${path.join('/')}`);expect(actual.id).toBe((direction==='undo'?before:after).roles[role]);}
    expect(p.state.history.undo_entries).toBe(String(expected.undo_entries));expect(p.state.history.redo_entries).toBe(String(expected.redo_entries));
  }
});

for(const item of native.projection_separator_literals)test(`projection separator ${item.id}: exact literal text, atoms and pure native facets`,async({page})=>{
  const {id,ready}=await call(page,'mount',{source:item.document,roles:{ROOT:{virtual_root:true},...item.roles}});expect(ready.status).toBe('ready');expect(response(await call(page,'selectModel',id,item.selection)).status).toBe('ok');
  const before=await checkpoint(page,id,'before literal separator read');expect(before.canonical).toBe(item.canonical_json);
  const actual=await call(page,'read',id,{kind:'selection_text',max_bytes:1048576});
  expect(actual).toEqual({status:'ok',value:{kind:'selection_text',stamp:before.state.stamp,selection:selection(before.roles,item.selection),projection_id:'org.klenwriter.kwdj/selection-text/1',text:item.text,empty:item.empty,selected_atoms:item.selected_atoms.map(role=>before.roles[role])}});
  const after=await checkpoint(page,id,'after literal separator read');pure(after,before);expect(after.resources).toEqual(before.resources);
});

for(const item of native.output_budget_literals)test(`projection budget ${item.id}: exact cap without truncation or native mutation`,async({page})=>{
  const {id,ready}=await call(page,'mount',{source:item.document,roles:item.roles});expect(ready.status).toBe('ready');expect(response(await call(page,'selectModel',id,item.selection)).status).toBe('ok');
  const before=await checkpoint(page,id,'before bounded projection');expect(before.canonical).toBe(item.canonical_json);
  const actual=await call(page,'read',id,item.request);
  if(item.expected.status==='ok')expect(actual).toEqual({status:'ok',value:{kind:'selection_text',stamp:before.state.stamp,selection:selection(before.roles,item.selection),projection_id:'org.klenwriter.kwdj/selection-text/1',text:item.expected.text,empty:item.expected.empty,selected_atoms:item.expected.selected_atoms.map(role=>before.roles[role])}});
  else diagnostic(actual,item.expected,before.state.stamp);
  const after=await checkpoint(page,id,'after bounded projection');pure(after,before);expect(after.resources).toEqual(before.resources);
});

for(const item of formatting.cases)test(`format ${item.id}: exact outside sentinels, native direction and history`,async({page})=>{
  const {id,ready}=await call(page,'mount',{source:formatting.inputs[item.input],roles:formatting.roles});expect(ready.status).toBe('ready');await call(page,'selectModel',id,item.selection);
  const before=await checkpoint(page,id,'format before');const projection=await call(page,'read',id,{kind:'selection_text',max_bytes:1048576});expect(projection.value.text).toBe(item.projection.text);expect(projection.value.selected_atoms).toEqual(item.projection.selectedAtomRoles.map(role=>before.roles[role]));
  expect(response(await call(page,'command',id,item.command)).status).toBe('ok');await call(page,'bindRoles',id,item.identity.new);const after=await checkpoint(page,id,'strong applied');expect(after.canonical).toBe(formatting.canonical[item.expectedCanonical]);expect(after.state.stamp.revision).toBe('1');expect(after.state.history.undo_entries).toBe('1');
  const actualDirection=Math.sign(after.rows.findIndex(r=>r.node.id===after.state.selection.anchor.node)-after.rows.findIndex(r=>r.node.id===after.state.selection.focus.node));expect(actualDirection).toBe(item.id.endsWith('backward')?1:-1);
  const formattedProjection=await call(page,'read',id,{kind:'selection_text',max_bytes:1048576});expect(formattedProjection.value.text).toBe(item.projection.text);expect(formattedProjection.value.selected_atoms).toEqual(item.projection.selectedAtomRoles.map(role=>after.roles[role]));
  for(const role of item.identity.survive)expect(idsAt(after).has(before.roles[role])).toBe(true);for(const role of Object.keys(item.identity.new))expect(idsAt(before).has(after.roles[role])).toBe(false);
  expect(response(await call(page,'history',id,'undo')).status).toBe('ok');const undone=await checkpoint(page,id,'format undo');expect(undone.canonical).toBe(formatting.canonical.F1);expect(undone.state.selection).toEqual(before.state.selection);expect(undone.rows.map(r=>r.node.id)).toEqual(before.rows.map(r=>r.node.id));
  expect(response(await call(page,'history',id,'redo')).status).toBe('ok');const redone=await checkpoint(page,id,'format redo');expect(redone.canonical).toBe(after.canonical);expect(redone.rows.map(r=>r.node.id)).toEqual(after.rows.map(r=>r.node.id));expect(redone.state.selection).toEqual(after.state.selection);
  expect(response(await call(page,'command',id,item.command)).status).toBe('ok');expect((await checkpoint(page,id,'second toggle')).canonical).toBe(formatting.canonical.F1);
});

for(const item of unicode.cases)test(`Unicode ${item.id}: literal directed UTF16/scalar points and owned Select All`,async({page})=>{
  const roles=item.text?{root:'',P:'/0',T:'/0/0'}:{root:'',P:'/0'};
  // Explicit erratum001 preserves the malformed original bytes as a separate
  // native refusal below; the positive empty paragraph is already frozen v1 data.
  const source=item.id==='U-EMPTY'?bookmarks.documents.empty.wire:item.input;if(item.id==='U-EMPTY')points.get(page).appliedErrata=[errata['001']];
  const {id,ready}=await call(page,'mount',{source,roles});expect(ready.status).toBe('ready');
  const textPath=item.text?[0,0,0]:[0];
  for(const range of item.fullSelections){await call(page,'selectDomLiteral',id,{anchor:{path:textPath,offset:range.anchor},focus:{path:textPath,offset:range.focus}});await expect.poll(async()=>{const p=await call(page,'inspect',id,false);return p.state.selection;}).toEqual(selection((await call(page,'inspect',id,false)).roles,range.model));const p=await checkpoint(page,id,range.direction);expect(p.canonical).toBe(canonical(item.id==='U-EMPTY'?bookmarks.documents.empty.wire:item.input));const projected=await call(page,'read',id,{kind:'selection_text',max_bytes:1048576});expect(projected.status).toBe('ok');expect(projected.value.text).toBe(range.copy);}
  for(const offset of item.invalidHalfSurrogateOffsets){const before=await checkpoint(page,id,`before half surrogate ${offset}`);const captured=await call(page,'captureAfterDom',id,{anchor:{path:textPath,offset},focus:{path:textPath,offset}},'INVALID');expect(captured.status).toBe('dom_refused');expect(captured.diagnostic.code).toBe('dom.presentation_unsupported');const after=await checkpoint(page,id,`refused half surrogate ${offset}`);pure(after,before);}
  // Target an actual owned host before the browser keyboard gesture. Never
  // install the expected root range from the fixture after Select All.
  await page.locator(`#${id}`).focus();await page.keyboard.press(process.platform==='darwin'?'Meta+A':'Control+A');
  await expect.poll(async()=>{const p=await call(page,'inspect',id,false);return p.state.selection;}).toEqual(selection((await call(page,'inspect',id,false)).roles,{anchor:{kind:'child',role:'root',index:0,affinity:'after'},focus:{kind:'child',role:'root',index:1,affinity:'after'}}));
  await checkpoint(page,id,'actual owned Select All');
});

test('Unicode U-EMPTY original malformed input: exact native admission refusal retained by erratum001',async({page})=>{
  const original=unicode.cases.find(item=>item.id==='U-EMPTY');
  const {ready}=await call(page,'mount',{source:original.input,headless:true});
  expect(ready).toEqual(errata['001'].data.negativeInput.expected);
  points.get(page).originalMalformedInput={source:'contracts/selection/v1/unicode-oracles.json#U-EMPTY.input',erratum:'contracts/selection/errata/001-empty-unicode-input.json',ready};
});

for(const key of unicode.keyboard.ltrWholeCluster)test(`keyboard ${key.case}: actual ${key.key} selects one complete cluster`,async({page})=>{
  const item=unicode.cases.find(c=>c.id===key.case),{id}=await call(page,'mount',{source:item.input,roles:{T:'/0/0'}});
  await call(page,'selectModel',id,{anchor:{kind:'text',node:'T',offset:key.setupOffset,affinity:'after'},focus:{kind:'text',node:'T',offset:key.setupOffset,affinity:'after'}});
  await page.keyboard.press(key.key);await expect.poll(async()=>{const p=await call(page,'inspect',id,false);return p.state.selection;}).toEqual(selection((await call(page,'inspect',id,false)).roles,{anchor:{kind:'text',node:'T',offset:key.expectedAnchor,affinity:'after'},focus:{kind:'text',node:'T',offset:key.expectedFocus,affinity:'after'}}));await checkpoint(page,id,'actual keyboard cluster selection');
});

async function asciiBoundary(page){const literal=unicode.cases.find(row=>row.id==='U-ASCII');expect(literal.text).toBe('abc');const {id,ready}=await call(page,'mount',{source:literal.input,roles:{ROOT:'',P:'/0',T:'/0/0'}});expect(ready.status).toBe('ready');return {id,before:await checkpoint(page,id,'literal abc before pointer boundary')};}
function unchangedPointerDocument(after,before){expect(after.canonical).toBe(before.canonical);expect(after.rows.map(r=>r.node.id)).toEqual(before.rows.map(r=>r.node.id));expect(after.state.stamp.revision).toBe(before.state.stamp.revision);expect(after.state.dirty).toBe(before.state.dirty);expect(after.state.stored_marks).toEqual(before.state.stored_marks);expect(after.state.history.undo_entries).toBe(before.state.history.undo_entries);expect(after.state.history.redo_entries).toBe(before.state.history.redo_entries);expect(after.events.slice(before.events.length).filter(e=>e.change.kind==='document')).toEqual([]);}
function asciiRawEndpoint(raw,roles){
  if(!raw||!Array.isArray(raw.path)||!Number.isInteger(raw.offset))return null;const path=raw.path.join('/');
  if(raw.nodeType===3&&path==='0/0/0'&&raw.text==='abc'&&raw.offset>=0&&raw.offset<=3)return {kind:'text',node:roles.T,offset:raw.offset,affinity:'after'};
  // Finite, authored abc DOM-role table; no production view mapper or browser
  // word segmentation supplies this independent correspondence assertion.
  if(raw.nodeType===1&&path==='0/0'&&(raw.offset===0||raw.offset===1))return {kind:'text',node:roles.T,offset:raw.offset===0?0:3,affinity:'after'};
  if(raw.nodeType===1&&(path==='0'||path==='')&&(raw.offset===0||raw.offset===1))return {kind:'child',parent:path==='0'?roles.P:roles.ROOT,index:raw.offset,affinity:'after'};
  return null;
}
test('pointer boundary primary plain mousedown claims default and publishes exact literal Text1',async({page})=>{
  const {id,before}=await asciiBoundary(page),hit=await call(page,'literalHit',id,[0,0,0],1),point={kind:'text',node:before.roles.T,offset:1,affinity:'after'};let held=false;
  try{
    await page.mouse.move(hit.x,hit.y);await page.mouse.down();held=true;
    await expect.poll(async()=>(await call(page,'inspect',id,false)).state.selection).toEqual({anchor:point,focus:point});
    const during=await checkpoint(page,id,'actual primary down before physical release',false);expect(during.resources.selection.activePointers).toBe(1);expect(during.resources.selection.animationFrames).toBe(0);expect(during.activeElement).toBe(id);expect(during.rawDom.anchor).toEqual({path:[0,0,0],nodeType:3,text:'abc',offset:1});expect(during.rawDom.focus).toEqual(during.rawDom.anchor);
    const trace=await call(page,'actionTrace',id),down=trace.trace.find(row=>row.type==='browser'&&row.phase==='document-bubble'&&row.event==='mousedown');expect(down).toMatchObject({isTrusted:true,button:0,buttons:1,detail:1,defaultPrevented:true,shift:false,alt:false,ctrl:false,meta:false,selectionResources:{activePointers:1,animationFrames:0}});
    await page.mouse.up();held=false;const after=await checkpoint(page,id,'primary released');unchangedPointerDocument(after,before);expect(after.resources.selection.activePointers).toBe(0);expect(after.resources.selection.animationFrames).toBe(0);
  }finally{if(held)await page.mouse.up();points.get(page).pointerBoundaryTrace=await call(page,'actionTrace',id);}
});
test('pointer boundary double-click detail2 preserves native abc word selection and UA default',async({page})=>{
  const {id,before}=await asciiBoundary(page),hit=await call(page,'literalHit',id,[0,0,0],1);
  await page.mouse.dblclick(hit.x,hit.y);
  const literal={anchor:{kind:'text',node:before.roles.T,offset:0,affinity:'after'},focus:{kind:'text',node:before.roles.T,offset:3,affinity:'after'}};
  await expect.poll(async()=>(await call(page,'inspect',id,false)).state.selection).toEqual(literal);
  const after=await checkpoint(page,id,'actual UA double-click word');unchangedPointerDocument(after,before);expect(after.rawDom.anchor).toEqual({path:[0,0,0],nodeType:3,text:'abc',offset:0});expect(after.rawDom.focus).toEqual({path:[0,0,0],nodeType:3,text:'abc',offset:3});expect(after.resources.selection.activePointers).toBe(0);expect(after.resources.selection.animationFrames).toBe(0);
  const trace=await call(page,'actionTrace',id);points.get(page).pointerBoundaryTrace=trace;const downs=trace.trace.filter(row=>row.type==='browser'&&row.phase==='document-bubble'&&row.event==='mousedown');expect(downs.map(row=>({detail:row.detail,prevented:row.defaultPrevented,owned:row.selectionResources.activePointers}))).toEqual([{detail:1,prevented:true,owned:1},{detail:2,prevented:false,owned:0}]);expect(trace.trace.find(row=>row.type==='browser'&&row.phase==='document-bubble'&&row.event==='dblclick')).toMatchObject({isTrusted:true,detail:2,defaultPrevented:false});
});
test('pointer boundary Shift-mousedown retains UA focus/range without custom pointer or RAF',async({page})=>{
  const {id,before}=await asciiBoundary(page);expect(response(await call(page,'selectModel',id,{anchor:{kind:'text',node:'T',offset:1,affinity:'after'},focus:{kind:'text',node:'T',offset:1,affinity:'after'}})).status).toBe('ok');const hit=await call(page,'literalHit',id,[0,0,0],2);let held=false;
  try{
    await page.keyboard.down('Shift');await page.mouse.move(hit.x,hit.y);await page.mouse.down();held=true;
    const during=await checkpoint(page,id,'actual modified down before release',false);expect(during.resources.selection.activePointers).toBe(0);expect(during.resources.selection.animationFrames).toBe(0);expect(during.activeElement).toBe(id);
    const down=(await call(page,'actionTrace',id)).trace.find(row=>row.type==='browser'&&row.phase==='document-bubble'&&row.event==='mousedown');expect(down).toMatchObject({isTrusted:true,button:0,detail:1,shift:true,defaultPrevented:false,selectionResources:{activePointers:0,animationFrames:0}});
    await page.mouse.up();held=false;await page.keyboard.up('Shift');
    await expect.poll(async()=>{const p=await call(page,'inspect',id,false),a=asciiRawEndpoint(p.rawDom?.anchor,p.roles),f=asciiRawEndpoint(p.rawDom?.focus,p.roles);return p.rawDom?.inside===true&&a!==null&&f!==null&&JSON.stringify(p.state.selection)===JSON.stringify({anchor:a,focus:f});}).toBe(true);
    const after=await checkpoint(page,id,'UA modified range agrees with independent raw endpoint table');unchangedPointerDocument(after,before);expect(after.activeElement).toBe(id);expect(after.rawDom.inside).toBe(true);expect(after.resources.selection.activePointers).toBe(0);expect(after.resources.selection.animationFrames).toBe(0);
  }finally{if(held)await page.mouse.up();await page.keyboard.up('Shift');points.get(page).pointerBoundaryTrace=await call(page,'actionTrace',id);}
});

function authoredNode(document,path){let node=document;for(const i of path)node=node.content[i];return node;}
function rawBookmarkPoint(documentRef,p){
  const document=bookmarks.documents[documentRef],name=p.kind==='child'?p.parent:p.node;
  const path=(document.native_role_paths[name]??'').split('/').filter(Boolean).map(Number);
  if(p.kind==='text'){const node=authoredNode(document.wire,path);return {path:[...path,...Array((node.marks?.length??0)+1).fill(0)],offset:p.offset};}
  if(p.kind==='child')return {path,offset:p.index};
  return {path:path.slice(0,-1),offset:path.at(-1)+(p.side==='after'?1:0)};
}
async function bookmarkSetup(page,stateRef,config={}){
  const expected=bookmarks.states[stateRef],document=bookmarks.documents[expected.document_ref];
  const open=stateRef==='OPEN_GROUP',marks=stateRef==='MARKS';
  const source=open?bookmarks.documents.plain:document;
  const mounted=await call(page,'mount',{source:source.wire,roles:source.native_role_paths,...config});expect(mounted.ready.status).toBe('ready');
  const initialSelection=open?bookmarks.states.BASE.selection:expected.selection;
  if(initialSelection!==null)expect(response(await call(page,'selectModel',mounted.id,initialSelection)).status).toBe('ok');
  if(open||marks)expect(response(await call(page,'submit',mounted.id,{kind:'set_stored_marks',marks:[{type_id:'org.klenwriter.kwdj/strong',attributes:{}}]})).status).toBe('ok');
  if(open){expect(response(await call(page,'command',mounted.id,{kind:'insert_text',text:'x'},{kind:'typing',token:'1',class:'insert'})).status).toBe('ok');await call(page,'bindRoles',mounted.id,document.native_role_paths);}
  if(expected.focus_owner==='host_control')await call(page,'outsideFocus');
  if(expected.focus_owner==='editor_B'&&stateRef!=='B_STATE')mounted.otherEditorId=(await bookmarkSetup(page,'B_STATE')).id;
  return mounted;
}
function bookmarkLiteral(ref,caseId){const literal=bookmarks.states[ref],correction=errata['002'].data.mixedMarkStateCorrection;return caseId===errata['002'].data.originalCase&&ref===correction.afterStateRef?{...literal,stamp:{...literal.stamp,history_epoch:correction.afterHistoryEpoch}}:literal;}
function bookmarkState(actual,ref,caseId){
  const expected=bookmarkLiteral(ref,caseId);expect(actual.canonical).toBe(canonical(bookmarks.documents[expected.document_ref].wire));
  for(const name of ['revision','selection_epoch','history_epoch'])expect(actual.state.stamp[name]).toBe(expected.stamp[name]);
  expect(actual.state.selection).toEqual(selection(actual.roles,expected.selection));expect(actual.state.stored_marks).toEqual(expected.stored_marks);expect(actual.state.dirty).toBe(expected.dirty);
  expect(actual.state.history.undo_entries).toBe(expected.history.undo_entries);expect(actual.state.history.redo_entries).toBe(expected.history.redo_entries);
  for(const [role,path] of Object.entries(bookmarks.documents[expected.document_ref].native_role_paths))expect(row(actual,path).id).toBe(actual.roles[role]);
}
async function waitForLiteralNativeState(page,id,ref,caseId){
  const literal=bookmarkLiteral(ref,caseId),roles=(await call(page,'inspect',id,false)).roles;
  try {
    await expect.poll(async()=>{const {state}=await call(page,'inspect',id,false);return {selection:state.selection,stored_marks:state.stored_marks,revision:state.stamp.revision,selection_epoch:state.stamp.selection_epoch,history_epoch:state.stamp.history_epoch,undo_entries:state.history.undo_entries,redo_entries:state.history.redo_entries,dirty:state.dirty};}).toEqual({selection:selection(roles,literal.selection),stored_marks:literal.stored_marks,revision:literal.stamp.revision,selection_epoch:literal.stamp.selection_epoch,history_epoch:literal.stamp.history_epoch,undo_entries:literal.history.undo_entries,redo_entries:literal.history.redo_entries,dirty:literal.dirty});
  } finally {await checkpoint(page,id,`actual browser owner settled against literal ${ref}`,false);}
}
async function documentBoundary(page,id,step){
  let intent;
  switch(step.map_ref){
    case 'SPLIT_AT_2':intent={kind:'enter'};break;
    case 'JOIN_2_PLUS_2':intent={kind:'toggle_mark',mark:{type_id:'org.klenwriter.kwdj/strong',attributes:{}}};break;
    case 'MOVE_FORWARD':intent={kind:'move',node:'P1',parent:'ROOT',before_index:3};break;
    case 'MOVE_BACKWARD':intent={kind:'move',node:'P2',parent:'ROOT',before_index:0};break;
    case 'MOVE_CROSS_PARENT':intent={kind:'move',node:'P1',parent:'Q1',before_index:0};break;
    case 'INSERT_AT_2':intent={kind:'insert_text',text:'Я'};break;
    case 'REMOVE_P1':intent={kind:'remove',node:'P1'};break;
    case 'EVICTED':for(let i=0;i<66;i++)expect(response(await call(page,'command',id,{kind:'move',node:'P1',parent:'ROOT',before_index:i%2===0?3:1})).status).toBe('ok');break;
    default:throw new Error(`Unimplemented actual native boundary ${step.map_ref}`);
  }
  if(intent)expect(response(await call(page,'command',id,intent)).status).toBe('ok');
  if(step.expected_state_ref)await call(page,'bindRoles',id,bookmarks.documents[bookmarks.states[step.expected_state_ref].document_ref].native_role_paths);
}
// These exact IDs use the selection owner's ordinary internal configuration in
// the separate Node unit lane. They are not silently passed/skipped in a browser.
const bookmarkUnitBoundaryIds=new Set(['BM-C11','BM-M13','BM-M14','BM-A01','BM-A02','BM-A03','BM-S07','BM-H05','BM-M15','BM-A04','BM-A05']);
for(const item of bookmarks.cases.filter(c=>!bookmarkUnitBoundaryIds.has(c.id)))test(`bookmark ${item.id}: ${item.id==='BM-FX01'?'mixed-mark navigation clears override and preserves already isolated history (erratum002)':item.name}`,async({page})=>{
  const readonly=item.id==='BM-S06',setup=await bookmarkSetup(page,item.current_state_ref,readonly?{access:'read_only',mode:'readOnly'}:{}),{id}=setup;
  if(item.id===errata['002'].data.originalCase)points.get(page).appliedErrata=[errata['002']];
  const baseline=await checkpoint(page,id,'initial literal state');bookmarkState(baseline,item.current_state_ref);
  let last=null,lastCapture=null,documentRef=bookmarks.states[item.current_state_ref].document_ref,lastBeforeRestore=null,releaseResult=null,destroyed=false;
  const results=[],preCaptured=new Set();
  for(const step of item.steps){
    switch(step.action){
      case 'selection.captureBookmark':{
        if(preCaptured.has(step)){last=lastCapture;results.push(lastCapture);break;}
        const count=step.repeat??1;
        for(let i=0;i<count;i++){lastCapture=await call(page,'captureBookmark',id,step.bind_handles?.[i]??step.bind);results.push(lastCapture);if(step.repeat)expect(lastCapture.status).toBe('captured');}
        last=lastCapture;break;
      }
      case 'selection.restoreBookmark':lastBeforeRestore=destroyed?null:await checkpoint(page,id,'guarded state before explicit restore',false);last=await call(page,'restoreBookmark',id,step.bookmark,step.options);results.push(last);break;
      case 'selection.releaseBookmark':releaseResult=await call(page,'releaseBookmark',id,step.bookmark);results.push(releaseResult);break;
      case 'fixture.clone_serializable_bookmark':await call(page,'cloneBookmark',id,step.from,step.bind);break;
      case 'fixture.capture_other_mount_bookmark':{const other=await bookmarkSetup(page,step.state_ref);expect((await call(page,'captureBookmark',other.id,'FOREIGN')).status).toBe('captured');await call(page,'useForeignBookmark',id,other.id,'FOREIGN',step.bind);break;}
      case 'fixture.observe_dom_selection':{
        const raw={anchor:rawBookmarkPoint(documentRef,step.selection.anchor),focus:rawBookmarkPoint(documentRef,step.selection.focus)};
        const capture=item.steps.find(s=>s.action==='selection.captureBookmark');lastCapture=await call(page,'captureAfterDom',id,raw,capture.bind);last=lastCapture;
        // Capture happens in that same synchronous browser turn, before the UA
        // asynchronous selectionchange can publish a different native target.
        const next=item.steps[item.steps.indexOf(step)+1];if(next)preCaptured.add(next);break;
      }
      case 'mounted.submit':last=await call(page,'submit',id,step.request);break;
      case 'native.document_only_boundary':await documentBoundary(page,id,step);if(step.expected_state_ref)documentRef=bookmarks.states[step.expected_state_ref].document_ref;break;
      case 'owned.pointerdown':{const p=rawBookmarkPoint(documentRef,{kind:'text',node:step.role,offset:step.offset}),hit=await call(page,'literalHit',id,p.path,p.offset,{asciiLeafEnd:item.id==='BM-FX02'});points.get(page).checkpoints.push({label:'before authored bookmark pointer input',inputTarget:hit});if(item.id==='BM-FX02'){expect(hit.preflight.exact).toBe(true);expect(hit.preflight.requested).toEqual({path:p.path,nodeType:3,text:'x',offset:1});expect(hit.preflight.rawHit).toEqual(hit.preflight.requested);expect(hit.preflight.scalarBoundary).toBe(true);}await page.mouse.click(hit.x,hit.y);break;}
      case 'internal.syncFromDom':if(step.expected_state_ref)await waitForLiteralNativeState(page,id,step.expected_state_ref,item.id);break; // observe actual browser input owner, never a fixture setter
      case 'internal.restore_current_native_on_tab':break;
      case 'owned.new_selection':{const raw={anchor:rawBookmarkPoint(documentRef,step.selection.anchor),focus:rawBookmarkPoint(documentRef,step.selection.focus)};await call(page,'selectDomLiteral',id,raw);await expect.poll(async()=>{const p=await call(page,'inspect',id,false);return p.state.selection;}).toEqual(selection(baseline.roles,step.selection));break;}
      case 'fixture.focus_control_then_keyboard_tab':await call(page,'outsideFocus');await page.keyboard.press('Tab');await expect(page.locator(`#${id}`)).toBeFocused();break;
      case 'fixture.external_control_selection':await call(page,'outsideFocus');break;
      case 'fixture.begin_provisional':await call(page,'beginProvisional',id,step.actual_provisional_text);break;
      case 'mounted.destroy':await call(page,'dispose',id);destroyed=true;break;
      case 'mounted.replace':last=await call(page,'replace',id,step.input_json??bookmarks.documents[step.input_document_ref].wire);if(step.expected_state_ref){documentRef=bookmarks.states[step.expected_state_ref].document_ref;await call(page,'bindRoles',id,bookmarks.documents[documentRef].native_role_paths);}break;
      case 'mounted.setInteractionMode':await call(page,'mode',id,step.mode);break;
      case 'fixture.native_access':break; // immutable access selected at actual admission above
      default:throw new Error(`Uncovered browser bookmark action ${step.action}`);
    }
  }
  const expected=item.expected;
  if(expected.result){expect(last.status).toBe(expected.result.status);if(last.status==='dom_refused')expect(last.diagnostic).toMatchObject(expected.result.diagnostic);if(last.status==='completed'||last.status==='queued'){expect(last.response.status).toBe(expected.result.response.status);expect(last.response.value.effect).toBe(expected.result.response.value.effect);}if(last.status==='captured'){expect(last.frozen).toBe(true);expect(last.frozenSelection).toBe(true);expect(last.bookmark.selection).toEqual(baseline.state.selection);expect(last.bookmark.stamp).toEqual(baseline.state.stamp);expect(last.bookmark.context).toEqual(baseline.context);}}
  if(expected.restore_code)expect(last.diagnostic.code).toBe(expected.restore_code);
  if(expected.capture2_code){const capture=results.find(r=>r?.diagnostic?.code===expected.capture2_code);expect(capture).toBeTruthy();}
  if(expected.release_result!==undefined)expect(releaseResult).toBe(expected.release_result);
  if(expected.release_foreign_result!==undefined)expect(releaseResult).toBe(expected.release_foreign_result);
  if(expected.release_results)expect(results.filter(r=>typeof r==='boolean')).toEqual(expected.release_results);
  if(item.id==='BM-C09'||item.id==='BM-C10'){expect(lastCapture.immediate.after).toEqual(lastCapture.immediate.before);expect(lastCapture.immediate.eventsAfter).toBe(lastCapture.immediate.eventsBefore);points.get(page).checkpoints.push({label:'capture is pure before asynchronous UA selectionchange',...lastCapture.immediate});return;}
  if(item.id==='BM-L01'){expect(results[64].diagnostic.code).toBe('dom.selection_limit');expect(results[65]).toBe(true);expect(results[66].status).toBe('captured');expect(results[67]).toBe(false);}
  if(item.id==='BM-M10'){const restores=results.filter(r=>r.status==='dom_refused'||r.status==='completed');expect(restores[0].diagnostic.code).toBe('dom.stale_selection');expect(restores[1].response.value.effect).toBe('unchanged');}
  if(item.id==='BM-S02'){const disposed=await call(page,'dispose',id);expect(disposed.resources.selection).toEqual({bookmarks:0,restoreTickets:0,activePointers:0,animationFrames:0});return;}
  const final=await checkpoint(page,id,'final bookmark state'),ref=expected.facets?.native_state_equals_ref??expected.native_state_equals_ref??expected.result?.response?.value?.state_ref??expected.second?.native_state_equals_ref;
  if(ref)bookmarkState(final,ref,item.id);if(expected.facets?.bookmark_count!==undefined)expect(final.resources.selection.bookmarks).toBe(expected.facets.bookmark_count);if(expected.bookmark_count!==undefined)expect(final.resources.selection.bookmarks).toBe(expected.bookmark_count);
  if(item.steps.every(step=>step.action==='selection.captureBookmark'))pure(final,baseline);
  if(last?.status==='dom_refused'&&lastBeforeRestore)pure(final,lastBeforeRestore);
  if(expected.actual_provisional_text_retained)expect(final.rawDom.anchor.text).toBe(expected.actual_provisional_text_retained);
  if(expected.focus_owner)expect(final.activeElement).toBe(expected.focus_owner==='host_control'?'selection-host-control':expected.focus_owner==='editor_B'?setup.otherEditorId:id);
  if(expected.raw_dom_selection){const raw=expected.raw_dom_selection;expect(final.rawDom.anchor.text).toBe(raw.anchor_text);expect(final.rawDom.anchor.offset).toBe(raw.anchor_offset);expect(final.rawDom.focus.text).toBe(raw.focus_text);expect(final.rawDom.focus.offset).toBe(raw.focus_offset);}
  if(expected.other_mount_native_state_equals_ref){const other=await checkpoint(page,setup.otherEditorId,'other mount remains owned');bookmarkState(other,expected.other_mount_native_state_equals_ref);const raw=expected.other_mount_dom_selection;expect(other.rawDom.anchor.text).toBe(raw.anchor_text);expect(other.rawDom.anchor.offset).toBe(raw.anchor_offset);expect(other.rawDom.focus.text).toBe(raw.focus_text);expect(other.rawDom.focus.offset).toBe(raw.focus_offset);}
  for(const role of expected.old_roles_not_live??[])expect(idsAt(final).has(baseline.roles[role])).toBe(false);
  if(item.id==='BM-E05')expect(await call(page,'outsideState')).toEqual({id:'selection-host-control',start:1,end:4});
});

test('bookmark BM-FX01-H05: actual navigation seals a uniform open typing group without an undo entry',async({page})=>{
  const correction=errata['002'].data.requiredAdditionalWitness,documents=historyLiterals.documents;
  points.get(page).appliedErrata=[errata['002']];
  const {id,ready}=await call(page,'mount',{source:documents[correction.inputDocumentRef],roles:{ROOT:'',P:'/0'}});expect(ready.status).toBe('ready');
  expect(response(await call(page,'selectModel',id,correction.initialSelection)).status).toBe('ok');
  expect(response(await call(page,'command',id,{kind:'insert_text',text:'a'},correction.typingHint)).status).toBe('ok');await call(page,'bindRoles',id,{T:'/0/0'});
  const typed=await checkpoint(page,id,'preexisting H04 one open typing member');expect(typed.canonical).toBe(canonical(documents[correction.afterTypingDocumentRef]));
  const facets=p=>({revision:p.state.stamp.revision,history_epoch:p.state.stamp.history_epoch,undo_entries:p.state.history.undo_entries,redo_entries:p.state.history.redo_entries});expect(facets(typed)).toEqual(correction.afterType);
  expect((await call(page,'captureBookmark',id,'OPEN')).status).toBe('captured');const hit=await call(page,'literalHit',id,[0,0,0],0);await page.mouse.click(hit.x,hit.y);
  const expectedPoint={kind:'text',node:typed.roles.T,offset:correction.afterNavigation.selectionOffset,affinity:correction.afterNavigation.affinity};
  await expect.poll(async()=>{const current=await call(page,'inspect',id,false);return {...facets(current),selection:current.state.selection};}).toEqual({...Object.fromEntries(['revision','history_epoch','undo_entries','redo_entries'].map(k=>[k,correction.afterNavigation[k]])),selection:{anchor:expectedPoint,focus:expectedPoint}});
  const navigated=await checkpoint(page,id,'preexisting H05 actual navigation barrier');expect(navigated.canonical).toBe(typed.canonical);expect(navigated.rows.map(r=>r.node.id)).toEqual(typed.rows.map(r=>r.node.id));expect(navigated.state.dirty).toBe(typed.state.dirty);expect(navigated.state.stored_marks).toBeNull();
  const publications=navigated.events.slice(typed.events.length);expect(publications.filter(e=>e.change.kind==='state')).toHaveLength(correction.afterNavigation.newStateEvents);expect(publications.filter(e=>e.change.kind==='document')).toHaveLength(correction.afterNavigation.newDocumentEvents);
  expect((await call(page,'restoreBookmark',id,'OPEN')).diagnostic.code).toBe('dom.stale_selection');pure(await checkpoint(page,id,'old open-group bookmark refuses after newer pointer intent'),navigated);
  expect(response(await call(page,'command',id,{kind:'insert_text',text:'b'},correction.typingHint)).status).toBe('ok');await call(page,'bindRoles',id,{V:'/0/0'});
  const second=await checkpoint(page,id,'same token starts a second undo unit');expect(second.canonical).toBe(canonical(documents[correction.afterNextTypingDocumentRef]));expect(facets(second)).toEqual(correction.afterNextType);expect(second.state.selection).toEqual(selection(second.roles,{anchor:{kind:'text',node:'V',offset:1,affinity:'after'},focus:{kind:'text',node:'V',offset:1,affinity:'after'}}));
  expect(response(await call(page,'history',id,'undo')).status).toBe('ok');const once=await checkpoint(page,id,'H05 undo second unit');expect(once.canonical).toBe(typed.canonical);expect(row(once,'/0/0').id).toBe(typed.roles.T);expect(once.state.selection).toEqual({anchor:expectedPoint,focus:expectedPoint});expect(once.state.history.undo_entries).toBe('1');expect(once.state.history.redo_entries).toBe('1');
  expect(response(await call(page,'history',id,'undo')).status).toBe('ok');const twice=await checkpoint(page,id,'H05 undo first unit');expect(twice.canonical).toBe(canonical(documents[correction.inputDocumentRef]));expect(row(twice,'/0').id).toBe(typed.roles.P);expect(twice.state.history.undo_entries).toBe('0');expect(twice.state.history.redo_entries).toBe('2');
});

// Unsupported navigator writer, equal-pointer-intent and injected native
// refused/fatal/queued cases have their explicit platform/SDK unit witnesses.
// This lane does not manufacture native completion packets to inflate coverage.
const clipboardUnitBoundaryIds=new Set(['CP12','CP14','CP19','CP20','CP21','CP22']);
for(const item of clipboard.cases.filter(c=>!clipboardUnitBoundaryIds.has(c.id)))test(`clipboard ${item.id}: ${item.stimulus}`,async({page})=>{
  const sourceId=item.id==='CP02'||item.id==='CP04'?'L3-reverse':item.id==='CP05'?'L5-scene-break-only':item.id==='CP06'||item.id==='CP07'?'L6-copy-base-interior-egc':item.id==='CP08'?'L7-half-surrogate-set-selection-refused':'L3-forward';
  const literal=native.cases.find(c=>c.id===sourceId),readOnly=['CP09','CP10'].includes(item.id);
  const config={source:literal.input.document,roles:literal.input.identity_roles,access:readOnly?'read_only':'editable',mode:readOnly||item.id==='CP27'?'readOnly':undefined,writer:item.id==='CP11'?'reject':['CP13','CP15','CP16','CP17','CP24','CP25'].includes(item.id)?'pending':'resolve',throwResult:item.id==='CP23'};
  const {id,ready}=await call(page,'mount',config);expect(ready.status).toBe('ready');if(literal.input.selection)await call(page,'selectModel',id,literal.input.selection);
  const before=await checkpoint(page,id,'clipboard before');let finished,comparison=before;
  const action=['CP01','CP02','CP06','CP08','CP09'].includes(item.id)?'copy':'cut';
  if(['CP13','CP15','CP16','CP17','CP24','CP25'].includes(item.id)){
    const operation=item.id==='CP24'?'FIRST':'operation';await call(page,'startClipboard',id,item.id==='CP24'?'copy':action,operation);
    await expect.poll(async()=>(await call(page,'clipboardState',id)).writes.length).toBe(1);
    if(item.id==='CP13'){await call(page,'selectModel',id,{anchor:{kind:'text',node:'L',offset:0,affinity:'after'},focus:{kind:'text',node:'L',offset:0,affinity:'after'}});comparison=await checkpoint(page,id,'new target while writer pending');}
    if(item.id==='CP15'){expect(response(await call(page,'command',id,{kind:'toggle_mark',mark:{type_id:'org.klenwriter.kwdj/strong',attributes:{}}})).status).toBe('ok');comparison=await checkpoint(page,id,'intervening document update');}
    if(item.id==='CP16'){await call(page,'replace',id,bookmarks.documents.other.wire);comparison=await checkpoint(page,id,'replacement cancels owned writer continuation');}
    if(item.id==='CP24'){
      await call(page,'startClipboard',id,'cut','SECOND');finished=await call(page,'clipboardResult',id,'SECOND');expect(finished.resources.clipboard).toEqual(item.resourceEnd);expect(finished.writes).toHaveLength(1);expect(finished.writes[0].text).toBe(literal.projection.expected.value.text);
      await call(page,'settleWriter',id,true);const first=await call(page,'clipboardResult',id,'FIRST');expect(first.result.status).toBe('copied');expect(first.resources.clipboard).toEqual(item.afterFirstCompletesOrCancels);
    } else if(item.id==='CP25'){
      const disposed=await call(page,'dispose',id);finished=await call(page,'clipboardResult',id);expect(disposed.native).toEqual({sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});
      const callbacks=finished.results.length;await call(page,'settleWriter',id,true);await page.waitForTimeout(50);expect((await call(page,'clipboardState',id)).results).toHaveLength(callbacks);
    } else {
      if(item.id!=='CP16'&&item.id!=='CP17')await call(page,'settleWriter',id,true);
      finished=await call(page,'clipboardResult',id);
    }
  } else if(item.id==='CP18')finished=await call(page,'clipboardAtPublication',id);
  else {
    if(item.id==='CP26'){
      const path=literal.input.identity_roles.L,node=authoredNode(literal.input.document,path);await call(page,'beginProvisional',id,'controlled provisional text',[...path,...Array((node.marks?.length??0)+1).fill(0)]);
    }
    if(item.id==='CP28')await call(page,'outsideFocus');
    finished=await call(page,'clipboard',id,action);
  }
  expect(finished.result.action).toBe(action);expect(finished.result.status).toBe(item.expected.status);expect(finished.result.clipboard).toBe(item.expected.clipboard);
  if(item.expected.failure===null)expect(finished.result.failure).toBeNull();else if(item.expected.failure.startsWith('dom.'))expect(finished.result.failure.diagnostic.code).toBe(item.expected.failure);else expect(finished.result.failure.status).toBe('native_unavailable');
  if(item.id!=='CP24')expect(finished.resources.clipboard).toEqual(item.resourceEnd);
  if(item.writer==='not_called'&&item.id!=='CP24')expect(finished.writes).toEqual([]);else {expect(finished.writes).toHaveLength(1);expect(finished.writes[0].text).toBe(literal.projection.expected.value.text);}
  points.get(page).checkpoints.push({label:'controlled host platform outcome; no OS ACK claimed',...finished});
  if(item.id==='CP25')return;
  const after=await checkpoint(page,id,'clipboard after');
  if(item.expected.changedByThisCut){expect(after.canonical).toBe(literal.after.canonical_json);expect(after.state.stamp.revision).toBe('1');expect(after.state.history.undo_entries).toBe('1');expect(response(await call(page,'history',id,'undo')).status).toBe('ok');expect((await checkpoint(page,id,'clipboard undo')).canonical).toBe(literal.input.canonical_json);}
  else if(item.id!=='CP18')pure(after,comparison);
  if(item.id==='CP28')expect(await call(page,'outsideState')).toEqual({id:'selection-host-control',start:1,end:4});
});

function nearBox(actual,expected){for(const key of ['left','top','right','bottom'])expect(Math.abs(actual[key]-expected[key]),`fixed fixture ${key}`).toBeLessThanOrEqual(.5);}
function caretVisible(value){const c=value.caret,clip=value.effectiveClip;expect(c,'actual positive-height focus caret').not.toBeNull();expect(c.height).toBeGreaterThan(0);for(const key of ['left','right','top','bottom'])expect(Number.isFinite(c[key])).toBe(true);expect(c.left).toBeGreaterThanOrEqual(clip.left-.5);expect(c.right).toBeLessThanOrEqual(clip.right+.5);expect(c.top).toBeGreaterThanOrEqual(clip.top-.5);expect(c.bottom).toBeLessThanOrEqual(clip.bottom+.5);}
function scrollRoles(){return Object.fromEntries([...scroll.structuralRoles.map(r=>[r.role,r.modelPath]),...scroll.modelRowRoles.flatMap(r=>[[r.blockRole,r.modelBlockPath],...(r.textRole?[[r.textRole,r.modelTextPath]]:[])])]);}
for(const item of scroll.controlledCoreCases)test(`scroll ${item.id}: literal anchor/terminal, held progress and active stop`,async({page})=>{
  const {id,ready}=await call(page,'mount',{source:scroll.fixture.modelDocument,roles:scrollRoles(),scroll:item.geometry});expect(ready.status).toBe('ready');
  const prepared=await call(page,'prepareScroll',id,item.direction);expect(prepared.font.status).toBe('loaded');expect(prepared.font.family.replace(/^['"]|['"]$/g,'')).toBe('OSR40FixtureMono');
  const mode=scroll.geometryModes[item.geometry];nearBox(prepared.geometry.client,mode.scrollportClient);nearBox(prepared.geometry.effectiveClip,mode.effectiveClip);expect(prepared.geometry.clientWidth).toBe(640);expect(prepared.geometry.clientHeight).toBe(240);expect(prepared.geometry.scrollHeight).toBe(1596);expect(prepared.geometry.scrollTop).toBe(item.initialScrollTop);
  for(const actual of prepared.domRows){const literal=scroll.rowGeometry.find(row=>row.row===actual.row);nearBox(actual.box,item.initialScrollTop===0?literal.blockBoxAtScroll0:literal.blockBoxAtScrollMax1356);if(actual.text)expect(Math.abs(actual.text.width-28.8)).toBeLessThanOrEqual(.5);}
  const before=await checkpoint(page,id,'font and exact geometry admitted');expect(before.canonical).toBe(scroll.fixture.independentlySerializedExpectedCanonical);
  const expectedAnchor=point(before.roles,item.anchorInvariant),expectedTerminal=point(before.roles,scroll.endpointTables[item.direction].terminalFocus);
  await page.mouse.move(item.pointerDownCss.x,item.pointerDownCss.y);const heldStart=Date.now();await page.mouse.down();let mouseHeld=true,stabilityAsserted=false;
  try {
    await expect.poll(async()=>{const value=await call(page,'geometry',id);return value.state.selection;}).toEqual({anchor:expectedAnchor,focus:expectedAnchor});
    const anchor=await call(page,'startScrollTrace',id);caretVisible(anchor);expect(anchor.rawDom.anchor.path).toEqual(item.rawDomAnchorInvariant.hostChildNodesPath);expect(anchor.rawDom.anchor.offset).toBe(item.rawDomAnchorInvariant.offset);
    const start=Date.now();await page.mouse.move(item.stationaryHeldCss.x,item.stationaryHeldCss.y);
    let previous=item.initialScrollTop,advances=0,stopped=null;
    while(Date.now()-heldStart<7900){
      await page.waitForTimeout(100);const sample=await call(page,'sampleScroll',id);
      expect(sample.state.selection.anchor).toEqual(expectedAnchor);expect(sample.rawDom.inside).toBe(true);
      expect(sample.allScrollOwners.windowX).toBe(0);expect(sample.allScrollOwners.windowY).toBe(0);expect(sample.allScrollOwners.clipTop).toBe(0);expect(sample.allScrollOwners.clipLeft).toBe(0);
      const delta=sample.scrollTop-previous;if(item.direction==='down')expect(delta).toBeGreaterThanOrEqual(0);else expect(delta).toBeLessThanOrEqual(0);if(delta!==0)advances++;previous=sample.scrollTop;
      const rangeRemaining=item.direction==='down'?sample.scrollTop<1356:sample.scrollTop>0;
      if(item.ending==='terminal_release' && JSON.stringify(sample.state.selection.focus)===JSON.stringify(expectedTerminal)){caretVisible(sample);stopped=sample;break;}
      if(item.ending!=='terminal_release' && advances>=2 && rangeRemaining){caretVisible(sample);stopped=sample;break;}
    }
    const heldMs=Date.now()-heldStart,stationaryHeldMs=Date.now()-start;
    expect(stopped,'required literal terminal or active window within finite hold').not.toBeNull();expect(advances).toBeGreaterThanOrEqual(2);expect(heldMs).toBeLessThanOrEqual(8000);
    if(item.ending==='active_cancel')points.get(page).controlledCancel=await call(page,'cancelControlledPointer',id);
    else {await page.mouse.up();mouseHeld=false;}
    const frame=await page.evaluate(()=>new Promise(resolve=>{const start=performance.now();requestAnimationFrame(()=>resolve(performance.now()-start));}));expect(frame).toBeLessThanOrEqual(100);
    const stable=[];
    for(let i=0;i<5;i++){
      await page.waitForTimeout(100);const sample=await call(page,'sampleScroll',id);caretVisible(sample);expect(sample.state.selection.anchor).toEqual(expectedAnchor);
      expect(sample.resources.selection.activePointers).toBe(0);expect(sample.resources.selection.animationFrames).toBe(0);
      if(item.ending==='terminal_release')expect(sample.state.selection.focus).toEqual(expectedTerminal);
      if(i){expect(sample.state).toEqual(stable[0].state);expect(sample.rawDom).toEqual(stable[0].rawDom);expect(sample.allScrollOwners).toEqual(stable[0].allScrollOwners);}
      stable.push(sample);
    }
    stabilityAsserted=true;
    // For the synthetic controlled cancel, the physical/protocol mouse is still
    // held during ALL stability assertions. Its cleanup cannot cause their stop.
    if(mouseHeld){points.get(page).mouseCleanup={afterStabilityAssertions:true,provenance:'Protocol mouseup cleanup after controlled synthetic cancellation; not the cancellation stimulus'};await page.mouse.up();mouseHeld=false;}
    const trace=await call(page,'actionTrace',id);points.get(page).scroll={caseId:item.id,prepared,heldMs,stationaryHeldMs,advances,stopped,stable,...trace};expect(trace.overflow).toBe(false);
    for(const row of trace.trace.filter(row=>row.type==='publication')){
      const sample=row.geometry;expect(sample.state.selection.anchor).toEqual(expectedAnchor);caretVisible(sample);
      if(sample.monotonicFromPrevious!==null){if(item.direction==='down')expect(sample.monotonicFromPrevious).toBeLessThanOrEqual(0);else expect(sample.monotonicFromPrevious).toBeGreaterThanOrEqual(0);}
    }
    const after=await checkpoint(page,id,'after held gesture and explicit stop');expect(after.canonical).toBe(before.canonical);expect(after.rows.map(r=>r.node.id)).toEqual(before.rows.map(r=>r.node.id));expect(after.state.stamp.revision).toBe('0');expect(after.state.dirty).toBe(false);expect(after.state.history.undo_entries).toBe('0');expect(after.state.history.redo_entries).toBe('0');
  } finally {
    if(mouseHeld){points.get(page).mouseCleanup={afterStabilityAssertions:stabilityAsserted,provenance:'Failed-case protocol mouseup cleanup; never acceptance evidence'};await page.mouse.up();}
    if(!points.get(page).scroll)points.get(page).scrollFailureTrace=await call(page,'actionTrace',id);
  }
});

test('owned Select All includes all 57 root children once; external control remains native',async({page})=>{
  const {id}=await call(page,'mount',{source:scroll.fixture.modelDocument,roles:scrollRoles()});const initial=await checkpoint(page,id,'before Select All');
  await page.locator(`#${id}`).focus();await page.keyboard.press(process.platform==='darwin'?'Meta+A':'Control+A');
  await expect.poll(async()=>{const p=await call(page,'inspect',id,false);return p.state.selection;}).toEqual({anchor:{kind:'child',parent:initial.roles.root,index:0,affinity:'after'},focus:{kind:'child',parent:initial.roles.root,index:57,affinity:'after'}});
  const all=await checkpoint(page,id,'owned Select All'),projection=await call(page,'read',id,{kind:'selection_text',max_bytes:1048576});expect(projection.value.selected_atoms).toEqual([all.roles['R16.block']]);expect(all.canonical).toBe(initial.canonical);
  await call(page,'outsideFocus');await page.keyboard.press(process.platform==='darwin'?'Meta+A':'Control+A');expect(await call(page,'outsideState')).toEqual({id:'selection-host-control',start:0,end:7});const outside=await checkpoint(page,id,'external control Select All');pure(outside,all);
});

for(const locale of ['en','ru'])test(`minimal selection UX ${locale}: named host, persistent polite stale status`,async({page})=>{
  const {id}=await bookmarkSetup(page,'BASE',{locale});expect((await call(page,'captureBookmark',id,'B')).status).toBe('captured');
  await call(page,'submit',id,{kind:'set_selection',selection:bookmarks.states.BASE.selection});expect((await call(page,'restoreBookmark',id,'B')).diagnostic.code).toBe('dom.stale_selection');
  await expect(page.getByRole('textbox',{name:/Selection editor/})).toBeVisible();const status=page.locator('#selection-status');await expect(status).toHaveText(locale==='ru'?unicode.ux.staleRu:unicode.ux.staleEn);await expect(status).toHaveAttribute('aria-live','polite');
  const expectedText=await status.textContent();await page.keyboard.press('ArrowRight');await expect(status).toHaveText(expectedText);
  const result=await new AxeBuilder({page}).include(`#${id}`).analyze();expect(result.violations).toEqual([]);expect(result.incomplete).toEqual([]);points.get(page).axe={engine:result.testEngine,violations:result.violations,incomplete:result.incomplete,scope:'Static selection host semantics only, not real AT acceptance'};
});
