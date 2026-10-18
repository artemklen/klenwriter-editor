// SPDX-License-Identifier: MIT OR Apache-2.0
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { compare, canonical, seal } from './perf-compare.mjs';
import { hashFile } from './perf-build.mjs';
import { corpus } from './perf-corpus.mjs';
import { defaultPlan } from './perf-capture.mjs';
import { fileURLToPath } from 'node:url';
import { loadEvidence } from './perf-evidence.mjs';
export function analyze(config) {
  try {
    const read = path => JSON.parse(readFileSync(path, 'utf8'));
    const baseline = read(config.baseline), candidate = read(config.candidate), policy = read(config.policy), calibrationRaw = read(config.calibration);
    const confirmation = config.confirmation ? { baseline: read(config.confirmation.baseline), candidate: read(config.confirmation.candidate) } : undefined;
    const evidence=loadEvidence([baseline,candidate,calibrationRaw,...(confirmation?[confirmation.baseline,confirmation.candidate]:[])]);
    const result=compare({ baseline, candidate, policy, calibrationRaw, evidence, confirmation });
    const required=defaultPlan(corpus(fileURLToPath(new URL('../../',import.meta.url))));
    const full=[baseline,candidate,calibrationRaw,...(confirmation?[confirmation.baseline,confirmation.candidate]:[])].every(batch=>batch.acceptanceScope==='full-required-plan'
      && hashFile(batch.plan.path)===batch.plan.sha256 && canonical(read(batch.plan.path))===canonical(required));
    return seal({...result,acceptanceScope:full?'full-required-plan':'diagnostic-subset',status:config.requireConclusive&&!full?'INCONCLUSIVE':result.status});
  } catch (error) {
    return seal({ format: 'editor-reliability-performance-comparison/1', status: 'INCONCLUSIVE', integrity: 'invalid',
      acceptanceScope: 'unverified', reason: `Evidence loading/validation failed: ${error.name}: ${error.message}` });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(readFileSync(process.argv[2], 'utf8')), result = analyze(config);
  if (config.output) writeFileSync(config.output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.integrity !== 'valid' ? 1 : result.status === 'FAIL' ? 2 : config.requireConclusive && result.status !== 'PASS' ? 3 : 0;
}
