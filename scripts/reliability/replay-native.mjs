// SPDX-License-Identifier: MIT OR Apache-2.0
// Ordinary deterministic public native replay. Imports never build or execute.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { readScenarios } from './replay-sdk.mjs';
import { readRegressionScenarios } from './reproducers.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixture = 'tests/fixtures/reliability-native';
const contexts = ['kwdj-prose', 'kwdj-poetry', 'notes-d0', 'notes-d1'];
const MAX_EVIDENCE = 64 * 1024 * 1024;
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function regular(path, maximum = 32 * 1024 * 1024) {
  const stat = lstatSync(path); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum, `bounded regular file: ${path}`);
  return readFileSync(path);
}
function pin(path, maximum) { const bytes = regular(path, maximum); return { path: resolve(path), bytes: bytes.length, sha256: hash(bytes) }; }
function binaryPin(path) { return { ...pin(path, 512 * 1024 * 1024), mode: lstatSync(path).mode & 0o777 }; }
function walk(path) {
  return readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en')).flatMap(entry => {
    assert.equal(entry.isSymbolicLink(), false, `symlink source: ${entry.name}`);
    const current = resolve(path, entry.name); return entry.isDirectory() ? walk(current) : entry.isFile() ? [current] : [];
  });
}

/** Conservative compiled-input closure; unrelated native measurement bins are excluded. */
export function replaySourceHashes() {
  const paths = ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', `${fixture}/Cargo.toml`, `${fixture}/Cargo.lock`,
    ...['lib.rs', 'model.rs', 'properties.rs', 'bin/replay.rs'].map(name => `${fixture}/src/${name}`),
    `${fixture}/fixtures/operation-literals.json`, 'examples/notes-extension/d0.json', 'examples/notes-extension/d1.json',
    'contracts/notes/v1/extension-command/initial.canonical.json', 'contracts/notes/v1/extension-command/after.canonical.json',
    'scripts/reliability/replay-native.mjs', 'scripts/reliability/replay-sdk.mjs', 'scripts/reliability/reproducers.mjs',
    'scripts/reliability/shrink.mjs', 'scripts/reliability/scenarios.mjs', 'docs/reliability-native.md',
    'contracts/reliability/v1/README.md', 'contracts/reliability/v1/model-literals.json',
    'contracts/reliability/v1/shrinker-literals.json', 'contracts/reliability/v1/regressions/README.md'];
  for (const name of readdirSync(resolve(root, 'crates')).sort()) {
    const base = resolve(root, 'crates', name);
    if (!lstatSync(base).isDirectory()) continue;
    paths.push(`crates/${name}/Cargo.toml`);
    paths.push(...walk(resolve(base, 'src')).filter(path => /\.(rs|json)$/.test(path)).map(path => relative(root, path)));
  }
  return Object.fromEntries([...new Set(paths)].sort().map(path => [path, hash(regular(resolve(root, path)))]));
}

/** The wall deadline starts before spawn; there is no excluded readiness phase. */
export function executeNative({ binary, args = [], input = Buffer.alloc(0), timeoutMs = 2000, maxStreamBytes = 1024 * 1024 }) {
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 20 * 60 * 1000);
  assert.ok(Number.isSafeInteger(maxStreamBytes) && maxStreamBytes > 0 && maxStreamBytes <= 32 * 1024 * 1024);
  const startedAt = new Date().toISOString(), started = performance.now();
  return new Promise(resolveResult => {
    let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), failure = null;
    const child = spawn(binary, args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    const kill = code => { failure ??= { code, phase: 'process', class: code, message: 'External native host stopped the child' }; child.kill('SIGKILL'); };
    const timer = setTimeout(() => kill('reliability.native_timeout'), Math.max(0, timeoutMs - (performance.now() - started)));
    function capture(name, chunk) {
      const prior = name === 'stdout' ? stdout : stderr;
      if (prior.length + chunk.length > maxStreamBytes) { kill('reliability.evidence_limit'); return; }
      if (name === 'stdout') stdout = Buffer.concat([stdout, chunk]); else stderr = Buffer.concat([stderr, chunk]);
    }
    child.stdout.on('data', bytes => capture('stdout', bytes)); child.stderr.on('data', bytes => capture('stderr', bytes));
    child.on('error', error => { failure ??= { code: 'reliability.native_spawn', phase: 'process', class: 'spawn', message: error.message }; });
    // A failed/panicking parser can close stdin before the parent finishes writing.
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') failure ??= { code: 'reliability.native_stdin', phase: 'process', class: 'stdin', message: error.message }; });
    child.stdin.end(input);
    child.on('close', (returnCode, signal) => {
      clearTimeout(timer);
      if ((returnCode !== 0 || signal) && !failure) failure = { code: 'reliability.native_exit', phase: 'process', class: 'exit', message: `Actual native exit ${returnCode}/${signal}` };
      resolveResult({ argv: [binary, ...args], startedAt, completedAt: new Date().toISOString(), elapsedMs: performance.now() - started,
        returnCode, signal, timeoutMs, maxStreamBytes, stdout, stderr, failure });
    });
  });
}

