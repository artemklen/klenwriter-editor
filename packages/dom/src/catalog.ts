// SPDX-License-Identifier: MIT OR Apache-2.0
import type { DeepReadonly, NodeViewDto, SessionContextV2 } from '@klenwriter/editor-sdk';
import type { DomDiagnostic, DomPresentation, DomRefusal, RendererCatalog, RendererCatalogDefinition } from './types.js';
import { domRefusal, isDomRefusal } from './refusal.js';

const catalogs = new WeakSet<object>();
const brand: unique symbol = Symbol('editor.rendererCatalog');
const tags = new Set(['span', 'br', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code', 'blockquote', 'ul', 'ol', 'li', 'div', 'section', 'hr', 'strong', 'em', 's', 'sub', 'sup', 'a']);
const attributes = new Set(['href', 'title', 'start', 'role', 'aria-label', 'aria-checked']);
// Classes select static editor CSS only. Authored CSS and arbitrary selectors are absent.
const classes = new Set(['editor-align-left', 'editor-align-center', 'editor-align-right', 'editor-align-justify',
  'editor-first-line-indent', 'editor-task-list', 'editor-task-item', 'editor-checked', 'editor-scene-break',
  'editor-color-muted', 'editor-color-accent', 'editor-color-manuscript', 'editor-color-success', 'editor-color-warning', 'editor-color-danger',
  'editor-highlight-accent', 'editor-highlight-manuscript', 'editor-highlight-warning']);
const own = (value: object, name: string) => Object.prototype.hasOwnProperty.call(value, name);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const stringList = (value: unknown, maximum = 4096): value is readonly string[] => Array.isArray(value) && value.length <= maximum
  && value.every(v => typeof v === 'string' && v.length <= 1024) && new Set(value).size === value.length;
const closed = (value: object, fields: readonly string[]) => Object.keys(value).every(name => fields.includes(name));
function plain(value: unknown): value is Record<string, unknown> {
  if (!object(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null) && Object.values(Object.getOwnPropertyDescriptors(value)).every(d => 'value' in d);
}
function frozenCopy<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map(v => frozenCopy(v))) as T;
  if (object(value)) {
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, child] of Object.entries(value)) result[key] = frozenCopy(child);
    return Object.freeze(result) as T;
  }
  return value;
}
function validDefinition(d: RendererCatalogDefinition): boolean {
  if (!plain(d) || !closed(d, ['binding', 'inventory', 'nodes', 'marks', 'commandGate', 'input']) || !plain(d.binding)
    || !closed(d.binding, ['buildId', 'profile', 'registryDigest']) || typeof d.binding.buildId !== 'string' || d.binding.buildId.length > 256
    || typeof d.binding.registryDigest !== 'string' || d.binding.registryDigest.length > 256 || !plain(d.binding.profile)
    || !closed(d.binding.profile, ['profile_id', 'profile_version', 'codec_id', 'wire_version', 'extensions'])
    || typeof d.binding.profile.profile_id !== 'string' || typeof d.binding.profile.profile_version !== 'string'
    || typeof d.binding.profile.codec_id !== 'string' || !Number.isSafeInteger(d.binding.profile.wire_version)
    || !Array.isArray(d.binding.profile.extensions) || d.binding.profile.extensions.length > 256
    || !d.binding.profile.extensions.every(e => plain(e) && closed(e, ['id', 'version']) && typeof e.id === 'string' && typeof e.version === 'string')
    || !plain(d.inventory) || !closed(d.inventory, ['nodes', 'marks', 'commands'])
    || !Array.isArray(d.inventory.nodes) || d.inventory.nodes.length > 4096 || !Array.isArray(d.inventory.marks) || d.inventory.marks.length > 4096
    || !stringList(d.inventory.commands) || !plain(d.nodes) || !plain(d.marks) || typeof d.commandGate !== 'function') return false;
  const nodeIds = new Set<string>(), markIds = new Set<string>();
  for (const n of d.inventory.nodes) {
    if (!plain(n) || !closed(n, ['id', 'owner', 'primitive', 'attributes']) || typeof n.id !== 'string' || !n.id || n.id.length > 1024
      || typeof n.owner !== 'string' || typeof n.primitive !== 'string' || !stringList(n.attributes, 256) || nodeIds.has(n.id)) return false;
    nodeIds.add(n.id);
  }
  for (const m of d.inventory.marks) {
    if (!plain(m) || !closed(m, ['id', 'owner', 'attributes']) || typeof m.id !== 'string' || !m.id || m.id.length > 1024
      || typeof m.owner !== 'string' || !stringList(m.attributes, 256) || markIds.has(m.id)) return false;
    markIds.add(m.id);
  }
  for (const [id, n] of Object.entries(d.nodes)) {
    const witness = d.inventory.nodes.find(w => w.id === id);
    if (!witness || !plain(n) || !closed(n, ['primitive', 'attributes', 'present']) || n.primitive !== witness.primitive
      || !stringList(n.attributes, 256) || n.attributes.some(a => !witness.attributes.includes(a)) || typeof n.present !== 'function') return false;
  }
  for (const [id, m] of Object.entries(d.marks)) {
    const witness = d.inventory.marks.find(w => w.id === id);
    if (!witness || !plain(m) || !closed(m, ['attributes', 'present']) || !stringList(m.attributes, 256)
      || m.attributes.some(a => !witness.attributes.includes(a)) || typeof m.present !== 'function') return false;
  }
  if (d.input !== undefined && (!plain(d.input) || !closed(d.input, ['insertText', 'enter', 'lineBreak', 'deleteBackward', 'deleteSelection'])
    || Object.values(d.input).some(f => typeof f !== 'function'))) return false;
  return true;
}

