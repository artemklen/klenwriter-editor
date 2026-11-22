// SPDX-License-Identifier: MIT OR Apache-2.0
import {createHash} from 'node:crypto';
export const descriptorPath = 'contracts/mounted-e2e/v1.6/renderer-source.json';
export const descriptorPin = Object.freeze({path:descriptorPath,bytes:84168,sha256:'eab2c832b608fca7fdf307a3ac17b056b7962c9f64fc68863c466bcf45da54b9'});
export const selfPath = 'scripts/mounted-corpus/renderer-source-data.mjs';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function requireSource(ok, message) {
  if (ok) return;
  const error = new Error('mounted-corpus.renderer_source: ' + message);
  error.code = 'mounted-corpus.renderer_source';
  throw error;
}
export function exact(bytes,pin) {
  requireSource(bytes instanceof Uint8Array && bytes.length === pin.bytes && hash(bytes) === pin.sha256,pin.path);
  return bytes;
}
export function decodeDescriptor(bytes) {
  return JSON.parse(Buffer.from(exact(bytes,descriptorPin)).toString('utf8'));
}
export function previousBytes(row, bytes) {
  exact(bytes,row.current);
  const [offset,removed,inserted] = row.reverse;
  return exact(Buffer.concat([bytes.subarray(0,offset),Buffer.from(inserted,'base64'),bytes.subarray(offset+removed)]),row.previous);
}
