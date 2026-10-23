// SPDX-License-Identifier: MIT OR Apache-2.0
// Bind frozen URL/count policy to actual current producer bytes before browsing.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { computeSdkBuildIdentity } from '../generate-sdk-types.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const contractPath = 'contracts/failure-states/v1/dom-assets.json';
const contractBytes = readFileSync(contractPath), contract = JSON.parse(contractBytes);
const current = computeSdkBuildIdentity();
const produced = JSON.parse(readFileSync('artifacts/sdk-build-identity.json', 'utf8'));
assert.equal(produced.buildId, current.buildId, 'Build must precede asset binding');
assert.deepEqual(produced.sourceHashes, current.sourceHashes);
const files = contract.files.map(({ url, path }) => {
  assert(!path.startsWith('/') && !path.split('/').includes('..'));
  const stat = lstatSync(path); assert(stat.isFile() && !stat.isSymbolicLink());
  const bytes = readFileSync(path);
  return { url, path, bytes: bytes.length, sha256: sha(bytes) };
});
assert.equal(files.length, 52); assert.equal(new Set(files.map(file => file.url)).size, 52);
const binding = { format: 'osr67-ac1-current-assets/1', contractSha256: sha(contractBytes),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  buildId: current.buildId, sourceHashes: current.sourceHashes, files };
writeFileSync('artifacts/failure-states/dom-assets-current.json', JSON.stringify(binding, null, 2) + '\n');
console.log(`Bound ${files.length} frozen asset URLs to ${binding.buildId}`);
