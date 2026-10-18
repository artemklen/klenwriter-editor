/* tslint:disable */
/* eslint-disable */

export class SdkSessionV1 {
    free(): void;
    [Symbol.dispose](): void;
    call(request_json: string): string;
    destroy(): void;
    initialization(): string;
    constructor(input: Uint8Array, options_json: string);
}

export function buildInfo(): any;

export function kwdjCanonicalV1(input: any, options: any): string;

export function kwdjNormalizeV1(input: any, options: any): string;

export function kwdjValidateV1(input: any, options: any): string;

export function observeSdk(): string;

export function sdkManifestV1(): string;

export function sdkResourceCountsV1(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_sdksessionv1_free: (a: number, b: number) => void;
    readonly buildInfo: () => [number, number, number];
    readonly kwdjCanonicalV1: (a: any, b: any) => [number, number];
    readonly kwdjNormalizeV1: (a: any, b: any) => [number, number];
    readonly kwdjValidateV1: (a: any, b: any) => [number, number];
    readonly observeSdk: () => [number, number];
    readonly sdkManifestV1: () => [number, number];
    readonly sdkResourceCountsV1: () => [number, number];
    readonly sdksessionv1_call: (a: number, b: number, c: number) => [number, number];
    readonly sdksessionv1_destroy: (a: number) => void;
    readonly sdksessionv1_initialization: (a: number) => [number, number];
    readonly sdksessionv1_new: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
