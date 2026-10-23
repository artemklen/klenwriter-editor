// SPDX-License-Identifier: MIT OR Apache-2.0
// Controlled host actions over the isolated source-bound SDK/DOM composition.
import { createEditor, loadSdkV2, sdkBuildId, mountEditor, kwdjBasicRenderers, kwdjCommand } from '/failure-runtime/sdk.js';
import { failureArmTrap, SdkSessionV2 as RawFixtureSession } from '/failure-runtime/editor_wasm.js';

const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const check = (value, message) => { if (!value) throw Error(message); };
const encoder = new TextEncoder(), storageKey = 'editor-failure-recovery/1';
const realm = crypto.randomUUID(), instances = new Set();
const runtimeErrors = [], rawCall = RawFixtureSession.prototype.call;
const nativeDetaches = [], nativeDetachIds = new WeakMap();
let nextNativeDetachId = 0, nativeDetachOverflow = false;
const rawDetach = RawFixtureSession.prototype.__destroy_into_raw;
check(typeof rawDetach === 'function', 'Actual generated pure-JS detacher required');
RawFixtureSession.prototype.__destroy_into_raw = function (...args) {
  const pointerBefore = this.__wbg_ptr;
  const returnedPointer = Reflect.apply(rawDetach, this, args);
  if (!nativeDetachIds.has(this)) nativeDetachIds.set(this, ++nextNativeDetachId);
  const observation = { nativeId: nativeDetachIds.get(this), pointerBefore, returnedPointer, pointerAfter: this.__wbg_ptr };
  if (nativeDetaches.length < 32) nativeDetaches.push(observation); else nativeDetachOverflow = true;
  return returnedPointer;
};
RawFixtureSession.prototype.call = function (...args) {
  try { return Reflect.apply(rawCall, this, args); }
  catch (error) {
    const stack = typeof error?.stack === 'string' ? error.stack : null;
    check(stack === null || stack.length <= 65536, 'Keep complete bounded fixture stack');
    runtimeErrors.push({ actualRuntimeError: error instanceof WebAssembly.RuntimeError, name: error?.name ?? null, stack });
    throw error;
  }
};
const originalInstantiate = WebAssembly.instantiate;
WebAssembly.instantiate = async function (...args) {
  const result = await Reflect.apply(originalInstantiate, WebAssembly, args);
  const instance = result.instance ?? result;
  check(instance instanceof WebAssembly.Instance, 'Actual fixture WASM instance required'); instances.add(instance);
  return result;
};
let loaded;
try { loaded = await loadSdkV2(); }
finally { WebAssembly.instantiate = originalInstantiate; }
check(instances.size === 1, 'Exactly one actual instantiation in this fresh realm');
const nativeBaseline = JSON.parse(loaded.resourceCounts());
const memory = [...instances][0].exports.memory;
check(memory instanceof WebAssembly.Memory, 'Actual instance memory required');
const optionsTemplate = await fetch('/failure-contract/options.json').then(r => { check(r.ok, 'Options fixture'); return r.json(); });
const healthy = await fetch('/failure-contract/healthy.json').then(r => { check(r.ok, 'Healthy fixture'); return r.text(); });
const saved = sessionStorage.getItem(storageKey), recovery = saved ? JSON.parse(saved) : null;
if (recovery) {
  check(recovery.format === 'editor-failure-recovery/1' && typeof recovery.canonical === 'string'
    && recovery.canonical.length <= 65536 && typeof recovery.oldRealm === 'string' && recovery.oldRealm !== realm
    && typeof recovery.durable === 'string' && recovery.durable.length <= 65536
    && typeof recovery.hostUnsaved === 'boolean' && typeof recovery.unresolved === 'boolean', 'Closed external recovery packet');
}
const options = { ...optionsTemplate, build_id: sdkBuildId };
const element = document.querySelector('#failure-editor'), status = document.querySelector('#failure-status');
let editor, peer, hostCoherent = recovery?.canonical ?? healthy;
let hostUnsaved = recovery?.hostUnsaved ?? false, provisional = recovery?.provisional ?? null;
let archivedProvisional = recovery?.archivedProvisional ?? null;
let unresolved = recovery?.unresolved ?? false, durable = recovery?.durable ?? healthy;
let pendingSaveJob = recovery?.pendingSaveJob ?? null, oldSaveCompletion = recovery?.oldSaveCompletion ?? null;
let nativeSubmissions = 0, snapshotReleaseCount = 0, saveAcks = 0, oldCallbacksDropped = recovery?.oldCallbacksDropped ?? 0;
const callbacks = [], refusals = [], recoveries = [];
const complete = async ticket => ticket?.status === 'queued' ? ticket.completion : ticket?.response ?? ticket;
const send = async request => { nativeSubmissions++; return complete(editor.submit(request)); };
function persistRecovery() {
  const packet = { format: 'editor-failure-recovery/1', canonical: hostCoherent, provisional, archivedProvisional,
    unresolved, hostUnsaved, durable, oldRealm: recovery?.oldRealm ?? realm,
    pendingSaveJob, oldSaveCompletion, oldCallbacksDropped };
  const text = JSON.stringify(packet); check(encoder.encode(text).byteLength <= 262144, 'Bounded external host recovery packet');
  sessionStorage.setItem(storageKey, text);
}
function nativeState() {
  const response = editor.read({ kind: 'state' });
  check(response.status === 'ok', 'Native state available'); return response.value.state;
}
function allNodes() {
  const state = nativeState(), found = [], pending = [state.root];
  for (let index = 0; index < pending.length; index++) {
    check(index < 32, 'Fixed fixture node bound');
    const response = editor.read({ kind: 'node', stamp: editor.capture(), node: pending[index] });
    check(response.status === 'ok', 'Native node available'); found.push(response.value.node);
    pending.push(...response.value.node.children);
  }
  return found;
}
async function exportCoherent() {
  const snapshot = await send({ kind: 'snapshot', stamp: editor.capture(), max_bytes: 65536 });
  check(snapshot.status === 'ok' && snapshot.value.kind === 'snapshot', 'Coherent snapshot');
  const canonical = snapshot.value.canonical_json;
  const released = await send({ kind: 'release_snapshot', handle: snapshot.value.handle });
  check(released.status === 'ok', 'Actual snapshot release'); snapshotReleaseCount++;
  hostCoherent = canonical; return { canonical, stamp: clone(snapshot.value.stamp) };
}
editor = mountEditor({ element, editor: { input: encoder.encode(hostCoherent), options, loader: async () => loaded },
  renderers: kwdjBasicRenderers, onRecovery: packet => recoveries.push(packet), onRefusal: value => refusals.push(clone(value)) });
