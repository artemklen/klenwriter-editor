// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync,
  readFileSync, readdirSync, realpathSync, rmdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const alphaVersion = '0.1.0-alpha.1';
const roles = ['wasm', 'sdk', 'dom', 'ui', 'kwdj', 'vanilla'];
const requiredFiles = ['package.json', 'dist/index.js', 'dist/index.d.ts',
  'LICENSE-MIT', 'LICENSE-APACHE', 'NOTICE', 'SOURCE-PROVENANCE.json'];
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sri = bytes => 'sha512-' + createHash('sha512').update(bytes).digest('base64');

function run(executable, args, cwd) {
  const result = spawnSync(executable, args, {
    cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, args.join(' ') + '\n' + result.stderr);
  return result.stdout;
}

export function pinnedNpmCli(workspace) {
  const { packageManager } = readJson(join(workspace, 'package.json'));
  const pinned = /^npm@(\d+\.\d+\.\d+)$/.exec(packageManager)?.[1];
  assert(pinned, 'Workspace must pin one npm CLI version');

  const directories = [dirname(process.execPath), ...(process.env.PATH ?? '').split(delimiter)];
  const candidates = [process.env.npm_execpath, ...directories.filter(Boolean).map(dir => join(dir, 'npm'))];
  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) continue;
    const cli = realpathSync(candidate);
    const metadata = resolve(dirname(cli), '../package.json');
    if (!existsSync(metadata)) continue;
    const { name, version } = readJson(metadata);
    if (name === 'npm' && version === pinned) return { cli, version };
  }
  throw new Error('Use the workspace npm pin ' + pinned);
}

function safeRelative(path) {
  return typeof path === 'string' && !isAbsolute(path) && !/[\\:\x00]/.test(path)
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

function assertPackagePath(path) {
  assert(safeRelative(path), 'Unsafe package path: ' + path);
  const parts = path.split('/');
  assert(!parts.some(part => ['node_modules', 'crates', 'packages', 'target', '.git'].includes(part)),
    'Checkout path in package: ' + path);
  assert(!parts.some(part => /^Cargo\.(?:toml|lock)$/i.test(part) || /\.rs$/i.test(part)),
    'Rust source in package: ' + path);
}

function copyMember(source, target, member) {
  assertPackagePath(member);
  const from = join(source, member);
  const to = join(target, member);
  assert.equal(realpathSync(from), from, 'Symbolic package path: ' + member);
  const info = lstatSync(from);
  if (info.isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from).sort()) copyMember(source, target, member + '/' + entry);
  } else {
    assert(info.isFile(), 'Expected a regular package file: ' + member);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
}

function exportPaths(exports) {
  if (typeof exports === 'string') {
    assert(exports.startsWith('./'), 'Expected package-relative exports');
    const member = exports.slice(2);
    assertPackagePath(member);
    return [member];
  }
  assert(exports && typeof exports === 'object' && !Array.isArray(exports), 'Expected conditional package exports');
  return Object.values(exports).flatMap(exportPaths);
}

function collectPackages(root) {
  const { web } = readJson(join(root, 'package-map.json'));
  const names = new Map(Object.entries(web).map(([role, item]) => [item.name, role]));
  const selected = new Map();
  const visit = role => {
    if (selected.has(role)) return;
    assert(roles.includes(role), 'Unexpected editor package in alpha closure: ' + role);
    const item = web[role];
    assert(safeRelative(item.path), 'Invalid workspace package path: ' + item.path);
    const directory = realpathSync(join(root, item.path));
    assert(relative(root, directory) === item.path.split('/').join(sep), 'Package directory is outside its declared location');
    const manifest = readJson(join(directory, 'package.json'));
    assert.equal(manifest.name, item.name);
    assert.equal(manifest.private, true, 'Registry publishing is outside the alpha pack scope');
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) {
      assert.equal(manifest.scripts?.[hook], undefined, 'Package requires a lifecycle hook: ' + manifest.name);
    }
    for (const field of ['peerDependencies', 'optionalDependencies', 'bundleDependencies', 'bundledDependencies']) {
      assert.equal(manifest[field], undefined, 'Review the changed package closure: ' + manifest.name + ' ' + field);
    }
    selected.set(role, { directory, manifest });
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      const dependencyRole = names.get(name);
      if (dependencyRole) visit(dependencyRole);
      else assert(role === 'kwdj' && name === 'parse5', 'Unexpected public dependency: ' + name);
    }
  };
  for (const entry of ['vanilla', 'kwdj']) visit(entry);
  assert.deepEqual([...selected.keys()].sort(), [...roles].sort());
  return { selected, names };
}

