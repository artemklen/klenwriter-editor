// SPDX-License-Identifier: MIT OR Apache-2.0
// Offline data collector. This module never loads an editor, browser or native module.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  PROTOCOL_VERSION, ACCEPTED_SOURCE, LITERAL_AUTHORING_SOURCE, ENGINES, ENGINE_TIERS, BUDGETS,
  REQUIRED_CALL_LABELS, REQUIRED_SCENARIO_PATHS, ownBoundedData, isU64, nativeResourceCounts,
} from './protocol.mjs';
import { assertResourceProfile67, resourceSchema67, assertResourceProfileBinding67, assertSettledResources67 } from './resource-profile67.mjs';

const BASE = 'contracts/mounted-e2e/v1/';
// run-binding.schema.json#/$defs/pin/properties/bytes/maximum. This
// binary-only ceiling is independent of JSON observation ownership budgets.
const WASM_PIN_MAX_BYTES = 268435456;
const SOURCE_PINS = { path: `${BASE}source-pins.json`, bytes: 11465,
  sha256: '3d3002372f5948862347c3304aacaddf96b1e8c1119741cf7e3741e4567a07a0' };
const contracts = new WeakMap();
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const equal = (a, b) => a === undefined || b === undefined ? a === b
  : isDeepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
const terminal = result => result?.status === 'completed' ? result.response
  : result?.status === 'queued' ? result.completion : result;
const failure = (code, message) => ({ code: `mounted-corpus.${code}`, message: String(message).slice(0, 4096) });
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

export class CollectionError extends Error {
  constructor(code, message) { super(message); this.name = 'CollectionError'; this.code = `mounted-corpus.${code}`; }
}
const requireData = (condition, code, message) => { if (!condition) throw new CollectionError(code, message); };

// JSON.parse alone silently accepts duplicate object keys. Such bytes are not a
// unique measurement, even if their last-value projection passes JSON Schema.
function parseJson(text) {
  const value = JSON.parse(text), stack = [];
  for (const token of text.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)) {
    const item = token[0], top = stack.at(-1);
    if (item === '{') stack.push({ keys: new Set(), key: true });
    else if (item === '[') stack.push(null);
    else if (item === '}' || item === ']') stack.pop();
    else if (item === ',' && top) top.key = true;
    else if (item === ':' && top) top.key = false;
    else if (item.startsWith('"') && top?.key) {
      const key = JSON.parse(item);
      requireData(!top.keys.has(key), 'duplicate_json_key', 'Duplicate JSON object key');
      top.keys.add(key);
    }
  }
  return value;
}
function bytesOf(value, maximumBytes) {
  requireData(typeof value === 'string' || value instanceof Uint8Array, 'artifact_type', 'Artifact reader must return bytes or UTF-8 text');
  const bytes = typeof value === 'string' ? encoder.encode(value) : Uint8Array.from(value);
  requireData(bytes.byteLength <= maximumBytes, 'artifact_bound', 'Artifact exceeds its closed byte bound');
  return bytes;
}
function checkPin(pin, maximumBytes = BUDGETS.reportBytes) {
  requireData(pin && Object.keys(pin).length === 3 && ['path', 'bytes', 'sha256'].every(k => Object.hasOwn(pin, k)), 'pin_shape', 'Closed artifact pin required');
  requireData(typeof pin.path === 'string' && pin.path.length > 0 && pin.path.length <= 4096
    && !pin.path.startsWith('/') && !pin.path.split('/').some(p => !p || p === '.' || p === '..') && !pin.path.includes('\\'), 'pin_path', 'Canonical relative artifact path required');
  requireData(Number.isSafeInteger(pin.bytes) && pin.bytes >= 0 && pin.bytes <= maximumBytes
    && typeof pin.sha256 === 'string' && /^[0-9a-f]{64}$/.test(pin.sha256), 'pin_shape', 'Bounded byte size and SHA256 required');
}
async function readPin(readArtifact, pin, maximumBytes) {
  checkPin(pin, maximumBytes);
  const bytes = bytesOf(await readArtifact(pin.path, maximumBytes), maximumBytes);
  requireData(bytes.byteLength === pin.bytes && hash(bytes) === pin.sha256, 'artifact_pin', `Artifact pin mismatch: ${pin.path}`);
  return bytes;
}
function dataJson(bytes, maximumBytes) {
  return ownBoundedData(parseJson(decoder.decode(bytes)), maximumBytes).value;
}
function pointer(value, path) {
  if (path === '') return value;
  requireData(typeof path === 'string' && path.startsWith('/'), 'source_pointer', 'JSON pointer required');
  for (const part of path.slice(1).split('/').map(s => s.replaceAll('~1', '/').replaceAll('~0', '~'))) {
    requireData(value !== null && typeof value === 'object' && Object.hasOwn(value, part), 'source_pointer', `Unresolved frozen source pointer: ${path}`);
    value = value[part];
  }
  return value;
}
function uniquePins(pins) {
  const map = new Map();
  for (const pin of pins) { checkPin(pin); requireData(!map.has(pin.path), 'duplicate_pin', `Duplicate pin: ${pin.path}`); map.set(pin.path, pin); }
  return map;
}

/** readArtifact is the only I/O capability. The caller owns its path allowlist,
 * regular-file/symlink policy and preallocation bounds. Returned bytes are checked again. */
