// SPDX-License-Identifier: MIT OR Apache-2.0
/** Optional trusted KWDJ presentation. No document semantics live in this module. */
import { defineRendererCatalog } from '@klenwriter/editor-dom';
import type { DomPresentation, DomRefusal, MarkRendererDefinition, MountedMutation, NodeRendererDefinition, RendererCatalog } from '@klenwriter/editor-dom';
import { createCommand, sdkBuildId } from '@klenwriter/editor-sdk';
import type { AttributeDto, DeepReadonly, MarkDto, NodeViewDto, QueryRequest } from '@klenwriter/editor-sdk';
import { kwdjCommand } from './index.js';
import { kwdjDomInventory } from './dom-inventory.js';

const prefix = 'org.klenwriter.kwdj/';
const colorTokens = ['muted', 'accent', 'manuscript', 'warning', 'success', 'danger'];
const highlightTokens = ['accent', 'manuscript', 'warning'];
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const closed = (v: unknown, keys: readonly string[]): v is Record<string, unknown> => object(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const smallString = (v: unknown, maximum = 8192): v is string => typeof v === 'string' && v.length <= maximum;
function refused(typeId: string | null = null, node: DeepReadonly<NodeViewDto> | null = null): DomRefusal {
  return { status: 'dom_refused', diagnostic: { code: 'dom.presentation_unsupported', phase: 'render',
    stamp: node?.stamp ?? null, node: node?.id ?? null, typeId, publication: 'none' } };
}
function commandRefusal(request: DeepReadonly<QueryRequest | MountedMutation>): DomRefusal {
  return { status: 'dom_refused', diagnostic: { code: 'dom.command_unsupported', phase: 'command',
    stamp: 'stamp' in request ? request.stamp : null, node: null, typeId: null, publication: 'none' } };
}
function attrString(v: DeepReadonly<AttributeDto> | undefined): string | undefined {
  return v?.kind === 'string' && smallString(v.value) ? v.value : undefined;
}
function safeHref(value: unknown): value is string {
  // This finite presentation policy is deliberately narrower than native URL validation.
  // Native validation remains authoritative; no URL is resolved or fetched here.
  return smallString(value) && !/[\u0000-\u0020\u007f\\]/u.test(value)
    && (/^https?:\/\//i.test(value) || /^\/(?!\/)/.test(value));
}
function start(value: unknown): value is string {
  // HTML's signed long presentation cannot faithfully represent every native u64.
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,9})$/.test(value) && BigInt(value) <= 2147483647n;
}
function textBlock(node: DeepReadonly<NodeViewDto>, tag: DomPresentation['tag']): DomPresentation | DomRefusal {
  const classes: string[] = [];
  if (Object.hasOwn(node.attributes, 'align')) {
    const align = attrString(node.attributes.align);
    if (align === undefined || !['left', 'center', 'right', 'justify'].includes(align)) return refused(node.type_id, node);
    classes.push(`editor-align-${align}`);
  }
  if (Object.hasOwn(node.attributes, 'first_line_indent')) {
    const indent = node.attributes.first_line_indent;
    if (indent.kind !== 'boolean') return refused(node.type_id, node);
    if (indent.value) classes.push('editor-first-line-indent');
  }
  return { tag, classes };
}
const node = (primitive: string, attributes: readonly string[], present: NodeRendererDefinition['present']): NodeRendererDefinition => ({ primitive, attributes, present });
const nodes: Record<string, NodeRendererDefinition> = {
  [`${prefix}text`]: node('text', [], () => ({ tag: 'span' })),
  [`${prefix}hard_break`]: node('hard_break', [], () => ({ tag: 'br' })),
  [`${prefix}paragraph`]: node('text_block', ['align', 'first_line_indent'], n => textBlock(n, 'p')),
  [`${prefix}heading`]: node('text_block', ['align', 'first_line_indent', 'level'], n => {
    const level = n.attributes.level;
    return level?.kind === 'number' && /^[1-6]$/.test(level.value)
      ? textBlock(n, `h${level.value}` as DomPresentation['tag']) : refused(n.type_id, n);
  }),
  [`${prefix}code_block`]: node('text_block', ['language'], n => {
    if (!Object.hasOwn(n.attributes, 'language')) return { tag: 'pre' };
    const language = attrString(n.attributes.language);
    return language === undefined ? refused(n.type_id, n) : { tag: 'pre', attributes: { title: language } };
  }),
  [`${prefix}blockquote`]: node('container', [], () => ({ tag: 'blockquote' })),
  [`${prefix}bullet_list`]: node('container', [], () => ({ tag: 'ul' })),
  [`${prefix}ordered_list`]: node('container', ['start'], n => {
    if (!Object.hasOwn(n.attributes, 'start')) return { tag: 'ol' };
    const value = n.attributes.start;
    return value.kind === 'number' && start(value.value) ? { tag: 'ol', attributes: { start: value.value } } : refused(n.type_id, n);
  }),
  [`${prefix}list_item`]: node('container', [], () => ({ tag: 'li' })),
  [`${prefix}task_list`]: node('container', [], () => ({ tag: 'ul', classes: ['editor-task-list'] })),
  [`${prefix}task_item`]: node('container', ['checked'], n => {
    const checked = n.attributes.checked;
    return checked?.kind === 'boolean' ? { tag: 'li', classes: ['editor-task-item', ...(checked.value ? ['editor-checked'] : [])],
      attributes: { title: checked.value ? 'Completed task' : 'Incomplete task' } } : refused(n.type_id, n);
  }),
  [`${prefix}scene_break`]: node('block_atom', [], () => ({ tag: 'hr', classes: ['editor-scene-break'], attributes: { role: 'separator', 'aria-label': 'Scene break' } })),
};
const marks: Record<string, MarkRendererDefinition> = {};
for (const [name, tag] of [['strong', 'strong'], ['emphasis', 'em'], ['strike', 's'], ['code', 'code'], ['subscript', 'sub'], ['superscript', 'sup']] as const) {
  marks[`${prefix}${name}`] = { attributes: [], present: () => ({ tag }) };
}
for (const [name, tokens, classPrefix] of [['text_color', colorTokens, 'editor-color-'], ['highlight', highlightTokens, 'editor-highlight-']] as const) {
  marks[`${prefix}${name}`] = { attributes: ['token'], present: m => {
    const token = attrString(m.attributes.token);
    return token !== undefined && tokens.includes(token) ? { tag: 'span', classes: [`${classPrefix}${token}`] } : refused(m.type_id);
  } };
}
marks[`${prefix}link`] = { attributes: ['href', 'title'], present: m => {
  const href = attrString(m.attributes.href), title = attrString(m.attributes.title);
  if (!safeHref(href) || (Object.hasOwn(m.attributes, 'title') && title === undefined)) return refused(m.type_id);
  return { tag: 'a', attributes: title === undefined ? { href } : { href, title } };
} };

