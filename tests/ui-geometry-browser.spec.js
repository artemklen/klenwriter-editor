// SPDX-License-Identifier: MIT OR Apache-2.0
import {test,expect} from '@playwright/test';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const fixtureBytes=readFileSync('contracts/ui/v1/geometry-fixtures.json');
const frozen=JSON.parse(fixtureBytes),observations=new WeakMap();
const call=(page,method,...args)=>page.evaluate(({method,args})=>window.ui42[method](...args),{method,args});
const textPoint=(node,offset)=>({kind:'text',node,offset,affinity:'after'});
const range=(node,anchor,focus=anchor)=>({anchor:textPoint(node,anchor),focus:textPoint(node,focus)});

async function mount(page,config={geometry:'F'}) {
  const result=await call(page,'mount',config);
  expect(result.ready).toBe('ready');expect(result.uiReady).toBe('ready');
  observations.get(page).mounts.add(result.id);return result.id;
}
async function inspect(page,id,label) {
  const point=await call(page,'inspect',id);observations.get(page).checkpoints.push({label,id,...point});return point;
}
async function measured(page,id,request,label) {
  const value=await call(page,'geometryRead',id,request);observations.get(page).reads.push({label,id,request,value});return value;
}
function refused(value,code,stamp,node=null) {
  expect(value).toEqual({status:'dom_refused',diagnostic:{code,phase:'geometry',stamp,node,typeId:null,publication:'none'}});
}
function pure(after,before) {
  for(const key of ['state','rows','canonical','events','failures','resources','context','activeId','activeTag','insideEditor'])expect(after[key],`geometry preserves ${key}`).toEqual(before[key]);
}
async function dispose(page,id,target=page) {
  const result=await call(target,'destroy',id);observations.get(page).mounts.delete(id);observations.get(page).disposals.push({id,frame:target!==page,...result});
  expect(result.mounted.dom).toEqual({listeners:0,observers:0,continuations:0,retainedInputBytes:0,retainedRecoveryRegions:0});
  expect(result.mounted.selection).toEqual({bookmarks:0,restoreTickets:0,activePointers:0,animationFrames:0});
  expect(result.mounted.clipboard).toEqual({pending:0,continuations:0,retainedTextBytes:0});
  expect(result.mounted.hostRequests).toEqual({pending:0,focusContinuations:0});
  for(const key of ['sessions','listeners','queued_mutations','queued_bytes','pending_tickets','host_requests','task_continuations'])expect(result.mounted.sdk[key],key).toBe(0);
  return result;
}
async function rememberEnvironment(page,id) {
  await page.evaluate(id=>{
    const host=document.getElementById(`${id}-editor`),nodes=[host,...host.querySelectorAll('*')];
    const walker=document.createTreeWalker(host,NodeFilter.SHOW_ALL),all=[];for(let node=walker.currentNode;node;node=walker.nextNode())all.push(node);
    const selection=document.getSelection(),ranges=[];
    for(let i=0;i<(selection?.rangeCount??0);i++){const r=selection.getRangeAt(i);ranges.push({start:r.startContainer,startOffset:r.startOffset,end:r.endContainer,endOffset:r.endOffset});}
    window.geometryEnvironments??=new Map();window.geometryEnvironments.set(id,{host,all,html:host.outerHTML,active:document.activeElement,
      selection:selection?{anchor:selection.anchorNode,anchorOffset:selection.anchorOffset,focus:selection.focusNode,focusOffset:selection.focusOffset,ranges}:null,
      scroll:[window.scrollX,window.scrollY,...nodes.flatMap(node=>[node.scrollLeft,node.scrollTop])]});
  },id);
}
async function unchangedEnvironment(page,id) {
  expect(await page.evaluate(id=>{
    const saved=window.geometryEnvironments.get(id),host=document.getElementById(`${id}-editor`),walker=document.createTreeWalker(host,NodeFilter.SHOW_ALL),all=[];
    for(let node=walker.currentNode;node;node=walker.nextNode())all.push(node);
    const selection=document.getSelection(),ranges=[];
    for(let i=0;i<(selection?.rangeCount??0);i++){const r=selection.getRangeAt(i);ranges.push({start:r.startContainer,startOffset:r.startOffset,end:r.endContainer,endOffset:r.endOffset});}
    const current=selection?{anchor:selection.anchorNode,anchorOffset:selection.anchorOffset,focus:selection.focusNode,focusOffset:selection.focusOffset,ranges}:null;
    const sameSelection=(!saved.selection&&!current)||!!saved.selection&&!!current&&saved.selection.anchor===current.anchor&&saved.selection.anchorOffset===current.anchorOffset&&saved.selection.focus===current.focus&&saved.selection.focusOffset===current.focusOffset&&saved.selection.ranges.length===ranges.length&&ranges.every((r,i)=>r.start===saved.selection.ranges[i].start&&r.startOffset===saved.selection.ranges[i].startOffset&&r.end===saved.selection.ranges[i].end&&r.endOffset===saved.selection.ranges[i].endOffset);
    return {identity:host===saved.host&&all.length===saved.all.length&&all.every((node,index)=>node===saved.all[index]),html:host.outerHTML===saved.html,focus:document.activeElement===saved.active,selection:sameSelection,
      scroll:JSON.stringify([window.scrollX,window.scrollY,...[host,...host.querySelectorAll('*')].flatMap(node=>[node.scrollLeft,node.scrollTop])])===JSON.stringify(saved.scroll)};
  },id)).toEqual({identity:true,html:true,focus:true,selection:true,scroll:true});
}
async function uaBlock(page,id,fixture,role) {
  return page.evaluate(({id,path})=>{
    let outer=document.getElementById(`${id}-editor`);for(const index of path)outer=outer.children[index];
    return {tag:outer.tagName,rects:[...outer.getClientRects()].map(({x,y,width,height})=>({x,y,width,height}))};
  },{id,path:frozen.fixtures[fixture].roles[role]});
}
async function uaSelection(page,id,fixture,selection) {
  return page.evaluate(({id,paths,selection})=>{
    const host=document.getElementById(`${id}-editor`),rect=r=>({x:r.x,y:r.y,width:r.width,height:r.height});
    const outer=role=>paths[role].reduce((node,index)=>node.children[index],host);
    const point=p=>{
      const node=outer(p.kind==='child'?p.parent:p.node);
      if(p.kind==='text'){const text=document.createTreeWalker(node,NodeFilter.SHOW_TEXT).nextNode();return {node:text,offset:p.offset};}
      if(p.kind==='child')return {node,offset:p.index};
      return {node:node.parentNode,offset:[...node.parentNode.childNodes].indexOf(node)+(p.side==='after'?1:0)};
    };
    const a=point(selection.anchor),f=point(selection.focus),ar=document.createRange(),fr=document.createRange(),body=document.createRange();
    ar.setStart(a.node,a.offset);ar.collapse(true);fr.setStart(f.node,f.offset);fr.collapse(true);
    const order=ar.compareBoundaryPoints(Range.START_TO_START,fr),start=order<=0?a:f,end=order<=0?f:a;
    body.setStart(start.node,start.offset);body.setEnd(end.node,end.offset);
    const unique=raw=>{const values=raw.filter(r=>r.height>0&&r.width>=0&&Object.values(r).every(Number.isFinite));return values.length&&values.every(v=>JSON.stringify(v)===JSON.stringify(values[0]))?values[0]:null;};
    const anchorRects=[...ar.getClientRects()].map(rect),focusRects=[...fr.getClientRects()].map(rect);
    return {rects:[...body.getClientRects()].map(rect),anchor:unique(anchorRects),focus:unique(focusRects),anchorRects,focusRects};
  },{id,paths:frozen.fixtures[fixture].roles,selection});
}

