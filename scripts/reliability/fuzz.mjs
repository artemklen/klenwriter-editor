// SPDX-License-Identifier: MIT OR Apache-2.0
// Coverage-guided fuzz lane for the OSR-38 AC3 stopped block. Imports start
// no process and change no artifact; invoking the CLI performs the work.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, resolve, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { replaySourceHashes } from './replay-native.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixtureDirectory = resolve(root, 'tests/fixtures/fuzz-native');
const seedsDirectory = resolve(fixtureDirectory, 'seeds');
const cargoFuzz = resolve(root, '.tools/bin/cargo-fuzz');
const wasmChild = resolve(root, 'scripts/reliability/fuzz-replay-child.mjs');
const TOOLCHAIN = 'nightly-2026-10-17';
const RUSTC_RELEASE = '1.101.0-nightly';
const RUSTC_COMMIT = '5d8fec0669a64607db9ccbf663e7c23125bf4748';
const CARGO_FUZZ_VERSION = 'cargo-fuzz 0.13.2';
const MAX_LEN = 16384;
const TIMEOUT_SECONDS = 2;
const RSS_LIMIT_MB = 2048;
const LIBFUZZER_SEED = 951929086; // 0x38c0ffee
const MAX_TARGET_EVIDENCE = 64 * 1024 * 1024;
// Non-seed corpus files replayed per family. Every committed seed is added
// on top of this bound, in seed-name order, before the corpus subset.
const WASM_REPLAY_LIMIT = 256;
const MODES = Object.freeze({
  bounded: Object.freeze({ perTargetSeconds: 60, jobCapMs: 20 * 60 * 1000, runSlackMs: 4 * 60 * 1000 }),
  long: Object.freeze({ perTargetSeconds: 900, jobCapMs: 90 * 60 * 1000, runSlackMs: 10 * 60 * 1000 }),
});
const FAMILIES = Object.freeze(['admission_options', 'registry_grammar_attrs_recipes',
  'positions_maps_state_history_events', 'bridge_lifecycle_facts_stale_tokens']);
const CONTEXTS = ['kwdj-prose', 'kwdj-poetry', 'notes-d0', 'notes-d1'];

const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function regular(path, maximum = 32 * 1024 * 1024) {
  const stat = lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum, `bounded regular file: ${path}`);
  return readFileSync(path);
}
function pin(path, maximum) { const bytes = regular(path, maximum); return { path: resolve(path), bytes: bytes.length, sha256: hash(bytes) }; }
function save(path, bytes) { writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 }); assert.deepEqual(readFileSync(path), bytes); return pin(path, MAX_TARGET_EVIDENCE); }
function walk(path) {
  return readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en')).flatMap(entry => {
    assert.equal(entry.isSymbolicLink(), false, `symlink source: ${entry.name}`);
    const current = resolve(path, entry.name);
    return entry.isDirectory() ? walk(current) : entry.isFile() ? [current] : [];
  });
}
/**
 * Local `~/.cargo/bin/cargo` may be a plain stable symlink instead of a rustup
 * proxy, so nested toolchain files and `+toolchain` arguments never apply.
 * The lane prepends gitignored shims that exec the pinned nightly through
 * rustup; cargo-fuzz's internal plain-`cargo` spawns then resolve to it too.
 */
const shimDirectory = resolve(root, `.tools/nightly-${TOOLCHAIN}-shims`);
function ensureNightlyShims() {
  mkdirSync(shimDirectory, { recursive: true });
  for (const tool of ['cargo', 'rustc']) {
    const path = resolve(shimDirectory, tool);
    writeFileSync(path, `#!/bin/sh\nexec rustup run ${TOOLCHAIN} ${tool} "$@"\n`, { flag: 'w' });
    chmodSync(path, 0o755);
  }
  return `${shimDirectory}:${process.env.PATH ?? ''}`;
}

