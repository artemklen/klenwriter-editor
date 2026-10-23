// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  loadMountedSourceContinuation47,
  SOURCE_CONTINUATION47_PATH,
} from '../scripts/mounted-corpus/source-continuation47.mjs';
import { loadMountedSourceContinuation48 } from '../scripts/mounted-corpus/source-continuation48.mjs';
import { loadMountedSourceContinuation66 } from '../scripts/mounted-corpus/source-continuation66.mjs';
import { loadMountedSourceContinuation67 } from '../scripts/mounted-corpus/source-continuation67.mjs';
import { loadMountedResourceProfile67 } from '../scripts/mounted-corpus/resource-profile67.mjs';

// Source-authored finite integrity controls. These do not execute an editor,
// native/WASM candidate, browser, mounted scenario, or semantic oracle.
const ROOT = new URL('../', import.meta.url);
const MAXIMUM = 4 * 1024 * 1024;
// These unchanged assertion bodies control the accepted47 source namespace.
// Actual67 is guarded first; unchanged66/48 supply exact accepted47 input.
// New67 controls independently inspect the original unaliased runtime reader.
const actualSourceReader = async (path, maximum) => {
  const bytes = await readFile(new URL(path, ROOT));
  assert.ok(bytes.byteLength <= maximum, 'Actual48 source read remains bounded');
  return new Uint8Array(bytes);
};
const currentSourceLayer = await loadMountedResourceProfile67({ readArtifact: actualSourceReader });
const c82SourceReader = currentSourceLayer.retainedC82SourceReader(actualSourceReader);
const current67Layer = await loadMountedSourceContinuation67({ readArtifact: c82SourceReader });
const accepted66SourceReader = current67Layer.retained66SourceReader(c82SourceReader);
const current66Layer = await loadMountedSourceContinuation66({ readArtifact: accepted66SourceReader });
const accepted48SourceReader = current66Layer.retained48SourceReader(accepted66SourceReader);
const accepted47Layer = await loadMountedSourceContinuation48({ readArtifact: accepted48SourceReader });
const accepted47SourceReader = accepted47Layer.retained47SourceReader(accepted48SourceReader);
const HISTORICAL_SOURCE = '441bd3b2d7f9b0a40be26877ba74575b8e1882cd';
const CURRENT_ANCHOR = 'e914716db9ed4143bea7e666e8cfb9e03de99479';
const MANIFEST_PATH = 'contracts/mounted-e2e/v1.1/source-continuation47.json';
const MANIFEST_PIN = {
  bytes: 32454,
  sha256: 'd6986b1010d0e8d9d4e1594410d0c92cc695ad27df2d65e77cbcac04a5ba4621',
};
const HELPER_PATH = 'scripts/mounted-corpus/source-continuation47.mjs';
const CHANGED_PATHS = [
  'crates/engine/src/dispatch.rs',
  'crates/engine/src/tree.rs',
  'packages/dom/src/input.ts',
  'packages/dom/src/types.ts',
  'packages/kwdj/src/dom.ts',
  'packages/sdk/src/controller.ts',
  'packages/sdk/src/response.ts',
  'packages/wasm/src/sdk-types-v2.ts',
];
const AUTHORITY_PATHS = [
  'contracts/kwdj/v1/README.md',
  'contracts/kwdj/v1/corpus-package.json',
  'contracts/kwdj/v1/fixture.schema.json',
  'contracts/kwdj/v1/fixtures/deferred.json',
  'contracts/kwdj/v1/fixtures/mixed.json',
  'contracts/kwdj/v1/fixtures/negative.json',
  'contracts/kwdj/v1/fixtures/positive.json',
  'contracts/kwdj/v1/manifest.json',
  'contracts/mounted-e2e/v1/initial-literals.json',
  'contracts/slash/v1/lexical-key-oracles.json',
  'contracts/slash/v1/strings.json',
  'crates/engine/src/dispatch.rs',
  'crates/engine/src/mapping.rs',
  'crates/engine/src/tree.rs',
  'crates/kwdj/src/commands/inline.rs',
  'crates/kwdj/src/edit_normalize.rs',
  'docs/adr/004-canonical-json-v1.md',
  'docs/history.md',
  'packages/dom/src/input.ts',
  'packages/dom/src/selection.ts',
  'packages/dom/src/types.ts',
  'packages/kwdj/src/dom.ts',
  'packages/kwdj/src/index.ts',
  'packages/sdk/src/context.ts',
  'packages/sdk/src/controller.ts',
  'packages/sdk/src/data.ts',
  'packages/sdk/src/response.ts',
  'packages/ui/src/drag-owner.ts',
  'packages/ui/src/slash-window.ts',
  'packages/ui/src/types.ts',
  'packages/wasm/src/sdk-types-v2.ts',
  'packages/wasm/src/sdk-types.ts',
];
// Ordered source lists independently preserve every original JSON pointer,
// including the three paths named by both frozen authority owners.
const ACCEPTED_SOURCE_PATHS = [
  'contracts/kwdj/v1/corpus-package.json',
  'contracts/kwdj/v1/manifest.json',
  'contracts/kwdj/v1/fixture.schema.json',
  'contracts/kwdj/v1/README.md',
  'contracts/kwdj/v1/fixtures/positive.json',
  'contracts/kwdj/v1/fixtures/negative.json',
  'contracts/kwdj/v1/fixtures/mixed.json',
  'contracts/kwdj/v1/fixtures/deferred.json',
  'packages/wasm/src/sdk-types.ts',
  'packages/wasm/src/sdk-types-v2.ts',
  'packages/sdk/src/controller.ts',
  'packages/sdk/src/response.ts',
  'packages/sdk/src/context.ts',
  'packages/sdk/src/data.ts',
  'packages/dom/src/types.ts',
  'packages/ui/src/types.ts',
  'packages/kwdj/src/index.ts',
  'packages/kwdj/src/dom.ts',
  'crates/engine/src/tree.rs',
  'crates/engine/src/mapping.rs',
  'crates/engine/src/dispatch.rs',
  'crates/kwdj/src/commands/inline.rs',
  'crates/kwdj/src/edit_normalize.rs',
  'docs/history.md',
  'docs/adr/004-canonical-json-v1.md',
];
const INTERACTION_SOURCE_PATHS = [
  'contracts/slash/v1/lexical-key-oracles.json',
  'contracts/slash/v1/strings.json',
  'contracts/mounted-e2e/v1/initial-literals.json',
  'packages/ui/src/types.ts',
  'packages/ui/src/drag-owner.ts',
  'packages/dom/src/types.ts',
  'packages/dom/src/input.ts',
  'packages/ui/src/slash-window.ts',
  'packages/dom/src/selection.ts',
  'packages/kwdj/src/index.ts',
];
const FROZEN_CONTRACTS = [
  {
    path: 'contracts/mounted-e2e/v1/source-pins.json',
    bytes: 11465,
    sha256: '3d3002372f5948862347c3304aacaddf96b1e8c1119741cf7e3741e4567a07a0',
  },
  {
    path: 'contracts/mounted-e2e/v1/interaction-literals.json',
    bytes: 23307,
    sha256: '89c459197d4070008c12c16918bbb994e1ff3fdb78b06a5c71a11a22cc67213f',
  },
  {
    path: 'contracts/mounted-e2e/v1/manifest.json',
    bytes: 480097,
    sha256: '16e1088e27ed1f8664540d3aa0cf607b6810394f3632798a78115718ebd763fa',
  },
];

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sorted(values) {
  return [...values].sort();
}

