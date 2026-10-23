// SPDX-License-Identifier: MIT OR Apache-2.0
// Exact context observation for the same finite compiled-runtime cases in each
// selected engine. Attached before the page exists; no physical input/capture.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {pipeline,assertBrowserClean} from './dom-observation.mjs';
import {observeBrowserFetchBodies} from './browser-body-observer.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function observeRuntimeContext(context,binding){
  assert.equal(binding.format,'osr67-ac3-current-runtime-assets/1');
  const limits=pipeline.shared.observation,origin=binding.recipe.origin;
  const ledger=[],issues=[],errors=[],dialogs=[],pages=[],browserCheckpoints=[],epochs=[];
  const requests=new Map(),pending=new Set(),bodies=new Set(),frames=new Map();
  let overflow=false,sequence=0,phase='not_started',epoch=0;
  const fail=message=>{if(issues.length<limits.maxErrorRecords)issues.push(message);else overflow=true;};
  const fetchBodies=await observeBrowserFetchBodies(context,{origin,files:binding.files,fail});
  const frameId=request=>{try{const frame=request.frame();if(!frames.has(frame))frames.set(frame,frames.size+1);return frames.get(frame);}catch{return'unavailable';}};
  const entry=request=>{
    if(requests.has(request))return requests.get(request);
    if(ledger.length>=limits.maxRequestRecords){overflow=true;return null;}
    const item={monotonicSequence:++sequence,documentEpoch:epoch,documentLabel:epochs[epoch-1]?.label??null,phase,
      time:performance.now(),url:request.url(),method:request.method(),resourceType:request.resourceType(),
      frameIdentity:frameId(request),decision:'not_routed',responseStatusOrFailure:null};
    ledger.push(item);requests.set(request,item);pending.add(request);return item;
  };
  context.on('request',entry);
  context.on('requestfinished',request=>pending.delete(request));
  context.on('requestfailed',request=>{const item=entry(request);if(item)item.responseStatusOrFailure={failure:request.failure()?.errorText??'unknown'};pending.delete(request);});
  context.on('response',response=>{
    const work=(async()=>{
      const item=entry(response.request());if(!item)return;
      const headers=await response.allHeaders();
      const observed={status:response.status(),contentType:headers['content-type']??null,headers:{}};
      item.responseStatusOrFailure=observed;
      for(const [key,value]of Object.entries(binding.responseHeaders)){
        observed.headers[key]=headers[key]??null;if(headers[key]!==value)fail(`Unexpected ${key}: ${item.url}`);
      }
      const expected=binding.files.find(file=>origin+file.url===item.url);
      if(expected){
        if(item.resourceType!=='fetch'){
          const bytes=await response.body();observed.bytes=bytes.length;observed.sha256=sha(bytes);
          observed.bodyObservation='playwright-inspector-response-body';
          if(bytes.length!==expected.bytes||observed.sha256!==expected.sha256)fail(`Delivered bytes differ from source-bound graph: ${item.url}`);
        }
        if(response.status()!==expected.status)fail(`Unexpected status: ${item.url}`);
        if((headers['content-type']??'').split(';')[0].trim()!==expected.contentType)fail(`Unexpected MIME: ${item.url}`);
      }else if(item.url===origin+binding.recipe.optionalResponse.url&&response.status()!==204)fail('Optional favicon must be declared204');
    })().catch(error=>fail(`Response observation failed: ${error.message}`));
    bodies.add(work);void work.finally(()=>bodies.delete(work));
  });
  await context.route('**/*',async route=>{
    const request=route.request(),item=entry(request);
    if(!item){await route.abort();return;}
    const expected=binding.files.find(file=>origin+file.url===item.url),optional=item.url===origin+binding.recipe.optionalResponse.url;
    const prior=ledger.filter(row=>row!==item&&row.documentEpoch===item.documentEpoch&&row.phase===item.phase&&row.url===item.url&&row.decision==='allow').length;
    const cap=item.phase==='bootstrap'?(expected?.counts.bootstrap??(optional?binding.recipe.optionalResponse.bootstrapCountMax:0)):0;
    if(epoch<1||!expected&&!optional||item.method!=='GET'||expected&&item.resourceType!==expected.resourceType||prior>=cap){
      item.decision='abort_unexpected';fail(`Unexpected attempt: epoch${item.documentEpoch} ${item.phase} ${item.method} ${item.resourceType} ${item.url}`);
      await route.abort();return;
    }
    item.decision='allow';await route.continue();
  });
  await context.addInitScript(({limits})=>{
    const record={csp:[],errors:[],rejections:[],overflow:false};
    const put=(name,value,maximum)=>{if(record[name].length<maximum)record[name].push(value);else record.overflow=true;};
    window.__clipboardUnexpectedExecution=0;window.__osr39=0;
    document.addEventListener('securitypolicyviolation',event=>put('csp',{time:performance.now(),directive:event.violatedDirective,blocked:event.blockedURI},limits.maxCspRecords));
    addEventListener('error',event=>put('errors',{time:performance.now(),message:String(event.message).slice(0,1024)},limits.maxErrorRecords));
    addEventListener('unhandledrejection',event=>put('rejections',{time:performance.now(),message:String(event.reason?.message??event.reason).slice(0,1024)},limits.maxErrorRecords));
    Object.defineProperty(window,'__failureRuntimeNetworkRead',{value:()=>({...record,csp:record.csp.slice(),errors:record.errors.slice(),rejections:record.rejections.slice(),
      timeOrigin:performance.timeOrigin,sentinels:{__clipboardUnexpectedExecution:window.__clipboardUnexpectedExecution,__osr39:window.__osr39}})});
  },{limits});
  context.on('page',page=>{
    pages.push(page);if(pages.length>1)fail('Unexpected popup/page');
    page.on('pageerror',error=>{if(errors.length<limits.maxErrorRecords)errors.push({name:error.name,message:error.message});else overflow=true;});
    page.on('dialog',dialog=>{if(dialogs.length<limits.maxErrorRecords)dialogs.push({type:dialog.type(),message:dialog.message()});else overflow=true;void dialog.dismiss().catch(error=>fail(error.message));});
    page.on('websocket',socket=>fail(`Unexpected WebSocket attempt: ${socket.url()}`));
    page.on('worker',worker=>fail(`Unexpected Worker: ${worker.url()}`));
  });
  const assertPhase=(name,number=epoch)=>{
    assert(number>=1&&number<=epochs.length);
    const rows=ledger.filter(item=>item.documentEpoch===number&&item.phase===name);
    for(const expected of binding.files)assert.equal(rows.filter(item=>item.url===origin+expected.url&&item.decision==='allow').length,
      expected.counts[name],`Epoch${number} ${name} exact count: ${expected.url}`);
    const count=rows.filter(item=>item.url===origin+binding.recipe.optionalResponse.url).length;
    assert(count>=(name==='bootstrap'?binding.recipe.optionalResponse.bootstrapCountMin:0));
    assert(count<=(name==='bootstrap'?binding.recipe.optionalResponse.bootstrapCountMax:0));
  };
  const assertClean=()=>{
    assert.equal(overflow,false);assert.deepEqual(issues,[]);assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);
    assert.equal(pages.length,1);assert.equal(pending.size,0);assert.equal(bodies.size,0);
    fetchBodies.assertJoined(ledger);
    assert(ledger.every(item=>item.decision==='allow'&&item.responseStatusOrFailure?.status!==undefined),'Each attempt has actual allowed response evidence');
  };
  return{
    setPhase(name){
      assert(binding.recipe.phases.includes(name));
      if(name==='bootstrap'){
        assert(epoch<binding.recipe.documentEpochs.length,'Only frozen document epochs');
        if(epoch>0)fetchBodies.beforeDeparture(epoch,ledger);
        epoch++;epochs.push({number:epoch,label:binding.recipe.documentEpochs[epoch-1],startedAt:performance.now()});
      }else{assert(epoch>0);fetchBodies.assertJoined(ledger);}
      phase=name;
    },
    async settle(){await Promise.all([...bodies]);await fetchBodies.settle(pages[0],ledger,{documentEpoch:epoch,phase});},assertPhase,assertClean,
    async checkpoint(page,label){
      const value=await page.evaluate(()=>window.__failureRuntimeNetworkRead());
      browserCheckpoints.push({documentEpoch:epoch,phase,label,...value});assertBrowserClean(value);return value;
    },
    assertComplete(){
      assert.equal(epoch,binding.recipe.documentEpochs.length);assertClean();
      for(let number=1;number<=epoch;number++){
        for(const name of binding.recipe.phases)assertPhase(name,number);
        const points=browserCheckpoints.filter(point=>point.documentEpoch===number);
        assert(points.some(point=>point.phase==='bootstrap'),`Epoch${number} ready browser checkpoint`);
        assert(points.some(point=>point.phase==='operation'),`Epoch${number} terminal browser checkpoint`);
      }
      assert(browserCheckpoints.some(point=>point.documentEpoch===epoch&&point.phase==='cleanup'),'Final cleanup browser checkpoint');
    },
    snapshot(){return{timeOrigin:performance.timeOrigin,phase,epochs:epochs.map(value=>({...value})),ledger:ledger.map(value=>({...value})),
      issues:issues.slice(),errors:errors.slice(),dialogs:dialogs.slice(),browserCheckpoints:browserCheckpoints.slice(),
      pages:pages.length,pendingRequests:pending.size,pendingResponseObservations:bodies.size,fetchBodyObserver:fetchBodies.snapshot(),overflow};},
  };
}