function fuzzSourceHashes() {
  const own = ['scripts/reliability/fuzz.mjs', 'scripts/reliability/fuzz-seeds.mjs', 'scripts/reliability/fuzz-replay-child.mjs',
    'docs/reliability-fuzz.md', 'tests/fixtures/fuzz-native/Cargo.toml', 'tests/fixtures/fuzz-native/rust-toolchain.toml',
    'tests/fixtures/fuzz-native/Cargo.lock', 'tests/fixtures/fuzz-native/src/lib.rs', 'tests/fixtures/fuzz-native/src/bin/corpus_replay.rs',
    ...readdirSync(resolve(fixtureDirectory, 'fuzz_targets')).map(name => `tests/fixtures/fuzz-native/fuzz_targets/${name}`)];
  const seeds = walk(seedsDirectory).map(path => relative(root, path));
  const paths = new Set([...Object.keys(replaySourceHashes()), ...own, ...seeds]);
  return Object.fromEntries([...paths].sort().map(path => [path, hash(regular(resolve(root, path)))]));
}

/** External wall-clock watchdog; the SIGKILL is the interrupt, never a race. */
function execute({ binary, args, cwd = root, timeoutMs, maxStreamBytes = 16 * 1024 * 1024, env = {}, nightly = false }) {
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 95 * 60 * 1000);
  const startedAt = new Date().toISOString(), started = performance.now();
  const path = nightly ? ensureNightlyShims() : null;
  return new Promise(resolveResult => {
    let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), failure = null;
    const child = spawn(binary, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...(path ? { PATH: path } : {}), ...env } });
    const kill = code => { failure ??= { code, phase: 'process', class: code, message: 'External fuzz host stopped the child' }; child.kill('SIGKILL'); };
    const timer = setTimeout(() => kill('reliability.fuzz_watchdog'), Math.max(0, timeoutMs - (performance.now() - started)));
    function capture(name, chunk) {
      const prior = name === 'stdout' ? stdout : stderr;
      if (prior.length + chunk.length > maxStreamBytes) { kill('reliability.fuzz_evidence_limit'); return; }
      if (name === 'stdout') stdout = Buffer.concat([stdout, chunk]); else stderr = Buffer.concat([stderr, chunk]);
    }
    child.stdout.on('data', bytes => capture('stdout', bytes));
    child.stderr.on('data', bytes => capture('stderr', bytes));
    child.on('error', error => { failure ??= { code: 'reliability.fuzz_spawn', phase: 'process', class: 'spawn', message: error.message }; });
    child.on('close', (returnCode, signal) => {
      clearTimeout(timer);
      if ((returnCode !== 0 || signal) && !failure) failure = { code: 'reliability.fuzz_exit', phase: 'process', class: 'exit', message: `Actual fuzz exit ${returnCode}/${signal}` };
      resolveResult({ argv: [binary, ...args], cwd, startedAt, completedAt: new Date().toISOString(),
        elapsedMs: performance.now() - started, returnCode, signal, timeoutMs, stdout, stderr, failure });
    });
  });
}
function rawExecution(directory, name, actual) {
  const stdout = save(resolve(directory, `${name}.stdout`), actual.stdout), stderr = save(resolve(directory, `${name}.stderr`), actual.stderr);
  const { stdout: _out, stderr: _err, ...execution } = actual;
  return { ...execution, stdout, stderr };
}

