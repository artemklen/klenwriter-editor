// SPDX-License-Identifier: MIT OR Apache-2.0
// Ordinary correctness/integrity entrypoint. Importing never starts a check.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNativeReplay, executeNative, replaySourceHashes, runNativeReplay } from './replay-native.mjs';
import { runSdkReplay } from './replay-sdk.mjs';
import { harnessHashes } from './perf-build.mjs';
import { inventory as dependencyInventory } from './dependency-inventory.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixture = 'tests/fixtures/reliability-native/Cargo.toml';
const MAX_COMMAND_EVIDENCE = 64 * 1024 * 1024;
const suites = ['model', 'shrink', 'performance', 'sdk'].map(name => `tests/reliability-${name}.node.mjs`);
const ownInputs = ['scripts/reliability/check.mjs', 'docs/reliability.md', '.node-version', 'package.json', 'package-lock.json',
  'scripts/reliability/dependency-inventory.mjs', 'scripts/dependency-notices.mjs', 'evidence/osr-38/native-tooling.md',
  ...suites, 'tests/fixtures/reliability-native/tests/limits.rs', 'tests/fixtures/reliability-native/tests/public_properties.rs'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function regular(path, maximum = 32 * 1024 * 1024) {
  const stat = lstatSync(path); assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum, `bounded regular file required: ${path}`);
  return readFileSync(path);
}
function pin(path, maximum) { const bytes = regular(path, maximum); return { path: resolve(path), bytes: bytes.length, sha256: hash(bytes) }; }
function read(path) { return JSON.parse(regular(path)); }
function save(path, bytes) { writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 }); assert.deepEqual(readFileSync(path), bytes); return pin(path, MAX_COMMAND_EVIDENCE); }
function local(path) {
  assert.equal(typeof path, 'string'); assert(path.length > 0 && !path.startsWith('/') && !path.split(/[\\/]/).includes('..'), 'source path escapes root');
  return resolve(root, path);
}
function sdkProducer() {
  const producerPath = resolve(root, 'artifacts/sdk-build-identity.json'), sealPath = resolve(root, 'artifacts/sdk-wasm-seal.json');
  const producer = read(producerPath), seal = read(sealPath);
  assert.equal(producer.format, 'klenwriter-editor-sdk-build/1'); assert.equal(seal.format, 'klenwriter-editor-sdk-wasm/1'); assert.equal(seal.build_id, producer.buildId);
  const wasm = pin(resolve(root, 'packages/wasm/dist/editor_wasm_bg.wasm'));
  assert.equal(wasm.sha256, seal.sealed_sha256); assert.equal(wasm.bytes, seal.sealed_bytes);
  assert(producer.sourceHashes && Object.keys(producer.sourceHashes).length > 0);
  for (const [path, digest] of Object.entries(producer.sourceHashes)) assert.equal(hash(regular(local(path))), digest, `npm run build prerequisite is stale: ${path}`);
  return { producer, pins: { producer: pin(producerPath), seal: pin(sealPath), wasm,
    sdkEntry: pin(resolve(root, 'packages/sdk/dist/index.js')), controller: pin(resolve(root, 'packages/sdk/dist/controller.js')) } };
}
function sourceSnapshot() {
  const sdk = sdkProducer();
  const paths = new Set([...Object.keys(replaySourceHashes()), ...Object.keys(harnessHashes(root)), ...Object.keys(sdk.producer.sourceHashes), ...ownInputs]);
  return { files: Object.fromEntries([...paths].sort().map(path => [path, hash(regular(local(path)))])), sdk: sdk.pins, buildId: sdk.producer.buildId };
}
function nodeSummary(stdout) {
  const result = {};
  for (const match of stdout.toString('utf8').matchAll(/^# (tests|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$/gm)) result[match[1]] = Number(match[2]);
  assert(Number.isSafeInteger(result.tests) && result.tests > 0, 'missing actual Node summary');
  assert.equal(result.pass, result.tests); for (const key of ['fail', 'cancelled', 'skipped', 'todo']) assert.equal(result[key], 0, `unexecuted/failed Node cases: ${key}`);
  return result;
}

export async function checkReliability({ outputRoot = resolve(root, 'artifacts/reliability') } = {}) {
  const runId = randomUUID(), directory = resolve(outputRoot, 'check/runs', runId); mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stages = [], startedAt = new Date().toISOString(); let commandBytes = 0, sourceBefore = null, sourceAfter = null, failure = null;
  let built = null, native = null, sdk = null, inventory = null;
  const plannedStages = ['source-preflight', 'regenerate-frozen-packet', ...suites.map(path => `node:${path}`), 'native-locked-build',
    'fixture-fmt', 'fixture-clippy-compile-only', 'fixture-lib-tests', 'fixture-limits-tests',
    'named-public-prefix-proptest', 'named-notes-recipe-oracle', 'native-full-replay', 'sdk-full-replay', 'metadata-inventory', 'source-readback'];
  async function stage(name, action) {
    const row = { name, startedAt: new Date().toISOString(), status: 'running' }; stages.push(row);
    try { row.evidence = await action(); row.status = 'passed'; row.completedAt = new Date().toISOString(); }
    catch (error) { row.status = 'failed'; row.completedAt = new Date().toISOString(); row.error = { name: error.name, message: error.message, stack: error.stack }; throw error; }
    return row.evidence;
  }
  async function command(name, binary, args, { timeoutMs = 20 * 60 * 1000, summary = false } = {}) {
    return stage(name, async () => {
      const index = stages.length - 1;
      // Fail before starting another child if its maximum raw streams cannot fit.
      assert(commandBytes + 32 * 1024 * 1024 <= MAX_COMMAND_EVIDENCE, 'checker command evidence reserve exhausted');
      const actual = await executeNative({ binary, args, timeoutMs, maxStreamBytes: 16 * 1024 * 1024 });
      commandBytes += actual.stdout.length + actual.stderr.length;
      const stdout = save(resolve(directory, `${index}.stdout`), actual.stdout), stderr = save(resolve(directory, `${index}.stderr`), actual.stderr);
      const { stdout: _out, stderr: _err, ...execution } = actual;
      const receipt = { ...execution, stdout, stderr };
      const receiptPin = save(resolve(directory, `${index}.execution.json`), json(receipt));
      // Preserve actual failed exit/raw pointers on the failed stage too.
      stages.at(-1).evidence = { execution: receipt, receipt: receiptPin };
      assert.equal(actual.returnCode, 0, `actual command failed: ${receiptPin.path}`); assert.equal(actual.signal, null); assert.equal(actual.failure, null);
      return { execution: receipt, receipt: receiptPin, ...(summary ? { actualNodeSummary: nodeSummary(actual.stdout) } : {}) };
    });
  }
  const cargo = (...args) => ['+1.97.1', ...args, '--manifest-path', fixture];
  const exactTest = name => ['+1.97.1', 'test', '--locked', '--offline', '--manifest-path', fixture, '--test', 'public_properties', name, '--', '--exact', '--nocapture'];
  try {
    await stage('source-preflight', async () => {
      assert.equal(process.versions.node, regular(resolve(root, '.node-version')).toString('utf8').trim(), 'use the pinned Node from .node-version');
      sourceBefore = sourceSnapshot();
      return { source: save(resolve(directory, 'source-before.json'), json(sourceBefore)), prerequisite: 'npm run build completed before this entrypoint; current producer/seal/source pairing checked' };
    });
    await command('regenerate-frozen-packet', process.execPath, ['scripts/reliability/scenarios.mjs'], { timeoutMs: 30000 });
    for (const path of suites) await command(`node:${path}`, process.execPath, ['--test', '--test-reporter=tap', path], { timeoutMs: 120000, summary: true });
    await stage('native-locked-build', async () => {
      built = await buildNativeReplay({ outputRoot: resolve(directory, 'replay') });
      return { call: 'buildNativeReplay', completion: 'returned', buildReceipt: built.receipt, binary: built.value.binary,
        qualification: 'Actual child exits live in the build receipt; no process exit invented for this JS function call.' };
    });
    await command('fixture-fmt', 'cargo', [...cargo('fmt'), '--all', '--', '--check']);
    await command('fixture-clippy-compile-only', 'cargo', [...cargo('clippy', '--locked', '--offline', '--all-targets', '--all-features'), '--', '-D', 'warnings']);
    await command('fixture-lib-tests', 'cargo', cargo('test', '--locked', '--offline', '--lib'));
    await command('fixture-limits-tests', 'cargo', cargo('test', '--locked', '--offline', '--test', 'limits'));
    await command('named-public-prefix-proptest', 'cargo', exactTest('actual_public_session_frozen_prefixes_shrink'));
    await command('named-notes-recipe-oracle', 'cargo', exactTest('actual_notes_recipe_d1_and_d0_refusal_use_frozen_public_oracle'));
    await stage('native-full-replay', async () => {
      native = await runNativeReplay({ binary: built.binary, buildReceipt: built.buildReceipt, perContext: 256, operations: true, outputRoot: resolve(directory, 'replay') });
      const report = pin(resolve(directory, 'replay/native-report.json'));
      stages.at(-1).evidence = { report, actualSummary: native.summary };
      assert.equal(native.status, 'passed'); assert.equal(native.summary.meetsGeneratedNativeFloor, true);
      return { report, actualSummary: native.summary, completion: 'returned', call: 'runNativeReplay' };
    });
    await stage('sdk-full-replay', async () => {
      sdk = await runSdkReplay({ perContext: 64, outputRoot: resolve(directory, 'replay') });
      const report = pin(resolve(directory, 'replay/sdk-report.json'));
      stages.at(-1).evidence = { report, actualSummary: sdk.summary };
      assert.equal(sdk.status, 'passed'); assert.equal(sdk.summary.meetsGeneratedSdkFloor, true);
      return { report, actualSummary: sdk.summary, completion: 'returned', call: 'runSdkReplay' };
    });
    await stage('metadata-inventory', async () => {
      inventory = dependencyInventory({ root, output: resolve(directory, 'dependency-inventory.json') });
      const observed = read(inventory.report.path);
      stages.at(-1).evidence = { ...inventory, commands: observed.commands };
      assert.equal(observed.status, 'passed'); assert.equal(observed.sourceBeforeAfterEqual, true);
      return { call: 'inventory', completion: 'returned', ...inventory, commands: observed.commands,
        qualification: 'Actual metadata command statuses/raw pointers are retained in the helper report; this JS call has no manufactured process exit.' };
    });
    await stage('source-readback', async () => {
      sourceAfter = sourceSnapshot(); assert.deepEqual(sourceAfter, sourceBefore, 'checker source/artifact closure changed');
      return { source: save(resolve(directory, 'source-after.json'), json(sourceAfter)), unchanged: true };
    });
  } catch (error) {
    failure = { stage: stages.find(row => row.status === 'failed')?.name ?? 'metadata-inventory', name: error.name, message: error.message, stack: error.stack };
    // The terminal snapshot records changed source too; never hide a mismatch.
    try { sourceAfter = sourceSnapshot(); save(resolve(directory, 'source-after-failure.json'), json(sourceAfter)); }
    catch (readback) { failure.readbackError = readback.message; }
  }
  const receipt = { format: 'editor-reliability-ordinary-check/1', runId, startedAt, completedAt: new Date().toISOString(),
    status: failure ? 'failed' : 'passed', stages, notRun: plannedStages.filter(name => !stages.some(stage => stage.name === name)), failure,
    sourceBefore, sourceAfter, sourceUnchanged: sourceBefore !== null && sourceAfter !== null && JSON.stringify(sourceBefore) === JSON.stringify(sourceAfter),
    summary: { actualNodeSuites: stages.filter(row => row.evidence?.actualNodeSummary).map(row => ({ stage: row.name, ...row.evidence.actualNodeSummary })),
      native: native?.summary ?? null, sdk: sdk?.summary ?? null,
      dependencyInventory: inventory ? { summary: inventory.summary, productionBrowserPackages: inventory.productionBrowserPackages, report: inventory.report } : null }, commandRawBytes: commandBytes,
    qualification: 'Ordinary correctness/integrity only. No real performance comparison, coverage-guided fuzz, stopped exploratory block, final CI/review or full-AC completion claim. Public-properties execution is restricted to the two explicitly named ordinary tests.' };
  const receiptPin = save(resolve(directory, 'check-receipt.json'), json(receipt));
  mkdirSync(outputRoot, { recursive: true }); writeFileSync(resolve(outputRoot, 'check-report.json'), json({ ...receipt, immutableReceipt: receiptPin }));
  return { ...receipt, immutableReceipt: receiptPin };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv.length <= 3, 'optional JSON config path only');
  const config = process.argv[2] ? read(resolve(process.argv[2])) : {};
  const actual = await checkReliability(config);
  console.log(JSON.stringify({ status: actual.status, receipt: actual.immutableReceipt, summary: actual.summary, failedStage: actual.failure?.stage ?? null, notRun: actual.notRun }));
  if (actual.status !== 'passed') process.exitCode = 1;
}
