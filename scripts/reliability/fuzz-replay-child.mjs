// SPDX-License-Identifier: MIT OR Apache-2.0
// Test-only actual packaged SDK replay of retained fuzz corpus bytes. The
// parent process owns the external wall-clock watchdog and kills this process
// on overrun; no in-process race is treated as an interrupt. Authored
// input/request strings pass verbatim; host options are rebuilt with the
// packaged module identity exactly like the ordinary scenario SDK lane.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEditor, loadSdkV2 } from '../../packages/sdk/dist/index.js';
import { makeScenario } from './scenarios.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const bytes = new Uint8Array(readFileSync(resolve(root, 'packages/wasm/dist/editor_wasm_bg.wasm')));
const settle = ticket => ticket.status === 'queued' ? ticket.completion : Promise.resolve(ticket.response);
const counts = module => JSON.parse(module.resourceCounts());
const zeroFields = ['sessions', 'listeners', 'queued_mutations', 'queued_bytes', 'pending_tickets', 'host_requests', 'task_continuations', 'original_input_bytes', 'callback_error_handlers'];

function seedScenario(context) {
  return makeScenario({ id: `R38-fuzz-wasm-${context}`, context, initialText: 'ab', edits: [{ from: 1, to: 1, inserted: 'A' }] });
}

function moduleOptions(module, context) {
  const scenario = seedScenario(context);
  return { abi: 'editor-sdk/2', build_id: module.manifest.build_id, profile: scenario.profile, admission: 'validate',
    access: 'editable', registry_json: scenario.registry_json, profile_options_json: scenario.profile_options_json };
}

/** Valid UTF-8 bytes, including a leading BOM. Null means the payload is not UTF-8. */
export function admissionInputBytes(payload) {
  const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return null; }
  return new Uint8Array(bytes);
}

async function admission(module, context, payloadB64) {
  const payload = Buffer.from(payloadB64, 'base64');
  const input = admissionInputBytes(payload);
  if (!input) return { status: 'skipped-non-utf8', reason: 'raw payload is not valid UTF-8; JS admission input is a string byte domain' };
  const baseline = counts(module), callbackErrors = [];
  const editor = createEditor({ input, options: moduleOptions(module, context),
    loader: async () => module, onCallbackError: error => callbackErrors.push(error) });
  try {
    const ready = await editor.ready;
    assert.notEqual(ready.status, 'fatal', `unexpected SDK fatal: ${JSON.stringify(ready).slice(0, 512)}`);
    return { status: ready.status === 'ok' ? 'ok-admitted' : 'ok-refused' };
  } finally {
    try { await settle(editor.destroy()); } catch { /* a refused admission may already be disposed */ }
    try {
      for (const key of zeroFields) assert.equal(editor.resources()[key], 0, `closed JS ownership ${key}`);
      assert.deepEqual(counts(module), baseline, 'actual Rust resources return to baseline');
      assert.equal(callbackErrors.length, 0, 'no callback error survives admission replay');
    } catch (error) { return { status: 'failed', phase: 'cleanup', message: error.message }; }
  }
}

function bridge(module, context, payloadB64) {
  const payload = Buffer.from(payloadB64, 'base64');
  let seed;
  try { seed = JSON.parse(payload.toString('utf8')); } catch { return { status: 'envelope-non-admission' }; }
  const shaped = typeof seed?.input_json === 'string' && typeof seed?.options_json === 'string'
    && Array.isArray(seed?.requests) && seed.requests.length <= 64 && seed.requests.every(request => typeof request === 'string');
  if (!shaped) return { status: 'envelope-non-admission' };
  let authored;
  try { authored = JSON.parse(seed.options_json); } catch { return { status: 'envelope-non-admission' }; }
  const baseline = counts(module);
  const options = JSON.stringify({ ...authored, abi: 'editor-sdk/2', build_id: module.manifest.build_id, admission: 'validate', access: 'editable' });
  const session = new module.Session(new TextEncoder().encode(seed.input_json), options);
  let replies = 0;
  try {
    const initialization = JSON.parse(session.initialization());
    assert.notEqual(initialization.status, 'fatal', `unexpected bridge initial fatal: ${JSON.stringify(initialization).slice(0, 512)}`);
    const admitted = initialization.status === 'ok';
    // Raw request strings reach the actual controller unchanged.
    for (const request of seed.requests) {
      const raw = session.call(request);
      let reply;
      try { reply = JSON.parse(raw); } catch (error) { return { status: 'failed', phase: 'bridge-reply', message: `undecodable reply: ${error.message}` }; }
      assert.notEqual(reply.status, 'fatal', `unexpected bridge Fatal inside bounds: ${JSON.stringify(reply).slice(0, 512)}`);
      replies++;
    }
    return { status: 'ok', admitted, replies };
  } finally {
    try { session.destroy(); session.free(); } catch { /* a broken session still owns native resources */ }
    try { assert.deepEqual(counts(module), baseline, 'bridge replay returns native resources to baseline'); }
    catch (error) { return { status: 'failed', phase: 'cleanup', message: error.message }; }
  }
}

async function main() {
  const module = await loadSdkV2({ wasm: bytes });
  process.send?.({ kind: 'ready', buildId: module.manifest.build_id });
  process.on('message', async task => {
    if (task.kind === 'exit') { process.disconnect?.(); return; }
    try {
      const result = task.kind === 'admission' ? await admission(module, task.context, task.payloadB64)
        : task.kind === 'bridge' ? bridge(module, task.context, task.payloadB64)
        : { status: 'failed', phase: 'protocol', message: `unknown task kind: ${task.kind}` };
      process.send?.({ kind: 'result', task: task.index, result });
    } catch (error) {
      // An uncaught JS exception inside bounds is a failure, never a pass.
      process.send?.({ kind: 'result', task: task.index, result: { status: 'failed', phase: 'uncaught', message: String(error?.message ?? error).slice(0, 1024) } });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error.stack); process.exitCode = 1; process.disconnect?.();
});
