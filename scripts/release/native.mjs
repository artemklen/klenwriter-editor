// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  constants, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const registrySource = 'registry+https://github.com/rust-lang/crates.io-index';
const licenseFiles = ['LICENSE-MIT', 'LICENSE-APACHE', 'NOTICE', 'SOURCE-PROVENANCE.json'];
const run = (cwd, program, args) => execFileSync(program, args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024,
});
const cargo = (cwd, args) => run(cwd, 'cargo', ['+1.97.1', ...args]);
const sha = root => run(root, 'git', ['rev-parse', 'HEAD']).trim();
const isClean = root => !run(root, 'git', ['status', '--porcelain']);

function metadata(root) {
  return JSON.parse(cargo(root, ['metadata', '--no-deps', '--format-version', '1', '--offline', '--locked'])).packages;
}

function packageOrder(packages) {
  const byName = new Map(packages.map(pkg => [pkg.name, pkg]));
  const active = new Set();
  const complete = new Map();
  const ordered = [];
  function visit(name) {
    if (complete.has(name)) return;
    assert(!active.has(name), 'Rust release dependency cycle at ' + name);
    active.add(name);
    const pkg = byName.get(name);
    const dependencies = new Set();
    for (const dependency of pkg.dependencies) {
      if (!dependency.path) continue;
      visit(dependency.name);
      dependencies.add(dependency.name);
      for (const transitive of complete.get(dependency.name)) dependencies.add(transitive);
    }
    active.delete(name);
    complete.set(name, dependencies);
    ordered.push({ pkg, dependencies: [...dependencies].sort() });
  }
  for (const name of [...byName.keys()].sort()) visit(name);
  return ordered;
}

function dependencyShape(dependency) {
  const { name, kind, rename, req, target, optional, uses_default_features, features } = dependency;
  return JSON.stringify([name, kind, rename, req, target, optional, uses_default_features, [...features].sort()]);
}

function checkCatalogue(source, packageMap, packages) {
  const { packageSemver: version } = packageMap.versions;
  const catalogue = new Map(Object.values(packageMap.rust).map(item => [item.name, item.path]));
  assert.deepEqual(packages.map(pkg => pkg.name).sort(), [...catalogue.keys()].sort(),
    'Rust workspace must match the release package map');
  for (const pkg of packages) {
    const crateDirectory = join(source, catalogue.get(pkg.name));
    assert.match(pkg.name, /^klenwriter-editor-[a-z0-9-]+$/);
    assert.equal(pkg.manifest_path, join(crateDirectory, 'Cargo.toml'));
    assert.equal(pkg.version, version, pkg.name + ' must use the coordinated release version');
    assert.deepEqual(pkg.publish, ['crates-io'], pkg.name + ' must allow crates.io in the package stage');
    assert.equal(pkg.license, packageMap.license);
    assert(pkg.description?.trim(), pkg.name + ' needs a description for crates.io');
    for (const dependency of pkg.dependencies.filter(dep => dep.path)) {
      assert(catalogue.has(dependency.name), pkg.name + ' has an unpackaged path dependency');
      assert.equal(dependency.path, join(source, catalogue.get(dependency.name)));
      assert.equal(dependency.req, '=' + version, pkg.name + ' must pin its internal dependency');
    }
  }
}

// Cargo writes both lockfiles. Compare the registry identities in the normalized
// archive lock against the pinned workspace lock, independent of package order.
function registryLocks(text) {
  const packages = text.split(/^\[\[package\]\]\s*$/m).slice(1);
  const field = (record, key) => record.match(new RegExp('^' + key + ' = "([^"]+)"$', 'm'))?.[1];
  return packages.flatMap(record => {
    const source = field(record, 'source');
    if (!source) return [];
    const name = field(record, 'name');
    const version = field(record, 'version');
    const checksum = field(record, 'checksum');
    assert.equal(source, registrySource, 'Unexpected Rust lock source for ' + name);
    assert(name && version && /^[a-f0-9]{64}$/.test(checksum ?? ''), 'Incomplete Cargo lock entry');
    return [JSON.stringify([name, version, source, checksum])];
  });
}

