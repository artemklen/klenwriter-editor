// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { canonical } from './perf-compare.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function checked(record){const bytes=readFileSync(record.path);assert.equal(bytes.length,record.bytes);assert.equal(hash(bytes),record.sha256,`raw changed ${record.path}`);return bytes;}
export function loadEvidence(batches) {
  const evidence={rawFiles:{},requests:{}},decoded=new Map();
  for(const batch of batches){
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
