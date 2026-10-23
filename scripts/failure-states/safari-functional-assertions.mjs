// SPDX-License-Identifier: MIT OR Apache-2.0
// Functional subset of the frozen AC1/AC3 assertions. Network/early-observer
// assertions remain unobserved, never weakened or replaced by this module.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertNumericOwnersZero } from './dom-observation.mjs';
const root = 'contracts/failure-states/v1';
export const pipeline = JSON.parse(readFileSync(`${root}/dom-pipeline.json`, 'utf8'));
export const runtime = JSON.parse(readFileSync(`${root}/runtime-literals.json`, 'utf8'));
const loading = JSON.parse(readFileSync(`${root}/loading-recovery.json`, 'utf8'));
const canonical = path => readFileSync(`${root}/${path}`, 'utf8');
const nativeZero = { sessions: 0, snapshot_handles: 0, snapshot_bytes: '0', protected_cursors: 0 };
function subset(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    assert(Object.hasOwn(actual, key), `Required field ${key}`);
    if (value && typeof value === 'object' && !Array.isArray(value)) subset(actual[key], value);
    else assert.deepEqual(actual[key], value, key);
  }
}
export function browserClean(point) {
  assert.equal(point.overflow, false); assert.deepEqual(point.csp, []); assert.deepEqual(point.errors, []);
  assert.deepEqual(point.rejections, []); assert.deepEqual(point.sentinels, pipeline.shared.observation.sentinels);
  assert.equal(point.serviceWorkerController, null, 'Actual post-ready current controller only; not proof of context-level blocking');
  assert.equal(point.frames, 0); assert.match(point.userAgent, /Version\/[^ ]+.*Safari\//);
}
export async function functionalWindow(adapter, report, label) {
  const before = await adapter.browser(); browserClean(before);
  const window = await adapter.window(label), after = await adapter.browser(); browserClean(after);
  (report.windows ??= []).push({ label, before, window, after }); return after;
}
function same(after, before) {
  assert.deepEqual(after.native, before.native); assert.deepEqual(after.events, before.events);
  assert.deepEqual(after.dom, before.dom); assert.equal(after.identityIntact, true);
}
function tree(point, row) {
  assert.deepEqual(point.dom.tree, row.oracle.dom.expectedTree);
  const ids = point.dom.identities.map(item => item.id);
  assert(ids.every(Boolean)); assert.equal(new Set(ids).size, ids.length);
  assert(point.dom.identities.every(item => item.marker === ''));
  if (point.native) {
    assert.equal(ids.length, point.native.rows.length - 1);
    assert.equal(new Set(point.native.rows.map(item => item.node.id)).size, point.native.rows.length);
    for (const item of point.native.rows) assert.deepEqual(item.node.stamp, point.native.state.stamp);
  }
  const forbidden = new Set(pipeline.shared.domComparison.forbiddenDescendants);
  const visit = node => { if (node.tag) { assert(!forbidden.has(node.tag)); node.children.forEach(visit); } };
  point.dom.tree.forEach(visit);
}
export async function observeDomFunctional(adapter, row, report, productionBuildId) {
  const call = (method, ...args) => adapter.call(method, ...args);
  report.hostMetadata = await call('metadata'); assert.equal(report.hostMetadata.buildId, productionBuildId);
  const paste = row.input.action === 'public mounted clipboard.paste';
  report.mount = await call('failureMount', paste ? row.input.seedCanonicalUtf8 : row.input.rawUtf8);
  const id = report.mount.id; report.mountId = id; report.checkpoints = [];
  if (paste) {
    assert.equal(report.mount.ready.status, 'ready'); report.selection = await call('failureSelect', id, row.input.selection);
    const before = await call('failureInspect', id); report.checkpoints.push({ label: 'before', ...before });
    assert.equal(before.native.canonical, row.input.seedCanonicalUtf8);
    report.outcome = await call('failurePaste', id, row.input.representations, row.input.metadata.types);
    assert.equal(report.outcome.status, row.oracle.outcome); assert.deepEqual(report.outcome.diagnostics, row.oracle.clipboardDiagnostics);
    const after = await call('failureInspect', id); report.checkpoints.push({ label: 'terminal', ...after }); tree(after, row);
    assert.equal(after.sourceReads.length, 1); assert.deepEqual(after.sourceReads[0], { types: row.input.metadata.types, calls: row.input.captureReadOrder });
    if (row.oracle.outcome === 'inserted') {
      assert.equal(report.outcome.submission.status, 'completed'); assert.equal(report.outcome.submission.response.status, 'ok');
      assert.equal(after.native.canonical, row.oracle.native.canonicalUtf8);
      const a = after.native.state.stamp, b = before.native.state.stamp;
      assert.equal(a.session, b.session); assert.equal(a.generation, b.generation);
      for (const key of ['revision', 'selection_epoch', 'history_epoch']) assert.equal(BigInt(a[key]) - BigInt(b[key]), 1n);
      assert.equal(after.native.state.history.undo_entries, String(BigInt(before.native.state.history.undo_entries) + 1n));
      assert.equal(after.native.state.history.redo_entries, '0'); assert.equal(after.native.state.dirty, true);
      assert.equal(after.events.filter(item => item.change.kind === 'document').length - before.events.filter(item => item.change.kind === 'document').length, 1);
      assert.equal(after.audit.queries - before.audit.queries, 1); assert.equal(after.audit.commands - before.audit.commands, 1);
      report.recovery = await call('failureTakeRecovery', id); assert.equal(report.recovery, null);
    } else {
      subset(report.outcome.failure.diagnostic, row.oracle.failure); same(after, before);
      assert.equal(after.audit.queries - before.audit.queries, 0); assert.equal(after.audit.commands - before.audit.commands, 0);
      report.recovery = await call('failureTakeRecovery', id);
      assert.equal(report.recovery.reason, row.oracle.recovery.reason);
      assert.equal(report.recovery.capture.retainedUtf16Units, row.oracle.recovery.retainedUtf16Units);
      assert.deepEqual(report.recovery.capture.metadata.types, row.input.metadata.types); assert.equal(report.recovery.capture.metadata.counts.files, 0);
      for (const mime of row.input.metadata.types) subset(report.recovery.capture.representations[mime], {
        status: 'complete_local', readAttempted: true, text: row.input.representations[mime], utf16Units: row.input.representations[mime].length,
      });
      assert.equal(await call('failureTakeRecovery', id), null);
    }
  } else if (row.oracle.outcome === 'ready') {
    assert.equal(report.mount.ready.status, 'ready'); assert.equal(report.mount.originalInput, null);
    const after = await call('failureInspect', id); report.checkpoints.push({ label: 'terminal', ...after }); tree(after, row);
    assert.equal(after.native.canonical, row.oracle.native.canonicalUtf8);
    for (const key of ['revision', 'selection_epoch', 'history_epoch']) assert.equal(after.native.state.stamp[key], row.oracle.native[key]);
    assert.deepEqual(after.events, []); assert.equal(after.native.state.history.undo_entries, '0'); assert.equal(after.native.state.dirty, false);
  } else {
    assert.equal(report.mount.ready.status, 'sdk_failure'); assert.equal(report.mount.ready.response.status, 'refused');
    subset(report.mount.ready.response.diagnostic, { code: row.oracle.native.code, path: row.oracle.native.path, may_have_committed: false });
    const original = Array.from(new TextEncoder().encode(row.input.rawUtf8));
    assert.deepEqual(report.mount.ready.recovery.originalInput, original); assert.deepEqual(report.mount.originalInput, original);
    assert.equal(report.mount.originalCopyIndependent, true);
    const after = await call('failureInspect', id); report.checkpoints.push({ label: 'terminal', ...after });
    assert.equal(after.native, null); assert.deepEqual(after.dom.tree, []); assert.equal(after.contenteditable, 'false');
    assert.equal(after.lifecycle, 'recoveryRequired'); assert.deepEqual(after.events, []);
  }
  await functionalWindow(adapter, report, 'operation terminal');
  const stable = await call('failureInspect', id); report.checkpoints.push({ label: 'window complete', ...stable }); same(stable, report.checkpoints.at(-2));
  report.cleanup = await call('failureDispose', id); report.disposed = true;
  assert.equal(report.cleanup.sameReceipt, true); assert.equal(report.cleanup.receipt.sdk.response.status, 'ok');
  assert.equal(report.cleanup.receipt.callbackFailure, null); assert.deepEqual(report.cleanup.restoredAttributes, report.cleanup.initialAttributes);
  assert.deepEqual(report.cleanup.native, nativeZero); assertNumericOwnersZero(report.cleanup.resources); assertNumericOwnersZero(report.cleanup.fixtureResources);
  assert.equal(report.cleanup.receipt.clipboardRecovery, null);
  if (row.oracle.outcome === 'sdk_failure') {
    const original = Array.from(new TextEncoder().encode(row.input.rawUtf8));
    assert.deepEqual(report.cleanup.receipt.recovery.originalInput, original); assert.equal(report.cleanup.recoveries.length, 1);
    assert.deepEqual(report.cleanup.recoveries[0].originalInput, original);
  } else { assert.equal(report.cleanup.receipt.recovery, null); assert.deepEqual(report.cleanup.recoveries, []); }
  await functionalWindow(adapter, report, 'cleanup complete');
}
function fatal(response, code, mayHaveCommitted) {
  assert.equal(response.status, 'fatal'); assert.equal(response.diagnostic.code, code);
  assert.equal(response.diagnostic.may_have_committed, mayHaveCommitted); assert.equal(response.diagnostic.category, 'transport');
  assert.equal(response.diagnostic.path, ''); assert.deepEqual(response.diagnostic.details, {});
}
function detachedNativePointers(host, expectedCount) {
  assert.equal(host.nativeDetachOverflow, false); assert.equal(host.nativeDetaches.length, expectedCount);
  assert.equal(new Set(host.nativeDetaches.map(item => item.nativeId)).size, expectedCount);
  assert.equal(new Set(host.nativeDetaches.map(item => item.pointerBefore)).size, expectedCount);
  for (const item of host.nativeDetaches) {
    assert(Number.isSafeInteger(item.nativeId) && item.nativeId > 0);
    assert(Number.isSafeInteger(item.pointerBefore) && item.pointerBefore > 0);
    assert.equal(item.returnedPointer, item.pointerBefore); assert.equal(item.pointerAfter, 0);
  }
  // Pure generated-JS detachment/unregistration only. No forced GC scheduling,
  // finalizer invocation or retired native allocation reclamation is observed.
}
function live(point, buildId, literal) {
  assert.equal(point.canonical, canonical(literal)); assert.equal(point.host.coherent, canonical(literal));
  assert.equal(point.host.lifecycle, 'ready'); assert.equal(point.host.contenteditable, 'true'); assert.equal(point.host.actualInstances, 1);
  assert.equal(point.host.fixtureBuildId, buildId); assert.deepEqual(point.host.nativeBaseline, nativeZero);
  assert.deepEqual(point.native, { sessions: 2, snapshot_handles: 0, snapshot_bytes: '0', protected_cursors: 2 });
  assert.deepEqual(point.host.runtimeErrors, []); assert.deepEqual(point.host.refusals, []);
  detachedNativePointers(point.host, runtime.generatedFinalizerDetachment.healthyBeforeCleanup);
  assert.equal(point.host.resources.sdk.sessions, 1); assert.equal(point.host.peerResources.sessions, 1);
}
export async function observeRuntimeFunctional(adapter, phase, report, fixtureBuildId) {
  const call = (method, ...args) => adapter.call(method, ...args);
  report.initial = await call('checkpoint'); live(report.initial, fixtureBuildId, runtime.healthy);
  assert.equal(report.initial.host.recoveredFrom, null); assert.equal(report.initial.host.hostUnsaved, false);
  assert.equal(report.initial.state.stamp.revision, '0'); assert.equal(report.initial.state.dirty, false);
  report.edit = await call('edit', runtime.initialEdit);
  assert.equal(report.edit.response.status, 'ok'); assert.equal(report.edit.response.value.kind, 'mutation');
  report.coherent = await call('checkpoint'); live(report.coherent, fixtureBuildId, runtime.afterExplicitXEdit);
  assert.equal(report.coherent.state.stamp.revision, '1'); assert.equal(report.coherent.state.dirty, true);
  assert.equal(report.coherent.state.saved_revision, '0'); assert.equal(report.coherent.state.history.undo_entries, '1');
  assert.equal(report.coherent.host.hostUnsaved, true); assert.equal(report.coherent.host.durable, canonical(runtime.healthy));
  report.delayedSave = await call('holdDelayedSave'); const job = report.delayedSave.job;
  assert.equal(job.format, 'editor-failure-delayed-save/1'); assert.equal(job.originRealm, report.coherent.host.realm);
  assert.equal(job.receipt.kind, 'snapshot'); assert.equal(typeof job.receipt.handle, 'string');
  assert.equal(job.receipt.canonical_json, canonical(runtime.delayedControlledSave.canonical));
  assert.deepEqual(job.receipt.stamp, report.coherent.state.stamp);
  assert.deepEqual(job.acknowledgeRequest, { kind: 'acknowledge_snapshot', stamp: job.receipt.stamp, handle: job.receipt.handle });
  assert.deepEqual(report.delayedSave.native, { ...runtime.delayedControlledSave.nativeResourcesBeforeTrap, sessions: 2, protected_cursors: 2 });
  report.trap = await call('trap', phase, runtime.attemptedInput); fatal(report.trap.response, 'sdk.transport_failure', true);
  const witness = report.trap.witness, published = phase === 'after_publication';
  assert(Buffer.byteLength(JSON.stringify(witness)) <= 131072); assert.equal(witness.phase, phase);
  assert.equal(witness.state.status, 'ok'); assert.equal(witness.state.value.kind, 'state'); const state = witness.state.value.state;
  assert.equal(state.stamp.session, report.coherent.state.stamp.session); assert.equal(state.stamp.generation, report.coherent.state.stamp.generation);
  assert.equal(state.stamp.revision, published ? '2' : '1'); assert.equal(state.dirty, true); assert.equal(state.saved_revision, '0');
  assert.equal(state.history.undo_entries, published ? '2' : '1'); assert.equal(state.history.redo_entries, '0');
  assert.equal(witness.snapshot.status, 'ok'); assert.equal(witness.snapshot.value.kind, 'snapshot');
  assert.equal(witness.snapshot.value.canonical_json, canonical(published ? runtime.afterTrapPublication : runtime.beforeTrapDispatch));
  assert.deepEqual(witness.snapshot.value.stamp, state.stamp); assert.deepEqual(witness.native_resources_before_trap, runtime.delayedControlledSave.nativeResourcesBeforeTrap);
  assert.equal(witness.events.status, 'ok'); assert.equal(witness.events.value.kind, 'events'); assert.equal(witness.events.value.gap, false);
  if (published) {
    assert.equal(typeof witness.completed_response, 'string'); const completed = JSON.parse(witness.completed_response); report.nativePublication = completed;
    assert.equal(completed.status, 'ok'); assert.equal(completed.value.kind, 'mutation'); assert.notEqual(completed.value.effect, 'unchanged');
    assert.deepEqual(completed.value.state, state); assert.equal(witness.events.value.events.length, 1);
    const event = witness.events.value.events[0]; assert.equal(event.change.kind, 'document'); assert.equal(event.before.revision, '1'); assert.deepEqual(event.after, state.stamp);
  } else { assert.equal(witness.completed_response, null); assert.deepEqual(witness.events.value.events, []); }
  assert.equal(report.trap.host.runtimeErrors.length, 1); assert.equal(report.trap.host.runtimeErrors[0].actualRuntimeError, true);
  assert.equal(report.trap.host.runtimeErrors[0].name, 'RuntimeError'); const stack = report.trap.host.runtimeErrors[0].stack;
  detachedNativePointers(report.trap.host, runtime.generatedFinalizerDetachment.retirementDetaches);
  assert.equal(report.trap.host.nativeResources, null);
  assert(stack === null || typeof stack === 'string' && stack.length <= 65536);
  assert.equal(report.trap.host.lifecycle, 'fatal'); assert.equal(report.trap.host.contenteditable, 'false');
  assert.deepEqual(report.trap.host.callbacks.filter(event => event.after.revision === '2'), []);
  assert.equal(report.trap.host.coherent, canonical(runtime.coherentRecoveryInput)); assert.equal(report.trap.host.durable, canonical(runtime.healthy));
  assert.equal(report.trap.host.hostUnsaved, true); assert.equal(report.trap.host.unresolved, true); assert.deepEqual(report.trap.host.pendingSaveJob, job);
  assert.deepEqual(report.trap.host.provisional, { attemptedText: runtime.attemptedInput, nativeOutcome: 'unknown', ownership: 'host', source: 'controlled_command_input' });
  report.peer = await call('peerAfterRetirement'); fatal(report.peer.response, loading.outcomes.retiredRuntime, false);
  assert.equal(report.peer.resources.lifecycle, 'fatal'); assert.equal(report.peer.resources.sessions, 0);
  report.retainedProjection = await call('retainedProjectionAfterRetirement'); assert.deepEqual(report.retainedProjection, { opened: false, code: loading.outcomes.retiredRuntime });
  report.retiredLoad = await call('loadAfterRetirement'); assert.deepEqual(report.retiredLoad, { loaded: false, code: loading.outcomes.retiredRuntime });
  report.retiredHost = await call('inspect'); assert.equal(report.retiredHost.nativeResources, null);
  assert.deepEqual(report.retiredHost.nativeDetaches, report.trap.host.nativeDetaches);
  assert.equal(report.retiredHost.nativeDetachOverflow, false);
  assert.equal(report.retiredHost.actualInstances, 1); assert.deepEqual(report.retiredHost.runtimeErrors, report.trap.host.runtimeErrors);
  await functionalWindow(adapter, report, 'retired realm terminal');
  const oldRealm = report.coherent.host.realm;
  report.recoveryNavigation = await adapter.reload('explicit-recovery'); browserClean(report.recoveryNavigation);
  report.recovered = await call('checkpoint'); let fresh = report.recovered; live(fresh, fixtureBuildId, runtime.coherentRecoveryInput);
  assert.notEqual(fresh.host.realm, oldRealm); assert.notEqual(fresh.host.timeOrigin, report.coherent.host.timeOrigin);
  assert.equal(fresh.host.recoveredFrom, oldRealm); assert.equal(fresh.state.stamp.revision, '0'); assert.equal(fresh.state.dirty, false);
  assert.equal(fresh.state.saved_revision, '0'); assert.equal(fresh.state.history.undo_entries, '0'); assert.equal(fresh.state.history.redo_entries, '0');
  assert.equal(fresh.host.hostUnsaved, runtime.freshRecoveryHostUnsaved); assert.equal(fresh.host.unresolved, true);
  assert.deepEqual(fresh.host.provisional, report.trap.host.provisional); assert.equal(fresh.host.archivedProvisional, null);
  assert.equal(fresh.host.durable, canonical(runtime.healthy)); assert.equal(fresh.host.saveAcks, 0);
  assert.deepEqual(fresh.host.pendingSaveJob, job); assert.equal(fresh.host.recoveryPacketRetained, true);
  await functionalWindow(adapter, report, 'before disposition reload terminal');
  report.reloadBeforeResolution = { before: fresh, navigation: await adapter.reload('reload') }; browserClean(report.reloadBeforeResolution.navigation);
  fresh = await call('checkpoint'); report.reloadBeforeResolution.after = fresh; live(fresh, fixtureBuildId, runtime.coherentRecoveryInput);
  assert.notEqual(fresh.host.realm, report.reloadBeforeResolution.before.host.realm); assert.notEqual(fresh.host.timeOrigin, report.reloadBeforeResolution.before.host.timeOrigin);
  assert.equal(fresh.host.recoveredFrom, oldRealm); assert.deepEqual(fresh.host.provisional, report.trap.host.provisional);
  assert.deepEqual(fresh.host.pendingSaveJob, job); assert.equal(fresh.host.archivedProvisional, null);
  assert.equal(fresh.host.unresolved, true); assert.equal(fresh.host.hostUnsaved, true); assert.equal(fresh.host.recoveryPacketRetained, true);
  assert.equal(fresh.host.durable, canonical(runtime.healthy)); assert.equal(fresh.state.dirty, false);
  assert.equal(fresh.state.stamp.revision, '0'); assert.equal(fresh.state.saved_revision, '0');
  report.oldCallback = await call('completeDelayedSave'); assert.equal(report.oldCallback.status, 'stale_host_context'); assert.equal(report.oldCallback.dispatched, false);
  assert.deepEqual(report.oldCallback.job, job); assert.deepEqual(report.oldCallback.job.acknowledgeRequest, job.acknowledgeRequest);
  assert.equal(report.oldCallback.host.nativeSubmissions, fresh.host.nativeSubmissions);
  assert.equal(report.oldCallback.host.oldCallbacksDropped, fresh.host.oldCallbacksDropped + 1);
  assert.equal(report.oldCallback.host.saveAcks, 0); assert.equal(report.oldCallback.host.hostUnsaved, true);
  assert.equal(report.oldCallback.host.recoveryPacketRetained, true); assert.equal(report.oldCallback.host.durable, canonical(runtime.healthy));
  report.unresolvedSave = await call('save'); assert.equal(report.unresolvedSave.status, 'host_refused'); assert.equal(report.unresolvedSave.code, 'host.unresolved_recovery');
  assert.equal(report.unresolvedSave.host.nativeSubmissions, report.oldCallback.host.nativeSubmissions);
  assert.equal(report.unresolvedSave.host.hostUnsaved, true); assert.equal(report.unresolvedSave.host.saveAcks, 0);
  report.resolution = await call('retainProvisionalSeparately'); assert.deepEqual(report.resolution.archivedProvisional, report.trap.host.provisional);
  assert.equal(report.resolution.provisional, null); assert.equal(report.resolution.unresolved, false); assert.equal(report.resolution.hostUnsaved, true);
  assert.equal(report.resolution.nativeSubmissions, report.unresolvedSave.host.nativeSubmissions); assert.equal(report.resolution.recoveryPacketRetained, true);
  await functionalWindow(adapter, report, 'after disposition terminal');
  report.reloadAfterResolution = { before: report.resolution, previousRealm: fresh.host.realm, navigation: await adapter.reload('reload') }; browserClean(report.reloadAfterResolution.navigation);
  fresh = await call('checkpoint'); report.reloadAfterResolution.after = fresh; live(fresh, fixtureBuildId, runtime.coherentRecoveryInput);
  assert.notEqual(fresh.host.realm, report.reloadAfterResolution.previousRealm); assert.equal(fresh.host.recoveredFrom, oldRealm);
  assert.deepEqual(fresh.host.archivedProvisional, report.trap.host.provisional); assert.equal(fresh.host.provisional, null);
  assert.equal(fresh.host.unresolved, false); assert.equal(fresh.host.hostUnsaved, true); assert.equal(fresh.host.recoveryPacketRetained, true);
  assert.deepEqual(fresh.host.pendingSaveJob, job); assert.deepEqual(fresh.host.oldSaveCompletion, { status: 'stale_host_context', dispatched: false, job });
  assert.equal(fresh.host.durable, canonical(runtime.healthy)); assert.equal(fresh.host.saveAcks, 0);
  report.freshSave = await call('save'); assert.equal(report.freshSave.status, 'saved'); assert.equal(report.freshSave.host.saveAcks, 1);
  assert.equal(report.freshSave.host.snapshotReleaseCount, fresh.host.snapshotReleaseCount + 1); assert.equal(report.freshSave.host.nativeSubmissions, fresh.host.nativeSubmissions + 3);
  assert.equal(report.freshSave.host.hostUnsaved, false); assert.equal(report.freshSave.host.unresolved, false); assert.equal(report.freshSave.host.recoveryPacketRetained, false);
  assert.deepEqual(report.freshSave.host.archivedProvisional, report.trap.host.provisional); assert.equal(report.freshSave.host.durable, canonical(runtime.coherentRecoveryInput));
  assert.equal(report.freshSave.state.dirty, false); assert.deepEqual(report.freshSave.state.stamp, fresh.state.stamp);
  assert.equal(report.freshSave.state.saved_revision, fresh.state.stamp.revision);
  await functionalWindow(adapter, report, 'fresh Save terminal');
  report.cleanup = await call('dispose'); report.disposed = true;
  assertNumericOwnersZero(report.cleanup.host.resources); assertNumericOwnersZero(report.cleanup.host.peerResources);
  assert.equal(report.cleanup.host.resources.sdk.lifecycle, 'destroyed'); assert.equal(report.cleanup.host.peerResources.lifecycle, 'destroyed');
  assert.deepEqual(report.cleanup.native, fresh.host.nativeBaseline); assert.equal(report.cleanup.host.lifecycle, 'destroyed');
  detachedNativePointers(report.cleanup.host, runtime.generatedFinalizerDetachment.healthyExplicitCleanupDetaches);
  await functionalWindow(adapter, report, 'cleanup complete');
}
