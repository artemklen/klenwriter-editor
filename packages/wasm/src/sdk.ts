import { sdkBuildId } from './sdk-build-id.js';
import type { SdkManifest } from './sdk-types.js';
import type { SdkManifestV2 } from './sdk-types-v2.js';

export { sdkBuildId } from './sdk-build-id.js';
export const sdkAbiV1 = 'editor-sdk/1' as const;
export const sdkAbiV2 = 'editor-sdk/2' as const;

/** Low-level Rust ownership. Controllers must destroy and free exactly once. */
export interface RawSdkSessionV1 {
  initialization(): string;
  call(requestJson: string): string;
  destroy(): void;
  free(): void;
}
export interface LoadedSdkV1 {
  readonly manifest: SdkManifest;
  readonly Session: new (input: Uint8Array, optionsJson: string) => RawSdkSessionV1;
  readonly resourceCounts: () => string;
}
export type LazyWasmLoader = () => Promise<LoadedSdkV1>;
export interface RawSdkSessionV2 extends RawSdkSessionV1 {
  context(): string;
}
export interface LoadedSdkV2 {
  readonly manifest: SdkManifestV2;
  readonly Session: new (input: Uint8Array, optionsJson: string) => RawSdkSessionV2;
  readonly resourceCounts: () => string;
}
export type LazyWasmLoaderV2 = () => Promise<LoadedSdkV2>;
export type SdkWasmInput = Uint8Array | ArrayBuffer | Response | Request | URL | string;
export interface SdkLoadOptions {
  readonly wasm?: SdkWasmInput;
  /** Asynchronous waiting ceiling; synchronous JS/WASM work is not preempted. */
  readonly loadTimeoutMs?: number;
  /** Cancels this reader only; another live reader retains shared work. */
  readonly signal?: AbortSignal;
}
export type SdkLoadErrorCode = 'sdk.module_invalid' | 'sdk.manifest_invalid' | 'sdk.abi_mismatch'
  | 'sdk.build_mismatch' | 'sdk.load_failed' | 'sdk.compile_failed' | 'sdk.instantiate_failed'
  | 'sdk.module_input_mismatch' | 'sdk.publisher_mismatch' | 'sdk.load_timeout'
  | 'sdk.load_cancelled' | 'sdk.runtime_retired';

/** Structured loading failure; callers inspect code/phase without parsing a message. */
export class SdkLoadError extends Error {
  readonly name = 'SdkLoadError';
  constructor(readonly code: SdkLoadErrorCode, readonly phase: string, readonly cause?: unknown) {
    super(code);
  }
}

const plain = (value: unknown): value is Record<string, unknown> => value !== null
  && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).length === expected.length
  && expected.every(key => Object.hasOwn(value, key));
function wellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0
  && value.length <= 256 && wellFormed(value);
const invalid = (phase: string): never => { throw new SdkLoadError('sdk.manifest_invalid', phase); };

function manifestValue(value: unknown): SdkManifest {
  if (!plain(value) || !keys(value, ['abi', 'build_id', 'profiles']) || !text(value.abi)
    || !text(value.build_id) || !Array.isArray(value.profiles) || value.profiles.length < 1
    || value.profiles.length > 16) return invalid('manifest');
  for (const profile of value.profiles) {
    if (!plain(profile) || !keys(profile, ['profile_id', 'profile_version', 'codec_id', 'wire_version', 'extensions'])
      || !text(profile.profile_id) || !text(profile.profile_version) || !text(profile.codec_id)
      || !Number.isSafeInteger(profile.wire_version) || (profile.wire_version as number) < 0
      || (profile.wire_version as number) > 0xffff_ffff || !Array.isArray(profile.extensions)
      || profile.extensions.length > 64) return invalid('profile');
    for (const extension of profile.extensions) {
      if (!plain(extension) || !keys(extension, ['id', 'version']) || !text(extension.id)
        || !text(extension.version)) return invalid('extension');
      Object.freeze(extension);
    }
    Object.freeze(profile.extensions); Object.freeze(profile);
  }
  Object.freeze(value.profiles);
  return Object.freeze(value) as unknown as SdkManifest;
}

