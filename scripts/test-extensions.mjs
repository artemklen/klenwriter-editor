// SPDX-License-Identifier: MIT OR Apache-2.0
// Actual compiled public APIs, with raw target outputs retained independently.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { computeSdkBuildIdentity } from './generate-sdk-types.mjs';
import { computeExtensionConsumerIdentity } from './build-extensions-consumers.mjs';
import { extensionPacket } from '../tests/support/extension-fixtures.mjs';
import { exerciseNotes, exerciseKwdj, wasmPort } from '../examples/notes-extension/testkit.mjs';

const directory = 'artifacts/extensions';
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
function artifact(path) {
  const stat = lstatSync(path);
  assert(stat.isFile() && !stat.isSymbolicLink(), `Regular artifact required: ${path}`);
  return { path, bytes: stat.size, sha256: sha(path) };
}
const walk = path => readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
  ? walk(`${path}/${entry.name}`) : entry.isFile() ? [`${path}/${entry.name}`] : []);

/** Validate exact current producer evidence; the real runner supplies disk reads. */
export function verifyConsumerProducer(producer, { variant, baseBuildId, baseSourceHashes }, readArtifact = artifact) {
  assert(['notes-only', 'kwdj-only'].includes(variant), 'Unknown consumer variant');
  const expected = computeExtensionConsumerIdentity({ baseBuildId, variant });
  assert.equal(producer.status, 'passed', `${variant}: producer did not finish`);
  assert.equal(producer.variant, variant);
  assert.equal(producer.baseBuildId, baseBuildId, `${variant}: stale default build`);
  assert.equal(producer.buildId, expected.buildId, `${variant}: stale compiled variant identity`);
  assert.equal(producer.defaultFeatures, false);
  assert.deepEqual(producer.features, [variant === 'notes-only' ? 'notes' : 'kwdj']);
  assert.deepEqual(producer.baseSourceHashes, baseSourceHashes, `${variant}: default source closure`);
  assert.deepEqual(producer.fixtureSourceHashes, expected.fixtureSourceHashes, `${variant}: fixture source closure`);
  assert.deepEqual(producer.sourceHashes, { ...baseSourceHashes, ...expected.fixtureSourceHashes }, `${variant}: complete producer source closure`);
  assert(Array.isArray(producer.artifacts) && producer.artifacts.length <= 64, 'Bounded actual artifact inventory required');
  const base = `${directory}/consumers/${variant}`, actual = [], paths = new Set();
  for (const row of producer.artifacts) {
    assert(typeof row.path === 'string' && row.path.startsWith(`${base}/`), 'Artifact escaped its concrete variant');
    assert.equal(relative(resolve('.'), resolve(row.path)).split(sep).join('/'), row.path, 'Canonical repository-relative artifact path required');
    assert(!paths.has(row.path), `Duplicate artifact: ${row.path}`); paths.add(row.path);
    assert(Number.isSafeInteger(row.bytes) && row.bytes >= 0 && /^[0-9a-f]{64}$/.test(row.sha256), 'Exact artifact size/SHA256 required');
    const current = readArtifact(row.path);
    assert.equal(current.bytes, row.bytes, `${row.path}: byte size changed`);
    assert.equal(current.sha256, row.sha256, `${row.path}: SHA256 changed`);
    actual.push({ path: row.path, bytes: current.bytes, sha256: current.sha256 });
  }
  for (const name of ['consumer', 'consumer.js', 'consumer_bg.wasm']) {
    assert(paths.has(`${base}/${name}`), `${variant}: missing executable/glue/WASM binding`);
  }
  return actual;
}

