// SPDX-License-Identifier: MIT OR Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { corpus, options, document } from './support/codec-fixtures.mjs';
import { validateCorpus } from '../scripts/validate-corpus.mjs';
import { sha256 } from '../scripts/corpus-package.mjs';
import initProbe, { observeCorpusCase } from '../artifacts/corpus-observer/probe.js';
import initProduction, { kwdjValidateV1, kwdjNormalizeV1, kwdjCanonicalV1 } from '../packages/wasm/dist/editor_wasm.js';

await initProbe({ module_or_path: readFileSync('artifacts/corpus-observer/probe_bg.wasm') });
await initProduction({ module_or_path: readFileSync('packages/wasm/dist/editor_wasm_bg.wasm') });
const production = { validate: kwdjValidateV1, normalize: kwdjNormalizeV1, canonical: kwdjCanonicalV1 };
const encode = text => new TextEncoder().encode(text);
const runtimeHashes = Object.fromEntries([
  'packages/wasm/dist/editor_wasm_bg.wasm', 'artifacts/corpus-observer/probe_bg.wasm',
  'crates/wasm/examples/support/corpus_observer.rs', 'tests/corpus.node.mjs',
].map(path => [path, sha256(readFileSync(path))]));
const build = spawnSync('cargo', ['build', '--quiet', '--locked', '-p', 'klenwriter-editor-wasm', '--example', 'corpus_native'], { encoding: 'utf8' });
assert.equal(build.status, 0, build.stderr);
function native(requests) {
  const run = spawnSync(`target/debug/examples/corpus_native${process.platform === 'win32' ? '.exe' : ''}`, [], {
    input: requests.map(r => JSON.stringify(r)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(run.status, 0, run.stderr);
  const values = run.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(values.length, requests.length); return values;
}
const wasm = request => JSON.parse(observeCorpusCase(JSON.stringify(request)));
const actualProduction = request => {
  const bytes = encode(request.input), before = bytes.slice();
  const value = JSON.parse(production[request.operation](bytes, request.options));
  assert.deepEqual(bytes, before, 'The public boundary mutated original host bytes');
  return value;
};
const codecRequests = input => ({ operation: input.primary, input: input.input, options: input.options, projection: false });
const compact = observation => ({
  status: observation.codec.status,
  canonicalSha256: observation.codec.status === 'accepted' ? sha256(observation.codec.canonical_json) : null,
  normalizationEvents: observation.codec.normalization_events ?? null,
  manifests: observation.codec.status === 'accepted' ? { media: observation.codec.media_manifest, references: observation.codec.reference_manifest } : null,
  diagnostic: observation.codec.diagnostic ?? null,
  projection: observation.projection.status === 'accepted' ? { status: 'accepted',
    fullTextSha256: sha256(observation.projection.full_text), searchIndexSha256: sha256(observation.projection.search_index_text),
    publicSnippetSha256: sha256(observation.projection.public_snippet_text) } : observation.projection,
});

test('every declared corpus stage has an explicit runtime result; supported native/WASM stages agree', () => {
  const tree = validateCorpus(), source = corpus();
  const byId = new Map(tree.cases.map(c => [c.id, c]));
  const requests = source.inputs.map(input => ({ ...codecRequests(input), projection: byId.get(input.caseId).case.pipeline_stages.includes('plain_text_projection') }));
  const observations = [], byCase = new Map();
  for (let start = 0; start < requests.length; start += 4) {
    const batch = requests.slice(start, start + 4), expected = native(batch);
    for (let i = 0; i < batch.length; i++) {
      const request = batch[i], input = source.inputs[start + i], entry = byId.get(input.caseId);
      const observed = wasm(request);
      assert.deepEqual(observed, expected[i], `${input.id}: target parity`);
      assert.deepEqual(actualProduction(request), expected[i].codec, `${input.id}: actual production codec parity`);
      assert.deepEqual(wasm(request), observed, `${input.id}: deterministic WASM repeat`);
      assert.equal(observed.codec.status, input.expectedStatus, input.id);
      if (observed.codec.status === 'accepted') {
        if (input.expectedCanonical) assert.equal(observed.codec.canonical_json, input.expectedCanonical, input.id);
        if (request.projection) {
          assert.equal(observed.projection.status, 'accepted');
          for (const key of ['full_text', 'search_index_text', 'public_snippet_text']) assert.equal(observed.projection[key], entry.case.expected[key], `${input.id}/${key}`);
        }
      } else {
        for (const key of ['canonical_json', 'media_manifest', 'reference_manifest', 'normalization_events']) assert.equal(Object.hasOwn(observed.codec, key), false, 'Refusal exposed a partial artifact');
      }
      const row = { id: input.id, caseId: input.caseId, operation: request.operation, ...compact(observed),
        inputSha256: sha256(request.input), hostInputUnchanged: true, nativeWasmEqual: true, productionCodecEqual: true };
      observations.push(row);
      if (!byCase.has(input.caseId)) byCase.set(input.caseId, []);
      byCase.get(input.caseId).push(row);
    }
  }
  assert.equal(observations.length, 60);
  // Fresh native repeats are checked independently of the WASM repeat above.
  for (let start = 0; start < requests.length; start += 4) {
    const repeated = native(requests.slice(start, start + 4));
    repeated.forEach((row, i) => assert.deepEqual(compact(row), Object.fromEntries(Object.entries(observations[start + i]).filter(([key]) => ['status', 'canonicalSha256', 'normalizationEvents', 'manifests', 'diagnostic', 'projection'].includes(key)))));
  }
  const owners = { editor_round_trip_unchanged: 'OSR-45 mounted harness / editing owners', editor_edit_save_reopen: 'OSR-45 mounted harness / editing owners',
    clipboard_plain_to_kwdj: 'OSR-47/67 clipboard adapters', clipboard_rich_to_kwdj: 'OSR-47/67 clipboard adapters',
    public_render: 'CMS public renderer', legacy_import_parse: 'CMS migration/import adapters' };
  const runtimes = ['native-library', 'wasm-test-observer', 'node-production-codec'];
  const results = [];
  for (const entry of tree.cases) for (const stage of entry.case.pipeline_stages) for (const runtime of runtimes) {
    const measured = byCase.get(entry.id) ?? [];
    const row = { id: entry.id, stage, runtime, expectedOutcome: entry.case.expected.outcome };
    if (entry.case.expected.outcome === 'deferred') Object.assign(row, { result: 'deferred', owner: 'OSR-79 / approved later schema', reason: 'DOC-024 has no real later schema/upconverter; placeholder v2 is not executable evidence' });
    else if (owners[stage]) Object.assign(row, { result: 'not_owned', owner: owners[stage], reason: 'Expected value retained, but this library codec does not implement the owning component; never counted as pass' });
    else if (!measured.length) Object.assign(row, { result: 'not_applicable', owner: 'input adapter', reason: 'No KWDJ candidate exists for this codec stage' });
    else if (stage === 'plain_text_projection' && runtime === 'node-production-codec') Object.assign(row, { result: 'not_exposed', owner: 'OSR-63 SDK boundary', reason: 'Production codec ABI1 has no projection export; native/compiled-WASM projection is checked by the separate test observer' });
    else if (stage === 'schema_upconversion') {
      assert.equal(entry.fixtureId, 'DOC-018'); assert.ok(measured.every(o => o.diagnostic?.code === 'kwdj.unsupported_schema_version'));
      Object.assign(row, { result: 'passed', owner: 'KWDJ version admission', outcome: 'refused', capability: 'version_admission_only', reason: 'Actual unsupported-version refusal, not a successful upgrade' });
    } else {
      assert.ok(['validate_normalize', 'determinism', 'identity_manifest_extraction', 'plain_text_projection'].includes(stage));
      const refusalBlocksDerived = !['validate_normalize', 'determinism'].includes(stage) && measured.some(o => o.status === 'refused');
      Object.assign(row, refusalBlocksDerived ? { result: 'not_executed', owner: 'KWDJ profile', reason: 'Prior codec refusal prevents partial derived output' }
        : { result: 'passed', owner: 'KWDJ profile', outcome: measured[0].status, measurements: measured.map(m => m.id) });
    }
    results.push(row);
  }
  assert.equal(results.length, 831); assert.equal(new Set(results.map(r => r.stage)).size, 11);
  const count = key => Object.fromEntries([...new Set(results.map(r => r[key]))].sort().map(value => [value, results.filter(r => r[key] === value).length]));
  const report = { schema: 1, task: 'OSR-30', runtimeHashes, corpus: { version: tree.pkg.packageVersion, contentSha256: tree.pkg.contentSha256, indexSha256: tree.pkg.indexSha256 },
    baseline: { fixtureIds: 34, namedCases: 59, stageMemberships: 277, expandedCodecInputs: 60 },
    actualPublicCodec: { abi: 'kwdj-codec/1', primaryComparisons: 60, note: 'Separate test:codec also compares all three public operations (180) and boundary cases.' },
    projectionTransport: 'Trusted test-only observer; never installed or claimed as the public byte-admission API',
    counts: { byResult: count('result'), byRuntime: count('runtime'), primaryAccepted: observations.filter(o => o.status === 'accepted').length, primaryRefused: observations.filter(o => o.status === 'refused').length,
      deferredCases: tree.cases.filter(c => c.case.expected.outcome === 'deferred').map(c => c.id),
      noCandidateCases: tree.cases.filter(c => c.case.expected.outcome !== 'deferred' && !byCase.has(c.id)).map(c => c.id) },
    stageCounts: tree.stageCounts, observations, results };
  assert.equal(report.counts.primaryAccepted, 43); assert.equal(report.counts.primaryRefused, 17);
  assert.equal(report.counts.deferredCases.length, 1); assert.equal(report.counts.noCandidateCases.length, 5);
  mkdirSync('artifacts', { recursive: true }); writeFileSync('artifacts/corpus-stage-report.json', JSON.stringify(report, null, 2) + '\n');
});

test('versioned extension vectors retain reference proof and distinguish the uninstalled notes profile', () => {
  const bytes = readFileSync('contracts/kwdj/v1/extension-vectors.json');
  assert.deepEqual(bytes, readFileSync('evidence/osr-57/profile-vectors.json'));
  const vectors = JSON.parse(bytes);
  const run = spawnSync(process.execPath, ['scripts/check-m0-contracts.mjs'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const reference = JSON.parse(run.stdout);
  assert.equal(reference.failures, 0);
  assert.equal(reference.profileCases, vectors.profiles.length + vectors.negative.length + vectors.additionalPositive.length);
  assert.equal(reference.dependencyCases, vectors.dependencyVectors.length);
  assert.equal(reference.hashes['evidence/osr-57/profile-vectors.json'], sha256(bytes));
  const requests = vectors.profiles.flatMap(profile => Object.keys(production).map(operation => ({
    operation, input: JSON.stringify(profile.wire), options: options(),
  })));
  const expected = native(requests), wireResults = [];
  requests.forEach((request, i) => {
    const observed = wasm(request);
    assert.deepEqual(observed, expected[i]); assert.deepEqual(actualProduction(request), observed.codec);
    const profile = vectors.profiles[Math.floor(i / 3)];
    assert.equal(observed.codec.status, i < 3 ? 'accepted' : 'refused');
    wireResults.push({ profile: profile.id, operation: request.operation, inputSha256: sha256(request.input),
      status: observed.codec.status, diagnostic: observed.codec.diagnostic ?? null,
      nativeWasmProductionEqual: true,
      capability: i < 3 ? 'KWDJ codec admission' : 'safe refusal of an uninstalled wire format; notes support remains OSR-64' });
  });
  const referenceOnly = [
    ...vectors.profiles.map(p => ({ id: p.id, group: 'profile', expected: p.expected })),
    ...vectors.negative.map(p => ({ id: p.id, group: 'negative', expected: p.expected })),
    ...vectors.additionalPositive.map(p => ({ id: p.id, group: 'positive', expected: p.expected })),
    ...vectors.dependencyVectors.map((p, i) => ({ id: p.id ?? `dependency-${i + 1}`, group: 'dependency', expected: p.expectedRefusal ?? p.expectedOrder })),
  ].map(row => ({ ...row, result: 'reference_passed', productionResult: 'not_exposed', owner: 'OSR-64',
    reason: 'Executed frozen M0 descriptor reference; the public production extension registry is not implemented' }));
  writeFileSync('artifacts/corpus-extension-report.json', JSON.stringify({ schema: 1, sourceSha256: sha256(bytes),
    runtimeHashes, reference, referenceOnly, wireResults }, null, 2) + '\n');
});

test('related projection/admission hardening executes on native and compiled WASM without huge allocations', () => {
  const request = { operation: 'validate', input: '', options: options(), hardening: true };
  const actual = wasm(request), expected = native([request])[0];
  assert.deepEqual(actual, expected);
  assert.deepEqual(actual.hardening, { 'OSR-74': { assertion_groups: 6, status: 'passed' }, 'OSR-75': { assertion_groups: 9, status: 'passed' } });
  writeFileSync('artifacts/corpus-hardening-report.json', JSON.stringify({ schema: 1, nativeWasmEqual: true, ...actual }, null, 2) + '\n');
});

test('all corrected empty-variant fields refuse through actual codec exports, native and WASM observer', () => {
  const requests = [];
  for (const kind of ['hard_break', 'scene_break', 'strong', 'emphasis', 'strike', 'code', 'subscript', 'superscript']) for (const key of ['unexpected_ascii', '😀']) {
    const unit = { type: kind, [key]: false };
    const content = kind === 'scene_break' ? [unit] : [{ type: 'paragraph', content: kind === 'hard_break' ? [unit] : [{ type: 'text', text: 'synthetic', marks: [unit] }] }];
    for (const operation of Object.keys(production)) requests.push({ operation, input: JSON.stringify(document(content)), options: options() });
  }
  const expected = native(requests), rows = [];
  requests.forEach((request, i) => {
    const actual = wasm(request); assert.deepEqual(actual, expected[i]); assert.deepEqual(actualProduction(request), actual.codec);
    assert.equal(actual.codec.status, 'refused'); assert.equal(actual.codec.diagnostic.code, 'kwdj.unknown_attribute');
    rows.push({ operation: request.operation, inputSha256: sha256(request.input), diagnostic: actual.codec.diagnostic, classification: 'formerly discarded invalid fields; no valid canonical drift' });
  });
  assert.equal(rows.length, 48);
  writeFileSync('artifacts/corpus-invalid-fields-report.json', JSON.stringify({ schema: 1, nativeWasmProductionEqual: true, comparisons: 48, rows }, null, 2) + '\n');
});

test('u64MAX remains valid storage while projection refusal is typed and canonical input is retained', () => {
  const raw = '{"schema":"klenwriter.document","schema_version":1,"profile":"poetry","content":[{"type":"verse","content":[{"type":"verse_line","content":[{"type":"text","text":"a"}]},{"type":"stanza_break","attrs":{"blank_lines":18446744073709551615}},{"type":"verse_line","content":[{"type":"text","text":"b"}]}]}]}';
  const request = { operation: 'validate', input: raw, options: options(), projection: true };
  const actual = wasm(request); assert.deepEqual(actual, native([request])[0]); assert.deepEqual(actualProduction(request), actual.codec);
  assert.equal(actual.codec.status, 'accepted'); assert.match(actual.codec.canonical_json, /18446744073709551615/);
  assert.deepEqual(actual.projection, { status: 'refused', code: 'kwdj.projection_arithmetic_overflow', budget: null, maximum: null });
  writeFileSync('artifacts/corpus-projection-refusal.json', JSON.stringify({ schema: 1, nativeWasmEqual: true, classification: 'valid stored bytes, operational projection refusal', canonicalSha256: sha256(actual.codec.canonical_json), projection: actual.projection }, null, 2) + '\n');
});
