// SPDX-License-Identifier: MIT OR Apache-2.0
/** Inert data parsing only. Profile admission and live presentation are separate. */
import { defaultTreeAdapter, parseFragment } from 'parse5';
import type { DefaultTreeAdapterMap, TreeAdapter } from 'parse5';

type T = DefaultTreeAdapterMap;
type Node = T['node'];
type Parent = T['parentNode'];
type Child = T['childNode'];
type Attribute = Parameters<TreeAdapter<T>['createElement']>[2][number];

export type HtmlDataNode =
  | { readonly kind: 'text' | 'comment'; readonly value: string }
  | { readonly kind: 'doctype'; readonly name: string; readonly publicId: string; readonly systemId: string }
  | { readonly kind: 'element'; readonly tagName: string; readonly namespaceURI: string;
      readonly attributes: readonly { readonly name: string; readonly value: string; readonly namespace: string | null; readonly prefix: string | null }[];
      readonly children: readonly HtmlDataNode[] };

export const clipboardParserLimits = Object.freeze({
  inputUtf16: 524_288, nodeRequests: 50_000, depth: 64,
  attributesPerElement: 128, attributes: 100_000, attributeValueUtf16: 8_192,
  workUnits: 1_000_000, stringCopyUnits: 8_388_608, parseErrors: 32,
});
export interface ParserUsage {
  readonly nodeRequests: number; readonly attributes: number; readonly workUnits: number;
  readonly stringCopyUnits: number; readonly maximumDepth: number;
}
type LimitReason = 'input_limit' | 'tree_limit' | 'depth_limit' | 'attribute_limit' | 'work_limit' | 'parse_error';
export type ClipboardHtmlParse =
  | { readonly status: 'parsed'; readonly nodes: readonly HtmlDataNode[]; readonly usage: ParserUsage; readonly parseErrors: number }
  | { readonly status: 'refused'; readonly code: 'clipboard.invalid_input'; readonly reason: LimitReason; readonly usage: ParserUsage };
class ParserLimit extends Error { constructor(readonly reason: LimitReason) { super(reason); } }

