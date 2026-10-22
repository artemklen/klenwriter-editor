// SPDX-License-Identifier: MIT OR Apache-2.0
// Source-authored three-engine measurements. Controlled sources/writers are not OS delivery.
import {test,expect} from '@playwright/test';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
const corpus=['positive','negative'].flatMap(name=>JSON.parse(readFileSync(`contracts/kwdj/v1/fixtures/${name}.json`,'utf8')).fixtures)
  .filter(f=>/^DOC-0(?:2[89]|3[0-4])$/.test(f.id));
const call=(page,method,...args)=>page.evaluate(({method,args})=>window.clipboardHost[method](...args),{method,args});
const p=text=>({type:'paragraph',content:text===''?[]:[{type:'text',text}]});
const doc=content=>({schema:'klenwriter.document',schema_version:1,profile:'prose',content});
const text=(path,offset)=>({kind:'text',path,offset,affinity:'after'});
const dom=(path,offset)=>({path,offset});
const plainSelection={anchor:text([0,0],1),focus:text([1,0],2)};
const plainDom={anchor:dom([0,0,0],1),focus:dom([1,0,0],2)};
const richSource=doc([{type:'paragraph',content:[{type:'text',text:'a'},{type:'text',text:'bc',marks:[{type:'strong'}]}]},
  {type:'paragraph',content:[{type:'text',text:'de',marks:[{type:'link',attrs:{href:'/owned'}}]},{type:'hard_break'},{type:'text',text:'f'}]}]);
const richSelection={anchor:text([0,1],0),focus:text([1,2],0)};
const richDom={anchor:dom([0,1,0,0],0),focus:dom([1,2,0],0)};
const measurements=new WeakMap();
const canonical=point=>JSON.parse(point.canonical);
const published=point=>point.events.filter(e=>e.change.kind==='document');
async function checkpoint(page,id,label){const value=await call(page,'inspect',id);measurements.get(page).checkpoints.push({label,...value});return value;}
function pure(after,before){expect(after.state).toEqual(before.state);expect(after.rows).toEqual(before.rows);expect(after.canonical).toBe(before.canonical);expect(after.events).toEqual(before.events);expect(after.dom).toBe(before.dom);}
const response=result=>{expect(['completed','queued']).toContain(result.status);return result.response;};
test.beforeEach(async({page},info)=>{
  const value={engine:info.project.name,tier:info.project.name==='firefox'?'experimental behavior; integrity required':'required',installed:false,
    provenance:'Actual delivered packaged SDK2/sealed WASM; controlled DataTransfer-like strings and host writer; not OS clipboard ACK',errors:[],requests:[],unexpectedRequests:[],dialogs:[],checkpoints:[]};measurements.set(page,value);
  page.on('pageerror',error=>value.errors.push(error.message));page.on('dialog',dialog=>{value.dialogs.push(dialog.type());void dialog.dismiss();});
  const allowed=url=>{const u=new URL(url);return u.origin==='http://127.0.0.1:4174'&&(u.pathname==='/clipboard'||u.pathname==='/clipboard-host.js'||u.pathname==='/clipboard.css'||u.pathname==='/style.css'||u.pathname==='/extensions-packet.json'||u.pathname==='/favicon.ico'||u.pathname.startsWith('/packages/')||u.pathname.startsWith('/snippets/')||u.pathname==='/clipboard-contract/positive.json'||u.pathname==='/clipboard-contract/negative.json');};
  await page.route('**/*',route=>{const url=route.request().url();value.requests.push(url);if(allowed(url))return route.continue();value.unexpectedRequests.push(url);return route.abort();});
  await page.addInitScript(()=>{window.clipboardStartupErrors=[];window.clipboardViolations=[];window.__clipboardUnexpectedExecution=0;
    window.addEventListener('error',e=>window.clipboardStartupErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.clipboardStartupErrors.push(String(e.reason?.message??e.reason)));
    document.addEventListener('securitypolicyviolation',e=>window.clipboardViolations.push({directive:e.violatedDirective,blocked:e.blockedURI}));});
  const loaded=await page.goto('/clipboard');value.csp=loaded.headers()['content-security-policy'];
  expect(value.csp).toContain("default-src 'none'");expect(value.csp).toContain("'wasm-unsafe-eval'");expect(value.csp).not.toContain("'unsafe-inline'");expect(value.csp).not.toMatch(/(?:^|\s)'unsafe-eval'/);
  await page.waitForFunction(()=>window.clipboardHostReady===true||window.clipboardStartupErrors.length>0,undefined,{timeout:15000});
  expect(await page.evaluate(()=>window.clipboardStartupErrors)).toEqual([]);value.metadata=await call(page,'metadata');
});
test.afterEach(async({page},info)=>{
  const value=measurements.get(page);if(!value)return;
  try{
    value.disposal=await call(page,'allDisposed');expect(value.disposal.native).toEqual({sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});
    for(const item of value.disposal.readbacks){const resources=item.resources,sdk=resources.sdk??resources;
      for(const [key,count] of Object.entries(sdk))if(typeof count==='number')expect(count,key).toBe(0);
      expect(sdk.lifecycle).toBe('destroyed');
      if(resources.dom){expect(resources.dom.listeners).toBe(0);expect(resources.dom.observers).toBe(0);expect(resources.dom.continuations).toBe(0);
        for(const count of Object.values(resources.selection))expect(count).toBe(0);for(const count of Object.values(resources.clipboard))expect(count).toBe(0);
        expect(resources.dom.retainedInputBytes).toBe(0);expect(resources.dom.retainedRecoveryRegions).toBe(0);
        for(const name of ['hostRequests','inputObservations','popupPresentation'])for(const count of Object.values(resources[name]))expect(count,name).toBe(0);}
    }
    value.cspViolations=await page.evaluate(()=>window.clipboardViolations);expect(value.cspViolations).toEqual([]);expect(value.errors).toEqual([]);expect(value.dialogs).toEqual([]);expect(value.unexpectedRequests).toEqual([]);expect(await page.evaluate(()=>window.clipboardStartupErrors)).toEqual([]);
  }finally{value.status=info.status;mkdirSync('artifacts/clipboard',{recursive:true});const path=`artifacts/clipboard/${info.project.name}-${info.testId.replaceAll(/[^A-Za-z0-9_-]/g,'_')}.json`;writeFileSync(path,JSON.stringify(value,null,2)+'\n');await info.attach('clipboard-observations',{path,contentType:'application/json'});}
});

