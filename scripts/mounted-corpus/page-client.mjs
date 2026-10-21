// SPDX-License-Identifier: MIT OR Apache-2.0
/** Case-bound public mounted observations. Expectations remain in the collector. */
import { loadSdkV2, sdkAbiV2, sdkBuildId } from '@klenwriter/editor-sdk';
import { mountEditor } from '@klenwriter/editor-dom';
import { kwdjCommand } from '@klenwriter/editor-kwdj';
import { kwdjBasicRenderers } from '@klenwriter/editor-kwdj/dom';
import {
  PROTOCOL_VERSION, ACCEPTED_SOURCE, LITERAL_AUTHORING_SOURCE, ENGINES, BUDGETS, COMMAND_IDS,
  nativeResourceCounts, ownBoundedData,
} from '/mounted-corpus-protocol.mjs';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const CONTRACT_FILES = Object.freeze({
  manifest: 'manifest.json', literals: 'initial-literals.json',
  observationSchema: 'observation.schema.json', bindingSchema: 'run-binding.schema.json',
});
const DEFAULT_PROFILE_OPTIONS = JSON.stringify({ identities: { media: [], references: [] }, limits: null });
function identical(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.keys(a).sort(), right = Object.keys(b).sort();
  return left.length === right.length && left.every((key, i) => key === right[i] && identical(a[key], b[key]));
}
const owned = value => ownBoundedData(value).value;

class DriverStop extends Error {
  constructor(status, message, phase = null) {
    super(message); this.name = 'DriverStop'; this.status = status; this.phase = phase;
  }
}

const isTypedProductStop = error => error instanceof DriverStop && ['native_refused', 'native_fatal', 'dom_refused'].includes(error.status);

function failure(error) {
  const descriptor = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'message') : null;
  const message = descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
    ? descriptor.value : 'Thrown value has no owned string message';
  return message.length <= 4096
    ? { code: error instanceof DriverStop ? `mounted-corpus.${error.status}` : 'mounted-corpus.thrown', message }
    : { code: 'mounted-corpus.error_message_limit', message: `Unretained error message exceeds4096 units (${message.length})` };
}

async function within(promise, milliseconds, phase) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new DriverStop('timeout', `Deadline reached in ${phase}`, phase)), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function byteFact(bytes, limit = BUDGETS.inputBytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > limit) throw new DriverStop('capture_error', 'Byte observation exceeds its frozen limit');
  const copy = bytes.slice(), utf8 = decoder.decode(copy), encoded = encoder.encode(utf8);
  if (encoded.length !== copy.length || encoded.some((byte, i) => byte !== copy[i])) throw new DriverStop('capture_error', 'UTF8 observation does not preserve original bytes');
  return { utf8, bytes: copy.byteLength, sha256: await sha256(copy) };
}

async function fetchRecord(url, path, parse = true) {
  const registryPacket = url === '/extensions-packet.json' && path === 'artifacts/extensions/packet.json';
  const maximumBytes = registryPacket ? BUDGETS.registryPacketBytes : BUDGETS.observationBytes;
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), BUDGETS.readyMs);
  try {
    const response = await fetch(url, { cache: 'no-store', signal: abort.signal });
    if (!response.ok || !response.body) throw new DriverStop('capture_error', `Contract response unavailable: ${path}`);
    const reader = response.body.getReader(), chunks = []; let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) { await reader.cancel(); throw new DriverStop('capture_error', `Contract bytes exceed bound: ${path}`); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = decoder.decode(bytes);
    const parsed = parse ? JSON.parse(text) : null;
    // Pin and parse the complete shared packet. Only this lane's public factory
    // options are owned as bounded data; unrelated fixture trees remain external.
    const selected = registryPacket ? { kwdjProfile: parsed.kwdjProfile, kwdjRegistryJson: parsed.kwdjRegistryJson } : parsed;
    return { value: parse ? ownBoundedData(selected, maximumBytes).value : null, pin: { path, bytes: length, sha256: await sha256(bytes) } };
  } finally { clearTimeout(timer); }
}

