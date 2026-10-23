// SPDX-License-Identifier: MIT OR Apache-2.0
// OSR-67 finite resource observations; existing meaningful suites are joined,
// not copied here. This file alone does not close all nine selected AC4 rows.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor } from '../packages/sdk/dist/index.js';
import { fakeModule, mutation, options as fakeOptions } from './helpers/sdk-fake.mjs';
import { compositionEventFixture } from '../scripts/failure-states/resource-composition.mjs';
import {
  recipe, accepted, completed, settled, state, snapshot, release, nativeCounts,
  healthyBytes, paddedInput, optionsFor, digest, jsonData, ownedResourcesZero, createResourceRecorder,
} from '../scripts/failure-states/resource-case-helpers.mjs';

const recorder = createResourceRecorder();
after(() => recorder.finish());

test('failure resources A4-01 public16777217 bytes refuses before loader and retains no input', async () => {
  await recorder.observe('A4-01/public-input-over', 'public-controller-before-loader', async entry => {
    let loaderCalls = 0;
    const input = paddedInput(recipe.publicInput.byteLengths[1]);
    entry.input = { bytes: input.byteLength, sha256: digest(input), recipe: 'publicInput' };
    const editor = createEditor({ input, options: optionsFor(recorder.buildId), loader: async () => { loaderCalls++; throw new Error('Oversize input reached loader'); } });
    try {
      const response = await editor.ready;
      entry.response = jsonData(response);
      assert.equal(response.status, recipe.publicInput.expectedOver.status);
      assert.equal(response.diagnostic.code, recipe.publicInput.expectedOver.code);
      assert.equal(loaderCalls, 0);
      assert.equal(editor.originalInput(), null);
      assert.equal(editor.capture(), null);
      assert.equal(editor.context(), null);
      assert.equal(editor.resources().original_input_bytes, 0);
      recorder.sample(entry, 'refused-before-loader', editor, { beforeLoader: true });
    } finally {
      await settled(editor.destroy());
      recorder.sample(entry, 'after-owned-disposal', editor, { beforeLoader: true });
      ownedResourcesZero(editor.resources());
      entry.loaderCalls = loaderCalls;
    }
  });
});

test('failure resources A4-01 public16777216 whitespace-padded bytes reaches actual SDK2 admission', async () => {
  await recorder.observe('A4-01/public-input-exact', 'actual-public-sdk2', async entry => {
    const module = await recorder.production(), baseline = nativeCounts(module);
    recorder.sample(entry, 'before-open');
    const input = paddedInput(recipe.publicInput.byteLengths[0]);
    entry.input = { bytes: input.byteLength, sha256: digest(input), recipe: 'publicInput' };
    let loaderCalls = 0;
    const editor = createEditor({ input, options: optionsFor(recorder.buildId), loader: async () => { loaderCalls++; return module; } });
    try {
      const response = await editor.ready;
      entry.ready = jsonData(response);
      accepted(response);
      assert.equal(editor.originalInput(), null);
      assert.equal(editor.lifecycle, 'ready');
      assert.equal(loaderCalls, 1);
      recorder.sample(entry, 'after-exact-raw-admission', editor);
      const receipt = snapshot(editor);
      entry.snapshot = { ...jsonData(receipt), canonicalUtf8Bytes: Buffer.byteLength(receipt.canonical_json) };
      try {
        assert.equal(receipt.canonical_json, healthyBytes().toString('utf8'));
        assert.equal(Buffer.byteLength(receipt.canonical_json), recipe.healthyCanonical.bytes);
      } finally { release(editor, receipt.handle); }
      recorder.sample(entry, 'after-complete-snapshot-and-release', editor);
    } finally {
      await settled(editor.destroy());
      recorder.sample(entry, 'after-owned-disposal', editor);
      ownedResourcesZero(editor.resources());
      assert.deepEqual(nativeCounts(module), baseline, 'Actual session/protection/snapshot ownership restored');
      entry.loaderCalls = loaderCalls;
    }
  });
});

