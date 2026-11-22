// SPDX-License-Identifier: MIT OR Apache-2.0
import type { DeepReadonly, NodeViewDto } from '@klenwriter/editor-sdk';
import type { PreparedNode } from './catalog.js';
import type { DomRefusal } from './types.js';
import { matchesTextFragments } from './text-fragments.js';

const minimumTextUnits = 8192;
const maximumBlocks = 256;
const intrinsicSize = 'auto 10000px';
type Interval = readonly [first: number, last: number];
type OwnerCheck = (node: Node, id: string) => boolean;
interface Point { readonly node: Node; readonly offset: number }
interface LayoutRow {
  readonly view: DeepReadonly<NodeViewDto>;
  readonly prepared: PreparedNode;
  readonly outer: HTMLElement;
  readonly content: HTMLElement;
  readonly wrappers: readonly HTMLElement[];
  readonly texts: readonly Text[];
  readonly placeholder: HTMLBRElement | null;
}
interface Entry {
  readonly row: LayoutRow;
  readonly leaf: LayoutRow;
  readonly index: number;
  readonly rowAttributes: string;
  readonly leafAttributes: string;
  pinned: boolean;
  style: string;
}
interface Anchor {
  readonly point: Point;
  readonly rect: readonly number[];
  readonly scroller: HTMLElement;
  readonly left: number;
  readonly top: number;
  readonly selection: readonly unknown[];
}
interface Options {
  readonly host: HTMLElement;
  readonly supports: (row: LayoutRow) => boolean;
  readonly rows: () => ReadonlyMap<string, LayoutRow>;
  readonly root: () => string | null;
  readonly owns: OwnerCheck;
  readonly interval: (point: Point) => Interval | null;
  readonly blocked: () => boolean;
  readonly write: (change: () => DomRefusal | null) => DomRefusal | null;
  readonly failure: (publication: 'none' | 'unknown') => DomRefusal;
  readonly report: (failure: DomRefusal) => void;
}
const plain = (p: PreparedNode['presentation'], tag: 'p' | 'span') => p.tag === tag && p.label === undefined
  && !p.classes?.length && Object.keys(p.attributes ?? {}).length === 0;

function candidate(row: LayoutRow, leaf: LayoutRow | undefined, root: string): leaf is LayoutRow {
  return row.view.parent === root && row.view.primitive === 'text_block' && row.view.marks.length === 0
    && Object.keys(row.view.attributes).length === 0 && row.view.text === null && row.view.children.length === 1
    && row.prepared.marks.length === 0 && plain(row.prepared.presentation, 'p') && !!leaf
    && leaf.view.parent === row.view.id && leaf.view.primitive === 'text' && leaf.view.children.length === 0
    && leaf.view.marks.length === 0 && Object.keys(leaf.view.attributes).length === 0
    && typeof leaf.view.text === 'string' && leaf.view.text.length >= minimumTextUnits
    && leaf.prepared.marks.length === 0 && plain(leaf.prepared.presentation, 'span');
}

const attributes = (element: HTMLElement, omitStyle = false) => JSON.stringify([...element.attributes]
  .filter(attr => !omitStyle || attr.name !== 'style').map(attr => [attr.name, attr.value]).sort());
const ownedAttributes = (element: HTMLElement) => [...element.attributes]
  .every(attr => attr.name === 'id' || attr.name === 'data-editor-node');
const equal = (before: readonly unknown[], after: readonly unknown[]) => before.length === after.length
  && before.every((value, index) => value === after[index]);

