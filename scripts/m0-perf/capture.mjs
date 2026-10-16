// One sequential capture; old raw evidence is archived, never overwritten.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'evidence/osr-61');
mkdirSync(out,{recursive:true});
const lock=`${out}/capture.lock`;const lockFd=openSync(lock,'wx');closeSync(lockFd);
const movable=readdirSync(out).filter(name=>name.endsWith('.json')||name==='baseline.md');
if(movable.length){const archive=`${out}/archive/${new Date().toISOString().replaceAll(':','-')}-${randomUUID()}`;mkdirSync(archive,{recursive:true});for(const name of movable)renameSync(`${out}/${name}`,`${archive}/${name}`);}
const state={id:randomUUID(),status:'RUNNING',startedAt:new Date().toISOString()};
writeFileSync(`${out}/capture-state.json`,JSON.stringify(state,null,2)+'\n');
try{
 for(const script of ['build','run','paint','memory','seal','summarize'])execFileSync(process.execPath,[`${root}/scripts/m0-perf/${script}.mjs`],{cwd:root,stdio:'inherit'});
 state.status='COMPLETE';
}catch(error){state.status='FAILED';state.error=String(error);throw error;}
finally{unlinkSync(lock);state.finishedAt=new Date().toISOString();writeFileSync(`${out}/capture-state.json`,JSON.stringify(state,null,2)+'\n');}
