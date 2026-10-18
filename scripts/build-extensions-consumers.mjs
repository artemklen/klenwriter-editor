// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, copyFileSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encodeSdkWasmSeal, sdkWasmSectionName, wasmSections } from './seal-sdk-wasm.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = 'tests/fixtures/extensions-consumer';
const producer = 'scripts/build-extensions-consumers.mjs';
const variants = Object.freeze([
  { name: 'notes-only', feature: 'notes', profile: 'org.example.notes', absent: 'kwdj' },
  { name: 'kwdj-only', feature: 'kwdj', profile: 'org.klenwriter.kwdj', absent: 'notes' },
]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pathOf = path => relative(root, path).split(sep).join('/');
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const utf8 = new TextDecoder('utf-8', { fatal: true });
const zeroResources = { sessions: 0, snapshot_handles: 0, snapshot_bytes: '0', protected_cursors: 0 };

function sourceBytes(path) {
  assert(!path.startsWith('/') && !path.split('/').includes('..'), `Repository-relative source required: ${path}`);
  assert(!path.split('/').some(part => ['artifacts', 'target', 'dist', 'node_modules', '.tools'].includes(part)),
    `Generated artifacts cannot be identity inputs: ${path}`);
  const full = resolve(root, path);
  assert(lstatSync(full).isFile() && !lstatSync(full).isSymbolicLink(), `Regular source required: ${path}`);
  return readFileSync(full);
}

function fixtureSources() {
  const paths = [`${fixture}/Cargo.toml`, `${fixture}/Cargo.lock`];
  function walk(path) {
    for (const entry of readdirSync(resolve(root, path), { withFileTypes: true })) {
      assert(!entry.isSymbolicLink(), `Fixture source symlink: ${path}/${entry.name}`);
      const next = `${path}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (entry.isFile()) paths.push(next);
    }
  }
  walk(`${fixture}/src`);
  return Object.fromEntries(paths.sort().map(path => [path, sourceBytes(path)]));
}

/** Pure source identity capture: no generated artifact, compilation, or process runs. */
export function computeExtensionConsumerIdentity({ baseBuildId, variant }) {
  assert(/^sha256:[0-9a-f]{64}$/.test(baseBuildId), 'Actual default source build ID required');
  const selected = variants.find(value => value.name === variant);
  assert(selected, `Unknown external module composition: ${variant}`);
  const sources = fixtureSources();
  const hash = createHash('sha256').update('klenwriter-editor-external-consumer/1\0');
  hash.update(`${baseBuildId}\0${selected.name}\0no-default-features\0${selected.feature}\0`);
  for (const [path, bytes] of Object.entries(sources)) {
    hash.update(`${path}\0${bytes.length}\0`).update(bytes);
  }
  return { buildId: `sha256:${hash.digest('hex')}`,
    fixtureSourceHashes: Object.fromEntries(Object.entries(sources).map(([path, bytes]) => [path, sha(bytes)])) };
}

function verifyBaseSources(sourceHashes) {
  assert(sourceHashes && typeof sourceHashes === 'object' && !Array.isArray(sourceHashes), 'Base source closure required');
  assert(Object.hasOwn(sourceHashes, producer), 'Default build identity must bind this producer');
  for (const [path, digest] of Object.entries(sourceHashes)) {
    assert(/^[0-9a-f]{64}$/.test(digest), `Invalid source SHA256: ${path}`);
    assert.equal(sha(sourceBytes(path)), digest, `Default source changed: ${path}`);
  }
}

function fileRecord(path) {
  const bytes = readFileSync(path);
  return { path: pathOf(path), bytes: bytes.length, sha256: sha(bytes) };
}

function commandRunner(directory, env, commands) {
  return (label, command, args, input) => {
    const index = String(commands.length + 1).padStart(2, '0');
    const stdoutPath = resolve(directory, `${index}-${label}.stdout.log`);
    const stderrPath = resolve(directory, `${index}-${label}.stderr.log`);
    const startedAt = new Date().toISOString();
    // Child output goes directly to disk; a buffer cap cannot masquerade as a full raw log.
    const stdoutFd = openSync(stdoutPath, 'w');
    const stderrFd = openSync(stderrPath, 'w');
    let result;
    try {
      result = spawnSync(command, args, { cwd: root, env, input,
        stdio: ['pipe', stdoutFd, stderrFd], timeout: 20 * 60 * 1000 });
    } finally {
      closeSync(stdoutFd);
      closeSync(stderrFd);
    }
    const stdout = readFileSync(stdoutPath);
    const row = { label, command, args, cwd: root, startedAt, completedAt: new Date().toISOString(),
      exitCode: result.status, signal: result.signal,
      error: result.error ? { code: result.error.code ?? null, message: result.error.message } : null,
      stdout: fileRecord(stdoutPath), stderr: fileRecord(stderrPath),
      ...(input === undefined ? {} : { stdin: { bytes: Buffer.byteLength(input), sha256: sha(input) } }) };
    commands.push(row);
    json(resolve(directory, 'commands.json'), commands);
    json(resolve(directory, `${index}-${label}.exit.json`), row);
    if (result.error || result.status !== 0) {
      throw new Error(`External consumer ${label} failed (exit ${result.status}, signal ${result.signal}); raw proof: ${pathOf(directory)}`);
    }
    return stdout;
  };
}

function verifyManifest(manifest, selected, buildId) {
  assert.equal(manifest.abi, 'editor-sdk/2');
  assert.equal(manifest.build_id, buildId);
  assert.equal(manifest.registry_format, 'editor-registry/1');
  assert.deepEqual(manifest.profiles.map(profile => profile.profile_id), [selected.profile],
    'Only the explicitly compiled concrete module may be offered');
}

async function wasmManifest(gluePath, bytes, nonce) {
  const glue = await import(`${pathToFileURL(gluePath).href}?external-consumer=${nonce}`);
  await glue.default({ module_or_path: bytes });
  assert.equal(typeof glue.SdkSessionV2, 'function');
  const manifest = JSON.parse(glue.sdkManifestV2());
  assert.deepEqual(JSON.parse(glue.sdkResourceCountsV2()), zeroResources);
  return manifest;
}

function verifySeal(bytes, raw, nativeManifest) {
  const sections = wasmSections(bytes).filter(section => section.name === sdkWasmSectionName);
  assert.equal(sections.length, 1);
  const section = sections[0];
  assert.equal(section.start, raw.length);
  assert.equal(section.end, bytes.length);
  assert.deepEqual(bytes.subarray(0, section.start), raw);
  // The engine independently decodes the exact bytes that the fresh glue loads.
  const module = new WebAssembly.Module(bytes);
  const custom = WebAssembly.Module.customSections(module, sdkWasmSectionName);
  assert.equal(custom.length, 1);
  const metadata = JSON.parse(utf8.decode(custom[0]));
  assert.deepEqual(metadata, { format: 'klenwriter-editor-sdk-wasm/1', abi: nativeManifest.abi,
    build_id: nativeManifest.build_id, wasm_bytes: raw.length, wasm_sha256: sha(raw) });
  return metadata;
}

/** Build real standalone native/WASM variants; import alone never builds anything. */
export async function buildExtensionConsumers({ baseBuildId, baseSourceHashes }) {
  verifyBaseSources(baseSourceHashes);
  const identities = variants.map(selected => ({ selected,
    ...computeExtensionConsumerIdentity({ baseBuildId, variant: selected.name }) }));
  assert.equal(new Set([baseBuildId, ...identities.map(value => value.buildId)]).size, 3,
    'Default, notes-only and KWDJ-only identities must differ');
  const reports = [];
  const indexPath = resolve(root, 'artifacts/extensions/consumers/builds.json');
  mkdirSync(resolve(root, 'artifacts/extensions/consumers'), { recursive: true });
  json(indexPath, { format: 'klenwriter-editor-external-consumer-builds/1', status: 'running', baseBuildId });
  for (const { selected, buildId, fixtureSourceHashes } of identities) {
    const directory = resolve(root, 'artifacts/extensions/consumers', selected.name);
    const runId = randomUUID();
    const runDirectory = resolve(directory, 'runs', runId);
    const logs = resolve(runDirectory, 'logs');
    const bindgenFiles = ['consumer.js', 'consumer.d.ts', 'consumer_bg.wasm', 'consumer_bg.wasm.d.ts'];
    // Build caches stay outside artifacts/**; only final files/raw proof are uploaded.
    const targetDirectory = resolve(root, 'target/extensions-consumers', selected.name);
    mkdirSync(logs, { recursive: true });
    for (const name of bindgenFiles) rmSync(resolve(directory, name), { force: true });
    const env = { ...process.env, KLENWRITER_EDITOR_SDK_BUILD_ID: buildId };
    const commands = [];
    const run = commandRunner(logs, env, commands);
    const config = { format: 'klenwriter-editor-external-consumer-build/1', variant: selected.name,
      runId, baseBuildId, buildId, defaultFeatures: false, features: [selected.feature],
      expectedProfileIds: [selected.profile], fixture, targetDirectory: pathOf(targetDirectory),
      baseSourceHashes, fixtureSourceHashes, sourceHashes: { ...baseSourceHashes, ...fixtureSourceHashes } };
    json(resolve(runDirectory, 'config.json'), config);
    json(resolve(directory, 'build.json'), { ...config, status: 'running' });
    try {
      const rust = utf8.decode(run('rust-toolchain', 'rustc', ['-vV']));
      assert.match(rust, /^rustc 1\.97\.1 /);
      const host = /^host: ([a-zA-Z0-9_-]+)$/m.exec(rust)?.[1];
      assert(host, 'Actual native Rust host triple required');
      const bindgen = resolve(root, '.tools/bin/wasm-bindgen');
      assert.equal(utf8.decode(run('bindgen-toolchain', bindgen, ['--version'])).trim(), 'wasm-bindgen 0.2.129');
      const common = ['--locked', '--offline', '--manifest-path', `${fixture}/Cargo.toml`,
        '--no-default-features', '--features', selected.feature];
      const graphs = {};
      for (const [label, target] of [['native', host], ['wasm', 'wasm32-unknown-unknown']]) {
        const bytes = run(`normal-${label}`, 'cargo', ['tree', ...common, '--target', target,
          '-e', 'normal', '--prefix', 'none', '--format', '{p}']);
        const graph = utf8.decode(bytes);
        assert(graph.includes(`klenwriter-editor-${selected.feature}-sdk `), 'Selected module absent from actual normal graph');
        assert(!graph.includes(`klenwriter-editor-${selected.absent}`), 'Unselected concrete profile leaked into normal graph');
        assert(!graph.includes('klenwriter-editor-wasm '), 'External consumer depends on production WASM composition');
        const path = resolve(runDirectory, `normal-${label}.tree`);
        writeFileSync(path, bytes);
        graphs[label] = { target, ...fileRecord(path) };
      }
      run('build-native', 'cargo', ['build', '--release', ...common, '--target', host,
        '--bin', 'extensions-consumer', '--target-dir', targetDirectory]);
      run('build-wasm', 'cargo', ['build', '--release', ...common, '--target', 'wasm32-unknown-unknown',
        '--lib', '--target-dir', targetDirectory]);
      const executable = resolve(directory, process.platform === 'win32' ? 'consumer.exe' : 'consumer');
      const builtExecutable = resolve(targetDirectory, host, 'release',
        process.platform === 'win32' ? 'extensions-consumer.exe' : 'extensions-consumer');
      copyFileSync(builtExecutable, executable);
      chmodSync(executable, lstatSync(builtExecutable).mode & 0o777);
      const manifestInput = JSON.stringify({ op: 'manifest' }) + '\n';
      const nativeManifest = JSON.parse(utf8.decode(run('native-manifest', executable, [], manifestInput)));
      verifyManifest(nativeManifest, selected, buildId);
      const nativeManifestPath = resolve(directory, 'native-manifest.json');
      json(nativeManifestPath, nativeManifest);
      const rustWasm = resolve(targetDirectory, 'wasm32-unknown-unknown/release/editor_extension_external_consumer.wasm');
      const rustWasmCopy = resolve(directory, 'consumer-rust.wasm');
      copyFileSync(rustWasm, rustWasmCopy);
      run('bindgen-web', bindgen, [rustWasm, '--target', 'web', '--out-dir', directory, '--out-name', 'consumer']);
      const gluePath = resolve(directory, 'consumer.js');
      const wasmPath = resolve(directory, 'consumer_bg.wasm');
      const raw = readFileSync(wasmPath);
      const rawCopy = resolve(directory, 'consumer-bindgen-raw.wasm');
      writeFileSync(rawCopy, raw);
      const rawManifest = await wasmManifest(gluePath, raw, `${runId}-raw`);
      verifyManifest(rawManifest, selected, buildId);
      assert.deepEqual(rawManifest, nativeManifest);
      const rawManifestPath = resolve(directory, 'wasm-raw-manifest.json');
      json(rawManifestPath, rawManifest);
      const sealed = encodeSdkWasmSeal(raw, nativeManifest);
      writeFileSync(wasmPath, sealed.bytes);
      const actualSealed = readFileSync(wasmPath);
      const seal = verifySeal(actualSealed, raw, nativeManifest);
      const sealedManifest = await wasmManifest(gluePath, actualSealed, `${runId}-sealed`);
      verifyManifest(sealedManifest, selected, buildId);
      assert.deepEqual(sealedManifest, nativeManifest);
      const sealedManifestPath = resolve(directory, 'wasm-sealed-manifest.json');
      json(sealedManifestPath, sealedManifest);
      const sealReceiptPath = resolve(directory, 'wasm-seal.json');
      json(sealReceiptPath, { ...seal, section: sdkWasmSectionName,
        raw: fileRecord(rawCopy), sealed: fileRecord(wasmPath),
        actualNativeRawAndSealedManifestsEqual: true,
        freshPostSealGlueInstance: true,
        scope: 'Exact ABI2 integrity/compatibility metadata and actual module manifest agreement. No signature or runtime corpus claim.' });
      verifyBaseSources(baseSourceHashes);
      assert.deepEqual(computeExtensionConsumerIdentity({ baseBuildId, variant: selected.name }),
        { buildId, fixtureSourceHashes }, 'External consumer source changed during compilation');
      const artifacts = [executable, rustWasmCopy, rawCopy, nativeManifestPath, rawManifestPath,
        sealedManifestPath, sealReceiptPath, ...bindgenFiles.map(name => resolve(directory, name))].map(fileRecord);
      const report = { ...config, status: 'passed', host, graphs, commands,
        nativeManifest, artifacts,
        scope: 'Actual native and compiled WASM module selection/build/seal agreement. Shared behavioral corpus is verified separately.' };
      json(resolve(runDirectory, 'receipt.json'), report);
      json(resolve(directory, 'build.json'), report);
      reports.push(report);
    } catch (error) {
      const failure = { ...config, status: 'failed', commands,
        error: { name: error.name, message: error.message, stack: error.stack ?? null } };
      json(resolve(runDirectory, 'receipt.json'), failure);
      json(resolve(directory, 'build.json'), failure);
      json(indexPath, { format: 'klenwriter-editor-external-consumer-builds/1', status: 'failed',
        baseBuildId, failedVariant: selected.name,
        receipt: fileRecord(resolve(runDirectory, 'receipt.json')) });
      throw error;
    }
  }
  verifyBaseSources(baseSourceHashes);
  const report = { format: 'klenwriter-editor-external-consumer-builds/1', status: 'passed', baseBuildId,
    variants: reports.map(value => ({ variant: value.variant, buildId: value.buildId, status: value.status,
      receipt: fileRecord(resolve(root, 'artifacts/extensions/consumers', value.variant, 'build.json')) })) };
  json(indexPath, report);
  return report;
}
