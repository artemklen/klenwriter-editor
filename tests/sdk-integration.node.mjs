// SPDX-License-Identifier: MIT OR Apache-2.0
// Actual packaged release WASM + public controller; no controlled/fake bridge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { literaryFixture, warningFixture } from './support/codec-fixtures.mjs';
import { readFileSync } from 'node:fs';
import { createCommand, createEditor, loadSdk, loadSdkV2 } from '../packages/sdk/dist/index.js';
import { kwdjCommand } from '../packages/kwdj/dist/index.js';
import { canonicalizeRaw } from '../scripts/canonical-reference/reference.mjs';
import { spoilerDisclosureFixture } from './support/codec-fixtures.mjs';

let modulePromise;
const productionModule = () => modulePromise ??= loadSdk({ wasm: new Uint8Array(readFileSync(new URL('../packages/wasm/dist/editor_wasm_bg.wasm', import.meta.url))) });
const document = text => ({ schema: 'klenwriter.document', schema_version: 1, profile: 'prose', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const source = value => typeof value === 'string' ? value : JSON.stringify(value);
const completed = submission => { assert.equal(submission.status, 'completed'); return submission.response; };
const settled = submission => submission.status === 'queued' ? submission.completion : Promise.resolve(submission.response);
const accepted = response => { assert.equal(response.status, 'ok', JSON.stringify(response)); return response.value; };
const refused = response => { assert.equal(response.status, 'refused', JSON.stringify(response)); return response.diagnostic; };
const state = editor => accepted(editor.read({ kind: 'state' })).state;
const node = (editor, id, stamp = editor.capture()) => accepted(editor.read({ kind: 'node', stamp, node: id })).node;
const root = editor => node(editor, state(editor).root);
const textLeaf = (editor, paragraphIndex = 0) => node(editor, node(editor, root(editor).children[paragraphIndex]).children[0]);
const position = (id, offset) => ({ kind: 'text', node: id, offset, affinity: 'after' });
const commandRequest = (editor, intent, history_hint = { kind: 'isolated' }, stamp = editor.capture()) => ({ kind: 'command', stamp, command: kwdjCommand(intent), history_hint });
const command = (editor, intent, hint) => editor.submit(commandRequest(editor, intent, hint));
function select(editor, leaf, offset) {
  const point = position(leaf, offset);
  return accepted(completed(editor.submit({ kind: 'set_selection', stamp: editor.capture(), selection: { anchor: point, focus: point } })));
}
const snapshot = editor => {
  const reply = accepted(completed(editor.submit({ kind: 'snapshot', stamp: editor.capture(), max_bytes: 16 * 1024 * 1024 })));
  assert.equal(reply.kind, 'snapshot'); return reply;
};
const release = (editor, handle) => accepted(completed(editor.submit({ kind: 'release_snapshot', handle })));
const canonical = editor => { const receipt = snapshot(editor); const value = receipt.canonical_json; release(editor, receipt.handle); return value; };
const counts = module => JSON.parse(module.resourceCounts());

test('packaged KWDJ helper: rejects accessors without invoking them', () => {
  let reads = 0;
  const kindGetter = { get kind() { reads++; return 'insert_text'; }, text: 'keep' };
  assert.throws(() => kwdjCommand(kindGetter));
  assert.equal(reads, 0);
  const nestedGetter = { kind: 'toggle_mark', mark: { type_id: 'org.klenwriter.kwdj/strong', attributes: {
    get extra() { reads++; return { kind: 'string', value: 'keep' }; },
  } } };
  assert.throws(() => kwdjCommand(nestedGetter));
  assert.equal(reads, 0);
});

test('packaged KWDJ helper: rejects toJSON without invoking it', () => {
  let calls = 0;
  const intent = { kind: 'insert_text', text: 'keep', toJSON() { calls++; return { kind: 'insert_text', text: 'changed' }; } };
  assert.throws(() => kwdjCommand(intent));
  assert.equal(calls, 0);
});

test('packaged KWDJ helper: owns plain data and rejects inherited command names', () => {
  const intent = Object.assign(Object.create(null), { kind: 'insert_text', text: 'Я 😀\u00a0e\u0301' });
  const command = kwdjCommand(intent);
  intent.text = 'later';
  assert.deepEqual(command, { id: 'org.klenwriter.kwdj/command/insert-text', payload_json: '{"kind":"insert_text","text":"Я 😀\u00a0e\u0301"}' });
  for (const kind of ['toString', 'constructor', '__proto__', 'unknown']) assert.throws(() => kwdjCommand({ kind }));
  const mark = kwdjCommand({ kind: 'toggle_mark', mark: { type_id: 'org.klenwriter.kwdj/strong', attributes: {
    count: { kind: 'number', value: '18446744073709551615' },
  } } });
  assert.equal(JSON.parse(mark.payload_json).mark.attributes.count.value, '18446744073709551615');
});

test('packaged command helper: captures payload before caller mutation without executing hooks', () => {
  const payload = { text: 'keep', nested: [{ value: '18446744073709551615' }] };
  const command = createCommand('org.example.notes/command/insert', payload);
  payload.text = 'changed'; payload.nested[0].value = '0';
  assert.deepEqual(JSON.parse(command.payload_json), { text: 'keep', nested: [{ value: '18446744073709551615' }] });
  let calls = 0;
  assert.throws(() => createCommand('org.example.notes/command/insert', { get text() { calls++; return 'unsafe'; } }));
  assert.throws(() => createCommand('org.example.notes/command/insert', { toJSON() { calls++; return {}; } }));
  assert.equal(calls, 0);
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => createCommand('org.example.notes/command/insert', cyclic));
});

async function open(input = document('abc'), optionOverrides = {}, controllerOverrides = {}) {
  const module = await productionModule(), baseline = counts(module), callbackErrors = [];
  const options = { abi: module.manifest.abi, build_id: module.manifest.build_id, profile: structuredClone(module.manifest.profiles[0]), admission: 'validate', access: 'editable', identities: { media: [], references: [] }, limits: null, ...optionOverrides };
  const editor = createEditor({ input: new TextEncoder().encode(source(input)), options, loader: async () => module, onCallbackError: error => callbackErrors.push(error), ...controllerOverrides });
  const ready = await editor.ready;
  if (ready.status !== 'ok') { editor.destroy(); assert.fail(JSON.stringify(ready)); }
  const close = () => {
    editor.destroy();
    assert.deepEqual(counts(module), baseline, 'actual Rust Session/snapshot/protection ownership returns to baseline');
    const own = editor.resources();
    for (const field of ['sessions', 'listeners', 'queued_mutations', 'queued_bytes', 'pending_tickets', 'host_requests', 'task_continuations', 'original_input_bytes', 'callback_error_handlers']) assert.equal(own[field], 0, field);
  };
  return { editor, module, baseline, callbackErrors, close };
}

test('packaged SDK: real catalog, text command, revisioned reads, snapshot and exact undo/redo', async () => {
  const context = await open(); const { editor } = context;
  try {
    const commands = accepted(editor.read({ kind: 'catalog' })).commands;
    assert.equal(commands.length, 17);
    assert(commands.includes('org.klenwriter.kwdj/command/delete-selection'));
    const leaf = textLeaf(editor).id; select(editor, leaf, 2);
    const events = []; editor.subscribe(event => events.push(event));
    const before = editor.capture();
    const query = accepted(editor.query({ kind: 'query_command', stamp: before, command: kwdjCommand({ kind: 'insert_text', text: 'X' }) }));
    assert.equal(query.available, true); assert.equal(query.effect, 'changed'); assert.deepEqual(editor.capture(), before); assert.equal(events.length, 0);
    assert.equal(accepted(completed(command(editor, { kind: 'insert_text', text: 'X' }))).effect, 'changed');
    assert.deepEqual(JSON.parse(canonical(editor)), document('abXc'));
    assert.equal(events.length, 1); assert.equal(events[0].change.kind, 'document');
    assert.equal(events[0].before.revision, '0'); assert.equal(events[0].after.revision, '1');
    assert.equal(node(editor, leaf).text, 'abXc');
    assert.equal(node(editor, leaf).stats.text_utf16, '4');
    assert.equal(refused(editor.read({ kind: 'node', stamp: before, node: leaf })).code, 'session.stale_revision');
    const undo = accepted(editor.query({ kind: 'query_history', stamp: editor.capture(), direction: 'undo' })); assert.equal(undo.available, true);
    accepted(completed(editor.submit({ kind: 'history', stamp: editor.capture(), direction: 'undo' })));
    assert.deepEqual(JSON.parse(canonical(editor)), document('abc'));
    accepted(completed(editor.submit({ kind: 'history', stamp: editor.capture(), direction: 'redo' })));
    assert.deepEqual(JSON.parse(canonical(editor)), document('abXc'));
    assert.deepEqual(events.map(e => e.after.revision), ['1', '2', '3']);
    assert.equal(context.callbackErrors.length, 0);
  } finally { context.close(); }
});

test('packaged SDK2 preserves the scene break through insert, remove, clipboard and reopen', async () => {
  const fixture = JSON.parse(readFileSync(new URL('../artifacts/extensions/packet.json', import.meta.url)));
  const wasm = readFileSync(new URL('../packages/wasm/dist/editor_wasm_bg.wasm', import.meta.url));
  const module = await loadSdkV2({ wasm: new Uint8Array(wasm) });
  const baseline = counts(module);
  const options = {
    abi: 'editor-sdk/2', build_id: module.manifest.build_id, profile: fixture.kwdjProfile,
    admission: 'validate', access: 'editable', registry_json: fixture.kwdjRegistryJson,
    profile_options_json: JSON.stringify({ identities: { media: [], references: [] }, limits: null }),
  };
  const left = { content: [{ text: 'До сцены', type: 'text' }], type: 'paragraph' };
  const right = { content: [{ text: 'После сцены', type: 'text' }], type: 'paragraph' };
  const scene = { type: 'scene_break' };
  const expected = content => JSON.stringify({ content, profile: 'prose', schema: 'klenwriter.document', schema_version: 1 });
  const original = expected([left, right]);
  const withScene = expected([left, scene, right]);
  const make = input => createEditor({ input: new TextEncoder().encode(input), options, loader: async () => module });
  const editor = make(original);
  const choose = (anchor, focus = anchor) => accepted(completed(editor.submit({
    kind: 'set_selection', stamp: editor.capture(), selection: { anchor, focus },
  })));
  const history = direction => accepted(completed(editor.submit({ kind: 'history', stamp: editor.capture(), direction })));
  const change = intent => assert.equal(accepted(completed(command(editor, intent))).effect, 'changed');
  const undoRedo = (before, after) => {
    history('undo');
    assert.equal(canonical(editor), before);
    history('redo');
    assert.equal(canonical(editor), after);
  };
  try {
    accepted(await editor.ready);
    assert.equal(canonical(editor), original);
    const parent = state(editor).root;
    const originalIds = root(editor).children.slice();
    const gap = { kind: 'child', parent, index: 1, affinity: 'after' };
    choose(gap);
    change({ kind: 'insert_block', target: { kind: 'scene_break' } });
    assert.equal(canonical(editor), withScene);
    const [first, atom, last] = root(editor).children;
    assert.deepEqual([first, last], originalIds);
    const projected = node(editor, atom);
    assert.equal(projected.type_id, 'org.klenwriter.kwdj/scene_break');
    assert.equal(projected.primitive, 'block_atom');
    assert.deepEqual(projected.children, []);
    assert.equal(Object.keys(projected.attributes).length, 0);
    undoRedo(original, withScene);

    choose({ kind: 'edge', node: atom, side: 'before' }, { kind: 'edge', node: atom, side: 'after' });
    const stamp = editor.capture();
    const copied = accepted(editor.read({ kind: 'selection_fragment', stamp, max_bytes: 2048 }));
    assert.equal(copied.kind, 'selection_fragment');
    assert.equal(copied.empty, false);
    const fragment = JSON.parse(copied.fragment_json);
    assert.deepEqual([fragment.kind, fragment.content, fragment.open_start, fragment.open_end],
      ['blocks', [scene], false, false]);
    assert.deepEqual(editor.capture(), stamp);
    change({ kind: 'remove', node: atom });
    assert.equal(canonical(editor), original);
    undoRedo(withScene, original);

    choose(gap);
    const paste = createCommand('org.klenwriter.kwdj/command/insert-fragment', {
      kind: 'insert_fragment', fragment_json: copied.fragment_json,
    });
    assert.equal(accepted(completed(editor.submit({
      kind: 'command', stamp: editor.capture(), command: paste, history_hint: { kind: 'isolated' },
    }))).effect, 'changed');
    undoRedo(original, withScene);
    const [retainedLeft, pasted, retainedRight] = root(editor).children;
    assert.deepEqual([retainedLeft, retainedRight], originalIds);
    assert.notEqual(pasted, atom);

    const reopened = make(canonical(editor));
    try {
      accepted(await reopened.ready);
      assert.equal(canonical(reopened), withScene);
      assert.equal(node(reopened, root(reopened).children[1]).primitive, 'block_atom');
    } finally {
      accepted(await settled(reopened.destroy()));
    }
  } finally {
    accepted(await settled(editor.destroy()));
    assert.deepEqual(counts(module), baseline);
  }
});

test('OSR-141 packaged SDK2 preserves media identity and caption through move, clipboard, history and reopen', async () => {
  const packet = JSON.parse(readFileSync(new URL('../artifacts/extensions/packet.json', import.meta.url)));
  const corpus = JSON.parse(readFileSync(new URL('../contracts/kwdj/v1/fixtures/positive.json', import.meta.url)));
  const fixture = corpus.fixtures.find(item => item.id === 'DOC-013').cases[0];
  const media = fixture.kwdj.content.find(item => item.type === 'media_image');
  const mediaId = media.attrs.media_asset_id;
  assert(fixture.input.identity_state.existing_media_ids.includes(mediaId));
  const wasm = readFileSync(new URL('../packages/wasm/dist/editor_wasm_bg.wasm', import.meta.url));
  const module = await loadSdkV2({ wasm: new Uint8Array(wasm) });
  const baseline = counts(module);
  const options = {
    abi: 'editor-sdk/2', build_id: module.manifest.build_id, profile: packet.kwdjProfile,
    admission: 'validate', access: 'editable', registry_json: packet.kwdjRegistryJson,
    profile_options_json: JSON.stringify({ identities: { media: [{ id: mediaId, status: 'exists' }], references: [] }, limits: null }),
  };
  const left = document('Before').content[0];
  const right = document('After').content[0];
  const expected = content => canonicalizeRaw(JSON.stringify({ ...document(''), content }));
  const initial = expected([left, media, right]);
  const moved = expected([left, right, media]);
  const removed = expected([left, right]);
  const make = input => createEditor({ input: new TextEncoder().encode(input), options, loader: async () => module });
  const editor = make(initial);
  const submit = request => accepted(completed(editor.submit({ stamp: editor.capture(), ...request })));
  const execute = intent => assert.equal(accepted(completed(command(editor, intent))).effect, 'changed');
  const history = (direction, bytes) => {
    submit({ kind: 'history', direction });
    assert.equal(canonical(editor), bytes);
  };
  try {
    accepted(await editor.ready);
    const parent = state(editor).root;
    const [leftId, originalId, rightId] = root(editor).children;
    const original = node(editor, originalId);
    assert.equal(original.attributes.media_asset_id.value, mediaId);
    const gap = index => ({ kind: 'child', parent, index, affinity: 'after' });
    const selectMedia = (start, end) => submit({
      kind: 'set_selection', selection: { anchor: gap(start), focus: gap(end) },
    });

    execute({ kind: 'move', node: originalId, parent, before_index: 3 });
    assert.equal(canonical(editor), moved);
    assert.deepEqual(root(editor).children, [leftId, rightId, originalId]);
    history('undo', initial);
    history('redo', moved);
    history('undo', initial);

    selectMedia(1, 2);
    const stamp = editor.capture();
    const { fragment_json: fragment } = accepted(editor.read({ kind: 'selection_fragment', stamp, max_bytes: 8192 }));
    const copied = JSON.parse(fragment);
    assert.deepEqual([copied.kind, copied.content, copied.open_start, copied.open_end], ['blocks', [media], false, false]);
    assert.deepEqual(editor.capture(), stamp);
    execute({ kind: 'delete_selection' });
    assert.equal(canonical(editor), removed);
    history('undo', initial);
    assert.equal(root(editor).children[1], originalId);
    history('redo', removed);

    selectMedia(1, 1);
    const paste = createCommand('org.klenwriter.kwdj/command/insert-fragment', { kind: 'insert_fragment', fragment_json: fragment });
    assert.equal(submit({ kind: 'command', command: paste, history_hint: { kind: 'isolated' } }).effect, 'changed');
    history('undo', removed);
    history('redo', initial);
    const pasted = root(editor).children[1];
    assert.notEqual(pasted, originalId);
    assert.deepEqual(node(editor, pasted).attributes, original.attributes);

    const reopened = make(canonical(editor));
    try {
      accepted(await reopened.ready);
      assert.equal(canonical(reopened), initial);
      assert.deepEqual(node(reopened, root(reopened).children[1]).attributes, original.attributes);
    } finally {
      accepted(await settled(reopened.destroy()));
    }
  } finally {
    accepted(await settled(editor.destroy()));
    assert.deepEqual(counts(module), baseline);
  }
});

test('OSR-182 DOC-015 packaged WASM exposes and reopens all literary kinds byte for byte', async () => {
  const fixture = literaryFixture();
  const packet = JSON.parse(readFileSync(new URL('../artifacts/extensions/packet.json', import.meta.url)));
  const wasm = readFileSync(new URL('../packages/wasm/dist/editor_wasm_bg.wasm', import.meta.url));
  const module = await loadSdkV2({ wasm: new Uint8Array(wasm) });
  const baseline = counts(module);
  const options = {
    abi: 'editor-sdk/2', build_id: module.manifest.build_id, profile: packet.kwdjProfile,
    admission: 'validate', access: 'read_only', registry_json: packet.kwdjRegistryJson,
    profile_options_json: JSON.stringify({ identities: { media: [], references: [] }, limits: null }),
  };
  async function readAndExport(input) {
    const editor = createEditor({ input: new TextEncoder().encode(input), options, loader: async () => module });
    try {
      accepted(await editor.ready);
      const blocks = root(editor).children;
      assert.equal(blocks.length, 6);
      const rows = blocks.map(id => {
        const block = node(editor, id);
        assert.equal(block.type_id, 'org.klenwriter.kwdj/literary_block');
        assert.equal(block.primitive, 'container');
        assert.equal(block.attributes.kind.kind, 'string');
        const paragraph = node(editor, block.children[0]);
        return [block.attributes.kind.value, node(editor, paragraph.children[0]).text];
      });
      assert.deepEqual(rows, fixture.rows);
      return canonical(editor);
    } finally {
      accepted(await settled(editor.destroy()));
      assert.deepEqual(counts(module), baseline);
    }
  }
  const saved = await readAndExport(fixture.canonical);
  assert.equal(saved, fixture.canonical);
  assert.equal(await readAndExport(saved), fixture.canonical);
});

// These are raw SDK2 calls over the packaged sealed WASM. Exercise native
// dispatch first so a missing JS command mapping cannot mask the baseline.
const osr183Insert = 'org.klenwriter.kwdj/command/insert-block';
const osr183SetKind = 'org.klenwriter.kwdj/command/set-literary-kind';
const osr183Doc = content => canonicalizeRaw(JSON.stringify({
  schema: 'klenwriter.document', schema_version: 1, profile: 'prose', content,
}));

async function withLiteraryCommandSession(input, run, media = [], access = 'editable') {
  const packet = JSON.parse(readFileSync(new URL('../artifacts/extensions/packet.json', import.meta.url)));
  const wasm = readFileSync(new URL('../packages/wasm/dist/editor_wasm_bg.wasm', import.meta.url));
  const module = await loadSdkV2({ wasm: new Uint8Array(wasm) });
  const baseline = counts(module);
  const options = {
    abi: 'editor-sdk/2', build_id: module.manifest.build_id, profile: packet.kwdjProfile,
    admission: 'validate', access, registry_json: packet.kwdjRegistryJson,
    profile_options_json: JSON.stringify({ identities: { media, references: [] }, limits: null }),
  };
  const editor = createEditor({ input: new TextEncoder().encode(input), options, loader: async () => module });
  try {
    accepted(await editor.ready);
    assert.equal(canonical(editor), input);
    await run(editor);
  } finally {
    accepted(await settled(editor.destroy()));
    assert.deepEqual(counts(module), baseline);
  }
}

const osr183Wire = (editor, command) => completed(editor.submit({
  kind: 'command', stamp: editor.capture(), command, history_hint: { kind: 'isolated' },
}));
function osr183History(editor, direction, expected) {
  assert.equal(accepted(completed(editor.submit({
    kind: 'history', stamp: editor.capture(), direction,
  }))).effect, 'changed');
  assert.equal(canonical(editor), expected);
}
function osr183Denied(editor, id, payload, expected, code, path) {
  const before = state(editor);
  const failure = refused(osr183Wire(editor, createCommand(id, payload)));
  assert.equal(failure.code, code);
  if (path !== undefined) assert.equal(failure.path, path);
  assert.deepEqual(state(editor), before);
  assert.equal(canonical(editor), expected);
}

const osr185Fixture = () => JSON.parse(readFileSync(new URL('./fixtures/osr-185-literary.json', import.meta.url)));
const osr185Bytes = value => canonicalizeRaw(JSON.stringify(value));
const osr192Input = () => readFileSync(new URL('../tests/fixtures/osr-192-label-entry.input.json', import.meta.url), 'utf8');
const osr192Entry = () => readFileSync(new URL('../tests/fixtures/osr-192-label-entry.canonical.json', import.meta.url), 'utf8');
const osr192SetLabel = 'org.klenwriter.kwdj/command/set-container-label';
const osr192Label = (node, label) => ({ kind: 'set_container_label', node, label });

test('OSR-192 packaged SDK2 inserts and deletes each label, refuses empty and restores exact Undo', async () => {
  const initial = osr192Input();
  const expected = JSON.parse(initial);
  await withLiteraryCommandSession(initial, editor => {
    const ids = root(editor).children;
    for (const [index, [inserted, deleted]] of [['Финал!', 'Фина!'], ['Подробнее?', 'Подробне?']].entries()) {
      const id = ids[index];
      const original = node(editor, id);
      const prior = osr185Bytes(expected);
      for (const label of [inserted, deleted]) {
        const before = state(editor);
        const result = osr183Wire(editor, createCommand(osr192SetLabel, osr192Label(id, label)));
        assert.equal(accepted(result).effect, 'changed');
        const after = state(editor);
        assert.equal(after.stamp.revision, (BigInt(before.stamp.revision) + 1n).toString());
        assert.equal(after.history.undo_entries, (BigInt(before.history.undo_entries) + 1n).toString());
        expected.content[index].attrs.label = label;
        assert.equal(canonical(editor), osr185Bytes(expected));
        const changed = node(editor, id);
        assert.equal(changed.attributes.label.value, label);
        assert.deepEqual(changed.children, original.children);
        assert.deepEqual(root(editor).children, ids);
      }

      const before = state(editor);
      const diagnostic = refused(osr183Wire(editor, createCommand(osr192SetLabel, osr192Label(id, ''))));
      assert.equal(diagnostic.code, 'kwdj.invalid_structure');
      assert.equal(diagnostic.path, `/content/${index}/attrs/label`);
      assert.equal(diagnostic.may_have_committed, false);
      assert.deepEqual(state(editor), before);
      assert.equal(canonical(editor), osr185Bytes(expected));

      expected.content[index].attrs.label = inserted;
      osr183History(editor, 'undo', osr185Bytes(expected));
      osr183History(editor, 'undo', prior);
      const restored = node(editor, id);
      assert.deepEqual(restored.attributes, original.attributes);
      assert.deepEqual(restored.children, original.children);
      osr183History(editor, 'redo', osr185Bytes(expected));
    }
    assert.equal(canonical(editor), osr192Entry());
    assert.equal(state(editor).history.undo_entries, '2');
    for (const id of [ids[2], state(editor).root]) {
      osr183Denied(editor, osr192SetLabel, osr192Label(id, 'Метка'), osr192Entry(), 'kwdj.command_invalid_target');
    }
  });
});

test('OSR-192 packaged SDK2 edits both bodies while preserving the authored labels', async () => {
  const entry = osr192Entry();
  await withLiteraryCommandSession(entry, editor => {
    for (const [index, id] of root(editor).children.slice(0, 2).entries()) {
      const before = node(editor, id);
      const leaf = node(editor, before.children[0]).children[0];
      const expected = JSON.parse(entry);
      const text = expected.content[index].content[0].content[0];
      osr185Select(editor, position(leaf, text.text.length));
      assert.equal(accepted(osr183Wire(editor, kwdjCommand({ kind: 'insert_text', text: '.' }))).effect, 'changed');
      text.text += '.';
      assert.equal(canonical(editor), osr185Bytes(expected));
      const after = node(editor, id);
      assert.deepEqual(after.attributes, before.attributes);
      assert.deepEqual(after.children, before.children);
      osr183History(editor, 'undo', entry);
    }
  });
});

const osr185Insert = { kind: 'insert_block', target: { kind: 'literary_block', literary_kind: 'author_note' } };
const osr185Gap = (parent, index) => ({ kind: 'child', parent, index, affinity: 'after' });
function osr185Select(editor, anchor, focus = anchor) {
  accepted(completed(editor.submit({ kind: 'set_selection', stamp: editor.capture(), selection: { anchor, focus } })));
}

test('OSR-185 packaged SDK2 keeps nested and empty literary blocks through history and reopen', async () => {
  const fixture = osr185Fixture();
  const original = osr185Bytes(fixture.initial);
  for (const result of ['nested', 'empty']) {
    const expected = osr185Bytes(fixture[result]);
    let saved;
    await withLiteraryCommandSession(original, editor => {
      const wrapper = root(editor).children[1];
      const originalChild = node(editor, wrapper).children[0];
      if (result === 'nested') osr185Select(editor, osr185Gap(wrapper, 1));
      const edit = result === 'nested'
        ? createCommand(osr183Insert, osr185Insert)
        : createCommand('org.klenwriter.kwdj/command/remove', { kind: 'remove', node: originalChild });
      assert.equal(accepted(osr183Wire(editor, edit)).effect, 'changed', result);
      assert.equal(canonical(editor), expected, result);
      assert.equal(root(editor).children[1], wrapper);
      const children = node(editor, wrapper).children;
      if (result === 'nested') assert.equal(children[0], originalChild);
      else assert.notEqual(children[0], originalChild);
      const emptyChild = result === 'nested' ? node(editor, children[1]).children[0] : children[0];
      const point = osr185Gap(emptyChild, 0);
      const changed = state(editor);
      assert.deepEqual(structuredClone(changed.selection), { anchor: point, focus: point });
      assert.equal(changed.stamp.revision, '1');
      assert.equal(changed.history.undo_entries, '1');
      osr183History(editor, 'undo', original);
      assert.equal(node(editor, wrapper).children[0], originalChild);
      osr183History(editor, 'redo', expected);
      saved = canonical(editor);
    });
    await withLiteraryCommandSession(saved, editor => {
      assert.equal(canonical(editor), expected, result);
      assert.equal(state(editor).history.undo_entries, '0');
    });
  }
});

test('OSR-185 packaged SDK2 refuses literary boundaries and illegal parents without committing', async () => {
  const fixture = osr185Fixture();
  const original = osr185Bytes(fixture.initial);
  await withLiteraryCommandSession(original, editor => {
    const wrapper = root(editor).children[1];
    const firstChild = node(editor, node(editor, wrapper).children[0]).children[0];
    const backspace = fixture.refusals.first_child_backspace;
    osr185Select(editor, position(firstChild, 0));
    osr183Denied(editor, 'org.klenwriter.kwdj/command/delete-backward', { kind: 'delete_backward' }, original, backspace.code, backspace.path);
    const crossing = fixture.refusals.crossing_delete;
    osr185Select(editor, position(textLeaf(editor).id, 6), position(firstChild, 1));
    osr183Denied(editor, 'org.klenwriter.kwdj/command/delete-selection', { kind: 'delete_selection' }, original, crossing.code, crossing.path);
  });
  const restricted = osr185Bytes(fixture.restricted);
  const media = [{ id: fixture.restricted.content[1].attrs.media_asset_id, status: 'exists' }];
  await withLiteraryCommandSession(restricted, editor => {
    for (const [index, name] of ['verse_target', 'media_target'].entries()) {
      const expected = fixture.refusals[name];
      osr185Select(editor, osr185Gap(root(editor).children[index], 1));
      osr183Denied(editor, osr183Insert, osr185Insert, restricted, expected.code, expected.path);
    }
  }, media);
});

const osr189Fixture = () => JSON.parse(readFileSync(new URL('./fixtures/osr-189-warning.json', import.meta.url)));
const osr189Wrap = 'org.klenwriter.kwdj/command/wrap-warning';
const osr189Unwrap = 'org.klenwriter.kwdj/command/unwrap-warning';
const osr189Move = 'org.klenwriter.kwdj/command/move';

test('OSR-189 packaged SDK2 wraps and unwraps warning with exact children and history', async () => {
  const fixture = osr189Fixture();
  const input = osr183Doc(fixture.initial);
  const wrapped = osr183Doc(fixture.wrapped);
  const wrap = { kind: 'wrap_warning', warning_kind: 'general' };
  await withLiteraryCommandSession(input, editor => {
    const rootId = state(editor).root;
    const original = root(editor).children;
    const children = original.slice(1, 4);
    const inline = node(editor, children[0]).children;
    osr185Select(editor, osr185Gap(rootId, 4), osr185Gap(rootId, 1));
    const dto = createCommand(osr189Wrap, wrap);
    assert.equal(accepted(osr183Wire(editor, dto)).effect, 'changed');
    assert.deepEqual(kwdjCommand(wrap), dto);
    assert.equal(canonical(editor), wrapped);
    const roots = root(editor).children;
    const warning = roots[1];
    assert.deepEqual(roots, [original[0], warning, original[4]]);
    assert.deepEqual(node(editor, warning).children, children);
    assert.deepEqual(node(editor, children[0]).children, inline);

    osr183History(editor, 'undo', input);
    assert.deepEqual(root(editor).children, original);
    osr183History(editor, 'redo', wrapped);
    assert.deepEqual(root(editor).children, roots);

    const intent = { kind: 'unwrap_warning', node: warning };
    const unwrap = createCommand(osr189Unwrap, intent);
    assert.equal(accepted(osr183Wire(editor, unwrap)).effect, 'changed');
    assert.deepEqual(kwdjCommand(intent), unwrap);
    assert.equal(canonical(editor), input);
    assert.deepEqual(root(editor).children, original);
    assert.deepEqual(node(editor, children[0]).children, inline);
    osr183History(editor, 'undo', wrapped);
    assert.deepEqual(node(editor, warning).children, children);
    osr183History(editor, 'redo', input);
  });

  const labeled = osr183Doc(fixture.labeled);
  await withLiteraryCommandSession(labeled, editor => {
    const warning = root(editor).children[1];
    osr185Select(editor, osr185Gap(warning, 0), osr185Gap(warning, 1));
    const denied = fixture.refusals.cross_kind_wrap;
    osr183Denied(editor, osr189Wrap, wrap, labeled, denied.code, denied.path);
    const [left, wrapper, right] = fixture.labeled;
    const unwrap = createCommand(osr189Unwrap, { kind: 'unwrap_warning', node: warning });
    assert.equal(accepted(osr183Wire(editor, unwrap)).effect, 'changed');
    assert.equal(canonical(editor), osr183Doc([left, ...wrapper.content, right]));
    osr183History(editor, 'undo', labeled);
    assert.equal(root(editor).children[1], warning);
  });
});

test('OSR-189 packaged SDK2 refuses warning boundary edits and preserves the labeled empty shell', async () => {
  const fixture = osr189Fixture();
  const input = osr183Doc(fixture.labeled);
  const empty = osr183Doc(fixture.labeled_empty);
  await withLiteraryCommandSession(input, editor => {
    const roots = root(editor).children;
    const outside = textLeaf(editor).id;
    const child = node(editor, roots[1]).children[0];
    const first = node(editor, child).children[0];
    const backspace = fixture.refusals.first_child_backspace;
    osr185Select(editor, position(first, 0));
    osr183Denied(editor, 'org.klenwriter.kwdj/command/delete-backward', { kind: 'delete_backward' }, input, backspace.code, backspace.path);
    const crossing = fixture.refusals.cross_boundary_delete;
    osr185Select(editor, position(outside, 6), position(first, 1));
    osr183Denied(editor, 'org.klenwriter.kwdj/command/delete-selection', { kind: 'delete_selection' }, input, crossing.code, crossing.path);

    const remove = createCommand('org.klenwriter.kwdj/command/remove', { kind: 'remove', node: child });
    assert.equal(accepted(osr183Wire(editor, remove)).effect, 'changed');
    assert.equal(canonical(editor), empty);
    assert.deepEqual(root(editor).children, roots);
    const children = node(editor, roots[1]).children;
    assert.equal(children.length, 1);
    assert.notEqual(children[0], child);
    assert.deepEqual(node(editor, children[0]).children, []);
    osr183History(editor, 'undo', input);
    assert.equal(node(editor, roots[1]).children[0], child);
    osr183History(editor, 'redo', empty);
  });
});

test('OSR-189 packaged SDK2 distinguishes legal literary nesting from warning recursion', async () => {
  const fixture = osr189Fixture();
  const input = osr183Doc(fixture.nesting);
  const nested = osr183Doc(fixture.nested);
  await withLiteraryCommandSession(input, editor => {
    const roots = root(editor).children;
    const insideWarning = node(editor, roots[0]).children[0];
    const move = parent => ({ kind: 'move', node: roots[1], parent, before_index: 1 });
    const denied = fixture.refusals.cross_kind_move;
    osr183Denied(editor, osr189Move, move(insideWarning), input, denied.code, denied.path);
    assert.equal(accepted(osr183Wire(editor, createCommand(osr189Move, move(roots[2])))).effect, 'changed');
    assert.equal(canonical(editor), nested);
    assert.equal(node(editor, roots[2]).children[1], roots[1]);
    osr183History(editor, 'undo', input);
    assert.deepEqual(root(editor).children, roots);
  });
});

const osr186InsertFragment = 'org.klenwriter.kwdj/command/insert-fragment';
const osr186Payload = fragment => ({ kind: 'insert_fragment', fragment_json: JSON.stringify(fragment) });
function osr186Capture(editor, kind, content) {
  const before = state(editor);
  const read = accepted(editor.read({ kind: 'selection_fragment', stamp: editor.capture(), max_bytes: 8192 }));
  assert.equal(read.empty, false);
  assert.deepEqual(state(editor), before);
  const captured = JSON.parse(read.fragment_json);
  assert.deepEqual([captured.kind, captured.open_start, captured.open_end, captured.content], [kind, false, false, content]);
  return captured;
}
function osr186PasteAndUndo(editor, captured, expected, original) {
  const command = createCommand(osr186InsertFragment, osr186Payload(captured));
  assert.equal(accepted(osr183Wire(editor, command)).effect, 'changed');
  assert.equal(canonical(editor), osr185Bytes(expected));
  assert.equal(state(editor).history.undo_entries, '1');
  osr183History(editor, 'undo', original);
}

test('OSR-278 packaged SDK2 preserves warning blocks and selected children through clipboard Undo', async () => {
  const { fixtures } = JSON.parse(readFileSync(new URL('../contracts/kwdj/v1/fixtures/positive.json', import.meta.url), 'utf8'));
  const { kwdj: document } = fixtures.find(item => item.id === 'DOC-016').cases.find(item => item.name === 'warning_kinds');
  assert.deepEqual(document.content.map(block => block.attrs.kind), ['general', 'content']);
  const original = osr185Bytes(document);

  await withLiteraryCommandSession(original, editor => {
    const rootId = state(editor).root;
    for (const [index, block] of document.content.entries()) {
      const targetIndex = 1 - index;
      const [source, target] = [root(editor).children[index], root(editor).children[targetIndex]];
      osr185Select(editor, osr185Gap(rootId, index), osr185Gap(rootId, index + 1));
      const whole = osr186Capture(editor, 'blocks', [block]);

      osr185Select(editor, osr185Gap(target, 1));
      osr183Denied(editor, osr186InsertFragment, osr186Payload(whole), original,
        'kwdj.recursive_warning', `/content/${targetIndex}/content/1`);

      osr185Select(editor, osr185Gap(rootId, document.content.length));
      osr186PasteAndUndo(editor, whole, { ...document, content: [...document.content, block] }, original);

      const child = block.content[0];
      osr185Select(editor, osr185Gap(source, 0), osr185Gap(source, 1));
      const children = osr186Capture(editor, 'blocks', [child]);
      osr185Select(editor, osr185Gap(target, 1));
      const expected = structuredClone(document);
      expected.content[targetIndex].content.push(child);
      osr186PasteAndUndo(editor, children, expected, original);
    }
  });
});

test('OSR-186 packaged SDK2 copies closed literary fragments for all kinds and nested children', async () => {
  const { canonical: original } = literaryFixture();
  const document = JSON.parse(original);
  assert.equal(document.content.length, 6);
  await withLiteraryCommandSession(original, editor => {
    const parent = state(editor).root;
    for (const [index, block] of document.content.entries()) {
      osr185Select(editor, osr185Gap(parent, index), osr185Gap(parent, index + 1));
      const captured = osr186Capture(editor, 'blocks', [block]);
      osr185Select(editor, osr185Gap(parent, document.content.length));
      osr186PasteAndUndo(editor, captured, { ...document, content: [...document.content, block] }, original);
    }
  });

  const nested = osr185Fixture().nested;
  const nestedBytes = osr185Bytes(nested);
  await withLiteraryCommandSession(nestedBytes, editor => {
    const parent = state(editor).root;
    const wrapper = root(editor).children[1];
    for (const [source, block] of [[parent, nested.content[1]], [wrapper, nested.content[1].content[1]]]) {
      osr185Select(editor, osr185Gap(source, 1), osr185Gap(source, 2));
      const captured = osr186Capture(editor, 'blocks', [block]);
      osr185Select(editor, osr185Gap(wrapper, 2));
      const expected = structuredClone(nested);
      expected.content[1].content.push(block);
      osr186PasteAndUndo(editor, captured, expected, nestedBytes);
    }
  });
});

test('OSR-186 packaged SDK2 preserves partial children and refuses illegal or read-only paste', async () => {
  const document = osr185Fixture().nested;
  document.content.push({ type: 'bullet_list', content: [{ type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'List' }] }] }] });
  const original = osr185Bytes(document);
  await withLiteraryCommandSession(original, editor => {
    const wrapper = root(editor).children[1];
    const [sourceBlock, targetWrapper] = node(editor, wrapper).children;
    const source = node(editor, sourceBlock).children[0];
    osr185Select(editor, position(source, 1), position(source, 4));
    const inline = [{ type: 'text', text: 'uth', marks: [{ type: 'emphasis' }] }];
    const captured = osr186Capture(editor, 'inline', inline);
    osr185Select(editor, osr185Gap(node(editor, targetWrapper).children[0], 0));
    const expected = structuredClone(document);
    expected.content[1].content[1].content[0].content = inline;
    osr186PasteAndUndo(editor, captured, expected, original);
    osr185Select(editor, osr185Gap(wrapper, 1));
    osr183Denied(editor, osr186InsertFragment, osr186Payload(captured), original, 'kwdj.command_unsupported_context', '/clipboard');
  });
  for (const access of ['editable', 'read_only']) {
    await withLiteraryCommandSession(original, editor => {
      const parent = state(editor).root;
      osr185Select(editor, osr185Gap(parent, 1), osr185Gap(parent, 2));
      const captured = osr186Capture(editor, 'blocks', [document.content[1]]);
      if (access === 'editable') {
        osr185Select(editor, osr185Gap(root(editor).children[3], 1));
        osr183Denied(editor, osr186InsertFragment, osr186Payload(captured), original, 'kwdj.invalid_profile_content', '/content/3/content/1');
      } else {
        osr185Select(editor, osr185Gap(parent, 4));
        osr183Denied(editor, osr186InsertFragment, osr186Payload(captured), original, 'session.read_only', '');
      }
    }, [], access);
  }
});