for(const direction of ['forward','reverse'])test(`CB01 ${direction}: fresh exact cross-block replacement, one Undo, save/reopen`,async({page},info)=>{
  const {id}=await call(page,'mount');const selection=direction==='forward'?plainSelection:{anchor:plainSelection.focus,focus:plainSelection.anchor};const literal=direction==='forward'?plainDom:{anchor:plainDom.focus,focus:plainDom.anchor};
  const selected=await call(page,'select',id,selection,literal);expect(selected.raw.inside).toBe(true);expect(selected.raw.anchor.offset).toBe(literal.anchor.offset);expect(selected.raw.focus.offset).toBe(literal.focus.offset);
  expect(selected.raw.anchor.text).toBe(direction==='forward'?'abc':'def');expect(selected.raw.focus.text).toBe(direction==='forward'?'def':'abc');
  const before=await checkpoint(page,id,'actual directed native/DOM selection before fresh source');expect(before.state.selection).toEqual(selected.native);expect(before.projection.value.text).toBe('bc\nde');
  const marker=`CP47-${info.project.name}-${randomUUID()}`;measurements.get(page).freshMarker=marker;
  const result=await call(page,'paste',id,{'text/plain':marker});expect(result.status).toBe('inserted');expect(result.diagnostics).toEqual([]);expect(result.submission.status).toBe('completed');
  const after=await checkpoint(page,id,'native exact replacement');expect(canonical(after)).toEqual(doc([p('a'+marker+'f')]));expect(after.state.history.undo_entries).toBe('1');expect(published(after).length-published(before).length).toBe(1);expect(after.sourceReads.at(-1).calls).toEqual(['text/plain']);
  const reopened=await call(page,'mount',{source:after.canonical});const readback=await checkpoint(page,reopened.id,'save/reopen independent mount');expect(readback.canonical).toBe(after.canonical);expect(readback.state.history.undo_entries).toBe('0');
  expect(response(await call(page,'history',id,'undo')).status).toBe('ok');const undone=await checkpoint(page,id,'one Undo restores source and native directed range');expect(undone.canonical).toBe(before.canonical);expect(undone.state.selection).toEqual(before.state.selection);expect(undone.state.history.undo_entries).toBe('0');expect(undone.state.history.redo_entries).toBe('1');
});

