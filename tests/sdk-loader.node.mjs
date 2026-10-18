import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { encodeSdkWasmSeal, wasmSections, uleb32, sdkWasmSectionName } from '../scripts/seal-sdk-wasm.mjs';
import { sdkAbiV1, sdkBuildId, loadSdk, verifyLoadedSdk, SdkLoadError } from '../packages/wasm/dist/index.js';

const profile = () => ({ profile_id: 'org.klenwriter.kwdj', profile_version: '1.0.0',
  codec_id: 'org.klenwriter.kwdj/json', wire_version: 1,
  extensions: [{ id: 'org.klenwriter.kwdj/base', version: '1.0.0' }] });
const manifest = () => ({ abi: sdkAbiV1, build_id: sdkBuildId, profiles: [profile()] });
const bytesPath = new URL('../packages/wasm/dist/editor_wasm_bg.wasm', import.meta.url);

function changedLiteral(bytes, oldText, newText) {
  assert.equal(oldText.length, newText.length);
  const output = Buffer.from(bytes);
  const from = Buffer.from(oldText); const to = Buffer.from(newText);
  let offset = 0; let found = 0;
  for (;;) {
    const at = output.indexOf(from, offset);
    if (at < 0) break;
    to.copy(output, at); offset = at + from.length; found += 1;
  }
  assert(found > 0, `actual compiled WASM must contain ${oldText}`);
  return output;
}

