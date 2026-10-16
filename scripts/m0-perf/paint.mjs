// Supplemental Event Timing drain/attribution protocol. Run after the main series,
// never in parallel: browser processes would compete for the same machine.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { startServer } from './server.mjs';
const root=resolve(import.meta.dirname,'../..');
const {server,url,corpora}=await startServer();
const sha=data=>createHash('sha256').update(data).digest('hex');
const quantiles=values=>{const sorted=[...values].sort((a,b)=>a-b);const at=p=>sorted[Math.ceil(sorted.length*p)-1]??null;return {n:values.length,p50:at(.5),p95:at(.95),p99:at(.99),samples:values};};
const result={baselineMetadataSha256:sha(readFileSync(`${root}/evidence/osr-61/metadata.json`)),startedAt:new Date().toISOString(),scope:'Supplemental headless Chromium Event Timing; no primitive benchmark and no installed-browser/production acceptance.',sourceHashes:Object.fromEntries(['scripts/m0-perf/paint.mjs','spikes/performance/app.mjs','scripts/m0-perf/server.mjs','scripts/m0-perf/corpora.mjs'].map(path=>[path,sha(readFileSync(`${root}/${path}`))])),protocol:{launches:3,keysPerCorpus:33,warmups:3,finalObserverDrain:'Three rAF callbacks then 200ms timer after the final input proxy; no additional keys. Not included in latency.',matching:'Unique keydown Event Timing processingStart/End interval containing handler time (±1ms for timer quantization); each entry used once.',requestedDurationThresholdMs:16,limitation:'Threshold-censored entries remain missing; no unconditional quantiles unless all 30 measured keys match.'},runs:[]};
try{
  for(let run=1;run<=3;run++){
    const browser=await chromium.launch({headless:true});
    const item={run,startedAt:new Date().toISOString(),browserVersion:browser.version(),corpora:[]};
    try{
      const context=await browser.newContext({viewport:{width:1280,height:800}});const page=await context.newPage();await page.goto(url);await page.waitForFunction(()=>window.osr61?.ready);
      for(const corpus of corpora){
        console.log(`paint Chromium run ${run}/3 ${corpus.manifest.id}`);
        await page.evaluate(id=>window.osr61.load(id),corpus.manifest.id);await page.evaluate(()=>window.osr61.prepareTyping());
        for(let n=1;n<=33;n++){await page.keyboard.press('x');await page.waitForFunction(count=>window.osr61.typingCount()>=count,n,{timeout:30000});}
        await page.evaluate(async()=>{for(let i=0;i<3;i++)await new Promise(resolve=>requestAnimationFrame(resolve));await new Promise(resolve=>setTimeout(resolve,200));});
        const evidence=await page.evaluate(()=>({typing:window.osr61.typingResult(3),debug:window.osr61.typingDebug()}));
        const keys=evidence.debug.events.filter(event=>event.type==='keydown'&&event.key==='x');
        const entries=evidence.typing.eventTiming.filter(entry=>entry.name==='keydown');
        if(keys.length!==33||evidence.typing.insertedUtf16Units!==33||evidence.typing.samples.length!==30||evidence.typing.samples.some(sample=>!sample.trustedKey||!sample.trustedInput))throw new Error('Supplemental typing correctness failed');
        const used=new Set();
        const matched=keys.map((key,index)=>{
          const candidates=entries.map((entry,entryIndex)=>({entry,entryIndex})).filter(({entry,entryIndex})=>!used.has(entryIndex)&&key.time>=entry.processingStart-1&&key.time<=entry.processingEnd+1);
          if(candidates.length!==1)return {ordinal:index+1,handlerTime:key.time,warmup:index<3,match:null,candidateCount:candidates.length};
          const {entry,entryIndex}=candidates[0];used.add(entryIndex);return {ordinal:index+1,handlerTime:key.time,warmup:index<3,match:entry,entryIndex};
        });
        const measured=matched.slice(3),complete=measured.every(row=>row.match);
        item.corpora.push({id:corpus.manifest.id,...evidence,matched,completeMeasuredCoverage:complete,nextPaintDurationMs:complete?quantiles(measured.map(row=>row.match.duration)):null,observedMeasuredSubsetMs:quantiles(measured.filter(row=>row.match).map(row=>row.match.duration)),unmatchedEntries:entries.filter((_,index)=>!used.has(index))});
      }
      await context.close();
    }catch(error){item.error=String(error?.stack||error);throw error;}
    finally{await browser.close();item.finishedAt=new Date().toISOString();result.runs.push(item);writeFileSync(`${root}/evidence/osr-61/paint-supplement.json`,JSON.stringify(result,null,2)+'\n');}
  }
}finally{await new Promise(resolve=>server.close(resolve));}
result.finishedAt=new Date().toISOString();writeFileSync(`${root}/evidence/osr-61/paint-supplement.json`,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({runs:result.runs.length,completeMeasuredGroups:result.runs.flatMap(run=>run.corpora).filter(corpus=>corpus.completeMeasuredCoverage).length,totalGroups:21}));
