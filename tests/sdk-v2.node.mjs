// SPDX-License-Identifier: MIT OR Apache-2.0
// Source-level controlled glue/controller proof. Actual native/WASM profile
// conformance is a separate lane; the empty module below contains no editor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createEditor } from '../packages/sdk/dist/index.js';
import { sdkBuildId, verifyLoadedSdkV2, SdkLoadError } from '../packages/wasm/dist/index.js';
import { encodeSdkWasmSeal } from '../scripts/seal-sdk-wasm.mjs';
import { deferred, fakeModule, mutation, options, result } from './helpers/sdk-fake.mjs';
import { fakeV2Module, v2Options, v2Profile } from './helpers/sdk-v2-fake.mjs';

const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function open(hooks = {}, extra = {}) {
  const fixture = fakeV2Module(hooks);
  const editor = createEditor({ input: new Uint8Array([65]), options: v2Options(), loader: async () => fixture.module, ...extra });
  assert.equal((await editor.ready).status, 'ok');
  return { editor, fixture };
}

test('V2 controller-only: owns exact raw descriptor strings and separate immutable context', async () => {
  const fixture = fakeV2Module(), load = deferred(), input = new Uint8Array([65]), config = v2Options();
  const original = structuredClone(config);
  const editor = createEditor({ input, options: config, loader: () => load.promise });
  assert.equal(editor.context(), null); input.fill(0); config.registry_json = '{}'; config.profile.extensions.length = 0;
  load.resolve(fixture.module); assert.equal((await editor.ready).status, 'ok');
  assert.deepEqual(fixture.instances[0].input, [65]);
  assert.deepEqual(fixture.instances[0].options, original);
  const context = editor.context();
  assert.equal(context.build_id, sdkBuildId);
  assert.deepEqual(Object.keys(context.profile), Object.keys(original.profile));
  for (const field of ['profile_id', 'profile_version', 'codec_id', 'wire_version']) assert.equal(context.profile[field], original.profile[field]);
  assert.deepEqual(context.profile.extensions.map(extension => [extension.id, extension.version]), original.profile.extensions.map(extension => [extension.id, extension.version]));
  assert.equal(context.registry_digest, 'a'.repeat(64)); assert.equal(context.capability_digest, 'b'.repeat(64));
  assert(Object.isFrozen(context) && Object.isFrozen(context.profile.extensions));
  assert.throws(() => { context.registry_digest = 'c'.repeat(64); }, TypeError);
  const before = editor.capture(); assert.equal(editor.read({ kind: 'state' }).status, 'ok'); assert.deepEqual(editor.capture(), before);
  assert.equal(editor.submit({ kind: 'update_facts', stamp: before, identities: { media: [], references: [] } }).response.diagnostic.code, 'sdk.invalid_request_kind');
  assert.equal(fixture.log.some(request => request.kind === 'update_facts'), false);
  editor.destroy(); assert.equal(editor.context(), null); assert.deepEqual(fixture.counts(), { live: 0, destroyed: 1, freed: 1 });
});

test('V2 controller-only: malformed native contexts are fatal before ready with recovery bytes and cleanup', async () => {
  const context = () => ({ build_id: sdkBuildId, profile: structuredClone(v2Profile), registry_digest: 'a'.repeat(64), capability_digest: 'b'.repeat(64) });
  for (const change of [() => null, value => ({ ...value, extra: true }), value => ({ ...value, registry_digest: 'A'.repeat(64) }),
    value => ({ ...value, capability_digest: 1 }), value => ({ ...value, build_id: 'wrong' }),
    value => ({ ...value, profile: { ...value.profile, codec_id: 'org.example.other/json' } })]) {
    const fixture = fakeV2Module({ context: () => JSON.stringify(change(context())) });
    const editor = createEditor({ input: new Uint8Array([65]), options: v2Options(), loader: async () => fixture.module });
    const ready = await editor.ready;
    assert.equal(ready.status, 'fatal'); assert.equal(ready.diagnostic.may_have_committed, false);
    assert.equal(editor.context(), null); assert.deepEqual([...editor.originalInput()], [65]);
    assert.deepEqual(fixture.counts(), { live: 0, destroyed: 1, freed: 1 });
    editor.destroy(); assert.equal(editor.originalInput(), null);
  }
});

