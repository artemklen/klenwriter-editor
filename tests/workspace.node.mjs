import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { capturedSourceHash } from '../scripts/m0-perf/source-integrity.mjs';
import { identity } from '../scripts/package-identity.mjs';

test('calibration verifies the historical lock and detects tampering independently of workspace updates', () => {
  const root = mkdtempSync(join(tmpdir(), 'editor-calibration-'));
  try {
    mkdirSync(join(root, 'evidence/osr-61/sources'), { recursive: true });
    const original = readFileSync('evidence/osr-61/sources/package-lock.json');
    const snapshot = join(root, 'evidence/osr-61/sources/package-lock.json');
    const expected = JSON.parse(readFileSync('evidence/osr-61/metadata.json')).sourceHashes['package-lock.json'];
    writeFileSync(snapshot, original);
    writeFileSync(join(root, 'package-lock.json'), 'new workspace lock');
    assert.equal(capturedSourceHash(root, 'package-lock.json'), expected);
    writeFileSync(snapshot, 'tampered snapshot');
    assert.notEqual(capturedSourceHash(root, 'package-lock.json'), expected);
    // Changes to a measured kernel source are not hidden by the lock archive.
    writeFileSync(join(root, 'kernel.rs'), 'original kernel');
    const before = capturedSourceHash(root, 'kernel.rs');
    writeFileSync(join(root, 'kernel.rs'), 'changed kernel');
    assert.notEqual(capturedSourceHash(root, 'kernel.rs'), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('web artifact initializes from bytes and agrees with native Rust build identity', async () => {
  const { default: init, buildInfo } = await import('../packages/wasm/dist/editor_wasm.js');
  await init({ module_or_path: readFileSync('packages/wasm/dist/editor_wasm_bg.wasm') });
  const info = buildInfo();
  assert.equal(Object.getPrototypeOf(info), Object.prototype);
  assert.deepEqual(info, JSON.parse(readFileSync('artifacts/native-build-info.json', 'utf8')));
  assert.equal(info.stage, 'workspace-bootstrap');
});

test('all packed JS boundaries install in an external project with no checkout/toolchain dependency', () => {
  const dir = mkdtempSync(join(tmpdir(), 'editor-consumer-'));
  try {
    const inventory = JSON.parse(readFileSync('artifacts/package-inventory.json', 'utf8'));
    const paths = inventory.map(pkg => resolve('artifacts/packages', pkg.filename));
    const install = spawnSync('npm', ['install', '--prefix', dir, '--ignore-scripts', '--no-audit', '--no-fund', ...paths], { encoding: 'utf8' });
    assert.equal(install.status, 0, install.stderr);
    const program = `
      import assert from 'node:assert/strict';
      import { readFileSync } from 'node:fs';
      for (const name of ${JSON.stringify(['sdk','dom','kwdj','vanilla','angular','ui'].map(id => identity.web[id].name))}) {
        const pkg = await import(name);
        assert.equal(pkg.artifactStage, 'workspace-bootstrap');
      }
      const wasm = await import('@klenwriter/editor-wasm/artifact');
      await wasm.default({ module_or_path: readFileSync(new URL(import.meta.resolve('@klenwriter/editor-wasm/artifact.wasm'))) });
      assert.equal(wasm.buildInfo().stage, 'workspace-bootstrap');
      assert.match(readFileSync(new URL(import.meta.resolve('@klenwriter/editor-dom/style.css')), 'utf8'), /:focus-visible/);
      assert.match(readFileSync(new URL(import.meta.resolve('@klenwriter/editor-ui/style.css')), 'utf8'), /:focus-visible/);
      const ui = await import('@klenwriter/editor-ui');
      assert.equal(typeof ui.createEditorUi, 'function');
      assert.equal(typeof ui.defineUiHostAction, 'function');
    `;
    const consumer = join(dir, 'consumer.mjs');
    writeFileSync(consumer, program);
    const check = spawnSync(process.execPath, [consumer], { cwd: dir, encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an external native consumer compiles core/profile without a browser or CMS dependency', () => {
  const dir = mkdtempSync(join(tmpdir(), 'editor-native-consumer-'));
  try {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'Cargo.toml'), `[package]
name = "editor-native-consumer"
version = "0.0.0"
edition = "2024"
[dependencies]
klenwriter-editor-core = { path = ${JSON.stringify(resolve('crates/core'))} }
klenwriter-editor-kwdj = { path = ${JSON.stringify(resolve('crates/kwdj'))} }
`);
    writeFileSync(join(dir, 'src/main.rs'), 'fn main() { println!("{} {}", klenwriter_editor_core::PACKAGE_VERSION, klenwriter_editor_kwdj::PROFILE_ID); }');
    const result = spawnSync('cargo', ['+1.97.1', 'run', '--offline', '--quiet', '--manifest-path', join(dir, 'Cargo.toml')], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, CARGO_TARGET_DIR: join(dir, 'target') },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '0.0.0 org.klenwriter.kwdj');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
