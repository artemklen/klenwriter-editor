import { chromium,firefox,webkit } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync,writeFileSync,mkdirSync,readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import os from 'node:os';
import { startServer } from './server.mjs';
const root=resolve(import.meta.dirname,'../..');
const out=resolve(root,'evidence/osr-61');mkdirSync(out,{recursive:true});
const requested=(process.env.OSR61_ENGINES||'chromium,firefox,webkit').split(',');
const runs=Number(process.env.OSR61_RUNS||3);
const sha=b=>createHash('sha256').update(b).digest('hex');
const command=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8'}).trim();
const {server,url,corpora}=await startServer();
const sourcePaths=['scripts/m0-perf/build.mjs','scripts/m0-perf/corpora.mjs','scripts/m0-perf/server.mjs','scripts/m0-perf/run.mjs','scripts/m0-perf/kernel/Cargo.toml','scripts/m0-perf/kernel/Cargo.lock','scripts/m0-perf/kernel/lib.rs','spikes/performance/index.html','spikes/performance/app.mjs','spikes/performance/kernel.wasm','package-lock.json'];
const wasm=readFileSync(`${root}/spikes/performance/kernel.wasm`);
const metadata={capturedAt:new Date().toISOString(),baseCommit:command('git',['rev-parse','HEAD']),sourceHashes:Object.fromEntries(sourcePaths.map(p=>[p,sha(readFileSync(`${root}/${p}`))])),hardware:{model:command('sysctl',['-n','machdep.cpu.brand_string']),physicalCpu:Number(command('sysctl',['-n','hw.physicalcpu'])),logicalCpu:os.cpus().length,memoryBytes:os.totalmem()},system:{platform:os.platform(),release:os.release(),architecture:os.arch(),swVers:command('sw_vers',[])},toolchain:{node:process.version,rustc:command('rustup',['run','stable','rustc','--version','--verbose']),cargo:command('rustup',['run','stable','cargo','--version']),playwright:JSON.parse(readFileSync(`${root}/node_modules/@playwright/test/package.json`)).version,build:'release opt-level3, LTO, codegen-units1, panic=abort, strip=symbols; no Rust dependencies'},bundle:{wasmBytes:wasm.length,wasmGzipBytes:gzipSync(wasm,{level:9}).length,javascriptBytes:readFileSync(`${root}/spikes/performance/app.mjs`).length,scope:'Calibration kernel only, not production SDK size or its 400KB candidate.'},corpora:corpora.map(c=>c.manifest),sampling:{independentBrowserLaunchesPerEngine:runs,microbench:{warmup:10,samples:100,adaptiveBatchTargetMs:5,calibration:'double batch until all three probes reach target, maximum 2^24 operations; retain actual batch and elapsed intervals'},render:{warmup:3,samples:20},typing:{warmup:3,samples:30},memoryPollRequestedMs:100},limitations:['Headless isolated bundled engines; not installed Chrome/Safari/Firefox product acceptance.','Shared workstation, not thermally/power/background-load controlled.','Core result is one WASM call amortized over an adaptively sized batch of String insert/remove pairs; no production validators, history, mapping, codecs or extensions.','Render forces full DOM construction and layout; typing uses native DOM and a second-rAF rendering-opportunity proxy.','Process-tree RSS sums shared mappings and includes runner; sampled maximum is not unique-memory peak or proof no transient peak occurred.']};
writeFileSync(`${out}/metadata.json`,JSON.stringify(metadata,null,2)+'\n');
function rssSample(){
  const rows=command('ps',['-axo','pid=,ppid=,rss=']).split('\n').map(l=>l.trim().split(/\s+/).map(Number));
  const wanted=new Set([process.pid]);let changed=true;
  while(changed){changed=false;for(const [pid,ppid] of rows)if(wanted.has(ppid)&&!wanted.has(pid)){wanted.add(pid);changed=true;}}
  return {time:Date.now(),rssBytes:rows.filter(([pid])=>wanted.has(pid)).reduce((sum,r)=>sum+r[2]*1024,0),processCount:wanted.size};
}
const results=[];
try{
  for(const engine of requested)for(let run=1;run<=runs;run++){
    const memory=[];const baselineRunner=rssSample();let timer;let browser;let page;
    const result={engine,run,startedAt:new Date().toISOString(),baselineRunnerRss:baselineRunner,corpora:[]};
    try{
      timer=setInterval(()=>memory.push(rssSample()),100);
      const launchAt=performance.now();browser=await({chromium,firefox,webkit}[engine]).launch({headless:true});result.browserVersion=browser.version();result.launchMs=performance.now()-launchAt;
      const context=await browser.newContext({viewport:{width:1280,height:800}});page=await context.newPage();
      await page.goto(url);await page.waitForFunction(()=>window.osr61?.ready);
      result.startup=await page.evaluate(()=>window.osr61.startup);
      for(const corpus of corpora){
        console.log(`${engine} run ${run}/${runs} ${corpus.manifest.id}`);
        const rssFrom=memory.length;
        const loaded=await page.evaluate(id=>window.osr61.load(id),corpus.manifest.id);
        const metrics=await page.evaluate(()=>window.osr61.measure());
        await page.evaluate(()=>window.osr61.prepareTyping());
        for(let n=1;n<=33;n++){
          await page.keyboard.press('x');await page.waitForFunction(count=>window.osr61.typingCount()>=count,n,{timeout:30000});
        }
        const typing=await page.evaluate(()=>window.osr61.typingResult(3));
        if(typing.samples.length!==30||typing.insertedUtf16Units!==33||typing.samples.some(s=>!s.trustedKey||!s.trustedInput))throw new Error('Typing samples missing/untrusted or text delta differs');
        const memoryWindow=memory.slice(rssFrom);
        result.corpora.push({id:corpus.manifest.id,loaded,metrics,typing,rssSampledMaxBytes:Math.max(...memoryWindow.map(s=>s.rssBytes),0),rssSampleCount:memoryWindow.length});
      }
      await context.close();
    }catch(error){result.error=String(error?.stack||error);if(page)result.typingDebug=await page.evaluate(()=>window.osr61?.typingDebug()).catch(()=>null);throw error;}
    finally{
      if(browser)await browser.close();if(timer)clearInterval(timer);result.processTreeRssSamples=memory;result.processTreeRssMaxBytes=Math.max(...memory.map(s=>s.rssBytes),0);result.maxMemorySampleGapMs=Math.max(...memory.slice(1).map((s,i)=>s.time-memory[i].time),0);result.finishedAt=new Date().toISOString();
      writeFileSync(`${out}/${engine}-run-${run}.json`,JSON.stringify(result,null,2)+'\n');results.push(result);
    }
  }
}finally{await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({completed:results.length,output:out}));
