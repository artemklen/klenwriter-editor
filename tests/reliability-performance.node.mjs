// SPDX-License-Identifier: MIT OR Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL, SYNTHETIC_ORACLES } from '../scripts/reliability/perf-protocol.mjs';
import { canonical, compare, digest, quantile, seal, statistics } from '../scripts/reliability/perf-compare.mjs';
import { captureActualMemory } from '../scripts/reliability/perf-memory.mjs';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok } from '../scripts/reliability/perf-sdk-child.mjs';
import { analyze } from '../scripts/reliability/perf-analyze.mjs';
import { SCHEDULE_LIMITS, catalogForPlan, makeSchedule, scheduleEntries, validateSchedule } from '../scripts/reliability/perf-schedule.mjs';
import { defaultPlan } from '../scripts/reliability/perf-capture.mjs';

const environment = { cpu: 'synthetic-fixed-cpu', os: 'synthetic-fixed-os', toolchain: 'literal', flags: ['release'], target: 'literal' };
const date = ms => new Date(Date.UTC(2026, 9, 18) + ms).toISOString();
function fixture(literal, { batch = 'A', start = 10000, scalar = false } = {}) {
  const evidence = { rawFiles: {},requests:{} };
  function make(side, values, captureId, epoch, calibration = false) {
    const runs = [], launches = [];
    const schedule=seal(makeSchedule([{id:'command',phase:scalar?'allocator':'timing',cases:['command']}],values.length,calibration?'calibration':'comparison'));
    const entries=scheduleEntries(schedule).filter(entry=>entry.side===side);
    for (const [round, value] of values.entries()) {
      const samples = Array(scalar ? 1 : 200).fill(value), raw = JSON.stringify({ samples,timerIncrement:.001 }), rawSha = createHash('sha256').update(raw).digest('hex'); evidence.rawFiles[rawSha] = raw;
      const entry=entries[round];
      const id = `${captureId}-${side}-${round}`, first = calibration || (round % 2 === 0 ? side === 'baseline' : side === 'candidate');
      const offset = round * 100 + (first ? 0 : 20);
      const logical={input:'independent literal',profile:'synthetic',layer:'synthetic',workload:'command',samples:200,warmup:64,steps:4096},workloadSha256=digest(logical),deploymentRoot=`/literal/${side}`;evidence.requests[workloadSha256]=canonical(logical);
      launches.push(seal({ id, captureId, source: side === 'baseline' ? 'accepted64' : 'candidate38', side, round, phase:entry.phase, planItem:entry.item, scheduleIndex:entry.index, scheduleSha256:schedule.sha256, cases: ['command'], startedAt: date(epoch + offset), completedAt: date(epoch + offset + 10), status: 0, rawSha256: rawSha,workloadSha256,deploymentRoot,requestSha256:digest({...logical,root:deploymentRoot}) }));
      runs.push({ case: 'command', round, phase:entry.phase, scheduleIndex:entry.index, unit: scalar ? 'bytes' : 'ns', sampling: scalar ? 'process-scalar' : 'per-operation', timerIncrement: .001, censored: 0, samples, launchId: id, raw: { sha256: rawSha }, rawPointer: ['samples'] });
    }
    return seal({ format: PROTOCOL.format, harness: 'frozen', source: side === 'baseline' ? 'accepted64' : 'candidate38', side, batch: captureId,
      mode: calibration ? 'calibration' : 'comparison', schedule, environment, runs, launches, capture: { id: captureId, startedAt: date(epoch), completedAt: date(epoch + 500) } });
  }
  const calibrationRaw = make('baseline', [100,100,100,100,100], 'calibration', 0, true);
  const calibration = seal({ source: 'accepted64', harness: 'frozen', environment: digest(environment), adoptedBeforeCandidate: true, adoptedAt: date(1000), rawBaselineSha256: calibrationRaw.sha256, rationale: 'synthetic independent floor' });
  const policy = seal({ harness: 'frozen', baselineSource: 'accepted64', candidateSource: 'candidate38', environment: digest(environment), calibration, cases: { command: { absoluteFloor: literal.floor, unit: scalar ? 'bytes' : 'ns', sampling: scalar ? 'process-scalar' : 'per-operation' } } });
  const baseline = seal({ ...make('baseline', literal.baseline, batch, start), policy: policy.sha256 });
  const candidate = seal({ ...make('candidate', literal.candidate, batch, start), policy: policy.sha256 });
  return { baseline, candidate, policy, calibrationRaw, evidence };
}
for (const literal of SYNTHETIC_ORACLES) test(`performance comparator literal: ${literal.id}`, () => assert.equal(compare(fixture(literal)).status, literal.expected));
test('nearest-rank and sample CV are literal arithmetic', () => {
  assert.equal(quantile(Array.from({ length: 200 }, (_, n) => n + 1), .95), 190);
  assert.equal(quantile([3, 1, 2, 4, 5], .5), 3);
  assert.equal(statistics([100, 100, 100, 100, 100]).sampleCV, 0);
  assert.equal(statistics([0, 0, 0, 0, 0]).sampleCV, null);
});
test('independent second batch required and repeat regression fails', () => {
  const first = fixture(SYNTHETIC_ORACLES[2]);
  assert.equal(compare({ ...first, confirmation: first }).status, 'INCONCLUSIVE');
  const second = fixture(SYNTHETIC_ORACLES[2], { batch: 'B', start: 60000 });
  const evidence = { rawFiles: { ...first.evidence.rawFiles, ...second.evidence.rawFiles },requests:{...first.evidence.requests,...second.evidence.requests} };
  assert.equal(compare({ ...first, evidence, confirmation: second }).status, 'FAIL');
  const recovered = fixture({ ...SYNTHETIC_ORACLES[2], candidate: [100,100,100,100,100] }, { batch: 'C', start: 120000 });
  assert.equal(compare({ ...first, evidence: { rawFiles: { ...evidence.rawFiles, ...recovered.evidence.rawFiles },requests:{...evidence.requests,...recovered.evidence.requests} }, confirmation: recovered }).status, 'INCONCLUSIVE');
});
for (const [label, mutate] of [
  ['raw mismatch after sample removal', x => { x.candidate.runs[0].samples.pop(); x.candidate = seal(x.candidate); }],
  ['missing run', x => { x.baseline.runs.pop(); x.baseline = seal(x.baseline); }],
  ['corrupt seal', x => { x.baseline.runs[0].samples[0]++; }],
  ['source mismatch', x => { x.candidate = seal({ ...x.candidate, source: 'foreign' }); }],
  ['environment mismatch', x => { x.candidate = seal({ ...x.candidate, environment: { ...environment, cpu: 'other' } }); }],
  ['zero timer metadata contradiction', x => { x.candidate.runs[0].timerIncrement = 0; x.candidate = seal(x.candidate); }],
  ['coarse timer metadata contradiction', x => { x.candidate.runs[0].timerIncrement = 2; x.candidate = seal(x.candidate); }],
  ['raw mismatch after zero samples', x => { x.candidate.runs[0].samples.fill(0, 0, 3); x.candidate = seal(x.candidate); }],
  ['censoring', x => { x.candidate.runs[0].censored = 1; x.candidate = seal(x.candidate); }],
  ['unadopted calibration', x => { x.policy.calibration = seal({ ...x.policy.calibration, adoptedBeforeCandidate: false }); x.policy = seal(x.policy); }],
]) test(`performance comparator fails closed: ${label}`, () => { const value = fixture(SYNTHETIC_ORACLES[0]); mutate(value); assert.equal(compare(value).status, 'INCONCLUSIVE'); });
test('process scalar uses five real values and no fabricated sample quantiles', () => {
  const value = fixture(SYNTHETIC_ORACLES[0], { scalar: true });
  const result = compare(value); assert.equal(result.status, 'PASS');
  assert.equal(result.cases[0].baseline.runs[0].count, 1); assert.equal(Object.hasOwn(result.cases[0].baseline.runs[0], 'p99'), false);
});
test('mixed units, relabelled capture, raw corruption and late adoption are integrity failures', () => {
  for (const mutate of [
    x => { x.candidate.runs[1].unit = 'bytes'; x.candidate = seal(x.candidate); },
    x => { x.candidate.runs[1].round = 9; x.candidate = seal(x.candidate); },
    x => { x.candidate = seal({ ...x.candidate, capture: { ...x.candidate.capture, id: 'forged' } }); },
    x => { delete x.evidence.rawFiles[x.candidate.runs[0].raw.sha256]; },
    x => { x.policy.calibration = seal({ ...x.policy.calibration, adoptedAt: date(20000) }); x.policy = seal(x.policy); x.baseline=seal({...x.baseline,policy:x.policy.sha256}); x.candidate=seal({...x.candidate,policy:x.policy.sha256}); },
  ]) { const value=fixture(SYNTHETIC_ORACLES[0]); mutate(value); assert.equal(compare(value).integrity,'invalid'); }
  const value=fixture(SYNTHETIC_ORACLES[2]);
  const relabelled={baseline:seal({...value.baseline,batch:'renamed'}),candidate:seal({...value.candidate,batch:'renamed'})};
  assert.equal(compare({...value,confirmation:relabelled}).integrity,'invalid');
});
test('honest noisy timings retain valid integrity; invalid proof cannot pass CI integrity', () => {
  const noisy=compare(fixture(SYNTHETIC_ORACLES[4])); assert.equal(noisy.status,'INCONCLUSIVE'); assert.equal(noisy.integrity,'valid');
  const invalid=fixture(SYNTHETIC_ORACLES[0]); invalid.baseline.sha256='0'.repeat(64);
  assert.equal(compare(invalid).integrity,'invalid');
});
function synchronizeRaw(batch,evidence){
  const launches=batch.launches.map(row=>({...row}));
  for(const run of batch.runs){const raw=JSON.stringify({samples:run.samples,timerIncrement:run.timerIncrement}),sha=createHash('sha256').update(raw).digest('hex');evidence.rawFiles[sha]=raw;run.raw={sha256:sha};launches.find(row=>row.id===run.launchId).rawSha256=sha;}
  return seal({...batch,launches:launches.map(seal)});
}
test('coherent short samples and zeros reach their named statistical guards',()=>{
  const short=fixture(SYNTHETIC_ORACLES[0]);short.candidate.runs[0].samples.pop();short.candidate=synchronizeRaw(short.candidate,short.evidence);
  const a=compare(short);assert.equal(a.reason,'missing/invalid/short samples');assert.equal(a.integrity,'invalid');
  const zeros=fixture(SYNTHETIC_ORACLES[0]);zeros.candidate.runs[0].samples.fill(0,0,3);zeros.candidate=synchronizeRaw(zeros.candidate,zeros.evidence);
  const b=compare(zeros);assert.equal(b.reason,'insufficient timer');assert.equal(b.integrity,'valid');assert.equal(b.status,'INCONCLUSIVE');
  for(const increment of [0,2]){const coarse=fixture(SYNTHETIC_ORACLES[0]);coarse.candidate.runs[0].timerIncrement=increment;coarse.candidate=synchronizeRaw(coarse.candidate,coarse.evidence);const result=compare(coarse);assert.equal(result.reason,'insufficient timer');assert.equal(result.integrity,'valid');}
});
test('raw timer contradiction and validly resealed logical workload mismatch fail integrity',()=>{
  const timer=fixture(SYNTHETIC_ORACLES[0]);timer.candidate.runs[0].timerIncrement=.0000001;timer.candidate=seal(timer.candidate);
  assert.equal(compare(timer).reason,'timer metadata disagrees with raw');
  const workload=fixture(SYNTHETIC_ORACLES[0]);const logical={input:'different independent text',profile:'synthetic',layer:'synthetic',workload:'command',samples:200,warmup:64,steps:4096},sha=digest(logical);workload.evidence.requests[sha]=canonical(logical);
  workload.candidate=seal({...workload.candidate,launches:workload.candidate.launches.map(row=>seal({...row,workloadSha256:sha,requestSha256:digest({...logical,root:row.deploymentRoot})}))});
  assert.equal(compare(workload).reason,'paired logical workload mismatch');
});
test('same-instance host forwarder captures actual memory and restores APIs', async () => {
  const original = WebAssembly.instantiate;
  const bytes = Uint8Array.from([0,97,115,109,1,0,0,0,5,3,1,0,1,7,10,1,6,109,101,109,111,114,121,2,0]);
  const captured = await captureActualMemory(async () => (await WebAssembly.instantiate(bytes)).instance);
  assert.equal(captured.memory, captured.value.exports.memory); assert.equal(captured.instanceCount, 1); assert.equal(WebAssembly.instantiate, original);
  await assert.rejects(captureActualMemory(async () => { await WebAssembly.instantiate(bytes); return WebAssembly.instantiate(bytes); }), /exactly once/);
  assert.equal(WebAssembly.instantiate, original);
});