/** Only the frozen JSON-schema vocabulary needed by the closed RunBinding. */
function validateBindingShape(value, schema, root = schema, path = 'runBinding') {
  if (schema.$ref) return validateBindingShape(value, schema.$ref.slice(2).split('/').reduce((node, key) => node[key], root), root, path);
  if (schema.oneOf) {
    let matches = 0;
    for (const branch of schema.oneOf) { try { validateBindingShape(value, branch, root, path); matches++; } catch { /* Count alternatives, never repair values. */ } }
    if (matches !== 1) throw new DriverStop('capture_error', `Invalid closed binding alternative: ${path}`);
    return;
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const || schema.enum && !schema.enum.includes(value)) throw new DriverStop('capture_error', `Invalid binding value: ${path}`);
  if (schema.type === 'null' && value !== null || schema.type === 'boolean' && typeof value !== 'boolean') throw new DriverStop('capture_error', `Invalid binding type: ${path}`);
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DriverStop('capture_error', `Invalid binding object: ${path}`);
    const properties = schema.properties ?? {};
    if ((schema.required ?? []).some(key => !Object.hasOwn(value, key)) || schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(properties, key))) throw new DriverStop('capture_error', `Invalid closed binding keys: ${path}`);
    for (const key of Object.keys(value)) if (properties[key]) validateBindingShape(value[key], properties[key], root, `${path}.${key}`);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || schema.maxItems !== undefined && value.length > schema.maxItems || schema.minItems !== undefined && value.length < schema.minItems) throw new DriverStop('capture_error', `Invalid binding array: ${path}`);
    for (let i = 0; i < value.length; i++) validateBindingShape(value[i], schema.items, root, `${path}[${i}]`);
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || schema.maxLength !== undefined && [...value].length > schema.maxLength || schema.pattern && !new RegExp(schema.pattern).test(value)) throw new DriverStop('capture_error', `Invalid binding string: ${path}`);
  } else if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0) || schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum) throw new DriverStop('capture_error', `Invalid binding integer: ${path}`);
  }
}

function readEngine() {
  const entries = [...new URL(location.href).searchParams.entries()];
  if (entries.length !== 1 || entries[0][0] !== 'engine' || !ENGINES.includes(entries[0][1])) throw new DriverStop('capture_error', 'Exactly one known engine query parameter is required');
  return entries[0][1];
}

function moduleSample(module) {
  const sample = { source: 'module.resourceCounts', timing: 'before_owner_construction', rawJson: null, value: null, validation: 'invalid' };
  const raw = module.resourceCounts();
  if (typeof raw !== 'string' || encoder.encode(raw).byteLength > BUDGETS.inputBytes) return sample;
  sample.rawJson = raw;
  try { sample.value = owned(nativeResourceCounts(JSON.parse(raw))); sample.validation = 'valid'; } catch { /* Original raw text is retained. */ }
  return sample;
}

function mountedSample(editor) {
  const sample = { source: 'mounted.nativeResources', timing: 'after_destroy_settlement', rawJson: null, value: null, validation: 'invalid' };
  const actual = editor.nativeResources();
  if (actual === null) { sample.validation = 'null'; return sample; }
  try {
    const serialized = ownBoundedData(actual, BUDGETS.inputBytes);
    // This is a derived encoding of the public getter's object, not native wire text.
    sample.rawJson = serialized.json;
    sample.value = owned(nativeResourceCounts(serialized.value)); sample.validation = 'valid';
  } catch { /* No invalid value is substituted with a zero map. */ }
  return sample;
}

