// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRegressionScenarios } from './reproducers.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const child = fileURLToPath(new URL('./sdk-replay-child.mjs', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const MAX_EVIDENCE = 64 * 1024 * 1024;
const CONTEXTS = ['kwdj-prose', 'kwdj-poetry', 'notes-d0', 'notes-d1'];
export const supplementalCases = ['queue-lifecycle', 'cancel-loading', 'scalar-boundary', 'current-facts', 'notes-extensions'];

/** External host watchdog; it can kill a synchronous WASM/JS call. */
export function superviseProcess({ args = [child], task, timeoutMs = 2000, startupMs = 30000 }) {
  return new Promise(resolveResult => {
    const processChild = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let phase = 'startup', ready = null, result = null, failure = null, stdout = Buffer.alloc(0), stderr = Buffer.alloc(0);
    let timer = setTimeout(() => kill('reliability.startup_timeout'), startupMs);
    function kill(code) { failure ??= { code, phase, message: `External host killed child during ${phase}` }; processChild.kill('SIGKILL'); }
    function capture(kind, chunk) {
      const current = kind === 'stdout' ? stdout : stderr;
      if (current.length + chunk.length > 1024 * 1024) { kill('reliability.evidence_limit'); return; }
      if (kind === 'stdout') stdout = Buffer.concat([stdout, chunk]); else stderr = Buffer.concat([stderr, chunk]);
    }
    processChild.stdout.on('data', value => capture('stdout', value));
    processChild.stderr.on('data', value => capture('stderr', value));
    processChild.on('error', error => { failure ??= { code: 'reliability.child_error', phase, message: error.message }; });
    processChild.on('message', message => {
      if (message.kind === 'ready') {
        if (ready) { kill('reliability.duplicate_ready'); return; }
        ready = message; phase = 'case'; clearTimeout(timer);
        timer = setTimeout(() => kill('reliability.input_timeout'), timeoutMs);
        processChild.send(task);
      } else if (message.kind === 'result') result = message.result;
      else if (message.kind === 'failure') failure = { code: 'reliability.invariant', ...message.failure };
      else kill('reliability.protocol');
    });
    processChild.on('close', (returnCode, signal) => {
      clearTimeout(timer);
      if (returnCode !== 0 && !failure) failure = { code: 'reliability.child_exit', phase, message: `Actual child exit ${returnCode}/${signal}` };
      if (!result && !failure) failure = { code: 'reliability.missing_result', phase, message: 'No actual SDK result' };
      resolveResult({ returnCode, signal, ready, result, failure, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'),
        timeoutMs, startupMs, scope: 'Actual child exit and externally enforced host timeout; process exit is not a resource-cleanup oracle.' });
    });
  });
}

export function readScenarios({ path = resolve(root, 'artifacts/reliability/scenarios.jsonl'), perContext = 64,
  regressionDirectory = resolve(root, 'contracts/reliability/v1/regressions') } = {}) {
  assert.ok(Number.isSafeInteger(perContext) && perContext >= 0 && perContext <= 256);
  const raw = readFileSync(path), sealPath = resolve(root, 'artifacts/reliability/scenarios-seal.json'), seal = JSON.parse(readFileSync(sealPath, 'utf8'));
  assert.equal(raw.length, seal.bytes); assert.equal(hash(raw), seal.sha256);
  assert.equal(hash(readFileSync(resolve(root, seal.generator))), seal.generatorSha256);
  const lines = raw.toString('utf8').trimEnd().split('\n'), cases = lines.map(line => ({ line, scenario: JSON.parse(line) }));
  assert.equal(cases.length, seal.scenarios); assert.equal(new Set(cases.map(item => item.scenario.id)).size, cases.length);
  const literal = cases.filter(item => item.scenario.id.startsWith('R38-literal-'));
  const regressions = readRegressionScenarios(regressionDirectory);
  const selected = [...regressions.selected, ...literal];
  for (const context of CONTEXTS) {
    const generated = cases.filter(item => item.scenario.context === context && !item.scenario.id.startsWith('R38-literal-'));
    assert.ok(generated.length >= perContext); selected.push(...generated.slice(0, perContext));
  }
  assert.equal(literal.length, 12);
  return { selected, seal, input: { path, bytes: raw.length, sha256: hash(raw) }, sealPath, regressions };
}

