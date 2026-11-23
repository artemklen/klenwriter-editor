// SPDX-License-Identifier: MIT OR Apache-2.0
// Deterministic KWDJ long-leaf (R1) and near-byte-limit (R5) corpus fixtures.
const pattern = 'Ру En😀e\u0301 ';
const patternBytes = Buffer.byteLength(pattern);

function patterned(bytes, salt) {
  let state = (0x46c0ffee ^ salt) >>> 0;
  let padding = '';
  for (let index = 0; index < bytes % patternBytes; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    padding += String.fromCharCode(97 + state % 26);
  }
  return pattern.repeat(Math.floor(bytes / patternBytes)) + padding;
}

export function longDocumentFixtures() {
  const r1 = 'R1_BEGINabcdefgh' + patterned(131056, 0) + 'R1_MIDDLE' + patterned(131057, 1) + 'R1_END';
  const r5 = Array.from({length: 8}, (_, index) => {
    const label = new Map([[0, 'R5_BEGIN'], [3, 'R5_MIDDLE'], [7, 'R5_END']]).get(index) ?? '';
    const body = patterned(261000 - label.length, index);
    return index === 7 ? body + label : label + body;
  });
  // Both fixtures use ASCII keys already placed in canonical key order.
  return [['R1', [r1]], ['R5', r5]].map(([id, leaves]) => ({id, leaves,
    canonical: JSON.stringify({content: leaves.map(text => ({content: [{text, type: 'text'}], type: 'paragraph'})),
      profile: 'prose', schema: 'klenwriter.document', schema_version: 1})}));
}