test('OSR-188 packaged SDK2 reads and reopens both DOC-016 warning kinds exactly', async () => {
  const fixture = warningFixture();
  let saved;
  await withLiteraryCommandSession(fixture.canonical, editor => {
    const kinds = root(editor).children.map(id => {
      const row = node(editor, id);
      assert.equal(row.type_id, 'org.klenwriter.kwdj/warning');
      assert.equal(row.primitive, 'container');
      const child = node(editor, row.children[0]);
      return { kind: row.attributes.kind.value, label: row.attributes.label?.value, text: node(editor, child.children[0]).text };
    });
    assert.deepEqual(kinds, fixture.document.content.map(block => ({
      kind: block.attrs.kind, label: block.attrs.label, text: block.content[0].content[0].text,
    })));
    saved = canonical(editor);
    assert.equal(saved, fixture.canonical);
  }, [], 'read_only');
  await withLiteraryCommandSession(saved, editor => {
    assert.equal(canonical(editor), fixture.canonical);
  }, [], 'read_only');
});

test('OSR-188 packaged SDK2 root-gap creates both warnings with the legacy seed', async () => {
  const [left, right] = ['Before', 'After'].map(text => ({ type: 'paragraph', content: [{ type: 'text', text }] }));
  const original = osr183Doc([left, right]);
  for (const kind of ['general', 'content']) {
    const warning = { type: 'warning', attrs: { kind }, content: [{ type: 'paragraph', content: [] }] };
    const expected = osr183Doc([left, warning, right]);
    await withLiteraryCommandSession(original, editor => {
      const oldRoots = root(editor).children;
      osr185Select(editor, osr185Gap(state(editor).root, 1));
      const payload = { kind: 'insert_block', target: { kind: 'warning', warning_kind: kind } };
      const result = osr183Wire(editor, createCommand(osr183Insert, payload));
      assert.equal(accepted(result).effect, 'changed');
      assert.equal(canonical(editor), expected);
      const [first, created, last] = root(editor).children;
      assert.deepEqual([first, last], oldRoots);
      const caret = osr185Gap(node(editor, created).children[0], 0);
      assert.deepEqual(structuredClone(state(editor).selection), { anchor: caret, focus: caret });
      osr183History(editor, 'undo', original);
      osr183History(editor, 'redo', expected);
    });
  }
});

