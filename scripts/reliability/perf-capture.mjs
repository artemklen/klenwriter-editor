// SPDX-License-Identifier: MIT OR Apache-2.0
// Explicit quiet-phase runner; imports are side-effect free.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { corpus, notesCapacityRow } from './perf-corpus.mjs';
import { PROTOCOL } from './perf-protocol.mjs';
import { canonical, digest, seal, verified, statistics, quantile, validateCalibration } from './perf-compare.mjs';
import { fileRecord, hashFile, productionHashes, harnessHashes } from './perf-build.mjs';
import { bundleFootprint } from './perf-bundle.mjs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { loadEvidence } from './perf-evidence.mjs';

const harnessRoot = fileURLToPath(new URL('../../', import.meta.url));
const childScript = fileURLToPath(new URL('./perf-sdk-child.mjs', import.meta.url));
const read = path => JSON.parse(readFileSync(path, 'utf8'));
function persist(path, value) { assert.ok(!existsSync(path), `refuse overwrite: ${path}`); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); return fileRecord(path); }
function observation() {
  const power = process.platform === 'darwin' ? spawnSync('/usr/bin/pmset', ['-g', 'batt'], { encoding: 'utf8' }) : null;
  return { at: new Date().toISOString(), load_average: os.loadavg(), free_memory: os.freemem(), power_raw: power?.stdout ?? null, power_exit: power?.status ?? null,
    qualification: 'Observed power/load only; no claim of measured thermal throttling, scheduler isolation or physical peak RSS.' };
}
export function environmentIdentity() {
  return { platform: os.platform(), os_release: os.release(), arch: os.arch(), cpu: os.cpus().map(cpu => cpu.model), total_memory: os.totalmem(), node: process.version,
    process_exec_argv: process.execArgv, timer: 'node:perf_hooks performance.now ns conversion / Rust Instant ns', release: 'lto=true;codegen-units=1;opt-level=s',
    host: os.hostname(), runtime: process.versions };
}
export function defaultPlan(rows) {
  const plan = [];
  for (const row of rows.filter(row => row.supported && row.shape !== 'small')) for (const layer of ['core', 'native-bridge', 'wasm-bridge', 'sdk']) plan.push({ corpus: row.id, layer, workload: 'command' });
  for (const row of rows.filter(row => row.supported && row.shape === 'small')) {
    for (const layer of ['core', 'native-bridge', 'wasm-bridge', 'sdk']) for (const workload of ['export', 'lifecycle']) plan.push({ corpus: row.id, layer, workload });
    for (const layer of ['core', 'sdk']) plan.push({ corpus: row.id, layer, workload: 'long-session', steps: 4096 });
    plan.push({ corpus: row.id, layer: 'core', workload: 'recurrence', steps: 4096 });
  }
  for (const row of rows.filter(row => row.supported && row.shape !== 'small')) plan.push({ corpus: row.id, layer: 'allocator', workload: 'command' });
  return plan.map(row => ({ ...row, id: `${row.corpus}/${row.layer}/${row.workload}` }));
}
function verifiedSide(side, currentHarness) {
  const producer = read(side.nativeBuild);
  assert.ok(verified(producer)); assert.equal(producer.format, 'editor-reliability-native-build/1');
  assert.equal(producer.harness, digest(currentHarness)); assert.equal(canonical(producer.harnessHashes), canonical(currentHarness));
  assert.equal(canonical(productionHashes(producer.sourceRoot)), canonical(producer.sourceHashes), 'changed native production source');
  for (const artifact of [producer.benchmark, producer.allocator]) assert.equal(hashFile(artifact.path), artifact.sha256);
  assert.equal(producer.sourceCommit, side.sourceCommit);
  const distribution = read(resolve(side.distributionRoot, 'artifacts/sdk-build-identity.json'));
  for (const [path, hash] of Object.entries(distribution.sourceHashes)) {
    // Runtime sources must equal the declared source tree. Test/build inputs
    // remain separately bound in the packaged producer identity.
    if (/^crates\/[^/]+\/src\/|^crates\/[^/]+\/Cargo.toml$|^packages\/[^/]+\/src\//.test(path)) assert.equal(hashFile(resolve(producer.sourceRoot, path)), hash, `packaged runtime source ${path}`);
  }
  const artifacts = Object.fromEntries(['packages/wasm/dist/editor_wasm_bg.wasm', 'packages/wasm/dist/editor_wasm.js', 'packages/sdk/dist/index.js', 'packages/sdk/dist/controller.js', 'artifacts/sdk-build-identity.json', 'artifacts/sdk-wasm-seal.json'].map(path => [path, fileRecord(resolve(side.distributionRoot, path))]));
  const sealReceipt = read(artifacts['artifacts/sdk-wasm-seal.json'].path);
  assert.equal(sealReceipt.sealed_sha256, artifacts['packages/wasm/dist/editor_wasm_bg.wasm'].sha256); assert.equal(sealReceipt.build_id, distribution.buildId);
  return { producer, distribution, artifacts, bundle: bundleFootprint(side.distributionRoot) };
}
function runOne({ side, sideName, verified: proof, row, item, output, samples, warmup, round, captureId, requestDirectory }) {
  const allocator = item.layer === 'allocator';
  const request = { profile: row.profile, input: row.input, registry: row.registry, root_blocks: row.root_blocks, first_text_path: row.first_text_path,
    layer: item.layer === 'native-bridge' ? 'bridge' : allocator ? 'core' : item.layer, workload: item.workload, samples, warmup, steps: item.steps ?? 4096 };
  const args = [], native = ['core', 'native-bridge', 'allocator'].includes(item.layer);
  const executable = native ? allocator ? proof.producer.allocator.path : proof.producer.benchmark.path : process.execPath;
  if (!native) { args.push(childScript); request.root = resolve(side.distributionRoot); }
  const logical={...request};delete logical.root;
  const workloadSha256=digest(logical),logicalBytes=Buffer.from(JSON.stringify(logical)),requestPath=`${requestDirectory}/${workloadSha256}.json.gz`;
  mkdirSync(requestDirectory,{recursive:true});if(!existsSync(requestPath))writeFileSync(requestPath,gzipSync(logicalBytes,{mtime:0}));
  const logicalRequest={bytes:logicalBytes.length,sha256:createHash('sha256').update(logicalBytes).digest('hex'),gzip:fileRecord(requestPath)};
  const stdin=JSON.stringify(request);
  mkdirSync(output, { recursive: true });
  const before = observation();
  const startedAt = new Date().toISOString();
  const result = spawnSync(executable, args, { cwd: output, input: stdin, encoding: 'utf8', timeout: 30 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  const completedAt = new Date().toISOString();
  writeFileSync(`${output}/stdout.json`, result.stdout ?? ''); writeFileSync(`${output}/stderr.log`, result.stderr ?? '');
  const launch = { id: randomUUID(), captureId, round, side: sideName, startedAt, completedAt, executable, args, requestSha256: digest(request),stdinSha256:createHash('sha256').update(stdin).digest('hex'),logicalRequest,workloadSha256,deploymentRoot:request.root??null, source: side.sourceCommit, before, after: observation(), status: result.status, signal: result.signal, error: result.error?.message ?? null,
    stdout: fileRecord(`${output}/stdout.json`), stderr: fileRecord(`${output}/stderr.log`) };
  if (result.status !== 0) persist(`${output}/launch.json`, seal({ ...launch, cases: [], rawSha256s: [launch.stdout.sha256] }));
  assert.equal(result.status, 0, `actual child failed ${output}`);
  const value = JSON.parse(result.stdout); const measurements = [];
  const add = (suffix, unit, values, pointer, sampling = 'per-operation', raw = launch.stdout, rawReducer = null) => measurements.push({ case: `${item.id}/${suffix}`, unit, samples: values, sampling, timerIncrement: value.timerIncrement, censored: 0, raw, rawPointer: pointer, rawReducer, launchId: launch.id });
  if (!allocator) add('latency', 'ns', value.samples, ['samples']);
  else {
    add('allocated', 'bytes', value.allocation_samples, ['allocation_samples']); add('live', 'bytes', value.live_samples, ['live_samples']);
    const dhat = read(`${output}/dhat-heap.json`);
    // DHAT gb is each allocation site's bytes AT THE SAME global maximum;
    // summing mb would instead sum unrelated individual-site peaks.
    assert.ok(Array.isArray(dhat.pps) && dhat.pps.every(pp => Number.isSafeInteger(pp.gb)));
    add('whole-process-peak', 'bytes', [dhat.pps.reduce((sum, pp) => sum + pp.gb, 0)], ['pps'], 'process-scalar', fileRecord(`${output}/dhat-heap.json`), 'sum-dhat-global-bytes');
    persist(`${output}/dhat-binding.json`, { raw: fileRecord(`${output}/dhat-heap.json`), scope: 'profiler starts before input parse; stops after result output; system allocator wrapper, profiler-internal allocations excluded by DHAT' });
  }
  if (!native) {
    assert.equal(value.same_actual_instance_count, 1); assert.equal(value.build_id, proof.distribution.buildId);
    add('wasm-capacity', 'bytes', value.capacity_samples, ['capacity_samples']);
    add('sampled-process-rss', 'bytes', [Math.max(...value.sampled_process_rss)], ['sampled_process_rss'], 'process-scalar', launch.stdout, 'max');
    add('cold-startup','ns',[value.startup_ns],['startup_ns'],'process-scalar',launch.stdout,'scalar');
  }
  launch.cases = measurements.map(row=>row.case); launch.rawSha256s = [...new Set(measurements.map(row=>row.raw.sha256))];
  const sealed = seal(launch); persist(`${output}/launch.json`, sealed);
  return { measurements, launch: fileRecord(`${output}/launch.json`), provenance: sealed };
}
export function capture(config) {
  assert.equal(config.authorizedQuietCapture, true, 'root must authorize actual quiet phase');
  assert.ok(['calibration', 'comparison'].includes(config.mode));
  assert.ok(config.rounds >= 5 && config.samples >= 200 && config.warmup >= 0 && config.warmup % 2 === 0 && config.samples % 2 === 0);
  assert.ok(config.output && !existsSync(config.output), 'new output directory per batch');
  assert.ok(typeof config.batch === 'string' && config.batch.length > 0);
  const capacity=read(config.notesCapacity);assert.ok(verified(capacity));assert.equal(capacity.source,'9a3747c0738fded8254eb958f7e256369cd382d3');
  for(const row of capacity.rows)for(const outcome of Object.values(row.outcomes)){assert.equal(hashFile(outcome.raw.path),outcome.raw.sha256);assert.equal(hashFile(outcome.proof.path),outcome.proof.sha256);}
  const sourceBefore = harnessHashes(harnessRoot), environment = environmentIdentity(), rows = corpus(harnessRoot,capacity.selected), plan = config.plan ?? defaultPlan(rows);
  const fullPlan = canonical(plan)===canonical(defaultPlan(rows));
  assert.ok(fullPlan || config.diagnosticSubset===true, 'subset plan must explicitly declare diagnostic scope');
  const bindings = {};
  for (const side of config.mode === 'calibration' ? ['baseline'] : ['baseline', 'candidate']) bindings[side] = verifiedSide(config[side], sourceBefore);
  for(const side of Object.keys(bindings)){
    const observed=read(config[side].capacityVerification??config.notesCapacity);assert.ok(verified(observed));assert.equal(observed.source,config[side].sourceCommit);assert.equal(canonical(observed.selected),canonical(capacity.selected));
    if(side==='candidate')assert.equal(observed.reference,capacity.sha256,'candidate must verify frozen reference controls');
    bindings[side].capacity=fileRecord(config[side].capacityVerification??config.notesCapacity);
  }
  if (bindings.candidate) assert.equal(bindings.baseline.producer.toolchain, bindings.candidate.producer.toolchain);
  environment.native_toolchain = bindings.baseline.producer.toolchain;
  const corpusReceipt = persist(`${config.output}/corpus.json`, { format: 'editor-reliability-performance-corpus/1', rows });
  const planReceipt = persist(`${config.output}/plan.json`, plan);
  let policy;
  if (config.mode === 'comparison') {
    policy = read(config.policy); assert.ok(verified(policy)); assert.equal(policy.harness, digest(sourceBefore)); assert.equal(policy.environment, digest(environment));
    assert.equal(policy.baselineSource, config.baseline.sourceCommit); assert.equal(policy.candidateSource, config.candidate.sourceCommit);
    assert.ok(verified(policy.calibration) && policy.calibration.adoptedBeforeCandidate === true);
    const calibrationRaw=read(config.calibration), evidence=loadEvidence([calibrationRaw]);
    validateCalibration(policy,calibrationRaw,evidence,new Date().toISOString());
  }
  const results = { baseline: [], candidate: [] }, launches = [], provenance = { baseline: [], candidate: [] },launchRecords={baseline:[],candidate:[]};
  const captureIdentity = { id: randomUUID(), startedAt: new Date().toISOString() };
  for (let round = 0; round < config.rounds; round++) {
    // Alternating AB/BA orders avoid a fixed side-order bias within each round.
    const sides = config.mode === 'calibration' ? ['baseline'] : round % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
    for (const item of plan) for (const side of sides) {
      let row = rows.find(row => row.id === item.corpus); assert.ok(row?.supported, `unsupported corpus: ${item.corpus}`);
      if(row.profile==='notes'&&row.shape!=='small'){
        const selected=capacity.selectedOperations[item.workload==='export'?'export':'command'][row.shape];row=notesCapacityRow(harnessRoot,row.shape,selected.quantity);assert.equal(row.input_sha256,selected.inputSha256);
      }
      const output = resolve(config.output, `round-${round}`, side, item.id.replaceAll('/', '__'));
      const result = runOne({ side: config[side], sideName: side, verified: bindings[side], row, item, output, samples: config.samples, warmup: config.warmup, round, captureId: captureIdentity.id,requestDirectory:resolve(config.output,'requests') }); launches.push(result.launch); provenance[side].push(result.provenance);launchRecords[side].push({id:result.provenance.id,...result.launch});
      for (const measurement of result.measurements) results[side].push({ ...measurement, round });
    }
  }
  captureIdentity.completedAt = new Date().toISOString();
  assert.equal(canonical(harnessHashes(harnessRoot)), canonical(sourceBefore), 'changed harness during capture');
  for (const side of Object.keys(bindings)) assert.equal(canonical(productionHashes(bindings[side].producer.sourceRoot)), canonical(bindings[side].producer.sourceHashes), 'changed production during capture');
  for (const binding of Object.values(bindings)) for (const artifact of Object.values(binding.artifacts)) assert.equal(hashFile(artifact.path), artifact.sha256, 'packaged artifact changed during capture');
  const receipts = {};
  for (const side of Object.keys(bindings)) receipts[side] = persist(`${config.output}/${side}.json`, seal({ format: PROTOCOL.format, harness: digest(sourceBefore), source: config[side].sourceCommit, side, batch: config.batch, environment,
    mode: config.mode, acceptanceScope: fullPlan?'full-required-plan':'diagnostic-subset', policy: policy?.sha256 ?? null, capture: captureIdentity, launches: provenance[side],launchRecords:launchRecords[side], bindings: bindings[side], corpus: corpusReceipt, plan: planReceipt, runs: results[side] }));
  persist(`${config.output}/capture.json`, seal({ format: 'editor-reliability-performance-capture/1', config, environment, corpus: corpusReceipt, plan: planReceipt, receipts, launches }));
  return receipts;
}
export function calibrationProposal(baselinePath) {
  const baseline = read(baselinePath); assert.ok(verified(baseline) && baseline.side === 'baseline' && baseline.mode === 'calibration');
  const cases = {};
  for (const id of [...new Set(baseline.runs.map(run => run.case))].sort()) {
    const runs = baseline.runs.filter(run => run.case === id), scalar = runs[0].sampling === 'process-scalar';
    assert.ok(runs.length >= 5 && runs.every(run => run.samples.length >= (scalar ? 1 : 200)));
    const stats = statistics(runs.map(run => quantile(run.samples, .95)));
    cases[id] = { unit: runs[0].unit, sampling: runs[0].sampling, observed: stats, stable: stats.sampleCV !== null && stats.sampleCV <= .1,
      absoluteFloor: /\/export\/latency$/.test(id) ? 200000 : /\/cold-startup$/.test(id) ? 5000000 : /\/sampled-process-rss$/.test(id) ? 32 * 1024 * 1024 : null };
  }
  return seal({ format: 'editor-reliability-floor-proposal/1', source: baseline.source, harness: baseline.harness, environment: digest(baseline.environment), rawBaselineSha256: baseline.sha256,
    adoptedBeforeCandidate: false, rationale: null, cases, status: 'PENDING_EXPLICIT_FLOOR_ADOPTION', qualification: 'Null command/allocator/capacity floors require explicit measured calibration adoption before candidate comparison. Noise never raises a floor.' });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'calibration-proposal') console.log(JSON.stringify(calibrationProposal(process.argv[3]), null, 2));
  else console.log(JSON.stringify(capture(read(process.argv[2])), null, 2));
}