function parserPins(root, expectedVersion) {
  const { packages } = readJson(join(root, 'package-lock.json'));
  assert.equal(packages['node_modules/parse5'].version, expectedVersion, 'KWDJ must retain the exact locked parse5 pin');
  return ['parse5', 'entities'].map(name => {
    const { version, resolved, integrity } = packages['node_modules/' + name];
    assert.equal(resolved, 'https://registry.npmjs.org/' + name + '/-/' + name + '-' + version + '.tgz');
    assert.match(integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/);
    return { name, version, resolved, integrity };
  });
}

function stagePackage(staging, role, { directory, manifest }, names) {
  const stage = join(staging, role);
  mkdirSync(stage);
  assert(Array.isArray(manifest.files) && manifest.files.length > 0, 'Expected explicit package file roots');
  for (const path of manifest.files) copyMember(directory, stage, path);
  if (existsSync(join(directory, 'README.md'))) copyMember(directory, stage, 'README.md');
  const dependencies = Object.fromEntries(Object.entries(manifest.dependencies ?? {})
    .map(([name, version]) => [name, names.has(name) ? alphaVersion : version]));
  const stagedManifest = { ...manifest, version: alphaVersion, private: true, dependencies };
  writeFileSync(join(stage, 'package.json'), JSON.stringify(stagedManifest, null, 2) + '\n');
  return { stage, stagedManifest };
}

function inventory(record, manifest) {
  assert.equal(record.name, manifest.name);
  assert.equal(record.version, alphaVersion);
  assert.equal(record.entryCount, record.files.length);
  assert.equal(record.filename, manifest.name.slice(1).replace('/', '-') + '-' + alphaVersion + '.tgz');
  const members = new Map();
  for (const file of record.files) {
    assertPackagePath(file.path);
    assert(!members.has(file.path), 'Duplicate archive member: ' + file.path);
    members.set(file.path, file.size);
  }
  for (const file of [...requiredFiles, ...exportPaths(manifest.exports)]) {
    assert(members.has(file), manifest.name + ' is missing required member ' + file);
  }
  return [...members].sort(([a], [b]) => a.localeCompare(b));
}

function packPackage(npm, archives, role, stage, manifest) {
  const args = [npm.cli, 'pack', '--ignore-scripts', '--offline', '--json', '--pack-destination', archives];
  const [dry, ...extraDry] = JSON.parse(run(process.execPath, [...args, '--dry-run'], stage));
  assert.equal(extraDry.length, 0);
  const dryMembers = inventory(dry, manifest);
  const [packed, ...extraPacked] = JSON.parse(run(process.execPath, args, stage));
  assert.equal(extraPacked.length, 0);
  assert.deepEqual(inventory(packed, manifest), dryMembers);

  assert.equal(basename(packed.filename), packed.filename);
  const bytes = readFileSync(join(archives, packed.filename));
  assert.equal(packed.size, bytes.length);
  assert.equal(packed.integrity, sri(bytes));
  const files = dryMembers.map(([path, size]) => {
    const member = readFileSync(join(stage, path));
    assert.equal(member.length, size);
    return { path, bytes: size, sha256: sha256(member) };
  });
  return {
    role, name: manifest.name, version: manifest.version, filename: packed.filename,
    bytes: bytes.length, sha256: sha256(bytes), integrity: packed.integrity, dependencies: manifest.dependencies, files,
  };
}

