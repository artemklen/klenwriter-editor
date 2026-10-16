// A separate fresh WebKit launch measures sampled RSS including launchd-owned XPCs.
// It never attaches to, changes, terminates or includes pre-existing user processes.
import { webkit } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { startServer } from './server.mjs';
const root=resolve(import.meta.dirname,'../..');
const prefix=dirname(webkit.executablePath())+'/';
const sha=data=>createHash('sha256').update(data).digest('hex');
function processes(){return execFileSync('ps',['-axo','pid=,ppid=,rss=,comm='],{encoding:'utf8'}).trim().split('\n').map(line=>{const match=line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);return match?{pid:Number(match[1]),ppid:Number(match[2]),rssBytes:Number(match[3])*1024,executable:match[4]}:null;}).filter(Boolean);}
const initial=processes(),initialIds=new Set(initial.map(row=>row.pid));
const preexistingSameBundle=initial.filter(row=>row.executable.startsWith(prefix));
if(preexistingSameBundle.length)throw new Error('Another process from this exact Playwright WebKit bundle is present; cannot attribute a fresh launch safely');
const registered=new Map(),samples=[];
function sample(){const now=Date.now(),rows=processes().filter(row=>!initialIds.has(row.pid)&&row.executable.startsWith(prefix));for(const row of rows)if(!registered.has(row.pid))registered.set(row.pid,{...row,firstSeenAt:now});const entry={time:now,rssBytes:rows.reduce((sum,row)=>sum+row.rssBytes,0),processes:rows};samples.push(entry);return entry;}
const result={startedAt:new Date().toISOString(),baselineMetadataSha256:sha(readFileSync(`${root}/evidence/osr-61/metadata.json`)),sourceHashes:Object.fromEntries(['scripts/m0-perf/memory.mjs','spikes/performance/app.mjs','scripts/m0-perf/server.mjs','scripts/m0-perf/corpora.mjs'].map(path=>[path,sha(readFileSync(`${root}/${path}`))])),executablePrefix:prefix,preexistingSameBundle,attribution:'No process from this exact bundled WebKit directory existed at launch. Register only new PIDs whose executable belongs to that bundle during one isolated controlled launch, including XPCs reparented to launchd. User/system Safari and all pre-existing PIDs are excluded. No concurrent launch from this bundle is permitted.',samplingRequestedMs:100,workload:'Seven corpus loads with exact raw roundtrip, initial full DOM layout, a reset and 33 native DOM keys each. Excludes adaptive microbench allocation bursts and repeated 20x full rebuild; not substituted into the main-series RSS.',limitation:'One fresh browser launch, sampled summed RSS including shared mappings; not unique physical memory, no proof transient peaks were captured, no regression variance estimate. Attribution is by fresh PID/exact executable bundle/time window, not OS audit-token parent proof.',corpora:[]};
const {server,url,corpora}=await startServer();let browser;const timer=setInterval(sample,100);
try{
 browser=await webkit.launch({headless:true});result.browserVersion=browser.version();sample();
 const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage();await page.goto(url);await page.waitForFunction(()=>window.osr61?.ready);
 for(const corpus of corpora){
  console.log(`WebKit memory ${corpus.manifest.id}`);const from=samples.length;
  const loaded=await page.evaluate(id=>window.osr61.load(id),corpus.manifest.id);await page.evaluate(()=>window.osr61.prepareTyping());
  for(let n=1;n<=33;n++){await page.keyboard.press('x');await page.waitForFunction(count=>window.osr61.typingCount()>=count,n,{timeout:30000});}
  const typing=await page.evaluate(()=>window.osr61.typingResult(3));if(!loaded.roundtripExact||typing.insertedUtf16Units!==33||typing.samples.length!==30||typing.samples.some(row=>!row.trustedKey||!row.trustedInput))throw new Error('Memory workload correctness failed');
  sample();const phase=samples.slice(from);result.corpora.push({id:corpus.manifest.id,wasmLinearHighWaterBytes:typing.wasmLinearBytes,sampledRssMaxBytes:Math.max(...phase.map(row=>row.rssBytes)),sampleCount:phase.length,roundtripExact:true,typingExact:true});
 }
 await context.close();
}catch(error){result.error=String(error?.stack||error);throw error;}
finally{
 if(browser)await browser.close();clearInterval(timer);await new Promise(resolve=>server.close(resolve));
 result.registeredProcesses=[...registered.values()];result.samples=samples;result.sampledRssMaxBytes=Math.max(...samples.map(row=>row.rssBytes),0);result.maximumSampleGapMs=Math.max(...samples.slice(1).map((row,index)=>row.time-samples[index].time),0);result.finishedAt=new Date().toISOString();result.remainingRegisteredProcesses=processes().filter(row=>registered.has(row.pid));
 writeFileSync(`${root}/evidence/osr-61/webkit-memory-supplement.json`,JSON.stringify(result,null,2)+'\n');
}
console.log(JSON.stringify({registeredPids:registered.size,sampledRssMaxBytes:result.sampledRssMaxBytes,remainingRegistered:result.remainingRegisteredProcesses.length}));
