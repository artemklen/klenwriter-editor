// SPDX-License-Identifier: MIT OR Apache-2.0
// Isolated test composition. No production package or verifier is rewritten.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, writeFileSync, lstatSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { encodeSdkWasmSeal, sdkWasmSectionName, wasmSections } from './seal-sdk-wasm.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = 'tests/fixtures/failure-runtime';
const producer = 'scripts/build-failure-runtime.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const rel = path => relative(root, path).split('\\').join('/');
function source(path) {
  const full = resolve(root, path); assert(lstatSync(full).isFile() && !lstatSync(full).isSymbolicLink());
  return readFileSync(full);
}
function fixtureSources() {
  return [`${fixture}/Cargo.toml`, `${fixture}/Cargo.lock`, `${fixture}/src/lib.rs`, `${fixture}/src/main.rs`,
    'contracts/failure-states/v1/loading-recovery.json', 'contracts/failure-states/v1/README.md'];
}
export function computeFailureRuntimeIdentity(baseBuildId) {
  assert.match(baseBuildId, /^sha256:[0-9a-f]{64}$/);
  const hash = createHash('sha256').update('klenwriter-editor-failure-fixture/1\0').update(`${baseBuildId}\0kwdj-only\0`);
  const hashes = {};
  for (const path of fixtureSources().sort()) {
    const bytes = source(path); hashes[path] = sha(bytes); hash.update(`${path}\0${bytes.length}\0`).update(bytes);
  }
  return { buildId: `sha256:${hash.digest('hex')}`, fixtureSourceHashes: hashes };
}
function verifySources(hashes) {
  for (const [path, expected] of Object.entries(hashes)) assert.equal(sha(source(path)), expected, `Source changed: ${path}`);
}
function fileRecord(path) { const bytes = readFileSync(path); return { path: rel(path), bytes: bytes.length, sha256: sha(bytes) }; }
function allArtifacts(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink());
    const path = resolve(directory, entry.name);
    if (entry.name === 'runs' || entry.name === 'build.json') continue;
    if (entry.isDirectory()) found.push(...allArtifacts(path));
    else if (entry.isFile()) found.push(fileRecord(path));
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

