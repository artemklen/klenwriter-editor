// SPDX-License-Identifier: MIT OR Apache-2.0
// Closed helper adapter; import does not inspect the OS or execute any process.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const actions = Object.freeze(['copy', 'cut', 'paste', 'undo', 'redo']);
const formatLimit = 2 * 1024 * 1024;
const aggregateLimit = 4 * 1024 * 1024;
const immutable = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value); } return value; };
const snapshot = value => immutable(structuredClone(value));
const exact = (value, keys) => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
};
function rectangle(value) {
  exact(value, ['x', 'y', 'width', 'height']);
  for (const n of Object.values(value)) assert.ok(Number.isFinite(n));
  assert.ok(value.width > 0 && value.height > 0 && Number.isFinite(value.x + value.width) && Number.isFinite(value.y + value.height));
  return structuredClone(value);
}
const safariReleaseFirst = (browser, action) => browser === 'safari' && ['copy', 'cut', 'paste', 'undo'].includes(action);
function expectedProgram(browser, action, cleanup) {
  const key = { copy: 8, cut: 7, paste: 9, undo: 6, redo: 6 }[action];
  const step = (keyCode, down, flags) => ({ keyCode, down, flags });
  if (cleanup) return [step(55, false, 'none'), ...(action === 'redo' ? [step(56, false, 'none')] : []), step(key, false, 'none')];
  if (action === 'redo') return [step(55, true, 'command'), step(56, true, 'command+shift'), step(key, true, 'command+shift'), step(key, false, 'command+shift'), step(56, false, 'command'), step(55, false, 'none')];
  if (safariReleaseFirst(browser, action)) return [step(55, true, 'command'), step(key, true, 'command'), step(55, false, 'none'), step(key, false, 'none')];
  return [step(55, true, 'command'), step(key, true, 'command'), step(key, false, 'command'), step(55, false, 'none')];
}
function expectedProgramId(browser, action, cleanup) {
  return `osr47/${cleanup ? 'release-' : ''}${action}${safariReleaseFirst(browser, action) ? '/safari-release-first/1' : '/1'}`;
}
function scalarText(value) {
  assert.equal(typeof value, 'string');
  assert.ok(value.isWellFormed(), 'Clipboard strings must contain valid Unicode scalars');
  const bytes = Buffer.from(value, 'utf8');
  assert.equal(bytes.toString('utf8'), value);
  assert.ok(bytes.length <= formatLimit, 'Selected clipboard format exceeds 2MiB');
  return bytes;
}
export class ClipboardPlatformError extends Error {
  constructor(message, record, cleanup = null) {
    super(message);
    this.name = 'ClipboardPlatformError';
    this.record = snapshot(record);
    this.cleanup = snapshot(cleanup);
  }
}
export function createClipboardPlatform({ helperPath, browser, nonce, title, onRecord = () => {} }) {
  assert.equal(typeof helperPath, 'string');
  assert.ok(helperPath.startsWith('/'), 'Compiled helper must have an explicit absolute path');
  assert.ok(['chrome', 'safari'].includes(browser));
  assert.match(nonce, /^[a-f0-9]{32}$/);
  assert.equal(nonce.length, 32);
  assert.equal(title, `KlenWriter Clipboard native ${nonce}`);
  assert.equal(typeof onRecord, 'function');
  let owner = null, serial = 0, disabled = false, pending = null, inspecting = false, notifying = false;
  const records = [];
  const kept = new WeakMap();
  const usedIds = new Set();
  const nextId = supplied => {
    assert.ok(++serial <= 1024, 'Closed helper call inventory exhausted');
    const id = supplied ?? `${nonce}:${serial}`;
    assert.equal(typeof id, 'string');
    assert.match(id, new RegExp(`^${nonce}:[1-9][0-9]{0,3}$`));
    assert.equal(id.match(new RegExp(`^${nonce}:[1-9][0-9]{0,3}$`))?.[0], id);
    assert.ok(!usedIds.has(id), 'A helper request identity cannot be reused'); usedIds.add(id);
    return id;
  };
  const makeRequest = (operation, requestId, extra = {}) => ({ format: 'osr47-clipboard-platform/1', operation, browser, nonce, title, requestId: nextId(requestId), deadlineMs: operation.startsWith('clipboard-') ? 2000 : 1000, ...(operation === 'inspect' ? {} : structuredClone(owner)), ...extra });
  function keep(record) {
    if (kept.has(record)) return records[kept.get(record)];
    const index = records.length;
    kept.set(record, index);
    const evidence = snapshot(record);
    records.push(evidence);
    notifying = true;
    try { onRecord(evidence); }
    catch (error) { disabled = true; record.recordingError = error.message; records[index] = snapshot(record); }
    finally { notifying = false; }
    return records[index];
  }
  function recorded(record) { const evidence = keep(record); assert.equal(record.recordingError, undefined, 'Evidence recording failed'); return evidence; }
  function run(request) {
    const input = JSON.stringify(request);
    assert.ok(Buffer.byteLength(input) <= 32 * 1024 * 1024);
    const start = performance.now();
    const result = spawnSync(helperPath, [], { input, encoding: 'utf8', timeout: request.deadlineMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    const record = { command: helperPath, argv: [], request, startMonotonicMs: start, elapsedMs: performance.now() - start,
      exitCode: result.status, signal: result.signal, error: result.error ? { code: result.error.code ?? null, message: result.error.message } : null,
      stdout: result.stdout ?? '', stderr: result.stderr ?? '', result: null };
    try { if (!record.error && !record.signal) record.result = JSON.parse(record.stdout); }
    catch (error) { record.parseError = error.message; }
    return record;
  }
  function envelope(record, request, keys) {
    assert.equal(record.error, null); assert.equal(record.signal, null); assert.equal(record.stderr, '');
    const value = record.result;
    exact(value, keys);
    assert.equal(value.format, 'osr47-clipboard-platform-result/1');
    const echo = { ...request }; delete echo.plain; delete echo.html;
    assert.deepEqual(value.request, echo);
    assert.ok(Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0);
    return value;
  }
  function proof(value, expectedOwner = owner) {
    exact(value, ['pid', 'name', 'bundle', 'title', 'role', 'subrole', 'rootFrame', 'windowCount', 'matchCount', 'focused']);
    assert.ok(Number.isSafeInteger(value.pid) && value.pid > 0 && value.pid <= 2147483647);
    assert.equal(value.name, browser === 'chrome' ? 'Google Chrome' : 'Safari');
    assert.equal(value.bundle, browser === 'chrome' ? 'com.google.Chrome' : 'com.apple.Safari');
    assert.equal(value.title, title + (browser === 'chrome' ? ' - Google Chrome' : ''));
    assert.equal(value.role, 'AXWindow'); assert.equal(value.subrole, 'AXStandardWindow');
    assert.equal(value.focused, true); assert.equal(value.matchCount, 1);
    assert.ok(Number.isInteger(value.windowCount) && value.windowCount >= 1 && value.windowCount <= 32);
    rectangle(value.rootFrame);
    if (expectedOwner) { assert.equal(value.pid, expectedOwner.pid); assert.deepEqual(value.rootFrame, expectedOwner.rootFrame); }
  }
  function deadline(record) { assert.ok(record.elapsedMs <= record.request.deadlineMs && record.result.elapsedMs <= record.request.deadlineMs, 'Original helper deadline expired'); }
  function keyResult(record, request) {
    const value = envelope(record, request, ['format', 'request', 'status', 'delivery', 'elapsedMs', 'method', 'programId', 'program', 'postedTransitions', 'postedCount', 'proofs', 'postcondition', 'reason']);
    assert.equal(value.method, 'CGEvent/cghidEventTap');
    const program = expectedProgram(browser, request.action, request.cleanupOnly);
    assert.equal(value.programId, expectedProgramId(browser, request.action, request.cleanupOnly));
    assert.deepEqual(value.program, program);
    assert.ok(Number.isInteger(value.postedCount) && value.postedCount >= 0 && value.postedCount <= program.length);
    assert.deepEqual(value.postedTransitions, program.slice(0, value.postedCount));
    assert.ok(Array.isArray(value.proofs)); assert.equal(value.proofs.length, value.postedCount);
    value.proofs.forEach(p => proof(p, { pid: request.pid, rootFrame: request.rootFrame }));
    exact(value.postcondition, ['status', 'proof']);
    if (value.status === 'completed') {
      assert.equal(record.exitCode, 0); assert.equal(value.delivery, 'posted'); assert.equal(value.postedCount, program.length);
      pending = null; // The contextual complete posting fact precedes final phase/deadline checks.
      assert.equal(value.postcondition.status, 'verified'); proof(value.postcondition.proof, { pid: request.pid, rootFrame: request.rootFrame });
      assert.equal(value.reason, null); deadline(record);
      return value;
    }
    assert.equal(record.exitCode, 2);
    if (value.status === 'refused') {
      assert.equal(value.delivery, 'not_sent'); assert.equal(value.postedCount, 0);
      if (!request.cleanupOnly) pending = null;
    } else {
      assert.equal(value.status, 'unknown'); assert.equal(value.delivery, 'unknown/may_have_sent');
      assert.ok(value.postedCount > 0 && value.postedCount < program.length);
    }
    assert.equal(typeof value.reason, 'string');
    throw new Error(value.reason);
  }
  function releaseOwnedKeys() {
    assert.ok(!notifying, 'Evidence callbacks cannot dispatch helper operations');
    if (!pending) return { status: 'not_needed', keysPending: false };
    if (pending.cleanupAttempted) return { status: 'not_repeated', keysPending: true };
    pending.cleanupAttempted = true;
    disabled = true;
    const original = pending.request;
    const request = makeRequest('key', undefined, { pid: original.pid, rootFrame: original.rootFrame, action: original.action, cleanupOnly: true });
    const record = run(request);
    try { keyResult(record, request); const evidence = recorded(record); return { status: 'completed', keysPending: false, record: evidence }; }
    catch (error) { record.validationError = error.message; keep(record); return { status: 'failed', keysPending: pending !== null, record: snapshot(record) }; }
  }
  function key(action, { requestId } = {}) {
    assert.ok(!notifying, 'Evidence callbacks cannot dispatch helper operations');
    assert.ok(owner, 'Inspect the exact owned fixture before input'); assert.ok(!disabled && !pending);
    assert.ok(actions.includes(action), 'Only the five source-literal clipboard shortcuts are accepted');
    const request = makeRequest('key', requestId, { action, cleanupOnly: false });
    pending = { request: structuredClone(request), cleanupAttempted: false };
    const record = run(request);
    try { keyResult(record, request); return recorded(record); }
    catch (error) {
      disabled = true; record.validationError = error.message; keep(record);
      const cleanup = releaseOwnedKeys();
      throw new ClipboardPlatformError(error.message, record, cleanup);
    }
  }
  function inspectOwnedWindow() {
    assert.ok(!notifying, 'Evidence callbacks cannot dispatch helper operations');
    assert.ok(!owner && !disabled && !pending && !inspecting, 'Owned window inspection cannot rebind or retry');
    inspecting = true;
    const request = makeRequest('inspect'); const record = run(request);
    try {
      const value = envelope(record, request, ['format', 'request', 'status', 'delivery', 'elapsedMs', 'proof']);
      assert.equal(record.exitCode, 0); assert.equal(value.status, 'completed'); assert.equal(value.delivery, 'not_sent'); proof(value.proof, null); deadline(record);
      owner = { pid: value.proof.pid, rootFrame: rectangle(value.proof.rootFrame) }; const evidence = recorded(record);
      return { ...structuredClone(owner), record: evidence };
    } catch (error) { disabled = true; record.validationError = error.message; keep(record); throw new ClipboardPlatformError(error.message, record); }
  }
  function formats(value) {
    exact(value, ['plain', 'html']); let total = 0;
    for (const [name, type] of [['plain', 'public.utf8-plain-text'], ['html', 'public.html']]) {
      const entry = value[name]; if (entry === null) continue;
      exact(entry, ['type', 'bytes', 'utf8Base64', 'text']); assert.equal(entry.type, type);
      const raw = scalarText(entry.text); total += raw.length;
      assert.equal(entry.bytes, raw.length); assert.equal(entry.utf8Base64, raw.toString('base64'));
    }
    assert.ok(total <= aggregateLimit);
  }
  function clipboard(operation, extra, requestId) {
    assert.ok(!notifying, 'Evidence callbacks cannot dispatch helper operations');
    assert.ok(owner && !pending); if (operation === 'clipboard-write') assert.ok(!disabled);
    const request = makeRequest(operation, requestId, extra), record = run(request);
    try {
      const value = envelope(record, request, ['format', 'request', 'status', 'delivery', 'elapsedMs', 'changeCountBefore', 'changeCountRead', 'changeCountAfter', 'formats', 'proof', 'cleared', 'reason']);
      assert.equal(record.exitCode, 0); assert.equal(value.status, 'completed');
      assert.equal(value.delivery, operation === 'clipboard-write' ? 'clipboard_written' : 'not_sent');
      assert.equal(value.cleared, operation === 'clipboard-write'); assert.equal(value.reason, null);
      for (const field of ['changeCountBefore', 'changeCountRead', 'changeCountAfter']) assert.ok(Number.isSafeInteger(value[field]));
      assert.equal(value.changeCountRead, value.changeCountAfter); formats(value.formats); proof(value.proof); deadline(record);
      if (operation === 'clipboard-write') for (const name of ['plain', 'html']) assert.equal(value.formats[name]?.text ?? null, extra[name], 'Literal write/read scalar bytes differ; no normalization is accepted');
      return recorded(record);
    } catch (error) { disabled = true; record.validationError = error.message; keep(record); throw new ClipboardPlatformError(error.message, record); }
  }
  return Object.freeze({ inspectOwnedWindow, key, releaseOwnedKeys,
    writeClipboard(value, { requestId } = {}) {
      exact(value, ['plain', 'html']); let total = 0, present = 0;
      for (const text of Object.values(value)) if (text !== null) { total += scalarText(text).length; present++; }
      assert.ok(present > 0 && total <= aggregateLimit);
      return clipboard('clipboard-write', value, requestId);
    },
    readClipboard: ({ requestId } = {}) => clipboard('clipboard-read', {}, requestId),
    resources: () => ({ keysPending: pending !== null, cleanupAttempted: pending?.cleanupAttempted ?? false, disabled, inspected: owner !== null, records: records.length }),
    records: () => records.slice()
  });
}