export async function loadContract({ readArtifact, resourceProfile }) {
  assertResourceProfile67(resourceProfile);
  requireData(typeof readArtifact === 'function', 'reader', 'Bounded artifact reader required');
  const pins = dataJson(await readPin(readArtifact, SOURCE_PINS, BUDGETS.runBindingBytes), BUDGETS.runBindingBytes);
  requireData(pins.acceptedSource === ACCEPTED_SOURCE, 'contract_anchor', 'Frozen runtime capability anchor mismatch');
  const files = new Map(), pinMap = uniquePins([...pins.files, ...pins.acceptedSourceFiles]);
  for (const pin of pinMap.values()) files.set(pin.path, await readPin(readArtifact, pin, BUDGETS.observationBytes));
  const json = name => dataJson(files.get(`${BASE}${name}`), BUDGETS.observationBytes);
  const manifest = json('manifest.json'), literals = json('initial-literals.json');
  requireData(literals.protocol === PROTOCOL_VERSION && literals.acceptedSource === LITERAL_AUTHORING_SOURCE,
    'literal_anchor', 'Independent literal authoring anchor mismatch');
  requireData(manifest.protocol === PROTOCOL_VERSION && manifest.acceptedSource === ACCEPTED_SOURCE
    && manifest.rows.length === 277 && manifest.counts.initial === 25, 'contract_inventory', 'Frozen membership inventory mismatch');
  const ids = new Set(), initial = [];
  for (const row of manifest.rows) {
    requireData(!ids.has(row.rowId), 'contract_inventory', 'Duplicate frozen membership'); ids.add(row.rowId);
    const fixture = dataJson(files.get(row.source.fixtureRepositoryPath), BUDGETS.observationBytes);
    requireData(pointer(fixture, row.source.stagePointer) === row.stage, 'source_stage', 'Frozen stage pointer mismatch');
    requireData(pinMap.get(row.source.fixtureRepositoryPath)?.sha256 === row.source.fixtureFileSha256, 'source_fixture', 'Frozen fixture pin mismatch');
    if (row.initial) initial.push(row);
  }
  requireData(initial.length === 25 && initial.filter(r => r.branch === 'positive').length === 20
    && initial.filter(r => r.branch === 'expected_admission_refusal').length === 5, 'contract_inventory', 'Frozen initial branch count mismatch');
  for (const c of literals.positiveCases) {
    const fixture = dataJson(files.get(c.source.fixtureFile), BUDGETS.observationBytes);
    const original = pointer(fixture, c.source.casePointer);
    // Corpus README defines this exact symbolic reference; it is not an output oracle.
    const normalized = original.expected.normalized_kwdj === '$case.kwdj' ? original.kwdj : original.expected.normalized_kwdj;
    requireData(equal(c.input.value, original.kwdj) && equal(c.roundTrip.value, normalized), 'source_literal', 'Independent literal does not match authoritative source reference');
    if (c.edit) requireData(equal(c.edit.descriptor, original.edit), 'source_edit', 'Independent edit descriptor mismatch');
    for (const literal of [c.input, c.roundTrip, c.edit?.expected].filter(Boolean)) {
      requireData(encoder.encode(literal.utf8).length === literal.bytes && hash(encoder.encode(literal.utf8)) === literal.sha256
        && equal(parseJson(literal.utf8), literal.value), 'literal_bytes', 'Frozen literal bytes/value/hash mismatch');
      requireData(decoder.decode(files.get(`${BASE}${literal.file}`)) === literal.utf8, 'literal_file', 'Frozen canonical literal file mismatch');
    }
  }
  for (const c of literals.negativeCases) {
    const fixture = dataJson(files.get(c.source.file), BUDGETS.observationBytes);
    requireData(equal(pointer(fixture, c.source.inputPointer), c.input.value)
      && equal(pointer(fixture, c.source.expectedPointer).diagnostic_codes, c.fixtureDiagnosticCodes), 'source_negative', 'Frozen refusal expectation mismatch');
  }
  const ajv = new Ajv2020({ strict: true, allErrors: false });
  const validators = Object.fromEntries(['observation', 'run-binding', 'report'].map(name => {
    const schema = json(`${name}.schema.json`);
    return [name, ajv.compile(name === 'observation' ? resourceSchema67(schema, resourceProfile) : schema)];
  }));
  const contract = freeze({ manifest, literals, sourcePins: pins });
  contracts.set(contract, { files, validators, initial, resourceProfile, positives: new Map(literals.positiveCases.map(c => [c.caseId, c])),
    negatives: new Map(literals.negativeCases.map(c => [c.caseId, c])) });
  return contract;
}

const u64Keys = new Set(['generation', 'revision', 'selection_epoch', 'history_epoch', 'saved_revision',
  'undo_entries', 'redo_entries', 'retained_bytes', 'snapshot_bytes', 'changed_revision', 'authored_nodes',
  'text_utf8', 'text_utf16', 'height', 'sequence', 'event_sequence', 'from_revision', 'to_revision']);
function checkU64(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    // Public attribute names and diagnostic detail keys are arbitrary authored
    // strings; a key named "revision" there is not a StampDto u64 field.
    if (key === 'attributes' || key === 'details') continue;
    if (u64Keys.has(key)) requireData(isU64(child), 'u64', `Out-of-range u64: ${key}`);
    else checkU64(child);
  }
}
function byteRecord(value, expected = null) {
  const bytes = encoder.encode(value.utf8);
  requireData(bytes.length === value.bytes && hash(bytes) === value.sha256, 'utf8_hash', 'UTF-8 byte length/hash mismatch');
  requireData(equal(parseJson(value.utf8), parseJson(decoder.decode(bytes))), 'utf8', 'Lossy UTF-8 text');
  if (expected) requireData(value.utf8 === expected.utf8 && value.bytes === expected.bytes && value.sha256 === expected.sha256,
    'input_literal', 'Owner input is not the approved exact source bytes');
}
function nativeSample(sample, source, timing) {
  requireData(sample.source === source && sample.timing === timing, 'native_sample_source', 'Native resource sample source/timing mismatch');
  requireData(sample.validation === 'valid' && sample.value !== null, 'native_unavailable', 'Mandatory native resource map is null, invalid or unavailable');
  nativeResourceCounts(sample.value);
  if (source === 'module.resourceCounts') requireData(sample.rawJson !== null, 'native_wire_missing', 'Original module wire JSON is required');
  if (sample.rawJson !== null) requireData(equal(parseJson(sample.rawJson), sample.value), 'native_raw_join', 'Native resource wire/value mismatch');
  return sample.value;
}
const zeroNative = value => value.sessions === 0 && value.snapshot_handles === 0 && value.snapshot_bytes === '0' && value.protected_cursors === 0;
const zeroCounts = value => Object.entries(value).every(([k, v]) => k === 'lifecycle' ? v === 'destroyed'
  : v && typeof v === 'object' ? zeroCounts(v) : v === 0);
const stopStatus = response => response.status === 'refused' ? 'native_refused'
  : response.status === 'fatal' ? 'native_fatal' : response.status === 'dom_refused' ? 'dom_refused' : null;

