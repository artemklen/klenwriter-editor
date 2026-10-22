// SPDX-License-Identifier: MIT OR Apache-2.0
// Source authority only: no editor, build, browser or product observations.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { loadMountedSourceContinuation47, SOURCE_CONTINUATION47_PATH } from './source-continuation47.mjs';

export const SOURCE_CONTINUATION48_PATH = 'contracts/mounted-e2e/v1.2/source-continuation48.json';
const HELPER_PATH = 'scripts/mounted-corpus/source-continuation48.mjs';
const CONTROL_PATH = 'tests/mounted-corpus-source-continuation48.node.mjs';
// Deliberately fail closed until the production/generated source is quiet and
// the independently reviewed manifest has been finalized. No draft alias runs.
const MANIFEST_PIN = Object.freeze({ path: SOURCE_CONTINUATION48_PATH,
  bytes: 34648, sha256: '87f7c7b4059b662bcee05f0e90301eb44dcff329a15cc68e22e0bc335ac02ca7' });
const ACCEPTED47 = '753c77aadd5215a5a5f81448b71d45d17d77f85e';
const LEGACY_HELPER = 'scripts/mounted-corpus/source-continuation47.mjs';
const LEGACY_CONTROL = 'tests/mounted-corpus-source-continuation.node.mjs';
const LEGACY_MANIFEST_PIN = Object.freeze({ path: SOURCE_CONTINUATION47_PATH, bytes: 32454,
  sha256: 'd6986b1010d0e8d9d4e1594410d0c92cc695ad27df2d65e77cbcac04a5ba4621' });
const HARNESS_PATHS = Object.freeze(['scripts/mounted-corpus/run.mjs', LEGACY_CONTROL,
  'tests/mounted-corpus-collector.node.mjs', 'tests/mounted-corpus-interactions.node.mjs']);
const BUDGETS = Object.freeze({ manifestBytes: 262144, sourceBytes: 262144, deltaBytes: 65536,
  retainedBytes: 2097152, runtimePaths: 192, runtimeArtifactBytes: 1048576, runtimeAggregateBytes: 8388608 });
const hash = value => createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const freeze = value => {
  if (value && typeof value === 'object') { for (const v of Object.values(value)) freeze(v); Object.freeze(value); }
  return value;
};
function requireData(condition, code, message) {
  if (condition) return;
  const error = new Error(`mounted-corpus.source_continuation48.${code}: ${message}`);
  error.code = `mounted-corpus.source_continuation48.${code}`; throw error;
}
function equal(actual, expected, code, message) { requireData(isDeepStrictEqual(actual, expected), code, message); }
function closed(value, keys, label) {
  requireData(value !== null && typeof value === 'object' && !Array.isArray(value)
    && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort()), 'shape', label);
}
function path(value) {
  requireData(typeof value === 'string' && value.length > 0 && value.length <= 4096
    && !value.startsWith('/') && !value.includes('\\') && !value.includes('\0')
    && !value.split('/').some(p => !p || p === '.' || p === '..'), 'path', 'Canonical repository path');
  return value;
}
function hex(value, length) { return typeof value === 'string' && value.length === length && /^[0-9a-f]+$/.test(value); }
function pin(value, maximum) {
  closed(value, ['path', 'bytes', 'sha256'], 'Closed artifact pin'); path(value.path);
  requireData(Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= maximum
    && hex(value.sha256, 64), 'pin_shape', value.path);
}

/** Validate actual48 first. The only retained47 aliases are the32 authority
 * paths plus original47 control source, each guarded by fresh actual48 bytes.
 * readArtifact remains the original reader for current run/build inventories. */