for (const queued of [false, true]) for (const over of [false, true]) {
  const id = `A4-07/${queued ? 'queue' : 'request'}-${over ? 'over' : 'exact'}`;
  test(`failure resources ${id} literal${over ? 214 : 213} bytes uses a host-tightened controlled guard`, async () => {
    await recorder.observe(id, 'controlled-js-transport-only', async entry => {
      const fixture = fakeModule(), baseline = JSON.parse(fixture.module.resourceCounts());
      const limits = queued ? { queuedBytes: recipe.controlledBytes.hostMaximum } : { requestBytes: recipe.controlledBytes.hostMaximum };
      const editor = createEditor({ input: new Uint8Array([1, 2, 3]), options: fakeOptions(), loader: async () => fixture.module, limits });
      const raw = over ? recipe.controlledBytes.oneByteLargerRequestJson : recipe.controlledBytes.requestJson;
      assert.equal(Buffer.byteLength(raw), over ? recipe.controlledBytes.oneByteLargerUtf8Bytes : recipe.controlledBytes.requestUtf8Bytes);
      entry.input = { json: raw, utf8Bytes: Buffer.byteLength(raw), hostMaximum: recipe.controlledBytes.hostMaximum };
      try {
        accepted(await editor.ready);
        recorder.sample(entry, 'before-control', editor, { controlled: true });
        let submission, before;
        if (queued) {
          let once = false;
          editor.subscribe(() => {
            if (once) return;
            once = true;
            before = jsonData(state(editor));
            submission = editor.submit(JSON.parse(raw));
            entry.insideListener = jsonData(editor.resources());
            assert.equal(submission.status, over ? 'completed' : 'queued');
            assert.equal(editor.resources().queued_mutations, over ? 0 : 1);
            assert.equal(editor.resources().queued_bytes, over ? 0 : recipe.controlledBytes.hostMaximum);
          });
          accepted(completed(editor.submit(mutation(editor))));
          assert(once, 'The real controller callback fence was entered');
        } else {
          before = jsonData(state(editor));
          submission = editor.submit(JSON.parse(raw));
          assert.equal(submission.status, 'completed');
        }
        const response = await settled(submission);
        entry.response = jsonData(response);
        assert.equal(response.status, 'refused');
        assert.equal(response.diagnostic.code, over ? queued ? recipe.controlledBytes.expectedQueueOver : recipe.controlledBytes.expectedRequestOver : recipe.controlledBytes.expectedExactDownstream);
        assert.deepEqual(jsonData(state(editor)), before, 'Guard/downstream refusal publishes no additional state');
        const commandCalls = fixture.log.filter(request => request.kind === 'command');
        entry.commandCalls = jsonData(commandCalls);
        assert.equal(commandCalls.length, (queued ? 1 : 0) + (over ? 0 : 1));
        assert.equal(editor.resources().queued_mutations, 0);
        assert.equal(editor.resources().queued_bytes, 0);
        assert.equal(editor.resources().pending_tickets, 0);
        recorder.sample(entry, 'after-refusal-and-ticket-settlement', editor, { controlled: true });
      } finally {
        await settled(editor.destroy());
        recorder.sample(entry, 'after-owned-disposal', editor, { controlled: true });
        ownedResourcesZero(editor.resources());
        assert.deepEqual(JSON.parse(fixture.module.resourceCounts()), baseline, 'Controlled fixture ownership restored, not native evidence');
        entry.fixtureCountsAfter = fixture.counts();
      }
    });
  });
}

