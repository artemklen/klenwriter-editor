// SPDX-License-Identifier: MIT OR Apache-2.0
import type { SdkResponse, SdkResponseV2 } from '@klenwriter/editor-wasm';
import { DataError, freezeData, isU64, ownData } from './data.js';

type Check = (value: unknown) => boolean;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text: Check = value => typeof value === 'string';
const bool: Check = value => typeof value === 'boolean';
const size: Check = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff;
const nullable = (check: Check): Check => value => value === null || check(value);
const list = (check: Check): Check => value => Array.isArray(value) && value.every(check);
const literal = (...values: string[]): Check => value => typeof value === 'string' && values.includes(value);
const shape = (value: unknown, fields: Record<string, Check>): boolean => object(value)
  && Object.keys(value).length === Object.keys(fields).length
  && Object.entries(fields).every(([key, check]) => Object.hasOwn(value, key) && check(value[key]));
const dictionary = (check: Check): Check => value => object(value) && Object.values(value).every(check);

const stamp: Check = value => shape(value, { session: text, generation: isU64, revision: isU64, selection_epoch: isU64, history_epoch: isU64 });
const position: Check = value => object(value) && (value.kind === 'text'
  ? shape(value, { kind: literal('text'), node: text, offset: size, affinity: literal('before', 'after') })
  : value.kind === 'child'
    ? shape(value, { kind: literal('child'), parent: text, index: size, affinity: literal('before', 'after') })
    : shape(value, { kind: literal('edge'), node: text, side: literal('before', 'after') }));
const selection: Check = value => shape(value, { anchor: position, focus: position });
const attribute: Check = value => {
  if (!object(value)) return false;
  switch (value.kind) {
    case 'null': return shape(value, { kind: literal('null') });
    case 'boolean': return shape(value, { kind: literal('boolean'), value: bool });
    case 'number': return shape(value, { kind: literal('number'), value: v => typeof v === 'string' && /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(v) });
    case 'string': return shape(value, { kind: literal('string'), value: text });
    case 'list': return shape(value, { kind: literal('list'), value: list(attribute) });
    case 'object': return shape(value, { kind: literal('object'), value: dictionary(attribute) });
    default: return false;
  }
};
const mark: Check = value => shape(value, { type_id: text, attributes: dictionary(attribute) });
const history: Check = value => shape(value, { undo_entries: isU64, redo_entries: isU64, retained_bytes: isU64 });
const state: Check = value => shape(value, { stamp, root: text, selection: nullable(selection), stored_marks: nullable(list(mark)), dirty: bool, saved_revision: isU64, history });
const diagnostic: Check = value => shape(value, { code: text, path: text, category: text, details: dictionary(text), stamp: nullable(stamp), may_have_committed: bool });
const profile: Check = value => shape(value, { profile_id: text, profile_version: text, codec_id: text, wire_version: size, extensions: list(v => shape(v, { id: text, version: text })) });
const resources: Check = value => shape(value, { sessions: size, snapshot_handles: size, snapshot_bytes: isU64, protected_cursors: size });
const presentation: Check = value => shape(value, { active: text });
const impact: Check = value => shape(value, { upserted: list(text), removed: list(text), ancestors_before: list(text), ancestors_after: list(text), root_order_changed: bool });
const change: Check = value => object(value) && (value.kind === 'document'
  ? shape(value, { kind: literal('document'), impact, from_revision: isU64, to_revision: isU64 })
  : shape(value, { kind: literal('state'), selection_changed: bool, stored_marks_changed: bool, history_changed: bool, baseline_changed: bool }));
const event: Check = value => shape(value, { sequence: isU64, before: stamp, after: stamp, selection_before: nullable(selection), selection_after: nullable(selection), stored_marks_before: nullable(list(mark)), stored_marks_after: nullable(list(mark)), dirty_before: bool, dirty_after: bool, history, change });
const node: Check = value => shape(value, { stamp, id: text, parent: nullable(text), type_id: text, primitive: text, attributes: dictionary(attribute), marks: list(mark), text: nullable(text), children: list(text), changed_revision: isU64, stats: v => shape(v, { authored_nodes: isU64, text_utf8: isU64, text_utf16: isU64, height: isU64 }) });