async function main() {
  mkdirSync(directory, { recursive: true });
  const identity = computeSdkBuildIdentity(), built = JSON.parse(readFileSync('artifacts/sdk-build-identity.json', 'utf8'));
  assert.equal(identity.buildId, built.buildId, 'Build the current source before extension tests');
  const sources = [...new Set([...Object.keys(identity.sourceHashes), ...walk('contracts/extensions/v1'), ...walk('contracts/notes/v1'),
    ...walk('examples/notes-extension'), ...walk('tests/fixtures/extensions-consumer/src'),
    'tests/fixtures/extensions-consumer/Cargo.toml', 'tests/fixtures/extensions-consumer/Cargo.lock',
    'scripts/test-extensions.mjs', 'tests/support/extension-fixtures.mjs', 'tests/support/codec-fixtures.mjs'])].sort();
  const before = Object.fromEntries(sources.map(path => [path, sha(path)]));
  const packet = extensionPacket();
  writeFileSync(`${directory}/packet.json`, JSON.stringify(packet));

  async function nativePort(executable, stem) {
    const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const pending = []; let ended = false;
    const stdout = `${directory}/${stem}.stdout.jsonl`, stderr = `${directory}/${stem}.stderr.log`;
    writeFileSync(stdout, ''); writeFileSync(stderr, '');
    child.stderr.on('data', chunk => appendFileSync(stderr, chunk));
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      appendFileSync(stdout, line + '\n');
      const next = pending.shift();
      if (!next) { child.kill(); return; }
      clearTimeout(next.timer);
      try { next.resolve(JSON.parse(line)); } catch (error) { next.reject(error); }
    });
    const completion = new Promise((accept, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        ended = true;
        for (const next of pending.splice(0)) { clearTimeout(next.timer); next.reject(new Error(`Native consumer exited ${code}/${signal}`)); }
        accept({ code, signal });
      });
    });
    const request = value => new Promise((accept, reject) => {
      if (ended) { reject(new Error('Native consumer already exited')); return; }
      const timer = setTimeout(() => { child.kill(); reject(new Error(`Native consumer timeout for ${value.op}`)); }, 60000);
      pending.push({ resolve: accept, reject, timer }); child.stdin.write(JSON.stringify(value) + '\n');
    });
    const manifest = await request({ op: 'manifest' });
    return { manifest, multiple: false, resources: () => request({ op: 'resources' }),
      async open(input, options) {
        const initial = await request({ op: 'open', input, options_json: JSON.stringify(options) });
        return { async initialization() { return initial; }, context: () => request({ op: 'context' }),
          call: value => request({ op: 'call', request_json: JSON.stringify(value) }),
          async destroy() { await request({ op: 'destroy' }); } };
      }, async close() { child.stdin.end(); const result = await completion; assert.equal(result.code, 0, readFileSync(stderr, 'utf8')); },
      raw: { stdout, stderr } };
  }

  const lanes = [], consumerBuilds = [], artifactRecords = [];
  for (const variant of ['notes-only', 'kwdj-only']) {
    const base = `${directory}/consumers/${variant}`;
    const producer = JSON.parse(readFileSync(`${base}/build.json`, 'utf8'));
    const verified = verifyConsumerProducer(producer, { variant, baseBuildId: built.buildId, baseSourceHashes: identity.sourceHashes });
    const receipt = artifact(`${base}/build.json`);
    consumerBuilds.push({ variant, buildId: producer.buildId, receipt, artifacts: verified });
    artifactRecords.push(receipt, ...verified);
    const native = await nativePort(resolve(`${base}/consumer`), `${variant}-native`);
    try {
      assert.equal(native.manifest.build_id, producer.buildId);
      lanes.push({ target: 'native', variant, buildId: producer.buildId, notes: await exerciseNotes(native, packet), kwdj: await exerciseKwdj(native, packet), raw: native.raw });
    } finally { await native.close(); }
    const glue = await import(pathToFileURL(resolve(`${base}/consumer.js`)).href);
    await glue.default({ module_or_path: readFileSync(`${base}/consumer_bg.wasm`) });
    const raw = `${directory}/${variant}-wasm.jsonl`; writeFileSync(raw, '');
    const wasm = wasmPort(glue, row => appendFileSync(raw, JSON.stringify(row) + '\n'));
    assert.deepEqual(wasm.manifest, native.manifest);
    const observed = { target: 'wasm', variant, buildId: producer.buildId, notes: await exerciseNotes(wasm, packet), kwdj: await exerciseKwdj(wasm, packet), raw };
    assert.deepEqual(observed.notes.codec, lanes.at(-1).notes.codec);
    assert.deepEqual(observed.notes.commands, lanes.at(-1).notes.commands);
    assert.deepEqual(observed.kwdj, lanes.at(-1).kwdj);
    lanes.push(observed);
  }

  const { loadSdk, loadSdkV2, createEditor } = await import('../packages/sdk/dist/index.js');
  const bytes = readFileSync('packages/wasm/dist/editor_wasm_bg.wasm');
  artifactRecords.push(artifact('packages/wasm/dist/editor_wasm_bg.wasm'), artifact('packages/wasm/dist/editor_wasm.js'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), artifactRecords.at(-2).sha256);
  const legacy = await loadSdk({ wasm: bytes }), module = await loadSdkV2({ wasm: bytes });
  const raw = `${directory}/default-wasm.jsonl`; writeFileSync(raw, '');
  const port = wasmPort(module, row => appendFileSync(raw, JSON.stringify(row) + '\n'));
  lanes.push({ target: 'wasm', variant: 'default-both', buildId: module.manifest.build_id,
    notes: await exerciseNotes(port, packet), kwdj: await exerciseKwdj(port, packet), raw });

  // The actual V1 and V2 public constructors share Rust globals. Separate hidden
  // instantiations would report1 here, rather than the required two live Sessions.
  const original = packet.kwdj.find(c => c.expectedStatus === 'accepted');
  const old = new legacy.Session(new TextEncoder().encode(original.input), JSON.stringify({ abi: 'editor-sdk/1', build_id: legacy.manifest.build_id,
    profile: legacy.manifest.profiles[0], admission: 'validate', access: 'editable', identities: { media: [], references: [] }, limits: null }));
  const { notesOptions } = await import('../examples/notes-extension/testkit.mjs');
  const notes = await port.open(packet.extension.initial, notesOptions(module.manifest, packet));
  try {
    assert.equal(JSON.parse(old.initialization()).status, 'ok'); assert.equal((await notes.initialization()).status, 'ok');
    assert.equal(JSON.parse(legacy.resourceCounts()).sessions, 2); assert.equal(JSON.parse(module.resourceCounts()).sessions, 2);
  } finally { old.destroy(); old.free(); await notes.destroy(); }

  // Public controller uses the same publication/queue loop for explicit V2.
  const editor = createEditor({ input: new TextEncoder().encode(packet.extension.initial), options: notesOptions(module.manifest, packet), loader: async () => module });
  try {
    assert.equal((await editor.ready).status, 'ok'); assert.equal(editor.context().build_id, module.manifest.build_id);
    const doc = editor.read({ kind: 'node', stamp: editor.capture(), node: editor.read({ kind: 'state' }).value.state.root }).value.node.children[0];
    const command = { id: packet.extension.command_id, payload_json: JSON.stringify({ kind: 'recipe', arguments: { nodes: { doc }, values: packet.extension.values } }) };
    assert.equal(editor.query({ kind: 'query_command', stamp: editor.capture(), command }).value.available, true);
    assert.equal(editor.submit({ kind: 'command', stamp: editor.capture(), command, history_hint: { kind: 'isolated' } }).response.status, 'ok');
    const snapshot = editor.submit({ kind: 'snapshot', stamp: editor.capture(), max_bytes: 16777216 }).response.value;
    assert.equal(snapshot.canonical_json, packet.extension.after);
    editor.submit({ kind: 'release_snapshot', handle: snapshot.handle });
    assert.equal(editor.submit({ kind: 'history', stamp: editor.capture(), direction: 'undo' }).response.status, 'ok');
  } finally { editor.destroy(); }
  assert.equal(JSON.parse(module.resourceCounts()).sessions, 0);
  for (const row of artifactRecords) assert.deepEqual(artifact(row.path), row, `${row.path}: artifact changed during conformance`);
  const after = Object.fromEntries(sources.map(path => [path, sha(path)]));
  assert.deepEqual(after, before, 'Source changed during extension observation');
  assert.equal(computeSdkBuildIdentity().buildId, built.buildId);
  writeFileSync(`${directory}/report.json`, JSON.stringify({ format: 'editor-extensions-runtime/1', status: 'passed', sourceHashes: after,
    producerBuildId: built.buildId, defaultWasmSha256: sha('packages/wasm/dist/editor_wasm_bg.wasm'),
    artifactHashes: Object.fromEntries(artifactRecords.map(row => [row.path, row.sha256])),
    artifactBytes: Object.fromEntries(artifactRecords.map(row => [row.path, row.bytes])), consumerBuilds, lanes,
    actualSharedV1V2RustCounters: true, actualV2Controller: true,
    scope: 'Real separate public compiled modules and one default packaged WASM; native/WASM raw outputs retained. Browser CSP and offline packed consumer have separate reports.' }, null, 2) + '\n');
  console.log(`Extensions native/WASM passed: ${lanes.length} actual lanes, notes53+commands18+runtime recipe, KWDJ60; default V1/V2 share actual Rust ownership counters`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