const ready = await editor.ready;
check(ready.status === 'ready', 'Matching fixture SDK/DOM/profile must mount');
editor.subscribe(event => callbacks.push(clone(event)));
const peerInput = encoder.encode(healthy);
peer = createEditor({ input: peerInput, options, loader: async () => loaded });
check((await peer.ready).status === 'ok', 'Peer actual Session');
status.textContent = recovery ? 'Recovered; unsaved' : 'Ready';
const hostView = () => ({ realm, timeOrigin: performance.timeOrigin, recoveredFrom: recovery?.oldRealm ?? null,
  actualInstances: instances.size, nativeBaseline: clone(nativeBaseline), memoryBytes: memory.buffer.byteLength, fixtureBuildId: sdkBuildId,
  hostUnsaved, unresolved, provisional: clone(provisional), archivedProvisional: clone(archivedProvisional),
  pendingSaveJob: clone(pendingSaveJob), oldSaveCompletion: clone(oldSaveCompletion),
  recoveryPacketRetained: sessionStorage.getItem(storageKey) !== null,
  coherent: hostCoherent, durable, nativeSubmissions, snapshotReleaseCount, saveAcks, oldCallbacksDropped,
  lifecycle: editor.lifecycle, contenteditable: element.getAttribute('contenteditable'), domText: element.textContent,
  callbacks: clone(callbacks), refusals: clone(refusals), recoveryNotifications: recoveries.length,
  runtimeErrors: clone(runtimeErrors),
  nativeDetaches: clone(nativeDetaches), nativeDetachOverflow,
  nativeResources: clone(editor.nativeResources()),
  resources: clone(editor.resources()), peerResources: clone(peer.resources()) });