test.beforeEach(async({page,browser},info)=>{
  const record={engine:info.project.name,browserVersion:browser.version(),installedBrowser:false,errors:[],externalRequests:[],reads:[],checkpoints:[],disposals:[],mounts:new Set()};observations.set(page,record);
  page.on('pageerror',error=>record.errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:4174/'))record.externalRequests.push(request.url());});
  await page.addInitScript(()=>{window.geometryViolations=[];document.addEventListener('securitypolicyviolation',event=>window.geometryViolations.push({directive:event.violatedDirective,blocked:event.blockedURI}));});
  const loaded=await page.goto('/ui');record.csp=loaded.headers()['content-security-policy'];
  expect(record.csp).toContain("default-src 'none'");expect(record.csp).not.toContain("'unsafe-inline'");expect(record.csp).not.toMatch(/(?:^|\s)'unsafe-eval'/);
  await page.waitForFunction(()=>!!window.ui42);
  record.manifest=await page.evaluate(()=>window.ui42.moduleManifest);record.fixtureSha256=createHash('sha256').update(fixtureBytes).digest('hex');
});
test.afterEach(async({page},info)=>{
  const record=observations.get(page);if(!record)return;
  try {
    for(const id of [...record.mounts])await dispose(page,id);
    if(record.disposals.length)expect(record.disposals.at(-1).native).toEqual({sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});
    record.policyViolations=await page.evaluate(()=>window.geometryViolations);
    expect(record.errors).toEqual([]);expect(record.externalRequests).toEqual([]);expect(record.policyViolations).toEqual([]);
  } finally {
    record.status=info.status;record.scope='Actual packaged mounted DOM/SDK/WASM; independent frozen geometry fixtures and raw UA measurements. DOM method/transport fault cases explicitly labelled controlled. Automated Chromium/WebKit/experimental Firefox, not installed OS input or independent formal review.';
    record.remainingMounts=[...record.mounts];delete record.mounts;
    mkdirSync('artifacts/ui/geometry',{recursive:true});const path=`artifacts/ui/geometry/${info.project.name}-${info.testId.replaceAll(/[^A-Za-z0-9_-]/g,'_')}.json`;
    writeFileSync(path,JSON.stringify(record,null,2)+'\n');await info.attach('mounted-ui-geometry-observations',{path,contentType:'application/json'});
  }
});

test('G01–04 actual owned paragraphs, containers and scene atom use their own UA boxes',async({page})=>{
  for(const [fixture,roles]of [['F',['P','P2','Q','S','P3']],['L',['L','I','P']],['E',['P']],['BR',['P']]]) {
    const id=await mount(page,{geometry:fixture}),before=await inspect(page,id,`${fixture} before geometry`);
    expect(before.canonical).toBe(frozen.fixtures[fixture].canonical_json);await rememberEnvironment(page,id);
    for(const role of roles) {
      const actual=await measured(page,id,{kind:'block',node:role},`${fixture}/${role}`),ua=await uaBlock(page,id,fixture,role);
      expect(actual.status).toBe('measured');expect(actual.target).toEqual({kind:'block',node:before.roles[role]});
      expect(actual.stamp).toEqual(before.state.stamp);expect(actual.context).toEqual(before.context);
      expect(actual.rects).toEqual(ua.rects);expect(actual.anchor).toEqual(ua.rects.find(rect=>rect.height>0));expect(actual.focus).toBeNull();expect(actual.visible).toBe(true);
      if(role==='S'){expect(ua.tag).toBe('HR');expect(await page.locator(`#${id}-editor > hr`).getAttribute('contenteditable')).toBe('false');}
    }
    for(const role of ['R',...('T'in frozen.fixtures[fixture].roles?['T']:[]),...('BR'in frozen.fixtures[fixture].roles?['BR']:[])])refused(await measured(page,id,{kind:'block',node:role},`ineligible ${fixture}/${role}`),'dom.selection_geometry_unsupported',before.state.stamp,before.roles[role]);
    pure(await inspect(page,id,`${fixture} geometry is pure`),before);await unchangedEnvironment(page,id);await dispose(page,id);
  }
});

test('G05–06 actual hit ancestry resolves paragraph/quote/separator and rejects foreign cover/root padding',async({page})=>{
  const id=await mount(page),before=await inspect(page,id,'hit baseline');
  const probes=await page.evaluate(id=>{
    const host=document.getElementById(`${id}-editor`),p=host.children[1].firstElementChild,q=host.children[1],scene=host.children[2];
    const mid=node=>{const r=node.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};},qbox=q.getBoundingClientRect(),h=host.getBoundingClientRect();
    return {P2:mid(p.firstElementChild),Q:{x:qbox.x+7,y:qbox.y+4},S:mid(scene),rootPadding:{x:h.x+3,y:h.y+3}};
  },id);
  for(const role of ['P2','Q','S']){const result=await measured(page,id,{kind:'block_at_point',...probes[role]},`hit ${role}`);expect(result.status).toBe('measured');expect(result.target).toEqual({kind:'block',node:before.roles[role]});}
  for(const point of [probes.rootPadding,{x:-1,y:-1},{x:100000,y:100000}])refused(await measured(page,id,{kind:'block_at_point',...point},'no eligible hit'),'dom.selection_geometry_unsupported',before.state.stamp);
  const covered=await page.evaluate(({id,point})=>{
    const overlay=document.createElement('div');overlay.className='ui-fixture-foreign';document.body.append(overlay);
    try{return window.ui42.geometryRead(id,{kind:'block_at_point',...point});}finally{overlay.remove();}
  },{id,point:probes.P2});refused(covered,'dom.selection_geometry_unsupported',before.state.stamp);
  pure(await inspect(page,id,'hit reads preserve native state'),before);
});

