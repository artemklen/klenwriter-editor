import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { identity } from './package-identity.mjs';

mkdirSync('artifacts/packages', { recursive: true });
const results = [];
for (const name of ['wasm', 'sdk', 'dom', 'kwdj', 'vanilla', 'angular']) {
  const result = spawnSync('npm', ['pack', '--workspace', identity.web[name].name,
    '--ignore-scripts', '--json', '--pack-destination', 'artifacts/packages'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const [pack] = JSON.parse(result.stdout);
  const files = new Set(pack.files.map(file => file.path));
  for (const file of ['dist/index.js', 'dist/index.d.ts', 'LICENSE-MIT', 'LICENSE-APACHE', 'NOTICE', 'SOURCE-PROVENANCE.json']) {
    assert(files.has(file), `${name}: missing packaged ${file}`);
  }
  const manifest = JSON.parse(readFileSync(`packages/${name}/package.json`, 'utf8'));
  if (name === 'wasm') assert(files.has('THIRD-PARTY-NOTICES'));
  for (const entry of Object.values(manifest.exports)) {
    for (const path of typeof entry === 'string' ? [entry] : Object.values(entry)) {
      assert(files.has(path.replace(/^\.\//, '')), `${name}: export ${path} absent from tarball`);
    }
  }
  assert.equal(manifest.private, true, 'Public registry publishing is gated by OSR-71');
  results.push(pack);
}
writeFileSync('artifacts/package-inventory.json', JSON.stringify(results, null, 2) + '\n');
console.log('6 private package tarballs: exports, declarations, assets and license notices verified');