function coveredMark(value: unknown): boolean {
  if (!closed(value, ['type_id', 'attributes']) || typeof value.type_id !== 'string' || !object(value.attributes)) return false;
  const renderer = Object.hasOwn(marks, value.type_id) ? marks[value.type_id] : undefined;
  if (!renderer || Object.keys(value.attributes).some(k => !renderer.attributes.includes(k))) return false;
  const result = renderer.present(value as unknown as DeepReadonly<MarkDto>);
  return !('status' in result);
}
function coveredTarget(value: unknown): boolean {
  if (!object(value) || typeof value.kind !== 'string') return false;
  if (['paragraph', 'blockquote', 'bullet_list', 'task_list', 'scene_break'].includes(value.kind)) return closed(value, ['kind']);
  if (value.kind === 'heading') return closed(value, ['kind', 'level']) && Number.isInteger(value.level) && Number(value.level) >= 1 && Number(value.level) <= 6;
  if (value.kind === 'code_block') return closed(value, ['kind', 'language']) && (value.language === null || smallString(value.language));
  return value.kind === 'ordered_list' && closed(value, ['kind', 'start']) && start(value.start);
}
function coveredList(value: unknown): boolean {
  return object(value) && (['bullet', 'task'].includes(String(value.kind)) ? closed(value, ['kind'])
    : value.kind === 'ordered' && closed(value, ['kind', 'start']) && start(value.start));
}
function coveredCommand(id: string, payload: Record<string, unknown>): boolean {
  const name = id.slice(`${prefix}command/`.length);
  if (!id.startsWith(`${prefix}command/`) || payload.kind !== name.replaceAll('-', '_')) return false;
  switch (name) {
    case 'enter': case 'shift-enter': case 'delete-backward': case 'delete-selection': case 'unset-link': case 'toggle-quote': case 'dismiss-slash':
      return closed(payload, ['kind']);
    case 'insert-text': return closed(payload, ['kind', 'text']) && typeof payload.text === 'string';
    case 'toggle-mark': return closed(payload, ['kind', 'mark']) && coveredMark(payload.mark);
    case 'set-link': return closed(payload, ['kind', 'href', 'title']) && safeHref(payload.href) && (payload.title === null || smallString(payload.title));
    case 'transform-block': case 'insert-block': return closed(payload, ['kind', 'target']) && coveredTarget(payload.target);
    case 'toggle-list': return closed(payload, ['kind', 'list']) && coveredList(payload.list);
    case 'move': return closed(payload, ['kind', 'node', 'parent', 'before_index']);
    case 'duplicate': return closed(payload, ['kind', 'node', 'parent', 'index']);
    case 'remove': return closed(payload, ['kind', 'node']);
    case 'accept-slash': return closed(payload, ['kind', 'target', 'range', 'literal']) && coveredTarget(payload.target);
    default: return false;
  }
}
/**
 * Closed output coverage: starting with admitted nodes/marks, insert/Enter/delete
 * preserve those kinds, structural targets are checked here, and native KWDJ
 * normalization creates only paragraph/text/hard_break/list primitives in this
 * subset. Move/duplicate/remove reuse admitted subtrees. History replays only
 * these admitted states; successful explicit replacement starts a new history.
 * This proves type/closed-attribute/target coverage, not all derived value domains:
 * for example native ordered-list splitting can produce start > signed32. Such a
 * real publication retains native Ok and enters explicit mounted recovery when
 * presentation refuses; this gate must not pretend that native publication failed.
 * Unknown recipes/compositions cannot enter this catalog even if IDs look similar.
 */
