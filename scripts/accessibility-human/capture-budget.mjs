// SPDX-License-Identifier: MIT OR Apache-2.0
// Proposed human-only evidence-budget erratum. Requires the owner's explicit
// approval before opt-in. The frozen plan, semantic checks and all raw wires stay.
export const HUMAN_COMPLETE_WIRE_ID='human-complete-wire/1';
export const HUMAN_BASE_PLAN_SHA256='7f10a395d854caf33a3b8bfa017a970517d90a978b4a55706be983c5d5754c6e';
export const HUMAN_COMPLETE_WIRE_LIMITS=Object.freeze({wireRecords:8192,wireUtf8Bytes:8388608,chunkCount:128,chunkBytes:524288,totalBytes:33554432});
const captureEncoder=new TextEncoder(),captureCheck=(ok,why)=>{if(!ok)throw Error(why);};
export function humanCaptureBudget(id){
  if(id===undefined)return null;
  captureCheck(id===HUMAN_COMPLETE_WIRE_ID,'Exact explicit human complete-wire capture budget');
  return HUMAN_COMPLETE_WIRE_LIMITS;
}
// Every original row remains an unmodified chronological row. The ordinal127
// envelope and maximal counters conservatively bound all actual envelope sizes.
export function completeWireCheckpointChunks(payload,{nonce,checkpoint,firstRecord}){
  const cap=HUMAN_COMPLETE_WIRE_LIMITS;
  captureCheck(/^[a-f0-9]{64}$/.test(nonce)&&Number.isSafeInteger(checkpoint)&&checkpoint>=1&&checkpoint<=24,'Closed human checkpoint identity');
  captureCheck(payload.kind==='native-checkpoint'&&typeof payload.mountId==='string'&&typeof payload.label==='string'&&Array.isArray(payload.wire),'Original native checkpoint');
  const {wire,...metadata}=payload;
  captureCheck(Number.isSafeInteger(firstRecord)&&firstRecord>=1&&wire.length<=cap.wireRecords&&firstRecord+wire.length-1<=cap.wireRecords,'Exact bounded chronological wire range');
  const envelope=value=>({schema:'kwe-a66-human-chunk/1',nonce,ordinal:cap.chunkCount-1,kind:'observation',payload:value});
  const bytes=value=>captureEncoder.encode(JSON.stringify(value)).length;
  const make=(rows,part,parts,start)=>({kind:'native-wire',checkpoint,mountId:payload.mountId,label:payload.label,part,parts,firstRecord:start,lastRecord:start+rows.length-1,records:rows.length,wire:rows});
  const overhead=bytes(envelope({...make([],127,128,8192),lastRecord:8192,records:8192}));
  const groups=[];let rows=[],rowBytes=0;
  for(const row of wire){
    const size=bytes(row);captureCheck(overhead+size<=cap.chunkBytes,'One original wire row exceeds unchanged per-chunk cap');
    if(rows.length&&overhead+rowBytes+size+rows.length>cap.chunkBytes){groups.push(rows);rows=[];rowBytes=0;}
    rows.push(row);rowBytes+=size;
  }
  if(rows.length)groups.push(rows);
  captureCheck(groups.length<cap.chunkCount,'Finite original wire chunk count');
  let start=firstRecord;
  const chunks=groups.map((group,part)=>{const value=make(group,part,groups.length,start);start+=group.length;return value;});
  const checkpointValue={...metadata,wire:[],wireChunks:{schema:'kwe-a66-human-wire-chunks/1',checkpoint,parts:chunks.length,records:wire.length,firstRecord:wire.length?firstRecord:null,lastRecord:wire.length?firstRecord+wire.length-1:null}};
  chunks.push(checkpointValue);
  for(const value of chunks)captureCheck(bytes(envelope(value))<=cap.chunkBytes,'Unchanged complete envelope byte cap; never truncate');
  return chunks;
}
