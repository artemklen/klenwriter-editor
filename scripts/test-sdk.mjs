// SPDX-License-Identifier: MIT OR Apache-2.0
// Actual public Session bridge witness; controller/CSP/consumer lanes are separate.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { computeSdkBuildIdentity } from './generate-sdk-types.mjs';

const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const walk = path => readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
  ? walk(`${path}/${entry.name}`) : entry.isFile() ? [`${path}/${entry.name}`] : []);
const sdkIdentity = computeSdkBuildIdentity();
const built = JSON.parse(readFileSync('artifacts/sdk-build-identity.json', 'utf8'));
assert.equal(built.buildId, sdkIdentity.buildId, 'Build SDK artifacts from this source before testing');
assert.deepEqual(built.sourceHashes, sdkIdentity.sourceHashes);
const sources = [...new Set([...Object.keys(sdkIdentity.sourceHashes),
  ...walk('contracts/sdk/v1'), 'crates/wasm/examples/support/sdk_observer.rs',
  'crates/wasm/examples/sdk_native.rs', 'crates/wasm/examples/sdk_probe.rs', 'crates/wasm/tests/sdk.rs',
  'evidence/osr-63/execution-contract.md', 'scripts/test-sdk.mjs', 'packages/wasm/src/sdk-types.ts',
  'tests/sdk-controller.node.mjs', 'tests/sdk-loader.node.mjs', 'tests/sdk-types.node.mjs',
  'tests/sdk-integration.node.mjs',
])].sort();
const before = Object.fromEntries(sources.map(path => [path, digest(path)]));
const result = spawnSync('cargo', ['run', '--locked', '--quiet', '-p', 'klenwriter-editor-wasm', '--example', 'sdk_native'], {
  encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, KLENWRITER_EDITOR_SDK_BUILD_ID: sdkIdentity.buildId },
});
mkdirSync('artifacts/sdk', { recursive: true });
writeFileSync('artifacts/sdk/native.stderr.log', result.stderr ?? '');
writeFileSync('artifacts/sdk/native-observer.json', result.stdout ?? '');
assert.equal(result.status, 0, `Actual SDK native witness failed: ${result.stderr}`);
const native = JSON.parse(result.stdout);
const module = await import(pathToFileURL(resolve('artifacts/sdk/probe.js')).href);
await module.default({ module_or_path: readFileSync('artifacts/sdk/probe_bg.wasm') });
const raw = module.observeSdk();
writeFileSync('artifacts/sdk/wasm-observer.json', raw + '\n');
const wasm = JSON.parse(raw);
assert.deepEqual(wasm, native, 'Public Session DTO behavior differs across native/WASM');
assert.deepEqual(JSON.parse(module.observeSdk()), wasm, 'Fresh opaque identities may not change portable results');
assert.equal(wasm.status, 'passed');
const after = Object.fromEntries(sources.map(path => [path, digest(path)]));
assert.deepEqual(after, before, 'Sources changed during observation; raw outputs retained, report refused');
assert.equal(computeSdkBuildIdentity().buildId, sdkIdentity.buildId);
const artifactPaths = ['artifacts/sdk/probe.js', 'artifacts/sdk/probe_bg.wasm', 'target/debug/examples/sdk_native',
  'artifacts/sdk/native-observer.json', 'artifacts/sdk/wasm-observer.json',
  'packages/wasm/dist/editor_wasm.js', 'packages/wasm/dist/editor_wasm_bg.wasm',
  'artifacts/sdk-distribution/editor_wasm.js', 'artifacts/sdk-distribution/editor_wasm_bg.wasm',
  'artifacts/sdk-wasm-seal.json', 'artifacts/sdk-native-manifest.json',
];
for (const filename of ['editor_wasm.js', 'editor_wasm_bg.wasm']) {
  assert.deepEqual(readFileSync(`artifacts/sdk-distribution/${filename}`), readFileSync(`packages/wasm/dist/${filename}`),
    'Directly uploaded SDK artifacts must be the exact packaged producer files');
}
const report = {
  format: 'klenwriter-editor-sdk-report/1', nativeWasmEqual: true,
  buildId: sdkIdentity.buildId, sourceHashes: after,
  artifactHashes: Object.fromEntries(artifactPaths.map(path => [path, digest(path)])),
  portable: wasm,
  scope: 'Actual Rust public Session bridge literals on native and compiled WASM. Controlled JS scheduling, actual packaged controller, clean consumer and CSP browser run in their separately named lanes.',
  nativeExecutableHash: 'Target-local/compiler-dependent diagnostic; only uploaded binaries can be independently rehashed by a remote verifier.',
  generatedAt: new Date().toISOString(),
};
writeFileSync('artifacts/sdk-report.json', JSON.stringify(report, null, 2) + '\n');
console.log(`SDK native/WASM PASS: literals=${wasm.commands.literal_total}; catalog=${wasm.commands.catalog_total}; history=${wasm.commands.history_replays}; source hashes=${sources.length}; report=artifacts/sdk-report.json`);