test('G07/G11 native directed Unicode and marked BR ranges use independent actual Range measurements',async({page})=>{
  for(const [fixture,selection,config]of [
    ['F',frozen.fixtures.F.selection,{}],['F',range('T',5,1),{}],['RTL',frozen.fixtures.RTL.selection,{direction:'rtl'}],
    ['BR',{anchor:textPoint('T',0),focus:textPoint('U',1)},{}],
  ]) {
    const id=await mount(page,{geometry:fixture,...config});expect((await call(page,'select',id,selection)).response.status).toBe('ok');
    // A genuine foreign browser selection is presentation only; it must not
    // become authority for this native selection geometry request.
    await page.evaluate(()=>{const button=document.getElementById('ui-before');button.focus();const range=document.createRange();range.selectNodeContents(button);const selection=document.getSelection();selection.removeAllRanges();selection.addRange(range);});
    const before=await inspect(page,id,`${fixture} directed baseline`);await rememberEnvironment(page,id);
    const ua=await uaSelection(page,id,fixture,selection),actual=await measured(page,id,{kind:'selection'},`${fixture} directed raw UA`);
    if(ua.anchor){expect(actual.status).toBe('measured');expect(actual.rects).toEqual(ua.rects);expect(actual.anchor).toEqual(ua.anchor);expect(actual.focus).toEqual(ua.focus);expect(actual.target).toEqual({kind:'selection',selection:before.state.selection});expect(actual.visible).toBe(true);}
    else refused(actual,'dom.selection_geometry_unsupported',before.state.stamp);
    pure(await inspect(page,id,`${fixture} directed read is pure`),before);await unchangedEnvironment(page,id);await dispose(page,id);
  }
});

test('G10 native null selection refuses without synthesizing the visible browser range',async({page})=>{
  const id=await mount(page),selected=await call(page,'select',id,null);expect(selected.response.status).toBe('ok');
  const before=await inspect(page,id,'null native range');expect(before.state.selection).toBeNull();await rememberEnvironment(page,id);
  refused(await measured(page,id,{kind:'selection'},'null selection'),'dom.selection_missing',before.state.stamp);
  pure(await inspect(page,id,'null remains pure'),before);await unchangedEnvironment(page,id);
});

test('G12–13 actual rectangular clipping keeps raw boxes, partial visibility and fully clipped targets',async({page})=>{
  const id=await mount(page);
  await page.evaluate(id=>{const host=document.getElementById(`${id}-editor`),clip=document.createElement('div');clip.className='ui-fixture-clip';host.before(clip);clip.append(host);},id);
  const before=await inspect(page,id,'external clip baseline');await rememberEnvironment(page,id);
  const first=await measured(page,id,{kind:'block',node:'P'},'partially clipped P'),last=await measured(page,id,{kind:'block',node:'P3'},'fully clipped P3');
  expect(first.status).toBe('measured');expect(first.visible).toBe(true);expect(first.rects).toEqual((await uaBlock(page,id,'F','P')).rects);
  expect(first.clip.height).toBeLessThan(first.anchor.height+20);expect(first.anchor.y+first.anchor.height).toBeGreaterThan(first.clip.y+first.clip.height);
  expect(last.status).toBe('measured');expect(last.visible).toBe(false);expect(last.rects).toEqual((await uaBlock(page,id,'F','P3')).rects);
  pure(await inspect(page,id,'clipping does not focus or scroll'),before);await unchangedEnvironment(page,id);
  await page.locator(`#${id}-editor`).evaluate(host=>host.parentElement.className='ui-geometry-zero-clip');
  const zeroBefore=await inspect(page,id,'zero-height external clip');await rememberEnvironment(page,id);
  const zero=await measured(page,id,{kind:'block',node:'P'},'measurable block in empty effective clip');
  expect(zero.status).toBe('measured');expect(zero.clip.height).toBe(0);expect(zero.visible).toBe(false);
  pure(await inspect(page,id,'empty clip preserves all facets'),zeroBefore);await unchangedEnvironment(page,id);
});

test('G14 same native tokens produce fresh actual layout after viewport resize',async({page})=>{
  await page.setViewportSize({width:1200,height:900});const id=await mount(page),before=await inspect(page,id,'wide baseline');
  const wide=await measured(page,id,{kind:'block',node:'P'},'wide actual layout');expect(wide.status).toBe('measured');
  await page.setViewportSize({width:640,height:700});const narrow=await measured(page,id,{kind:'block',node:'P'},'narrow actual layout');
  expect(narrow.status).toBe('measured');expect(narrow.stamp).toEqual(wide.stamp);expect(narrow.rects).toEqual((await uaBlock(page,id,'F','P')).rects);expect(narrow.anchor.width).toBeLessThan(wide.anchor.width);
  expect(narrow.viewport.width).toBe(640);pure(await inspect(page,id,'resize changes no native fields'),before);
});