async function initialize() {
  const engine = readEngine();
  const entries = await Promise.all(Object.entries(CONTRACT_FILES).map(async ([key, file]) => [key, await fetchRecord(`/mounted-corpus-contract/${file}`, `contracts/mounted-e2e/v1/${file}`)]));
  const contracts = Object.fromEntries(entries);
  const [packet, protocol, module] = await Promise.all([
    fetchRecord('/extensions-packet.json', 'artifacts/extensions/packet.json'),
    fetchRecord('/mounted-corpus-protocol.mjs', 'scripts/mounted-corpus/protocol.mjs', false), within(loadSdkV2(), BUDGETS.readyMs, 'ready'),
  ]);
  const manifest = contracts.manifest.value, literals = contracts.literals.value;
  if (manifest.protocol !== PROTOCOL_VERSION || manifest.acceptedSource !== ACCEPTED_SOURCE || literals.protocol !== PROTOCOL_VERSION || literals.acceptedSource !== LITERAL_AUTHORING_SOURCE || module.manifest.build_id !== sdkBuildId) throw new DriverStop('capture_error', 'Module/source/contract binding mismatch');
  const rows = new Map();
  for (const row of manifest.rows.filter(row => row.initial)) {
    if (rows.has(row.rowId)) throw new DriverStop('capture_error', 'Duplicate initial row');
    rows.set(row.rowId, row);
  }
  if (rows.size !== 25) throw new DriverStop('capture_error', 'Frozen initial inventory is not25');
  const positive = new Map(literals.positiveCases.map(value => [value.caseId, value]));
  const negative = new Map(literals.negativeCases.map(value => [value.caseId, value]));
  const nativeBaseline = moduleSample(module);
  if (nativeBaseline.validation !== 'valid') throw new DriverStop('capture_error', 'Initial native baseline unavailable');
  const options = owned({ abi: sdkAbiV2, build_id: sdkBuildId, profile: packet.value.kwdjProfile, admission: 'validate', access: 'editable', registry_json: packet.value.kwdjRegistryJson, profile_options_json: DEFAULT_PROFILE_OPTIONS });
  return { engine, module, options, rows, positive, negative, contracts, pins: [...Object.values(contracts).map(record => record.pin), packet.pin, protocol.pin], nativeBaseline };
}

/** Shared row-local budgets/ordinals for trusted route modules, never a window service. */
export function createRecorder({ runId, engine }) {
  if (typeof runId !== 'string' || !runId || runId.length > 256 || !ENGINES.includes(engine)) throw new DriverStop('capture_error', 'Invalid recorder identity');
  const recorder = { runId, engine, owners: [], errors: [], cspViolations: [], phase: 'ready', ordinal: 0, calls: 0, nodes: 0, deadline: performance.now() + BUDGETS.caseMs, captureFailure: null, disposed: false };
  recorder.check = () => {
    if (recorder.captureFailure) throw recorder.captureFailure;
    if (performance.now() >= recorder.deadline) throw new DriverStop('timeout', 'Case deadline reached', recorder.phase);
  };
  recorder.addError = error => {
    if (recorder.errors.length >= BUDGETS.errors) { recorder.captureFailure = new DriverStop('capture_error', 'Error record budget exceeded'); return; }
    recorder.errors.push(failure(error));
  };
  const onError = event => recorder.addError(new DriverStop('thrown', typeof event.message === 'string' ? event.message : 'Uncaught browser error'));
  const onRejection = event => recorder.addError(event.reason);
  const onCsp = event => {
    if (recorder.cspViolations.length >= BUDGETS.cspViolations) { recorder.captureFailure = new DriverStop('capture_error', 'CSP record budget exceeded'); return; }
    try {
      recorder.cspViolations.push(owned({ effectiveDirective: event.effectiveDirective, blockedURI: event.blockedURI, disposition: event.disposition, sourceFile: event.sourceFile, lineNumber: event.lineNumber, columnNumber: event.columnNumber }));
    } catch (error) { recorder.captureFailure = new DriverStop('capture_error', failure(error).message); }
  };
  window.addEventListener('error', onError); window.addEventListener('unhandledrejection', onRejection); document.addEventListener('securitypolicyviolation', onCsp);
  recorder.dispose = () => { if (!recorder.disposed) { recorder.disposed = true; window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); document.removeEventListener('securitypolicyviolation', onCsp); } };
  return recorder;
}

export async function serializeSubmission(submission, phase) {
  if (submission.status === 'dom_refused') return owned(submission);
  if (submission.status === 'completed') return { status: 'completed', response: owned(submission.response) };
  if (submission.status === 'queued') return { status: 'queued', completion: owned(await within(submission.completion, BUDGETS.submissionMs, phase)) };
  throw new DriverStop('capture_error', 'Unknown original submission branch', phase);
}

