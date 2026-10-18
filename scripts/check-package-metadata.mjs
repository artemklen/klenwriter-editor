import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { identity } from './package-identity.mjs';

const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const result = spawnSync('cargo', ['metadata', '--no-deps', '--locked', '--format-version=1'], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
const cargo = JSON.parse(result.stdout);
const root = readJson('package.json');
assert.equal(identity.productName, 'KlenWriter Editor');
assert.equal(identity.license, 'MIT OR Apache-2.0');
assert.equal(identity.stage, 'unpublished-bootstrap');
assert.equal(identity.publishingGate, 'OSR-71');
assert.equal(root.version, identity.versions.packageSemver);
assert.equal(root.private, true);
assert.equal(identity.versions.kwdjSchemaVersion, 1);
assert.equal(identity.versions.kwdjProfileId, 'org.klenwriter.kwdj');
// OSR-63 defines editor-sdk/1 separately from package SemVer/KWDJ schema.
// A server native RPC protocol remains undefined; the shared DTO harness is not RPC.
assert.equal(identity.versions.publicHostApiRevision, 1);
assert.equal(identity.versions.nativeWireProtocolRevision, null);
assert.equal(identity.versions.wasmBindgenAbi, '0.2.129');
assert.deepEqual(Object.keys(identity.rust).sort(), ['core', 'engine', 'kwdj', 'wasm']);
assert.deepEqual(Object.keys(identity.web).sort(), ['angular', 'dom', 'kwdj', 'sdk', 'vanilla', 'wasm']);

const names = new Set();
const nativeInventory = [];
for (const [kind, entries] of Object.entries({ rust: identity.rust, web: identity.web })) {
  for (const [id, entry] of Object.entries(entries)) {
    assert(!names.has(entry.name), `duplicate distribution identity ${entry.name}`);
    names.add(entry.name);
    const expected = kind === 'rust' ? `klenwriter-editor-${id}`
      : id === 'vanilla' ? '@klenwriter/editor' : `@klenwriter/editor-${id}`;
    assert.equal(entry.name, expected);
    if (kind === 'rust') {
      const pkg = cargo.packages.find(pkg => pkg.name === entry.name);
      assert(pkg, `Cargo package missing: ${entry.name}`);
      assert.equal(pkg.version, identity.versions.packageSemver);
      assert.equal(pkg.license, identity.license);
      assert.equal(pkg.repository, identity.repository);
      assert.deepEqual(pkg.publish, [], 'Registry publication needs OSR-71');
      const policy = pkg.metadata['klenwriter-editor'];
      assert.equal(policy.role, id);
      assert.equal(policy['source-provenance'], 'SOURCE-PROVENANCE.json');
      assert.equal(policy['public-api-stability'], 'bootstrap');
      assert.equal(policy['stored-schema-version'], id === 'kwdj' ? 1 : undefined);
      assert.equal(policy['profile-id'], id === 'kwdj' ? identity.versions.kwdjProfileId : undefined);
      const listing = spawnSync('cargo', ['package', '--list', '--allow-dirty', '--offline', '--locked', '-p', entry.name], { encoding: 'utf8' });
      assert.equal(listing.status, 0, listing.stderr);
      const files = listing.stdout.trim().split('\n');
      for (const file of ['LICENSE-MIT', 'LICENSE-APACHE', 'NOTICE', 'SOURCE-PROVENANCE.json']) {
        assert(files.includes(file), `${entry.name}: missing source-package ${file}`);
      }
      nativeInventory.push({ name: entry.name, files });
    } else {
      const pkg = readJson(`${entry.path}/package.json`);
      assert.equal(pkg.name, entry.name);
      assert.equal(pkg.version, identity.versions.packageSemver);
      assert.equal(pkg.license, identity.license);
      assert.equal(pkg.repository.url.replace(/\.git$/, ''), identity.repository);
      assert.equal(pkg.repository.directory, entry.path);
      assert.equal(pkg.private, true, 'Registry publication needs OSR-71');
      assert(pkg.files.includes('SOURCE-PROVENANCE.json'));
      assert.equal(pkg.klenwriterEditor.role, id);
      assert.equal(pkg.klenwriterEditor.sourceProvenance, 'SOURCE-PROVENANCE.json');
      assert.equal(pkg.klenwriterEditor.publicApiStability, 'bootstrap');
      assert.equal(pkg.klenwriterEditor.storedSchemaVersion, id === 'kwdj' ? 1 : undefined);
      assert.equal(pkg.klenwriterEditor.profileId, id === 'kwdj' ? identity.versions.kwdjProfileId : undefined);
    }
    for (const file of ['LICENSE-MIT', 'LICENSE-APACHE']) {
      assert.deepEqual(readFileSync(`${entry.path}/${file}`), readFileSync(file), `${entry.name}: ${file} drift`);
    }
    assert.deepEqual(readFileSync(`${entry.path}/SOURCE-PROVENANCE.json`), readFileSync('provenance/source-files.json'),
      `${entry.name}: stale or missing bundled source provenance`);
    const notice = readFileSync(`${entry.path}/NOTICE`, 'utf8');
    assert(notice.includes(identity.productName) && notice.includes(identity.license));
    assert(notice.includes('Copyright 2026 Artem Klen'));
    assert(notice.includes('SOURCE-PROVENANCE.json'));
  }
}
const observation = readJson('evidence/osr-54/availability.json');
assert.deepEqual(observation.records.map(item => item.name).sort(), [...names].sort());
assert(observation.records.every(item => item.status === 404));
assert(Number.isFinite(Date.parse(observation.observedAt)));
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/native-package-inventory.json', JSON.stringify(nativeInventory, null, 2) + '\n');
console.log('10 distribution identities: names, independent version namespaces, SPDX, license texts and bundled provenance verified; publishing remains gated');
