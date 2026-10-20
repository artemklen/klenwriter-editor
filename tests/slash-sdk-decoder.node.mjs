// SPDX-License-Identifier: MIT OR Apache-2.0
// Controlled SDK transport ownership only. No native text/window evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../packages/sdk/dist/index.js';
import { fakeModule, options } from './helpers/sdk-fake.mjs';
import { fakeV2Module, v2Options } from './helpers/sdk-v2-fake.mjs';

const point = () => ({ kind: 'text', node: 'leaf-1', offset: 3, affinity: 'after' });
const projection = request => ({ status: 'ok', value: {
  kind: 'text_window', stamp: request.stamp, selection: { anchor: point(), focus: point() },
  caret: point(), block: { node: 'block-1', type_id: 'org.example.fixture/paragraph', primitive: 'text_block' },
  ancestors: [], before: [{ node: 'leaf-1', from_utf16: 0, to_utf16: 3, text: 'a😀' }],
  after: [], before_stop: 'block', after_stop: 'block',
} });
async function open(change = value => value, callback = () => {}) {
  const fixture = fakeV2Module({
    open(session) { session.state.selection = { anchor: point(), focus: point() }; },
    call(request) {
      if (request.kind === 'text_window') { const value = projection(request); callback(); return JSON.stringify(change(value)); }
    },
  });
  const editor = createEditor({ input: new Uint8Array([65]), options: v2Options(), loader: async () => fixture.module });
  assert.equal((await editor.ready).status, 'ok');
  return { editor, fixture };
}
const read = (editor, before = 3) => editor.read({ kind: 'text_window', stamp: editor.capture(), before_utf16: before, after_utf16: 0 });

test('SDK2 text-window mock: immutable bounded read has no mutation queue or event pump', async () => {
  const { editor, fixture } = await open();
  try {
    const stamp = editor.capture(), resources = structuredClone(editor.resources());
    const response = read(editor);
    assert.deepEqual(structuredClone(response), structuredClone(projection({ stamp })));
    assert(Object.isFrozen(response.value.before[0]) && Object.isFrozen(response.value.block));
    assert.equal(editor.capture(), stamp); assert.deepEqual(editor.resources(), resources);
    assert.deepEqual(fixture.log.map(r => r.kind), ['text_window']);
    assert.equal(editor.submit({ kind: 'text_window', stamp, before_utf16: 3, after_utf16: 0 }).response.diagnostic.code, 'sdk.invalid_request_kind');
    assert.deepEqual(fixture.log.map(r => r.kind), ['text_window']);
  } finally { editor.destroy(); assert.equal(fixture.counts().live, 0); }
});

test('SDK2 text-window mock: copied stamp survives caller mutation during read', async () => {
  let request;
  const { editor } = await open(v => v, () => { request.stamp.revision = '99'; });
  try {
    const original = editor.capture();
    request = { kind: 'text_window', stamp: structuredClone(original), before_utf16: 3, after_utf16: 0 };
    const response = editor.read(request);
    assert.equal(response.status, 'ok'); assert.deepEqual(response.value.stamp, original);
    assert.equal(request.stamp.revision, '99'); assert.deepEqual(editor.capture(), original);
  } finally { editor.destroy(); }
});

test('SDK1 text-window mock: ABI1 refuses the new read before transport', async () => {
  const fixture = fakeModule(), editor = createEditor({ input: new Uint8Array([65]), options: options(), loader: async () => fixture.module });
  try {
    assert.equal((await editor.ready).status, 'ok');
    assert.equal(read(editor).diagnostic.code, 'sdk.invalid_request_kind'); assert.deepEqual(fixture.log, []);
  } finally { editor.destroy(); }
});

for (const [name, change] of [
  ['extra nested span field', v => { v.value.before[0].extra = true; return v; }],
  ['duplicate source span', v => { v.value.before.push(structuredClone(v.value.before[0])); return v; }],
  ['incorrect UTF16 span length', v => { v.value.before[0].to_utf16 = 2; return v; }],
  ['unpaired surrogate text', v => { v.value.before[0].text = 'a\ud800b'; return v; }],
  ['different full stamp', v => { v.value.stamp = { ...v.value.stamp, history_epoch: '1' }; return v; }],
  ['caret not actual directed focus', v => { v.value.caret.offset = 2; return v; }],
  ['noncollapsed selection', v => { v.value.selection.anchor.offset = 0; return v; }],
  ['extra ancestor payload', v => { v.value.ancestors = [{ node: 'container-1', type_id: 'org.example.fixture/container', primitive: 'container', children: [] }]; return v; }],
  ['total output above256', v => { v.value.before = [{ node: 'leaf-1', from_utf16: 0, to_utf16: 257, text: 'x'.repeat(257) }]; v.value.caret.offset = 257; v.value.selection.anchor.offset = 257; v.value.selection.focus.offset = 257; return v; }],
  ['raw reply above256KiB', v => { v.value.block.type_id = 'x'.repeat(256 * 1024); return v; }],
]) test(`SDK2 text-window mock: ${name} is a fatal read-only transport failure`, async () => {
  const { editor, fixture } = await open(change);
  const response = read(editor);
  assert.equal(response.status, 'fatal'); assert.equal(response.diagnostic.may_have_committed, false);
  assert.equal(response.diagnostic.category, 'transport'); assert.equal(editor.lifecycle, 'fatal');
  assert.deepEqual(fixture.counts(), { live: 0, destroyed: 1, freed: 1 }); editor.destroy();
});

test('SDK2 text-window mock: request-specific before cap is not replaced by total256', async () => {
  const { editor, fixture } = await open();
  const response = read(editor, 2);
  assert.equal(response.status, 'fatal'); assert.equal(response.diagnostic.may_have_committed, false);
  assert.deepEqual(fixture.counts(), { live: 0, destroyed: 1, freed: 1 }); editor.destroy();
});