test('OSR-188 packaged SDK2 changes warning kind while preserving children and exact Undo', async () => {
  const fixture = warningFixture();
  for (const [index, kind] of [[0, 'content'], [1, 'general']]) {
    const wanted = structuredClone(fixture.document);
    wanted.content[index].attrs.kind = kind;
    const expected = osr185Bytes(wanted);
    await withLiteraryCommandSession(fixture.canonical, editor => {
      const roots = root(editor).children;
      const id = roots[index];
      const before = node(editor, id);
      const change = createCommand('org.klenwriter.kwdj/command/set-warning-kind', { kind: 'set_warning_kind', node: id, warning_kind: kind });
      assert.equal(accepted(osr183Wire(editor, change)).effect, 'changed');
      const after = node(editor, id);
      assert.deepEqual(root(editor).children, roots);
      assert.deepEqual(after.children, before.children);
      assert.deepEqual(after.attributes.label, before.attributes.label);
      assert.equal(canonical(editor), expected);
      const settled = state(editor);
      assert.equal(accepted(osr183Wire(editor, change)).effect, 'unchanged');
      assert.deepEqual(state(editor), settled);
      assert.equal(canonical(editor), expected);
      osr183History(editor, 'undo', fixture.canonical);
      osr183History(editor, 'redo', expected);
    });
  }
});

