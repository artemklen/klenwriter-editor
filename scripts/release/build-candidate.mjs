// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { corpusRoot, verifyCorpus } from '../corpus-package.mjs';
import { computeSdkBuildIdentity } from '../generate-sdk-types.mjs';
import { packRustRelease } from './native.mjs';
import { packWebRelease } from './web.mjs';
import { writeReleaseProvenance } from './provenance.mjs';
import { verifyCandidate } from './verify-candidate.mjs';

const sourceRoot = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const read = path => readFileSync(join(sourceRoot, path));
const readJson = path => JSON.parse(read(path));
const digest = (hash, bytes, encoding = 'hex') => createHash(hash).update(bytes).digest(encoding);
const options = { cwd: sourceRoot, maxBuffer: 32 * 1024 * 1024 };
const capture = (command, args) => execFileSync(command, args, options);
const text = (command, args) => capture(command, args).toString('utf8').trim();
const git = (...args) => text('git', args);

function cleanCommit() {
  assert.equal(git('status', '--porcelain'), '', 'Build from a clean source checkout');
  return git('rev-parse', 'HEAD');
}

function toolchain() {
  const node = read('.node-version').toString('utf8').trim();
  const npm = /^npm@(\d+\.\d+\.\d+)$/.exec(readJson('package.json').packageManager)?.[1];
  const rust = /^channel = "([^"]+)"$/m.exec(read('rust-toolchain.toml').toString('utf8'))?.[1];
  const wasmBindgen = readJson('package-map.json').versions.wasmBindgenAbi;
  assert.equal(process.versions.node, node);
  assert.equal(text('npm', ['--version']), npm);
  assert(text('rustc', ['--version']).startsWith('rustc ' + rust + ' '));
  assert.equal(text(join(sourceRoot, '.tools/bin/wasm-bindgen'), ['--version']), 'wasm-bindgen ' + wasmBindgen);
  return { node, npm, rust, wasmBindgen, platform: process.platform, architecture: process.arch };
}

function setBuildEnvironment(epoch) {
  const prefixes = new Map();
  for (const [from, to] of [
    [tmpdir(), '/klenwriter-build/tmp'],
    [process.env.CARGO_HOME ?? join(homedir(), '.cargo'), '/klenwriter-build/cargo'],
    [text('rustc', ['--print', 'sysroot']), '/klenwriter-build/rust'],
    [sourceRoot, '/klenwriter-build/source'],
  ]) {
    prefixes.set(resolve(from), to);
    prefixes.set(realpathSync(from), to);
  }
  // rustc uses the last matching prefix. Place the more specific paths last.
  const remaps = [...prefixes].sort(([left], [right]) => left.length - right.length);
  const flags = ['--remap-path-scope=all', ...remaps.map(([from, to]) => '--remap-path-prefix=' + from + '=' + to)];
  Object.assign(process.env, {
    CARGO_ENCODED_RUSTFLAGS: flags.join('\x1f'),
    CARGO_INCREMENTAL: '0',
    CARGO_TARGET_DIR: join(sourceRoot, 'target'),
    SOURCE_DATE_EPOCH: String(epoch),
    TZ: 'UTC',
  });
}

function fileRecord(directory, path) {
  assert(!isAbsolute(path) && relative(directory, resolve(directory, path)) === path);
  const content = readFileSync(join(directory, path));
  return { path, bytes: content.length, sha256: digest('sha256', content) };
}

function packageRecords(directory, category, kind, records, expected, version) {
  assert.deepEqual(records.map(record => record.name).sort(), expected.map(item => item.name).sort());
  return records.map(({ name, version: packagedVersion, filename }) => {
    assert.equal(packagedVersion, version, 'Different version in ' + name);
    assert.equal(basename(filename), filename);
    const path = category + '/' + filename;
    const record = { kind, name, version, ...fileRecord(directory, path) };
    if (kind === 'npm') record.integrity = 'sha512-' + digest('sha512', readFileSync(join(directory, path)), 'base64');
    return record;
  });
}

function archiveCorpus(directory, commit, epoch) {
  const corpus = verifyCorpus(join(sourceRoot, corpusRoot));
  const name = corpus.package + '-' + corpus.packageVersion;
  const path = 'corpus/' + name + '.tar.gz';
  mkdirSync(join(directory, 'corpus'));
  const tar = capture('git', [
    'archive', '--format=tar', '--mtime=@' + epoch, '--prefix=' + name + '/', commit + ':' + corpusRoot,
  ]);
  const gzip = gzipSync(tar, { level: 9 });
  // The gzip header's OS field is advisory and can vary with the Node platform.
  gzip[9] = 255;
  writeFileSync(join(directory, path), gzip, { flag: 'wx' });
  return { kind: 'corpus', name: corpus.package, version: corpus.packageVersion, ...fileRecord(directory, path) };
}

