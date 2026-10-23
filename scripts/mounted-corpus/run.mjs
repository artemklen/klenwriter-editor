// SPDX-License-Identifier: MIT OR Apache-2.0
// Current build -> all-engine preflight -> immutable binding -> observations -> collector.
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, lstatSync, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { mkdir, readdir, writeFile, lstat, realpath, open } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import os from 'node:os';
import * as browsers from '@playwright/test';
import Ajv2020 from 'ajv/dist/2020.js';
import { PROTOCOL_VERSION, ACCEPTED_SOURCE, ENGINES, BUDGETS, REQUIRED_SCENARIO_PATHS, ownBoundedData } from './protocol.mjs';
import { loadContract, collect } from './collect.mjs';
import { collectInteractions, interactionValidators } from './collect-interactions.mjs';
import { loadMountedResourceProfile67, RESOURCE_PROFILE67_ID, RESOURCE_PROFILE67_PATH, assertResourceProfileBinding67 } from './resource-profile67.mjs';
import { computeSdkBuildIdentity } from '../generate-sdk-types.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
const require = createRequire(import.meta.url);
const sourceSHA = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const sourceStatus = () => execFileSync('git', ['status', '--porcelain=v1'], { cwd: root, encoding: 'utf8' });

// Preserve the awaited reader API while each filesystem operation reads current bytes.
const lstatSource = async (...args) => lstatSync(...args);
const openSource = async (...args) => openSync(...args);
const statSource = async fd => fstatSync(fd);
const readSource = async (...args) => readSync(...args);
const closeSource = async fd => closeSync(fd);