export async function buildFailureRuntime({ baseBuildId, baseSourceHashes }) {
  assert(Object.hasOwn(baseSourceHashes, producer), 'Production source closure must bind the fixture producer');
  verifySources(baseSourceHashes);
  const identity = computeFailureRuntimeIdentity(baseBuildId);
  const directory = resolve(root, 'artifacts/failure-states/runtime');
  const runId = randomUUID(), runDirectory = resolve(directory, 'runs', runId);
  mkdirSync(runDirectory, { recursive: true });
  const target = resolve(root, 'target/failure-runtime');
  const commands = [];
  const environment = { ...process.env, KLENWRITER_EDITOR_SDK_BUILD_ID: identity.buildId };
  const configuration = { format: 'editor-failure-runtime-build/1', runId, baseBuildId, ...identity,
    sourceHashes: { ...baseSourceHashes, ...identity.fixtureSourceHashes }, producer, fixture,
    scope: 'Test-only real Rust bridge/KWDJ composition with explicit compiled trap; separate matching fixture-local SDK. Not production WASM or arbitrary in-commit fault coverage.' };
  json(resolve(runDirectory, 'configuration.json'), configuration);
  const run = (label, command, args) => {
    const stdoutPath = resolve(runDirectory, `${commands.length + 1}-${label}.stdout`);
    const stderrPath = resolve(runDirectory, `${commands.length + 1}-${label}.stderr`);
    const out = openSync(stdoutPath, 'wx'), err = openSync(stderrPath, 'wx'), startedAt = new Date().toISOString();
    let result;
    try { result = spawnSync(command, args, { cwd: root, env: environment, stdio: ['ignore', out, err] }); }
    finally { closeSync(out); closeSync(err); }
    commands.push({ label, command, args, startedAt, completedAt: new Date().toISOString(), exitCode: result.status,
      signal: result.signal, stdout: fileRecord(stdoutPath), stderr: fileRecord(stderrPath) });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `Fixture build step failed: ${label}; see ${stderrPath}`);
    return readFileSync(stdoutPath, 'utf8');
  };
  const validateManifest = value => {
    assert.equal(value.abi, 'editor-sdk/2'); assert.equal(value.build_id, identity.buildId);
    assert.equal(value.registry_format, 'editor-registry/1');
    assert.deepEqual(value.profiles.map(p => p.profile_id), ['org.klenwriter.kwdj']);
  };
  try {
    const rust = run('toolchain', 'rustc', ['-vV']); assert.match(rust, /^rustc 1\.97\.1 /);
    const host = /^host: (.+)$/m.exec(rust)?.[1]; assert(host);
    const bindgen = resolve(root, '.tools/bin/wasm-bindgen');
    assert.equal(run('bindgen-version', bindgen, ['--version']).trim(), 'wasm-bindgen 0.2.129');
    run('fetch', 'cargo', ['fetch', '--locked', '--manifest-path', `${fixture}/Cargo.toml`, '--target', host, '--target', 'wasm32-unknown-unknown']);
    const common = ['--release', '--locked', '--offline', '--manifest-path', `${fixture}/Cargo.toml`, '--target-dir', target];
    run('native', 'cargo', ['build', ...common, '--target', host, '--bin', 'failure-runtime-manifest']);
    const native = JSON.parse(run('native-manifest', resolve(target, host, 'release/failure-runtime-manifest'), []));
    validateManifest(native); json(resolve(directory, 'native-manifest.json'), native);
    run('wasm', 'cargo', ['build', ...common, '--target', 'wasm32-unknown-unknown', '--lib']);
    const rustWasm = resolve(target, 'wasm32-unknown-unknown/release/editor_failure_runtime.wasm');
    copyFileSync(rustWasm, resolve(directory, 'fixture-rust.wasm'));
    run('bindgen-web', bindgen, [rustWasm, '--target', 'web', '--out-dir', directory, '--out-name', 'editor_wasm']);
    const wasmPath = resolve(directory, 'editor_wasm_bg.wasm'), raw = readFileSync(wasmPath);
    writeFileSync(resolve(directory, 'fixture-bindgen-raw.wasm'), raw);
    // Manifest-only isolated module imports follow the existing consumer producer.
    // They are not the recovery implementation and open no editing Session.
    const manifestAt = async (bytes, phase) => {
      const glue = await import(`${pathToFileURL(resolve(directory, 'editor_wasm.js')).href}?manifest=${runId}-${phase}`);
      await glue.default({ module_or_path: bytes });
      const value = JSON.parse(glue.sdkManifestV2()); validateManifest(value); assert.deepEqual(value, native);
      assert.deepEqual(JSON.parse(glue.sdkResourceCountsV2()), { sessions: 0, snapshot_handles: 0, snapshot_bytes: '0', protected_cursors: 0 });
      return value;
    };
    await manifestAt(raw, 'raw');
    const sealed = encodeSdkWasmSeal(raw, native); writeFileSync(wasmPath, sealed.bytes);
    const sections = wasmSections(sealed.bytes).filter(s => s.name === sdkWasmSectionName);
    assert.equal(sections.length, 1); assert.equal(sections[0].start, raw.length);
    await manifestAt(sealed.bytes, 'sealed');
    json(resolve(directory, 'wasm-seal.json'), { ...sealed.metadata, raw: fileRecord(resolve(directory, 'fixture-bindgen-raw.wasm')),
      sealed: fileRecord(wasmPath), nativeAndRawAndSealedManifestsEqual: true, editingSessionsOpened: 0 });
    const bundled = await build({ stdin: { resolveDir: root, sourcefile: 'failure-fixture-entry.mjs',
      contents: "export * from './packages/sdk/src/index.ts'; export {mountEditor} from './packages/dom/src/index.ts'; export {kwdjBasicRenderers} from './packages/kwdj/src/dom.ts'; export {kwdjCommand} from './packages/kwdj/src/index.ts';" },
      outfile: resolve(directory, 'sdk.js'), bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
      metafile: true, sourcemap: false, plugins: [{ name: 'explicit-fixture-build-identity', setup(context) {
        context.onResolve({ filter: /^@klenwriter\/editor-wasm$/ }, () => ({ path: resolve(root, 'packages/wasm/src/index.ts') }));
        context.onResolve({ filter: /^@klenwriter\/editor-sdk$/ }, () => ({ path: resolve(root, 'packages/sdk/src/index.ts') }));
        context.onResolve({ filter: /^@klenwriter\/editor-dom$/ }, () => ({ path: resolve(root, 'packages/dom/src/index.ts') }));
        context.onResolve({ filter: /^\.\/sdk-build-id\.js$/ }, args => args.resolveDir === resolve(root, 'packages/wasm/src')
          ? { path: 'fixture-build-id', namespace: 'failure-fixture' } : undefined);
        context.onLoad({ filter: /.*/, namespace: 'failure-fixture' }, () => ({ contents: `export const sdkBuildId = ${JSON.stringify(identity.buildId)};`, loader: 'js' }));
      } }] });
    json(resolve(directory, 'sdk-inputs.json'), bundled.metafile);
    verifySources(configuration.sourceHashes);
    assert.deepEqual(computeFailureRuntimeIdentity(baseBuildId), identity);
    const receipt = { ...configuration, status: 'passed', host, commands, nativeManifest: native,
      artifacts: allArtifacts(directory), actualRuntimeFaultExecuted: false };
    json(resolve(runDirectory, 'receipt.json'), receipt); json(resolve(directory, 'build.json'), receipt);
    return receipt;
  } catch (error) {
    const failure = { ...configuration, status: 'failed', commands, error: { name: error.name, message: error.message } };
    json(resolve(runDirectory, 'receipt.json'), failure); json(resolve(directory, 'build.json'), failure); throw error;
  }
}
