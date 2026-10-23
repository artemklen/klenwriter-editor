// SPDX-License-Identifier: MIT OR Apache-2.0
// Closed-data join only. Never starts a test, build, browser, native process or review.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compiledAdmissionTitle, existingSourceFiles, localCaseIds, nodeResourceCases, rustResourceCases } from './existing-resource-cases.mjs';
import { captureResourceBuildBinding } from './resource-reporter.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const currentHash = path => sha(readFileSync(path));
const dataFile = path => { const bytes = readFileSync(path); return { path: resolve(path), bytes: bytes.length, sha256: sha(bytes) }; };
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function walkSpecs(suites, found = []) {
  for (const suite of suites ?? []) { found.push(...(suite.specs ?? [])); walkSpecs(suite.suites, found); }
  return found;
}

export function collectResourceEvidence(inputs) {
  assert.equal(inputs.format, 'editor-failure-states/resource-inputs/1');
  const bindings = [], gaps = [], observations = [];
  const bind = path => { const value = dataFile(path); bindings.push(value); return value; };
  const check = (condition, description) => { if (!condition) gaps.push(description); return condition; };
  const closedFile = (seal, description, expectedPath = null) => {
    const valid = check(seal !== null && typeof seal === 'object' && !Array.isArray(seal)
      && typeof seal.path === 'string' && seal.path.length > 0 && Number.isSafeInteger(seal.bytes) && seal.bytes >= 0
      && typeof seal.sha256 === 'string' && /^[a-f0-9]{64}$/.test(seal.sha256), `Closed file seal shape: ${description}`);
    if (!valid) return null;
    if (expectedPath !== null && !check(typeof expectedPath === 'string' && resolve(seal.path) === resolve(expectedPath), `Closed file seal path: ${description}`)) return null;
    let bytes;
    try { bytes = readFileSync(seal.path); }
    catch (error) { check(false, `Closed file unavailable: ${description} (${error.code ?? error.message})`); return null; }
    const binding = { path: resolve(seal.path), bytes: bytes.length, sha256: sha(bytes) };
    bindings.push(binding);
    const coherent = check(binding.bytes === seal.bytes && binding.sha256 === seal.sha256, `Closed file bytes/SHA256: ${description}`);
    return coherent ? { binding, bytes } : null;
  };
  const producer = readJson('artifacts/sdk-build-identity.json');
  const currentBuildBinding = captureResourceBuildBinding();
  const wasmHash = currentHash('packages/wasm/dist/editor_wasm_bg.wasm');
  const sourceHashes = Object.fromEntries([...existingSourceFiles, 'scripts/failure-states/resource-reporter.mjs'].map(path => [path, currentHash(path)]));
  for (const [path, expected] of Object.entries(producer.sourceHashes)) check(currentHash(path) === expected, `Producer source changed: ${path}`);
  const local = readJson(inputs.localReport); bind(inputs.localReport);
  check(local.format === 'editor-failure-states/resource-originals/1', 'Local original report format');
  check(local.buildId === producer.buildId, 'Local source build identity is current');
  check(same(local.producerSourceHashes, producer.sourceHashes), 'Local full producer source closure matches current build');
  check(local.status === 'LOCAL_PASSED_EXISTING_EVIDENCE_REQUIRED', 'All new local cases passed');
  check(local.sourceUnchanged === true && local.artifactsUnchanged === true, 'Local sources/artifacts unchanged');
  check(local.sameActualProductionInstanceCount === 1, 'Exactly one actual production instance observed by the public cases');
  for (const [path, hash] of Object.entries(local.sourceAfter ?? {})) check(currentHash(path) === hash, `Local source no longer current: ${path}`);
  for (const [path, hash] of Object.entries(local.artifactAfter ?? {})) check(currentHash(path) === hash, `Local artifact no longer current: ${path}`);
  for (const id of localCaseIds) {
    const matches = (local.cases ?? []).filter(entry => entry.id === id);
    check(matches.length === 1 && matches[0].status === 'PASSED', `Local case ${id}`);
  }
  check((local.cases ?? []).length === localCaseIds.length, 'Exact frozen local case set');

  const events = [];
  for (const path of inputs.nodeEventFiles ?? []) {
    bind(path);
    const records = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const header = records[0], footer = records.at(-1);
    const closed = check(header?.type === 'header' && footer?.type === 'footer', `Closed Node event stream ${path}`);
    if (!closed) continue;
    const coherent = check(footer.failed === 0 && footer.sourceUnchanged === true && same(header.sourceBefore, sourceHashes) && same(footer.sourceAfter, sourceHashes), `Current unchanged passing Node sources ${path}`);
    const buildCoherent = check(footer.buildUnchanged === true && same(header.buildBefore, currentBuildBinding)
      && same(footer.buildAfter, currentBuildBinding), `Current unchanged production build/artifacts for Node stream ${path}`);
    if (coherent && buildCoherent) events.push(...records.filter(record => record.type === 'test:pass' && !record.skip && !record.todo));
  }
  for (const required of nodeResourceCases) {
    const match = events.find(event => event.file === required.file && (required.name ? event.name === required.name : event.name?.startsWith(required.prefix)));
    check(Boolean(match), `Existing Node case ${required.file}: ${required.name ?? required.prefix}`);
    observations.push({ row: required.row, method: 'existing-source-bound-Node-assertion', required, event: match ?? null, status: match ? 'OBSERVED_PASS' : 'UNOBSERVED' });
  }

  const nativeRuns = [];
  for (const receiptPath of inputs.nativeCommandReceipts ?? []) {
    bind(receiptPath);
    const receipt = readJson(receiptPath);
    const directCargo = Array.isArray(receipt.argv) && receipt.argv[0] === 'cargo' && receipt.argv.includes('test');
    const npmRustGate = Array.isArray(receipt.argv) && same(receipt.argv.slice(0, 2), ['npm', 'run'])
      && ['check', 'check:rust'].includes(receipt.argv[2]) && receipt.sourceHashes?.['package.json'] === currentHash('package.json');
    const closure = check(receipt.closed === true && receipt.exitCode === 0 && (directCargo || npmRustGate), `Actual closed successful native-test command receipt ${receiptPath}`);
    if (!closure) continue;
    const coherent = check(receipt.buildId === producer.buildId && receipt.sourcesUnchanged === true, `Native command source/build binding ${receiptPath}`);
    const sourceMap = receipt.sourceHashes ?? {};
    const sourcesMatch = Object.entries(sourceMap).every(([path, hash]) => currentHash(path) === hash);
    check(sourcesMatch, `Native command source hashes current ${receiptPath}`);
    const stdout = closedFile(receipt.stdout, `Native command stdout ${receiptPath}`);
    const stderr = closedFile(receipt.stderr, `Native command stderr ${receiptPath}`);
    if (coherent && sourcesMatch && stdout && stderr) nativeRuns.push({ receipt: receiptPath, text: stdout.bytes.toString('utf8'), sourceMap });
  }
  for (const required of rustResourceCases) {
    const pattern = new RegExp(`^test (?:[A-Za-z0-9_]+::)*${escapeRegex(required.name)} \\.\\.\\. ok\\s*$`, 'm');
    const match = nativeRuns.find(run => required.sources.every(path => run.sourceMap[path] === currentHash(path)) && pattern.test(run.text));
    check(Boolean(match), `Existing Rust case ${required.name}`);
    observations.push({ row: required.row, method: 'existing-source-bound-native-assertion', required, receipt: match?.receipt ?? null, status: match ? 'OBSERVED_PASS' : 'UNOBSERVED' });
  }

  const codec = readJson(inputs.codecReport); bind(inputs.codecReport);
  check(codec.wasmSha256 === wasmHash, 'DOC-026 codec report used current actual WASM');
  check(codec.summary?.resourceMeasurements === 21 && codec.summary?.nativeWasmComparisons === 180, 'Original DOC-026 recipe count/comparison scope');
  for (const [path, hash] of Object.entries(codec.sourceHashes ?? {})) check(currentHash(path) === hash, `DOC-026 report source current: ${path}`);
  const corpus = readJson('contracts/kwdj/v1/fixtures/mixed.json').fixtures.find(fixture => fixture.id === 'DOC-026');
  assert(corpus);
  let points = 0;
  for (const literal of corpus.cases) for (const point of literal.input.value.boundary_points) {
    const id = `DOC-026/${literal.name}/${point.position}`, expected = point.position === 'over_limit' ? 'refused' : 'accepted';
    const matches = codec.observations.filter(value => value.id === id && value.operation === 'normalize');
    const valid = matches.length === 1 && matches[0].status === expected && (expected === 'accepted' || (
      matches[0].diagnostic.code === 'kwdj.resource_limit_exceeded' && matches[0].diagnostic.limit === literal.input.value.limit_name
      && matches[0].diagnostic.maximum === String(literal.input.value.limit_value) && matches[0].diagnostic.observed === String(point.measured_value)));
    check(valid, `DOC-026 original literal ${id}`); points++;
    observations.push({ row: 'A4-03', method: 'original-native-and-compiled-codec-comparison', id, expected, actual: matches[0] ?? null, status: valid ? 'OBSERVED_PASS' : 'UNOBSERVED' });
  }
  check(points === 21, 'Exactly21 independent normative recipe points');

  const compiledBinding = inputs.compiledAdmissionBinding;
  const browserPathValid = check(typeof inputs.workspaceBrowserReport === 'string' && inputs.workspaceBrowserReport.length > 0, 'Workspace browser original report path');
  const browserOriginal = browserPathValid ? closedFile(compiledBinding?.report, 'Compiled workspace browser JSON', inputs.workspaceBrowserReport) : null;
  const browser = browserOriginal ? JSON.parse(browserOriginal.bytes.toString('utf8')) : null;
  const specs = walkSpecs(browser?.suites).filter(spec => spec.title === compiledAdmissionTitle);
  for (const project of ['chromium', 'firefox', 'webkit']) {
    const matches = specs.flatMap(spec => spec.tests ?? []).filter(value => value.projectName === project);
    const valid = matches.length === 1 && matches[0].status === 'expected' && matches[0].results?.length === 1 && matches[0].results[0].status === 'passed';
    check(valid, `Original compiled shared nine-case admission witness ${project}`);
    observations.push({ row: 'A4-02/A4-11', method: 'existing-compiled-shared-admission-nine', project, status: valid ? 'OBSERVED_PASS' : 'UNOBSERVED' });
  }
  check(compiledBinding?.closed === true && compiledBinding?.exitCode === 0 && compiledBinding?.buildId === producer.buildId, 'Root actual closure/build binding for workspace compiled admission');
  for (const path of ['tests/workspace-browser.spec.js', 'crates/kwdj/tests/support/admission_budget_cases.rs', 'crates/wasm/examples/admission_budget_probe.rs']) {
    check(compiledBinding?.sourceHashes?.[path] === currentHash(path), `Compiled admission current source ${path}`);
  }
  for (const path of ['artifacts/admission-budget/probe.js', 'artifacts/admission-budget/probe_bg.wasm']) {
    check(compiledBinding?.artifactHashes?.[path] === currentHash(path), `Compiled admission current artifact ${path}`);
  }
  return {
    format: 'editor-failure-states/resource-joined-report/1', status: gaps.length ? 'INCOMPLETE' : 'SELECTED_ASSERTIONS_PASSED',
    buildId: producer.buildId, actualWasmSha256: wasmHash, currentBuildBinding, bindings, currentSourceHashes: sourceHashes, observations, local, gaps,
    qualifications: [
      'A join of closed original assertions and declared observations, not a new test run, formal review or blanket AC/project acceptance.',
      'Optional A4-05/A4-06, default million-value/depth128, global256 sessions and aggregate snapshot32MiB are not claimed dynamically observed.',
      'Tiny host controls, source clamp assertions, actual default boundary observations and host-transferred recovery have distinct scopes.',
      'Only local actual-public-SDK2 cases carry same-instance WASM capacity samples; unavailable/Fatal native counters are not fabricated zero.',
      'Native command and compiled-workspace tool closure are supplied by the root operator; this data collector does not attest process completion.',
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert.equal(args.length, 2, 'Usage: node scripts/failure-states/resources-collect.mjs INPUTS.json OUTPUT.json');
  const report = collectResourceEvidence(readJson(args[0]));
  report.inputs = dataFile(args[0]);
  report.collectorSources = ['scripts/failure-states/resources-collect.mjs', 'scripts/failure-states/resource-reporter.mjs', 'scripts/failure-states/existing-resource-cases.mjs'].map(dataFile);
  mkdirSync(dirname(resolve(args[1])), { recursive: true });
  writeFileSync(args[1], JSON.stringify(report, null, 2) + '\n');
  console.log(`Resource closed-data join: ${report.status}; unresolved=${report.gaps.length}`);
  if (report.gaps.length) process.exitCode = 1;
}
