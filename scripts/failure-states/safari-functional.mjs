// SPDX-License-Identifier: MIT OR Apache-2.0
// Source-only until root reviews this entry and the coherent producer bindings.
// Does not build/start a server; uses only the already running localhost fixture.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { isAbsolute, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { computeSdkBuildIdentity } from '../generate-sdk-types.mjs';
import { computeFailureRuntimeIdentity } from '../build-failure-runtime.mjs';
import { wasmSections, sdkWasmSectionName } from '../seal-sdk-wasm.mjs';
import { currentAssetBinding } from './dom-observation.mjs';
import { currentRuntimeAssetBinding } from './installed-runtime-assets.mjs';
import { createSafariFunctional, safariFunctionalVersion, safariFunctionalUnobserved } from './safari-functional-transport.mjs';
import { pipeline, runtime, browserClean, observeDomFunctional, observeRuntimeFunctional } from './safari-functional-assertions.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => readFileSync(resolve(repository, path));
const pin = path => { const bytes = read(path); return { path, bytes: bytes.length, sha256: sha(bytes) }; };
const json = path => JSON.parse(read(path).toString('utf8'));
const errorData = error => ({ name: error?.name ?? 'Error', message: error?.message ?? String(error), stack: error?.stack ?? null,
  actual: error?.actual, expected: error?.expected, operator: error?.operator });
const methodGate = 'REQUIRED_NETWORK_METHOD_UNOBSERVED';
const scope = 'Actual installed Safari, controlled selected strings/public SDK calls and owned fixture windows. Functional observations only; frozen request/CSP method and installed full gate remain unobserved. Generated-JS pointer detachment is not forced GC, finalizer scheduling or retired native reclamation evidence. No physical input, OS clipboard, capture, production-WASM trap or durable-service claim.';
const jsonValue = (_key, value) => typeof value === 'bigint' ? { type: 'bigint', decimal: value.toString() } : value;
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, jsonValue, 2) + '\n');

function actualSeal(path, buildId, abi) {
  const bytes = new Uint8Array(read(path)), sections = wasmSections(bytes).filter(section => section.name === sdkWasmSectionName);
  assert.equal(sections.length, 1); const section = sections[0]; assert.equal(section.end, bytes.length);
  const metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(section.dataStart, section.end)));
  assert.equal(metadata.format, 'klenwriter-editor-sdk-wasm/1'); assert.equal(metadata.build_id, buildId); assert.equal(metadata.abi, abi);
  assert.equal(metadata.wasm_bytes, section.start); assert.equal(metadata.wasm_sha256, sha(bytes.subarray(0, section.start)));
  return { artifact: pin(path), metadata, qualification: 'Producer file bytes; not Safari delivered-response bytes' };
}
function producerPins() {
  const dom = currentAssetBinding(), runtimeAssets = currentRuntimeAssetBinding();
  const production = json('artifacts/sdk-build-identity.json'), current = computeSdkBuildIdentity();
  assert.equal(production.buildId, current.buildId); assert.deepEqual(production.sourceHashes, current.sourceHashes);
  const fixture = json('artifacts/failure-states/runtime/build.json'), identity = computeFailureRuntimeIdentity(production.buildId);
  assert.equal(fixture.status, 'passed'); assert.equal(fixture.baseBuildId, production.buildId);
  assert.equal(fixture.buildId, identity.buildId); assert.deepEqual(fixture.fixtureSourceHashes, identity.fixtureSourceHashes);
  assert.equal(runtimeAssets.fixtureBuildId, fixture.buildId); assert.equal(runtimeAssets.baseBuildId, production.buildId);
  assert.equal(dom.sourceCommit, runtimeAssets.sourceCommit);
  for (const [path, digest] of Object.entries(fixture.sourceHashes)) assert.equal(sha(read(path)), digest, path);
  for (const artifact of fixture.artifacts) assert.deepEqual(pin(artifact.path), artifact);
  assert.equal(pipeline.rowCount, 11); assert.equal(pipeline.rows.length, 11);
  assert.deepEqual(pipeline.rows.map(row => row.id), Array.from({ length: 11 }, (_, index) => `AC1-${String(index + 1).padStart(2, '0')}`));
  assert.deepEqual(runtime.trapPhases, ['before_dispatch', 'after_publication']);
  const afterTrap = pin('contracts/failure-states/v1/' + runtime.afterTrapPublication);
  assert.equal(afterTrap.bytes, runtime.afterPublicationLiteral.bytes); assert.equal(afterTrap.sha256, runtime.afterPublicationLiteral.sha256);
  const localSources = ['scripts/failure-states/safari-functional.mjs', 'scripts/failure-states/safari-functional-transport.mjs',
    'scripts/failure-states/safari-functional-assertions.mjs', 'scripts/failure-states/installed-safari-capability.mjs',
    'scripts/failure-states/dom-observation.mjs', 'scripts/failure-states/installed-runtime-assets.mjs',
    'tests/failure-dom-browser.spec.js', 'tests/failure-runtime-browser.spec.js', 'spikes/workspace/clipboard-host.js',
    'spikes/workspace/failure-host.js', 'contracts/failure-states/v1/dom-pipeline.json', 'contracts/failure-states/v1/dom-assets.json',
    'contracts/failure-states/v1/runtime-literals.json', 'contracts/failure-states/v1/loading-recovery.json',
    'contracts/failure-states/v1/admission/options.template.json', 'contracts/failure-states/v1/admission/healthy.canonical.json',
    'contracts/failure-states/v1/admission/xprefix.canonical.json', 'contracts/failure-states/v1/admission/after-trap.canonical.json'];
  const artifacts = ['artifacts/sdk-build-identity.json', 'artifacts/sdk-native-manifest.json', 'artifacts/sdk-native-manifest-v2.json',
    'artifacts/sdk-wasm-seal.json', 'artifacts/failure-states/runtime/build.json', 'artifacts/failure-states/runtime/native-manifest.json',
    'artifacts/failure-states/runtime/wasm-seal.json', 'artifacts/failure-states/dom-assets-current.json',
    'artifacts/failure-states/runtime-assets-current.json'];
  const v2 = json('artifacts/sdk-native-manifest-v2.json'), fixtureNative = json('artifacts/failure-states/runtime/native-manifest.json');
  assert.equal(v2.abi, 'editor-sdk/2'); assert.equal(v2.build_id, production.buildId);
  assert.deepEqual(fixtureNative, fixture.nativeManifest); assert.equal(fixtureNative.abi, 'editor-sdk/2'); assert.equal(fixtureNative.build_id, fixture.buildId);
  return { sourceCommit: dom.sourceCommit, production, fixture, localSourcePins: localSources.map(pin), artifactPins: artifacts.map(pin),
    domBinding: dom, runtimeBinding: runtimeAssets,
    productionSeal: actualSeal('packages/wasm/dist/editor_wasm_bg.wasm', production.buildId, 'editor-sdk/1'),
    fixtureSeal: actualSeal('artifacts/failure-states/runtime/editor_wasm_bg.wasm', fixture.buildId, 'editor-sdk/2'),
    methodQualification: 'Expected source-derived asset policies and producer disk hashes only. No Safari request interception, actual delivered body hashes or actual navigation response-header observation.' };
}

