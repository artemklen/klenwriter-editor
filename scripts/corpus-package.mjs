// SPDX-License-Identifier: MIT OR Apache-2.0
// Data artifact integrity; no document semantics or network access.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, posix } from 'node:path';

export const corpusRoot = 'contracts/kwdj/v1';
export const indexFile = 'corpus-package.json';
export const reviewedFiles = ['LICENSE-APACHE', 'LICENSE-MIT', 'NOTICE', 'README.md', 'baseline-cases.json',
  'extension-vectors.json', 'fixture.schema.json', 'fixtures/deferred.json', 'fixtures/mixed.json',
  'fixtures/negative.json', 'fixtures/positive.json', 'kwdj.schema.json', 'manifest.json', 'source-provenance.json'].sort();
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function filesBelow(root, prefix = '') {
  const files = [];
  for (const name of readdirSync(join(root, prefix)).sort()) {
    const relative = prefix + name, stat = lstatSync(join(root, relative));
    if (stat.isSymbolicLink()) throw new Error('Corpus symlink forbidden');
    if (stat.isDirectory()) files.push(...filesBelow(root, relative + '/'));
    else if (stat.isFile()) files.push(relative);
    else throw new Error('Corpus non-file forbidden');
  }
  return files.sort();
}
export function fileEntries(root) {
  return filesBelow(root).filter(path => path !== indexFile).map(path => {
    const bytes = readFileSync(join(root, path));
    return { path, bytes: bytes.length, sha256: sha256(bytes) };
  });
}
// Versioned digest grammar: sorted UTF-8 lines path NUL sha256 NUL decimal-size LF.
// Paths cannot contain separators/control ambiguity, and names are case-sensitive.
export function contentDigest(files) {
  return sha256(files.map(f => `${f.path}\0${f.sha256}\0${f.bytes}\n`).join(''));
}
export function verifyCorpus(root = corpusRoot) {
  const bytes = readFileSync(join(root, indexFile)), pkg = JSON.parse(bytes);
  if (pkg.schema !== 1 || pkg.package !== 'klenwriter-kwdj-contract' || !/^1\.[0-9]+\.[0-9]+$/.test(pkg.packageVersion)
      || pkg.kwdjSchemaVersion !== 1 || !Array.isArray(pkg.files) || !/^[a-f0-9]{64}$/.test(pkg.contentSha256)) throw new Error('Unknown corpus package');
  if (pkg.canonicalRule !== 'klenwriter-canonical-json-v1' || pkg.authority !== 'https://github.com/artemklen/klenwriter-editor'
      || pkg.digestGrammar !== 'sorted UTF-8: path NUL sha256 NUL decimal-size LF; index excluded') throw new Error('Unknown corpus policy');
  const seen = new Set();
  for (const f of pkg.files) {
    if (typeof f.path !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(f.path) || f.path.startsWith('/')
        || posix.normalize(f.path) !== f.path || f.path.split('/').some(s => !s || s === '.' || s === '..')
        || f.path === indexFile || seen.has(f.path) || !Number.isSafeInteger(f.bytes) || f.bytes < 0
        || !/^[a-f0-9]{64}$/.test(f.sha256)) throw new Error('Invalid corpus file record');
    seen.add(f.path);
  }
  const actual = fileEntries(root);
  if (JSON.stringify(actual.map(f => f.path)) !== JSON.stringify(reviewedFiles)) throw new Error('Unreviewed corpus file inventory');
  if (JSON.stringify(actual) !== JSON.stringify(pkg.files) || contentDigest(actual) !== pkg.contentSha256) throw new Error('Corpus content digest mismatch');
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json')));
  if (manifest.package !== pkg.package || manifest.package_version !== pkg.packageVersion || manifest.kwdj_schema_version !== pkg.kwdjSchemaVersion) throw new Error('Corpus version mismatch');
  return { ...pkg, manifest, indexSha256: sha256(bytes) };
}