function rowChecks(observation, row, literal, binding, baselines, profile, runContext, resourceProfile) {
  const issues = [], gaps = [], cleanup = [];
  const gap = (code, message) => { if (gaps.length < 16) gaps.push(failure(code, message)); };
  const cleanGap = (code, message) => { if (cleanup.length < 8) cleanup.push(failure(code, message)); };
  let cleanupUnavailable = false;
  const attempt = fn => { try { return fn(); } catch (error) { issues.push(failure(error.code?.replace(/^mounted-corpus\./, '') ?? 'data', error.message)); return null; } };
  const context = value => {
    requireData(value !== null && value.build_id === binding.build.buildId && equal(value.profile, profile), 'context_binding', 'Public context has foreign build/profile');
    if (runContext.value === null) runContext.value = value;
    else requireData(equal(value, runContext.value), 'context_binding', 'Registry/capability context differs within this run');
  };
  const checkOwner = (owner, expectedInput) => {
    attempt(() => assertSettledResources67({ resourceProfile, owner }));
    attempt(() => requireData(owner.mountOrdinal < owner.destroyOrdinal, 'owner_order', 'Owner was not destroyed after its actual construction'));
    attempt(() => byteRecord(owner.input, expectedInput));
    if (owner.originalInputBeforeDestroy !== null) attempt(() => byteRecord(owner.originalInputBeforeDestroy, owner.input));
    if (owner.originalInputAfterDestroy !== null) {
      attempt(() => byteRecord(owner.originalInputAfterDestroy)); cleanGap('retained_original_input', 'Original input remains after settled destruction');
    }
    if (owner.context !== null) attempt(() => context(owner.context));
    if (owner.ready.status === 'ready') attempt(() => {
      requireData(owner.ready.response.status === 'ok' && owner.ready.response.value.kind === 'state', 'ready_shape', 'Ready does not carry original state response');
      context(owner.context);
    });
    else if (owner.ready.status === 'sdk_failure') attempt(() => requireData(['refused', 'fatal'].includes(owner.ready.response.status), 'ready_shape', 'SDK failure must retain original refused/fatal response'));
    try {
      requireData(baselines.has(observation.engine), 'baseline_unavailable', 'Current engine baseline could not be verified');
      const before = nativeSample(owner.nativeBefore, 'module.resourceCounts', 'before_owner_construction');
      const after = nativeSample(owner.nativeAfter, 'mounted.nativeResources', 'after_destroy_settlement');
      if (!zeroNative(before) || !zeroNative(after)
        || !equal(before, baselines.get(observation.engine)) || !equal(after, baselines.get(observation.engine))) {
        cleanGap('native_not_baseline', 'Actual native before/after map does not return to the isolated engine baseline');
      }
    } catch (error) { cleanupUnavailable = true; issues.push(failure(error.code?.replace(/^mounted-corpus\./, '') ?? 'native_shape', error.message)); }
    if ((owner.resourcesBefore.ui === null) !== (owner.resourcesAfter.ui === null)) {
      cleanupUnavailable = true; issues.push(failure('ui_map_unavailable', 'Created UI owner requires both complete resource maps'));
    }
    if (!zeroCounts(owner.resourcesAfter.mounted) || (owner.resourcesAfter.ui !== null && !zeroCounts(owner.resourcesAfter.ui))) {
      cleanGap('resources_retained', 'Complete actual post-destroy resource map is nonzero or lifecycle is not destroyed');
    }
    const destroyed = terminal(owner.destroy.sdk);
    if (destroyed.status !== 'ok' || destroyed.value.kind !== 'destroyed' || owner.destroy.callbackFailure !== null) {
      cleanGap('destroy_failure', 'Actual settled destruction did not return successful destroyed receipt');
    }
    if (owner.ready.status !== 'ready') return;
    attempt(() => checkCalls(owner, observation.route, owner === observation.fresh,
      owner === (observation.fresh ?? observation.original) && observation.stop.status !== 'completed', context, gap));
  };
  checkOwner(observation.original, literal.input);
  if (observation.fresh !== null) checkOwner(observation.fresh, null);
  attempt(() => {
    requireData(observation.protocol === PROTOCOL_VERSION && observation.runId === binding.runId
      && observation.caseId === row.caseId && observation.stage === row.stage && observation.branch === row.branch, 'observation_binding', 'Stale/foreign run, case, stage or branch');
    requireData(observation.route === (row.branch === 'expected_admission_refusal' ? 'native-admission-refusal'
      : row.stage === 'editor_edit_save_reopen' ? 'public-command-edit-history' : 'corpus-unchanged'), 'route_binding', 'Wrong declared operation route');
    requireData(observation.errors.length === 0 && observation.cspViolations.length === 0, 'capture_error', 'Capture or CSP errors invalidate measurement integrity');
    requireData(!['capture_error', 'timeout', 'thrown'].includes(observation.stop.status), 'capture_error', 'Program did not produce a complete authentic terminal measurement');
    if (row.branch === 'expected_admission_refusal') {
      const owner = observation.original, response = owner.ready.response;
      requireData(owner.calls.length === 0 && owner.snapshots.length === 0 && owner.events.length === 0 && observation.fresh === null, 'negative_phases', 'Admission refusal must not claim positive snapshot/reopen phases');
      if (owner.ready.status !== 'sdk_failure' || response?.status !== 'refused') gap('negative_terminal', 'Expected original native admission refusal was not observed');
      else {
        const d = response.diagnostic, e = literal.diagnostic;
        if (d.code !== e.code || d.category !== e.category || !equal(d.details, e.details)
          || d.stamp !== e.stamp || d.may_have_committed !== e.may_have_committed
          || (typeof e.path.exact === 'string' && d.path !== e.path.exact)) gap('negative_diagnostic', 'Actual closed diagnostic differs from source-authored refusal oracle');
        // unknown_attribute intentionally has no exact or prefix path oracle.
      }
      requireData(observation.stop.phase === 'complete' && observation.stop.status === 'completed'
        && observation.stop.reason === null, 'stop_join', 'Negative branch did not retain its agreed completed program terminal');
      return;
    }
    const original = observation.original;
    const typed = owner => observation.stop.phase.endsWith('destroy') ? terminal(owner.destroy.sdk)
      : owner.ready.status === 'ready' ? terminal(owner.calls.at(-1)?.result)
        : owner.ready.status === 'sdk_failure' ? owner.ready.response : { status: 'dom_refused' };
    if (observation.stop.status !== 'completed') {
      const active = observation.fresh ?? original, response = typed(active);
      const unavailable = response?.status === 'ok' && response.value.kind === 'availability' && !response.value.available;
      requireData(response && (stopStatus(response) === observation.stop.status
        || unavailable && observation.stop.status === 'native_refused'), 'stop_join', 'Typed stop has no matching original terminal response');
      if (active.ready.status !== 'ready') requireData(observation.stop.phase === (observation.fresh ? 'fresh-ready' : 'ready'), 'stop_phase', 'Ready failure has an unrelated stop phase');
      else if (!observation.stop.phase.endsWith('destroy')) {
        const label = active.calls.at(-1)?.label;
        const allowed = label?.startsWith('release-') ? [observation.fresh ? 'fresh-release' : 'release']
          : label?.startsWith('initial-') ? [observation.fresh ? 'fresh-read' : 'initial-read']
            : label?.startsWith('prepared-') || label?.startsWith('setup-') ? ['setup']
              : label?.startsWith('after-edit-') || label === 'snapshot-edit' ? ['after-edit']
                : label?.includes('undo') ? ['undo'] : label?.includes('redo') || label === 'snapshot-save' ? ['redo', 'snapshot']
                  : label === 'snapshot-reopen' ? ['fresh-snapshot'] : [label];
        requireData(allowed.includes(observation.stop.phase), 'stop_phase', 'Typed terminal is assigned an unrelated reached phase');
      }
      for (const owner of [original, observation.fresh].filter(Boolean)) if (owner.ready.status === 'ready') {
        checkPrefixTrees(owner, owner === observation.fresh ? { input: row.stage === 'editor_edit_save_reopen' ? literal.edit.expected : literal.roundTrip } : literal,
          owner === observation.fresh ? 'editor_round_trip_unchanged' : row.stage, gap);
        checkSnapshots(owner, owner === observation.fresh ? { roundTrip: row.stage === 'editor_edit_save_reopen' ? literal.edit.expected : literal.roundTrip } : literal,
          owner === observation.fresh ? 'editor_round_trip_unchanged' : row.stage, gap);
      }
      gap('positive_terminal', `Actual positive route stopped: ${observation.stop.status}`);
      return;
    }
    requireData(observation.stop.phase === 'complete' && original.ready.status === 'ready', 'stop_join', 'Completed route must reach ready and complete');
    requireData(observation.fresh !== null, 'fresh_missing', 'Positive completion requires an actual fresh owner');
    const fresh = observation.fresh;
    requireData(fresh.ready.status === 'ready' && original.elementToken !== fresh.elementToken
      && original.mountOrdinal < original.destroyOrdinal && original.destroyOrdinal < fresh.mountOrdinal
      && fresh.mountOrdinal < fresh.destroyOrdinal, 'fresh_owner', 'Reopen must use distinct host and awaited destroy-before-new-mount ordering');
    requireData(original.snapshots.length === (row.stage === 'editor_edit_save_reopen' ? 3 : 1)
      && fresh.snapshots.length === 1, 'snapshot_inventory', 'Missing or duplicate original snapshot records');
    const finalExpected = row.stage === 'editor_edit_save_reopen' ? literal.edit.expected : literal.roundTrip;
    const save = checkSnapshots(original, literal, row.stage, gap);
    checkSnapshots(fresh, { roundTrip: finalExpected }, 'editor_round_trip_unchanged', gap);
    byteRecord(fresh.input, save);
    checkTreesAndStates(original, literal, row.stage, gap);
    checkTreesAndStates(fresh, { input: finalExpected, roundTrip: finalExpected, edit: null }, 'editor_round_trip_unchanged', gap);
  });
  return { issues, gaps, cleanup, cleanupUnavailable };
}