function libFuzzerStats(stdout) {
  const text = stdout.toString('utf8');
  const executed = /stat::number_of_executed_units:\s*(\d+)/.exec(text);
  const peakRss = /stat::peak_rss_mb:\s*(\d+)/.exec(text);
  let cov = null, features = null;
  for (const match of text.matchAll(/#\d+.*?\bcov:\s*(\d+).*?\bft:\s*(\d+)/g)) { cov = Number(match[1]); features = Number(match[2]); }
  const crashes = /stat::number_of_crash_cases:\s*(\d+)/.exec(text);
  return { executedUnits: executed ? Number(executed[1]) : null, peakRssMb: peakRss ? Number(peakRss[1]) : null,
    coverage: cov, features, crashCases: crashes ? Number(crashes[1]) : 0 };
}

function inventoryCorpus(directory) {
  const files = walk(directory).map(path => ({ name: relative(directory, path), ...pin(path, MAX_TARGET_EVIDENCE) }));
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  assert(totalBytes <= MAX_TARGET_EVIDENCE, `target corpus evidence overflow: ${directory} (${totalBytes} bytes)`);
  return { files, totalBytes };
}

async function environmentStage(directory) {
  const commands = [];
  const versions = await execute({ binary: cargoFuzz, args: ['--version'], timeoutMs: 30 * 1000 });
  commands.push(rawExecution(directory, 'env-cargo-fuzz', versions));
  assert.equal(versions.stdout.toString('utf8').trim(), CARGO_FUZZ_VERSION, 'pinned cargo-fuzz 0.13.2 required');
  const compiler = await execute({ binary: 'rustc', args: ['-vV'], cwd: fixtureDirectory, timeoutMs: 30 * 1000, nightly: true });
  commands.push(rawExecution(directory, 'env-rustc', compiler));
  const release = /release:\s*(.+)/.exec(compiler.stdout.toString('utf8'))?.[1]?.trim();
  assert.equal(release, RUSTC_RELEASE, `pinned ${TOOLCHAIN} compiler release required`);
  const commit = /commit-hash:\s*([0-9a-f]+)/.exec(compiler.stdout.toString('utf8'))?.[1];
  assert.equal(commit, RUSTC_COMMIT, `pinned ${TOOLCHAIN} compiler commit required`);
  const host = /host:\s*(.+)/.exec(compiler.stdout.toString('utf8'))?.[1]?.trim();
  assert.ok(host, 'rustc host triple required');
  const rootLock = regular(resolve(root, 'Cargo.lock'), 8 * 1024 * 1024).toString('utf8');
  assert(!rootLock.includes('libfuzzer-sys') && !rootLock.includes('cargo-fuzz'), 'fuzz tooling leaked into the production lock');
  const nativeLock = regular(resolve(root, 'tests/fixtures/reliability-native/Cargo.lock'), 8 * 1024 * 1024).toString('utf8');
  assert(!nativeLock.includes('libfuzzer-sys'), 'fuzz tooling leaked into the ordinary native fixture lock');
  const fuzzLock = regular(resolve(fixtureDirectory, 'Cargo.lock'), 8 * 1024 * 1024).toString('utf8');
  assert(fuzzLock.includes('name = "libfuzzer-sys"\nversion = "0.4.13"'), 'fuzz lock must pin libfuzzer-sys 0.4.13');
  return { commands, host, release };
}

async function fetchBuildStage(directory, commands) {
  const lockBefore = pin(resolve(fixtureDirectory, 'Cargo.lock'), 8 * 1024 * 1024);
  const fetch = await execute({ binary: 'cargo', args: ['fetch', '--locked'], cwd: fixtureDirectory, timeoutMs: 10 * 60 * 1000, nightly: true });
  commands.push(rawExecution(directory, 'build-fetch', fetch));
  assert.equal(fetch.failure, null, 'explicit locked fetch failed');
  // cwd inside the fixture selects the pinned nightly through the nested
  // rust-toolchain.toml for every cargo child cargo-fuzz spawns.
  const fuzzBuild = await execute({ binary: cargoFuzz, args: ['build', '--fuzz-dir', '.'], cwd: fixtureDirectory, timeoutMs: 60 * 60 * 1000, env: { CARGO_NET_OFFLINE: 'true' }, nightly: true });
  commands.push(rawExecution(directory, 'build-cargo-fuzz', fuzzBuild));
  assert.equal(fuzzBuild.failure, null, 'offline cargo-fuzz build failed');
  const replayBuild = await execute({ binary: 'cargo', args: ['build', '--locked', '--offline', '--bin', 'corpus-replay'], cwd: fixtureDirectory, timeoutMs: 30 * 60 * 1000, nightly: true });
  commands.push(rawExecution(directory, 'build-corpus-replay', replayBuild));
  assert.equal(replayBuild.failure, null, 'offline corpus-replay build failed');
  const lockAfter = pin(resolve(fixtureDirectory, 'Cargo.lock'), 8 * 1024 * 1024);
  assert.equal(lockAfter.sha256, lockBefore.sha256, 'locked fetch/build changed the fuzz lock');
  return { lockBefore, lockAfter };
}

// cargo-fuzz's default optimized-with-debug-assertions build directory.
function fuzzBinary(host, name) { return resolve(fixtureDirectory, 'target', host, 'release', name); }
function replayBinary() { return resolve(fixtureDirectory, 'target', 'debug', 'corpus-replay'); }

async function runTargets(mode, directory, host, commands) {
  const limits = MODES[mode];
  const jobStarted = performance.now();
  const results = [];
  for (const family of FAMILIES) {
    const corpusDirectory = resolve(directory, 'corpus', family), artifactsDirectory = resolve(directory, 'artifacts', family);
    mkdirSync(corpusDirectory, { recursive: true, mode: 0o700 });
    mkdirSync(artifactsDirectory, { recursive: true, mode: 0o700 });
    for (const seed of readdirSync(resolve(seedsDirectory, family)).filter(name => name.endsWith('.seed')).sort()) {
      copyFileSync(resolve(seedsDirectory, family, seed), resolve(corpusDirectory, seed));
    }
    const binary = fuzzBinary(host, family);
    const binaryPin = pin(binary, 512 * 1024 * 1024);
    const remainingJobMs = limits.jobCapMs - (performance.now() - jobStarted);
    assert(remainingJobMs > limits.runSlackMs, `fuzz job cap exhausted before ${family}`);
    const run = await execute({
      binary, cwd: root, timeoutMs: Math.min(limits.perTargetSeconds * 1000 + limits.runSlackMs, remainingJobMs),
      args: [corpusDirectory, `-max_total_time=${limits.perTargetSeconds}`, `-timeout=${TIMEOUT_SECONDS}`, `-rss_limit_mb=${RSS_LIMIT_MB}`,
        `-max_len=${MAX_LEN}`, '-len_control=0', '-detect_leaks=0', `-seed=${LIBFUZZER_SEED}`, '-use_value_profile=1',
        '-print_final_stats=1', `-artifact_prefix=${artifactsDirectory}/`],
    });
    commands.push(rawExecution(directory, `run-${family}`, run));
    // libFuzzer emits all progress and final stats on stderr.
    const stats = libFuzzerStats(Buffer.concat([run.stdout, run.stderr]));
    const corpus = inventoryCorpus(corpusDirectory);
    const crashes = walk(artifactsDirectory).map(path => pin(path, MAX_TARGET_EVIDENCE));
    const seedCount = readdirSync(resolve(seedsDirectory, family)).filter(name => name.endsWith('.seed')).length;
    if (run.failure === null) {
      assert.ok(Number.isSafeInteger(stats.executedUnits) && stats.executedUnits > 0, `zero explored iterations cannot pass: ${family}`);
      assert.ok(Number.isSafeInteger(stats.coverage) && stats.coverage > 0, `missing coverage feedback: ${family}`);
    }
    assert(crashes.length === 0, `libFuzzer retained crash/oom/timeout artifacts for ${family}`);
    save(resolve(directory, `corpus-${family}.json`), json({ family, seeds: seedCount, corpus }));
    results.push({ family, binary: binaryPin, execution: { returnCode: run.returnCode, signal: run.signal, elapsedMs: run.elapsedMs, timeoutMs: run.timeoutMs },
      failure: run.failure, stats, corpus: { files: corpus.files.length, totalBytes: corpus.totalBytes, seeds: seedCount }, artifacts: crashes });
    if (run.failure) break;
  }
  return results;
}

function requirePhases(family, aggregate, failures) {
  const missing = [];
  const need = (scope, key, label) => {
    const value = aggregate?.[scope]?.[key];
    if (!(Number.isSafeInteger(value) && value > 0)) missing.push(`${scope}.${key} (${label})`);
  };
  if (family === 'admission_options') {
    for (const context of CONTEXTS) {
      need(context, 'admitted', 'successful admit');
      need(context, 'admission_attempts', 'raw admission attempt');
      need(context, 'snapshot_exports', 'canonical export');
      need(context, 'closed', 'lifecycle cleanup');
    }
  } else if (family === 'registry_grammar_attrs_recipes') {
    need('registry', 'compiler_attempts', 'descriptor compile attempt');
    need('registry', 'compiled', 'successful compile');
  } else if (family === 'positions_maps_state_history_events') {
    for (const context of CONTEXTS) {
      need(context, 'command_publications', 'plan/publish');
      need(context, 'history_publications', 'history');
      need(context, 'late_refusals', 'late refusal');
      need(context, 'normalization_operations', 'normalization');
      need(context, 'closed', 'cleanup');
    }
  } else {
    for (const context of CONTEXTS) {
      need(context, 'admitted', 'bridge admission');
      need(context, 'command_publications', 'bridge publish');
      need(context, 'history_publications', 'bridge history');
      need(context, 'snapshot_exports', 'bridge snapshot');
      need(context, 'event_reads', 'bridge events');
      need(context, 'closed', 'bridge cleanup');
    }
  }
  if (missing.length) failures.push({ family, phase: 'reachability', missing });
}

async function replayStage(directory, commands) {
  const observations = [], nativeAdmission = {}, failures = [];
  for (const family of FAMILIES) {
    const inputs = [resolve(seedsDirectory, family), resolve(directory, 'corpus', family)];
    const run = await execute({ binary: replayBinary(), args: [family, ...inputs], timeoutMs: 10 * 60 * 1000, maxStreamBytes: 32 * 1024 * 1024 });
    commands.push(rawExecution(directory, `replay-${family}`, run));
    if (run.failure) { failures.push({ family, phase: 'corpus-replay', failure: run.failure }); break; }
    const report = JSON.parse(run.stdout.toString('utf8'));
    assert.equal(report.format, 'editor-reliability-fuzz-corpus-replay/1');
    assert.equal(report.family, family);
    save(resolve(directory, `replay-${family}.json`), json(report));
    requirePhases(family, report.aggregate, failures);
    if (family === 'admission_options') {
      for (const file of report.files) if (file.ok) nativeAdmission[file.name] = file.admitted;
    }
    observations.push({ family, status: report.status, files: report.files.length, aggregate: report.aggregate });
    if (report.status !== 'passed') { failures.push({ family, phase: 'corpus-replay', failures: report.failures }); break; }
  }
  return { observations, nativeAdmission, failures };
}

function sdkProducerPins() {
  const producer = JSON.parse(regular(resolve(root, 'artifacts/sdk-build-identity.json')));
  const seal = JSON.parse(regular(resolve(root, 'artifacts/sdk-wasm-seal.json')));
  assert.equal(producer.format, 'klenwriter-editor-sdk-build/1');
  assert.equal(seal.format, 'klenwriter-editor-sdk-wasm/1');
  assert.equal(seal.build_id, producer.buildId);
  const wasm = pin(resolve(root, 'packages/wasm/dist/editor_wasm_bg.wasm'));
  assert.equal(wasm.sha256, seal.sealed_sha256, 'packaged WASM does not match the seal; run npm run build');
  return { buildId: producer.buildId, wasm };
}

/**
 * Packaged replay set: every committed seed copied into the corpus, then at
 * most WASM_REPLAY_LIMIT sorted non-seed corpus files. Seed names sort late
 * among libFuzzer hashes, so a single slice of the corpus drops them.
 */
export function packagedReplayPaths(family, corpusDirectory) {
  const committed = readdirSync(resolve(seedsDirectory, family))
    .filter(name => name.endsWith('.seed'))
    .sort((left, right) => left.localeCompare(right, 'en'));
  const files = walk(corpusDirectory);
  const byName = new Map(files.map(path => [basename(path), path]));
  const seeds = committed.map(name => {
    const path = byName.get(name);
    assert.ok(path, `committed seed missing from corpus copy: ${family}/${name}`);
    return path;
  });
  const seedNames = new Set(committed);
  const corpus = files.filter(path => !seedNames.has(basename(path))).slice(0, WASM_REPLAY_LIMIT);
  return { seeds, corpus, files: [...seeds, ...corpus] };
}

async function wasmStage(directory, commands, nativeAdmission) {
  const producer = sdkProducerPins();
  const child = spawn(process.execPath, [wasmChild], { cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const failures = [];
  let readyResolve;
  const ready = new Promise(resolveReady => { readyResolve = resolveReady; });
  const watchdog = setTimeout(() => { failures.push({ phase: 'wasm', failure: { code: 'reliability.fuzz_wasm_watchdog', message: 'SDK replay child watchdog' } }); child.kill('SIGKILL'); readyResolve(null); }, 60 * 1000);
  child.stdout.on('data', () => {});
  child.stderr.on('data', bytes => { if (bytes.length) failures.push({ phase: 'wasm', failure: { code: 'reliability.fuzz_wasm_stderr', message: bytes.toString('utf8').slice(0, 1024) } }); });
  child.on('message', message => { if (message?.kind === 'ready') { clearTimeout(watchdog); readyResolve(message); } });
  const module = await ready;
  const summary = { admission: { tasks: 0, agreed: 0, ambiguous: 0, skippedNonUtf8: 0, refused: 0, admitted: 0, seeds: 0, corpusFiles: 0 }, bridge: { tasks: 0, envelopeNonAdmission: 0, admitted: 0, refusedInitialization: 0, replies: 0, seeds: 0, corpusFiles: 0 } };
  async function task(payload, deadlineMs) {
    return new Promise(resolveTask => {
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; failures.push({ phase: 'wasm', failure: { code: 'reliability.fuzz_wasm_watchdog', message: `task watchdog: ${payload.kind}` } }); child.kill('SIGKILL'); resolveTask({ status: 'failed' }); } }, deadlineMs);
      const onMessage = message => {
        if (message?.kind !== 'result' || message.task !== payload.index) return;
        settled = true; clearTimeout(timer); child.off('message', onMessage); resolveTask(message.result);
      };
      child.on('message', onMessage);
      child.send({ ...payload, task: payload.index });
    });
  }
  if (module) {
    const admissionDirectory = resolve(directory, 'corpus', 'admission_options');
    // Seeds first, then the sorted non-seed subset. Native replay above
    // still walks the complete corpus.
    const admissionReplay = packagedReplayPaths('admission_options', admissionDirectory);
    summary.admission.seeds = admissionReplay.seeds.length;
    summary.admission.corpusFiles = admissionReplay.corpus.length;
    for (const [index, path] of admissionReplay.files.entries()) {
      const name = relative(admissionDirectory, path);
      const payload = regular(path);
      const context = CONTEXTS[payload[0] % 4];
      // Strip the test-only context selector: the packaged SDK receives the
      // payload bytes exactly as the native harness entry does.
      const result = await task({ kind: 'admission', index, context, payloadB64: payload.subarray(1).toString('base64') }, 30 * 1000);
      summary.admission.tasks++;
      if (result.status === 'skipped-non-utf8') { summary.admission.skippedNonUtf8++; continue; }
      if (result.status === 'failed') { failures.push({ phase: 'wasm-admission', name, failure: result }); break; }
      if (result.status === 'ok-admitted') summary.admission.admitted++;
      if (result.status === 'ok-refused') summary.admission.refused++;
      const native = nativeAdmission[name];
      if (native === 6 || native === 0) {
        const expected = native === 6 ? 'ok-admitted' : 'ok-refused';
        if (result.status === expected) summary.admission.agreed++;
        else failures.push({ phase: 'wasm-admission-differential', name, nativeAdmitted: native, sdkStatus: result.status });
      } else summary.admission.ambiguous++;
    }
  }
  if (module && failures.length === 0) {
    const bridgeDirectory = resolve(directory, 'corpus', 'bridge_lifecycle_facts_stale_tokens');
    const bridgeReplay = packagedReplayPaths('bridge_lifecycle_facts_stale_tokens', bridgeDirectory);
    summary.bridge.seeds = bridgeReplay.seeds.length;
    summary.bridge.corpusFiles = bridgeReplay.corpus.length;
    for (const [index, path] of bridgeReplay.files.entries()) {
      const name = relative(bridgeDirectory, path);
      const payload = regular(path);
      const context = CONTEXTS[payload[0] % 4];
      const result = await task({ kind: 'bridge', index, context, payloadB64: payload.subarray(1).toString('base64') }, 30 * 1000);
      summary.bridge.tasks++;
      if (result.status === 'envelope-non-admission') { summary.bridge.envelopeNonAdmission++; continue; }
      if (result.status === 'failed') { failures.push({ phase: 'wasm-bridge', name, failure: result }); break; }
      if (result.admitted) summary.bridge.admitted++; else summary.bridge.refusedInitialization++;
      summary.bridge.replies += result.replies ?? 0;
    }
  }
  child.kill('SIGKILL');
  await new Promise(resolveClose => child.on('close', resolveClose));
  commands.push({ phase: 'wasm-replay', producer, summary: { ...summary, replayLimitPerFamily: WASM_REPLAY_LIMIT }, failures });
  return { producer, summary, failures };
}

async function minimize(family, artifact) {
  assert(FAMILIES.includes(family), 'unknown family');
  const original = pin(resolve(artifact), MAX_TARGET_EVIDENCE);
  const compiler = await execute({ binary: 'rustc', args: ['-vV'], cwd: fixtureDirectory, timeoutMs: 30 * 1000, nightly: true });
  const host = /host:\s*(.+)/.exec(compiler.stdout.toString('utf8'))?.[1]?.trim();
  const outputDirectory = resolve(root, 'artifacts/reliability/fuzz/minimized', randomUUID());
  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  const minimized = resolve(outputDirectory, 'minimized-reproducer');
  const run = await execute({ binary: fuzzBinary(host, family), cwd: root, timeoutMs: 30 * 60 * 1000,
    args: [`-artifact_prefix=${outputDirectory}/`, '-minimize_crash=1', `-exact_artifact_path=${minimized}`, '-timeout=2', '-rss_limit_mb=2048', resolve(artifact)] });
  const value = { format: 'editor-reliability-fuzz-minimize/1', family, original,
    run: { returnCode: run.returnCode, signal: run.signal, elapsedMs: run.elapsedMs },
    minimized: lstatSync(minimized).isFile() ? pin(minimized) : null,
    qualification: 'Original seed/bytes retained unchanged; the minimized reproducer must reproduce the same invariant+phase/class before any corpus addition.' };
  writeFileSync(resolve(outputDirectory, 'receipt.json'), json(value));
  console.log(JSON.stringify(value));
}

async function main() {
  const mode = process.argv[2];
  assert.ok(MODES[mode], 'usage: node scripts/reliability/fuzz.mjs bounded|long');
  const runId = randomUUID(), directory = resolve(root, 'artifacts/reliability/fuzz', `${mode}-runs`, runId);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const startedAt = new Date().toISOString(), commands = [];
  const sourceBefore = fuzzSourceHashes();
  let environment = null, build = null, targets = null, replay = null, wasm = null, failure = null;
  try {
    environment = await environmentStage(directory);
    build = await fetchBuildStage(directory, commands);
    targets = await runTargets(mode, directory, environment.host, commands);
    if (targets.every(target => target.failure === null)) {
      replay = await replayStage(directory, commands);
      if (replay.failures.length === 0) wasm = await wasmStage(directory, commands, replay.nativeAdmission);
    }
  } catch (error) {
    failure = { code: 'reliability.fuzz_lane', message: error.message, stack: error.stack };
  }
  failure ??= targets?.find(target => target.failure)?.failure ?? replay?.failures[0] ?? wasm?.failures[0] ?? null;
  const sourceAfter = fuzzSourceHashes();
  assert.deepEqual(sourceAfter, sourceBefore, 'fuzz lane changed its own source closure');
  const report = { format: 'editor-reliability-fuzz/1', mode, runId, startedAt, completedAt: new Date().toISOString(),
    status: failure ? 'failed' : 'passed', toolchain: { pinned: TOOLCHAIN, release: environment?.release, host: environment?.host,
      cargoFuzz: CARGO_FUZZ_VERSION, libfuzzerSys: '0.4.13', nightlyShims: shimDirectory },
    bounds: { maxInputBytes: MAX_LEN, perInputSeconds: TIMEOUT_SECONDS, rssLimitMb: RSS_LIMIT_MB, targetEvidenceBytes: MAX_TARGET_EVIDENCE, ...MODES[mode] },
    environment: environment?.commands ?? [], build: build ? { lockBefore: build.lockBefore, lockAfter: build.lockAfter } : null,
    targets, replay: replay?.observations ?? null, wasm: wasm ? { producer: { buildId: wasm.producer.buildId, wasm: wasm.producer.wasm }, summary: wasm.summary } : null,
    failure, sourceHashes: sourceBefore,
    qualification: 'Coverage-guided libFuzzer lane of the public native harness plus exact raw-bytes replay through the actual packaged WASM/SDK under an external process watchdog. Panic/trap/timeout/OOM/uncaught JS exception inside bounds fails. Not a performance, renderer, release-gate or full-AC4 claim.' };
  const bytes = json(report);
  save(resolve(directory, 'report.json'), bytes);
  mkdirSync(resolve(root, 'artifacts/reliability/fuzz'), { recursive: true });
  writeFileSync(resolve(root, 'artifacts/reliability/fuzz', `${mode}-report.json`), bytes);
  console.log(JSON.stringify({ status: report.status, mode, runId,
    targets: report.targets?.map(target => ({ family: target.family, stats: target.stats, corpus: target.corpus })) ?? null,
    wasm: report.wasm?.summary ?? null, failure }));
  if (report.status !== 'passed') process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'minimize') {
    assert.equal(process.argv.length, 5, 'usage: node scripts/reliability/fuzz.mjs minimize <family> <artifact>');
    await minimize(process.argv[3], process.argv[4]);
  } else await main();
}
