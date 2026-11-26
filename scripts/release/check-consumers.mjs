// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBrowserConsumers } from './consumer-browser.mjs';
import { runNativeConsumer } from './native-consumer.mjs';
import { verifyCandidate } from './verify-candidate.mjs';

const [path, ...rest] = process.argv.slice(2);
assert(path && rest.length === 0, 'Usage: node scripts/release/check-consumers.mjs <candidate>');
const sourceRoot = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
const candidateRoot = await realpath(path);
const packageMap = JSON.parse(await readFile(join(sourceRoot, 'package-map.json'), 'utf8'));
const { manifest, manifestSha256 } = verifyCandidate(candidateRoot, packageMap);
const git = (...args) => execFileSync('git', args, { cwd: sourceRoot, encoding: 'utf8' }).trim();
assert.equal(git('rev-parse', `${manifest.source.commit}^{tree}`), manifest.source.tree);
const runnerCommit = git('rev-parse', 'HEAD');
assert.equal(git('status', '--porcelain'), '', 'Run the consumer harness from a clean checkout');
const options = { sourceRoot, candidateRoot, manifest };
const native = runNativeConsumer(options);
const web = await runBrowserConsumers(options);
console.log(JSON.stringify({ source: manifest.source, runnerCommit, version: manifest.version, manifestSha256, native, web }, null, 2));