function checkCalls(owner, route, isFresh, allowStop, checkContext, gap) {
  const labels = REQUIRED_CALL_LABELS[route][isFresh ? 'fresh' : 'original'];
  let cursor = 0, lastLabel = null, current = owner.ready.response.value.state;
  for (const call of owner.calls) {
    if (call.label !== lastLabel || !call.label.endsWith('-node')) {
      requireData(call.label === labels[cursor++], 'call_order', `Unexpected/missing ordered phase: ${call.label}`);
    }
    lastLabel = call.label;
    checkContext(call.context);
    requireData(equal(call.context, owner.context), 'call_context', 'Call context is not its original owner context');
    const response = terminal(call.result), request = call.request;
    const stateRead = call.label.endsWith('-state'), nodeRead = call.label.endsWith('-node');
    const query = call.label.startsWith('query-');
    const kind = stateRead ? 'state' : nodeRead ? 'node' : call.label === 'setup-selection' ? 'set_selection'
      : call.label === 'setup-marks' ? 'set_stored_marks' : call.label === 'query-edit' ? 'query_command'
        : call.label === 'edit' ? 'command' : query ? 'query_history' : ['undo', 'redo'].includes(call.label) ? 'history'
          : call.label.startsWith('snapshot-') ? 'snapshot' : 'release_snapshot';
    const method = stateRead || nodeRead ? 'read' : query ? 'query' : 'submit';
    requireData(call.method === method && request.kind === kind, 'call_method', 'Call method/request does not match its declared phase');
    requireData(method === 'submit' ? ['completed', 'queued'].includes(call.result.status)
      : !['completed', 'queued'].includes(call.result.status), 'submission_join', 'Original scheduling/terminal response was not preserved');
    requireData(equal(call.capture, current.stamp), 'capture_stamp', 'Call capture is not the current original owner stamp');
    if (Object.hasOwn(request, 'stamp')) requireData(equal(request.stamp, call.capture), 'request_stamp', 'Request was not made with the recorded actual capture');
    if (kind === 'query_history' || kind === 'history') requireData(request.direction === call.label.replace('query-', ''), 'history_request', 'Wrong history direction');
    if (response.status !== 'ok') {
      requireData(call === owner.calls.at(-1), 'terminal_order', 'Calls continue after the original typed failure terminal');
      continue;
    }
    const expectedKind = stateRead ? 'state' : nodeRead ? 'node' : query ? 'availability'
      : kind === 'snapshot' ? 'snapshot' : kind === 'release_snapshot' ? 'released' : 'mutation';
    requireData(response.value.kind === expectedKind, 'reply_join', 'Original reply kind does not match the original request');
    if (nodeRead) requireData(response.value.node.id === request.node && equal(response.value.node.stamp, current.stamp), 'node_join', 'Node request/reply ID or stamp mismatch');
    if (stateRead || expectedKind === 'mutation') {
      const next = response.value.state;
      requireData(next.stamp.session === current.stamp.session && next.stamp.generation === current.stamp.generation
        && ['revision', 'selection_epoch', 'history_epoch'].every(k => BigInt(next.stamp[k]) >= BigInt(current.stamp[k])), 'state_order', 'Owner stamp regresses or changes session/generation');
      if (stateRead) requireData(equal(next.stamp, current.stamp), 'state_read_join', 'Readonly state call changed capture stamp');
      current = next;
    }
    if (query && !response.value.available) gap('command_unavailable', 'Actual query reports operation unavailable');
    if (kind === 'snapshot') requireData(equal(response.value.stamp, current.stamp)
      && equal(response.value.profile, owner.context.profile), 'snapshot_context', 'Snapshot stamp/profile does not match original owner');
  }
  const last = terminal(owner.calls.at(-1)?.result);
  if (!allowStop) requireData(cursor === labels.length && last?.status === 'ok', 'call_missing', 'Missing required successful route phase');
  for (let i = 0; i < owner.events.length; i++) {
    const event = owner.events[i], previous = owner.events[i - 1];
    requireData(event.before.session === current.stamp.session && event.after.session === current.stamp.session
      && (!previous || BigInt(event.sequence) === BigInt(previous.sequence) + 1n && equal(event.before, previous.after)), 'event_order', 'Original event sequence/stamp chain is broken');
    const mutation = owner.calls.map(c => terminal(c.result)).find(r => r?.status === 'ok' && r.value.kind === 'mutation' && equal(r.value.state.stamp, event.after));
    requireData(mutation && equal(mutation.value.state.selection, event.selection_after)
      && equal(mutation.value.state.stored_marks, event.stored_marks_after)
      && equal(mutation.value.state.history, event.history), 'event_join', 'Notification does not join an original mutation response');
  }
  for (const call of owner.calls) {
    const r = terminal(call.result);
    if (r?.status === 'ok' && r.value.kind === 'mutation' && r.value.effect === 'changed') {
      requireData(owner.events.some(e => equal(e.after, r.value.state.stamp)), 'event_missing', 'Changed mutation notification is missing');
    }
  }
}

