// SPDX-License-Identifier: MIT OR Apache-2.0
/** Adapter configuration ownership, not a model/semantic serializer. */
const MAX_BYTES = 16 * 1024 * 1024;
export function ownInput(input: Uint8Array): Uint8Array {
  if (!input || Object.getPrototypeOf(input) !== Uint8Array.prototype) throw new TypeError('dom.invalid_options');
  const getter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!;
  const length = getter.call(input) as number;
  if (length > MAX_BYTES) throw new TypeError('dom.invalid_options');
  const copy = new Uint8Array(length); Uint8Array.prototype.set.call(copy, input); return copy;
}
export function fields(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new TypeError('dom.invalid_options');
  const out: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (typeof key !== 'string' || !descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new TypeError('dom.invalid_options');
    out[key] = descriptor.value;
  }
  return out;
}
export function ownConfiguration<T>(input: T): T {
  let count = 0, bytes = 0;
  const active = new Set<object>();
  const charge = (n: number) => { bytes += n; if (bytes > MAX_BYTES) throw new TypeError('dom.invalid_options'); };
  const text = (s: string) => {
    charge(2);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) { const next = s.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('dom.invalid_options'); charge(4); }
      else if (c >= 0xdc00 && c <= 0xdfff) throw new TypeError('dom.invalid_options');
      else charge(c < 32 ? 6 : c === 34 || c === 92 ? 2 : c < 128 ? 1 : c < 2048 ? 2 : 3);
    }
  };
  const visit = (value: unknown, depth: number): unknown => {
    if (++count > 262144 || depth > 64) throw new TypeError('dom.invalid_options');
    if (value === null) { charge(4); return null; }
    if (typeof value === 'string') { text(value); return value; }
    if (typeof value === 'boolean') { charge(5); return value; }
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)) { charge(20); return value; }
    if (typeof value !== 'object' || active.has(value)) throw new TypeError('dom.invalid_options');
    active.add(value); charge(2);
    let result: unknown;
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 262144 || Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError('dom.invalid_options');
      const array: unknown[] = [];
      for (let i = 0; i < value.length; i++) { const d = Object.getOwnPropertyDescriptor(value, String(i)); if (!d || !('value' in d)) throw new TypeError('dom.invalid_options'); charge(1); array.push(visit(d.value, depth + 1)); }
      result = Object.freeze(array);
    } else {
      const object: Record<string, unknown> = Object.create(null);
      for (const [key, child] of Object.entries(fields(value))) { text(key); charge(2); object[key] = visit(child, depth + 1); }
      result = Object.freeze(object);
    }
    active.delete(value); return result;
  };
  return visit(input, 0) as T;
}
