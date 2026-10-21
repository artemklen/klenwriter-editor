// SPDX-License-Identifier: MIT OR Apache-2.0
/** Pure, browser-safe source contract. No process/filesystem/network or mutable run state. */
export const PROTOCOL_VERSION = 'mounted-corpus/1';
export const ACCEPTED_SOURCE = '71f47cf75d675c30e13a611bcf1f0be7657e3c23';
export const LITERAL_AUTHORING_SOURCE = 'a21a7f8030afaeb4879fcbbd4953a7c76e098184';
export const STAGES = Object.freeze([
  'legacy_import_parse', 'clipboard_plain_to_kwdj', 'clipboard_rich_to_kwdj',
  'validate_normalize', 'editor_round_trip_unchanged', 'editor_edit_save_reopen',
  'public_render', 'plain_text_projection', 'identity_manifest_extraction',
  'schema_upconversion', 'determinism',
]);
export const ENGINES = Object.freeze(['chromium', 'webkit', 'firefox']);
export const ENGINE_TIERS = Object.freeze({ chromium: 'required', webkit: 'required', firefox: 'experimental' });
// Runtime pins supplement every frozen source-pins.files entry. Omitting the
// implementation/config must fail even if its observed data happens to agree.
export const REQUIRED_SCENARIO_PATHS = Object.freeze([
  'contracts/mounted-e2e/v1/source-pins.json',
  'scripts/mounted-corpus/page-client.mjs', 'scripts/mounted-corpus/collect.mjs',
  'scripts/mounted-corpus/run.mjs', 'tests/mounted-corpus-browser.spec.js',
  'tests/mounted-corpus-collector.node.mjs', 'playwright.mounted-corpus.config.js',
  'spikes/workspace/mounted-corpus.html', 'scripts/workspace-server.mjs',
  'package.json', 'CONTRIBUTING.md', 'docs/mounted-corpus.md',
  // Current generated packet: hash only in RunBinding, avoiding a build cycle.
  'artifacts/extensions/packet.json',
]);
export const DISPOSITIONS = Object.freeze(['executed', 'pending', 'deferred', 'not_owned']);
export const REQUIREMENT_OUTCOMES = Object.freeze(['MET', 'GAP', 'OBSERVATION']);
export const BRANCHES = Object.freeze(['positive', 'expected_admission_refusal']);
export const ROUTES = Object.freeze(['corpus-unchanged', 'public-command-edit-history', 'native-admission-refusal']);
// Bounds are authored before execution. Largest pinned input = 672 bytes;
// largest independently authored snapshot literal = 679 bytes. These are harness ceilings.
export const BUDGETS = Object.freeze({
  inputBytes: 65536, snapshotBytes: 65536, observationBytes: 4 * 1024 * 1024,
  // The existing multi-suite generated packet is 13,060,313 bytes. Retain its
  // complete hash; consume only its explicit registry/profile data projection.
  registryPacketBytes: 16 * 1024 * 1024,
  reportBytes: 32 * 1024 * 1024, runBindingBytes: 256 * 1024,
  values: 262144, depth: 64, calls: 256, events: 256, nodes: 512,
  snapshots: 8, owners: 2, errors: 32, cspViolations: 32,
  readyMs: 15000, submissionMs: 10000, destroyMs: 10000, caseMs: 60000,
  retries: 0,
});
const frozen = value => {
  for (const item of Object.values(value)) if (item !== null && typeof item === 'object') frozen(item);
  return Object.freeze(value);
};
export const RESOURCE_KEYS = frozen({
  native: ['sessions', 'snapshot_handles', 'snapshot_bytes', 'protected_cursors'],
  sdk: ['lifecycle', 'sessions', 'listeners', 'queued_mutations', 'queued_bytes', 'pending_tickets', 'host_requests',
    'task_continuations', 'original_input_bytes', 'callback_errors', 'callback_error_handlers'],
  dom: ['listeners', 'observers', 'continuations', 'retainedInputBytes', 'retainedRecoveryRegions'],
  selection: ['bookmarks', 'restoreTickets', 'activePointers', 'animationFrames'],
  clipboard: ['pending', 'continuations', 'retainedTextBytes'],
  hostRequests: ['pending', 'focusContinuations'], inputObservations: ['subscribers'], popupPresentation: ['handles'],
  ui: ['listeners', 'observers', 'animationFrames', 'subscriptions', 'hostRequests', 'continuations', 'dragGestures', 'pointerCaptures'],
});
// Repeated *-node labels are complete bounded public tree traversals. Every
// successful branch must reach this order; a typed real stop preserves its exact
// reached prefix, original terminal response and cleanup instead of inventing phases.
export const REQUIRED_CALL_LABELS = frozen({
  'corpus-unchanged': {
    original: ['initial-state', 'initial-node', 'snapshot-save', 'release-save'],
    fresh: ['initial-state', 'initial-node', 'snapshot-reopen', 'release-reopen'],
  },
  'public-command-edit-history': {
    original: ['initial-state', 'initial-node', 'setup-selection', 'setup-marks', 'prepared-state', 'prepared-node',
      'query-edit', 'edit', 'after-edit-state', 'after-edit-node', 'snapshot-edit', 'release-edit',
      'query-undo', 'undo', 'after-undo-state', 'after-undo-node', 'snapshot-undo', 'release-undo',
      'query-redo', 'redo', 'after-redo-state', 'after-redo-node', 'snapshot-save', 'release-save'],
    fresh: ['initial-state', 'initial-node', 'snapshot-reopen', 'release-reopen'],
  },
  'native-admission-refusal': { original: [], fresh: [] },
});
export const CALL_LABELS = Object.freeze([...new Set(Object.values(REQUIRED_CALL_LABELS)
  .flatMap(route => [...route.original, ...route.fresh]))]);
