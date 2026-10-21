// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { builtinModules } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build, version as esbuildVersion } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const producer = 'scripts/build-clipboard-parser.mjs';
const entry = 'packages/kwdj/src/clipboard-parser.ts';
const output = 'packages/kwdj/dist/clipboard-parser.js';
const metafilePath = 'packages/kwdj/dist/clipboard-parser.meta.json';
export const clipboardParserManifestPath = 'packages/kwdj/dist/clipboard-parser.manifest.json';
const versions = Object.freeze({ parse5: '8.0.1', entities: '8.1.0', esbuild: '0.28.2' });
const dependencies = Object.freeze([
  { name: 'parse5', license: 'MIT', notice: 'packages/kwdj/dist/clipboard-parser.LICENSE.parse5.txt' },
  { name: 'entities', license: 'BSD-2-Clause', notice: 'packages/kwdj/dist/clipboard-parser.LICENSE.entities.txt' },
]);
const settings = Object.freeze({ platform: 'browser', format: 'esm', target: 'es2022', bundle: true,
  minify: false, treeShaking: true, sourcemap: 'external', sourcesContent: true, legalComments: 'inline',
  charset: 'utf8', packages: 'bundle' });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const pathOf = value => {
  const path = relative(root, resolve(root, value)).split(sep).join('/');
  assert(path && !path.startsWith('../') && !path.startsWith('/'), `Outside parser graph: ${value}`);
  return path;
};
function record(path, bytes = readFileSync(resolve(root, path))) {
  const compressed = gzipSync(bytes, { mtime: 0 });
  return { path, bytes: bytes.length, sha256: sha(bytes), gzipBytes: compressed.length, gzipSha256: sha(compressed) };
}
function assertCurrent(row) { assert.deepEqual(record(row.path), row, `Parser input/artifact differs: ${row.path}`); }
function readJson(path) { return JSON.parse(readFileSync(resolve(root, path), 'utf8')); }
function packageFacts() {
  const lock = readJson('package-lock.json');
  const workspace = readJson('package.json');
  const kwdj = readJson('packages/kwdj/package.json');
  assert.equal(workspace.devDependencies.esbuild, versions.esbuild);
  assert.equal(kwdj.dependencies.parse5, versions.parse5);
  assert.equal(esbuildVersion, versions.esbuild);
  const runtime = dependencies.map(({ name, license, notice }) => {
    const packagePath = `node_modules/${name}/package.json`;
    const installed = readJson(packagePath), locked = lock.packages[`node_modules/${name}`];
    assert.equal(installed.name, name); assert.equal(installed.version, versions[name]);
    assert.equal(installed.license, license); assert.equal(locked.version, versions[name]);
    assert.equal(locked.license, license); assert.equal(locked.dev ?? false, false);
    assert.equal(locked.resolved, `https://registry.npmjs.org/${name}/-/${name}-${versions[name]}.tgz`);
    assert.match(locked.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/);
    assert.deepEqual(installed.dependencies ?? {}, name === 'parse5' ? { entities: '^8.0.0' } : {});
    assert.deepEqual(locked.dependencies ?? {}, installed.dependencies ?? {});
    return { name, version: installed.version, license, resolved: locked.resolved,
      integrity: locked.integrity, integritySource: 'package-lock.json archive integrity; not a recomputed installed-directory SRI',
      dependencies: installed.dependencies ?? {}, package: record(packagePath),
      originalLicense: record(`node_modules/${name}/LICENSE`), notice };
  });
  const tool = lock.packages['node_modules/esbuild'];
  assert.equal(tool.version, versions.esbuild); assert.equal(tool.dev, true);
  return { runtime, buildTool: { name: 'esbuild', version: esbuildVersion, license: tool.license,
    role: 'build-only; absent from parser runtime graph', resolved: tool.resolved, integrity: tool.integrity,
    package: record('node_modules/esbuild/package.json') },
    staticScanner: { name: 'closed-source-patterns/1', role: 'build/check-only conservative text rejection',
      qualification: 'Rejects literal eval/Function tokens, including comments/strings; not an AST or exhaustive alias/escape analysis' } };
}