/** Verify injected loaders too. No Rust Session can be opened through this result before identity checks. */
export function verifyLoadedSdk(value: unknown): LoadedSdkV1 {
  if (!plain(value) || typeof value.Session !== 'function' || typeof value.resourceCounts !== 'function') {
    throw new SdkLoadError('sdk.module_invalid', 'exports');
  }
  const manifest = manifestValue(value.manifest);
  if (manifest.abi !== sdkAbiV1) throw new SdkLoadError('sdk.abi_mismatch', 'manifest');
  if (!/^sha256:[0-9a-f]{64}$/.test(sdkBuildId) || manifest.build_id !== sdkBuildId) {
    throw new SdkLoadError('sdk.build_mismatch', 'manifest');
  }
  if (packagedConstructors.has(value.Session)) assertRuntime();
  return Object.freeze({ manifest, Session: value.Session, resourceCounts: value.resourceCounts }) as LoadedSdkV1;
}

function manifestV2Value(value: unknown): SdkManifestV2 {
  if (!plain(value) || !keys(value, ['abi', 'build_id', 'registry_format', 'profiles'])
    || !text(value.abi) || !text(value.build_id) || value.registry_format !== 'editor-registry/1'
    || !Array.isArray(value.profiles) || value.profiles.length > 16) return invalid('manifest_v2');
  const identities = new Set<string>();
  for (const profile of value.profiles) {
    if (!plain(profile) || !keys(profile, ['profile_id', 'profile_version', 'codec_id', 'wire_version', 'compiled_extensions'])
      || !text(profile.profile_id) || !text(profile.profile_version) || !text(profile.codec_id)
      || !Number.isSafeInteger(profile.wire_version) || (profile.wire_version as number) < 0
      || (profile.wire_version as number) > 0xffff_ffff || !Array.isArray(profile.compiled_extensions)
      || profile.compiled_extensions.length > 64) return invalid('profile_v2');
    const identity = JSON.stringify([profile.profile_id, profile.profile_version, profile.codec_id, profile.wire_version]);
    if (identities.has(identity)) return invalid('profile_v2');
    identities.add(identity);
    const extensions = new Set<string>();
    for (const extension of profile.compiled_extensions) {
      if (!plain(extension) || !keys(extension, ['id', 'version']) || !text(extension.id)
        || !text(extension.version) || extensions.has(extension.id)) return invalid('extension_v2');
      extensions.add(extension.id); Object.freeze(extension);
    }
    Object.freeze(profile.compiled_extensions); Object.freeze(profile);
  }
  Object.freeze(value.profiles);
  return Object.freeze(value) as unknown as SdkManifestV2;
}

/** V2 is explicitly negotiated, including injectable module projections. */
export function verifyLoadedSdkV2(value: unknown): LoadedSdkV2 {
  if (!plain(value) || typeof value.Session !== 'function' || typeof value.resourceCounts !== 'function') {
    throw new SdkLoadError('sdk.module_invalid', 'exports_v2');
  }
  const manifest = manifestV2Value(value.manifest);
  if (manifest.abi !== sdkAbiV2) throw new SdkLoadError('sdk.abi_mismatch', 'manifest_v2');
  if (!/^sha256:[0-9a-f]{64}$/.test(sdkBuildId) || manifest.build_id !== sdkBuildId) {
    throw new SdkLoadError('sdk.build_mismatch', 'manifest_v2');
  }
  if (packagedConstructors.has(value.Session)) assertRuntime();
  return Object.freeze({ manifest, Session: value.Session, resourceCounts: value.resourceCounts }) as LoadedSdkV2;
}