test('V2 controller-only: shares one reentrant publication fence, captured staleness and history path', async () => {
  const { editor, fixture } = await open(); const seen = [], queued = [];
  editor.subscribe(event => {
    seen.push(['first', event.after.revision, editor.read({ kind: 'state' }).value.state.stamp.revision]);
    if (event.sequence === '1') {
      const captured = mutation(editor);
      queued.push(editor.submit(captured), editor.submit(captured));
      assert.equal(queued[0].status, 'queued'); assert.equal(queued[1].status, 'queued');
    }
  });
  editor.subscribe(event => seen.push(['second', event.after.revision, editor.capture().revision]));
  assert.equal(editor.submit(mutation(editor)).response.status, 'ok');
  assert.equal((await result(queued[0])).status, 'ok');
  assert.equal((await result(queued[1])).diagnostic.code, 'session.stale_revision');
  assert.deepEqual(seen, [['first', '1', '1'], ['second', '1', '1'], ['first', '2', '2'], ['second', '2', '2']]);
  const captured = editor.captureHostRequest(); assert.equal(captured.status, 'captured');
  editor.submit({ kind: 'barrier', stamp: editor.capture() });
  assert.equal(editor.completeHostRequest(captured.request, mutation(editor)).response.diagnostic.code, 'sdk.stale_request');
  assert.equal(fixture.log.filter(request => request.kind === 'acknowledge_events').length, 3);
  editor.destroy(); assert.deepEqual(fixture.counts(), { live: 0, destroyed: 1, freed: 1 });
});

test('V2 controller-only: postpublication listener read and query failures keep honest mutation provenance', async () => {
  for (const kind of ['catalog', 'query_history']) for (const failure of ['trap', 'native_fatal']) {
    let armed = false;
    const { editor, fixture } = await open({ call(request) {
      if (armed && request.kind === kind) {
        if (failure === 'trap') throw new WebAssembly.RuntimeError('controlled readonly trap');
        return JSON.stringify({ status: 'fatal', diagnostic: { code: 'fixture.native_fatal', path: '', category: 'fixture', details: {}, stamp: null, may_have_committed: false } });
      }
    } });
    let readonly;
    editor.subscribe(() => { armed = true; readonly = kind === 'catalog' ? editor.read({ kind })
      : editor.query({ kind, stamp: editor.capture(), direction: 'undo' }); });
    const ticket = editor.submit(mutation(editor));
    assert.equal(readonly.status, 'fatal'); assert.equal(readonly.diagnostic.may_have_committed, false);
    assert.equal(ticket.response.status, 'fatal'); assert.equal(ticket.response.diagnostic.may_have_committed, true);
    assert.equal(fixture.instances[0].state.stamp.revision, '1'); assert.equal(editor.context(), null);
    assert.deepEqual(fixture.counts(), { live: 0, destroyed: 1, freed: 1 });
  }
});

test('V2 controller-only: cancellation cannot create a late Session, and legacy fake modules remain valid', async () => {
  const fixture = fakeV2Module(), load = deferred();
  const editor = createEditor({ input: new Uint8Array([65]), options: v2Options(), loader: () => load.promise });
  editor.destroy(); assert.equal((await editor.ready).diagnostic.code, 'sdk.cancelled');
  load.resolve(fixture.module); await tick(); assert.equal(fixture.instances.length, 0); assert.equal(editor.context(), null);
  const legacy = fakeModule(); const old = createEditor({ input: new Uint8Array([65]), options: options(), loader: async () => legacy.module });
  assert.equal((await old.ready).status, 'ok'); assert.equal(old.context(), null); old.destroy();
});

