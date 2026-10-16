import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const target = process.env.OSR61_CARGO_TARGET || '/tmp/osr61-cargo-target';
const version = execFileSync('rustup', ['run', 'stable', 'rustc', '--version'], { encoding: 'utf8' }).trim();
if (!version.startsWith('rustc 1.97.1 ')) throw new Error(`Calibration requires recorded rustc 1.97.1; found ${version}`);
execFileSync('rustup', ['run', 'stable', 'cargo', 'build', '--release', '--locked', '--target', 'wasm32-unknown-unknown', '--manifest-path', `${root}/scripts/m0-perf/kernel/Cargo.toml`], {
  stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: target },
});
mkdirSync(`${root}/spikes/performance`, { recursive: true });
copyFileSync(`${target}/wasm32-unknown-unknown/release/m0_string_calibration.wasm`, `${root}/spikes/performance/kernel.wasm`);