test('CB02 rich copy over the selected range preserves marks, link, hard break and block edges',async({page})=>{
  const {id}=await call(page,'mount',{source:richSource});await call(page,'select',id,richSelection,richDom);const before=await checkpoint(page,id,'rich selected source');expect(before.projection.value.text).toBe('bc\nde\n');
  const copied=await call(page,'copy',id);expect(copied.status).toBe('copied');expect(copied.clipboard).toBe('confirmed');
  const afterCopy=await checkpoint(page,id,'controlled writer confirmed copy; no native edit');expect(afterCopy.canonical).toBe(before.canonical);expect(afterCopy.state.history).toEqual(before.state.history);
  const payload=afterCopy.writes.at(-1).payload;expect(payload).toEqual({text:'bc\nde\n',html:'<p><strong>bc</strong></p><p><a href="/owned">de</a><br></p>'});
  expect((await call(page,'paste',id,{'text/plain':payload.text,'text/html':payload.html})).status).toBe('inserted');
  const after=await checkpoint(page,id,'rich same-selection roundtrip');expect(canonical(after)).toEqual(richSource);expect(after.state.history.undo_entries).toBe('1');expect(published(after).length-published(before).length).toBe(1);
  expect(response(await call(page,'history',id,'undo')).status).toBe('ok');expect(canonical(await checkpoint(page,id,'rich Undo'))).toEqual(richSource);
});

test('CB03 cut waits for explicit controlled write ACK; paste reconstructs open block structure',async({page})=>{
  const {id}=await call(page,'mount',{source:richSource,writer:'pending'});await call(page,'select',id,richSelection,richDom);const before=await checkpoint(page,id,'before controlled pending cut');
  expect((await call(page,'startCopy',id,'cut')).writers).toBe(1);const pending=await checkpoint(page,id,'no deletion before writer settles');expect(pending.canonical).toBe(before.canonical);expect(pending.state.history.undo_entries).toBe('0');expect(published(pending)).toEqual(published(before));
  await call(page,'settleWriter',id,true);const cut=await call(page,'finish',id);expect(cut.status).toBe('cut');expect(cut.clipboard).toBe('confirmed');
  const deleted=await checkpoint(page,id,'cut native exact effect');expect(canonical(deleted)).toEqual(doc([p('af')]));expect(deleted.state.history.undo_entries).toBe('1');
  const caret={anchor:text([0,0],1),focus:text([0,0],1)},literal={anchor:dom([0,0,0],1),focus:dom([0,0,0],1)};await call(page,'select',id,caret,literal);
  const payload=deleted.writes.at(-1).payload;expect((await call(page,'paste',id,{'text/plain':payload.text,'text/html':payload.html})).status).toBe('inserted');const after=await checkpoint(page,id,'paste independently restores native structure');expect(canonical(after)).toEqual(richSource);expect(after.state.history.undo_entries).toBe('2');
  expect(response(await call(page,'history',id,'undo')).status).toBe('ok');expect(canonical(await checkpoint(page,id,'one Undo removes only paste'))).toEqual(doc([p('af')]));
  expect(response(await call(page,'history',id,'undo')).status).toBe('ok');expect(canonical(await checkpoint(page,id,'second Undo restores cut'))).toEqual(richSource);
});

test('CB04 writer rejection preserves exact source and history',async({page})=>{
  const {id}=await call(page,'mount',{writer:'reject'});await call(page,'select',id,plainSelection,plainDom);const before=await checkpoint(page,id,'before refused writer');const cut=await call(page,'copy',id,'cut');expect(cut.status).toBe('write_failed');expect(cut.clipboard).toBe('unconfirmed');pure(await checkpoint(page,id,'writer failure unchanged'),before);
});

test('CB05 parser refusal retains both original strings and blocks a new paste until explicit transfer',async({page})=>{
  const {id}=await call(page,'mount');await call(page,'select',id,plainSelection,plainDom);const before=await checkpoint(page,id,'before media branch');
  const plain='independent e\u0301\r\nplain',html='<p>prefix</p><img src="https://example.test/clipboard-resource">';
  const result=await call(page,'paste',id,{'text/plain':plain,'text/html':html});expect(result.status).toBe('refused');expect(result.diagnostics).toEqual(['clipboard.media_item_forbidden','clipboard.remote_image_forbidden']);expect(result.recovery).toBe('retained');pure(await checkpoint(page,id,'codec refusal without native publication'),before);
  const second=await call(page,'paste',id,{'text/plain':'must not replace retained source'});expect(second.failure.diagnostic.code).toBe('dom.clipboard_recovery_pending');
  const raw=await call(page,'takeRecovery',id);expect(raw.capture.representations['text/plain'].text).toBe(plain);expect(raw.capture.representations['text/html'].text).toBe(html);expect(raw.capture.retainedUtf16Units).toBe(plain.length+html.length);expect(await call(page,'takeRecovery',id)).toBeNull();
  const reads=(await checkpoint(page,id,'after explicit raw transfer')).sourceReads;expect(reads).toHaveLength(2);expect(reads[1].calls).toEqual([]);
});