test('G15 clipped middle rows refuse even when the two endpoint clipping chains match',async({page})=>{
  const id=await mount(page);await page.locator(`#${id}`).evaluate(wrapper=>wrapper.classList.add('ui-geometry-middle-clip'));
  const selection={anchor:textPoint('T',0),focus:textPoint('V',2)};expect((await call(page,'select',id,selection)).response.status).toBe('ok');
  const before=await inspect(page,id,'matching endpoints with clipped intervening quote');await rememberEnvironment(page,id);
  expect(await page.locator(`#${id}-editor > blockquote`).evaluate(node=>getComputedStyle(node).overflowY)).toBe('hidden');
  refused(await measured(page,id,{kind:'selection'},'heterogeneous middle clip'),'dom.selection_geometry_unsupported',before.state.stamp);
  pure(await inspect(page,id,'heterogeneous clip read is pure'),before);await unchangedEnvironment(page,id);
});

test('G16–17 controlled raw-rectangle boundary accepts 256 and refuses 257 without truncation',async({page})=>{
  const id=await mount(page),before=await inspect(page,id,'controlled rect-cap baseline');await rememberEnvironment(page,id);
  const result=await page.evaluate(id=>{
    const atom=document.getElementById(`${id}-editor`).children[2],original=atom.getClientRects,actual=original.call(atom)[0];
    const rectangle={x:actual.x,y:actual.y,width:actual.width,height:actual.height,left:actual.left,top:actual.top,right:actual.right,bottom:actual.bottom};
    try {
      atom.getClientRects=()=>Array.from({length:256},()=>rectangle);const exact=window.ui42.geometryRead(id,{kind:'block',node:'S'});
      atom.getClientRects=()=>Array.from({length:257},()=>rectangle);const excess=window.ui42.geometryRead(id,{kind:'block',node:'S'});
      return {lane:'controlled DOM measurement return on a genuine actual block_atom',rectangle,exact,excess};
    }finally{delete atom.getClientRects;}
  },id);observations.get(page).controlledRectCap=result;
  expect(result.exact.status).toBe('measured');expect(result.exact.rects).toHaveLength(256);for(const rect of result.exact.rects)expect(rect).toEqual(Object.fromEntries(['x','y','width','height'].map(key=>[key,result.rectangle[key]])));
  refused(result.excess,'dom.selection_geometry_unsupported',before.state.stamp,before.roles.S);
  pure(await inspect(page,id,'controlled cap leaves native and presentation intact'),before);await unchangedEnvironment(page,id);
});

test('G16–17 actual nonclipping ancestor boundary counts all 128 objects then refuses 129',async({page})=>{
  const id=await mount(page),before=await inspect(page,id,'ancestor-cap baseline');
  const result=await page.evaluate(id=>{
    const host=document.getElementById(`${id}-editor`),atom=host.children[2],parent=host.parentNode,next=host.nextSibling;
    let baseline=0;for(let p=atom.parentElement;p;p=p.parentElement)baseline++;
    const wrappers=[];let child=host;
    try {
      for(let i=baseline;i<128;i++){const wrapper=document.createElement('div');child.before(wrapper);wrapper.append(child);wrappers.push(wrapper);child=wrapper;}
      const exact=window.ui42.geometryRead(id,{kind:'block',node:'S'}),extra=document.createElement('div');child.before(extra);extra.append(child);wrappers.push(extra);
      return {lane:'actual external nonclipping DOM ancestors, genuine mounted scene atom',baseline,exact,excess:window.ui42.geometryRead(id,{kind:'block',node:'S'})};
    }finally{parent.insertBefore(host,next);for(const wrapper of wrappers)wrapper.remove();}
  },id);observations.get(page).ancestorBoundary=result;
  expect(result.baseline).toBeGreaterThan(0);expect(result.exact.status).toBe('measured');refused(result.excess,'dom.selection_geometry_unsupported',before.state.stamp,before.roles.S);
  pure(await inspect(page,id,'external ancestors restored'),before);
});

test('G18 conservative actual CSS limitations refuse with no focus, scroll or native change',async({page})=>{
  const id=await mount(page);
  for(const suffix of ['transform','perspective','clip-path','mask','zoom','vertical','rounded-clip','hidden']) {
    await page.locator(`#${id}`).evaluate((node,name)=>node.classList.add(`ui-geometry-${name}`),suffix);
    const before=await inspect(page,id,`unsupported CSS ${suffix}`);await rememberEnvironment(page,id);
    refused(await measured(page,id,{kind:'block',node:'P'},suffix),'dom.selection_geometry_unsupported',before.state.stamp,before.roles.P);
    pure(await inspect(page,id,`${suffix} read is pure`),before);await unchangedEnvironment(page,id);
    await page.locator(`#${id}`).evaluate((node,name)=>node.classList.remove(`ui-geometry-${name}`),suffix);
  }
});

