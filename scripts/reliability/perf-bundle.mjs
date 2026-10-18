// SPDX-License-Identifier: MIT OR Apache-2.0
import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { walk, fileRecord } from './perf-build.mjs';
import { seal } from './perf-compare.mjs';
/** Actual delivered bytes, not a new size budget or a latency proxy. */
export function bundleFootprint(root) {
  const files=[];
  for(const directory of ['packages/wasm/dist','packages/sdk/dist']) for(const path of walk(resolve(root,directory)).filter(path=>/\.(js|wasm)$/.test(path))) {
    const compressed=gzipSync(readFileSync(path),{mtime:0});
    files.push({...fileRecord(path),relative:relative(root,path),per_file_gzip_bytes:compressed.length,per_file_gzip_sha256:createHash('sha256').update(compressed).digest('hex')});
  }
  return seal({format:'editor-reliability-bundle-footprint/1',files,raw_bytes_sum:files.reduce((sum,row)=>sum+row.bytes,0),per_file_gzip_bytes_sum:files.reduce((sum,row)=>sum+row.per_file_gzip_bytes,0),qualification:'Sum of separately gzipped delivered JS/WASM files; not a bundler-deduplicated single archive. No OSR80 cap adopted here.'});
}
