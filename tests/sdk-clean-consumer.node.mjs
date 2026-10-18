import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sha512 = bytes => createHash('sha512').update(bytes).digest('base64');
const selected = ['wasm', 'sdk', 'kwdj'];

function npmCli() {
  if (process.env.npm_execpath && existsSync(process.env.npm_execpath)) return realpathSync(process.env.npm_execpath);
  for (const directory of [dirname(process.execPath), ...(process.env.PATH ?? '').split(delimiter)]) {
    const candidate = join(directory, 'npm');
    if (existsSync(candidate)) return realpathSync(candidate);
  }
  throw new Error('Actual npm CLI path required for clean-consumer preparation');
}

test('packed SDK/wasm/KWDJ execute real Session with cargo and rustc absent from child PATH', () => {
  const inventory = JSON.parse(readFileSync(resolve(root, 'artifacts/package-inventory.json'), 'utf8'));
  const packages = selected.map(role => {
    const name = `@klenwriter/editor-${role}`;
    const rows = inventory.filter(pkg => pkg.name === name);
    assert.equal(rows.length, 1, `actual packed inventory for ${name}`);
    const record = rows[0]; const path = resolve(root, 'artifacts/packages', record.filename);
    const bytes = readFileSync(path);
    assert.equal(record.integrity, `sha512-${sha512(bytes)}`);
    const source = JSON.parse(readFileSync(resolve(root, `packages/${role}/package.json`), 'utf8'));
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) assert.equal(source.scripts?.[hook], undefined, `${name} has no consumer build hook`);
    return { role, name, path, sha256: hash(bytes), bytes: bytes.length, inventory: record };
  });
  const directory = mkdtempSync(join(tmpdir(), 'editor-sdk-consumer-'));
  const emptyPath = join(directory, 'no-executables'); mkdirSync(emptyPath);
  const environment = { ...process.env, PATH: emptyPath, npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false' };
  delete environment.NODE_PATH; delete environment.NODE_OPTIONS;
  const npm = npmCli();
  try {
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }) + '\n');
    const install = spawnSync(process.execPath, [npm, 'install', '--prefix', directory, '--offline',
      '--ignore-scripts', '--no-audit', '--no-fund', ...packages.map(pkg => pkg.path)],
    { cwd: directory, env: environment, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(install.status, 0, `${install.error ?? ''}\n${install.stderr}\n${install.stdout}`);
    const installed = [];
    for (const pkg of packages) {
      for (const entry of pkg.inventory.files.filter(file => file.path.startsWith('dist/'))) {
        const bytes = readFileSync(join(directory, 'node_modules', pkg.name, entry.path));
        const producer = readFileSync(resolve(root, 'packages', pkg.role, entry.path));
        assert.deepEqual(bytes, producer, `${pkg.name}/${entry.path} equals actual producer artifact`);
        installed.push({ package: pkg.name, file: entry.path, bytes: bytes.length, sha256: hash(bytes) });
      }
    }
    const scenario = readFileSync(resolve(root, 'spikes/workspace/sdk-scenario.js'));
    writeFileSync(join(directory, 'scenario.mjs'), scenario);
    const program = `
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createEditor, loadSdk, sdkBuildId } from '@klenwriter/editor-sdk';
import { kwdjCommand } from '@klenwriter/editor-kwdj';
import { exercisePackagedSdk } from './scenario.mjs';
const missingTools = {};
for (const name of ['cargo', 'rustc']) {
  const result = spawnSync(name, ['--version'], { encoding: 'utf8' });
  assert.equal(result.error?.code, 'ENOENT'); missingTools[name] = result.error.code;
}
const wasm = readFileSync(new URL(import.meta.resolve('@klenwriter/editor-wasm/artifact.wasm')));
const module = await loadSdk({ wasm });
assert.equal(module.manifest.build_id, sdkBuildId);
const report = await exercisePackagedSdk({ createEditor, kwdjCommand, module, loader: () => Promise.resolve(module) }, 12);
process.stdout.write(JSON.stringify({ ...report, missingTools, wasmSha256: createHash('sha256').update(wasm).digest('hex'),
  cwdOutsideCheckout: !process.cwd().startsWith(${JSON.stringify(root)}), hooksDisabled: process.env.npm_config_ignore_scripts === 'true' }) + '\\n');
`;
    writeFileSync(join(directory, 'consumer.mjs'), program);
    const child = spawnSync(process.execPath, [join(directory, 'consumer.mjs')], {
      cwd: directory, env: environment, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(child.status, 0, `${child.error ?? ''}\n${child.stderr}\n${child.stdout}`);
    const result = JSON.parse(child.stdout);
    assert.equal(result.status, 'passed'); assert.equal(result.cycles, 12);
    assert.deepEqual(result.missingTools, { cargo: 'ENOENT', rustc: 'ENOENT' });
    assert.equal(result.cwdOutsideCheckout, true); assert.equal(result.hooksDisabled, true);
    assert.equal(result.build_id, JSON.parse(readFileSync(resolve(root, 'artifacts/sdk-build-identity.json'), 'utf8')).buildId);
    assert.equal(result.wasmSha256, hash(readFileSync(resolve(root, 'packages/wasm/dist/editor_wasm_bg.wasm'))));
    mkdirSync(resolve(root, 'artifacts'), { recursive: true });
    writeFileSync(resolve(root, 'artifacts/sdk-clean-consumer-report.json'), JSON.stringify({
      format: 'klenwriter-editor-sdk-clean-consumer/1', status: 'passed',
      install: { exitCode: install.status, offline: true, ignoreScripts: true, npmCli: npm, nodeExecutable: process.execPath },
      execution: { exitCode: child.status, pathContainsNoExecutables: true },
      tarballs: packages.map(({ inventory, ...value }) => value), installedArtifactHashes: installed,
      scenarioSha256: hash(scenario), report: result,
      scope: 'Three actual packed private tarballs installed into a fresh external JS project. Child PATH has no cargo/rustc; no claim that tools were uninstalled globally. Real headless Session, no renderer/CMS/registry claim.',
    }, null, 2) + '\n');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
