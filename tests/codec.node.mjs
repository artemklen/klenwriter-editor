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
  const paths = ['crates/wasm/src/codec.rs', 'crates/wasm/src/codec_browser.rs', 'crates/wasm/examples/codec.rs', 'packages/wasm/src/codec.ts', 'tests/codec.node.mjs', 'tests/support/codec-fixtures.mjs', 'provenance/kwdj-corpus.json', 'contracts/kwdj/v1/corpus-package.json'];
  const sourceHashes = Object.fromEntries(paths.map(path => [path, hash(readFileSync(path))]));
  writeFileSync('artifacts/codec-v1-report.json', JSON.stringify({ abi: 'kwdj-codec/1', source: 'contracts/kwdj/v1/corpus-package.json', sourceHashes,
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

test('codec ABI1 import rejects retired malformed metadata while native/WASM preserve valid normalization literals', () => {
  // Authored before executing the centralized direct-codec guard. These mirror
  // closed model rules, not canonical output learned from an implementation.
  const empty = '{"content":[{"content":[],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}';
  const plain = '{"content":[{"content":[{"text":"a","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}';
  const lines = '{"content":[{"content":[{"text":"a\\nb","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}';
  const spaces = '{"content":[{"content":[{"text":"a  b","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}';
  const refused = [
    ['empty_text_unknown_attr', { type: 'text', text: '', attrs: { extra: 1 } }, '/content/0/attrs'],
    ['empty_text_unknown_field', { type: 'text', text: '', extra: true }, '/content/0/extra'],
    ['empty_text_wrong_attrs_shape', { type: 'text', text: '', attrs: true }, '/content/0/attrs'],
    ['absent_color_unknown_attr', { type: 'text', text: 'a', marks: [{ type: 'text_color', attrs: { token: 'none', extra: 1 } }] }, '/content/0/extra'],
    ['absent_color_unknown_field', { type: 'text', text: 'a', marks: [{ type: 'text_color', attrs: { token: 'default' }, extra: true }] }, '/content/0/extra'],
    ['absent_highlight_unknown_attr', { type: 'text', text: 'a', marks: [{ type: 'highlight', attrs: { token: 'NONE', extra: 1 } }] }, '/content/0/extra'],
  ].map(([id, text, path]) => ({ id, text, expected: { status: 'refused', code: 'kwdj.unknown_attribute', path } }));
  const accepted = [
    ['empty', { type: 'text', text: '' }, empty],
    ['plain', { type: 'text', text: 'a' }, plain],
    ['known_casing_and_absent_tokens', { type: 'TeXt', text: 'a', marks: [{ type: 'TEXT_COLOR', attrs: { token: 'NoNe' } }, { type: 'HIGHLIGHT', attrs: { token: 'DeFaUlT' } }] }, plain],
    ['duplicate_absent_color_tokens', { type: 'text', text: 'a', marks: [{ type: 'text_color', attrs: { token: 'none' } }, { type: 'text_color', attrs: { token: 'default' } }] }, plain],
    ['duplicate_absent_highlight_tokens', { type: 'text', text: 'a', marks: [{ type: 'highlight', attrs: { token: 'none' } }, { type: 'highlight', attrs: { token: 'default' } }] }, plain],
    ['documented_newlines', { type: 'text', text: 'a\r\nb' }, lines],
    ['space_nbsp_exact', { type: 'text', text: 'a  b' }, spaces],
    ['valid_active_mark_on_empty_text', { type: 'text', text: '', marks: [{ type: 'strong' }] }, empty],
  ].map(([id, text, canonical]) => ({ id, text, expected: { status: 'accepted', canonical } }));
  const cases = [...refused, ...accepted];
  const requests = cases.map(c => ({ operation: 'normalize', input: JSON.stringify(document([{ type: 'paragraph', content: [c.text] }])), options: options() }));
  const nativeResults = native(requests), observations = [];
  for (const [index, c] of cases.entries()) {
    const request = requests[index], input = encode(request.input), original = input.slice();
    const actual = invoke('normalize', input, request.options);
    assert.deepEqual(actual, nativeResults[index], `${c.id}: actual native/WASM equality`);
    assert.equal(actual.abi, 'kwdj-codec/1'); assert.equal(actual.status, c.expected.status, c.id);
    if (actual.status === 'refused') {
      assert.equal(actual.diagnostic.code, c.expected.code, c.id); assert.equal(actual.diagnostic.path, c.expected.path, c.id);
    } else {
      assert.equal(actual.canonical_json, c.expected.canonical, `${c.id}: independently authored canonical bytes`);
      for (const operation of Object.keys(functions)) assert.equal(invoke(operation, encode(c.expected.canonical), request.options).canonical_json, c.expected.canonical, `${c.id}: ${operation} fixed point`);
    }
    assert.deepEqual(input, original, `${c.id}: original input ownership`);
    observations.push({ id: c.id, input: request.input, expected: c.expected, native: nativeResults[index], wasm: actual });
  }
  const paths = ['crates/kwdj/src/lib.rs', 'crates/kwdj/src/candidate_validate.rs', 'crates/kwdj/src/registry_guards.rs',
    'crates/kwdj/tests/import_closed_metadata.rs', 'crates/wasm/src/codec.rs', 'crates/wasm/src/codec_browser.rs', 'tests/codec.node.mjs'];
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/codec-import-closed-report.json', JSON.stringify({ format: 'kwdj-codec-import-closed/1', abi: 'kwdj-codec/1',
    sourceHashes: Object.fromEntries(paths.map(path => [path, hash(readFileSync(path))])),
    wasmSha256: hash(readFileSync('packages/wasm/dist/editor_wasm_bg.wasm')),
    nativeBinarySha256: hash(readFileSync(`target/debug/examples/codec${process.platform === 'win32' ? '.exe' : ''}`)),
    summary: { malformedRefused: 6, validControls: 8, nativeWasmComparisons: observations.length }, observations,
    scope: 'Actual codec ABI1 normalize calls and parsed native/WASM replies; original60-input/180-comparison corpus remains separate and unchanged.' }, null, 2) + '\n');
});

