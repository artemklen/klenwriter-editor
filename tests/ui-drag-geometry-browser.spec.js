// SPDX-License-Identifier: MIT OR Apache-2.0
import {test,expect} from '@playwright/test';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const caseBytes=readFileSync('contracts/drag/v1/geometry-cases.json');
const contract=JSON.parse(caseBytes);
const records=new WeakMap(),call=(page,method,...args)=>page.evaluate(({method,args})=>window.ui42[method](...args),{method,args});
const authored=id=>contract.cases.find(row=>row.id===id);
const scoped=(before,value)=>before.roles[value]??value;
const sourceRole='P3';

// Retain DOM snapshots/traces for failures, never screenshot this fixture.
test.use({trace:{mode:'retain-on-failure',screenshots:false,snapshots:true,sources:true}});

async function mount(page,config={}) {
  const value=await call(page,'mount',{geometry:'F',geometryOnly:true,nativeTrace:true,...config});
  expect(value.ready).toBe('ready');expect(value.uiCreated).toBe(false);
  records.get(page).mounts.add(value.id);return value.id;
}
async function checkpoint(page,id,label,options) {
  const value=await call(page,'inspect',id,...(options?[options]:[]));
  records.get(page).checkpoints.push({label,id,...value});return value;
}
async function read(page,id,source=sourceRole,point=null,insideParent=null,label='composite') {
  const value=await call(page,'dragGeometryRead',id,source,point,insideParent);
  records.get(page).reads.push({label,id,source,point,insideParent,value});return value;
}
function refusal(value,code,stamp) {
  expect(value).toEqual({status:'dom_refused',diagnostic:{code,phase:'geometry',stamp,node:null,typeId:null,publication:'none'}});
}
function work(value) {
  expect(value.status).toBe('drag_measured');
  expect(Object.keys(value.work).sort()).toEqual(['ancestors','childSlots','objects','rects']);
  for(const n of Object.values(value.work)){expect(Number.isSafeInteger(n)).toBe(true);expect(n).toBeGreaterThanOrEqual(0);}
  expect(value.work.objects+value.work.childSlots).toBeLessThanOrEqual(1024);
  expect(value.work.ancestors).toBeLessThanOrEqual(128);expect(value.work.rects).toBeLessThanOrEqual(256);
}
function header(value,before,role,literal) {
  expect(Object.keys(value).sort()).toEqual(['childCount','id','index','parent','primitive','typeId']);
  expect(value).toEqual({id:before.roles[role],...literal,parent:literal.parent===null?null:scoped(before,literal.parent)});
}
function destination(value,before,literal) {
  expect(value).toEqual(literal===null?null:{...literal,reference:scoped(before,literal.reference),parent:scoped(before,literal.parent)});
}
function unchanged(after,before) {
  for(const key of ['canonical','state','rows','events','failures','results','focusResults','resources','uiResources','context','activeId','activeTag','insideEditor'])
    expect(after[key],`geometry preserves ${key}`).toEqual(before[key]);
}
function inheritedMutationRecovery(after,before,facts,nativeBaseline) {
  // Owned DOM instrumentation itself invokes the pre-existing mounted mutation
  // recovery policy after this JS turn. It is separate from the pure read above.
  for(const key of ['canonical','state','rows','events','results','focusResults','uiResources'])
    expect(after[key],`controlled DOM mutation preserves native ${key}`).toEqual(before[key]);
  expect(after.resources.sdk).toEqual(before.resources.sdk);expect(facts.native).toEqual(nativeBaseline);
  expect(facts.lifecycle).toBe('recoveryRequired');expect(facts.stamp).toBeNull();expect(facts.context).toBeNull();
  expect(after.context).toBeNull();expect(after.hostAttributes.contenteditable).toBe('false');
  expect(after.failures).toEqual([...before.failures,{status:'dom_refused',diagnostic:{code:'dom.recovery_required',phase:'render',stamp:before.state.stamp,node:null,typeId:null,publication:'none'}}]);
}
async function observeUA(page,id,role='P2',fraction=0.5,border=false) {
  const value=await page.evaluate(({id,path,fraction,border})=>{
    let outer=document.getElementById(`${id}-editor`);for(const index of path)outer=outer.children[index];
    const box=outer.getBoundingClientRect(),rect=r=>({x:r.x,y:r.y,width:r.width,height:r.height});
    return {tag:outer.tagName,rects:[...outer.getClientRects()].map(rect),box:rect(box),point:{x:border?box.x+1:box.x+box.width/2,y:box.y+box.height*fraction},
      viewport:{x:0,y:0,width:document.documentElement.clientWidth,height:document.documentElement.clientHeight}};
  },{id,path:contract.fixture.roles[role],fraction,border});
  records.get(page).ua.push({id,role,fraction,border,...value});return value;
}
async function remember(page,id) {
  await page.evaluate(id=>{
    const host=document.getElementById(`${id}-editor`),walker=document.createTreeWalker(host,NodeFilter.SHOW_ALL),nodes=[];
    for(let node=walker.currentNode;node;node=walker.nextNode())nodes.push(node);
    const selection=document.getSelection(),ranges=[];
    for(let index=0;index<(selection?.rangeCount??0);index++){const r=selection.getRangeAt(index);ranges.push({a:r.startContainer,ao:r.startOffset,f:r.endContainer,fo:r.endOffset});}
    const saved={host,nodes,html:host.outerHTML,active:document.activeElement,
      selection:selection?{a:selection.anchorNode,ao:selection.anchorOffset,f:selection.focusNode,fo:selection.focusOffset,ranges}:null,
      scroll:[window.scrollX,window.scrollY,...[host,...host.querySelectorAll('*')].flatMap(node=>[node.scrollLeft,node.scrollTop])]};
    saved.observe=()=>{
      const current=document.getElementById(`${id}-editor`),walker=document.createTreeWalker(current,NodeFilter.SHOW_ALL),actual=[];
      for(let node=walker.currentNode;node;node=walker.nextNode())actual.push(node);
      const s=document.getSelection(),old=saved.selection;
      let sameSelection=(!s&&!old)||!!s&&!!old&&s.anchorNode===old.a&&s.anchorOffset===old.ao&&s.focusNode===old.f&&s.focusOffset===old.fo&&s.rangeCount===old.ranges.length;
      if(sameSelection&&s)for(let i=0;i<s.rangeCount;i++){const r=s.getRangeAt(i),o=old.ranges[i];sameSelection&&=r.startContainer===o.a&&r.startOffset===o.ao&&r.endContainer===o.f&&r.endOffset===o.fo;}
      return {identity:current===saved.host&&actual.length===saved.nodes.length&&actual.every((node,index)=>node===saved.nodes[index]),html:current.outerHTML===saved.html,selection:sameSelection,
        focus:document.activeElement===saved.active,scroll:JSON.stringify([window.scrollX,window.scrollY,...[current,...current.querySelectorAll('*')].flatMap(node=>[node.scrollLeft,node.scrollTop])])===JSON.stringify(saved.scroll)};
    };
    window.dragGeometrySaved??=new Map();window.dragGeometrySaved.set(id,saved);
  },id);
}
async function environmentUnchanged(page,id) {
  const actual=await page.evaluate(id=>window.dragGeometrySaved.get(id).observe(),id);
  records.get(page).environment.push({id,...actual});expect(actual).toEqual({identity:true,html:true,selection:true,focus:true,scroll:true});
}
async function dispose(page,id,sdkLifecycle='destroyed') {
  const result=await call(page,'destroy',id);records.get(page).mounts.delete(id);records.get(page).disposals.push({id,...result});
  for(const group of ['ui','dom','selection','clipboard','hostRequests','inputObservations','popupPresentation']) {
    const counts=group==='ui'?result.ui:result.mounted[group];expect(counts,group).toBeTruthy();
    for(const [key,value]of Object.entries(counts)){expect(typeof value,`${group}/${key}`).toBe('number');expect(value,`${group}/${key}`).toBe(0);}
  }
  expect(result.mounted.sdk.lifecycle).toBe(sdkLifecycle);
  for(const [key,value]of Object.entries(result.mounted.sdk))if(key!=='lifecycle'){expect(typeof value,`sdk/${key}`).toBe('number');expect(value,`sdk/${key}`).toBe(0);}
  if(records.get(page).mounts.size===0)expect(result.native).toEqual({sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});
}

