// SPDX-License-Identifier: MIT OR Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyCorpus, fileEntries, contentDigest, corpusRoot, indexFile } from '../scripts/corpus-package.mjs';
import { validateCorpus, parseFixture } from '../scripts/validate-corpus.mjs';

function temporary(run) {
  const root = mkdtempSync(join(tmpdir(), 'kwdj-corpus-'));
  try { cpSync(corpusRoot, root, { recursive: true }); return run(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
function editJson(root, name, edit) {
  const path = join(root, name), value = JSON.parse(readFileSync(path));
  edit(value); writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}
function rebuildIndex(root) {
  editJson(root, indexFile, pkg => { pkg.files = fileEntries(root); pkg.contentSha256 = contentDigest(pkg.files); });
}
test('authoritative package schemas and all baseline manifest pointers validate strictly', () => {
  const result = validateCorpus();
  assert.equal(result.fixtures.length, 34); assert.equal(result.cases.length, 59);
  assert.equal(Object.values(result.stageCounts).reduce((a, b) => a + b, 0), 277);
});
test('integrity rejects edits, omitted files and unindexed files', () => {
  temporary(root => { writeFileSync(join(root, 'fixtures/positive.json'), '{}\n'); assert.throws(() => verifyCorpus(root), /digest mismatch/); });
  temporary(root => { rmSync(join(root, 'kwdj.schema.json')); assert.throws(() => verifyCorpus(root), /inventory|digest mismatch/); });
  temporary(root => { writeFileSync(join(root, 'unreviewed.json'), '{}\n'); assert.throws(() => verifyCorpus(root), /inventory|digest mismatch/); });
  temporary(root => { editJson(root, indexFile, p => { p.files[0].path = '../outside'; }); assert.throws(() => verifyCorpus(root), /file record/); });
});
test('duplicate manifest entries cannot conceal an orphan fixture', () => {
  temporary(root => {
    editJson(root, 'manifest.json', p => { p.fixtures[1] = structuredClone(p.fixtures[0]); });
    rebuildIndex(root); assert.throws(() => validateCorpus(root), /Duplicate manifest ID/);
  });
});
test('rebuilding a digest cannot hide an altered old golden expectation or missing case', () => {
  temporary(root => {
    editJson(root, 'fixtures/positive.json', p => { p.fixtures[0].cases[0].expected.full_text = 'changed'; });
    rebuildIndex(root); assert.throws(() => validateCorpus(root), /Original expected\/input changed/);
  });
  temporary(root => {
    editJson(root, 'fixtures/positive.json', p => { p.fixtures[0].cases[0].name = 'renamed'; });
    rebuildIndex(root); assert.throws(() => validateCorpus(root), /case order changed|removed\/renamed/);
  });
});
test('new cases require a version bump while preserving every original expectation', () => {
  temporary(root => {
    editJson(root, 'fixtures/positive.json', p => { p.fixtures[0].cases.push({ ...structuredClone(p.fixtures[0].cases[0]), name: 'additive_empty_prose' }); });
    editJson(root, 'manifest.json', p => { p.fixture_case_count = 60; });
    rebuildIndex(root); assert.throws(() => validateCorpus(root), /version bump/);
    editJson(root, 'manifest.json', p => { p.package_version = '1.0.1'; });
    editJson(root, indexFile, p => { p.packageVersion = '1.0.1'; });
    rebuildIndex(root); assert.equal(validateCorpus(root).cases.length, 60);
  });
});
test('unknown stages and unsafe number tokens fail closed instead of silently rounding/skipping', () => {
  temporary(root => {
    editJson(root, 'fixtures/positive.json', p => { p.fixtures[0].cases[0].pipeline_stages.push('invented_pass'); });
    rebuildIndex(root); assert.throws(() => validateCorpus(root));
  });
  for (const raw of ['{"x":18446744073709551615}', '{"x":9007199254740993}', '{"x":1e0}', '{"x":-0}']) assert.throws(() => parseFixture(raw));
  assert.deepEqual(parseFixture('{"x":9007199254740991}'), { x: 9007199254740991 });
});

test('rebuilding the index cannot silently reuse 1.0.0 for a non-case data change', () => {
  temporary(root => {
    writeFileSync(join(root, 'README.md'), readFileSync(join(root, 'README.md'), 'utf8') + '\nEdited metadata.\n');
    rebuildIndex(root); assert.throws(() => validateCorpus(root), /version bump/);
  });
});