async function serializeRecovery(packet, owner) {
  if (packet === null) return null;
  const result = { originalInput: packet.originalInput === null ? null : await byteFact(packet.originalInput), region: null };
  if (packet.region !== null) {
    if (packet.region.kind === 'retained_dom') {
      result.region = { kind: packet.region.kind, reason: packet.region.reason, ownership: packet.region.ownership, elementToken: packet.region.element === owner.element ? owner.record.elementToken : `${owner.record.elementToken}:retained-foreign-element` };
      owner.recorder.captureFailure = new DriverStop('capture_error', 'Retained DOM recovery capability is outside the initial measurement route');
    } else result.region = owned(packet.region);
  }
  if (Object.hasOwn(packet, 'composition')) {
    if (packet.composition === null) result.composition = null;
    else {
      const composition = packet.composition;
      const unapplied = composition.unappliedInput?.kind === 'retained_event'
        ? { kind: 'retained_event', reason: composition.unappliedInput.reason, ownership: composition.unappliedInput.ownership, eventToken: `${owner.record.elementToken}:retained-event` }
        : composition.unappliedInput;
      result.composition = { ...owned({ ...composition, submission: null, unappliedInput: unapplied }), submission: composition.submission === null ? null : await serializeSubmission(composition.submission, 'capture') };
      owner.recorder.captureFailure = new DriverStop('capture_error', 'Composition recovery capability is outside the initial measurement route');
    }
  }
  return result;
}

async function serializeReady(ready, owner) {
  if (ready.status === 'ready') return owned(ready);
  const result = { ...owned({ ...ready, recovery: null }), recovery: await serializeRecovery(ready.recovery, owner) };
  return result;
}

/** Returns the real mounted capability and a separate serializable observation. */
export async function openOwner({ recorder, module, options, input, host, elementToken }) {
  recorder.check();
  if (recorder.owners.length >= BUDGETS.owners || !(host instanceof HTMLElement) || typeof elementToken !== 'string' || !elementToken || elementToken.length > 256) throw new DriverStop('capture_error', 'Invalid or excessive owner construction');
  const bytes = input.slice(), inputFact = await byteFact(bytes), nativeBefore = moduleSample(module);
  if (nativeBefore.validation !== 'valid') throw new DriverStop('capture_error', 'Native preconstruction sample unavailable');
  const element = document.createElement('div'); element.dataset.mountedCorpusOwner = elementToken; element.setAttribute('aria-label', `Corpus editor ${recorder.owners.length + 1}`); host.appendChild(element);
  const record = { elementToken, mountOrdinal: ++recorder.ordinal, destroyOrdinal: null, input: inputFact, originalInputBeforeDestroy: null, originalInputAfterDestroy: null, ready: null, context: null, calls: [], events: [], snapshots: [], destroy: null, resourcesBefore: null, resourcesAfter: null, nativeBefore, nativeAfter: null };
  const owner = { recorder, module, element, record, editor: null, unsubscribe: null, ui: null, closeAttempted: false, destroyed: false };
  recorder.owners.push(owner);
  owner.editor = mountEditor({ element, editor: { input: bytes, options, loader: () => Promise.resolve(module) }, renderers: kwdjBasicRenderers });
  const actualReady = await within(owner.editor.ready, BUDGETS.readyMs, recorder.phase);
  record.ready = await serializeReady(actualReady, owner); record.context = owned(owner.editor.context());
  record.resourcesBefore = { mounted: owned(owner.editor.resources()), ui: null };
  if (actualReady.status === 'ready') {
    const subscription = owner.editor.subscribe(event => {
      if (record.events.length >= BUDGETS.events) { recorder.captureFailure = new DriverStop('capture_error', 'Event observation budget exceeded'); return; }
      try { record.events.push(owned(event)); } catch (error) { recorder.captureFailure = new DriverStop('capture_error', failure(error).message); }
    });
    if (typeof subscription !== 'function') throw new DriverStop('dom_refused', 'Public event subscription refused');
    owner.unsubscribe = subscription;
  }
  recorder.check();
  return owner;
}

function terminal(result) { return result?.status === 'completed' ? result.response : result?.status === 'queued' ? result.completion : result; }

export function requireReply(result, kind, phase) {
  const response = terminal(result);
  if (response?.status === 'dom_refused') throw new DriverStop('dom_refused', response.diagnostic.code, phase);
  if (response?.status === 'refused' || response?.status === 'fatal') throw new DriverStop(response.status === 'refused' ? 'native_refused' : 'native_fatal', response.diagnostic.code, phase);
  if (response?.status !== 'ok' || response.value.kind !== kind) throw new DriverStop('capture_error', `Expected original ${kind} reply`, phase);
  return response.value;
}

