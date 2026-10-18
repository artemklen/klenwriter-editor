import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { identity } from './package-identity.mjs';

function output(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
const metadata = JSON.parse(output('cargo', ['metadata', '--format-version=1', '--locked']));
const byId = new Map(metadata.packages.map(pkg => [pkg.id, pkg]));
const members = new Set(metadata.workspace_members);
const resolved = new Map(metadata.resolve.nodes.map(node => [node.id, node]));
// Enforce the architectural boundary on the full transitive closure, not just imports.
for (const name of ['klenwriter-editor-core', 'klenwriter-editor-engine', 'klenwriter-editor-kwdj']) {
  const pkg = metadata.packages.find(pkg => pkg.name === name);
  const closure = new Set();
  function visit(id) {
    if (closure.has(id)) return;
    closure.add(id);
    for (const dep of resolved.get(id).dependencies) visit(dep);
  }
  visit(pkg.id);
  for (const id of closure) {
    const dep = byId.get(id);
    assert(!/^(wasm-bindgen|js-sys|web-sys|sqlx|tokio|klenwriter-editor-wasm)/.test(dep.name), `${name} imports host/runtime ${dep.name}`);
    if (name === 'klenwriter-editor-engine') assert.notEqual(dep.name, 'klenwriter-editor-kwdj');
    if (name === 'klenwriter-editor-kwdj') assert.notEqual(dep.name, 'klenwriter-editor-engine');
    if (name === 'klenwriter-editor-core') assert(!/^klenwriter-editor-(engine|kwdj)$/.test(dep.name));
  }
}
for (const pkg of metadata.packages) {
  assert(pkg.license, `Missing dependency license for ${pkg.name}`);
  assert(!pkg.source || pkg.source.startsWith('registry+https://github.com/rust-lang/crates.io-index'), `Nonpublic source ${pkg.name}`);
  if (members.has(pkg.id)) {
    assert.deepEqual(pkg.publish, [], `${pkg.name} must not publish before OSR-71`);
    assert.equal(pkg.license, 'MIT OR Apache-2.0');
  }
}
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const packageGraph = { wasm: [], sdk: ['wasm'], dom: ['sdk'], kwdj: ['sdk'], vanilla: ['dom'], angular: ['vanilla'] };
for (const [name, allowed] of Object.entries(packageGraph)) {
  const manifest = JSON.parse(readFileSync(`packages/${name}/package.json`, 'utf8'));
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), allowed.map(name => identity.web[name].name).sort(),
    `${name}: review a changed runtime dependency boundary against the ADR`);
}
for (const [path, pkg] of Object.entries(lock.packages)) {
  assert(!pkg.resolved || pkg.link || pkg.resolved.startsWith('https://registry.npmjs.org/'), `Nonpublic npm source ${path}`);
}
const files = [];
function inspect(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = `${path}/${entry.name}`;
    if (entry.isDirectory()) inspect(file);
    else {
      const bytes = readFileSync(file);
      files.push({ path: file, bytes: bytes.length, gzipBytes: gzipSync(bytes).length,
        sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
}
for (const name of ['wasm', 'sdk', 'dom', 'kwdj', 'vanilla', 'angular']) inspect(`packages/${name}/dist`);
const report = {
  stage: 'OSR-29 extracted native semantics; sizes are not production editor budgets',
  toolchains: { rust: output('rustc', ['--version']).trim(), node: process.version, npm: output('npm', ['--version']).trim(),
    bindgen: output('.tools/bin/wasm-bindgen', ['--version']).trim() },
  targets: ['native', 'wasm32-unknown-unknown'],
  rust: metadata.packages.map(pkg => ({ name: pkg.name, version: pkg.version, license: pkg.license,
    msrv: pkg.rust_version, source: pkg.source, targets: pkg.targets.map(target => target.kind),
    dependencies: resolved.get(pkg.id).deps.map(dep => byId.get(dep.pkg).name) })).sort((a,b) => a.name.localeCompare(b.name)),
  npm: Object.entries(lock.packages).map(([path, pkg]) => ({ path, version: pkg.version, license: pkg.license,
    dev: pkg.dev ?? false, link: pkg.link ?? false, dependencies: pkg.dependencies ?? {}, integrity: pkg.integrity })),
  artifacts: files.sort((a,b) => a.path.localeCompare(b.path)),
  unicode: { implementation: 'unicode-segmentation', version: '1.13.3', unicodeVersion: '17.0.0', scope: 'logical extended grapheme boundaries; no browser layout proof' },
  plannedNotInstalled: ['parse5 (clipboard proof, OSR-47)',
    'Angular (peer only at binding implementation, OSR-49)', 'property/fuzz/benchmark tools (OSR-38)'],
  sdkTypeGeneration: { implementation: 'ts-rs', version: '12.0.1', scope: 'Optional native-only build generation; absent from default normal/WASM runtime closure' },
};
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/dependencies.json', JSON.stringify(report, null, 2) + '\n');
console.log(`Architecture closure verified; ${report.rust.length} Rust packages, ${report.npm.length} npm entries; versions/licenses/MSRV/targets/sizes in artifacts/dependencies.json`);
