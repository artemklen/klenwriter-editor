// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeSdkBuildIdentity } from '../../scripts/generate-sdk-types.mjs';
import { publicAssets } from '../../scripts/vanilla-alpha/consumer.mjs';
import { pinnedNpmCli } from '../../scripts/vanilla-alpha/pack.mjs';

const example = fileURLToPath(new URL('./', import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));
const read = path => readFileSync(path, 'utf8');
const json = path => JSON.parse(read(path));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sri = bytes => 'sha512-' + createHash('sha512').update(bytes).digest('base64');

function notesPacket() {
  const notes = join(root, 'contracts/notes/v1');
  const extension = json(join(notes, 'extension-command/vectors.json'));
  const registryJson = { D0: read(join(example, 'd0.json')), D1: read(join(example, 'd1.json')) };
  return {
    registryJson,
    registries: { D0: JSON.parse(registryJson.D0), D1: JSON.parse(registryJson.D1) },
    codec: json(join(notes, 'vectors.json')).cases.map(test => ({
      ...test,
      input: read(join(notes, test.input)),
      ...(test.expected.canonical ? { canonical: read(join(notes, test.expected.canonical)) } : {}),
    })),
    commands: json(join(notes, 'commands/vectors.json')).cases,
    extension: {
      ...extension,
      initial: read(join(notes, 'extension-command', extension.expected.initial)),
      after: read(join(notes, 'extension-command', extension.expected.after)),
    },
  };
}

assert.equal(process.argv.length, 2, 'Run this example after npm run check:packages');
const { versions, web } = json(join(root, 'package-map.json'));
const inventory = json(join(root, 'artifacts/package-inventory.json'));
const directory = realpathSync(mkdtempSync(join(tmpdir(), 'kwe-extension-consumer-')));
assert(!directory.startsWith(realpathSync(root) + '/'));
const npm = pinnedNpmCli(root);
const environment = { ...process.env, PATH: join(directory, 'no-executables') };
delete environment.NODE_PATH;
delete environment.NODE_OPTIONS;
const npmCommand = (cwd, args) => execFileSync(process.execPath, [npm.cli, ...args], { cwd, env: environment, encoding: 'utf8' });
try {
  const vendor = join(directory, 'vendor');
  const notes = join(directory, 'notes-package-source');
  mkdirSync(vendor);
  mkdirSync(notes);
  for (const name of ['package.json', 'd0.json', 'd1.json', 'dom.mjs', 'dom-inventory.mjs']) {
    copyFileSync(join(example, name), join(notes, name));
  }
  const [extension] = JSON.parse(npmCommand(notes, ['pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', vendor]));
  const editorPackages = ['wasm', 'sdk', 'dom'].map(role => {
    const name = web[role].name;
    const record = inventory.find(pack => pack.name === name);
    assert(record, 'Missing checked package archive for ' + name);
    copyFileSync(join(root, 'artifacts/packages', record.filename), join(vendor, record.filename));
    return record;
  });
  const archives = [...editorPackages, extension].map(pack => {
    const file = join(vendor, pack.filename);
    const bytes = readFileSync(file);
    assert.equal(pack.version, versions.packageSemver);
    assert.equal(sri(bytes), pack.integrity);
    return { name: pack.name, version: pack.version, file, sha256: sha(bytes), integrity: pack.integrity };
  });
  assert.equal(extension.name, '@example/notes-extension');

  writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  npmCommand(directory, ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', ...archives.map(pack => pack.file)]);
  const lock = json(join(directory, 'package-lock.json'));
  assert.deepEqual(Object.keys(lock.packages).sort(), ['', ...archives.map(pack => 'node_modules/' + pack.name)].sort());
  for (const pack of archives) {
    const installed = join(directory, 'node_modules', pack.name);
    assert.equal(realpathSync(installed), installed);
    const entry = lock.packages['node_modules/' + pack.name];
    assert.equal(entry.version, pack.version);
    assert.equal(entry.integrity, pack.integrity);
    assert(entry.resolved.startsWith('file:'));
    assert.equal(resolve(directory, entry.resolved.slice('file:'.length)), pack.file);
  }

  for (const name of ['save-reopen.mjs', 'testkit.mjs']) copyFileSync(join(example, name), join(directory, name));
  writeFileSync(join(directory, 'packet.json'), JSON.stringify(notesPacket()));
  const usedExports = [
    '@klenwriter/editor-sdk', '@klenwriter/editor-wasm/artifact.wasm',
    '@example/notes-extension/d0.json', '@example/notes-extension/d1.json',
  ];
  const publicImports = Object.keys(publicAssets({ directory, environment }, usedExports));
  const exampleResult = JSON.parse(execFileSync(process.execPath, ['save-reopen.mjs'], {
    cwd: directory, env: environment, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8',
  }));
  assert.equal(exampleResult.result, 'PASS');
  assert.equal(exampleResult.buildId, computeSdkBuildIdentity().buildId, 'Packages must match the production inputs');
  const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  console.log(JSON.stringify({
    source,
    npm: npm.version,
    node: process.version,
    imports: publicImports,
    archives: archives.map(({ name, version, sha256 }) => ({ name, version, sha256 })),
    ...exampleResult,
  }, null, 2));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
