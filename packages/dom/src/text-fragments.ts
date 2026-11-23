// SPDX-License-Identifier: MIT OR Apache-2.0
const fragmentUnits = 512;
const graphemeContinuation = /^[\p{Grapheme_Extend}\p{M}\p{Emoji_Modifier}\u200d]/u;

export function scalarBoundary(text: string, offset: number): boolean {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) return false;
  if (offset === 0 || offset === text.length) return true;
  const left = text.charCodeAt(offset - 1), right = text.charCodeAt(offset);
  return !(left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff);
}

/** Adjacent Text nodes share the original leaf and its presentation wrappers. */
export function planTextFragments(text: string): string[] {
  const parts: string[] = [];
  let from = 0;
  while (text.length - from > fragmentUnits) {
    let seam = text.lastIndexOf(' ', from + fragmentUnits - 1) + 1;
    while (seam > from && graphemeContinuation.test(text.slice(seam, seam + 2))) {
      const previous = seam - 2;
      seam = previous < from ? from : text.lastIndexOf(' ', previous) + 1;
    }
    // A word or joined grapheme without a usable seam keeps an unsplit tail.
    if (seam <= from) break;
    parts.push(text.slice(from, seam));
    from = seam;
  }
  parts.push(text.slice(from));
  return parts;
}

/** Text equality alone cannot give a replacement browser node model authority. */
export function matchesTextFragments(content: HTMLElement, texts: readonly Text[], expected: string): boolean {
  if (texts.length === 0 || content.childNodes.length !== texts.length) return false;
  let from = 0;
  for (let index = 0; index < texts.length; index++) {
    const node = texts[index];
    if (content.childNodes[index] !== node || node.ownerDocument !== content.ownerDocument
        || !scalarBoundary(expected, from) || !expected.startsWith(node.data, from)) return false;
    from += node.length;
  }
  return from === expected.length;
}

/** The caller verifies the complete owned chain before converting coordinates. */
export function fragmentOffset(texts: readonly Text[], content: HTMLElement, node: Node, offset: number): number | null {
  let from = 0;
  for (let index = 0; index < texts.length; index++) {
    const text = texts[index];
    if (node === text) return scalarBoundary(text.data, offset) ? from + offset : null;
    if (node === content && offset === index) return from;
    from += text.length;
  }
  return node === content && offset === texts.length ? from : null;
}

export function fragmentPoint(texts: readonly Text[], offset: number, affinity: 'before' | 'after'): { node: Text; offset: number } | null {
  let from = 0;
  for (let index = 0; index < texts.length; index++) {
    const node = texts[index], end = from + node.length;
    if (offset < end || offset === end && (affinity === 'before' || index === texts.length - 1)) {
      return { node, offset: offset - from };
    }
    from = end;
  }
  return null;
}