test('CB06 oversize is a truthful incomplete raw receipt, never a prefix or silent fallback',async({page})=>{
  const {id}=await call(page,'mount');await call(page,'select',id,plainSelection,plainDom);const before=await checkpoint(page,id,'before source cap');const result=await call(page,'paste',id,{'text/plain':'x'.repeat(524289),'text/html':'<p>must remain unread</p>'});expect(result.status).toBe('refused');
  pure(await checkpoint(page,id,'oversize refusal'),before);const recovery=await call(page,'takeRecovery',id);expect(recovery.capture.reason).toBe('representation_limit');expect(recovery.capture.representations['text/plain']).toEqual({status:'oversize_not_retained',availability:'declared',readAttempted:true,text:null,utf16Units:524289});expect(recovery.capture.representations['text/html'].status).toBe('unread_due_limit');expect(recovery.capture.retainedUtf16Units).toBe(0);expect((await checkpoint(page,id,'oversize transferred metadata')).sourceReads.at(-1).calls).toEqual(['text/plain']);
});

test('CB07 invalid scalar raw source is retained exactly without replacement characters',async({page})=>{
  const {id}=await call(page,'mount');await call(page,'select',id,plainSelection,plainDom);const before=await checkpoint(page,id,'before non-scalar string');const result=await call(page,'paste',id,{'text/plain':'\ud800'});expect(result.status).toBe('refused');expect(result.diagnostics).toEqual(['clipboard.invalid_input']);pure(await checkpoint(page,id,'invalid scalar unchanged'),before);const recovery=await call(page,'takeRecovery',id);expect(recovery.capture.representations['text/plain'].text).toBe('\ud800');expect(recovery.capture.retainedUtf16Units).toBe(1);
});

test('CB08 original target stamp survives async decode; stale selection refuses without replay',async({page})=>{
  const {id}=await call(page,'mount',{decode:'deferred'});await call(page,'select',id,plainSelection,plainDom);const raw='fresh pending '+randomUUID();const started=await call(page,'startPaste',id,{'text/plain':raw});expect(started.reads).toEqual([['text/plain']]);
  await page.waitForFunction(id=>window.clipboardHost.asyncState(id).deferred,id);await call(page,'select',id,{anchor:text([0,0],0),focus:text([0,0],0)},{anchor:dom([0,0,0],0),focus:dom([0,0,0],0)});const before=await checkpoint(page,id,'newer actual selection while old decode pending');
  await call(page,'resolveDecode',id);const result=await call(page,'finish',id);expect(result.status).toBe('refused');expect(result.failure.diagnostic.code).toBe('dom.stale_selection');pure(await checkpoint(page,id,'stale async refusal'),before);expect((await call(page,'takeRecovery',id)).capture.representations['text/plain'].text).toBe(raw);
});

test('CB09 foreign profile candidate is native refusal with the original raw input retained',async({page})=>{
  const {id}=await call(page,'mount',{decode:'foreign-profile'});await call(page,'select',id,plainSelection,plainDom);const before=await checkpoint(page,id,'before controlled foreign semantic candidate');const raw='foreign target '+randomUUID();const result=await call(page,'paste',id,{'text/plain':raw});expect(result.status).toBe('refused');expect(result.failure.status).toBe('native_unavailable');expect(result.failure.response.value.diagnostic.code).toBe('kwdj.invalid_envelope');pure(await checkpoint(page,id,'actual native profile boundary refusal'),before);expect((await call(page,'takeRecovery',id)).capture.representations['text/plain'].text).toBe(raw);
});

