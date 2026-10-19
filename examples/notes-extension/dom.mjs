// SPDX-License-Identifier: MIT OR Apache-2.0
/** Independent Notes D0 binding. Generic DOM imports neither Notes nor KWDJ. */
import { defineRendererCatalog } from '@klenwriter/editor-dom';
import { createCommand, sdkBuildId } from '@klenwriter/editor-sdk';
import { notesD0DomInventory } from './dom-inventory.mjs';

const prefix = 'org.example.notes/';
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const closed = (v, keys) => object(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const refuse = (phase, stamp = null, node = null) => ({ status: 'dom_refused', diagnostic: {
  code: phase === 'command' ? 'dom.command_unsupported' : 'dom.presentation_unsupported', phase,
  stamp, node: node?.id ?? null, typeId: node?.type_id ?? null, publication: 'none',
} });
const result = defineRendererCatalog({
  binding: { buildId: sdkBuildId, profile: notesD0DomInventory.profile, registryDigest: notesD0DomInventory.registryDigest },
  inventory: {
    nodes: notesD0DomInventory.inventory.nodes.map(({ id, owner, primitive, attributes }) => ({ id, owner, primitive, attributes })),
    marks: [], commands: notesD0DomInventory.inventory.commands,
  },
  nodes: {
    [`${prefix}document`]: { primitive: 'container', attributes: ['title', 'tags'], present: node => {
      const { title, tags } = node.attributes;
      if (title?.kind !== 'string' || title.value.length > 256 || tags?.kind !== 'list' || tags.value.length > 16
        || tags.value.some(t => t.kind !== 'string' || t.value.length > 64)) return refuse('render', node.stamp, node);
      return { tag: 'section', attributes: { role: 'document', title: title.value, 'aria-label': tags.value.map(t => t.value).join(', ') } };
    } },
    [`${prefix}paragraph`]: { primitive: 'text_block', attributes: [], present: () => ({ tag: 'p' }) },
    [`${prefix}text`]: { primitive: 'text', attributes: [], present: () => ({ tag: 'span' }) },
    [`${prefix}hard_break`]: { primitive: 'hard_break', attributes: [], present: () => ({ tag: 'br' }) },
  },
  marks: {},
  commandGate: request => {
    const failure = () => refuse('command', request.stamp ?? null);
    if (request.kind === 'set_stored_marks') return request.marks === null || Array.isArray(request.marks) && request.marks.length === 0 ? null : failure();
    if (request.kind !== 'command' && request.kind !== 'query_command') return [
      'query_history', 'history', 'set_selection', 'barrier', 'snapshot', 'acknowledge_snapshot', 'reconcile_snapshot', 'release_snapshot',
    ].includes(request.kind) ? null : failure();
    const { id, payload_json: json } = request.command;
    if (!notesD0DomInventory.inventory.commands.includes(id) || typeof json !== 'string' || json.length > 2097152) return failure();
    try {
      const payload = JSON.parse(json);
      if (id === `${prefix}command/insert-text`) return closed(payload, ['text']) && typeof payload.text === 'string' ? null : failure();
      if (id === `${prefix}command/set-title`) return closed(payload, ['title']) && typeof payload.title === 'string' && payload.title.length <= 256 ? null : failure();
      return id === `${prefix}command/set-tags` && closed(payload, ['tags']) && Array.isArray(payload.tags) && payload.tags.length <= 16
        && payload.tags.every(v => typeof v === 'string' && v.length <= 64) ? null : failure();
    } catch { return failure(); }
  },
  input: { insertText: text => createCommand(`${prefix}command/insert-text`, { text }) },
});
if ('status' in result) throw new Error('Invalid shipped Notes D0 renderer catalog');
export const notesD0Renderers = result;
