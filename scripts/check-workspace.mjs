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
const packageByName = new Map(metadata.packages.map(pkg => [pkg.name, pkg]));
// Dev-only consumer tests may use the engine; they do not become profile runtime dependencies.
function normalDependencies(id) {
  return resolved.get(id).deps.filter(dep => dep.dep_kinds.some(kind => kind.kind === null));
}
function normalClosure(name) {
  const pkg = packageByName.get(name);
  assert(pkg, `Missing workspace package ${name}`);
  const closure = new Set();
  function visit(id) {
    if (closure.has(id)) return;
    closure.add(id);
    for (const dep of normalDependencies(id)) visit(dep.pkg);
  }
  visit(pkg.id);
  return [...closure].map(id => byId.get(id));
}
const genericRoles = ['core', 'engine', 'registry', 'extensions', 'protocol', 'bridge'];
const hostlessRoles = [...genericRoles, 'kwdj', 'notes'];
// Enforce the architectural boundary on the entire normal closure, including target-specific edges.
for (const role of hostlessRoles) {
  const name = identity.rust[role].name;
  const closure = normalClosure(name);
  for (const dep of closure) {
    assert(!/^(wasm-bindgen|js-sys|web-sys|sqlx|tokio|klenwriter-editor-wasm)/.test(dep.name), `${name} imports host/runtime ${dep.name}`);
    if (genericRoles.includes(role)) assert(!/^klenwriter-editor-(kwdj|notes)(?:-sdk)?$/.test(dep.name),
      `${name} imports concrete profile ${dep.name}`);
    if (['kwdj', 'notes', 'registry', 'extensions', 'protocol'].includes(role)) {
      assert.notEqual(dep.name, identity.rust.engine.name, `${name} imports engine through a normal dependency`);
    }
    if (role === 'core') assert(!/^klenwriter-editor-/.test(dep.name) || dep.name === name,
      `Generic core imports sibling ${dep.name}`);
    if (role === 'kwdj') assert(!/^klenwriter-editor-notes(?:-sdk)?$/.test(dep.name));
    if (role === 'notes') assert(!/^klenwriter-editor-kwdj(?:-sdk)?$/.test(dep.name));
  }
}
const msrvRoles = ['core', 'kwdj', 'registry', 'extensions', 'protocol', 'notes'];
function rustVersion(version) {
  const parts = version.split('.').map(Number);
  assert(parts.every(Number.isSafeInteger), `Invalid Rust MSRV ${version}`);
  return [parts[0], parts[1] ?? 0, parts[2] ?? 0];
}
function aboveMsrv(version) {
  const ceiling = [1, 89, 0];
  const parts = rustVersion(version);
  for (let i = 0; i < ceiling.length; i++) {
    if (parts[i] !== ceiling[i]) return parts[i] > ceiling[i];
  }
  return false;
}
for (const role of msrvRoles) {
  const name = identity.rust[role].name;
  assert.equal(packageByName.get(name).rust_version, '1.89.0', `${name}: public native MSRV`);
  const closure = normalClosure(name);
  for (const id of closure) {
    if (id.rust_version) assert(!aboveMsrv(id.rust_version),
      `${name}: normal dependency ${id.name} declares Rust ${id.rust_version}, above 1.89.0`);
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
// ADR-005: optional concrete-profile DOM subpath; no generic package imports it.
const packageGraph = { wasm: [], sdk: ['wasm'], dom: ['sdk'], kwdj: ['sdk', 'dom'], vanilla: ['dom'], angular: ['vanilla'] };
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
    dependencies: resolved.get(pkg.id).deps.map(dep => byId.get(dep.pkg).name),
    normalDependencies: normalDependencies(pkg.id).map(dep => byId.get(dep.pkg).name) })).sort((a,b) => a.name.localeCompare(b.name)),
  normalArchitecture: { genericRoles, hostlessRoles, msrvRoles,
    declaredMsrvCeiling: '1.89.0', scope: 'Normal dep_kinds only, all resolved targets; actual compiler checks are separate',
    closures: Object.fromEntries(hostlessRoles.map(role => [role,
      normalClosure(identity.rust[role].name).map(pkg => pkg.name).sort()])) },
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
