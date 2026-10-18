// SPDX-License-Identifier: MIT OR Apache-2.0
// Explicit producer. Importing does not build or capture anything.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { canonical, digest, seal } from './perf-compare.mjs';

export const hashFile = path => createHash('sha256').update(readFileSync(path)).digest('hex');
export const fileRecord = path => ({ path: resolve(path), bytes: readFileSync(path).length, sha256: hashFile(path) });
export function walk(root) {
  return readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en')).flatMap(entry => {
    const path = resolve(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`symlink source: ${path}`);
    return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
  });
}
export function productionHashes(root) {
  const paths = ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml'];
  for (const crate of readdirSync(resolve(root, 'crates')).sort()) {
    const base = resolve(root, 'crates', crate);
    if (existsSync(`${base}/Cargo.toml`)) paths.push(relative(root, `${base}/Cargo.toml`));
    if (existsSync(`${base}/src`)) paths.push(...walk(`${base}/src`).filter(path => /\.(rs|json)$/.test(path)).map(path => relative(root, path)));
  }
  return Object.fromEntries(paths.sort().map(path => [path, hashFile(resolve(root, path))]));
}
export function harnessHashes(root) {
  const paths = [...walk(resolve(root, 'scripts/reliability')).filter(path => /\/perf-.*\.mjs$/.test(path)),
    ...walk(resolve(root, 'tests/fixtures/reliability-native/src')), ...embeddedAssetPaths(root),resolve(root, 'tests/fixtures/reliability-native/Cargo.toml'), resolve(root, 'tests/fixtures/reliability-native/Cargo.lock')];
  return Object.fromEntries([...new Set(paths)].sort().map(path => [relative(root, path), hashFile(path)]));
}
export function embeddedAssetPaths(root){
  const assets=new Set();
  for(const source of walk(resolve(root,'tests/fixtures/reliability-native/src')).filter(path=>path.endsWith('.rs'))){
    const text=readFileSync(source,'utf8'),matches=[...text.matchAll(/include_(?:bytes|str)!\(\s*"([^"\\]+)"\s*\)/g)];
    assert.equal(matches.length,[...text.matchAll(/include_(?:bytes|str)!\s*\(/g)].length,`unsupported nonliteral embedded asset ${source}`);
    for(const match of matches){const path=resolve(dirname(source),match[1]),local=relative(root,path);assert.ok(!local.startsWith('../')&&!local.startsWith('/'),'embedded asset outside source root');assert.ok(existsSync(path),`missing embedded asset ${path}`);assets.add(path);}
  }
  return [...assets].sort();
}
export function stageNativeHarness({sourceRoot,harnessRoot,stagingRoot}){
  const crate=resolve(stagingRoot,'tests/fixtures/reliability-native');assert.ok(!existsSync(stagingRoot),'never overwrite staged producer');mkdirSync(crate,{recursive:true});
  cpSync(resolve(harnessRoot,'tests/fixtures/reliability-native/src'),`${crate}/src`,{recursive:true});
  const assets=embeddedAssetPaths(harnessRoot);
  for(const asset of assets){const destination=resolve(stagingRoot,relative(harnessRoot,asset));mkdirSync(dirname(destination),{recursive:true});cpSync(asset,destination);assert.equal(hashFile(destination),hashFile(asset));}
  const manifest=readFileSync(resolve(harnessRoot,'tests/fixtures/reliability-native/Cargo.toml'),'utf8').replaceAll('path = "../../../crates/',`path = "${resolve(sourceRoot)}/crates/`);
  writeFileSync(`${crate}/Cargo.toml`,manifest);cpSync(resolve(harnessRoot,'tests/fixtures/reliability-native/Cargo.lock'),`${crate}/Cargo.lock`);
  return {crate,assets:Object.fromEntries(assets.map(path=>[relative(harnessRoot,path),hashFile(path)])),manifest:fileRecord(`${crate}/Cargo.toml`)};
}
function command(program, args, { cwd, output, env }) {
  const result = spawnSync(program, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(`${output}.stdout`, result.stdout ?? ''); writeFileSync(`${output}.stderr`, result.stderr ?? '');
  const receipt = { program, args, cwd, status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: fileRecord(`${output}.stdout`), stderr: fileRecord(`${output}.stderr`) };
  writeFileSync(`${output}.json`, JSON.stringify(receipt, null, 2) + '\n'); assert.equal(result.status, 0, `command failed: ${output}.json`); return receipt;
}
export function buildNative({ sourceRoot, harnessRoot, outputRoot, sourceCommit, gitRepository = sourceRoot }) {
  sourceRoot = resolve(sourceRoot); harnessRoot = resolve(harnessRoot); outputRoot = resolve(outputRoot);
  assert.ok(/^[a-f0-9]{40}$/.test(sourceCommit), 'explicit actual commit required');
  const sourceHashes = productionHashes(sourceRoot), harness = harnessHashes(harnessRoot);
  for (const [path, hash] of Object.entries(sourceHashes)) {
    const blob = spawnSync('git', ['show', `${sourceCommit}:${path}`], { cwd: gitRepository, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(blob.status, 0, `source blob ${path}`); assert.equal(createHash('sha256').update(blob.stdout).digest('hex'), hash, `uncommitted production path ${path}`);
  }
  const staged=stageNativeHarness({sourceRoot,harnessRoot,stagingRoot:`${outputRoot}/harness`}),staging=staged.crate,target=`${outputRoot}/target`;
  const version = command('rustc', ['+1.97.1', '-vV'], { cwd: staging, output: `${outputRoot}/rustc`, env: {} });
  const host = readFileSync(version.stdout.path, 'utf8').match(/^host: (.+)$/m)?.[1]; assert.ok(host);
  const commands = [command('cargo', ['+1.97.1', 'fetch', '--locked', '--target', host], { cwd: staging, output: `${outputRoot}/fetch`, env: {} })];
  for (const [binary, features] of [['native-benchmark', []], ['native-allocator', ['--features', 'allocator-profile']]]) {
    commands.push(command('cargo', ['+1.97.1', 'build', '--release', '--locked', '--offline', '--target-dir', target, '--bin', binary, ...features], { cwd: staging, output: `${outputRoot}/${binary}-build`, env: {} }));
    cpSync(`${target}/release/${binary}`, `${outputRoot}/${binary}`);
  }
  assert.equal(hashFile(`${staging}/Cargo.lock`), hashFile(`${harnessRoot}/tests/fixtures/reliability-native/Cargo.lock`), 'locked fetch/build must not modify lock');
  assert.equal(canonical(productionHashes(sourceRoot)), canonical(sourceHashes), 'production changed during build'); assert.equal(canonical(harnessHashes(harnessRoot)), canonical(harness), 'harness changed during build');
  const record = seal({ format: 'editor-reliability-native-build/1', sourceRoot, sourceCommit, sourceHashes, productionDigest: digest(sourceHashes), harnessHashes: harness, harness: digest(harness), host, toolchain: readFileSync(version.stdout.path, 'utf8'),
    flags: ['--release', '--locked', '--offline', 'lto=true', 'codegen-units=1', 'opt-level=s'],staged, commands,
    benchmark: fileRecord(`${outputRoot}/native-benchmark`), allocator: fileRecord(`${outputRoot}/native-allocator`) });
  writeFileSync(`${outputRoot}/build.json`, JSON.stringify(record, null, 2) + '\n'); return record;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(readFileSync(process.argv[2], 'utf8')); console.log(JSON.stringify(buildNative(config), null, 2));
}