test('OSR-183 packaged SDK2 creates only an author note at the root gap', async () => {
  const [left, right] = ['Before', 'After'].map(text => ({ type: 'paragraph', content: [{ type: 'text', text }] }));
  const seed = { type: 'paragraph', content: [] };
  const authorNote = { type: 'literary_block', attrs: { kind: 'author_note' }, content: [seed] };
  const input = osr183Doc([left, right]);
  const expected = osr183Doc([left, authorNote, right]);
  await withLiteraryCommandSession(input, editor => {
    const rootId = state(editor).root;
    const originalIds = root(editor).children;
    const gap = { kind: 'child', parent: rootId, index: 1, affinity: 'after' };
    accepted(completed(editor.submit({ kind: 'set_selection', stamp: editor.capture(), selection: { anchor: gap, focus: gap } })));
    const before = state(editor);
    const intent = { kind: 'insert_block', target: { kind: 'literary_block', literary_kind: 'author_note' } };
    const dto = createCommand(osr183Insert, intent);
    const availability = accepted(editor.query({ kind: 'query_command', stamp: editor.capture(), command: dto }));
    assert.equal(availability.available, true, JSON.stringify(availability));
    assert.equal(availability.effect, 'changed');
    assert.deepEqual(state(editor), before);
    assert.equal(canonical(editor), input);
    osr183Denied(editor, osr183Insert, {
      kind: 'insert_block', target: { kind: 'literary_block', literary_kind: 'letter' },
    }, input, 'sdk.invalid_dto');
    assert.equal(accepted(osr183Wire(editor, dto)).effect, 'changed');
    assert.deepEqual(kwdjCommand(intent), dto);
    assert.equal(canonical(editor), expected);
    const ids = root(editor).children;
    assert.deepEqual([ids[0], ids[2]], originalIds);
    const newBlock = node(editor, ids[1]);
    assert.equal(newBlock.type_id, 'org.klenwriter.kwdj/literary_block');
    assert.deepEqual({ ...newBlock.attributes.kind }, { kind: 'string', value: 'author_note' });
    assert.equal(newBlock.children.length, 1);
    const child = node(editor, newBlock.children[0]);
    assert.equal(child.type_id, 'org.klenwriter.kwdj/paragraph');
    assert.deepEqual(child.children, []);
    const caret = { kind: 'child', parent: child.id, index: 0, affinity: 'after' };
    assert.deepEqual(structuredClone(state(editor).selection), { anchor: caret, focus: caret });
    assert.equal(state(editor).history.undo_entries, '1');
    osr183History(editor, 'undo', input);
    osr183History(editor, 'redo', expected);
    assert.deepEqual(root(editor).children, ids);
  });
});

