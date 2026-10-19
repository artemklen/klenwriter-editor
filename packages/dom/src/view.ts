// SPDX-License-Identifier: MIT OR Apache-2.0
import type { DeepReadonly, EventDto, NodeViewDto, PositionDto, Response, SelectionDto, StampDto, StateDto } from '@klenwriter/editor-sdk';
import type { DomDiagnostic, DomRefusal, MountedMutation, RecoveryRegion, RendererCatalog } from './types.js';
import { prepareNode, type PreparedNode } from './catalog.js';
import { domRefusal, isDomRefusal } from './refusal.js';

export const domRegionLimits = Object.freeze({ blocks: 8, nodes: 131072, depth: 128, utf16: 2097152, mutations: 4096 });
export interface DomPoint { readonly node: Node; readonly offset: number }
export interface CapturedBlock {
  readonly id: string;
  readonly view: DeepReadonly<NodeViewDto>;
  readonly element: HTMLElement;
  readonly originalText: string;
  readonly provisionalText: string;
}
export interface BlockCapture { readonly stamp: DeepReadonly<StampDto> | null; readonly blocks: readonly CapturedBlock[]; readonly region: RecoveryRegion }
export interface DomView {
  initialize(state: DeepReadonly<StateDto>): DomRefusal | null;
  patch(event: DeepReadonly<EventDto>, restore?: boolean): DomRefusal | null;
  readSelection(): DeepReadonly<SelectionDto> | DomRefusal | null;
  restoreSelection(selection: DeepReadonly<SelectionDto> | null): DomRefusal | null;
  rememberSelection(selection: DeepReadonly<SelectionDto> | null): DomRefusal | null;
  ownedBlockAt(node: Node | null): string | null;
  textPosition(node: Node, offset: number): DeepReadonly<PositionDto> | DomRefusal | null;
  domPoint(position: DeepReadonly<PositionDto>): DomPoint | DomRefusal;
  beginProvisional(stamp: DeepReadonly<StampDto>, blockIds?: readonly string[]): DomRefusal | null;
  endProvisional(): void;
  setComposing(active: boolean): void;
  hasProvisional(): boolean;
  protectedIds(): readonly string[];
  conflicts(request: DeepReadonly<MountedMutation>): boolean;
  captureBlocks(blockIds?: readonly string[]): BlockCapture | DomRefusal;
  captureRegion(): RecoveryRegion | null;
  /** Counts every node and text unit before copying; unknown DOM has no model authority. */
  boundedText(element: Node): string | DomRefusal;
  destroy(options?: { readonly retainRegion?: boolean }): void;
}
interface Row { view: DeepReadonly<NodeViewDto>; prepared: PreparedNode; outer: HTMLElement; content: HTMLElement; text: Text | null; signature: string; placeholder: HTMLBRElement | null }
interface Provisional { stamp: DeepReadonly<StampDto>; ids: readonly string[]; originals: ReadonlyMap<string, string>; retained: HTMLElement; composing: boolean; protected: ReadonlySet<string>; window: { parent: HTMLElement; before: ChildNode | null; after: ChildNode | null } | null }
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function scalarBoundary(text: string, offset: number): boolean {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) return false;
  if (offset === 0 || offset === text.length) return true;
  const left = text.charCodeAt(offset - 1), right = text.charCodeAt(offset);
  return !(left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff);
}
function signature(prepared: PreparedNode): string { return JSON.stringify(prepared); }
function stampSame(a: DeepReadonly<StampDto>, b: DeepReadonly<StampDto>): boolean {
  return a.session === b.session && a.generation === b.generation && a.revision === b.revision
    && a.selection_epoch === b.selection_epoch && a.history_epoch === b.history_epoch;
}
let mountSerial = 0;