function checkSnapshots(owner, literal, stage, gap) {
  let save = null;
  for (const record of owner.snapshots) {
    byteRecord(record);
    const call = owner.calls[record.call], release = owner.calls[record.releaseCall];
    requireData(call?.label.startsWith('snapshot-') && release?.label === call.label.replace('snapshot-', 'release-')
      && record.releaseCall === record.call + 1, 'snapshot_reference', 'Snapshot record does not reference its original call and immediate explicit release');
    const response = terminal(call.result), released = terminal(release.result);
    requireData(response?.status === 'ok' && response.value.kind === 'snapshot'
      && response.value.canonical_json === record.utf8 && release.request.kind === 'release_snapshot'
      && release.request.handle === response.value.handle, 'snapshot_reference', 'Snapshot bytes/release handle do not join original replies');
    if (released?.status !== 'ok' || released.value.kind !== 'released') gap('snapshot_release', 'Actual explicit snapshot release failed');
    const expected = stage === 'editor_edit_save_reopen' && call.label !== 'snapshot-undo' ? literal.edit.expected : literal.roundTrip;
    if (record.utf8 !== expected.utf8 || record.bytes !== expected.bytes || record.sha256 !== expected.sha256) gap('canonical_bytes', 'Actual canonical UTF-8 snapshot differs from independent literal');
    if (call.label === 'snapshot-save') save = record;
  }
  requireData(new Set(owner.snapshots.map(r => r.call)).size === owner.snapshots.length, 'snapshot_duplicate', 'Duplicate retained snapshot call');
  const actual = owner.calls.filter(c => c.label.startsWith('snapshot-') && terminal(c.result)?.status === 'ok').length;
  requireData(actual === owner.snapshots.length, 'snapshot_missing', 'Successful original snapshot was not retained');
  return save;
}

const attr = value => value === null ? { kind: 'null' } : Array.isArray(value) ? { kind: 'list', value: value.map(attr) }
  : typeof value === 'object' ? { kind: 'object', value: attributes(value) }
    : { kind: typeof value === 'number' ? 'number' : typeof value, value: typeof value === 'number' ? String(value) : value };