test('V2 manifest guard: closed identities, optional compiled profiles and exact build checks', () => {
  const fixture = fakeV2Module();
  assert.equal(verifyLoadedSdkV2(fixture.module).manifest.profiles.length, 1);
  const empty = fakeV2Module(); empty.module.manifest.profiles = []; assert.equal(verifyLoadedSdkV2(empty.module).manifest.profiles.length, 0);
  for (const [change, code] of [
    [value => { value.abi = 'editor-sdk/1'; }, 'sdk.abi_mismatch'],
    [value => { value.build_id = 'wrong'; }, 'sdk.build_mismatch'],
    [value => { value.registry_format = 'editor-registry/2'; }, 'sdk.manifest_invalid'],
    [value => { value.extra = true; }, 'sdk.manifest_invalid'],
    [value => { value.profiles.push(structuredClone(value.profiles[0])); }, 'sdk.manifest_invalid'],
    [value => { value.profiles[0].compiled_extensions[0].extra = true; }, 'sdk.manifest_invalid'],
  ]) {
    const next = fakeV2Module(); change(next.module.manifest);
    assert.throws(() => verifyLoadedSdkV2(next.module), error => error instanceof SdkLoadError && error.code === code);
    assert.equal(next.instances.length, 0);
  }
});

async function controlledLoader({ v2 = true, wrongV2 = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'editor-sdk-v2-loader-'));
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
  for (const file of ['sdk.js', 'sdk-build-id.js']) copyFileSync(new URL(`../packages/wasm/dist/${file}`, import.meta.url), join(directory, file));
  const v1 = fakeModule().module.manifest, v2Manifest = fakeV2Module().module.manifest;
  if (wrongV2) v2Manifest.build_id = `sha256:${'0'.repeat(64)}`;
  const key = `controlled-loader-${directory}`;
  globalThis[key] = { imported: 0, initialized: 0, opened: 0 };
  writeFileSync(join(directory, 'editor_wasm.js'), `const counts=globalThis[${JSON.stringify(key)}];counts.imported++;
export default async({module_or_path})=>{counts.initialized++;await WebAssembly.instantiate(module_or_path);};
export const sdkManifestV1=()=>JSON.stringify(${JSON.stringify(v1)});
export class SdkSessionV1{constructor(){counts.opened++;}}
export const sdkResourceCountsV1=()=>'{"sessions":0}';
${v2 ? `export const sdkManifestV2=()=>JSON.stringify(${JSON.stringify(v2Manifest)});
export class SdkSessionV2{constructor(){counts.opened++;}}
export const sdkResourceCountsV2=()=>'{"sessions":0}';` : ''}
`);
  const loader = await import(pathToFileURL(join(directory, 'sdk.js')).href);
  const raw = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
  return { loader, counts: globalThis[key], bytes: abi => encodeSdkWasmSeal(raw, { abi, build_id: sdkBuildId }).bytes,
    close() { delete globalThis[key]; rmSync(directory, { recursive: true, force: true }); } };
}

test('V2 controlled loader: both projections and concurrent calls share exactly one glue initialization', async () => {
  for (const order of ['v1_first', 'v2_first', 'concurrent']) {
    const fixture = await controlledLoader();
    try {
      const wasm = fixture.bytes('editor-sdk/1'); let v1, v2;
      if (order === 'concurrent') [v1, v2] = await Promise.all([fixture.loader.loadSdk({ wasm }), fixture.loader.loadSdkV2({ wasm })]);
      else if (order === 'v1_first') { v1 = await fixture.loader.loadSdk({ wasm }); v2 = await fixture.loader.loadSdkV2({ wasm }); }
      else { v2 = await fixture.loader.loadSdkV2({ wasm }); v1 = await fixture.loader.loadSdk({ wasm }); }
      assert.equal(v1.manifest.abi, 'editor-sdk/1'); assert.equal(v2.manifest.abi, 'editor-sdk/2');
      assert.equal(await fixture.loader.loadSdk({ wasm }), v1); assert.equal(await fixture.loader.loadSdkV2({ wasm }), v2);
      assert.deepEqual(fixture.counts, { imported: 1, initialized: 1, opened: 0 });
    } finally { fixture.close(); }
  }
});

