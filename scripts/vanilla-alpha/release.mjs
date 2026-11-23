// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanHead, packVanillaAlpha, pinnedNpmCli } from './pack.mjs';
import { smokeAlphaBundle } from './smoke.mjs';

const root = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
assert.equal(process.argv.length, 2, 'Usage: node scripts/vanilla-alpha/release.mjs');
const sourceSha = cleanHead(root);
const npm = pinnedNpmCli(root);
const build = spawnSync(process.execPath, [npm.cli, 'run', 'build'], { cwd: root, stdio: 'inherit' });
if (build.error) throw build.error;
assert.equal(build.status, 0, 'Build the exact workspace before packaging');

const output = join(root, 'artifacts', 'vanilla-alpha');
mkdirSync(output, { recursive: true });
const run = mkdtempSync(join(output, 'build-'));
const bundle = join(run, 'packages');
const pack = await packVanillaAlpha(root, bundle, sourceSha);
const smoke = await smokeAlphaBundle(root, bundle);
assert.equal(smoke.sourceSha, pack.sourceSha);
assert.equal(smoke.sdkBuildId, pack.sdkBuildId);
writeFileSync(join(run, 'smoke-receipt.json'), JSON.stringify(smoke, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({
  sourceSha: pack.sourceSha,
  sdkBuildId: pack.sdkBuildId,
  packages: relative(root, bundle),
  smoke: relative(root, join(run, 'smoke-receipt.json')),
  tarballs: pack.tarballs.map(({ name, version, filename, sha256 }) => ({ name, version, filename, sha256 })),
}));
