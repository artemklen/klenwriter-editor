import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeDependencyNotices } from './dependency-notices.mjs';
import { identity } from './package-identity.mjs';

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
run('cargo', ['build', '--workspace', '--locked', '--release']);
run('cargo', ['build', '--workspace', '--locked', '--release', '--target', 'wasm32-unknown-unknown']);
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
writeDependencyNotices();
// Clean all emitted package files so stale declarations/assets cannot mask omissions.
const packages = ['wasm', 'sdk', 'dom', 'kwdj', 'vanilla', 'angular'];
for (const name of packages) {
  rmSync(`packages/${name}/dist`, { recursive: true, force: true });
  rmSync(`packages/${name}/tsconfig.tsbuildinfo`, { force: true });
}
run(process.execPath, ['node_modules/typescript/bin/tsc', '-b', '--force']);
run(bindgen, [`target/wasm32-unknown-unknown/release/${identity.rust.wasm.name.replaceAll('-', '_')}.wasm`,
  '--target', 'web', '--out-dir', 'packages/wasm/dist', '--out-name', 'editor_wasm']);
copyFileSync('packages/dom/src/style.css', 'packages/dom/dist/style.css');
mkdirSync('artifacts', { recursive: true });
// Input to a separate native/WASM agreement check; not a semantic parity claim.
run('cargo', ['run', '--locked', '--quiet', '-p', identity.rust.wasm.name, '--example', 'build_info']);
// Keep the documented toolchain contract in step with the artifact builder.
const manifest = readFileSync('rust-toolchain.toml', 'utf8');
if (!manifest.includes('channel = "1.97.1"')) throw new Error('Update the build/toolchain contract together');