export async function runSafariFunctional(outputDirectory) {
  process.chdir(repository);
  assert(isAbsolute(outputDirectory), 'Absolute fresh evidence directory required');
  const output = resolve(outputDirectory), rel = relative(repository, output);
  assert(rel === '..' || rel.startsWith('../'), 'Evidence outside checkout'); assert(!existsSync(output), 'Never overwrite earlier outcome');
  mkdirSync(output, { recursive: true });
  const path = resolve(output, 'report.json'), controlsPath = resolve(output, 'setup.jsonl');
  const selected = [...pipeline.rows.map(row => ({ id: row.id, kind: 'dom', row })),
    ...runtime.trapPhases.map(phase => ({ id: `AC3-${phase}`, kind: 'runtime', phase }))];
  const report = { format: 'osr67-installed-safari-functional-observations/1', status: 'NOT_RUN', methodGate, scope,
    unobserved: safariFunctionalUnobserved, physicalInput: false, osClipboard: false, capture: false, webDriver: false,
    startedAt: new Date().toISOString(), expectedCaseCount: 13, cases: selected.map(item => ({ id: item.id, status: 'NOT_RUN', functionalStatus: 'NOT_RUN' })),
    limits: { rowDeadlineMs: pipeline.shared.completion.wholeRowDeadlineMs, readyMs: pipeline.shared.completion.initialReadyDeadlineMs,
      frameMs: pipeline.shared.completion.animationFrameBoundMs, fixedWindowMs: 250, resultBytes: 4 * 1024 * 1024,
      reportBytes: 16 * 1024 * 1024, controlBytesPerCase: 32 * 1024 * 1024 } };
  const save = () => writeJson(path, report);
  let producer, stop = false, setupBytes = 0;
  const setup = value => {
    const line = JSON.stringify(value) + '\n'; setupBytes += Buffer.byteLength(line); assert(setupBytes <= 1024 * 1024);
    appendFileSync(controlsPath, line, { flag: 'a' });
  };
  save();
  try {
    producer = producerPins(); report.producer = producer;
    report.browser = safariFunctionalVersion({ outputDirectory: output, record: setup });
    report.status = 'RUNNING'; save();
    for (const [index, item] of selected.entries()) {
      if (stop) break;
      const directory = resolve(output, item.id); mkdirSync(directory);
      const current = { format: 'osr67-installed-safari-functional-case/1', id: item.id, kind: item.kind, phase: item.phase,
        status: 'RUNNING', functionalStatus: 'RUNNING', methodGate, unobserved: safariFunctionalUnobserved,
        scope, installed: true, browser: report.browser, sourceCommit: producer.sourceCommit,
        productionBuildId: producer.production.buildId, fixtureBuildId: producer.fixture.buildId,
        producerReport: { path, qualification: 'Parent report retains exact source/build/disk artifact bindings' },
        literal: item.row ?? { phase: item.phase, runtime }, startedAt: new Date().toISOString() };
      const casePath = resolve(directory, 'report.json'), controls = resolve(directory, 'controls.jsonl');
      let adapter, failure, controlBytes = 0;
      const rowStarted = performance.now(), rowDeadline = rowStarted + report.limits.rowDeadlineMs;
      const persist = () => {
        const text = JSON.stringify(current, jsonValue, 2) + '\n'; assert(Buffer.byteLength(text) <= report.limits.reportBytes, 'Bounded complete case report');
        writeFileSync(casePath, text);
      };
      const record = value => {
        const line = JSON.stringify(value) + '\n'; controlBytes += Buffer.byteLength(line);
        assert(controlBytes <= report.limits.controlBytesPerCase, 'Completed control evidence overflow fails'); appendFileSync(controls, line, { flag: 'a' });
      };
      persist();
      try {
        adapter = await createSafariFunctional({ kind: item.kind, directory,
          deadline: rowDeadline, record });
        current.session = adapter.lifecycle; current.ready = await adapter.ready(); browserClean(current.ready); persist();
        if (item.kind === 'dom') await observeDomFunctional(adapter, item.row, current, producer.production.buildId);
        else await observeRuntimeFunctional(adapter, item.phase, current, producer.fixture.buildId);
        // Every assertion is local functional evidence. Full gate remains open.
        assert.deepEqual(producerPins(), producer, 'Current sources and producer bindings unchanged throughout observation');
        current.functionalElapsedMs = performance.now() - rowStarted;
        assert(performance.now() <= rowDeadline, 'Original whole-row functional deadline');
        current.functionalStatus = 'PASSED'; current.status = methodGate;
      } catch (error) {
        failure = error; current.functionalStatus = 'FAILED'; current.status = 'FAILED'; current.originalFailure = errorData(error);
        if (!adapter) {
          stop = true; report.stoppedAfterUnconfirmedWindowCreation = item.id;
          current.creationDisposition = 'Owned-window creation did not return an adapter; ownership/completion is unconfirmed. No replay, no unconfirmed window closure, remaining cases NOT_RUN.';
        }
      } finally {
        if (adapter && !current.disposed) try {
          current.emergencyCleanup = await adapter.call(item.kind === 'dom' ? 'failureAllDisposed' : 'dispose');
          current.emergencyCleanupQualification = 'Actual receipt retained; original failed assertions are not promoted to PASS';
        } catch (error) { current.emergencyCleanupFailure = errorData(error); }
        if (adapter) try { current.windowCleanup = await adapter.close(); }
        catch (error) {
          current.windowCleanupFailure = errorData(error); current.status = 'FAILED'; current.functionalStatus = 'FAILED';
          failure ??= error; stop = true; report.stoppedAfterOwnedWindowCloseFailure = item.id;
        }
        current.finishedAt = new Date().toISOString(); persist();
        report.cases[index] = { id: item.id, kind: item.kind, status: current.status, functionalStatus: current.functionalStatus,
          original: { path: casePath, bytes: readFileSync(casePath).length, sha256: sha(readFileSync(casePath)) },
          controls: existsSync(controls) ? { path: controls, bytes: readFileSync(controls).length, sha256: sha(readFileSync(controls)) } : null,
          actualOwnedWindowClosed: current.windowCleanup?.lifecycle?.closed ?? false,
          originalFailure: current.originalFailure ?? null, cleanupFailure: current.windowCleanupFailure ?? current.emergencyCleanupFailure ?? null };
        save();
      }
      // Independent fresh documents may still be observed after a known failed
      // case if that original owned window was actually closed. No call replay.
      void failure;
    }
    report.functionalStatus = report.cases.length === 13 && report.cases.every(item => item.functionalStatus === 'PASSED') ? 'PASSED' : 'FAILED';
    report.status = report.functionalStatus === 'PASSED' ? methodGate : 'FAILED';
  } catch (error) { report.status = 'FAILED'; report.functionalStatus = 'FAILED'; report.originalFailure = errorData(error); }
  finally { report.finishedAt = new Date().toISOString(); save(); }
  return report;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  assert.equal(process.argv.length, 4, 'Usage: node scripts/failure-states/safari-functional.mjs --out /absolute/fresh/outside-checkout');
  assert.equal(process.argv[2], '--out');
  const result = await runSafariFunctional(process.argv[3]);
  console.log(JSON.stringify({ status: result.status, functionalStatus: result.functionalStatus, methodGate: result.methodGate,
    report: resolve(process.argv[3], 'report.json') }));
  if (result.functionalStatus !== 'PASSED') process.exitCode = 1;
}