test('G08–09/G18 controlled caret uniqueness, nonfinite measurements and zero-width actual-form caret',async({page})=>{
  const id=await mount(page);expect((await call(page,'select',id,range('T',1))).response.status).toBe('ok');const before=await inspect(page,id,'controlled caret baseline');await rememberEnvironment(page,id);
  const result=await page.evaluate(id=>{
    const proto=Range.prototype,original=proto.getClientRects,host=document.getElementById(`${id}-editor`),atom=host.children[2],atomOriginal=atom.getClientRects;
    const text=host.children[0].firstElementChild.firstChild,range=document.createRange();range.setStart(text,1);range.collapse(true);
    const actual=original.call(range)[0]??atomOriginal.call(atom)[0],r={x:actual.x,y:actual.y,width:0,height:actual.height,left:actual.x,right:actual.x,top:actual.y,bottom:actual.y+actual.height};
    try {
      proto.getClientRects=function(){return this.collapsed?[r]:original.call(this);};const zero=window.ui42.geometryRead(id,{kind:'selection'});
      proto.getClientRects=function(){return this.collapsed?[]:original.call(this);};const empty=window.ui42.geometryRead(id,{kind:'selection'});
      proto.getClientRects=function(){return this.collapsed?[r,{...r,x:r.x+1,left:r.left+1,right:r.right+1}]:original.call(this);};const ambiguous=window.ui42.geometryRead(id,{kind:'selection'});
      proto.getClientRects=original;atom.getClientRects=()=>[{...r,x:NaN}];const nonfinite=window.ui42.geometryRead(id,{kind:'block',node:'S'});
      return {lane:'controlled DOM measurement faults, real mounted native selection; not a UA caret-layout assertion',zero,empty,ambiguous,nonfinite};
    }finally{proto.getClientRects=original;delete atom.getClientRects;}
  },id);observations.get(page).controlledCaret=result;
  expect(result.zero.status).toBe('measured');expect(result.zero.anchor.width).toBe(0);expect(result.zero.anchor.height).toBeGreaterThan(0);expect(result.zero.focus).toEqual(result.zero.anchor);
  for(const key of ['empty','ambiguous'])refused(result[key],'dom.selection_geometry_unsupported',before.state.stamp);
  refused(result.nonfinite,'dom.selection_geometry_unsupported',before.state.stamp,before.roles.S);
  pure(await inspect(page,id,'controlled range methods restored'),before);await unchangedEnvironment(page,id);
});

test('G09 controlled missing/nonfinite focus stays nullable when the actual anchor is usable',async({page})=>{
  const id=await mount(page),before=await inspect(page,id,'usable native anchor, controlled unusable focus');await rememberEnvironment(page,id);
  const result=await page.evaluate(id=>{
    const original=Range.prototype.getClientRects,results=[];
    try {
      for(const kind of ['empty','nonfinite']) {
        Range.prototype.getClientRects=function(){
          if(this.collapsed&&this.startOffset===5)return kind==='empty'?[]:[{x:NaN,y:0,width:0,height:24,left:NaN,right:NaN,top:0,bottom:24}];
          return original.call(this);
        };
        results.push({kind,read:window.ui42.geometryRead(id,{kind:'selection'})});
      }
      return {lane:'Controlled focus-only Range result fault; actual native directed range and actual anchor',results};
    }finally{Range.prototype.getClientRects=original;}
  },id);observations.get(page).controlledNullableFocus=result;
  for(const {read}of result.results){expect(read.status).toBe('measured');expect(read.anchor.height).toBeGreaterThan(0);expect(read.focus).toBeNull();expect(read.target.selection).toEqual(before.state.selection);}
  pure(await inspect(page,id,'nullable focus read is pure'),before);await unchangedEnvironment(page,id);
});

test('G19 each of the five full stamp fields independently refuses stale requests',async({page})=>{
  const id=await mount(page),before=await inspect(page,id,'full-token baseline');await rememberEnvironment(page,id);
  for(const key of ['session','generation','revision','selection_epoch','history_epoch']) {
    const stamp={...before.state.stamp,[key]:key==='session'?`${before.state.stamp.session}-other`:String(BigInt(before.state.stamp[key])+1n)};
    refused(await measured(page,id,{kind:'block',node:'P',stamp},`stale ${key}`),'dom.stale_selection',before.state.stamp,before.roles.P);
  }
  pure(await inspect(page,id,'all stale reads are pure'),before);await unchangedEnvironment(page,id);
});

test('G20 controlled synchronous native selection reentry rejects the mixed measurement stamp',async({page})=>{
  const id=await mount(page),before=await inspect(page,id,'before controlled native reentry');
  const result=await page.evaluate(id=>{
    const p=document.getElementById(`${id}-editor`).children[0],original=p.getClientRects;let once=false,mutation;
    try {p.getClientRects=function(){if(!once){once=true;mutation=window.ui42.select(id,{anchor:{kind:'text',node:'T',offset:0,affinity:'after'},focus:{kind:'text',node:'T',offset:0,affinity:'after'}});}return original.call(this);};const read=window.ui42.geometryRead(id,{kind:'block',node:'P'});return Promise.resolve(mutation).then(setup=>({lane:'controlled synchronous native mutation during actual browser measurement',read,setup}));}
    finally{delete p.getClientRects;}
  },id);observations.get(page).controlledReentry=result;
  expect(result.setup.response.status).toBe('ok');const after=await inspect(page,id,'after only the explicit reentrant setup mutation');
  expect(after.state.stamp.selection_epoch).toBe(String(BigInt(before.state.stamp.selection_epoch)+1n));
  refused(result.read,'dom.stale_selection',after.state.stamp,before.roles.P);expect(after.canonical).toBe(before.canonical);expect(after.state.history).toEqual(before.state.history);
  expect(after.events).toHaveLength(before.events.length+1);expect(after.events.at(-1).change.kind).toBe('state');
});

test('G21 closed malformed request shapes refuse before native or presentation changes',async({page})=>{
  const id=await mount(page),before=await inspect(page,id,'malformed request baseline');await rememberEnvironment(page,id);
  const results=await page.evaluate(({id,stamp})=>{
    const missing={...stamp};delete missing.history_epoch;
    const requests=[null,{}, {kind:'unknown',stamp},{kind:'block',stamp,node:42},{kind:'block',stamp,node:'P',extra:true},{kind:'selection',stamp,extra:true},{kind:'selection',stamp:missing},{kind:'block_at_point',stamp,x:NaN,y:0},{kind:'block_at_point',stamp,x:0,y:Infinity}];
    return requests.map(request=>window.ui42.geometryRawRead(id,request));
  },{id,stamp:before.state.stamp});observations.get(page).malformed=results;
  for(const result of results)refused(result,'dom.invalid_options',before.state.stamp);
  pure(await inspect(page,id,'malformed reads preserve all facets'),before);await unchangedEnvironment(page,id);
});