/** Conservative source patterns, not an AST or general JS security proof. */
function inspectCode(path, bytes) {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assert(!/\b(?:eval|Function)\b/u.test(source), `Dynamic evaluation token in parser graph: ${path}`);
}
function allowedInput(path) {
  return path === entry || path.startsWith('node_modules/parse5/dist/') || path.startsWith('node_modules/entities/dist/');
}
function inspectGraph(meta, inputRecords) {
  const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
  const inputs = Object.keys(meta.inputs).map(pathOf).sort();
  assert.deepEqual(inputs, inputRecords.map(row => row.path).sort(), 'Metafile inputs must equal actual loaded/pinned inputs');
  assert(inputs.includes(entry));
  for (const name of ['parse5', 'entities']) assert(inputs.some(path => path.startsWith(`node_modules/${name}/dist/`)));
  for (const [path, item] of Object.entries(meta.inputs)) {
    assert(allowedInput(pathOf(path)), `Undeclared parser runtime input: ${path}`);
    for (const imported of item.imports) {
      assert(!imported.external, `External parser dependency: ${imported.path}`);
      assert(!builtins.has(imported.path) && !imported.path.startsWith('node:'), `Node builtin in parser graph: ${imported.path}`);
      assert.notEqual(imported.kind, 'dynamic-import', `Unexpected parser dynamic import: ${imported.path}`);
      assert(allowedInput(pathOf(imported.path)), `Undeclared parser import: ${imported.path}`);
    }
  }
  const outputs = Object.keys(meta.outputs).map(pathOf).sort();
  assert.deepEqual(outputs, [output, `${output}.map`].sort());
  const js = Object.entries(meta.outputs).find(([path]) => pathOf(path) === output)[1];
  assert.equal(pathOf(js.entryPoint), entry);
  assert.deepEqual(js.imports, [], 'Delivered parser must be self-contained ESM');
  assert.deepEqual([...js.exports].sort(), ['clipboardParserLimits', 'parseClipboardHtml']);
  return { inputCount: inputs.length, outputCount: outputs.length,
    runtimePackages: ['parse5', 'entities'], externalImports: 0, nodeBuiltinImports: 0, dynamicImports: 0,
    evaluationSyntax: 'No literal eval/Function token in graph input/delivered source; esbuild direct-eval warnings are build errors',
    qualification: 'Closed graph and conservative source patterns; not an AST, exhaustive alias/escape analysis, semantic security, no-fetch, browser execution or parser conformance proof' };
}

/** Bundle construction only: never invokes parseClipboardHtml or browser APIs. */
export async function buildClipboardParser() {
  const facts = packageFacts();
  const sources = [producer, 'docs/adr/006-clipboard-parser-boundary.md', 'package.json',
    'package-lock.json', 'packages/kwdj/package.json'].map(path => record(path));
  const loaded = new Map();
  const result = await build({ absWorkingDir: root, entryPoints: [entry], outfile: output,
    ...settings, metafile: true, write: false, logLevel: 'silent',
    logOverride: { 'direct-eval': 'error' },
    plugins: [{ name: 'pin-clipboard-parser-inputs', setup(builder) {
      builder.onLoad({ filter: /\.[cm]?[jt]s$/ }, args => {
        assert.equal(args.namespace, 'file');
        const path = pathOf(args.path); assert(allowedInput(path), `Undeclared parser input: ${path}`);
        const bytes = readFileSync(args.path); inspectCode(path, bytes);
        const row = record(path, bytes); assert(!loaded.has(path) || loaded.get(path).sha256 === row.sha256);
        loaded.set(path, row);
        return { contents: bytes, loader: path.endsWith('.ts') ? 'ts' : 'js', resolveDir: dirname(args.path) };
      });
    } }],
  });
  assert.deepEqual(result.errors, []); assert.deepEqual(result.warnings, []);
  const inputs = [...loaded.values()].sort((a, b) => a.path.localeCompare(b.path));
  const graph = inspectGraph(result.metafile, inputs);
  const outputs = new Map(result.outputFiles.map(file => [pathOf(file.path), Buffer.from(file.contents)]));
  assert.deepEqual([...outputs.keys()].sort(), [output, `${output}.map`].sort());
  inspectCode(output, outputs.get(output));
  outputs.set(metafilePath, Buffer.from(json(result.metafile)));
  for (const dependency of facts.runtime) outputs.set(dependency.notice, readFileSync(resolve(root, dependency.originalLicense.path)));
  const noticePath = 'packages/kwdj/dist/clipboard-parser.NOTICE.txt';
  const notices = ['Clipboard parser dependency notices', 'Bundled runtime: parse5 8.0.1 (MIT), entities 8.1.0 (BSD-2-Clause).',
    'Original license texts follow without alteration. esbuild is build-only, not bundled runtime.', '',
    ...facts.runtime.flatMap(dep => [`=== ${dep.name} ${dep.version} — ${dep.license} ===`,
      readFileSync(resolve(root, dep.originalLicense.path), 'utf8'), ''])].join('\n');
  outputs.set(noticePath, Buffer.from(notices));
  for (const row of [...sources, ...inputs, ...facts.runtime.flatMap(dep => [dep.package, dep.originalLicense]),
    facts.buildTool.package]) assertCurrent(row);
  const artifacts = [...outputs].map(([path, bytes]) => record(path, bytes)).sort((a, b) => a.path.localeCompare(b.path));
  const manifest = { format: 'klenwriter-clipboard-parser-build/1', scope: 'BUILD_GRAPH_ONLY_NOT_PARSER_OR_BROWSER_ACCEPTANCE',
    producer: sources[0], entry, settings, buildTool: facts.buildTool, staticScanner: facts.staticScanner,
    compression: { implementation: 'node:zlib.gzipSync', node: process.version, zlib: process.versions.zlib,
      mtime: 0, qualification: 'Separately compressed file bytes; not a transfer/latency budget' },
    runtimePackages: facts.runtime, sources, inputs, graph, artifacts,
    sizes: { rawJsBytes: outputs.get(output).length, gzipJsBytes: gzipSync(outputs.get(output), { mtime: 0 }).length },
    browserNoFetchProof: 'NOT_RUN', parserSemanticsProof: 'NOT_RUN' };
  for (const [path, bytes] of outputs) { mkdirSync(dirname(resolve(root, path)), { recursive: true }); writeFileSync(resolve(root, path), bytes); }
  writeFileSync(resolve(root, clipboardParserManifestPath), json(manifest));
  return verifyClipboardParserBuild();
}

