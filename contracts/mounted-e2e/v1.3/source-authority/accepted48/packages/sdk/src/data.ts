// SPDX-License-Identifier: MIT OR Apache-2.0
/** Ownership checks precede serialization; user accessors/toJSON are never called. */
export class DataError extends Error {
  constructor(readonly code: string) { super(code); }
}

export const HARD_REQUEST_BYTES = 16 * 1024 * 1024;
const MAX_VALUES = 262144;
const MAX_DEPTH = 64;
const U64 = '18446744073709551615';
const DECIMALS = new Set(['revision', 'generation', 'selection_epoch', 'history_epoch', 'sequence', 'from_revision', 'to_revision', 'event_sequence', 'saved_revision', 'undo_entries', 'redo_entries', 'retained_bytes', 'snapshot_bytes', 'authored_nodes', 'text_utf8', 'text_utf16', 'height', 'start', 'token']);

export function isU64(value: unknown): value is string {
  return typeof value === 'string' && value.length <= U64.length && /^(0|[1-9][0-9]*)$/.test(value)
    && (value.length < U64.length || value.length === U64.length && value <= U64);
}

export function plainFields(value: unknown): Record<string, PropertyDescriptor> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new DataError('sdk.invalid_input');
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new DataError('sdk.invalid_input');
  const fields: Record<string, PropertyDescriptor> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new DataError('sdk.invalid_input');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new DataError('sdk.invalid_input');
    fields[key] = descriptor;
  }
  return fields;
}

/** Exact JSON string UTF-8 cost, including quotes and escapes, without encoding. */
function stringBytes(value: string, add: (bytes: number) => void): void {
  add(2);
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new DataError('sdk.lone_surrogate');
      add(4);
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new DataError('sdk.lone_surrogate');
    else if (code === 0x22 || code === 0x5c || [8, 9, 10, 12, 13].includes(code)) add(2);
    else if (code < 0x20) add(6);
    else add(code < 0x80 ? 1 : code < 0x800 ? 2 : 3);
  }
}

export interface OwnedData<T> { readonly value: T; readonly json: string; readonly bytes: number }
export function ownData<T>(source: T, maximum = HARD_REQUEST_BYTES): OwnedData<T> {
  let bytes = 0, values = 0;
  const active = new Set<object>();
  const add = (cost: number) => {
    bytes += cost;
    if (bytes > maximum) throw new DataError('sdk.request_too_large');
  };
  const visit = (value: unknown, depth: number): unknown => {
    if (++values > MAX_VALUES || depth > MAX_DEPTH) throw new DataError('sdk.input_complexity');
    if (value === null) { add(4); return null; }
    if (typeof value === 'string') { stringBytes(value, add); return value; }
    if (typeof value === 'boolean') { add(value ? 4 : 5); return value; }
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) throw new DataError('sdk.invalid_integer');
      add(String(value).length); return value;
    }
    if (typeof value !== 'object' || active.has(value)) throw new DataError('sdk.invalid_input');
    active.add(value);
    let owned: unknown;
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_VALUES) throw new DataError('sdk.invalid_input');
      const keys = Reflect.ownKeys(value);
      if (keys.length !== value.length + 1) throw new DataError('sdk.invalid_input');
      const array: unknown[] = [];
      add(2 + Math.max(0, value.length - 1));
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new DataError('sdk.invalid_input');
        array.push(visit(descriptor.value, depth + 1));
      }
      owned = array;
    } else {
      const fields = plainFields(value), keys = Object.keys(fields);
      if (keys.length > MAX_VALUES - values) throw new DataError('sdk.input_complexity');
      const object: Record<string, unknown> = Object.create(null);
      add(2 + Math.max(0, keys.length - 1));
      for (const key of keys) {
        stringBytes(key, add); add(1);
        const entry = fields[key].value;
        if (DECIMALS.has(key) && typeof entry === 'string' && !isU64(entry)) throw new DataError('sdk.invalid_u64');
        object[key] = visit(entry, depth + 1);
      }
      owned = object;
    }
    active.delete(value);
    return owned;
  };
  try {
    const value = visit(source, 0) as T;
    return { value, json: JSON.stringify(value), bytes };
  } catch (error) {
    if (error instanceof DataError) throw error;
    throw new DataError('sdk.invalid_input');
  }
}

export function freezeData<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
  return value;
}

export function copyInput(input: unknown): Uint8Array {
  try {
    if (!input || Object.getPrototypeOf(input) !== Uint8Array.prototype) throw new DataError('sdk.invalid_input');
    const typed = Object.getPrototypeOf(Uint8Array.prototype);
    const length = Object.getOwnPropertyDescriptor(typed, 'byteLength')!.get!.call(input) as number;
    if (length > HARD_REQUEST_BYTES) throw new DataError('sdk.request_too_large');
    const owned = new Uint8Array(length);
    Uint8Array.prototype.set.call(owned, input as Uint8Array);
    return owned;
  } catch (error) {
    if (error instanceof DataError) throw error;
    throw new DataError('sdk.invalid_input');
  }
}
