// SPDX-License-Identifier: MIT OR Apache-2.0
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const toolchain = resolve(root, 'scripts/angular-build');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('npm', ['ci', '--prefix', toolchain, '--ignore-scripts', '--no-audit', '--no-fund']);
const compiler = resolve(toolchain, 'node_modules/@angular/compiler-cli');
const compilerRequire = createRequire(resolve(compiler, 'package.json'));
const { version } = compilerRequire('typescript/package.json');
if (version !== '6.0.2') throw new Error(`Expected Angular compiler TypeScript 6.0.2, received ${version}`);
const manifest = JSON.parse(readFileSync(resolve(compiler, 'package.json'), 'utf8'));
run(process.execPath, [resolve(compiler, manifest.bin.ngc), '-p', 'packages/angular/tsconfig.json']);
