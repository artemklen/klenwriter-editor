// SPDX-License-Identifier: MIT OR Apache-2.0
// Portable data-only bundle; no registry publication or consumer mutation.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { verifyCorpus, corpusRoot, indexFile, sha256 } from './corpus-package.mjs';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const pkg = verifyCorpus();
const paths = [indexFile, ...pkg.files.map(f => f.path)];
const bundle = { schema: 1, packageVersion: pkg.packageVersion, contentSha256: pkg.contentSha256,
  indexSha256: pkg.indexSha256,
  files: paths.map(path => ({ path, base64: readFileSync(`${corpusRoot}/${path}`).toString('base64') })) };
const bytes = gzipSync(Buffer.from(JSON.stringify(bundle) + '\n'), { level: 9 });
mkdirSync('artifacts', { recursive: true });
const path = `artifacts/kwdj-corpus-${pkg.packageVersion}.json.gz`;
writeFileSync(path, bytes);
writeFileSync('artifacts/corpus-export.json', JSON.stringify({ schema: 1, path, bytes: bytes.length,
  sha256: sha256(bytes), indexSha256: pkg.indexSha256, contentSha256: pkg.contentSha256,
  packageVersion: pkg.packageVersion, note: 'Compressed hash identifies this build; canonical content digest is independent of compressor/platform.' }, null, 2) + '\n');
console.log(`Data corpus exported: ${path}, ${bytes.length} bytes; content ${pkg.contentSha256}`);