function commandGate(request: DeepReadonly<QueryRequest | MountedMutation>): DomRefusal | null {
  if (request.kind === 'set_stored_marks') {
    return request.marks === null || Array.isArray(request.marks) && request.marks.length <= 128 && request.marks.every(coveredMark)
      ? null : commandRefusal(request);
  }
  if (request.kind !== 'command' && request.kind !== 'query_command') {
    return ['query_history', 'history', 'set_selection', 'barrier', 'snapshot', 'acknowledge_snapshot', 'reconcile_snapshot', 'release_snapshot'].includes(request.kind)
      ? null : commandRefusal(request);
  }
  const command = request.command;
  // Bound before JSON.parse; only a closed shallow payload is inspected afterwards.
  if (!kwdjDomInventory.inventory.commands.includes(command.id as typeof kwdjDomInventory.inventory.commands[number])
    || typeof command.payload_json !== 'string' || command.payload_json.length > 2_097_152) return commandRefusal(request);
  try {
    const payload: unknown = JSON.parse(command.payload_json);
    return object(payload) && coveredCommand(command.id, payload) ? null : commandRefusal(request);
  } catch { return commandRefusal(request); }
}
const result = defineRendererCatalog({
  binding: { buildId: sdkBuildId, profile: kwdjDomInventory.profile, registryDigest: kwdjDomInventory.registryDigest },
  inventory: {
    nodes: kwdjDomInventory.inventory.nodes.map(({ id, owner, primitive, attributes }) => ({ id, owner, primitive, attributes })),
    marks: kwdjDomInventory.inventory.marks.map(({ id, owner, attributes }) => ({ id, owner, attributes })),
    commands: kwdjDomInventory.inventory.commands,
  },
  nodes, marks, commandGate,
  input: {
    deleteSelection: () => kwdjCommand({ kind: 'delete_selection' }),
    insertText: text => kwdjCommand({ kind: 'insert_text', text }),
    enter: () => kwdjCommand({ kind: 'enter' }),
    lineBreak: () => kwdjCommand({ kind: 'shift_enter' }),
    deleteBackward: () => createCommand(`${prefix}command/delete-backward`, { kind: 'delete_backward' }),
  },
});
if ('status' in result) throw new Error('Invalid shipped KWDJ renderer catalog');
export const kwdjBasicRenderers: RendererCatalog = result;
