import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const sha = value => createHash('sha256').update(value).digest('hex');

// Exact scoped fallback for upstream crate tarballs that omit the repository root license.
// No other package/version is exempted from the ordinary missing-text failure.
function pinnedGeneratorLicense(pkg, directory) {
  assert(new Set(['ts-rs@12.0.1', 'ts-rs-macros@12.0.1']).has(`${pkg.name}@${pkg.version}`),
    `No license text found for ${pkg.name}; review provenance before packaging`);
  const manifest = JSON.parse(readFileSync('provenance/licenses/sdk-generator-license-sources.json', 'utf8'));
  assert.equal(manifest.format, 'klenwriter-editor-license-fallbacks/1');
  const rows = manifest.packages.filter(row => row.name === pkg.name && row.version === pkg.version);
  assert.equal(rows.length, 1, 'One exact package license record required');
  const row = rows[0];
  for (const key of ['license', 'repository', 'source']) assert.equal(pkg[key], row[key], `Pinned ${pkg.name} ${key} differs`);
  assert.equal(pkg.license, 'MIT');
  assert.equal(row.vcsCommit, '7182ad8289596097235406b715fa04506443b4ad');
  assert.equal(row.repository, 'https://github.com/Aleph-Alpha/ts-rs');
  assert.equal(row.upstreamLicenseUrl, `${row.repository.replace('https://github.com/', 'https://raw.githubusercontent.com/')}/${row.vcsCommit}/LICENSE`);
  const vcs = JSON.parse(readFileSync(join(directory, '.cargo_vcs_info.json'), 'utf8'));
  assert.equal(vcs.git.sha1, row.vcsCommit); assert.notEqual(vcs.git.dirty, true);
  assert.equal(vcs.path_in_vcs, row.pathInVcs);
  const lock = readFileSync('Cargo.lock', 'utf8');
  const blocks = [...lock.matchAll(/\[\[package\]\]\n([\s\S]*?)(?=\n\[\[package\]\]|$)/g)].map(match => match[1]);
  const field = (text, name) => new RegExp(`^${name} = "([^"\\n]+)"$`, 'm').exec(text)?.[1];
  const entries = blocks.filter(block => field(block, 'name') === pkg.name && field(block, 'version') === pkg.version);
  assert.equal(entries.length, 1); assert.equal(field(entries[0], 'checksum'), row.crateChecksum);
  assert.equal(field(entries[0], 'source'), row.source);
  // Verify the original .crate archive as well as its extracted VCS metadata. No registry writes.
  const sourceIndex = dirname(directory); const registry = dirname(dirname(sourceIndex));
  assert.equal(basename(dirname(sourceIndex)), 'src');
  const archive = join(registry, 'cache', basename(sourceIndex), `${pkg.name}-${pkg.version}.crate`);
  assert.equal(sha(readFileSync(archive)), row.crateChecksum, 'Original crate archive checksum differs');
  assert(row.licenseFile.startsWith('provenance/licenses/') && !row.licenseFile.split('/').includes('..'));
  const bytes = readFileSync(resolve(row.licenseFile));
  assert.equal(bytes.length, row.licenseBytes); assert.equal(sha(bytes), row.licenseSha256);
  return { row, bytes };
}

// Include the actual upstream license texts, not just SPDX labels, in web artifacts.
export function writeDependencyNotices() {
  const result = spawnSync('cargo', ['metadata', '--all-features', '--format-version=1', '--locked'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const metadata = JSON.parse(result.stdout);
  const fallbacks = [];
  const notices = ['Third-party Rust dependency notices for the WASM distribution.',
    'Conservatively includes the full locked workspace closure with all optional development features (including native-only generators and build dependencies).'];
  for (const pkg of metadata.packages.filter(pkg => pkg.source).sort((a,b) => a.name.localeCompare(b.name))) {
    const dir = dirname(pkg.manifest_path);
    const files = readdirSync(dir).filter(name => /^(LICENSE|COPYING|COPYRIGHT)([.\-_]|$)/i.test(name));
    const fallback = files.length ? null : pinnedGeneratorLicense(pkg, dir);
    notices.push(`\n===== ${pkg.name} ${pkg.version} (${pkg.license}) =====`);
    if (fallback) {
      fallbacks.push(fallback.row);
      notices.push(`--- ${fallback.row.licenseFile} (official ${fallback.row.upstreamLicenseUrl}; crate SHA256 ${fallback.row.crateChecksum}) ---\n${fallback.bytes.toString('utf8').replaceAll('\r\n', '\n').trimEnd()}`);
    }
    for (const name of files) notices.push(`--- ${name} ---\n${readFileSync(join(dir, name), 'utf8').replaceAll('\r\n', '\n').trimEnd()}`);
  }
  writeFileSync('packages/wasm/THIRD-PARTY-NOTICES', notices.join('\n').trimEnd() + '\n');
  return { registryPackages: metadata.packages.filter(pkg => pkg.source).length, pinnedLicenseFallbacks: fallbacks };
}
