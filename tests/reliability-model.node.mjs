// SPDX-License-Identifier: MIT OR Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonical, contexts, documentValue, literalScenarios, generatedScenarios } from '../scripts/reliability/scenarios.mjs';
const literals = JSON.parse(readFileSync(new URL('../contracts/reliability/v1/model-literals.json', import.meta.url)));
const text = (context, raw) => { const d = JSON.parse(raw); return context.startsWith('kwdj-') ? d.content[0].content[0].text : d.root.children[0].children[0].text; };

test('independent complete document encoder equals four hand-authored canonical literals', () => {
  for (const context of contexts) assert.equal(canonical(documentValue(context, 'a b')), literals.encoderGoldens[context]);
});
test('finite model agrees with hand-authored UTF16/Unicode/isolated history traces', () => {
  for (const scenario of literalScenarios()) {
    const name = literals.cases.find(item => scenario.id === `R38-literal-${item.name}-${scenario.context}`);
    assert(name);
    const checkpoints = [scenario.initialExpected, ...scenario.actions.map(item => item.expected)];
    assert.deepEqual(checkpoints.map(item => text(scenario.context, item.canonical_json)), name.texts, scenario.id);
    assert.deepEqual(checkpoints.map(item => item.selection && [item.selection.anchor_utf16, item.selection.focus_utf16]), name.selections, scenario.id);
    assert.deepEqual(checkpoints.map(item => item.history.undo_units), name.undo);
    assert.deepEqual(checkpoints.map(item => item.history.redo_units), name.redo);
    assert.deepEqual(checkpoints.map(item => item.document_revision), name.revisions);
    assert.deepEqual(checkpoints.map(item => item.dirty), name.dirty);
  }
});
test('seeded exploration is reproducible, stratified, bounded and retains sentinel/Unicode boundaries', () => {
  const first = generatedScenarios(), second = generatedScenarios();
  assert.equal(first.length, 1024); assert.deepEqual(first, second);
  for (const context of contexts) assert.equal(first.filter(item => item.context === context).length, 256);
  for (const scenario of first) {
    assert(scenario.actions.length >= 4 && scenario.actions.length <= 64);
    assert(Buffer.byteLength(scenario.input_json) <= 16384);
    for (const checkpoint of [scenario.initialExpected, ...scenario.actions.map(item => item.expected)]) {
      const current = text(scenario.context, checkpoint.canonical_json);
      assert(current.startsWith('L') && current.endsWith('R'));
      if (checkpoint.selection) for (const offset of Object.values(checkpoint.selection)) {
        assert(offset >= 1 && offset < current.length);
        assert(!(offset > 0 && /[\uD800-\uDBFF]/u.test(current[offset - 1]) && /[\uDC00-\uDFFF]/u.test(current[offset])));
      }
    }
  }
});
