// SPDX-License-Identifier: MIT OR Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeScenario } from '../scripts/reliability/scenarios.mjs';
import { failureSignature, finiteScenarioParameters, sameFailure, shrinkRaw, shrinkScenario } from '../scripts/reliability/shrink.mjs';
import { readRegressionScenarios, recordReproducer } from '../scripts/reliability/reproducers.mjs';
import { readScenarios, superviseProcess } from '../scripts/reliability/replay-sdk.mjs';

const literal = JSON.parse(readFileSync(new URL('../contracts/reliability/v1/shrinker-literals.json', import.meta.url)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const text = expected => JSON.parse(expected.canonical_json).content[0].content[0].text;
const marker = bytes => Buffer.from(bytes).includes(Buffer.from('BUG!'));

// Deliberately incorrect test model. This is never a production failure probe.
function faultyModel(scenario) {
  let actual = text(scenario.initialExpected), selection = null; const undo = [], redo = [];
  for (const [index, action] of scenario.actions.entries()) {
    if (action.op === 'select') selection = [action.from, action.to];
    else if (action.op === 'insert_text') {
      const before = { actual, selection: selection.slice() };
      actual = actual.slice(0, selection[0]) + action.text.replaceAll('\u00a0', ' ') + actual.slice(selection[1]);
      selection = [selection[0] + action.text.length, selection[0] + action.text.length];
      undo.push({ before, after: { actual, selection: selection.slice() } }); redo.length = 0;
    } else if (action.op === 'undo') { const unit = undo.pop(); redo.push(unit); ({ actual, selection } = structuredClone(unit.before)); }
    else if (action.op === 'redo') { const unit = redo.pop(); undo.push(unit); ({ actual, selection } = structuredClone(unit.after)); }
    if (actual !== text(action.expected)) return { failed: true, signature: { ...literal.signature, actionIndex: index, opaqueId: 'variable-test-only' } };
  }
  return { failed: false };
}

test('frozen faulty NBSP model reduces to hand-authored one-edit trigger with independent expectations regenerated', async () => {
  const scenario = makeScenario(literal.model), original = Buffer.from(JSON.stringify(scenario, null, 2) + '\n');
  const result = await shrinkScenario(scenario, { originalBytes: original, signature: literal.signature, probe: async candidate => faultyModel(candidate) });
  assert.equal(result.status, 'reduced'); assert.deepEqual(result.original, new Uint8Array(original));
  const parameters = finiteScenarioParameters(result.scenario);
  assert.deepEqual(parameters.edits, literal.model.expectedMinimalEdits);
  assert.equal(text(result.scenario.actions[1].expected), literal.model.expectedMinimalAfterInsertText);
  assert.equal(result.minimizedActionCount, 4); assert(result.probes <= 128);
  for (const step of result.trace.filter(step => step.matches)) assert.deepEqual(step.signature, literal.signature);
  assert.deepEqual(JSON.parse(Buffer.from(result.minimized)), result.scenario);
});

test('raw byte ddmin retains original invalid UTF8 and finds literal BUG! trigger', async () => {
  const original = Buffer.from(literal.raw.inputHex, 'hex');
  const result = await shrinkRaw(original, { signature: literal.raw.signature, probe: async bytes => ({ failed: marker(bytes), signature: literal.raw.signature }) });
  assert.equal(Buffer.from(result.minimized).toString('hex'), literal.raw.expectedMinimalHex);
  assert.equal(Buffer.from(result.original).toString('hex'), literal.raw.inputHex); assert.equal(result.status, 'reduced');
});

test('signature preserves invariant/phase/class/target/context while ignoring incidental index and IDs', () => {
  assert(sameFailure(literal.signature, { ...literal.signature, actionIndex: 99, opaqueId: 'different' }));
  for (const key of ['invariant', 'phase', 'class', 'target', 'context']) assert.equal(sameFailure(literal.signature, { ...literal.signature, [key]: 'different' }), false);
  assert.equal(sameFailure(literal.parserEscape.semanticSignature, literal.parserEscape.parserSignature), false);
  assert.throws(() => failureSignature({ ...literal.signature, phase: '' }), /phase/);
});

test('a parser escape cannot replace the frozen semantic JSON failure', async () => {
  const probe = async bytes => {
    try { const value = JSON.parse(Buffer.from(bytes)); return { failed: value.text === 'BUG!', signature: literal.parserEscape.semanticSignature }; }
    catch { return { failed: true, signature: literal.parserEscape.parserSignature }; }
  };
  const result = await shrinkRaw(Buffer.from(literal.parserEscape.original), { signature: literal.parserEscape.semanticSignature, probe });
  assert.equal((await probe(Buffer.from(literal.parserEscape.candidate))).signature.class, 'syntax');
  assert.equal(JSON.parse(Buffer.from(result.minimized)).text, 'BUG!');
  for (const step of result.trace.filter(step => step.matches)) assert.deepEqual(step.signature, literal.parserEscape.semanticSignature);
  assert(result.trace.some(step => step.signature?.class === 'syntax' && !step.matches));
});

test('unsupported traces and invalid dependency coordinates preserve original without a probe or retarget', async () => {
  const scenario = makeScenario(literal.model); scenario.actions[0].op = literal.unsupported.operation;
  const original = Buffer.from(JSON.stringify(scenario, null, 2)); let calls = 0;
  const result = await shrinkScenario(scenario, { originalBytes: original, signature: literal.signature, probe: async () => { calls++; return { failed: true, signature: literal.signature }; } });
  assert.equal(result.status, literal.unsupported.expectedStatus); assert.equal(result.reason, literal.unsupported.reason);
  assert.equal(calls, 0); assert.deepEqual(result.minimized, new Uint8Array(original));
  const splitCluster = makeScenario({ id: 'test-bad-boundary', context: 'kwdj-prose', initialText: 'Le\u0301R', edits: [{ from: 2, to: 2, inserted: 'A' }] });
  assert.equal(finiteScenarioParameters(splitCluster), null, 'never authorize an interior finite-token endpoint');
});

test('probe/time limits only tighten, original mismatch and callback errors never become minimized success', async () => {
  let calls = 0; const original = Buffer.from('BUG!');
  const zero = await shrinkRaw(original, { signature: literal.raw.signature, limits: { maxProbes: 0 }, probe: async () => { calls++; return { failed: true, signature: literal.raw.signature }; } });
  assert.equal(calls, 0); assert.equal(zero.status, 'not_minimized'); assert.equal(zero.reason, 'probe_budget');
  const no = await shrinkRaw(original, { signature: literal.raw.signature, probe: async () => ({ failed: false }) });
  assert.equal(no.reason, 'original_not_reproduced'); assert.deepEqual(no.minimized, new Uint8Array(original));
  const thrown = await shrinkRaw(original, { signature: literal.raw.signature, probe: async () => { throw new Error('test callback transport exception'); } });
  assert.equal(thrown.reason, 'probe_error'); assert.equal(thrown.trace[0].matches, false);
  await assert.rejects(shrinkRaw(original, { signature: literal.raw.signature, limits: { maxProbes: 129 }, probe: async () => ({ failed: false }) }), /tighten/);
  const late = await shrinkRaw(original, { signature: literal.raw.signature, limits: { maxElapsedMs: 1 }, probe: async () => { await new Promise(done => setTimeout(done, 10)); return { failed: true, signature: literal.raw.signature }; } });
  assert.equal(late.reason, 'time_budget'); assert.deepEqual(late.minimized, new Uint8Array(original));
});

test('probe-side mutations cannot rewrite preserved raw bytes or finite independent expectations', async () => {
  const bytes = Buffer.from('BUG!'), scenario = makeScenario(literal.model), before = structuredClone(scenario);
  const raw = await shrinkRaw(bytes, { signature: literal.raw.signature, probe: async candidate => { candidate.fill(0); return { failed: false }; } });
  assert.equal(bytes.toString(), 'BUG!'); assert.equal(Buffer.from(raw.original).toString(), 'BUG!');
  await shrinkScenario(scenario, { signature: literal.signature, probe: async candidate => { candidate.actions[0].expected.canonical_json = 'rewritten'; return { failed: false }; } });
  assert.deepEqual(scenario, before);
});

test('controlled external watchdog callback kills a hung probe; timeout never replaces semantic failure', { timeout: 10000 }, async () => {
  const result = await shrinkRaw(Buffer.from('BUG!'), { signature: literal.raw.signature, limits: { maxProbes: 1 }, probe: async (_candidate, limits) => {
    const actual = await superviseProcess({ args: ['-e', "process.send({kind:'ready'});process.on('message',()=>{while(true){}})"], task: {}, timeoutMs: Math.min(80, limits.timeoutMs), startupMs: 5000 });
    assert.equal(actual.signal, 'SIGKILL'); assert.equal(actual.failure.code, 'reliability.input_timeout');
    return { failed: true, signature: { ...literal.raw.signature, phase: 'watchdog', class: 'timeout' } };
  } });
  assert.equal(result.status, 'not_minimized'); assert.equal(result.trace[0].matches, false);
  assert.equal(Buffer.from(result.minimized).toString(), 'BUG!');
});

test('exclusive recorder readback binds exact original/minimized bytes, trace and actual source/artifact pins', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'reliability-reproducer-')), source = join(directory, 'source.txt'), artifact = join(directory, 'artifact.bin');
  writeFileSync(source, 'test-only source\n'); writeFileSync(artifact, Buffer.from([0, 255, 38]));
  const result = await shrinkRaw(Buffer.from(literal.raw.inputHex, 'hex'), { signature: literal.raw.signature, probe: async bytes => ({ failed: marker(bytes), signature: literal.raw.signature }) });
  const options = { directory, reduction: result, seed: 38, sourceFiles: [source], build: { id: 'test-only-probe-build', artifactPath: artifact }, qualification: 'Deliberately test-only marker; not a production regression.' };
  const recorded = recordReproducer(options), second = recordReproducer(options); assert.notEqual(recorded.path, second.path);
  const receipt = JSON.parse(readFileSync(recorded.receipt.path)); assert.equal(receipt.signature.target, 'test-only-byte-probe');
  assert.equal(lstatSync(recorded.path).mode & 0o777, 0o700);
  assert.equal(receipt.sourcePins[0].sha256, hash(readFileSync(source))); assert.equal(receipt.build.artifact.sha256, hash(readFileSync(artifact)));
  for (const file of recorded.files) { assert.equal(hash(readFileSync(file.path)), file.sha256); assert.equal(lstatSync(file.path).mode & 0o777, 0o600); }
  assert.equal(readFileSync(join(recorded.path, 'original.bin')).toString('hex'), literal.raw.inputHex);
  assert.equal(readFileSync(join(recorded.path, 'minimized.bin')).toString('hex'), literal.raw.expectedMinimalHex);
  assert.throws(() => recordReproducer({ ...options, reduction: { ...result, limits: { ...result.limits, maxEvidenceBytes: 1 } } }), /aggregate/);
  const link = join(directory, 'source-link'); symlinkSync(source, link);
  assert.throws(() => recordReproducer({ ...options, sourceFiles: [link] }), /regular/);
});