/** Limits adapter work/copies; neither initial browser materialization nor RSS is measured. */
export function parseClipboardHtml(source: string): ClipboardHtmlParse {
  const limits = clipboardParserLimits;
  const usage = { nodeRequests: 0, attributes: 0, workUnits: 0, stringCopyUnits: 0, maximumDepth: 0 };
  const snapshot = (): ParserUsage => Object.freeze({ ...usage });
  const fail = (reason: LimitReason): never => { throw new ParserLimit(reason); };
  const work = (count = 1) => {
    if (count > limits.workUnits - usage.workUnits) fail('work_limit');
    usage.workUnits += count;
  };
  const strings = (count: number) => {
    if (count > limits.stringCopyUnits - usage.stringCopyUnits) fail('work_limit');
    usage.stringCopyUnits += count;
  };
  const node = () => {
    if (usage.nodeRequests === limits.nodeRequests) fail('tree_limit');
    usage.nodeRequests++;
  };
  const depth = (value: number) => {
    usage.maximumDepth = Math.max(usage.maximumDepth, value);
    if (value > limits.depth) fail('depth_limit');
  };
  const attributes = (values: Attribute[]) => {
    if (values.length > limits.attributesPerElement || values.length > limits.attributes - usage.attributes) fail('attribute_limit');
    work(values.length); usage.attributes += values.length;
    for (const value of values) {
      if (value.name.length > 128 || value.value.length > limits.attributeValueUtf16) fail('attribute_limit');
      strings(value.name.length + value.value.length + (value.namespace?.length ?? 0) + (value.prefix?.length ?? 0));
    }
  };
  const virtualParent = new WeakMap<Node, Parent>();
  const children = (value: Node): readonly Child[] => 'childNodes' in value ? value.childNodes : [];
  function attachment(parent: Parent, value: Node) {
    let ancestor: Node | null | undefined = parent, base = 0;
    while (ancestor) {
      work(); if (ancestor === value) fail('parse_error');
      depth(++base);
      ancestor = virtualParent.get(ancestor) ?? ('parentNode' in ancestor ? ancestor.parentNode : null);
    }
    const pending: { value: Node; level: number }[] = [{ value, level: base + 1 }];
    while (pending.length) {
      work(); const current = pending.pop()!; depth(current.level);
      const descendants = children(current.value); work(descendants.length);
      for (const child of descendants) pending.push({ value: child, level: current.level + 1 });
      if ('content' in current.value) pending.push({ value: current.value.content, level: current.level + 1 });
    }
  }
  let openElements = 0, parseErrors = 0;
  const base = defaultTreeAdapter;
  const custom: TreeAdapter<T> = {
    ...base,
    createDocument() { node(); return base.createDocument(); },
    createDocumentFragment() { node(); return base.createDocumentFragment(); },
    createElement(name, namespace, values) { attributes(values); node(); strings(name.length); return base.createElement(name, namespace, values); },
    createCommentNode(value) { strings(value.length); node(); return base.createCommentNode(value); },
    createTextNode(value) { strings(value.length); node(); return base.createTextNode(value); },
    appendChild(parent, value) { attachment(parent, value); base.appendChild(parent, value); },
    insertBefore(parent, value, reference) { work(parent.childNodes.length); attachment(parent, value); base.insertBefore(parent, value, reference); },
    detachNode(value) { work(value.parentNode?.childNodes.length ?? 0); base.detachNode(value); },
    setTemplateContent(template, content) {
      attachment(template, content); base.setTemplateContent(template, content); virtualParent.set(content, template);
    },
    setDocumentType(document, name, publicId, systemId) {
      strings(name.length + publicId.length + systemId.length); work(document.childNodes.length);
      const existing = document.childNodes.find(base.isDocumentTypeNode);
      if (existing) { existing.name = name; existing.publicId = publicId; existing.systemId = systemId; }
      else {
        node(); adapter.appendChild(document, { nodeName: '#documentType', name, publicId, systemId, parentNode: null });
      }
    },
    // The default methods call defaultTreeAdapter directly, bypassing overrides.
    // Own these paths so text creation, concatenation and insertion stay metered.
    insertText(parent, value) {
      const previous = parent.childNodes[parent.childNodes.length - 1];
      if (previous && base.isTextNode(previous)) { strings(previous.value.length + value.length); previous.value += value; }
      else adapter.appendChild(parent, adapter.createTextNode(value));
    },
    insertTextBefore(parent, value, reference) {
      work(parent.childNodes.length); const previous = parent.childNodes[parent.childNodes.indexOf(reference) - 1];
      if (previous && base.isTextNode(previous)) { strings(previous.value.length + value.length); previous.value += value; }
      else adapter.insertBefore(parent, adapter.createTextNode(value), reference);
    },
    adoptAttributes(recipient, values) {
      attributes(values); work(recipient.attrs.length + values.length);
      const names = new Set(recipient.attrs.map(value => value.name));
      let added = 0;
      for (const value of values) if (!names.has(value.name)) { names.add(value.name); added++; }
      if (added > limits.attributesPerElement - recipient.attrs.length) fail('attribute_limit');
      base.adoptAttributes(recipient, values);
    },
    onItemPush() { depth(++openElements); },
    onItemPop() { if (openElements === 0) fail('parse_error'); openElements--; },
  };
  // Count every adapter call as well as explicit scans. This is not a count of
  // every private tokenizer operation; source length independently bounds input.
  const adapter: TreeAdapter<T> = new Proxy(custom, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      return typeof value === 'function' ? (...args: unknown[]) => { work(); return Reflect.apply(value, target, args); } : value;
    },
  });
  function copy(value: Child, level: number): HtmlDataNode {
    work(); depth(level);
    if (base.isTextNode(value)) { strings(value.value.length); return Object.freeze({ kind: 'text', value: value.value }); }
    if (base.isCommentNode(value)) { strings(value.data.length); return Object.freeze({ kind: 'comment', value: value.data }); }
    if (base.isDocumentTypeNode(value)) {
      strings(value.name.length + value.publicId.length + value.systemId.length);
      return Object.freeze({ kind: 'doctype', name: value.name, publicId: value.publicId, systemId: value.systemId });
    }
    const data = 'content' in value ? value.content.childNodes : value.childNodes;
    work(value.attrs.length + data.length);
    const attrs = value.attrs.map(attr => {
      strings(attr.name.length + attr.value.length + (attr.namespace?.length ?? 0) + (attr.prefix?.length ?? 0));
      return Object.freeze({ name: attr.name, value: attr.value, namespace: attr.namespace ?? null, prefix: attr.prefix ?? null });
    });
    return Object.freeze({ kind: 'element', tagName: value.tagName, namespaceURI: value.namespaceURI,
      attributes: Object.freeze(attrs), children: Object.freeze(data.map(child => copy(child, level + 1))) });
  }
  try {
    if (typeof source !== 'string' || source.length > limits.inputUtf16) fail('input_limit');
    const tree = parseFragment<T>(source, { treeAdapter: adapter, sourceCodeLocationInfo: false, scriptingEnabled: true,
      onParseError() { work(); if (++parseErrors > limits.parseErrors) fail('parse_error'); } });
    work(tree.childNodes.length);
    const nodes = Object.freeze(tree.childNodes.map(value => copy(value, 1)));
    return Object.freeze({ status: 'parsed', nodes, usage: snapshot(), parseErrors });
  } catch (error) {
    return Object.freeze({ status: 'refused', code: 'clipboard.invalid_input',
      reason: error instanceof ParserLimit ? error.reason : 'parse_error', usage: snapshot() });
  }
}