const reply: Check = value => {
  if (!object(value)) return false;
  switch (value.kind) {
    case 'state': return shape(value, { kind: literal('state'), state });
    case 'catalog': return shape(value, { kind: literal('catalog'), commands: list(text) });
    case 'node': return shape(value, { kind: literal('node'), node });
    case 'availability': return shape(value, { kind: literal('availability'), available: bool, effect: nullable(text), presentation: nullable(presentation), diagnostic: nullable(diagnostic) });
    case 'mutation': return shape(value, { kind: literal('mutation'), effect: text, state, presentation: nullable(presentation) });
    case 'snapshot': return shape(value, { kind: literal('snapshot'), handle: text, canonical_json: text, stamp, profile, event_sequence: isU64 });
    case 'released': return shape(value, { kind: literal('released') });
    case 'mapped': return shape(value, { kind: literal('mapped'), status: text, position: nullable(position), deleted: bool, stamp });
    case 'events': return shape(value, { kind: literal('events'), events: list(event), cursor: text, gap: bool });
    case 'resources': return shape(value, { kind: literal('resources'), resources });
    case 'destroyed': return shape(value, { kind: literal('destroyed') });
    default: return false;
  }
};

/** Checks the entire owned response tree; native semantics remain Rust-owned. */
export function decodeResponse(raw: string): SdkResponse {
  try {
    if (typeof raw !== 'string' || raw.length > 128 * 1024 * 1024) throw new DataError('sdk.invalid_response');
    const parsed: unknown = JSON.parse(raw);
    const value = ownData(parsed, 256 * 1024 * 1024).value;
    if (!object(value) || !(value.status === 'ok'
      ? shape(value, { status: literal('ok'), value: reply })
      : shape(value, { status: literal('refused', 'fatal'), diagnostic }))) throw new DataError('sdk.invalid_response');
    return freezeData(value) as SdkResponse;
  } catch { throw new DataError('sdk.invalid_response'); }
}

const SELECTION_TEXT_BYTES = 1024 * 1024;
const SELECTION_REPLY_BYTES = 8 * 1024 * 1024;
const selectionText: Check = value => shape(value, {
  kind: literal('selection_text'), stamp, selection,
  projection_id: v => typeof v === 'string' && v.length > 0 && v.length <= 1024,
  text: v => typeof v === 'string' && v.length <= SELECTION_TEXT_BYTES && new TextEncoder().encode(v).byteLength <= SELECTION_TEXT_BYTES,
  empty: bool,
  selected_atoms: v => Array.isArray(v) && v.length <= 4096 && v.every(id => typeof id === 'string' && id.length > 0 && id.length <= 256)
    && new Set(v).size === v.length,
}) && object(value) && (value.empty !== true || value.text === '' && Array.isArray(value.selected_atoms) && value.selected_atoms.length === 0);

const TEXT_WINDOW_REPLY_BYTES = 256 * 1024;
const scalarText = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
};
const token: Check = value => scalarText(value) && value.length > 0 && value.length <= 256;
const windowNode: Check = value => shape(value, { node: token, type_id: v => scalarText(v) && v.length > 0, primitive: literal('text_block', 'container') });
const windowSpan: Check = value => shape(value, { node: token, from_utf16: size, to_utf16: size, text: scalarText })
  && object(value) && typeof value.from_utf16 === 'number' && typeof value.to_utf16 === 'number'
  && typeof value.text === 'string' && value.text.length > 0 && value.to_utf16 > value.from_utf16
  && value.to_utf16 - value.from_utf16 === value.text.length;