test.beforeEach(async({page,browser},info)=>{
  const record={engine:info.project.name,browserVersion:browser.version(),installedBrowser:false,errors:[],externalRequests:[],reads:[],ua:[],checkpoints:[],environment:[],disposals:[],mounts:new Set()};records.set(page,record);
  page.on('pageerror',error=>record.errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:4174/'))record.externalRequests.push(request.url());});
  await page.addInitScript(()=>{window.dragGeometryPolicies=[];document.addEventListener('securitypolicyviolation',event=>window.dragGeometryPolicies.push({directive:event.violatedDirective,blocked:event.blockedURI}));});
  await page.setViewportSize({width:1280,height:1000});const response=await page.goto('/ui');await page.waitForFunction(()=>!!window.ui42);
  record.csp=response.headers()['content-security-policy'];expect(record.csp).toContain("default-src 'none'");expect(record.csp).not.toContain("'unsafe-inline'");expect(record.csp).not.toContain("'unsafe-eval'");
  record.manifest=await page.evaluate(()=>window.ui42.moduleManifest);record.userAgent=await page.evaluate(()=>navigator.userAgent);
  record.contractSha256=createHash('sha256').update(caseBytes).digest('hex');expect(createHash('sha256').update(readFileSync(contract.fixture.path)).digest('hex')).toBe(contract.fixture.sha256);
});
test.afterEach(async({page},info)=>{
  const record=records.get(page);if(!record)return;
  try {
    for(const id of [...record.mounts])await dispose(page,id);
    record.policyViolations=await page.evaluate(()=>window.dragGeometryPolicies);
    expect(record.errors).toEqual([]);expect(record.externalRequests).toEqual([]);expect(record.policyViolations).toEqual([]);
  } finally {
    record.status=info.status;record.scope=contract.allCases.scope;record.remainingMounts=[...record.mounts];delete record.mounts;
    mkdirSync('artifacts/drag/geometry',{recursive:true});const path=`artifacts/drag/geometry/${info.project.name}-${info.testId.replaceAll(/[^A-Za-z0-9_-]/g,'_')}.json`;
    writeFileSync(path,JSON.stringify(record,null,2)+'\n');await info.attach('drag-geometry-raw',{path,contentType:'application/json'});
  }
});

test('DG01 actual source-only compact headers preserve the original directed caret',async({page})=>{
  const id=await mount(page),before=await checkpoint(page,id,'native F before arm reads');expect(before.canonical).toBe(contract.fixture.canonical);await remember(page,id);
  for(const role of authored('DG01').input.source){const result=await read(page,id,role),ua=await observeUA(page,id,role);work(result);
    header(result.source,before,role,authored('DG01').expected.headers[role]);expect(result.sourceBox.rect).toEqual(ua.rects[0]);
    expect(result).toMatchObject({stamp:before.state.stamp,context:before.context,hit:null,insideParents:[],destination:null,targetBox:null});
    expect(result.sourceBox.clip).toEqual(ua.viewport);
  }
  unchanged(await checkpoint(page,id,'arm reads have no native publication'),before);await environmentUnchanged(page,id);
});

test('DG02 actual nested hit keeps its parent and exact pre-removal before/after slots',async({page})=>{
  const id=await mount(page),before=await checkpoint(page,id,'nested native roles');await remember(page,id);
  for(const [index,fraction]of authored('DG02').input.fractions.entries()){
    const ua=await observeUA(page,id,'P2',fraction),result=await read(page,id,sourceRole,ua.point);work(result);
    expect(result.hit.id).toBe(before.roles.P2);expect(result.insideParents.map(row=>row.id)).toEqual(['Q','R'].map(role=>before.roles[role]));
    destination(result.destination,before,authored('DG02').expected.destinations[index]);expect(result.targetBox.rect).toEqual(ua.rects[0]);
  }
  unchanged(await checkpoint(page,id,'nested reads publish nothing'),before);await environmentUnchanged(page,id);
});

test('DG03 explicit genuine parent choice appends and root keeps its native empty type ID',async({page})=>{
  const id=await mount(page),before=await checkpoint(page,id,'explicit-parent baseline'),ua=await observeUA(page,id);await remember(page,id);
  for(const [index,parent]of ['Q','R'].entries()){
    const result=await read(page,id,sourceRole,ua.point,parent);work(result);destination(result.destination,before,authored('DG03').expected.destinations[index]);
    const root=result.insideParents.find(row=>row.id===before.roles.R);header(root,before,'R',authored('DG03').expected.rootHeader);
    expect(result.hit.id).toBe(before.roles.P2);expect(result.targetBox.rect).toEqual((await observeUA(page,id,parent)).rects[0]);
  }
  refusal(await read(page,id,sourceRole,ua.point,'P'),authored('DG03').expected.nonmemberInsideParent,before.state.stamp);
  unchanged(await checkpoint(page,id,'explicit choice changes no document'),before);await environmentUnchanged(page,id);
});

test('DG04 container middle is measured without silently selecting an inside destination',async({page})=>{
  const id=await mount(page),before=await checkpoint(page,id,'container spatial policy');await remember(page,id);
  for(const [index,fraction]of authored('DG04').input.fractions.entries()){
    const ua=await observeUA(page,id,'Q',fraction,true),result=await read(page,id,sourceRole,ua.point);work(result);
    expect(result.hit.id).toBe(before.roles.Q);expect(result.insideParents.map(row=>row.id)).toEqual([before.roles.Q,before.roles.R]);
    destination(result.destination,before,authored('DG04').expected.destinations[index]);expect(result.targetBox.rect).toEqual(ua.rects[0]);
  }
  unchanged(await checkpoint(page,id,'no guessed parent publication'),before);await environmentUnchanged(page,id);
});

test('DG05 original five-token and complete session-context mismatches refuse before native reads',async({page})=>{
  const id=await mount(page),before=await checkpoint(page,id,'full authority baseline');await remember(page,id);
  const result=await page.evaluate(({id,before})=>{
    const base={kind:'drag',stamp:before.state.stamp,context:before.context,source:before.roles.P,point:null,insideParent:null},rows=[];
    const offset=window.ui42.nativeTrace(id).calls.length;
    for(const key of ['session','generation','revision','selection_epoch','history_epoch']){const request=structuredClone(base);request.stamp[key]+='-stale';rows.push({facet:key,result:window.ui42.geometryRawRead(id,request)});}
    for(const key of ['build_id','registry_digest','capability_digest','profile']){const request=structuredClone(base);if(key==='profile')request.context.profile.profile_version+='-stale';else request.context[key]+='-stale';rows.push({facet:key,result:window.ui42.geometryRawRead(id,request)});}
    return {lane:'Actual packaged native mount; request-data stale authorities',rows,nativeCalls:window.ui42.nativeTrace(id).calls.slice(offset)};
  },{id,before});records.get(page).staleAuthorities=result;
  expect(result.nativeCalls).toEqual([]);
  for(const row of result.rows)refusal(row.result,'dom.stale_selection',before.state.stamp);
  unchanged(await checkpoint(page,id,'all authority mismatches are pure'),before);await environmentUnchanged(page,id);
});

test('DG06 controlled closed malformed requests never invoke a getter or native read',async({page})=>{
  const id=await mount(page),before=await checkpoint(page,id,'closed-data baseline');await remember(page,id);
  const result=await page.evaluate(({id,before})=>{
    const base={kind:'drag',stamp:before.state.stamp,context:before.context,source:before.roles.P,point:null,insideParent:null},requests=[],clone=()=>structuredClone(base);let getterCalls=0;
    let value=clone();value.extra=true;requests.push(value);value=clone();Object.defineProperty(value,'point',{enumerable:true,get(){getterCalls++;throw new Error('Getter must not run');}});requests.push(value);
    value=clone();value.context.extra=true;requests.push(value);value=clone();value.context.profile.extra=true;requests.push(value);
    value=clone();value.context.profile.extensions=new Array(1);requests.push(value);value=clone();value.context=Object.assign(Object.create({foreign:true}),value.context);requests.push(value);
    value=clone();value.point={x:NaN,y:0};requests.push(value);value=clone();value.point={x:0,y:Infinity};requests.push(value);
    value=clone();value.insideParent=before.roles.R;requests.push(value);value=clone();value.kind='unknown';requests.push(value);
    const count=window.ui42.nativeTrace(id).calls.length,rows=requests.map(request=>window.ui42.geometryRawRead(id,request));
    return {lane:'Controlled malformed caller data only, actual native initialization and resource owner',rows,getterCalls,nativeCalls:window.ui42.nativeTrace(id).calls.slice(count)};
  },{id,before});records.get(page).malformed=result;
  expect(result.getterCalls).toBe(0);expect(result.nativeCalls).toEqual([]);for(const row of result.rows)refusal(row,'dom.invalid_options',before.state.stamp);
  unchanged(await checkpoint(page,id,'malformed caller data is pure'),before);await environmentUnchanged(page,id);
});

test('DG07 controlled same-ID clones and detached genuine objects never acquire authority',async({page})=>{
  const id=await mount(page),before=await checkpoint(page,id,'actual owner baseline'),ua=await observeUA(page,id);await remember(page,id);
  const result=await page.evaluate(({id,point})=>{
    const host=document.getElementById(`${id}-editor`),card=document.getElementById(id),rows=[];
    const selection=document.getSelection(),saved=selection?.anchorNode?{a:selection.anchorNode,ao:selection.anchorOffset,f:selection.focusNode,fo:selection.focusOffset}:null;
    const facts=()=>{const f=window.ui42.mountedFacts(id);return {lifecycle:f.lifecycle,stamp:f.stamp,context:f.context,resources:f.resources,native:f.native};};
    const probe=()=>{const s=document.getSelection(),a=s?.anchorNode,ao=s?.anchorOffset,f=s?.focusNode,fo=s?.focusOffset,beforeFacts=facts(),result=window.ui42.dragGeometryRead(id,'P3',point);return {result,beforeFacts,afterFacts:facts(),browserRangeUnchanged:s?.anchorNode===a&&s?.anchorOffset===ao&&s?.focusNode===f&&s?.focusOffset===fo};};
    try{
    for(const [name,node]of [['clone-target-P2',host.children[1].firstElementChild],['clone-source-P3',host.children[3]]]){
      const parent=node.parentNode,next=node.nextSibling,clone=node.cloneNode(true);node.replaceWith(clone);
      try{rows.push({name,sameId:node.id===clone.id,...probe()});}finally{parent.replaceChild(node,clone);if(node.nextSibling!==next)parent.insertBefore(node,next);}
    }
    const parent=card.parentNode,next=card.nextSibling;card.remove();try{rows.push({name:'detached-wrapper',...probe()});}finally{parent.insertBefore(card,next);}
    }finally{if(selection){selection.removeAllRanges();if(saved)selection.setBaseAndExtent(saved.a,saved.ao,saved.f,saved.fo);}}
    return {lane:'CONTROLLED synchronous DOM replacement/detachment on actual native objects; pure geometry refusal precedes inherited mounted mutation recovery; all original objects and browser range restored before leaving the turn',rows,restoredBeforeObserver:window.dragGeometrySaved.get(id).observe()};
  },{id,point:ua.point});records.get(page).controlledOwners=result;
  for(const row of result.rows){if(row.name.startsWith('clone'))expect(row.sameId).toBe(true);expect(row.browserRangeUnchanged).toBe(true);expect(row.afterFacts).toEqual(row.beforeFacts);refusal(row.result,'dom.selection_geometry_unsupported',before.state.stamp);}
  expect(result.restoredBeforeObserver).toEqual({identity:true,html:true,selection:true,focus:true,scroll:true});
  const after=await checkpoint(page,id,'controlled setup invokes inherited recovery; native facets unchanged'),facts=await call(page,'mountedFacts',id);
  records.get(page).controlledRecovery={cause:'existing mounted child-list mutation policy, not a geometry write',facts};inheritedMutationRecovery(after,before,facts,result.rows[0].beforeFacts.native);
});

test('DG08 foreign cover and other-mount browser objects are never genuine hit authority',async({page})=>{
  const id=await mount(page),other=await mount(page),before=await checkpoint(page,id,'first mount'),foreign=await checkpoint(page,other,'second independent native session');
  const point=(await observeUA(page,other)).point,foreignHit=await read(page,id,sourceRole,point);refusal(foreignHit,'dom.selection_geometry_unsupported',before.state.stamp);
  const ownPoint=(await observeUA(page,id)).point;
  const covered=await page.evaluate(({id,point})=>{const overlay=document.createElement('div');overlay.className='ui-fixture-foreign';document.body.append(overlay);try{return window.ui42.dragGeometryRead(id,'P3',point);}finally{overlay.remove();}},{id,point:ownPoint});
  refusal(covered,'dom.selection_geometry_unsupported',before.state.stamp);
  const foreignRequest={kind:'drag',stamp:foreign.state.stamp,context:foreign.context,source:foreign.roles.P,point:null,insideParent:null};
  refusal(await call(page,'geometryRawRead',id,foreignRequest),'dom.stale_selection',before.state.stamp);
  unchanged(await checkpoint(page,id,'foreign sources do not mutate first session'),before);unchanged(await checkpoint(page,other,'foreign sources do not mutate second session'),foreign);
});

test('DG09 controlled transform/nonfinite/fragmentation faults preserve every native facet',async({page})=>{
  const id=await mount(page),before=await checkpoint(page,id,'layout fault baseline');await remember(page,id);
  const result=await page.evaluate(id=>{
    const card=document.getElementById(id),atom=document.getElementById(`${id}-editor`).children[2],original=atom.getClientRects,rect=original.call(atom)[0],plain={x:rect.x,y:rect.y,width:rect.width,height:rect.height,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom},rows=[];
    try{card.classList.add('ui-geometry-transform');rows.push({fault:'transform',result:window.ui42.dragGeometryRead(id,'S')});card.classList.remove('ui-geometry-transform');
      atom.getClientRects=()=>[{...plain,x:NaN}];rows.push({fault:'nonfinite',result:window.ui42.dragGeometryRead(id,'S')});
      atom.getClientRects=()=>[plain,plain];rows.push({fault:'two-fragments',result:window.ui42.dragGeometryRead(id,'S')});
      return {lane:'Controlled actual DOM-method/layout faults, not UA-produced geometry',rows,original:plain};
    }finally{card.classList.remove('ui-geometry-transform');delete atom.getClientRects;}
  },id);records.get(page).controlledLayout=result;for(const row of result.rows)refusal(row.result,'dom.selection_geometry_unsupported',before.state.stamp);
  unchanged(await checkpoint(page,id,'layout faults restored without native mutation'),before);await environmentUnchanged(page,id);
});

test('DG10 controlled real native selection reentry rejects the entire composite frame',async({page})=>{
  const id=await mount(page),before=await checkpoint(page,id,'before explicit reentrant state-only setup'),ua=await observeUA(page,id);
  const result=await page.evaluate(async({id,point})=>{
    const p=document.getElementById(`${id}-editor`).children[3],original=p.getClientRects;let once=false,setup;
    try{p.getClientRects=function(){if(!once){once=true;setup=window.ui42.select(id,{anchor:{kind:'text',node:'T',offset:0,affinity:'after'},focus:{kind:'text',node:'T',offset:0,affinity:'after'}});}return original.call(this);};
      const result=window.ui42.dragGeometryRead(id,'P3',point);return {lane:'Controlled synchronous actual native set_selection during source UA geometry',result,setup:await setup};
    }finally{delete p.getClientRects;}
  },{id,point:ua.point});records.get(page).reentry=result;expect(result.setup.response.status).toBe('ok');
  const after=await checkpoint(page,id,'only explicit set_selection published');refusal(result.result,'dom.stale_selection',after.state.stamp);
  expect(after.canonical).toBe(before.canonical);expect(after.state.history).toEqual(before.state.history);expect(after.state.stamp.revision).toBe(before.state.stamp.revision);
  expect(after.state.stamp.selection_epoch).toBe(String(BigInt(before.state.stamp.selection_epoch)+1n));expect(after.events).toHaveLength(before.events.length+1);expect(after.events.at(-1).change.kind).toBe('state');
});

test('DG11 controlled transport Refused/Fatal responses stay original and every real owner releases',async({page})=>{
  for(const status of ['refused','fatal']){
    const id=await mount(page,{nativeTrace:false,controlledReadFault:true}),before=await checkpoint(page,id,`before controlled ${status}`);
    const result=await page.evaluate(({id,status})=>{window.ui42.nativeFault(id,status);return window.ui42.dragGeometryRead(id,'P');},{id,status}),facts=await call(page,'mountedFacts',id);
    const expected={status,diagnostic:{code:`fixture.controlled_${status}`,path:'/controlled-geometry-read',category:'transport',details:{fixture:'finite geometry read failure'},stamp:before.state.stamp,may_have_committed:false}};
    expect(facts.faultResponses).toEqual([expected]);expect(result).toEqual({status:'sdk_failure',response:expected});records.get(page).checkpoints.push({label:`controlled actual-module state ${status}`,result,facts});
    if(status==='refused')unchanged(await checkpoint(page,id,'refused state does not mutate'),before);
    else{expect(facts.lifecycle).toBe('fatal');expect(await page.locator(`#${id}-editor`).getAttribute('contenteditable')).toBe('false');}
    // SDK destroy() preserves an already-fatal lifecycle while releasing every
    // numeric resource. Every ordinary disposal keeps the exact destroyed check.
    await dispose(page,id,status==='fatal'?'fatal':'destroyed');
  }
});

test('DG12 CONTROLLED private-view source+hit share1024 object/child-slot units and cannot reset per subread',async({page})=>{
  const id=await mount(page),before=await checkpoint(page,id,'unrelated actual native baseline');await remember(page,id);
  const result=await page.evaluate(async()=>{
    const [{createDomView},{createMountedGeometry},{defineRendererCatalog}]=await Promise.all([import('/packages/dom/view.js'),import('/packages/dom/geometry.js'),import('/packages/dom/catalog.js')]);
    const stamp=Object.freeze({session:'controlled-drag-geometry',generation:'0',revision:'0',selection_epoch:'0',history_epoch:'0'});
    const profile=Object.freeze({profile_id:'fixture.drag.geometry',profile_version:'1',codec_id:'fixture.drag.geometry',wire_version:1,extensions:Object.freeze([])});
    const context=Object.freeze({build_id:'controlled-private-view',profile,registry_digest:'controlled-inventory',capability_digest:'controlled-capabilities'});
    const catalog=defineRendererCatalog({binding:{buildId:context.build_id,profile,registryDigest:context.registry_digest},inventory:{nodes:[{id:'P',owner:'fixture.drag.geometry',primitive:'text_block',attributes:[]},{id:'I',owner:'fixture.drag.geometry',primitive:'inline_atom',attributes:[]}],marks:[],commands:[]},
      nodes:{P:{primitive:'text_block',attributes:[],present:()=>({tag:'p'})},I:{primitive:'inline_atom',attributes:[],present:()=>({tag:'span',label:'·'})}},marks:{},commandGate:()=>null});
    if('status'in catalog)throw new Error(JSON.stringify(catalog));
    const wrapper=document.createElement('div'),host=document.createElement('div');host.className='ui-fixture-editor';wrapper.append(host);document.body.append(wrapper);
    const node=(id,parent,primitive,type_id,children=[])=>({stamp,id,parent,primitive,type_id,attributes:{},marks:[],text:null,children,changed_revision:'0',stats:{authored_nodes:'1',text_utf8:'0',text_utf16:'0',height:'1'}});
    const left=Array.from({length:254},(_,i)=>`L${i}`),right=Array.from({length:254},(_,i)=>`I${i}`),rows=new Map([['R',node('R',null,'root','',['P','Q'])],['P',node('P','R','text_block','P',left)],['Q',node('Q','R','text_block','P',right)],...left.map(id=>[id,node(id,'P','inline_atom','I')]),...right.map(id=>[id,node(id,'Q','inline_atom','I')])]);
    const state={stamp,root:'R',selection:null,stored_marks:null,dirty:false,saved_revision:'0',history:{undo_entries:'0',redo_entries:'0',retained_bytes:'0'}};
    const view=createDomView({element:host,catalog,readNode:(_stamp,id)=>({status:'ok',value:{kind:'node',node:rows.get(id)}})});
    let stateReads=0,extra;
    try{
      const initialized=view.initialize(state);if(initialized)throw new Error(JSON.stringify(initialized));
      const api=createMountedGeometry({element:()=>host,view:()=>view,capture:()=>stamp,context:()=>context,readState:()=>{stateReads++;return {status:'ok',value:{kind:'state',state}};},guard:()=>null});
      const request=(source,point=null)=>({kind:'drag',stamp,context,source,point,insideParent:null});
      const q=host.children[1],rect=q.getBoundingClientRect(),point={x:rect.x+rect.width/2,y:rect.y+rect.height/8};
      const separateP=api.read(request('P')),separateQ=api.read(request('Q')),combined=api.read(request('P',point));
      const immutable=Object.isFrozen(combined)&&Object.isFrozen(combined.context)&&Object.isFrozen(combined.context.profile.extensions)&&Object.isFrozen(combined.source)&&Object.isFrozen(combined.sourceBox)&&Object.isFrozen(combined.sourceBox.rect)&&Object.isFrozen(combined.sourceBox.clip)&&Object.isFrozen(combined.insideParents)&&Object.isFrozen(combined.destination)&&Object.isFrozen(combined.work);
      extra=document.createElement('div');wrapper.before(extra);extra.append(wrapper);const excess=api.read(request('P',point));
      return {lane:'CONTROLLED private native-row DTO topology only, actual createDomView-owned DOM/geometry; not shipped-profile/native semantic proof',stamp,separateP,separateQ,combined,excess,immutable,stateReads,
        independentAccounting:{ownedBlocks:2,opaqueInlineAtoms:508,rootHost:1,externalWrapper:1,bodyAndHtml:2,objects:514,rootChildSlots:2,inlineChildSlots:508,childSlots:510,total:1024,extraWrapperTotal:1025}};
    }finally{view.destroy();host.remove();wrapper.remove();extra?.remove();}
  });records.get(page).controlledPrivateView=result;
  work(result.separateP);work(result.separateQ);work(result.combined);expect(result.combined.work.objects).toBe(514);expect(result.combined.work.childSlots).toBe(510);
  expect(result.combined.work.objects+result.combined.work.childSlots).toBe(1024);expect(result.immutable).toBe(true);expect(result.stateReads).toBe(4);
  refusal(result.excess,'dom.selection_limit',result.stamp);unchanged(await checkpoint(page,id,'controlled view touched no actual native session'),before);await environmentUnchanged(page,id);
});

test('DG13 actual external ancestor objects count128 across the entire composite then refuse129',async({page})=>{
  const id=await mount(page),before=await checkpoint(page,id,'ancestor bound baseline');await remember(page,id);
  const result=await page.evaluate(id=>{
    const host=document.getElementById(`${id}-editor`),atom=host.children[2],parent=host.parentNode,next=host.nextSibling,wrappers=[];let count=0,child=host;
    const selection=document.getSelection(),saved=selection?.anchorNode?{a:selection.anchorNode,ao:selection.anchorOffset,f:selection.focusNode,fo:selection.focusOffset}:null;
    const probe=()=>{const s=document.getSelection(),a=s?.anchorNode,ao=s?.anchorOffset,f=s?.focusNode,fo=s?.focusOffset,n=s?.rangeCount,result=window.ui42.dragGeometryRead(id,'S');return {result,pure:s?.anchorNode===a&&s?.anchorOffset===ao&&s?.focusNode===f&&s?.focusOffset===fo&&s?.rangeCount===n};};
    for(let current=atom.parentElement;current;current=current.parentElement)count++;
    try{for(let i=count;i<128;i++){const wrapper=document.createElement('div');child.before(wrapper);wrapper.append(child);wrappers.push(wrapper);child=wrapper;}
      const exact=probe(),extra=document.createElement('div');child.before(extra);extra.append(child);wrappers.push(extra);const excess=probe();
      return {lane:'Controlled external nonclipping ancestor chain, actual owned native Scene atom and actual UA boxes; test-owned reparenting range restored separately',originalAncestorCount:count,exact:exact.result,excess:excess.result,geometryBrowserRangeUnchanged:[exact.pure,excess.pure]};
    }finally{parent.insertBefore(host,next);for(const wrapper of wrappers)wrapper.remove();if(selection){selection.removeAllRanges();if(saved)selection.setBaseAndExtent(saved.a,saved.ao,saved.f,saved.fo);}}
  },id);records.get(page).ancestorLimit=result;work(result.exact);expect(result.exact.work.ancestors).toBe(128);expect(result.geometryBrowserRangeUnchanged).toEqual([true,true]);refusal(result.excess,'dom.selection_limit',before.state.stamp);
  unchanged(await checkpoint(page,id,'ancestor-only setup restored'),before);await environmentUnchanged(page,id);
});

test('DG14 controlled actual clip ancestors share256 raw rect reads including final revalidation',async({page})=>{
  const id=await mount(page),before=await checkpoint(page,id,'rect bound baseline');await remember(page,id);
  const result=await page.evaluate(id=>{
    const host=document.getElementById(`${id}-editor`),atom=host.children[2],parent=host.parentNode,next=host.nextSibling,wrappers=[],original=atom.getClientRects;
    const selection=document.getSelection(),saved=selection?.anchorNode?{a:selection.anchorNode,ao:selection.anchorOffset,f:selection.focusNode,fo:selection.focusOffset}:null;
    const facts=()=>{const f=window.ui42.mountedFacts(id);return {lifecycle:f.lifecycle,stamp:f.stamp,context:f.context,resources:f.resources,native:f.native};};
    const probe=()=>{const s=document.getSelection(),a=s?.anchorNode,ao=s?.anchorOffset,f=s?.focusNode,fo=s?.focusOffset,n=s?.rangeCount,beforeFacts=facts(),result=window.ui42.dragGeometryRead(id,'S');return {result,beforeFacts,afterFacts:facts(),pure:s?.anchorNode===a&&s?.anchorOffset===ao&&s?.focusNode===f&&s?.focusOffset===fo&&s?.rangeCount===n};};
    const classes=new Map();let count=0,child=host,calls=0,outcome;
    for(let current=atom.parentElement;current;current=current.parentElement)count++;
    try{
      for(let i=count;i<128;i++){const wrapper=document.createElement('div');child.before(wrapper);wrapper.append(child);wrappers.push(wrapper);child=wrapper;}
      const chain=[];for(let current=atom.parentElement;current;current=current.parentElement)chain.push(current);
      for(const element of chain){classes.set(element,element.getAttribute('class'));if(element!==document.documentElement)element.classList.add('ui-fixture-clip');}
      atom.getClientRects=function(){calls++;return original.call(this);};const exact=probe(),exactCalls=calls;
      document.documentElement.classList.add('ui-fixture-clip');const excess=probe();
      outcome={lane:'CONTROLLED finite clipping topology on actual native atom; actual UA rectangle getters with read-count observation, no fabricated rectangles; applying clip class to observed host invokes inherited mutation recovery after the turn',totalAncestors:chain.length,clippingAncestorsExact:chain.length-1,exact:exact.result,excess:excess.result,geometryBrowserRangeUnchanged:[exact.pure,excess.pure],readFacts:[{before:exact.beforeFacts,after:exact.afterFacts},{before:excess.beforeFacts,after:excess.afterFacts}],exactFragmentCalls:exactCalls,totalFragmentCalls:calls};
    }finally{delete atom.getClientRects;for(const [element,value]of classes){if(value===null)element.removeAttribute('class');else element.setAttribute('class',value);}parent.insertBefore(host,next);for(const wrapper of wrappers)wrapper.remove();if(selection){selection.removeAllRanges();if(saved)selection.setBaseAndExtent(saved.a,saved.ao,saved.f,saved.fo);}}
    return {...outcome,restoredBeforeObserver:window.dragGeometrySaved.get(id).observe()};
  },id);records.get(page).rectLimit=result;work(result.exact);expect(result.totalAncestors).toBe(128);expect(result.clippingAncestorsExact).toBe(127);
  expect(result.exact.work.rects).toBe(256);expect(result.exactFragmentCalls).toBe(2);expect(result.geometryBrowserRangeUnchanged).toEqual([true,true]);refusal(result.excess,'dom.selection_limit',before.state.stamp);
  for(const facts of result.readFacts)expect(facts.after).toEqual(facts.before);
  expect(result.restoredBeforeObserver).toEqual({identity:true,html:true,selection:true,focus:true,scroll:true});
  const after=await checkpoint(page,id,'clipping setup invokes inherited recovery; native facets unchanged'),facts=await call(page,'mountedFacts',id);
  records.get(page).controlledRecovery={cause:'existing mounted host-attribute mutation policy, not a geometry write',facts};inheritedMutationRecovery(after,before,facts,result.readFacts[0].before.native);
});

test('DG15 controlled final rect hook cannot return a detached original as a successful witness',async({page})=>{
  const id=await mount(page),before=await checkpoint(page,id,'final witness baseline');await remember(page,id);
  const result=await page.evaluate(id=>{
    const atom=document.getElementById(`${id}-editor`).children[2],parent=atom.parentNode,next=atom.nextSibling,original=atom.getClientRects,selection=document.getSelection(),rangeBefore={a:selection?.anchorNode,ao:selection?.anchorOffset,f:selection?.focusNode,fo:selection?.focusOffset},saved=selection?.anchorNode?{a:selection.anchorNode,ao:selection.anchorOffset,f:selection.focusNode,fo:selection.focusOffset}:null;let calls=0,result;
    const facts=()=>{const f=window.ui42.mountedFacts(id);return {lifecycle:f.lifecycle,stamp:f.stamp,context:f.context,resources:f.resources,native:f.native};},beforeFacts=facts();
    let afterFacts,geometryBrowserRangeUnchanged;
    try{atom.getClientRects=function(){const old=original.call(this);if(++calls===2)atom.remove();return old;};result=window.ui42.dragGeometryRead(id,'S');afterFacts=facts();geometryBrowserRangeUnchanged=selection?.anchorNode===rangeBefore.a&&selection?.anchorOffset===rangeBefore.ao&&selection?.focusNode===rangeBefore.f&&selection?.focusOffset===rangeBefore.fo;}
    finally{delete atom.getClientRects;if(!atom.isConnected)parent.insertBefore(atom,next);if(selection){selection.removeAllRanges();if(saved)selection.setBaseAndExtent(saved.a,saved.ao,saved.f,saved.fo);}}
    return {lane:'CONTROLLED synchronous detach exactly on final genuine source fragment read; pure geometry refusal precedes inherited mounted mutation recovery; no native edit',result,calls,beforeFacts,afterFacts,geometryBrowserRangeUnchanged,restoredBeforeObserver:window.dragGeometrySaved.get(id).observe()};
  },id);records.get(page).finalWitness=result;expect(result.calls).toBe(2);refusal(result.result,'dom.selection_geometry_unsupported',before.state.stamp);
  expect(result.afterFacts).toEqual(result.beforeFacts);expect(result.geometryBrowserRangeUnchanged).toBe(true);expect(result.restoredBeforeObserver).toEqual({identity:true,html:true,selection:true,focus:true,scroll:true});
  const after=await checkpoint(page,id,'final witness setup invokes inherited recovery; native facets unchanged'),facts=await call(page,'mountedFacts',id);
  records.get(page).controlledRecovery={cause:'existing mounted child-list mutation policy, not a geometry write',facts};inheritedMutationRecovery(after,before,facts,result.beforeFacts.native);
});

test('DG16 actual native state-only calls stay pure across repetitions and readOnly/disabled modes',async({page})=>{
  const id=await mount(page);
  for(const mode of ['editable','readOnly','disabled']){
    if(mode!=='editable')expect((await call(page,'mode',id,mode,true)).status).toBe('updated');
    const before=await checkpoint(page,id,`${mode} native baseline`);await remember(page,id);
    const result=await page.evaluate(id=>{
      const rows=[];for(let i=0;i<3;i++){const offset=window.ui42.nativeTrace(id).calls.length,result=window.ui42.dragGeometryRead(id,'P3');rows.push({result,calls:window.ui42.nativeTrace(id).calls.slice(offset)});}return {lane:'Actual native Session pass-through trace, no controlled response',rows,trace:window.ui42.nativeTrace(id)};
    },id);records.get(page).checkpoints.push({label:`${mode} actual call bytes`,result});expect(result.trace.overflow).toBe(false);
    for(const row of result.rows){work(row.result);expect(row.calls).toHaveLength(1);expect(JSON.parse(row.calls[0].requestJson)).toEqual({kind:'state'});expect(JSON.parse(row.calls[0].responseJson).status).toBe('ok');}
    unchanged(await checkpoint(page,id,`${mode} repeated reads preserve every facet`),before);await environmentUnchanged(page,id);
  }
});

test('DG17 CONTROLLED subpixel owned-hit transit grants no drop authority and preserves strict refusal boundaries',async({page})=>{
  const spec=authored('DG17'),id=await mount(page),other=await mount(page);
  const before=await checkpoint(page,id,'subpixel controlled baseline'),foreign=await checkpoint(page,other,'independent foreign mount baseline');
  const original=await read(page,id,spec.input.source);work(original);await remember(page,id);await remember(page,other);
  const result=await page.evaluate(({id,other,spec})=>{
    const host=document.getElementById(`${id}-editor`),target=host.children[1],card=document.getElementById(id),foreign=document.getElementById(`${other}-editor`).children[1];
    const oldRect=Object.getOwnPropertyDescriptor(target,'getClientRects'),oldHit=Object.getOwnPropertyDescriptor(document,'elementFromPoint'),oldCardRect=Object.getOwnPropertyDescriptor(card,'getBoundingClientRect'),oldClass=card.getAttribute('class');
    const rect=({x,y,width,height})=>({x,y,width,height,left:x,top:y,right:x+width,bottom:y+height});
    const restore=(object,key,value)=>value?Object.defineProperty(object,key,value):delete object[key];
    const facts=()=>{const f=window.ui42.mountedFacts(id);return {lifecycle:f.lifecycle,stamp:f.stamp,context:f.context,resources:f.resources,native:f.native};};
    const originalCardBox=rect(card.getBoundingClientRect()),rows=[];
    try{
      for(const row of spec.input.rows){
        let clipping=null;
        try{
          const measured=rect({...spec.input.controlledRect,...(row.fault==='zero-width'?{width:0}:{})});
          Object.defineProperty(target,'getClientRects',{configurable:true,value:()=>[measured]});
          const actualHit=row.fault==='other-genuine-mount-hit'?foreign:target;
          Object.defineProperty(document,'elementFromPoint',{configurable:true,value:()=>actualHit});
          if(row.fault==='clip-top-at-rect-top'||row.fault==='clip-top-at-point'){
            card.classList.add('ui-fixture-clip');
            const clipTop=row.fault==='clip-top-at-point'?row.point.y:spec.input.controlledRect.y;
            const controlled=rect({...originalCardBox,y:clipTop-card.clientTop});
            Object.defineProperty(card,'getBoundingClientRect',{configurable:true,value:()=>controlled});
            clipping={top:controlled.y+card.clientTop,pointY:row.point.y};
          }
          const beforeFacts=facts(),browserBefore=window.dragGeometrySaved.get(id).observe(),offset=window.ui42.nativeTrace(id).calls.length;
          const value=window.ui42.dragGeometryRead(id,spec.input.source,row.point,row.insideParent??null);
          rows.push({id:row.id,point:row.point,insideParent:row.insideParent??null,measuredRect:measured,clipping,
            hitOwned:host.contains(actualHit),value,beforeFacts,afterFacts:facts(),browserBefore,browserAfter:window.dragGeometrySaved.get(id).observe(),calls:window.ui42.nativeTrace(id).calls.slice(offset)});
        }finally{
          restore(target,'getClientRects',oldRect);restore(document,'elementFromPoint',oldHit);restore(card,'getBoundingClientRect',oldCardRect);
          if(oldClass===null)card.removeAttribute('class');else card.setAttribute('class',oldClass);
        }
      }
    }finally{
      restore(target,'getClientRects',oldRect);restore(document,'elementFromPoint',oldHit);restore(card,'getBoundingClientRect',oldCardRect);
      if(oldClass===null)card.removeAttribute('class');else card.setAttribute('class',oldClass);
    }
    return {lane:spec.expected.qualification,rows,traceOverflow:window.ui42.nativeTrace(id).overflow};
  },{id,other,spec});records.get(page).controlledSubpixel=result;
  expect(result.rows.map(row=>row.id)).toEqual(spec.input.rows.map(row=>row.id));expect(result.traceOverflow).toBe(false);
  for(const [index,row]of result.rows.entries()){
    const expected=spec.input.rows[index];expect(row.afterFacts).toEqual(row.beforeFacts);
    expect(row.browserBefore).toEqual({identity:true,html:true,selection:true,focus:true,scroll:true});expect(row.browserAfter).toEqual(row.browserBefore);
    expect(row.calls.map(call=>JSON.parse(call.requestJson))).toEqual(spec.expected.nativeRequestsPerRead.map(kind=>({kind})));
    expect(row.calls.every(call=>call.outcome==='returned'&&JSON.parse(call.responseJson).status==='ok')).toBe(true);
    expect(row.hitOwned).toBe(expected.fault!=='other-genuine-mount-hit');
    if(expected.fault==='clip-top-at-rect-top'){expect(row.clipping.top).toBe(spec.input.controlledRect.y);expect(row.clipping.pointY).toBe(row.clipping.top-0.5);}
    if(expected.fault==='clip-top-at-point'){expect(row.clipping.top).toBe(expected.point.y);expect(row.clipping.pointY).toBe(row.clipping.top);}
    if(expected.outcome==='refused')refusal(row.value,spec.expected.refusalCode,before.state.stamp);
    else{
      work(row.value);header(row.value.source,before,spec.input.source,authored('DG01').expected.headers.P3);
      expect(row.value.stamp).toEqual(before.state.stamp);expect(row.value.context).toEqual(before.context);expect(row.value.sourceBox).toEqual(original.sourceBox);expect(row.value.viewport).toEqual(original.viewport);
      if(expected.outcome==='source_only')expect(row.value).toMatchObject(spec.expected.sourceOnly);
      else{
        header(row.value.hit,before,spec.input.hit,authored('DG01').expected.headers.Q);expect(row.value.insideParents.map(parent=>parent.id)).toEqual([before.roles.Q,before.roles.R]);
        destination(row.value.destination,before,spec.expected.ordinaryDestination);expect(row.value.targetBox.rect).toEqual(spec.input.controlledRect);
      }
    }
  }
  unchanged(await checkpoint(page,id,'controlled border reads leave complete native facets unchanged'),before);
  unchanged(await checkpoint(page,other,'foreign mount stays unchanged'),foreign);await environmentUnchanged(page,id);await environmentUnchanged(page,other);
});