function corrupt(bytes) {
  assert.ok(bytes.byteLength > 0, 'Control requires a nonempty artifact');
  const changed = Buffer.from(bytes);
  changed[changed.length - 1] ^= 1;
  return changed;
}

function readerWith(overrides = new Map()) {
  return async (path, maximum) => {
    const bytes = overrides.has(path)
      ? Buffer.from(overrides.get(path))
      : await accepted47SourceReader(path, maximum);
    assert.ok(Number.isSafeInteger(maximum) && maximum >= 0, 'Bounded reader maximum');
    assert.ok(bytes.byteLength <= maximum, `Fixture artifact exceeds maximum: ${path}`);
    return new Uint8Array(bytes);
  };
}

async function manifestFixture() {
  const bytes = await readerWith()(MANIFEST_PATH, MAXIMUM);
  assert.equal(bytes.byteLength, MANIFEST_PIN.bytes);
  assert.equal(digest(bytes), MANIFEST_PIN.sha256);
  return JSON.parse(Buffer.from(bytes).toString('utf8'));
}

function continuationError(error) {
  assert.equal(typeof error?.code, 'string');
  assert.match(error.code, /^mounted-corpus\.source_continuation\./);
  return true;
}

async function rejectsLoad(overrides) {
  await assert.rejects(
    () => loadMountedSourceContinuation47({ readArtifact: readerWith(overrides) }),
    continuationError,
  );
}

