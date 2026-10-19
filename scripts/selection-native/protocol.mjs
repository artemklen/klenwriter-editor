// SPDX-License-Identifier: MIT OR Apache-2.0
// Installed selection40 fixture only: no arbitrary URL, eval, key or coordinate RPC.
export const limits=Object.freeze({commands:1024,commandBytes:4096,resultBytes:2*1024*1024,
  trafficBytes:64*1024*1024,logBytes:128*1024*1024,polls:16384,
  commandMs:15000,runMs:600000,guardAgeMs:1000});
export const caseIds=Object.freeze(['key-comb','key-zwj','key-flag','key-rtl','key-select-all',
  'mouse-forward','mouse-reverse','scroll-down-terminal','scroll-up-terminal',
  'scroll-down-active','scroll-up-active','scroll-down-focus','scroll-up-focus']);
export const actions=Object.freeze(['move-start','down','move-end','up','shift-left','select-all','copy','cut','shift-tab','tab']);
export function validCall(method,args){
  if(!Array.isArray(args))return false;
  if(method==='prepare')return args.length===2&&['en','ru'].includes(args[0])&&caseIds.includes(args[1]);
  if(method==='guard')return args.length===1&&actions.includes(args[0]);
  return ['inspect','checkpoint','settle','finish','focusControl','documentGuard'].includes(method)&&args.length===0;
}
export async function boundedJson(response,maximum){
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maximum))throw Error('HTTP body declaration exceeds bound');
  const reader=response.body?.getReader();if(!reader)throw Error('Missing HTTP body');
  let bytes=0;const chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;
    if(bytes>maximum){await reader.cancel();throw Error('HTTP body exceeds bound');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const joined=new Uint8Array(bytes);let at=0;for(const chunk of chunks){joined.set(chunk,at);at+=chunk.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(joined));
}
