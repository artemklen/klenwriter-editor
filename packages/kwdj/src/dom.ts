// SPDX-License-Identifier: MIT OR Apache-2.0
/** Optional trusted KWDJ presentation. No document semantics live in this module. */
import { defineRendererCatalog } from '@klenwriter/editor-dom';
import type { DomPresentation, DomRefusal, MarkRendererDefinition, MountedMutationV2, NodeRendererDefinition, RendererCatalog } from '@klenwriter/editor-dom';
import { createCommand, sdkBuildId } from '@klenwriter/editor-sdk';
import type { AttributeDto, DeepReadonly, MarkDto, NodeViewDto, QueryRequestV2 } from '@klenwriter/editor-sdk';
import { kwdjCommand, kwdjTypedTextCommand, kwdjRestoreTypedTextCommand } from './index.js';
import { kwdjDomInventory } from './dom-inventory.js';
import { kwdjTypingDomInventory } from './typing-dom-inventory.js';

export { bindKwdjContainerLabel } from './container-label.js';
export type { KwdjContainerLabelOptions } from './container-label.js';
export { runKwdjMediaPicker } from './media-host.js';
export type { KwdjMediaPickerOptions, KwdjMediaTarget } from './media-host.js';
export { runKwdjLinkDialog } from './link-host.js';
export type { KwdjLinkDialogOptions } from './link-host.js';