// Independent scheduling literals: catalog order deliberately interleaves phases.
const scheduleCatalogLiteral = [
  { id: 'timing-a', phase: 'timing', cases: ['a/latency'] },
  { id: 'allocator', phase: 'allocator', cases: ['heap/live', 'heap/peak'] },
  { id: 'timing-b', phase: 'timing', cases: ['b/latency'] },
];
function scheduleProof(mode='calibration') {
  const schedule=seal(makeSchedule(scheduleCatalogLiteral,5,mode)), entries=scheduleEntries(schedule);
  const launches=entries.map(entry=>seal({id:`launch-${entry.index}`,captureId:'schedule-literal',source:'literal',
    phase:entry.phase,planItem:entry.item,scheduleIndex:entry.index,scheduleSha256:schedule.sha256,round:entry.round,side:entry.side,
    startedAt:date(200000+entry.index*20),completedAt:date(200010+entry.index*20),status:0,
    cases:schedule.items.find(item=>item.id===entry.item).cases}));
  const runs=launches.flatMap(launch=>launch.cases.map(id=>({case:id,launchId:launch.id,round:launch.round,phase:launch.phase,scheduleIndex:launch.scheduleIndex})));
  return {schedule,launches,runs};
}
test('schedule literal has all timing rounds before allocator and preserves catalog order',()=>{
  const {schedule,launches,runs}=scheduleProof();assert.equal(validateSchedule(schedule,launches,runs),true);
  assert.deepEqual(scheduleEntries(schedule).map(entry=>[entry.phase,entry.round,entry.item]),[
    ['timing',0,'timing-a'],['timing',0,'timing-b'],['timing',1,'timing-a'],['timing',1,'timing-b'],
    ['timing',2,'timing-a'],['timing',2,'timing-b'],['timing',3,'timing-a'],['timing',3,'timing-b'],
    ['timing',4,'timing-a'],['timing',4,'timing-b'],['allocator',0,'allocator'],['allocator',1,'allocator'],
    ['allocator',2,'allocator'],['allocator',3,'allocator'],['allocator',4,'allocator'],
  ]);
});
test('schedule preserves full frozen82-item208-metric410-launch calibration coverage',()=>{
  const shapes=['long-leaf','many-blocks','deep-ancestors','lists','table','near-nodes','near-bytes','small'];
  const rows=['kwdj','notes'].flatMap(profile=>shapes.map(shape=>({id:`${profile}/${shape}`,profile,shape,supported:!(profile==='notes'&&['lists','table'].includes(shape))})));
  const plan=defaultPlan(rows),schedule=seal(makeSchedule(catalogForPlan(plan),5,'calibration')),entries=scheduleEntries(schedule);
  assert.equal(plan.length,82);assert.equal(schedule.items.flatMap(item=>item.cases).length,208);assert.equal(entries.length,410);
  const suffixCounts={};for(const id of schedule.items.flatMap(item=>item.cases)){const suffix=id.split('/').at(-1);suffixCounts[suffix]=(suffixCounts[suffix]??0)+1;}
  assert.deepEqual(suffixCounts,{latency:70,'wasm-capacity':34,'sampled-process-rss':34,'cold-startup':34,allocated:12,live:12,'whole-process-peak':12});
  assert.equal(entries.reduce((count,entry)=>count+schedule.items.find(item=>item.id===entry.item).cases.length,0),1040);
  const comparison=makeSchedule(catalogForPlan(plan),5,'comparison'),both=scheduleEntries(comparison);
  assert.equal(both.length,820);assert.equal(both.reduce((count,entry)=>count+comparison.items.find(item=>item.id===entry.item).cases.length,0),2080);
  assert.equal(entries.filter(entry=>entry.phase==='timing').length,350);assert.equal(entries.filter(entry=>entry.phase==='allocator').length,60);
  assert.equal(entries.slice(0,350).every(entry=>entry.phase==='timing'),true);assert.equal(entries.slice(350).every(entry=>entry.phase==='allocator'),true);
  for(const item of schedule.items)assert.deepEqual(entries.filter(entry=>entry.item===item.id).map(entry=>entry.round),[0,1,2,3,4]);
});
test('comparison schedule retains both sides and AB/BA within each phase and round',()=>{
  const {schedule,launches,runs}=scheduleProof('comparison');assert.equal(validateSchedule(schedule,launches,runs),true);
  for(const side of ['baseline','candidate'])assert.equal(validateSchedule(schedule,launches.filter(launch=>launch.side===side),runs.filter(run=>launches.find(launch=>launch.id===run.launchId).side===side),{side}),true);
  for(let i=0;i<launches.length;i+=2)assert.deepEqual(launches.slice(i,i+2).map(launch=>launch.side),launches[i].round%2===0?['baseline','candidate']:['candidate','baseline']);
});
for(const [name,mutate,reason] of [
  ['missing launch',proof=>proof.launches.pop(),'schedule launch count mismatch'],
  ['duplicate launch',proof=>{proof.launches[1]={...proof.launches[0]};},'duplicate/invalid scheduled launch'],
  ['wrong actual order',proof=>{[proof.launches[0],proof.launches[1]]=[proof.launches[1],proof.launches[0]];},'schedule launch binding/order mismatch'],
  ['wrong phase',proof=>{proof.launches[0].phase='allocator';},'schedule launch binding/order mismatch'],
  ['wrong descriptor binding',proof=>{proof.launches[0].scheduleSha256='f'.repeat(64);},'schedule launch binding/order mismatch'],
  ['chronological reversal with intact indexes',proof=>{proof.launches[1].startedAt=date(199000);proof.launches[1].completedAt=date(199010);},'schedule chronological order mismatch'],
  ['missing metric',proof=>{proof.runs.pop();},'scheduled metric coverage mismatch'],
  ['duplicate metric',proof=>{proof.runs[proof.runs.length-1]={...proof.runs[proof.runs.length-2]};},'scheduled metric coverage mismatch'],
  ['wrong metric phase',proof=>{proof.runs[0].phase='allocator';},'scheduled metric phase binding mismatch'],
])test(`schedule fails closed: ${name}`,()=>{const proof=scheduleProof();mutate(proof);assert.throws(()=>validateSchedule(proof.schedule,proof.launches,proof.runs),{message:reason});});
test('comparator classifies a validly resealed wrong phase as integrity-invalid',()=>{
  const value=fixture(SYNTHETIC_ORACLES[0]);value.candidate.launches[0]=seal({...value.candidate.launches[0],phase:'allocator'});value.candidate=seal(value.candidate);
  const result=compare(value);assert.equal(result.reason,'schedule launch binding/order mismatch');assert.equal(result.integrity,'invalid');
});

