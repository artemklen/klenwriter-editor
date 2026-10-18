// SPDX-License-Identifier: MIT OR Apache-2.0
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { finiteScenarioParameters, failureSignature, shrinkLimits } from './shrink.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const MAX_FILE = 32 * 1024 * 1024;
function regular(path, maximum = MAX_FILE) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw new Error(`bounded regular file required: ${path}`);
  return readFileSync(path);
}
function pin(path, maximum) {
  const bytes = regular(path, maximum); return { path: resolve(path), bytes: bytes.length, sha256: hash(bytes) };
}

/** Read actual saved finite-model JSONL first; no test-only crash is installed here. */
export function readRegressionScenarios(directory) {
  const base = resolve(directory); if (lstatSync(base).isSymbolicLink() || !lstatSync(base).isDirectory()) throw new Error('regular regression directory required');
  const selected = [], files = []; let total = 0;
  for (const name of readdirSync(base).sort()) {
    if (!name.endsWith('.jsonl')) continue;
    const path = resolve(base, name), raw = regular(path, 4 * 1024 * 1024); total += raw.length;
    if (total > shrinkLimits.maxEvidenceBytes) throw new RangeError('regression corpus evidence limit');
    files.push({ path, bytes: raw.length, sha256: hash(raw) });
    const lines = raw.toString('utf8').split('\n');
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]; if (!line.trim()) continue;
      if (selected.length >= 1024) throw new RangeError('regression scenario count limit');
      const scenario = JSON.parse(line);
      if (!finiteScenarioParameters(scenario)) throw new Error(`unsupported regression scenario: ${name}:${index + 1}`);
      selected.push({ scenario, line, regression: { path, line: index + 1, sha256: hash(Buffer.from(line + '\n')) } });
    }
  }
  return { selected, files };
}

/** Exclusive bounded recorder. Caller-supplied build ID is paired with actual artifact bytes. */
export function recordReproducer({ directory, reduction, seed, sourceFiles, build, qualification }) {
  if (!reduction || !(reduction.original instanceof Uint8Array) || !(reduction.minimized instanceof Uint8Array)) throw new TypeError('byte-exact reduction required');
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new TypeError('bounded seed required');
  if (!Array.isArray(sourceFiles) || sourceFiles.length === 0 || sourceFiles.length > 512) throw new TypeError('actual source inputs required');
  if (typeof build?.id !== 'string' || build.id.length === 0 || build.id.length > 256) throw new TypeError('actual build identifier required');
  if (typeof qualification !== 'string' || qualification.length === 0 || Buffer.byteLength(qualification) > 4096) throw new TypeError('scope qualification required');
  const sourcePins = sourceFiles.map(path => pin(path)), artifact = pin(build.artifactPath, 500 * 1024 * 1024);
  const original = Buffer.from(reduction.original), minimized = Buffer.from(reduction.minimized);
  const trace = Buffer.from(JSON.stringify(reduction.trace, null, 2) + '\n');
  const suffix = reduction.kind === 'finite-model' ? '.jsonl' : '.bin';
  const files = [
    { name: 'original' + suffix, bytes: original }, { name: 'minimized' + suffix, bytes: minimized }, { name: 'probe-trace.json', bytes: trace },
  ];
  const actions = bytes => { try { return JSON.parse(bytes.toString('utf8')).actions ?? null; } catch { return null; } };
  const receipt = { format: 'editor-reliability-reproducer/1', recordedAt: new Date().toISOString(),
    status: reduction.status, reason: reduction.reason, kind: reduction.kind ?? 'unsupported', seed,
    signature: failureSignature(reduction.signature), limits: reduction.limits, probes: reduction.probes, elapsedMs: reduction.elapsedMs,
    sourcePins, build: { suppliedId: build.id, artifact }, qualification,
    files: files.map(file => ({ name: file.name, bytes: file.bytes.length, sha256: hash(file.bytes) })),
    actionTrace: reduction.kind === 'finite-model' ? {
      original: actions(original), minimized: actions(minimized),
    } : null };
  const receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');
  const total = files.reduce((sum, file) => sum + file.bytes.length, receiptBytes.length);
  if (total > Math.min(shrinkLimits.maxEvidenceBytes, reduction.limits.maxEvidenceBytes)) throw new RangeError('reproducer aggregate evidence limit');
  const parent = resolve(directory); if (lstatSync(parent).isSymbolicLink() || !lstatSync(parent).isDirectory()) throw new Error('regular recorder directory required');
  const path = resolve(parent, 'reproducer-' + randomUUID()); mkdirSync(path, { mode: 0o700 });
  for (const file of [...files, { name: 'receipt.json', bytes: receiptBytes }]) {
    const target = resolve(path, file.name); writeFileSync(target, file.bytes, { flag: 'wx', mode: 0o600 });
    const actual = regular(target, shrinkLimits.maxEvidenceBytes);
    if (!actual.equals(file.bytes)) throw new Error('reproducer readback mismatch');
  }
  return { path, receipt: { path: resolve(path, 'receipt.json'), bytes: receiptBytes.length, sha256: hash(receiptBytes) },
    files: files.map(file => ({ path: resolve(path, basename(file.name)), bytes: file.bytes.length, sha256: hash(file.bytes) })), totalBytes: total };
}
