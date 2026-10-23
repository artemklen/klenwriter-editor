// SPDX-License-Identifier: MIT OR Apache-2.0
// Genuine compiled traps in an isolated fixture composition, not production WASM
// or physical input. Recovery is an explicit host action in a fresh document.
import { test, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { computeSdkBuildIdentity } from '../scripts/generate-sdk-types.mjs';
import { computeFailureRuntimeIdentity } from '../scripts/build-failure-runtime.mjs';
import { wasmSections, sdkWasmSectionName } from '../scripts/seal-sdk-wasm.mjs';

const root = 'contracts/failure-states/v1';
const read = path => readFileSync(path);
const json = path => JSON.parse(read(path).toString('utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
const pin = path => { const bytes = read(path); return { path, bytes: bytes.length, sha256: sha(bytes) }; };
const literals = json(`${root}/runtime-literals.json`), loading = json(`${root}/loading-recovery.json`);
const nativeZero = { sessions: 0, snapshot_handles: 0, snapshot_bytes: '0', protected_cursors: 0 };
const invoke = (page, method, ...args) => page.evaluate(({ method, args }) => globalThis.failureRuntimeFixture[method](...args), { method, args });
const scope = 'Actual bundled browser, public mounted SDK and source-bound test-only Rust/WASM composition with explicit compiled traps. Distinct fixture build identity; no production-WASM, installed browser, physical input or arbitrary in-commit fault claim.';

function producerBinding() {
  const production = json('artifacts/sdk-build-identity.json'), current = computeSdkBuildIdentity();
  assert.equal(production.buildId, current.buildId); assert.deepEqual(production.sourceHashes, current.sourceHashes);
  const build = json('artifacts/failure-states/runtime/build.json');
  assert.equal(build.format, 'editor-failure-runtime-build/1'); assert.equal(build.status, 'passed');
  assert.equal(build.baseBuildId, production.buildId); assert.notEqual(build.buildId, production.buildId);
  const computed = computeFailureRuntimeIdentity(production.buildId);
  assert.equal(computed.buildId, build.buildId); assert.deepEqual(computed.fixtureSourceHashes, build.fixtureSourceHashes);
  for (const [path, digest] of Object.entries(build.sourceHashes)) assert.equal(sha(read(path)), digest, `Current fixture source: ${path}`);
  assert(build.commands.length > 0); for (const command of build.commands) { assert.equal(command.exitCode, 0); assert.equal(command.signal, null); }
  for (const artifact of build.artifacts) assert.deepEqual(pin(artifact.path), artifact, `Exact built fixture artifact: ${artifact.path}`);
  const native = json('artifacts/failure-states/runtime/native-manifest.json');
  assert.deepEqual(native, build.nativeManifest); assert.equal(native.abi, 'editor-sdk/2'); assert.equal(native.build_id, build.buildId);
  assert.deepEqual(native.profiles.map(profile => profile.profile_id), ['org.klenwriter.kwdj']);
  const wasmPath = 'artifacts/failure-states/runtime/editor_wasm_bg.wasm', wasm = new Uint8Array(read(wasmPath));
  const seals = wasmSections(wasm).filter(section => section.name === sdkWasmSectionName);
  assert.equal(seals.length, 1); const section = seals[0]; assert.equal(section.end, wasm.length);
  const seal = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(wasm.subarray(section.dataStart, section.end)));
  const sealRecord = json('artifacts/failure-states/runtime/wasm-seal.json');
  assert.equal(seal.format, 'klenwriter-editor-sdk-wasm/1'); assert.equal(seal.abi, 'editor-sdk/2');
  assert.equal(seal.build_id, build.buildId); assert.equal(seal.wasm_bytes, section.start);
  assert.equal(seal.wasm_sha256, sha(wasm.subarray(0, section.start)));
  for (const [key, value] of Object.entries(seal)) assert.deepEqual(sealRecord[key], value);
  assert.deepEqual(sealRecord.sealed, pin(wasmPath)); assert.equal(sealRecord.nativeAndRawAndSealedManifestsEqual, true);
  const sources = ['tests/failure-runtime-browser.spec.js', 'spikes/workspace/failure-host.js', 'spikes/workspace/failure-host.html',
    'scripts/workspace-server.mjs', 'contracts/failure-states/v1/runtime-literals.json', 'contracts/failure-states/v1/loading-recovery.json',
    'contracts/failure-states/v1/admission/options.template.json', ...[...new Set([literals.healthy, literals.afterExplicitXEdit,
      literals.beforeTrapDispatch, literals.afterTrapPublication, literals.coherentRecoveryInput])].map(path => `${root}/${path}`)];
  const sourcePins = sources.map(pin), afterPublication = pin(`${root}/${literals.afterTrapPublication}`);
  assert.equal(afterPublication.bytes, literals.afterPublicationLiteral.bytes); assert.equal(afterPublication.sha256, literals.afterPublicationLiteral.sha256);
  assert.equal(literals.format, 'editor-failure-states/runtime-literals/1');
  assert.deepEqual(literals.trapPhases, ['before_dispatch', 'after_publication']);
  assert.equal(loading.outcomes.retiredRuntime, 'sdk.runtime_retired');
  return { sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), production, build, seal,
    sourcePins, artifactPins: ['artifacts/failure-states/runtime/build.json', 'artifacts/failure-states/runtime/wasm-seal.json',
      'artifacts/sdk-build-identity.json', 'packages/dom/dist/style.css'].map(pin) };
}
const canonical = name => read(`${root}/${name}`).toString('utf8');
function ownZero(value, path = 'resources') {
  for (const [key, child] of Object.entries(value)) {
    const at = `${path}.${key}`;
    if (key === 'lifecycle') { expect(child, at).toBe('destroyed'); continue; }
    if (child && typeof child === 'object') ownZero(child, at);
    else { expect(typeof child, at).toBe('number'); expect(child, at).toBe(0); }
  }
}
function fatal(response, code, mayHaveCommitted) {
  expect(response.status).toBe('fatal'); expect(response.diagnostic.code).toBe(code);
  expect(response.diagnostic.may_have_committed).toBe(mayHaveCommitted);
  expect(response.diagnostic.category).toBe('transport'); expect(response.diagnostic.path).toBe('');
  expect(response.diagnostic.details).toEqual({});
}
function live(point, buildId, expectedCanonical) {
  expect(point.canonical).toBe(expectedCanonical); expect(point.host.coherent).toBe(expectedCanonical);
  expect(point.host.lifecycle).toBe('ready'); expect(point.host.contenteditable).toBe('true');
  expect(point.host.actualInstances).toBe(1); expect(point.host.fixtureBuildId).toBe(buildId);
  expect(point.host.nativeBaseline).toEqual(nativeZero);
  expect(point.native).toEqual({ sessions: 2, snapshot_handles: 0, snapshot_bytes: '0', protected_cursors: 2 });
  expect(point.host.runtimeErrors).toEqual([]); expect(point.host.refusals).toEqual([]);
  expect(point.host.resources.sdk.sessions).toBe(1); expect(point.host.peerResources.sessions).toBe(1);
}

for (const phase of literals.trapPhases) test(`finite compiled runtime trap ${phase} and explicit fresh-realm recovery`, async ({ browser }, info) => {
  const report = { format: 'osr67-ac3-runtime-browser-observation/1', phase, engine: info.project.name, installed: false,
    scope, status: 'RUNNING', browserErrors: [], checkpoints: [] };
  let context, page, failure, disposed = false, binding;
  const browserIssue = value => {
    if (report.browserErrors.length < 32) report.browserErrors.push(value);
    else report.errorOverflow = true;
  };
  try {
    binding = producerBinding(); report.producer = binding;
    context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1024, height: 768 } });
    await context.addInitScript(() => {
      const errors = []; let overflow = false;
      const put = value => { if (errors.length < 32) errors.push(value); else overflow = true; };
      addEventListener('unhandledrejection', event => put({ kind: 'unhandledrejection', message: String(event.reason) }));
      addEventListener('securitypolicyviolation', event => put({ kind: 'csp', directive: event.violatedDirective, blocked: event.blockedURI }));
      Object.defineProperty(globalThis, '__failureBrowserErrors', { value: () => ({ errors, overflow }) });
    });
    context.on('page', current => {
      current.on('pageerror', error => browserIssue({ kind: 'pageerror', name: error.name, message: error.message }));
      current.on('console', message => { if (message.type() === 'error') browserIssue({ kind: 'console', message: message.text() }); });
      current.on('dialog', async dialog => { browserIssue({ kind: 'dialog', type: dialog.type(), message: dialog.message() }); await dialog.dismiss(); });
    });
    context.on('requestfailed', request => browserIssue({ kind: 'requestfailed', url: request.url(), error: request.failure()?.errorText }));
    context.on('response', response => { if (response.status() >= 400) browserIssue({ kind: 'http', url: response.url(), status: response.status() }); });
    page = await context.newPage();
    const response = await page.goto('http://127.0.0.1:4174/failure'); expect(response.status()).toBe(200);
    report.csp = response.headers()['content-security-policy'];
    expect(report.csp).toContain("default-src 'none'"); expect(report.csp).toContain("'wasm-unsafe-eval'");
    expect(report.csp).not.toMatch(/'unsafe-inline'|'unsafe-eval'/);
    await page.waitForFunction(() => globalThis.failureRuntimeReady === true);
    report.initial = await invoke(page, 'checkpoint');
    live(report.initial, binding.build.buildId, canonical(literals.healthy));
    expect(report.initial.host.recoveredFrom).toBeNull(); expect(report.initial.host.hostUnsaved).toBe(false);
    expect(report.initial.state.stamp.revision).toBe('0'); expect(report.initial.state.dirty).toBe(false);
    report.edit = await invoke(page, 'edit', literals.initialEdit);
    expect(report.edit.response.status).toBe('ok'); expect(report.edit.response.value.kind).toBe('mutation');
    report.coherent = await invoke(page, 'checkpoint'); live(report.coherent, binding.build.buildId, canonical(literals.afterExplicitXEdit));
    expect(report.coherent.state.stamp.revision).toBe('1'); expect(report.coherent.state.dirty).toBe(true);
    expect(report.coherent.state.saved_revision).toBe('0'); expect(report.coherent.state.history.undo_entries).toBe('1');
    expect(report.coherent.host.hostUnsaved).toBe(true); expect(report.coherent.host.durable).toBe(canonical(literals.healthy));
    report.trap = await invoke(page, 'trap', phase, literals.attemptedInput);
    fatal(report.trap.response, 'sdk.transport_failure', true);
    const witness = report.trap.witness, afterPublication = phase === 'after_publication';
    expect(Buffer.byteLength(JSON.stringify(witness))).toBeLessThanOrEqual(131072); expect(witness.phase).toBe(phase);
    expect(witness.state.status).toBe('ok'); expect(witness.state.value.kind).toBe('state');
    const state = witness.state.value.state;
    expect(state.stamp.session).toBe(report.coherent.state.stamp.session); expect(state.stamp.generation).toBe(report.coherent.state.stamp.generation);
    expect(state.stamp.revision).toBe(afterPublication ? '2' : '1'); expect(state.dirty).toBe(true); expect(state.saved_revision).toBe('0');
    expect(state.history.undo_entries).toBe(afterPublication ? '2' : '1'); expect(state.history.redo_entries).toBe('0');
    expect(witness.snapshot.status).toBe('ok'); expect(witness.snapshot.value.kind).toBe('snapshot');
    expect(witness.snapshot.value.canonical_json).toBe(canonical(afterPublication ? literals.afterTrapPublication : literals.beforeTrapDispatch));
    expect(witness.snapshot.value.stamp).toEqual(state.stamp);
    expect(witness.native_resources_before_trap).toEqual({ sessions: 1, snapshot_handles: 0, snapshot_bytes: '0', protected_cursors: 1 });
    expect(witness.events.status).toBe('ok'); expect(witness.events.value.kind).toBe('events'); expect(witness.events.value.gap).toBe(false);
    if (afterPublication) {
      expect(typeof witness.completed_response).toBe('string');
      const completed = JSON.parse(witness.completed_response); report.completedNativePublication = completed;
      expect(completed.status).toBe('ok'); expect(completed.value.kind).toBe('mutation'); expect(completed.value.effect).not.toBe('unchanged');
      expect(completed.value.state).toEqual(state);
      expect(witness.events.value.events).toHaveLength(1);
      const event = witness.events.value.events[0]; expect(event.change.kind).toBe('document');
      expect(event.before.revision).toBe('1'); expect(event.after).toEqual(state.stamp);
    } else { expect(witness.completed_response).toBeNull(); expect(witness.events.value.events).toEqual([]); }
    expect(report.trap.host.runtimeErrors).toHaveLength(1);
    expect(report.trap.host.runtimeErrors[0].actualRuntimeError).toBe(true); expect(report.trap.host.runtimeErrors[0].name).toBe('RuntimeError');
    const stack = report.trap.host.runtimeErrors[0].stack; expect(stack === null || typeof stack === 'string' && stack.length <= 65536).toBe(true);
    expect(report.trap.host.lifecycle).toBe('fatal'); expect(report.trap.host.contenteditable).toBe('false');
    expect(report.trap.host.callbacks.filter(event => event.after.revision === '2')).toEqual([]);
    expect(report.trap.host.coherent).toBe(canonical(literals.coherentRecoveryInput));
    expect(report.trap.host.durable).toBe(canonical(literals.healthy)); expect(report.trap.host.hostUnsaved).toBe(true);
    expect(report.trap.host.unresolved).toBe(true);
    expect(report.trap.host.provisional).toEqual({ attemptedText: literals.attemptedInput, nativeOutcome: 'unknown', ownership: 'host', source: 'controlled_command_input' });
    report.peer = await invoke(page, 'peerAfterRetirement'); fatal(report.peer.response, loading.outcomes.retiredRuntime, false);
    expect(report.peer.resources.lifecycle).toBe('fatal'); expect(report.peer.resources.sessions).toBe(0);
    report.retainedProjection = await invoke(page, 'retainedProjectionAfterRetirement');
    expect(report.retainedProjection).toEqual({ opened: false, code: loading.outcomes.retiredRuntime });
    report.retiredLoad = await invoke(page, 'loadAfterRetirement');
    expect(report.retiredLoad).toEqual({ loaded: false, code: loading.outcomes.retiredRuntime });
    report.retiredHost = await invoke(page, 'inspect');
    expect(report.retiredHost.actualInstances).toBe(1); expect(report.retiredHost.runtimeErrors).toEqual(report.trap.host.runtimeErrors);
    report.retiredBrowser = await page.evaluate(() => globalThis.__failureBrowserErrors());
    expect(report.retiredBrowser).toEqual({ errors: [], overflow: false });
    const oldRealm = report.coherent.host.realm;
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.locator('#failure-recover').click()]);
    await page.waitForFunction(() => globalThis.failureRuntimeReady === true);
    report.recovered = await invoke(page, 'checkpoint'); live(report.recovered, binding.build.buildId, canonical(literals.coherentRecoveryInput));
    const fresh = report.recovered;
    expect(fresh.host.realm).not.toBe(oldRealm); expect(fresh.host.timeOrigin).not.toBe(report.coherent.host.timeOrigin);
    expect(fresh.host.recoveredFrom).toBe(oldRealm); expect(fresh.host.actualInstances).toBe(1);
    expect(fresh.state.stamp.revision).toBe('0'); expect(fresh.state.dirty).toBe(false); expect(fresh.state.saved_revision).toBe('0');
    expect(fresh.state.history.undo_entries).toBe('0'); expect(fresh.state.history.redo_entries).toBe('0');
    expect(fresh.host.hostUnsaved).toBe(literals.freshRecoveryHostUnsaved); expect(fresh.host.unresolved).toBe(true);
    expect(fresh.host.provisional).toEqual(report.trap.host.provisional); expect(fresh.host.archivedProvisional).toBeNull();
    expect(fresh.host.durable).toBe(canonical(literals.healthy)); expect(fresh.host.saveAcks).toBe(0);
    report.oldCallback = await invoke(page, 'dropOldCallback', oldRealm);
    expect(report.oldCallback.status).toBe('stale_host_context'); expect(report.oldCallback.dispatched).toBe(false);
    expect(report.oldCallback.host.nativeSubmissions).toBe(fresh.host.nativeSubmissions);
    expect(report.oldCallback.host.oldCallbacksDropped).toBe(fresh.host.oldCallbacksDropped + 1);
    report.unresolvedSave = await invoke(page, 'save');
    expect(report.unresolvedSave.status).toBe('host_refused'); expect(report.unresolvedSave.code).toBe('host.unresolved_recovery');
    expect(report.unresolvedSave.host.nativeSubmissions).toBe(report.oldCallback.host.nativeSubmissions);
    expect(report.unresolvedSave.host.hostUnsaved).toBe(true); expect(report.unresolvedSave.host.saveAcks).toBe(0);
    report.resolution = await invoke(page, 'retainProvisionalSeparately');
    expect(report.resolution.archivedProvisional).toEqual(report.trap.host.provisional); expect(report.resolution.provisional).toBeNull();
    expect(report.resolution.unresolved).toBe(false); expect(report.resolution.hostUnsaved).toBe(true);
    expect(report.resolution.nativeSubmissions).toBe(report.unresolvedSave.host.nativeSubmissions);
    report.freshSave = await invoke(page, 'save'); expect(report.freshSave.status).toBe('saved');
    expect(report.freshSave.host.saveAcks).toBe(1); expect(report.freshSave.host.snapshotReleaseCount).toBe(report.resolution.snapshotReleaseCount + 1);
    expect(report.freshSave.host.nativeSubmissions).toBe(report.resolution.nativeSubmissions + 3);
    expect(report.freshSave.host.hostUnsaved).toBe(false); expect(report.freshSave.host.unresolved).toBe(false);
    expect(report.freshSave.host.archivedProvisional).toEqual(report.trap.host.provisional);
    expect(report.freshSave.host.durable).toBe(canonical(literals.coherentRecoveryInput)); expect(report.freshSave.state.dirty).toBe(false);
    expect(report.freshSave.state.stamp).toEqual(fresh.state.stamp); expect(report.freshSave.state.saved_revision).toBe(fresh.state.stamp.revision);
    report.cleanup = await invoke(page, 'dispose'); disposed = true;
    ownZero(report.cleanup.host.resources); ownZero(report.cleanup.host.peerResources);
    expect(report.cleanup.native).toEqual(fresh.host.nativeBaseline); expect(report.cleanup.host.lifecycle).toBe('destroyed');
    report.freshBrowser = await page.evaluate(() => globalThis.__failureBrowserErrors());
    expect(report.freshBrowser).toEqual({ errors: [], overflow: false });
    expect(report.browserErrors).toEqual([]); expect(report.errorOverflow ?? false).toBe(false);
    for (const item of [...binding.sourcePins, ...binding.artifactPins, ...binding.build.artifacts]) expect(pin(item.path)).toEqual(item);
    report.status = 'PASSED';
  } catch (error) { failure = error; report.status = 'FAILED'; report.originalFailure = { name: error.name, message: error.message, stack: error.stack }; }
  finally {
    if (page && !disposed) try { report.emergencyCleanup = await invoke(page, 'dispose'); }
    catch (error) { report.emergencyCleanupFailure = { name: error.name, message: error.message }; }
    if (context) try { await context.close(); }
    catch (error) { report.contextCloseFailure = { name: error.name, message: error.message }; failure ??= error; report.status = 'FAILED'; }
    if (!failure && (report.browserErrors.length || report.errorOverflow)) {
      failure = new Error('Browser error observed through context closure'); report.status = 'FAILED';
      report.originalFailure = { name: failure.name, message: failure.message, stack: failure.stack };
    }
    const directory = 'artifacts/failure-states/runtime-browser'; mkdirSync(directory, { recursive: true });
    const path = `${directory}/${info.project.name}-${phase}.json`;
    writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
    await info.attach('runtime-primary-observation', { path, contentType: 'application/json' });
  }
  if (failure) throw failure;
});