async function buildCandidate(directory) {
  const commit = cleanCommit();
  const source = {
    commit,
    tree: git('rev-parse', 'HEAD^{tree}'),
    sourceDateEpoch: Number(git('show', '-s', '--format=%ct', commit)),
  };
  assert(Number.isSafeInteger(source.sourceDateEpoch) && source.sourceDateEpoch > 0);
  const packageMap = readJson('package-map.json');
  const version = packageMap.versions.packageSemver;
  assert.equal(packageMap.stage, 'release-candidate');
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const tools = toolchain();
  setBuildEnvironment(source.sourceDateEpoch);

  execFileSync('npm', ['run', 'build'], { cwd: sourceRoot, stdio: 'inherit' });
  assert.equal(cleanCommit(), commit, 'Source changed during the build');
  const build = readJson('artifacts/sdk-build-identity.json');
  const seal = readJson('artifacts/sdk-wasm-seal.json');
  assert.equal(build.buildId, computeSdkBuildIdentity().buildId);
  assert.equal(seal.build_id, build.buildId);

  const crates = join(directory, 'crates');
  const npm = join(directory, 'npm');
  mkdirSync(crates);
  mkdirSync(npm);
  const rust = packageRecords(directory, 'crates', 'crate',
    await packRustRelease({ sourceRoot, outputDirectory: crates, packageMap }), Object.values(packageMap.rust), version);
  const web = packageRecords(directory, 'npm', 'npm',
    await packWebRelease({ sourceRoot, outputDirectory: npm, packageMap }), Object.values(packageMap.web), version);

  const wasmPath = 'wasm/editor_wasm_bg.wasm';
  mkdirSync(join(directory, 'wasm'));
  copyFileSync(join(sourceRoot, packageMap.web.wasm.path, 'dist/editor_wasm_bg.wasm'), join(directory, wasmPath));
  const wasm = { kind: 'wasm', name: packageMap.web.wasm.name, version, ...fileRecord(directory, wasmPath) };
  assert.equal(wasm.bytes, seal.sealed_bytes);
  assert.equal(wasm.sha256, seal.sealed_sha256);
  const wasmArchive = web.find(item => item.name === wasm.name);
  const member = capture('tar', ['-xOzf', join(directory, wasmArchive.path), 'package/dist/editor_wasm_bg.wasm']);
  assert.equal(digest('sha256', member), wasm.sha256);

  const registryPath = 'wasm/kwdj-registry.json';
  copyFileSync(join(sourceRoot, packageMap.web.kwdj.path, 'dist/registry.json'), join(directory, registryPath));
  const registry = JSON.parse(readFileSync(join(directory, registryPath))).profile;
  assert.equal(registry.id, packageMap.versions.kwdjProfileId);
  const kwdjProfile = {
    id: registry.id, version: registry.version, codecId: registry.codec_id, wireVersion: registry.wire_version,
    ...fileRecord(directory, registryPath),
  };
  const manifest = {
    format: 'klenwriter-editor-release-candidate/1',
    version, source, tools, packageVersions: packageMap.versions,
    build: { cargoProfile: 'release', wasmTarget: 'wasm32-unknown-unknown', rustcRemapScope: 'all' },
    editorBuildId: build.buildId, kwdjProfile,
    artifacts: [...rust, ...web, wasm, archiveCorpus(directory, commit, source.sourceDateEpoch)],
  };
  const sidecars = await writeReleaseProvenance({ sourceRoot, outputDirectory: directory, manifest, packageMap });
  manifest.provenance = sidecars.toSorted().map(path => fileRecord(directory, path));
  assert.equal(cleanCommit(), commit, 'Source changed during candidate packaging');
  writeFileSync(join(directory, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  verifyCandidate(directory, packageMap);
  return manifest;
}

const [destination, ...rest] = process.argv.slice(2);
assert(destination && rest.length === 0, 'Usage: node scripts/release/build-candidate.mjs <new-output-directory>');
const output = join(realpathSync(dirname(resolve(destination))), basename(destination));
const placement = relative(sourceRoot, output);
assert(placement.startsWith('..' + sep) || isAbsolute(placement), 'Candidate output belongs outside its source checkout');
assert(!existsSync(output), 'Choose a new candidate output directory');
const stage = mkdtempSync(join(dirname(output), '.kwe-candidate-'));
try {
  const manifest = await buildCandidate(stage);
  assert(!existsSync(output), 'The requested output appeared during candidate assembly');
  renameSync(stage, output);
  console.log(`Candidate ${manifest.version} from ${manifest.source.commit} at ${output}`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
