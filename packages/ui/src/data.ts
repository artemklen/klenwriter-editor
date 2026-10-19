// SPDX-License-Identifier: MIT OR Apache-2.0
import type { CommandDto } from '@klenwriter/editor-sdk';
import type { UiActionContext, UiCloseReason, UiHostAction, UiJson, UiText, UiUnavailable } from './types.js';

export class UiError extends Error {
  constructor(readonly code: 'ui.invalid_options' | 'ui.callback_failed' | 'ui.limit') { super(code); }
}
export function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UiError('ui.invalid_options');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new UiError('ui.invalid_options');
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = Object.create(null);
  if (Reflect.ownKeys(value).some(k => typeof k !== 'string' || ![...required, ...optional].includes(k))) throw new UiError('ui.invalid_options');
  for (const name of required) if (!Object.hasOwn(descriptors, name)) throw new UiError('ui.invalid_options');
  for (const [name, descriptor] of Object.entries(descriptors)) {
    if (!('value' in descriptor) || !descriptor.enumerable) throw new UiError('ui.invalid_options');
    result[name] = descriptor.value;
  }
  return result;
}
export function element(value: unknown): value is HTMLElement {
  try {
    const node = value as HTMLElement;
    const constructor = node?.ownerDocument?.defaultView?.HTMLElement;
    return !!constructor && node instanceof constructor;
  } catch { return false; }
}
export function id(value: unknown): string {
  if (typeof value !== 'string' || !value.length) throw new UiError('ui.invalid_options');
  if (value.length > 128) throw new UiError('ui.limit');
  return value;
}
export function text(value: unknown): UiText {
  const f = fields(value, ['ru', 'en']);
  if (typeof f.ru !== 'string' || typeof f.en !== 'string' || !f.ru.trim() || !f.en.trim()) throw new UiError('ui.invalid_options');
  if (f.ru.length > 256 || f.en.length > 256) throw new UiError('ui.limit');
  return Object.freeze({ ru: f.ru, en: f.en });
}
export function list(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new UiError('ui.invalid_options');
  if (value.length > 32) throw new UiError('ui.limit');
  const descriptors = Object.getOwnPropertyDescriptors(value), result: unknown[] = [];
  if (Reflect.ownKeys(value).some(k => typeof k !== 'string' || k !== 'length' && !/^(0|[1-9][0-9]*)$/.test(k))) throw new UiError('ui.invalid_options');
  for (let i = 0; i < value.length; i++) {
    const d = descriptors[String(i)];
    if (!d || !('value' in d)) throw new UiError('ui.invalid_options');
    result.push(d.value);
  }
  return Object.freeze(result);
}
export function unavailable(value: unknown): UiUnavailable | null {
  if (!value || typeof value !== 'object' || Object.getOwnPropertyDescriptor(value, 'status')?.value !== 'unavailable') return null;
  const f = fields(value, ['status', 'code', 'message']);
  if (typeof f.code !== 'string' || !f.code.length) throw new UiError('ui.invalid_options');
  if (f.code.length > 256) throw new UiError('ui.limit');
  return Object.freeze({ status: 'unavailable', code: f.code, message: text(f.message) });
}
export function command(value: unknown): CommandDto {
  const f = fields(value, ['id', 'payload_json']);
  if (typeof f.id !== 'string' || !f.id.length || typeof f.payload_json !== 'string') throw new UiError('ui.callback_failed');
  if (f.id.length > 128 || f.payload_json.length > 2097152 || new TextEncoder().encode(f.payload_json).length > 2097152) throw new UiError('ui.limit');
  JSON.parse(f.payload_json);
  return Object.freeze({ id: f.id, payload_json: f.payload_json });
}
export function json(value: unknown): UiJson {
  let count = 0, stringBytes = 0;
  const active = new Set<object>(), encoder = new TextEncoder();
  const charge = (s: string) => {
    if (s.length > 65536 || (stringBytes += encoder.encode(s).length) > 65536) throw new UiError('ui.limit');
  };
  const visit = (v: unknown, depth: number): UiJson => {
    if (++count > 4096 || depth > 32) throw new UiError('ui.limit');
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'string') { charge(v); return v; }
    if (typeof v === 'number') { if (!Number.isFinite(v)) throw new UiError('ui.invalid_options'); return v; }
    if (!v || typeof v !== 'object' || active.has(v)) throw new UiError('ui.invalid_options');
    active.add(v);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(v);
      if (Array.isArray(v)) {
        if (v.length > 4096) throw new UiError('ui.limit');
        if (Reflect.ownKeys(v).some(k => typeof k !== 'string' || k !== 'length' && !/^(0|[1-9][0-9]*)$/.test(k))) throw new UiError('ui.invalid_options');
        const result: UiJson[] = [];
        for (let i = 0; i < v.length; i++) {
          const d = descriptors[String(i)]; if (!d || !('value' in d)) throw new UiError('ui.invalid_options');
          result.push(visit(d.value, depth + 1));
        }
        return Object.freeze(result);
      }
      if (![Object.prototype, null].includes(Object.getPrototypeOf(v))) throw new UiError('ui.invalid_options');
      if (Reflect.ownKeys(v).some(k => typeof k !== 'string')) throw new UiError('ui.invalid_options');
      const result: Record<string, UiJson> = Object.create(null);
      for (const [name, d] of Object.entries(descriptors)) {
        if (!('value' in d) || !d.enumerable) throw new UiError('ui.invalid_options');
        charge(name); result[name] = visit(d.value, depth + 1);
      }
      return Object.freeze(result);
    } finally { active.delete(v); }
  };
  const result = visit(value, 0);
  if (encoder.encode(JSON.stringify(result)).length > 65536) throw new UiError('ui.limit');
  return result;
}

export interface HostDefinition {
  readonly scope: HTMLElement;
  readonly open: (connection: { readonly context: UiActionContext; readonly signal: AbortSignal; accept(value: UiJson): void; cancel(): void }) => (reason: UiCloseReason) => void;
  readonly command: (context: UiActionContext, result: UiJson) => CommandDto | UiUnavailable;
}
const hosts = new WeakMap<UiHostAction, HostDefinition>();
export function host(action: UiHostAction): HostDefinition | undefined { return hosts.get(action); }
export function defineUiHostAction<T extends UiJson>(options: {
  readonly id: string; readonly label: UiText; readonly scope: HTMLElement;
  readonly open: (connection: { readonly context: UiActionContext; readonly signal: AbortSignal; accept(value: T): void; cancel(): void }) => (reason: UiCloseReason) => void;
  readonly command: (captured: UiActionContext, result: T) => CommandDto | UiUnavailable;
}): UiHostAction {
  try {
    const f = fields(options, ['id', 'label', 'scope', 'open', 'command']);
    if (!element(f.scope) || !f.scope.isConnected || typeof f.open !== 'function' || typeof f.command !== 'function') throw new TypeError();
    const action = Object.freeze({ kind: 'host' as const, id: id(f.id), label: text(f.label), __uiHostAction: Symbol('ui-host-action') }) as UiHostAction;
    hosts.set(action, Object.freeze({ scope: f.scope, open: f.open as HostDefinition['open'], command: f.command as HostDefinition['command'] }));
    return action;
  } catch { throw new TypeError('ui.invalid_options'); }
}