test('CB10 destroy transfers pending raw and suppresses late decoder publication',async({page})=>{
  const {id}=await call(page,'mount',{decode:'deferred'});await call(page,'select',id,plainSelection,plainDom);const raw='retained across destroy '+randomUUID();await call(page,'startPaste',id,{'text/plain':raw});await page.waitForFunction(id=>window.clipboardHost.asyncState(id).deferred,id);
  const destroyed=await call(page,'destroy',id);expect(destroyed.transferStatus).toBe('pending');expect(destroyed.resources.clipboard.retiredParsers).toBe(1);await call(page,'resolveDecode',id);const outcome=await call(page,'finish',id);expect(outcome.status).toBe('refused');expect(outcome.failure.diagnostic.code).toBe('dom.disposed');const final=await call(page,'dispose',id);expect(final.clipboardTransfer.capture.representations['text/plain'].text).toBe(raw);expect(final.resources.clipboard.retainedUtf16Units).toBe(0);
});

test('CB11 observer exception cannot rewrite successful native publication',async({page})=>{
  const {id}=await call(page,'mount',{throwResult:true});await call(page,'select',id,plainSelection,plainDom);const result=await call(page,'paste',id,{'text/plain':'observed'});expect(result.status).toBe('inserted');const after=await checkpoint(page,id,'receipt survives observer throw');expect(canonical(after)).toEqual(doc([p('aobservedf')]));expect(after.state.history.undo_entries).toBe('1');
});

test('CB12 literal decomposed code points stay exact; NFC equivalence is a separate observation',async({page})=>{
  const {id}=await call(page,'mount',{source:doc([p('old')])});await call(page,'select',id,{anchor:{kind:'child',path:[],index:0},focus:{kind:'child',path:[],index:1}},{anchor:dom([],0),focus:dom([],1)});
  const result=await call(page,'paste',id,{'text/plain':'e\u0301\r\n\u00a0Я😀'});expect(result.status).toBe('inserted');const after=await checkpoint(page,id,'code points and explicit external CRLF conversion');expect(canonical(after)).toEqual(doc([{type:'paragraph',content:[{type:'text',text:'e\u0301'},{type:'hard_break'},{type:'text',text:'\u00a0Я😀'}]}]));
  const first=canonical(after).content[0].content[0].text;expect([...first].map(c=>c.codePointAt(0))).toEqual([0x65,0x301]);measurements.get(page).unicode={exactDecomposed:first==='e\u0301',equalPrecomposed:first==='é',nfcEquivalent:first.normalize('NFC')==='é',OSClipboard:'not_observed'};expect(measurements.get(page).unicode).toEqual({exactDecomposed:true,equalPrecomposed:false,nfcEquivalent:true,OSClipboard:'not_observed'});
});

for(const fixture of corpus)test(`CB13 ${fixture.id}: conversion diagnostics and actual packaged WASM owner`,async({page})=>{
  const c=fixture.cases[0],stage=await call(page,'corpusStage',fixture.id);measurements.get(page).corpusStage=stage;expect(stage.decoded.diagnostics).toEqual(c.expected.diagnostic_codes);expect(stage.sourceInput).toEqual(c.input);
  expect(stage.nativeContext.format_id).toBe('org.klenwriter.kwdj/clipboard-context/1');expect(JSON.parse(stage.nativeContext.context_json).mode).toBe(c.input.profile);
  if(c.expected.outcome==='accepted'){
    expect(stage.decoded.status).toBe('candidate');expect(stage.decoded.fragment.content).toEqual(c.kwdj.content);expect(response(stage.applied).status).toBe('ok');expect(canonical(stage.after)).toEqual(c.kwdj);expect(stage.after.state.history.undo_entries).toBe('1');expect(published(stage.after).length-published(stage.before).length).toBe(1);expect(stage.reopened.canonical).toBe(stage.after.canonical);expect(stage.undone.canonical).toBe(stage.before.canonical);expect(stage.undone.state.selection).toEqual(stage.before.state.selection);
  }else{expect(stage.decoded.status).toBe('refused');expect(stage.applied).toBeNull();expect(stage.stages.nativeProfile).toBe('not_dispatched_conversion_refusal');pure(stage.after,stage.before);}
  if(['DOC-029','DOC-030'].includes(fixture.id))expect(stage.stages.mountedPresentation).toBe('not_attempted_basic_provider_excludes_verse_or_table');
});

