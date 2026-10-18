// SPDX-License-Identifier: MIT OR Apache-2.0
// Independent finite model. No engine, codec, SDK or observed runtime output.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const scenarioFormat = 'editor-reliability-scenario/1';
export const contexts = ['kwdj-prose', 'kwdj-poetry', 'notes-d0', 'notes-d1'];
export const tokens = ['A', 'B', ' ', '\u00a0', 'e\u0301', '😀', '👩‍💻'];
const notesPrefix = 'org.example.notes/';
const root = fileURLToPath(new URL('../../', import.meta.url));
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
export const canonical = value => JSON.stringify(ordered(value));
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);

export function documentValue(context, text) {
  if (!contexts.includes(context) || text.length === 0) throw new Error('finite nonempty text subset only');
  if (context.startsWith('kwdj-')) return { schema: 'klenwriter.document', schema_version: 1,
    profile: context.slice(5), content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
  const node = (type, attrs, children, value = null, marks = []) => ({ type: notesPrefix + type, attrs, children, text: value, marks });
  const marks = context === 'notes-d1' ? [{ type: notesPrefix + 'highlight', attrs: { color: 'sun' } }] : [];
  return { schema_version: 1, root: node('document', { title: 'Oracle\u00a0e\u0301😀', tags: ['draft', 'ru', 'draft'] },
    [node('paragraph', {}, [node('text', {}, [], text, marks)])]) };
}

export function registryFor(context) {
  if (context.startsWith('notes-')) return readFileSync(resolve(root, `examples/notes-extension/${context.slice(6)}.json`), 'utf8');
  // Independently declared public default context; these are inputs, not an oracle inferred from output.
  const prefix = 'org.klenwriter.kwdj';
  const names = ['paragraph', 'heading', 'blockquote', 'bullet_list', 'ordered_list', 'task_list', 'code_block', 'scene_break',
    'table', 'media_image', 'literary_block', 'warning', 'spoiler', 'disclosure', 'verse'];
  return canonical({ format: 'editor-registry/1', profile: { id: prefix, version: '1.0.0', codec_id: `${prefix}/json`, wire_version: 1 },
    selected_extensions: [{ id: `${prefix}/base`, version: '1.0.0' }],
    root: { op: 'repeat', item: { op: 'choice', items: names.map(name => ({ op: 'type', id: `${prefix}/${name}` })) }, min: 1, max: 50000 },
    mark_policy: {}, extensions: [] });
}

function binding(context, registry) {
  const profile = registry.profile;
  return { profile_id: profile.id, profile_version: profile.version, codec_id: profile.codec_id,
    wire_version: profile.wire_version, extensions: clone(registry.selected_extensions) };
}

export function makeScenario({ id, seed = 0, context, initialText, edits }) {
  const registry_json = registryFor(context), registry = JSON.parse(registry_json);
  let text = initialText, selection = null, revision = 0, dirty = false;
  const undo = [], redo = [], actions = [];
  const expected = effect => ({ effect, canonical_json: canonical(documentValue(context, text)),
    selection: clone(selection), history: { undo_units: undo.length, redo_units: redo.length }, dirty,
    document_revision: String(revision) });
  const initialExpected = expected('unchanged');
  for (const edit of edits) {
    const { from, to, inserted } = edit;
    if (!(Number.isSafeInteger(from) && Number.isSafeInteger(to) && from >= 0 && from <= to && to <= text.length && inserted.length > 0)) throw new Error('invalid independently authored edit');
    selection = { anchor_utf16: from, focus_utf16: to };
    actions.push({ op: 'select', from, to, expected: expected('state') });
    const before = { text, selection: clone(selection) };
    const next = text.slice(0, from) + inserted + text.slice(to);
    if (next === text) throw new Error('generated nontrivial replacement required');
    text = next; selection = { anchor_utf16: from + inserted.length, focus_utf16: from + inserted.length };
    const after = { text, selection: clone(selection) };
    undo.push({ before, after }); redo.length = 0; revision++; dirty = true;
    actions.push({ op: 'insert_text', text: inserted, isolated: true, expected: expected('changed') });
  }
  const count = undo.length;
  for (let n = 0; n < count; n++) {
    const unit = undo.pop(); redo.push(unit); ({ text, selection } = clone(unit.before)); revision++;
    actions.push({ op: 'undo', expected: expected('changed') });
  }
  for (let n = 0; n < count; n++) {
    const unit = redo.pop(); undo.push(unit); ({ text, selection } = clone(unit.after)); revision++;
    actions.push({ op: 'redo', expected: expected('changed') });
  }
  const profile_options_json = context.startsWith('notes-') ? canonical({ root_blocks: context === 'notes-d0'
    ? [notesPrefix + 'paragraph'] : [notesPrefix + 'paragraph', notesPrefix + 'callout'], limits: null })
    : canonical({ identities: { media: [], references: [] }, limits: null });
  return { format: scenarioFormat, model: 'finite-token-paragraph/1', id, seed, context,
    input_json: initialExpected.canonical_json, registry_json, profile_options_json, profile: binding(context, registry), admission: 'validate',
    initialLabels: { block: context.startsWith('notes-') ? [0, 0] : [0], primary_leaf: context.startsWith('notes-') ? [0, 0, 0] : [0, 0] },
    initialExpected, actions, limits: { actions: 64, nodes: 128, source_utf8_bytes: 16384 },
    oracle: 'All expected documents and history/caret states computed before any engine/SDK call; finite allowed token boundaries only.' };
}

function random(seed) {
  let value = seed >>> 0 || 1;
  return maximum => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return (value >>> 0) % maximum; };
}