test('V2 controlled loader: ABI1-only glue keeps legacy route valid after missing V2 negotiation', async () => {
  const fixture = await controlledLoader({ v2: false });
  try {
    const wasm = fixture.bytes('editor-sdk/1'), legacy = await fixture.loader.loadSdk({ wasm });
    await assert.rejects(fixture.loader.loadSdkV2({ wasm }), error => error.code === 'sdk.abi_mismatch');
    assert.equal(await fixture.loader.loadSdk({ wasm }), legacy); assert.deepEqual(fixture.counts, { imported: 1, initialized: 1, opened: 0 });
  } finally { fixture.close(); }
});

test('V2 controlled loader: legacy refuses seal2 before glue import; V2 then succeeds once', async () => {
  const fixture = await controlledLoader();
  try {
    const wasm = fixture.bytes('editor-sdk/2');
    await assert.rejects(fixture.loader.loadSdk({ wasm }), error => error.code === 'sdk.abi_mismatch' && error.phase === 'seal');
    assert.deepEqual(fixture.counts, { imported: 0, initialized: 0, opened: 0 });
    assert.equal((await fixture.loader.loadSdkV2({ wasm })).manifest.abi, 'editor-sdk/2');
    await assert.rejects(fixture.loader.loadSdk({ wasm }), error => error.code === 'sdk.abi_mismatch');
    assert.deepEqual(fixture.counts, { imported: 1, initialized: 1, opened: 0 });
  } finally { fixture.close(); }
});

test('V2 controlled loader: concurrent seal2 legacy refusal cannot detach a second accepted initialization', async () => {
  const fixture = await controlledLoader();
  try {
    const wasm = fixture.bytes('editor-sdk/2');
    const [old, current] = await Promise.allSettled([fixture.loader.loadSdk({ wasm }), fixture.loader.loadSdkV2({ wasm })]);
    assert.equal(old.status, 'rejected'); assert.equal(old.reason.code, 'sdk.abi_mismatch'); assert.equal(current.status, 'fulfilled');
    assert.equal(await fixture.loader.loadSdkV2({ wasm }), current.value); assert.deepEqual(fixture.counts, { imported: 1, initialized: 1, opened: 0 });
  } finally { fixture.close(); }
});

test('V2 controlled loader: a contradictory offered native V2 build is terminal for both projections', async () => {
  const fixture = await controlledLoader({ wrongV2: true });
  try {
    const wasm = fixture.bytes('editor-sdk/1'); await fixture.loader.loadSdk({ wasm }); let terminal;
    await assert.rejects(fixture.loader.loadSdkV2({ wasm }), error => { terminal = error; return error.code === 'sdk.publisher_mismatch'; });
    await assert.rejects(fixture.loader.loadSdk({ wasm }), error => error === terminal);
    assert.deepEqual(fixture.counts, { imported: 1, initialized: 1, opened: 0 });
  } finally { fixture.close(); }
});

test('V2 controlled loader: an integrity failure fences an already awaiting input-ownership digest', async () => {
  const fixture = await controlledLoader({ wrongV2: true });
  const originalDigest = crypto.subtle.digest;
  let release;
  const paused = new Promise(resolve => { release = resolve; });
  try {
    const wasm = fixture.bytes('editor-sdk/1'); await fixture.loader.loadSdk({ wasm });
    crypto.subtle.digest = async function (...args) { const value = await originalDigest.apply(this, args); await paused; return value; };
    const waiting = fixture.loader.loadSdk({ wasm });
    crypto.subtle.digest = originalDigest;
    let terminal;
    await assert.rejects(fixture.loader.loadSdkV2({ wasm }), error => { terminal = error; return error.code === 'sdk.publisher_mismatch'; });
    release();
    await assert.rejects(waiting, error => error === terminal);
    assert.deepEqual(fixture.counts, { imported: 1, initialized: 1, opened: 0 });
  } finally { crypto.subtle.digest = originalDigest; release(); fixture.close(); }
});
