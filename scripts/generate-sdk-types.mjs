import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const typePath = resolve(root, 'packages/wasm/src/sdk-types.ts');
const v2TypePath = resolve(root, 'packages/wasm/src/sdk-types-v2.ts');
const identityPath = resolve(root, 'packages/wasm/src/sdk-build-id.ts');
const excluded = new Set(['packages/wasm/src/sdk-types.ts', 'packages/wasm/src/sdk-types-v2.ts', 'packages/wasm/src/sdk-build-id.ts']);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Hash actual production inputs, including dirty/untracked source bytes. No Git/mtime identity. */
export function computeSdkBuildIdentity() {
  const paths = new Set();
  const add = path => {
    const full = resolve(root, path);
    if (!existsSync(full)) throw new Error(`Missing SDK identity input: ${path}`);
    if (lstatSync(full).isSymbolicLink()) throw new Error(`SDK identity input is a symlink: ${path}`);
    paths.add(path);
  };
  const walk = (path, extension) => {
    const full = resolve(root, path);
    for (const entry of readdirSync(full, { withFileTypes: true })) {
      const child = `${path}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`SDK source symlink: ${child}`);
      if (entry.isDirectory()) walk(child, extension);
      else if (entry.isFile() && extension.test(entry.name) && !excluded.has(child)) add(child);
    }
  };
  for (const path of ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'package.json', 'package-lock.json',
    'package-map.json', 'tsconfig.base.json', 'tsconfig.json', 'scripts/generate-sdk-types.mjs',
    'scripts/build-workspace.mjs', 'scripts/generate-dom-inventory.mjs', 'scripts/build-extensions-consumers.mjs', 'scripts/dependency-notices.mjs', 'scripts/package-identity.mjs', 'scripts/seal-sdk-wasm.mjs', 'scripts/sdk-distribution.mjs',
    'provenance/licenses/ts-rs-12.0.1-MIT.txt', 'provenance/licenses/sdk-generator-license-sources.json']) add(path);
  // Every workspace library contributes, including original extension modules
  // and semantic JSON registrations. A new crate cannot escape build identity
  // merely because a four-package bootstrap list predates it.
  for (const entry of readdirSync(resolve(root, 'crates'), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`SDK crate symlink: ${entry.name}`);
    if (!entry.isDirectory()) continue;
    add(`crates/${entry.name}/Cargo.toml`);
    walk(`crates/${entry.name}/src`, /\.(?:rs|json)$/);
  }
  add('crates/wasm/examples/dom_inventory.rs');
  add('examples/notes-extension/d0.json');
  add('examples/notes-extension/dom-inventory.mjs');
  add('crates/wasm/examples/sdk_types.rs');
  add('crates/wasm/examples/sdk_types_v2.rs');
  add('crates/wasm/examples/sdk_manifest.rs');
  add('crates/wasm/examples/sdk_manifest_v2.rs');
  for (const name of ['wasm', 'sdk', 'dom', 'kwdj']) {
    add(`packages/${name}/package.json`); add(`packages/${name}/tsconfig.json`);
    walk(`packages/${name}/src`, /\.(?:ts|js|css)$/);
  }
  const sourceHashes = {};
  const hash = createHash('sha256').update('klenwriter-editor-sdk-source/1\0');
  for (const path of [...paths].sort()) {
    const bytes = readFileSync(resolve(root, path));
    sourceHashes[path] = digest(bytes);
    hash.update(`${path}\0${bytes.byteLength}\0`).update(bytes);
  }
  return { buildId: `sha256:${hash.digest('hex')}`, sourceHashes };
}

/** Ignored source constant and evidence are outputs, explicitly excluded from their own closure. */
export function writeSdkBuildIdentity(identity = computeSdkBuildIdentity()) {
  const output = `// Generated from actual production source bytes; do not edit.\nexport const sdkBuildId = ${JSON.stringify(identity.buildId)} as const;\n`;
  writeFileSync(identityPath, output);
  mkdirSync(resolve(root, 'artifacts'), { recursive: true });
  writeFileSync(resolve(root, 'artifacts/sdk-build-identity.json'), JSON.stringify({
    format: 'klenwriter-editor-sdk-build/1', ...identity,
    exclusions: [...excluded],
    scope: 'Production Rust, wrapper/profile TS, locked metadata and build/generator inputs. Generated outputs/artifacts/provenance excluded to avoid a file hash cycle.',
  }, null, 2) + '\n');
  return identity;
}

/** Actual native generation graph plus target runtime exclusion, not an inferred lockfile inventory. */
export function writeSdkGeneratorInventory() {
  const run = args => {
    const result = spawnSync('cargo', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`SDK generator metadata command failed: ${result.stderr}`);
    return result.stdout;
  };
  const metadata = JSON.parse(run(['metadata', '--all-features', '--locked', '--format-version=1']));
  const packages = new Map(metadata.packages.map(value => [value.id, value]));
  const nodes = new Map(metadata.resolve.nodes.map(value => [value.id, value]));
  const generator = metadata.packages.find(value => value.name === 'ts-rs' && value.version === '12.0.1');
  if (!generator || generator.license !== 'MIT') throw new Error('Pinned native ts-rs license/version differs');
  const visited = new Set();
  const visit = id => { if (visited.has(id)) return; visited.add(id); for (const dep of nodes.get(id).deps) visit(dep.pkg); };
  visit(generator.id);
  const dependencies = [...visited].map(id => {
    const value = packages.get(id);
    return { name: value.name, version: value.version, license: value.license, source: value.source };
  }).sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
  if (dependencies.some(value => !value.license)) throw new Error('Generator dependency without declared license');
  const runtimeTree = run(['tree', '--locked', '-p', 'klenwriter-editor-wasm', '--target',
    'wasm32-unknown-unknown', '--all-features', '-e', 'normal', '--prefix', 'none']);
  if (/^(?:ts-rs|ts-rs-macros|termcolor) v/m.test(runtimeTree)) throw new Error('Native generator entered the WASM runtime graph');
  mkdirSync(resolve(root, 'artifacts'), { recursive: true });
  writeFileSync(resolve(root, 'artifacts/sdk-generator-dependencies.json'), JSON.stringify({
    format: 'klenwriter-editor-sdk-generator-dependencies/1', generator: 'ts-rs@12.0.1',
    scope: 'Optional native-only generation feature. Full locked dependency licenses are bundled conservatively; these are not WASM runtime dependencies.',
    dependencies, wasmRuntimeGraph: runtimeTree, wasmRuntimeGraphSha256: digest(runtimeTree),
    generatorExcludedFromWasmRuntime: true,
  }, null, 2) + '\n');
  return { dependencyCount: dependencies.length, generatorExcludedFromWasmRuntime: true };
}

export function generateSdkTypes({ check = false, locked = true } = {}) {
  const identity = computeSdkBuildIdentity();
  const result = spawnSync('cargo', ['run', ...(locked ? ['--locked'] : []), '--quiet',
    '-p', 'klenwriter-editor-wasm', '--features', 'sdk-types', '--example', 'sdk_types'], {
    cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, KLENWRITER_EDITOR_SDK_BUILD_ID: identity.buildId },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Native SDK type generation failed (${result.status}):\n${result.stderr}`);
  if (result.stderr) process.stderr.write(result.stderr);
  const generated = result.stdout.replaceAll('\r\n', '\n');
  // wasm::sdk_wire remains the compatibility reexport. Definitions now live
  // in the profile-free protocol and optional KWDJ adapter; BridgeRequest is
  // the additive native common dispatcher, outside the exact legacy36 DTOs.
  const wire = ['crates/protocol/src/lib.rs', 'crates/kwdj-sdk/src/wire.rs']
    .map(path => readFileSync(resolve(root, path), 'utf8')).join('\n');
  const nativeNames = [...wire.matchAll(/^pub (?:struct|enum) (\w+)/gm)]
    .map(match => match[1]).filter(name => name !== 'BridgeRequest').sort();
  if (new Set(nativeNames).size !== nativeNames.length) throw new Error('Duplicate authoritative legacy DTO name');
  const exportedNames = [...generated.matchAll(/^export type (\w+)/gm)].map(match => match[1]).sort();
  if (JSON.stringify(nativeNames) !== JSON.stringify(exportedNames)) throw new Error('Native SDK generator must enumerate every authoritative wire DTO exactly once');
  if (check) {
    if (!existsSync(typePath) || readFileSync(typePath, 'utf8') !== generated) throw new Error('Generated sdk-types.ts differs; run node scripts/generate-sdk-types.mjs');
  } else writeFileSync(typePath, generated);
  const v2Result = spawnSync('cargo', ['run', ...(locked ? ['--locked'] : []), '--quiet',
    '-p', 'klenwriter-editor-wasm', '--features', 'sdk-types', '--example', 'sdk_types_v2'], {
    cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, KLENWRITER_EDITOR_SDK_BUILD_ID: identity.buildId },
  });
  if (v2Result.error) throw v2Result.error;
  if (v2Result.status !== 0) throw new Error(`Native SDK V2 type generation failed (${v2Result.status}):\n${v2Result.stderr}`);
  if (v2Result.stderr) process.stderr.write(v2Result.stderr);
  const v2Generated = v2Result.stdout.replaceAll('\r\n', '\n');
  const v2Names = [...readFileSync(resolve(root, 'crates/protocol/src/v2.rs'), 'utf8')
    .matchAll(/^pub (?:struct|enum) (\w+)/gm)].map(match => match[1]).concat('BridgeRequest').sort();
  const v2Exported = [...v2Generated.matchAll(/^export type (\w+)/gm)].map(match => match[1]).sort();
  if (new Set(v2Names).size !== v2Names.length || JSON.stringify(v2Names) !== JSON.stringify(v2Exported)) {
    throw new Error('Native SDK V2 generator must enumerate every additive wire DTO exactly once');
  }
  if (check) {
    if (!existsSync(v2TypePath) || readFileSync(v2TypePath, 'utf8') !== v2Generated) throw new Error('Generated sdk-types-v2.ts differs; run node scripts/generate-sdk-types.mjs');
  } else writeFileSync(v2TypePath, v2Generated);
  return { declarations: nativeNames.length, path: relative(root, typePath).split(sep).join('/'), buildId: identity.buildId,
    v2: { declarations: v2Names.length, path: relative(root, v2TypePath).split(sep).join('/') } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--check', '--resolve-lock'].includes(arg))) throw new Error('Usage: node scripts/generate-sdk-types.mjs [--check] [--resolve-lock]');
  console.log(JSON.stringify(generateSdkTypes({ check: args.includes('--check'), locked: !args.includes('--resolve-lock') })));
}