export function cleanHead(root) {
  const revision = run('git', ['rev-parse', 'HEAD'], root).trim();
  assert.match(revision, /^[a-f0-9]{40}$/);
  assert.equal(run('git', ['status', '--porcelain'], root), '', 'Pack from a clean exact workspace revision');
  return revision;
}

async function verifyProducer(root) {
  const { computeSdkBuildIdentity } = await import(pathToFileURL(join(root, 'scripts/generate-sdk-types.mjs')));
  const identity = readJson(join(root, 'artifacts/sdk-build-identity.json'));
  assert.equal(identity.buildId, computeSdkBuildIdentity().buildId, 'Rebuild producer artifacts for the current SDK sources');
  const seal = readJson(join(root, 'artifacts/sdk-wasm-seal.json'));
  assert.equal(seal.build_id, identity.buildId);
  const wasm = readFileSync(join(root, 'packages/wasm/dist/editor_wasm_bg.wasm'));
  assert.equal(seal.sealed_sha256, sha256(wasm));
  assert.equal(seal.sealed_bytes, wasm.length);
  const glue = readFileSync(join(root, 'packages/wasm/dist/sdk-build-id.js'), 'utf8');
  assert(glue.includes('export const sdkBuildId = ' + JSON.stringify(identity.buildId) + ';'), 'Stale SDK glue version');
  return { sdkBuildId: identity.buildId, wasmSha256: seal.sealed_sha256 };
}

function publishLocal(archives, output, receipt) {
  mkdirSync(dirname(output), { recursive: true });
  // Reserve a new task-owned directory, preserving any prior artifact set.
  mkdirSync(output);
  const created = [];
  try {
    for (const { filename } of receipt.tarballs) {
      const destination = join(output, filename);
      copyFileSync(join(archives, filename), destination, constants.COPYFILE_EXCL);
      created.push(destination);
    }
    const path = join(output, 'pack-receipt.json');
    const descriptor = openSync(path, 'wx');
    created.push(path);
    try {
      writeFileSync(descriptor, JSON.stringify(receipt, null, 2) + '\n');
    } finally {
      closeSync(descriptor);
    }
  } catch (error) {
    for (const path of created) rmSync(path, { force: true });
    if (readdirSync(output).length === 0) rmdirSync(output);
    throw error;
  }
}

/** Pack verified build output. The consumer uses the immutable receipt plus the declared tarball files. */
export async function packVanillaAlpha(workspace, outputDirectory, expectedSourceSha) {
  const root = realpathSync(workspace);
  const output = resolve(outputDirectory);
  assert(!existsSync(output), 'Choose a fresh alpha output directory');
  const sourceSha = cleanHead(root);
  if (expectedSourceSha !== undefined) assert.equal(sourceSha, expectedSourceSha, 'Source changed during the producer build');
  const producer = await verifyProducer(root);
  const npm = pinnedNpmCli(root);
  const { selected, names } = collectPackages(root);
  const publicDependencies = parserPins(root, selected.get('kwdj').manifest.dependencies.parse5);

  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'kwe-alpha-pack-')));
  try {
    const placement = relative(root, scratch);
    assert(placement.startsWith('..' + sep) || isAbsolute(placement), 'Pack staging must be outside the workspace');
    const archives = join(scratch, 'archives');
    mkdirSync(archives);
    const tarballs = roles.map(role => {
      const { stage, stagedManifest } = stagePackage(scratch, role, selected.get(role), names);
      return packPackage(npm, archives, role, stage, stagedManifest);
    });
    const wasm = tarballs.find(item => item.role === 'wasm').files.find(file => file.path === 'dist/editor_wasm_bg.wasm');
    assert.equal(wasm?.sha256, producer.wasmSha256, 'Pack must contain the sealed producer WASM');
    assert.equal(cleanHead(root), sourceSha, 'Source changed while packaging');
    const receipt = {
      format: 'klenwriter-editor-vanilla-alpha-pack/1', sourceSha, ...producer, version: alphaVersion,
      nodeVersion: process.version, npmVersion: npm.version, publicDependencies, tarballs,
    };
    publishLocal(archives, output, receipt);
    return receipt;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
