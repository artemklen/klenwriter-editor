// SPDX-License-Identifier: MIT OR Apache-2.0
// Explicit metadata producer only. Importing neither invokes Cargo nor writes files.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => order(a.name, b.name)).flatMap(entry => {
    assert(!entry.isSymbolicLink(), `No source symlinks: ${entry.name}`);
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : entry.isFile() ? [path] : [];
  });
}
function record(path) {
  const bytes = readFileSync(path);
  return { path: resolve(path), bytes: bytes.length, sha256: sha(bytes) };
}
function sourcePins(root) {
  const paths = ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml',
    'tests/fixtures/reliability-native/Cargo.toml', 'tests/fixtures/reliability-native/Cargo.lock',
    'scripts/reliability/dependency-inventory.mjs', 'scripts/dependency-notices.mjs', 'evidence/osr-38/native-tooling.md'];
  paths.push(...files(resolve(root, 'tests/fixtures/reliability-native/src')));
  paths.push(...files(resolve(root, 'tests/fixtures/reliability-native/tests')));
  paths.push(...files(resolve(root, 'tests/fixtures/reliability-native/fixtures')));
  for (const entry of readdirSync(resolve(root, 'crates'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const crate = resolve(root, 'crates', entry.name);
    if (existsSync(`${crate}/Cargo.toml`)) paths.push(`${crate}/Cargo.toml`);
    if (existsSync(`${crate}/src`)) paths.push(...files(`${crate}/src`));
  }
  return Object.fromEntries([...new Set(paths.map(path => relative(root, resolve(root, path))))].sort(order)
    .map(path => [path, record(resolve(root, path))]));
}
function lockRows(path) {
  const field = (text, key) => new RegExp(`^${key} = "([^"\\n]+)"$`, 'm').exec(text)?.[1] ?? null;
  return [...readFileSync(path, 'utf8').matchAll(/^\[\[package\]\]\n([\s\S]*?)(?=^\[\[package\]\]|$(?![\s\S]))/gm)]
    .map(match => Object.fromEntries(['name', 'version', 'source', 'checksum'].map(key => [key, field(match[1], key)])));
}
function closure(metadata, { rootIds, kinds, rootDev = false }) {
  const nodes = new Map(metadata.resolve.nodes.map(node => [node.id, node]));
  const seen = new Set();
  function visit(id, first = false) {
    if (seen.has(id)) return;
    seen.add(id);
    for (const dep of nodes.get(id).deps) {
      if (dep.dep_kinds.some(edge => kinds.includes(edge.kind ?? 'normal') || (first && rootDev && edge.kind === 'dev'))) visit(dep.pkg);
    }
  }
  for (const id of rootIds) visit(id, true);
  return [...seen].sort(order);
}
function describe(metadata, lockPath, root) {
  const locked = lockRows(lockPath);
  const roots = [metadata.resolve.root].filter(Boolean);
  const native = new Set(closure(metadata, { rootIds: roots, kinds: ['normal', 'build'], rootDev: true }));
  const normal = new Set(closure(metadata, { rootIds: roots, kinds: ['normal'] }));
  const nodes = new Map(metadata.resolve.nodes.map(node => [node.id, node]));
  return metadata.packages.slice().sort((a, b) => order(a.id, b.id)).map(pkg => {
    const match = locked.filter(row => row.name === pkg.name && row.version === pkg.version && row.source === pkg.source);
    assert.equal(match.length, 1, `Exact lock entry: ${pkg.name}@${pkg.version}`);
    const dir = dirname(pkg.manifest_path);
    const licenseNames = readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isFile() && /^(LICENSE|COPYING|COPYRIGHT)([.\-_]|$)/i.test(entry.name)).map(entry => entry.name);
    if (pkg.license_file && existsSync(resolve(dir, pkg.license_file))) licenseNames.push(pkg.license_file);
    const licenseFiles = [...new Set(licenseNames)].sort(order).map(name => record(resolve(dir, name)));
    let archive = { status: 'not-registry-package', expectedSHA256: match[0].checksum };
    if (pkg.source?.startsWith('registry+')) {
      // Cargo's extracted registry src/<index>/<crate> and cache/<index>/<crate>.crate.
      const registry = dirname(dirname(dirname(dir)));
      const candidate = resolve(registry, 'cache', basename(dirname(dir)), `${pkg.name}-${pkg.version}.crate`);
      archive = existsSync(candidate) ? { status: 'verified', ...record(candidate), expectedSHA256: match[0].checksum }
        : { status: 'archive-unavailable-locally', path: candidate, expectedSHA256: match[0].checksum };
      if (archive.status === 'verified') assert.equal(archive.sha256, match[0].checksum, `Registry archive differs: ${pkg.name}`);
    }
    return { id: pkg.id, name: pkg.name, version: pkg.version, source: pkg.source, licenseSPDX: pkg.license,
      declaredRustVersion: pkg.rust_version, declaredEdition: pkg.edition,
      manifest: { ...record(pkg.manifest_path), repoRelativePath: pkg.source ? null : relative(root, pkg.manifest_path) },
      targets: pkg.targets.map(target => ({ name: target.name, kind: target.kind, crateTypes: target.crate_types,
        requiredFeatures: target['required-features'] ?? [], edition: target.edition, test: target.test, doctest: target.doctest })),
      features: pkg.features, enabledFeatures: nodes.get(pkg.id)?.features ?? [],
      declarations: pkg.dependencies.map(dep => ({ name: dep.name, rename: dep.rename, requirement: dep.req,
        kind: dep.kind ?? 'normal', optional: dep.optional, target: dep.target, defaultFeatures: dep.uses_default_features, features: dep.features })),
      resolvedEdges: nodes.get(pkg.id)?.deps ?? [],
      role: normal.has(pkg.id) ? 'fixture-normal' : native.has(pkg.id) ? 'fixture-build-or-root-dev' : 'conservative-metadata-only',
      licenseTexts: { status: licenseFiles.length ? 'available-local-texts' : 'no-local-license-text-found', files: licenseFiles }, archive };
  });
}
export function inventory({ root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), output = 'artifacts/reliability/dependencies.json' } = {}) {
  root = resolve(root); output = resolve(root, output);
  const raw = resolve(dirname(output), 'dependency-inventory-raw');
  assert(!existsSync(output) && !existsSync(raw), 'Never overwrite an earlier inventory or raw command evidence');
  const before = sourcePins(root); mkdirSync(raw, { recursive: true });
  const commands = [];
  function run(label, args) {
    const result = spawnSync('cargo', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const stdout = `${raw}/${label}.stdout.json`, stderr = `${raw}/${label}.stderr.log`;
    writeFileSync(stdout, result.stdout ?? '', { flag: 'wx' }); writeFileSync(stderr, result.stderr ?? '', { flag: 'wx' });
    const receipt = { program: 'cargo', args, cwd: root, actualExitCode: result.status, signal: result.signal,
      spawnError: result.error?.message ?? null, stdout: record(stdout), stderr: record(stderr) };
    writeFileSync(`${raw}/${label}.receipt.json`, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    commands.push(receipt); assert.equal(result.status, 0, `Cargo metadata failed; retained ${label}.receipt.json`);
    return JSON.parse(result.stdout);
  }
  const fixtureManifest = 'tests/fixtures/reliability-native/Cargo.toml';
  const common = ['--format-version=1', '--locked', '--offline'];
  const fixture = run('native-all-features', ['metadata', '--manifest-path', fixtureManifest, '--all-features', ...common]);
  assert.equal(fixture.packages.find(pkg => pkg.id === fixture.resolve.root).name, 'editor-reliability-native');
  const allRoot = run('root-all-features', ['metadata', '--all-features', ...common]);
  const defaultRoot = run('root-default', ['metadata', ...common]);
  const browser = run('root-default-wasm32', ['metadata', '--filter-platform', 'wasm32-unknown-unknown', ...common]);
  const packageName = 'klenwriter-editor-wasm';
  function production(metadata) {
    const roots = metadata.packages.filter(pkg => pkg.name === packageName).map(pkg => pkg.id);
    assert.equal(roots.length, 1);
    const byId = new Map(metadata.packages.map(pkg => [pkg.id, pkg]));
    const normal = closure(metadata, { rootIds: roots, kinds: ['normal'] });
    const build = closure(metadata, { rootIds: roots, kinds: ['normal', 'build'] });
    for (const id of build) assert(!['proptest', 'dhat'].includes(byId.get(id).name), `Test dependency leaked: ${byId.get(id).name}`);
    for (const id of normal) assert(!['ts-rs', 'ts-rs-macros'].includes(byId.get(id).name), 'Optional generator leaked into default normal closure');
    return { root: roots[0], normal, normalAndBuild: build,
      packages: build.map(id => ({ id, name: byId.get(id).name, version: byId.get(id).version })) };
  }
  const packages = describe(fixture, resolve(root, 'tests/fixtures/reliability-native/Cargo.lock'), root);
  const rootPackages = describe(allRoot, resolve(root, 'Cargo.lock'), root);
  const after = sourcePins(root); assert.deepEqual(after, before, 'Source or lock changed during metadata inventory');
  const report = { format: 'editor-reliability-native-dependencies/1', status: 'passed', scope: 'Standalone native fixture only; metadata inventory, no build/test/runtime or legal publication verdict',
    commands, sourceHashes: Object.fromEntries(Object.entries(before).map(([path, item]) => [path, item.sha256])), sourcePins: before, sourceBeforeAfterEqual: true,
    fixture: { manifest: fixtureManifest, allFeatures: true, root: fixture.resolve.root, workspaceMembers: fixture.workspace_members, packages },
    rootAllFeatures: { qualification: 'Conservative workspace metadata includes optional native generators and dev/build/target-specific packages; this is not the browser runtime closure', packages: rootPackages },
    production: { defaultRoot: production(defaultRoot), defaultBrowserWasm32: production(browser),
      proptestDhatAbsentFromNormalAndBuild: true, tsRsAbsentFromDefaultNormal: true },
    qualifications: ['Declared SPDX/MSRV are metadata, not an independent compatibility/license-text certification.',
      'All-target metadata conservatively includes target-specific and optional/dev roles; root dev dependencies do not become normal production dependencies.',
      'Missing cached crate archives or license texts are listed explicitly; no network fetch, fallback text fabrication, or registry mutation.',
      'Archive hashes, where locally accessible, must equal the exact matching Cargo.lock checksum.'],
    summary: { nativePackages: packages.length, nativeRegistryPackages: packages.filter(pkg => pkg.source).length,
      verifiedNativeArchives: packages.filter(pkg => pkg.archive.status === 'verified').length,
      unavailableNativeArchives: packages.filter(pkg => pkg.archive.status === 'archive-unavailable-locally').map(pkg => `${pkg.name}@${pkg.version}`),
      nativeMissingLicenseTexts: packages.filter(pkg => !pkg.licenseTexts.files.length).map(pkg => `${pkg.name}@${pkg.version}`),
      allFeatureGeneratorPackages: rootPackages.filter(pkg => ['ts-rs', 'ts-rs-macros'].includes(pkg.name)).map(pkg => ({ name: pkg.name, version: pkg.version })) } };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  return { report: record(output), summary: report.summary, productionBrowserPackages: report.production.defaultBrowserWasm32.packages.length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(inventory(), null, 2));