const prefix = 'org.klenwriter.kwdj/';
const colorTokens = ['muted', 'accent', 'manuscript', 'warning', 'success', 'danger'];
const highlightTokens = ['accent', 'manuscript', 'warning'];
const literaryLabels = new Map([
  ['author_note', 'Заметка автора'],
  ['letter', 'Письмо'],
  ['epigraph', 'Эпиграф'],
  ['world_note', 'Заметка мира'],
  ['chronicle_quote', 'Цитата хроники'],
  ['archive_fragment', 'Архивный фрагмент'],
]);
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const closed = (v: unknown, keys: readonly string[]): v is Record<string, unknown> => object(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const smallString = (v: unknown, maximum = 8192): v is string => typeof v === 'string' && v.length <= maximum;
const warningKind = (v: unknown): v is 'general' | 'content' => v === 'general' || v === 'content';
function refused(typeId: string | null = null, node: DeepReadonly<NodeViewDto> | null = null): DomRefusal {
  return { status: 'dom_refused', diagnostic: { code: 'dom.presentation_unsupported', phase: 'render',
    stamp: node?.stamp ?? null, node: node?.id ?? null, typeId, publication: 'none' } };
}
function commandRefusal(request: DeepReadonly<QueryRequestV2 | MountedMutationV2>): DomRefusal {
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
function tableCell(n: DeepReadonly<NodeViewDto>, tag: 'th' | 'td'): DomPresentation | DomRefusal {
  const attributes: Partial<Record<'colspan' | 'rowspan', string>> = {};
  for (const key of ['colspan', 'rowspan'] as const) {
    const span = n.attributes[key];
    if (span === undefined) continue;
    if (span.kind !== 'number') return refused(n.type_id, n);
    attributes[key] = span.value;
  }
  const classes: string[] = [];
  if (Object.hasOwn(n.attributes, 'align')) {
    const alignment = attrString(n.attributes.align);
    if (alignment !== 'left' && alignment !== 'center' && alignment !== 'right') return refused(n.type_id, n);
    classes.push(`editor-align-${alignment}`);
  }
  return { tag, attributes, classes };
}
const node = (primitive: string, attributes: readonly string[], present: NodeRendererDefinition['present']): NodeRendererDefinition => ({ primitive, attributes, present });
function labeledContainer(fallback: string): NodeRendererDefinition {
  return node('container', ['label'], n => {
    const label = attrString(n.attributes.label);
    if (!label) return refused(n.type_id, n);
    return { tag: 'section', attributes: { role: 'group', 'aria-label': label.trim() ? label : fallback } };
  });
}
const nodes: Record<string, NodeRendererDefinition> = {
  [`${prefix}text`]: node('text', [], () => ({ tag: 'span' })),
  [`${prefix}hard_break`]: node('hard_break', [], () => ({ tag: 'br' })),
  [`${prefix}paragraph`]: { ...node('text_block', ['align', 'first_line_indent'], n => textBlock(n, 'p')), layout: 'plain-text-block' },
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
  [`${prefix}table`]: node('container', [], () => ({ tag: 'table' })),
  [`${prefix}table_row`]: node('container', [], () => ({ tag: 'tr' })),
  [`${prefix}table_header`]: node('container', ['align', 'colspan', 'rowspan'], n => tableCell(n, 'th')),
  [`${prefix}table_cell`]: node('container', ['align', 'colspan', 'rowspan'], n => tableCell(n, 'td')),
  [`${prefix}verse`]: node('container', [], () => ({
    tag: 'div', classes: ['editor-verse'], attributes: { role: 'group', 'aria-label': 'Verse' },
  })),
  [`${prefix}verse_line`]: node('text_block', ['indent'], n => {
    const indent = n.attributes.indent;
    if (indent !== undefined && indent.kind !== 'number') return refused(n.type_id, n);
    return { tag: 'div', classes: ['editor-verse-line'],
      ...(indent === undefined ? {} : { attributes: { 'data-verse-indent': indent.value } }) };
  }),
  [`${prefix}stanza_break`]: node('block_atom', ['blank_lines'], n => {
    const count = n.attributes.blank_lines;
    if (count?.kind !== 'number') return refused(n.type_id, n);
    return { tag: 'div', classes: ['editor-stanza-break'],
      attributes: { role: 'separator', 'aria-label': 'Stanza break', 'data-blank-lines': count.value } };
  }),
  [`${prefix}media_image`]: node('container', ['align', 'alt', 'decorative', 'media_asset_id'], n => {
    const { align, alt, decorative, media_asset_id } = n.attributes;
    const alignment = attrString(align);
    if (!attrString(media_asset_id) || !['none', 'center', 'wide'].includes(alignment ?? '')) return refused(n.type_id, n);
    const classes = ['editor-media-placeholder'];
    if (alignment === 'center' || alignment === 'wide') classes.push(`editor-media-${alignment}`);
    if (alt === undefined && decorative?.kind === 'boolean' && decorative.value) return { tag: 'div', classes };
    const name = attrString(alt);
    if (!name || decorative !== undefined) return refused(n.type_id, n);
    return { tag: 'div', classes, attributes: { role: 'group', 'aria-label': name.trim() ? name : 'Media placeholder' } };
  }),
  [`${prefix}literary_block`]: node('container', ['kind'], n => {
    const kind = attrString(n.attributes.kind);
    const label = kind === undefined ? undefined : literaryLabels.get(kind);
    return label === undefined ? refused(n.type_id, n) : { tag: 'section', attributes: { role: 'group', 'aria-label': label } };
  }),
  [`${prefix}warning`]: node('container', ['kind', 'label'], n => {
    const kind = attrString(n.attributes.kind);
    const label = attrString(n.attributes.label);
    if (!warningKind(kind) || (Object.hasOwn(n.attributes, 'label') && !label)) return refused(n.type_id, n);
    const fallback = kind === 'general' ? 'Предупреждение' : 'Контент';
    return { tag: 'section', attributes: { role: 'group', 'aria-label': label?.trim() ? label : fallback } };
  }),
  [`${prefix}spoiler`]: labeledContainer('Спойлер'),
  [`${prefix}disclosure`]: labeledContainer('Подробнее'),
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
/** Finite presentation coverage only; native owns candidate grammar and admission. */
function coveredClipboard(value: unknown): boolean {
  if (!closed(value, ['format_id','source_profile','mode','kind','content','open_start','open_end'])
    || value.format_id !== 'org.klenwriter.kwdj/clipboard-fragment/1' || value.mode !== 'prose'
    || !['inline','blocks'].includes(value.kind as string) || typeof value.open_start !== 'boolean' || typeof value.open_end !== 'boolean'
    || !Array.isArray(value.content) || value.content.length > 8192) return false;
  let count = 0;
  const visit = (node: unknown, depth: number): boolean => {
    if (++count > 8192 || depth > 64 || !object(node) || typeof node.type !== 'string'
      || Object.keys(node).some(k => !['type','attrs','text','marks','content'].includes(k))) return false;
    // These renderers cover document readback. The mounted clipboard subset is separate.
    if (node.type === 'media_image' || node.type === 'literary_block' || node.type === 'warning'
      || node.type === 'spoiler' || node.type === 'disclosure'
      || ['table', 'table_row', 'table_header', 'table_cell'].includes(node.type)) return false;
    const renderer = Object.hasOwn(nodes, prefix + node.type) ? nodes[prefix + node.type] : null;
    if (!renderer) return false;
    const attrs = node.attrs === undefined ? {} : node.attrs;
    if (!object(attrs) || Object.keys(attrs).some(k => !renderer.attributes.includes(k))) return false;
    for (const [key, field] of Object.entries(attrs)) {
      if (key === 'align' && !['left','center','right','justify'].includes(field as string)
        || key === 'first_line_indent' && typeof field !== 'boolean'
        || key === 'level' && (!Number.isInteger(field) || Number(field) < 1 || Number(field) > 6)
        || key === 'language' && !smallString(field)
        || key === 'start' && (!Number.isSafeInteger(field) || !start(String(field)))
        || key === 'checked' && typeof field !== 'boolean') return false;
    }
    if (node.text !== undefined && typeof node.text !== 'string') return false;
    if (node.marks !== undefined && (!Array.isArray(node.marks) || node.marks.length > 128 || node.marks.some(m => {
      if (!object(m) || typeof m.type !== 'string' || Object.keys(m).some(k => !['type','attrs'].includes(k))) return true;
      const a = m.attrs === undefined ? {} : m.attrs;
      if (!object(a) || Object.values(a).some(v => typeof v !== 'string')) return true;
      return !coveredMark({type_id: prefix + m.type, attributes: Object.fromEntries(Object.entries(a).map(([k,v]) => [k,{kind:'string',value:v}]))});
    }))) return false;
    return node.content === undefined || Array.isArray(node.content) && node.content.length <= 8192 && node.content.every(n => visit(n, depth + 1));
  };
  return value.content.every(n => visit(n, 1));
}
function coveredMedia(payload: Record<string, unknown>): boolean {
  const accessibility = payload.accessibility;
  if (!smallString(payload.media_asset_id, 64) || !(closed(accessibility, ['kind']) && accessibility.kind === 'decorative'
    || closed(accessibility, ['kind', 'alt']) && accessibility.kind === 'alt' && smallString(accessibility.alt))) return false;
  return payload.kind === 'insert_media' && closed(payload, ['kind', 'media_asset_id', 'accessibility'])
    || payload.kind === 'replace_media' && closed(payload, ['kind', 'node', 'current_asset_id', 'media_asset_id', 'accessibility'])
      && typeof payload.node === 'string' && smallString(payload.current_asset_id, 64);
}
function coveredCommand(id: string, payload: Record<string, unknown>): boolean {
  const name = id.slice(`${prefix}command/`.length);
  if (!id.startsWith(`${prefix}command/`)) return false;
  if (name === 'media') return coveredMedia(payload);
  if (payload.kind !== name.replaceAll('-', '_')) return false;
  switch (name) {
    case 'enter': case 'shift-enter': case 'delete-backward': case 'delete-forward': case 'unset-link': case 'toggle-quote': case 'dismiss-slash':
      return closed(payload, ['kind']);
    case 'delete-selection':
      return payload.scope === 'profile_body' ? closed(payload, ['kind', 'scope']) : closed(payload, ['kind']);
    case 'merge-cells': return closed(payload, ['kind', 'anchor', 'focus'])
      && smallString(payload.anchor, 128) && smallString(payload.focus, 128);
    case 'split-cell': return closed(payload, ['kind', 'cell']) && smallString(payload.cell, 128);
    case 'move-cell': return closed(payload, ['kind', 'cell', 'target'])
      && smallString(payload.cell, 128) && smallString(payload.target, 128);
    case 'insert-fragment': {
      if (!closed(payload, ['kind','fragment_json']) || payload.kind !== 'insert_fragment' || typeof payload.fragment_json !== 'string' || payload.fragment_json.length > 2_097_152) return false;
      try { return coveredClipboard(JSON.parse(payload.fragment_json)); } catch { return false; }
    }
    case 'insert-text': return closed(payload, ['kind', 'text']) && typeof payload.text === 'string';
    case 'wrap-literary-block': return closed(payload, ['kind', 'literary_kind']) && payload.literary_kind === 'author_note';
    case 'wrap-warning': return closed(payload, ['kind', 'warning_kind']) && warningKind(payload.warning_kind);
    case 'unwrap-literary-block': case 'unwrap-warning': return closed(payload, ['kind', 'node']) && typeof payload.node === 'string';
    case 'set-container-label': return closed(payload, ['kind', 'node', 'label']) && typeof payload.node === 'string' && smallString(payload.label);
    case 'toggle-mark': return closed(payload, ['kind', 'mark']) && coveredMark(payload.mark);
    case 'set-link': return closed(payload, ['kind', 'href', 'title']) && safeHref(payload.href) && (payload.title === null || smallString(payload.title));
    case 'transform-block': return closed(payload, ['kind', 'target']) && coveredTarget(payload.target);
    case 'insert-block': return closed(payload, ['kind', 'target']) && (coveredTarget(payload.target)
      || closed(payload.target, ['kind', 'warning_kind']) && payload.target.kind === 'warning' && warningKind(payload.target.warning_kind));
    case 'toggle-list': return closed(payload, ['kind', 'list']) && coveredList(payload.list);
    case 'insert-row-above': case 'insert-row-below': case 'delete-row':
      return closed(payload, ['kind','row']) && typeof payload.row==='string';
    case 'insert-column-left': case 'insert-column-right': case 'delete-column':
      return closed(payload, ['kind','table','column']) && typeof payload.table==='string'
        && typeof payload.column==='number' && Number.isSafeInteger(payload.column) && payload.column>=0 && payload.column<=0xffffffff;
    case 'set-table-cell-align':
      return closed(payload, ['kind','align']) && (payload.align==='left' || payload.align==='center' || payload.align==='right');
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
function commandGate(request: DeepReadonly<QueryRequestV2 | MountedMutationV2>): DomRefusal | null {
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
    deleteSelection: () => kwdjCommand({ kind: 'delete_selection', scope: 'profile_body' }),
    insertText: text => kwdjCommand({ kind: 'insert_text', text }),
    enter: () => kwdjCommand({ kind: 'enter' }),
    lineBreak: () => kwdjCommand({ kind: 'shift_enter' }),
    deleteBackward: () => createCommand(`${prefix}command/delete-backward`, { kind: 'delete_backward' }),
    deleteForward: () => kwdjCommand({ kind: 'delete_forward' }),
  },
});
if ('status' in result) throw new Error('Invalid shipped KWDJ renderer catalog');
export const kwdjBasicRenderers: RendererCatalog = result;

/** Explicit optional compiled typing inventory; no locale/configuration is captured in JS. */
export function createKwdjTypingRenderers():RendererCatalog {
  const typedId=`${prefix}command/insert-typed-text`,restoreId=`${prefix}command/restore-typed-text`;
  const gate=(request:DeepReadonly<QueryRequestV2|MountedMutationV2>):DomRefusal|null=>{
    if(request.kind!=='input_command'&&request.kind!=='query_input_command')return commandGate(request);
    const {command}=request;
    if(![typedId,restoreId].includes(command.id)||typeof command.payload_json!=='string'||command.payload_json.length>2097152)return commandRefusal(request);
    try{
      const payload:unknown=JSON.parse(command.payload_json);
      if(command.id===typedId)return closed(payload,['kind','text','origin'])&&payload.kind==='insert_typed_text'
        &&typeof payload.text==='string'&&['ordinary_insert_text','composition_commit'].includes(payload.origin as string)?null:commandRefusal(request);
      return closed(payload,['kind','restore'])&&payload.kind==='restore_typed_text'&&object(payload.restore)
        &&payload.restore.format_id==='org.klenwriter.editor/raw-input-restore/1'
        &&new TextEncoder().encode(JSON.stringify(payload.restore)).byteLength<=4096?null:commandRefusal(request);
    }catch{return commandRefusal(request);}
  };
  const catalog=defineRendererCatalog({
    binding:{buildId:sdkBuildId,profile:kwdjTypingDomInventory.profile,registryDigest:kwdjTypingDomInventory.registryDigest},
    inventory:{nodes:kwdjTypingDomInventory.inventory.nodes.map(({id,owner,primitive,attributes})=>({id,owner,primitive,attributes})),
      marks:kwdjTypingDomInventory.inventory.marks.map(({id,owner,attributes})=>({id,owner,attributes})),commands:kwdjTypingDomInventory.inventory.commands},
    nodes,marks,commandGate:gate,input:{...kwdjBasicRenderers.definition.input,insertTypedText:data=>kwdjTypedTextCommand(data.text,data.origin),restoreTypedText:kwdjRestoreTypedTextCommand},
  });
  if('status'in catalog)throw new Error('Invalid shipped KWDJ typing renderer catalog');
  return catalog;
}
