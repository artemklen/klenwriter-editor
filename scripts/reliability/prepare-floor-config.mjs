// SPDX-License-Identifier: MIT OR Apache-2.0
// Draft preparation only. Importing performs no reads, writes, adoption or capture.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const METHOD_SHA256 = '4347a527339d3ebc2e1c12e315891c88f16dd784257bbef77a3a12db27b1e874';
const REFERENCE = '9a3747c0738fded8254eb958f7e256369cd382d3';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function read(path) {
  const stat = lstatSync(path);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 128 * 1024 * 1024, `bounded regular input: ${path}`);
  return readFileSync(path);
}
function pin(path) { const bytes = read(path); return { path: resolve(path), bytes: bytes.length, sha256: hash(bytes) }; }
function write(path, value) { writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
export async function prepareFloorConfig({ root, calibration, candidateSource, proposalOutput, configOutput, policyOutput }) {
  assert(typeof root === 'string' && typeof calibration === 'string'); root = resolve(root); calibration = resolve(calibration);
  assert(/^[a-f0-9]{40}$/.test(candidateSource) && candidateSource.startsWith('9130cf9'), 'explicit full9130cf9 candidate source required; no candidate measurement input');
  const outputs = [proposalOutput, configOutput, policyOutput].map(path => { assert(typeof path === 'string' && path.length); return resolve(path); });
  [proposalOutput, configOutput, policyOutput] = outputs;
  assert.equal(new Set(outputs).size, 3); for (const path of outputs) assert(!existsSync(path), `exclusive new output required: ${path}`);
  assert(!outputs.includes(calibration));
  const modulePaths = ['perf-capture.mjs', 'perf-compare.mjs', 'perf-evidence.mjs', 'perf-protocol.mjs', 'perf-corpus.mjs'];
  const modulePins = Object.fromEntries(modulePaths.map(name => [name, pin(resolve(root, 'scripts/reliability', name))]));
  const method = pin(resolve(root, 'evidence/osr-38/floor-adoption-method.md'));
  assert.equal(method.sha256, METHOD_SHA256, 'frozen method differs; primary must inspect new method explicitly');
  const { calibrationProposal, defaultPlan } = await import(pathToFileURL(modulePins['perf-capture.mjs'].path));
  const { seal, verified, canonical, digest, quantile, validateCalibration } = await import(pathToFileURL(modulePins['perf-compare.mjs'].path));
  const { loadEvidence } = await import(pathToFileURL(modulePins['perf-evidence.mjs'].path));
  const { SHAPES } = await import(pathToFileURL(modulePins['perf-corpus.mjs'].path));
  const before = pin(calibration), baseline = JSON.parse(read(calibration));
  const quality = { passed: false, errors: [], cases: {} }; let proposal = null; const floors = {};
  try {
    assert(verified(baseline)); assert.equal(baseline.source, REFERENCE);
    assert.equal(baseline.side, 'baseline'); assert.equal(baseline.mode, 'calibration');
    assert.equal(baseline.acceptanceScope, 'full-required-plan');
    assert(Date.parse(baseline.capture.completedAt) < Date.now(), 'calibration must have actually completed');
    assert(verified(baseline.bindings.producer)); assert.equal(baseline.bindings.producer.sourceCommit, REFERENCE);
    assert.equal(baseline.bindings.producer.harness, baseline.harness);
    assert.equal(digest(baseline.bindings.producer.harnessHashes), baseline.harness);
    for (const [name, original] of Object.entries(modulePins)) assert.equal(baseline.bindings.producer.harnessHashes[`scripts/reliability/${name}`], original.sha256, `module differs from captured harness: ${name}`);
    for (const original of [baseline.bindings.producer.benchmark, baseline.bindings.producer.allocator, ...Object.values(baseline.bindings.artifacts)]) {
      const actual = pin(original.path); assert.equal(actual.bytes, original.bytes); assert.equal(actual.sha256, original.sha256, 'accepted-source artifact changed');
    }
    const planFile = pin(baseline.plan.path); assert.equal(planFile.sha256, baseline.plan.sha256); assert.equal(planFile.bytes, baseline.plan.bytes);
    // Shape skeleton contains no candidate timings or corpus allocation/copy.
    const rows = ['kwdj', 'notes'].flatMap(profile => [...SHAPES, 'small'].map(shape => ({
      id: `${profile}/${shape}`, profile, shape, supported: !(profile === 'notes' && ['lists', 'table'].includes(shape)),
    })));
    const expectedPlan = defaultPlan(rows), plan = JSON.parse(read(planFile.path));
    assert.equal(canonical(plan), canonical(expectedPlan), 'complete frozen plan required; no subset selection');
    const expectedCases = plan.flatMap(item => (item.layer === 'allocator'
      ? ['allocated', 'live', 'whole-process-peak'] : ['wasm-bridge', 'sdk'].includes(item.layer)
        ? ['latency', 'wasm-capacity', 'sampled-process-rss', 'cold-startup'] : ['latency']).map(suffix => `${item.id}/${suffix}`)).sort();
    assert.deepEqual([...new Set(baseline.runs.map(run => run.case))].sort(), expectedCases);
    proposal = calibrationProposal(calibration);
    assert.equal(proposal.rawBaselineSha256, baseline.sha256);
    for (const [id, row] of Object.entries(proposal.cases)) {
      const runs = baseline.runs.filter(run => run.case === id).sort((a, b) => a.round - b.round);
      const detail = quality.cases[id] = { stable: row.stable, observed: row.observed, unit: row.unit, sampling: row.sampling,
        source: baseline.source, harness: baseline.harness, rawBaselineSHA256: baseline.sha256, errors: [],
        runs: runs.map(run => ({ round: run.round, launchId: run.launchId, count: run.samples.length,
          p95: quantile(run.samples, .95), timerIncrement: run.timerIncrement ?? null, censored: run.censored,
          raw: run.raw, rawPointer: run.rawPointer, rawReducer: run.rawReducer ?? null,
          workloadSHA256: baseline.launches.find(launch => launch.id === run.launchId)?.workloadSha256,
          originalRequest: baseline.launches.find(launch => launch.id === run.launchId)?.logicalRequest })) };
      try {
        assert.equal(runs.length, 5, 'same complete five runs required; never choose runs');
        assert.deepEqual(runs.map(run => run.round), [0, 1, 2, 3, 4]);
        const workloads = detail.runs.map(run => run.workloadSHA256);
        assert(workloads.every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)), 'every calibration launch needs its bound workload hash');
        assert.equal(new Set(workloads).size, 1, 'all five calibration launches must use the same frozen workload');
        assert(['ns', 'bytes'].includes(row.unit), 'unknown unit requires explicit primary decision');
        assert(['per-operation', 'process-scalar'].includes(row.sampling), 'unknown sampling');
        assert(row.stable && row.observed.median > 0 && Number.isFinite(row.observed.sampleCV) && row.observed.sampleCV <= .1, 'zero-baseline/undefined-CV/noisy case');
        for (const run of runs) {
          assert.equal(run.unit, row.unit); assert.equal(run.sampling, row.sampling); assert.equal(run.censored, 0);
          assert(row.sampling === 'process-scalar' ? run.samples.length === 1 : run.samples.length >= 200);
          assert(run.samples.every(value => Number.isFinite(value) && value >= 0));
        }
        const B = row.observed.median, q = row.unit === 'ns' ? Math.max(...runs.map(run => run.timerIncrement)) : null;
        let floor, formula, basis;
        if (/\/export\/latency$/.test(id)) { assert.equal(row.unit, 'ns'); floor = 200000; formula = 'unchanged OSR-61 export'; basis = 'legacy-export'; }
        else if (/\/cold-startup$/.test(id)) { assert.equal(row.unit, 'ns'); floor = 5000000; formula = 'unchanged OSR-61 cold startup'; basis = 'legacy-cold-startup'; }
        else if (/\/sampled-process-rss$/.test(id)) { assert.equal(row.unit, 'bytes'); floor = 33554432; formula = 'unchanged OSR-61 RSS'; basis = 'legacy-rss'; }
        else if (row.unit === 'ns') { assert(Number.isFinite(q) && q > 0); floor = Math.ceil(Math.max(10 * q, .01 * B)); formula = 'ceil(max(10*q,0.01*B))'; basis = 'same-five-run median-p95 and maximum observed tick'; }
        else {
          assert(/\/(allocated|live|whole-process-peak|wasm-capacity)$/.test(id), 'unknown byte dimension requires explicit primary decision');
          assert(runs.every(run => run.samples.every(Number.isSafeInteger)), 'exact integer byte counter required');
          floor = 0; formula = '0 exact integer bytes'; basis = 'counted bytes, relative/confirmation guards retained';
        }
        assert(Number.isSafeInteger(floor) && floor >= 0);
        if (row.absoluteFloor !== null) assert.equal(floor, row.absoluteFloor, 'legacy3 unchanged');
        detail.calculation = { B, q, formula, basis, proposedAbsoluteFloor: floor };
        floors[id] = { absoluteFloor: floor, rationale: `${basis}; B=${B}; q=${q}; ${formula}=${floor}; reference=${REFERENCE}; rawBaseline=${baseline.sha256}; method=${method.sha256}`, basis: detail };
      } catch (error) { detail.errors.push(error.message); quality.errors.push({ case: id, message: error.message }); }
    }
    assert.equal(quality.errors.length, 0, 'one bad case prevents the whole config');
    const cases = Object.fromEntries(Object.entries(proposal.cases).map(([id, row]) => [id, { unit: row.unit, sampling: row.sampling, ...floors[id] }]));
    // Shared validator dry-run only: ephemeral prospective timestamps are not
    // published adoption/candidate events. No adoptFloors/capture call occurs.
    const now = Date.now(), prospective = seal({ source: baseline.source, harness: baseline.harness, environment: proposal.environment,
      rawBaselineSha256: baseline.sha256, adoptedBeforeCandidate: true, adoptedAt: new Date(now).toISOString(), rationale: 'Validation-only prospective policy, not actual adoption' });
    const policy = seal({ baselineSource: baseline.source, candidateSource, harness: baseline.harness, environment: proposal.environment, calibration: prospective, cases });
    validateCalibration(policy, baseline, loadEvidence([baseline]), new Date(now + 1).toISOString());
    quality.sharedValidator = 'validateCalibration passed on an in-memory prospective policy only; no adoption/candidate event occurred';
    quality.passed = true;
  } catch (error) { quality.errors.push({ scope: 'whole-calibration', message: error.message }); }
  assert.deepEqual(pin(calibration), before, 'original calibration changed');
  assert.deepEqual(pin(method.path), method, 'method changed');
  for (const [name, original] of Object.entries(modulePins)) assert.deepEqual(pin(original.path), original, `method module changed: ${name}`);
  const result = { format: 'osr38-floor-config-draft-preparation/1', status: quality.passed ? 'eligible-draft-only' : 'no-adoption-no-config',
    calibration: before, baselineSource: REFERENCE, candidateSource, method, modulePins, baselineBindings: baseline.bindings, proposal, quality,
    configOutput: quality.passed ? configOutput : null,
    qualification: 'Full baseline-only proposal. No candidate measurements read, no policy adopted, no capture invoked; primary must inspect and explicitly run adoptFloors later.' };
  write(proposalOutput, result);
  if (quality.passed) write(configOutput, { calibration, candidateSource, output: policyOutput, floors,
    rationale: `DRAFT ONLY: primary must replace this rationale after inspecting all numeric values and before explicitly invoking adoptFloors; full accepted64 baseline; frozen method${method.sha256}; full proposal${proposalOutput}`,
    draft: true, proposal: pin(proposalOutput), method });
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 3, 'one preparation-input JSON path required');
  const result = await prepareFloorConfig(JSON.parse(read(resolve(process.argv[2]))));
  console.log(JSON.stringify(result, null, 2));
  if (!result.quality.passed) process.exitCode = 1;
}
