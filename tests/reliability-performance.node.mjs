// SPDX-License-Identifier: MIT OR Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL, SYNTHETIC_ORACLES } from '../scripts/reliability/perf-protocol.mjs';
import { canonical, compare, digest, quantile, seal, statistics } from '../scripts/reliability/perf-compare.mjs';
import { captureActualMemory } from '../scripts/reliability/perf-memory.mjs';
import { createHash } from 'node:crypto';

const environment = { cpu: 'synthetic-fixed-cpu', os: 'synthetic-fixed-os', toolchain: 'literal', flags: ['release'], target: 'literal' };
const date = ms => new Date(Date.UTC(2026, 9, 18) + ms).toISOString();
function fixture(literal, { batch = 'A', start = 10000, scalar = false } = {}) {
  const evidence = { rawFiles: {},requests:{} };
  function make(side, values, captureId, epoch, calibration = false) {
    const runs = [], launches = [];
    for (const [round, value] of values.entries()) {
      const samples = Array(scalar ? 1 : 200).fill(value), raw = JSON.stringify({ samples,timerIncrement:.001 }), rawSha = createHash('sha256').update(raw).digest('hex'); evidence.rawFiles[rawSha] = raw;
      const id = `${captureId}-${side}-${round}`, first = calibration || (round % 2 === 0 ? side === 'baseline' : side === 'candidate');
      const offset = round * 100 + (first ? 0 : 20);
      const logical={input:'independent literal',profile:'synthetic',layer:'synthetic',workload:'command',samples:200,warmup:64,steps:4096},workloadSha256=digest(logical),deploymentRoot=`/literal/${side}`;evidence.requests[workloadSha256]=canonical(logical);
      launches.push(seal({ id, captureId, source: side === 'baseline' ? 'accepted64' : 'candidate38', side, round, cases: ['command'], startedAt: date(epoch + offset), completedAt: date(epoch + offset + 10), status: 0, rawSha256: rawSha,workloadSha256,deploymentRoot,requestSha256:digest({...logical,root:deploymentRoot}) }));
      runs.push({ case: 'command', round, unit: scalar ? 'bytes' : 'ns', sampling: scalar ? 'process-scalar' : 'per-operation', timerIncrement: .001, censored: 0, samples, launchId: id, raw: { sha256: rawSha }, rawPointer: ['samples'] });
    }
    return seal({ format: PROTOCOL.format, harness: 'frozen', source: side === 'baseline' ? 'accepted64' : 'candidate38', side, batch: captureId,
      mode: calibration ? 'calibration' : 'comparison', environment, runs, launches, capture: { id: captureId, startedAt: date(epoch), completedAt: date(epoch + 500) } });
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