export async function loadMountedSourceContinuation48({ readArtifact }) {
  requireData(typeof readArtifact === 'function', 'reader', 'Bounded actual current source reader');
  requireData(MANIFEST_PIN.bytes > 0 && hex(MANIFEST_PIN.sha256, 64), 'not_finalized', 'Source pins await production quiet');
  pin(MANIFEST_PIN, BUDGETS.manifestBytes);
  async function readExact(expected, code) {
    const bytes = await readArtifact(expected.path, expected.bytes);
    requireData(bytes instanceof Uint8Array && bytes.byteLength === expected.bytes
      && hash(bytes) === expected.sha256, code, expected.path);
    return Uint8Array.from(bytes);
  }
  const manifestBytes = await readExact(MANIFEST_PIN, 'manifest_pin');
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
  closed(manifest, ['format', 'status', 'id', 'license', 'accepted47Commit', 'currentProductionAnchor',
    'legacy47', 'authorities', 'harness', 'changedPaths', 'changes', 'budgets', 'qualification'], 'Closed48 continuation');
  equal([manifest.format, manifest.status, manifest.id, manifest.license, manifest.accepted47Commit],
    ['mounted-corpus-source-continuation/2', 'FINALIZED_SOURCE_CONTRACT', 'OSR-48', 'MIT OR Apache-2.0', ACCEPTED47], 'manifest', 'Finalized source-only continuation');
  requireData(hex(manifest.currentProductionAnchor, 40), 'anchor', 'Reviewed production anchor, separate from actual runtime HEAD');
  equal(manifest.budgets, BUDGETS, 'budgets', 'Versioned finite48 bounds');
  requireData(typeof manifest.qualification === 'string' && manifest.qualification.length > 0
    && manifest.qualification.length <= 4096, 'qualification', 'Bounded layer qualification');
  closed(manifest.legacy47, ['manifest', 'helper', 'control'], 'Closed47 layer');
  equal(manifest.legacy47.manifest, LEGACY_MANIFEST_PIN, 'legacy_manifest', 'Original47 manifest unchanged');
  pin(manifest.legacy47.helper, BUDGETS.sourceBytes);
  equal(manifest.legacy47.helper.path, LEGACY_HELPER, 'legacy_helper', 'Original47 helper path');
  const legacyBytes = await readExact(LEGACY_MANIFEST_PIN, 'legacy_manifest');
  const legacyManifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(legacyBytes));
  await readExact(manifest.legacy47.helper, 'legacy_helper');
  requireData(Array.isArray(legacyManifest.authorities) && legacyManifest.authorities.length === 32
    && Array.isArray(manifest.authorities) && manifest.authorities.length === 32, 'authority_membership', 'Exact32 inherited authority paths');
  equal(manifest.authorities.map(a => a.path), legacyManifest.authorities.map(a => a.path), 'authority_membership', 'No authority added/removed/reordered');
  requireData(Array.isArray(manifest.harness) && manifest.harness.length === HARNESS_PATHS.length, 'harness', 'Exact harness membership');
  equal(manifest.harness.map(a => a.path), HARNESS_PATHS, 'harness', 'Reader-plumbing-only consumers');
  const current = new Map(); let retainedBytes = 0;
  for (const entry of [...manifest.authorities, ...manifest.harness]) {
    closed(entry, ['path', 'accepted47', 'retained47', 'current48'], 'Closed source lineage'); path(entry.path);
    requireData(!current.has(entry.path), 'authority_membership', 'Unique current source path');
    for (const key of ['accepted47', 'retained47', 'current48']) pin(entry[key], BUDGETS.sourceBytes);
    equal(entry.accepted47.path, entry.path, 'source_path', 'Accepted47 exact path');
    equal(entry.current48.path, entry.path, 'source_path', 'Current48 exact path');
    equal(entry.retained47, { ...entry.accepted47,
      path: `contracts/mounted-e2e/v1.2/source-authority/accepted47/${entry.path}` }, 'retained_path', 'Exact accepted47 byte copy');
    const inherited = legacyManifest.authorities.find(a => a.path === entry.path);
    if (inherited) equal(entry.accepted47, inherited.current, 'accepted47_pin', 'Every47 current authority stays unchanged in the47 layer');
    current.set(entry.path, entry);
    retainedBytes += entry.retained47.bytes;
  }
  requireData(retainedBytes <= BUDGETS.retainedBytes, 'retained_budget', 'Finite accepted47 source copies');
  closed(manifest.legacy47.control, ['accepted47', 'retained47'], 'Original47 control source');
  const control = current.get(LEGACY_CONTROL);
  equal(manifest.legacy47.control, { accepted47: control.accepted47, retained47: control.retained47 }, 'legacy_control', 'Original47 control is explicitly retained');
  const changedPaths = [...current.values()].filter(a => !isDeepStrictEqual(a.accepted47, a.current48)).map(a => a.path).sort();
  equal(manifest.changedPaths, changedPaths, 'change_membership', 'Every and only changed source path');
  requireData(Array.isArray(manifest.changes) && manifest.changes.length === changedPaths.length, 'changes', 'One reviewed delta per changed source');
  equal(manifest.changes.map(c => c.path), changedPaths, 'changes', 'Canonical delta membership');
  const changes = new Map();
  for (const [index, change] of manifest.changes.entries()) {
    closed(change, ['path', 'reason', 'delta'], 'Closed48 source delta');
    requireData(typeof change.reason === 'string' && change.reason.length > 0 && change.reason.length <= 4096, 'reason', change.path);
    pin(change.delta, BUDGETS.deltaBytes);
    equal(change.delta.path, `contracts/mounted-e2e/v1.2/source-deltas/osr48/${String(index + 1).padStart(2, '0')}.patch`, 'delta_path', 'Fixed reviewed48 delta path');
    changes.set(change.path, change.delta);
  }
  freeze(manifest); let inner47;
  async function guards() {
    await readExact(MANIFEST_PIN, 'manifest_pin');
    await readExact(LEGACY_MANIFEST_PIN, 'legacy_manifest');
    await readExact(manifest.legacy47.helper, 'legacy_helper');
  }
  async function verifyEntry(entry) {
    await guards();
    await readExact(entry.current48, 'current48_pin');
    const retained = await readExact(entry.retained47, 'retained47_pin');
    const delta = changes.get(entry.path); if (delta) await readExact(delta, 'delta_pin');
    return retained;
  }
  const authorityPaths = new Set(manifest.authorities.map(a => a.path));
  function retained47SourceReader(fallback) {
    requireData(typeof fallback === 'function', 'reader', 'Original fallback reader');
    return async (artifactPath, maximum) => {
      if (!authorityPaths.has(artifactPath) && artifactPath !== LEGACY_CONTROL) return fallback(artifactPath, maximum);
      const entry = current.get(artifactPath);
      requireData(Number.isSafeInteger(maximum) && maximum >= entry.accepted47.bytes && maximum <= 268435456,
        'read_bound', 'Finite caller bound contains retained47 source');
      return verifyEntry(entry);
    };
  }
  async function verifyAll() {
    await guards(); for (const entry of current.values()) await verifyEntry(entry);
    const legacy = inner47 ? await inner47.verifyAll() : null;
    return freeze({ format: 'mounted-corpus-source-continuation-receipt/2',
      scope: 'Actual48 sources first; unchanged47 helper separately verifies retained47-to-original45 authority. No semantic acceptance.',
      accepted47Commit: ACCEPTED47, currentProductionAnchor: manifest.currentProductionAnchor,
      continuation: clone(MANIFEST_PIN), changedPaths: [...changedPaths],
      authorities: clone(manifest.authorities), harness: clone(manifest.harness), retained47: legacy });
  }
  // Check all actual48 and retained47 bytes BEFORE entering the old47 loader.
  await verifyAll();
  inner47 = await loadMountedSourceContinuation47({ readArtifact: retained47SourceReader(readArtifact) });
  function historicalAuthorityReader(fallback) {
    requireData(typeof fallback === 'function', 'reader', 'Original current run/artifact fallback');
    return async (artifactPath, maximum) => {
      if (!authorityPaths.has(artifactPath)) return fallback(artifactPath, maximum);
      await verifyEntry(current.get(artifactPath));
      return inner47.readHistoricalAuthority(artifactPath, maximum);
    };
  }
  const sourcePaths = freeze([...new Set([SOURCE_CONTINUATION48_PATH, HELPER_PATH, CONTROL_PATH,
    SOURCE_CONTINUATION47_PATH, LEGACY_HELPER, ...inner47.sourcePaths,
    ...[...current.values()].map(a => a.retained47.path), ...[...changes.values()].map(p => p.path)])].sort());
  const requiredCurrentPaths = freeze([...current.keys()].sort());
  const runtimePaths = [...new Set([...sourcePaths, ...requiredCurrentPaths])].sort();
  requireData(runtimePaths.length <= BUDGETS.runtimePaths, 'runtime_inventory_bound', 'Closed actual48 source inventory');
  const known = new Map([MANIFEST_PIN, LEGACY_MANIFEST_PIN, manifest.legacy47.helper,
    ...[...current.values()].flatMap(a => [a.current48, a.retained47]), ...changes.values(),
    ...legacyManifest.frozenContracts, ...legacyManifest.authorities.map(a => a.retained),
    ...legacyManifest.changes.map(a => a.delta)].map(p => [p.path, p]));
  async function captureRuntimeInventory(sourceSHA) {
    requireData(hex(sourceSHA, 40), 'runtime_source', 'Exact actual runtime source SHA');
    await verifyAll(); const pins = []; let aggregate = 0;
    for (const artifactPath of runtimePaths) {
      const expected = known.get(artifactPath); let bytes;
      if (expected) bytes = await readExact(expected, 'runtime_pin');
      else {
        requireData([HELPER_PATH, CONTROL_PATH].includes(artifactPath), 'runtime_path', 'Only importing48 helper/control lack recursive inner hashes');
        bytes = await readArtifact(artifactPath, BUDGETS.runtimeArtifactBytes);
        requireData(bytes instanceof Uint8Array && bytes.byteLength > 0 && bytes.byteLength <= BUDGETS.runtimeArtifactBytes,
          'runtime_pin', 'Actual bounded unaliased helper/control bytes');
      }
      aggregate += bytes.byteLength;
      requireData(aggregate <= BUDGETS.runtimeAggregateBytes, 'runtime_inventory_bound', 'Finite actual inventory bytes');
      pins.push({ path: artifactPath, bytes: bytes.byteLength, sha256: hash(bytes) });
    }
    return freeze({ format: 'mounted-corpus-source-runtime-inventory/2', sourceSHA,
      currentProductionAnchor: manifest.currentProductionAnchor, accepted47Commit: ACCEPTED47,
      scope: 'Original unaliased reader: actual48 sources, unchanged47 helper/manifest, retained45/47 bytes and reviewed deltas. No semantic acceptance.',
      budgets: { paths: BUDGETS.runtimePaths, artifactBytes: BUDGETS.runtimeArtifactBytes, aggregateBytes: BUDGETS.runtimeAggregateBytes }, pins });
  }
  await verifyAll();
  return Object.freeze({ verifyAll, historicalAuthorityReader, retained47SourceReader,
    captureRuntimeInventory, sourcePaths, requiredCurrentPaths });
}
