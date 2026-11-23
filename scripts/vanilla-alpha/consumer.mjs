// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinnedNpmCli } from './pack.mjs';

const json = file => JSON.parse(readFileSync(file, 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const integrity = bytes => 'sha512-' + createHash('sha512').update(bytes).digest('base64');

function inside(base, target) {
  const path = relative(base, target);
  return path !== '' && path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
}

function execute(command, args, directory, environment) {
  const result = spawnSync(command, args, {
    cwd: directory, env: environment, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.status, 0, [result.error?.message, result.stderr, result.stdout].filter(Boolean).join('\n'));
  return result.stdout;
}

function copyVendor(bundle, workspace, tarballs) {
  const vendor = join(workspace, 'vendor');
  mkdirSync(vendor);
  const dependencies = {};
  for (const pack of tarballs) {
    assert.equal(basename(pack.filename), pack.filename);
    assert.match(pack.filename, /^[a-z0-9][a-z0-9.-]+\.tgz$/u);
    assert(!Object.hasOwn(dependencies, pack.name), 'Each delivered package appears once');
    const archive = join(bundle, pack.filename);
    const bytes = readFileSync(archive);
    assert.equal(bytes.length, pack.bytes);
    assert.equal(sha256(bytes), pack.sha256);
    assert.equal(integrity(bytes), pack.integrity);
    copyFileSync(archive, join(vendor, pack.filename));
    dependencies[pack.name] = 'file:./vendor/' + pack.filename;
  }
  return dependencies;
}

function verifyInstall(directory, dependencies, receipt) {
  const lockPath = join(directory, 'package-lock.json');
  const lock = json(lockPath);
  const editorPackages = receipt.tarballs.map(pack => 'node_modules/' + pack.name);
  const parsers = receipt.publicDependencies.map(pack => 'node_modules/' + pack.name);
  assert.deepEqual(Object.keys(lock.packages).sort(), ['', ...editorPackages, ...parsers].sort());
  assert.deepEqual(lock.packages[''].dependencies, dependencies);

  for (const pack of receipt.tarballs) {
    const path = join(directory, 'node_modules', pack.name);
    assert.equal(realpathSync(path), path, pack.name + ' is materialized from its local tarball');
    const record = lock.packages['node_modules/' + pack.name];
    assert.equal(record.version, pack.version);
    assert.equal(record.integrity, pack.integrity);
    assert(record.resolved.startsWith('file:'));
    assert.equal(resolve(directory, record.resolved.slice('file:'.length)), join(directory, 'vendor', pack.filename));
    const manifest = json(join(path, 'package.json'));
    assert.equal(manifest.name, pack.name);
    assert.equal(manifest.version, pack.version);
    assert.deepEqual(manifest.dependencies ?? {}, pack.dependencies);
    for (const member of pack.files) {
      const target = realpathSync(join(path, member.path));
      assert(inside(path, target));
      const bytes = readFileSync(target);
      assert.equal(bytes.length, member.bytes, pack.name + '/' + member.path);
      assert.equal(sha256(bytes), member.sha256, pack.name + '/' + member.path);
    }
  }

  for (const parser of receipt.publicDependencies) {
    const actual = lock.packages['node_modules/' + parser.name];
    for (const key of ['version', 'resolved', 'integrity']) assert.equal(actual[key], parser[key], parser.name + ' ' + key);
  }
  return sha256(readFileSync(lockPath));
}

export function installAlphaConsumer(workspace, bundleDirectory, expectedDependencies) {
  const root = realpathSync(workspace);
  const bundle = realpathSync(bundleDirectory);
  const receipt = json(join(bundle, 'pack-receipt.json'));
  assert.equal(receipt.format, 'klenwriter-editor-vanilla-alpha-pack/1');
  assert.match(receipt.sourceSha, /^[a-f0-9]{40}$/u);
  assert.match(receipt.sdkBuildId, /^sha256:[a-f0-9]{64}$/u);
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'kwe-alpha-consumer-')));
  const cleanup = () => rmSync(directory, { recursive: true, force: true });
  try {
    assert(directory !== root && !inside(root, directory), 'Clean install must live outside the source checkout');
    const dependencies = copyVendor(bundle, directory, receipt.tarballs);
    if (expectedDependencies !== undefined) assert.deepEqual(dependencies, expectedDependencies);
    const emptyPath = join(directory, 'no-tools');
    const config = join(directory, 'empty-npmrc');
    mkdirSync(emptyPath);
    writeFileSync(config, '');
    const environment = { ...process.env, PATH: emptyPath };
    delete environment.NODE_OPTIONS;
    delete environment.NODE_PATH;
    const absentTools = {};
    for (const tool of ['cargo', 'rustc']) {
      const result = spawnSync(tool, ['--version'], { cwd: directory, env: environment });
      assert.equal(result.error?.code, 'ENOENT');
      absentTools[tool] = result.error.code;
    }

    const overrides = Object.fromEntries(receipt.publicDependencies.map(pack => [pack.name, pack.version]));
    writeFileSync(join(directory, 'package.json'), JSON.stringify({
      private: true, type: 'module', dependencies, overrides,
    }, null, 2) + '\n');
    const npm = pinnedNpmCli(root);
    execute(process.execPath, [npm.cli, 'install', '--prefer-offline', '--ignore-scripts',
      '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org', '--userconfig', config],
    directory, environment);
    const lockSha256 = verifyInstall(directory, dependencies, receipt);
    return { directory, receipt, environment, absentTools, npmVersion: npm.version, lockSha256, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

export function publicAssets(consumer, specifiers) {
  const resolved = JSON.parse(execute(process.execPath, ['--input-type=module', '--eval',
    'const names = JSON.parse(process.argv[1]); console.log(JSON.stringify(Object.fromEntries(names.map(name => [name, import.meta.resolve(name)]))));',
    JSON.stringify(specifiers),
  ], consumer.directory, consumer.environment));
  return Object.fromEntries(Object.entries(resolved).map(([specifier, url]) => {
    const path = fileURLToPath(url);
    assert(inside(join(consumer.directory, 'node_modules'), realpathSync(path)), specifier);
    return [specifier, path];
  }));
}

export function buildConsumerModule(consumer, entry, output) {
  const executable = fileURLToPath(import.meta.resolve('esbuild/bin/esbuild'));
  execute(process.execPath, [
    executable, entry, '--bundle', '--format=esm', '--packages=external',
    '--outfile=' + output, '--log-level=error',
  ], consumer.directory, consumer.environment);
  const built = readFileSync(output);
  return { bytes: built.length, sha256: sha256(built) };
}