test('continuation retains all 35 frozen references, 32 authorities, and exactly 8 declared changes', async () => {
  assert.equal(SOURCE_CONTINUATION47_PATH, MANIFEST_PATH);
  const manifest = await manifestFixture();
  assert.deepEqual(manifest.frozenContracts, FROZEN_CONTRACTS);
  assert.deepEqual(sorted(manifest.authorities.map(({ path }) => path)), AUTHORITY_PATHS);
  assert.deepEqual(sorted(manifest.changedPaths), CHANGED_PATHS);
  const references = manifest.authorities.flatMap(({ path, references: refs }) =>
    refs.map(({ owner, pointer }) => `${owner}#${pointer}=${path}`));
  const expectedReferences = [
    ...ACCEPTED_SOURCE_PATHS.map((path, index) =>
      `contracts/mounted-e2e/v1/source-pins.json#/acceptedSourceFiles/${index}=${path}`),
    ...INTERACTION_SOURCE_PATHS.map((path, index) =>
      `contracts/mounted-e2e/v1/interaction-literals.json#/sourcePins/${index}=${path}`),
  ];
  assert.equal(references.length, 35);
  assert.deepEqual(sorted(references), sorted(expectedReferences));

  const continuation = await loadMountedSourceContinuation47({ readArtifact: readerWith() });
  const receipt = await continuation.verifyAll();
  assert.equal(receipt.format, 'mounted-corpus-source-continuation-receipt/1');
  assert.equal(receipt.historicalSource, HISTORICAL_SOURCE);
  assert.equal(receipt.currentProductionAnchor, CURRENT_ANCHOR);
  assert.equal(receipt.authorities.length, 32);
  assert.deepEqual(sorted(receipt.changedPaths), CHANGED_PATHS);
  assert.deepEqual(sorted(receipt.authorities.map(({ path }) => path)), AUTHORITY_PATHS);
  for (const authority of receipt.authorities) {
    const declared = manifest.authorities.find(({ path }) => path === authority.path);
    assert.deepEqual(authority.historical, declared.historical);
    assert.deepEqual(authority.current, declared.current);
    assert.deepEqual(authority.retained, declared.retained);
    assert.equal(authority.retained.bytes, authority.historical.bytes);
    assert.equal(authority.retained.sha256, authority.historical.sha256);
  }
  const actualChanges = receipt.authorities.filter(({ historical, current }) =>
    historical.bytes !== current.bytes || historical.sha256 !== current.sha256);
  assert.deepEqual(sorted(actualChanges.map(({ path }) => path)), CHANGED_PATHS);
  assert.deepEqual(sorted(continuation.requiredCurrentPaths), AUTHORITY_PATHS);
  const expectedSourcePaths = [
    MANIFEST_PATH,
    HELPER_PATH,
    'tests/mounted-corpus-source-continuation.node.mjs',
    ...FROZEN_CONTRACTS.map(({ path }) => path),
    ...manifest.authorities.map(({ retained }) => retained.path),
    ...manifest.changes.map(({ delta }) => delta.path),
  ];
  assert.equal(expectedSourcePaths.length, 46);
  assert.equal(new Set(continuation.sourcePaths).size, 46);
  assert.deepEqual(sorted(continuation.sourcePaths), sorted(expectedSourcePaths));
});

