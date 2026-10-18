// SPDX-License-Identifier: MIT OR Apache-2.0
import { loadSdk, verifyLoadedSdk } from '@klenwriter/editor-wasm';
import type { EventDto, LazyWasmLoader, LoadedSdkV1, OpenOptions, RawSdkSessionV1, SdkRequest, SdkResponse, StampDto, StateDto } from '@klenwriter/editor-wasm';
import { copyInput, DataError, freezeData, HARD_REQUEST_BYTES, ownData, plainFields } from './data.js';
import type { OwnedData } from './data.js';
import { decodeResponse } from './response.js';

export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type Response = DeepReadonly<SdkResponse>;
export type Lifecycle = 'loading' | 'ready' | 'disposing' | 'destroyed' | 'fatal';
export type ReadRequest = Extract<SdkRequest, { kind: 'state' | 'catalog' | 'node' | 'map_position' | 'resources' }>;
export type QueryRequest = Extract<SdkRequest, { kind: 'query_command' | 'query_history' }>;
export type MutationRequest = Exclude<SdkRequest, ReadRequest | QueryRequest | { kind: 'events' | 'acknowledge_events' }>;
export type StampedMutation = Extract<MutationRequest, { stamp: StampDto }>;
export type Submission = { readonly status: 'completed'; readonly response: Response } | { readonly status: 'queued'; readonly completion: Promise<Response> };
export interface ControllerLimits { readonly pending?: number; readonly requestBytes?: number; readonly queuedBytes?: number; readonly listeners?: number }
export interface CallbackError { readonly code: 'sdk.listener_error'; readonly listener: string }
export interface CreateEditorOptions {
  readonly input: Uint8Array;
  readonly options: OpenOptions;
  readonly loader?: LazyWasmLoader;
  readonly limits?: ControllerLimits;
  readonly onCallbackError?: (error: CallbackError) => void;
}
export interface HostRequest { readonly id: string; readonly stamp: DeepReadonly<StampDto> }
export type HostCapture = { readonly status: 'captured'; readonly request: HostRequest } | { readonly status: 'refused'; readonly response: Response };
type Listener = (event: DeepReadonly<EventDto>) => void;
type Pending = { owned: OwnedData<MutationRequest>; resolve: (result: Response) => void };
const READS = new Set(['state', 'catalog', 'node', 'map_position', 'resources']);
const QUERIES = new Set(['query_command', 'query_history']);
const MUTATIONS = new Set(['command', 'history', 'set_selection', 'set_stored_marks', 'barrier', 'snapshot', 'acknowledge_snapshot', 'reconcile_snapshot', 'release_snapshot', 'remount', 'update_facts', 'destroy']);
const stampEqual = (a: DeepReadonly<StampDto>, b: DeepReadonly<StampDto>) => a.session === b.session && a.generation === b.generation && a.revision === b.revision && a.selection_epoch === b.selection_epoch && a.history_epoch === b.history_epoch;
const destroyed = (): Response => freezeData({ status: 'ok', value: { kind: 'destroyed' } });

/** Owns one Rust Session; notifications are delivered behind one mutation fence. */
export class EditorController {
  readonly ready: Promise<Response>;
  #resolveReady!: (result: Response) => void;
  #readySettled = false;
  #lifecycle: Lifecycle = 'loading';
  #raw: RawSdkSessionV1 | null = null;
  #module: LoadedSdkV1 | null = null;
  #state: StateDto | null = null;
  #original: Uint8Array | null = null;
  #pending: Pending[] = [];
  #queuedBytes = 0;
  #inFlightTickets = 0;
  #listeners = new Map<string, Listener>();
  #hostRequests = new Map<string, HostRequest>();
  #nextListener = 1n;
  #nextHost = 1n;
  #lastSequence = 0n;
  #processing = false;
  #destroyRequested = false;
  #destroyTicket: Submission | null = null;
  #continuation: ReturnType<typeof setTimeout> | null = null;
  #callbackErrors: CallbackError[] = [];
  #onCallbackError: ((error: CallbackError) => void) | undefined;
  #limits = { pending: 128, requestBytes: HARD_REQUEST_BYTES, queuedBytes: 32 * 1024 * 1024, listeners: 64 };