test('schedule rejects unsupported phase order and duplicate catalog entries',()=>{
  const {schedule}=scheduleProof();assert.throws(()=>scheduleEntries({...schedule,phaseOrder:['allocator','timing']}),{message:'unsupported schedule phase order'});
  assert.throws(()=>makeSchedule([...scheduleCatalogLiteral,scheduleCatalogLiteral[0]],5,'calibration'),{message:'duplicate/invalid schedule item'});
  assert.throws(()=>makeSchedule([{id:'a',phase:'timing',cases:['duplicate']},{id:'b',phase:'allocator',cases:['duplicate']}],5,'calibration'),{message:'duplicate/invalid scheduled metric'});
});
test('merged comparison schedule detects reversed AB/BA even when both side projections pass',()=>{
  const {schedule,launches,runs}=scheduleProof('comparison');
  [launches[0].startedAt,launches[1].startedAt]=[launches[1].startedAt,launches[0].startedAt];
  [launches[0].completedAt,launches[1].completedAt]=[launches[1].completedAt,launches[0].completedAt];
  for(const side of ['baseline','candidate'])assert.equal(validateSchedule(schedule,launches.filter(launch=>launch.side===side),runs.filter(run=>launches.find(launch=>launch.id===run.launchId).side===side),{side}),true);
  const actualOrder=[...launches].sort((a,b)=>Date.parse(a.startedAt)-Date.parse(b.startedAt));
  assert.throws(()=>validateSchedule(schedule,actualOrder,runs),{message:'schedule launch binding/order mismatch'});
});
test('missing or corrupt schedule is an integrity failure after the enclosing batch is resealed',()=>{
  for(const mutate of [batch=>{delete batch.schedule;},batch=>{batch.schedule.sha256='0'.repeat(64);}]){
    const value=fixture(SYNTHETIC_ORACLES[0]);mutate(value.candidate);value.candidate=seal(value.candidate);
    const result=compare(value);assert.equal(result.integrity,'invalid');assert.equal(result.reason,'missing/corrupt capture schedule');
  }
});

