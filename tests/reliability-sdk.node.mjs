// SPDX-License-Identifier: MIT OR Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readScenarios, runSdkReplay, superviseProcess, supplementalCases } from '../scripts/reliability/replay-sdk.mjs';

test('actual packaged SDK: all twelve independent literals and five separately labelled public boundary/lifecycle supplements', { timeout: 90000 }, async () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'osr-38-sdk-focused-'));
  const regressionDirectory = mkdtempSync(join(tmpdir(), 'osr-38-sdk-focused-empty-regressions-'));
  const report = await runSdkReplay({ perContext: 0, outputRoot, regressionDirectory });
  assert.equal(report.status, 'passed', JSON.stringify(report.failures));
  assert.equal(report.summary.literalCases, 12); assert.equal(report.summary.supplementalCases, 5);
  assert.equal(report.summary.completed, 17); assert.equal(report.summary.meetsGeneratedSdkFloor, false);
  const supplemental = report.observations.filter(item => item.kind === 'supplemental');
  assert.equal(supplemental.length, supplementalCases.length);
  for (const item of supplemental) {
    const raw = JSON.parse(readFileSync(item.path, 'utf8'));
    assert.equal(raw.returnCode, 0); assert.equal(raw.result.status, 'passed');
    assert.match(raw.result.category, /actual|existing-independent/);
  }
});

test('frozen scenario selection reserves first64 generated per context independently from twelve literals', () => {
  const regressionDirectory = mkdtempSync(join(tmpdir(), 'osr-38-sdk-selection-empty-regressions-'));
  const selected = readScenarios({ regressionDirectory });
  assert.equal(selected.selected.length, 268);
  for (const context of ['kwdj-prose', 'kwdj-poetry', 'notes-d0', 'notes-d1']) {
    const cases = selected.selected.filter(item => item.scenario.context === context);
    assert.equal(cases.filter(item => item.scenario.id.startsWith('R38-literal-')).length, 3);
    assert.equal(cases.filter(item => !item.regression && !item.scenario.id.startsWith('R38-literal-')).length, 64);
  }
  assert.equal(selected.regressions.selected.length, 0);
});

test('controlled watchdog self-test: parent kills a synchronous test-only infinite JS loop', { timeout: 10000 }, async () => {
  // This proves the external host watchdog, never a production WASM failure.
  const program = "process.send({kind:'ready'});process.on('message',()=>{while(true){}})";
  const actual = await superviseProcess({ args: ['-e', program], task: {}, timeoutMs: 80, startupMs: 5000 });
  assert.equal(actual.failure.code, 'reliability.input_timeout'); assert.equal(actual.signal, 'SIGKILL');
  assert.equal(actual.result, null); assert.equal(actual.failure.phase, 'case');
});

test('controlled watchdog self-test: oversized child evidence fails visibly instead of dropping data and passing', { timeout: 10000 }, async () => {
  const program = "process.send({kind:'ready'});process.on('message',()=>{process.stdout.write('x'.repeat(2097152));setInterval(()=>{},1000)})";
  const actual = await superviseProcess({ args: ['-e', program], task: {}, timeoutMs: 2000, startupMs: 5000 });
  assert.equal(actual.failure.code, 'reliability.evidence_limit'); assert.equal(actual.signal, 'SIGKILL');
  assert.ok(Buffer.byteLength(actual.stdout) <= 1024 * 1024);
});