async function probe(kind) {
  const bytes = new Uint8Array(readFileSync(bytesPath));
  const sections = wasmSections(bytes); const stamp = sections.filter(section => section.name === sdkWasmSectionName);
  assert.equal(stamp.length, 1); const raw = bytes.subarray(0, stamp[0].start);
  const seal = (payload, abi = sdkAbiV1, build_id = sdkBuildId) => encodeSdkWasmSeal(payload, { abi, build_id }).bytes;
  const counts = async () => {
    const glue = await import('../packages/wasm/dist/editor_wasm.js');
    const value = JSON.parse(glue.sdkResourceCountsV1());
    assert.deepEqual(value, { sessions: 0, snapshot_handles: 0, snapshot_bytes: '0', protected_cursors: 0 });
    return value;
  };
  if (kind === 'wrong-build' || kind === 'wrong-abi') {
    const otherBuild = `sha256:${sdkBuildId[7] === '0' ? '1' : '0'}${sdkBuildId.slice(8)}`;
    const mixed = kind === 'wrong-build'
      ? seal(changedLiteral(raw, sdkBuildId, otherBuild), sdkAbiV1, otherBuild)
      : seal(changedLiteral(raw, sdkAbiV1, 'editor-sdk/9'), 'editor-sdk/9');
    // Coherent wrong-version fixture: actual Rust data and seal both name the wrong
    // ABI/build. Preflight must reject before singleton glue initialization.
    await assert.rejects(loadSdk({ wasm: mixed }), error => error instanceof SdkLoadError
      && error.code === (kind === 'wrong-build' ? 'sdk.build_mismatch' : 'sdk.abi_mismatch'));
    assert.equal((await loadSdk({ wasm: bytes })).manifest.build_id, sdkBuildId);
    await counts(); // Actual same-process wrong -> correct retry; no fresh realm shortcut.
  } else if (kind === 'bytes-ownership-cache') {
    const borrowed = bytes.slice();
    const pending = loadSdk({ wasm: borrowed }); borrowed.fill(0);
    const first = await pending;
    assert.equal(first.manifest.build_id, sdkBuildId);
    assert.equal(first, await loadSdk({ wasm: bytes.slice() }));
    assert(Object.isFrozen(first) && Object.isFrozen(first.manifest) && Object.isFrozen(first.manifest.profiles));
    await assert.rejects(loadSdk({ wasm: changedLiteral(bytes, sdkBuildId,
      `sha256:${sdkBuildId[7] === '0' ? '1' : '0'}${sdkBuildId.slice(8)}`) }),
    error => error instanceof SdkLoadError && error.code === 'sdk.module_input_mismatch');
    await counts();
  } else if (kind === 'compile-failure-retry') {
    const invalidType = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0, 1, 1, 255);
    await assert.rejects(loadSdk({ wasm: seal(invalidType) }),
      error => error instanceof SdkLoadError && error.code === 'sdk.compile_failed');
    assert.equal((await loadSdk({ wasm: bytes })).manifest.build_id, sdkBuildId);
    await counts();
  } else if (kind === 'instantiate-failure-retry') {
    // Valid section table/module with an unavailable import; fails actual instantiation.
    const missingImport = Uint8Array.of(0,97,115,109,1,0,0,0, 1,4,1,96,0,0,
      2,14,1,7,109,105,115,115,105,110,103,2,102,110,0,0);
    assert(WebAssembly.validate(missingImport));
    await assert.rejects(loadSdk({ wasm: seal(missingImport) }),
      error => error instanceof SdkLoadError && error.code === 'sdk.instantiate_failed');
    assert.equal((await loadSdk({ wasm: bytes })).manifest.build_id, sdkBuildId); await counts();
  } else if (kind === 'body-hash-failure-retry') {
    const corrupted = changedLiteral(bytes, sdkBuildId,
      `sha256:${sdkBuildId[7] === '0' ? '1' : '0'}${sdkBuildId.slice(8)}`);
    // Restore only the original seal; compiled Rust bytes are changed and digest is stale.
    corrupted.set(bytes.subarray(stamp[0].start), stamp[0].start);
    await assert.rejects(loadSdk({ wasm: corrupted }), error => error instanceof SdkLoadError
      && error.code === 'sdk.module_invalid' && error.phase === 'seal_body_hash');
    assert.equal((await loadSdk({ wasm: bytes })).manifest.build_id, sdkBuildId); await counts();
  } else if (kind === 'publisher-fault-terminal') {
    // Deliberately dishonest seal: valid digest/expected metadata over contradictory Rust.
    // This is a publisher-integrity fault, distinct from ordinary version mismatch/retry.
    const dishonest = seal(changedLiteral(raw, sdkAbiV1, 'editor-sdk/9'));
    let terminal;
    await assert.rejects(loadSdk({ wasm: dishonest }), error => {
      terminal = error; return error instanceof SdkLoadError && error.code === 'sdk.publisher_mismatch';
    });
    await assert.rejects(loadSdk({ wasm: bytes }), error => error === terminal);
    await counts();
  } else if (kind === 'default-browser-fetch-shape') {
    const original = globalThis.fetch;
    let fetched = 0;
    globalThis.fetch = async input => {
      assert.equal(String(input), new URL('../packages/wasm/dist/editor_wasm_bg.wasm', import.meta.url).href);
      fetched += 1; return new Response(bytes, { headers: { 'content-type': 'application/wasm' } });
    };
    try {
      const first = await loadSdk(); assert.equal(first.manifest.build_id, sdkBuildId);
      assert.equal(first, await loadSdk()); assert.equal(fetched, 1);
      await counts();
    } finally { globalThis.fetch = original; }
  } else if (kind === 'network-failure-retry') {
    const original = globalThis.fetch;
    globalThis.fetch = async () => { throw new TypeError('controlled unavailable fetch'); };
    try {
      await assert.rejects(loadSdk(), error => error instanceof SdkLoadError && error.code === 'sdk.load_failed' && error.phase === 'fetch');
      globalThis.fetch = async () => new Response(bytes);
      assert.equal((await loadSdk()).manifest.build_id, sdkBuildId); await counts();
    } finally { globalThis.fetch = original; }
  } else throw new Error('Unknown isolated loader probe');
  process.stdout.write(JSON.stringify({ case: kind, status: 'passed', actualCompiledRustManifest: true,
    nativeSessionsOpened: 0, scope: 'Loader only; no editor command/lifecycle claim.' }) + '\n');
}