test('failure resources A4-08 actual snapshot160 bytes passes and159 refuses without publication', async () => {
  await recorder.observe(recipe.snapshotMaximum.id, 'actual-public-sdk2', async entry => {
    const module = await recorder.production(), baseline = nativeCounts(module);
    recorder.sample(entry, 'before-open');
    const editor = createEditor({ input: new Uint8Array(healthyBytes()), options: optionsFor(recorder.buildId), loader: async () => module });
    const events = [];
    try {
      accepted(await editor.ready);
      editor.subscribe(event => events.push(jsonData(event)));
      const before = { state: jsonData(state(editor)), context: jsonData(editor.context()), native: nativeCounts(module), js: jsonData(editor.resources()) };
      const receipt = snapshot(editor, recipe.snapshotMaximum.maximumBytes[0]);
      entry.exact = jsonData(receipt);
      try { assert.equal(receipt.canonical_json, healthyBytes().toString('utf8')); }
      finally { release(editor, receipt.handle); }
      recorder.sample(entry, 'after-exact-snapshot-and-release', editor);
      const response = completed(editor.submit({ kind: 'snapshot', stamp: editor.capture(), max_bytes: recipe.snapshotMaximum.maximumBytes[1] }));
      entry.over = jsonData(response);
      assert.equal(response.status, recipe.snapshotMaximum.expectedOver.status);
      assert.equal(response.diagnostic.code, recipe.snapshotMaximum.expectedOver.code);
      const afterState = { state: jsonData(state(editor)), context: jsonData(editor.context()), native: nativeCounts(module), js: jsonData(editor.resources()) };
      assert.deepEqual(afterState, before, 'Full state/history/context/resources unchanged after snapshot refusal');
      assert.deepEqual(events, []);
      entry.before = before; entry.afterRefusal = afterState; entry.events = events;
      recorder.sample(entry, 'after-refusal', editor);
    } finally {
      await settled(editor.destroy());
      recorder.sample(entry, 'after-owned-disposal', editor);
      ownedResourcesZero(editor.resources());
      assert.deepEqual(nativeCounts(module), baseline);
    }
  });
});

for (const [index, length] of recipe.eventPayload.utf16Units.entries()) {
  test(`failure resources ${recipe.eventPayload.ids[index]} preserves exact event-retention ownership`, async () => {
    await recorder.observe(recipe.eventPayload.ids[index], 'controlled-composition-owner-only', async entry => {
      const fixture = compositionEventFixture(), event = fixture.event(length);
      entry.input = { codeUtf16Units: event.code.length, codeSha256Utf8: digest(event.code), key: event.key, dataProperty: 'data' in event, inputTypeProperty: 'inputType' in event };
      entry.before = fixture.owner.resources();
      try {
        fixture.owner.keydown(event);
        assert.equal(fixture.recoveries.length, 1);
        const packet = fixture.recoveries[0], input = packet.composition.unappliedInput;
        assert.equal(packet.failure.diagnostic.code, recipe.eventPayload.expectedBoth.code);
        assert.equal(packet.failure.diagnostic.publication, recipe.eventPayload.expectedBoth.publication);
        assert.equal(packet.composition.reason, recipe.eventPayload.expectedBoth.reason);
        assert.equal(packet.region.provisionalText, recipe.eventPayload.expectedBoth.provisionalText);
        assert.equal(fixture.submissions(), recipe.eventPayload.expectedBoth.nativeSubmissions);
        assert.equal(input.kind, index === 0 ? recipe.eventPayload.expectedExactInputKind : recipe.eventPayload.expectedOverInputKind);
        if (index === 0) {
          assert.equal(input.code, event.code);
          assert.equal(input.key, '');
          assert.equal(input.data, null);
          assert.equal(input.inputType, null);
        } else {
          assert.equal(input.event, event, 'Original event identity is transferred rather than copied/truncated');
          assert.equal(input.ownership, recipe.eventPayload.expectedOverOwnership);
        }
        assert.equal(event.defaultPrevented, true);
        entry.failure = jsonData(packet.failure); entry.region = jsonData(packet.region);
        entry.recovery = { reason: packet.composition.reason, disposition: packet.composition.disposition, nativeOutcome: packet.composition.nativeOutcome,
          unappliedInput: { kind: input.kind, codeUtf16Units: input.kind === 'bounded' ? input.code.length : input.event.code.length,
            codeSha256Utf8: digest(input.kind === 'bounded' ? input.code : input.event.code), originalEventIdentityPreserved: input.kind === 'retained_event' ? input.event === event : null,
            ownership: input.kind === 'retained_event' ? input.ownership : 'bounded_owner_copy' } };
        entry.afterRefusal = fixture.owner.resources();
        recorder.sample(entry, 'after-event-capture-refusal', null, { controlled: true });
      } finally {
        fixture.owner.destroy();
        entry.afterOwnedDisposal = fixture.owner.resources();
        assert.deepEqual(entry.afterOwnedDisposal, { continuations: 0, retainedInputBytes: 0, retainedRecoveryRegions: 0 });
        assert.equal(fixture.intentObserverCount(), 0);
        entry.hostRecoveryRemains = fixture.recoveries.length;
        recorder.sample(entry, 'after-owned-disposal-host-packet-separate', null, { controlled: true });
      }
    });
  });
}
