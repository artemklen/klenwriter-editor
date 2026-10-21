// SPDX-License-Identifier: MIT OR Apache-2.0
// Source authority only. No editor, build, browser or product observation is loaded.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const SOURCE_CONTINUATION47_PATH = 'contracts/mounted-e2e/v1.1/source-continuation47.json';
const HELPER_PATH = 'scripts/mounted-corpus/source-continuation47.mjs';
const MANIFEST_PIN = Object.freeze({ path: SOURCE_CONTINUATION47_PATH, bytes: 32454,
  sha256: 'd6986b1010d0e8d9d4e1594410d0c92cc695ad27df2d65e77cbcac04a5ba4621' });
const HISTORICAL_SOURCE = '441bd3b2d7f9b0a40be26877ba74575b8e1882cd';
const CAPABILITY_ANCHOR = '71f47cf75d675c30e13a611bcf1f0be7657e3c23';
const CURRENT_ANCHOR = 'e914716db9ed4143bea7e666e8cfb9e03de99479';
const EXPECTED_CHANGED_PATHS = Object.freeze([
  'crates/engine/src/dispatch.rs', 'crates/engine/src/tree.rs', 'packages/dom/src/input.ts',
  'packages/dom/src/types.ts', 'packages/kwdj/src/dom.ts', 'packages/sdk/src/controller.ts',
  'packages/sdk/src/response.ts', 'packages/wasm/src/sdk-types-v2.ts',
]);
const EXPECTED_CONTRACT_PATHS = Object.freeze([
  'contracts/mounted-e2e/v1/source-pins.json', 'contracts/mounted-e2e/v1/interaction-literals.json',
  'contracts/mounted-e2e/v1/manifest.json',
]);
const EXPECTED_BUDGETS = Object.freeze({ manifestBytes: 131072, sourceBytes: 262144,
  retainedBytes: 1048576, deltaBytes: 65536, authorityPaths: 32, authorityReferences: 35, changedPaths: 8 });
const sha = value => createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const freeze = value => {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
};
function fail(code, message, cause) {
  const error = new Error(`mounted-corpus.source_continuation.${code}: ${message}`, { cause });
  error.code = `mounted-corpus.source_continuation.${code}`;
  throw error;
}
function requireData(condition, code, message) { if (!condition) fail(code, message); }
function closed(value, keys, label) {
  requireData(value !== null && typeof value === 'object' && !Array.isArray(value)
    && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort()), 'shape', label);
}
function path(value) {
  requireData(typeof value === 'string' && value.length > 0 && value.length <= 4096
    && !value.startsWith('/') && !value.includes('\\') && !value.includes('\0')
    && !value.split('/').some(part => !part || part === '.' || part === '..'), 'path', 'Canonical repository path required');
  return value;
}
function pin(value, maximum) {
  closed(value, ['path', 'bytes', 'sha256'], 'Closed artifact pin required'); path(value.path);
  requireData(Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= maximum
    && typeof value.sha256 === 'string' && value.sha256.length === 64 && /^[0-9a-f]{64}$/.test(value.sha256), 'pin_shape', value.path);
}
function equal(actual, expected, code, message) {
  requireData(isDeepStrictEqual(actual, expected), code, message);
}

/** Explicit OSR-47 opt-in. The injected reader owns regular-file/symlink and
 * preallocation policy. Every request supplies an exact independently frozen
 * byte ceiling; every returned byte sequence is checked again here. */