test('codec ABI1 preserves closed Document roots and bounds original unknown-key copying in native/WASM', () => {
  // Additive independent literals from import_closed_root.rs. Document exposes
  // only schema/schema_version/profile/content; root marks/attrs stay unknown.
  const empty = '{"content":[{"content":[],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}';
  const rootCases = [
    ['empty_marks', { marks: [] }, '/marks/marks'],
    ['absent_color_mark', { marks: [{ type: 'text_color', attrs: { token: 'none' } }] }, '/marks/marks'],
    ['absent_highlight_mark', { marks: [{ type: 'HIGHLIGHT', attrs: { token: 'DeFaUlT' } }] }, '/marks/marks'],
    ['active_mark', { marks: [{ type: 'strong' }] }, '/marks/marks'],
    ['empty_attrs', { attrs: {} }, '/attrs/attrs'],
    ['authored_attrs', { attrs: { title: 'keep authored data' } }, '/attrs/attrs'],
  ].map(([id, extra, path]) => ({ id, input: JSON.stringify({ ...document([{ type: 'paragraph', content: [] }]), ...extra }),
    expected: { status: 'refused', code: 'kwdj.unknown_attribute', path } }));
  const knownControl = { id: 'known_child_defaults_and_casing',
    input: '{"schema":"klenwriter.document","schema_version":1,"profile":"PrOsE","content":[{"type":"PARAGRAPH","content":[{"type":"TEXT","text":"","marks":[]}],"attrs":{}}]}',
    expected: { status: 'accepted', canonical: empty } };
  // Byte-for-byte the JSON serialization of the fixed map in the independent
  // import_header_budget.rs regression: a 4MiB tilde key below the 16MiB input
  // cap already needs 64MiB under the 16x original-header ownership policy.
  const largeKey = '~'.repeat(4 * 1024 * 1024);
  const largeInput = '{"content":[{"content":[{"text":"","type":"text",' + JSON.stringify(largeKey) + ':false}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}';
  assert.ok(encode(largeInput).length < 16 * 1024 * 1024);
  const budgetCases = [
    { id: 'four_mib_unknown_key', input: largeInput, expected: { status: 'refused', code: 'kwdj.admission_budget_exceeded', path: '', category: 'operational_admission' } },
    { id: 'small_escaped_unknown_key', input: '{"content":[{"content":[{"small~key":false,"text":"","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}',
      expected: { status: 'refused', code: 'kwdj.unknown_attribute', pathSuffix: '/small~0key' } },
  ];
  const cases = [...rootCases, knownControl, ...budgetCases];
  const requests = cases.map(c => ({ operation: 'normalize', input: c.input, options: options() }));
  const nativeResults = native(requests), observations = [];
  for (const [index, c] of cases.entries()) {
    const request = requests[index], input = encode(request.input), original = input.slice();
    const actual = invoke('normalize', input, request.options);
    assert.deepEqual(actual, nativeResults[index], `${c.id}: actual native/WASM equality`);
    assert.equal(actual.abi, 'kwdj-codec/1'); assert.equal(actual.status, c.expected.status, c.id);
    if (actual.status === 'refused') {
      assert.equal(actual.diagnostic.code, c.expected.code, c.id);
      if (c.expected.path !== undefined) assert.equal(actual.diagnostic.path, c.expected.path, c.id);
      if (c.expected.pathSuffix !== undefined) assert.ok(actual.diagnostic.path.endsWith(c.expected.pathSuffix), c.id);
      if (c.expected.category !== undefined) assert.equal(actual.diagnostic.category, c.expected.category, c.id);
    } else {
      assert.equal(actual.canonical_json, c.expected.canonical, `${c.id}: independent canonical literal`);
      for (const operation of Object.keys(functions)) assert.equal(invoke(operation, encode(c.expected.canonical), request.options).canonical_json, c.expected.canonical);
    }
    assert.deepEqual(input, original, `${c.id}: original input ownership`);
    observations.push({ id: c.id, inputBytes: input.length, inputSha256: hash(input), expected: c.expected, native: nativeResults[index], wasm: actual });
  }
  const paths = ['crates/kwdj/src/lib.rs', 'crates/kwdj/src/candidate_validate.rs', 'crates/kwdj/src/registry_guards.rs',
    'crates/kwdj/tests/import_closed_root.rs', 'crates/kwdj/tests/import_header_budget.rs',
    'crates/wasm/src/codec.rs', 'crates/wasm/src/codec_browser.rs', 'tests/codec.node.mjs'];
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/codec-import-root-budget-report.json', JSON.stringify({ format: 'kwdj-codec-import-root-budget/1', abi: 'kwdj-codec/1',
    sourceHashes: Object.fromEntries(paths.map(path => [path, hash(readFileSync(path))])),
    wasmSha256: hash(readFileSync('packages/wasm/dist/editor_wasm_bg.wasm')),
    nativeBinarySha256: hash(readFileSync(`target/debug/examples/codec${process.platform === 'win32' ? '.exe' : ''}`)),
    summary: { malformedRootRefused: 6, validControls: 1, operationalBudgetRefused: 1, escapedKeyRefused: 1, nativeWasmComparisons: observations.length }, observations,
    scope: 'Actual codec ABI1 normalize calls for additive root closure and fixed4MiB-key ownership budget. Earlier14metadata cases and original60-input/180-comparison corpus stay separate and unchanged. Input hashes avoid embedding the4MiB key in this report.' }, null, 2) + '\n');
});
