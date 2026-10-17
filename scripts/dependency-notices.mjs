import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

// Include the actual upstream license texts, not just SPDX labels, in web artifacts.
export function writeDependencyNotices() {
  const result = spawnSync('cargo', ['metadata', '--format-version=1', '--locked'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const metadata = JSON.parse(result.stdout);
  const notices = ['Third-party Rust dependency notices for the WASM distribution.',
    'Conservatively includes the full locked workspace closure (including build dependencies).'];
  for (const pkg of metadata.packages.filter(pkg => pkg.source).sort((a,b) => a.name.localeCompare(b.name))) {
    const dir = dirname(pkg.manifest_path);
    const files = readdirSync(dir).filter(name => /^(LICENSE|COPYING|COPYRIGHT)([.\-_]|$)/i.test(name));
    assert(files.length, `No license text found for ${pkg.name}; review provenance before packaging`);
    notices.push(`\n===== ${pkg.name} ${pkg.version} (${pkg.license}) =====`);
    for (const name of files) notices.push(`--- ${name} ---\n${readFileSync(join(dir, name), 'utf8').replaceAll('\r\n', '\n').trimEnd()}`);
  }
  writeFileSync('packages/wasm/THIRD-PARTY-NOTICES', notices.join('\n').trimEnd() + '\n');
}
