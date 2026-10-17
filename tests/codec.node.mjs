// SPDX-License-Identifier: MIT OR Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { corpus, options, document } from './support/codec-fixtures.mjs';
import init, { kwdjValidateV1, kwdjNormalizeV1, kwdjCanonicalV1 } from '../packages/wasm/dist/editor_wasm.js';
import { codecAbiV1 } from '../packages/wasm/dist/index.js';

const wasm = await init({ module_or_path: readFileSync('packages/wasm/dist/editor_wasm_bg.wasm') });
const functions = { validate: kwdjValidateV1, normalize: kwdjNormalizeV1, canonical: kwdjCanonicalV1 };
const encode = text => new TextEncoder().encode(text);
const invoke = (op, bytes, opts = options()) => JSON.parse(functions[op](bytes, opts));
const hash = text => createHash('sha256').update(text).digest('hex');
const built = spawnSync('cargo', ['build', '--quiet', '--locked', '-p', 'klenwriter-editor-wasm', '--example', 'codec'], { encoding: 'utf8' });
assert.equal(built.status, 0, built.stderr);
function native(requests) {
  const result = spawnSync(`target/debug/examples/codec${process.platform === 'win32' ? '.exe' : ''}`, [], {
    input: requests.map(r => JSON.stringify(r)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr);
  const responses = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(responses.length, requests.length); return responses;
}

test('pinned codec inputs agree in native and real Node WASM, with contract outcomes and exact bytes', () => {
  const { inputs, dispositions, summary } = corpus(), observations = [];
  const requests = inputs.flatMap(input => Object.keys(functions).map(operation => ({ operation, input: input.input, options: input.options })));
  let index = 0, accepted = 0, refused = 0;
  // Bound the test transport too: never retain all resource responses at once.
  for (let start = 0; start < requests.length; start += 8) {
    const batch = requests.slice(start, start + 8), expected = native(batch);
    for (let n = 0; n < batch.length; n++, index++) {
      const request = batch[n], input = inputs[Math.floor(index / 3)];
      const actual = invoke(request.operation, encode(request.input), request.options);
      assert.deepEqual(actual, expected[n], `${input.id}/${request.operation}: native/WASM drift`);
      assert.equal(actual.abi, codecAbiV1); assert.equal(actual.abi, 'kwdj-codec/1'); assert.equal(actual.operation, request.operation);
      if (request.operation === input.primary) {
        assert.equal(actual.status, input.expectedStatus, input.id);
        if (actual.status === 'accepted') {
          accepted++;
          if (input.expectedCanonical) assert.equal(actual.canonical_json, input.expectedCanonical, input.id);
          for (const code of input.expectedCodes ?? []) assert.ok(actual.normalization_events.includes(code), `${input.id}: missing event ${code}`);
          if (input.expectedManifests) {
            assert.deepEqual(actual.media_manifest, input.expectedManifests.media.map(m => ({ id: m.media_asset_id, path: m.locator })));
            assert.deepEqual(actual.reference_manifest, input.expectedManifests.references.map(m => ({ id: m.reference_entity_id, path: m.locator })));
          }
          // The accepted canonical bytes reopen through all three entry points.
          for (const op of Object.keys(functions)) {
            const repeated = invoke(op, encode(actual.canonical_json), request.options);
            assert.equal(repeated.status, 'accepted'); assert.equal(repeated.canonical_json, actual.canonical_json);
          }
        } else {
          refused++;
          if (input.resource) {
            assert.equal(actual.diagnostic.code, 'kwdj.resource_limit_exceeded');
            assert.equal(actual.diagnostic.limit, input.resource.name);
            assert.equal(actual.diagnostic.maximum, input.resource.maximum);
            assert.equal(actual.diagnostic.observed, input.resource.observed);
          } else assert.ok(input.expectedCodes.includes(actual.diagnostic.code), `${input.id}: ${actual.diagnostic.code}`);
        }
      }
      observations.push({ id: input.id, operation: request.operation, status: actual.status,
        canonicalSha256: actual.status === 'accepted' ? hash(actual.canonical_json) : null,
        diagnostic: actual.status === 'refused' ? actual.diagnostic : null });
    }
  }
  assert.equal(index, 180); assert.ok(accepted > 0 && refused > 0);
  mkdirSync('artifacts', { recursive: true });
  const paths = ['crates/wasm/src/codec.rs', 'crates/wasm/src/codec_browser.rs', 'crates/wasm/examples/codec.rs', 'packages/wasm/src/codec.ts', 'tests/codec.node.mjs', 'tests/support/codec-fixtures.mjs', 'provenance/codec-fixtures.json'];
  const sourceHashes = Object.fromEntries(paths.map(path => [path, hash(readFileSync(path))]));
  writeFileSync('artifacts/codec-v1-report.json', JSON.stringify({ abi: 'kwdj-codec/1', source: 'provenance/codec-fixtures.json', sourceHashes,
    wasmSha256: hash(readFileSync('packages/wasm/dist/editor_wasm_bg.wasm')),
    summary: { ...summary, expandedCodecInputs: inputs.length, nativeWasmComparisons: index, primaryAccepted: accepted, primaryRefused: refused }, dispositions, observations }, null, 2) + '\n');
});

test('borrowed host type/length admission is closed, preserves input and gives exact structured budgets', () => {
  const text = JSON.stringify(document([{ type: 'paragraph', content: [] }])), input = encode(text), before = input.slice();
  for (const op of Object.keys(functions)) {
    const smallRequests = [];
    for (const maximum of [0, input.length - 1, input.length, input.length + 1]) {
      const opts = options({ budget: { raw_input_bytes: String(maximum) } });
      smallRequests.push({ operation: op, input: text, options: opts });
      const actual = invoke(op, input, opts);
      assert.equal(actual.status, maximum < input.length ? 'refused' : 'accepted');
      if (actual.status === 'refused') assert.deepEqual(actual.diagnostic, { code: 'kwdj.admission_budget_exceeded', path: '', category: 'operational_admission', limit: 'raw_input_bytes', maximum: String(maximum), observed: String(input.length) });
    }
    const expected = native(smallRequests);
    smallRequests.forEach((r, i) => assert.deepEqual(invoke(op, input, r.options), expected[i]));
    assert.equal(invoke(op, encode('[x'), options({ budget: { raw_input_bytes: '2' } })).diagnostic.code, 'kwdj.invalid_json');
    assert.equal(invoke(op, new Uint8Array(), options({ budget: { raw_input_bytes: '0' } })).diagnostic.code, 'kwdj.invalid_json');
    assert.equal(invoke(op, input, options({ limits: { node_count: '0' } })).diagnostic.limit, 'node_count');
    assert.equal(invoke(op, input, options({ budget: { preflight_values: '0' } })).diagnostic.limit, 'preflight_values');
    assert.equal(invoke(op, input, options({ budget: { raw_input_bytes: '18446744073709551615' } })).status, 'accepted');
    const detached = new Uint8Array(2); structuredClone(detached, { transfer: [detached.buffer] });
    const invalid = [undefined, null, {}, [], '[x', new ArrayBuffer(2), new DataView(new ArrayBuffer(2)), new Uint16Array(2), new Uint8ClampedArray(2), new Proxy(input, {}), Object.create(Uint8Array.prototype), detached, new Uint8Array(new SharedArrayBuffer(2)), new Uint8Array(new ArrayBuffer(2, { maxByteLength: 4 }))];
    for (const value of invalid) assert.equal(invoke(op, value).diagnostic.code, 'codec.invalid_input_type');
    const memoryBefore = wasm.memory.buffer;
    assert.equal(invoke(op, new Uint8Array(memoryBefore, 0, 0)).diagnostic.code, 'codec.invalid_input_type');
    assert.ok(memoryBefore.byteLength > 0);
    for (const value of [undefined, null, {}, [], new String(options())]) assert.equal(JSON.parse(functions[op](input, value)).diagnostic.code, 'codec.invalid_options_type');
    for (const value of ['{}', 'not JSON', options({ extra: true }), options({ budget: { raw_input_bytes: 1 } }), options({ limits: { node_count: '01' } }), options({ budget: { unknown: '1' } })]) assert.equal(invoke(op, input, value).diagnostic.code, 'codec.invalid_options');
    assert.equal(invoke(op, input, options({ abi: 'kwdj-codec/2' })).diagnostic.code, 'codec.unsupported_abi');
    assert.equal(invoke(op, input, ' '.repeat(65537)).diagnostic.code, 'codec.options_too_large');
    const shadowed = encode(text);
    for (const key of ['length', 'buffer', 'byteLength']) Object.defineProperty(shadowed, key, { get() { throw new Error('shadow getter must not execute'); } });
    assert.equal(invoke(op, shadowed).status, 'accepted');
    assert.equal(invoke(op, shadowed, options({ budget: { raw_input_bytes: '0' } })).diagnostic.limit, 'raw_input_bytes');
  }
  assert.deepEqual(input, before);
});

test('u64 stays exact, normalization differs from strict validation, and identity facts never imply allow-all', () => {
  const raw = '{"schema":"klenwriter.document","schema_version":1,"profile":"poetry","content":[{"type":"verse","content":[{"type":"verse_line","content":[{"type":"text","text":"a"}]},{"type":"stanza_break","attrs":{"blank_lines":18446744073709551615}},{"type":"verse_line","content":[{"type":"text","text":"b"}]}]}]}';
  for (const op of Object.keys(functions)) {
    const actual = invoke(op, encode(raw)); assert.equal(actual.status, 'accepted');
    assert.match(actual.canonical_json, /"blank_lines":18446744073709551615/);
    assert.deepEqual(actual, native([{ operation: op, input: raw, options: options() }])[0]);
  }
  const unnormalized = encode(JSON.stringify(document([{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [] }] }])));
  assert.equal(invoke('validate', unnormalized).diagnostic.code, 'kwdj.non_normalized_empty_marks');
  assert.equal(invoke('canonical', unnormalized).diagnostic.code, 'kwdj.non_normalized_empty_marks');
  assert.equal(invoke('normalize', unnormalized).status, 'accepted');
  const id = '550e8400-e29b-41d4-a716-446655440013';
  const rawMedia = encode(JSON.stringify(document([{ type: 'media_image', attrs: { media_asset_id: id, alt: 'synthetic', align: 'center' }, content: [{ type: 'paragraph', content: [] }] }])));
  assert.equal(invoke('normalize', rawMedia).diagnostic.code, 'kwdj.identity_resolution_failed');
  for (const status of ['exists', 'missing', 'unavailable']) {
    const opts = options({ identities: { media: [{ id, status }], references: [] } });
    const actual = invoke('normalize', rawMedia, opts);
    assert.equal(actual.status, status === 'exists' ? 'accepted' : 'refused');
    if (status !== 'exists') assert.equal(actual.diagnostic.code, status === 'missing' ? 'kwdj.media_identity_unresolved' : 'kwdj.identity_resolution_failed');
    assert.deepEqual(actual, native([{ operation: 'normalize', input: new TextDecoder().decode(rawMedia), options: opts }])[0]);
  }
});

test('identity catalogs are bounded, explicit, closed and reject duplicate UUID aliases', () => {
  const input = encode(JSON.stringify(document([{ type: 'paragraph', content: [] }])));
  const entries = Array.from({ length: 257 }, (_, i) => ({ id: `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`, status: 'exists' }));
  for (const op of Object.keys(functions)) {
    assert.equal(invoke(op, input, options({ identities: { media: entries.slice(0, 256), references: [] } })).status, 'accepted');
    assert.equal(invoke(op, input, options({ identities: { media: entries, references: [] } })).diagnostic.code, 'codec.identity_catalog_limit');
    const fact = { id: '550e8400-e29b-41d4-a716-446655440013', status: 'exists' };
    assert.equal(invoke(op, input, options({ identities: { media: [fact, { ...fact, id: fact.id.toUpperCase() }], references: [] } })).diagnostic.code, 'codec.duplicate_identity');
    for (const invalid of [{ ...fact, extra: true }, { ...fact, status: true }, { ...fact, id: 'bad' }]) {
      assert.equal(invoke(op, input, options({ identities: { media: [invalid], references: [] } })).diagnostic.code, 'codec.invalid_options');
    }
  }
});