export async function loadMountedSourceContinuation47({ readArtifact }) {
  requireData(typeof readArtifact === 'function', 'reader', 'Bounded current/retained artifact reader required');
  async function readExact(expected, code) {
    let source;
    try { source = await readArtifact(expected.path, expected.bytes); }
    catch (error) { fail(code, `Bounded artifact read failed: ${expected.path}`, error); }
    requireData(source instanceof Uint8Array, code, `Original byte array required: ${expected.path}`);
    requireData(source.byteLength === expected.bytes && sha(source) === expected.sha256,
      code, `Exact source pin mismatch: ${expected.path}`);
    return Uint8Array.from(source);
  }
  const manifestBytes = await readExact(MANIFEST_PIN, 'manifest_pin');
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
  closed(manifest, ['format', 'status', 'id', 'license', 'historicalSource', 'historicalCapabilityAnchor',
    'currentProductionAnchor', 'frozenContracts', 'changedPaths', 'authorities', 'changes', 'budgets', 'qualification'], 'Closed continuation manifest');
  equal([manifest.format, manifest.status, manifest.id, manifest.license],
    ['mounted-corpus-source-continuation/1', 'SOURCE_AUTHORED_BEFORE_EXECUTION', 'OSR-47', 'MIT OR Apache-2.0'], 'manifest', 'Versioned source-only continuation');
  equal([manifest.historicalSource, manifest.historicalCapabilityAnchor, manifest.currentProductionAnchor],
    [HISTORICAL_SOURCE, CAPABILITY_ANCHOR, CURRENT_ANCHOR], 'anchor', 'Exact named historical/current source anchors');
  equal(manifest.changedPaths, EXPECTED_CHANGED_PATHS, 'change_membership', 'Exactly the eight source-authored OSR-47 source changes');
  equal(manifest.budgets, EXPECTED_BUDGETS, 'budgets', 'Source bounds cannot be widened');
  requireData(typeof manifest.qualification === 'string' && manifest.qualification.length <= 4096, 'qualification', 'Bounded provenance qualification');
  requireData(Array.isArray(manifest.frozenContracts) && manifest.frozenContracts.length === 3, 'contracts', 'Exact original contract inventory');
  equal(manifest.frozenContracts.map(item => item.path), EXPECTED_CONTRACT_PATHS, 'contracts', 'Exact original contract paths');
  const contracts = [];
  for (const original of manifest.frozenContracts) {
    pin(original, EXPECTED_BUDGETS.retainedBytes);
    const bytes = await readExact(original, 'contract_pin');
    contracts.push(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  }
  const [sourcePins, interactions, ledger] = contracts;
  equal([sourcePins.acceptedSource, interactions.acceptedSource, ledger.acceptedSource],
    [CAPABILITY_ANCHOR, CAPABILITY_ANCHOR, CAPABILITY_ANCHOR], 'original_anchor', 'Original historical contract anchor');
  requireData(Array.isArray(ledger.rows) && ledger.rows.length === 277, 'ledger', 'Original277 membership ledger retained');
  requireData(Array.isArray(sourcePins.acceptedSourceFiles) && Array.isArray(interactions.sourcePins), 'references', 'Original source authority arrays');
  const references = [
    ...sourcePins.acceptedSourceFiles.map((value, index) => ({ owner: EXPECTED_CONTRACT_PATHS[0], pointer: `/acceptedSourceFiles/${index}`, pin: value })),
    ...interactions.sourcePins.map((value, index) => ({ owner: EXPECTED_CONTRACT_PATHS[1], pointer: `/sourcePins/${index}`, pin: value })),
  ];
  requireData(references.length === EXPECTED_BUDGETS.authorityReferences, 'references', 'All35 original authority references retained');
  const originalByPath = new Map();
  for (const reference of references) {
    pin(reference.pin, EXPECTED_BUDGETS.sourceBytes);
    const previous = originalByPath.get(reference.pin.path);
    if (previous) equal(previous, reference.pin, 'references', 'Repeated authority has exactly one original byte value');
    else originalByPath.set(reference.pin.path, reference.pin);
  }
  requireData(Array.isArray(manifest.authorities) && manifest.authorities.length === EXPECTED_BUDGETS.authorityPaths
    && originalByPath.size === EXPECTED_BUDGETS.authorityPaths, 'authority_membership', 'Exactly32 unique historical/current authority paths');
  equal(manifest.authorities.map(item => item.path), [...originalByPath.keys()].sort(), 'authority_membership', 'No authority omitted, added, reordered or duplicated');
  const byPath = new Map(); let retainedTotal = 0;
  for (const authority of manifest.authorities) {
    closed(authority, ['path', 'historical', 'current', 'retained', 'references'], 'Closed source authority');
    path(authority.path); pin(authority.historical, EXPECTED_BUDGETS.sourceBytes);
    pin(authority.current, EXPECTED_BUDGETS.sourceBytes); pin(authority.retained, EXPECTED_BUDGETS.sourceBytes);
    equal(authority.historical, originalByPath.get(authority.path), 'historical_reference', 'Original source pin must not be rewritten');
    equal(authority.current.path, authority.path, 'current_path', 'Current bytes belong to the exact same source path');
    equal(authority.retained, { ...authority.historical,
      path: `contracts/mounted-e2e/v1.1/source-authority/accepted45/${authority.path}` }, 'retained_path', 'Original licensed historical bytes have one fixed retained path');
    equal(authority.references, references.filter(item => item.pin.path === authority.path)
      .map(({ owner, pointer }) => ({ owner, pointer })), 'reference_membership', 'Exact old contract/source-pointer membership');
    const changed = EXPECTED_CHANGED_PATHS.includes(authority.path);
    requireData(changed !== isDeepStrictEqual(authority.current, authority.historical), 'change_membership', 'Only the eight declared authority paths may change');
    byPath.set(authority.path, authority); retainedTotal += authority.retained.bytes;
  }
  requireData(retainedTotal <= EXPECTED_BUDGETS.retainedBytes, 'retained_budget', 'Aggregate historical source copy ceiling');
  requireData(Array.isArray(manifest.changes) && manifest.changes.length === 8, 'changes', 'Exactly eight reviewed source deltas');
  equal(manifest.changes.map(item => item.path), EXPECTED_CHANGED_PATHS, 'changes', 'Exact source delta membership/order');
  const changes = new Map();
  for (const [index, change] of manifest.changes.entries()) {
    closed(change, ['path', 'reason', 'delta'], 'Closed reviewed source delta');
    requireData(typeof change.reason === 'string' && change.reason.length > 0 && change.reason.length <= 4096, 'reason', 'Source-authored bounded reason');
    pin(change.delta, EXPECTED_BUDGETS.deltaBytes);
    equal(change.delta.path, `contracts/mounted-e2e/v1.1/source-deltas/osr47/${String(index + 1).padStart(2, '0')}.patch`, 'delta_path', 'Exact independently retained source delta');
    changes.set(change.path, change);
  }
  freeze(manifest);

  async function verifyAuthority(authority) {
    // Every invocation is fresh: historical byte aliases never bypass a changed
    // current-source guard, even after a prior successful initialization/read.
    await readExact(MANIFEST_PIN, 'manifest_pin');
    const current = await readExact(authority.current, 'current_pin');
    const historical = await readExact(authority.retained, 'historical_pin');
    const change = changes.get(authority.path);
    if (change) await readExact(change.delta, 'delta_pin');
    return { current, historical };
  }
  async function verifyAll() {
    await readExact(MANIFEST_PIN, 'manifest_pin');
    for (const original of manifest.frozenContracts) await readExact(original, 'contract_pin');
    for (const authority of manifest.authorities) await verifyAuthority(authority);
    return freeze({ format: 'mounted-corpus-source-continuation-receipt/1',
      scope: 'Exact historical contract authority plus separately verified current source bytes; no editor, native, browser or semantic acceptance result.',
      historicalSource: HISTORICAL_SOURCE, historicalCapabilityAnchor: CAPABILITY_ANCHOR,
      currentProductionAnchor: CURRENT_ANCHOR, continuation: clone(MANIFEST_PIN),
      frozenContracts: clone(manifest.frozenContracts), changedPaths: [...EXPECTED_CHANGED_PATHS],
      authorities: manifest.authorities.map(({ path, historical, current, retained }) =>
        ({ path, historical: clone(historical), current: clone(current), retained: clone(retained) })),
    });
  }
  async function readHistoricalAuthority(authorityPath, maximum) {
    requireData(typeof authorityPath === 'string' && byPath.has(authorityPath), 'authority_path', 'Unknown historical source authority');
    requireData(Number.isSafeInteger(maximum) && maximum >= 0 && maximum <= 268435456, 'read_bound', 'Finite caller read ceiling required');
    const authority = byPath.get(authorityPath);
    requireData(authority.historical.bytes <= maximum, 'read_bound', `Historical authority exceeds caller bound: ${authorityPath}`);
    return (await verifyAuthority(authority)).historical;
  }
  const sourcePaths = freeze([...new Set([SOURCE_CONTINUATION47_PATH, HELPER_PATH, 'tests/mounted-corpus-source-continuation.node.mjs',
    ...manifest.frozenContracts.map(item => item.path), ...manifest.authorities.map(item => item.retained.path),
    ...manifest.changes.map(item => item.delta.path)])].sort());
  const requiredCurrentPaths = freeze(manifest.authorities.map(item => item.path));
  function historicalAuthorityReader(fallbackReader) {
    requireData(typeof fallbackReader === 'function', 'reader', 'Ordinary current-artifact fallback reader required');
    return (artifactPath, maximum) => byPath.has(artifactPath)
      ? readHistoricalAuthority(artifactPath, maximum) : fallbackReader(artifactPath, maximum);
  }
  const runtimePaths = freeze([...new Set([...sourcePaths, ...requiredCurrentPaths])].sort());
  const runtimeBudgets = freeze({ paths: 128, artifactBytes: 1048576, aggregateBytes: 4194304 });
  requireData(runtimePaths.length <= runtimeBudgets.paths, 'runtime_inventory_bound', 'Closed finite continuation runtime inventory');
  const knownRuntimePins = new Map([MANIFEST_PIN, ...manifest.frozenContracts,
    ...manifest.authorities.flatMap(item => [item.current, item.retained]),
    ...manifest.changes.map(item => item.delta)].map(item => [item.path, item]));
  async function captureRuntimeInventory(sourceSHA) {
    requireData(typeof sourceSHA === 'string' && sourceSHA.length === 40 && /^[0-9a-f]{40}$/.test(sourceSHA), 'runtime_source', 'Exact actual runtime source SHA required');
    await verifyAll();
    const pins = []; let aggregateBytes = 0;
    for (const artifactPath of runtimePaths) {
      const expected = knownRuntimePins.get(artifactPath); let bytes;
      if (expected) bytes = await readExact(expected, 'runtime_pin');
      else {
        // Only the fixed helper/control source paths lack an inner hash: the
        // actual outer runtime inventory and v1 scenario pins bind both. The
        // hard manifest cannot contain its importing helper's hash recursively.
        requireData([HELPER_PATH, 'tests/mounted-corpus-source-continuation.node.mjs'].includes(artifactPath),
          'runtime_path', 'Unknown unpinned continuation runtime path');
        try { bytes = await readArtifact(artifactPath, runtimeBudgets.artifactBytes); }
        catch (error) { fail('runtime_pin', `Bounded actual runtime source read failed: ${artifactPath}`, error); }
        requireData(bytes instanceof Uint8Array && bytes.byteLength > 0 && bytes.byteLength <= runtimeBudgets.artifactBytes,
          'runtime_pin', `Original bounded actual runtime bytes required: ${artifactPath}`);
      }
      aggregateBytes += bytes.byteLength;
      requireData(aggregateBytes <= runtimeBudgets.aggregateBytes, 'runtime_inventory_bound', 'Aggregate actual runtime source inventory ceiling');
      pins.push({ path: artifactPath, bytes: bytes.byteLength, sha256: sha(bytes) });
    }
    return freeze({ format: 'mounted-corpus-source-runtime-inventory/1', sourceSHA,
      historicalSource: HISTORICAL_SOURCE, currentProductionAnchor: CURRENT_ANCHOR,
      scope: 'Actual current filesystem bytes for the47 helper, control source, closed manifest, historical copy paths, reviewed deltas and all32 current authority paths. No historical alias reader or semantic acceptance claim.',
      budgets: clone(runtimeBudgets), pins });
  }
  await verifyAll();
  return Object.freeze({ verifyAll, readHistoricalAuthority, historicalAuthorityReader, captureRuntimeInventory, sourcePaths, requiredCurrentPaths });
}
