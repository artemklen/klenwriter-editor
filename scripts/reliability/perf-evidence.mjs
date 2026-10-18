// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { canonical } from './perf-compare.mjs';
import { catalogForPlan, makeSchedule } from './perf-schedule.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function checked(record){const bytes=readFileSync(record.path);assert.equal(bytes.length,record.bytes);assert.equal(hash(bytes),record.sha256,`raw changed ${record.path}`);return bytes;}
export function loadEvidence(batches) {
  const evidence={rawFiles:{},requests:{}},decoded=new Map();
  for(const batch of batches){
    assert.ok(batch.scheduleRecord && batch.plan, 'missing original schedule/plan receipt');
    assert.equal(canonical(JSON.parse(checked(batch.scheduleRecord).toString('utf8'))), canonical(batch.schedule), 'schedule original differs from sealed batch');
    const plan=JSON.parse(checked(batch.plan).toString('utf8')), {sha256: _scheduleHash,...descriptor}=batch.schedule;
    assert.equal(canonical(descriptor), canonical(makeSchedule(catalogForPlan(plan),batch.schedule.rounds,batch.mode)), 'schedule catalog differs from bound plan');
    for(const launch of batch.launches){
      const original=batch.launchRecords.find(row=>row.id===launch.id);assert.ok(original,'missing original launch receipt');
      assert.equal(canonical(JSON.parse(checked(original).toString('utf8'))),canonical(launch),'launch original differs from sealed batch');
      for(const record of [launch.stdout,launch.stderr])checked(record);
      const request=launch.logicalRequest,compressed=checked(request.gzip);
      let raw=decoded.get(request.gzip.sha256);if(!raw){raw=gunzipSync(compressed,{maxOutputLength:20*1024*1024});decoded.set(request.gzip.sha256,raw);}
      assert.equal(raw.length,request.bytes);assert.equal(hash(raw),request.sha256);
      evidence.requests[launch.workloadSha256]??=raw.toString('utf8');
    }
    for(const run of batch.runs){const raw=checked(run.raw);evidence.rawFiles[run.raw.sha256]??=raw.toString('utf8');}
  }
  return evidence;
}
