// SPDX-License-Identifier: MIT OR Apache-2.0
// Frozen F67-L families. Injected-controller tests are controlled JS transport;
// isolated loader probes use the actual packaged WASM, never a fabricated seal.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createEditor } from '../packages/sdk/dist/index.js';
import { loadSdk, loadSdkV2, SdkLoadError, sdkBuildId } from '../packages/wasm/dist/index.js';
import { deferred, fakeModule, options } from './helpers/sdk-fake.mjs';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const failure = code => error => error instanceof SdkLoadError && error.code === code;
const nativeZero = { sessions: 0, snapshot_handles: 0, snapshot_bytes: '0', protected_cursors: 0 };
const packaged = () => new Uint8Array(readFileSync(new URL('../packages/wasm/dist/editor_wasm_bg.wasm', import.meta.url)));
const assertNoSession = module => assert.deepEqual(JSON.parse(module.resourceCounts()), nativeZero);

async function loaderProbe(kind) {
  const bytes = packaged();
  if (kind === 'limits') {
    for (const loadTimeoutMs of [0, -1, 0.5, 30001, NaN, Infinity]) {
      await assert.rejects(loadSdk({ wasm: bytes, loadTimeoutMs }), error => failure('sdk.module_invalid')(error) && error.phase === 'deadline');
    }
    for (const loadTimeoutMs of [1, 30000, undefined]) {
      const abort = new AbortController(); abort.abort();
      await assert.rejects(loadSdk({ wasm: bytes, loadTimeoutMs, signal: abort.signal }),
        error => failure('sdk.load_cancelled')(error) && error.phase === 'load');
    }
    assertNoSession(await loadSdk({ wasm: bytes }));
  } else if (kind === 'last-fetch-reader') {
    const pending = deferred(), entered = deferred(); let ownedSignal, fetches = 0;
    globalThis.fetch = (_input, init) => {
      fetches++; ownedSignal = init.signal; entered.resolve(); return pending.promise;
    };
    const url = 'http://127.0.0.1:9/f67-owned.wasm', bootstrap = new AbortController();
    // Establish the pending-fetch phase before testing its last reader. A cold
    // entry may validly expire before fetch; that does not observe cancellation
    // of an owned request. Both readers retain real entry-based deadlines.
    const bootstrapCancelled = assert.rejects(loadSdk({ wasm: url, loadTimeoutMs: 10000, signal: bootstrap.signal }),
      failure('sdk.load_cancelled'));
    await entered.promise;
    const expired = assert.rejects(loadSdk({ wasm: url, loadTimeoutMs: 30 }), failure('sdk.load_timeout'));
    // loadSdk synchronously reserves the existing cache before async input
    // ownership. Cancelling bootstrap now leaves only the timed reader.
    bootstrap.abort();
    assert.equal(ownedSignal.aborted, false, 'The timed reader owns the pending fetch after bootstrap cancellation');
    await bootstrapCancelled;
    await expired;
    assert.equal(fetches, 1); assert.equal(ownedSignal.aborted, true);
    pending.resolve(new Response(bytes)); await tick();
    assertNoSession(await loadSdk({ wasm: bytes }));
  } else if (kind === 'last-body-reader') {
    let cancelled = 0;
    const response = new Response(new ReadableStream({ cancel() { cancelled++; } }));
    await assert.rejects(loadSdk({ wasm: response, loadTimeoutMs: 30 }), failure('sdk.load_timeout'));
    await tick(); assert.equal(cancelled, 1);
    assert.equal(response.body.locked, false);
    assertNoSession(await loadSdk({ wasm: bytes }));
  } else if (kind === 'shared-readers') {
    const pending = deferred(); let ownedSignal, fetches = 0;
    globalThis.fetch = (_input, init) => { fetches++; ownedSignal = init.signal; return pending.promise; };
    const url = 'http://127.0.0.1:9/f67-shared.wasm';
    const short = loadSdkV2({ wasm: url, loadTimeoutMs: 30 });
    const survivor = loadSdk({ wasm: url, loadTimeoutMs: 10000 });
    await assert.rejects(loadSdk({ wasm: `${url}?different` }), failure('sdk.module_input_mismatch'));
    await assert.rejects(short, failure('sdk.load_timeout'));
    assert.equal(ownedSignal.aborted, false); assert.equal(fetches, 1);
    pending.resolve(new Response(bytes));
    const actual = await survivor;
    assert.equal(actual.manifest.build_id, sdkBuildId); assertNoSession(actual);
    assertNoSession(await loadSdkV2({ wasm: url }));
  } else if (kind === 'cancel-one-reader') {
    const pending = deferred(); let ownedSignal;
    globalThis.fetch = (_input, init) => { ownedSignal = init.signal; return pending.promise; };
    const url = 'http://127.0.0.1:9/f67-cancel-shared.wasm', abort = new AbortController();
    const cancelled = loadSdk({ wasm: url, signal: abort.signal });
    const survivor = loadSdkV2({ wasm: url });
    await tick(); abort.abort();
    await assert.rejects(cancelled, failure('sdk.load_cancelled')); assert.equal(ownedSignal.aborted, false);
    pending.resolve(new Response(bytes)); assertNoSession(await survivor);
  } else if (kind === 'default-controller-destroy') {
    const pending = deferred(); let ownedSignal;
    globalThis.fetch = (_input, init) => { ownedSignal = init.signal; return pending.promise; };
    const editor = createEditor({ input: new Uint8Array([7, 8, 9]), options: options() });
    await tick(); assert.equal(ownedSignal.aborted, false);
    editor.destroy(); assert.equal((await editor.ready).diagnostic.code, 'sdk.cancelled');
    assert.equal(ownedSignal.aborted, true); assert.equal(editor.resources().loading_deadlines, 0);
    pending.resolve(new Response(bytes)); await tick();
    assert.equal(editor.resources().sessions, 0); assert.equal(editor.originalInput(), null);
    assertNoSession(await loadSdk({ wasm: bytes }));
  } else if (kind === 'late-input-digest') {
    const pending = deferred(), entered = deferred();
    const digest = crypto.subtle.digest.bind(crypto.subtle); let calls = 0;
    Object.defineProperty(crypto.subtle, 'digest', { configurable: true, value: async (...args) => {
      const actual = await digest(...args);
      if (++calls === 1) { entered.resolve(); await pending.promise; }
      return actual;
    } });
    const abandoned = assert.rejects(loadSdk({ wasm: bytes, loadTimeoutMs: 1000 }), failure('sdk.load_timeout'));
    await entered.promise; await abandoned;
    const current = await loadSdk({ wasm: bytes });
    pending.resolve(); await tick();
    assert.equal(await loadSdk({ wasm: bytes }), current); assertNoSession(current);
  } else if (kind === 'late-compile') {
    const pending = deferred(), entered = deferred();
    const compile = WebAssembly.compile; let calls = 0;
    WebAssembly.compile = async (...args) => {
      const actual = await compile(...args);
      if (++calls === 1) { entered.resolve(); await pending.promise; }
      return actual;
    };
    const abandoned = assert.rejects(loadSdk({ wasm: bytes, loadTimeoutMs: 1000 }), failure('sdk.load_timeout'));
    await entered.promise; await abandoned;
    const current = await loadSdk({ wasm: bytes });
    pending.resolve(); await tick();
    assert.equal(await loadSdk({ wasm: bytes }), current); assertNoSession(current);
  } else if (kind === 'late-singleton') {
    const pending = deferred(), entered = deferred();
    const instantiate = WebAssembly.instantiate; let instantiations = 0;
    WebAssembly.instantiate = async (...args) => {
      const actual = await instantiate(...args); instantiations++;
      entered.resolve(); await pending.promise;
      return actual;
    };
    const expired = assert.rejects(loadSdk({ wasm: bytes, loadTimeoutMs: 1000 }), failure('sdk.load_timeout'));
    await entered.promise; await expired;
    await assert.rejects(loadSdk({ wasm: bytes }), failure('sdk.runtime_retired'));
    pending.resolve(); await tick();
    await assert.rejects(loadSdkV2({ wasm: bytes }), failure('sdk.runtime_retired'));
    assert.equal(instantiations, 1);
    // Native counters from a retired instance are deliberately not read as zero.
  } else if (kind === 'digest-pending-shared-reader') {
    const digestGate = deferred(), instanceGate = deferred(), entered = deferred();
    const digest = crypto.subtle.digest.bind(crypto.subtle), instantiate = WebAssembly.instantiate;
    let digests = 0, instantiations = 0;
    Object.defineProperty(crypto.subtle, 'digest', { configurable: true, value: async (...args) => {
      const index = ++digests, actual = await digest(...args);
      if (index === 2) await digestGate.promise;
      return actual;
    } });
    WebAssembly.instantiate = async (...args) => {
      const actual = await instantiate(...args); instantiations++;
      entered.resolve(); await instanceGate.promise; return actual;
    };
    const expired = assert.rejects(loadSdk({ wasm: bytes, loadTimeoutMs: 1000 }), failure('sdk.load_timeout'));
    const survivor = loadSdkV2({ wasm: bytes, loadTimeoutMs: 10000 });
    await entered.promise; await expired;
    instanceGate.resolve(); digestGate.resolve();
    const actual = await survivor;
    assertNoSession(actual); assert.equal(actual.manifest.build_id, sdkBuildId);
    assert.equal(instantiations, 1);
  } else if (kind === 'controlled-init-runtime-error') {
    // A controlled JS throw after real instantiation checks conservative init
    // retirement only. It is explicitly not the genuine compiled-trap lane.
    const instantiate = WebAssembly.instantiate; let instantiations = 0;
    WebAssembly.instantiate = async (...args) => {
      await instantiate(...args); instantiations++;
      throw new WebAssembly.RuntimeError('controlled init rejection after real instance creation');
    };
    await assert.rejects(loadSdk({ wasm: bytes }), failure('sdk.instantiate_failed'));
    await assert.rejects(loadSdk({ wasm: bytes }), failure('sdk.runtime_retired'));
    assert.equal(instantiations, 1);
  } else throw new Error(`Unknown bounded loader probe: ${kind}`);
}