test('G22–23 unknown IDs, detached genuine targets and same-ID clones never gain authority',async({page})=>{
  const id=await mount(page),before=await inspect(page,id,'ownership baseline');
  refused(await measured(page,id,{kind:'block',node:'unknown-native-node'},'unknown ID'),'dom.selection_geometry_unsupported',before.state.stamp,'unknown-native-node');
  const detached=await page.evaluate(id=>{
    const wrapper=document.getElementById(id),parent=wrapper.parentNode,next=wrapper.nextSibling;wrapper.remove();
    try{return window.ui42.geometryRead(id,{kind:'block',node:'P'});}finally{parent.insertBefore(wrapper,next);}
  },id);refused(detached,'dom.selection_geometry_unsupported',before.state.stamp,before.roles.P);
  const cloned=await page.evaluate(id=>{
    const host=document.getElementById(`${id}-editor`),genuine=host.firstElementChild,clone=genuine.cloneNode(true);genuine.replaceWith(clone);
    const rect=clone.getBoundingClientRect(),byId=window.ui42.geometryRead(id,{kind:'block',node:'P'}),hit=window.ui42.geometryRead(id,{kind:'block_at_point',x:rect.x+rect.width/2,y:rect.y+rect.height/2});
    return {byId,hit,sameIds:clone.id===genuine.id&&clone.firstElementChild.id===genuine.firstElementChild.id};
  },id);expect(cloned.sameIds).toBe(true);refused(cloned.byId,'dom.selection_geometry_unsupported',before.state.stamp,before.roles.P);refused(cloned.hit,'dom.selection_geometry_unsupported',before.state.stamp);
  const recovered=await measured(page,id,{kind:'block',node:'P'},'after observer sees clone');refused(recovered,'dom.recovery_required',before.state.stamp);
});

test('G24 replacement rotates actual object authority even when old same-ID DOM is reattached',async({page})=>{
  const id=await mount(page),before=await inspect(page,id,'pre-replacement');
  await page.evaluate(id=>{window.geometryOldObjects??=new Map();window.geometryOldObjects.set(id,document.getElementById(`${id}-editor`).firstElementChild);},id);
  expect((await call(page,'replace',id,frozen.fixtures.F.canonical_json)).response.status).toBe('ok');const current=await inspect(page,id,'new native generation');
  expect(current.state.stamp.generation).not.toBe(before.state.stamp.generation);
  refused(await measured(page,id,{kind:'block',node:before.roles.P,stamp:before.state.stamp},'old generation'),'dom.stale_selection',current.state.stamp,before.roles.P);
  const result=await page.evaluate(id=>{
    const host=document.getElementById(`${id}-editor`),old=window.geometryOldObjects.get(id);host.firstElementChild.replaceWith(old);const rect=old.getBoundingClientRect();
    return window.ui42.geometryRead(id,{kind:'block_at_point',x:rect.x+rect.width/2,y:rect.y+rect.height/2});
  },id);refused(result,'dom.selection_geometry_unsupported',current.state.stamp);
});

test('G25 readOnly, disabled and native read-only permit measurement without granting editing',async({page})=>{
  const id=await mount(page);
  for(const mode of ['readOnly','disabled']) {
    expect((await call(page,'mode',id,mode)).status).toBe('updated');const before=await inspect(page,id,`${mode} baseline`);await rememberEnvironment(page,id);
    expect((await measured(page,id,{kind:'block',node:'P'},mode)).status).toBe('measured');pure(await inspect(page,id,`${mode} pure geometry`),before);await unchangedEnvironment(page,id);
  }
  const ro=await mount(page,{geometry:'E',access:'read_only'}),before=await inspect(page,ro,'native read-only baseline');
  expect((await measured(page,ro,{kind:'block',node:'P'},'native read-only paragraph')).status).toBe('measured');pure(await inspect(page,ro,'native read-only pure geometry'),before);
});

test('G26 protected composition refuses geometry while preserving the exact provisional objects',async({page})=>{
  const id=await mount(page);await call(page,'editorFocus',id);
  await page.locator(`#${id}-editor`).dispatchEvent('compositionstart',{data:''});
  const before=await inspect(page,id,'synthetic composition lifecycle, actual mounted native range');await rememberEnvironment(page,id);
  refused(await measured(page,id,{kind:'selection'},'protected composition'),'dom.composition_conflict',before.state.stamp);
  pure(await inspect(page,id,'protected geometry is pure'),before);await unchangedEnvironment(page,id);
});

test('G27 actual native subscriber delivery refuses geometry as busy without another publication',async({page})=>{
  const id=await mount(page);await call(page,'select',id,range('V',2));const before=await inspect(page,id,'before real native subscriber probe');
  await call(page,'geometryProbeNextEvent',id,'P');expect((await call(page,'command',id,{kind:'insert_text',text:'X'})).response.status).toBe('ok');
  const facts=await call(page,'mountedFacts',id);observations.get(page).busyProbe=facts;expect(facts.geometryProbeResults).toHaveLength(1);
  refused(facts.geometryProbeResults[0],'dom.busy',facts.stamp);
  const after=await inspect(page,id,'only the explicit command published');expect(after.events).toHaveLength(before.events.length+1);expect(after.state.stamp.revision).toBe(String(BigInt(before.state.stamp.revision)+1n));
  expect(after.state.history.undo_entries).toBe('1');expect(JSON.parse(after.canonical).content[3].content[0].text).toBe('efX');
});

