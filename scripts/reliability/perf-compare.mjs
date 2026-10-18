// SPDX-License-Identifier: MIT OR Apache-2.0
import { createHash } from 'node:crypto';
import { PROTOCOL } from './perf-protocol.mjs';

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('non-JSON measurement');
  return JSON.stringify(value);
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export function seal(value) { const { sha256: _ignored, ...body } = value; return { ...body, sha256: digest(body) }; }
export function verified(value) { const { sha256, ...body } = value ?? {}; return /^[a-f0-9]{64}$/.test(sha256 ?? '') && digest(body) === sha256; }
export function quantile(values, p) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]; }
export function statistics(values) {
  const mean = values.reduce((sum, n) => sum + n, 0) / values.length;
  const variance = values.length > 1 ? values.reduce((sum, n) => sum + (n - mean) ** 2, 0) / (values.length - 1) : 0;
  return { median: quantile(values, .5), range: [Math.min(...values), Math.max(...values)], sampleCV: mean === 0 ? null : Math.sqrt(variance) / mean };
}
class IntegrityError extends Error {}
class MeasurementError extends Error {}
const check = (condition, message) => { if (!condition) throw new IntegrityError(message); };
const time = value => { const parsed = Date.parse(value); check(Number.isFinite(parsed) && new Date(parsed).toISOString() === value, 'invalid timestamp'); return parsed; };
const same = (a, b) => canonical(a) === canonical(b);
function validateBatch(batch, evidence) {
  check(verified(batch), 'corrupt seal');
  check(batch.capture && typeof batch.capture.id === 'string' && batch.capture.id.length > 0, 'missing capture identity');
  const start = time(batch.capture.startedAt), end = time(batch.capture.completedAt); check(start < end, 'invalid capture interval');
  check(Array.isArray(batch.launches) && batch.launches.length > 0, 'missing launch provenance');
  const ids = new Set();
  for (const launch of batch.launches) {
    check(verified(launch) && !ids.has(launch.id), 'invalid/repeated launch identity'); ids.add(launch.id);
    check(launch.captureId === batch.capture.id && launch.source === batch.source && launch.side === batch.side && launch.status === 0, 'launch binding mismatch');
    check(time(launch.startedAt) >= start && time(launch.completedAt) <= end && time(launch.startedAt) < time(launch.completedAt), 'launch outside capture interval');
    const request=evidence?.requests?.[launch.workloadSha256];check(typeof request==='string','missing retained logical request');
    const logical=JSON.parse(request);check(digest(logical)===launch.workloadSha256,'logical request hash mismatch');
    check(!Object.hasOwn(logical,'root'),'deployment path leaked into logical workload');
    check(digest({...logical,...(launch.deploymentRoot===null?{}:{root:launch.deploymentRoot})})===launch.requestSha256,'actual/logical request mismatch');
    if(launch.stdinSha256)check(createHash('sha256').update(JSON.stringify({...logical,...(launch.deploymentRoot===null?{}:{root:launch.deploymentRoot})})).digest('hex')===launch.stdinSha256,'stdin bytes disagree with retained request');
  }
  for (const run of batch.runs) {
    const launch = batch.launches.find(row => row.id === run.launchId);
    check(launch && launch.round === run.round && launch.cases.includes(run.case), 'run/launch mismatch');
    check(run.raw && (launch.rawSha256s ?? [launch.rawSha256]).includes(run.raw.sha256), 'raw launch binding mismatch');
    const raw = evidence?.rawFiles?.[run.raw.sha256]; check(typeof raw === 'string', 'missing raw file');
    check(createHash('sha256').update(raw).digest('hex') === run.raw.sha256, 'corrupt raw file');
    const value = JSON.parse(raw);
    if(run.unit==='ns')check(run.timerIncrement===value.timerIncrement,'timer metadata disagrees with raw');
    check(Array.isArray(run.rawPointer) && run.rawPointer.length > 0, 'missing raw sample pointer');
    let actual = run.rawPointer.reduce((part, key) => part?.[key], value);
    if (run.rawReducer === 'max') { check(Array.isArray(actual) && actual.every(Number.isFinite), 'invalid max source'); actual = [Math.max(...actual)]; }
    else if(run.rawReducer==='scalar'){check(Number.isFinite(actual),'invalid scalar source');actual=[actual];}
    else if (run.rawReducer === 'sum-dhat-global-bytes') { check(Array.isArray(actual) && actual.every(row=>Number.isSafeInteger(row.gb) && row.gb>=0), 'invalid DHAT global peak source'); actual = [actual.reduce((sum,row)=>sum+row.gb,0)]; }
    else check(run.rawReducer === undefined || run.rawReducer === null, 'unknown raw reducer');
    check(same(actual, run.samples), 'raw samples disagree');
  }
}
function group(batch, id, definition) {
  const runs = batch.runs.filter(run => run.case === id);
  check(runs.length >= PROTOCOL.minimumRuns && same(runs.map(run => run.round).sort((a,b) => a-b), Array.from({length:runs.length},(_,i)=>i)), 'missing/distinct/consecutive rounds');
  const p95 = [], scalar = definition.sampling === 'process-scalar';
  for (const run of runs) {
    check(run.unit === definition.unit && run.sampling === (scalar ? 'process-scalar' : 'per-operation'), 'mixed unit/sampling');
    check(Array.isArray(run.samples) && (scalar ? run.samples.length === 1 : run.samples.length >= PROTOCOL.minimumSamples) && run.samples.every(n => Number.isFinite(n) && n >= 0), 'missing/invalid/short samples');
    check(run.censored === 0, 'censored samples');
    if (run.unit === 'ns') {
      if (!(run.timerIncrement > 0) || run.samples.filter(n => n === 0).length / run.samples.length > PROTOCOL.maximumZeroFraction
        || quantile(run.samples, .95) < PROTOCOL.minimumTimerTicksAtP95 * run.timerIncrement) throw new MeasurementError('insufficient timer');
    } else check(run.unit === 'bytes', 'unknown unit');
    p95.push(quantile(run.samples, .95));
  }
  return { unit: runs[0].unit, sampling: scalar ? 'process-scalar' : 'per-operation', runs: runs.map(run => scalar ? { round: run.round, count: 1, scalar: run.samples[0] } : { round: run.round, count: run.samples.length, p50: quantile(run.samples, .5), p95: quantile(run.samples, .95), p99: quantile(run.samples, .99) }), ...statistics(p95) };
}
export function validateCalibration(policy, calibrationRaw, evidence, beforeCandidateAt) {
  check(verified(policy), 'corrupt policy seal'); validateBatch(calibrationRaw, evidence);
  const calibration=policy.calibration;
  check(calibration && verified(calibration) && calibration.source===policy.baselineSource && calibration.harness===policy.harness, 'missing accepted-source calibration');
  check(calibration.adoptedBeforeCandidate===true && calibration.rawBaselineSha256===calibrationRaw.sha256 && typeof calibration.rationale==='string' && calibration.rationale.length>0, 'unadopted/unbound floor');
  check(calibrationRaw.side==='baseline' && calibrationRaw.mode==='calibration' && calibrationRaw.source===policy.baselineSource && calibrationRaw.harness===policy.harness
    && digest(calibrationRaw.environment)===policy.environment && calibration.environment===policy.environment, 'calibration identity mismatch');
  check(time(calibration.adoptedAt)>time(calibrationRaw.capture.completedAt) && time(calibration.adoptedAt)<time(beforeCandidateAt), 'floor adoption must follow calibration and precede candidate');
  check(same([...new Set(calibrationRaw.runs.map(r=>r.case))].sort(),Object.keys(policy.cases).sort()), 'calibration case mismatch');
  for(const [id,definition] of Object.entries(policy.cases)) {
    check(Number.isFinite(definition.absoluteFloor) && definition.absoluteFloor>=0, 'unadopted floor');
    const calibrated=group(calibrationRaw,id,definition);
    if(calibrated.sampleCV===null || calibrated.sampleCV>PROTOCOL.maximumBaselineCV) throw new MeasurementError('calibration noisy');
  }
  return true;
}
function pair(baseline, candidate, policy, calibrationRaw, evidence) {
  check(verified(policy), 'corrupt policy seal'); validateBatch(baseline, evidence); validateBatch(candidate, evidence); validateBatch(calibrationRaw, evidence);
  check(baseline.format === PROTOCOL.format && candidate.format === PROTOCOL.format && baseline.harness === candidate.harness && baseline.harness === policy.harness, 'protocol/harness mismatch');
  check(baseline.source === policy.baselineSource && candidate.source === policy.candidateSource, 'source mismatch');
  check(same(baseline.environment, candidate.environment) && digest(baseline.environment) === policy.environment, 'environment mismatch');
  check(baseline.side === 'baseline' && candidate.side === 'candidate' && baseline.batch === candidate.batch && same(baseline.capture, candidate.capture), 'batch sides mismatch');
  check(baseline.policy === policy.sha256 && candidate.policy === policy.sha256, 'capture did not bind adopted policy');
  validateCalibration(policy,calibrationRaw,evidence,new Date(Math.min(...candidate.launches.map(row=>time(row.startedAt)))).toISOString());
  const caseIds = Object.keys(policy.cases).sort();
  for (const batch of [baseline, candidate, calibrationRaw]) check(same([...new Set(batch.runs.map(r => r.case))].sort(), caseIds), 'case mismatch');
  const all = [...baseline.launches, ...candidate.launches].sort((a,b) => time(a.startedAt)-time(b.startedAt));
  check(new Set(all.map(row => row.id)).size === all.length, 'baseline/candidate reused launch');
  for (let i=1;i<all.length;i++) check(time(all[i-1].completedAt) <= time(all[i].startedAt), 'overlapping captures');
  return Object.entries(policy.cases).map(([id, definition]) => {
    const baseRuns = baseline.runs.filter(row=>row.case===id), candidateRuns=candidate.runs.filter(row=>row.case===id);
    check(same(baseRuns.map(r=>r.round).sort(), candidateRuns.map(r=>r.round).sort()), 'unpaired round sets');
    for (const run of baseRuns) {
      const partner=candidateRuns.find(row=>row.round===run.round), b=baseline.launches.find(row=>row.id===run.launchId), c=candidate.launches.find(row=>row.id===partner.launchId);
      check(b.workloadSha256===c.workloadSha256,'paired logical workload mismatch');
      check(run.round%2===0 ? time(b.completedAt)<=time(c.startedAt) : time(c.completedAt)<=time(b.startedAt), 'required AB/BA order mismatch');
    }
    const workloadHashes=[...baseRuns.map(run=>baseline.launches.find(row=>row.id===run.launchId).workloadSha256),...calibrationRaw.runs.filter(run=>run.case===id).map(run=>calibrationRaw.launches.find(row=>row.id===run.launchId).workloadSha256)];
    check(new Set(workloadHashes).size===1,'calibration/round logical workload mismatch');
    const b = group(baseline, id, definition), c = group(candidate, id, definition), floor = definition.absoluteFloor;
    check(Number.isFinite(floor) && floor >= 0 && b.unit === c.unit && b.unit === definition.unit, 'floor/unit mismatch');
    const delta = c.median - b.median, relative = b.median > 0 ? delta / b.median : null;
    const threshold = Math.max(PROTOCOL.relativeFloor, PROTOCOL.baselineCVMultiplier * (b.sampleCV ?? Infinity));
    const noisy = b.sampleCV === null || b.sampleCV > PROTOCOL.maximumBaselineCV || c.sampleCV === null || c.sampleCV > PROTOCOL.maximumBaselineCV;
    return { id, baseline: b, candidate: c, absoluteDelta: delta, relativeDelta: relative, absoluteFloor: floor, relativeThreshold: threshold,
      status: noisy ? 'INCONCLUSIVE' : relative !== null && delta > floor && relative > threshold ? 'NEEDS_CONFIRMATION' : 'PASS' };
  });
}
export function compare({ baseline, candidate, policy, calibrationRaw, evidence, confirmation }) {
  try {
    const cases = pair(baseline, candidate, policy, calibrationRaw, evidence);
    if (confirmation) {
      const ids = new Set([...baseline.launches,...candidate.launches].map(row=>row.id));
      check(confirmation.baseline.batch !== baseline.batch && confirmation.baseline.capture.id !== baseline.capture.id
        && time(confirmation.baseline.capture.startedAt)>time(baseline.capture.completedAt)
        && [...confirmation.baseline.launches,...confirmation.candidate.launches].every(row=>!ids.has(row.id)), 'confirmation is not independent batch');
      const second = pair(confirmation.baseline, confirmation.candidate, policy, calibrationRaw, evidence);
      for(const id of Object.keys(policy.cases)){
        const firstRun=baseline.runs.find(run=>run.case===id),secondRun=confirmation.baseline.runs.find(run=>run.case===id);
        check(baseline.launches.find(row=>row.id===firstRun.launchId).workloadSha256===confirmation.baseline.launches.find(row=>row.id===secondRun.launchId).workloadSha256,'confirmation logical workload mismatch');
      }
      for (const row of cases) if (row.status === 'NEEDS_CONFIRMATION') {
        const repeated = second.find(item => item.id === row.id);
        row.confirmation = repeated;
        row.status = repeated.status === 'NEEDS_CONFIRMATION' ? 'FAIL' : 'INCONCLUSIVE';
      }
    }
    return seal({ format: 'editor-reliability-performance-comparison/1', integrity: 'valid', policy: policy.sha256, baseline: baseline.sha256, candidate: candidate.sha256,
      status: cases.some(c => c.status === 'FAIL') ? 'FAIL' : cases.some(c => c.status === 'INCONCLUSIVE') ? 'INCONCLUSIVE' : cases.some(c => c.status === 'NEEDS_CONFIRMATION') ? 'NEEDS_CONFIRMATION' : 'PASS', cases });
  } catch (error) { return seal({ format: 'editor-reliability-performance-comparison/1', status: 'INCONCLUSIVE', integrity: error instanceof MeasurementError ? 'valid' : 'invalid', reason: error.message }); }
}
