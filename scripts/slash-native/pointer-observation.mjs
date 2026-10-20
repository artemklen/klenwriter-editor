// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';

// Passive reads only, after one original completed platform pair. A missing or
// invalid DOM sequence never authorizes another input or release.
export async function observePointerAcknowledgement({inspect,wait,before,action,observations}){
 const began=process.hrtime.bigint();
 for(let index=0;index<9;index++){
  const value=await inspect();
  const observation={index,elapsedMs:Number(process.hrtime.bigint()-began)/1e6,id:value.id,caseId:value.caseId,observation:value.observation,inputTraceCount:value.inputTraceCount};observations.push(observation);
  assert.equal(value.id,before.id);assert.equal(value.caseId,before.caseId);
  assert.equal(value.observation.mountId,before.id);assert.deepEqual(value.observation.clock,before.observation.clock);
  assert.ok(value.inputTraceCount>=action.inputTraceBefore);
  const events=value.inputTrace.slice(action.inputTraceBefore).filter(row=>['pointerdown','pointerup','click'].includes(row.event));
  const sequence=events.map(row=>row.event);
  observation.sequence=sequence;observation.trustedCounts=Object.fromEntries(['pointerdown','pointerup','click'].map(event=>[event,events.filter(row=>row.event===event&&row.isTrusted&&row.button===0).length]));
  assert.ok(events.length<=3,'Extra pointer event after original pair');
  for(let i=0;i<events.length;i++){
   const row=events[i];assert.equal(row.event,['pointerdown','pointerup','click'][i]);assert.equal(row.isTrusted,true);assert.equal(row.button,0);
   assert.equal(row.mountId,before.id);assert.deepEqual(row.clock,before.observation.clock);
   assert.equal(row.guardedTargetObject,action.proof.pageGuard.targetObject);assert.equal(row.withinGuardedTarget,true);
   assert.equal(row.targetObject,events[0].targetObject);assert.equal(row.pointerId,events[0].pointerId);
   if(i)assert.ok(row.ordinal>events[i-1].ordinal&&row.time>=events[i-1].time);
  }
  if(events.length===3)return value;
  if(index===8)throw Error('Original pointer pair missing bounded DOM acknowledgement');
  await wait(25);
 }
 throw Error('Bounded pointer observation exhausted');
}
