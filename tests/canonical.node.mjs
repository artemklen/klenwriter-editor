// SPDX-License-Identifier: MIT OR Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { canonicalizeRaw } from '../scripts/canonical-reference/reference.mjs';
const fixture = 'crates/core/tests/canonical-v1.json';
const vectors = JSON.parse(readFileSync(fixture));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');

test('fixed expected bytes agree with native Rust and an independent lossless JS reference', () => {
  const run = spawnSync('cargo', ['run', '--quiet', '--locked', '-p', 'klenwriter-editor-core', '--example', 'canonical_vectors'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(run.status, 0, run.stderr);
  const native = JSON.parse(run.stdout);
  assert.equal(native.rule, vectors.rule);
  assert.equal(native.cases.length, vectors.cases.length);
  const results = vectors.cases.map((vector, index) => {
    assert.equal(native.cases[index].id, vector.id);
    let reference;
    try { reference = { canonical: canonicalizeRaw(vector.input) }; }
    catch (error) {
      assert(error instanceof SyntaxError || error instanceof RangeError, `unexpected reference error: ${vector.id}`);
      reference = { refused: true };
    }
    if (vector.refuse) {
      assert.equal(native.cases[index].refused, true, `native ${vector.id}`);
      assert.equal(reference.refused, true, `reference ${vector.id}`);
    } else {
      assert.equal(native.cases[index].canonical, vector.expected, `native ${vector.id}`);
      assert.equal(reference.canonical, vector.expected, `reference ${vector.id}`);
      assert.equal(reference.canonical, native.cases[index].canonical, `parity ${vector.id}`);
    }
    return { id: vector.id, status: 'pass', refused: vector.refuse === true,
      inputSHA256: createHash('sha256').update(vector.input).digest('hex'),
      ...(vector.refuse ? {} : { canonicalSHA256: createHash('sha256').update(vector.expected).digest('hex') }) };
  });
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/canonical-v1-report.json', JSON.stringify({ schema: 1, issue: 'OSR-77', rule: vectors.rule,
    scope: 'Fixed synthetic representation vectors; independent JS reference, not complete CMS corpus or an exhaustive binary64 proof',
    provenance: vectors.provenance, sources: Object.fromEntries([fixture, 'scripts/canonical-reference/reference.mjs', 'crates/core/src/json.rs', 'crates/core/examples/canonical_vectors.rs', 'Cargo.lock'].map(path => [path, hash(path)])),
    node: process.version, nativeCommand: ['cargo', 'run', '--quiet', '--locked', '-p', 'klenwriter-editor-core', '--example', 'canonical_vectors'], cases: results,
    summary: { passed: results.length, refused: results.filter(result => result.refused).length } }, null, 2) + '\n');
});

test('reference would detect default JS precision loss and UTF-16 ordering', () => {
  assert.notEqual(JSON.stringify(JSON.parse('9007199254740993')), canonicalizeRaw('9007199254740993'));
  const input = '{"😀":1,"\\ue000":2}';
  const parsed = JSON.parse(input);
  const utf16 = '{' + Object.keys(parsed).sort().map(key => JSON.stringify(key) + ':' + parsed[key]).join(',') + '}';
  assert.notEqual(utf16, canonicalizeRaw(input));
  assert.notEqual(canonicalizeRaw('1'), canonicalizeRaw('1.0'));
  assert.notEqual(canonicalizeRaw('0'), canonicalizeRaw('-0'));
});