/** Checks existing build/source bytes; does not rebuild or execute parser code. */
export function verifyClipboardParserBuild() {
  const manifest = readJson(clipboardParserManifestPath), facts = packageFacts();
  assert.equal(manifest.format, 'klenwriter-clipboard-parser-build/1');
  assert.equal(manifest.scope, 'BUILD_GRAPH_ONLY_NOT_PARSER_OR_BROWSER_ACCEPTANCE');
  assert.equal(manifest.entry, entry); assert.deepEqual(manifest.settings, settings);
  assert.deepEqual(manifest.runtimePackages, facts.runtime);
  assert.deepEqual(manifest.buildTool, facts.buildTool); assert.deepEqual(manifest.staticScanner, facts.staticScanner);
  assert.deepEqual(manifest.compression, { implementation: 'node:zlib.gzipSync', node: process.version, zlib: process.versions.zlib,
    mtime: 0, qualification: 'Separately compressed file bytes; not a transfer/latency budget' });
  assert.deepEqual(manifest.producer, record(producer));
  assert.deepEqual(manifest.sources.map(row => row.path), [producer, 'docs/adr/006-clipboard-parser-boundary.md',
    'package.json', 'package-lock.json', 'packages/kwdj/package.json']);
  assert.deepEqual(manifest.artifacts.map(row => row.path).sort(), [output, `${output}.map`, metafilePath,
    ...dependencies.map(dep => dep.notice), 'packages/kwdj/dist/clipboard-parser.NOTICE.txt'].sort());
  for (const row of [...manifest.sources, ...manifest.inputs, ...manifest.artifacts]) assertCurrent(row);
  for (const row of manifest.inputs) inspectCode(row.path, readFileSync(resolve(root, row.path)));
  inspectCode(output, readFileSync(resolve(root, output)));
  const graph = inspectGraph(readJson(metafilePath), manifest.inputs); assert.deepEqual(manifest.graph, graph);
  for (const dep of facts.runtime) assert.deepEqual(readFileSync(resolve(root, dep.notice)), readFileSync(resolve(root, dep.originalLicense.path)));
  const bytes = readFileSync(resolve(root, output));
  assert.deepEqual(manifest.sizes, { rawJsBytes: bytes.length, gzipJsBytes: gzipSync(bytes, { mtime: 0 }).length });
  assert.equal(manifest.browserNoFetchProof, 'NOT_RUN'); assert.equal(manifest.parserSemanticsProof, 'NOT_RUN');
  return manifest;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const manifest = await buildClipboardParser();
  console.log(`Clipboard parser build-only: ${manifest.inputs.length} pinned graph inputs, ${manifest.sizes.rawJsBytes} JS bytes, ${manifest.sizes.gzipJsBytes} gzip bytes; browser/semantics NOT_RUN`);
}
