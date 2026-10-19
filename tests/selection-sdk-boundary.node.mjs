// SPDX-License-Identifier: MIT OR Apache-2.0
// Controlled SDK transport/typing ownership, not real native range evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../packages/sdk/dist/index.js';
import { fakeModule, options as legacyOptions } from './helpers/sdk-fake.mjs';
import { fakeV2Module, v2Options } from './helpers/sdk-v2-fake.mjs';

const point = { kind: 'text', node: 'leaf-1', offset: 0, affinity: 'after' };
function projection(request) {
  return { status: 'ok', value: { kind: 'selection_text', stamp: request.stamp,
    selection: { anchor: point, focus: point }, projection_id: 'org.example.fixture/selection-text/1', text: '', empty: true, selected_atoms: [] } };
}
async function open(change = value => value, mutateRequest = () => {}) {
  const fixture = fakeV2Module({ call(request) {
    if (request.kind === 'selection_text') { const value = projection(request); mutateRequest(); return JSON.stringify(change(value)); }
  } });
  const editor = createEditor({ input: new Uint8Array([65]), options: v2Options(), loader: async () => fixture.module });
  assert.equal((await editor.ready).status, 'ok'); return { fixture, editor };
}

test('SDK2 selection read boundary: exact bounded immutable result, no event pump or queued mutation', async () => {
  const { fixture, editor } = await open();
  try {
    const before = structuredClone(editor.resources()), stamp = editor.capture();
    const result = editor.read({ kind: 'selection_text', stamp, max_bytes: 1024 });
    assert.deepEqual(structuredClone(result), structuredClone(projection({ stamp }))); assert(Object.isFrozen(result) && Object.isFrozen(result.value.selection));
    assert.deepEqual(editor.resources(), before); assert.equal(editor.capture(), stamp);
    const calls = fixture.log.map(request => request.kind); assert.deepEqual(calls, ['selection_text']);
    assert.equal(editor.submit({ kind: 'selection_text', stamp, max_bytes: 1024 }).response.diagnostic.code, 'sdk.invalid_request_kind');
    assert.deepEqual(fixture.log.map(request => request.kind), calls, 'read never enters mutation queue');
  } finally { editor.destroy(); assert.equal(fixture.counts().live, 0); }
});

test('SDK2 selection read boundary: ownership compares copied stamp rather than caller mutation during transport', async () => {
  let request;
  const { editor } = await open(value => value, () => { request.stamp.generation = '2'; });
  try {
    const original = editor.capture(); request = { kind: 'selection_text', stamp: structuredClone(original), max_bytes: 1024 };
    const result = editor.read(request); assert.equal(result.status, 'ok'); assert.deepEqual(result.value.stamp, original);
    assert.equal(request.stamp.generation, '2'); assert.deepEqual(editor.capture(), original);
  } finally { editor.destroy(); }
});

test('legacy selection read boundary: new kind is rejected before ABI1 transport', async () => {
  const fixture = fakeModule(), editor = createEditor({ input: new Uint8Array([65]), options: legacyOptions(), loader: async () => fixture.module });
  try {
    assert.equal((await editor.ready).status, 'ok');
    const result = editor.read({ kind: 'selection_text', stamp: editor.capture(), max_bytes: 0 });
    assert.equal(result.status, 'refused'); assert.equal(result.diagnostic.code, 'sdk.invalid_request_kind'); assert.deepEqual(fixture.log, []);
  } finally { editor.destroy(); }
});

for (const [name, change] of [
  ['unknown field', value => ({ ...value, value: { ...value.value, extra: true } })],
  ['null directed selection', value => ({ ...value, value: { ...value.value, selection: null } })],
  ['false semantic empty payload', value => ({ ...value, value: { ...value.value, text: 'x', empty: true } })],
  ['duplicate atom membership', value => ({ ...value, value: { ...value.value, selected_atoms: ['same', 'same'], empty: false } })],
  ['unsafe numeric stamp', value => ({ ...value, value: { ...value.value, stamp: { ...value.value.stamp, revision: 9007199254740992 } } })],
  ['over-limit UTF8 text', value => ({ ...value, value: { ...value.value, text: 'Я'.repeat(524289), empty: false } })],
]) test(`SDK2 selection read boundary: ${name} is fatal with read-only provenance`, async () => {
  const { fixture, editor } = await open(change);
  const result = editor.read({ kind: 'selection_text', stamp: editor.capture(), max_bytes: 1048576 });
  assert.equal(result.status, 'fatal'); assert.equal(result.diagnostic.may_have_committed, false);
  assert.equal(result.diagnostic.category, 'transport'); assert.equal(editor.lifecycle, 'fatal');
  assert.deepEqual(fixture.counts(), { live: 0, destroyed: 1, freed: 1 }); editor.destroy();
});
