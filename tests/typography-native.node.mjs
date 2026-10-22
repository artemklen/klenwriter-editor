// SPDX-License-Identifier: MIT OR Apache-2.0
// Source-frozen independent native/compiled-WASM oracles. Equality is additional evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = 'contracts/typography/v1/';
const additionalPath = 'crates/kwdj-sdk/tests/support/typography_additional_oracles.json';
const additionalSha256 = '5f07ce04452c865c99ceb5b774f2a86782d3eab0f833db0772f5ab701043ddf1';
const pins = {
  'native-oracles.json': '90871ee58c1b3d826f51304c7d1169bc7634041fe6a46bb57e3dda3c0e42177e',
  'golden-matrix.json': '87d070d14c23e1ec4345b8bd99aae49a0c2c8161cd29778c585d4d2ce9d912e0',
  'source-cms-inventory.json': 'fd68d74d9ae7aa40a953ffbe3290c1c69a8e92e74261423c49e54af7d59a23f2',
  'rules-contract.json': '417e1b11b6d23fc82da7b257feaa266fe9243b4b6b67f77cbd868254bd99e2e1',
  'source-cms-typing-typography.source.txt': '0464e277aeb44f74cc92dee5f1fb7c91b2a59e81bdb91d537685f77630dde9cd',
  'source-cms-typing-typography.spec.source.txt': 'affa250f355a08fc7da2956376622cc7a96cf79c0721faa976f3a6e15c845a9c',
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => readFileSync(root + path);
const json = path => JSON.parse(read(path));

test('typography source authority retains original17 bodies,192 logical records and all69 canonical byte pins', () => {
  for (const [path, hash] of Object.entries(pins)) assert.equal(sha(read(path)), hash, path);
  assert.equal(sha(readFileSync(additionalPath)), additionalSha256);
  const additional = JSON.parse(readFileSync(additionalPath));
  assert.equal(additional.localCaps.length, 10);
  assert.equal(additional.invalidConfigurations.length, 9);
  for (const row of [...additional.localCaps, additional.referenceProtection]) {
    assert.equal(JSON.stringify(JSON.parse(row.beforeCanonical)), row.beforeCanonical);
    assert.equal(JSON.stringify(JSON.parse(row.expectedCanonical)), row.expectedCanonical);
  }
  const native = json('native-oracles.json'), matrix = json('golden-matrix.json'), cms = json('source-cms-inventory.json');
  assert.equal(native.cases.length, 16);
  assert.equal(matrix.cases.length, 192);
  assert.equal(cms.fixtures.length, 17);
  const files = new Map();
  function visit(value) {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    if (typeof value.path === 'string' && value.path.startsWith('native-oracles/canonical/')) {
      assert.match(value.path, /^native-oracles\/canonical\/N\d{2}-[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\.kwdj\.json$/);
      const bytes = read(value.path);
      assert.equal(bytes.length, value.bytes, value.path);
      assert.equal(sha(bytes), value.sha256, value.path);
      assert.notEqual(bytes.at(-1), 10, 'canonical golden has no implicit newline');
      if (files.has(value.path)) assert.deepEqual(files.get(value.path), value);
      files.set(value.path, value);
    }
    Object.values(value).forEach(visit);
  }
  visit(native);
  assert.equal(files.size, 69);
  assert.equal(matrix.cases.filter(row => row.group === 'CMS_SOURCE_PARITY_17').length, 17);
});

test('independent fixed native and compiled WASM witnesses each execute literal oracles, then agree', async () => {
  // Compile/bind step belongs to root's normal check integration. This test never
  // rebuilds or repairs candidate WASM and never derives expected data from native.
  const { default: init, observeTypography } = await import('../artifacts/typography-native/probe.js');
  const wasmBytes = readFileSync('artifacts/typography-native/probe_bg.wasm');
  await init({ module_or_path: wasmBytes });
  const nativeRun = spawnSync('cargo', ['run', '--quiet', '--locked', '-p', 'klenwriter-editor-wasm', '--example', 'typography_native'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  assert.equal(nativeRun.status, 0, nativeRun.stderr);
  const native = JSON.parse(nativeRun.stdout), compiledWasm = JSON.parse(observeTypography());
  for (const report of [native, compiledWasm]) {
    assert.equal(report.task, 'OSR-48');
    assert.equal(report.status, 'passed');
    assert.equal(report.native_oracle_count, 16);
    assert.equal(report.cms_source_bodies, 17);
    assert.equal(report.native_oracles.length, 16);
    assert.equal(report.cms_source_translations.length, 17);
    assert.equal(report.lexical_vectors.length, 31);
    assert.equal(report.lowering_and_config_guards.local_zero_literal_rows.length, 10);
    assert.equal(report.lowering_and_config_guards.over_ceiling_open_refusals.length, 10);
    assert.equal(report.lowering_and_config_guards.closed_config_refusals, 9);
    assert.equal(report.reference_protection.reference_link_literal, true);
    assert.equal(report.native_matrix_rows.filter(row => row.id.includes('-subset-')).length, 12);
    assert.equal(report.qualifications.pure_data_oracles_not_generated_from_output, true);
    for (const row of report.native_oracles) {
      assert.equal(row.fixed_canonical, true, row.id);
      assert.equal(row.identity_state_history_maps, true, row.id);
      assert.equal(row.resources_zero, true, row.id);
    }
  }
  assert.deepEqual(compiledWasm, native, 'native/compiled-WASM equality supplements fixed-oracle checks in both witnesses');
  const sources = [additionalPath, 'crates/kwdj-sdk/tests/typography_v2.rs', 'crates/kwdj-sdk/tests/support/typography_witness.rs', 'crates/wasm/examples/typography_native.rs', 'crates/wasm/examples/typography_probe.rs', 'tests/typography-native.node.mjs', ...Object.keys(pins).map(path => root + path)];
  const sourceHashes = Object.fromEntries(sources.map(path => [path, sha(readFileSync(path))]));
  mkdirSync('artifacts/typography-native', { recursive: true });
  writeFileSync('artifacts/typography-native/report.json', JSON.stringify({ task: 'OSR-48', nativeCompiledWasmEqual: true, wasm: { bytes: wasmBytes.length, sha256: sha(wasmBytes) }, sourceHashes, report: native, qualifications: ['New source-frozen native/compiled-WASM test probe; no production distributable seal, browser or installed-input claim.', 'CMS-T15 runs the explicit owned final-commit content translation; original unowned synthetic trace is a separate DOM zero-submit obligation.', 'Literal-owner matrix rows identify native insertion adapters rather than claiming real paste/drop events.'] }, null, 2) + '\n');
});

test('native work and retained capacity measurements stay inside independently frozen bounds', () => {
  mkdirSync('artifacts/typography-native',{recursive:true});
  const directory=mkdtempSync('artifacts/typography-native/metrics-');
  const output=`${process.cwd()}/${directory}/metrics.json`;
  const sources=['crates/kwdj-sdk/tests/typography_metrics.rs','crates/kwdj/src/commands/typing.rs',
    'crates/engine/src/input_result.rs','crates/bridge/src/input.rs','tests/typography-native.node.mjs'];
  const before=Object.fromEntries(sources.map(path=>[path,sha(readFileSync(path))]));
  const run=spawnSync('cargo',['test','--locked','-p','klenwriter-editor-kwdj-sdk','--test','typography_metrics','--','--nocapture'],
    {encoding:'utf8',maxBuffer:4*1024*1024,env:{...process.env,OSR48_NATIVE_METRICS_OUTPUT:output}});
  writeFileSync(`${directory}/stdout.log`,run.stdout??'');writeFileSync(`${directory}/stderr.log`,run.stderr??'');
  writeFileSync(`${directory}/exit.json`,JSON.stringify({exitCode:run.status,signal:run.signal,error:run.error?.message??null})+'\n');
  assert.equal(run.status,0,run.stderr);assert.equal(run.signal,null);assert.equal(run.error,undefined);
  const report=JSON.parse(readFileSync(output));assert.equal(report.status,'passed');
  assert.equal(report.nativeCases.length,6);assert.equal(report.frozenDashClassCases.length,31);assert.equal(report.bridgeCases.length,36);
  assert.deepEqual(report.sourceBounds,{resultSerializedUtf8Bytes:16384,resultInlinePlusOwnedCapacityBytes:16384,rawRestoreSerializedUtf8Bytes:4096,rawCookedUtf8BytesEach:12});
  assert.equal(report.localFallbackComparison.spentWorkNotReset,true);
  assert.equal(report.qualifications.chargedWorkIsNotHeapOrRss,true);
  assert.equal(report.qualifications.publicCapacityIsRetainedNotTemporaryHighWater,true);
  const after=Object.fromEntries(sources.map(path=>[path,sha(readFileSync(path))]));assert.deepEqual(after,before);
  writeFileSync('artifacts/typography-native/metrics-current.json',JSON.stringify({directory,sourceHashes:after,report},null,2)+'\n');
});