test('OSR-183 packaged SDK2 retargets a preserved letter with exact children and history', async () => {
  const acceptedDoc = JSON.parse(literaryFixture().canonical);
  const letter = acceptedDoc.content.find(block => block.attrs.kind === 'letter');
  const extra = { type: 'paragraph', attrs: { align: 'right' }, content: [
    { type: 'text', text: 'Extra 😀', marks: [{ type: 'strong' }] },
    { type: 'hard_break' },
    { type: 'text', text: 'Continuation' },
  ] };
  const input = osr183Doc([{ type: 'paragraph', content: [] }, { ...letter, content: [...letter.content, extra] }]);
  const expected = input.replace('"kind":"letter"', '"kind":"author_note"');
  await withLiteraryCommandSession(input, editor => {
    const roots = root(editor).children;
    const noteId = roots[1];
    const children = node(editor, noteId).children;
    const inline = node(editor, children[1]).children;
    const intent = { kind: 'set_literary_kind', node: noteId, literary_kind: 'author_note' };
    const dto = createCommand(osr183SetKind, intent);
    const before = state(editor);
    const availability = accepted(editor.query({ kind: 'query_command', stamp: editor.capture(), command: dto }));
    assert.equal(availability.available, true, JSON.stringify(availability));
    assert.equal(availability.effect, 'changed');
    assert.deepEqual(state(editor), before);
    assert.equal(canonical(editor), input);
    assert.equal(accepted(osr183Wire(editor, dto)).effect, 'changed');
    assert.deepEqual(kwdjCommand(intent), dto);
    assert.equal(canonical(editor), expected);
    assert.deepEqual(root(editor).children, roots);
    assert.deepEqual(node(editor, noteId).children, children);
    assert.deepEqual(node(editor, children[1]).children, inline);
    assert.equal(state(editor).stamp.revision, '1');
    assert.equal(state(editor).history.undo_entries, '1');

    osr183History(editor, 'undo', input);
    osr183History(editor, 'redo', expected);
    assert.deepEqual(root(editor).children, roots);
    assert.deepEqual(node(editor, noteId).children, children);
    const settledState = state(editor);
    assert.equal(accepted(osr183Wire(editor, dto)).effect, 'unchanged');
    assert.deepEqual(state(editor), settledState);
    assert.equal(canonical(editor), expected);
    osr183Denied(editor, osr183SetKind, { ...intent, literary_kind: 'letter' }, expected, 'sdk.invalid_dto');
    osr183Denied(editor, osr183SetKind, { ...intent, node: roots[0] }, expected, 'kwdj.command_invalid_target');
  });
});