export async function call(owner, label, method, request) {
  const { recorder, record, editor } = owner; recorder.check();
  if (recorder.calls >= BUDGETS.calls) throw new DriverStop('capture_error', 'Call budget exceeded');
  const capture = owned(editor.capture()), context = owned(editor.context()), actualRequest = owned(request);
  recorder.calls++;
  if (!['read', 'query', 'submit'].includes(method)) throw new DriverStop('capture_error', 'Unknown trusted public method');
  const index = record.calls.length, observation = { label, method, capture, context, request: actualRequest, result: null };
  record.calls.push(observation);
  const raw = editor[method](actualRequest);
  observation.result = method === 'submit' ? await serializeSubmission(raw, recorder.phase) : owned(raw);
  recorder.check();
  return { index, result: observation.result };
}

/** Complete bounded public shallow reads; returned path map is local capability data. */
export async function readTree(owner, { stateLabel, nodeLabel }) {
  const state = requireReply((await call(owner, stateLabel, 'read', { kind: 'state' })).result, 'state', owner.recorder.phase).state;
  const nodes = new Map(), stack = [{ id: state.root, path: [] }];
  while (stack.length) {
    if (++owner.recorder.nodes > BUDGETS.nodes) throw new DriverStop('capture_error', 'Public node observation budget exceeded');
    const next = stack.pop(), node = requireReply((await call(owner, nodeLabel, 'read', { kind: 'node', stamp: state.stamp, node: next.id })).result, 'node', owner.recorder.phase).node;
    nodes.set(next.path.join('/'), node);
    for (let i = node.children.length - 1; i >= 0; i--) {
      if (stack.length + owner.recorder.nodes >= BUDGETS.nodes) throw new DriverStop('capture_error', 'Public child observation budget exceeded');
      stack.push({ id: node.children[i], path: [...next.path, i] });
    }
  }
  if (!identical(owner.editor.capture(), state.stamp)) throw new DriverStop('capture_error', 'Whole stamp changed during public tree reads');
  return { state, nodes };
}

/** Save exact observed UTF8, explicitly release its original handle, retain both calls. */
export async function snapshotAndRelease(owner, { snapshotLabel, releaseLabel }) {
  const stamp = owner.editor.capture();
  if (stamp === null) throw new DriverStop('capture_error', 'No current stamp for snapshot');
  const snapshot = await call(owner, snapshotLabel, 'submit', { kind: 'snapshot', stamp, max_bytes: BUDGETS.snapshotBytes });
  const value = requireReply(snapshot.result, 'snapshot', owner.recorder.phase), bytes = encoder.encode(value.canonical_json);
  owner.recorder.phase = owner.recorder.phase.startsWith('fresh') ? 'fresh-release' : 'release';
  const release = await call(owner, releaseLabel, 'submit', { kind: 'release_snapshot', handle: value.handle });
  if (owner.record.snapshots.length >= BUDGETS.snapshots) throw new DriverStop('capture_error', 'Snapshot record budget exceeded');
  const fact = await byteFact(bytes, BUDGETS.snapshotBytes);
  owner.record.snapshots.push({ call: snapshot.index, ...fact, releaseCall: release.index });
  requireReply(release.result, 'released', owner.recorder.phase);
  return bytes;
}