const attributes = value => Object.fromEntries(Object.entries(value ?? {}).map(([k, v]) => [k, attr(v)]));
function treeAt(owner, phase, expected, gap) {
  const stateCall = owner.calls.find(c => c.label === `${phase}-state`), state = terminal(stateCall?.result)?.value?.state;
  requireData(state, 'phase_state', `Missing original state for ${phase}`);
  const calls = owner.calls.filter(c => c.label === `${phase}-node`), nodes = new Map();
  for (const call of calls) {
    const r = terminal(call.result);
    requireData(r?.status === 'ok' && r.value.kind === 'node', 'tree_terminal', 'Missing original node reply');
    const n = r.value.node;
    requireData(!nodes.has(n.id) && equal(n.stamp, state.stamp), 'tree_join', 'Duplicate node or foreign phase stamp'); nodes.set(n.id, n);
  }
  const roles = new Map(), visited = new Set();
  const walk = (id, parent, document, path) => {
    const node = nodes.get(id);
    requireData(node && !visited.has(id) && node.parent === parent, 'tree_join', 'Incomplete/cyclic tree or wrong parent relation');
    visited.add(id); roles.set(path, id);
    const root = path === '', type = root ? '' : `org.klenwriter.kwdj/${document.type}`;
    const primitive = root ? 'root' : document.type === 'text' ? 'text' : document.type === 'hard_break' ? 'hard_break'
      : ['paragraph', 'heading', 'code_block'].includes(document.type) ? 'text_block' : 'container';
    const marks = (document.marks ?? []).map(m => ({ type_id: `org.klenwriter.kwdj/${m.type}`, attributes: attributes(m.attrs) }));
    if (node.type_id !== type || node.primitive !== primitive || !equal(node.attributes, root ? {} : attributes(document.attrs))
      || !equal(node.marks, root ? [] : marks) || node.text !== (root ? null : document.text ?? null)
      || node.children.length !== (document.content ?? []).length) gap('tree_literal', `Actual public node differs at ${path || 'synthetic root'}`);
    // Once behavior changes topology, still validate the actual graph completely;
    // expected paths remain independently bound only where both sides exist.
    for (let i = 0; i < node.children.length; i++) {
      if (document.content?.[i]) walk(node.children[i], id, document.content[i], `${path}/content/${i}`);
      else walkActual(node.children[i], id);
    }
  };
  const walkActual = (id, parent) => {
    const n = nodes.get(id); requireData(n && !visited.has(id) && n.parent === parent, 'tree_join', 'Incomplete actual public topology');
    visited.add(id); for (const child of n.children) walkActual(child, id);
  };
  walk(state.root, null, expected, '');
  requireData(visited.size === nodes.size && nodes.size <= BUDGETS.nodes, 'tree_join', 'Traversal contains unowned or unreachable public nodes');
  return { state, roles };
}
function bindSelection(template, roles) {
  const resolve = value => {
    if (typeof value === 'string' && value.startsWith('$role.')) {
      const role = value.slice(6, -3); requireData(roles[role], 'role_missing', `Required original role unavailable: ${role}`); return roles[role];
    }
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)]));
    return value;
  };
  return resolve(template);
}
function checkPrefixTrees(owner, literal, stage, gap) {
  let initial = null;
  for (const [phase, expected] of [['initial', literal.input.value], ['prepared', literal.input.value],
    ['after-edit', literal.edit?.expected.value], ['after-undo', literal.input.value], ['after-redo', literal.edit?.expected.value]]) {
    const calls = owner.calls.filter(c => c.label === `${phase}-node`);
    if (!calls.length || calls.some(c => terminal(c.result)?.status !== 'ok')) continue;
    const tree = treeAt(owner, phase, expected, gap);
    if (phase === 'initial') initial = tree;
  }
  if (stage === 'editor_edit_save_reopen' && initial) checkEditRequests(owner, literal.edit, initial.roles);
}
function checkEditRequests(owner, edit, initialRoles) {
  const roles = { targetText: initialRoles.get(edit.target.kwdjPointer) };
  const setup = owner.calls.find(c => c.label === 'setup-selection'), marks = owner.calls.find(c => c.label === 'setup-marks');
  if (setup) requireData(equal(setup.request.selection, bindSelection(edit.selection.setup.selection, roles)), 'setup_request', 'Driver did not submit independent directed selection setup');
  if (marks) requireData(marks.request.marks === null, 'setup_request', 'Driver did not clear stored marks');
  for (const call of owner.calls.filter(c => c.label === 'query-edit' || c.label === 'edit')) {
    requireData(call.request.command.id === edit.commandId && equal(parseJson(call.request.command.payload_json), edit.intent), 'edit_request', 'Driver command differs from independent edit intent');
    if (call.label === 'edit') requireData(equal(call.request.history_hint, edit.historyHint), 'history_request', 'Wrong independent history boundary');
  }
}
function checkTreesAndStates(owner, literal, stage, gap) {
  const initial = treeAt(owner, 'initial', literal.input.value, gap);
  if (stage !== 'editor_edit_save_reopen') return;
  const edit = literal.edit, prepared = treeAt(owner, 'prepared', literal.input.value, gap);
  const after = treeAt(owner, 'after-edit', edit.expected.value, gap);
  const undo = treeAt(owner, 'after-undo', literal.input.value, gap), redo = treeAt(owner, 'after-redo', edit.expected.value, gap);
  const roles = { targetText: initial.roles.get(edit.target.kwdjPointer), replacementText: after.roles.get(edit.target.kwdjPointer) };
  const setup = owner.calls.find(c => c.label === 'setup-selection'), marks = owner.calls.find(c => c.label === 'setup-marks');
  requireData(equal(setup.request.selection, bindSelection(edit.selection.setup.selection, roles)) && marks.request.marks === null,
    'setup_request', 'Driver did not submit the independent directed selection/stored-marks setup');
  for (const [label, kind] of [['query-edit', 'query_command'], ['edit', 'command']]) {
    const call = owner.calls.find(c => c.label === label);
    requireData(call.request.kind === kind && call.request.command.id === edit.commandId
      && equal(parseJson(call.request.command.payload_json), edit.intent), 'edit_request', 'Driver command differs from independently authored edit intent');
    if (label === 'edit') requireData(equal(call.request.history_hint, edit.historyHint), 'history_request', 'Wrong edit history boundary');
    const r = terminal(call.result);
    if (r.status === 'ok' && r.value.effect !== edit.expectedEffect) gap('edit_effect', 'Actual edit/query effect differs from independent intent');
  }
  const mapsEqual = (a, b) => a.size === b.size && [...a].every(([path, id]) => b.get(path) === id);
  if (!mapsEqual(initial.roles, prepared.roles) || !mapsEqual(initial.roles, undo.roles)) gap('original_identity', 'Prepared/Undo public node identities do not restore the original map');
  if (!mapsEqual(after.roles, redo.roles)) gap('redo_identity', 'Redo did not restore the same committed node identity map');
  for (const p of ['', ...edit.identity.survivingOriginalPointers]) if (initial.roles.get(p) !== after.roles.get(p)) gap('survivor_identity', `Original survivor changed at ${p || 'root'}`);
  for (const p of edit.identity.retiredOriginalPointers) if ([...after.roles.values()].includes(initial.roles.get(p))) gap('retired_identity', 'Original replaced text remains live after edit');
  for (const role of edit.identity.liveCreatedRoles) if (!after.roles.has(role.pointer) || [...initial.roles.values()].includes(after.roles.get(role.pointer))) gap('replacement_identity', 'Replacement role is not distinct from every original ID');
  for (const [phase, value, expectation, history] of [
    ['prepared', prepared, edit.selection.setup, edit.history.initial], ['after-edit', after, edit.selection.afterEdit, edit.history.afterEdit],
    ['after-undo', undo, edit.selection.afterUndo, edit.history.afterUndo], ['after-redo', redo, edit.selection.afterRedo, edit.history.afterRedo],
  ]) {
    if (!equal(value.state.selection, bindSelection(expectation.selection, roles)) || value.state.stored_marks !== expectation.storedMarks) gap('directed_selection', `Actual ${phase} selection/stored marks differs from directed role literal`);
    if (!Object.entries(history).every(([k, v]) => value.state.history[k] === v)) gap('history_literal', `Actual ${phase} history differs from independent one-edit Undo/Redo intent`);
  }
  if (!Object.entries(edit.history.initial).every(([k, v]) => initial.state.history[k] === v)) gap('initial_history', 'New original owner starts with nonempty history');
}

