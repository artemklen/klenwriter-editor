// SPDX-License-Identifier: MIT OR Apache-2.0
// Source-first expectations. Actual browser keyboard != installed physical input;
// synthetic composition/declared preedit remains a separately labelled lane.
import {test,expect} from '@playwright/test';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
const authorityPath='contracts/typography/v1/dom-oracles.json';
const authorityBytes=readFileSync(authorityPath),authority=JSON.parse(authorityBytes);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const observations=new WeakMap();
const call=(page,method,...args)=>page.evaluate(({method,args})=>window.typingHost[method](...args),{method,args});
const documentEvents=p=>p.events.filter(event=>event.change.kind==='document');
const mutations=p=>p.nativeCalls.filter(row=>['input_command','command','history'].includes(row.request.kind));
const typed=p=>p.nativeCalls.filter(row=>row.request.kind==='input_command');
async function checkpoint(page,id,label){const value=await call(page,'inspect',id);observations.get(page).checkpoints.push({label,value});return value;}
function bind(value,before){
  if(Array.isArray(value))return value.map(v=>bind(v,before));
  if(value&&typeof value==='object'){
    if(typeof value.base==='string'&&value.base.startsWith('$base.')&&Number.isSafeInteger(value.add))return String(BigInt(before.state.stamp[value.base.slice(6)])+BigInt(value.add));
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,bind(v,before)]));
  }
  if(typeof value!=='string'||!value.startsWith('$'))return value;
  if(value.startsWith('$source.'))return before.roles[value.slice(8)];
  if(value==='$base.stamp')return before.state.stamp;if(value==='$base.context')return before.context;
  if(value.startsWith('$base.'))return before.state.stamp[value.slice(6)];
  if(value.startsWith('$states.')){const [,name,field]=value.split('.');return bind(authority.states[name][field],before);}
  if(value.startsWith('$results.')){const [,name,field]=value.split('.');return bind(authority.results[name][field],before);}
  throw Error('Undeclared source binding '+value);
}
function checkState(actual,literal,before,{privateState=true,domSelection=true}={}){
  const expected=bind(literal,before);
  expect(actual.failures).toEqual([]);expect(actual.rangeObservationOverflow).toBe(false);
  expect(actual.canonical).toBe(expected.canonical_json);expect(actual.state.stamp).toEqual(expected.stamp);
  expect(actual.state.selection).toEqual(expected.selection);expect(actual.state.stored_marks).toEqual(expected.stored_marks);
  expect(actual.state.root).toBe(before.roles.root);expect(actual.state.dirty).toBe(expected.dirty);expect(actual.state.saved_revision).toBe(before.state.saved_revision);
  expect(actual.state.history.undo_entries).toBe(expected.history.undo_entries);expect(actual.state.history.redo_entries).toBe(expected.history.redo_entries);
  expect(actual.state.stamp.history_epoch).toBe(expected.history.epoch);expect(actual.state.history.retained_bytes).toMatch(/^(0|[1-9][0-9]*)$/);
  expect(actual.context).toEqual(before.context);expect(documentEvents(actual).length-documentEvents(before).length).toBe(expected.documentPublicationsSinceBase);
  expect(actual.rows.map(row=>row.node.id)).toEqual(before.rows.map(row=>row.node.id));
  expect(actual.domText).toBe(JSON.parse(expected.canonical_json).content[0].content[0].text);
  if(privateState){
    expect(actual.lifecycle).toBe('ready');expect(actual.recovery).toBeNull();
    if(actual.resources.typing){
      for(const key of ['armedSlots','backspaceCandidates','pendingDispatches'])expect(actual.resources.typing[key],key).toBe(expected.privateInputState[key]);
      expect(actual.resources.typing.retainedBytes).toBeGreaterThanOrEqual(expected.privateInputState.armedSlots);
      expect(actual.resources.typing.retainedBytes).toBeLessThanOrEqual(expected.privateInputState.armedSlots?4096:0);
    }else{ // Omitted off/base capability has no typing owner/resource group.
      expect(before.resources.typing).toBeUndefined();expect(expected.privateInputState).toEqual({phase:'ready',armedSlots:0,backspaceCandidates:0,pendingDispatches:0});
    }
  }
  if(domSelection&&expected.selection){expect(actual.rawDom.inside).toBe(true);for(const edge of ['anchor','focus']){expect(actual.rawDom[edge].nodeType).toBe(3);expect(actual.rawDom[edge].offset).toBe(expected.selection[edge].offset);}}
}
async function firefoxCyrillicKey(page){
  // Playwright 1.64.1 Page.insertText uses a Firefox composition transaction.
  // This one fixed ordinary key follows its original ffInput keydown/up path.
  // It is trusted browser automation, without a physical key or OS IME claim.
  const require=createRequire(import.meta.url),packagePath=require.resolve('playwright-core/package.json'),corePath=resolve(dirname(packagePath),'lib/coreBundle.js');
  const packageBytes=readFileSync(packagePath),coreBytes=readFileSync(corePath);
  expect(JSON.parse(packageBytes).version).toBe('1.64.1');expect(packageBytes.length).toBe(876);expect(sha(packageBytes)).toBe('8aa1c9863fa8dea324e674254158cdc79440f4124ef2d84d38053013541cb7d6');
  expect(coreBytes.length).toBe(3585406);expect(sha(coreBytes)).toBe('829521b67ed7be90c7d6d6098ff39f2241562d47e4ad7ccab13710924a56001d');
  expect(page.context().browser().browserType().name()).toBe('firefox');expect(page.url()).toBe('http://127.0.0.1:4174/typing');
  expect(typeof page._connection?.toImpl).toBe('function');const originalPage=page._connection.toImpl(page),delegate=originalPage?.delegate,rawKeyboard=originalPage?.keyboard?._raw,client=rawKeyboard?._client,browser=delegate?._browserContext?._browser;
  expect(originalPage).toBeTruthy();expect(delegate).toBeTruthy();expect(client).toBeTruthy();expect(browser).toBeTruthy();
  expect(delegate._page).toBe(originalPage);expect(originalPage.keyboard._page).toBe(originalPage);expect(rawKeyboard).toBe(delegate.rawKeyboard);expect(client).toBe(delegate._session);
  expect(delegate._browserContext).toBe(originalPage.browserContext);expect([...browser._ffPages.values()].filter(value=>value===delegate)).toHaveLength(1);
  expect(client._connection).toBe(browser._connection);expect(client._connection._sessions.get(client._sessionId)).toBe(client);expect(client._sessionId).not.toBe('');
  expect(client._disposed).toBe(false);expect(client._crashed).toBe(false);expect(client._connection._closed).toBe(false);expect(originalPage.keyboard._pressedKeys.size).toBe(0);expect(originalPage.keyboard._pressedModifiers.size).toBe(0);
  const delivery={qualification:'Fixed original-session Firefox ordinary KeyZ/key я/text я; trusted browser protocol, not DOM synthetic or installed input',library:{version:'1.64.1',packageSha256:sha(packageBytes),coreSha256:sha(coreBytes)},sessionId:client._sessionId,method:'Page.dispatchKeyEvent',transitions:[]};
  observations.get(page).ordinaryCyrillicDelivery=delivery;
  const down={type:'keydown',keyCode:90,code:'KeyZ',key:'я',repeat:false,location:0,text:'я'},up={type:'keyup',key:'я',keyCode:90,code:'KeyZ',location:0,repeat:false};
  const assertOriginal=()=>{expect(originalPage.delegate).toBe(delegate);expect(delegate._page).toBe(originalPage);expect(delegate._session).toBe(client);expect(originalPage.keyboard._raw).toBe(rawKeyboard);expect(rawKeyboard._client).toBe(client);expect(client._connection._sessions.get(client._sessionId)).toBe(client);expect(client._disposed).toBe(false);expect(client._crashed).toBe(false);expect(client._connection._closed).toBe(false);};
  const sendFixed=async params=>{expect(params===down||params===up).toBe(true);let timer;try{return await Promise.race([client.send('Page.dispatchKeyEvent',params),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Fixed Firefox key transition deadline; no replay')),2000);})]);}finally{clearTimeout(timer);}};
  assertOriginal();delivery.transitions.push({request:down,status:'submitted'});
  try{delivery.transitions[0].response=await sendFixed(down);delivery.transitions[0].status='completed';}
  finally{assertOriginal();const transition={request:up,status:'submitted'};delivery.transitions.push(transition);transition.response=await sendFixed(up);transition.status='completed';}
}
function checkResult(actual,key,before,origin='ordinary_insert_text'){
  // EN is the frozen new reversible U+201C contract. Its coordinates, one raw
  // U+0022 run and stamps are the same source-authored quote result shape.
  const expected=bind(authority.results[key==='en_quote'?'quote':key],before);expected.original.origin=origin;
  if(key==='en_quote'){expected.after.spans[0].text='“';expected.raw_restore.cooked.spans[0].text='“';}
  expect(actual).toEqual(expected);
}
function zeroResources(readback){
  expect(readback.fixtureListeners).toBe(0);expect(readback.rangeObservationOverflow).toBe(false);
  if(readback.resources===null){
    expect(readback.mountStatus).toBe('no_controller_returned');expect(readback.nativeObservationScope).toContain('module-global');
    // There is no returned controller to query. Final module-global counts are
    // independently checked after ALL records have disposed, including leaks
    // from a constructor that failed before returning its handle.
    return;
  }
  expect(readback.resources.sdk.lifecycle).toBe('destroyed');
  for(const [name,group]of Object.entries(readback.resources))for(const [key,value]of Object.entries(group))if(typeof value==='number')expect(value,`${name}.${key}`).toBe(0);
  expect(readback.native).toEqual({sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});expect(readback.fixtureListeners).toBe(0);
}
test.beforeEach(async({page},info)=>{
  const record={engine:info.project.name,installed:false,authority:{path:authorityPath,sha256:sha(authorityBytes)},scope:'Public packaged SDK2/DOM and production sealed WASM; controlled events/preedit and actual trusted browser keyboard are distinguished. No installed physical keyboard/OS IME claim.',errors:[],externalRequests:[],checkpoints:[]};observations.set(page,record);
  page.on('pageerror',error=>record.errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:4174/'))record.externalRequests.push(request.url());});
  await page.addInitScript(()=>{window.typingStartup=[];window.typingPolicy=[];window.addEventListener('error',event=>window.typingStartup.push(event.message));window.addEventListener('unhandledrejection',event=>window.typingStartup.push(String(event.reason?.message??event.reason)));document.addEventListener('securitypolicyviolation',event=>window.typingPolicy.push({directive:event.violatedDirective,blocked:event.blockedURI}));});
  const response=await page.goto('/typing');record.csp=response.headers()['content-security-policy'];expect(record.csp).toContain("default-src 'none'");expect(record.csp).toContain("'wasm-unsafe-eval'");expect(record.csp).not.toMatch(/'unsafe-inline'|'unsafe-eval'/);
  await page.waitForFunction(()=>window.typingHostReady||window.typingStartup.length,null,{timeout:15000});expect(await page.evaluate(()=>window.typingStartup)).toEqual([]);
  record.metadata=await call(page,'metadata');expect(record.metadata.typingCommands).toHaveLength(20);expect(record.metadata.baseCommands).toHaveLength(18);
});
test.afterEach(async({page},info)=>{
  const record=observations.get(page);if(!record)return;
  record.testStatus=info.status;record.cleanupStatus='NOT_RUN';
  try{
    record.disposal=await call(page,'allDisposed');record.disposal.readbacks.forEach(zeroResources);expect(record.disposal.native).toEqual({sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});
    record.policy=await page.evaluate(()=>window.typingPolicy);expect(record.policy).toEqual([]);expect(record.errors).toEqual([]);expect(record.externalRequests).toEqual([]);expect(await page.evaluate(()=>window.typingStartup)).toEqual([]);record.cleanupStatus='PASSED';
  }catch(error){record.cleanupStatus='FAILED';record.cleanupError={message:String(error.message),stack:String(error.stack??'').slice(0,8192)};throw error;
  }finally{
    record.status=record.cleanupStatus==='FAILED'?'failed':record.testStatus;mkdirSync('artifacts/typography',{recursive:true});const path=`artifacts/typography/${info.project.name}-${info.testId.replaceAll(/[^A-Za-z0-9_-]/g,'_')}.json`;writeFileSync(path,JSON.stringify(record,null,2)+'\n');await info.attach('typing-observations',{path,contentType:'application/json'});
  }
});

async function action(page,id,a){
  if(a.kind==='ordinary')return call(page,'ordinary',id,{data:a.data,inputType:a.inputType,cancelable:a.cancelable,rawText:a.verifiedRawDelta??null});
  if(a.kind==='backspaceLineage')return call(page,'backspace',id);
  if(a.kind==='history')return call(page,'history',id,a.direction);
  if(a.kind==='physicalHistoryShortcut'){await page.keyboard.press('Meta+KeyZ');return {qualification:'Actual trusted browser Meta+Z; no physical installed-input claim'};}
  if(a.kind==='insertReplacementText')return call(page,'ordinary',id,{data:a.data,inputType:'insertReplacementText'});
  if(a.kind==='programmatic_insert_text')return call(page,'literal',id,a.data);
  if(a.kind==='paste_plain')return call(page,'paste',id,a.data);
  if(a.kind==='composition'){
    await call(page,'compositionStart',id);
    if(a.preeditText!==undefined)await call(page,'preedit',id,{data:a.preeditText,rawText:a.rawProvisionalBlock});
    await checkpoint(page,id,'original native source unchanged during declared preedit');
    await call(page,'compositionEnd',id,a.endData??a.terminalPayload);await call(page,'frames',6);return;
  }
  if(a.kind==='lateCompositionEcho'){await call(page,'echo',id);await call(page,'frames',2);return;}
  throw Error('Undeclared frozen action '+a.kind);
}
for(const scenario of authority.scenarios)test(`${scenario.id} source-frozen ${scenario.fixture}: exact native state, DOM, result and isolated history`,async({page})=>{
  const mounted=await call(page,'mount',{fixture:scenario.fixture,...(Object.hasOwn(scenario,'configOverride')?{typing:scenario.configOverride}:{})}),{id,before}=mounted;
  observations.get(page).checkpoints.push({label:'independent original setup',value:before});checkState(before,authority.fixtures[scenario.fixture].initial,before);
  for(let i=0;i<scenario.actions.length;i++){
    const a=scenario.actions[i],delivery=await action(page,id,a);observations.get(page).checkpoints.push({label:`action ${i} delivery`,value:delivery});
    const cp=scenario.checkpoints.find(cp=>cp.afterAction===i);if(!cp)continue;
    const actual=await checkpoint(page,id,`frozen state after action ${i}`),literal=cp.state==='$fixture.initial'?authority.fixtures[scenario.fixture].initial:authority.states[cp.state];checkState(actual,literal,before);
    const last=mutations(actual).at(-1);if(cp.result&&typeof cp.result==='string')checkResult(last.response.value.result,cp.result,before,cp.resultOriginalOrigin??'ordinary_insert_text');
    if(Object.hasOwn(cp,'result')&&cp.result===null)expect(last?.response.value.result??null).toBeNull();
    if(cp.resultKind)expect(last.response.value.result.kind).toBe(cp.resultKind);
    if(cp.rawRestoreText){expect(last.response.value.result.raw_restore.raw.map(run=>run.text).join('')).toBe(cp.rawRestoreText);if(scenario.fixture==='en_quote')checkResult(last.response.value.result,'en_quote',before);}
    if(cp.resultOriginalOrigin)expect(last.response.value.result.original.origin).toBe(cp.resultOriginalOrigin);
    if(cp.requestKind)expect(last.request.kind).toBe(cp.requestKind);
    if(cp.submitCount!==undefined)expect(mutations(actual)).toHaveLength(cp.submitCount);
    if(cp.submits!==undefined)expect(mutations(actual)).toHaveLength(cp.submits);
    expect(mutations(actual)).toHaveLength(bind(literal,before).documentPublicationsSinceBase);
    if(a.kind==='composition'){
      const during=observations.get(page).checkpoints.findLast(point=>point.label==='original native source unchanged during declared preedit').value;
      expect(during.canonical).toBe(before.canonical);expect(during.state).toEqual(before.state);expect(documentEvents(during)).toEqual(documentEvents(before));
      expect(typed(during)).toHaveLength(0);if(a.preeditText!==undefined)expect(during.domText).toBe(a.rawProvisionalBlock);
    }
  }
});

for(const [fixture,data,resultKey]of [['quote','"','quote'],['dash',' ','dash'],['nbsp','я','nbsp'],['en_quote','"','en_quote']])test(`B48-keyboard-${fixture}: actual trusted browser insertText and native atomic result`,async({page})=>{
  const {id,before}=await call(page,'mount',{fixture});await expect(page.locator(`#${id}`)).toBeFocused();if(data==='я'){if(observations.get(page).engine==='firefox')await firefoxCyrillicKey(page);else await page.keyboard.insertText(data);}else await page.keyboard.type(data);
  const after=await checkpoint(page,id,'actual trusted browser input');checkState(after,authority.states[fixture==='en_quote'?'en_quote_cooked':`${fixture}_cooked`],before);
  expect(after.inputTrace.some(e=>e.event==='beforeinput'&&e.isTrusted&&e.inputType==='insertText'&&e.data===data)).toBe(true);
  if(data!=='я')expect(after.inputTrace.some(e=>e.event==='keydown'&&e.isTrusted)).toBe(true);
  if(data==='я'&&observations.get(page).engine==='firefox'){
    expect(after.inputTrace.filter(e=>e.event==='keydown'&&e.key==='я'&&e.code==='KeyZ'&&e.isTrusted&&e.isComposing===false)).toHaveLength(1);
    expect(after.inputTrace.filter(e=>e.event==='keyup'&&e.key==='я'&&e.code==='KeyZ'&&e.isTrusted&&e.isComposing===false)).toHaveLength(1);
    expect(after.inputTrace.filter(e=>e.event.startsWith('composition')||e.isComposing===true)).toEqual([]);
    expect(after.inputTrace.filter(e=>e.event==='beforeinput'&&e.inputType==='insertText'&&e.data==='я'&&e.isTrusted&&e.isComposing===false)).toHaveLength(1);
  }
  expect(typed(after)).toHaveLength(1);expect(mutations(after)).toHaveLength(1);if(resultKey)checkResult(typed(after)[0].response.value.result,resultKey,before);
});
test('B48-browser-history: trusted keyboard Undo/Redo never rearms the immediate reversal slot',async({page})=>{
  const {id,before}=await call(page,'mount');await page.keyboard.type('"');checkState(await checkpoint(page,id,'cooked'),authority.states.quote_cooked,before);
  await page.keyboard.press('Meta+KeyZ');checkState(await checkpoint(page,id,'browser Undo'),authority.states.quote_undo_direct,before);
  await page.keyboard.press('Shift+Meta+KeyZ');const redone=await checkpoint(page,id,'browser Redo');checkState(redone,authority.states.quote_redo_direct,before);
  expect(redone.inputTrace.filter(e=>e.event==='keydown'&&e.code==='KeyZ')).toHaveLength(2);expect(redone.inputTrace.filter(e=>e.event==='keydown'&&e.code==='KeyZ').every(e=>e.isTrusted&&e.defaultPrevented)).toBe(true);
});
test('B48-IME-quote: owned final result permits the next actual browser Backspace, once',async({page})=>{
  const {id,before}=await call(page,'mount');await call(page,'compositionStart',id);await call(page,'preedit',id,{data:'"',rawText:'a "'});
  const during=await checkpoint(page,id,'original quote preedit');expect(during.state).toEqual(before.state);expect(during.canonical).toBe(before.canonical);expect(typed(during)).toHaveLength(0);
  await call(page,'compositionEnd',id,'wrong');await call(page,'frames',6);const committed=await checkpoint(page,id,'one admitted final quote');checkState(committed,authority.states.quote_cooked,before);checkResult(typed(committed)[0].response.value.result,'quote',before,'composition_commit');
  await page.keyboard.press('Backspace');const raw=await checkpoint(page,id,'fresh actual browser permit and raw reversal');checkState(raw,authority.states.quote_raw_restored,before);expect(typed(raw)).toHaveLength(2);expect(JSON.parse(typed(raw)[1].request.command.payload_json).kind).toBe('restore_typed_text');
  expect(raw.inputTrace.some(e=>e.event==='keydown'&&e.key==='Backspace'&&e.isTrusted)).toBe(true);expect(raw.inputTrace.some(e=>e.event==='beforeinput'&&e.inputType==='deleteContentBackward'&&e.isTrusted)).toBe(true);
});
test('B48-IME-NBSP: predecessor change joins final correspondence and next browser Backspace remains ordinary',async({page})=>{
  const {id,before}=await call(page,'mount',{fixture:'nbsp'});await call(page,'compositionStart',id);await call(page,'preedit',id,{data:'я',rawText:'а я'});
  const during=await checkpoint(page,id,'original NBSP source with raw SPACE preedit');expect(during.state).toEqual(before.state);expect(during.canonical).toBe(before.canonical);expect(during.domText).toBe('а я');expect(typed(during)).toHaveLength(0);
  await call(page,'compositionEnd',id,'wrong');await call(page,'frames',6);const cooked=await checkpoint(page,id,'final NBSP result');checkState(cooked,authority.states.nbsp_cooked,before);checkResult(typed(cooked)[0].response.value.result,'nbsp',before,'composition_commit');
  await page.keyboard.press('Backspace');const after=await checkpoint(page,id,'next original41 ordinary permit');checkState(after,authority.states.nbsp_backspace,before);expect(typed(after)).toHaveLength(1);expect(mutations(after).at(-1).request.kind).toBe('command');
});
test('B48-old-CMS-terminal-only: already committed straight quote is unchanged with zero dispatches',async({page})=>{
  const source=String.raw`{"content":[{"content":[{"text":"а \"","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}`;
  const {id,before}=await call(page,'mount',{source});await call(page,'compositionEnd',id,'');await call(page,'frames',6);const after=await checkpoint(page,id,'old unowned end-only trace stays zero');
  expect(after.state).toEqual(before.state);expect(after.canonical).toBe(source);expect(after.dom).toEqual(before.dom);expect(documentEvents(after)).toEqual(documentEvents(before));expect(mutations(after)).toHaveLength(0);expect(after.resources.typing).toEqual({armedSlots:0,backspaceCandidates:0,pendingDispatches:0,retainedBytes:0});
});
test('B48-CMS-T15-owned-final: original Cyrillic content transforms only through admitted final commit',async({page})=>{
  const source=String.raw`{"content":[{"content":[{"text":"а ","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}`;
  const cooked=String.raw`{"content":[{"content":[{"text":"а «","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}`;
  const {id,before}=await call(page,'mount',{source});await call(page,'compositionStart',id);await call(page,'preedit',id,{data:'"',rawText:'а "'});
  const during=await checkpoint(page,id,'source T15 content before owned final commit');expect(during.canonical).toBe(source);expect(during.state).toEqual(before.state);expect(typed(during)).toHaveLength(0);
  await call(page,'compositionEnd',id,'not authority');await call(page,'frames',6);const after=await checkpoint(page,id,'T15 content, actual admitted original41 final claim');
  const expected=structuredClone(authority.states.quote_cooked);expected.canonical_json=cooked;checkState(after,expected,before);expect(typed(after)).toHaveLength(1);checkResult(typed(after)[0].response.value.result,'quote',before,'composition_commit');
});
for(const [name,config]of [['empty-subset',{version:1,locale:'ru',rules:[],limits:null}],['lookbehind-zero',{version:1,locale:'ru',rules:null,limits:{lookbehind_scalars:0}}]])test(`B48-config-${name}: explicit typing20 session remains literal without a receipt`,async({page})=>{
  const {id,before}=await call(page,'mount',{typing:config});await page.keyboard.type('"');const after=await checkpoint(page,id,'literal configured typed input');checkState(after,authority.states.quote_literal,before);expect(typed(after)).toHaveLength(1);expect(typed(after)[0].response.value.result).toBeNull();
});
for(const [name,mark]of [['code',{type:'code'}],['link',{type:'link',attrs:{href:'https://example.test/typography',title:'Protected'}}]])test(`B48-protected-${name}: literal input preserves the original protected mark`,async({page})=>{
  const source={content:[{content:[{marks:[mark],text:'a ',type:'text'}],type:'paragraph'}],profile:'prose',schema:'klenwriter.document',schema_version:1};
  const expected={content:[{content:[{marks:[mark],text:'a "',type:'text'}],type:'paragraph'}],profile:'prose',schema:'klenwriter.document',schema_version:1};
  const {id,before}=await call(page,'mount',{source:JSON.stringify(source),textPath:[0,0,0,0]});await page.keyboard.type('"');const after=await checkpoint(page,id,'protected literal native insertion');
  expect(JSON.parse(after.canonical)).toEqual(expected);expect(after.state.selection).toEqual({anchor:{kind:'text',node:before.roles.text,offset:3,affinity:'after'},focus:{kind:'text',node:before.roles.text,offset:3,affinity:'after'}});expect(after.state.history.undo_entries).toBe('1');expect(documentEvents(after).length-documentEvents(before).length).toBe(1);expect(typed(after)).toHaveLength(1);expect(typed(after)[0].response.value.result).toBeNull();expect(after.resources.typing.armedSlots).toBe(0);
});
for(const [kind,oracleId]of [['same-selection','I48-04'],['empty-literal','I48-05'],['barrier','I48-14'],['pointer','I48-03'],['blur','I48-07'],['readOnly','I48-08'],['disabled','I48-09']])test(`B48-retire-${kind}: ${oracleId} same-stamp intent retires receipt without text inference`,async({page})=>{
  const {id,before}=await call(page,'mount');await page.keyboard.type('"');checkState(await checkpoint(page,id,'armed cooked source'),authority.states.quote_cooked,before);
  const reacquire=kind==='blur'||kind==='disabled';
  await call(page,'invalidate',id,kind);const retired=await checkpoint(page,id,'receipt retired before any focus or range acquisition');checkState(retired,authority.states.quote_cooked_retired,before,{domSelection:!reacquire});expect(retired.resources.typing.armedSlots).toBe(0);
  if(reacquire){
    // The frozen invalidator projection owns native state. Outside/disabled
    // browser focus may have no DOM selection; prove retirement BEFORE setup.
    expect(retired.activeElementId).not.toBe(id);expect(retired.inputTrace.some(e=>e.event==='focusout'&&e.isTrusted)).toBe(true);
    expect(retired.nativeCalls.filter(row=>row.request.kind==='set_selection')).toHaveLength(1);
    const acquisition=await call(page,'reacquireRetiredQuote',id);observations.get(page).checkpoints.push({label:'explicit public source-bound focus acquisition after independent retirement proof',value:acquisition});
    expect(acquisition.focused).toBe(true);expect(acquisition.bookmarks).toBe(0);expect(acquisition.submission.response.value.effect).toBe('unchanged');
    await call(page,'frames',2);const focused=await checkpoint(page,id,'original full frozen state and DOM after separate focus acquisition');checkState(focused,authority.states.quote_cooked_retired,before);
    expect(focused.activeElementId).toBe(id);expect(focused.resources.selection.bookmarks).toBe(0);expect(focused.state).toEqual(retired.state);expect(documentEvents(focused)).toEqual(documentEvents(retired));expect(typed(focused)).toHaveLength(1);
  }
  await page.keyboard.press('Backspace');const deleted=await checkpoint(page,id,'ordinary deletion, never raw quote restore');checkState(deleted,authority.states.quote_plain_backspace_after_retire,before);expect(typed(deleted)).toHaveLength(1);expect(mutations(deleted).at(-1).request.kind).toBe('command');
});
test('B48-retire-navigation: actual ArrowRight no-op retires a same-stamp slot',async({page})=>{
  const {id,before}=await call(page,'mount');await page.keyboard.type('"');checkState(await checkpoint(page,id,'armed'),authority.states.quote_cooked,before);await page.keyboard.press('ArrowRight');
  checkState(await checkpoint(page,id,'I48-01 actual no-op navigation'),authority.states.quote_cooked_retired,before);await page.keyboard.press('Backspace');checkState(await checkpoint(page,id,'ordinary Backspace after no-op'),authority.states.quote_plain_backspace_after_retire,before);
});

test('B48-controlled-full-replacement: frozen old[0..3] to é literal final claim owns its fresh identity and Undo/Redo',async({page})=>{
  // Independent canonical authority predates the installed failure and product
  // fix. These are controlled synthetic composition events and declared DOM
  // preedit against the actual sealed SDK; no installed/OS input claim.
  const sourcePath='scripts/typography-installed/oracles.json',sourceBytes=readFileSync(sourcePath),source=JSON.parse(sourceBytes);
  expect(sha(sourceBytes)).toBe('5b17c1bb072990d823a39d21303cd5e636de35d3751961eac4cfe06089f5574e');
  const row=source.rows.find(value=>value.id==='en-real-deadkey-composition');expect(row).toBeTruthy();expect(row.composedText).toBe('é');expect(row.expectedOrigin).toBe('composition_commit');expect(row.expectedResult).toBeNull();
  observations.get(page).additionalAuthority={path:sourcePath,sha256:sha(sourceBytes),row:row.id,qualification:'Source-frozen content/history/identity contract; controlled composition delivery only'};
  const {id,before}=await call(page,'mount',{source:row.before,locale:row.locale,rules:null,selection:row.selection});
  const point=(node,offset)=>({kind:'text',node,offset,affinity:'after'}),original={anchor:point(before.roles.text,0),focus:point(before.roles.text,3)},caret=(node,offset)=>({anchor:point(node,offset),focus:point(node,offset)});
  const originalIds=before.rows.map(value=>value.node.id),tail=before.rows.filter(value=>value.path[0]===1),firstText=canonical=>JSON.parse(canonical).content[0].content[0].text;
  const stamp=(revision,epoch)=>({...before.state.stamp,revision:String(BigInt(before.state.stamp.revision)+BigInt(revision)),selection_epoch:String(BigInt(before.state.stamp.selection_epoch)+BigInt(epoch)),history_epoch:String(BigInt(before.state.stamp.history_epoch)+BigInt(revision))});
  const complete=(actual,{canonical,revision,epoch,undo,redo,textId=before.roles.text,selection=caret(textId,1)})=>{
    expect(actual.canonical).toBe(canonical);expect(actual.state.stamp).toEqual(stamp(revision,epoch));expect(actual.state.selection).toEqual(selection);
    expect(actual.state.root).toBe(before.roles.root);expect(actual.state.stored_marks).toBeNull();expect(actual.state.dirty).toBe(revision!==0);expect(actual.state.saved_revision).toBe(before.state.saved_revision);
    expect(actual.state.history.undo_entries).toBe(String(undo));expect(actual.state.history.redo_entries).toBe(String(redo));expect(actual.state.history.retained_bytes).toMatch(/^(0|[1-9][0-9]*)$/);
    expect(actual.context).toEqual(before.context);expect(actual.lifecycle).toBe('ready');expect(actual.failures).toEqual([]);expect(actual.recovery).toBeNull();expect(actual.rangeObservationOverflow).toBe(false);
    expect(documentEvents(actual).length-documentEvents(before).length).toBe(revision);expect(actual.events.length-before.events.length).toBe(revision);
    expect(actual.rows.map(value=>value.node.id)).toEqual(originalIds.map(value=>value===before.roles.text?textId:value));
    expect(actual.rows.find(value=>JSON.stringify(value.path)==='[0,0]').node).toMatchObject({id:textId,parent:before.roles.block,primitive:'text',type_id:'org.klenwriter.kwdj/text',attributes:{},marks:[],text:firstText(canonical),children:[]});
    for(const initial of tail){const now=actual.rows.find(value=>value.node.id===initial.node.id);expect(now).toBeTruthy();expect(now.path).toEqual(initial.path);for(const key of ['id','parent','type_id','primitive','attributes','marks','text','children'])expect(now.node[key],`untouched tail ${key}`).toEqual(initial.node[key]);}
    expect(actual.dom).toHaveLength(2);expect(actual.dom[1]).toEqual(before.dom[1]);expect(actual.domText).toBe(firstText(canonical)+'tail');expect(actual.activeElementId).toBe(id);
    expect(actual.rawDom.inside).toBe(true);for(const edge of ['anchor','focus']){expect(actual.rawDom[edge]).toEqual({path:[0,0,0],nodeType:3,text:firstText(canonical),offset:selection[edge].offset});}
    expect(actual.resources.typing).toEqual({armedSlots:0,backspaceCandidates:0,pendingDispatches:0,retainedBytes:0});expect(actual.resources.dom.observers).toBe(1);expect(actual.resources.dom.listeners).toBe(before.resources.dom.listeners);
    expect(actual.resources.selection.bookmarks).toBe(0);expect(actual.resources.selection.restoreTickets).toBe(0);expect(actual.native).toEqual({sessions:1,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:1});
  };
  expect(before.state.stamp.revision).toBe('0');expect(before.state.stamp.selection_epoch).toBe('1');expect(before.state.stamp.history_epoch).toBe('0');
  complete(before,{canonical:row.before,revision:0,epoch:0,undo:0,redo:0,selection:original});expect(mutations(before)).toHaveLength(0);expect(tail.map(value=>value.path)).toEqual([[1],[1,0]]);
  await call(page,'compositionStart',id);await call(page,'preedit',id,{data:row.composedText,rawText:row.composedText});
  const during=await checkpoint(page,id,'source-frozen full replacement: original frame untouched during controlled preedit');
  expect(during.canonical).toBe(row.before);expect(during.state).toEqual(before.state);expect(during.rows).toEqual(before.rows);expect(during.context).toEqual(before.context);expect(during.events).toEqual(before.events);expect(mutations(during)).toHaveLength(0);
  expect(during.domText).toBe('étail');expect(during.dom[1]).toEqual(before.dom[1]);expect(during.lifecycle).toBe('ready');expect(during.failures).toEqual([]);expect(during.recovery).toBeNull();
  expect(during.inputTrace.filter(event=>event.event==='compositionstart')).toHaveLength(1);expect(during.inputTrace.filter(event=>event.event==='compositionstart'||event.event==='compositionupdate').every(event=>event.isTrusted===false)).toBe(true);
  await call(page,'compositionEnd',id,'terminal payload is not canonical authority');await call(page,'frames',6);
  const after=await checkpoint(page,id,'source-frozen full replacement: one literal null-result final claim');
  const fresh=after.rows.find(value=>JSON.stringify(value.path)==='[0,0]')?.node.id;expect(fresh).toEqual(expect.any(String));expect(originalIds).not.toContain(fresh);
  complete(after,{canonical:row.composed,revision:1,epoch:1,undo:1,redo:0,textId:fresh});expect(mutations(after)).toHaveLength(1);expect(typed(after)).toHaveLength(1);
  const submitted=typed(after)[0];expect(submitted.request.kind).toBe('input_command');expect(submitted.request.stamp).toEqual(before.state.stamp);expect(submitted.request.command.id).toBe('org.klenwriter.kwdj/command/insert-typed-text');
  expect(JSON.parse(submitted.request.command.payload_json)).toEqual({kind:'insert_typed_text',text:row.composedText,origin:row.expectedOrigin});expect(submitted.response.status).toBe('ok');expect(submitted.response.value.kind).toBe('input_mutation');expect(submitted.response.value.effect).toBe('changed');expect(submitted.response.value.state).toEqual(after.state);expect(submitted.response.value.result).toBeNull();
  await call(page,'history',id,'undo');const undone=await checkpoint(page,id,'source-frozen full replacement: Undo restores exact old identity and directed selection');
  complete(undone,{canonical:row.before,revision:2,epoch:2,undo:0,redo:1,selection:original});expect(undone.rows.some(value=>value.node.id===fresh)).toBe(false);expect(typed(undone)).toHaveLength(1);expect(mutations(undone)).toHaveLength(2);expect(mutations(undone).at(-1).request.kind).toBe('history');expect(mutations(undone).at(-1).request.direction).toBe('undo');
  await call(page,'history',id,'redo');const redone=await checkpoint(page,id,'source-frozen full replacement: Redo retains the same fresh composed identity');
  complete(redone,{canonical:row.composed,revision:3,epoch:3,undo:1,redo:0,textId:fresh});expect(redone.rows.some(value=>value.node.id===before.roles.text)).toBe(false);expect(typed(redone)).toHaveLength(1);expect(mutations(redone)).toHaveLength(3);expect(mutations(redone).at(-1).request.kind).toBe('history');expect(mutations(redone).at(-1).request.direction).toBe('redo');
});

test('B48-controlled-full-replacement-long-literal: fourteen ASCII bytes remain literal beyond typography result-region limits',async({page})=>{
  // New source-authored literal contract, frozen before correcting the draft
  // literal join's typography12-byte gate. Controlled preedit/synthetic events
  // against sealed production SDK; no installed or OS composition claim.
  const literal='literal phrase',originalCanonical=String.raw`{"content":[{"content":[{"text":"old","type":"text"}],"type":"paragraph"},{"content":[{"text":"tail","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}`;
  const cookedCanonical=String.raw`{"content":[{"content":[{"text":"literal phrase","type":"text"}],"type":"paragraph"},{"content":[{"text":"tail","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}`;
  expect(literal.length).toBe(14);expect(Buffer.byteLength(literal,'utf8')).toBe(14);
  observations.get(page).additionalAuthority={kind:'Source-authored multi-scalar literal admission counterexample',literalUtf16:14,literalUtf8:14,originalCanonical,cookedCanonical,qualification:'Frozen before the corrective literal-presentation branch; existing unexecuted draft already present. No output-derived canonical.'};
  const selection={anchor:{kind:'text',path:[0,0],offset:0,affinity:'after'},focus:{kind:'text',path:[0,0],offset:3,affinity:'after'}};
  const {id,before}=await call(page,'mount',{source:originalCanonical,locale:'en',rules:null,selection});
  const point=(node,offset)=>({kind:'text',node,offset,affinity:'after'}),original={anchor:point(before.roles.text,0),focus:point(before.roles.text,3)},originalIds=before.rows.map(value=>value.node.id),tail=before.rows.filter(value=>value.path[0]===1);
  const check=(actual,{revision,epoch,undo,redo,textId=before.roles.text,restored=false})=>{
    const canonical=restored?originalCanonical:cookedCanonical,text=restored?'old':literal,expectedSelection=restored?original:{anchor:point(textId,14),focus:point(textId,14)};
    expect(actual.canonical).toBe(canonical);expect(actual.state.stamp).toEqual({...before.state.stamp,revision:String(BigInt(before.state.stamp.revision)+BigInt(revision)),selection_epoch:String(BigInt(before.state.stamp.selection_epoch)+BigInt(epoch)),history_epoch:String(BigInt(before.state.stamp.history_epoch)+BigInt(revision))});
    expect(actual.state.root).toBe(before.roles.root);expect(actual.state.selection).toEqual(expectedSelection);expect(actual.state.stored_marks).toBeNull();expect(actual.state.dirty).toBe(revision!==0);expect(actual.state.saved_revision).toBe(before.state.saved_revision);
    expect(actual.state.history.undo_entries).toBe(String(undo));expect(actual.state.history.redo_entries).toBe(String(redo));expect(actual.state.history.retained_bytes).toMatch(/^(0|[1-9][0-9]*)$/);
    expect(actual.context).toEqual(before.context);expect(actual.lifecycle).toBe('ready');expect(actual.recovery).toBeNull();expect(actual.failures).toEqual([]);expect(actual.rangeObservationOverflow).toBe(false);
    expect(documentEvents(actual).length-documentEvents(before).length).toBe(revision);expect(actual.events.length-before.events.length).toBe(revision);
    expect(actual.rows.map(value=>value.node.id)).toEqual(originalIds.map(value=>value===before.roles.text?textId:value));
    expect(actual.rows.find(value=>JSON.stringify(value.path)==='[0,0]').node).toMatchObject({id:textId,parent:before.roles.block,primitive:'text',type_id:'org.klenwriter.kwdj/text',attributes:{},marks:[],text,children:[]});
    for(const initial of tail){const now=actual.rows.find(value=>value.node.id===initial.node.id);expect(now).toBeTruthy();expect(now.path).toEqual(initial.path);for(const key of ['id','parent','type_id','primitive','attributes','marks','text','children'])expect(now.node[key],`untouched long-literal tail ${key}`).toEqual(initial.node[key]);}
    expect(actual.dom).toHaveLength(2);expect(actual.dom[1]).toEqual(before.dom[1]);expect(actual.domText).toBe(text+'tail');expect(actual.activeElementId).toBe(id);expect(actual.rawDom.inside).toBe(true);
    for(const edge of ['anchor','focus'])expect(actual.rawDom[edge]).toEqual({path:[0,0,0],nodeType:3,text,offset:expectedSelection[edge].offset});
    expect(actual.resources.typing).toEqual({armedSlots:0,backspaceCandidates:0,pendingDispatches:0,retainedBytes:0});expect(actual.resources.dom.observers).toBe(1);expect(actual.resources.dom.listeners).toBe(before.resources.dom.listeners);expect(actual.resources.selection.bookmarks).toBe(0);expect(actual.resources.selection.restoreTickets).toBe(0);
    expect(actual.native).toEqual({sessions:1,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:1});
  };
  expect(before.state.stamp.revision).toBe('0');expect(before.state.stamp.selection_epoch).toBe('1');expect(before.state.stamp.history_epoch).toBe('0');check(before,{revision:0,epoch:0,undo:0,redo:0,restored:true});expect(mutations(before)).toHaveLength(0);expect(tail.map(value=>value.path)).toEqual([[1],[1,0]]);
  await call(page,'compositionStart',id);await call(page,'preedit',id,{data:literal,rawText:literal});const during=await checkpoint(page,id,'long literal: independent original native frame unchanged during declared fourteen-byte preedit');
  expect(during.canonical).toBe(originalCanonical);expect(during.state).toEqual(before.state);expect(during.rows).toEqual(before.rows);expect(during.context).toEqual(before.context);expect(during.events).toEqual(before.events);expect(mutations(during)).toHaveLength(0);expect(during.domText).toBe('literal phrasetail');expect(during.dom[1]).toEqual(before.dom[1]);expect(during.failures).toEqual([]);expect(during.recovery).toBeNull();
  await call(page,'compositionEnd',id,'terminal data does not define the literal');await call(page,'frames',6);const after=await checkpoint(page,id,'long literal: one null-result final claim beyond the typography cap');
  const fresh=after.rows.find(value=>JSON.stringify(value.path)==='[0,0]')?.node.id;expect(fresh).toEqual(expect.any(String));expect(originalIds).not.toContain(fresh);check(after,{revision:1,epoch:1,undo:1,redo:0,textId:fresh});expect(mutations(after)).toHaveLength(1);expect(typed(after)).toHaveLength(1);
  const submitted=typed(after)[0];expect(submitted.request.stamp).toEqual(before.state.stamp);expect(submitted.request.command.id).toBe('org.klenwriter.kwdj/command/insert-typed-text');expect(JSON.parse(submitted.request.command.payload_json)).toEqual({kind:'insert_typed_text',text:literal,origin:'composition_commit'});expect(submitted.response.status).toBe('ok');expect(submitted.response.value.kind).toBe('input_mutation');expect(submitted.response.value.effect).toBe('changed');expect(submitted.response.value.result).toBeNull();expect(submitted.response.value.state).toEqual(after.state);
  await call(page,'history',id,'undo');const undone=await checkpoint(page,id,'long literal: Undo exact old identity and directed source range');check(undone,{revision:2,epoch:2,undo:0,redo:1,restored:true});expect(undone.rows.some(value=>value.node.id===fresh)).toBe(false);expect(typed(undone)).toHaveLength(1);expect(mutations(undone)).toHaveLength(2);expect(mutations(undone).at(-1).request).toMatchObject({kind:'history',direction:'undo'});
  await call(page,'history',id,'redo');const redone=await checkpoint(page,id,'long literal: Redo same fresh literal identity');check(redone,{revision:3,epoch:3,undo:1,redo:0,textId:fresh});expect(redone.rows.some(value=>value.node.id===before.roles.text)).toBe(false);expect(typed(redone)).toHaveLength(1);expect(mutations(redone)).toHaveLength(3);expect(mutations(redone).at(-1).request).toMatchObject({kind:'history',direction:'redo'});
});

for(const row of [
  {name:'accent-to-empty',literal:'é',units:1,deletedText:null,
    composed:String.raw`{"content":[{"content":[{"text":"é","type":"text"}],"type":"paragraph"},{"content":[{"text":"tail","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}`,
    deleted:String.raw`{"content":[{"content":[],"type":"paragraph"},{"content":[{"text":"tail","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}`},
  {name:'phrase-to-shorter-phrase',literal:'literal phrase',units:14,deletedText:'literal phras',
    composed:String.raw`{"content":[{"content":[{"text":"literal phrase","type":"text"}],"type":"paragraph"},{"content":[{"text":"tail","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}`,
    deleted:String.raw`{"content":[{"content":[{"text":"literal phras","type":"text"}],"type":"paragraph"},{"content":[{"text":"tail","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}`}
])test(`B48-controlled-literal-immediate-backspace-${row.name}: trusted browser deletion before host history retains exact logical identities`,async({page})=>{
  // Static expectations precede the new literal Backspace-range helper. Native
  // source removes the sole Text for é and retains the left Text for phrase.
  // Preedit/end events are controlled; only the following Backspace is actual
  // trusted browser input. This is not installed or OS keyboard evidence.
  const originalCanonical=String.raw`{"content":[{"content":[{"text":"old","type":"text"}],"type":"paragraph"},{"content":[{"text":"tail","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}`;
  const selection={anchor:{kind:'text',path:[0,0],offset:0,affinity:'after'},focus:{kind:'text',path:[0,0],offset:3,affinity:'after'}};
  observations.get(page).additionalAuthority={kind:'Source-derived native EGC deletion and exact history identity policy',case:row.name,canonicalBefore:originalCanonical,canonicalComposed:row.composed,canonicalDeleted:row.deleted,qualification:'Frozen before the new proved-literal-frame Backspace helper; no candidate output defines an oracle'};
  const {id,before}=await call(page,'mount',{source:originalCanonical,locale:'en',rules:null,selection});
  const point=(node,offset)=>({kind:'text',node,offset,affinity:'after'}),original={anchor:point(before.roles.text,0),focus:point(before.roles.text,3)},originalIds=before.rows.map(value=>value.node.id),tail=before.rows.filter(value=>value.path[0]===1);
  let composedId=null;
  const check=(actual,{phase,revision,undo,redo})=>{
    const restored=phase==='old',deleted=phase==='deleted',empty=deleted&&row.deletedText===null,text=restored?'old':deleted?row.deletedText:row.literal,textId=restored?before.roles.text:composedId;
    const canonical=restored?originalCanonical:deleted?row.deleted:row.composed,offset=restored?null:deleted?row.units-1:row.units;
    const expectedSelection=restored?original:empty?{anchor:{kind:'child',parent:before.roles.block,index:0,affinity:'after'},focus:{kind:'child',parent:before.roles.block,index:0,affinity:'after'}}:{anchor:point(textId,offset),focus:point(textId,offset)};
    expect(actual.canonical).toBe(canonical);expect(actual.state.stamp).toEqual({...before.state.stamp,revision:String(BigInt(before.state.stamp.revision)+BigInt(revision)),selection_epoch:String(BigInt(before.state.stamp.selection_epoch)+BigInt(revision)),history_epoch:String(BigInt(before.state.stamp.history_epoch)+BigInt(revision))});
    expect(actual.state.root).toBe(before.roles.root);expect(actual.state.selection).toEqual(expectedSelection);expect(actual.state.stored_marks).toBeNull();expect(actual.state.dirty).toBe(revision!==0);expect(actual.state.saved_revision).toBe(before.state.saved_revision);expect(actual.state.history.undo_entries).toBe(String(undo));expect(actual.state.history.redo_entries).toBe(String(redo));expect(actual.state.history.retained_bytes).toMatch(/^(0|[1-9][0-9]*)$/);
    expect(actual.context).toEqual(before.context);expect(actual.lifecycle).toBe('ready');expect(actual.recovery).toBeNull();expect(actual.failures).toEqual([]);expect(actual.rangeObservationOverflow).toBe(false);expect(actual.activeElementId).toBe(id);
    expect(documentEvents(actual).length-documentEvents(before).length).toBe(revision);expect(actual.events.length-before.events.length).toBe(revision);expect(mutations(actual)).toHaveLength(revision);expect(typed(actual)).toHaveLength(revision===0?0:1);
    const expectedIds=empty?originalIds.filter(value=>value!==before.roles.text):originalIds.map(value=>value===before.roles.text?textId:value);expect(actual.rows.map(value=>value.node.id)).toEqual(expectedIds);
    const block=actual.rows.find(value=>value.node.id===before.roles.block).node;expect(block.children).toEqual(empty?[]:[textId]);
    if(empty){expect(actual.rows.some(value=>value.path.length===2&&value.path[0]===0)).toBe(false);expect(actual.dom[0]).toEqual({...before.dom[0],children:[{nodeType:1,tag:'br',attributes:{},children:[]}]});}
    else expect(actual.rows.find(value=>JSON.stringify(value.path)==='[0,0]').node).toMatchObject({id:textId,parent:before.roles.block,primitive:'text',type_id:'org.klenwriter.kwdj/text',attributes:{},marks:[],text,children:[]});
    for(const initial of tail){const now=actual.rows.find(value=>value.node.id===initial.node.id);expect(now).toBeTruthy();expect(now.path).toEqual(initial.path);for(const key of ['id','parent','type_id','primitive','attributes','marks','text','children'])expect(now.node[key],`untouched immediate-Backspace tail ${key}`).toEqual(initial.node[key]);}
    expect(actual.dom).toHaveLength(2);expect(actual.dom[1]).toEqual(before.dom[1]);expect(actual.domText).toBe((text??'')+'tail');expect(actual.rawDom.inside).toBe(true);
    for(const edge of ['anchor','focus'])expect(actual.rawDom[edge]).toEqual(empty?{path:[0],nodeType:1,text:null,offset:0}:{path:[0,0,0],nodeType:3,text,offset:expectedSelection[edge].offset});
    expect(actual.resources.typing).toEqual({armedSlots:0,backspaceCandidates:0,pendingDispatches:0,retainedBytes:0});expect(actual.resources.dom.observers).toBe(1);expect(actual.resources.dom.listeners).toBe(before.resources.dom.listeners);expect(actual.resources.selection.bookmarks).toBe(0);expect(actual.resources.selection.restoreTickets).toBe(0);expect(actual.native).toEqual({sessions:1,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:1});
    if(revision){const first=typed(actual)[0];expect(first.request.kind).toBe('input_command');expect(first.request.stamp).toEqual(before.state.stamp);expect(first.request.command.id).toBe('org.klenwriter.kwdj/command/insert-typed-text');expect(JSON.parse(first.request.command.payload_json)).toEqual({kind:'insert_typed_text',text:row.literal,origin:'composition_commit'});expect(first.response.status).toBe('ok');expect(first.response.value.kind).toBe('input_mutation');expect(first.response.value.effect).toBe('changed');expect(first.response.value.result).toBeNull();}
  };
  expect(before.state.stamp.revision).toBe('0');expect(before.state.stamp.selection_epoch).toBe('1');expect(before.state.stamp.history_epoch).toBe('0');check(before,{phase:'old',revision:0,undo:0,redo:0});expect(tail.map(value=>value.path)).toEqual([[1],[1,0]]);
  await call(page,'compositionStart',id);await call(page,'preedit',id,{data:row.literal,rawText:row.literal});const during=await checkpoint(page,id,'immediate Backspace: original native frame unchanged during controlled literal preedit');
  expect(during.canonical).toBe(originalCanonical);expect(during.state).toEqual(before.state);expect(during.rows).toEqual(before.rows);expect(during.context).toEqual(before.context);expect(during.events).toEqual(before.events);expect(mutations(during)).toHaveLength(0);expect(during.domText).toBe(row.literal+'tail');expect(during.dom[1]).toEqual(before.dom[1]);expect(during.failures).toEqual([]);expect(during.recovery).toBeNull();
  await call(page,'compositionEnd',id,'terminal data is not authority');await call(page,'frames',6);const committed=await checkpoint(page,id,'immediate Backspace: one completed literal null-result frame');
  composedId=committed.rows.find(value=>JSON.stringify(value.path)==='[0,0]')?.node.id;expect(composedId).toEqual(expect.any(String));expect(originalIds).not.toContain(composedId);check(committed,{phase:'composed',revision:1,undo:1,redo:0});
  // No host command, selection, bookmark or history operation intervenes.
  await page.keyboard.press('Backspace');const deleted=await checkpoint(page,id,'immediate actual trusted browser Backspace before any host history');check(deleted,{phase:'deleted',revision:2,undo:2,redo:0});
  const browserEvents=deleted.inputTrace.slice(committed.inputTrace.length);expect(browserEvents.map(event=>event.event)).toEqual(['keydown','beforeinput','keyup']);expect(browserEvents.every(event=>event.isTrusted===true)).toBe(true);
  expect(browserEvents[0]).toMatchObject({key:'Backspace',code:'Backspace',isComposing:false});expect(browserEvents[1]).toMatchObject({inputType:'deleteContentBackward',data:null,isComposing:false,cancelable:true,defaultPrevented:true});expect(browserEvents[2]).toMatchObject({key:'Backspace',code:'Backspace',isComposing:false});
  const deletion=mutations(deleted)[1];expect(deletion.request).toMatchObject({kind:'command',stamp:committed.state.stamp,history_hint:{kind:'isolated'}});expect(deletion.request.command.id).toBe('org.klenwriter.kwdj/command/delete-backward');expect(JSON.parse(deletion.request.command.payload_json)).toEqual({kind:'delete_backward'});expect(deletion.response.status).toBe('ok');expect(deletion.response.value.kind).toBe('mutation');expect(deletion.response.value.effect).toBe('changed');expect(deletion.response.value.state).toEqual(deleted.state);
  for(const step of [{direction:'undo',phase:'composed',revision:3,undo:1,redo:1},{direction:'undo',phase:'old',revision:4,undo:0,redo:2},{direction:'redo',phase:'composed',revision:5,undo:1,redo:1},{direction:'redo',phase:'deleted',revision:6,undo:2,redo:0}]){
    await call(page,'history',id,step.direction);const actual=await checkpoint(page,id,`immediate Backspace history: ${step.direction} revision${step.revision} ${step.phase}`);check(actual,step);const last=mutations(actual).at(-1);expect(last.request).toMatchObject({kind:'history',direction:step.direction});expect(last.response.status).toBe('ok');expect(last.response.value.kind).toBe('mutation');expect(last.response.value.effect).toBe('changed');expect(last.response.value.state).toEqual(actual.state);
  }
});

// SOURCE03: the platform schedule is measured separately; these are explicitly
// controlled, untrusted events over the real registered DOM and sealed native SDK.
const transientOriginal=String.raw`{"content":[{"content":[{"text":"old","type":"text"}],"type":"paragraph"},{"content":[{"text":"tail","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}`;
const transientComposed=String.raw`{"content":[{"content":[{"text":"é","type":"text"}],"type":"paragraph"},{"content":[{"text":"tail","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}`;
const transientSelection={anchor:{kind:'text',path:[0,0],offset:0,affinity:'after'},focus:{kind:'text',path:[0,0],offset:3,affinity:'after'}};
async function mountTransient(page,extra={}){
  observations.get(page).additionalAuthority={kind:'SOURCE03 private composing-only transient terminal',source:'transient-empty-regressions-source-freeze-03',primaryPlatformReportSha256:'c02929690e3422b4bac1b26e4e35b52694f0fa0a152ab4ba04c8ca93507463f3',nativeOracle:'scripts/typography-installed/oracles.json#en-real-deadkey-composition',canonicalBefore:transientOriginal,canonicalAfter:transientComposed,qualification:'Synthetic event identities; actual DOM, native IDs/history and resource disposal. No installed/OS claim.'};
  return call(page,'mount',{source:transientOriginal,locale:'en',rules:null,selection:transientSelection,...extra});
}
function unchangedTransient(actual,before){
  expect(actual.canonical).toBe(transientOriginal);expect(actual.state).toEqual(before.state);expect(actual.rows).toEqual(before.rows);expect(actual.lifecycle).toBe('recoveryRequired');expect(actual.context).toBeNull();expect(actual.recovery).not.toBeNull();expect(actual.recovery.composition.context).toEqual(before.context);expect(actual.recovery.composition.base).toEqual(before.state.stamp);expect(actual.recovery.composition.selection).toEqual(before.state.selection);expect(actual.events).toEqual(before.events);expect(mutations(actual)).toHaveLength(0);expect(typed(actual)).toHaveLength(0);expect(actual.rangeObservationOverflow).toBe(false);
}
test('B48-controlled-transient-terminal: direct Text payload before end joins one fresh null-result frame and exact Undo/Redo identities',async({page})=>{
  const {id,before}=await mountTransient(page),originalIds=before.rows.map(row=>row.node.id),tail=before.rows.filter(row=>row.path[0]===1),point=(node,offset)=>({kind:'text',node,offset,affinity:'after'}),original={anchor:point(before.roles.text,0),focus:point(before.roles.text,3)};
  const delivery=await call(page,'transientTerminal',id,'complete');observations.get(page).transientDelivery=delivery;
  expect(delivery.nativeBefore).toEqual(before.state);expect(delivery.oldSpanDetached).toBe(true);expect(delivery.directPayloadBeforeEnd).toBe(true);
  expect(delivery.events.map(event=>[event.type,event.inputType])).toEqual([['beforeinput','insertCompositionText'],['input','insertCompositionText'],['beforeinput','deleteCompositionText'],['input','deleteCompositionText'],['beforeinput','insertFromComposition'],['input','insertFromComposition']]);
  expect(delivery.events.every(event=>event.isTrusted===false)).toBe(true);expect(delivery.keys.map(key=>[key.type,key.key,key.code])).toEqual([['keydown','é','KeyE'],['keyup','e','KeyE']]);
  const empty=delivery.stages[1],payload=delivery.stages[2];
  expect(empty.dom.children).toEqual([{nodeType:1,tag:'br',attributes:{},children:[]}]);expect(empty.raw.anchor).toEqual({path:[0],nodeType:1,text:null,offset:0});expect(empty.raw.focus).toEqual(empty.raw.anchor);
  expect(payload.dom.children).toEqual([{nodeType:3,text:'é'}]);expect(payload.oldSpanConnected).toBe(false);expect(payload.raw.anchor).toEqual({path:[0,0],nodeType:3,text:'é',offset:1});expect(payload.raw.focus).toEqual(payload.raw.anchor);
  for(const stage of delivery.stages){expect(stage.state).toEqual(before.state);expect(stage.sameBlock).toBe(true);expect(stage.sameTail).toBe(true);}
  // No end.data authority: only the actual direct Text and native source frame.
  const pre=await checkpoint(page,id,'transient source03: actual direct Text before first RAF/native publication');
  // A protocol round trip may allow RAFs. The synchronous delivery stages above,
  // rather than this later checkpoint, prove prepublication DOM/native state.
  expect(pre.failures).toEqual([]);expect(pre.recovery).toBeNull();await call(page,'frames',6);
  const after=await checkpoint(page,id,'transient source03: literal null result, actual native new leaf and rendered fresh SPAN');
  const fresh=after.rows.find(row=>JSON.stringify(row.path)==='[0,0]')?.node.id;expect(fresh).toEqual(expect.any(String));expect(originalIds).not.toContain(fresh);
  function check(actual,{restored=false,revision,undo,redo}){
    const text=restored?'old':'é',textId=restored?before.roles.text:fresh,selection=restored?original:{anchor:point(textId,1),focus:point(textId,1)};
    expect(actual.canonical).toBe(restored?transientOriginal:transientComposed);expect(actual.state.stamp).toEqual({...before.state.stamp,revision:String(BigInt(before.state.stamp.revision)+BigInt(revision)),selection_epoch:String(BigInt(before.state.stamp.selection_epoch)+BigInt(revision)),history_epoch:String(BigInt(before.state.stamp.history_epoch)+BigInt(revision))});
    expect(actual.state.selection).toEqual(selection);expect(actual.state.root).toBe(before.roles.root);expect(actual.state.stored_marks).toBeNull();expect(actual.state.saved_revision).toBe(before.state.saved_revision);expect(actual.state.dirty).toBe(revision!==0);expect(actual.state.history.undo_entries).toBe(String(undo));expect(actual.state.history.redo_entries).toBe(String(redo));expect(actual.state.history.retained_bytes).toMatch(/^(0|[1-9][0-9]*)$/);
    expect(actual.rows.map(row=>row.node.id)).toEqual(originalIds.map(value=>value===before.roles.text?textId:value));expect(actual.rows.find(row=>JSON.stringify(row.path)==='[0,0]').node).toMatchObject({id:textId,parent:before.roles.block,primitive:'text',type_id:'org.klenwriter.kwdj/text',attributes:{},marks:[],children:[],text});
    for(const initial of tail){const now=actual.rows.find(row=>row.node.id===initial.node.id);expect(now.path).toEqual(initial.path);for(const key of ['id','parent','primitive','type_id','attributes','marks','text','children'])expect(now.node[key],`source03 unchanged tail ${key}`).toEqual(initial.node[key]);}
    expect(actual.dom[1]).toEqual(before.dom[1]);expect(actual.dom[0].children[0].tag).toBe('span');expect(actual.domText).toBe(text+'tail');for(const edge of ['anchor','focus'])expect(actual.rawDom[edge]).toEqual({path:[0,0,0],nodeType:3,text,offset:selection[edge].offset});
    expect(actual.context).toEqual(before.context);expect(actual.lifecycle).toBe('ready');expect(actual.failures).toEqual([]);expect(actual.recovery).toBeNull();expect(actual.activeElementId).toBe(id);expect(documentEvents(actual).length-documentEvents(before).length).toBe(revision);expect(actual.events.length-before.events.length).toBe(revision);expect(actual.rangeObservationOverflow).toBe(false);
    expect(actual.resources.typing).toEqual({armedSlots:0,backspaceCandidates:0,pendingDispatches:0,retainedBytes:0});expect(actual.resources.selection.bookmarks).toBe(0);expect(actual.resources.selection.restoreTickets).toBe(0);expect(actual.native).toEqual({sessions:1,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:1});
  }
  check(after,{revision:1,undo:1,redo:0});expect(mutations(after)).toHaveLength(1);expect(typed(after)).toHaveLength(1);
  const command=typed(after)[0];expect(command.request.stamp).toEqual(before.state.stamp);expect(command.request.command.id).toBe('org.klenwriter.kwdj/command/insert-typed-text');expect(JSON.parse(command.request.command.payload_json)).toEqual({kind:'insert_typed_text',text:'é',origin:'composition_commit'});expect(command.response.status).toBe('ok');expect(command.response.value.kind).toBe('input_mutation');expect(command.response.value.effect).toBe('changed');expect(command.response.value.result).toBeNull();expect(command.response.value.state).toEqual(after.state);
  await call(page,'history',id,'undo');const undone=await checkpoint(page,id,'transient source03: Undo original ID/full directed range');check(undone,{restored:true,revision:2,undo:0,redo:1});expect(undone.rows.some(row=>row.node.id===fresh)).toBe(false);expect(typed(undone)).toHaveLength(1);expect(mutations(undone).at(-1).request).toMatchObject({kind:'history',direction:'undo'});
  await call(page,'history',id,'redo');const redone=await checkpoint(page,id,'transient source03: Redo same composed ID/caret');check(redone,{revision:3,undo:1,redo:0});expect(redone.rows.some(row=>row.node.id===before.roles.text)).toBe(false);expect(typed(redone)).toHaveLength(1);expect(mutations(redone)).toHaveLength(3);expect(mutations(redone).at(-1).request).toMatchObject({kind:'history',direction:'redo'});
});
for(const variant of ['pending-at-end','missing-delete-before','attributed-br','foreign-tail','wrong-insert-range','repeat-echo','wrong-code-echo','ordinary-after-echo'])test(`B48-controlled-transient-terminal refusal: ${variant} never deletes the original native source`,async({page})=>{
  const {id,before}=await mountTransient(page);observations.get(page).transientDelivery=await call(page,'transientTerminal',id,variant);await call(page,'frames',8);const after=await checkpoint(page,id,'source03 original native frame retained on '+variant);unchangedTransient(after,before);expect(after.recovery).not.toBeNull();expect(after.recovery.composition.nativeOutcome).toBe('not_submitted');
});
test('B48-controlled-transient-terminal basic off: same actual fresh BR remains refused by the unchanged default observer',async({page})=>{
  const {id,before}=await mountTransient(page,{typing:null});observations.get(page).transientDelivery=await call(page,'transientTerminal',id,'pending-at-end');await call(page,'frames',3);const after=await checkpoint(page,id,'same-DOM default observer fresh BR negative');unchangedTransient(after,before);expect(after.recovery).not.toBeNull();expect(after.recovery.composition.reason).toBe('capture_limit');expect(after.resources.typing).toBeUndefined();
});

// Additive SOURCE03 closing229 controls. Existing54 cases above are unchanged.
// Explicit synthetic deprecated keyboard fields are not physical/OS provenance.
function checkTransient229State(actual,before,fresh,{restored=false,revision,undo,redo}){
  const text=restored?'old':'é',id=restored?before.roles.text:fresh,point=(node,offset)=>({kind:'text',node,offset,affinity:'after'});
  const selection=restored?{anchor:point(id,0),focus:point(id,3)}:{anchor:point(id,1),focus:point(id,1)};
  expect(actual.canonical).toBe(restored?transientOriginal:transientComposed);
  expect(actual.state.stamp).toEqual({...before.state.stamp,revision:String(BigInt(before.state.stamp.revision)+BigInt(revision)),selection_epoch:String(BigInt(before.state.stamp.selection_epoch)+BigInt(revision)),history_epoch:String(BigInt(before.state.stamp.history_epoch)+BigInt(revision))});
  expect(actual.state.selection).toEqual(selection);expect(actual.state.root).toBe(before.roles.root);expect(actual.state.stored_marks).toBeNull();expect(actual.state.saved_revision).toBe(before.state.saved_revision);expect(actual.state.dirty).toBe(true);
  expect(actual.state.history.undo_entries).toBe(String(undo));expect(actual.state.history.redo_entries).toBe(String(redo));expect(actual.state.history.retained_bytes).toMatch(/^(0|[1-9][0-9]*)$/);
  expect(actual.rows.map(row=>row.node.id)).toEqual(before.rows.map(row=>row.node.id===before.roles.text?id:row.node.id));
  expect(actual.rows.find(row=>JSON.stringify(row.path)==='[0,0]').node).toMatchObject({id,parent:before.roles.block,primitive:'text',type_id:'org.klenwriter.kwdj/text',attributes:{},marks:[],children:[],text});
  for(const initial of before.rows.filter(row=>row.path[0]===1)){
    const now=actual.rows.find(row=>row.node.id===initial.node.id);expect(now.path).toEqual(initial.path);
    for(const key of ['id','parent','primitive','type_id','attributes','marks','text','children'])expect(now.node[key],`closing229 unchanged tail ${key}`).toEqual(initial.node[key]);
  }
  expect(actual.dom[1]).toEqual(before.dom[1]);expect(actual.domText).toBe(text+'tail');expect(actual.dom[0].children[0].tag).toBe('span');
  for(const edge of ['anchor','focus'])expect(actual.rawDom[edge]).toEqual({path:[0,0,0],nodeType:3,text,offset:selection[edge].offset});
  expect(actual.lifecycle).toBe('ready');expect(actual.context).toEqual(before.context);expect(actual.recovery).toBeNull();expect(actual.failures).toEqual([]);expect(actual.rangeObservationOverflow).toBe(false);
  expect(actual.events.length-before.events.length).toBe(revision);expect(documentEvents(actual).length-documentEvents(before).length).toBe(revision);
  expect(actual.resources.typing).toEqual({armedSlots:0,backspaceCandidates:0,pendingDispatches:0,retainedBytes:0});expect(actual.resources.dom.continuations).toBe(0);expect(actual.resources.selection.bookmarks).toBe(0);expect(actual.resources.selection.restoreTickets).toBe(0);
  expect(actual.native).toEqual({sessions:1,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:1});
}
const expectedClosing229Keys=[
  {type:'keydown',key:'é',code:'KeyE',keyCode:229,which:229,isComposing:false,repeat:false,altKey:false,ctrlKey:false,metaKey:false,shiftKey:false,isTrusted:false,cancelable:true,defaultPrevented:false},
  {type:'keyup',key:'e',code:'KeyE',keyCode:69,which:69,isComposing:false,repeat:false,altKey:false,ctrlKey:false,metaKey:false,shiftKey:false,isTrusted:false,cancelable:false,defaultPrevented:false},
];
test('B48-controlled-transient-terminal closing229: completed paired payload claims once with null result and exact Undo/Redo',async({page})=>{
  const {id,before}=await mountTransient(page),originalIds=before.rows.map(row=>row.node.id);
  const delivery=await call(page,'transientTerminal229',id,'complete');observations.get(page).closing229Delivery=delivery;
  expect(delivery.nativeBefore).toEqual(before.state);expect(delivery.oldSpanDetached).toBe(true);expect(delivery.directPayloadBeforeEnd).toBe(true);expect(delivery.keys).toEqual(expectedClosing229Keys);
  expect(delivery.events.map(e=>[e.type,e.inputType])).toEqual([['beforeinput','insertCompositionText'],['input','insertCompositionText'],['beforeinput','deleteCompositionText'],['input','deleteCompositionText'],['beforeinput','insertFromComposition'],['input','insertFromComposition']]);expect(delivery.events.every(e=>e.isTrusted===false)).toBe(true);
  expect(delivery.stages[1].dom.children).toEqual([{nodeType:1,tag:'br',attributes:{},children:[]}]);expect(delivery.stages[2].dom.children).toEqual([{nodeType:3,text:'é'}]);
  for(const stage of delivery.stages){expect(stage.state).toEqual(before.state);expect(stage.sameBlock).toBe(true);expect(stage.sameTail).toBe(true);}
  await call(page,'frames',6);const after=await checkpoint(page,id,'closing229: original completed payload, one null-result publication');
  const fresh=after.rows.find(row=>JSON.stringify(row.path)==='[0,0]')?.node.id;expect(fresh).toEqual(expect.any(String));expect(originalIds).not.toContain(fresh);checkTransient229State(after,before,fresh,{revision:1,undo:1,redo:0});
  expect(mutations(after)).toHaveLength(1);expect(typed(after)).toHaveLength(1);const command=typed(after)[0];
  expect(command.request).toMatchObject({kind:'input_command',stamp:before.state.stamp,command:{id:'org.klenwriter.kwdj/command/insert-typed-text'}});expect(JSON.parse(command.request.command.payload_json)).toEqual({kind:'insert_typed_text',text:'é',origin:'composition_commit'});
  expect(command.response.status).toBe('ok');expect(command.response.value.kind).toBe('input_mutation');expect(command.response.value.effect).toBe('changed');expect(command.response.value.result).toBeNull();expect(command.response.value.state).toEqual(after.state);
  await call(page,'history',id,'undo');const undone=await checkpoint(page,id,'closing229: Undo restores old ID/full directed selection');checkTransient229State(undone,before,fresh,{restored:true,revision:2,undo:0,redo:1});expect(undone.rows.some(row=>row.node.id===fresh)).toBe(false);expect(mutations(undone)).toHaveLength(2);expect(typed(undone)).toHaveLength(1);expect(mutations(undone).at(-1).request).toMatchObject({kind:'history',direction:'undo'});
  await call(page,'history',id,'redo');const redone=await checkpoint(page,id,'closing229: Redo reuses composed ID/caret');checkTransient229State(redone,before,fresh,{revision:3,undo:1,redo:0});expect(redone.rows.some(row=>row.node.id===before.roles.text)).toBe(false);expect(mutations(redone)).toHaveLength(3);expect(typed(redone)).toHaveLength(1);expect(mutations(redone).at(-1).request).toMatchObject({kind:'history',direction:'redo'});
});
test('B48-controlled-transient-terminal closing229: subsequent ordinary beforeinput remains busy with original native frame',async({page})=>{
  const {id,before}=await mountTransient(page),delivery=await call(page,'transientTerminal229',id,'ordinary-after');observations.get(page).closing229Delivery=delivery;
  expect(delivery.keys).toEqual(expectedClosing229Keys);expect(delivery.events.at(-1)).toEqual({type:'beforeinput',inputType:'insertText',data:'é',isComposing:false,isTrusted:false,cancelable:true,defaultPrevented:true});
  await call(page,'frames',6);const after=await checkpoint(page,id,'closing229: no prospective ordinary permit or native replay');unchangedTransient(after,before);
  expect(after.recovery.composition.reason).toBe('busy');expect(after.recovery.composition.nativeOutcome).toBe('not_submitted');expect(after.recovery.composition.response).toBeNull();expect(after.domText).toBe('étail');expect(after.dom[1]).toEqual(before.dom[1]);expect(after.resources.typing).toEqual({armedSlots:0,backspaceCandidates:0,pendingDispatches:0,retainedBytes:0});
});
