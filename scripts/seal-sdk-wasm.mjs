import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const sdkWasmSectionName = 'klenwriter.editor.sdk/1';
export const sdkWasmSealFormat = 'klenwriter-editor-sdk-wasm/1';
const maxBytes = 64 * 1024 * 1024;
const sha = value => createHash('sha256').update(value).digest('hex');
const utf8 = new TextDecoder('utf-8', { fatal: true });
const encode = value => new TextEncoder().encode(value);
const need = (condition, message) => { if (!condition) throw new Error(message); };

export function uleb32(value) {
  need(Number.isSafeInteger(value) && value >= 0 && value <= 0xffff_ffff, 'WASM u32 required');
  const result = [];
  do { let byte = value % 128; value = Math.floor(value / 128); if (value) byte |= 128; result.push(byte); } while (value);
  return Uint8Array.from(result);
}

export function wasmSections(input) {
  const bytes = new Uint8Array(input);
  need(bytes.length >= 8 && bytes.length <= maxBytes, 'Bounded WASM required');
  need([0, 97, 115, 109, 1, 0, 0, 0].every((byte, i) => bytes[i] === byte), 'WASM header/version mismatch');
  const integer = (at, end) => {
    const start = at; let value = 0;
    for (let n = 0; n < 5 && at < end; n += 1) {
      const byte = bytes[at++]; value += (byte & 127) * 2 ** (7 * n);
      need(value <= 0xffff_ffff, 'WASM length overflow');
      if ((byte & 128) === 0) { need(at - start === uleb32(value).length, 'Noncanonical WASM length'); return { value, next: at }; }
    }
    throw new Error('Truncated/overlong WASM length');
  };
  const sections = []; let offset = 8;
  while (offset < bytes.length) {
    const start = offset; const id = bytes[offset++]; need(id <= 13, 'Unknown WASM section');
    const size = integer(offset, bytes.length); offset = size.next;
    const end = offset + size.value; need(end <= bytes.length, 'Truncated WASM section');
    let name; let dataStart = offset;
    if (id === 0) {
      const size = integer(offset, end); dataStart = size.next + size.value;
      need(size.value <= 64 * 1024 && dataStart <= end, 'Invalid custom section name');
      name = utf8.decode(bytes.subarray(size.next, dataStart));
    }
    sections.push({ id, start, end, name, dataStart }); offset = end;
  }
  need(offset === bytes.length, 'Trailing WASM bytes'); return sections;
}

/** Pure producer encoding; tests may construct deliberately mismatching sealed fixtures. */
export function encodeSdkWasmSeal(raw, identity) {
  const bytes = new Uint8Array(raw);
  need(wasmSections(bytes).every(section => section.name !== sdkWasmSectionName), 'Never double-seal a module');
  const metadata = { format: sdkWasmSealFormat, abi: identity.abi, build_id: identity.build_id,
    wasm_bytes: bytes.length, wasm_sha256: sha(bytes) };
  const name = encode(sdkWasmSectionName); const data = encode(JSON.stringify(metadata));
  need(data.length <= 64 * 1024, 'Seal metadata exceeds cap');
  const payload = Buffer.concat([uleb32(name.length), name, data]);
  const result = Buffer.concat([bytes, Uint8Array.of(0), uleb32(payload.length), payload]);
  need(result.length <= maxBytes, 'Sealed WASM exceeds module cap');
  return { bytes: result, metadata };
}

/** Called only by the artifact builder, with the actual native Rust manifest. */
export function sealPackagedSdkWasm(wasmPath, nativeManifest, expectedBuildId) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const wire = readFileSync(resolve(root, 'crates/wasm/src/sdk_wire.rs'), 'utf8');
  const abi = [...wire.matchAll(/pub const SDK_ABI: &str = "([^"]+)";/g)];
  need(abi.length === 1 && nativeManifest.abi === abi[0][1], 'Native compiled ABI differs from authoritative Rust constant');
  need(nativeManifest.build_id === expectedBuildId && /^sha256:[0-9a-f]{64}$/.test(expectedBuildId), 'Native/source build identities differ');
  need(Array.isArray(nativeManifest.profiles) && nativeManifest.profiles.length > 0, 'Actual native profile offer required');
  const sealed = encodeSdkWasmSeal(readFileSync(wasmPath), nativeManifest);
  writeFileSync(wasmPath, sealed.bytes);
  mkdirSync(resolve(root, 'artifacts'), { recursive: true });
  writeFileSync(resolve(root, 'artifacts/sdk-wasm-seal.json'), JSON.stringify({
    format: sdkWasmSealFormat, section: sdkWasmSectionName, ...sealed.metadata,
    sealed_bytes: sealed.bytes.length, sealed_sha256: sha(sealed.bytes),
    scope: 'Compatibility/integrity metadata from actual native manifest and exact pre-section bytes. Not a signature, publisher authentication or security attestation.',
  }, null, 2) + '\n');
  return sealed.metadata;
}