/** Keeps native rows and owned DOM objects in place. Only the admitted block style is written. */
export function createLayoutPolicyOwner(options: Options) {
  const { host } = options, doc = host.ownerDocument, win = doc.defaultView;
  const removals: (() => void)[] = [];
  let entries: Entry[] = [], closed = false, changing = false, invalidated = false;
  let initialInterval: Interval | null | undefined;
  let initialScroller: HTMLElement | null = null;
  let environment: string | null = null;

  function proof(entry: Entry, source: ReadonlyMap<string, LayoutRow>, root: string, owns: OwnerCheck, detached = false): boolean {
    const { row, leaf, index } = entry;
    return source.get(root)?.view.children[index] === row.view.id && source.get(row.view.id) === row && source.get(leaf.view.id) === leaf
      && candidate(row, leaf, root) && row.view.children[0] === leaf.view.id
      && owns(row.outer, row.view.id) && owns(leaf.outer, leaf.view.id) && leaf.texts.every(text => owns(text, leaf.view.id))
      && row.outer.tagName === 'P' && leaf.outer.tagName === 'SPAN' && row.outer.ownerDocument === doc && leaf.outer.ownerDocument === doc
      && row.outer === row.content && leaf.outer === leaf.content && !row.wrappers.length && !leaf.wrappers.length
      && !row.placeholder && !leaf.placeholder && row.outer.childNodes.length === 1 && row.outer.firstChild === leaf.outer
      && matchesTextFragments(leaf.content, leaf.texts, leaf.view.text!)
      && (detached || row.outer.isConnected && row.outer.parentNode === host && host.childNodes[index] === row.outer)
      && attributes(row.outer, true) === entry.rowAttributes && attributes(leaf.outer) === entry.leafAttributes
      && row.outer.style.cssText === entry.style && row.outer.hasAttribute('style') === !entry.pinned;
  }

  function setPinned(entry: Entry, pinned: boolean): void {
    if (entry.pinned === pinned) return;
    const element = entry.row.outer;
    if (pinned) element.removeAttribute('style');
    else {
      element.style.setProperty('content-visibility', 'auto');
      element.style.setProperty('contain-intrinsic-block-size', intrinsicSize);
    }
    entry.pinned = pinned;
    entry.style = element.style.cssText;
  }

  function compatibleEnvironment(): { scroller: HTMLElement; fingerprint: string } | null {
    if (!win || !host.isConnected || !host.clientWidth) return null;
    const styles = win.getComputedStyle(host);
    let scroller: HTMLElement | null = null;
    let ancestor: HTMLElement | null = host;
    for (let depth = 0; ancestor && depth < 32; depth++, ancestor = ancestor.parentElement) {
      const css = ancestor === host ? styles : win.getComputedStyle(ancestor);
      if (css.writingMode !== 'horizontal-tb' || css.transform !== 'none'
        || css.perspective !== 'none' || css.scrollBehavior === 'smooth') return null;
      if (!scroller && (css.overflowY === 'auto' || css.overflowY === 'scroll')) scroller = ancestor;
    }
    if (ancestor || !scroller || !scroller.clientWidth || !scroller.clientHeight) return null;
    return { scroller, fingerprint: JSON.stringify([
      host.clientWidth, scroller.clientWidth, scroller.clientHeight, styles.font, styles.fontFamily, styles.fontSize,
      styles.lineHeight, styles.letterSpacing, styles.wordSpacing, styles.whiteSpace, styles.wordBreak, styles.overflowWrap, styles.direction,
    ]) };
  }

  function pointRect(point: Point): readonly number[] | null {
    const range = doc.createRange();
    range.setStart(point.node, point.offset);
    range.collapse(true);
    const rects = range.getClientRects();
    if (rects.length > 8) return null;
    for (const rect of rects) {
      const values = [rect.x, rect.y, rect.width, rect.height];
      if (rect.height > 0 && values.every(Number.isFinite)) return values;
    }
    return null;
  }

  function selectionState(): readonly unknown[] | null {
    const selection = doc.getSelection();
    return selection && selection.rangeCount <= 1
      ? [selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset, selection.rangeCount, doc.activeElement]
      : null;
  }

  function captureAnchor(scroller: HTMLElement): Anchor | null {
    const box = scroller.getBoundingClientRect();
    const selection = selectionState();
    if (!selection || ![box.left, box.top, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) return null;
    const x = box.left + scroller.clientLeft + Math.min(32, scroller.clientWidth / 2), top = box.top + scroller.clientTop;
    const hitDoc = doc as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    for (const inset of [.5, 8, 16, 24, 32, 40, 48, 64]) {
      if (inset >= scroller.clientHeight) break;
      const position = hitDoc.caretPositionFromPoint?.(x, top + inset);
      const region = position ? null : hitDoc.caretRangeFromPoint?.(x, top + inset);
      const point = position ? { node: position.offsetNode, offset: position.offset }
        : region ? { node: region.startContainer, offset: region.startOffset } : null;
      if (!point || !host.contains(point.node) || !options.interval(point)) continue;
      const rect = pointRect(point);
      if (rect && rect[1] >= top && rect[1] + rect[3] <= top + scroller.clientHeight) {
        return { point, rect, scroller, left: scroller.scrollLeft, top: scroller.scrollTop, selection };
      }
    }
    return null;
  }

  function verifyAnchor(anchor: Anchor): boolean {
    const { point, scroller } = anchor;
    const selection = selectionState();
    if (!selection || !point.node.isConnected || !host.contains(point.node) || !options.interval(point) || !scroller.isConnected) return false;
    const rect = pointRect(point);
    return !!rect && equal(rect, anchor.rect) && equal(selection, anchor.selection)
      && scroller.scrollLeft === anchor.left && scroller.scrollTop === anchor.top;
  }

  function stop(): void {
    for (const remove of removals.splice(0)) remove();
    entries = [];
    initialScroller = null;
    environment = null;
    invalidated = false;
  }

  function transaction(
    changed: readonly Entry[], pinned: boolean, firstActivation = false,
  ): DomRefusal | null {
    if (!changed.length) return null;
    if (changing || closed || !initialScroller || (!firstActivation && options.blocked())) return options.failure('none');
    const scroller = initialScroller;
    return options.write(() => {
      if (changing || closed || (!firstActivation && options.blocked())) return options.failure('none');
      changing = true;
      let anchor: Anchor | null = null;
      const previous: { entry: Entry; pinned: boolean; style: string }[] = [];
      try {
        const source = options.rows(), root = options.root();
        const verify = () => root !== null && source === options.rows() && root === options.root()
          && entries.every(entry => proof(entry, source, root, options.owns));
        if (!verify()) return firstActivation ? null : options.failure('none');
        anchor = captureAnchor(scroller);
        if (!anchor) return firstActivation ? null : options.failure('none');
        for (const entry of changed) {
          previous.push({ entry, pinned: entry.pinned, style: entry.style });
          setPinned(entry, pinned);
        }
        if (!verify() || !verifyAnchor(anchor)) throw new Error('Layout anchor changed');
        return null;
      } catch {
        if (previous.length && anchor) {
          try {
            for (const { entry, pinned: oldPinned, style } of previous) {
              if (oldPinned) entry.row.outer.removeAttribute('style');
              else entry.row.outer.style.cssText = style;
              entry.pinned = oldPinned;
              entry.style = style;
            }
            scroller.scrollLeft = anchor.left;
            scroller.scrollTop = anchor.top;
          } catch { /* Publication remains unknown after any write failure. */ }
          return options.failure('unknown');
        }
        return firstActivation ? null : options.failure('none');
      } finally { changing = false; }
    });
  }

  function retire(): DomRefusal | null {
    const active = entries.filter(entry => !entry.pinned);
    if (!active.length) return null;
    const result = transaction(active, true);
    if (!result) stop();
    return result;
  }

  function check(): DomRefusal | null {
    if (!entries.some(entry => !entry.pinned)) return null;
    try {
      const now = compatibleEnvironment();
      if (!invalidated && now && now.scroller === initialScroller && now.fingerprint === environment) return null;
    } catch { /* An unknown layout environment must retire its cached sizes. */ }
    return retire();
  }

  return {
    initialize(source: ReadonlyMap<string, LayoutRow>, root: string, selected: Interval | null | undefined, owns: OwnerCheck): void {
      stop();
      if (closed || !win || typeof win.CSS?.supports !== 'function' || !win.CSS.supports('content-visibility', 'auto')
        || !win.CSS.supports('contain-intrinsic-block-size', intrinsicSize) || selected === null) return;
      try {
        const current = compatibleEnvironment(), top = source.get(root);
        if (!current || !top) return;
        const admitted: Entry[] = [];
        for (let index = 0; index < top.view.children.length; index++) {
          const row = source.get(top.view.children[index]);
          if (!row) return;
          const leaf = source.get(row.view.children[0]);
          if (!candidate(row, leaf, root) || !options.supports(row)) continue;
          if (admitted.length === maximumBlocks || !ownedAttributes(row.outer) || !ownedAttributes(leaf.outer)) return;
          const entry: Entry = { row, leaf, index, rowAttributes: attributes(row.outer), leafAttributes: attributes(leaf.outer), pinned: true, style: '' };
          if (!proof(entry, source, root, owns, true)) return;
          admitted.push(entry);
        }
        entries = admitted;
        initialInterval = selected;
        initialScroller = current.scroller;
        environment = current.fingerprint;
      } catch { stop(); }
    },

    activate(): DomRefusal | null {
      const selected = initialInterval;
      const eligible = entries.filter(entry => entry.index !== 0 && (!selected || entry.index < selected[0] || entry.index > selected[1]));
      const result = transaction(eligible, false, true);
      if (result || !entries.some(entry => !entry.pinned) || !win) { stop(); return result; }
      const invalidate = () => {
        if (closed) return;
        invalidated = true;
        if (!options.blocked()) {
          const failure = retire();
          if (failure) options.report(failure);
        }
      };
      win.addEventListener('resize', invalidate);
      removals.push(() => win.removeEventListener('resize', invalidate));
      if (doc.fonts) for (const event of ['loadingdone', 'loadingerror']) {
        doc.fonts.addEventListener(event, invalidate);
        removals.push(() => doc.fonts.removeEventListener(event, invalidate));
      }
      return null;
    },

    pin(anchor: Point, focus: Point): DomRefusal | null {
      const failure = check();
      if (failure || !entries.some(entry => !entry.pinned)) return failure;
      const a = options.interval(anchor), b = options.interval(focus);
      if (!a || !b) return retire();
      const first = Math.min(a[0], b[0]), last = Math.max(a[1], b[1]);
      const result = transaction(entries.filter(entry => !entry.pinned && entry.index >= first && entry.index <= last), true);
      if (!result && entries.every(entry => entry.pinned)) stop();
      return result;
    },

    check,
    retire,
    listeners: () => removals.length,
    destroy(): void {
      closed = true;
      for (const entry of entries) {
        if (!entry.pinned && entry.row.outer.style.cssText === entry.style) setPinned(entry,true);
      }
      stop();
    },
  };
}