function cleanRelative(path) {
  if (typeof path !== 'string' || path.length > 1024 || !path || path.includes('\\')
    || path.split('/').some(part => !part || part === '.' || part === '..') || path.startsWith('/')) {
    throw new Error('Invalid artifact path');
  }
  return path;
}
async function boundedFile(base, path, maximum) {
  cleanRelative(path);
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > 268435456) throw new Error('Invalid read bound');
  let current = base;
  for (const part of path.split('/')) {
    current = resolve(current, part);
    if ((await lstatSource(current)).isSymbolicLink()) throw new Error(`Artifact symlink: ${path}`);
  }
  const file = await openSource(current, 'r');
  try {
    const before = await statSource(file);
    if (!before.isFile() || before.size > maximum) throw new Error(`Artifact exceeds bound: ${path}`);
    // Read one extra byte: a growing file cannot turn a bounded read into a prefix.
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await readSource(file, bytes, length, bytes.length - length, length);
      if (!result) break;
      length += result;
    }
    const after = await statSource(file);
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error(`Artifact changed while reading: ${path}`);
    return bytes.subarray(0, length);
  } finally { await closeSource(file); }
}
async function pin(path, base = root, maximum = 268435456) {
  const bytes = await boundedFile(base, path, maximum);
  return { path, bytes: bytes.length, sha256: sha(bytes) };
}
async function observationInventory(runRoot) {
  const pins = [], base = resolve(runRoot, 'observations');
  let engines;
  try { engines = await readdir(base, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return pins; throw error; }
  if (engines.length > ENGINES.length) throw new Error('Unexpected observation engine directory');
  for (const entry of engines) {
    if (!entry.isDirectory() || !ENGINES.includes(entry.name)) throw new Error('Foreign observation engine');
    const files = await readdir(resolve(base, entry.name), { withFileTypes: true });
    if (files.length > 128) throw new Error('Observation inventory overflow');
    for (const file of files) {
      if (!file.isFile() || !/^\d{3}\.json$/.test(file.name)) throw new Error('Foreign observation artifact');
      pins.push(await pin(`observations/${entry.name}/${file.name}`, runRoot, BUDGETS.observationBytes));
    }
  }
  return pins.sort((a, b) => a.path.localeCompare(b.path));
}
async function interactionInventory(runRoot) {
  const base = resolve(runRoot, 'interactions'), paths = [];
  const allowed = new Set(['selection-keyboard-replace.json', 'slash-keyboard-accept.json',
    'drag-pointer-move.json', 'drag-keyboard-move.json']);
  let engines;
  try { engines = await readdir(base, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return paths; throw error; }
  if (engines.length > ENGINES.length) throw new Error('Interaction engine inventory overflow');
  for (const entry of engines) {
    if (!entry.isDirectory() || !ENGINES.includes(entry.name)) throw new Error('Foreign interaction engine');
    const files = await readdir(resolve(base, entry.name), { withFileTypes: true });
    if (files.length > allowed.size) throw new Error('Interaction artifact inventory overflow');
    for (const file of files) {
      if (!file.isFile() || !allowed.has(file.name)) throw new Error('Foreign interaction artifact');
      paths.push(`interactions/${entry.name}/${file.name}`);
    }
  }
  return paths.sort();
}
function combineReport(base, interactions) {
  const report = JSON.parse(JSON.stringify(base));
  const groups = { selection: ['selection-keyboard-replace'], slash: ['slash-keyboard-accept'],
    dnd: ['drag-pointer-move', 'drag-keyboard-move'] };
  for (const route of report.crossCuttingRoutes) {
    if (!groups[route.route]) continue;
    const rows = interactions.rows.filter(row => groups[route.route].includes(row.routeId));
    route.disposition = 'executed';
    route.requirement = rows.some(row => row.integrity !== 'PASS') ? 'OBSERVATION'
      : rows.some(row => row.requirement === 'GAP') ? 'GAP' : 'MET';
    route.evidence = rows.flatMap(row => row.artifact ? [row.artifact] : []);
    route.reason = `${rows.length} current genuine route measurements; ${rows.filter(row => row.requirement === 'MET').length} MET, ${rows.filter(row => row.requirement === 'GAP').length} GAP. Individual required/experimental tiers and original checks are in interactions-report.json.`;
  }
  for (const row of interactions.rows) {
    const issue = { code: 'mounted-corpus.interaction', message: `${row.engine}/${row.routeId}: integrity=${row.integrity}, requirement=${row.requirement}, cleanup=${row.cleanup}` };
    if (row.integrity !== 'PASS') {
      report.integrity.status = 'FAIL'; report.integrity.failures.push(issue);
      report.engineSummaries.find(value => value.engine === row.engine).integrity = 'FAIL';
    }
    if (row.blocking) report.blockingReasons.push({ class: row.integrity !== 'PASS' ? 'integrity'
      : row.cleanup !== 'MET' ? 'cleanup_isolation' : 'required_behavior', ...issue });
  }
  return report;
}
async function executable(browserType) {
  const path = await realpath(browserType.executablePath());
  const hash = createHash('sha256'); let length = 0;
  for await (const chunk of createReadStream(path)) {
    length += chunk.length;
    if (length > 1024 * 1024 * 1024) throw new Error('Browser executable exceeds frozen1GiB bound');
    hash.update(chunk);
  }
  return { executablePath: path, executableSha256: hash.digest('hex') };
}
async function writeJson(path, value, maximum = BUDGETS.reportBytes) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  if (bytes.length > maximum) throw new Error('Output exceeds bound');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: 'wx' });
}
async function child(command, args, options, maximumMs) {
  const started = new Date().toISOString();
  const subprocess = spawn(command, args, { ...options, detached: true });
  const kill = signal => { try { process.kill(-subprocess.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; kill('SIGTERM'); }, maximumMs);
  let force;
  const onTerm = () => { force = setTimeout(() => kill('SIGKILL'), 5000); };
  const watchdog = setTimeout(onTerm, maximumMs);
  try {
    return await new Promise((resolve, reject) => {
      subprocess.once('error', reject);
      subprocess.once('exit', (code, signal) => resolve({ started, finished: new Date().toISOString(), code, signal, timedOut }));
    });
  } finally { clearTimeout(timer); clearTimeout(watchdog); clearTimeout(force); }
}
async function preflight(runRoot, build) {
  const log = await open(resolve(runRoot, 'preflight-server.log'), 'wx');
  const server = spawn(process.execPath, ['scripts/workspace-server.mjs'], { cwd: root, stdio: ['ignore', log.fd, log.fd, 'ipc'] });
  let serverFailure;
  server.once('error', error => { serverFailure = error; });
  const exited = new Promise(resolve => server.once('close', (code, signal) => resolve({ code, signal })));
  const engines = [], nativeBaselines = [], receipts = [];
  try {
    // A private child IPC acknowledgement proves this process bound the port;
    // an unrelated existing server's HTTP response cannot satisfy preflight.
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Fixture server startup deadline')), 15000);
      const fail = error => { clearTimeout(timer); reject(error); };
      server.once('error', fail);
      server.once('exit', () => fail(serverFailure ?? new Error('Fixture server exited before ready')));
      server.on('message', message => {
        if (message?.kind === 'workspace-fixture-ready' && message.pid === server.pid) { clearTimeout(timer); resolve(); }
      });
    });
    for (const engine of ENGINES) {
      const binary = await executable(browsers[engine]);
      const browser = await browsers[engine].launch({ executablePath: binary.executablePath });
      try {
        const page = await browser.newPage();
        await page.goto(`http://127.0.0.1:4174/mounted-corpus?engine=${engine}`);
        await page.waitForFunction(() => !!window.mountedCorpus45, null, { timeout: BUDGETS.readyMs });
        const ready = await page.evaluate(() => window.mountedCorpus45.ready);
        if (ready.protocol !== PROTOCOL_VERSION || ready.acceptedSource !== ACCEPTED_SOURCE || ready.engine !== engine
          || ready.module.buildId !== build.buildId || ready.module.manifest.build_id !== build.buildId
          || ready.nativeBaseline.validation !== 'valid') throw new Error(`Invalid preflight: ${engine}`);
        engines.push({ engine, browserVersion: browser.version(), ...binary });
        nativeBaselines.push({ engine, buildId: build.buildId, wasmSha256: build.wasm.sha256, sample: ready.nativeBaseline });
        receipts.push({ engine, ready });
      } finally { await browser.close(); }
    }
    return { engines, nativeBaselines, receipts };
  } finally {
    server.kill('SIGTERM');
    const force = setTimeout(() => server.kill('SIGKILL'), 5000);
    await exited; clearTimeout(force); await log.close();
  }
}

