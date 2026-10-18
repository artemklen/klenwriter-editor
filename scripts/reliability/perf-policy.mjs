// SPDX-License-Identifier: MIT OR Apache-2.0
// Explicit technical adoption after measured calibration; never auto-increases
// floors in response to noise or candidate timings.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { calibrationProposal } from './perf-capture.mjs';
import { seal, verified, validateCalibration } from './perf-compare.mjs';
import { hashFile } from './perf-build.mjs';
import { loadEvidence } from './perf-evidence.mjs';
export function adoptFloors(config) {
  assert.ok(/^[a-f0-9]{40}$/.test(config.candidateSource), 'actual candidate source commit');
  assert.ok(typeof config.rationale==='string' && config.rationale.length>0);
  assert.ok(!existsSync(config.output), 'never rewrite prior adoption');
  const raw=JSON.parse(readFileSync(config.calibration,'utf8')), proposal=calibrationProposal(config.calibration);
  assert.ok(verified(raw) && proposal.status==='PENDING_EXPLICIT_FLOOR_ADOPTION');
  const cases={};
  assert.deepEqual(Object.keys(config.floors).sort(),Object.keys(proposal.cases).sort(),'every required dimension needs explicit adoption');
  for(const [id,row] of Object.entries(proposal.cases)) {
    const adopted=config.floors[id];
    assert.ok(row.stable && Number.isFinite(adopted.absoluteFloor) && adopted.absoluteFloor>=0 && typeof adopted.rationale==='string' && adopted.rationale.length>0,`unadopted/noisy ${id}`);
    if(row.absoluteFloor!==null) assert.equal(adopted.absoluteFloor,row.absoluteFloor,`existing protocol floor ${id}`);
    cases[id]={unit:row.unit,sampling:row.sampling,absoluteFloor:adopted.absoluteFloor,rationale:adopted.rationale};
  }
  const adoptedAt=new Date().toISOString();
  const calibration=seal({source:raw.source,harness:raw.harness,environment:proposal.environment,rawBaselineSha256:raw.sha256,adoptedBeforeCandidate:true,adoptedAt,rationale:config.rationale});
  const policy=seal({format:'editor-reliability-performance-policy/1',baselineSource:raw.source,candidateSource:config.candidateSource,harness:raw.harness,environment:proposal.environment,calibration,cases});
  const evidence=loadEvidence([raw]);
  // Structural validation now; actual candidate preflight repeats this using
  // its real wall time before any candidate child is launched.
  validateCalibration(policy,raw,evidence,new Date(Date.now()+1).toISOString());
  writeFileSync(config.output,JSON.stringify(policy,null,2)+'\n');return policy;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(adoptFloors(JSON.parse(readFileSync(process.argv[2],'utf8'))),null,2));