/** Deterministic full-ledger report. observations are bounded artifact pins,
 * never parsed runtime objects or expected values. Product execution is external. */
export async function collect({ contract, runBinding, observations, readArtifact, sourceSHA, resourceProfile }) {
  assertResourceProfile67(resourceProfile);
  const internal = contracts.get(contract);
  requireData(internal && typeof readArtifact === 'function', 'contract', 'loadContract result and bounded artifact reader required');
  requireData(internal.resourceProfile === resourceProfile, 'resource_profile67.contract_mode', 'Collector mode must match its privately configured contract validator');
  const binding = ownBoundedData(runBinding, BUDGETS.runBindingBytes).value;
  observations = ownBoundedData(observations, BUDGETS.runBindingBytes).value;
  requireData(internal.validators['run-binding'](binding), 'run_binding_shape', 'RunBinding fails its closed source schema'); checkU64(binding);
  // Configuration is explicit; a modern sidecar never silently selects a mode.
  await assertResourceProfileBinding67({ resourceProfile, runBinding: binding, readArtifact });
  const globals = [], globalBlockers = [], baselines = new Map(), runContext = { value: null };
  const global = (code, message) => globals.push(failure(code, message));
  const guarded = async fn => { try { return await fn(); } catch (e) { global(e.code?.replace(/^mounted-corpus\./, '') ?? 'data', e.message); return null; } };
  await guarded(async () => {
    requireData(/^[0-9a-f]{40}$/.test(sourceSHA) && binding.sourceSHA === sourceSHA && binding.acceptedSource === ACCEPTED_SOURCE, 'source_binding', 'Run source SHA or accepted capability source mismatch');
    requireData(binding.protocol === PROTOCOL_VERSION && binding.corpusIndex.path === contract.manifest.corpus.indexFile
      && binding.corpusIndex.sha256 === contract.manifest.corpus.indexSha256
      && binding.corpusPackageSha256 === contract.manifest.corpus.declaredContentSha256, 'corpus_binding', 'Run corpus binding differs from frozen immutable corpus');
    const pins = uniquePins(binding.scenarioPins);
    for (const required of contract.sourcePins.files) requireData(equal(pins.get(required.path), required), 'scenario_pin', `Missing/stale frozen source pin: ${required.path}`);
    for (const path of REQUIRED_SCENARIO_PATHS) requireData(pins.has(path), 'scenario_pin', `Missing mandatory implementation/build input pin: ${path}`);
    requireData(equal(pins.get(SOURCE_PINS.path), SOURCE_PINS), 'scenario_pin', 'Source-pins authority is not bound to this freeze');
    await readPin(readArtifact, binding.build.wasm, WASM_PIN_MAX_BYTES);
    for (const pin of [binding.corpusIndex, binding.build.seal, binding.build.dependencies]) {
      await readPin(readArtifact, pin, BUDGETS.observationBytes);
    }
    for (const pin of binding.scenarioPins) await readPin(readArtifact, pin,
      pin.path === 'artifacts/extensions/packet.json' ? BUDGETS.registryPacketBytes : BUDGETS.observationBytes);
    for (const engine of ENGINES) {
      requireData(binding.environment.engines.filter(e => e.engine === engine).length === 1, 'engine_inventory', 'Actual engine environment is missing/duplicate');
      const rows = binding.nativeBaselines.filter(e => e.engine === engine);
      requireData(rows.length === 1 && rows[0].buildId === binding.build.buildId && rows[0].wasmSha256 === binding.build.wasm.sha256, 'baseline_binding', 'Engine native baseline build/WASM mismatch');
      const value = nativeSample(rows[0].sample, 'module.resourceCounts', 'before_owner_construction'); baselines.set(engine, value);
      if (!zeroNative(value)) globalBlockers.push({ class: 'cleanup_isolation', ...failure('baseline_live', `${engine}: engine baseline is not isolated`) });
    }
  });
  let profile = null;
  await guarded(async () => {
    const pin = binding.scenarioPins.find(p => p.path === 'artifacts/extensions/packet.json');
    requireData(pin, 'packet_missing', 'Current public SDK2 packet pin is required');
    // The generated packet also contains independent consumer fixture payloads.
    // Check the entire original wire before projecting; unrelated fixture data
    // is never copied through the observation ownership/value-count budget.
    const rawPacket = parseJson(decoder.decode(await readPin(readArtifact, pin, BUDGETS.registryPacketBytes)));
    requireData(rawPacket.format === 'editor-extensions-public-consumer/1', 'packet_binding', 'Unknown pinned registry packet format');
    const packet = ownBoundedData({ kwdjProfile: rawPacket.kwdjProfile,
      kwdjRegistryJson: rawPacket.kwdjRegistryJson }, BUDGETS.observationBytes).value;
    const registry = parseJson(packet.kwdjRegistryJson);
    requireData(packet.kwdjProfile.profile_id === 'org.klenwriter.kwdj'
      && packet.kwdjProfile.codec_id === 'org.klenwriter.kwdj/json' && registry.profile.id === packet.kwdjProfile.profile_id
      && registry.profile.version === packet.kwdjProfile.profile_version && registry.profile.codec_id === packet.kwdjProfile.codec_id
      && registry.profile.wire_version === packet.kwdjProfile.wire_version && equal(registry.selected_extensions, packet.kwdjProfile.extensions), 'packet_binding', 'Pinned registry/profile packet is incoherent');
    profile = packet.kwdjProfile;
  });
  const records = new Map(), initialMap = new Map(internal.initial.map(r => [r.rowId, r]));
  requireData(Array.isArray(observations) && observations.length <= 150, 'observation_bound', 'Closed maximum of 150 observation artifact pins');
  if (observations.length !== 75) global('observation_inventory', 'Expected exactly 25 initial memberships in each of three engines');
  const artifactPaths = new Set();
  for (const pin of observations) await guarded(async () => {
    checkPin(pin, BUDGETS.observationBytes);
    requireData(!artifactPaths.has(pin.path), 'duplicate_artifact', 'Duplicate observation artifact path'); artifactPaths.add(pin.path);
    const value = dataJson(await readPin(readArtifact, pin, BUDGETS.observationBytes), BUDGETS.observationBytes);
    requireData(ENGINES.includes(value.engine) && initialMap.has(value.rowId), 'observation_inventory', 'Unowned engine/membership was submitted for initial execution');
    const key = `${value.engine}:${value.rowId}`;
    const record = { value, pin, schema: internal.validators.observation(value) };
    if (records.has(key)) { records.get(key).duplicate = true; global('duplicate_observation', `Duplicate observation: ${key}`); }
    else records.set(key, record);
  });
  const rows = [], failures = [...globals], blockingReasons = [...globalBlockers];
  for (const engine of ENGINES) for (const row of contract.manifest.rows) {
    const record = records.get(`${engine}:${row.rowId}`), tier = ENGINE_TIERS[engine];
    const report = { engine, rowId: row.rowId, caseId: row.caseId, stage: row.stage, tier, disposition: row.disposition,
      measurementStatus: 'NOT_EXECUTED', requirement: null, integrity: 'PASS', cleanup: null, blockingReasons: [], evidence: [], reason: row.reason };
    if (row.initial) {
      let result;
      if (!record) result = { issues: [failure('missing_observation', `${engine}: missing ${row.rowId}`)], gaps: [], cleanup: [], cleanupUnavailable: false };
      else {
        report.disposition = 'executed'; report.measurementStatus = 'EXECUTED'; report.evidence = [record.pin];
        if (!record.schema || record.duplicate) result = { issues: [failure(record.duplicate ? 'duplicate_observation' : 'observation_shape', 'Measurement fails closed shape/unique cardinality')], gaps: [], cleanup: [], cleanupUnavailable: true };
        else {
          try { checkU64(record.value); result = rowChecks(record.value, row, internal.positives.get(row.caseId) ?? internal.negatives.get(row.caseId), binding, baselines, profile, runContext, resourceProfile); }
          catch (e) { result = { issues: [failure(e.code?.replace(/^mounted-corpus\./, '') ?? 'data', e.message)], gaps: [], cleanup: [], cleanupUnavailable: true }; }
        }
      }
      if (result.issues.length || globals.length) {
        report.integrity = 'FAIL'; report.requirement = null;
        for (const issue of result.issues) { failures.push(issue); report.blockingReasons.push({ class: 'integrity', ...issue }); }
        if (globals.length) report.blockingReasons.push({ class: 'integrity', ...failure('run_binding', 'Global source/build/artifact binding is invalid') });
      } else report.requirement = result.gaps.length || result.cleanup.length ? 'GAP' : 'MET';
      report.cleanup = result.cleanupUnavailable ? 'UNAVAILABLE' : record ? result.cleanup.length ? 'GAP' : 'PASS' : null;
      for (const item of result.cleanup) report.blockingReasons.push({ class: 'cleanup_isolation', ...item });
      if (report.requirement === 'GAP' && tier === 'required') for (const item of result.gaps) report.blockingReasons.push({ class: 'required_behavior', ...item });
      report.reason = [...result.issues, ...result.gaps, ...result.cleanup].map(f => `${f.code}: ${f.message}`).join('; ').slice(0, 4096) || (report.requirement === 'MET' ? 'Current complete measurement matches independent source literals.' : 'Run integrity failed.');
      blockingReasons.push(...report.blockingReasons);
    }
    rows.push(report);
  }
  // Global errors remain explicit even if no row could safely be associated with corrupt bytes.
  blockingReasons.push(...globals.map(f => ({ class: 'integrity', ...f })));
  const report = { protocol: PROTOCOL_VERSION, runBinding: binding,
    integrity: { status: failures.length ? 'FAIL' : 'PASS', failures: failures.slice(0, 512) },
    blockingReasons: blockingReasons.slice(0, 512),
    engineSummaries: ENGINES.map(engine => {
      const selected = rows.filter(r => r.engine === engine), count = key => selected.filter(r => r.disposition === key).length;
      return { engine, tier: ENGINE_TIERS[engine], observedInitialRows: selected.filter(r => r.measurementStatus === 'EXECUTED').length,
        integrity: globals.length || selected.some(r => r.integrity === 'FAIL') ? 'FAIL' : 'PASS',
        executed: count('executed'), pending: count('pending'), deferred: count('deferred'), notOwned: count('not_owned'),
        met: selected.filter(r => r.requirement === 'MET').length, gap: selected.filter(r => r.requirement === 'GAP').length,
        observation: selected.filter(r => r.requirement === 'OBSERVATION').length };
    }), rows,
    crossCuttingRoutes: contract.manifest.crossCuttingRoutes.map(r => ({ ...r, requirement: null, evidence: [] })),
    separateLanes: { installedNative: 'NOT_EXECUTED', humanManual: 'NOT_EXECUTED', realAssistiveTechnology: 'deferred' } };
  const owned = ownBoundedData(report, BUDGETS.reportBytes).value;
  requireData(internal.validators.report(owned), 'report_shape', 'Collector result violates the frozen closed report schema');
  return owned;
}
