// SPDX-License-Identifier: MIT OR Apache-2.0
// Installed-browser fixture protocol: no arbitrary JavaScript, URLs, selectors or input.
export const limits = Object.freeze({
  commands: 128, commandBytes: 4096, resultBytes: 2 * 1024 * 1024,
  trafficBytes: 32 * 1024 * 1024, logBytes: 64 * 1024 * 1024,
  polls: 8192, commandMs: 15000, runMs: 300000, guardAgeMs: 1000,
});
const phases = ['focused','type','split','join','public-host-undo-join','public-host-redo-join','delete-last','focus-return'];
const checkpoints = ['focused','typed','split','joined','undo-join','redo-join','delete-last','focus-return'];
export function validCall(method, args) {
  if (!Array.isArray(args)) return false;
  if (method === 'prepare') return args.length === 1 && ['en','ru'].includes(args[0]);
  if (method === 'phase') return args.length === 1 && phases.includes(args[0]);
  if (method === 'checkpoint') return args.length === 1 && checkpoints.includes(args[0]);
  if (method === 'history') return args.length === 1 && ['undo','redo'].includes(args[0]);
  return ['verifyTrace','finish','focusControl','guard','documentGuard'].includes(method) && args.length === 0;
}
export async function boundedJson(response, maximum) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw new Error('HTTP body declaration exceeds bound');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing HTTP body');
  let bytes = 0; const chunks = [];
  try {
    for (;;) {
      const {done,value} = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) { await reader.cancel(); throw new Error('HTTP body exceeds bound'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const joined = new Uint8Array(bytes); let at = 0;
  for (const chunk of chunks) { joined.set(chunk,at); at += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(joined));
}