if (process.argv[2] === '--probe') {
  await loaderProbe(process.argv[3]);
} else {
  test('F67-L01 controlled controller: default/min/max accepted; invalid deadlines refuse before loader entry', async t => {
    // This control checks configuration boundaries, including the valid 1ms
    // minimum. Freeze only its clock so cold constructor work cannot consume
    // that minimum before the immediate ownership/cancel assertions. The
    // separate timeout/cancellation/late-completion cases use the real clock.
    t.mock.method(performance, 'now', () => 0);
    for (const loadTimeoutMs of [1, 30000, undefined]) {
      const editor = createEditor({ input: new Uint8Array([7, 8, 9]), options: options(), loadTimeoutMs,
        loader: () => new Promise(() => {}) });
      assert.equal(editor.resources().loading_deadlines, 1);
      editor.destroy(); assert.equal((await editor.ready).diagnostic.code, 'sdk.cancelled');
      assert.equal(editor.resources().loading_deadlines, 0);
    }
    for (const loadTimeoutMs of [0, -1, 0.5, 30001, NaN, Infinity]) {
      let loads = 0;
      const editor = createEditor({ input: new Uint8Array([7, 8, 9]), options: options(), loadTimeoutMs,
        loader: async () => { loads++; return fakeModule().module; } });
      assert.equal((await editor.ready).diagnostic.code, 'sdk.invalid_limit');
      assert.equal(loads, 0); assert.equal(editor.resources().loading_deadlines, 0); editor.destroy();
    }
  });
  for (const completion of ['resolve', 'reject']) test(`F67-L02 controlled controller: deadline fences late ${completion} and retains exact recovery bytes`, async () => {
    const load = deferred(), fixture = fakeModule(), input = new Uint8Array([7, 8, 9]);
    const editor = createEditor({ input, options: options(), loadTimeoutMs: 30, loader: () => load.promise });
    let settlements = 0; void editor.ready.then(() => settlements++); input.fill(0);
    const result = await editor.ready;
    assert.equal(result.status, 'refused'); assert.equal(result.diagnostic.code, 'sdk.load_timeout');
    assert.equal(result.diagnostic.may_have_committed, false); assert.equal(editor.lifecycle, 'destroyed');
    assert.deepEqual([...editor.originalInput()], [7, 8, 9]);
    const borrowed = editor.originalInput(); borrowed.fill(0); assert.deepEqual([...editor.originalInput()], [7, 8, 9]);
    assert.equal(editor.resources().loading_deadlines, 0);
    if (completion === 'resolve') load.resolve(fixture.module); else load.reject(new Error('late controlled rejection'));
    await tick(); assert.equal(settlements, 1); assert.equal(fixture.instances.length, 0);
    assert.equal(editor.resources().pending_tickets, 0); assert.equal(editor.resources().listeners, 0);
    editor.destroy(); assert.equal(editor.originalInput(), null); assert.equal(editor.resources().original_input_bytes, 0);
  });
  test('F67-L06 controlled controller: destroy cancels deadline and fences a later successful loader', async () => {
    const load = deferred(), fixture = fakeModule();
    const editor = createEditor({ input: new Uint8Array([7, 8, 9]), options: options(), loadTimeoutMs: 30, loader: () => load.promise });
    editor.destroy(); editor.destroy();
    assert.equal((await editor.ready).diagnostic.code, 'sdk.cancelled');
    load.resolve(fixture.module); await tick();
    assert.equal(fixture.instances.length, 0); assert.equal(editor.resources().loading_deadlines, 0);
    assert.equal(editor.resources().sessions, 0); assert.equal(editor.resources().original_input_bytes, 0);
  });
  for (const kind of ['limits', 'last-fetch-reader', 'last-body-reader', 'shared-readers', 'cancel-one-reader', 'default-controller-destroy',
    'late-input-digest', 'late-compile', 'late-singleton', 'digest-pending-shared-reader', 'controlled-init-runtime-error']) {
    test(`F67 packaged loader, isolated realm: ${kind}`, () => {
      const actual = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--probe', kind], {
        encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024,
      });
      assert.equal(actual.error, undefined); assert.equal(actual.signal, null);
      assert.equal(actual.status, 0, actual.stderr + actual.stdout);
    });
  }
}
