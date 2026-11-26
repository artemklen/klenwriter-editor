// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const root = fileURLToPath(new URL('../../', import.meta.url));
const nameOfManifest = 'release-manifest.json';

function checkFile(directory, record) {
  const { path, bytes, sha256: expected } = record;
  assert.equal(typeof path, 'string');
  assert(!isAbsolute(path) && !path.split('/').includes('..') &&
    relative(directory, resolve(directory, path)) === path, 'Invalid bundle path');
  assert.match(expected, /^[a-f0-9]{64}$/);
  const resolved = join(directory, path);
  assert(lstatSync(resolved).isFile() && realpathSync(resolved) === resolved, 'Expected a regular bundle file');
  const content = readFileSync(resolved);
  assert.equal(content.length, bytes, 'Size mismatch for ' + path);
  assert.equal(sha256(content), expected, 'SHA-256 mismatch for ' + path);
  if (record.kind === 'npm') {
    const integrity = 'sha512-' + createHash('sha512').update(content).digest('base64');
    assert.equal(integrity, record.integrity, 'npm integrity mismatch for ' + path);
  }
}

function allFiles(directory, prefix = '') {
  return readdirSync(join(directory, prefix), { withFileTypes: true }).flatMap(entry => {
    const path = prefix + entry.name;
    assert(entry.isDirectory() || entry.isFile(), 'Unexpected special file in candidate: ' + path);
    return entry.isDirectory() ? allFiles(directory, path + '/') : [path];
  });
}

export function verifyCandidate(path, packageMap) {
  const directory = realpathSync(path);
  const manifestPath = join(directory, nameOfManifest);
  assert(lstatSync(manifestPath).isFile() && realpathSync(manifestPath) === manifestPath);
  const bytes = readFileSync(manifestPath);
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.format, 'klenwriter-editor-release-candidate/1');
  assert.equal(manifest.version, packageMap.versions.packageSemver);
  assert.deepEqual(manifest.packageVersions, packageMap.versions);
  assert.match(manifest.source.commit, /^[a-f0-9]{40}$/);
  assert.match(manifest.source.tree, /^[a-f0-9]{40}$/);
  assert.match(manifest.editorBuildId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(manifest.kwdjProfile.id, packageMap.versions.kwdjProfileId);
  for (const [kind, family] of [['crate', packageMap.rust], ['npm', packageMap.web]]) {
    const shipped = manifest.artifacts.filter(item => item.kind === kind);
    assert.deepEqual(shipped.map(item => item.name).sort(), Object.values(family).map(item => item.name).sort());
    assert(shipped.every(item => item.version === manifest.version));
  }
  const [wasm] = manifest.artifacts.filter(item => item.kind === 'wasm');
  assert.equal(wasm.name, packageMap.web.wasm.name);
  assert.equal(wasm.version, manifest.version);
  assert.equal(manifest.artifacts.filter(item => item.kind === 'wasm').length, 1);
  const corpus = manifest.artifacts.filter(item => item.kind === 'corpus');
  assert.equal(corpus.length, 1);
  assert.equal(corpus[0].name, 'klenwriter-kwdj-contract');
  assert.equal(manifest.artifacts.length,
    Object.keys(packageMap.rust).length + Object.keys(packageMap.web).length + 2);
  assert(Array.isArray(manifest.provenance) && manifest.provenance.length > 0);

  const records = [manifest.kwdjProfile, ...manifest.artifacts, ...manifest.provenance];
  const paths = [nameOfManifest, ...records.map(item => item.path)];
  assert.equal(new Set(paths).size, paths.length, 'Candidate paths must be unique');
  for (const record of records) checkFile(directory, record);
  assert.deepEqual(allFiles(directory).sort(), paths.sort(), 'Candidate manifest must cover the whole bundle');
  return { manifest, manifestSha256: sha256(bytes) };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [directory, replica, ...rest] = process.argv.slice(2);
  assert(directory && rest.length === 0, 'Usage: node scripts/release/verify-candidate.mjs <candidate> [<independent-candidate>]');
  const map = JSON.parse(readFileSync(join(root, 'package-map.json')));
  const result = verifyCandidate(directory, map);
  if (replica) {
    assert.notEqual(realpathSync(directory), realpathSync(replica));
    assert.equal(verifyCandidate(replica, map).manifestSha256, result.manifestSha256,
      'Verified manifests from the two independent builds differ');
  }
  console.log(JSON.stringify({
    version: result.manifest.version, source: result.manifest.source.commit,
    manifestSha256: result.manifestSha256, artifacts: result.manifest.artifacts.length,
    independentlyReproduced: Boolean(replica),
  }));
}