test('all eight current changed authorities remain exact pins', async () => {
  for (const path of CHANGED_PATHS) {
    const current = await readerWith()(path, MAXIMUM);
    await rejectsLoad(new Map([[path, corrupt(current)]]));
  }
});

test('an unchanged authority cannot acquire an undeclared change', async () => {
  const path = 'crates/engine/src/mapping.rs';
  const bytes = await readerWith()(path, MAXIMUM);
  await rejectsLoad(new Map([[path, corrupt(bytes)]]));
});

test('retained historical bytes are checked for changed and unchanged authorities', async () => {
  const manifest = await manifestFixture();
  for (const path of ['crates/engine/src/dispatch.rs', 'crates/engine/src/mapping.rs']) {
    const authority = manifest.authorities.find((entry) => entry.path === path);
    const bytes = await readerWith()(authority.retained.path, MAXIMUM);
    await rejectsLoad(new Map([[authority.retained.path, corrupt(bytes)]]));
  }
});

test('each frozen original authority owner and mounted manifest remains exact', async () => {
  for (const { path } of FROZEN_CONTRACTS) {
    const bytes = await readerWith()(path, MAXIMUM);
    await rejectsLoad(new Map([[path, corrupt(bytes)]]));
  }
});

test('all eight source-delta artifacts remain exact pins', async () => {
  const manifest = await manifestFixture();
  assert.deepEqual(sorted(manifest.changes.map(({ path }) => path)), CHANGED_PATHS);
  for (const { delta } of manifest.changes) {
    const bytes = await readerWith()(delta.path, MAXIMUM);
    await rejectsLoad(new Map([[delta.path, corrupt(bytes)]]));
  }
});

const manifestMutations = [
  ['one byte changes', (manifest) => { manifest.status += '_ALTERED'; }],
  ['current hash changes', (manifest) => { manifest.authorities[0].current.sha256 = '0'.repeat(64); }],
  ['an authority is dropped', (manifest) => { manifest.authorities.pop(); }],
  ['a duplicate-owner reference is dropped', (manifest) => {
    manifest.authorities.find(({ path }) => path === 'packages/dom/src/types.ts').references.pop();
  }],
  ['the closed manifest gains an extra member', (manifest) => { manifest.acceptUnknownSource = true; }],
];
for (const [label, mutate] of manifestMutations) {
  test(`the immutable continuation manifest rejects when ${label}`, async () => {
    const manifest = await manifestFixture();
    mutate(manifest);
    const changed = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    await rejectsLoad(new Map([[MANIFEST_PATH, changed]]));
  });
}

test('historical reads recheck current source after construction', async () => {
  const path = 'crates/engine/src/dispatch.rs';
  const overrides = new Map();
  const readArtifact = readerWith(overrides);
  const continuation = await loadMountedSourceContinuation47({ readArtifact });
  overrides.set(path, corrupt(await readArtifact(path, MAXIMUM)));
  await assert.rejects(
    () => continuation.readHistoricalAuthority(path, MAXIMUM),
    continuationError,
  );
});

test('historical reads recheck retained bytes after construction', async () => {
  const path = 'packages/dom/src/types.ts';
  const manifest = await manifestFixture();
  const authority = manifest.authorities.find((entry) => entry.path === path);
  const overrides = new Map();
  const readArtifact = readerWith(overrides);
  const continuation = await loadMountedSourceContinuation47({ readArtifact });
  overrides.set(authority.retained.path, corrupt(await readArtifact(authority.retained.path, MAXIMUM)));
  await assert.rejects(
    () => continuation.readHistoricalAuthority(path, MAXIMUM),
    continuationError,
  );
});

test('historical reads recheck the manifest after construction', async () => {
  const overrides = new Map();
  const readArtifact = readerWith(overrides);
  const continuation = await loadMountedSourceContinuation47({ readArtifact });
  overrides.set(MANIFEST_PATH, corrupt(await readArtifact(MANIFEST_PATH, MAXIMUM)));
  await assert.rejects(
    () => continuation.readHistoricalAuthority('packages/dom/src/types.ts', MAXIMUM),
    continuationError,
  );
});

