// SPDX-License-Identifier: MIT OR Apache-2.0
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';

export function runNativeConsumer({ sourceRoot, candidateRoot, manifest }) {
  const root = realpathSync(sourceRoot);
  const script = join(root, 'examples/native-quickstart/run.py');
  const output = execFileSync('python3', ['-E', script, 'run-candidate', realpathSync(candidateRoot)], {
    cwd: root,
    input: JSON.stringify(manifest),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return JSON.parse(output);
}