const osr184Wrap = 'org.klenwriter.kwdj/command/wrap-literary-block';
const osr184Unwrap = 'org.klenwriter.kwdj/command/unwrap-literary-block';
const osr184WrapIntent = { kind: 'wrap_literary_block', literary_kind: 'author_note' };
const osr184Blocks = [
  { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
  { type: 'paragraph', attrs: { align: 'right' }, content: [
    { type: 'text', text: 'Note 😀', marks: [{ type: 'strong' }] },
    { type: 'hard_break' },
    { type: 'text', text: 'Continuation' },
  ] },
  { type: 'scene_break' },
  { type: 'blockquote', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'Quotation', marks: [{ type: 'emphasis' }] },
  ] }] },
  { type: 'literary_block', attrs: { kind: 'letter' }, content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Preserved' }] },
  ] },
];
function osr184Select(editor, anchorParent, anchorIndex, focusParent, focusIndex) {
  const gap = (parent, index) => ({ kind: 'child', parent, index, affinity: 'after' });
  const selection = { anchor: gap(anchorParent, anchorIndex), focus: gap(focusParent, focusIndex) };
  accepted(completed(editor.submit({ kind: 'set_selection', stamp: editor.capture(), selection })));
  assert.deepEqual(structuredClone(state(editor).selection), selection);
}
function osr184Capability(editor, dto, expected) {
  const before = state(editor);
  const availability = accepted(editor.query({ kind: 'query_command', stamp: editor.capture(), command: dto }));
  assert.equal(availability.available, true, JSON.stringify(availability));
  assert.equal(availability.effect, 'changed');
  assert.deepEqual(state(editor), before);
  assert.equal(canonical(editor), expected);
}

test('OSR-184 packaged SDK2 wraps and unwraps heterogeneous siblings with exact history and IDs', async () => {
  const input = osr183Doc(osr184Blocks);
  const wrapped = osr183Doc([
    osr184Blocks[0],
    { type: 'literary_block', attrs: { kind: 'author_note' }, content: osr184Blocks.slice(1, 4) },
    osr184Blocks[4],
  ]);
  await withLiteraryCommandSession(input, editor => {
    const rootId = state(editor).root;
    const originalIds = root(editor).children;
    const children = originalIds.slice(1, 4);
    const paragraphInline = node(editor, children[0]).children;
    const quoteChildren = node(editor, children[2]).children;
    osr184Select(editor, rootId, 1, rootId, 4);

    const wrap = createCommand(osr184Wrap, osr184WrapIntent);
    osr184Capability(editor, wrap, input);
    assert.deepEqual(kwdjCommand(osr184WrapIntent), wrap);
    assert.equal(accepted(osr183Wire(editor, wrap)).effect, 'changed');
    assert.equal(canonical(editor), wrapped);
    assert.equal(state(editor).history.undo_entries, '1');
    const wrappedIds = root(editor).children;
    const wrapper = wrappedIds[1];
    assert.deepEqual(wrappedIds, [originalIds[0], wrapper, originalIds[4]]);
    const note = node(editor, wrapper);
    assert.equal(note.type_id, 'org.klenwriter.kwdj/literary_block');
    assert.deepEqual(structuredClone(note.attributes.kind), { kind: 'string', value: 'author_note' });
    assert.deepEqual(note.children, children);
    assert.deepEqual(node(editor, children[0]).children, paragraphInline);
    assert.deepEqual(node(editor, children[2]).children, quoteChildren);

    osr183History(editor, 'undo', input);
    assert.deepEqual(root(editor).children, originalIds);
    osr183History(editor, 'redo', wrapped);
    assert.deepEqual(root(editor).children, wrappedIds);
    assert.deepEqual(node(editor, wrapper).children, children);

    const intent = { kind: 'unwrap_literary_block', node: wrapper };
    const unwrap = createCommand(osr184Unwrap, intent);
    osr184Capability(editor, unwrap, wrapped);
    assert.deepEqual(kwdjCommand(intent), unwrap);
    assert.equal(accepted(osr183Wire(editor, unwrap)).effect, 'changed');
    assert.equal(canonical(editor), input);
    assert.equal(state(editor).history.undo_entries, '2');
    assert.deepEqual(root(editor).children, originalIds);
    assert.deepEqual(node(editor, children[0]).children, paragraphInline);
    assert.deepEqual(node(editor, children[2]).children, quoteChildren);
    osr183History(editor, 'undo', wrapped);
    assert.deepEqual(root(editor).children, wrappedIds);
    assert.deepEqual(node(editor, wrapper).children, children);
    osr183History(editor, 'redo', input);
    assert.deepEqual(root(editor).children, originalIds);
  });
});

test('OSR-184 packaged SDK2 refuses mixed-parent wrap and non-author-note unwrap atomically', async () => {
  const input = osr183Doc(osr184Blocks);
  await withLiteraryCommandSession(input, editor => {
    const ids = root(editor).children;
    osr184Select(editor, state(editor).root, 1, ids[3], 1);
    osr183Denied(editor, osr184Wrap, osr184WrapIntent, input, 'kwdj.command_unsupported_context');
    for (const nodeId of [ids[3], ids[4]]) {
      osr183Denied(editor, osr184Unwrap, { kind: 'unwrap_literary_block', node: nodeId }, input,
        'kwdj.command_invalid_target');
    }
  });
});

test('OSR-191 packaged SDK2 reads and reopens DOC-017 labels and body byte for byte', async () => {
  const fixture = spoilerDisclosureFixture();
  const spaces = structuredClone(fixture.document);
  for (const block of spaces.content) block.attrs.label = '  ';
  for (const document of [fixture.document, spaces]) {
    const expected = osr185Bytes(document);
    let saved;
    await withLiteraryCommandSession(expected, editor => {
      const actual = root(editor).children.map(id => {
        const block = node(editor, id);
        const paragraph = node(editor, block.children[0]);
        return [block.type_id, block.primitive, block.attributes.label.value, node(editor, paragraph.children[0]).text];
      });
      assert.deepEqual(actual, document.content.map(block => [
        `org.klenwriter.kwdj/${block.type}`, 'container', block.attrs.label, block.content[0].content[0].text,
      ]));
      saved = canonical(editor);
    }, [], 'read_only');
    assert.equal(saved, expected);
    await withLiteraryCommandSession(saved, editor => assert.equal(canonical(editor), expected), [], 'read_only');
  }
});

test('OSR-191 packaged SDK2 refuses replacing a document with either empty authored label', async () => {
  const fixture = spoilerDisclosureFixture();
  await withLiteraryCommandSession(fixture.canonical, editor => {
    for (const block of fixture.document.content) {
      const candidate = osr183Doc([{ ...block, attrs: { label: '' } }]);
      const before = state(editor);
      const response = completed(editor.submit({ kind: 'remount', stamp: editor.capture(), input_json: candidate, admission: 'validate' }));
      const diagnostic = refused(response);
      assert.equal(diagnostic.code, 'kwdj.invalid_structure', block.type);
      assert.equal(diagnostic.path, '/content/0/attrs/label', block.type);
      assert.equal(diagnostic.may_have_committed, false);
      assert.deepEqual(state(editor), before);
      assert.equal(canonical(editor), fixture.canonical);
    }
  });
});