export function generatedScenarios({ perContext = 256, seed = 0x38c0ffee } = {}) {
  if (!Number.isSafeInteger(perContext) || perContext < 1 || perContext > 256) throw new Error('bounded context count');
  const result = [];
  contexts.forEach((context, lane) => {
    for (let index = 0; index < perContext; index++) {
      const caseSeed = (seed ^ Math.imul(lane + 1, 0x9e3779b9) ^ index) >>> 0, next = random(caseSeed);
      let current = ['L', ...Array.from({ length: 2 + next(7) }, () => tokens[next(tokens.length)]), 'R'];
      const initialText = current.join(''), edits = [];
      for (let action = 0, count = 1 + next(16); action < count; action++) {
        // Immutable ASCII sentinels preserve the bound paragraph and a nonempty leaf.
        const start = 1 + next(current.length - 1), end = start + next(current.length - start);
        let replacement = Array.from({ length: 1 + next(3) }, () => tokens[next(tokens.length)]);
        if (replacement.join('') === current.slice(start, end).join('')) replacement.push('A');
        edits.push({ from: current.slice(0, start).join('').length, to: current.slice(0, end).join('').length, inserted: replacement.join('') });
        current.splice(start, end - start, ...replacement);
      }
      result.push(makeScenario({ id: `R38-${context}-${String(index).padStart(3, '0')}`, seed: caseSeed, context, initialText, edits }));
    }
  });
  return result;
}

export function literalScenarios() {
  return contexts.flatMap(context => [
    makeScenario({ id: `R38-literal-nbsp-${context}`, context, initialText: 'ab', edits: [{ from: 1, to: 1, inserted: '\u00a0' }] }),
    makeScenario({ id: `R38-literal-nfd-${context}`, context, initialText: 'A😀B', edits: [{ from: 1, to: 3, inserted: 'e\u0301' }] }),
    makeScenario({ id: `R38-literal-zwj-${context}`, context, initialText: 'L R', edits: [{ from: 1, to: 2, inserted: '👩‍💻' }, { from: 1, to: 6, inserted: '\u00a0e\u0301' }] }),
  ]);
}

export function writeScenarios(directory = resolve(root, 'artifacts/reliability')) {
  const scenarios = [...literalScenarios(), ...generatedScenarios()];
  const raw = scenarios.map(item => JSON.stringify(item)).join('\n') + '\n';
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'scenarios.jsonl'), raw);
  const seal = { format: 'editor-reliability-oracle-seal/1', generator: 'scripts/reliability/scenarios.mjs',
    generatorSha256: sha256(readFileSync(fileURLToPath(import.meta.url))), scenarios: scenarios.length, bytes: Buffer.byteLength(raw), sha256: sha256(raw),
    contexts: Object.fromEntries(contexts.map(context => [context, scenarios.filter(item => item.context === context).length])),
    qualification: 'Expected values generated independently before runtime adapters execute. Contains no observed runtime outcomes.' };
  writeFileSync(resolve(directory, 'scenarios-seal.json'), JSON.stringify(seal, null, 2) + '\n');
  return seal;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(writeScenarios()));
