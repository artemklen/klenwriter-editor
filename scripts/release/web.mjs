// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { pinnedNpmCli } from '../vanilla-alpha/pack.mjs';

const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const requiredMembers = ['package.json', 'dist/index.js', 'dist/index.d.ts',
  'LICENSE-MIT', 'LICENSE-APACHE', 'NOTICE', 'SOURCE-PROVENANCE.json'];
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const digest = (algorithm, bytes, encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);

function assertMember(path) {
  const disallowed = /^(?:\.{1,2}|node_modules|packages|crates|target|\.git|\.npmrc|\.env(?:\..*)?|package-lock\.json|npm-shrinkwrap\.json|Cargo\.(?:toml|lock))$|\.rs$/iu;
  assert(path.split('/').every(part => part && !disallowed.test(part)) && !/[\\:\x00]/u.test(path),
    'Unsafe npm archive member: ' + path);
}

function exportTargets(exports) {
  if (typeof exports === 'string') {
    assert(exports.startsWith('./'), 'Exports must use package-relative paths');
    const member = exports.slice(2);
    assertMember(member);
    return [member];
  }
  assert(exports && typeof exports === 'object' && !Array.isArray(exports), 'Expected explicit package exports');
  return Object.values(exports).flatMap(exportTargets);
}

function readWebGraph(root, packageMap, lock, semver) {
  const version = packageMap.versions.packageSemver;
  assert.match(version, versionPattern);
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.packages[''].version, version, 'Workspace lock version differs from package map');
  const packages = new Map();
  for (const [role, { name, path }] of Object.entries(packageMap.web)) {
    assert.match(name, /^@klenwriter\/editor(?:-[a-z]+)?$/u);
    assert.match(path, /^packages\/[a-z-]+$/u);
    assert.equal(path, 'packages/' + role, 'Unexpected directory for package role ' + role);
    const directory = join(root, path);
    assert.equal(realpathSync(directory), directory, 'Package directory must be materialized: ' + name);
    const manifestPath = join(directory, 'package.json');
    assert(lstatSync(manifestPath).isFile(), 'Expected a regular manifest: ' + name);
    const manifest = readJson(manifestPath);
    const locked = lock.packages[path];
    assert.equal(manifest.name, name);
    assert.equal(manifest.version, version, name + ' version differs from package map');
    assert.equal(manifest.private, true, name + ' must remain private in the source workspace');
    assert.equal(locked?.name, name, name + ' is missing from workspace lock');
    assert.equal(locked.version, version, name + ' version differs from workspace lock');
    assert.deepEqual(lock.packages['node_modules/' + name], { resolved: path, link: true });
    for (const field of ['dependencies', 'peerDependencies', 'peerDependenciesMeta']) {
      assert.deepEqual(locked[field] ?? {}, manifest[field] ?? {}, name + ' lock mismatch for ' + field);
    }
    for (const field of ['optionalDependencies', 'bundleDependencies', 'bundledDependencies']) {
      assert.equal(manifest[field], undefined, name + ' has an unsupported dependency field ' + field);
    }
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) {
      assert.equal(manifest.scripts?.[hook], undefined, name + ' requires a lifecycle hook');
    }
    assert(!packages.has(name), 'Duplicate release package: ' + name);
    packages.set(name, { role, directory, manifest });
  }
  assert.equal(packages.size, 7, 'Release requires all seven web packages');
  const angular = packages.get(packageMap.web.angular.name);
  assert.match(angular.manifest.peerDependencies?.['@angular/core'] ?? '', versionPattern, 'Angular core peer must be exact');

  const ordered = new Map();
  const visiting = new Set();
  const checkedPublic = new Set();
  function checkPublic(name, range, optional = false) {
    assert(!name.startsWith('@klenwriter/'), 'Undeclared editor dependency: ' + name);
    const dependency = lock.packages['node_modules/' + name];
    if (!dependency && optional) return;
    assert(dependency && semver.satisfies(dependency.version, range), 'Missing or incompatible locked dependency: ' + name);
    if (checkedPublic.has(name)) return;
    checkedPublic.add(name);
    const shortName = name.split('/').at(-1);
    assert.equal(dependency.resolved, `https://registry.npmjs.org/${name}/-/${shortName}-${dependency.version}.tgz`);
    assert.match(dependency.integrity, /^sha512-[a-z0-9+/]{86}==$/iu);
    for (const [child, specifier] of Object.entries(dependency.dependencies ?? {})) checkPublic(child, specifier);
    for (const [child, specifier] of Object.entries(dependency.peerDependencies ?? {})) {
      checkPublic(child, specifier, dependency.peerDependenciesMeta?.[child]?.optional === true);
    }
  }
  function visit(name) {
    if (ordered.has(name)) return;
    assert(!visiting.has(name), 'Circular release dependency: ' + name);
    visiting.add(name);
    const entry = packages.get(name);
    for (const relationships of [entry.manifest.dependencies, entry.manifest.peerDependencies]) {
      for (const [dependency, pin] of Object.entries(relationships ?? {})) {
        if (packages.has(dependency)) {
          assert.equal(pin, version, name + ' must pin ' + dependency + ' to the release version');
          visit(dependency);
        } else {
          assert.match(pin, versionPattern, name + ' must use an exact public dependency pin');
          checkPublic(dependency, pin);
        }
      }
    }
    visiting.delete(name);
    ordered.set(name, entry);
  }
  for (const name of [...packages.keys()].sort()) visit(name);
  return ordered.values();
}