  constructor(configuration: CreateEditorOptions) {
    this.ready = new Promise(resolve => { this.#resolveReady = resolve; });
    try {
      const fields = plainFields(configuration);
      if (Object.keys(fields).some(key => !['input', 'options', 'loader', 'limits', 'onCallbackError'].includes(key)) || !fields.input || !fields.options) throw new DataError('sdk.invalid_input');
      this.#original = copyInput(fields.input.value);
      const options = ownData(fields.options.value as OpenOptions);
      if (fields.limits) {
        for (const [key, descriptor] of Object.entries(plainFields(fields.limits.value))) {
          if (!Object.hasOwn(this.#limits, key) || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0) throw new DataError('sdk.invalid_limit');
          const name = key as 'pending' | 'requestBytes' | 'queuedBytes' | 'listeners';
          this.#limits[name] = Math.min(this.#limits[name], descriptor.value);
        }
      }
      if (fields.onCallbackError) {
        if (typeof fields.onCallbackError.value !== 'function') throw new DataError('sdk.invalid_input');
        this.#onCallbackError = fields.onCallbackError.value;
      }
      const loader: LazyWasmLoader = fields.loader ? fields.loader.value : () => loadSdk();
      if (typeof loader !== 'function') throw new DataError('sdk.invalid_input');
      void this.#initialize(loader, options.json);
    } catch (error) {
      this.#onCallbackError = undefined;
      this.#lifecycle = 'destroyed';
      this.#settleReady(this.#refusal(error instanceof DataError ? error.code : 'sdk.invalid_input'));
    }
  }

  get lifecycle(): Lifecycle { return this.#lifecycle; }
  /** Explicit bounded recovery copy. Successful admission releases the original. */
  originalInput(): Uint8Array | null { return this.#original?.slice() ?? null; }
  capture(): DeepReadonly<StampDto> | null { return this.#lifecycle === 'ready' && this.#state ? this.#state.stamp : null; }
  read(request: ReadRequest): Response { return this.#readonly(request, READS); }
  query(request: QueryRequest): Response { return this.#readonly(request, QUERIES); }

  submit(request: MutationRequest): Submission {
    if (this.#lifecycle !== 'ready' || this.#destroyRequested) return this.#completed(this.#unavailable());
    let owned: OwnedData<MutationRequest>;
    try {
      owned = ownData(request, this.#limits.requestBytes);
      if (!owned.value || !MUTATIONS.has(owned.value.kind)) throw new DataError('sdk.invalid_request_kind');
    } catch (error) { return this.#completed(this.#refusal(error instanceof DataError ? error.code : 'sdk.invalid_input')); }
    return this.#submitOwned(owned);
  }
  #submitOwned(owned: OwnedData<MutationRequest>): Submission {
    if (this.#lifecycle !== 'ready' || this.#destroyRequested) return this.#completed(this.#unavailable());
    if (owned.value.kind === 'destroy') {
      if (Object.keys(owned.value).length !== 1) return this.#completed(this.#refusal('sdk.invalid_input'));
      return this.destroy();
    }
    if (this.#processing || this.#continuation !== null || this.#pending.length) return this.#enqueue(owned);
    this.#processing = true;
    const result = this.#execute(owned);
    this.#drain(63);
    return this.#completed(result);
  }

  subscribe(listener: Listener): (() => void) | Response {
    if (this.#lifecycle !== 'ready' || this.#destroyRequested) return this.#unavailable();
    if (typeof listener !== 'function') return this.#refusal('sdk.invalid_listener');
    if (this.#listeners.size >= this.#limits.listeners || this.#nextListener > 18446744073709551615n) return this.#refusal('sdk.listener_limit');
    const id = String(this.#nextListener++);
    this.#listeners.set(id, listener);
    let active = true;
    return () => { if (active) { active = false; this.#listeners.delete(id); } };
  }

  captureHostRequest(): HostCapture {
    const stamp = this.capture();
    if (!stamp || this.#destroyRequested) return { status: 'refused', response: this.#unavailable() };
    if (this.#hostRequests.size >= 128 || this.#nextHost > 18446744073709551615n) return { status: 'refused', response: this.#refusal('sdk.host_request_limit') };
    const request = Object.freeze({ id: String(this.#nextHost++), stamp });
    this.#hostRequests.set(request.id, request);
    return { status: 'captured', request };
  }
  releaseHostRequest(request: HostRequest): boolean {
    const entry = this.#hostRequest(request);
    return entry ? this.#hostRequests.delete(entry.id) : false;
  }
  completeHostRequest(request: HostRequest, mutation: StampedMutation): Submission {
    const entry = this.#hostRequest(request);
    if (!entry) return this.#completed(this.#refusal('sdk.stale_request'));
    this.#hostRequests.delete(entry.id);
    const current = this.capture();
    if (!current || this.#destroyRequested || !stampEqual(current, entry.stamp)) return this.#completed(this.#refusal('sdk.stale_request'));
    try {
      const owned = ownData(mutation, this.#limits.requestBytes);
      if (!('stamp' in owned.value) || !stampEqual(owned.value.stamp, entry.stamp)) return this.#completed(this.#refusal('sdk.stale_request'));
      if (!MUTATIONS.has(owned.value.kind)) return this.#completed(this.#refusal('sdk.invalid_request_kind'));
      return this.#submitOwned(owned);
    } catch (error) { return this.#completed(this.#refusal(error instanceof DataError ? error.code : 'sdk.invalid_input')); }
  }

  destroy(): Submission {
    this.#onCallbackError = undefined;
    if (this.#lifecycle === 'destroyed' || this.#lifecycle === 'fatal') { this.#original = null; return this.#completed(destroyed()); }
    if (this.#destroyTicket) return this.#destroyTicket;
    this.#destroyRequested = true;
    this.#listeners.clear(); this.#hostRequests.clear(); this.#cancelPending('sdk.cancelled');
    if (this.#continuation !== null) { clearTimeout(this.#continuation); this.#continuation = null; }
    if (this.#lifecycle === 'loading') {
      this.#lifecycle = 'destroyed'; this.#original = null;
      this.#settleReady(this.#refusal('sdk.cancelled'));
      return this.#completed(destroyed());
    }
    if (this.#processing) {
      this.#destroyTicket = this.#enqueue(ownData({ kind: 'destroy' } as MutationRequest), true);
      return this.#destroyTicket;
    }
    this.#dispose('destroyed');
    return this.#completed(destroyed());
  }

  /** Actual owned counts, separate from native global resource accounting. */
  resources() {
    return Object.freeze({ lifecycle: this.#lifecycle, sessions: this.#raw ? 1 : 0, listeners: this.#listeners.size,
      queued_mutations: this.#pending.length, queued_bytes: this.#queuedBytes, pending_tickets: this.#pending.length + this.#inFlightTickets,
      host_requests: this.#hostRequests.size, task_continuations: this.#continuation === null ? 0 : 1,
      original_input_bytes: this.#original?.byteLength ?? 0, callback_errors: this.#callbackErrors.length,
      callback_error_handlers: this.#onCallbackError === undefined ? 0 : 1 });
  }
  callbackErrors(): readonly CallbackError[] { return Object.freeze([...this.#callbackErrors]); }
  nativeResources(): unknown {
    if (!this.#module) return null;
    try { return freezeData(JSON.parse(this.#module.resourceCounts())); } catch { return null; }
  }

  async #initialize(loader: LazyWasmLoader, optionsJson: string): Promise<void> {
    let opening = false;
    try {
      const module = verifyLoadedSdk(await loader());
      if (this.#lifecycle !== 'loading' || this.#destroyRequested) return;
      this.#module = module; opening = true;
      const raw = new module.Session(this.#original!, optionsJson);
      if (this.#lifecycle !== 'loading' || this.#destroyRequested) { this.#freeRaw(raw); return; }
      this.#raw = raw;
      const result = decodeResponse(raw.initialization());
      if (result.status !== 'ok' || result.value.kind !== 'state') {
        if (result.status === 'ok') { this.#settleReady(this.#fatal('sdk.invalid_response', false, true)); return; }
        this.#dispose(result.status === 'fatal' ? 'fatal' : 'destroyed', true);
        this.#settleReady(result); return;
      }
      this.#state = result.value.state; this.#original = null; this.#lifecycle = 'ready';
      this.#settleReady(result);
    } catch (error) {
      if (this.#lifecycle !== 'loading') return;
      if (opening) { this.#settleReady(this.#fatal('sdk.initialization_failure', false, true)); return; }
      const code = error instanceof DataError ? error.code : this.#loadCode(error);
      this.#dispose('destroyed', true); this.#settleReady(this.#refusal(code));
    }
  }
  #loadCode(error: unknown): string {
    try {
      if (error instanceof Error) {
        const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
        if (descriptor && typeof descriptor.value === 'string' && /^sdk\.[a-z_]+$/.test(descriptor.value)) return descriptor.value;
      }
    } catch { /* Never inspect arbitrary thrown-value getters. */ }
    return 'sdk.load_failed';
  }
  #settleReady(result: Response) { if (!this.#readySettled) { this.#readySettled = true; this.#resolveReady(result); } }
  #completed(response: Response): Submission { return Object.freeze({ status: 'completed', response }); }
  #refusal(code: string): Response {
    return freezeData({ status: 'refused', diagnostic: { code, path: '', category: 'sdk', details: {}, stamp: this.#state?.stamp ?? null, may_have_committed: false } });
  }
  #unavailable(): Response { return this.#refusal(this.#destroyRequested || this.#lifecycle === 'destroyed' ? 'sdk.disposed' : this.#lifecycle === 'fatal' ? 'sdk.fatal' : 'sdk.not_ready'); }
  #fatal(code: string, mayHaveCommitted: boolean, preserveOriginal = false): Response {
    const response = freezeData({ status: 'fatal' as const, diagnostic: { code, path: '', category: 'transport', details: {}, stamp: this.#state?.stamp ?? null, may_have_committed: mayHaveCommitted } });
    this.#dispose('fatal', preserveOriginal); return response;
  }
  #readonly(request: ReadRequest | QueryRequest, allowed: Set<string>): Response {
    if (this.#lifecycle !== 'ready' || this.#destroyRequested) return this.#unavailable();
    try {
      const owned = ownData(request, this.#limits.requestBytes);
      if (!owned.value || !allowed.has(owned.value.kind)) return this.#refusal('sdk.invalid_request_kind');
      if (this.#lifecycle !== 'ready' || this.#destroyRequested) return this.#unavailable();
      return this.#wire(owned.json, false);
    } catch (error) { return this.#refusal(error instanceof DataError ? error.code : 'sdk.invalid_input'); }
  }
  #wire(json: string, mutation: boolean): SdkResponse {
    try {
      const response = decodeResponse(this.#raw!.call(json));
      if (response.status === 'fatal') this.#dispose('fatal');
      return response;
    } catch { return this.#fatal('sdk.transport_failure', mutation) as SdkResponse; }
  }
  #enqueue(owned: OwnedData<MutationRequest>, disposing = false): Submission {
    if (!disposing && (this.#pending.length >= this.#limits.pending || owned.bytes > this.#limits.queuedBytes - this.#queuedBytes)) return this.#completed(this.#refusal('sdk.queue_limit'));
    let resolve!: (response: Response) => void;
    const completion = new Promise<Response>(done => { resolve = done; });
    this.#pending.push({ owned, resolve }); this.#queuedBytes += owned.bytes;
    return Object.freeze({ status: 'queued', completion });
  }
  #execute(owned: OwnedData<MutationRequest>): Response {
    if (owned.value.kind === 'destroy') { this.#dispose('destroyed'); return destroyed(); }
    if (this.#destroyRequested || this.#lifecycle !== 'ready') return this.#unavailable();
    const before = this.#state?.stamp;
    const response = this.#wire(owned.json, true);
    if (response.status === 'ok' && (response.value.kind === 'state' || response.value.kind === 'mutation')) {
      this.#state = response.value.state;
      if (before && (before.session !== this.#state.stamp.session || before.generation !== this.#state.stamp.generation)) {
        this.#lastSequence = 0n; this.#hostRequests.clear(); this.#cancelPending('sdk.stale_generation');
      }
    }
    if (this.#lifecycle === 'ready') { const failure = this.#deliver(); if (failure) return failure; }
    return response;
  }
  #deliver(): Response | null {
    const batch = this.#wire('{"kind":"events"}', true);
    if (batch.status !== 'ok') return batch.status === 'fatal' ? batch : this.#fatal('sdk.event_delivery_failure', true);
    if (batch.value.kind !== 'events' || batch.value.gap) return this.#fatal('sdk.event_gap', true);
    if (!batch.value.events.length) return null;
    for (const event of batch.value.events) {
      if (BigInt(event.sequence) !== this.#lastSequence + 1n || !this.#state || !stampEqual(event.after, this.#state.stamp)) return this.#fatal('sdk.invalid_event_order', true);
      this.#lastSequence = BigInt(event.sequence);
      const members = [...this.#listeners];
      for (const [id, listener] of members) {
        if (this.#destroyRequested || this.#lifecycle !== 'ready') break;
        if (this.#listeners.get(id) !== listener) continue;
        try {
          const returned: unknown = listener(event);
          if (returned instanceof Promise) void returned.catch(() => this.#callbackError(id));
        } catch { this.#callbackError(id); }
      }
      if (this.#lifecycle !== 'ready') return this.#unavailable();
    }
    const ack = this.#wire(JSON.stringify({ kind: 'acknowledge_events', cursor: batch.value.cursor }), true);
    if (ack.status !== 'ok' || ack.value.kind !== 'released') return ack.status === 'fatal' ? ack : this.#fatal('sdk.event_acknowledgement_failure', true);
    return null;
  }
  #callbackError(listener: string) {
    if (this.#lifecycle !== 'ready' || this.#destroyRequested) return;
    const error = Object.freeze({ code: 'sdk.listener_error' as const, listener });
    if (this.#callbackErrors.length === 16) this.#callbackErrors.shift();
    this.#callbackErrors.push(error);
    try { this.#onCallbackError?.(error); } catch { /* Reporting cannot reverse a commit. */ }
  }
  #drain(maximum: number): void {
    let count = 0;
    while (this.#pending.length && count++ < maximum && (this.#lifecycle === 'ready' || this.#destroyRequested)) {
      const entry = this.#pending.shift()!; this.#queuedBytes -= entry.owned.bytes; this.#inFlightTickets++;
      const response = this.#execute(entry.owned);
      this.#inFlightTickets--; entry.resolve(response);
    }
    this.#processing = false;
    if (this.#pending.length && this.#lifecycle === 'ready' && !this.#destroyRequested) {
      this.#continuation = setTimeout(() => { this.#continuation = null; this.#processing = true; this.#drain(64); }, 0);
    }
  }
  #cancelPending(code: string) {
    const pending = this.#pending; this.#pending = []; this.#queuedBytes = 0;
    for (const entry of pending) entry.resolve(this.#refusal(code));
  }
  #hostRequest(request: HostRequest): HostRequest | null {
    try { const id = plainFields(request).id?.value; return typeof id === 'string' && this.#hostRequests.get(id) === request ? request : null; }
    catch { return null; }
  }
  #freeRaw(raw: RawSdkSessionV1) {
    try { raw.destroy(); } catch { /* A trapped instance is not promised recoverable. */ }
    try { raw.free(); } catch { /* Each wrapper is released at most once. */ }
  }
  #dispose(lifecycle: 'destroyed' | 'fatal', preserveOriginal = false) {
    this.#lifecycle = 'disposing'; this.#listeners.clear(); this.#hostRequests.clear(); this.#onCallbackError = undefined;
    this.#callbackErrors = [];
    if (this.#continuation !== null) { clearTimeout(this.#continuation); this.#continuation = null; }
    const raw = this.#raw; this.#raw = null; if (raw) this.#freeRaw(raw);
    if (!preserveOriginal) this.#original = null;
    this.#lifecycle = lifecycle; this.#cancelPending(lifecycle === 'fatal' ? 'sdk.fatal' : 'sdk.cancelled');
    this.#destroyTicket = null;
  }
}

export function createEditor(options: CreateEditorOptions): EditorController { return new EditorController(options); }