export const COMMAND_IDS = Object.freeze([
  'org.klenwriter.kwdj/command/insert-text', 'org.klenwriter.kwdj/command/toggle-mark',
]);
export const U64_MAX = '18446744073709551615';
export function isU64(value) {
  return typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)
    && (value.length < U64_MAX.length || value.length === U64_MAX.length && value <= U64_MAX);
}
export function assertClosedKeys(value, keys, label = 'record') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) {
    throw new TypeError(`mounted-corpus.invalid_shape:${label}`);
  }
}
export function nativeResourceCounts(value) {
  assertClosedKeys(value, RESOURCE_KEYS.native, 'nativeResources');
  for (const key of ['sessions', 'snapshot_handles', 'protected_cursors']) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 0xffffffff) {
      throw new TypeError(`mounted-corpus.invalid_native_count:${key}`);
    }
  }
  if (!isU64(value.snapshot_bytes)) throw new TypeError('mounted-corpus.invalid_native_count:snapshot_bytes');
  return value;
}
/** Own bounded plain data without invoking accessors/toJSON. Schema validation
 * and semantic/byte/hash joins remain the collector's separate responsibility. */
export function ownBoundedData(source, maximumBytes = BUDGETS.observationBytes) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || maximumBytes > BUDGETS.reportBytes) {
    throw new TypeError('mounted-corpus.invalid_byte_budget');
  }
  let values = 0, encodedEstimate = 0;
  const add = amount => {
    encodedEstimate += amount;
    if (encodedEstimate > maximumBytes) throw new TypeError('mounted-corpus.data_bytes');
  };
  const stringCost = value => {
    add(2);
    for (let i = 0; i < value.length; i++) {
      const unit = value.charCodeAt(i);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('mounted-corpus.lone_surrogate');
        add(4);
      } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new TypeError('mounted-corpus.lone_surrogate');
      else add(unit === 34 || unit === 92 || [8, 9, 10, 12, 13].includes(unit) ? 2 : unit < 32 ? 6 : unit < 128 ? 1 : unit < 2048 ? 2 : 3);
    }
  };
  const active = new Set();
  const visit = (value, depth) => {
    if (++values > BUDGETS.values || depth > BUDGETS.depth) throw new TypeError('mounted-corpus.data_complexity');
    if (value === null) { add(4); return null; }
    if (typeof value === 'boolean') { add(value ? 4 : 5); return value; }
    if (typeof value === 'string') {
      stringCost(value);
      return value;
    }
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) throw new TypeError('mounted-corpus.invalid_integer');
      add(String(value).length);
      return value;
    }
    if (typeof value !== 'object' || active.has(value)) throw new TypeError('mounted-corpus.invalid_data');
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw new TypeError('mounted-corpus.nonplain_data');
    const keys = Reflect.ownKeys(value);
    if (array && (value.length > BUDGETS.values || keys.length !== value.length + 1)) throw new TypeError('mounted-corpus.invalid_array');
    add(2 + Math.max(0, (array ? value.length : keys.length) - 1));
    active.add(value);
    const result = array ? [] : Object.create(null);
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string') throw new TypeError('mounted-corpus.symbol_key');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new TypeError('mounted-corpus.accessor');
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) throw new TypeError('mounted-corpus.invalid_array');
      if (!array) { stringCost(key); add(1); }
      result[key] = visit(descriptor.value, depth + 1);
    }
    active.delete(value);
    return result;
  };
  const value = visit(source, 0), json = JSON.stringify(value), bytes = new TextEncoder().encode(json).byteLength;
  if (bytes > maximumBytes) throw new TypeError('mounted-corpus.data_bytes');
  return { value, json, bytes };
}