function inspectArchive(scratch, pkg, archive, unpacked, locked, packageMap) {
  const members = run(scratch, 'tar', ['-tzf', archive]).trimEnd().split('\n');
  const prefix = pkg.name + '-' + pkg.version;
  assert(members.length > 0 && new Set(members).size === members.length, 'Duplicate archive member');
  for (const member of members) {
    assert(member.startsWith(prefix + '/') && !member.split('/').some(part => part === '..' || part === '.'),
      'Unexpected member outside the crate archive root');
  }
  run(scratch, 'tar', ['-xzf', archive, '-C', unpacked]);
  const root = join(unpacked, prefix);
  const [normalized, ...other] = metadata(root);
  assert.equal(other.length, 0);
  assert.equal(normalized.name, pkg.name);
  assert.equal(normalized.version, pkg.version);
  assert.deepEqual(normalized.publish, ['crates-io']);
  assert.equal(normalized.license, packageMap.license);
  assert.equal(normalized.repository, packageMap.repository);
  assert.equal(normalized.description, pkg.description);
  assert(normalized.dependencies.every(dep => !dep.path && dep.source === registrySource),
    pkg.name + ' contains a dependency without a crates.io source');
  assert.deepEqual(normalized.dependencies.map(dependencyShape).sort(), pkg.dependencies.map(dependencyShape).sort(),
    pkg.name + ' dependency closure differs from the candidate');
  const lock = readFileSync(join(root, 'Cargo.lock'), 'utf8');
  for (const identity of registryLocks(lock)) {
    assert(locked.has(identity), pkg.name + ' resolved a dependency outside the pinned lock: ' + identity);
  }
  for (const filename of licenseFiles) {
    const path = join(root, filename);
    assert(statSync(path).isFile() && realpathSync(path) === path, pkg.name + ' must contain regular ' + filename);
    assert(readFileSync(path).equals(readFileSync(join(dirname(pkg.manifest_path), filename))),
      pkg.name + ' changed the tracked bytes of ' + filename);
  }
  return root;
}

/** Build crates.io archives from the same exact source revision with the publication gate scoped to staging. */
export function packRustRelease({ sourceRoot, outputDirectory, packageMap }) {
  const root = realpathSync(sourceRoot);
  const output = realpathSync(outputDirectory);
  assert.equal(readdirSync(output).length, 0, 'Rust archive destination must be empty');
  assert.equal(run(root, 'git', ['rev-parse', '--show-toplevel']).trim(), root, 'Rust release source must be a checkout root');
  const revision = sha(root);
  assert(isClean(root), 'Rust release source must be clean');
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'kwe-rust-release-')));
  try {
    const source = join(scratch, 'source');
    const archived = join(scratch, 'source.tar');
    const target = join(scratch, 'target');
    const unpacked = join(scratch, 'crates');
    mkdirSync(source);
    mkdirSync(unpacked);
    run(root, 'git', ['archive', '--format=tar', '--output=' + archived, revision]);
    run(scratch, 'tar', ['-xf', archived, '-C', source]);
    assert.deepEqual(JSON.parse(readFileSync(join(source, 'package-map.json'), 'utf8')), packageMap,
      'Rust release package map must come from the frozen source');
    const manifestPath = join(source, 'Cargo.toml');
    const manifest = readFileSync(manifestPath, 'utf8');
    const publishGate = /(^\[workspace\.package\]\r?\n[^\[]*?)^publish = false$/m;
    assert(publishGate.test(manifest), 'Expected the workspace publication gate in source');
    writeFileSync(manifestPath, manifest.replace(publishGate, '$1publish = ["crates-io"]'));
    const lockPath = join(source, 'Cargo.lock');
    const lock = readFileSync(lockPath, 'utf8');
    const locked = new Set(registryLocks(lock));
    const packages = metadata(source);
    checkCatalogue(source, packageMap, packages);
    const patched = new Map();
    const rows = packageOrder(packages).map(({ pkg, dependencies }) => {
      const patches = dependencies.flatMap(name => [
        '--config', 'patch.crates-io.' + name + '.path=' + JSON.stringify(patched.get(name)),
      ]);
      const { name, version } = pkg;
      // Cargo first resolves the source workspace, where the exact path patches
      // stay unused. Let it record those entries before the locked package run.
      if (patches.length) cargo(source, ['metadata', '--offline', '--format-version', '1', ...patches]);
      const patchedLock = readFileSync(lockPath, 'utf8');
      const [base, ...unused] = patchedLock.split(/^\[\[patch\.unused\]\]$/m);
      assert.equal(base.trimEnd(), lock.trimEnd(), 'Local release patches changed the workspace resolution');
      assert.deepEqual(unused.map(record => record.trim()).sort(), dependencies.map(dependency =>
        'name = "' + dependency + '"\nversion = "' + version + '"').sort());
      cargo(source, ['package', '--registry', 'crates-io', '--offline', '--locked', '--no-verify',
        '--target-dir', target, '-p', name, ...patches]);
      assert.equal(readFileSync(lockPath, 'utf8'), patchedLock, 'Locked packaging changed the workspace resolution');
      writeFileSync(lockPath, lock);
      const filename = name + '-' + version + '.crate';
      const archive = join(target, 'package', filename);
      patched.set(name, inspectArchive(scratch, pkg, archive, unpacked, locked, packageMap));
      return { name, version, filename };
    });
    assert(sha(root) === revision && isClean(root), 'Source changed while packaging Rust releases');
    const copied = [];
    try {
      for (const { filename } of rows) {
        const destination = join(output, filename);
        copyFileSync(join(target, 'package', filename), destination, constants.COPYFILE_EXCL);
        copied.push(destination);
      }
    } catch (error) {
      for (const path of copied) rmSync(path);
      throw error;
    }
    return rows;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
