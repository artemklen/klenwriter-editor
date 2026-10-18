// SPDX-License-Identifier: MIT OR Apache-2.0
// Accepted64 correctness/capacity ladder, never a latency benchmark.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { NOTES_CAPACITY_LADDERS, notesCapacityRow } from './perf-corpus.mjs';
import { fileRecord, hashFile, productionHashes, harnessHashes } from './perf-build.mjs';
import { canonical, digest, seal, verified } from './perf-compare.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const rawHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function capacity(config) {
  const reference=config.reference?read(config.reference):null,sourceCommit=config.sourceCommit??config.baselineSource;
  if(reference){assert.ok(verified(reference));assert.equal(reference.source,'9a3747c0738fded8254eb958f7e256369cd382d3');}
  else assert.equal(sourceCommit,'9a3747c0738fded8254eb958f7e256369cd382d3','initial capacity is accepted64 only');
  assert.ok(/^[0-9a-f]{40}$/.test(sourceCommit));
  assert.ok(config.output&&!existsSync(config.output),'new immutable phase directory');
  const sourceHashes=productionHashes(root),harness=harnessHashes(root);
  for(const [path,hash] of Object.entries(sourceHashes)){
    const blob=spawnSync('git',['show',`${sourceCommit}:${path}`],{cwd:root,maxBuffer:16*1024*1024});assert.equal(blob.status,0);assert.equal(rawHash(blob.stdout),hash,`capacity source changed ${path}`);
  }
  const decision=fileRecord(resolve(root,'evidence/osr-38/notes-capacity-decision.md'));
  const committed=spawnSync('git',['show',`HEAD:evidence/osr-38/notes-capacity-decision.md`],{cwd:root});assert.equal(committed.status,0,'decision must be committed before probes');assert.equal(rawHash(committed.stdout),decision.sha256);
  mkdirSync(config.output,{recursive:true});
  const args=['build','--locked','--offline','--manifest-path','tests/fixtures/reliability-native/Cargo.toml','--bin','native-benchmark'];
  const built=spawnSync('cargo',args,{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});writeFileSync(`${config.output}/native-build.stdout`,built.stdout??'');writeFileSync(`${config.output}/native-build.stderr`,built.stderr??'');
  writeFileSync(`${config.output}/native-build.json`,JSON.stringify({program:'cargo',args,status:built.status,stdout:fileRecord(`${config.output}/native-build.stdout`),stderr:fileRecord(`${config.output}/native-build.stderr`),harnessBefore:harness,harnessAfter:harnessHashes(root)},null,2)+'\n');assert.equal(built.status,0);
  assert.equal(canonical(harness),canonical(harnessHashes(root)),'harness changed during capacity build');
  const binary=fileRecord(resolve(root,'tests/fixtures/reliability-native/target/debug/native-benchmark'));
  const wasm=fileRecord(resolve(config.distributionRoot,'packages/wasm/dist/editor_wasm_bg.wasm')),build=read(resolve(config.distributionRoot,'artifacts/sdk-build-identity.json'));
  const rows=[],selected={},selectedOperations={command:{},export:{}};
  for(const [shape,ladder] of Object.entries(NOTES_CAPACITY_LADDERS)) {
    for(const quantity of ladder){
      const row=notesCapacityRow(root,shape,quantity),directory=`${config.output}/${shape}/${quantity}`;mkdirSync(directory,{recursive:true});
      const bytes=Buffer.from(row.input),zipped=gzipSync(bytes,{mtime:0});writeFileSync(`${directory}/input.json.gz`,zipped);
      const input={bytes:bytes.length,sha256:rawHash(bytes),gzip:fileRecord(`${directory}/input.json.gz`)};
      const outcomes={};
      for(const lane of ['native','wasm']){
        const request={profile:row.profile,input:row.input,registry:row.registry,root_blocks:row.root_blocks,first_text_path:row.first_text_path,layer:lane==='native'?'core':'wasm-bridge',workload:'capacity',samples:0,warmup:0,steps:0};
        if(lane==='wasm')request.root=resolve(config.distributionRoot);
        const command=lane==='native'?binary.path:process.execPath,args=lane==='native'?[]:[resolve(root,'scripts/reliability/perf-sdk-child.mjs')];
        const result=spawnSync(command,args,{cwd:root,input:JSON.stringify(request),encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024});
        writeFileSync(`${directory}/${lane}.stdout`,result.stdout??'');writeFileSync(`${directory}/${lane}.stderr`,result.stderr??'');
        const proof={command,args,status:result.status,signal:result.signal,error:result.error?.message??null,requestSha256:digest(request),stdout:fileRecord(`${directory}/${lane}.stdout`),stderr:fileRecord(`${directory}/${lane}.stderr`)};
        writeFileSync(`${directory}/${lane}.launch.json`,JSON.stringify(proof,null,2)+'\n');assert.equal(result.status,0,`harness failed ${directory}/${lane}.launch.json`);
        const value=JSON.parse(result.stdout);assert.ok(value.status==='accepted'||value.status==='refused');
        const code=lane==='native'?value.code:value.response?.diagnostic?.code;
        if(value.status==='refused')assert.equal(code,'resource_limit_exceeded',`unexpected typed control ${shape}/${quantity}/${lane}`);
        if(lane==='wasm'){assert.equal(value.same_actual_instance_count,1);assert.equal(value.build_id,build.buildId);}
        outcomes[lane]={status:value.status,code:code??null,command_feasible:value.command_feasible===true,export_feasible:value.export?.feasible===true,proof:fileRecord(`${directory}/${lane}.launch.json`),raw:proof.stdout};
      }
      rows.push({shape,quantity,input,authored_nodes:row.authored_nodes,authored_depth:row.authored_depth,canonical_bytes:row.canonical_bytes,outcomes});
      if(reference){const expected=reference.rows.find(row=>row.shape===shape&&row.quantity===quantity);assert.ok(expected);for(const lane of ['native','wasm'])for(const field of ['status','command_feasible','export_feasible'])assert.equal(outcomes[lane][field],expected.outcomes[lane][field],'candidate admission/operation/refusal changed; never reselect');}
      if(outcomes.native.status==='accepted'&&outcomes.wasm.status==='accepted')selected[shape]={quantity,inputSha256:row.input_sha256};
      for(const operation of ['command','export'])if(outcomes.native[`${operation}_feasible`]&&outcomes.wasm[`${operation}_feasible`])selectedOperations[operation][shape]={quantity,inputSha256:row.input_sha256};
    }
    assert.ok(selected[shape],`no accepted reference rung ${shape}`);
    for(const operation of ['command','export'])assert.ok(selectedOperations[operation][shape],`no jointly feasible ${operation}/${shape}`);
  }
  assert.equal(hashFile(binary.path),binary.sha256);assert.equal(hashFile(wasm.path),wasm.sha256);assert.equal(canonical(sourceHashes),canonical(productionHashes(root)));assert.equal(canonical(harness),canonical(harnessHashes(root)));
  if(reference){assert.equal(canonical(selected),canonical(reference.selected),'candidate cannot reselect reference capacity');assert.equal(canonical(selectedOperations),canonical(reference.selectedOperations),'candidate cannot reselect operation inputs');}
  const receipt=seal({format:'editor-reliability-notes-capacity/1',source:sourceCommit,reference:reference?.sha256??null,selectionPolicy:reference?'verify-frozen-reference-no-reselection':'largest-jointly-admitted-and-operation-feasible-reference-rungs',scope:'public strict admission plus separately classified two-command and explicit-export feasibility; no performance/codec-work-headroom claim',decision,sourceHashes,harness,binary,wasm,buildId:build.buildId,ladder:NOTES_CAPACITY_LADDERS,rows,selected:reference?.selected??selected,selectedOperations:reference?.selectedOperations??selectedOperations,
    defaultLimits:{document_bytes:16777216,node_count:65536,tree_depth:48,text_leaf_bytes:1048576,work_units:1000000,work_bytes:67108864},codecAdmissionUsage:'unexposed',candidateMustReuseExactReferenceInputs:true});
  writeFileSync(`${config.output}/capacity.json`,JSON.stringify(receipt,null,2)+'\n');return receipt;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(capacity(read(process.argv[2])),null,2));
