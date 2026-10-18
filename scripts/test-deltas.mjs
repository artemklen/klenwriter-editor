// SPDX-License-Identifier: MIT OR Apache-2.0
// Isolated proof lane: no installed SDK export or browser callback claim.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const run=(program,args)=>{
  const result=spawnSync(program,args,{encoding:'utf8',maxBuffer:32*1024*1024});
  if(result.status!==0)throw new Error(`${program} ${args.join(' ')} failed (${result.status}):\n${result.stderr??''}`);
  return result.stdout;
};
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const walk=path=>readdirSync(path,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(`${path}/${entry.name}`):entry.name.endsWith('.rs')?[`${path}/${entry.name}`]:[]);
const fixed=['Cargo.toml','Cargo.lock','rust-toolchain.toml','crates/core/Cargo.toml','crates/engine/Cargo.toml','crates/kwdj/Cargo.toml','crates/wasm/Cargo.toml','evidence/osr-37/execution-contract.md','docs/m0/performance-protocol.md','crates/wasm/examples/support/delta_literals.json','crates/wasm/examples/support/delta_observer.rs','crates/wasm/examples/support/delta_series.rs','crates/wasm/examples/support/delta_benchmark.rs','crates/wasm/examples/delta_native.rs','crates/wasm/examples/delta_probe.rs','crates/wasm/tests/deltas.rs','crates/wasm/tests/delta_equivalence.rs','scripts/test-deltas.mjs','scripts/benchmark-deltas.mjs','package.json'];
const sources=[...new Set([...fixed,...walk('crates/core/src'),...walk('crates/engine/src'),...walk('crates/kwdj/src')])].sort();
const before=Object.fromEntries(sources.map(path=>[path,hash(path)]));
assert.match(run('rustc',['--version']),/^rustc 1\.97\.1 /,'use pinned toolchain');
assert.equal(run('.tools/bin/wasm-bindgen',['--version']).trim(),'wasm-bindgen 0.2.129');
mkdirSync('artifacts/deltas',{recursive:true});
run('cargo',['build','--locked','--release','--target','wasm32-unknown-unknown','-p','klenwriter-editor-wasm','--example','delta_probe']);
run('.tools/bin/wasm-bindgen',['target/wasm32-unknown-unknown/release/examples/delta_probe.wasm','--target','web','--out-dir','artifacts/deltas','--out-name','probe']);
const nativeRaw=run('cargo',['run','--quiet','--locked','-p','klenwriter-editor-wasm','--example','delta_native']);
writeFileSync('artifacts/deltas/native-observer.json',nativeRaw);
const module=await import(pathToFileURL(resolve('artifacts/deltas/probe.js')).href);
await module.default({module_or_path:readFileSync('artifacts/deltas/probe_bg.wasm')});
const wasmRaw=module.observeDeltas();writeFileSync('artifacts/deltas/wasm-observer.json',wasmRaw+'\n');
const native=JSON.parse(nativeRaw),wasm=JSON.parse(wasmRaw),repeat=JSON.parse(module.observeDeltas());
assert.deepEqual(wasm.portable,native.portable);assert.deepEqual(repeat.portable,wasm.portable);
assert.equal(wasm.portable.status,'passed');assert.equal(wasm.portable.literals.literal_total,13);
assert.equal(wasm.portable.literals.same_literal_and_full_authoritative_results,true);
const literal=JSON.parse(readFileSync('crates/wasm/examples/support/delta_literals.json','utf8'));
assert.equal(wasm.portable.series.case_total,literal.series.expected_case_total);
assert.equal(wasm.portable.series.cases.length,literal.series.expected_case_total);
for(const c of wasm.portable.literals.cases)assert.equal(c.status,'passed');
for(const c of wasm.portable.series.cases){assert.equal(c.status,'passed');assert.equal(c.ordinary_codec_hooks,0);}
const after=Object.fromEntries(sources.map(path=>[path,hash(path)]));assert.deepEqual(after,before,'source changed during observation; raw results retained, no valid report minted');
const artifactHashes=Object.fromEntries(['artifacts/deltas/probe_bg.wasm','artifacts/deltas/probe.js','target/debug/examples/delta_native','artifacts/deltas/native-observer.json','artifacts/deltas/wasm-observer.json'].map(path=>[path,hash(path)]));
const report={format:'klenwriter-editor-deltas-report/1',nativeWasmEqual:true,sourceHashes:after,artifactHashes,portable:wasm.portable,nativeDiagnostics:native.diagnostics,wasmDiagnostics:wasm.diagnostics,nativeOnlySupplement:{path:'crates/wasm/tests/delta_equivalence.rs',execution:'Separate native workspace gate, not executed/claimed by this shared observer.'},generatedAt:new Date().toISOString()};
writeFileSync('artifacts/deltas-report.json',JSON.stringify(report,null,2)+'\n');
console.log(`DELTAS native/WASM PASS: literals=13 series=${literal.series.expected_case_total}; source hashes=${sources.length}; report=artifacts/deltas-report.json`);