const windowBoundary: Check = literal('block', 'inline_atom', 'hard_break', 'window_limit');
const textWindow: Check = value => {
  if (!shape(value, { kind: literal('text_window'), stamp, selection, block: windowNode, caret: position,
    ancestors: v => Array.isArray(v) && v.length <= 126 && v.every(windowNode),
    before: v => Array.isArray(v) && v.length <= 256 && v.every(windowSpan),
    after: v => Array.isArray(v) && v.length <= 256 && v.every(windowSpan),
    before_stop: windowBoundary, after_stop: windowBoundary }) || !object(value)) return false;
  const block = value.block as Record<string, unknown>, caret = value.caret as Record<string, unknown>;
  const selected = value.selection as { anchor: Record<string, unknown>; focus: Record<string, unknown> };
  const before = value.before as {node: string; from_utf16: number; to_utf16: number; text: string}[];
  const after = value.after as typeof before;
  const ancestors = value.ancestors as Record<string, unknown>[];
  if (block.primitive !== 'text_block' || ancestors.some(n => n.primitive !== 'container')
    || new Set([block.node, ...ancestors.map(n => n.node)]).size !== ancestors.length + 1
    || !Object.keys(caret).every(key => caret[key] === selected.focus[key])) return false;
  const total = [...before, ...after].reduce((n, span) => n + span.text.length, 0);
  if (total > 256 || [before, after].some(spans => new Set(spans.map(s => s.node)).size !== spans.length)
    || [...before, ...after].some(s => s.node === block.node || ancestors.some(n => n.node === s.node))) return false;
  if (caret.kind === 'child') return selected.anchor.kind === 'child' && selected.anchor.parent === caret.parent
    && selected.anchor.index === caret.index && caret.parent === block.node && caret.index === 0
    && before.length === 0 && after.length === 0 && value.before_stop === 'block' && value.after_stop === 'block';
  if (ancestors.length > 125 || caret.node === block.node || ancestors.some(n => n.node === caret.node)
    || caret.kind !== 'text' || !token(caret.node) || selected.anchor.kind !== 'text'
    || selected.anchor.node !== caret.node || selected.anchor.offset !== caret.offset) return false;
  if (before.some((s, i) => s.node === caret.node && (i !== before.length - 1 || s.to_utf16 !== caret.offset))
    || after.some((s, i) => s.node === caret.node && (i !== 0 || s.from_utf16 !== caret.offset))) return false;
  return before.every(a => after.every(b => a.node !== b.node || a.node === caret.node));
};

const utf8Bound = (maximum: number): Check => value => scalarText(value) && value.length <= maximum
  && new TextEncoder().encode(value).byteLength <= maximum;
const clipboardContext: Check = value => shape(value, {
  kind: literal('clipboard_context'), stamp, selection, format_id: token, context_json: utf8Bound(4096),
});
const selectionFragment: Check = value => shape(value, {
  kind: literal('selection_fragment'), stamp, selection, format_id: token,
  fragment_json: utf8Bound(2 * 1024 * 1024), empty: bool,
});
/** ABI2 bounded pure replies; legacy decoder and command tickets stay closed. */
export function decodeResponseV2(raw: string, expectedKind?: 'selection_text' | 'text_window' | 'clipboard_context' | 'selection_fragment'): SdkResponseV2 {
  try {
    const maximum = expectedKind === 'text_window' ? TEXT_WINDOW_REPLY_BYTES : expectedKind === 'clipboard_context' ? 64 * 1024 : expectedKind === 'selection_fragment' ? 16 * 1024 * 1024 : SELECTION_REPLY_BYTES;
    if (typeof raw !== 'string' || raw.length > maximum || new TextEncoder().encode(raw).byteLength > maximum) throw new DataError('sdk.invalid_response');
    const parsed: unknown = JSON.parse(raw);
    const value = ownData(parsed, 16 * 1024 * 1024).value;
    if (!object(value) || !(value.status === 'ok'
      ? shape(value, { status: literal('ok'), value: v => reply(v) || selectionText(v) || textWindow(v) || clipboardContext(v) || selectionFragment(v) })
      : shape(value, { status: literal('refused', 'fatal'), diagnostic }))) throw new DataError('sdk.invalid_response');
    if (value.status === 'ok' && object(value.value) && value.value.kind === 'text_window'
      && new TextEncoder().encode(raw).byteLength > TEXT_WINDOW_REPLY_BYTES) throw new DataError('sdk.invalid_response');
    return freezeData(value) as SdkResponseV2;
  } catch { throw new DataError('sdk.invalid_response'); }
}