test('G28–29 controlled actual-module state Refused/Fatal survives unchanged and fatal closes geometry',async({page})=>{
  for(const status of ['refused','fatal']) {
    const id=await mount(page,{geometry:'F',controlledReadFault:true}),before=await inspect(page,id,`before controlled transport ${status}`);
    const result=await page.evaluate(({id,status})=>{window.ui42.nativeFault(id,status);return window.ui42.geometryRead(id,{kind:'block',node:'P'});},{id,status});
    const facts=await call(page,'mountedFacts',id);observations.get(page).checkpoints.push({label:`controlled actual-module ${status}`,lane:'Only one state reply substituted; all initialization/resources/native delegation actual WASM',result,facts});
    expect(facts.faultResponses).toHaveLength(1);expect(result).toEqual({status:'sdk_failure',response:facts.faultResponses[0]});expect(result.response.status).toBe(status);
    if(status==='refused'){expect(facts.lifecycle).toBe('ready');pure(await inspect(page,id,'native refusal preserves original state'),before);}
    else {
      expect(facts.lifecycle).toBe('fatal');expect(await page.locator(`#${id}-editor`).getAttribute('contenteditable')).toBe('false');
      const disposed=await call(page,'geometryRawRead',id,{kind:'block',node:before.roles.P,stamp:before.state.stamp});refused(disposed,'dom.disposed',null);
    }
    await dispose(page,id);
  }
});

test('G28 actual loading, subscriber disposing and destroyed lifecycle precede malformed or stale requests',async({page})=>{
  const loading=await call(page,'mount',{geometry:'F',delayed:true});observations.get(page).mounts.add(loading.id);
  expect(loading).toMatchObject({lifecycle:'loading',uiCreated:false});
  const malformed=[null,{}, {kind:'selection',stamp:{session:'old',generation:'0',revision:'0',selection_epoch:'0',history_epoch:'0'}}];
  for(const request of malformed)refused(await call(page,'geometryRawRead',loading.id,request),'dom.not_ready',null);
  const loadingFacts=await call(page,'mountedFacts',loading.id);expect(loadingFacts.lifecycle).toBe('loading');expect(loadingFacts.resources.sdk.sessions).toBe(0);expect(loadingFacts.native).toBeNull();
  const destroyedLoading=await call(page,'destroyMountedProbe',loading.id);observations.get(page).checkpoints.push({label:'actual loading destroy and late loader release',loadingFacts,destroyedLoading});
  expect(destroyedLoading.immediate.phase).toBe('destroyed');refused(destroyedLoading.immediate.geometry,'dom.disposed',null);expect(destroyedLoading.facts.lifecycle).toBe('destroyed');
  for(const request of malformed)refused(await call(page,'geometryRawRead',loading.id,request),'dom.disposed',null);
  await dispose(page,loading.id);

  const id=await mount(page),before=await inspect(page,id,'before actual subscriber requests queued destroy');
  const result=await call(page,'destroySubscriberProbe',id,{kind:'insert_text',text:'x'});observations.get(page).checkpoints.push({label:'actual geometry during disposing and after native destroy',result});
  expect(result.result.status).toBe('completed');expect(result.result.response.status).toBe('ok');expect(result.probes).toHaveLength(1);
  expect(result.probes[0]).toMatchObject({phase:'disposing',sdkTicket:'queued'});
  const terminalStamp=result.result.response.value.state.stamp;
  expect(terminalStamp.revision).toBe(String(BigInt(before.state.stamp.revision)+1n));
  refused(result.probes[0].geometry,'dom.disposed',terminalStamp);
  expect(result.facts.lifecycle).toBe('destroyed');expect(result.facts.resources.sdk.sessions).toBe(0);expect(result.facts.resources.dom.listeners).toBe(0);
  for(const request of malformed)refused(await call(page,'geometryRawRead',id,request),'dom.disposed',null);
});

test('G18 actual iframe embedding refuses under the unchanged child CSP and releases its native session',async({page})=>{
  const childResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/ui');
  const parent=await page.goto('/ui-frame'),child=await childResponse,record=observations.get(page);
  record.iframe={parentCsp:parent.headers()['content-security-policy'],childCsp:child.headers()['content-security-policy']};
  expect(record.iframe.parentCsp).toContain("frame-src 'self'");expect(record.iframe.childCsp).toBe(record.csp);
  const handle=await page.locator('#ui-embedded').elementHandle(),frame=await handle.contentFrame();expect(frame).not.toBeNull();await frame.waitForFunction(()=>!!window.ui42);
  const mounted=await call(frame,'mount',{geometry:'F',geometryOnly:true});expect(mounted).toMatchObject({ready:'ready',uiCreated:false});
  try {
    const before=await call(frame,'mountedFacts',mounted.id);await rememberEnvironment(frame,mounted.id);
    const result=await call(frame,'geometryRead',mounted.id,{kind:'block',node:'P'});refused(result,'dom.selection_geometry_unsupported',before.stamp,mounted.roles.P);
    const after=await call(frame,'mountedFacts',mounted.id);expect(after).toEqual(before);await unchangedEnvironment(frame,mounted.id);
    record.iframe.read={before,result,after};record.iframe.policyViolations=await frame.evaluate(()=>window.geometryViolations);expect(record.iframe.policyViolations).toEqual([]);
  } finally {await dispose(page,mounted.id,frame);}
});