function save(path, bytes) { writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 }); assert.deepEqual(readFileSync(path), bytes); return pin(path, MAX_EVIDENCE); }
function rawExecution(directory, name, actual) {
  const stdout = save(resolve(directory, name + '.stdout'), actual.stdout), stderr = save(resolve(directory, name + '.stderr'), actual.stderr);
  const { stdout: _out, stderr: _err, ...execution } = actual;
  return { ...execution, stdout, stderr };
}

export async function buildNativeReplay({ outputRoot = resolve(root, 'artifacts/reliability'), targetDirectory = resolve(root, fixture, 'target') } = {}) {
  const runId = randomUUID(), directory = resolve(outputRoot, 'native/builds', runId); mkdirSync(directory, { recursive: true, mode: 0o700 });
  const before = replaySourceHashes(), lockBefore = pin(resolve(root, fixture, 'Cargo.lock')), commands = [];
  const steps = [
    { binary: 'rustc', args: ['+1.97.1', '-vV'], timeoutMs: 30000 },
    { binary: 'cargo', args: ['+1.97.1', 'fetch', '--locked', '--manifest-path', `${fixture}/Cargo.toml`], timeoutMs: 10 * 60 * 1000 },
    { binary: 'cargo', args: ['+1.97.1', 'build', '--locked', '--offline', '--manifest-path', `${fixture}/Cargo.toml`, '--bin', 'replay', '--target-dir', resolve(targetDirectory)], timeoutMs: 20 * 60 * 1000 },
  ];
  for (const [index, step] of steps.entries()) {
    const actual = await executeNative({ ...step, maxStreamBytes: 16 * 1024 * 1024 });
    commands.push(rawExecution(directory, `command-${index}`, actual));
    if (actual.failure) break;
  }
  const after = replaySourceHashes(), lockAfter = pin(lockBefore.path), success = commands.length === 3 && commands.every(command => command.returnCode === 0 && !command.failure);
  const filename = process.platform === 'win32' ? 'replay.exe' : 'replay';
  const producedPath = resolve(targetDirectory, 'debug', filename), binaryPath = resolve(directory, filename);
  let producedBinary = null, binary = null;
  if (success) {
    producedBinary = binaryPin(producedPath);
    // Cargo's shared target may be rebuilt by later test/all-feature commands.
    // Retain the exact just-built bytes under this unique build's ownership.
    writeFileSync(binaryPath, regular(producedPath, 512 * 1024 * 1024), { flag: 'wx', mode: 0o500 });
    binary = binaryPin(binaryPath);
    assert.equal(binary.bytes, producedBinary.bytes); assert.equal(binary.sha256, producedBinary.sha256);
    assert.equal(binary.mode, 0o500, 'snapshot must be owner-readable/executable without write bits');
    assert.deepEqual(binaryPin(producedPath), producedBinary, 'produced target changed during snapshot creation');
  }
  const value = { format: 'editor-reliability-native-replay-build/2', runId, status: success ? 'passed' : 'failed', sourceRoot: root,
    sourceBefore: before, sourceAfter: after, sourceUnchanged: JSON.stringify(before) === JSON.stringify(after),
    lockBefore, lockAfter, commands, producedBinary, binary,
    qualification: 'Ordinary debug native replay, pinned Rust1.97.1; explicit locked fetch precedes locked offline build. Exact produced bytes are retained as an exclusive0500 executable snapshot; the original shared Cargo target may later change. Measurement-only bins/support excluded; no release/performance claim.' };
  const receipt = save(resolve(directory, 'build-receipt.json'), json(value));
  assert.equal(success, true, `native build failed: ${receipt.path}`); assert.deepEqual(after, before, 'source changed during native build'); assert.equal(lockAfter.sha256, lockBefore.sha256, 'locked fetch/build changed lock');
  return { binary: binaryPath, buildReceipt: receipt.path, receipt, value };
}

