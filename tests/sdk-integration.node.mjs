// SPDX-License-Identifier: MIT OR Apache-2.0
// Actual packaged release WASM + public controller; no controlled/fake bridge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { literaryFixture, referencePreservationFixture, warningFixture } from './support/codec-fixtures.mjs';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
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

async function withLiteraryCommandSession(input, run, media = [], access = 'editable', references = []) {
  const packet = JSON.parse(readFileSync(new URL('../artifacts/extensions/packet.json', import.meta.url)));
  const wasm = readFileSync(new URL('../packages/wasm/dist/editor_wasm_bg.wasm', import.meta.url));
  const module = await loadSdkV2({ wasm: new Uint8Array(wasm) });
  const baseline = counts(module);
  const options = {
    abi: 'editor-sdk/2', build_id: module.manifest.build_id, profile: packet.kwdjProfile,
    admission: 'validate', access, registry_json: packet.kwdjRegistryJson,
    profile_options_json: JSON.stringify({ identities: { media, references }, limits: null }),
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

test('OSR-203 packaged SDK2 admits retained table variants and preserves refused source bytes', async t => {
  const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
  const packet = read('../artifacts/extensions/packet.json');
  const wasm = new Uint8Array(readFileSync(new URL('../packages/wasm/dist/editor_wasm_bg.wasm', import.meta.url)));
  const module = await loadSdkV2({ wasm });
  const baseline = counts(module);
  const encoder = new TextEncoder();
  const cases = ['positive', 'mixed']
    .flatMap(file => read(`../contracts/kwdj/v1/fixtures/${file}.json`).fixtures)
    .filter(fixture => ['DOC-010', 'DOC-011', 'DOC-012'].includes(fixture.id))
    .flatMap(fixture => fixture.cases);
  assert.equal(cases.length, 6);
  const refusalPaths = {
    normalized_unit_spans_rejected: '/content/0/content/0/content/0/attrs/rowspan',
    malformed_effective_grid: '/content/0',
  };
  const openCase = async (input, admission, verify) => {
    const original = input.slice();
    const options = {
      abi: 'editor-sdk/2', build_id: module.manifest.build_id, profile: packet.kwdjProfile,
      admission, access: 'read_only', registry_json: packet.kwdjRegistryJson,
      profile_options_json: '{"identities":{"media":[],"references":[]},"limits":null}',
    };
    const editor = createEditor({ input, options, loader: async () => module });
    try {
      return verify(await editor.ready, editor, original);
    } finally {
      assert.deepEqual(input, original);
      accepted(await settled(editor.destroy()));
      assert.deepEqual(counts(module), baseline);
    }
  };
  const checkExport = expected => (ready, editor) => {
    accepted(ready);
    const before = state(editor);
    assert.equal(before.stamp.revision, '0');
    assert.equal(before.history.undo_entries, '0');
    assert.equal(before.dirty, false);
    const exported = canonical(editor);
    assert.equal(exported, expected);
    assert.deepEqual(state(editor), before);
    return exported;
  };
  for (const row of cases) {
    await t.test(row.name, async () => {
      const normalize = row.name === 'pre_normalized_unit_spans_removed';
      const input = encoder.encode(JSON.stringify(normalize ? row.input.value : row.kwdj, null, 2));
      if (Object.hasOwn(refusalPaths, row.name)) {
        await openCase(input, 'validate', (ready, editor, original) => {
          const diagnostic = refused(ready);
          assert.equal(diagnostic.code, row.expected.diagnostic_codes[0]);
          assert.equal(diagnostic.path, refusalPaths[row.name]);
          assert.equal(diagnostic.may_have_committed, false);
          assert.equal(editor.capture(), null);
          assert.deepEqual(counts(module), baseline);
          assert.deepEqual(editor.originalInput(), original);
        });
      } else {
        const check = checkExport(osr185Bytes(row.kwdj));
        const exported = await openCase(input, normalize ? 'normalize' : 'validate', check);
        await openCase(encoder.encode(exported), 'validate', check);
      }
    });
  }
});

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

test('OSR-194 packaged SDK2 matches six pinned CMS verse keys with exact Undo', async t => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/osr-194-verse-keys.json', import.meta.url), 'utf8'));
  const input = osr185Bytes(fixture.input);
  assert.equal(fixture.cases.length, 6);
  for (const { key, position: name, offset, expected } of fixture.cases) {
    await t.test(`${key} × ${name}`, async () => {
      await withLiteraryCommandSession(input, editor => {
        const verse = node(editor, root(editor).children[0]);
        const line = node(editor, verse.children[0]);
        osr185Select(editor, position(line.children[0], offset));
        const command = kwdjCommand({ kind: key === 'Enter' ? 'enter' : 'shift_enter' });
        assert.equal(accepted(osr183Wire(editor, command)).effect, 'changed');
        assert.equal(canonical(editor), osr185Bytes(expected));
        assert.equal(state(editor).history.undo_entries, '1');
        osr183History(editor, 'undo', input);
      });
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

const osr195Fixture = () => JSON.parse(readFileSync(new URL('./fixtures/osr-195-empty-verse-and-stanzas.json', import.meta.url), 'utf8'));

test('OSR-195 packaged WASM admits empty shells, normalizes adjacent breaks and reopens exact counts', async t => {
  const codec = await import('../packages/wasm/dist/editor_wasm.js');
  const { options } = await import('./support/codec-fixtures.mjs');
  await codec.default({ module_or_path: readFileSync(new URL('../packages/wasm/dist/editor_wasm_bg.wasm', import.meta.url)) });
  for (const row of osr195Fixture().candidates) {
    await t.test(row.id, async () => {
      const input = new TextEncoder().encode(osr185Bytes(row.input));
      for (const [operation, expected] of [[codec.kwdjValidateV1, row.strict], [codec.kwdjNormalizeV1, row.normalize]]) {
        const observed = JSON.parse(operation(input, options()));
        assert.equal(observed.status, expected.status, JSON.stringify(observed));
        if (expected.status === 'refused') {
          assert.equal(observed.diagnostic.code, expected.code);
          assert.equal(observed.diagnostic.path, expected.path);
        } else {
          const bytes = osr185Bytes(expected.exported);
          assert.equal(observed.canonical_json, bytes);
          await withLiteraryCommandSession(bytes, editor => assert.equal(canonical(editor), bytes));
        }
      }
    });
  }
});

test('OSR-195 packaged SDK2 matches empty verse and stanza transitions with exact Undo', async t => {
  for (const row of osr195Fixture().keys) {
    await t.test(row.id, async () => {
      const input = osr185Bytes(row.input);
      await withLiteraryCommandSession(input, editor => {
        const nodeAt = path => path.reduce((id, index) => node(editor, id).children[index], state(editor).root);
        const versePath = row.enter_at.slice(0, -1);
        const verse = nodeAt(versePath);
        osr185Select(editor, osr185Gap(nodeAt(row.enter_at), 0));
        const before = state(editor);
        const reply = accepted(osr183Wire(editor, kwdjCommand({ kind: 'enter' })));
        assert.equal(reply.effect, row.changed ? 'changed' : 'unchanged');
        assert.equal(canonical(editor), osr185Bytes(row.expected));
        assert.equal(nodeAt(versePath), verse);
        const block = nodeAt(row.caret.path);
        const first = node(editor, block).children[0];
        const point = first && node(editor, first).primitive === 'text'
          ? position(first, row.caret.offset)
          : osr185Gap(block, row.caret.offset);
        const after = state(editor);
        assert.deepEqual(structuredClone(after.selection), { anchor: point, focus: point });
        if (row.changed) {
          assert.equal(after.history.undo_entries, '1');
          osr183History(editor, 'undo', input);
          assert.deepEqual(state(editor).selection, before.selection);
        } else {
          assert.deepEqual(after, before);
        }
      });
    });
  }
});

function osr196Points(editor, point) {
  const block = point.path.reduce((id, index) => node(editor, id).children[index], state(editor).root);
  if (point.kind === 'child') return [osr185Gap(block, point.index)];

  // Prefer a text point when setting selection, but accept the equivalent
  // inline child gap at a text edge when checking the command's result.
  const children = node(editor, block).children;
  const points = [];
  let offset = 0;
  for (const [index, child] of children.entries()) {
    const end = offset + node(editor, child).text.length;
    if (point.offset >= offset && point.offset <= end) points.push(position(child, point.offset - offset));
    if (point.offset === offset) points.push(osr185Gap(block, index));
    offset = end;
  }
  if (point.offset === offset) points.push(osr185Gap(block, children.length));
  return points;
}

const tableIdTree = (editor, id) => ({ id, children: node(editor, id).children.map(child => tableIdTree(editor, child)) });
test('OSR-205 packaged SDK2 row commands retain geometry, IDs and exact Undo/Redo', async t => {
  const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  const corpus = ['positive', 'mixed']
    .flatMap(file => read(`../contracts/kwdj/v1/fixtures/${file}.json`).fixtures)
    .flatMap(fixture => fixture.cases);
  for (const fixture of read('./fixtures/osr-205-table-rows.json').cases) {
    await t.test(fixture.id, async () => {
      const source = corpus.find(candidate => candidate.name === fixture.source).kwdj;
      const input = osr185Bytes(source);
      let exported;
      await withLiteraryCommandSession(input, editor => {
        const table = root(editor).children[0];
        const beforeIds = tableIdTree(editor, table);
        const row = beforeIds.children[fixture.row];
        select(editor, row.children[0].children[0].children[0].id, 0);
        const before = state(editor);
        const payload = { kind: fixture.command, row: fixture.cell_target ? row.children[0].id : row.id };
        const id = `org.klenwriter.kwdj/command/${fixture.command.replaceAll('_', '-')}`;
        const response = osr183Wire(editor, createCommand(id, payload));
        if (fixture.diagnostic) {
          const diagnostic = refused(response);
          assert.equal(diagnostic.code, fixture.diagnostic.code);
          assert.equal(diagnostic.path, fixture.diagnostic.path);
          assert.equal(diagnostic.may_have_committed, false);
          assert.deepEqual(state(editor), before);
          assert.equal(canonical(editor), input);
          assert.deepEqual(tableIdTree(editor, table), beforeIds);
          assert.deepEqual(kwdjCommand(payload), createCommand(id, payload));
          return;
        }
        assert.equal(accepted(response).effect, 'changed');
        assert.deepEqual(kwdjCommand(payload), createCommand(id, payload));
        const expected = structuredClone(source);
        expected.content[0].content = fixture.expected_rows;
        exported = canonical(editor);
        assert.equal(exported, osr185Bytes(expected));
        assert.equal(root(editor).children[0], table);
        const afterIds = tableIdTree(editor, table);
        const retainedBefore = beforeIds.children.slice();
        const retainedAfter = afterIds.children.slice();
        if (fixture.inserted === undefined) {
          retainedBefore.splice(fixture.row, 1);
        } else {
          retainedAfter.splice(fixture.inserted, 1);
        }
        assert.deepEqual(retainedAfter, retainedBefore);
        const after = state(editor);
        assert.equal(after.stamp.revision, '1');
        assert.equal(after.history.undo_entries, '1');
        assert.equal(after.history.redo_entries, '0');
        if (fixture.inserted !== undefined) assert.deepEqual(after.selection, before.selection);

        osr183History(editor, 'undo', input);
        assert.deepEqual(tableIdTree(editor, table), beforeIds);
        assert.deepEqual(state(editor).selection, before.selection);
        assert.equal(state(editor).history.undo_entries, '0');
        assert.equal(state(editor).history.redo_entries, '1');
        osr183History(editor, 'redo', exported);
        assert.deepEqual(tableIdTree(editor, table), afterIds);
        assert.deepEqual(state(editor).selection, after.selection);
        assert.equal(state(editor).history.undo_entries, '1');
        assert.equal(state(editor).history.redo_entries, '0');
      });
      if (exported) {
        await withLiteraryCommandSession(exported, editor => assert.equal(canonical(editor), exported));
      }
    });
  }
});

test('OSR-205 row command wire is closed and confined to SDK2', async () => {
  const corpus = JSON.parse(readFileSync(new URL('../contracts/kwdj/v1/fixtures/positive.json', import.meta.url), 'utf8'));
  const input = osr185Bytes(corpus.fixtures.find(fixture => fixture.id === 'DOC-010').cases[0].kwdj);
  const insert = 'org.klenwriter.kwdj/command/insert-row-above';
  const remove = 'org.klenwriter.kwdj/command/delete-row';
  const target = editor => node(editor, root(editor).children[0]).children[0];
  await withLiteraryCommandSession(input, editor => {
    const before = state(editor);
    const row = target(editor);
    for (const command of [
      createCommand(insert, { kind: 'insert_row_above', row, unexpected: true }),
      createCommand(insert, { kind: 'insert_row_below', row }),
      createCommand(remove, { kind: 'delete_row' }),
    ]) {
      const diagnostic = refused(osr183Wire(editor, command));
      assert.equal(diagnostic.code, 'sdk.invalid_dto');
      assert.equal(diagnostic.may_have_committed, false);
      assert.deepEqual(state(editor), before);
      assert.equal(canonical(editor), input);
    }
  });
  const legacy = await open(input);
  try {
    const { editor } = legacy;
    const before = state(editor);
    const catalog = accepted(editor.read({ kind: 'catalog' })).commands;
    assert.equal(catalog.length, 17);
    assert(!catalog.includes(remove));
    const diagnostic = refused(osr183Wire(editor, createCommand(remove, { kind: 'delete_row', row: target(editor) })));
    assert.equal(diagnostic.code, 'sdk.invalid_dto');
    assert.equal(diagnostic.may_have_committed, false);
    assert.deepEqual(state(editor), before);
    assert.equal(canonical(editor), input);
  } finally {
    legacy.close();
  }
});

const tableColumnFixtures = () => JSON.parse(readFileSync(new URL('./fixtures/osr-206-table-columns.json', import.meta.url), 'utf8'));
const tableColumnPayload = (fixture, table) => ({ kind: fixture.command, table, column: fixture.column });
const tableColumnWire = payload => createCommand(`org.klenwriter.kwdj/command/${payload.kind.replaceAll('_', '-')}`, payload);

test('OSR-208 packaged SDK2 explicit table-column queries remain available with a directed rectangle', async () => {
  const fixtures = JSON.parse(readFileSync(new URL('../contracts/kwdj/v1/fixtures/positive.json', import.meta.url), 'utf8')).fixtures;
  const source = fixtures.find(doc => doc.id === 'DOC-011').cases.find(item => item.name === 'table_spans_alignment').kwdj;
  await withLiteraryCommandSession(osr185Bytes(source), editor => {
    const table = node(editor, root(editor).children[0]);
    const selection = {
      anchor: { kind: 'edge', node: node(editor, table.children[1]).children[1], side: 'before' },
      focus: { kind: 'edge', node: node(editor, table.children[0]).children[0], side: 'after' },
    };
    accepted(completed(editor.submit({ kind: 'set_selection', stamp: editor.capture(), selection })));
    const selected = state(editor);
    assert.deepEqual(structuredClone(selected.selection), selection);
    const column = kwdjCommand({ kind: 'insert_column_left', table: table.id, column: 0 });
    const query = accepted(editor.query({ kind: 'query_command', stamp: selected.stamp, command: column }));
    assert.equal(query.available, true);
    assert.deepEqual(state(editor), selected);
  });
});

test('OSR-206 packaged SDK2 columns preserve exact geometry, IDs and Undo/Redo', async t => {
  const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  const corpus = ['positive', 'mixed']
    .flatMap(file => read(`../contracts/kwdj/v1/fixtures/${file}.json`).fixtures)
    .flatMap(fixture => fixture.cases);
  for (const fixture of tableColumnFixtures().cases) {
    await t.test(fixture.id, async () => {
      const source = structuredClone(corpus.find(candidate => candidate.name === fixture.source).kwdj);
      if (fixture.header_override) source.content[0].content[0] = fixture.header_override;
      const input = osr185Bytes(source);
      let exported;
      await withLiteraryCommandSession(input, editor => {
        const table = root(editor).children[0];
        const beforeIds = tableIdTree(editor, table);
        select(editor, beforeIds.children[0].children[0].children[0].children[0].id, 0);
        const before = state(editor);
        const payload = tableColumnPayload(fixture, fixture.row_target ? beforeIds.children[0].id : table);
        const command = tableColumnWire(payload);
        const preview = accepted(editor.query({ kind: 'query_command', stamp: editor.capture(), command }));
        assert.equal(preview.available, !fixture.diagnostic);
        assert.deepEqual(state(editor), before);
        const response = osr183Wire(editor, command);
        if (fixture.diagnostic) {
          const diagnostic = refused(response);
          assert.equal(diagnostic.code, fixture.diagnostic.code);
          assert.equal(diagnostic.path, fixture.diagnostic.path);
          assert.equal(preview.diagnostic.code, diagnostic.code);
          assert.equal(preview.diagnostic.path, diagnostic.path);
          assert.equal(diagnostic.may_have_committed, false);
          assert.deepEqual(state(editor), before);
          assert.equal(canonical(editor), input);
          assert.deepEqual(tableIdTree(editor, table), beforeIds);
          assert.deepEqual(kwdjCommand(payload), command);
          return;
        }
        assert.equal(accepted(response).effect, 'changed');
        assert.deepEqual(kwdjCommand(payload), command);
        source.content[0].content = fixture.expected_rows;
        exported = canonical(editor);
        assert.equal(exported, osr185Bytes(source));
        assert.equal(root(editor).children[0], table);
        const afterIds = tableIdTree(editor, table);
        const retainedBefore = structuredClone(beforeIds), retainedAfter = structuredClone(afterIds);
        const retained = fixture.command === 'delete_column' ? retainedBefore : retainedAfter;
        fixture.changed_indices.forEach((index, row) => {
          if (index !== null) retained.children[row].children.splice(index, 1);
        });
        assert.deepEqual(retainedAfter, retainedBefore);
        const after = state(editor);
        assert.equal(after.stamp.revision, '1');
        assert.equal(after.history.undo_entries, '1');
        assert.equal(after.history.redo_entries, '0');
        if (fixture.command !== 'delete_column') assert.deepEqual(after.selection, before.selection);
        osr183History(editor, 'undo', input);
        assert.deepEqual(tableIdTree(editor, table), beforeIds);
        assert.deepEqual(state(editor).selection, before.selection);
        assert.equal(state(editor).history.undo_entries, '0');
        assert.equal(state(editor).history.redo_entries, '1');
        osr183History(editor, 'redo', exported);
        assert.deepEqual(tableIdTree(editor, table), afterIds);
        assert.deepEqual(state(editor).selection, after.selection);
        assert.equal(state(editor).history.undo_entries, '1');
        assert.equal(state(editor).history.redo_entries, '0');
      });
      if (exported) await withLiteraryCommandSession(exported, editor => assert.equal(canonical(editor), exported));
    });
  }
});

test('OSR-206 packaged SDK2 column operation budget is atomic', async t => {
  const cell = {type:'table_cell', content:[{type:'paragraph', content:[]}]};
  const grid = (rows, columns, verticalFirstColumn = false) => osr183Doc([{
    type:'table', content:Array.from({length:rows}, (_, row) => ({
      type:'table_row',
      content: verticalFirstColumn
        ? row % 2 === 0 ? [{ ...cell, attrs:{rowspan:2} }, cell] : [cell]
        : Array.from({length:columns}, () => cell),
    })),
  }]);
  for (const fixture of tableColumnFixtures().bounded) {
    await t.test(fixture.id, async () => {
      const input = grid(fixture.rows, 2, fixture.vertical_first_column);
      await withLiteraryCommandSession(input, editor => {
        const table = root(editor).children[0];
        const before = state(editor), rowIds = node(editor, table).children;
        const result = osr183Wire(editor, tableColumnWire(tableColumnPayload(fixture, table)));
        if (fixture.expected_columns) {
          assert.equal(accepted(result).effect, 'changed');
          const expected = grid(fixture.rows, fixture.expected_columns);
          assert.equal(canonical(editor), expected);
          assert.deepEqual(node(editor, table).children, rowIds);
          assert.equal(state(editor).history.undo_entries, '1');
          osr183History(editor, 'undo', input);
          osr183History(editor, 'redo', expected);
        } else {
          const diagnostic = refused(result);
          assert.equal(diagnostic.code, 'kwdj.admission_budget_exceeded');
          assert.deepEqual(structuredClone(diagnostic.details), { limit:'command_operations', maximum:'256', observed:'257' });
          assert.equal(diagnostic.may_have_committed, false);
          assert.deepEqual(state(editor), before);
          assert.equal(canonical(editor), input);
          assert.deepEqual(node(editor, table).children, rowIds);
        }
      });
    });
  }
});

test('OSR-206 column wire accepts only the matching SDK2 command and a u32 coordinate', async () => {
  const corpus = JSON.parse(readFileSync(new URL('../contracts/kwdj/v1/fixtures/positive.json', import.meta.url), 'utf8'));
  const input = osr185Bytes(corpus.fixtures.find(fixture => fixture.id === 'DOC-010').cases[0].kwdj);
  const id = 'org.klenwriter.kwdj/command/delete-column';
  await withLiteraryCommandSession(input, editor => {
    const before = state(editor);
    const table = root(editor).children[0];
    assert.throws(() => createCommand(id, {kind:'delete_column', table, column:1.5}), /sdk.invalid_integer/);
    for (const body of [
      {kind:'delete_column', table},
      {kind:'delete_column', table, column:-1},
      {kind:'delete_column', table, column:1.5},
      {kind:'delete_column', table, column:'1'},
      {kind:'delete_column', table, column:0x100000000},
      {kind:'delete_column', table, column:1, extra:true},
      {kind:'insert_column_left', table, column:1},
    ]) {
      const diagnostic = refused(osr183Wire(editor, { id, payload_json: JSON.stringify(body) }));
      assert.equal(diagnostic.code, 'sdk.invalid_dto');
      assert.equal(diagnostic.may_have_committed, false);
      assert.deepEqual(state(editor), before);
    }
    const max = refused(osr183Wire(editor, createCommand(id, {kind:'delete_column', table, column:0xffffffff})));
    assert.equal(max.code, 'kwdj.command_invalid_target');
    assert.deepEqual(state(editor), before);
    assert.equal(canonical(editor), input);
  });
  const legacy = await open(input);
  try {
    const { editor } = legacy;
    const before = state(editor);
    assert.equal(accepted(editor.read({ kind: 'catalog' })).commands.length, 17);
    const diagnostic = refused(osr183Wire(editor, createCommand(id, {kind:'delete_column', table:root(editor).children[0], column:1})));
    assert.equal(diagnostic.code, 'sdk.invalid_dto');
    assert.deepEqual(state(editor), before);
    assert.equal(canonical(editor), input);
  } finally {
    legacy.close();
  }
});

test('OSR-213 packaged SDK2 refuses only recognized cell targets and preserves the whole state', async () => {
  const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  const fixture = read('./fixtures/osr-213-table-refusals.json');
  const original = read('../contracts/kwdj/v1/fixtures/positive.json').fixtures.flatMap(f => f.cases)
    .find(row => row.name === fixture.source).kwdj;
  const document = structuredClone(original);
  document.content.push(structuredClone(original.content[0]));
  const input = osr185Bytes(document);
  const at = (editor, path) => path.reduce((id, i) => node(editor, id).children[i], state(editor).root);
  let foreign;
  await withLiteraryCommandSession(input, editor => { foreign = at(editor, fixture.roles.B1); });
  await withLiteraryCommandSession(input, editor => {
    const ids = Object.fromEntries(Object.entries(fixture.roles).map(([role, path]) => [role, at(editor, path)]));
    osr185Select(editor, position(ids.Body, 1));
    const edit = accepted(osr183Wire(editor, kwdjCommand({kind:'insert_text',text:'!'})));
    assert.equal(edit.effect, 'changed');
    osr183History(editor, 'undo', input);
    const before = state(editor), tree = tableIdTree(editor, before.root);
    assert.equal(before.history.redo_entries, '1');
    const check = (name, payload, code, path, prepared = true) => {
      const command = createCommand(`org.klenwriter.kwdj/command/${name}`, payload);
      const query = editor.query({kind:'query_command',stamp:editor.capture(),command});
      let diagnostic;
      if (prepared) {
        const availability = accepted(query);
        assert.equal(availability.available, false);
        assert.equal(availability.effect, null);
        diagnostic = availability.diagnostic;
      } else diagnostic = refused(query);
      const mutation = refused(osr183Wire(editor, command));
      for (const value of [diagnostic, mutation]) {
        assert.equal(value.code, code, name);
        assert.equal(value.path, path, name);
        assert.equal(value.may_have_committed, false, name);
      }
      assert.deepEqual(state(editor), before, name);
      assert.deepEqual(tableIdTree(editor, before.root), tree, name);
      assert.equal(canonical(editor), input, name);
    };
    for (const operation of fixture.operations) {
      const payload = {kind:operation.kind, ...Object.fromEntries(
        Object.entries(operation.targets).map(([key, role]) => [key, ids[role]]))};
      check(operation.name, payload, fixture.diagnostic, '/command');
      assert.deepEqual(kwdjCommand(payload), createCommand(`org.klenwriter.kwdj/command/${operation.name}`, payload));
    }
    const invalid = 'kwdj.command_invalid_target';
    check('split-cell', {kind:'split_cell',cell:ids.T}, invalid, '/command');
    check('merge-cells', {kind:'merge_cells',anchor:ids.B1,focus:ids.B1}, invalid, '/command');
    check('move-cell', {kind:'move_cell',cell:ids.B1,target:at(editor,[1,0,0])}, invalid, '/command');
    check('split-cell', {kind:'split_cell',cell:ids.B1.replace(/:[0-9]+$/, ':18446744073709551615')}, invalid, '/command');
    check('move-cell', {kind:'move_cell',cell:ids.B1,target:foreign}, 'session.stale_session', 'command.target', false);
    check('split-cell', {kind:'split_cell',cell:ids.B1,extra:false}, 'sdk.invalid_dto', '', false);
    check('merge-cells', {kind:'split_cell',cell:ids.B1}, 'sdk.invalid_dto', 'command', false);
  });
});

test('OSR-213 a generic block move cannot move a cell from an active table rectangle', async () => {
  const corpus = JSON.parse(readFileSync(new URL('../contracts/kwdj/v1/fixtures/positive.json', import.meta.url), 'utf8'));
  const original = corpus.fixtures.find(row => row.id === 'DOC-010').cases.find(row => row.name === 'rectangular_table').kwdj;
  const input = osr185Bytes(original);
  await withLiteraryCommandSession(input, editor => {
    const table = node(editor, root(editor).children[0]);
    const row = node(editor, table.children[1]);
    const [first, second] = row.children;
    const command = kwdjCommand({kind:'move',node:second,parent:row.id,before_index:0});
    const query = () => accepted(editor.query({kind:'query_command',stamp:editor.capture(),command}));
    assert.equal(query().available, true);
    osr185Select(editor, {kind:'edge',node:first,side:'before'}, {kind:'edge',node:second,side:'after'});
    const before = state(editor), tree = tableIdTree(editor, before.root);
    const availability = query();
    assert.equal(availability.available, false);
    for (const result of [availability.diagnostic, refused(osr183Wire(editor, command))]) {
      assert.equal(result.code, 'kwdj.table_cell_operation_unsupported');
      assert.equal(result.path, '/command');
      assert.equal(result.may_have_committed, false);
    }
    assert.deepEqual(state(editor), before);
    assert.deepEqual(tableIdTree(editor, before.root), tree);
    assert.equal(canonical(editor), input);
  });
});

test('OSR-209 packaged SDK2 edits DOC-011 inside a cell and protects both borders', async t => {
  const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  const fixture = read('./fixtures/osr-209-table-cell-edits.json');
  const source = read('../contracts/kwdj/v1/fixtures/positive.json').fixtures.flatMap(f => f.cases)
    .find(row => row.name === fixture.source).kwdj;
  for (const row of [...fixture.cases, ...fixture.forward_regressions]) {
    await t.test(row.id, async () => {
      const path = row.leaf ?? fixture.leaf;
      const document = structuredClone(source);
      const paragraph = path.slice(0, -1).reduce((value, index) => value.content[index], document);
      paragraph.content = row.source_inlines ?? [{type:'text', text:fixture.initial_text}];
      const input = osr185Bytes(document);
      let saved;
      await withLiteraryCommandSession(input, editor => {
        const leaf = path.reduce((id, index) => node(editor, id).children[index], state(editor).root);
        const table = root(editor).children[0];
        osr185Select(editor, position(leaf, row.range[0]), position(leaf, row.range[1]));
        const before = state(editor), ids = tableIdTree(editor, table);
        const payload = row.payload ?? {kind:'delete_forward'};
        const command = createCommand(`org.klenwriter.kwdj/command/${payload.kind.replaceAll('_', '-')}`, payload);
        const response = osr183Wire(editor, command);
        if (row.diagnostic) {
          const diagnostic = refused(response);
          assert.equal(diagnostic.code, row.diagnostic);
          assert.equal(diagnostic.path, '/command');
          assert.equal(diagnostic.may_have_committed, false);
          assert.deepEqual(state(editor), before);
          assert.equal(canonical(editor), input);
          assert.deepEqual(tableIdTree(editor, table), ids);
          return;
        }
        assert.equal(accepted(response).effect, 'changed');
        paragraph.content = row.expected_inlines ?? [{type:'text', text:row.text}];
        saved = canonical(editor);
        assert.equal(saved, osr185Bytes(document));
        const after = state(editor);
        assert.equal(after.stamp.revision, '1');
        assert.equal(after.history.undo_entries, '1');
        if (row.caret !== undefined) {
          const caret = position(leaf, row.caret);
          assert.deepEqual(structuredClone(after.selection), {anchor:caret, focus:caret});
          assert.deepEqual(tableIdTree(editor, table), ids);
        }
        osr183History(editor, 'undo', input);
        assert.deepEqual(state(editor).selection, before.selection);
        assert.deepEqual(tableIdTree(editor, table), ids);
        assert.equal(state(editor).history.undo_entries, '0');
        assert.equal(state(editor).history.redo_entries, '1');
      });
      if (saved) await withLiteraryCommandSession(saved, editor => assert.equal(canonical(editor), saved));
    });
  }
});

test('OSR-196 packaged SDK2 matches CMS verse boundary bytes, selection and Undo', async t => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/osr-196-verse-boundary-deletion.json', import.meta.url), 'utf8'));
  for (const row of [...fixture.cases, ...fixture.refusals]) {
    await t.test(row.id, async () => {
      const input = osr185Bytes(fixture.documents[row.input]);
      let saved;
      await withLiteraryCommandSession(input, editor => {
        const [anchor] = osr196Points(editor, row.selection.anchor);
        const [focus] = osr196Points(editor, row.selection.focus);
        osr185Select(editor, anchor, focus);
        const before = state(editor);
        assert.deepEqual(structuredClone(before.selection), { anchor, focus });

        let payload;
        let id;
        if (!isDeepStrictEqual(anchor, focus)) {
          id = 'delete-selection';
          payload = { kind: 'delete_selection', scope: 'poetry_boundary' };
        } else if (row.key === 'Backspace') {
          id = 'delete-backward';
          payload = { kind: 'delete_backward' };
        } else {
          id = 'delete-forward';
          payload = { kind: 'delete_forward' };
        }
        const command = kwdjCommand(payload);
        assert.deepEqual(command, createCommand(`org.klenwriter.kwdj/command/${id}`, payload));
        const response = osr183Wire(editor, command);
        if (row.diagnostic) {
          const diagnostic = refused(response);
          assert.equal(diagnostic.code, row.diagnostic.code);
          assert.equal(diagnostic.path, row.diagnostic.path);
          assert.equal(diagnostic.may_have_committed, false);
          assert.deepEqual(state(editor), before);
          saved = canonical(editor);
          assert.equal(saved, input);
          return;
        }
        const reply = accepted(response);
        assert.equal(reply.effect, row.effect);
        saved = canonical(editor);
        assert.equal(saved, osr185Bytes(fixture.documents[row.expected]));

        const after = state(editor);
        for (const side of ['anchor', 'focus']) {
          const expected = osr196Points(editor, row.expected_selection[side]);
          const actual = { ...after.selection[side], affinity: 'after' };
          assert.ok(expected.some(point => isDeepStrictEqual(point, actual)),
            `${side} ${JSON.stringify(actual)} outside ${JSON.stringify(expected)}`);
        }
        const changed = row.effect === 'changed';
        assert.equal(after.stamp.revision, (BigInt(before.stamp.revision) + BigInt(changed)).toString());
        assert.equal(after.history.undo_entries, changed ? '1' : '0');
        assert.equal(after.history.redo_entries, '0');
        if (changed) {
          osr183History(editor, 'undo', input);
          const undone = state(editor);
          assert.deepEqual(undone.selection, before.selection);
          assert.equal(undone.history.undo_entries, '0');
          assert.equal(undone.history.redo_entries, '1');
        } else if (row.effect === 'state_changed') {
          assert.notEqual(after.stamp.selection_epoch, before.stamp.selection_epoch);
          assert.equal(after.dirty, before.dirty);
        } else {
          assert.deepEqual(after, before);
        }
      });
      await withLiteraryCommandSession(saved, editor => assert.equal(canonical(editor), saved));
    });
  }
});

test('OSR-198 packaged SDK2 moves verse and stanza without losing authored structure', async t => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/osr-198-poetry-move.json', import.meta.url), 'utf8'));
  for (const row of fixture.cases) {
    await t.test(row.id, async () => {
      const input = osr185Bytes(fixture.documents[row.input]);
      await withLiteraryCommandSession(input, editor => {
        const at = path => path.reduce((id, index) => node(editor, id).children[index], state(editor).root);
        const before = state(editor);
        const moved = at(row.node);
        const command = kwdjCommand({ kind: 'move', node: moved, parent: at(row.parent), before_index: row.before_index });
        const result = osr183Wire(editor, command);
        if (row.refusal) {
          assert.equal(result.status, 'refused');
          assert.equal(result.diagnostic.code, row.refusal.code);
          assert.equal(result.diagnostic.path, row.refusal.path);
          assert.equal(result.diagnostic.may_have_committed, false);
          assert.deepEqual(state(editor), before);
          assert.equal(canonical(editor), input);
          return;
        }
        const effect = row.effect ?? 'changed';
        assert.equal(accepted(result).effect, effect);
        assert.equal(canonical(editor), osr185Bytes(fixture.documents[row.expected]));
        assert.equal(at(row.result_node), moved);
        if (effect === 'changed') {
          assert.equal(state(editor).stamp.revision, '1');
          assert.equal(state(editor).history.undo_entries, '1');
          osr183History(editor, 'undo', input);
          assert.equal(at(row.node), moved);
          assert.equal(state(editor).history.undo_entries, '0');
        } else {
          assert.deepEqual(state(editor), before);
        }
      });
    });
  }
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

test('OSR-285 sealed SDK2 aligns only one selected cell or header, with exact Undo', async () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/osr-285-table-cell-align.json', import.meta.url)));
  const resolve = (editor, path) => path.reduce((parent, index) => node(editor, parent.children[index]), root(editor)).id;
  const set = (editor, selection) => accepted(completed(editor.submit({ kind: 'set_selection', stamp: editor.capture(), selection })));
  for (const row of fixture.cases) await withLiteraryCommandSession(fixture.source, editor => {
    const leaf = resolve(editor, row.point.path);
    const cell = resolve(editor, row.cellPath);
    set(editor, { anchor: position(leaf, row.point.range[0]), focus: position(leaf, row.point.range[1]) });
    const before = state(editor);
    const beforeCell = structuredClone(node(editor, cell));
    const intent = kwdjCommand({ kind: 'set_table_cell_align', align: row.align });
    assert.equal(intent.id, 'org.klenwriter.kwdj/command/set-table-cell-align');
    assert.equal(accepted(editor.query({ kind: 'query_command', stamp: editor.capture(), command: intent })).available, true);
    assert.equal(accepted(osr183Wire(editor, intent)).effect, 'changed');
    assert.equal(canonical(editor), row.expected);
    assert.deepEqual(state(editor).selection, before.selection);
    assert.equal(state(editor).history.undo_entries, '1');
    const afterCell = node(editor, cell);
    assert.deepEqual(afterCell.children, beforeCell.children);
    assert.deepEqual(structuredClone(afterCell.attributes), { ...beforeCell.attributes, align: { kind: 'string', value: row.align } });
    const after = state(editor);
    assert.equal(accepted(osr183Wire(editor, intent)).effect, 'unchanged');
    assert.deepEqual(state(editor), after);
    osr183History(editor, 'undo', fixture.source);
    assert.deepEqual(state(editor).selection, before.selection);
    assert.deepEqual(structuredClone(node(editor, cell).attributes), beforeCell.attributes);
  });

  await withLiteraryCommandSession(fixture.source, editor => {
    const id = 'org.klenwriter.kwdj/command/set-table-cell-align';
    for (const target of fixture.refusals) {
      let selection;
      if (target.kind === 'child') {
        const point = { kind: 'child', parent: resolve(editor, target.parent), index: target.index, affinity: 'after' };
        selection = { anchor: point, focus: point };
      } else if (target.kind === 'text') {
        const point = value => position(resolve(editor, value.path), value.offset);
        selection = { anchor: point(target.anchor), focus: point(target.focus) };
      } else {
        selection = {
          anchor: { kind: 'edge', node: resolve(editor, target.chosenCells[0]), side: 'before' },
          focus: { kind: 'edge', node: resolve(editor, target.chosenCells[1]), side: 'after' },
        };
      }
      set(editor, selection);
      const payload = { kind: 'set_table_cell_align', align: 'left' };
      const before = state(editor);
      assert.equal(accepted(editor.query({ kind: 'query_command', stamp: editor.capture(), command: createCommand(id, payload) })).available, false);
      assert.deepEqual(state(editor), before);
      osr183Denied(editor, id, payload, fixture.source, 'kwdj.command_unsupported_context');
    }
    osr183Denied(editor, id, { kind: 'set_table_cell_align', align: 'justify' }, fixture.source, 'sdk.invalid_dto');
  });
});

const osr144Fixture = () => JSON.parse(readFileSync(new URL('./fixtures/osr-144-verse-indent.json', import.meta.url)));
const osr144Corpus = () => JSON.parse(readFileSync(new URL('../contracts/kwdj/v1/fixtures/positive.json', import.meta.url))).fixtures;
const osr144Case = (corpus, id, name) => corpus.find(doc => doc.id === id).cases.find(item => item.name === name);
const osr144Document = (profile, content) => canonicalizeRaw(JSON.stringify({
  schema: 'klenwriter.document', schema_version: 1, profile, content,
}));
const osr144Poem = lines => osr144Document('poetry', [{ type: 'verse', content: lines }]);
const osr144Remount = (editor, input_json, admission) => completed(editor.submit({
  kind: 'remount', stamp: editor.capture(), input_json, admission,
}));
function osr144Refused(response, expected) {
  const diagnostic = refused(response);
  assert.equal(diagnostic.code, expected.code, JSON.stringify(response));
  assert.equal(diagnostic.path, expected.path, JSON.stringify(response));
  assert.equal(diagnostic.may_have_committed, false);
}

test('OSR-144 packaged SDK2 admits and reopens the unchanged poetry corpus', async () => {
  const fixture = osr144Fixture();
  const corpus = osr144Corpus();
  for (const [id, name] of fixture.corpus) {
    const row = osr144Case(corpus, id, name);
    const expected = canonicalizeRaw(JSON.stringify(row.kwdj));
    const facts = row.input.identity_state ?? {};
    const media = (facts.existing_media_ids ?? []).map(id => ({ id, status: 'exists' }));
    let saved;
    await withLiteraryCommandSession(expected, editor => {
      saved = canonical(editor);
      assert.equal(saved, expected);
    }, media);
    await withLiteraryCommandSession(saved, editor => {
      assert.equal(canonical(editor), expected);
    }, media);
  }
});

test('OSR-144 packaged SDK2 preserves all eight indent values and authored leading spaces', async () => {
  const fixture = osr144Fixture();
  const expected = osr144Poem(fixture.indented_lines);
  await withLiteraryCommandSession(expected, editor => {
    const verse = node(editor, root(editor).children[0]);
    assert.equal(verse.children.length, 8);
    for (const [index, line] of verse.children.entries()) {
      assert.deepEqual(structuredClone(node(editor, line).attributes.indent),
        { kind: 'number', value: String(index + 1) });
    }
    assert.equal(node(editor, node(editor, verse.children[0]).children[0]).text, '  Leading and indented');
    accepted(osr144Remount(editor, expected, 'normalize'));
    assert.equal(canonical(editor), expected);
  });
});

test('OSR-144 packaged SDK2 removes zero only on import and rejects non-integer and out-of-range indent', async () => {
  const fixture = osr144Fixture();
  const expected = osr144Poem([fixture.plain_line]);
  const raw = osr144Poem([{ ...fixture.plain_line, attrs: { indent: 'OSR144-indent' } }]);
  const insert = token => raw.replace('"OSR144-indent"', token);
  let saved;
  await withLiteraryCommandSession(expected, editor => {
    const before = state(editor);
    osr144Refused(osr144Remount(editor, insert('0'), 'validate'), fixture.refusals.zero_validate);
    assert.deepEqual(state(editor), before);
    assert.equal(canonical(editor), expected);
    for (const mode of ['validate', 'normalize']) {
      for (const attrs of fixture.invalid_attrs) {
        const invalid = osr144Poem([{ ...fixture.plain_line, attrs }]);
        osr144Refused(osr144Remount(editor, invalid, mode), fixture.refusals.invalid_attrs);
        assert.deepEqual(state(editor), before);
        assert.equal(canonical(editor), expected);
      }
      for (const token of fixture.invalid_indent_tokens) {
        osr144Refused(osr144Remount(editor, insert(token), mode), fixture.refusals.invalid_indent);
        assert.deepEqual(state(editor), before);
        assert.equal(canonical(editor), expected);
      }
    }
    accepted(osr144Remount(editor, insert('0'), 'normalize'));
    saved = canonical(editor);
    assert.equal(saved, expected);
  });
  await withLiteraryCommandSession(saved, editor => {
    assert.equal(canonical(editor), expected);
  });
});

test('OSR-144 packaged SDK2 refuses poetry-only admission and paste atomically in prose', async () => {
  const fixture = osr144Fixture();
  const doc = osr144Case(osr144Corpus(), 'DOC-019', 'poetry_stanzas').kwdj;
  const verse = doc.content[0];
  const initial = osr183Doc([{ type: 'paragraph', content: [{ type: 'text', text: 'Prose' }] }]);
  const packet = JSON.parse(readFileSync(new URL('../artifacts/extensions/packet.json', import.meta.url)));
  const sourceProfile = { ...packet.kwdjProfile };
  delete sourceProfile.extensions;
  await withLiteraryCommandSession(initial, editor => {
    osr185Select(editor, osr185Gap(state(editor).root, 1));
    const before = state(editor);
    for (const block of [verse, verse.content[0], verse.content[2]]) {
      osr144Refused(osr144Remount(editor, osr144Document('prose', [block]), 'validate'), fixture.refusals.prose_grammar);
      assert.deepEqual(state(editor), before);
      assert.equal(canonical(editor), initial);
      for (const [mode, oracle] of [['poetry', 'clipboard_poetry_mode'], ['prose', 'prose_grammar']]) {
        const fragment = {
          format_id: 'org.klenwriter.kwdj/clipboard-fragment/1',
          source_profile: sourceProfile, mode, kind: 'blocks', open_start: false, open_end: false,
          content: [block],
        };
        const command = createCommand('org.klenwriter.kwdj/command/insert-fragment', {
          kind: 'insert_fragment', fragment_json: JSON.stringify(fragment),
        });
        osr144Refused(osr183Wire(editor, command), fixture.refusals[oracle]);
        assert.deepEqual(state(editor), before);
        assert.equal(canonical(editor), initial);
      }
    }
  });
});

const osr186InsertFragment = 'org.klenwriter.kwdj/command/insert-fragment';
const osr186Payload = fragment => ({ kind: 'insert_fragment', fragment_json: JSON.stringify(fragment) });
test('OSR-210 packaged SDK2 pastes cell text and the actual selected table rectangle', async t => {
  const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  const fixture = read('./fixtures/osr-210-table-clipboard.json');
  const retained = read('../contracts/kwdj/v1/fixtures/positive.json').fixtures.flatMap(f => f.cases);
  const at = (document, path) => path.reduce((value, index) => value.content[index], document);
  const document = location => {
    const setup = fixture.documents[location.document];
    const value = structuredClone(retained.find(row => row.name === setup.retained).kwdj);
    if (setup.leaf) at(value, setup.leaf).text = setup.text;
    if (setup.additional_header) {
      const cells = value.content[0].content[0].content;
      delete cells[0].attrs.colspan;
      cells.push({type:'table_header', content:[{type:'paragraph', content:[{type:'text', text:setup.additional_header}]}]});
    }
    assert.equal(value.profile, fixture.profile);
    return value;
  };
  const choose = (editor, location) => {
    const point = endpoint => {
      const id = endpoint.path.reduce((parent, index) => node(editor, parent).children[index], state(editor).root);
      if ('side' in endpoint) return {kind:'edge', node:id, side:endpoint.side};
      return 'index' in endpoint ? osr185Gap(id, endpoint.index) : position(id, endpoint.offset);
    };
    osr185Select(editor, point(location.anchor), point(location.focus));
  };
  const sourceProfile = {
    profile_id:'org.klenwriter.kwdj', profile_version:'1.0.0', codec_id:'org.klenwriter.kwdj/json', wire_version:1,
  };
  for (const row of fixture.cases) await t.test(row.id, async () => {
    const source = document(row.source);
    const input = osr185Bytes(source);
    if (row.source_refusal) {
      await withLiteraryCommandSession(input, editor => {
        choose(editor, row.source);
        const before = state(editor);
        const stamp = editor.capture();
        const plain = refused(editor.read({kind:'selection_text',stamp,max_bytes:8192}));
        const rich = refused(editor.read({kind:'selection_fragment',stamp,max_bytes:8192}));
        assert.equal(plain.code, row.source_refusal.plain);
        assert.equal(rich.code, row.source_refusal.fragment);
        assert.equal(rich.path, row.source_refusal.path);
        assert.deepEqual(state(editor), before);
        assert.equal(canonical(editor), input);
      });
      return;
    }
    const target = document(row.target);
    const content = row.rows
      ? [{type:'table', content:row.rows.map(item => ({
        type:'table_row', content:item.cells.map(index => source.content[0].content[item.row].content[index]),
      }))}]
      : [{type:'text', text:row.plain}];
    const kind = row.rows ? 'blocks' : 'inline';
    const original = osr185Bytes(target);
    let saved;
    const paste = (editor, fragment_json) => {
      choose(editor, row.target);
      const before = state(editor);
      const table = root(editor).children[0];
      const ids = tableIdTree(editor, table);
      const context = editor.read({kind:'clipboard_context',stamp:editor.capture()});
      const result = osr183Wire(editor, createCommand(osr186InsertFragment, {kind:'insert_fragment',fragment_json}));
      if (row.diagnostic) {
        for (const failed of [context, result]) {
          const diagnostic = refused(failed);
          assert.equal(diagnostic.code, row.diagnostic);
          assert.equal(diagnostic.path, '/clipboard');
          assert.equal(diagnostic.may_have_committed, false);
        }
        assert.deepEqual(context, result);
        assert.deepEqual(state(editor), before);
        assert.deepEqual(tableIdTree(editor, table), ids);
        assert.equal(canonical(editor), original);
        return;
      }
      assert.equal(JSON.parse(accepted(context).context_json).insertion_context, row.rows ? 'root' : 'prose_block');
      assert.equal(accepted(result).effect, 'changed');
      const expected = structuredClone(target);
      if (row.rows) expected.content.push(content[0]);
      else at(expected, row.target.anchor.path).text = row.expected_text;
      saved = canonical(editor);
      assert.equal(saved, osr185Bytes(expected));
      assert.deepEqual(tableIdTree(editor, table), ids);
      assert.equal(state(editor).stamp.revision, '1');
      assert.equal(state(editor).history.undo_entries, '1');
      osr183History(editor, 'undo', original);
      assert.deepEqual(state(editor).selection, before.selection);
      assert.deepEqual(tableIdTree(editor, table), ids);
      assert.equal(state(editor).history.undo_entries, '0');
      assert.equal(state(editor).history.redo_entries, '1');
    };
    let copied;
    await withLiteraryCommandSession(input, editor => {
      choose(editor, row.source);
      const before = state(editor);
      const stamp = editor.capture();
      const plain = accepted(editor.read({kind:'selection_text',stamp,max_bytes:8192}));
      assert.equal(plain.text, row.plain);
      assert.equal(plain.empty, false);
      const rich = accepted(editor.read({kind:'selection_fragment',stamp,max_bytes:8192}));
      assert.equal(rich.empty, false);
      assert.deepEqual(JSON.parse(rich.fragment_json), {
        format_id:'org.klenwriter.kwdj/clipboard-fragment/1', source_profile:sourceProfile,
        mode:fixture.profile, kind, content, open_start:false, open_end:false,
      });
      const limited = refused(editor.read({kind:'selection_text',stamp,max_bytes:1}));
      assert.equal(limited.code, 'selection_text.output_limit');
      assert.deepEqual(state(editor), before);
      assert.equal(canonical(editor), input);
      copied = rich.fragment_json;
      if (!row.rows) paste(editor, copied);
    });
    if (row.rows) await withLiteraryCommandSession(original, editor => paste(editor, copied));
    if (saved) await withLiteraryCommandSession(saved, editor => assert.equal(canonical(editor), saved));
  });
});

test('OSR-197 packaged SDK2 preserves poetry clipboard structure and exact Undo', async t => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/osr-197-poetry-clipboard.json', import.meta.url), 'utf8'));
  const { decodeClipboard } = await import('../packages/kwdj/dist/clipboard-decode.js');
  const binding = { profile_id: 'org.klenwriter.kwdj', profile_version: '1.0.0', codec_id: 'org.klenwriter.kwdj/json', wire_version: 1 };
  const point = (editor, location) => {
    const id = location.path.reduce((parent, index) => node(editor, parent).children[index], state(editor).root);
    return 'offset' in location ? position(id, location.offset) : osr185Gap(id, location.index);
  };
  for (const row of fixture.cases) {
    await t.test(row.id, async () => {
      const original = fixture.documents[row.target.document];
      const source = row.capture ? fixture.documents[row.capture.document] : original;
      const expected = { format_id: 'org.klenwriter.kwdj/clipboard-fragment/1', source_profile: binding, mode: source.profile, ...row.fragment };
      let payload;
      if (row.capture) {
        await withLiteraryCommandSession(osr185Bytes(source), editor => {
          osr185Select(editor, point(editor, row.capture.anchor), point(editor, row.capture.focus));
          const before = state(editor);
          const fragment = accepted(editor.read({ kind: 'selection_fragment', stamp: editor.capture(), max_bytes: 8192 }));
          assert.equal(fragment.empty, false);
          payload = JSON.parse(fragment.fragment_json);
          assert.deepEqual(payload, expected);
          assert.deepEqual(state(editor), before);
        });
      }

      const bytes = osr185Bytes(original);
      await withLiteraryCommandSession(bytes, async editor => {
        osr185Select(editor, point(editor, row.target.point));
        const before = state(editor);
        const read = accepted(editor.read({ kind: 'clipboard_context', stamp: editor.capture() }));
        const context = JSON.parse(read.context_json);
        assert.equal(context.insertion_context, row.target.context);
        assert.equal(context.mode, original.profile);
        assert.deepEqual(state(editor), before);
        if (row.plain !== undefined) {
          const decoded = await decodeClipboard({
            source_profile: binding, mode: context.mode, insertion_context: context.insertion_context,
            media: 'not_observed', plain: { status: 'complete_local', text: row.plain },
            html: { status: 'unavailable', text: null },
            url_policy: { allow_origin_relative: true, allowed_schemes: ['http', 'https'] },
          });
          assert.equal(decoded.status, 'candidate');
          assert.deepEqual(decoded.diagnostics, []);
          payload = decoded.fragment;
          assert.deepEqual(payload, expected);
        }
        if (row.refusal) {
          osr183Denied(editor, osr186InsertFragment, osr186Payload(payload), bytes, row.refusal.code, row.refusal.path);
        } else {
          osr186PasteAndUndo(editor, payload, row.expected, bytes);
        }
      });
    });
  }
});

test('OSR-199 packaged SDK2 poetry selection text matches native delimiters, atoms and limits', async t => {
  const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  const fixture = read('./fixtures/osr-199-poetry-selection.json');
  const corpus = read('../contracts/kwdj/v1/fixtures/positive.json');
  const documents = {
    ...fixture.documents,
    'DOC-019': corpus.fixtures.find(entry => entry.id === 'DOC-019').cases[0].kwdj,
    'OSR-197': read('./fixtures/osr-197-poetry-clipboard.json').documents.source,
  };
  for (const row of fixture.cases) {
    await t.test(row.id, async () => {
      const document = documents[row.document];
      const input = typeof document === 'string' ? document : osr185Bytes(document);
      await withLiteraryCommandSession(input, editor => {
        const nodeAt = path => path.reduce((id, index) => node(editor, id).children[index], state(editor).root);
        const point = ({ path, offset, index }) => offset === undefined
          ? osr185Gap(nodeAt(path), index) : position(nodeAt(path), offset);
        const selection = { anchor: point(row.anchor), focus: point(row.focus) };
        const initial = state(editor);
        const set = completed(editor.submit({ kind: 'set_selection', stamp: editor.capture(), selection }));
        if (row.set_diagnostic) {
          assert.equal(refused(set).code, row.set_diagnostic);
          assert.deepEqual(state(editor), initial);
          assert.equal(canonical(editor), input);
          return;
        }
        accepted(set);
        const before = state(editor);
        assert.deepEqual(structuredClone(before.selection), selection);
        const projection = editor.read({ kind: 'selection_text', stamp: editor.capture(), max_bytes: row.max_bytes });
        if (row.diagnostic) {
          const diagnostic = refused(projection);
          assert.equal(diagnostic.code, row.diagnostic);
          assert.equal(diagnostic.path, '');
          assert.equal(diagnostic.may_have_committed, false);
        } else {
          assert.deepEqual(structuredClone(accepted(projection)), {
            kind: 'selection_text', stamp: structuredClone(before.stamp), selection,
            projection_id: 'org.klenwriter.kwdj/selection-text/1',
            text: row.text, empty: false, selected_atoms: row.atoms.map(nodeAt),
          });
        }
        assert.deepEqual(state(editor), before);
        assert.equal(canonical(editor), input);
        if (row.delete_guard) {
          for (const intent of [{ kind: 'delete_selection' }, { kind: 'delete_selection', scope: 'profile_body' }]) {
            osr183Denied(editor, 'org.klenwriter.kwdj/command/delete-selection', intent,
              input, 'kwdj.command_unsupported_context', '/command');
          }
        }
      });
    });
  }
});

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

const osr279Fixture = () => JSON.parse(readFileSync(new URL('./fixtures/osr-279-spoiler-disclosure.json', import.meta.url)));
const osr279Wrap = 'org.klenwriter.kwdj/command/wrap-labeled-container';
const osr279Unwrap = 'org.klenwriter.kwdj/command/unwrap-labeled-container';

test('OSR-279 packaged SDK2 creates both labeled kinds with their titles and supports exact Undo', async () => {
  const { before, selected, after, containers } = osr279Fixture();
  const input = osr183Doc([before, ...selected, after]);
  for (const { created } of containers) {
    await withLiteraryCommandSession(input, editor => {
      const parent = state(editor).root;
      const original = root(editor).children;
      osr185Select(editor, osr185Gap(parent, 1));
      const intent = { kind: 'insert_block', target: { kind: created.type } };
      const dto = createCommand(osr183Insert, intent);
      assert.equal(accepted(osr183Wire(editor, dto)).effect, 'changed');
      assert.deepEqual(kwdjCommand(intent), dto);
      assert.equal(canonical(editor), osr183Doc([before, created, ...selected, after]));
      assert.equal(state(editor).history.undo_entries, '1');
      const wrapper = node(editor, root(editor).children[1]);
      const caret = osr185Gap(wrapper.children[0], 0);
      assert.deepEqual(structuredClone(state(editor).selection), { anchor: caret, focus: caret });
      osr183History(editor, 'undo', input);
      assert.deepEqual(root(editor).children, original);
    });
  }
});

test('OSR-279 packaged SDK2 wraps and unwraps both explicit labels with exact Undo', async () => {
  const { before, selected, after, containers } = osr279Fixture();
  const input = osr183Doc([before, ...selected, after]);
  for (const { created, wrap_label: label, recursion } of containers) {
    const wrapped = osr183Doc([before, { type: created.type, attrs: { label }, content: selected }, after]);
    await withLiteraryCommandSession(input, editor => {
      const parent = state(editor).root;
      const original = root(editor).children;
      const children = original.slice(1, 3);
      osr185Select(editor, osr185Gap(parent, 3), osr185Gap(parent, 1));
      const wrap = { kind: 'wrap_labeled_container', container_kind: created.type, label };
      const dto = createCommand(osr279Wrap, wrap);
      assert.equal(accepted(osr183Wire(editor, dto)).effect, 'changed');
      assert.deepEqual(kwdjCommand(wrap), dto);
      assert.equal(canonical(editor), wrapped);
      assert.equal(state(editor).history.undo_entries, '1');
      const wrapper = root(editor).children[1];
      assert.deepEqual(node(editor, wrapper).children, children);
      osr183History(editor, 'undo', input);
      assert.deepEqual(root(editor).children, original);
      osr183History(editor, 'redo', wrapped);

      const unwrap = node => ({ kind: 'unwrap_labeled_container', node });
      for (const target of [original[0], original[3]]) {
        osr183Denied(editor, osr279Unwrap, unwrap(target), wrapped, 'kwdj.command_invalid_target');
      }
      osr185Select(editor, osr185Gap(wrapper, 0), osr185Gap(wrapper, 2));
      osr183Denied(editor, osr279Wrap, wrap, wrapped, recursion, '/content/1/content/0');

      const command = createCommand(osr279Unwrap, unwrap(wrapper));
      assert.equal(accepted(osr183Wire(editor, command)).effect, 'changed');
      assert.deepEqual(kwdjCommand(unwrap(wrapper)), command);
      assert.equal(canonical(editor), input);
      assert.equal(state(editor).history.undo_entries, '2');
      assert.deepEqual(root(editor).children, original);
      osr183History(editor, 'undo', wrapped);
      assert.deepEqual(node(editor, wrapper).children, children);
    });
  }
});

test('packaged SDK2 deletes selected text wholly inside literary, warning and labeled bodies', async () => {
  const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  const cases = [
    ['literary_block', { kind: 'author_note' }],
    ['warning', { kind: 'general' }],
    ['warning', { kind: 'content', label: 'Темы' }],
    ['spoiler', { label: 'Финал' }],
    ['disclosure', { label: 'Подробнее' }],
  ];
  const intent = { kind: 'delete_selection', scope: 'profile_body' };
  const command = kwdjCommand(intent);
  for (const [type, attrs] of cases) {
    const blocks = text => [paragraph('Outside'), {
      type, attrs, content: [paragraph(text), paragraph('Second')],
    }];
    const initial = osr183Doc(blocks('A😀BC'));
    const expected = osr183Doc(blocks('ABC'));
    await withLiteraryCommandSession(initial, editor => {
      const [outside, wrapper] = root(editor).children;
      const [first, second] = node(editor, wrapper).children;
      const [outsideLeaf, firstLeaf, secondLeaf] = [outside, first, second].map(id => node(editor, id).children[0]);

      for (const anchor of [position(outsideLeaf, 7), position(secondLeaf, 1)]) {
        osr185Select(editor, anchor, position(firstLeaf, 1));
        osr183Denied(editor, command.id, intent, initial, 'kwdj.command_unsupported_context', '/command');
      }

      osr185Select(editor, position(firstLeaf, 3), position(firstLeaf, 1));
      osr183Denied(editor, command.id, { kind: 'delete_selection' }, initial, 'kwdj.command_unsupported_context', '/command');
      const result = osr183Wire(editor, command);
      assert.equal(accepted(result).effect, 'changed', JSON.stringify({ type, attrs }));
      assert.equal(canonical(editor), expected);
      assert.deepEqual(root(editor).children, [outside, wrapper]);
      assert.deepEqual(node(editor, wrapper).children, [first, second]);
      assert.equal(state(editor).history.undo_entries, '1');
      osr183History(editor, 'undo', initial);
      assert.deepEqual(node(editor, wrapper).children, [first, second]);
    });
  }
});

test('OSR-279 packaged SDK2 refuses both labeled boundary edits and keeps a labeled empty shell', async () => {
  const { before, after, containers } = osr279Fixture();
  const { refusals } = osr189Fixture();
  for (const { copied, empty_shell: emptyShell } of containers) {
    const input = osr183Doc([before, copied, after]);
    const empty = osr183Doc([before, emptyShell, after]);
    await withLiteraryCommandSession(input, editor => {
      const roots = root(editor).children;
      const outside = node(editor, roots[0]).children[0];
      const wrapper = node(editor, roots[1]);
      const [child] = wrapper.children;
      const [first] = node(editor, child).children;
      const backspace = refusals.first_child_backspace;
      osr185Select(editor, position(first, 0));
      osr183Denied(editor, 'org.klenwriter.kwdj/command/delete-backward', { kind: 'delete_backward' }, input, backspace.code, backspace.path);
      const crossing = refusals.cross_boundary_delete;
      osr185Select(editor, position(outside, 2), position(first, 1));
      osr183Denied(editor, 'org.klenwriter.kwdj/command/delete-selection', { kind: 'delete_selection' }, input, crossing.code, crossing.path);

      const remove = kwdjCommand({ kind: 'remove', node: child });
      assert.equal(accepted(osr183Wire(editor, remove)).effect, 'changed');
      assert.equal(canonical(editor), empty);
      assert.equal(state(editor).history.undo_entries, '1');
      assert.deepEqual(root(editor).children, roots);
      const shell = node(editor, wrapper.id);
      assert.deepEqual(shell.attributes, wrapper.attributes);
      assert.equal(shell.children.length, 1);
      assert.notEqual(shell.children[0], child);
      assert.deepEqual(node(editor, shell.children[0]).children, []);
      osr183History(editor, 'undo', input);
      assert.deepEqual(node(editor, wrapper.id).children, wrapper.children);
    });
  }
});

test('OSR-279 packaged SDK2 copies both labels and permits other-family paste but refuses self-recursion', async () => {
  const { containers } = osr279Fixture();
  const original = osr183Doc(containers.map(item => item.copied));
  await withLiteraryCommandSession(original, editor => {
    const parent = state(editor).root;
    const ids = root(editor).children;
    for (const [index, { copied, recursion }] of containers.entries()) {
      osr185Select(editor, osr185Gap(parent, index), osr185Gap(parent, index + 1));
      const captured = osr186Capture(editor, 'blocks', [copied]);
      osr185Select(editor, osr185Gap(parent, 2));
      const atRoot = JSON.parse(original);
      atRoot.content.push(copied);
      osr186PasteAndUndo(editor, captured, atRoot, original);

      const other = 1 - index;
      osr185Select(editor, osr185Gap(ids[other], 1));
      const nested = JSON.parse(original);
      nested.content[other].content.push(copied);
      osr186PasteAndUndo(editor, captured, nested, original);

      osr185Select(editor, osr185Gap(ids[index], 1));
      osr183Denied(editor, osr186InsertFragment, osr186Payload(captured), original, recursion, `/content/${index}/content/1`);
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

const osr153Paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const osr153Source = osr183Doc([osr153Paragraph('Before'), osr153Paragraph('After')]);
const osr153Link = { kind: 'set_link', href: '/works/example', title: null };

function osr153Hold(editor) {
  const captured = editor.captureHostRequest();
  assert.equal(captured.status, 'captured');
  const host = Promise.withResolvers();
  const completion = host.promise.then(intent => osr153Reply(editor, captured.request, intent));
  return { request: captured.request, resolve: host.resolve, completion };
}
function osr153Reply(editor, request, intent) {
  return settled(editor.completeHostRequest(request, {
    kind: 'command', stamp: request.stamp,
    command: kwdjCommand(intent), history_hint: { kind: 'isolated' },
  }));
}
function osr153SelectInitial(editor) {
  const leaf = textLeaf(editor).id;
  osr185Select(editor, position(leaf, 0), position(leaf, 6));
}
function osr153Stale(reply) {
  const diagnostic = refused(reply);
  assert.equal(diagnostic.code, 'sdk.stale_request');
  assert.equal(diagnostic.may_have_committed, false);
}

test('OSR-153 sealed SDK2 refuses late targeted replies after selection, revision, removal and remount', async () => {
  for (const transition of ['selection', 'revision', 'removed target', 'generation']) {
    await withLiteraryCommandSession(osr153Source, async editor => {
      osr153SelectInitial(editor);
      const target = root(editor).children[0];
      const oldSelection = state(editor).selection;
      const held = osr153Hold(editor);
      assert.equal(editor.resources().host_requests, 1);
      let expected = osr153Source;
      if (transition === 'selection') {
        const newTarget = textLeaf(editor, 1).id;
        const next = position(newTarget, 2);
        osr185Select(editor, next);
        assert.deepEqual(structuredClone(state(editor).selection), { anchor: next, focus: next });
        assert.notDeepEqual(state(editor).selection, oldSelection);
        assert.equal(editor.capture().revision, held.request.stamp.revision);
        assert.notEqual(editor.capture().selection_epoch, held.request.stamp.selection_epoch);
      } else if (transition === 'revision') {
        assert.equal(accepted(completed(command(editor, { kind: 'insert_text', text: 'Interim' }))).effect, 'changed');
        expected = osr183Doc([osr153Paragraph('Interim'), osr153Paragraph('After')]);
        assert.notEqual(editor.capture().revision, held.request.stamp.revision);
      } else if (transition === 'removed target') {
        assert.equal(accepted(completed(command(editor, { kind: 'remove', node: target }))).effect, 'changed');
        expected = osr183Doc([osr153Paragraph('After')]);
        assert.equal(root(editor).children.includes(target), false);
        assert.notEqual(editor.capture().revision, held.request.stamp.revision);
      } else {
        expected = osr183Doc([osr153Paragraph('Fresh generation')]);
        const reply = completed(editor.submit({
          kind: 'remount', stamp: editor.capture(), input_json: expected, admission: 'validate',
        }));
        assert.equal(accepted(reply).effect, 'remounted');
        assert.notEqual(editor.capture().generation, held.request.stamp.generation);
        assert.equal(editor.capture().revision, held.request.stamp.revision);
      }
      const before = state(editor);
      assert.equal(canonical(editor), expected, transition);
      held.resolve(osr153Link);
      osr153Stale(await held.completion);
      assert.deepEqual(state(editor), before, transition);
      assert.equal(canonical(editor), expected, transition);
      assert.equal(editor.resources().host_requests, 0, transition);
    });
  }
});

test('OSR-153 sealed SDK2 release, foreign session and destroy retire late reply authority', async () => {
  await withLiteraryCommandSession(osr153Source, async editor => {
    osr153SelectInitial(editor);
    const before = state(editor);
    const cancelled = osr153Hold(editor);
    assert.equal(editor.releaseHostRequest(cancelled.request), true);
    assert.equal(editor.releaseHostRequest(cancelled.request), false);
    cancelled.resolve(osr153Link);
    osr153Stale(await cancelled.completion);
    assert.deepEqual(state(editor), before);
    assert.equal(canonical(editor), osr153Source);

    const live = osr153Hold(editor);
    const freshInput = osr183Doc([osr153Paragraph('Independent session')]);
    await withLiteraryCommandSession(freshInput, async fresh => {
      const spare = fresh.captureHostRequest();
      assert.equal(spare.status, 'captured');
      assert.equal(fresh.releaseHostRequest(spare.request), true);
      const newCapture = fresh.captureHostRequest();
      assert.equal(newCapture.status, 'captured');
      assert.equal(newCapture.request.id, live.request.id, 'equal counters are not shared authority');
      const freshBefore = state(fresh);
      assert.notEqual(fresh.capture().session, live.request.stamp.session);
      osr153Stale(await osr153Reply(fresh, live.request, osr153Link));
      assert.deepEqual(state(fresh), freshBefore);
      assert.equal(canonical(fresh), freshInput);
      assert.equal(fresh.releaseHostRequest(newCapture.request), true);
    });
    assert.deepEqual(state(editor), before);
    assert.equal(canonical(editor), osr153Source);
    accepted(await settled(editor.destroy()));
    assert.equal(editor.resources().host_requests, 0);
    live.resolve(osr153Link);
    osr153Stale(await live.completion);
    assert.equal(editor.resources().host_requests, 0);
    assert.equal(editor.releaseHostRequest(live.request), false);
  });
});

test('OSR-153 sealed SDK2 completes one exact link edit, refuses replay and undoes it once', async () => {
  await withLiteraryCommandSession(osr153Source, async editor => {
    osr153SelectInitial(editor);
    const before = state(editor);
    const originalRoots = root(editor).children;
    const held = osr153Hold(editor);
    held.resolve(osr153Link);
    assert.equal(accepted(await held.completion).effect, 'changed');
    const changed = state(editor);
    const expected = osr183Doc([
      { type: 'paragraph', content: [
        { type: 'text', text: 'Before', marks: [{ type: 'link', attrs: { href: '/works/example' } }] },
      ] },
      osr153Paragraph('After'),
    ]);
    assert.equal(canonical(editor), expected);
    assert.equal(changed.stamp.revision, '1');
    assert.equal(changed.history.undo_entries, '1');
    assert.deepEqual(root(editor).children, originalRoots);
    osr153Stale(await osr153Reply(editor, held.request, osr153Link));
    assert.equal(editor.releaseHostRequest(held.request), false);
    assert.equal(editor.resources().host_requests, 0);
    assert.deepEqual(state(editor), changed);
    assert.equal(canonical(editor), expected);
    osr183History(editor, 'undo', osr153Source);
    assert.deepEqual(root(editor).children, originalRoots);
    assert.deepEqual(state(editor).selection, before.selection);
    assert.equal(state(editor).history.undo_entries, '0');
    assert.equal(state(editor).history.redo_entries, '1');
  });
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

test('OSR-156 packaged SDK2 preserves DOC-006 reference markup and locks the article', async () => {
  const fixture = referencePreservationFixture();
  const references = [{id:fixture.id,status:'exists'}];
  const readReference = (editor, index) => {
    const row = textLeaf(editor, index);
    assert.equal(row.text, fixture.label);
    assert.deepEqual(structuredClone(row.marks), [{
      type_id:'org.klenwriter.kwdj/reference_link',
      attributes:{reference_entity_id:{kind:'string',value:fixture.id}},
    }]);
    return row.id;
  };
  const mutate = (editor, payload) => accepted(osr183Wire(editor, kwdjCommand(payload)));
  await withLiteraryCommandSession(fixture.initial, editor => {
    const reference = root(editor).children[1], referenceText = readReference(editor, 1);
    for (const [index, text, offset] of [[0,fixture.left_append,fixture.before.length],[2,fixture.right_append,fixture.after.length]]) {
      osr185Select(editor, position(textLeaf(editor, index).id, offset));
      assert.equal(mutate(editor, {kind:'insert_text',text}).effect, 'changed');
    }
    assert.equal(canonical(editor), fixture.edited);
    assert.equal(readReference(editor, 1), referenceText);
    assert.equal(mutate(editor, {kind:'move',node:reference,parent:state(editor).root,before_index:fixture.move_before_index}).effect, 'changed');
    assert.equal(canonical(editor), fixture.moved);
    assert.equal(root(editor).children[2], reference);
    assert.equal(readReference(editor, 2), referenceText);
    assert.equal(mutate(editor, {kind:'remove',node:reference}).effect, 'changed');
    assert.equal(canonical(editor), fixture.removed);
  }, [], 'editable', references);
  for (const [bytes,index] of [[fixture.edited,1],[fixture.moved,2]]) {
    await withLiteraryCommandSession(bytes, editor => readReference(editor, index), [], 'editable', references);
  }
  await withLiteraryCommandSession(fixture.initial, editor => {
    osr185Select(editor, position(readReference(editor, 1), fixture.locked_offset));
    const before = state(editor), reference = root(editor).children[1], referenceText = readReference(editor, 1);
    for (const payload of [{kind:'insert_text',text:'X'},{kind:'delete_backward'}]) {
      osr183Denied(editor, kwdjCommand(payload).id, payload, fixture.initial, 'session.read_only', '');
    }
    const fragment = {
      format_id:'org.klenwriter.kwdj/clipboard-fragment/1', mode:'prose',kind:'inline',
      source_profile:{profile_id:'org.klenwriter.kwdj',profile_version:'1.0.0',codec_id:'org.klenwriter.kwdj/json',wire_version:1},
      content:[{type:'text',text:fixture.paste_text}],open_start:false,open_end:false,
    };
    osr183Denied(editor, osr186InsertFragment, osr186Payload(fragment), fixture.initial, 'session.read_only', '');
    assert.equal(root(editor).children[1], reference);
    assert.equal(readReference(editor, 1), referenceText);
    assert.deepEqual(state(editor), before);
  }, [], 'read_only', references);
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

test('OSR-280 packaged SDK2 trims edited stanza edges and the codec refuses imported edges', async t => {
  const { input } = osr195Fixture().candidates.find(row => row.id === 'adjacent_breaks_merge');
  const [first, stanza, , last] = input.content[0].content;
  const poem = lines => ({ ...input, content: [{ type: 'verse', content: lines }] });
  const original = osr185Bytes(poem([first, stanza, last]));
  for (const [caseId, index, survivingLine] of [
    ['cms_edit_trim_first', 0, last],
    ['cms_edit_trim_last', 2, first],
  ]) {
    await t.test(caseId, () => withLiteraryCommandSession(original, editor => {
      const verse = root(editor).children[0];
      const originalIds = node(editor, verse).children;
      const expected = osr185Bytes(poem([survivingLine]));
      const reply = accepted(osr183Wire(editor, kwdjCommand({ kind: 'remove', node: originalIds[index] })));
      assert.equal(reply.effect, 'changed');
      assert.equal(canonical(editor), expected);
      assert.deepEqual(node(editor, verse).children, [originalIds[2 - index]]);
      assert.equal(state(editor).history.undo_entries, '1');
      osr183History(editor, 'undo', original);
      assert.deepEqual(node(editor, verse).children, originalIds);
      osr183History(editor, 'redo', expected);
    }));
  }

  const moveSource = osr185Bytes({ ...input, content: [
    { type: 'verse', content: [first, stanza, last] },
    { type: 'verse', content: [first, last] },
  ] });
  for (const [caseId, destination, beforeIndex] of [
    ['same_leading', 0, 0],
    ['same_trailing', 0, 3],
    ['cross_leading', 1, 0],
    ['cross_trailing', 1, 2],
  ]) {
    await t.test(caseId, () => withLiteraryCommandSession(moveSource, editor => {
      const verses = root(editor).children;
      const marker = node(editor, verses[0]).children[1];
      const intent = { kind: 'move', node: marker, parent: verses[destination], before_index: beforeIndex };
      const stamp = editor.capture();
      const query = accepted(editor.query({ kind: 'query_command', stamp, command: kwdjCommand(intent) }));
      const path = `/content/${destination}/content`;
      assert.equal(query.available, false);
      assert.equal(query.diagnostic.code, 'kwdj.invalid_verse');
      assert.equal(query.diagnostic.path, path);
      assert.deepEqual(editor.capture(), stamp);
      osr183Denied(editor, 'org.klenwriter.kwdj/command/move', intent, moveSource, 'kwdj.invalid_verse', path);
      assert.equal(node(editor, verses[0]).children[1], marker);
    }));
  }

  const codec = await import('../packages/wasm/dist/editor_wasm.js');
  const { options } = await import('./support/codec-fixtures.mjs');
  await codec.default({ module_or_path: readFileSync(new URL('../packages/wasm/dist/editor_wasm_bg.wasm', import.meta.url)) });
  const importLines = ['Строка 1', 'Строка 3'].map(text => ({
    type: 'verse_line', content: [{ type: 'text', text }],
  }));
  for (const [caseId, lines] of [
    ['leading_import_edge_refuses', [stanza, ...importLines]],
    ['trailing_import_edge_refuses', [...importLines, stanza]],
  ]) {
    await t.test(caseId, () => {
      const bytes = new TextEncoder().encode(osr185Bytes(poem(lines)));
      for (const run of [codec.kwdjValidateV1, codec.kwdjNormalizeV1]) {
        const result = JSON.parse(run(bytes, options()));
        assert.equal(result.status, 'refused');
        assert.equal(result.diagnostic.code, 'kwdj.invalid_verse');
        assert.equal(result.diagnostic.path, '/content/0/content');
      }
    });
  }
});

test('OSR-283 packaged SDK2 transforms root verse and paragraphs with exact Undo', async t => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/osr-283-verse-transform.json', import.meta.url)));
  for (const row of fixture.cases) {
    await t.test(row.id, () => withLiteraryCommandSession(osr185Bytes(fixture.documents[row.input]), editor => {
      const original = canonical(editor);
      const nodeAt = path => path.reduce((id, index) => node(editor, id).children[index], state(editor).root);
      const focus = row.edge
        ? { kind: 'edge', node: nodeAt(row.path), side: row.edge }
        : osr185Gap(nodeAt(row.path), row.gap_index ?? 0);
      const anchor = row.anchor_path ? osr185Gap(nodeAt(row.anchor_path), 0) : focus;
      osr185Select(editor, anchor, focus);
      const before = state(editor);
      const id = 'org.klenwriter.kwdj/command/transform-block';
      const intent = { kind: 'transform_block', target: row.target };
      const command = kwdjCommand(intent);
      assert.deepEqual(command, createCommand(id, intent));
      const query = accepted(editor.query({ kind: 'query_command', stamp: editor.capture(), command }));
      assert.deepEqual(state(editor), before);
      assert.equal(canonical(editor), original);

      if (row.diagnostic) {
        assert.equal(query.available, false);
        assert.equal(query.diagnostic.code, row.diagnostic.code);
        assert.equal(query.diagnostic.path, row.diagnostic.path);
        osr183Denied(editor, id, intent, original, row.diagnostic.code, row.diagnostic.path);
        return;
      }
      const expected = osr185Bytes(fixture.documents[row.expected]);
      assert.equal(query.available, true);
      assert.equal(query.effect, row.effect);
      assert.equal(accepted(osr183Wire(editor, command)).effect, row.effect);
      assert.equal(canonical(editor), expected);
      if (row.effect === 'changed') {
        assert.equal(state(editor).stamp.revision, '1');
        assert.equal(state(editor).history.undo_entries, '1');
        osr183History(editor, 'undo', original);
        assert.deepEqual(state(editor).selection, before.selection);
        osr183History(editor, 'redo', expected);
      } else {
        assert.deepEqual(state(editor), before);
      }
    }));
  }
});

test('OSR-154 packaged SDK2 media commands normalize and edit one block without disturbing its caption or history', async () => {
  const packet = JSON.parse(readFileSync(new URL('../artifacts/extensions/packet.json', import.meta.url)));
  const wasm = readFileSync(new URL('../packages/wasm/dist/editor_wasm_bg.wasm', import.meta.url));
  const module = await loadSdkV2({ wasm });
  const oldId = '41111111-1111-4111-8111-111111111111';
  const picked = 'a2222222-2222-4222-8222-222222222222';
  const missing = 'f3333333-3333-4333-8333-333333333333';
  const identities = { media: [oldId, picked, missing].map(id => ({id,status:id === missing ? 'missing' : 'exists'})), references: [] };
  const options = { abi: 'editor-sdk/2', build_id: module.manifest.build_id, profile: packet.kwdjProfile,
    admission: 'validate', access: 'editable', registry_json: packet.kwdjRegistryJson,
    profile_options_json: JSON.stringify({identities,limits:null}) };
  const left = document('Before').content[0], right = document('After').content[0];
  const caption = document('Caption').content[0];
  const original = { type:'media_image', attrs:{align:'wide',alt:'Original',media_asset_id:oldId}, content:[caption] };
  const expected = content => canonicalizeRaw(JSON.stringify({...document(''),content}));
  const initial = expected([left,original,right]);
  const make = input => createEditor({ input:new TextEncoder().encode(input), options, loader:async ()=>module });
  const editor = make(initial);
  const raw = intent => createCommand('org.klenwriter.kwdj/command/media',intent);
  const submit = (kind, fields) => completed(editor.submit({ kind, stamp:editor.capture(), ...fields }));
  const execute = intent => submit('command',{command:raw(intent),history_hint:{kind:'isolated'}});
  const replace = (node, media_asset_id, accessibility, current_asset_id = oldId) => ({
    kind:'replace_media',node,current_asset_id,media_asset_id,accessibility,
  });
  try {
    accepted(await editor.ready);
    const before = editor.capture();
    const originalNode = node(editor, root(editor).children[1]);
    const point = { kind:'child',parent:state(editor).root,index:1,affinity:'after' };
    accepted(submit('set_selection',{selection:{anchor:point,focus:point}}));
    const selected = structuredClone(state(editor));
    assert.equal(refused(command(editor,{kind:'insert_block',target:{kind:'media'}}).response).code,'kwdj.command_host_required');
    const insert = {kind:'insert_media',media_asset_id:picked,accessibility:{kind:'alt',alt:'Alt\r\nline'}};
    const availability = accepted(editor.query({kind:'query_command',stamp:editor.capture(),command:raw(insert)}));
    assert.equal(availability.available,true);
    assert.deepEqual(structuredClone(state(editor)),selected);
    assert.equal(accepted(execute(insert)).effect,'changed');
    const inserted = {type:'media_image',attrs:{align:'none',alt:'Alt\nline',media_asset_id:picked}};
    assert.equal(canonical(editor),expected([left,inserted,original,right]));
    assert.equal(root(editor).children[2],originalNode.id);
    assert.equal(editor.capture().revision,String(BigInt(before.revision)+1n));
    assert.equal(state(editor).history.undo_entries,'1');
    const reopened = make(canonical(editor));
    try {
      accepted(await reopened.ready);
      assert.equal(canonical(reopened),expected([left,inserted,original,right]));
      assert.equal(node(reopened,root(reopened).children[1]).attributes.media_asset_id.value,picked);
    } finally { reopened.destroy(); }
    accepted(submit('history',{direction:'undo'}));
    assert.equal(canonical(editor),initial);
    assert.deepEqual(structuredClone(state(editor).selection),selected.selection);

    const targetState = structuredClone(state(editor));
    for (const [intent, code] of [
      [replace(originalNode.id,missing,{kind:'decorative'}),'kwdj.media_identity_unresolved'],
      [replace(originalNode.id,'b9999999-9999-4999-8999-999999999999',{kind:'decorative'}),'kwdj.identity_resolution_failed'],
      [replace(originalNode.id,picked,{kind:'decorative'},picked),'kwdj.command_invalid_target'],
      [replace(root(editor).children[0],picked,{kind:'decorative'}),'kwdj.command_invalid_target'],
      [replace(originalNode.id,picked,{kind:'alt',alt:''}),'kwdj.invalid_media_accessibility'],
      [replace(originalNode.id,picked,{kind:'decorative',alt:'forbidden'}),'sdk.invalid_dto'],
    ]) {
      assert.equal(refused(execute(intent)).code,code,JSON.stringify(intent));
      assert.equal(canonical(editor),initial);
      assert.deepEqual(structuredClone(state(editor)),targetState);
    }
    assert.equal(accepted(execute(replace(originalNode.id,picked.toUpperCase(),{kind:'decorative'}))).effect,'changed');
    const replaced = { ...original, attrs:{align:'wide',decorative:true,media_asset_id:picked} };
    assert.equal(canonical(editor),expected([left,replaced,right]));
    const replacement = node(editor,root(editor).children[1]);
    assert.equal(replacement.id,originalNode.id);
    assert.deepEqual(replacement.children,originalNode.children);
    assert.equal(accepted(execute(replace(replacement.id,picked,{kind:'decorative'},picked))).effect,'unchanged');
    assert.equal(state(editor).history.undo_entries,'1');
    accepted(submit('history',{direction:'undo'}));
    assert.equal(canonical(editor),initial);
    assert.equal(root(editor).children[1],originalNode.id);
  } finally { editor.destroy(); }

  const legacy = await open(document('abc'));
  try {
    const {editor:old} = legacy;
    assert.equal(accepted(old.read({kind:'catalog'})).commands.length,17);
    const rawReply = completed(old.submit({kind:'command',stamp:old.capture(),command:raw({
      kind:'insert_media',media_asset_id:picked,accessibility:{kind:'decorative'},
    }),history_hint:{kind:'isolated'}}));
    assert.equal(refused(rawReply).code,'sdk.invalid_dto');
  } finally { legacy.close(); }
});

test('OSR-155 packaged SDK2 checks existing canonical URL rules atomically before editing a selected link', async () => {
  const input = canonicalizeRaw(JSON.stringify(document('Docs suffix')));
  await withLiteraryCommandSession(input, async editor => {
    const leaf = textLeaf(editor).id;
    const selection = {anchor:position(leaf,4),focus:position(leaf,0)};
    accepted(completed(editor.submit({kind:'set_selection',stamp:editor.capture(),selection})));
    const before = structuredClone(state(editor)), original = canonical(editor), events = [];
    const unsubscribe = editor.subscribe(event=>events.push(event));
    try {
      for (const href of ['/a/../b','/%2e%2e/b','//example.test/b','https://user:pass@example.test/b','javascript:void(0)']) {
        const result = refused(completed(command(editor,{kind:'set_link',href,title:null})));
        assert.equal(result.code,'kwdj.unsafe_url',href);
        assert.equal(result.may_have_committed,false);
        assert.deepEqual(structuredClone(state(editor)),before);
        assert.equal(canonical(editor),original);
      }
      assert.deepEqual(events,[]);
      const href = '/guide?search=%2e%2e#toc';
      assert.equal(accepted(completed(command(editor,{kind:'set_link',href,title:'First\r\nsecond'}))).effect,'changed');
      const exported = JSON.parse(canonical(editor));
      assert.deepEqual(exported.content[0].content, [
        {type:'text',text:'Docs',marks:[{type:'link',attrs:{href,title:'First\nsecond'}}]},
        {type:'text',text:' suffix'},
      ]);
      assert.equal(events.length,1);
    } finally { unsubscribe(); }
  });
});