/** Single actual destruction attempt, including recovery and actual native samples. */
export async function closeOwner(owner) {
  if (owner.closeAttempted) return owner.record;
  owner.closeAttempted = true;
  if (!owner.editor) { owner.element.remove(); return owner.record; }
  let firstFailure = null;
  const attempt = async action => {
    try { return await action(); }
    catch (error) { firstFailure ??= error; if (!isTypedProductStop(error)) owner.recorder.addError(error); return null; }
  };
  await attempt(() => { owner.unsubscribe?.(); owner.unsubscribe = null; });
  await attempt(async () => {
    const originalInput = owner.editor.originalInput();
    owner.record.originalInputBeforeDestroy = originalInput === null ? null : await byteFact(originalInput);
  });
  // A failed capture or UI settlement must not suppress the mounted destroy call.
  if (owner.ui) await attempt(async () => { const receipt = owner.ui.destroy(); await within(receipt.settled, BUDGETS.destroyMs, 'destroy'); });
  let original = null;
  await attempt(() => { original = owner.editor.destroy(); });
  if (original !== null) {
    owner.record.destroy = { status: original.status, sdk: null, recovery: null, callbackFailure: null };
    await attempt(async () => {
      const sdk = await within(serializeSubmission(original.sdk, 'destroy'), BUDGETS.destroyMs, 'destroy');
      owner.record.destroy.sdk = sdk;
      owner.record.destroyOrdinal = ++owner.recorder.ordinal;
      requireReply(sdk, 'destroyed', 'destroy');
      owner.destroyed = true;
    });
    await attempt(async () => { owner.record.destroy.recovery = await serializeRecovery(original.recovery, owner); });
    await attempt(() => { owner.record.destroy.callbackFailure = owned(original.callbackFailure); });
  }
  await attempt(() => { owner.record.resourcesAfter = { mounted: owned(owner.editor.resources()), ui: owner.ui ? owned(owner.ui.resources()) : null }; });
  await attempt(async () => {
    const remaining = owner.editor.originalInput(); owner.record.originalInputAfterDestroy = remaining === null ? null : await byteFact(remaining);
  });
  await attempt(() => {
    owner.record.nativeAfter = mountedSample(owner.editor);
    if (owner.record.nativeAfter.validation !== 'valid') throw new DriverStop('capture_error', 'Postdestroy native getter is unavailable', 'destroy');
  });
  owner.element.remove();
  if (firstFailure !== null) throw firstFailure;
  return owner.record;
}

async function editSequence(owner, literal, initial) {
  const { edit } = literal, { recorder } = owner;
  const target = initial.nodes.get(edit.target.publicReadPath.join('/'));
  if (!target || target.type_id !== edit.target.expectedTypeId) throw new DriverStop('capture_error', 'Pinned original target role is unavailable');
  const selection = owned(edit.selection.setup.selection);
  for (const endpoint of [selection.anchor, selection.focus]) {
    if (endpoint.node !== '$role.targetText.id') throw new DriverStop('capture_error', 'Unknown frozen selection role');
    endpoint.node = target.id;
  }
  recorder.phase = 'setup';
  requireReply((await call(owner, 'setup-selection', 'submit', { kind: 'set_selection', stamp: owner.editor.capture(), selection })).result, 'mutation', recorder.phase);
  requireReply((await call(owner, 'setup-marks', 'submit', { kind: 'set_stored_marks', stamp: owner.editor.capture(), marks: null })).result, 'mutation', recorder.phase);
  await readTree(owner, { stateLabel: 'prepared-state', nodeLabel: 'prepared-node' });
  const command = kwdjCommand(owned(edit.intent));
  if (!COMMAND_IDS.includes(command.id) || command.id !== edit.commandId) throw new DriverStop('capture_error', 'Intent is outside the frozen command set');
  recorder.phase = 'query-edit';
  const stamp = owned(owner.editor.capture()), context = owned(owner.editor.context());
  const availability = requireReply((await call(owner, 'query-edit', 'query', { kind: 'query_command', stamp, command })).result, 'availability', recorder.phase);
  if (!availability.available) throw new DriverStop('native_refused', 'Exact pinned edit is unavailable', recorder.phase);
  if (!identical(owner.editor.capture(), stamp) || !identical(owner.editor.context(), context)) throw new DriverStop('capture_error', 'Captured edit context changed after query');
  recorder.phase = 'edit';
  requireReply((await call(owner, 'edit', 'submit', { kind: 'command', stamp, command, history_hint: owned(edit.historyHint) })).result, 'mutation', recorder.phase);
  recorder.phase = 'after-edit';
  await readTree(owner, { stateLabel: 'after-edit-state', nodeLabel: 'after-edit-node' });
  await snapshotAndRelease(owner, { snapshotLabel: 'snapshot-edit', releaseLabel: 'release-edit' });
  for (const direction of ['undo', 'redo']) {
    recorder.phase = direction;
    const current = owned(owner.editor.capture());
    const available = requireReply((await call(owner, `query-${direction}`, 'query', { kind: 'query_history', stamp: current, direction })).result, 'availability', direction);
    if (!available.available) throw new DriverStop('native_refused', `Pinned ${direction} is unavailable`, direction);
    if (!identical(owner.editor.capture(), current)) throw new DriverStop('capture_error', `Capture changed after ${direction} query`);
    requireReply((await call(owner, direction, 'submit', { kind: 'history', stamp: current, direction })).result, 'mutation', direction);
    await readTree(owner, { stateLabel: `after-${direction}-state`, nodeLabel: `after-${direction}-node` });
    const saved = await snapshotAndRelease(owner, { snapshotLabel: direction === 'redo' ? 'snapshot-save' : 'snapshot-undo', releaseLabel: direction === 'redo' ? 'release-save' : 'release-undo' });
    if (direction === 'redo') return saved;
  }
  throw new DriverStop('capture_error', 'Final Redo was not reached');
}

