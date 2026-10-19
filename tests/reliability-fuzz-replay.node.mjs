// SPDX-License-Identifier: MIT OR Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { admissionInputBytes } from '../scripts/reliability/fuzz-replay-child.mjs';
import { execute } from '../scripts/reliability/fuzz.mjs';

test('admission replay keeps a UTF-8 BOM in the original bytes', () => {
  const bom = Uint8Array.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]);
  const kept = admissionInputBytes(bom);
  assert.deepEqual([...kept], [...bom]);
  assert.equal(admissionInputBytes(Uint8Array.from([0xff])), null);
});

test('packaged admission refuses a BOM-prefixed seed instead of stripping it', async () => {
  const seed = readFileSync('tests/fixtures/fuzz-native/seeds/admission_options/0-0-kwdj-prose.seed');
  assert.equal(seed[0], 0);
  const payload = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), seed.subarray(1)]);
  assert.deepEqual([...admissionInputBytes(payload)], [...payload]);
  const child = spawn(process.execPath, ['scripts/reliability/fuzz-replay-child.mjs'], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('replay child did not become ready')), 60_000);
    child.on('message', message => {
      if (message?.kind !== 'ready') return;
      clearTimeout(timer);
      resolve(message);
    });
  });
  await ready;
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('replay child did not answer')), 30_000);
    child.on('message', message => {
      if (message?.kind !== 'result') return;
      clearTimeout(timer);
      resolve(message.result);
    });
    child.send({ kind: 'admission', index: 0, context: 'kwdj-prose', payloadB64: payload.toString('base64') });
  });
  child.kill('SIGKILL');
  assert.equal(result.status, 'ok-refused');
});

test('the lane watchdog stops a child and its grandchild', async () => {
  const run = await execute({ binary: 'sh', args: ['-c', 'sleep 30 & echo $!; wait'], timeoutMs: 1000 });
  assert.equal(run.failure?.code, 'reliability.fuzz_watchdog');
  const pid = Number(run.stdout.toString('utf8').trim().split('\n')[0]);
  assert.ok(Number.isInteger(pid) && pid > 0);
  assert.throws(() => process.kill(pid, 0));
});
