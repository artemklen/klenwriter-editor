// SPDX-License-Identifier: MIT OR Apache-2.0
// Explicit descriptive native benchmark; not part of a timing regression gate.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import os from 'node:os';

const run=(program,args)=>{const r=spawnSync(program,args,{encoding:'utf8',maxBuffer:32*1024*1024});if(r.status!==0)throw new Error(`${program} failed: ${r.stderr}`);return r.stdout;};
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const walk=p=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${p}/${e.name}`):e.name.endsWith('.rs')?[`${p}/${e.name}`]:[]);
const paths=[...walk('crates/core/src'),...walk('crates/engine/src'),...walk('crates/kwdj/src'),'Cargo.toml','Cargo.lock','rust-toolchain.toml','crates/wasm/Cargo.toml','crates/wasm/examples/support/delta_observer.rs','crates/wasm/examples/support/delta_series.rs','crates/wasm/examples/support/delta_benchmark.rs','crates/wasm/examples/support/delta_literals.json','crates/wasm/examples/delta_native.rs','scripts/benchmark-deltas.mjs','docs/m0/performance-protocol.md','evidence/osr-37/execution-contract.md'];
const sourceHashes=Object.fromEntries(paths.sort().map(p=>[p,hash(p)]));
const rustc=run('rustc',['--version']);assert.match(rustc,/^rustc 1\.97\.1 /);
run('cargo',['build','--locked','--release','-p','klenwriter-editor-wasm','--example','delta_native']);
mkdirSync('artifacts/delta-benchmark',{recursive:true});
const startedAt=new Date().toISOString();
const processRuns=[];
for(let round=0;round<5;round++){
  const processStartedAt=new Date().toISOString();
  const raw=run('target/release/examples/delta_native',['--benchmark-round',String(round)]);
  const path=`artifacts/delta-benchmark/raw-round-${round}.json`;writeFileSync(path,raw);
  const observed=JSON.parse(raw);assert.equal(observed.status,'passed');assert.equal(observed.runs.length,8);
  assert.ok(observed.runs.every(r=>r.round===round));
  processRuns.push({round,path,sha256:hash(path),startedAt:processStartedAt,completedAt:new Date().toISOString(),observed});
}
const observed={format:'klenwriter-editor-delta-native-benchmark/1',status:'passed',protocol:{...processRuns[0].observed.protocol,rounds:5,independentProcessLaunches:5},runs:processRuns.flatMap(r=>r.observed.runs)};
writeFileSync('artifacts/delta-benchmark/raw.json',JSON.stringify(observed,null,2)+'\n');
assert.equal(observed.runs.length,40);
for(const r of observed.runs){assert.equal(r.samples_ns.length,200);assert.ok(r.samples_ns.every(n=>Number.isSafeInteger(n)&&n>=0));assert.equal(r.ordinary_codec_hooks,0);}
assert.deepEqual(Object.fromEntries(paths.sort().map(p=>[p,hash(p)])),sourceHashes,'source changed during benchmark; raw retained, no accepted summary');
const percentile=(samples,p)=>[...samples].sort((a,b)=>a-b)[Math.max(0,Math.ceil(p*samples.length)-1)];
const groups=[];
for(const width of [1,16,128,1024])for(const lane of ['full_authoritative','incremental']){
  const runs=observed.runs.filter(r=>r.width===width&&r.lane===lane);
  const p95s=runs.map(r=>percentile(r.samples_ns,.95));const mean=p95s.reduce((a,b)=>a+b,0)/p95s.length;
  const cv=mean?Math.sqrt(p95s.reduce((a,n)=>a+(n-mean)**2,0)/(p95s.length-1))/mean:null;
  groups.push({width,lane,runQuantiles:runs.map(r=>({round:r.round,p50_ns:percentile(r.samples_ns,.5),p95_ns:percentile(r.samples_ns,.95),p99_ns:percentile(r.samples_ns,.99),zeroIntervals:r.samples_ns.filter(n=>n===0).length})),medianRunP95_ns:percentile(p95s,.5),rangeRunP95_ns:[Math.min(...p95s),Math.max(...p95s)],runP95SampleCV:cv,regressionVerdict:'not evaluated; descriptive same-source lanes only',noise:cv!==null&&cv>.1?'CV exceeds10%; stabilize before any comparison gate':'No regression gate or latency promise derived'});
}
const metadata={startedAt,completedAt:new Date().toISOString(),processLaunches:processRuns.map(({round,path,sha256,startedAt,completedAt})=>({round,path,sha256,startedAt,completedAt})),platform:os.platform(),release:os.release(),arch:os.arch(),cpus:os.cpus().map(({model,speed})=>({model,speed})),totalMemory:os.totalmem(),loadAverage:os.loadavg(),rustc:rustc.trim(),node:process.version,sourceHashes,binarySha256:hash('target/release/examples/delta_native'),rawSha256:hash('artifacts/delta-benchmark/raw.json'),timerResolution:'Not independently calibrated; all nanosecond samples and zero intervals retained.',scope:'Five separate native process launches; actual dispatch/profile validation only; session construction and64warmups excluded. Shared workstation thermals/power/load uncontrolled. Not an input-to-paint/RSS/SLA or prechange-source claim.'};
writeFileSync('artifacts/delta-benchmark/metadata.json',JSON.stringify(metadata,null,2)+'\n');
writeFileSync('artifacts/delta-benchmark/summary.json',JSON.stringify({format:'klenwriter-editor-delta-benchmark-summary/1',metadata,groups},null,2)+'\n');
console.log('DELTAS native benchmark PASS:5 interleaved rounds x4 widths x2 lanes x200 samples; raw and descriptive summary preserved; no regression verdict');
