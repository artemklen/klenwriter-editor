// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

test('an unsafe leading space followed by an unbroken run terminates with full text', () => {
  const moduleUrl = new URL('../packages/dom/dist/text-fragments.js', import.meta.url);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import {planTextFragments} from ${JSON.stringify(moduleUrl.href)};
    const text = ' \\u0301' + 'x'.repeat(600);
    assert.deepEqual(planTextFragments(text), [text]);
  `], {encoding: 'utf8', timeout: 2000});
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