// These are bounded pure integrity inputs, never permission to launch captures.
function unreadArray(length, message) {
  const value=new Array(length);Object.defineProperty(value,0,{get(){throw new Error(message);}});return value;
}
test('enormous safe-integer rounds reject before catalog reads or entry materialization',()=>{
  const items=[{id:'a',phase:'timing',get cases(){throw new Error('catalog visited before round bound');}}];
  for(const rounds of [2**32,Number.MAX_SAFE_INTEGER])for(const mode of ['calibration','comparison']){
    assert.throws(()=>makeSchedule(items,rounds,mode),{message:'schedule launch budget exceeded'});
    assert.throws(()=>scheduleEntries({format:'editor-reliability-capture-schedule/1',phaseOrder:['timing','allocator'],mode,rounds,items}),{message:'schedule launch budget exceeded'});
  }
  assert.throws(()=>makeSchedule(items,Number.MAX_SAFE_INTEGER+1,'comparison'),{message:'invalid schedule rounds'});
});
test('impossible plan and catalog lengths reject before visiting or cloning inputs',()=>{
  const enormous=unreadArray(2**32-1,'input visited before length bound');
  assert.throws(()=>catalogForPlan(enormous),{message:'schedule launch budget exceeded'});
  assert.throws(()=>makeSchedule(enormous,5,'calibration'),{message:'schedule launch budget exceeded'});
  const productTooLarge=unreadArray(2049,'catalog visited before product bound');
  assert.throws(()=>makeSchedule(productTooLarge,5,'comparison'),{message:'schedule launch budget exceeded'});
});
test('metric products and aggregate cases reject before metric reads or clones',()=>{
  const cases=unreadArray(6554,'metric visited before product bound');
  assert.throws(()=>makeSchedule([{id:'a',phase:'timing',cases}],5,'comparison'),{message:'schedule metric budget exceeded'});
  const aggregate=[{id:'a',phase:'timing',cases:unreadArray(3277,'first metric visited before aggregate bound')},
    {id:'b',phase:'allocator',cases:unreadArray(3277,'second metric visited before aggregate bound')}];
  assert.throws(()=>makeSchedule(aggregate,5,'comparison'),{message:'schedule metric budget exceeded'});
});
test('oversized actual launch and metric tables reject before row visits',()=>{
  const {schedule,launches,runs}=scheduleProof();
  assert.deepEqual(SCHEDULE_LIMITS,{launchEntries:16384,metricRows:65536});
  assert.throws(()=>validateSchedule(schedule,unreadArray(16385,'launch visited before table bound'),runs),{message:'schedule launch budget exceeded'});
  assert.throws(()=>validateSchedule(schedule,launches,unreadArray(65537,'metric visited before table bound')),{message:'schedule metric budget exceeded'});
});