function verifyBuild(binary, receiptPath) {
  const raw = regular(receiptPath), receipt = JSON.parse(raw); assert.equal(receipt.format, 'editor-reliability-native-replay-build/2');
  assert.equal(receipt.status, 'passed'); assert.equal(receipt.sourceUnchanged, true); assert.equal(resolve(receipt.sourceRoot), resolve(root));
  assert.deepEqual(receipt.sourceBefore, receipt.sourceAfter); assert.deepEqual(replaySourceHashes(), receipt.sourceAfter, 'built source differs from current replay closure');
  assert.equal(receipt.commands.length, 3); for (const command of receipt.commands) {
    assert.equal(command.returnCode, 0); assert.equal(command.signal, null); assert.equal(command.failure, null);
    for (const stream of [command.stdout, command.stderr]) assert.deepEqual(pin(stream.path, MAX_EVIDENCE), stream);
  }
  assert.deepEqual(receipt.commands[0].argv, ['rustc', '+1.97.1', '-vV']);
  assert.deepEqual(receipt.commands[1].argv, ['cargo', '+1.97.1', 'fetch', '--locked', '--manifest-path', `${fixture}/Cargo.toml`]);
  assert.deepEqual(receipt.commands[2].argv.slice(0, -1), ['cargo', '+1.97.1', 'build', '--locked', '--offline', '--manifest-path', `${fixture}/Cargo.toml`, '--bin', 'replay', '--target-dir']);
  assert.deepEqual(pin(receipt.lockAfter.path), receipt.lockAfter); assert.equal(receipt.lockBefore.sha256, receipt.lockAfter.sha256);
  const filename = process.platform === 'win32' ? 'replay.exe' : 'replay';
  assert.equal(receipt.producedBinary.path, resolve(receipt.commands[2].argv.at(-1), 'debug', filename), 'origin is not the recorded build target');
  const artifact = binaryPin(binary); assert.deepEqual(artifact, receipt.binary, 'snapshot does not match exact build receipt');
  assert.equal(artifact.path, resolve(dirname(receiptPath), filename), 'snapshot is not owned by this UUID build');
  assert.equal(artifact.mode, 0o500); assert.equal(artifact.bytes, receipt.producedBinary.bytes); assert.equal(artifact.sha256, receipt.producedBinary.sha256);
  assert.notEqual(artifact.path, receipt.producedBinary.path);
  return { receipt: { path: resolve(receiptPath), bytes: raw.length, sha256: hash(raw) }, binary: artifact, sourceHashes: receipt.sourceAfter };
}

/** Decode the actual serde Result; JS never constructs the expected editor outcome. */
export function decodeNativeResult(stdout, scenario = null, operationOracle = null) {
  const lines = Buffer.from(stdout).toString('utf8').split('\n').filter(line => line.trim());
  assert.equal(lines.length, 1, 'one Result line per fresh native child');
  const value = JSON.parse(lines[0]); assert.deepEqual(Object.keys(value).sort(), Object.hasOwn(value, 'Ok') ? ['Ok'] : ['Err']);
  if (Object.hasOwn(value, 'Err')) return { result: value, failure: { code: 'reliability.native_invariant', class: 'harness_failure', ...value.Err } };
  const report = value.Ok;
  if (scenario) {
    assert.equal(report.id, scenario.id); assert.equal(report.context, scenario.context); assert.equal(report.seed, scenario.seed);
    assert.equal(report.actions, scenario.actions.length); assert.equal(report.checkpoints, scenario.actions.length + 1);
    for (const key of ['exact_canonical_selection_history', 'all_query_facets_pure', 'query_execute_work_equal', 'all_original_identity_restoration']) assert.equal(report[key], true, key);
    assert.equal(report.reachability.admitted, 1); assert.equal(report.reachability.closed, 1);
  } else {
    assert.equal(report.format, 'editor-reliability-native-algebra/1'); assert.equal(report.status, 'passed'); assert.equal(report.variant_total, 13);
    assert.equal(report.cases.length, operationOracle.cases.length);
    for (const expected of operationOracle.cases) {
      const matches = report.cases.filter(row => row.id === expected.id); assert.equal(matches.length, 1);
      const actual = matches[0]; assert.equal(actual.variant, expected.operation_variant); assert.equal(actual.status, 'passed');
      for (const key of ['history_query_purity', 'history_query_work_equal', 'exact_documents_maps_and_saved_ids']) assert.equal(actual[key], true);
      assert(actual.late_refusals > 0);
    }
  }
  return { result: value, failure: null };
}