test('explicit historical reads reject every path outside the closed authority set', async () => {
  const continuation = await loadMountedSourceContinuation47({ readArtifact: readerWith() });
  for (const path of [
    'observations/current-run.json',
    'packages/dom/src/clipboard.ts',
    '../packages/dom/src/types.ts',
    'packages/dom/src/./types.ts',
  ]) {
    await assert.rejects(
      () => continuation.readHistoricalAuthority(path, MAXIMUM),
      continuationError,
    );
  }
});

test('an explicit historical read cannot exceed its caller byte ceiling', async () => {
  const path = 'crates/engine/src/dispatch.rs';
  const manifest = await manifestFixture();
  const authority = manifest.authorities.find((entry) => entry.path === path);
  const continuation = await loadMountedSourceContinuation47({ readArtifact: readerWith() });
  await assert.rejects(
    () => continuation.readHistoricalAuthority(path, authority.historical.bytes - 1),
    continuationError,
  );
});

test('the historical alias rechecks current authority bytes and never falls back for an authority', async () => {
  const path = 'packages/dom/src/input.ts';
  const overrides = new Map();
  const readArtifact = readerWith(overrides);
  const continuation = await loadMountedSourceContinuation47({ readArtifact });
  let fallbackCalls = 0;
  const historicalReader = continuation.historicalAuthorityReader(async () => {
    fallbackCalls += 1;
    throw new Error('An authority must not reach the fallback reader');
  });
  const before = await historicalReader(path, MAXIMUM);
  assert.ok(before.byteLength > 0);
  assert.equal(fallbackCalls, 0);
  overrides.set(path, corrupt(await readArtifact(path, MAXIMUM)));
  await assert.rejects(() => historicalReader(path, MAXIMUM), continuationError);
  assert.equal(fallbackCalls, 0);
});

test('ordinary observation artifacts pass unchanged through the fallback reader', async () => {
  const continuation = await loadMountedSourceContinuation47({ readArtifact: readerWith() });
  const path = 'observations/current-run.json';
  const bytes = Buffer.from('{"format":"current-observation/1","run":"present"}\n');
  const calls = [];
  const historicalReader = continuation.historicalAuthorityReader(async (actualPath, maximum) => {
    calls.push({ path: actualPath, maximum });
    return new Uint8Array(bytes);
  });
  const actual = await historicalReader(path, 256);
  assert.deepEqual(Buffer.from(actual), bytes);
  assert.deepEqual(calls, [{ path, maximum: 256 }]);
});

test('historical authority bytes cannot substitute for current production source verification', async () => {
  const manifest = await manifestFixture();
  const path = 'crates/engine/src/dispatch.rs';
  const authority = manifest.authorities.find((entry) => entry.path === path);
  const readArtifact = readerWith();
  const continuation = await loadMountedSourceContinuation47({ readArtifact });
  const historicalReader = continuation.historicalAuthorityReader(readArtifact);
  const current = await readArtifact(path, MAXIMUM);
  const historical = await historicalReader(path, MAXIMUM);
  assert.equal(current.byteLength, authority.current.bytes);
  assert.equal(digest(current), authority.current.sha256);
  assert.equal(historical.byteLength, authority.historical.bytes);
  assert.equal(digest(historical), authority.historical.sha256);
  assert.notEqual(digest(current), digest(historical));
  assert.deepEqual(Buffer.from(await readArtifact(path, MAXIMUM)), Buffer.from(current));
  // Supplying an alias to a new current-source verifier must fail its current
  // pin; this is an integrity control, not an actual runtime measurement.
  await assert.rejects(
    () => loadMountedSourceContinuation47({ readArtifact: historicalReader }),
    continuationError,
  );
});