/** A read-only correspondence between native rows and actual owned DOM objects. */
export function createDomView(options: { readonly element: HTMLElement; readonly catalog: RendererCatalog;
  readonly readNode: (stamp: DeepReadonly<StampDto>, id: string) => Response }): DomView {
  const host = options.element, doc = host.ownerDocument;
  const namespace = `kwe-${++mountSerial}-`;
  let nextDomId = 0, rows = new Map<string, Row>(), authority = new WeakMap<Node, string>();
  let rootId: string | null = null, currentStamp: DeepReadonly<StampDto> | null = null;
  let lastSelection: DeepReadonly<SelectionDto> | null = null, lastAnchor: DomPoint | null = null, lastFocus: DomPoint | null = null;
  let provisional: Provisional | null = null, destroyed = false;
  let placeholders = new WeakSet<Node>();
  const refusal = (code: 'dom.renderer_missing' | 'dom.presentation_unsupported' | 'dom.composition_conflict' | 'dom.reconcile_limit' | 'dom.disposed',
    node: string | null = null, publication: DomDiagnostic['publication'] = 'none') => domRefusal(code, 'render', currentStamp, node, node ? rows.get(node)?.view.type_id || null : null, publication);
  function uniqueId(): string {
    let candidate: string;
    do { candidate = `${namespace}${++nextDomId}`; } while (doc.getElementById(candidate) !== null);
    return candidate;
  }
  function read(stamp: DeepReadonly<StampDto>, id: string, publication: DomDiagnostic['publication']): DeepReadonly<NodeViewDto> | DomRefusal {
    const result = options.readNode(stamp, id);
    if (result.status !== 'ok' || result.value.kind !== 'node' || result.value.node.id !== id || !stampSame(result.value.node.stamp, stamp)) {
      return domRefusal('dom.presentation_unsupported', 'render', stamp, id, null, publication);
    }
    return result.value.node;
  }
  function applyPresentation(element: HTMLElement, p: PreparedNode['presentation']): void {
    for (const attr of [...element.attributes]) if (attr.name !== 'id' && attr.name !== 'data-editor-node') element.removeAttribute(attr.name);
    if (p.classes?.length) element.className = p.classes.join(' ');
    for (const [name, value] of Object.entries(p.attributes ?? {})) element.setAttribute(name, value!);
  }
  function createRow(view: DeepReadonly<NodeViewDto>, prepared: PreparedNode, isRoot = false, bindings = authority): Row {
    const outer = isRoot ? host : doc.createElement(prepared.presentation.tag);
    if (!isRoot) { outer.id = uniqueId(); outer.setAttribute('data-editor-node', ''); }
    if (!isRoot) applyPresentation(outer, prepared.presentation);
    bindings.set(outer, view.id);
    let content = outer;
    // The kernel creates and owns all wrappers and text, never authored HTML.
    for (const mark of prepared.marks) {
      const wrapper = doc.createElement(mark.tag); applyPresentation(wrapper, mark); content.appendChild(wrapper);
      bindings.set(wrapper, view.id); content = wrapper;
    }
    let text: Text | null = null;
    if (view.primitive === 'text') { text = doc.createTextNode(view.text ?? ''); content.appendChild(text); bindings.set(text, view.id); }
    else if (view.primitive === 'block_atom' || view.primitive === 'inline_atom') {
      outer.contentEditable = 'false';
      if (prepared.presentation.label !== undefined) content.appendChild(doc.createTextNode(prepared.presentation.label));
    } else if (prepared.presentation.label !== undefined) {
      // A static prefix belongs only to a noneditable atom; editable data cannot gain text.
      throw new Error('dom.presentation_unsupported');
    }
    return { view, prepared, outer, content, text, signature: signature(prepared), placeholder: null };
  }
  function prepare(view: DeepReadonly<NodeViewDto>, publication: DomDiagnostic['publication']): PreparedNode | DomRefusal {
    if ((view.primitive === 'text' && (view.text === null || view.children.length))
      || (view.primitive !== 'text' && view.text !== null)) return domRefusal('dom.presentation_unsupported', 'render', view.stamp, view.id, view.type_id || null, publication);
    const result = prepareNode(options.catalog, view, 'render', publication);
    if (isDomRefusal(result)) return result;
    const acceptedTags: Record<string, readonly string[]> = {
      root: ['div'], text: ['span'], hard_break: ['br'], text_block: ['p','h1','h2','h3','h4','h5','h6','pre','div'],
      container: ['blockquote','ul','ol','li','div','section'], block_atom: ['hr','div','span'], inline_atom: ['span']
    };
    if (!acceptedTags[view.primitive]?.includes(result.presentation.tag)
      || (result.presentation.label !== undefined && view.primitive !== 'block_atom' && view.primitive !== 'inline_atom')) {
      return domRefusal('dom.presentation_unsupported', 'render', view.stamp, view.id, view.type_id || null, publication);
    }
    return result;
  }
  function reconcileChildren(row: Row, source: ReadonlyMap<string, Row>, placeholderStore = placeholders): void {
    if (row.view.primitive === 'text' || row.view.primitive === 'hard_break' || row.view.primitive.endsWith('_atom')) return;
    const desired: Node[] = row.view.children.map(id => {
      const child = source.get(id); if (!child) throw new Error('dom.missing_child'); return child.outer;
    });
    if (row.view.primitive === 'text_block' && desired.length === 0) {
      if (!row.placeholder) { row.placeholder = doc.createElement('br'); placeholderStore.add(row.placeholder); }
      desired.push(row.placeholder);
    } else row.placeholder = null;
    let cursor: ChildNode | null = row.content.firstChild;
    for (const child of desired) {
      if (cursor === child) cursor = cursor.nextSibling;
      else row.content.insertBefore(child, cursor);
    }
    while (cursor) { const next: ChildNode | null = cursor.nextSibling; row.content.removeChild(cursor); cursor = next; }
  }
  function collect(stamp: DeepReadonly<StampDto>, id: string): Map<string, { view: DeepReadonly<NodeViewDto>; prepared: PreparedNode }> | DomRefusal {
    const result = new Map<string, { view: DeepReadonly<NodeViewDto>; prepared: PreparedNode }>();
    const pending: { id: string; parent: string | null; depth: number }[] = [{ id, parent: null, depth: 0 }];
    while (pending.length) {
      const item = pending.pop()!;
      if (item.depth > domRegionLimits.depth || result.size >= domRegionLimits.nodes || result.has(item.id)) return refusal('dom.reconcile_limit', item.id);
      const view = read(stamp, item.id, 'none'); if (isDomRefusal(view)) return view;
      if (view.parent !== item.parent || (item.parent === null && (view.primitive !== 'root' || view.type_id !== ''))) return refusal('dom.presentation_unsupported', item.id);
      const p = prepare(view, 'none'); if (isDomRefusal(p)) return p;
      result.set(item.id, { view, prepared: p });
      if (view.children.length > domRegionLimits.nodes - result.size - pending.length) return refusal('dom.reconcile_limit', item.id);
      for (let i = view.children.length - 1; i >= 0; i--) pending.push({ id: view.children[i], parent: view.id, depth: item.depth + 1 });
    }
    return result;
  }
  function ancestorBlock(id: string): string | null {
    let row = rows.get(id), remaining = domRegionLimits.depth + 1;
    while (row && remaining--) {
      if (row.view.primitive === 'text_block') return row.view.id;
      row = row.view.parent === null ? undefined : rows.get(row.view.parent);
    }
    return null;
  }
  function ownedBlockAt(node: Node | null): string | null {
    let current = node, remaining = domRegionLimits.depth + 1;
    while (current && remaining--) {
      const id = authority.get(current);
      if (id) return ancestorBlock(id);
      if (current === host) break;
      current = current.parentNode;
    }
    return null;
  }
  function positionAt(node: Node, offset: number): DeepReadonly<PositionDto> | DomRefusal | null {
    const id = authority.get(node), row = id ? rows.get(id) : undefined;
    if (!row || !host.contains(node) && node !== host) return null;
    if (row.text === node) {
      if (!scalarBoundary(row.text.data, offset)) return refusal('dom.presentation_unsupported', id!);
      return Object.freeze({ kind: 'text', node: id!, offset, affinity: 'after' });
    }
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > node.childNodes.length) return refusal('dom.presentation_unsupported', id!);
    if (row.view.primitive === 'text') {
      let chain: Node | null = node, remaining = domRegionLimits.depth + 1;
      while (chain !== row.text && remaining--) {
        if (chain.childNodes.length !== 1 || !chain.firstChild || authority.get(chain.firstChild) !== id) return null;
        chain = chain.firstChild;
      }
      if (chain !== row.text || !row.outer.contains(node)) return null;
      return Object.freeze({ kind: 'text', node: id!, offset: offset === 0 ? 0 : row.text!.data.length, affinity: 'after' });
    }
    if (row.view.primitive === 'hard_break' || row.view.primitive.endsWith('_atom')) {
      if (node !== row.outer) return null;
      return Object.freeze({ kind: 'edge', node: id!, side: offset === 0 ? 'before' : 'after' });
    }
    if (node !== row.content) return null;
    if (row.placeholder && node.childNodes.length === 1 && node.firstChild === row.placeholder) return Object.freeze({ kind: 'child', parent: id!, index: 0, affinity: 'after' });
    // Only exact owned child objects form a child gap. Cloned IDs do not count.
    const children = row.view.children;
    if (node.childNodes.length !== children.length || children.some((child, i) => rows.get(child)?.outer !== node.childNodes[i])) return null;
    return Object.freeze({ kind: 'child', parent: id!, index: offset, affinity: 'after' });
  }
  function domPoint(position: DeepReadonly<PositionDto>): DomPoint | DomRefusal {
    if (position.kind === 'text') {
      const row = rows.get(position.node);
      if (!row?.text || !scalarBoundary(row.text.data, position.offset)) return refusal('dom.presentation_unsupported', position.node);
      return { node: row.text, offset: position.offset };
    }
    if (position.kind === 'child') {
      const row = rows.get(position.parent);
      if (!row || !Number.isSafeInteger(position.index) || position.index < 0 || position.index > row.view.children.length) return refusal('dom.presentation_unsupported', position.parent);
      return { node: row.content, offset: row.placeholder ? 0 : position.index };
    }
    const row = rows.get(position.node), parent = row?.view.parent ? rows.get(row.view.parent) : undefined;
    if (!row || !parent) return refusal('dom.presentation_unsupported', position.node);
    const index = parent.view.children.indexOf(position.node);
    if (index < 0) return refusal('dom.presentation_unsupported', position.node);
    return { node: parent.content, offset: index + (position.side === 'after' ? 1 : 0) };
  }
  function restoreSelection(selection: DeepReadonly<SelectionDto> | null): DomRefusal | null {
    if (destroyed) return refusal('dom.disposed');
    if (provisional?.composing) return null;
    if (selection === null) {
      lastSelection = null; lastAnchor = lastFocus = null;
      const browser = doc.getSelection();
      try {
        // Replacement can reparent an old range to the editing host itself.
        // Remove only this host's ranges; another mount or host control keeps
        // its native selection, including Firefox's other selection ranges.
        if (browser) for (let i = browser.rangeCount - 1; i >= 0; i--) {
          const range = browser.getRangeAt(i);
          if (host.contains(range.startContainer) && host.contains(range.endContainer)) browser.removeRange(range);
        }
        return null;
      } catch { return refusal('dom.presentation_unsupported'); }
    }
    const anchor = domPoint(selection.anchor), focus = domPoint(selection.focus);
    if (isDomRefusal(anchor)) return anchor; if (isDomRefusal(focus)) return focus;
    const browser = doc.getSelection(); if (!browser) return refusal('dom.presentation_unsupported');
    try {
      // Preserve the UA's in-progress drag when correspondence is already exact.
      // Reinstalling the same range can replace the browser's gesture anchor.
      if (browser.anchorNode !== anchor.node || browser.anchorOffset !== anchor.offset
        || browser.focusNode !== focus.node || browser.focusOffset !== focus.offset) {
        browser.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
      }
      lastSelection = selection; lastAnchor = anchor; lastFocus = focus; return null;
    } catch { return refusal('dom.presentation_unsupported'); }
  }
  function rememberSelection(selection: DeepReadonly<SelectionDto> | null): DomRefusal | null {
    if(selection===null){lastSelection=null;lastAnchor=lastFocus=null;return null;}
    const anchor=domPoint(selection.anchor),focus=domPoint(selection.focus);
    if(isDomRefusal(anchor))return anchor;if(isDomRefusal(focus))return focus;
    lastSelection=selection;lastAnchor=anchor;lastFocus=focus;return null;
  }
  function readSelection(): DeepReadonly<SelectionDto> | DomRefusal | null {
    if (destroyed) return refusal('dom.disposed');
    const browser = doc.getSelection();
    if (!browser?.anchorNode || !browser.focusNode || !host.contains(browser.anchorNode) || !host.contains(browser.focusNode)) return null;
    const anchor = positionAt(browser.anchorNode, browser.anchorOffset), focus = positionAt(browser.focusNode, browser.focusOffset);
    if (isDomRefusal(anchor)) return anchor; if (isDomRefusal(focus)) return focus;
    if (!anchor || !focus) return refusal('dom.presentation_unsupported');
    const a = lastSelection && lastAnchor?.node === browser.anchorNode && lastAnchor.offset === browser.anchorOffset ? lastSelection.anchor : anchor;
    const f = lastSelection && lastFocus?.node === browser.focusNode && lastFocus.offset === browser.focusOffset ? lastSelection.focus : focus;
    return Object.freeze({ anchor: a, focus: f });
  }
  interface TextBudget { nodes: number; units: number }
  function captureText(element: Node, budget: TextBudget): string | DomRefusal {
    const stack: { node: Node; depth: number }[] = [{ node: element, depth: 0 }];
    const pieces: string[] = [];
    while (stack.length) {
      const { node, depth } = stack.pop()!;
      if (++budget.nodes > domRegionLimits.nodes || depth > domRegionLimits.depth) return refusal('dom.reconcile_limit');
      if (node.nodeType === 3) {
        const data = (node as Text).data;
        if (data.length > domRegionLimits.utf16 - budget.units) return refusal('dom.reconcile_limit');
        budget.units += data.length; pieces.push(data);
      } else if (node.nodeType === 1 && (node as Element).tagName === 'BR') {
        if (!placeholders.has(node)) { if (++budget.units > domRegionLimits.utf16) return refusal('dom.reconcile_limit'); pieces.push('\n'); }
      } else {
        // Charge the known child count before pushing, so a wide untrusted node
        // cannot allocate an unbounded traversal stack before the next check.
        if (node.childNodes.length > domRegionLimits.nodes - budget.nodes - stack.length) return refusal('dom.reconcile_limit');
        for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push({ node: node.childNodes[i], depth: depth + 1 });
      }
    }
    return pieces.join('');
  }
  function boundedText(element: Node): string | DomRefusal {
    return captureText(element, { nodes: 0, units: 0 });
  }
  function originalText(id: string): string | DomRefusal {
    const stack = [id], pieces: string[] = []; let count = 0, units = 0;
    while (stack.length) {
      if (++count > domRegionLimits.nodes) return refusal('dom.reconcile_limit', id);
      const row = rows.get(stack.pop()!); if (!row) return refusal('dom.presentation_unsupported', id);
      if (row.view.text !== null) {
        if (row.view.text.length > domRegionLimits.utf16 - units) return refusal('dom.reconcile_limit', id);
        units += row.view.text.length; pieces.push(row.view.text);
      } else if (row.view.primitive === 'hard_break') { if (++units > domRegionLimits.utf16) return refusal('dom.reconcile_limit', id); pieces.push('\n'); }
      else for (let i = row.view.children.length - 1; i >= 0; i--) stack.push(row.view.children[i]);
    }
    return pieces.join('');
  }
  function selectionBlocks(): string[] {
    const browser = doc.getSelection(), result: string[] = [];
    for (const n of [browser?.anchorNode ?? null, browser?.focusNode ?? null]) {
      const id = ownedBlockAt(n); if (id && !result.includes(id)) result.push(id);
    }
    return result;
  }
  function captureBlocks(blockIds?: readonly string[]): BlockCapture | DomRefusal {
    const ids = blockIds ?? provisional?.ids ?? selectionBlocks();
    if (ids.length > domRegionLimits.blocks || new Set(ids).size !== ids.length) return refusal('dom.reconcile_limit');
    const blocks: CapturedBlock[] = []; let originalUnits = Math.max(0, ids.length - 1);
    const budget: TextBudget = { nodes: 0, units: Math.max(0, ids.length - 1) };
    for (const id of ids) {
      const row = rows.get(id); if (!row || row.view.primitive !== 'text_block') return refusal('dom.presentation_unsupported', id);
      const original = provisional?.originals.get(id) ?? originalText(id); if (isDomRefusal(original)) return original;
      const text = captureText(row.outer, budget); if (isDomRefusal(text)) return text;
      if (original.length > domRegionLimits.utf16 - originalUnits) return refusal('dom.reconcile_limit', id);
      originalUnits += original.length;
      blocks.push(Object.freeze({ id, view: row.view, element: row.outer, originalText: original, provisionalText: text }));
    }
    const region: RecoveryRegion = provisional ? provisionalRegion() : Object.freeze({ kind: 'bounded', stamp: currentStamp,
      originalText: blocks.map(b => b.originalText).join('\n'), provisionalText: blocks.map(b => b.provisionalText).join('\n'), affectedNodeIds: Object.freeze([...ids]) });
    return Object.freeze({ stamp: provisional?.stamp ?? currentStamp, blocks: Object.freeze(blocks), region });
  }
  function beginProvisional(stamp: DeepReadonly<StampDto>, blockIds?: readonly string[]): DomRefusal | null {
    if (provisional) return null;
    let requested = blockIds ?? selectionBlocks();
    if (requested.length > 1) {
      const firstRow = rows.get(requested[0]), parent = firstRow?.view.parent ? rows.get(firstRow.view.parent) : undefined;
      if (parent && requested.every(id => rows.get(id)?.view.parent === parent.view.id)) {
        const positions = requested.map(id => parent.view.children.indexOf(id));
        const from = Math.min(...positions), to = Math.max(...positions);
        if (from < 0 || to - from >= domRegionLimits.blocks) return refusal('dom.reconcile_limit');
        const expanded = parent.view.children.slice(from,to+1);
        if (expanded.some(id => rows.get(id)?.view.primitive !== 'text_block')) return refusal('dom.presentation_unsupported');
        requested = expanded;
      }
    }
    const capture = captureBlocks(requested); if (isDomRefusal(capture)) return capture;
    if (!capture.blocks.length) return refusal('dom.presentation_unsupported');
    const protectedSet = new Set<string>();
    for (const block of capture.blocks) {
      const todo = [block.id]; while (todo.length) {
        const id = todo.pop()!;
        if (protectedSet.has(id)) continue;
        if (protectedSet.size >= domRegionLimits.nodes) return refusal('dom.reconcile_limit', id);
        protectedSet.add(id); const row = rows.get(id);
        if (row) {
          if (row.view.children.length > domRegionLimits.nodes - protectedSet.size - todo.length) return refusal('dom.reconcile_limit', id);
          for (const child of row.view.children) todo.push(child);
        }
      }
    }
    const first = capture.blocks[0], parentId = first.view.parent;
    const parentRow = parentId ? rows.get(parentId) : undefined;
    let window: Provisional['window'] = null;
    if (parentRow && capture.blocks.every(b => b.view.parent === parentId && b.element.parentNode === parentRow.content)) {
      const ordered = [...capture.blocks].sort((a,b) => parentRow.view.children.indexOf(a.id) - parentRow.view.children.indexOf(b.id));
      const from = parentRow.view.children.indexOf(ordered[0].id), to = parentRow.view.children.indexOf(ordered[ordered.length-1].id);
      if (from >= 0 && to - from < domRegionLimits.blocks) window = { parent: parentRow.content, before: ordered[0].element.previousSibling, after: ordered[ordered.length-1].element.nextSibling };
    }
    provisional = { stamp, ids: Object.freeze(capture.blocks.map(b => b.id)), originals: new Map(capture.blocks.map(b => [b.id, b.originalText])),
      retained: window?.parent ?? (capture.blocks.length === 1 ? first.element : host), composing: false, protected: protectedSet, window };
    return null;
  }
  function provisionalRegion(): RecoveryRegion {
    const p = provisional!;
    const retained = (): RecoveryRegion => Object.freeze({ kind: 'retained_dom', element: p.retained, reason: 'capture_limit', ownership: 'transferred_to_host' });
    const originals = [...p.originals.values()];
    const original = originals.join('\n');
    if (p.window) {
      const {parent,before,after} = p.window;
      if ((before && before.parentNode !== parent) || (after && after.parentNode !== parent)) return retained();
      const pieces: string[] = [], budget: TextBudget = {nodes:0,units:0};
      let current: ChildNode | null = before ? before.nextSibling : parent.firstChild, blocks = 0;
      while (current !== after) {
        if (!current || ++blocks > domRegionLimits.blocks) return retained();
        if (pieces.length && ++budget.units > domRegionLimits.utf16) return retained();
        const text = captureText(current, budget); if (isDomRefusal(text)) return retained();
        pieces.push(text); current = current.nextSibling;
      }
      return Object.freeze({kind:'bounded',stamp:p.stamp,originalText:original,provisionalText:pieces.join('\n'),affectedNodeIds:p.ids});
    }
    // No common bounded sibling window: preserve the actual owner rather than
    // guessing a disconnected or cross-container DOM region is complete.
    return retained();
  }
  function captureRegion(): RecoveryRegion | null {
    return provisional ? provisionalRegion() : null;
  }
  function patch(event: DeepReadonly<EventDto>, restore = true): DomRefusal | null {
    if (destroyed) return refusal('dom.disposed');
    const publication = 'alreadyPublished' as const, candidates = new Map<string, { view: DeepReadonly<NodeViewDto>; prepared: PreparedNode }>();
    if (event.change.kind === 'document') {
      const ids = new Set([...event.change.impact.upserted, ...event.change.impact.ancestors_after]);
      if (event.change.impact.root_order_changed && rootId) ids.add(rootId);
      const pending = [...ids];
      while (pending.length) {
        const id = pending.pop()!; if (candidates.has(id)) continue;
        if (candidates.size >= domRegionLimits.nodes) return refusal('dom.reconcile_limit', id, publication);
        const view = read(event.after, id, publication); if (isDomRefusal(view)) return view;
        const p = prepare(view, publication); if (isDomRefusal(p)) return p;
        candidates.set(id, { view, prepared: p });
        // Only new child rows require descent. Existing unaffected rows remain bound.
        const freshChildren = view.children.filter(child => !rows.has(child) && !candidates.has(child));
        if (freshChildren.length > domRegionLimits.nodes - candidates.size - pending.length) return refusal('dom.reconcile_limit', id, publication);
        for (const child of freshChildren) pending.push(child);
      }
      for (const [id,candidate] of candidates) {
        if (candidate.view.children.some(child => (candidates.get(child)?.view ?? rows.get(child)?.view)?.parent !== id)) return refusal('dom.presentation_unsupported', id, publication);
        if (!rows.has(id)) {
          let parent = candidate.view.parent, depth = 0;
          const visited = new Set([id]);
          while (parent !== null) {
            if (++depth > domRegionLimits.depth || visited.has(parent)) return refusal('dom.reconcile_limit', id, publication);
            visited.add(parent);
            const ancestor = candidates.get(parent)?.view ?? rows.get(parent)?.view;
            if (!ancestor) return refusal('dom.presentation_unsupported', id, publication);
            parent = ancestor.parent;
          }
        }
      }
      if (provisional) {
        if (event.change.impact.removed.some(id => provisional!.protected.has(id))) return refusal('dom.composition_conflict', null, publication);
        for (const id of provisional.protected) {
          const candidate = candidates.get(id), previous = rows.get(id);
          if (candidate && previous && (!equal(candidate.view.attributes, previous.view.attributes) || !equal(candidate.view.marks, previous.view.marks)
            || candidate.view.type_id !== previous.view.type_id || candidate.view.primitive !== previous.view.primitive
            || candidate.view.text !== previous.view.text || !equal(candidate.view.children, previous.view.children)
            || signature(candidate.prepared) !== previous.signature)) return refusal('dom.composition_conflict', id, publication);
        }
        // Never detach/move a composing block by changing its ancestor membership.
        for (const blockId of provisional.ids) {
          let child = blockId, ancestor = rows.get(child)?.view.parent;
          while (ancestor) {
            const ancestorRow = rows.get(ancestor), before = ancestorRow?.view, after = candidates.get(ancestor)?.view;
            if (before && after && (!after.children.includes(child) || after.children.indexOf(child) !== before.children.indexOf(child))) return refusal('dom.composition_conflict', blockId, publication);
            if (ancestorRow && before && (ancestorRow.content.childNodes.length !== before.children.length
              || before.children.some((id,i) => rows.get(id)?.outer !== ancestorRow.content.childNodes[i]))) return refusal('dom.composition_conflict', blockId, publication);
            child = ancestor; ancestor = rows.get(ancestor)?.view.parent;
          }
        }
      }
      // Relocate a caret out of a removed empty block before touching its DOM.
      // This narrow optimization only uses an unchanged, already-owned Text
      // target. Child/edge targets and every provisional case keep final-only
      // restoration; an old child gap can mean something else after a patch.
      if (restore && provisional === null && event.selection_after && event.change.impact.removed.length) {
        const browser = doc.getSelection(), after = event.selection_after;
        const removed = new Set(event.change.impact.removed);
        const anchorNode = browser?.anchorNode, focusNode = browser?.focusNode;
        const blockId = anchorNode ? ownedBlockAt(anchorNode) : null;
        const block = blockId ? rows.get(blockId) : undefined;
        const oldPoint = anchorNode && browser ? positionAt(anchorNode,browser.anchorOffset) : null;
        if (browser?.isCollapsed && anchorNode && focusNode && anchorNode === focusNode
          && browser.anchorOffset === browser.focusOffset && host.contains(anchorNode)
          && blockId && removed.has(blockId) && block?.view.primitive === 'text_block'
          && authority.get(block.outer) === blockId && block.outer.ownerDocument === doc
          && block.outer.isConnected && host.contains(block.outer) && block.outer.contains(anchorNode)
          && block.view.children.length === 0 && block.placeholder && placeholders.has(block.placeholder)
          && block.content.childNodes.length === 1 && block.content.firstChild === block.placeholder
          && oldPoint && !isDomRefusal(oldPoint) && oldPoint.kind === 'child'
          && oldPoint.parent === blockId && oldPoint.index === 0
          && after.anchor.kind === 'text' && after.focus.kind === 'text'
          && after.anchor.node === after.focus.node && after.anchor.offset === after.focus.offset) {
          const stableTextPoint = (position: DeepReadonly<PositionDto>): boolean => {
            if (position.kind !== 'text') return false;
            const point = domPoint(position), target = rows.get(position.node);
            if (isDomRefusal(point) || !target?.text || point.node !== target.text
              || target.text.data !== target.view.text || target.text.parentNode !== target.content
              || !target.outer.contains(target.text) || target.content.childNodes.length !== 1
              || target.content.firstChild !== target.text || point.node.ownerDocument !== doc
              || !point.node.isConnected || !host.contains(point.node)) return false;
            const visited = new Set<string>();
            let id: string | null = position.node;
            while (id !== null) {
              if (visited.size > domRegionLimits.depth || visited.has(id) || removed.has(id)) return false;
              visited.add(id);
              const row = rows.get(id), candidate = candidates.get(id);
              if (!row || authority.get(row.outer) !== id || authority.get(row.content) !== id
                || !row.outer.contains(row.content) || !row.outer.isConnected || !host.contains(row.outer)) return false;
              if (candidate && (signature(candidate.prepared) !== row.signature
                || candidate.view.parent !== row.view.parent || candidate.view.type_id !== row.view.type_id
                || candidate.view.primitive !== row.view.primitive || candidate.view.text !== row.view.text
                || !equal(candidate.view.attributes,row.view.attributes) || !equal(candidate.view.marks,row.view.marks)
                || id === position.node && !equal(candidate.view.children,row.view.children))) return false;
              const parentId: string | null = row.view.parent;
              if (parentId === null) return id === rootId && row.outer === host;
              const parent = rows.get(parentId), index = parent?.view.children.indexOf(id) ?? -1;
              if (!parent || index < 0 || row.outer.parentNode !== parent.content
                || parent.content.childNodes[index] !== row.outer) return false;
              id = parentId;
            }
            return false;
          };
          if (stableTextPoint(after.anchor) && stableTextPoint(after.focus)) {
            const failure = restoreSelection(after);
            if (failure) return failure;
          }
        }
      }
      try {
        for (const [id, candidate] of candidates) {
          const previous = rows.get(id);
          if (provisional?.protected.has(id)) { if (previous) previous.view = candidate.view; continue; }
          if (!previous) rows.set(id, createRow(candidate.view, candidate.prepared, id === rootId));
          else if (previous.signature !== signature(candidate.prepared)) {
            const replacement = createRow(candidate.view, candidate.prepared, id === rootId);
            if (previous.outer !== host) previous.outer.replaceWith(replacement.outer);
            rows.set(id, replacement);
          } else {
            previous.view = candidate.view; previous.prepared = candidate.prepared;
            if (previous.text && previous.text.data !== candidate.view.text) previous.text.data = candidate.view.text ?? '';
          }
        }
        for (const id of candidates.keys()) if (!provisional?.protected.has(id)) reconcileChildren(rows.get(id)!, rows);
        for (const id of event.change.impact.removed) {
          const row = rows.get(id); if (row && row.outer !== host) row.outer.remove(); rows.delete(id);
        }
      } catch { return refusal('dom.presentation_unsupported', null, publication); }
    }
    currentStamp = event.after;
    return provisional?.composing ? null : restore ? restoreSelection(event.selection_after) : rememberSelection(event.selection_after);
  }
  return {
    initialize(state) {
      if (destroyed) return refusal('dom.disposed');
      const admitted = collect(state.stamp, state.root); if (isDomRefusal(admitted)) return admitted;
      try {
        const fresh = new Map<string, Row>(), freshAuthority = new WeakMap<Node,string>(), freshPlaceholders = new WeakSet<Node>();
        // Build all authored DOM detached. Host is replaced only after all declarations passed.
        for (const [id, value] of admitted) if (id !== state.root) fresh.set(id, createRow(value.view, value.prepared, false, freshAuthority));
        const root = admitted.get(state.root)!;
        const rootRow: Row = { view: root.view, prepared: root.prepared, outer: host, content: host, text: null, signature: signature(root.prepared), placeholder: null };
        fresh.set(state.root, rootRow);
        for (const [id, row] of fresh) if (id !== state.root) reconcileChildren(row, fresh, freshPlaceholders);
        reconcileChildren(rootRow, fresh, freshPlaceholders);
        freshAuthority.set(host,state.root); rows = fresh; authority = freshAuthority; placeholders = freshPlaceholders; rootId = state.root; currentStamp = state.stamp; provisional = null;
        return restoreSelection(state.selection);
      } catch { return refusal('dom.presentation_unsupported'); }
    },
    patch, readSelection, restoreSelection, rememberSelection, ownedBlockAt, textPosition: positionAt, domPoint,
    beginProvisional, endProvisional() { provisional = null; },
    setComposing(active) { if (provisional) provisional.composing = active; },
    hasProvisional: () => provisional !== null,
    protectedIds: () => Object.freeze([...(provisional?.protected ?? [])]),
    conflicts(request) {
      if (!provisional) return false;
      if (request.kind === 'set_selection' && request.selection !== null) {
        const a = request.selection.anchor, f = request.selection.focus;
        const id = (p: DeepReadonly<PositionDto>) => p.kind === 'child' ? p.parent : p.node;
        // A selection entirely inside one unrelated owned block cannot cross the
        // protected region. Ancestor gaps and cross-block ranges stay conservative.
        const ab = ancestorBlock(id(a)), fb = ancestorBlock(id(f));
        if (ab !== null && ab === fb && !provisional.protected.has(ab)) return false;
      }
      return !['snapshot', 'acknowledge_snapshot', 'reconcile_snapshot', 'release_snapshot', 'barrier'].includes(request.kind);
    },
    captureBlocks, captureRegion, boundedText,
    destroy(destroyOptions = {}) {
      if (destroyed) return; destroyed = true;
      if (!destroyOptions.retainRegion) {
        // Never inspect or clear an unbounded retained provisional subtree.
        for (const row of rows.values()) if (row.view.parent === rootId && row.outer.parentNode === host) row.outer.remove();
      }
      rows.clear(); authority = new WeakMap(); provisional = null; lastSelection = null; lastAnchor = lastFocus = null; currentStamp = null; rootId = null;
    }
  };
}