test('packaged SDK: two listeners read revision r before queued command; second same capture refuses stale', async () => {
  const context = await open(); const { editor } = context;
  try {
    const leaf = textLeaf(editor).id; select(editor, leaf, 2);
    const seen = [], tickets = []; let once = false;
    editor.subscribe(event => {
      seen.push(['first', event.after.revision, editor.read({ kind: 'node', stamp: event.after, node: leaf })]);
      if (!once) { once = true; const request = commandRequest(editor, { kind: 'insert_text', text: 'Y' }); tickets.push(editor.submit(request), editor.submit(request)); }
    });
    editor.subscribe(event => seen.push(['second', event.after.revision, editor.read({ kind: 'node', stamp: event.after, node: leaf })]));
    accepted(completed(command(editor, { kind: 'insert_text', text: 'X' })));
    assert.equal(tickets[0].status, 'queued'); assert.equal(tickets[1].status, 'queued');
    accepted(await settled(tickets[0])); assert.equal(refused(await settled(tickets[1])).code, 'session.stale_revision');
    assert.deepEqual(seen.map(([listener, revision, reply]) => [listener, revision, accepted(reply).node.text]), [['first', '1', 'abXc'], ['second', '1', 'abXc'], ['first', '2', 'abXYc'], ['second', '2', 'abXYc']]);
    assert.deepEqual(JSON.parse(canonical(editor)), document('abXYc'));
    assert.equal(context.callbackErrors.length, 0);
  } finally { context.close(); }
});

test('packaged SDK: state-only queued marks preserve listener stamp and noop/refusal/query emit zero events', async () => {
  const context = await open(); const { editor } = context;
  try {
    const leaf = textLeaf(editor).id; select(editor, leaf, 1);
    const events = [], reads = []; let ticket, once = false;
    editor.subscribe(event => {
      events.push(event);
      if (!once) { once = true; ticket = editor.submit({ kind: 'set_stored_marks', stamp: editor.capture(), marks: [] }); }
    });
    editor.subscribe(event => reads.push(editor.read({ kind: 'node', stamp: event.after, node: leaf })));
    accepted(completed(editor.submit({ kind: 'set_stored_marks', stamp: editor.capture(), marks: [{ type_id: 'org.klenwriter.kwdj/strong', attributes: {} }] })));
    assert.equal(ticket.status, 'queued'); accepted(await settled(ticket));
    assert.equal(events.length, 2); assert.ok(events.every(e => e.change.kind === 'state' && e.before.revision === '0' && e.after.revision === '0'));
    assert.deepEqual(state(editor).stored_marks, []); assert.equal(reads.filter(r => r.status === 'ok').length, 2);
    const count = events.length, before = editor.capture();
    select(editor, leaf, 1);
    accepted(completed(command(editor, { kind: 'dismiss_slash' })));
    accepted(editor.query({ kind: 'query_history', stamp: editor.capture(), direction: 'undo' }));
    const request = commandRequest(editor, { kind: 'insert_text', text: 'Z' }); request.command.id = 'unregistered.command';
    assert.equal(refused(completed(editor.submit(request))).code, 'command.unknown');
    assert.deepEqual(editor.capture(), before); assert.equal(events.length, count);
    assert.equal(context.callbackErrors.length, 0);
  } finally { context.close(); }
});

test('packaged SDK: save acknowledgement queues behind all listeners and never exports per callback', async () => {
  const context = await open(); const { editor } = context;
  try {
    const leaf = textLeaf(editor).id; select(editor, leaf, 2);
    accepted(completed(command(editor, { kind: 'insert_text', text: 'X' })));
    const saved = snapshot(editor); const observed = []; let ticket, once = false;
    editor.subscribe(event => { if (!once) { once = true; ticket = editor.submit({ kind: 'acknowledge_snapshot', stamp: editor.capture(), handle: saved.handle }); } });
    editor.subscribe(event => observed.push([event.change.kind, event.after.revision, editor.read({ kind: 'state' }), editor.read({ kind: 'node', stamp: event.after, node: leaf })]));
    select(editor, leaf, 0);
    assert.equal(ticket.status, 'queued'); accepted(await settled(ticket));
    assert.deepEqual(observed.map(([kind, revision, response, read]) => [kind, revision, accepted(response).state.dirty, accepted(read).node.text]), [['state', '1', true, 'abXc'], ['state', '1', false, 'abXc']]);
    assert.equal(state(editor).saved_revision, '1'); release(editor, saved.handle);
    assert.equal(context.callbackErrors.length, 0);
  } finally { context.close(); }
});

test('packaged SDK: remount is deferred through old-generation read fence and cancels queued/host capabilities', async () => {
  const context = await open(); const { editor } = context;
  try {
    const oldStamp = editor.capture(), oldLeaf = textLeaf(editor).id; select(editor, oldLeaf, 1);
    const host = editor.captureHostRequest(); const seen = []; let remount, cancelled, once = false;
    editor.subscribe(event => {
      if (!once) {
        once = true;
        remount = editor.submit({ kind: 'remount', stamp: editor.capture(), input_json: JSON.stringify(document('new')), admission: 'validate' });
        cancelled = command(editor, { kind: 'insert_text', text: 'forbidden' });
      }
    });
    editor.subscribe(event => seen.push(editor.read({ kind: 'node', stamp: event.after, node: oldLeaf })));
    accepted(completed(editor.submit({ kind: 'set_stored_marks', stamp: editor.capture(), marks: [] })));
    accepted(await settled(remount)); assert.equal(refused(await settled(cancelled)).code, 'sdk.stale_generation');
    assert.equal(seen.length, 1); assert.equal(accepted(seen[0]).node.text, 'abc');
    assert.notEqual(editor.capture().generation, oldStamp.generation);
    assert.equal(refused(editor.read({ kind: 'node', stamp: oldStamp, node: oldLeaf })).code, 'session.stale_session');
    assert.equal(refused(completed(editor.completeHostRequest(host.request, { kind: 'barrier', stamp: host.request.stamp }))).code, 'sdk.stale_request');
    assert.deepEqual(JSON.parse(canonical(editor)), document('new'));
    const before = editor.capture(), current = canonical(editor);
    refused(completed(editor.submit({ kind: 'remount', stamp: before, input_json: 'invalid', admission: 'validate' })));
    assert.deepEqual(editor.capture(), before); assert.equal(canonical(editor), current);
    assert.equal(context.callbackErrors.length, 0);
  } finally { context.close(); }
});

test('packaged SDK: async host completions refuse after each revision/selection/history/generation/lifecycle barrier', async () => {
  for (const change of ['revision', 'selection', 'history', 'remount', 'destroy']) {
    const context = await open(); const { editor } = context;
    try {
      const leaf = textLeaf(editor).id; select(editor, leaf, 1);
      if (change === 'history') accepted(completed(command(editor, { kind: 'insert_text', text: 'A' }, { kind: 'typing', token: '7', class: 'insert' })));
      const captured = editor.captureHostRequest(); assert.equal(captured.status, 'captured');
      if (change === 'revision') accepted(completed(command(editor, { kind: 'insert_text', text: 'X' })));
      if (change === 'selection') select(editor, leaf, 2);
      if (change === 'history') { const before = editor.capture(); accepted(completed(editor.submit({ kind: 'barrier', stamp: before }))); assert.notEqual(editor.capture().history_epoch, before.history_epoch); }
      if (change === 'remount') accepted(completed(editor.submit({ kind: 'remount', stamp: editor.capture(), input_json: JSON.stringify(document('new')), admission: 'validate' })));
      if (change === 'destroy') editor.destroy();
      const before = editor.capture();
      assert.equal(refused(completed(editor.completeHostRequest(captured.request, { kind: 'barrier', stamp: captured.request.stamp }))).code, 'sdk.stale_request', change);
      assert.deepEqual(editor.capture(), before); assert.equal(editor.resources().host_requests, 0);
    } finally { context.close(); }
  }
});

test('packaged SDK: listener throw/unsubscribe/new listener and callback destroy preserve exact native ownership', async () => {
  const context = await open(); const { editor } = context;
  try {
    const leaf = textLeaf(editor).id; select(editor, leaf, 1);
    const seen = []; let remove, once = false;
    const removeFirst = editor.subscribe(event => { seen.push(`first:${event.after.revision}`); if (!once) { once = true; remove(); editor.subscribe(e => seen.push(`new:${e.after.revision}`)); } throw new Error('controlled listener exception'); });
    remove = editor.subscribe(event => seen.push(`removed:${event.after.revision}`));
    editor.subscribe(event => seen.push(`last:${event.after.revision}`));
    accepted(completed(command(editor, { kind: 'insert_text', text: 'X' })));
    accepted(completed(command(editor, { kind: 'insert_text', text: 'Y' })));
    assert.deepEqual(seen, ['first:1', 'last:1', 'first:2', 'last:2', 'new:2']);
    assert.equal(context.callbackErrors.length, 2); removeFirst();
  } finally { context.close(); }
  const next = await open();
  try {
    const leaf = textLeaf(next.editor).id; select(next.editor, leaf, 1);
    const seen = []; let queued, disposal;
    next.editor.subscribe(() => { seen.push('first'); queued = command(next.editor, { kind: 'insert_text', text: 'never' }); disposal = next.editor.destroy(); throw new Error('after destroy request'); });
    next.editor.subscribe(() => seen.push('forbidden'));
    accepted(completed(command(next.editor, { kind: 'insert_text', text: 'X' })));
    assert.equal(refused(await settled(queued)).code, 'sdk.cancelled'); assert.equal(accepted(await settled(disposal)).kind, 'destroyed');
    assert.deepEqual(seen, ['first']); assert.equal(next.editor.lifecycle, 'destroyed');
    assert.equal(next.callbackErrors.length, 0); assert.equal(next.editor.resources().callback_error_handlers, 0);
  } finally { next.close(); }
});

