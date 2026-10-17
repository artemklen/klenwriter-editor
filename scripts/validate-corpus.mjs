// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { verifyCorpus, corpusRoot, sha256 } from './corpus-package.mjs';
import { canonicalizeRaw } from './canonical-reference/reference.mjs';

// Fixed original case ledger, independently extracted from licensed a7f8a081.
// Changing this seal requires an explicit compatibility decision, not rebuilding
// an integrity index after accidentally editing an existing golden expectation.
export const baselineSeal = '0f63a67e8f6dae84d899316bd18e23788198445695702c5d33e961b77262054b';
export const stages = ['validate_normalize', 'determinism', 'editor_round_trip_unchanged', 'editor_edit_save_reopen',
  'clipboard_plain_to_kwdj', 'clipboard_rich_to_kwdj', 'plain_text_projection', 'identity_manifest_extraction',
  'public_render', 'legacy_import_parse', 'schema_upconversion'];

export function parseFixture(bytes) {
  // Current corpus tokens are safe integers. A future raw u64 cannot silently
  // become Number: reject it until a lossless fixture transport is introduced.
  return JSON.parse(bytes, (_key, value, context) => {
    if (typeof value === 'number') {
      assert.ok(Number.isSafeInteger(value), 'Unsafe numeric fixture token');
      assert.match(context?.source ?? '', /^(0|[1-9][0-9]*|-[1-9][0-9]*)$/, 'Non-integer spelling in fixture data');
    }
    return value;
  });
}
export const caseHash = value => sha256(canonicalizeRaw(JSON.stringify(value)));
export function validateCorpus(root = corpusRoot) {
  const pkg = verifyCorpus(root), { manifest } = pkg;
  assert.deepEqual(manifest.normative_files, { document_schema: 'kwdj.schema.json', fixture_schema: 'fixture.schema.json', consumer_contract: 'README.md' });
  const warnings = [];
  const ajv = new Ajv2020({ strict: true, strictTypes: true, allErrors: true,
    logger: { log() {}, warn(message) { warnings.push(message); }, error(message) { warnings.push(message); } } });
  addFormats(ajv);
  const schema = JSON.parse(readFileSync(join(root, 'kwdj.schema.json')));
  const fixtureSchema = JSON.parse(readFileSync(join(root, 'fixture.schema.json')));
  assert.equal(schema.$id, 'urn:klenwriter:kwdj:v1');
  assert.equal(fixtureSchema.$id, 'urn:klenwriter:kwdj:v1:fixture-set');
  assert.equal(ajv.validateSchema(schema), true); assert.equal(ajv.validateSchema(fixtureSchema), true);
  ajv.addSchema(schema);
  const validateDocument = ajv.getSchema(schema.$id), validateSet = ajv.compile(fixtureSchema);
  const fixtures = [], cases = [], ids = new Set(), names = new Set();
  for (const file of manifest.fixture_files) {
    assert.ok(pkg.files.some(row => row.path === file), 'Unpinned fixture file');
    const set = parseFixture(readFileSync(join(root, file), 'utf8'));
    assert.equal(validateSet(set), true, JSON.stringify(validateSet.errors));
    for (let i = 0; i < set.fixtures.length; i++) {
      const fixture = set.fixtures[i];
      assert.ok(!ids.has(fixture.id), 'Duplicate fixture ID'); ids.add(fixture.id);
      fixtures.push({ file, pointer: `/fixtures/${i}`, fixture });
      for (const c of fixture.cases) {
        const id = `${fixture.id}/${c.name}`;
        assert.ok(!names.has(id), 'Duplicate case name'); names.add(id);
        assert.ok(c.pipeline_stages.every(stage => stages.includes(stage)), 'Unknown stage');
        if (c.expected.outcome === 'accepted' && c.kwdj !== null) {
          assert.equal(validateDocument(c.kwdj), true, `${id}: ${JSON.stringify(validateDocument.errors)}`);
          const expected = c.expected.normalized_kwdj === '$case.kwdj' ? c.kwdj : c.expected.normalized_kwdj;
          assert.equal(validateDocument(expected), true, `${id}: expected normalized schema`);
        }
        cases.push({ id, fixtureId: fixture.id, file, case: c });
      }
    }
  }
  assert.equal(warnings.length, 0, warnings.join('\n'));
  assert.equal(manifest.fixture_count, fixtures.length); assert.equal(manifest.fixture_case_count, cases.length);
  assert.equal(manifest.fixtures.length, fixtures.length);
  const indexedIds = new Set();
  for (const entry of manifest.fixtures) {
    assert.ok(!indexedIds.has(entry.id), 'Duplicate manifest ID'); indexedIds.add(entry.id);
    const actual = fixtures.find(row => row.file === entry.file && row.pointer === entry.pointer);
    assert.ok(actual, 'Manifest pointer does not resolve');
    assert.equal(actual.fixture.id, entry.id); assert.equal(actual.fixture.classification, entry.classification);
  }
  assert.deepEqual([...indexedIds].sort(), [...ids].sort(), 'Orphan fixture');
  // Every original case, including deferred/no-candidate/non-codec expectations,
  // stays byte-equivalent under the declared canonical JSON value rule.
  const baseline = JSON.parse(readFileSync(join(root, 'baseline-cases.json')));
  assert.equal(sha256(JSON.stringify(baseline.cases)), baselineSeal, 'Original baseline ledger seal changed');
  assert.equal(baseline.fixtureCount, 34); assert.equal(baseline.cases.length, 59);
  const originalIds = new Set(baseline.cases.map(c => c.id));
  assert.deepEqual(cases.filter(c => originalIds.has(c.id)).map(c => c.id), baseline.cases.map(c => c.id), 'Original case order changed');
  for (const original of baseline.cases) {
    const current = cases.find(c => c.id === original.id);
    assert.ok(current, 'Original case removed/renamed');
    assert.equal(caseHash(current.case), original.sha256, `Original expected/input changed: ${original.id}`);
  }
  if (cases.length !== 59) assert.notEqual(pkg.packageVersion, '1.0.0', 'Additive cases require a version bump');
  assert.equal(cases.filter(c => c.case.expected.outcome === 'deferred').length, 1);
  if (pkg.packageVersion === '1.0.0') assert.equal(pkg.contentSha256,
    'c3242ce26108229fbdf151af1e299d3cfe849c92738b0a2afbf733d12aef2b28',
    'Any change to the sealed 1.0.0 package requires a version bump');
  return { pkg, fixtures, cases, validateDocument, stageCounts: Object.fromEntries(stages.map(stage => [stage, cases.filter(c => c.case.pipeline_stages.includes(stage)).length])) };
}
