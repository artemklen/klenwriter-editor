// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { pinnedNpmCli } from '../vanilla-alpha/pack.mjs';
import { prepareCrateUpload, publishCrate } from './crates-publish.mjs';
import { readRegistryArtifact } from './registry-readback.mjs';
import { verifyCandidate } from './verify-candidate.mjs';

const npmRegistry = 'https://registry.npmjs.org';
const root = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const packageMap = JSON.parse(readFileSync(join(root, 'package-map.json'), 'utf8'));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

function mergedSource(source) {
  assert.equal(git('status', '--porcelain'), '', 'Run publication from a clean checkout');
  assert.equal(git('rev-parse', source.commit + '^{tree}'), source.tree);
  git('fetch', '--no-tags', packageMap.repository + '.git', 'refs/heads/main');
  const canonical = git('rev-parse', 'FETCH_HEAD');
  git('merge-base', '--is-ancestor', source.commit, canonical);
  return canonical;
}

async function awaitRegistry(artifact, tag) {
  for (let attempt = 0; attempt < 24; attempt++) {
    try {
      const result = await readRegistryArtifact(artifact);
      if (result.status === 'verified' && (!tag || result.distTags?.[tag] === artifact.version)) return result;
    } catch (error) {
      if (error.code !== 'REGISTRY_PROPAGATION') throw error;
    }
    await delay(5_000);
  }
  throw new Error('Timed out waiting for public registry readback for ' + artifact.name);
}

function npmCommand(cli, args, cwd) {
  const env = { ...process.env };
  delete env.CARGO_REGISTRY_TOKEN;
  execFileSync(process.execPath, [cli, ...args, '--registry', npmRegistry,
    '--@klenwriter:registry=' + npmRegistry, '--fetch-retries=0', '--ignore-scripts'], {
    cwd, env, stdio: 'inherit', timeout: 180_000,
  });
}

function npmArchive(candidateRoot, artifact) {
  const archive = join(candidateRoot, artifact.path);
  const bytes = readFileSync(archive);
  assert.equal(bytes.length, artifact.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256);
  const pkg = JSON.parse(execFileSync('tar', ['-xOzf', archive, 'package/package.json'], { encoding: 'utf8' }));
  assert.equal(pkg.name, artifact.name);
  assert.equal(pkg.version, artifact.version);
  assert.equal(pkg.private, undefined);
  assert.equal(pkg.publishConfig, undefined, 'Expected an archive with default publish configuration');
  return archive;
}

function assertUsable(row) {
  assert(!row.yanked && !row.deprecated, 'The registry marks the accepted version as withdrawn: ' + row.name);
}

const [input, version, approvedHash, output, operation = 'check', ...extra] = process.argv.slice(2);
assert(input && version && approvedHash && output && !extra.length && ['check', 'publish', 'resume'].includes(operation),
  'Usage: node scripts/release/publish-candidate.mjs <candidate> <version> <manifest-sha256> <new-receipt> [check|publish|resume]');
const candidate = realpathSync(input);
const { manifest, manifestSha256 } = verifyCandidate(candidate, packageMap);
assert.equal(manifest.version, version);
assert.equal(manifestSha256, approvedHash);
const registryArtifacts = manifest.artifacts.filter(row => ['crate', 'npm'].includes(row.kind));
const receiptPath = join(realpathSync(dirname(resolve(output))), basename(output));
assert(relative(candidate, receiptPath).startsWith('..' + sep), 'Write the receipt outside the candidate bundle');
const receiptScratch = mkdtempSync(join(dirname(receiptPath), '.kwe-registry-receipt-'));
const receipt = { version, source: manifest.source, manifestSha256, operation, status: 'checking', registry: [] };
const temporaryReceipt = join(receiptScratch, 'receipt.json');
function saveReceipt() {
  writeFileSync(temporaryReceipt, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporaryReceipt, receiptPath);
}

try {
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  try {
    if (operation !== 'check') receipt.canonical = mergedSource(manifest.source);
    for (const artifact of registryArtifacts) {
      receipt.current = artifact.name;
      receipt.registry.push(await readRegistryArtifact(artifact));
      saveReceipt();
    }
    if (operation === 'check') {
      receipt.status = receipt.registry.every(row => row.status === 'verified') ? 'verified' : 'incomplete';
    } else {
      assert(operation === 'resume' || receipt.registry.every(row => row.status === 'absent'),
        'Registry already contains part or all of this version. Review the receipt before an authorized resume.');
      receipt.registry.forEach(assertUsable);
      const pending = registryArtifacts.filter((_, index) => receipt.registry[index].status === 'absent');
      const crateArchives = new Map(pending.filter(row => row.kind === 'crate').map(row =>
        [row.name, prepareCrateUpload(candidate, row, manifest.tools.rust)]));
      const npmArchives = new Map(pending.filter(row => row.kind === 'npm').map(row => [row.name, npmArchive(candidate, row)]));
      const token = process.env.CARGO_REGISTRY_TOKEN;
      assert(!crateArchives.size || token, 'Configure the authorized crates.io token in the publisher environment');
      const { cli } = pinnedNpmCli(root);
      const npmNeeded = receipt.registry.some(row => row.kind === 'npm' && row.distTags?.latest !== version);
      if (npmNeeded) npmCommand(cli, ['whoami'], receiptScratch);
      receipt.status = 'publishing';
      for (const [index, artifact] of registryArtifacts.entries()) {
        if (receipt.registry[index].status === 'verified') continue;
        receipt.current = artifact.name;
        receipt.registry[index] = await readRegistryArtifact(artifact);
        assertUsable(receipt.registry[index]);
        saveReceipt();
        if (receipt.registry[index].status === 'verified') continue;
        if (artifact.kind === 'crate') {
          await publishCrate(crateArchives.get(artifact.name), token);
        } else {
          npmCommand(cli, ['publish', npmArchives.get(artifact.name), '--access', 'public', '--tag', 'candidate'], receiptScratch);
        }
        receipt.registry[index] = await awaitRegistry(artifact);
        assertUsable(receipt.registry[index]);
        saveReceipt();
      }

      receipt.status = 'promoting';
      for (const [index, artifact] of registryArtifacts.entries()) {
        if (artifact.kind !== 'npm' || receipt.registry[index].distTags?.latest === version) continue;
        receipt.current = artifact.name;
        saveReceipt();
        npmCommand(cli, ['dist-tag', 'add', `${artifact.name}@${version}`, 'latest'], receiptScratch);
        receipt.registry[index] = await awaitRegistry(artifact, 'latest');
        assertUsable(receipt.registry[index]);
        saveReceipt();
      }
      receipt.status = 'published';
    }
    delete receipt.current;
    saveReceipt();
  } catch (error) {
    receipt.status = 'stopped';
    receipt.failure = error.message;
    saveReceipt();
    throw error;
  }
} finally {
  rmSync(receiptScratch, { recursive: true, force: true });
}
console.log(receiptPath);