function validateRunBinding(binding, setup) {
  const result = ownBoundedData(binding, BUDGETS.runBindingBytes).value;
  validateBindingShape(result, setup.contracts.bindingSchema.value);
  if (result.protocol !== PROTOCOL_VERSION || result.acceptedSource !== ACCEPTED_SOURCE || result.build.buildId !== sdkBuildId || result.corpusIndex.sha256 !== setup.contracts.manifest.value.corpus.indexSha256) throw new DriverStop('capture_error', 'Explicit RunBinding does not match loaded artifacts');
  for (const pin of setup.pins) {
    const matches = result.scenarioPins.filter(candidate => candidate.path === pin.path);
    if (matches.length !== 1 || matches[0].bytes !== pin.bytes || matches[0].sha256 !== pin.sha256) throw new DriverStop('capture_error', `RunBinding scenario pin mismatch: ${pin.path}`);
  }
  if (result.environment.engines.length !== 3 || new Set(result.environment.engines.map(value => value.engine)).size !== 3 || result.nativeBaselines.length !== 3 || new Set(result.nativeBaselines.map(value => value.engine)).size !== 3) throw new DriverStop('capture_error', 'RunBinding must retain all three engine measurements');
  const baseline = result.nativeBaselines.find(value => value.engine === setup.engine);
  if (!baseline || baseline.buildId !== sdkBuildId || baseline.wasmSha256 !== result.build.wasm.sha256 || baseline.sample.validation !== 'valid' || !identical(nativeResourceCounts(baseline.sample.value), setup.nativeBaseline.value)) throw new DriverStop('capture_error', 'Explicit current-engine baseline does not match preflight');
  return result;
}

let active = false;
const setupPromise = initialize();
export const ready = setupPromise.then(setup => owned({ protocol: PROTOCOL_VERSION, acceptedSource: ACCEPTED_SOURCE, engine: setup.engine, userAgent: navigator.userAgent, module: { manifest: setup.module.manifest, buildId: sdkBuildId }, nativeBaseline: setup.nativeBaseline, contractPins: setup.pins }));

/** Trusted interaction module capabilities; never installed on the window facade. */
export async function interactionSetup(explicitBinding) {
  const setup = await setupPromise;
  validateRunBinding(explicitBinding, setup);
  return { engine: setup.engine, module: setup.module, options: setup.options, nativeBaseline: setup.nativeBaseline };
}