test('CB14 actual delivered parser remains inert under strict CSP and makes no content requests',async({page})=>{
  const value=measurements.get(page);expect(value.requests.some(url=>url.includes('/clipboard-parser.js'))).toBe(false);
  const {id}=await call(page,'mount');const before=await checkpoint(page,id,'live editor before parser-only data');
  const sources=[
    '<p>A&amp;B\r\ne\u0301<strong>X</strong><br></p>',
    '<script>window.__clipboardUnexpectedExecution=1</script><img src="https://example.test/parser-image" srcset="https://example.test/parser-2 2x">',
    '<iframe src="/clipboard-unexpected/frame"></iframe><object data="/clipboard-unexpected/object"></object><link rel="stylesheet" href="/clipboard-unexpected/style">',
    '<style>@import url(/clipboard-unexpected/css);p{background:url(/clipboard-unexpected/background)}</style><template><img src="/clipboard-unexpected/template"></template>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="/clipboard-unexpected/svg"></image></svg><math><mi>x</mi></math>',
  ];
  const observations=[];for(const source of sources){const result=await call(page,'parser',source);expect(result.result.status).toBe('parsed');expect(result.domAfter).toBe(result.domBefore);expect(result.attack).toBe(0);observations.push(result);}
  expect(observations[0].result.nodes[0].children[0]).toEqual({kind:'text',value:'A&B\ne\u0301'});
  const deep=await call(page,'parser','<div>'.repeat(80)+'x'+'</div>'.repeat(80));expect(deep.result.status).toBe('refused');expect(deep.result.reason).toBe('depth_limit');expect(deep.domBefore).toBe(deep.domAfter);
  const over=await call(page,'parser','x'.repeat(524289));expect(over.result.status).toBe('refused');expect(over.result.reason).toBe('input_limit');expect(over.result.usage).toEqual({nodeRequests:0,attributes:0,workUnits:0,stringCopyUnits:0,maximumDepth:0});
  await page.waitForTimeout(50);pure(await checkpoint(page,id,'live editor after parser-only data and bounded observation window'),before);
  value.parser={observations,deep,over,bundle:{path:'packages/kwdj/dist/clipboard-parser.js',sha256:createHash('sha256').update(readFileSync('packages/kwdj/dist/clipboard-parser.js')).digest('hex')},observationWindowMs:50,scope:'Actual delivered bundle/no content request observed; parser source and bundle graph gates are separate'};
  expect(value.requests.filter(url=>url.endsWith('/packages/kwdj/clipboard-parser.js'))).toHaveLength(1);expect(value.unexpectedRequests).toEqual([]);
});

test('CB15 unsupported internal MIME has explicit noncapture and never silently falls back to plain',async({page})=>{
  const {id}=await call(page,'mount');await call(page,'select',id,plainSelection,plainDom);const before=await checkpoint(page,id,'before unsupported internal format');
  const outcome=await call(page,'paste',id,{'text/plain':'must not be used','application/vnd.klenwriter.editor.fragment+json':'{"profile":"foreign"}'});expect(outcome.status).toBe('refused');pure(await checkpoint(page,id,'internal format native unchanged'),before);
  const receipt=await call(page,'takeRecovery',id);expect(receipt.capture.reason).toBe('unsupported_internal');expect(receipt.capture.metadata.internalFragment).toBe('present');expect(receipt.capture.representations['text/plain'].readAttempted).toBe(false);expect(receipt.capture.retainedUtf16Units).toBe(0);expect((await checkpoint(page,id,'internal format metadata transfer')).sourceReads.at(-1).calls).toEqual([]);
});

test('CB16 controlled paste event is canceled only inside the owned editor',async({page})=>{
  const {id}=await call(page,'mount');await call(page,'select',id,plainSelection,plainDom);const marker='event-'+randomUUID();const event=await call(page,'dispatchPaste',id,{'text/plain':marker});expect(event.isTrusted).toBe(false);expect(event.defaultPrevented).toBe(true);
  await page.waitForFunction(({id,index})=>window.clipboardHost.asyncState(id).pasteResults>index,{id,index:event.index});expect((await call(page,'pasteOutcome',id,event.index)).status).toBe('inserted');const after=await checkpoint(page,id,'owned synthetic event native effect');expect(canonical(after)).toEqual(doc([p('a'+marker+'f')]));expect(after.state.history.undo_entries).toBe('1');
  const outside=await call(page,'dispatchPaste',id,{'text/plain':'outside untouched'},true);expect(outside.defaultPrevented).toBe(false);pure(await checkpoint(page,id,'outside event did not invoke editor'),after);expect((await checkpoint(page,id,'outside source has no reads')).sourceReads.at(-1).calls).toEqual([]);
});
