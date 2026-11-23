// SPDX-License-Identifier: MIT OR Apache-2.0
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const steps = [
  ['--test', 'tests/vanilla-lifecycle.node.mjs'],
  ['node_modules/playwright/cli.js', 'test', '--config=playwright.vanilla.config.js'],
];

for (const args of steps) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