if (process.argv[2] === '--probe') {
  await probe(process.argv[3]);
} else {
  test('SDK loader manifest guard rejects mismatched or malformed offers before constructor access', () => {
    let opened = 0;
    class NoSession { constructor() { opened += 1; } }
    const value = m => ({ manifest: m, Session: NoSession, resourceCounts: () => '{}' });
    assert.equal(verifyLoadedSdk(value(manifest())).manifest.build_id, sdkBuildId);
    for (const [change, code] of [
      [m => { m.abi = 'editor-sdk/99'; }, 'sdk.abi_mismatch'],
      [m => { m.build_id = 'unbuilt-editor-sdk'; }, 'sdk.build_mismatch'],
      [m => { m.extra = true; }, 'sdk.manifest_invalid'],
      [m => { m.profiles[0].wire_version = '1'; }, 'sdk.manifest_invalid'],
      [m => { m.profiles[0].extensions[0].id = '\ud800'; }, 'sdk.manifest_invalid'],
      [m => { m.profiles[0].extensions[0].unknown = true; }, 'sdk.manifest_invalid'],
      [m => { m.profiles = []; }, 'sdk.manifest_invalid'],
    ]) {
      const m = manifest(); change(m);
      assert.throws(() => verifyLoadedSdk(value(m)), error => error instanceof SdkLoadError && error.code === code);
    }
    assert.equal(opened, 0);
  });
  test('SDK sealed module table rejects duplicate/trailing/malformed/nonclosed metadata before glue', async () => {
    const raw = Uint8Array.of(0,97,115,109,1,0,0,0);
    const sealed = encodeSdkWasmSeal(raw, { abi: sdkAbiV1, build_id: sdkBuildId });
    const section = wasmSections(sealed.bytes).find(x => x.name === sdkWasmSectionName);
    const rewrite = text => {
      const name = new TextEncoder().encode(sdkWasmSectionName); const data = new TextEncoder().encode(text);
      const payload = Buffer.concat([uleb32(name.length), name, data]);
      return Buffer.concat([raw, Uint8Array.of(0), uleb32(payload.length), payload]);
    };
    const invalidUtf8 = Buffer.from(sealed.bytes); invalidUtf8[section.dataStart] = 255;
    for (const input of [
      Buffer.concat([sealed.bytes, sealed.bytes.subarray(section.start)]),
      Buffer.concat([sealed.bytes, Uint8Array.of(0,1,0)]),
      Buffer.concat([sealed.bytes, Uint8Array.of(0,128)]), invalidUtf8,
      rewrite(JSON.stringify({ ...sealed.metadata, extra: true })),
      rewrite(JSON.stringify(sealed.metadata).replace('"abi":', '"abi":"editor-sdk/1","abi":')),
      rewrite(JSON.stringify({ ...sealed.metadata, extra: 'x'.repeat(65536) })),
      rewrite(JSON.stringify({ ...sealed.metadata, wasm_bytes: 9 })),
    ]) {
      await assert.rejects(loadSdk({ wasm: input }), error => error instanceof SdkLoadError && error.code === 'sdk.module_invalid');
    }
    await assert.rejects(loadSdk({ wasm: await WebAssembly.compile(raw) }),
      error => error instanceof SdkLoadError && error.code === 'sdk.module_invalid');
  });
  for (const kind of ['wrong-build', 'wrong-abi', 'bytes-ownership-cache', 'compile-failure-retry',
    'instantiate-failure-retry', 'body-hash-failure-retry', 'publisher-fault-terminal',
    'default-browser-fetch-shape', 'network-failure-retry']) {
    test(`SDK loader actual compiled module: ${kind}`, () => {
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--probe', kind],
        { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
      assert.equal(child.status, 0, child.stderr + child.stdout);
      const report = JSON.parse(child.stdout);
      assert.equal(report.status, 'passed'); assert.equal(report.nativeSessionsOpened, 0);
    });
  }
}