export async function run(rowId, explicitRunBinding) {
  if (active) throw new DriverStop('capture_error', 'Another row is active');
  active = true;
  let recorder;
  try {
    const setup = await setupPromise, binding = validateRunBinding(explicitRunBinding, setup), row = setup.rows.get(rowId);
    if (!row) throw new DriverStop('capture_error', 'Row ID is outside the frozen initial25');
    const literal = (row.branch === 'positive' ? setup.positive : setup.negative).get(row.caseId);
    if (!literal || row.branch === 'positive' && row.stage === 'editor_edit_save_reopen' && !literal.edit) throw new DriverStop('capture_error', 'Frozen case binding is absent');
    const actualInput = await byteFact(encoder.encode(literal.input.utf8));
    if (actualInput.bytes !== literal.input.bytes || actualInput.sha256 !== literal.input.sha256) throw new DriverStop('capture_error', 'Frozen input bytes/hash mismatch');
    const currentNative = moduleSample(setup.module);
    if (currentNative.validation !== 'valid' || !identical(currentNative.value, setup.nativeBaseline.value)) throw new DriverStop('capture_error', 'Native resources differ from the frozen owner-free baseline');
    recorder = createRecorder({ runId: binding.runId, engine: setup.engine });
    const observation = { protocol: PROTOCOL_VERSION, runId: binding.runId, engine: setup.engine, rowId, caseId: row.caseId, stage: row.stage, branch: row.branch, route: row.branch === 'expected_admission_refusal' ? 'native-admission-refusal' : row.stage === 'editor_edit_save_reopen' ? 'public-command-edit-history' : 'corpus-unchanged', stop: { phase: 'complete', status: 'completed', reason: null }, original: null, fresh: null, errors: recorder.errors, cspViolations: recorder.cspViolations };
    try {
      const host = document.querySelector('#mounted-corpus-host');
      const original = await openOwner({ recorder, module: setup.module, options: setup.options, input: encoder.encode(literal.input.utf8), host, elementToken: 'owner-original' });
      observation.original = original.record;
      if (row.branch === 'expected_admission_refusal') {
        // This program only observes admission and cleanup. The independent
        // collector compares every actual ready branch with the refusal literal.
      } else {
        if (original.record.ready.status !== 'ready') {
          const response = original.record.ready.response;
          throw new DriverStop(original.record.ready.status === 'dom_refused' ? 'dom_refused' : response?.status === 'fatal' ? 'native_fatal' : 'native_refused', 'Positive owner did not become ready', 'ready');
        }
        recorder.phase = 'initial-read';
        const initial = await readTree(original, { stateLabel: 'initial-state', nodeLabel: 'initial-node' });
        recorder.phase = 'snapshot';
        const saved = row.stage === 'editor_edit_save_reopen' ? await editSequence(original, literal, initial) : await snapshotAndRelease(original, { snapshotLabel: 'snapshot-save', releaseLabel: 'release-save' });
        recorder.phase = 'destroy'; await closeOwner(original); recorder.check();
        recorder.phase = 'fresh-mount';
        const fresh = await openOwner({ recorder, module: setup.module, options: setup.options, input: saved, host, elementToken: 'owner-fresh' });
        observation.fresh = fresh.record;
        if (fresh.record.ready.status !== 'ready') {
          const response = fresh.record.ready.response;
          throw new DriverStop(fresh.record.ready.status === 'dom_refused' ? 'dom_refused' : response?.status === 'fatal' ? 'native_fatal' : 'native_refused', 'Fresh positive owner did not become ready', 'fresh-ready');
        }
        recorder.phase = 'fresh-read'; await readTree(fresh, { stateLabel: 'initial-state', nodeLabel: 'initial-node' });
        recorder.phase = 'fresh-snapshot'; await snapshotAndRelease(fresh, { snapshotLabel: 'snapshot-reopen', releaseLabel: 'release-reopen' });
      }
    } catch (error) {
      const detail = failure(error);
      observation.stop = { phase: error instanceof DriverStop && error.phase ? error.phase : recorder.phase, status: error instanceof DriverStop ? error.status : 'thrown', reason: detail.message };
      if (!isTypedProductStop(error)) recorder.addError(error);
    } finally {
      // Capture each constructed owner even if its awaited ready/capture failed.
      observation.original ??= recorder.owners[0]?.record ?? null;
      observation.fresh ??= recorder.owners[1]?.record ?? null;
      for (const owner of [...recorder.owners].reverse()) {
        try { await closeOwner(owner); }
        catch (error) {
          if (!isTypedProductStop(error)) recorder.addError(error);
          if (observation.stop.status === 'completed') observation.stop = { phase: owner === recorder.owners[0] ? 'destroy' : 'fresh-destroy', status: error instanceof DriverStop ? error.status : 'thrown', reason: failure(error).message };
        }
      }
      if (recorder.captureFailure && observation.stop.status === 'completed') observation.stop = { phase: 'capture', status: 'capture_error', reason: failure(recorder.captureFailure).message };
      recorder.dispose();
    }
    // A partial infrastructure failure keeps actual null unknowns. Its schema/integrity
    // failure is deliberate; no absent ready/destroy/native receipt is fabricated.
    return ownBoundedData(observation, BUDGETS.observationBytes).value;
  } finally { recorder?.dispose(); active = false; }
}

window.mountedCorpus45 = Object.freeze({ ready, run });