type Glue = {
  default: (input: { module_or_path: WebAssembly.Module }) => Promise<unknown>;
  sdkManifestV1?: () => string;
  SdkSessionV1?: LoadedSdkV1['Session'];
  sdkResourceCountsV1?: () => string;
  sdkManifestV2?: () => string;
  SdkSessionV2?: LoadedSdkV2['Session'];
  sdkResourceCountsV2?: () => string;
};
type OwnedInput = { key: string | Response; source: Exclude<SdkWasmInput, Uint8Array> | Uint8Array };
type Abi = typeof sdkAbiV1 | typeof sdkAbiV2;
type VerifiedModule = { bytes: Uint8Array<ArrayBuffer>; abi: Abi };
type ModuleBundle = { abi: Abi; glue: Glue; v1?: LoadedSdkV1; v2?: LoadedSdkV2 };
type ModuleLoad = {
  key: OwnedInput['key']; verified?: Promise<VerifiedModule>; initialized?: Promise<ModuleBundle>;
  readers: number; abort: AbortController; bodyReader?: ReadableStreamDefaultReader<Uint8Array>;
  abandoned: boolean; singletonStarted: boolean; complete: boolean; accepted: boolean; failed: boolean;
};
const MAX_MODULE_BYTES = 64 * 1024 * 1024;
const MAX_LOAD_TIMEOUT_MS = 30_000;
// One immutable verified module initialization, never shared Session state.
let cached: ModuleLoad | undefined;
let publisherFault: SdkLoadError | undefined;
let runtimeFault: SdkLoadError | undefined;
const packagedConstructors = new WeakSet<Function>();
const runtimeWaiters = new Set<(failure: SdkLoadError) => void>();
// A digest-pending reader must not lose shared initialization before it can
// establish whether its owned bytes name that entry. Reservations open no Session.
const ownershipWaiters = new Set<(entry: ModuleLoad) => void>();
const now = () => performance.now();

function assertRuntime(): void {
  if (publisherFault) throw publisherFault;
  if (runtimeFault) throw runtimeFault;
}
function retireRuntime(cause: unknown, notify = true): void {
  runtimeFault ??= new SdkLoadError('sdk.runtime_retired', 'runtime', cause);
  if (notify) for (const fail of [...runtimeWaiters]) fail(runtimeFault);
}
function invokeRuntime<T>(call: () => T): T {
  assertRuntime();
  try { return call(); }
  catch (cause) {
    // Only calls through the verified packaged glue have this capability.
    // Controlled injected JS transports retain their separate failure semantics.
    if (cause instanceof WebAssembly.RuntimeError) retireRuntime(cause);
    throw cause;
  }
}

