import { createHash } from 'node:crypto';
export const seed = 0x61c0ffee;
const kinds = { p: 1, blockquote: 2, ul: 3, li: 4, table: 5, tr: 6, td: 7 };
const encoder = new TextEncoder();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function textBytes(bytes, salt = 0) {
  const unit = `RU EN ${((seed ^ salt) >>> 0).toString(16)} привет hello 👩🏽‍💻 é. `;
  const size = encoder.encode(unit).length;
  return unit.repeat(Math.floor(bytes / size)) + 'a'.repeat(bytes % size);
}
function make(id, build, note) {
  const nodes = [];
  const add = (kind, parent = -1, text = '') => { nodes.push({ kind, parent, text }); return nodes.length - 1; };
  build(add, nodes);
  const document = { id, seed, nodes };
  const json = Buffer.from(JSON.stringify(document));
  const wireParts = [Buffer.alloc(4)]; wireParts[0].writeUInt32LE(nodes.length);
  let maxDepth = 0, maxLeafBytes = 0, textTotal = 0, textNodes = 0;
  const depths = [];
  for (const [i, node] of nodes.entries()) {
    const text = Buffer.from(node.text);
    const head = Buffer.alloc(12); head.writeUInt32LE(node.parent < 0 ? 0xffffffff : node.parent, 0); head.writeUInt32LE(kinds[node.kind], 4); head.writeUInt32LE(text.length, 8);
    wireParts.push(head, text); textTotal += text.length; maxLeafBytes = Math.max(maxLeafBytes, text.length); if (text.length) textNodes++;
    depths[i] = node.parent < 0 ? 1 : depths[node.parent] + 1;
    maxDepth = Math.max(maxDepth, depths[i] + (text.length ? 1 : 0));
  }
  const wire = Buffer.concat(wireParts);
  return { document, json, wire, manifest: { id, seed, structuralNodes: nodes.length, nonemptyTextNodes: textNodes, totalModelLikeNodes: nodes.length + textNodes, maxDepthIncludingText: maxDepth, textBytes: textTotal, maxLeafBytes, calibrationJsonBytes: json.length, wireBytes: wire.length, jsonSha256: sha(json), wireSha256: sha(wire), note } };
}
export function createCorpora() {
  return [
    make('long-paragraph', add => add('p', -1, textBytes(262144)), 'One leaf at the CMS text-leaf reference ceiling; String middle-edit stress.'),
    make('many-small-blocks', add => { for (let i = 0; i < 10000; i++) add('p', -1, textBytes(40, i)); }, '10,000 independent paragraphs; 20,000 structure+text nodes.'),
    make('deep-tree', add => { let parent = -1; for (let i = 0; i < 30; i++) parent = add('blockquote', parent); add('p', parent, textBytes(256)); }, 'Depth 32 including text, counting root block as 1; no promise of constant-time ancestor traversal.'),
    make('lists', add => { for (let i = 0; i < 50; i++) { const list = add('ul'); for (let j = 0; j < 100; j++) { const item = add('li', list); add('p', item, textBytes(64, i * 100 + j)); } } }, '50 lists with 100 items each; paragraph inside each list item.'),
    make('table-grid', add => { const table = add('table'); for (let r = 0; r < 500; r++) { const row = add('tr', table); for (let c = 0; c < 49; c++) add('td', row, 'x'); } }, '500 rows ×49 columns, no spans; 49,501 structure+text nodes. A large grid below the reference node ceiling.'),
    make('near-node-limit', add => { for (let i = 0; i < 50000; i++) add('p'); }, '50,000 empty structural blocks, no nonempty text leaves. A size-stress fixture, not a validated KWDJ document.'),
    make('near-byte-limit', add => { for (let i = 0; i < 8; i++) add('p', -1, textBytes(261000, i)); }, '2,088,000 text bytes in eight separate leaves; calibration JSON remains below 2MiB. Not KWDJ canonical serialization.'),
  ];
}
