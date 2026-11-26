// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cratesSource = 'registry+https://github.com/rust-lang/crates.io-index';
const publishURL = 'https://crates.io/api/v1/crates/new';
const run = (command, args, cwd) => execFileSync(command, args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024,
});

function crateMetadata(path, { name, version }, rust) {
  const scratch = mkdtempSync(join(tmpdir(), 'kwe-crates-publish-'));
  try {
    const prefix = name + '-' + version;
    const members = run('tar', ['-tzf', path], scratch).trimEnd().split('\n');
    assert(new Set(members).size === members.length && members.includes(prefix + '/Cargo.toml'));
    assert(members.every(member => member.startsWith(prefix + '/') &&
      member.split('/').every(part => part && part !== '..' && part !== '.')));
    run('tar', ['-xzf', path], scratch);
    const crateRoot = join(scratch, prefix);
    const { packages } = JSON.parse(run('cargo', [`+${rust}`, 'metadata', '--no-deps', '--offline',
      '--locked', '--format-version', '1'], crateRoot));
    assert.equal(packages.length, 1);
    const [pkg] = packages;
    assert.equal(pkg.name, name);
    assert.equal(pkg.version, version);
    assert.deepEqual(pkg.publish, ['crates-io']);
    return {
      name, vers: version,
      deps: pkg.dependencies.map(dep => {
        assert.equal(dep.source, cratesSource, 'Expected a normalized crates.io dependency');
        assert.equal(dep.path ?? null, null);
        return {
          name: dep.name, version_req: dep.req, features: dep.features, optional: dep.optional,
          default_features: dep.uses_default_features, target: dep.target, kind: dep.kind ?? 'normal',
          registry: null, explicit_name_in_toml: dep.rename,
        };
      }),
      features: pkg.features, authors: pkg.authors, description: pkg.description,
      documentation: pkg.documentation, homepage: pkg.homepage,
      readme: pkg.readme ? run('tar', ['-xOzf', path, prefix + '/' + pkg.readme], scratch) : null,
      readme_file: pkg.readme, keywords: pkg.keywords, categories: pkg.categories,
      license: pkg.license, license_file: pkg.license_file, repository: pkg.repository,
      badges: {}, links: pkg.links, rust_version: pkg.rust_version,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function prepareCrateUpload(candidateRoot, artifact, rust) {
  assert.equal(artifact.kind, 'crate');
  assert.match(artifact.name, /^klenwriter-editor-[a-z0-9-]+$/);
  assert.match(artifact.version, /^\d+\.\d+\.\d+$/);
  assert.match(rust, /^\d+\.\d+\.\d+$/);
  const path = join(candidateRoot, artifact.path);
  const bytes = readFileSync(path);
  assert.equal(bytes.length, artifact.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256);
  const metadata = Buffer.from(JSON.stringify(crateMetadata(path, artifact, rust)));
  const metadataLength = Buffer.alloc(4);
  const archiveLength = Buffer.alloc(4);
  metadataLength.writeUInt32LE(metadata.length);
  archiveLength.writeUInt32LE(bytes.length);
  return Buffer.concat([metadataLength, metadata, archiveLength, bytes]);
}

export async function publishCrate(body, token) {
  const response = await fetch(publishURL, {
    method: 'PUT', body, redirect: 'error', signal: AbortSignal.timeout(120_000),
    headers: { Authorization: token, Accept: 'application/json', 'Content-Type': 'application/octet-stream',
      'User-Agent': 'KlenWriter-editor-release (https://github.com/artemklen/klenwriter-editor)' },
  });
  assert(response.ok, 'crates.io publish failed with HTTP ' + response.status +
    (response.headers.has('retry-after') ? ' (Retry-After ' + response.headers.get('retry-after') + ')' : ''));
  const result = await response.json();
  assert(!result.errors?.length, 'crates.io reported an upload error');
  assert(Object.values(result.warnings ?? {}).every(entries => entries.length === 0),
    'crates.io reported publication warnings; inspect the public receipt before resuming');
}