test('successful perf responses do not format diagnostic JSON', () => {
  let formattingCalls = 0;
  const value = { toJSON() { formattingCalls++; throw new Error('diagnostic formatting must stay outside the successful path'); } };
  assert.equal(ok({ status: 'ok', value }), value);
  assert.equal(formattingCalls, 0);
});
test('failed perf responses retain the status assertion and diagnostic', () => {
  assert.throws(() => ok({ status: 'refused', error: { kind: 'literal-refusal' } }),
    error => error.code === 'ERR_ASSERTION' && error.message.includes('literal-refusal'));
});
function malformedOriginalReport(kind) {
  const directory = mkdtempSync(join(tmpdir(), 'osr38-original-report-'));
  const record = (name, bytes) => {
    const path = join(directory, name); writeFileSync(path, bytes, { flag: 'wx' });
    return { path, bytes: Buffer.byteLength(bytes), sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  try {
    const plan = [{ id: 'literal/core/command', layer: 'core' }];
    const schedule = seal(makeSchedule(catalogForPlan(plan), 5, 'calibration'));
    const originalSchedule = record('schedule.json', kind === 'schedule' ? '{' : JSON.stringify(schedule));
    const originalPlan = record('plan.json', kind === 'plan' ? '{' : JSON.stringify(plan));
    const batch = record('batch.json', JSON.stringify({ schedule, scheduleRecord: originalSchedule, plan: originalPlan,
      launches: [], launchRecords: [], runs: [] }));
    const policy = record('policy.json', '{}');
    const report = analyze({ baseline: batch.path, candidate: batch.path, calibration: batch.path, policy: policy.path, requireConclusive: true });
    assert.equal(report.status, 'INCONCLUSIVE'); assert.equal(report.integrity, 'invalid');
    assert.equal(report.acceptanceScope, 'unverified');
    assert.match(report.reason, /^Evidence loading\/validation failed: SyntaxError:/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
for (const kind of ['schedule', 'plan']) test(`analyzer retains an invalid report for malformed original ${kind}`, () => malformedOriginalReport(kind));