export async function runNativeReplay({ binary, buildReceipt, perContext = 256, operations = true, failFast = true,
  outputRoot = resolve(root, 'artifacts/reliability'), regressionDirectory = resolve(root, 'contracts/reliability/v1/regressions') } = {}) {
  const build = verifyBuild(binary, buildReceipt), before = replaySourceHashes();
  const { selected, seal, input, sealPath, regressions } = readScenarios({ perContext, regressionDirectory });
  const sealPin = pin(sealPath);
  const operationPath = resolve(root, fixture, 'fixtures/operation-literals.json'), operationPin = pin(operationPath), operationOracle = JSON.parse(regular(operationPath));
  const tasks = selected.map(item => ({ id: item.scenario.id, context: item.scenario.context, seed: item.scenario.seed, scenario: item.scenario,
    input: Buffer.from(item.line + '\n'), regression: item.regression ?? null,
    kind: item.regression ? 'regression' : item.scenario.id.startsWith('R38-literal-') ? 'literal' : 'generated', args: [] }));
  if (operations) tasks.push({ id: 'native-operation-literals', context: 'kwdj-prose', kind: 'operation-algebra', input: Buffer.alloc(0), args: ['--operations'] });
  const runId = randomUUID(), directory = resolve(outputRoot, 'native/runs', runId); mkdirSync(directory, { recursive: true, mode: 0o700 });
  const observations = [], failures = [], aggregateReachability = {}; let evidenceBytes = 0;
  for (const [index, task] of tasks.entries()) {
    const prefix = `${String(index).padStart(4, '0')}-${task.id.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 128)}`;
    // Reserve bounded diagnostics/report space before creating another child.
    assert(evidenceBytes + task.input.length + 6 * 1024 * 1024 <= MAX_EVIDENCE, 'native evidence reserve exhausted before next child');
    const inputFile = save(resolve(directory, prefix + (task.scenario ? '.original.jsonl' : '.stdin')), task.input);
    evidenceBytes += task.input.length;
    const actual = await executeNative({ binary, args: task.args, input: task.input });
    let decoded = null;
    try { decoded = decodeNativeResult(actual.stdout, task.scenario ?? null, operationOracle); }
    catch (error) { actual.failure ??= { code: 'reliability.native_result', phase: 'result', class: 'protocol', message: error.message }; }
    if (decoded?.failure) {
      // Only the consumer's ordinary Err+exit1 is the same harness failure.
      // A timeout/signal/other process fault keeps its distinct primary class.
      if (!actual.failure || actual.failure.code === 'reliability.native_exit' && actual.returnCode === 1 && actual.signal === null) {
        actual.failure = { ...decoded.failure, processFailure: actual.failure };
      } else actual.failure = { ...actual.failure, harnessFailure: decoded.failure };
    }
    evidenceBytes += actual.stdout.length + actual.stderr.length;
    assert(evidenceBytes <= MAX_EVIDENCE, 'native evidence bound exceeded; no successful truncation');
    const record = { id: task.id, context: task.context, seed: task.seed ?? null, kind: task.kind, regression: task.regression ?? null,
      originalInput: inputFile, execution: rawExecution(directory, prefix, actual), result: decoded?.result ?? null };
    const recordBytes = json(record); evidenceBytes += recordBytes.length; assert(evidenceBytes <= MAX_EVIDENCE, 'native record evidence bound exceeded');
    const recordPin = save(resolve(directory, prefix + '.json'), recordBytes);
    observations.push({ id: task.id, context: task.context, kind: task.kind, status: actual.failure ? 'failed' : 'passed',
      returnCode: actual.returnCode, signal: actual.signal, record: recordPin, actions: decoded?.result?.Ok?.actions ?? 0 });
    if (actual.failure) { failures.push({ id: task.id, context: task.context, originalInput: inputFile, ...actual.failure }); if (failFast) break; }
    const reachability = decoded?.result?.Ok?.reachability;
    if (reachability && !actual.failure) for (const [key, value] of Object.entries(reachability)) {
      if (Array.isArray(value)) aggregateReachability[key] = value.map((part, i) => (aggregateReachability[key]?.[i] ?? 0) + part);
      else { assert(Number.isSafeInteger(value) && value >= 0); aggregateReachability[key] = (aggregateReachability[key] ?? 0) + value; assert(Number.isSafeInteger(aggregateReachability[key])); }
    }
  }
  assert.deepEqual(replaySourceHashes(), before, 'native replay source changed'); verifyBuild(binary, buildReceipt);
  assert.equal(pin(input.path).sha256, input.sha256); assert.deepEqual(readRegressionScenarios(regressionDirectory).files, regressions.files);
  assert.deepEqual(pin(sealPath), sealPin);
  assert.deepEqual(pin(operationPath), operationPin);
  const passed = kind => observations.filter(row => row.kind === kind && row.status === 'passed').length;
  const generatedByContext = Object.fromEntries(contexts.map(context => [context, observations.filter(row => row.kind === 'generated' && row.context === context && row.status === 'passed').length]));
  const report = { format: 'editor-reliability-native-replay/1', status: failures.length ? 'failed' : 'passed', runId, build,
    sourceHashes: before, oracle: { ...input, sealPath, sealFile: sealPin, seal }, operationOracle: operationPin, regressions: { files: regressions.files, scenarios: regressions.selected.length },
    summary: { requested: tasks.length, requestedBaseScenarios: selected.length - regressions.selected.length, requestedRegressions: regressions.selected.length,
      completed: observations.length, passed: observations.filter(row => row.status === 'passed').length, failed: failures.length,
      literalCases: passed('literal'), regressionCases: passed('regression'), generatedByContext,
      operationsCategory: passed('operation-algebra'), operationVariants: passed('operation-algebra') ? 13 : 0,
      meetsGeneratedNativeFloor: contexts.every(context => generatedByContext[context] >= 256) },
    aggregateReachability, observations, failures, evidenceBytes,
    qualification: 'Ordinary native public API consumer. Fresh child2s wall deadline includes launch.1036base scenarios and saved regressions are separate from13 KWDJ raw-operation literals. No SDK raw13, all-profile grammar, release timing or coverage-guided fuzz claim.' };
  const reportBytes = json(report); assert(evidenceBytes + reportBytes.length <= MAX_EVIDENCE, 'native report evidence bound exceeded');
  save(resolve(directory, 'report.json'), reportBytes);
  mkdirSync(outputRoot, { recursive: true }); writeFileSync(resolve(outputRoot, 'native-report.json'), reportBytes);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === 'build') {
    assert(args.length <= 2); const built = await buildNativeReplay(args[1] ? JSON.parse(regular(resolve(args[1]))) : {});
    console.log(JSON.stringify({ binary: built.binary, buildReceipt: built.buildReceipt, receipt: built.receipt }));
  } else {
    let config;
    if (args[0] === 'replay') { assert.equal(args.length, 2); config = JSON.parse(regular(resolve(args[1]))); }
    else { assert(args.length === 0 || args.length === 1 && args[0] === '--literal-only'); const built = await buildNativeReplay(); config = { binary: built.binary, buildReceipt: built.buildReceipt, perContext: args[0] === '--literal-only' ? 0 : 256 }; }
    const report = await runNativeReplay(config); console.log(JSON.stringify({ status: report.status, summary: report.summary, failures: report.failures }));
    if (report.status !== 'passed') process.exitCode = 1;
  }
}