export async function runSdkReplay({ perContext = 64, outputRoot = resolve(root, 'artifacts/reliability'), failFast = true, supplements = true,
  regressionDirectory = resolve(root, 'contracts/reliability/v1/regressions') } = {}) {
  const { selected, seal, input, sealPath, regressions } = readScenarios({ perContext, regressionDirectory });
  const base = selected.find(item => item.scenario.context === 'kwdj-prose').scenario;
  const tasks = selected.map(item => ({ ...item, id: item.scenario.id, context: item.scenario.context,
    kind: item.regression ? 'regression' : item.scenario.id.startsWith('R38-literal-') ? 'literal' : 'generated', task: { kind: 'scenario', scenario: item.scenario } }));
  if (supplements) for (const name of supplementalCases) {
    const task = { kind: 'supplement', name, scenario: base };
    tasks.push({ id: `supplement-${name}`, context: 'supplemental', kind: 'supplemental', scenario: base, line: JSON.stringify(task), task });
  }
  const runId = randomUUID(), runDirectory = resolve(outputRoot, 'sdk/runs', runId); mkdirSync(runDirectory, { recursive: true });
  const sourcePaths = ['scripts/reliability/scenarios.mjs', 'contracts/reliability/v1/README.md', 'contracts/reliability/v1/model-literals.json',
    'scripts/reliability/replay-sdk.mjs', 'scripts/reliability/sdk-replay-child.mjs', 'scripts/reliability/shrink.mjs', 'scripts/reliability/reproducers.mjs',
    'contracts/reliability/v1/shrinker-literals.json', 'contracts/reliability/v1/regressions/README.md', 'tests/reliability-sdk.node.mjs', 'docs/reliability-sdk.md'];
  const sourceHashes = Object.fromEntries(sourcePaths.map(path => [path, hash(readFileSync(resolve(root, path)))]));
  const binaryPath = resolve(root, 'packages/wasm/dist/editor_wasm_bg.wasm'), wasmSha256 = hash(readFileSync(binaryPath));
  const producer = JSON.parse(readFileSync(resolve(root, 'artifacts/sdk-build-identity.json'), 'utf8'));
  const observations = [], failures = []; let evidenceBytes = 0;
  for (const [index, item] of tasks.entries()) {
    const actual = await superviseProcess({ task: item.task });
    if (actual.ready && (actual.ready.wasmSha256 !== wasmSha256 || actual.ready.buildId !== producer.buildId)) actual.failure = { code: 'reliability.artifact_mismatch', phase: 'startup' };
    const record = { scenarioId: item.id, context: item.context, seed: item.scenario.seed,
      originalScenarioSha256: hash(item.line + '\n'), regression: item.regression ?? null, ...actual };
    const data = JSON.stringify(record, null, 2) + '\n'; evidenceBytes += Buffer.byteLength(data);
    if (evidenceBytes > MAX_EVIDENCE) throw new Error('reliability.evidence_limit: never silently drop raw failure evidence');
    const safeId = item.id.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 128);
    const path = resolve(runDirectory, `${String(index).padStart(4, '0')}-${safeId}.json`);
    writeFileSync(path, data, { flag: 'wx' });
    observations.push({ id: item.id, context: item.context, kind: item.kind,
      status: actual.failure ? 'failed' : 'passed', returnCode: actual.returnCode, path, bytes: Buffer.byteLength(data), sha256: hash(data),
      actions: actual.result?.actions ?? 0, checkpoints: actual.result?.checkpoints?.length ?? 0, events: actual.result?.events ?? 0 });
    if (actual.failure) {
      const original = resolve(runDirectory, `${safeId}.original.jsonl`); writeFileSync(original, item.line + '\n', { flag: 'wx' });
      failures.push({ id: item.id, context: item.context, original, ...actual.failure });
      if (failFast) break;
    }
  }
  for (const [path, digest] of Object.entries(sourceHashes)) assert.equal(hash(readFileSync(resolve(root, path))), digest, 'adapter/oracle source changed during replay');
  assert.equal(hash(readFileSync(binaryPath)), wasmSha256, 'actual runtime changed during replay');
  assert.equal(hash(readFileSync(input.path)), input.sha256, 'oracle input changed during replay');
  assert.deepEqual(readRegressionScenarios(regressionDirectory).files, regressions.files, 'regression corpus changed during replay');
  const generatedByContext = Object.fromEntries(CONTEXTS.map(context => [context, observations.filter(x => x.context === context && x.kind === 'generated' && x.status === 'passed').length]));
  const report = { format: 'editor-reliability-sdk-replay/1', status: failures.length ? 'failed' : 'passed', runId,
    producerBuildId: producer.buildId, wasmSha256, producerSourceHashes: producer.sourceHashes, adapterSourceHashes: sourceHashes,
    oracle: { ...input, sealPath, seal }, regressions: { files: regressions.files, scenarios: regressions.selected.length, order: 'before literals and generated exploration' },
    summary: { requested: tasks.length, requestedIndependentScenarios: selected.length, completed: observations.length,
      passed: observations.filter(x => x.status === 'passed').length, failed: failures.length,
      literalCases: observations.filter(x => x.kind === 'literal' && x.status === 'passed').length, generatedByContext,
      regressionCases: observations.filter(x => x.kind === 'regression' && x.status === 'passed').length,
      supplementalCases: observations.filter(x => x.kind === 'supplemental' && x.status === 'passed').length,
      meetsGeneratedSdkFloor: CONTEXTS.every(context => generatedByContext[context] >= 64) }, evidenceBytes, observations, failures,
    qualification: 'Actual packaged V2 controller in fresh externally watched Node processes. Independent full canonical/caret/history checkpoints; observable query purity and same-lane historical IDs. No general JS validator, SDK WorkUsage DTO, raw13 operation dispatch or cross-target opaque-ID equality.' };
  mkdirSync(outputRoot, { recursive: true }); writeFileSync(resolve(runDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  writeFileSync(resolve(outputRoot, 'sdk-report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); assert.ok(args.length === 0 || args.length === 1 && args[0] === '--literal-only');
  const report = await runSdkReplay({ perContext: args[0] === '--literal-only' ? 0 : 64 });
  console.log(JSON.stringify({ format: report.format, status: report.status, summary: report.summary, failures: report.failures }));
  if (report.status !== 'passed') process.exitCode = 1;
}
