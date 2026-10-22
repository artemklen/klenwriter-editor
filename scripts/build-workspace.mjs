import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeDependencyNotices } from './dependency-notices.mjs';
import { identity } from './package-identity.mjs';
import { sealPackagedSdkWasm } from './seal-sdk-wasm.mjs';
import { computeSdkBuildIdentity, generateSdkTypes, writeSdkBuildIdentity, writeSdkGeneratorInventory } from './generate-sdk-types.mjs';
import { generateDomInventory } from './generate-dom-inventory.mjs';
import { defaultSdkDistribution, defaultSdkCargoFeatures } from './sdk-distribution.mjs';
import { buildExtensionConsumers } from './build-extensions-consumers.mjs';
import { buildClipboardParser } from './build-clipboard-parser.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
const bindgen = resolve('.tools/bin/wasm-bindgen');
const rust = spawnSync('rustc', ['--version'], { encoding: 'utf8' });
if (rust.status !== 0 || !rust.stdout.startsWith('rustc 1.97.1 ')) {
  throw new Error('Use the pinned Rust 1.97.1 toolchain; remove a conflicting RUSTUP_TOOLCHAIN override');
}
const version = spawnSync(bindgen, ['--version'], { encoding: 'utf8' });
if (version.status !== 0 || version.stdout.trim() !== 'wasm-bindgen 0.2.129') {
  throw new Error('Install the pinned CLI: cargo install wasm-bindgen-cli --version 0.2.129 --locked --root .tools');
}
// Native registry witnesses are versioned and checked before build identity.
generateDomInventory({ check: true });
// Declarations are versioned; stale output refuses rather than silently changing source.
generateSdkTypes({ check: true });
writeSdkGeneratorInventory();
const sdkIdentity = writeSdkBuildIdentity();
process.env.KLENWRITER_EDITOR_SDK_BUILD_ID = sdkIdentity.buildId;
run('cargo', ['build', '--workspace', '--locked', '--release', ...defaultSdkCargoFeatures]);
run('cargo', ['build', '--workspace', '--locked', '--release', '--target', 'wasm32-unknown-unknown', ...defaultSdkCargoFeatures]);
// Test-only WASM module: exercises the same Rust budget cases as native tests.
// Kept outside distributable package dist and installed consumer APIs.
run('cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown',
  '-p', identity.rust.wasm.name, '--example', 'projection_budget_probe']);
run(bindgen, ['target/wasm32-unknown-unknown/release/examples/projection_budget_probe.wasm',
  '--target', 'web', '--out-dir', 'artifacts/projection-budget', '--out-name', 'probe']);
run('cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown',
  '-p', identity.rust.wasm.name, '--example', 'admission_budget_probe']);
run(bindgen, ['target/wasm32-unknown-unknown/release/examples/admission_budget_probe.wasm',
  '--target', 'web', '--out-dir', 'artifacts/admission-budget', '--out-name', 'probe']);
// Trusted test-only corpus/projection observer, never copied into npm dist.
run('cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown',
  '-p', identity.rust.wasm.name, '--example', 'corpus_probe']);
run(bindgen, ['target/wasm32-unknown-unknown/release/examples/corpus_probe.wasm',
  '--target', 'web', '--out-dir', 'artifacts/corpus-observer', '--out-name', 'probe']);
// Session foundation proof invokes the real generic engine + KWDJ profile.
// It remains a test-only module outside all distributable package dist paths.
run('cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown',
  '-p', identity.rust.wasm.name, '--example', 'session_probe']);
run(bindgen, ['target/wasm32-unknown-unknown/release/examples/session_probe.wasm',
  '--target', 'web', '--out-dir', 'artifacts/session-foundation', '--out-name', 'probe']);
// Atomic transaction composition uses the same real profile and engine on both
// targets, outside the installed codec/SDK surface.
run('cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown',
  '-p', identity.rust.wasm.name, '--example', 'transaction_probe']);
run(bindgen, ['target/wasm32-unknown-unknown/release/examples/transaction_probe.wasm',
  '--target', 'web', '--out-dir', 'artifacts/transactions', '--out-name', 'probe']);
// Command capabilities run the same publication-free prepare and real execute.
// This observer is test-only and never enters npm dist.
run('cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown',
  '-p', identity.rust.wasm.name, '--example', 'command_probe']);
run(bindgen, ['target/wasm32-unknown-unknown/release/examples/command_probe.wasm',
  '--target', 'web', '--out-dir', 'artifacts/commands', '--out-name', 'probe']);
// History shares actual production replay on native and wasm32. The observer
// stays outside distributable packages and exposes no restore authority.
run('cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown',
  '-p', identity.rust.wasm.name, '--example', 'history_probe']);
run(bindgen, ['target/wasm32-unknown-unknown/release/examples/history_probe.wasm',
  '--target', 'web', '--out-dir', 'artifacts/history', '--out-name', 'probe']);
// Public Session DTO witness: actual native/WASM bridge and independent literals.
// The probe stays outside distributed npm assets.
run('cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown',
  '-p', identity.rust.wasm.name, '--example', 'sdk_probe']);
run(bindgen, ['target/wasm32-unknown-unknown/release/examples/sdk_probe.wasm',
  '--target', 'web', '--out-dir', 'artifacts/sdk', '--out-name', 'probe']);
