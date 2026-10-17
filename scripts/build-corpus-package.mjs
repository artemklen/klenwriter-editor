// SPDX-License-Identifier: MIT OR Apache-2.0
// Explicit local artifact build. Does not publish or update a consumer pin.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { corpusRoot, indexFile, fileEntries, contentDigest, reviewedFiles } from './corpus-package.mjs';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const manifest = JSON.parse(readFileSync(`${corpusRoot}/manifest.json`));
const files = fileEntries(corpusRoot);
if (JSON.stringify(files.map(f => f.path)) !== JSON.stringify(reviewedFiles)) throw new Error('Unreviewed corpus file; update per-file provenance explicitly');
const pkg = { schema: 1, package: manifest.package, packageVersion: manifest.package_version,
  kwdjSchemaVersion: manifest.kwdj_schema_version, canonicalRule: 'klenwriter-canonical-json-v1',
  authority: 'https://github.com/artemklen/klenwriter-editor',
  digestGrammar: 'sorted UTF-8: path NUL sha256 NUL decimal-size LF; index excluded',
  contentSha256: contentDigest(files), files };
writeFileSync(`${corpusRoot}/${indexFile}`, JSON.stringify(pkg, null, 2) + '\n');
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/corpus-package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log(`Corpus ${pkg.packageVersion}: ${files.length} files, digest ${pkg.contentSha256}`);
