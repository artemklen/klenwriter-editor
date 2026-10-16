// Bind completed raw files to one immutable capture. Does not alter samples.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'../..'),dir=resolve(root,'evidence/osr-61');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=name=>JSON.parse(readFileSync(`${dir}/${name}`));
const metadata=read('metadata.json'),paint=read('paint-supplement.json'),memory=read('webkit-memory-supplement.json');
const names=['chromium','firefox','webkit'].flatMap(engine=>[1,2,3].map(run=>`${engine}-run-${run}.json`));
const runs=names.map(read);
for(const [index,run]of runs.entries()){const [,engine,ordinal]=names[index].match(/^(\w+)-run-(\d+)\.json$/);if(run.engine!==engine||run.run!==Number(ordinal)||!Number.isFinite(Date.parse(run.startedAt))||!Number.isFinite(Date.parse(run.finishedAt))||Date.parse(run.finishedAt)<Date.parse(run.startedAt))throw new Error(`Invalid raw identity/timestamps: ${names[index]}`);if(index&&Date.parse(run.startedAt)<Date.parse(runs[index-1].finishedAt))throw new Error('Main launches overlap or are out of order');}
if(runs.some(run=>run.error||run.corpora.length!==7||Date.parse(run.startedAt)<Date.parse(metadata.capturedAt)||Date.parse(run.finishedAt)>Date.parse(paint.startedAt)))throw new Error('Incomplete/stale/out-of-order baseline capture');
if(paint.runs.length!==3||paint.runs.some(run=>run.error||run.corpora.length!==7)||!paint.finishedAt)throw new Error('Incomplete paint capture');
const metadataHash=sha(readFileSync(`${dir}/metadata.json`));
if(memory.error||memory.corpora.length!==7||memory.preexistingSameBundle.length||Date.parse(memory.startedAt)<Date.parse(paint.finishedAt)||!memory.finishedAt)throw new Error('Incomplete/stale/nonisolated memory capture');
if(memory.baselineMetadataSha256!==metadataHash)throw new Error('Memory series references different metadata');
if(paint.baselineMetadataSha256!==metadataHash)throw new Error('Paint series references different metadata');
for(const [name,sourceMap]of [['baseline',metadata.sourceHashes],['paint',paint.sourceHashes],['memory',memory.sourceHashes]])for(const[path,expected]of Object.entries(sourceMap))if(sha(readFileSync(`${root}/${path}`))!==expected)throw new Error(`${name} source changed: ${path}`);
for(const sourceMap of [paint.sourceHashes,memory.sourceHashes])for(const [path,expected]of Object.entries(metadata.sourceHashes))if(sourceMap[path]&&sourceMap[path]!==expected)throw new Error(`Capture source overlap disagrees: ${path}`);
const files=['metadata.json',...names,'paint-supplement.json','webkit-memory-supplement.json'];
const manifest={schema:1,seriesId:`${metadata.capturedAt}-${metadataHash.slice(0,12)}`,sealedAt:new Date().toISOString(),startedAt:metadata.capturedAt,mainFinishedAt:runs.map(run=>run.finishedAt).sort().at(-1),paintFinishedAt:paint.finishedAt,memoryFinishedAt:memory.finishedAt,derivation:'Hashes bind these unchanged completed raw files. Each main run began after this metadata capture and finished before the supplemental series; no stale file substitution is allowed.',files:Object.fromEntries(files.map(name=>[name,{bytes:readFileSync(`${dir}/${name}`).length,sha256:sha(readFileSync(`${dir}/${name}`))}]))};
if(existsSync(`${dir}/series.json`)){
 const previous=read('series.json');
 if(previous.seriesId!==manifest.seriesId||JSON.stringify(previous.files)!==JSON.stringify(manifest.files))throw new Error('Existing immutable series differs; archive it before a new capture');
 console.log(JSON.stringify({alreadySealed:true,seriesId:previous.seriesId}));
}else{writeFileSync(`${dir}/series.json`,JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({sealed:true,seriesId:manifest.seriesId,files:files.length}));}