test('runtime inventory captures all 78 exact current artifacts through the original reader', async () => {
  const readArtifact = readerWith();
  const continuation = await loadMountedSourceContinuation47({ readArtifact });
  // This finite integrity control supplies a named source identifier; it does
  // not assert that a Git checkout or an editor runtime was measured here.
  const inventory = await continuation.captureRuntimeInventory(CURRENT_ANCHOR);
  assert.deepEqual(sorted(Object.keys(inventory)), sorted([
    'format', 'sourceSHA', 'historicalSource', 'currentProductionAnchor', 'scope', 'budgets', 'pins',
  ]));
  assert.equal(inventory.format, 'mounted-corpus-source-runtime-inventory/1');
  assert.equal(inventory.sourceSHA, CURRENT_ANCHOR);
  assert.equal(inventory.historicalSource, HISTORICAL_SOURCE);
  assert.equal(inventory.currentProductionAnchor, CURRENT_ANCHOR);
  assert.equal(typeof inventory.scope, 'string');
  assert.ok(inventory.scope.length > 0);
  assert.deepEqual(inventory.budgets, {
    paths: 128,
    artifactBytes: 1048576,
    aggregateBytes: 4194304,
  });
  const paths = sorted(new Set([
    ...continuation.sourcePaths,
    ...continuation.requiredCurrentPaths,
  ]));
  assert.equal(paths.length, 78);
  assert.equal(inventory.pins.length, 78);
  assert.equal(new Set(inventory.pins.map(({ path }) => path)).size, 78);
  assert.deepEqual(inventory.pins.map(({ path }) => path), paths);
  let totalBytes = 0;
  for (const pin of inventory.pins) {
    assert.deepEqual(sorted(Object.keys(pin)), ['bytes', 'path', 'sha256']);
    const actual = await readArtifact(pin.path, inventory.budgets.artifactBytes);
    assert.equal(pin.bytes, actual.byteLength, pin.path);
    assert.equal(pin.sha256, digest(actual), pin.path);
    assert.ok(pin.bytes > 0 && pin.bytes <= inventory.budgets.artifactBytes, pin.path);
    totalBytes += pin.bytes;
  }
  assert.ok(totalBytes <= inventory.budgets.aggregateBytes);

  const path = 'packages/dom/src/types.ts';
  const currentPin = inventory.pins.find((pin) => pin.path === path);
  assert.deepEqual(currentPin, {
    path,
    bytes: 19087,
    sha256: '4c47d67819e998fa59cd4513be01dca59a377f51b2b803f12167b276dc928c62',
  });
  const historical = await continuation.readHistoricalAuthority(path, MAXIMUM);
  assert.equal(historical.byteLength, 16719);
  assert.equal(digest(historical), 'acf7cadb69c9ff6428a904b2d84ad37e2a4e5c396e44631446e3c9141071db3f');
  assert.notEqual(currentPin.sha256, digest(historical));
});

test('runtime inventory rechecks current pins after construction', async () => {
  const path = 'packages/dom/src/types.ts';
  const overrides = new Map();
  const readArtifact = readerWith(overrides);
  const continuation = await loadMountedSourceContinuation47({ readArtifact });
  overrides.set(path, corrupt(await readArtifact(path, MAXIMUM)));
  await assert.rejects(
    () => continuation.captureRuntimeInventory(CURRENT_ANCHOR),
    continuationError,
  );
});

test('runtime inventory rejects malformed source identifiers', async () => {
  const continuation = await loadMountedSourceContinuation47({ readArtifact: readerWith() });
  for (const sourceSHA of [undefined, null, 47, '', 'a'.repeat(39), 'a'.repeat(41), 'g'.repeat(40)]) {
    await assert.rejects(
      () => continuation.captureRuntimeInventory(sourceSHA),
      continuationError,
    );
  }
});


// Independently invalid despite40 valid hexadecimal characters: JavaScript's
// end assertion may match before a final line terminator; exact length is part
// of the closed identifier contract. Existing malformed vectors stay above.
test('runtime inventory rejects40hex followed by any final line terminator', async () => {
  const continuation = await loadMountedSourceContinuation47({ readArtifact: readerWith() });
  for (const suffix of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
    await assert.rejects(
      () => continuation.captureRuntimeInventory('a'.repeat(40) + suffix),
      continuationError,
    );
  }
});
