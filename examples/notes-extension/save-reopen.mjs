// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createCommand, createEditor, loadSdkV2 } from '@klenwriter/editor-sdk';
import { exerciseNotes, notesOptions, wasmPort } from './testkit.mjs';

function publicBytes(specifier) {
  return readFileSync(new URL(import.meta.resolve(specifier)));
}

function accepted(response) {
  assert.equal(response.status, 'ok', JSON.stringify(response));
  return response.value;
}

async function submit(editor, request) {
  const ticket = editor.submit(request);
  return accepted(ticket.status === 'queued' ? await ticket.completion : ticket.response);
}

function snapshot(editor) {
  return submit(editor, { kind: 'snapshot', stamp: editor.capture(), max_bytes: 1_048_576 });
}

const packet = JSON.parse(readFileSync(new URL('./packet.json', import.meta.url)));
for (const registry of ['D0', 'D1']) {
  const specifier = '@example/notes-extension/' + registry.toLowerCase() + '.json';
  const registryJson = publicBytes(specifier).toString('utf8');
  assert.equal(registryJson, packet.registryJson[registry]);
  packet.registryJson[registry] = registryJson;
}
const wasm = publicBytes('@klenwriter/editor-wasm/artifact.wasm');
const sdk = await loadSdkV2({ wasm });
const options = notesOptions(sdk.manifest, packet);
const baseline = JSON.parse(sdk.resourceCounts());
const conformance = await exerciseNotes(wasmPort(sdk), packet);
assert.equal(conformance.module, 'present');
assert.equal(conformance.codec.length, 53);
assert.equal(conformance.commands.length, 18);
assert.equal(conformance.runtimeRecipe, 'passed');

const { initial, after, command_id: commandId, values } = packet.extension;
const input = new TextEncoder().encode(initial);
const savedFile = new URL('./saved-note.json', import.meta.url);
const editor = createEditor({ input, options, loader: async () => sdk });
let originalSession;
try {
  accepted(await editor.ready);
  const stamp = editor.capture();
  originalSession = stamp.session;
  const { state } = accepted(editor.read({ kind: 'state' }));
  const { node } = accepted(editor.read({ kind: 'node', stamp, node: state.root }));
  const command = createCommand(commandId, { kind: 'recipe', arguments: { nodes: { doc: node.children[0] }, values } });
  assert(accepted(editor.query({ kind: 'query_command', stamp, command })).available);
  await submit(editor, { kind: 'command', stamp, command, history_hint: { kind: 'isolated' } });

  const saved = await snapshot(editor);
  try {
    assert.equal(saved.canonical_json, after);
    writeFileSync(savedFile, saved.canonical_json, { flag: 'wx' });
    await submit(editor, { kind: 'acknowledge_snapshot', stamp: saved.stamp, handle: saved.handle });
  } finally {
    await submit(editor, { kind: 'release_snapshot', handle: saved.handle });
  }
} finally {
  editor.destroy();
}
assert.deepEqual(JSON.parse(sdk.resourceCounts()), baseline);

const savedBytes = readFileSync(savedFile);
const reopened = createEditor({ input: new Uint8Array(savedBytes), options, loader: async () => sdk });
try {
  accepted(await reopened.ready);
  assert.notEqual(reopened.capture().session, originalSession);
  const saved = await snapshot(reopened);
  try {
    assert.equal(saved.canonical_json, after);
    assert.deepEqual(Buffer.from(saved.canonical_json), savedBytes);
  } finally {
    await submit(reopened, { kind: 'release_snapshot', handle: saved.handle });
  }
} finally {
  reopened.destroy();
}
assert.deepEqual(JSON.parse(sdk.resourceCounts()), baseline);
console.log(JSON.stringify({
  result: 'PASS',
  codecCases: conformance.codec.length,
  commandCases: conformance.commands.length,
  runtimeRecipe: conformance.runtimeRecipe,
  freshReopen: 'byte-identical Notes D1 export',
  buildId: sdk.manifest.build_id,
  wasmSha256: createHash('sha256').update(wasm).digest('hex'),
  savedSha256: createHash('sha256').update(savedBytes).digest('hex'),
}));