test('packaged SDK: pending hard cap128 and64-turn yielding settle actual stale native requests exactly once', async () => {
  const context = await open(undefined, {}, { limits: { pending: 9999, listeners: 9999 } }); const { editor } = context;
  try {
    const leaf = textLeaf(editor).id; select(editor, leaf, 1);
    const tickets = []; let once = false;
    editor.subscribe(() => { if (!once) { once = true; const request = commandRequest(editor, { kind: 'insert_text', text: 'Y' }); for (let i = 0; i < 129; i++) tickets.push(editor.submit(request)); } });
    for (let index = 1; index < 64; index++) assert.equal(typeof editor.subscribe(() => {}), 'function');
    assert.equal(refused(editor.subscribe(() => {})).code, 'sdk.listener_limit');
    accepted(completed(command(editor, { kind: 'insert_text', text: 'X' })));
    assert.equal(tickets.filter(t => t.status === 'queued').length, 128);
    assert.equal(refused(completed(tickets[128])).code, 'sdk.queue_limit');
    assert.equal(editor.resources().task_continuations, 1);
    const outcomes = await Promise.all(tickets.slice(0, 128).map(settled));
    assert.equal(outcomes.filter(r => r.status === 'ok').length, 1);
    assert.ok(outcomes.slice(1).every(r => refused(r).code === 'session.stale_revision'));
    assert.deepEqual(JSON.parse(canonical(editor)), document('aXYbc'));
    assert.equal(editor.resources().pending_tickets, 0); assert.equal(context.callbackErrors.length, 0);
  } finally { context.close(); }
});

test('packaged SDK: current identity facts on untouched nodes are rechecked and retry succeeds', async () => {
  const id = '550e8400-e29b-41d4-a716-446655440006';
  const input = document('abc'); input.content.unshift({ type: 'paragraph', content: [{ type: 'text', text: 'Name', marks: [{ type: 'reference_link', attrs: { reference_entity_id: id } }] }] });
  const context = await open(input, { identities: { media: [], references: [{ id, status: 'exists' }] } }); const { editor } = context;
  try {
    select(editor, textLeaf(editor, 1).id, 1); const events = []; editor.subscribe(event => events.push(event));
    accepted(completed(editor.submit({ kind: 'update_facts', stamp: editor.capture(), identities: { media: [], references: [{ id, status: 'unavailable' }] } })));
    const before = editor.capture(), query = accepted(editor.query({ kind: 'query_command', stamp: before, command: kwdjCommand({ kind: 'insert_text', text: 'X' }) }));
    assert.equal(query.available, false); assert.ok(query.diagnostic.code.length > 0);
    const failure = refused(completed(command(editor, { kind: 'insert_text', text: 'X' })));
    assert.equal(failure.code, query.diagnostic.code); assert.deepEqual(editor.capture(), before); assert.equal(events.length, 0);
    accepted(completed(editor.submit({ kind: 'update_facts', stamp: editor.capture(), identities: { media: [], references: [{ id, status: 'exists' }] } })));
    accepted(completed(command(editor, { kind: 'insert_text', text: 'X' })));
    const expected = structuredClone(input); expected.content[1].content[0].text = 'aXbc';
    assert.deepEqual(JSON.parse(canonical(editor)), expected); assert.equal(events.length, 1); assert.equal(context.callbackErrors.length, 0);
  } finally { context.close(); }
});

test('packaged SDK:32 engine-issued receipts are bounded, release/retry works and forged/old handles refuse', async () => {
  const context = await open(); const { editor } = context;
  try {
    const receipts = Array.from({ length: 32 }, () => snapshot(editor));
    assert.equal(accepted(editor.read({ kind: 'resources' })).resources.snapshot_handles, 32);
    const before = editor.capture();
    assert.equal(refused(completed(editor.submit({ kind: 'snapshot', stamp: before, max_bytes: 100000 }))).code, 'sdk.snapshot_limit');
    assert.deepEqual(editor.capture(), before);
    assert.equal(refused(completed(editor.submit({ kind: 'acknowledge_snapshot', stamp: before, handle: 'forged' }))).code, 'sdk.stale_snapshot');
    release(editor, receipts[0].handle); const replacement = snapshot(editor); assert.notEqual(replacement.handle, receipts[0].handle);
    assert.equal(refused(completed(editor.submit({ kind: 'release_snapshot', handle: receipts[0].handle }))).code, 'sdk.stale_snapshot');
    for (const receipt of receipts.slice(1)) release(editor, receipt.handle); release(editor, replacement.handle);
    assert.equal(accepted(editor.read({ kind: 'resources' })).resources.snapshot_handles, 0); assert.equal(context.callbackErrors.length, 0);
  } finally { context.close(); }
});

test('packaged SDK: lossless metadata/MAXu64/null values and malformed destroy preserve coherent Session', async () => {
  const input = '{"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"ordered_list","attrs":{"start":18446744073709551615},"content":[{"type":"list_item","content":[{"type":"paragraph","content":[{"type":"text","text":"abc"}]}]}]}]}';
  const context = await open(input); const { editor } = context;
  try {
    const list = node(editor, root(editor).children[0]);
    // Owned JSON dictionaries deliberately have a null prototype; authored data
    // and the closed tagged DTO fields are the literal preservation contract.
    assert.deepEqual(Object.keys(list.attributes.start).sort(), ['kind', 'value']);
    assert.equal(list.attributes.start.kind, 'number');
    assert.equal(list.attributes.start.value, '18446744073709551615');
    assert.match(canonical(editor), /"start":18446744073709551615/);
    const before = editor.capture();
    assert.equal(refused(editor.read({ kind: 'node', stamp: { ...before, revision: '18446744073709551615' }, node: list.id })).code, 'session.stale_revision');
    assert.equal(refused(editor.read({ kind: 'node', stamp: { ...before, revision: '18446744073709551616' }, node: list.id })).code, 'sdk.invalid_u64');
    assert.equal(refused(completed(editor.submit({ kind: 'destroy', extra: true }))).code, 'sdk.invalid_input');
    const captured = editor.captureHostRequest();
    assert.equal(refused(completed(editor.completeHostRequest(captured.request, { kind: 'destroy', stamp: captured.request.stamp }))).code, 'sdk.invalid_input');
    assert.equal(editor.lifecycle, 'ready'); assert.deepEqual(editor.capture(), before);
    assert.equal(accepted(editor.read({ kind: 'resources' })).resources.sessions, 1);
    assert.equal(context.callbackErrors.length, 0);
  } finally { context.close(); }
});

test('packaged SDK: readonly permits navigation while document commands refuse without publication', async () => {
  const context = await open(document('abc'), { access: 'read_only' }); const { editor } = context;
  try {
    const events = []; editor.subscribe(event => events.push(event));
    select(editor, textLeaf(editor).id, 1); assert.equal(events.length, 1); assert.equal(events[0].change.kind, 'state');
    const before = editor.capture(), query = accepted(editor.query({ kind: 'query_command', stamp: before, command: kwdjCommand({ kind: 'insert_text', text: 'X' }) }));
    assert.equal(query.available, false);
    assert.equal(refused(completed(command(editor, { kind: 'insert_text', text: 'X' }))).code, query.diagnostic.code);
    assert.deepEqual(editor.capture(), before); assert.equal(events.length, 1); assert.deepEqual(JSON.parse(canonical(editor)), document('abc'));
  } finally { context.close(); }
});

test('packaged SDK: repeated complete lifecycle releases actual native and JS ownership', async () => {
  const module = await productionModule(), baseline = counts(module);
  let resolve;
  const delayed = new Promise(ready => { resolve = ready; });
  const options = { abi: module.manifest.abi, build_id: module.manifest.build_id, profile: structuredClone(module.manifest.profiles[0]), admission: 'validate', access: 'editable', identities: { media: [], references: [] }, limits: null };
  const cancelled = createEditor({ input: new TextEncoder().encode(source(document('abc'))), options, loader: () => delayed, onCallbackError: () => assert.fail('cancelled callback') });
  assert.equal(cancelled.resources().callback_error_handlers, 1);
  cancelled.destroy(); assert.equal(cancelled.resources().callback_error_handlers, 0);
  assert.equal(refused(await cancelled.ready).code, 'sdk.cancelled');
  resolve(module); await new Promise(ready => setTimeout(ready, 0));
  assert.equal(cancelled.resources().sessions, 0); assert.deepEqual(counts(module), baseline);
  const invalid = createEditor({ input: new Uint8Array(), options, loader: 1, onCallbackError: () => assert.fail('invalid callback') });
  assert.equal(refused(await invalid.ready).code, 'sdk.invalid_input');
  assert.equal(invalid.resources().callback_error_handlers, 0); invalid.destroy();
  assert.deepEqual(counts(module), baseline);
  for (let cycle = 0; cycle < 24; cycle++) {
    const context = await open();
    try {
      const { editor } = context; select(editor, textLeaf(editor).id, 1); editor.subscribe(() => {});
      accepted(completed(command(editor, { kind: 'insert_text', text: 'X' })));
      const receipt = snapshot(editor); assert.equal(accepted(editor.read({ kind: 'resources' })).resources.snapshot_handles, 1);
      accepted(completed(editor.submit({ kind: 'acknowledge_snapshot', stamp: editor.capture(), handle: receipt.handle })));
      editor.captureHostRequest();
      assert.equal(context.callbackErrors.length, 0);
    } finally { context.close(); }
    assert.deepEqual(counts(module), baseline);
  }
});