test('G04/G05/G16–17 labelled private-view owned inline atom and exact 1024 object boundary',async({page})=>{
  const result=await page.evaluate(async()=>{
    const [{createDomView},{createMountedGeometry},{defineRendererCatalog}]=await Promise.all([import('/packages/dom/view.js'),import('/packages/dom/geometry.js'),import('/packages/dom/catalog.js')]);
    const stamp=Object.freeze({session:'controlled-private-view',generation:'0',revision:'0',selection_epoch:'0',history_epoch:'0'});
    const profile={profile_id:'fixture.geometry',profile_version:'1',codec_id:'fixture.geometry',wire_version:1,extensions:[]};
    const context=Object.freeze({build_id:'controlled-private-view',profile,registry_digest:'controlled-inventory',capability_digest:'controlled-capabilities'});let currentContext=context;
    const definitions=[['P','text_block','p'],['BR','hard_break','br'],['I','inline_atom','span']];
    const catalog=defineRendererCatalog({binding:{buildId:context.build_id,profile,registryDigest:context.registry_digest},
      inventory:{nodes:definitions.map(([id,primitive])=>({id,owner:'fixture.geometry',primitive,attributes:[]})),marks:[],commands:[]},
      nodes:Object.fromEntries(definitions.map(([id,primitive,tag])=>[id,{primitive,attributes:[],present:()=>id==='I'?{tag,label:'inline'}:{tag}}])),marks:{},commandGate:()=>null});
    if('status'in catalog)throw new Error(JSON.stringify(catalog));
    const host=document.createElement('div');host.className='ui-fixture-editor';document.querySelector('#ui-mounts').append(host);
    let rows,state,view;
    const node=(id,parent,primitive,type_id,children=[])=>({stamp,id,parent,primitive,type_id,attributes:{},marks:[],text:null,children,changed_revision:'0',stats:{authored_nodes:'1',text_utf8:'0',text_utf16:'0',height:'1'}});
    const seed=count=>{
      const children=Array.from({length:count},(_,i)=>`B${i}`);
      rows=new Map([['R',node('R',null,'root','',['P'])],['P',node('P','R','text_block','P',children)],...children.map(id=>[id,node(id,'P','hard_break','BR')])]);
      state={stamp,root:'R',selection:{anchor:{kind:'child',parent:'P',index:0,affinity:'after'},focus:{kind:'child',parent:'P',index:count,affinity:'after'}},stored_marks:null,dirty:false,saved_revision:'0',history:{undo_entries:'0',redo_entries:'0',retained_bytes:'0'}};
      const outcome=view.initialize(state);if(outcome)throw new Error(JSON.stringify(outcome));
    };
    view=createDomView({element:host,catalog,readNode:(_stamp,id)=>({status:'ok',value:{kind:'node',node:rows.get(id)}})});
    const api=createMountedGeometry({element:()=>host,view:()=>view,capture:()=>stamp,context:()=>currentContext,readState:()=>({status:'ok',value:{kind:'state',state}}),guard:()=>null});
    const proto=Range.prototype,original=proto.getClientRects;
    try {
      seed(1023);const exactBlock=api.read({kind:'block',node:'P',stamp});
      const p=host.firstElementChild,box=p.getBoundingClientRect(),one={x:box.x,y:box.y,width:0,height:24,left:box.x,right:box.x,top:box.y,bottom:box.y+24};
      // Isolate visited-object accounting from the independent raw-fragment cap.
      proto.getClientRects=()=>[one];const exactSelection=api.read({kind:'selection',stamp});
      seed(1024);const excessBlock=api.read({kind:'block',node:'P',stamp}),excessSelection=api.read({kind:'selection',stamp});
      proto.getClientRects=original;
      rows=new Map([['R',node('R',null,'root','',['P'])],['P',node('P','R','text_block','P',['I'])],['I',node('I','P','inline_atom','I')]]);state={...state,selection:null};
      const initialized=view.initialize(state);if(initialized)throw new Error(JSON.stringify(initialized));
      const inline=host.firstElementChild.firstElementChild,ir=inline.getBoundingClientRect(),atom=api.read({kind:'block',node:'I',stamp}),hit=api.read({kind:'block_at_point',x:ir.x+ir.width/2,y:ir.y+ir.height/2,stamp});
      const block=host.firstElementChild,blockRects=block.getClientRects;
      let changedContext;
      try{block.getClientRects=function(){currentContext=Object.freeze({...context,capability_digest:'controlled-changed-context'});return blockRects.call(this);};changedContext=api.read({kind:'block',node:'P',stamp});}
      finally{delete block.getClientRects;currentContext=context;}
      return {lane:'Finite private-view correspondence with genuine owned DOM and controlled row DTOs/one-rect Range return; no native semantic or shipped-profile admission claim',stamp,
        exactObjects:1024,excessObjects:1025,exactBlock,exactSelection,excessBlock,excessSelection,changedContext,inline:{tag:inline.tagName,label:inline.textContent,editable:inline.getAttribute('contenteditable'),atom,hit},
        immutable:Object.isFrozen(exactBlock)&&Object.isFrozen(exactBlock.rects)&&Object.isFrozen(exactBlock.rects[0])&&Object.isFrozen(exactBlock.target)};
    }finally{proto.getClientRects=original;view.destroy();host.remove();}
  });observations.get(page).controlledPrivateView=result;
  expect(result.exactBlock.status).toBe('measured');expect(result.exactSelection.status).toBe('measured');expect(result.immutable).toBe(true);
  for(const key of ['excessBlock','excessSelection'])refused(result[key],'dom.selection_geometry_unsupported',result.stamp,key==='excessBlock'?'P':null);
  expect(result.inline).toMatchObject({tag:'SPAN',label:'inline',editable:'false'});refused(result.inline.atom,'dom.selection_geometry_unsupported',result.stamp,'I');
  expect(result.inline.hit.status).toBe('measured');expect(result.inline.hit.target).toEqual({kind:'block',node:'P'});
  refused(result.changedContext,'dom.stale_selection',result.stamp,'P');
});

test('G30 unrelated native publication preserves the measured object and rejects its old stamp',async({page})=>{
  const id=await mount(page),initial=await inspect(page,id,'initial unaffected P');await page.evaluate(id=>{window.geometryStableObject=document.getElementById(`${id}-editor`).children[0];},id);
  expect((await call(page,'select',id,range('V',2))).response.status).toBe('ok');expect((await call(page,'command',id,{kind:'insert_text',text:'X'})).response.status).toBe('ok');
  const before=await inspect(page,id,'unrelated native edit committed');expect(JSON.parse(before.canonical).content[3].content[0].text).toBe('efX');expect(before.state.history.undo_entries).toBe('1');
  expect(await page.evaluate(id=>window.geometryStableObject===document.getElementById(`${id}-editor`).children[0],id)).toBe(true);await rememberEnvironment(page,id);
  expect((await measured(page,id,{kind:'block',node:'P'},'fresh unchanged actual object')).status).toBe('measured');
  refused(await measured(page,id,{kind:'block',node:'P',stamp:initial.state.stamp},'old stamp after unrelated edit'),'dom.stale_selection',before.state.stamp,before.roles.P);
  pure(await inspect(page,id,'post-publication geometry stays pure'),before);await unchangedEnvironment(page,id);
});