// Independent external consumers compile only the chosen public profile module.
// Their explicit module choices and complete fixture bytes have separate IDs.
await buildExtensionConsumers({ baseBuildId: sdkIdentity.buildId, baseSourceHashes: sdkIdentity.sourceHashes });
writeDependencyNotices();
// Clean all emitted package files so stale declarations/assets cannot mask omissions.
const packages = ['wasm', 'sdk', 'dom', 'kwdj', 'vanilla', 'angular', 'ui'];
for (const name of packages) {
  rmSync(`packages/${name}/dist`, { recursive: true, force: true });
  rmSync(`packages/${name}/tsconfig.tsbuildinfo`, { force: true });
}
run(process.execPath, ['node_modules/typescript/bin/tsc', '-b', '--force']);
await buildClipboardParser();
run(bindgen, [`target/wasm32-unknown-unknown/release/${identity.rust.wasm.name.replaceAll('-', '_')}.wasm`,
  '--target', 'web', '--out-dir', 'packages/wasm/dist', '--out-name', 'editor_wasm']);
// Native manifest is compiled with the same source ID as this exact WASM build.
const sdkManifestRun = spawnSync('cargo', ['run', '--locked', '--quiet', '-p', identity.rust.wasm.name,
  '--example', 'sdk_manifest'], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
if (sdkManifestRun.error) throw sdkManifestRun.error;
if (sdkManifestRun.status !== 0) throw new Error(`Native SDK manifest failed: ${sdkManifestRun.stderr}`);
const sdkNativeManifest = JSON.parse(sdkManifestRun.stdout);
const sdkManifestV2Run = spawnSync('cargo', ['run', '--locked', '--quiet', '-p', identity.rust.wasm.name,
  ...defaultSdkCargoFeatures, '--example', 'sdk_manifest_v2'], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
if (sdkManifestV2Run.error) throw sdkManifestV2Run.error;
if (sdkManifestV2Run.status !== 0) throw new Error(`Native SDK V2 manifest failed: ${sdkManifestV2Run.stderr}`);
const sdkNativeManifestV2 = JSON.parse(sdkManifestV2Run.stdout);
if (sdkNativeManifestV2.abi !== 'editor-sdk/2' || sdkNativeManifestV2.build_id !== sdkIdentity.buildId
    || JSON.stringify(sdkNativeManifestV2.profiles.map(profile => profile.profile_id).sort()) !== JSON.stringify(defaultSdkDistribution.compiledProfileIds)) {
  throw new Error('Actual native compiled module offer differs from the hashed distribution choice');
}
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/sdk-native-manifest.json', JSON.stringify(sdkNativeManifest, null, 2) + '\n');
writeFileSync('artifacts/sdk-native-manifest-v2.json', JSON.stringify(sdkNativeManifestV2, null, 2) + '\n');
sealPackagedSdkWasm('packages/wasm/dist/editor_wasm_bg.wasm', sdkNativeManifest, sdkIdentity.buildId);
// Actual post-seal Rust manifest must match native before any tarball can be produced.
run(process.execPath, ['--input-type=module', '-e', `
  import assert from 'node:assert/strict';
  import { readFileSync } from 'node:fs';
  import { loadSdk, loadSdkV2 } from './packages/wasm/dist/index.js';
  const actual = await loadSdk({ wasm: readFileSync('packages/wasm/dist/editor_wasm_bg.wasm') });
  assert.deepEqual(actual.manifest, JSON.parse(readFileSync('artifacts/sdk-native-manifest.json','utf8')));
  const v2 = await loadSdkV2({ wasm: readFileSync('packages/wasm/dist/editor_wasm_bg.wasm') });
  assert.deepEqual(v2.manifest, JSON.parse(readFileSync('artifacts/sdk-native-manifest-v2.json','utf8')));
  assert.deepEqual(JSON.parse(actual.resourceCounts()), {sessions:0,snapshot_handles:0,snapshot_bytes:'0',protected_cursors:0});
  console.log('SDK packaged seal/native/WASM manifest agreement PASS before Session admission');
`]);
// Exact final producer copies are uploaded by artifacts/** for remote verification.
mkdirSync('artifacts/sdk-distribution', { recursive: true });
for (const name of ['editor_wasm.js', 'editor_wasm_bg.wasm', 'sdk-types.d.ts', 'sdk-types-v2.d.ts', 'sdk-build-id.js']) {
  copyFileSync(`packages/wasm/dist/${name}`, `artifacts/sdk-distribution/${name}`);
}
copyFileSync('artifacts/sdk-native-manifest.json', 'artifacts/sdk-distribution/sdk-native-manifest.json');
copyFileSync('artifacts/sdk-native-manifest-v2.json', 'artifacts/sdk-distribution/sdk-native-manifest-v2.json');
copyFileSync('packages/dom/src/style.css', 'packages/dom/dist/style.css');
copyFileSync('packages/ui/src/style.css', 'packages/ui/dist/style.css');
mkdirSync('artifacts', { recursive: true });
// Input to a separate native/WASM agreement check; not a semantic parity claim.
run('cargo', ['run', '--locked', '--quiet', '-p', identity.rust.wasm.name, '--example', 'build_info']);
// Keep the documented toolchain contract in step with the artifact builder.
const manifest = readFileSync('rust-toolchain.toml', 'utf8');
if (!manifest.includes('channel = "1.97.1"')) throw new Error('Update the build/toolchain contract together');

// A changed production input during compilation must not leave a publishable mixed wrapper/module.
if (computeSdkBuildIdentity().buildId !== sdkIdentity.buildId) {
  throw new Error("SDK production sources changed during build; rebuild the frozen source");
}