function guardedSession<T extends RawSdkSessionV1>(Native: new (input: Uint8Array, optionsJson: string) => T,
  v2: boolean): new (input: Uint8Array, optionsJson: string) => T {
  class Session implements RawSdkSessionV1 {
    #raw: T;
    constructor(input: Uint8Array, optionsJson: string) {
      this.#raw = invokeRuntime(() => new Native(input, optionsJson));
      if (v2) Object.defineProperty(this, 'context', {
        value: () => invokeRuntime(() => (this.#raw as unknown as RawSdkSessionV2).context()),
      });
      Object.freeze(this);
    }
    initialization(): string { return invokeRuntime(() => this.#raw.initialization()); }
    call(requestJson: string): string { return invokeRuntime(() => this.#raw.call(requestJson)); }
    destroy(): void { invokeRuntime(() => this.#raw.destroy()); }
    free(): void { invokeRuntime(() => this.#raw.free()); }
  }
  packagedConstructors.add(Session);
  return Session as unknown as new (input: Uint8Array, optionsJson: string) => T;
}

function assertWork(entry: ModuleLoad): void {
  assertRuntime();
  if (entry.abandoned || cached !== entry) throw new SdkLoadError('sdk.load_cancelled', 'load');
}
function abandon(entry: ModuleLoad): void {
  if (entry.abandoned || entry.failed || entry.complete && entry.accepted) return;
  entry.abandoned = true;
  if (cached === entry) cached = undefined;
  entry.abort.abort();
  if (entry.bodyReader) void entry.bodyReader.cancel().catch(() => { /* Cancellation is best effort. */ });
  // The fixed generated glue cannot safely be initialized a second time while
  // an abandoned first initialization may still complete in this realm.
  if (entry.singletonStarted) retireRuntime(new SdkLoadError('sdk.load_cancelled', 'initialization'));
}

async function ownInput(input: SdkWasmInput | undefined): Promise<OwnedInput> {
  if (input === undefined) return { key: 'packaged', source: new URL('./editor_wasm_bg.wasm', import.meta.url) };
  if (input instanceof Uint8Array || input instanceof ArrayBuffer) {
    const view = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (!view.byteLength || view.byteLength > MAX_MODULE_BYTES) throw new SdkLoadError('sdk.module_invalid', 'bytes');
    const bytes = new Uint8Array(view);
    // Only the content digest is retained by the shared module cache, not caller buffers.
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return { key: `bytes:${Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('')}`, source: bytes };
  }
  if (typeof Response !== 'undefined' && input instanceof Response) return { key: input, source: input };
  if (typeof Request !== 'undefined' && input instanceof Request) {
    // Only immutable GET sources participate in module initialization.
    if (input.method !== 'GET') throw new SdkLoadError('sdk.module_invalid', 'request');
    return { key: `url:${input.url}`, source: input };
  }
  if (typeof input === 'string' || input instanceof URL) {
    const url = new URL(String(input), import.meta.url);
    return { key: `url:${url.href}`, source: url };
  }
  throw new SdkLoadError('sdk.module_invalid', 'input');
}

async function moduleBytes(input: OwnedInput['source'], entry: ModuleLoad): Promise<Uint8Array<ArrayBuffer>> {
  assertWork(entry);
  let bytes: Uint8Array | ArrayBuffer;
  if (input instanceof Uint8Array || input instanceof ArrayBuffer) bytes = input;
  else {
    let response: Response | undefined;
    const sourceSignal = input instanceof Request ? input.signal : undefined;
    const cancelSource = () => entry.abort.abort();
    sourceSignal?.addEventListener('abort', cancelSource, { once: true });
    if (sourceSignal?.aborted) cancelSource();
    try {
      response = input instanceof Response ? input : await fetch(input, { signal: entry.abort.signal });
      if (entry.abandoned) {
        if (response.body) void response.body.cancel().catch(() => { /* Late owned body is not admitted. */ });
        assertWork(entry);
      }
      assertWork(entry);
      if (!response.ok) throw new SdkLoadError('sdk.load_failed', 'http', { status: response.status });
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > MAX_MODULE_BYTES) throw new SdkLoadError('sdk.module_invalid', 'bytes');
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      if (reader) {
        entry.bodyReader = reader;
        try {
          for (;;) {
            const next = await reader.read();
            assertWork(entry);
            if (next.done) break;
            if (next.value.byteLength > MAX_MODULE_BYTES - total) {
              void reader.cancel().catch(() => { /* Preserve the bounded refusal. */ });
              throw new SdkLoadError('sdk.module_invalid', 'bytes');
            }
            total += next.value.byteLength; chunks.push(next.value);
          }
        } finally { entry.bodyReader = undefined; reader.releaseLock(); }
      }
      const joined = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
      bytes = joined;
    } catch (cause) {
      entry.abort.abort();
      if (response?.body && !response.body.locked) {
        void response.body.cancel().catch(() => { /* Do not retain a failed owned body. */ });
      }
      if (cause instanceof SdkLoadError) throw cause;
      throw new SdkLoadError('sdk.load_failed', 'fetch', cause);
    } finally { sourceSignal?.removeEventListener('abort', cancelSource); }
  }
  assertWork(entry);
  if (!bytes.byteLength || bytes.byteLength > MAX_MODULE_BYTES) throw new SdkLoadError('sdk.module_invalid', 'bytes');
  return bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes);
}

async function verifySeal(bytes: Uint8Array<ArrayBuffer>): Promise<Abi> {
  const refuse = (phase: string): never => { throw new SdkLoadError('sdk.module_invalid', phase); };
  if (bytes.length < 8 || ![0, 97, 115, 109, 1, 0, 0, 0].every((value, index) => value === bytes[index])) return refuse('wasm_header');
  const integer = (at: number, end: number) => {
    const start = at; let value = 0;
    for (let n = 0; n < 5 && at < end; n += 1) {
      const byte = bytes[at++]; value += (byte & 127) * 2 ** (7 * n);
      if (value > 0xffff_ffff) return refuse('section_length');
      if ((byte & 128) === 0) {
        let minimal = 1; let remaining = value;
        while (remaining >= 128) { remaining = Math.floor(remaining / 128); minimal += 1; }
        if (at - start !== minimal) return refuse('section_length');
        return { value, next: at };
      }
    }
    return refuse('section_length');
  };
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  const seals: { start: number; end: number; dataStart: number }[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    const start = offset; const id = bytes[offset++];
    if (id > 13) return refuse('section_id');
    const size = integer(offset, bytes.length); offset = size.next;
    const end = offset + size.value;
    if (end > bytes.length) return refuse('section_length');
    if (id === 0) {
      const name = integer(offset, end); const dataStart = name.next + name.value;
      if (name.value > 64 * 1024 || dataStart > end) return refuse('section_name');
      let text: string;
      try { text = utf8.decode(bytes.subarray(name.next, dataStart)); }
      catch { return refuse('section_name'); }
      if (text === 'klenwriter.editor.sdk/1') seals.push({ start, end, dataStart });
    }
    offset = end;
  }
  if (offset !== bytes.length || seals.length !== 1 || seals[0].end !== bytes.length) return refuse('seal_count_or_order');
  const seal = seals[0];
  if (seal.end - seal.dataStart > 64 * 1024) return refuse('seal_metadata');
  let metadata: unknown; let json: string;
  try { json = utf8.decode(bytes.subarray(seal.dataStart, seal.end)); metadata = JSON.parse(json); }
  catch { return refuse('seal_metadata'); }
  if (!plain(metadata) || !keys(metadata, ['format', 'abi', 'build_id', 'wasm_bytes', 'wasm_sha256'])
    || JSON.stringify(metadata) !== json || metadata.format !== 'klenwriter-editor-sdk-wasm/1'
    || !text(metadata.abi) || !text(metadata.build_id) || typeof metadata.wasm_bytes !== 'number'
    || !Number.isSafeInteger(metadata.wasm_bytes) || metadata.wasm_bytes !== seal.start
    || typeof metadata.wasm_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(metadata.wasm_sha256)) return refuse('seal_metadata');
  if (metadata.abi !== sdkAbiV1 && metadata.abi !== sdkAbiV2) throw new SdkLoadError('sdk.abi_mismatch', 'seal');
  if (!/^sha256:[0-9a-f]{64}$/.test(sdkBuildId) || metadata.build_id !== sdkBuildId) throw new SdkLoadError('sdk.build_mismatch', 'seal');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice(0, seal.start)));
  const actual = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== metadata.wasm_sha256) return refuse('seal_body_hash');
  return metadata.abi;
}

function hasV1(glue: Glue): boolean {
  return typeof glue.sdkManifestV1 === 'function' && typeof glue.SdkSessionV1 === 'function'
    && typeof glue.sdkResourceCountsV1 === 'function';
}
function hasV2(glue: Glue): boolean {
  return typeof glue.sdkManifestV2 === 'function' && typeof glue.SdkSessionV2 === 'function'
    && typeof glue.sdkResourceCountsV2 === 'function';
}
function nativeManifest(read: () => string, phase: string): unknown {
  const json = read();
  if (typeof json !== 'string' || json.length > 64 * 1024) return invalid(phase);
  return JSON.parse(json);
}
function publisherMismatch(phase: string, cause: unknown): never {
  if (runtimeFault) throw runtimeFault;
  publisherFault = new SdkLoadError('sdk.publisher_mismatch', phase, cause);
  throw publisherFault;
}
function projectionV1(bundle: ModuleBundle): LoadedSdkV1 {
  assertRuntime();
  if (bundle.abi !== sdkAbiV1) throw new SdkLoadError('sdk.abi_mismatch', 'seal');
  if (bundle.v1) return bundle.v1;
  if (!hasV1(bundle.glue)) throw new SdkLoadError('sdk.module_invalid', 'glue_exports');
  try {
    const actual = verifyLoadedSdk({ manifest: invokeRuntime(() => nativeManifest(bundle.glue.sdkManifestV1!, 'manifest_json')),
      Session: bundle.glue.SdkSessionV1, resourceCounts: bundle.glue.sdkResourceCountsV1 });
    bundle.v1 = Object.freeze({ manifest: actual.manifest, Session: guardedSession(actual.Session, false),
      resourceCounts: () => invokeRuntime(actual.resourceCounts) });
    return bundle.v1;
  } catch (cause) { return publisherMismatch('native_manifest', cause); }
}
function projectionV2(bundle: ModuleBundle): LoadedSdkV2 {
  assertRuntime();
  if (bundle.v2) return bundle.v2;
  // An ABI1-only publisher need not implement this separately negotiated API.
  if (!hasV2(bundle.glue)) throw new SdkLoadError('sdk.abi_mismatch', 'glue_exports_v2');
  try {
    const actual = verifyLoadedSdkV2({ manifest: invokeRuntime(() => nativeManifest(bundle.glue.sdkManifestV2!, 'manifest_json_v2')),
      Session: bundle.glue.SdkSessionV2, resourceCounts: bundle.glue.sdkResourceCountsV2 });
    bundle.v2 = Object.freeze({ manifest: actual.manifest, Session: guardedSession(actual.Session, true),
      resourceCounts: () => invokeRuntime(actual.resourceCounts) });
    return bundle.v2;
  } catch (cause) { return publisherMismatch('native_manifest_v2', cause); }
}

async function initialize(verified: VerifiedModule, entry: ModuleLoad): Promise<ModuleBundle> {
  assertWork(entry);
  const { bytes, abi } = verified;
  let compiled: WebAssembly.Module;
  try { compiled = await WebAssembly.compile(bytes); }
  catch (cause) { throw new SdkLoadError('sdk.compile_failed', 'compile', cause); }
  assertWork(entry);
  let glue: Glue;
  try {
    // Native ES-module loading: no eval, Function, dynamic source or blob URL.
    const url = new URL('./editor_wasm.js', import.meta.url);
    const module: unknown = await import(url.href);
    assertWork(entry);
    if (!plain(module) && (module === null || typeof module !== 'object')) throw new SdkLoadError('sdk.module_invalid', 'glue');
    glue = module as Glue;
    if (typeof glue.default !== 'function' || !(abi === sdkAbiV1 ? hasV1(glue) : hasV2(glue))) {
      throw new SdkLoadError('sdk.module_invalid', 'glue_exports');
    }
  } catch (cause) {
    if (cause instanceof SdkLoadError) throw cause;
    throw new SdkLoadError('sdk.load_failed', 'glue', cause);
  }
  assertWork(entry);
  entry.singletonStarted = true;
  try { await glue.default({ module_or_path: compiled }); }
  catch (cause) {
    // Generated finalize_init stores its singleton before __wbindgen_start.
    // A start trap can therefore leave it populated despite a rejected init.
    // Preserve this attempt's established instantiate_failed diagnostic.
    if (cause instanceof WebAssembly.RuntimeError) retireRuntime(cause, false);
    throw new SdkLoadError('sdk.instantiate_failed', 'instantiate', cause);
  }
  assertWork(entry);
  const bundle: ModuleBundle = { abi, glue };
  // The seal guarantees its named API; optional APIs receive their own exact
  // native identity check when requested, sharing this one initialization.
  if (abi === sdkAbiV1) projectionV1(bundle); else projectionV2(bundle);
  entry.complete = true;
  return bundle;
}

async function loadBundle(options: SdkLoadOptions, abi: Abi): Promise<ModuleBundle> {
  const entered = now();
  assertRuntime();
  if (!plain(options)) throw new SdkLoadError('sdk.module_invalid', 'input');
  const fields = Object.getOwnPropertyDescriptors(options);
  if (Reflect.ownKeys(fields).some(key => typeof key !== 'string'
    || !['wasm', 'loadTimeoutMs', 'signal'].includes(key) || !('value' in fields[key]))) {
    throw new SdkLoadError('sdk.module_invalid', 'input');
  }
  const timeout: unknown = fields.loadTimeoutMs?.value === undefined ? MAX_LOAD_TIMEOUT_MS : fields.loadTimeoutMs.value;
  if (typeof timeout !== 'number' || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > MAX_LOAD_TIMEOUT_MS) {
    throw new SdkLoadError('sdk.module_invalid', 'deadline');
  }
  const signal: unknown = fields.signal?.value;
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new SdkLoadError('sdk.module_invalid', 'input');
  const cancellation = signal as AbortSignal | undefined;
  const deadline = entered + timeout;
  return new Promise<ModuleBundle>((resolve, reject) => {
    let settled = false;
    let current: ModuleLoad | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutFailure = () => new SdkLoadError('sdk.load_timeout', 'load');
    const release = () => {
      if (!current) return;
      const previous = current; current = undefined;
      previous.readers -= 1;
      if (previous.readers === 0) abandon(previous);
    };
    const reserve = (entry: ModuleLoad) => {
      if (settled || current === entry) return;
      release();
      if (!settled) { current = entry; current.readers += 1; }
    };
    const leave = () => {
      if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
      cancellation?.removeEventListener('abort', abortReader);
      runtimeWaiters.delete(fail);
      ownershipWaiters.delete(reserve);
      release();
    };
    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true; leave(); reject(cause);
    };
    const abortReader = () => fail(new SdkLoadError('sdk.load_cancelled', 'load'));
    const expire = () => {
      if (settled) return;
      const remaining = deadline - now();
      if (remaining <= 0) fail(timeoutFailure());
      else timer = setTimeout(expire, Math.ceil(remaining));
    };
    const active = () => {
      if (settled) throw new SdkLoadError('sdk.load_cancelled', 'load');
      assertRuntime();
      if (now() >= deadline) { const failure = timeoutFailure(); fail(failure); throw failure; }
    };
    cancellation?.addEventListener('abort', abortReader, { once: true });
    runtimeWaiters.add(fail);
    ownershipWaiters.add(reserve);
    if (cached) reserve(cached);
    timer = setTimeout(expire, Math.max(0, Math.ceil(deadline - now())));
    if (cancellation?.aborted) { abortReader(); return; }
    void (async () => {
      active();
      let input: OwnedInput;
      try { input = await ownInput(fields.wasm?.value); }
      catch (cause) {
        if (cause instanceof SdkLoadError) throw cause;
        throw new SdkLoadError('sdk.module_invalid', 'input', cause);
      }
      active();
      let entry = cached;
      if (current && current !== entry) release();
      if (entry && entry.key !== input.key) throw new SdkLoadError('sdk.module_input_mismatch', 'initialization');
      if (!entry) {
        entry = { key: input.key, readers: 0, abort: new AbortController(), abandoned: false,
          singletonStarted: false, complete: false, accepted: false, failed: false };
        cached = entry;
        for (const waiting of ownershipWaiters) waiting(entry);
        const pending = entry;
        entry.verified = (async () => {
          const bytes = await moduleBytes(input.source, pending);
          assertWork(pending);
          const verifiedAbi = await verifySeal(bytes);
          assertWork(pending);
          return { bytes, abi: verifiedAbi };
        })().catch(cause => {
          pending.failed = true;
          if (cached === pending && !publisherFault) cached = undefined;
          throw cause;
        });
      }
      reserve(entry); ownershipWaiters.delete(reserve);
      const joined = entry;
      if (!joined.initialized) {
        const verified = await joined.verified!;
        active(); assertWork(joined);
        // A V1 reader cannot initialize an ABI2-only publisher or cancel a live V2 reader.
        if (abi === sdkAbiV1 && verified.abi !== sdkAbiV1) throw new SdkLoadError('sdk.abi_mismatch', 'seal');
        if (!joined.initialized) {
          const pending = joined;
          joined.initialized = initialize(verified, joined).catch(cause => {
            pending.failed = true;
            if (cached === pending && !publisherFault) cached = undefined;
            throw cause;
          });
          // Keep no resolved verification promise holding the complete input.
          joined.verified = undefined;
        }
      }
      const bundle = await joined.initialized!;
      active();
      if (abi === sdkAbiV1 && bundle.abi !== sdkAbiV1) throw new SdkLoadError('sdk.abi_mismatch', 'seal');
      joined.accepted = true;
      settled = true; leave(); resolve(bundle);
    })().catch(fail);
  });
}

/** Default browser URL or owned Node bytes. Both APIs share one immutable module. */
export async function loadSdk(options: SdkLoadOptions = {}): Promise<LoadedSdkV1> {
  return projectionV1(await loadBundle(options, sdkAbiV1));
}
export async function loadSdkV2(options: SdkLoadOptions = {}): Promise<LoadedSdkV2> {
  return projectionV2(await loadBundle(options, sdkAbiV2));
}