async function insert(text) {
  const leaf = allNodes().find(node => node.text !== null); check(leaf, 'Actual leaf');
  const selection = { anchor: { kind: 'text', node: leaf.id, offset: 0, affinity: 'after' },
    focus: { kind: 'text', node: leaf.id, offset: 0, affinity: 'after' } };
  check((await send({ kind: 'set_selection', stamp: editor.capture(), selection })).status === 'ok', 'Directed selection');
  return send({ kind: 'command', stamp: editor.capture(), command: kwdjCommand({ kind: 'insert_text', text }), history_hint: { kind: 'isolated' } });
}
document.querySelector('#failure-recover').addEventListener('click', () => {
  check(editor.lifecycle === 'fatal', 'Recovery is explicit after terminal failure');
  persistRecovery();
  location.reload();
});
globalThis.failureRuntimeFixture = Object.freeze({
  ready: true,
  inspect: hostView,
  async checkpoint() {
    const exported = await exportCoherent();
    return { state: clone(nativeState()), canonical: exported.canonical,
      host: hostView(), native: clone(editor.nativeResources()) };
  },
  async edit(text) {
    const response = await insert(text); check(response.status === 'ok', 'Actual edit'); hostUnsaved = true;
    await exportCoherent(); status.textContent = 'Unsaved'; return { response: clone(response), host: hostView() };
  },
  async holdDelayedSave() {
    check(editor.lifecycle === 'ready' && !pendingSaveJob, 'One actual delayed controlled Save job');
    const response = await send({ kind: 'snapshot', stamp: editor.capture(), max_bytes: 65536 });
    check(response.status === 'ok' && response.value.kind === 'snapshot', 'Actual retained Save receipt');
    check(response.value.canonical_json === hostCoherent, 'Save job retains the coherent document');
    pendingSaveJob = { format: 'editor-failure-delayed-save/1', originRealm: realm,
      receipt: clone(response.value), acknowledgeRequest: { kind: 'acknowledge_snapshot',
        stamp: clone(response.value.stamp), handle: response.value.handle } };
    return { job: clone(pendingSaveJob), host: hostView(), native: clone(editor.nativeResources()) };
  },
  async trap(phase, text = 'Y') {
    await exportCoherent();
    check(failureArmTrap(phase), 'Fixed compiled trap armed once');
    provisional = { attemptedText: text, nativeOutcome: 'unknown', ownership: 'host', source: 'controlled_command_input' };
    unresolved = true; hostUnsaved = true;
    const response = await insert(text);
    check(response.status === 'fatal', 'Compiled trap must be Fatal');
    status.textContent = 'Failed; coherent and attempted input retained';
    return { response: clone(response), witness: JSON.parse(globalThis.__failureRuntimeWitness), host: hostView() };
  },
  peerAfterRetirement() { return { response: clone(peer.read({ kind: 'state' })), resources: clone(peer.resources()) }; },
  retainedProjectionAfterRetirement() {
    try { new loaded.Session(encoder.encode(healthy), JSON.stringify(options)); return { opened: true }; }
    catch (error) { return { opened: false, code: error.code ?? null }; }
  },
  async loadAfterRetirement() {
    try { await loadSdkV2(); return { loaded: true }; }
    catch (error) { return { loaded: false, code: error.code ?? null }; }
  },
  async completeDelayedSave() {
    check(pendingSaveJob?.format === 'editor-failure-delayed-save/1', 'Completion belongs to the actual retained Save job');
    const job = clone(pendingSaveJob);
    // This is a controlled host completion, not a durable persistence service.
    // Check the actual captured job's lifecycle before any native submit: serial
    // handles and Session stamps alone cannot authorize work across realms.
    if (job.originRealm !== realm || editor.lifecycle !== 'ready') {
      oldCallbacksDropped++;
      oldSaveCompletion = { status: 'stale_host_context', dispatched: false, job };
      persistRecovery();
      return { ...clone(oldSaveCompletion), host: hostView() };
    }
    if (unresolved) return { status: 'host_refused', code: 'host.unresolved_recovery', dispatched: false, job, host: hostView() };
    let response;
    try {
      response = await send(job.acknowledgeRequest);
      check(response.status === 'ok', 'Current captured Save receipt acknowledgement');
      durable = job.receipt.canonical_json; saveAcks++; hostUnsaved = nativeState().dirty;
    } finally {
      check((await send({ kind: 'release_snapshot', handle: job.receipt.handle })).status === 'ok', 'Captured Save receipt release');
      snapshotReleaseCount++;
    }
    pendingSaveJob = null;
    if (hostUnsaved || unresolved) persistRecovery(); else sessionStorage.removeItem(storageKey);
    return { status: 'saved', dispatched: true, job, response: clone(response), host: hostView() };
  },
  retainProvisionalSeparately() {
    check(unresolved && provisional, 'Explicit resolution requires pending data');
    archivedProvisional = provisional; provisional = null; unresolved = false;
    persistRecovery();
    return hostView();
  },
  async save() {
    if (unresolved) return { status: 'host_refused', code: 'host.unresolved_recovery', host: hostView() };
    const snapshot = await send({ kind: 'snapshot', stamp: editor.capture(), max_bytes: 65536 });
    check(snapshot.status === 'ok', 'Fresh snapshot');
    try {
      // Controlled successful host persistence, separate from the native baseline.
      durable = snapshot.value.canonical_json;
      persistRecovery();
      const ack = await send({ kind: 'acknowledge_snapshot', stamp: editor.capture(), handle: snapshot.value.handle });
      check(ack.status === 'ok', 'Matching current receipt acknowledgement'); saveAcks++;
    } finally {
      check((await send({ kind: 'release_snapshot', handle: snapshot.value.handle })).status === 'ok', 'Receipt release');
      snapshotReleaseCount++;
    }
    hostUnsaved = false; sessionStorage.removeItem(storageKey); status.textContent = 'Saved';
    return { status: 'saved', host: hostView(), state: clone(nativeState()) };
  },
  async dispose() {
    const receipt = editor.destroy(); await complete(receipt.sdk); await complete(peer.destroy());
    return { host: hostView(), recovery: { originalBytes: receipt.recovery?.originalInput?.byteLength ?? 0,
      regionKind: receipt.recovery?.region?.kind ?? null }, native: editor.nativeResources() };
  },
});
globalThis.failureRuntimeReady = true;