/** Catalog authoring is trusted code; only registered immutable instances mount. */
export function defineRendererCatalog(definition: RendererCatalogDefinition): RendererCatalog | DomRefusal {
  try {
    if (!validDefinition(definition)) return domRefusal('dom.invalid_options', 'mount');
    const catalog = Object.freeze({ definition: frozenCopy(definition), __rendererCatalog: brand }) as unknown as RendererCatalog;
    catalogs.add(catalog); return catalog;
  } catch { return domRefusal('dom.invalid_options', 'mount'); }
}
export function isRendererCatalog(value: unknown): value is RendererCatalog {
  return value !== null && typeof value === 'object' && catalogs.has(value);
}
export function admitCatalog(catalog: RendererCatalog, context: DeepReadonly<SessionContextV2>): DomRefusal | null {
  if (!isRendererCatalog(catalog)) return domRefusal('dom.invalid_options', 'mount');
  const b = catalog.definition.binding, p = b.profile, actual = context.profile;
  const matches = b.buildId === context.build_id && b.registryDigest === context.registry_digest
    && p.profile_id === actual.profile_id && p.profile_version === actual.profile_version && p.codec_id === actual.codec_id
    && p.wire_version === actual.wire_version && p.extensions.length === actual.extensions.length
    && p.extensions.every((e, i) => e.id === actual.extensions[i].id && e.version === actual.extensions[i].version);
  return matches ? null : domRefusal('dom.renderer_binding_mismatch', 'mount');
}
function validHref(value: string): boolean {
  // No browser URL parser, base resolution or DOM insertion is used for data admission.
  if (/[\u0000-\u0020\u007f]/u.test(value) || value.length > 16384) return false;
  return /^https?:/i.test(value) || /^\/(?!\/)/.test(value);
}
function presentation(value: unknown): value is DomPresentation {
  if (!plain(value) || !closed(value, ['tag', 'attributes', 'classes', 'label']) || typeof value.tag !== 'string' || !tags.has(value.tag)) return false;
  if (value.label !== undefined && (typeof value.label !== 'string' || value.label.length > 65536)) return false;
  if (value.classes !== undefined && (!stringList(value.classes, 32) || value.classes.some(c => !classes.has(c)))) return false;
  if (value.attributes !== undefined) {
    if (!plain(value.attributes) || Object.keys(value.attributes).length > 6) return false;
    for (const [key, v] of Object.entries(value.attributes)) {
      if (!attributes.has(key) || typeof v !== 'string' || v.length > 65536 || (key === 'href' && (value.tag !== 'a' || !validHref(v)))
        || (key === 'start' && (value.tag !== 'ol' || !/^(0|[1-9][0-9]{0,9})$/.test(v) || BigInt(v) > 2147483647n))
        || (key === 'aria-checked' && v !== 'true' && v !== 'false')
        || (key === 'role' && !['group', 'separator', 'checkbox', 'list', 'listitem', 'document'].includes(v))) return false;
    }
  }
  return true;
}
export interface PreparedNode { readonly presentation: DomPresentation; readonly marks: readonly DomPresentation[] }
/** Validate native-admitted data against independent renderer capability coverage. */
export function prepareNode(catalog: RendererCatalog, node: DeepReadonly<NodeViewDto>, phase: DomDiagnostic['phase'] = 'render',
  publication: DomDiagnostic['publication'] = 'none'): PreparedNode | DomRefusal {
  const fail = (code: 'dom.renderer_missing' | 'dom.presentation_unsupported') => domRefusal(code, phase, node.stamp, node.id, node.type_id || null, publication);
  if (node.parent === null && node.primitive === 'root' && node.type_id === '') {
    if (node.text !== null || node.marks.length || Object.keys(node.attributes).length) return fail('dom.presentation_unsupported');
    return { presentation: Object.freeze({ tag: 'div' }), marks: Object.freeze([]) };
  }
  const definition = catalog.definition.nodes[node.type_id];
  if (!definition || !own(catalog.definition.nodes, node.type_id)) return fail('dom.renderer_missing');
  if (definition.primitive !== node.primitive || Object.keys(node.attributes).some(k => !definition.attributes.includes(k))) return fail('dom.presentation_unsupported');
  try {
    const p = definition.present(node);
    if (isDomRefusal(p)) return p;
    if (!presentation(p) || ((node.primitive === 'container' || node.primitive === 'text_block') && ['br', 'hr'].includes(p.tag))) return fail('dom.presentation_unsupported');
    const marks: DomPresentation[] = [];
    for (const mark of node.marks) {
      const renderer = catalog.definition.marks[mark.type_id];
      if (!renderer || !own(catalog.definition.marks, mark.type_id)) return fail('dom.renderer_missing');
      if (Object.keys(mark.attributes).some(k => !renderer.attributes.includes(k))) return fail('dom.presentation_unsupported');
      const mp = renderer.present(mark);
      if (isDomRefusal(mp)) return mp;
      if (!presentation(mp) || !['span', 'strong', 'em', 's', 'code', 'sub', 'sup', 'a'].includes(mp.tag) || mp.label !== undefined) return fail('dom.presentation_unsupported');
      marks.push(frozenCopy(mp));
    }
    return Object.freeze({ presentation: frozenCopy(p), marks: Object.freeze(marks) });
  } catch { return fail('dom.presentation_unsupported'); }
}