function stagePackage({ directory, manifest, role }, stage) {
  assert(Array.isArray(manifest.files) && manifest.files.length, manifest.name + ' needs explicit file roots');
  const expected = new Map();
  const save = (path, bytes) => {
    assert(!expected.has(path), 'Overlapping package file roots: ' + path);
    const destination = join(stage, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes, { flag: 'wx' });
    chmodSync(destination, 0o644);
    expected.set(path, { size: bytes.length, sha256: digest('sha256', bytes) });
  };
  function copy(path) {
    assertMember(path);
    assert.notEqual(path, 'package.json', 'The staged manifest is generated separately');
    const source = join(directory, path);
    assert.equal(realpathSync(source), source, 'Unexpected symlink in package: ' + path);
    const entry = lstatSync(source);
    if (entry.isDirectory()) {
      for (const child of readdirSync(source).sort()) copy(path + '/' + child);
    } else {
      assert(entry.isFile(), 'Unexpected non-regular package file: ' + path);
      save(path, readFileSync(source));
    }
  }
  const roots = new Set(manifest.files);
  if (role === 'vanilla' || existsSync(join(directory, 'README.md'))) roots.add('README.md');
  for (const path of roots) copy(path);
  const { private: _sourcePrivate, ...publishable } = manifest;
  save('package.json', Buffer.from(JSON.stringify(publishable, null, 2) + '\n'));
  const required = [...requiredMembers, ...exportTargets(manifest.exports)];
  if (role === 'wasm') required.push('THIRD-PARTY-NOTICES');
  for (const path of required) assert(expected.has(path), manifest.name + ' is missing ' + path);
  return expected;
}

function verifyArchive(tar, path, report, expected) {
  const bytes = readFileSync(path);
  assert.equal(report.size, bytes.length);
  assert.equal(report.shasum, digest('sha1', bytes));
  assert.equal(report.integrity, 'sha512-' + digest('sha512', bytes, 'base64'));
  assert.equal(report.entryCount, expected.size);
  assert.equal(report.files.length, expected.size);
  assert.deepEqual(new Map(report.files.map(member => [member.path, member.size])),
    new Map([...expected].map(([member, value]) => [member, value.size])));
  const seen = new Set();
  tar.list({ file: path, sync: true, strict: true, onReadEntry(entry) {
    assert(entry.path.startsWith('package/') && entry.type === 'File', 'Invalid npm tar entry: ' + entry.path);
    const member = entry.path.slice('package/'.length);
    assertMember(member);
    assert(!seen.has(member) && expected.has(member), 'Unexpected npm tar entry: ' + member);
    const staged = expected.get(member);
    assert.equal(entry.size, staged.size, 'Wrong packaged size: ' + member);
    const hash = createHash('sha256');
    entry.on('data', chunk => hash.update(chunk));
    entry.on('end', () => {
      assert.equal(hash.digest('hex'), staged.sha256, 'Wrong packaged bytes: ' + member);
      seen.add(member);
    });
  } });
  assert.equal(seen.size, expected.size, 'Packaged file set differs from staging');
}

/** Pack the release into an existing empty directory without changing its producer. */
export function packWebRelease({ sourceRoot, outputDirectory, packageMap }) {
  const root = realpathSync(sourceRoot);
  const output = realpathSync(outputDirectory);
  assert.deepEqual(readdirSync(output), [], 'Web release output must be empty');
  assert.deepEqual(packageMap, readJson(join(root, 'package-map.json')));
  const npm = pinnedNpmCli(root);
  const requireFromNpm = createRequire(npm.cli);
  const tar = requireFromNpm('tar');
  const entries = readWebGraph(root, packageMap, readJson(join(root, 'package-lock.json')), requireFromNpm('semver'));
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'kwe-web-release-')));
  const copied = [];
  try {
    const placement = relative(root, temporary);
    assert(isAbsolute(placement) || placement.startsWith('..' + sep), 'Release staging must be outside the checkout');
    const archives = join(temporary, 'archives');
    const userConfig = join(temporary, 'user.npmrc');
    const globalConfig = join(temporary, 'global.npmrc');
    mkdirSync(archives);
    writeFileSync(userConfig, '');
    writeFileSync(globalConfig, '');
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(?:npm_config_|NODE_OPTIONS$|NODE_PATH$)/iu.test(name)));
    const args = [npm.cli, 'pack', '--no-workspaces', '--ignore-scripts', '--offline', '--json',
      '--pack-destination', archives, '--cache', join(temporary, 'cache'),
      '--userconfig', userConfig, '--globalconfig', globalConfig];
    const records = [];
    for (const entry of entries) {
      const { name, version } = entry.manifest;
      const stage = join(temporary, entry.role);
      mkdirSync(stage);
      const expected = stagePackage(entry, stage);
      const filename = name.slice(1).replace('/', '-') + '-' + version + '.tgz';
      const [report, ...extra] = JSON.parse(execFileSync(process.execPath, args, {
        cwd: stage, env, encoding: 'utf8', timeout: 120_000,
      }));
      assert.equal(extra.length, 0);
      assert.equal(report.name, name);
      assert.equal(report.version, version);
      assert.equal(report.filename, filename);
      verifyArchive(tar, join(archives, filename), report, expected);
      records.push({ name, version, filename });
    }
    for (const { filename } of records) {
      const destination = join(output, filename);
      copyFileSync(join(archives, filename), destination, constants.COPYFILE_EXCL);
      copied.push(destination);
    }
    return records;
  } catch (error) {
    for (const file of copied) rmSync(file);
    throw error;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
