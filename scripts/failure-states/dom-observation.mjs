// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {browserBodyObserverPins,observeBrowserFetchBodies} from './browser-body-observer.mjs';
const root=new URL('../../',import.meta.url);
const read=path=>readFileSync(new URL(path,root));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const pipeline=JSON.parse(read('contracts/failure-states/v1/dom-pipeline.json'));
export const assets=JSON.parse(read('contracts/failure-states/v1/dom-assets.json'));
export const contractPins={pipeline:sha(read('contracts/failure-states/v1/dom-pipeline.json')),assets:sha(read('contracts/failure-states/v1/dom-assets.json')),browserBodyObserver:browserBodyObserverPins};
assert.equal(pipeline.rowCount,11);assert.equal(pipeline.rows.length,11);
assert.deepEqual(pipeline.rows.map(row=>row.id),Array.from({length:11},(_,i)=>`AC1-${String(i+1).padStart(2,'0')}`));
export function currentAssetBinding(){
  const binding=JSON.parse(read('artifacts/failure-states/dom-assets-current.json'));
  assert.equal(binding.format,'osr67-ac1-current-assets/1');assert.equal(binding.contractSha256,contractPins.assets);
  const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();assert.equal(binding.sourceCommit,head,'Current producer binding must name this HEAD');
  assert.equal(binding.files.length,assets.files.length);
  assert.deepEqual(binding.files.map(f=>f.url).sort(),assets.files.map(f=>f.url).sort());
  for(const item of assets.files){
    const bound=binding.files.find(f=>f.url===item.url);assert.equal(bound.path,item.path);
    const path=resolve(new URL('.',root).pathname,bound.path);assert(path.startsWith(new URL('.',root).pathname),'Binding path within repository');
    const bytes=read(bound.path);assert.equal(bound.bytes,bytes.length,`Current producer bytes: ${item.url}`);assert.equal(bound.sha256,sha(bytes),`Current producer hash: ${item.url}`);
  }
  return binding;
}
export async function observeDomContext(context,binding){
  const limits=pipeline.shared.observation,ledger=[],byRequest=new Map(),pending=new Set(),bodyWork=new Set(),frames=new Map();
  const issues=[],errors=[],dialogs=[],pages=[];let overflow=false,phase='bootstrap',sequence=0;
  const fail=message=>{if(issues.length<32)issues.push(message);else overflow=true;};
  const fetchBodies=await observeBrowserFetchBodies(context,{origin:assets.origin,
    files:assets.files.map(file=>({...file,...binding.files.find(bound=>bound.url===file.url)})),fail});
  const frameId=request=>{try{const frame=request.frame();if(!frames.has(frame))frames.set(frame,frames.size+1);return frames.get(frame);}catch{return 'unavailable';}};
  const entry=request=>{
    if(byRequest.has(request))return byRequest.get(request);
    if(ledger.length>=limits.maxRequestRecords){overflow=true;return null;}
    const item={monotonicSequence:++sequence,documentEpoch:1,phase,time:performance.now(),url:request.url(),method:request.method(),resourceType:request.resourceType(),frameIdentity:frameId(request),decision:'not_routed',responseStatusOrFailure:null};
    ledger.push(item);byRequest.set(request,item);pending.add(request);return item;
  };
  context.on('request',entry);
  context.on('requestfinished',request=>pending.delete(request));
  context.on('requestfailed',request=>{const item=entry(request);if(item)item.responseStatusOrFailure={failure:request.failure()?.errorText??'unknown'};pending.delete(request);});
  context.on('response',response=>{
    const work=(async()=>{
      const item=entry(response.request());if(!item)return;
      const headers=await response.allHeaders();item.responseStatusOrFailure={status:response.status(),contentType:headers['content-type']??null};
      const expected=assets.files.find(f=>assets.origin+f.url===item.url),bound=binding.files.find(f=>assets.origin+f.url===item.url);
      if(expected){
        if(item.resourceType!=='fetch'){
          const bytes=await response.body();item.responseStatusOrFailure.bytes=bytes.length;item.responseStatusOrFailure.sha256=sha(bytes);
          item.responseStatusOrFailure.bodyObservation='playwright-inspector-response-body';
          if(bytes.length!==bound.bytes||sha(bytes)!==bound.sha256)fail(`Delivered bytes differ from reviewed producer: ${item.url}`);
        }
        if(response.status()!==expected.status)fail(`Unexpected status ${item.url}`);
        if((headers['content-type']??'').split(';')[0].trim()!==expected.contentType)fail(`Unexpected MIME ${item.url}`);
      }else if(item.url===assets.origin+'/favicon.ico'&&response.status()!==204)fail('Favicon is not the declared204');
    })().catch(error=>fail(`Response observation failed: ${error.message}`));
    bodyWork.add(work);void work.finally(()=>bodyWork.delete(work));
  });
  await context.route('**/*',async route=>{
    const request=route.request(),item=entry(request);if(!item){await route.abort();return;}
    const expected=assets.files.find(f=>assets.origin+f.url===item.url),optional=assets.optionalResponses.find(f=>assets.origin+f.url===item.url);
    const same=ledger.filter(row=>row!==item&&row.phase===item.phase&&row.url===item.url&&row.decision==='allow').length;
    const cap=expected?.counts[item.phase]??(optional&&item.phase==='bootstrap'?optional.bootstrapCountMax:0);
    if(!expected&&!optional||request.method()!=='GET'||expected&&request.resourceType()!==expected.resourceType||same>=cap){item.decision='abort_unexpected';fail(`Unexpected attempt ${item.phase} ${item.method} ${item.resourceType} ${item.url}`);await route.abort();return;}
    item.decision='allow';await route.continue();
  });
  await context.addInitScript(({limits})=>{
    const record={csp:[],errors:[],rejections:[],overflow:false};
    const push=(name,value,maximum)=>{if(record[name].length<maximum)record[name].push(value);else record.overflow=true;};
    window.__clipboardUnexpectedExecution=0;window.__osr39=0;
    document.addEventListener('securitypolicyviolation',event=>push('csp',{time:performance.now(),directive:event.violatedDirective,blocked:event.blockedURI},limits.maxCspRecords));
    window.addEventListener('error',event=>push('errors',{time:performance.now(),message:String(event.message).slice(0,1024)},limits.maxErrorRecords));
    window.addEventListener('unhandledrejection',event=>push('rejections',{time:performance.now(),message:String(event.reason?.message??event.reason).slice(0,1024)},limits.maxErrorRecords));
    Object.defineProperty(window,'__failureDomRead',{value:()=>({...record,csp:record.csp.slice(),errors:record.errors.slice(),rejections:record.rejections.slice(),sentinels:{__clipboardUnexpectedExecution:window.__clipboardUnexpectedExecution,__osr39:window.__osr39}})});
  },{limits});
  context.on('page',page=>{
    pages.push(page);if(pages.length>1)fail('Unexpected popup/page');
    page.on('pageerror',error=>{if(errors.length<limits.maxErrorRecords)errors.push(error.message);else overflow=true;});
    page.on('dialog',dialog=>{if(dialogs.length<limits.maxErrorRecords)dialogs.push({type:dialog.type(),message:dialog.message()});else overflow=true;void dialog.dismiss().catch(error=>fail(error.message));});
  });
  const snapshot=()=>({timeOrigin:performance.timeOrigin,ledger:ledger.map(item=>({...item})),issues:issues.slice(),errors:errors.slice(),dialogs:dialogs.slice(),pages:pages.length,pendingRequests:pending.size,pendingResponseObservations:bodyWork.size,fetchBodyObserver:fetchBodies.snapshot(),overflow});
  return {
    setPhase(value){assert(['bootstrap','operation','cleanup'].includes(value));fetchBodies.assertJoined(ledger);phase=value;},
    async settle(){await Promise.all([...bodyWork]);await fetchBodies.settle(pages[0],ledger,{documentEpoch:1,phase});},
    async browser(page){return page.evaluate(()=>window.__failureDomRead());},snapshot,
    assertPhase(name,html=false){
      for(const expected of assets.files){const cap=name==='operation'&&expected.lazyCondition&&!html?0:expected.counts[name];assert.equal(ledger.filter(r=>r.phase===name&&r.url===assets.origin+expected.url&&r.decision==='allow').length,cap,`${name} exact request count ${expected.url}`);}
      for(const optional of assets.optionalResponses){const count=ledger.filter(r=>r.phase===name&&r.url===assets.origin+optional.url).length;assert(count>=(name==='bootstrap'?optional.bootstrapCountMin:0)&&count<=(name==='bootstrap'?optional.bootstrapCountMax:0),'Optional resource count/phase');}
    },
    assertClean(){assert.equal(overflow,false);assert.deepEqual(issues,[]);assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);assert.equal(pages.length,1);assert.equal(pending.size,0);assert.equal(bodyWork.size,0);fetchBodies.assertJoined(ledger);assert(ledger.every(r=>r.decision==='allow'&&r.responseStatusOrFailure?.status!==undefined),'Every attempt has actual allowed response evidence');}
  };
}
export async function fixedObservationWindow(page){
  return page.evaluate(({bound})=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Two-frame observation deadline')),bound),started=performance.now();
    requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);setTimeout(()=>resolve({frames:2,started,finished:performance.now(),fixedWindowMs:250}),250);}));
  }),{bound:pipeline.shared.completion.animationFrameBoundMs});
}
export function assertBrowserClean(value){assert.equal(value.overflow,false);assert.deepEqual(value.csp,[]);assert.deepEqual(value.errors,[]);assert.deepEqual(value.rejections,[]);assert.deepEqual(value.sentinels,pipeline.shared.observation.sentinels);}
export function assertNumericOwnersZero(value,path='resources'){
  for(const [name,item]of Object.entries(value)){if(typeof item==='number')assert.equal(item,0,`${path}.${name}`);else if(item&&typeof item==='object')assertNumericOwnersZero(item,`${path}.${name}`);}
}