export async function run() {
  if (!process.version.startsWith('v24.')) throw new Error('Use pinned Node24 for mounted acceptance');
  process.chdir(root);
  const runId = `mounted45-${randomUUID()}`;
  const runRoot = resolve(root, 'artifacts/mounted-corpus/runs', runId);
  await mkdir(runRoot, { recursive: true });
  // Isolate browser application data only in this task's child environment.
  const appData = resolve(runRoot, 'browser-appdata'), temporary = resolve(runRoot, 'browser-tmp');
  await mkdir(appData); await mkdir(temporary);
  const browserEnv = { ...process.env, PLAYWRIGHT_SKIP_BROWSER_GC: '1', CFFIXED_USER_HOME: appData, TMPDIR: temporary };
  const receipt = { protocol: PROTOCOL_VERSION, runId, started: new Date().toISOString(), sourceSHA: sourceSHA(), sourceStatusAtStart: sourceStatus(), phase: 'binding' };
  try {
    // Explicit67 continuation: historical contract authority and actual runtime
    // bytes remain separate. No frozen45 literal or expected value is rewritten.
    const resourceProfile = RESOURCE_PROFILE67_ID;
    const continuation = await loadMountedResourceProfile67({ resourceProfile,
      readArtifact: (path, maximum) => boundedFile(root, path, maximum),
    });
    const continuationBefore = await continuation.verifyAll();
    await writeJson(resolve(runRoot, 'source-continuation67-before.json'), continuationBefore);
    const continuationRuntimeBefore = await continuation.captureRuntimeInventory(receipt.sourceSHA);
    await writeJson(resolve(runRoot, 'source-continuation67-runtime-before.json'), continuationRuntimeBefore);
    receipt.sourceContinuation = { scope: 'Explicit strict resource profile67 and whole192 current raw source pins; retained c82 snapshot and legacy45/47/48/66 source authority inherit no runtime acceptance.',
      before: await pin('source-continuation67-before.json', runRoot), after: null,
      runtimeBefore: await pin('source-continuation67-runtime-before.json', runRoot), runtimeAfter: null };
    const sourcePins = json(await boundedFile(root, 'contracts/mounted-e2e/v1/source-pins.json', BUDGETS.observationBytes));
    const manifest = json(await boundedFile(root, 'contracts/mounted-e2e/v1/manifest.json', BUDGETS.observationBytes));
    // Reject source/transport incompatibility before launching a browser owner.
    ownBoundedData(json(await boundedFile(root, 'contracts/mounted-e2e/v1/interaction-literals.json', 65536)), 65536);
    interactionValidators(json(await boundedFile(root, 'contracts/mounted-e2e/v1/observation.schema.json', BUDGETS.observationBytes)), { resourceProfile });
    const nativeManifest = json(await boundedFile(root, 'artifacts/sdk-native-manifest-v2.json', BUDGETS.observationBytes));
    const build = { buildId: nativeManifest.build_id,
      wasm: await pin('packages/wasm/dist/editor_wasm_bg.wasm'),
      seal: await pin('artifacts/sdk-wasm-seal.json'), dependencies: await pin('artifacts/dependencies.json') };
    const seal = json(await boundedFile(root, build.seal.path, BUDGETS.observationBytes));
    if (nativeManifest.abi !== 'editor-sdk/2' || computeSdkBuildIdentity().buildId !== build.buildId
      || seal.format !== 'klenwriter-editor-sdk-wasm/1' || seal.build_id !== build.buildId
      || seal.sealed_bytes !== build.wasm.bytes || seal.sealed_sha256 !== build.wasm.sha256) {
      throw new Error('Current source, compiled manifest and sealed WASM do not agree');
    }
    const extraPaths = ['contracts/mounted-e2e/v1/interaction-literals.json', 'scripts/mounted-corpus/interactions.mjs', 'scripts/mounted-corpus/native-observer.mjs', 'scripts/mounted-corpus/interactions.css', 'scripts/mounted-corpus/collect-interactions.mjs', 'tests/mounted-corpus-interactions.spec.js', 'tests/mounted-corpus-interactions.node.mjs'];
    const continuationSidecarPaths = ['source-continuation67-before.json', 'source-continuation67-runtime-before.json']
      .map(name => relative(root, resolve(runRoot, name)));
    const paths = [...new Set([...sourcePins.files.map(item => item.path), ...REQUIRED_SCENARIO_PATHS, ...extraPaths,
      // Frozen v1 RunBinding permits64 pins. The complete current67 continuation
      // inventory is separately pinned above; retain that schema without widening.
      ...continuationSidecarPaths, RESOURCE_PROFILE67_PATH, 'scripts/mounted-corpus/resource-profile67.mjs',
      'tests/mounted-corpus-resource-profile67.node.mjs'])].sort();
    const scenarioPins = await Promise.all(paths.map(path => pin(path)));
    const previousEnv = { CFFIXED_USER_HOME: process.env.CFFIXED_USER_HOME, TMPDIR: process.env.TMPDIR, PLAYWRIGHT_SKIP_BROWSER_GC: process.env.PLAYWRIGHT_SKIP_BROWSER_GC };
    let pre;
    try {
      Object.assign(process.env, { CFFIXED_USER_HOME: appData, TMPDIR: temporary, PLAYWRIGHT_SKIP_BROWSER_GC: '1' });
      pre = await preflight(runRoot, build);
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
    await writeJson(resolve(runRoot, 'preflight.json'), pre.receipts);
    const binding = { protocol: PROTOCOL_VERSION, runId, sourceSHA: receipt.sourceSHA, acceptedSource: ACCEPTED_SOURCE,
      corpusIndex: await pin(manifest.corpus.indexFile), corpusPackageSha256: manifest.corpus.declaredContentSha256,
      scenarioPins, build, environment: { nodeVersion: process.version, playwrightVersion: require('@playwright/test/package.json').version,
        os: { platform: os.platform(), release: os.release(), arch: os.arch() }, engines: pre.engines }, nativeBaselines: pre.nativeBaselines };
    await writeJson(resolve(runRoot, 'run-binding.json'), binding, BUDGETS.runBindingBytes);
    await assertResourceProfileBinding67({ resourceProfile, runBinding: binding, readArtifact: (path, maximum) => boundedFile(root, path, maximum) });
    receipt.phase = 'browser';
    const browserLog = await open(resolve(runRoot, 'browser.log'), 'wx');
    try {
      receipt.browser = await child(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.mounted-corpus.config.js'],
        { cwd: root, stdio: ['ignore', browserLog.fd, browserLog.fd], env: { ...browserEnv, KLENWRITER_MOUNTED_RUN_ROOT: runRoot } }, 15 * 60 * 1000);
    } finally { await browserLog.close(); }
    receipt.browserLog = await pin('browser.log', runRoot);
    receipt.phase = 'collector';
    const readArtifact = (path, maximum) => boundedFile(path.startsWith('observations/') || path.startsWith('interactions/') ? runRoot : root, path, maximum);
    const contract = await loadContract({ readArtifact: continuation.historicalAuthorityReader(readArtifact), resourceProfile });
    const observations = await observationInventory(runRoot);
    const baseReport = await collect({ contract, runBinding: binding, observations, readArtifact, sourceSHA: sourceSHA(), resourceProfile });
    await writeJson(resolve(runRoot, 'corpus-report.json'), baseReport);
    receipt.interactionPaths = await interactionInventory(runRoot);
    const interactions = await collectInteractions({ runBinding: binding, resourceProfile, readRuntimeArtifact: readArtifact,
      readArtifact: continuation.historicalAuthorityReader(readArtifact) });
    await writeJson(resolve(runRoot, 'interactions-report.json'), interactions);
    const report = combineReport(baseReport, interactions);
    const schema = json(await boundedFile(root, 'contracts/mounted-e2e/v1/report.schema.json', BUDGETS.observationBytes));
    const validate = new Ajv2020({ strict: true }).compile(schema);
    if (!validate(report)) throw new Error(`Combined report violates frozen schema: ${JSON.stringify(validate.errors)}`);
    await writeJson(resolve(runRoot, 'report.json'), report);
    // Recheck all actual bytes after every browser owner has completed.
    for (const expected of [...binding.scenarioPins, ...Object.values(build).filter(value => typeof value === 'object'), binding.corpusIndex]) {
      const actual = await pin(expected.path);
      if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) throw new Error(`Run artifact changed: ${expected.path}`);
    }
    const continuationRuntimeAfter = await continuation.captureRuntimeInventory(sourceSHA());
    if (JSON.stringify(continuationRuntimeAfter) !== JSON.stringify(continuationRuntimeBefore)) throw new Error('Actual continuation runtime source inventory changed during run');
    await writeJson(resolve(runRoot, 'source-continuation67-runtime-after.json'), continuationRuntimeAfter);
    receipt.sourceContinuation.runtimeAfter = await pin('source-continuation67-runtime-after.json', runRoot);
    const continuationAfter = await continuation.verifyAll();
    if (JSON.stringify(continuationAfter) !== JSON.stringify(continuationBefore)) throw new Error('Historical/current source continuation changed during run');
    await writeJson(resolve(runRoot, 'source-continuation67-after.json'), continuationAfter);
    receipt.sourceContinuation.after = await pin('source-continuation67-after.json', runRoot);
    if (receipt.sourceSHA !== sourceSHA()) throw new Error('Source HEAD changed during run');
    receipt.phase = 'completed';
    receipt.integrity = report.integrity.status;
    receipt.blockingReasons = report.blockingReasons;
    receipt.qualifiesAsExactCommittedSource = receipt.sourceStatusAtStart === '' && sourceStatus() === '';
    receipt.success = receipt.browser.code === 0 && !receipt.browser.timedOut && report.integrity.status === 'PASS' && report.blockingReasons.length === 0;
    return { runRoot, receipt, report };
  } catch (error) {
    receipt.success = false; receipt.failure = { name: error.name, message: error.message };
    throw error;
  } finally {
    receipt.finished = new Date().toISOString();
    await writeJson(resolve(runRoot, 'receipt.json'), receipt);
    console.log(JSON.stringify({ runRoot, phase: receipt.phase, success: receipt.success }));
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = await run(); if (!result.receipt.success) process.exitCode = 1; }
  catch (error) { console.error(error); process.exitCode = 1; }
}