test('regression-first reader loads exact saved scenarios in sorted file/line order and refuses symlink/unsupported corpus', () => {
  const directory = mkdtempSync(join(tmpdir(), 'reliability-regressions-'));
  const first = makeScenario({ ...literal.model, id: 'saved-first' }), second = makeScenario({ ...literal.model, id: 'saved-second' });
  writeFileSync(join(directory, 'b.jsonl'), JSON.stringify(second) + '\n'); writeFileSync(join(directory, 'a.jsonl'), JSON.stringify(first) + '\n');
  const read = readRegressionScenarios(directory); assert.deepEqual(read.selected.map(item => item.scenario.id), ['saved-first', 'saved-second']); assert.equal(read.files.length, 2);
  const sdk = readScenarios({ perContext: 0, regressionDirectory: directory });
  assert.deepEqual(sdk.selected.slice(0, 2).map(item => item.scenario.id), ['saved-first', 'saved-second']);
  assert.equal(sdk.selected.length, 14); assert.equal(sdk.regressions.files[0].sha256, hash(readFileSync(join(directory, 'a.jsonl'))));
  symlinkSync(join(directory, 'a.jsonl'), join(directory, 'c.jsonl')); assert.throws(() => readRegressionScenarios(directory), /regular/);
  const unsupported = mkdtempSync(join(tmpdir(), 'reliability-regressions-invalid-')); mkdirSync(join(unsupported, 'nested'));
  const bad = structuredClone(first); bad.actions[0].op = 'move'; writeFileSync(join(unsupported, 'bad.jsonl'), JSON.stringify(bad) + '\n');
  assert.throws(() => readRegressionScenarios(unsupported), /unsupported/);
});
